import Foundation

/// The only lease data that may leave the phone: the redacted text and two numbers about how it
/// was read (spec §6.1 `leases/{leaseId}`, §7.3). It goes to `POST /v1/rentals/:id/leases` once
/// that route exists (#16). The original text, the redaction map, and the scans never do.
nonisolated struct LeaseUpload: Equatable, Sendable {
    /// The JSON body. Nothing else is sent.
    struct Body: Codable, Equatable, Sendable {
        var redactedText: String
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
    static func body(for scan: LeaseScan) async -> Body {
        Body(redactedText: scan.redactedText, pageCount: scan.pages.count, ocrConfidence: scan.ocrConfidence)
    }

    /// The upload for the current rental's reviewed lease, and only that one.
    @MainActor
    static func make(scan: LeaseScan, rentals: [Rental]) async throws(Unavailable) -> LeaseUpload {
        guard let current = Rental.current(in: rentals), current.id == scan.rentalID else { throw .notCurrentRental }
        guard scan.isReviewed else { throw .notReviewed }
        guard let serverID = current.serverID else { throw .rentalNotOnServer }
        return LeaseUpload(rentalServerID: serverID, body: await body(for: scan))
    }

    func encodedBody() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(body)
    }
}
