/**
 * Page side of scripts/capture-menu-art.mjs: stages each game mode for its photograph. The dev
 * server serves this file to the running game (`import('/scripts/menu-art/stage.js')`), so it
 * reaches the same modules and singletons the game uses. Every function takes plain options
 * and returns a JSON-able summary.
 */
import { SHAPES, COLORS } from '/src/core/constants.js';
import { rebuildBoardGridFromPieces, markBoardDirty } from '/src/core/board.js';

const KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const RAIL = ['#sb-play-rail', '.sb-play-rail'];

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rotate = (m) => m[0].map((_, x) => m.map((row) => row[x]).reverse());
const cellsOf = (shape) => shape.flatMap((row, y) => row.map((v, x) => (v ? [x, y] : null)).filter(Boolean));
const currentMode = () => window.serenityBlocks.gameModeManager.getCurrentMode();

function themedColor(key) {
    const config = window.serenityBlocks?.themeManager?.activeTheme?.getTetrominoConfig?.();
    return config?.colors?.[key] || COLORS[key] || '#808080';
}

/**
 * A stack that looks played: real tetrominoes from a seeded 7-bag, each dropped where a
 * simple placement score (height, holes, bumpiness, plus noise) puts it, never completing a
 * row (a full row would clear). `well` keeps a column open.
 */
export function buildStack({
    rows, cols = 10, pieces = 24, seed = 7, well = null, noise = 0.9, flat = 1, holeCost = 6,
}) {
    const rand = mulberry32(seed);
    const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
    const placed = [];
    let bag = [];
    const fits = (cells, x, y) => cells.every(([cx, cy]) => {
        const gx = x + cx;
        const gy = y + cy;
        return gx >= 0 && gx < cols && gy < rows && (gy < 0 || !grid[gy][gx]);
    });
    for (let n = 0; n < pieces; n += 1) {
        if (!bag.length) {
            bag = KEYS.slice();
            for (let i = bag.length - 1; i > 0; i -= 1) {
                const j = Math.floor(rand() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
        }
        const key = bag.pop();
        let shape = SHAPES[key].map((row) => row.slice());
        let best = null;
        for (let r = 0; r < 4; r += 1, shape = rotate(shape)) {
            const cells = cellsOf(shape);
            const minY = Math.min(...cells.map(([, cy]) => cy));
            for (let x = -3; x < cols; x += 1) {
                let y = -minY;
                if (!fits(cells, x, y)) continue;
                while (fits(cells, x, y + 1)) y += 1;
                cells.forEach(([cx, cy]) => { grid[y + cy][x + cx] = 1; });
                let full = 0;
                let holes = 0;
                let wellCells = 0;
                const heights = [];
                for (let gx = 0; gx < cols; gx += 1) {
                    let top = rows;
                    for (let gy = 0; gy < rows; gy += 1) if (grid[gy][gx]) { top = gy; break; }
                    heights.push(rows - top);
                    for (let gy = top + 1; gy < rows; gy += 1) if (!grid[gy][gx]) holes += 1;
                    if (gx === well) wellCells += rows - top;
                }
                for (let gy = 0; gy < rows; gy += 1) if (grid[gy].every(Boolean)) full += 1;
                const aggregate = heights.reduce((a, b) => a + b, 0);
                const bump = heights.slice(1).reduce((a, h, i) => a + Math.abs(h - heights[i]), 0);
                const score = -0.5 * aggregate - holeCost * holes - 0.45 * bump * flat - 40 * full - 30 * wellCells
                    - 0.6 * Math.max(...heights) + noise * rand();
                cells.forEach(([cx, cy]) => { grid[y + cy][x + cx] = 0; });
                if (!best || score > best.score) best = { score, x, y, shape: shape.map((row) => row.slice()), cells };
            }
        }
        if (!best) break;
        best.cells.forEach(([cx, cy]) => { grid[best.y + cy][best.x + cx] = 1; });
        placed.push({ key, shape: best.shape, x: best.x, y: best.y });
    }
    const top = grid.findIndex((row) => row.some(Boolean));
    return { placed, top: top < 0 ? rows : top };
}

/** Puts a built stack on a GameState; the board scene redraws on the version bump. */
function applyStack(gs, placed, idBase = 70000) {
    gs.lockedPieces = placed.map((p, i) => ({
        shapeKey: p.key, type: p.key, color: themedColor(p.key), shape: p.shape.map((row) => row.slice()),
        x: p.x, y: p.y, pieceId: idBase + i, rotation: 0,
    }));
    rebuildBoardGridFromPieces(gs.lockedPieces, gs.boardGrid);
    markBoardDirty(gs);
}

function placeCurrent(gs, key, { x, y, turns = 0 }) {
    if (!gs.currentPiece) return;
    let shape = SHAPES[key].map((row) => row.slice());
    for (let i = 0; i < turns; i += 1) shape = rotate(shape);
    Object.assign(gs.currentPiece, { shapeKey: key, type: key, shape, x, y, rotation: turns % 4, color: themedColor(key) });
    markBoardDirty(gs);
}

/** Opacity, not display: themes measure some of these (the ledger) to compose around them. */
export function hide(selectors) {
    selectors.forEach((selector) => document.querySelectorAll(selector).forEach((el) => {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
    }));
    return true;
}

/** Interface that is not the world: hidden for every photograph; `css` frames the board. */
export function frame(css = '') {
    let style = document.getElementById('menu-art-frame');
    if (!style) {
        style = document.createElement('style');
        style.id = 'menu-art-frame';
        document.head.appendChild(style);
    }
    style.textContent = `#serenity-hub-icon, #settings-btn-global, #odyssey-navigator-btn, #hale-sessions-btn,
        .main-menu-player-card, .toast-container, .sb-toast, .custom-cursor, .custom-cursor-container,
        #custom-cursor { display: none !important; }\n${css}`;
    hide(RAIL);
    return true;
}

/** No pause sheet when the window loses focus, no play-rail peeks, no cursor. */
export function prepare() {
    window.settingsManager.update({ pauseOnFocusLoss: false, backgroundTabBehavior: 'continue' });
    window.serenityBlocks.backgroundTabBehavior = 'continue';
    localStorage.setItem('serenity.playRail.peeks', JSON.stringify({
        single: 3, infinity: 3, 'local-multiplayer': 3, 'online-multiplayer': 3, odyssey: 3, serenity: 3,
    }));
    document.body.classList.add('cursor-hidden');
    document.hasFocus = () => true;
    return true;
}

/** Single player: a mid-game stack with the right column open and an I piece over it. */
export function stageSingle({ seed = 9, pieces = 24, lift = 6 } = {}) {
    const m = currentMode();
    const gs = m.gameState;
    gs.dropInterval = 1e9;
    const { placed, top } = buildStack({ rows: gs.boardGrid.length, pieces, seed, well: 9 });
    applyStack(gs, placed);
    placeCurrent(gs, 'I', { x: 7, y: Math.max(4, top - lift), turns: 1 });
    gs.nextPieces.splice(0, 3, 'T', 'L', 'O');
    m._refreshNextQueue?.();
    hide(['.single-player-stats-bar']);
    return { top };
}

/** Infinity: rows added above, a tower about eighty rows tall, the camera at its top. */
export function stageInfinity({ seed = 5, pieces = 170, extraRows = 56, cameraLead = 4 } = {}) {
    const m = currentMode();
    const gs = m.gameState;
    gs.dropInterval = 1e9;
    const width = gs.boardGrid[0].length;
    const empty = Array.from({ length: extraRows }, () => Array(width).fill(null));
    gs.board = [...empty, ...gs.boardGrid];
    gs.boardGrid = gs.board;
    (gs.lockedPieces || []).forEach((p) => { p.y += extraRows; });
    if (gs.currentPiece) gs.currentPiece.y += extraRows;
    const rows = gs.boardGrid.length;
    const { placed, top } = buildStack({ rows, pieces, seed, noise: 0.8, flat: 2, holeCost: 1.2 });
    applyStack(gs, placed);
    placeCurrent(gs, 'T', { x: 4, y: Math.max(1, top - 5) });
    const scene = m.boardScene;
    scene?.updateCameraBounds?.();
    scene?.enableManualCameraControl?.();
    scene?.updateCameraPosition?.(Math.max(0, top - cameraLead), true);
    m._updateStats?.();
    m._updateMinimapView?.();
    hide(['#infinity-hud']);
    return { top, rows, built: rows - top };
}

/** Local versus: skips the setup sheet with a peaceful match of bots. */
export function startLocalBots({ seats = 4, skills = [7, 5, 8, 6], startLevel = 6 } = {}) {
    const m = currentMode();
    const bot = (i) => ({ kind: 'bot', difficulty: skills[i % skills.length], handicap: 2, name: ['Ada', 'Bo', 'Cy', 'Di'][i], slot: i });
    const slots = [0, 1, 2, 3].slice(0, seats);
    m.configModal.hide();
    m.handleConfigurationComplete({
        numPlayers: seats, endCondition: 'never', endConditionValue: 0, isInfinityLMS: false, infinityMaxRows: 100,
        boringRules: false, attackStyle: 'peaceful', attackRules: { disableAttacks: true }, hotPotato: false,
        playerTeams: slots, isTeamMode: false, startLevel, levelProgression: false,
        playerHandicaps: slots.map(() => 2), playerSlots: slots.map(bot),
    });
    return true;
}

/** Local versus, once the countdown is over: a stack under each bot, of different heights. */
export function stageLocal({ stacks = [13, 8, 15, 10] } = {}) {
    const players = currentMode().multiplayerState?.players || [];
    const tops = [];
    players.forEach((gs, i) => {
        if (!gs?.boardGrid || !stacks[i]) return;
        const { placed, top } = buildStack({ rows: gs.boardGrid.length, pieces: stacks[i], seed: 31 + i * 17, well: (i * 3 + 2) % 10 });
        applyStack(gs, placed, 80000 + i * 1000);
        tops.push(top);
    });
    return { seats: players.length, tops };
}

/** Online versus: the dev mock lobby. Its dummies never send a packet, so silence is waived. */
export async function startOnlineMock({ seats = 6 } = {}) {
    await window.testMultiplayer(seats);
    const game = (window.__getMode?.() || currentMode())?.ffaGameState;
    if (game?.network) game.network.peerSilenceMs = () => 0;
    return Boolean(game?.network);
}

/** Online versus: a stack on every board, the side column hidden, the lobby's test names replaced. */
export function stageOnline({ seed = 21 } = {}) {
    const game = (window.__getMode?.() || currentMode())?.ffaGameState;
    let next = seed;
    let filled = 0;
    Array.from(game?.players?.values?.() || []).forEach((player) => {
        const gs = player.gameState;
        if (!gs?.boardGrid) return;
        gs.dropInterval = 1e9;
        next += 7;
        const { placed } = buildStack({ rows: gs.boardGrid.length, pieces: 10 + (next % 17), seed: next, well: next % 10 });
        applyStack(gs, placed);
        filled += 1;
    });
    hide(['#online-multiplayer-container .right-panel']);
    const names = ['Mira', 'Kenji', 'Aino', 'Tomas', 'Lea', 'Sol', 'Ines', 'Ravi'];
    const renamed = new Map();
    const walker = document.createTreeWalker(document.getElementById('online-multiplayer-container'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        node.nodeValue = node.nodeValue.replace(/TestBot_[A-Za-z]+|Dev_\d+/g, (name) => {
            if (!renamed.has(name)) renamed.set(name, names[renamed.size % names.length]);
            return renamed.get(name);
        });
    }
    return { filled, renamed: renamed.size };
}
