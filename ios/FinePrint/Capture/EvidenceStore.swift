import Foundation
import UniformTypeIdentifiers

/// Files for one captured photo, all inside the app container.
nonisolated struct StoredCapture: Equatable, Sendable {
    var original: URL
    var modelCopy: URL
    var record: URL
}

/// Keeps captures on device with complete file protection (spec §6.3) until the upload queue
/// takes them: `<root>/<rentalId>/<itemId>/` holds the original, the model copy, and `record.json`.
nonisolated struct EvidenceStore: Sendable {
    var root: URL

    /// Application Support, or a fresh temporary folder when nothing may persist.
    static func live(inMemory: Bool) -> EvidenceStore {
        if inMemory {
            return EvidenceStore(root: URL.temporaryDirectory.appending(path: "Evidence-\(UUID().uuidString)", directoryHint: .isDirectory))
        }
        return EvidenceStore(root: URL.applicationSupportDirectory.appending(path: "Evidence", directoryHint: .isDirectory))
    }

    func directory(for record: CaptureRecord) -> URL {
        directory(rentalID: record.rentalID, itemID: record.itemID)
    }

    func directory(rentalID: UUID, itemID: UUID) -> URL {
        root.appending(path: rentalID.uuidString, directoryHint: .isDirectory)
            .appending(path: itemID.uuidString, directoryHint: .isDirectory)
    }

    /// The 1536 px JPEG made at capture, which is what the damage review shows and sends to Gemma.
    func modelCopy(rentalID: UUID, itemID: UUID) -> URL {
        directory(rentalID: rentalID, itemID: itemID).appending(path: "model.jpg")
    }

    func save(original: Data, modelCopy: Data, record: CaptureRecord) throws -> StoredCapture {
        let directory = directory(for: record)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        let fileExtension = UTType(mimeType: record.mime)?.preferredFilenameExtension ?? "img"
        let files = StoredCapture(
            original: directory.appending(path: "original.\(fileExtension)"),
            modelCopy: directory.appending(path: "model.jpg"),
            record: directory.appending(path: "record.json")
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try original.write(to: files.original, options: [.atomic, .completeFileProtection])
        try modelCopy.write(to: files.modelCopy, options: [.atomic, .completeFileProtection])
        // The record goes last, so a record on disk always has its photo next to it.
        try encoder.encode(record).write(to: files.record, options: [.atomic, .completeFileProtection])
        return files
    }

    /// Removes a capture the tenant chose to retake. Nothing has been uploaded or sealed yet.
    func delete(_ record: CaptureRecord) throws {
        let directory = directory(for: record)
        guard FileManager.default.fileExists(atPath: directory.path(percentEncoded: false)) else { return }
        try FileManager.default.removeItem(at: directory)
    }
}
