import SwiftUI

/// Full-screen camera for one checklist item (spec §4.3 F2). Glass sits only on the floating
/// controls; the photo under review sits on solid black.
struct CameraScreen: View {
    @State private var model: CameraModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let onFinish: (CapturedPhoto) -> Void

    init(context: CaptureContext, store: EvidenceStore, onFinish: @escaping (CapturedPhoto) -> Void = { _ in }) {
        _model = State(initialValue: CameraModel(context: context, store: store))
        self.onFinish = onFinish
    }

    #if DEBUG
    /// The camera with a folder of fixture photos in place of the hardware.
    init(context: CaptureContext, store: EvidenceStore, fixtureDirectory: URL, onFinish: @escaping (CapturedPhoto) -> Void = { _ in }) {
        _model = State(initialValue: CameraModel(context: context, store: store, fixtureDirectory: fixtureDirectory))
        self.onFinish = onFinish
    }
    #endif

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            content
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: model.phase)
        .environment(\.colorScheme, .dark)
        .statusBarHidden()
        .task { await model.run() }
        .sensoryFeedback(trigger: model.phase) { _, phase in
            guard case .review(let photo) = phase else { return nil }
            return photo.issues.isEmpty ? .success : .warning
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .unavailable:
            message(
                title: "Camera not available",
                systemImage: "camera.badge.ellipsis",
                description: "FinePrint can't find a camera on this device. Use an iPhone to take move-in photos.",
                identifier: "camera.unavailable"
            )
        case .accessDenied:
            message(
                title: "Camera access is off",
                systemImage: "camera.fill",
                description: "To photograph your rental, allow camera access for FinePrint in Settings.",
                showsSettingsButton: true,
                identifier: "camera.accessDenied"
            )
        case .failed:
            message(
                title: "The camera didn't start",
                systemImage: "exclamationmark.triangle.fill",
                description: "Close the camera and try again. If it keeps happening, restart your phone.",
                identifier: "camera.failed"
            )
        case .review(let photo):
            CaptureReview(photo: photo, context: model.context, onRetake: model.retake) {
                onFinish(photo)
                dismiss()
            }
            .overlay(alignment: .topLeading) { closeButton.padding() }
            .transition(.opacity)
        case .starting, .ready, .processing:
            viewfinder
                .transition(.opacity)
        }
    }

    private var viewfinder: some View {
        ZStack {
            CameraPreview(session: model.session, onReady: model.attach)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                GlassEffectContainer(spacing: 12) {
                    HStack(alignment: .top, spacing: 12) {
                        closeButton
                        Spacer(minLength: 0)
                        itemTitle
                        Spacer(minLength: 0)
                        flashButton
                    }
                }
                if let guidance = model.guidance, case .issue = guidance {
                    Label {
                        Text(guidance.text)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                    }
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassEffect(.regular, in: .capsule)
                    .accessibilityIdentifier("camera.guidance")
                    .transition(.opacity)
                }
                Spacer()
                ShutterButton(
                    isBusy: model.phase != .ready,
                    label: "Take photo of \(model.context.checklistItem) in \(model.context.room)"
                ) {
                    Task { await model.capture() }
                }
            }
            .padding()
            .animation(reduceMotion ? nil : .smooth(duration: 0.2), value: model.guidance)
        }
    }

    private var itemTitle: some View {
        VStack(spacing: 2) {
            Text(verbatim: model.context.checklistItem)
                .font(.headline)
            Text(verbatim: model.context.room)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("camera.item")
    }

    private var closeButton: some View {
        Button {
            model.discardPhotoUnderReview()
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .keyboardShortcut(.cancelAction)
        .accessibilityLabel("Close camera")
        .accessibilityIdentifier("camera.close")
    }

    @ViewBuilder
    private var flashButton: some View {
        if model.supportsFlash {
            Button {
                model.isFlashOn.toggle()
            } label: {
                Image(systemName: model.isFlashOn ? "bolt.fill" : "bolt.slash.fill")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .accessibilityLabel("Flash")
            .accessibilityValue(model.isFlashOn ? Text("On") : Text("Off"))
            .accessibilityIdentifier("camera.flash")
        } else {
            // Keeps the title centred when there is no flash.
            Color.clear.frame(width: 44, height: 44)
                .accessibilityHidden(true)
        }
    }

    /// A full-screen message with the close button. `identifier` marks the message only, so the
    /// close button keeps its own.
    private func message(title: LocalizedStringResource, systemImage: String, description: LocalizedStringResource, showsSettingsButton: Bool = false, identifier: String) -> some View {
        ScrollView {
            ContentUnavailableView {
                Label {
                    Text(title)
                } icon: {
                    Image(systemName: systemImage)
                }
            } description: {
                Text(description)
            } actions: {
                if showsSettingsButton {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("camera.openSettings")
                }
            }
            .padding(.top, 60)
        }
        .accessibilityIdentifier(identifier)
        .overlay(alignment: .topLeading) { closeButton.padding() }
    }
}

/// White shutter in a ring, like the system camera. Shows progress while a photo is processed.
private struct ShutterButton: View {
    let isBusy: Bool
    let label: LocalizedStringResource
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .strokeBorder(.white, lineWidth: 4)
                    .frame(width: 80, height: 80)
                Circle()
                    .fill(.white)
                    .frame(width: 66, height: 66)
                    .opacity(isBusy ? 0.4 : 1)
                if isBusy {
                    ProgressView()
                        .tint(.black)
                }
            }
            .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .disabled(isBusy)
        .keyboardShortcut(" ", modifiers: [])
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier("camera.shutter")
    }
}

/// The photo just taken, its hash, and either a retake reason or confirmation that it is saved.
private struct CaptureReview: View {
    let photo: CapturedPhoto
    let context: CaptureContext
    let onRetake: () -> Void
    let onUse: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let image = UIImage(data: photo.modelCopy) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .containerRelativeFrame(.vertical) { height, _ in height * 0.6 }
                        .accessibilityLabel(Text("Photo of \(context.checklistItem) in \(context.room)"))
                }
                details
            }
            .padding()
            .padding(.top, 52)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let issue = photo.issues.first {
                Label {
                    Text(issue.retakeReason)
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
                .font(.headline)
                .accessibilityIdentifier("camera.retakeReason")
            } else {
                Label {
                    Text("Photo saved on this device.")
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
                .font(.headline)
                .accessibilityIdentifier("camera.saved")
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("SHA-256 fingerprint")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(verbatim: photo.record.sha256)
                    .font(.body.monospaced())
                    .textSelection(.enabled)
                    .accessibilityIdentifier("camera.hash")
            }
            .accessibilityElement(children: .combine)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { buttons }
                VStack(spacing: 12) { buttons }
            }
            .controlSize(.large)
        }
        .padding(20)
        .frame(maxWidth: 600, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 24))
    }

    @ViewBuilder
    private var buttons: some View {
        if photo.issues.isEmpty {
            Button(action: onUse) {
                Text("Use Photo").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("camera.use")
            Button(action: onRetake) {
                Text("Retake").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("camera.retake")
        } else {
            Button(action: onRetake) {
                Text("Retake").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("camera.retake")
            Button(action: onUse) {
                Text("Keep Photo").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("camera.keep")
        }
    }
}

extension EnvironmentValues {
    /// Where captures are written. The app sets it once at launch; previews use a temporary folder.
    @Entry var evidenceStore = EvidenceStore.live(inMemory: true)
}

extension CaptureContext {
    /// The checklist item the developer menu opens the camera for, until the move-in walkthrough
    /// (#25) supplies real rooms. Its fixed rental ID keeps test photos in one folder.
    static let developerSample = CaptureContext(
        rentalID: UUID(uuidString: "00000000-0000-0000-0000-00000000F1E2")!,
        room: String(localized: "Kitchen"),
        checklistItem: String(localized: "Walls")
    )
}

#Preview {
    CameraScreen(context: .developerSample, store: .live(inMemory: true))
}
