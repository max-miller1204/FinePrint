import SwiftUI
import UIKit

/// Gemma's damage proposals on one move-in photo, as boxes the tenant can drag and resize, with
/// Confirm, Adjust, and Not damage for each, and Add for anything it missed (spec §4.3 F2). Every
/// action is also a button in the list, so the review works without dragging. The boxes are
/// stored apart from the photo; the original and its hash never change.
struct DamageReviewView: View {
    let itemID: UUID
    let rental: Rental?
    let store: EvidenceStore
    @State private var model: DamageReviewModel
    @State private var image: UIImage?
    @State private var modelCopy: Data?
    @State private var didLoadImage = false
    @Environment(UploadQueue.self) private var uploads: UploadQueue?
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(itemID: UUID, rental: Rental?, store: EvidenceStore) {
        self.itemID = itemID
        self.rental = rental
        self.store = store
        _model = State(initialValue: DamageReviewModel(itemID: itemID))
    }

    /// The server checked the upload, so the photo can be analyzed.
    private var isUploaded: Bool {
        guard let uploads else { return true }
        switch uploads.status(for: itemID) {
        case .received, .sealed: return true
        case .waiting, .rejected, nil: return false
        }
    }

    private var server: APIClient {
        APIClient(auth: auth, serverURL: configuration.serverURL, transport: HTTP.modelTransport)
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Review Damage")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
        }
        .interactiveDismissDisabled(model.hasUnsavedChanges)
        .task { loadImage() }
        .task(id: isUploaded && rental?.serverID != nil && modelCopy != nil) { await start() }
        .onChange(of: model.phase) { _, phase in announce(phase) }
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: model.phase)
    }

    @ViewBuilder
    private var content: some View {
        if !didLoadImage {
            ProgressView()
        } else if modelCopy == nil {
            ContentUnavailableView(
                "Photo not on this phone",
                systemImage: "photo.badge.exclamationmark",
                description: Text("FinePrint can only review damage on photos taken on this phone.")
            )
        } else {
            List {
                Section {
                    photo
                        .listRowInsets(EdgeInsets())
                } footer: {
                    status
                        .accessibilityIdentifier("damage.status")
                }
                if let error = model.saveError {
                    Section {
                        Label {
                            Text(error)
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .accessibilityIdentifier("damage.saveError")
                    }
                }
                if model.phase == .ready {
                    boxRows
                    Section {
                        Button("Add Damage", systemImage: "plus.rectangle.on.rectangle") { model.addBox() }
                            .frame(minHeight: 44)
                            .accessibilityHint(Text("Adds a box in the middle of the photo for something the suggestions missed"))
                            .accessibilityIdentifier("damage.add")
                    } footer: {
                        Text("Only what you confirm, adjust, or add goes in your report. Suggestions you leave undecided are not included.")
                    }
                }
            }
        }
    }

    // MARK: Photo

    private var photo: some View {
        ZStack {
            Color.black
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(Text("Photo under review"))
                    .overlay {
                        GeometryReader { geometry in
                            ForEach(model.boxes.filter { $0.decision != .rejected }) { box in
                                BoxOverlay(
                                    box: box,
                                    status: statusWord(box),
                                    isEditing: model.editingID == box.id,
                                    size: geometry.size,
                                    onChange: { model.setBox(box.id, to: $0) },
                                    onSelect: { model.editingID = box.id }
                                ) {
                                    boxActions(box)
                                }
                            }
                        }
                        .coordinateSpace(.named(damagePhotoSpace))
                    }
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func boxActions(_ box: ReviewBox) -> some View {
        Button("Confirm") { model.confirm(box.id) }
        Button("Adjust") { model.adjust(box.id) }
        Button("Not Damage") { model.reject(box.id) }
        Button("Move Left") { model.setBox(box.id, to: box.box.moved(dx: -0.05, dy: 0)) }
        Button("Move Right") { model.setBox(box.id, to: box.box.moved(dx: 0.05, dy: 0)) }
        Button("Move Up") { model.setBox(box.id, to: box.box.moved(dx: 0, dy: -0.05)) }
        Button("Move Down") { model.setBox(box.id, to: box.box.moved(dx: 0, dy: 0.05)) }
        Button("Make Larger") { model.setBox(box.id, to: box.box.resized(dWidth: 0.05, dHeight: 0.05)) }
        Button("Make Smaller") { model.setBox(box.id, to: box.box.resized(dWidth: -0.05, dHeight: -0.05)) }
    }

    @ViewBuilder
    private var status: some View {
        switch model.phase {
        case .waitingForUpload:
            Label("Waiting for the photo to upload. Suggestions appear once it's on the server.", systemImage: "icloud.and.arrow.up")
        case .analyzing:
            HStack(spacing: 8) {
                ProgressView()
                Text("Gemma is looking for damage…")
            }
            .accessibilityElement(children: .combine)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 8) {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                Button("Try Again") { Task { await start() } }
                    .frame(minHeight: 44)
            }
        case .ready:
            VStack(alignment: .leading, spacing: 4) {
                if let quality = model.quality, !quality.ok {
                    Label("This photo may be hard to judge. Consider retaking it.", systemImage: "exclamationmark.triangle.fill")
                }
                if model.boxes.isEmpty {
                    Text("No damage suggested. Add a box if you see something.")
                } else {
                    Text("Suggestions are approximate. Drag a box to move it, or drag its corner to resize.")
                }
            }
        }
    }

    // MARK: List

    private var boxRows: some View {
        Section("Suggestions") {
            ForEach(model.boxes) { box in
                BoxRow(
                    box: box,
                    status: statusWord(box),
                    isEditing: model.editingID == box.id,
                    confirm: { model.confirm(box.id) },
                    adjust: { model.adjust(box.id) },
                    reject: { model.reject(box.id) },
                    nudge: { model.setBox(box.id, to: $0) },
                    rename: { model.setLabel(box.id, to: $0) }
                )
            }
        }
    }

    private func statusWord(_ box: ReviewBox) -> LocalizedStringResource {
        switch box.decision {
        case nil: "AI suggested, not confirmed"
        case .confirmed, .adjusted: box.annotation?.decision == .adjusted ? "Adjusted by you" : "Confirmed by you"
        case .added: "Added by you"
        case .rejected: "Not damage"
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
                .accessibilityIdentifier("damage.cancel")
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Save") {
                Task {
                    guard let serverID = rental?.serverID else { return }
                    if await model.save(server: server, rentalServerID: serverID) { dismiss() }
                }
            }
            .disabled(!model.hasUnsavedChanges || model.isSaving || rental?.serverID == nil)
            .accessibilityIdentifier("damage.save")
        }
    }

    // MARK: Loading

    private func loadImage() {
        defer { didLoadImage = true }
        guard let rentalID = rental?.id, image == nil else { return }
        guard let data = try? Data(contentsOf: store.modelCopy(rentalID: rentalID, itemID: itemID)) else { return }
        modelCopy = data
        image = UIImage(data: data)
    }

    private func start() async {
        guard isUploaded, let serverID = rental?.serverID, let modelCopy else { return }
        await model.load(server: server, rentalServerID: serverID, modelCopy: modelCopy)
    }

    private func announce(_ phase: DamageReviewModel.Phase) {
        let text: String? = switch phase {
        case .ready:
            model.boxes.isEmpty
                ? String(localized: "No damage suggested.")
                : String(localized: "\(model.boxes.count) possible damage items. Review each one below the photo.")
        case .failed(let message): message
        case .analyzing, .waitingForUpload: nil
        }
        if let text { AccessibilityNotification.Announcement(text).post() }
    }
}

/// The photo's coordinate space, so a box being dragged measures from a frame that stays still.
private let damagePhotoSpace = "damagePhoto"

/// One box drawn over the photo. Drag the box to move it; drag the corner handle to resize it.
/// For VoiceOver it is one element with an action for each decision and each nudge.
private struct BoxOverlay<Actions: View>: View {
    let box: ReviewBox
    let status: LocalizedStringResource
    let isEditing: Bool
    let size: CGSize
    let onChange: (NormalizedBox) -> Void
    let onSelect: () -> Void
    @ViewBuilder let actions: Actions
    @State private var moveStart: NormalizedBox?
    @State private var resizeStart: NormalizedBox?

    private var color: Color {
        box.decision == nil ? .orange : .green
    }

    var body: some View {
        let frame = CGRect(
            x: box.box.x * size.width,
            y: box.box.y * size.height,
            width: max(box.box.width * size.width, 1),
            height: max(box.box.height * size.height, 1)
        )
        RoundedRectangle(cornerRadius: 4)
            .strokeBorder(color, style: StrokeStyle(lineWidth: isEditing ? 3 : 2, dash: box.decision == nil ? [6, 4] : []))
            .background(RoundedRectangle(cornerRadius: 4).fill(color.opacity(isEditing ? 0.18 : 0.06)))
            .overlay(alignment: .bottomTrailing) {
                if isEditing { handle }
            }
            .frame(width: frame.width, height: frame.height)
            .contentShape(.rect)
            .onTapGesture(perform: onSelect)
            .gesture(move)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: box.label))
            .accessibilityValue(Text(status))
            .accessibilityHint(Text("Use actions to confirm, adjust, or mark not damage"))
            .accessibilityActions { actions }
            .position(x: frame.midX, y: frame.midY)
    }

    private var handle: some View {
        Circle()
            .fill(color)
            .frame(width: 22, height: 22)
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .offset(x: 22, y: 22)
            .gesture(resize)
            .accessibilityHidden(true)
    }

    private var move: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named(damagePhotoSpace))
            .onChanged { value in
                let start = moveStart ?? box.box
                if moveStart == nil {
                    moveStart = start
                    onSelect()
                }
                onChange(start.moved(dx: value.translation.width / max(size.width, 1), dy: value.translation.height / max(size.height, 1)))
            }
            .onEnded { _ in moveStart = nil }
    }

    private var resize: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(damagePhotoSpace))
            .onChanged { value in
                let start = resizeStart ?? box.box
                if resizeStart == nil { resizeStart = start }
                onChange(start.resized(dWidth: value.translation.width / max(size.width, 1), dHeight: value.translation.height / max(size.height, 1)))
            }
            .onEnded { _ in resizeStart = nil }
    }
}

/// One suggestion or added box in the list, with its decision as a word and a symbol, and a button
/// for each action.
private struct BoxRow: View {
    let box: ReviewBox
    let status: LocalizedStringResource
    let isEditing: Bool
    let confirm: () -> Void
    let adjust: () -> Void
    let reject: () -> Void
    let nudge: (NormalizedBox) -> Void
    let rename: (String) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                if box.isAdded {
                    TextField("What is it?", text: labelBinding)
                        .font(.headline)
                        .accessibilityIdentifier("damage.label")
                } else {
                    Text(verbatim: box.label)
                        .font(.headline)
                }
                Label {
                    Text(status)
                } icon: {
                    Image(systemName: symbol)
                }
                .font(.subheadline)
                .foregroundStyle(box.decision == nil ? .orange : .secondary)
                if let severity = box.severity {
                    Text(severity.word)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !box.description.isEmpty, !box.isAdded {
                    Text(verbatim: box.description)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if box.needsRepairPath {
                    Label("You can start a written repair request from the Repairs tab.", systemImage: "wrench.and.screwdriver")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if box.proposal != nil, box.proposal?.box == nil {
                    Text("Gemma couldn't place this one. Adjust the box to show where it is.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)

            actions
            if isEditing { nudgeControls }
        }
        .padding(.vertical, 4)
    }

    private var labelBinding: Binding<String> {
        Binding {
            box.label
        } set: { label in
            rename(label)
        }
    }

    private var symbol: String {
        switch box.decision {
        case nil: "sparkles"
        case .confirmed, .adjusted, .added: "checkmark.circle.fill"
        case .rejected: "xmark.circle"
        }
    }

    @ViewBuilder
    private var actions: some View {
        let layout = dynamicTypeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            Button("Confirm", systemImage: "checkmark", action: confirm)
                .accessibilityLabel(Text("Confirm \(box.label)"))
            Button("Adjust", systemImage: "arrow.up.and.down.and.arrow.left.and.right", action: adjust)
                .accessibilityLabel(Text("Adjust \(box.label)"))
            if box.isAdded {
                Button("Remove", systemImage: "xmark", action: reject)
                    .accessibilityLabel(Text("Remove \(box.label)"))
            } else {
                Button("Not Damage", systemImage: "xmark", action: reject)
                    .accessibilityLabel(Text("\(box.label) is not damage"))
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.regular)
        .labelStyle(.titleAndIcon)
        .frame(minHeight: 44)
    }

    private var nudgeControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Move or resize the box")
                .font(.footnote)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                nudgeButton("Move Left", "arrow.left") { box.box.moved(dx: -0.03, dy: 0) }
                nudgeButton("Move Up", "arrow.up") { box.box.moved(dx: 0, dy: -0.03) }
                nudgeButton("Move Down", "arrow.down") { box.box.moved(dx: 0, dy: 0.03) }
                nudgeButton("Move Right", "arrow.right") { box.box.moved(dx: 0.03, dy: 0) }
                nudgeButton("Make Smaller", "minus.magnifyingglass") { box.box.resized(dWidth: -0.03, dHeight: -0.03) }
                nudgeButton("Make Larger", "plus.magnifyingglass") { box.box.resized(dWidth: 0.03, dHeight: 0.03) }
            }
            .buttonStyle(.bordered)
        }
    }

    private func nudgeButton(_ title: LocalizedStringResource, _ symbol: String, next: @escaping () -> NormalizedBox) -> some View {
        Button {
            nudge(next())
        } label: {
            Image(systemName: symbol)
                .frame(minWidth: 28, minHeight: 28)
        }
        .accessibilityLabel(Text(title))
    }
}
