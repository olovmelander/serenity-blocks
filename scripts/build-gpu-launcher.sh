#!/bin/bash
# Build the GPU preference launcher for Windows
# Requires: mingw-w64 (install with: sudo apt-get install mingw-w64)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/electron"

echo "Building GPU preference launcher..."

# Check if mingw is installed
if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
    echo "ERROR: mingw-w64 is not installed."
    echo "Install it with: sudo apt-get install mingw-w64"
    exit 1
fi

# Compile the launcher
x86_64-w64-mingw32-gcc \
    -o "$OUTPUT_DIR/SerenityBlocksLauncher.exe" \
    "$OUTPUT_DIR/gpu-preference-launcher.c" \
    -mwindows \
    -O2 \
    -static

if [ $? -eq 0 ]; then
    echo "Successfully built: $OUTPUT_DIR/SerenityBlocksLauncher.exe"
    echo ""
    echo "The launcher exports GPU preference symbols for NVIDIA/AMD"
    echo "to automatically use the discrete high-performance GPU."
else
    echo "Build failed!"
    exit 1
fi
