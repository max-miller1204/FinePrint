import Foundation

/// Options read once from the process arguments at launch.
///
/// Arguments use a `-FinePrint` prefix, matching `-FinePrintFixtureCamera` in the spec:
/// - `-FinePrintServerURL <url>` overrides the server URL for this launch only.
/// - `-FinePrintInMemoryStore` keeps SwiftData in memory (also on automatically under tests).
/// - `-FinePrintDeadlineStub present|empty` (DEBUG builds) forces the sample deadline on or off.
nonisolated struct LaunchOptions: Equatable, Sendable {
    enum DeadlineStub: String, Equatable, Sendable {
        case present
        case empty
    }

    static let serverURLArgument = "-FinePrintServerURL"
    static let inMemoryStoreArgument = "-FinePrintInMemoryStore"
    static let deadlineStubArgument = "-FinePrintDeadlineStub"

    var serverURLOverride: String?
    var usesInMemoryStore: Bool
    var deadlineStub: DeadlineStub?

    init(serverURLOverride: String? = nil, usesInMemoryStore: Bool = false, deadlineStub: DeadlineStub? = nil) {
        self.serverURLOverride = serverURLOverride
        self.usesInMemoryStore = usesInMemoryStore
        self.deadlineStub = deadlineStub
    }

    init(arguments: [String], environment: [String: String]) {
        serverURLOverride = Self.value(after: Self.serverURLArgument, in: arguments)

        let runningTests = environment["XCTestConfigurationFilePath"] != nil
            || environment["XCTestBundlePath"] != nil
            || environment["XCTestSessionIdentifier"] != nil
        let inMemoryValue = Self.value(after: Self.inMemoryStoreArgument, in: arguments)
        let inMemoryFlag = arguments.contains(Self.inMemoryStoreArgument)
            && !["NO", "no", "false", "0"].contains(inMemoryValue ?? "")
        usesInMemoryStore = runningTests || inMemoryFlag

        deadlineStub = Self.value(after: Self.deadlineStubArgument, in: arguments).flatMap(DeadlineStub.init(rawValue:))
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
