/**
 * FFA HUD Component - Phase 4
 * 
 * Displays:
 * - Kill feed (who killed whom)
 * - Live leaderboard
 * - Attack indicators (who's attacking whom)
 * - System messages
 */

import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';

export class FFAHud {
  constructor(ffaGameState) {
    this.gameState = ffaGameState;
    this.container = null;
    this.attackIndicators = new Map(); // Map<attackerId, {target, timestamp}>

    this.createUI();
    this.setupEventListeners();
  }
  
  /**
   * Create the HUD UI structure
   */
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'ffa-hud';
    this.container.className = 'ffa-hud hidden';
    
    this.container.innerHTML = `
      <!-- Attack Indicators (Center Overlay) -->
      <div id="attack-indicators" class="attack-indicators">
        <!-- Attack arrows appear here -->
      </div>
    `;
    
    document.body.appendChild(this.container);
  }
  
  /**
   * Setup event listeners for game events
   */
  setupEventListeners() {
    // PHASE 4.1: Kill feed events - emit to activity feed instead of rendering overlay
    window.addEventListener('game:player:frag', (e) => {
      const { killerName, victimName, killerSteamId, victimSteamId } = e.detail;

      // Emit to activity feed
      window.dispatchEvent(new CustomEvent('activity:kill', {
        detail: {
          killer: killerName,
          victim: victimName,
          killerSteamId,
          victimSteamId,
          isLocalKill: killerSteamId === this.gameState?.localPlayerId,
          isLocalDeath: victimSteamId === this.gameState?.localPlayerId,
          timestamp: Date.now(),
          isSelfKill: false
        }
      }));
    });

    onMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, (detail) => {
      // Emit to activity feed
      window.dispatchEvent(new CustomEvent('activity:kill', {
        detail: {
          killer: null,
          victim: detail.playerName,
          killerSteamId: null,
          victimSteamId: detail.steamId,
          isLocalKill: false,
          isLocalDeath: detail.steamId === this.gameState?.localPlayerId,
          timestamp: Date.now(),
          isSelfKill: true
        }
      }));
    });
    
    // PHASE 4.2: Attack indicators
    window.addEventListener('game:garbage:sent', (e) => {
      this.showAttackIndicator(e.detail);
    });
  }
  
  // Kill feed methods removed - now using unified activity feed in multi-player-canvas-layout.js
  
  /**
   * PHASE 4.2: Show attack indicator (visual arrow)
   */
  showAttackIndicator(data) {
    const { from, fromName, totalLines, targetCount, targets } = data;
    
    if (totalLines === 0 || !targets || targets.length === 0) return;
    
    // Store attack info
    const attackId = `attack-${Date.now()}-${from}`;
    this.attackIndicators.set(attackId, {
      from,
      fromName,
      targets,
      totalLines,
      timestamp: Date.now(),
    });
    
    // Create visual indicator
    this.renderAttackIndicator(attackId);
    
    // Remove after 2 seconds
    setTimeout(() => {
      this.removeAttackIndicator(attackId);
    }, 2000);
  }
  
  /**
   * PHASE 4.2: Render attack indicator
   */
  renderAttackIndicator(attackId) {
    const attack = this.attackIndicators.get(attackId);
    if (!attack) return;
    
    const container = document.getElementById('attack-indicators');
    if (!container) return;
    
    const indicator = document.createElement('div');
    indicator.id = attackId;
    indicator.className = 'attack-indicator';
    
    // Check if local player is involved
    const isFromLocal = attack.from === this.gameState?.localPlayerId;
    const isToLocal = attack.targets.includes(this.gameState?.localPlayerId);
    
    if (isFromLocal) {
      indicator.classList.add('local-attack-outgoing');
    } else if (isToLocal) {
      indicator.classList.add('local-attack-incoming');
    }
    
    const targetCount = attack.targets.length;
    const targetText = targetCount === 1 ? '1 player' : `${targetCount} players`;
    
    indicator.innerHTML = `
      <div class="attack-arrow ${isFromLocal ? 'arrow-outgoing' : 'arrow-incoming'}">
        ${isFromLocal ? '→' : '←'}
      </div>
      <div class="attack-info">
        <div class="attack-from">${this.escapeHtml(attack.fromName)}</div>
        <div class="attack-amount">${attack.totalLines} lines</div>
        <div class="attack-target">→ ${targetText}</div>
      </div>
    `;
    
    container.appendChild(indicator);
    
    // Fade in
    setTimeout(() => indicator.classList.add('visible'), 10);
  }
  
  /**
   * PHASE 4.2: Remove attack indicator
   */
  removeAttackIndicator(attackId) {
    const indicator = document.getElementById(attackId);
    if (indicator) {
      indicator.classList.remove('visible');
      setTimeout(() => {
        indicator.remove();
        this.attackIndicators.delete(attackId);
      }, 300);
    }
  }
  
  // Leaderboard moved to sidebar in multi-player-canvas-layout.js
  // Match timer moved to match-info-bar in multi-player-canvas-layout.js
  
  /**
   * Show the HUD
   */
  show() {
    this.container.classList.remove('hidden');
    console.log('✅ FFA HUD shown');
  }
  
  /**
   * Hide the HUD
   */
  hide() {
    this.container.classList.add('hidden');
  }
  
  /**
   * Format score with commas
   */
  formatScore(score) {
    return score.toLocaleString();
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Clean up
   */
  cleanup() {
    if (this.container) {
      this.container.remove();
    }
    this.attackIndicators.clear();
  }
}
