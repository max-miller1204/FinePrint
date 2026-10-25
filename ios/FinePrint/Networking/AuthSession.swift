import Foundation
import Observation
import OSLog

/// Signs the tenant in anonymously on first launch, with no input, and hands out fresh ID tokens
/// for the server's `/v1` routes. No email or phone number is ever collected (spec §0, §5.2).
@Observable
final class AuthSession {
    enum State: Equatable {
        case signedOut
        case signingIn
        case signedIn(uid: String, tokenExpiresAt: Date)
        case failed(AuthError)
    }

    private(set) var state: State

    @ObservationIgnored private let store: any CredentialStore
    @ObservationIgnored private let transport: HTTPTransport
    @ObservationIgnored private let serverURL: () -> URL
    @ObservationIgnored private let allowsEmulator: Bool
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var credentials: AuthCredentials?
    /// The sign-in or refresh in flight. Concurrent callers wait for it instead of starting their own.
    @ObservationIgnored private var inFlight: Task<AuthCredentials, any Error>?

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Auth")

    init(
        store: any CredentialStore,
        transport: @escaping HTTPTransport = HTTP.transport,
        serverURL: @escaping () -> URL,
        allowsEmulator: Bool = AuthSession.isDebugBuild,
        now: @escaping () -> Date = { .now }
    ) {
        self.store = store
        self.transport = transport
        self.serverURL = serverURL
        self.allowsEmulator = allowsEmulator
        self.now = now
        let saved = store.load()
        credentials = saved
        state = saved.map { .signedIn(uid: $0.uid, tokenExpiresAt: $0.expiresAt) } ?? .signedOut
    }

    /// Call at launch and when the app returns to the foreground. Drops a saved account that belongs to
    /// a different Firebase project than the server's (the server URL changed), then makes sure a usable
    /// token exists. Failures land in `state`; a saved account survives being offline.
    func start() async {
        let config: ClientConfig
        do {
            config = try await fetchConfig()
        } catch {
            if credentials == nil { state = .failed(error) }
            return
        }
        if let current = credentials, !current.belongs(to: config.firebase) {
            Self.logger.notice("Server uses another Firebase project; signing in again")
            replace(with: nil)
        } else if let current = credentials, current.apiKey != config.firebase.apiKey {
            Self.logger.notice("Server has a new API key; keeping the account")
            replace(with: current.rekeyed(to: config.firebase))
        }
        _ = try? await validCredentials(forceRefresh: false, config: config)
    }

    /// An ID token for the `Authorization` header. Signs in first when there is no account yet.
    /// Pass `forceRefresh` after the server rejected the last token.
    func idToken(forceRefresh: Bool = false) async throws(AuthError) -> String {
        try await validCredentials(forceRefresh: forceRefresh, config: nil).idToken
    }

    private func validCredentials(forceRefresh: Bool, config: ClientConfig?) async throws(AuthError) -> AuthCredentials {
        if let inFlight {
            return try await Self.value(of: inFlight)
        }
        if !forceRefresh, let credentials, credentials.isFresh(at: now()) {
            return credentials
        }

        let current = credentials
        if current == nil { state = .signingIn }
        let task = Task { try await self.obtain(current: current, config: config) }
        inFlight = task
        defer { inFlight = nil }
        do {
            let fresh = try await Self.value(of: task)
            replace(with: fresh)
            return fresh
        } catch {
            if error == .accountDisabled { replace(with: nil) }
            if credentials == nil { state = .failed(error) }
            throw error
        }
    }

    /// Refreshes the saved account, or creates a new anonymous one when there is none or it is gone.
    /// When Google rejects the saved API key, asks the server for its current key and tries once more.
    private func obtain(current: AuthCredentials?, config: ClientConfig?) async throws(AuthError) -> AuthCredentials {
        if var current {
            do throws(AuthError) {
                do throws(AuthError) {
                    return try await FirebaseAuthAPI(config: current.firebase, transport: transport).refresh(current, now: now())
                } catch .apiKeyRejected {
                    let firebase = try await fetchConfig().firebase
                    guard current.belongs(to: firebase), firebase.apiKey != current.apiKey else { throw .apiKeyRejected }
                    Self.logger.notice("Saved API key was rejected; retrying with the server's current key")
                    current = current.rekeyed(to: firebase)
                    return try await FirebaseAuthAPI(config: current.firebase, transport: transport).refresh(current, now: now())
                }
            } catch {
                guard error == .accountGone else { throw error }
                Self.logger.notice("Saved account is gone; signing in again")
            }
        }
        let firebase: ClientConfig.Firebase
        if let config {
            firebase = config.firebase
        } else {
            firebase = try await fetchConfig().firebase
        }
        // A Release build never trusts an emulator, which signs nothing.
        guard allowsEmulator || firebase.authEmulatorHost == nil else { throw .notConfigured }
        return try await FirebaseAuthAPI(config: firebase, transport: transport).signUpAnonymously(now: now())
    }

    private func fetchConfig() async throws(AuthError) -> ClientConfig {
        var request = URLRequest(url: serverURL().appending(path: ".well-known/fineprint-client.json"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport(request)
        } catch {
            throw .offline
        }
        switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
        case 200: break
        case 404, 503: throw .notConfigured
        case let status: throw .server(status: status)
        }
        do {
            return try JSONDecoder().decode(ClientConfig.self, from: data)
        } catch {
            throw .malformedResponse
        }
    }

    /// Forgets the saved account. The server has just deleted it ("Delete everything"), so its token
    /// is worthless. The next request signs in as a new anonymous user.
    func forgetAccount() {
        inFlight?.cancel()
        inFlight = nil
        replace(with: nil)
    }

    private func replace(with fresh: AuthCredentials?) {
        credentials = fresh
        if let fresh {
            store.save(fresh)
            state = .signedIn(uid: fresh.uid, tokenExpiresAt: fresh.expiresAt)
        } else {
            store.clear()
            state = .signedOut
        }
    }

    private static func value(of task: Task<AuthCredentials, any Error>) async throws(AuthError) -> AuthCredentials {
        do {
            return try await task.value
        } catch let error as AuthError {
            throw error
        } catch {
            throw .offline
        }
    }

    static var isDebugBuild: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
}

extension AuthCredentials {
    var firebase: ClientConfig.Firebase {
        ClientConfig.Firebase(apiKey: apiKey, projectId: projectId, authEmulatorHost: authEmulatorHost)
    }
}

extension AuthSession {
    /// A session for SwiftUI previews that never touches the network or the keychain.
    static func preview(signedIn: Bool = true) -> AuthSession {
        let credentials = AuthCredentials(
            uid: "preview-3fZr9kQ2",
            projectId: "demo-fineprint",
            apiKey: "preview",
            refreshToken: "preview",
            idToken: "preview",
            expiresAt: .now.addingTimeInterval(3600)
        )
        return AuthSession(
            store: InMemoryCredentialStore(signedIn ? credentials : nil),
            transport: { _ in throw URLError(.notConnectedToInternet) },
            serverURL: { ServerURL.defaultURL }
        )
    }
}
