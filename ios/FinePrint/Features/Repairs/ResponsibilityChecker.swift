import Foundation
import Observation
import OSLog
import SwiftData

/// What the tenant filled in on New Issue.
nonisolated struct IssueDraft: Equatable, Sendable {
    static let maxLength = 2_000
    /// The server takes up to 4 photos per issue.
    static let maxPhotos = 4

    var details = ""
    var room: String?
    var checklistItem: String?
    var photoIDs: [UUID] = []

    var trimmedDetails: String { details.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canCheck: Bool { !trimmedDetails.isEmpty && trimmedDetails.count <= Self.maxLength }
    var canAddPhoto: Bool { room != nil && photoIDs.count < Self.maxPhotos }
}

/// The server side of a check, so tests can stand in for it.
protocol IssueServer {
    func serverRentalID(for rental: Rental) async throws(APIError) -> String
    func checkResponsibility(rentalServerID: String, request: CreateIssueRequest) async throws(APIError) -> IssueReply
}

extension APIClient: IssueServer {
    func serverRentalID(for rental: Rental) async throws(APIError) -> String {
        try await RentalSync.upload(rental, with: self)
        guard let id = rental.serverID else { throw .malformedResponse }
        return id
    }
}

/// The part of the upload queue a check waits on.
protocol PhotoUploads: AnyObject {
    var isOnline: Bool { get }
    func resume()
    func status(for itemID: UUID) -> SealStatus?
}

extension UploadQueue: PhotoUploads {}

/// Runs "Who pays for this?" (spec §4.3 F4): waits for the issue's photos to reach the server, asks
/// the server, and saves the answer on the rental.
@Observable
final class ResponsibilityChecker {
    enum Phase: Equatable {
        case idle
        case uploadingPhotos
        /// The server is running triage, Gemma 26B, and 31B: about a minute.
        case checking
        case checked(RepairIssue)
        /// Triage found a safety emergency, so there is no answer, only what to do now. Nothing is saved.
        case escalated(TriageCategory)
        case failed(Failure)
    }

    enum Failure: Equatable {
        case offline
        /// Photos did not finish uploading in time. They are still queued.
        case stillUploading
        /// The server has no model configured, or every model failed.
        case unavailable
        case server(APIError)

        var message: LocalizedStringResource {
            switch self {
            case .offline:
                "You're offline. Your description and photos are still here. Check again when you're back online."
            case .stillUploading:
                "Your photos are still uploading. Try again in a moment."
            case .unavailable:
                "The responsibility check isn't available right now. Try again later."
            case .server(let error):
                error.message
            }
        }
    }

    private(set) var phase: Phase = .idle
    /// Photos left out of the check because the server refused them.
    private(set) var leftOutPhotos = 0

    @ObservationIgnored private let sleep: (Duration) async throws -> Void
    @ObservationIgnored private let maxWait: Duration
    private static let pollInterval = Duration.milliseconds(250)
    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Repairs")

    init(maxWait: Duration = .seconds(60), sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.maxWait = maxWait
        self.sleep = sleep
    }

    var isBusy: Bool { phase == .uploadingPhotos || phase == .checking }

    var failure: Failure? {
        if case .failed(let failure) = phase { return failure }
        return nil
    }

    func check(_ draft: IssueDraft, locale: String, rental: Rental, server: some IssueServer, uploads: (any PhotoUploads)?, context: ModelContext) async {
        guard !isBusy, draft.canCheck else { return }
        leftOutPhotos = 0

        var photoIDs: [UUID] = []
        if !draft.photoIDs.isEmpty, let uploads {
            phase = .uploadingPhotos
            uploads.resume()
            if let failure = await waitForUploads(draft.photoIDs, in: uploads) {
                phase = .failed(failure)
                return
            }
            photoIDs = draft.photoIDs.filter { id in
                let status = uploads.status(for: id)
                return status == .received || status == .sealed
            }
            leftOutPhotos = draft.photoIDs.count - photoIDs.count
        }

        phase = .checking
        let reply: IssueReply
        do throws(APIError) {
            let rentalServerID = try await server.serverRentalID(for: rental)
            let request = CreateIssueRequest(
                description: draft.trimmedDetails,
                room: draft.room,
                checklistItem: draft.checklistItem,
                photoIds: photoIDs.map { $0.uuidString.lowercased() },
                locale: locale
            )
            reply = try await server.checkResponsibility(rentalServerID: rentalServerID, request: request)
        } catch {
            Self.logger.error("Responsibility check failed: \(String(describing: error), privacy: .public)")
            phase = .failed(Self.failure(for: error))
            return
        }

        switch reply {
        case .escalated(let triage):
            phase = .escalated(triage.category)
        case .checked(let result, let triage):
            let issue = RepairIssue(
                details: draft.trimmedDetails,
                room: draft.room,
                checklistItem: draft.checklistItem,
                photoIDs: photoIDs,
                result: result,
                needsHandoff: triage.escalate
            )
            context.insert(issue)
            issue.rental = rental
            try? context.save()
            phase = .checked(issue)
        }
    }

    func dismissFailure() {
        if case .failed = phase { phase = .idle }
    }

    static func failure(for error: APIError) -> Failure {
        switch error {
        case .offline: .offline
        case .server(status: 503, code: _): .unavailable
        default: .server(error)
        }
    }

    /// Nil once every photo has been answered by the server, else why not.
    private func waitForUploads(_ ids: [UUID], in uploads: any PhotoUploads) async -> Failure? {
        var waited = Duration.zero
        while true {
            if !ids.contains(where: { uploads.status(for: $0) == .waiting }) { return nil }
            if !uploads.isOnline { return .offline }
            if waited >= maxWait { return .stillUploading }
            do {
                try await sleep(Self.pollInterval)
            } catch {
                return .stillUploading
            }
            waited += Self.pollInterval
        }
    }
}
