# Serenity Hub - Quick Start Guide

## 🚀 For Users

### How to Use the Serenity Hub

1. **Start Serenity Mode**
   - From main menu, select "Serenity Mode"
   - A beautiful theme will appear full-screen

2. **Open the Hub**
   - Move your mouse → a lotus icon appears in the top-right corner
   - Click the icon OR press `H` key
   - The Serenity Hub panel slides in

3. **Navigate Tabs**
   - Click "Breathing", "Music", or "Themes" tabs
   - Content will load in the panel
   - *(Note: In Phase 1, tabs show placeholder content)*

4. **Close the Hub**
   - Click the × button
   - Press `ESC` key
   - Click outside the panel

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `H` | Open/close Serenity Hub |
| `ESC` | Close hub (when open) |
| `Tab` | Navigate between controls |
| `Enter` or `Space` | Activate button/control |

---

## 👨‍💻 For Developers

### Quick Setup

The Serenity Hub is **already integrated** into Serenity Mode! No setup needed.

### File Locations

```
/src/ui/serenity-hub/
├── SerenityHub.js       # Main component
├── index.js             # Module exports
└── (future tab components will go here)

/public/styles/
└── serenity-hub.css     # All styles

/src/core/game-modes/
└── SerenityMode.js      # Integration point
```

### Basic Usage

```javascript
// In SerenityMode (already implemented)
import { SerenityHub } from '../../ui/serenity-hub/SerenityHub.js';

// Initialize in onStart()
this.serenityHub = new SerenityHub(this);

// Toggle visibility
this.serenityHub.toggle();

// Update icon state
this.serenityHub.updateIconState({
  breathingActive: true,
  musicPlaying: false
});

// Cleanup in onDeactivate()
this.serenityHub.destroy();
```

### API Reference

#### Constructor
```javascript
new SerenityHub(serenityMode)
```
- `serenityMode`: Instance of SerenityMode (provides access to deps)

#### Methods

**show()**
- Opens the hub panel
- Displays backdrop
- Cancels auto-hide
- Returns: `void`

**hide()**
- Closes the hub panel
- Hides backdrop
- Restarts auto-hide
- Returns: `void`

**toggle()**
- Opens if closed, closes if open
- Returns: `void`

**switchTab(tabName)**
- Switches to specified tab
- `tabName`: `'breathing'`, `'music'`, or `'themes'`
- Returns: `void`

**updateIconState(options)**
- Updates icon animations
- `options.breathingActive`: Boolean - show breathing pulse
- `options.musicPlaying`: Boolean - show music wave
- Returns: `void`

**destroy()**
- Cleans up all resources
- Removes DOM elements
- Clears event listeners
- Returns: `void`

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isOpen` | Boolean | Whether panel is currently open |
| `currentTab` | String | Currently active tab name |
| `serenityMode` | Object | Reference to SerenityMode instance |
| `hubIcon` | HTMLElement | The floating hub icon element |
| `panel` | HTMLElement | The main panel element |
| `backdrop` | HTMLElement | The backdrop overlay element |

---

## 🎨 For Designers

### Customizing Styles

All styles are in `/public/styles/serenity-hub.css`

#### Change Colors

```css
/* Edit these CSS variables */
:root {
  --hub-primary: rgba(255, 255, 255, 0.95);     /* Text color */
  --hub-secondary: rgba(255, 255, 255, 0.6);   /* Secondary text */
  --hub-accent: linear-gradient(135deg, #667eea 0%, #764ba2 100%); /* Gradient */
  --hub-background: rgba(255, 255, 255, 0.1);  /* Panel background */
  --hub-border: rgba(255, 255, 255, 0.2);      /* Border color */
}
```

#### Change Spacing

```css
:root {
  --hub-spacing-xs: 8px;   /* Extra small gap */
  --hub-spacing-sm: 12px;  /* Small gap */
  --hub-spacing-md: 16px;  /* Medium gap */
  --hub-spacing-lg: 24px;  /* Large gap */
  --hub-spacing-xl: 32px;  /* Extra large gap */
}
```

#### Change Timing

```css
:root {
  --hub-transition-fast: 0.2s ease;                      /* Quick transitions */
  --hub-transition-normal: 0.3s cubic-bezier(0.4, 0, 0.2, 1); /* Normal */
  --hub-transition-slow: 0.5s cubic-bezier(0.4, 0, 0.2, 1);   /* Slow */
}
```

#### Change Border Radius

```css
:root {
  --hub-radius-sm: 12px;   /* Small rounded corners */
  --hub-radius-md: 15px;   /* Medium rounded corners */
  --hub-radius-lg: 20px;   /* Large rounded corners */
}
```

### Animation Control

**Disable all animations:**
```css
.serenity-hub-icon,
.serenity-hub-panel,
.hub-tab {
  animation: none !important;
  transition: none !important;
}
```

**Change animation speed:**
```css
@keyframes gentle-glow {
  /* Change from 3s to 5s for slower glow */
  animation-duration: 5s;
}
```

---

## 🔧 Extending the Hub

### Adding a New Tab (Example)

**1. Create tab component file**
```javascript
// /src/ui/serenity-hub/MyCustomTab.js
export class MyCustomTab {
  constructor(hubInstance) {
    this.hub = hubInstance;
    this.render();
  }

  render() {
    const container = document.getElementById('tab-mycustom');
    container.innerHTML = `
      <div class="my-custom-content">
        <h3>My Custom Tab</h3>
        <p>Custom content here!</p>
      </div>
    `;
  }

  destroy() {
    // Cleanup if needed
  }
}
```

**2. Add tab button in SerenityHub.js**
```javascript
// In createPanel() method, add to nav:
<button class="hub-tab" data-tab="mycustom" role="tab">
  <svg class="tab-icon"><!-- Custom icon --></svg>
  <span>My Tab</span>
</button>
```

**3. Add tab panel**
```javascript
// In createPanel() method, add to content area:
<div id="tab-mycustom" class="tab-panel" role="tabpanel">
  <div class="tab-loading">Loading...</div>
</div>
```

**4. Load tab content**
```javascript
// In loadTabContent() method:
import { MyCustomTab } from './MyCustomTab.js';

if (tabName === 'mycustom' && !this.myCustomTab) {
  this.myCustomTab = new MyCustomTab(this);
}
```

**5. Cleanup**
```javascript
// In destroy() method:
if (this.myCustomTab) {
  this.myCustomTab.destroy();
}
```

---

## 🐛 Troubleshooting

### Hub Icon Not Showing

**Symptoms:** Icon never appears

**Solutions:**
1. Check if Serenity Mode is active
2. Move your mouse (icon auto-hides)
3. Check browser console for errors
4. Verify CSS file is loaded: `<link rel="stylesheet" href="/styles/serenity-hub.css">`
5. Check element exists: `document.getElementById('serenity-hub-icon')`

### Panel Not Opening

**Symptoms:** Clicking icon does nothing

**Solutions:**
1. Check browser console for JavaScript errors
2. Verify `serenityHub` instance exists: `console.log(window.gameModeManager.currentMode.serenityHub)`
3. Try keyboard shortcut 'H' instead
4. Check if event listeners are attached
5. Verify CSS is loaded (panel needs styles to be visible)

### Tabs Not Switching

**Symptoms:** Clicking tabs doesn't change content

**Solutions:**
1. Check console for errors
2. Verify `switchTab()` is being called
3. Check if tab panels have correct IDs: `#tab-breathing`, `#tab-music`, `#tab-themes`
4. Verify active class is being toggled

### Performance Issues

**Symptoms:** Animations are laggy

**Solutions:**
1. Check if backdrop-filter is causing slowdown (try disabling temporarily)
2. Reduce blur amount: `--hub-backdrop-blur: 15px;` (instead of 30px)
3. Check for browser compatibility issues
4. Enable hardware acceleration in browser settings
5. Check if multiple instances are running (memory leak)

### Styling Issues

**Symptoms:** Panel looks wrong or broken

**Solutions:**
1. Clear browser cache (Ctrl+Shift+R)
2. Check if CSS file loaded correctly (Network tab in DevTools)
3. Verify CSS custom properties are supported (Chrome 90+, Firefox 88+, Safari 14+)
4. Check for CSS conflicts with other stylesheets
5. Try adding `!important` to critical styles for debugging

---

## 📊 Performance Tips

### Optimization Checklist

✅ **Use CSS transforms** (not `left`/`top`)
✅ **Use opacity** (GPU accelerated)
✅ **Avoid layout thrashing** (batch DOM reads/writes)
✅ **Clean up event listeners** (prevent memory leaks)
✅ **Clear timeouts** (prevent zombie timers)
✅ **Use passive event listeners** where possible

### Performance Monitoring

**Check FPS:**
```javascript
// In browser console
const fps = new (function() {
  let lastTime = performance.now();
  let frames = 0;

  requestAnimationFrame(function measure() {
    frames++;
    const now = performance.now();
    if (now >= lastTime + 1000) {
      console.log(`FPS: ${frames}`);
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(measure);
  });
})();
```

**Memory Usage:**
```javascript
// Check memory (Chrome only)
console.log(performance.memory.usedJSHeapSize / 1048576 + ' MB');
```

---

## 🎓 Best Practices

### When Working with SerenityHub

**DO:**
✅ Call `destroy()` when cleaning up
✅ Use `updateIconState()` to sync icon animations
✅ Check `isOpen` before toggling
✅ Use provided API methods (don't manipulate DOM directly)
✅ Follow naming conventions for new features

**DON'T:**
❌ Manipulate hub DOM elements directly
❌ Create multiple hub instances
❌ Forget to clean up event listeners
❌ Override core functionality without understanding it
❌ Use inline styles (use CSS classes)

### Code Style

```javascript
// Good: Use provided API
serenityHub.show();

// Bad: Manipulate DOM directly
serenityHub.panel.classList.add('open');

// Good: Clean up properly
if (this.serenityHub) {
  this.serenityHub.destroy();
  this.serenityHub = null;
}

// Bad: Memory leak
// (just reassigning without cleanup)
this.serenityHub = new SerenityHub(this);
```

---

## 📚 Additional Resources

### Documentation Files

- **[SERENITY_HUB_IMPLEMENTATION_PLAN.md](SERENITY_HUB_IMPLEMENTATION_PLAN.md)** - Full implementation plan
- **[PHASE_1_COMPLETE.md](PHASE_1_COMPLETE.md)** - Phase 1 completion report
- **[SERENITY_HUB_ARCHITECTURE.md](SERENITY_HUB_ARCHITECTURE.md)** - Architecture deep dive

### Code Files

- **[SerenityHub.js](src/ui/serenity-hub/SerenityHub.js)** - Main component
- **[serenity-hub.css](public/styles/serenity-hub.css)** - All styles
- **[SerenityMode.js](src/core/game-modes/SerenityMode.js)** - Integration

### Browser DevTools

**Inspect Hub:**
1. Open DevTools (F12)
2. Elements tab → Search for `serenity-hub-icon`
3. Check computed styles
4. Monitor event listeners
5. Test state changes

**Debug JavaScript:**
1. Sources tab → Find `SerenityHub.js`
2. Set breakpoints
3. Step through code
4. Watch variables

---

## 🤝 Contributing

### Before Starting Phase 2

✅ Read [SERENITY_HUB_IMPLEMENTATION_PLAN.md](SERENITY_HUB_IMPLEMENTATION_PLAN.md)
✅ Understand the architecture (see [SERENITY_HUB_ARCHITECTURE.md](SERENITY_HUB_ARCHITECTURE.md))
✅ Test Phase 1 functionality
✅ Familiarize yourself with the codebase

### Adding New Features

1. Create feature branch
2. Follow existing code patterns
3. Add JSDoc comments
4. Test on multiple browsers
5. Update documentation
6. Create pull request

---

## ✅ Quick Checklist

**For Testing Phase 1:**

- [ ] Dev server running (`npm run dev`)
- [ ] Enter Serenity Mode
- [ ] Hub icon appears on mouse movement
- [ ] Hub icon auto-hides after 3 seconds
- [ ] Click icon opens panel
- [ ] Press 'H' toggles panel
- [ ] Tabs are clickable
- [ ] Panel closes with X button
- [ ] ESC key closes panel
- [ ] Backdrop click closes panel
- [ ] No console errors

**For Phase 2 (Breathing Tab):**

- [ ] Phase 1 tested and working
- [ ] Read implementation plan
- [ ] Create BreathingTab.js
- [ ] Connect to EnhancedBreathingIndicator
- [ ] Test breathing controls
- [ ] Update documentation

---

## 🆘 Getting Help

### Common Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run tests (when available)
npm test

# Check code style
npm run lint
```

### Debug Mode

Enable verbose logging:
```javascript
// Add to SerenityHub constructor
this.DEBUG = true;

// Add throughout code
if (this.DEBUG) console.log('[Hub] Panel opened');
```

### Contact

- Check [SERENITY_HUB_IMPLEMENTATION_PLAN.md](SERENITY_HUB_IMPLEMENTATION_PLAN.md) for detailed info
- Review [PHASE_1_COMPLETE.md](PHASE_1_COMPLETE.md) for current status
- Consult [SERENITY_HUB_ARCHITECTURE.md](SERENITY_HUB_ARCHITECTURE.md) for technical details

---

**Happy coding! 🚀**

*Last updated: October 28, 2025*
*Phase 1: Complete ✅*
*Ready for Phase 2: Yes 🎯*
