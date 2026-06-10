import { COLORS, SHAPES } from '../core/constants.js';
import { drawPieceSolid } from '../rendering/canvas/canvas-drawing-utils.js';
import { TetrominoStyleManager } from '../rendering/tetromino-style-manager.js';

const DEFAULT_EFFECTS = {
    glowRadius: 0,
    glowIntensity: 0,
    glowColor: 'auto',
    outline: false,
    outlineWidth: 0,
    outlineColor: '#ffffff',
    pulse: false,
    pulseSpeed: 0,
    pulseAmplitude: 0,
};

/**
 * OpponentWatchManager - Manages the 2x2 grid of opponent mini-boards
 *
 * Features:
 * - Maximum 4 visible opponents at a time
 * - Click to swap watched players
 * - Auto-watch selects 4 alive players automatically
 * - Canvas-based rendering for performance with many players
 */
export class OpponentWatchManager {
    constructor(container) {
        this.container = container;
        this.watchedPlayers = []; // Max 4 player IDs
        this.playerBoards = new Map(); // playerId -> { canvas, ctx, nextCtx, name, element }
        this.allPlayers = [];
        this.localPlayerId = null;
        this.maxVisible = 4;
        this.autoWatchEnabled = true;
        this.autoWatchSignature = '';
        this.selectionSignature = '';
        this.selectBtn = null;
        this.autoWatchBtn = null;
        this.modeIndicator = null;
        this.popup = null;
        this.boundDocClick = null;
        this.boundPopupClick = null;
        this.boundPopupWheel = null;
        this.styleManager = null;
        this.styleInitPending = false;

        // === PERFORMANCE OPTIMIZATIONS ===
        // Persistent color cache - reused across all renders (saves ~240 Map allocations/sec)
        this._colorCache = new Map();
        // Dirty-checking hashes - only redraw when state changes
        this._boardHashes = new Map(); // playerId -> board hash
        this._pieceHashes = new Map(); // playerId -> piece signature
        this._lastNextPieces = new Map(); // playerId -> nextPieces signature

        this.animationFrameId = null;
        this.startAnimationLoop();

        this.setupEventListeners();
    }

    /**
     * Compute fast hash for board state (for dirty-checking)
     * @private
     */
    _computeBoardHash(grid) {
        if (!grid) return 0;
        let hash = 0;
        for (let row = 4; row < 24; row++) {
            const gridRow = grid[row];
            if (!gridRow) continue;
            for (let col = 0; col < 10; col++) {
                const cell = gridRow[col];
                if (cell) hash ^= (row << 16) | (col << 8) | (typeof cell === 'number' ? cell : 1);
            }
        }
        return hash;
    }

    /**
     * Compute fast hash for piece state (for dirty-checking)
     * @private
     */
    _computePieceHash(piece) {
        if (!piece) return 0;
        const type = piece.type || piece.shape?.[0]?.[0] || 0;
        return (type << 24) | ((piece.x || 0) << 16) | ((piece.y || 0) << 8) | (piece.rotation || 0);
    }

    /**
     * Setup event listeners for UI controls
     */
    setupEventListeners() {
        const selectBtn = document.getElementById('select-opponents-btn');
        if (selectBtn) {
            // Remove old listener if any (simplistic approach, mainly for hot reload safety)
            const newBtn = selectBtn.cloneNode(true);
            selectBtn.parentNode.replaceChild(newBtn, selectBtn);
            this.selectBtn = newBtn;

            this.selectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const shouldOpen = !this._isPopupVisible();
                this._setPopupVisible(shouldOpen);
            });
        }

        this.autoWatchBtn = document.getElementById('auto-watch-btn');
        this.modeIndicator = document.getElementById('watch-mode-indicator');
        this.popup = document.getElementById('opponent-selection-popup');
        if (this.popup) {
            this.boundPopupClick = (e) => {
                e.stopPropagation();
                const item = e.target.closest('.opponent-selection-item');
                if (!item || !this.popup.contains(item)) return;
                e.preventDefault();
                const pid = item.dataset.playerId;
                this.toggleWatch(pid);
            };
            this.boundPopupWheel = (e) => e.stopPropagation();
            this.popup.addEventListener('click', this.boundPopupClick);
            this.popup.addEventListener('wheel', this.boundPopupWheel, { passive: true });
        }

        this.boundDocClick = (e) => {
            if (!this.popup || this.popup.classList.contains('hidden')) return;
            if (this.popup.contains(e.target)) return;
            if (this.selectBtn && e.target === this.selectBtn) return;
            this._setPopupVisible(false);
        };
        document.addEventListener('click', this.boundDocClick);

        // Add resize listener for perfect aspect ratio sizing
        this.boundResize = this._handleResize.bind(this);
        window.addEventListener('resize', this.boundResize);

        // Use ResizeObserver for more robust layout tracking
        this.resizeObserver = new ResizeObserver(() => this._handleResize());
        if (this.container) {
            // Container may BE the .watch-grid or wrap it
            const grid = this.container.classList.contains('watch-grid')
                ? this.container
                : this.container.querySelector('.watch-grid');
            this.resizeObserver.observe(grid || this.container);
        }

        this._updateAutoWatchUI();
        this._handleResize(); // Initial sizing
    }

    /**
     * Calculates available space in the watch grid cells and sets explicit dimensions
     * to guarantee perfect 1:2 Tetris aspect ratio without CSS flexbox bugs.
     * Dynamically measures actual chrome from the DOM for pixel-perfect sizing.
     */
    _handleResize() {
        if (!this.container) return;

        // Container may BE the .watch-grid element or may wrap it
        const grid = this.container.classList.contains('watch-grid')
            ? this.container
            : this.container.querySelector('.watch-grid');
        if (!grid) return;

        // Calculate available space for a single opponent cell
        // 2 columns, 2 rows, 4px gap
        const cellW = (grid.clientWidth - 4) / 2;
        const cellH = (grid.clientHeight - 4) / 2;

        if (cellW <= 0 || cellH <= 0) return;

        // Dynamically measure chrome from the first rendered mini-board
        let verticalChrome = 42; // Conservative fallback
        let horizontalChrome = 12;

        const firstBoard = grid.querySelector('.opponent-mini-board');
        if (firstBoard) {
            const cs = getComputedStyle(firstBoard);
            const padTop = parseFloat(cs.paddingTop) || 0;
            const padBot = parseFloat(cs.paddingBottom) || 0;
            const borderV = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
            const padLeft = parseFloat(cs.paddingLeft) || 0;
            const padRight = parseFloat(cs.paddingRight) || 0;
            const borderH = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);

            // Measure each chrome element's actual height
            const nextQueue = firstBoard.querySelector('.opponent-next-queue');
            const nameEl = firstBoard.querySelector('.opponent-name');
            const fragsEl = firstBoard.querySelector('.opponent-frags');

            const nextH = nextQueue ? nextQueue.offsetHeight : 0;
            const nameH = nameEl ? nameEl.offsetHeight + (parseFloat(getComputedStyle(nameEl).marginTop) || 0) : 0;
            const fragsH = fragsEl ? fragsEl.offsetHeight + (parseFloat(getComputedStyle(fragsEl).marginTop) || 0) : 0;

            verticalChrome = padTop + padBot + borderV + nextH + nameH + fragsH;
            horizontalChrome = padLeft + padRight + borderH;
        }

        // Also account for garbage meter width + gap inside grid-frame
        const garbageMeterWidth = 10 + 3; // 10px meter + 3px gap

        const maxCanvasHeight = cellH - verticalChrome;
        const maxCanvasWidth = cellW - horizontalChrome - garbageMeterWidth;

        // Determine dimensions keeping strictly 1:2 aspect ratio (width:height)
        let canvasW = maxCanvasWidth;
        let canvasH = canvasW * 2;

        // Constrain to available height if needed
        if (canvasH > maxCanvasHeight) {
            canvasH = maxCanvasHeight;
            canvasW = canvasH / 2;
        }

        // Apply sensible minimum bound (min 50px width)
        canvasW = Math.max(50, Math.floor(canvasW));
        canvasH = canvasW * 2;

        grid.style.setProperty('--mini-canvas-width-px', `${canvasW}px`);
        grid.style.setProperty('--mini-canvas-height-px', `${canvasH}px`);
    }

    _normalizeId(id) {
        if (id === null || id === undefined) return '';
        return String(id);
    }

    _getPlayerId(player) {
        if (!player) return '';
        return this._normalizeId(player.id ?? player.steamId);
    }

    _isPopupVisible() {
        return this.popup && !this.popup.classList.contains('hidden');
    }

    _setPopupVisible(visible) {
        if (!this.popup) return;
        this.popup.classList.toggle('hidden', !visible);
        if (this.selectBtn) {
            this.selectBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
            this.selectBtn.classList.toggle('is-active', visible);
        }
    }

    _updateAutoWatchUI() {
        if (this.autoWatchBtn) {
            this.autoWatchBtn.setAttribute('aria-pressed', this.autoWatchEnabled ? 'true' : 'false');
            this.autoWatchBtn.classList.toggle('is-active', this.autoWatchEnabled);
        }
        if (this.modeIndicator) {
            this.modeIndicator.textContent = this.autoWatchEnabled ? 'AUTO' : 'MANUAL';
            this.modeIndicator.classList.toggle('is-manual', !this.autoWatchEnabled);
        }
    }

    _getStyleManager() {
        if (this.styleManager) {
            return this.styleManager;
        }
        if (this.styleInitPending) {
            return null;
        }
        const hasWindow = typeof window !== 'undefined';
        const themeManager = hasWindow ? window.themeManager : null;
        const settingsManager = hasWindow ? window.settingsManager : null;
        if (!themeManager || !settingsManager) {
            this.styleInitPending = true;
            setTimeout(() => {
                this.styleInitPending = false;
            }, 100);
            return null;
        }
        this.styleManager = new TetrominoStyleManager(themeManager, settingsManager);
        this.styleManager.init();
        return this.styleManager;
    }

    _getStyleConfig(pieceKey, fallbackColor) {
        const fallback = fallbackColor || COLORS[pieceKey] || '#808080';
        const manager = this._getStyleManager();
        if (!manager) {
            return {
                color: fallback,
                renderMode: 'solid',
                effects: { ...DEFAULT_EFFECTS },
                rendererOverrides: {},
            };
        }
        return manager.getStyleForPiece(pieceKey);
    }

    _getThemedColor(pieceType, fallbackColor, cache) {
        if (!pieceType) return fallbackColor || '#808080';
        if (cache && cache.has(pieceType)) {
            return cache.get(pieceType);
        }
        const manager = this._getStyleManager();
        const color = manager ? manager.getStyleForPiece(pieceType).color : fallbackColor;
        const resolved = color || fallbackColor || '#808080';
        if (cache) {
            cache.set(pieceType, resolved);
        }
        return resolved;
    }

    _getCellId(cell, worldX, worldY) {
        if (!cell) return null;
        if (typeof cell === 'object') {
            return cell.id ?? cell.pieceId ?? cell.shapeKey ?? `${worldX}:${worldY}`;
        }
        return `${worldX}:${worldY}`;
    }

    _getCellColor(cell, cache) {
        if (!cell || cell === 0) return null;
        if (typeof cell === 'string') {
            const fallback = COLORS[cell] || cell;
            return COLORS[cell]
                ? this._getThemedColor(cell, fallback, cache)
                : fallback;
        }
        if (typeof cell === 'number') {
            return '#808080';
        }

        let colorValue = cell.color;
        if (typeof colorValue === 'string' && COLORS[colorValue]) {
            colorValue = COLORS[colorValue];
        }

        if (cell.type) {
            const isGarbage = cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE';
            const isCustomColor = cell.color && cell.color !== '#808080';
            if (!isGarbage || !isCustomColor) {
                colorValue = this._getThemedColor(cell.type, colorValue, cache);
            }
        }

        return colorValue || '#808080';
    }

    _getGhostAlpha(gridX, gridY) {
        const minAlpha = 0.1;
        const maxAlpha = 0.35;
        const PULSE_SPEED = 0.005;
        const POSITION_PHASE_SHIFT = 0.45;
        const phase = Date.now() * PULSE_SPEED + (gridX + gridY) * POSITION_PHASE_SHIFT;
        const pulse = 0.5 + 0.5 * Math.sin(phase);
        return minAlpha + (maxAlpha - minAlpha) * pulse;
    }

    startAnimationLoop() {
        if (this.animationFrameId) return;
        const animate = () => {
            this._animate();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    stopAnimationLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    _animate() {
        this.watchedPlayers.forEach((playerId) => {
            const player = this._getPlayerById(playerId);
            const board = this.playerBoards.get(playerId);
            if (player && board && player.grid) {
                this._renderMiniBoard(board.ctx, player.grid, player.currentPiece, player.blindTimers);
            }
        });
    }

    toggleAutoWatch() {
        this.setAutoWatchEnabled(!this.autoWatchEnabled);
    }

    setAutoWatchEnabled(enabled) {
        const next = Boolean(enabled);
        if (this.autoWatchEnabled === next) return;
        this.autoWatchEnabled = next;
        this._updateAutoWatchUI();

        if (this.autoWatchEnabled) {
            this.autoWatchSignature = this._buildAutoSignature(this.allPlayers);
            this.autoSelectOpponents({ preserveCurrent: false });
        }
        this._updateSelectionList(undefined, { force: true });
    }

    _setWatchedPlayers(nextList) {
        const normalized = nextList.map((id) => this._normalizeId(id)).filter(Boolean);
        const current = this.watchedPlayers;
        const isSame = normalized.length === current.length
            && normalized.every((id, index) => id === current[index]);
        if (isSame) return false;
        this.watchedPlayers = normalized;
        this.updateDisplay();
        this.updateWatchingCount();
        this._updateSelectionList(undefined, { force: true });
        return true;
    }

    _buildAutoSignature(sourcePlayers = this.allPlayers) {
        const entries = sourcePlayers
            .map((player) => ({
                id: this._getPlayerId(player),
                alive: player?.isAlive === false ? '0' : '1',
            }))
            .filter((entry) => entry.id && entry.id !== this.localPlayerId)
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((entry) => `${entry.id}:${entry.alive}`);
        return entries.join('|');
    }

    _buildSelectionSignature(playerStates = []) {
        const stateMap = new Map();
        playerStates.forEach((state) => {
            const stateId = this._getPlayerId(state);
            if (!stateId) return;
            stateMap.set(stateId, state);
        });

        const players = this.allPlayers
            .map((player) => {
                const id = this._getPlayerId(player);
                if (!id) return null;
                const state = stateMap.get(id) || player;
                const isAlive = state.isAlive !== false;
                const frags = state.frags || 0;
                return `${id}:${isAlive ? 1 : 0}:${frags}`;
            })
            .filter(Boolean)
            .sort();

        return [
            this.autoWatchEnabled ? 'auto' : 'manual',
            this.watchedPlayers.join(','),
            players.join('|'),
        ].join('#');
    }

    _syncWatchedPlayers() {
        const validIds = new Set(this.allPlayers.map((p) => this._getPlayerId(p)).filter(Boolean));
        this.watchedPlayers = this.watchedPlayers.filter((id) => validIds.has(id));
    }

    _getPlayerById(playerId) {
        const normalizedId = this._normalizeId(playerId);
        return this.allPlayers.find((p) => this._getPlayerId(p) === normalizedId);
    }

    /**
     * Set the local player ID (to exclude from watch list)
     */
    setLocalPlayer(playerId) {
        this.localPlayerId = this._normalizeId(playerId);
    }

    /**
     * Set all players in the match
     * @param {Array} players - Array of player objects { id, name, isAlive, frags, grid }
     */
    setPlayers(players) {
        // Filter out the local player
        this.allPlayers = players.filter((p) => {
            const id = this._getPlayerId(p);
            return id && id !== this.localPlayerId;
        });
        this.autoWatchSignature = this._buildAutoSignature(this.allPlayers);

        if (this.autoWatchEnabled) {
            this.autoSelectOpponents();
        } else {
            this._syncWatchedPlayers();
            this.updateDisplay();
            this.updateWatchingCount();
            this._updateSelectionList(this.allPlayers, { force: true });
        }
    }

    /**
     * Auto-select up to 4 opponents (prioritize alive players)
     */
    autoSelectOpponents({ preserveCurrent = true } = {}) {
        if (!this.autoWatchEnabled) return;
        const alive = this.allPlayers.filter((p) => p.isAlive !== false);
        const dead = this.allPlayers.filter((p) => p.isAlive === false);

        // Keep currently watched alive players if possible
        const currentAlive = preserveCurrent
            ? this.watchedPlayers.filter((id) => alive.some((p) => this._getPlayerId(p) === id))
            : [];

        // Fill remaining slots with other alive players
        const newAlive = alive
            .filter((p) => !currentAlive.includes(this._getPlayerId(p)))
            .slice(0, this.maxVisible - currentAlive.length)
            .map((p) => this._getPlayerId(p));

        const nextWatched = [...currentAlive, ...newAlive];

        // If still room, add dead players
        if (nextWatched.length < this.maxVisible) {
            const additionalDead = dead
                .filter((p) => !nextWatched.includes(this._getPlayerId(p)))
                .slice(0, this.maxVisible - nextWatched.length)
                .map((p) => this._getPlayerId(p));
            nextWatched.push(...additionalDead);
        }

        this._setWatchedPlayers(nextWatched);
    }

    /**
     * Toggle watching a specific player
     */
    toggleWatch(playerId) {
        const normalizedId = this._normalizeId(playerId);
        if (!normalizedId) return;

        if (this.autoWatchEnabled) {
            this.setAutoWatchEnabled(false);
        }

        const index = this.watchedPlayers.indexOf(normalizedId);

        if (index !== -1) {
            // Already watching - remove
            this.watchedPlayers.splice(index, 1);
        } else {
            const player = this._getPlayerById(normalizedId);
            if (!player) return;
            // Not watching - add (replace oldest if at max)
            if (this.watchedPlayers.length >= this.maxVisible) {
                this.watchedPlayers.shift();
            }
            this.watchedPlayers.push(normalizedId);
        }
        this.updateDisplay();
        this.updateWatchingCount();
        this._updateSelectionList(undefined, { force: true });
    }

    /**
     * Update the display of mini-boards
     */
    updateDisplay() {
        if (!this.container) return;

        console.log('[OpponentWatch] Updating display. Watched:', this.watchedPlayers);

        // Clear container
        this.container.innerHTML = '';
        this.playerBoards.clear();

        // Create mini-board for each watched player
        this.watchedPlayers.forEach((playerId) => {
            const player = this._getPlayerById(playerId);
            if (!player) {
                console.warn(`[OpponentWatch] Player ${playerId} not found in allPlayers!`);
                return;
            }

            const boardEl = this._createMiniBoardElement(player);
            this.container.appendChild(boardEl);

            const canvas = boardEl.querySelector('canvas.opponent-grid');
            const nextCanvases = Array.from(boardEl.querySelectorAll('.opponent-next-piece canvas'));
            const garbageMeter = boardEl.querySelector('.opponent-garbage-meter');
            const garbageFill = boardEl.querySelector('.opponent-garbage-fill');
            const garbageSegments = boardEl.querySelector('.opponent-garbage-segments');
            const boardFrame = boardEl.querySelector('.opponent-grid-frame');
            const playerKey = this._getPlayerId(player);

            // Store using the original ID from the player object to match updateFromState
            this.playerBoards.set(playerKey, {
                canvas,
                ctx: canvas.getContext('2d'),
                nextCtxs: nextCanvases.map(c => c.getContext('2d')),
                garbageMeter,
                garbageFill,
                garbageSegments,
                frame: boardFrame,
                isEliminated: player.isAlive === false,
                deathAnimationActive: false,
                name: player.name,
                element: boardEl,
            });

            // Initial render
            if (player.grid) {
                // Use the map entry we just created (using player.id)
                this._renderMiniBoard(this.playerBoards.get(playerKey).ctx, player.grid, player.currentPiece, player.blindTimers);
            }
            if (player.nextPieces && this.playerBoards.get(playerKey).nextCtxs) {
                this._renderNextQueue(this.playerBoards.get(playerKey).nextCtxs, player.nextPieces);
            }
            this._updateGarbageMeter(this.playerBoards.get(playerKey), player);
        });

        // Recalculate canvas sizes now that boards are in the DOM
        // (dynamic chrome measurement needs rendered elements)
        this._handleResize();
    }

    /**
     * Update watching count display
     */
    updateWatchingCount() {
        const countEl = document.getElementById('watching-count');
        if (countEl) {
            countEl.textContent = `${this.watchedPlayers.length}/${this.maxVisible}`;
        }
    }

    /**
     * Create a mini-board DOM element for a player
     */
    _createMiniBoardElement(player) {
        const div = document.createElement('div');
        const playerId = this._getPlayerId(player);
        div.className = `opponent-mini-board ${player.isAlive === false ? 'dead' : ''}`;
        div.dataset.playerId = playerId;

        div.innerHTML = `
            <div class="opponent-next-queue">
                <div class="opponent-next-pieces">
                    <div class="opponent-next-piece highlight"><canvas></canvas></div>
                    <div class="opponent-next-piece"><canvas></canvas></div>
                    <div class="opponent-next-piece"><canvas></canvas></div>
                </div>
            </div>
            <div class="opponent-grid-frame">
                <div class="opponent-garbage-meter">
                    <div class="opponent-garbage-fill"></div>
                    <div class="opponent-garbage-segments"></div>
                    <div class="opponent-garbage-glow"></div>
                </div>
                <canvas class="opponent-grid"></canvas>
            </div>
            <span class="opponent-name">${this._escapeHtml(player.name)}</span>
            <span class="opponent-frags">⚔️ ${player.frags || 0}</span>
        `;

        // Click to swap/unwatch
        div.onclick = () => this.toggleWatch(playerId);

        return div;
    }

    /**
     * Update all mini-boards from network state
     * @param {Array} playerStates - Array of player state objects
     */
    updateFromState(playerStates) {
        if (!playerStates) return;

        // Sync allPlayers with latest state to ensure fresh data when swapping
        const stateMap = new Map();
        playerStates.forEach((state) => {
            const stateId = this._getPlayerId(state);
            if (!stateId) return;
            stateMap.set(stateId, state);
            const player = this.allPlayers.find((p) => this._getPlayerId(p) === stateId);
            if (player) {
                const preservedId = player.id;
                Object.assign(player, state);
                player.id = preservedId;
            }
        });

        if (this.autoWatchEnabled) {
            const signature = this._buildAutoSignature(Array.from(stateMap.values()));
            if (signature && signature !== this.autoWatchSignature) {
                this.autoWatchSignature = signature;
                this.autoSelectOpponents();
            }
        }

        playerStates.forEach((state) => {
            const stateId = this._getPlayerId(state);
            if (!stateId) return;
            const board = this.playerBoards.get(stateId);
            if (board) {
                // PERF: Dirty-checking - only redraw if state changed
                // OBSOLETE: _renderMiniBoard is now called in animation loop for smooth ghost pieces
                /*
                const boardHash = this._computeBoardHash(state.grid);
                const pieceHash = this._computePieceHash(state.currentPiece);
                const prevBoardHash = this._boardHashes.get(stateId);
                const prevPieceHash = this._pieceHashes.get(stateId);

                // Only redraw canvas if board or piece changed
                if (boardHash !== prevBoardHash || pieceHash !== prevPieceHash) {
                    this._renderMiniBoard(board.ctx, state.grid, state.currentPiece);
                    this._boardHashes.set(stateId, boardHash);
                    this._pieceHashes.set(stateId, pieceHash);
                }
                */

                // Update next queue only if changed
                if (state.nextPieces && board.nextCtxs) {
                    const nextSig = state.nextPieces.slice(0, 3).join(',');
                    const prevNextSig = this._lastNextPieces.get(stateId);
                    if (nextSig !== prevNextSig) {
                        this._renderNextQueue(board.nextCtxs, state.nextPieces);
                        this._lastNextPieces.set(stateId, nextSig);
                    }
                }

                // Update alive status + death animation
                const isDead = state.isAlive === false;
                const wasDead = board.isEliminated === true;
                if (isDead && !wasDead) {
                    board.isEliminated = true;
                    board.element.classList.add('dead');
                    this._showOpponentDeathAnimation(board);
                } else if (!isDead && wasDead) {
                    board.isEliminated = false;
                    board.element.classList.remove('dead');
                    this._clearOpponentDeathState(board);
                } else if (isDead) {
                    board.element.classList.add('dead');
                    this._ensureOpponentDeathOverlay(board);
                } else {
                    board.element.classList.remove('dead');
                }

                // Update disconnect status
                if (state.isDisconnected) {
                    this._showDisconnectOverlay(board);
                } else {
                    this._hideDisconnectOverlay(board);
                }

                // Update frags display
                const fragsEl = board.element.querySelector('.opponent-frags');
                if (fragsEl) {
                    fragsEl.textContent = `⚔️ ${state.frags || 0}`;
                }

                // Apply player color: subtle outer card + prominent inner grid border
                if (state.color) {
                    const c = state.color;
                    // Outer card stays subtle — just a gentle glow
                    board.element.style.boxShadow = `0 0 20px ${c}25, inset 0 0 12px ${c}0a`;
                    board.element.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.5), ${c}08)`;

                    // Inner grid canvas border is the prominent player-colored frame
                    const gridCanvas = board.element.querySelector('canvas.opponent-grid');
                    if (gridCanvas) {
                        gridCanvas.style.borderRightColor = c;
                        gridCanvas.style.borderBottomColor = c;
                        gridCanvas.style.borderLeftColor = c;
                    }

                    const highlightPiece = board.element.querySelector('.opponent-next-piece.highlight');
                    if (highlightPiece) {
                        highlightPiece.style.borderColor = c;
                    }
                }

                this._updateGarbageMeter(board, state);
            }
        });

        // Update selection list
        this._updateSelectionList(playerStates);
    }

    /**
     * Render next queue for opponent into individual piece canvases
     */
    _renderNextQueue(ctxs, nextPieces) {
        if (!ctxs || !ctxs.length || !nextPieces) return;

        const slots = ctxs.length;

        for (let i = 0; i < Math.min(slots, nextPieces.length); i++) {
            const ctx = ctxs[i];
            const canvas = ctx.canvas;

            // CSS sets the pixel size of the canvas, we just need to match internal res
            const rect = canvas.getBoundingClientRect();
            // Fallbacks based on CSS
            const fallbackSizes = [36, 28, 22]; // First piece is bigger
            const displayWidth = Math.floor(rect.width) || fallbackSizes[i];
            const displayHeight = Math.floor(rect.height) || fallbackSizes[i];

            if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
                canvas.width = displayWidth;
                canvas.height = displayHeight;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;

            const shapeKey = nextPieces[i];
            const shape = SHAPES[shapeKey];
            if (!shape) continue;

            const rows = shape.length;
            const cols = shape[0].length;

            // Dynamic block size based on slot size to fill it well
            const padding = 2; // 2px padding inside the box
            const maxBlockWidth = Math.floor((displayWidth - padding * 2) / cols);
            const maxBlockHeight = Math.floor((displayHeight - padding * 2) / rows);

            // Scale first piece slightly differently if desired, but min works best
            const blockSize = Math.min(maxBlockWidth, maxBlockHeight);

            const pieceWidth = cols * blockSize;
            const pieceHeight = rows * blockSize;
            const startX = Math.round((displayWidth - pieceWidth) / 2);
            const startY = Math.round((displayHeight - pieceHeight) / 2);

            const styleConfig = this._getStyleConfig(shapeKey);
            drawPieceSolid(ctx, shape, startX, startY, blockSize, styleConfig);
        }

        // Clear any remaining slots
        for (let i = nextPieces.length; i < slots; i++) {
            const ctx = ctxs[i];
            if (ctx && ctx.canvas) {
                ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            }
        }
    }

    _updateGarbageMeter(board, state) {
        if (!board || !board.garbageFill) return;

        const queue = state?.garbageQueue;
        const isQueue = queue && typeof queue.getTotalLines === 'function';
        const rawAmount = state?.garbagePending ?? state?.pendingGarbage ?? 0;
        const amount = isQueue ? queue.getTotalLines() : Number(rawAmount || 0);
        const percentage = Math.min(100, (amount / 20) * 100);

        board.garbageFill.style.height = `${percentage}%`;

        if (board.garbageSegments) {
            this._renderGarbageSegments(board.garbageSegments, isQueue ? queue : null, amount);
        }

        if (board.garbageMeter) {
            board.garbageMeter.classList.toggle('pending', amount > 0);
            board.garbageMeter.classList.toggle('warning', amount >= 8);
        }
    }

    _renderGarbageSegments(container, garbageQueue, totalLines) {
        container.innerHTML = '';
        if (!garbageQueue || totalLines <= 0) return;

        const lineEntries = garbageQueue.entries.filter((entry) => entry.type === 'line');
        if (lineEntries.length === 0) return;

        const segments = [];
        lineEntries.forEach((entry) => {
            const color = entry.color || '#808080';
            const last = segments[segments.length - 1];
            if (last && last.color === color) {
                last.lines += 1;
            } else {
                segments.push({
                    color,
                    lines: 1,
                });
            }
        });

        const maxLines = 20;
        const scale = totalLines > maxLines ? maxLines / totalLines : 1;

        segments.forEach((segment) => {
            const height = (segment.lines * scale / maxLines) * 100;
            const div = document.createElement('div');
            div.className = 'opponent-garbage-segment';
            div.style.height = `${height}%`;
            div.style.background = segment.color;
            container.appendChild(div);
        });
    }

    _showOpponentDeathAnimation(board, killerName = null) {
        const container = board?.frame || board?.element;
        if (!container) return;

        if (container.querySelector('.death-overlay')) {
            return;
        }

        board.deathAnimationActive = true;
        container.classList.add('death-shake');
        setTimeout(() => container.classList.remove('death-shake'), 450);

        const flashOverlay = document.createElement('div');
        flashOverlay.className = 'death-flash-overlay';
        flashOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: white;
            opacity: 0;
            z-index: 50;
            pointer-events: none;
            transition: opacity 0.4s ease-in-out;
            border-radius: inherit;
        `;
        container.appendChild(flashOverlay);

        requestAnimationFrame(() => {
            flashOverlay.style.opacity = '0.8';
            setTimeout(() => {
                flashOverlay.style.opacity = '0';
                setTimeout(() => flashOverlay.remove(), 400);
            }, 200);
        });

        setTimeout(() => {
            this._createOpponentDeathOverlay(container, killerName);
            board.deathAnimationActive = false;
        }, 500);
    }

    _createOpponentDeathOverlay(container, killerName = null) {
        if (container.querySelector('.death-overlay')) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'death-overlay';
        overlay.innerHTML = `
            <div class="death-content">
                <div class="death-skull">💀</div>
                <div class="death-text">ELIMINATED</div>
                <div class="death-killer"></div>
            </div>
        `;
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100;
            pointer-events: none;
            border-radius: inherit;
        `;

        const content = overlay.querySelector('.death-content');
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        `;

        const skull = overlay.querySelector('.death-skull');
        skull.style.cssText = `
            font-size: 64px;
            opacity: 0;
            transform: scale(0.5) rotate(-45deg);
            transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        `;

        const text = overlay.querySelector('.death-text');
        text.style.cssText = `
            font-size: 24px;
            font-weight: 700;
            color: #fc8181;
            text-shadow: 0 0 20px rgba(252, 129, 129, 0.5);
            opacity: 0;
            transform: scale(0.5) translateY(20px);
            transition: all 0.4s ease-out 0.2s;
        `;

        const killer = overlay.querySelector('.death-killer');
        if (killerName) {
            killer.textContent = `by ${killerName}`;
            killer.style.cssText = `
                font-size: 14px;
                color: #cbd5e0;
                opacity: 0;
                letter-spacing: 0.5px;
                transform: translateY(6px);
                transition: all 0.4s ease-out 0.3s;
            `;
        } else {
            killer.remove();
        }

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(overlay);

        requestAnimationFrame(() => {
            skull.style.opacity = '1';
            skull.style.transform = 'scale(1) rotate(0deg)';
            text.style.opacity = '1';
            text.style.transform = 'scale(1) translateY(0)';
            if (killerName) {
                killer.style.opacity = '1';
                killer.style.transform = 'translateY(0)';
            }
        });
    }

    _ensureOpponentDeathOverlay(board) {
        if (!board || board.deathAnimationActive) return;
        const container = board.frame || board.element;
        if (!container) return;
        this._createOpponentDeathOverlay(container);
    }

    _showDisconnectOverlay(board) {
        const container = board.frame || board.element;
        if (!container) return;

        let overlay = container.querySelector('.disconnect-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'disconnect-overlay';
            overlay.innerHTML = `
                <div class="disconnect-icon">🔌</div>
                <div class="disconnect-text">DISCONNECTED</div>
            `;
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                z-index: 90;
                border-radius: inherit;
                backdrop-filter: grayscale(100%);
            `;
            const icon = overlay.querySelector('.disconnect-icon');
            icon.style.cssText = 'font-size: 32px; margin-bottom: 4px;';

            const text = overlay.querySelector('.disconnect-text');
            text.style.cssText = 'font-size: 10px; font-weight: bold; color: #fbbf24; letter-spacing: 1px;';

            if (getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.appendChild(overlay);
        }
    }

    _hideDisconnectOverlay(board) {
        const container = board.frame || board.element;
        if (!container) return;
        const overlay = container.querySelector('.disconnect-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    _clearOpponentDeathState(board) {
        const container = board?.frame || board?.element;
        if (!container) return;

        const deathOverlay = container.querySelector('.death-overlay');
        if (deathOverlay) {
            deathOverlay.remove();
        }

        const flashOverlay = container.querySelector('.death-flash-overlay');
        if (flashOverlay) {
            flashOverlay.remove();
        }
        board.deathAnimationActive = false;
    }

    /**
     * Update the selection list for watched/unwatched opponents
     */
    _updateSelectionList(playerStates, { force = false } = {}) {
        const selectionContainer = document.getElementById('opponent-selection-popup');

        if (!selectionContainer) return;
        this.popup = selectionContainer;

        const signature = this._buildSelectionSignature(playerStates || this.allPlayers);
        if (!force && signature && signature === this.selectionSignature) {
            return;
        }
        this.selectionSignature = signature;

        const players = this.allPlayers;
        if (players.length === 0) {
            selectionContainer.innerHTML = '<div class="selection-empty">No opponents yet.</div>';
            return;
        }

        const stateMap = new Map();
        (playerStates || []).forEach((state) => {
            const stateId = this._getPlayerId(state);
            if (stateId) {
                stateMap.set(stateId, state);
            }
        });

        const watchedSet = new Set(this.watchedPlayers);
        const watched = [];
        const available = [];

        players.forEach((player) => {
            const id = this._getPlayerId(player);
            if (!id) return;
            if (watchedSet.has(id)) {
                watched.push(player);
            } else {
                available.push(player);
            }
        });

        const hint = this.autoWatchEnabled
            ? 'Auto Watch is on. Manual picks switch to Manual mode.'
            : `Manual mode. Pick up to ${this.maxVisible} opponents.`;

        const renderRows = (list, isWatched) => list.map((player) => {
            const id = this._getPlayerId(player);
            const state = stateMap.get(id) || player;
            const isDead = state.isAlive === false;
            const toggleLabel = isWatched ? '-' : '+';
            return `
                <button class="opponent-selection-item ${isWatched ? 'watched' : ''} ${isDead ? 'dead' : ''}" type="button" data-player-id="${id}" aria-pressed="${isWatched}">
                    <span class="selection-toggle">${toggleLabel}</span>
                    <span class="selection-name">${this._escapeHtml(player.name)}</span>
                    <span class="selection-frags">⚔️ ${state.frags || 0}</span>
                </button>
            `;
        }).join('');

        const watchedSection = watched.length
            ? `
                <div class="selection-group">
                    <div class="selection-group-title">Watching (${this.watchedPlayers.length}/${this.maxVisible})</div>
                    ${renderRows(watched, true)}
                </div>
            `
            : '';

        const availableSection = available.length
            ? `
                <div class="selection-group">
                    <div class="selection-group-title">Available (${available.length})</div>
                    ${renderRows(available, false)}
                </div>
            `
            : '<div class="selection-empty">All opponents are currently watched.</div>';

        selectionContainer.innerHTML = `
            <div class="selection-header">
                <div class="selection-title">Select opponents</div>
                <div class="selection-hint">${hint}</div>
            </div>
            <div class="selection-list">
                ${watchedSection}
                ${availableSection}
            </div>
            <div class="selection-footer">${this.watchedPlayers.length}/${this.maxVisible} watching</div>
        `;

        if (!this.popup) {
            this.popup = selectionContainer;
        }
    }

    /**
     * Render a mini-board to canvas
     * Uses 8px block size for compact display
     */
    _renderMiniBoard(ctx, grid, currentPiece, blindTimers) {
        if (!ctx || !grid) return;

        // Dynamically get the parent frame's actual dimensions or the element's client dimensions
        // This ensures the internal canvas resolution exactly matches the CSS display resolution
        const canvas = ctx.canvas;
        const rect = canvas.getBoundingClientRect();

        // Only resize if the dimensions have actually changed to avoid expensive DOM operations
        const displayWidth = Math.floor(rect.width) || parseFloat(getComputedStyle(canvas).getPropertyValue('--mini-canvas-width-px')) || 80;
        const displayHeight = Math.floor(rect.height) || parseFloat(getComputedStyle(canvas).getPropertyValue('--mini-canvas-height-px')) || 160;

        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
        }

        // Tetris board is ALWAYS exactly 10 blocks wide.
        // Calculate dynamic block size based on the new, true canvas width.
        const blockSize = canvas.width / 10;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'rgba(10, 15, 25, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Render cohesive opponent grid blocks
        this._drawCohesiveGrid(ctx, grid, blockSize, this._colorCache);

        // Render Quadra blind blackout veils
        if (blindTimers) {
            if (blindTimers.field > 0) {
                const ratio = blindTimers.field / (blindTimers.fieldMax || 4.0);
                const alpha = Math.max(0, Math.min(0.95, ratio * 1.25));
                ctx.fillStyle = `rgba(10, 15, 25, ${alpha})`;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (blindTimers.pending > 0) {
                const ratio = blindTimers.pending / (blindTimers.pendingMax || 4.0);
                const alpha = Math.max(0, Math.min(0.95, ratio * 1.25));
                ctx.fillStyle = `rgba(10, 15, 25, ${alpha})`;
                for (let r = 4; r < grid.length; r++) {
                    const gridRow = grid[r];
                    if (!gridRow) continue;
                    const hasGarbage = gridRow.some(cell => {
                        if (!cell) return false;
                        const type = typeof cell === 'object' ? cell.type : cell;
                        return type === 'garbage' || type === 'clean_garbage';
                    });
                    if (hasGarbage) {
                        ctx.fillRect(0, (r - 4) * blockSize, canvas.width, blockSize);
                    }
                }
            }
        }

        if (currentPiece && currentPiece.shape) {
            const ghostY = this._calculateGhostY(currentPiece, grid);
            if (ghostY > currentPiece.y) {
                this._drawGhostPiece(ctx, currentPiece, ghostY, blockSize);
            }
            this._drawCurrentPiece(ctx, currentPiece, blockSize, this._colorCache);
        }
    }

    _drawCohesiveGrid(ctx, grid, blockSize, colorCache) {
        if (!grid || grid.length === 0) return;

        const rows = grid.length;
        const cols = grid[0] ? grid[0].length : 0;
        if (cols === 0) return;

        // Create a visited matrix
        const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

        for (let row = 4; row < rows; row++) {
            const gridRow = grid[row];
            if (!gridRow) continue;

            for (let col = 0; col < cols; col++) {
                if (visited[row][col]) continue;

                const cell = gridRow[col];
                if (!cell || cell === 0) {
                    visited[row][col] = true;
                    continue;
                }

                // Found an unvisited filled cell. Find its contiguous component.
                const cellId = this._getCellId(cell, col, row);
                const cellColor = this._getCellColor(cell, colorCache);
                const cellType = typeof cell === 'object' ? (cell.type || cell.shapeKey || cell.color) : cell;

                const blocks = [];
                const queue = [{ x: col, y: row }];
                visited[row][col] = true;

                let minX = col;
                let maxX = col;
                let minY = row;
                let maxY = row;

                let head = 0;
                while (head < queue.length) {
                    const curr = queue[head++];
                    blocks.push(curr);

                    if (curr.x < minX) minX = curr.x;
                    if (curr.x > maxX) maxX = curr.x;
                    if (curr.y < minY) minY = curr.y;
                    if (curr.y > maxY) maxY = curr.y;

                    // Check neighbors (only within bounds and visible area Y >= 4)
                    const neighbors = [
                        { x: curr.x + 1, y: curr.y },
                        { x: curr.x - 1, y: curr.y },
                        { x: curr.x, y: curr.y + 1 },
                        { x: curr.x, y: curr.y - 1 },
                    ];

                    for (const { x: nx, y: ny } of neighbors) {
                        if (ny >= 4 && ny < rows && nx >= 0 && nx < cols && !visited[ny][nx]) {
                            const nCell = grid[ny][nx];
                            if (nCell && nCell !== 0 && this._getCellId(nCell, nx, ny) === cellId) {
                                visited[ny][nx] = true;
                                queue.push({ x: nx, y: ny });
                            }
                        }
                    }
                }

                // Build local shape matrix for drawPieceSolid
                const shapeWidth = maxX - minX + 1;
                const shapeHeight = maxY - minY + 1;
                const pieceShape = Array.from({ length: shapeHeight }, () => new Array(shapeWidth).fill(0));

                for (let i = 0; i < blocks.length; i++) {
                    const b = blocks[i];
                    pieceShape[b.y - minY][b.x - minX] = 1;
                }

                // Get themed style config
                let baseStyle = this._getStyleConfig(cellType);
                let styleConfig;
                if (baseStyle) {
                    styleConfig = { ...baseStyle, effects: { ...(baseStyle.effects || {}) } };
                    if (cellColor) {
                        styleConfig.color = cellColor;
                        if (styleConfig.effects.glowColor) styleConfig.effects.glowColor = cellColor;
                        if (styleConfig.effects.outlineColor) styleConfig.effects.outlineColor = cellColor;
                    }
                } else {
                    styleConfig = {
                        color: cellColor || '#808080',
                        renderMode: 'solid',
                        effects: {
                            glowRadius: 0,
                            glowIntensity: 0,
                            glowColor: cellColor || '#808080',
                            outline: false,
                            outlineWidth: 0,
                            outlineColor: cellColor || '#808080',
                            pulse: false,
                            pulseSpeed: 0,
                            pulseAmplitude: 0,
                        },
                        rendererOverrides: {},
                    };
                }

                const offsetX = minX * blockSize;
                const offsetY = (minY - 4) * blockSize;

                // Draw component cohesively
                drawPieceSolid(ctx, pieceShape, offsetX, offsetY, blockSize, styleConfig);
            }
        }
    }

    _drawGhostPiece(ctx, piece, pieceY, blockSize) {
        const { shape } = piece;
        if (!shape) return;

        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (!shape[row][col]) continue;

                const worldY = pieceY + row;
                const drawRow = worldY - 4;
                const drawCol = piece.x + col;

                if (drawRow >= 0 && drawRow < 20 && drawCol >= 0 && drawCol < 10) {
                    const alpha = this._getGhostAlpha(drawCol, worldY);
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.fillRect(
                        Math.round(drawCol * blockSize),
                        Math.round(drawRow * blockSize),
                        blockSize,
                        blockSize,
                    );
                }
            }
        }
    }

    _drawCurrentPiece(ctx, piece, blockSize, colorCache) {
        const { shape } = piece;
        if (!shape) return;

        const pieceType = piece.type || piece.shapeKey;
        let fallbackColor = piece.color;
        if (typeof fallbackColor === 'string' && window.themeManager?.colors?.[fallbackColor]) { // In OpponentWatchManager COLORS is imported actually. Wait, let me just assume COLORS is around. Actually, we had a `COLORS` reference. I'll rely on whatever was there to avoid undefined variables. The original code literally said `COLORS[fallbackColor]`. Let me keep what was in the original `_drawCurrentPiece`.
            // Wait, let's look back at my previous view_file.
            // if (typeof fallbackColor === 'string' && COLORS[fallbackColor]) {
            //     fallbackColor = COLORS[fallbackColor];
            // }
            // Let's just do exactly that.
        }
        if (typeof fallbackColor === 'string' && COLORS[fallbackColor]) {
            fallbackColor = COLORS[fallbackColor];
        }
        if (!fallbackColor && pieceType) {
            fallbackColor = COLORS[pieceType];
        }
        const pieceColor = this._getThemedColor(pieceType, fallbackColor, colorCache);

        let baseStyle = this._getStyleConfig(pieceType);
        let styleConfig;
        if (baseStyle) {
            styleConfig = { ...baseStyle, effects: { ...(baseStyle.effects || {}) } };
            if (pieceColor) {
                styleConfig.color = pieceColor;
                if (styleConfig.effects.glowColor) styleConfig.effects.glowColor = pieceColor;
                if (styleConfig.effects.outlineColor) styleConfig.effects.outlineColor = pieceColor;
            }
        } else {
            styleConfig = {
                color: pieceColor || '#808080',
                renderMode: 'solid',
                effects: {
                    glowRadius: 0,
                    glowIntensity: 0,
                    glowColor: pieceColor || '#808080',
                    outline: false,
                    outlineWidth: 0,
                    outlineColor: pieceColor || '#808080',
                    pulse: false,
                    pulseSpeed: 0,
                    pulseAmplitude: 0,
                },
                rendererOverrides: {},
            };
        }

        const offsetX = piece.x * blockSize;
        const offsetY = (piece.y - 4) * blockSize;

        drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig);
    }

    _calculateGhostY(piece, grid) {
        let ghostY = piece.y;
        while (this._canPlacePiece(piece, grid, piece.x, ghostY + 1)) {
            ghostY++;
        }
        return ghostY;
    }

    _canPlacePiece(piece, grid, checkX, checkY) {
        const { shape } = piece;
        if (!shape) return false;

        const rows = grid.length || 0;
        for (let row = 0; row < shape.length; row++) {
            for (let col = 0; col < shape[row].length; col++) {
                if (!shape[row][col]) continue;

                const boardX = Math.floor(checkX + col);
                const boardY = Math.floor(checkY + row);

                if (boardX < 0 || boardX >= 10 || boardY >= rows) {
                    return false;
                }

                if (boardY >= 0) {
                    const cell = grid[boardY]?.[boardX];
                    if (cell && cell !== 0) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }



    /**
     * Cleanup resources
     */
    destroy() {
        this.stopAnimationLoop();

        if (this.boundResize) {
            window.removeEventListener('resize', this.boundResize);
            this.boundResize = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.playerBoards.clear();
        this.watchedPlayers = [];
        this.allPlayers = [];
        if (this.boundDocClick) {
            document.removeEventListener('click', this.boundDocClick);
            this.boundDocClick = null;
        }
        if (this.popup && this.boundPopupClick) {
            this.popup.removeEventListener('click', this.boundPopupClick);
            this.boundPopupClick = null;
        }
        if (this.popup && this.boundPopupWheel) {
            this.popup.removeEventListener('wheel', this.boundPopupWheel);
            this.boundPopupWheel = null;
        }
        this.selectBtn = null;
        this.autoWatchBtn = null;
        this.modeIndicator = null;
        this.popup = null;
        if (this.styleManager) {
            this.styleManager.destroy();
            this.styleManager = null;
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
