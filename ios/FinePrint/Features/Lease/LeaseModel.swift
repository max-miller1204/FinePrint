import CoreGraphics
import Foundation
import Observation
import OSLog
import SwiftUI

extension EnvironmentValues {
    /// Where leases and their redaction maps are kept on the device.
    @Entry var leaseStore = LeaseStore.live(inMemory: true)
}

/// What the Lease tab shows for the current rental.
nonisolated enum LeasePhase: Equatable, Sendable {
    case loading
    case empty
    /// Reading the pages: the PDF's text, or OCR.
    case reading
    /// Looking for names, addresses, and numbers to hide.
    case redacting
    case failed(LeaseFailure)
    case ready(LeaseScan)
}

nonisolated enum LeaseFailure: Equatable, Sendable {
    case unreadablePDF
    case noText
    case couldNotSave
    case other

    init(_ error: any Error) {
        self = switch error as? LeaseReadError {
        case .unreadablePDF, .noPages: .unreadablePDF
        case .noText: .noText
        case nil: .other
        }
    }

    var message: LocalizedStringResource {
        switch self {
        case .unreadablePDF: "This PDF can't be opened. Try another file, or scan the paper lease."
        case .noText: "FinePrint couldn't find any words on these pages. Try scanning again in good light."
        case .couldNotSave: "FinePrint couldn't save your lease on this phone. Try again."
        case .other: "Something went wrong while reading your lease. Try again."
        }
    }
}

/// The Lease tab's state for the current rental: reads a lease, finds what to hide, keeps the
/// result on the device, and holds the scan the redaction review is editing.
@Observable
final class LeaseModel {
    private(set) var phase: LeasePhase = .loading
    /// Set to present the redaction review.
    var reviewing: LeaseScan?
    private(set) var rentalID: UUID?
    /// The rental a read in progress belongs to. Switching rentals does not cancel it: the lease is
    /// saved for the rental it was started for.
    private var workingRentalID: UUID?

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Lease")

    /// Shows `rentalID`'s lease, or the empty state.
    func load(rentalID: UUID?, store: LeaseStore) async {
        self.rentalID = rentalID
        guard let rentalID else {
            phase = .empty
            return
        }
        if workingRentalID == rentalID { return }
        phase = .loading
        do {
            let scan = try await store.load(rentalID: rentalID)
            // The tenant may have switched again while it loaded.
            guard self.rentalID == rentalID, workingRentalID != rentalID else { return }
            phase = scan.map(LeasePhase.ready) ?? .empty
        } catch {
            Self.logger.error("Lease failed to load: \(error.localizedDescription, privacy: .public)")
            guard self.rentalID == rentalID else { return }
            phase = .empty
        }
    }

    /// Reads a PDF: its text layer where it has one, OCR elsewhere.
    func importPDF(at url: URL, store: LeaseStore) {
        read(source: .pdf, store: store) {
            try await LeaseReader().read(pdfAt: url)
        }
    }

    /// OCRs pages from the document camera.
    func importScan(_ images: [CGImage], store: LeaseStore) {
        read(source: .scan, store: store) {
            let pages = try await LeaseReader().read(images: images)
            return (pages, await LeaseReader.pdfData(from: images))
        }
    }

    #if DEBUG
    /// `-FinePrintFixtureLease`: Scan renders the PDF's pages and OCRs every one, like the document
    /// camera's images; Import reads it as a PDF.
    func importFixture(at url: URL, as source: LeaseScan.Source, store: LeaseStore) {
        switch source {
        case .pdf:
            importPDF(at: url, store: store)
        case .scan:
            read(source: .scan, store: store) {
                try await LeaseReader().readAsScan(pdfAt: url)
            }
        }
    }
    #endif

    private func read(source: LeaseScan.Source, store: LeaseStore, pages: @escaping @Sendable () async throws -> ([LeasePage], Data?)) {
        guard let rentalID, workingRentalID == nil else { return }
        workingRentalID = rentalID
        setPhase(.reading, for: rentalID)
        // Utility priority: OCR and the tagger use every core, and the UI must stay responsive.
        Task(priority: .utility) {
            defer { workingRentalID = nil }
            do {
                let (read, original) = try await pages()
                setPhase(.redacting, for: rentalID)
                let scan = await LeaseScan.make(rentalID: rentalID, source: source, pages: read)
                do {
                    try await store.save(scan, original: original)
                } catch {
                    Self.logger.error("Lease failed to save: \(error.localizedDescription, privacy: .public)")
                    setPhase(.failed(.couldNotSave), for: rentalID)
                    return
                }
                setPhase(.ready(scan), for: rentalID)
                if self.rentalID == rentalID { reviewing = scan }
            } catch {
                Self.logger.error("Lease failed to read: \(error.localizedDescription, privacy: .public)")
                setPhase(.failed(LeaseFailure(error)), for: rentalID)
            }
        }
    }

    /// Saves the tenant's review. The lease counts as reviewed from now on.
    func finishReview(_ scan: LeaseScan, store: LeaseStore) async {
        var reviewed = scan
        reviewed.reviewedAt = .now
        reviewing = nil
        do {
            try await store.save(reviewed)
            setPhase(.ready(reviewed), for: reviewed.rentalID)
            AccessibilityNotification.Announcement(String(localized: "Review saved.")).post()
        } catch {
            Self.logger.error("Review failed to save: \(error.localizedDescription, privacy: .public)")
            setPhase(.failed(.couldNotSave), for: reviewed.rentalID)
        }
    }

    /// Deletes the current rental's lease, its scans, and its redaction map from the phone.
    func removeLease(store: LeaseStore) async {
        guard let rentalID else { return }
        do {
            try await store.delete(rentalID: rentalID)
        } catch {
            Self.logger.error("Lease failed to delete: \(error.localizedDescription, privacy: .public)")
        }
        setPhase(.empty, for: rentalID)
        AccessibilityNotification.Announcement(String(localized: "Lease removed from this phone.")).post()
    }

    func dismissFailure() {
        if case .failed = phase { phase = .empty }
    }

    /// Changes what the tab shows only while `rentalID` is still the current rental.
    private func setPhase(_ phase: LeasePhase, for rentalID: UUID) {
        guard self.rentalID == rentalID else { return }
        self.phase = phase
        switch phase {
        case .reading: AccessibilityNotification.Announcement(String(localized: "Reading your lease.")).post()
        case .redacting: AccessibilityNotification.Announcement(String(localized: "Finding personal details to hide.")).post()
        case .failed(let failure): AccessibilityNotification.Announcement(String(localized: failure.message)).post()
        default: break
        }
    }
}
