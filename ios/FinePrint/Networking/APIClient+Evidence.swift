import Foundation

/// Where to PUT one original, from `POST /v1/rentals/:id/evidence`: a 5-minute URL straight to
/// Cloud Storage, and the headers it was signed with (spec §5.3). Every header must go out
/// exactly as given, or Storage refuses the upload.
nonisolated struct UploadTarget: Codable, Equatable, Sendable {
    var method: String
    var url: URL
    var headers: [String: String]
    var expiresAt: String
}

/// One evidence item as the server sees it.
nonisolated struct EvidenceItemReply: Decodable, Equatable, Sendable {
    enum Status: String, Decodable, Sendable {
        /// Created, but the server has not checked an upload yet.
        case pending
        /// The stored photo matched the capture record's size and SHA-256.
        case received
    }

    var itemId: UUID
    var status: Status
    var receivedAtServer: String?
    /// Present while the item is pending.
    var upload: UploadTarget?
}

/// The capture record (spec §8.1) as the server takes it. The URL names the server's rental, so the
/// device's own rental ID stays on the device.
nonisolated struct EvidenceItemRequest: Encodable, Equatable, Sendable {
    var itemId: UUID
    var room: String
    var checklistItem: String
    var sha256: String
    var bytes: Int
    var mime: String
    var capturedAtDevice: String
    var deviceUptimeMs: Int
    var source: String
    var appVersion: String
    var session: EvidenceSession

    init(_ record: CaptureRecord) {
        itemId = record.itemID
        room = record.room
        checklistItem = record.checklistItem
        sha256 = record.sha256
        bytes = record.bytes
        mime = record.mime
        capturedAtDevice = record.capturedAtDevice
        deviceUptimeMs = record.deviceUptimeMs
        source = record.source.rawValue
        appVersion = record.appVersion
        session = record.session
    }
}

extension APIClient {
    private struct NoBody: Encodable {}

    /// `POST /v1/rentals/:id/evidence` for one capture. Sending the same record again returns a fresh
    /// upload URL, or none once the server has received the photo.
    func requestUpload(rentalServerID: String, record: CaptureRecord) async throws(APIError) -> EvidenceItemReply {
        let reply: ItemsReply = try await post("v1/rentals/\(rentalServerID)/evidence", body: ItemsRequest(items: [EvidenceItemRequest(record)]))
        guard let item = reply.items.first(where: { $0.itemId == record.itemID }) else { throw .malformedResponse }
        return item
    }

    /// `POST /v1/rentals/:id/evidence/:itemId/complete`: the server hashes the stored photo and
    /// records `receivedAtServer`, or answers 422 `HASH_MISMATCH` and deletes it.
    func completeUpload(rentalServerID: String, itemID: UUID) async throws(APIError) -> EvidenceItemReply {
        try await post("v1/rentals/\(rentalServerID)/evidence/\(itemID.uuidString.lowercased())/complete", body: NoBody())
    }

    private struct ItemsRequest: Encodable {
        var items: [EvidenceItemRequest]
    }

    private struct ItemsReply: Decodable {
        var items: [EvidenceItemReply]
    }
}

extension UploadTarget {
    /// PUTs `data` with the signed headers. No ID token: the URL itself is the permission.
    func send(_ data: Data, transport: HTTPTransport) async throws(APIError) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        for (name, value) in headers {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.httpBody = data
        let status: Int
        do {
            let (_, response) = try await transport(request)
            status = (response as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            throw .offline
        }
        guard (200..<300).contains(status) else { throw .server(status: status, code: nil) }
    }
}
