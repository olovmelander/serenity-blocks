/**
 * Lunara — the crystal spires, and the light they hold.
 *
 * One instanced draw of a six-sided, pointed prism. Every facet is a flat plane (the normal is
 * the triangle's own), shaded as a cut stone with no scene light and no framebuffer read:
 *
 *   mirror     the sky and the moons' discs along the reflected ray, by Fresnel;
 *   through    the sky along the refracted ray, tinted by the stone and denser toward its root —
 *              the moons' discs are refracted once per colour channel, so their image splits;
 *   within     the prism's far edges seen through the near face (straight bands that slide as
 *              the camera drifts), growth lines, glittering inclusions and a core that glows
 *              from the root;
 *   edges      a catch-light along every arris and the shoulder under the point.
 *
 * The valley is an instrument and these are its strings. A lock sends a wisp into one spire: it
 * flashes from root to point in the piece's colour and KEEPS some of that light (it fades over
 * half a minute). A clear's wave makes every spire answer as it passes: its stored colour flares
 * out, and what it keeps depends on how hot play runs — at rest it lets most of it go; in a chain
 * it keeps it and takes some of the wave's light besides, so the shores fill as the chain builds;
 * the chain's end and a perfect clear let it all go. A four-line clear stands a pillar on every
 * point.
 *
 * Per-crystal state lives in four instanced attributes (one interleaved buffer) written only
 * when gameplay happens, at the moment it happens (see advance()):
 *   aStore  rgb = light held at time w            → rgb · e^(−(t − w)/STORE_HOLD), void after cut
 *   aPrev   rgb = what it held before that (also as of w): shown until w (now always = aStore)
 *   aPulse  rgb = flash colour, w = when it fires → a front running root to point
 *   aAux    (cut time (never cut now), pillar birth, pillar strength, glint seed)
 * The tip glints and the pillars are two more draws that share these buffers.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
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
    fwidth,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    reflect,
    refract,
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
    PILLAR_LIFE,
    PULSE_FADE,
    STORE_HOLD,
    STORE_MAX,
    clearPassTime,
    luAtmosphere,
    luBell,
    luClearLight,
    luFogAmount,
    luFxMaterial,
    luLockLight,
    luMoonDiscs,
    luPart,
    luQuadGeometry,
    luSkyBase,
} from './lunara-tsl.js';
import { softCeiling } from '../shared/swell.js';

/** Strikes on their way at once (a quick hand's wisps), and waves crossing the valley at once. */
const STRIKE_QUEUE = 48;
const WAVE_SLOTS = 6;
/**
 * A spire's flash rises linearly to PULSE_KNEE, then eases toward PULSE_MAX however many hits fold
 * into it (a quick hand's strikes must not burn the stone white); a pillar stands at most this bright.
 */
const PULSE_KNEE = 1.0;
const PULSE_MAX = 2.2;
const PILLAR_MAX = 1.8;
/** Height (0..1) of the shoulder under the point in the unit crystal. */
const SHOULDER = 0.78;
/** Corner radii of the unit crystal's six sides: a slightly irregular hexagon. */
const CORNERS = [1.0, 0.86, 1.04, 0.9, 1.0, 0.84];
const NEVER = 1e9;

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
        const b0 = corner(k, SHOULDER, 0.84);
        const b1 = corner(k + 1, SHOULDER, 0.84);
        // The side: two triangles; aFacet.x runs −1..1 across it, aFacet.y is the height.
        positions.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
        facets.push(-1, 0, -1, SHOULDER, 1, 0, 1, 0, -1, SHOULDER, 1, SHOULDER);
        // The point.
        positions.push(...b0, 0, 1, 0, ...b1);
        facets.push(-1, SHOULDER, 0, 1, 1, SHOULDER);
    }
    return { positions, facets };
}

/** World position of a crystal's vertex from the instance attributes (vertex stage). */
function crystalVertex(root, base, axis, look) {
    const g = positionGeometry;
    // Each spire has its own shoulder height, girth and an off-centre point.
    const s1 = fractHash(look.z, 1.7);
    const s2 = fractHash(look.z, 5.3);
    const shoulder = s1.mul(0.26).add(0.6);
    const y = mix(
        g.y.mul(shoulder.div(SHOULDER)),
        shoulder.add(g.y.sub(SHOULDER).div(1 - SHOULDER).mul(float(1.0).sub(shoulder))),
        step(SHOULDER, g.y),
    );
    const apex = step(0.999, g.y);
    const cy = cos(look.x);
    const sy = sin(look.x);
    const squash = s2.mul(0.3).add(0.82);
    const lx = g.x.mul(cy).sub(g.z.mul(sy)).mul(squash).add(apex.mul(s1.sub(0.5)).mul(0.55));
    const lz = g.x.mul(sy).add(g.z.mul(cy)).add(apex.mul(s2.sub(0.5)).mul(0.55));
    const up = axis.xyz;
    const side = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    const fwd = cross(side, up);
    return root
        .add(up.mul(y.mul(base.w)))
        .add(side.mul(lx).add(fwd.mul(lz)).mul(axis.w));
}

/** A cheap per-instance [0,1) from an integer seed (vertex stage: exact). */
function fractHash(seed, k) {
    return seed.mul(k).mul(0.1031).fract().mul(seed.mul(0.37).add(k * 3.1))
        .fract();
}

/** The stone's own colour for a hue index: the palette's crystal, leaning rose, teal or pale. */
function stoneTint(u, hue) {
    const rose = mix(u.crystal, u.companionCol, 0.6);
    const teal = mix(u.crystal, u.auroraLow, 0.62);
    const pale = mix(u.crystal, u.moonCol, 0.4);
    const a = mix(u.crystal, rose, clamp(hue.mul(2.0), 0.0, 1.0));
    const b = mix(a, teal, clamp(hue.mul(2.0).sub(1.0), 0.0, 1.0));
    return mix(b, pale, clamp(hue.mul(2.0).sub(2.0), 0.0, 1.0));
}

/**
 * @param {object} u     shared valley uniforms
 * @param {object} plan  the valley's plan
 * @param {object} opts
 * @param {number} opts.count     crystals drawn (the plan's first N)
 * @param {boolean} [opts.dispersion=true]  split the refracted moons per channel (two more evaluations)
 * @param {boolean} [opts.pillars=true]
 */
export function createCrystals(u, plan, { count, dispersion = true, pillars = true }) {
    const n = Math.min(count, plan.crystals.length);
    const aBase = new Float32Array(n * 4);
    const aAxis = new Float32Array(n * 4);
    const aLook = new Float32Array(n * 4);
    const aStore = new Float32Array(n * 4);
    const aPrev = new Float32Array(n * 3);
    const aPulse = new Float32Array(n * 4);
    const aAux = new Float32Array(n * 4);
    const tips = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const c = plan.crystals[i];
        aBase.set([c.x, c.y, c.z, c.height], i * 4);
        aAxis.set([c.axis[0], c.axis[1], c.axis[2], c.radius], i * 4);
        aLook.set([c.yaw, c.hue, c.seed, i], i * 4);
        aStore.set([0, 0, 0, 0], i * 4);
        aPulse.set([0, 0, 0, -100], i * 4);
        aAux.set([NEVER, -100, 0, (c.seed % 97) / 97], i * 4);
        tips.set(c.tip, i * 3);
    }
    // WebGPU allows eight vertex buffers a draw, so the seven per-crystal attributes travel in
    // two interleaved ones: what never changes, and what gameplay writes.
    const FIXED = 12;
    const LIVE = 15;
    const fixed = new Float32Array(n * FIXED);
    const liveData = new Float32Array(n * LIVE);
    for (let i = 0; i < n; i++) {
        fixed.set(aBase.subarray(i * 4, i * 4 + 4), i * FIXED);
        fixed.set(aAxis.subarray(i * 4, i * 4 + 4), i * FIXED + 4);
        fixed.set(aLook.subarray(i * 4, i * 4 + 4), i * FIXED + 8);
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
        aPulse: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 7),
        aAux: new THREE.InterleavedBufferAttribute(liveBuffer, 4, 11),
    };
    /** Copy what gameplay wrote into the buffer the three draws share. */
    const touch = () => {
        for (let i = 0; i < n; i++) {
            const o = i * LIVE;
            liveData.set(aStore.subarray(i * 4, i * 4 + 4), o);
            liveData.set(aPrev.subarray(i * 3, i * 3 + 3), o + 4);
            liveData.set(aPulse.subarray(i * 4, i * 4 + 4), o + 7);
            liveData.set(aAux.subarray(i * 4, i * 4 + 4), o + 11);
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
    const pulse = attribute('aPulse', 'vec4');
    const aux = attribute('aAux', 'vec4');
    /** Where the spire stands (upright screens draw them nearer the middle). */
    const root = vec3(base.x.mul(u.squeeze), base.y, base.z);

    /** Light held now (vertex stage): the new light only once its wisp has arrived. */
    const held = () => mix(prev, store.rgb, step(store.w, u.time))
        .mul(exp(u.time.sub(store.w).div(-STORE_HOLD)))
        .mul(step(u.time, aux.x));
    /** The strike / release flash's envelope now (vertex stage). */
    const pulseAge = () => u.time.sub(pulse.w);
    const pulseEnv = () => exp(max(pulseAge(), 0.0).div(-PULSE_FADE)).mul(step(0.0, pulseAge()));

    // ── The spires ──
    const unit = unitCrystal();
    const geometry = share(new THREE.InstancedBufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(unit.positions, 3));
    geometry.setAttribute('aFacet', new THREE.Float32BufferAttribute(unit.facets, 2));

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'LunaraCrystals';
    material.fog = false;
    material.side = THREE.DoubleSide;
    material.positionNode = crystalVertex(root, base, axis, look);

    const vHeld = varying(held(), 'luHeld');
    const vPulse = varying(vec4(pulse.rgb.mul(pulseEnv()), pulseAge()), 'luPulse');
    const vLook = varying(vec3(look.y, fractHash(look.z, 2.9), base.w), 'luLook');
    // Gameplay light travelling over the flats, decided once per spire at its root.
    const vRing = varying(luLockLight(u, root), 'luRingAt');
    const vClear = varying(luClearLight(u, root), 'luClearAt');
    const facet = attribute('aFacet', 'vec2');

    material.colorNode = Fn(() => {
        const p = positionWorld;
        const toCam = normalize(cameraPosition.sub(p)).toVar();
        const face = normalize(cross(dFdx(p), dFdy(p))).toVar();
        const N = face.mul(dot(face, toCam).sign()).toVar();
        const V = toCam.negate().toVar();
        const t = facet.y.toVar();
        const ndv = max(dot(N, toCam), 0.0).toVar();
        const tint = stoneTint(u, vLook.x).toVar();
        const rnd = vLook.y;

        // ── Mirror ──
        const R = reflect(V, N).toVar();
        const Rup = vec3(R.x, abs(R.y), R.z);
        const mirror = luSkyBase(u, Rup).mul(1.5).add(luMoonDiscs(u, Rup));
        const fres = pow(float(1.0).sub(ndv), 3.0).mul(0.9).add(0.07);

        // ── Through: the sky behind, bent by the facet, tinted by the stone ──
        const bend = (eta) => {
            const T = refract(V, N, float(eta));
            // What leaves the far side has straightened most of the way back.
            const out = normalize(mix(V, T, 0.62));
            return vec3(out.x, abs(out.y), out.z);
        };
        const Tg = bend(0.69).toVar();
        const discs = luMoonDiscs(u, Tg).toVar();
        if (dispersion) {
            discs.assign(vec3(luMoonDiscs(u, bend(0.73)).r, discs.g, luMoonDiscs(u, bend(0.65)).b));
        }
        const clearness = mix(float(0.25), float(1.0), smoothstep(0.0, 0.95, t));
        const through = luSkyBase(u, Tg).mul(1.3).add(discs.mul(0.8))
            .mul(mix(tint, vec3(1.0), 0.12))
            .mul(clearness);

        // ── The stone itself: lit facets, and the great moon's light coming through from behind ──
        const key = max(dot(N, u.moonDir), 0.0);
        const kick = max(dot(N, u.companionDir), 0.0);
        // No two facets are cut alike: each takes the light a little differently.
        const cut = sin(dot(N, vec3(12.9, 78.2, 37.7)).add(rnd.mul(20.0))).mul(0.5).add(0.5);
        // Growth lines run across every face.
        const growth = sin(t.mul(vLook.z).mul(11.0).add(rnd.mul(30.0))).mul(0.09).add(0.95);
        // The far sun that lights the moons also finds the facets turned to it.
        const sun = max(dot(N, u.sunDir), 0.0);
        const front = tint.mul(u.moonCol.mul(key.mul(0.85)).add(u.companionCol.mul(kick.mul(0.3)))
            .add(vec3(0.8, 0.72, 1.0).mul(sun.mul(sun).mul(0.24)))
            .add(luSkyBase(u, vec3(N.x, abs(N.y).mul(0.5).add(0.5), N.z)).mul(1.1)))
            .mul(cut.mul(0.7).add(0.45)).mul(growth);
        const back = pow(max(dot(V, u.moonDir), 0.0), 2.5);
        const thick = mix(float(1.0), float(0.3), t).mul(ndv.mul(0.6).add(0.4));
        const glowThrough = mix(tint, u.moonCol, 0.2).mul(tint.add(0.12)).mul(back).mul(exp(thick.mul(-2.2)))
            .mul(0.95);

        // ── Within: fracture planes behind the facet, and a core that glows from the root ──
        const inside = p.mul(0.42).add(V.mul(0.55));
        const fr = u.noise(vec2(inside.x.add(inside.z.mul(0.7)), inside.y.mul(0.3)).add(rnd)).toVar();
        // The far edges of the prism, seen through the near face: straight bands that run the
        // length of the spire, meet at its point, and slide across the face as the eye moves.
        const ghost = facet.x.mul(1.6).add(V.x.mul(1.5)).add(V.z.mul(0.9)).add(rnd.mul(6.0));
        const planes = luBell(ghost.fract().sub(0.5).mul(3.4)).mul(0.62)
            .add(luBell(ghost.mul(2.3).add(0.37).fract().sub(0.5)
                .mul(5.5)).mul(0.38))
            .mul(fr.r.mul(0.5).add(0.75));
        const moonKey = max(dot(N, u.moonDir), 0.0).mul(0.6).add(0.4);
        const breathe = sin(u.time.mul(0.55).add(rnd.mul(40.0))).mul(0.18).add(0.82);
        const core = tint.mul(mix(tint, vec3(1.0), 0.25)).mul(pow(float(1.0).sub(t), 2.6).mul(1.5).add(0.05))
            .mul(breathe).mul(u.power.mul(1.6).add(1.0));
        // Inclusions that glitter as the eye moves, and the light gathered at the root.
        const grit = u.noise(vec2(inside.x.mul(2.3).add(inside.z), inside.y.mul(2.1)).add(V.xy.mul(0.7))).a;
        const specks = smoothstep(0.72, 0.9, grit).mul(sin(u.time.mul(1.9).add(grit.mul(60.0))).mul(0.5).add(0.5));
        const rootGlow = mix(tint, vec3(1.0), 0.2).mul(exp(t.mul(-8.0))).mul(breathe).mul(0.8);
        const within = tint.mul(planes).mul(moonKey).mul(u.moonCol).mul(0.16)
            .add(core.mul(fr.b.mul(0.8).add(0.6)))
            .add(mix(tint, vec3(1.0), 0.55).mul(specks).mul(moonKey).mul(0.55))
            .add(rootGlow);

        // ── The light it holds, and the flash of a strike or a release ──
        const rise = clamp(vPulse.w.mul(3.2), 0.0, 1.6);
        const frontBand = luBell(t.sub(rise).div(0.3));
        const flash = vPulse.rgb.mul(frontBand.mul(2.2).add(0.5).add(planes.mul(0.9)));
        const heldLight = vHeld.mul(planes.mul(1.3).add(0.5).add(pow(float(1.0).sub(t), 1.5).mul(0.7)))
            .mul(sin(u.time.mul(1.7).add(rnd.mul(30.0)).sub(t.mul(5.0))).mul(0.14).add(0.86));

        // ── Edges: every arris and the shoulder catch the light ──
        const ew = fwidth(facet.x).mul(1.1).add(0.016);
        const sw = fwidth(facet.y).mul(1.3).add(0.002);
        const arris = max(
            smoothstep(float(1.0).sub(ew.mul(2.2)), float(1.0).sub(ew.mul(0.5)), abs(facet.x)),
            float(1.0).sub(smoothstep(sw.mul(0.5), sw.mul(2.0), abs(facet.y.sub(SHOULDER)))).mul(0.7),
        );
        const edgeLight = luSkyBase(u, vec3(N.x, abs(N.y).mul(0.5).add(0.5), N.z)).mul(2.5)
            .add(u.moonCol.mul(max(dot(N, u.moonDir), 0.0).mul(0.35).add(0.08)))
            .add(vHeld.add(vPulse.rgb).mul(0.9));

        const col = mix(front.add(glowThrough).add(through.mul(0.7)).add(within), mirror, fres).toVar();
        col.addAssign(edgeLight.mul(arris).mul(1.25));
        col.mulAssign(u.breath);
        col.addAssign(heldLight.mul(u.breath).add(flash));

        // Gameplay light that travels over the flats also lights the stone from below.
        const low = pow(float(1.0).sub(t), 1.4);
        col.addAssign(vRing.mul(mix(tint, vec3(1.0), 0.4)).mul(low.mul(1.4).add(0.25)));
        col.addAssign(vClear.rgb.mul(mix(tint, vec3(1.0), 0.35)).mul(0.8));
        col.addAssign(tint.mul(vClear.w).mul(0.3).mul(low.add(0.3)));
        // A four-line clear's fire, while it lasts.
        col.addAssign(u.moonCol.mul(tint.add(0.2)).mul(u.surge.mul(u.breath)).mul(planes.add(0.2)).mul(0.22));
        return luAtmosphere(u, col, p);
    })();

    const part = luPart('LunaraCrystals', geometry, material, -30);

    // ── Tip glints: a four-pointed star on every point that holds or fires light ──
    const glintGeometry = share(luQuadGeometry(n));
    const glintMaterial = luFxMaterial('LunaraGlints');
    {
        const tip = root.add(axis.xyz.mul(base.w));
        const heldNow = held();
        const env = pulseEnv();
        const stay = sin(u.time.mul(aux.w.mul(1.5).add(0.7)).add(aux.w.mul(60.0))).mul(0.5).add(0.5);
        const lightNow = pulse.rgb.mul(env).mul(1.5)
            .add(heldNow.mul(stay.mul(0.35).add(0.3)))
            // A few points always catch the moon.
            .add(u.moonCol.mul(step(0.8, aux.w)).mul(stay.mul(stay)).mul(0.11).mul(u.breath));
        const power = max(lightNow.r, max(lightNow.g, lightNow.b));
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(tip, 1.0));
        const half = u.viewport.mul(0.5);
        const pxPerMetre = u.viewport.y.mul(1.05).div(max(clip.w, 0.3));
        const metres = base.w.mul(0.1).add(0.5).mul(pow(clamp(power, 0.0, 4.0), 0.4)).mul(2.6);
        const px = clamp(metres.mul(pxPerMetre), 0.0, u.viewport.y.mul(0.22)).mul(step(0.004, power));
        glintMaterial.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px).div(half).mul(clip.w)), clip.z, clip.w);
        const fade = float(1.0).sub(luFogAmount(clip.w, tip.y).mul(0.85));
        const vGlint = varying(lightNow.mul(fade), 'luGlint');
        glintMaterial.colorNode = Fn(() => {
            const q = uv().sub(0.5).mul(2.0);
            const d = length(q);
            const ax = abs(q.x);
            const ay = abs(q.y);
            // Two thin rays and a soft heart.
            const rays = exp(ay.mul(-38.0)).mul(exp(ax.mul(-3.2))).add(exp(ax.mul(-38.0)).mul(exp(ay.mul(-3.2))));
            const heart = exp(d.mul(d).mul(-26.0));
            const k = rays.mul(0.55).add(heart).mul(smoothstep(1.0, 0.6, d));
            return vec4(vGlint.mul(k), 0.0);
        })();
    }
    const glints = luPart('LunaraGlints', glintGeometry, glintMaterial, 24);

    // ── Pillars: a four-line clear stands a column of light on every point ──
    let pillarPart = null;
    if (pillars) {
        const pillarGeometry = share(luQuadGeometry(n));
        const pillarMaterial = luFxMaterial('LunaraPillars');
        const tip = root.add(axis.xyz.mul(base.w));
        const age = u.time.sub(aux.y);
        const live = step(0.0, age).mul(step(age, PILLAR_LIFE)).mul(step(0.001, aux.z));
        const tall = base.w.mul(10.0).add(90.0);
        const along = positionGeometry.y.add(0.5);
        const toCam = normalize(cameraPosition.sub(tip).mul(vec3(1.0, 0.0, 1.0)));
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const dist = length(cameraPosition.sub(tip));
        // Wide enough to read at any distance.
        const width = max(axis.w.mul(1.3).add(0.12), dist.mul(0.0024)).mul(live);
        const world = tip.add(vec3(0.0, 1.0, 0.0).mul(along.mul(tall))).add(right.mul(positionGeometry.x.mul(width).mul(2.0)));
        pillarMaterial.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));
        const fade = float(1.0).sub(luFogAmount(dist, tip.y).mul(0.8));
        const tone = mix(u.moonCol.mul(1.2), pulse.rgb.add(0.25), 0.45);
        const vPillar = varying(vec4(tone.mul(fade).mul(aux.z).mul(live), age), 'luPillar');
        pillarMaterial.colorNode = Fn(() => {
            const st = uv();
            const a = vPillar.w;
            const across = exp(st.x.sub(0.5).mul(st.x.sub(0.5)).mul(-30.0));
            const core = exp(st.x.sub(0.5).mul(st.x.sub(0.5)).mul(-900.0));
            // The column shoots up, stands, then thins from the foot.
            const shot = float(1.0).sub(smoothstep(a.mul(7.0).sub(0.25), a.mul(7.0), st.y))
                .mul(smoothstep(a.mul(0.42).sub(0.3), a.mul(0.42), st.y));
            const height = pow(float(1.0).sub(st.y), 1.6);
            const env = exp(a.mul(-1.6)).mul(smoothstep(0.0, 0.05, a));
            const flicker = sin(st.y.mul(60.0).sub(a.mul(34.0))).mul(0.12).add(0.88);
            return vec4(vPillar.rgb.mul(across.mul(0.4).add(core.mul(1.5))).mul(shot).mul(height).mul(env)
                .mul(flicker)
                .mul(1.5), 0.0);
        })();
        pillarPart = luPart('LunaraPillars', pillarGeometry, pillarMaterial, 26);
    }

    // ── The CPU's twin of what the spires hold ──
    //
    // Everything gameplay does to a spire is written at the moment it happens, in time order: a
    // strike when its wisp ARRIVES, a wave's touch when its front PASSES. (A spire has one flash;
    // writing a moment still to come into it would blank the flash still running until then, so a
    // clear used to put out every spire a lock had just lit until its wave got there.) Strikes and
    // passes wait in two small queues and advance(t) — once a frame — applies whatever has come
    // due, folding each into what the spire already shows: its flash keeps what is left of the
    // last, a pillar still standing stands brighter, and what it holds is only ever added to, let
    // go of where a wave says so, never cut before the wave reaches it.
    const storeT0 = new Float64Array(n);
    let clock = -Infinity;
    const heldAt = (i, time) => {
        const k = Math.exp(-(time - storeT0[i]) / STORE_HOLD);
        return Math.max(aStore[i * 4], aStore[i * 4 + 1], aStore[i * 4 + 2]) * k;
    };

    /** Set what crystal `i` holds as of `time` (its hue kept under the fill). */
    const holdInto = (i, r, g, b, time) => {
        const peak = Math.max(r, g, b, 1e-4);
        const scale = Math.min(1, STORE_MAX / peak);
        const o = i * 4;
        aStore[o] = r * scale;
        aStore[o + 1] = g * scale;
        aStore[o + 2] = b * scale;
        aStore[o + 3] = time;
        aPrev[i * 3] = aStore[o];
        aPrev[i * 3 + 1] = aStore[o + 1];
        aPrev[i * 3 + 2] = aStore[o + 2];
        storeT0[i] = time;
    };

    /** Fold a flash firing at `time` into the one crystal `i` shows: what is left of it, plus this. */
    const flashInto = (i, r, g, b, time) => {
        const o = i * 4;
        const age = time - aPulse[o + 3];
        const left = age >= 0 ? Math.exp(-age / PULSE_FADE) : 1;
        let pr = aPulse[o] * left + r;
        let pg = aPulse[o + 1] * left + g;
        let pb = aPulse[o + 2] * left + b;
        const peak = Math.max(pr, pg, pb, 1e-4);
        if (peak > PULSE_KNEE) {
            const k = softCeiling(peak, PULSE_KNEE, PULSE_MAX) / peak;
            pr *= k;
            pg *= k;
            pb *= k;
        }
        aPulse[o] = pr;
        aPulse[o + 1] = pg;
        aPulse[o + 2] = pb;
        aPulse[o + 3] = time;
    };

    /**
     * Light arrives in crystal `i` at `time`: it flashes in (r, g, b) and keeps `amount` of it —
     * less the fuller it already is, so a spire a quick hand strikes again and again glows in its
     * colours instead of burning white.
     */
    const applyStrike = (i, r, g, b, time, amount) => {
        const o = i * 4;
        const k = Math.exp(-(time - storeT0[i]) / STORE_HOLD);
        const full = Math.min(1, (Math.max(aStore[o], aStore[o + 1], aStore[o + 2]) * k) / STORE_MAX);
        const add = amount * 0.55 * (1 - 0.6 * full);
        holdInto(
            i,
            aStore[o] * k + r * add,
            aStore[o + 1] * k + g * add,
            aStore[o + 2] * k + b * add,
            time,
        );
        flashInto(i, r * amount * 1.6, g * amount * 1.6, b * amount * 1.6, time);
    };

    // Strikes on their way: crystal index (-1 = free), arrival, colour, amount.
    const qIndex = new Int32Array(STRIKE_QUEUE).fill(-1);
    const qTime = new Float64Array(STRIKE_QUEUE);
    const qRgb = new Float32Array(STRIKE_QUEUE * 3);
    const qAmount = new Float32Array(STRIKE_QUEUE);
    const strikeNow = (q, time) => {
        applyStrike(qIndex[q], qRgb[q * 3], qRgb[q * 3 + 1], qRgb[q * 3 + 2], time, qAmount[q]);
        qIndex[q] = -1;
    };

    // Waves crossing the valley: when each front passes each crystal, and what it does there.
    const wavePass = new Float64Array(WAVE_SLOTS * n);
    const passViews = Array.from({ length: WAVE_SLOTS }, (_, w) => wavePass.subarray(w * n, (w + 1) * n));
    /** Passes up to this time have been applied; a wave is spent once its last pass has. */
    const waveDone = new Float64Array(WAVE_SLOTS).fill(-Infinity);
    const waveEnd = new Float64Array(WAVE_SLOTS).fill(-Infinity);
    // r, g, b, strength, keep, charge, cap, pillar, flare, every-spire pillars, hold
    const WP = 11;
    const waveParams = new Float32Array(WAVE_SLOTS * WP);

    /** What wave `w` does to crystal `i` as its front passes at `at`. */
    const applyPass = (w, i, at) => {
        const o = i * 4;
        const p = w * WP;
        const k = Math.exp(-(at - storeT0[i]) / STORE_HOLD);
        const hr = aStore[o] * k;
        const hg = aStore[o + 1] * k;
        const hb = aStore[o + 2] * k;
        const amount = Math.max(hr, hg, hb);
        const R = waveParams[p];
        const G = waveParams[p + 1];
        const B = waveParams[p + 2];
        // It keeps what the wave lets it keep — a share of what it held, never more than a glow
        // (`hold`) — and lets the rest go: the flare is the light let go, in its own colour, and
        // a little of the wave's...
        let keep = waveParams[p + 4];
        if (amount * keep > waveParams[p + 10]) keep = waveParams[p + 10] / amount;
        let kr = hr * keep;
        let kg = hg * keep;
        let kb = hb * keep;
        // (What it keeps only glints as the front goes by: every spire answers every wave, and a
        // cascade's waves come a third of a second apart.)
        const lift = waveParams[p + 3] * 0.22;
        const flare = waveParams[p + 8];
        flashInto(
            i,
            (hr - kr) * flare + kr * 0.15 + R * lift,
            (hg - kg) * flare + kg * 0.15 + G * lift,
            (hb - kb) * flare + kb * 0.15 + B * lift,
            at,
        );
        // ...and takes some of the wave's light, up to its cap (the clustered spires on the banks
        // most; the lone ones out on the shelves a little).
        const c = plan.crystals[i];
        const bank = c.cluster >= 0 ? 1 : 0.35;
        const charge = Math.min(waveParams[p + 5] * bank, waveParams[p + 6] * bank - Math.max(kr, kg, kb));
        if (charge > 0) {
            kr += R * charge;
            kg += G * charge;
            kb += B * charge;
        }
        holdInto(i, kr, kg, kb, at);
        const pillar = waveParams[p + 7];
        if (pillar > 0) {
            // The tallest spire of each cluster and one in five of the rest; on a crown, every
            // spire that held light, as tall as the light it gives up.
            let stands = 0;
            if (c.main) stands = 1;
            else if (waveParams[p + 9] > 0) stands = Math.min(1, amount / 1.2) * (c.seed % 2 === 0 ? 1 : 0.55);
            else if (c.seed % 5 === 0) stands = 0.4;
            const tall = pillar * stands * (0.7 + 0.3 * Math.min(1, amount));
            if (tall > 0) {
                const age = at - aAux[o + 1];
                if (age >= 0 && age < PILLAR_LIFE * 0.6 && aAux[o + 2] > 0) {
                    // Still standing: it burns brighter instead of shooting up again.
                    aAux[o + 2] = Math.min(PILLAR_MAX, aAux[o + 2] + tall * 0.6);
                } else {
                    aAux[o + 1] = at;
                    aAux[o + 2] = tall;
                }
            }
        }
    };

    // What has come due this frame, in time order (strikes coded -1 - slot, passes w * n + i).
    const dueT = new Float64Array(STRIKE_QUEUE + WAVE_SLOTS * n);
    const dueRef = new Int32Array(STRIKE_QUEUE + WAVE_SLOTS * n);
    const order = new Int32Array(STRIKE_QUEUE + WAVE_SLOTS * n);

    /**
     * Apply everything that has come due by `t` (once a frame, on the world clock), oldest first.
     * @returns {boolean} whether anything was written
     */
    part.advance = (t) => {
        if (!Number.isFinite(t)) return false;
        if (!(t >= clock)) {
            clock = t;
            return false;
        }
        let due = 0;
        for (let q = 0; q < STRIKE_QUEUE; q++) {
            if (qIndex[q] >= 0 && qTime[q] <= t) {
                dueT[due] = qTime[q];
                dueRef[due] = -1 - q;
                due += 1;
            }
        }
        for (let w = 0; w < WAVE_SLOTS; w++) {
            if (!(waveEnd[w] > waveDone[w])) continue;
            const first = w * n;
            const done = waveDone[w];
            for (let i = 0; i < n; i++) {
                const pass = wavePass[first + i];
                if (pass > done && pass <= t) {
                    dueT[due] = pass;
                    dueRef[due] = first + i;
                    due += 1;
                }
            }
            waveDone[w] = t;
        }
        clock = t;
        if (due === 0) return false;
        // Insertion sort: a frame brings a handful.
        for (let a = 0; a < due; a++) {
            let b = a - 1;
            while (b >= 0 && dueT[order[b]] > dueT[a]) {
                order[b + 1] = order[b];
                b -= 1;
            }
            order[b + 1] = a;
        }
        for (let a = 0; a < due; a++) {
            const ref = dueRef[order[a]];
            if (ref < 0) strikeNow(-1 - ref, dueT[order[a]]);
            else applyPass(Math.floor(ref / n), ref % n, dueT[order[a]]);
        }
        touch();
        return true;
    };

    /**
     * Light will arrive in crystal `i` at `time` (a wisp's arrival): it flashes in `rgb` and keeps
     * `amount` of it. Applied at once if that moment has already come.
     */
    part.strike = (i, rgb, time, amount = 1) => {
        if (!(i >= 0 && i < n)) return;
        if (time <= clock) {
            applyStrike(i, rgb[0], rgb[1], rgb[2], time, amount);
            touch();
            return;
        }
        let q = qIndex.indexOf(-1);
        if (q < 0) {
            // Full: the strike due first lands now, a moment early, and makes room.
            q = 0;
            for (let k = 1; k < STRIKE_QUEUE; k++) if (qTime[k] < qTime[q]) q = k;
            strikeNow(q, Number.isFinite(clock) ? clock : qTime[q]);
            touch();
        }
        qIndex[q] = i;
        qTime[q] = time;
        qRgb[q * 3] = rgb[0];
        qRgb[q * 3 + 1] = rgb[1];
        qRgb[q * 3 + 2] = rgb[2];
        qAmount[q] = amount;
    };

    /**
     * A wave leaves (hx, hz) at `time`, and every crystal answers as its front passes: it keeps
     * `keep` of what it held (at most `hold`), flares in the rest and in the wave's colour, and
     * takes up to `charge` of the wave's light while it holds less than `cap`. `slow` stretches the front's
     * travel; `pillar` stands columns on the tallest spires (`every`: on every spire that held light).
     * @returns {{ released: number, passes: Float64Array }}  light let go (reused object), and
     *   when the front passes each crystal
     */
    const releaseOut = { released: 0, passes: passViews[0] };
    part.release = (time, hx, hz, rgb, strength = 1, {
        pillar = 0, squeeze = 1, keep = 0, hold = STORE_MAX, charge = 0, cap = 0, flare = 2.2, slow = 1, every = false,
    } = {}) => {
        // A free slot, else the wave that ends first (what it has left to touch lands now).
        let w = -1;
        for (let k = 0; k < WAVE_SLOTS; k++) {
            if (!(waveEnd[k] > waveDone[k])) {
                w = k;
                break;
            }
        }
        if (w < 0) {
            w = 0;
            for (let k = 1; k < WAVE_SLOTS; k++) if (waveEnd[k] < waveEnd[w]) w = k;
            const now = Number.isFinite(clock) ? Math.max(clock, time) : time;
            for (let i = 0; i < n; i++) if (wavePass[w * n + i] > waveDone[w]) applyPass(w, i, now);
            touch();
        }
        const p = w * WP;
        waveParams[p] = rgb[0];
        waveParams[p + 1] = rgb[1];
        waveParams[p + 2] = rgb[2];
        waveParams[p + 3] = strength;
        waveParams[p + 4] = Math.max(0, Math.min(1, keep));
        waveParams[p + 5] = Math.max(0, charge);
        waveParams[p + 6] = Math.max(0, cap);
        waveParams[p + 7] = pillar;
        waveParams[p + 8] = flare;
        waveParams[p + 9] = every ? 1 : 0;
        waveParams[p + 10] = Math.max(0, hold);
        const first = w * n;
        const kept = waveParams[p + 4];
        let released = 0;
        let end = time;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            const pass = time + clearPassTime(Math.hypot(aBase[o] * squeeze - hx, aBase[o + 2] - hz)) * slow;
            wavePass[first + i] = pass;
            if (pass > end) end = pass;
            const had = heldAt(i, pass);
            released += had - Math.min(had * kept, hold);
        }
        waveDone[w] = -Infinity;
        waveEnd[w] = end;
        releaseOut.released = released;
        releaseOut.passes = passViews[w];
        return releaseOut;
    };

    part.reset = () => {
        for (let i = 0; i < n; i++) {
            aStore.set([0, 0, 0, 0], i * 4);
            aPrev.set([0, 0, 0], i * 3);
            aPulse.set([0, 0, 0, -100], i * 4);
            aAux[i * 4] = NEVER;
            aAux[i * 4 + 1] = -100;
            aAux[i * 4 + 2] = 0;
            storeT0[i] = 0;
        }
        qIndex.fill(-1);
        waveDone.fill(-Infinity);
        waveEnd.fill(-Infinity);
        clock = -Infinity;
        touch();
    };
    part.heldAt = heldAt;
    /** Everything the valley holds at `time`. */
    part.totalHeld = (time) => {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += heldAt(i, time);
        return sum;
    };
    /** The strikes still on their way, as { index, time }, soonest first (allocates: tests, diagnostics). */
    part.promises = () => {
        const out = [];
        for (let q = 0; q < STRIKE_QUEUE; q++) if (qIndex[q] >= 0) out.push({ index: qIndex[q], time: qTime[q] });
        return out.sort((a, b) => a.time - b.time);
    };
    /** Whether any wave is still crossing the valley. */
    part.wavesLive = () => {
        for (let w = 0; w < WAVE_SLOTS; w++) if (waveEnd[w] > waveDone[w]) return true;
        return false;
    };
    part.count = n;
    part.tips = tips;
    /** The CPU's copies of the per-crystal state (read-only for callers). */
    part.state = {
        aStore, aPrev, aPulse, aAux,
    };
    return { crystals: part, glints, pillars: pillarPart };
}
