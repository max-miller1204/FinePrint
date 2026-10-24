import SwiftUI

struct RepairsView: View {
    var body: some View {
        PlaceholderScreen(
            navigationTitle: "Repairs",
            title: "No repairs yet",
            systemImage: "wrench.and.screwdriver",
            description: "When something breaks, add it here. You'll see who is likely responsible and get help writing a repair request."
        )
    }
}

#Preview {
    NavigationStack { RepairsView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
