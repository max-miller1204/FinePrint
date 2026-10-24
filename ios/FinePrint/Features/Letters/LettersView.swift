import SwiftUI

struct LettersView: View {
    var body: some View {
        PlaceholderScreen(
            navigationTitle: "Letters",
            title: "No letters yet",
            systemImage: "envelope",
            description: "Letters you write with FinePrint, like a move-in objection or a repair request, are kept here with their status."
        )
    }
}

#Preview {
    NavigationStack { LettersView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
