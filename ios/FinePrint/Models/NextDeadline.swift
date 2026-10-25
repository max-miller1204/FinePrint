import Foundation
import SwiftData

/// The single most urgent deadline, shown in the tab bar accessory.
nonisolated struct NextDeadline: Equatable, Sendable {
    enum Countdown: Equatable, Sendable {
        case daysLeft(Int)
        case dueToday
        case pastDue

        var text: LocalizedStringResource {
            switch self {
            case .daysLeft(let days): "\(days) days left"
            case .dueToday: "Due today"
            case .pastDue: "Past due"
            }
        }
    }

    /// Already localized, because it comes from the deadline's source (a rule or a letter).
    var title: String
    var dueDay: CalendarDay
    /// Nil for the DEBUG sample, which opens Evidence.
    var kind: DeadlineKind?
    var deadlineID: UUID?

    init(title: String, dueDay: CalendarDay, kind: DeadlineKind? = nil, deadlineID: UUID? = nil) {
        self.title = title
        self.dueDay = dueDay
        self.kind = kind
        self.deadlineID = deadlineID
    }

    /// Whole calendar days between today (in `calendar`'s time zone) and the due day, so
    /// "3 days left" stays stable all day and across daylight saving changes.
    func countdown(from now: Date, calendar: Calendar = .current) -> Countdown {
        let days = CalendarDay(now, calendar: calendar).days(until: dueDay)
        if days > 0 { return .daysLeft(days) }
        return days == 0 ? .dueToday : .pastDue
    }
}

extension NextDeadline {
    var tab: AppTab { kind?.tab ?? .evidence }
}

/// Owns the rental's deadlines: creates them, keeps their reminders in step, and picks the one
/// the accessory shows.
///
/// Notification permission is asked only from an in-app action the tenant takes: recording the
/// landlord's report, adding a move-out date, or tapping Remind Me on a deadline (spec §4.2 step 5).
/// Seeding at onboarding never asks. Deadlines seeded before permission was given get their
/// reminders when the tenant taps Remind Me on the deadline's card in Evidence, which is where
/// the accessory takes them, so the prompt appears next to the deadline it is for.
@Observable
final class DeadlineStore {
    /// Every deadline, active or not, earliest due first.
    private(set) var deadlines: [Deadline] = []
    private(set) var rentals: [Rental] = []
    private(set) var authorization: NotificationAuthorization?
    /// The calendar day the store counts from. `refresh(now:)` moves it.
    private(set) var today: CalendarDay

    @ObservationIgnored private let context: ModelContext?
    @ObservationIgnored private let scheduler: any ReminderScheduling
    @ObservationIgnored private let calendar: Calendar
    /// The latest reminder sync, so tests can wait for it.
    @ObservationIgnored private(set) var pendingWork: Task<Void, Never>?
    @ObservationIgnored private var dayObserver: NSObjectProtocol?

    /// Past-due deadlines stay in the accessory this many days, so a missed clock is explained
    /// rather than silently dropped (spec §4.3 F3, no landlord report case).
    static let pastDueWindow = 7

    init(
        launchOptions: LaunchOptions,
        modelContext: ModelContext? = nil,
        scheduler: any ReminderScheduling = UserNotificationScheduler(),
        now: Date = .now,
        calendar: Calendar = .current,
        arguments: [String] = ProcessInfo.processInfo.arguments
    ) {
        context = modelContext
        self.scheduler = scheduler
        self.calendar = calendar
        today = CalendarDay(now, calendar: calendar)
        #if DEBUG
        sampleMode = switch launchOptions.deadlineStub {
        case .present: .on
        case .empty: .off
        case nil: .whenNothingIsDue
        }
        #endif
        reload()
        #if DEBUG
        if let kind = Self.debugSeedKind(in: arguments) { seedDebugDeadline(kind, now: now) }
        #endif
        guard context != nil else { return }
        dayObserver = NotificationCenter.default.addObserver(forName: .NSCalendarDayChanged, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        sync(now: now)
    }

    // MARK: Reading

    var activeDeadlines: [Deadline] { deadlines.filter(\.isActive) }

    /// The current rental's active deadlines that are ahead, or passed within `pastDueWindow` days:
    /// what Evidence lists and the accessory picks from. Reminders still cover every rental.
    var visibleDeadlines: [Deadline] {
        let rentalID = currentRental?.id
        return activeDeadlines.filter { deadline in
            (rentalID == nil || deadline.rental?.id == rentalID) && deadline.dueDay.days(until: today) <= Self.pastDueWindow
        }
    }

    /// What the accessory shows, or nil to hide it.
    var next: NextDeadline? {
        #if DEBUG
        switch sampleMode {
        case .on: return Self.sample(today: today)
        case .off: return realNext
        case .whenNothingIsDue: return realNext ?? Self.sample(today: today)
        }
        #else
        return realNext
        #endif
    }

    private var realNext: NextDeadline? {
        Self.mostUrgent(visibleDeadlines.map(Self.snapshot), today: today)
    }

    /// The earliest deadline due today or later. If none is ahead, the latest one that passed
    /// within `pastDueWindow` days. Nil when nothing is due.
    static func mostUrgent(_ candidates: [NextDeadline], today: CalendarDay) -> NextDeadline? {
        let upcoming = candidates.filter { today.days(until: $0.dueDay) >= 0 }
        if let soonest = upcoming.min(by: { $0.dueDay < $1.dueDay }) { return soonest }
        return candidates
            .filter { $0.dueDay.days(until: today) <= pastDueWindow }
            .max(by: { $0.dueDay < $1.dueDay })
    }

    static func snapshot(_ deadline: Deadline) -> NextDeadline {
        NextDeadline(title: deadline.kind.title, dueDay: deadline.dueDay, kind: deadline.kind, deadlineID: deadline.id)
    }

    /// The rental picked in the switcher (spec §4.1).
    var currentRental: Rental? { Rental.current(in: rentals) }

    /// True when the tenant is moving out but has not said when, so the 45-day clock cannot start.
    var needsMoveOutDate: Bool {
        guard let rental = currentRental, [.moveOut, .ended].contains(rental.phase) else { return false }
        return !deadlines.contains { $0.kind == .depositItemization && $0.rental?.id == rental.id }
    }

    /// The days a deadline's reminders fire on, for showing on its card.
    func reminderDays(for deadline: Deadline) -> [CalendarDay] {
        deadline.kind.reminderDaysBeforeDue.map { deadline.dueDay.adding(days: -$0) }
    }

    // MARK: Creating

    /// The clocks that follow from where the tenant is in the rental (spec §4.2 step 4).
    static func initialDeadlines(phase: RentalPhase, occupancy: CalendarDay?, tenancyEnd: CalendarDay?, today: CalendarDay) -> [SeededDeadline] {
        var seeded: [SeededDeadline] = []
        switch phase {
        case .preSigning:
            break
        case .moveIn, .living:
            if let occupancy { seeded.append(SeededDeadline(kind: .moveInReport, start: occupancy)) }
        case .moveOut, .ended:
            if let tenancyEnd { seeded.append(SeededDeadline(kind: .depositItemization, start: tenancyEnd)) }
        }
        // A clock that ended long ago is history, not a deadline.
        return seeded.filter { $0.kind.dueDay(from: $0.start).days(until: today) <= pastDueWindow }
    }

    /// Creates the deadlines that follow from where the tenant is in the rental, such as the
    /// landlord's move-in report within 5 days of occupancy (spec §4.2 step 4). Onboarding calls
    /// this. It never asks for notification permission (§4.2 step 5); if permission was already
    /// given, the new deadlines get their reminders. Calling it again adds nothing twice.
    func seedInitialDeadlines(for rental: Rental, now: Date = .now) {
        let day = CalendarDay(now, calendar: calendar)
        for seed in Self.initialDeadlines(phase: rental.phase, occupancy: rental.occupancyDate, tenancyEnd: rental.tenancyEndDate, today: day)
        where deadline(seed.kind, for: rental) == nil {
            insert(Deadline(kind: seed.kind, startDay: seed.start, createdAt: now), for: rental)
        }
        save()
        sync(now: now)
    }

    /// The tenant got the landlord's move-in report: the landlord's clock is met and the 5-day
    /// objection clock starts (spec §4.3 F3). An in-app action, so it may ask for permission.
    func recordReportReceived(on day: CalendarDay, for rental: Rental, now: Date = .now) async {
        deadline(.moveInReport, for: rental)?.completedAt = now
        start(.objection, on: day, for: rental, now: now)
        await enableReminders(now: now)
    }

    /// The move-in report is sealed: the landlord's 5-day report clock runs from occupancy
    /// (spec §4.3 F2, Va. Code § 55.1-1214(A)). A rental that already has the clock, running or
    /// closed, keeps it. Otherwise it starts on `occupancy`, the rental's occupancy date, or the day
    /// the walkthrough began when the rental has none. Never asks for notification permission:
    /// the clock's card offers Remind Me.
    @discardableResult
    func startMoveInReportClock(for rental: Rental, occupancyFallback: CalendarDay, now: Date = .now) -> Deadline {
        if let existing = deadline(.moveInReport, for: rental) { return existing }
        let created = Deadline(kind: .moveInReport, startDay: rental.occupancyDate ?? occupancyFallback, createdAt: now)
        insert(created, for: rental)
        save()
        sync(now: now)
        return created
    }

    /// The tenancy ends (or ended) on `day`: the 45-day deposit clock starts (spec §4.3 F6).
    /// An in-app action, so it may ask for permission.
    func setTenancyEnd(_ day: CalendarDay, for rental: Rental, now: Date = .now) async {
        rental.tenancyEndDate = day
        start(.depositItemization, on: day, for: rental, now: now)
        await enableReminders(now: now)
    }

    /// Remind Me on a deadline's card: asks for permission if it has not been asked, then
    /// schedules every active deadline's reminders.
    func requestReminders(now: Date = .now) async {
        await enableReminders(now: now)
    }

    /// "Delete everything": cancels every reminder and deletes every rental with its deadlines.
    /// Returns how many rentals went.
    @discardableResult
    func eraseAll() -> Int {
        scheduler.cancel(identifiers: deadlines.flatMap(\.reminderIdentifiers))
        guard let context else { return 0 }
        let all = (try? context.fetch(FetchDescriptor<Rental>())) ?? []
        for rental in all { context.delete(rental) }
        save()
        return all.count
    }

    func remove(_ deadline: Deadline, now: Date = .now) {
        scheduler.cancel(identifiers: deadline.reminderIdentifiers)
        context?.delete(deadline)
        save()
        sync(now: now)
    }

    /// Moves the store to a new day and re-checks permission, which the tenant may have changed
    /// in Settings. Called when the app becomes active and when the calendar day changes.
    func refresh(now: Date = .now) {
        today = CalendarDay(now, calendar: calendar)
        reload()
        sync(now: now)
    }

    // MARK: Internals

    private func deadline(_ kind: DeadlineKind, for rental: Rental) -> Deadline? {
        deadlines.first { $0.kind == kind && $0.rental?.id == rental.id }
    }

    private func start(_ kind: DeadlineKind, on day: CalendarDay, for rental: Rental, now: Date) {
        if let existing = deadline(kind, for: rental) {
            existing.restart(on: day)
            existing.completedAt = nil
        } else {
            insert(Deadline(kind: kind, startDay: day, createdAt: now), for: rental)
        }
        save()
    }

    private func insert(_ deadline: Deadline, for rental: Rental) {
        // Insert where the rental lives, so the relationship never spans two contexts.
        guard let target = rental.modelContext ?? context else { return }
        if rental.modelContext == nil { target.insert(rental) }
        target.insert(deadline)
        deadline.rental = rental
        if target !== context { try? target.save() }
    }

    private func save() {
        try? context?.save()
        reload()
    }

    private func reload() {
        guard let context else { return }
        rentals = (try? context.fetch(FetchDescriptor<Rental>())) ?? []
        deadlines = ((try? context.fetch(FetchDescriptor<Deadline>())) ?? [])
            .sorted { ($0.dueDay, $0.createdAt) < ($1.dueDay, $1.createdAt) }
    }

    private func enableReminders(now: Date) async {
        let plan = reminderPlan(now: now)
        await pendingWork?.value
        if await scheduler.authorization() == .notDetermined {
            authorization = await scheduler.requestAuthorization()
        }
        await apply(plan)
    }

    private func sync(now: Date) {
        // Read the models now: by the time the task runs, they may be gone.
        let plan = reminderPlan(now: now)
        let previous = pendingWork
        pendingWork = Task {
            await previous?.value
            await apply(plan)
        }
    }

    /// What the reminders should be, as plain values that are safe to hold across an `await`.
    private struct ReminderPlan {
        var cancel: [String]
        var schedule: [DeadlineReminder]
    }

    private func reminderPlan(now: Date) -> ReminderPlan {
        ReminderPlan(
            cancel: deadlines.filter { !$0.isActive }.flatMap(\.reminderIdentifiers),
            schedule: activeDeadlines.flatMap { $0.reminders(after: now, calendar: calendar) }
        )
    }

    /// Cancels reminders for finished deadlines and, only if permission is already given,
    /// schedules the active ones. Never asks for permission.
    private func apply(_ plan: ReminderPlan) async {
        let status = await scheduler.authorization()
        authorization = status
        scheduler.cancel(identifiers: plan.cancel)
        guard status == .authorized else { return }
        await scheduler.schedule(plan.schedule)
    }

    // MARK: DEBUG sample

    #if DEBUG
    enum SampleMode {
        /// `-FinePrintDeadlineStub present` or the developer toggle on: the sample, even over real deadlines.
        case on
        /// `-FinePrintDeadlineStub empty` or the toggle off: real deadlines only.
        case off
        /// The default: real deadlines, or the sample when nothing real is due.
        case whenNothingIsDue
    }

    private var sampleMode: SampleMode

    /// Developer-menu switch for the sample deadline.
    var showsSample: Bool {
        get {
            switch sampleMode {
            case .on: true
            case .off: false
            case .whenNothingIsDue: realNext == nil
            }
        }
        set { sampleMode = newValue ? .on : .off }
    }

    /// The move-in objection clock (Va. Code § 55.1-1214(A)), three days from today.
    static func sample(today: CalendarDay) -> NextDeadline {
        NextDeadline(title: String(localized: "Object to move-in report"), dueDay: today.adding(days: 3))
    }

    /// `-FinePrintSeedDeadline move_in_report|objection|deposit_itemization` starts that clock
    /// today on a new rental at launch, for e2e. Seeded like onboarding, so it never asks for permission.
    static let seedDeadlineArgument = "-FinePrintSeedDeadline"

    static func debugSeedKind(in arguments: [String]) -> DeadlineKind? {
        guard let index = arguments.firstIndex(of: seedDeadlineArgument), arguments.indices.contains(index + 1) else { return nil }
        return DeadlineKind(rawValue: arguments[index + 1])
    }

    private func seedDebugDeadline(_ kind: DeadlineKind, now: Date) {
        guard let context else { return }
        let day = CalendarDay(now, calendar: calendar)
        let rental = switch kind {
        case .moveInReport, .objection: Rental(name: "Sample rental", createdAt: now, phase: .moveIn, occupancyDate: day)
        case .depositItemization: Rental(name: "Sample rental", createdAt: now, phase: .moveOut, tenancyEndDate: day)
        }
        context.insert(rental)
        insert(Deadline(kind: kind, startDay: day, createdAt: now), for: rental)
        save()
    }
    #endif
}

/// A clock that onboarding's answers imply.
nonisolated struct SeededDeadline: Equatable, Sendable {
    var kind: DeadlineKind
    var start: CalendarDay
}
