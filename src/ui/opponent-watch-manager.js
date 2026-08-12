import { COLORS, SHAPES } from '../core/constants.js';
import { drawPieceSolid, drawPieceStyledUnified } from '../rendering/canvas/canvas-drawing-utils.js';
import { TetrominoStyleManager } from '../rendering/tetromino-style-manager.js';
import { CanvasBoardEffects } from './effects/canvas-board-effects.js';
import { eventBus, EVENTS } from '../events/event-bus.js';

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
        // Phase 1+2: per-opponent CanvasBoardEffects overlay (transient line-clear FLASH +
        // combo). Keyed by the same playerKey as playerBoards. Lives on a separate overlay
        // canvas — never writes the opponent grid, so it cannot fight the snapshot interp.
        this._boardEffects = new Map();
        this.allPlayers = [];
        this.localPlayerId = null;
        this.maxVisible = 4;
        // Current grid layout (cols×rows), kept in sync with the actual CSS grid so
        // _handleResize sizes each mini-canvas to the REAL cell, not a hardcoded 2x2.
        this._gridCols = 2;
        this._gridRows = 2;
        // Spectator "spotlight": a large main-board canvas that renders ONE selected
        // player (a spectator has no board of their own). Driven by the same animation
        // loop + draw code as the mini-boards. spotlightMode makes a mini-board CLICK
        // pick the spotlight player instead of toggling the watch set.
        this.spotlightCanvas = null;
        this.spotlightCtx = null;
        this.spotlightPlayerId = null;
        this.spotlightMode = false;
        this.onSpotlightChange = null;
        this._spotlightSig = null;
        this._spotlightShownId = null;
        this._spotlightHeaderSig = null; // id|frags|alive — fires onChange so the header stays live
        // {garbageMeter, garbageFill, garbageSegments} for the spotlight's pending-garbage bar.
        this._spotlightGarbage = null;
        this._spotlightGarbageSig = null;
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
        this._styleConfigCache = new Map();
        // Dirty-checking hashes - only redraw when state changes
        this._boardHashes = new Map(); // playerId -> board hash
        this._pieceHashes = new Map(); // playerId -> piece signature
        this._lastNextPieces = new Map(); // playerId -> nextPieces signature
        // Smoothness/perf: only repaint a mini-board when its grid/piece/blind actually
        // changed, instead of an unconditional 60–144fps CPU flood-fill per opponent (which
        // competed with the local board + WebGPU theme for main-thread time → micro-stutter).
        // The clear-FLASH overlay self-animates on its OWN canvas, so skipping the grid
        // repaint here never affects it. Toggle OFF: ?opponentDirtyCheck=0.
        this._renderSigs = new Map(); // playerId -> last-rendered signature
        this._opponentDirtyCheck = (() => {
            try {
                const p = new URLSearchParams(window.location.search);
                if (p.get('owmDirtyCheck') === '0') return false;
                if (p.get('opponentDirtyCheck') === '0') return false;
                if (typeof localStorage !== 'undefined') {
                    if (localStorage.getItem('serenity.owmDirtyCheck') === '0') return false;
                    if (localStorage.getItem('serenity.opponentDirtyCheck') === '0') return false;
                }
            } catch (e) { /* default on */ }
            return true;
        })();

        // Issue 3: opponent mini-boards must use the ACTIVE THEME's tetromino palette, the same
        // as every board on screen. The per-board TetrominoStyleManager already re-reads the
        // theme on THEME_CHANGED, but our PERSISTENT _colorCache memoizes pieceType→color and was
        // never invalidated — it shadowed the refresh, so opponent pieces stayed on the previous
        // theme's colors. Clear the color cache (and the render-dirty signatures, so the repaint
        // isn't suppressed) on theme/settings changes so all boards stay in lockstep.
        this._onThemeOrSettingChange = () => {
            this._colorCache.clear();
            this._styleConfigCache.clear();
            this._renderSigs.clear();
            this.styleManager?.refresh?.();
        };
        this._themeUnsub = eventBus.on(EVENTS.THEME_CHANGED, this._onThemeOrSettingChange);
        if (typeof window !== 'undefined') {
            window.addEventListener('settingsChanged', this._onThemeOrSettingChange);
        }

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
     * Count occupied cells in the visible playfield (rows 4..23) — same range as
     * _computeBoardHash. Used to classify a board change as a piece LOCK (small positive
     * delta) vs a garbage insert (large positive) vs a line clear (negative).
     * @private
     */
    _countOccupiedCells(grid) {
        if (!grid) return 0;
        let count = 0;
        for (let row = 4; row < 24; row++) {
            const gridRow = grid[row];
            if (!gridRow) continue;
            for (let col = 0; col < 10; col++) {
                if (gridRow[col]) count++;
            }
        }
        return count;
    }

    /**
     * Compute fast hash for piece state (for dirty-checking).
     *
     * P0-7 (review §2.8): quantize position to WHOLE cells, not tenths. The opponent piece is
     * snapshot-INTERPOLATED, so a tenths-precision hash changed almost every frame — defeating
     * the dirty-check in _animate and forcing a full-board connected-component repaint plus a
     * `getBoundingClientRect` forced-layout (in _renderMiniBoard) for every watched opponent,
     * every frame. The mini-board renders at cell granularity, so sub-cell precision was never
     * visible; whole-cell quantization repaints only on an actual cell/rotation change (≈the
     * event-driven snapshot cadence) while staying visually identical on the mini-board.
     * @private
     */
    _computePieceHash(piece) {
        if (!piece) return 'none';
        const type = piece.type
            || piece.shapeKey
            || piece.id
            || (piece.shape ? piece.shape.map((row) => row.join('')).join('/') : 'unknown');
        const x = Number.isFinite(Number(piece.x)) ? Number(piece.x) : 0;
        const y = Number.isFinite(Number(piece.y)) ? Number(piece.y) : 0;
        const rotation = Number.isFinite(Number(piece.rotation)) ? Number(piece.rotation) : 0;
        return `${type}|${Math.round(x)}|${Math.round(y)}|${rotation}`;
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

        // Calculate available space for a single opponent cell using the ACTUAL grid
        // layout (cols×rows), not a hardcoded 2x2 — otherwise a spectator's wider/taller
        // grid (e.g. 1x2 for two players, 2x4 for eight) sized canvases for the wrong cell,
        // leaving boards cramped with empty space. 4px gap between tracks.
        const cols = this._gridCols || 2;
        const rows = this._gridRows || 2;
        const cellW = (grid.clientWidth - 4 * (cols - 1)) / cols;
        const cellH = (grid.clientHeight - 4 * (rows - 1)) / rows;

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

        // Safety margin: the measured chrome can run a few px short (sub-pixel rounding,
        // flex gaps, the frame border), which let the canvas spill ~6px BELOW its frame →
        // the bottom playfield row got clipped by the frame's overflow:hidden, most visibly
        // with 2 stacked boards that fill the column. Reserve a little headroom so the full
        // board (all 20 rows + floor) always fits inside the frame and the cell.
        const CHROME_SAFETY_PX = 16;
        const maxCanvasHeight = cellH - verticalChrome - CHROME_SAFETY_PX;
        const maxCanvasWidth = cellW - horizontalChrome - garbageMeterWidth;

        // Determine dimensions keeping strictly 1:2 aspect ratio (width:height)
        let canvasW = maxCanvasWidth;
        let canvasH = canvasW * 2;

        // Constrain to available height if needed
        if (canvasH > maxCanvasHeight) {
            canvasH = maxCanvasHeight;
            canvasW = canvasH / 2;
        }

        // Cap opponent board height so multi-opponent layouts don't dwarf the hero/spotlight.
        // COUNT-AWARE (Quadra shows a lone watched board near full size): a single opponent
        // (1v1) is allowed to be LARGE; the cap tightens as the roster grows. For 1 opponent
        // the column width is the real bound (≈ left-column width), so this only guards height.
        const visibleCount = this.watchedPlayers.length || 1;
        let maxOpponentCanvasH;
        if (visibleCount <= 1) {
            // 1v1: prominent but clearly SECONDARY to the hero (the left column width alone
            // would make it ~full-height, which read as too big — bound the height too).
            maxOpponentCanvasH = Math.min(760, window.innerHeight * 0.5);
        } else if (visibleCount <= 2) {
            maxOpponentCanvasH = Math.min(620, window.innerHeight * 0.55);
        } else {
            maxOpponentCanvasH = Math.min(440, window.innerHeight * 0.42);
        }
        if (canvasH > maxOpponentCanvasH) {
            canvasH = maxOpponentCanvasH;
            canvasW = canvasH / 2;
        }

        // Apply sensible minimum bound (min 50px width)
        canvasW = Math.max(50, Math.floor(canvasW));
        canvasH = canvasW * 2;

        grid.style.setProperty('--mini-canvas-width-px', `${canvasW}px`);
        grid.style.setProperty('--mini-canvas-height-px', `${canvasH}px`);
    }

    /**
     * Choose a grid shape (cols×rows) that fits the actual number of visible boards into
     * the panel, instead of a fixed 2x2 (which left 2 spectator boards stranded in the top
     * row of an 8-cell grid). Aspect-aware: a tall/narrow panel grows ROWS (max 2 cols), a
     * short/wide panel (responsive row layout) grows COLS. Sets the grid template inline so
     * _handleResize (which reads _gridCols/_gridRows) sizes each canvas to the real cell.
     */
    _applyGridLayout(count) {
        const n = Math.max(1, count | 0);
        const grid = this.container?.classList?.contains('watch-grid')
            ? this.container
            : this.container?.querySelector?.('.watch-grid');

        let cols;
        let rows;
        if (n === 1) {
            cols = 1; rows = 1;
        } else {
            const w = grid ? grid.clientWidth : 0;
            const h = grid ? grid.clientHeight : 1;
            const wide = w > h * 1.2; // short/wide panel (e.g. responsive horizontal layout)
            if (wide) {
                cols = Math.min(n, 4);
                rows = Math.ceil(n / cols);
            } else {
                // Tall/narrow panel: two boards stack (1 col, bigger), 3+ use 2 cols.
                cols = n <= 2 ? 1 : 2;
                rows = Math.ceil(n / cols);
            }
        }

        this._gridCols = cols;
        this._gridRows = rows;

        if (grid) {
            grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
            grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        }
    }

    _normalizeId(id) {
        if (id === null || id === undefined) return '';
        return String(id);
    }

    _getPlayerId(player) {
        if (!player) return '';
        return this._normalizeId(player.id ?? player.steamId);
    }

    /**
     * Phase 1+2: play a transient staged line-clear FLASH on an OPPONENT's mini-board.
     * `rows` are ABSOLUTE full-board indices (CanvasBoardEffects subtracts HIDDEN_ROWS
     * internally, matching the mini-board's grid draw). No-op for unwatched ids. Never
     * writes the grid — purely an overlay, so it can't fight the snapshot interpolator.
     */
    triggerOpponentClear(playerId, { rows = [], lineCount = rows.length, color = '#ffffff' } = {}) {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        fx.triggerLineClearFlash(rows, lineCount, color);
        fx.triggerLineClearImpact?.(lineCount);
    }

    /**
     * Phase 1+2: show a combo badge on an OPPONENT's mini-board (cascade depth >= 2).
     */
    triggerOpponentCombo(playerId, comboCount, color = '#ffd166') {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        fx.triggerCombo(comboCount, color);
    }

    triggerOpponentPieceLock(playerId, color = '#6ee7b7') {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        fx.triggerPieceLockPulse?.(color);
    }

    _maybeTriggerSettledBoardPulse(playerId, board, state) {
        if (!board || !state?.grid) return;
        const boardHash = this._computeBoardHash(state.grid);
        const cellCount = this._countOccupiedCells(state.grid);
        // First observation for this board: seed the baselines, never pulse on join.
        if (board.settledGridHash === undefined || board.settledGridHash === null) {
            board.settledGridHash = boardHash;
            board.settledCellCount = cellCount;
            return;
        }
        if (boardHash === board.settledGridHash) return;

        const prevCount = Number.isFinite(board.settledCellCount) ? board.settledCellCount : cellCount;
        board.settledGridHash = boardHash;
        board.settledCellCount = cellCount;

        // Only a piece LOCK lands a few new cells (1..4). A garbage insert adds a whole block of
        // rows at once (large positive delta) and already shows its own red garbage flash; a line
        // clear removes cells (delta <= 0) and already shows the clear flash. Skip both so the teal
        // lock-pulse stays a LOCK cue instead of conflating with the dedicated garbage/clear feedback.
        const delta = cellCount - prevCount;
        if (delta < 1 || delta > 4) return;

        const player = this._getPlayerById(playerId);
        const color = state.color || player?.color || '#6ee7b7';
        this.triggerOpponentPieceLock(playerId, color);
    }

    triggerOpponentHardDrop(playerId, dropData = {}, color = '#fbbf24') {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;

        const piece = dropData?.piece || {};
        const shape = piece.shape || [];
        let minX = 0;
        let maxX = 0;
        let found = false;
        shape.forEach((row) => {
            row.forEach((cell, col) => {
                if (!cell) return;
                minX = found ? Math.min(minX, col) : col;
                maxX = found ? Math.max(maxX, col) : col;
                found = true;
            });
        });

        const blockSize = fx.blockSize || (fx.width / 10);
        const pieceX = Number.isFinite(Number(piece.x)) ? Number(piece.x) : 4;
        let landingY = 16;
        if (Number.isFinite(Number(dropData?.endY))) {
            landingY = Number(dropData.endY);
        } else if (Number.isFinite(Number(piece.y))) {
            landingY = Number(piece.y);
        }
        const visualMinX = found ? minX : 0;
        const visualMaxX = found ? maxX : 1;
        const centerX = ((pieceX + visualMinX + ((visualMaxX - visualMinX + 1) / 2)) * blockSize);
        const centerY = ((landingY - 4 + 0.5) * blockSize);
        const burstX = Number.isFinite(centerX) ? centerX : fx.width / 2;
        const burstY = Number.isFinite(centerY) ? centerY : fx.height * 0.7;

        fx.spawnBurstParticles?.(
            Math.max(0, Math.min(fx.width, burstX)),
            Math.max(0, Math.min(fx.height, burstY)),
            fx.isFocused ? 15 : 12,
            220,
            color,
        );
        fx.triggerPieceLockPulse?.(color);
    }

    triggerOpponentGarbage(playerId, color = '#f87171') {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        fx.triggerGarbageFlash?.(color);
    }

    triggerOpponentPerfectClear(playerId, depth = 0, color = '#ffffff') {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        if (fx.triggerPerfectClear) {
            fx.triggerPerfectClear(depth, color);
            return;
        }
        fx.triggerFlash?.(color, 1.2, 600);
        fx.spawnBurstParticles?.(fx.width / 2, fx.height / 2, fx.isFocused ? 48 : 32, 260, '#9ff7ff');
    }

    setOpponentDeadState(playerId, isDead = true) {
        const fx = this._boardEffects.get(this._normalizeId(playerId));
        if (!fx) return;
        fx.setDeadState?.(isDead);
    }

    clearOpponentEffectStates() {
        this._boardEffects.forEach((fx) => {
            fx.clearDeaths?.();
            fx.clearAll?.();
        });
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
        // The cache may hold fallback COLORS[] entries computed before the style manager existed
        // (first paints before themeManager/settingsManager were ready). Drop them so the very
        // first themed paint isn't shadowed by a stale fallback.
        this._colorCache.clear();
        this._styleConfigCache.clear();
        return this.styleManager;
    }

    _getStyleConfig(pieceKey, fallbackColor) {
        const fallback = fallbackColor || COLORS[pieceKey] || '#808080';
        const cacheKey = `${pieceKey || 'unknown'}|${fallback}`;
        if (this._styleConfigCache?.has(cacheKey)) {
            return this._styleConfigCache.get(cacheKey);
        }
        const manager = this._getStyleManager();
        const styleConfig = manager
            ? manager.getStyleForPiece(pieceKey)
            : {
                color: fallback,
                renderMode: 'solid',
                effects: { ...DEFAULT_EFFECTS },
                rendererOverrides: {},
            };
        this._styleConfigCache?.set(cacheKey, styleConfig);
        return styleConfig;
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

    _getPieceFallbackColor(piece, pieceType) {
        let fallbackColor = piece?.color;
        if (typeof fallbackColor === 'string' && COLORS[fallbackColor]) {
            fallbackColor = COLORS[fallbackColor];
        }
        return fallbackColor || COLORS[pieceType] || '#808080';
    }

    _buildPieceStyleConfig(pieceType, fallbackColor, colorCache) {
        const pieceColor = this._getThemedColor(pieceType, fallbackColor, colorCache);
        const baseStyle = this._getStyleConfig(pieceType, pieceColor);
        const styleConfig = {
            ...baseStyle,
            color: pieceColor || baseStyle?.color || fallbackColor || '#808080',
            effects: { ...(baseStyle?.effects || DEFAULT_EFFECTS) },
            rendererOverrides: { ...(baseStyle?.rendererOverrides || {}) },
        };
        const resolvedColor = styleConfig.color;
        if (resolvedColor) {
            if (styleConfig.effects.glowColor) styleConfig.effects.glowColor = resolvedColor;
            if (styleConfig.effects.outlineColor) styleConfig.effects.outlineColor = resolvedColor;
        }
        return styleConfig;
    }

    _getCellId(cell, worldX, worldY) {
        if (!cell) return null;
        if (typeof cell === 'object') {
            const base = cell.id ?? cell.pieceId ?? cell.shapeKey ?? `${worldX}:${worldY}`;
            // Garbage rows from different attackers share shapeKey 'GARBAGE' but differ in color.
            // Fold color into the component key so the flood-fill in _drawCohesiveGrid doesn't
            // merge two differently-coloured garbage regions into one (drawn in a single colour).
            const t = cell.type || cell.shapeKey;
            if ((t === 'GARBAGE' || t === 'CLEAN_GARBAGE') && cell.color) {
                return `${base}:${cell.color}`;
            }
            return base;
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
            if (!(player && board && player.grid)) return;

            if (this._opponentDirtyCheck) {
                // Repaint only when the board/piece/blind actually changed. A blind veil
                // counts down continuously, so fold its (rounded) value into the signature
                // to keep animating it; everything else is event-driven (≈30Hz snapshots),
                // not per-frame. The separate clear-FLASH overlay canvas is unaffected.
                const bt = player.blindTimers;
                const blindSig = bt ? `${Math.round((bt.field || 0) * 5)}:${Math.round((bt.pending || 0) * 5)}` : '';
                const sig = `${this._computeBoardHash(player.grid)}|${this._computePieceHash(player.currentPiece)}|${blindSig}`;
                if (this._renderSigs.get(playerId) === sig) return;
                this._renderSigs.set(playerId, sig);
            }

            this._renderMiniBoard(board.ctx, player.grid, player.currentPiece, player.blindTimers);
        });

        // Spectator main board: render the selected player full-size each frame.
        if (this.spotlightCtx) {
            this._renderSpotlight();
        }
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
    /**
     * Set how many opponent boards to show at once. The base grid is 2x2 (4 cells); a
     * spectator / eliminated player watches the FULL roster, so toggle a `full-roster`
     * class that widens the CSS grid to fit up to 8 — otherwise the 5th–8th boards render
     * clipped off-screen (wasted DOM/canvas). Re-runs auto-select so the change takes effect.
     */
    setMaxVisible(n) {
        this.maxVisible = n;
        // Keep the legacy class for any auxiliary styling; the actual grid shape is now
        // driven inline by _applyGridLayout (from the live board count) in updateDisplay.
        this.container?.classList?.toggle('full-roster', n > 4);
        this.autoSelectOpponents({ preserveCurrent: false });
    }

    /**
     * Register a large "spotlight" canvas (the spectator's main board). Once set, a mini-board
     * CLICK selects the spotlight player instead of toggling the watch set, and the chosen
     * player's board is rendered full-size on this canvas by the animation loop.
     * @param {HTMLCanvasElement} canvasEl
     * @param {{ onChange?: (player) => void, garbage?: {meter:HTMLElement, fill:HTMLElement, segments:HTMLElement} }} [opts]
     *   onChange fires when the spotlight player changes; garbage wires the spotlight's pending-garbage meter.
     */
    setSpotlight(canvasEl, { onChange, garbage } = {}) {
        if (!canvasEl) return;
        this.spotlightCanvas = canvasEl;
        this.spotlightCtx = canvasEl.getContext('2d');
        this.spotlightMode = true;
        if (onChange) this.onSpotlightChange = onChange;
        // Adapt the passed garbage elements to the {garbageMeter, garbageFill, garbageSegments}
        // shape _updateGarbageMeter reads (the same path the mini-boards use).
        this._spotlightGarbage = garbage && garbage.fill
            ? { garbageMeter: garbage.meter, garbageFill: garbage.fill, garbageSegments: garbage.segments }
            : null;
        this._spotlightGarbageSig = null;
        this._spotlightSig = null;
        this._spotlightShownId = null;
        this._spotlightHeaderSig = null;
    }

    /**
     * Choose which player the spotlight (main board) shows. Sticky: an explicit pick is kept
     * even after that player is eliminated (a spectator may want to watch their elimination).
     */
    setSpotlightPlayer(playerId) {
        const id = this._normalizeId(playerId);
        if (!id) return;
        this.spotlightPlayerId = id;
        this._spotlightSig = null; // force a repaint
        const player = this._getPlayerById(id);
        if (player) {
            this._spotlightShownId = id;
            this._spotlightHeaderSig = `${id}|${player.frags || 0}|${player.isAlive !== false ? 1 : 0}`;
            this._highlightSpotlightBoard(id);
            if (typeof this.onSpotlightChange === 'function') {
                try { this.onSpotlightChange(player); } catch (e) { /* label update is non-essential */ }
            }
        }
    }

    /** The player object the spotlight should currently show (explicit pick, else a default). */
    _resolveSpotlightPlayer() {
        if (this.spotlightPlayerId) {
            const picked = this._getPlayerById(this.spotlightPlayerId);
            if (picked) return picked;
        }
        // Default: a watched, alive player; else any watched; else any player.
        const watched = this.watchedPlayers.map((id) => this._getPlayerById(id)).filter(Boolean);
        return watched.find((p) => p.isAlive !== false) || watched[0] || this.allPlayers[0] || null;
    }

    _highlightSpotlightBoard(pid) {
        this.playerBoards.forEach((board, id) => {
            const el = board.element;
            if (!el) return;
            const on = (id === pid);
            el.classList.toggle('spotlighted', on);
            if (on) {
                // The selection highlight (outline + glow) uses the SELECTED player's colour.
                const color = this._getPlayerById(id)?.color || '#5eead4';
                el.style.setProperty('--spotlight-color', color);
            } else {
                el.style.removeProperty('--spotlight-color');
            }
        });
    }

    /**
     * Size the spotlight canvas to the largest 1:2 board that fits its stage, as EXPLICIT
     * inline px. We don't use CSS aspect-ratio + height:100% because the flex cross-axis
     * stretch (wide column) + _renderMiniBoard's getBoundingClientRect feedback drove a
     * runaway height (canvas sized by width → 2× tall → overflow). availH is bounded by the
     * viewport so a transient inflated layout can't blow it up.
     */
    _resizeSpotlight() {
        const canvas = this.spotlightCanvas;
        // The canvas now sits inside a board-row (garbage bar + canvas), so measure the STAGE
        // by class, not parentElement (which is the row), for the height/runaway-safe sizing.
        const stage = canvas?.closest('.spectator-spotlight-stage') || canvas?.parentElement;
        if (!canvas || !stage) return;
        // Measure WIDTH from the stable center column (.main-board-panel — a fixed grid track,
        // its width is layout-driven not content-driven) and HEIGHT from the stage (flex:1, it
        // already excludes the header/hint). We must NOT take width from the stage: we shrink the
        // card to hug the board below, which shrinks the stage, which would feed back into a
        // stage-based width measurement (the documented spotlight runaway). The column is constant.
        const panel = canvas.closest('.main-board-panel');
        const card = document.getElementById('online-player-card');
        const fullW = panel ? panel.clientWidth : stage.clientWidth;
        // Reserve room for the pending-garbage bar (20px) + its gap (6px) beside the board so
        // the board + bar together fit the column instead of overflowing it.
        const garbageCol = this._spotlightGarbage ? 26 : 0;
        const availW = fullW - garbageCol;
        const vh = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : (stage.clientHeight || 0);
        const availH = Math.min(stage.clientHeight || 0, vh);
        if (availW <= 0 || availH <= 0) return;
        let w = Math.min(availW, Math.floor(availH / 2));
        w = Math.max(40, w);
        const h = w * 2;
        // Match the garbage bar's height to the board so it reads like the main board's meter.
        if (this._spotlightGarbage?.garbageMeter && this._spotlightGarbage.garbageMeter.style.height !== `${h}px`) {
            this._spotlightGarbage.garbageMeter.style.height = `${h}px`;
        }
        // Use !important: a global `.phaser-board-container canvas { width:100% !important }`
        // rule (main.css) would otherwise force the canvas to fill the stage (→ wrong aspect
        // + a getBoundingClientRect feedback blowup). Our explicit 1:2 size must win.
        if (canvas.style.width !== `${w}px` || canvas.style.height !== `${h}px`) {
            canvas.style.setProperty('width', `${w}px`, 'important');
            canvas.style.setProperty('height', `${h}px`, 'important');
        }
        // Hug the board: shrink the card toward the board width (it's centered by the panel's
        // justify-content) so there are no wide transparent side-gaps showing the theme through
        // the frame. +40 ≈ the host/peer board↔frame margin; clamped so it never exceeds the column.
        if (card) {
            const cardW = `${Math.min(w + 40 + garbageCol, fullW)}px`;
            if (card.style.width !== cardW) card.style.width = cardW;
        }
    }

    /** Render the spotlight player's board onto the large main-board canvas. */
    _renderSpotlight() {
        if (!this.spotlightCtx) return;
        this._resizeSpotlight();
        const player = this._resolveSpotlightPlayer();
        if (!player) return;

        const pid = this._getPlayerId(player);
        if (pid !== this._spotlightShownId) {
            this._spotlightShownId = pid;
            this._spotlightSig = null;
            this._highlightSpotlightBoard(pid);
        }
        // Fire onChange on player switch AND when the header values (frags/alive) change, so
        // the big header stays live while the same player is spotlighted (not frozen at pick).
        const headerSig = `${pid}|${player.frags || 0}|${player.isAlive !== false ? 1 : 0}`;
        if (headerSig !== this._spotlightHeaderSig) {
            this._spotlightHeaderSig = headerSig;
            if (typeof this.onSpotlightChange === 'function') {
                try { this.onSpotlightChange(player); } catch (e) { /* non-essential */ }
            }
        }

        // Pending-garbage meter (mirrors the main board's bar) — updated before the board
        // dirty-check so it stays live even when the board itself hasn't changed this frame.
        this._updateSpotlightGarbage(player);

        if (!player.grid) return;

        if (this._opponentDirtyCheck) {
            const bt = player.blindTimers;
            const blindSig = bt ? `${Math.round((bt.field || 0) * 5)}:${Math.round((bt.pending || 0) * 5)}` : '';
            const sig = `${this._computeBoardHash(player.grid)}|${this._computePieceHash(player.currentPiece)}|${blindSig}`;
            if (this._spotlightSig === sig) return;
            this._spotlightSig = sig;
        }

        this._renderMiniBoard(this.spotlightCtx, player.grid, player.currentPiece, player.blindTimers);
    }

    /**
     * Drive the spotlight's pending-garbage bar from the watched player. Reuses the same
     * _updateGarbageMeter path as the mini-boards, but only repaints when the amount/queue
     * actually changes (the meter is checked every RAF, so a per-frame innerHTML rebuild of the
     * segments would be wasteful).
     */
    _updateSpotlightGarbage(player) {
        const g = this._spotlightGarbage;
        if (!g || !g.garbageFill || !player) return;
        const q = player.garbageQueue;
        const amount = (q && typeof q.getTotalLines === 'function')
            ? q.getTotalLines()
            : Number(player.garbagePending ?? player.pendingGarbage ?? 0);
        const sig = `${this._getPlayerId(player)}|${amount}|${q?.entries?.length || 0}`;
        if (sig === this._spotlightGarbageSig) return;
        this._spotlightGarbageSig = sig;
        this._updateGarbageMeter(g, player);
    }

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

        // Phase 1+2: dispose per-opponent clear-effect overlays before tearing down the
        // boards (removes their overlay canvas/textLayer + stops their idle-gated RAF).
        this._boardEffects.forEach((fx) => { try { fx.destroy(); } catch (e) { /* noop */ } });
        this._boardEffects.clear();

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
                playerKey,
                canvas,
                ctx: canvas.getContext('2d'),
                nextCtxs: nextCanvases.map((c) => c.getContext('2d')),
                garbageMeter,
                garbageFill,
                garbageSegments,
                frame: boardFrame,
                isEliminated: player.isAlive === false,
                deathAnimationActive: false,
                settledGridHash: player.grid ? this._computeBoardHash(player.grid) : null,
                settledCellCount: player.grid ? this._countOccupiedCells(player.grid) : null,
                name: player.name,
                element: boardEl,
            });

            // Phase 1+2: attach a transient clear-FLASH/combo overlay to this opponent's
            // frame. It paints on its OWN overlay canvas (z-12) over the mini-board and
            // never writes player.grid, so the snapshot/interp path keeps owning the grid.
            if (boardFrame) {
                try {
                    const fxW = canvas.width || canvas.clientWidth || 80;
                    const fxH = canvas.height || canvas.clientHeight || 160;
                    this._boardEffects.set(playerKey, new CanvasBoardEffects(boardFrame, {
                        width: fxW,
                        height: fxH,
                        blockSize: fxW / 10,
                        baseCanvas: canvas,
                    }));
                } catch (e) {
                    // Effects are non-essential — never let them break the board render.
                }
            }

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

        // Shape the grid to the actual number of boards, then recalculate canvas sizes now
        // that boards are in the DOM (dynamic chrome measurement needs rendered elements).
        this._applyGridLayout(this.watchedPlayers.length);
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
        // A late joiner waiting to spawn is isAlive:false but NOT eliminated — start in the
        // "waiting" state (the next updateFromState attaches the ⏳ overlay), not "dead".
        const startWaiting = player.awaitingSpawn === true;
        const startDead = player.isAlive === false && !startWaiting;
        div.className = `opponent-mini-board ${startDead ? 'dead' : ''} ${startWaiting ? 'waiting' : ''}`.trim();
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

        // Click: in spectator spotlight mode, promote this board to the main view; otherwise
        // toggle whether it's in the watch set.
        div.onclick = () => {
            if (this.spotlightMode) {
                this.setSpotlightPlayer(playerId);
            } else {
                this.toggleWatch(playerId);
            }
        };

        // Reflect current spotlight selection on freshly (re)built boards (in the player's colour).
        if (this.spotlightMode && this._spotlightShownId === playerId) {
            div.classList.add('spotlighted');
            div.style.setProperty('--spotlight-color', player.color || '#5eead4');
        }

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
                this._maybeTriggerSettledBoardPulse(stateId, board, state);

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

                // Update alive status. A late joiner WAITING to spawn next round is isAlive:false
                // but NOT eliminated — show a distinct "next round" overlay, NEVER the skull.
                const isWaiting = state.awaitingSpawn === true;
                const isDead = state.isAlive === false && !isWaiting;
                const wasDead = board.isEliminated === true;

                // Waiting overlay (idempotent). Switching to waiting clears any stale death overlay.
                if (isWaiting && !board.isWaiting) {
                    board.isWaiting = true;
                    if (wasDead) { board.isEliminated = false; this._clearOpponentDeathState(board); }
                    this.setOpponentDeadState(stateId, false);
                    board.element.classList.remove('dead');
                    board.element.classList.add('waiting');
                    this._showOpponentWaitingOverlay(board);
                } else if (!isWaiting && board.isWaiting) {
                    board.isWaiting = false;
                    board.element.classList.remove('waiting');
                    this._clearOpponentWaitingOverlay(board);
                }

                if (!isWaiting) {
                    if (isDead && !wasDead) {
                        board.isEliminated = true;
                        board.element.classList.add('dead');
                        this.setOpponentDeadState(stateId, true);
                        this._showOpponentDeathAnimation(board);
                    } else if (!isDead && wasDead) {
                        board.isEliminated = false;
                        board.element.classList.remove('dead');
                        this.setOpponentDeadState(stateId, false);
                        this._clearOpponentDeathState(board);
                    } else if (isDead) {
                        board.element.classList.add('dead');
                        this.setOpponentDeadState(stateId, true);
                        this._ensureOpponentDeathOverlay(board);
                    } else {
                        board.element.classList.remove('dead');
                        this.setOpponentDeadState(stateId, false);
                    }
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

    // Late joiner waiting to spawn next round — NOT eliminated. Distinct teal "next round"
    // overlay (⏳), never the skull/ELIMINATED.
    _showOpponentWaitingOverlay(board) {
        if (!board) return;
        const container = board.frame || board.element;
        if (!container || container.querySelector('.waiting-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'waiting-overlay';
        overlay.innerHTML = `
            <div class="waiting-content">
                <div class="waiting-icon">⏳</div>
                <div class="waiting-text">NEXT ROUND</div>
            </div>
        `;
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(8, 10, 23, 0.55);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 95;
            pointer-events: none;
            border-radius: inherit;
        `;

        const content = overlay.querySelector('.waiting-content');
        content.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 8px;';

        const icon = overlay.querySelector('.waiting-icon');
        icon.style.cssText = `
            font-size: 38px;
            filter: drop-shadow(0 0 12px rgba(94, 234, 212, 0.5));
            animation: opp-waiting-pulse 1.8s ease-in-out infinite;
        `;

        const text = overlay.querySelector('.waiting-text');
        text.style.cssText = `
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 1px;
            color: #5eead4;
            text-shadow: 0 0 14px rgba(94, 234, 212, 0.45);
        `;

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        container.appendChild(overlay);
    }

    _clearOpponentWaitingOverlay(board) {
        const container = board?.frame || board?.element;
        if (!container) return;
        const overlay = container.querySelector('.waiting-overlay');
        if (overlay) overlay.remove();
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
        if (board?.playerKey) {
            this.setOpponentDeadState(board.playerKey, false);
        }

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
            const isDead = state.isAlive === false && state.awaitingSpawn !== true;
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
            // Phase 1+2: keep this opponent's clear-FLASH overlay matched to the resized
            // mini canvas so the row stripes line up (match by baseCanvas).
            if (this._boardEffects && this._boardEffects.size) {
                this._boardEffects.forEach((fx) => {
                    if (fx.baseCanvas === canvas) fx.resize(displayWidth, displayHeight, displayWidth / 10);
                });
            }
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
                    const hasGarbage = gridRow.some((cell) => {
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
                this._drawGhostPiece(ctx, currentPiece, ghostY, blockSize, this._colorCache);
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

    _drawGhostPiece(ctx, piece, pieceY, blockSize, colorCache = this._colorCache) {
        const { shape } = piece;
        if (!shape) return;

        const pieceType = piece.type || piece.shapeKey;
        const fallbackColor = this._getPieceFallbackColor(piece, pieceType);
        const styleConfig = this._buildPieceStyleConfig(pieceType, fallbackColor, colorCache);
        const offsetX = piece.x * blockSize;
        const offsetY = (Math.floor(pieceY) - 4) * blockSize;
        drawPieceStyledUnified(ctx, shape, offsetX, offsetY, blockSize, styleConfig, true, 1.0);
    }

    _drawCurrentPiece(ctx, piece, blockSize, colorCache) {
        const { shape } = piece;
        if (!shape) return;

        const pieceType = piece.type || piece.shapeKey;
        const fallbackColor = this._getPieceFallbackColor(piece, pieceType);
        const styleConfig = this._buildPieceStyleConfig(pieceType, fallbackColor, colorCache);

        const offsetX = piece.x * blockSize;
        const offsetY = (piece.y - 4) * blockSize;

        drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig);
    }

    _calculateGhostY(piece, grid) {
        let ghostY = Math.floor(Number(piece.y) || 0);
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

        if (this._themeUnsub) {
            try { this._themeUnsub(); } catch (e) { /* noop */ }
            this._themeUnsub = null;
        }
        if (this._onThemeOrSettingChange && typeof window !== 'undefined') {
            window.removeEventListener('settingsChanged', this._onThemeOrSettingChange);
            this._onThemeOrSettingChange = null;
        }

        if (this.boundResize) {
            window.removeEventListener('resize', this.boundResize);
            this.boundResize = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this._boardEffects.forEach((fx) => { try { fx.destroy(); } catch (e) { /* noop */ } });
        this._boardEffects.clear();
        this.playerBoards.clear();
        this.watchedPlayers = [];
        this.allPlayers = [];
        this.spotlightCanvas = null;
        this.spotlightCtx = null;
        this.spotlightPlayerId = null;
        this.spotlightMode = false;
        this.onSpotlightChange = null;
        this._spotlightGarbage = null;
        this._spotlightGarbageSig = null;
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

/**
 * Wire the spectator's main-board spotlight DOM to a watch manager: the manager
 * renders the selected player full-size onto the spotlight canvas and reports
 * name/frags changes back here for the header + card framing.
 * No-op when the spotlight markup isn't mounted.
 * @param {OpponentWatchManager} watchManager
 * @param {{ getPlayerColor?: (id: string) => string|undefined }} [hooks]
 *   getPlayerColor resolves a roster id to its assigned colour (fallback tint).
 */
export function wireSpectatorSpotlight(watchManager, { getPlayerColor } = {}) {
    const spotlightCanvas = document.querySelector('#online-main-board .spectator-spotlight-canvas');
    if (!spotlightCanvas) return;
    const nameEl = document.querySelector('#online-main-board .spectator-spotlight-name');
    const fragsEl = document.querySelector('#online-main-board .spectator-spotlight-frags');
    const eyeEl = document.querySelector('#online-main-board .spectator-spotlight-eye');
    // The player card frames the whole center column. Host/peer tint it to their OWN
    // colour (_processRenderFrame ~1841); a spectator has no local player so it kept the
    // default BLUE — the other half of the "purple+blue border" the user reported. Tint
    // it to the SPOTLIGHTED player's colour to match the host/peer look.
    const playerCardEl = document.getElementById('online-player-card');
    // Pending-garbage meter for the spotlight — mirrors the main board's vertical
    // bar so the watched board reads like a real player board (the watcher missed it).
    const spotlightGarbage = document.querySelector('#online-main-board .spectator-spotlight-garbage');
    watchManager.setSpotlight(spotlightCanvas, {
        garbage: spotlightGarbage ? {
            meter: spotlightGarbage,
            fill: spotlightGarbage.querySelector('.garbage-fill'),
            segments: spotlightGarbage.querySelector('.garbage-segments'),
        } : null,
        onChange: (player) => {
            if (nameEl) nameEl.textContent = player?.name || 'SPECTATING';
            if (fragsEl) fragsEl.textContent = player ? `⚔️ ${player.frags || 0}` : '';
            // Tint the spotlight CANVAS to the SELECTED player's colour so the watched
            // board's frame reflects who you're watching. The purple #online-board-border
            // overlay is hidden under .spectating, so the canvas border+glow is the single
            // clean frame around the board (matching the host/peer board).
            const color = player?.color || (player?.id && getPlayerColor?.(player.id)) || '#5eead4';
            if (nameEl) nameEl.style.color = color;
            if (eyeEl) eyeEl.style.color = color;
            spotlightCanvas.style.borderColor = color;
            spotlightCanvas.style.boxShadow = `0 0 22px ${color}55, inset 0 0 14px ${color}22`;
            // Match host/peer card framing (see _processRenderFrame): coloured border +
            // glow + faint gradient — so the whole center frame reflects the watched player.
            if (playerCardEl) {
                playerCardEl.style.borderColor = `${color}cc`;
                playerCardEl.style.borderWidth = '3px';
                playerCardEl.style.boxShadow = `0 0 30px ${color}66, inset 0 0 20px ${color}1a`;
                playerCardEl.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.5), ${color}0d)`;
            }
        },
    });
}
