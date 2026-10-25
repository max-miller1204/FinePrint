import Foundation
import SwiftData

/// The Virginia clocks FinePrint tracks (spec §2.1). Raw values are stable storage keys.
nonisolated enum DeadlineKind: String, Codable, CaseIterable, Sendable {
    /// The landlord's written move-in report, due within 5 days after occupancy (Va. Code § 55.1-1214(A)).
    case moveInReport = "move_in_report"
    /// The tenant's written objection, due within 5 days after receiving that report (§ 55.1-1214(A)).
    case objection
    /// The deposit refund with itemized deductions, due within 45 days after the tenancy ends (§ 55.1-1226).
    case depositItemization = "deposit_itemization"

    /// Calendar days from the start day to the due day.
    var length: Int {
        switch self {
        case .moveInReport, .objection: 5
        case .depositItemization: 45
        }
    }

    var citation: String {
        switch self {
        case .moveInReport, .objection: "Va. Code § 55.1-1214"
        case .depositItemization: "Va. Code § 55.1-1226"
        }
    }

    /// Already localized, because the accessory and notifications take a plain string.
    var title: String {
        switch self {
        case .moveInReport: String(localized: "Landlord's move-in report due")
        case .objection: String(localized: "Object to move-in report")
        case .depositItemization: String(localized: "Deposit itemization due")
        }
    }

    /// Days before the due day that get a 9 a.m. reminder. For the 5-day clocks these are
    /// day 3 and day 4 (spec §4.3 F3); the 45-day clock gets the same two days before it ends.
    var reminderDaysBeforeDue: [Int] { [2, 1] }

    /// The due day for a clock that starts on `start`.
    func dueDay(from start: CalendarDay) -> CalendarDay {
        start.adding(days: length)
    }
}

extension DeadlineKind {
    /// The tab whose flow handles this deadline. The report diff, the objection, and the deposit
    /// tracker all start in Evidence (spec §4.3 F3, F6); the objection letter itself is drafted there.
    var tab: AppTab {
        switch self {
        case .moveInReport, .objection, .depositItemization: .evidence
        }
    }
}

/// One running clock for a rental. Counting is in whole calendar days on `CalendarDay`, so the
/// due day never moves with the device's time zone or a daylight saving change.
@Model
final class Deadline {
    @Attribute(.unique) var id: UUID
    var kind: DeadlineKind
    /// The day the clock started: occupancy, report receipt, or tenancy end.
    var startDay: CalendarDay
    var dueDay: CalendarDay
    var createdAt: Date
    /// Set when the clock no longer needs attention, such as the landlord's report arriving.
    var completedAt: Date?
    var rental: Rental?

    init(id: UUID = UUID(), kind: DeadlineKind, startDay: CalendarDay, createdAt: Date = .now, rental: Rental? = nil) {
        self.id = id
        self.kind = kind
        self.startDay = startDay
        self.dueDay = kind.dueDay(from: startDay)
        self.createdAt = createdAt
        self.rental = rental
    }

    /// Moves the clock to a new start day, such as a corrected receipt date.
    func restart(on start: CalendarDay) {
        startDay = start
        dueDay = kind.dueDay(from: start)
    }

    var isActive: Bool { completedAt == nil }

    /// Stable notification identifiers, one per reminder day, so rescheduling replaces them.
    var reminderIdentifiers: [String] {
        kind.reminderDaysBeforeDue.map { "deadline.\(id.uuidString).\($0)" }
    }

    /// The reminders still ahead of `now`. Past ones are dropped, so a clock seeded late
    /// only gets the reminders that can still fire.
    func reminders(after now: Date, calendar: Calendar = .current) -> [DeadlineReminder] {
        zip(kind.reminderDaysBeforeDue, reminderIdentifiers).compactMap { daysBefore, identifier in
            let day = dueDay.adding(days: -daysBefore)
            let reminder = DeadlineReminder(
                identifier: identifier,
                title: kind.title,
                body: DeadlineReminder.body(daysLeft: daysBefore, dueDay: dueDay, calendar: calendar),
                day: day
            )
            guard let fire = reminder.fireDate(in: calendar), fire > now else { return nil }
            return reminder
        }
    }
}

/// A local notification for a deadline, at 9 a.m. local time on `day`.
nonisolated struct DeadlineReminder: Equatable, Sendable {
    static let hour = 9

    var identifier: String
    var title: String
    var body: String
    var day: CalendarDay

    /// No time zone on purpose: the notification fires at 9 a.m. wherever the phone is that day.
    var dateComponents: DateComponents {
        DateComponents(year: day.year, month: day.month, day: day.day, hour: Self.hour, minute: 0)
    }

    func fireDate(in calendar: Calendar) -> Date? {
        calendar.date(from: dateComponents)
    }

    static func body(daysLeft: Int, dueDay: CalendarDay, calendar: Calendar) -> String {
        var format = Date.FormatStyle.dateTime.weekday(.wide).month(.wide).day()
        format.timeZone = calendar.timeZone
        let due = (dueDay.startOfDay(in: calendar) ?? .now).formatted(format)
        return String(localized: "\(daysLeft) days left. Due \(due).")
    }
}

nonisolated extension CalendarDay {
    /// Day arithmetic happens in UTC, which has no daylight saving, so adding 5 days is always
    /// 5 calendar days whatever the device's time zone.
    private static let arithmetic: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    private var arithmeticDate: Date {
        Self.arithmetic.date(from: DateComponents(year: year, month: month, day: day)) ?? .distantPast
    }

    func adding(days: Int) -> CalendarDay {
        let date = Self.arithmetic.date(byAdding: .day, value: days, to: arithmeticDate) ?? arithmeticDate
        return CalendarDay(date, calendar: Self.arithmetic)
    }

    /// Whole calendar days from this day to `other`; negative when `other` is earlier.
    func days(until other: CalendarDay) -> Int {
        Self.arithmetic.dateComponents([.day], from: arithmeticDate, to: other.arithmeticDate).day ?? 0
    }
}
