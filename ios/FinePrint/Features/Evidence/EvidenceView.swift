import SwiftUI

struct EvidenceView: View {
    @Environment(DeadlineStore.self) private var deadlines

    var body: some View {
        if !deadlines.visibleDeadlines.isEmpty || deadlines.needsMoveOutDate {
            EvidenceDeadlinesScreen()
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        PlaceholderScreen(
            navigationTitle: "Evidence",
            title: "No move-in photos yet",
            systemImage: "camera.viewfinder",
            description: "In Virginia, you have 5 days after you get your landlord's move-in report to object to it in writing, so take your photos early.",
            showsLegalFooter: false
        )
    }
}

#Preview {
    NavigationStack { EvidenceView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
