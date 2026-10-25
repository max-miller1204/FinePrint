import Foundation
import OSLog

nonisolated extension HTTP {
    /// For the lease stream. The server sends a keepalive every 15 s, so a minute of silence means
    /// the connection is gone; an analysis with rate limit waits can run for many minutes.
    static let streamingSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 30 * 60
        return URLSession(configuration: configuration)
    }()
}

extension APIClient {
    /// `POST /v1/rentals/:id/leases`: sends the redacted lease and gets back the lease to stream.
    func createLease(_ upload: LeaseUpload) async throws(APIError) -> CreatedLease {
        try await post("v1/rentals/\(upload.rentalServerID)/leases", body: upload.body)
    }

    /// `GET /v1/rentals/:id/leases/:leaseId/stream`: the analysis as it runs, or a replay of one that
    /// finished. Opening it starts the analysis; cancelling the iteration closes it, and the server
    /// stops and frees the lease for the next stream. Throws `APIError`.
    func leaseEvents(rentalServerID: String, leaseID: String, session: URLSession = HTTP.streamingSession) -> AsyncThrowingStream<LeaseEvent, any Error> {
        let url = serverURL.appending(path: "v1/rentals/\(rentalServerID)/leases/\(leaseID)/stream")
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var failure = try await LeaseStream.pump(request(url, token: try await token(forceRefresh: false)), session: session, into: continuation)
                    if failure?.status == 401 {
                        failure = try await LeaseStream.pump(request(url, token: try await token(forceRefresh: true)), session: session, into: continuation)
                    }
                    if let failure {
                        throw APIError.server(status: failure.status, code: LeaseStream.errorCode(in: failure.body))
                    }
                    continuation.finish()
                } catch let error as APIError {
                    continuation.finish(throwing: error)
                } catch {
                    if Task.isCancelled {
                        continuation.finish()
                    } else {
                        continuation.finish(throwing: APIError.offline)
                    }
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func token(forceRefresh: Bool) async throws(APIError) -> String {
        do {
            return try await auth.idToken(forceRefresh: forceRefresh)
        } catch {
            throw .auth(error)
        }
    }

    private func request(_ url: URL, token: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        return request
    }
}

/// Reads the lease stream off the main actor: an analysis replay can be a few hundred kilobytes,
/// read a byte at a time.
nonisolated enum LeaseStream {
    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "LeaseStream")
    /// Enough of an error reply to read its envelope.
    private static let maxErrorBody = 16 * 1024

    /// Yields each event until the stream ends. Returns the status and body instead when the server
    /// answered with an error, before anything was yielded.
    @concurrent
    static func pump(_ request: URLRequest, session: URLSession, into continuation: AsyncThrowingStream<LeaseEvent, any Error>.Continuation) async throws -> (status: Int, body: Data)? {
        let (bytes, response) = try await session.bytes(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var body = Data()
            for try await byte in bytes {
                body.append(byte)
                if body.count >= maxErrorBody { break }
            }
            return (status, body)
        }
        var decoder = ServerSentEventDecoder()
        for try await byte in bytes {
            if let message = decoder.feed(byte) { yield(message, to: continuation) }
        }
        if let message = decoder.finish() { yield(message, to: continuation) }
        return nil
    }

    /// The `error.code` of the server's envelope (spec §13).
    static func errorCode(in body: Data) -> String? {
        struct Envelope: Decodable {
            struct Body: Decodable { var code: String }
            var error: Body
        }
        return (try? JSONDecoder().decode(Envelope.self, from: body))?.error.code
    }

    /// The events in a whole stream body, for tests and fixtures.
    static func events(in body: Data) -> [LeaseEvent] {
        var decoder = ServerSentEventDecoder()
        var messages = decoder.feed(body)
        if let last = decoder.finish() { messages.append(last) }
        return messages.compactMap(event)
    }

    private static func yield(_ message: ServerSentEvent, to continuation: AsyncThrowingStream<LeaseEvent, any Error>.Continuation) {
        if let event = event(message) { continuation.yield(event) }
    }

    /// One event the app reads. One it can't read is logged and skipped, so a new field or event
    /// type on the server doesn't end the stream.
    private static func event(_ message: ServerSentEvent) -> LeaseEvent? {
        do {
            return try LeaseEvent(message)
        } catch {
            logger.error("Skipped an unreadable \(message.event, privacy: .public) event: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
