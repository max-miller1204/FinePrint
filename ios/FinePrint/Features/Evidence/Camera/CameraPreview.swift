@preconcurrency import AVFoundation
import SwiftUI

/// The live camera feed, filling its frame.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    var onReady: (AVCaptureVideoPreviewLayer) -> Void = { _ in }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        // The feed is decorative for VoiceOver; framing guidance is spoken instead.
        view.isAccessibilityElement = false
        onReady(view.previewLayer)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

        var previewLayer: AVCaptureVideoPreviewLayer {
            // layerClass guarantees the type.
            layer as! AVCaptureVideoPreviewLayer
        }
    }
}
