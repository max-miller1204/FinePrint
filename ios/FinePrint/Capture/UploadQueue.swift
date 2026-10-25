import Foundation
import Observation
import OSLog

/// How far a photo is on its way to a sealed report (spec §4.3 F2, §8.2).
nonisolated enum SealStatus: Hashable, Sendable {
    /// On this device only: waiting for a connection, the rental, or its turn.
    case waiting
    /// The server has the photo and checked its size and SHA-256. It is not in a signed manifest
    /// yet: sealing (#24) does that.
    case received
    /// In a signed manifest: the tenant sealed the move-in report (#25).
    case sealed
    /// The server refused the photo, for example because the stored bytes did not match the hash.
    case rejected
}

/// One kept capture the queue owns. Saved as `upload.json` next to the photo, with complete file
/// protection like the photo itself (spec §6.3).
nonisolated struct UploadItem: Codable, Equatable, Sendable {
    enum State: Codable, Equatable, Sendable {
        case waiting
        /// `at` is the server's `receivedAtServer`.
        case received(at: String)
        case rejected(Rejection)
        /// In the signed manifest `manifestID`.
        case sealed(manifestID: String)
    }

    enum Rejection: String, Codable, Sendable {
        /// The stored photo did not match the capture record (422 `HASH_MISMATCH`, or Storage
        /// refusing the bytes for the signed hash).
        case hashMismatch
        /// The server will never take it: no such rental, another user's, or another photo
        /// already uses the item ID.
        case refused
        /// The original is gone from the device.
        case missingFile
    }

    var record: CaptureRecord
    /// The photo's file name inside the capture's folder. Folders are found from the record, since the
    /// app container moves between installs.
    var originalFileName: String
    var state: State
    var enqueuedAt: Date
    var attempts = 0
    /// Nil means due now.
    var nextAttemptAt: Date?

    var sealStatus: SealStatus {
        switch state {
        case .waiting: .waiting
        case .received: .received
        case .rejected: .rejected
        case .sealed: .sealed
        }
    }
}

/// The server and Storage calls the queue makes. `LiveEvidenceUploader` is the real one.
protocol EvidenceUploading {
    func requestUpload(rentalServerID: String, record: CaptureRecord) async throws(APIError) -> EvidenceItemReply
    func send(_ data: Data, to target: UploadTarget) async throws(APIError)
    func completeUpload(rentalServerID: String, itemID: UUID) async throws(APIError) -> EvidenceItemReply
}

/// Maps the device's rental to the server's `rentals/{id}`.
protocol RentalResolving {
    /// Nil while the rental cannot be on the server yet; its photos wait.
    func serverRentalID(for rentalID: UUID) async throws(APIError) -> String?
}

/// Whether the device has a network path. `PathMonitor` wraps `NWPathMonitor`.
protocol NetworkMonitoring: AnyObject {
    var isOnline: Bool { get }
    /// Calls `onChange` on the main actor whenever the answer changes.
    func start(onChange: @escaping @MainActor (Bool) -> Void)
}

/// Uploads kept photos in the order they were taken: asks the server for a signed URL, PUTs the
/// original straight to Cloud Storage, then asks the server to check it (spec §5.3, §8.2). Works
/// offline: items wait on disk and go out on reconnect, on return to the foreground, or when a
/// backoff timer fires.
@Observable
final class UploadQueue {
    private(set) var items: [UUID: UploadItem] = [:]

    #if DEBUG
    /// Developer menu switch: behaves as if the device were offline, since the simulator has no
    /// airplane mode. Turning it off counts as a reconnect.
    var simulatesOffline = false {
        didSet { if oldValue && !simulatesOffline { resume() } }
    }
    #endif

    @ObservationIgnored private let store: EvidenceStore
    @ObservationIgnored private let uploader: any EvidenceUploading
    @ObservationIgnored private let rentals: any RentalResolving
    @ObservationIgnored private let network: any NetworkMonitoring
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let sleep: (Duration) async throws -> Void
    @ObservationIgnored private var isStarted = false
    @ObservationIgnored private var isDraining = false
    @ObservationIgnored private var drainsAgain = false
    @ObservationIgnored private var wake: Task<Void, Never>?
    /// The pass that `resume()` started, so tests can wait for it.
    @ObservationIgnored private(set) var drainTask: Task<Void, Never>?

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Uploads")
    /// Five seconds after the first failure, doubling to at most five minutes.
    static func backoff(afterAttempts attempts: Int) -> TimeInterval {
        min(300, 5 * pow(2, Double(max(0, attempts - 1))))
    }

    init(
        store: EvidenceStore,
        uploader: any EvidenceUploading,
        rentals: any RentalResolving,
        network: any NetworkMonitoring,
        now: @escaping () -> Date = { .now },
        sleep: @escaping (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.store = store
        self.uploader = uploader
        self.rentals = rentals
        self.network = network
        self.now = now
        self.sleep = sleep
        items = Dictionary(store.loadUploads().map { ($0.record.itemID, $0) }, uniquingKeysWith: { first, _ in first })
    }

    func status(for itemID: UUID) -> SealStatus? {
        items[itemID]?.sealStatus
    }

    var waitingCount: Int {
        items.values.count { $0.state == .waiting }
    }

    var isOnline: Bool {
        #if DEBUG
        if simulatesOffline { return false }
        #endif
        return network.isOnline
    }

    /// Call once at launch: watches the network and uploads whatever an earlier launch left waiting.
    func start() {
        guard !isStarted else { return }
        isStarted = true
        network.start { [weak self] online in
            if online { self?.resume() }
        }
        resume()
    }

    /// The server signed a manifest that holds these photos. Only photos the server received
    /// change; a photo still waiting is not in the manifest.
    func markSealed(_ itemIDs: some Sequence<UUID>, manifestID: String) {
        for id in itemIDs {
            guard var item = items[id], case .received = item.state else { continue }
            item.state = .sealed(manifestID: manifestID)
            items[id] = item
            persist(item)
        }
    }

    /// The tenant kept the photo. From here the queue owns it: it is saved, then uploaded when it can be.
    func enqueue(_ photo: CapturedPhoto) {
        enqueue(photo.record, original: photo.files.original)
    }

    func enqueue(_ record: CaptureRecord, original: URL) {
        guard items[record.itemID] == nil else { return }
        let item = UploadItem(record: record, originalFileName: original.lastPathComponent, state: .waiting, enqueuedAt: now())
        items[record.itemID] = item
        persist(item)
        Self.logger.info("Queued \(record.itemID, privacy: .public)")
        if isStarted { resume() }
    }

    /// Forgets every item and stops retrying. "Delete everything" calls it before the photos' files
    /// are removed, so a pass in flight finds nothing to save.
    func removeAll() {
        wake?.cancel()
        wake = nil
        items = [:]
    }

    /// Reconnect or return to the foreground: whatever is waiting is due now, backoff or not.
    func resume() {
        for (id, item) in items where item.state == .waiting && item.nextAttemptAt != nil {
            items[id]?.nextAttemptAt = nil
        }
        drainTask = Task { await drain() }
    }

    /// One pass over every item that is due, oldest first. A call during a pass makes the pass run
    /// again rather than start a second one.
    func drain() async {
        guard !isDraining else {
            drainsAgain = true
            return
        }
        isDraining = true
        repeat {
            drainsAgain = false
            for id in dueItems() {
                guard isOnline else {
                    Self.logger.info("Offline: \(self.dueItems().count) waiting")
                    break
                }
                if await upload(id) == .offline { break }
            }
        } while drainsAgain
        isDraining = false
        scheduleWake()
    }

    private func dueItems() -> [UUID] {
        let now = now()
        return items.values
            .filter { $0.state == .waiting && ($0.nextAttemptAt ?? .distantPast) <= now }
            // Saved times have whole seconds, so uptime orders photos kept within one second.
            .sorted { ($0.enqueuedAt, $0.record.deviceUptimeMs) < ($1.enqueuedAt, $1.record.deviceUptimeMs) }
            .map(\.record.itemID)
    }

    /// The earliest backoff, if any. Only after `start()`, so tests drive passes themselves.
    private func scheduleWake() {
        wake?.cancel()
        wake = nil
        guard isStarted, let next = items.values.compactMap({ $0.state == .waiting ? $0.nextAttemptAt : nil }).min() else { return }
        let delay = max(0, next.timeIntervalSince(now()))
        wake = Task { [weak self, sleep] in
            do {
                try await sleep(.milliseconds(Int(delay * 1000)))
            } catch {
                return
            }
            await self?.drain()
        }
    }

    nonisolated enum Outcome: Equatable, Sendable {
        case received(at: String)
        case rejected(UploadItem.Rejection)
        case retry
        /// Retry, and stop this pass: nothing else will get through either.
        case offline
    }

    @discardableResult
    private func upload(_ id: UUID) async -> Outcome {
        guard let item = items[id], item.state == .waiting else { return .retry }
        let outcome = await attempt(item)
        guard var updated = items[id] else { return outcome }
        switch outcome {
        case .received(let at):
            updated.state = .received(at: at)
            updated.nextAttemptAt = nil
            Self.logger.info("Received \(id, privacy: .public)")
        case .rejected(let reason):
            updated.state = .rejected(reason)
            updated.nextAttemptAt = nil
            Self.logger.error("Rejected \(id, privacy: .public): \(reason.rawValue, privacy: .public)")
        case .retry, .offline:
            updated.attempts += 1
            updated.nextAttemptAt = now().addingTimeInterval(Self.backoff(afterAttempts: updated.attempts))
            Self.logger.info("Will retry \(id, privacy: .public) (\(String(describing: outcome), privacy: .public), attempt \(updated.attempts))")
        }
        items[id] = updated
        persist(updated)
        return outcome
    }

    private func attempt(_ item: UploadItem) async -> Outcome {
        let rentalServerID: String
        let target: UploadTarget
        do throws(APIError) {
            guard let id = try await rentals.serverRentalID(for: item.record.rentalID) else {
                Self.logger.info("No server rental yet for \(item.record.rentalID, privacy: .public)")
                return .retry
            }
            rentalServerID = id
            let reply = try await uploader.requestUpload(rentalServerID: id, record: item.record)
            if reply.status == .received { return .received(at: reply.receivedAtServer ?? "") }
            guard let upload = reply.upload else { return .retry }
            target = upload
        } catch {
            return Self.outcome(for: error)
        }

        let original = store.original(of: item)
        guard FileManager.default.fileExists(atPath: original.path(percentEncoded: false)) else { return .rejected(.missingFile) }
        // Unreadable while the device is locked (complete protection): try again later.
        guard let data = try? Data(contentsOf: original) else { return .retry }

        do throws(APIError) {
            try await uploader.send(data, to: target)
        } catch {
            switch error {
            // Storage checks the body against the signed `x-goog-content-sha256`.
            case .server(status: 400, code: _): return .rejected(.hashMismatch)
            // An expired or refused URL: the next attempt asks for a fresh one.
            default: return error == .offline ? .offline : .retry
            }
        }

        do throws(APIError) {
            let reply = try await uploader.completeUpload(rentalServerID: rentalServerID, itemID: item.record.itemID)
            return reply.status == .received ? .received(at: reply.receivedAtServer ?? "") : .retry
        } catch {
            // 409 here means the server found no upload yet, which a retry fixes.
            if case .server(status: 409, code: _) = error { return .retry }
            return Self.outcome(for: error)
        }
    }

    static func outcome(for error: APIError) -> Outcome {
        switch error {
        case .offline: .offline
        case .server(status: 422, code: _): .rejected(.hashMismatch)
        case .server(status: 400, code: _), .server(status: 403, code: _), .server(status: 404, code: _), .server(status: 409, code: _):
            .rejected(.refused)
        case .server, .auth, .malformedResponse: .retry
        }
    }

    private func persist(_ item: UploadItem) {
        do {
            try store.saveUpload(item)
        } catch {
            // Kept in memory: this launch still uploads it.
            Self.logger.error("Couldn't save upload state for \(item.record.itemID, privacy: .public)")
        }
    }
}

extension EvidenceStore {
    static let uploadFileName = "upload.json"

    func original(of item: UploadItem) -> URL {
        directory(for: item.record).appending(path: item.originalFileName)
    }

    func saveUpload(_ item: UploadItem) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let url = directory(for: item.record).appending(path: Self.uploadFileName)
        try encoder.encode(item).write(to: url, options: [.atomic, .completeFileProtection])
    }

    /// Every capture the queue owns, from `<root>/<rentalId>/<itemId>/upload.json`. A file that
    /// cannot be read now (the device is locked) is skipped, and a later launch picks it up.
    func loadUploads() -> [UploadItem] {
        let files = FileManager.default
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let rentals = (try? files.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return rentals.flatMap { rental -> [UploadItem] in
            let captures = (try? files.contentsOfDirectory(at: rental, includingPropertiesForKeys: nil)) ?? []
            return captures.compactMap { capture -> UploadItem? in
                guard let data = try? Data(contentsOf: capture.appending(path: Self.uploadFileName)) else { return nil }
                return try? decoder.decode(UploadItem.self, from: data)
            }
        }
    }
}
