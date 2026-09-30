/**
 * Parhelion — the hidden sun and its hounds (playground effect = production scene runtime).
 *
 * A 22° ice-halo display (hard dusky lens, red inner edge, sundogs, parhelic line, upper
 * tangent arc, sun-pillar stub) framing the Vigil Stone that hides the sun, over a golden
 * contre-jour snowfield under cobalt sky, with diamond dust, a reaction glint pool and hound
 * pillars. The theme wrapper (src/themes/parhelion/parhelion-theme.js) drives this runtime.
 *
 * ONE clock source: the runtime owns a ParhelionOpticsState and writes its reused `out` into
 * the shared uniforms every frame (deduped at ε 1e-4): gains, arcs, bursts, pillars, dust
 * effects, rim, bloom kick, the integrated clocks and the rotational shake.
 *
 * Runtime API (wrapper): update(t, dt), seek(t), render(), resize(w, h, dpr), setLayout(layout),
 * cue(c), count(n), setResonance(r), setLevel(n), configure({ reducedMotion, intensity }),
 * resetSession(), camera(t, cam), getDiagnostics(), getCaptureMeta(), getRendererCounters(),
 * dispose(), post.
 *
 * URL params (playground):
 *   ?t=<s>                  reproducible frame (seek: clocks = t·rate through the optics state)
 *   ?board=1                DOM mock of the single-player card/board/HUD at the measured rects
 *   ?quality=<tier>         Minimal | Low | Medium | High (default) | Ultra | Extreme
 *   ?parhelionLevel=<n>     Lower Sun warmth (level 1 = rest)
 *   ?parhelionCombo=<n>     static resonance preview (Warm Hounds / Crowning / Parhelic Line)
 *   ?parhelionPulse=<cue>&parhelionPulseAge=<s>  one deterministic reaction through the real
 *                           optics state: lock, harddrop, single, double, triple, quad, tspin,
 *                           apex, perfect, echo
 *   ?parhelionCalmDebug=1   calm-union outline in the dome (stone hidden so it shows)
 *   ?parhelionNoPost=1      direct render (no RenderPipeline) — debugging only
 *   ?parhelionBloom=<s>     bloom strength override (A/B only)
 *   ?parhelionK0=a,b,c,d    optics gain override (halo, dogs, parhelic, uta) — isolate one optic
 *   ?parhelionK1=a,b,c,d    optics gain override (crown, sunPillar, lowitz, displayDim)
 *   ?parhelionCounters=1    whole-frame draw/triangle counters (owns renderer.info — never in game)
 *   ?parhelionIcon=1        hub-icon framing: wider lens, no board (Serenity layout, no calm rects)
 *   ?parhelionPointer=x,y   hold a pointer-parallax deflection (NDC, each in [-1, 1])
 */

import * as THREE from 'three/webgpu';
import {
    CAM_REST,
    CAMERA_FAR,
    CAMERA_FOCUS,
    CAMERA_NEAR,
    CAMERA_RIG,
    FALLBACK_RECT,
    MEASURED_VIEWPORTS,
    STONE,
    TAN_V,
    VFOV_DEG,
    cardFromBoard,
    pixelAngle,
    solveStone,
} from './parhelion-composition.js';
import {
    createDomeMaterial,
    createSharedUniforms,
    createSnowMaterial,
    createStoneMaterial,
    createStoneRimMaterial,
    resolveParhelionTier,
} from './parhelion-materials.js';
import { buildStoneGeometry } from './parhelion-geometry.js';
import {
    PARHELION_DUST_COUNTS,
    buildDustSprite,
    buildGlintSprite,
    buildPillarGeometry,
    createBurstUniforms,
    createDustMaterial,
    createGlintMaterial,
    createPillarMaterial,
} from './parhelion-particles.js';
import { CALM_RECTS_MAX, ParhelionPost } from './parhelion-post.js';
import { ThemeCameraRig } from '../../themes/shared/camera-rig.js';
import { ParhelionOpticsState } from '../../themes/parhelion/sim/parhelion-optics-state.js';
import { CUE } from '../../themes/parhelion/sim/parhelion-reaction-director.js';

export const meta = {
    id: 'parhelion',
    title: 'Parhelion',
    description: 'Hidden sun and its hounds: 22° halo, sundogs and the Vigil Stone over a contre-jour snowfield',
};

const DEG = Math.PI / 180;
const WRITE_EPS = 1e-4;
// ?parhelionIcon=1: a wider lens so the 22° ring, both hounds and the stone fit a circle crop.
const ICON_VFOV_DEG = 62;
const DEFAULT_SEED = 0x57a21197;

/** Rim shell over-size (x, y, z) — a ~3 px gold line along the stone's silhouette at 117 m. */
const STONE_RIM_SCALE = Object.freeze([1.012, 1.006, 1.012]);

/** Dome (§5.3): unit sphere scaled to 6000 m, drawn after stone + snow for early-z. */
const DOME_RADIUS = 6000;
const SNOW_SIZE = 4000;

/** §6 calm-rect parameters (strength, dimScene, desat, feather). */
const CALM = Object.freeze({
    solo: Object.freeze([1, 0, 0, 0.015]),
    unbacked: Object.freeze([1, 0.6, 0.15, 0.015]),
    weak: Object.freeze([0.5, 0, 0, 0.02]),
    fallback: Object.freeze([0.6, 0, 0, 0.02]),
});

/** `?parhelionPulse=` names → the director's cue fields (a single deterministic reaction). */
const PULSE_CUES = Object.freeze({
    lock: Object.freeze({ kind: CUE.LOCK, lines: 0 }),
    harddrop: Object.freeze({ kind: CUE.STONEFALL, lines: 0 }),
    stonefall: Object.freeze({ kind: CUE.STONEFALL, lines: 0 }),
    single: Object.freeze({ kind: CUE.CLEAR, lines: 1 }),
    clear: Object.freeze({ kind: CUE.CLEAR, lines: 1 }),
    double: Object.freeze({ kind: CUE.CLEAR, lines: 2 }),
    triple: Object.freeze({ kind: CUE.CLEAR, lines: 3 }),
    quad: Object.freeze({ kind: CUE.QUAD, lines: 4 }),
    tspin: Object.freeze({ kind: CUE.TSPIN, lines: 2 }),
    apex: Object.freeze({ kind: CUE.APEX, lines: 1, combo: 10 }),
    perfect: Object.freeze({ kind: CUE.PERFECT, lines: 4 }),
    echo: Object.freeze({ kind: CUE.ECHO, lines: 4, echoOf: CUE.QUAD }),
});

// ---------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function readNumber(params, key, fallback) {
    const raw = params?.get?.(key);
    const value = raw == null ? NaN : Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

/** `?key=a,b,c,d` → four finite numbers, else null. */
function readVec4(params, key) {
    const raw = params?.get?.(key);
    if (!raw) return null;
    const parts = raw.split(',').map((part) => Number.parseFloat(part));
    return parts.length === 4 && parts.every(Number.isFinite) ? parts : null;
}

function setScalar(node, value) {
    if (Math.abs(node.value - value) > WRITE_EPS) node.value = value;
}

function setVec2(node, x, y) {
    const v = node.value;
    if (Math.abs(v.x - x) > WRITE_EPS || Math.abs(v.y - y) > WRITE_EPS) v.set(x, y);
}

/** Deduped write of four floats into a Vector4 (a uniform's value or a uniformArray slot). */
function setV4(v, x, y, z, w) {
    if (Math.abs(v.x - x) > WRITE_EPS || Math.abs(v.y - y) > WRITE_EPS
        || Math.abs(v.z - z) > WRITE_EPS || Math.abs(v.w - w) > WRITE_EPS) v.set(x, y, z, w);
}

function validRect(r) {
    return !!r && Number.isFinite(r.x0) && Number.isFinite(r.y0) && Number.isFinite(r.x1)
        && Number.isFinite(r.y1) && r.x1 > r.x0 + 0.005 && r.y1 > r.y0 + 0.005;
}

/** The measured viewport (§15) whose aspect is nearest `aspect`. */
function nearestLayout(aspect) {
    let best = MEASURED_VIEWPORTS[0];
    let bestErr = Infinity;
    for (let i = 0; i < MEASURED_VIEWPORTS.length; i++) {
        const err = Math.abs(Math.log(MEASURED_VIEWPORTS[i].aspect / aspect));
        if (err < bestErr) {
            bestErr = err;
            best = MEASURED_VIEWPORTS[i];
        }
    }
    return best;
}

/**
 * The playground's stand-in for composition/parhelion-board-rects.js: the measured solo layout
 * nearest this aspect, in the reader's exact shape (boards = 5 slots, index = player).
 */
function playgroundLayout(width, height) {
    const vp = nearestLayout(width / Math.max(1, height));
    const board = {
        ...vp.board, rect: vp.board, player: 0, stoneBacked: true,
    };
    return {
        card: vp.card,
        board: vp.board,
        queue: vp.next,
        next: vp.next,
        hud: vp.hud,
        boards: [board, null, null, null, null],
        boardCount: 1,
        mode: 'single',
        serenity: false,
        fallback: false,
        cardDerived: false,
        aspect: width / Math.max(1, height),
        width,
        height,
        version: 0,
        measured: vp,
    };
}

/** A director-shaped cue for `?parhelionPulse=` (every field the optics state reads). */
function makePulseCue(name) {
    const spec = PULSE_CUES[String(name || '').toLowerCase()];
    if (!spec) return null;
    return {
        kind: spec.kind,
        player: 0,
        primary: true,
        sx: -1,
        sy: -1,
        rowV: 0.85,
        lockU: 0.65,
        lockV: 0.8,
        lines: spec.lines,
        combo: spec.combo ?? 0,
        cascade: 1,
        depth: 0,
        strength: 1,
        reducedMotion: false,
        lockCount: 1,
        b2b: false,
        echoOf: spec.echoOf ?? CUE.NONE,
    };
}

// ---------------------------------------------------------------------------------------
// ?board=1 — DOM mock of the single-player card (playground only; no WebGPU)
// ---------------------------------------------------------------------------------------

const PIECE_COLORS = Object.freeze({
    I: '#FFD068',
    O: '#D0A6FF',
    T: '#7EF0C2',
    S: '#E46CB0',
    Z: '#5C8AFF',
    J: '#FF7E40',
    L: '#A6E2FF',
    G: '#2C3352',
    C: '#909CC6',
});

// 10 × 20, top row first. g = 20% white ghost of the active T.
const BOARD_ROWS = Object.freeze([
    '..........',
    '..........',
    '...TTT....',
    '....T.....',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '.........I',
    '...ggg...I',
    '....g....I',
    'ZZ..L...JI',
    '.ZZ.L.OOJ.',
    'SS.LLSOOJJ',
    'CCCCCCC.CC',
    'GGG.GGGGGG',
]);

function placeRect(el, r) {
    Object.assign(el.style, {
        position: 'absolute',
        left: `${(r.x0 * 100).toFixed(3)}%`,
        top: `${(r.y0 * 100).toFixed(3)}%`,
        width: `${((r.x1 - r.x0) * 100).toFixed(3)}%`,
        height: `${((r.y1 - r.y0) * 100).toFixed(3)}%`,
        boxSizing: 'border-box',
    });
}

function drawCell(ctx, x, y, size, fill) {
    const inset = Math.max(1, size * 0.04);
    ctx.fillStyle = fill;
    ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x + inset, y + inset, size - inset * 2, Math.max(1, size * 0.12));
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + inset, y + size - inset - Math.max(1, size * 0.12), size - inset * 2, Math.max(1, size * 0.12));
}

function drawBoard(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const size = Math.min(w / 10, h / 20);
    const ox = (w - size * 10) / 2;
    const oy = (h - size * 20) / 2;
    ctx.strokeStyle = 'rgba(139,92,246,0.10)';
    ctx.lineWidth = 1;
    for (let c = 1; c < 10; c++) {
        ctx.beginPath();
        ctx.moveTo(ox + c * size + 0.5, oy);
        ctx.lineTo(ox + c * size + 0.5, oy + size * 20);
        ctx.stroke();
    }
    for (let r = 0; r < 20; r++) {
        for (let c = 0; c < 10; c++) {
            const ch = BOARD_ROWS[r][c];
            if (ch === 'g') {
                ctx.fillStyle = 'rgba(255,255,255,0.20)';
                ctx.fillRect(ox + c * size + 1, oy + r * size + 1, size - 2, size - 2);
            } else if (PIECE_COLORS[ch]) {
                drawCell(ctx, ox + c * size, oy + r * size, size, PIECE_COLORS[ch]);
            }
        }
    }
}

function drawNext(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const size = Math.min(h / 3.2, w / 14);
    const pieces = [
        { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], fill: PIECE_COLORS.Z },
        { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], fill: PIECE_COLORS.O },
        { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], fill: PIECE_COLORS.L },
    ];
    const slot = w / pieces.length;
    pieces.forEach((piece, index) => {
        const x0 = index * slot + (slot - size * 3) / 2;
        const y0 = (h - size * 2) / 2;
        piece.cells.forEach(([cx, cy]) => drawCell(ctx, x0 + cx * size, y0 + cy * size, size, piece.fill));
    });
}

function createBoardOverlay(layout) {
    const root = document.createElement('div');
    root.id = 'parhelion-board-overlay';
    Object.assign(root.style, {
        position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5',
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
        background: 'rgba(14,18,28,0.88)',
        border: '1px solid rgba(139,92,246,0.45)',
        borderRadius: '14px',
    });
    const board = document.createElement('canvas');
    Object.assign(board.style, { background: 'rgba(8,10,18,0.35)', borderRadius: '4px' });
    const next = document.createElement('canvas');
    const hud = document.createElement('div');
    Object.assign(hud.style, {
        background: 'rgba(18,24,40,0.55)',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: '10px',
        backdropFilter: 'blur(6px)',
        color: 'rgba(226,232,255,0.86)',
        font: '600 12px system-ui, sans-serif',
        letterSpacing: '0.08em',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    });
    hud.innerHTML = ['SCORE<br><b style="font-size:18px">12,480</b>', 'LEVEL<br><b style="font-size:18px">1</b>',
        'LINES<br><b style="font-size:18px">7</b>'].map((line) => `<div>${line}</div>`).join('');
    root.append(card, next, board, hud);
    document.body.appendChild(root);

    const apply = (l) => {
        placeRect(card, l.card);
        placeRect(board, l.board);
        placeRect(next, l.next);
        placeRect(hud, l.hud);
        drawBoard(board);
        drawNext(next);
    };
    apply(layout);
    return {
        setLayout: apply,
        dispose() { root.remove(); },
    };
}

// ---------------------------------------------------------------------------------------
// create(ctx)
// ---------------------------------------------------------------------------------------

export function create(ctx) {
    const {
        scene, camera, renderer, sizes, params,
    } = ctx;
    const tier = resolveParhelionTier(ctx.tier ?? params?.get?.('quality') ?? 'High');
    const calmDebug = params?.get?.('parhelionCalmDebug') === '1';
    const noPost = params?.get?.('parhelionNoPost') === '1' || !tier.post;
    const level = Math.max(1, Math.floor(readNumber(params, 'parhelionLevel', 1)));
    const combo = Math.max(0, readNumber(params, 'parhelionCombo', 0));
    const rng = ctx.rng || mulberry32(Number.isFinite(ctx.seed) ? ctx.seed : DEFAULT_SEED);

    // ── The one clock and reaction source.
    const optics = new ParhelionOpticsState(tier.name);
    const { caps } = optics;
    if (combo > 0) optics.setResonance(Math.min(1, combo / 10));
    if (level > 1) optics.setLevel(level, 0);
    const pulseCue = makePulseCue(params?.get?.('parhelionPulse'));
    const pulseAge = Math.max(0, readNumber(params, 'parhelionPulseAge', 0.5));
    let pulsePending = Boolean(pulseCue);

    const u = createSharedUniforms();
    const disposables = [];

    // ── Drawables. Opaque order: stone (0) → snow (1) → dome (10), so early-z rejects the dome;
    //    then additive: rim shell (11), pillars (15), dust (20), glints (21).
    const { geometry: stoneGeometry, profile: stoneProfile } = buildStoneGeometry();
    const stoneMaterial = createStoneMaterial(u, tier);
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    stone.name = 'parhelion-vigil-stone';
    stone.position.set(0, 0, STONE.Z);
    stone.rotation.z = -STONE.LEAN;
    stone.renderOrder = 0;
    stone.visible = !calmDebug;

    const rimMaterial = createStoneRimMaterial(u);
    const rimShell = new THREE.Mesh(stoneGeometry, rimMaterial);
    rimShell.name = 'parhelion-vigil-stone-rim';
    rimShell.position.copy(stone.position);
    rimShell.rotation.z = -STONE.LEAN;
    rimShell.renderOrder = 11;
    rimShell.visible = !calmDebug;

    const snowGeometry = new THREE.PlaneGeometry(SNOW_SIZE, SNOW_SIZE, 1, 1);
    snowGeometry.rotateX(-Math.PI / 2);
    const snowMaterial = createSnowMaterial(u, tier);
    const snow = new THREE.Mesh(snowGeometry, snowMaterial);
    snow.name = 'parhelion-snowfield';
    snow.renderOrder = 1;

    const domeGeometry = new THREE.SphereGeometry(1, 48, 24);
    const domeMaterial = createDomeMaterial(u, tier, { calmDebug });
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.name = 'parhelion-sky-dome';
    dome.scale.setScalar(DOME_RADIUS);
    dome.frustumCulled = false;
    dome.renderOrder = 10;

    const pillarGeometry = buildPillarGeometry(caps.pillars);
    const pillarMaterial = createPillarMaterial(u, { glitter: tier.post });
    const pillars = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillars.name = 'parhelion-hound-pillars';
    pillars.frustumCulled = false;
    pillars.renderOrder = 15;

    const dustSpec = PARHELION_DUST_COUNTS[tier.name] || PARHELION_DUST_COUNTS.High;
    const dustMaterial = createDustMaterial(u, { minimal: !tier.post });
    const dust = buildDustSprite(dustMaterial, dustSpec, rng);

    const bursts = createBurstUniforms(caps.burstSlots);
    const glintMaterial = createGlintMaterial(u, bursts, caps.perSlot);
    const glints = buildGlintSprite(glintMaterial, caps.burstSlots * caps.perSlot);

    scene.add(stone, snow, dome, rimShell, pillars, dust, glints);
    disposables.push(
        stoneGeometry,
        stoneMaterial,
        rimMaterial,
        snowGeometry,
        snowMaterial,
        domeGeometry,
        domeMaterial,
        pillarGeometry,
        pillarMaterial,
        dust.geometry,
        dustMaterial,
        glints.geometry,
        glintMaterial,
    );

    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x142C66, 1);
    // Whole-frame counters (reset once per frame in render(), not per render call) are an
    // opt-in playground diagnostic: a theme must never own renderer.info, or the perf lane
    // marks its cells 'contested' and inadmissible.
    const ownsRendererInfo = Boolean(renderer.info) && params?.get?.('parhelionCounters') === '1';
    const previousAutoReset = renderer.info?.autoReset;
    if (ownsRendererInfo) renderer.info.autoReset = false;
    const counters = { drawCalls: 0, triangles: 0, pipelines: 0 };

    const bloomStrength = readNumber(params, 'parhelionBloom', undefined);
    const post = noPost ? null : new ParhelionPost(renderer, scene, camera, {
        tier, bloomStrength, aspect: u.uAspect, time: u.uTime,
    });

    const k0Override = readVec4(params, 'parhelionK0');
    const k1Override = readVec4(params, 'parhelionK1');

    // ── Layout: stone solve, calm rects, calm union, pillar places (via the optics state).
    const solve = solveStone({ profile: stoneProfile });
    const calmList = Array.from({ length: CALM_RECTS_MAX }, () => ({
        rect: {
            x0: 0, y0: 0, x1: 0, y1: 0,
        },
        strength: 0,
        dimScene: 0,
        desat: 0,
        feather: 0.015,
    }));
    const cardScratch = {
        x0: 0, y0: 0, x1: 0, y1: 0,
    };
    const union = {
        x0: 0, y0: 0, x1: 0, y1: 0,
    };
    const view = { width: sizes.width, height: sizes.height, aspect: sizes.width / Math.max(1, sizes.height) };
    let externalLayout = false;
    let calmCount = 0;
    let overlayLayout = null;

    function pushCalm(rect, spec) {
        if (calmCount >= CALM_RECTS_MAX || !validRect(rect)) return;
        const e = calmList[calmCount];
        e.rect.x0 = rect.x0;
        e.rect.y0 = rect.y0;
        e.rect.x1 = rect.x1;
        e.rect.y1 = rect.y1;
        [e.strength, e.dimScene, e.desat, e.feather] = spec;
        calmCount += 1;
    }

    function applyLayout(layout) {
        const l = layout || {};
        const aspect = l.width > 0 && l.height > 0 ? l.width / l.height : view.aspect;
        optics.setLayout(l);
        const serenity = l.serenity === true || l.mode === 'serenity';
        const boards = Array.isArray(l.boards) ? l.boards : [];
        let boardCount = 0;
        let primary = null;
        for (let i = 0; i < boards.length; i++) {
            if (validRect(boards[i])) {
                boardCount += 1;
                if (!primary) primary = boards[i];
            }
        }
        if (!primary && validRect(l.board)) {
            primary = l.board;
            boardCount = Math.max(boardCount, 1);
        }

        calmCount = 0;
        let backed = false;
        let stoneCard = null;
        if (!serenity && boardCount <= 1) {
            if (validRect(l.card)) stoneCard = l.card;
            else if (primary) stoneCard = cardFromBoard(primary, cardScratch);
            else if (l.fallback) stoneCard = FALLBACK_RECT;
        }
        solveStone({ card: stoneCard, aspect, profile: stoneProfile }, solve);
        if (!serenity) {
            backed = solve.backed && !l.fallback && Boolean(stoneCard);
            if (backed) {
                pushCalm(stoneCard, CALM.solo);
            } else {
                for (let i = 0; i < boards.length; i++) {
                    if (validRect(boards[i])) pushCalm(boards[i], CALM.unbacked);
                }
                if (boardCount === 0 && primary) pushCalm(primary, CALM.unbacked);
            }
            if (l.fallback || (!stoneCard && boardCount === 0)) pushCalm(FALLBACK_RECT, CALM.fallback);
            pushCalm(l.queue || l.next, CALM.weak);
            pushCalm(l.hud, CALM.weak);
        }
        post?.setCalmRects(calmList, calmCount);

        // The scene materials' calm union: the bounding box of the board-strength rects.
        union.x0 = 1;
        union.y0 = 1;
        union.x1 = 0;
        union.y1 = 0;
        for (let i = 0; i < calmCount; i++) {
            const e = calmList[i];
            if (e.strength >= 0.6) {
                union.x0 = Math.min(union.x0, e.rect.x0);
                union.y0 = Math.min(union.y0, e.rect.y0);
                union.x1 = Math.max(union.x1, e.rect.x1);
                union.y1 = Math.max(union.y1, e.rect.y1);
            }
        }
        if (!(union.x1 > union.x0)) {
            union.x0 = 0;
            union.y0 = 0;
            union.x1 = 0;
            union.y1 = 0;
        }
        setV4(u.uCalmUnion.value, union.x0, union.y0, union.x1, union.y1);
        setScalar(u.uUnionDim, !serenity && boardCount >= 1 && !backed ? 0.6 : 0);

        stone.scale.set(solve.sx, solve.sy, solve.sx * STONE.DEPTH_SCALE);
        rimShell.scale.set(
            solve.sx * STONE_RIM_SCALE[0],
            solve.sy * STONE_RIM_SCALE[1],
            solve.sx * STONE.DEPTH_SCALE * STONE_RIM_SCALE[2],
        );
        const hw = solve.stoneHW;
        setV4(u.uStoneHW.value, hw[0], hw[1], hw[2], hw[3]);
        overlayLayout = l.measured || null;
    }

    // Playground-only hub-icon framing: a wider lens so ring, hounds and stone fit a circle crop.
    const iconMode = params?.get?.('parhelionIcon') === '1';
    const cameraFov = iconMode ? ICON_VFOV_DEG : VFOV_DEG;
    const overlay = params?.get?.('board') === '1'
        ? createBoardOverlay(nearestLayout(view.aspect))
        : null;

    function applyViewport(width, height, dpr) {
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        const current = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        const ratio = dpr > 0 ? dpr : current;
        view.width = w;
        view.height = h;
        view.aspect = w / h;
        setScalar(u.uAspect, view.aspect);
        setScalar(u.uDpr, ratio);
        setScalar(u.uPixAng, pixelAngle(h * ratio));
        setVec2(u.uTanHV, TAN_V * view.aspect, TAN_V);
        // The playground has no DOM reader: stand in with the measured layout for this aspect.
        // Icon mode frames the display with no board at all (Serenity layout: no calm rects).
        if (!externalLayout) {
            const layout = playgroundLayout(w, h);
            if (iconMode) {
                layout.serenity = true;
                layout.mode = 'serenity';
            }
            applyLayout(layout);
            if (overlay && overlayLayout) overlay.setLayout(overlayLayout);
        }
    }

    // ── Frame: optics state → uniforms (deduped), then the theme's own shake on the camera.
    let now = 0;
    const shake = { yaw: 0, pitch: 0 };

    // Camera life: the shared ThemeCameraRig (breathing + pointer parallax, as every theme),
    // re-aimed at the stone face behind the board so the stone stays put under the card while
    // the world swings around it. idlePhase 0 keeps ?t= captures reproducible.
    const cameraRig = new ThemeCameraRig(camera, {
        focus: CAMERA_FOCUS,
        rest: CAM_REST,
        breathe: true,
        pointer: true,
        breatheScale: CAMERA_RIG.BREATHE_SCALE,
        pointerScale: CAMERA_RIG.POINTER_SCALE,
        idlePhase: 0,
    });
    let cameraTime = null;
    let pointerAllowed = true;
    // ?parhelionPointer=x,y (playground): hold a pointer deflection, damping pre-settled.
    const pointerPreview = String(params?.get?.('parhelionPointer') || '').split(',').map(Number);
    if (pointerPreview.length === 2 && pointerPreview.every(Number.isFinite)) {
        cameraRig.setPointer(pointerPreview[0], pointerPreview[1]);
        cameraRig.breathe = false;
        for (let i = 0; i < 60; i++) cameraRig.apply(0.1, CAM_REST);
        cameraRig.breathe = true;
    }

    function writeOptics(out) {
        const { clocks } = out;
        setScalar(u.uTime, out.time);
        setScalar(u.uDustClock, clocks.dustClock);
        setScalar(u.uVeilPhase, clocks.veilPhase);
        setScalar(u.uDriftPhase, clocks.driftPhase);
        setScalar(u.uWarmth, out.warmth);
        setScalar(u.uBreath, out.breath);
        const k0 = k0Override || out.k0;
        const k1 = k1Override || out.k1;
        setV4(u.uK0.value, k0[0], k0[1], k0[2], k0[3]);
        setV4(u.uK1.value, k1[0], k1[1], k1[2], k1[3]);
        setVec2(u.uDogFlare, out.dogFlare[0], out.dogFlare[1]);
        setScalar(u.uDogTail, out.dogTail);
        setScalar(u.uDogTint, out.dogTint);
        setVec2(u.uPc, out.pc[0], out.pc[1]);
        const { arcs } = out;
        for (let i = 0; i < u.arcSlots.length; i++) {
            const o = i * 4;
            setV4(u.arcSlots[i], arcs[o], arcs[o + 1], arcs[o + 2], arcs[o + 3]);
        }
        if (u.uArcCount.value !== out.arcCount) u.uArcCount.value = out.arcCount;
        setScalar(u.uRingFlash, out.ringFlash);
        setScalar(u.uPrism, out.prism);
        setScalar(u.uShower, out.shower);
        setVec2(u.uSpoke, out.spoke[0], out.spoke[1]);
        setScalar(u.uCrossArm, out.crossArm);
        setScalar(u.uDustGain, out.dustGain);
        setScalar(u.uDensity, out.density);
        setScalar(u.uRim, out.rim);
        if (out.burstDirty) {
            const { values } = bursts;
            for (let i = 0; i < bursts.slots; i++) {
                const o = i * 4;
                values.a[i].set(out.burstA[o], out.burstA[o + 1], out.burstA[o + 2], out.burstA[o + 3]);
                values.b[i].set(out.burstB[o], out.burstB[o + 1], out.burstB[o + 2], out.burstB[o + 3]);
                values.c[i].set(out.burstC[o], out.burstC[o + 1], out.burstC[o + 2], out.burstC[o + 3]);
                values.d[i].set(out.burstD[o], out.burstD[o + 1], out.burstD[o + 2], out.burstD[o + 3]);
            }
        }
        if (out.pillarsDirty) {
            const p = out.pillars;
            for (let i = 0; i < u.pillarSlots.length; i++) {
                u.pillarSlots[i].set(p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3]);
            }
        }
        if (out.pillarPlaceDirty) {
            const p = out.pillarPlace;
            for (let i = 0; i < u.pillarPlaceSlots.length; i++) {
                u.pillarPlaceSlots[i].set(p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3]);
            }
        }
        post?.setBloomKick(out.bloomKick);
        // Reduced motion: the optics state's camera breath scale (0.3) damps the rig's float.
        cameraRig.breatheScale = CAMERA_RIG.BREATHE_SCALE * out.breathScale;
        shake.yaw = out.shake.yawDeg * DEG;
        shake.pitch = out.shake.pitchDeg * DEG;
    }

    function evaluate(t, dt, seeking, allowPulse = true) {
        if (pulsePending && allowPulse) {
            // The pulse is born `age` seconds before the first evaluated frame.
            optics.applyCue(pulseCue, t - pulseAge);
            pulsePending = false;
        }
        let out;
        if (seeking) {
            optics.seek(t);
            out = optics.update(t, 0);
        } else {
            out = optics.update(t, dt);
        }
        now = t;
        writeOptics(out);
        // Rotational shake on top of the pose the camera rig just set in camera() (§2.5).
        if (shake.yaw !== 0 || shake.pitch !== 0) {
            camera.rotation.x += shake.pitch;
            camera.rotation.y += shake.yaw;
        }
    }

    applyViewport(sizes.width, sizes.height, 0);
    // Prime the uniforms; a ?parhelionPulse is born at the first real frame's t − age.
    evaluate(0, 0, true, false);

    return {
        post,
        update(t, dt) {
            evaluate(t, dt, false);
        },
        seek(t) {
            evaluate(t, 0, true);
        },
        render() {
            // Re-centre the dome on the camera (position only, never rotated).
            dome.position.copy(camera.position);
            if (ownsRendererInfo) renderer.info.reset();
            if (post) post.render();
            else renderer.render(scene, camera);
            if (ownsRendererInfo) {
                counters.drawCalls = renderer.info.render?.drawCalls ?? 0;
                counters.triangles = renderer.info.render?.triangles ?? 0;
                counters.pipelines = renderer._pipelines?.caches?.size ?? 0;
            }
        },
        // First playground frame goes through the same path as every other frame.
        async renderAsync() {
            this.render();
        },
        resize(width, height, dpr) {
            applyViewport(width, height, dpr);
        },
        /** Layout from composition/parhelion-board-rects.js (boards = 5 slots; null = absent). */
        setLayout(layout) {
            externalLayout = true;
            applyLayout(layout);
        },
        cue(c) {
            optics.applyCue(c, now);
        },
        count(n) {
            optics.applyCount(n, now);
        },
        setResonance(r) {
            optics.setResonance(r);
        },
        setLevel(n) {
            optics.setLevel(n, now);
        },
        configure(options) {
            optics.configure(options);
            // Reduced motion: no pointer parallax (the breathing is damped via the optics state).
            if (options && typeof options.reducedMotion === 'boolean') {
                pointerAllowed = !options.reducedMotion;
                cameraRig.pointer = pointerAllowed;
                if (!pointerAllowed) cameraRig.setPointer(0, 0);
            }
        },
        /** Pointer in normalised device coords, each axis in [-1, 1] (the wrapper's pointermove). */
        setPointer(x, y) {
            if (pointerAllowed) cameraRig.setPointer(x, y);
        },
        resetPointer() {
            cameraRig.setPointer(0, 0);
        },
        resetSession() {
            optics.resetSession();
        },
        camera(time, cam) {
            if (cam.fov !== cameraFov || cam.near !== CAMERA_NEAR || cam.far !== CAMERA_FAR) {
                cam.fov = cameraFov;
                cam.near = CAMERA_NEAR;
                cam.far = CAMERA_FAR;
                cam.updateProjectionMatrix();
            }
            // Breathing + pointer parallax through the shared rig, stepped by this frame's time
            // delta (a backwards seek rewinds it; a fixed ?t= holds it still, reproducibly).
            const t = Number(time) || 0;
            if (cameraTime !== null && t < cameraTime) cameraRig.reset();
            const dt = cameraTime === null ? 0 : Math.min(Math.max(t - cameraTime, 0), 0.1);
            cameraTime = t;
            cameraRig.apply(dt, CAM_REST);
        },
        getRendererCounters() {
            return { ...counters };
        },
        getCaptureMeta() {
            return {
                tier: tier.name,
                pulse: pulseCue ? params.get('parhelionPulse') : null,
                pulseAge: pulseCue ? pulseAge : null,
                time: now,
            };
        },
        getDiagnostics() {
            const { out } = optics;
            return {
                effect: meta.id,
                tier: tier.name,
                backend: renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
                post: Boolean(post),
                aspect: u.uAspect.value,
                calmCount,
                calmUnion: { ...union },
                layout: overlayLayout
                    ? { width: overlayLayout.width, height: overlayLayout.height, card: overlayLayout.card }
                    : null,
                stone: {
                    sx: solve.sx,
                    sy: solve.sy,
                    backed: solve.backed,
                    capped: solve.capped,
                    crownY: solve.crownY,
                    shoulderY: solve.shoulderY,
                    stoneHW: [...solve.stoneHW],
                },
                optics: {
                    ...optics.getDiagnostics(),
                    k0: Array.from(out.k0),
                    k1: Array.from(out.k1),
                    bloomKick: out.bloomKick,
                    rim: out.rim,
                    ringFlash: out.ringFlash,
                    prism: out.prism,
                },
                pulse: pulseCue ? { name: params.get('parhelionPulse'), age: pulseAge } : null,
                dust: dustSpec.count,
                glints: caps.burstSlots * caps.perSlot,
                pillars: caps.pillars,
                counters: { ...counters },
                warmth: u.uWarmth.value,
                breath: u.uBreath.value,
            };
        },
        dispose() {
            scene.remove(stone, snow, dome, rimShell, pillars, dust, glints);
            post?.dispose();
            disposables.forEach((item) => item.dispose());
            overlay?.dispose();
            renderer.setClearColor(previousClear, previousAlpha);
            if (ownsRendererInfo && previousAutoReset !== undefined) renderer.info.autoReset = previousAutoReset;
        },
    };
}
