# Evidence camera

The full-screen camera behind F2 Move-in Evidence (spec §4.3 F2, §7.5, §8.1,
#21). It opens from the move-in walkthrough ([walkthrough](walkthrough.md),
#25) for the item the tenant picked, and from Developer Options, for the
"Walls" item in the "Kitchen".

## Sub-features

- Full-screen preview with floating glass controls: close (`camera.close`),
  the checklist item and room (`camera.item`), flash (`camera.flash`, only on
  devices with a flash), and the shutter (`camera.shutter`, VoiceOver label
  "Take photo of Walls in Kitchen").
- Live framing guidance from preview frames (`camera.guidance`): "Too dark",
  "Too bright", "Hold the phone steady". VoiceOver speaks each change, at most
  every 2 seconds, plus "Good light. Ready for the photo."
- At the shutter: GPS is removed, the file is hashed with SHA-256, a 1536px
  JPEG model copy is made, and the §8.1 capture record is written next to
  both in Application Support (complete file protection; a temporary folder
  under `-FinePrintInMemoryStore`).
- Review screen: the photo, its hash (`camera.hash`), and either "Photo saved
  on this device." (`camera.saved`, then `camera.use` / `camera.retake`) or a
  retake reason (`camera.retakeReason`, then `camera.retake` /
  `camera.keep`). Retake and close delete the discarded files.
- In a walkthrough the camera also shows "N of M done" (`camera.progress`)
  and Mark No Damage (`camera.markNoDamage`), which records the item without
  a photo and closes the camera.
- Developer Options shows the last kept photo's hash
  (`developer.lastCaptureHash`).
- Fixture camera (DEBUG only, `-FinePrintFixtureCamera <dir>`, #22): the viewfinder is
  black and ready at once, and the shutter returns the next photo in `<dir>` (file name order,
  wrapping around). Everything after the shutter is the real pipeline, so the review, hash, quality
  gate, Use Photo, and the Developer Options hash behave as on a device. A missing or empty folder
  shows "The camera didn't start" (`camera.failed`).
- No camera: "Camera not available" (`camera.unavailable`). Access denied:
  "Camera access is off" with Open Settings (`camera.openSettings`).

## How to get to it (user POV)

Gear > Settings > tap Version 5 times > Developer Options > Camera > Open
Camera.

## Driving it with e2e

- Every launch gets `-FinePrintFixtureCamera
  e2e/fixtures/photos/move-in` (an absolute host path the simulator reads
  directly; `e2e/ios-launch.ts` lists the default arguments). `tests/ios/capture.e2e.ts` opens the camera, taps
  `camera.shutter`, reads the 64-character hash out of `camera.hash` (one combined element, "SHA-256 fingerprint, <hash>"), taps `camera.use`
  (or `camera.keep` if the quality gate asks for a retake), and checks that
  `developer.lastCaptureHash` contains the same hash. A second test checks that
  two shutters give two different photos (hashes).
- `tests/ios/camera.e2e.ts` (no-camera state) relaunches with
  `iosLaunchArguments({ without: ['-FinePrintFixtureCamera'] })`.
- `e2e/fixtures/photos/` holds the generated move-in and move-out pairs of the
  same three views (see `e2e/fixtures/README.md`). To drive a move-out pair,
  point the argument at `photos/move-out`.
- `ios/FinePrintTests/FixtureCameraTests.swift` covers the source (order,
  wrap-around, unreadable and empty folders) and a fixture photo through
  `CapturePipeline`.
- `ios/FinePrintTests/CaptureTests.swift` covers hashing, the capture record,
  GPS removal (JPEG, HEIC, PNG), the model copy, the quality gate, and
  retake deletion.
- Real camera hardware, flash, rotation, and spoken guidance need a physical iPhone:
  check them by hand.

## Proof

With the fixture camera: after the shutter, the review screen shows a
64-character hash, and Developer Options shows the same hash after Use Photo.
Without it: "Camera not available" and `camera.close` are on screen; after
close, `developer.openCamera` is back.

## Charters

```
camera-entry|ios|skeptic|Open the camera from Developer Options, close it, reopen it, and rotate the device; report any state where the camera screen cannot be closed or the developer menu does not come back
```

## Gotchas

- The fixture camera never exists in Release: `FixtureCameraSource`, the
  launch argument parsing, and the model hooks are all `#if DEBUG`.
- The fixture index lives in the camera model, so each time the camera opens it
  starts again at the first photo. The viewfinder is black (no preview).
- Retake deletes the discarded files but the next shutter still advances.

- The quality thresholds are lenient starting points (`QualityThresholds`).
  A sharp photo of a blank wall can read as blurry; the tenant can keep it.
- The camera never adds a location, so GPS removal usually returns the file
  unchanged. It matters for imported photos later.
