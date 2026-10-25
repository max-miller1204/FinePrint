import OSLog
import SwiftData
import SwiftUI

@main
struct FinePrintApp: App {
    @State private var configuration: AppConfiguration
    @State private var deadlines: DeadlineStore
    @State private var auth: AuthSession
    @Environment(\.scenePhase) private var scenePhase
    private let signsInAutomatically: Bool
    private let modelContainer: ModelContainer
    private let evidenceStore: EvidenceStore

    init() {
        let options = LaunchOptions.current
        let configuration = AppConfiguration(launchOptions: options)
        _configuration = State(initialValue: configuration)
        _deadlines = State(initialValue: DeadlineStore(launchOptions: options))
        _auth = State(initialValue: AuthSession(
            store: options.usesInMemoryStore ? InMemoryCredentialStore() : KeychainCredentialStore(),
            serverURL: { configuration.serverURL }
        ))
        signsInAutomatically = !options.isRunningTests
        modelContainer = Self.makeModelContainer(inMemory: options.usesInMemoryStore)
        evidenceStore = EvidenceStore.live(inMemory: options.usesInMemoryStore)
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(configuration)
                .environment(deadlines)
                .environment(auth)
                .environment(\.evidenceStore, evidenceStore)
                // First launch signs in anonymously with no input; later launches reuse the account.
                .task {
                    guard signsInAutomatically else { return }
                    await auth.start()
                }
        }
        .modelContainer(modelContainer)
        .onChange(of: scenePhase) { _, phase in
            // Retry a sign-in that failed while offline once the tenant comes back.
            guard signsInAutomatically, phase == .active, case .failed = auth.state else { return }
            Task { await auth.start() }
        }
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
