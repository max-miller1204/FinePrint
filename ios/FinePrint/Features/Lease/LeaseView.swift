import SwiftUI

struct LeaseView: View {
    var body: some View {
        PlaceholderScreen(
            navigationTitle: "Lease",
            title: "No lease yet",
            systemImage: "doc.text.magnifyingglass",
            description: "Add your lease and FinePrint will check it against Virginia law and explain each part in plain words."
        )
        .rentalSwitcher()
    }
}

#Preview {
    NavigationStack { LeaseView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
