import Observation

/// Shell-level navigation state. Lives above the `TabView` so it survives the tab view
/// being rebuilt when the deadline accessory appears or disappears.
@Observable
final class AppNavigation {
    var selectedTab: AppTab = .lease
    var isSettingsPresented = false
}
