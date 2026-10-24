@preconcurrency import AVFoundation
import CoreVideo

nonisolated enum CameraError: Error, Equatable {
    case noCamera
    case cannotConfigure
    case noPhotoData
}

/// Owns the capture session for the back camera. Every session call runs on `queue`; that serial
/// queue is the synchronization behind `@unchecked Sendable`.
nonisolated final class CameraSession: @unchecked Sendable {
    let session = AVCaptureSession()
    let device: AVCaptureDevice?

    private let queue = DispatchQueue(label: "org.fineprint.camera.session")
    private let frameQueue = DispatchQueue(label: "org.fineprint.camera.frames")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private var isConfigured = false
    /// Delegates for photos in flight, kept alive until AVFoundation finishes with them. Queue only.
    private var inFlight: [Int64: PhotoCaptureDelegate] = [:]
    private var frameSampler: FrameSampler?

    init() {
        device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }

    var isAvailable: Bool { device != nil }

    var supportsFlash: Bool { device?.hasFlash ?? false }

    /// Sets up inputs and outputs once. Brightness and sharpness of preview frames arrive on
    /// `frames` about twice a second.
    func configure(frames: AsyncStream<LumaMetrics>.Continuation) async throws {
        try await perform { [self] in
            guard !isConfigured else { return }
            guard let device else { throw CameraError.noCamera }

            session.beginConfiguration()
            defer { session.commitConfiguration() }
            session.sessionPreset = .photo

            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input), session.canAddOutput(photoOutput), session.canAddOutput(videoOutput) else {
                throw CameraError.cannotConfigure
            }
            session.addInput(input)
            session.addOutput(photoOutput)
            if let largest = device.activeFormat.supportedMaxPhotoDimensions.last {
                photoOutput.maxPhotoDimensions = largest
            }

            // Full-range luma matches the 0 to 255 scale of decoded stills.
            videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
            videoOutput.alwaysDiscardsLateVideoFrames = true
            let sampler = FrameSampler(continuation: frames)
            videoOutput.setSampleBufferDelegate(sampler, queue: frameQueue)
            frameSampler = sampler
            session.addOutput(videoOutput)

            isConfigured = true
        }
    }

    func start() async {
        try? await perform { [self] in
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() async {
        try? await perform { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    /// Takes one photo and returns the encoded file (HEIC when the device supports it).
    /// `rotationAngle` comes from the rotation coordinator, so the photo is upright.
    func capturePhoto(flash: Bool, rotationAngle: CGFloat?) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            queue.async { [self] in
                let settings = if photoOutput.availablePhotoCodecTypes.contains(.hevc) {
                    AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
                } else {
                    AVCapturePhotoSettings()
                }
                settings.maxPhotoDimensions = photoOutput.maxPhotoDimensions
                let flashMode: AVCaptureDevice.FlashMode = flash ? .on : .off
                if photoOutput.supportedFlashModes.contains(flashMode) {
                    settings.flashMode = flashMode
                }
                if let rotationAngle, let connection = photoOutput.connection(with: .video),
                   connection.isVideoRotationAngleSupported(rotationAngle) {
                    connection.videoRotationAngle = rotationAngle
                }

                let id = settings.uniqueID
                let delegate = PhotoCaptureDelegate(continuation: continuation) { [weak self] in
                    guard let self else { return }
                    queue.async { self.inFlight[id] = nil }
                }
                inFlight[id] = delegate
                photoOutput.capturePhoto(with: settings, delegate: delegate)
            }
        }
    }

    private func perform(_ work: @escaping @Sendable () throws -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            queue.async {
                do {
                    try work()
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

/// Resumes once, from the last callback AVFoundation sends for a photo. AVFoundation calls a
/// delegate's methods one after another, never at the same time.
nonisolated private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    private var continuation: CheckedContinuation<Data, any Error>?
    private var result: Result<Data, any Error> = .failure(CameraError.noPhotoData)
    private let onFinish: @Sendable () -> Void

    init(continuation: CheckedContinuation<Data, any Error>, onFinish: @escaping @Sendable () -> Void) {
        self.continuation = continuation
        self.onFinish = onFinish
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: (any Error)?) {
        if let error {
            result = .failure(error)
        } else if let data = photo.fileDataRepresentation() {
            result = .success(data)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: (any Error)?) {
        if let error, case .success = result {
            result = .failure(error)
        }
        continuation?.resume(with: result)
        continuation = nil
        onFinish()
    }
}

/// Measures preview frames for spoken framing guidance. Runs on the frame queue only.
nonisolated private final class FrameSampler: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private static let interval = CMTime(value: 1, timescale: 2)
    private let continuation: AsyncStream<LumaMetrics>.Continuation
    private var lastSample = CMTime.invalid

    init(continuation: AsyncStream<LumaMetrics>.Continuation) {
        self.continuation = continuation
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if lastSample.isValid, CMTimeSubtract(time, lastSample) < Self.interval { return }
        lastSample = time

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return }
        let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
        let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        let luma = UnsafeRawBufferPointer(start: base, count: bytesPerRow * height)
        if let metrics = LumaMetrics(downsampling: luma, width: width, height: height, bytesPerRow: bytesPerRow) {
            continuation.yield(metrics)
        }
    }
}
