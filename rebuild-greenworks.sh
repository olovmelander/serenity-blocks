#!/bin/bash

echo "🔧 Rebuilding Greenworks for Electron..."

# Install electron-rebuild if not present
if [ ! -d "node_modules/.bin/electron-rebuild" ]; then
    echo "📦 Installing electron-rebuild..."
    npm install --save-dev electron-rebuild
fi

# Rebuild greenworks
echo "🔨 Compiling Greenworks binary..."
./node_modules/.bin/electron-rebuild -f -w greenworks

if [ $? -eq 0 ]; then
    echo "✅ Greenworks rebuilt successfully!"
    echo "You may now run 'npm run dev:electron'"
else
    echo "❌ Failed to rebuild Greenworks."
    echo "Make sure you have build tools installed (build-essential on Linux, Visual Studio on Windows)."
fi
