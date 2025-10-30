# Serenity Blocks - Performance Optimization Plan

## Executive Summary

This document outlines a comprehensive, phase-by-phase plan to optimize the performance of Serenity Blocks without changing its implementation or visual appearance. The game experiences performance degradation over time, particularly after theme switching or extended gameplay sessions. This plan addresses memory leaks, inefficient resource usage, and other performance bottlenecks.

**Target**: Achieve stable 60 FPS with < 5MB/hour memory growth during extended gameplay sessions.

---

## Quick Reference Guide

### Critical Issues (Fix First) 🚨
1. **Event Listener Leaks** → Phase 1 (All subsections)
   - SerenityHub: ~11 listeners per instance
   - GestureController: 6 listeners per instance
   - Renderer: Wi   ndow resize listener
   - Document: Multiple global listeners

2. **Theme Resource Leaks** → Phase 2.3
   - WebGL textures not deleted
   - Particle systems not disposed
   - GPU memory not freed

3. **Timer Leaks** → Phase 3.3
   - setInterval/setTimeout not cleared
   - Continues running after component destruction

### Phase Overview
- **Phase 1**: Event Listener Cleanup (HIGH PRIORITY - Week 1)
- **Phase 2**: Theme System Optimization (HIGH PRIORITY - Week 2)
- **Phase 3**: Animation & Timer Management (Week 3)
- **Phase 4**: DOM & Event Optimization (Week 4)
- **Phase 5**: Asset & Resource Management (Week 5)
- **Phase 6**: Memory Best Practices (Week 6)
- **Phase 7**: Monitoring & Debugging Tools (Week 7)
- **Sprint 8**: Final Validation (Week 8)

### Most Impactful Optimizations
1. ✅ Fix SerenityHub event listener cleanup → **~75% of memory leak**
2. ✅ Implement WebGL resource disposal → **GPU memory stability**
3. ✅ Add timer tracking and cleanup → **CPU usage reduction**
4. ✅ Throttle high-frequency events → **60-80% CPU reduction**
5. ✅ Implement asset caching with LRU eviction → **Eliminate duplicate loads**

### Testing Priority
1. 🔥 Theme Switch Stress Test (50+ switches)
2. 🔥 Extended Gameplay Session (3+ hours)
3. 🔥 Combined Stress Test (all actions)
4. Hub Toggle Test (100+ opens/closes)
5. Mode Switching Test (30+ switches)

---

## Problem Analysis

### Symptoms
- Game starts smoothly with no lag
- Performance degrades noticeably after:
  - Switching themes multiple times (most critical)
  - Extended gameplay sessions (>30 minutes)
  - Opening/closing Serenity Hub repeatedly
  - Mode switching (Serenity Mode ↔ other modes)
  - Rapid user interactions (clicking, gestures)
- Memory usage grows continuously instead of stabilizing
- Frame rate drops from 60 FPS to 30-40 FPS over time
- Increased garbage collection pauses causing stuttering

### Root Causes Identified
1. **Event listener accumulation** - Global listeners never removed (PRIMARY ISSUE)
2. **Missing cleanup methods** - Some UI components lack proper destruction
3. **Theme resource leakage** - Incomplete theme cleanup on switch (CRITICAL)
4. **Animation frame leaks** - Potential for animation loops not being cancelled
5. **DOM element accumulation** - Elements not properly removed from memory
6. **WebGL context leaks** - GPU resources not being freed on theme switch
7. **Closure memory retention** - Event handlers holding references to large objects
8. **Inefficient re-renders** - Unnecessary DOM operations on each frame
9. **Timer leaks** - setInterval/setTimeout not being cleared
10. **Asset duplication** - Same resources loaded multiple times without caching

---

## Phase 1: Critical Memory Leak Fixes (High Priority)

### **Objective**: Fix critical event listener leaks that accumulate over time

### Phase 1.1: SerenityHub Event Listener Cleanup

**Issue**: [SerenityHub.js](src/ui/serenity-hub/SerenityHub.js) attaches multiple global event listeners that are never removed.

**Files Affected**:
- `src/ui/serenity-hub/SerenityHub.js`

**Specific Problems**:
- Line 88-109: Hub icon event listeners (click, keydown, mouseenter, mouseleave) - attached directly as arrow functions
- Line 121: Backdrop click listener
- Line 195: Close button click listener
- Line 198: Panel click listener
- Line 213-226: Tab click and keydown listeners
- Line 229-233: Document-level ESC key listener (global)
- Line 236-243: Panel mouseenter/mouseleave listeners
- Line 252-264: Document-level mousemove listener (global) - **CRITICAL LEAK**

**Solution**:
1. Store all event listeners as class methods (not arrow functions)
2. Track all bound handlers in a registry
3. In `destroy()` method (lines 697-734):
   - Currently only removes `mousemove` listener incorrectly (line 709)
   - Add proper removal for ALL listeners
4. Create handler references for:
   ```javascript
   this.hubIconClickHandler
   this.hubIconKeydownHandler
   this.hubIconMouseEnterHandler
   this.hubIconMouseLeaveHandler
   this.backdropClickHandler
   this.closeBtnClickHandler
   this.panelClickHandler
   this.documentKeydownHandler
   this.documentMouseMoveHandler
   this.panelMouseEnterHandler
   this.panelMouseLeaveHandler
   ```

**Expected Impact**: Prevent ~11 event listeners from accumulating each time Serenity Hub is created/destroyed.

---

### Phase 1.2: GestureController Event Listener Cleanup

**Issue**: [GestureController.js](src/ui/serenity-hub/GestureController.js) has a `destroy()` method (lines 285-302) but passes wrong function references when removing listeners.

**Files Affected**:
- `src/ui/serenity-hub/GestureController.js`

**Specific Problems**:
- Lines 67-74: Event listeners added with inline arrow functions
- Lines 288-293: `destroy()` tries to remove listeners but passes method references instead of the original bound functions
- This causes `removeEventListener` to fail silently (different function references)

**Solution**:
1. In constructor, bind all handler methods and store references:
   ```javascript
   this.handleTouchStartBound = this.handleTouchStart.bind(this);
   this.handleTouchMoveBound = this.handleTouchMove.bind(this);
   this.handleTouchEndBound = this.handleTouchEnd.bind(this);
   this.handleMouseDownBound = this.handleMouseDown.bind(this);
   this.handleMouseMoveBound = this.handleMouseMove.bind(this);
   this.handleMouseUpBound = this.handleMouseUp.bind(this);
   ```

2. Use these bound references when adding listeners (lines 67-74)

3. Use the SAME bound references when removing in `destroy()` (lines 288-293)

**Expected Impact**: Properly clean up 6 event listeners per GestureController instance.

---

### Phase 1.3: Renderer Window Resize Listener Cleanup

**Issue**: [renderer.js](src/rendering/renderer.js:704) adds window resize listener but never removes it.

**Files Affected**:
- `src/rendering/renderer.js`

**Specific Problems**:
- Line 704: `window.addEventListener('resize', () => this.resize());` - arrow function, no reference stored
- No cleanup in `stop()` method (lines 785-793) or elsewhere

**Solution**:
1. Store resize handler as class property:
   ```javascript
   this.resizeHandler = this.resize.bind(this);
   ```

2. Use stored handler when adding listener (line 704):
   ```javascript
   window.addEventListener('resize', this.resizeHandler);
   ```

3. Add cleanup method or extend `stop()` to remove listener:
   ```javascript
   cleanup() {
       this.stop();
       window.removeEventListener('resize', this.resizeHandler);
       // ... other cleanup
   }
   ```

4. Ensure cleanup is called when renderer is destroyed

**Expected Impact**: Remove 1 window resize listener that persists across theme switches.

---

### Phase 1.4: Tab Event Listener Cleanup in SerenityHub

**Issue**: Tab buttons in SerenityHub panel have listeners attached but not properly tracked for cleanup.

**Files Affected**:
- `src/ui/serenity-hub/SerenityHub.js`

**Specific Problems**:
- Lines 211-226: `querySelectorAll('.hub-tab')` returns NodeList, listeners added to each tab
- Arrow functions used, no references stored
- No cleanup when hub is destroyed

**Solution**:
1. Store tab elements and their handlers:
   ```javascript
   this.tabElements = [];
   this.tabHandlers = new Map();
   ```

2. Track each tab's click and keydown handlers

3. In `destroy()`, iterate and remove all tab listeners:
   ```javascript
   this.tabElements.forEach(tab => {
       const handlers = this.tabHandlers.get(tab);
       tab.removeEventListener('click', handlers.click);
       tab.removeEventListener('keydown', handlers.keydown);
   });
   ```

**Expected Impact**: Remove 6 listeners (3 tabs × 2 event types) per SerenityHub lifecycle.

---

### Phase 1.5: Tab Instance Cleanup Verification

**Issue**: Tab instances (BreathingTab, MusicTab, ThemesTab) may not always have their `destroy()` methods called.

**Files Affected**:
- `src/ui/serenity-hub/SerenityHub.js` (lines 722-731)
- `src/ui/serenity-hub/MusicTab.js`
- `src/ui/serenity-hub/BreathingTab.js`
- `src/ui/serenity-hub/ThemesTab.js`

**Current State**:
- Lines 722-731 in SerenityHub.destroy() call `destroy?.()` on tab instances (optional chaining)
- MusicTab has a `destroy()` method
- Need to verify BreathingTab and ThemesTab also have cleanup

**Solution**:
1. Audit all tab classes to ensure they have `destroy()` methods
2. Ensure each tab's `destroy()` removes all event listeners
3. Make destroy calls non-optional (log warning if missing):
   ```javascript
   if (this.breathingTab && typeof this.breathingTab.destroy === 'function') {
       this.breathingTab.destroy();
   } else if (this.breathingTab) {
       console.warn('[SerenityHub] BreathingTab missing destroy method');
   }
   ```

**Expected Impact**: Ensure complete cleanup of all tab resources.

---

## Phase 2: Theme System Optimization (Medium Priority)

### **Objective**: Prevent theme resource leaks and optimize theme switching

### Phase 2.1: Theme Instance Lifecycle Audit

**Issue**: Theme instances are cached in `themeInstances` Map but may not be properly cleaned up.

**Files Affected**:
- `src/themes/theme-manager.js`
- `src/themes/base-theme.js`

**Current State**:
- ThemeManager caches theme instances (line 50-52)
- `switchTheme()` calls `activeTheme.stop()` (line 123) but NOT `cleanup()`
- Theme instances remain in cache indefinitely
- `cleanup()` only called when ThemeManager itself is destroyed (lines 213-228)

**Analysis**:
- **Good**: Caching prevents re-loading themes
- **Concern**: If a theme's `stop()` doesn't fully clean up, resources leak
- **Concern**: No mechanism to prune old/unused themes from cache

**Solution**:
1. Add theme cache size limit:
   ```javascript
   constructor() {
       this.maxCachedThemes = 5; // Configurable
       this.themeLRU = []; // Track access order
   }
   ```

2. Implement LRU eviction:
   ```javascript
   evictOldTheme() {
       if (this.themeInstances.size > this.maxCachedThemes) {
           const oldestTheme = this.themeLRU.shift();
           const instance = this.themeInstances.get(oldestTheme);
           instance.cleanup();
           this.themeInstances.delete(oldestTheme);
       }
   }
   ```

3. Update LRU on theme access (in `switchTheme()` and `loadTheme()`)

**Expected Impact**: Limit memory growth from cached theme instances.

---

### Phase 2.2: Base Theme Cleanup Verification

**Issue**: Need to ensure all themes properly clean up resources in their `stop()` and `cleanup()` methods.

**Files Affected**:
- `src/themes/base-theme.js`
- All theme files extending BaseTheme

**Audit Checklist**:
For each theme, verify `cleanup()` method:
1. Cancels all animation frames (tracked in `animationIds[]`)
2. Removes all DOM containers (tracked in `containers[]`)
3. Clears all WebGL layers (tracked in `webglLayers[]`)
4. Removes any event listeners added by the theme
5. Clears any intervals/timeouts
6. Nullifies references to large objects

**Solution**:
1. Create a standardized cleanup template in BaseTheme
2. Document cleanup requirements for theme authors
3. Add cleanup verification in development mode:
   ```javascript
   cleanup() {
       // Cancel animations
       this.animationIds.forEach(id => cancelAnimationFrame(id));
       this.animationIds = [];

       // Remove containers
       this.containers.forEach(container => {
           if (container.parentNode) {
               container.parentNode.removeChild(container);
           }
       });
       this.containers = [];

       // Clear WebGL layers
       this.webglLayers = [];

       // VERIFICATION (dev mode only)
       if (process.env.NODE_ENV === 'development') {
           if (this.animationIds.length > 0) console.warn('Animation IDs not cleared!');
           if (this.containers.length > 0) console.warn('Containers not cleared!');
       }
   }
   ```

**Expected Impact**: Ensure consistent cleanup across all themes.

---

### Phase 2.3: WebGL Renderer Layer Management

**Issue**: WebGL renderer clears layers on theme load but may not properly dispose of GPU resources.

**Files Affected**:
- `src/rendering/renderer.js` (lines 863-1563)

**Current State**:
- Line 866-867: Arrays cleared with `= []`
- No explicit texture deletion or buffer cleanup
- GPU resources may not be freed

**Solution**:
1. Add explicit resource disposal before clearing arrays:
   ```javascript
   loadTheme(themeName, themeData = null) {
       console.log('[WebGLRenderer] loadTheme called:', themeName);

       // Dispose textured quads
       this.texturedQuads.forEach(quad => {
           if (quad.texture) {
               this.gl.deleteTexture(quad.texture);
           }
           if (quad.positionBuffer) {
               this.gl.deleteBuffer(quad.positionBuffer);
           }
           if (quad.texcoordBuffer) {
               this.gl.deleteBuffer(quad.texcoordBuffer);
           }
       });
       this.texturedQuads = [];

       // Dispose particle systems
       this.particleSystems.forEach(ps => {
           if (ps.positionBuffer) this.gl.deleteBuffer(ps.positionBuffer);
           if (ps.sizeBuffer) this.gl.deleteBuffer(ps.sizeBuffer);
           if (ps.alphaBuffer) this.gl.deleteBuffer(ps.alphaBuffer);
       });
       this.particleSystems = [];

       this.stop();
       // ... continue with theme loading
   }
   ```

2. Add `dispose()` methods to TexturedQuad and ParticleSystem classes

**Expected Impact**: Properly free GPU memory on theme switches.

---

## Phase 3: Animation Frame Management (Medium Priority)

### **Objective**: Ensure all animation frames are properly cancelled

### Phase 3.1: Animation Frame Registry

**Issue**: Multiple components use `requestAnimationFrame` but tracking could be improved.

**Files Affected**:
- `src/themes/base-theme.js`
- `src/rendering/renderer.js`
- Game mode files

**Current State**:
- BaseTheme tracks animations in `animationIds[]` (good)
- Renderer tracks `animationFrameId` (good)
- Need to verify all game modes properly cancel their animation loops

**Solution**:
1. Create central animation frame registry (optional, for debugging):
   ```javascript
   // utils/animation-frame-registry.js
   class AnimationFrameRegistry {
       constructor() {
           this.frames = new Map(); // id -> source
       }

       register(id, source) {
           this.frames.set(id, source);
       }

       cancel(id) {
           cancelAnimationFrame(id);
           this.frames.delete(id);
       }

       cancelAll(source) {
           for (const [id, frameSource] of this.frames) {
               if (frameSource === source) {
                   cancelAnimationFrame(id);
                   this.frames.delete(id);
               }
           }
       }

       getActiveCount() {
           return this.frames.size;
       }
   }
   ```

2. Use in development mode to detect leaks

**Expected Impact**: Better visibility into animation frame lifecycle.

---

### Phase 3.2: Game Mode Animation Cleanup

**Issue**: Game modes have animation loops that must be properly cancelled.

**Files Affected**:
- `src/core/game-modes/SinglePlayerMode.js`
- Other game mode files

**Current State** (from previous analysis):
- SinglePlayerMode properly cancels `animationFrameId` in `onStop()` (good)
- Uses `cleanupHandlers` array for additional cleanup (good pattern)

**Solution**:
1. Verify all game modes follow this pattern:
   ```javascript
   async onStop() {
       // Cancel animation frame
       if (this.animationFrameId) {
           cancelAnimationFrame(this.animationFrameId);
           this.animationFrameId = null;
       }

       // Execute all cleanup handlers
       this.cleanupHandlers.forEach(fn => fn());
       this.cleanupHandlers = [];
   }
   ```

2. Add verification logging in development mode

**Expected Impact**: Ensure game loops are always stopped when modes change.

---

### Phase 3.3: Timer Management (setInterval/setTimeout)

**Issue**: Timers created with `setInterval()` and `setTimeout()` may not be properly cleared.

**Files Affected**:
- All files using `setInterval` or `setTimeout`

**Solution**:
1. Create a timer registry for each component:
   ```javascript
   class Component {
       constructor() {
           this.timers = {
               intervals: [],
               timeouts: []
           };
       }

       setInterval(callback, delay) {
           const id = setInterval(callback, delay);
           this.timers.intervals.push(id);
           return id;
       }

       setTimeout(callback, delay) {
           const id = setTimeout(callback, delay);
           this.timers.timeouts.push(id);
           return id;
       }

       clearAllTimers() {
           this.timers.intervals.forEach(id => clearInterval(id));
           this.timers.timeouts.forEach(id => clearTimeout(id));
           this.timers.intervals = [];
           this.timers.timeouts = [];
       }

       destroy() {
           this.clearAllTimers();
           // ... other cleanup
       }
   }
   ```

2. Audit codebase for all `setInterval` and `setTimeout` calls
3. Ensure all are tracked and cleared in component cleanup

**Expected Impact**: Prevent timer leaks that continue running after component destruction.

---

## Phase 4: DOM and Style Optimization (Low Priority)

### **Objective**: Reduce unnecessary DOM operations and style recalculations

### Phase 4.1: Minimize Style Thrashing

**Issue**: Frequent style changes can cause layout thrashing.

**Files Affected**:
- Various UI components

**Solution**:
1. Batch DOM reads and writes:
   ```javascript
   // BAD: Read-Write-Read-Write (causes layout thrashing)
   element1.style.height = element2.offsetHeight + 'px';
   element3.style.width = element4.offsetWidth + 'px';

   // GOOD: Read-Read-Write-Write
   const height = element2.offsetHeight;
   const width = element4.offsetWidth;
   element1.style.height = height + 'px';
   element3.style.width = width + 'px';
   ```

2. Use `requestAnimationFrame` for batched style updates:
   ```javascript
   class StyleBatcher {
       constructor() {
           this.pending = [];
           this.scheduled = false;
       }

       schedule(fn) {
           this.pending.push(fn);
           if (!this.scheduled) {
               this.scheduled = true;
               requestAnimationFrame(() => this.flush());
           }
       }

       flush() {
           this.pending.forEach(fn => fn());
           this.pending = [];
           this.scheduled = false;
       }
   }
   ```

**Expected Impact**: Reduce layout recalculation overhead.

---

### Phase 4.2: CSS Class Toggle Optimization

**Issue**: Frequent class additions/removals can be optimized.

**Solution**:
1. Use `classList.toggle()` with second parameter:
   ```javascript
   // Instead of:
   if (condition) {
       element.classList.add('active');
   } else {
       element.classList.remove('active');
   }

   // Use:
   element.classList.toggle('active', condition);
   ```

2. Combine multiple class changes:
   ```javascript
   // Instead of:
   element.classList.add('class1');
   element.classList.add('class2');
   element.classList.remove('class3');

   // Use:
   element.className = 'class1 class2 other-existing-class';
   // Or batch with classList:
   element.classList.add('class1', 'class2');
   element.classList.remove('class3');
   ```

**Expected Impact**: Minor performance improvement in UI updates.

---

### Phase 4.3: Event Handler Debouncing and Throttling

**Issue**: High-frequency events (resize, scroll, mousemove) can cause performance issues if handlers run on every event.

**Files Affected**:
- `src/rendering/renderer.js` (resize handler)
- `src/ui/serenity-hub/SerenityHub.js` (mousemove handler)
- Any components with scroll/input handlers

**Solution**:
1. Create utility functions for debounce and throttle:
   ```javascript
   // utils/performance-utils.js
   export function debounce(func, wait) {
       let timeout;
       return function executedFunction(...args) {
           const later = () => {
               clearTimeout(timeout);
               func(...args);
           };
           clearTimeout(timeout);
           timeout = setTimeout(later, wait);
       };
   }

   export function throttle(func, limit) {
       let inThrottle;
       return function(...args) {
           if (!inThrottle) {
               func.apply(this, args);
               inThrottle = true;
               setTimeout(() => inThrottle = false, limit);
           }
       };
   }
   ```

2. Apply throttle to resize handler in renderer:
   ```javascript
   // In renderer.js
   import { throttle } from '../utils/performance-utils.js';
   
   constructor() {
       // Throttle resize to max once every 100ms
       this.resizeHandler = throttle(this.resize.bind(this), 100);
   }
   ```

3. Apply throttle to mousemove in SerenityHub:
   ```javascript
   // Throttle mousemove to max once every 16ms (~60fps)
   this.documentMouseMoveHandler = throttle(this.handleMouseMove.bind(this), 16);
   ```

**Expected Impact**: Reduce CPU usage during high-frequency events by 60-80%.

---

### Phase 4.4: Intersection Observer for Visibility Detection

**Issue**: Manually checking element visibility in scroll handlers is inefficient.

**Solution**:
1. Use Intersection Observer API for visibility detection:
   ```javascript
   class VisibilityManager {
       constructor() {
           this.observers = [];
       }

       observe(element, callback, options = {}) {
           const observer = new IntersectionObserver((entries) => {
               entries.forEach(entry => {
                   callback(entry.isIntersecting, entry);
               });
           }, {
               threshold: options.threshold || 0.1,
               rootMargin: options.rootMargin || '0px'
           });

           observer.observe(element);
           this.observers.push(observer);
           return observer;
       }

       cleanup() {
           this.observers.forEach(observer => observer.disconnect());
           this.observers = [];
       }
   }
   ```

2. Apply to UI components that need visibility tracking
3. Disconnect all observers in cleanup methods

**Expected Impact**: More efficient visibility detection, especially with many elements.

---

## Phase 5: Asset and Resource Management (Medium Priority)

### **Objective**: Optimize loading, caching, and disposal of game assets

### Phase 5.1: Asset Preloading and Caching Strategy

**Issue**: Assets may be loaded multiple times or loaded synchronously causing frame drops.

**Solution**:
1. Implement a centralized asset manager:
   ```javascript
   // utils/asset-manager.js
   class AssetManager {
       constructor() {
           this.cache = new Map(); // url -> asset
           this.loading = new Map(); // url -> Promise
           this.maxCacheSize = 50; // Configurable limit
           this.cacheOrder = []; // LRU tracking
       }

       async load(url, type = 'image') {
           // Return cached asset
           if (this.cache.has(url)) {
               this.updateLRU(url);
               return this.cache.get(url);
           }

           // Return existing loading promise
           if (this.loading.has(url)) {
               return this.loading.get(url);
           }

           // Start new load
           const loadPromise = this.loadAsset(url, type);
           this.loading.set(url, loadPromise);

           try {
               const asset = await loadPromise;
               this.cache.set(url, asset);
               this.cacheOrder.push(url);
               this.evictIfNeeded();
               return asset;
           } finally {
               this.loading.delete(url);
           }
       }

       async loadAsset(url, type) {
           switch (type) {
               case 'image':
                   return this.loadImage(url);
               case 'audio':
                   return this.loadAudio(url);
               case 'json':
                   return this.loadJSON(url);
               default:
                   throw new Error(`Unknown asset type: ${type}`);
           }
       }

       loadImage(url) {
           return new Promise((resolve, reject) => {
               const img = new Image();
               img.onload = () => resolve(img);
               img.onerror = reject;
               img.src = url;
           });
       }

       loadAudio(url) {
           return new Promise((resolve, reject) => {
               const audio = new Audio();
               audio.addEventListener('canplaythrough', () => resolve(audio), { once: true });
               audio.addEventListener('error', reject, { once: true });
               audio.src = url;
           });
       }

       async loadJSON(url) {
           const response = await fetch(url);
           return response.json();
       }

       updateLRU(url) {
           const index = this.cacheOrder.indexOf(url);
           if (index > -1) {
               this.cacheOrder.splice(index, 1);
               this.cacheOrder.push(url);
           }
       }

       evictIfNeeded() {
           while (this.cache.size > this.maxCacheSize) {
               const oldestUrl = this.cacheOrder.shift();
               const asset = this.cache.get(oldestUrl);
               
               // Clean up asset if needed
               if (asset instanceof HTMLImageElement) {
                   asset.src = '';
               } else if (asset instanceof HTMLAudioElement) {
                   asset.pause();
                   asset.src = '';
               }
               
               this.cache.delete(oldestUrl);
           }
       }

       preload(urls, type = 'image') {
           return Promise.all(urls.map(url => this.load(url, type)));
       }

       clear() {
           this.cache.forEach((asset, url) => {
               if (asset instanceof HTMLImageElement) {
                   asset.src = '';
               } else if (asset instanceof HTMLAudioElement) {
                   asset.pause();
                   asset.src = '';
               }
           });
           this.cache.clear();
           this.loading.clear();
           this.cacheOrder = [];
       }
   }

   export const assetManager = new AssetManager();
   ```

2. Use asset manager throughout the application
3. Preload theme assets before switching themes

**Expected Impact**: 
- Eliminate duplicate asset loads
- Prevent frame drops during asset loading
- Reduce memory usage through LRU eviction

---

### Phase 5.2: Audio Context Management

**Issue**: Audio contexts and buffers may not be properly cleaned up, causing memory leaks.

**Files Affected**:
- `src/ui/serenity-hub/MusicTab.js`
- Any audio-playing components

**Solution**:
1. Create centralized audio manager:
   ```javascript
   class AudioManager {
       constructor() {
           this.context = null;
           this.sources = [];
           this.buffers = new Map();
       }

       getContext() {
           if (!this.context) {
               this.context = new (window.AudioContext || window.webkitAudioContext)();
           }
           return this.context;
       }

       async loadSound(url) {
           if (this.buffers.has(url)) {
               return this.buffers.get(url);
           }

           const response = await fetch(url);
           const arrayBuffer = await response.arrayBuffer();
           const audioBuffer = await this.getContext().decodeAudioData(arrayBuffer);
           
           this.buffers.set(url, audioBuffer);
           return audioBuffer;
       }

       play(buffer, options = {}) {
           const context = this.getContext();
           const source = context.createBufferSource();
           source.buffer = buffer;
           
           const gainNode = context.createGain();
           gainNode.gain.value = options.volume || 1.0;
           
           source.connect(gainNode);
           gainNode.connect(context.destination);
           
           source.start(0);
           this.sources.push(source);
           
           // Auto-cleanup when done
           source.onended = () => {
               const index = this.sources.indexOf(source);
               if (index > -1) this.sources.splice(index, 1);
           };
           
           return source;
       }

       stopAll() {
           this.sources.forEach(source => {
               try {
                   source.stop();
               } catch (e) {
                   // Already stopped
               }
           });
           this.sources = [];
       }

       async cleanup() {
           this.stopAll();
           
           if (this.context && this.context.state !== 'closed') {
               await this.context.close();
           }
           
           this.context = null;
           this.buffers.clear();
       }
   }
   ```

2. Use AudioManager instead of creating new Audio elements
3. Ensure cleanup is called when switching themes or modes

**Expected Impact**: Prevent audio context leaks and reduce memory usage.

---

### Phase 5.3: Image and Texture Disposal

**Issue**: Images and WebGL textures may remain in memory after themes are switched.

**Solution**:
1. Create texture disposal helper:
   ```javascript
   class TextureManager {
       constructor(gl) {
           this.gl = gl;
           this.textures = new Map(); // url -> texture
       }

       createTexture(image, url) {
           const gl = this.gl;
           const texture = gl.createTexture();
           
           gl.bindTexture(gl.TEXTURE_2D, texture);
           gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
           gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
           gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
           gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
           gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
           
           if (url) {
               this.textures.set(url, texture);
           }
           
           return texture;
       }

       deleteTexture(texture) {
           if (texture) {
               this.gl.deleteTexture(texture);
               
               // Remove from cache
               for (const [url, tex] of this.textures) {
                   if (tex === texture) {
                       this.textures.delete(url);
                       break;
                   }
               }
           }
       }

       deleteAll() {
           this.textures.forEach(texture => {
               this.gl.deleteTexture(texture);
           });
           this.textures.clear();
       }
   }
   ```

2. Integrate with renderer's loadTheme method
3. Ensure all textures are deleted before loading new theme

**Expected Impact**: Properly free GPU memory, preventing VRAM leaks.

---

## Phase 6: Memory Management Best Practices (Low Priority)

### **Objective**: Implement general memory management improvements

### Phase 6.1: Null Reference Cleanup

**Issue**: Ensure destroyed objects null out their references to allow garbage collection.

**Solution**:
1. In all `destroy()` / `cleanup()` methods, null out references:
   ```javascript
   destroy() {
       // Remove event listeners
       this.removeAllListeners();

       // Remove DOM
       if (this.element && this.element.parentNode) {
           this.element.parentNode.removeChild(this.element);
       }

       // Null out references
       this.element = null;
       this.callbacks = null;
       this.dependencies = null;
       // ... null out all object references
   }
   ```

**Expected Impact**: Help garbage collector reclaim memory faster.

---

### Phase 6.2: WeakMap/WeakSet for Caches

**Issue**: Some caches might benefit from weak references.

**Solution**:
1. Identify caches that could use WeakMap:
   ```javascript
   // For DOM element -> data mappings
   this.elementData = new WeakMap(); // GC'd when element removed

   // For object -> metadata mappings
   this.objectMeta = new WeakMap();
   ```

2. Apply where appropriate (e.g., theme metadata, element tracking)

**Expected Impact**: Automatic memory cleanup when keys are no longer referenced.

---

### Phase 6.3: Event Listener AbortController Pattern

**Issue**: Modern browsers support AbortController for easier listener cleanup.

**Solution**:
1. Use AbortController for grouped listeners:
   ```javascript
   class Component {
       constructor() {
           this.abortController = new AbortController();
       }

       init() {
           // Add multiple listeners with same signal
           document.addEventListener('keydown', handler1, { signal: this.abortController.signal });
           window.addEventListener('resize', handler2, { signal: this.abortController.signal });
           element.addEventListener('click', handler3, { signal: this.abortController.signal });
       }

       destroy() {
           // Remove ALL listeners at once
           this.abortController.abort();
       }
   }
   ```

2. Apply to SerenityHub and other components with many listeners

**Expected Impact**: Simpler, more reliable listener cleanup.

---

## Phase 7: Performance Monitoring and Debugging (Ongoing)

### **Objective**: Add tools to detect and prevent future performance issues

### Phase 7.1: Memory Leak Detection

**Solution**:
1. Add development-mode memory monitoring:
   ```javascript
   // utils/memory-monitor.js
   class MemoryMonitor {
       constructor() {
           this.samples = [];
           this.interval = null;
       }

       start() {
           if (!performance.memory) {
               console.warn('Performance.memory not available');
               return;
           }

           this.interval = setInterval(() => {
               this.samples.push({
                   timestamp: Date.now(),
                   used: performance.memory.usedJSHeapSize,
                   total: performance.memory.totalJSHeapSize,
               });

               // Keep last 100 samples
               if (this.samples.length > 100) {
                   this.samples.shift();
               }

               // Detect sustained growth
               if (this.samples.length >= 10) {
                   const trend = this.calculateTrend();
                   if (trend > 1000000) { // Growing by >1MB per sample
                       console.warn('[MemoryMonitor] Possible memory leak detected', trend);
                   }
               }
           }, 5000); // Sample every 5 seconds
       }

       calculateTrend() {
           const n = this.samples.length;
           const recent = this.samples.slice(-10);
           const avgRecent = recent.reduce((sum, s) => sum + s.used, 0) / recent.length;
           const avgOld = this.samples.slice(0, 10).reduce((sum, s) => sum + s.used, 0) / 10;
           return avgRecent - avgOld;
       }

       stop() {
           if (this.interval) {
               clearInterval(this.interval);
               this.interval = null;
           }
       }

       getReport() {
           return {
               samples: this.samples,
               current: this.samples[this.samples.length - 1],
               trend: this.calculateTrend(),
           };
       }
   }
   ```

2. Enable in development settings

**Expected Impact**: Early detection of memory leaks during development.

---

### Phase 7.2: Event Listener Audit Tool

**Solution**:
1. Add listener tracking in development mode:
   ```javascript
   // utils/event-listener-tracker.js
   const originalAddEventListener = EventTarget.prototype.addEventListener;
   const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

   const listenerRegistry = new Map(); // target -> {event -> [listeners]}

   EventTarget.prototype.addEventListener = function(type, listener, options) {
       // Track listener
       if (!listenerRegistry.has(this)) {
           listenerRegistry.set(this, new Map());
       }
       const targetListeners = listenerRegistry.get(this);
       if (!targetListeners.has(type)) {
           targetListeners.set(type, []);
       }
       targetListeners.get(type).push({
           listener,
           stack: new Error().stack, // Capture stack trace
           timestamp: Date.now(),
       });

       // Call original
       return originalAddEventListener.call(this, type, listener, options);
   };

   EventTarget.prototype.removeEventListener = function(type, listener, options) {
       // Track removal
       if (listenerRegistry.has(this)) {
           const targetListeners = listenerRegistry.get(this);
           if (targetListeners.has(type)) {
               const listeners = targetListeners.get(type);
               const index = listeners.findIndex(l => l.listener === listener);
               if (index !== -1) {
                   listeners.splice(index, 1);
               }
           }
       }

       // Call original
       return originalRemoveEventListener.call(this, type, listener, options);
   };

   // Audit function
   function auditEventListeners() {
       let total = 0;
       for (const [target, events] of listenerRegistry) {
           for (const [event, listeners] of events) {
               total += listeners.length;
               if (listeners.length > 5) {
                   console.warn(`Many listeners on ${target.constructor.name} for ${event}:`, listeners.length);
               }
           }
       }
       console.log(`[EventListenerAudit] Total listeners: ${total}`);
       return { total, registry: listenerRegistry };
   }
   ```

2. Run audit before/after mode switches and theme changes

**Expected Impact**: Identify listener leaks during development.

---

### Phase 7.3: Performance Metrics Dashboard

**Solution**:
1. Add in-game performance overlay (development mode):
   ```javascript
   class PerformanceOverlay {
       constructor() {
           this.overlay = document.createElement('div');
           this.overlay.style.cssText = `
               position: fixed;
               top: 10px;
               right: 10px;
               background: rgba(0,0,0,0.8);
               color: #0f0;
               font-family: monospace;
               font-size: 12px;
               padding: 10px;
               z-index: 10000;
               pointer-events: none;
           `;
           document.body.appendChild(this.overlay);

           this.update();
       }

       update() {
           const stats = {
               fps: this.calculateFPS(),
               memory: performance.memory?.usedJSHeapSize || 0,
               listeners: this.countListeners(),
               animations: this.countAnimations(),
           };

           this.overlay.innerHTML = `
               FPS: ${stats.fps.toFixed(0)}<br>
               Memory: ${(stats.memory / 1024 / 1024).toFixed(2)} MB<br>
               Listeners: ${stats.listeners}<br>
               Animations: ${stats.animations}
           `;

           requestAnimationFrame(() => this.update());
       }

       // Implement helper methods...
   }
   ```

**Expected Impact**: Real-time visibility into performance metrics.

---

## Implementation Roadmap

### Sprint 1 (Week 1): Critical Memory Leak Fixes ⚠️ HIGH PRIORITY
**Goal**: Eliminate event listener accumulation
- [ ] Phase 1.1: SerenityHub event listener cleanup
- [ ] Phase 1.2: GestureController cleanup fix
- [ ] Phase 1.3: Renderer resize listener cleanup
- [ ] Phase 1.4: Tab event listener cleanup
- [ ] Phase 1.5: Tab instance cleanup verification
- [ ] **Testing**: 
  - Verify no listeners accumulate after 20+ theme switches
  - Use browser DevTools to check event listener count
  - Memory heap snapshot comparison (before/after theme switches)

### Sprint 2 (Week 2): Theme System & Resource Cleanup ⚠️ HIGH PRIORITY
**Goal**: Fix theme-related memory leaks
- [ ] Phase 2.1: Theme instance lifecycle audit (LRU cache implementation)
- [ ] Phase 2.2: Base theme cleanup verification
- [ ] Phase 2.3: WebGL renderer layer management (GPU resource disposal)
- [ ] Phase 5.1: Asset preloading and caching strategy
- [ ] **Testing**: 
  - Monitor memory usage during 50+ theme switches
  - GPU memory monitoring (Chrome: `chrome://gpu`)
  - Verify theme assets are properly cached and evicted

### Sprint 3 (Week 3): Animation & Timer Management
**Goal**: Ensure all animations and timers are properly cancelled
- [ ] Phase 3.1: Animation frame registry (optional debugging tool)
- [ ] Phase 3.2: Game mode animation cleanup verification
- [ ] Phase 3.3: Timer management (setInterval/setTimeout tracking)
- [ ] **Testing**: 
  - Verify animation frames are cancelled on mode switch
  - Check for orphaned timers after extended gameplay
  - Profile with Chrome DevTools Performance tab

### Sprint 4 (Week 4): DOM & Event Optimization
**Goal**: Reduce unnecessary DOM operations and optimize high-frequency events
- [ ] Phase 4.1: Minimize style thrashing (batch DOM reads/writes)
- [ ] Phase 4.2: CSS class toggle optimization
- [ ] Phase 4.3: Event handler debouncing and throttling
- [ ] Phase 4.4: Intersection Observer for visibility detection
- [ ] **Testing**: 
  - Profile DOM operations during gameplay
  - Measure FPS during intensive UI interactions
  - Verify reduced layout recalculations

### Sprint 5 (Week 5): Asset & Resource Management
**Goal**: Optimize asset loading and disposal
- [ ] Phase 5.2: Audio context management
- [ ] Phase 5.3: Image and texture disposal
- [ ] Integrate AssetManager throughout codebase
- [ ] **Testing**: 
  - Verify no duplicate asset loads
  - Check audio context cleanup
  - Monitor texture memory usage

### Sprint 6 (Week 6): Memory Best Practices
**Goal**: Apply memory management patterns
- [ ] Phase 6.1: Null reference cleanup in all destroy methods
- [ ] Phase 6.2: WeakMap/WeakSet for appropriate caches
- [ ] Phase 6.3: AbortController pattern for event listeners
- [ ] **Testing**: 
  - Run extended stress tests (2+ hours)
  - Verify garbage collection is effective
  - Check for detached DOM nodes

### Sprint 7 (Week 7): Monitoring & Tooling
**Goal**: Add performance monitoring for ongoing health
- [ ] Phase 7.1: Memory leak detection tool
- [ ] Phase 7.2: Event listener audit tool
- [ ] Phase 7.3: Performance metrics dashboard
- [ ] Integrate monitoring into development builds
- [ ] **Testing**: 
  - Enable monitoring during QA testing
  - Validate early warning system works
  - Document how to use monitoring tools

### Sprint 8 (Week 8): Final Validation & Documentation
**Goal**: Comprehensive testing and optimization verification
- [ ] Run all success criteria tests
- [ ] 24-hour continuous gameplay session
- [ ] Performance regression testing
- [ ] Update documentation with lessons learned
- [ ] Create performance best practices guide for developers
- [ ] **Final Metrics**:
  - Memory growth < 5MB/hour
  - Stable event listener count
  - Consistent 60 FPS
  - Theme switch < 500ms
  - GC pauses < 50ms

---

## Success Criteria

### Performance Targets

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Memory Growth** | < 5MB per hour | Chrome DevTools Memory Profiler |
| **Event Listeners** | No accumulation (stable count) | Event Listener Audit Tool (Phase 7.2) |
| **Frame Rate** | Consistent 60 FPS | Performance Monitor / FPS counter |
| **Theme Switch Time** | < 500ms transition | Performance.now() measurements |
| **GC Pauses** | < 50ms per pause | Chrome DevTools Performance tab |
| **Initial Load Time** | < 2 seconds | Navigation Timing API |
| **CPU Usage** | < 30% during gameplay | Browser Task Manager |
| **GPU Memory** | Stable (no leaks) | `chrome://gpu` monitoring |

### Testing Scenarios

#### 1. **Theme Switch Stress Test** 🔥 CRITICAL
- **Duration**: 30 minutes
- **Actions**: Switch themes 50+ times randomly
- **Measure**: 
  - Memory before/after (should be within 10MB)
  - Event listener count (should be constant)
  - FPS stability
  - WebGL texture count
- **Pass Criteria**: Memory returns to baseline after forced GC

#### 2. **Hub Toggle Test**
- **Duration**: 20 minutes
- **Actions**: Open/close Serenity Hub 100+ times
- **Measure**:
  - Event listeners attached to document/window
  - DOM node count
  - Animation frame requests
- **Pass Criteria**: No leaked listeners or nodes

#### 3. **Extended Gameplay Session** 🔥 CRITICAL
- **Duration**: 3+ hours continuous play
- **Actions**: Normal gameplay with occasional theme switches
- **Measure**:
  - Memory usage over time (trend analysis)
  - FPS degradation
  - GC pause frequency
  - User experience (subjective smoothness)
- **Pass Criteria**: No noticeable performance degradation

#### 4. **Mode Switching Test**
- **Duration**: 15 minutes
- **Actions**: Switch between game modes 30+ times
- **Measure**:
  - Animation frame cleanup
  - Timer cleanup
  - Game loop termination
- **Pass Criteria**: All resources cleaned up on switch

#### 5. **Combined Stress Test** 🔥 CRITICAL
- **Duration**: 1 hour
- **Actions**: 
  - Rapid theme switching
  - Hub opening/closing
  - Mode changes
  - Intensive gameplay
- **Measure**: All metrics simultaneously
- **Pass Criteria**: System remains stable under heavy load

#### 6. **Asset Loading Test**
- **Duration**: 10 minutes
- **Actions**: Load all themes sequentially, then randomly
- **Measure**:
  - Network requests (should use cache)
  - Asset duplication in memory
  - Load times
- **Pass Criteria**: Assets cached properly, no duplicates

#### 7. **Audio Performance Test**
- **Duration**: 20 minutes
- **Actions**: Play/stop music, switch themes with audio
- **Measure**:
  - Audio context count
  - Audio buffer cleanup
  - Audio glitches or stuttering
- **Pass Criteria**: Single audio context, proper cleanup

---

## Monitoring & Validation Tools

### Browser DevTools Checklist
1. **Memory Profiler**:
   - Take heap snapshots before/after operations
   - Look for detached DOM nodes
   - Check for retained event listeners

2. **Performance Profiler**:
   - Record during theme switches
   - Identify long-running tasks
   - Monitor garbage collection frequency

3. **Network Tab**:
   - Verify themes are cached
   - No unnecessary re-downloads

4. **Console**:
   - Watch for resource leak warnings
   - Monitor cleanup confirmations

### Custom Monitoring
```javascript
// Add to main.js (development mode)
if (process.env.NODE_ENV === 'development') {
    // Log cleanup events
    window.addEventListener('themeSwitch', () => {
        console.log('[Perf] Theme switched, heap:', performance.memory?.usedJSHeapSize);
    });

    // Periodic health check
    setInterval(() => {
        const listeners = getEventListenerCount(); // Custom function
        const animations = getAnimationFrameCount(); // Custom function
        console.log(`[Perf] Health: ${listeners} listeners, ${animations} animations`);
    }, 30000); // Every 30 seconds
}
```

---

## Risk Assessment

### Low Risk Changes
- Event listener cleanup (Phase 1)
- Animation frame cancellation (Phase 3)
- Null reference cleanup (Phase 5.1)

### Medium Risk Changes
- Theme cache eviction (Phase 2.1)
- WebGL resource disposal (Phase 2.3)
- Style batching (Phase 4.1)

### High Risk Changes
- Event listener tracking (Phase 6.2) - could impact performance if not done carefully
- AbortController migration (Phase 5.3) - ensure browser compatibility

---

## Rollback Plan

If performance degrades after changes:
1. **Isolate**: Identify which phase caused the regression
2. **Revert**: Use git to revert specific commits
3. **Debug**: Add more logging to understand the issue
4. **Re-implement**: Try alternative approach

---

## Maintenance Plan

### Ongoing Best Practices
1. **Code Reviews**: Check for event listener cleanup in all new code
2. **Testing**: Add performance regression tests to CI/CD
3. **Documentation**: Document cleanup requirements for new features
4. **Monitoring**: Keep performance overlay in development builds

### Quarterly Audits
- Run full performance test suite
- Profile with DevTools
- Review any new memory leaks
- Update this document with new findings

---

## Conclusion

This plan addresses the root causes of performance degradation in Serenity Blocks through systematic cleanup of event listeners, proper resource management, and implementation of monitoring tools. By following this phased approach, the game will maintain smooth performance even during extended sessions and frequent theme/mode switching.

**Key Focus Areas**:
1. Event listener lifecycle management
2. Theme and WebGL resource cleanup
3. Animation frame cancellation
4. Development-time monitoring

**Expected Outcome**: The game should run smoothly indefinitely, with stable memory usage and no performance degradation over time.

---

## References

### Files to Modify (Priority Order)

#### 🔴 Critical Priority
1. **`src/ui/serenity-hub/SerenityHub.js`**
   - Lines 88-264: Event listener cleanup
   - Lines 697-734: Enhance destroy() method
   - Expected Impact: Fix ~75% of memory leaks

2. **`src/ui/serenity-hub/GestureController.js`**
   - Lines 67-74: Store bound handler references
   - Lines 285-302: Fix destroy() with correct references
   - Expected Impact: Fix 6 listener leaks per instance

3. **`src/rendering/renderer.js`**
   - Line 704: Store resize handler reference
   - Lines 785-793: Add listener cleanup to stop()
   - Lines 863-1563: Add WebGL resource disposal in loadTheme()
   - Expected Impact: Fix GPU memory leaks

#### 🟡 High Priority
4. **`src/themes/theme-manager.js`**
   - Lines 50-52: Implement LRU cache
   - Lines 123: Call cleanup() not just stop()
   - Lines 213-228: Enhance cleanup method
   - Expected Impact: Limit theme cache growth

5. **`src/themes/base-theme.js`**
   - Standardize cleanup() method
   - Document requirements for theme authors
   - Expected Impact: Consistent cleanup across all themes

6. **`src/ui/serenity-hub/MusicTab.js`**
   - Audit audio context usage
   - Implement proper audio cleanup
   - Expected Impact: Fix audio memory leaks

#### 🟢 Medium Priority
7. **`src/ui/serenity-hub/BreathingTab.js`**
   - Verify destroy() method exists
   - Add timer cleanup if needed

8. **`src/ui/serenity-hub/ThemesTab.js`**
   - Verify destroy() method exists
   - Add event listener cleanup

9. **`src/core/game-modes/SinglePlayerMode.js`**
   - Verify animation frame cleanup (already good)
   - Audit for timer usage

10. **All theme files** (aurora, forest, ocean, etc.)
    - Verify cleanup() implementation
    - Add verification logging

### New Files to Create

#### Phase 4: Performance Utilities
- **`src/utils/performance-utils.js`**
  - debounce() and throttle() functions
  - Used by: renderer.js, SerenityHub.js

#### Phase 5: Resource Management
- **`src/utils/asset-manager.js`**
  - AssetManager class with LRU cache
  - Used by: theme-manager.js, all themes

- **`src/utils/audio-manager.js`**
  - AudioManager class
  - Used by: MusicTab.js, any audio components

- **`src/utils/texture-manager.js`**
  - TextureManager class
  - Used by: renderer.js

#### Phase 7: Monitoring Tools (Development Only)
- **`src/utils/memory-monitor.js`**
  - MemoryMonitor class
  - Real-time memory leak detection

- **`src/utils/event-listener-tracker.js`**
  - Global event listener tracking
  - Audit function for debugging

- **`src/utils/performance-overlay.js`**
  - PerformanceOverlay class
  - In-game FPS/memory display

- **`src/utils/animation-frame-registry.js`**
  - AnimationFrameRegistry class
  - Track active animation frames

### Configuration Changes
- Add `MAX_CACHED_THEMES = 5` to theme-manager.js
- Add `MAX_CACHED_ASSETS = 50` to asset-manager.js
- Add `ENABLE_PERFORMANCE_MONITORING = true` for development builds

### Testing Files to Create
- **`tests/performance/memory-leak-test.js`**
  - Automated theme switch test
  - Memory growth detection

- **`tests/performance/event-listener-test.js`**
  - Track listener count over time
  - Detect accumulation

- **`tests/performance/fps-stability-test.js`**
  - Monitor FPS over extended session
  - Detect degradation

---

## Common Pitfalls & Best Practices

### ❌ Pitfalls to Avoid

#### 1. Arrow Functions in Event Listeners
```javascript
// BAD - Can't be removed properly
element.addEventListener('click', () => this.handleClick());

// GOOD - Store reference
this.clickHandler = this.handleClick.bind(this);
element.addEventListener('click', this.clickHandler);
// Later: element.removeEventListener('click', this.clickHandler);
```

#### 2. Forgetting to Clean Up Timers
```javascript
// BAD - Timer keeps running
setInterval(() => this.update(), 1000);

// GOOD - Track and clear
this.updateTimer = setInterval(() => this.update(), 1000);
// Later: clearInterval(this.updateTimer);
```

#### 3. Not Cancelling Animation Frames
```javascript
// BAD - Animation loop continues
requestAnimationFrame(() => this.animate());

// GOOD - Store ID and cancel
this.animationId = requestAnimationFrame(() => this.animate());
// Later: cancelAnimationFrame(this.animationId);
```

#### 4. Creating New Functions in Loops/Renders
```javascript
// BAD - Creates new function each time
items.forEach(item => {
    item.addEventListener('click', () => this.handleItem(item));
});

// GOOD - Reuse or store handler
this.itemHandlers = new WeakMap();
items.forEach(item => {
    const handler = (e) => this.handleItem(item, e);
    this.itemHandlers.set(item, handler);
    item.addEventListener('click', handler);
});
```

#### 5. Not Disposing WebGL Resources
```javascript
// BAD - Texture stays in GPU memory
const texture = gl.createTexture();
// ... use texture ...
texture = null; // Not enough!

// GOOD - Explicitly delete
const texture = gl.createTexture();
// ... use texture ...
gl.deleteTexture(texture);
texture = null;
```

#### 6. Circular References Preventing GC
```javascript
// BAD - Circular reference
this.element.component = this;
this.domElement = this.element;

// GOOD - Use WeakMap or null on cleanup
this.domElements = new WeakMap();
this.domElements.set(element, data);
// OR in destroy():
this.element.component = null;
this.domElement = null;
```

### ✅ Best Practices to Follow

#### 1. Always Implement destroy() or cleanup() Methods
```javascript
class Component {
    constructor() {
        this.eventHandlers = [];
        this.timers = [];
        this.animationFrames = [];
    }

    destroy() {
        // Remove all event listeners
        this.eventHandlers.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });

        // Clear all timers
        this.timers.forEach(id => clearTimeout(id));

        // Cancel animations
        this.animationFrames.forEach(id => cancelAnimationFrame(id));

        // Null out references
        this.element = null;
        this.callbacks = null;
    }
}
```

#### 2. Use AbortController for Multiple Listeners
```javascript
class Component {
    constructor() {
        this.abortController = new AbortController();
    }

    init() {
        const { signal } = this.abortController;
        
        window.addEventListener('resize', this.onResize, { signal });
        document.addEventListener('keydown', this.onKeydown, { signal });
        element.addEventListener('click', this.onClick, { signal });
    }

    destroy() {
        // Removes ALL listeners at once!
        this.abortController.abort();
    }
}
```

#### 3. Throttle High-Frequency Events
```javascript
// For mousemove, scroll, resize, etc.
this.throttledHandler = throttle(this.expensiveOperation.bind(this), 100);
window.addEventListener('scroll', this.throttledHandler);
```

#### 4. Use Passive Event Listeners When Possible
```javascript
// For scroll/touch events that don't call preventDefault()
element.addEventListener('touchstart', handler, { passive: true });
```

#### 5. Batch DOM Operations
```javascript
// BAD - Multiple reflows
element1.style.width = '100px';
const height = element2.offsetHeight; // Reflow!
element3.style.height = '200px';
const width = element4.offsetWidth; // Reflow!

// GOOD - Read first, then write
const height = element2.offsetHeight;
const width = element4.offsetWidth;
element1.style.width = '100px';
element3.style.height = '200px';
```

#### 6. Monitor Performance During Development
```javascript
if (process.env.NODE_ENV === 'development') {
    // Log cleanup events
    console.log('[Cleanup] Component destroyed');
    
    // Verify cleanup
    if (this.eventHandlers.length > 0) {
        console.warn('[Memory Leak] Event handlers not cleaned up!');
    }
}
```

#### 7. Use WeakMap for Element-Associated Data
```javascript
// Instead of element.myData = {...}
const elementData = new WeakMap();
elementData.set(element, { ... });

// Automatically GC'd when element is removed
```

#### 8. Preload Assets Strategically
```javascript
// Preload next theme while current theme is active
async switchTheme(newTheme) {
    // Preload in background
    const assets = await assetManager.preload(newTheme.assets);
    
    // Then switch
    await this.activeTheme.stop();
    this.activeTheme = newTheme;
    await newTheme.start(assets);
}
```

### 🔍 How to Detect Leaks

#### Chrome DevTools - Memory Profiler
1. Open DevTools → Memory tab
2. Take "Heap snapshot" before action
3. Perform action (e.g., switch theme 3 times)
4. Force garbage collection (trash icon)
5. Take another snapshot
6. Compare snapshots → Look for growing objects
7. Check for "Detached DOM nodes"

#### Chrome DevTools - Performance Monitor
1. Open DevTools → More tools → Performance monitor
2. Watch:
   - JS heap size (should stabilize)
   - DOM nodes (shouldn't grow indefinitely)
   - Event listeners (should stay constant)
   - Frames per second (should stay at 60)

#### Event Listener Count
```javascript
// In console after actions
getEventListeners(window); // Check window listeners
getEventListeners(document); // Check document listeners
```

#### Animation Frame Check
```javascript
// Add to development build
let frameCount = 0;
const originalRAF = window.requestAnimationFrame;
window.requestAnimationFrame = function(callback) {
    frameCount++;
    console.log('Active animation frames:', frameCount);
    return originalRAF.call(this, function(...args) {
        frameCount--;
        return callback(...args);
    });
};
```

---

**Document Version**: 2.0
**Last Updated**: 2025-10-30
**Author**: Performance Optimization Team
**Status**: Ready for Implementation

---

## Additional Resources

### Documentation
- [MDN: Memory Management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_Management)
- [Chrome DevTools: Memory Profiler](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Web.dev: Performance](https://web.dev/performance/)
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [WebGL Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)

### Tools
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)
- [Firefox Developer Tools](https://firefox-source-docs.mozilla.org/devtools-user/)
- [Lighthouse Performance Auditing](https://developers.google.com/web/tools/lighthouse)
- [webpack-bundle-analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer) - If using Webpack

### Performance Testing
- Create automated performance regression tests
- Set up CI/CD pipeline to catch performance issues
- Monitor real user metrics (RUM) if deployed
