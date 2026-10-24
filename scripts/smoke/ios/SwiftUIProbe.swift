// Compile-time probe for the iOS 26 SwiftUI APIs FinePrint's shell depends on
// (spec §4, §11, §21 item 7). Typechecked by ios-capabilities.sh; never shipped.

import SwiftUI

struct ProbeShell: View {
    @State private var query = ""

    var body: some View {
        TabView {
            Tab("Lease", systemImage: "doc.text") { Text("Lease") }
            Tab("Evidence", systemImage: "camera") { Text("Evidence") }
            Tab(role: .search) {
                NavigationStack { Text("Ask") }
                    .searchable(text: $query)
            }
        }
        .tabViewBottomAccessory {
            DeadlineAccessory()
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

/// Glass stays on the control layer, per the fineprint-ios-ui skill.
struct DeadlineAccessory: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        GlassEffectContainer {
            Label(placement == .inline ? "3 days" : "Object to move-in report: 3 days left", systemImage: "clock")
                .padding()
                .glassEffect(.regular.interactive(), in: .capsule)
        }
    }
}
