import Foundation
import ImageIO
import UniformTypeIdentifiers

nonisolated enum PhotoProcessingError: Error, Equatable {
    case unreadableImage
    case encodingFailed
}

/// Image file work done at the shutter: removing location and making the copy the model sees.
nonisolated enum PhotoProcessing {
    /// Long edge of the copy sent to the model (spec §7.5).
    static let modelCopyMaxPixelSize = 1536

    /// Returns the same image with EXIF and XMP GPS removed. The pixels are copied without
    /// re-encoding when ImageIO can do that for the format, so the evidence keeps full quality.
    static func removingLocation(from data: Data) throws(PhotoProcessingError) -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let type = CGImageSourceGetType(source),
              CGImageSourceGetCount(source) > 0 else {
            throw .unreadableImage
        }
        // The in-app camera never adds a location, so this is the usual path.
        guard containsLocation(data) else { return data }

        // The source metadata must be passed explicitly: with only the exclude option, ImageIO
        // drops all EXIF from JPEGs and keeps GPS in HEIC and PNG.
        let lossless = NSMutableData()
        if let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
           let destination = CGImageDestinationCreateWithData(lossless, type, 1, nil) {
            let options = [
                kCGImageDestinationMetadata: metadata,
                kCGImageDestinationMergeMetadata: false,
                kCGImageMetadataShouldExcludeGPS: true,
            ] as CFDictionary
            if CGImageDestinationCopyImageSource(destination, source, options, nil), !containsLocation(lossless as Data) {
                return lossless as Data
            }
        }

        // Some formats cannot be copied losslessly. Re-encode at full quality with the GPS
        // dictionary removed instead.
        let reencoded = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(reencoded, type, 1, nil) else {
            throw .encodingFailed
        }
        let properties = [
            kCGImagePropertyGPSDictionary: kCFNull as Any,
            kCGImageDestinationLossyCompressionQuality: 1.0,
        ] as CFDictionary
        CGImageDestinationAddImageFromSource(destination, source, 0, properties)
        guard CGImageDestinationFinalize(destination), !containsLocation(reencoded as Data) else { throw .encodingFailed }
        return reencoded as Data
    }

    /// True when the image has a GPS dictionary or any EXIF GPS tag in its XMP.
    static func containsLocation(_ data: Data) -> Bool {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return false }
        if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           properties[kCGImagePropertyGPSDictionary] != nil {
            return true
        }
        guard let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
              let tags = CGImageMetadataCopyTags(metadata) as? [CGImageMetadataTag] else { return false }
        return tags.contains { (CGImageMetadataTagCopyName($0) as String?)?.hasPrefix("GPS") == true }
    }

    /// A JPEG no larger than `maxPixelSize` on its long edge, upright, with no metadata at all.
    static func modelCopy(of data: Data, maxPixelSize: Int = modelCopyMaxPixelSize) throws(PhotoProcessingError) -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            throw .unreadableImage
        }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
            throw .unreadableImage
        }
        return try jpegData(from: image, quality: 0.85)
    }

    static func jpegData(from image: CGImage, quality: Double) throws(PhotoProcessingError) -> Data {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw .encodingFailed
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw .encodingFailed }
        return output as Data
    }

    /// The MIME type for the image's container, such as `image/heic`.
    static func mimeType(of data: Data) -> String {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let identifier = CGImageSourceGetType(source) as String?,
              let mime = UTType(identifier)?.preferredMIMEType else {
            return "application/octet-stream"
        }
        return mime
    }

    /// Decodes the image upright at a reduced size, for quality checks and on-screen review.
    static func downsampledImage(from data: Data, maxPixelSize: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
    }
}
