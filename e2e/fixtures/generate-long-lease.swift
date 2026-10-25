// Draws e2e/fixtures/lease/long-lease.pdf: a 40-page Virginia lease with a text layer on every
// page and no personal details, for break-ui on the findings list and the clause explorer
// (#18, spec §11). Clause 4 has a 15% late fee, so a check finds it.
//
// From the repository root: swift e2e/fixtures/generate-long-lease.swift
// Then launch with -FinePrintFixtureLease <abs path to long-lease.pdf>, and with
// -FinePrintStubFindings 25 to try 25 findings without a model.
import CoreGraphics
import CoreText
import Foundation

let pageSize = CGRect(x: 0, y: 0, width: 612, height: 792) // US Letter, points
let margin: CGFloat = 54
let pageCount = 40

let clauses = [
    "Rent. Tenant shall pay $1,450.00 per month, due on the 1st. A grace period of five days applies.",
    "Security Deposit. Tenant shall pay a security deposit of $2,900.00, as allowed by Va. Code § 55.1-1226.",
    "Utilities. Tenant pays for electricity, gas, water, sewer, trash, internet, and cable, and keeps each account in Tenant's name for the whole term.",
    "Late Fee. A late fee of 15% of the monthly rent is charged after the 5th.",
    "Entry. Landlord may enter the Premises with 24 hours' notice for routine maintenance, and at any time in an emergency.",
    "Repairs. Tenant shall make all repairs under $200 at Tenant's own cost, including repairs to heating, plumbing, and electrical systems.",
    "Renewal. This Lease renews for another full year unless either party gives written notice at least 60 days before the end of the term.",
    "Pets. No pets are allowed without Landlord's written consent. A pet fee of $400 applies to each approved pet and is not refundable.",
    "Attorney's Fees. Tenant shall pay all of Landlord's attorney's fees in any dispute, whatever its outcome.",
    "Move-Out. Tenant shall have the carpets professionally cleaned at move-out and provide a receipt.",
]

func pageText(_ page: Int) -> String {
    var text = "RESIDENTIAL LEASE AGREEMENT, PAGE \(page) OF \(pageCount)\n\n"
    for index in 0..<3 {
        let number = (page - 1) * 3 + index + 1
        let clause = clauses[(number - 1) % clauses.count]
        text += "\(number). \(clause) This clause is part of a long test lease and repeats so the lease reaches \(pageCount) pages. It has more words than a real clause would so that every page holds a full screen of text at the largest text size.\n\n"
    }
    return text
}

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

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "e2e/fixtures/lease/long-lease.pdf")
try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)

var mediaBox = pageSize
let info: [CFString: Any] = [kCGPDFContextTitle: "Long fixture lease", kCGPDFContextCreator: "FinePrint e2e fixtures"]
guard let pdf = CGContext(output as CFURL, mediaBox: &mediaBox, info as CFDictionary) else { fatalError("Cannot create \(output.path)") }

for page in 1...pageCount {
    pdf.beginPDFPage(nil)
    let framesetter = CTFramesetterCreateWithAttributedString(attributed(pageText(page), size: 11))
    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: pageSize.insetBy(dx: margin, dy: margin), transform: nil), nil)
    CTFrameDraw(frame, pdf)
    pdf.endPDFPage()
}
pdf.closePDF()

print("Wrote \(output.path)")
