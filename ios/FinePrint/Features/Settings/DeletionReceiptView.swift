import SwiftUI

/// Shown after "Delete everything" (spec §9.2): what was removed from the server and from this device.
/// Full screen, because the rentals and tabs it was started from are gone.
struct DeletionReceiptView: View {
    let receipt: DeletionReceipt
    var onAppear: () -> Void = {}
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.largeTitle)
                        .foregroundStyle(.green)
                        .accessibilityHidden(true)
                    Text("Everything deleted")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("deletion.receipt.title")
                    Text(receipt.deletedAt, format: .dateTime.year().month(.wide).day().hour().minute())
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("deletion.receipt.date")
                }

                VStack(spacing: 0) {
                    section("On the server", rentals: receipt.serverRentals, photos: receipt.serverPhotos, id: "deletion.receipt.server")
                    Divider()
                    section("On this device", rentals: receipt.deviceRentals, photos: receipt.devicePhotos, id: "deletion.receipt.device")
                }
                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))

                Text("Your anonymous account, share links, and settings are gone too. FinePrint no longer holds any of your information. This receipt is not saved, so take a screenshot if you want to keep it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Button(action: onDone) {
                    Text("Start Over")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("deletion.receipt.done")
            }
            .padding(24)
        }
        .background(Color(.systemBackground))
        .accessibilityIdentifier("deletion.receipt")
        .sensoryFeedback(.success, trigger: receipt)
        .onAppear {
            onAppear()
            AccessibilityNotification.Announcement(String(localized: "Everything was deleted.")).post()
        }
    }

    private func section(_ title: LocalizedStringResource, rentals: Int, photos: Int, id: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            LabeledContent("Rentals") {
                Text(rentals, format: .number)
            }
            LabeledContent("Photos") {
                Text(photos, format: .number)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }
}

#Preview {
    DeletionReceiptView(
        receipt: DeletionReceipt(deletedAt: .now, serverRentals: 2, serverPhotos: 14, deviceRentals: 2, devicePhotos: 3),
        onDone: {}
    )
}
