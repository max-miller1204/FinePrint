import SwiftUI

/// Hidden developer options: the server address, the anonymous sign-in, a way to try the
/// evidence camera, and, in DEBUG builds, sample data switches.
struct DeveloperMenuView: View {
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(\.dismiss) private var dismiss
    @Environment(\.evidenceStore) private var evidenceStore
    @State private var draft = ""
    @State private var error: ServerURLError?
    @State private var saveCount = 0
    @State private var isCameraPresented = false
    @State private var lastCapture: CaptureRecord?
    @FocusState private var isFieldFocused: Bool

    var body: some View {
        Form {
            Section {
                LabeledContent("In Use") {
                    Text(verbatim: configuration.serverURL.absoluteString)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                }
                .accessibilityIdentifier("developer.activeServerURL")
                LabeledContent("Source") {
                    Text(sourceDescription)
                }
                .accessibilityIdentifier("developer.serverURLSource")
            } header: {
                Text("Server")
            } footer: {
                if configuration.serverURLSource == .launchArgument {
                    Text("A launch argument sets the server for this launch. Saved changes apply the next time the app opens without it.")
                }
            }

            Section {
                TextField("Server URL", text: $draft, prompt: Text(verbatim: ServerURL.defaultURL.absoluteString))
                    .font(.body.monospaced())
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($isFieldFocused)
                    .onSubmit(save)
                    .accessibilityIdentifier("developer.serverURLField")

                if let error {
                    Label {
                        Text(error.message)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .font(.footnote)
                    .accessibilityIdentifier("developer.serverURLError")
                }

                Button("Save Server URL", action: save)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("developer.saveServerURL")

                Button("Reset to Default", action: reset)
                    .disabled(configuration.storedServerURL == nil)
                    .accessibilityIdentifier("developer.resetServerURL")
            } header: {
                Text("Change Server")
            } footer: {
                Text("Use http:// or https:// with a host name, for example https://fineprint.example.org.")
            }

            AccountSection()

            Section {
                Button("Open Camera") {
                    isCameraPresented = true
                }
                .accessibilityIdentifier("developer.openCamera")
                if let lastCapture {
                    LabeledContent("Last Photo SHA-256") {
                        Text(verbatim: lastCapture.sha256)
                            .font(.body.monospaced())
                            .textSelection(.enabled)
                    }
                    .accessibilityIdentifier("developer.lastCaptureHash")
                }
            } header: {
                Text("Camera")
            } footer: {
                Text("Takes a test photo for the kitchen walls. It is hashed and saved on this device only.")
            }

            #if DEBUG
            Section {
                Toggle("Show Sample Deadline", isOn: sampleDeadlineBinding)
                    .accessibilityIdentifier("developer.sampleDeadlineToggle")
            } header: {
                Text("Sample Data")
            } footer: {
                Text("Turns the deadline above the tab bar on or off so both states can be checked.")
            }
            #endif

            Section {
                Button("Hide Developer Options") {
                    configuration.isDeveloperMenuUnlocked = false
                    dismiss()
                }
                .accessibilityIdentifier("developer.hide")
            }
        }
        .navigationTitle("Developer Options")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            draft = configuration.storedServerURL ?? ""
        }
        .onChange(of: draft) {
            error = nil
        }
        .sensoryFeedback(.success, trigger: saveCount)
        .fullScreenCover(isPresented: $isCameraPresented) {
            CameraScreen(context: .developerSample, store: evidenceStore) { photo in
                lastCapture = photo.record
            }
        }
    }

    private var sourceDescription: LocalizedStringResource {
        switch configuration.serverURLSource {
        case .launchArgument: "Launch argument"
        case .developerMenu: "Saved here"
        case .builtInDefault: "Default"
        }
    }

    #if DEBUG
    private var sampleDeadlineBinding: Binding<Bool> {
        Binding(
            get: { deadlines.showsSample },
            set: { deadlines.showsSample = $0 }
        )
    }
    #endif

    private func save() {
        do throws(ServerURLError) {
            let url = try configuration.saveServerURL(draft)
            draft = url.absoluteString
            error = nil
            isFieldFocused = false
            saveCount += 1
            AccessibilityNotification.Announcement(String(localized: "Server address saved.")).post()
            // Each server names its own Firebase project, so the account may need to change.
            Task { await auth.start() }
        } catch {
            self.error = error
            AccessibilityNotification.Announcement(String(localized: error.message)).post()
        }
    }

    private func reset() {
        configuration.resetServerURL()
        draft = ""
        error = nil
        AccessibilityNotification.Announcement(String(localized: "Server address reset to default.")).post()
        Task { await auth.start() }
    }
}

#Preview {
    NavigationStack { DeveloperMenuView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AuthSession.preview())
}
