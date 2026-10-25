import Foundation
import SwiftUI
import Testing
@testable import FinePrint

/// A finding as `server/src/ai/pipeline/types.ts` sends it, extra fields and all.
private let lateFeeFindingJSON = #"""
{"id":"f1","severity":"unenforceable","basis":"check","ruleId":"va-late-fee-cap","citation":"Va. Code § 55.1-1204(E)","sourceUrl":"https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1204/","checkType":"deterministic","versions":[{"version":{"effectiveFrom":"2019-10-01","effectiveUntil":null},"from":"2026-09-01","until":"2027-08-31"}],"changes":[],"statuteQuote":"No landlord shall charge a late fee in excess of the lesser of 10 percent of the periodic rent or 10 percent of the remaining balance due and owed by the tenant.","clauseId":"c4","leaseQuote":"A late fee of 15% of the monthly rent is charged after the 5th.","quoteSpan":{"start":10,"end":72},"primaryAssessment":"violates","primaryModel":null,"primaryFallback":false,"verifier":null,"check":{"limit":145,"actual":217.5,"unit":"usd"},"titleEn":"The late fee is higher than Virginia allows","explanationEn":"Your lease charges 15% of the rent as a late fee.","actionEn":"You can ask the landlord to lower it to 10%.","readability":{"grade":5.1,"target":7,"source":"model"},"translations":{"es":{"title":"El recargo por pago tardío supera el límite de Virginia","explanation":"Su contrato cobra un 15%.","action":"Puede pedir que lo bajen al 10%.","model":"gemma","fallback":false}}}
"""#

private func stream(_ body: String) -> Data { Data(body.utf8) }

@Suite("Server-sent events")
struct ServerSentEventTests {
    @Test func `splits messages at blank lines and joins data lines`() {
        var decoder = ServerSentEventDecoder()
        let messages = decoder.feed(stream("event: stage\nid: 1\ndata: {\"a\":1}\n\nevent: finding\ndata: line one\ndata: line two\n\n"))
        #expect(messages == [
            ServerSentEvent(event: "stage", data: #"{"a":1}"#, id: "1"),
            ServerSentEvent(event: "finding", data: "line one\nline two", id: "1"),
        ])
    }

    @Test func `skips comments such as the keepalive`() {
        var decoder = ServerSentEventDecoder()
        #expect(decoder.feed(stream(": keepalive\n\n: keepalive\n\ndata: x\n\n")) == [ServerSentEvent(event: "message", data: "x", id: nil)])
    }

    @Test func `reads CRLF line endings and a value without a space`() {
        var decoder = ServerSentEventDecoder()
        #expect(decoder.feed(stream("event:done\r\ndata:{}\r\n\r\n")) == [ServerSentEvent(event: "done", data: "{}", id: nil)])
    }

    @Test func `a message split across chunks comes out once, whole`() {
        var decoder = ServerSentEventDecoder()
        let bytes = Array("event: stage\ndata: café ✓\n\n".utf8)
        var messages: [ServerSentEvent] = []
        // Split inside a multi-byte character too.
        for chunk in [bytes[0..<7], bytes[7..<22], bytes[22...]] {
            messages += decoder.feed(chunk)
        }
        #expect(messages == [ServerSentEvent(event: "stage", data: "café ✓", id: nil)])
    }

    @Test func `finish dispatches a last message with no blank line after it`() {
        var decoder = ServerSentEventDecoder()
        #expect(decoder.feed(stream("event: done\ndata: {}")).isEmpty)
        #expect(decoder.finish() == ServerSentEvent(event: "done", data: "{}", id: nil))
        #expect(decoder.finish() == nil)
    }
}

@Suite("Lease stream events")
struct LeaseEventTests {
    @Test func `decodes a finding the server sends, ignoring fields the app doesn't use`() throws {
        let event = try #require(try LeaseEvent(ServerSentEvent(event: "finding", data: lateFeeFindingJSON, id: "4")))
        guard case .finding(let finding) = event else {
            Issue.record("Expected a finding, got \(event)")
            return
        }
        #expect(finding.id == "f1")
        #expect(finding.severity == .unenforceable)
        #expect(finding.hasRule)
        #expect(finding.citation == "Va. Code § 55.1-1204(E)")
        #expect(finding.statuteURL?.host() == "law.lis.virginia.gov")
        #expect(finding.quoteSpan == TextSpan(start: 10, end: 72))
        #expect(finding.text(in: "en").title == "The late fee is higher than Virginia allows")
        #expect(finding.text(in: "es").title == "El recargo por pago tardío supera el límite de Virginia")
        // No translation: English.
        #expect(finding.text(in: "fr").action == "You can ask the landlord to lower it to 10%.")
    }

    @Test func `an error with a retry is a wait, without one it ends the check`() throws {
        let wait = try LeaseEvent(ServerSentEvent(event: "error", data: #"{"code":"RATE_LIMITED","message":"Waiting","retryInMs":4000,"model":"gemma"}"#, id: nil))
        #expect(wait == .waiting(code: "RATE_LIMITED", retryIn: .milliseconds(4000)))
        let stop = try LeaseEvent(ServerSentEvent(event: "error", data: #"{"code":"DEPENDENCY_UNAVAILABLE","message":"No model answered"}"#, id: nil))
        #expect(stop == .failed(code: "DEPENDENCY_UNAVAILABLE"))
    }

    @Test func `reads stages, key terms, and done; skips events it doesn't know`() throws {
        let body = """
        : keepalive

        event: stage
        data: {"stage":"S2","label":"Reading your lease","progress":0.2}

        event: keyterms
        data: {"keyTerms":[{"name":"lateFee","value":"15%","unit":"usd","amount":217.5,"date":null,"quote":"A late fee of 15%","quoteSpan":{"start":10,"end":27},"clauseId":"c4"}]}

        event: surprise
        data: {}

        event: finding
        data: \(lateFeeFindingJSON)

        event: finding
        data: {"id":"f2","severity":"not-a-severity"}

        event: done
        data: {"status":"analyzed","findings":1,"tokens":{"in":1,"out":2},"calls":3,"ms":40,"models":[],"injection":null,"replay":true}

        """
        let events = LeaseStream.events(in: stream(body))
        #expect(events.count == 4)
        #expect(events.first == .stage(LeaseStage(stage: "S2", label: "Reading your lease", progress: 0.2)))
        guard case .keyTerms(let terms) = events[1] else {
            Issue.record("Expected key terms, got \(events[1])")
            return
        }
        #expect(terms.map(\.name) == ["lateFee"])
        #expect(terms.first?.value == "15%")
        if case .finding(let finding) = events[2] { #expect(finding.id == "f1") } else { Issue.record("Expected the finding") }
        #expect(events.last == .done(LeaseDone(status: .analyzed, findings: 1, message: nil, replay: true)))
    }

    @Test func `reads the error code from the server's envelope`() {
        #expect(LeaseStream.errorCode(in: stream(#"{"error":{"code":"CONFLICT","message":"busy"}}"#)) == "CONFLICT")
        #expect(LeaseStream.errorCode(in: stream("not json")) == nil)
    }

    @Test(arguments: [
        (APIError.offline, LeaseAnalysisFailure.offline),
        (.server(status: 422, code: "UNSUPPORTED_JURISDICTION"), .unsupportedJurisdiction),
        (.server(status: 503, code: "DEPENDENCY_UNAVAILABLE"), .unavailable),
        (.server(status: 409, code: "CONFLICT"), .busy),
        (.server(status: 500, code: nil), .other),
        (.auth(.offline), .signIn),
    ])
    func `maps server errors to what the tenant reads`(error: APIError, failure: LeaseAnalysisFailure) {
        #expect(LeaseAnalysisFailure(error) == failure)
    }
}

@Suite("Findings")
struct LeaseFindingTests {
    private func finding(_ id: String, _ severity: Severity) -> LeaseFinding {
        var finding = LeaseFinding.preview(id: id, severity: severity)
        finding.id = id
        return finding
    }

    @Test func `most serious first, then the server's order, f10 after f9`() {
        let findings = [finding("f10", .ask), finding("f2", .info), finding("f9", .ask), finding("f3", .unenforceable)]
        #expect(findings.sorted(by: LeaseFinding.displayOrder).map(\.id) == ["f3", "f9", "f10", "f2"])
    }

    @Test func `a span counts UTF-16 units, as the server does`() throws {
        let text = "Zoë 😀 pays a late fee each month."
        let location = (text as NSString).range(of: "late fee").location
        let span = TextSpan(start: location, end: location + 8)
        let range = try #require(span.range(in: text))
        #expect(text[range] == "late fee")
        #expect(TextSpan(start: 0, end: text.utf16.count + 1).range(in: text) == nil)
        #expect(TextSpan(start: 5, end: 3).range(in: text) == nil)
    }

    @Test func `a finding without a rule makes no legal claim`() {
        let finding = LeaseFinding.preview(severity: .info)
        #expect(!finding.hasRule)
        #expect(finding.statuteURL == nil)
    }
}

@Suite("Clause explorer")
@MainActor
struct ClauseExplorerTests {
    @Test func `splits at blank lines and keeps each paragraph's place in the text`() {
        let text = "\n1. Rent. $1,450.\nDue on the 1st.\n\n\n2. Late Fee. 15%.\n\n"
        let paragraphs = LeaseParagraphs.split(text)
        #expect(paragraphs.map(\.text) == ["1. Rent. $1,450.\nDue on the 1st.", "2. Late Fee. 15%."])
        for paragraph in paragraphs {
            let range = paragraph.span.range(in: text)
            #expect(range.map { String(text[$0]) } == paragraph.text)
        }
    }

    @Test func `splits a long paragraph at line breaks`() {
        let line = String(repeating: "word ", count: 40)
        let text = Array(repeating: line, count: 20).joined(separator: "\n")
        let paragraphs = LeaseParagraphs.split(text, maxLength: 500)
        #expect(paragraphs.count > 1)
        #expect(paragraphs.allSatisfy { $0.text.utf16.count < 500 + line.utf16.count })
        #expect(paragraphs.map(\.text).joined(separator: "\n") == text)
    }

    @Test func `finds the paragraphs a span overlaps`() {
        let paragraphs = LeaseParagraphs.split("aaaa\n\nbbbb\n\ncccc")
        #expect(paragraphs.map(\.span) == [TextSpan(start: 0, end: 4), TextSpan(start: 6, end: 10), TextSpan(start: 12, end: 16)])
        #expect(LeaseParagraphs.index(containing: 5, in: paragraphs) == 1)
        #expect(LeaseParagraphs.index(containing: 20, in: paragraphs) == nil)
        #expect(LeaseParagraphs.indexes(overlapping: TextSpan(start: 2, end: 7), in: paragraphs) == [0, 1])
        #expect(LeaseParagraphs.indexes(overlapping: TextSpan(start: 4, end: 6), in: paragraphs) == [])
    }

    @Test func `a finding is highlighted in every paragraph it spans and named once`() {
        let text = "Intro.\n\nA late fee of 15%\n\nis charged.\n\nEnd."
        let paragraphs = LeaseParagraphs.split(text)
        let start = (text as NSString).range(of: "late fee").location
        let end = (text as NSString).range(of: "charged").location + 7
        let finding = LeaseFinding.preview(severity: .unenforceable, span: TextSpan(start: start, end: end))
        let rows = ClauseExplorerView.rows(paragraphs, findings: [finding], language: "en", focus: finding.quoteSpan)
        #expect(rows.map { $0.highlighted != nil } == [false, true, true, false])
        #expect(rows.map(\.marks.count) == [0, 1, 0, 0])
        #expect(rows.map(\.isFocused) == [false, true, true, false])
    }

    @Test func `a quote outside the text highlights nothing`() {
        let paragraphs = LeaseParagraphs.split("Short lease.")
        let finding = LeaseFinding.preview(severity: .ask, span: TextSpan(start: 500, end: 600))
        let rows = ClauseExplorerView.rows(paragraphs, findings: [finding], language: "en", focus: nil)
        #expect(rows.allSatisfy { $0.highlighted == nil && $0.marks.isEmpty })
    }
}

@Suite("Announcements")
struct AnnouncementQueueTests {
    let start = ContinuousClock.now

    @Test func `at most one every two seconds`() {
        var queue = AnnouncementQueue()
        #expect(queue.submit("Reading your lease", kind: .progress, at: start) == "Reading your lease")
        #expect(queue.submit("Likely unenforceable: late fee", kind: .important, at: start + .seconds(1)) == nil)
        #expect(queue.next(at: start + .milliseconds(1999)) == nil)
        #expect(queue.nextAllowed == start + .seconds(2))
        #expect(queue.next(at: start + .seconds(2)) == "Likely unenforceable: late fee")
        #expect(queue.isEmpty)
    }

    @Test func `newer progress replaces older progress, important ones wait their turn`() {
        var queue = AnnouncementQueue()
        _ = queue.submit("S1", kind: .progress, at: start)
        _ = queue.submit("S2", kind: .progress, at: start + .milliseconds(100))
        _ = queue.submit("Finding A", kind: .important, at: start + .milliseconds(200))
        _ = queue.submit("S3", kind: .progress, at: start + .milliseconds(300))
        _ = queue.submit("Finding B", kind: .important, at: start + .milliseconds(400))
        var posted: [String] = []
        var now = start
        while !queue.isEmpty {
            now += .seconds(2)
            if let text = queue.next(at: now) { posted.append(text) }
        }
        #expect(posted == ["Finding A", "S3", "Finding B"])
    }
}

@Suite("Sent lease record")
struct LeaseAnalysisRecordTests {
    let store = LeaseStore(root: URL.temporaryDirectory.appending(path: "LeaseAnalysisRecordTests-\(UUID().uuidString)", directoryHint: .isDirectory))

    @Test func `saves, loads, and forgets which lease the server has`() async throws {
        var scan = await LeaseScan.make(rentalID: UUID(), source: .pdf, pages: [LeasePage(text: "1. Rent. $1,450.", method: .textLayer)])
        scan.reviewedAt = .now
        try await store.save(scan)
        let record = LeaseAnalysisRecord(rentalID: scan.rentalID, reviewedAt: try #require(scan.reviewedAt), rentalServerID: "rental-1", leaseID: "lease-1")
        try await store.saveAnalysis(record)
        #expect(try await store.loadAnalysis(rentalID: scan.rentalID) == record)
        // Still the same review after a round trip through the files.
        let reloaded = try #require(try await store.load(rentalID: scan.rentalID))
        #expect(record.matches(reloaded))

        try await store.deleteAnalysis(rentalID: scan.rentalID)
        #expect(try await store.loadAnalysis(rentalID: scan.rentalID) == nil)
    }

    @Test func `a new review makes the record stale`() async {
        var scan = await LeaseScan.make(rentalID: UUID(), source: .pdf, pages: [LeasePage(text: "Rent.", method: .textLayer)])
        scan.reviewedAt = Date(timeIntervalSince1970: 1_000)
        let record = LeaseAnalysisRecord(rentalID: scan.rentalID, reviewedAt: Date(timeIntervalSince1970: 1_000), rentalServerID: "r", leaseID: "l")
        #expect(record.matches(scan))
        scan.reviewedAt = Date(timeIntervalSince1970: 2_000)
        #expect(!record.matches(scan))
    }
}

@Suite("Lease upload body")
struct LeaseUploadBodyTests {
    @Test func `sends the trimmed text with the tenant's language and reading level`() async {
        let scan = await LeaseScan.make(rentalID: UUID(), source: .pdf, pages: [LeasePage(text: "\n  1. Rent. $1,450.  \n", method: .textLayer)])
        let body = await LeaseUpload.body(for: scan, language: .spanish, readingLevel: .simpler)
        #expect(body.text == "1. Rent. $1,450.")
        #expect(body.locale == "es")
        #expect(body.readingLevel == "simpler")
        #expect(body.pageCount == 1)
        #expect(body.ocrConfidence == nil)
    }

    #if DEBUG
    @Test func `reads the stub findings argument`() {
        #expect(LaunchOptions(arguments: ["FinePrint", "-FinePrintStubFindings", "25"], environment: [:]).stubFindingCount == 25)
        #expect(LaunchOptions(arguments: ["FinePrint", "-FinePrintStubFindings", "0"], environment: [:]).stubFindingCount == 0)
        #expect(LaunchOptions(arguments: ["FinePrint"], environment: [:]).stubFindingCount == nil)
    }

    @Test func `the stub quotes the lease's own late fee clause`() throws {
        let text = "1. Rent. Tenant shall pay $1,450.00 per month.\n\n4. Late Fee. A late fee of 10% of the monthly rent is charged after the 5th."
        let events = LeaseAnalysisStub.events(for: text, count: 25)
        let findings = events.compactMap { event -> LeaseFinding? in
            if case .finding(let finding) = event { return finding }
            return nil
        }
        #expect(findings.count == 25)
        let first = try #require(findings.first)
        let span = try #require(first.quoteSpan)
        #expect(span.range(in: text).map { String(text[$0]) }?.contains("late fee") == true)
        #expect(events.last == .done(LeaseDone(status: .analyzed, findings: 25, message: nil, replay: nil)))
        #expect(LeaseAnalysisStub.events(for: text, count: 0).contains { if case .finding = $0 { true } else { false } } == false)
    }
    #endif
}
