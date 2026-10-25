import Foundation

/// The only lease data that may leave the phone: the redacted text, two numbers about how it was
/// read, and how the tenant wants it explained (spec §6.1 `leases/{leaseId}`, §7.3). It goes to
/// `POST /v1/rentals/:id/leases` (#16). The original text, the redaction map, and the scans never do.
nonisolated struct LeaseUpload: Equatable, Sendable {
    /// The JSON body, with the server's property names. Nothing else is sent.
    struct Body: Codable, Equatable, Sendable {
        /// The redacted text, trimmed as the server trims it, so the offsets in its quotes line up
        /// with this text.
        var text: String
        /// The language the explanations come back in ("en", "es").
        var locale: String
        var readingLevel: String
        var pageCount: Int
        var ocrConfidence: Double?
    }

    enum Unavailable: Error, Equatable {
        /// The lease belongs to a rental other than the one every tab shows.
        case notCurrentRental
        /// The tenant has not finished reviewing what is hidden.
        case notReviewed
        /// The server has not created the rental yet, so there is no route to send to.
        case rentalNotOnServer
    }

    /// The server's rental ID, for the path.
    var rentalServerID: String
    var body: Body

    var path: String { "/v1/rentals/\(rentalServerID)/leases" }

    /// The body for `scan`, built from its redacted text. Pure and off the main actor.
    @concurrent
    static func body(for scan: LeaseScan, language: AppLanguage = .english, readingLevel: ReadingLevel = .standard) async -> Body {
        Body(
            text: scan.redactedText.trimmingCharacters(in: .whitespacesAndNewlines),
            locale: language.rawValue,
            readingLevel: readingLevel.rawValue,
            pageCount: max(scan.pages.count, 1),
            ocrConfidence: scan.ocrConfidence.map { min(max($0, 0), 1) }
        )
    }

    /// The upload for the current rental's reviewed lease, and only that one.
    @MainActor
    static func make(scan: LeaseScan, rentals: [Rental], language: AppLanguage = .english, readingLevel: ReadingLevel = .standard) async throws(Unavailable) -> LeaseUpload {
        guard let current = Rental.current(in: rentals), current.id == scan.rentalID else { throw .notCurrentRental }
        guard scan.isReviewed else { throw .notReviewed }
        guard let serverID = current.serverID else { throw .rentalNotOnServer }
        return LeaseUpload(rentalServerID: serverID, body: await body(for: scan, language: language, readingLevel: readingLevel))
    }

    func encodedBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(body)
    }
}
