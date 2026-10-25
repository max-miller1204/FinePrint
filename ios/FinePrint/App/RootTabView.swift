import SwiftUI

/// The app shell: four content tabs, Ask as the search-role tab, and the next-deadline accessory.
struct RootTabView: View {
    @Environment(DeadlineStore.self) private var deadlines
    @State private var navigation: AppNavigation

    /// `initialTab` is where onboarding sent the tenant (spec §4.2 step 4).
    init(initialTab: AppTab = .lease) {
        _navigation = State(initialValue: AppNavigation(selectedTab: initialTab))
    }

    var body: some View {
        @Bindable var navigation = navigation
        TabView(selection: $navigation.selectedTab) {
            tab(.lease) { LeaseView() }
            tab(.evidence) { EvidenceView() }
            tab(.repairs) { RepairsView() }
            tab(.letters) { LettersView() }

            Tab(AppTab.ask.title, systemImage: AppTab.ask.systemImage, value: AppTab.ask, role: .search) {
                NavigationStack { AskView() }
            }
            .accessibilityIdentifier(AppTab.ask.accessibilityIdentifier)
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .deadlineAccessory(deadlines.next) { deadline in
            navigation.open(deadline)
        }
        // Presented outside the accessory modifier so toggling the accessory never dismisses it.
        .sheet(isPresented: $navigation.isSettingsPresented) {
            SettingsView()
        }
        .sheet(isPresented: $navigation.isAddingRental) {
            AddRentalView()
        }
        .environment(navigation)
    }

    private func tab(_ tab: AppTab, @ViewBuilder content: () -> some View) -> some TabContent<AppTab> {
        Tab(tab.title, systemImage: tab.systemImage, value: tab) {
            NavigationStack { content() }
        }
        .accessibilityIdentifier(tab.accessibilityIdentifier)
    }
}

#Preview("With deadline") {
    RootTabView()
        .environment(AppConfiguration.preview())
        .environment(AuthSession.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .present)))
}

#Preview("No deadline") {
    RootTabView()
        .environment(AppConfiguration.preview())
        .environment(AuthSession.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions(deadlineStub: .empty)))
}
