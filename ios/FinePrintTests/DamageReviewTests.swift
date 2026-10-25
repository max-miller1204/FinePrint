import Foundation
import Testing
@testable import FinePrint

@Suite("Damage review")
struct DamageReviewTests {
    private func proposal(id: String = "p1", box: NormalizedBox? = NormalizedBox(x: 0.2, y: 0.1, width: 0.3, height: 0.2), repairPath: Bool = false) -> DamageProposal {
        DamageProposal(id: id, type: "scuff", label: "Scuff", description: "scuff on wall", severity: .minor, confidence: .high, box: box, repairPath: repairPath)
    }

    @Test func `boxes stay inside the photo`() {
        let box = NormalizedBox(x: 0.9, y: -0.2, width: 0.3, height: 0.01).clamped()
        #expect(box.x + box.width <= 1)
        #expect(box.y == 0)
        #expect(box.height == NormalizedBox.minimumSide)
        let moved = NormalizedBox(x: 0.5, y: 0.5, width: 0.2, height: 0.2).moved(dx: 1, dy: -1)
        #expect(moved.x == 0.8)
        #expect(moved.y == 0)
        let grown = NormalizedBox(x: 0.5, y: 0.5, width: 0.2, height: 0.2).resized(dWidth: 1, dHeight: 1)
        #expect(grown.x == 0.5)
        #expect(grown.width == 0.5)
    }

    @Test func `undecided proposals are not saved`() {
        #expect(ReviewBox(proposal: proposal()).annotation == nil)
    }

    @Test func `a confirmed box the tenant moved is saved as adjusted`() {
        var box = ReviewBox(proposal: proposal())
        box.decision = .confirmed
        #expect(box.annotation?.decision == .confirmed)
        #expect(box.annotation?.proposalId == "p1")
        box.box = box.box.moved(dx: 0.1, dy: 0)
        #expect(box.annotation?.decision == .adjusted)
    }

    @Test func `added boxes have no proposal`() {
        let box = ReviewBox(added: .centered)
        #expect(box.annotation?.decision == .added)
        #expect(box.annotation?.proposalId == nil)
    }

    @Test func `mold and pest suggestions point to the repair path`() {
        #expect(ReviewBox(proposal: proposal(repairPath: true)).needsRepairPath)
        #expect(!ReviewBox(proposal: proposal()).needsRepairPath)
    }

    @Test func `the model restores saved decisions`() {
        let model = DamageReviewModel(itemID: UUID())
        let review = DamageReview(
            itemId: model.itemID,
            sha256: String(repeating: "a", count: 64),
            analysis: DamageAnalysis(imageQuality: .init(ok: true, issues: []), proposals: [proposal(), proposal(id: "p2")], model: "gemma-4-26b-a4b-it", fallback: false),
            annotations: [
                TenantAnnotation(proposalId: "p2", decision: .rejected, box: .centered, label: "Scuff", description: "", severity: nil),
                TenantAnnotation(proposalId: nil, decision: .added, box: .centered, label: "Chip", description: "", severity: nil),
            ]
        )
        model.apply(review)
        #expect(model.boxes.map(\.decision) == [nil, .rejected, .added])
        #expect(model.boxes.compactMap(\.annotation).count == 2)
        #expect(!model.hasUnsavedChanges)
    }
}
