import Foundation
import SwiftData
import Testing
@testable import FinePrint

/// A 201 from `POST /v1/rentals/:id/issues`, shaped as the server's `issueJson` writes it, with one
/// citation of each kind.
private let checkedBody = Data("""
{
  "issueId": "3f8a1c2e-1b7d-4c55-9a47-0d2b6c1e9f10",
  "status": "checked",
  "description": "The heater stopped working on January 3.",
  "room": "Bedroom",
  "checklistItem": "Fixtures",
  "photos": [],
  "locale": "en",
  "verdict": "likely_landlord",
  "category": "landlord_maintenance",
  "confidence": "high",
  "reasons": [
    {
      "text": "Virginia law says the landlord must keep heating in good working order.",
      "citation": {
        "kind": "rule",
        "ref": "VA_LANDLORD_MAINTAIN_FIT",
        "citation": "Va. Code § 55.1-1220(A)(4)",
        "quote": "Maintain in good and safe working order and condition all electrical, plumbing, sanitary, heating, ventilating, air-conditioning, and other facilities and appliances",
        "sourceUrl": "https://law.lis.virginia.gov/vacode/title55.1/chapter12/section55.1-1220/",
        "effectiveFrom": "2019-10-01"
      }
    },
    {
      "text": "Your lease says the landlord handles major systems.",
      "citation": { "kind": "lease", "ref": "lease.c10", "leaseId": "lease-1", "heading": null, "quote": "Landlord shall repair major systems.", "quoteSpan": { "start": 10, "end": 46 } }
    },
    {
      "text": "You photographed the heater at move-in.",
      "citation": { "kind": "evidence", "ref": "6b1e2f0a-3c4d-4e5f-8a9b-0c1d2e3f4a5b", "session": "move_in", "room": "Bedroom", "checklistItem": "Fixtures", "capturedAtDevice": "2026-08-14T15:12:03-04:00", "sealedManifestId": null }
    }
  ],
  "whatWouldChange": ["If you or a guest broke the heater, it would likely be your responsibility."],
  "escrowEligible": true,
  "verification": { "status": "agreed", "model": "gemma-4-31b-it", "verdict": "likely_landlord" },
  "downgraded": false,
  "models": { "primary": "gemma-4-26b-a4b-it", "verifier": "gemma-4-31b-it" },
  "leaseId": "lease-1",
  "createdAt": "2027-01-04T15:00:00.000Z",
  "triage": { "escalate": false, "category": "none", "model": { "status": "ok" }, "keywords": { "category": "none", "matches": [] } }
}
""".utf8)

private let escalatedBody = Data("""
{ "status": "escalated", "triage": { "escalate": true, "category": "immediate_danger", "model": { "status": "off" }, "keywords": { "category": "immediate_danger", "matches": ["en.immediate_danger.gas"] } } }
""".utf8)

@Suite("Responsibility check replies")
struct ResponsibilityReplyTests {
    @Test func `a checked reply decodes every citation kind`() throws {
        let reply = try JSONDecoder().decode(IssueReply.self, from: checkedBody)
        guard case .checked(let result, let triage) = reply else {
            Issue.record("expected a checked reply")
            return
        }
        #expect(triage == TriageDecision(escalate: false, category: .none))
        #expect(result.verdict == .likelyLandlord)
        #expect(result.category == .landlordMaintenance)
        #expect(result.confidence == .high)
        #expect(result.verification.status == .agreed)
        #expect(result.escrowEligible)
        #expect(result.reasons.count == 3)
        guard case .rule(let rule) = result.reasons[0].citation,
              case .lease(let lease) = result.reasons[1].citation,
              case .evidence(let photo) = result.reasons[2].citation else {
            Issue.record("expected rule, lease, and evidence citations")
            return
        }
        #expect(rule.citation == "Va. Code § 55.1-1220(A)(4)")
        #expect(rule.quote.hasPrefix("Maintain in good and safe working order"))
        #expect(lease.heading == nil)
        #expect(photo.session == .moveIn)
        #expect(photo.sealedManifestId == nil)
    }

    @Test func `an escalated reply carries only the triage decision`() throws {
        let reply = try JSONDecoder().decode(IssueReply.self, from: escalatedBody)
        #expect(reply == .escalated(TriageDecision(escalate: true, category: .immediateDanger)))
    }

    @Test func `a result survives being stored on an issue`() throws {
        guard case .checked(let result, _) = try JSONDecoder().decode(IssueReply.self, from: checkedBody) else {
            Issue.record("expected a checked reply")
            return
        }
        let issue = RepairIssue(details: "Heater", room: nil, checklistItem: nil, photoIDs: [], result: result, needsHandoff: false)
        #expect(issue.result == result)
        #expect(issue.serverID == result.issueId)
    }

    @Test func `the request leaves out what the tenant didn't choose`() throws {
        let request = CreateIssueRequest(description: "Heater", room: nil, checklistItem: nil, photoIds: [], locale: "es")
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        #expect(Set(json.keys) == ["description", "photoIds", "locale"])
    }

    @Test func `a 503 means the check isn't available, offline stays offline`() {
        #expect(ResponsibilityChecker.failure(for: .server(status: 503, code: "DEPENDENCY_UNAVAILABLE")) == .unavailable)
        #expect(ResponsibilityChecker.failure(for: .offline) == .offline)
        #expect(ResponsibilityChecker.failure(for: .server(status: 400, code: "BAD_REQUEST")) == .server(.server(status: 400, code: "BAD_REQUEST")))
    }
}

@Suite("Issue photos")
struct IssuePhotoTests {
    @Test func `a record saved before sessions existed reads as move-in`() throws {
        let old = Data("""
        {"itemId":"6B1E2F0A-3C4D-4E5F-8A9B-0C1D2E3F4A5B","rentalId":"6B1E2F0A-3C4D-4E5F-8A9B-0C1D2E3F4A5C","sha256":"ab","bytes":3,"mime":"image/jpeg","capturedAtDevice":"2026-08-14T15:12:03-04:00","deviceUptimeMs":5,"source":"in_app_camera","room":"Kitchen","checklistItem":"Walls","appVersion":"1.0 (1)"}
        """.utf8)
        let record = try JSONDecoder().decode(CaptureRecord.self, from: old)
        #expect(record.session == .moveIn)
        #expect(EvidenceItemRequest(record).session == .moveIn)
    }

    @Test func `an incident photo goes to the server as an incident`() throws {
        var record = try JSONDecoder().decode(CaptureRecord.self, from: Data("""
        {"itemId":"6B1E2F0A-3C4D-4E5F-8A9B-0C1D2E3F4A5B","rentalId":"6B1E2F0A-3C4D-4E5F-8A9B-0C1D2E3F4A5C","sha256":"ab","bytes":3,"mime":"image/jpeg","capturedAtDevice":"2026-08-14T15:12:03-04:00","deviceUptimeMs":5,"source":"in_app_camera","room":"Kitchen","checklistItem":"Walls","appVersion":"1.0 (1)","session":"incident"}
        """.utf8))
        #expect(record.session == .incident)
        record = try JSONDecoder().decode(CaptureRecord.self, from: JSONEncoder().encode(record))
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(EvidenceItemRequest(record))) as? [String: Any])
        #expect(json["session"] as? String == "incident")
    }
}

@Suite("New issue form")
struct IssueDraftTests {
    @Test func `a check needs words, and no more than the server takes`() {
        var draft = IssueDraft()
        #expect(!draft.canCheck)
        draft.details = "   \n"
        #expect(!draft.canCheck)
        draft.details = " The heater is broken. "
        #expect(draft.canCheck)
        #expect(draft.trimmedDetails == "The heater is broken.")
        draft.details = String(repeating: "a", count: IssueDraft.maxLength + 1)
        #expect(!draft.canCheck)
    }

    @Test func `photos need a room, up to four`() {
        var draft = IssueDraft(details: "Leak")
        #expect(!draft.canAddPhoto)
        draft.room = "Kitchen"
        #expect(draft.canAddPhoto)
        draft.photoIDs = (0..<IssueDraft.maxPhotos).map { _ in UUID() }
        #expect(!draft.canAddPhoto)
    }

    @Test func `walkthrough rooms come first, and a preset they already have isn't listed twice`() {
        let rooms = [WalkthroughRoom(name: "Back porch"), WalkthroughRoom(.kitchen)]
        let choices = IssueRoomChoice.choices(walkthroughRooms: rooms)
        #expect(choices.prefix(2).map(\.name) == ["Back porch", "Kitchen"])
        #expect(choices.filter { $0.name == "Kitchen" }.count == 1)
        #expect(choices.count == 1 + RoomPreset.allCases.count)
        #expect(choices.first { $0.name == "Bathroom" }?.items == RoomPreset.bathroom.checklist)
    }

    @Test func `confidence levels differ in shape, not only words`() {
        #expect(Set(Confidence.allCases.map(\.barsFilled)).count == Confidence.allCases.count)
        #expect(Set(Verdict.allCases.map(\.symbolName)).count == Verdict.allCases.count)
    }
}

@Suite("Checking an issue")
struct ResponsibilityCheckerTests {
    final class FakeServer: IssueServer {
        var reply: Result<IssueReply, APIError>
        private(set) var requests: [CreateIssueRequest] = []
        private(set) var rentalIDs: [String] = []

        init(reply: Result<IssueReply, APIError>) {
            self.reply = reply
        }

        func serverRentalID(for rental: Rental) async throws(APIError) -> String {
            guard let id = rental.serverID else { throw .offline }
            return id
        }

        func checkResponsibility(rentalServerID: String, request: CreateIssueRequest) async throws(APIError) -> IssueReply {
            rentalIDs.append(rentalServerID)
            requests.append(request)
            return try reply.get()
        }
    }

    final class FakeUploads: PhotoUploads {
        var isOnline = true
        var statuses: [UUID: SealStatus] = [:]
        private(set) var resumed = 0

        func resume() { resumed += 1 }
        func status(for itemID: UUID) -> SealStatus? { statuses[itemID] }
    }

    let container: ModelContainer
    let rental: Rental
    let result: ResponsibilityResult

    init() throws {
        container = try ModelContainer(for: Rental.self, Deadline.self, Walkthrough.self, RepairIssue.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        rental = Rental(name: "Home", serverID: "rental-1", phase: .living)
        container.mainContext.insert(rental)
        guard case .checked(let result, _) = try JSONDecoder().decode(IssueReply.self, from: checkedBody) else {
            throw APIError.malformedResponse
        }
        self.result = result
    }

    func checker() -> ResponsibilityChecker {
        ResponsibilityChecker(maxWait: .seconds(1), sleep: { _ in })
    }

    @Test func `an answer is saved on the rental, with the trimmed words and the locale sent`() async {
        let server = FakeServer(reply: .success(.checked(result, triage: TriageDecision(escalate: true, category: .lockout))))
        let checker = checker()
        let draft = IssueDraft(details: "  Heater is out.  ", room: "Bedroom", checklistItem: "Fixtures")

        await checker.check(draft, locale: "es", rental: rental, server: server, uploads: nil, context: container.mainContext)

        guard case .checked(let issue) = checker.phase else {
            Issue.record("expected an answer, got \(checker.phase)")
            return
        }
        #expect(server.rentalIDs == ["rental-1"])
        #expect(server.requests == [CreateIssueRequest(description: "Heater is out.", room: "Bedroom", checklistItem: "Fixtures", photoIds: [], locale: "es")])
        #expect(rental.issues.map(\.id) == [issue.id])
        #expect(issue.details == "Heater is out.")
        #expect(issue.result?.verdict == .likelyLandlord)
        // A lockout doesn't stop the check, but the app offers a person too.
        #expect(issue.needsHandoff)
    }

    @Test func `an emergency shows safety steps and saves nothing`() async {
        let server = FakeServer(reply: .success(.escalated(TriageDecision(escalate: true, category: .immediateDanger))))
        let checker = checker()
        await checker.check(IssueDraft(details: "I smell gas"), locale: "en", rental: rental, server: server, uploads: nil, context: container.mainContext)
        #expect(checker.phase == .escalated(.immediateDanger))
        #expect(rental.issues.isEmpty)
    }

    @Test func `no model on the server is a failure the tenant can retry`() async {
        let server = FakeServer(reply: .failure(.server(status: 503, code: "DEPENDENCY_UNAVAILABLE")))
        let checker = checker()
        await checker.check(IssueDraft(details: "Heater"), locale: "en", rental: rental, server: server, uploads: nil, context: container.mainContext)
        #expect(checker.failure == .unavailable)
        #expect(rental.issues.isEmpty)
        checker.dismissFailure()
        #expect(checker.phase == .idle)
    }

    @Test func `photos go once the server has them, and a refused one is left out`() async {
        let kept = UUID()
        let refused = UUID()
        let uploads = FakeUploads()
        uploads.statuses = [kept: .received, refused: .rejected]
        let server = FakeServer(reply: .success(.checked(result, triage: TriageDecision(escalate: false, category: .none))))
        let checker = checker()

        await checker.check(IssueDraft(details: "Leak", room: "Kitchen", photoIDs: [kept, refused]), locale: "en", rental: rental, server: server, uploads: uploads, context: container.mainContext)

        #expect(uploads.resumed == 1)
        #expect(server.requests.first?.photoIds == [kept.uuidString.lowercased()])
        #expect(checker.leftOutPhotos == 1)
        guard case .checked(let issue) = checker.phase else {
            Issue.record("expected an answer")
            return
        }
        #expect(issue.photoIDs == [kept])
    }

    @Test func `photos still waiting while offline stop the check before it starts`() async {
        let waiting = UUID()
        let uploads = FakeUploads()
        uploads.isOnline = false
        uploads.statuses = [waiting: .waiting]
        let server = FakeServer(reply: .success(.escalated(TriageDecision(escalate: false, category: .none))))
        let checker = checker()

        await checker.check(IssueDraft(details: "Leak", room: "Kitchen", photoIDs: [waiting]), locale: "en", rental: rental, server: server, uploads: uploads, context: container.mainContext)

        #expect(checker.failure == .offline)
        #expect(server.requests.isEmpty)
    }

    @Test func `photos that never finish uploading time out`() async {
        let waiting = UUID()
        let uploads = FakeUploads()
        uploads.statuses = [waiting: .waiting]
        let server = FakeServer(reply: .success(.escalated(TriageDecision(escalate: false, category: .none))))
        let checker = checker()

        await checker.check(IssueDraft(details: "Leak", room: "Kitchen", photoIDs: [waiting]), locale: "en", rental: rental, server: server, uploads: uploads, context: container.mainContext)

        #expect(checker.failure == .stillUploading)
        #expect(server.requests.isEmpty)
    }

    @Test func `an empty description never reaches the server`() async {
        let server = FakeServer(reply: .failure(.offline))
        let checker = checker()
        await checker.check(IssueDraft(details: "  "), locale: "en", rental: rental, server: server, uploads: nil, context: container.mainContext)
        #expect(checker.phase == .idle)
        #expect(server.requests.isEmpty)
    }
}
