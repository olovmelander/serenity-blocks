/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Level-node (orb) materials — TSL/WebGPU.
 *
 * THE ORB IS A WORLD IN A GLASS MARBLE (2026-10-23 redesign; the bench is
 * src/playground/effects/odyssey-orb-design.effect.js, which draws these same builders).
 * The orb used to show its theme icon UV-wrapped round a wobbling sphere and re-graded to the
 * chapter hue, inside a faint shell, a faceted icosahedron halo, two flat rings and a cloud of
 * sparkles: at play size every orb read as the same beige or gold lump. Now:
 *
 *   1. glass   — the per-instance clear-glass marble (InstancedMesh): a fresnel rim in the
 *                chapter light (brightness by state), one sharp glint, light gathered in the
 *                lower rim, the selection ring. Transparent, no depth write; picked by raycast.
 *   2. window  — the level's world: its theme icon in the icon's own colours on a
 *                camera-facing disc inside the glass, seen through a ball lens, drifting and
 *                glinting (instanced quads). Locked, it sleeps behind frost with a padlock
 *                etched in it. Opaque and depth-writing: it hides the rail threaded through
 *                the orb. Levels without an icon keep the procedural magma core.
 *   3. halo    — a smooth corona hugging the glass (instanced quads, so no facets): none when
 *                locked, a whisper when open, warm when completed, breathing and widest on
 *                the current orb, beat-pulsed.
 *   4. stars   — vector stars (an SDF, crisp at any size) arced over a completed orb; a slot
 *                still to earn is a pale outline, not a dimmed gold star.
 *
 * State is told by BRIGHTNESS and SHAPE, never by hue — the hue belongs to the chapter:
 *   locked    frosted window with an etched padlock, dim rim, no halo
 *   unlocked  the world awake, a quiet rim and a whisper of halo
 *   current   light breathing at ~0.5 Hz, the brightest rim and the biggest halo
 *   completed a warm glow and the stars
 *   selected  a crisp ring (hover: a faint one)
 *
 * createFluidInnerTSL (the per-node sphere core) is kept for the `?odysseyCoreInstanced=0`
 * opt-out and the standalone pilot page.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    max,
    min,
    mix,
    mod,
    normalize,
    normalView,
    normalLocal,
    oneMinus,
    positionLocal,
    positionView,
    pow,
    sign,
    sin,
    smoothstep,
    step,
    texture,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import { hash21, snoise3 } from './chapter-environments/shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './chapter-environments/shared/odyssey-tsl-billboard.js';

// Geometry constants mirror LevelNodeManager.js so the pilot reproduces orb sizes.
const GLASS_ORB_SCALE = 1.4;
const GLASS_INNER_RADIUS = 0.95 * GLASS_ORB_SCALE;
const GLASS_OUTER_RADIUS = 1.0 * GLASS_ORB_SCALE;
const INNER_FLOW_STRENGTH = 0.28;
const INNER_WOBBLE_STRENGTH = 0.028;

/**
 * The world window: a disc of this share of the glass radius, set ORB_WINDOW_DEPTH of the
 * radius toward the eye. It stays inside the sphere (√(0.92² + 0.35²) = 0.98), and the rail
 * threaded through the orb's centre passes behind it: the bead's string vanishes into the
 * marble and comes out the far side.
 */
export const ORB_WINDOW_SHARE = 0.92;
export const ORB_WINDOW_DEPTH = 0.35;
/** The halo quad's half-size in glass radii; the corona fades to nothing well inside it. */
export const ORB_HALO_SPAN = 2.1;
/**
 * The stars over a completed orb, in glass radii along camera-right / camera-up / toward the
 * eye: an arc resting on the marble's crown. ORB_STAR_SIZE is a star's width in glass radii.
 */
export const ORB_STAR_SLOTS = Object.freeze([
    Object.freeze({ right: -0.68, up: 1.01, toward: 0.65 }),
    Object.freeze({ right: 0.0, up: 1.24, toward: 0.7 }),
    Object.freeze({ right: 0.68, up: 1.01, toward: 0.65 }),
]);
export const ORB_STAR_SIZE = 0.42;

const WARM_FILL = vec3(1.0, 0.78, 0.44);

/** 0..1 breathing at 0.5 Hz (one breath every two seconds). */
function breathe(uTime) {
    return sin(uTime.mul(Math.PI)).mul(0.5).add(0.5);
}

// ── The glass marble ───────────────────────────────────────────────────────────

/**
 * Per-instance clear-glass shell: a rim light in the chapter's light (brightness by state), a
 * soft window highlight with a sharp glint up and to the left, the light gathered in the
 * lower rim, and the selection ring. A perfect sphere: the per-world shell displacements it
 * used to carry (ribs, steps, ripples) broke the marble's outline round the round window.
 * @param {*} [uTime] shared time uniform
 */
export function createGlassShellTSL(uTime = uniform(0)) {
    const aState = attribute('aState', 'vec4'); // x:locked y:completed z:hovered+2*current w:selected
    const aNodeColor = attribute('aNodeColor', 'vec3');
    const aNodeAccentColor = attribute('aNodeAccentColor', 'vec3');

    const vViewPosition = varying(positionView.negate());
    const uLocked = aState.x;
    const uCompleted = aState.y;
    const uCurrent = step(1.5, aState.z);
    const uHovered = aState.z.sub(uCurrent.mul(2.0));
    const uSelected = aState.w;

    // Pure expressions, rebuilt per slot: colour and opacity must be STANDALONE graphs. A
    // single Fn feeding both slots (rgb / a of one vec4) left the opacity reading a var the
    // colour build had assigned — the shell rendered fully transparent.
    const glassTerms = () => {
        const n = normalize(normalView);
        const ndv = abs(dot(n, normalize(vViewPosition)));
        const fresnel = pow(oneMinus(ndv), 3.0);
        // The key light, fixed in view space up and to the left (MeshBasic: faked), well inside
        // the rim: out at the edge its window highlight merged with the selection ring into
        // what read as a chip out of the world window.
        const nl = max(dot(n, normalize(vec3(-0.38, 0.5, 0.78))), 0.0);
        const glint = pow(nl, 140.0).mul(1.6);
        const softWindow = smoothstep(0.88, 0.98, nl).mul(0.2);
        const highlight = glint.add(softWindow).mul(mix(1.0, 0.55, uLocked));
        // Light through the ball focusing at its far, lower edge.
        const lower = smoothstep(-0.2, -0.85, n.y).mul(fresnel).mul(0.55);
        // Rim strength: locked 0.4, open 0.75, current 1.0..1.25 breathing.
        const strength = mix(
            mix(float(0.75), breathe(uTime).mul(0.25).add(1.0), uCurrent),
            float(0.4),
            uLocked,
        );
        const rimTint = mix(mix(aNodeColor, vec3(1.0), 0.35), WARM_FILL, uCompleted.mul(0.7));
        // Selection ring: a crisp line round the world window, between its edge and the
        // silhouette (screen radius ~0.95-0.99 of the glass; hover: a faint one). A wider band
        // lay over the window's rim as a flat bezel once the post stack whitened it.
        const edge = oneMinus(ndv);
        const ring = smoothstep(0.66, 0.72, edge).mul(oneMinus(smoothstep(0.84, 0.9, edge)))
            .mul(max(uSelected, uHovered.mul(0.35)));
        const rim = fresnel.mul(1.35).add(lower).mul(strength);

        const col = rimTint.mul(rim)
            .add(vec3(highlight))
            .add(mix(aNodeAccentColor, vec3(1.0), 0.5).mul(ring).mul(0.9));
        const alpha = clamp(
            fresnel.mul(0.75).add(lower).mul(strength).add(highlight)
                .add(ring.mul(0.8))
                .add(0.03),
            0.0,
            1.0,
        );
        return { col: min(col, vec3(1.0)), alpha };
    };

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => glassTerms().col)();
    material.opacityNode = Fn(() => glassTerms().alpha)();
    material.transparent = true;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(GLASS_OUTER_RADIUS, 32, 32);
    return { material, geometry, uniforms: { uTime } };
}

// ── The halo ───────────────────────────────────────────────────────────────────

/**
 * The orb's halo as instanced camera-facing quads (a smooth corona; the icosahedron shell it
 * replaces showed its facets). Per instance: aHalo (xyz the orb's centre in world space, w its
 * glass radius in world units; 0 hides it), aColor (the chapter light), aState (locked,
 * hovered + 2*selected, current, completed). Draw with makeQuadInstancedGeometry + a Mesh.
 * @param {*} [uTime] shared time uniform
 * @param {*} [uBeatPulse] director beat pulse (the current orb's halo)
 */
export function createOrbHaloTSL(uTime = uniform(0), uBeatPulse = uniform(0)) {
    const aHalo = attribute('aHalo', 'vec4');
    const vColor = varying(attribute('aColor', 'vec3'));
    const vState = varying(attribute('aState', 'vec4'));

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aHalo.xyz, aHalo.w.mul(ORB_HALO_SPAN * 2));
    material.colorNode = Fn(() => {
        const locked = vState.x;
        const selected = step(1.5, vState.y);
        const hovered = vState.y.sub(selected.mul(2.0));
        const current = vState.z;
        const completed = vState.w;
        const r = length(uv().mul(2.0).sub(1.0)).mul(ORB_HALO_SPAN); // in glass radii
        // Tighter round a resting orb, widest round the current one; nothing at the quad's edge.
        const reach = mix(float(4.6), float(3.0), current);
        const corona = exp(r.sub(1.0).max(0.0).mul(reach).negate())
            .mul(smoothstep(0.96, 1.02, r))
            .mul(smoothstep(ORB_HALO_SPAN, ORB_HALO_SPAN * 0.72, r));
        // (The current orb's is tuned in-game: the post stack's bloom doubles its reach.)
        const strength = mix(
            mix(float(0.2), float(0.24), completed),
            breathe(uTime).mul(0.22).add(0.4).add(uBeatPulse.mul(0.2)),
            current,
        ).add(hovered.mul(0.12)).add(selected.mul(0.1)).mul(oneMinus(locked));
        const tint = min(mix(vColor, WARM_FILL, completed.mul(0.8)), vec3(1.0));
        return tint.mul(corona).mul(strength);
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    // A camera-facing quad: one side, one pass (see the stars' note).
    material.forceSinglePass = true;
    return { material, uniforms: { uTime, uBeatPulse } };
}

// ── The world window ───────────────────────────────────────────────────────────

/** Rounded-box SDF (half extents `b`, corner radius `r`). */
function sdRoundBox(p, b, r) {
    const q = abs(p).sub(b).add(r);
    return length(max(q, 0.0)).add(min(max(q.x, q.y), 0.0)).sub(r);
}

/**
 * The padlock etched into a locked window, as one SDF in window units (the disc's radius is
 * 1): a rounded body, a shackle arch over it, the keyhole cut through.
 */
function sdPadlock(p) {
    const body = sdRoundBox(p.sub(vec2(0.0, -0.17)), vec2(0.3, 0.22), 0.07);
    const arc = p.sub(vec2(0.0, 0.05));
    const shackleArc = abs(length(arc).sub(0.19)).sub(0.06);
    const shackleLegs = max(abs(abs(arc.x).sub(0.19)).sub(0.06), arc.y.negate().sub(0.12));
    const shackle = mix(shackleLegs, shackleArc, step(0.0, arc.y));
    const keyhole = min(
        length(p.sub(vec2(0.0, -0.12))).sub(0.055),
        sdRoundBox(p.sub(vec2(0.0, -0.21)), vec2(0.025, 0.07), 0.02),
    );
    return max(min(body, shackle), keyhole.negate());
}

/**
 * The level's world on a camera-facing disc inside the glass (instanced quads). Per instance:
 * aWindow (xyz the orb's centre in world space, w its glass radius in world units; 0 hides
 * it) and the packed aCore:
 *   aCore.x = layer + 0.5 (icon) or -1 (no icon: the procedural magma core)
 *   aCore.y = per-level seed
 *   aCore.z = state bits: locked | completed<<1 | hovered<<2 | selected<<3 | current<<4
 *   aCore.w = 5-5-5 packed chapter light (the magma fallback and the padlock's tint)
 * The icon keeps its own palette — it is the theme's painted art, and a pink world in the lava
 * chapter is the point, not a clash. Draw with makeQuadInstancedGeometry + a Mesh.
 * @param {THREE.DataArrayTexture|null} arrayTexture the theme-icon atlas (one icon per layer)
 * @param {*} [uTime] shared time uniform
 */
export function createOrbWindowTSL(arrayTexture, uTime = uniform(0)) {
    const hasAtlas = arrayTexture?.isTexture === true;
    const aWindow = attribute('aWindow', 'vec4');
    const aCore = attribute('aCore', 'vec4');

    // DECODE IN THE VERTEX STAGE, FROM ROUNDED INTEGERS. An instance constant arrives as
    // 9.9999 on some pixels and 10.0001 on others: floor/fract per fragment flipped a bit
    // (the locked bit speckled a selected core with dark frost). Round first, per vertex.
    const bit = (zi, k) => mod(floor(zi.div(2 ** k)), 2.0);
    const stateZ = floor(aCore.z.add(0.5));
    const seed = varying(aCore.y);
    const layer = varying(floor(aCore.x)); // valid only when x >= 0 (x = layer + 0.5)
    const useTexture = varying(step(float(0.0), aCore.x));
    const locked = varying(bit(stateZ, 0));
    const completed = varying(bit(stateZ, 1));
    const hovered = varying(bit(stateZ, 2));
    const selected = varying(bit(stateZ, 3));
    const current = varying(bit(stateZ, 4));
    const fw = floor(aCore.w.add(0.5));
    const fbR = floor(fw.div(1024.0));
    const fbG = floor(fw.div(32.0)).sub(fbR.mul(32.0));
    const fbB = fw.sub(floor(fw.div(32.0)).mul(32.0));
    const tint = varying(vec3(fbR, fbG, fbB).div(31.0));

    const material = new THREE.MeshBasicNodeMaterial();
    const toEye = normalize(cameraPosition.sub(aWindow.xyz));
    material.positionNode = billboardWorld(
        aWindow.xyz.add(toEye.mul(aWindow.w.mul(ORB_WINDOW_DEPTH))),
        aWindow.w.mul(ORB_WINDOW_SHARE * 2),
    );
    material.colorNode = Fn(() => {
        const p = uv().mul(2.0).sub(1.0); // the disc, radius 1, y up
        const r = length(p);
        const life = oneMinus(locked);
        // Detail that would shimmer below a few pixels (the glints, the frost grain) fades
        // out as the orb gets small on screen: disc units per pixel.
        const fine = smoothstep(0.03, 0.012, fwidth(p.x));

        // The ball lens: the middle of the world magnified, its edge drawn in toward the rim,
        // and a slow drift as if the world turned inside (still when locked: it sleeps).
        const lens = mix(float(0.74), float(1.0), r.mul(r));
        const drift = vec2(sin(uTime.mul(0.11).add(seed)), sin(uTime.mul(0.083).add(seed.mul(1.7))))
            .mul(0.025).mul(life);
        const src = p.mul(lens).mul(0.96).add(drift).mul(0.5)
            .add(0.5);
        // The atlas rows run top-down (canvas order), the quad's v runs up.
        const iconUv = clamp(vec2(src.x, oneMinus(src.y)), vec2(0.002), vec2(0.998));
        // ROUND, never truncate: the layer arrives interpolated as 4.9999 on some pixels, and
        // toInt() truncating it drew those pixels from the NEIGHBOURING icon — two worlds
        // speckled together in one orb. (The shipped core sampled with layerF.toInt().)
        const icon = hasAtlas
            ? texture(arrayTexture, iconUv).depth(layer.add(0.5).toInt()).rgb
            : vec3(0.5);
        const magma = mix(
            tint.mul(0.36),
            vec3(0.92, 0.24, 0.045),
            smoothstep(0.24, 0.86, snoise3(vec3(p.mul(1.7), uTime.mul(0.12)).add(seed)).mul(0.5).add(0.5))
                .mul(0.58),
        );
        const world = mix(magma, icon, useTexture).toVar();
        const luma = dot(world, vec3(0.2126, 0.7152, 0.0722));

        // Caustic glints drifting through the glass (an awake world only).
        const g = vec2(p.x.mul(5.0).add(uTime.mul(0.21)), p.y.mul(5.0).sub(uTime.mul(0.17)).add(seed));
        const glint = smoothstep(0.08, 0.0, length(fract(g).sub(0.5))).mul(step(0.86, hash21(floor(g))));
        world.addAssign(vec3(1.0, 0.97, 0.9).mul(glint).mul(0.55).mul(life)
            .mul(fine));
        // The glass's thickness: the world darkens and cools into the rim.
        world.assign(mix(world, world.mul(vec3(0.42, 0.48, 0.62)), smoothstep(0.62, 1.0, r).mul(0.85)));

        // Awake: open a little quieter, current breathing light from inside, completed warm-lit.
        const awake = world.mul(mix(float(0.86), breathe(uTime).mul(0.14).add(1.0), current));
        const lit = mix(awake, awake.mul(vec3(1.08, 1.0, 0.86)).add(vec3(0.05, 0.035, 0.0)), completed);

        // Locked: asleep behind frost (a soft cool cloud and the finest grain), the world a
        // faint silhouette through it, and a padlock etched into the frost in the chapter light.
        const cloud = snoise3(vec3(p.mul(2.6), seed)).mul(0.5).add(0.5);
        const grain = hash21(floor(p.mul(140.0)).add(seed)).mul(0.025).mul(fine);
        const frost = vec3(mix(float(0.05), float(0.16), cloud).add(grain)).mul(vec3(0.82, 0.9, 1.0));
        const asleep = mix(vec3(luma), world, 0.15).mul(0.3).add(frost).toVar();
        const lockP = p.div(1.12);
        const lockD = sdPadlock(lockP);
        const aa = clamp(fwidth(lockD), 0.004, 0.08);
        // The etch's shadow first (offset down-right), then the glyph.
        asleep.mulAssign(oneMinus(smoothstep(aa, aa.negate(), sdPadlock(lockP.sub(vec2(0.018, -0.026)))).mul(0.45)));
        const glyph = mix(vec3(0.88, 0.92, 1.0), tint, 0.4).mul(0.62);
        asleep.assign(mix(asleep, glyph, smoothstep(aa, aa.negate(), lockD).mul(0.85)));

        const color = mix(lit, asleep, locked);
        return color.mul(hovered.mul(0.1).add(selected.mul(0.06)).add(1.0));
    })();
    // Cut to its circle: opaque and depth-writing (one pipeline, no blending).
    material.opacityNode = step(length(uv().mul(2.0).sub(1.0)), float(1.0));
    material.alphaTest = 0.5;
    return { material, uniforms: { uTime } };
}

// ── The stars ──────────────────────────────────────────────────────────────────

/** Inigo Quilez's five-point star SDF: outer radius `r`, inner radius factor `rf`. */
function sdStar5(p, r, rf) {
    const k1 = vec2(0.809016994375, -0.587785252292);
    const k2 = vec2(-0.809016994375, -0.587785252292);
    const q = vec2(abs(p.x), p.y).toVar();
    q.subAssign(k1.mul(max(dot(k1, q), 0.0).mul(2.0)));
    q.subAssign(k2.mul(max(dot(k2, q), 0.0).mul(2.0)));
    q.assign(vec2(abs(q.x), q.y.sub(r)));
    const ba = vec2(k1.y.negate(), k1.x).mul(rf).sub(vec2(0.0, 1.0));
    const h = clamp(dot(q, ba).div(dot(ba, ba)), 0.0, r);
    return length(q.sub(ba.mul(h))).mul(sign(q.y.mul(ba.x).sub(q.x.mul(ba.y))));
}

/**
 * The stars over a completed orb (an InstancedMesh of camera-facing planes). Per instance
 * aStar: 1 a star earned — gold, rimmed in warm white, with a soft glow — 0 a slot still to
 * earn: a pale outline round dark glass. Vector-drawn, so it stays crisp at any size.
 */
export function createOrbStarsTSL() {
    const earned = varying(attribute('aStar', 'float'));
    const starTerms = () => {
        const p = uv().mul(2.0).sub(1.0);
        const d = sdStar5(p, 0.84, 0.46).sub(0.06);
        const aa = clamp(fwidth(d).mul(0.75), 0.004, 0.2);
        const cover = smoothstep(aa, aa.negate(), d);
        // Earned: a gold gradient, lighter at the top, a warm-white rim and a soft glow.
        // (Deep: the post stack's ACES lifts a lighter gold to a pale cream.)
        const gold = mix(vec3(0.88, 0.4, 0.04), vec3(1.0, 0.8, 0.3), smoothstep(-0.7, 0.75, p.y));
        const rim = smoothstep(-0.2, -0.08, d);
        const won = mix(gold, vec3(1.0, 0.96, 0.84), rim.mul(0.7));
        const glow = exp(max(d, 0.0).mul(-9.0)).mul(oneMinus(cover)).mul(0.35);
        // To earn: an outline of pale light round a dark glass slot.
        const outline = cover.mul(smoothstep(-0.2, -0.1, d));
        const slot = mix(vec3(0.08, 0.09, 0.13), vec3(0.78, 0.83, 0.96), outline);
        const col = mix(slot, mix(vec3(1.0, 0.8, 0.4), won, cover), earned);
        const alpha = mix(cover.mul(0.4).add(outline.mul(0.45)), cover.add(glow), earned);
        return { col, alpha: clamp(alpha, 0.0, 1.0) };
    };
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => starTerms().col)();
    material.opacityNode = Fn(() => starTerms().alpha)();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // FLAT SURFACE, ONE PASS (plan item: forceSinglePass audit, 2026-08-22). `transparent +
    // DoubleSide` makes three draw the object TWICE — BackSide then FrontSide — which exists so
    // a CLOSED transparent shell sorts against itself; a plane only re-shades the same pixels
    // and compiles a second pipeline.
    material.forceSinglePass = true;
    return { material };
}

// ── Core grading ───────────────────────────────────────────────────────────────

/**
 * The level's theme icon, re-graded into the chapter: its structure (luminance) survives,
 * its hue becomes the chapter's. A pink theme icon no longer fights the lava world — it
 * reads as ember-lit glass in ch1, plankton-lit in ch2, and so on.
 */
function gradeIconToChapter(icon, tint) {
    const lum = dot(icon, vec3(0.299, 0.587, 0.114));
    const graded = tint.mul(lum.mul(0.8).add(0.38));
    return mix(icon, graded, 0.8);
}

/**
 * Shared core state response (brightness, never hue): locked dims to ~35 % and frosts,
 * the current node breathes an inner light at 0.5 Hz, completed carries a warm fill.
 */
function applyCoreState(color, {
    locked, completed, hovered, selected, current, tint, uTime,
}) {
    const luma = dot(color, vec3(0.299, 0.587, 0.114));
    // Frost: desaturate toward a cool milky luminance.
    color.assign(mix(color, vec3(luma).mul(vec3(0.92, 0.96, 1.0)).add(tint.mul(0.05)), locked.mul(0.8)));
    color.mulAssign(mix(1.0, 0.35, locked));
    color.addAssign(WARM_FILL.mul(completed).mul(0.16));
    color.mulAssign(current.mul(breathe(uTime).mul(0.45).add(0.1)).add(1.0));
    color.mulAssign(hovered.mul(0.10).add(selected.mul(0.06)).add(1.0));
}

// ── Inner fluid theme-icon core (opaque; NOT bloom-eligible) ─────────────────────

/**
 * The per-node inner core. Vertex wobble along the normal; the fragment swirls UVs and
 * either samples the theme-icon texture (uUseTexture > 0.5) or uses the flat fallback
 * colour. `map` may be null for the standalone harness — then the procedural fallback
 * path is used unconditionally (no texture node is created without a real texture).
 * Port of createFluidInnerMaterial.
 *
 * @param {THREE.Texture|null} map per-node icon texture (or null → fallback only)
 * @param {THREE.Color} [chapterColor] fallback colour
 * @param {number} [levelId] level id (drives the deterministic uSeed)
 * @param {object} [uTime] shared time uniform
 */
export function createFluidInnerTSL(
    map = null,
    chapterColor = new THREE.Color(0xffffff),
    levelId = 1,
    uTime = uniform(0),
) {
    const hasTexture = Boolean(map);
    const seed = ((levelId || 1) * 0.61803398875) % 1000;

    const uUseTexture = uniform(hasTexture ? 1.0 : 0.0);
    const uFallbackColor = uniform(chapterColor.clone());
    const uSeed = uniform(seed);
    const uFlowStrength = uniform(INNER_FLOW_STRENGTH);
    const uWobbleStrength = uniform(INNER_WOBBLE_STRENGTH);
    const uLocked = uniform(0.0);
    const uCompleted = uniform(0.0);
    const uHovered = uniform(0.0);
    const uSelected = uniform(0.0);

    // ── Vertex: wobble along the normal ──
    const vertexSpeed = mix(0.22, 1.25, oneMinus(uLocked));
    const vPhase = uTime.mul(vertexSpeed).add(uSeed);
    const waveA = sin(vPhase.add(positionLocal.y.mul(7.0)).add(positionLocal.x.mul(5.0)));
    const waveB = cos(vPhase.mul(0.8).add(positionLocal.z.mul(6.0)).sub(positionLocal.y.mul(4.0)));
    const wobble = waveA.add(waveB.mul(0.65)).mul(uWobbleStrength);
    const positionNode = positionLocal.add(normalLocal.mul(wobble));

    const vViewNormal = normalView;

    // ── Fragment: swirl UVs, then texture-or-fallback colour grading ──
    const colorNode = Fn(() => {
        const baseUv = uv();
        const fragSpeed = mix(0.28, 1.25, oneMinus(uLocked));
        const t = uTime.mul(fragSpeed).add(uSeed);

        const centered = baseUv.sub(0.5);
        const radius = length(centered);

        const flow = vec2(
            sin(baseUv.y.add(t.mul(0.42)).mul(10.0)).add(cos(baseUv.y.mul(1.7).sub(t.mul(0.31)).mul(5.0))),
            cos(baseUv.x.sub(t.mul(0.37)).mul(10.0)).add(sin(baseUv.x.mul(1.4).add(t.mul(0.33)).mul(5.0))),
        );

        const swirlEnvelope = smoothstep(0.75, 0.0, radius);
        const swirlDir = vec2(centered.y.negate(), centered.x);

        const swirledUv = baseUv
            .add(flow.mul(uFlowStrength.mul(0.010)))
            .add(swirlDir.mul(sin(t.mul(1.2).add(radius.mul(11.0))).mul(uFlowStrength).mul(0.05).mul(swirlEnvelope)));
        const clampedUv = clamp(swirledUv, vec2(0.01), vec2(0.99));

        // Texture-or-fallback branch. With no real texture we use a smooth procedural
        // molten core so Chapter 1 keeps round magma balls instead of texture-wrapped
        // cracked theme icons.
        const sampled = hasTexture ? texture(map, clampedUv).rgb : uFallbackColor;
        const fallbackMagma = mix(
            uFallbackColor.mul(0.36),
            vec3(0.92, 0.24, 0.045),
            smoothstep(
                0.24,
                0.86,
                snoise3(vec3(baseUv.mul(3.4), t.mul(0.12)).add(uSeed)).mul(0.5).add(0.5),
            ).mul(0.58),
        );
        const color = mix(fallbackMagma, gradeIconToChapter(sampled, uFallbackColor), step(0.5, uUseTexture))
            .toVar();
        applyCoreState(color, {
            locked: uLocked,
            completed: uCompleted,
            hovered: uHovered,
            selected: uSelected,
            current: float(0.0),
            tint: uFallbackColor,
            uTime,
        });
        const rim = pow(oneMinus(abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)))), 2.2);
        color.addAssign(rim.mul(0.08));
        return color;
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.side = THREE.FrontSide;
    material.transparent = false;
    material.toneMapped = true;

    const geometry = new THREE.SphereGeometry(GLASS_INNER_RADIUS, 32, 32);
    return {
        mesh: null,
        material,
        geometry,
        uniforms: {
            uTime,
            uUseTexture,
            uFallbackColor,
            uSeed,
            uFlowStrength,
            uWobbleStrength,
            uLocked,
            uCompleted,
            uHovered,
            uSelected,
        },
    };
}

// ── Standalone pilot assembler ───────────────────────────────────────────────────

/**
 * Build a small row of orbs — instanced glass, the halo quads and one procedural inner core
 * per orb — into a Group sharing one uTime uniform, for the graph-construct smoke test and the
 * standalone WebGPU pilot validation page. (The world window needs the theme-icon atlas, which
 * only the manager builds; the pilot keeps the atlas-free magma cores.) Mirrors
 * createDeepOceanPilotTSL.
 *
 * @param {object} [opts]
 * @param {number} [opts.instanceCount] number of orb instances to build
 */
export function createLevelNodesPilotTSL({ instanceCount = 6 } = {}) {
    const uTime = uniform(0);
    const uBeatPulse = uniform(0);

    const group = new THREE.Group();
    group.name = 'level-nodes-pilot-tsl';

    const palette = [
        new THREE.Color(0xff6644),
        new THREE.Color(0x44aaff),
        new THREE.Color(0x66ff99),
        new THREE.Color(0xffcc33),
        new THREE.Color(0xcc66ff),
        new THREE.Color(0xff4488),
    ];
    const x = (i) => (i - (instanceCount - 1) / 2) * 3.2;

    // ── Glass marbles (InstancedMesh with per-instance attributes) ──
    const glass = createGlassShellTSL(uTime);
    const glassMesh = new THREE.InstancedMesh(glass.geometry, glass.material, instanceCount);
    const stateArray = new Float32Array(instanceCount * 4);
    const colorArray = new Float32Array(instanceCount * 3);
    const accentArray = new Float32Array(instanceCount * 3);

    // ── Halo quads ──
    const halo = createOrbHaloTSL(uTime, uBeatPulse);
    const haloArray = new Float32Array(instanceCount * 4);
    const haloStateArray = new Float32Array(instanceCount * 4);

    const matrix = new THREE.Matrix4();
    for (let i = 0; i < instanceCount; i += 1) {
        glassMesh.setMatrixAt(i, matrix.makeTranslation(x(i), 0, 0));
        const c = palette[i % palette.length];
        const a = palette[(i + 1) % palette.length];
        // glass aState: locked / completed / hovered + 2*current / selected
        stateArray.set([0, i % 2, i === 0 ? 2 : 0, i === 1 ? 1 : 0], i * 4);
        colorArray.set([c.r, c.g, c.b], i * 3);
        accentArray.set([a.r, a.g, a.b], i * 3);
        // halo aState: locked / hovered + 2*selected / current / completed
        haloArray.set([x(i), 0, 0, GLASS_OUTER_RADIUS], i * 4);
        haloStateArray.set([0, i === 1 ? 2 : 0, i === 0 ? 1 : 0, i % 2], i * 4);
    }
    glass.geometry.setAttribute('aState', new THREE.InstancedBufferAttribute(stateArray, 4));
    glass.geometry.setAttribute('aNodeColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    glass.geometry.setAttribute('aNodeAccentColor', new THREE.InstancedBufferAttribute(accentArray, 3));
    glassMesh.instanceMatrix.needsUpdate = true;

    const haloGeometry = makeQuadInstancedGeometry(instanceCount, {
        aHalo: { array: haloArray, itemSize: 4 },
        aColor: { array: colorArray, itemSize: 3 },
        aState: { array: haloStateArray, itemSize: 4 },
    });
    const haloMesh = new THREE.Mesh(haloGeometry, halo.material);
    haloMesh.frustumCulled = false;
    group.add(glassMesh, haloMesh);

    // ── Inner fluid cores (one per orb; procedural fallback — no texture) ──
    const innerParts = [];
    for (let i = 0; i < instanceCount; i += 1) {
        const inner = createFluidInnerTSL(null, palette[i % palette.length], i + 1, uTime);
        const innerMesh = new THREE.Mesh(inner.geometry, inner.material);
        innerMesh.position.set(x(i), 0, 0);
        innerMesh.scale.setScalar(ORB_WINDOW_SHARE);
        group.add(innerMesh);
        innerParts.push(inner);
    }

    return {
        group,
        uniforms: { uTime, uBeatPulse },
        dispose() {
            glass.geometry.dispose();
            glass.material.dispose();
            haloGeometry.dispose();
            halo.material.dispose();
            innerParts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createLevelNodesPilotTSL;
