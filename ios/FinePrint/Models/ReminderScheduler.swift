import Foundation
import UserNotifications

/// Whether FinePrint may post deadline reminders.
nonisolated enum NotificationAuthorization: Equatable, Sendable {
    /// Not asked yet. Only an in-app action the tenant takes may ask (spec §4.2 step 5).
    case notDetermined
    case denied
    case authorized
}

/// Local notifications for deadlines, behind a protocol so tests can record what would be
/// scheduled and assert that nothing asked for permission.
protocol ReminderScheduling: AnyObject {
    func authorization() async -> NotificationAuthorization
    /// Shows the system prompt if it has not been answered yet.
    func requestAuthorization() async -> NotificationAuthorization
    /// Adds or replaces (by identifier) each reminder.
    func schedule(_ reminders: [DeadlineReminder]) async
    func cancel(identifiers: [String])
}

/// The real scheduler, on `UNUserNotificationCenter`.
final class UserNotificationScheduler: ReminderScheduling {
    private var center: UNUserNotificationCenter { .current() }

    func authorization() async -> NotificationAuthorization {
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        default: .authorized
        }
    }

    func requestAuthorization() async -> NotificationAuthorization {
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        return await authorization()
    }

    func schedule(_ reminders: [DeadlineReminder]) async {
        for reminder in reminders {
            let content = UNMutableNotificationContent()
            content.title = reminder.title
            content.body = reminder.body
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: reminder.dateComponents, repeats: false)
            let request = UNNotificationRequest(identifier: reminder.identifier, content: content, trigger: trigger)
            try? await center.add(request)
        }
    }

    func cancel(identifiers: [String]) {
        guard !identifiers.isEmpty else { return }
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }
}
