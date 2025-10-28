# Tooling Setup Guide

This document describes the build tooling infrastructure for Serenity Blocks.

---

## Overview

As part of **Phase 1 · Assessment & Tooling**, the project has been migrated from CDN-based Phaser to a modern ES module workflow using:

- **Vite** — Fast development server and optimized build pipeline
- **ESLint** — Code quality enforcement with Airbnb-style rules
- **Prettier** — Consistent code formatting

---

## Installation

Install all dependencies:

```bash
npm install
```

This will install:
- `phaser` (v3.80.1) — Phaser 3 game framework
- `vite` — Build tool and dev server
- `eslint` + Airbnb config — Linting
- `prettier` — Code formatting

---

## Available Scripts

### Development

```bash
npm run dev
```

Starts the Vite development server at `http://localhost:3000` with hot module replacement (HMR).

### Production Build

```bash
npm run build
```

Creates an optimized production build in the `dist/` directory with:
- Code minification
- Source maps
- Phaser extracted as separate chunk for caching
- Asset optimization

### Preview Production Build

```bash
npm run preview
```

Serves the production build locally for testing before deployment.

### Code Quality

```bash
npm run lint          # Check for linting errors
npm run lint:fix      # Auto-fix linting errors
npm run format        # Format all code with Prettier
npm run format:check  # Check formatting without modifying files
```

---

## Configuration Files

### `vite.config.js`

- **Base path**: Set to `./` for relative asset loading
- **Dev server**: Runs on port 3000 with auto-open
- **Build optimization**: Extracts Phaser as separate chunk
- **Path aliases**: Configured for cleaner imports:
  - `@/` → `src/`
  - `@core/` → `src/core/`
  - `@rendering/` → `src/rendering/`
  - `@themes/` → `src/themes/`
  - `@ui/` → `src/ui/`
  - `@utils/` → `src/utils/`
  - `@events/` → `src/events/`

### `.eslintrc.json`

- **Base**: Airbnb style guide (tuned for game development)
- **Key rules**:
  - 4-space indentation
  - Console statements allowed
  - `++` operator allowed (common in game loops)
  - Max line length: 120 characters (warning only)
  - For-of loops allowed (but not for-in)
- **Globals**: `Phaser` marked as readonly

### `.prettierrc`

- **Style**: Single quotes, semicolons, 4-space tabs
- **Line width**: 100 characters
- **Integration**: Works alongside ESLint (no conflicts)

---

## Migration from CDN

**Before (CDN):**
```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<script type="module" src="../src/main.js"></script>
```

**After (ES Module):**
```html
<script type="module" src="../src/main.js"></script>
```

Phaser is now imported directly in JavaScript:
```javascript
import Phaser from 'phaser';
```

Vite handles bundling, tree-shaking, and optimization automatically.

---

## File Structure

```
serenity-blocks/
├── public/              # Static assets (HTML, CSS, fonts)
│   ├── index.html       # Entry HTML (loads Vite-bundled main.js)
│   └── styles/          # CSS stylesheets
├── src/                 # Source code (ES modules)
│   ├── main.js          # Application entry point
│   ├── core/            # Game logic
│   ├── rendering/       # Rendering systems
│   │   └── phaser/      # Phaser-specific code
│   │       └── utils/   # Shared Phaser utilities
│   ├── themes/          # Theme system
│   ├── ui/              # UI components
│   ├── events/          # Event system
│   └── utils/           # General utilities
├── dist/                # Production build output (generated)
├── node_modules/        # Dependencies (generated)
├── package.json         # Project metadata and scripts
├── vite.config.js       # Vite configuration
├── .eslintrc.json       # ESLint configuration
├── .prettierrc          # Prettier configuration
└── .gitignore           # Git ignore rules
```

---

## Development Workflow

1. **Start development server:**
   ```bash
   npm run dev
   ```

2. **Make changes** — Vite will hot-reload automatically

3. **Run linting** (optional but recommended):
   ```bash
   npm run lint
   ```

4. **Format code** before committing:
   ```bash
   npm run format
   ```

5. **Build for production:**
   ```bash
   npm run build
   ```

6. **Preview production build:**
   ```bash
   npm run preview
   ```

---

## Best Practices

1. **Import Phaser explicitly** in files that use it:
   ```javascript
   import Phaser from 'phaser';
   ```

2. **Use path aliases** for cleaner imports:
   ```javascript
   // Good
   import { ensureCircleTexture } from '@rendering/phaser/utils/index.js';

   // Avoid
   import { ensureCircleTexture } from '../../../rendering/phaser/utils/index.js';
   ```

3. **Run linter before committing** to catch issues early

4. **Keep utilities side-effect free** — Functions in `src/rendering/phaser/utils/` should operate on provided scene instances

---

## Next Steps

With the tooling infrastructure complete, **Phase 1 · Assessment & Tooling** is finished.

Proceed to **Phase 2 · Core Rendering Platform**:
- Create base Phaser scene architecture
- Migrate multiplayer board rendering from canvas to Phaser
- Expand shared utility modules as needed

---

## Troubleshooting

### Port 3000 already in use
Change the port in `vite.config.js`:
```javascript
server: {
  port: 3001, // or any available port
}
```

### ESLint errors on existing code
Run auto-fix first:
```bash
npm run lint:fix
```

For rules that don't fit your style, adjust `.eslintrc.json`.

### Module not found errors
Ensure dependencies are installed:
```bash
npm install
```

Check that path aliases in `vite.config.js` match your file structure.
