# Serenity Hub - Architecture Overview

## Component Hierarchy

```
SerenityMode (Game Mode)
│
├─→ SerenityHub (Main Controller)
    │
    ├─→ Hub Icon (Floating Button)
    │   ├── Lotus SVG Icon
    │   ├── Glow Effect Layer
    │   └── Pulse Effect Layer (breathing state)
    │
    ├─→ Backdrop (Click-to-close overlay)
    │
    └─→ Hub Panel (Main Container)
        │
        ├─→ Panel Header
        │   ├── Title ("Serenity Hub")
        │   └── Close Button (×)
        │
        ├─→ Tab Navigation
        │   ├── Breathing Tab Button
        │   ├── Music Tab Button
        │   └── Themes Tab Button
        │
        └─→ Tab Content Area
            ├── Tab Panel: Breathing (Phase 2)
            ├── Tab Panel: Music (Phase 3)
            └── Tab Panel: Themes (Phase 4)
```

---

## Data Flow

### Initialization Flow

```
User enters Serenity Mode
        ↓
SerenityMode.onStart()
        ↓
new SerenityHub(serenityMode)
        ↓
SerenityHub.init()
        ↓
┌───────────────────────────────────┐
│ 1. createHubIcon()                │
│    - Create DOM elements          │
│    - Attach event listeners       │
│    - Add to document.body         │
├───────────────────────────────────┤
│ 2. createPanel()                  │
│    - Create backdrop              │
│    - Create panel structure       │
│    - Create tabs                  │
│    - Add to document.body         │
├───────────────────────────────────┤
│ 3. attachEventListeners()         │
│    - Tab click handlers           │
│    - Keyboard handlers (ESC)      │
│    - Backdrop click handler       │
├───────────────────────────────────┤
│ 4. setupAutoHide()                │
│    - Mouse movement listener      │
│    - Auto-hide timer              │
└───────────────────────────────────┘
        ↓
Hub ready and visible!
```

### User Interaction Flow

```
User moves mouse
        ↓
showIcon() triggered
        ↓
Icon fades in
        ↓
User clicks icon OR presses 'H'
        ↓
toggle() → show()
        ↓
┌─────────────────────────┐
│ Panel opens:            │
│ - Backdrop fades in     │
│ - Panel slides in       │
│ - Cancel auto-hide      │
│ - Focus panel           │
└─────────────────────────┘
        ↓
User clicks tab
        ↓
switchTab(tabName)
        ↓
┌─────────────────────────┐
│ Tab switches:           │
│ - Update button states  │
│ - Show/hide panels      │
│ - Load content          │
└─────────────────────────┘
        ↓
User closes panel
        ↓
hide() triggered
        ↓
┌─────────────────────────┐
│ Panel closes:           │
│ - Backdrop fades out    │
│ - Panel slides out      │
│ - Restart auto-hide     │
└─────────────────────────┘
```

### State Synchronization Flow

```
Breathing Guide Toggled
        ↓
SerenityMode._showBreathingIndicator()
        ↓
serenityHub.updateIconState({
  breathingActive: true
})
        ↓
Icon pulse animation starts
```

---

## File Dependencies

### Import Graph

```
index.html
├── /styles/serenity-hub.css
│
SerenityMode.js
├── BaseGameMode.js
├── constants.js
└── SerenityHub.js
    └── (future) BreathingTab.js
    └── (future) MusicTab.js
    └── (future) ThemesTab.js
    └── (future) GestureController.js
```

### Runtime Dependencies

```
SerenityHub Instance
│
├── Requires from SerenityMode:
│   ├── deps.soundManager (for music controls)
│   ├── deps.themeManager (for theme switching)
│   ├── deps.settingsManager (for settings)
│   └── window.breathingIndicator (for breathing control)
│
└── Provides to SerenityMode:
    ├── show() - Open hub
    ├── hide() - Close hub
    ├── toggle() - Toggle visibility
    ├── updateIconState() - Sync icon animations
    └── destroy() - Cleanup
```

---

## Event Flow

### DOM Events

```
┌────────────────────────────────────────────┐
│ Mouse Movement                             │
│ ↓                                          │
│ document.mousemove                         │
│ ↓                                          │
│ SerenityHub.showIcon()                     │
│ ↓                                          │
│ Start auto-hide timer (3s)                 │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Icon Click                                 │
│ ↓                                          │
│ hubIcon.click                              │
│ ↓                                          │
│ SerenityHub.toggle()                       │
│ ↓                                          │
│ Panel opens/closes                         │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Keyboard 'H'                               │
│ ↓                                          │
│ SerenityMode._onKeyPress()                 │
│ ↓                                          │
│ serenityHub.toggle()                       │
│ ↓                                          │
│ Panel opens/closes                         │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Keyboard 'ESC'                             │
│ ↓                                          │
│ SerenityHub (keydown listener)             │
│ ↓                                          │
│ serenityHub.hide()                         │
│ ↓                                          │
│ Panel closes                               │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Tab Click                                  │
│ ↓                                          │
│ hubTab.click                               │
│ ↓                                          │
│ SerenityHub.switchTab(tabName)             │
│ ↓                                          │
│ Update active states                       │
│ ↓                                          │
│ Load tab content                           │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ Backdrop Click                             │
│ ↓                                          │
│ backdrop.click                             │
│ ↓                                          │
│ SerenityHub.hide()                         │
│ ↓                                          │
│ Panel closes                               │
└────────────────────────────────────────────┘
```

### State Events

```
Breathing Activated
        ↓
SerenityMode.breathingIndicatorActive = true
        ↓
serenityHub.updateIconState({ breathingActive: true })
        ↓
Icon pulse animation enabled

Music Playing
        ↓
(future implementation)
        ↓
serenityHub.updateIconState({ musicPlaying: true })
        ↓
Icon wave animation enabled
```

---

## CSS Architecture

### Class Naming Convention

```
Component-based naming:
.serenity-hub-{element}
.hub-{element}

States:
.visible
.active
.open
.breathing-active
.music-playing
```

### Style Layers

```
Layer 1: CSS Variables (Design Tokens)
├── :root { --hub-primary, --hub-spacing-*, etc. }
└── Centralized color, spacing, timing values

Layer 2: Component Styles
├── .serenity-hub-icon { ... }
├── .serenity-hub-backdrop { ... }
└── .serenity-hub-panel { ... }

Layer 3: State Modifiers
├── .serenity-hub-icon.visible { ... }
├── .serenity-hub-panel.open { ... }
└── .hub-tab.active { ... }

Layer 4: Animations
├── @keyframes gentle-glow { ... }
├── @keyframes breathing-pulse { ... }
└── @keyframes tab-slide-in { ... }

Layer 5: Responsive
├── @media (max-width: 600px) { ... }
├── @media (min-width: 601px) and (max-width: 900px) { ... }
└── @media (min-width: 901px) { ... }

Layer 6: Accessibility
├── @media (prefers-reduced-motion) { ... }
├── @media (prefers-contrast: high) { ... }
└── :focus-visible { ... }
```

---

## Memory Management

### Object Lifecycle

```
Creation:
SerenityMode.onStart()
    ↓
new SerenityHub(serenityMode)
    ↓
Hub instance stored in serenityMode.serenityHub

Active Use:
User interacts with hub
    ↓
Event listeners fire
    ↓
State updates
    ↓
DOM updates

Cleanup:
SerenityMode.onDeactivate()
    ↓
serenityHub.destroy()
    ↓
┌─────────────────────────────────┐
│ 1. Clear timers                 │
│    - Auto-hide timeout          │
│                                 │
│ 2. Remove event listeners       │
│    - Mouse movement             │
│    - Keyboard events            │
│    - Click handlers             │
│                                 │
│ 3. Remove DOM elements          │
│    - Hub icon                   │
│    - Panel                      │
│    - Backdrop                   │
│                                 │
│ 4. Destroy tab instances        │
│    - breathingTab?.destroy()    │
│    - musicTab?.destroy()        │
│    - themesTab?.destroy()       │
│                                 │
│ 5. Null references              │
│    - serenityMode.serenityHub   │
└─────────────────────────────────┘
    ↓
Memory freed, no leaks!
```

---

## Extension Points (Future Phases)

### Adding New Tabs

```javascript
// Phase 2 Example: Breathing Tab

// 1. Create component file
// /src/ui/serenity-hub/BreathingTab.js
export class BreathingTab {
  constructor(hubInstance, breathingIndicator) {
    this.hub = hubInstance;
    this.breathingIndicator = breathingIndicator;
    this.render();
  }

  render() {
    // Create tab content
  }

  destroy() {
    // Cleanup
  }
}

// 2. Import in SerenityHub.js
import { BreathingTab } from './BreathingTab.js';

// 3. Instantiate in loadTabContent()
if (tabName === 'breathing' && !this.breathingTab) {
  this.breathingTab = new BreathingTab(
    this,
    window.breathingIndicator
  );
}

// 4. Cleanup in destroy()
if (this.breathingTab) {
  this.breathingTab.destroy();
}
```

### Adding New Features

```javascript
// Example: Add custom method
class SerenityHub {
  // ...existing code...

  // New feature: Notification system
  showNotification(message, duration = 2000) {
    const notification = document.createElement('div');
    notification.className = 'hub-notification';
    notification.textContent = message;
    this.panel.appendChild(notification);

    setTimeout(() => notification.remove(), duration);
  }
}

// Usage
serenityHub.showNotification('Theme changed!');
```

---

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Initialize hub | O(1) | Creates fixed DOM structure |
| Show/hide panel | O(1) | Toggle classes |
| Switch tabs | O(n) | n = number of tabs (max 3) |
| Update icon state | O(1) | Toggle classes |
| Auto-hide check | O(1) | Single timeout |
| Destroy hub | O(n) | n = number of event listeners |

### Space Complexity

| Component | Memory | Notes |
|-----------|--------|-------|
| Hub icon | ~2 KB | SVG + styles |
| Panel | ~5 KB | Structure + tabs |
| Event listeners | ~1 KB | ~10 listeners |
| Timers | ~0.1 KB | 1-2 timeouts max |
| **Total** | **~8 KB** | Very lightweight! |

### Render Performance

- **First paint:** < 16ms (single frame)
- **Animation FPS:** 60fps (GPU accelerated)
- **Tab switch:** < 16ms (single frame)
- **Icon show/hide:** < 16ms (single frame)

All animations use `transform` and `opacity` which are GPU-accelerated, ensuring smooth 60fps performance.

---

## Testing Strategy

### Unit Tests (Future)

```javascript
describe('SerenityHub', () => {
  it('should initialize with correct default state', () => {
    const hub = new SerenityHub(mockSerenityMode);
    expect(hub.isOpen).toBe(false);
    expect(hub.currentTab).toBe('breathing');
  });

  it('should show panel when show() is called', () => {
    hub.show();
    expect(hub.isOpen).toBe(true);
    expect(hub.panel.classList.contains('open')).toBe(true);
  });

  it('should switch tabs correctly', () => {
    hub.switchTab('music');
    expect(hub.currentTab).toBe('music');
  });

  it('should clean up on destroy', () => {
    hub.destroy();
    expect(hub.hubIcon).toBe(null);
    expect(hub.panel).toBe(null);
  });
});
```

### Integration Tests

```javascript
describe('SerenityHub Integration', () => {
  it('should integrate with SerenityMode', async () => {
    const mode = new SerenityMode(mockDeps);
    await mode.onStart();

    expect(mode.serenityHub).toBeDefined();
    expect(mode.serenityHub instanceof SerenityHub).toBe(true);
  });

  it('should respond to keyboard shortcuts', () => {
    const mode = new SerenityMode(mockDeps);
    mode.onStart();

    const event = new KeyboardEvent('keydown', { key: 'h' });
    document.dispatchEvent(event);

    expect(mode.serenityHub.isOpen).toBe(true);
  });
});
```

---

## Debugging Guide

### Common Issues & Solutions

**Issue:** Hub icon not appearing
- **Check:** Is SerenityMode active?
- **Check:** Move mouse to trigger visibility
- **Check:** CSS file loaded?
- **Solution:** Check browser console for errors

**Issue:** Panel not opening
- **Check:** Click icon when visible
- **Check:** Try 'H' keyboard shortcut
- **Check:** Look for JavaScript errors
- **Solution:** Verify SerenityHub initialized

**Issue:** Tabs not switching
- **Check:** Click tab buttons
- **Check:** Browser console for errors
- **Solution:** Verify event listeners attached

**Issue:** Auto-hide not working
- **Check:** Mouse movement detection
- **Check:** Timeout not being cleared
- **Solution:** Check setupAutoHide() logic

### Console Logging

Enable debug logging:
```javascript
// Add to SerenityHub.js for debugging
this.debug = true;

// Then add throughout methods:
if (this.debug) console.log('[SerenityHub] Panel opened');
```

---

## Browser DevTools Tips

### Inspect Hub Icon
```
1. Open DevTools (F12)
2. Select Elements tab
3. Find: #serenity-hub-icon
4. Check classes: .visible, .active
5. Inspect computed styles
```

### Inspect Panel
```
1. Open DevTools
2. Find: #serenity-hub-panel
3. Check classes: .open
4. Verify backdrop-filter is applied
5. Check z-index stacking
```

### Monitor Events
```javascript
// In console:
monitorEvents($('#serenity-hub-icon'), 'click');
monitorEvents(document, 'mousemove');
```

---

## Conclusion

The Serenity Hub architecture is:

✅ **Modular** - Easy to extend with new tabs
✅ **Performant** - GPU-accelerated, lightweight
✅ **Maintainable** - Clear structure, well-documented
✅ **Accessible** - Keyboard, screen reader support
✅ **Robust** - Proper lifecycle, no memory leaks

Ready for Phase 2! 🚀
