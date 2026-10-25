import SwiftUI

/// One room's checklist. Tapping an item opens the camera for it (spec §4.3 F2).
struct RoomChecklistView: View {
    let walkthrough: Walkthrough
    let roomID: UUID
    @Environment(UploadQueue.self) private var uploads: UploadQueue?
    @Environment(\.evidenceStore) private var evidenceStore
    @State private var cameraTarget: CameraTarget?
    /// The photo whose damage review opens once the camera closes.
    @State private var keptPhotoID: UUID?
    @State private var damageTarget: DamageTarget?

    private var room: WalkthroughRoom? { walkthrough.rooms.first { $0.id == roomID } }

    var body: some View {
        List {
            if let room {
                Section {
                    ItemProgress(done: room.doneCount, total: room.items.count)
                        .padding(.vertical, 4)
                        .accessibilityIdentifier("walkthrough.roomProgress")
                }
                Section {
                    ForEach(room.items) { item in
                        ChecklistRow(
                            item: item,
                            sealStatus: sealStatus(of: item),
                            isLocked: walkthrough.isSealed,
                            open: { open(item, in: room) },
                            reviewDamage: item.photoIDs.last.map { id in { damageTarget = DamageTarget(id: id) } },
                            markNoDamage: { walkthrough.markNoDamage(room: room.id, item: item.id) },
                            reopen: { walkthrough.reopen(room: room.id, item: item.id) }
                        )
                    }
                } header: {
                    Text("Checklist")
                } footer: {
                    if !walkthrough.isSealed {
                        Text("Tap an item to take its photo. Swipe an item to mark no damage or review damage in its photo.")
                    }
                }
            } else {
                ContentUnavailableView("This room is no longer in the walkthrough", systemImage: "questionmark.square.dashed")
            }
        }
        .navigationTitle(Text(verbatim: room?.name ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(item: $cameraTarget, onDismiss: reviewKeptPhoto) { target in
            WalkthroughCamera(target: target, walkthrough: walkthrough) { keptPhotoID = $0 }
        }
        .sheet(item: $damageTarget) { target in
            DamageReviewView(itemID: target.id, rental: walkthrough.rental, store: evidenceStore)
        }
    }

    private func open(_ item: ChecklistItem, in room: WalkthroughRoom) {
        guard !walkthrough.isSealed, let rentalID = walkthrough.rental?.id else { return }
        cameraTarget = CameraTarget(
            roomID: room.id,
            itemID: item.id,
            context: CaptureContext(rentalID: rentalID, room: room.name, checklistItem: item.name),
            progress: "\(walkthrough.doneItems) of \(walkthrough.totalItems) done"
        )
    }

    /// After a photo is kept, its damage suggestions come up for the tenant to confirm or correct.
    private func reviewKeptPhoto() {
        guard let id = keptPhotoID else { return }
        keptPhotoID = nil
        damageTarget = DamageTarget(id: id)
    }

    /// The least-finished status among the item's photos: waiting beats uploaded beats sealed.
    private func sealStatus(of item: ChecklistItem) -> SealStatus? {
        guard let uploads, !item.photoIDs.isEmpty else { return nil }
        let statuses = item.photoIDs.map { uploads.status(for: $0) ?? .waiting }
        for status in [SealStatus.rejected, .waiting, .received] where statuses.contains(status) {
            return status
        }
        return .sealed
    }
}

/// The photo whose damage review is open.
struct DamageTarget: Identifiable {
    let id: UUID
}

/// What the camera needs to open for one item.
struct CameraTarget: Identifiable {
    let id = UUID()
    var roomID: UUID
    var itemID: UUID
    var context: CaptureContext
    var progress: LocalizedStringResource
}

/// One checklist item: the name, where it stands in words and a symbol, and the seal status of its photos.
private struct ChecklistRow: View {
    let item: ChecklistItem
    let sealStatus: SealStatus?
    let isLocked: Bool
    let open: () -> Void
    /// Nil until the item has a photo.
    let reviewDamage: (() -> Void)?
    let markNoDamage: () -> Void
    let reopen: () -> Void

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: item.name)
                    .font(.headline)
                    .foregroundStyle(.primary)
                status
                if let sealStatus {
                    SealStatusPill(status: sealStatus)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(isLocked)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { actions }
        .contextMenu { actions }
        .accessibilityElement(children: .combine)
        .accessibilityHint((isLocked ? Text(verbatim: "") : Text("Opens the camera for this item")))
        .accessibilityAction(named: Text("Mark No Damage"), markNoDamage)
        .accessibilityAction(named: Text("Mark Not Checked"), reopen)
        .accessibilityActions {
            if let reviewDamage {
                Button("Review Damage", action: reviewDamage)
            }
        }
        .accessibilityIdentifier("walkthrough.item.\(item.name.lowercased().replacing(" ", with: "-"))")
    }

    @ViewBuilder
    private var actions: some View {
        // Annotations sit beside the sealed photo, so they stay open after sealing.
        if let reviewDamage {
            Button("Review Damage", systemImage: "rectangle.dashed", action: reviewDamage)
                .tint(.orange)
        }
        if !isLocked {
            if item.outcome == .open {
                Button("No Damage", systemImage: "checkmark.circle", action: markNoDamage)
                    .tint(.blue)
            } else if item.photoIDs.isEmpty {
                Button("Not Checked", systemImage: "arrow.uturn.backward", action: reopen)
            }
        }
    }

    private var status: some View {
        Label {
            switch item.outcome {
            case .open: Text("Not checked")
            case .photographed: Text("Photographed")
            case .noDamage: Text("No damage")
            }
        } icon: {
            Image(systemName: symbol)
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    private var symbol: String {
        switch item.outcome {
        case .open: "circle"
        case .photographed: "camera.fill"
        case .noDamage: "checkmark.circle.fill"
        }
    }
}

/// The camera for one checklist item. Photos kept here are recorded on the item; "Mark No Damage"
/// records the item without a photo.
private struct WalkthroughCamera: View {
    let target: CameraTarget
    let walkthrough: Walkthrough
    var onKept: (UUID) -> Void = { _ in }
    @Environment(AppConfiguration.self) private var configuration
    @Environment(\.evidenceStore) private var evidenceStore

    var body: some View {
        #if DEBUG
        if let fixtureDirectory = configuration.fixtureCameraDirectory {
            CameraScreen(context: target.context, store: evidenceStore, fixtureDirectory: fixtureDirectory, walkthrough: controls, onFinish: kept)
        } else {
            CameraScreen(context: target.context, store: evidenceStore, walkthrough: controls, onFinish: kept)
        }
        #else
        CameraScreen(context: target.context, store: evidenceStore, walkthrough: controls, onFinish: kept)
        #endif
    }

    private var controls: CameraScreen.WalkthroughControls {
        CameraScreen.WalkthroughControls(progress: target.progress) {
            walkthrough.markNoDamage(room: target.roomID, item: target.itemID)
            walkthrough.persist()
        }
    }

    private func kept(_ photo: CapturedPhoto) {
        walkthrough.recordPhoto(photo.record.itemID, room: target.roomID, item: target.itemID)
        walkthrough.persist()
        onKept(photo.record.itemID)
    }
}
