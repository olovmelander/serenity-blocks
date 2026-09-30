/**
 * Chromadelic Highway — composition solver (CPU only; runs on resize / layout change / level-up,
 * never per frame).
 *
 * "The board is the sun": the gameplay card hides the vanishing point, so every celestial body
 * is placed in the VISIBLE zones around it, in screen anchors measured in viewport heights (H)
 * from the screen centre (u right, v up). Under the Hor+ lens those anchors do not move with
 * the aspect ratio; on wide screens the bodies are pushed outward so the side zones stay
 * balanced. Anchors are solved to world space through the REST camera, so the pose the rig
 * floats around is exactly the pose the composition was authored in.
 *
 * The UI rects are NOT constant in H (the board width caps at 300 px, which binds at 1080p and
 * above), so the solver reads the live DOM rects and falls back to the same CSS formulas the
 * stylesheet uses (public/styles/main.css, .single-player-card and the stats bar).
 *
 * Outputs: world positions/radii for the bodies, the sky's mask directions, the card/HUD rects
 * (screen fractions) for the screen-space masks and the post veil, the road's card-entry z and
 * the depth at which rings emerge from behind the card.
 */

import * as THREE from 'three/webgpu';

export const REST_RIG = Object.freeze({
    fov: 60,
    hFovCap: 104,
    position: Object.freeze({ x: 0, y: 84, z: 280 }),
    focus: Object.freeze({ x: 0, y: 36, z: -720 }),
});

/** The galactic band: a constant great circle (the sky does not move when the window resizes). */
export const BAND_NORMAL = Object.freeze({ x: 0.458, y: 0.889, z: 0 });

const HERO_DEPTH = 3600;
const SECONDARY_DEPTH = 5200;
const BINARY_DEPTH = 6000;
const WITNESS_DEPTH = 4500;
const HERO_BASE_DIAMETER_H = 0.27;
const HERO_LEVEL_GROWTH_H = 0.004;
const MOON_DIAMETER_H = 0.05;
const MOON_ORBIT_FACTOR = 1.185; // × hero radius
const SECONDARY_DIAMETER_H = 0.11;
const SECONDARY_RING_OUTER = 2.2; // × secondary radius
const EDGE_MARGIN_H = 0.03;
const CARD_GAP_H = 0.1;
const ROAD_EDGE_X = 100;
const RING_RADIUS = 260;
/** Beyond the deepest ring pool (12 × 350): every ring is shown. */
const RING_POOL_FAR = 4800;

/**
 * Gameplay boards (every board in index.html carries data-player; the lobby's avatar cards
 * reuse .player-card without it and must not veil the sky).
 */
export const BOARD_SELECTOR = '.player-card[data-player]';
export const HUD_SELECTOR = '.single-player-stats-bar';

/** Vertical FOV (degrees) of the Hor+ lens: 60°, with the horizontal FOV capped at 104°. */
export function restVerticalFov(aspect) {
    const a = Math.max(0.1, aspect || 1.78);
    const capped = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(REST_RIG.hFovCap) / 2) / a);
    return Math.min(REST_RIG.fov, THREE.MathUtils.radToDeg(capped));
}

const _eye = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A CSS-px rect → the layout record (H units from the centre, v up, plus screen fractions). */
function toLayoutRect(r, W, H) {
    return {
        u0: (r.left - W / 2) / H,
        u1: (r.right - W / 2) / H,
        v0: (H / 2 - r.bottom) / H,
        v1: (H / 2 - r.top) / H,
        x0: r.left / W,
        y0: r.top / H,
        x1: r.right / W,
        y1: r.bottom / H,
    };
}

/**
 * The solo layout from the stylesheet's own formulas (used when no card is on screen):
 * board = min(clamp(220, 22vw, 300), (100vh − 250)/2); the card is ~1.19·board wide and
 * 2·board + 158 tall; the stats bar sits 60 px right of the stage (stage = min(clamp(300, 35vw,
 * 400), (100vh − 200)/2)), 140 px wide and ~385 px tall.
 */
export function fallbackLayout(width, height) {
    const W = Math.max(1, width || 1);
    const H = Math.max(1, height || 1);
    const board = Math.max(120, Math.min(Math.max(220, Math.min(0.22 * W, 300)), (H - 250) / 2));
    const cw = 1.19 * board;
    const ch = 2 * board + 158;
    const stage = Math.min(Math.max(300, Math.min(0.35 * W, 400)), (H - 200) / 2);
    const hx0 = W / 2 + stage / 2 + 60;
    const hh = Math.min(385, H * 0.5);
    return {
        cardCount: 0,
        card: toLayoutRect({
            left: W / 2 - cw / 2, right: W / 2 + cw / 2, top: H / 2 - ch / 2, bottom: H / 2 + ch / 2,
        }, W, H),
        hud: toLayoutRect({
            left: hx0, right: hx0 + 140, top: H / 2 - hh / 2, bottom: H / 2 + hh / 2,
        }, W, H),
    };
}

/**
 * Read the visible gameplay rects from the DOM. Returns null when no card is visible (menus,
 * boot) — the solver then uses fallbackLayout() for placement and the veil stays off.
 */
export function readLayoutRects(doc = globalThis.document, win = globalThis.window) {
    if (!doc || !win || typeof doc.querySelectorAll !== 'function') return null;
    const W = Math.max(1, win.innerWidth || 1);
    const H = Math.max(1, win.innerHeight || 1);
    const visibleRect = (el) => {
        if (!el || typeof el.getBoundingClientRect !== 'function') return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 8 && r.height > 8)) return null;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H) return null;
        const cs = typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : null;
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)) return null;
        return r;
    };
    const cards = [];
    doc.querySelectorAll(BOARD_SELECTOR).forEach((el) => {
        const r = visibleRect(el);
        if (r) cards.push(r);
    });
    if (!cards.length) return null;
    const union = cards.reduce((acc, r) => ({
        left: Math.min(acc.left, r.left),
        right: Math.max(acc.right, r.right),
        top: Math.min(acc.top, r.top),
        bottom: Math.max(acc.bottom, r.bottom),
    }), {
        left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity,
    });
    const hudRect = visibleRect(doc.querySelector(HUD_SELECTOR));
    return {
        cardCount: cards.length,
        card: toLayoutRect(union, W, H),
        hud: hudRect ? toLayoutRect(hudRect, W, H) : null,
    };
}

/** True when two layouts differ by more than `eps` H anywhere (used for the stability gate). */
export function layoutsDiffer(a, b, eps = 0.004) {
    if (!a || !b) return a !== b;
    if (a.cardCount !== b.cardCount) return true;
    const keys = ['u0', 'u1', 'v0', 'v1'];
    const diff = (p, q) => {
        if (!p || !q) return p !== q;
        return keys.some((k) => Math.abs(p[k] - q[k]) > eps);
    };
    return diff(a.card, b.card) || diff(a.hud, b.hud);
}

export class ChromadelicComposition {
    constructor() {
        this.restCamera = new THREE.PerspectiveCamera(REST_RIG.fov, 16 / 9, 1, 12000);
        this.aspect = 16 / 9;
        this.viewport = { width: 1920, height: 1080 };
        this.tanHalf = Math.tan(THREE.MathUtils.degToRad(REST_RIG.fov) / 2);
        this.level = 1;
        this.layout = null;
        this.mode = 'fallback';
        this.restRotation = new THREE.Matrix4();
        this.result = {
            hero: {
                position: new THREE.Vector3(), radius: 500, visible: true, scale: 1, anchor: { u: -0.5, v: 0.19 },
            },
            moon: { radius: 90, orbitRadius: 600 },
            secondary: {
                position: new THREE.Vector3(), radius: 300, visible: true, anchor: { u: 0.63, v: 0.31 },
            },
            binary: { position: new THREE.Vector3(), direction: new THREE.Vector3(), anchor: { u: 0.43, v: 0.45 } },
            witness: { depth: WITNESS_DEPTH },
            sky: {
                warmDir: new THREE.Vector3(),
                coolDir: new THREE.Vector3(),
                bandNormal: new THREE.Vector3(BAND_NORMAL.x, BAND_NORMAL.y, BAND_NORMAL.z).normalize(),
                vpDir: new THREE.Vector3(0, 0, -1),
            },
            /** Screen-fraction rects (x0, y0, x1, y1; y down) of the card/HUD the masks use. */
            rects: { card: null, hud: null, apron: 0 },
            /** DOM rects for the post veil (null when no board is on screen). */
            veil: { board: null, hud: null },
            zEntry: -150,
            dEmerge: 1120,
            mirrored: false,
            boardClear: true,
        };
        this.solve({ aspect: 16 / 9 });
    }

    /** Pose the rest camera for `aspect` (Hor+). */
    poseRestCamera(aspect) {
        const cam = this.restCamera;
        cam.fov = restVerticalFov(aspect);
        cam.aspect = aspect;
        cam.position.set(REST_RIG.position.x, REST_RIG.position.y, REST_RIG.position.z);
        cam.up.set(0, 1, 0);
        cam.lookAt(REST_RIG.focus.x, REST_RIG.focus.y, REST_RIG.focus.z);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        this.tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        _eye.set(REST_RIG.position.x, REST_RIG.position.y, REST_RIG.position.z);
        _focus.set(REST_RIG.focus.x, REST_RIG.focus.y, REST_RIG.focus.z);
        this.restRotation.lookAt(_eye, _focus, _up);
    }

    /** Screen anchor (u, v in H from the centre) at view depth d → world point. */
    anchorToWorld(u, v, d, out = new THREE.Vector3()) {
        const t = this.tanHalf;
        out.set(2 * u * t * d, 2 * v * t * d, -d).applyMatrix4(this.restRotation);
        out.x += REST_RIG.position.x;
        out.y += REST_RIG.position.y;
        out.z += REST_RIG.position.z;
        return out;
    }

    /** Screen anchor → unit world direction from the rest eye. */
    anchorDirection(u, v, out = new THREE.Vector3()) {
        const t = this.tanHalf;
        return out.set(2 * u * t, 2 * v * t, -1).applyMatrix4(this.restRotation).normalize();
    }

    /** A diameter in H at depth d → world radius. */
    radiusAt(diameterH, d) {
        return diameterH * this.tanHalf * d;
    }

    /**
     * @param {object} opts
     * @param {number} opts.aspect
     * @param {number} [opts.level]
     * @param {object|null} [opts.layout]   readLayoutRects() result (null → CSS fallback)
     * @param {{width: number, height: number}} [opts.viewport]  CSS px (for the fallback)
     */
    solve({
        aspect = this.aspect, level = this.level, layout = this.layout, viewport = null,
    } = {}) {
        this.aspect = Math.max(0.5, aspect || 16 / 9);
        this.level = Math.max(1, Math.floor(level || 1));
        this.layout = layout || null;
        if (viewport && viewport.width > 0 && viewport.height > 0) {
            this.viewport = { width: viewport.width, height: viewport.height };
        } else if (Math.abs(this.viewport.width / this.viewport.height - this.aspect) > 1e-3) {
            this.viewport = { width: Math.round(1080 * this.aspect), height: 1080 };
        }
        const a = this.aspect;
        const res = this.result;
        this.poseRestCamera(a);
        const t = this.tanHalf;

        const fallback = fallbackLayout(this.viewport.width, this.viewport.height);
        const effective = layout || fallback;
        const { card } = effective;
        const hud = layout ? layout.hud : fallback.hud;
        this.mode = layout ? 'dom' : 'fallback';

        const wide = Math.max(0, a - 1.78);
        const heroDiameter = HERO_BASE_DIAMETER_H + HERO_LEVEL_GROWTH_H * Math.min(this.level - 1, 10);
        const heroR = heroDiameter / 2;
        const moonOrbitR = heroR * MOON_ORBIT_FACTOR;
        const moonR = MOON_DIAMETER_H / 2;
        const heroExtent = Math.max(heroR, moonOrbitR + moonR);

        // Free zones beside the card (H units). The left zone is the hero's; mirror when the
        // right zone is the bigger one (e.g. an asymmetric multiplayer layout).
        const leftZone = { lo: -a / 2 + EDGE_MARGIN_H, hi: card.u0 - CARD_GAP_H };
        const rightLo = Math.max(card.u1, hud && hud.v1 > 0.2 ? hud.u1 : card.u1) + CARD_GAP_H;
        const rightZone = { lo: rightLo, hi: a / 2 - EDGE_MARGIN_H };
        const leftWidth = leftZone.hi - leftZone.lo;
        const rightWidth = rightZone.hi - rightZone.lo;
        const mirrored = layout !== null && leftWidth < 0.3 && rightWidth > leftWidth + 0.1;
        res.mirrored = mirrored;
        const heroZone = mirrored ? { lo: -rightZone.hi, hi: -rightZone.lo } : leftZone;
        const zoneWidth = heroZone.hi - heroZone.lo;

        let heroScale = 1;
        if (zoneWidth < 2 * heroExtent) heroScale = Math.max(0.7, zoneWidth / (2 * heroExtent));
        if (zoneWidth < 0.3) {
            this.mode = 'reduced';
            heroScale = 0.6;
        }
        const e = heroExtent * heroScale;
        let heroU = -Math.min(0.5 + 0.3 * wide, 0.72);
        heroU = THREE.MathUtils.clamp(heroU, heroZone.lo + e, Math.max(heroZone.lo + e, heroZone.hi - e));
        if (this.mode === 'reduced') heroU = (heroZone.lo + heroZone.hi) / 2;
        const heroV = this.mode === 'reduced' ? 0.3 : 0.19;
        const hu = mirrored ? -heroU : heroU;
        this.anchorToWorld(hu, heroV, HERO_DEPTH, res.hero.position);
        res.hero.radius = this.radiusAt(heroDiameter * heroScale, HERO_DEPTH);
        res.hero.scale = heroScale;
        res.hero.anchor = { u: hu, v: heroV };
        res.moon.radius = this.radiusAt(MOON_DIAMETER_H * heroScale, HERO_DEPTH);
        res.moon.orbitRadius = res.hero.radius * MOON_ORBIT_FACTOR;

        // Secondary (ringed ice giant): opposite the hero, raised until it clears the HUD. Solved
        // in the hero-mirrored frame (s = −1: the card and HUD edges are mirrored too) and hidden
        // when its zone cannot hold it.
        const s = mirrored ? -1 : 1;
        const secExtent = (SECONDARY_DIAMETER_H / 2) * SECONDARY_RING_OUTER;
        const secZoneHi = a / 2 - EDGE_MARGIN_H;
        const secZoneLo = (mirrored ? -card.u0 : card.u1) + 0.02;
        let hudLo = 0;
        let hudHi = 0;
        if (hud) {
            hudLo = mirrored ? -hud.u1 : hud.u0;
            hudHi = mirrored ? -hud.u0 : hud.u1;
        }
        let secU = Math.min(0.63 + 0.3 * wide, 0.9);
        secU = THREE.MathUtils.clamp(secU, secZoneLo + secExtent, Math.max(secZoneLo + secExtent, secZoneHi - secExtent));
        let secV = 0.31;
        if (hud && secU - secExtent < hudHi + 0.02 && secU + secExtent > hudLo - 0.02) {
            secV = Math.max(secV, hud.v1 + 0.02 + secExtent * 0.45);
        }
        secV = Math.min(secV, 0.5 - EDGE_MARGIN_H - secExtent * 0.45);
        const su = s * secU;
        this.anchorToWorld(su, secV, SECONDARY_DEPTH, res.secondary.position);
        res.secondary.radius = this.radiusAt(SECONDARY_DIAMETER_H, SECONDARY_DEPTH);
        res.secondary.visible = this.mode !== 'reduced' && secZoneHi - secZoneLo >= 2 * secExtent;
        res.secondary.anchor = { u: su, v: secV };

        // The binary: a distant star pair well clear of the secondary's ring (>= 0.12 H), or in
        // the hero's free zone when the secondary is hidden.
        const binU = res.secondary.visible
            ? su - s * 0.2
            : THREE.MathUtils.clamp(hu + s * (e + 0.12), -a / 2 + EDGE_MARGIN_H, a / 2 - EDGE_MARGIN_H);
        const binV = 0.45;
        this.anchorToWorld(binU, binV, BINARY_DEPTH, res.binary.position);
        this.anchorDirection(binU, binV, res.binary.direction);
        res.binary.anchor = { u: binU, v: binV };

        // Sky masks follow the bodies; the band is constant.
        this.anchorDirection(hu + (mirrored ? 0.12 : -0.12), 0.26, res.sky.warmDir);
        this.anchorDirection(su + s * 0.07, 0.24, res.sky.coolDir);
        res.sky.bandNormal.set(mirrored ? -BAND_NORMAL.x : BAND_NORMAL.x, BAND_NORMAL.y, BAND_NORMAL.z).normalize();

        // Screen-space masks (card/HUD always, from the DOM or the CSS fallback) + the post veil
        // (DOM only: no board on screen → no veil). The fractions are derived from the
        // centre-anchored u/v at the CURRENT aspect, so a width-only resize (which leaves every
        // u/v alone once the board width caps) never keeps the previous window's fractions.
        const toFrac = (r) => ({
            x0: 0.5 + r.u0 / a, x1: 0.5 + r.u1 / a, y0: 0.5 - r.v1, y1: 0.5 - r.v0,
        });
        res.rects.card = toFrac(card);
        res.rects.hud = hud ? toFrac(hud) : null;
        res.rects.apron = Math.max(0, 1 - res.rects.card.y1); // screen fraction of road under the card
        res.veil.board = layout?.card ? { ...res.rects.card } : null;
        res.veil.hud = layout?.hud ? { ...res.rects.hud } : null;

        // Where the road edge slides behind the card, and where rings emerge from behind it. Only
        // a card over the vanishing point hides anything; otherwise every ring is shown and the
        // waves launch from a typical entry depth.
        if (card.u0 < 0 && card.u1 > 0) {
            const uCard = Math.max(0.05, Math.min(-card.u0, card.u1));
            res.zEntry = REST_RIG.position.z - ROAD_EDGE_X / (2 * t * uCard);
            res.dEmerge = RING_RADIUS / (2 * t * uCard);
        } else {
            res.zEntry = -150;
            res.dEmerge = RING_POOL_FAR;
        }

        // Diagnostics: does every footprint clear the card (+24 px at 1080p ≈ 0.022 H)?
        const pad = 0.022;
        const clearOf = (u, v, r) => (u + r + pad < card.u0 || u - r - pad > card.u1
            || v + r + pad < card.v0 || v - r - pad > card.v1);
        res.boardClear = clearOf(hu, heroV, e) && (!res.secondary.visible || clearOf(su, secV, secExtent))
            && clearOf(binU, binV, 0.01);
        return res;
    }

    /** Witness pass (Ultra+): closed-form anchor + diameter for time t, or null while resting. */
    witnessAt(t, out = {
        u: 0, v: 0, diameterH: 0, progress: 0,
    }) {
        const cycle = 195; // 150 s pass + 45 s rest
        const k = Math.floor(t / cycle);
        const local = t - k * cycle;
        if (local > 150) return null;
        const s = local / 150;
        const e = s * s * (3 - 2 * s);
        const right = (k % 2) === 0;
        const m = this.result.mirrored ? -1 : 1;
        if (right) {
            out.u = m * (0.3 + (0.95 - 0.3) * e);
            out.v = 0.33 + (0.52 - 0.33) * e;
        } else {
            out.u = m * (-0.28 + (-0.62 + 0.28) * e);
            out.v = 0.36 + (0.58 - 0.36) * e;
        }
        out.diameterH = 0.024 + (0.09 - 0.024) * e * e;
        out.progress = s;
        return out;
    }

    getDiagnostics() {
        const r = this.result;
        return {
            layout: r.mirrored ? 'mirrored' : this.mode,
            aspect: Number(this.aspect.toFixed(3)),
            vFov: Number(this.restCamera.fov.toFixed(2)),
            level: this.level,
            hero: { anchor: r.hero.anchor, radius: Math.round(r.hero.radius), scale: r.hero.scale },
            secondary: { anchor: r.secondary.anchor, radius: Math.round(r.secondary.radius), visible: r.secondary.visible },
            binary: { anchor: r.binary.anchor },
            zEntry: Math.round(r.zEntry),
            dEmerge: Math.round(r.dEmerge),
            rects: r.rects,
            boardClear: r.boardClear,
        };
    }
}
