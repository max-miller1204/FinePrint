import Foundation

/// A processed photo: its record, where it is stored, and any reason to retake it.
nonisolated struct CapturedPhoto: Equatable, Sendable {
    var record: CaptureRecord
    var files: StoredCapture
    var issues: [QualityIssue]
    /// The 1536px JPEG, also used for the review screen.
    var modelCopy: Data
}

/// What happens between the shutter and the review screen (spec §7.5 step 1, §8.1):
/// remove GPS, hash the file that will be uploaded, make the model copy, check quality, and
/// write the capture record.
nonisolated struct CapturePipeline: Sendable {
    /// The moment the shutter fired, read before any processing.
    struct Shutter: Equatable, Sendable {
        var date: Date
        var uptime: TimeInterval

        static func now() -> Shutter {
            Shutter(date: .now, uptime: ProcessInfo.processInfo.systemUptime)
        }
    }

    var store: EvidenceStore
    var appVersion: String
    var thresholds = QualityThresholds.standard
    var timeZone = TimeZone.current

    /// Image decoding and hashing take tens of milliseconds on a 12 MP photo, so they run off
    /// the main actor.
    @concurrent
    func process(_ photoData: Data, context: CaptureContext, shutter: Shutter, itemID: UUID = UUID()) async throws -> CapturedPhoto {
        // GPS comes out first, so the hash covers the exact bytes the server will receive.
        let original = try PhotoProcessing.removingLocation(from: photoData)
        let sha256 = EvidenceHash.sha256Hex(of: original)
        let modelCopy = try PhotoProcessing.modelCopy(of: original)
        let issues = PhotoProcessing.downsampledImage(from: original, maxPixelSize: LumaMetrics.analysisMaxPixelSize)
            .flatMap(LumaMetrics.init(image:))
            .map(thresholds.issues(for:)) ?? []

        let record = CaptureRecord(
            itemID: itemID,
            rentalID: context.rentalID,
            sha256: sha256,
            bytes: original.count,
            mime: PhotoProcessing.mimeType(of: original),
            capturedAtDevice: CaptureRecord.deviceTimestamp(shutter.date, timeZone: timeZone),
            deviceUptimeMs: Int((shutter.uptime * 1000).rounded()),
            source: .inAppCamera,
            room: context.room,
            checklistItem: context.checklistItem,
            appVersion: appVersion
        )
        let files = try store.save(original: original, modelCopy: modelCopy, record: record)
        return CapturedPhoto(record: record, files: files, issues: issues, modelCopy: modelCopy)
    }
}
