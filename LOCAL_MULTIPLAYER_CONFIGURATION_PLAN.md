# 🎮 Local Multiplayer Configuration & 4-Player Support Implementation Plan

**Date:** October 30, 2025  
**Objective:** Add configuration options to local multiplayer similar to online multiplayer, and extend support from 2 to 4 players.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Phase 1: Research & Planning](#phase-1-research--planning)
4. [Phase 2: Configuration UI](#phase-2-configuration-ui)
5. [Phase 3: Game State Extension](#phase-3-game-state-extension)
6. [Phase 4: Rendering System](#phase-4-rendering-system)
7. [Phase 5: Input Handling](#phase-5-input-handling)
8. [Phase 6: Garbage System](#phase-6-garbage-system)
9. [Phase 7: Testing & Polish](#phase-7-testing--polish)
10. [Risk Assessment](#risk-assessment)
11. [Timeline Estimate](#timeline-estimate)

---

## Overview

### Goals

- ✅ Add configuration modal for local multiplayer (similar to online MP)
- ✅ Support 2-4 players in local multiplayer mode
- ✅ Implement win conditions: frags, time, points, lines, never
- ✅ Add advanced settings: starting level, level progression, boring rules
- ✅ Dynamic board layout (2-player side-by-side, 3-4 player grid)
- ✅ Support keyboard and gamepad inputs for all 4 players

### Current vs Target State

| Feature | Current | Target |
|---------|---------|--------|
| Max Players | 2 | 4 |
| Win Condition | Fixed (7 frags) | Configurable (frags/time/points/lines/never) |
| Starting Level | 1 | Configurable (1-9) |
| Level Progression | No | Configurable |
| Configuration UI | None | Full modal UI |
| Layout | Fixed 2x1 | Dynamic (2x1, 3x1, 4x1) |

---

## Current Architecture Analysis

### Key Files

#### 1. **LocalMultiplayerMode.js** (`src/core/game-modes/LocalMultiplayerMode.js`)
- **Current State:** Hardcoded for 2 players
- **Key Properties:**
  - `roundsToWin: 7` (hardcoded)
  - `p1PhaserGame`, `p2PhaserGame` (separate Phaser instances)
  - `multiplayerState: MultiplayerGameState` (2-player only)
- **Changes Needed:**
  - Accept configuration object
  - Support 2-4 players dynamically
  - Create additional Phaser instances for players 3 & 4
  - Update win condition logic

#### 2. **MultiplayerGameState** (`src/core/multiplayer.js`)
- **Current State:** Fixed 2 players
- **Properties:**
  - `player1`, `player2` (GameState instances)
  - `player1GarbageQueue`, `player2GarbageQueue`
- **Changes Needed:**
  - Use array-based player storage (like `FFAGameStateP2P`)
  - Support dynamic player count (2-4)
  - Update garbage routing logic

#### 3. **MatchConfigModal** (`src/ui/match-config-modal.js`)
- **Current State:** Only used for online multiplayer
- **Reusable Parts:**
  - End condition configuration
  - Advanced settings UI
  - Form validation
- **Changes Needed:**
  - Create `LocalMatchConfigModal` variant
  - Adjust max players to 4 (not 8)
  - Remove network-specific options (lobby type)

#### 4. **HTML Layout** (`public/index.html`)
- **Current State:** Fixed 2-board layout
- **Multiplayer Container:**
  - `#multiplayer-container` with `#p1-side` and `#p2-side`
- **Changes Needed:**
  - Add `#p3-side` and `#p4-side`
  - Dynamic CSS classes for horizontal layouts (2x1, 3x1, 4x1)
  - Responsive sizing for 4 boards

---

## Phase 1: Research & Planning ✅

**Duration:** Completed  
**Status:** ✅ COMPLETE

### Deliverables

- ✅ Architecture analysis complete
- ✅ Code dependencies mapped
- ✅ Risk assessment documented
- ✅ Phased implementation plan created

---

## Phase 2: Configuration UI

**Duration:** 1-2 days  
**Objective:** Create a configuration modal for local multiplayer settings.

### 2.1 Create LocalMatchConfigModal Component

**File:** `src/ui/local-match-config-modal.js`

```javascript
/**
 * Local Match Configuration Modal
 * 
 * UI for configuring local multiplayer matches (2-4 players)
 */

export class LocalMatchConfigModal {
  constructor(onStartMatch) {
    this.onStartMatch = onStartMatch;
    this.container = null;
    
    this.createUI();
  }
  
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'local-match-config-modal';
    this.container.className = 'match-config-modal hidden';
    
    this.container.innerHTML = `
      <div class="match-config-overlay"></div>
      <div class="match-config-content">
        <div class="match-config-header">
          <h2>🎮 Local Multiplayer Setup</h2>
          <button class="close-btn" id="close-local-match-config">✕</button>
        </div>
        
        <form id="local-match-config-form" class="match-config-form">
          <!-- Number of Players -->
          <div class="form-group">
            <label for="num-players">Number of Players</label>
            <select id="num-players" name="numPlayers">
              <option value="2" selected>2 Players</option>
              <option value="3">3 Players</option>
              <option value="4">4 Players</option>
            </select>
            <small class="form-help">Local players on same computer</small>
          </div>
          
          <!-- Win Condition -->
          <div class="form-group">
            <label for="end-condition">Win Condition</label>
            <select id="end-condition" name="endCondition">
              <option value="frags" selected>Frags (Kills)</option>
              <option value="time">Time Limit</option>
              <option value="points">Score Target</option>
              <option value="lines">Lines Cleared</option>
              <option value="never">Never (Play Forever)</option>
            </select>
          </div>
          
          <!-- Win Condition Value -->
          <div class="form-group" id="end-value-group">
            <label for="end-condition-value" id="end-value-label">Frags to Win</label>
            <input 
              type="number" 
              id="end-condition-value" 
              name="endConditionValue"
              min="1"
              max="999"
              value="7"
            />
            <small class="form-help" id="end-value-help">First player to 7 frags wins</small>
          </div>
          
          <!-- Advanced Settings -->
          <details class="advanced-settings">
            <summary>⚙️ Advanced Settings</summary>
            
            <div class="form-group">
              <label for="start-level">Starting Level (1-9)</label>
              <input 
                type="number" 
                id="start-level" 
                name="startLevel"
                min="1"
                max="9"
                value="1"
              />
              <small class="form-help">Higher level = faster pieces</small>
            </div>
            
            <div class="form-group">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  id="level-progression" 
                  name="levelProgression"
                />
                <span>Enable Level Progression</span>
              </label>
              <small class="form-help">Level increases every 15 lines</small>
            </div>
            
            <div class="form-group">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  id="boring-rules" 
                  name="boringRules"
                />
                <span>Boring Rules (No Attack Scaling)</span>
              </label>
              <small class="form-help">Attacks always deal full damage</small>
            </div>
          </details>
          
          <!-- Action Buttons -->
          <div class="form-actions">
            <button type="button" class="btn-secondary" id="cancel-local-match">
              Cancel
            </button>
            <button type="submit" class="btn-primary">
              🚀 Start Match
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(this.container);
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    // Close button
    const closeBtn = this.container.querySelector('#close-local-match-config');
    closeBtn?.addEventListener('click', () => this.hide());
    
    // Cancel button
    const cancelBtn = this.container.querySelector('#cancel-local-match');
    cancelBtn?.addEventListener('click', () => this.hide());
    
    // Overlay click
    const overlay = this.container.querySelector('.match-config-overlay');
    overlay?.addEventListener('click', () => this.hide());
    
    // End condition change
    const endCondition = this.container.querySelector('#end-condition');
    endCondition?.addEventListener('change', (e) => {
      this.updateEndConditionUI(e.target.value);
    });
    
    // Form submit
    const form = this.container.querySelector('#local-match-config-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });
  }
  
  updateEndConditionUI(condition) {
    const valueGroup = this.container.querySelector('#end-value-group');
    const valueLabel = this.container.querySelector('#end-value-label');
    const valueInput = this.container.querySelector('#end-condition-value');
    const valueHelp = this.container.querySelector('#end-value-help');
    
    const configs = {
      frags: {
        label: 'Frags to Win',
        defaultValue: 7,
        help: 'First player to reach this many frags wins',
        min: 1,
        max: 100,
      },
      time: {
        label: 'Time Limit (minutes)',
        defaultValue: 3,
        help: 'Player with highest score after this time wins',
        min: 1,
        max: 60,
      },
      points: {
        label: 'Score Target (thousands)',
        defaultValue: 10,
        help: 'First player to reach this score wins (e.g., 10 = 10,000 points)',
        min: 1,
        max: 999,
      },
      lines: {
        label: 'Lines to Clear',
        defaultValue: 100,
        help: 'First player to clear this many lines wins',
        min: 10,
        max: 999,
      },
      never: {
        label: 'No Win Condition',
        defaultValue: 0,
        help: 'Match continues until manually ended',
        min: 0,
        max: 0,
      },
    };
    
    const config = configs[condition];
    
    if (condition === 'never') {
      valueGroup.style.display = 'none';
    } else {
      valueGroup.style.display = 'block';
      valueLabel.textContent = config.label;
      valueInput.value = config.defaultValue;
      valueInput.min = config.min;
      valueInput.max = config.max;
      valueHelp.textContent = config.help;
    }
  }
  
  handleSubmit() {
    const form = this.container.querySelector('#local-match-config-form');
    const formData = new FormData(form);
    
    const config = {
      numPlayers: parseInt(formData.get('numPlayers')),
      endCondition: formData.get('endCondition'),
      endConditionValue: parseInt(formData.get('endConditionValue')) || 0,
      startLevel: parseInt(formData.get('startLevel')),
      levelProgression: formData.get('levelProgression') === 'on',
      boringRules: formData.get('boringRules') === 'on',
    };
    
    console.log('[LocalMatchConfig] Starting match with config:', config);
    
    this.hide();
    
    if (this.onStartMatch) {
      this.onStartMatch(config);
    }
  }
  
  show() {
    this.container.classList.remove('hidden');
    this.container.classList.add('show');
  }
  
  hide() {
    this.container.classList.remove('show');
    this.container.classList.add('hidden');
  }
  
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
```

### 2.2 Update LocalMultiplayerMode to Show Config Modal

**File:** `src/core/game-modes/LocalMultiplayerMode.js`

**Changes:**
1. Import `LocalMatchConfigModal`
2. Store configuration from modal
3. Show modal on mode activation instead of starting immediately

```javascript
import { LocalMatchConfigModal } from '../../ui/local-match-config-modal.js';

export class LocalMultiplayerMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);
        
        // ... existing code ...
        
        // Configuration
        this.matchConfig = null;
        this.configModal = null;
        
        // Remove hardcoded roundsToWin (will come from config)
    }
    
    async onActivate() {
        await super.onActivate();
        
        console.log('[LocalMultiplayer] Activating local multiplayer mode...');
        
        // Show configuration modal
        if (!this.configModal) {
            this.configModal = new LocalMatchConfigModal((config) => {
                this.matchConfig = config;
                this.startMatchWithConfig(config);
            });
        }
        
        this.configModal.show();
    }
    
    async startMatchWithConfig(config) {
        console.log('[LocalMultiplayer] Starting match with config:', config);
        
        // Store config
        this.matchConfig = config;
        
        // Setup UI for appropriate number of players
        await this._setupMultiplayerUI(config.numPlayers);
        
        // Start the game
        await this.onStart();
    }
}
```

### 2.3 Update CSS Styles

**File:** `styles/match-config.css` (or add to existing styles)

Reuse existing modal styles from online multiplayer, no major CSS changes needed.

### Deliverables

- ✅ `LocalMatchConfigModal` component created
- ✅ Modal integrated into `LocalMultiplayerMode`
- ✅ Configuration flow working for 2 players
- ✅ Ready for multi-player state extension

---

## Phase 3: Game State Extension

**Duration:** 2-3 days  
**Objective:** Extend game state to support 2-4 players dynamically.

### 3.1 Create MultiPlayerState Class

**File:** `src/core/multi-player-state.js` (NEW)

This will replace `MultiplayerGameState` for 2-4 player local multiplayer.

```javascript
/**
 * @fileoverview Multi-player game state for 2-4 player local multiplayer
 * Manages N independent game states with garbage interaction
 */

import { GameState, markBoardDirty } from './game.js';
import {
    GarbageQueue, calculateGarbage, insertGarbageEntries, ATTACK_TYPES,
} from './garbage.js';
import { processPhysics } from './physics.js';

/**
 * Multi-player game state that manages 2-4 players
 */
export class MultiPlayerState {
    constructor(numPlayers = 2) {
        this.numPlayers = numPlayers;
        
        // Player game states (array-based for scalability)
        this.players = [];
        this.garbageQueues = [];
        
        for (let i = 0; i < numPlayers; i++) {
            this.players.push(new GameState());
            this.garbageQueues.push(new GarbageQueue());
        }
        
        // Match configuration
        this.matchConfig = {
            endCondition: 'frags',
            endConditionValue: 7,
            startLevel: 1,
            levelProgression: false,
            boringRules: false,
        };
        
        // Match state
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null; // Player index (0-3) or null
        this.matchStartTime = 0;
        
        // Frag tracking
        this.frags = new Array(numPlayers).fill(0);
        this.lastAttackerIds = new Array(numPlayers).fill(null); // Track who last attacked each player
        
        // Timing
        this.lastTime = 0;
        this.animationId = null;
        
        // Attack sequencing per player
        this.attackSequences = new Array(numPlayers).fill(0);
    }
    
    /**
     * Set match configuration
     */
    setMatchConfig(config) {
        this.matchConfig = { ...this.matchConfig, ...config };
    }
    
    /**
     * Reset the game state
     */
    reset() {
        for (let i = 0; i < this.numPlayers; i++) {
            this.players[i].reset();
            this.garbageQueues[i].clear();
            this.frags[i] = 0;
            this.lastAttackerIds[i] = null;
        }
        
        this.isGameOver = false;
        this.isPaused = false;
        this.winner = null;
        this.lastTime = 0;
        this.matchStartTime = Date.now();
    }
    
    /**
     * Get player state by index
     */
    getPlayerState(playerIndex) {
        return this.players[playerIndex];
    }
    
    /**
     * Get garbage queue by index
     */
    getGarbageQueue(playerIndex) {
        return this.garbageQueues[playerIndex];
    }
    
    /**
     * Handle garbage summary and route to opponents
     * 
     * For 2 players: Send to other player
     * For 3+ players: Distribute to all other players
     */
    handleGarbageSummary(playerIndex, summary, onGarbageSend) {
        const attack = calculateGarbage(summary);
        const attackerState = this.players[playerIndex];
        
        const sequence = typeof summary.sequence === 'number'
            ? summary.sequence
            : this.attackSequences[playerIndex]++;
        const attackId = `P${playerIndex}-A${sequence}`;
        attack.withId(attackId);
        
        const totalLines = attack.getTotalLines();
        
        console.log(
            `[MultiPlayerState] Player ${playerIndex + 1} cascade resolved → depth=${attack.depth}, combo=${attack.complexity}`,
        );
        console.log(
            `[MultiPlayerState]   Total attack rows: ${totalLines} (clean bonus: ${attack.cleanBonus})`,
        );
        
        if (totalLines <= 0 && attack.attackType !== ATTACK_TYPES.BLIND) {
            return;
        }
        
        const context = {
            color: summary.sourceColor || attackerState.comboState?.sourceColor || '#808080',
        };
        
        const entries = attack.expandEntries(context);
        
        // Route garbage to all opponents
        const targets = this._getAttackTargets(playerIndex);
        
        targets.forEach((targetIndex) => {
            // Track last attacker for frag attribution
            this.lastAttackerIds[targetIndex] = playerIndex;
            
            const targetQueue = this.garbageQueues[targetIndex];
            const queueableEntries = [];
            
            entries.forEach((entry) => {
                if (entry.type === 'full_blind') {
                    targetQueue.addEntry({
                        type: 'full_blind',
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else if (entry.type === 'blind') {
                    targetQueue.addEntry({
                        type: 'blind',
                        sourcePlayerId: playerIndex,
                        attackId,
                    });
                } else {
                    queueableEntries.push(entry);
                }
            });
            
            if (queueableEntries.length > 0) {
                insertGarbageEntries(targetQueue, queueableEntries, attackId, playerIndex);
            }
            
            console.log(
                `[MultiPlayerState] Player ${playerIndex + 1} → Player ${targetIndex + 1}: ${totalLines} lines`,
            );
        });
        
        if (onGarbageSend) {
            onGarbageSend(playerIndex, targets, totalLines);
        }
    }
    
    /**
     * Determine attack targets for a player
     * 
     * For 2 players: Always attack the other player
     * For 3-4 players: Attack all other players (evenly distributed)
     */
    _getAttackTargets(attackerIndex) {
        const targets = [];
        
        for (let i = 0; i < this.numPlayers; i++) {
            if (i !== attackerIndex && this.players[i].isAlive) {
                targets.push(i);
            }
        }
        
        return targets;
    }
    
    /**
     * Mark a player as dead and award frag
     */
    handlePlayerDeath(playerIndex) {
        const player = this.players[playerIndex];
        
        if (!player.isAlive) {
            return; // Already dead
        }
        
        player.isAlive = false;
        
        // Award frag to last attacker
        const killerId = this.lastAttackerIds[playerIndex];
        
        if (killerId !== null && killerId !== playerIndex) {
            this.frags[killerId]++;
            console.log(
                `[MultiPlayerState] Player ${killerId + 1} fragged Player ${playerIndex + 1}! Frags: ${this.frags[killerId]}`,
            );
        } else {
            console.log(`[MultiPlayerState] Player ${playerIndex + 1} self-destructed (no frag awarded)`);
        }
        
        // Check win condition
        this.checkWinCondition();
    }
    
    /**
     * Check if match should end based on win condition
     */
    checkWinCondition() {
        const config = this.matchConfig;
        const alivePlayers = this.players.filter(p => p.isAlive);
        
        // Last player standing always wins
        if (alivePlayers.length === 1) {
            const winnerIndex = this.players.findIndex(p => p.isAlive);
            this.endMatch(winnerIndex);
            return;
        }
        
        // All players dead = draw
        if (alivePlayers.length === 0) {
            this.endMatch(null); // Draw
            return;
        }
        
        // Check specific conditions
        switch (config.endCondition) {
            case 'frags': {
                const topPlayerIndex = this.frags.indexOf(Math.max(...this.frags));
                if (this.frags[topPlayerIndex] >= config.endConditionValue) {
                    this.endMatch(topPlayerIndex);
                }
                break;
            }
            
            case 'time': {
                const elapsed = (Date.now() - this.matchStartTime) / 1000 / 60; // minutes
                if (elapsed >= config.endConditionValue) {
                    // Winner is player with highest score
                    const scores = this.players.map(p => p.score);
                    const topPlayerIndex = scores.indexOf(Math.max(...scores));
                    this.endMatch(topPlayerIndex);
                }
                break;
            }
            
            case 'points': {
                const targetScore = config.endConditionValue * 1000;
                const topPlayerIndex = this.players.findIndex(p => p.score >= targetScore);
                if (topPlayerIndex !== -1) {
                    this.endMatch(topPlayerIndex);
                }
                break;
            }
            
            case 'lines': {
                const topPlayerIndex = this.players.findIndex(p => p.totalLinesCleared >= config.endConditionValue);
                if (topPlayerIndex !== -1) {
                    this.endMatch(topPlayerIndex);
                }
                break;
            }
            
            case 'never':
                // Never end automatically
                break;
        }
    }
    
    /**
     * End the match with a winner
     */
    endMatch(winnerIndex) {
        this.isGameOver = true;
        this.winner = winnerIndex;
        
        if (winnerIndex !== null) {
            console.log(`[MultiPlayerState] 🏆 Player ${winnerIndex + 1} wins!`);
        } else {
            console.log('[MultiPlayerState] 🤝 Match ended in a draw');
        }
    }
}
```

### 3.2 Update LocalMultiplayerMode to Use MultiPlayerState

**File:** `src/core/game-modes/LocalMultiplayerMode.js`

```javascript
import { MultiPlayerState } from '../multi-player-state.js';

export class LocalMultiplayerMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);
        
        // Replace MultiplayerGameState with MultiPlayerState
        this.multiPlayerState = null;
        
        // Player-specific resources (array-based)
        this.playerPhaserGames = [];
        this.playerBoardScenes = [];
        this.playerNextCanvases = [];
    }
    
    async startMatchWithConfig(config) {
        console.log('[LocalMultiplayer] Starting match with config:', config);
        
        // Create multi-player state
        this.multiPlayerState = new MultiPlayerState(config.numPlayers);
        this.multiPlayerState.setMatchConfig(config);
        
        // Setup UI and Phaser instances
        await this._setupPlayers(config.numPlayers);
        
        // Start match
        await this.onStart();
    }
    
    async _setupPlayers(numPlayers) {
        // Clear existing players
        this._cleanupPlayers();
        
        // Create Phaser game instances for each player
        for (let i = 0; i < numPlayers; i++) {
            const phaserGame = await this._createPhaserGameForPlayer(i);
            this.playerPhaserGames.push(phaserGame);
        }
        
        // Get next piece canvases
        for (let i = 0; i < numPlayers; i++) {
            const nextCanvases = Array.from({ length: 3 }, (_, j) => 
                document.getElementById(`p${i + 1}-next-${j}`)
            );
            this.playerNextCanvases.push(nextCanvases);
        }
    }
    
    _cleanupPlayers() {
        // Destroy all Phaser instances
        this.playerPhaserGames.forEach(game => game?.destroy(true));
        this.playerPhaserGames = [];
        this.playerBoardScenes = [];
        this.playerNextCanvases = [];
    }
}
```

### Deliverables

- ✅ `MultiPlayerState` class created
- ✅ Support for 2-4 players
- ✅ Win condition logic implemented
- ✅ Frag tracking working
- ✅ Garbage routing for N players

---

## Phase 4: Rendering System

**Duration:** 2-3 days  
**Objective:** Update UI and rendering to support 4 game boards dynamically.

### 4.1 Update HTML Structure

**File:** `public/index.html`

Add player 3 and 4 containers to the multiplayer section:

```html
<!-- Multiplayer Container (2-4 players) -->
<div id="multiplayer-container" class="game-container" style="display: none;">
  <div id="multiplayer-grid" class="multiplayer-grid grid-2-player">
    <!-- Player 1 -->
    <div id="p1-side" class="player-side">
      <div class="player-header">
        <h2 class="player-label">Player 1</h2>
        <div class="player-stats">
          <span id="p1-score-label" class="stat-label">Score: <span id="p1-score">0</span></span>
          <span id="p1-lines-label" class="stat-label">Lines: <span id="p1-lines">0</span></span>
          <span id="p1-frags-label" class="stat-label">Frags: <span id="p1-frags">0</span></span>
        </div>
      </div>
      <div id="p1-board-container" class="board-container"></div>
      <div id="p1-next-pieces" class="next-pieces">
        <canvas id="p1-next-0" width="80" height="80"></canvas>
        <canvas id="p1-next-1" width="80" height="80"></canvas>
        <canvas id="p1-next-2" width="80" height="80"></canvas>
      </div>
    </div>
    
    <!-- Player 2 -->
    <div id="p2-side" class="player-side">
      <div class="player-header">
        <h2 class="player-label">Player 2</h2>
        <div class="player-stats">
          <span id="p2-score-label" class="stat-label">Score: <span id="p2-score">0</span></span>
          <span id="p2-lines-label" class="stat-label">Lines: <span id="p2-lines">0</span></span>
          <span id="p2-frags-label" class="stat-label">Frags: <span id="p2-frags">0</span></span>
        </div>
      </div>
      <div id="p2-board-container" class="board-container"></div>
      <div id="p2-next-pieces" class="next-pieces">
        <canvas id="p2-next-0" width="80" height="80"></canvas>
        <canvas id="p2-next-1" width="80" height="80"></canvas>
        <canvas id="p2-next-2" width="80" height="80"></canvas>
      </div>
    </div>
    
    <!-- Player 3 -->
    <div id="p3-side" class="player-side" style="display: none;">
      <div class="player-header">
        <h2 class="player-label">Player 3</h2>
        <div class="player-stats">
          <span id="p3-score-label" class="stat-label">Score: <span id="p3-score">0</span></span>
          <span id="p3-lines-label" class="stat-label">Lines: <span id="p3-lines">0</span></span>
          <span id="p3-frags-label" class="stat-label">Frags: <span id="p3-frags">0</span></span>
        </div>
      </div>
      <div id="p3-board-container" class="board-container"></div>
      <div id="p3-next-pieces" class="next-pieces">
        <canvas id="p3-next-0" width="80" height="80"></canvas>
        <canvas id="p3-next-1" width="80" height="80"></canvas>
        <canvas id="p3-next-2" width="80" height="80"></canvas>
      </div>
    </div>
    
    <!-- Player 4 -->
    <div id="p4-side" class="player-side" style="display: none;">
      <div class="player-header">
        <h2 class="player-label">Player 4</h2>
        <div class="player-stats">
          <span id="p4-score-label" class="stat-label">Score: <span id="p4-score">0</span></span>
          <span id="p4-lines-label" class="stat-label">Lines: <span id="p4-lines">0</span></span>
          <span id="p4-frags-label" class="stat-label">Frags: <span id="p4-frags">0</span></span>
        </div>
      </div>
      <div id="p4-board-container" class="board-container"></div>
      <div id="p4-next-pieces" class="next-pieces">
        <canvas id="p4-next-0" width="80" height="80"></canvas>
        <canvas id="p4-next-1" width="80" height="80"></canvas>
        <canvas id="p4-next-2" width="80" height="80"></canvas>
      </div>
    </div>
  </div>
  
  <!-- Match Info -->
  <div id="match-info" class="match-info">
    <div id="match-condition">First to 7 frags wins</div>
  </div>
</div>
```

### 4.2 Add CSS for Dynamic Layouts

**File:** `styles/multiplayer.css`

```css
/* Multiplayer Grid Container */
.multiplayer-grid {
  display: grid;
  gap: 20px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

/* 2-Player Layout (side-by-side) */
.multiplayer-grid.grid-2-player {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr;
}

/* 3-Player Layout (horizontal row) */
.multiplayer-grid.grid-3-player {
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr;
}

/* 4-Player Layout (horizontal row) */
.multiplayer-grid.grid-4-player {
  grid-template-columns: 1fr 1fr 1fr 1fr;
  grid-template-rows: 1fr;
}

/* Player Side */
.player-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.3);
  padding: 15px;
  border-radius: 10px;
  border: 2px solid rgba(255, 255, 255, 0.1);
}

.player-header {
  width: 100%;
  text-align: center;
  margin-bottom: 10px;
}

.player-label {
  font-size: 1.5em;
  margin: 0 0 10px 0;
  color: #fff;
}

.player-stats {
  display: flex;
  justify-content: center;
  gap: 15px;
  font-size: 0.9em;
}

.stat-label {
  color: rgba(255, 255, 255, 0.8);
}

/* Board Container */
.board-container {
  position: relative;
  margin: 10px 0;
}

/* Next Pieces */
.next-pieces {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 10px;
}

.next-pieces canvas {
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.5);
}

/* Match Info */
.match-info {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  padding: 10px 20px;
  border-radius: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  z-index: 100;
}

#match-condition {
  color: #fff;
  font-size: 1.1em;
  font-weight: bold;
  text-align: center;
}

/* Responsive Adjustments */
@media (max-width: 1200px) {
  .multiplayer-grid {
    gap: 15px;
    padding: 15px;
  }
  
  .player-label {
    font-size: 1.2em;
  }
}

@media (max-width: 900px) {
  /* Stack all players vertically on small screens */
  .multiplayer-grid.grid-2-player,
  .multiplayer-grid.grid-3-player,
  .multiplayer-grid.grid-4-player {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
}
```

### 4.3 Update LocalMultiplayerMode UI Setup

**File:** `src/core/game-modes/LocalMultiplayerMode.js`

```javascript
async _setupMultiplayerUI(numPlayers) {
    const multiplayerContainer = document.getElementById('multiplayer-container');
    const multiplayerGrid = document.getElementById('multiplayer-grid');
    
    if (!multiplayerContainer || !multiplayerGrid) {
        console.error('[LocalMultiplayer] Multiplayer containers not found');
        return;
    }
    
    // Update grid layout class
    multiplayerGrid.className = 'multiplayer-grid';
    multiplayerGrid.classList.add(`grid-${numPlayers}-player`);
    
    // Show/hide player sides based on numPlayers
    for (let i = 1; i <= 4; i++) {
        const playerSide = document.getElementById(`p${i}-side`);
        if (playerSide) {
            playerSide.style.display = i <= numPlayers ? 'flex' : 'none';
        }
    }
    
    // Update match info
    this._updateMatchInfo();
    
    // Show multiplayer container
    multiplayerContainer.style.display = 'block';
}

_updateMatchInfo() {
    const matchCondition = document.getElementById('match-condition');
    if (!matchCondition || !this.matchConfig) {
        return;
    }
    
    const config = this.matchConfig;
    let text = '';
    
    switch (config.endCondition) {
        case 'frags':
            text = `First to ${config.endConditionValue} frags wins`;
            break;
        case 'time':
            text = `${config.endConditionValue} minute time limit`;
            break;
        case 'points':
            text = `First to ${config.endConditionValue * 1000} points wins`;
            break;
        case 'lines':
            text = `First to ${config.endConditionValue} lines wins`;
            break;
        case 'never':
            text = 'Play until manual end';
            break;
    }
    
    matchCondition.textContent = text;
}
```

### Deliverables

- ✅ HTML structure supports 4 players
- ✅ Dynamic CSS layouts for 2/3/4 players
- ✅ UI automatically adjusts based on player count
- ✅ Match info displays win condition

---

## Phase 5: Input Handling

**Duration:** 2 days  
**Objective:** Support keyboard and gamepad input for 4 players.

### 5.1 Input Mapping Strategy

| Player | Keyboard Layout | Gamepad Index |
|--------|----------------|---------------|
| Player 1 | Arrow Keys + RShift/RCtrl/Enter | Gamepad 0 |
| Player 2 | WASD + LShift/LCtrl/Tab | Gamepad 1 |
| Player 3 | IJKL + U/O/P | Gamepad 2 |
| Player 4 | Numpad 8456 + Numpad 7/9/+ | Gamepad 3 |

### 5.2 Update Input Manager

**File:** `src/input/input-manager.js`

```javascript
// Player 3 keyboard layout (IJKL)
const PLAYER3_KEYS = {
    LEFT: 'KeyJ',
    RIGHT: 'KeyL',
    DOWN: 'KeyK',
    UP: 'KeyI',
    ROTATE_CW: 'KeyU',
    ROTATE_CCW: 'KeyO',
    HARD_DROP: 'KeyP',
};

// Player 4 keyboard layout (Numpad)
const PLAYER4_KEYS = {
    LEFT: 'Numpad4',
    RIGHT: 'Numpad6',
    DOWN: 'Numpad5',
    UP: 'Numpad8',
    ROTATE_CW: 'Numpad7',
    ROTATE_CCW: 'Numpad9',
    HARD_DROP: 'NumpadAdd',
};

export class InputManager {
    constructor() {
        // ... existing code ...
        
        this.playerKeyMaps = [
            PLAYER1_KEYS,
            PLAYER2_KEYS,
            PLAYER3_KEYS,
            PLAYER4_KEYS,
        ];
    }
    
    /**
     * Check if a specific action is pressed for a player
     */
    isPlayerActionPressed(playerIndex, action) {
        const keyMap = this.playerKeyMaps[playerIndex];
        const key = keyMap[action];
        
        if (!key) {
            return false;
        }
        
        // Check keyboard
        if (this.keys[key]) {
            return true;
        }
        
        // Check gamepad
        const gamepad = this.getGamepad(playerIndex);
        if (gamepad) {
            return this.isGamepadActionPressed(gamepad, action);
        }
        
        return false;
    }
    
    /**
     * Get gamepad for player
     */
    getGamepad(playerIndex) {
        const gamepads = navigator.getGamepads();
        return gamepads[playerIndex];
    }
}
```

### 5.3 Update LocalMultiplayerMode Input Handling

**File:** `src/core/game-modes/LocalMultiplayerMode.js`

```javascript
_handleInput() {
    if (!this.multiPlayerState || this.multiPlayerState.isPaused) {
        return;
    }
    
    const numPlayers = this.multiPlayerState.numPlayers;
    
    for (let i = 0; i < numPlayers; i++) {
        const player = this.multiPlayerState.players[i];
        
        if (!player.isAlive || player.isPaused) {
            continue;
        }
        
        // Handle movement
        if (this.inputManager.isPlayerActionPressed(i, 'LEFT')) {
            this._movePlayer(i, -1, 0);
        }
        if (this.inputManager.isPlayerActionPressed(i, 'RIGHT')) {
            this._movePlayer(i, 1, 0);
        }
        if (this.inputManager.isPlayerActionPressed(i, 'DOWN')) {
            this._movePlayer(i, 0, 1);
        }
        
        // Handle rotation
        if (this.inputManager.isPlayerActionPressed(i, 'ROTATE_CW')) {
            this._rotatePlayer(i, 1);
        }
        if (this.inputManager.isPlayerActionPressed(i, 'ROTATE_CCW')) {
            this._rotatePlayer(i, -1);
        }
        
        // Handle hard drop
        if (this.inputManager.isPlayerActionPressed(i, 'HARD_DROP')) {
            this._hardDropPlayer(i);
        }
    }
}
```

### Deliverables

- ✅ 4 keyboard layouts defined
- ✅ Gamepad support for 4 controllers
- ✅ Input manager updated
- ✅ All players can control independently

---

## Phase 6: Garbage System

**Duration:** 1 day  
**Objective:** Update garbage routing for 3-4 players.

### 6.1 Attack Distribution Logic

The `MultiPlayerState` class already handles this in `_getAttackTargets()`:

- **2 players:** Send to the other player (1-to-1)
- **3 players:** Send to both opponents (1-to-2)
- **4 players:** Send to all three opponents (1-to-3)

### 6.2 Attack Scaling for Balance

**File:** `src/core/multi-player-state.js`

```javascript
/**
 * Apply attack scaling based on number of players
 * Similar to Quadra's "boring rules" system
 */
_scaleAttackForPlayerCount(totalLines) {
    if (this.matchConfig.boringRules) {
        return totalLines; // No scaling
    }
    
    // Scale down attacks when more players are active
    const alivePlayers = this.players.filter(p => p.isAlive).length;
    
    if (alivePlayers <= 2) {
        return totalLines; // Full damage for 2 players
    } else if (alivePlayers === 3) {
        return Math.ceil(totalLines * 0.75); // 75% damage for 3 players
    } else {
        return Math.ceil(totalLines * 0.5); // 50% damage for 4 players
    }
}

handleGarbageSummary(playerIndex, summary, onGarbageSend) {
    // ... existing code ...
    
    let totalLines = attack.getTotalLines();
    
    // Apply scaling
    totalLines = this._scaleAttackForPlayerCount(totalLines);
    
    // ... rest of code ...
}
```

### Deliverables

- ✅ Garbage routes to all opponents
- ✅ Attack scaling for balance
- ✅ Configurable "boring rules" (no scaling)

---

## Phase 7: Testing & Polish

**Duration:** 2-3 days  
**Objective:** Comprehensive testing and bug fixes.

### 7.1 Testing Checklist

#### 2-Player Mode
- [ ] Configuration modal shows and saves settings
- [ ] 2 boards render side-by-side
- [ ] Both players can move/rotate/drop
- [ ] Garbage attacks work bidirectionally
- [ ] Win conditions work (frags, time, points, lines)
- [ ] Frags are tracked correctly
- [ ] Match ends when condition is met

#### 3-Player Mode
- [ ] 3 boards render in correct layout
- [ ] All 3 players have independent controls
- [ ] Garbage distributes to 2 opponents
- [ ] Attack scaling works (75% damage)
- [ ] Win conditions work correctly
- [ ] Proper frag attribution

#### 4-Player Mode
- [ ] 4 boards render in horizontal row (4x1)
- [ ] All 4 players have controls
- [ ] Keyboard layouts don't conflict
- [ ] Gamepad support works for 4 controllers
- [ ] Garbage distributes to 3 opponents
- [ ] Attack scaling works (50% damage)
- [ ] Win conditions work
- [ ] Performance is acceptable

#### Win Conditions
- [ ] Frags: Match ends at target
- [ ] Time: Match ends after duration
- [ ] Points: Match ends at score target
- [ ] Lines: Match ends at line count
- [ ] Never: Match continues indefinitely

#### Advanced Settings
- [ ] Starting level affects piece speed
- [ ] Level progression works (every 15 lines)
- [ ] Boring rules disables attack scaling

### 7.2 Performance Optimization

**File:** `src/core/game-modes/LocalMultiplayerMode.js`

```javascript
/**
 * Optimize rendering for 4 boards
 * - Reduce Phaser canvas size
 * - Lower particle counts
 * - Disable expensive effects
 */
_optimizeForPlayerCount(numPlayers) {
    if (numPlayers >= 3) {
        // Reduce board size
        this.boardConfig.width = 300;
        this.boardConfig.height = 600;
        
        // Lower particle density
        this.effectsConfig.particleCount = 50;
        
        // Disable camera shake for performance
        this.effectsConfig.cameraShake = false;
    }
}
```

### 7.3 Bug Fixes

Common issues to watch for:
1. **Input conflicts** between players
2. **Garbage queue desync** between players
3. **Win condition not triggering** properly
4. **Board rendering overlap** in 4-player mode
5. **Performance drops** with 4 active boards

### Deliverables

- ✅ All test cases pass
- ✅ No critical bugs
- ✅ Performance is acceptable
- ✅ User experience is smooth

---

## Risk Assessment

### High Risk

1. **Performance with 4 Phaser Instances**
   - **Risk:** Low FPS on slower machines
   - **Mitigation:** Optimize rendering, reduce particle effects, lower resolution
   - **Fallback:** Limit to 3 players or use simpler graphics

2. **Input Conflicts**
   - **Risk:** Keyboard layouts interfere with each other
   - **Mitigation:** Test extensively, provide gamepad-first option
   - **Fallback:** Require gamepads for players 3-4

### Medium Risk

1. **Garbage Routing Complexity**
   - **Risk:** Unbalanced gameplay with 3-4 players
   - **Mitigation:** Implement attack scaling, extensive balance testing
   - **Fallback:** "Boring rules" option for no scaling

2. **UI Layout on Small Screens**
   - **Risk:** 4 boards don't fit on 1080p monitors
   - **Mitigation:** Responsive CSS, scale down boards
   - **Fallback:** Force full-screen mode

### Low Risk

1. **Configuration Modal Bugs**
   - **Risk:** Settings not saving correctly
   - **Mitigation:** Reuse tested online MP modal code
   - **Fallback:** Hard-coded defaults

---

## Timeline Estimate

| Phase | Duration | Dependencies | Parallel Work Possible? |
|-------|----------|--------------|------------------------|
| Phase 1: Research | ✅ Complete | None | N/A |
| Phase 2: Config UI | 1-2 days | Phase 1 | ❌ |
| Phase 3: Game State | 2-3 days | Phase 2 | ❌ |
| Phase 4: Rendering | 2-3 days | Phase 3 | ❌ |
| Phase 5: Input | 2 days | Phase 4 | ✅ (can overlap with Phase 4) |
| Phase 6: Garbage | 1 day | Phase 3, 5 | ✅ (can overlap) |
| Phase 7: Testing | 2-3 days | All phases | ❌ |

**Total Estimated Time:** 10-14 days

**Realistic Timeline (with buffer):** 2-3 weeks

---

## Implementation Order

### Week 1: Foundation
1. **Day 1-2:** Phase 2 (Config UI)
2. **Day 3-5:** Phase 3 (Game State)
3. **Day 6-7:** Phase 4 Part 1 (HTML/CSS layout)

### Week 2: Core Features
1. **Day 8-9:** Phase 4 Part 2 (Rendering integration)
2. **Day 10-11:** Phase 5 (Input handling)
3. **Day 12:** Phase 6 (Garbage system)
4. **Day 13-14:** Phase 7 Part 1 (Initial testing)

### Week 3: Polish
1. **Day 15-17:** Phase 7 Part 2 (Bug fixes)
2. **Day 18-19:** Performance optimization
3. **Day 20-21:** Final testing and polish

---

## Success Criteria

### Must Have (P0)
- ✅ Configuration modal for local multiplayer
- ✅ Support for 2, 3, and 4 players
- ✅ All 5 win conditions working
- ✅ Input handling for 4 players (keyboard + gamepad)
- ✅ Garbage system working correctly
- ✅ No game-breaking bugs

### Should Have (P1)
- ✅ Responsive UI for different screen sizes
- ✅ Performance optimization for 4 players
- ✅ Attack scaling for balance
- ✅ Match info display

### Nice to Have (P2)
- ⚠️ Player customization (names, colors)
- ⚠️ Spectator mode replay
- ⚠️ Match history/statistics
- ⚠️ Tournament bracket system

---

## Next Steps

1. **Review this plan** with the team
2. **Create GitHub issues** for each phase
3. **Set up feature branch** (`feature/local-mp-config`)
4. **Begin Phase 2** implementation

---

## Questions to Answer Before Starting

1. **Input Layout:** Should we support custom key bindings for players 3-4?
   - **Recommendation:** Start with fixed layouts, add customization later

2. **Player Names:** Should players be able to set custom names?
   - **Recommendation:** Default to "Player 1-4", add names in Phase 7

3. **Performance Target:** What's the minimum acceptable FPS?
   - **Recommendation:** 60 FPS for 2-3 players, 30 FPS for 4 players

4. **Screen Size:** What's the minimum supported resolution?
   - **Recommendation:** 1920x1080 for 4-player, 1366x768 for 2-3 players

---

## Conclusion

This plan provides a comprehensive roadmap for adding configuration options and 4-player support to local multiplayer. The phased approach ensures that each component is built and tested incrementally, reducing risk and allowing for course corrections.

The estimated timeline of 2-3 weeks is realistic for a single developer working full-time. With proper testing and polish, this feature will significantly enhance the local multiplayer experience.

**Ready to begin? Let's start with Phase 2! 🚀**

