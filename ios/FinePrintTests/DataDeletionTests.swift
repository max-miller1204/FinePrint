import Foundation
import SwiftData
import Testing
@testable import FinePrint

@Suite("Settings")
struct UserSettingsTests {
    let defaults: UserDefaults

    init() throws {
        defaults = try #require(UserDefaults(suiteName: "FinePrintTests.\(UUID().uuidString)"))
    }

    @Test func `starts at the standard reading level with the impact count off`() {
        let settings = UserSettings(defaults: defaults)
        #expect(settings.readingLevel == .standard)
        #expect(settings.impactOptIn == false)
    }

    @Test func `choices persist across instances`() {
        let first = UserSettings(defaults: defaults)
        first.language = .spanish
        first.readingLevel = .simpler
        first.impactOptIn = true

        let second = UserSettings(defaults: defaults)
        #expect(second.language == .spanish)
        #expect(second.readingLevel == .simpler)
        #expect(second.impactOptIn == true)
    }

    @Test func `the language is the one onboarding stores`() {
        AppLanguage.spanish.store(in: defaults)
        #expect(UserSettings(defaults: defaults).language == .spanish)
    }

    @Test func `reset forgets every saved choice`() {
        let settings = UserSettings(defaults: defaults)
        settings.language = .spanish
        settings.readingLevel = .simpler
        settings.impactOptIn = true

        settings.reset()
        #expect(settings.readingLevel == .standard)
        #expect(settings.impactOptIn == false)
        for key in [AppLanguage.storedKey, UserSettings.readingLevelKey, UserSettings.impactOptInKey] {
            #expect(defaults.object(forKey: key) == nil)
        }
    }
}

@Suite("Delete everything")
struct DataDeletionTests {
    let reply = StubHTTP.Reply(status: 200, body: #"{"deletedAt":"2026-10-24T21:15:30.250Z","rentals":2,"evidenceItems":5}"#)

    func client(_ http: StubHTTP) -> APIClient {
        let auth = AuthSession(store: InMemoryCredentialStore(Fixture.credentials()), transport: http.transport, serverURL: { Fixture.server }, now: { Fixture.now })
        return APIClient(auth: auth, serverURL: Fixture.server, transport: http.transport)
    }

    @Test func `deletes on the server, then the device, and keeps a receipt`() async throws {
        let http = StubHTTP(["me": [reply]])
        let deletion = DataDeletion()
        var erased = 0

        await deletion.deleteEverything(client: client(http)) {
            LocalErasure(rentals: 1, photos: 3)
        } erase: {
            erased += 1
        }

        let request = try #require(http.requests(to: "me").first)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path() == "/v1/me")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
        // The device is cleared once the receipt is on screen, not before.
        #expect(erased == 0)
        deletion.receiptDidAppear()
        deletion.receiptDidAppear()
        #expect(erased == 1)
        #expect(deletion.phase == .idle)
        let receipt = try #require(deletion.receipt)
        #expect(receipt.serverRentals == 2)
        #expect(receipt.serverPhotos == 5)
        #expect(receipt.deviceRentals == 1)
        #expect(receipt.devicePhotos == 3)
        #expect(receipt.deletedAt == Date(timeIntervalSince1970: 1_792_876_530.25))
    }

    @Test(arguments: [
        StubHTTP.Reply(status: 503, body: #"{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"Storage is unavailable"}}"#),
        StubHTTP.Reply(status: 500, body: #"{"error":{"code":"INTERNAL","message":"Something went wrong"}}"#),
    ])
    func `a server failure leaves the device untouched so the tenant can retry`(failure: StubHTTP.Reply) async {
        let http = StubHTTP(["me": [failure]])
        let deletion = DataDeletion()
        var erased = 0

        await deletion.deleteEverything(client: client(http)) {
            LocalErasure(rentals: 0, photos: 0)
        } erase: {
            erased += 1
        }
        deletion.receiptDidAppear()

        #expect(erased == 0)
        #expect(deletion.receipt == nil)
        guard case .failed(.server(let status, _)) = deletion.phase else {
            Issue.record("Expected a server failure, got \(deletion.phase)")
            return
        }
        #expect(status == failure.status)
    }

    @Test func `offline leaves the device untouched`() async {
        let http = StubHTTP([:])
        let deletion = DataDeletion()
        var erased = 0

        await deletion.deleteEverything(client: client(http)) {
            LocalErasure(rentals: 0, photos: 0)
        } erase: {
            erased += 1
        }
        deletion.receiptDidAppear()

        #expect(erased == 0)
        #expect(deletion.phase == .failed(.offline))
    }

    @Test func `a retry after a failure can succeed`() async {
        let http = StubHTTP(["me": [StubHTTP.Reply(status: 503, body: "{}"), reply]])
        let deletion = DataDeletion()
        let api = client(http)
        await deletion.deleteEverything(client: api) { LocalErasure(rentals: 0, photos: 0) } erase: {}
        #expect(deletion.receipt == nil)
        await deletion.deleteEverything(client: api) { LocalErasure(rentals: 0, photos: 0) } erase: {}
        #expect(deletion.receipt != nil)
        #expect(deletion.phase == .idle)
    }

    @Test func `dismissing the receipt clears it`() async {
        let deletion = DataDeletion()
        await deletion.deleteEverything(client: client(StubHTTP(["me": [reply]]))) { LocalErasure(rentals: 0, photos: 0) } erase: {}
        deletion.dismissReceipt()
        #expect(deletion.receipt == nil)
    }

    @Test func `an unreadable server time falls back to now`() throws {
        let broken = try JSONDecoder().decode(AccountDeletionReply.self, from: Data(#"{"deletedAt":"yesterday","rentals":0,"evidenceItems":0}"#.utf8))
        #expect(broken.date(fallback: Fixture.now) == Fixture.now)
    }
}

@Suite("Erase local data")
struct EraseLocalDataTests {
    let container: ModelContainer
    let scheduler = FakeReminderScheduler(status: .authorized)
    let root: URL
    let defaults: UserDefaults

    init() throws {
        container = try ModelContainer(for: Rental.self, Deadline.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        root = URL.temporaryDirectory.appending(path: "EraseTests-\(UUID().uuidString)", directoryHint: .isDirectory)
        defaults = try #require(UserDefaults(suiteName: "FinePrintTests.\(UUID().uuidString)"))
    }

    @Test func `removes rentals, deadlines, reminders, photos, choices, and the sign-in`() throws {
        let context = container.mainContext
        let deadlines = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty), modelContext: context, scheduler: scheduler, now: Fixture.now)
        for name in ["Richmond", "Norfolk"] {
            let rental = Rental(name: name, phase: .moveIn, occupancyDate: CalendarDay(Fixture.now))
            context.insert(rental)
            deadlines.seedInitialDeadlines(for: rental, now: Fixture.now)
        }
        let reminders = deadlines.deadlines.flatMap(\.reminderIdentifiers)
        #expect(!deadlines.deadlines.isEmpty)

        // Two rentals' worth of photo folders, three captures in all.
        let evidence = EvidenceStore(root: root)
        for path in ["rental-a/photo-1", "rental-a/photo-2", "rental-b/photo-3"] {
            let folder = root.appending(path: path, directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try Data("x".utf8).write(to: folder.appending(path: "original.heic"))
        }
        #expect(evidence.captureCount() == 3)

        let settings = UserSettings(defaults: defaults)
        settings.language = .spanish
        settings.impactOptIn = true
        let auth = AuthSession(store: InMemoryCredentialStore(Fixture.credentials()), transport: StubHTTP([:]).transport, serverURL: { Fixture.server }, now: { Fixture.now })
        #expect(auth.state != .signedOut)

        let result = eraseLocalData(deadlines: deadlines, uploads: nil, evidence: evidence, settings: settings, auth: auth)

        #expect(result == LocalErasure(rentals: 2, photos: 3))
        #expect(try context.fetch(FetchDescriptor<Rental>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<Deadline>()).isEmpty)
        #expect(deadlines.deadlines.isEmpty)
        #expect(Set(reminders).isSubset(of: Set(scheduler.cancelled)))
        #expect(!FileManager.default.fileExists(atPath: root.path(percentEncoded: false)))
        #expect(evidence.captureCount() == 0)
        #expect(settings.impactOptIn == false)
        #expect(defaults.object(forKey: AppLanguage.storedKey) == nil)
        #expect(auth.state == .signedOut)
    }

    @Test func `an empty device erases to zero without error`() {
        let deadlines = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty), modelContext: container.mainContext, scheduler: scheduler, now: Fixture.now)
        let auth = AuthSession(store: InMemoryCredentialStore(), transport: StubHTTP([:]).transport, serverURL: { Fixture.server })
        let result = eraseLocalData(deadlines: deadlines, uploads: nil, evidence: EvidenceStore(root: root), settings: UserSettings(defaults: defaults), auth: auth)
        #expect(result == LocalErasure(rentals: 0, photos: 0))
    }
}
