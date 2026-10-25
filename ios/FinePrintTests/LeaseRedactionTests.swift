import Foundation
import Testing
@testable import FinePrint

/// The fixture lease e2e also uses: `ios/FinePrintTests/` is two levels below the repository root.
enum FixtureLease {
    static let folder = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "e2e/fixtures/lease", directoryHint: .isDirectory)
    static let pdf = folder.appending(path: "fixture-lease.pdf")

    struct PersonalDetails: Decodable {
        var details: [String]
        var kept: [String]
    }

    static func personalDetails() throws -> PersonalDetails {
        try JSONDecoder().decode(PersonalDetails.self, from: Data(contentsOf: folder.appending(path: "personal-details.json")))
    }
}

/// True when `text` contains `value` as whole words, ignoring case and accents.
private func mentions(_ text: String, _ value: String) -> Bool {
    !TextMatcher.ranges(of: value, in: text, mode: .phrase).isEmpty
}

@Suite("Redaction patterns")
struct RedactionPatternTests {
    struct Hit: CustomTestStringConvertible, Sendable {
        var text: String
        var value: String
        var kind: RedactionKind
        var testDescription: String { "\(kind): \(value)" }
    }

    nonisolated static let hits: [Hit] = [
        Hit(text: "SSN 123-45-6789 on file.", value: "123-45-6789", kind: .ssn),
        Hit(text: "SSN: 123 45 6789", value: "123 45 6789", kind: .ssn),
        Hit(text: "Social Security No. 123456789 here.", value: "123456789", kind: .ssn),
        Hit(text: "Write to alex.rivera+lease@mail.example.org today.", value: "alex.rivera+lease@mail.example.org", kind: .email),
        Hit(text: "Routing # 123456780 for rent.", value: "123456780", kind: .routingNumber),
        Hit(text: "Wire to 123456780 please.", value: "123456780", kind: .routingNumber),
        Hit(text: "Bank account no. 4455 6677 8899 for rent.", value: "4455 6677 8899", kind: .bankAccount),
        Hit(text: "Acct #: 99887766.", value: "99887766", kind: .bankAccount),
        Hit(text: "Card 4111 1111 1111 1111 on file.", value: "4111 1111 1111 1111", kind: .cardNumber),
        Hit(text: "Date of birth: March 14, 1990.", value: "March 14, 1990", kind: .birthDate),
        Hit(text: "DOB 1990-03-14", value: "1990-03-14", kind: .birthDate),
        Hit(text: "Born on 3/14/90.", value: "3/14/90", kind: .birthDate),
        Hit(text: "Driver's license number: T12345678.", value: "T12345678", kind: .driversLicense),
        Hit(text: "Driver’s License T12-345-678", value: "T12-345-678", kind: .driversLicense),
        Hit(text: "DL # A1234567", value: "A1234567", kind: .driversLicense),
        Hit(text: "Phone: (804) 555-0134", value: "(804) 555-0134", kind: .phone),
        Hit(text: "Cell 804.555.0199", value: "804.555.0199", kind: .phone),
        Hit(text: "Fax +1 804 555 0100", value: "+1 804 555 0100", kind: .phone),
        Hit(text: "Visit www.harborpoint-example.com for forms.", value: "www.harborpoint-example.com", kind: .link),
        Hit(text: "Mail rent to 500 Sample Street, Suite 200, Norfolk, VA 23510.", value: "500 Sample Street", kind: .address),
        Hit(text: "Premises: Unit 4, 12 Example Court, Norfolk, VA 23510", value: "Unit 4, 12 Example Court, Norfolk, VA 23510", kind: .address),
        Hit(text: "Tenant: Jordan Lee", value: "Jordan Lee", kind: .tenant),
        Hit(text: "Tenant(s): Sam O'Brien-Nguyen", value: "Sam O'Brien-Nguyen", kind: .tenant),
        Hit(text: "Guarantor: Dana Whitfield", value: "Dana Whitfield", kind: .guarantor),
        Hit(text: "Landlord: Harbor Point Properties LLC", value: "Harbor Point Properties LLC", kind: .landlord),
        Hit(text: "Property Manager: Marisol Quintero-Vance", value: "Marisol Quintero-Vance", kind: .manager),
        Hit(text: "Emergency Contact: Priya Ramanathan, 804-555-0172", value: "Priya Ramanathan", kind: .name),
        Hit(text: "Co-Tenant: 张伟", value: "张伟", kind: .tenant),
        Hit(text: "Occupant: Zoë Ångström", value: "Zoë Ångström", kind: .occupant),
        Hit(text: #"This Lease is between Oak Hill Rentals LLC ("Landlord") and Sam Ortiz ("Tenant")."#, value: "Sam Ortiz", kind: .tenant),
        Hit(text: #"This Lease is between Oak Hill Rentals LLC ("Landlord") and Sam Ortiz ("Tenant")."#, value: "Oak Hill Rentals LLC", kind: .landlord),
        Hit(text: "The owner, Beatriz Albuquerque, will inspect the unit.", value: "Beatriz Albuquerque", kind: .landlord),
        // Review of 6ebf572: values glued to their label.
        Hit(text: "SSN987-65-4321", value: "987-65-4321", kind: .ssn),
        Hit(text: "DOB03/14/1990", value: "03/14/1990", kind: .birthDate),
        Hit(text: "RTN123456780", value: "123456780", kind: .routingNumber),
        Hit(text: "DLT12345678", value: "T12345678", kind: .driversLicense),
        // Other separators and label forms.
        Hit(text: "SSN 987.65.4321", value: "987.65.4321", kind: .ssn),
        Hit(text: "SSN 987–65–4321", value: "987–65–4321", kind: .ssn),
        Hit(text: "SSN 987‐65‐4321", value: "987‐65‐4321", kind: .ssn),
        Hit(text: "Social Security Number (SSN): 987654321", value: "987654321", kind: .ssn),
        Hit(text: "Birthday: 03/14/1990", value: "03/14/1990", kind: .birthDate),
        Hit(text: "Date of Birth:\n03/14/1990", value: "03/14/1990", kind: .birthDate),
        Hit(text: "Driver's License: VA T12345678", value: "T12345678", kind: .driversLicense),
        Hit(text: "Driver's License (VA): T12345678", value: "T12345678", kind: .driversLicense),
        Hit(text: "License on file: T12345678", value: "T12345678", kind: .driversLicense),
        Hit(text: "Account Number - 000123456789", value: "000123456789", kind: .bankAccount),
        // Several names in one field, non-Latin and all-caps names, more labels, name particles.
        Hit(text: "Tenant(s): Jordan Lee, 张伟", value: "张伟", kind: .tenant),
        Hit(text: "Tenants: Jordan Lee and SAM ORTIZ", value: "SAM ORTIZ", kind: .tenant),
        Hit(text: "Witness: Dana Whitfield", value: "Dana Whitfield", kind: .name),
        Hit(text: "Authorized Occupant: Mina Park", value: "Mina Park", kind: .occupant),
        Hit(text: #"Maria de la Cruz ("Tenant") signs below."#, value: "Maria de la Cruz", kind: .tenant),
    ]

    @Test(arguments: hits)
    func `hides the detail`(_ hit: Hit) throws {
        let map = PIIDetector().redactionMap(for: hit.text)
        let redaction = try #require(map.redactions.first { mentions($0.original, hit.value) }, "found nothing for \(hit.value) in \(map.redactions.map(\.original))")
        #expect(redaction.kind == hit.kind)
        let redacted = map.redact(hit.text)
        #expect(!redacted.contains(hit.value))
        #expect(redacted.contains(redaction.placeholder))
    }

    /// Lease text that looks a little like personal data and must reach the analysis unchanged.
    nonisolated static let nearMisses: [String] = [
        "Rent is $1,450.00 per month.",
        "The security deposit is $2,900.00.",
        "See Va. Code § 55.1-1226 and § 55.1-1204(B).",
        "The term begins on September 1, 2026 and ends 2027-08-31.",
        "Lease start date: 01/01/2027.",
        "Tenant shall give 30 days' notice. Landlord may enter with 24 hours' notice.",
        "The Virginia Residential Landlord and Tenant Act applies.",
        "A grace period of five days applies.",
        "Statutes: https://law.lis.virginia.gov/vacode/title55.1/",
        "Unit 4B. Mailbox 1203.",
        "Deposit goes into an escrow account within 30 days.",
        "Account of the Tenant.",
        "Reference 123456789.",
        "Number 4111 1111 1111 1112.",
        "Zip 23220-1234.",
        "Driver's license is required at move-in.",
        "Call 911 in an emergency.",
        "Late fee is 10% after the 5th.",
        "email at office dot com",
        "Tenant: shall pay rent on time.",
        "Pet fee $300. Parking space 12.",
        // Review of 6ebf572: a blank date of birth must not take the lease date with it.
        "Date of Birth: ________ Lease Date: September 1, 2026",
        // A sentence after a label is not a name.
        "Tenant: Tenant shall pay $1,450.00 monthly.\nTENANT SHALL PAY ALL FEES AND WAIVES ALL CLAIMS.",
    ]

    @Test(arguments: nearMisses)
    func `leaves lease terms alone`(_ text: String) {
        let map = PIIDetector().redactionMap(for: text)
        #expect(map.redact(text) == text, "hid \(map.redactions.map(\.original))")
    }

    @Test(arguments: [
        ("123456780", true), ("021000021", true), ("123456789", false), ("000000000", false), ("12345678", false),
    ])
    func `routing numbers pass the ABA checksum`(_ value: String, _ valid: Bool) {
        #expect(PIIDetector.isABARoutingNumber(value) == valid)
    }

    @Test(arguments: [
        ("4111 1111 1111 1111", true), ("4111111111111112", false), ("000123456789", false),
    ])
    func `card numbers pass the Luhn check`(_ value: String, _ valid: Bool) {
        #expect(PIIDetector.isLuhnValid(value) == valid)
    }
}

@Suite("Redaction map")
struct RedactionMapTests {
    static let lease = """
    Tenant: Jordan Lee
    Landlord: Harbor Point Properties LLC
    Ms. Lee pays Harbor Point on the 1st. JORDAN LEE signs below.
    A grace period of five days applies.
    """

    @Test func `the same detail gets the same placeholder everywhere`() throws {
        let map = PIIDetector().redactionMap(for: Self.lease)
        let redacted = map.redact(Self.lease)
        #expect(redacted == """
        Tenant: [TENANT_1]
        Landlord: [LANDLORD_1]
        Ms. [TENANT_1] pays [LANDLORD_1] on the 1st. [TENANT_1] signs below.
        A grace period of five days applies.
        """)
    }

    @Test func `a name's single words are hidden, but only where they start with a capital`() {
        let text = "Tenant: Grace Park\nGrace pays on time. A grace period applies. Park in space 4."
        let map = PIIDetector().redactionMap(for: text)
        let redacted = map.redact(text)
        #expect(redacted.contains("[TENANT_1] pays on time"))
        #expect(redacted.contains("A grace period applies"))
    }

    @Test func `scanned spellings without accents still match`() {
        let text = "Occupant: Zoë Ångström\nNotices go to ZOE ANGSTROM."
        let map = PIIDetector().redactionMap(for: text)
        #expect(map.redact(text) == "Occupant: [OCCUPANT_1]\nNotices go to [OCCUPANT_1].")
    }

    @Test func `turning a redaction off sends that text as written`() throws {
        var map = PIIDetector().redactionMap(for: Self.lease)
        let index = try #require(map.redactions.firstIndex { $0.kind == .landlord })
        map.redactions[index].isHidden = false
        let redacted = map.redact(Self.lease)
        #expect(redacted.contains("Harbor Point Properties LLC"))
        #expect(!redacted.contains("Jordan"))
        #expect(map.hiddenCount == map.redactions.count - 1)
    }

    @Test func `the tenant can hide more text everywhere`() throws {
        var map = PIIDetector().redactionMap(for: Self.lease)
        let hidden = map.hide("grace period", in: Self.lease)
        let added = try #require(hidden)
        #expect(added.addedByTenant)
        #expect(added.placeholder == "[HIDDEN_1]")
        #expect(map.redact(Self.lease).contains("A [HIDDEN_1] of five days"))
    }

    @Test func `hiding text that is not in the lease does nothing`() {
        var map = PIIDetector().redactionMap(for: Self.lease)
        let before = map
        #expect(map.hide("Norfolk", in: Self.lease) == nil)
        #expect(map.hide("   ", in: Self.lease) == nil)
        #expect(map == before)
    }

    @Test func `hiding a detail that was turned off turns it back on`() throws {
        var map = PIIDetector().redactionMap(for: Self.lease)
        let index = try #require(map.redactions.firstIndex { $0.kind == .tenant })
        map.redactions[index].isHidden = false
        let count = map.redactions.count
        let hidden = map.hide("jordan lee", in: Self.lease)
        let again = try #require(hidden)
        #expect(again.kind == .tenant)
        #expect(map.redactions.count == count)
        #expect(!map.redact(Self.lease).contains("Jordan"))
    }

    /// Review of 6ebf572: every place a detail is found must be replaced, however it is spelled,
    /// wrapped, or glued to the text around it.
    nonisolated static let leaks: [(text: String, leaked: [String])] = [
        ("Mail rent to 1427 Example Lane, Richmond, VA 23220.\nThe home at 1427 Example\nLane, Richmond, VA 23220 is yours.", ["1427", "Example"]),
        ("Date of birth: March\n14, 1990.", ["14, 1990", "1990"]),
        ("Tenant: Jordan Lee\nOccupants: Mina Lee, Kai Lee\nKai and Mina have keys.", ["Jordan", "Mina", "Kai", "Lee"]),
        (#"Maria de la Cruz ("Tenant") lives here. Maria pays rent."#, ["Maria", "Cruz"]),
        ("Tenant: April Page\nMs. Page pays. April signs.", ["April", "Page"]),
        ("Tenant: Sam O’Brien\nNotices go to Sam O'Brien.", ["O'Brien", "O’Brien"]),
        ("SSN987-65-4321, DOB03/14/1990, RTN123456780, DLT12345678.", ["987-65-4321", "03/14/1990", "123456780", "T12345678"]),
    ]

    @Test(arguments: leaks)
    func `nothing leaks`(_ text: String, _ leaked: [String]) {
        let redacted = PIIDetector().redactionMap(for: text).redact(text)
        for value in leaked {
            #expect(!redacted.contains(value), "\(value) leaked: \(redacted)")
        }
    }

    @Test func `a value glued to a label can be hidden by hand`() {
        var map = RedactionMap()
        let text = "SSN987-65-4321"
        let hidden = map.hide("987-65-4321", in: text)
        #expect(hidden != nil)
        #expect(map.redact(text) == "SSN[HIDDEN_1]")
    }

    @Test func `overlapping redactions never leave part of either showing`() {
        let id1 = UUID(), id2 = UUID()
        let map = RedactionMap(redactions: [
            Redaction(id: id1, original: "Harbor Point Properties", kind: .organization, placeholder: "[ORG_1]"),
            Redaction(id: id2, original: "Point Properties LLC", kind: .custom, placeholder: "[HIDDEN_1]"),
        ])
        #expect(map.redact("Pay Harbor Point Properties LLC now.") == "Pay [ORG_1] now.")
    }

    @Test func `paragraphs join wrapped lines and split fields and clauses`() {
        let text = "RESIDENTIAL LEASE\nThis Lease is made between A and\nB today.\nTenant: Jordan Lee\nLandlord: Harbor\n1. Term. One year.\n\nPage two."
        let paragraphs = RedactionLayout.paragraphs(in: text).map { String(text[$0]) }
        #expect(paragraphs == [
            "RESIDENTIAL LEASE",
            "This Lease is made between A and\nB today.",
            "Tenant: Jordan Lee",
            "Landlord: Harbor",
            "1. Term. One year.",
            "Page two.",
        ])
    }
}

@Suite("Fixture lease")
struct FixtureLeaseTests {
    @Test func `reads the text layer page and OCRs the scanned page`() async throws {
        let pages = try await LeaseReader().read(pdf: Data(contentsOf: FixtureLease.pdf))
        #expect(pages.map(\.method) == [.textLayer, .ocr])
        #expect(pages[0].text.contains("RESIDENTIAL LEASE AGREEMENT"))
        #expect(pages[1].text.contains("TENANT INFORMATION"))
        #expect((pages[1].confidence ?? 0) > 0.5)
    }

    @Test func `the upload contains none of the fixture's personal details`() async throws {
        let fixture = try FixtureLease.personalDetails()
        let pages = try await LeaseReader().read(pdf: Data(contentsOf: FixtureLease.pdf))
        let rental = Rental(name: "Richmond", serverID: "rental-1", city: "Richmond")
        var scan = await LeaseScan.make(rentalID: rental.id, source: .pdf, pages: pages)
        scan.reviewedAt = .now

        let upload = try await LeaseUpload.make(scan: scan, rentals: [rental])
        #expect(upload.path == "/v1/rentals/rental-1/leases")
        #expect(upload.body.pageCount == 2)
        let json = try #require(String(data: try upload.encodedBody(), encoding: .utf8))
        let body = try JSONDecoder().decode(LeaseUpload.Body.self, from: try upload.encodedBody())
        // Only these fields go to the server.
        let keys = try #require(try JSONSerialization.jsonObject(with: upload.encodedBody()) as? [String: Any]).keys
        #expect(Set(keys) == ["text", "locale", "readingLevel", "pageCount", "ocrConfidence"])

        for detail in fixture.details {
            #expect(!mentions(body.text, detail), "\(detail) is in the upload")
            #expect(!json.contains(detail), "\(detail) is in the JSON")
        }
        // The text layer wraps lines, so compare with whitespace collapsed.
        let flattened = body.text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        for term in fixture.kept {
            #expect(flattened.contains(term), "\(term) was hidden")
        }
        #expect(body.text.contains("[TENANT_1]"))
        #expect(body.text.contains("[SSN_1]"))
    }

    @Test func `the upload is only for the current rental's reviewed lease`() async throws {
        let older = Rental(name: "Richmond", createdAt: .now.addingTimeInterval(-60), serverID: "rental-1")
        let current = Rental(name: "Norfolk", serverID: nil)
        let pages = [LeasePage(text: "Tenant: Jordan Lee", method: .textLayer)]
        var scan = await LeaseScan.make(rentalID: older.id, source: .pdf, pages: pages)
        await #expect(throws: LeaseUpload.Unavailable.notCurrentRental) {
            try await LeaseUpload.make(scan: scan, rentals: [older, current])
        }
        scan.rentalID = current.id
        await #expect(throws: LeaseUpload.Unavailable.notReviewed) {
            try await LeaseUpload.make(scan: scan, rentals: [older, current])
        }
        scan.reviewedAt = .now
        await #expect(throws: LeaseUpload.Unavailable.rentalNotOnServer) {
            try await LeaseUpload.make(scan: scan, rentals: [older, current])
        }
    }
}

@Suite("Lease store")
struct LeaseStoreTests {
    let store = LeaseStore(root: URL.temporaryDirectory.appending(path: "LeaseStoreTests-\(UUID().uuidString)", directoryHint: .isDirectory))

    @Test func `saves, loads, and deletes a rental's lease on the device`() async throws {
        let rentalID = UUID()
        let scan = await LeaseScan.make(rentalID: rentalID, source: .pdf, pages: [LeasePage(text: "Tenant: Jordan Lee", method: .textLayer)])
        try await store.save(scan, original: Data("%PDF".utf8))
        // Written with complete protection; the simulator does not report it back, so only the files are checked.
        #expect(FileManager.default.fileExists(atPath: store.scanURL(for: rentalID).path(percentEncoded: false)))
        #expect(FileManager.default.fileExists(atPath: store.originalURL(for: rentalID).path(percentEncoded: false)))
        #expect(try await store.load(rentalID: rentalID) == scan)
        #expect(try await store.load(rentalID: UUID()) == nil)

        try await store.delete(rentalID: rentalID)
        #expect(try await store.load(rentalID: rentalID) == nil)
        #expect(!FileManager.default.fileExists(atPath: store.directory(for: rentalID).path(percentEncoded: false)))
    }

    @Test func `leases stay out of backups`() async throws {
        let scan = await LeaseScan.make(rentalID: UUID(), source: .pdf, pages: [LeasePage(text: "Tenant: Jordan Lee", method: .textLayer)])
        try await store.save(scan)
        let values = try store.root.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(values.isExcludedFromBackup == true)
    }

    #if DEBUG
    @Test func `reads the fixture lease argument`() {
        let options = LaunchOptions(arguments: ["FinePrint", "-FinePrintFixtureLease", "/tmp/lease.pdf"], environment: [:])
        #expect(options.fixtureLeaseFile == "/tmp/lease.pdf")
        #expect(LaunchOptions(arguments: ["FinePrint"], environment: [:]).fixtureLeaseFile == nil)
    }
    #endif
}
