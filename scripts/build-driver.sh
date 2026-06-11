#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/driver/SimDriverHost/SimDriverHost.xcodeproj"
SCHEME="SimDriverUITests"
BUILD_DIR="$ROOT/build/driver"
DERIVED="$BUILD_DIR/DerivedData"

DEVICE_NAME="${SIM_DEVICE_NAME:-iPhone 17 Pro}"
DESTINATION="platform=iOS Simulator,name=${DEVICE_NAME}"

mkdir -p "$BUILD_DIR"

echo "Building XCUITest driver for ${DEVICE_NAME}..."
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED" \
  -quiet \
  build-for-testing

XCTESTRUN=$(find "$DERIVED/Build/Products" -maxdepth 1 -name "*.xctestrun" | head -1)
if [[ -z "$XCTESTRUN" ]]; then
  echo "error: no .xctestrun produced" >&2
  exit 1
fi

cat > "$BUILD_DIR/driver-info.json" <<EOF
{
  "xctestrun": "$XCTESTRUN",
  "derivedData": "$DERIVED",
  "deviceName": "$DEVICE_NAME",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Driver built: $XCTESTRUN"
