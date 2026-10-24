import Foundation

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
    var dueDate: Date

    /// Whole calendar days between today and the due date, so "3 days left" stays stable all day.
    func countdown(from now: Date, calendar: Calendar = .current) -> Countdown {
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: now),
            to: calendar.startOfDay(for: dueDate)
        ).day ?? 0
        if days > 0 { return .daysLeft(days) }
        return days == 0 ? .dueToday : .pastDue
    }
}

/// Supplies the next deadline. A stub until deadlines come from evidence and letters.
@Observable
final class DeadlineStore {
    var next: NextDeadline?

    init(launchOptions: LaunchOptions, now: Date = .now, calendar: Calendar = .current) {
        #if DEBUG
        let stub = launchOptions.deadlineStub ?? .present
        next = stub == .present ? Self.sample(now: now, calendar: calendar) : nil
        #else
        next = nil
        #endif
    }

    #if DEBUG
    /// Developer-menu switch between the sample deadline and the empty state.
    var showsSample: Bool {
        get { next != nil }
        set { next = newValue ? Self.sample() : nil }
    }

    /// The move-in objection clock (Va. Code § 55.1-1214(A)), three days from today.
    static func sample(now: Date = .now, calendar: Calendar = .current) -> NextDeadline {
        let today = calendar.startOfDay(for: now)
        let due = calendar.date(byAdding: .day, value: 3, to: today) ?? today
        return NextDeadline(title: String(localized: "Object to move-in report"), dueDate: due)
    }
    #endif
}
