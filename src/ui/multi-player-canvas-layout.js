/**
 * Multi-Player Canvas Layout
 *
 * Displays multiple game canvases in optimal layouts:
 * - 1v1: Own canvas (center-right), opponent (left large)
 * - 1v2: Own canvas (center), 2 opponents (left, right)
 * - 1v3+: Own canvas (center large), up to 4 opponents around it
 *
 * Inspired by Tetris 99 / Jstris multi-player layouts
 */

import {
    COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE, SHAPES, COLORS,
} from '../core/constants.js';
import { canPlacePiece } from '../core/game.js';
import {
    drawGrid,
    drawPiece,
    drawLockedPieces,
    calculateGhostY,
    drawBlockStyled,
} from '../rendering/canvas/canvas-drawing-utils.js';
import { MultiplayerEffectsManager } from '../rendering/phaser/multiplayer-effects-manager.js';
import { CanvasBoardEffects } from './effects/canvas-board-effects.js';
import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';
import { TetrominoStyleManager } from '../rendering/tetromino-style-manager.js';
import steamService from '../core/steam/steam-service.js';

export class MultiPlayerCanvasLayout {
    constructor(ffaGameState) {
        this.gameState = ffaGameState;
        this.container = null;
        this.canvases = new Map(); // Map<steamId, {canvas, ctx, player}>
        this.renderInterval = null;
        this.renderFrameId = null; // For requestAnimationFrame
        this.currentLayout = null;
        this.nextPieceCanvases = []; // Array of canvas elements for next pieces
        this.resizeHandler = null; // Store resize handler for cleanup
        this.effectsManager = null; // Phaser effects manager for main player
        this.mainBoardDimensions = null; // Cached Phaser board sizing info
        this.mainCanvasOriginalParent = null; // Where to restore overlay canvas when tearing down
        this.boardEffects = new Map(); // Per-board canvas effect controllers
        this._garbageInsertedUnsub = null;
        this._garbageCounteredUnsub = null;
        this._playerToppedUnsub = null;
        this._garbageSentHandler = null;
        this._remoteLineClearUnsub = null;
        this._remoteLineImpactUnsub = null;
        this._remotePieceLockUnsub = null;
        this._remoteComboUnsub = null;
        this._lineClearUnsub = null;
        this._lineImpactUnsub = null;
        this._pieceLockUnsub = null;
        this._comboUnsub = null;

        // Initialize Tetromino Style Manager for theme-based tetromino colors
        this.styleManager = new TetrominoStyleManager(
            window.themeManager,
            window.settingsManager,
        );
        this.styleManager.init();

        this.createUI();
    }

    /**
   * Create the canvas layout container
   */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'multi-player-canvas-layout';
        this.container.className = 'multi-player-layout hidden';

        this.container.innerHTML = `
      <div class="multiplayer-layout-grid">
        <!-- LEFT: Opponents Sidebar -->
        <div class="opponents-sidebar">
          <div class="opponents-header">
            <h3>🎮 Opponents</h3>
            <span class="opponent-count" id="opponent-count">0 players</span>
          </div>
          <div id="opponent-canvases" class="opponent-canvases-list">
            <!-- Opponent canvases will be added here -->
          </div>
        </div>
        
        <!-- MIDDLE: Main Game Area -->
        <div class="main-game-area">
          <div class="main-player-header">
            <h2 class="player-name" id="main-player-name">You</h2>
            <div class="player-stats-bar">
              <span class="stat">Score: <strong id="main-score">0</strong></span>
              <span class="stat">Lines: <strong id="main-lines">0</strong></span>
              <span class="stat">Level: <strong id="main-level">1</strong></span>
              <span class="stat">Frags: <strong id="main-frags">0</strong></span>
            </div>
          </div>
          <!-- Next Pieces Above Board -->
          <div class="next-pieces-above-board">
            <canvas id="ffa-next-0" class="next-piece-canvas"></canvas>
            <canvas id="ffa-next-1" class="next-piece-canvas"></canvas>
            <canvas id="ffa-next-2" class="next-piece-canvas"></canvas>
          </div>
          <div class="main-canvas-container">
            <canvas id="main-game-canvas"></canvas>
          </div>
        </div>
        
        <!-- RIGHT: Sidebar (Leaderboard + Activity Feed) -->
        <div class="right-sidebar">
          <!-- Top Section: Leaderboard -->
          <div class="sidebar-leaderboard-section">
            <div class="section-header">
              <span class="icon">🏆</span>
              <span>Leaderboard</span>
            </div>
            <div id="sidebar-leaderboard-list" class="sidebar-leaderboard-list">
              <!-- Player rankings appear here -->
            </div>
          </div>

          <!-- Bottom Section: Activity Feed (Chat + Kill Notifications) -->
          <div class="activity-feed-section">
            <div class="section-header">
              <span class="icon">💬</span>
              <span>Activity Feed</span>
              <button id="hide-chat-btn" class="btn-icon">−</button>
            </div>
            <div id="match-chat-messages" class="activity-messages">
              <!-- Chat messages and kill notifications appear here -->
              <div class="system-message">Match started! Good luck!</div>
            </div>
            <div class="chat-input-container">
              <input
                type="text"
                id="match-chat-input"
                class="chat-input"
                placeholder="Type a message..."
                maxlength="200"
              />
              <button id="send-chat-btn" class="btn-send">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;

        document.body.appendChild(this.container);
        this.setupChatListeners();
        this.initializeNextPieces();
    }

    /**
   * Setup chat listeners
   * PHASE 4.4: Enhanced with P2P messaging
   */
    setupChatListeners() {
        const sendBtn = document.getElementById('send-chat-btn');
        const chatInput = document.getElementById('match-chat-input');
        const hideBtn = document.getElementById('hide-chat-btn');

        if (sendBtn && chatInput) {
            const sendMessage = () => {
                const message = chatInput.value.trim();
                if (message) {
                    // PHASE 4.4: Send via P2P network
                    this.sendChatMessage(message);
                    chatInput.value = '';
                }
            };

            sendBtn.addEventListener('click', sendMessage);
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMessage();
            });
        }

        if (hideBtn) {
            hideBtn.addEventListener('click', () => {
                const feedSection = this.container.querySelector('.activity-feed-section');
                if (feedSection) {
                    feedSection.classList.toggle('collapsed');
                    hideBtn.textContent = feedSection.classList.contains('collapsed') ? '+' : '−';
                }
            });
        }

        // PHASE 4.4: Listen for incoming chat messages
        onMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, (detail) => {
            let color = detail?.color || null;
            if (this.gameState && this.gameState.players && detail.steamId) {
                let player = this.gameState.players.get(detail.steamId);

                // Fallback 1: fuzzy match ID (string vs int)
                if (!player) {
                    for (const [id, p] of this.gameState.players) {
                        if (String(id) === String(detail.steamId)) {
                            player = p;
                            break;
                        }
                    }
                }

                // Fallback 2: Try to find by name if ID lookup fails
                if (!player && detail.playerName) {
                    for (const p of this.gameState.players.values()) {
                        if (p.name === detail.playerName) {
                            player = p;
                            break;
                        }
                    }
                }

                if (player) {
                    color = player.color;
                }
            }
            this.addChatMessage(detail.playerName, detail.message, false, color);
        });

        // Listen for kill notifications (unified activity feed)
        window.addEventListener('activity:kill', (e) => {
            this.addKillNotification(e.detail);
        });
    }

    /**
   * PHASE 4.4: Send chat message via P2P
   */
    sendChatMessage(message) {
        if (!this.gameState || !this.gameState.network) {
            console.warn('⚠️ Cannot send chat: No game state or network');
            return;
        }

        const playerName = this.gameState.network.playerName || 'Unknown';

        // Get local player color - Robust lookup
        let playerColor = null;
        if (this.gameState.players) {
            // First try direct lookup
            let localPlayer = this.gameState.players.get(this.gameState.localPlayerId);

            // If not found, try finding by isLocal flag (more reliable than ID sometimes)
            if (!localPlayer) {
                for (const p of this.gameState.players.values()) {
                    if (p.isLocal) {
                        localPlayer = p;
                        break;
                    }
                }
            }

            if (localPlayer) {
                playerColor = localPlayer.color;
            } else {
                console.warn('⚠️ Local player not found in players map for chat color');
            }
        }

        // Show message locally (echo) with color
        this.addChatMessage('You', message, false, playerColor);

        // Broadcast to all players
        this.gameState.network.broadcastToAll('game:chat', {
            playerName,
            message,
            steamId: this.gameState.localPlayerId,
            timestamp: Date.now(),
            color: playerColor,
        });
    }

    /**
   * Add a chat message
   */
    addChatMessage(playerName, message, isSystem = false, color = null) {
        const messagesContainer = document.getElementById('match-chat-messages');
        if (!messagesContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = isSystem ? 'system-message' : 'player-message';

        if (!isSystem) {
            const nameColor = color || '#a78bfa';
            messageEl.innerHTML = `
        <span class="color-indicator" style="background:${nameColor};"></span>
        <span class="author" style="color:${nameColor}">${this.escapeHtml(playerName)}:</span>
        <span class="text">${this.escapeHtml(message)}</span>
      `;
        } else {
            messageEl.innerHTML = this.escapeHtml(message);
        }

        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
   * Add a kill notification to activity feed
   */
    addKillNotification(data) {
        const messagesContainer = document.getElementById('match-chat-messages');
        if (!messagesContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = 'activity-message kill-notification';

        // Color coding based on involvement
        if (data.isLocalKill) {
            messageEl.classList.add('local-kill'); // Green - your kill
        } else if (data.isLocalDeath) {
            messageEl.classList.add('local-death'); // Red - your death
        } else {
            messageEl.classList.add('other-kill'); // Yellow - other player kill
        }

        // Format the kill message
        if (data.isSelfKill) {
            // Self-kill (topped out)
            messageEl.innerHTML = `
        <span class="kill-icon">☠️</span>
        <span class="victim">${this.escapeHtml(data.victim)}</span>
        <span class="kill-text">topped out</span>
      `;
        } else {
            // Player killed another player
            messageEl.innerHTML = `
        <span class="kill-icon">💀</span>
        <span class="killer">${this.escapeHtml(data.killer)}</span>
        <span class="kill-arrow">→</span>
        <span class="victim">${this.escapeHtml(data.victim)}</span>
      `;
        }

        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
   * Add a garbage cancellation notification to activity feed (Phase 3.5 - Quadra style)
   */
    addCancellationNotification(data) {
        const messagesContainer = document.getElementById('match-chat-messages');
        if (!messagesContainer) return;

        const messageEl = document.createElement('div');
        messageEl.className = 'activity-message cancel-notification';

        if (data.isLocal) {
            messageEl.classList.add('local-cancel'); // Green - your cancellation
        } else {
            messageEl.classList.add('other-cancel'); // Neutral - other player
        }

        const plural = data.linesCancelled !== 1 ? 's' : '';
        messageEl.innerHTML = `
        <span class="cancel-icon">🛡️</span>
        <span class="player">${this.escapeHtml(data.player)}</span>
        <span class="cancel-text">cancelled ${data.linesCancelled} line${plural}</span>
      `;

        messagesContainer.appendChild(messageEl);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
   * Append an alpha channel to a CSS color string when possible.
   */
    _withAlpha(color, alphaHex = '40') {
        if (!color || typeof color !== 'string') {
            return `#000000${alphaHex}`;
        }

        if (color.startsWith('#')) {
            if (color.length === 7) {
                return `${color}${alphaHex}`;
            }
            return color;
        }

        const rgbaMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgbaMatch) {
            const [, r, g, b] = rgbaMatch;
            const alpha = parseInt(alphaHex, 16);
            let alphaNormalized = alpha / 255;
            if (!Number.isFinite(alphaNormalized)) {
                alphaNormalized = 0.25;
            }
            return `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${alphaNormalized.toFixed(2)})`;
        }

        return color;
    }

    /**
   * Initialize next pieces canvases
   */
    initializeNextPieces() {
        console.log('🔍 DEBUG: Initializing next pieces...');
        console.log('🔍 BLOCK_SIZE:', BLOCK_SIZE);
        console.log('🔍 SHAPES available:', SHAPES ? Object.keys(SHAPES) : 'UNDEFINED');
        console.log('🔍 COLORS available:', COLORS ? Object.keys(COLORS) : 'UNDEFINED');

        // Get canvas elements
        this.nextPieceCanvases = [
            document.getElementById('ffa-next-0'),
            document.getElementById('ffa-next-1'),
            document.getElementById('ffa-next-2'),
        ].filter((canvas) => canvas !== null);

        console.log('🔍 Found canvases:', this.nextPieceCanvases.length);
        this.nextPieceCanvases.forEach((canvas, idx) => {
            console.log(`🔍 Canvas ${idx}:`, canvas ? `${canvas.id} exists` : 'NULL');
        });

        if (this.nextPieceCanvases.length === 0) {
            console.warn('⚠️ Next piece canvases not found');
            return;
        }

        // Set canvas dimensions to fit a 4x4 tetromino grid at FULL block size
        // All canvases use the same size - CSS will handle display sizing
        this.nextPieceCanvases.forEach((canvas, idx) => {
            canvas.width = 4 * BLOCK_SIZE; // 4 blocks wide (max tetromino width)
            canvas.height = 4 * BLOCK_SIZE; // 4 blocks tall (max tetromino height)
            console.log(`🔍 Canvas ${idx} dimensions set: ${canvas.width}x${canvas.height}`);
        });

        console.log(`✅ Initialized ${this.nextPieceCanvases.length} next piece canvases`);

        // Start listening for render events to update next pieces and leaderboard
        onMultiplayerEvent(
            MULTIPLAYER_EVENTS.RENDER_FRAME,
            () => {
                this.updateNextPieces();
                this.updateSidebarLeaderboard();
            },
            { rafThrottle: true },
        );
    }

    /**
   * Update next pieces display
   */
    updateNextPieces() {
        if (!this.gameState) return;

        // Use the correct method to get local player
        const localPlayer = this.gameState.getLocalPlayer();
        if (!localPlayer || !localPlayer.gameState) return;

        const { nextPieces } = localPlayer.gameState;
        if (!nextPieces || nextPieces.length === 0) return;

        this.nextPieceCanvases.forEach((canvas, idx) => {
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (nextPieces[idx]) {
                const shape = SHAPES[nextPieces[idx]];
                const color = COLORS[nextPieces[idx]];

                if (!shape || !color) return;

                // Use FULL block size - same as main game board
                const blockSize = BLOCK_SIZE;

                // Center the shape in the canvas
                const offsetX = (canvas.width - shape[0].length * blockSize) / 2;
                const offsetY = (canvas.height - shape.length * blockSize) / 2;

                // Draw all blocks as solid fill first
                shape.forEach((row, y) => {
                    row.forEach((cell, x) => {
                        if (cell > 0) {
                            // Draw solid block
                            ctx.fillStyle = color;
                            ctx.fillRect(
                                offsetX + x * blockSize,
                                offsetY + y * blockSize,
                                blockSize,
                                blockSize,
                            );
                        }
                    });
                });

                // Draw thin black outline around the entire piece
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
                ctx.lineWidth = 1;

                shape.forEach((row, y) => {
                    row.forEach((cell, x) => {
                        if (cell > 0) {
                            const px = offsetX + x * blockSize;
                            const py = offsetY + y * blockSize;

                            // Draw borders only on outer edges
                            // Top edge
                            if (y === 0 || !shape[y - 1][x]) {
                                ctx.beginPath();
                                ctx.moveTo(px, py);
                                ctx.lineTo(px + blockSize, py);
                                ctx.stroke();
                            }

                            // Bottom edge
                            if (y === shape.length - 1 || !shape[y + 1][x]) {
                                ctx.beginPath();
                                ctx.moveTo(px, py + blockSize);
                                ctx.lineTo(px + blockSize, py + blockSize);
                                ctx.stroke();
                            }

                            // Left edge
                            if (x === 0 || !shape[y][x - 1]) {
                                ctx.beginPath();
                                ctx.moveTo(px, py);
                                ctx.lineTo(px, py + blockSize);
                                ctx.stroke();
                            }

                            // Right edge
                            if (x === row.length - 1 || !shape[y][x + 1]) {
                                ctx.beginPath();
                                ctx.moveTo(px + blockSize, py);
                                ctx.lineTo(px + blockSize, py + blockSize);
                                ctx.stroke();
                            }
                        }
                    });
                });
            }
        });
    }

    /**
   * Update sidebar leaderboard display
   */
    updateSidebarLeaderboard() {
        const leaderboardList = document.getElementById('sidebar-leaderboard-list');
        if (!leaderboardList || !this.gameState || !this.gameState.players) return;

        // Get player data and sort by frags, then score
        const players = Array.from(this.gameState.players.values())
            .map((player) => ({
                steamId: player.steamId,
                name: player.name,
                color: player.color || '#808080',
                frags: player.frags || 0,
                score: player.gameState?.score || 0,
                isAlive: player.isAlive,
                isLocal: player.steamId === this.gameState.localPlayerId,
            }))
            .sort((a, b) => {
                if (b.frags !== a.frags) return b.frags - a.frags; // Sort by frags
                return b.score - a.score; // Then by score
            });

        // Build leaderboard HTML with header
        const targetFrags = this.gameState.matchConfig?.endConditionValue || 10;
        const endCondition = this.gameState.matchConfig?.endCondition || 'frags';

        let html = '';

        // Add match target header (only for frag-based matches)
        if (endCondition === 'frags') {
            html += `
        <div class="leaderboard-header">
          <span class="target-label">First to:</span>
          <span class="target-value">${targetFrags} frags</span>
        </div>
      `;
        }

        leaderboardList.innerHTML = html;

        players.forEach((player, index) => {
            const rank = index + 1;
            const entry = document.createElement('div');
            entry.className = 'sidebar-leaderboard-entry';

            if (player.isLocal) {
                entry.classList.add('local-player');
            }

            if (!player.isAlive) {
                entry.classList.add('dead-player');
            }

            // Medal for top 3
            let rankIcon = `<span class="rank-number">#${rank}</span>`;
            if (rank === 1) rankIcon = '<span class="rank-medal">🥇</span>';
            else if (rank === 2) rankIcon = '<span class="rank-medal">🥈</span>';
            else if (rank === 3) rankIcon = '<span class="rank-medal">🥉</span>';

            // Format score with k notation for large numbers
            const formattedScore = player.score >= 1000
                ? `${(player.score / 1000).toFixed(1)}k`
                : player.score;

            entry.innerHTML = `
        ${rankIcon}
        <span class="player-color-badge-small" style="background-color: ${player.color};"></span>
        <span class="player-name">${this.escapeHtml(player.name)}</span>
        <span class="player-stats-compact">
          <span class="stat-frags">💀${player.frags}</span>
          <span class="stat-score">⭐${formattedScore}</span>
        </span>
      `;

            leaderboardList.appendChild(entry);
        });
    }

    /**
   * Show the layout and start rendering
   */
    show() {
        this.container.classList.remove('hidden');

        // Clear existing canvases
        this.canvases.clear();
        const opponentContainer = document.getElementById('opponent-canvases');
        if (opponentContainer) {
            opponentContainer.innerHTML = '';
        }

        // Initialize canvases for all players
        this.initializeCanvases();

        // Initialize Phaser effects for main player
        this.initializeEffectsForMainPlayer();

        // Determine optimal layout
        this.updateLayout();

        // Add resize handler to adjust canvas size when window is resized
        this.resizeHandler = () => {
            // Debounce resize to avoid too many calls
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                console.log('🔄 Window resized, adjusting canvas size...');
                this.createMainCanvas(); // Recalculate and resize main canvas
            }, 250);
        };
        window.addEventListener('resize', this.resizeHandler);

        // PHASE 3.3: Setup visual effects event listeners
        this.setupVisualEffectsListeners();

        // NOTE: We no longer start an internal render loop here.
        // Rendering is now event-driven via ffa:render-frame from FFAGameStateP2P
        // See renderFrame() method below for the new approach

        console.log(`✅ Multi-player layout showing ${this.canvases.size} canvases (event-driven rendering)`);
    }

    /**
   * PHASE 3.3 & 3.4: Setup visual effects and sound event listeners
   */
    setupVisualEffectsListeners() {
        const soundManager = window.gameInstance?.soundManager;

        this.removeEffectEventListeners();

        console.log('✨ Setting up effect event listeners...');

        this._garbageInsertedUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, (detail) => {
            this.applyShakeEffect(detail.steamId, detail.linesInserted);
            this.showGarbagePopup(detail.steamId, `+${detail.linesInserted} garbage`, 'red');

            if (detail.isLocal && soundManager) {
                soundManager.playGarbageReceived();
            }

            if (!detail.isLocal) {
                const controller = this.getBoardEffectsController(detail.steamId);
                controller?.triggerGarbageFlash('#f87171');
            }
        });

        this._garbageCounteredUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_COUNTERED, (detail) => {
            this.applyFlashEffect(detail.steamId, '#00ff00');
            this.showGarbagePopup(detail.steamId, `-${detail.linesCanceled} garbage`, 'green');

            if (detail.isLocal && soundManager) {
                soundManager.playGarbageCountered();
            }

            if (!detail.isLocal) {
                const controller = this.getBoardEffectsController(detail.steamId);
                controller?.triggerFlash('#34d399', 0.8, 260);
            }

            // Phase 3.5: Add cancellation notification to activity feed
            this.addCancellationNotification({
                player: detail.playerName,
                linesCancelled: detail.linesCanceled,
                isLocal: detail.isLocal,
            });
        });

        this._playerToppedUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, (detail) => {
            this.applyDeathEffect(detail.steamId);
            this.addChatMessage(`💀 ${detail.playerName} topped out!`, 'system-death');

            if (soundManager) {
                soundManager.playPlayerDeath();
            }

            if (!detail.isLocal) {
                const controller = this.getBoardEffectsController(detail.steamId);
                controller?.setDeadState(true);
            }
        });

        this._garbageSentHandler = (e) => {
            if (e.detail.from === this.gameState?.localPlayerId && soundManager) {
                soundManager.playGarbageSend();
            }

            if (e.detail.from === this.gameState?.localPlayerId) {
                this.applyFlashEffect(e.detail.from, '#fbbf24');
            }
        };
        window.addEventListener('game:garbage:sent', this._garbageSentHandler);

        this._remoteLineClearHandler = (detail) => {
            if (detail.isLocal) {
                if (this.effectsManager) {
                    const rows = Array.isArray(detail.rows) ? detail.rows : [];
                    this.effectsManager.triggerLineClearFlash?.(rows);
                }
                return;
            }

            const rows = Array.isArray(detail.rows) ? detail.rows : [];
            this.applyLineClearFlash(detail.steamId, detail.linesCleared, rows);

            if (detail.linesCleared > 0) {
                this.addActivityEvent(
                    `${detail.playerName} cleared ${detail.linesCleared} line${detail.linesCleared > 1 ? 's' : ''}`,
                    'opponent-line-clear',
                );
            }
        };
        this._remoteLineClearUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR, this._remoteLineClearHandler);

        this._remoteLineImpactHandler = (detail) => {
            if (detail.isLocal) {
                this.effectsManager?.playLineClearImpact?.(detail.linesCleared);
                return;
            }

            const controller = this.getBoardEffectsController(detail.steamId);
            controller?.triggerLineClearImpact(detail.linesCleared);
        };
        this._remoteLineImpactUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT, this._remoteLineImpactHandler);

        this._remotePieceLockHandler = (detail) => {
            if (detail.isLocal && detail.piece) {
                this.effectsManager?.createPieceLockRipple?.(detail.piece);
                return;
            }

            const controller = this.getBoardEffectsController(detail.steamId);
            controller?.triggerPieceLockPulse('#6ee7b7');
        };
        this._remotePieceLockUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, this._remotePieceLockHandler);

        this._remoteComboHandler = (detail) => {
            if (detail.isLocal) {
                this.effectsManager?.showComboPopup?.(detail.comboCount);
                return;
            }

            const controller = this.getBoardEffectsController(detail.steamId);
            controller?.triggerCombo(detail.comboCount);

            if (detail.comboCount > 1) {
                this.addActivityEvent(
                    `${detail.playerName} pulled a ${detail.comboCount}x combo!`,
                    'opponent-combo',
                );
            }
        };
        this._remoteComboUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, this._remoteComboHandler);
    }

    /**
   * PHASE 4.5: Apply flash effect for line clears
   */
    applyLineClearFlash(steamId, linesCleared, rows = []) {
        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) return;

        const controller = this.getBoardEffectsController(steamId);
        if (controller) {
            // Use canvas overlay controller for opponent boards
            let color = '#ffffff';
            if (linesCleared === 3) {
                color = '#fbbf24';
            } else if (linesCleared >= 4) {
                color = '#f59e0b';
            }
            controller.triggerLineClearFlash(rows, linesCleared, color);
            return;
        }

        const { canvas } = canvasInfo;
        const container = canvas.parentElement;
        if (!container) return;

        // Flash color based on line count
        let color = '#ffffff'; // White for 1-2 lines
        if (linesCleared === 3) {
            color = '#fbbf24'; // Yellow for 3 lines
        } else if (linesCleared >= 4) {
            color = '#f59e0b'; // Orange for Tetris (4+ lines)
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = color;
        overlay.style.opacity = '0.4';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 0.2s ease-out';

        container.style.position = 'relative';
        container.appendChild(overlay);

        // Fade out quickly
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 200);
        }, 50);
    }

    /**
   * Hide the layout
   */
    hide() {
        this.container.classList.add('hidden');
        this.stopRenderLoop();

        // Remove effect event listeners
        this.removeEffectEventListeners();

        // Destroy effects manager
        if (this.effectsManager) {
            const mainCanvasData = this.canvases.get(this.gameState?.localPlayerId);
            if (mainCanvasData?.canvas && this.mainCanvasOriginalParent) {
                this.mainCanvasOriginalParent.appendChild(mainCanvasData.canvas);
                mainCanvasData.canvas.style.position = '';
                mainCanvasData.canvas.style.top = '';
                mainCanvasData.canvas.style.left = '';
                mainCanvasData.canvas.style.width = '';
                mainCanvasData.canvas.style.height = '';
                mainCanvasData.canvas.style.zIndex = '';
                mainCanvasData.canvas.style.pointerEvents = 'none';
            }

            this.effectsManager.destroy();
            this.effectsManager = null;
        }

        // Remove resize handler
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Clear resize timeout
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = null;
        }
    }

    /**
   * Initialize canvases for all players
   */
    initializeCanvases() {
        const players = Array.from(this.gameState.players.values());
        console.log(`📊 Initializing canvases for ${players.length} players`);
        console.log('📊 Game state:', this.gameState);
        console.log('📊 Players with colors:', players.map((p) => ({ name: p.name, color: p.color })));

        // Create main canvas for local player
        this.createMainCanvas();

        // Create opponent canvases
        const opponents = players.filter((p) => p.steamId !== this.gameState.localPlayerId);
        console.log(`👥 Found ${opponents.length} opponents:`, opponents.map((o) => ({ name: o.name, color: o.color })));

        opponents.forEach((opponent, index) => {
            console.log(`  Creating canvas ${index + 1}/${opponents.length} for ${opponent.name} with color ${opponent.color}`);
            this.createOpponentCanvas(opponent);
        });

        console.log(`✅ Created ${this.canvases.size} total canvases (1 main + ${opponents.length} opponents)`);
        console.log('✅ Canvas map:', this.canvases);
    }

    /**
   * Create main canvas for local player
   */
    createMainCanvas() {
        const canvas = document.getElementById('main-game-canvas');

        if (!canvas) {
            console.error('❌ Main canvas element not found');
            return;
        }

        // Get local player from game state
        const localPlayer = this.gameState.players.get(this.gameState.localPlayerId);

        if (!localPlayer) {
            console.error('❌ Local player not found in game state');
            return;
        }

        // Calculate optimal block size to fill the screen effectively
        // More aggressive calculation that targets ~70% of viewport height

        // Calculate available space based on viewport and UI overhead
        // UI overhead: match info bar (60px) + padding/margins (~80px) = 140px
        const UI_OVERHEAD_HEIGHT = 140;
        let availableHeight = window.innerHeight - UI_OVERHEAD_HEIGHT;

        // Calculate available width based on grid layout
        // Grid: minmax(260px, 22vw) | minmax(50vw, 1fr) | minmax(260px, 26vw)
        const leftSidebarWidth = Math.max(260, window.innerWidth * 0.22);
        const rightSidebarWidth = Math.max(260, window.innerWidth * 0.26);
        let availableWidth = window.innerWidth - leftSidebarWidth - rightSidebarWidth - 80; // Account for padding

        // Get actual measurements from DOM if available (for resize events)
        const mainGameArea = document.querySelector('.main-game-area');
        if (mainGameArea) {
            const areaRect = mainGameArea.getBoundingClientRect();
            const headerEl = mainGameArea.querySelector('.main-player-header');
            const nextPiecesEl = mainGameArea.querySelector('.next-pieces-above-board');

            // Use actual measurements if they exist
            if (areaRect.width > 0) {
                availableWidth = Math.min(availableWidth, areaRect.width - 100); // Leave room for padding
            }

            if (areaRect.height > 0) {
                let usedHeight = 0;
                if (headerEl) usedHeight += headerEl.offsetHeight + 20; // header + margin
                if (nextPiecesEl) usedHeight += nextPiecesEl.offsetHeight + 12; // next pieces + margin

                const remainingHeight = areaRect.height - usedHeight - 80; // Leave room for container padding
                if (remainingHeight > 0) {
                    availableHeight = Math.min(availableHeight, remainingHeight);
                }
            }
        }

        // Ensure minimum available space
        availableHeight = Math.max(availableHeight, 400);
        availableWidth = Math.max(availableWidth, 200);

        // Calculate block size to fill the space
        const blockSizeFromHeight = Math.floor(availableHeight / ROWS);
        const blockSizeFromWidth = Math.floor(availableWidth / COLS);

        // Use the smaller dimension but allow larger blocks
        // Increased max from 45px to 50px for better visibility on larger screens
        const MAIN_BLOCK_SIZE = Math.max(22, Math.min(blockSizeFromHeight, blockSizeFromWidth, 50));

        canvas.width = COLS * MAIN_BLOCK_SIZE;
        canvas.height = ROWS * MAIN_BLOCK_SIZE;
        canvas.style.width = `${canvas.width}px`;
        canvas.style.height = `${canvas.height}px`;

        canvas.setAttribute('data-renderer', 'phaser');
        canvas.style.pointerEvents = 'none';

        console.log('📐 Canvas sizing calculation:');
        console.log(`   Viewport: ${window.innerWidth}w x ${window.innerHeight}h`);
        console.log(`   Available space: ${availableWidth}w x ${availableHeight}h`);
        console.log(`   Block size from height: ${blockSizeFromHeight}px`);
        console.log(`   Block size from width: ${blockSizeFromWidth}px`);
        console.log(`   Final block size: ${MAIN_BLOCK_SIZE}px`);
        console.log(`   Canvas dimensions: ${canvas.width}x${canvas.height}`);

        // Set canvas border color to player's color but render via container shadows
        const borderColor = localPlayer.color || '#8b5cf6';
        canvas.style.borderColor = borderColor;
        canvas.style.borderWidth = '0px';
        canvas.style.borderStyle = 'solid';
        canvas.style.borderRadius = '8px';
        canvas.style.boxShadow = 'none';

        const ctx = canvas.getContext('2d');

        // Update player name with color badge
        const nameEl = document.getElementById('main-player-name');
        if (nameEl) {
            nameEl.innerHTML = `
        <span class="player-color-badge" style="background-color: ${localPlayer.color || '#808080'};"></span>
        ${localPlayer.name}
      `;
        }

        if (!this.mainCanvasOriginalParent) {
            this.mainCanvasOriginalParent = canvas.parentElement;
        }

        this.canvases.set(this.gameState.localPlayerId, {
            canvas,
            ctx,
            player: localPlayer,
            isMain: true,
            blockSize: MAIN_BLOCK_SIZE,
            renderer: 'phaser',
            borderColor,
        });

        // Remember dimensions so the Phaser board can be resized consistently.
        this.mainBoardDimensions = {
            width: canvas.width,
            height: canvas.height,
            blockSize: MAIN_BLOCK_SIZE,
        };

        if (this.effectsManager) {
            this.effectsManager.resize(this.mainBoardDimensions);
        }

        console.log(`✅ Main Phaser board container prepared for ${localPlayer.name}`);
    }

    /**
   * Initialize Phaser board + effects renderer for the local player.
   * Reuses the single-player Phaser scene so visuals match exactly.
   */
    initializeEffectsForMainPlayer() {
        // Get main player canvas data
        const mainCanvasData = this.canvases.get(this.gameState.localPlayerId);

        if (!mainCanvasData) {
            console.warn('⚠️ Main canvas not found, cannot initialize effects');
            return;
        }

        // Get main canvas container
        const mainCanvasContainer = document.querySelector('.main-canvas-container');

        if (!mainCanvasContainer) {
            console.warn('⚠️ Main canvas container not found');
            return;
        }

        // Make sure container has relative positioning for absolute overlay
        mainCanvasContainer.style.position = 'relative';

        const sizeConfig = this.mainBoardDimensions || {
            width: mainCanvasData.canvas.width,
            height: mainCanvasData.canvas.height,
            blockSize: mainCanvasData.blockSize,
        };

        // Tear down any previous instance before recreating
        if (this.effectsManager) {
            this.effectsManager.destroy();
            this.effectsManager = null;
        }

        // Create Phaser renderer/FX manager
        this.effectsManager = new MultiplayerEffectsManager(
            mainCanvasContainer,
            sizeConfig,
        );

        // Layer the transparent overlay canvas above the Phaser board for HUD effects.
        const phaserBoardContainer = this.effectsManager.getContainerElement?.();
        if (phaserBoardContainer) {
            const borderColor = mainCanvasData.borderColor || '#8b5cf6';
            const midGlow = this._withAlpha(borderColor, '55');
            const softGlow = this._withAlpha(borderColor, '22');
            phaserBoardContainer.style.boxShadow = `0 0 0 2px ${borderColor}, 0 0 10px ${midGlow}, 0 0 22px ${softGlow}`;
            phaserBoardContainer.style.borderRadius = '8px';
            phaserBoardContainer.style.overflow = 'hidden';

            // Don't override position - the effects manager already set it to absolute
            const overlayCanvas = mainCanvasData.canvas;
            overlayCanvas.width = sizeConfig.width;
            overlayCanvas.height = sizeConfig.height;
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.top = '0';
            overlayCanvas.style.left = '0';
            overlayCanvas.style.width = `${sizeConfig.width}px`;
            overlayCanvas.style.height = `${sizeConfig.height}px`;
            overlayCanvas.style.zIndex = '15';
            overlayCanvas.style.pointerEvents = 'none';
            phaserBoardContainer.appendChild(overlayCanvas);
        }

        // Apply currently selected quality if available (matches single-player scene).
        const currentQuality = window.gameInstance?.currentEffectQuality;
        if (currentQuality) {
            this.effectsManager.setEffectQuality(currentQuality);
        }

        // Wire up game event listeners for effects
        this.setupEffectEventListeners();

        console.log('✨ Phaser board + effects initialized for main player');
    }

    /**
   * Setup event listeners to trigger Phaser effects
   */
    setupEffectEventListeners() {
        if (!this.effectsManager) {
            console.warn('⚠️ No effects manager - effects disabled');
            return;
        }

        // Remove any existing listeners first to prevent duplicates
        this.removeEffectEventListeners();

        console.log('✨ Setting up effect event listeners...');

        // Line clear flash (rows)
        this._lineClearHandler = (detail) => {
            console.log('🔔 Line clear event received:', detail);

            if (!detail.isLocal || !detail || !this.effectsManager) {
                return;
            }

            const rows = Array.isArray(detail.rows) ? detail.rows : [];

            try {
                if (this.effectsManager.triggerLineClearFlash) {
                    this.effectsManager.triggerLineClearFlash(rows);
                }
                console.log('✅ Line clear flash triggered!', { rows });
            } catch (error) {
                console.error('❌ Error triggering line clear flash:', error);
            }
        };
        this._lineClearUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR, this._lineClearHandler);

        // Line clear impact (camera shake, particles)
        this._lineImpactHandler = (detail) => {
            if (!detail.isLocal || !this.effectsManager) return;

            const linesCleared = detail.linesCleared || 0;

            try {
                if (this.effectsManager.playLineClearImpact) {
                    this.effectsManager.playLineClearImpact(linesCleared);
                }
                console.log('✅ Line clear impact triggered!', { linesCleared });
            } catch (error) {
                console.error('❌ Error triggering line clear impact:', error);
            }
        };
        this._lineImpactUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT, this._lineImpactHandler);

        // Piece lock effects
        this._pieceLockHandler = (detail) => {
            console.log('🔔 Piece lock event received:', detail);

            if (detail.isLocal && detail.piece) {
                console.log('💫 Triggering piece lock effects!');

                try {
                    if (this.effectsManager.createPieceLockRipple) {
                        this.effectsManager.createPieceLockRipple(detail.piece);
                    }
                    console.log('✅ Piece lock ripple triggered!');
                } catch (error) {
                    console.error('❌ Error triggering piece lock effects:', error);
                }
            }
        };

        this._pieceLockUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, this._pieceLockHandler);

        // Combo popup
        this._comboHandler = (detail) => {
            if (!detail.isLocal || !this.effectsManager) return;

            const comboCount = detail.comboCount || 0;
            if (comboCount < 2) {
                return; // Skip single line clears
            }

            try {
                if (this.effectsManager.showComboPopup) {
                    this.effectsManager.showComboPopup(comboCount);
                }
                console.log('🎉 Combo popup triggered!', { comboCount });
            } catch (error) {
                console.error('❌ Error triggering combo popup:', error);
            }
        };
        this._comboUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, this._comboHandler);

        console.log('📡 Effects listening for game events (line-clear, impact, piece-lock, combo)');
        console.log('   Effects manager status:', {
            exists: !!this.effectsManager,
            hasBoardScene: !!this.effectsManager?.boardScene,
            methods: this.effectsManager ? Object.keys(this.effectsManager).filter((k) => typeof this.effectsManager[k] === 'function') : [],
        });
    }

    /**
   * Remove effect event listeners
   */
    removeEffectEventListeners() {
        if (this._garbageInsertedUnsub) {
            this._garbageInsertedUnsub();
            this._garbageInsertedUnsub = null;
        }

        if (this._garbageCounteredUnsub) {
            this._garbageCounteredUnsub();
            this._garbageCounteredUnsub = null;
        }

        if (this._playerToppedUnsub) {
            this._playerToppedUnsub();
            this._playerToppedUnsub = null;
        }

        if (this._garbageSentHandler) {
            window.removeEventListener('game:garbage:sent', this._garbageSentHandler);
            this._garbageSentHandler = null;
        }

        if (this._remoteLineClearUnsub) {
            this._remoteLineClearUnsub();
            this._remoteLineClearUnsub = null;
        }
        this._remoteLineClearHandler = null;

        if (this._remoteLineImpactUnsub) {
            this._remoteLineImpactUnsub();
            this._remoteLineImpactUnsub = null;
        }
        this._remoteLineImpactHandler = null;

        if (this._remotePieceLockUnsub) {
            this._remotePieceLockUnsub();
            this._remotePieceLockUnsub = null;
        }
        this._remotePieceLockHandler = null;

        if (this._remoteComboUnsub) {
            this._remoteComboUnsub();
            this._remoteComboUnsub = null;
        }
        this._remoteComboHandler = null;

        if (this._lineClearUnsub) {
            this._lineClearUnsub();
            this._lineClearUnsub = null;
        }
        this._lineClearHandler = null;

        if (this._lineImpactUnsub) {
            this._lineImpactUnsub();
            this._lineImpactUnsub = null;
        }
        this._lineImpactHandler = null;

        if (this._pieceLockUnsub) {
            this._pieceLockUnsub();
            this._pieceLockUnsub = null;
        }
        this._pieceLockHandler = null;

        if (this._comboUnsub) {
            this._comboUnsub();
            this._comboUnsub = null;
        }
        this._comboHandler = null;
    }

    /**
   * Create canvas for opponent
   */
    createOpponentCanvas(opponent) {
        const opponentContainer = document.getElementById('opponent-canvases');

        if (!opponentContainer) {
            console.error('❌ Opponent container #opponent-canvases not found in DOM');
            console.log('Available containers:', Array.from(document.querySelectorAll('[id*="opponent"]')).map((el) => el.id));
            return;
        }

        console.log(`  📦 Container found: ${opponentContainer.id}, current children: ${opponentContainer.children.length}`);

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'opponent-canvas-wrapper';
        wrapper.id = `opponent-${opponent.steamId}`;
        wrapper.style.position = 'relative';

        // Create canvas - keep original size for rendering, CSS will scale it down
        const canvas = document.createElement('canvas');
        const OPPONENT_BLOCK_SIZE = BLOCK_SIZE; // Use default block size from constants
        canvas.width = COLS * OPPONENT_BLOCK_SIZE;
        canvas.height = ROWS * OPPONENT_BLOCK_SIZE;
        canvas.className = 'opponent-canvas';

        // Set canvas border color to opponent's color and shift the visual frame to wrapper shadows
        const borderColor = opponent.color || '#8b5cf6';
        canvas.style.borderColor = borderColor;
        canvas.style.borderWidth = '0px';
        canvas.style.borderStyle = 'solid';
        canvas.style.borderRadius = '8px';
        canvas.style.boxShadow = 'none';
        const midGlow = this._withAlpha(borderColor, '44');
        const softGlow = this._withAlpha(borderColor, '1a');
        wrapper.style.boxShadow = `0 0 0 2px ${borderColor}, 0 0 10px ${midGlow}, 0 0 18px ${softGlow}`;

        const ctx = canvas.getContext('2d');

        // Create player info overlay with mini-avatar
        const infoOverlay = document.createElement('div');
        infoOverlay.className = 'opponent-info';
        const playerColor = opponent.color || '#808080';
        infoOverlay.innerHTML = `
      <div class="opponent-name">
        <div class="opponent-mini-avatar" data-steamid="${opponent.steamId}" style="border-color: ${playerColor};">
          <span class="mini-avatar-placeholder" style="background: ${playerColor};">${(opponent.name || 'P').charAt(0).toUpperCase()}</span>
        </div>
        ${opponent.name}
      </div>
      <div class="opponent-stats">
        <span class="stat-small">Score: <strong class="score">0</strong></span>
        <span class="stat-small">Frags: <strong class="frags">0</strong></span>
      </div>
    `;

        // Load Steam avatar asynchronously
        this._loadMiniAvatar(infoOverlay.querySelector('.opponent-mini-avatar'), opponent.steamId, opponent.name, playerColor);

        // Assemble
        wrapper.appendChild(canvas);
        wrapper.appendChild(infoOverlay);

        opponentContainer.appendChild(wrapper);

        // Store reference (including blockSize for rendering)
        this.canvases.set(opponent.steamId, {
            canvas,
            ctx,
            player: opponent,
            wrapper,
            isMain: false,
            blockSize: OPPONENT_BLOCK_SIZE,
            borderColor,
        });

        console.log(`✅ Opponent canvas created for ${opponent.name} (${opponent.steamId})`);

        // Update opponent count
        this.updateOpponentCount();
    }

    /**
     * Load mini avatar for opponent board
     * @private
     */
    async _loadMiniAvatar(container, steamId, name, color) {
        if (!container || !steamId) return;

        try {
            const avatarUrl = await steamService.getAvatar(steamId, 'small');
            if (avatarUrl) {
                const img = document.createElement('img');
                img.className = 'mini-avatar-img';
                img.src = avatarUrl;
                img.alt = name || 'Player';
                img.onerror = () => {
                    // Keep placeholder on error
                    img.remove();
                };
                // Replace placeholder with actual avatar
                const placeholder = container.querySelector('.mini-avatar-placeholder');
                if (placeholder) {
                    placeholder.style.display = 'none';
                }
                container.appendChild(img);
            }
        } catch (err) {
            // Keep placeholder on error
            console.warn(`[MultiPlayerCanvasLayout] Failed to load avatar for ${steamId}:`, err.message);
        }
    }

    /**
   * Update opponent count display
   */
    updateOpponentCount() {
        const countEl = document.getElementById('opponent-count');
        if (countEl) {
            const opponentCount = this.canvases.size - 1; // Exclude self
            countEl.textContent = `${opponentCount} player${opponentCount !== 1 ? 's' : ''}`;
        }
    }

    /**
   * Update layout based on player count
   * (Now using fixed 3-column layout, no dynamic classes needed)
   */
    updateLayout() {
        const players = Array.from(this.gameState.players.values());
        const opponentCount = players.length - 1; // Exclude self

        // No layout classes needed - using fixed 3-column grid
        // Just log the opponent count for debugging
        console.log(`📐 Layout: 3-column grid with ${opponentCount} opponents`);
    }

    /**
   * Start render loop with requestAnimationFrame for smooth animations
   */
    startRenderLoop() {
        if (this.renderFrameId) return;

        const render = (timestamp) => {
            this.currentTimestamp = timestamp;
            this.renderAllCanvases();
            this.renderFrameId = requestAnimationFrame(render);
        };

        this.renderFrameId = requestAnimationFrame(render);
        console.log('🎨 Multi-player render loop started (requestAnimationFrame)');
        console.log('✨ Using upgraded rendering: solid tetrominos + pulsating ghost!');
    }

    /**
   * Stop render loop
   */
    stopRenderLoop() {
        if (this.renderFrameId) {
            cancelAnimationFrame(this.renderFrameId);
            this.renderFrameId = null;
            console.log('🎨 Multi-player render loop stopped');
        }
    }

    /**
   * Render all player canvases
   */
    renderAllCanvases() {
        if (this.canvases.size === 0) {
            if (!this._noCanvasWarned) {
                console.warn('⚠️ No canvases to render!');
                this._noCanvasWarned = true;
            }
            return;
        }

        this.canvases.forEach((canvasData, steamId) => {
            this.renderPlayerCanvas(canvasData);
        });
    }

    /**
   * Draw a piece with theme-based styling
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} piece - Piece to draw
   * @param {number} blockSize - Size of each block in pixels
   * @param {boolean} isGhost - Whether this is a ghost piece
   */
    drawStyledPiece(ctx, piece, blockSize, isGhost = false) {
        if (!piece || !piece.shape) return;

        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell > 0) {
                    const worldY = piece.y + localY;
                    const x = (piece.x + localX) * blockSize;
                    const y = (worldY - HIDDEN_ROWS) * blockSize;

                    // Get themed style for this piece type
                    const styleConfig = this.styleManager.getStyleForPiece(piece.type);

                    // Use styled drawing
                    drawBlockStyled(ctx, x, y, blockSize, styleConfig, isGhost);
                }
            });
        });
    }

    /**
   * Draw locked pieces with theme-based styling
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} lockedPieces - Array of locked pieces
   * @param {number} blockSize - Size of each block in pixels
   */
    drawStyledLockedPieces(ctx, lockedPieces, blockSize) {
        if (!lockedPieces || lockedPieces.length === 0) return;

        lockedPieces.forEach((piece) => {
            if (!piece.shape) return;

            piece.shape.forEach((row, localY) => {
                row.forEach((cell, localX) => {
                    if (cell > 0) {
                        const worldY = piece.y + localY;

                        // Only draw visible area (below hidden rows)
                        if (worldY >= HIDDEN_ROWS) {
                            const x = (piece.x + localX) * blockSize;
                            const y = (worldY - HIDDEN_ROWS) * blockSize;

                            // Get themed style for this piece type
                            const styleConfig = this.styleManager.getStyleForPiece(piece.type);

                            // Use styled drawing
                            drawBlockStyled(ctx, x, y, blockSize, styleConfig, false);
                        }
                    }
                });
            });
        });
    }

    /**
   * Render a single player's canvas with upgraded drawing functions
   */
    renderPlayerCanvas(canvasData) {
        const {
            canvas, ctx, player, isMain, blockSize,
        } = canvasData;

        if (!player || !player.gameState) return;

        const { gameState } = player;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        try {
            // 1. Draw grid
            drawGrid(ctx, canvas.width, canvas.height, blockSize);

            // 2. Draw locked pieces with theme-based styling
            if (gameState.lockedPieces && gameState.lockedPieces.length > 0) {
                this.drawStyledLockedPieces(ctx, gameState.lockedPieces, blockSize);
            }

            // 3. Draw ghost piece with theme-based styling
            if (gameState.currentPiece) {
                const ghostY = calculateGhostY(
                    gameState.currentPiece,
                    gameState.lockedPieces,
                    (piece, x, y) => canPlacePiece(gameState, piece, x, y),
                );

                if (ghostY > gameState.currentPiece.y) {
                    const ghostPiece = {
                        ...gameState.currentPiece,
                        y: ghostY,
                    };
                    this.drawStyledPiece(ctx, ghostPiece, blockSize, true);

                    // Debug log for main player (first time only)
                    if (isMain && !this._ghostDebugLogged) {
                        console.log('👻 Ghost piece rendered with theme-based styling!', {
                            currentY: gameState.currentPiece.y,
                            ghostY,
                            blockSize,
                        });
                        this._ghostDebugLogged = true;
                    }
                }
            }

            // 4. Draw current piece with theme-based styling
            if (gameState.currentPiece) {
                this.drawStyledPiece(ctx, gameState.currentPiece, blockSize, false);

                // Debug log for main player (first time only)
                if (isMain && !this._pieceDebugLogged) {
                    console.log('🎮 Current piece rendered with theme-based styling!', {
                        piece: gameState.currentPiece.type,
                        color: gameState.currentPiece.color,
                        blockSize,
                    });
                    this._pieceDebugLogged = true;
                }
            }

            // 5. Update Phaser effects manager with game state (for main player only)
            if (isMain && this.effectsManager) {
                this.effectsManager.updateGameState(gameState);
            }
        } catch (err) {
            console.error(`Failed to render canvas for ${player.name}:`, err);
        }

        if (!isMain) {
            const controller = this.ensureBoardEffectsController(player.steamId, canvasData);
            if (controller) {
                controller.resize(canvas.width, canvas.height, blockSize);
            }
        }

        // Update stats
        if (isMain) {
            this.updateMainPlayerStats(player);
        } else {
            this.updateOpponentStats(player, canvasData.wrapper);
        }

        // Highlight if dead
        if (!player.isAlive) {
            this.markCanvasAsDead(canvas, ctx, player.steamId);
        }
    }

    /**
   * Update main player stats
   */
    updateMainPlayerStats(player) {
        if (!player || !player.gameState) return;

        const scoreEl = document.getElementById('main-score');
        const linesEl = document.getElementById('main-lines');
        const levelEl = document.getElementById('main-level');
        const fragsEl = document.getElementById('main-frags');

        if (scoreEl) scoreEl.textContent = player.gameState.score.toLocaleString();
        if (linesEl) linesEl.textContent = player.gameState.lines;
        if (levelEl) levelEl.textContent = player.gameState.level;
        if (fragsEl) fragsEl.textContent = player.frags || 0;
    }

    /**
   * Update opponent stats
   */
    updateOpponentStats(player, wrapper) {
        if (!wrapper) return;

        const scoreEl = wrapper.querySelector('.score');
        const fragsEl = wrapper.querySelector('.frags');

        if (scoreEl) scoreEl.textContent = player.gameState.score.toLocaleString();
        if (fragsEl) fragsEl.textContent = player.frags || 0;
    }

    /**
   * Mark canvas as dead (gray overlay)
   */
    markCanvasAsDead(canvas, ctx, steamId = null) {
        if (steamId) {
            if (steamId === this.gameState?.localPlayerId) {
                // Main player handled by Phaser effects manager
            } else {
                const controller = this.boardEffects.get(steamId);
                if (controller) {
                    controller.setDeadState(true);
                    return;
                }
            }
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ff4444';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💀', canvas.width / 2, canvas.height / 2);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.fillText('DEAD', canvas.width / 2, canvas.height / 2 + 40);
    }

    /**
   * Clear death visuals for all players (called when round restarts)
   */
    clearAllDeathVisuals() {
        console.log('🔄 Clearing death visuals for new round...');

        // Remove dead-player class from leaderboard entries
        document.querySelectorAll('.sidebar-leaderboard-entry.dead-player').forEach((el) => {
            el.classList.remove('dead-player');
        });

        // Clear death effects from canvases
        this.canvases.forEach((canvasInfo, steamId) => {
            const controller = this.boardEffects.get(steamId);
            if (controller) {
                controller.clearDeaths();
                return;
            }

            if (canvasInfo.renderer === 'phaser') {
                this.effectsManager?.setDeadState(false);
                return;
            }

            const { canvas } = canvasInfo;
            const container = canvas.parentElement;

            console.log(`  🧹 Cleaning canvas for ${steamId}:`, {
                hasCanvas: !!canvas,
                hasContainer: !!container,
                currentFilter: canvas.style.filter,
                currentOpacity: canvas.style.opacity,
            });

            // Remove grayscale filter
            canvas.style.filter = 'none';
            canvas.style.opacity = '1';

            // Remove death borders if applied
            if (container) {
                container.style.border = '';
                container.style.position = '';
            }

            // Remove "DEAD" overlay elements - search thoroughly
            const deadOverlay = container?.querySelector('.dead-overlay');
            if (deadOverlay) {
                console.log(`  ❌ Removing dead overlay for ${steamId}`);
                deadOverlay.remove();
            } else {
                console.log(`  ⚠️ No dead overlay found for ${steamId}`);
            }
        });

        // Also do a global sweep to catch any stragglers
        document.querySelectorAll('.dead-overlay').forEach((overlay) => {
            console.log('  🧹 Removing stray dead overlay');
            overlay.remove();
        });

        console.log('✅ Death visuals cleared');
    }

    /**
   * Add new player (dynamic join)
   */
    addPlayer(player) {
        if (this.canvases.has(player.steamId)) return;

        console.log(`➕ Adding player canvas: ${player.name}`);

        if (player.steamId === this.gameState.localPlayerId) {
            this.createMainCanvas();
        } else {
            this.createOpponentCanvas(player);
        }

        // Update layout
        this.updateLayout();
    }

    /**
   * Remove player (disconnect)
   */
    removePlayer(steamId) {
        const canvasData = this.canvases.get(steamId);
        if (!canvasData) return;

        console.log(`➖ Removing player canvas: ${canvasData.player.name}`);

        const controller = this.boardEffects.get(steamId);
        if (controller) {
            controller.destroy();
            this.boardEffects.delete(steamId);
        }

        // Remove DOM element
        if (canvasData.wrapper) {
            canvasData.wrapper.remove();
        }

        // Remove from map
        this.canvases.delete(steamId);

        // Update layout
        this.updateLayout();
    }

    /**
   * Cleanup
   */
    destroy() {
        this.stopRenderLoop();

        // Remove effect event listeners
        this.removeEffectEventListeners();

        // Cleanup style manager
        if (this.styleManager) {
            this.styleManager.destroy();
            this.styleManager = null;
        }

        // Destroy effects manager
        if (this.effectsManager) {
            const mainCanvasData = this.canvases.get(this.gameState?.localPlayerId);
            if (mainCanvasData?.canvas && this.mainCanvasOriginalParent) {
                this.mainCanvasOriginalParent.appendChild(mainCanvasData.canvas);
                mainCanvasData.canvas.style.position = '';
                mainCanvasData.canvas.style.top = '';
                mainCanvasData.canvas.style.left = '';
                mainCanvasData.canvas.style.width = '';
                mainCanvasData.canvas.style.height = '';
                mainCanvasData.canvas.style.zIndex = '';
                mainCanvasData.canvas.style.pointerEvents = 'none';
            }

            this.effectsManager.destroy();
            this.effectsManager = null;
        }

        if (this.container) {
            this.container.remove();
        }

        this.boardEffects.forEach((controller) => controller.destroy());
        this.boardEffects.clear();
        this.canvases.clear();
    }

    // ============================================================================
    // PHASE 1.3: New Event-Driven Rendering (replaces render loop)
    // ============================================================================

    /**
   * Render a single frame for all players
   * Called 60 times per second from FFAGameStateP2P render loop
   * This is the main entry point from the ffa:render-frame event
   */
    renderFrame(playersData) {
        if (!playersData || !Array.isArray(playersData)) return;

        // Log once to confirm new rendering is active
        if (!this._renderFrameLogged) {
            console.log('🎨 Using NEW renderFrame with upgraded canvas-drawing-utils!');
            console.log('   ✨ Solid tetrominos + pulsating ghost + Phaser effects!');
            this._renderFrameLogged = true;
        }

        playersData.forEach((playerData) => {
            const canvasInfo = this.canvases.get(playerData.steamId);
            if (!canvasInfo) return;

            // Update player reference in canvas info (preserve color!)
            canvasInfo.player = {
                ...canvasInfo.player,
                gameState: playerData.gameState,
                garbageQueue: playerData.garbageQueue,
                isAlive: playerData.isAlive,
                frags: playerData.frags || 0,
                color: canvasInfo.player.color || playerData.color || '#808080', // Preserve color
            };

            // Main player now renders via Phaser board (no legacy canvas drawing).
            if (canvasInfo.renderer === 'phaser') {
                this.renderMainPlayerPhaser(canvasInfo, playerData);
                return;
            }

            // Use the upgraded renderPlayerCanvas method for legacy canvas renderers
            this.renderPlayerCanvas(canvasInfo);

            // Draw garbage queue indicator (colored by sender)
            if (playerData.garbageQueue && playerData.garbageQueue.getTotalLines && playerData.garbageQueue.getTotalLines() > 0) {
                this.drawGarbageIndicator(canvasInfo.ctx, playerData.garbageQueue, canvasInfo.canvas.width, canvasInfo.canvas.height);
            }

            // Update stats display
            this.updatePlayerStats(playerData.steamId, playerData.gameState, playerData.frags);

            // Gray out if dead
            if (!playerData.isAlive) {
                this.markCanvasAsDead(canvasInfo.canvas, canvasInfo.ctx, playerData.steamId);
            }
        });
    }

    /**
   * Render the local player's board using the Phaser board scene so the visuals
   * and particle effects match single-player mode.
   */
    renderMainPlayerPhaser(canvasInfo, playerData) {
        if (canvasInfo.ctx) {
            canvasInfo.ctx.clearRect(0, 0, canvasInfo.canvas.width, canvasInfo.canvas.height);

            if (playerData.garbageQueue && playerData.garbageQueue.getTotalLines && playerData.garbageQueue.getTotalLines() > 0) {
                this.drawGarbageIndicator(canvasInfo.ctx, playerData.garbageQueue, canvasInfo.canvas.width, canvasInfo.canvas.height);
            }
        }

        this.updateMainPlayerStats(canvasInfo.player);

        if (!this.effectsManager) return;

        if (playerData.gameState) {
            this.effectsManager.updateGameState(playerData.gameState);
        }

        // Mirror death visuals via Phaser overlay instead of canvas drawing.
        this.effectsManager.setDeadState(!playerData.isAlive);
    }

    // NOTE: Old drawing methods removed - now using imported functions from canvas-drawing-utils.js
    // The new functions provide:
    // - drawGrid: Clean grid rendering
    // - drawLockedPieces: Solid tetromino look
    // - drawPiece: Solid pieces with outlines + pulsating ghost

    /**
   * Draw garbage queue indicator on side (colored by sender)
   * Shows stacked segments with each sender's color
   */
    drawGarbageIndicator(ctx, garbageQueue, canvasWidth, canvasHeight) {
        if (!garbageQueue || garbageQueue.getTotalLines() === 0) return;

        const blockSize = canvasWidth / COLS;
        const barWidth = blockSize * 0.5;
        const barX = canvasWidth - barWidth - 2;
        const maxHeight = canvasHeight * 0.8;
        const totalLines = garbageQueue.getTotalLines();

        // Group garbage by sender to show colored segments
        const senderGroups = new Map();
        garbageQueue.entries.forEach((entry) => {
            if (entry.type !== 'line') return; // Only count line entries

            const senderId = entry.attackerId || 'unknown';
            const senderColor = entry.color || '#808080';

            if (!senderGroups.has(senderId)) {
                senderGroups.set(senderId, { color: senderColor, count: 0 });
            }
            senderGroups.get(senderId).count += 1;
        });

        // Calculate total bar height
        const totalBarHeight = Math.min((totalLines / 20) * maxHeight, maxHeight);

        // Draw stacked segments from bottom to top
        let currentY = canvasHeight;
        senderGroups.forEach((group, senderId) => {
            const segmentHeight = (group.count / totalLines) * totalBarHeight;
            currentY -= segmentHeight;

            // Draw segment with sender's color
            ctx.fillStyle = group.color;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(barX, currentY, barWidth, segmentHeight);
            ctx.globalAlpha = 1.0;

            // Draw border with sender's color
            ctx.strokeStyle = group.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(barX, currentY, barWidth, segmentHeight);
        });

        // Draw total count at top
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(totalLines.toString(), barX + barWidth / 2, canvasHeight - totalBarHeight - 5);
        ctx.shadowBlur = 0; // Reset shadow

        // Add "DANGER" label for critical amounts (15+ lines)
        if (totalLines >= 15) {
            ctx.fillStyle = '#ffff00';
            ctx.font = 'bold 10px Arial';
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 2;
            ctx.fillText('DANGER', barX + barWidth / 2, canvasHeight - totalBarHeight - 20);
            ctx.shadowBlur = 0;
        }
    }

    /**
   * Update player stats display
   */
    updatePlayerStats(steamId, gameState, frags) {
        const isLocal = steamId === this.gameState?.localPlayerId;
        const prefix = isLocal ? 'main' : `opponent-${steamId}`;

        // Update score, lines, level
        const scoreEl = document.getElementById(`${prefix}-score`);
        const linesEl = document.getElementById(`${prefix}-lines`);
        const levelEl = document.getElementById(`${prefix}-level`);
        const fragsEl = document.getElementById(`${prefix}-frags`);

        if (scoreEl) scoreEl.textContent = (gameState.score || 0).toLocaleString();
        if (linesEl) linesEl.textContent = gameState.lines || 0;
        if (levelEl) levelEl.textContent = gameState.level || 1;
        if (fragsEl) fragsEl.textContent = frags || 0;
    }

    /**
   * Ensure canvas-based effects controller exists for a board
   * @param {string} steamId - Player identifier
   * @param {Object} canvasData - Canvas data record
   * @returns {CanvasBoardEffects|null}
   */
    ensureBoardEffectsController(steamId, canvasData) {
        if (!steamId) return null;
        if (steamId === this.gameState?.localPlayerId) {
            return null; // Main player handled by Phaser effects manager
        }

        const existing = this.boardEffects.get(steamId);
        if (existing) {
            return existing;
        }

        const container = canvasData.wrapper || canvasData.canvas.parentElement;
        if (!container) {
            return null;
        }

        const controller = new CanvasBoardEffects(container, {
            width: canvasData.canvas.width,
            height: canvasData.canvas.height,
            blockSize: canvasData.blockSize || BLOCK_SIZE,
            focused: false,
            baseCanvas: canvasData.canvas,
        });

        this.boardEffects.set(steamId, controller);
        return controller;
    }

    getBoardEffectsController(steamId) {
        if (!steamId || steamId === this.gameState?.localPlayerId) {
            return null;
        }

        const existing = this.boardEffects.get(steamId);
        if (existing) {
            return existing;
        }

        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) {
            return null;
        }

        return this.ensureBoardEffectsController(steamId, canvasInfo);
    }

    /**
   * PHASE 3.3: Apply shake effect to canvas when garbage is inserted
   */
    applyShakeEffect(steamId, intensity = 1) {
        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) return;

        const { canvas } = canvasInfo;
        const container = canvas.parentElement;
        if (!container) return;

        // Calculate shake intensity (more lines = more shake)
        const shakeAmount = Math.min(intensity * 3, 15); // Max 15px shake
        const duration = 300; // 300ms shake
        const startTime = Date.now();

        const shake = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed >= duration) {
                container.style.transform = '';
                return;
            }

            // Damped oscillation
            const progress = elapsed / duration;
            const decay = 1 - progress;
            const offsetX = (Math.random() - 0.5) * shakeAmount * decay;
            const offsetY = (Math.random() - 0.5) * shakeAmount * decay;

            container.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
            requestAnimationFrame(shake);
        };

        shake();
    }

    /**
   * PHASE 3.3: Apply flash effect when garbage is countered
   */
    applyFlashEffect(steamId, color = '#00ff00') {
        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) return;

        const controller = this.getBoardEffectsController(steamId);
        if (controller) {
            controller.triggerFlash(color, 0.75, 320);
            return;
        }

        const { canvas } = canvasInfo;
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = color;
        overlay.style.opacity = '0.5';
        overlay.style.pointerEvents = 'none';
        overlay.style.transition = 'opacity 0.3s ease-out';

        const container = canvas.parentElement;
        if (!container) return;

        container.style.position = 'relative';
        container.appendChild(overlay);

        // Fade out
        setTimeout(() => {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.remove(), 300);
        }, 50);
    }

    /**
   * PHASE 3.3: Apply death effect (grayscale + red overlay)
   */
    applyDeathEffect(steamId) {
        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) return;

        const controller = this.getBoardEffectsController(steamId);
        if (controller) {
            controller.setDeadState(true);
            return;
        }

        if (canvasInfo.renderer === 'phaser') {
            this.effectsManager?.setDeadState(true);
            return;
        }

        const { canvas } = canvasInfo;
        const container = canvas.parentElement;
        if (!container) return;

        // Apply grayscale filter
        canvas.style.filter = 'grayscale(100%) brightness(0.5)';
        canvas.style.opacity = '0.6';

        // Add red border
        container.style.border = '3px solid #ff0000';

        // Add "DEAD" overlay
        const overlay = document.createElement('div');
        overlay.className = 'dead-overlay'; // Add class for easy removal
        overlay.style.position = 'absolute';
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.fontSize = '32px';
        overlay.style.fontWeight = 'bold';
        overlay.style.color = '#ff0000';
        overlay.style.textShadow = '2px 2px 4px #000';
        overlay.style.pointerEvents = 'none';
        overlay.textContent = '💀 DEAD';

        container.style.position = 'relative';
        container.appendChild(overlay);
    }

    /**
   * PHASE 3.3: Show popup notification for garbage events
   */
    showGarbagePopup(steamId, text, color = 'red') {
        const canvasInfo = this.canvases.get(steamId);
        if (!canvasInfo) return;

        const { canvas } = canvasInfo;
        const container = canvas.parentElement;
        if (!container) return;

        const popup = document.createElement('div');
        popup.className = 'garbage-popup';
        popup.textContent = text;
        popup.style.position = 'absolute';
        popup.style.top = '10px';
        popup.style.right = '10px';
        popup.style.padding = '5px 10px';
        popup.style.borderRadius = '5px';
        popup.style.fontSize = '14px';
        popup.style.fontWeight = 'bold';
        popup.style.color = '#fff';
        popup.style.backgroundColor = color === 'red' ? 'rgba(255, 0, 0, 0.8)' : 'rgba(0, 255, 0, 0.8)';
        popup.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        popup.style.pointerEvents = 'none';
        popup.style.zIndex = '1000';
        popup.style.animation = 'popupFade 2s ease-out forwards';

        container.style.position = 'relative';
        container.appendChild(popup);

        // Remove after animation
        setTimeout(() => popup.remove(), 2000);
    }

    /**
   * Cleanup resources
   */
    cleanup() {
        // Clear render interval
        if (this.renderInterval) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }

        // Cancel animation frame
        if (this.renderFrameId) {
            cancelAnimationFrame(this.renderFrameId);
            this.renderFrameId = null;
        }

        // Remove resize listener
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }

        // Cleanup effects manager
        if (this.effectsManager) {
            this.effectsManager.destroy();
            this.effectsManager = null;
        }

        // Clear canvases
        this.canvases.clear();

        console.log('🧹 Multi-player canvas layout cleaned up');
    }
}
