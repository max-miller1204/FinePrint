import Foundation
import Observation
import OSLog
import SwiftUI

/// Where the check against Virginia law is for the current rental's reviewed lease.
nonisolated enum LeaseAnalysisPhase: Equatable, Sendable {
    /// Nothing sent yet.
    case notStarted
    /// Sending the redacted text.
    case sending
    /// The server is checking it. `stage` is the server's step code (`S1` to `S9`).
    case running(stage: String?, progress: Double)
    case finished(LeaseOutcome, message: String?)
    case failed(LeaseAnalysisFailure)

    var isActive: Bool {
        switch self {
        case .sending, .running: true
        default: false
        }
    }
}

nonisolated enum LeaseAnalysisFailure: Equatable, Sendable {
    case offline
    case signIn
    /// The rental could not be created on the server.
    case rentalNotOnServer
    case unsupportedJurisdiction
    /// No model answered, or none is configured.
    case unavailable
    /// Another stream is already checking this lease.
    case busy
    case other

    init(_ error: APIError) {
        self = switch error {
        case .offline: .offline
        case .auth: .signIn
        case .server(status: _, code: "UNSUPPORTED_JURISDICTION"): .unsupportedJurisdiction
        case .server(status: _, code: "DEPENDENCY_UNAVAILABLE"), .server(status: _, code: "RATE_LIMITED"): .unavailable
        case .server(status: 409, code: _): .busy
        case .server, .malformedResponse: .other
        }
    }

    init(streamCode code: String) {
        self = switch code {
        case "DEPENDENCY_UNAVAILABLE", "RATE_LIMITED": .unavailable
        case "UNSUPPORTED_JURISDICTION": .unsupportedJurisdiction
        default: .other
        }
    }

    var message: LocalizedStringResource {
        switch self {
        case .offline: "Can't connect. Check your connection and try again."
        case .signIn: "FinePrint couldn't sign in to the server. Try again in a moment."
        case .rentalNotOnServer: "FinePrint couldn't set up this rental on the server. Check your connection and try again."
        case .unsupportedJurisdiction: "FinePrint's legal checks only cover Virginia. Your lease was not checked."
        case .unavailable: "The checker is busy right now. Try again in a few minutes."
        case .busy: "This lease is already being checked. Try again in a minute."
        case .other: "Something went wrong while checking your lease. Try again."
        }
    }
}

/// The server's steps (spec §7.3), in the tenant's language. The server's own labels are English.
nonisolated enum LeaseStageLabel {
    static func text(for stage: String?) -> LocalizedStringResource {
        switch stage {
        case "S1": "Checking for urgent problems"
        case "S2": "Reading your lease"
        case "S3": "Checking quotes against your lease"
        case "S4": "Checking amounts and notice periods"
        case "S5": "Comparing clauses with Virginia law"
        case "S6": "Checking every citation"
        case "S7": "Getting a second opinion on legal findings"
        case "S8": "Writing it in plain language"
        case "S9": "Translating"
        default: "Connecting to the checker"
        }
    }
}

/// Holds VoiceOver announcements so at most one goes out every `interval` (spec §10.1). Progress
/// is replaced by newer progress; anything important waits its turn.
nonisolated struct AnnouncementQueue: Sendable {
    enum Kind: Sendable {
        /// A stage change: only the latest matters.
        case progress
        /// A likely-unenforceable finding, or the end of the check.
        case important
    }

    let interval: Duration
    private(set) var lastPosted: ContinuousClock.Instant?
    private var queue: [(text: String, kind: Kind)] = []

    init(interval: Duration = .seconds(2)) {
        self.interval = interval
    }

    var isEmpty: Bool { queue.isEmpty }

    /// When the next queued announcement may go out.
    var nextAllowed: ContinuousClock.Instant? {
        guard !queue.isEmpty else { return nil }
        return lastPosted.map { $0 + interval }
    }

    /// Queues `text`, and returns what to post now, if anything may go out.
    mutating func submit(_ text: String, kind: Kind, at now: ContinuousClock.Instant) -> String? {
        if kind == .progress { queue.removeAll { $0.kind == .progress } }
        queue.append((text, kind))
        return next(at: now)
    }

    /// The next announcement, once `interval` has passed since the last.
    mutating func next(at now: ContinuousClock.Instant) -> String? {
        guard !queue.isEmpty else { return nil }
        if let lastPosted, now < lastPosted + interval { return nil }
        lastPosted = now
        return queue.removeFirst().text
    }
}

/// The check against Virginia law for the current rental's lease (spec §4.3 F1, §7.3): sends the
/// reviewed, redacted text, streams the findings, and keeps only IDs on the device.
@Observable
final class LeaseAnalysisModel {
    private(set) var phase: LeaseAnalysisPhase = .notStarted
    private(set) var keyTerms: [LeaseKeyTerm] = []
    /// Shown so far, most serious first.
    private(set) var findings: [LeaseFinding] = []
    /// The server is waiting on a rate limit or a busy model; the check goes on.
    private(set) var isWaiting = false
    /// The text that was sent, which the quotes' offsets point into.
    private(set) var sentText: String?
    /// Bumped for each likely-unenforceable finding, for the warning haptic.
    private(set) var unenforceableCount = 0
    /// Set by the view from the environment: findings appear at once, without a stagger.
    var reduceMotion = false
    /// The language findings are shown and announced in ("en", "es"). Set by the view.
    var language = AppLanguage.english.rawValue
    #if DEBUG
    /// `-FinePrintStubFindings`: plays `LeaseAnalysisStub` instead of calling the server.
    @ObservationIgnored var stubFindingCount: Int?
    #endif

    @ObservationIgnored private var scan: LeaseScan?
    /// A live run sends stages first; a replay of a finished check sends none. Only a live run
    /// buzzes and announces each likely-unenforceable finding: a replay's findings are not new.
    @ObservationIgnored private var isLive = false
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    @ObservationIgnored private var pending: [LeaseFinding] = []
    @ObservationIgnored private var revealTask: Task<Void, Never>?
    @ObservationIgnored private var announcements = AnnouncementQueue()
    @ObservationIgnored private var announceTask: Task<Void, Never>?
    @ObservationIgnored var announce: (String) -> Void = { AccessibilityNotification.Announcement($0).post() }

    /// The pause between findings that arrive together (spec §11).
    static let stagger: Duration = .milliseconds(40)
    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "LeaseAnalysis")

    /// The finding with this ID, if it has been shown.
    func finding(id: String) -> LeaseFinding? {
        findings.first { $0.id == id }
    }

    /// Shows what the server has for `scan`: replays a sent lease, or waits for the tenant to send it.
    func load(scan: LeaseScan?, store: LeaseStore, client: APIClient) async {
        guard scan != self.scan else { return }
        reset()
        self.scan = scan
        guard let scan, scan.isReviewed else { return }
        let record: LeaseAnalysisRecord?
        do {
            record = try await store.loadAnalysis(rentalID: scan.rentalID)
        } catch {
            Self.logger.error("Analysis record failed to load: \(error.localizedDescription, privacy: .public)")
            record = nil
        }
        guard self.scan == scan, let record, record.matches(scan) else { return }
        sentText = await LeaseUpload.body(for: scan).text
        guard self.scan == scan else { return }
        stream(record, client: client)
    }

    /// Sends the reviewed lease and starts the check.
    func analyze(rentals: [Rental], settings: UserSettings, store: LeaseStore, client: APIClient) {
        guard let scan, !phase.isActive else { return }
        reset(keepingScan: true)
        phase = .sending
        post(String(localized: "Sending your lease."), kind: .progress)
        #if DEBUG
        if let count = stubFindingCount {
            playStub(count: count, scan: scan)
            return
        }
        #endif
        streamTask = Task {
            if let rental = Rental.current(in: rentals), rental.id == scan.rentalID, rental.serverID == nil {
                do {
                    try await RentalSync.upload(rental, with: client)
                } catch {
                    fail(.rentalNotOnServer, for: scan)
                    return
                }
            }
            let upload: LeaseUpload
            do {
                upload = try await LeaseUpload.make(scan: scan, rentals: rentals, language: settings.language, readingLevel: settings.readingLevel)
            } catch LeaseUpload.Unavailable.rentalNotOnServer {
                fail(.rentalNotOnServer, for: scan)
                return
            } catch {
                fail(.other, for: scan)
                return
            }
            let created: CreatedLease
            do {
                created = try await client.createLease(upload)
            } catch let error as APIError {
                fail(LeaseAnalysisFailure(error), for: scan)
                return
            } catch {
                fail(.other, for: scan)
                return
            }
            guard self.scan == scan, let reviewedAt = scan.reviewedAt else { return }
            let record = LeaseAnalysisRecord(rentalID: scan.rentalID, reviewedAt: reviewedAt, rentalServerID: upload.rentalServerID, leaseID: created.leaseId)
            do {
                try await store.saveAnalysis(record)
            } catch {
                // The check still runs; it just can't be replayed after the app restarts.
                Self.logger.error("Analysis record failed to save: \(error.localizedDescription, privacy: .public)")
            }
            sentText = upload.body.text
            // This task hands over to the stream's.
            streamTask = nil
            stream(record, client: client)
        }
    }

    /// Opens the stream again after a failure: the server replays a finished check or runs it.
    func retry(rentals: [Rental], settings: UserSettings, store: LeaseStore, client: APIClient) {
        guard let scan else { return }
        Task {
            if let record = try? await store.loadAnalysis(rentalID: scan.rentalID), record.matches(scan), self.scan == scan {
                reset(keepingScan: true)
                sentText = await LeaseUpload.body(for: scan).text
                stream(record, client: client)
            } else {
                analyze(rentals: rentals, settings: settings, store: store, client: client)
            }
        }
    }

    /// Forgets the sent lease, after a new review or when the lease is removed.
    func forget(store: LeaseStore, rentalID: UUID) async {
        reset()
        scan = nil
        try? await store.deleteAnalysis(rentalID: rentalID)
    }

    #if DEBUG
    private func playStub(count: Int, scan: LeaseScan) {
        streamTask = Task {
            let text = await LeaseUpload.body(for: scan).text
            guard self.scan == scan else { return }
            sentText = text
            for event in LeaseAnalysisStub.events(for: text, count: count) {
                try? await Task.sleep(for: .milliseconds(150))
                guard !Task.isCancelled, self.scan == scan else { return }
                _ = handle(event)
            }
        }
    }
    #endif

    // MARK: Streaming

    private func stream(_ record: LeaseAnalysisRecord, client: APIClient) {
        guard let scan else { return }
        phase = .running(stage: nil, progress: 0)
        streamTask?.cancel()
        streamTask = Task {
            var ended = false
            do {
                for try await event in client.leaseEvents(rentalServerID: record.rentalServerID, leaseID: record.leaseID) {
                    guard self.scan == scan else { return }
                    ended = handle(event) || ended
                }
                guard !Task.isCancelled, self.scan == scan else { return }
                // A stream that closed without `done` or `error` lost its connection.
                if !ended { fail(.offline, for: scan) }
            } catch let error as APIError {
                if !Task.isCancelled { fail(LeaseAnalysisFailure(error), for: scan) }
            } catch {
                if !Task.isCancelled { fail(.other, for: scan) }
            }
        }
    }

    /// Applies one event. Returns true when it ends the check.
    private func handle(_ event: LeaseEvent) -> Bool {
        switch event {
        case .stage(let stage):
            isLive = true
            isWaiting = false
            phase = .running(stage: stage.stage, progress: min(max(stage.progress, 0), 1))
            post(String(localized: LeaseStageLabel.text(for: stage.stage)), kind: .progress)
        case .keyTerms(let terms):
            keyTerms = terms.sorted { $0.displayOrder < $1.displayOrder }
        case .finding(let finding):
            isWaiting = false
            guard !findings.contains(where: { $0.id == finding.id }), !pending.contains(where: { $0.id == finding.id }) else { break }
            pending.append(finding)
            if finding.severity == .unenforceable, isLive {
                unenforceableCount += 1
                let title = finding.text(in: language).title
                post(String(localized: "Likely unenforceable: \(title)"), kind: .important)
            }
            revealPending()
        case .waiting:
            isWaiting = true
        case .done(let done):
            isWaiting = false
            phase = .finished(done.status, message: done.message)
            post(doneAnnouncement(done), kind: .important)
            return true
        case .failed(let code):
            isWaiting = false
            if let scan { fail(LeaseAnalysisFailure(streamCode: code), for: scan) }
            return true
        }
        return false
    }

    private func doneAnnouncement(_ done: LeaseDone) -> String {
        switch done.status {
        // Inflected through AttributedString: "1 finding", "7 findings".
        case .analyzed: String(AttributedString(localized: "Check finished. ^[\(done.findings) finding](inflect: true).").characters)
        case .escalated: String(localized: "Check stopped. This lease needs a person to look at it.")
        case .notALease: String(localized: "This doesn't look like a lease.")
        }
    }

    /// Shows waiting findings one at a time, `stagger` apart, or all at once under Reduce Motion.
    private func revealPending() {
        guard revealTask == nil else { return }
        revealTask = Task {
            while !Task.isCancelled, !pending.isEmpty {
                if reduceMotion {
                    let all = pending
                    pending.removeAll()
                    withAnimation(.easeInOut(duration: 0.2)) { insert(all) }
                } else {
                    let next = pending.removeFirst()
                    withAnimation(.spring(duration: 0.35, bounce: 0.15)) { insert([next]) }
                    if !pending.isEmpty { try? await Task.sleep(for: Self.stagger) }
                }
            }
            // A reset already cleared it, and may have started another.
            if !Task.isCancelled { revealTask = nil }
        }
    }

    private func insert(_ new: [LeaseFinding]) {
        findings = (findings + new).sorted(by: LeaseFinding.displayOrder)
    }

    private func fail(_ failure: LeaseAnalysisFailure, for scan: LeaseScan) {
        guard self.scan == scan else { return }
        isWaiting = false
        phase = .failed(failure)
        post(String(localized: failure.message), kind: .important)
    }

    private func reset(keepingScan: Bool = false) {
        streamTask?.cancel()
        streamTask = nil
        revealTask?.cancel()
        revealTask = nil
        announceTask?.cancel()
        announceTask = nil
        announcements = AnnouncementQueue()
        pending = []
        phase = .notStarted
        keyTerms = []
        findings = []
        isWaiting = false
        sentText = nil
        unenforceableCount = 0
        isLive = false
        if !keepingScan { scan = nil }
    }

    // MARK: Announcements

    private func post(_ text: String, kind: AnnouncementQueue.Kind) {
        if let now = announcements.submit(text, kind: kind, at: .now) { announce(now) }
        scheduleAnnouncements()
    }

    private func scheduleAnnouncements() {
        guard announceTask == nil, let deadline = announcements.nextAllowed else { return }
        announceTask = Task {
            try? await Task.sleep(until: deadline)
            guard !Task.isCancelled else { return }
            announceTask = nil
            if let text = announcements.next(at: .now) { announce(text) }
            scheduleAnnouncements()
        }
    }
}
