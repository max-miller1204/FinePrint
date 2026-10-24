// Runtime probe for Vision's RecognizeDocumentsRequest (spec §5, §21 item 7).
// Renders a lease-like image, runs the request, and checks the text and table
// come back. Built for macOS by ios-capabilities.sh, since the same Vision API
// ships on macOS 26 and a host run needs no simulator app bundle.

import CoreGraphics
import CoreText
import Foundation
import Vision

let lines = [
    "RESIDENTIAL LEASE AGREEMENT",
    "Monthly rent: $1,250.00",
    "Late fee: $75 if rent is received after the 5th.",
    "Security deposit: $2,500.00",
]

func renderLease() -> CGImage {
    let width = 1200, height = 600
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let font = CTFontCreateWithName("Helvetica" as CFString, 36, nil)
    for (index, line) in lines.enumerated() {
        let attributed = NSAttributedString(
            string: line,
            attributes: [.init(kCTFontAttributeName as String): font, .init(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)])
        context.textPosition = CGPoint(x: 60, y: height - 100 - index * 110)
        CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
    }
    return context.makeImage()!
}

@main
struct VisionProbe {
    static func main() async {
        do {
            let request = RecognizeDocumentsRequest()
            let observations = try await request.perform(on: renderLease())
            guard let document = observations.first?.document else {
                print("FAIL: RecognizeDocumentsRequest returned no document")
                exit(1)
            }
            let text = document.text.transcript
            let missing = ["RESIDENTIAL LEASE", "$1,250.00", "$75", "$2,500.00"].filter { !text.contains($0) }
            print("paragraphs=\(document.paragraphs.count) tables=\(document.tables.count) lists=\(document.lists.count)")
            print("transcript: \(text.replacingOccurrences(of: "\n", with: " | "))")
            if missing.isEmpty {
                print("PASS: RecognizeDocumentsRequest read every expected token")
            } else {
                print("FAIL: missing \(missing)")
                exit(1)
            }
        } catch {
            print("FAIL: \(error)")
            exit(1)
        }
    }
}
