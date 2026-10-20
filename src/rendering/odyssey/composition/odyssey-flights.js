/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE LOWLAND FLIGHTS — gulls over the surf, swallows over the meadows, a skein of geese across
 * the massif (chapters 3-4).
 *
 * Above the water Act II had no life at all until the chapter-5 kettle: a shore with no gulls, a
 * meadow with no swallows, and nothing moving across the ~1 km view of the massif every parked
 * orb looks at. Three flocks now live there, all in ONE instanced draw:
 *   - GULLS wheel in loose, drifting loops over the beach line ahead of the shore orbs (L11-L18),
 *     white and front-lit (the act's sun stands behind the camera), gliding with a beat now and
 *     then — mostly against the sea and the sand, some climbing against the sky;
 *   - SWALLOWS dart in quick figure-of-eights at eye height a little ahead of the meadow orbs
 *     (L16-L24): small, dark, fast wingbeats between glides — the scale cue the near field lacked;
 *   - a SKEIN of geese crosses in front of the massif's face in a V, west to east, once every
 *     `period` seconds, flapping steadily — a slow event every parked view of chapters 3-4 shares.
 *
 * Every bird is CLOSED FORM in the vertex stage (position at t, heading from the position a
 * moment later, bank from the turn), so nothing is written per frame but the clock and three
 * reveal values. Orientation is built from WORLD UP (never `setFromUnitVectors(+z, heading)`,
 * which flips a bird belly-up), and a turn to the right rolls the right wing DOWN.
 *
 * ZERO-HITCH (ADR-0020), the summit birds' pattern: one opaque draw, built with the board's
 * presentation group before the reveal; afterwards only uniforms change — each flock is revealed
 * by SCALE (`uReveal` per flock), so no blend state and no pipeline ever changes.
 * BISECT LEVER (board): `?odysseyNoFlights=1`.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, fract, length, mix, normalize, positionLocal,
    positionWorld, select, sin, smoothstep, uniform, uniformArray, varying, vec3,
} from 'three/tsl';

const TAU = Math.PI * 2;
/** How far a gull's loop centre wanders over a minute or so (world units). */
const GULL_DRIFT = 22;

/** Bird kinds (the `kind` field of a flock) — selects the flight model and the plumage. */
export const FLIGHT_KIND = Object.freeze({ GULL: 0, SWALLOW: 1, GOOSE: 2 });

/**
 * The flocks. Windows are [fade in from, fully in by, fade out from, gone by] in JOURNEY progress
 * (chapter 3 is 0.1427-0.2457, chapter 4 0.2457-0.3489). Positions are world units; `span` is a
 * bird's wingspan in world units (artistically large: a 1.4 m gull at 150 u is a 6 px speck).
 * Sited on the CPU height mirror against the real rail (see odyssey-flights.test.js).
 */
export const ODYSSEY_FLIGHTS = Object.freeze([
    Object.freeze({
        id: 'gulls',
        kind: FLIGHT_KIND.GULL,
        count: 12,
        // Two parties over the surf: one off the shore to the left of the rail (the coast the
        // L13-L14 shots turn to), one over the beach line the rail crosses at z ~ -215 (ahead of
        // L11-L12 and L15-L16).
        centre: Object.freeze([-238, 331, -176]),
        centreB: Object.freeze([28, 322, -204]),
        spread: Object.freeze([46, 26]), // each bird's own loop centre, +-x / +-z
        radius: Object.freeze([18, 38]),
        height: Object.freeze([-6, 18]),
        lapSeconds: Object.freeze([16, 27]),
        span: 4.2,
        window: Object.freeze([0.132, 0.142, 0.221, 0.234]),
    }),
    Object.freeze({
        id: 'swallows',
        kind: FLIGHT_KIND.SWALLOW,
        count: 12,
        // Two hunting parties at eye height beside the meadow stretch of the rail: one off its
        // right (seen from L16-L21), one off its left further on (L20-L24); never nearer the eye
        // than ~20 u.
        centre: Object.freeze([-104, 352, -318]),
        centreB: Object.freeze([-252, 374, -420]),
        spread: Object.freeze([20, 16]),
        radius: Object.freeze([9, 22]),
        height: Object.freeze([-7, 9]),
        lapSeconds: Object.freeze([5.5, 8.5]),
        span: 1.25,
        window: Object.freeze([0.196, 0.206, 0.314, 0.328]),
    }),
    Object.freeze({
        id: 'geese',
        kind: FLIGHT_KIND.GOOSE,
        count: 9,
        // A straight crossing in front of the massif's face, west -> east, climbing gently.
        from: Object.freeze([-760, 455, -470]),
        to: Object.freeze([640, 505, -620]),
        period: 52, // seconds per crossing (the crossing itself is the first `travel` of it)
        travel: 0.78,
        phase: 0.36, // where in its period the skein is at clock 0 (mid-frame at the capture clock)
        spacing: 9,
        span: 6.0,
        window: Object.freeze([0.150, 0.160, 0.325, 0.340]),
    }),
]);

/** Deterministic lanes (no Math.random: the same flocks every session). */
export function resolveFlightLanes(flocks = ODYSSEY_FLIGHTS) {
    let state = 0x5f3759df;
    const rnd = () => {
        state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
        state = (state + 0x6d2b79f5) >>> 0;
        return ((state ^ (state >>> 13)) >>> 0) / 4294967296;
    };
    const lanes = [];
    flocks.forEach((flock, flockIndex) => {
        for (let i = 0; i < flock.count; i += 1) {
            if (flock.kind === FLIGHT_KIND.GOOSE) {
                // A V: the leader at rank 0, then alternate sides, one rank further back each pair.
                const rank = Math.ceil(i / 2);
                let side = 0;
                if (i > 0) side = (i % 2 === 1) ? 1 : -1;
                lanes.push({
                    flock: flockIndex,
                    kind: flock.kind,
                    // centre = the formation slot (back, side), radius = rank, height jitter
                    cx: rank,
                    cy: (rnd() - 0.5) * 1.2,
                    cz: side,
                    radius: rank,
                    lap: flock.period,
                    phase: rnd(),
                    seed: rnd(),
                });
                continue;
            }
            const base = (flock.centreB && i % 2 === 1) ? flock.centreB : flock.centre;
            lanes.push({
                flock: flockIndex,
                kind: flock.kind,
                cx: base[0] + ((rnd() - 0.5) * 2 * flock.spread[0]),
                cy: base[1] + flock.height[0] + (rnd() * (flock.height[1] - flock.height[0])),
                cz: base[2] + ((rnd() - 0.5) * 2 * flock.spread[1]),
                radius: flock.radius[0] + (rnd() * (flock.radius[1] - flock.radius[0])),
                lap: (flock.lapSeconds[0] + (rnd() * (flock.lapSeconds[1] - flock.lapSeconds[0])))
                    * (rnd() < 0.5 ? -1 : 1),
                phase: rnd(),
                seed: rnd(),
            });
        }
    });
    return lanes;
}

/**
 * CPU mirror of the vertex stage's `placeAt` (the bird's centre at clock `t`) — for the clearance
 * and framing tests and for siting. Keep in step with `placeAt` below.
 * @returns {{x:number,y:number,z:number}}
 */
export function flightPositionAt(lane, t, flocks = ODYSSEY_FLIGHTS) {
    const flock = flocks[lane.flock];
    if (flock.kind === FLIGHT_KIND.GOOSE) {
        const cyc = ((((t / flock.period) + flock.phase) % 1) + 1) % 1;
        const s = cyc / flock.travel;
        const run = [0, 1, 2].map((k) => flock.to[k] - flock.from[k]);
        const flat = Math.hypot(run[0], run[2]) || 1;
        // back = -(flat run), side = (-flat.z, 0, flat.x): the shader's uGooseBack / uGooseSide.
        const back = [-run[0] / flat, 0, -run[2] / flat];
        const sideV = [-(run[2] / flat), 0, run[0] / flat];
        const sp = flock.spacing;
        const bob = Math.sin((t * 0.9) + (lane.seed * 7)) * 0.45;
        return {
            x: flock.from[0] + (run[0] * s) + (back[0] * lane.cx * sp) + (sideV[0] * lane.cz * lane.cx * sp * 0.72),
            y: flock.from[1] + (run[1] * s) + lane.cy + bob,
            z: flock.from[2] + (run[2] * s) + (back[2] * lane.cx * sp) + (sideV[2] * lane.cz * lane.cx * sp * 0.72),
            shown: cyc < flock.travel,
        };
    }
    const ang = ((t * TAU) / lane.lap) + (lane.phase * TAU);
    const r = lane.radius;
    if (flock.kind === FLIGHT_KIND.GULL) {
        const wob = (Math.sin((ang * 2) + (lane.seed * 17)) * 0.28) + 1;
        const dx = Math.sin((t * 0.031) + (lane.seed * 40)) * GULL_DRIFT;
        const dz = Math.cos((t * 0.027) + (lane.seed * 23)) * GULL_DRIFT;
        return {
            x: lane.cx + dx + (Math.cos(ang) * r * wob),
            y: lane.cy + (Math.sin((ang * 0.5) + (lane.seed * 9)) * 6),
            z: lane.cz + dz + (Math.sin(ang) * r * wob * 0.8),
            shown: true,
        };
    }
    return {
        x: lane.cx + (Math.sin(ang) * r),
        y: lane.cy + (Math.sin((ang * 2) + (lane.seed * 5)) * r * 0.32),
        z: lane.cz + (Math.sin((ang * 2) + (lane.seed * 3)) * r * 0.62),
        shown: true,
    };
}

/**
 * One bird, in its own space: -Z the nose, +X the right wing, +Y up. `aWing` 0 on the body and
 * at the roots, ~0.45 at the wrist, 1 at the tips (the flap bends there). Unit-ish span 3.8.
 */
function buildBirdTemplate() {
    const positions = [];
    const wing = [];
    const tri = (a, b, c) => {
        [a, b, c].forEach(([x, y, z, w]) => {
            positions.push(x, y, z);
            wing.push(w);
        });
    };
    const nose = [0, 0, -0.95, 0];
    const tail = [0, 0, 0.85, 0];
    const bl = [-0.13, 0, -0.1, 0];
    const br = [0.13, 0, -0.1, 0];
    tri(nose, br, bl);
    tri(bl, br, tail);
    tri(tail, [0.22, 0, 1.15, 0], [-0.22, 0, 1.15, 0]);
    [-1, 1].forEach((side) => {
        const rootF = [0.1 * side, 0, -0.42, 0];
        const rootB = [0.1 * side, 0, 0.28, 0];
        const wristF = [0.92 * side, 0, -0.5, 0.45];
        const wristB = [0.88 * side, 0, 0.12, 0.45];
        const tip = [1.9 * side, 0, 0.18, 1];
        tri(rootF, wristF, rootB);
        tri(rootB, wristF, wristB);
        tri(wristF, tip, wristB);
    });
    return { positions: new Float32Array(positions), wing: new Float32Array(wing) };
}

/** Template span (tip to tip) in template units. */
const TEMPLATE_SPAN = 3.8;

/**
 * @param {object} [opts]
 * @param {object} [opts.hazeColour] TSL vec3 node the far birds haze toward (the world's horizon)
 * @param {object} [opts.sunColour] TSL vec3 node, the world's sun colour (else a daylight white)
 * @param {number[]} [opts.sunDir] direction TOWARD the sun (world); defaults to the Act II sun
 * @param {Array} [opts.flocks] override of ODYSSEY_FLIGHTS (tests, the playground)
 */
export function createOdysseyFlights({
    hazeColour = null, sunColour = null, sunDir = [-0.46, 0.36, 0.61], flocks = ODYSSEY_FLIGHTS,
} = {}) {
    const lanes = resolveFlightLanes(flocks);
    const template = buildBirdTemplate();
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(template.positions, 3));
    geometry.setAttribute('aWing', new THREE.BufferAttribute(template.wing, 1));
    // Two per-instance vec4s: (centre xyz, radius) and (lap seconds, phase, seed, flock index).
    const seat = new Float32Array(lanes.length * 4);
    const motion = new Float32Array(lanes.length * 4);
    lanes.forEach((l, i) => {
        seat.set([l.cx, l.cy, l.cz, l.radius], i * 4);
        motion.set([l.lap, l.phase, l.seed, l.flock], i * 4);
    });
    geometry.setAttribute('aSeat', new THREE.InstancedBufferAttribute(seat, 4));
    geometry.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4));
    geometry.instanceCount = lanes.length;

    const uTime = uniform(0);
    // Per flock: x = reveal (scale), y = kind, z = span (world units), w = spare.
    const flockRows = flocks.map((f) => new THREE.Vector4(0, f.kind, f.span, 0));
    const uFlocks = uniformArray(flockRows, 'vec4');
    // The skein's line (only one goose flock is supported): from, direction*length, timing.
    const goose = flocks.find((f) => f.kind === FLIGHT_KIND.GOOSE) || null;
    const gooseFrom = goose ? new THREE.Vector3(...goose.from) : new THREE.Vector3();
    const gooseTo = goose ? new THREE.Vector3(...goose.to) : new THREE.Vector3(1, 0, 0);
    const gooseRun = gooseTo.clone().sub(gooseFrom);
    const uGooseFrom = uniform(gooseFrom);
    const uGooseRun = uniform(gooseRun);
    const gooseFlat = new THREE.Vector3(gooseRun.x, 0, gooseRun.z).normalize();
    const uGooseSide = uniform(new THREE.Vector3(-gooseFlat.z, 0, gooseFlat.x));
    const uGooseBack = uniform(gooseFlat.clone().negate());

    const aSeat = attribute('aSeat', 'vec4');
    const aMotion = attribute('aMotion', 'vec4');
    const aWing = attribute('aWing', 'float');
    const flockRow = uFlocks.element(aMotion.w.add(0.5).toInt());
    const reveal = flockRow.x;
    const kind = flockRow.y;
    const span = flockRow.z;
    const isGull = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.GULL)), 0, 1));
    const isSwallow = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.SWALLOW)), 0, 1));
    const isGoose = float(1).sub(clamp(abs(kind.sub(FLIGHT_KIND.GOOSE)), 0, 1));
    const seed = aMotion.z;

    /**
     * Where the bird is at clock `t` (world). Gulls: a loop whose radius breathes and whose centre
     * drifts slowly (wandering rounds, not a carousel). Swallows: a fast figure-of-eight with a
     * vertical swoop. Geese: their slot in the V along the skein's line.
     */
    const placeAt = (t) => {
        const lap = aMotion.x;
        const ang = t.mul(TAU).div(lap).add(aMotion.y.mul(TAU));
        const r = aSeat.w;
        // GULL
        const wob = sin(ang.mul(2.0).add(seed.mul(17.0))).mul(0.28).add(1.0);
        const drift = vec3(sin(t.mul(0.031).add(seed.mul(40.0))), 0, cos(t.mul(0.027).add(seed.mul(23.0))))
            .mul(GULL_DRIFT);
        const gull = aSeat.xyz.add(drift)
            .add(vec3(
                cos(ang).mul(r).mul(wob),
                sin(ang.mul(0.5).add(seed.mul(9.0))).mul(6.0),
                sin(ang).mul(r).mul(wob.mul(0.8)),
            ));
        // SWALLOW
        const swal = aSeat.xyz.add(vec3(
            sin(ang).mul(r),
            sin(ang.mul(2.0).add(seed.mul(5.0))).mul(r.mul(0.32)),
            sin(ang.mul(2.0).add(seed.mul(3.0))).mul(r.mul(0.62)),
        ));
        // GOOSE: s runs 0..1 across `travel` of the period; the V trails behind the leader.
        const period = float(goose ? goose.period : 1);
        const cyc = fract(t.div(period).add(goose ? goose.phase : 0));
        const s = cyc.div(goose ? goose.travel : 1);
        const spacing = float(goose ? goose.spacing : 1);
        const gooseP = uGooseFrom.add(uGooseRun.mul(s))
            .add(uGooseBack.mul(aSeat.x.mul(spacing)))
            .add(uGooseSide.mul(aSeat.z.mul(aSeat.x).mul(spacing).mul(0.72)))
            .add(vec3(0, aSeat.y.add(sin(t.mul(0.9).add(seed.mul(7.0))).mul(0.45)), 0));
        return gull.mul(isGull).add(swal.mul(isSwallow)).add(gooseP.mul(isGoose));
    };

    // The bird's own up (its wings' plane normal), for the light (see colorNode).
    const vBirdUp = varying(vec3(0, 1, 0), 'birdUp');
    const positionNode = Fn(() => {
        const t = uTime;
        const dt = float(0.06);
        const p0 = placeAt(t).toVar();
        const p1 = placeAt(t.add(dt)).toVar();
        const pm = placeAt(t.sub(dt)).toVar();
        const vel = p1.sub(pm);
        const fwd = normalize(vel.add(vec3(1e-4, 0, 0))).toVar();
        const up0 = vec3(0, 1, 0);
        const right = normalize(cross(fwd, up0).add(vec3(0, 0, 1e-5))).toVar();
        const up = cross(right, fwd).toVar();
        // Bank into the turn from the lateral acceleration (u/s^2 from the second difference); a
        // right turn dips the right wing. Steep on purpose: a level bird seen from near its own
        // height is a one-pixel line, a banked one shows its whole planform.
        const acc = p1.add(pm).sub(p0.mul(2.0)).div(dt.mul(dt));
        const bankGain = mix(float(0.16), float(0.06), isSwallow);
        const bank = clamp(dot(acc, right).mul(bankGain), -0.95, 0.95);
        const cb = cos(bank);
        const sb = sin(bank);
        const rightB = right.mul(cb).sub(up.mul(sb));
        const upB = up.mul(cb).add(right.mul(sb));
        vBirdUp.assign(upB);

        // WINGS. Gull: mostly gliding in a gull-wing dihedral, a few slow beats now and then.
        // Swallow: bursts of fast beats between glides, wings swept. Goose: steady deep beats.
        const beatOn = smoothstep(0.5, 0.9, sin(t.mul(0.37).add(seed.mul(13.0))));
        const gullLift = aWing.mul(float(0.16).add(beatOn.mul(0.55).mul(sin(t.mul(4.3).add(seed.mul(20.0))))));
        const swalBurst = smoothstep(-0.1, 0.4, sin(t.mul(1.3).add(seed.mul(11.0))));
        const swalLift = aWing.mul(swalBurst.mul(0.75).mul(sin(t.mul(15.0).add(seed.mul(30.0)))).add(0.05));
        const gooseLift = aWing.mul(sin(t.mul(3.1).add(seed.mul(2.0))).mul(0.62).add(0.08));
        const lift = gullLift.mul(isGull).add(swalLift.mul(isSwallow)).add(gooseLift.mul(isGoose));
        // The outer panel lags (a real wingbeat), and swallows sweep their tips back.
        const tipLag = aWing.mul(aWing).mul(beatOn.mul(isGull).add(isGoose.mul(0.6))).mul(0.25)
            .mul(sin(t.mul(4.0).add(seed.mul(20.0)).sub(0.9)));
        const sweep = aWing.mul(isSwallow).mul(0.55);
        // Shape per kind: gulls long narrow wings, swallows short with swept tips, geese long bodies.
        const spanK = mix(mix(float(1.12), float(0.95), isSwallow), float(1.0), isGoose);
        const lenK = mix(mix(float(0.78), float(0.95), isSwallow), float(1.35), isGoose);
        const local = positionLocal;
        const lx = local.x.mul(spanK);
        const ly = local.y.add(lift).add(tipLag);
        const lz = local.z.mul(lenK).add(sweep);
        const size = span.div(TEMPLATE_SPAN).mul(reveal);
        // Skein birds only exist while the V is crossing; the rest of the period it is gone.
        const goosePeriodK = goose ? fract(t.div(goose.period).add(goose.phase)) : float(0);
        const gooseShown = goose
            ? smoothstep(0.0, 0.04, goosePeriodK)
                .mul(float(1).sub(smoothstep(goose.travel - 0.04, goose.travel, goosePeriodK)))
            : float(0);
        const shown = mix(float(1), gooseShown, isGoose);
        const offset = rightB.mul(lx).add(upB.mul(ly)).sub(fwd.mul(lz)).mul(size.mul(shown));
        return p0.add(offset);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    // Plumage. Gulls: white with dark wingtips (front-lit by the sun behind the camera). Swallows:
    // blue-black. Geese: grey-brown. A soft top-light term lets a bird read its form at the size
    // of a speck, and the far ones haze toward the horizon like everything else in the act.
    const sunCol = sunColour ?? vec3(1.0, 0.96, 0.88);
    const sunD = new THREE.Vector3(...sunDir).normalize();
    const haze = hazeColour ?? vec3(0.71, 0.81, 0.91);
    const albedo = Fn(() => {
        const tipDark = smoothstep(0.62, 0.9, aWing);
        const gullCol = mix(vec3(0.86, 0.87, 0.88), vec3(0.16, 0.17, 0.19), tipDark);
        const swalCol = vec3(0.045, 0.05, 0.085);
        const gooseCol = mix(vec3(0.30, 0.27, 0.23), vec3(0.10, 0.09, 0.085), smoothstep(0.7, 1.0, aWing));
        return gullCol.mul(isGull).add(swalCol.mul(isSwallow)).add(gooseCol.mul(isGoose));
    })();
    // The side of the wings the eye sees: from below, a bird is its shaded underside (a grey
    // shape on the bright sky); from above, its sunlit back (a white or dark shape on the land).
    const range = length(positionWorld.sub(cameraPosition));
    const toEye = cameraPosition.sub(positionWorld);
    const faceUp = normalize(vBirdUp);
    const seenN = select(dot(faceUp, toEye).lessThan(0.0), faceUp.negate(), faceUp);
    const lit = clamp(dot(seenN, vec3(sunD.x, sunD.y, sunD.z)), 0, 1).mul(0.85);
    material.colorNode = mix(
        albedo.mul(sunCol.mul(lit).add(haze.mul(0.30))),
        haze,
        smoothstep(float(180.0), float(1400.0), range).mul(0.6),
    );
    material.side = THREE.DoubleSide;
    material.depthWrite = true;
    // It carries its own colour-with-distance; scene fog is the chapter-profile lerp.
    material.fog = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'odyssey-flights';
    mesh.frustumCulled = false;
    mesh.visible = false;

    const windowWeight = (w, p) => THREE.MathUtils.smoothstep(p, w[0], w[1])
        * (1 - THREE.MathUtils.smoothstep(p, w[2], w[3]));

    return {
        mesh,
        lanes,
        uniforms: { uTime, uFlocks },
        /** Reveal per flock at journey progress `p` (0..1 each). */
        revealAt(p) {
            return flocks.map((f) => windowWeight(f.window, p));
        },
        /**
         * @param {number} time seconds (the board clock)
         * @param {number} progress journey progress 0..1
         */
        update(time, progress) {
            let any = false;
            flocks.forEach((f, i) => {
                const r = windowWeight(f.window, progress);
                flockRows[i].x = r;
                if (r > 0.01) any = true;
            });
            uTime.value = time;
            mesh.visible = any;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.removeFromParent();
        },
    };
}
