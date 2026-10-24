import Foundation
import Testing
@testable import FinePrint

@Suite("Server URL validation")
struct ServerURLValidationTests {
    @Test(arguments: [
        ("http://localhost:8080", "http://localhost:8080"),
        ("  https://FinePrint.Example.org/  ", "https://fineprint.example.org"),
        ("HTTP://127.0.0.1:1234", "http://127.0.0.1:1234"),
        ("https://example.org/api/", "https://example.org/api"),
    ])
    func `accepts http and https with a host`(input: String, expected: String) throws {
        let url = try ServerURL.validate(input)
        #expect(url.absoluteString == expected)
    }

    @Test(arguments: [
        ("", ServerURLError.empty),
        ("   ", .empty),
        ("ftp://example.org", .unsupportedScheme),
        ("localhost:8080", .unsupportedScheme),
        ("example.org", .unsupportedScheme),
        ("http://", .missingHost),
        ("https:///path", .missingHost),
        ("http://exa mple.org", .malformed),
        ("https://example.org?debug=1", .malformed),
    ])
    func `rejects invalid addresses`(input: String, expected: ServerURLError) {
        #expect(throws: expected) {
            try ServerURL.validate(input)
        }
    }
}

@Suite("Server URL precedence")
struct ServerURLPrecedenceTests {
    @Test func `launch argument beats the saved value`() {
        let result = ServerURL.resolve(launchArgument: "http://127.0.0.1:1234", stored: "https://saved.example.org")
        #expect(result.url.absoluteString == "http://127.0.0.1:1234")
        #expect(result.source == .launchArgument)
    }

    @Test func `saved value beats the default`() {
        let result = ServerURL.resolve(launchArgument: nil, stored: "https://saved.example.org")
        #expect(result.url.absoluteString == "https://saved.example.org")
        #expect(result.source == .developerMenu)
    }

    @Test func `invalid launch argument falls back to the saved value`() {
        let result = ServerURL.resolve(launchArgument: "not a url", stored: "https://saved.example.org")
        #expect(result.source == .developerMenu)
    }

    @Test func `nothing set uses the default`() {
        let result = ServerURL.resolve(launchArgument: nil, stored: nil)
        #expect(result.url == ServerURL.defaultURL)
        #expect(result.source == .builtInDefault)
    }
}

@Suite("App configuration")
struct AppConfigurationTests {
    let defaults: UserDefaults

    init() throws {
        defaults = try #require(UserDefaults(suiteName: "FinePrintTests.\(UUID().uuidString)"))
    }

    @Test func `saving persists across instances and reset clears it`() throws {
        let first = AppConfiguration(launchOptions: LaunchOptions(), defaults: defaults)
        try first.saveServerURL("https://org.example.org/")
        #expect(first.serverURL.absoluteString == "https://org.example.org")

        let second = AppConfiguration(launchOptions: LaunchOptions(), defaults: defaults)
        #expect(second.serverURL.absoluteString == "https://org.example.org")
        #expect(second.serverURLSource == .developerMenu)

        second.resetServerURL()
        #expect(second.serverURL == ServerURL.defaultURL)
        #expect(AppConfiguration(launchOptions: LaunchOptions(), defaults: defaults).storedServerURL == nil)
    }

    @Test func `invalid input is not saved`() {
        let configuration = AppConfiguration(launchOptions: LaunchOptions(), defaults: defaults)
        #expect(throws: ServerURLError.unsupportedScheme) {
            try configuration.saveServerURL("ftp://example.org")
        }
        #expect(configuration.storedServerURL == nil)
    }

    #if DEBUG
    @Test func `developer menu launch argument shows the menu without saving it`() {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintDeveloperMenu"], environment: [:])
        #expect(AppConfiguration(launchOptions: options, defaults: defaults).isDeveloperMenuUnlocked)
        #expect(!AppConfiguration(launchOptions: LaunchOptions(), defaults: defaults).isDeveloperMenuUnlocked)
    }
    #endif

    @Test func `launch argument wins over a saved value`() throws {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintServerURL", "http://127.0.0.1:1234"], environment: [:])
        let configuration = AppConfiguration(launchOptions: options, defaults: defaults)
        try configuration.saveServerURL("https://saved.example.org")
        #expect(configuration.serverURL.absoluteString == "http://127.0.0.1:1234")
        #expect(configuration.serverURLSource == .launchArgument)
    }
}
