import Foundation

/// Who is likely responsible (spec §7.7). Raw values match the server's `verdict`.
nonisolated enum Verdict: String, Codable, CaseIterable, Sendable {
    case likelyLandlord = "likely_landlord"
    case likelyTenant = "likely_tenant"
    case couldBeEither = "could_be_either"
    case notSure = "not_sure"
}

/// What kind of problem it is. Raw values match the server's `category`.
nonisolated enum ResponsibilityCategory: String, Codable, CaseIterable, Sendable {
    case normalWearAndTear = "normal_wear_and_tear"
    case tenantDamage = "tenant_damage"
    case landlordMaintenance = "landlord_maintenance"
    case preExisting = "pre_existing"
    case unknown
}

nonisolated enum Confidence: String, Codable, CaseIterable, Sendable {
    case low
    case medium
    case high
}

/// A Virginia rule, with the statute text of the version in force that day.
nonisolated struct RuleCitation: Codable, Equatable, Sendable {
    var ref: String
    /// Such as "Va. Code § 55.1-1220(A)".
    var citation: String
    /// Verbatim statute text.
    var quote: String
    var sourceUrl: String
    var effectiveFrom: String
}

/// A slice of a lease clause, verbatim.
nonisolated struct LeaseCitation: Codable, Equatable, Sendable {
    var ref: String
    var leaseId: String
    var heading: String?
    var quote: String
}

/// A move-in photo of the same room.
nonisolated struct EvidenceCitation: Codable, Equatable, Sendable {
    var ref: String
    var session: EvidenceSession
    var room: String
    var checklistItem: String
    var capturedAtDevice: String
    var sealedManifestId: String?
}

/// What a reason rests on. The server drops any reason whose citation does not resolve, so every
/// reason the app shows has one.
nonisolated enum Citation: Codable, Equatable, Sendable {
    case rule(RuleCitation)
    case lease(LeaseCitation)
    case evidence(EvidenceCitation)

    private enum Kind: String, Codable {
        case rule, lease, evidence
    }

    private enum CodingKeys: String, CodingKey {
        case kind
    }

    init(from decoder: any Decoder) throws {
        let kind = try decoder.container(keyedBy: CodingKeys.self).decode(Kind.self, forKey: .kind)
        switch kind {
        case .rule: self = .rule(try RuleCitation(from: decoder))
        case .lease: self = .lease(try LeaseCitation(from: decoder))
        case .evidence: self = .evidence(try EvidenceCitation(from: decoder))
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .rule(let citation):
            try container.encode(Kind.rule, forKey: .kind)
            try citation.encode(to: encoder)
        case .lease(let citation):
            try container.encode(Kind.lease, forKey: .kind)
            try citation.encode(to: encoder)
        case .evidence(let citation):
            try container.encode(Kind.evidence, forKey: .kind)
            try citation.encode(to: encoder)
        }
    }
}

nonisolated struct ResponsibilityReason: Codable, Equatable, Sendable {
    var text: String
    var citation: Citation
}

/// Whether Gemma 31B checked the answer. `high` needs `agreed`; otherwise the server lowers it.
nonisolated struct ResponsibilityVerification: Codable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        /// The answer was below `high`, so no second check ran.
        case notNeeded = "not_needed"
        case agreed
        case disagreed
        case unavailable
    }

    var status: Status
    var verdict: Verdict?
}

/// The answer to "Who pays for this?" (spec §4.3 F4), as `POST /v1/rentals/:id/issues` returns it.
nonisolated struct ResponsibilityResult: Codable, Equatable, Sendable {
    var issueId: String
    var verdict: Verdict
    var category: ResponsibilityCategory
    var confidence: Confidence
    var reasons: [ResponsibilityReason]
    var whatWouldChange: [String]
    var escrowEligible: Bool
    var verification: ResponsibilityVerification
    var downgraded: Bool
    /// The model calls behind the answer, for the AI trace overlay (#39). Nil from older servers.
    var trace: [AITraceStep]?
}

/// The server's triage categories (spec §7.9).
nonisolated enum TriageCategory: String, Codable, Sendable {
    case none
    case evictionOrCourt = "eviction_or_court"
    case lockout
    case utilityShutoff = "utility_shutoff"
    case retaliation
    case discrimination
    case domesticViolence = "domestic_violence"
    case immediateDanger = "immediate_danger"
    case selfHarm = "self_harm"
}

nonisolated struct TriageDecision: Codable, Equatable, Sendable {
    var escalate: Bool
    var category: TriageCategory
}

/// The body of `POST /v1/rentals/:id/issues`. Nil fields are left out.
nonisolated struct CreateIssueRequest: Encodable, Equatable, Sendable {
    var description: String
    var room: String?
    var checklistItem: String?
    var photoIds: [String]
    var locale: String
}

/// A checked issue (201), or a description the server stopped for safety (200, nothing stored).
nonisolated enum IssueReply: Decodable, Equatable, Sendable {
    case checked(ResponsibilityResult, triage: TriageDecision)
    case escalated(TriageDecision)

    private enum Status: String, Decodable {
        case checked, escalated
    }

    private enum CodingKeys: String, CodingKey {
        case status, triage
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let triage = try container.decode(TriageDecision.self, forKey: .triage)
        switch try container.decode(Status.self, forKey: .status) {
        case .checked: self = .checked(try ResponsibilityResult(from: decoder), triage: triage)
        case .escalated: self = .escalated(triage)
        }
    }
}

extension APIClient {
    /// `POST /v1/rentals/:id/issues`. 503 `DEPENDENCY_UNAVAILABLE` when the server has no model.
    func checkResponsibility(rentalServerID: String, request: CreateIssueRequest) async throws(APIError) -> IssueReply {
        try await post("v1/rentals/\(rentalServerID)/issues", body: request)
    }
}
