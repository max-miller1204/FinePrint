import Foundation

/// Where a photo belongs: the rental, the room, and the checklist item being photographed.
nonisolated struct CaptureContext: Equatable, Sendable {
    var rentalID: UUID
    var room: String
    var checklistItem: String
}

/// The record written on device at shutter time (spec §8.1). The server later checks the
/// uploaded file against `sha256` and `bytes`, so both describe the exact file that is stored.
nonisolated struct CaptureRecord: Codable, Equatable, Sendable {
    enum Source: String, Codable, Sendable {
        case inAppCamera = "in_app_camera"
    }

    var itemID: UUID
    var rentalID: UUID
    var sha256: String
    var bytes: Int
    var mime: String
    /// The device clock at the shutter, with the device's UTC offset, such as `2026-08-14T15:12:03-04:00`.
    var capturedAtDevice: String
    /// Time since boot. Unlike the wall clock, the tenant cannot change it, so the server can
    /// spot a clock that moved between captures.
    var deviceUptimeMs: Int
    var source: Source
    var room: String
    var checklistItem: String
    var appVersion: String

    enum CodingKeys: String, CodingKey {
        case itemID = "itemId"
        case rentalID = "rentalId"
        case sha256, bytes, mime, capturedAtDevice, deviceUptimeMs, source, room, checklistItem, appVersion
    }

    /// Formats the shutter time with the offset of `timeZone`, never as UTC "Z", so the record
    /// keeps the local time the tenant saw.
    static func deviceTimestamp(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = timeZone
        formatter.formatOptions = [.withInternetDateTime]
        let formatted = formatter.string(from: date)
        guard formatted.hasSuffix("Z") else { return formatted }
        return formatted.dropLast() + "+00:00"
    }

    /// "1.0.0 (12)": marketing version and build number.
    static func appVersion(bundle: Bundle = .main) -> String {
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(version) (\(build))"
    }
}
