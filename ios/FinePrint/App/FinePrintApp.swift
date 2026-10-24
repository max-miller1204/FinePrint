import OSLog
import SwiftData
import SwiftUI

@main
struct FinePrintApp: App {
    @State private var configuration: AppConfiguration
    @State private var deadlines: DeadlineStore
    private let modelContainer: ModelContainer

    init() {
        let options = LaunchOptions.current
        _configuration = State(initialValue: AppConfiguration(launchOptions: options))
        _deadlines = State(initialValue: DeadlineStore(launchOptions: options))
        modelContainer = Self.makeModelContainer(inMemory: options.usesInMemoryStore)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(configuration)
                .environment(deadlines)
        }
        .modelContainer(modelContainer)
    }

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Persistence")

    private static func makeModelContainer(inMemory: Bool) -> ModelContainer {
        let schema = Schema([Rental.self])
        do {
            let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: inMemory)
            return try ModelContainer(for: schema, configurations: configuration)
        } catch {
            // A broken on-disk store should not stop the app from opening. Fall back to memory
            // so the tenant can still read their deadlines; nothing is written to disk this launch.
            logger.error("Persistent store failed to open, using memory: \(error.localizedDescription, privacy: .public)")
            do {
                return try ModelContainer(for: schema, configurations: ModelConfiguration(schema: schema, isStoredInMemoryOnly: true))
            } catch {
                fatalError("In-memory SwiftData container failed: \(error)")
            }
        }
    }
}
