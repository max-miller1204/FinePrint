import Foundation

// What the lease stream sends (spec §7.3, `server/src/routes/leases.ts`, #16). Property names are
// the server's. Only the fields the app shows are decoded; the rest of each object is ignored.

/// A slice of the text the app sent: UTF-16 offsets, as JavaScript counts them. `end` is exclusive.
nonisolated struct TextSpan: Codable, Hashable, Sendable {
    var start: Int
    var end: Int

    /// The same slice of `text`, or nil when it falls outside it.
    func range(in text: String) -> Range<String.Index>? {
        let utf16 = text.utf16
        guard start >= 0, start <= end, end <= utf16.count,
              let lower = utf16.index(utf16.startIndex, offsetBy: start, limitedBy: utf16.endIndex),
              let upper = utf16.index(lower, offsetBy: end - start, limitedBy: utf16.endIndex)
        else { return nil }
        return lower..<upper
    }
}

/// The server sends only these three for a finding; `verified` and `pending` are for evidence.
nonisolated extension Severity: Codable {
    /// Display order: most serious first.
    var findingRank: Int {
        switch self {
        case .unenforceable: 0
        case .ask: 1
        case .info: 2
        case .verified, .pending: 3
        }
    }
}

/// A key term from the lease (S2, checked by S3): its value as written and the lease's own words.
nonisolated struct LeaseKeyTerm: Codable, Hashable, Identifiable, Sendable {
    /// `monthlyRent`, `securityDeposit`, `lateFee`, ... A name the app doesn't know yet is shown as is.
    var name: String
    /// As written in the lease: "$1,450.00", "10% of the monthly rent".
    var value: String
    var quote: String
    var quoteSpan: TextSpan?
    var clauseId: String?

    var id: String { name }

    var title: LocalizedStringResource {
        switch name {
        case "monthlyRent": "Monthly rent"
        case "securityDeposit": "Security deposit"
        case "lateFee": "Late fee"
        case "damageInsurancePremium": "Damage insurance"
        case "renterInsurancePremium": "Renter's insurance"
        case "maintenanceNoticeHours": "Notice before entry"
        case "leaseStart": "Lease starts"
        case "leaseEnd": "Lease ends"
        default: "\(name)"
        }
    }

    /// The order the card lists them in: money first, then dates, then notice.
    var displayOrder: Int {
        ["monthlyRent", "securityDeposit", "lateFee", "leaseStart", "leaseEnd", "maintenanceNoticeHours", "damageInsurancePremium", "renterInsurancePremium"]
            .firstIndex(of: name) ?? .max
    }
}

/// The plain-language text of a finding in one language (S9).
nonisolated struct FindingText: Codable, Hashable, Sendable {
    var title: String
    var explanation: String
    var action: String
}

/// One finding (spec §4.3 F1): one rule on one clause, or a clause no rule covers.
nonisolated struct LeaseFinding: Codable, Hashable, Identifiable, Sendable {
    /// `f1`, `f2`, ... in the server's display order.
    var id: String
    var severity: Severity
    /// Null when no rule in the checklist covers the clause: then there is no legal claim.
    var ruleId: String?
    /// "Va. Code § 55.1-1204(I)".
    var citation: String?
    /// law.lis.virginia.gov.
    var sourceUrl: String?
    var statuteQuote: String?
    var clauseId: String?
    /// Null only when the finding is about wording the lease lacks.
    var leaseQuote: String?
    var quoteSpan: TextSpan?
    var titleEn: String
    var explanationEn: String
    /// The rule's verified "What you can do", never model text.
    var actionEn: String
    var translations: [String: FindingText]?

    /// Whether a Virginia rule covers this clause. Without one the app makes no legal claim.
    var hasRule: Bool { ruleId != nil }

    /// The link to the statute, only when it is a web address.
    var statuteURL: URL? {
        guard let sourceUrl, let url = URL(string: sourceUrl), url.scheme == "https" || url.scheme == "http" else { return nil }
        return url
    }

    /// The finding in `language` when the server translated it, otherwise in English.
    func text(in language: String) -> FindingText {
        if language != "en", let translated = translations?[language] { return translated }
        return FindingText(title: titleEn, explanation: explanationEn, action: actionEn)
    }

    /// Most serious first; the server's order within a severity.
    static func displayOrder(_ lhs: LeaseFinding, _ rhs: LeaseFinding) -> Bool {
        if lhs.severity.findingRank != rhs.severity.findingRank { return lhs.severity.findingRank < rhs.severity.findingRank }
        return lhs.sequence < rhs.sequence
    }

    /// The number in `f12`, so `f10` sorts after `f9`.
    private var sequence: Int { Int(id.drop { !$0.isNumber }) ?? .max }
}

/// `event: stage`: which step the analysis is on, and how far along it is (0 to 1).
nonisolated struct LeaseStage: Codable, Hashable, Sendable {
    var stage: String
    var label: String
    var progress: Double
}

/// How the analysis ended.
nonisolated enum LeaseOutcome: String, Codable, Sendable {
    case analyzed
    /// Triage stopped it: the tenant should talk to legal aid now (#38).
    case escalated
    case notALease = "not_a_lease"
}

/// `event: done`.
nonisolated struct LeaseDone: Codable, Hashable, Sendable {
    var status: LeaseOutcome
    var findings: Int
    /// `not_a_lease`: the server's message for the tenant.
    var message: String?
    /// True when the stream replayed a lease analyzed earlier.
    var replay: Bool?
}

/// `event: error`. With `retryInMs` the analysis is waiting and goes on; without it, it stopped.
nonisolated struct LeaseStreamError: Codable, Hashable, Sendable {
    var code: String
    var message: String?
    var retryInMs: Int?
}

/// One event from `GET /v1/rentals/:id/leases/:leaseId/stream`.
nonisolated enum LeaseEvent: Hashable, Sendable {
    case stage(LeaseStage)
    case keyTerms([LeaseKeyTerm])
    case finding(LeaseFinding)
    /// A rate limit or a busy model: the analysis goes on after this long.
    case waiting(code: String, retryIn: Duration)
    case done(LeaseDone)
    /// The analysis stopped. The stream ends.
    case failed(code: String)

    private struct KeyTerms: Decodable {
        var keyTerms: [LeaseKeyTerm]
    }

    /// The event for one SSE message, or nil for an event the app doesn't use.
    init?(_ message: ServerSentEvent) throws {
        let data = Data(message.data.utf8)
        let decoder = JSONDecoder()
        switch message.event {
        case "stage":
            self = .stage(try decoder.decode(LeaseStage.self, from: data))
        case "keyterms":
            self = .keyTerms(try decoder.decode(KeyTerms.self, from: data).keyTerms)
        case "finding":
            self = .finding(try decoder.decode(LeaseFinding.self, from: data))
        case "done":
            self = .done(try decoder.decode(LeaseDone.self, from: data))
        case "error":
            let error = try decoder.decode(LeaseStreamError.self, from: data)
            if let retry = error.retryInMs {
                self = .waiting(code: error.code, retryIn: .milliseconds(max(retry, 0)))
            } else {
                self = .failed(code: error.code)
            }
        default:
            return nil
        }
    }
}

/// `POST /v1/rentals/:id/leases` → 201.
nonisolated struct CreatedLease: Decodable, Equatable, Sendable {
    var leaseId: String
}
