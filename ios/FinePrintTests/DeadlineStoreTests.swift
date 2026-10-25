import Foundation
import SwiftData
import Testing
@testable import FinePrint

/// Records what would be scheduled, and every permission request.
final class FakeReminderScheduler: ReminderScheduling {
    var status: NotificationAuthorization
    /// What the tenant answers when the prompt shows.
    var answer: NotificationAuthorization
    private(set) var requestCount = 0
    private(set) var scheduled: [String: DeadlineReminder] = [:]
    private(set) var cancelled: [String] = []

    init(status: NotificationAuthorization = .notDetermined, answer: NotificationAuthorization = .authorized) {
        self.status = status
        self.answer = answer
    }

    func authorization() async -> NotificationAuthorization { status }

    func requestAuthorization() async -> NotificationAuthorization {
        requestCount += 1
        if status == .notDetermined { status = answer }
        return status
    }

    func schedule(_ reminders: [DeadlineReminder]) async {
        for reminder in reminders { scheduled[reminder.identifier] = reminder }
    }

    func cancel(identifiers: [String]) {
        cancelled += identifiers
        for identifier in identifiers { scheduled[identifier] = nil }
    }
}

private func calendar(_ identifier: String) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: identifier)!
    return calendar
}

private func day(_ year: Int, _ month: Int, _ day: Int) -> CalendarDay {
    CalendarDay(year: year, month: month, day: day)
}

nonisolated private let zones = ["America/New_York", "Pacific/Honolulu", "Asia/Tokyo"]

@Suite("Deadline math")
struct DeadlineMathTests {
    @Test func `each clock has its statutory length`() {
        #expect(DeadlineKind.moveInReport.dueDay(from: day(2026, 8, 14)) == day(2026, 8, 19))
        #expect(DeadlineKind.objection.dueDay(from: day(2026, 8, 30)) == day(2026, 9, 4))
        #expect(DeadlineKind.depositItemization.dueDay(from: day(2026, 12, 31)) == day(2027, 2, 14))
        #expect(DeadlineKind.depositItemization.dueDay(from: day(2028, 1, 31)) == day(2028, 3, 16))
        #expect(DeadlineKind.moveInReport.dueDay(from: day(2028, 2, 26)) == day(2028, 3, 2))
    }

    @Test func `day counts are signed`() {
        #expect(day(2026, 8, 14).days(until: day(2026, 8, 19)) == 5)
        #expect(day(2026, 8, 19).days(until: day(2026, 8, 14)) == -5)
        #expect(day(2026, 12, 30).days(until: day(2027, 1, 2)) == 3)
    }

    @Test(arguments: zones)
    func `the due day is the same in every time zone`(zone: String) {
        // Occupancy is a calendar date, so the clock never shifts with the device's zone.
        let deadline = Deadline(kind: .moveInReport, startDay: day(2026, 8, 14))
        #expect(deadline.dueDay == day(2026, 8, 19))
        let local = calendar(zone)
        let morning = local.date(from: DateComponents(year: 2026, month: 8, day: 17, hour: 0, minute: 30))!
        let night = local.date(from: DateComponents(year: 2026, month: 8, day: 17, hour: 23, minute: 59))!
        let countdown = NextDeadline(title: "", dueDay: deadline.dueDay)
        #expect(countdown.countdown(from: morning, calendar: local) == .daysLeft(2))
        #expect(countdown.countdown(from: night, calendar: local) == .daysLeft(2))
    }

    @Test func `one instant is a different day in different zones`() {
        // 03:00 UTC on Aug 15 is the evening of Aug 14 in New York and Honolulu, noon Aug 15 in Tokyo.
        let instant = Date(timeIntervalSince1970: 1_786_762_800)
        let due = NextDeadline(title: "", dueDay: day(2026, 8, 17))
        #expect(due.countdown(from: instant, calendar: calendar("America/New_York")) == .daysLeft(3))
        #expect(due.countdown(from: instant, calendar: calendar("Pacific/Honolulu")) == .daysLeft(3))
        #expect(due.countdown(from: instant, calendar: calendar("Asia/Tokyo")) == .daysLeft(2))
    }

    @Test func `spring forward does not lose a day`() {
        // US daylight saving starts 2026-03-08 at 2 a.m.; that day is 23 hours long.
        let newYork = calendar("America/New_York")
        let deadline = Deadline(kind: .moveInReport, startDay: day(2026, 3, 5))
        #expect(deadline.dueDay == day(2026, 3, 10))
        let next = DeadlineStore.snapshot(deadline)
        let beforeChange = newYork.date(from: DateComponents(year: 2026, month: 3, day: 7, hour: 23, minute: 30))!
        let afterChange = newYork.date(from: DateComponents(year: 2026, month: 3, day: 8, hour: 3, minute: 30))!
        #expect(next.countdown(from: beforeChange, calendar: newYork) == .daysLeft(3))
        #expect(next.countdown(from: afterChange, calendar: newYork) == .daysLeft(2))
        let lastDay = newYork.date(from: DateComponents(year: 2026, month: 3, day: 10, hour: 23, minute: 59))!
        #expect(next.countdown(from: lastDay, calendar: newYork) == .dueToday)
    }

    @Test func `fall back does not add a day`() {
        // US daylight saving ends 2026-11-01 at 2 a.m.; that day is 25 hours long.
        let newYork = calendar("America/New_York")
        let deadline = Deadline(kind: .objection, startDay: day(2026, 10, 29))
        #expect(deadline.dueDay == day(2026, 11, 3))
        let next = DeadlineStore.snapshot(deadline)
        let lateOnChangeDay = newYork.date(from: DateComponents(year: 2026, month: 11, day: 1, hour: 23, minute: 30))!
        #expect(next.countdown(from: lateOnChangeDay, calendar: newYork) == .daysLeft(2))
        let pastDue = newYork.date(from: DateComponents(year: 2026, month: 11, day: 4, hour: 0, minute: 1))!
        #expect(next.countdown(from: pastDue, calendar: newYork) == .pastDue)
    }

    @Test(arguments: zones)
    func `reminders fire at 9 a.m. local on day 3 and day 4`(zone: String) throws {
        let local = calendar(zone)
        let deadline = Deadline(kind: .objection, startDay: day(2026, 8, 14))
        let start = local.date(from: DateComponents(year: 2026, month: 8, day: 14, hour: 10))!
        let reminders = deadline.reminders(after: start, calendar: local)
        #expect(reminders.map(\.day) == [day(2026, 8, 17), day(2026, 8, 18)])
        for reminder in reminders {
            #expect(reminder.dateComponents.hour == 9)
            #expect(reminder.dateComponents.minute == 0)
            #expect(reminder.dateComponents.timeZone == nil)
            let fire = try #require(reminder.fireDate(in: local))
            let parts = local.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
            #expect(parts == DateComponents(year: 2026, month: 8, day: reminder.day.day, hour: 9, minute: 0))
        }
        #expect(Set(reminders.map(\.identifier)).count == 2)
    }

    @Test func `reminders across daylight saving stay at 9 a.m.`() throws {
        let newYork = calendar("America/New_York")
        // Day 3 lands on the spring-forward day, day 4 on the fall-back day's neighbor in November.
        for (start, expected) in [(day(2026, 3, 5), [day(2026, 3, 8), day(2026, 3, 9)]), (day(2026, 10, 29), [day(2026, 11, 1), day(2026, 11, 2)])] {
            let deadline = Deadline(kind: .moveInReport, startDay: start)
            let now = try #require(start.startOfDay(in: newYork))
            let reminders = deadline.reminders(after: now, calendar: newYork)
            #expect(reminders.map(\.day) == expected)
            for reminder in reminders {
                let fire = try #require(reminder.fireDate(in: newYork))
                #expect(newYork.component(.hour, from: fire) == 9)
            }
        }
    }

    @Test func `the deposit clock reminds on its last two days`() {
        let deadline = Deadline(kind: .depositItemization, startDay: day(2026, 10, 1))
        let reminders = deadline.reminders(after: .distantPast, calendar: calendar("America/New_York"))
        #expect(deadline.dueDay == day(2026, 11, 15))
        #expect(reminders.map(\.day) == [day(2026, 11, 13), day(2026, 11, 14)])
    }

    @Test func `reminders already past are dropped`() {
        let newYork = calendar("America/New_York")
        let deadline = Deadline(kind: .objection, startDay: day(2026, 8, 14))
        let afterFirst = newYork.date(from: DateComponents(year: 2026, month: 8, day: 17, hour: 9, minute: 1))!
        #expect(deadline.reminders(after: afterFirst, calendar: newYork).map(\.day) == [day(2026, 8, 18)])
        let afterBoth = newYork.date(from: DateComponents(year: 2026, month: 8, day: 18, hour: 10))!
        #expect(deadline.reminders(after: afterBoth, calendar: newYork).isEmpty)
    }
}

@Suite("Accessory source")
struct AccessorySourceTests {
    let today = day(2026, 8, 14)

    func next(_ title: String, _ due: CalendarDay) -> NextDeadline {
        NextDeadline(title: title, dueDay: due)
    }

    @Test func `the soonest upcoming deadline wins`() {
        let picked = DeadlineStore.mostUrgent([next("deposit", day(2026, 9, 20)), next("objection", day(2026, 8, 16)), next("today", day(2026, 8, 14))], today: today)
        #expect(picked?.title == "today")
    }

    @Test func `an upcoming deadline beats one already past`() {
        let picked = DeadlineStore.mostUrgent([next("late", day(2026, 8, 12)), next("objection", day(2026, 8, 18))], today: today)
        #expect(picked?.title == "objection")
    }

    @Test func `a recent past-due deadline still shows`() {
        let picked = DeadlineStore.mostUrgent([next("older", day(2026, 8, 8)), next("late", day(2026, 8, 12))], today: today)
        #expect(picked?.title == "late")
    }

    @Test func `nothing shows once the window has passed`() {
        #expect(DeadlineStore.mostUrgent([next("old", day(2026, 8, 6))], today: today) == nil)
        #expect(DeadlineStore.mostUrgent([], today: today) == nil)
    }

    @Test func `each kind opens its flow`() {
        let navigation = AppNavigation()
        let id = UUID()
        navigation.open(NextDeadline(title: "", dueDay: today, kind: .depositItemization, deadlineID: id))
        #expect(navigation.selectedTab == .evidence)
        #expect(navigation.focusedDeadlineID == id)
        for kind in DeadlineKind.allCases {
            #expect(NextDeadline(title: "", dueDay: today, kind: kind).tab == kind.tab)
        }
        #expect(NextDeadline(title: "", dueDay: today).tab == .evidence)
    }
}

@Suite("Seeding")
struct SeedingTests {
    let today = day(2026, 8, 14)

    @Test func `before signing seeds nothing`() {
        #expect(DeadlineStore.initialDeadlines(phase: .preSigning, occupancy: today, tenancyEnd: nil, today: today).isEmpty)
    }

    @Test func `just moved in starts the landlord's report clock`() {
        let seeded = DeadlineStore.initialDeadlines(phase: .moveIn, occupancy: today, tenancyEnd: nil, today: today)
        #expect(seeded == [SeededDeadline(kind: .moveInReport, start: today)])
    }

    @Test func `living there long after move-in seeds nothing`() {
        #expect(DeadlineStore.initialDeadlines(phase: .living, occupancy: day(2025, 1, 1), tenancyEnd: nil, today: today).isEmpty)
        #expect(DeadlineStore.initialDeadlines(phase: .living, occupancy: nil, tenancyEnd: nil, today: today).isEmpty)
    }

    @Test func `moving out starts the deposit clock only with an end date`() {
        #expect(DeadlineStore.initialDeadlines(phase: .moveOut, occupancy: nil, tenancyEnd: nil, today: today).isEmpty)
        let seeded = DeadlineStore.initialDeadlines(phase: .moveOut, occupancy: nil, tenancyEnd: day(2026, 8, 31), today: today)
        #expect(seeded == [SeededDeadline(kind: .depositItemization, start: day(2026, 8, 31))])
        #expect(DeadlineStore.initialDeadlines(phase: .ended, occupancy: nil, tenancyEnd: day(2026, 1, 1), today: today).isEmpty)
    }
}

@Suite("Deadline store")
struct DeadlineStoreTests {
    let container: ModelContainer
    let scheduler: FakeReminderScheduler
    let newYork = calendar("America/New_York")
    let now: Date

    init() throws {
        container = try ModelContainer(for: Rental.self, Deadline.self, Walkthrough.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        scheduler = FakeReminderScheduler()
        now = newYork.date(from: DateComponents(year: 2026, month: 8, day: 14, hour: 8))!
    }

    func makeStore(stub: LaunchOptions.DeadlineStub? = .empty, arguments: [String] = []) -> DeadlineStore {
        DeadlineStore(
            launchOptions: LaunchOptions(deadlineStub: stub),
            modelContext: container.mainContext,
            scheduler: scheduler,
            now: now,
            calendar: newYork,
            arguments: arguments
        )
    }

    func movedInRental() -> Rental {
        let rental = Rental(name: "Home", phase: .moveIn, occupancyDate: day(2026, 8, 14))
        container.mainContext.insert(rental)
        return rental
    }

    @Test func `seeding never asks for permission`() async {
        let store = makeStore()
        store.seedInitialDeadlines(for: movedInRental(), now: now)
        await store.pendingWork?.value
        #expect(scheduler.requestCount == 0)
        #expect(scheduler.scheduled.isEmpty)
        #expect(store.activeDeadlines.map(\.kind) == [.moveInReport])
        #expect(store.activeDeadlines.first?.dueDay == day(2026, 8, 19))
    }

    @Test func `seeding schedules when permission was already given`() async {
        scheduler.status = .authorized
        let store = makeStore()
        store.seedInitialDeadlines(for: movedInRental(), now: now)
        await store.pendingWork?.value
        #expect(scheduler.requestCount == 0)
        #expect(Set(scheduler.scheduled.values.map(\.day)) == [day(2026, 8, 17), day(2026, 8, 18)])
    }

    @Test func `seeding twice adds nothing twice`() async {
        let store = makeStore()
        let rental = movedInRental()
        store.seedInitialDeadlines(for: rental, now: now)
        store.seedInitialDeadlines(for: rental, now: now)
        #expect(store.deadlines.count == 1)
        #expect(rental.deadlines.count == 1)
    }

    @Test func `seeding a rental not yet inserted still works`() {
        let store = makeStore()
        let rental = Rental(name: "Home", phase: .moveOut, tenancyEndDate: day(2026, 8, 31))
        store.seedInitialDeadlines(for: rental, now: now)
        #expect(store.deadlines.map(\.kind) == [.depositItemization])
        #expect(store.deadlines.first?.rental?.id == rental.id)
    }

    @Test func `recording the report asks in context and starts the objection clock`() async {
        let store = makeStore()
        let rental = movedInRental()
        store.seedInitialDeadlines(for: rental, now: now)
        await store.recordReportReceived(on: day(2026, 8, 16), for: rental, now: now)
        #expect(scheduler.requestCount == 1)
        #expect(store.authorization == .authorized)
        #expect(store.activeDeadlines.map(\.kind) == [.objection])
        #expect(store.next?.kind == .objection)
        #expect(store.next?.dueDay == day(2026, 8, 21))
        #expect(Set(scheduler.scheduled.values.map(\.day)) == [day(2026, 8, 19), day(2026, 8, 20)])
        // The landlord's report clock is met, so its reminders are gone.
        let report = store.deadlines.first { $0.kind == .moveInReport }
        #expect(report?.isActive == false)
        #expect(Set(scheduler.cancelled).isSuperset(of: report?.reminderIdentifiers ?? ["missing"]))
    }

    @Test func `a corrected date reschedules the same reminders`() async {
        scheduler.status = .authorized
        let store = makeStore()
        let rental = movedInRental()
        await store.recordReportReceived(on: day(2026, 8, 14), for: rental, now: now)
        let identifiers = Set(scheduler.scheduled.keys)
        await store.recordReportReceived(on: day(2026, 8, 15), for: rental, now: now)
        #expect(store.deadlines.filter { $0.kind == .objection }.count == 1)
        #expect(Set(scheduler.scheduled.keys) == identifiers)
        #expect(Set(scheduler.scheduled.values.map(\.day)) == [day(2026, 8, 18), day(2026, 8, 19)])
    }

    @Test func `a denied prompt is not asked again`() async {
        scheduler.answer = .denied
        let store = makeStore()
        let rental = movedInRental()
        await store.recordReportReceived(on: day(2026, 8, 14), for: rental, now: now)
        await store.setTenancyEnd(day(2026, 9, 30), for: rental, now: now)
        await store.requestReminders(now: now)
        #expect(scheduler.requestCount == 1)
        #expect(store.authorization == .denied)
        #expect(scheduler.scheduled.isEmpty)
    }

    @Test func `the move-out date starts the deposit clock`() async {
        let store = makeStore()
        let rental = Rental(name: "Home", phase: .moveOut)
        container.mainContext.insert(rental)
        store.refresh(now: now)
        #expect(store.needsMoveOutDate)
        await store.setTenancyEnd(day(2026, 8, 31), for: rental, now: now)
        #expect(!store.needsMoveOutDate)
        #expect(rental.tenancyEndDate == day(2026, 8, 31))
        #expect(store.next?.kind == .depositItemization)
        #expect(store.next?.dueDay == day(2026, 10, 15))
        #expect(scheduler.requestCount == 1)
    }

    @Test func `the accessory updates live and hides when nothing is due`() async throws {
        scheduler.status = .authorized
        let store = makeStore()
        #expect(store.next == nil)
        let rental = movedInRental()
        store.seedInitialDeadlines(for: rental, now: now)
        #expect(store.next?.kind == .moveInReport)
        await store.recordReportReceived(on: day(2026, 8, 14), for: rental, now: now)
        #expect(store.next?.kind == .objection)
        let objection = try #require(store.activeDeadlines.first)
        store.remove(objection, now: now)
        await store.pendingWork?.value
        #expect(store.next == nil)
        #expect(scheduler.scheduled.isEmpty)
        #expect(Set(scheduler.cancelled).isSuperset(of: objection.reminderIdentifiers))
    }

    @Test func `a passed deadline drops out of the accessory after the window`() {
        let store = makeStore()
        store.seedInitialDeadlines(for: movedInRental(), now: now)
        let later = newYork.date(from: DateComponents(year: 2026, month: 8, day: 26, hour: 12))!
        store.refresh(now: later)
        #expect(store.next?.countdown(from: later, calendar: newYork) == .pastDue)
        store.refresh(now: newYork.date(byAdding: .day, value: 1, to: later)!)
        #expect(store.next == nil)
        #expect(store.visibleDeadlines.isEmpty)
    }

    @Test func `the rental picked last is current, until a newer one is added`() {
        let first = Rental(name: "Richmond", createdAt: now)
        let second = Rental(name: "Norfolk", createdAt: now.addingTimeInterval(60))
        #expect(Rental.current(in: [first, second])?.id == second.id)
        first.selectedAt = now.addingTimeInterval(120)
        #expect(Rental.current(in: [first, second])?.id == first.id)
        let third = Rental(name: "Roanoke", createdAt: now.addingTimeInterval(180))
        #expect(Rental.current(in: [first, second, third])?.id == third.id)
        #expect(Rental.current(in: []) == nil)
    }

    @Test func `deadlines and the accessory follow the current rental, reminders cover every rental`() async {
        scheduler.status = .authorized
        let store = makeStore()
        let movedIn = Rental(name: "Richmond", createdAt: now, phase: .moveIn, occupancyDate: day(2026, 8, 14))
        container.mainContext.insert(movedIn)
        store.seedInitialDeadlines(for: movedIn, now: now)
        #expect(store.next?.kind == .moveInReport)

        let movingOut = Rental(name: "Norfolk", createdAt: now.addingTimeInterval(60), phase: .moveOut)
        container.mainContext.insert(movingOut)
        store.seedInitialDeadlines(for: movingOut, now: now)
        await store.pendingWork?.value
        #expect(store.currentRental?.id == movingOut.id)
        #expect(store.visibleDeadlines.isEmpty)
        #expect(store.next == nil)
        #expect(store.needsMoveOutDate)
        #expect(Set(scheduler.scheduled.values.map(\.day)) == [day(2026, 8, 17), day(2026, 8, 18)])

        movedIn.selectedAt = now.addingTimeInterval(120)
        #expect(store.currentRental?.id == movedIn.id)
        #expect(store.visibleDeadlines.map(\.kind) == [.moveInReport])
        #expect(store.next?.kind == .moveInReport)
        #expect(!store.needsMoveOutDate)
    }

    #if DEBUG
    @Test func `the default debug build prefers real deadlines over the sample`() {
        let store = makeStore(stub: nil)
        #expect(store.next?.kind == nil)
        #expect(store.showsSample)
        store.seedInitialDeadlines(for: movedInRental(), now: now)
        #expect(store.next?.kind == .moveInReport)
        #expect(!store.showsSample)
    }

    @Test func `the present stub shows the sample over real deadlines`() {
        let store = makeStore(stub: .present)
        store.seedInitialDeadlines(for: movedInRental(), now: now)
        #expect(store.next?.kind == nil)
        #expect(store.next?.title == "Object to move-in report")
    }

    @Test func `the seed argument is parsed`() {
        #expect(DeadlineStore.debugSeedKind(in: ["FinePrint", "-FinePrintSeedDeadline", "deposit_itemization"]) == .depositItemization)
        #expect(DeadlineStore.debugSeedKind(in: ["FinePrint", "-FinePrintSeedDeadline", "objection"]) == .objection)
        #expect(DeadlineStore.debugSeedKind(in: ["FinePrint", "-FinePrintSeedDeadline", "nonsense"]) == nil)
        #expect(DeadlineStore.debugSeedKind(in: ["FinePrint", "-FinePrintSeedDeadline"]) == nil)
        #expect(DeadlineStore.debugSeedKind(in: ["FinePrint"]) == nil)
    }

    @Test func `the seed argument starts a clock today without asking`() async {
        let store = makeStore(arguments: ["FinePrint", "-FinePrintSeedDeadline", "move_in_report"])
        await store.pendingWork?.value
        #expect(store.next?.kind == .moveInReport)
        #expect(store.next?.dueDay == day(2026, 8, 19))
        #expect(store.currentRental?.phase == .moveIn)
        #expect(scheduler.requestCount == 0)
    }
    #endif
}
