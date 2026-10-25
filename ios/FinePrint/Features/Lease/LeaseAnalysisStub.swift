#if DEBUG
import Foundation

/// `-FinePrintStubFindings <count>`: a made-up check of the sent text, played without the server or
/// a model, so the findings screens can be tried at 0 and 25 findings (`break-ui`) and driven by e2e.
/// Every quote is a real slice of the text, so the clause explorer highlights it.
nonisolated enum LeaseAnalysisStub {
    static func events(for text: String, count: Int) -> [LeaseEvent] {
        let paragraphs = LeaseParagraphs.split(text)
        var events: [LeaseEvent] = [
            .stage(LeaseStage(stage: "S1", label: "", progress: 0.05)),
            .stage(LeaseStage(stage: "S2", label: "", progress: 0.2)),
        ]
        events.append(.keyTerms(keyTerms(in: text)))
        events.append(.stage(LeaseStage(stage: "S5", label: "", progress: 0.55)))
        let severities: [Severity] = [.unenforceable, .ask, .info]
        for index in 0..<max(count, 0) {
            let severity = severities[index % severities.count]
            let quoted = quote(for: index, in: paragraphs, text: text)
            var finding = LeaseFinding.preview(id: "f\(index + 1)", severity: severity, span: quoted?.span)
            finding.leaseQuote = quoted?.text
            if index > 0 {
                finding.titleEn = "Finding \(index + 1): a clause worth reading closely, with a long title that has to wrap at large text sizes"
            }
            events.append(.finding(finding))
        }
        events.append(.stage(LeaseStage(stage: "S8", label: "", progress: 0.88)))
        events.append(.done(LeaseDone(status: .analyzed, findings: max(count, 0), message: nil, replay: nil)))
        return events
    }

    /// The first finding quotes the late fee clause when there is one; the rest take paragraphs in turn.
    private static func quote(for index: Int, in paragraphs: [LeaseParagraph], text: String) -> (text: String, span: TextSpan)? {
        if index == 0, let lateFee = span(of: "late fee", in: text, paragraphs: paragraphs) { return lateFee }
        guard !paragraphs.isEmpty else { return nil }
        let paragraph = paragraphs[index % paragraphs.count]
        return (paragraph.text, paragraph.span)
    }

    /// The whole paragraph that mentions `needle`.
    private static func span(of needle: String, in text: String, paragraphs: [LeaseParagraph]) -> (text: String, span: TextSpan)? {
        guard let range = text.range(of: needle, options: .caseInsensitive) else { return nil }
        let offset = text.utf16.distance(from: text.startIndex, to: range.lowerBound)
        guard let index = LeaseParagraphs.index(containing: offset, in: paragraphs) else { return nil }
        return (paragraphs[index].text, paragraphs[index].span)
    }

    private static func keyTerms(in text: String) -> [LeaseKeyTerm] {
        let wanted: [(name: String, label: String)] = [("monthlyRent", "rent"), ("securityDeposit", "security deposit"), ("lateFee", "late fee")]
        return wanted.compactMap { term in
            guard let range = text.range(of: term.label, options: .caseInsensitive) else { return nil }
            let line = text.lineRange(for: range)
            let quote = text[line].trimmingCharacters(in: .whitespacesAndNewlines)
            let value = quote.firstMatch(of: /\$[0-9,]+(\.[0-9]{2})?|[0-9]+%/).map { String($0.output.0) } ?? quote
            let start = text.utf16.distance(from: text.startIndex, to: line.lowerBound)
            return LeaseKeyTerm(name: term.name, value: value, quote: quote, quoteSpan: TextSpan(start: start, end: start + quote.utf16.count), clauseId: nil)
        }
    }
}
#endif
