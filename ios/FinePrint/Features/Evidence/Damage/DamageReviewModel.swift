import Foundation
import OSLog

/// One box on the photo under review: a Gemma proposal with the tenant's decision so far, or a
/// box the tenant added.
nonisolated struct ReviewBox: Identifiable, Equatable, Sendable {
    /// The proposal's id, or a fresh one for a box the tenant added.
    let id: String
    let proposal: DamageProposal?
    var box: NormalizedBox
    var label: String
    var description: String
    var severity: DamageSeverity?
    /// Nil until the tenant decides. Undecided proposals are not saved.
    var decision: TenantAnnotation.Decision?

    var isAdded: Bool { proposal == nil }
    /// Mold-like growth and pest signs: point to the repair request path.
    var needsRepairPath: Bool { proposal?.repairPath ?? false }

    init(proposal: DamageProposal) {
        id = proposal.id
        self.proposal = proposal
        box = (proposal.box ?? .centered).clamped()
        label = proposal.label
        description = proposal.description
        severity = proposal.severity
        decision = nil
    }

    init(added box: NormalizedBox) {
        id = "added-\(UUID().uuidString)"
        proposal = nil
        self.box = box.clamped()
        label = String(localized: "Damage")
        description = ""
        severity = nil
        decision = .added
    }

    /// The decision to store. A confirmed box the tenant moved or resized counts as adjusted.
    var annotation: TenantAnnotation? {
        guard var decision else { return nil }
        if decision == .confirmed, box != proposal?.box { decision = .adjusted }
        return TenantAnnotation(
            proposalId: proposal?.id,
            decision: decision,
            box: box,
            label: label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? String(localized: "Damage") : label,
            description: description,
            severity: severity
        )
    }
}

/// Loads a photo's damage review once its upload reached the server, asks Gemma when nothing was
/// proposed yet, and saves the tenant's decisions (spec §4.3 F2, §7.5). The tenant has the final
/// say: nothing reaches the report until they confirm, adjust, or add it.
@Observable
final class DamageReviewModel {
    enum Phase: Equatable {
        /// The photo has not reached the server yet.
        case waitingForUpload
        case analyzing
        case ready
        case failed(String)
    }

    private(set) var phase: Phase = .waitingForUpload
    private(set) var quality: DamageAnalysis.ImageQuality?
    private(set) var model: String?
    var boxes: [ReviewBox] = []
    /// The box whose position and size the tenant is editing.
    var editingID: String?
    private(set) var isSaving = false
    private(set) var saveError: LocalizedStringResource?
    private(set) var hasUnsavedChanges = false

    let itemID: UUID
    @ObservationIgnored private var started = false

    private static let logger = Logger(subsystem: "org.fineprint.FinePrint", category: "Damage")

    init(itemID: UUID) {
        self.itemID = itemID
    }

    /// Runs once the upload is received: the stored review if there is one, else a new analysis.
    func load(server: APIClient, rentalServerID: String, modelCopy: Data) async {
        guard !started else { return }
        started = true
        phase = .analyzing
        do throws(APIError) {
            var review = try await server.damageReview(rentalServerID: rentalServerID, itemID: itemID)
            if review.analysis == nil {
                review = try await server.analyzeDamage(rentalServerID: rentalServerID, itemID: itemID, modelCopy: modelCopy)
            }
            apply(review)
            phase = .ready
        } catch {
            Self.logger.error("Damage review failed for \(self.itemID, privacy: .public): \(String(describing: error), privacy: .public)")
            started = false
            phase = .failed(String(localized: Self.message(for: error)))
        }
    }

    func apply(_ review: DamageReview) {
        quality = review.analysis?.imageQuality
        model = review.analysis?.model
        var boxes = (review.analysis?.proposals ?? []).map(ReviewBox.init(proposal:))
        for annotation in review.annotations {
            if let id = annotation.proposalId, let index = boxes.firstIndex(where: { $0.id == id }) {
                boxes[index].box = annotation.box
                boxes[index].label = annotation.label
                boxes[index].description = annotation.description
                boxes[index].severity = annotation.severity
                boxes[index].decision = annotation.decision == .adjusted ? .confirmed : annotation.decision
            } else if annotation.proposalId == nil {
                var added = ReviewBox(added: annotation.box)
                added.label = annotation.label
                added.description = annotation.description
                added.severity = annotation.severity
                boxes.append(added)
            }
        }
        self.boxes = boxes
        hasUnsavedChanges = false
    }

    // MARK: Decisions

    func confirm(_ id: String) {
        update(id) { $0.decision = $0.isAdded ? .added : .confirmed }
        if editingID == id { editingID = nil }
    }

    func reject(_ id: String) {
        guard let box = boxes.first(where: { $0.id == id }) else { return }
        if box.isAdded {
            boxes.removeAll { $0.id == id }
            hasUnsavedChanges = true
        } else {
            update(id) { $0.decision = .rejected }
        }
        if editingID == id { editingID = nil }
    }

    /// Opens the box for moving and resizing. Confirming it afterwards records it as adjusted.
    func adjust(_ id: String) {
        editingID = id
        update(id) { if !$0.isAdded { $0.decision = .confirmed } }
    }

    func addBox() {
        let box = ReviewBox(added: .centered)
        boxes.append(box)
        editingID = box.id
        hasUnsavedChanges = true
    }

    func setBox(_ id: String, to box: NormalizedBox) {
        update(id) {
            $0.box = box.clamped()
            if $0.decision == nil || $0.decision == .rejected { $0.decision = .confirmed }
        }
    }

    func setLabel(_ id: String, to label: String) {
        update(id) { $0.label = label }
    }

    private func update(_ id: String, _ change: (inout ReviewBox) -> Void) {
        guard let index = boxes.firstIndex(where: { $0.id == id }) else { return }
        change(&boxes[index])
        hasUnsavedChanges = true
    }

    // MARK: Saving

    func save(server: APIClient, rentalServerID: String) async -> Bool {
        isSaving = true
        saveError = nil
        defer { isSaving = false }
        do throws(APIError) {
            let review = try await server.saveAnnotations(rentalServerID: rentalServerID, itemID: itemID, annotations: boxes.compactMap(\.annotation))
            apply(review)
            return true
        } catch {
            Self.logger.error("Saving annotations failed for \(self.itemID, privacy: .public): \(String(describing: error), privacy: .public)")
            saveError = Self.message(for: error)
            return false
        }
    }

    static func message(for error: APIError) -> LocalizedStringResource {
        switch error {
        case .offline: "You're offline. Your photo is safe; try again when you're connected."
        case .server(status: 503, code: _): "Damage suggestions aren't available right now. You can still add boxes yourself."
        default: "Something went wrong. Your photo is safe; try again."
        }
    }
}
