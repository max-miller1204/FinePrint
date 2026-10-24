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
    static let defaultURL = URL(string: "http://localhost:8080")!

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
    static func resolve(launchArgument: String?, stored: String?) -> (url: URL, source: Source) {
        if let launchArgument, let url = try? validate(launchArgument) {
            return (url, .launchArgument)
        }
        if let stored, let url = try? validate(stored) {
            return (url, .developerMenu)
        }
        return (defaultURL, .builtInDefault)
    }
}
