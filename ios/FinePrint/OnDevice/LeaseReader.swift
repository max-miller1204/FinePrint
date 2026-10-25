import CoreGraphics
import Foundation
import PDFKit
#if canImport(UIKit)
import UIKit
#endif
import Vision

/// One page of lease text and how it was read.
nonisolated struct LeasePage: Codable, Hashable, Sendable {
    enum Method: String, Codable, Sendable {
        /// The PDF's own text: exact, no OCR.
        case textLayer
        /// Vision text recognition on the page image.
        case ocr
    }

    var text: String
    var method: Method
    /// Mean recognition confidence, 0 to 1. Nil for the text layer.
    var confidence: Double?
}

nonisolated enum LeaseReadError: Error, Equatable {
    case unreadablePDF
    case noPages
    /// Every page came back blank: nothing to check.
    case noText
}

/// Turns a PDF or scanned page images into text, on the device and off the main actor (spec §4.3 F1):
/// a PDF page's text layer when it has one, otherwise Vision OCR of the rendered page.
nonisolated struct LeaseReader: Sendable {
    /// A page needs this many letters in its text layer to skip OCR. Scanned PDFs often carry an
    /// empty or near-empty layer.
    static let minimumTextLayerLetters = 20
    /// Pages render at this width for OCR, about 200 dpi for US Letter.
    static let renderWidth: CGFloat = 1700

    /// Reads a PDF the tenant picked, returning its pages and the file's bytes to keep on the device.
    @concurrent
    func read(pdfAt url: URL) async throws -> ([LeasePage], Data) {
        let data = try Self.contents(of: url)
        return (try await read(pdf: data), data)
    }

    #if DEBUG
    /// Renders every page of a PDF and OCRs it, as if each were a photo from the document camera.
    @concurrent
    func readAsScan(pdfAt url: URL) async throws -> ([LeasePage], Data) {
        let data = try Self.contents(of: url)
        guard let document = PDFDocument(data: data) else { throw LeaseReadError.unreadablePDF }
        let images = (0..<document.pageCount).compactMap { document.page(at: $0).flatMap(Self.render) }
        return (try await read(images: images), data)
    }
    #endif

    @concurrent
    func read(pdf data: Data) async throws -> [LeasePage] {
        guard let document = PDFDocument(data: data) else { throw LeaseReadError.unreadablePDF }
        guard document.pageCount > 0 else { throw LeaseReadError.noPages }
        var pages: [LeasePage] = []
        for index in 0..<document.pageCount {
            try Task.checkCancellation()
            guard let page = document.page(at: index) else { continue }
            let layer = page.string ?? ""
            if layer.count(where: \.isLetter) >= Self.minimumTextLayerLetters {
                pages.append(LeasePage(text: Self.tidy(layer), method: .textLayer, confidence: nil))
            } else if let image = Self.render(page) {
                pages.append(try await Self.recognize(image))
            }
        }
        return try Self.checked(pages)
    }

    /// Scanned pages, such as VisionKit's document camera returns.
    @concurrent
    func read(images: [CGImage]) async throws -> [LeasePage] {
        guard !images.isEmpty else { throw LeaseReadError.noPages }
        var pages: [LeasePage] = []
        for image in images {
            try Task.checkCancellation()
            pages.append(try await Self.recognize(image))
        }
        return try Self.checked(pages)
    }

    #if canImport(UIKit)
    /// The scanned pages as one PDF, to keep on the device as the tenant's copy.
    @concurrent
    static func pdfData(from images: [CGImage]) async -> Data? {
        let document = PDFDocument()
        for image in images {
            guard let page = PDFPage(image: UIImage(cgImage: image)) else { continue }
            document.insert(page, at: document.pageCount)
        }
        return document.pageCount > 0 ? document.dataRepresentation() : nil
    }
    #endif

    /// Reads a file, inside its security scope when it came from the file picker.
    private static func contents(of url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        return try Data(contentsOf: url)
    }

    private static func checked(_ pages: [LeasePage]) throws -> [LeasePage] {
        guard !pages.isEmpty else { throw LeaseReadError.noPages }
        guard pages.contains(where: { $0.text.contains(where: \.isLetter) }) else { throw LeaseReadError.noText }
        return pages
    }

    /// Vision OCR, lines top to bottom.
    private static func recognize(_ image: CGImage) async throws -> LeasePage {
        var request = RecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let observations = try await request.perform(on: image)
        let lines = observations
            .compactMap { observation -> (text: String, confidence: Float, top: CGFloat, left: CGFloat)? in
                guard let candidate = observation.topCandidates(1).first else { return nil }
                let box = observation.boundingBox.cgRect
                // Vision's origin is the bottom left, so the top of a line is its max y.
                return (candidate.string, candidate.confidence, box.maxY, box.minX)
            }
            .sorted { lhs, rhs in
                // Same line when the tops are within a small band; then left to right.
                abs(lhs.top - rhs.top) > 0.01 ? lhs.top > rhs.top : lhs.left < rhs.left
            }
        let confidence = lines.isEmpty ? 0 : Double(lines.map(\.confidence).reduce(0, +)) / Double(lines.count)
        return LeasePage(text: lines.map(\.text).joined(separator: "\n"), method: .ocr, confidence: confidence)
    }

    /// Draws a PDF page on white at `renderWidth`.
    static func render(_ page: PDFPage) -> CGImage? {
        let bounds = page.bounds(for: .mediaBox)
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        let scale = renderWidth / bounds.width
        let width = Int(renderWidth)
        let height = Int((bounds.height * scale).rounded())
        guard let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -bounds.minX, y: -bounds.minY)
        page.draw(with: .mediaBox, to: context)
        return context.makeImage()
    }

    /// Text layers often break lines with carriage returns and pad with trailing spaces.
    private static func tidy(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
