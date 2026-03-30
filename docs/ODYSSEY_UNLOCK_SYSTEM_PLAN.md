# Odyssey Mode: Progression Unlock System

## Vision
Transform Odyssey Mode into an unforgettable journey where completing levels unlocks themes, music tracks, and SFX packs. Players start with minimal content (Forest + Default theme) and earn cosmetics as they progress, creating a "Metroidvania-style" collection experience.

## User Requirements
- **Global unlocks**: Unlocked content usable across all game modes
- **Starting content**: Forest theme + Default/Tutorial theme, 2 music tracks, Zen SFX
- **Unlock trigger**: Complete level with 1+ stars → unlock that level's theme, music, and SFX
- **Collection Gallery**: Browse all 53 themes with lock status and unlock requirements
- **Expandable system**: Support current 31 tracks + 9 SFX packs, designed for 53+ as content is created

---

## Architecture Overview

### Core Components

**OdysseyUnlockManager** (NEW)
- Tracks which themes/music/SFX are unlocked
- Persists to localStorage (`serenityBlocks_unlocks`)
- Evaluates unlocks on level completion
- Migration logic for existing players

**UnlockConfig** (NEW)
- Maps levels → rewards (theme, music, SFX)
- Maps themes → music tracks
- Maps themes → SFX packs
- Defines starter content

**RewardUnlockModal** (NEW)
- Celebratory modal showing new unlocks
- Appears after level completion, before results
- Animated unlock cards with preview

**CollectionGallery** (NEW)
- Added as new tab in Serenity Hub: "Collection"
- Browse all content (themes/music/SFX)
- Shows ALL 53 themes, 31 music tracks, 13 SFX packs (locked and unlocked)
- Filter: All | Unlocked | Locked
- Progress tracking (e.g., "15/53 themes unlocked")
- Locked content: Grayed out (30% opacity), lock icon, shows "Complete Level X"

---

## Data Structures

### Unlock State Storage
```javascript
// localStorage: serenityBlocks_unlocks
{
  version: 1,
  themes: ['forest', 'cinder-drift', ...],    // Unlocked theme IDs
  music: ['EchoesoftheSoul', 'Aurora', ...],  // Unlocked track keys
  sfx: ['Zen', 'CinderDrift', ...],           // Unlocked SFX packs
  lastUnlockDate: '2026-01-08T...',
  legacyPlayerStatus: 'migrated' | null
}
```

### Unlock Configuration
```javascript
// unlock-config.js
{
  defaults: {
    themes: ['forest'],  // Starter theme
    music: ['EchoesoftheSoul', 'FallingPieces'],
    sfx: ['Zen']
  },

  levelRewards: {
    1: { theme: 'cinder-drift' },  // Maps to music/SFX via theme
    2: { theme: 'crystal-cave' },
    // ... all 55 levels
  },

  themeToMusic: {
    'cinder-drift': 'CinderDrift',
    'wolfhour': 'Wolfhour',
    // ... mappings for all themes
  },

  themeToSfx: {
    'cinder-drift': 'CinderDrift',
    'wolfhour': 'Wolfhour',
    // ... 9 themes have dedicated SFX, rest use Zen
  },

  fallbacks: {
    music: 'EchoesoftheSoul',  // For themes without dedicated tracks
    sfx: 'Zen'                  // For themes without dedicated SFX
  }
}
```

---

## Implementation Flow

### Level Completion → Unlock Flow
```
Player completes level (1+ stars)
  ↓
OdysseyMode.completeLevel() [line 529]
  ↓
OdysseyStateManager.completeLevel() [saves progress]
  ↓
OdysseyUnlockManager.evaluateUnlocks(levelId, stars)
  ├─ Check if stars >= 1
  ├─ Get level's theme from level config
  ├─ Look up music and SFX for that theme
  ├─ Filter out already-unlocked content
  └─ Return { newUnlocks: { themes: [], music: [], sfx: [] } }
  ↓
IF newUnlocks exist:
  ↓
  RewardUnlockModal.show(newUnlocks)
    ├─ Slide in from bottom
    ├─ Show unlock cards with animations
    ├─ Confetti/sparkle effects
    └─ Wait for user to click "Continue"
  ↓
LevelResultsModal.show() [existing behavior]
  ↓
Return to Odyssey board
```

---

## Critical Files

### Files to Create

1. **`/src/core/odyssey/OdysseyUnlockManager.js`**
   - Core unlock manager class
   - Methods: `init()`, `evaluateUnlocks()`, `unlockContent()`, `isThemeUnlocked()`, `isMusicUnlocked()`, `isSfxUnlocked()`, `save()`, `load()`, `migrateFromLegacyPlayer()`
   - Uses Set data structures for O(1) lookups

2. **`/src/core/odyssey/data/unlock-config.js`**
   - Central configuration for all unlock mappings
   - Generate level rewards from levels.js
   - Define theme→music and theme→SFX mappings
   - Fallbacks for missing content

3. **`/src/ui/odyssey/RewardUnlockModal.js`**
   - Celebratory unlock modal
   - Shows theme preview, music icon, SFX icon
   - Animation: slide up, confetti, glow effects
   - Returns Promise that resolves when user clicks Continue

4. **`/src/ui/serenity-hub/CollectionTab.js`** (or CollectionGallery.js)
   - **NEW TAB** in Serenity Hub: "Collection" (alongside Themes, Music, Breathing)
   - Browse all content with 3 sub-tabs: Themes | Music | SFX
   - Filter buttons: All | Unlocked | Locked
   - Progress tracker at top: "15/53 Themes | 5/31 Music | 2/13 SFX"
   - Grid layout with lock overlays and unlock hints
   - Locked items: "🔒 Complete Level X to unlock"
   - Click unlocked theme → Apply immediately
   - Click unlocked music → Play preview

### Files to Modify

5. **`/src/core/game-modes/OdysseyMode.js`** (line 529)
   - In `completeLevel()`, after saving to OdysseyState:
   - Call `odysseyUnlockManager.evaluateUnlocks(levelId, stars)`
   - If new unlocks exist, show RewardUnlockModal before LevelResultsModal

6. **`/src/ui/serenity-hub/ThemesTab.js`**
   - **DEFAULT**: Show ALL 53 themes (locked and unlocked)
   - Add "Hide Locked" toggle button (optional filter)
   - Locked themes: 30% opacity, grayscale, lock icon overlay
   - Show unlock hint on hover: "🔒 Complete Level X to unlock"
   - Disable click for locked themes (show tooltip instead)
   - Unlocked themes: Full color, clickable, normal behavior

7. **`/src/ui/serenity-hub/MusicTab.js`**
   - **DEFAULT**: Show ALL 31 music tracks (locked and unlocked)
   - Add "Hide Locked" toggle button (optional filter)
   - Locked tracks: Grayed out with lock icon
   - Show unlock hint on hover or click attempt
   - Display progress: "5/31 Tracks Unlocked"
   - Unlocked tracks: Normal appearance, playable

8. **`/src/core/game-manager.js`** or **`/src/main.js`** (App Initialization)
   - On app load: Check if saved theme/music/SFX are unlocked
   - If saved theme is locked → Reset to default (Forest)
   - If saved music is locked → Reset to default (EchoesoftheSoul)
   - If saved SFX is locked → Reset to default (Zen)
   - No UI changes needed - silent background validation
   - **NOTE**: Theme and Music selectors will be removed from the Settings menu UI to centralize customization in Serenity Hub.

9. **`/src/events/event-bus.js`**
   - Add events: `CONTENT_UNLOCKED`, `THEME_UNLOCKED`, `MUSIC_UNLOCKED`, `SFX_UNLOCKED`

---

## Migration Strategy for Existing Players

### Detection
```javascript
// On app load
const odysseyProgress = localStorage.getItem('serenityBlocks_odysseyProgress');
const unlockData = localStorage.getItem('serenityBlocks_unlocks');

if (odysseyProgress && !unlockData) {
  // Legacy player detected → run migration
}
```

### Migration Approach: Generous
- Unlock all themes from completed Odyssey levels (stars >= 1)
- Unlock associated music and SFX for those themes
- Unlock user's current favorites from settings
- Mark as `legacyPlayerStatus: 'migrated'`
- Show one-time modal explaining the new system

### Migration Modal
```
┌─────────────────────────────────────────┐
│      🎉 NEW UNLOCK SYSTEM! 🎉          │
│                                         │
│  Complete Odyssey levels to unlock     │
│  themes, music, and sound effects!     │
│                                         │
│  As a valued player, we've unlocked    │
│  all content from your completed       │
│  levels. Enjoy!                        │
│                                         │
│  Unlocked:                             │
│  • 15 Themes                           │
│  • 12 Music Tracks                     │
│  • 5 SFX Packs                         │
│                                         │
│         [Got it!]                      │
└─────────────────────────────────────────┘
```

---

## Handling Missing Content

**Current state**: 53 themes, 31 music tracks, 9 dedicated SFX packs

**Strategy**:
- Themes without music → Use fallback track (`EchoesoftheSoul`)
- Themes without SFX → Use fallback pack (`Zen`)
- System designed to expand: When new tracks/SFX added, update config, auto-unlock for players who completed that level

**Expandability**:
```javascript
// In OdysseyUnlockManager.init():
_autoUnlockNewContent() {
  // For completed levels, check if new music/SFX now exists
  // Auto-grant to players who already earned it
}
```

---

## UI/UX Design

### RewardUnlockModal
```
┌─────────────────────────────────────────┐
│           🎉 NEW UNLOCKS! 🎉            │
│                                         │
│  ┌───────────┐  ┌───────────┐         │
│  │   Theme   │  │   Music   │         │
│  │  [Image]  │  │    🎵     │         │
│  └───────────┘  └───────────┘         │
│  Cinder Drift   Cinder Drift           │
│                                         │
│  ┌───────────┐                         │
│  │    SFX    │                         │
│  │    🔊     │                         │
│  └───────────┘                         │
│  Cinder Drift                          │
│                                         │
│         [Continue]                     │
└─────────────────────────────────────────┘
```

### Collection Gallery
```
┌──────────────────────────────────────────────────┐
│  COLLECTION                       [X Close]      │
│                                                   │
│  [Themes] [Music] [SFX]                          │
│  Progress: 15/53 Themes Unlocked                 │
│  [All] [Unlocked] [Locked]                       │
│                                                   │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐           │
│  │Forest│ │Cinder│ │🔒Oce-│ │🔒Gala│           │
│  │      │ │Drift │ │  an  │ │ xy   │           │
│  └──────┘ └──────┘ └──────┘ └──────┘           │
│  Unlocked  Unlocked  Level 8   Level 36         │
└──────────────────────────────────────────────────┘
```

### Lock Overlays
- Locked themes: 30% opacity, grayscale
- Lock icon: Gold (#FFD700) with subtle glow
- Unlock hint appears on hover: "Complete Level X"

---

## UX Best Practices & Philosophy

### Core Principle: Context-Appropriate Visibility

**Exploration Contexts → Show Locks**
- **Serenity Hub (ThemesTab/MusicTab)**: Show ALL content with lock overlays
  - Why: Players are browsing/discovering, creates "I want that!" motivation
  - Visual: Locked items grayed out but visible with unlock hints
  - Toggle: "Hide Locked" button for players who prefer cleaner view

**Collection Context → Show Everything**
- **Collection Tab**: Complete catalog of all unlockable content
  - Why: Dedicated completionist view, clear progression goals
  - Visual: Grid with progress tracker, filter options
  - Benefit: Players see exactly what they can earn

**Functional Contexts → Hide Locks**
- **Settings Menu**: REMOVE Theme and Music selectors
  - Why: Separation of concerns. Settings = Technical (Resolution, Volume), Hub = Content/Customization.
  - Benefit: Cleaner settings menu, centralized "wardrobe" experience in Hub.
  - Result: Users must go to Serenity Hub to change themes/music.

### User Flow Examples

#### New Player First Experience:
```
1. Opens game → Has Forest + Default theme (2 themes)
2. Explores Serenity Hub → Sees 51 locked themes (creates curiosity)
3. Starts Odyssey Mode → Completes Level 1 (1 star)
4. 🎉 Unlock modal appears: "Cinder Drift unlocked!"
5. Returns to Hub → Cinder Drift now available (instant gratification)
6. Opens Collection tab → "3/53 Themes" (sense of progress)
```

#### Returning Player Browsing:
```
ThemesTab (Exploration):
├─ Shows 53 themes in grid
├─ 15 unlocked: Full color, clickable
├─ 38 locked: 30% opacity, lock icon
├─ Hovers Galaxy theme: "🔒 Complete Level 36"
└─ Toggle "Hide Locked" → Shows only 15 themes

Settings (Functional):
└─ Technical settings only (Volume, Graphics, Controls)
   (Theme/Music selectors removed)
```

#### Completionist View:
```
Collection Tab:
├─ Header: "15/53 Themes | 5/31 Music | 2/13 SFX"
├─ Filter: [All] [Unlocked] [Locked] ← active
├─ Shows all 53 themes in grid
├─ Click filter "Locked" → Shows 38 locked themes only
└─ Provides clear roadmap: "Which levels do I need?"
```

### Visual Hierarchy

**Unlocked Content:**
- Full saturation color
- Normal opacity (100%)
- Hover: Scale 1.05, glow effect
- Cursor: pointer
- Click: Apply/select immediately

**Locked Content:**
- Desaturated (grayscale filter)
- 30% opacity
- Lock badge overlay (gold with glow)
- Hover: Show tooltip with unlock requirement
- Cursor: not-allowed
- Click: Display unlock hint message

**Toggle Controls:**
- "Hide Locked" checkbox/button in ThemesTab/MusicTab
- Default state: Unchecked (show all)
- Persisted in settings for user preference

### Progress Indicators

**Everywhere Visible:**
- ThemesTab: "15/53 Themes" at top
- MusicTab: "5/31 Tracks" at top
- Collection Tab: "15/53 | 5/31 | 2/13" (combined)

**Why This Matters:**
- Creates sense of achievement
- Motivates continued play
- Shows players they're making progress
- Industry standard (Smash Bros, Pokémon, etc.)

### Discovery vs Selection Philosophy

| Context | View | Purpose | Locks Shown? |
|---------|------|---------|--------------|
| **Serenity Hub - Themes** | Browse & discover | Exploration | ✅ Yes (with toggle) |
| **Serenity Hub - Music** | Browse & discover | Exploration | ✅ Yes (with toggle) |
| **Collection Tab** | Complete catalog | Completionist | ✅ Yes (always) |
| **Settings Menu** | Technical Config | Functional | N/A (Selectors removed) |
| **Game Startup** | Auto-load saved | Functional | ❌ No (validates/resets) |

### Why This Approach Works

1. **Clear Goals**: Players always know what they're working toward
2. **Immediate Feedback**: Unlock modal shows rewards instantly
3. **Flexibility**: Toggle lets players customize their view
4. **No Frustration**: Functional contexts (settings) are lock-free
5. **Completionist Appeal**: Collection tab satisfies 100% achievers
6. **Industry Standard**: Matches expectations from AAA games

---

## Testing Strategy

### End-to-End Test
1. New player, no saves
2. Complete Level 1 with 1 star
3. Verify: Cinder Drift theme unlocked
4. Verify: RewardUnlockModal shows with theme/music/SFX cards
5. Click Continue
6. Verify: LevelResultsModal shows
7. Return to menu
8. Verify: Cinder Drift available in ThemesTab
9. Verify: Can select and use Cinder Drift

### Migration Test
1. Create legacy save (10 completed Odyssey levels, no unlock data)
2. Reload app
3. Verify: Migration modal shows
4. Verify: 10 themes unlocked (one per completed level)
5. Verify: Associated music and SFX unlocked
6. Verify: Current theme from settings granted

### Locked Content Test
1. Try to click locked theme in ThemesTab
2. Verify: Click disabled
3. Verify: Tooltip shows "Complete Level X to unlock"
4. Try to play locked music in MusicTab
5. Verify: Playback disabled, lock icon shown

### Missing Content Test
1. Complete level with theme that has no dedicated music
2. Verify: Theme unlocks
3. Verify: Falls back to default music (EchoesoftheSoul)
4. Verify: No console errors
5. Verify: Theme still works correctly

### UX Pattern Tests

**ThemesTab Toggle Test:**
1. Open ThemesTab → See 53 themes (15 unlocked, 38 locked)
2. Locked themes: 30% opacity, grayscale, lock icon
3. Hover locked theme → Tooltip shows "🔒 Complete Level X"
4. Click locked theme → No action, tooltip persists
5. Click "Hide Locked" toggle → Only 15 unlocked themes shown
6. Click "Show Locked" toggle → All 53 themes shown again
7. Verify: Toggle state persists (reload page, toggle remembered)

**MusicTab Progress Test:**
1. Open MusicTab → See progress "5/31 Tracks Unlocked"
2. Complete Odyssey level → Unlock new track
3. Return to MusicTab → Progress updates to "6/31"
4. Click unlocked track → Plays music
5. Click locked track → Shows tooltip, doesn't play

**Collection Tab Complete Test:**
1. Open Serenity Hub → Click "Collection" tab
2. See combined progress: "15/53 | 5/31 | 2/13"
3. Click "Themes" sub-tab → Grid shows all 53 themes
4. Click "Locked" filter → Only locked themes shown
5. Click "Unlocked" filter → Only unlocked themes shown
6. Click "All" filter → All themes shown
7. Hover locked theme → Shows unlock requirement
8. Click unlocked theme → Applies immediately, shows confirmation

**Settings Dropdown Test:**
1. Open Settings
2. Verify: Theme and Music dropdowns are GONE
3. Verify: Volume, Graphics, Controls are still present
4. Change theme in Serenity Hub -> Verify it applies
5. Restart game -> Verify theme persists

---

## Implementation Phases

### Phase 1: Core Infrastructure (Priority 1)
- [ ] Create OdysseyUnlockManager.js
- [ ] Create unlock-config.js (generate level rewards)
- [ ] Add unlock events to event-bus.js
- [ ] Implement migration logic

### Phase 2: Unlock Display (Priority 1)
- [ ] Create RewardUnlockModal.js
- [ ] Integrate into OdysseyMode.completeLevel()
- [ ] Test end-to-end unlock flow

### Phase 3: UI Integration (Priority 2)
- [ ] Update ThemesTab with lock/unlock UI
  - [ ] Show all themes by default (locked + unlocked)
  - [ ] Add "Hide Locked" toggle button
  - [ ] Add lock overlays (30% opacity, grayscale, lock icon)
  - [ ] Add unlock hint tooltips
  - [ ] Add progress counter: "15/53 Themes"
- [ ] Update MusicTab with lock/unlock UI
  - [ ] Show all tracks by default (locked + unlocked)
  - [ ] Add "Hide Locked" toggle button
  - [ ] Add lock icons to locked tracks
  - [ ] Add progress counter: "5/31 Tracks"
- [ ] Update Settings UI (Cleanup)
  - [ ] Remove Theme selector dropdown
  - [ ] Remove Music selector dropdown
  - [ ] Remove Sound Set selector dropdown (verify if this should be in Hub too)
  - [ ] Ensure volume controls remain accessible

### Phase 4: Collection Tab (Priority 2)
- [ ] Create CollectionTab.js (new Serenity Hub tab)
- [ ] Add "Collection" tab to Serenity Hub navigation
- [ ] Implement 3 sub-tabs: Themes | Music | SFX
- [ ] Add filter buttons: All | Unlocked | Locked
- [ ] Add combined progress tracker
- [ ] Implement grid layout with previews
- [ ] Add click handlers (apply theme, play music preview)

### Phase 5: Polish & Testing (Priority 3)
- [ ] Add animations (confetti, glow effects)
- [ ] Accessibility (keyboard navigation, screen reader support)
- [ ] Performance optimization
- [ ] Comprehensive testing

### Phase 6: Expandability (Ongoing)
- [ ] Add new music tracks as they're created
- [ ] Add new SFX packs as they're created
- [ ] Auto-unlock for existing players

---

## Performance Considerations

- **Unlock evaluation**: < 5ms (not on critical path)
- **Use Set data structures**: O(1) lookups vs O(n) array searches
- **Lazy loading**: Load unlock-config.js only when needed
- **Cache unlock status**: Don't query localStorage on every render
- **Debounced saves**: Batch multiple unlocks before writing to localStorage

---

## Backward Compatibility

- If UnlockManager not initialized → Fall back to all content unlocked
- If user's saved settings reference locked content → Reset to defaults
- Existing theme/music selection continues to work
- No breaking changes to other game modes

---

## Key Metrics

- **Unlock engagement**: % of players who open Collection Gallery
- **Odyssey completion**: Correlation between unlocks and level completions
- **Theme diversity**: Usage distribution before vs after unlock system
- **Migration success**: % of legacy players who migrate smoothly

---

## Future Enhancements

- Special unlocks for 3-starring entire chapters
- Hidden themes via secret achievements
- Prestige system (reset progress for exclusive rewards)
- Seasonal/event themes
- Community-created theme submissions

---

## Verification Plan

After implementation, verify:

1. **New Player Experience**
   - Start game → Only Forest + Default theme available
   - Complete Level 1 → See unlock modal → Cinder Drift unlocked
   - Open Collection Gallery → See progress (1/53 themes)

2. **Existing Player Migration**
   - Load with completed levels → Migration runs automatically
   - See migration modal with unlock count
   - Themes from completed levels are available

3. **UI Consistency**
   - **ThemesTab**: Shows all 53 themes by default, locked ones grayed out
   - **MusicTab**: Shows all 31 tracks by default, locked ones with lock icon
   - **"Hide Locked" toggle**: Works correctly in both tabs
   - **Settings menu**: Theme/Music selectors are removed
   - **Collection Tab**: Shows accurate lock status for all content
   - **Progress counters**: Display correctly everywhere (ThemesTab, MusicTab, Collection)

4. **Unlock Flow**
   - Complete multiple levels → Each shows unlock modal
   - No duplicate unlocks (completing same level twice)
   - 0-star completion doesn't unlock content

5. **Missing Content Handling**
   - Themes without music use fallback
   - Themes without SFX use Zen
   - No console errors or broken behavior

---

## Key UX Decisions Summary

### What Makes This System Great:

1. **Progressive Discovery**
   - Start with 2 themes → See 51 locked → Creates immediate curiosity
   - First unlock happens fast (Level 1) → Instant gratification
   - Every level completion feels rewarding

2. **Context-Appropriate UI**
   - Browse mode (Hub): Show locks → Creates desire
   - Collection mode: Show everything → Completionist appeal
   - Settings mode: Technical only → Focus on performance/controls

3. **Player Control**
   - "Hide Locked" toggle → Players choose their experience
   - Filter options in Collection → Find what they need
   - No forced discovery → Respects player preference

4. **Clear Feedback Loop**
   ```
   Play Level → See Unlock Modal → See Content Everywhere
   └─────────────────────────────────────────────┘
          Immediate, satisfying, motivating
   ```

5. **Industry-Standard Patterns**
   - Lock overlays: Super Smash Bros, Pokémon
   - Collection view: Most modern games with unlocks
   - Progress tracking: Universal best practice
   - Instant gratification: Proven to increase engagement

### Critical Files Added:
- `/src/ui/serenity-hub/CollectionTab.js` - NEW tab for browsing
- `/src/core/odyssey/OdysseyUnlockManager.js` - Core unlock logic
- `/src/core/odyssey/data/unlock-config.js` - Mappings
- `/src/ui/odyssey/RewardUnlockModal.js` - Celebration modal

### Critical Files Modified:
- `/src/ui/serenity-hub/ThemesTab.js` - Add locks + toggle
- `/src/ui/serenity-hub/MusicTab.js` - Add locks + toggle
- `/src/ui/settings.js` - Remove Theme/Music selectors
- `/src/core/game-modes/OdysseyMode.js` - Hook unlocks into completion

---

## Success Criteria

✅ Players feel rewarded for completing Odyssey levels
✅ Unlock system increases engagement with Odyssey Mode
✅ Collection Gallery creates "completionist" motivation
✅ Migration preserves existing players' progress
✅ System supports expansion to 53+ tracks/SFX packs
✅ No performance degradation
✅ Polished, celebratory UX
✅ Works seamlessly across all game modes
