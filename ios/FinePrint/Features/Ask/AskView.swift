import SwiftUI

struct AskView: View {
    var body: some View {
        PlaceholderScreen(
            navigationTitle: "Ask",
            title: "Ask about your rental",
            systemImage: "bubble.left.and.text.bubble.right",
            description: "Ask a question about your lease or Virginia rental law. Each answer will show the clause or law it comes from."
        )
    }
}

#Preview {
    NavigationStack { AskView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
