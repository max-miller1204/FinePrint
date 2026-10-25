import Foundation
import Observation
import OSLog

/// What "Delete everything" removed, as the tenant sees it afterwards (spec §9.2). Held in memory
/// only: the point is that FinePrint keeps nothing, so the receipt is not saved either.
nonisolated struct DeletionReceipt: Equatable, Sendable {
    var deletedAt: Date
    var serverRentals: Int
    var serverPhotos: Int
    var deviceRentals: Int
    var devicePhotos: Int
}

/// What was on the device when it was erased.
nonisolated struct LocalErasure: Equatable, Sendable {
    var rentals: Int
    var photos: Int
}

/// Runs "Delete everything": the server first, then this device, then the receipt. The device is
/// only touched once the server has answered, so a failed or offline attempt loses nothing and the
/// tenant can try again.
@Observable
final class DataDeletion {
    enum Phase: Equatable {
        case idle
        case deleting
        case failed(APIError)
    }

    private(set) var phase = Phase.idle
    /// Set after a delete; `RootView` shows it in place of everything else until the tenant dismisses it.
    private(set) var receipt: DeletionReceipt?
    private var pendingErase: (() -> Void)?

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Deletion")

    var isDeleting: Bool { phase == .deleting }

    /// Deletes the account on the server. `summarize` counts what is on this device, and `erase` clears it,
    /// but only once the receipt is on screen (`receiptDidAppear`): the tabs read the rentals, so erasing
    /// them while the tabs are still showing crashes SwiftUI.
    func deleteEverything(client: APIClient, now: Date = .now, summarize: () -> LocalErasure, erase: @escaping () -> Void) async {
        guard !isDeleting else { return }
        phase = .deleting
        let reply: AccountDeletionReply
        do throws(APIError) {
            reply = try await client.deleteEverything()
        } catch {
            Self.logger.error("Delete everything failed on the server")
            phase = .failed(error)
            return
        }
        let local = summarize()
        pendingErase = erase
        receipt = DeletionReceipt(
            deletedAt: reply.date(fallback: now),
            serverRentals: reply.rentals,
            serverPhotos: reply.evidenceItems,
            deviceRentals: local.rentals,
            devicePhotos: local.photos
        )
        phase = .idle
    }

    /// The receipt replaced the tabs: now the device can be cleared.
    func receiptDidAppear() {
        pendingErase?()
        pendingErase = nil
    }

    func dismissReceipt() {
        receiptDidAppear()
        receipt = nil
    }
}

/// Clears everything FinePrint keeps on this device: rentals and deadlines (and their reminders), photos
/// and upload state, the saved settings, and the sign-in. The developer menu and server address stay: they
/// describe the app, not the tenant.
@discardableResult
func eraseLocalData(
    deadlines: DeadlineStore,
    uploads: UploadQueue?,
    evidence: EvidenceStore,
    settings: UserSettings,
    auth: AuthSession
) -> LocalErasure {
    let photos = evidence.captureCount()
    // Stop the queue before its files go, so no pass writes into a folder that is being removed.
    uploads?.removeAll()
    try? evidence.eraseAll()
    let rentals = deadlines.eraseAll()
    settings.reset()
    auth.forgetAccount()
    return LocalErasure(rentals: rentals, photos: photos)
}

/// What is on the device now, for the receipt, before `eraseLocalData` clears it.
func summarizeLocalData(deadlines: DeadlineStore, evidence: EvidenceStore) -> LocalErasure {
    LocalErasure(rentals: deadlines.rentals.count, photos: evidence.captureCount())
}
