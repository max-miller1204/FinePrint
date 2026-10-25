import Foundation
import NaturalLanguage

/// Finds personal details in lease text, on the device (spec §9.2):
/// - patterns for Social Security, bank account, routing, and card numbers, email addresses,
///   dates of birth, driver's licenses, and phone numbers
/// - `NSDataDetector` for phone numbers, street addresses, and links, and for a written date
///   right after a "Date of birth" label
/// - labelled fields ("Tenant: Jordan Lee, 张伟", `Jordan Lee ("Tenant")`, "the owner, Name,") for
///   the people and companies a lease names
/// - `NLTagger` (`.nameType`) for other personal names, places, and organizations
///
/// It errs toward hiding: the tenant reviews every detection and can show one again. Lease terms
/// the analysis needs (amounts, term dates, notice periods, statute citations, "Virginia") are not
/// personal and are left alone. Every place a detector finds is kept as a span and always replaced.
nonisolated struct PIIDetector: Sendable {
    /// Runs every detector over `text` and returns the redaction map, placeholders numbered in the
    /// order the details first appear.
    func redactionMap(for text: String) -> RedactionMap {
        var candidates: [Candidate] = []
        candidates += patternCandidates(in: text)
        candidates += dataDetectorCandidates(in: text)
        candidates += labelledCandidates(in: text)
        // The tagger goes last: where it overlaps a detail found above, only its other words count.
        let covered = candidates.map(\.range).sorted { $0.lowerBound < $1.lowerBound }
        candidates += taggerCandidates(in: text, skipping: covered)
        return Self.map(from: candidates, in: text)
    }

    // MARK: - Candidates

    /// A detection before placeholders are numbered.
    struct Candidate {
        var value: String
        var kind: RedactionKind
        /// Exactly where the detector found it.
        var range: Range<String.Index>
        /// From a label or a quoted role, so its words are a name even when they are also lease words
        /// ("Tenant: April Page").
        var labelled = false
        /// Found by `NLTagger`, the loosest detector.
        var fromTagger = false
    }

    /// The candidate for `range`, trimmed of surrounding whitespace and the given characters.
    private static func candidate(_ range: Range<String.Index>, in text: String, kind: RedactionKind, trimming extra: CharacterSet = [], labelled: Bool = false, fromTagger: Bool = false) -> Candidate? {
        let trim = CharacterSet.whitespacesAndNewlines.union(extra)
        var lower = range.lowerBound, upper = range.upperBound
        while lower < upper, text[lower].unicodeScalars.allSatisfy(trim.contains) { lower = text.index(after: lower) }
        while upper > lower, text[text.index(before: upper)].unicodeScalars.allSatisfy(trim.contains) { upper = text.index(before: upper) }
        guard lower < upper else { return nil }
        return Candidate(value: String(text[lower..<upper]), kind: kind, range: lower..<upper, labelled: labelled, fromTagger: fromTagger)
    }

    /// Strong patterns first: a value found by one of these keeps its kind over a looser detector.
    private func patternCandidates(in text: String) -> [Candidate] {
        var found: [Candidate] = []
        for pattern in Self.patterns {
            for groups in Self.matches(of: pattern.regex, in: text) {
                guard let range = groups[1] ?? groups[0],
                      let candidate = Self.candidate(range, in: text, kind: pattern.kind),
                      pattern.accepts(candidate.value) else { continue }
                found.append(candidate)
            }
        }
        found += birthDateCandidates(in: text)
        return found
    }

    /// The date right after a date-of-birth label, on the same line or the next. A blank
    /// ("________") or another label in between means there is no date of birth to hide.
    private func birthDateCandidates(in text: String) -> [Candidate] {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
        var found: [Candidate] = []
        for groups in Self.matches(of: Self.birthDateLabel, in: text) {
            guard let field = groups[1] else { continue }
            if let date = Self.matches(of: Self.leadingDate, in: String(text[field])).first?[1] {
                let fieldText = String(text[field])
                let offset = fieldText.utf16.distance(from: fieldText.startIndex, to: date.lowerBound)
                let length = fieldText.utf16.distance(from: date.lowerBound, to: date.upperBound)
                let start = text.utf16.index(field.lowerBound, offsetBy: offset)
                let end = text.utf16.index(start, offsetBy: length)
                if let candidate = Self.candidate(start..<end, in: text, kind: .birthDate) { found.append(candidate) }
            } else if let detector, let date = detector.firstMatch(in: text, range: NSRange(field, in: text)),
                      let range = Range(date.range, in: text), text[field.lowerBound..<range.lowerBound].allSatisfy(\.isWhitespace),
                      let candidate = Self.candidate(range, in: text, kind: .birthDate) {
                found.append(candidate)
            }
        }
        return found
    }

    private func dataDetectorCandidates(in text: String) -> [Candidate] {
        let types: NSTextCheckingResult.CheckingType = [.phoneNumber, .address, .link]
        guard let detector = try? NSDataDetector(types: types.rawValue) else { return [] }
        var found: [Candidate] = []
        detector.enumerateMatches(in: text, range: NSRange(text.startIndex..., in: text)) { match, _, _ in
            guard let match, let range = Range(match.range, in: text) else { return }
            switch match.resultType {
            case .phoneNumber:
                // A US number has 7, 10, or 11 digits. A statute section ("55.1-1226"), a nine-digit
                // reference, or a card number does not look like one.
                guard let candidate = Self.candidate(range, in: text, kind: .phone), Self.isPhoneLength(candidate.value) else { return }
                found.append(candidate)
            case .address:
                // A ZIP code or a city alone is not a street address.
                guard match.addressComponents?[.street] != nil, let candidate = Self.candidate(range, in: text, kind: .address) else { return }
                found.append(candidate)
            case .link:
                let kind: RedactionKind = match.url?.scheme == "mailto" ? .email : .link
                guard kind == .email || !Self.isPublicLegalSource(match.url),
                      let candidate = Self.candidate(range, in: text, kind: kind) else { return }
                found.append(candidate)
            default:
                break
            }
        }
        return found
    }

    /// Names and addresses after a label at the start of a line ("Tenant(s): Jordan Lee, 张伟"),
    /// names before a quoted role (`Harbor Point Properties LLC ("Landlord")`), and names after a
    /// role and a comma ("the owner, Beatriz Albuquerque,").
    private func labelledCandidates(in text: String) -> [Candidate] {
        var found: [Candidate] = []
        for groups in Self.matches(of: Self.labelledLine, in: text) {
            guard let labelRange = groups[1], let field = groups[2] else { continue }
            let label = Self.normalizedLabel(String(text[labelRange]))
            let end = Self.fieldEnd(in: text, field: field)
            if Self.addressLabels.contains(label) {
                if let candidate = Self.candidate(field.lowerBound..<end, in: text, kind: .address, trimming: Self.fieldPunctuation, labelled: true),
                   candidate.value.contains(where: \.isLetter), candidate.value.contains(where: \.isNumber) {
                    found.append(candidate)
                }
            } else if let kind = Self.nameLabels[label] {
                found += Self.names(in: field.lowerBound..<end, of: text, kind: kind)
            }
        }
        for groups in Self.matches(of: Self.quotedRole, in: text) {
            guard let roleRange = groups[2], let range = groups[1],
                  let kind = Self.nameLabels[Self.normalizedLabel(String(text[roleRange]))],
                  let candidate = Self.candidate(range, in: text, kind: kind, trimming: Self.fieldPunctuation, labelled: true),
                  Self.looksLikeName(candidate.value) else { continue }
            found.append(candidate)
        }
        for groups in Self.matches(of: Self.roleAppositive, in: text) {
            guard let roleRange = groups[1], let range = groups[2] else { continue }
            let role = Self.normalizedLabel(String(text[roleRange]))
            let kind = Self.nameLabels[role] ?? Self.nameLabels[String(role.dropLast())] ?? .name
            guard let candidate = Self.candidate(range, in: text, kind: kind, trimming: Self.fieldPunctuation, labelled: true),
                  Self.looksLikeName(candidate.value) else { continue }
            found.append(candidate)
        }
        return found
    }

    /// The names in one labelled field, split at commas, semicolons, "and", and "&". A company
    /// name ("Oak & Ivy Rentals, LLC") stays whole except for its legal suffix.
    private static func names(in field: Range<String.Index>, of text: String, kind: RedactionKind) -> [Candidate] {
        let whole = String(text[field])
        let separators = isOrganization(whole) ? Self.companySeparators : Self.nameSeparators
        var parts: [Range<String.Index>] = []
        var start = field.lowerBound
        for groups in matches(of: separators, in: whole) {
            guard let separator = groups[0] else { continue }
            let lower = text.utf16.index(field.lowerBound, offsetBy: whole.utf16.distance(from: whole.startIndex, to: separator.lowerBound))
            let upper = text.utf16.index(field.lowerBound, offsetBy: whole.utf16.distance(from: whole.startIndex, to: separator.upperBound))
            parts.append(start..<lower)
            start = upper
        }
        parts.append(start..<field.upperBound)
        return parts.compactMap { part in
            guard let candidate = candidate(part, in: text, kind: kind, trimming: fieldPunctuation, labelled: true),
                  !companySuffixes.contains(candidate.value.lowercased().trimmingCharacters(in: .punctuationCharacters)),
                  looksLikeName(candidate.value) else { return nil }
            var named = candidate
            if kind == .name, isOrganization(named.value) { named.kind = .organization }
            return named
        }
    }

    /// Where a labelled field stops: an opening parenthesis, a tab, three spaces, or the line's end.
    private static func fieldEnd(in text: String, field: Range<String.Index>) -> String.Index {
        var spaces = 0
        var index = field.lowerBound
        while index < field.upperBound {
            let character = text[index]
            if character == "(" || character == "\t" { return index }
            spaces = character == " " ? spaces + 1 : 0
            if spaces == 3 { return text.index(index, offsetBy: -2) }
            index = text.index(after: index)
        }
        return field.upperBound
    }

    private func taggerCandidates(in text: String, skipping covered: [Range<String.Index>]) -> [Candidate] {
        let tagger = NLTagger(tagSchemes: [.nameType])
        tagger.string = text
        var found: [Candidate] = []
        let options: NLTagger.Options = [.omitWhitespace, .omitPunctuation, .joinNames]
        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .nameType, options: options) { tag, range in
            let kind: RedactionKind? = switch tag {
            case .personalName: .name
            case .placeName: .place
            case .organizationName: .organization
            default: nil
            }
            guard let kind else { return true }
            // Words already hidden by a stronger detector are left to it; the others are kept, so
            // "Maria" in "Maria de la Cruz" is hidden when a label caught only "Cruz".
            let words = Self.wordRanges(in: range, of: text).filter { !Self.isCovered($0, by: covered) }
            guard !words.isEmpty else { return true }
            let wholeWordsUncovered = words.count == Self.wordRanges(in: range, of: text).count
            let pieces = wholeWordsUncovered ? [words.first!.lowerBound..<words.last!.upperBound] : words
            for piece in pieces {
                guard var candidate = Self.candidate(piece, in: text, kind: kind, trimming: .punctuationCharacters, fromTagger: true) else { continue }
                // "Ms. Lee" is Lee.
                let pieceWords = Self.wordRanges(in: candidate.range, of: text)
                if pieceWords.count > 1, Self.honorifics.contains(Self.bare(String(text[pieceWords[0]]))),
                   let trimmed = Self.candidate(pieceWords[1].lowerBound..<candidate.range.upperBound, in: text, kind: kind, fromTagger: true) {
                    candidate = trimmed
                }
                guard candidate.value.count >= 2, !Self.isLeaseVocabulary(candidate.value),
                      Self.startsLikeAName(candidate.value) else { continue }
                found.append(candidate)
            }
            return true
        }
        return found
    }

    // MARK: - Building the map

    /// Merges candidates that are the same detail (keeping every spelling and span), numbers
    /// placeholders per kind in text order, and adds name aliases.
    static func map(from candidates: [Candidate], in text: String) -> RedactionMap {
        struct Entry {
            var candidate: Candidate
            var variants: [String] = []
            var spans: [Range<String.Index>] = []
            var aliases: [String] = []
        }
        var entries: [Entry] = []
        var indexByKey: [String: Int] = [:]
        for candidate in candidates {
            let key = TextMatcher.normalized(candidate.value)
            if let index = indexByKey[key] {
                var entry = entries[index]
                entry.spans.append(candidate.range)
                if !([entry.candidate.value] + entry.variants).contains(candidate.value) { entry.variants.append(candidate.value) }
                if candidate.range.lowerBound < entry.candidate.range.lowerBound {
                    let first = entry.candidate
                    entry.candidate.range = candidate.range
                    entry.candidate.labelled = first.labelled || candidate.labelled
                }
                // Patterns and labels beat the tagger; a role beats a plain name.
                if entry.candidate.kind == .name, candidate.kind.isName, candidate.kind != .name { entry.candidate.kind = candidate.kind }
                if !candidate.fromTagger { entry.candidate.fromTagger = false }
                entry.candidate.labelled = entry.candidate.labelled || candidate.labelled
                entries[index] = entry
            } else {
                indexByKey[key] = entries.count
                entries.append(Entry(candidate: candidate, spans: [candidate.range]))
            }
        }

        for index in entries.indices where entries[index].candidate.kind.isName && !entries[index].candidate.fromTagger {
            entries[index].aliases = aliases(for: entries[index].candidate.value, kind: entries[index].candidate.kind, labelled: entries[index].candidate.labelled)
        }
        // A labelled name that is one word of another ("Name: Jordan" under "Tenant: Jordan Lee") is
        // that person, already hidden by the longer name's aliases.
        var ownersByAlias: [String: Set<Int>] = [:]
        for index in entries.indices {
            for alias in entries[index].aliases { ownersByAlias[TextMatcher.normalized(alias), default: []].insert(index) }
        }
        entries = entries.indices.compactMap { index in
            let entry = entries[index]
            guard entry.candidate.kind.isName, !entry.candidate.fromTagger,
                  let owners = ownersByAlias[TextMatcher.normalized(entry.candidate.value)],
                  owners.contains(where: { $0 != index }) else { return entry }
            return nil
        }
        let knownNameWords = Set(entries.lazy
            .filter { $0.candidate.kind.isName && !$0.candidate.fromTagger }
            .flatMap { [$0.candidate.value] + $0.aliases }
            .map(TextMatcher.normalized))

        // A tagger name is that person when every word is already a known name word ("Marisol" in
        // "Call Marisol"). When only some are ("Kai Lee" next to "Jordan Lee"), the other words are
        // a new person and stay hidden. Ordinary words the tagger joined on ("Call") are not names.
        entries = entries.compactMap { entry in
            var entry = entry
            guard entry.candidate.fromTagger, entry.candidate.kind.isName else { return entry }
            let words = entry.candidate.value.split(whereSeparator: \.isWhitespace).map(String.init)
            let unknown = words.filter { word in
                let bare = bare(word)
                return !knownNameWords.contains(TextMatcher.normalized(bare)) && !honorifics.contains(bare)
                    && !isLeaseVocabulary(bare) && !commonWords.contains(bare) && startsLikeAName(word)
            }
            if unknown.isEmpty { return nil }
            if unknown.count < words.count {
                // Keep the whole phrase, and hide only the new words on their own.
                entry.aliases = unknown.map { $0.trimmingCharacters(in: .punctuationCharacters) }
            } else {
                entry.aliases = aliases(for: entry.candidate.value, kind: entry.candidate.kind, labelled: false)
            }
            return entry
        }

        entries.sort { $0.candidate.range.lowerBound < $1.candidate.range.lowerBound }
        var counters: [String: Int] = [:]
        let redactions = entries.map { entry in
            let prefix = entry.candidate.kind.placeholderPrefix
            counters[prefix, default: 0] += 1
            return Redaction(
                original: entry.candidate.value,
                variants: entry.variants,
                aliases: entry.aliases,
                spans: entry.spans.map { TextSpan($0, in: text) },
                kind: entry.candidate.kind,
                placeholder: "[\(prefix)_\(counters[prefix]!)]"
            )
        }
        return RedactionMap(redactions: redactions)
    }

    /// The single words of a person's name, or a company name without "LLC" and without a generic
    /// last word ("Harbor Point Properties LLC" also hides "Harbor Point Properties" and "Harbor Point").
    /// Only words written with a capital (or in a script without capitals) become aliases. A
    /// labelled name keeps words that are also lease words ("April Page").
    static func aliases(for value: String, kind: RedactionKind, labelled: Bool) -> [String] {
        let words = value.split(whereSeparator: { $0.isWhitespace || $0 == "," }).map(String.init)
        if kind == .organization || isOrganization(value) {
            var core = words
            while let last = core.last, companySuffixes.contains(bare(last)) {
                core.removeLast()
            }
            var aliases: [String] = []
            if core.count < words.count, !core.isEmpty { aliases.append(core.joined(separator: " ")) }
            if core.count > 2, let last = core.last, genericCompanyWords.contains(bare(last)) {
                aliases.append(core.dropLast().joined(separator: " "))
            }
            return aliases
        }
        guard words.count > 1 else { return [] }
        var aliases: [String] = []
        for word in words {
            let trimmed = word.trimmingCharacters(in: .punctuationCharacters.subtracting(CharacterSet(charactersIn: "-'’")))
            let lower = bare(trimmed)
            guard trimmed.count(where: \.isLetter) >= 2, startsLikeAName(trimmed), !honorifics.contains(lower),
                  !particles.contains(lower), labelled || !isLeaseVocabulary(trimmed) else { continue }
            aliases.append(trimmed)
            // "Quintero-Vance" also hides "Quintero" and "Vance".
            let parts = trimmed.split(separator: "-").map(String.init)
            if parts.count > 1 { aliases += parts.filter { $0.count >= 3 && startsLikeAName($0) } }
        }
        return aliases
    }

    // MARK: - Helpers

    /// Each match's capture groups (0 is the whole match), as ranges in `text`.
    static func matches(of regex: NSRegularExpression, in text: String) -> [[Range<String.Index>?]] {
        regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
            (0..<match.numberOfRanges).map { Range(match.range(at: $0), in: text) }
        }
    }

    /// Whether `range` overlaps any of the sorted `covered` ranges.
    private static func isCovered(_ range: Range<String.Index>, by covered: [Range<String.Index>]) -> Bool {
        var low = 0, high = covered.count
        while low < high {
            let mid = (low + high) / 2
            if covered[mid].lowerBound < range.upperBound { low = mid + 1 } else { high = mid }
        }
        // Every covered range before `low` starts before `range` ends; detections are short, so a
        // few back is enough to find one that overlaps.
        var index = low - 1
        while index >= 0, index >= low - 64 {
            if covered[index].overlaps(range) { return true }
            index -= 1
        }
        return false
    }

    /// The whitespace-separated words inside `range`.
    private static func wordRanges(in range: Range<String.Index>, of text: String) -> [Range<String.Index>] {
        var words: [Range<String.Index>] = []
        var start: String.Index?
        var index = range.lowerBound
        while index < range.upperBound {
            if text[index].isWhitespace {
                if let wordStart = start { words.append(wordStart..<index) }
                start = nil
            } else if start == nil {
                start = index
            }
            index = text.index(after: index)
        }
        if let wordStart = start { words.append(wordStart..<range.upperBound) }
        return words
    }

    private static func normalizedLabel(_ label: String) -> String {
        label.lowercased().replacingOccurrences(of: "(s)", with: "")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Lowercased with surrounding punctuation removed.
    private static func bare(_ word: String) -> String {
        word.lowercased().trimmingCharacters(in: .punctuationCharacters)
    }

    private static func startsLikeAName(_ word: String) -> Bool {
        guard let first = word.first(where: { $0.isLetter }) else { return false }
        return first.isUppercase || !TextMatcher.isCased(first)
    }

    /// A name is one to four capitalized words, plus particles such as "de la", with no digits or
    /// money: "Tenant: shall pay rent" and "Tenant: Tenant shall pay $1,450.00" are sentences.
    static func looksLikeName(_ value: String) -> Bool {
        guard !value.contains(where: { $0.isNumber || $0 == "$" || $0 == "_" || $0 == "@" }), value.contains(where: \.isLetter) else { return false }
        let words = value.split(whereSeparator: \.isWhitespace).map(String.init)
        let named = words.filter { $0.contains(where: \.isLetter) && !particles.contains(bare($0)) && !honorifics.contains(bare($0)) }
        guard (1...6).contains(words.count), (1...4).contains(named.count), named.allSatisfy(startsLikeAName) else { return false }
        // "Tenant: Landlord" or "Name: See below" is not anyone's name.
        return !named.allSatisfy { roleWords.contains(bare($0)) }
    }

    static func isOrganization(_ value: String) -> Bool {
        value.split(whereSeparator: { $0.isWhitespace || $0 == "," })
            .contains { companySuffixes.contains(bare(String($0))) || genericCompanyWords.contains(bare(String($0))) }
    }

    /// True when every word is lease or legal vocabulary ("Landlord", "Premises", "Virginia
    /// Residential Landlord and Tenant Act"): the tagger sometimes reads capitalized terms as names.
    static func isLeaseVocabulary(_ value: String) -> Bool {
        let words = value.lowercased()
            .split(whereSeparator: { !$0.isLetter })
            .filter { !$0.isEmpty && $0 != "s" }
        return !words.isEmpty && words.allSatisfy { leaseVocabulary.contains(String($0)) }
    }

    /// Public statute sites are cited, not personal.
    private static func isPublicLegalSource(_ url: URL?) -> Bool {
        guard let host = url?.host()?.lowercased() else { return false }
        return host.hasSuffix(".gov") || host == "law.lis.virginia.gov"
    }

    static func isPhoneLength(_ value: String) -> Bool {
        let digits = value.count(where: \.isNumber)
        if value.hasPrefix("+") { return (8...15).contains(digits) }
        return digits == 7 || digits == 10 || (digits == 11 && value.first(where: \.isNumber) == "1")
    }

    /// The ABA checksum: 3, 7, 1 weights over the nine digits sum to a multiple of 10.
    @Sendable static func isABARoutingNumber(_ value: String) -> Bool {
        let digits = value.compactMap(\.wholeNumberValue)
        guard digits.count == 9, digits.contains(where: { $0 != 0 }) else { return false }
        let weights = [3, 7, 1, 3, 7, 1, 3, 7, 1]
        return zip(digits, weights).reduce(0) { $0 + $1.0 * $1.1 }.isMultiple(of: 10)
    }

    @Sendable static func isLuhnValid(_ value: String) -> Bool {
        let digits = value.compactMap(\.wholeNumberValue)
        guard (13...19).contains(digits.count) else { return false }
        let sum = digits.reversed().enumerated().reduce(0) { total, pair in
            let (index, digit) = pair
            guard index.isMultiple(of: 2) == false else { return total + digit }
            let doubled = digit * 2
            return total + (doubled > 9 ? doubled - 9 : doubled)
        }
        return sum.isMultiple(of: 10)
    }

    // MARK: - Rules

    struct Pattern: Sendable {
        let kind: RedactionKind
        /// Group 1 is the value to hide.
        let regex: NSRegularExpression
        var accepts: @Sendable (String) -> Bool = { _ in true }
    }

    /// Builds a pattern once. `NSRegularExpression` is immutable and safe to share.
    static func regex(_ pattern: String) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
    }

    /// Separators inside numbers: hyphen, the Unicode dashes, a dot, or a space.
    private static let sep = #"[-‐‑–—.\x{20}]"#

    static let patterns: [Pattern] = [
        // 123-45-6789, 123.45.6789, 123 45 6789. A phone number (3-3-4) or ZIP+4 never fits 3-2-4.
        Pattern(kind: .ssn, regex: regex(#"(?<![\d-])(\d{3}"# + sep + #"\d{2}"# + sep + #"\d{4})(?![\d-])"#)),
        // Nine digits after an SSN label: "SSN987654321", "Social Security Number (SSN): 987654321".
        Pattern(kind: .ssn, regex: regex(#"(?i)(?:SSN|SS#|social\s+security(?:\s+(?:number|no\.?|#))?(?:\s*\(SSN\))?)\s*[:#]?\s*(\d{9})(?!\d)"#)),
        Pattern(kind: .email, regex: regex(#"(?i)(?<![\w.%+-])([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b"#)),
        // Routing number after a label (also glued on: "RTN123456780"), or nine digits that pass the ABA checksum.
        Pattern(kind: .routingNumber, regex: regex(#"(?i)(?:routing|ABA|RTN)(?:\s+(?:transit\s+)?(?:number|no\.?|#))?\s*(?:[:#]|[-–])?\s*(\d{9})(?!\d)"#)),
        Pattern(kind: .routingNumber, regex: regex(#"(?<![\d-])(\d{9})(?![\d-])"#), accepts: isABARoutingNumber),
        // Bank account number after a label: at least five digits ("Account Number - 000123456789").
        Pattern(
            kind: .bankAccount,
            regex: regex(#"(?i)\b(?:bank\s+)?(?:account|acct\.?)(?:\s+(?:number|no\.?|#))?\s*(?:[:#]|[-–])?\s*(\d[\d \-]{3,20}\d)(?!\d)"#),
            accepts: { $0.count(where: \.isNumber) >= 5 }
        ),
        // 13 to 19 digits that pass the Luhn check.
        Pattern(kind: .cardNumber, regex: regex(#"(?<![\d-])(\d(?:[ -]?\d){12,18})(?![\d-])"#), accepts: isLuhnValid),
        // After a driver's license label, with an optional state ("VA T12345678", "(VA): T12345678"):
        // letters and digits with at least one digit.
        Pattern(
            kind: .driversLicense,
            regex: regex(#"(?i)\b(?:driver['’]?s?|drivers['’]|operator['’]?s?)\s+licen[cs]e(?:\s*\([a-z]{2}\))?(?:\s+(?:number|no\.?|#))?\s*[:#]?\s*(?:[a-z]{2}[ \t]+(?=[a-z0-9-]*\d))?([a-z0-9][a-z0-9-]{4,15})\b"#),
            accepts: { $0.contains(where: \.isNumber) }
        ),
        Pattern(
            kind: .driversLicense,
            regex: regex(#"(?:\bDL|\bD\.L\.)(?:\s*(?:number|no\.?|#))?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,15})\b"#),
            accepts: { $0.contains(where: \.isNumber) }
        ),
        // A Virginia license number on its own: one letter and eight digits.
        Pattern(kind: .driversLicense, regex: regex(#"(?<![A-Za-z0-9])([A-Z]\d{8})(?![A-Za-z0-9])"#)),
        // A phone number in the usual US forms, in case the data detector misses one in OCR text.
        Pattern(kind: .phone, regex: regex(#"(?<![\d-])((?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]\d{4})(?![\d-])"#)),
    ]

    /// A date-of-birth label. Group 1 is what follows it, up to the end of the next line.
    static let birthDateLabel = regex(#"(?i)(?:\bdate\s+of\s+birth|\bbirth\s*date|\bbirthday|\bD\.?O\.?B(?![a-z])\.?|\bborn(?:\s+on)?\b)\s*[:\-]?[ \t]*((?:[^\n]*\n?[^\n]*))"#)
    /// A date at the very start of a field: 03/14/1990, 1990-03-14, March 14, 1990, 14 March 1990.
    static let leadingDate = regex(#"(?i)^\s*(\d{1,4}[/.\-–]\d{1,2}[/.\-–]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4})"#)

    /// `Label: value` at the start of a line. Group 1 is the label, group 2 the rest of the line.
    static let labelledLine = regex(
        #"(?im)^[ \t]*(?:\d+[.)][ \t]*)?((?:co-?)?(?:tenant|landlord|lessor|lessee|owner|resident|occupant|authorized occupant|applicant|co-applicant|guarantor|co-signer|cosigner|agent|managing agent|property manager|manager|emergency contact|witness|spouse|roommate|name|printed name|signed|signature|tenant name|landlord name|premises|property address|address|rental address|unit address|mailing address)(?:\s*\(s\)|s)?)[ \t]*:[ \t]*([^\n]*)$"#
    )

    /// `Name ("Role")`, as in the opening line of most leases. Particles ("de la") may sit between
    /// the capitalized words.
    static let quotedRole = regex(
        #"((?:(?:[\p{Lu}\p{Lo}][\p{L}.'’&-]*|de|del|la|las|los|da|das|do|dos|di|du|van|von|der|den|le|bin|ibn|al|y)[ \t]+){0,5}[\p{Lu}\p{Lo}][\p{L}.'’&-]*,?)[ \t]*\([ \t]*(?:the[ \t]+)?["“”']([A-Za-z -]+)["“”'][ \t]*\)"#
    )

    /// A role, a comma, then a capitalized name and another comma: "the Landlord, John Smith, may".
    static let roleAppositive = regex(
        #"\b((?i:owner|landlord|lessor|tenant|lessee|agent|property manager|manager|guarantor)s?),[ \t]+((?:[\p{Lu}][\p{L}.'’-]*[ \t]+){0,4}[\p{Lu}][\p{L}.'’-]*)[ \t]*,"#
    )

    /// Between names in one field: "Jordan Lee, 张伟; Sam Ortiz and Mina Lee & Kai Lee".
    static let nameSeparators = regex(#"\s*(?:[,;&]|\band\b)\s*"#)
    /// A company keeps "&" and "and" ("Oak & Ivy Rentals"); only its ", LLC" splits off.
    static let companySeparators = regex(#"\s*[,;]\s*"#)
    static let fieldPunctuation = CharacterSet(charactersIn: ".,:;_")

    static let nameLabels: [String: RedactionKind] = [
        "tenant": .tenant, "tenants": .tenant, "co-tenant": .tenant, "cotenant": .tenant, "co-tenants": .tenant,
        "tenant name": .tenant, "lessee": .tenant, "lessees": .tenant, "resident": .tenant, "residents": .tenant,
        "applicant": .tenant, "applicants": .tenant, "co-applicant": .tenant, "spouse": .tenant, "roommate": .tenant, "roommates": .tenant,
        "landlord": .landlord, "landlords": .landlord, "landlord name": .landlord, "lessor": .landlord, "owner": .landlord, "owners": .landlord,
        "agent": .manager, "managing agent": .manager, "property manager": .manager, "manager": .manager,
        "guarantor": .guarantor, "guarantors": .guarantor, "co-signer": .guarantor, "cosigner": .guarantor,
        "occupant": .occupant, "occupants": .occupant, "authorized occupant": .occupant, "authorized occupants": .occupant,
        "emergency contact": .name, "witness": .name, "witnesses": .name, "name": .name, "printed name": .name,
        "signed": .name, "signature": .name,
    ]

    static let addressLabels: Set<String> = ["premises", "property address", "address", "rental address", "unit address", "mailing address"]

    static let companySuffixes: Set<String> = ["llc", "l.l.c", "inc", "incorporated", "corp", "corporation", "co", "company", "lp", "llp", "ltd", "pllc", "plc"]
    static let genericCompanyWords: Set<String> = ["properties", "property", "management", "realty", "rentals", "apartments", "homes", "group", "partners", "holdings", "investments", "residential", "associates"]
    static let honorifics: Set<String> = ["mr", "mrs", "ms", "mx", "miss", "dr", "jr", "sr", "ii", "iii", "iv"]
    static let particles: Set<String> = ["de", "del", "la", "las", "los", "da", "das", "do", "dos", "di", "du", "van", "von", "der", "den", "le", "bin", "ibn", "al", "y"]
    /// Words that only ever stand for a role or a blank, never for a person.
    static let roleWords: Set<String> = [
        "tenant", "tenants", "landlord", "landlords", "lessor", "lessee", "owner", "agent", "manager", "occupant",
        "occupants", "resident", "guarantor", "applicant", "premises", "lease", "see", "below", "above", "none",
        "n/a", "na", "tbd", "same", "print", "sign", "here", "date",
    ]
    /// Ordinary words that start sentences and that the tagger joins onto a following name.
    static let commonWords: Set<String> = [
        "call", "contact", "email", "text", "phone", "pay", "send", "mail", "please", "ask", "notify", "see",
        "if", "when", "unless", "tell", "write", "reach", "visit", "thank", "thanks", "dear", "attn", "attention",
    ]

    static let leaseVocabulary: Set<String> = [
        "a", "an", "and", "the", "of", "to", "for", "by", "in", "on", "at", "or", "with",
        "landlord", "landlords", "tenant", "tenants", "lessor", "lessee", "owner", "agent", "manager", "management",
        "resident", "residents", "occupant", "occupants", "guarantor", "applicant", "property", "premises", "unit",
        "lease", "leases", "agreement", "addendum", "rent", "rental", "deposit", "security", "term", "terms",
        "section", "sections", "act", "code", "law", "laws", "statute", "virginia", "va", "commonwealth",
        "residential", "united", "states", "america", "usa", "us", "county", "city", "state", "notice", "late",
        "fee", "fees", "utilities", "utility", "date", "birth", "signed", "signature", "contact", "emergency",
        "information", "page", "application", "payment", "payments", "pets", "pet", "parking", "entry", "repairs",
        "maintenance", "move", "inspection", "report", "monday", "tuesday", "wednesday", "thursday", "friday",
        "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august",
        "september", "october", "november", "december", "rules", "regulations", "default", "termination",
        "renewal", "insurance", "smoking", "keys", "appliances", "hoa", "association", "court", "general",
        "district", "attorney", "fair", "housing", "vrlta", "name", "printed", "witness", "dob", "driver",
        "drivers", "license", "licence", "ssn", "social", "number", "phone", "cell", "fax", "email", "routing",
        "account", "bank", "card", "office", "leasing", "zip", "birthday",
    ]
}
