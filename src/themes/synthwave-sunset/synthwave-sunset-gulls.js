/* eslint-disable import/no-unresolved */
/**
 * Synthwave Sunset — the gulls: herring gulls wheeling over the pier against the sunset, ONE
 * instanced draw of a real bird.
 *
 * The model is the theme's own, built in Blender by scripts/blender/synthwave_gull.py: a white
 * gull with grey wings, black tips and a yellow bill, its wings bent at the wrist. There is no
 * skeleton: each vertex carries how much the shoulder and the wrist move it (`_wing`), and the
 * vertex stage folds the wings about those two hinges into the glide's crank or the wingbeat's
 * stroke (the cycle built from the poses the script wrote into the asset manifest).
 *
 * Where each bird flies is synthwave-sunset-gull-flight.js, whose CPU functions this vertex
 * stage repeats exactly: its loop now and a step either side give the heading and the bank (the
 * lift leans into the turn), and the fireworks' startle and the evening's roost move it off its
 * loop. The model arrives after the world is built (a few tens of kB); until then the draw holds
 * a hidden placeholder of the same layout, so the material is the same from the first frame.
 *
 * The light is the bay's: the sky's own gradient from above, the sunset sea's glow from below,
 * the sun on the faces turned to it and through the thin feathers when a bird crosses in front
 * of it, a warm rim, the fireworks' colours, the town's neon faintly from below after dark. The
 * birds stand in the sea's mirror too.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    max,
    min,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uniform,
    varyingProperty,
    vec3,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { rgb, swLuma, swSkyGradient } from './synthwave-sunset-tsl.js';
import {
    GULL_BEAT, GULL_DT, GULL_FLAP, GULL_FLIGHTS, GULL_GLIDE, GULL_NEVER, GULL_RIG, GULL_ROOST, GULL_SCALE,
    GULL_STARTLE, GULL_STARTLE_RATES, GullRoost, GullStartle, gullCount,
} from './synthwave-sunset-gull-flight.js';

export { GULL_FLIGHTS, GULL_SCALE, gullPosition } from './synthwave-sunset-gull-flight.js';

export const GULL_URL = new URL('./assets/gull.glb', import.meta.url).href;

/** The model's attributes, as the vertex stage reads them. */
const LAYOUT = Object.freeze([['position', 3], ['normal', 3], ['color', 4], ['_wing', 3]]);

/** The per-bird vec4s, in their order in the instance buffer. */
const INSTANCE_NAMES = Object.freeze(['iGullA', 'iGullB', 'iGullC', 'iGullD', 'iGullE', 'iGullRoost']);
const INSTANCE_STRIDE = INSTANCE_NAMES.length * 4;

/** How far a bird leans into its turns, as a share of a coordinated turn's bank. */
const BANK = 0.65;

/** The body is held at most this share of the luminance of the sky behind it. */
const SILHOUETTE = 0.2;

/** Each bird's own size about GULL_SCALE (±8 %). */
export const gullSize = (f) => GULL_SCALE * (0.92 + 0.16 * ((f.seed * 3.7) % 1));

/** Pick the gull's geometry out of a parsed glTF (position, normal, color, _wing, index). */
export function gullGeometryFromGltf(gltf) {
    let mesh = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if (!mesh && object.isMesh) mesh = object;
    });
    if (!mesh) throw new Error('[SynthwaveSunset] the gull asset holds no mesh');
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    for (const [name] of LAYOUT) {
        if (!geometry.getAttribute(name)) throw new Error(`[SynthwaveSunset] the gull asset has no "${name}"`);
    }
    return geometry;
}

/** Fetch and parse the model. Resolves null when it cannot be read (the sky does without). */
export async function loadGullGeometry(url = GULL_URL) {
    try {
        if (typeof fetch !== 'function' || typeof document === 'undefined') return null;
        return gullGeometryFromGltf(await new GLTFLoader().loadAsync(url));
    } catch (error) {
        console.warn('[SynthwaveSunset] the gulls did not arrive:', error?.message || error);
        return null;
    }
}

/** A stand-in of the model's layout: one degenerate triangle. */
function placeholderGeometry() {
    const g = new THREE.BufferGeometry();
    for (const [name, size] of LAYOUT) g.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(3 * size), size));
    g.setIndex([0, 1, 2]);
    return g;
}

// ── The loop, once per stage (a pure function of its arguments) ─────────────

/**
 * Where a bird is at `cT` on its loop (synthwave-sunset-gull-flight.js: loopPosition), with the
 * startle's reading `cS` and its integral `cRush`. cA = centre, radius; cB = phase, omega, seed,
 * kind; cC = across, depth, climb, axis; cD = drift across, drift in depth, drift seed,
 * sensitivity; cE = away from the barge (x, z), exit (x, z).
 */
const swGullLoop = /* @__PURE__ */ Fn(([cT, cS, cRush, cA, cB, cC, cD, cE]) => {
    const k = cD.w.mul(cS);
    const ang = cB.x.add(cB.y.mul(cT.add(cRush.mul(GULL_STARTLE.rush).mul(cD.w))));
    const R = cA.w.mul(sin(cT.mul(0.043).add(cD.z.mul(11.0))).mul(0.15).add(1.0)).mul(k.mul(GULL_STARTLE.widen).add(1.0));
    const eight = step(0.5, cB.w);
    const ox = mix(cos(ang), sin(ang), eight).mul(cC.x);
    const oz = mix(sin(ang), sin(ang.mul(2.0)).mul(0.5), eight).mul(cC.y);
    const ca = cos(cC.w);
    const sa = sin(cC.w);
    const lx = ox.mul(R).add(sin(cT.mul(0.031).add(cD.z.mul(40.0))).mul(cD.x));
    const lz = oz.mul(R).add(cos(cT.mul(0.027).add(cD.z.mul(29.0))).mul(cD.y));
    const share = oz.div(max(cC.y, 1e-4));
    const y = cA.y.sub(cC.z.mul(share)).add(sin(cT.mul(0.21).add(cB.z.mul(13.0))).mul(0.5)).add(k.mul(GULL_STARTLE.climb));
    const flee = k.mul(GULL_STARTLE.flee);
    return vec3(
        cA.x.add(lx.mul(ca)).sub(lz.mul(sa)).add(cE.x.mul(flee)),
        y,
        cA.z.add(lx.mul(sa)).add(lz.mul(ca)).add(cE.y.mul(flee)),
    );
}).setLayout({
    name: 'sw_gullLoop',
    type: 'vec3',
    inputs: [
        { name: 'cT', type: 'float' },
        { name: 'cS', type: 'float' },
        { name: 'cRush', type: 'float' },
        { name: 'cA', type: 'vec4' },
        { name: 'cB', type: 'vec4' },
        { name: 'cC', type: 'vec4' },
        { name: 'cD', type: 'vec4' },
        { name: 'cE', type: 'vec4' },
    ],
});

/** Rotate the pair (a, b) by `ang`. */
const turn = (a, b, ang) => {
    const c = cos(ang);
    const s = sin(ang);
    return [a.mul(c).sub(b.mul(s)), a.mul(s).add(b.mul(c))];
};

/** One hinge angle of the wingbeat at phase (cos φ, sin φ), from the four authored poses. */
const cycle = (key, c, s) => {
    const [A, B, C, D] = GULL_FLAP[key];
    return float(A).add(c.mul(B)).add(s.mul(C)).add(s.mul(s).mul(D));
};

/**
 * @param {object} u  world uniforms (gullTime, sunDir, sunAz, dusk, burst0/1, burstCol0/1, townLights)
 * @param {object} uStartle  vec4 uniform: the startle's slow, fast, t0 and rush
 */
function createGullMaterial(u, uStartle) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveGulls';
    material.fog = false;

    const A = attribute('iGullA', 'vec4');
    const B = attribute('iGullB', 'vec4');
    const C = attribute('iGullC', 'vec4');
    const D = attribute('iGullD', 'vec4');
    const E = attribute('iGullE', 'vec4');
    const F = attribute('iGullRoost', 'vec4');
    const wing = attribute('_wing', 'vec3');
    const plumage = attribute('color', 'vec4');
    const vNormal = varyingProperty('vec3', 'vGullNormal');
    const vWorld = varyingProperty('vec3', 'vGullWorld');
    const { r, q } = GULL_STARTLE_RATES;
    const R = GULL_ROOST;

    material.positionNode = Fn(() => {
        const t = u.gullTime;
        const h = GULL_DT;
        const startleAt = (time) => {
            const dt = max(time.sub(uStartle.z), 0.0);
            return max(uStartle.x.mul(exp(dt.mul(-r))).sub(uStartle.y.mul(exp(dt.mul(-q)))), 0.0);
        };
        const S0 = startleAt(t).toVar();
        const rush = uStartle.w;
        const tm = t.sub(h);
        const tp = t.add(h);
        const loop0 = swGullLoop(t, S0, rush, A, B, C, D, E).toVar();
        const loopM = swGullLoop(tm, startleAt(tm), rush.sub(S0.mul(h)), A, B, C, D, E).toVar();
        const loopP = swGullLoop(tp, startleAt(tp), rush.add(S0.mul(h)), A, B, C, D, E).toVar();

        // The roost: leaving (out of the loop onto a straight line away), or coming back.
        const leaveAt = F.x;
        const backAt = F.y;
        const leaving = step(backAt, leaveAt).mul(step(1e-3, leaveAt.sub(backAt))).toVar();
        const fixedAt = mix(backAt.add(R.back), leaveAt, leaving);
        const anchor = swGullLoop(fixedAt, float(0.0), float(0.0), A, B, C, D, E).toVar();
        const exitV = vec3(E.z.mul(R.speed), R.climb, E.w.mul(R.speed));
        const roosted = (time, onLoop) => {
            const e = time.sub(leaveAt);
            const out = anchor.add(exitV.mul(e));
            const gone = mix(onLoop, out, smoothstep(0.0, R.turn, e));
            const eb = time.sub(backAt);
            const inbound = anchor.add(exitV.mul(max(float(R.back).sub(eb), 0.0)));
            const home = mix(inbound, onLoop, smoothstep(R.back - R.turn, R.back, eb));
            return mix(home, gone, leaving);
        };
        const P = roosted(t, loop0).toVar();
        const Pm = roosted(tm, loopM).toVar();
        const Pp = roosted(tp, loopP).toVar();

        // Heading along the path, the lift leaning into the turn (and holding it up); the lean is
        // BANK of a coordinated turn's, so the tight ends of a loop stay a calm glide.
        const fwd = normalize(Pp.sub(Pm)).toVar();
        const accel = Pp.sub(P.mul(2.0)).add(Pm).div(h * h);
        const lift = accel.mul(BANK).add(vec3(0.0, 9.81, 0.0));
        const up = normalize(lift.sub(fwd.mul(dot(lift, fwd)))).toVar();
        const left = cross(up, fwd).toVar();

        // How big it is drawn: 0 once it has gone, growing in far out as it comes back.
        const eLeave = t.sub(leaveAt);
        const eBack = t.sub(backAt);
        const shown = mix(smoothstep(0.0, 4.0, eBack), float(1.0).sub(smoothstep(R.gone - 8, R.gone, eLeave)), leaving);
        const scale = F.z.mul(shown);

        // The wingbeat: glides, broken by bouts; steady beats climbing, commuting or startled.
        const seed = B.z;
        const sens = D.w;
        const climbRate = Pp.y.sub(Pm.y).div(2 * h);
        const bout = smoothstep(0.62, 0.8, sin(t.mul(0.37).add(seed.mul(23.0))).mul(0.5).add(0.5));
        const commute = mix(
            float(1.0).sub(smoothstep(R.back - 3, R.back, eBack)).mul(step(eBack, float(R.back))),
            float(1.0).sub(smoothstep(R.gone - 12, R.gone, eLeave)),
            leaving,
        ).mul(0.85);
        const scared = smoothstep(0.08, 0.5, S0.mul(sens));
        const flap = clamp(max(max(bout, smoothstep(0.4, 1.4, climbRate)), max(scared, commute)), 0.0, 1.0).toVar();
        const omegaBeat = Math.PI * 2 * GULL_BEAT.hz;
        const phi = t.mul(omegaBeat).add(seed.mul(31.0)).add(rush.mul(sens).mul(omegaBeat * GULL_BEAT.startleBoost));
        const c = cos(phi).toVar();
        const s = sin(phi).toVar();
        const g = GULL_GLIDE;
        const poseOf = (key, glide) => mix(glide, cycle(key, c, s), flap);
        const liftA = poseOf('lift', float(g.lift).add(sin(t.mul(0.9).add(seed.mul(5.0))).mul(0.05)));
        const sweepA = poseOf('sweep', float(g.sweep));
        const bendA = poseOf('bend', float(g.bend).add(sin(t.mul(0.7).add(seed.mul(3.0))).mul(0.04)));
        const foldA = poseOf('fold', float(g.fold));
        const curlA = poseOf('curl', float(g.curl));

        // Fold the rest pose about the wrist, then the shoulder (scripts/blender/synthwave_gull.py: fold).
        const p = positionGeometry;
        const n = normalGeometry;
        const side = step(0.0, p.x).mul(2.0).sub(1.0);
        const [Sx, Sy, Sz] = GULL_RIG.shoulder;
        const [Wx, Wy, Wz] = GULL_RIG.wrist;
        const handTurn = foldA.mul(wing.y).negate().toVar();
        const handLift = bendA.mul(wing.y).add(curlA.mul(wing.z)).toVar();
        const armTurn = sweepA.mul(wing.x).negate().toVar();
        const armLift = liftA.mul(wing.x).toVar();
        let [du, dz] = turn(abs(p.x).sub(Wx), p.z.sub(Wz), handTurn);
        let dy;
        [du, dy] = turn(du, p.y.sub(Wy), handLift);
        [du, dz] = turn(du.add(Wx - Sx), dz.add(Wz - Sz), armTurn);
        [du, dy] = turn(du, dy.add(Wy - Sy), armLift);
        const local = vec3(side.mul(du.add(Sx)), dy.add(Sy), dz.add(Sz));
        let [nu, nz] = turn(side.mul(n.x), n.z, handTurn);
        let ny;
        [nu, ny] = turn(nu, n.y, handLift);
        [nu, nz] = turn(nu, nz, armTurn);
        [nu, ny] = turn(nu, ny, armLift);
        const world = P.add(left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z)).mul(scale)).toVar();
        vNormal.assign(left.mul(side.mul(nu)).add(up.mul(ny)).add(fwd.mul(nz)));
        vWorld.assign(world);
        return world;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormal).toVar();
        const V = normalize(cameraPosition.sub(vWorld)).toVar();
        const L = u.sunDir;
        const albedo = plumage.xyz.toVar();
        const thin = plumage.w;
        const sunUp = smoothstep(-0.16, 0.06, L.y);
        const sun = mix(rgb(0xffb070, 1.6), rgb(0xff6a3a, 1.1), u.dusk).mul(sunUp).toVar();
        // The sky's own colours from above; the sunset sea's glow (its mirror of the low sky,
        // brightest toward the sun) from below.
        const skyDir = normalize(vec3(N.x, max(N.y, 0.03), N.z));
        const seaDir = normalize(vec3(N.x.add(L.x.mul(0.35)), 0.03, N.z.add(L.z.mul(0.35))));
        const sky = swSkyGradient(u, skyDir).color;
        const sea = swSkyGradient(u, seaDir).color.mul(0.35);
        const ambient = mix(sea, sky, smoothstep(-0.35, 0.35, N.y)).mul(0.55);
        const NdL = max(dot(N, L), 0.0);
        const edge = float(1.0).sub(abs(dot(N, V)));
        // The warm rim on the edges turned to the sun only (a thin wing seen from below is grazing
        // almost everywhere: a rim that ignored the sun would light all of it).
        const edge2 = edge.mul(edge);
        const rim = edge2.mul(edge2).mul(NdL.mul(0.9).add(0.04)).mul(rgb(0xff8a5c, 0.6))
            .mul(mix(float(1.0), float(0.35), u.dusk));
        // The sun through the thin feathers when the bird crosses the sun's disc (half at 10° from
        // its centre, nothing by 20°: wider, every wing near the sunset glowed and the birds faded).
        const through = exp(dot(V.negate(), L).sub(1.0).mul(60.0)).mul(thin).mul(0.45);
        // The fireworks' light on the side turned to them; the town's neon from below after dark.
        const fw = u.burstCol0.mul(u.burst0.w.mul(max(dot(N, u.burst0.xyz), 0.0)))
            .add(u.burstCol1.mul(u.burst1.w.mul(max(dot(N, u.burst1.xyz), 0.0)))).mul(0.25);
        const neon = rgb(0xff5fa8, 0.06).mul(u.townLights).mul(smoothstep(0.1, -0.7, N.y));
        const body = albedo.mul(ambient.add(sun.mul(NdL).mul(0.6)).add(neon)).toVar();
        // Legibility: the body is held darker than the sky behind it (a backlit gull is a
        // silhouette; a lit one against the bright sunset would vanish into it). The rim, the
        // sun through the feathers and the fireworks' colours are laid over that.
        const behind = swLuma(swSkyGradient(u, V.negate()).color);
        const held = body.mul(min(float(1.0), behind.mul(SILHOUETTE).div(max(swLuma(body), 1e-4))));
        return held.add(albedo.mul(rim.add(sun.mul(through)).add(fw)));
    })();
    return material;
}

/**
 * The gulls: one instanced draw (the first `count` flights) under `group`, the startle and the
 * roost that move them, and the model swapped in when it arrives (attach()).
 */
export class SynthwaveGulls {
    /**
     * @param {object} u  world uniforms
     * @param {object} [opts]
     * @param {number} [opts.count=7]
     * @param {number} [opts.mirrorLayer]  also draw on this layer (the sea's reflection pass)
     */
    constructor(u, opts = {}) {
        this.u = u;
        this.count = gullCount(opts.count);
        this.group = new THREE.Group();
        this.group.name = 'SynthwaveGullFlock';
        this.startle = new GullStartle();
        this.roost = new GullRoost(this.count);
        this.roostVersion = -1;
        this.pendingSeek = true;
        this.uStartle = uniform(new THREE.Vector4(0, 0, 0, 0));
        this.instanced = this.buildInstances();
        this.material = createGullMaterial(u, this.uStartle);
        this.mesh = new THREE.Mesh(this.withInstances(placeholderGeometry()), this.material);
        this.mesh.name = 'SynthwaveGulls';
        this.mesh.renderOrder = 60;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        if (Number.isInteger(opts.mirrorLayer)) this.mesh.layers.enable(opts.mirrorLayer);
        this.group.add(this.mesh);
        this.attached = false;
    }

    /**
     * The flights, interleaved in ONE instance buffer (WebGPU allows eight vertex buffers a draw;
     * the model takes four): six vec4s a bird, the last its roost (rewritten when a bird leaves).
     */
    buildInstances() {
        const n = this.count;
        const data = new Float32Array(n * INSTANCE_STRIDE);
        for (let i = 0; i < n; i += 1) {
            const f = GULL_FLIGHTS[i];
            data.set([
                ...f.centre, f.radius,
                f.phase, f.omega, f.seed, f.kind,
                f.across, f.depth, f.climb, f.axis,
                f.drift[0], f.drift[1], f.group, f.sensitivity,
                f.away[0], f.away[1], f.exit[0], f.exit[1],
                GULL_NEVER, GULL_NEVER, gullSize(f), 0,
            ], i * INSTANCE_STRIDE);
        }
        this.instanceBuffer = new THREE.InstancedInterleavedBuffer(data, INSTANCE_STRIDE);
        this.instanceBuffer.setUsage(THREE.DynamicDrawUsage);
        return Object.fromEntries(INSTANCE_NAMES.map((name, k) => [
            name, new THREE.InterleavedBufferAttribute(this.instanceBuffer, 4, k * 4),
        ]));
    }

    /** An instanced geometry of `base`'s layout carrying the flights. */
    withInstances(base) {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        for (const [name] of LAYOUT) geometry.setAttribute(name, base.getAttribute(name));
        for (const [name, attr] of Object.entries(this.instanced)) geometry.setAttribute(name, attr);
        geometry.instanceCount = this.count;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 30, -100), 600);
        return geometry;
    }

    /** Swap the model in (a geometry from gullGeometryFromGltf). */
    attach(base) {
        if (!base || this.attached) return;
        const old = this.mesh.geometry;
        this.mesh.geometry = this.withInstances(base);
        this.mesh.visible = true;
        this.attached = true;
        old.dispose();
    }

    /** A burst of `scale` went off at `at` on the gulls' clock (`motion` under 0.5: reduced). */
    hit(scale, at, motion = 1) {
        this.startle.hit(GULL_STARTLE.perBurst * scale * (motion < 0.5 ? 0.4 : 1), at);
    }

    /** No events in flight; the roost is rebuilt from the evening on the next update. */
    seek() {
        this.startle.reset();
        this.pendingSeek = true;
    }

    /**
     * @param {number} t  the gulls' clock
     * @param {number} dusk  the evening now
     * @param {(time: number) => number} duskAt  the evening at another time on the gulls' clock
     */
    update(t, dusk, duskAt) {
        if (this.pendingSeek) {
            this.roost.seek(t, duskAt);
            this.pendingSeek = false;
        } else {
            this.roost.update(t, dusk);
        }
        if (this.roost.version !== this.roostVersion) {
            const buffer = this.instanceBuffer;
            const roostAt = INSTANCE_NAMES.indexOf('iGullRoost') * 4;
            for (let i = 0; i < this.count; i += 1) {
                buffer.array[i * INSTANCE_STRIDE + roostAt] = this.roost.leaveAt[i];
                buffer.array[i * INSTANCE_STRIDE + roostAt + 1] = this.roost.backAt[i];
            }
            buffer.needsUpdate = true;
            this.roostVersion = this.roost.version;
        }
        this.startle.advance(t);
        const s = this.startle;
        this.uStartle.value.set(s.slow, s.fast, s.t0, s.rush);
    }

    dispose() {
        this.group.removeFromParent();
        this.mesh.geometry.dispose();
        this.material.dispose();
    }
}
