import Foundation

/// What a hidden detail is. The placeholder prefix is what the server sees in its place, so the
/// lease still reads ("[LANDLORD_1] may enter the Premises") without the detail itself.
nonisolated enum RedactionKind: String, Codable, CaseIterable, Sendable {
    case tenant
    case landlord
    case manager
    case guarantor
    case occupant
    case name
    case organization
    case place
    case address
    case phone
    case email
    case link
    case ssn
    case bankAccount
    case routingNumber
    case cardNumber
    case birthDate
    case driversLicense
    /// Text the tenant chose to hide.
    case custom

    var placeholderPrefix: String {
        switch self {
        case .tenant: "TENANT"
        case .landlord: "LANDLORD"
        case .manager: "MANAGER"
        case .guarantor: "GUARANTOR"
        case .occupant: "OCCUPANT"
        case .name: "NAME"
        case .organization: "ORG"
        case .place: "PLACE"
        case .address: "ADDRESS"
        case .phone: "PHONE"
        case .email: "EMAIL"
        case .link: "LINK"
        case .ssn: "SSN"
        case .bankAccount: "ACCOUNT"
        case .routingNumber: "ROUTING"
        case .cardNumber: "CARD"
        case .birthDate: "DOB"
        case .driversLicense: "LICENSE"
        case .custom: "HIDDEN"
        }
    }

    /// A person's (or a company's) name: its single words are hidden too, so "Ms. Lee" goes with
    /// "Jordan Lee".
    var isName: Bool {
        switch self {
        case .tenant, .landlord, .manager, .guarantor, .occupant, .name, .organization: true
        default: false
        }
    }

    /// Shown in the review list, in the tenant's words.
    var title: LocalizedStringResource {
        switch self {
        case .tenant: "Tenant"
        case .landlord: "Landlord"
        case .manager: "Property manager"
        case .guarantor: "Guarantor"
        case .occupant: "Occupant"
        case .name: "Name"
        case .organization: "Company"
        case .place: "Place"
        case .address: "Address"
        case .phone: "Phone number"
        case .email: "Email"
        case .link: "Web address"
        case .ssn: "Social Security number"
        case .bankAccount: "Bank account number"
        case .routingNumber: "Routing number"
        case .cardNumber: "Card number"
        case .birthDate: "Date of birth"
        case .driversLicense: "Driver's license"
        case .custom: "Added by you"
        }
    }
}

/// A place in the lease text, in UTF-16 offsets, so it survives being saved with the map.
nonisolated struct TextSpan: Codable, Hashable, Sendable {
    var location: Int
    var length: Int

    init(location: Int, length: Int) {
        self.location = location
        self.length = length
    }

    init(_ range: Range<String.Index>, in text: String) {
        let ns = NSRange(range, in: text)
        self.init(location: ns.location, length: ns.length)
    }

    func range(in text: String) -> Range<String.Index>? {
        guard location >= 0, length > 0, location + length <= text.utf16.count else { return nil }
        return Range(NSRange(location: location, length: length), in: text)
    }
}

/// One detail found in the lease, and every place it appears. The original text never leaves the
/// phone (spec §6.3): only `placeholder` takes its place in the upload.
nonisolated struct Redaction: Codable, Hashable, Identifiable, Sendable {
    var id: UUID
    /// The detail as it first appears in the lease. Device only.
    var original: String
    /// Other spellings the detectors found for the same detail ("JORDAN LEE", a line-wrapped address).
    var variants: [String]
    /// Other forms hidden with it: a name's single words, a company name without "LLC".
    var aliases: [String]
    /// Exactly where the detectors found it. These places are always replaced, whatever the search finds.
    var spans: [TextSpan]
    var kind: RedactionKind
    /// What the server sees instead, such as `[TENANT_1]`.
    var placeholder: String
    /// The tenant can turn a detection off, which sends that text as written.
    var isHidden: Bool
    var addedByTenant: Bool

    init(id: UUID = UUID(), original: String, variants: [String] = [], aliases: [String] = [], spans: [TextSpan] = [], kind: RedactionKind, placeholder: String, isHidden: Bool = true, addedByTenant: Bool = false) {
        self.id = id
        self.original = original
        self.variants = variants
        self.aliases = aliases
        self.spans = spans
        self.kind = kind
        self.placeholder = placeholder
        self.isHidden = isHidden
        self.addedByTenant = addedByTenant
    }

    /// Numbers that identify the tenant or their money. Showing one again asks first.
    var isSensitiveNumber: Bool {
        switch kind {
        case .ssn, .bankAccount, .routingNumber, .cardNumber, .driversLicense, .birthDate: true
        default: false
        }
    }
}

/// One place a redaction's text appears in the lease.
nonisolated struct RedactionOccurrence: Hashable, Sendable {
    var range: Range<String.Index>
    var redactionID: UUID
}

/// The redaction map (`[TENANT_1] = "Jordan Lee"`): the details found in one lease and the
/// tenant's choices. Stays on the device with complete file protection.
nonisolated struct RedactionMap: Codable, Hashable, Sendable {
    var redactions: [Redaction]

    init(redactions: [Redaction] = []) {
        self.redactions = redactions
    }

    subscript(id: UUID) -> Redaction? {
        redactions.first { $0.id == id }
    }

    var hiddenCount: Int { redactions.count { $0.isHidden } }

    /// Every place any redaction appears, hidden or not, in text order: where the detectors found
    /// it, and wherever its text, a variant, or an alias appears. Overlaps are kept; `resolved(_:)`
    /// picks between them.
    func occurrences(in text: String) -> [RedactionOccurrence] {
        var found: [RedactionOccurrence] = []
        let search = TextMatcher.SearchText(text)
        for redaction in redactions {
            for span in redaction.spans {
                if let range = span.range(in: text) {
                    found.append(RedactionOccurrence(range: range, redactionID: redaction.id))
                }
            }
            for value in [redaction.original] + redaction.variants {
                for range in search.ranges(of: value, mode: .phrase) {
                    found.append(RedactionOccurrence(range: range, redactionID: redaction.id))
                }
            }
            for alias in redaction.aliases {
                for range in search.ranges(of: alias, mode: .nameWord) {
                    found.append(RedactionOccurrence(range: range, redactionID: redaction.id))
                }
            }
        }
        return found.sorted(by: Self.textOrder)
    }

    /// The occurrences of hidden redactions that do not overlap: the earliest wins, then the longest.
    func resolved(_ occurrences: [RedactionOccurrence]) -> [RedactionOccurrence] {
        let hidden = Set(redactions.lazy.filter(\.isHidden).map(\.id))
        var kept: [RedactionOccurrence] = []
        for occurrence in occurrences.sorted(by: Self.textOrder) where hidden.contains(occurrence.redactionID) {
            if let last = kept.last, occurrence.range.lowerBound < last.range.upperBound {
                // Overlaps the one before. Widen it if this one runs further, so no part of either shows.
                if occurrence.range.upperBound > last.range.upperBound {
                    kept[kept.count - 1].range = last.range.lowerBound..<occurrence.range.upperBound
                }
                continue
            }
            kept.append(occurrence)
        }
        return kept
    }

    /// The lease with every hidden detail replaced by its placeholder. This is the only lease text
    /// that may leave the phone.
    func redact(_ text: String) -> String {
        redact(text, occurrences: occurrences(in: text))
    }

    func redact(_ text: String, occurrences: [RedactionOccurrence]) -> String {
        let placeholders = Dictionary(uniqueKeysWithValues: redactions.map { ($0.id, $0.placeholder) })
        var result = ""
        result.reserveCapacity(text.utf8.count)
        var cursor = text.startIndex
        for occurrence in resolved(occurrences) {
            result += text[cursor..<occurrence.range.lowerBound]
            result += placeholders[occurrence.redactionID] ?? "[HIDDEN]"
            cursor = occurrence.range.upperBound
        }
        result += text[cursor...]
        return result
    }

    /// Hides `text` everywhere it appears. Turns an existing redaction back on when it matches one.
    /// Returns nil when the text is blank or not in the lease.
    mutating func hide(_ text: String, in lease: String) -> Redaction? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !TextMatcher.ranges(of: value, in: lease, mode: .phrase).isEmpty else { return nil }
        let key = TextMatcher.normalized(value)
        if let index = redactions.firstIndex(where: { ([$0.original] + $0.variants).contains { TextMatcher.normalized($0) == key } }) {
            redactions[index].isHidden = true
            return redactions[index]
        }
        let count = redactions.count { $0.kind == .custom } + 1
        let redaction = Redaction(original: value, kind: .custom, placeholder: "[\(RedactionKind.custom.placeholderPrefix)_\(count)]", addedByTenant: true)
        redactions.append(redaction)
        return redaction
    }

    private static func textOrder(_ lhs: RedactionOccurrence, _ rhs: RedactionOccurrence) -> Bool {
        if lhs.range.lowerBound != rhs.range.lowerBound { return lhs.range.lowerBound < rhs.range.lowerBound }
        return lhs.range.upperBound > rhs.range.upperBound
    }
}

/// Finds a detail's text in the lease, ignoring case, accents, curly versus straight apostrophes,
/// dash variants, and how the words are spaced or wrapped: "JORDAN LEE" in a signature block,
/// "Zoe Angstrom" from a scan, and "1427 Example\nLane" all match.
nonisolated enum TextMatcher {
    enum Mode {
        /// A whole value, anywhere it appears as whole words.
        case phrase
        /// One word of a name: only where it starts with a capital (or is in a script without
        /// capitals), so the name "Grace" leaves "a grace period" alone.
        case nameWord
    }

    static func ranges(of needle: String, in haystack: String, mode: Mode) -> [Range<String.Index>] {
        SearchText(haystack).ranges(of: needle, mode: mode)
    }

    /// A lease folded once, one character for one character, so every search is a single regular
    /// expression pass and its matches map straight back to the lease.
    struct SearchText {
        let string: String
        private let folded: NSString
        /// The ordinal of the lease character each UTF-16 unit of `folded` belongs to.
        private let ordinalForUnit: [Int]
        /// The lease index of each character ordinal, then `endIndex`.
        private let indices: [String.Index]

        init(_ string: String) {
            self.string = string
            var folded = ""
            folded.reserveCapacity(string.utf8.count)
            var ordinalForUnit: [Int] = []
            ordinalForUnit.reserveCapacity(string.utf16.count + 1)
            var indices: [String.Index] = []
            var ordinal = 0
            for index in string.indices {
                let character = TextMatcher.fold(string[index])
                folded.append(character)
                for _ in 0..<character.utf16.count { ordinalForUnit.append(ordinal) }
                indices.append(index)
                ordinal += 1
            }
            ordinalForUnit.append(ordinal)
            indices.append(string.endIndex)
            self.folded = folded as NSString
            self.ordinalForUnit = ordinalForUnit
            self.indices = indices
        }

        func ranges(of needle: String, mode: Mode) -> [Range<String.Index>] {
            guard let regex = TextMatcher.pattern(for: needle) else { return [] }
            return regex.matches(in: folded as String, range: NSRange(location: 0, length: folded.length)).compactMap { match in
                let start = ordinalForUnit[match.range.location]
                let end = ordinalForUnit[match.range.location + match.range.length]
                guard start < end else { return nil }
                let range = indices[start]..<indices[end]
                guard TextMatcher.isWholeWord(range, in: string), mode == .phrase || TextMatcher.startsLikeAName(string[range]) else { return nil }
                return range
            }
        }
    }

    /// The needle folded like the lease, its words joined by any run of whitespace.
    static func pattern(for needle: String) -> NSRegularExpression? {
        let words = String(needle.map(fold)).split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return nil }
        let pattern = words.map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: #"\s+"#)
        return try? NSRegularExpression(pattern: pattern)
    }

    /// One character to one character: lowercased, accents removed, apostrophes and dashes unified.
    static func fold(_ character: Character) -> Character {
        if character.isASCII {
            return character.isUppercase ? Character(character.lowercased()) : character
        }
        if apostrophes.contains(character) { return "'" }
        if dashes.contains(character) { return "-" }
        if character.isWhitespace { return " " }
        let folded = String(character).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        if folded.count == 1, let first = folded.first { return first }
        let lower = character.lowercased()
        return lower.count == 1 ? Character(lower) : character
    }

    private static let apostrophes: Set<Character> = ["’", "‘", "ʼ", "′"]
    private static let dashes: Set<Character> = ["‐", "‑", "‒", "–", "—", "−"]

    /// Lowercased, accents folded, spaces collapsed: two spellings of one detail compare equal.
    static func normalized(_ text: String) -> String {
        String(text.map(fold)).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Letters may not run on into letters, nor digits into digits. A letter next to a digit is a
    /// boundary, so "SSN987-65-4321" and "DLT12345678" still match their values.
    static func isWholeWord(_ range: Range<String.Index>, in text: String) -> Bool {
        if range.lowerBound > text.startIndex {
            let before = text[text.index(before: range.lowerBound)]
            if runsOn(before, text[range.lowerBound]) { return false }
        }
        if range.upperBound < text.endIndex {
            let last = text[text.index(before: range.upperBound)]
            if runsOn(last, text[range.upperBound]) { return false }
        }
        return true
    }

    private static func runsOn(_ a: Character, _ b: Character) -> Bool {
        if a.isNumber && b.isNumber { return true }
        return a.isLetter && b.isLetter && (isCased(a) || isCased(b))
    }

    /// Latin, Greek, Cyrillic and so on have capitals. Chinese, Japanese, Arabic and others do not,
    /// and their words run together without spaces, so word boundaries do not apply to them.
    static func isCased(_ character: Character) -> Bool {
        character.isUppercase || character.isLowercase
    }

    static func startsLikeAName(_ word: Substring) -> Bool {
        guard let first = word.first else { return false }
        return first.isUppercase || !(first.isLetter && isCased(first))
    }
}
