import Foundation
import OSLog
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
/// first through `RentalSync`, which needs a city or county; until then its photos wait.
struct SwiftDataRentalResolver: RentalResolving {
    let container: ModelContainer
    let api: () -> APIClient

    func serverRentalID(for rentalID: UUID) async throws(APIError) -> String? {
        let context = container.mainContext
        var descriptor = FetchDescriptor<Rental>(predicate: #Predicate { $0.id == rentalID })
        descriptor.fetchLimit = 1
        let rental: Rental?
        do {
            rental = try context.fetch(descriptor).first
        } catch {
            rentalsLogger.error("Couldn't read rental \(rentalID, privacy: .public): \(error.localizedDescription, privacy: .public)")
            return nil
        }
        guard let rental else { return nil }
        if let serverID = rental.serverID { return serverID }
        guard rental.hasPlace else { return nil }

        try await RentalSync.upload(rental, with: api())
        try? context.save()
        return rental.serverID
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

private let rentalsLogger = Logger(subsystem: "org.fineprint.FinePrint", category: "Uploads")

extension CaptureContext {
    /// The rental the developer menu's camera files photos under: the current one if the server knows
    /// it or can create it, else the first such rental, else a sample rental in Richmond, made once,
    /// so test photos can upload.
    static func developer(in context: ModelContext) -> CaptureContext {
        let rentals: [Rental]
        do {
            rentals = try context.fetch(FetchDescriptor<Rental>(sortBy: [SortDescriptor(\.createdAt)]))
        } catch {
            rentalsLogger.error("Couldn't read rentals: \(error.localizedDescription, privacy: .public)")
            rentals = []
        }
        defer { rentalsLogger.info("Developer camera: \(rentals.count) rentals") }
        let canUpload = { (rental: Rental) in rental.serverID != nil || rental.hasPlace }
        let current = Rental.current(in: rentals).flatMap { canUpload($0) ? $0 : nil }
        let rental = current ?? rentals.first(where: canUpload) ?? {
            let sample = Rental(id: developerSample.rentalID, name: String(localized: "Sample rental"), city: "Richmond")
            context.insert(sample)
            try? context.save()
            return sample
        }()
        return CaptureContext(rentalID: rental.id, room: developerSample.room, checklistItem: developerSample.checklistItem)
    }
}
