import SwiftData
import SwiftUI

/// "N of M done" with a bar, one accessibility element. Counts are items, so it never needs a plural.
struct ItemProgress: View {
    let done: Int
    let total: Int

    var body: some View {
        // The system progress view reads as its label and percentage, so no custom accessibility.
        ProgressView(value: Double(done), total: Double(max(total, 1))) {
            Text("\(done) of \(total) done")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
    }
}

/// The move-in part of the Evidence tab: the empty state that teaches the 5-day rule and starts a
/// walkthrough, then a card for the walkthrough of the current rental (spec §4.3 F2).
struct MoveInWalkthroughSection: View {
    let rental: Rental?
    @Environment(\.modelContext) private var context
    @Environment(AppNavigation.self) private var navigation

    var body: some View {
        Group {
            if let walkthrough = rental?.currentWalkthrough {
                WalkthroughCard(walkthrough: walkthrough)
            } else {
                emptyState
            }
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No move-in photos yet", systemImage: "camera.viewfinder")
        } description: {
            Text("In Virginia, your landlord has 5 days after you move in to give you a written report of damage, and you have 5 days after you get it to object in writing. Photos you take now, sealed with the date, are your record.")
        } actions: {
            Button("Start Move-In Walkthrough") {
                navigation.roomPicker = RoomPickerRequest(title: "Choose Rooms", confirmTitle: "Start Walkthrough") { rooms in
                    start(with: rooms)
                }
            }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(rental == nil)
                .accessibilityIdentifier("walkthrough.start")
        }
    }

    private func start(with rooms: [WalkthroughRoom]) {
        guard let rental, !rooms.isEmpty else { return }
        let walkthrough = Walkthrough(rooms: rooms)
        context.insert(walkthrough)
        walkthrough.rental = rental
        try? context.save()
    }
}

/// Where the walkthrough stands, with the way back into it. Solid background; no glass.
private struct WalkthroughCard: View {
    let walkthrough: Walkthrough

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Move-In Walkthrough")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if walkthrough.isSealed {
                SealStatusPill(status: .sealed)
                if let sealedAt = walkthrough.sealedAt {
                    Text("Sealed \(sealedAt.formatted(.dateTime.month(.wide).day().hour().minute()))")
                        .foregroundStyle(.secondary)
                }
                Text("Your photos are in a signed report. Your landlord's written report is due within 5 days after you moved in.")
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ItemProgress(done: walkthrough.doneItems, total: walkthrough.totalItems)
            }
            NavigationLink {
                WalkthroughView(walkthrough: walkthrough)
            } label: {
                Group {
                    if walkthrough.isSealed {
                        Text("View Walkthrough")
                    } else {
                        Text("Continue Walkthrough")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("walkthrough.open")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("walkthrough.card")
    }
}
