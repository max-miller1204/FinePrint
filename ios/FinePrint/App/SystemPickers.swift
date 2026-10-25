import CoreGraphics
import SwiftUI
import UniformTypeIdentifiers

/// A system picker a tab asks for. `RootTabView` presents it above the tabs: a sheet, cover, alert,
/// or dialog presented from inside a tab while the deadline accessory shows sends SwiftUI into an
/// AttributeGraph update cycle whenever accessibility is on (VoiceOver, UI automation), and the
/// app stops responding.
enum SystemPicker: Hashable {
    /// The Files picker, for one PDF.
    case pdfFile
    /// VisionKit's document camera.
    case documentScan
}

/// What a system picker returned, for the tab that asked to read.
struct SystemPickerResult {
    enum Content {
        case file(URL)
        case scan([CGImage])
    }

    let id = UUID()
    let picker: SystemPicker
    let content: Content
}

extension View {
    /// Presents `navigation.systemPicker` and stores what it returns in `navigation.systemPickerResult`.
    func systemPickers(_ navigation: AppNavigation) -> some View {
        modifier(SystemPickerPresentations(navigation: navigation))
    }
}

private struct SystemPickerPresentations: ViewModifier {
    @Bindable var navigation: AppNavigation

    func body(content: Content) -> some View {
        content
            .fileImporter(isPresented: isPresenting(.pdfFile), allowedContentTypes: [.pdf]) { result in
                if case .success(let url) = result {
                    navigation.systemPickerResult = SystemPickerResult(picker: .pdfFile, content: .file(url))
                }
            }
            .fullScreenCover(isPresented: isPresenting(.documentScan)) {
                DocumentScanner { images in
                    navigation.systemPicker = nil
                    navigation.systemPickerResult = SystemPickerResult(picker: .documentScan, content: .scan(images))
                } onCancel: {
                    navigation.systemPicker = nil
                }
                .ignoresSafeArea()
            }
    }

    private func isPresenting(_ picker: SystemPicker) -> Binding<Bool> {
        Binding {
            navigation.systemPicker == picker
        } set: { isPresented in
            if !isPresented, navigation.systemPicker == picker { navigation.systemPicker = nil }
        }
    }
}
