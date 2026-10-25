import Foundation

/// The body of `POST /v1/rentals` (spec §13). Property names are the server's. Nil fields are left out.
nonisolated struct CreateRentalRequest: Encodable, Equatable, Sendable {
    var jurisdiction: String
    var city: String?
    var county: String?
    var phase: RentalPhase
    var occupancyDate: String?
    var tenancyEndDate: String?
}

/// The part of the server's rental that the app reads back.
nonisolated struct CreatedRental: Decodable, Equatable, Sendable {
    var id: String
}

extension CreateRentalRequest {
    init(_ rental: Rental) {
        self.init(
            jurisdiction: rental.jurisdiction,
            city: rental.city,
            county: rental.county,
            phase: rental.phase,
            occupancyDate: rental.occupancyDate?.isoString,
            tenancyEndDate: rental.tenancyEndDate?.isoString
        )
    }
}

extension APIClient {
    func createRental(_ request: CreateRentalRequest) async throws(APIError) -> CreatedRental {
        try await post("v1/rentals", body: request)
    }
}

/// Creates local rentals on the server. Onboarding saves the rental on the device first so it always
/// finishes, even offline; whatever has no `serverID` yet is retried at the next foreground or sign-in.
/// The one place rentals are created on the server: the launch sync and the upload queue both call
/// `upload`, and a create already in flight for a rental is shared, so neither makes a second one.
enum RentalSync {
    private static var inFlight: [UUID: Task<String, any Error>] = [:]

    /// Creates `rental` on the server and records its `serverID`.
    static func upload(_ rental: Rental, with client: APIClient) async throws(APIError) {
        guard rental.serverID == nil else { return }
        let id = rental.id
        let create = inFlight[id] ?? Task { try await client.createRental(CreateRentalRequest(rental)).id }
        inFlight[id] = create
        defer { inFlight[id] = nil }
        do {
            let serverID = try await create.value
            if rental.serverID == nil { rental.serverID = serverID }
        } catch let error as APIError {
            throw error
        } catch {
            throw .offline
        }
    }

    /// Uploads each rental that has no `serverID`, oldest first, and stops at the first failure.
    /// Returns how many were created.
    @discardableResult
    static func uploadPending(_ rentals: [Rental], with client: APIClient) async -> Int {
        var created = 0
        for rental in rentals where rental.serverID == nil && rental.hasPlace {
            do {
                try await upload(rental, with: client)
                created += 1
            } catch {
                // A 4xx is about this rental alone, so it must not hold back the others. Offline,
                // signed out, or a server error would fail the rest the same way: stop until later.
                if case .server(let status, _) = error, (400..<500).contains(status), status != 401 { continue }
                break
            }
        }
        return created
    }
}
