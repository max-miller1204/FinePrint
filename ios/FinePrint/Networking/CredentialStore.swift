import Foundation
import OSLog
import Security

/// Where the anonymous account's credentials live between launches.
protocol CredentialStore: AnyObject {
    func load() -> AuthCredentials?
    func save(_ credentials: AuthCredentials)
    func clear()
}

/// The keychain, readable after the first unlock so background uploads can get a token,
/// and never synced or restored to another device.
final class KeychainCredentialStore: CredentialStore {
    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Auth")

    private let service: String
    private let account = "firebase-anonymous"

    init(service: String = "org.fineprint.FinePrint.auth") {
        self.service = service
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> AuthCredentials? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            if status != errSecItemNotFound {
                Self.logger.error("Keychain read failed: \(status, privacy: .public)")
            }
            return nil
        }
        return try? JSONDecoder().decode(AuthCredentials.self, from: data)
    }

    func save(_ credentials: AuthCredentials) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        }
        if status != errSecSuccess {
            Self.logger.error("Keychain write failed: \(status, privacy: .public)")
        }
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// Nothing outlives the process. Used with `-FinePrintInMemoryStore`, under tests, and in previews,
/// so each of those launches signs in as a new anonymous user.
final class InMemoryCredentialStore: CredentialStore {
    private var credentials: AuthCredentials?

    init(_ credentials: AuthCredentials? = nil) {
        self.credentials = credentials
    }

    func load() -> AuthCredentials? { credentials }
    func save(_ credentials: AuthCredentials) { self.credentials = credentials }
    func clear() { credentials = nil }
}
