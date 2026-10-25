import Foundation

nonisolated enum ServerURLError: Error, Equatable, Sendable {
    case empty
    case malformed
    case unsupportedScheme
    case missingHost

    var message: LocalizedStringResource {
        switch self {
        case .empty: "Enter a server address."
        case .malformed: "This doesn't look like a web address."
        case .unsupportedScheme: "Start the address with http:// or https://."
        case .missingHost: "Add a host name, like localhost or example.org."
        }
    }
}

/// Validation and precedence rules for the FinePrint server address.
nonisolated enum ServerURL {
    /// Where a local Hono server listens during development.
    static let localURL = URL(string: "http://localhost:8080")!

    /// The Info.plist key that carries the built-in default. `ios/Config/Shared.xcconfig` sets
    /// `FINEPRINT_SERVER_URL` per configuration: localhost for Debug, the deployed server for Release
    /// once `ios/Config/Server.xcconfig` names it (spec §15.1 step 6).
    static let infoPlistKey = "FinePrintServerURL"

    /// The default this build ships with: the Info.plist value, else `localURL` when the key is
    /// missing, empty, or not a valid address.
    static let defaultURL = builtInDefault()

    /// Reads the default from an Info.plist dictionary, so tests can pass their own.
    static func builtInDefault(infoDictionary: [String: Any]? = Bundle.main.infoDictionary) -> URL {
        guard let text = infoDictionary?[infoPlistKey] as? String, let url = try? validate(text) else {
            return localURL
        }
        return url
    }

    enum Source: Equatable, Sendable {
        case launchArgument
        case developerMenu
        case builtInDefault
    }

    /// Accepts http or https URLs with a host. Trims whitespace, lowercases the scheme and host,
    /// and drops a trailing slash so stored values compare cleanly.
    static func validate(_ text: String) throws(ServerURLError) -> URL {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw .empty }
        guard var components = URLComponents(string: trimmed) else { throw .malformed }
        guard let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            throw .unsupportedScheme
        }
        guard let host = components.host, !host.isEmpty else { throw .missingHost }
        guard components.query == nil, components.fragment == nil else { throw .malformed }

        components.scheme = scheme
        components.host = host.lowercased()
        while components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        guard let url = components.url else { throw .malformed }
        return url
    }

    /// Launch argument beats the developer-menu value, which beats the built-in default.
    /// Invalid values are skipped rather than trusted.
    static func resolve(launchArgument: String?, stored: String?, builtInDefault: URL = defaultURL) -> (url: URL, source: Source) {
        if let launchArgument, let url = try? validate(launchArgument) {
            return (url, .launchArgument)
        }
        if let stored, let url = try? validate(stored) {
            return (url, .developerMenu)
        }
        return (builtInDefault, .builtInDefault)
    }
}
