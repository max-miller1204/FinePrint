import Foundation

nonisolated enum APIError: Error, Equatable, Sendable {
    case auth(AuthError)
    case offline
    /// A non-2xx answer. `code` is the `error.code` of the server's envelope (spec §13).
    case server(status: Int, code: String?)
    case malformedResponse

    var message: LocalizedStringResource {
        switch self {
        case .auth(let error): error.message
        case .offline: "Can't connect. Check your connection and try again."
        case .server(status: 401, code: _): "The server didn't accept this sign-in."
        case .server(let status, code: _): "The server answered with an error (\(status))."
        case .malformedResponse: "The server sent a reply FinePrint couldn't read."
        }
    }
}

/// `GET /v1/me`: who the server thinks the token belongs to.
nonisolated struct Me: Decodable, Equatable, Sendable {
    var uid: String
    var provider: String
}

/// Calls the server's `/v1` routes with the tenant's ID token. A 401 gets one retry with a
/// refreshed token, which covers a token that expired or was revoked since it was cached.
struct APIClient {
    let auth: AuthSession
    let serverURL: URL
    var transport: HTTPTransport = HTTP.transport

    func me() async throws(APIError) -> Me {
        try await get("v1/me")
    }

    func get<Reply: Decodable>(_ path: String) async throws(APIError) -> Reply {
        let url = serverURL.appending(path: path)
        var (data, status) = try await send(url, forceRefresh: false)
        if status == 401 {
            (data, status) = try await send(url, forceRefresh: true)
        }
        guard (200..<300).contains(status) else {
            let code = (try? JSONDecoder().decode(Envelope.self, from: data))?.error.code
            throw .server(status: status, code: code)
        }
        do {
            return try JSONDecoder().decode(Reply.self, from: data)
        } catch {
            throw .malformedResponse
        }
    }

    private func send(_ url: URL, forceRefresh: Bool) async throws(APIError) -> (Data, Int) {
        let token: String
        do {
            token = try await auth.idToken(forceRefresh: forceRefresh)
        } catch {
            throw .auth(error)
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await transport(request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw .offline
        }
    }

    private struct Envelope: Decodable {
        struct Body: Decodable { var code: String }
        var error: Body
    }
}
