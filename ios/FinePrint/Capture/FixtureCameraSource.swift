#if DEBUG
import Foundation

nonisolated enum FixtureCameraError: Error, Equatable {
    /// The folder is missing or cannot be listed.
    case unreadableDirectory(String)
    /// The folder holds no photos.
    case noPhotos(String)
}

/// Stands in for the camera hardware on a simulator (spec §12.1): each shutter press returns the
/// bytes of the next photo in a folder, in file name order, wrapping around after the last.
/// Everything after the shutter (GPS removal, hashing, the capture record, the quality gate) is
/// the real pipeline. Compiled into DEBUG builds only.
nonisolated struct FixtureCameraSource: Equatable, Sendable {
    static let photoExtensions: Set<String> = ["jpg", "jpeg", "heic", "png"]

    let photos: [URL]
    private(set) var nextIndex = 0

    init(directory: URL) throws(FixtureCameraError) {
        let contents: [URL]
        do {
            contents = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil, options: .skipsHiddenFiles)
        } catch {
            throw .unreadableDirectory(directory.path(percentEncoded: false))
        }
        photos = contents
            .filter { Self.photoExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
        if photos.isEmpty { throw .noPhotos(directory.path(percentEncoded: false)) }
    }

    /// The bytes of the next photo. Wraps to the first photo after the last.
    mutating func nextPhoto() throws -> Data {
        let url = photos[nextIndex]
        nextIndex = (nextIndex + 1) % photos.count
        return try Data(contentsOf: url)
    }
}
#endif
