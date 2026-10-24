import Foundation
import Testing
@testable import FinePrint

#if DEBUG
@Suite("Fixture camera")
struct FixtureCameraTests {
    /// The committed fixture photos, found from this file: `ios/FinePrintTests/` is two levels below the repository root.
    static let photos = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "e2e/fixtures/photos", directoryHint: .isDirectory)

    static func temporaryURL() -> URL {
        URL.temporaryDirectory.appending(path: "FixtureCameraTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    /// A temporary folder with one file per name, each holding its own name as content.
    func folder(_ names: [String]) throws -> URL {
        let url = Self.temporaryURL()
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        for name in names {
            try Data(name.utf8).write(to: url.appending(path: name))
        }
        return url
    }

    @Test func `returns photos in file name order and wraps around`() throws {
        let directory = try folder(["10-c.jpg", "2-b.jpg", "1-a.jpg", "notes.txt"])
        defer { try? FileManager.default.removeItem(at: directory) }
        var source = try FixtureCameraSource(directory: directory)

        let names = try (0..<4).map { _ in String(decoding: try source.nextPhoto(), as: UTF8.self) }

        #expect(names == ["1-a.jpg", "2-b.jpg", "10-c.jpg", "1-a.jpg"])
    }

    @Test func `a missing folder is unreadable`() {
        let missing = Self.temporaryURL()
        #expect(throws: FixtureCameraError.unreadableDirectory(missing.path(percentEncoded: false))) {
            try FixtureCameraSource(directory: missing)
        }
    }

    @Test func `a folder without photos is rejected`() throws {
        let directory = try folder(["notes.txt"])
        defer { try? FileManager.default.removeItem(at: directory) }
        #expect(throws: FixtureCameraError.noPhotos(directory.path(percentEncoded: false))) {
            try FixtureCameraSource(directory: directory)
        }
    }

    @Test(arguments: ["move-in", "move-out"])
    func `the committed folders hold the same three views`(folder: String) throws {
        let source = try FixtureCameraSource(directory: Self.photos.appending(path: folder, directoryHint: .isDirectory))
        #expect(source.photos.map(\.lastPathComponent) == ["01-kitchen-wall.jpg", "02-bathroom-tile.jpg", "03-bedroom-door.jpg"])
    }

    @Test func `a fixture photo goes through the real pipeline to a record with its hash`() async throws {
        let store = EvidenceStore(root: Self.temporaryURL())
        defer { try? FileManager.default.removeItem(at: store.root) }
        var source = try FixtureCameraSource(directory: Self.photos.appending(path: "move-in", directoryHint: .isDirectory))
        let context = CaptureContext(rentalID: UUID(), room: "Kitchen", checklistItem: "Walls")
        let pipeline = CapturePipeline(store: store, appVersion: "1.0.0 (1)")

        let captured = try await pipeline.process(try source.nextPhoto(), context: context, shutter: .now())

        let stored = try Data(contentsOf: captured.files.original)
        #expect(captured.record.sha256.count == 64)
        #expect(captured.record.sha256 == EvidenceHash.sha256Hex(of: stored))
        #expect(captured.record.bytes == stored.count)
        #expect(captured.record.mime == "image/jpeg")
        #expect(captured.record.source == .inAppCamera)
        #expect(captured.record.room == "Kitchen")
        #expect(captured.issues == [])
        #expect(TestImages.pixelSize(of: captured.modelCopy) == (1200, 900))
    }

    @Test func `different fixture photos hash differently`() async throws {
        let store = EvidenceStore(root: Self.temporaryURL())
        defer { try? FileManager.default.removeItem(at: store.root) }
        var source = try FixtureCameraSource(directory: Self.photos.appending(path: "move-in", directoryHint: .isDirectory))
        let context = CaptureContext(rentalID: UUID(), room: "Kitchen", checklistItem: "Walls")
        let pipeline = CapturePipeline(store: store, appVersion: "1.0.0 (1)")

        let first = try await pipeline.process(try source.nextPhoto(), context: context, shutter: .now())
        let second = try await pipeline.process(try source.nextPhoto(), context: context, shutter: .now())

        #expect(first.record.sha256 != second.record.sha256)
    }

    @Test func `the launch argument reaches the app configuration`() {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintFixtureCamera", "/tmp/photos"], environment: [:])
        let configuration = AppConfiguration.preview(launchOptions: options)
        #expect(configuration.fixtureCameraDirectory == URL(fileURLWithPath: "/tmp/photos", isDirectory: true))
    }
}
#endif
