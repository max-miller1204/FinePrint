import SwiftUI

/// Exactly what would leave the phone: the upload body's redacted text, built by `LeaseUpload`
/// from the reviewed lease. Shown in place of the summary, with its own Back button, for the same
/// reason as the review (#99).
struct LeaseSentTextView: View {
    let scan: LeaseScan
    let onClose: () -> Void
    @State private var sent: LeaseUpload.Body?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button(action: onClose) {
                        Label("Back", systemImage: "chevron.backward")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("lease.sent.close")
                    Spacer()
                }
                Text("What Gets Sent")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("This is the only part of your lease that leaves your phone. Hidden details are replaced by labels such as [TENANT_1]. Your scan and the list of hidden details stay here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let sent {
                    Text("^[\(sent.pageCount) page](inflect: true)")
                        .font(.subheadline.weight(.semibold))
                    Text(verbatim: sent.text)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))
                        .accessibilityIdentifier("lease.sentText")
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
        .leaseBottomClearance()
        .background(Color(.systemBackground))
        .task(id: scan) {
            sent = await LeaseUpload.body(for: scan)
        }
    }
}
