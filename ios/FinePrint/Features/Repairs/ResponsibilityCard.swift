import SwiftUI

/// The answer to "Who pays for this?" (spec §4.3 F4): verdict, category, confidence, the cited
/// reasons, and what would change the answer. Content on a solid background, no glass.
struct ResponsibilityCard: View {
    let issue: RepairIssue
    let result: ResponsibilityResult
    @Environment(UserSettings.self) private var settings: UserSettings?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            summary
            if issue.needsHandoff {
                handoffNote
            }
            reasons
            if !result.whatWouldChange.isEmpty {
                whatWouldChange
            }
            if result.escrowEligible {
                escrowNote
            }
            if settings?.showsAITrace == true, let trace = result.trace, !trace.isEmpty {
                AITraceView(steps: trace)
            }
            Text("Legal information, not legal advice.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: Summary

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(result.verdict.title)
                    .accessibilityIdentifier("issue.verdict")
            } icon: {
                // The symbol repeats the verdict, and VoiceOver would read its own name for it.
                Image(systemName: result.verdict.symbolName)
                    .accessibilityHidden(true)
            }
            .font(.title2.weight(.semibold))
            .accessibilityAddTraits(.isHeader)

            Text(result.category.title)
                .font(.headline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("issue.category")

            ConfidenceLabel(confidence: result.confidence)
                .font(.subheadline.weight(.semibold))
                .accessibilityIdentifier("issue.confidence")

            if let checkNote {
                Text(checkNote)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("issue.verification")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }

    /// What the second check said, when there was one.
    private var checkNote: LocalizedStringResource? {
        if result.downgraded {
            return "A second check didn't fully agree, so this answer says medium, not high."
        }
        switch result.verification.status {
        case .agreed: return "A second check of the cited law and lease agreed."
        case .notNeeded, .disagreed, .unavailable: return nil
        }
    }

    private var handoffNote: some View {
        Label {
            Text("Part of what you described may need a person's help soon. A legal aid office can help, for free if you qualify.")
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: Severity.ask.symbolName)
                .foregroundStyle(Severity.ask.color)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("issue.handoff")
    }

    // MARK: Reasons

    private var reasons: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Why")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if result.reasons.isEmpty {
                Text("FinePrint couldn't find a rule or lease clause that answers this, so it can't say who is responsible.")
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(result.reasons.enumerated()), id: \.offset) { index, reason in
                ReasonRow(reason: reason)
                    .accessibilityIdentifier("issue.reason.\(index)")
            }
        }
    }

    private var whatWouldChange: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What would change this answer")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(result.whatWouldChange.enumerated()), id: \.offset) { index, change in
                Label {
                    Text(verbatim: change)
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "arrow.triangle.branch")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .accessibilityIdentifier("issue.change.\(index)")
            }
        }
    }

    private var escrowNote: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("If it isn't fixed")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("Start with a written repair request. If your landlord still doesn't fix it, Virginia has a court process called rent escrow. Don't stop paying rent on your own. Talk to legal aid first.")
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("issue.escrow")
    }
}

/// One reason and what it rests on. The reason and its source are one VoiceOver element; the
/// verbatim quote is custom content, not part of the label. "Read the Law" stays its own control.
private struct ReasonRow: View {
    let reason: ResponsibilityReason

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            explained
            if case .rule(let rule) = reason.citation, let url = URL(string: rule.sourceUrl), url.scheme == "https" {
                Link("Read the Law", destination: url)
                    .font(.subheadline)
                    .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var explained: some View {
        let content = VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: reason.text)
                .fixedSize(horizontal: false, vertical: true)
            source
        }
        .accessibilityElement(children: .combine)
        if let quote {
            content.accessibilityCustomContent(Text("Quote"), Text(verbatim: quote))
        } else {
            content
        }
    }

    @ViewBuilder
    private var source: some View {
        switch reason.citation {
        case .rule(let rule):
            Label {
                Text("Virginia law, \(rule.citation)")
            } icon: {
                Image(systemName: "building.columns")
            }
            .font(.subheadline.weight(.semibold))
            Quote(text: rule.quote)
        case .lease(let lease):
            Label {
                if let heading = lease.heading {
                    Text("Your lease, \(heading)")
                } else {
                    Text("Your lease")
                }
            } icon: {
                Image(systemName: "doc.text")
            }
            .font(.subheadline.weight(.semibold))
            Quote(text: lease.quote)
        case .evidence(let photo):
            Label {
                Text("Your move-in photo: \(photo.room), \(photo.checklistItem)")
            } icon: {
                Image(systemName: "photo")
            }
            .font(.subheadline.weight(.semibold))
            Text(photoDetail(photo))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func photoDetail(_ photo: EvidenceCitation) -> LocalizedStringResource {
        let taken = Self.deviceDate(photo.capturedAtDevice)?.formatted(.dateTime.month(.wide).day().year()) ?? photo.capturedAtDevice
        return photo.sealedManifestId == nil ? "Taken \(taken). Not sealed yet." : "Taken \(taken). Sealed in your move-in report."
    }

    /// The verbatim text, for VoiceOver's "more content". A photo has none.
    private var quote: String? {
        switch reason.citation {
        case .rule(let rule): rule.quote
        case .lease(let lease): lease.quote
        case .evidence: nil
        }
    }

    private static func deviceDate(_ text: String) -> Date? {
        try? Date(text, strategy: .iso8601)
    }
}

/// Verbatim legal text: monospaced, selectable, never truncated.
private struct Quote: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(.body.monospaced())
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, 12)
            // Read as the row's custom content instead.
            .accessibilityHidden(true)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(.tertiary)
                    .frame(width: 3)
                    .accessibilityHidden(true)
            }
    }
}
