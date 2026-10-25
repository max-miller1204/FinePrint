import Foundation

/// Options read once from the process arguments at launch.
///
/// Arguments use a `-FinePrint` prefix, matching `-FinePrintFixtureCamera` in the spec:
/// - `-FinePrintServerURL <url>` overrides the server URL for this launch only.
/// - `-FinePrintInMemoryStore` keeps SwiftData and the sign-in in memory (also on automatically under tests).
/// - `-FinePrintDeadlineStub present|empty` (DEBUG builds) forces the sample deadline on or off.
/// - `-FinePrintDeveloperMenu` (DEBUG builds) shows the developer menu for this launch, so UI tests
///   need not race the five-tap unlock.
/// - `-FinePrintFixtureCamera <dir>` (DEBUG builds) feeds the photos in `<dir>` through the capture
///   pipeline in place of the camera, for simulator e2e (spec §12.1).
/// - `-FinePrintFixtureLease <pdf>` (DEBUG builds) reads this PDF when the tenant taps Scan Lease or
///   Import PDF, in place of the document camera and the file picker, for simulator e2e.
/// - `-FinePrintStubFindings <count>` (DEBUG builds) plays a made-up check with `<count>` findings
///   when the tenant taps Check My Lease, in place of the server and the model (`LeaseAnalysisStub`).
/// - `-FinePrintSkipOnboarding` (DEBUG builds) starts at the tabs with a default Virginia rental, so
///   UI tests that are not about onboarding need not walk through it.
/// - `-FinePrintHangWatchdog <file>` (DEBUG builds) records main-thread stalls in `<file>` and stops the
///   app after 10 s, so a frozen screen fails e2e fast with a stack (`HangWatchdog`).
nonisolated struct LaunchOptions: Equatable, Sendable {
    enum DeadlineStub: String, Equatable, Sendable {
        case present
        case empty
    }

    static let serverURLArgument = "-FinePrintServerURL"
    static let inMemoryStoreArgument = "-FinePrintInMemoryStore"
    static let deadlineStubArgument = "-FinePrintDeadlineStub"
    static let developerMenuArgument = "-FinePrintDeveloperMenu"
    #if DEBUG
    static let fixtureCameraArgument = "-FinePrintFixtureCamera"
    static let skipOnboardingArgument = "-FinePrintSkipOnboarding"
    static let fixtureLeaseArgument = "-FinePrintFixtureLease"
    static let stubFindingsArgument = "-FinePrintStubFindings"
    static let hangWatchdogArgument = "-FinePrintHangWatchdog"
    #endif

    var serverURLOverride: String?
    var usesInMemoryStore: Bool
    var deadlineStub: DeadlineStub?
    /// Read in DEBUG builds only (see `AppConfiguration`).
    var showsDeveloperMenu: Bool
    /// Read in DEBUG builds only. A folder of photos that stands in for the camera.
    var fixtureCameraDirectory: String?
    /// Read in DEBUG builds only. A PDF that stands in for the document camera and the file picker.
    var fixtureLeaseFile: String?
    /// Read in DEBUG builds only. How many findings the made-up lease check has.
    var stubFindingCount: Int?
    /// Read in DEBUG builds only.
    var skipsOnboarding: Bool
    /// Read in DEBUG builds only. Where `HangWatchdog` records main-thread stalls.
    var hangWatchdogFile: String?
    /// Unit tests host the app; it must not sign in to a server while they run.
    var isRunningTests: Bool

    init(serverURLOverride: String? = nil, usesInMemoryStore: Bool = false, deadlineStub: DeadlineStub? = nil, showsDeveloperMenu: Bool = false, fixtureCameraDirectory: String? = nil, fixtureLeaseFile: String? = nil, stubFindingCount: Int? = nil, skipsOnboarding: Bool = false, hangWatchdogFile: String? = nil, isRunningTests: Bool = false) {
        self.serverURLOverride = serverURLOverride
        self.usesInMemoryStore = usesInMemoryStore
        self.deadlineStub = deadlineStub
        self.showsDeveloperMenu = showsDeveloperMenu
        self.fixtureCameraDirectory = fixtureCameraDirectory
        self.fixtureLeaseFile = fixtureLeaseFile
        self.stubFindingCount = stubFindingCount
        self.skipsOnboarding = skipsOnboarding
        self.hangWatchdogFile = hangWatchdogFile
        self.isRunningTests = isRunningTests
    }

    init(arguments: [String], environment: [String: String]) {
        serverURLOverride = Self.value(after: Self.serverURLArgument, in: arguments)

        let runningTests = environment["XCTestConfigurationFilePath"] != nil
            || environment["XCTestBundlePath"] != nil
            || environment["XCTestSessionIdentifier"] != nil
        isRunningTests = runningTests
        let inMemoryValue = Self.value(after: Self.inMemoryStoreArgument, in: arguments)
        let inMemoryFlag = arguments.contains(Self.inMemoryStoreArgument)
            && !["NO", "no", "false", "0"].contains(inMemoryValue ?? "")
        usesInMemoryStore = runningTests || inMemoryFlag

        deadlineStub = Self.value(after: Self.deadlineStubArgument, in: arguments).flatMap(DeadlineStub.init(rawValue:))
        showsDeveloperMenu = arguments.contains(Self.developerMenuArgument)
        // Not parsed in Release, so these argument strings are not in the binary.
        #if DEBUG
        fixtureCameraDirectory = Self.value(after: Self.fixtureCameraArgument, in: arguments)
        fixtureLeaseFile = Self.value(after: Self.fixtureLeaseArgument, in: arguments)
        stubFindingCount = Self.value(after: Self.stubFindingsArgument, in: arguments).flatMap { Int($0) }.map { max($0, 0) }
        skipsOnboarding = arguments.contains(Self.skipOnboardingArgument)
        hangWatchdogFile = Self.value(after: Self.hangWatchdogArgument, in: arguments)
        #else
        fixtureCameraDirectory = nil
        fixtureLeaseFile = nil
        stubFindingCount = nil
        skipsOnboarding = false
        hangWatchdogFile = nil
        #endif
    }

    static let current = LaunchOptions(
        arguments: ProcessInfo.processInfo.arguments,
        environment: ProcessInfo.processInfo.environment
    )

    /// The argument that follows `flag`, unless it is missing or is another flag.
    private static func value(after flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
            return nil
        }
        let value = arguments[index + 1]
        return value.hasPrefix("-") ? nil : value
    }
}
