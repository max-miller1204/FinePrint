import SwiftData
import SwiftUI

extension View {
    /// Adds the rental switcher to the navigation bar (spec §4.1): pick which rental every tab shows,
    /// or add another. The Add Rental sheet itself is owned by `RootTabView`.
    func rentalSwitcher() -> some View {
        modifier(RentalSwitcherModifier())
    }

    /// Names the current rental under the title once there is more than one, so every tab says
    /// which rental it is showing.
    func rentalSubtitle() -> some View {
        modifier(RentalSubtitleModifier())
    }
}

private struct RentalSwitcherModifier: ViewModifier {
    @Environment(AppNavigation.self) private var navigation
    @Environment(\.modelContext) private var context
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]

    private var current: Rental? { Rental.current(in: rentals) }

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Section {
                            ForEach(rentals) { rental in
                                // A toggle shows a checkmark on the current rental. The second line
                                // tells apart two rentals in the same city.
                                Toggle(isOn: isCurrent(rental)) {
                                    Text(verbatim: rental.name)
                                    Text(rental.phase.title)
                                }
                            }
                        }
                        Button("Add Rental", systemImage: "plus") {
                            navigation.isAddingRental = true
                        }
                        .accessibilityIdentifier("rentalSwitcher.add")
                    } label: {
                        Label("Rentals", systemImage: "house")
                    }
                    .accessibilityValue(Text(current?.name ?? ""))
                    .accessibilityHint(Text("Switches the rental every tab shows, or adds one"))
                    .accessibilityIdentifier("rentalSwitcher")
                }
            }
            .sensoryFeedback(.selection, trigger: current?.id)
    }

    /// Turning a rental on makes it current. Turning the current one off does nothing: one is always picked.
    private func isCurrent(_ rental: Rental) -> Binding<Bool> {
        Binding {
            rental.id == current?.id
        } set: { isOn in
            guard isOn, rental.id != current?.id else { return }
            rental.selectedAt = .now
            try? context.save()
        }
    }
}

private struct RentalSubtitleModifier: ViewModifier {
    @Query private var rentals: [Rental]

    func body(content: Content) -> some View {
        if rentals.count > 1, let rental = Rental.current(in: rentals) {
            content.navigationSubtitle(Text(verbatim: rental.name))
        } else {
            content
        }
    }
}

/// Adds another rental: onboarding's place and phase steps in a sheet. The new rental becomes the
/// current one and gets the deadlines its phase implies, like an onboarded rental (spec §4.2).
struct AddRentalView: View {
    @Environment(\.modelContext) private var context
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            OnboardingView(firstStep: .place, finishTitle: "Add Rental") { draft in
                guard let rental = draft.makeRental() else { return }
                // Saved on the device first; `RootView` creates it on the server.
                context.insert(rental)
                try? context.save()
                deadlines.seedInitialDeadlines(for: rental)
                dismiss()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                    .accessibilityIdentifier("addRental.cancel")
                }
            }
        }
    }
}

#Preview {
    NavigationStack { LeaseView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
        .modelContainer(for: [Rental.self, Deadline.self], inMemory: true)
}
