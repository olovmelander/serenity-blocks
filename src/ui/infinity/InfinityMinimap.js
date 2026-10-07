/**
 * @fileoverview The tower map — Infinity's minimap (InfinityMode, and each board in local
 * versus Last Standing).
 *
 * A miniature of the build itself: every cell of the stack in its own colour and
 * square (never squeezed or stretched to fill the box), from the floor to a little
 * above the summit. A young tower is drawn as wide as the map, with sky above it; as
 * it grows the map zooms out and the tower narrows, centred, keeping its true shape.
 * The rows the board shows are framed, the summit is marked, and a slim rail along
 * the side tracks the climb toward the ceiling with its milestones. Drag (or touch) the
 * map to look around the tower: the mode pauses and moves its camera
 * ('minimap-exploration-start', 'minimap-jump', 'minimap-exploration-end').
 *
 * It redraws only when the board, the camera or its own size changes; the build is
 * kept as a one-pixel-per-cell image that is redrawn only when the board does. While
 * the camera is above the ground it marks its host `data-off-floor`, and the well
 * drops its floor.
 * Styles: public/styles/keystone-solo.css.
 */

import { calculateTopRow } from '../../core/infinity-grid.js';

/** Rows shown above the summit, as a share of the build (at least MIN_HEADROOM). */
const HEADROOM = 0.35;
const MIN_HEADROOM = 12;
/** The fewest rows the map ever shows, so a young tower is not drawn huge. */
const MIN_SPAN = 40;
/** The span moves in steps of this many rows, so the map does not breathe every lock. */
const SPAN_STEP = 10;
/** Milestones along the rail, as shares of the ceiling. */
const MILESTONES = [0.1, 0.25, 0.5, 0.75, 1];
const SLATE = [74, 80, 104];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** '#rrggbb', '#rgb', 'rgb(r, g, b)' or a number → [r, g, b]. */
function parseColor(value) {
    if (typeof value === 'number') return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    const text = String(value || '').trim();
    let match = /^#([0-9a-f]{6})$/i.exec(text);
    if (match) {
        const int = parseInt(match[1], 16);
        return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
    }
    match = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (match) return match.slice(1).map((h) => parseInt(h + h, 16));
    match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(text);
    if (match) return match.slice(1, 4).map(Number);
    return [200, 200, 220];
}

export class InfinityMinimap {
    /**
     * @param {Object} [options]
     * @param {HTMLElement} [options.container] where the map lives (default
     *   #single-player-container)
     * @param {string} [options.id] its element id (default 'infinity-minimap')
     * @param {number} [options.maxRows] the ceiling when the state has none (default 1000)
     * @param {number} [options.width] initial canvas size, until it is measured
     * @param {number} [options.height]
     */
    constructor(options = {}) {
        this.options = {
            container: options.container || null,
            id: options.id || null,
            maxRows: options.maxRows || 1000,
            width: options.width || 96,
            height: options.height || 420,
        };
        this.canvas = null;
        this.ctx = null;
        this.container = null;
        this.gameState = null;
        this.cameraRow = 0;
        this.visibleRows = 20;

        // Exploration (drag to look around the tower).
        this.isDragging = false;
        this.isExploring = false;
        this.dragStartY = null;

        // What was last drawn, and the build image (one pixel per cell).
        this._drawn = null;
        this._build = null;
        this._colors = new Map();
        this._viewport = null;

        // ~60 Hz at most; most frames change nothing and are skipped entirely.
        this.lastUpdateTime = 0;
        this.updateInterval = 16;

        this.handlePointerDown = this._onPointerDown.bind(this);
        this.handleWindowPointerMove = this._onWindowPointerMove.bind(this);
        this.handleWindowPointerUp = this._onWindowPointerUp.bind(this);

        this._initialize();
    }

    /** @private */
    _initialize() {
        this.container = document.createElement('div');
        if (this.options.id) {
            this.container.id = this.options.id;
        } else if (!this.options.container) {
            this.container.id = 'infinity-minimap';
        }
        this.container.className = 'infinity-minimap';
        this.container.style.display = 'none';

        const title = document.createElement('div');
        title.className = 'minimap-title';
        title.textContent = 'Tower';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'minimap-canvas';
        this.canvas.width = this.options.width;
        this.canvas.height = this.options.height;
        this.canvas.setAttribute('role', 'img');
        this.canvas.setAttribute('aria-label', 'The tower: the build, the rows on screen and the summit');
        this.ctx = this.canvas.getContext('2d');

        this.instructionLabel = document.createElement('div');
        this.instructionLabel.className = 'minimap-instruction';
        this.instructionLabel.textContent = 'Drag to look';

        this.container.append(title, this.canvas, this.instructionLabel);
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    }

    /** Shows the map in its host and draws the latest state. */
    show() {
        const host = this.options.container || document.getElementById('single-player-container');
        if (host && this.container.parentElement !== host) host.appendChild(this.container);
        this.container.style.display = '';
        this._drawn = null;
        this.render();
    }

    hide() {
        this.container.classList.remove('is-explorable');
        this.container.style.display = 'none';
    }

    /** Paused: the map can be dragged to look around the tower. */
    onPause() {
        this.container.classList.add('is-explorable');
    }

    onUnpause() {
        this.container.classList.remove('is-explorable');
    }

    /**
     * The latest state and camera; redraws only what changed.
     * @param {Object} gameState
     * @param {number} cameraRow the top row of the board's view
     * @param {number} visibleRows
     */
    update(gameState, cameraRow, visibleRows) {
        if (!gameState) return;
        this.gameState = gameState;
        this.cameraRow = cameraRow;
        this.visibleRows = visibleRows;
        // Keep the latest state for showing again, but skip the work while hidden.
        if (this.container.style.display === 'none') return;
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) return;
        this.lastUpdateTime = now;
        this.render();
    }

    /** The board's rows (top row first). */
    _board() {
        return this.gameState?.board || this.gameState?.boardGrid || null;
    }

    /** The summit's row; an empty board has none (rowsTotal), where the shared helper
        reports the bottom row. */
    _topRow(board) {
        const top = calculateTopRow(this.gameState);
        return top === board.length - 1 && !board[top]?.some(Boolean) ? board.length : top;
    }

    _maxRows() {
        const stateMax = Number(this.gameState?.maxRows);
        if (Number.isFinite(stateMax) && stateMax > 0) return stateMax;
        return this.options.maxRows;
    }

    /** Matches the canvas's backing store to its laid-out size (only when the window changed). */
    _fitCanvas() {
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const key = typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}@${dpr}` : '';
        if (this._fitKey === key) return;
        this._fitKey = key;
        const width = Math.round((this.canvas.clientWidth || 0) * dpr);
        const height = Math.round((this.canvas.clientHeight || 0) * dpr);
        if (width > 0 && height > 0 && (this.canvas.width !== width || this.canvas.height !== height)) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    /**
     * Rows the map must show, from the floor up: the build and some sky, in steps, and
     * always the rows on screen.
     */
    _neededSpan(rowsTotal, topRow) {
        const build = Math.max(0, rowsTotal - topRow);
        const wanted = build + Math.max(MIN_HEADROOM, Math.ceil(build * HEADROOM));
        const stepped = Math.ceil(Math.max(MIN_SPAN, wanted, rowsTotal - this.cameraRow) / SPAN_STEP) * SPAN_STEP;
        return clamp(stepped, 1, rowsTotal);
    }

    /**
     * Geometry in canvas pixels: the rail on the left, the tower beside it. Cells are
     * square: as wide as the tower allows, smaller when the rows needed would not fit,
     * and the rows shown fill the height (more sky when there is room).
     */
    _layout(rowsTotal, topRow) {
        const { width, height } = this.canvas;
        const rail = Math.max(3, Math.round(width * 0.07));
        const gap = Math.max(2, Math.round(width * 0.06));
        const towerX = rail + gap;
        const towerW = Math.max(1, width - towerX);
        const cols = this._board()?.[0]?.length || 10;
        const needed = this._neededSpan(rowsTotal, topRow);
        let cell = Math.min(towerW / cols, height / needed);
        // Whole pixels once cells are big enough to show it.
        if (cell >= 2) cell = Math.floor(cell);
        const span = clamp(Math.max(needed, Math.floor(height / cell)), 1, rowsTotal);
        const drawW = cols * cell;
        const drawH = span * cell;
        return {
            width,
            height,
            rail,
            cols,
            cell,
            span,
            x0: towerX + Math.floor((towerW - drawW) / 2),
            y0: height - drawH,
            drawW,
            drawH,
        };
    }

    /** Draws the map if anything it shows has changed. */
    render() {
        const board = this._board();
        if (!board || !this.ctx) return;
        this._fitCanvas();
        const rowsTotal = board.length;
        if (!rowsTotal) return;
        // Above the ground the well has no floor: its host drops it (keystone-solo/-versus.css).
        const offFloor = this.cameraRow + this.visibleRows < rowsTotal - 0.5;
        const host = this.container.parentElement;
        if (host && this._offFloor !== offFloor) {
            this._offFloor = offFloor;
            host.toggleAttribute?.('data-off-floor', offFloor);
        }
        const version = this.gameState.boardVersion;
        const buildStale = !this._build || this._build.board !== board || this._build.rows !== rowsTotal
            || version === undefined || this._build.version !== version;
        const topRow = buildStale ? this._topRow(board) : this._build.topRow;
        const geometry = this._layout(rowsTotal, topRow);
        const maxRows = this._maxRows();
        const drawn = this._drawn;
        if (!buildStale && drawn && drawn.cameraRow === this.cameraRow && drawn.visibleRows === this.visibleRows
            && drawn.width === geometry.width && drawn.height === geometry.height && drawn.maxRows === maxRows) return;
        if (buildStale || this._build.span !== geometry.span) {
            this._paintBuild(board, rowsTotal, topRow, geometry.span, version);
        }
        this._draw(geometry, rowsTotal, topRow, maxRows);
        this._drawn = {
            cameraRow: this.cameraRow,
            visibleRows: this.visibleRows,
            width: geometry.width,
            height: geometry.height,
            maxRows,
        };
    }

    _colorOf(cell) {
        if (cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE') return SLATE;
        const key = cell.color;
        let rgb = this._colors.get(key);
        if (!rgb) {
            rgb = parseColor(key);
            this._colors.set(key, rgb);
        }
        return rgb;
    }

    /** The build as a 10 × span image, one pixel per cell (the floor at the bottom). */
    _paintBuild(board, rowsTotal, topRow, span, version) {
        const cols = board[0]?.length || 10;
        if (!this._build || this._build.cols !== cols || this._build.span !== span) {
            const canvas = document.createElement('canvas');
            canvas.width = cols;
            canvas.height = span;
            const ctx = canvas.getContext('2d');
            this._build = {
                canvas, ctx, cols, span, image: ctx.createImageData(cols, span),
            };
        }
        const { image } = this._build;
        const { data } = image;
        data.fill(0);
        const firstRow = rowsTotal - span;
        for (let y = Math.max(topRow, firstRow); y < rowsTotal; y++) {
            const row = board[y];
            if (!row) continue;
            const base = (y - firstRow) * cols * 4;
            for (let x = 0; x < cols; x++) {
                const cell = row[x];
                if (!cell) continue;
                const [r, g, b] = this._colorOf(cell);
                const i = base + x * 4;
                data[i] = r;
                data[i + 1] = g;
                data[i + 2] = b;
                data[i + 3] = 255;
            }
        }
        this._build.ctx.putImageData(image, 0, 0);
        Object.assign(this._build, {
            board, rows: rowsTotal, version, topRow,
        });
    }

    _draw(geometry, rowsTotal, topRow, maxRows) {
        const { ctx } = this;
        const {
            width, height, rail, cols, cell, span, x0, y0, drawW, drawH,
        } = geometry;
        const firstRow = rowsTotal - span;
        const yOf = (row) => y0 + (row - firstRow) * cell;
        ctx.clearRect(0, 0, width, height);

        // The tower: the build, one square block per cell (blended only when a cell is
        // smaller than a pixel, so no row is dropped).
        ctx.imageSmoothingEnabled = cell < 1;
        ctx.drawImage(this._build.canvas, 0, 0, cols, span, x0, y0, drawW, drawH);

        // The rows on screen: the rest of the tower, and the sky above it, recede; the
        // view is framed.
        const viewTop = clamp(yOf(this.cameraRow), y0, height);
        const viewBottom = clamp(yOf(this.cameraRow + this.visibleRows), y0, height);
        ctx.fillStyle = 'rgba(6, 5, 16, 0.5)';
        ctx.fillRect(x0, 0, drawW, viewTop);
        ctx.fillRect(x0, viewBottom, drawW, height - viewBottom);
        const line = Math.max(1, Math.round(height / 360));
        ctx.strokeStyle = 'rgba(255, 246, 233, 0.85)';
        ctx.lineWidth = line;
        const frameH = Math.max(line, viewBottom - viewTop - line);
        ctx.strokeRect(x0 + line / 2, viewTop + line / 2, drawW - line, frameH);
        this._viewport = { top: viewTop, bottom: viewBottom };

        // The summit, in gold.
        if (topRow < rowsTotal) {
            ctx.fillStyle = 'rgba(255, 209, 128, 0.95)';
            ctx.fillRect(x0, Math.max(y0, yOf(topRow) - line), drawW, line);
        }

        // The rail: the climb toward the ceiling, with its milestones.
        const build = Math.max(0, rowsTotal - topRow);
        const climbed = clamp(build / maxRows, 0, 1);
        ctx.fillStyle = 'rgba(255, 246, 233, 0.1)';
        ctx.fillRect(0, 0, rail, height);
        const fill = ctx.createLinearGradient(0, height, 0, 0);
        fill.addColorStop(0, '#7ee3d1');
        fill.addColorStop(1, '#ffd180');
        ctx.fillStyle = fill;
        ctx.fillRect(0, height * (1 - climbed), rail, height * climbed);
        MILESTONES.forEach((share) => {
            const y = Math.round(height * (1 - share));
            ctx.fillStyle = share <= climbed ? 'rgba(255, 209, 128, 0.95)' : 'rgba(255, 246, 233, 0.35)';
            ctx.fillRect(0, Math.min(height - line, y), rail + Math.max(2, Math.round(rail * 0.6)), line);
        });
    }

    /** @private */
    _onPointerDown(event) {
        event.preventDefault();
        this.isDragging = true;
        this.isExploring = true;
        this.dragStartY = event.clientY;
        this.container.dispatchEvent(new CustomEvent('minimap-exploration-start', { bubbles: true }));
        this._dispatchJump(event);
        window.addEventListener('pointermove', this.handleWindowPointerMove);
        window.addEventListener('pointerup', this.handleWindowPointerUp);
        window.addEventListener('pointercancel', this.handleWindowPointerUp);
    }

    /** @private */
    _onWindowPointerMove(event) {
        if (this.isDragging && this.isExploring) this._dispatchJump(event);
    }

    /** @private */
    _onWindowPointerUp() {
        if (this.isExploring) {
            this.container.dispatchEvent(new CustomEvent('minimap-exploration-end', { bubbles: true }));
        }
        this.isDragging = false;
        this.isExploring = false;
        this.dragStartY = null;
        this._removeWindowListeners();
    }

    _removeWindowListeners() {
        window.removeEventListener('pointermove', this.handleWindowPointerMove);
        window.removeEventListener('pointerup', this.handleWindowPointerUp);
        window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    }

    /** @private */
    _dispatchJump(event) {
        const rect = this.canvas.getBoundingClientRect();
        const targetRow = this._getRowFromY(event.clientY - rect.top, rect.height);
        this.container.dispatchEvent(new CustomEvent('minimap-jump', {
            detail: { targetRow },
            bubbles: true,
        }));
    }

    /**
     * The board row under a point on the map (the mode centres its view there).
     * @param {number} y px from the canvas's top, in CSS pixels
     * @param {number} [cssHeight] the canvas's laid-out height
     * @returns {number}
     */
    _getRowFromY(y, cssHeight = this.canvas.clientHeight || this.canvas.height) {
        const board = this._board();
        const rowsTotal = board?.length || 0;
        if (!rowsTotal) return 0;
        const topRow = this._build?.board === board ? this._build.topRow : this._topRow(board);
        const { span, cell, y0 } = this._layout(rowsTotal, topRow);
        const yCanvas = cssHeight > 0 ? (y / cssHeight) * this.canvas.height : 0;
        return clamp(Math.floor(rowsTotal - span + (yCanvas - y0) / cell), rowsTotal - span, rowsTotal - 1);
    }

    destroy() {
        this.container.parentElement?.removeAttribute?.('data-off-floor');
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this._removeWindowListeners();
        this._build = null;
        this._drawn = null;
        this._colors.clear();
        this.container.parentElement?.removeChild(this.container);
    }
}
