import Foundation
import Observation
import OSLog
import SwiftData

/// Seals a move-in walkthrough (spec §4.3 F2, §8.2): waits for its photos to reach the server, asks
/// the server to sign them, marks them sealed, and starts the landlord's report clock.
@Observable
final class MoveInSealer {
    enum Phase: Equatable {
        case idle
        /// Waiting for kept photos to finish uploading.
        case uploading
        case signing
        case sealed
        case failed(Failure)
    }

    enum Failure: Equatable {
        case offline
        /// Uploads did not finish in time. The photos are still queued.
        case stillUploading
        /// The server refused every photo, or none are on the device any more.
        case nothingToSeal
        case server(APIError)

        var message: LocalizedStringResource {
            switch self {
            case .offline:
                "You're offline. Your photos are saved on this device and upload when you're back online. Then seal the report."
            case .stillUploading:
                "Your photos are still uploading. Try again in a moment."
            case .nothingToSeal:
                "None of your photos reached the server. Retake them from the checklist, then seal the report."
            case .server(let error):
                error.message
            }
        }
    }

    private(set) var phase: Phase = .idle
    /// Photos the signed report does not hold: still uploading, or refused by the server.
    private(set) var leftOutCount = 0

    @ObservationIgnored private let sleep: (Duration) async throws -> Void
    @ObservationIgnored private let maxWait: Duration
    private static let pollInterval = Duration.milliseconds(250)
    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Seal")

    init(maxWait: Duration = .seconds(60), sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.maxWait = maxWait
        self.sleep = sleep
    }

    var isBusy: Bool { phase == .uploading || phase == .signing }

    var failure: Failure? {
        if case .failed(let failure) = phase { return failure }
        return nil
    }

    /// Seals `walkthrough`. On success the walkthrough, its photos, and the rental's deadlines are updated.
    func seal(_ walkthrough: Walkthrough, uploads: UploadQueue, server: any Sealing, deadlines: DeadlineStore) async {
        guard !isBusy, walkthrough.canSeal, let rental = walkthrough.rental else { return }
        phase = .uploading
        let photoIDs = walkthrough.photoIDs

        uploads.resume()
        if let failure = await waitForUploads(photoIDs, in: uploads) {
            phase = .failed(failure)
            return
        }

        let received = photoIDs.filter { id in
            let status = uploads.status(for: id)
            return status == .received || status == .sealed
        }
        guard !received.isEmpty, let rentalServerID = rental.serverID else {
            phase = .failed(.nothingToSeal)
            return
        }

        phase = .signing
        let receipt: SealReceipt
        do throws(APIError) {
            receipt = try await server.seal(rentalServerID: rentalServerID)
        } catch {
            Self.logger.error("Seal failed: \(String(describing: error), privacy: .public)")
            phase = .failed(error == .offline ? .offline : .server(error))
            return
        }

        uploads.markSealed(received, manifestID: receipt.manifest.manifestId)
        walkthrough.seal(manifestID: receipt.manifest.manifestId)
        deadlines.startMoveInReportClock(for: rental, occupancyFallback: walkthrough.startDay())
        walkthrough.persist()
        leftOutCount = photoIDs.count - received.count + receipt.pending
        phase = .sealed
    }

    func dismissFailure() {
        if case .failed = phase { phase = .idle }
    }

    /// Nil once every photo has been answered by the server, else why not.
    private func waitForUploads(_ ids: [UUID], in uploads: UploadQueue) async -> Failure? {
        let step = Self.pollInterval
        var waited = Duration.zero
        while true {
            let waiting = ids.contains { uploads.status(for: $0) == .waiting }
            if !waiting { return nil }
            if !uploads.isOnline { return .offline }
            if waited >= maxWait { return .stillUploading }
            do {
                try await sleep(step)
            } catch {
                return .stillUploading
            }
            waited += step
        }
    }
}
