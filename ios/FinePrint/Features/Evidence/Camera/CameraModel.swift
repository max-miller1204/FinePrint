@preconcurrency import AVFoundation
import Observation
import SwiftUI

/// State for the capture screen: camera access, live framing guidance, and the photo under review.
@Observable
final class CameraModel {
    enum Phase: Equatable {
        case starting
        /// No camera, such as on the simulator.
        case unavailable
        case accessDenied
        case ready
        case processing
        case review(CapturedPhoto)
        case failed
    }

    /// What the preview frames say right now. Changes are spoken, at most every 2 seconds.
    enum Guidance: Equatable {
        case issue(QualityIssue)
        case ready

        var text: LocalizedStringResource {
            switch self {
            case .issue(let issue): issue.framingGuidance
            case .ready: "Good light. Ready for the photo."
            }
        }
    }

    let context: CaptureContext
    private(set) var phase: Phase = .starting
    private(set) var guidance: Guidance?
    var isFlashOn = false
    var supportsFlash: Bool { camera.supportsFlash }

    private let camera: CameraSession
    private let pipeline: CapturePipeline
    private let thresholds = QualityThresholds.standard
    private var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private var rotationObservation: NSKeyValueObservation?
    private weak var previewLayer: AVCaptureVideoPreviewLayer?
    /// Guidance must hold for two samples (about a second) before it changes, so it never flickers.
    private var pendingGuidance: Guidance?
    private var lastAnnouncement = Date.distantPast

    init(context: CaptureContext, store: EvidenceStore, camera: CameraSession = CameraSession()) {
        self.context = context
        self.camera = camera
        pipeline = CapturePipeline(store: store, appVersion: CaptureRecord.appVersion())
    }

    var session: AVCaptureSession { camera.session }

    /// Runs for as long as the screen is visible: checks access, starts the camera, and turns
    /// preview frames into guidance until the task is cancelled.
    func run() async {
        guard camera.isAvailable else {
            phase = .unavailable
            return
        }
        guard await Self.requestAccess() else {
            phase = .accessDenied
            return
        }

        let (frames, continuation) = AsyncStream.makeStream(of: LumaMetrics.self, bufferingPolicy: .bufferingNewest(1))
        do {
            try await camera.configure(frames: continuation)
        } catch {
            phase = .failed
            return
        }
        await camera.start()
        if phase == .starting { phase = .ready }

        for await metrics in frames {
            update(with: metrics)
        }
        await camera.stop()
    }

    func stop() async {
        await camera.stop()
    }

    /// The preview layer is ready: keep it and the photos upright as the phone turns.
    func attach(_ previewLayer: AVCaptureVideoPreviewLayer) {
        guard rotationCoordinator == nil, let device = camera.device else { return }
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
        rotationCoordinator = coordinator
        previewLayer.connection?.videoRotationAngle = coordinator.videoRotationAngleForHorizonLevelPreview
        self.previewLayer = previewLayer
        rotationObservation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: .new) { [weak self] coordinator, _ in
            let angle = coordinator.videoRotationAngleForHorizonLevelPreview
            Task { @MainActor in
                self?.previewLayer?.connection?.videoRotationAngle = angle
            }
        }
    }

    func capture() async {
        guard phase == .ready else { return }
        let shutter = CapturePipeline.Shutter.now()
        phase = .processing
        do {
            let data = try await camera.capturePhoto(
                flash: isFlashOn,
                rotationAngle: rotationCoordinator?.videoRotationAngleForHorizonLevelCapture
            )
            let photo = try await pipeline.process(data, context: context, shutter: shutter)
            phase = .review(photo)
            announce(photo.issues.first.map { String(localized: $0.retakeReason) } ?? String(localized: "Photo saved."), force: true)
        } catch {
            phase = .ready
            announce(String(localized: "The photo didn't save. Try again."), force: true)
        }
    }

    /// Discards the photo under review. It was never uploaded, so nothing else refers to it.
    func retake() {
        discardPhotoUnderReview()
        phase = .ready
    }

    /// The tenant kept the photo under review: the upload queue owns it from here, and uploads it
    /// whenever the device is online (spec §6.3, §8.2).
    func keepPhotoUnderReview(in uploads: UploadQueue?) {
        guard case .review(let photo) = phase else { return }
        uploads?.enqueue(photo)
    }

    func discardPhotoUnderReview() {
        guard case .review(let photo) = phase else { return }
        try? pipeline.store.delete(photo.record)
    }

    private func update(with metrics: LumaMetrics) {
        let next = thresholds.issues(for: metrics).first.map(Guidance.issue) ?? .ready
        defer { pendingGuidance = next }
        guard next != guidance, next == pendingGuidance else { return }
        guidance = next
        if phase == .ready { announce(String(localized: next.text)) }
    }

    /// Spoken by VoiceOver; no effect when it is off.
    private func announce(_ text: String, force: Bool = false) {
        guard force || Date.now.timeIntervalSince(lastAnnouncement) >= 2 else { return }
        lastAnnouncement = .now
        AccessibilityNotification.Announcement(text).post()
    }

    private static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .video)
        default: false
        }
    }
}
