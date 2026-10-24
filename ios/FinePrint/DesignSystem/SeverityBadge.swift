import SwiftUI

/// Symbol + word + color for a severity. Sits on content, so it uses a solid tint, never glass.
struct SeverityBadge: View {
    let severity: Severity

    var body: some View {
        Label {
            Text(severity.title)
                .foregroundStyle(.primary)
        } icon: {
            Image(systemName: severity.symbolName)
                .foregroundStyle(severity.color)
        }
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(severity.color.opacity(0.14), in: .capsule)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(severity.accessibilityLabel))
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 12) {
        ForEach(Severity.allCases, id: \.self) { severity in
            SeverityBadge(severity: severity)
        }
    }
    .padding()
}
