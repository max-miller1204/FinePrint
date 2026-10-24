#!/usr/bin/env bash
# Day-one smoke test for the iOS 26 APIs FinePrint depends on (issue #8, spec §21 item 7).
#
# 1. Typechecks ios/SwiftUIProbe.swift and ios/VisionProbe.swift against the
#    installed iOS simulator SDK at a 26.0 deployment target (must pass).
# 2. Typechecks the same files at 18.0 and records which APIs are gated to 26.
# 3. Builds VisionProbe for macOS and runs RecognizeDocumentsRequest on a
#    rendered lease image (must read every expected token).
#
# Usage: bash scripts/smoke/ios-capabilities.sh
# Exit codes: 0 all checks passed, 1 a check failed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
probe="$here/ios"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

ios_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
mac_sdk="$(xcrun --sdk macosx --show-sdk-path)"
echo "Xcode:     $(xcodebuild -version | tr '\n' ' ')"
echo "Swift:     $(xcrun swiftc --version 2>&1 | head -1)"
echo "iOS SDK:   $(xcrun --sdk iphonesimulator --show-sdk-version)"
echo "macOS SDK: $(xcrun --sdk macosx --show-sdk-version)"
echo

typecheck() { # target file...
  local target="$1"; shift
  xcrun swiftc -typecheck -swift-version 6 -parse-as-library -sdk "$ios_sdk" -target "$target" "$@" 2>&1
}

for file in SwiftUIProbe.swift VisionProbe.swift; do
  if out="$(typecheck arm64-apple-ios26.0-simulator "$probe/$file")"; then
    echo "[ok ] $file typechecks at iOS 26.0"
  else
    echo "[ERR] $file does not typecheck at iOS 26.0"; echo "$out"; fail=1
  fi
done

echo
echo "APIs gated to iOS 26 (typecheck at iOS 18.0):"
for file in SwiftUIProbe.swift VisionProbe.swift; do
  typecheck arm64-apple-ios18.0-simulator "$probe/$file" || true
done | grep -o "'[^']*' is only available in iOS [0-9.]* or newer" | sort -u | sed 's/^/  /' || true

echo
xcrun swiftc -parse-as-library -swift-version 6 -sdk "$mac_sdk" -target "$(uname -m)-apple-macos26.0" \
  "$probe/VisionProbe.swift" -o "$work/vision-probe"
if "$work/vision-probe"; then
  echo "[ok ] RecognizeDocumentsRequest runs"
else
  echo "[ERR] RecognizeDocumentsRequest probe failed"; fail=1
fi

echo
if [ "$fail" -eq 0 ]; then echo "PASS: iOS 26 APIs available"; else echo "FAIL"; fi
exit "$fail"
