import Foundation
import Network
import SwiftData
import SwiftUI

extension UploadQueue {
    /// The app's queue: the server in use, the tenant's token, and SwiftData for rentals. The
    /// client is made per call, so a server changed in the developer menu applies to the next upload.
    static func live(store: EvidenceStore, auth: AuthSession, configuration: AppConfiguration, container: ModelContainer) -> UploadQueue {
        let api = { APIClient(auth: auth, serverURL: configuration.serverURL) }
        return UploadQueue(
            store: store,
            uploader: LiveEvidenceUploader(api: api),
            rentals: SwiftDataRentalResolver(container: container, api: api),
            network: PathMonitor()
        )
    }
}

/// Calls the server through `APIClient`; PUTs photo bytes with no token, since the URL is the permission.
struct LiveEvidenceUploader: EvidenceUploading {
    let api: () -> APIClient
    var transport: HTTPTransport = HTTP.transport

    func requestUpload(rentalServerID: String, record: CaptureRecord) async throws(APIError) -> EvidenceItemReply {
        try await api().requestUpload(rentalServerID: rentalServerID, record: record)
    }

    func send(_ data: Data, to target: UploadTarget) async throws(APIError) {
        try await target.send(data, transport: transport)
    }

    func completeUpload(rentalServerID: String, itemID: UUID) async throws(APIError) -> EvidenceItemReply {
        try await api().completeUpload(rentalServerID: rentalServerID, itemID: itemID)
    }
}

/// Finds `Rental.serverID` in SwiftData. A rental the server has not heard of yet is created there
/// first (`POST /v1/rentals`), which needs a city or county; until then its photos wait.
struct SwiftDataRentalResolver: RentalResolving {
    let container: ModelContainer
    let api: () -> APIClient

    func serverRentalID(for rentalID: UUID) async throws(APIError) -> String? {
        let context = container.mainContext
        var descriptor = FetchDescriptor<Rental>(predicate: #Predicate { $0.id == rentalID })
        descriptor.fetchLimit = 1
        guard let rental = try? context.fetch(descriptor).first else { return nil }
        if let serverID = rental.serverID { return serverID }
        guard rental.city != nil || rental.county != nil else { return nil }

        let created: CreatedRental = try await api().post("v1/rentals", body: NewServerRental(rental))
        // Something else may have created it while this call waited.
        if let serverID = rental.serverID { return serverID }
        rental.serverID = created.id
        try? context.save()
        return created.id
    }

    /// `POST /v1/rentals`: where the rental is, never a street address (spec §6.3).
    private struct NewServerRental: Encodable {
        var jurisdiction: String
        var city: String?
        var county: String?
        var phase: String
        var occupancyDate: String?
        var tenancyEndDate: String?

        init(_ rental: Rental) {
            jurisdiction = rental.jurisdiction
            city = rental.city
            county = rental.county
            phase = rental.phase.rawValue
            occupancyDate = rental.occupancyDate?.isoString
            tenancyEndDate = rental.tenancyEndDate?.isoString
        }
    }

    private struct CreatedRental: Decodable {
        var id: String
    }
}

/// `NWPathMonitor` behind `NetworkMonitoring`. Online until the first path says otherwise, so a
/// launch never waits on it.
final class PathMonitor: NetworkMonitoring {
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()

    func start(onChange: @escaping @MainActor (Bool) -> Void) {
        monitor.pathUpdateHandler = { @Sendable [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
                onChange(online)
            }
        }
        monitor.start(queue: DispatchQueue(label: "org.fineprint.FinePrint.network"))
    }
}

extension CaptureContext {
    /// The rental the developer menu's camera files photos under: the first one the server knows or
    /// can create, else a sample rental in Richmond, made once, so test photos can upload.
    static func developer(in context: ModelContext) -> CaptureContext {
        let rentals = (try? context.fetch(FetchDescriptor<Rental>(sortBy: [SortDescriptor(\.createdAt)]))) ?? []
        let rental = rentals.first { $0.serverID != nil || $0.city != nil || $0.county != nil } ?? {
            let sample = Rental(id: developerSample.rentalID, name: String(localized: "Sample rental"), city: "Richmond")
            context.insert(sample)
            try? context.save()
            return sample
        }()
        return CaptureContext(rentalID: rental.id, room: developerSample.room, checklistItem: developerSample.checklistItem)
    }
}
