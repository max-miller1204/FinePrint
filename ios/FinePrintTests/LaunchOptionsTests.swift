import Testing
@testable import FinePrint

@Suite("Launch options")
struct LaunchOptionsTests {
    @Test func `reads every argument`() {
        let options = LaunchOptions(
            arguments: ["FinePrint", "-FinePrintServerURL", "http://127.0.0.1:1234", "-FinePrintInMemoryStore", "-FinePrintDeadlineStub", "empty", "-FinePrintDeveloperMenu", "-FinePrintFixtureCamera", "Fixtures/move-in", "-FinePrintSkipOnboarding", "-FinePrintHangWatchdog", "/tmp/hangs.log"],
            environment: [:]
        )
        #expect(options.serverURLOverride == "http://127.0.0.1:1234")
        #expect(options.usesInMemoryStore)
        #expect(options.deadlineStub == .empty)
        #expect(options.showsDeveloperMenu)
        #expect(options.fixtureCameraDirectory == "Fixtures/move-in")
        #expect(options.skipsOnboarding)
        #expect(options.hangWatchdogFile == "/tmp/hangs.log")
    }

    @Test func `defaults when nothing is passed`() {
        let options = LaunchOptions(arguments: ["FinePrint"], environment: [:])
        #expect(options.serverURLOverride == nil)
        #expect(!options.usesInMemoryStore)
        #expect(options.deadlineStub == nil)
        #expect(!options.isRunningTests)
        #expect(!options.showsDeveloperMenu)
        #expect(options.fixtureCameraDirectory == nil)
        #expect(!options.skipsOnboarding)
        #expect(options.hangWatchdogFile == nil)
    }

    @Test func `a missing value is ignored`() {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintServerURL", "-FinePrintInMemoryStore"], environment: [:])
        #expect(options.serverURLOverride == nil)
        #expect(options.usesInMemoryStore)
    }

    @Test func `in-memory store can be turned off explicitly`() {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintInMemoryStore", "NO"], environment: [:])
        #expect(!options.usesInMemoryStore)
    }

    @Test func `tests always use the in-memory store`() {
        let options = LaunchOptions(arguments: ["FinePrint"], environment: ["XCTestConfigurationFilePath": "/tmp/x"])
        #expect(options.usesInMemoryStore)
        #expect(options.isRunningTests)
    }

    @Test func `this test process runs in memory`() {
        #expect(LaunchOptions.current.usesInMemoryStore)
    }
}
