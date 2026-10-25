import Foundation
import SwiftData

/// Something that broke, and the server's answer to "Who pays for this?" (spec §4.3 F4). Saved only
/// once the server has answered: a description it stopped for safety is not kept.
@Model
final class RepairIssue {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    /// The tenant's words, as sent.
    var details: String
    var room: String?
    var checklistItem: String?
    /// Capture IDs of the photos sent with the check.
    var photoIDs: [UUID]
    /// The server's `rentals/{rentalId}/issues/{issueId}`.
    var serverID: String
    /// Triage flagged something a person should help with (a lockout, court papers), though not one
    /// that stops the check.
    var needsHandoff: Bool
    /// `ResponsibilityResult` as JSON. Kept encoded: its citations are an enum with associated
    /// values, which SwiftData does not store as columns.
    private var resultData: Data
    var rental: Rental?

    init(
        id: UUID = UUID(),
        createdAt: Date = .now,
        details: String,
        room: String?,
        checklistItem: String?,
        photoIDs: [UUID],
        result: ResponsibilityResult,
        needsHandoff: Bool
    ) {
        self.id = id
        self.createdAt = createdAt
        self.details = details
        self.room = room
        self.checklistItem = checklistItem
        self.photoIDs = photoIDs
        serverID = result.issueId
        self.needsHandoff = needsHandoff
        resultData = (try? JSONEncoder().encode(result)) ?? Data()
    }

    /// Nil only if the stored answer can't be read, which would be a bug.
    var result: ResponsibilityResult? {
        try? JSONDecoder().decode(ResponsibilityResult.self, from: resultData)
    }
}

extension Rental {
    /// Newest first.
    var sortedIssues: [RepairIssue] {
        issues.sorted { $0.createdAt > $1.createdAt }
    }
}
