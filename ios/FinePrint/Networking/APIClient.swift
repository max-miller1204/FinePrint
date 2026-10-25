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
        try await send("GET", path, body: nil)
    }

    /// Sends `body` as JSON. Swift property names go out as they are, so name them as the server does.
    func post<Body: Encodable, Reply: Decodable>(_ path: String, body: Body) async throws(APIError) -> Reply {
        try await send("POST", path, body: try encode(body))
    }

    func patch<Body: Encodable, Reply: Decodable>(_ path: String, body: Body) async throws(APIError) -> Reply {
        try await send("PATCH", path, body: try encode(body))
    }

    func delete<Reply: Decodable>(_ path: String) async throws(APIError) -> Reply {
        try await send("DELETE", path, body: nil)
    }

    private func encode(_ body: some Encodable) throws(APIError) -> Data {
        do {
            return try JSONEncoder().encode(body)
        } catch {
            throw .malformedResponse
        }
    }

    private func send<Reply: Decodable>(_ method: String, _ path: String, body: Data?) async throws(APIError) -> Reply {
        let url = serverURL.appending(path: path)
        var (data, status) = try await send(method, url, body: body, forceRefresh: false)
        if status == 401 {
            (data, status) = try await send(method, url, body: body, forceRefresh: true)
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

    private func send(_ method: String, _ url: URL, body: Data?, forceRefresh: Bool) async throws(APIError) -> (Data, Int) {
        let token: String
        do {
            token = try await auth.idToken(forceRefresh: forceRefresh)
        } catch {
            throw .auth(error)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
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
