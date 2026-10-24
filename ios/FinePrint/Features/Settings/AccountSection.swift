import SwiftUI

/// Developer-menu rows for the anonymous sign-in: its status, the user ID, when the ID token
/// expires, and a round trip to `/v1/me` that proves the server accepts the token.
struct AccountSection: View {
    @Environment(AuthSession.self) private var auth
    @Environment(AppConfiguration.self) private var configuration
    @State private var check = ServerCheck.idle

    enum ServerCheck: Equatable {
        case idle
        case checking
        case accepted
        case failed(APIError)
    }

    var body: some View {
        Section {
            LabeledContent("Status") {
                Text(statusText)
            }
            .accessibilityIdentifier("developer.authStatus")

            if case .signedIn(let uid, let tokenExpiresAt) = auth.state {
                LabeledContent("User ID") {
                    Text(verbatim: uid)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                }
                .accessibilityIdentifier("developer.userID")
                LabeledContent("ID Token") {
                    Text("Valid until \(Text(tokenExpiresAt, style: .time))")
                }
                .accessibilityIdentifier("developer.idToken")
            }

            if case .failed(let error) = auth.state {
                WarningLabel(error.message)
                    .accessibilityIdentifier("developer.authError")
                Button("Try Signing In Again") {
                    Task { await auth.start() }
                }
                .accessibilityIdentifier("developer.retrySignIn")
            }

            Button(action: checkServer) {
                HStack {
                    Text("Check with Server")
                    Spacer()
                    if check == .checking {
                        ProgressView()
                    }
                }
            }
            .disabled(check == .checking || auth.state == .signingIn)
            .accessibilityIdentifier("developer.checkServer")

            switch check {
            case .idle, .checking:
                EmptyView()
            case .accepted:
                Label {
                    Text("The server accepted this sign-in.")
                } icon: {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                }
                .font(.footnote)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("developer.serverCheckResult")
            case .failed(let error):
                WarningLabel(error.message)
                    .accessibilityIdentifier("developer.serverCheckResult")
            }
        } header: {
            Text("Account")
        } footer: {
            Text("FinePrint signs in without an account. It never asks for an email or phone number.")
        }
        .onChange(of: configuration.serverURL) {
            check = .idle
        }
        .sensoryFeedback(trigger: check) { _, new in
            switch new {
            case .accepted: .success
            case .failed: .error
            case .idle, .checking: nil
            }
        }
    }

    private var statusText: LocalizedStringResource {
        switch auth.state {
        case .signedOut: "Not signed in"
        case .signingIn: "Signing in…"
        case .signedIn: "Signed in anonymously"
        case .failed: "Couldn't sign in"
        }
    }

    private func checkServer() {
        check = .checking
        let client = APIClient(auth: auth, serverURL: configuration.serverURL)
        Task {
            do throws(APIError) {
                _ = try await client.me()
                check = .accepted
                AccessibilityNotification.Announcement(String(localized: "The server accepted this sign-in.")).post()
            } catch {
                check = .failed(error)
                AccessibilityNotification.Announcement(String(localized: error.message)).post()
            }
        }
    }
}

/// An orange warning triangle and a message, for errors inside a form.
private struct WarningLabel: View {
    let message: LocalizedStringResource

    init(_ message: LocalizedStringResource) {
        self.message = message
    }

    var body: some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
        .font(.footnote)
        // One element, so VoiceOver reads the warning as a single line and the id names one node.
        .accessibilityElement(children: .combine)
    }
}

#Preview("Signed in") {
    Form { AccountSection() }
        .environment(AppConfiguration.preview())
        .environment(AuthSession.preview())
}

#Preview("Signed out") {
    Form { AccountSection() }
        .environment(AppConfiguration.preview())
        .environment(AuthSession.preview(signedIn: false))
}
