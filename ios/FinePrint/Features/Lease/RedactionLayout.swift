import Foundation

/// Where each redaction appears and how the lease splits into paragraphs. Searching the whole
/// lease is the slow part, so it runs off the main actor, once per change to the list of
/// redactions. Turning one on or off only re-resolves overlaps (`RedactionMap.resolved`).
nonisolated struct RedactionLayout: Sendable {
    var occurrences: [RedactionOccurrence]
    var paragraphs: [Range<String.Index>]
    var counts: [UUID: Int]

    @concurrent
    static func make(text: String, map: RedactionMap) async -> RedactionLayout {
        let occurrences = map.occurrences(in: text)
        var counts: [UUID: Int] = [:]
        for occurrence in occurrences { counts[occurrence.redactionID, default: 0] += 1 }
        return RedactionLayout(occurrences: occurrences, paragraphs: paragraphs(in: text), counts: counts)
    }

    /// Joins lines that wrap mid-sentence. A new paragraph starts after a blank line, after a line
    /// ending a sentence or a field, after an all-caps heading, and at a numbered clause.
    static func paragraphs(in text: String) -> [Range<String.Index>] {
        var paragraphs: [Range<String.Index>] = []
        var start: String.Index?
        var previousLine: Substring?
        var lineStart = text.startIndex
        while lineStart < text.endIndex {
            let lineEnd = text[lineStart...].firstIndex(of: "\n") ?? text.endIndex
            let line = text[lineStart..<lineEnd]
            if line.allSatisfy(\.isWhitespace) {
                if let start, let previous = previousLine { paragraphs.append(start..<previous.endIndex) }
                start = nil
                previousLine = nil
            } else {
                if let current = start, let previous = previousLine, startsParagraph(line, after: previous) {
                    paragraphs.append(current..<previous.endIndex)
                    start = nil
                }
                if start == nil { start = lineStart }
                previousLine = line
            }
            lineStart = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
        }
        if let start, let previous = previousLine { paragraphs.append(start..<previous.endIndex) }
        return paragraphs
    }

    private static func startsParagraph(_ line: Substring, after previous: Substring) -> Bool {
        let last = previous.last { !$0.isWhitespace }
        if let last, ".:;!?\"”)".contains(last) { return true }
        let letters = previous.filter(\.isLetter)
        if !letters.isEmpty, letters.allSatisfy(\.isUppercase) { return true }
        if line.first(where: { !$0.isWhitespace })?.isNumber == true { return true }
        // "Landlord: Harbor Point" lines are fields, one per line.
        if let colon = line.firstIndex(of: ":"), line.distance(from: line.startIndex, to: colon) < 32 { return true }
        return false
    }
}
