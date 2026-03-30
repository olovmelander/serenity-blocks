# Serenity Blocks - Public Directory

This directory contains all the files needed to run Serenity Blocks.

## 📁 Structure

```
public/
├── index.html              # Main game entry point
├── styles/
│   └── main.css           # Main stylesheet
└── assets/
    ├── music/             # Music files and songs.json
    └── images/            # Game images
```

## 🚀 Running the Game

### Option 1: From Project Root (Recommended)
```bash
# From /workspaces/quadra/
python3 -m http.server 8000

# Or use the provided script:
./serve.sh

# Then open: http://localhost:8000/
# (Auto-redirects to public/index.html)
```

### Option 2: Directly from Public Folder
```bash
# Navigate to public folder
cd public

# Start server
python3 -m http.server 8000

# Then open: http://localhost:8000/
```

**Note:** If serving from the `public/` folder directly, you'll need to update paths in:
- `../src/audio/music-loader.js` (remove `/public/` prefix from paths)
- `assets/music/songs.json` (remove `/public/` prefix from all paths)

## 🔗 Related Directories

- **`../src/`** - Source code (ES6 modules)
- **`../tests/`** - Integration and unit tests
- **`../legacy/`** - Legacy files (for reference only)
- **`../docs/`** - Documentation

## 📝 Path Configuration

The current setup assumes you're serving from the project root. All asset paths use `/public/assets/` prefix.

If you deploy this folder to a web server:
- Either serve from a subdirectory called `public/`
- Or update the paths to remove `/public/` prefix
