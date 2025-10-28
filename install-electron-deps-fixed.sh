#!/bin/bash
# Install Electron dependencies for Ubuntu 24.04 (Noble) / WSL

echo "🔧 Installing Electron dependencies for Ubuntu 24.04..."
echo ""

# Update package lists
sudo apt-get update

echo ""
echo "📦 Installing core dependencies..."
echo ""

# Install dependencies (using correct package names for Ubuntu 24.04)
sudo apt-get install -y \
    libnspr4 \
    libnss3 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libgtk-3-0t64 \
    libgdk-pixbuf-2.0-0 \
    libxss1 \
    libx11-xcb1

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All dependencies installed successfully!"
    echo ""
    echo "Now run: npm run dev:electron"
else
    echo ""
    echo "❌ Some packages failed to install."
    echo "Try running manually: sudo apt-get install -f"
fi

