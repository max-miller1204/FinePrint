import SwiftUI

/// One finding (spec §4.3 F1): the plain-language explanation, the lease's words, Virginia law's
/// words with a link to the statute, and what the tenant can do. Shown in place of the summary,
/// with its own Back button, for the same reason as the review (#99).
struct FindingDetailView: View {
    let finding: LeaseFinding
    let language: String
    let onClose: () -> Void
    /// Opens the clause explorer at this finding's clause. Nil when the sent text isn't available.
    let onShowInLease: (() -> Void)?

    var body: some View {
        let text = finding.text(in: language)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Button(action: onClose) {
                    Label("Back", systemImage: "chevron.backward")
                        .frame(minHeight: 44)
                }
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("lease.finding.close")

                VStack(alignment: .leading, spacing: 10) {
                    SeverityBadge(severity: finding.severity)
                    Text(verbatim: text.title)
                        .font(.title2.bold())
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("lease.finding.title")
                    Text(verbatim: text.explanation)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("lease.finding.explanation")
                }

                if let leaseQuote = finding.leaseQuote {
                    section("What your lease says") {
                        QuoteBlock(text: leaseQuote)
                            .accessibilityIdentifier("lease.finding.leaseQuote")
                        if let onShowInLease, finding.quoteSpan != nil {
                            Button("Show in Lease", systemImage: "text.viewfinder", action: onShowInLease)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("lease.finding.showInLease")
                        }
                    }
                }

                if finding.hasRule {
                    section("What Virginia law says") {
                        if let statuteQuote = finding.statuteQuote {
                            QuoteBlock(text: statuteQuote)
                                .accessibilityIdentifier("lease.finding.statuteQuote")
                        }
                        if let citation = finding.citation {
                            Text(verbatim: citation)
                                .font(.subheadline.weight(.semibold))
                                .accessibilityIdentifier("lease.finding.citation")
                        }
                        if let url = finding.statuteURL {
                            Link(destination: url) {
                                Label("Read the Law on law.lis.virginia.gov", systemImage: "arrow.up.right.square")
                                    .frame(minHeight: 44, alignment: .leading)
                            }
                            .accessibilityHint(Text("Opens in Safari"))
                            .accessibilityIdentifier("lease.finding.statuteLink")
                        }
                    }
                } else {
                    section("Virginia law") {
                        Text("No Virginia rule in our checklist covers this. The explanation above is plain information, not a legal finding.")
                            .font(.body)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("lease.finding.noRule")
                    }
                }

                section("What you can do") {
                    Text(verbatim: text.action)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("lease.finding.action")
                }

                LegalFooter()
                    .frame(maxWidth: .infinity)
            }
            .padding()
        }
        .leaseBottomClearance()
        .background(Color(.systemGroupedBackground))
        .accessibilityIdentifier("lease.finding.detail")
    }

    private func section(_ title: LocalizedStringResource, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 12))
    }
}

#if DEBUG
#Preview {
    FindingDetailView(finding: .preview(severity: .unenforceable), language: "en", onClose: {}, onShowInLease: {})
}

nonisolated extension LeaseFinding {
    /// A late fee finding for previews and the DEBUG stub (`-FinePrintStubFindings`).
    static func preview(id: String = "f1", severity: Severity, span: TextSpan? = nil) -> LeaseFinding {
        LeaseFinding(
            id: id,
            severity: severity,
            ruleId: severity == .info ? nil : "va-late-fee-cap",
            citation: severity == .info ? nil : "Va. Code § 55.1-1204(E)",
            sourceUrl: severity == .info ? nil : "https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1204/",
            statuteQuote: severity == .info ? nil : "No landlord shall charge a late fee in excess of the lesser of 10 percent of the periodic rent or 10 percent of the remaining balance due and owed by the tenant.",
            clauseId: "c4",
            leaseQuote: "A late fee of 15% of the monthly rent is charged after the 5th.",
            quoteSpan: span,
            titleEn: "The late fee is higher than Virginia allows",
            explanationEn: "Your lease charges 15% of the rent as a late fee. Virginia law caps late fees at 10% of the rent.",
            actionEn: "You can ask the landlord to change the late fee to 10% before you sign. A fee above the cap can't be enforced either way.",
            translations: nil
        )
    }
}
#endif
