import Foundation

/// What `DELETE /v1/me` answers: when the server finished and what it removed (spec §9.2, §13).
nonisolated struct AccountDeletionReply: Decodable, Equatable, Sendable {
    var deletedAt: String
    var rentals: Int
    var evidenceItems: Int

    /// The server's time, else `fallback` if it sent something unreadable.
    func date(fallback: Date) -> Date {
        // The server writes JavaScript's `toISOString()`, which has milliseconds.
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: deletedAt) ?? fallback
    }
}

extension APIClient {
    /// "Delete everything": removes the rentals, photos, share links, and anonymous account on the server.
    func deleteEverything() async throws(APIError) -> AccountDeletionReply {
        try await delete("v1/me")
    }
}
