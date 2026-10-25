import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import FinePrint

/// Test images drawn in code, so no fixture files are needed.
enum TestImages {
    /// Black and white squares: sharp edges everywhere.
    static func checkerboard(width: Int = 1200, height: Int = 900, square: Int = 12) -> CGImage {
        draw(width: width, height: height) { context in
            context.setFillColor(gray: 1, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
            context.setFillColor(gray: 0, alpha: 1)
            for y in stride(from: 0, to: height, by: square) {
                for x in stride(from: 0, to: width, by: square) where (x / square + y / square).isMultiple(of: 2) {
                    context.fill(CGRect(x: x, y: y, width: square, height: square))
                }
            }
        }
    }

    /// One flat gray: no edges at all, like a badly blurred shot.
    static func flat(gray: CGFloat, width: Int = 1200, height: Int = 900) -> CGImage {
        draw(width: width, height: height) { context in
            context.setFillColor(gray: gray, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    /// A slow dark-to-light ramp: medium brightness, no sharp detail.
    static func gradient(width: Int = 1200, height: Int = 900) -> CGImage {
        draw(width: width, height: height) { context in
            let colors = [CGColor(gray: 0.3, alpha: 1), CGColor(gray: 0.7, alpha: 1)] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceGray(), colors: colors, locations: nil)!
            context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])
        }
    }

    static func draw(width: Int, height: Int, _ body: (CGContext) -> Void) -> CGImage {
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        )!
        body(context)
        return context.makeImage()!
    }

    /// The location Apple's camera writes: Richmond, Virginia.
    static let gps: [CFString: Any] = [
        kCGImagePropertyGPSLatitude: 37.5407,
        kCGImagePropertyGPSLatitudeRef: "N",
        kCGImagePropertyGPSLongitude: 77.4360,
        kCGImagePropertyGPSLongitudeRef: "W",
    ]

    /// Encodes `image` with GPS, EXIF, and an orientation, like a phone photo.
    static func encoded(_ image: CGImage, as type: UTType = .jpeg, withGPS: Bool = true, orientation: Int = 1) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        var properties: [CFString: Any] = [
            kCGImagePropertyOrientation: orientation,
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifLensModel: "Test lens"],
        ]
        if withGPS { properties[kCGImagePropertyGPSDictionary] = gps }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    static func properties(of data: Data) -> [CFString: Any] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else { return [:] }
        return properties
    }

    static func hasGPS(_ data: Data) -> Bool {
        if properties(of: data)[kCGImagePropertyGPSDictionary] != nil { return true }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
              let tags = CGImageMetadataCopyTags(metadata) as? [CGImageMetadataTag] else { return false }
        return tags.contains { tag in
            let prefix = CGImageMetadataTagCopyPrefix(tag) as String?
            let name = CGImageMetadataTagCopyName(tag) as String? ?? ""
            return prefix == "exif" && name.hasPrefix("GPS")
        }
    }

    static func pixelSize(of data: Data) -> (width: Int, height: Int) {
        let properties = properties(of: data)
        return (properties[kCGImagePropertyPixelWidth] as? Int ?? 0, properties[kCGImagePropertyPixelHeight] as? Int ?? 0)
    }
}

@Suite("Evidence hash")
struct EvidenceHashTests {
    @Test func `matches the published SHA-256 test vectors`() {
        #expect(EvidenceHash.sha256Hex(of: Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(EvidenceHash.sha256Hex(of: Data()) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    @Test func `one changed byte changes the hash`() {
        var data = Data(repeating: 7, count: 1024)
        let before = EvidenceHash.sha256Hex(of: data)
        data[512] = 8
        #expect(EvidenceHash.sha256Hex(of: data) != before)
        #expect(before.count == 64)
    }
}

@Suite("Capture record")
struct CaptureRecordTests {
    let record = CaptureRecord(
        itemID: UUID(uuidString: "6F1C2B8E-7D7A-4E5B-9C1D-2B3A4C5D6E7F")!,
        rentalID: UUID(uuidString: "0A1B2C3D-4E5F-4061-8273-94A5B6C7D8E9")!,
        sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        bytes: 2_483_112,
        mime: "image/heic",
        capturedAtDevice: "2026-08-14T15:12:03-04:00",
        deviceUptimeMs: 81_233_411,
        source: .inAppCamera,
        room: "Kitchen",
        checklistItem: "Walls",
        appVersion: "1.0.0 (12)"
    )

    @Test func `encodes the fields and names of spec section 8_1`() throws {
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        #expect(Set(json.keys) == ["itemId", "rentalId", "sha256", "bytes", "mime", "capturedAtDevice", "deviceUptimeMs", "source", "room", "checklistItem", "appVersion", "session"])
        #expect(json["session"] as? String == "move_in")
        #expect(json["itemId"] as? String == "6F1C2B8E-7D7A-4E5B-9C1D-2B3A4C5D6E7F")
        #expect(json["source"] as? String == "in_app_camera")
        #expect(json["bytes"] as? Int == 2_483_112)
        #expect(json["deviceUptimeMs"] as? Int == 81_233_411)
        #expect(json["capturedAtDevice"] as? String == "2026-08-14T15:12:03-04:00")
    }

    @Test func `round-trips through JSON`() throws {
        let decoded = try JSONDecoder().decode(CaptureRecord.self, from: JSONEncoder().encode(record))
        #expect(decoded == record)
    }

    @Test func `device time keeps the local UTC offset`() throws {
        let date = Date(timeIntervalSince1970: 1_786_734_723) // 2026-08-14 19:12:03 UTC
        let eastern = try #require(TimeZone(identifier: "America/New_York"))
        #expect(CaptureRecord.deviceTimestamp(date, timeZone: eastern) == "2026-08-14T15:12:03-04:00")
        #expect(CaptureRecord.deviceTimestamp(date, timeZone: .gmt) == "2026-08-14T19:12:03+00:00")
    }
}

@Suite("Photo processing")
struct PhotoProcessingTests {
    @Test func `removes GPS from a JPEG and keeps the rest`() throws {
        let original = try #require(TestImages.encoded(TestImages.checkerboard()))
        #expect(TestImages.hasGPS(original))

        let cleaned = try PhotoProcessing.removingLocation(from: original)

        #expect(!TestImages.hasGPS(cleaned))
        let exif = TestImages.properties(of: cleaned)[kCGImagePropertyExifDictionary] as? [CFString: Any]
        #expect(exif?[kCGImagePropertyExifLensModel] as? String == "Test lens")
        #expect(TestImages.pixelSize(of: cleaned) == (1200, 900))
    }

    @Test(arguments: [UTType.heic, .png])
    func `removes GPS from other formats`(type: UTType) throws {
        let encodable = CGImageDestinationCopyTypeIdentifiers() as? [String] ?? []
        try #require(encodable.contains(type.identifier), "This simulator can't encode \(type.identifier)")
        let original = try #require(TestImages.encoded(TestImages.checkerboard(), as: type))

        let cleaned = try PhotoProcessing.removingLocation(from: original)

        #expect(!TestImages.hasGPS(cleaned))
        #expect(PhotoProcessing.mimeType(of: cleaned) == type.preferredMIMEType)
    }

    @Test func `rejects data that is not an image`() {
        #expect(throws: PhotoProcessingError.unreadableImage) {
            try PhotoProcessing.removingLocation(from: Data("not an image".utf8))
        }
    }

    @Test func `model copy is at most 1536 pixels, upright, and has no location`() throws {
        // Orientation 6 means the stored pixels are rotated: 2000x1500 stored is 1500x2000 upright.
        let original = try #require(TestImages.encoded(TestImages.checkerboard(width: 2000, height: 1500), orientation: 6))

        let copy = try PhotoProcessing.modelCopy(of: original)

        #expect(TestImages.pixelSize(of: copy) == (1152, 1536))
        #expect(!TestImages.hasGPS(copy))
        #expect(PhotoProcessing.mimeType(of: copy) == "image/jpeg")
    }

    @Test func `model copy never enlarges a small photo`() throws {
        let original = try #require(TestImages.encoded(TestImages.checkerboard(width: 800, height: 600)))
        let copy = try PhotoProcessing.modelCopy(of: original)
        #expect(TestImages.pixelSize(of: copy) == (800, 600))
    }
}

@Suite("Photo quality")
struct PhotoQualityTests {
    func issues(_ image: CGImage) throws -> [QualityIssue] {
        let metrics = try #require(LumaMetrics(image: image))
        return QualityThresholds.standard.issues(for: metrics)
    }

    @Test func `a sharp, well-lit photo passes`() throws {
        #expect(try issues(TestImages.checkerboard()) == [])
    }

    @Test func `a dark photo asks for light`() throws {
        #expect(try issues(TestImages.flat(gray: 0.05)) == [.tooDark])
    }

    @Test func `a washed-out photo asks to avoid glare`() throws {
        #expect(try issues(TestImages.flat(gray: 0.98)) == [.overexposed])
    }

    @Test func `a photo with no sharp detail is blurry`() throws {
        #expect(try issues(TestImages.gradient()) == [.blurry])
        #expect(try issues(TestImages.flat(gray: 0.5)) == [.blurry])
    }

    @Test func `measures brightness on a 0 to 1 scale`() throws {
        let metrics = try #require(LumaMetrics(image: TestImages.flat(gray: 0.5)))
        #expect(abs(metrics.meanLuminance - 0.5) < 0.02)
        #expect(metrics.sharpness < 1)
    }

    @Test func `preview frames and stills measure alike`() throws {
        // A 1920x1440 luma plane with row padding, as the camera delivers it.
        let width = 1920, height = 1440, bytesPerRow = 1984, square = 24
        var plane = [UInt8](repeating: 0, count: bytesPerRow * height)
        for y in 0..<height {
            for x in 0..<width where (x / square + y / square).isMultiple(of: 2) {
                plane[y * bytesPerRow + x] = 255
            }
        }
        let frame = try #require(plane.withUnsafeBytes {
            LumaMetrics(downsampling: $0, width: width, height: height, bytesPerRow: bytesPerRow)
        })
        let still = try #require(LumaMetrics(image: TestImages.checkerboard(width: width, height: height, square: square)))

        #expect(abs(frame.meanLuminance - still.meanLuminance) < 0.05)
        #expect(QualityThresholds.standard.issues(for: frame) == QualityThresholds.standard.issues(for: still))
    }

    @Test(arguments: QualityIssue.allCases)
    func `every issue has a specific retake reason`(issue: QualityIssue) {
        #expect(!String(localized: issue.retakeReason).isEmpty)
        #expect(!String(localized: issue.framingGuidance).isEmpty)
    }
}

@Suite("Capture pipeline")
struct CapturePipelineTests {
    let store = EvidenceStore(root: URL.temporaryDirectory.appending(path: "CaptureTests-\(UUID().uuidString)", directoryHint: .isDirectory))
    let context = CaptureContext(rentalID: UUID(), room: "Bathroom", checklistItem: "Floor")
    let shutter = CapturePipeline.Shutter(date: Date(timeIntervalSince1970: 1_786_734_723), uptime: 81_233.411)

    var pipeline: CapturePipeline {
        CapturePipeline(store: store, appVersion: "1.0.0 (12)", timeZone: TimeZone(identifier: "America/New_York")!)
    }

    @Test func `hashes the stored file and writes the capture record`() async throws {
        defer { try? FileManager.default.removeItem(at: store.root) }
        let photo = try #require(TestImages.encoded(TestImages.checkerboard()))

        let captured = try await pipeline.process(photo, context: context, shutter: shutter)

        let stored = try Data(contentsOf: captured.files.original)
        #expect(captured.record.sha256 == EvidenceHash.sha256Hex(of: stored))
        #expect(captured.record.bytes == stored.count)
        #expect(captured.record.mime == "image/jpeg")
        #expect(captured.record.rentalID == context.rentalID)
        #expect(captured.record.room == "Bathroom")
        #expect(captured.record.checklistItem == "Floor")
        #expect(captured.record.source == .inAppCamera)
        #expect(captured.record.capturedAtDevice == "2026-08-14T15:12:03-04:00")
        #expect(captured.record.deviceUptimeMs == 81_233_411)
        #expect(captured.record.appVersion == "1.0.0 (12)")
        #expect(captured.issues == [])

        let onDisk = try JSONDecoder().decode(CaptureRecord.self, from: Data(contentsOf: captured.files.record))
        #expect(onDisk == captured.record)
    }

    @Test func `no stored or model file carries GPS`() async throws {
        defer { try? FileManager.default.removeItem(at: store.root) }
        let photo = try #require(TestImages.encoded(TestImages.checkerboard(width: 3000, height: 2000)))
        #expect(TestImages.hasGPS(photo))

        let captured = try await pipeline.process(photo, context: context, shutter: shutter)

        #expect(!TestImages.hasGPS(try Data(contentsOf: captured.files.original)))
        #expect(!TestImages.hasGPS(try Data(contentsOf: captured.files.modelCopy)))
        #expect(TestImages.pixelSize(of: captured.modelCopy) == (1536, 1024))
    }

    @Test func `a dark shot is saved with a retake reason`() async throws {
        defer { try? FileManager.default.removeItem(at: store.root) }
        let photo = try #require(TestImages.encoded(TestImages.flat(gray: 0.04)))

        let captured = try await pipeline.process(photo, context: context, shutter: shutter)

        #expect(captured.issues == [.tooDark])
        #expect(String(localized: captured.issues[0].retakeReason) == "Too dark. Turn on a light or use flash.")
    }

    @Test func `retaking deletes the discarded capture`() async throws {
        defer { try? FileManager.default.removeItem(at: store.root) }
        let photo = try #require(TestImages.encoded(TestImages.checkerboard()))
        let captured = try await pipeline.process(photo, context: context, shutter: shutter)
        #expect(FileManager.default.fileExists(atPath: captured.files.record.path(percentEncoded: false)))

        try store.delete(captured.record)

        #expect(!FileManager.default.fileExists(atPath: store.directory(for: captured.record).path(percentEncoded: false)))
    }
}
