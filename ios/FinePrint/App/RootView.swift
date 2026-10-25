import SwiftData
import SwiftUI

/// Shows onboarding until a rental exists, then the tabs. Also creates any rental the server has not
/// seen yet, at launch, on return to the foreground, and when sign-in succeeds.
struct RootView: View {
    /// `-FinePrintSkipOnboarding` (DEBUG): start at the tabs with a default Virginia rental.
    var skipsOnboarding = false

    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(DataDeletion.self) private var deletion
    @Environment(UserSettings.self) private var settings
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]
    @State private var launchTab = AppTab.lease
    @State private var foregrounds = 0

    private struct SyncTrigger: Hashable {
        var signedIn: Bool
        var pending: Int
        var foregrounds: Int
    }

    var body: some View {
        Group {
            // After "Delete everything" the receipt stands in for the screens it came from.
            if let receipt = deletion.receipt {
                DeletionReceiptView(receipt: receipt, onAppear: deletion.receiptDidAppear) {
                    deletion.dismissReceipt()
                    // A fresh anonymous account, so the next rental has somewhere to go.
                    Task { await auth.start() }
                }
            } else if !rentals.isEmpty {
                RootTabView(initialTab: launchTab)
            } else if skipsOnboarding {
                Color(.systemBackground)
                    .ignoresSafeArea()
                    .task { save(OnboardingDraft.skipped()) }
            } else {
                OnboardingView { draft in
                    guard let rental = draft.makeRental() else { return }
                    settings.language = draft.language
                    launchTab = draft.phase?.firstTab ?? .lease
                    save(rental)
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { foregrounds += 1 }
        }
        .task(id: trigger) {
            let pending = rentals.filter { $0.serverID == nil }
            guard !pending.isEmpty else { return }
            let client = APIClient(auth: auth, serverURL: configuration.serverURL)
            if await RentalSync.uploadPending(pending, with: client) > 0 {
                try? context.save()
            }
        }
    }

    private var trigger: SyncTrigger {
        var signedIn = false
        if case .signedIn = auth.state { signedIn = true }
        return SyncTrigger(signedIn: signedIn, pending: rentals.filter { $0.serverID == nil }.count, foregrounds: foregrounds)
    }

    /// The rental is saved on the device first, so onboarding finishes offline. Deadlines are seeded
    /// from it; no notification permission is requested here (spec §4.2 step 5).
    private func save(_ rental: Rental) {
        context.insert(rental)
        try? context.save()
        deadlines.seedInitialDeadlines(for: rental)
    }
}
