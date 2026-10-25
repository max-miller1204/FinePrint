import CoreGraphics
import Foundation

/// On-device quality problems a tenant can fix by retaking the photo (spec §7.5, step 1).
nonisolated enum QualityIssue: String, CaseIterable, Sendable {
    case tooDark
    case overexposed
    case blurry

    /// Shown after the shutter, with a retake button.
    var retakeReason: LocalizedStringResource {
        switch self {
        case .tooDark: "Too dark. Turn on a light or use flash."
        case .overexposed: "Too bright. Turn away from the window or bright light."
        case .blurry: "Blurry. Hold the phone steady and take it again."
        }
    }

    /// Shown and spoken while framing, before the shutter.
    var framingGuidance: LocalizedStringResource {
        switch self {
        case .tooDark: "Too dark. Turn on a light or use flash."
        case .overexposed: "Too bright. Turn away from the bright light."
        case .blurry: "Hold the phone steady."
        }
    }
}

/// Brightness and sharpness of a grayscale image.
nonisolated struct LumaMetrics: Equatable, Sendable {
    /// Edge length the image is scaled to before measuring, so live frames and stills compare.
    static let analysisMaxPixelSize = 512

    /// Average brightness from 0 (black) to 1 (white).
    var meanLuminance: Double
    /// Variance of the Laplacian on a 0 to 255 scale. Low means few sharp edges: blur, or a
    /// surface with no texture.
    var sharpness: Double

    /// Measures 8-bit luma pixels. `bytesPerRow` may include padding past `width`.
    init(width: Int, height: Int, bytesPerRow: Int, pixels: UnsafeRawBufferPointer) {
        precondition(width > 0 && height > 0 && bytesPerRow >= width && pixels.count >= bytesPerRow * (height - 1) + width,
                     "Luma buffer is smaller than its dimensions")
        var sum = 0
        for y in 0..<height {
            let row = y * bytesPerRow
            for x in 0..<width {
                sum += Int(pixels[row + x])
            }
        }
        meanLuminance = Double(sum) / Double(width * height * 255)

        // 4-neighbour Laplacian over the interior; Welford's method keeps the variance stable.
        guard width > 2, height > 2 else {
            sharpness = 0
            return
        }
        var count = 0.0
        var mean = 0.0
        var m2 = 0.0
        for y in 1..<(height - 1) {
            let row = y * bytesPerRow
            for x in 1..<(width - 1) {
                let center = Int(pixels[row + x])
                let laplacian = Int(pixels[row + x - 1]) + Int(pixels[row + x + 1])
                    + Int(pixels[row - bytesPerRow + x]) + Int(pixels[row + bytesPerRow + x])
                    - 4 * center
                count += 1
                let delta = Double(laplacian) - mean
                mean += delta / count
                m2 += delta * (Double(laplacian) - mean)
            }
        }
        sharpness = m2 / count
    }

    /// Draws `image` into a grayscale buffer no larger than `analysisMaxPixelSize` and measures it.
    init?(image: CGImage) {
        let scale = min(1, Double(Self.analysisMaxPixelSize) / Double(max(image.width, image.height)))
        let width = max(1, Int((Double(image.width) * scale).rounded()))
        let height = max(1, Int((Double(image.height) * scale).rounded()))
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        self = pixels.withUnsafeBytes { LumaMetrics(width: width, height: height, bytesPerRow: width, pixels: $0) }
    }
}

nonisolated extension LumaMetrics {
    /// Box-averages a full-size luma plane down to `analysisMaxPixelSize`, like the smooth
    /// downscale used for stills, then measures it.
    init?(downsampling luma: UnsafeRawBufferPointer, width: Int, height: Int, bytesPerRow: Int) {
        guard width > 0, height > 0 else { return nil }
        let factor = max(1, Int((Double(max(width, height)) / Double(Self.analysisMaxPixelSize)).rounded(.up)))
        let outWidth = width / factor
        let outHeight = height / factor
        guard outWidth > 0, outHeight > 0 else { return nil }
        var pixels = [UInt8](repeating: 0, count: outWidth * outHeight)
        let area = factor * factor
        for outY in 0..<outHeight {
            for outX in 0..<outWidth {
                var sum = 0
                for y in (outY * factor)..<(outY * factor + factor) {
                    let row = y * bytesPerRow
                    for x in (outX * factor)..<(outX * factor + factor) {
                        sum += Int(luma[row + x])
                    }
                }
                pixels[outY * outWidth + outX] = UInt8(sum / area)
            }
        }
        self = pixels.withUnsafeBytes { LumaMetrics(width: outWidth, height: outHeight, bytesPerRow: outWidth, pixels: $0) }
    }
}

/// Thresholds for the on-device quality gate. They are deliberately lenient: the gate asks for
/// a retake, and the tenant can still keep the photo. Tune them against real captures.
nonisolated struct QualityThresholds: Equatable, Sendable {
    var minimumLuminance = 0.15
    var maximumLuminance = 0.92
    var minimumSharpness = 20.0

    static let standard = QualityThresholds()

    /// The problems to report, most important first. A badly exposed image reports only the
    /// exposure, because sharpness can't be judged in the dark or in glare.
    func issues(for metrics: LumaMetrics) -> [QualityIssue] {
        if metrics.meanLuminance < minimumLuminance { return [.tooDark] }
        if metrics.meanLuminance > maximumLuminance { return [.overexposed] }
        if metrics.sharpness < minimumSharpness { return [.blurry] }
        return []
    }
}
