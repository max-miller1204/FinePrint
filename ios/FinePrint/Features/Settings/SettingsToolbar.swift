import SwiftUI

extension View {
    /// Adds the Settings gear to the navigation bar. The sheet itself is owned by `RootTabView`.
    func settingsToolbar() -> some View {
        modifier(SettingsToolbarModifier())
    }
}

private struct SettingsToolbarModifier: ViewModifier {
    @Environment(AppNavigation.self) private var navigation

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    navigation.isSettingsPresented = true
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                .accessibilityIdentifier("settingsButton")
            }
        }
    }
}
