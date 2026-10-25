import SwiftData
import SwiftUI

struct ShareLinksView: View {
    @Environment(AppConfiguration.self) private var configuration
    @Environment(AuthSession.self) private var auth
    @Query(sort: \Rental.createdAt) private var rentals: [Rental]

    var body: some View {
        Group {
            if let rental = Rental.current(in: rentals), let id = rental.serverID {
                RentalShareLinksView(rentalID: id, client: APIClient(auth: auth, serverURL: configuration.serverURL))
                    .id(id)
            } else {
                ContentUnavailableView("Rental not synced", systemImage: "icloud.slash", description: Text("Connect to the server to sync your rental before sharing."))
            }
        }
        .navigationTitle("Share Links")
    }
}

private struct RentalShareLinksView: View {
    let rentalID: String
    let client: APIClient
    @State private var shares: [ReportShare] = []
    @State private var busy = false
    @State private var loaded = false
    @State private var error: APIError?
    @State private var days = 30
    @State private var usePin = false
    @State private var pin = ""
    @State private var includeLease = true
    @State private var includeEvidence = true
    @State private var createdURL: URL?
    @State private var revoke: ReportShare?

    private var validPin: Bool {
        !usePin || (6...12).contains(pin.count) && pin.utf8.allSatisfy { (48...57).contains($0) }
    }

    var body: some View {
        Form {
            Section {
                Picker("Expires in", selection: $days) {
                    Text("1 day").tag(1)
                    Text("7 days").tag(7)
                    Text("30 days").tag(30)
                }
                Toggle("Lease findings", isOn: $includeLease)
                Toggle("Evidence photos and ledger", isOn: $includeEvidence)
                Toggle("Protect with a PIN", isOn: $usePin)
                if usePin {
                    SecureField("PIN (6 to 12 digits)", text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.newPassword)
                }
                Button("Create Link", action: create)
                    .disabled(busy || !validPin || !(includeLease || includeEvidence))
            } header: {
                Text("New link")
            } footer: {
                Text("Anyone with the link and its PIN can view the selected report sections until it expires or you revoke it. Send the PIN separately. Downloaded copies cannot be recalled.")
            }
            if let createdURL {
                Section {
                    ShareLink("Share New Link", item: createdURL)
                    Text(createdURL.absoluteString)
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                } footer: {
                    Text("Save or share this link now. For your privacy, the server cannot show it again.")
                }
            }
            Section {
                if busy { ProgressView("Updating links…") }
                if let error {
                    WarningLabel(error.message)
                    Button("Retry") { Task { await load() } }.disabled(busy)
                }
                if loaded && shares.isEmpty { Text("No share links yet.").foregroundStyle(.secondary) }
                ForEach(shares) { share in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(status(share))
                            .font(.headline)
                        if let expiry = share.expiry {
                            Text("Expires: \(expiry.formatted(date: .abbreviated, time: .shortened))")
                        }
                        Text(share.requiresPin ? LocalizedStringResource("PIN protected") : LocalizedStringResource("No PIN"))
                            .foregroundStyle(.secondary)
                        if share.scope.contains("lease") { Text("Lease findings").font(.footnote) }
                        if share.scope.contains("evidence") { Text("Evidence photos and ledger").font(.footnote) }
                        NavigationLink("Access Log") { ShareAccessView(shareID: share.id, client: client) }
                        if share.isActive {
                            Button("Revoke Link", role: .destructive) { revoke = share }
                                .disabled(busy)
                                .confirmationDialog("Revoke this link?", isPresented: Binding(get: { revoke?.id == share.id }, set: { if !$0 { revoke = nil } }), titleVisibility: .visible) {
                                    Button("Revoke Link", role: .destructive) { revokeShare(share) }
                                } message: {
                                    Text("This stops new access immediately. Downloaded copies remain with the recipient.")
                                }
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: { Text("Your links") }
        }
        .task { await load() }
        .refreshable { await load() }

    }

    private func revokeShare(_ share: ReportShare) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do throws(APIError) {
                try await client.revokeReportShare(id: share.id)
                createdURL = nil
                shares = try await client.reportShares(rentalID: rentalID)
                error = nil
            } catch { self.error = error }
        }
    }

    private func status(_ share: ReportShare) -> LocalizedStringResource {
        if share.revokedAt != nil { return "Revoked" }
        return share.isActive ? "Active" : "Expired"
    }

    private func load() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            shares = try await client.reportShares(rentalID: rentalID)
            loaded = true
            error = nil
        } catch { self.error = error }
    }

    private func create() {
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do throws(APIError) {
                let scope = (includeLease ? ["lease"] : []) + (includeEvidence ? ["evidence"] : [])
                let share = try await client.createReportShare(rentalID: rentalID, expiresAt: .now.addingTimeInterval(Double(days) * 86400 - 5), pin: usePin ? pin : nil, scope: scope)
                if let path = share.path { createdURL = URL(string: path, relativeTo: client.serverURL)?.absoluteURL }
                pin = ""
                shares = try await client.reportShares(rentalID: rentalID)
                loaded = true
            } catch { self.error = error }
        }
    }
}

private struct ShareAccessView: View {
    let shareID: String
    let client: APIClient
    @State private var access: [ShareAccess] = []
    @State private var nextBefore: String?
    @State private var busy = false
    @State private var loaded = false
    @State private var error: APIError?

    var body: some View {
        List {
            Section {
                if busy { ProgressView("Loading access log…") }
                if let error { WarningLabel(error.message) }
                if loaded && access.isEmpty { Text("No report views yet.") }
                ForEach(Array(access.enumerated()), id: \.offset) { _, view in
                    VStack(alignment: .leading) {
                        Text(verbatim: view.userAgentFamily)
                        if let date = view.date {
                            Text(date, format: .dateTime).foregroundStyle(.secondary)
                        }
                    }.accessibilityElement(children: .combine)
                }
                if nextBefore != nil {
                    Button("Load Older Views") { Task { await load(more: true) } }.disabled(busy)
                }
                Button("Refresh") { Task { await load() } }.disabled(busy)
            } footer: {
                Text("Only successful report opens are recorded. Times and browser families are shown. IP addresses are never stored in this log.")
            }
        }
        .navigationTitle("Access Log")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load(more: Bool = false) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do throws(APIError) {
            let page = try await client.reportShareAccess(id: shareID, before: more ? nextBefore : nil)
            access = more ? access + page.access : page.access
            nextBefore = page.nextBefore
            loaded = true
            error = nil
        } catch { self.error = error }
    }
}
