import Foundation
import Testing
@testable import FinePrint

@Suite("Onboarding")
struct OnboardingTests {
    @Test(arguments: [
        (OnboardingPhase.beforeSigning, RentalPhase.preSigning, AppTab.lease),
        (.justMovedIn, .moveIn, .evidence),
        (.livingThere, .living, .repairs),
        (.movingOut, .moveOut, .evidence),
    ])
    func `phase sets the rental phase and the first tab`(answer: OnboardingPhase, phase: RentalPhase, tab: AppTab) {
        #expect(answer.rentalPhase == phase)
        #expect(answer.firstTab == tab)
    }

    @Test func `a Virginia county becomes the rental's county`() throws {
        var draft = OnboardingDraft()
        draft.virginiaPlace = Locality(name: "Fairfax", kind: .county)
        draft.phase = .livingThere
        let rental = try #require(draft.makeRental())
        #expect(rental.jurisdiction == "VA")
        #expect(rental.county == "Fairfax County")
        #expect(rental.city == nil)
        #expect(rental.phase == .living)
        #expect(rental.occupancyDate == nil)
        #expect(rental.isInVirginia)
    }

    @Test func `an independent city becomes the rental's city`() throws {
        var draft = OnboardingDraft()
        draft.virginiaPlace = VirginiaLocalities.defaultCity
        draft.phase = .beforeSigning
        let rental = try #require(draft.makeRental())
        #expect(rental.city == "Richmond")
        #expect(rental.county == nil)
        #expect(rental.phase == .preSigning)
    }

    @Test func `just moved in sets the occupancy date to today`() throws {
        var draft = OnboardingDraft()
        draft.virginiaPlace = VirginiaLocalities.defaultCity
        draft.phase = .justMovedIn
        let today = CalendarDay(year: 2026, month: 10, day: 24)
        let rental = try #require(draft.makeRental(today: today))
        #expect(rental.phase == .moveIn)
        #expect(rental.occupancyDate == today)
    }

    @Test func `no rental until a place and a phase are chosen`() {
        var draft = OnboardingDraft()
        #expect(draft.makeRental() == nil)
        draft.phase = .livingThere
        #expect(!draft.canFinish)
        draft.virginiaPlace = VirginiaLocalities.defaultCity
        #expect(draft.canFinish)
    }

    @Test func `outside Virginia is detected and keeps the typed city`() throws {
        var draft = OnboardingDraft()
        #expect(!draft.isOutsideVirginia)
        draft.state = try #require(USState.all.first { $0.code == "MD" })
        #expect(draft.isOutsideVirginia)
        #expect(draft.place == nil)
        draft.otherCity = "  Baltimore "
        draft.phase = .livingThere
        let rental = try #require(draft.makeRental())
        #expect(rental.jurisdiction == "MD")
        #expect(rental.city == "Baltimore")
        #expect(!rental.isInVirginia)
    }

    @Test func `a Virginia pick is ignored once the state is not Virginia`() throws {
        var draft = OnboardingDraft()
        draft.virginiaPlace = VirginiaLocalities.defaultCity
        draft.state = try #require(USState.all.first { $0.code == "NC" })
        #expect(draft.place == nil)
    }

    @Test func `the bundled list has every Virginia county and independent city`() {
        #expect(VirginiaLocalities.counties.count == 95)
        #expect(VirginiaLocalities.cities.count == 38)
        #expect(Set(VirginiaLocalities.all.map(\.id)).count == 133)
        #expect(USState.all.count == 51)
    }

    @Test func `search finds both the city and the county of the same name`() {
        let names = VirginiaLocalities.matching("richmond").map(\.displayName)
        #expect(names.contains("Richmond"))
        #expect(names.contains("Richmond County"))
        #expect(VirginiaLocalities.matching("virginia beach").map(\.displayName) == ["Virginia Beach"])
        #expect(VirginiaLocalities.matching("").count == 133)
    }

    @Test func `the language defaults to the device language`() {
        #expect(AppLanguage.deviceDefault(preferred: ["es-MX", "en-US"]) == .spanish)
        #expect(AppLanguage.deviceDefault(preferred: ["fr-FR", "en-US"]) == .english)
        #expect(AppLanguage.deviceDefault(preferred: ["ja-JP"]) == .english)
        #expect(AppLanguage.deviceDefault(preferred: []) == .english)
    }

    @Test func `the language choice is stored`() throws {
        let defaults = try #require(UserDefaults(suiteName: "FinePrintTests.language"))
        defaults.removePersistentDomain(forName: "FinePrintTests.language")
        #expect(AppLanguage.stored(in: defaults) == nil)
        AppLanguage.spanish.store(in: defaults)
        #expect(AppLanguage.stored(in: defaults) == .spanish)
    }

    @Test func `skipping onboarding gives a Richmond rental that is living there`() {
        let rental = OnboardingDraft.skipped()
        #expect(rental.jurisdiction == "VA")
        #expect(rental.city == "Richmond")
        #expect(rental.phase == .living)
        #expect(rental.serverID == nil)
    }
}

@Suite("Rental sync")
struct RentalSyncTests {
    static let created = StubHTTP.Reply(status: 201, body: #"{"id":"rental-1","jurisdiction":"VA","city":"Richmond"}"#)

    func client(_ http: StubHTTP) -> APIClient {
        let auth = AuthSession(
            store: InMemoryCredentialStore(Fixture.credentials()),
            transport: http.transport,
            serverURL: { Fixture.server },
            allowsEmulator: true,
            now: { Fixture.now }
        )
        return APIClient(auth: auth, serverURL: Fixture.server, transport: http.transport)
    }

    @Test func `the request carries only the server's fields`() throws {
        let rental = OnboardingDraft.skipped()
        rental.occupancyDate = CalendarDay(year: 2026, month: 10, day: 24)
        let body = try JSONEncoder().encode(CreateRentalRequest(rental))
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: String])
        #expect(json == ["jurisdiction": "VA", "city": "Richmond", "phase": "living", "occupancyDate": "2026-10-24"])
    }

    @Test func `creating a rental stores the server id`() async throws {
        let http = StubHTTP(["rentals": [Self.created]])
        let rental = OnboardingDraft.skipped()
        try await RentalSync.upload(rental, with: client(http))
        #expect(rental.serverID == "rental-1")
        let request = try #require(http.requests(to: "rentals").first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer id-1")
    }

    @Test func `offline leaves the rental local and a retry creates it once`() async throws {
        let http = StubHTTP([:])
        let rental = OnboardingDraft.skipped()
        let api = client(http)

        #expect(await RentalSync.uploadPending([rental], with: api) == 0)
        #expect(rental.serverID == nil)

        http.set("rentals", [Self.created])
        #expect(await RentalSync.uploadPending([rental], with: api) == 1)
        #expect(rental.serverID == "rental-1")

        #expect(await RentalSync.uploadPending([rental], with: api) == 0)
        #expect(http.requests(to: "rentals").count == 2)
    }

    @Test func `a server error leaves the rental without an id`() async {
        let http = StubHTTP(["rentals": [.init(status: 503, body: #"{"error":{"code":"DEPENDENCY_UNAVAILABLE","message":"x"}}"#)]])
        let rental = OnboardingDraft.skipped()
        await #expect(throws: APIError.server(status: 503, code: "DEPENDENCY_UNAVAILABLE")) {
            try await RentalSync.upload(rental, with: client(http))
        }
        #expect(rental.serverID == nil)
    }
}
