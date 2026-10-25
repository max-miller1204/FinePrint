import SwiftUI

/// The Evidence tab: running clocks, then the move-in walkthrough (spec §4.3 F2).
struct EvidenceView: View {
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(AppNavigation.self) private var navigation
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 16) {
                    if deadlines.needsMoveOutDate, let rental = deadlines.currentRental {
                        MoveOutDateCard(rental: rental)
                    }
                    ForEach(deadlines.visibleDeadlines) { deadline in
                        DeadlineCard(deadline: deadline)
                            .id(deadline.id)
                    }
                    MoveInWalkthroughSection(rental: deadlines.currentRental)
                }
                .padding()
            }
            .onChange(of: navigation.focusedDeadlineID, initial: true) { _, id in
                guard let id else { return }
                withAnimation(reduceMotion ? nil : .smooth) { proxy.scrollTo(id, anchor: .top) }
                navigation.focusedDeadlineID = nil
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Evidence")
        .rentalSubtitle()
        .settingsToolbar()
    }
}

#Preview {
    NavigationStack { EvidenceView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
