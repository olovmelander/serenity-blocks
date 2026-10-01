/**
 * Shifting Sands — composition (CPU only, three-free math + a few THREE helpers).
 *
 * "Arrakis at the twin-sun dusk." The gameplay card covers the centre column, so the picture is
 * built for the two side zones and the strips above/below the card:
 *
 *   LEFT  — contre-jour: the twin suns hang low over the far erg, the dune ridges between the
 *           camera and the suns glow along their crests, and the sandworm breaches here, a black
 *           silhouette against the suns with backlit sand pouring off it.
 *   RIGHT — side light: the Sentinel, a monumental sandstone butte, catches the low sun on its
 *           left flank; the two pale moons ride above it.
 *   BELOW — the near dune slope, wind ripples and grain glitter; the thumper rings cross it.
 *
 * Every direction here is authored for the REST camera (Hor+ lens, 50° vertical, horizontal FOV
 * capped at 100°): directions measured in azimuth (+ right of forward) and elevation do not move
 * with the aspect ratio, so the suns and the butte stay in their zones from 4:3 to 21:9.
 */

import * as THREE from 'three/webgpu';

const DEG = Math.PI / 180;

/** Direction from azimuth (deg, + = right of the forward −Z axis) and elevation (deg). */
export function dirFromAzEl(azDeg, elDeg, out = new THREE.Vector3()) {
    const az = azDeg * DEG;
    const el = elDeg * DEG;
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** The rest camera. The terrain is generated around (x, z) = (0, 0). */
export const REST_RIG = Object.freeze({
    fov: 50,
    hFovCap: 100,
    /** Camera height above the local sand; the absolute y is solved from the terrain. */
    clearance: 36,
    pitchDeg: -4.4,
    near: 2,
    far: 26000,
});

/** Vertical FOV (degrees) of the Hor+ lens: 50°, horizontal FOV capped at 100°. */
export function restVerticalFov(aspect) {
    const a = Math.max(0.1, aspect || 16 / 9);
    const capped = 2 * Math.atan(Math.tan((REST_RIG.hFovCap * DEG) / 2) / a);
    return Math.min(REST_RIG.fov, capped / DEG);
}

/**
 * The twin suns. A is the large ember-gold primary, low on the erg; B is the smaller white-gold
 * companion, higher and to the right. Their elevations differ by ~6°, so every slope whose
 * horizon falls between them is lit by B alone: the double shadows are coloured.
 */
export const SUNS = Object.freeze({
    a: Object.freeze({ az: -30.5, el: 4.6, radiusDeg: 1.75 }),
    b: Object.freeze({ az: -23.5, el: 11.2, radiusDeg: 0.72 }),
});

/** The two moons of Arrakis, pale and veiled, above the Sentinel. */
export const MOONS = Object.freeze({
    a: Object.freeze({ az: 31.0, el: 14.5, radiusDeg: 1.9 }),
    b: Object.freeze({ az: 38.5, el: 11.0, radiusDeg: 0.85 }),
});

/**
 * The prevailing wind blows from the camera toward the suns (downwind = toward azimuth −27°):
 * the gentle windward slopes face the viewer and take the low light at grazing angles (the
 * Journey sheen), the steep slip faces turn toward the suns and hide behind the crests.
 */
export const WIND = Object.freeze({ azDeg: -27 });

export function windDirXZ() {
    const az = WIND.azDeg * DEG;
    return { x: Math.sin(az), z: -Math.cos(az) };
}

/** The Sentinel: the hero butte in the right zone. */
export const SENTINEL = Object.freeze({
    az: 30.5, dist: 2350, height: 430, radius: 165,
});

/**
 * Where the worm breaches (left zone, in front of the suns). The breach arc runs mostly across
 * the view with a component toward the camera, so the maw is seen in three-quarter view.
 */
export const BREACH = Object.freeze({
    az: -19.5,
    dist: 980,
    /** Horizontal travel direction (azimuth of motion in the ground plane). */
    headingDeg: -112,
});

/** World position (y = 0) at azimuth/distance from the rest camera's ground point. */
export function groundPointAt(azDeg, dist, out = new THREE.Vector3()) {
    const az = azDeg * DEG;
    return out.set(Math.sin(az) * dist, 0, -Math.cos(az) * dist);
}

/**
 * Gameplay boards (every board in index.html carries data-player; the lobby's avatar cards reuse
 * .player-card without it) and the solo stats bar. Same selectors as the other overhauled themes.
 */
export const BOARD_SELECTOR = '.player-card[data-player]';
export const HUD_SELECTOR = '.single-player-stats-bar';

/** A CSS-px rect → screen fractions (x0, y0, x1, y1; y down). */
function toFractions(r, W, H) {
    return {
        x0: r.left / W, y0: r.top / H, x1: r.right / W, y1: r.bottom / H,
    };
}

/**
 * The solo layout from the stylesheet's own formulas (public/styles/main.css), used before a card
 * is on screen: board = min(clamp(220, 22vw, 300), (100vh − 250)/2), card ≈ 1.19·board wide and
 * 2·board + 158 tall, the stats bar 60 px right of the stage.
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
        card: toFractions({
            left: W / 2 - cw / 2, right: W / 2 + cw / 2, top: H / 2 - ch / 2, bottom: H / 2 + ch / 2,
        }, W, H),
        hud: toFractions({
            left: hx0, right: hx0 + 140, top: H / 2 - hh / 2, bottom: H / 2 + hh / 2,
        }, W, H),
    };
}

/**
 * Read the visible gameplay rects from the DOM (screen fractions). Returns null when no board is
 * visible (menus, boot): the post then keeps its calm rects off.
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
        if (r) cards.push(toFractions(r, W, H));
    });
    if (!cards.length) return null;
    const hudRect = visibleRect(doc.querySelector(HUD_SELECTOR));
    return {
        cardCount: cards.length,
        cards,
        hud: hudRect ? toFractions(hudRect, W, H) : null,
    };
}

/** True when two layout reads differ by more than eps (screen fractions). */
export function layoutsDiffer(a, b, eps = 0.004) {
    if (!a || !b) return a !== b;
    if (a.cardCount !== b.cardCount) return true;
    const rectDiff = (r, s) => {
        if (!r || !s) return r !== s;
        return Math.abs(r.x0 - s.x0) > eps || Math.abs(r.y0 - s.y0) > eps
            || Math.abs(r.x1 - s.x1) > eps || Math.abs(r.y1 - s.y1) > eps;
    };
    for (let i = 0; i < a.cards.length; i++) {
        if (rectDiff(a.cards[i], b.cards[i])) return true;
    }
    return rectDiff(a.hud, b.hud);
}
