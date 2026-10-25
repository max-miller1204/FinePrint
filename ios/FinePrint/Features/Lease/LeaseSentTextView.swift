import SwiftUI

/// Exactly what would leave the phone: the upload body's redacted text, built by `LeaseUpload`
/// from the reviewed lease.
struct LeaseSentTextView: View {
    let scan: LeaseScan
    @State private var sent: LeaseUpload.Body?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("This is the only part of your lease that leaves your phone. Hidden details are replaced by labels such as [TENANT_1]. Your scan and the list of hidden details stay here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let sent {
                    Text("^[\(sent.pageCount) page](inflect: true)")
                        .font(.subheadline.weight(.semibold))
                    Text(verbatim: sent.redactedText)
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
        .background(Color(.systemBackground))
        .navigationTitle("What Gets Sent")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scan) {
            sent = await LeaseUpload.body(for: scan)
        }
    }
}
