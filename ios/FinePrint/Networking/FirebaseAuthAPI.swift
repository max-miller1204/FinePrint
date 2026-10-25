import Foundation

/// Sends one HTTP request. The app uses `HTTP.session`; tests pass a stub.
typealias HTTPTransport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

nonisolated enum HTTP {
    /// Ephemeral: no cookies, cache, or credentials written to disk.
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        return URLSession(configuration: configuration)
    }()

    static let transport: HTTPTransport = { request in
        try await session.data(for: request)
    }

    /// For model-backed routes, which say nothing until the answer is ready: the responsibility
    /// check runs triage, Gemma 26B, and Gemma 31B, about a minute in all.
    static let modelSession: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 180
        return URLSession(configuration: configuration)
    }()

    static let modelTransport: HTTPTransport = { request in
        try await modelSession.data(for: request)
    }
}

/// The server's public sign-in settings, from `GET /.well-known/fineprint-client.json`.
/// Each organization's server names its own Firebase project, so one build works with any of them.
nonisolated struct ClientConfig: Decodable, Equatable, Sendable {
    struct Firebase: Decodable, Equatable, Sendable {
        var apiKey: String
        var projectId: String
        /// Set when the server runs against the Firebase Auth emulator. Honored in DEBUG builds only.
        var authEmulatorHost: String?
    }

    var firebase: Firebase
}

/// An anonymous Firebase account and its current tokens. Kept in the keychain.
nonisolated struct AuthCredentials: Codable, Equatable, Sendable {
    var uid: String
    var projectId: String
    var apiKey: String
    var authEmulatorHost: String?
    var refreshToken: String
    var idToken: String
    var expiresAt: Date

    /// ID tokens last an hour. Refresh five minutes early so a slow request never carries an expired one.
    func isFresh(at now: Date) -> Bool {
        expiresAt.timeIntervalSince(now) > 5 * 60
    }

    func belongs(to config: ClientConfig.Firebase) -> Bool {
        projectId == config.projectId && authEmulatorHost == config.authEmulatorHost
    }

    /// The same account with the server's current API key. A redeploy can replace the key while the
    /// project, and so the account, stays the same.
    func rekeyed(to config: ClientConfig.Firebase) -> AuthCredentials {
        var copy = self
        copy.apiKey = config.apiKey
        return copy
    }
}

nonisolated enum AuthError: Error, Equatable, Sendable {
    /// The server has no Firebase project set up (or, in Release, only the emulator).
    case notConfigured
    case offline
    case server(status: Int)
    case malformedResponse
    /// The project has anonymous sign-in turned off.
    case anonymousSignInDisabled
    case accountDisabled
    /// The account was deleted or its refresh token revoked. A new anonymous account replaces it.
    case accountGone
    /// Google rejected the API key: it was deleted or expired, usually because the server was redeployed.
    case apiKeyRejected

    var message: LocalizedStringResource {
        switch self {
        case .notConfigured: "This server isn't set up for sign-in yet."
        case .offline: "Can't connect. Check your connection and try again."
        case .server(let status): "The server answered with an error (\(status))."
        case .malformedResponse: "The server sent a reply FinePrint couldn't read."
        case .anonymousSignInDisabled: "Anonymous sign-in is turned off for this server."
        case .accountDisabled: "This account has been turned off."
        case .accountGone: "Your sign-in ended. FinePrint will start a new one."
        case .apiKeyRejected: "This server's sign-in key changed. Try again."
        }
    }
}

/// The two Firebase Auth REST calls FinePrint needs: create an anonymous account, and refresh its ID token.
/// Plain HTTPS instead of the Firebase SDK keeps third-party code out of the app (spec §9.2).
nonisolated struct FirebaseAuthAPI: Sendable {
    let config: ClientConfig.Firebase
    let transport: HTTPTransport
    var bundleIdentifier = Bundle.main.bundleIdentifier

    /// `POST accounts:signUp` with no email or password makes an anonymous account.
    func signUpAnonymously(now: Date = .now) async throws(AuthError) -> AuthCredentials {
        var request = try URLRequest(url: endpoint(service: "identitytoolkit.googleapis.com", path: "/v1/accounts:signUp"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"returnSecureToken":true}"#.utf8)

        let reply: SignUpReply = try await send(request)
        guard let seconds = TimeInterval(reply.expiresIn) else { throw .malformedResponse }
        return AuthCredentials(
            uid: reply.localId,
            projectId: config.projectId,
            apiKey: config.apiKey,
            authEmulatorHost: config.authEmulatorHost,
            refreshToken: reply.refreshToken,
            idToken: reply.idToken,
            expiresAt: now.addingTimeInterval(seconds)
        )
    }

    /// `POST securetoken.googleapis.com/v1/token` trades the refresh token for a new ID token.
    func refresh(_ credentials: AuthCredentials, now: Date = .now) async throws(AuthError) -> AuthCredentials {
        var request = try URLRequest(url: endpoint(service: "securetoken.googleapis.com", path: "/v1/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: credentials.refreshToken),
        ]
        request.httpBody = Data((form.percentEncodedQuery ?? "").utf8)

        let reply: RefreshReply = try await send(request)
        guard let seconds = TimeInterval(reply.expiresIn) else { throw .malformedResponse }
        var refreshed = credentials
        refreshed.uid = reply.userId
        refreshed.idToken = reply.idToken
        refreshed.refreshToken = reply.refreshToken
        refreshed.expiresAt = now.addingTimeInterval(seconds)
        return refreshed
    }

    /// Production hosts over HTTPS, or the emulator, which serves every service under its own host.
    func endpoint(service: String, path: String) throws(AuthError) -> URL {
        let base = config.authEmulatorHost.map { "http://\($0)/\(service)" } ?? "https://\(service)"
        var components = URLComponents(string: base + path)
        components?.queryItems = [URLQueryItem(name: "key", value: config.apiKey)]
        guard let url = components?.url else { throw .notConfigured }
        return url
    }

    private func send<Reply: Decodable>(_ request: URLRequest) async throws(AuthError) -> Reply {
        var request = request
        // Lets a project restrict its API key to this app.
        if let bundleIdentifier {
            request.setValue(bundleIdentifier, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport(request)
        } catch {
            throw .offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw Self.error(status: status, body: data)
        }
        do {
            return try JSONDecoder().decode(Reply.self, from: data)
        } catch {
            throw .malformedResponse
        }
    }

    /// Firebase puts the reason in `error.message`, sometimes followed by " : details". Google's API
    /// layer rejects a bad key before Firebase sees the request, with the reason in `error.details`.
    static func error(status: Int, body: Data) -> AuthError {
        let reply = try? JSONDecoder().decode(ErrorReply.self, from: body)
        if reply?.error.details?.contains(where: { $0.reason == "API_KEY_INVALID" }) == true {
            return .apiKeyRejected
        }
        let reason = reply?.error.message.split(separator: " ").first.map(String.init)
        switch reason {
        case "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED": return .accountGone
        case "USER_DISABLED": return .accountDisabled
        case "OPERATION_NOT_ALLOWED", "ADMIN_ONLY_OPERATION": return .anonymousSignInDisabled
        default: return .server(status: status)
        }
    }

    private struct SignUpReply: Decodable {
        var idToken: String
        var refreshToken: String
        var expiresIn: String
        var localId: String
    }

    private struct RefreshReply: Decodable {
        var idToken: String
        var refreshToken: String
        var expiresIn: String
        var userId: String

        enum CodingKeys: String, CodingKey {
            case idToken = "id_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case userId = "user_id"
        }
    }

    private struct ErrorReply: Decodable {
        struct Body: Decodable {
            var message: String
            var details: [Detail]?
        }
        struct Detail: Decodable { var reason: String? }
        var error: Body
    }
}
