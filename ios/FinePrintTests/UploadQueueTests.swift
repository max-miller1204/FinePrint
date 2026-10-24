import Foundation
import Testing
@testable import FinePrint

/// Answers the queue's calls from a script and records them. A step with no script left succeeds.
final class FakeUploader: EvidenceUploading {
    var requestReplies: [Result<EvidenceItemReply, APIError>] = []
    var sendErrors: [APIError?] = []
    var completeReplies: [Result<EvidenceItemReply, APIError>] = []
    private(set) var calls: [String] = []
    private(set) var sent: [(Data, UploadTarget)] = []

    func requestUpload(rentalServerID: String, record: CaptureRecord) async throws(APIError) -> EvidenceItemReply {
        calls.append("request \(rentalServerID)")
        return try next(&requestReplies, default: .pending(record.itemID)).get()
    }

    func send(_ data: Data, to target: UploadTarget) async throws(APIError) {
        calls.append("send")
        sent.append((data, target))
        if !sendErrors.isEmpty, let error = sendErrors.removeFirst() { throw error }
    }

    func completeUpload(rentalServerID: String, itemID: UUID) async throws(APIError) -> EvidenceItemReply {
        calls.append("complete \(rentalServerID)")
        return try next(&completeReplies, default: .received(itemID)).get()
    }

    private func next(_ script: inout [Result<EvidenceItemReply, APIError>], default reply: EvidenceItemReply) -> Result<EvidenceItemReply, APIError> {
        script.isEmpty ? .success(reply) : script.removeFirst()
    }
}

final class FakeRentals: RentalResolving {
    var serverIDs: [UUID: String] = [:]

    func serverRentalID(for rentalID: UUID) async throws(APIError) -> String? {
        serverIDs[rentalID]
    }
}

final class FakeNetwork: NetworkMonitoring {
    var isOnline = true
    private var onChange: (@MainActor (Bool) -> Void)?

    func start(onChange: @escaping @MainActor (Bool) -> Void) {
        self.onChange = onChange
    }

    func set(online: Bool) {
        isOnline = online
        onChange?(online)
    }
}

extension EvidenceItemReply {
    static let target = UploadTarget(
        method: "PUT",
        url: URL(string: "http://127.0.0.1:9290/upload/storage/v1/b/demo-fineprint-evidence/o?upload_id=1")!,
        headers: ["Content-Type": "image/jpeg", "x-goog-content-sha256": String(repeating: "a", count: 64)],
        expiresAt: "2027-01-15T08:05:00.000Z"
    )

    static func pending(_ itemID: UUID) -> EvidenceItemReply {
        EvidenceItemReply(itemId: itemID, status: .pending, receivedAtServer: nil, upload: target)
    }

    static func received(_ itemID: UUID) -> EvidenceItemReply {
        EvidenceItemReply(itemId: itemID, status: .received, receivedAtServer: "2027-01-15T08:00:01.000Z", upload: nil)
    }
}

@Suite("Upload queue")
struct UploadQueueTests {
    let store = EvidenceStore(root: URL.temporaryDirectory.appending(path: "UploadQueueTests-\(UUID().uuidString)", directoryHint: .isDirectory))
    let uploader = FakeUploader()
    let rentals = FakeRentals()
    let network = FakeNetwork()
    let rentalID = UUID()
    /// Advanced by tests to pass backoff deadlines.
    let clock = TestClock()

    final class TestClock {
        var now = Fixture.now
    }

    init() {
        rentals.serverIDs[rentalID] = "rental-1"
    }

    func queue(store: EvidenceStore? = nil) -> UploadQueue {
        UploadQueue(store: store ?? self.store, uploader: uploader, rentals: rentals, network: network, now: { [clock] in clock.now }, sleep: { _ in throw CancellationError() })
    }

    /// A capture on disk, as the pipeline leaves it.
    func capture(_ bytes: String = "photo bytes") throws -> (CaptureRecord, StoredCapture) {
        let original = Data(bytes.utf8)
        let record = CaptureRecord(
            itemID: UUID(),
            rentalID: rentalID,
            sha256: EvidenceHash.sha256Hex(of: original),
            bytes: original.count,
            mime: "image/jpeg",
            capturedAtDevice: "2027-01-15T03:00:00-05:00",
            deviceUptimeMs: 1000,
            source: .inAppCamera,
            room: "Kitchen",
            checklistItem: "Walls",
            appVersion: "1.0.0 (1)"
        )
        let files = try store.save(original: original, modelCopy: Data(), record: record)
        return (record, files)
    }

    @Test func `a kept photo uploads in three steps and is received`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        #expect(queue.status(for: record.itemID) == .waiting)

        await queue.drain()

        #expect(uploader.calls == ["request rental-1", "send", "complete rental-1"])
        #expect(uploader.sent.first?.0 == Data("photo bytes".utf8))
        #expect(uploader.sent.first?.1 == EvidenceItemReply.target)
        #expect(queue.status(for: record.itemID) == .received)
        #expect(queue.items[record.itemID]?.state == .received(at: "2027-01-15T08:00:01.000Z"))
        #expect(queue.waitingCount == 0)
    }

    @Test func `the queue survives a relaunch`() async throws {
        let (record, files) = try capture()
        network.isOnline = false
        queue().enqueue(record, original: files.original)

        // Written with complete protection; the simulator does not report it back, so only the file is checked.
        let saved = store.directory(for: record).appending(path: EvidenceStore.uploadFileName)
        #expect(FileManager.default.fileExists(atPath: saved.path(percentEncoded: false)))

        // A new launch reads it back and uploads it.
        network.isOnline = true
        let relaunched = queue()
        #expect(relaunched.status(for: record.itemID) == .waiting)
        await relaunched.drain()
        #expect(relaunched.status(for: record.itemID) == .received)
        #expect(queue().status(for: record.itemID) == .received)
    }

    @Test func `photos taken offline wait, then upload on reconnect`() async throws {
        network.isOnline = false
        let queue = queue()
        queue.start()
        await queue.drainTask?.value
        let first = try capture("first")
        let second = try capture("second")
        queue.enqueue(first.0, original: first.1.original)
        clock.now += 1
        queue.enqueue(second.0, original: second.1.original)
        await queue.drainTask?.value

        #expect(uploader.calls.isEmpty)
        #expect(queue.waitingCount == 2)

        network.set(online: true)
        await queue.drainTask?.value

        #expect(queue.waitingCount == 0)
        // Oldest first.
        #expect(uploader.sent.map(\.0) == [Data("first".utf8), Data("second".utf8)])
    }

    @Test func `losing the connection mid-pass stops the pass and backs off`() async throws {
        let first = try capture("first")
        let second = try capture("second")
        let queue = queue()
        queue.enqueue(first.0, original: first.1.original)
        clock.now += 1
        queue.enqueue(second.0, original: second.1.original)
        uploader.requestReplies = [.failure(.offline)]

        await queue.drain()

        #expect(uploader.calls == ["request rental-1"])
        #expect(queue.items[first.0.itemID]?.attempts == 1)
        #expect(queue.items[first.0.itemID]?.nextAttemptAt == clock.now.addingTimeInterval(5))
        #expect(queue.items[second.0.itemID]?.attempts == 0)
    }

    @Test func `a server error backs off exponentially, and the retry succeeds`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.requestReplies = [.failure(.server(status: 503, code: "DEPENDENCY_UNAVAILABLE")), .failure(.server(status: 503, code: "DEPENDENCY_UNAVAILABLE"))]

        await queue.drain()
        #expect(queue.items[record.itemID]?.nextAttemptAt == clock.now.addingTimeInterval(5))
        // Not due yet: nothing is sent.
        await queue.drain()
        #expect(uploader.calls.count == 1)

        clock.now += 5
        await queue.drain()
        #expect(queue.items[record.itemID]?.nextAttemptAt == clock.now.addingTimeInterval(10))

        clock.now += 10
        await queue.drain()
        #expect(queue.status(for: record.itemID) == .received)
    }

    @Test(arguments: [(1, 5.0), (2, 10.0), (3, 20.0), (7, 300.0), (20, 300.0)])
    func `backoff doubles from five seconds to at most five minutes`(attempts: Int, seconds: TimeInterval) {
        #expect(UploadQueue.backoff(afterAttempts: attempts) == seconds)
    }

    @Test func `foregrounding retries at once, without waiting out the backoff`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.requestReplies = [.failure(.server(status: 500, code: "INTERNAL"))]
        await queue.drain()
        #expect(queue.status(for: record.itemID) == .waiting)

        queue.resume()
        await queue.drainTask?.value
        #expect(queue.status(for: record.itemID) == .received)
    }

    @Test func `a hash mismatch is rejected for good`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.completeReplies = [.failure(.server(status: 422, code: "HASH_MISMATCH"))]

        await queue.drain()
        queue.resume()
        await queue.drainTask?.value

        #expect(queue.items[record.itemID]?.state == .rejected(.hashMismatch))
        #expect(queue.status(for: record.itemID) == .rejected)
        #expect(uploader.calls.count == 3)
    }

    @Test func `Storage refusing the bytes for the signed hash is a mismatch too`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.sendErrors = [.server(status: 400, code: nil)]

        await queue.drain()

        #expect(queue.items[record.itemID]?.state == .rejected(.hashMismatch))
        #expect(uploader.calls == ["request rental-1", "send"])
    }

    @Test func `an expired upload URL gets a fresh one on the next attempt`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.sendErrors = [.server(status: 403, code: nil)]

        await queue.drain()
        clock.now += 5
        await queue.drain()

        #expect(uploader.calls == ["request rental-1", "send", "request rental-1", "send", "complete rental-1"])
        #expect(queue.status(for: record.itemID) == .received)
    }

    @Test func `a completion that finds no upload yet is retried`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.completeReplies = [.failure(.server(status: 409, code: "CONFLICT"))]

        await queue.drain()

        #expect(queue.status(for: record.itemID) == .waiting)
        #expect(queue.items[record.itemID]?.attempts == 1)
    }

    @Test func `an item the server already received is not uploaded again`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        uploader.requestReplies = [.success(.received(record.itemID))]

        await queue.drain()

        #expect(uploader.calls == ["request rental-1"])
        #expect(queue.status(for: record.itemID) == .received)
    }

    @Test func `a rental the server does not know yet keeps its photos waiting`() async throws {
        rentals.serverIDs = [:]
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)

        await queue.drain()
        #expect(uploader.calls.isEmpty)
        #expect(queue.status(for: record.itemID) == .waiting)

        rentals.serverIDs[rentalID] = "rental-2"
        queue.resume()
        await queue.drainTask?.value
        #expect(uploader.calls.first == "request rental-2")
        #expect(queue.status(for: record.itemID) == .received)
    }

    @Test func `a missing original is rejected instead of retried forever`() async throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        try FileManager.default.removeItem(at: files.original)

        await queue.drain()

        #expect(queue.items[record.itemID]?.state == .rejected(.missingFile))
        #expect(!uploader.calls.contains("send"))
    }

    @Test func `enqueueing the same photo twice keeps one item`() throws {
        let (record, files) = try capture()
        let queue = queue()
        queue.enqueue(record, original: files.original)
        queue.enqueue(record, original: files.original)
        #expect(queue.items.count == 1)
    }

    @Test(arguments: [
        (APIError.offline, UploadQueue.Outcome.offline),
        (.server(status: 422, code: "HASH_MISMATCH"), .rejected(.hashMismatch)),
        (.server(status: 403, code: "FORBIDDEN"), .rejected(.refused)),
        (.server(status: 404, code: "NOT_FOUND"), .rejected(.refused)),
        (.server(status: 409, code: "CONFLICT"), .rejected(.refused)),
        (.server(status: 429, code: "RATE_LIMITED"), .retry),
        (.server(status: 503, code: "DEPENDENCY_UNAVAILABLE"), .retry),
        (.auth(.offline), .retry),
        (.malformedResponse, .retry),
    ])
    func `server answers map to retry or reject`(error: APIError, outcome: UploadQueue.Outcome) {
        #expect(UploadQueue.outcome(for: error) == outcome)
    }
}

@Suite("Evidence API")
struct EvidenceAPITests {
    func client(_ http: StubHTTP) throws -> APIClient {
        let auth = AuthSession(store: InMemoryCredentialStore(Fixture.credentials()), transport: http.transport, serverURL: { Fixture.server }, now: { Fixture.now })
        return APIClient(auth: auth, serverURL: Fixture.server, transport: http.transport)
    }

    let record = CaptureRecord(
        itemID: UUID(uuidString: "6F1C2A5E-8D3B-4C7A-9E21-0B4F5D6A7C88")!,
        rentalID: UUID(),
        sha256: String(repeating: "b", count: 64),
        bytes: 12,
        mime: "image/heic",
        capturedAtDevice: "2026-08-14T15:12:03-04:00",
        deviceUptimeMs: 81233411,
        source: .inAppCamera,
        room: "Kitchen",
        checklistItem: "Walls",
        appVersion: "1.0.0 (12)"
    )

    @Test func `asks for an upload URL with the capture record, minus the device rental ID`() async throws {
        let reply = #"{"items":[{"itemId":"6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88","status":"pending","receivedAtServer":null,"upload":{"method":"PUT","url":"https://storage.googleapis.com/b/o?X-Goog-Signature=1","headers":{"Content-Type":"image/heic","x-goog-content-sha256":"bbbb"},"expiresAt":"2026-08-14T19:17:03.000Z"}}]}"#
        let http = StubHTTP(["evidence": [StubHTTP.Reply(status: 201, body: reply)]])
        let item = try await client(http).requestUpload(rentalServerID: "rental-1", record: record)

        #expect(item.status == .pending)
        #expect(item.upload?.headers["x-goog-content-sha256"] == "bbbb")
        let request = try #require(http.requests(to: "evidence").first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:18080/v1/rentals/rental-1/evidence")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
        let body = try #require(request.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: [[String: Any]]] })
        let sent = try #require(body["items"]?.first)
        #expect(Set(sent.keys) == ["itemId", "room", "checklistItem", "sha256", "bytes", "mime", "capturedAtDevice", "deviceUptimeMs", "source", "appVersion"])
        #expect(sent["source"] as? String == "in_app_camera")
    }

    @Test func `completes with the lowercase item ID`() async throws {
        let reply = #"{"itemId":"6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88","status":"received","receivedAtServer":"2026-08-14T19:12:05.000Z"}"#
        let http = StubHTTP(["complete": [StubHTTP.Reply(status: 200, body: reply)]])
        let item = try await client(http).completeUpload(rentalServerID: "rental-1", itemID: record.itemID)

        #expect(item == EvidenceItemReply(itemId: record.itemID, status: .received, receivedAtServer: "2026-08-14T19:12:05.000Z", upload: nil))
        #expect(http.requests(to: "complete").first?.url?.path() == "/v1/rentals/rental-1/evidence/6f1c2a5e-8d3b-4c7a-9e21-0b4f5d6a7c88/complete")
    }

    @Test func `a hash mismatch surfaces as 422 HASH_MISMATCH`() async throws {
        let http = StubHTTP(["complete": [StubHTTP.Reply(status: 422, body: #"{"error":{"code":"HASH_MISMATCH","message":"x"}}"#)]])
        await #expect(throws: APIError.server(status: 422, code: "HASH_MISMATCH")) {
            try await client(http).completeUpload(rentalServerID: "rental-1", itemID: record.itemID)
        }
    }

    @Test func `PUTs the bytes with exactly the signed headers and no token`() async throws {
        let http = StubHTTP(["o": [StubHTTP.Reply(status: 200, body: "{}")]])
        let target = UploadTarget(
            method: "PUT",
            url: URL(string: "https://storage.googleapis.com/bucket/o?X-Goog-Signature=1")!,
            headers: ["Content-Type": "image/heic", "x-goog-content-sha256": "bbbb"],
            expiresAt: "2026-08-14T19:17:03.000Z"
        )
        try await target.send(Data("bytes".utf8), transport: http.transport)

        let request = try #require(http.requests.first)
        #expect(request.httpMethod == "PUT")
        #expect(request.httpBody == Data("bytes".utf8))
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "image/heic")
        #expect(request.value(forHTTPHeaderField: "x-goog-content-sha256") == "bbbb")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func `a refused PUT is a server error, and no connection is offline`() async {
        let target = EvidenceItemReply.target
        await #expect(throws: APIError.server(status: 403, code: nil)) {
            try await target.send(Data(), transport: StubHTTP([target.url.lastPathComponent: [StubHTTP.Reply(status: 403, body: "")]]).transport)
        }
        await #expect(throws: APIError.offline) {
            try await target.send(Data(), transport: StubHTTP([:]).transport)
        }
    }
}
