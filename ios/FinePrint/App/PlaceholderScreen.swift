import SwiftUI

/// Shared empty state for tabs whose features have not landed yet.
/// Empty states teach: the description says what the tab does and why it matters.
struct PlaceholderScreen: View {
    let navigationTitle: LocalizedStringResource
    let title: LocalizedStringResource
    let systemImage: String
    let description: LocalizedStringResource
    var showsLegalFooter = true

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    ContentUnavailableView {
                        Label {
                            Text(title)
                        } icon: {
                            Image(systemName: systemImage)
                        }
                    } description: {
                        Text(description)
                    }
                    if showsLegalFooter {
                        Text("Legal information, not legal advice.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding([.horizontal, .bottom])
                    }
                }
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(Text(navigationTitle))
        .rentalSubtitle()
        .settingsToolbar()
    }
}
