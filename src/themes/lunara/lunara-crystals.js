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
 * half a minute). A clear releases everything the valley holds: as the wave passes a spire, its
 * stored colour flares out and is gone. A four-line clear stands a pillar on every point.
 *
 * Per-crystal state lives in four instanced attributes (one interleaved buffer) written only
 * when gameplay happens:
 *   aStore  rgb = light held at time w            → rgb · e^(−(t − w)/STORE_HOLD), void after cut
 *   aPrev   rgb = what it held before that (also as of w): shown until the wisp arrives at w
 *   aPulse  rgb = flash colour, w = when it fires → a front running root to point
 *   aAux    (cut time, pillar birth, pillar strength, glint seed)
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
    const storeT0 = new Float32Array(n);
    const cut = new Float32Array(n).fill(NEVER);
    const heldAt = (i, time) => {
        if (time > cut[i]) return 0;
        const k = Math.exp(-(time - storeT0[i]) / STORE_HOLD);
        // Until the wisp arrives the spire still holds only what it held before.
        if (time < storeT0[i]) return Math.max(aPrev[i * 3], aPrev[i * 3 + 1], aPrev[i * 3 + 2]) * k;
        return Math.max(aStore[i * 4], aStore[i * 4 + 1], aStore[i * 4 + 2]) * k;
    };

    /**
     * Light arrives in crystal `i` at `time` (which may be a moment ahead): it flashes in `rgb`
     * and keeps `amount` of it.
     */
    part.strike = (i, rgb, time, amount = 1) => {
        if (!(i >= 0 && i < n)) return;
        const o = i * 4;
        const k = time > cut[i] ? 0 : Math.exp(-(time - storeT0[i]) / STORE_HOLD);
        const before = [0, 1, 2].map((c) => aStore[o + c] * k);
        const next = before.map((v, c) => v + rgb[c] * amount * 0.55);
        const peak = Math.max(next[0], next[1], next[2], 1e-4);
        const scale = Math.min(1, STORE_MAX / peak);
        aPrev.set(before, i * 3);
        aStore.set([next[0] * scale, next[1] * scale, next[2] * scale, time], o);
        storeT0[i] = time;
        cut[i] = NEVER;
        aAux[o] = NEVER;
        aPulse.set([rgb[0] * amount * 1.6, rgb[1] * amount * 1.6, rgb[2] * amount * 1.6, time], o);
        touch();
    };

    /**
     * A clear: a wave leaves (hx, hz) at `time` and every crystal answers as it passes — in the
     * wave's colour, and in whatever colour it was holding, which is then gone.
     * @returns {{ released: number, passes: Float32Array }}  light let go, and each pass time
     */
    const passes = new Float32Array(n);
    part.release = (time, hx, hz, rgb, strength = 1, { pillar = 0, squeeze = 1 } = {}) => {
        let released = 0;
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            const pass = time + clearPassTime(Math.hypot(aBase[o] * squeeze - hx, aBase[o + 2] - hz));
            passes[i] = pass;
            const k = pass > cut[i] ? 0 : Math.exp(-(pass - storeT0[i]) / STORE_HOLD);
            const had = [aStore[o] * k, aStore[o + 1] * k, aStore[o + 2] * k];
            const amount = Math.max(had[0], had[1], had[2]);
            released += amount;
            aPulse.set([
                had[0] * 2.2 + rgb[0] * strength * 0.3,
                had[1] * 2.2 + rgb[1] * strength * 0.3,
                had[2] * 2.2 + rgb[2] * strength * 0.3,
                pass,
            ], o);
            cut[i] = pass;
            aAux[o] = pass;
            if (pillar > 0) {
                aAux[o + 1] = pass;
                // The tallest spire of each cluster, and one in five of the rest.
                const c = plan.crystals[i];
                let stands = 0;
                if (c.main) stands = 1;
                else if (c.seed % 5 === 0) stands = 0.4;
                aAux[o + 2] = pillar * stands * (0.7 + 0.3 * Math.min(1, amount));
            }
        }
        touch();
        return { released, passes };
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
            cut[i] = NEVER;
        }
        touch();
    };
    part.heldAt = heldAt;
    /** Everything the valley holds at `time`. */
    part.totalHeld = (time) => {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += heldAt(i, time);
        return sum;
    };
    part.count = n;
    part.tips = tips;
    /** The CPU's copies of the per-crystal state (read-only for callers). */
    part.state = {
        aStore, aPrev, aPulse, aAux,
    };
    return { crystals: part, glints, pillars: pillarPart };
}
