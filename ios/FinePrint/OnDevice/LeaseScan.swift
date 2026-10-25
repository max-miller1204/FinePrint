import Foundation

/// A lease read on this phone: its text, how each page was read, and the redaction map. All of it
/// stays on the device (spec §6.3). Only `redactedText` may leave, through `LeaseUpload`.
nonisolated struct LeaseScan: Codable, Hashable, Identifiable, Sendable {
    enum Source: String, Codable, Sendable {
        case scan
        case pdf
    }

    var id: UUID
    var rentalID: UUID
    var createdAt: Date
    var source: Source
    var pages: [LeasePage]
    var redactions: RedactionMap
    /// When the tenant finished reviewing the redactions. Nothing may be sent before this.
    var reviewedAt: Date?

    init(id: UUID = UUID(), rentalID: UUID, createdAt: Date = .now, source: Source, pages: [LeasePage], redactions: RedactionMap, reviewedAt: Date? = nil) {
        self.id = id
        self.rentalID = rentalID
        self.createdAt = createdAt
        self.source = source
        self.pages = pages
        self.redactions = redactions
        self.reviewedAt = reviewedAt
    }

    /// Pages joined by a blank line. Device only.
    var text: String { pages.map(\.text).joined(separator: "\n\n") }

    var redactedText: String { redactions.redact(text) }

    /// Mean OCR confidence over the pages that needed OCR; nil when every page had a text layer.
    var ocrConfidence: Double? {
        let scores = pages.compactMap(\.confidence)
        return scores.isEmpty ? nil : scores.reduce(0, +) / Double(scores.count)
    }

    var isReviewed: Bool { reviewedAt != nil }

    /// Reads the text and finds the personal details, off the main actor.
    @concurrent
    static func make(rentalID: UUID, source: Source, pages: [LeasePage]) async -> LeaseScan {
        let text = pages.map(\.text).joined(separator: "\n\n")
        return LeaseScan(rentalID: rentalID, source: source, pages: pages, redactions: PIIDetector().redactionMap(for: text))
    }
}

/// Which lease on the server holds a rental's reviewed scan: IDs only, no lease text. A new review
/// changes what would be sent, so a record from an earlier review no longer counts.
nonisolated struct LeaseAnalysisRecord: Codable, Equatable, Sendable {
    var rentalID: UUID
    /// The review the sent text came from.
    var reviewedAt: Date
    var rentalServerID: String
    var leaseID: String

    func matches(_ scan: LeaseScan) -> Bool {
        scan.rentalID == rentalID && scan.reviewedAt == reviewedAt
    }
}

/// Keeps each rental's lease on the device with complete file protection (spec §6.3, §9.2):
/// `<root>/<rentalId>/lease.json` holds the text and the redaction map, and `original.pdf` the
/// imported or scanned pages. Nothing here is uploaded.
nonisolated struct LeaseStore: Sendable {
    var root: URL

    /// Application Support, or a fresh temporary folder when nothing may persist.
    static func live(inMemory: Bool) -> LeaseStore {
        if inMemory {
            return LeaseStore(root: URL.temporaryDirectory.appending(path: "Leases-\(UUID().uuidString)", directoryHint: .isDirectory))
        }
        return LeaseStore(root: URL.applicationSupportDirectory.appending(path: "Leases", directoryHint: .isDirectory))
    }

    func directory(for rentalID: UUID) -> URL {
        root.appending(path: rentalID.uuidString, directoryHint: .isDirectory)
    }

    func scanURL(for rentalID: UUID) -> URL {
        directory(for: rentalID).appending(path: "lease.json")
    }

    func originalURL(for rentalID: UUID) -> URL {
        directory(for: rentalID).appending(path: "original.pdf")
    }

    @concurrent
    func load(rentalID: UUID) async throws -> LeaseScan? {
        let url = scanURL(for: rentalID)
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
        return try JSONDecoder().decode(LeaseScan.self, from: Data(contentsOf: url))
    }

    /// Saves the scan, and the original pages when given. Replaces the rental's earlier lease.
    @concurrent
    func save(_ scan: LeaseScan, original: Data? = nil) async throws {
        let directory = directory(for: scan.rentalID)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        // Backups (iCloud, Finder) would copy the original text and the redaction map off the
        // phone, so the whole folder stays out of them (spec §6.3, §9.1 "Device only").
        var root = self.root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try root.setResourceValues(values)
        if let original {
            try original.write(to: originalURL(for: scan.rentalID), options: [.atomic, .completeFileProtection])
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(scan).write(to: scanURL(for: scan.rentalID), options: [.atomic, .completeFileProtection])
    }

    func analysisURL(for rentalID: UUID) -> URL {
        directory(for: rentalID).appending(path: "analysis.json")
    }

    /// The lease sent for the rental's reviewed scan, if one was sent.
    @concurrent
    func loadAnalysis(rentalID: UUID) async throws -> LeaseAnalysisRecord? {
        let url = analysisURL(for: rentalID)
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
        return try JSONDecoder().decode(LeaseAnalysisRecord.self, from: Data(contentsOf: url))
    }

    /// Saves which lease the server has. The scan must be saved first: the record lives in its folder.
    @concurrent
    func saveAnalysis(_ record: LeaseAnalysisRecord) async throws {
        try JSONEncoder().encode(record).write(to: analysisURL(for: record.rentalID), options: [.atomic, .completeFileProtection])
    }

    @concurrent
    func deleteAnalysis(rentalID: UUID) async throws {
        let url = analysisURL(for: rentalID)
        guard FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return }
        try FileManager.default.removeItem(at: url)
    }

    /// Removes the rental's lease, its original pages, and its redaction map.
    @concurrent
    func delete(rentalID: UUID) async throws {
        let directory = directory(for: rentalID)
        guard FileManager.default.fileExists(atPath: directory.path(percentEncoded: false)) else { return }
        try FileManager.default.removeItem(at: directory)
    }
}
