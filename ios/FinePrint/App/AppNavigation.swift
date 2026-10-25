import Foundation
import Observation

/// Shell-level navigation state. Lives above the `TabView` so it survives the tab view
/// being rebuilt when the deadline accessory appears or disappears.
@Observable
final class AppNavigation {
    var selectedTab: AppTab
    var isSettingsPresented = false
    var isAddingRental = false
    /// The deadline the accessory last opened, so its screen can scroll to it.
    var focusedDeadlineID: UUID?

    init(selectedTab: AppTab = .lease) {
        self.selectedTab = selectedTab
    }

    /// Opens the flow that handles `deadline`.
    func open(_ deadline: NextDeadline) {
        selectedTab = deadline.tab
        focusedDeadlineID = deadline.deadlineID
    }
}
