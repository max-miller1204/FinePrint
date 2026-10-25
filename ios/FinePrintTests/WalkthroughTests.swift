import Foundation
import SwiftData
import Testing
@testable import FinePrint

@Suite("Walkthrough model")
struct WalkthroughModelTests {
    @Test func `each preset lists what to check in that room`() {
        let kitchen = WalkthroughRoom(.kitchen).items.map(\.name)
        #expect(kitchen.contains("Appliances"))
        #expect(kitchen.first == "Walls")
        #expect(kitchen.count == 8)
        #expect(!WalkthroughRoom(.hallway).items.map(\.name).contains("Windows"))
        #expect(WalkthroughRoom(.exterior).items.count == 4)
        for preset in RoomPreset.allCases {
            #expect(!preset.checklist.isEmpty)
            #expect(WalkthroughRoom(preset).name == preset.title)
        }
    }

    @Test func `a room the tenant names gets the common checklist`() {
        let porch = WalkthroughRoom(name: "Back porch")
        #expect(porch.preset == nil)
        #expect(porch.items.map(\.name) == WalkthroughRoom.customChecklist)
        #expect(porch.items.allSatisfy { $0.outcome == .open })
    }

    @Test func `room names are trimmed, cut to length, and never empty`() {
        #expect(RoomName.cleaned("  Garage \n") == "Garage")
        #expect(RoomName.cleaned("   ") == nil)
        #expect(RoomName.cleaned(String(repeating: "A", count: 200))?.count == RoomName.maxLength)
        #expect(RoomName.matches("kitchen", "Kitchen"))
        #expect(RoomName.matches("Café", "Cafe"))
        #expect(!RoomName.matches("Kitchen", "Kitchenette"))
    }

    @Test func `progress counts photographed and no damage items`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.hallway), WalkthroughRoom(.exterior)])
        #expect(walkthrough.totalItems == 10)
        #expect(walkthrough.doneItems == 0)
        #expect(!walkthrough.canSeal)

        let hallway = walkthrough.rooms[0]
        walkthrough.recordPhoto(UUID(), room: hallway.id, item: hallway.items[0].id)
        walkthrough.markNoDamage(room: hallway.id, item: hallway.items[1].id)
        #expect(walkthrough.doneItems == 2)
        #expect(walkthrough.openItems == 8)
        #expect(walkthrough.rooms[0].doneCount == 2)
        #expect(!walkthrough.rooms[0].isComplete)
        #expect(walkthrough.canSeal)
    }

    @Test func `marking no damage alone cannot seal, because the manifest signs photos`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.exterior)])
        let room = walkthrough.rooms[0]
        for item in room.items { walkthrough.markNoDamage(room: room.id, item: item.id) }
        #expect(walkthrough.rooms[0].isComplete)
        #expect(!walkthrough.canSeal)
    }

    @Test func `a photographed item stays photographed and keeps every photo`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.exterior)])
        let room = walkthrough.rooms[0]
        let item = room.items[0]
        let first = UUID(), second = UUID()
        walkthrough.recordPhoto(first, room: room.id, item: item.id)
        walkthrough.recordPhoto(second, room: room.id, item: item.id)
        walkthrough.recordPhoto(second, room: room.id, item: item.id)
        walkthrough.markNoDamage(room: room.id, item: item.id)
        walkthrough.reopen(room: room.id, item: item.id)
        let saved = walkthrough.rooms[0].items[0]
        #expect(saved.outcome == .photographed)
        #expect(saved.photoIDs == [first, second])
    }

    @Test func `reopening a no damage item puts it back to not checked`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.exterior)])
        let room = walkthrough.rooms[0]
        walkthrough.markNoDamage(room: room.id, item: room.items[0].id)
        #expect(walkthrough.rooms[0].items[0].outcome == .noDamage)
        walkthrough.reopen(room: room.id, item: room.items[0].id)
        #expect(walkthrough.rooms[0].items[0].outcome == .open)
    }

    @Test func `adding rooms skips a name already in the walkthrough`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.kitchen)])
        walkthrough.add([WalkthroughRoom(name: "kitchen"), WalkthroughRoom(name: "Garage"), WalkthroughRoom(name: "GARAGE")])
        #expect(walkthrough.rooms.map(\.name) == ["Kitchen", "Garage"])
    }

    @Test func `a sealed walkthrough no longer changes`() {
        let walkthrough = Walkthrough(rooms: [WalkthroughRoom(.exterior)])
        let room = walkthrough.rooms[0]
        walkthrough.recordPhoto(UUID(), room: room.id, item: room.items[0].id)
        walkthrough.seal(manifestID: "manifest-1")
        #expect(walkthrough.isSealed)
        #expect(!walkthrough.canSeal)
        walkthrough.recordPhoto(UUID(), room: room.id, item: room.items[1].id)
        walkthrough.markNoDamage(room: room.id, item: room.items[2].id)
        #expect(walkthrough.doneItems == 1)
    }

    @Test func `long and many rooms keep working`() {
        let rooms = (1...40).map { WalkthroughRoom(name: "Room \($0) " + String(repeating: "x", count: 50)) }
        let walkthrough = Walkthrough(rooms: rooms)
        #expect(walkthrough.totalItems == 40 * WalkthroughRoom.customChecklist.count)
        #expect(Walkthrough(rooms: []).totalItems == 0)
        #expect(!Walkthrough(rooms: []).canSeal)
    }

    @Test func `walkthroughs belong to a rental and the latest unsealed one is current`() throws {
        let container = try ModelContainer(for: Rental.self, Deadline.self, Walkthrough.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        let context = container.mainContext
        let rental = Rental(name: "Home")
        let other = Rental(name: "Other")
        context.insert(rental)
        context.insert(other)
        #expect(rental.currentWalkthrough == nil)

        let sealed = Walkthrough(createdAt: Date(timeIntervalSince1970: 100), rooms: [WalkthroughRoom(.kitchen)])
        context.insert(sealed)
        sealed.rental = rental
        sealed.seal(manifestID: "m")
        #expect(rental.currentWalkthrough?.id == sealed.id)

        let open = Walkthrough(createdAt: Date(timeIntervalSince1970: 50), rooms: [WalkthroughRoom(.hallway)])
        context.insert(open)
        open.rental = rental
        #expect(rental.currentWalkthrough?.id == open.id)
        #expect(other.currentWalkthrough == nil)

        // The rooms and their progress persist with the rental, and go with it.
        walkthroughProgress(open)
        try context.save()
        let saved = try context.fetch(FetchDescriptor<Walkthrough>())
        #expect(saved.count == 2)
        #expect(saved.first { $0.id == open.id }?.doneItems == 1)
        context.delete(rental)
        try context.save()
        #expect(try context.fetch(FetchDescriptor<Walkthrough>()).isEmpty)
    }

    private func walkthroughProgress(_ walkthrough: Walkthrough) {
        let room = walkthrough.rooms[0]
        walkthrough.markNoDamage(room: room.id, item: room.items[0].id)
    }
}

private func day(_ year: Int, _ month: Int, _ day: Int) -> CalendarDay {
    CalendarDay(year: year, month: month, day: day)
}

@Suite("Landlord report clock from the seal")
struct MoveInReportClockTests {
    let container: ModelContainer
    let scheduler = FakeReminderScheduler()
    var newYork: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }
    let now = Date(timeIntervalSince1970: 1_786_000_000)

    init() throws {
        container = try ModelContainer(for: Rental.self, Deadline.self, Walkthrough.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    func makeStore() -> DeadlineStore {
        DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty), modelContext: container.mainContext, scheduler: scheduler, now: now, calendar: newYork, arguments: [])
    }

    @Test func `sealing starts the 5-day clock from the walkthrough day when the rental has no occupancy date`() async {
        let store = makeStore()
        let rental = Rental(name: "Home", phase: .living)
        container.mainContext.insert(rental)

        let deadline = store.startMoveInReportClock(for: rental, occupancyFallback: day(2026, 8, 14), now: now)
        await store.pendingWork?.value

        #expect(deadline.kind == .moveInReport)
        #expect(deadline.startDay == day(2026, 8, 14))
        #expect(deadline.dueDay == day(2026, 8, 19))
        #expect(store.activeDeadlines.map(\.kind) == [.moveInReport])
        #expect(rental.deadlines.count == 1)
        // The clock is in-app work, so it never asks for notification permission.
        #expect(scheduler.requestCount == 0)
    }

    @Test func `the rental's occupancy date wins over the walkthrough day`() {
        let store = makeStore()
        let rental = Rental(name: "Home", phase: .moveIn, occupancyDate: day(2026, 8, 10))
        container.mainContext.insert(rental)
        let deadline = store.startMoveInReportClock(for: rental, occupancyFallback: day(2026, 8, 14), now: now)
        #expect(deadline.startDay == day(2026, 8, 10))
        #expect(deadline.dueDay == day(2026, 8, 15))
    }

    @Test func `a rental that already has the clock keeps it, running or closed`() {
        let store = makeStore()
        let rental = Rental(name: "Home", phase: .moveIn, occupancyDate: day(2026, 8, 10))
        container.mainContext.insert(rental)
        store.seedInitialDeadlines(for: rental, now: now)
        let seeded = store.deadlines.first
        #expect(store.startMoveInReportClock(for: rental, occupancyFallback: day(2026, 8, 14), now: now).id == seeded?.id)
        #expect(store.deadlines.count == 1)

        seeded?.completedAt = now
        #expect(store.startMoveInReportClock(for: rental, occupancyFallback: day(2026, 8, 14), now: now).completedAt != nil)
        #expect(store.deadlines.count == 1)
    }

    @Test func `the clock belongs to the rental that was sealed`() {
        let store = makeStore()
        let first = Rental(name: "Richmond")
        let second = Rental(name: "Norfolk", selectedAt: now)
        container.mainContext.insert(first)
        container.mainContext.insert(second)
        store.startMoveInReportClock(for: first, occupancyFallback: day(2026, 8, 14), now: now)
        #expect(first.deadlines.count == 1)
        #expect(second.deadlines.isEmpty)
    }
}

@Suite("Sealing a walkthrough")
struct MoveInSealerTests {
    final class FakeSealer: Sealing {
        var results: [Result<SealReceipt, APIError>] = []
        private(set) var calls: [String] = []

        func seal(rentalServerID: String) async throws(APIError) -> SealReceipt {
            calls.append(rentalServerID)
            if results.isEmpty { return SealReceipt(manifest: .init(manifestId: "manifest-1", sha256: "abc"), pending: 0) }
            return try results.removeFirst().get()
        }
    }

    let container: ModelContainer
    let store = EvidenceStore(root: URL.temporaryDirectory.appending(path: "SealerTests-\(UUID().uuidString)", directoryHint: .isDirectory))
    let uploader = FakeUploader()
    let resolver = FakeRentals()
    let network = FakeNetwork()
    let server = FakeSealer()
    let rental: Rental
    let walkthrough: Walkthrough
    let deadlines: DeadlineStore

    init() throws {
        container = try ModelContainer(for: Rental.self, Deadline.self, Walkthrough.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        rental = Rental(name: "Home", serverID: "rental-1", phase: .living)
        container.mainContext.insert(rental)
        walkthrough = Walkthrough(rooms: [WalkthroughRoom(.exterior)])
        container.mainContext.insert(walkthrough)
        walkthrough.rental = rental
        resolver.serverIDs[rental.id] = "rental-1"
        deadlines = DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty), modelContext: container.mainContext, scheduler: FakeReminderScheduler(), now: Fixture.now)
    }

    func queue() -> UploadQueue {
        UploadQueue(store: store, uploader: uploader, rentals: resolver, network: network, sleep: { _ in throw CancellationError() })
    }

    /// Keeps a photo for the walkthrough's first item and queues it, as Use Photo does.
    func keepPhoto(in queue: UploadQueue) throws -> UUID {
        let original = Data(UUID().uuidString.utf8)
        let record = CaptureRecord(
            itemID: UUID(), rentalID: rental.id, sha256: EvidenceHash.sha256Hex(of: original), bytes: original.count,
            mime: "image/jpeg", capturedAtDevice: "2027-01-15T03:00:00-05:00", deviceUptimeMs: 1,
            source: .inAppCamera, room: "Exterior", checklistItem: "Walls", appVersion: "1.0.0 (1)"
        )
        let files = try store.save(original: original, modelCopy: Data(), record: record)
        queue.enqueue(record, original: files.original)
        let room = walkthrough.rooms[0]
        walkthrough.recordPhoto(record.itemID, room: room.id, item: room.items[0].id)
        return record.itemID
    }

    @Test func `sealing uploads what waits, signs, marks photos sealed, and starts the landlord clock`() async throws {
        let queue = queue()
        let photo = try keepPhoto(in: queue)
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })

        // The test drives the uploads itself, as the queue's own task would.
        await queue.drain()
        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)

        #expect(sealer.phase == .sealed)
        #expect(server.calls == ["rental-1"])
        #expect(queue.status(for: photo) == .sealed)
        #expect(walkthrough.isSealed)
        #expect(walkthrough.manifestID == "manifest-1")
        #expect(sealer.leftOutCount == 0)
        #expect(rental.deadlines.map(\.kind) == [.moveInReport])
        #expect(rental.deadlines.first?.dueDay == rental.deadlines.first?.kind.dueDay(from: walkthrough.startDay()))
    }

    @Test func `a seal tapped before the upload finishes waits for it`() async throws {
        let queue = queue()
        let photo = try keepPhoto(in: queue)
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })
        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)
        // resume() starts the pass, and the sealer polls until the photo is received.
        #expect(sealer.phase == .sealed)
        #expect(queue.status(for: photo) == .sealed)
    }

    @Test func `offline, the seal waits for a connection and starts no clock`() async throws {
        let queue = queue()
        network.isOnline = false
        _ = try keepPhoto(in: queue)
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })

        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)

        #expect(sealer.phase == .failed(.offline))
        #expect(server.calls.isEmpty)
        #expect(!walkthrough.isSealed)
        #expect(rental.deadlines.isEmpty)
        sealer.dismissFailure()
        #expect(sealer.phase == .idle)
    }

    @Test func `a server error leaves the walkthrough open to try again`() async throws {
        let queue = queue()
        _ = try keepPhoto(in: queue)
        await queue.drain()
        server.results = [.failure(.server(status: 503, code: "DEPENDENCY_UNAVAILABLE")), .success(SealReceipt(manifest: .init(manifestId: "m2", sha256: "x"), pending: 0))]
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })

        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)
        #expect(sealer.phase == .failed(.server(.server(status: 503, code: "DEPENDENCY_UNAVAILABLE"))))
        #expect(!walkthrough.isSealed)
        #expect(rental.deadlines.isEmpty)

        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)
        #expect(sealer.phase == .sealed)
        #expect(walkthrough.manifestID == "m2")
        #expect(rental.deadlines.count == 1)
    }

    @Test func `a seal with no photos does nothing`() async {
        let queue = queue()
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })
        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)
        #expect(sealer.phase == .idle)
        #expect(server.calls.isEmpty)
    }

    @Test func `photos the server refused are left out and counted`() async throws {
        let queue = queue()
        let good = try keepPhoto(in: queue)
        let bad = try keepPhoto(in: queue)
        uploader.requestReplies = [.success(.received(good)), .failure(.server(status: 403, code: nil))]
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })

        await queue.drain()
        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)

        #expect(sealer.phase == .sealed)
        #expect(sealer.leftOutCount == 1)
        #expect(queue.status(for: good) == .sealed)
        #expect(queue.status(for: bad) == .rejected)
    }

    @Test func `when every photo was refused there is nothing to seal`() async throws {
        let queue = queue()
        _ = try keepPhoto(in: queue)
        uploader.requestReplies = [.failure(.server(status: 403, code: nil))]
        let sealer = MoveInSealer(sleep: { _ in await Task.yield() })
        await queue.drain()
        await sealer.seal(walkthrough, uploads: queue, server: server, deadlines: deadlines)
        #expect(sealer.phase == .failed(.nothingToSeal))
        #expect(server.calls.isEmpty)
    }

    @Test func `marking photos sealed survives a relaunch`() async throws {
        let queue = queue()
        let photo = try keepPhoto(in: queue)
        await queue.drain()
        queue.markSealed([photo], manifestID: "manifest-1")
        #expect(self.queue().status(for: photo) == .sealed)
        // A photo still waiting is not in the manifest, so it does not change.
        let waiting = try keepPhoto(in: queue)
        queue.markSealed([waiting], manifestID: "manifest-1")
        #expect(queue.status(for: waiting) == .waiting)
    }

    @Test func `the seal request is session move_in and the receipt decodes`() throws {
        let json = #"{"manifest":{"manifestId":"abc","kind":"move_in","sha256":"d1","keyId":"k"},"ledgerEntry":{"seq":1},"pending":2}"#
        let receipt = try JSONDecoder().decode(SealReceipt.self, from: Data(json.utf8))
        #expect(receipt.manifest.manifestId == "abc")
        #expect(receipt.pending == 2)
    }
}
