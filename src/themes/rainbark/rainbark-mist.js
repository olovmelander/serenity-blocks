/**
 * Rainbark — the mist floor's geometry: parallax for the analytic mist (§4.6).
 *
 * The mist floor's look is analytic: the air's mist term on everything (rbAir) and the
 * backdrop's billowed top. What this part adds is depth as the camera breathes and the vapour
 * drifts, never the look itself:
 *
 *   sheets  1–6 (by tier) horizontal sheets MIST_SHEETS.span metres across, centred on the camera,
 *           the i-th at tide − 4 + 3i: a drifting lattice noise cut over a wide ramp, each sheet
 *           a few metres of mist thick (alpha 1 − exp(−σM·thickness)), thinner while the mist
 *           clears (the tide clock). Seen within a few degrees of edge-on a sheet fades out (|V.y|),
 *           and over its rim it fades into the backdrop, so a stack of planes never shows its
 *           slices; seen steeply it is held thin (SHEET_STEEP), so it never veils the billows of
 *           the top under it nor draws a step across a trunk it passes; it thins as it climbs
 *           above the tide and near the eye's height, where trunks still vivid would cut it in a
 *           line (a sheet those leave nothing of collapses in the vertex stage). Lit like the
 *           mist's top (brighter toward the sun, cooler seen from below), then through the air:
 *           both per vertex of a SHEET_GRID grid (the air is smooth over a sheet), only the
 *           density per fragment. Premultiplied over.
 *   wisps   0–8 ragged threads of vapour rising out of the mist (0.3 m/s, living 8–14 s), as tall
 *           as the gap between the mist and the eye allows (wispHeight: they hang between the
 *           ranks below the eye), each life standing somewhere new in one of the gaps between the
 *           grove's ranks (mostly the near ones), placed from the resting eye so they stand still
 *           in the world and the breathing camera sees them move against the trunks, and never
 *           within MIST_WISPS.keepOut of the card's screen band (the lanes either side of it; a
 *           life fading out over the band's edge, or with no lane, collapses). More and taller
 *           while the tide rises. A narrow column tapering upward, cut through by curls climbing
 *           faster toward its top; thin vapour in the sun, lit a little brighter toward it, adding
 *           at most MIST_WISPS.lift over the air behind it; at most MIST_WISPS.alpha opaque.
 *
 * Every slot is drawn on every frame; nothing moves on the CPU: both draws are closed form in the
 * clock (u.time, u.tide, u.mistDrift) and the camera, so the scene never changes after it is
 * built. A tier with no wisps (Minimal) builds no wisp draw at all. Both see the air with the flat
 * vapour (no billow reads: a translucent veil would never show them).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    dot,
    exp,
    float,
    floor,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    smoothstep,
    step,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    MIST_SHEETS,
    MIST_WISPS,
    TIDE_LIGHT,
    rbAir,
    rbFxMaterial,
    rbHash21,
    rbHgMix,
    rbInscatter,
    rbLuma,
    rbMistFlat,
    rbMistTop,
    rbPart,
    rbUnderHaze,
} from './rainbark-tsl.js';

/** Render order: after the backdrop (50), before the curls (65). */
const SHEET_ORDER = 60;
const WISP_ORDER = 61;
/** How much a sheet seen from below cools toward the shade haze's hue. */
const SHEET_UNDERSIDE = 0.35;
/** Quads a side of a sheet's grid: its light and air are found per vertex (25 m apart). */
const SHEET_GRID = 24;
/**
 * A sheet seen steeply (|V.y| from `from` to `to`) is held to `cap` alpha and `keep` of its own:
 * there it lies over the top's near billows and crosses the trunks' feet, where a plane veiling
 * more would flatten the one and draw a step on the other.
 */
const SHEET_STEEP = Object.freeze({
    from: 0.16, to: 0.3, keep: 0.25, cap: 0.05,
});
/**
 * The wisps' noise: cells across and up a veil, and how fast its curls climb through it (faster
 * by `faster` toward its top, where the thread frays).
 */
const WISP_NOISE = Object.freeze({
    across: 4.0, up: 7.0, climb: 0.3, faster: 1.5,
});
/**
 * A wisp's thread: a column `body` of its quad wide at its foot (its fall-off over the rest),
 * tapering to `taper` of that at its top, and cut through by the curls over `cut` down to `thin`
 * of itself (ragged, broken into knots and wisps, yet one thread), fraying out over its top
 * `fray` of its height.
 */
const WISP_THREAD = Object.freeze({
    body: Object.freeze([0.1, 0.32]), taper: 0.5, cut: Object.freeze([0.3, 0.72]), thin: 0.35, fray: 0.15,
});

/**
 * A wisp fades out as it shrinks on screen: from a body `wide[1]` pixels across to `wide[0]`, and
 * from `tall[1]` pixels high to `tall[0]` (far off, a thread a few pixels wide reads as a figure).
 */
const WISP_SCREEN = Object.freeze({ wide: Object.freeze([16, 30]), tall: Object.freeze([80, 140]) });

/**
 * The mist's light on a sheet: its top's own light (rbMistTop over the flat field: cream, brighter
 * toward the sun), so a sheet drifting over the vapour is never a darker film on it (§4.6).
 */
function mistLight(u, V) {
    return rbMistTop(u, V, rbMistFlat());
}
/**
 * The wisps' light: thin vapour standing in the sun, the sunlit vapour (`base`, up to `toward` more
 * toward the sun). Where the air behind it is as bright (the cream glow over the near mist) it
 * fades out over `over` of luminance: a thread of vapour never darkens what it stands against.
 */
const WISP_LIGHT = Object.freeze({ base: 1.3, toward: 0.8, over: 0.06 });

/** A unit quad as an instanced geometry, `count` instances of a per-instance attribute. */
function quadGeometry(corners, name, data, size) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size));
    geometry.instanceCount = data.length / size;
    return geometry;
}

/** A grid of `n` × `n` quads over (−1 … 1)² as an instanced geometry, `count` instances of a float. */
function gridGeometry(n, name, data) {
    const corners = [];
    for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) corners.push((2 * i) / n - 1, (2 * j) / n - 1, 0);
    }
    const index = [];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const a = j * (n + 1) + i;
            const b = a + 1;
            const c = a + n + 1;
            index.push(a, b, c, c, b, c + 1);
        }
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
    geometry.setIndex(index);
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, 1));
    geometry.instanceCount = data.length;
    return geometry;
}

/**
 * What a sheet's height leaves of it: thinned to MIST_SHEETS.above as it climbs over the tide,
 * gone near the eye's height and everywhere over it (MIST_SHEETS.eye: seen from below, from inside
 * the mist, a stack of planes would slice every trunk in curved bands; there the vapour is the
 * analytic interior), and thinner while the mist clears (the tide clock's TIDE_LIGHT.sheets). The
 * same in the vertex stage (a sheet with nothing left collapses) and per fragment.
 */
function sheetStrength(u, y) {
    const over = smoothstep(u.tide.add(MIST_SHEETS.climb[0]), u.tide.add(MIST_SHEETS.climb[1]), y);
    const level = smoothstep(MIST_SHEETS.eye[0], MIST_SHEETS.eye[1], u.camPos.y.sub(y));
    const tide = mix(float(TIDE_LIGHT.sheets[0]), float(TIDE_LIGHT.sheets[1]), u.tideHigh);
    // (The Floor drains them with the mist.)
    return mix(float(1.0), float(MIST_SHEETS.above), over).mul(level).mul(tide).mul(float(1.0).sub(u.drain));
}

/**
 * The sheets: one instanced draw of `count` horizontal grids (the instance attribute is the
 * sheet's index), built in the vertex stage round the camera at the tide, lit and seen through the
 * air per vertex.
 */
function createSheets(u, count) {
    const n = Math.max(1, Math.round(count));
    const index = Float32Array.from({ length: n }, (_, i) => i);
    // The grid in its plane: x and y are the two horizontal axes (−1 … 1).
    const geometry = gridGeometry(SHEET_GRID, 'aSheet', index);
    const material = rbFxMaterial('RainbarkMistSheets');
    const aSheet = attribute('aSheet', 'float');
    const vWorld = varying(vec3(0.0), 'rbSheetWorld');
    const vSheet = varying(float(0.0), 'rbSheetIndex');
    const vCol = varying(vec3(0.0), 'rbSheetLight');
    const half = MIST_SHEETS.span / 2;

    material.positionNode = Fn(() => {
        const i = floor(aSheet.add(0.5));
        const y = u.tide.add(MIST_SHEETS.base).add(i.mul(MIST_SHEETS.step)).toVar();
        // What the sheet's height leaves of it (sheetStrength): a sheet with nothing left (near the
        // eye's height, or thinned to nothing) collapses rather than shading the frame for naught.
        const shown = step(0.01, sheetStrength(u, y));
        const P = vec3(
            u.camPos.x.add(positionGeometry.x.mul(half).mul(shown)),
            y,
            u.camPos.z.add(positionGeometry.y.mul(half).mul(shown)),
        ).toVar();
        // Its light and the air in front of it, per vertex: lit like the mist's top; seen from below
        // (the camera inside the mist) a little cooler.
        const V = P.sub(u.camPos).normalize().toVar();
        const lit = mistLight(u, V).toVar();
        const shadeHue = u.col.hazeShade.mul(rbLuma(lit).div(max(rbLuma(u.col.hazeShade), 1e-4)));
        const below = smoothstep(-1.0, 1.0, y.sub(u.camPos.y));
        // (Breaking out on top of the mist, under the haze's light along the same ray: rbUnderHaze.)
        const lowered = rbUnderHaze(u, mix(lit, shadeHue, below.mul(SHEET_UNDERSIDE)), rbInscatter(u, V));
        vCol.assign(rbAir(u, lowered, P, null, { billows: 0 }));
        vWorld.assign(P);
        vSheet.assign(i);
        return P;
    })();

    material.colorNode = Fn(() => {
        const P = vWorld;
        // (An instance's index through a varying: rounded, never trusted to the last bit.)
        const i = floor(clamp(vSheet, 0.0, 8.0).add(0.5));
        const toP = P.sub(u.camPos).toVar();
        const d = max(length(toP), 1e-3);
        const Vy = abs(toP.y.div(d)).toVar();
        // Seen nearly edge-on a sheet fades out (its slices never show); over its rim it gives
        // way to the backdrop's analytic mist; seen steeply it is held thin (SHEET_STEEP).
        const grazing = smoothstep(MIST_SHEETS.grazing[0], MIST_SHEETS.grazing[1], Vy);
        const reach = length(P.xz.sub(u.camPos.xz)).div(half);
        const rim = float(1.0).sub(smoothstep(1.0 - MIST_SHEETS.rim, 1.0, reach));
        const steep = smoothstep(SHEET_STEEP.from, SHEET_STEEP.to, Vy).toVar();
        // Its density: the drifting lattice noise (each sheet a little faster than the one under
        // it), cut over a wide ramp.
        const drift = u.mistDrift.xy.mul(i.mul(MIST_SHEETS.shear).add(1.0));
        const at = vec3(P.xz.add(drift).mul(MIST_SHEETS.scale), i.mul(0.37).add(u.mistDrift.z.mul(MIST_SHEETS.boil)));
        const density = smoothstep(0.25, 0.75, u.noise3(at).x);
        const thick = float(1.0).sub(exp(u.sigmaM.mul(-MIST_SHEETS.thickness)));
        const raw = thick.mul(density).mul(grazing).mul(rim).mul(sheetStrength(u, P.y))
            .mul(mix(float(1.0), float(SHEET_STEEP.keep), steep));
        const alpha = min(raw, mix(float(1.0), float(SHEET_STEEP.cap), steep)).toVar();
        return vec4(max(vCol, vec3(0.0)).mul(alpha), alpha);
    })();

    const part = rbPart('RainbarkMistSheets', geometry, material, SHEET_ORDER);
    part.count = n;
    return part;
}

/**
 * A screen x (fraction) in the lanes either side of the band [x0, x1] kept `keep` clear (laneX's
 * twin), and the lanes' total width (0: no room).
 */
function laneNode(q, x0, x1, keep) {
    const left = max(x0.sub(keep), 0.0);
    const rightFrom = min(x1.add(keep), 1.0);
    const right = max(float(1.0).sub(rightFrom), 0.0);
    const total = left.add(right);
    const at = clamp(q, 0.0, 1.0).mul(total);
    return { x: mix(rightFrom.add(at.sub(left)), at, step(at, left)), total };
}

/**
 * The wisps: one instanced draw of `count` camera-facing threads (the instance attribute holds the
 * slot and its salt), each life placed, sized and kept out of the card band in the vertex stage.
 */
function createWisps(u, count) {
    const n = Math.max(1, Math.round(count));
    const slots = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        slots[i * 2] = i;
        slots[i * 2 + 1] = (i * 7 + 3) % 17;
    }
    // The quad: x across (−½ … ½), y up (0 … 1).
    const geometry = quadGeometry([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 'aWisp', slots, 2);
    const material = rbFxMaterial('RainbarkMistWisps');
    const aWisp = attribute('aWisp', 'vec2');
    const vWorld = varying(vec3(0.0), 'rbWispWorld');
    const vQuad = varying(vec2(0.0), 'rbWispQuad');
    const vLife = varying(vec4(0.0), 'rbWispLife');
    const vShown = varying(float(0.0), 'rbWispShown');
    const { gaps, odds, rising } = MIST_WISPS;
    const H = MIST_WISPS.height;
    // The odds' running sums: a life's gap is how many of them its hash passes.
    const sums = odds.slice(0, -1).map((_, i) => odds.slice(0, i + 1).reduce((a, b) => a + b, 0));
    // The widest the thread's body reaches across its quad (at its foot), for the card's keep-out.
    const bodyShare = 2 * WISP_THREAD.body[1];

    material.positionNode = Fn(() => {
        const slot = floor(aWisp.x.add(0.5));
        const salt = floor(aWisp.y.add(0.5));
        const life = mix(MIST_WISPS.life[0], MIST_WISPS.life[1], rbHash21(vec2(slot.add(0.5), 1.3))).toVar();
        const clock = u.time.add(rbHash21(vec2(slot.add(0.5), 2.7)).mul(life));
        const k = floor(clock.div(life)).toVar();
        const age = clock.sub(k.mul(life)).toVar();
        // Each life somewhere new: a gap between ranks (mostly the near ones), a depth in it, a
        // place across the lanes.
        const h = (c) => rbHash21(vec2(slot.mul(13.7).add(salt), k.mul(0.731).add(c)));
        const hg = h(0.11).toVar();
        const g = sums.reduce((acc, sum) => acc.add(step(sum, hg)), float(0.0));
        const pick = (a, b, c, e) => mix(mix(a, b, step(0.5, g)), mix(c, e, step(2.5, g)), step(1.5, g));
        const lo = pick(gaps[0][0], gaps[1][0], gaps[2][0], gaps[3][0]);
        const hi = pick(gaps[0][1], gaps[1][1], gaps[2][1], gaps[3][1]);
        const depth = mix(lo, hi, h(0.37)).toVar();
        const lane = laneNode(h(0.59), u.cardRect.x, u.cardRect.z, float(MIST_WISPS.keepOut));
        const across = lane.x.mul(2.0).sub(1.0).mul(u.tanHalf.x).mul(depth);
        // The tide drives them: while it rises more lives show, and taller (each life fades in or
        // out over seconds as the share crosses its hash: the tide moves slowly).
        const rise = max(u.tideRise, 0.0).toVar();
        const share = mix(float(rising.share[0]), float(rising.share[1]), rise);
        const lives = smoothstep(h(0.97).sub(0.08), h(0.97).add(0.08), share);
        const tall = rise.mul(rising.tall).add(1.0);
        // Out of the mist and rising (the tide carries its foot up while the water rises), placed
        // from the resting eye: it stands still in the world as the camera breathes. As tall as the
        // gap between the mist and the eye allows (wispHeight's twin), never within H.eye of it.
        const foot = u.tide.sub(MIST_WISPS.sink).add(age.mul(MIST_WISPS.rise)).toVar();
        const full = clamp(u.camY.sub(u.tide).mul(H.per).add(H.add), H.least, H.most);
        const height = min(
            full.mul(mix(float(H.spread[0]), float(H.spread[1]), h(0.83))).mul(tall),
            max(u.camY.sub(H.eye).sub(foot), 0.0),
        ).toVar();
        const width = height.mul(MIST_WISPS.aspect);
        const centre = vec3(across, foot, depth.negate()).toVar();
        // Facing the camera round the vertical (a veil of vapour stands upright).
        const toCam = u.camPos.sub(centre);
        const right = normalize(vec3(toCam.z, 0.0, toCam.x.negate()).add(vec3(1e-5, 0.0, 0.0))).toVar();
        // Kept out of the card's band as the camera actually sees it (the lane maths is the rest
        // lens's), the thread's whole visible body and not only its middle: a life whose body nears
        // the band fades out over keepSoft of screen width, gone at the band's edge; one behind the
        // eye, with no lane, or with no height left under the eye, collapses.
        const middle = centre.add(vec3(0.0, height.mul(0.5), 0.0)).toVar();
        const toScreen = (at) => {
            const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(at, 1.0));
            return vec2(clip.x.div(max(clip.w, 1e-3)).mul(0.5).add(0.5), clip.w);
        };
        const body = right.mul(width.mul(bodyShare / 2));
        const edgeL = toScreen(middle.sub(body));
        const edgeR = toScreen(middle.add(body));
        const keep = MIST_WISPS.keepOut;
        const soft = 2 * MIST_WISPS.keepSoft;
        const outerL = max(edgeL.x, edgeR.x);
        const outerR = min(edgeL.x, edgeR.x);
        const reachesL = smoothstep(u.cardRect.x.sub(keep + soft), u.cardRect.x.sub(keep), outerL);
        const reachesR = float(1.0).sub(smoothstep(u.cardRect.z.add(keep), u.cardRect.z.add(keep + soft), outerR));
        const room = step(1e-3, lane.total).mul(step(1e-3, min(edgeL.y, edgeR.y))).mul(step(0.5, height));
        // Far off a thread shrinks to a wavy figure a few pixels wide: it fades out by its size on
        // screen (WISP_SCREEN), so what shows is a veil of vapour.
        const bodyPx = abs(edgeR.x.sub(edgeL.x)).mul(u.viewport.x);
        const tallPx = height.div(max(edgeL.y, 1e-3)).div(u.tanHalf.y.mul(2.0)).mul(u.viewport.y);
        const sized = smoothstep(WISP_SCREEN.wide[0], WISP_SCREEN.wide[1], bodyPx)
            .mul(smoothstep(WISP_SCREEN.tall[0], WISP_SCREEN.tall[1], tallPx));
        const shown = float(1.0).sub(reachesL.mul(reachesR)).mul(room).mul(lives)
            .mul(sized)
            .toVar();
        const alive = step(1e-3, shown);
        const P = centre.add(right.mul(positionGeometry.x.mul(width).mul(alive)))
            .add(vec3(0.0, positionGeometry.y.mul(height).mul(alive), 0.0)).toVar();
        vWorld.assign(P);
        vQuad.assign(vec2(positionGeometry.x.add(0.5), positionGeometry.y));
        vLife.assign(vec4(age.div(life), slot, salt, k));
        vShown.assign(shown);
        return P;
    })();

    material.colorNode = Fn(() => {
        const st = clamp(vQuad, vec2(0.0), vec2(1.0)).toVar();
        const a01 = clamp(vLife.x, 0.0, 1.0);
        const code = floor(vLife.yzw.add(0.5));
        const seed = code.x.mul(5.31).add(code.y.mul(0.37)).add(code.z.mul(1.93)).toVar();
        // Curls climbing through the thread, faster toward its top (where it frays); the thread
        // wanders with them.
        const climb = u.time.mul(WISP_NOISE.climb).mul(st.y.mul(WISP_NOISE.faster).add(1.0));
        const at = vec3(
            st.x.mul(WISP_NOISE.across).add(seed),
            st.y.mul(WISP_NOISE.up).sub(climb),
            u.mistDrift.z.add(seed.mul(0.17)),
        );
        const curl = u.noise3(at).toVar();
        const wander = curl.y.sub(0.5).mul(0.3);
        // A narrow column, tapering toward its top.
        const taper = mix(float(1.0), float(WISP_THREAD.taper), st.y);
        const off = abs(st.x.sub(0.5).add(wander)).div(taper).toVar();
        const column = float(1.0).sub(smoothstep(WISP_THREAD.body[0], WISP_THREAD.body[1], off));
        // Cut through by the curls (ragged, never an even slab); emerging from the vapour over the
        // tide and fraying out at its top; fading in and out over its life.
        const P = vWorld;
        const curls = smoothstep(WISP_THREAD.cut[0], WISP_THREAD.cut[1], curl.x);
        const cut = mix(float(WISP_THREAD.thin), float(1.0), curls);
        const emerge = smoothstep(u.tide.sub(1.5), u.tide.add(2.5), P.y);
        const rise = emerge.mul(float(1.0).sub(smoothstep(1.0 - WISP_THREAD.fray, 1.0, st.y)));
        const lived = smoothstep(0.0, 0.2, a01).mul(float(1.0).sub(smoothstep(0.7, 1.0, a01)));
        const alpha = column.mul(cut).mul(rise).mul(lived)
            .mul(clamp(vShown, 0.0, 1.0))
            .mul(MIST_WISPS.alpha)
            .toVar();
        const V = normalize(P.sub(u.camPos)).toVar();
        // Thin vapour in the sun: the sunlit vapour, a little brighter toward the sun; through the air.
        const toward = rbHgMix(dot(V, u.sunDir), float(0.6));
        const lit = u.col.hazeSun.mul(toward.mul(WISP_LIGHT.toward).add(WISP_LIGHT.base));
        const col = max(rbAir(u, lit, P, null, { billows: 0 }), vec3(0.0)).toVar();
        // What it adds over the air behind it is held to MIST_WISPS.lift (a thread, never a pane),
        // and against air as bright as itself it fades out (WISP_LIGHT.over).
        const over = rbLuma(col).sub(rbLuma(rbInscatter(u, V))).toVar();
        const a = min(alpha.mul(smoothstep(0.0, WISP_LIGHT.over, over)), float(MIST_WISPS.lift).div(max(over, 1e-3)))
            .toVar();
        return vec4(col.mul(a), a);
    })();

    const part = rbPart('RainbarkMistWisps', geometry, material, WISP_ORDER);
    part.count = n;
    return part;
}

/**
 * The mist part: the sheets, and the wisps where the tier has any.
 * @param {object} u     the shared uniforms (with textures)
 * @param {object} tier  the content tier (mistSheets, wisps)
 */
export function createMist(u, tier = {}) {
    const sheets = createSheets(u, Number.isFinite(tier.mistSheets) ? tier.mistSheets : 4);
    const wispCount = Number.isFinite(tier.wisps) ? Math.max(0, Math.round(tier.wisps)) : 4;
    const wisps = wispCount > 0 ? createWisps(u, wispCount) : null;
    const group = new THREE.Group();
    group.name = 'RainbarkMist';
    group.add(sheets.mesh);
    if (wisps) group.add(wisps.mesh);
    return {
        mesh: group,
        material: null,
        geometry: null,
        sheets,
        wisps,
        dispose() {
            [sheets, wisps].forEach((draw) => {
                if (!draw) return;
                draw.geometry.dispose();
                draw.material.dispose();
            });
        },
    };
}
