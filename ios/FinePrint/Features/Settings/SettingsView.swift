import SwiftUI

struct SettingsView: View {
    @Environment(AppConfiguration.self) private var configuration
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var unlock = DeveloperUnlock()
    @State private var unlockCount = 0

    var body: some View {
        NavigationStack {
            Form {
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
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
}
