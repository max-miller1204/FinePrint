import SwiftUI

struct SettingsView: View {
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Environment(DeadlineStore.self) private var deadlines
    @Environment(DataDeletion.self) private var deletion
    @Environment(UserSettings.self) private var settings
    @Environment(UploadQueue.self) private var uploads: UploadQueue?
    @Environment(\.evidenceStore) private var evidenceStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var unlock = DeveloperUnlock()
    @State private var unlockCount = 0
    @State private var isConfirmingDelete = false

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section {
                    Picker("Language", selection: $settings.language) {
                        ForEach(AppLanguage.allCases) { language in
                            Text(verbatim: language.nativeName).tag(language)
                        }
                    }
                    .accessibilityIdentifier("settings.language")

                    Picker("Reading Level", selection: $settings.readingLevel) {
                        ForEach(ReadingLevel.allCases) { level in
                            Text(level.title).tag(level)
                        }
                    }
                    .accessibilityIdentifier("settings.readingLevel")
                } header: {
                    Text("Reading")
                } footer: {
                    Text("FinePrint is in English for now. Your language and reading level are saved for when Spanish and simpler explanations arrive.")
                }

                Section {
                    NavigationLink("Share Links") { ShareLinksView() }
                        .accessibilityIdentifier("settings.shareLinks")
                }

                Section {
                    Toggle("Add to the Impact Count", isOn: $settings.impactOptIn)
                        .accessibilityIdentifier("settings.impactOptIn")
                } header: {
                    Text("Privacy")
                } footer: {
                    Text("Adds one to a public count of tenants helped. It never includes your name, your rental, or your documents. Off unless you turn it on.")
                }

                Section {
                    Button("Delete Everything…", role: .destructive) {
                        isConfirmingDelete = true
                    }
                    .disabled(deletion.isDeleting)
                    .accessibilityIdentifier("settings.deleteEverything")
                    // Keep the iOS 26 popover anchored to the row that opens it.
                    .confirmationDialog("Delete everything?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
                        Button("Delete All My Data", role: .destructive, action: deleteEverything)
                            .accessibilityIdentifier("settings.deleteEverything.confirm")
                    } message: {
                        Text("This removes your rentals, photos, and anonymous account from this device and from the server. It can't be undone.")
                    }

                    if deletion.isDeleting {
                        HStack {
                            ProgressView()
                            Text("Deleting…")
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("settings.deleteProgress")
                    }

                    if case .failed(let error) = deletion.phase {
                        WarningLabel(error.message)
                            .accessibilityIdentifier("settings.deleteError")
                    }
                } header: {
                    Text("Your Data")
                } footer: {
                    Text("Removes your rentals, photos, and anonymous account from this device and from the server. Nothing is kept.")
                }

                Section {
                    LabeledContent("Version", value: Self.version)
                        .contentShape(.rect)
                        .onTapGesture(perform: registerVersionTap)
                        .accessibilityIdentifier("settings.version")
                } header: {
                    Text("About")
                } footer: {
                    Text("FinePrint gives legal information, not legal advice.")
                }

                if configuration.isDeveloperMenuUnlocked {
                    Section {
                        NavigationLink {
                            DeveloperMenuView()
                        } label: {
                            Label("Developer Options", systemImage: "hammer")
                        }
                        .accessibilityIdentifier("settings.developerOptions")
                    } header: {
                        Text("Developer")
                    }
                    .transition(.opacity)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) {
                        dismiss()
                    }
                    .accessibilityIdentifier("settings.close")
                }
            }
            .sensoryFeedback(.success, trigger: unlockCount)
            .sensoryFeedback(.error, trigger: deletion.phase) { _, new in
                if case .failed = new { true } else { false }
            }
        }
    }

    /// Runs outside this view's lifetime: once the rentals are gone the tabs, and this sheet with them,
    /// leave the screen, and the receipt takes over.
    private func deleteEverything() {
        let client = APIClient(auth: auth, serverURL: configuration.serverURL)
        let (deadlines, uploads, evidenceStore, settings, auth, deletion) = (deadlines, uploads, evidenceStore, settings, auth, deletion)
        Task {
            await deletion.deleteEverything(client: client) {
                summarizeLocalData(deadlines: deadlines, evidence: evidenceStore)
            } erase: {
                eraseLocalData(deadlines: deadlines, uploads: uploads, evidence: evidenceStore, settings: settings, auth: auth)
            }
        }
    }

    private func registerVersionTap() {
        guard !configuration.isDeveloperMenuUnlocked, unlock.registerTap(at: .now) else { return }
        withAnimation(reduceMotion ? nil : .smooth) {
            configuration.isDeveloperMenuUnlocked = true
        }
        unlockCount += 1
        AccessibilityNotification.Announcement(String(localized: "Developer options are now shown.")).post()
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}

#Preview {
    SettingsView()
        .environment(AppConfiguration.preview())
        .environment(AuthSession.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(DataDeletion())
        .environment(UserSettings.preview())
}
