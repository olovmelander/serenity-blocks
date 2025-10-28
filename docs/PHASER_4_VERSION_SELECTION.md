# Phaser 4 Version Selection

**Date:** October 15, 2025  
**Decision:** Selecting Phaser 4 version for Serenity Blocks migration

---

## 📦 Phaser 4 Package Information

### Package Names
- **Phaser 3:** `phaser` (npm package)
- **Phaser 4:** `phaser` (v4.x.x and above on npm)

### Versioning
Phaser 4 follows semantic versioning starting from 4.0.0+.

---

## 🎯 Selected Version

**Target Version:** `phaser@^4.0.0` (latest stable 4.x release)

### Rationale
1. **Stability:** Use latest stable 4.x release for production
2. **Features:** Access to all Phaser 4 improvements
3. **Support:** Active community and documentation
4. **Compatibility:** Modern browsers only (WebGL required)

---

## 📍 CDN vs NPM Decision

### Selected Approach: **NPM Package** (Bundled with Vite)

**Reasons:**
1. **Build Integration:** Already using Vite, better to bundle Phaser 4
2. **Version Control:** Package.json provides explicit version pinning
3. **Performance:** Single bundled file, no external CDN dependency
4. **TypeScript:** Access to type definitions if needed
5. **Offline Development:** No network dependency for development

### CDN Fallback (if needed)
```html
<!-- Phaser 4 CDN (jsDelivr) -->
<script src="https://cdn.jsdelivr.net/npm/phaser@^4.0.0/dist/phaser.min.js"></script>
```

---

## 🔧 Migration Steps

### Step 1: Update package.json
```json
{
  "dependencies": {
    "phaser": "^4.0.0"
  }
}
```

### Step 2: Update Vite Config
Ensure Vite optimizes Phaser 4:
```javascript
// vite.config.js
export default {
  optimizeDeps: {
    include: ['phaser']
  }
}
```

### Step 3: Update main.js Imports
```javascript
// Before (Phaser 3 via CDN)
const PhaserRef = window.Phaser;

// After (Phaser 4 via NPM)
import Phaser from 'phaser';
const PhaserRef = Phaser;
```

### Step 4: Remove CDN Script Tag
Remove from `public/index.html`:
```html
<!-- DELETE THIS -->
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
```

---

## ⚠️ Important Notes

1. **Node.js Required:** NPM approach requires Node.js and npm installed for `npm install`
2. **Bundle Size:** Phaser 4 will increase bundle size (~1-2MB minified)
3. **Build Time:** First build will be slower while Vite optimizes Phaser
4. **Dev Server:** Must run `npm install` before `npm run dev`

---

## 🔄 Rollback Plan

If Phaser 4 causes issues:
1. Revert package.json to `"phaser": "^3.80.1"`
2. Run `npm install`
3. Restore CDN script tag in HTML
4. Restore original imports in main.js

---

## 📝 Next Steps

1. ✅ Document version selection
2. ⏭️ Update package.json
3. ⏭️ Update Vite config
4. ⏭️ Remove HTML CDN script tag
5. ⏭️ Update import statements in source files
6. ⏭️ Test build process
7. ⏭️ Verify Phaser 4 loads correctly

---

**Status:** Decision Made - Ready for Implementation  
**Next Action:** Update package.json to Phaser 4

