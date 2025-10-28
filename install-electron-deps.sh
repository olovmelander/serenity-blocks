#!/bin/bash
# Install Electron dependencies for WSL/Linux

echo "🔧 Installing Electron dependencies for WSL/Linux..."
echo ""

# Update package lists
sudo apt-get update

# Install required libraries
sudo apt-get install -y \
    libnspr4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    libxss1

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "Now run: npm run dev:electron"

