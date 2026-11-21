#!/usr/bin/env bash
# Copy the web app into the Swift Playgrounds package so the iPad app bundles it.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf ios/AlphaPad.swiftpm/Web
cp -R web ios/AlphaPad.swiftpm/Web
echo "Synced web/ -> ios/AlphaPad.swiftpm/Web"
