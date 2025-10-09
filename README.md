# Serenity Blocks

A meditative Tetris-inspired game with beautiful themes and ambient music.

## 🚀 Quick Start

### Run Locally

```bash
# Option 1: Use the serve script (easiest)
./serve.sh

# Option 2: Manual server start
python3 -m http.server 8000

# Then open in your browser:
# http://localhost:8000/
```

The root URL automatically redirects to the game!

## 📁 Project Structure

```
/workspaces/quadra/
├── index.html          # Auto-redirects to public/index.html
├── serve.sh           # Development server script
├── public/            # 🎯 Game files (ready for deployment)
│   ├── index.html
│   ├── styles/main.css
│   └── assets/music/  # 28 ambient tracks
├── src/               # Source code (ES6 modules)
│   ├── main.js
│   ├── core/
│   ├── rendering/
│   ├── audio/
│   ├── themes/
│   └── ui/
├── tests/             # Integration & unit tests
├── legacy/            # Old monolithic files (archived)
└── docs/              # Documentation
```

## 🎮 Features

- **Modular ES6 Architecture** - Clean, maintainable code structure
- **40+ Visual Themes** - From forests to galaxies to zen gardens
- **28 Ambient Music Tracks** - Curated for relaxation and focus
- **Theme-Linked Music** - Music automatically changes with themes
- **WebGL Rendering** - Smooth, optimized graphics
- **Customizable Controls** - DAS settings, key remapping, and more
- **High Score System** - Track your progress

## 🧪 Testing

```bash
# Run integration tests
python3 -m http.server 8000
# Then open: http://localhost:8000/tests/integration.html
```

## 📖 Documentation

See the [docs/](docs/) folder for:
- [FINAL_MIGRATION_PLAN.md](docs/FINAL_MIGRATION_PLAN.md) - Architecture overview
- Additional documentation

## 🛠️ Development

The codebase uses:
- **ES6 Modules** for clean separation of concerns
- **Web Audio API** for sound and music
- **WebGL** for high-performance rendering
- **Canvas API** for UI elements

## 📦 Deployment

Deploy the `public/` folder to your web server. Make sure to:
- Serve from the `public/` directory as root, OR
- Keep the current structure and serve from project root

## 📝 License

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
