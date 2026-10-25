import SwiftUI

extension SealStatus {
    /// Spec §4.3 F2 names two states, "Sealed" and "Waiting to seal". A photo the server already
    /// checked is still waiting to seal, so it says both.
    var title: LocalizedStringResource {
        switch self {
        case .waiting: Severity.pending.title
        case .received: "Uploaded, waiting to seal"
        case .sealed: "Sealed"
        case .rejected: "Didn't upload"
        }
    }

    var detail: LocalizedStringResource {
        switch self {
        case .waiting: "Saved on this device. It uploads when you're online."
        case .received: "The server has this photo and checked its fingerprint. It's sealed with your report."
        case .sealed: "This photo is in a signed report. Any change to it would show."
        case .rejected: "The uploaded file didn't match this photo's fingerprint. Take the photo again."
        }
    }

    var symbolName: String {
        switch self {
        case .waiting: Severity.pending.symbolName
        case .received: "checkmark.icloud"
        case .sealed: Severity.verified.symbolName
        case .rejected: Severity.ask.symbolName
        }
    }

    var color: Color {
        switch self {
        case .waiting, .received: Severity.pending.color
        case .sealed: Severity.verified.color
        case .rejected: Severity.ask.color
        }
    }
}

/// Symbol + word + color for a photo's seal status. Sits on content, so a solid tint, never glass.
struct SealStatusPill: View {
    let status: SealStatus

    var body: some View {
        Label {
            Text(status.title)
                .foregroundStyle(.primary)
        } icon: {
            Image(systemName: status.symbolName)
                .foregroundStyle(status.color)
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(status.color.opacity(0.14), in: .capsule)
        .contentTransition(.opacity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(status.title))
        .accessibilityHint(Text(status.detail))
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 12) {
        ForEach([SealStatus.waiting, .received, .sealed, .rejected], id: \.self) { status in
            SealStatusPill(status: status)
        }
    }
    .padding()
}
