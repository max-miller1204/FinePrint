import SwiftUI

/// A paragraph of the sent lease text, with its place in that text.
nonisolated struct LeaseParagraph: Identifiable, Hashable, Sendable {
    var id: Int
    var text: String
    /// UTF-16 offsets into the sent text, the way the server's quote spans count.
    var span: TextSpan
}

nonisolated enum LeaseParagraphs {
    /// Splits `text` at blank lines, and long paragraphs at line breaks once they pass
    /// `maxLength` UTF-16 units, so a 40-page lease scrolls as many small rows.
    static func split(_ text: String, maxLength: Int = 1500) -> [LeaseParagraph] {
        var paragraphs: [LeaseParagraph] = []
        var lineStart = text.startIndex
        var paragraphStart: String.Index?
        var paragraphEnd = text.startIndex

        func close() {
            guard let start = paragraphStart else { return }
            let lower = text.utf16.distance(from: text.startIndex, to: start)
            let upper = lower + text.utf16.distance(from: start, to: paragraphEnd)
            paragraphs.append(LeaseParagraph(id: paragraphs.count, text: String(text[start..<paragraphEnd]), span: TextSpan(start: lower, end: upper)))
            paragraphStart = nil
        }

        while lineStart < text.endIndex {
            let lineEnd = text[lineStart...].firstIndex(where: \.isNewline) ?? text.endIndex
            if text[lineStart..<lineEnd].allSatisfy(\.isWhitespace) {
                close()
            } else {
                if paragraphStart == nil { paragraphStart = lineStart }
                paragraphEnd = lineEnd
                if let start = paragraphStart, text.utf16.distance(from: start, to: paragraphEnd) >= maxLength { close() }
            }
            lineStart = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
        }
        close()
        return paragraphs
    }

    @concurrent
    static func splitOffMain(_ text: String) async -> [LeaseParagraph] {
        split(text)
    }

    /// The paragraph that holds `offset`, or the first one after it (an offset in a blank line).
    static func index(containing offset: Int, in paragraphs: [LeaseParagraph]) -> Int? {
        var low = 0
        var high = paragraphs.count
        // The first paragraph that ends after `offset`.
        while low < high {
            let mid = (low + high) / 2
            if paragraphs[mid].span.end <= offset { low = mid + 1 } else { high = mid }
        }
        return low < paragraphs.count ? low : nil
    }

    /// The indexes of the paragraphs `span` overlaps, in order.
    static func indexes(overlapping span: TextSpan, in paragraphs: [LeaseParagraph]) -> [Int] {
        guard span.end > span.start, var index = self.index(containing: span.start, in: paragraphs) else { return [] }
        var result: [Int] = []
        while index < paragraphs.count, paragraphs[index].span.start < span.end {
            result.append(index)
            index += 1
        }
        return result
    }
}

/// The full redacted lease with each finding's clause highlighted and underlined (spec §4.3 F1),
/// and a "Findings" rotor that jumps between them (spec §10.1). Shown in place of the summary, like
/// the review (#99).
struct ClauseExplorerView: View {
    /// The text that was sent: the findings' offsets point into it.
    let text: String
    let findings: [LeaseFinding]
    let language: String
    /// Where to start: a finding's or key term's quote.
    let focus: TextSpan?
    let onClose: () -> Void
    let onOpenFinding: (LeaseFinding) -> Void

    @State private var rows: [Row] = []
    @State private var position: Int?
    @Namespace private var rotor

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                header
                    .id(Self.headerID)
                ForEach(rows) { row in
                    paragraph(row)
                        .id(row.id)
                }
                LegalFooter()
                    .frame(maxWidth: .infinity)
                    .id(Self.footerID)
            }
            .scrollTargetLayout()
            .padding()
        }
        .scrollPosition(id: $position, anchor: .top)
        .leaseBottomClearance()
        .background(Color(.systemBackground))
        .accessibilityRotor("Findings") {
            ForEach(rotorEntries, id: \.finding.id) { entry in
                AccessibilityRotorEntry(Text(entry.label), id: entry.row, in: rotor)
            }
        }
        .accessibilityIdentifier("lease.explorer.view")
        .task(id: TaskKey(text: text, findingIDs: findings.map(\.id))) {
            let paragraphs = await LeaseParagraphs.splitOffMain(text)
            rows = Self.rows(paragraphs, findings: findings, language: language, focus: focus)
            if let focus, let index = LeaseParagraphs.index(containing: focus.start, in: paragraphs) {
                // After the rows are laid out, so the lazy stack can find the row.
                await Task.yield()
                position = index
            }
        }
    }

    private static let headerID = -1
    private static let footerID = -2

    private struct TaskKey: Hashable {
        var text: String
        var findingIDs: [String]
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onClose) {
                Label("Back", systemImage: "chevron.backward")
                    .frame(minHeight: 44)
            }
            .keyboardShortcut(.cancelAction)
            .accessibilityIdentifier("lease.explorer.close")
            Text("Your Lease")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text(findings.isEmpty ? "This is the text that was checked, with personal details hidden." : "Highlighted, underlined text has a finding. Tap a finding's name above its clause to read it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func paragraph(_ row: Row) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(row.marks, id: \.finding.id) { mark in
                Button {
                    onOpenFinding(mark.finding)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        SeverityBadge(severity: mark.finding.severity)
                        Text(verbatim: mark.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("\(String(localized: mark.finding.severity.title)), \(mark.title)"))
                .accessibilityHint(Text("Opens details"))
                .accessibilityAddTraits(.isButton)
                .accessibilityIdentifier("lease.explorer.finding.\(mark.finding.id)")
            }
            Group {
                if let highlighted = row.highlighted {
                    Text(highlighted)
                } else {
                    Text(verbatim: row.paragraph.text)
                }
            }
            .font(.body.monospaced())
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, row.isFocused ? 10 : 0)
        .overlay(alignment: .leading) {
            if row.isFocused {
                Capsule()
                    .fill(.tint)
                    .frame(width: 4)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityRotorEntry(id: row.id, in: rotor)
    }

    /// One rotor stop per finding with a quote, in lease order.
    private var rotorEntries: [(finding: LeaseFinding, row: Int, label: String)] {
        rows.flatMap { row in
            row.marks.map { mark in
                (mark.finding, row.id, "\(String(localized: mark.finding.severity.title)): \(mark.title)")
            }
        }
    }

    // MARK: Rows

    struct Mark {
        var finding: LeaseFinding
        var title: String
    }

    struct Row: Identifiable {
        var paragraph: LeaseParagraph
        /// Nil when nothing in the paragraph has a finding.
        var highlighted: AttributedString?
        /// The findings that start in this paragraph: named above it, and a rotor stop.
        var marks: [Mark]
        var isFocused: Bool
        var id: Int { paragraph.id }
    }

    static func rows(_ paragraphs: [LeaseParagraph], findings: [LeaseFinding], language: String, focus: TextSpan?) -> [Row] {
        var rows = paragraphs.map { Row(paragraph: $0, highlighted: nil, marks: [], isFocused: false) }
        if let focus {
            for index in LeaseParagraphs.indexes(overlapping: focus, in: paragraphs) { rows[index].isFocused = true }
        }
        // Lease order, so the rotor and the names read top to bottom.
        let quoted = findings.compactMap { finding in finding.quoteSpan.map { (finding, $0) } }
            .sorted { $0.1.start < $1.1.start }
        for (finding, span) in quoted {
            let indexes = LeaseParagraphs.indexes(overlapping: span, in: paragraphs)
            for (position, index) in indexes.enumerated() {
                let paragraph = paragraphs[index]
                let local = TextSpan(start: max(span.start, paragraph.span.start) - paragraph.span.start,
                                     end: min(span.end, paragraph.span.end) - paragraph.span.start)
                var highlighted = rows[index].highlighted ?? AttributedString(paragraph.text)
                if let range = local.range(in: paragraph.text), let attributed = Range(range, in: highlighted) {
                    // Underlined as well as tinted, so color is never the only sign.
                    highlighted[attributed].backgroundColor = finding.severity.color.opacity(0.2)
                    highlighted[attributed].underlineStyle = Text.LineStyle(pattern: .solid, color: finding.severity.color)
                }
                rows[index].highlighted = highlighted
                // Named once, above the paragraph the quote starts in.
                if position == 0 {
                    rows[index].marks.append(Mark(finding: finding, title: finding.text(in: language).title))
                }
            }
        }
        return rows
    }
}
