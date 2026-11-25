/**
 * Galaxy — the deep sky behind it.
 *
 * One dome, shaded per view direction: the void's own colour, a band of lit clouds torn by dark
 * lanes (their faces lit from the galaxy's side), lattices of faint stars, the far galaxies of a
 * deep field (every one a small tilted ellipse of its own colour, and a few nearer ones to a
 * frame: spirals at every tilt, edge-on ones with a lane of dust), the galaxy's own halo, a
 * companion spiral far off on the other side of the board, and what gameplay writes on the sky —
 * the prismatic ring a four-line clear sends out from the nucleus and its echo in the clouds, the
 * companion's own ring on a back-to-back, a perfect clear's gold front, the stars' answer to a
 * clear. Everything far is read in the sky's own frame, which turns slowly about the band's pole.
 *
 * In front of the dome: a handful of foreground stars with diffraction spikes (instanced quads
 * at fixed directions, so they hold still while the galaxy turns in front of them), and a pool
 * of shooting stars — closed-form streaks on a far shell.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    acos,
    atan,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    floor,
    fract,
    fwidth,
    length,
    log,
    max,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    sin,
    smoothstep,
    sqrt,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    TAU, gxBell, gxFxMaterial, gxHash33, gxMax3, gxPart, gxQuadGeometry, mulberry32,
} from './galaxy-tsl.js';

/** Radius of the dome and of the shell the meteors and the foreground stars sit on. */
export const SKY_RADIUS = 9000;

/** The band of lit clouds: a great circle that crosses the frame's upper right, clear of the galaxy. */
const BAND_NORMAL = new THREE.Vector3(0.768, 0.573, 0.284).normalize();
const BAND_ALONG = new THREE.Vector3().crossVectors(BAND_NORMAL, new THREE.Vector3(0, 0, -1)).normalize();
const BAND_ACROSS = new THREE.Vector3().crossVectors(BAND_ALONG, BAND_NORMAL).normalize();
const DEEP_TILT = new THREE.Vector3(0.31, 0.87, 0.38).normalize();
/**
 * Seconds the deep sky takes to turn once about the band's pole. The band's LINE never moves in
 * the frame (its latitude is invariant under the turn); its clouds, its stars and the far galaxies
 * slide along it, about two pixels a second, so the sky behind the galaxy is never the same for
 * long (gotcha #1406).
 */
export const SKY_TURN = 5400;
/** The clouds' own coordinates: tiles of the noise round the band (an integer: no seam), and across it. */
const NEB_REPEAT = 5;
const NEB_ACROSS = 0.85;
/** How far toward the galaxy the clouds' second read steps (tiles): what lights their faces. */
const NEB_LIGHT_STEP = 0.022;
/** How much nearer than the far shell the nearest foreground star hangs (its parallax). */
const GIANT_PARALLAX = 70;

/** World → sky: the band's own frame (x along it, y its pole), turned `turn` radians about the pole. */
export function skyFrame(turn, out) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const A = BAND_ALONG;
    const C = BAND_ACROSS;
    out.set(
        c * A.x + s * C.x,
        c * A.y + s * C.y,
        c * A.z + s * C.z,
        BAND_NORMAL.x,
        BAND_NORMAL.y,
        BAND_NORMAL.z,
        c * C.x - s * A.x,
        c * C.y - s * A.y,
        c * C.z - s * A.z,
    );
    return out;
}

const scratch = new THREE.Vector3();
/** A world direction in the clouds' own coordinates (where the sky reads its noise): CPU twin. */
export function skyCloudPoint(dir, frame, out) {
    scratch.copy(dir).applyMatrix3(frame);
    return out.set(Math.atan2(scratch.z, scratch.x) * (NEB_REPEAT / TAU), scratch.y * NEB_ACROSS);
}

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/**
 * @param {object} u  shared galaxy uniforms
 * @param {object} opts
 * @param {number} [opts.layers=3]       lattices of faint stars
 * @param {boolean} [opts.nebula=true]   the band of lit clouds
 * @param {boolean} [opts.deepField=true]  the far galaxies
 */
export function createSky(u, { layers = 3, nebula = true, deepField = true } = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GalaxySky';
    material.fog = false;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.depthTest = false;

    material.colorNode = Fn(() => {
        const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
        const pixel = length(fwidth(dir)).toVar();
        const toNucleus = dot(dir, u.nucleusDir).toVar();
        // The deep sky's own frame: everything far (clouds, stars, the deep field) is read in it.
        const q = u.skyRot.mul(dir).toVar();
        const b = q.y.toVar();
        const band = exp(b.mul(b).mul(-26.0)).toVar();
        // The void is not flat: a breath of the nebulae's colours, deeper toward the frame's edge.
        const col = u.voidCol.mul(b.mul(0.45).add(1.0)).toVar();
        // The angle from the nucleus: what its rings and the crown's front are measured in.
        const sky = acos(clamp(toNucleus, -1.0, 1.0)).toVar();
        // A perfect clear's gold front across the sky: every far light it passes answers.
        const crownAge = u.time.sub(u.crownWave.x).toVar();
        const crown = gxBell(sky.sub(crownAge.mul(0.55)).div(0.2)).mul(exp(max(crownAge, 0.0).mul(-0.8)))
            .mul(step(0.0, crownAge))
            .mul(u.crownWave.y)
            .toVar();
        // An eruption's ring leaves the sky lit behind it for a moment: its echo in the clouds.
        const echoAge = u.time.sub(u.shock.x).toVar();
        const echo = smoothstep(0.0, 0.3, echoAge.mul(0.75).sub(sky)).mul(exp(max(echoAge, 0.0).mul(-1.1)))
            .mul(step(0.0, echoAge))
            .mul(u.shock.y)
            .toVar();
        const breath = u.breath.mul(0.6).add(0.4).toVar();

        // ── Lit clouds: wisps torn by dark lanes, their faces lit from the galaxy's side ──
        if (nebula) {
            const lon = atan(q.z, q.x);
            const base = vec2(lon.mul(NEB_REPEAT / TAU), b.mul(NEB_ACROSS)).toVar();
            const c1 = u.noiseLod(base.add(vec2(0.13, 0.31)), 0.0).toVar();
            // The same body one step nearer the galaxy (the short way round the band): where the
            // cloud thickens away from the light, its face looks at it (gotcha #263).
            const wayX = u.skyLight.x.sub(base.x);
            const way = vec2(wayX.sub(floor(wayX.div(NEB_REPEAT).add(0.5)).mul(NEB_REPEAT)), u.skyLight.y.sub(base.y));
            const toward = way.div(max(length(way), 1e-3)).mul(NEB_LIGHT_STEP);
            const c1L = u.noiseLod(base.add(toward).add(vec2(0.13, 0.31)), 0.0).r;
            // The second read is carried by the first and drifts against it: wisps that form and melt.
            const c2 = u.noiseLod(
                base.mul(3.0).add(c1.rg.mul(0.42)).add(vec2(u.time.mul(0.0006).add(0.52), u.time.mul(-0.0004).add(0.07))),
                0.0,
            ).toVar();
            const dens = c1.r.mul(0.6).add(c2.g.mul(0.4)).toVar();
            const body = smoothstep(0.36, 0.84, dens).toVar();
            const facing = clamp(c1.r.sub(c1L).mul(7.0).add(0.5), 0.0, 1.0).toVar();
            const thread = float(1.0).sub(abs(c2.a.mul(2.0).sub(1.0)));
            const filaments = thread.mul(thread).mul(thread).mul(smoothstep(0.3, 0.7, c1.b));
            const lanes = smoothstep(0.42, 0.72, c2.r.mul(0.6).add(c1.a.mul(0.4)));
            const tint = mix(u.nebulaA, u.nebulaB, smoothstep(0.3, 0.72, c1.g)).toVar();
            // A lit face pales toward the light that falls on it.
            const litTone = mix(tint, u.core, 0.3).add(vec3(0.06));
            // The band carries most of it; loose clouds stand elsewhere, none over the galaxy itself.
            const where = band.add(smoothstep(0.5, 0.82, c1.b).mul(0.34))
                .mul(float(1.0).sub(smoothstep(0.9, 0.995, toNucleus).mul(0.7)));
            const glow = tint.mul(body.mul(body).mul(0.075))
                .add(litTone.mul(body.mul(facing.mul(facing)).mul(0.17)
                    .add(filaments.mul(body).mul(facing.mul(0.9).add(0.35)).mul(0.2))));
            col.addAssign(glow.mul(where).mul(float(1.0).sub(lanes.mul(0.85))).mul(u.halo.w)
                .mul(echo.mul(2.4).add(1.0))
                .mul(breath));
            // And a breath of it everywhere, so the void between is never flat.
            col.addAssign(mix(u.nebulaB, u.nebulaA, c2.b).mul(c1.a.mul(c1.a)).mul(0.004));
        }

        // ── The galaxy's own halo: old light far round it, so the disc hangs in its glow ──
        If(toNucleus.greaterThan(0.84), () => {
            const off = dir.sub(u.nucleusDir.mul(toNucleus));
            const minor = u.axis.sub(u.nucleusDir.mul(dot(u.axis, u.nucleusDir)));
            const y = dot(off, minor).div(max(length(minor), 1e-3));
            const x2 = max(dot(off, off).sub(y.mul(y)), 0.0);
            const rho2 = x2.add(y.mul(y).div(u.halo.y.mul(u.halo.y))).div(u.halo.x.mul(u.halo.x));
            const k = float(1.0).div(rho2.add(1.0));
            col.addAssign(mix(u.core, u.armInner, 0.18).mul(k.mul(sqrt(k)).mul(u.halo.z))
                .mul(smoothstep(0.84, 0.9, toNucleus))
                .mul(breath));
        });

        // ── Stars: one per cell of a lattice the sphere of directions cuts through ──
        const starLayer = (scale, density, size, gain) => {
            const p = q.mul(scale);
            const id = floor(p);
            const h = gxHash33(id);
            const f = fract(p).sub(h.xyz.mul(0.6).add(0.2));
            const d = length(f.sub(q.mul(dot(f, q))));
            // Never smaller than a pixel: a sub-pixel star would shimmer as the camera drifts.
            const r = max(float(size), pixel.mul(scale).mul(0.8));
            const core = exp(d.mul(d).div(r.mul(r)).mul(-3.0)).mul(float(size).div(r).mul(float(size).div(r)));
            const mag = h.z.mul(h.z).mul(h.z).mul(h.z).mul(0.92)
                .add(0.08);
            const twinkle = sin(u.time.mul(h.y.mul(3.0).add(0.8)).add(h.x.mul(40.0))).mul(0.22).add(0.78);
            const warm = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.8, 0.66), smoothstep(0.55, 1.0, h.y));
            return warm.mul(core.mul(mag).mul(twinkle).mul(step(h.x, density)).mul(gain));
        };
        const LAYERS = [[58.0, 0.4, 0.03, 5.5], [150.0, 0.4, 0.028, 2.2], [330.0, 0.34, 0.026, 1.0]];
        let stars = vec3(0.0);
        for (let i = 0; i < Math.min(layers, LAYERS.length); i++) {
            const [scale, density, size, gain] = LAYERS[i];
            stars = stars.add(starLayer(scale, i === 0 ? density : band.mul(0.3).add(density), size, gain));
        }
        // The nucleus's glare drowns the faint ones beside it.
        const glare = float(1.0).sub(smoothstep(0.985, 0.9996, toNucleus).mul(0.7)).toVar();
        const far = glare.mul(u.breath.mul(0.5).add(0.5)).toVar();
        const gold = vec3(1.0, 0.8, 0.46);
        col.addAssign(mix(stars, gold.mul(gxMax3(stars)), clamp(crown, 0.0, 1.0).mul(0.7))
            .mul(far)
            .mul(u.skyPulse.mul(0.9).add(1.0).add(crown.mul(9.0)).add(echo.mul(0.8))));

        // ── A deep field: far galaxies, each a small tilted ellipse ──
        if (deepField) {
            const scale = 23.0;
            const p = q.mul(scale);
            const id = floor(p);
            const h = gxHash33(id.add(vec3(7.0, 3.0, 11.0))).toVar();
            const f = fract(p).sub(h.xyz.mul(0.5).add(0.25)).toVar();
            const flat = f.sub(q.mul(dot(f, q))).toVar();
            const e1 = normalize(cross(q, vec3(DEEP_TILT.x, DEEP_TILT.y, DEEP_TILT.z))).toVar();
            const e2 = cross(q, e1).toVar();
            const turn = h.y.mul(Math.PI);
            const gx = dot(flat, e1);
            const gy = dot(flat, e2);
            const rx = gx.mul(cos(turn)).add(gy.mul(sin(turn)));
            const ry = gy.mul(cos(turn)).sub(gx.mul(sin(turn))).div(h.z.mul(0.7).add(0.24));
            const size = max(h.x.mul(h.x).mul(0.085).add(0.03), pixel.mul(scale).mul(1.2));
            const d2 = rx.mul(rx).add(ry.mul(ry)).div(size.mul(size));
            const body = exp(d2.mul(-2.4)).mul(0.42).add(exp(d2.mul(-30.0)).mul(0.9));
            const hue = mix(vec3(1.0, 0.72, 0.5), vec3(0.55, 0.7, 1.0), fract(h.z.mul(7.3)));
            const present = step(fract(h.x.mul(5.7)), 0.3);
            col.addAssign(mix(hue, gold, clamp(crown, 0.0, 1.0).mul(0.6)).mul(body).mul(present).mul(0.3)
                .mul(far)
                .mul(crown.mul(6.0).add(1.0)));

            // ── And nearer ones, a few to a frame: spirals seen at every tilt, an edge-on one
            // with its lane of dust down the middle ──
            const pG = q.mul(6.5);
            const idG = floor(pG);
            const hG = gxHash33(idG.add(vec3(19.0, 5.0, 31.0))).toVar();
            If(hG.x.lessThan(0.36), () => {
                const fG = fract(pG).sub(hG.yzx.mul(0.36).add(0.32)).toVar();
                const flatG = fG.sub(q.mul(dot(fG, q))).toVar();
                const turnG = hG.y.mul(Math.PI * 2);
                const ax = dot(flatG, e1).mul(cos(turnG)).add(dot(flatG, e2).mul(sin(turnG))).toVar();
                const ay = dot(flatG, e2).mul(cos(turnG)).sub(dot(flatG, e1).mul(sin(turnG))).toVar();
                const tilt = hG.z.mul(hG.z).mul(0.8).add(0.12).toVar();
                const sizeG = fract(hG.x.mul(31.7)).mul(0.055).add(0.04).toVar();
                const X = ax.div(sizeG).toVar();
                const Y = ay.div(sizeG.mul(tilt)).toVar();
                const rr = sqrt(X.mul(X).add(Y.mul(Y))).toVar();
                const faceOn = smoothstep(0.3, 0.6, tilt).toVar();
                const arm = cos(atan(Y, X).sub(log(max(rr, 0.05)).mul(2.6)).mul(2.0).add(hG.y.mul(40.0))).mul(0.5)
                    .add(0.5);
                const discG = exp(rr.mul(-2.6))
                    .mul(mix(float(1.0), arm.mul(arm).mul(smoothstep(0.15, 0.5, rr)).mul(1.5).add(0.3), faceOn));
                const coreG = exp(rr.mul(rr).mul(-26.0)).mul(1.2);
                const laneQ = ay.div(sizeG.mul(0.045));
                const laneG = exp(laneQ.mul(laneQ).negate()).mul(float(1.0).sub(faceOn))
                    .mul(smoothstep(0.08, 0.3, abs(X)));
                const hueG = mix(vec3(1.0, 0.74, 0.52), vec3(0.5, 0.68, 1.0), fract(hG.z.mul(7.3)));
                const lightG = hueG.mul(discG.mul(0.5)).add(vec3(1.0, 0.9, 0.76).mul(coreG.mul(0.5)));
                col.addAssign(mix(lightG, gold.mul(gxMax3(lightG)), clamp(crown, 0.0, 1.0).mul(0.6))
                    .mul(float(1.0).sub(laneG.mul(0.85)))
                    .mul(float(1.0).sub(smoothstep(1.7, 2.5, rr)))
                    .mul(far)
                    .mul(crown.mul(4.0).add(1.0))
                    .mul(0.34));
            });
        }

        // ── The companion: a small spiral of its own, far off ──
        const cd = u.companionDir;
        const toCompanion = dot(dir, cd).toVar();
        If(toCompanion.greaterThan(cos(u.companion.x.mul(2.2))), () => {
            const ex = normalize(cross(vec3(0.0, 1.0, 0.0), cd));
            const ey = cross(cd, ex);
            const ang = u.companion.x;
            const lean = u.companion.z;
            const px = dot(dir, ex).div(ang);
            const py = dot(dir, ey).div(ang);
            const lx = px.mul(cos(lean)).add(py.mul(sin(lean))).toVar();
            const ly = py.mul(cos(lean)).sub(px.mul(sin(lean))).div(0.52).toVar();
            const cr = sqrt(lx.mul(lx).add(ly.mul(ly))).toVar();
            const facing = float(1.0).sub(smoothstep(1.0, 1.5, cr));
            const ca = atan(ly, lx);
            const cPhase = ca.sub(log(max(cr, 0.04).div(0.1)).mul(2.3)).mul(2.0).add(u.companion.y).toVar();
            const cArm = cos(cPhase).mul(0.5).add(0.5).toVar();
            // Its own lanes of dust on the arms' inner edges, and knots of young light along them.
            const cLane = cos(cPhase.sub(1.0)).mul(0.5).add(0.5);
            const cKnots = cos(cPhase.mul(0.5).add(cr.mul(21.0))).mul(0.5).add(0.5);
            const cDisc = exp(cr.mul(-3.4))
                .mul(cArm.mul(cArm).mul(smoothstep(0.08, 0.3, cr)).mul(cKnots.mul(cKnots).mul(0.9).add(0.75)).add(0.22))
                .mul(float(1.0).sub(cLane.mul(cLane).mul(cLane).mul(smoothstep(0.1, 0.3, cr)).mul(0.55)));
            const cCore = exp(cr.mul(cr).mul(-80.0)).mul(1.5).add(exp(cr.mul(cr).mul(-13.0)).mul(0.4));
            // It wakes (companion.w) when the player's run burns hot: a back-to-back, a fever, a
            // perfect clear. Its core takes most of it, its arms a little.
            const wake = u.companion.w;
            const armsLight = mix(mix(u.nebulaB, u.armOuter, 0.5), u.nursery, cKnots.mul(cArm).mul(0.35)).add(vec3(0.12))
                .mul(cDisc)
                .mul(wake.mul(0.9).add(1.0));
            // Awake, its heart burns and a soft glow stands round it, so the small far spiral reads.
            const beacon = exp(cr.mul(cr).mul(-2.2)).mul(wake).mul(0.12);
            col.addAssign(armsLight.mul(0.7)
                .add(u.core.mul(cCore.mul(wake.mul(3.5).add(1.0)).add(beacon)).mul(0.62))
                .mul(facing)
                .mul(breath));
        });

        // ── A four-line clear's ring across the sky, split like light through a prism ──
        // Two rings may cross it at once (an eruption's, and a twist's or a new level's); a
        // back-to-back sends a third from the companion.
        const ring = (shock, angle) => {
            const age = u.time.sub(shock.x);
            const front = age.mul(0.75);
            const prism = vec3(
                gxBell(angle.sub(front).div(0.007)),
                gxBell(angle.sub(front.mul(0.992)).div(0.007)),
                gxBell(angle.sub(front.mul(0.984)).div(0.007)),
            ).add(gxBell(angle.sub(front.mul(0.992)).div(0.03)).mul(0.1));
            return prism.mul(exp(max(age, 0.0).mul(-2.2))).mul(step(0.0, age)).mul(shock.y).mul(0.6);
        };
        col.addAssign(ring(u.shock, sky).add(ring(u.shockB, sky)));
        If(u.time.sub(u.shockC.x).lessThan(3.0), () => {
            col.addAssign(ring(u.shockC, acos(clamp(toCompanion, -1.0, 1.0))).mul(vec3(0.75, 0.9, 1.25)));
        });
        // The crown's own front: a soft gold sheet, the far lights carry the rest.
        col.addAssign(gold.mul(crown.mul(0.05)));

        return vec4(col, 1.0);
    })();

    const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16);
    return gxPart('GalaxySky', geometry, material, -30);
}

// ── Foreground stars ────────────────────────────────────────────────────────────

/**
 * @param {object} u      shared galaxy uniforms
 * @param {Array} giants  the plan's foreground stars
 * @param {number} count  stars drawn (a prefix of the plan: the brightest)
 */
export function createGiants(u, giants, count) {
    const n = Math.max(1, Math.min(giants.length, Math.round(count)));
    const aDir = new Float32Array(n * 4);
    const aLook = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const g = giants[i];
        aDir.set([g.dir[0], g.dir[1], g.dir[2], g.size], i * 4);
        aLook.set([g.temp, g.phase, g.near ?? 0], i * 3);
    }
    const geometry = gxQuadGeometry(n, { aDir: [aDir, 4], aLook: [aLook, 3] });
    const dirSize = attribute('aDir', 'vec4');
    const look = attribute('aLook', 'vec3');
    const material = gxFxMaterial('GalaxyGiants');
    // A few hang nearer than the rest: they slide against the galaxy as the eye drifts, and that
    // is what puts the galaxy behind them.
    const clip = viewProjection(
        cameraPosition.mul(float(1.0).sub(look.z.mul(GIANT_PARALLAX))).add(dirSize.xyz.mul(SKY_RADIUS * 0.9)),
    );
    const px = dirSize.w.mul(u.viewport.y).mul(0.026);
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const twinkle = sin(u.time.mul(look.y.mul(1.7).add(0.6)).add(look.y.mul(60.0))).mul(0.16).add(0.84);
    const tone = mix(vec3(1.0, 0.74, 0.52), vec3(0.62, 0.76, 1.0), smoothstep(0.25, 0.8, look.x));
    const vLight = varying(tone.mul(dirSize.w.mul(dirSize.w).mul(2.0).add(0.3)).mul(twinkle), 'gxGiant');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d2 = q.dot(q);
        const fade = float(1.0).sub(smoothstep(0.75, 1.0, abs(q.x)))
            .mul(float(1.0).sub(smoothstep(0.75, 1.0, abs(q.y))));
        const point = exp(d2.mul(-130.0)).mul(3.2).add(exp(d2.mul(-16.0)).mul(0.16));
        const spikes = exp(abs(q.y).mul(-60.0)).mul(exp(abs(q.x).mul(-4.2)))
            .add(exp(abs(q.x).mul(-60.0)).mul(exp(abs(q.y).mul(-4.2))));
        return vec4(vLight.mul(point.add(spikes.mul(0.55))).mul(fade).mul(u.skyPulse.mul(0.6).add(1.0))
            .mul(u.breath.mul(0.5).add(0.5)), 0.0);
    })();
    const part = gxPart('GalaxyGiants', geometry, material, -20);
    part.count = n;
    return part;
}

// ── Meteors ─────────────────────────────────────────────────────────────────────

/** Seconds of sky a meteor's streak covers. */
const METEOR_TAIL = 0.2;

/**
 * A pool of shooting stars. Each is a closed-form streak: born at a point of the sky shell, it
 * runs along its heading and burns out.
 */
export function createMeteors(u, count) {
    const aStart = new Float32Array(count * 4);
    const aRun = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    // Dormant meteors wait on the shell ahead of the camera, never on it.
    for (let i = 0; i < count; i++) aStart.set([0, 0, -SKY_RADIUS * 0.88, -100], i * 4);
    const geometry = gxQuadGeometry(count, { aStart: [aStart, 4], aRun: [aRun, 4], aTint: [aTint, 4] });
    ['aStart', 'aRun', 'aTint'].forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const start = attribute('aStart', 'vec4');
    const run = attribute('aRun', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = gxFxMaterial('GalaxyMeteors');
    const tau = u.time.sub(start.w);
    const life = run.w;
    const alive = step(0.0, tau).mul(step(tau, life));
    const at = (t) => cameraPosition.add(start.xyz.add(run.xyz.mul(t)));
    const t1 = clamp(tau, 0.0, life);
    const c0 = viewProjection(at(max(t1.sub(METEOR_TAIL), 0.0)));
    const c1 = viewProjection(at(t1));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dirPx = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dirPx.y.negate(), dirPx.x);
    const clip = mix(c0, c1, along);
    const widthPx = tint.w.mul(u.viewport.y.div(1080.0)).mul(alive);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const k = clamp(tau.div(max(life, 0.01)), 0.0, 1.0);
    const burn = smoothstep(0.0, 0.12, k).mul(float(1.0).sub(smoothstep(0.6, 1.0, k)));
    const vLight = varying(tint.rgb.mul(burn).mul(alive), 'gxMeteor');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const head = st.x.mul(st.x).mul(st.x);
        return vec4(vLight.mul(across.mul(across)).mul(head).mul(u.breath), 0.0);
    })();

    const part = gxPart('GalaxyMeteors', geometry, material, 26);
    let volleys = 0;
    /** When each slot's meteor burns out: a new one takes a spent slot, else the one nearest its end. */
    const ends = new Float64Array(count).fill(-Infinity);
    const take = () => {
        let pick = 0;
        for (let i = 1; i < count; i++) if (ends[i] < ends[pick]) pick = i;
        return pick;
    };
    /**
     * Throw `n` meteors, spread over `stagger` seconds. With a `radiant` (a unit vector) they
     * leave that point of the sky in every direction — the nucleus spitting stars; without one
     * they cross the upper sky toward the galaxy.
     */
    part.emit = ({
        n = 1, time, rgb = [1, 1, 1], stagger = 0, radiant = null, size = 2.2,
    }) => {
        const rand = mulberry32(0x3e7 + volleys * 6151);
        volleys += 1;
        const R = SKY_RADIUS * 0.88;
        for (let j = 0; j < Math.min(n, count); j++) {
            const i = take();
            let sx;
            let sy;
            let sz;
            let hx;
            let hy;
            let hz;
            if (radiant) {
                // A tangent frame at the radiant; each meteor takes its own bearing in it.
                const [rx, ry, rz] = radiant;
                const tl = Math.hypot(rz, rx) || 1;
                const ax = [rz / tl, 0, -rx / tl];
                const bx = [ry * ax[2] - rz * ax[1], rz * ax[0] - rx * ax[2], rx * ax[1] - ry * ax[0]];
                const bearing = rand() * TAU;
                const cb = Math.cos(bearing);
                const sb = Math.sin(bearing);
                hx = ax[0] * cb + bx[0] * sb;
                hy = ax[1] * cb + bx[1] * sb;
                hz = ax[2] * cb + bx[2] * sb;
                const lead = 0.02 + rand() * 0.07;
                sx = rx + hx * lead;
                sy = ry + hy * lead;
                sz = rz + hz * lead;
            } else {
                const az = (rand() - 0.5) * 1.5;
                const el = 0.12 + rand() * 0.34;
                sx = Math.sin(az) * Math.cos(el);
                sy = Math.sin(el);
                sz = -Math.cos(az) * Math.cos(el);
                hx = -0.6 - rand() * 0.4;
                hy = -0.3 - rand() * 0.3;
                hz = (rand() - 0.5) * 0.2;
            }
            const speed = R * (radiant ? 0.22 + rand() * 0.3 : 0.4 + rand() * 0.35);
            const born = time + rand() * stagger;
            const burns = 0.5 + rand() * 0.5;
            aStart.set([sx * R, sy * R, sz * R, born], i * 4);
            aRun.set([hx * speed, hy * speed, hz * speed, burns], i * 4);
            ends[i] = born + burns;
            const g = 2.2 + rand() * 2.6;
            aTint.set([rgb[0] * g, rgb[1] * g, rgb[2] * g, size * (0.7 + rand() * 0.7)], i * 4);
        }
        geometry.getAttribute('aStart').needsUpdate = true;
        geometry.getAttribute('aRun').needsUpdate = true;
        geometry.getAttribute('aTint').needsUpdate = true;
    };
    part.reset = () => {
        for (let i = 0; i < count; i++) aStart[i * 4 + 3] = -100;
        geometry.getAttribute('aStart').needsUpdate = true;
        ends.fill(-Infinity);
        volleys = 0;
    };
    /** Meteors still to burn out at `time` (a fever's storm spends only what the sky has free). */
    part.liveAt = (time) => {
        let live = 0;
        for (let i = 0; i < count; i++) if (ends[i] > time) live += 1;
        return live;
    };
    part.count = count;
    return part;
}
