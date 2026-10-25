import SwiftUI

/// The rooms of a walkthrough, how far along it is, and Seal Move-In Report (spec §4.3 F2).
struct WalkthroughView: View {
    let walkthrough: Walkthrough
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(UploadQueue.self) private var uploads: UploadQueue?
    @State private var sealer = MoveInSealer()
    @Environment(AppNavigation.self) private var navigation
    @State private var isConfirmingSeal = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
            List {
                summarySection
                roomsSection
                sealSection
            }
            // The question appears at the bottom of a long list: bring it into view.
            .onChange(of: isConfirmingSeal) { _, isConfirming in
                guard isConfirming else { return }
                withAnimation(reduceMotion ? nil : .smooth) { proxy.scrollTo(Self.confirmationID, anchor: .center) }
            }
        }
        .navigationTitle("Move-In Walkthrough")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.success, trigger: walkthrough.sealedAt)
        .onChange(of: sealer.phase) { _, phase in
            switch phase {
            case .sealed: announce(String(localized: "Move-in report sealed."))
            case .failed(let failure): announce(String(localized: failure.message))
            default: break
            }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private var summarySection: some View {
        Section {
            if walkthrough.isSealed {
                sealedSummary
            } else {
                ItemProgress(done: walkthrough.doneItems, total: walkthrough.totalItems)
                    .padding(.vertical, 4)
                    .accessibilityIdentifier("walkthrough.progress")
            }
        } footer: {
            if !walkthrough.isSealed {
                Text("Go room by room. Take a photo of each item, or mark it if there is no damage.")
            }
        }
    }

    private var sealedSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            SealStatusPill(status: .sealed)
            if let sealedAt = walkthrough.sealedAt {
                Text("Sealed \(sealedAt.formatted(.dateTime.month(.wide).day().hour().minute()))")
                    .foregroundStyle(.secondary)
            }
            Text("Your photos are in a signed report. Any change to them would show. Your landlord's written report is due within 5 days after you moved in.")
                .fixedSize(horizontal: false, vertical: true)
            if sealer.leftOutCount > 0 {
                Label {
                    Text("Some photos weren't in the report because they hadn't uploaded.")
                } icon: {
                    Image(systemName: Severity.ask.symbolName)
                        .foregroundStyle(Severity.ask.color)
                }
                .font(.subheadline)
                .accessibilityIdentifier("walkthrough.leftOut")
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("walkthrough.sealed")
    }

    private var roomsSection: some View {
        Section {
            ForEach(walkthrough.rooms) { room in
                NavigationLink {
                    RoomChecklistView(walkthrough: walkthrough, roomID: room.id)
                } label: {
                    RoomRow(room: room)
                }
                .accessibilityIdentifier("walkthrough.roomRow.\(room.name.lowercased().replacing(" ", with: "-"))")
            }
            if !walkthrough.isSealed {
                Button("Add Rooms", systemImage: "plus") {
                    navigation.roomPicker = RoomPickerRequest(
                        title: "Add Rooms",
                        confirmTitle: "Add to Walkthrough",
                        existingNames: walkthrough.rooms.map(\.name)
                    ) { rooms in
                        walkthrough.add(rooms)
                        walkthrough.persist()
                    }
                }
                    .accessibilityIdentifier("walkthrough.addRooms")
            }
        } header: {
            Text("Rooms")
        }
    }

    @ViewBuilder
    private var sealSection: some View {
        if !walkthrough.isSealed {
            Section {
                Button(action: seal) {
                    HStack(spacing: 8) {
                        if sealer.isBusy { ProgressView() }
                        Text(sealTitle)
                    }
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .multilineTextAlignment(.center)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!walkthrough.canSeal || sealer.isBusy)
                .keyboardShortcut(.return, modifiers: .command)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .accessibilityIdentifier("walkthrough.seal")

                if isConfirmingSeal {
                    confirmation
                }

                if let failure = sealer.failure {
                    Label {
                        Text(failure.message)
                    } icon: {
                        Image(systemName: Severity.ask.symbolName)
                            .foregroundStyle(Severity.ask.color)
                    }
                    .font(.subheadline)
                    .accessibilityIdentifier("walkthrough.sealError")
                }
            } footer: {
                if walkthrough.canSeal {
                    Text("Sealing signs your photos with the date and time, so any later change would show. It also starts the clock for your landlord's written report.")
                } else {
                    Text("Take at least one photo to seal your report.")
                }
            }
        }
    }

    /// Asked in the list, not in a system dialog: a `confirmationDialog` on this list froze the
    /// screen in an AttributeGraph cycle in the accessibility graph.
    private static let confirmationID = "sealConfirmation"

    @ViewBuilder
    private var confirmation: some View {
        // One control per list row: two buttons in one row both fire on any tap.
        Text("Seal with unchecked items?")
            .font(.headline)
            .id(Self.confirmationID)
            .accessibilityAddTraits(.isHeader)
        Text("The report holds the photos you took. Items you haven't checked aren't in it, and you can't add photos after you seal.")
            .fixedSize(horizontal: false, vertical: true)
        Button {
            isConfirmingSeal = false
            startSeal()
        } label: {
            Text("Seal Anyway").frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("walkthrough.seal.confirm")
        Button {
            isConfirmingSeal = false
        } label: {
            Text("Keep Checking").frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("walkthrough.seal.keepChecking")
    }

    private var sealTitle: LocalizedStringResource {
        switch sealer.phase {
        case .uploading: "Uploading Photos"
        case .signing: "Sealing"
        default: "Seal Move-In Report"
        }
    }

    // MARK: Actions

    private func seal() {
        if walkthrough.openItems > 0 {
            isConfirmingSeal = true
        } else {
            startSeal()
        }
    }

    private func startSeal() {
        guard let uploads else { return }
        let server = APIClient(auth: auth, serverURL: configuration.serverURL)
        Task { await sealer.seal(walkthrough, uploads: uploads, server: server, deadlines: deadlines) }
    }

    private func announce(_ text: String) {
        AccessibilityNotification.Announcement(text).post()
    }
}

/// One room: its name, how far along it is, and a check once every item is done.
private struct RoomRow: View {
    let room: WalkthroughRoom

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: room.name)
                .font(.headline)
            Label {
                if room.isComplete {
                    Text("All checked")
                } else {
                    Text("\(room.doneCount) of \(room.items.count) done")
                        .monospacedDigit()
                }
            } icon: {
                Image(systemName: room.isComplete ? "checkmark.circle.fill" : "circle.dotted")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
