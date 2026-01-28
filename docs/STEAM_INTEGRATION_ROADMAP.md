# Steam Integration Roadmap

> **Status**: Planning  
> **Last Updated**: 2026-01-28  
> **Steam AppID**: 480 (Spacewar - Development) → Production TBD  
> **Game**: Serenity Blocks

A phased implementation plan for world-class Steam integration in Serenity Blocks—a block-puzzle game featuring Odyssey progression, Infinity survival, Serenity relaxation mode, and FFA multiplayer.

---

## Design Philosophy

Before implementation, align Steam features with Serenity Blocks' core experience:

| Mode | Tone | Steam Integration Approach |
|------|------|----------------------------|
| **Single Player** | Classic, personal mastery | High score leaderboards, personal best tracking, skill achievements |
| **Odyssey** | Progressive, story-driven | Rich progression achievements, chapter completion leaderboards |
| **Infinity** | Intense, survival | Survival time/cascade leaderboards, "survive X minutes" achievements |
| **Serenity** | Calm, no pressure | Minimal Steam intrusion—no scores, no competitive features |
| **Local Multiplayer** | Couch co-op, social | Offline-first—no Steam features during gameplay, stats tracked locally |
| **FFA Multiplayer** | Competitive, social | Full Steam integration—lobbies, friends, K/D tracking |

> **UX Principle**: Steam features should enhance each mode's emotional tone, not distract from it.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ Game Modes   │  │  UI/Menus    │  │  Progression Systems     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘   │
│         │                 │                        │                 │
│         └─────────────────┼────────────────────────┘                 │
│                           ▼                                          │
│                 ┌──────────────────┐                                 │
│                 │  SteamService    │  ← Unified API facade           │
│                 │  (Singleton)     │                                 │
│                 └────────┬─────────┘                                 │
│                          │ ipcRenderer.invoke()                      │
└──────────────────────────┼───────────────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────────────┐
│                          ▼                      Main Process         │
│                 ┌──────────────────┐                                 │
│                 │  Steam IPC       │                                 │
│                 │  Handlers        │                                 │
│                 └────────┬─────────┘                                 │
│                          │                                           │
│                 ┌────────▼─────────┐                                 │
│                 │  steamworks.js   │  ← Native Steam SDK binding     │
│                 └──────────────────┘                                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation & Standardization

**Goal**: Establish reliable Steam connection with proper error handling.

### 1.1 Create Unified SteamService

Create a singleton service in the renderer that encapsulates all Steam functionality:

```javascript
// src/core/steam/steam-service.js
class SteamService {
  static instance = null;
  
  constructor() {
    this.initialized = false;
    this.steamId = null;
    this.playerName = null;
    this.avatar = null;
    this.isOnline = false;
    this.eventEmitter = new EventEmitter();
  }
  
  static getInstance() {
    if (!SteamService.instance) {
      SteamService.instance = new SteamService();
    }
    return SteamService.instance;
  }
  
  async initialize() { /* ... */ }
  async shutdown() { /* ... */ }
  
  // Event-based API for state changes
  on(event, callback) { this.eventEmitter.on(event, callback); }
  emit(event, data) { this.eventEmitter.emit(event, data); }
}
```

**Files to Create/Modify**:
- `src/core/steam/steam-service.js` [NEW] - Unified Steam facade
- `src/core/steam/steam-config.js` - Configuration constants
- `electron/main.js` - Ensure robust initialization

### 1.2 Initialization Flow

```
App Launch
    │
    ▼
┌─────────────────────┐
│ Is Steam Running?   │──No──▶ Graceful Offline Mode
└─────────┬───────────┘
          │ Yes
          ▼
┌─────────────────────┐
│ Initialize Client   │──Fail──▶ Retry (3x, exponential backoff) → Offline Mode
└─────────┬───────────┘
          │ Success
          ▼
┌─────────────────────┐
│ Validate Ownership  │──Fail──▶ Demo Mode / Exit
└─────────┬───────────┘
          │ Valid
          ▼
┌─────────────────────┐
│ Load Player Data    │
│ - Steam ID          │
│ - Player Name       │
│ - Avatar            │
│ - Friend List       │
└─────────┬───────────┘
          │
          ▼
     Ready State (emit 'steam:ready')
```

### 1.3 Implementation Best Practices

| Practice | Implementation | Why |
|----------|----------------|-----|
| **Lazy initialization** | Don't block game launch on Steam | Players can start playing immediately |
| **Silent failures** | Log errors, don't show dialogs | Non-Steam features work seamlessly |
| **Connection monitoring** | Poll Steam status every 30s | Detect disconnection mid-game |
| **Event-driven state** | Use events, not polling | Cleaner code, better performance |

### 1.4 UX Guidelines

| Scenario | User Experience |
|----------|-----------------|
| Steam not running | Game launches normally, "Offline" indicator in corner |
| Steam initializing | Subtle loading spinner in player card (never blocks UI) |
| Steam connected | Smooth fade-in of Steam name/avatar |
| Steam disconnects mid-game | Silent switch to offline, toast: "Playing offline" |

### 1.5 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Create SteamService singleton | Central API for all Steam calls | P0 |
| Implement retry logic | 3 retries with exponential backoff | P0 |
| Add connection state events | `steam:connected`, `steam:disconnected`, `steam:ready` | P0 |
| Create offline mode fallback | Graceful degradation | P0 |
| Background initialization | Don't block app launch | P0 |
| Add DLC ownership check stubs | For future expansion packs | P2 |

---

## Phase 2: Player Identity & Presence

**Goal**: Rich player identity throughout the game.

### 2.1 Player Identity System

```javascript
// Steam player data structure
{
  steamId: "76561198221135100",
  steamId32: "260869372",
  playerName: "olov_m",
  avatarSmall: "...",   // 32x32 (list views)
  avatarMedium: "...",  // 64x64 (player cards)
  avatarLarge: "...",   // 184x184 (profile, match results)
  personaState: "online|busy|away|snooze|offline",
  gameId: 480,
  lobbyId: "109775242119111476"
}
```

### 2.2 Integration Points

| Location | Feature | Avatar Size | Notes |
|----------|---------|-------------|-------|
| Main Menu | Player card (top-right) | 64x64 | Click to open Steam overlay |
| Lobby Browser | Host avatar per row | 32x32 | Quick visual recognition |
| Waiting Room | All player avatars | 64x64 | Color-coded border matches game color |
| In-Game HUD | Mini avatar per board | 32x32 | Subtle, doesn't distract from gameplay |
| Leaderboards | Avatar + name | 32x32 | Your row highlighted |
| Match Results | Winner spotlight | 184x184 | Celebration animation |

### 2.3 Rich Presence by Mode

| Mode | Rich Presence String | Update Frequency |
|------|---------------------|------------------|
| Main Menu | "In Menus" | On enter |
| Single Player | "Single Player - Level [N]" | Every level up |
| Odyssey | "Odyssey - [Chapter]: [Level Name]" | On level start |
| Infinity | "Infinity Mode - Level [N]" | Every 5 levels |
| Serenity | "Serenity Mode - Relaxing 🌊" | On enter |
| Local Multiplayer | "Local Multiplayer - [N] Players" | On start |
| FFA Lobby | "FFA Lobby (3/8) - Waiting" | On player join/leave |
| FFA Match | "FFA Match - [Position] Place" | On position change |

### 2.4 Avatar Loading Best Practices

```javascript
// Best practice: Load avatars progressively
async function loadAvatarWithFallback(steamId) {
  // 1. Show placeholder immediately
  showPlaceholder(steamId);
  
  // 2. Check memory cache
  if (avatarCache.has(steamId)) {
    return avatarCache.get(steamId);
  }
  
  // 3. Check disk cache (IndexedDB)
  const cached = await db.avatars.get(steamId);
  if (cached && !isStale(cached)) {
    avatarCache.set(steamId, cached.url);
    return cached.url;
  }
  
  // 4. Fetch from Steam (via IPC)
  const url = await ipcRenderer.invoke('steam:getAvatar', steamId);
  
  // 5. Cache for next time
  avatarCache.set(steamId, url);
  await db.avatars.put({ steamId, url, timestamp: Date.now() });
  
  return url;
}
```

### 2.5 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Fetch player avatars | 3-tier cache (memory → disk → network) | P0 |
| Player card component | Reusable, with loading/error states | P0 |
| Rich Presence per mode | Update on mode/state changes | P1 |
| "Appear Offline" support | Respect Steam setting | P1 |
| Avatar placeholder | Themed fallback for missing avatars | P0 |

---

## Phase 3: Friends & Social

**Goal**: Deep friends integration for multiplayer discovery.

### 3.1 Friends API

```javascript
// IPC handlers needed
steam:getFriends             // List of friends with status
steam:getFriendAvatar        // Get friend's avatar
steam:inviteFriend           // Send game invite to lobby
steam:onGameInvite           // Receive invite callback
steam:setRichPresence        // Update Rich Presence
steam:getLobbyMembers        // Get players in lobby
```

### 3.2 Features

| Feature | Description | UX Notes |
|---------|-------------|----------|
| **Friends Playing** | Show friends currently in Serenity Blocks | Badge on main menu |
| **Quick Invite** | One-click button in lobby waiting room | Sorted by online status |
| **Join Friend** | "Join Game" from Steam overlay | Seamless navigation to their lobby |
| **Invite Toast** | Notification when invited | Accept/Decline buttons, 10s timeout |
| **Lobby Link** | Share lobby via Steam chat | Click link = auto-join |

### 3.3 Join Flow

```
Friend clicks "Join Game" on Steam
         │
         ▼
┌─────────────────────────┐
│ Game launches (if not   │
│ already running)        │
└───────────┬─────────────┘
            │ +connect_lobby <lobbyId>
            ▼
┌─────────────────────────┐
│ Parse command line args │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ If in menu:             │
│ → Navigate to lobby     │
│ If in game:             │
│ → Show "Invite pending" │
│   Join after match ends │
└─────────────────────────┘
```

### 3.4 Invite UX Best Practices

| Scenario | UX Response |
|----------|-------------|
| Invited while in menu | Toast with "Join Now" button |
| Invited while in Odyssey level | Toast: "Invite from [Name] - Join after level?" |
| Invited while in FFA match | Toast: "Invite from [Name] - Will join after match" |
| Invited while in Serenity | Toast with low-key notification (don't interrupt zen) |
| Multiple invites | Stack toasts, newest on top |

### 3.5 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Friends list API | Get friends with game/online status | P0 |
| Invite to lobby | Send Steam invites | P0 |
| Handle game invites | React to incoming invites | P0 |
| Invite toast UI | Accept/Decline with timeout | P0 |
| Join via overlay | Parse launch params | P1 |
| Pending invite queue | Join after current activity | P1 |
| Party system | Pre-game grouping | P2 |

---

## Phase 4: Leaderboards

**Goal**: Competitive leaderboards for all game modes.

> **Note**: Single-player already has a high score system. This phase integrates with Steam Leaderboards.

### 4.1 Leaderboard Types

| Leaderboard | Scope | Sort | Notes |
|-------------|-------|------|-------|
| **Single Player High Score** | Global | Descending | Integrate existing system |
| **Single Player Lines** | Global | Descending | Total lines cleared |
| Odyssey Total Stars | Global | Descending | Sum across all levels |
| Odyssey Level Times | Per-level (~55) | Ascending | Fastest completion |
| Infinity High Score | Global | Descending | Points before death |
| Infinity Survival Time | Global | Descending | Seconds survived |
| **Infinity Best Cascade** | Global | Descending | Largest chain/combo |
| FFA Win Rate | Global | Descending | Wins / Total matches |
| FFA Total Kills | Global | Descending | Lifetime kills |

> **Note**: Serenity Mode has no leaderboards (intentionally relaxing, no pressure).

### 4.2 Leaderboard API

```javascript
steam:uploadScore(leaderboardName, score, scoreDetails)
steam:getLeaderboard(name, type, start, count)
// type: 'global' | 'friends' | 'around_user'
steam:getLeaderboardEntry(name, steamId)
```

### 4.3 UI Integration

| Screen | Leaderboard Display | UX Notes |
|--------|---------------------|----------|
| Single Player End | Your rank + personal best | Celebrate new high scores |
| Odyssey Level Select | Star leaderboard per level | Motivate replay |
| Infinity End | Your rank + top 10 + friends | Show improvement over time |
| Main Menu Stats | Personal bests summary | Quick access |
| Multiplayer Stats | Win rate, K/D rankings | Competitive players |

### 4.4 Leaderboard UX Best Practices

| Practice | Implementation |
|----------|----------------|
| **Instant feedback** | Show estimated rank immediately, refine when confirmed |
| **Celebrate improvement** | "New Personal Best! +1,234 points" animation |
| **Friends context** | Always show where you are relative to friends |
| **"Around me" view** | Show ranks near yours (±10) for context |
| **Cache aggressively** | Cache leaderboard data, refresh in background |
| **Graceful degradation** | Show local high scores if Steam unavailable |

### 4.5 Anti-Cheat Considerations

```javascript
// Score submission includes validation data
const scoreDetails = {
  score: 12345,
  duration: 342,        // Seconds played
  linesCleared: 89,
  highestLevel: 15,
  checksumHash: computeHash(gameState),  // Server-side validation
  version: "1.0.0",
};
```

### 4.6 Steam Stats & Analytics

Track aggregate player statistics beyond leaderboard scores:

| Stat Name | Type | Description |
|-----------|------|-------------|
| `total_games_played` | INT | Total Single Player games |
| `total_lines_cleared` | INT | Lifetime lines across all modes |
| `total_tspins` | INT | Lifetime T-Spin count |
| `total_perfect_clears` | INT | Lifetime perfect clears |
| `best_cascade` | INT | Highest cascade/chain ever |
| `odyssey_stars` | INT | Total Odyssey stars collected |
| `ffa_wins` | INT | Total FFA match wins |
| `ffa_kills` | INT | Total FFA kills |
| `ffa_matches` | INT | Total FFA matches played |
| `playtime_minutes` | INT | Total playtime (all modes) |
| `infinity_best_time` | INT | Best Infinity survival (seconds) |

```javascript
// IPC handlers for stats
steam:setStat(name, value)    // Set stat value
steam:getStat(name)           // Get stat value  
steam:incrementStat(name, amount)  // Atomic increment
steam:getStats()              // Get all stats
```

> **Best Practice**: Update stats at natural break points (game over, level complete) not every action.

### 4.7 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Create leaderboards on Steamworks | Register all boards | P0 |
| Implement score upload | With validation data | P0 |
| Leaderboard fetch | Paginated, cached | P0 |
| Register Steam Stats | Configure in Steamworks | P0 |
| Stats tracking service | Centralized stat updates | P0 |
| Leaderboard UI component | Reusable, tabbed views | P1 |
| Friends filter | Show friends, highlight self | P1 |
| Improvement celebration | "New best!" animation | P1 |
| Offline score queue | Upload when reconnected | P1 |
| Offline stats queue | Sync stats when reconnected | P1 |

---

## Phase 5: Steam Cloud Saves

**Goal**: Seamless cross-device progression.

### 5.1 Data to Sync

| Data | File | Size Est. | Sync Trigger |
|------|------|-----------|--------------|
| Odyssey Progress | `odyssey.json` | ~50KB | Level complete |
| Settings | `settings.json` | ~5KB | Settings change |
| Statistics | `stats.json` | ~20KB | Session end |
| Unlocks | `unlocks.json` | ~10KB | On unlock |
| Keybindings | `keybinds.json` | ~3KB | On change |
| High Scores | `highscores.json` | ~5KB | New high score |

**Total: ~95KB** (well under Steam Cloud limits)

#### 5.1.1 Cloud Manifest (Best Practice)
Add a small `cloud_manifest.json` to make sync decisions explicit and safe.

Example fields:
```
{
  "schemaVersion": 1,
  "deviceId": "steam:7656119...:DESKTOP-ABC",
  "updatedAt": 1738100000000,
  "files": {
    "odyssey.json": { "updatedAt": 1738099000000, "hash": "sha256:..." },
    "settings.json": { "updatedAt": 1738098000000, "hash": "sha256:..." }
  }
}
```
Benefits: reliable conflict detection, integrity checks, and “both changed” handling.

### 5.2 Cloud API

```javascript
steam:cloudWrite(filename, data)     // Save to cloud
steam:cloudRead(filename)            // Read from cloud  
steam:cloudDelete(filename)          // Delete file
steam:cloudExists(filename)          // Check existence
steam:cloudGetQuota()                // Check usage
steam:cloudGetTimestamp(filename)    // Last modified
```

#### 5.2.1 Best Practice: Auto Cloud vs Remote Storage API
- **Recommended**: Remote Storage API via IPC (explicit control, per-file merge, integrity checks).
- **Auto Cloud**: acceptable for simple, static save files, but offers less control over conflicts and validation.
- If Auto Cloud is used, still keep the manifest and local merge rules; treat Auto Cloud as transport only.

### 5.3 Sync Strategy

```
Game Launch
     │
     ▼
┌────────────────────────┐
│ Load local save        │
│ (never block on cloud) │
└──────────┬─────────────┘
           │
           ▼ (background)
┌────────────────────────┐
│ Compare cloud vs local │
│ by timestamp + version │
└──────────┬─────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
Cloud newer   Local newer
     │           │
     ▼           ▼
Prompt user   Silent upload
"Use cloud?"     
     │           
     ▼           
┌────────────────────────┐
│ Merge if possible      │
│ (e.g., max of stars)   │
└────────────────────────┘
```

### 5.4 Conflict Resolution UX

When cloud and local differ:

```
┌──────────────────────────────────────────────────────────┐
│  📁 Save Conflict Detected                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Your progress differs between this device and cloud.    │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────┐           │
│  │ THIS DEVICE      │    │ CLOUD SAVE       │           │
│  │ Odyssey: Ch.5    │    │ Odyssey: Ch.4    │           │
│  │ Stars: 142       │    │ Stars: 156       │           │
│  │ Last: 2h ago     │    │ Last: 3 days ago │           │
│  │                  │    │                  │           │
│  │  [USE THIS]      │    │  [USE CLOUD]     │           │
│  └──────────────────┘    └──────────────────┘           │
│                                                          │
│                    [MERGE PROGRESS]                      │
│   (Keep highest chapter, combine stars, max high scores) │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

#### 5.3.1 Merge Matrix (Best Practice)
Define deterministic merge rules per file:
- `odyssey.json`: per-level union, max stars, best times.
- `stats.json`: additive counters (lines cleared, playtime) vs max-only (best cascade, best time).
- `highscores.json`: keep best per mode; never downgrade.
- `settings.json` + `keybinds.json`: see device-local policy below.
- `unlocks.json`: union (once unlocked, always unlocked).

#### 5.3.2 Device-Local vs Cloud-Synced Settings (Best Practice)
**Device-local** (do not sync):
- graphics quality, resolution, window mode
- audio output device, render scale, FPS cap
- input device calibration (gamepad deadzones, per-device mappings)

**Cloud-synced**:
- gameplay preferences (DAS/ARR, drop behavior)
- accessibility options (colorblind mode, UI scale)
- UI layout preferences
- keybindings (if not device-specific)

If unsure, default to device-local to avoid breaking a player’s hardware setup.

#### 5.3.3 Demos/Replays (Best Practice)
- **Default**: keep replays local-only (can be large and privacy-sensitive).
- Optional later: sync a capped “recent 5” replay pack, compressed, with opt-in toggle.
- Never auto-upload replays used for anti-cheat without explicit user consent.

### 5.5 Best Practices

| Practice | Implementation |
|----------|----------------|
| **Never block startup** | Load local first, sync cloud in background |
| **Auto-save strategically** | On level complete, not every frame |
| **Merge when possible** | Max stars, highest chapter, best scores |
| **Show sync status** | Subtle cloud icon with upload/download animation |
| **Offline first** | Game is fully playable offline |
| **Debounce cloud writes** | Coalesce changes, flush on quit |
| **Integrity & rollback** | Hash each file, keep last-known-good local copy |

### 5.6 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Cloud read/write IPC | Basic file operations | P0 |
| Background sync | Don't block startup | P0 |
| Auto-save triggers | Strategic sync points | P0 |
| Conflict dialog UI | Clear comparison with merge option | P1 |
| Sync status indicator | Cloud icon in corner | P1 |
| Manual cloud reset | Settings option to force local/cloud | P2 |

---

## Phase 6: Fallbacks & Offline Mode

**Goal**: Game works perfectly without Steam.

### 6.0 Connection State Model (Best Practice)

Best-in-class: treat connectivity as more than a boolean. Track explicit states:
- **No Steam Client**: Steam not running or IPC unavailable.
- **Steam Connected**: Steam client is running and base APIs are ready.
- **Partial Support**: Steam connected but specific APIs are missing (leaderboards, cloud, achievements).
- **Temporarily Offline**: Steam connected but network/API calls fail; retry with backoff.

Use these states to drive UX (show/hide features, cache messaging, retry timing).

### 6.1 Fallback Matrix

| Feature | Steam Available | Steam Unavailable | UX Impact |
|---------|-----------------|-------------------|-----------|
| Player Name | Steam name | "Player" or custom local name | Prompt once for name |
| Avatar | Steam avatar | Default avatar with color | No perceivable difference |
| Multiplayer | Steam P2P lobbies | Local multiplayer only | "Online" section hidden |
| Achievements | Steam achievements | Local tracking + local toast | Same celebration, syncs later |
| Leaderboards | Steam leaderboards | Local high scores only | "Global" tab disabled |
| Cloud Saves | Steam Cloud | Local saves only | "Cloud" indicator hidden |
| Friends | Steam friends | Section hidden | Clean menu |

#### 6.1.1 Feature-Capability Matrix (Best Practice)
Use per-feature capability checks even when Steam is connected:

| Feature | Connected + Supported | Connected + Unsupported | Offline |
|---------|------------------------|--------------------------|---------|
| Leaderboards | Show global/friends/around | Show local only + "Steam API missing" tooltip | Show local only + offline icon |
| Cloud Saves | Sync + cloud icon | Local only + "Cloud unavailable" tooltip | Local only, no icon |
| Achievements | Unlock + Steam toast | Local-only unlock + sync queued | Local-only unlock + sync queued |
| Friends | Show friends list | Hide friends list (no empty state) | Hide friends list |

**Recommendation**: Yes, implement this matrix. It avoids false positives (e.g., Steam connected but leaderboards/cloud APIs missing).

### 6.2 Offline Queue

```javascript
// Queue system for actions when Steam reconnects
class OfflineQueue {
  constructor() {
    this.queue = JSON.parse(localStorage.getItem('steamOfflineQueue') || '[]');
  }
  
  enqueue(action, data) {
    this.queue.push({ 
      action, 
      data, 
      timestamp: Date.now(),
      attempts: 0 
    });
    this.save();
  }
  
  async flush() {
    const pending = [...this.queue];
    this.queue = [];
    
    for (const item of pending) {
      try {
        await ipcRenderer.invoke(`steam:${item.action}`, item.data);
      } catch (err) {
        if (item.attempts < 3) {
          item.attempts++;
          this.queue.push(item);
        }
      }
    }
    this.save();
  }
  
  save() {
    localStorage.setItem('steamOfflineQueue', JSON.stringify(this.queue));
  }
}
```

#### 6.2.1 Offline Queue Coalescing (Best Practice)
**Recommendation**: Yes, coalesce by type to prevent duplicates and reduce writes.

Suggested coalescing rules:
- **Stats**: keep the max or additive deltas (per stat type).
- **Leaderboards**: keep only the best score per leaderboard (highest for desc, lowest for asc).
- **Achievements**: keep unique unlocks (idempotent).
- **Cloud files**: keep only the latest write per filename.

Also add:
- **Idempotency keys** (`action + payload hash`) to avoid duplicates.
- **TTL / size caps** (e.g., 7 days or 500 actions).
- **Exponential backoff** with jitter when retrying.

### 6.3 UI Degradation Best Practices

| Steam Feature | When Unavailable |
|---------------|------------------|
| Online Multiplayer | Hide/disable with tooltip: "Requires Steam" |
| Global Leaderboards | Show local leaderboard, disable global tab |
| Friends List | Hide section entirely (no empty state) |
| Cloud Sync Icon | Don't show (no confusing icons) |
| Achievement popup | Use identical local popup (same celebration) |

#### 6.3.1 Offline Banner & Retry UX (Best Practice)
**Recommendation**: Use a subtle banner or status pill plus a manual "Retry now" action.

Guidelines:
- Show a **non-blocking status pill** near the top-right profile card.
- On first failure, show a **one-time toast**: "Steam offline - playing locally".
- Provide **Retry** in Settings > Steam or a small inline link in the status pill.
- Never interrupt gameplay with modals.

### 6.4 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Offline detection | Connection state management | P0 |
| Local profile fallback | Name prompt, default avatar | P0 |
| Offline action queue | Achievements, scores | P1 |
| Leaderboard cache | Show cached global entries | P1 |
| UI graceful hiding | Hide unavailable features cleanly | P0 |
| Reconnection sync | Automatic queue flush | P1 |
| Capability matrix | Per-feature support detection | P0 |
| Offline banner + retry | Subtle status + manual retry | P1 |

### 6.5 Implementation Checklist (Short)
- Add Steam capability detection (leaderboards, cloud, achievements, friends).
- Create a connection state model and expose to UI.
- Add a subtle offline status pill + “Retry now” action in Settings.
- Implement offline queue coalescing and TTL/backoff.
- Ensure all Steam actions use the queue when unsupported/offline.

---

## Phase 7: Achievements

**Goal**: Meaningful achievements that enhance—not interrupt—gameplay.

### 7.1 Achievement Categories

| Category | Examples | Count | Design Philosophy |
|----------|----------|-------|-------------------|
| **Progression** | Complete Chapter 1, Finish Odyssey | ~20 | Celebrate milestones |
| **Mastery** | 100 T-Spins, 10 Perfect Clears | ~15 | Reward skill development |
| **Multiplayer** | Win first match, 10 win streak | ~10 | Social validation |
| **Exploration** | Play all themes, Unlock all styles | ~10 | Encourage discovery |
| **Challenge** | Survive 10 min Infinity, No-death Odyssey | ~10 | Hardcore bragging rights |
| **Secrets** | Hidden/special achievements | ~5 | Surprise and delight |

**Total: ~70 achievements**

### 7.2 Achievement Design Best Practices

| Principle | Good ✅ | Bad ❌ |
|-----------|--------|-------|
| **Natural progression** | "Complete Odyssey Chapter 1" | "Click Start 100 times" |
| **Skill-based** | "Clear 4 lines with a T-Spin" | "Clear 10,000 lines total" (grindy) |
| **Clear requirements** | "Win 10 FFA matches" | "Win many times" (vague) |
| **Celebratory moments** | "First multiplayer victory" | "Start a multiplayer game" (trivial) |
| **Appropriately rare** | ~5% for challenges | 0.01% (frustrating) |

### 7.3 Mode-Specific Achievement UX

| Mode | Achievement Popup Behavior |
|------|----------------------------|
| **Odyssey** | Full celebration—pause-while-reading optional |
| **Infinity** | Corner toast—never interrupts gameplay |
| **Serenity** | Minimal—small icon, no sound (preserve calm) |
| **FFA Match** | Quick toast—don't distract during combat |
| **FFA Results** | Full celebration—natural break point |

### 7.4 Achievement API

```javascript
// IPC handlers
steam:unlockAchievement(name)          // Unlock achievement
steam:getAchievements()                // Get all with unlock status
steam:setAchievementProgress(name, current, max)  // Progress display
steam:resetAchievements()              // Dev only
```

### 7.5 Implementation Pattern

```javascript
// Central achievement tracking
class AchievementTracker {
  constructor() {
    this.steam = SteamService.getInstance();
    this.local = new LocalAchievementStore();
    this.queue = new OfflineQueue();
  }
  
  async unlock(name) {
    // Always track locally first
    if (this.local.isUnlocked(name)) return;
    this.local.unlock(name);
    
    // Show in-game celebration
    this.showNotification(name);
    
    // Sync to Steam if available
    if (this.steam.isOnline) {
      await ipcRenderer.invoke('steam:unlockAchievement', name);
    } else {
      this.queue.enqueue('unlockAchievement', name);
    }
  }
  
  showNotification(name) {
    const achievement = ACHIEVEMENT_DEFS[name];
    const mode = GameModeManager.getCurrentMode();
    
    // Mode-appropriate notification
    if (mode === 'serenity') {
      achievementUI.showMinimal(achievement);
    } else if (mode.includes('multiplayer')) {
      achievementUI.showQuick(achievement);
    } else {
      achievementUI.showFull(achievement);
    }
  }
}
```

### 7.6 Deliverables

| Task | Description | Priority |
|------|-------------|----------|
| Define achievement list | Design ~70 achievements | P0 |
| Register on Steamworks | Upload to partner portal | P0 |
| Achievement tracker service | Unified unlock + local tracking | P0 |
| Mode-aware notifications | Different styles per mode | P1 |
| In-game achievement viewer | Browse locked/unlocked | P1 |
| Offline achievement queue | Sync when reconnected | P1 |
| Progress achievements | Visual progress bars | P2 |

---

## Phase 8: Testing & Validation

### 8.1 Manual Test Cases

| Category | Test | Steps | Expected |
|----------|------|-------|----------|
| **Init** | Normal Launch | Launch with Steam running | Steam name/avatar shown |
| **Init** | No Steam | Launch without Steam | "Offline" mode, all features work locally |
| **Init** | Steam Crash | Close Steam during gameplay | Detect disconnect, continue offline |
| **Social** | Create Lobby | Create public FFA lobby | Visible in lobby browser |
| **Social** | Join Lobby | Click join on friend's lobby | Connect, sync player list |
| **Social** | Invite Friend | Send invite from lobby | Friend gets Steam notification |
| **Social** | Accept Invite | Click invite notification | Navigate to lobby |
| **Scores** | Infinity High | Beat personal best | Score uploaded, rank shown |
| **Scores** | Offline High | Beat score while offline | Uploaded when reconnected |
| **Cloud** | Cross-device | Play on device A, launch B | Progress synced |
| **Cloud** | Conflict | Edit on both offline | Conflict dialog with merge option |
| **Achieve** | Unlock | Complete Odyssey Ch.1 | Toast shown, Steam unlocks |
| **Achieve** | Offline | Unlock while offline | Local toast, syncs later |

### 8.2 Automated Health Checks

```javascript
// Run on every startup
async function steamHealthCheck() {
  const checks = [
    { name: 'IPC', fn: () => ipcRenderer.invoke('steam:isInitialized') },
    { name: 'SteamId', fn: () => ipcRenderer.invoke('steam:getSteamId') },
    { name: 'PlayerName', fn: () => ipcRenderer.invoke('steam:getPlayerName') },
    { name: 'Avatar', fn: () => ipcRenderer.invoke('steam:getAvatar') },
    { name: 'Leaderboard', fn: () => ipcRenderer.invoke('steam:getLeaderboard', 'InfinityHighScore', 'global', 0, 1) },
  ];
  
  const results = [];
  for (const check of checks) {
    try {
      const result = await Promise.race([
        check.fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);
      results.push({ name: check.name, success: true, result });
    } catch (err) {
      results.push({ name: check.name, success: false, error: err.message });
    }
  }
  
  console.table(results);
  return results.every(r => r.success);
}
```

### 8.3 Steam Build Testing Workflow

1. **Local Testing**
   - Run with AppID 480 (Spacewar)
   - Test all features manually
   
2. **Depot Upload**
   ```bash
   steamcmd +login <account> +app_build ../app_build.vdf +quit
   ```

3. **Beta Branch**
   - Upload to private "beta" branch
   - Test on multiple team machines
   - Verify achievements unlock correctly
   
4. **Review Build**
   - Submit to Valve via Steamworks
   - Allow 3-5 days for review
   
5. **Release**
   - Set live branch
   - Announce on Steam + social

---

## Implementation Timeline

| Phase | Duration | Dependencies | Focus |
|-------|----------|--------------|-------|
| Phase 1: Foundation | 1 week | None | Reliable initialization, offline handling |
| Phase 2: Player Identity | 1 week | Phase 1 | Avatars, Rich Presence |
| Phase 3: Friends & Social | 1 week | Phase 2 | Invites, join flow |
| Phase 4: Leaderboards | 1 week | Phase 1 | High scores, rankings |
| Phase 5: Cloud Saves | 1 week | Phase 1 | Sync, conflict resolution |
| Phase 6: Fallbacks | 1 week | Phases 1-5 | Offline mode polish |
| Phase 7: Achievements | 2 weeks | Phases 1-6 | ~70 achievements, notifications |
| Phase 8: Testing | 2 weeks | All phases | QA, Steam build pipeline |

**Total: ~10 weeks**

---

## Production Checklist

### Pre-Launch
- [ ] Register production Steam AppID
- [ ] Upload store page assets (5+ screenshots, trailer)
- [ ] Configure achievements on Steamworks (~70)
- [ ] Create leaderboards on Steamworks (~10)
- [ ] Enable Steam Cloud (configure file list)
- [ ] Set up depots and build pipeline
- [ ] Test on 3+ different machines
- [ ] Submit for Steam review (allow 5 days)

### Launch Day
- [ ] Set live branch
- [ ] Verify achievements work for first players
- [ ] Monitor error rates in telemetry
- [ ] Community announcement

### Post-Launch
- [ ] Monitor achievement unlock rates
- [ ] Adjust achievement difficulty if needed
- [ ] Watch for cheated leaderboard scores
- [ ] Respond to Steam reviews

---

## Resources

- [Steamworks Documentation](https://partner.steamgames.com/doc/home)
- [steamworks.js GitHub](https://github.com/nicholascioli/steamworks.js)
- [Electron + Steam Guide](https://partner.steamgames.com/doc/features/steam_controller)
- [Steam Cloud Documentation](https://partner.steamgames.com/doc/features/cloud)
- [Achievement Guidelines](https://partner.steamgames.com/doc/features/achievements)
- [Rich Presence](https://partner.steamgames.com/doc/features/enhancedrichpresence)
