import SwiftData
import SwiftUI

/// A room the tenant can file an issue in, with the items to pick from.
nonisolated struct IssueRoomChoice: Equatable, Identifiable, Sendable {
    var name: String
    var items: [String]

    var id: String { name }

    /// The walkthrough's rooms first, so a repair names a room the same way its move-in photos do,
    /// then the preset rooms the walkthrough doesn't have.
    static func choices(walkthroughRooms: [WalkthroughRoom]) -> [IssueRoomChoice] {
        var choices = walkthroughRooms.map { IssueRoomChoice(name: $0.name, items: $0.items.map(\.name)) }
        for preset in RoomPreset.allCases where !choices.contains(where: { RoomName.matches($0.name, preset.title) }) {
            choices.append(IssueRoomChoice(name: preset.title, items: preset.checklist))
        }
        return choices
    }
}

/// New Issue (spec §4.3 F4): a short description, where it is, optional photos, then the answer.
struct NewIssueView: View {
    let rental: Rental
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(UserSettings.self) private var settings
    @Environment(UploadQueue.self) private var uploads: UploadQueue?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var draft = IssueDraft()
    @State private var checker = ResponsibilityChecker()
    @State private var isCameraPresented = false
    @FocusState private var isDescriptionFocused: Bool

    var body: some View {
        Group {
            switch checker.phase {
            case .checked(let issue):
                result(issue)
            case .escalated(let category):
                ScrollView {
                    SafetyGuidance(category: category)
                        .padding()
                }
                .background(Color(.systemBackground))
            default:
                form
            }
        }
        .animation(reduceMotion ? nil : .smooth, value: checker.phase)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isFinished {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("issue.done")
                }
            }
        }
        .fullScreenCover(isPresented: $isCameraPresented) {
            IssueCamera(context: cameraContext) { photo in
                draft.photoIDs.append(photo.record.itemID)
            }
        }
        .onChange(of: checker.phase) { _, phase in
            announce(phase)
        }
    }

    private var title: LocalizedStringResource {
        switch checker.phase {
        case .checked: "Who's Responsible"
        case .escalated: "Get Help Now"
        default: "New Issue"
        }
    }

    private var isFinished: Bool {
        switch checker.phase {
        case .checked, .escalated: true
        default: false
        }
    }

    // MARK: Form

    private var form: some View {
        Form {
            Section {
                TextField("Describe the problem", text: $draft.details, axis: .vertical)
                    .lineLimit(4...12)
                    .focused($isDescriptionFocused)
                    .disabled(checker.isBusy)
                    .accessibilityIdentifier("issue.description")
                if draft.trimmedDetails.count > IssueDraft.maxLength {
                    Text("Keep it under \(IssueDraft.maxLength) characters.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("What's wrong")
            } footer: {
                Text("Say what broke, when you noticed, and what you've told your landlord. For example: The heater stopped working on January 3. It's 50 degrees inside.")
            }

            Section {
                Picker("Room", selection: roomSelection) {
                    Text("Not sure").tag(String?.none)
                    ForEach(roomChoices) { room in
                        Text(verbatim: room.name).tag(String?.some(room.name))
                    }
                }
                .pickerStyle(.navigationLink)
                .accessibilityIdentifier("issue.room")
                if let items = selectedRoom?.items {
                    Picker("Item", selection: $draft.checklistItem) {
                        Text("Not sure").tag(String?.none)
                        ForEach(items, id: \.self) { item in
                            Text(verbatim: item).tag(String?.some(item))
                        }
                    }
                    .pickerStyle(.navigationLink)
                    .accessibilityIdentifier("issue.item")
                }
            } header: {
                Text("Where")
            } footer: {
                Text("The room lets FinePrint use your move-in photos of it.")
            }
            .disabled(checker.isBusy)

            photosSection
            checkSection
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var photosSection: some View {
        Section {
            ForEach(Array(draft.photoIDs.enumerated()), id: \.element) { index, id in
                let status = uploads?.status(for: id) ?? .waiting
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Photo \(index + 1)")
                        Text(status.title)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: status.symbolName)
                        .foregroundStyle(status.color)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("issue.photo.\(index)")
            }
            Button("Add Photo", systemImage: "camera") {
                isDescriptionFocused = false
                isCameraPresented = true
            }
            .disabled(!draft.canAddPhoto || checker.isBusy)
            .accessibilityIdentifier("issue.addPhoto")
        } header: {
            Text("Photos")
        } footer: {
            if draft.room == nil {
                Text("Choose a room to add photos.")
            } else {
                Text("Up to \(IssueDraft.maxPhotos) photos. They're saved with the date and time and kept as evidence.")
            }
        }
    }

    private var checkSection: some View {
        Section {
            Button(action: check) {
                HStack(spacing: 8) {
                    if checker.isBusy { ProgressView() }
                    Text(checkTitle)
                }
                .frame(maxWidth: .infinity, minHeight: 28)
                .multilineTextAlignment(.center)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!draft.canCheck || checker.isBusy)
            .keyboardShortcut(.return, modifiers: .command)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            .accessibilityIdentifier("issue.check")

            if let failure = checker.failure {
                Label {
                    Text(failure.message)
                } icon: {
                    Image(systemName: Severity.ask.symbolName)
                        .foregroundStyle(Severity.ask.color)
                }
                .font(.subheadline)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("issue.error")
            }
        } footer: {
            VStack(spacing: 12) {
                Text("FinePrint checks Virginia law, your lease, and your move-in photos. It takes about a minute.")
                LegalFooter()
            }
        }
    }

    private var checkTitle: LocalizedStringResource {
        switch checker.phase {
        case .uploadingPhotos: "Uploading Photos"
        case .checking: "Checking"
        default: "Check Who's Responsible"
        }
    }

    // MARK: Result

    private func result(_ issue: RepairIssue) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let result = issue.result {
                    ResponsibilityCard(issue: issue, result: result)
                }
                if checker.leftOutPhotos > 0 {
                    Text("Some photos didn't upload, so they weren't part of this check.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .background(Color(.systemBackground))
    }

    // MARK: Choices

    private var roomChoices: [IssueRoomChoice] {
        IssueRoomChoice.choices(walkthroughRooms: rental.currentWalkthrough?.rooms ?? [])
    }

    private var selectedRoom: IssueRoomChoice? {
        roomChoices.first { $0.name == draft.room }
    }

    /// A new room clears the item, which belongs to the old one.
    private var roomSelection: Binding<String?> {
        Binding {
            draft.room
        } set: { room in
            if room != draft.room { draft.checklistItem = nil }
            draft.room = room
        }
    }

    private var cameraContext: CaptureContext {
        CaptureContext(
            rentalID: rental.id,
            room: draft.room ?? String(localized: "Repair"),
            checklistItem: draft.checklistItem ?? String(localized: "Repair"),
            session: .incident
        )
    }

    // MARK: Actions

    private func check() {
        isDescriptionFocused = false
        let server = APIClient(auth: auth, serverURL: configuration.serverURL, transport: HTTP.modelTransport)
        let draft = draft
        Task {
            await checker.check(draft, locale: settings.language.rawValue, rental: rental, server: server, uploads: uploads, context: context)
        }
    }

    private func announce(_ phase: ResponsibilityChecker.Phase) {
        let text: String? = switch phase {
        case .checking: String(localized: "Checking who's responsible. It takes about a minute.")
        case .checked(let issue): issue.result.map { String(localized: $0.verdict.title) }
        case .escalated: String(localized: "This sounds like an emergency. Safety steps are on screen.")
        case .failed(let failure): String(localized: failure.message)
        case .idle, .uploadingPhotos: nil
        }
        if let text { AccessibilityNotification.Announcement(text).post() }
    }
}

/// The camera for an issue photo. No walkthrough controls: the photo belongs to the issue.
private struct IssueCamera: View {
    let context: CaptureContext
    let onKept: (CapturedPhoto) -> Void
    @Environment(AppConfiguration.self) private var configuration
    @Environment(\.evidenceStore) private var evidenceStore

    var body: some View {
        #if DEBUG
        if let fixtureDirectory = configuration.fixtureCameraDirectory {
            CameraScreen(context: context, store: evidenceStore, fixtureDirectory: fixtureDirectory, onFinish: onKept)
        } else {
            CameraScreen(context: context, store: evidenceStore, onFinish: onKept)
        }
        #else
        CameraScreen(context: context, store: evidenceStore, onFinish: onKept)
        #endif
    }
}
