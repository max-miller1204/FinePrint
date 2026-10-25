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
    #if DEBUG
    /// Set with `-FinePrintFixtureCamera`: a folder of photos that stands in for the camera.
    let fixtureCameraDirectory: URL?
    /// Set with `-FinePrintFixtureLease`: a PDF that stands in for the document camera and the file picker.
    let fixtureLeaseFile: URL?
    /// Set with `-FinePrintStubFindings`: Check My Lease plays a made-up check with this many findings.
    let stubFindingCount: Int?
    #endif

    var isDeveloperMenuUnlocked: Bool {
        didSet { defaults.set(isDeveloperMenuUnlocked, forKey: Self.developerMenuKey) }
    }

    init(launchOptions: LaunchOptions, defaults: UserDefaults = .standard) {
        self.defaults = defaults
        launchServerURL = launchOptions.serverURLOverride
        #if DEBUG
        fixtureCameraDirectory = launchOptions.fixtureCameraDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
        fixtureLeaseFile = launchOptions.fixtureLeaseFile.map { URL(fileURLWithPath: $0, isDirectory: false) }
        stubFindingCount = launchOptions.stubFindingCount
        #endif
        storedServerURL = defaults.string(forKey: Self.storedServerURLKey)
        // `-FinePrintDeveloperMenu` applies to this launch only. One assignment, so `didSet` never
        // runs and nothing is saved.
        isDeveloperMenuUnlocked = defaults.bool(forKey: Self.developerMenuKey) || Self.debugShowsDeveloperMenu(launchOptions)
    }

    private static func debugShowsDeveloperMenu(_ launchOptions: LaunchOptions) -> Bool {
        #if DEBUG
        launchOptions.showsDeveloperMenu
        #else
        false
        #endif
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
