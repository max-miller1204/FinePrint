import Foundation

/// A box on the photo as fractions of its width and height (spec §7.5), so it fits the photo at
/// any size it is shown. Never drawn into the photo itself.
nonisolated struct NormalizedBox: Codable, Hashable, Sendable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    /// Where a box the tenant adds starts: the middle of the photo.
    static let centered = NormalizedBox(x: 0.35, y: 0.35, width: 0.3, height: 0.3)
    /// The smallest side a box can shrink to, so it stays big enough to see and tap.
    static let minimumSide = 0.05

    /// Moved and sized to stay inside the photo.
    func clamped() -> NormalizedBox {
        let width = min(max(width, Self.minimumSide), 1)
        let height = min(max(height, Self.minimumSide), 1)
        return NormalizedBox(
            x: min(max(x, 0), 1 - width),
            y: min(max(y, 0), 1 - height),
            width: width,
            height: height
        )
    }

    func moved(dx: Double, dy: Double) -> NormalizedBox {
        NormalizedBox(x: x + dx, y: y + dy, width: width, height: height).clamped()
    }

    /// Grows or shrinks from the top-left corner.
    func resized(dWidth: Double, dHeight: Double) -> NormalizedBox {
        NormalizedBox(x: x, y: y, width: min(width + dWidth, 1 - x), height: min(height + dHeight, 1 - y)).clamped()
    }
}

nonisolated enum DamageSeverity: String, Codable, Sendable {
    case minor, moderate, major

    var word: LocalizedStringResource {
        switch self {
        case .minor: "Minor"
        case .moderate: "Moderate"
        case .major: "Major"
        }
    }
}

/// Something Gemma thinks it sees. `repairPath` marks possible mold or pests: the wording never
/// says what it is, and the app points to a repair request instead.
nonisolated struct DamageProposal: Decodable, Equatable, Identifiable, Sendable {
    enum Confidence: String, Decodable, Sendable {
        case low, medium, high
    }

    var id: String
    var type: String
    var label: String
    var description: String
    var severity: DamageSeverity
    var confidence: Confidence
    /// Nil when the model gave no usable box; the tenant can place one.
    var box: NormalizedBox?
    var repairPath: Bool
}

nonisolated struct DamageAnalysis: Decodable, Equatable, Sendable {
    struct ImageQuality: Decodable, Equatable, Sendable {
        var ok: Bool
        var issues: [String]
    }

    var imageQuality: ImageQuality
    var proposals: [DamageProposal]
    /// The model that answered, such as `gemma-4-26b-a4b-it`.
    var model: String
    var fallback: Bool
}

/// The tenant's decision on one proposal, or a box they added. Stored apart from the original
/// photo, whose hash never changes.
nonisolated struct TenantAnnotation: Codable, Equatable, Sendable {
    enum Decision: String, Codable, Sendable {
        case confirmed, adjusted, rejected, added
    }

    /// Nil for a box the tenant added.
    var proposalId: String?
    var decision: Decision
    var box: NormalizedBox
    var label: String
    var description: String
    var severity: DamageSeverity?
}

/// One photo's damage review: Gemma's proposals and the tenant's decisions.
nonisolated struct DamageReview: Decodable, Equatable, Sendable {
    var itemId: UUID
    var sha256: String
    /// Nil until the photo was analyzed.
    var analysis: DamageAnalysis?
    var annotations: [TenantAnnotation]
}

extension APIClient {
    /// `POST /v1/rentals/:id/evidence/:itemId/analyze` with the 1536 px model copy. The original
    /// never goes to the model.
    func analyzeDamage(rentalServerID: String, itemID: UUID, modelCopy: Data) async throws(APIError) -> DamageReview {
        try await post("v1/rentals/\(rentalServerID)/evidence/\(itemID.uuidString.lowercased())/analyze", data: modelCopy, contentType: "image/jpeg")
    }

    /// `GET /v1/rentals/:id/evidence/:itemId/damage`: what was proposed and decided so far.
    func damageReview(rentalServerID: String, itemID: UUID) async throws(APIError) -> DamageReview {
        try await get("v1/rentals/\(rentalServerID)/evidence/\(itemID.uuidString.lowercased())/damage")
    }

    /// `PATCH /v1/rentals/:id/evidence/:itemId`: replaces the tenant's decisions for the photo.
    func saveAnnotations(rentalServerID: String, itemID: UUID, annotations: [TenantAnnotation]) async throws(APIError) -> DamageReview {
        try await patch("v1/rentals/\(rentalServerID)/evidence/\(itemID.uuidString.lowercased())", body: AnnotationsRequest(annotations: annotations))
    }

    private struct AnnotationsRequest: Encodable {
        var annotations: [TenantAnnotation]
    }
}
