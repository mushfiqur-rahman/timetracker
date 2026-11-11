#!/bin/bash
# Builds dist/TimeTracker.app and dist/TimeTracker-mac.zip. Needs a Mac with Xcode (or the Xcode command line tools).
set -euo pipefail
cd "$(dirname "$0")"

if swift build -c release --arch arm64 --arch x86_64; then
  BIN=.build/apple/Products/Release/TimeTracker        # universal: Apple Silicon + Intel
else
  echo "Universal build not available, building for this Mac only"
  swift build -c release
  BIN=.build/release/TimeTracker
fi

APP=dist/TimeTracker.app
rm -rf dist
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/TimeTracker"
cp Info.plist "$APP/Contents/Info.plist"

ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign - "$APP"     # ad-hoc signature (required on Apple Silicon)
(cd dist && ditto -c -k --keepParent TimeTracker.app TimeTracker-mac.zip)
echo "Built $APP"
