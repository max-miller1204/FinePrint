import SwiftUI

/// The check against Virginia law on the lease summary (spec §4.3 F1): its status, the key terms
/// card, and the findings as they stream in. Rows open the finding in place (see `LeaseView`).
struct LeaseFindingsSection: View {
    let analysis: LeaseAnalysisModel
    let onAnalyze: () -> Void
    let onRetry: () -> Void
    let onOpenFinding: (LeaseFinding) -> Void
    let onShowInLease: (TextSpan?) -> Void

    var body: some View {
        LeaseCard(title: "Virginia Law Check") {
            AnalysisStatus(analysis: analysis, onAnalyze: onAnalyze, onRetry: onRetry)
        }
        .id(LeaseFindingsSection.statusID)

        if !analysis.keyTerms.isEmpty {
            KeyTermsCard(terms: analysis.keyTerms, canShowInLease: analysis.sentText != nil, onShowInLease: onShowInLease)
        }

        if showsFindings {
            LeaseCard(title: "Findings", footer: footer) {
                if analysis.findings.isEmpty {
                    Text(emptyText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .accessibilityIdentifier("lease.findings.empty")
                } else {
                    ForEach(Array(analysis.findings.enumerated()), id: \.element.id) { index, finding in
                        if index > 0 {
                            Divider()
                                .accessibilityHidden(true)
                        }
                        FindingRow(finding: finding, language: analysis.language) {
                            onOpenFinding(finding)
                        }
                        .id(Self.rowID(finding.id))
                        .transition(transition)
                    }
                }
                if analysis.sentText != nil {
                    Divider()
                        .accessibilityHidden(true)
                    Button {
                        onShowInLease(nil)
                    } label: {
                        Label("Read Your Lease with Highlights", systemImage: "text.viewfinder")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .accessibilityIdentifier("lease.explorer")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("lease.findings")
        }
    }

    static let statusID = "lease.analysis.statusCard"

    static func rowID(_ findingID: String) -> String { "lease.findingRow.\(findingID)" }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var transition: AnyTransition {
        reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity)
    }

    private var showsFindings: Bool {
        switch analysis.phase {
        case .running: true
        case .finished(.analyzed, _): true
        default: !analysis.findings.isEmpty
        }
    }

    private var emptyText: LocalizedStringResource {
        if case .running = analysis.phase { return "Findings appear here as they're ready." }
        return "Nothing in your lease matched a problem on our Virginia checklist."
    }

    private var footer: LocalizedStringResource? {
        analysis.findings.isEmpty ? nil : "Most serious first. Each finding quotes your lease and Virginia law."
    }
}

/// What the check is doing, and the one action that fits.
private struct AnalysisStatus: View {
    let analysis: LeaseAnalysisModel
    let onAnalyze: () -> Void
    let onRetry: () -> Void

    var body: some View {
        switch analysis.phase {
        case .notStarted:
            VStack(alignment: .leading, spacing: 12) {
                Text("FinePrint compares your lease with Virginia's renter law and explains what it finds. Only the text with personal details hidden is sent.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(action: onAnalyze) {
                    Label("Check My Lease", systemImage: "checkmark.shield")
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("lease.analyze")
            }

        case .sending, .running:
            VStack(alignment: .leading, spacing: 10) {
                Text(analysis.phase == .sending ? "Sending your lease" : LeaseStageLabel.text(for: stage))
                    .font(.headline)
                ProgressView(value: progress)
                    .accessibilityLabel(Text("Checking your lease"))
                    .accessibilityValue(Text(progress, format: .percent.precision(.fractionLength(0))))
                Text(analysis.isWaiting ? "Waiting for the checker. This can take a minute." : "Findings appear as they're ready. You can keep using the app.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.analysis.progress")

        case .finished(.analyzed, _):
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Checked against Virginia law")
                        .font(.headline)
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: Severity.verified.symbolName)
                    .foregroundStyle(Severity.verified.color)
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.analysis.done")

        case .finished(.escalated, _):
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("This lease needs a person to look at it")
                        .font(.headline)
                    Text("Something in it may need help soon, so FinePrint stopped instead of guessing. Virginia legal aid can help for free.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: Severity.ask.symbolName)
                    .foregroundStyle(Severity.ask.color)
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.analysis.escalated")

        case .finished(.notALease, let message):
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("This doesn't look like a lease")
                        .font(.headline)
                    if let message {
                        Text(verbatim: message)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            } icon: {
                Image(systemName: Severity.info.symbolName)
                    .foregroundStyle(Severity.info.color)
                    .accessibilityHidden(true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("lease.analysis.notALease")

        case .failed(let failure):
            VStack(alignment: .leading, spacing: 12) {
                Label {
                    Text(failure.message)
                        .font(.subheadline)
                } icon: {
                    Image(systemName: Severity.ask.symbolName)
                        .foregroundStyle(Severity.ask.color)
                        .accessibilityHidden(true)
                }
                .accessibilityIdentifier("lease.analysis.error")
                if failure != .unsupportedJurisdiction {
                    Button(action: onRetry) {
                        Label("Try Again", systemImage: "arrow.clockwise")
                            .frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("lease.analysis.retry")
                }
            }
        }
    }

    private var stage: String? {
        if case .running(let stage, _) = analysis.phase { return stage }
        return nil
    }

    private var progress: Double {
        if case .running(_, let progress) = analysis.phase { return progress }
        return 0
    }

    private var summary: AttributedString {
        let count = analysis.findings.count
        if count == 0 { return AttributedString(localized: "No problems found on our Virginia checklist.") }
        return AttributedString(localized: "^[\(count) finding](inflect: true). Tap one to see what your lease and the law say.")
    }
}

/// Rent, deposit, dates, late fee, and notice (spec §4.3 F1). Each value shows the lease's own
/// words when tapped, in the card, not in a sheet.
private struct KeyTermsCard: View {
    let terms: [LeaseKeyTerm]
    let canShowInLease: Bool
    let onShowInLease: (TextSpan?) -> Void
    @State private var expanded: Set<String> = []

    var body: some View {
        LeaseCard(title: "Key Terms", footer: "Tap a term to see your lease's exact words.") {
            ForEach(Array(terms.enumerated()), id: \.element.id) { index, term in
                if index > 0 {
                    Divider()
                        .accessibilityHidden(true)
                }
                KeyTermRow(
                    term: term,
                    isExpanded: expanded.contains(term.id),
                    canShowInLease: canShowInLease && term.quoteSpan != nil
                ) {
                    if expanded.contains(term.id) {
                        expanded.remove(term.id)
                    } else {
                        expanded.insert(term.id)
                    }
                } onShowInLease: {
                    onShowInLease(term.quoteSpan)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("lease.keyTerms")
    }
}

private struct KeyTermRow: View {
    let term: LeaseKeyTerm
    let isExpanded: Bool
    let canShowInLease: Bool
    let onToggle: () -> Void
    let onShowInLease: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onToggle) {
                HStack(alignment: .firstTextBaseline) {
                    nameAndValue
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(term.title))
            .accessibilityValue(Text(verbatim: term.value))
            .accessibilityHint(Text(isExpanded ? "Hides the lease's words" : "Shows the lease's words"))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("lease.keyTerm.\(term.name)")

            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    QuoteBlock(text: term.quote)
                        .accessibilityLabel(Text("Your lease says: \(term.quote)"))
                        .accessibilityIdentifier("lease.keyTerm.\(term.name).quote")
                    if canShowInLease {
                        Button("Show in Lease", systemImage: "text.viewfinder", action: onShowInLease)
                            .frame(minHeight: 44)
                    }
                }
            }
        }
    }

    /// Side by side, or stacked at accessibility sizes so neither is cut off.
    @ViewBuilder
    private var nameAndValue: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            Text(term.title)
                .foregroundStyle(.secondary)
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Text(verbatim: term.value)
                .fontWeight(.semibold)
                .multilineTextAlignment(dynamicTypeSize.isAccessibilitySize ? .leading : .trailing)
        }
    }
}

/// One finding in the list: severity (symbol, word, color), title, and citation, read as one
/// VoiceOver element (fineprint-ios-ui §3).
struct FindingRow: View {
    let finding: LeaseFinding
    let language: String
    let action: () -> Void

    var body: some View {
        let text = finding.text(in: language)
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    SeverityBadge(severity: finding.severity)
                    Text(verbatim: text.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                    Text(citation)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(String(localized: finding.severity.title)), \(text.title)"))
        .accessibilityValue(Text(citation))
        .accessibilityHint(Text("Opens details"))
        .accessibilityAddTraits(.isButton)
        .accessibilityCustomContent("Your lease says", finding.leaseQuote.map { Text(verbatim: $0) })
        .accessibilityCustomContent("Virginia law says", finding.statuteQuote.map { Text(verbatim: $0) })
        .accessibilityIdentifier("lease.finding.\(finding.id)")
    }

    private var citation: LocalizedStringResource {
        if let citation = finding.citation { return "\(citation)" }
        return "No Virginia rule in our checklist covers this"
    }
}

/// A verbatim quote from the lease or the law: monospaced, selectable, never truncated, on a
/// solid background (fineprint-ios-ui §1, §2, §4).
struct QuoteBlock: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(.body.monospaced())
            .textSelection(.enabled)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color(.tertiarySystemGroupedBackground), in: .rect(cornerRadius: 8))
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(.secondary)
                    .frame(width: 3)
                    .padding(.vertical, 6)
                    .accessibilityHidden(true)
            }
    }
}
