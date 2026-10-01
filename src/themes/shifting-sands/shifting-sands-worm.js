/**
 * Shifting Sands — Shai-Hulud.
 *
 * The worm is ONE tube mesh animated entirely in the vertex shader: every vertex knows its body
 * coordinate σ (0 = the maw, 1 = the tail) and its angle θ around the body; the body follows the
 * head's own path, so the arch is always a single continuous motion.
 *
 * The breach path is a tall half-ellipse in the vertical plane through the breach site, along the
 * heading D:  P(φ) = O + D·(a·sin φ) + Y·(b·cos φ − k),  φ ∈ [−φ₀, φ₀],  b·cos φ₀ = k.
 * The head sweeps φ at constant rate; a body point sits at φ_head − σ·Lφ. Whatever is below the
 * sand is hidden by the opaque dunes (depth test), so the worm rises out of and plunges back into
 * the erg with no clipping logic. Where the body pierces the surface, the dune shader heaves a
 * ring of sand (uMounds) and the FX layer throws plumes.
 *
 * Geometry: a short inner tube (the throat, normals inward, ringed with crystal teeth), a flared
 * lip, then the segmented outer body tapering to the tail. Skin: annular plates with dark
 * creases, a sand-dusted back, dusty ochre-grey hide, the twin-sun light, violet sky fill and a
 * strong backlit rim (it breaches in front of the suns).
 *
 * The WormDirector (CPU) owns the schedule: idle cycles (a worm sign travels in, a modest breach
 * in the left zone) and event breaches (a Tetris summons a huge, close breach), all closed-form in
 * the world clock so `seek()` reproduces any frame.
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
    dot,
    float,
    fract,
    frontFacing,
    max,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import { ssTexNoise } from './shifting-sands-tsl.js';

const DEG = Math.PI / 180;

// ── The breach path (CPU twin of the vertex shader) ─────────────────────────────

/** φ₀: where the ellipse meets the surface. */
export function surfaceAngle(b, k) {
    return Math.acos(Math.min(1, Math.max(-1, k / b)));
}

/** Point on the breach path at angle φ (into `out`). */
export function breachPoint(br, phi, out) {
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    out.x = br.ox + br.dx * br.a * s;
    out.y = br.oy + br.b * c - br.k;
    out.z = br.oz + br.dz * br.a * s;
    return out;
}

/** Body-length in path angle: the body covers `length` world units at the arch's mean radius. */
export function bodyAngleSpan(br) {
    const mean = Math.sqrt((br.a * br.a + br.b * br.b) / 2);
    return br.length / mean;
}

/**
 * The breach recipes. dist/az place the site from the rest camera; heading is the azimuth of
 * motion in the ground plane; a/b/k shape the arch; R the body radius; speed in world units/s.
 */
export const BREACH_RECIPES = Object.freeze({
    idleNear: {
        az: -27, dist: 1350, heading: -118, a: 120, b: 235, k: 50, R: 30, length: 620, speed: 80,
    },
    idleFar: {
        az: -31, dist: 2600, heading: -70, a: 150, b: 260, k: 60, R: 36, length: 700, speed: 88,
    },
    summoned: {
        az: -26, dist: 930, heading: -128, a: 140, b: 300, k: 55, R: 42, length: 760, speed: 92,
    },
});

/** Seconds the worm sign travels before the head breaks the surface. */
export const SIGN_LEAD = Object.freeze({ idle: 13, summoned: 1.6 });
/** Idle cycle length (s): sign + breach + quiet. */
export const IDLE_PERIOD = 52;
/** First idle sign starts this long after the scene starts (so the opening frames are calm). */
export const IDLE_OFFSET = 6;

function hash01(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
}

/**
 * Builds a concrete breach (site, heading, timing) from a recipe.
 * @param {object} recipe  BREACH_RECIPES entry
 * @param {number} t0      time the head breaks the surface
 * @param {(x:number, z:number) => number} groundAt
 */
export function makeBreach(recipe, t0, groundAt, jitter = 0) {
    const az = (recipe.az + jitter * 3) * DEG;
    const ox = Math.sin(az) * recipe.dist;
    const oz = -Math.cos(az) * recipe.dist;
    const hd = (recipe.heading + jitter * 9) * DEG;
    const dx = Math.sin(hd);
    const dz = -Math.cos(hd);
    const br = {
        t0,
        ox,
        oz,
        oy: 0,
        dx,
        dz,
        a: recipe.a,
        b: recipe.b,
        k: recipe.k,
        R: recipe.R,
        length: recipe.length,
        speed: recipe.speed,
    };
    // Seat the path on the sand along the arch footprint (the lowest point it crosses).
    const phi0 = surfaceAngle(br.b, br.k);
    let g = Infinity;
    for (let i = 0; i <= 6; i++) {
        const f = -1 + (2 * i) / 6;
        const s = Math.sin(phi0 * f);
        g = Math.min(g, groundAt(ox + dx * br.a * s, oz + dz * br.a * s));
    }
    br.oy = g + 4;
    br.phi0 = phi0;
    br.span = bodyAngleSpan(br);
    const mean = Math.sqrt((br.a * br.a + br.b * br.b) / 2);
    br.omega = br.speed / mean;
    // Active from the head breaking the surface until the tail has gone under.
    br.duration = (2 * phi0 + br.span) / br.omega;
    return br;
}

// ── Director ────────────────────────────────────────────────────────────────────

export class WormDirector {
    constructor(groundAt) {
        this.groundAt = groundAt;
        this.summoned = null;
        this.summonedAt = -Infinity;
        this._idleCache = new Map();
        this.state = {
            breach: null, // active breach or null
            phiHead: 0,
            open: 0,
            sign: null, // { x, z, dx, dz, strength }
            mounds: [
                {
                    x: 0, z: 0, r: 0, h: 0,
                },
                {
                    x: 0, z: 0, r: 0, h: 0,
                },
            ],
            rumble: 0,
        };
        this._p = { x: 0, y: 0, z: 0 };
    }

    reset() {
        this.summoned = null;
        this.summonedAt = -Infinity;
    }

    idleBreach(cycle) {
        let br = this._idleCache.get(cycle);
        if (!br) {
            const h = hash01(cycle + 1);
            const recipe = h < 0.62 ? BREACH_RECIPES.idleNear : BREACH_RECIPES.idleFar;
            const t0 = IDLE_OFFSET + cycle * IDLE_PERIOD + SIGN_LEAD.idle;
            br = makeBreach(recipe, t0, this.groundAt, hash01(cycle + 7.3) * 2 - 1);
            br.leadTime = SIGN_LEAD.idle;
            this._idleCache.clear();
            this._idleCache.set(cycle, br);
        }
        return br;
    }

    /** A Tetris: the worm comes for the thumper. Ignored while a summoned breach is underway. */
    summon(t) {
        if (this.summoned && t < this.summoned.t0 + this.summoned.duration) return false;
        const br = makeBreach(BREACH_RECIPES.summoned, t + SIGN_LEAD.summoned, this.groundAt, 0);
        br.leadTime = SIGN_LEAD.summoned;
        this.summoned = br;
        this.summonedAt = t;
        return true;
    }

    /** Where the summoned worm will break the surface (for the spice blow that heralds it). */
    summonedEmergence() {
        const br = this.summoned;
        return br ? breachPoint(br, -br.phi0, { x: 0, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 };
    }

    /** Resolve the worm at time t (closed form). */
    update(t) {
        const st = this.state;
        // Candidates: the summoned breach wins while it (or its sign) is live.
        let br = null;
        if (this.summoned && t >= this.summoned.t0 - this.summoned.leadTime
            && t <= this.summoned.t0 + this.summoned.duration + 1.5) {
            br = this.summoned;
        } else if (t >= IDLE_OFFSET) {
            const cycle = Math.floor((t - IDLE_OFFSET) / IDLE_PERIOD);
            const idle = this.idleBreach(cycle);
            // An idle breach never starts within 20 s after a summoned one.
            if (t - this.summonedAt > 20 || this.summonedAt === -Infinity) br = idle;
        }

        st.breach = null;
        st.sign = null;
        st.open = 0;
        st.rumble = 0;
        st.mounds[0].h = 0;
        st.mounds[1].h = 0;
        if (!br) return st;

        const local = t - br.t0;
        // ── Worm sign: a mound racing in along the heading toward the emergence point ──
        if (local < 0.4 && local > -br.leadTime) {
            const em = breachPoint(br, -br.phi0, this._p);
            const signSpeed = br === this.summoned ? 380 : 62;
            const d = -local * signSpeed;
            const fadeIn = Math.min(1, (local + br.leadTime) / 1.5);
            const fadeOut = Math.min(1, Math.max(0, (0.4 - local) / 0.6));
            st.sign = {
                x: em.x - br.dx * d,
                z: em.z - br.dz * d,
                dx: br.dx,
                dz: br.dz,
                strength: fadeIn * fadeOut * (br === this.summoned ? 1.25 : 0.85),
            };
            st.rumble = Math.max(st.rumble, st.sign.strength * (br === this.summoned ? 1 : 0.25));
        }
        // ── The breach itself ──
        if (local >= 0 && local <= br.duration) {
            st.breach = br;
            st.phiHead = -br.phi0 + local * br.omega;
            // The maw opens as it rears and closes as it dives.
            const u = local / Math.max(1e-3, (2 * br.phi0) / br.omega);
            const ss = (e0, e1, x) => {
                const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
                return k * k * (3 - 2 * k);
            };
            st.open = ss(0.04, 0.24, u) * (1 - ss(0.42, 0.62, u));
            // Pierce mounds: emergence while the tail is still under, dive while the head is under.
            const tailPhi = st.phiHead - br.span;
            const em = breachPoint(br, -br.phi0, this._p);
            const emActive = tailPhi < -br.phi0 ? 1 : Math.max(0, 1 - (tailPhi + br.phi0) * 2.5);
            st.mounds[0].x = em.x;
            st.mounds[0].z = em.z;
            st.mounds[0].r = br.R * 1.7;
            st.mounds[0].h = emActive * br.R * 0.7 * Math.min(1, local * 1.5);
            const dv = breachPoint(br, br.phi0, this._p);
            const dvFill = tailPhi < br.phi0 ? 1 : Math.max(0, 1 - (tailPhi - br.phi0) * 2.5);
            const dvActive = st.phiHead > br.phi0 ? dvFill : 0;
            st.mounds[1].x = dv.x;
            st.mounds[1].z = dv.z;
            st.mounds[1].r = br.R * 1.7;
            st.mounds[1].h = dvActive * br.R * 0.6;
            st.rumble = Math.max(st.rumble, (br === this.summoned ? 0.8 : 0.2) * Math.max(emActive, dvActive));
        }
        return st;
    }
}

// ── The worm mesh ───────────────────────────────────────────────────────────────

/**
 * @param {object} shared world uniforms + atmosphere
 * @param {object} [opts] { rings, segs }
 */
export function createWorm(shared, { rings = 160, segs = 32, capRings = 10 } = {}) {
    const {
        uSunA, uSunB, uSunLightA, uSunLightB, uUpper, uZenith, uHorizonCool, atmosphere, noiseTex,
    } = shared;

    // aWorm = (σ, θ, part, α): part 0 = body (σ along the body), 1 = the maw cap (α: 0 at the
    // rim → 1 at the apex of the closed dome).
    const ringCount = (rings + 1) + (capRings + 1);
    const verts = ringCount * (segs + 1);
    const data = new Float32Array(verts * 4);
    const pos = new Float32Array(verts * 3); // unused: the vertex node builds every position
    let w = 0;
    const pushRing = (sigma, part, alpha) => {
        for (let j = 0; j <= segs; j++) {
            data[w * 4] = sigma;
            data[w * 4 + 1] = (j / segs) * Math.PI * 2;
            data[w * 4 + 2] = part;
            data[w * 4 + 3] = alpha;
            w++;
        }
    };
    for (let i = 0; i <= rings; i++) pushRing(i / rings, 0, 0);
    for (let i = 0; i <= capRings; i++) pushRing(0, 1, i / capRings);
    const index = [];
    const strip = (r0, nRings) => {
        for (let i = 0; i < nRings; i++) {
            for (let j = 0; j < segs; j++) {
                const a = (r0 + i) * (segs + 1) + j;
                const b = a + segs + 1;
                index.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    };
    strip(0, rings);
    strip(rings + 1, capRings);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(index);
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aWorm', new THREE.BufferAttribute(data, 4));

    const uB0 = uniform(new THREE.Vector4()); // O.xyz, φ_head
    const uB1 = uniform(new THREE.Vector4(1, 0, 100, 200)); // D.xz, a, b
    const uB2 = uniform(new THREE.Vector4(50, 0, 1, 0)); // k, R (0 = hidden), Lφ, open
    const uB3 = uniform(new THREE.Vector4(0.4, 1.3, 90, 0)); // ω, φ₀, speed

    const aW = attribute('aWorm', 'vec4');
    const sigma = aW.x;
    const theta = aW.y;
    const isCap = aW.z;
    const alpha = aW.w;

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    material.name = 'shifting-sands-worm';
    material.fog = false;

    // ── Vertex: the body on the breach path ──
    const O = uB0.xyz;
    const D = vec3(uB1.x, 0.0, uB1.y);
    const Y = vec3(0.0, 1.0, 0.0);
    const phi = uB0.w.sub(sigma.mul(uB2.z));
    const center = O.add(D.mul(uB1.z.mul(sin(phi)))).add(Y.mul(uB1.w.mul(cos(phi)).sub(uB2.x)));
    const T = normalize(D.mul(uB1.z.mul(cos(phi))).sub(Y.mul(uB1.w.mul(sin(phi)))));
    const Pn = normalize(cross(D, Y));
    const Bn = cross(Pn, T);
    const ring = Pn.mul(cos(theta)).add(Bn.mul(sin(theta)));
    const R = uB2.y;
    const open = uB2.w;

    // Body: annular plates, a fuller neck behind the maw, a long taper to the tail.
    const segPhase = fract(sigma.mul(72.0));
    const plate = smoothstep(0.0, 0.16, segPhase).mul(float(1.0).sub(smoothstep(0.8, 1.0, segPhase)));
    const neck = smoothstep(0.0, 0.05, sigma).mul(float(1.0).sub(smoothstep(0.05, 0.16, sigma)));
    const taper = mix(float(1.0), float(0.3), smoothstep(0.32, 1.0, sigma)).mul(neck.mul(0.06).add(1.0));
    const bodyR = R.mul(taper).mul(plate.mul(0.022).add(0.982));

    // Maw cap: a closed dome peels open into a flared, faintly three-lobed bell.
    const petal = cos(theta.mul(3.0)).mul(0.5).add(0.5).mul(0.25);
    const a = alpha.mul(1.5708);
    const rClosed = R.mul(cos(a));
    const fClosed = R.mul(0.75).mul(sin(a));
    const rOpen = R.mul(float(1.0).add(alpha.pow(1.6).mul(float(0.42).add(petal))));
    const fOpen = R.mul(alpha.mul(0.22));
    const capR = mix(rClosed, rOpen, open);
    const capF = mix(fClosed, fOpen, open);
    const capN = normalize(mix(ring.mul(cos(a)).add(T.mul(sin(a))), ring.mul(0.75).sub(T.mul(0.66)), open));

    const radius = mix(bodyR, capR, isCap);
    const worldPos = center.add(ring.mul(radius)).add(T.mul(capF.mul(isCap)));
    const geomNormal = normalize(mix(ring, capN, isCap));

    material.vertexNode = Fn(() => cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPos, 1.0))))();

    material.colorNode = Fn(() => {
        const wp = vertexStage(worldPos);
        const Ng = normalize(vertexStage(geomNormal));
        // Back faces are the inside of the worm: what the open maw reveals.
        const inside = select(frontFacing, float(0.0), float(1.0));
        const N = Ng.mul(mix(1.0, -1.0, inside)).toVar();
        const vSig = vertexStage(sigma);
        const vTh = vertexStage(theta);
        const vCap = vertexStage(isCap);
        const vAlpha = vertexStage(alpha);
        const vPlate = vertexStage(plate);
        const V = normalize(cameraPosition.sub(wp));

        // ── Hide: dusty grey-ochre plates with dark creases, sand on the back ──
        const n1 = ssTexNoise(noiseTex, vec2(vTh.mul(3.0), vSig.mul(96.0)));
        const hide = mix(vec3(0.2, 0.16, 0.13), vec3(0.31, 0.24, 0.18), n1.x).toVar();
        hide.mulAssign(mix(0.3, 1.0, max(vPlate, vCap)));
        const back = smoothstep(0.35, 0.85, N.y);
        hide.assign(mix(hide, vec3(0.7, 0.41, 0.2), back.mul(0.5).mul(n1.y.mul(0.5).add(0.5))));

        // ── Inside: ember flesh ringed with pale crystal teeth, darkening down the throat ──
        const teethRings = smoothstep(0.55, 0.8, fract(vSig.mul(300.0).add(vAlpha.mul(5.0))));
        const teethCols = smoothstep(0.7, 0.95, abs(fract(vTh.mul(72.0 / 6.2831)).sub(0.5)).mul(2.0));
        const nearMouth = float(1.0).sub(smoothstep(0.0, 0.05, vSig)).mul(float(1.0).sub(vCap))
            .add(vCap.mul(smoothstep(0.15, 0.7, vAlpha)));
        const tooth = teethRings.mul(teethCols).mul(nearMouth);
        const depth = float(1.0).sub(smoothstep(0.0, 0.06, vSig)).mul(float(1.0).sub(vCap)).add(vCap);
        const flesh = mix(vec3(0.02, 0.005, 0.004), vec3(0.2, 0.045, 0.025), depth);
        const insideAlbedo = mix(flesh, vec3(0.8, 0.74, 0.62), tooth.mul(0.7));

        const albedo = mix(hide, insideAlbedo, inside);
        const nlA = dot(N, uSunA);
        const nlB = dot(N, uSunB);
        const direct = uSunLightA.mul(clamp(nlA.mul(1.5), 0.0, 1.0)).add(uSunLightB.mul(clamp(nlB.mul(1.4), 0.0, 1.0)));
        const skyFill = mix(uHorizonCool.mul(0.4), uUpper.mul(0.8).add(uZenith.mul(0.6)), N.y.mul(0.5).add(0.5));
        const light = direct.mul(float(1.0).sub(inside.mul(0.9))).add(skyFill.mul(float(1.0).sub(inside.mul(0.55))));
        const col = albedo.mul(light).toVar();
        // The teeth hold a faint ember glow so the maw reads as depth, not as a hole.
        col.addAssign(vec3(1.0, 0.55, 0.25).mul(tooth.mul(inside).mul(0.22)));
        // Backlit rim: only the true silhouette burns, and only when the suns are behind.
        const rimF = pow(float(1.0).sub(clamp(abs(dot(N, V)), 0.0, 1.0)), 6.0).mul(float(1.0).sub(inside));
        const behind = smoothstep(0.55, 1.0, dot(V.negate(), uSunA).mul(0.5).add(0.5));
        col.addAssign(uSunLightA.mul(rimF.mul(behind).mul(0.9)).mul(vec3(1.0, 0.72, 0.42)));
        // Plate brinks catch the light.
        const brinkN = smoothstep(0.0, 0.12, vPlate).mul(float(1.0).sub(smoothstep(0.12, 0.3, vPlate)))
            .mul(float(1.0).sub(inside));
        col.addAssign(uSunLightA.mul(brinkN.mul(0.05).mul(clamp(nlA.add(0.3), 0.0, 1.0))));
        // Less haze than the sand: the worm stays a silhouette against the suns.
        return vec4(atmosphere.applyAerial(col, wp, 0.45), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'shifting-sands-worm';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;

    return {
        mesh,
        material,
        uniforms: {
            uB0, uB1, uB2, uB3,
        },
        /** Push the director's state into the uniforms (pure writes). */
        apply(state) {
            const br = state.breach;
            if (!br) {
                uB2.value.y = 0; // collapsed: zero area, zero fill
                return;
            }
            uB0.value.set(br.ox, br.oy, br.oz, state.phiHead);
            uB1.value.set(br.dx, br.dz, br.a, br.b);
            uB2.value.set(br.k, br.R, br.span, state.open);
            uB3.value.set(br.omega, br.phi0, br.speed, 0);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
