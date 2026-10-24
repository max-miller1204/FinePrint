import Foundation
import Synchronization
import Testing
@testable import FinePrint

/// Answers requests from a script and records them. Routes by the URL's last path component
/// (`fineprint-client.json`, `accounts:signUp`, `token`, `me`). The last reply for a route repeats.
nonisolated final class StubHTTP: Sendable {
    struct Reply: Sendable {
        var status: Int
        var body: String
    }

    private let state: Mutex<(routes: [String: [Reply]], requests: [URLRequest])>

    init(_ routes: [String: [Reply]]) {
        state = Mutex((routes, []))
    }

    var transport: HTTPTransport {
        { request in try self.handle(request) }
    }

    var requests: [URLRequest] {
        state.withLock { $0.requests }
    }

    func requests(to route: String) -> [URLRequest] {
        requests.filter { $0.url?.lastPathComponent == route }
    }

    func set(_ route: String, _ replies: [Reply]) {
        state.withLock { $0.routes[route] = replies }
    }

    private func handle(_ request: URLRequest) throws -> (Data, URLResponse) {
        let route = request.url?.lastPathComponent ?? ""
        let reply: Reply? = state.withLock { state in
            state.requests.append(request)
            guard var replies = state.routes[route], let first = replies.first else { return nil }
            if replies.count > 1 {
                replies.removeFirst()
                state.routes[route] = replies
            }
            return first
        }
        guard let reply, let url = request.url else { throw URLError(.cannotConnectToHost) }
        let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: nil, headerFields: nil)!
        return (Data(reply.body.utf8), response)
    }
}

nonisolated enum Fixture {
    static let now = Date(timeIntervalSince1970: 1_800_000_000)
    static let server = URL(string: "http://127.0.0.1:18080")!

    static let config = StubHTTP.Reply(
        status: 200,
        body: #"{"firebase":{"apiKey":"key-1","projectId":"demo-fineprint","authEmulatorHost":"127.0.0.1:9099"}}"#
    )
    static let signUp = StubHTTP.Reply(
        status: 200,
        body: #"{"kind":"identitytoolkit#SignupNewUserResponse","idToken":"id-1","refreshToken":"refresh-1","expiresIn":"3600","localId":"uid-1"}"#
    )
    static let refresh = StubHTTP.Reply(
        status: 200,
        body: #"{"id_token":"id-2","refresh_token":"refresh-2","expires_in":"3600","user_id":"uid-1","token_type":"Bearer","project_id":"demo-fineprint"}"#
    )
    static func firebaseError(_ message: String, status: Int = 400) -> StubHTTP.Reply {
        StubHTTP.Reply(status: status, body: #"{"error":{"code":\#(status),"message":"\#(message)"}}"#)
    }

    static let emulator = ClientConfig.Firebase(apiKey: "key-1", projectId: "demo-fineprint", authEmulatorHost: "127.0.0.1:9099")

    static func credentials(project: String = "demo-fineprint", expiresIn: TimeInterval = 3600) -> AuthCredentials {
        AuthCredentials(
            uid: "uid-1",
            projectId: project,
            apiKey: "key-1",
            authEmulatorHost: "127.0.0.1:9099",
            refreshToken: "refresh-1",
            idToken: "id-1",
            expiresAt: now.addingTimeInterval(expiresIn)
        )
    }
}

@Suite("Firebase Auth REST")
struct FirebaseAuthAPITests {
    @Test func `production endpoints use HTTPS and the API key`() throws {
        let api = FirebaseAuthAPI(config: .init(apiKey: "AIza-x", projectId: "p"), transport: StubHTTP([:]).transport)
        #expect(try api.endpoint(service: "identitytoolkit.googleapis.com", path: "/v1/accounts:signUp").absoluteString
            == "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIza-x")
        #expect(try api.endpoint(service: "securetoken.googleapis.com", path: "/v1/token").absoluteString
            == "https://securetoken.googleapis.com/v1/token?key=AIza-x")
    }

    @Test func `emulator endpoints nest each service under the emulator host`() throws {
        let api = FirebaseAuthAPI(config: Fixture.emulator, transport: StubHTTP([:]).transport)
        #expect(try api.endpoint(service: "securetoken.googleapis.com", path: "/v1/token").absoluteString
            == "http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key=key-1")
    }

    @Test func `anonymous sign-up sends no personal data and parses the account`() async throws {
        let http = StubHTTP(["accounts:signUp": [Fixture.signUp]])
        let api = FirebaseAuthAPI(config: Fixture.emulator, transport: http.transport, bundleIdentifier: "org.fineprint.FinePrint")
        let credentials = try await api.signUpAnonymously(now: Fixture.now)

        #expect(credentials == Fixture.credentials())
        let request = try #require(http.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "X-Ios-Bundle-Identifier") == "org.fineprint.FinePrint")
        let body = try #require(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        #expect(body == #"{"returnSecureToken":true}"#)
    }

    @Test func `refresh trades the refresh token for a new ID token`() async throws {
        let http = StubHTTP(["token": [Fixture.refresh]])
        let api = FirebaseAuthAPI(config: Fixture.emulator, transport: http.transport)
        let refreshed = try await api.refresh(Fixture.credentials(expiresIn: -10), now: Fixture.now)

        #expect(refreshed.idToken == "id-2")
        #expect(refreshed.refreshToken == "refresh-2")
        #expect(refreshed.expiresAt == Fixture.now.addingTimeInterval(3600))
        let request = try #require(http.requests.first)
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
        #expect(request.httpBody == Data("grant_type=refresh_token&refresh_token=refresh-1".utf8))
    }

    @Test(arguments: [
        ("USER_NOT_FOUND", AuthError.accountGone),
        ("INVALID_REFRESH_TOKEN", .accountGone),
        ("TOKEN_EXPIRED", .accountGone),
        ("USER_DISABLED", .accountDisabled),
        ("OPERATION_NOT_ALLOWED : Anonymous sign-in is disabled", .anonymousSignInDisabled),
        ("ADMIN_ONLY_OPERATION", .anonymousSignInDisabled),
        ("TOO_MANY_ATTEMPTS_TRY_LATER", .server(status: 400)),
    ])
    func `maps Firebase error reasons`(message: String, expected: AuthError) async {
        let http = StubHTTP(["token": [Fixture.firebaseError(message)]])
        let api = FirebaseAuthAPI(config: Fixture.emulator, transport: http.transport)
        await #expect(throws: expected) {
            try await api.refresh(Fixture.credentials())
        }
    }

    @Test func `transport failures read as offline and bad JSON as malformed`() async {
        let offline = FirebaseAuthAPI(config: Fixture.emulator, transport: StubHTTP([:]).transport)
        await #expect(throws: AuthError.offline) { try await offline.signUpAnonymously() }

        let garbled = FirebaseAuthAPI(config: Fixture.emulator, transport: StubHTTP(["accounts:signUp": [.init(status: 200, body: "{}")]]).transport)
        await #expect(throws: AuthError.malformedResponse) { try await garbled.signUpAnonymously() }
    }
}

@Suite("Auth session")
struct AuthSessionTests {
    func session(_ http: StubHTTP, store: InMemoryCredentialStore = InMemoryCredentialStore(), allowsEmulator: Bool = true) -> AuthSession {
        AuthSession(store: store, transport: http.transport, serverURL: { Fixture.server }, allowsEmulator: allowsEmulator, now: { Fixture.now })
    }

    @Test func `first launch signs in anonymously with no input`() async throws {
        let http = StubHTTP(["fineprint-client.json": [Fixture.config], "accounts:signUp": [Fixture.signUp]])
        let store = InMemoryCredentialStore()
        let auth = session(http, store: store)
        #expect(auth.state == .signedOut)

        await auth.start()

        #expect(auth.state == .signedIn(uid: "uid-1", tokenExpiresAt: Fixture.now.addingTimeInterval(3600)))
        #expect(store.load() == Fixture.credentials())
        #expect(http.requests.map { $0.url?.absoluteString } == [
            "http://127.0.0.1:18080/.well-known/fineprint-client.json",
            "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=key-1",
        ])
        #expect(try await auth.idToken() == "id-1")
    }

    @Test func `a later launch reuses the saved account`() async throws {
        let http = StubHTTP(["fineprint-client.json": [Fixture.config]])
        let auth = session(http, store: InMemoryCredentialStore(Fixture.credentials()))
        #expect(auth.state == .signedIn(uid: "uid-1", tokenExpiresAt: Fixture.now.addingTimeInterval(3600)))

        await auth.start()

        #expect(http.requests(to: "accounts:signUp").isEmpty)
        #expect(try await auth.idToken() == "id-1")
    }

    @Test func `a token near expiry is refreshed`() async throws {
        let http = StubHTTP(["token": [Fixture.refresh]])
        let auth = session(http, store: InMemoryCredentialStore(Fixture.credentials(expiresIn: 60)))
        #expect(try await auth.idToken() == "id-2")
        #expect(http.requests(to: "token").count == 1)
    }

    @Test func `concurrent callers share one sign-in`() async throws {
        let http = StubHTTP(["fineprint-client.json": [Fixture.config], "accounts:signUp": [Fixture.signUp]])
        let auth = session(http)
        async let first = auth.idToken()
        async let second = auth.idToken()
        #expect(try await [first, second] == ["id-1", "id-1"])
        #expect(http.requests(to: "accounts:signUp").count == 1)
    }

    @Test func `a deleted account is replaced by a new anonymous one`() async throws {
        let http = StubHTTP([
            "token": [Fixture.firebaseError("USER_NOT_FOUND")],
            "fineprint-client.json": [Fixture.config],
            "accounts:signUp": [Fixture.signUp],
        ])
        let auth = session(http, store: InMemoryCredentialStore(Fixture.credentials(expiresIn: -1)))
        #expect(try await auth.idToken() == "id-1")
        #expect(http.requests(to: "accounts:signUp").count == 1)
    }

    @Test func `a server on another Firebase project gets a new account`() async throws {
        let http = StubHTTP(["fineprint-client.json": [Fixture.config], "accounts:signUp": [Fixture.signUp]])
        let store = InMemoryCredentialStore(Fixture.credentials(project: "demo-old"))
        let auth = session(http, store: store)

        await auth.start()

        #expect(store.load()?.projectId == "demo-fineprint")
        #expect(http.requests(to: "accounts:signUp").count == 1)
    }

    @Test func `offline at launch keeps the saved account`() async {
        let auth = session(StubHTTP([:]), store: InMemoryCredentialStore(Fixture.credentials()))
        await auth.start()
        #expect(auth.state == .signedIn(uid: "uid-1", tokenExpiresAt: Fixture.now.addingTimeInterval(3600)))
    }

    @Test func `offline with no account reports the failure, then recovers`() async {
        let http = StubHTTP([:])
        let auth = session(http)
        await auth.start()
        #expect(auth.state == .failed(.offline))

        http.set("fineprint-client.json", [Fixture.config])
        http.set("accounts:signUp", [Fixture.signUp])
        await auth.start()
        #expect(auth.state == .signedIn(uid: "uid-1", tokenExpiresAt: Fixture.now.addingTimeInterval(3600)))
    }

    @Test func `a server without sign-in says so`() async {
        let http = StubHTTP(["fineprint-client.json": [.init(status: 503, body: #"{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"x"}}"#)]])
        let auth = session(http)
        await auth.start()
        #expect(auth.state == .failed(.notConfigured))
    }

    @Test func `release builds never sign in to an emulator`() async {
        let http = StubHTTP(["fineprint-client.json": [Fixture.config], "accounts:signUp": [Fixture.signUp]])
        let auth = session(http, allowsEmulator: false)
        await auth.start()
        #expect(auth.state == .failed(.notConfigured))
        #expect(http.requests(to: "accounts:signUp").isEmpty)
    }

    @Test func `a disabled account is dropped and not replaced`() async {
        let http = StubHTTP(["token": [Fixture.firebaseError("USER_DISABLED")], "accounts:signUp": [Fixture.signUp]])
        let store = InMemoryCredentialStore(Fixture.credentials(expiresIn: -1))
        let auth = session(http, store: store)
        await #expect(throws: AuthError.accountDisabled) { try await auth.idToken() }
        #expect(auth.state == .failed(.accountDisabled))
        #expect(store.load() == nil)
        #expect(http.requests(to: "accounts:signUp").isEmpty)
    }
}

@Suite("API client")
struct APIClientTests {
    func client(_ http: StubHTTP, credentials: AuthCredentials = Fixture.credentials()) -> APIClient {
        let auth = AuthSession(
            store: InMemoryCredentialStore(credentials),
            transport: http.transport,
            serverURL: { Fixture.server },
            now: { Fixture.now }
        )
        return APIClient(auth: auth, serverURL: Fixture.server, transport: http.transport)
    }

    @Test func `sends the ID token as a bearer token`() async throws {
        let http = StubHTTP(["me": [.init(status: 200, body: #"{"uid":"uid-1","provider":"anonymous"}"#)]])
        let me = try await client(http).me()
        #expect(me == Me(uid: "uid-1", provider: "anonymous"))
        let request = try #require(http.requests(to: "me").first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:18080/v1/me")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
    }

    @Test func `a 401 is retried once with a refreshed token`() async throws {
        let http = StubHTTP([
            "me": [.init(status: 401, body: #"{"error":{"code":"UNAUTHENTICATED","message":"ID token expired"}}"#),
                   .init(status: 200, body: #"{"uid":"uid-1","provider":"anonymous"}"#)],
            "token": [Fixture.refresh],
        ])
        _ = try await client(http).me()
        #expect(http.requests(to: "me").map { $0.value(forHTTPHeaderField: "Authorization") } == ["Bearer id-1", "Bearer id-2"])
    }

    @Test func `a second 401 surfaces the server's error code`() async {
        let http = StubHTTP([
            "me": [.init(status: 401, body: #"{"error":{"code":"UNAUTHENTICATED","message":"Invalid ID token"}}"#)],
            "token": [Fixture.refresh],
        ])
        await #expect(throws: APIError.server(status: 401, code: "UNAUTHENTICATED")) {
            try await client(http).me()
        }
        #expect(http.requests(to: "me").count == 2)
    }
}

@MainActor private func keychainIsAvailable() -> Bool {
    let probe = KeychainCredentialStore(service: "org.fineprint.FinePrintTests.probe")
    defer { probe.clear() }
    probe.save(Fixture.credentials())
    return probe.load() != nil
}

@Suite(
    "Keychain credential store",
    .enabled("Unsigned simulator builds (CODE_SIGNING_ALLOWED=NO) have no keychain") { await keychainIsAvailable() }
)
struct KeychainCredentialStoreTests {
    @Test func `saves, replaces, and clears credentials`() {
        let store = KeychainCredentialStore(service: "org.fineprint.FinePrintTests.\(UUID().uuidString)")
        defer { store.clear() }
        #expect(store.load() == nil)

        store.save(Fixture.credentials())
        #expect(store.load() == Fixture.credentials())

        var refreshed = Fixture.credentials()
        refreshed.idToken = "id-2"
        store.save(refreshed)
        #expect(store.load()?.idToken == "id-2")

        store.clear()
        #expect(store.load() == nil)
    }
}
