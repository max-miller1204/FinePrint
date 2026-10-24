# Evidence upload queue and seal status

Kept photos leave the phone on their own, even when they were taken
offline (spec §5.3, §6.3, §8.2, #23). "Use Photo" (or "Keep Photo") hands
the capture to an on-device upload queue; the queue asks the server for a
5-minute upload URL, PUTs the original straight to Cloud Storage, and asks
the server to check its size and SHA-256. Each photo shows a seal status
pill. Sealing itself (#24) is not built, so the furthest a photo gets today
is "Uploaded, waiting to seal".

## Sub-features

- The queue (`UploadQueue`) keeps one `upload.json` per capture next to the
  photo in `<Application Support>/Evidence/<rentalId>/<itemId>/`, written
  with complete file protection (a temporary folder under
  `-FinePrintInMemoryStore`). It survives relaunches and uploads oldest
  first.
- It runs at launch, on every new photo, when the network comes back
  (`NWPathMonitor`), on return to the foreground, and on a backoff timer
  (5 s doubling to 5 min) after a failure. A lost connection stops the
  pass; the rest wait.
- A rental the server does not know yet is created there first
  (`POST /v1/rentals` from the SwiftData rental's city or county, saved to
  `Rental.serverID`). A rental with neither keeps its photos waiting.
- Seal status pill (color + symbol + word):
  - "Waiting to seal" (clock): on this device only. Shown on the review
    screen (`camera.sealStatus`) and in Developer Options until the server
    has the photo.
  - "Uploaded, waiting to seal" (iCloud check): the server stored it and
    its size and SHA-256 matched (`receivedAtServer` is set).
  - "Didn't upload" (orange triangle): the server refused it for good, such
    as a hash mismatch (422 `HASH_MISMATCH`, or Storage refusing the bytes
    for the signed hash). Not retried.
  - "Sealed" (green seal): reserved for #24; nothing sets it yet.
- Developer Options > Camera, after a photo is kept: "Seal Status" for the
  last photo (`developer.sealStatus`), "Waiting to Upload" count
  (`developer.uploadQueueCount`), and in DEBUG a "Simulate Offline" switch
  (`developer.simulateOfflineToggle`) that holds the queue as if offline;
  turning it off counts as a reconnect. The simulator has no airplane mode,
  so this switch is how e2e takes photos "offline".
- The developer camera files photos under the first rental with a server
  ID, city, or county; with none, it makes a "Sample rental" in Richmond,
  VA (fixed ID `…F1E2`) so test photos can upload.

## How to get to it (user POV)

Take a photo and tap Use Photo. Until the move-in walkthrough (#25) lands,
that is Gear > Settings > tap Version 5 times > Developer Options > Camera
> Open Camera, which needs a camera or the DEBUG fixture camera (#22,
`-FinePrintFixtureCamera <dir>`).

## Driving it with e2e

The ios target runs the server under the Auth, Firestore, and Storage
emulators (`e2e/firebase.ios.json`: 9199, 8190, 9290). Under the Storage
emulator the server returns emulator upload URLs on 127.0.0.1, which the
simulator reaches directly.

The capture-to-upload test builds on the fixture camera test (#22). With
`-FinePrintFixtureCamera <dir>` added to the launch arguments:

1. Developer Options: turn on `developer.simulateOfflineToggle`.
2. Open Camera, take the fixture photo, check `camera.sealStatus` reads
   "Waiting to seal", tap `camera.use`.
3. Back in Developer Options: `developer.sealStatus` reads "Waiting to
   seal" and `developer.uploadQueueCount` reads 1. The server log has no
   `evidence upload urls issued` line.
4. Turn `developer.simulateOfflineToggle` off. Within a few seconds
   `developer.sealStatus` reads "Uploaded, waiting to seal" and
   `developer.uploadQueueCount` reads 0.
5. In `.e2e/logs/server-ios.log`: `rental created`, `evidence upload urls
   issued` (`items: 1`, `created: 1`), and `evidence received` with the
   `itemId` and `bytes`; access lines with
   `route: "/v1/rentals/:id/evidence/:itemId/complete"` and status 200.
   The `itemId` there is the lowercased UUID of the photo; the hash in
   `developer.lastCaptureHash` is what the server matched.

`ios/FinePrintTests/UploadQueueTests.swift` (Swift Testing) covers the
three-step upload, persistence and file protection across a relaunch,
offline then reconnect, backoff, foreground retry, expired URLs, hash
mismatches (server 422 and Storage 400), a rental without a server ID,
a missing original, and the request shapes (`EvidenceAPITests`).

## Proof

`developer.sealStatus` going from "Waiting to seal" to "Uploaded, waiting
to seal" after the offline switch is turned off, with the matching
`evidence received` line in `server-ios.log`.

## Charters

```
upload-offline|ios|skeptic|With Simulate Offline on, keep several photos, relaunch the app, then turn Simulate Offline off; report any photo that never reaches "Uploaded, waiting to seal" or uploads twice
upload-status|ios|skeptic|Keep a photo, then leave and reopen Developer Options and background and foreground the app while it uploads; report any seal status that is wrong, stuck, or not announced by VoiceOver
```

## Gotchas

- Uploads run only while the app is open: a photo kept just before the
  app is closed goes out at the next launch.
- Files have complete protection, so nothing can upload while the phone is
  locked; the queue retries later.
- The pill on the review screen is always "Waiting to seal": the photo is
  not queued until Use Photo, and the screen closes then.
- `-FinePrintInMemoryStore` puts photos and the queue in a temporary
  folder, so a relaunch with it starts with an empty queue.
