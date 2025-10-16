#!/bin/bash

echo "🎮 Serenity Blocks - Vite Dev Server"
echo "======================================"
echo ""

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Check Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    echo "   Run: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules not found. Running npm install..."
    npm install
    echo ""
fi

# Check if Vite is installed
if [ ! -f "node_modules/vite/bin/vite.js" ]; then
    echo "❌ Vite not found. Please run: npm install"
    exit 1
fi

echo "🚀 Starting Vite dev server..."
echo "   📍 Local:   http://localhost:3000/"
echo "   📍 Network: Available on your local IP"
echo ""
echo "📝 Features:"
echo "   ✅ Hot Module Replacement (HMR)"
echo "   ✅ ES Module imports"
echo "   ✅ Phaser 4.0.0-rc.5 ready"
echo ""
echo "Press Ctrl+C to stop the server"
echo "======================================"
echo ""

# Start Vite
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000

