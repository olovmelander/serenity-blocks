# Final Migration Plan - Complete Folder Structure

## Overview

This document outlines the final step: migrating remaining files into a clean, production-ready folder structure. Currently, most modular code is in `src/`, but some files remain in the root directory.

## Current State vs. Target State

### Current Structure (Partially Migrated)
```
/workspaces/quadra/
├── src/                           ✅ Modular JavaScript (complete!)
│   ├── main.js
│   ├── core/
│   ├── rendering/
│   ├── ui/
│   ├── audio/
│   ├── themes/
│   └── utils/
├── index.html                     ⚠️ In root (needs updating)
├── style.css                      ⚠️ In root (should move to styles/)
├── renderer.js                    ⚠️ Legacy (replaced by src/rendering/renderer.js)
├── script.js                      ⚠️ Legacy (replaced by src/main.js)
├── songs/                         ⚠️ In root (should move to public/assets/)
│   ├── Ambient.mp3
│   ├── Focus.mp3
│   └── ...
├── styles/                        ⚠️ Exists but empty (should contain CSS)
│   └── CSS_ORGANIZATION_GUIDE.md
├── test-integration.html          ✅ Test file (ok in root)
└── [Documentation files]          ✅ Good in root
```

### Target Structure (Production-Ready)
```
/workspaces/quadra/
├── public/                        # Public-facing files
│   ├── index.html                 # Main entry point
│   ├── assets/                    # Static assets
│   │   ├── music/                 # Audio files
│   │   │   ├── Ambient.mp3
│   │   │   ├── Focus.mp3
│   │   │   ├── Meditation.mp3
│   │   │   └── ...
│   │   └── images/                # Future: images, icons
│   │       └── favicon.ico
│   └── styles/                    # CSS files
│       └── main.css               # Main stylesheet (renamed from style.css)
├── src/                           # Source code (ES6 modules)
│   ├── main.js                    # Application entry point
│   ├── core/                      # Game logic
│   │   ├── constants.js
│   │   ├── game.js
│   │   ├── pieces.js
│   │   ├── board.js
│   │   ├── scoring.js
│   │   └── physics.js
│   ├── rendering/                 # Display
│   │   ├── renderer.js
│   │   ├── canvas-utils.js
│   │   ├── draw.js
│   │   └── webgl/
│   ├── ui/                        # User interface
│   │   ├── modals.js
│   │   ├── settings.js
│   │   ├── controls.js
│   │   └── high-scores.js
│   ├── audio/                     # Sound system
│   │   ├── sound-manager.js
│   │   ├── music-loader.js
│   │   └── sound-effects.js
│   ├── themes/                    # Theme system
│   │   ├── base-theme.js
│   │   ├── theme-manager.js
│   │   └── [41 theme folders]/
│   └── utils/                     # Helpers
│       ├── helpers.js
│       └── cache.js
├── tests/                         # Test files (optional)
│   └── integration.html           # Renamed from test-integration.html
├── docs/                          # Documentation (optional)
│   ├── REORGANIZATION_STATUS.md
│   ├── PHASE_4_COMPLETION_SUMMARY.md
│   ├── PHASE_5_COMPLETION_SUMMARY.md
│   ├── REORGANIZATION_COMPLETE.md
│   └── FINAL_MIGRATION_PLAN.md
├── legacy/                        # Old files (for reference)
│   ├── script.js                  # Original monolithic JS
│   ├── renderer.js                # Original renderer
│   └── README.md                  # Explains legacy files
├── README.md                      # Project readme
├── package.json                   # Optional: if using npm/build tools
└── .gitignore                     # Git ignore file
```

---

## Detailed Migration Steps

### Step 1: Create New Folder Structure

```bash
# From /workspaces/quadra/

# Create public directory structure
mkdir -p public/assets/music
mkdir -p public/assets/images
mkdir -p public/styles

# Create tests directory (optional)
mkdir -p tests

# Create docs directory (optional)
mkdir -p docs

# Create legacy directory
mkdir -p legacy
```

### Step 2: Move HTML Files

#### A. Move and Update index.html

**Move:**
```bash
mv index.html public/index.html
```

**Update paths in `public/index.html`:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Serenity Blocks</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">

    <!-- Updated CSS path -->
    <link rel="stylesheet" href="./styles/main.css">
</head>
<body>
    <!-- ... all existing HTML content ... -->

    <!-- Updated script path - relative to public/ -->
    <script type="module" src="../src/main.js"></script>

    <!-- Legacy scripts (commented out) -->
    <!-- <script src="../legacy/renderer.js"></script> -->
    <!-- <script src="../legacy/script.js"></script> -->
</body>
</html>
```

**Key Changes:**
- CSS: `href="style.css"` → `href="./styles/main.css"`
- JS: `src="./src/main.js"` → `src="../src/main.js"` (relative from public/)

#### B. Update Test File (Optional)

```bash
mv test-integration.html tests/integration.html
```

Update paths in `tests/integration.html`:
```html
<!-- Update module import -->
<script type="module" src="../src/main.js"></script>
```

### Step 3: Move CSS Files

```bash
# Move main stylesheet
mv style.css public/styles/main.css

# Keep CSS_ORGANIZATION_GUIDE.md in styles/ folder at root
# (It's documentation, not a public asset)
```

**Note:** No changes needed to CSS content itself - all paths are relative or absolute.

### Step 4: Move Audio Files

```bash
# Move all music files
mv songs/* public/assets/music/
rmdir songs
```

**Update `src/audio/sound-manager.js` music paths:**

Find this line (around line 20-30):
```javascript
this.musicPath = 'songs/';
```

Change to:
```javascript
this.musicPath = '/assets/music/';
```

Or if using relative paths from public/:
```javascript
this.musicPath = './assets/music/';
```

### Step 5: Move Legacy Files

```bash
# Move old monolithic files to legacy
mv script.js legacy/script.js
mv renderer.js legacy/renderer.js

# Create README in legacy folder
cat > legacy/README.md << 'EOF'
# Legacy Files

This folder contains the original monolithic code before reorganization.

## Files

- **script.js** (373KB) - Original monolithic JavaScript file containing all game logic, themes, audio, and UI
- **renderer.js** - Original WebGL renderer (now in src/rendering/renderer.js)

## Status

These files are **kept for reference only** and are **no longer used** by the application.

The modular replacements are in the `src/` directory.

## Why Keep Them?

- Historical reference
- Fallback if issues arise during migration
- Code archaeology (understanding old decisions)
- Can be deleted after successful production deployment

## Migration

See `/docs/REORGANIZATION_COMPLETE.md` for full migration details.
EOF
```

### Step 6: Move Documentation (Optional)

```bash
# Move documentation to docs folder (optional, keeps root clean)
mv REORGANIZATION_STATUS.md docs/
mv PHASE_4_COMPLETION_SUMMARY.md docs/
mv PHASE_5_PROGRESS_SUMMARY.md docs/
mv PHASE_5_COMPLETION_SUMMARY.md docs/
mv REORGANIZATION_COMPLETE.md docs/
mv FINAL_MIGRATION_PLAN.md docs/
mv THEME_EXTRACTION_SUMMARY.md docs/

# Keep README.md in root
# It's the main entry point for the project
```

### Step 7: Update Module Import Paths

Since `index.html` is now in `public/`, and modules are in `src/`, we need to check import paths.

#### A. Check src/main.js imports

Most imports are relative within `src/`, so they should still work:

```javascript
// These are fine (relative within src/)
import { COLS, ROWS } from './core/constants.js';
import { GameState } from './core/game.js';
import { ThemeManager } from './themes/theme-manager.js';
```

#### B. Update audio paths in src/audio/sound-manager.js

```javascript
// Find this section in SoundManager constructor
constructor() {
    this.audioContext = null;
    this.musicSource = null;
    this.currentTrack = 'Ambient';

    // Update this path
    this.musicPath = '/assets/music/';  // Changed from 'songs/'

    // Or use relative from public root
    this.musicPath = './assets/music/';
}
```

### Step 8: Update index.html to Use Correct Paths

**Full updated `public/index.html`:**

Only these lines need changes:

```html
<!-- Line ~8: Update CSS -->
<link rel="stylesheet" href="./styles/main.css">

<!-- Line ~632: Update JS module -->
<script type="module" src="../src/main.js"></script>
```

### Step 9: Test the Migration

```bash
# From /workspaces/quadra/

# Start server from root
python3 -m http.server 8000

# Test URLs:
# Main app: http://localhost:8000/public/index.html
# Tests:    http://localhost:8000/tests/integration.html
```

**Checklist:**
- [ ] Page loads without errors
- [ ] CSS styles apply correctly
- [ ] Game canvas renders
- [ ] Music files load from new path
- [ ] Themes load and switch
- [ ] Settings persist
- [ ] High scores work
- [ ] All 41 themes functional

---

## Complete File Structure After Migration

```
/workspaces/quadra/
│
├── public/                              # Public-facing files (deploy this folder)
│   ├── index.html                       # Main entry point (updated paths)
│   ├── assets/
│   │   ├── music/                       # All music files
│   │   │   ├── Ambient.mp3
│   │   │   ├── Focus.mp3
│   │   │   ├── Meditation.mp3
│   │   │   └── [other tracks]
│   │   └── images/                      # Future: icons, sprites
│   │       └── favicon.ico
│   └── styles/
│       └── main.css                     # Main stylesheet (210KB)
│
├── src/                                 # Source code modules
│   ├── main.js                          # Entry point (20KB)
│   ├── core/                            # 7 files, ~55KB
│   │   ├── constants.js
│   │   ├── game.js
│   │   ├── pieces.js
│   │   ├── board.js
│   │   ├── scoring.js
│   │   └── physics.js
│   ├── rendering/                       # 4 files, ~30KB
│   │   ├── renderer.js
│   │   ├── canvas-utils.js
│   │   └── draw.js
│   ├── ui/                              # 4 files, ~52KB
│   │   ├── modals.js
│   │   ├── settings.js
│   │   ├── controls.js
│   │   └── high-scores.js
│   ├── audio/                           # 3 files, ~20KB
│   │   ├── sound-manager.js            # (UPDATE PATHS!)
│   │   ├── music-loader.js
│   │   └── sound-effects.js
│   ├── themes/                          # 43 files, ~200KB
│   │   ├── base-theme.js
│   │   ├── theme-manager.js
│   │   ├── forest/
│   │   │   └── forest-theme.js
│   │   ├── ocean/
│   │   │   └── ocean-theme.js
│   │   └── [39 more theme folders]
│   └── utils/                           # 2 files, ~3KB
│       ├── helpers.js
│       └── cache.js
│
├── tests/                               # Test files (optional)
│   └── integration.html                 # Integration tests
│
├── docs/                                # Documentation (optional)
│   ├── REORGANIZATION_STATUS.md
│   ├── PHASE_4_COMPLETION_SUMMARY.md
│   ├── PHASE_5_COMPLETION_SUMMARY.md
│   ├── REORGANIZATION_COMPLETE.md
│   ├── FINAL_MIGRATION_PLAN.md
│   └── CSS_ORGANIZATION_GUIDE.md
│
├── legacy/                              # Old monolithic files (reference)
│   ├── script.js                        # Original 373KB file
│   ├── renderer.js                      # Original renderer
│   └── README.md                        # Explains legacy files
│
├── styles/                              # Kept at root for CSS guide
│   └── CSS_ORGANIZATION_GUIDE.md        # Documentation only
│
├── README.md                            # Main project README
├── package.json                         # Optional: if using npm
├── .gitignore                           # Git ignore file
└── [Other config files]
```

---

## Server Configuration

### Option 1: Simple Python Server (Development)

```bash
# Start from project root
cd /workspaces/quadra
python3 -m http.server 8000

# Access at:
http://localhost:8000/public/index.html
```

### Option 2: Configure Server Root as public/ (Recommended)

**For Python:**
```bash
cd /workspaces/quadra/public
python3 -m http.server 8000

# Access at:
http://localhost:8000/index.html
# (cleaner URL!)
```

**For Node.js (http-server):**
```bash
npx http-server public -p 8000

# Access at:
http://localhost:8000/
```

**For Production (Nginx):**
```nginx
server {
    listen 80;
    server_name serenityblocks.example.com;

    root /var/www/serenity-blocks/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /styles/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Option 3: Update index.html Paths for Root Serving

If you want to keep serving from project root, update paths in `index.html`:

```html
<!-- In public/index.html -->
<link rel="stylesheet" href="./public/styles/main.css">
<script type="module" src="./src/main.js"></script>
```

---

## Path Reference Table

After migration, here's what points where:

| File | Old Path | New Path | Update In |
|------|----------|----------|-----------|
| **HTML** |
| Main page | `/index.html` | `/public/index.html` | N/A |
| **CSS** |
| Main styles | `/style.css` | `/public/styles/main.css` | `index.html` |
| **JavaScript** |
| Entry point | `/src/main.js` | `/src/main.js` (unchanged) | `index.html` |
| All modules | `/src/**/*.js` | `/src/**/*.js` (unchanged) | Module imports |
| **Audio** |
| Music files | `/songs/*.mp3` | `/public/assets/music/*.mp3` | `sound-manager.js` |
| **Legacy** |
| Old script | `/script.js` | `/legacy/script.js` | N/A (not used) |
| Old renderer | `/renderer.js` | `/legacy/renderer.js` | N/A (not used) |

---

## Code Changes Required

### 1. Update `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Serenity Blocks</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">

    <!-- CHANGE 1: Update CSS path -->
    <link rel="stylesheet" href="./styles/main.css">
</head>
<body>
    <!-- ... ALL EXISTING HTML CONTENT UNCHANGED ... -->

    <!-- CHANGE 2: Update module path -->
    <script type="module" src="../src/main.js"></script>
</body>
</html>
```

### 2. Update `src/audio/sound-manager.js`

Find the constructor (around line 10-30):

```javascript
constructor() {
    this.audioContext = null;
    this.musicSource = null;
    this.gainNode = null;
    this.sfxGainNode = null;
    this.currentBuffer = null;
    this.currentTrack = 'Ambient';
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseTime = 0;
    this.startTime = 0;

    // CHANGE: Update music path
    // OLD: this.musicPath = 'songs/';
    // NEW:
    this.musicPath = '/assets/music/';  // Absolute from server root
    // OR
    this.musicPath = '../assets/music/'; // Relative from src/

    this.musicVolume = 1.0;
    this.sfxVolume = 1.0;
    this.themeLinkedMode = false;
}
```

**Recommended:** Use absolute path from server root:
```javascript
this.musicPath = '/assets/music/';
```

This works regardless of where HTML is served from.

### 3. No Other Code Changes Needed!

All other module imports use relative paths within `src/`, so they continue to work.

---

## .gitignore Recommendations

Create `.gitignore` in project root:

```gitignore
# Dependencies
node_modules/

# Build output (if using build tools)
dist/
build/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Optional: Legacy files (if you don't want to commit them)
# legacy/

# Optional: Local test files
# tests/local/
```

---

## Deployment Guide

### For Static Hosting (Recommended)

**Netlify / Vercel / GitHub Pages:**

1. **Upload `public/` folder** as the site root
2. **Set build command:** None needed (static files)
3. **Set publish directory:** `public`

**Configuration:**
```json
// netlify.toml
[build]
  publish = "public"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### For Traditional Hosting

1. Upload entire project to server
2. Point web server root to `public/` folder
3. Ensure MIME types are correct for `.js` modules
4. Enable gzip compression for better performance

---

## Final Checklist

Before considering migration complete:

### File Operations
- [ ] Create `public/` directory structure
- [ ] Move `index.html` to `public/`
- [ ] Move `style.css` to `public/styles/main.css`
- [ ] Move `songs/` to `public/assets/music/`
- [ ] Move `script.js` and `renderer.js` to `legacy/`
- [ ] Move docs to `docs/` (optional)
- [ ] Move `test-integration.html` to `tests/` (optional)

### Code Updates
- [ ] Update CSS path in `index.html`
- [ ] Update JS module path in `index.html`
- [ ] Update music path in `src/audio/sound-manager.js`
- [ ] Add `legacy/README.md`

### Testing
- [ ] Page loads without 404 errors
- [ ] CSS styles render correctly
- [ ] JavaScript modules load
- [ ] Music files load and play
- [ ] All 41 themes load correctly
- [ ] Settings persist
- [ ] High scores work
- [ ] Touch controls work (mobile)
- [ ] Keyboard controls work

### Documentation
- [ ] Update README.md with new structure
- [ ] Update paths in documentation
- [ ] Create `.gitignore` file
- [ ] Add deployment instructions

### Optional Enhancements
- [ ] Add `package.json` if using npm
- [ ] Add build script (Vite/Webpack)
- [ ] Add favicon to `public/assets/images/`
- [ ] Add PWA manifest
- [ ] Add service worker for offline

---

## Summary

### What Moves Where

1. **`index.html`** → `public/index.html` (update paths)
2. **`style.css`** → `public/styles/main.css`
3. **`songs/*.mp3`** → `public/assets/music/*.mp3` (update sound-manager.js)
4. **`script.js`** → `legacy/script.js` (reference only)
5. **`renderer.js`** → `legacy/renderer.js` (reference only)
6. **`src/**/*.js`** → stays in `src/` (no changes)
7. **Documentation** → optionally to `docs/`

### What Changes in Code

1. **`public/index.html`:**
   - CSS: `href="./styles/main.css"`
   - JS: `src="../src/main.js"`

2. **`src/audio/sound-manager.js`:**
   - Music path: `this.musicPath = '/assets/music/';`

3. **Everything else:** No changes needed!

### Result

A clean, production-ready folder structure:
- `public/` - Deployable files
- `src/` - Source code (modular)
- `legacy/` - Old code (reference)
- `docs/` - Documentation
- `tests/` - Test files

---

**Ready to migrate!** Follow the steps above to complete the final folder organization.
