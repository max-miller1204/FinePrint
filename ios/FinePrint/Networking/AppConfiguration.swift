import Foundation
import Observation

/// App-wide settings that are not tied to a rental. Backed by `UserDefaults`.
@Observable
final class AppConfiguration {
    static let storedServerURLKey = "FinePrint.serverURL"
    static let developerMenuKey = "FinePrint.developerMenuUnlocked"

    @ObservationIgnored private let defaults: UserDefaults
    /// Set with `-FinePrintServerURL`; applies to this launch only and is never saved.
    let launchServerURL: String?
    private(set) var storedServerURL: String?

    var isDeveloperMenuUnlocked: Bool {
        didSet { defaults.set(isDeveloperMenuUnlocked, forKey: Self.developerMenuKey) }
    }

    init(launchOptions: LaunchOptions, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        launchServerURL = launchOptions.serverURLOverride
        storedServerURL = defaults.string(forKey: Self.storedServerURLKey)
        isDeveloperMenuUnlocked = defaults.bool(forKey: Self.developerMenuKey)
    }

    var serverURL: URL { resolution.url }
    var serverURLSource: ServerURL.Source { resolution.source }

    private var resolution: (url: URL, source: ServerURL.Source) {
        ServerURL.resolve(launchArgument: launchServerURL, stored: storedServerURL)
    }

    /// Validates and saves an address from the developer menu.
    @discardableResult
    func saveServerURL(_ text: String) throws(ServerURLError) -> URL {
        let url = try ServerURL.validate(text)
        storedServerURL = url.absoluteString
        defaults.set(url.absoluteString, forKey: Self.storedServerURLKey)
        return url
    }

    func resetServerURL() {
        storedServerURL = nil
        defaults.removeObject(forKey: Self.storedServerURLKey)
    }
}

extension AppConfiguration {
    /// An isolated configuration for SwiftUI previews, so previews never touch real settings.
    static func preview(launchOptions: LaunchOptions = LaunchOptions()) -> AppConfiguration {
        let defaults = UserDefaults(suiteName: "FinePrint.preview") ?? .standard
        return AppConfiguration(launchOptions: launchOptions, defaults: defaults)
    }
}
