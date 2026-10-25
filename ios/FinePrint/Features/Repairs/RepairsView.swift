import SwiftUI

/// The Repairs tab (spec §4.3 F4): the rental's issues, newest first, and New Issue.
struct RepairsView: View {
    @Environment(DeadlineStore.self) private var deadlines

    var body: some View {
        let rental = deadlines.currentRental
        let issues = rental?.sortedIssues ?? []
        Group {
            if issues.isEmpty {
                emptyState(rental: rental)
            } else {
                list(issues, rental: rental)
            }
        }
        .navigationTitle("Repairs")
        .rentalSubtitle()
        .settingsToolbar()
    }

    private func emptyState(rental: Rental?) -> some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    ContentUnavailableView {
                        Label("No repairs yet", systemImage: "wrench.and.screwdriver")
                    } description: {
                        Text("When something breaks, add it here. You'll see who is likely responsible under Virginia law and your lease, and why.")
                    } actions: {
                        newIssueLink(rental: rental)
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                    }
                    LegalFooter()
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
        .background(Color(.systemBackground))
    }

    private func list(_ issues: [RepairIssue], rental: Rental?) -> some View {
        List {
            Section {
                newIssueLink(rental: rental)
            }
            Section {
                ForEach(issues) { issue in
                    NavigationLink {
                        IssueDetailView(issue: issue)
                    } label: {
                        IssueRow(issue: issue)
                    }
                    .accessibilityIdentifier("issue.row")
                }
            } header: {
                Text("Issues")
            } footer: {
                LegalFooter()
                    .padding(.top, 12)
            }
        }
    }

    @ViewBuilder
    private func newIssueLink(rental: Rental?) -> some View {
        if let rental {
            NavigationLink {
                NewIssueView(rental: rental)
            } label: {
                Label("New Issue", systemImage: "plus")
            }
            .accessibilityIdentifier("repairs.newIssue")
        } else {
            Button("New Issue", systemImage: "plus") {}
                .disabled(true)
                .accessibilityIdentifier("repairs.newIssue")
        }
    }
}

/// "Legal information, not legal advice." on every Repairs screen (spec §7.12).
struct LegalFooter: View {
    var body: some View {
        Text("Legal information, not legal advice.")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding([.horizontal, .bottom])
    }
}

/// One issue in the list: the verdict, the tenant's words, and the day.
private struct IssueRow: View {
    let issue: RepairIssue

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let result = issue.result {
                Label {
                    Text(result.verdict.title)
                } icon: {
                    Image(systemName: result.verdict.symbolName)
                }
                .font(.headline)
            }
            Text(verbatim: issue.details)
                .lineLimit(2)
            Text(rowDetail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Opens details"))
    }

    private var rowDetail: LocalizedStringResource {
        let day = issue.createdAt.formatted(.dateTime.month(.abbreviated).day())
        if let room = issue.room {
            return "\(room), \(day)"
        }
        return "\(day)"
    }
}

/// A saved issue and its answer.
struct IssueDetailView: View {
    let issue: RepairIssue

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What you described")
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: issue.details)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                if let result = issue.result {
                    ResponsibilityCard(issue: issue, result: result)
                }
            }
            .padding()
        }
        .background(Color(.systemBackground))
        .navigationTitle("Issue")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationStack { RepairsView() }
        .environment(AppConfiguration.preview())
        .environment(DeadlineStore(launchOptions: LaunchOptions()))
        .environment(AppNavigation())
}
