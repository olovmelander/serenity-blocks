/**
 * Geode — the crystals, and the light they hold.
 *
 * Three instanced draws of one six-sided, pointed prism, plus two that share their buffers:
 *
 *   crystals  the hero clusters and the crown. Every facet is a flat plane (the normal is the
 *             triangle's own) shaded as a cut stone with no scene light and no framebuffer read:
 *               lit      the heart on the facets turned to it, a cool fill on those turned to
 *                        the viewer; pale at the root and deep toward the point (the habit of
 *                        amethyst);
 *               through  the heart's light coming through the stone from behind, in its colour;
 *               mirror   the cavity along the reflected ray, by Fresnel;
 *               within   the prism's far edges seen through the near face, chevron phantoms,
 *                        and a core that glows from the root;
 *               fire     dispersion: a facet flashes one colour of the spectrum when it bends
 *                        the heart toward the eye, and runs through the spectrum as the view
 *                        drifts;
 *               edges    a catch-light along every arris and the shoulder under the point.
 *             The crown's crystals (ring > 0) are the same stone, burning in their ring's colour,
 *             and only stand while the chain has grown their ring.
 *   glints    a four-pointed star on every point that holds or fires light.
 *   beams     a four-line clear: every cluster's tallest crystal throws a prismatic lance.
 *   druzy     the lining's thousands of small points, shaded far more cheaply.
 *
 * The geode is an instrument and the hero crystals are its bells. A lock sends a spark into one:
 * it flashes from root to point in the piece's colour and KEEPS some of that light (it fades
 * over half a minute). A clear releases everything the geode holds: as the wave passes a
 * crystal, its stored colour flares out and is gone.
 *
 * Per-crystal state lives in five instanced attributes (one interleaved buffer) written only
 * when gameplay happens:
 *   aStore    rgb = light held as of time w, when its spark lands → rgb · e^(−(t − w)/STORE_HOLD)
 *   aPrev     rgb = what it held before that (also as of w): shown until the spark lands at w
 *   aFlash    rgb = a strike's flash, w = when it fires → a front running root to point
 *   aRelease  rgb = a release's flash (what the crystal lets go), w = when the wave passes it
 *   aAux      (first cut, beam birth, beam strength, second cut)
 * A strike and a release keep separate flashes because they overlap in ordinary play: the piece
 * that completes a line sends its spark (landing in about half a second) and its wave (passing
 * a second later) together. A cut is the moment a wave passes the crystal; it voids only light
 * that landed before it, so a spark that lands after the wave has passed is kept. The shader sees
 * the next two cuts; a cascade puts up to six waves on the wall at once, so the CPU keeps the
 * rest and moves them up as the earlier ones pass.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dFdx,
    dFdy,
    dot,
    exp,
    float,
    fract,
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    reflect,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BEAM_LIFE,
    CAVITY,
    CLEAR_SLOTS,
    CROWN_COLORS,
    CROWN_RINGS,
    FLASH_FADE,
    STORE_HOLD,
    STORE_MAX,
    TAU,
    clearPassTime,
    gdAir,
    gdBell,
    gdEnv,
    gdFxMaterial,
    gdMineral,
    gdPart,
    gdQuadGeometry,
    gdSpectrum,
    gdWallW,
    gdWaves,
} from './geode-tsl.js';

/** Height (0..1) of the shoulder under the point in the unit crystal. */
const SHOULDER = 0.78;
/** Corner radii of the unit crystal's six sides: a slightly irregular hexagon. */
const CORNERS = [1.0, 0.86, 1.04, 0.9, 1.0, 0.84];
const NEVER = 1e9;
/** Seconds before its pass at which a waiting flare takes over the shader's slot. */
const FLARE_HANDOVER = 0.03;
/** The brightest a lance that carries the next four-line clear's (or a perfect clear's) grows. */
const LANCE_MAX = 2.2;

function unitCrystal() {
    const positions = [];
    const facets = [];
    const corner = (k, y, taper) => {
        const a = (k % 6) * (Math.PI / 3);
        const r = CORNERS[k % 6] * taper;
        return [Math.cos(a) * r, y, Math.sin(a) * r];
    };
    for (let k = 0; k < 6; k++) {
        const a0 = corner(k, 0, 1);
        const a1 = corner(k + 1, 0, 1);
        const b0 = corner(k, SHOULDER, 0.86);
        const b1 = corner(k + 1, SHOULDER, 0.86);
        // The side: two triangles; aFacet.x runs −1..1 across it, aFacet.y is the height.
        positions.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
        facets.push(-1, 0, -1, SHOULDER, 1, 0, 1, 0, -1, SHOULDER, 1, SHOULDER);
        // The point.
        positions.push(...b0, 0, 1, 0, ...b1);
        facets.push(-1, SHOULDER, 0, 1, 1, SHOULDER);
    }
    return { positions, facets };
}

/** A cheap per-instance [0,1) from an integer seed (vertex stage: exact). */
function fractHash(seed, k) {
    return seed.mul(k).mul(0.1031).fract().mul(seed.mul(0.37).add(k * 3.1))
        .fract();
}

/**
 * World position of a crystal's vertex from the instance attributes (vertex stage).
 * `grow` (0..1) is how much of the crystal has grown out of the wall; the shoulder under the
 * point sits between `shoulderLow` and `shoulderLow + shoulderSpan` of the height.
 */
function crystalVertex(base, axis, look, grow, shoulderLow = 0.62, shoulderSpan = 0.24) {
    const g = positionGeometry;
    // Each crystal has its own shoulder height, girth and an off-centre point.
    const s1 = fractHash(look.z, 1.7);
    const s2 = fractHash(look.z, 5.3);
    const shoulder = s1.mul(shoulderSpan).add(shoulderLow);
    const y = mix(
        g.y.mul(shoulder.div(SHOULDER)),
        shoulder.add(g.y.sub(SHOULDER).div(1 - SHOULDER).mul(float(1.0).sub(shoulder))),
        step(SHOULDER, g.y),
    );
    const apex = step(0.999, g.y);
    const cy = cos(look.x);
    const sy = sin(look.x);
    const squash = s2.mul(0.3).add(0.82);
    const lx = g.x.mul(cy).sub(g.z.mul(sy)).mul(squash).add(apex.mul(s1.sub(0.5)).mul(0.5));
    const lz = g.x.mul(sy).add(g.z.mul(cy)).add(apex.mul(s2.sub(0.5)).mul(0.5));
    const up = axis.xyz;
    const ref = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), step(0.9, abs(up.z)));
    const side = normalize(cross(up, ref));
    const fwd = cross(side, up);
    const girth = axis.w.mul(grow.mul(0.6).add(0.4)).mul(step(0.004, grow));
    return base.xyz
        .add(up.mul(y.mul(base.w).mul(grow)))
        .add(side.mul(lx).add(fwd.mul(lz)).mul(girth));
}

/** The colour of the crown's ring `ring` (1..CROWN_RINGS), as a node. */
function crownColor(ring) {
    let sum = vec3(0.0);
    for (let i = 0; i < CROWN_RINGS; i++) {
        const c = CROWN_COLORS[i];
        sum = sum.add(vec3(c[0], c[1], c[2]).mul(max(float(1.0).sub(abs(ring.sub(i + 1))), 0.0)));
    }
    return sum;
}

/**
 * @param {object} u     shared geode uniforms
 * @param {object[]} list  the crystals to draw: heroes (ring 0) then the crown (ring 1..8)
 * @param {object} opts
 * @param {boolean} [opts.dispersion=true]  the facets' spectral fire
 * @param {boolean} [opts.beams=true]
 */
export function createCrystals(u, list, { dispersion = true, beams = true } = {}) {
    const n = list.length;
    const aStore = new Float32Array(n * 4);
    const aPrev = new Float32Array(n * 3);
    const aFlash = new Float32Array(n * 4);
    const aRelease = new Float32Array(n * 4);
    const aAux = new Float32Array(n * 4);
    // WebGPU allows eight vertex buffers a draw, so the eight per-crystal attributes travel in
    // two interleaved ones: what never changes, and what gameplay writes.
    const FIXED = 12;
    const LIVE = 19;
    const fixed = new Float32Array(n * FIXED);
    const liveData = new Float32Array(n * LIVE);
    let heroes = 0;
    for (let i = 0; i < n; i++) {
        const c = list[i];
        fixed.set([
            c.x, c.y, c.z, c.height, c.axis[0], c.axis[1], c.axis[2], c.radius, c.yaw, c.mineral, c.seed, c.ring,
        ], i * FIXED);
        aFlash.set([0, 0, 0, -100], i * 4);
        aRelease.set([0, 0, 0, -100], i * 4);
        aAux.set([NEVER, -100, 0, NEVER], i * 4);
        if (c.ring === 0) heroes = i + 1;
    }
    const fixedBuffer = new THREE.InstancedInterleavedBuffer(fixed, FIXED);
    const liveBuffer = new THREE.InstancedInterleavedBuffer(liveData, LIVE);
    liveBuffer.setUsage(THREE.DynamicDrawUsage);
    const shared = {
        aBase: new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 0),
        aAxis: new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 4),
        aLook: new THREE.InterleavedBufferAttribute(fixedBuffer, 4, 8),
        aStore: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 0),
        aPrev: new THREE.InterleavedBufferAttribute(liveBuffer, 3, 4),
        aFlash: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 7),
        aRelease: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 11),
        aAux: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 15),
    };
    /** Copy what gameplay wrote into the buffer the three draws share. */
    const touch = () => {
        for (let i = 0; i < n; i++) {
            const o = i * LIVE;
            liveData.set(aStore.subarray(i * 4, i * 4 + 4), o);
            liveData.set(aPrev.subarray(i * 3, i * 3 + 3), o + 4);
            liveData.set(aFlash.subarray(i * 4, i * 4 + 4), o + 7);
            liveData.set(aRelease.subarray(i * 4, i * 4 + 4), o + 11);
            liveData.set(aAux.subarray(i * 4, i * 4 + 4), o + 15);
        }
        liveBuffer.needsUpdate = true;
    };
    touch();
    const share = (geometry) => {
        Object.keys(shared).forEach((name) => geometry.setAttribute(name, shared[name]));
        geometry.instanceCount = n;
        return geometry;
    };

    const base = attribute('aBase', 'vec4');
    const axis = attribute('aAxis', 'vec4');
    const look = attribute('aLook', 'vec4');
    const store = attribute('aStore', 'vec4');
    const prev = attribute('aPrev', 'vec3');
    const flashA = attribute('aFlash', 'vec4');
    const releaseA = attribute('aRelease', 'vec4');
    const aux = attribute('aAux', 'vec4');
    const ring = look.w;
    const isCrown = step(0.5, ring);

    /** How much of the crystal stands (vertex stage): heroes always, the crown ring by ring. */
    const grown = () => {
        const g = clamp(u.crown.sub(ring.sub(1.0)), 0.0, 1.0);
        // It shoots out and settles.
        const e = g.mul(g).mul(float(3.0).sub(g.mul(2.0)));
        return mix(float(1.0), e.add(sin(g.mul(Math.PI)).mul(0.14)), isCrown);
    };
    /** The stone's own colour (vertex stage). */
    const stone = () => mix(gdMineral(u, look.y), crownColor(ring), isCrown);
    /** Light held now (vertex stage): the new light only once its spark has arrived. */
    const held = () => {
        // A cut voids what landed before it: the light shown while a spark is in flight, and
        // the stored light unless its spark lands after that wave has passed.
        const passedA = step(aux.x, u.time);
        const passedB = step(aux.w, u.time);
        const prevVoid = max(passedA, passedB);
        const storeVoid = max(passedA.mul(step(store.w, aux.x)), passedB.mul(step(store.w, aux.w)));
        const keptPrev = prev.mul(float(1.0).sub(prevVoid));
        const keptStore = store.rgb.mul(float(1.0).sub(storeVoid));
        const kept = mix(keptPrev, keptStore, step(store.w, u.time))
            .mul(exp(u.time.sub(store.w).div(-STORE_HOLD)));
        // A crown crystal burns in its ring's colour for as long as it stands.
        // …brighter for every clear of the chain that pours its light into it (heat.z: the blaze).
        const burn = crownColor(ring).mul(grown()).mul(u.power.mul(0.25).add(u.heat.z.mul(0.25)).add(0.42))
            .mul(isCrown);
        return kept.add(burn);
    };
    /** A flash's age and envelope now (vertex stage). */
    const ageOf = (slot) => u.time.sub(slot.w);
    const envOf = (slot) => exp(max(ageOf(slot), 0.0).div(-FLASH_FADE)).mul(step(0.0, ageOf(slot)));
    /** Both flashes' light now (vertex stage). */
    const flashNow = () => flashA.rgb.mul(envOf(flashA)).add(releaseA.rgb.mul(envOf(releaseA)));
    const tipOf = () => base.xyz.add(axis.xyz.mul(base.w.mul(grown())));

    // ── The crystals ──
    const unit = unitCrystal();
    const geometry = share(new THREE.InstancedBufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit.positions, 3));
    geometry.setAttribute('aFacet', new THREE.Float32BufferAttribute(unit.facets, 2));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GeodeCrystals';
    material.fog = false;
    material.side = THREE.FrontSide;
    material.positionNode = crystalVertex(base, axis, look, grown());

    const rootW = gdWallW(base.xyz);
    const vTint = varying(stone(), 'gdTint');
    const vHeld = varying(held(), 'gdHeld');
    const vFlash = varying(vec4(flashA.rgb.mul(envOf(flashA)), ageOf(flashA)), 'gdFlash');
    const vRelease = varying(vec4(releaseA.rgb.mul(envOf(releaseA)), ageOf(releaseA)), 'gdRelease');
    const vLook = varying(vec3(isCrown, fractHash(look.z, 2.9), base.w), 'gdLook');
    // Gameplay light travelling along the wall, decided once per crystal at its root.
    const vWave = varying(gdWaves(u, rootW, base.xyz), 'gdWave');
    const facet = attribute('aFacet', 'vec2');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        const N = face.mul(dot(face, toCam).sign()).toVar();
        const V = toCam.negate().toVar();
        const t = clamp(facet.y, 0.0, 1.0).toVar();
        // Under MSAA an edge pixel is shaded at its centre even when that lies off the triangle,
        // so a sliver facet's aFacet.x arrives extrapolated far past ±1: hold it to the facet.
        const across = clamp(facet.x, -1.0, 1.0).toVar();
        const up = float(1.0).sub(t).toVar();
        const ndv = clamp(dot(N, toCam), 0.0, 1.0).toVar();
        const tint = vTint.toVar();
        const rnd = vLook.y;
        const Lh = normalize(u.heartPos.sub(p)).toVar();

        // ── Lit: pale at the root, deep toward the point ──
        const zone = smoothstep(0.0, 0.8, t.add(rnd.sub(0.5).mul(0.35)));
        const body = mix(mix(tint, vec3(1.0), 0.35).mul(0.8), tint, zone).toVar();
        // The root stands in its neighbours' shade.
        const shade = smoothstep(0.0, 0.3, t).mul(0.7).add(0.3);
        const key = max(dot(N, Lh), 0.0).toVar();
        // No two facets are cut alike: each takes the light a little differently.
        const cut = sin(dot(N, vec3(12.9, 78.2, 37.7)).add(rnd.mul(20.0))).mul(0.5).add(0.5).toVar();
        // Growth lines run across every face.
        const growth = sin(t.mul(vLook.z).mul(2.4).add(rnd.mul(30.0))).mul(0.06).add(0.95);
        const front = body.mul(u.heart.mul(key.mul(1.1)).add(u.fill.mul(ndv.mul(0.3).add(0.06))))
            .mul(cut.mul(0.95).add(0.3)).mul(growth).mul(shade);

        // ── Through: the heart behind the stone ──
        const back = dot(V, Lh).mul(0.5).add(0.5);
        const thick = mix(float(1.0), float(0.25), t).mul(ndv.mul(0.6).add(0.4));
        const lightIn = mix(u.heart, vec3(1.0), 0.5);
        const glowThrough = body.mul(body.add(0.18)).mul(lightIn).mul(back.mul(back))
            .mul(exp(thick.mul(-1.7)))
            .mul(1.7);

        // ── Mirror ──
        const R = reflect(V, N).toVar();
        const om = float(1.0).sub(ndv);
        const fres = om.mul(om).mul(om).mul(0.85).add(0.06);

        // ── Within: the far edges behind the facet, phantoms, and a core that glows ──
        // The far edges of the prism, seen through the near face: straight bands that run the
        // length of the crystal and slide across the face as the eye moves.
        const ghost = across.mul(1.6).add(V.x.mul(1.5)).add(V.z.mul(0.9)).add(rnd.mul(6.0));
        const planes = gdBell(ghost.fract().sub(0.5).mul(3.4)).mul(0.62)
            .add(gdBell(ghost.mul(2.3).add(0.37).fract().sub(0.5)
                .mul(5.5)).mul(0.38))
            .toVar();
        // Phantoms: the chevrons of earlier points, one inside the other.
        const phantom = gdBell(fract(t.mul(3.3).sub(abs(across).mul(0.4)).add(rnd.mul(3.0))).sub(0.5).mul(5.0))
            .mul(smoothstep(0.08, 0.4, t));
        const breathe = sin(u.time.mul(0.6).add(rnd.mul(40.0))).mul(0.16).add(0.84);
        const core = body.mul(mix(body, vec3(1.0), 0.2)).mul(up.mul(up).mul(1.2).add(0.22))
            .mul(breathe).mul(u.power.mul(1.4).add(u.heat.x.mul(0.2)).add(u.heat.y.mul(0.35)).add(1.0));
        const within = body.mul(planes).mul(u.heart).mul(key.mul(0.6).add(0.4)).mul(0.2)
            .add(core.mul(planes.mul(0.5).add(0.75)))
            .add(body.mul(phantom).mul(u.heart).mul(0.14));

        // ── The light it holds, and the flash of a strike or a release ──
        // A strike runs root to point; a release bursts from the point back down.
        const struck = gdBell(t.sub(clamp(vFlash.w.mul(3.2), 0.0, 1.6)).div(0.3));
        const letGo = gdBell(up.sub(clamp(vRelease.w.mul(3.2), 0.0, 1.6)).div(0.3));
        const flash = vFlash.rgb.mul(struck.mul(2.2).add(0.5).add(planes.mul(0.9)))
            .add(vRelease.rgb.mul(letGo.mul(2.2).add(0.5).add(planes.mul(0.9))));
        const heldLight = vHeld.mul(planes.mul(1.3).add(0.5).add(up.mul(0.7)))
            .mul(sin(u.time.mul(1.7).add(rnd.mul(30.0)).sub(t.mul(5.0))).mul(0.14).add(0.86));

        // ── Edges: every arris and the shoulder catch the light ──
        const ew = fwidth(facet.x).mul(1.1).add(0.016);
        const sw = fwidth(facet.y).mul(1.3).add(0.002);
        const arris = max(
            smoothstep(float(1.0).sub(ew.mul(2.2)), float(1.0).sub(ew.mul(0.5)), abs(across)),
            float(1.0).sub(smoothstep(sw.mul(0.5), sw.mul(2.0), abs(facet.y.sub(SHOULDER)))).mul(0.7),
        );
        const edgeLight = gdEnv(u, N).mul(1.6)
            .add(u.heart.mul(key.mul(0.5).add(0.06)))
            .add(u.fill.mul(0.1))
            .add(vHeld.add(vFlash.rgb).add(vRelease.rgb).mul(0.9));

        const col = mix(front.add(glowThrough).add(within), gdEnv(u, R), fres).toVar();
        if (dispersion) {
            // Fire: the facet bends the heart toward the eye one colour at a time.
            const fx = dot(R, Lh).mul(3.2).add(dot(N, vec3(7.1, 3.3, 5.7))).add(rnd.mul(9.0));
            const gate = gdBell(fract(fx.mul(0.5)).sub(0.5).mul(4.6));
            col.addAssign(gdSpectrum(fract(fx)).mul(gate).mul(key.mul(0.7).add(0.3)).mul(0.9));
        }
        col.addAssign(edgeLight.mul(mix(body, vec3(1.0), 0.45)).mul(arris).mul(0.8));
        col.assign(gdAir(u, col, p));
        col.mulAssign(u.breath);
        col.addAssign(heldLight.mul(u.breath).add(flash));

        // Light that travels along the wall also lights the stone from its root.
        col.addAssign(vWave.rgb.mul(mix(tint, vec3(1.0), 0.4)).mul(up.mul(1.2).add(0.4)));
        col.addAssign(tint.mul(vWave.w).mul(0.08));
        // A four-line clear's fire, while it lasts.
        col.addAssign(u.heart.mul(tint.add(0.2)).mul(u.surge.mul(u.breath)).mul(planes.add(0.2)).mul(0.14));
        return col;
    })();

    const part = gdPart('GeodeCrystals', geometry, material, -40);

    // ── Tip glints: a four-pointed star on every point that holds or fires light ──
    const glintGeometry = share(gdQuadGeometry(n));
    const glintMaterial = gdFxMaterial('GeodeGlints');
    {
        const tip = tipOf();
        const heldNow = held();
        const seed = fractHash(look.z, 9.7);
        const stay = sin(u.time.mul(seed.mul(1.5).add(0.7)).add(seed.mul(60.0))).mul(0.5).add(0.5);
        const lightNow = flashNow().mul(1.5)
            .add(heldNow.mul(stay.mul(0.35).add(0.3)))
            // A few points always catch the heart; in a fever, many more, brighter: the geode is
            // starred with them.
            .add(u.heart.mul(step(float(0.74).sub(u.heat.y.mul(0.3)), seed)).mul(stay.mul(stay)).mul(0.16)
                .mul(u.heat.y.mul(1.4).add(1.0))
                .mul(u.breath)
                .mul(float(1.0).sub(isCrown)));
        const power = max(lightNow.r, max(lightNow.g, lightNow.b));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(tip, 1.0));
        const half = u.viewport.mul(0.5);
        const pxPerSpan = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
        const p4 = clamp(power, 0.0, 4.0).sqrt().sqrt();
        const spans = base.w.mul(0.08).add(0.6).mul(p4).mul(2.2);
        const px = clamp(spans.mul(pxPerSpan), 0.0, u.viewport.y.mul(0.16)).mul(step(0.004, power));
        glintMaterial.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px).div(half).mul(clip.w)), clip.z, clip.w);
        const vGlint = varying(lightNow, 'gdGlint');
        glintMaterial.colorNode = Fn(() => {
            const q = uv().sub(0.5).mul(2.0);
            const d = length(q);
            const ax = abs(q.x);
            const ay = abs(q.y);
            // Two thin rays and a soft heart.
            const rays = exp(ay.mul(-38.0)).mul(exp(ax.mul(-3.2))).add(exp(ax.mul(-38.0)).mul(exp(ay.mul(-3.2))));
            const heart = exp(d.mul(d).mul(-26.0));
            const k = rays.mul(0.55).add(heart).mul(float(1.0).sub(smoothstep(0.6, 1.0, d)));
            return vec4(vGlint.mul(k), 0.0);
        })();
    }
    const glints = gdPart('GeodeGlints', glintGeometry, glintMaterial, 24);

    // ── Beams: a four-line clear throws a prismatic lance from every cluster's tallest point ──
    let beamPart = null;
    if (beams) {
        const beamGeometry = share(gdQuadGeometry(n));
        const beamMaterial = gdFxMaterial('GeodeBeams');
        const tip = tipOf();
        const age = u.time.sub(aux.y);
        const live = step(0.0, age).mul(step(age, BEAM_LIFE)).mul(step(0.001, aux.z));
        const reach = base.w.mul(1.6).add(16.0);
        const along = positionGeometry.y.add(0.5);
        const toCam = normalize(cameraPosition.sub(tip));
        const right = normalize(cross(axis.xyz, toCam));
        const dist = length(cameraPosition.sub(tip));
        const width = max(axis.w.mul(1.5).add(0.3), dist.mul(0.006)).mul(live);
        const world = tip.add(axis.xyz.mul(along.mul(reach))).add(right.mul(positionGeometry.x.mul(width).mul(2.0)));
        beamMaterial.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
        const vBeam = varying(vec4(mix(u.heart, releaseA.rgb.add(0.25), 0.3).mul(aux.z).mul(live), age), 'gdBeam');
        beamMaterial.colorNode = Fn(() => {
            const st = uv();
            const a = vBeam.w;
            const x = st.x.sub(0.5);
            const across = exp(x.mul(x).mul(-24.0));
            const core = exp(x.mul(x).mul(-700.0));
            // The lance shoots out of the point, stands, then thins from its root.
            const shot = float(1.0).sub(smoothstep(a.mul(6.0).sub(0.25), a.mul(6.0), st.y))
                .mul(smoothstep(a.mul(0.42).sub(0.3), a.mul(0.42), st.y));
            const reachFade = float(1.0).sub(st.y).mul(float(1.0).sub(st.y));
            const env = exp(a.mul(-1.5)).mul(smoothstep(0.0, 0.05, a));
            // White at the core, the spectrum spread across the sheath.
            const prism = gdSpectrum(st.x.mul(0.85).add(st.y.mul(0.25)));
            const col = vBeam.rgb.mul(core.mul(1.6)).add(prism.mul(across).mul(0.5).mul(vBeam.rgb.r.add(0.2)));
            return vec4(col.mul(shot).mul(reachFade).mul(env).mul(1.5), 0.0);
        })();
        beamPart = gdPart('GeodeBeams', beamGeometry, beamMaterial, 26);
    }

    // ── The CPU's twin of what the crystals hold ──
    /** When each crystal's stored light lands (its spark's arrival). */
    const storeT0 = new Float32Array(n);
    /**
     * The stored light is `aPrev · carried + fresh`, capped: what the crystal held before (if no
     * wave takes it first) plus what the sparks landing at storeT0 bring. Kept apart so the old
     * light can be taken back out exactly.
     */
    const carried = new Uint8Array(n);
    const fresh = new Float32Array(n * 3);
    /**
     * The waves on their way to each crystal: up to CUTS pass times, earliest first, NEVER after
     * the last (single precision, as the shader reads them). The shader sees the first two
     * (aAux.x, aAux.w); the others wait here and move up as the earlier ones pass. As many as
     * the shaders draw waves, so a crystal answers every wave on the wall.
     */
    const CUTS = CLEAR_SLOTS;
    const cuts = new Float32Array(n * CUTS).fill(NEVER);
    /**
     * Flares waiting their turn: the shader has one release slot, and up to FLARES more waves can
     * be on their way to a crystal after the flare it is showing. (r, g, b, pass) entries per
     * crystal, earliest first, packed; pass < 0 = empty.
     */
    const FLARES = CLEAR_SLOTS;
    const QUEUE = FLARES * 4;
    const queued = new Float32Array(n * QUEUE);
    const qAt = (i, k) => i * QUEUE + k * 4;
    const clearQueue = (i) => {
        queued.fill(0, i * QUEUE, i * QUEUE + QUEUE);
        for (let k = 0; k < FLARES; k++) queued[qAt(i, k) + 3] = -100;
    };
    for (let i = 0; i < n; i++) clearQueue(i);
    /**
     * A strike's flash waiting for its spark: a crystal still burning with the last strike keeps
     * that flash until the new spark lands, which then joins what is left of it (rgb, when; < 0 =
     * none). A quick hand strikes the same bells again and again: none goes dark between.
     */
    const pending = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) pending[i * 4 + 3] = -100;
    /** A flash brighter than this when the next strike is sent waits for that spark. */
    const BURNING = 0.25;
    /** The brightest a flash that joins what is left grows. */
    const FLASH_MAX = 4;

    const cutA = (i) => cuts[i * CUTS];
    const peakOf = (data, o) => Math.max(data[o], data[o + 1], data[o + 2]);
    /** Show the shader the first two waves due. */
    const showCuts = (i) => {
        aAux[i * 4] = cuts[i * CUTS];
        aAux[i * 4 + 3] = cuts[i * CUTS + 1];
    };
    /** The first wave due at or after `t` (NEVER if none). */
    const cutFrom = (i, t) => {
        for (let k = 0; k < CUTS; k++) if (cuts[i * CUTS + k] >= t) return cuts[i * CUTS + k];
        return NEVER;
    };
    /** True if a wave passes in [landed, before): light that landed at `landed` is gone by `before`. */
    const takenBefore = (i, landed, before) => cutFrom(i, landed) < before;
    /** Drop the k-th wave due. */
    const dropCut = (i, k) => {
        const c = i * CUTS;
        cuts.copyWithin(c + k, c + k + 1, c + CUTS);
        cuts[c + CUTS - 1] = NEVER;
    };
    /** Add a wave due at `pass` (single precision), in order. The caller made room. */
    const addCut = (i, pass) => {
        const c = i * CUTS;
        let k = CUTS - 1;
        while (k > 0 && cuts[c + k - 1] > pass) {
            cuts[c + k] = cuts[c + k - 1];
            k -= 1;
        }
        cuts[c + k] = pass;
    };
    const heldAt = (i, time) => {
        const k = Math.exp(-(time - storeT0[i]) / STORE_HOLD);
        // Until the spark lands the crystal still holds only what it held before.
        if (time < storeT0[i]) return cutA(i) < time ? 0 : peakOf(aPrev, i * 3) * k;
        return takenBefore(i, storeT0[i], time) ? 0 : peakOf(aStore, i * 4) * k;
    };
    /** Write the stored light from its two parts, capped at STORE_MAX. */
    const restore = (i) => {
        const o = i * 4;
        const p = i * 3;
        const sum = [0, 1, 2].map((ch) => aPrev[p + ch] * carried[i] + fresh[p + ch]);
        const scale = Math.min(1, STORE_MAX / Math.max(sum[0], sum[1], sum[2], 1e-4));
        aStore.set([sum[0] * scale, sum[1] * scale, sum[2] * scale], o);
    };
    /** Fold every wave that has already passed into the stored values, so only those due remain. */
    const settle = (i, now) => {
        const o = i * 4;
        while (cutA(i) <= now) {
            const cut = cutA(i);
            if (storeT0[i] <= cut) {
                // What had landed was let go.
                fresh.fill(0, i * 3, i * 3 + 3);
                carried[i] = 0;
                aStore.set([0, 0, 0], o);
            } else if (storeT0[i] > now) {
                // A spark is still in flight: what the crystal held before it was let go.
                aPrev.set([0, 0, 0], i * 3);
                carried[i] = 0;
                restore(i);
            }
            dropCut(i, 0);
        }
        showCuts(i);
    };

    /**
     * A wave was forgotten: if a spark in flight had been told to leave the old light behind
     * for that wave, and no other wave will pass before it lands, it carries the old light again.
     */
    const recarry = (i, now) => {
        if (!(storeT0[i] > now) || carried[i]) return;
        if (cutA(i) < storeT0[i]) return;
        carried[i] = 1;
        restore(i);
    };

    // ── Flares: the shader's slot (aRelease) and the queue behind it ──
    const queueLength = (i) => {
        let k = 0;
        while (k < FLARES && queued[qAt(i, k) + 3] >= 0) k += 1;
        return k;
    };
    /** Add a flare to the queue in time order (once it is full, a new one joins the latest). */
    const enqueue = (i, flare) => {
        const waiting = queueLength(i);
        if (waiting >= FLARES) {
            const at = qAt(i, FLARES - 1);
            for (let ch = 0; ch < 3; ch++) queued[at + ch] += flare[ch];
            return;
        }
        let k = waiting;
        while (k > 0 && queued[qAt(i, k - 1) + 3] > flare[3]) {
            queued.copyWithin(qAt(i, k), qAt(i, k - 1), qAt(i, k - 1) + 4);
            k -= 1;
        }
        for (let ch = 0; ch < 4; ch++) queued[qAt(i, k) + ch] = flare[ch];
    };
    /** Keep the queue packed and in time order. */
    const packQueue = (i) => {
        let packed = 0;
        for (let k = 0; k < FLARES; k++) {
            const at = qAt(i, k);
            if (queued[at + 3] < 0) continue;
            // (insertion: entries move down past later ones)
            let to = packed;
            const entry = [queued[at], queued[at + 1], queued[at + 2], queued[at + 3]];
            while (to > 0 && queued[qAt(i, to - 1) + 3] > entry[3]) {
                queued.copyWithin(qAt(i, to), qAt(i, to - 1), qAt(i, to - 1) + 4);
                to -= 1;
            }
            for (let ch = 0; ch < 4; ch++) queued[qAt(i, to) + ch] = entry[ch];
            packed += 1;
        }
        for (let k = packed; k < FLARES; k++) {
            const at = qAt(i, k);
            queued.fill(0, at, at + 3);
            queued[at + 3] = -100;
        }
    };
    /** The place the flare for `pass` waits in (the shader's slot, then the queue), or null. */
    const flareAt = (i, pass) => {
        if (aRelease[i * 4 + 3] === pass) return [aRelease, i * 4];
        for (let k = 0; k < FLARES; k++) if (queued[qAt(i, k) + 3] === pass) return [queued, qAt(i, k)];
        return null;
    };
    /** Add colour to the flare that will fire at `pass`, wherever it is waiting. False if none is. */
    const addToFlare = (i, pass, rgb, gain) => {
        const slot = flareAt(i, pass);
        if (!slot) return false;
        const [data, at] = slot;
        for (let ch = 0; ch < 3; ch++) data[at + ch] += rgb[ch] * gain;
        return true;
    };
    /** A wave was forgotten: its waiting flare moves to the next pass, joining any flare due then. */
    const retime = (i, from, to) => {
        const moved = flareAt(i, from);
        if (!moved) return;
        moved[0][moved[1] + 3] = to;
        // Two flares for one pass: the moved one keeps both, the other is freed.
        const places = [[aRelease, i * 4]];
        for (let k = 0; k < FLARES; k++) places.push([queued, qAt(i, k)]);
        for (const [data, at] of places) {
            if (data[at + 3] !== to || (data === moved[0] && at === moved[1])) continue;
            for (let ch = 0; ch < 3; ch++) moved[0][moved[1] + ch] += data[at + ch];
            data.fill(0, at, at + 3);
            data[at + 3] = -100;
        }
        packQueue(i);
    };

    /** Hand a strike's waiting flash to the shader once its spark is in. */
    const landFlash = (i, now) => {
        const o = i * 4;
        const at = pending[o + 3];
        if (at < 0 || now < at) return false;
        // What is left of the flash it was showing joins the new one.
        const age = at - aFlash[o + 3];
        const left = aFlash[o + 3] > -50 && age >= 0 ? Math.exp(-age / FLASH_FADE) : 0;
        const rgb = [0, 1, 2].map((ch) => pending[o + ch] + aFlash[o + ch] * left);
        const scale = Math.min(1, FLASH_MAX / Math.max(rgb[0], rgb[1], rgb[2], 1e-4));
        aFlash.set([rgb[0] * scale, rgb[1] * scale, rgb[2] * scale, at], o);
        pending.fill(0, o, o + 3);
        pending[o + 3] = -100;
        return true;
    };

    /**
     * Light arrives in crystal `i` at `time` (which may be a moment ahead of `now`): it flashes
     * in `rgb` and keeps `amount` of it. If an earlier spark is still on its way to the same
     * crystal, this one's light joins it and lands with it — the crystal never shows light
     * before a spark has reached it — and the brighter of the two flashes is the one it gives.
     * Light that lands before a wave already on its way is let go with the rest when it passes.
     * A crystal still burning with its last flash keeps it until this spark lands. `defer` leaves
     * the upload to the caller (part.touch), for many strikes at once.
     */
    part.strike = (i, rgb, time, amount = 1, now = time, defer = false) => {
        if (!(i >= 0 && i < n)) return;
        const o = i * 4;
        const p = i * 3;
        settle(i, now);
        landFlash(i, now);
        const add = [rgb[0] * amount * 0.55, rgb[1] * amount * 0.55, rgb[2] * amount * 0.55];
        const flash = [rgb[0] * amount * 1.6, rgb[1] * amount * 1.6, rgb[2] * amount * 1.6];
        if (storeT0[i] > now) {
            for (let ch = 0; ch < 3; ch++) fresh[p + ch] += add[ch];
            // (the flash that will fire when the first spark lands: waiting, or already set)
            const target = pending[o + 3] >= 0 ? pending : aFlash;
            if (amount * 1.6 > peakOf(target, o)) target.set(flash, o);
        } else {
            const k = Math.exp(-(time - storeT0[i]) / STORE_HOLD);
            aPrev.set([aStore[o] * k, aStore[o + 1] * k, aStore[o + 2] * k], p);
            // A wave that passes before this spark lands takes the old light with it.
            carried[i] = cutA(i) < time ? 0 : 1;
            fresh.set(add, p);
            aStore[o + 3] = time;
            storeT0[i] = time;
            const age = now - aFlash[o + 3];
            const burning = aFlash[o + 3] > -50 && age >= 0 ? peakOf(aFlash, o) * Math.exp(-age / FLASH_FADE) : 0;
            if (burning > BURNING) pending.set([...flash, time], o);
            else aFlash.set([...flash, time], o);
        }
        restore(i);
        // What the next wave to pass after it lands will let go now includes this light.
        const next = cutFrom(i, storeT0[i]);
        if (next !== NEVER) addToFlare(i, next, add, 2.2);
        if (!defer) touch();
    };

    /**
     * A perfect clear: every bell rings at once, from the heart outward, in `rgb` — and keeps it.
     * One upload for all of them.
     */
    part.ringAll = (rgb, time, amount, { now = time, spread = 0 } = {}) => {
        for (let i = 0; i < heroes; i++) {
            part.strike(i, rgb, time + spread * clearPassTime(list[i].w), amount, now, true);
        }
        touch();
    };

    /**
     * The lances standing (or about to leave) burn brighter: nothing restarts. Returns how many.
     */
    part.boostLances = (gain, now) => {
        let lit = 0;
        for (let i = 0; i < heroes; i++) {
            const o = i * 4;
            if (!(aAux[o + 2] > 0) || now - aAux[o + 1] >= BEAM_LIFE) continue;
            aAux[o + 2] = Math.min(LANCE_MAX, aAux[o + 2] + gain);
            lit += 1;
        }
        if (lit) touch();
        return lit;
    };

    /**
     * A clear: a wave leaves the heart at `time` and every hero crystal answers as it passes —
     * in the wave's colour, and in whatever colour it is holding by then, which is then gone.
     * As many waves can be on their way to a crystal at once as the shaders draw. `forget` is
     * the birth time of the wave the shaders stopped drawing to make room for this one: a crystal
     * it had yet to reach forgets it too, and its waiting flare moves to the next pass.
     * A four-line clear (`beam`) throws a lance from every cluster's tallest crystal; one still
     * standing bright from the last is not thrown again but burns brighter.
     * @returns {{ released: number, passes: Float32Array, amounts: Float32Array }}  light let go
     *   in all, and each crystal's pass time and share
     */
    const passes = new Float32Array(n);
    const amounts = new Float32Array(n);
    part.release = (time, rgb, strength = 1, { beam = 0, now = time, forget = null } = {}) => {
        let released = 0;
        for (let i = 0; i < heroes; i++) {
            const o = i * 4;
            const p = i * 3;
            const crystal = list[i];
            const pass = time + clearPassTime(crystal.w);
            passes[i] = pass;
            settle(i, now);
            if (beam > 0) {
                const age = now - aAux[o + 1];
                const standing = aAux[o + 2] > 0 && age < BEAM_LIFE
                    ? aAux[o + 2] * Math.exp(-1.5 * Math.max(0, age)) : 0;
                if (crystal.main && standing > beam * 0.5) {
                    // Still burning brighter than half a new one: it carries this one's light instead.
                    aAux[o + 2] = Math.min(LANCE_MAX, aAux[o + 2] + beam * 0.5);
                } else {
                    aAux[o + 1] = pass;
                    aAux[o + 2] = crystal.main ? beam : 0;
                }
            }
            let orphan = NEVER;
            if (forget !== null) {
                const gone = Math.fround(forget + clearPassTime(crystal.w));
                for (let k = 0; k < CUTS; k++) {
                    if (cuts[i * CUTS + k] !== gone) continue;
                    dropCut(i, k);
                    orphan = gone;
                    break;
                }
            }
            if (cuts[i * CUTS + CUTS - 1] !== NEVER) {
                // Still every place taken (the caller named no wave to forget): the earliest goes.
                orphan = cutA(i);
                dropCut(i, 0);
            }
            // (aAux holds single-precision times: compare like with like)
            const due = Math.fround(pass);
            if (orphan !== NEVER) {
                recarry(i, now);
                // A forgotten wave's flare goes with the next wave to pass — which may be this one.
                retime(i, orphan, cutA(i) === NEVER ? due : Math.min(cutA(i), due));
            }
            // If this wave passes before a spark in flight lands, that spark must not carry the
            // old light past it.
            if (storeT0[i] > pass && carried[i]) {
                carried[i] = 0;
                restore(i);
            }
            // What the wave finds: the stored light if its spark has landed by then, else what
            // the crystal held before — unless another wave on its way gets there first.
            const k = Math.exp(-(pass - storeT0[i]) / STORE_HOLD);
            const landed = storeT0[i] <= pass;
            const source = landed ? aStore : aPrev;
            const at = landed ? o : p;
            const found = takenBefore(i, landed ? storeT0[i] : -Infinity, pass) ? 0 : k;
            const had = [source[at] * found, source[at + 1] * found, source[at + 2] * found];
            const amount = Math.max(had[0], had[1], had[2]);
            amounts[i] = amount;
            released += amount;
            // The flare: the shader shows one at a time, so one that is not next in line waits.
            const flare = [
                had[0] * 2.2 + rgb[0] * strength * 0.3,
                had[1] * 2.2 + rgb[1] * strength * 0.3,
                had[2] * 2.2 + rgb[2] * strength * 0.3,
                pass,
            ];
            if (addToFlare(i, due, flare, 1)) {
                // (a forgotten wave's flare was already moved to this pass: they fire as one)
            } else if (aRelease[o + 3] > now) {
                if (pass < aRelease[o + 3]) {
                    // (a single clear inside a four-line clear's hush passes first)
                    enqueue(i, Array.from(aRelease.subarray(o, o + 4)));
                    aRelease.set(flare, o);
                } else enqueue(i, flare);
            } else if (queueLength(i) > 0) enqueue(i, flare);
            else aRelease.set(flare, o);
            addCut(i, due);
            showCuts(i);
        }
        touch();
        return { released, passes, amounts };
    };

    /**
     * Once a frame: hand the next waiting flare to the shader just before its wave passes (the
     * flare before it has had the slot since its own pass), a strike's waiting flash once its
     * spark is in, and the next wave due once one has passed (the shader sees two at a time).
     */
    part.tick = (now) => {
        let wrote = false;
        for (let i = 0; i < heroes; i++) {
            if (cuts[i * CUTS + 2] !== NEVER && cutA(i) <= now) {
                settle(i, now);
                wrote = true;
            }
            if (landFlash(i, now)) wrote = true;
            const q = qAt(i, 0);
            if (queued[q + 3] >= 0 && now >= queued[q + 3] - FLARE_HANDOVER) {
                aRelease.set(queued.subarray(q, q + 4), i * 4);
                queued.copyWithin(q, q + 4, i * QUEUE + QUEUE);
                const last = qAt(i, FLARES - 1);
                queued.fill(0, last, last + 3);
                queued[last + 3] = -100;
                wrote = true;
            }
        }
        if (wrote) touch();
    };

    part.reset = () => {
        for (let i = 0; i < n; i++) {
            aStore.set([0, 0, 0, 0], i * 4);
            aPrev.set([0, 0, 0], i * 3);
            aFlash.set([0, 0, 0, -100], i * 4);
            aRelease.set([0, 0, 0, -100], i * 4);
            aAux[i * 4] = NEVER;
            aAux[i * 4 + 1] = -100;
            aAux[i * 4 + 2] = 0;
            aAux[i * 4 + 3] = NEVER;
            storeT0[i] = 0;
            carried[i] = 0;
            fresh.fill(0, i * 3, i * 3 + 3);
            pending.fill(0, i * 4, i * 4 + 3);
            pending[i * 4 + 3] = -100;
            clearQueue(i);
        }
        cuts.fill(NEVER);
        touch();
    };
    part.touch = touch;
    part.heldAt = heldAt;
    /** Everything the geode holds at `time`. */
    part.totalHeld = (time) => {
        let sum = 0;
        for (let i = 0; i < heroes; i++) sum += heldAt(i, time);
        return sum;
    };
    /** The waves due at crystal `i`, earliest first (all of them, not only the two the shader sees). */
    part.cutsOf = (i) => {
        const out = [];
        for (let k = 0; k < CUTS; k++) if (cuts[i * CUTS + k] !== NEVER) out.push(cuts[i * CUTS + k]);
        return out;
    };
    part.count = n;
    part.heroes = heroes;
    /** The CPU's copies of the per-crystal state (read-only for callers). */
    part.state = {
        aStore, aPrev, aFlash, aRelease, aAux,
    };
    return { crystals: part, glints, beams: beamPart };
}

/**
 * The lining's small points: one instanced draw, shaded as cheaply as a cut stone can be.
 * @param {object} u
 * @param {{ count: number, base: Float32Array, axis: Float32Array, look: Float32Array }} druzy
 * @param {number} count  points drawn (the plan's first N)
 * @param {object} [opts]
 * @param {boolean} [opts.caustics=true]  patches of spectral light wander over the lining
 */
export function createDruzy(u, druzy, count, { caustics = true } = {}) {
    const n = Math.min(count, druzy.count);
    const unit = unitCrystal();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit.positions, 3));
    geometry.setAttribute('aFacet', new THREE.Float32BufferAttribute(unit.facets, 2));
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(druzy.base.subarray(0, n * 4), 4));
    geometry.setAttribute('aAxis', new THREE.InstancedBufferAttribute(druzy.axis.subarray(0, n * 4), 4));
    geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(druzy.look.subarray(0, n * 4), 4));
    geometry.instanceCount = n;
    const base = attribute('aBase', 'vec4');
    const axis = attribute('aAxis', 'vec4');
    const look = attribute('aLook', 'vec4');
    const facet = attribute('aFacet', 'vec2');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GeodeDruzy';
    material.fog = false;
    material.side = THREE.FrontSide;
    material.positionNode = crystalVertex(base, axis, look, float(1.0), 0.3, 0.3);
    const vTint = varying(mix(u.druzy, gdMineral(u, look.y), 0.28), 'gdDruzyTint');
    const waves = gdWaves(u, look.w, base.xyz);
    // Fire on the walls: the hero crystals throw the heart's light about the cavity in patches of
    // spectral colour that wander over the lining (decided once per point, from the noise field).
    let fire = vec3(0.0);
    if (caustics) {
        const turn = atan(base.y, base.x).div(TAU);
        const at = vec2(turn.mul(2.0).add(u.drift.mul(0.004)), look.w.mul(0.34).sub(u.drift.mul(0.006)));
        const field = u.noise(at).level(0.0);
        const patch = smoothstep(0.6, 0.82, field.r).mul(smoothstep(0.3, 0.6, field.b));
        fire = gdSpectrum(field.g.mul(2.2).add(look.w.mul(0.6))).mul(patch)
            .mul(u.power.mul(0.9).add(u.surge.mul(0.8)).add(u.heat.x.mul(0.4)).add(u.heat.y.mul(0.7))
                .add(0.3))
            .mul(u.breath);
    }
    const vWave = varying(vec4(waves.rgb.add(fire), waves.a), 'gdDruzyWave');
    // (a seed for the facets' cut, and how bright this point is among its neighbours)
    // …scaled by how much of the heart's light reaches this far along the wall: the lining glows
    // where it borders the agate and darkens toward the viewer.
    const reach = exp(max(look.w.sub(CAVITY.wBands - 0.1), 0.0).mul(-2.6)).mul(0.9).add(0.1);
    const gain = fractHash(look.z, 7.1).mul(0.9).add(0.55).mul(reach);
    const vRnd = varying(vec2(fractHash(look.z, 2.9), gain), 'gdDruzyRnd');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        const N = face.mul(dot(face, toCam).sign()).toVar();
        const V = toCam.negate().toVar();
        const t = clamp(facet.y, 0.0, 1.0).toVar();
        const ndv = clamp(dot(N, toCam), 0.0, 1.0).toVar();
        const Lh = normalize(u.heartPos.sub(p)).toVar();
        const tint = vTint.toVar();
        // No two facets are cut alike.
        const cut = sin(dot(N, vec3(12.9, 78.2, 37.7)).add(vRnd.x.mul(20.0))).mul(0.5).add(0.5).toVar();
        // Each point stands in its neighbours' shade: dark at the root.
        const shade = smoothstep(0.0, 0.55, t).mul(0.85).add(0.15).toVar();
        // Through: the heart's light inside the stone, strongest where the stone is thin —
        // toward the point and along the arrises.
        const b = dot(V, Lh).mul(0.5).add(0.5);
        // (aFacet.x held to the facet: MSAA extrapolates it past ±1 on sliver facets, and its
        // fourth power then burns single pixels white along the points' edges)
        const across = clamp(facet.x, -1.0, 1.0);
        const e2 = across.mul(across);
        const thin = max(t.mul(t), e2.mul(e2).mul(0.7));
        const lightIn = mix(u.heart, vec3(1.0), 0.55);
        const through = tint.mul(tint.add(0.12)).mul(lightIn).mul(b.mul(b)).mul(thin.mul(1.5).add(0.12));
        // Lit: the facets turned to the heart and, coolly, those turned to the viewer.
        const key = max(dot(N, Lh), 0.0);
        const lit = tint.mul(lightIn.mul(key.mul(1.1)).add(u.fill.mul(ndv.mul(ndv).mul(0.3).add(0.03))))
            .mul(cut.mul(0.9).add(0.25));
        // Flashes: the facet that mirrors the heart at the eye, and the one square to the eye.
        const s = max(dot(reflect(V, N), Lh), 0.0);
        const s4 = s.mul(s).mul(s).mul(s);
        const n4 = ndv.mul(ndv).mul(ndv).mul(ndv);
        const n16 = n4.mul(n4).mul(n4).mul(n4);
        const spec = mix(u.heart, vec3(1.0), 0.4).mul(s4.mul(s4).mul(s4).mul(1.6))
            .add(mix(tint, vec3(1.0), 0.6).mul(n16.mul(n16).mul(0.55)))
            .mul(cut.mul(cut).add(0.15));
        const glow = tint.mul(u.power.mul(0.1).add(u.surge.mul(0.08)).add(0.05));
        const stone = through.add(lit).add(glow).mul(vRnd.y).add(spec.mul(vRnd.y.mul(0.6).add(0.4)))
            .mul(shade);
        const col = gdAir(u, stone, p).mul(u.breath).toVar();
        col.addAssign(vWave.rgb.mul(tint.add(0.3)).mul(1.1).mul(shade.add(0.3)));
        col.addAssign(tint.mul(vWave.w).mul(0.05).mul(shade));
        return col;
    })();

    const part = gdPart('GeodeDruzy', geometry, material, -35);
    part.count = n;
    return part;
}
