// Draws e2e/fixtures/lease/fixture-lease.pdf: a two-page Virginia lease with obviously fake
// personal details. Page 1 has a text layer; page 2 is an image only, like a scanned page, so
// the app reads one page from the PDF's text and the other with OCR.
//
// From the repository root: swift e2e/fixtures/generate-lease.swift
//
// Every name, number, and address here is made up. Phone numbers use 555-01xx, the SSN is in
// the 987-65-432x range set aside for examples, and the domains are example domains.
import CoreGraphics
import CoreText
import Foundation

let pageSize = CGRect(x: 0, y: 0, width: 612, height: 792) // US Letter, points
let margin: CGFloat = 54

let pageOne = """
RESIDENTIAL LEASE AGREEMENT

This Lease is made on September 1, 2026, between Harbor Point Properties LLC ("Landlord") and Jordan Lee ("Tenant").

Landlord: Harbor Point Properties LLC
Property Manager: Marisol Quintero-Vance
Tenant: Jordan Lee
Co-Tenant: 张伟
Occupant: Zoë Ångström
Premises: 1427 Example Lane, Apt 3B, Richmond, VA 23220

1. Term. The term begins on September 1, 2026 and ends on August 31, 2027.
2. Rent. Tenant shall pay $1,450.00 per month, due on the 1st. A grace period of five days applies.
3. Security Deposit. Tenant shall pay a security deposit of $2,900.00, as allowed by Va. Code § 55.1-1226.
4. Late Fee. A late fee of 10% of the monthly rent is charged after the 5th.
5. Payments. Pay online at https://portal.harborpoint-example.com or by bank transfer to account number 000123456789, routing number 123456780.
6. Contact. Call Marisol at (804) 555-0134 or email marisol.qv@harborpoint-example.com. Harbor Point answers within two business days.
7. Entry. Landlord may enter the Premises with 24 hours' notice, as the Virginia Residential Landlord and Tenant Act allows.
8. Notices. Ms. Lee and Zoë Ångström will receive notices at the Premises.
"""

let pageTwo = """
TENANT INFORMATION

Applicant: Jordan Lee
Date of Birth: 03/14/1990
SSN: 987-65-4321
Driver's License: T12345678
Phone: 804-555-0199
Email: jordan.lee@example.com
Emergency Contact: Priya Ramanathan, 804-555-0172

Signed: Jordan Lee
Date: August 15, 2026
"""

func attributed(_ text: String, size: CGFloat) -> NSAttributedString {
    let font = CTFontCreateWithName("Helvetica" as CFString, size, nil)
    var spacing = size * 0.35
    let style = withUnsafeBytes(of: &spacing) { bytes in
        var setting = CTParagraphStyleSetting(spec: .paragraphSpacing, valueSize: MemoryLayout<CGFloat>.size, value: bytes.baseAddress!)
        return CTParagraphStyleCreate(&setting, 1)
    }
    return NSAttributedString(string: text, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1),
        NSAttributedString.Key(kCTParagraphStyleAttributeName as String): style,
    ])
}

func drawText(_ text: NSAttributedString, in context: CGContext, rect: CGRect) {
    let framesetter = CTFramesetterCreateWithAttributedString(text)
    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, context)
}

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "e2e/fixtures/lease/fixture-lease.pdf")
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

var mediaBox = pageSize
let info: [CFString: Any] = [kCGPDFContextTitle: "Fixture lease", kCGPDFContextCreator: "FinePrint e2e fixtures"]
guard let pdf = CGContext(output as CFURL, mediaBox: &mediaBox, info as CFDictionary) else { fatalError("Cannot create \(output.path)") }

// Page 1: real text, so PDFKit returns it from the text layer.
pdf.beginPDFPage(nil)
drawText(attributed(pageOne, size: 11), in: pdf, rect: pageSize.insetBy(dx: margin, dy: margin))
pdf.endPDFPage()

// Page 2: the same kind of text drawn into a bitmap at 200 dpi, then placed as an image. The PDF
// has no text for this page, so the app has to OCR it.
let scale: CGFloat = 200 / 72
let bitmapWidth = Int(pageSize.width * scale)
let bitmapHeight = Int(pageSize.height * scale)
guard let bitmap = CGContext(
    data: nil, width: bitmapWidth, height: bitmapHeight, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
) else { fatalError("Cannot create bitmap") }
bitmap.setFillColor(gray: 1, alpha: 1)
bitmap.fill(CGRect(x: 0, y: 0, width: bitmapWidth, height: bitmapHeight))
bitmap.scaleBy(x: scale, y: scale)
drawText(attributed(pageTwo, size: 14), in: bitmap, rect: pageSize.insetBy(dx: margin, dy: margin))
guard let scan = bitmap.makeImage() else { fatalError("Cannot render page 2") }

pdf.beginPDFPage(nil)
pdf.draw(scan, in: pageSize)
pdf.endPDFPage()
pdf.closePDF()

print("Wrote \(output.path)")
