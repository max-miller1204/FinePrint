# Evidence camera

The full-screen camera behind F2 Move-in Evidence (spec §4.3 F2, §7.5, §8.1,
#21). Until the move-in walkthrough (#25) lands, it opens only from
Developer Options, for the "Walls" item in the "Kitchen".

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
- Developer Options shows the last kept photo's hash
  (`developer.lastCaptureHash`).
- No camera: "Camera not available" (`camera.unavailable`). Access denied:
  "Camera access is off" with Open Settings (`camera.openSettings`).

## How to get to it (user POV)

Gear > Settings > tap Version 5 times > Developer Options > Camera > Open
Camera.

## Driving it with e2e

- `tests/ios/camera.e2e.ts` opens the camera from Developer Options, checks
  the no-camera state, and closes it. Simulators have no camera, so that is
  the only state e2e can reach until the DEBUG fixture camera (#22).
- `ios/FinePrintTests/CaptureTests.swift` covers hashing, the capture record,
  GPS removal (JPEG, HEIC, PNG), the model copy, the quality gate, and
  retake deletion.
- Real capture, flash, rotation, and spoken guidance need a physical iPhone:
  check them by hand.

## Proof

After the tap, "Camera not available" and `camera.close` are on screen;
after close, `developer.openCamera` is back. On a device, the review screen
shows a 64-character hash, and Developer Options shows the same hash after
Use Photo.

## Charters

```
camera-entry|ios|skeptic|Open the camera from Developer Options, close it, reopen it, and rotate the device; report any state where the camera screen cannot be closed or the developer menu does not come back
```

## Gotchas

- The quality thresholds are lenient starting points (`QualityThresholds`).
  A sharp photo of a blank wall can read as blurry; the tenant can keep it.
- The camera never adds a location, so GPS removal usually returns the file
  unchanged. It matters for imported photos later.
