import Foundation

/// The part of `POST /v1/rentals/:id/seal` that the app reads back (spec §8.2).
nonisolated struct SealReceipt: Decodable, Equatable, Sendable {
    struct Manifest: Decodable, Equatable, Sendable {
        var manifestId: String
        var sha256: String
    }

    var manifest: Manifest
    /// Photos the server knew about that had not finished uploading, so the manifest left them out.
    var pending: Int
}

/// What the move-in sealer calls on the server. `APIClient` is the real one.
protocol Sealing {
    func seal(rentalServerID: String) async throws(APIError) -> SealReceipt
}

extension APIClient: Sealing {
    private struct SealRequest: Encodable {
        var session: String
    }

    /// `POST /v1/rentals/:id/seal`: the server signs a manifest of every received move-in photo and
    /// adds it to the rental's ledger. 409 when no photo has been received yet.
    func seal(rentalServerID: String) async throws(APIError) -> SealReceipt {
        try await post("v1/rentals/\(rentalServerID)/seal", body: SealRequest(session: "move_in"))
    }
}
