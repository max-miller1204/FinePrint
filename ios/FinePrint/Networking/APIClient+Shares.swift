import Foundation

nonisolated struct ReportShare: Decodable, Identifiable, Sendable {
    let id: String
    let rentalId: String
    let scope: [String]
    let createdAt: String
    let expiresAt: String
    let revokedAt: String?
    let requiresPin: Bool
    let path: String?

    var expiry: Date? { shareDate(expiresAt) }
    var isActive: Bool { revokedAt == nil && (expiry ?? .distantPast) > .now }
}

nonisolated struct ShareAccess: Decodable, Identifiable, Sendable {
    let at: String
    let userAgentFamily: String
    var id: String { at + userAgentFamily }
    var date: Date? { shareDate(at) }
}

extension APIClient {
    private struct ShareList: Decodable { let shares: [ReportShare] }
    struct AccessPage: Decodable { let access: [ShareAccess]; let nextBefore: String? }
    private struct CreateShare: Encodable {
        let expiresAt: String
        let pin: String?
        let scope: [String]
    }
    private struct RevokedShare: Decodable { let status: String }

    func reportShares(rentalID: String) async throws(APIError) -> [ReportShare] {
        let reply: ShareList = try await get("v1/rentals/\(rentalID)/shares")
        return reply.shares
    }

    func createReportShare(rentalID: String, expiresAt: Date, pin: String?, scope: [String]) async throws(APIError) -> ReportShare {
        try await post("v1/rentals/\(rentalID)/shares", body: CreateShare(
            expiresAt: ISO8601DateFormatter().string(from: expiresAt), pin: pin, scope: scope
        ))
    }

    func revokeReportShare(id: String) async throws(APIError) {
        let _: RevokedShare = try await delete("v1/shares/\(id)")
    }

    func reportShareAccess(id: String, before: String? = nil) async throws(APIError) -> AccessPage {
        try await get("v1/shares/\(id)/access", query: before.map { [URLQueryItem(name: "before", value: $0)] } ?? [])
    }
}

/// Server timestamps include fractional seconds; accept both ISO 8601 forms.
nonisolated private func shareDate(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
