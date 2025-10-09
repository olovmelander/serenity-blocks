#!/bin/bash

# Serenity Blocks - Development Server Script
# This script helps you run the game locally

echo "🎮 Serenity Blocks - Development Server"
echo "========================================"
echo ""

# Check if a port argument was provided
PORT=${1:-8000}

echo "📁 Current structure:"
echo "   /workspaces/quadra/           (project root)"
echo "   ├── index.html                (auto-redirect to public/)"
echo "   ├── public/                   (game files)"
echo "   │   ├── index.html            (main game)"
echo "   │   ├── styles/main.css"
echo "   │   └── assets/music/"
echo "   └── src/                      (ES6 modules)"
echo ""

echo "🚀 Starting HTTP server on port $PORT..."
echo ""
echo "Access the game at:"
echo "   🌐 http://localhost:$PORT/"
echo "   🌐 http://localhost:$PORT/public/index.html"
echo ""
echo "Run tests at:"
echo "   🧪 http://localhost:$PORT/tests/integration.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo "========================================"
echo ""

python3 -m http.server $PORT
