/**
 * Grainfields — the herd in the barley.
 *
 * A few Hokkaido native horses (Dosanko: stocky, short-legged, thick-maned; bay, chestnut, dun,
 * grey) graze in the field right of the card, sixty metres out, their backs, necks and heads
 * over the ears; when the storm breaks with a chain they run, and with a T-spin they wheel round
 * in a circle.
 *
 * The horse is authored in Blender (scripts/blender/grainfields/horse.py, loaded by
 * grainfields-assets.js as `assets.horse`): one mesh whose vertex colour names the part each
 * vertex belongs to (R: body, neck and head, the four legs, the tail; G a dark mask for the mane,
 * tail and lower legs; B a light one for the muzzle and belly), with the pivots the parts turn
 * about. The vertex stage poses it: the neck dips to graze and lifts to look, the legs swing in
 * diagonal pairs with the gait, the body rises and falls at the gallop, the tail swishes and
 * streams. Where each horse stands, faces and how fast it goes is a small CPU simulation (a
 * handful of numbers per horse written each frame).
 *
 * Unlit, lit by the shared light: the coat by the sun through the deck and the sky, a rim of
 * light round the silhouette when the sun is behind it, then the air.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    dot,
    float,
    floor,
    mix,
    normalize,
    positionGeometry,
    positionWorld,
    select,
    sin,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    PLACES, TIMING, clamp as clampN, mulberry32,
} from './grainfields-core.js';
import { groundHeight } from './grainfields-plan.js';
import { aerial } from './grainfields-light.js';
import { deckShadow } from './grainfields-tsl.js';

/** The horse's parts by id (its vertex colour's red × 8). */
export const HORSE_PART = Object.freeze({
    body: 0, neck: 1, frontLeft: 2, frontRight: 3, hindLeft: 4, hindRight: 5, tail: 6,
});
/** Coats (linear): bay, chestnut, dun, grey, black-bay. */
const COATS = Object.freeze([
    [0.105, 0.05, 0.022], [0.17, 0.065, 0.025], [0.3, 0.21, 0.11], [0.42, 0.41, 0.39], [0.04, 0.025, 0.018],
]);

/** The herd's numbers: how far it spreads, how fast it walks, gallops and wheels (metres, m/s). */
export const HERD = Object.freeze({
    spread: 14, walk: 1.1, gallop: 9.5, wheelRadius: 18, wheelSpeed: 7.5,
});

/** A point turned about the x axis through a pivot. */
function aboutX(p, pivot, angle) {
    const c = cos(angle);
    const s = sin(angle);
    const q = p.sub(pivot);
    return vec3(q.x, q.y.mul(c).sub(q.z.mul(s)), q.y.mul(s).add(q.z.mul(c))).add(pivot);
}

/** A direction turned about the x axis. */
function dirAboutX(n, angle) {
    const c = cos(angle);
    const s = sin(angle);
    return vec3(n.x, n.y.mul(c).sub(n.z.mul(s)), n.y.mul(s).add(n.z.mul(c)));
}

function herdMaterial(u, t, pivots) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsHerd';
    material.fog = false;
    const aPose = attribute('aPose', 'vec4'); // x, ground y, z, heading
    const aLook = attribute('aLook', 'vec4'); // neck angle, stride, coat, scale
    const aGait = attribute('aGait', 'vec4'); // gait phase, tail swish
    const paint = attribute('color', 'vec4'); // part / 8, dark, light, 1
    const vN = varying(vec3(0.0, 1.0, 0.0), 'gfHerdNormal');
    const vInfo = varying(vec4(0.0), 'gfHerdInfo'); // coat, dark, light, sunlit
    const pv = (name) => vec3(...pivots[name]);
    material.positionNode = Fn(() => {
        const part = floor(paint.x.mul(8.0).add(0.5));
        const scale = aLook.w;
        const p = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();
        const phase = aGait.x;
        const stride = aLook.y;
        // The neck and head dip to graze (positive) and lift to look round.
        const isNeck = part.equal(HORSE_PART.neck);
        p.assign(select(isNeck, aboutX(p, pv('neck'), aLook.x), p));
        nrm.assign(select(isNeck, dirAboutX(nrm, aLook.x), nrm));
        // The legs swing in diagonal pairs (front left with hind right), each about its own joint.
        const swing = sin(phase).mul(stride).mul(0.5);
        const legs = [
            [HORSE_PART.frontLeft, 'frontLeft', 1],
            [HORSE_PART.frontRight, 'frontRight', -1],
            [HORSE_PART.hindLeft, 'hindLeft', -1],
            [HORSE_PART.hindRight, 'hindRight', 1],
        ];
        legs.forEach(([id, name, sign]) => {
            const isLeg = part.equal(id);
            const angle = swing.mul(sign).negate();
            p.assign(select(isLeg, aboutX(p, pv(name), angle), p));
            nrm.assign(select(isLeg, dirAboutX(nrm, angle), nrm));
        });
        // The tail swishes from side to side, and streams out behind at the gallop.
        const isTail = part.equal(HORSE_PART.tail);
        const tailP = aboutX(p, pv('tail'), stride.mul(-0.8));
        const below = pv('tail').y.sub(p.y).max(0.0);
        p.assign(select(isTail, tailP.add(vec3(aGait.y.mul(below), 0.0, 0.0)), p));
        // The body rises and falls with the stride.
        p.y.addAssign(abs(sin(phase)).mul(stride).mul(0.08));
        // Into the world: sized, turned to its heading, standing on the field.
        const c = cos(aPose.w);
        const s = sin(aPose.w);
        const q = p.mul(scale);
        const world = vec3(q.x.mul(c).add(q.z.mul(s)), q.y, q.z.mul(c).sub(q.x.mul(s)));
        vN.assign(normalize(vec3(nrm.x.mul(c).add(nrm.z.mul(s)), nrm.y, nrm.z.mul(c).sub(nrm.x.mul(s)))));
        const foot = aPose.xyz;
        vInfo.assign(vec4(aLook.z, paint.y, paint.z, deckShadow(u, t.noise, foot.add(vec3(0.0, 1.5, 0.0))).mul(u.sunUp)));
        return foot.add(world);
    })();
    material.colorNode = Fn(() => {
        const P = positionWorld.toVar();
        const V = normalize(P.sub(u.eye)).toVar();
        const N = normalize(vN).toVar();
        const k = vInfo.x;
        const coat = vec3(...COATS[0]).toVar();
        for (let i = 1; i < COATS.length; i++) coat.assign(select(k.greaterThan(i - 0.5), vec3(...COATS[i]), coat));
        // The mane, tail and lower legs darker; the muzzle and belly paler.
        const albedo = mix(coat, coat.mul(0.32).add(vec3(0.012, 0.009, 0.007)), vInfo.y)
            .mul(mix(float(1.0), float(1.45), vInfo.z));
        const sunlit = vInfo.w;
        const ndl = clamp(dot(N, u.sunDir), 0.0, 1.0);
        const sky = u.fill.mul(N.y.mul(0.4).add(0.6)).mul(1.4).add(u.bounce.mul(float(1.0).sub(N.y).mul(0.4)));
        const col = albedo.mul(u.sun.mul(ndl).mul(sunlit).add(sky)).toVar();
        // Backlit, a rim of light runs round the silhouette (the coat's hairs lit through).
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const edge = float(1.0).sub(clamp(dot(N, V.negate()), 0.0, 1.0));
        const e2 = edge.mul(edge);
        col.addAssign(u.sun.mul(sunlit).mul(e2.mul(e2)).mul(ahead.mul(ahead)).mul(albedo.add(0.05))
            .mul(1.6));
        return vec4(aerial(u, P, col), 1.0);
    })();
    return material;
}

/**
 * The herd: `count` horses (tier.herd) from the authored horse (`horse` = assets.horse:
 * { geometry, pivots }). Returns null without a horse.
 */
export function createHerd(u, t, count, horse) {
    if (!horse?.geometry || !horse.pivots) return null;
    const n = Math.max(0, Math.min(9, Math.round(count)));
    const instanced = new THREE.InstancedBufferGeometry();
    ['position', 'normal', 'color'].forEach((name) => instanced.setAttribute(name, horse.geometry.attributes[name]));
    instanced.setIndex(horse.geometry.index);
    const poseData = new Float32Array(Math.max(1, n) * 4);
    const lookData = new Float32Array(Math.max(1, n) * 4);
    const gaitData = new Float32Array(Math.max(1, n) * 4);
    const pose = new THREE.InstancedBufferAttribute(poseData, 4);
    const look = new THREE.InstancedBufferAttribute(lookData, 4);
    const gait = new THREE.InstancedBufferAttribute(gaitData, 4);
    [pose, look, gait].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    instanced.setAttribute('aPose', pose);
    instanced.setAttribute('aLook', look);
    instanced.setAttribute('aGait', gait);
    instanced.instanceCount = n;
    const material = herdMaterial(u, t, horse.pivots);
    const mesh = new THREE.Mesh(instanced, material);
    mesh.name = 'GrainfieldsHerd';
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;

    // ── The herd's own small simulation ──
    const H = PLACES.herd;
    let horses = [];
    const state = { runAt: -1e6, wheelAt: -1e6 };
    const place = () => {
        const random = mulberry32(0x40e5);
        horses = Array.from({ length: n }, (_, i) => {
            const a = random() * Math.PI * 2;
            const r = Math.sqrt(random()) * HERD.spread;
            const x = H.x + Math.cos(a) * r;
            const z = H.z + Math.sin(a) * r * 0.6;
            return {
                x,
                z,
                homeX: x,
                homeZ: z,
                heading: random() * Math.PI * 2,
                phase: random() * 6.28,
                speed: 0,
                neck: 0.9,
                coat: i % COATS.length,
                scale: 0.94 + random() * 0.12,
                seed: random(),
            };
        });
        state.runAt = -1e6;
        state.wheelAt = -1e6;
    };
    place();

    return {
        mesh,
        meshes: [mesh],
        get horses() { return horses; },
        /** A chain breaks the storm: the horses run. */
        run(time) { state.runAt = time; },
        /** A T-spin: the horses wheel round. */
        wheel(time) { state.wheelAt = time; },
        /** A seek: every horse back to its grazing place, nothing in flight. */
        reset() { place(); },
        update(time, dt) {
            const runAge = time - state.runAt;
            const wheelAge = time - state.wheelAt;
            const running = runAge >= 0 && runAge < 9;
            const wheeling = wheelAge >= 0 && wheelAge < TIMING.wheel;
            horses.forEach((h, i) => {
                let target = 0;
                let turnTo = h.heading;
                if (wheeling) {
                    // Round the herd's centre, each on its own lane.
                    const r = HERD.wheelRadius * (0.7 + 0.08 * i);
                    const a = Math.atan2(h.z - H.z, h.x - H.x) + 0.8;
                    turnTo = Math.atan2(H.x + Math.cos(a) * r - h.x, H.z + Math.sin(a) * r * 0.7 - h.z);
                    target = HERD.wheelSpeed;
                } else if (running) {
                    // Away across the field to the right, then easing off.
                    turnTo = 1.25 + 0.25 * Math.sin(i * 1.7);
                    target = HERD.gallop * (1 - clampN((runAge - 5) / 4, 0, 1)) + 1.5;
                } else {
                    // Grazing: an occasional slow step, drifting home.
                    const hx = h.homeX - h.x;
                    const hz = h.homeZ - h.z;
                    const away = Math.hypot(hx, hz);
                    const step = Math.sin(time * 0.11 + h.seed * 40) > 0.75;
                    turnTo = away > 4 ? Math.atan2(hx, hz) : h.heading + 0.2 * Math.sin(time * 0.05 + h.seed * 9);
                    target = step || away > 4 ? HERD.walk * (away > 12 ? 2.4 : 1) : 0;
                }
                let dh = turnTo - h.heading;
                dh = Math.atan2(Math.sin(dh), Math.cos(dh));
                h.heading += dh * Math.min(1, dt * (target > 3 ? 2.2 : 0.8));
                h.speed += (target - h.speed) * Math.min(1, dt * 1.6);
                h.x = clampN(h.x + Math.sin(h.heading) * h.speed * dt, H.x - 30, H.x + 45);
                h.z = clampN(h.z + Math.cos(h.heading) * h.speed * dt, H.z - 30, H.z + 14);
                // Gait: the legs' phase runs with the ground covered; the stride with the speed.
                h.phase += dt * (1.6 + h.speed * 1.15);
                const stride = clampN(h.speed / HERD.gallop, 0, 1) * 1.1 + (h.speed > 0.3 ? 0.18 : 0);
                // The neck: down to graze when still, up when moving or every so often to look.
                const looksUp = Math.sin(time * 0.17 + h.seed * 31) > 0.6;
                const neckTo = h.speed > 0.6 || looksUp ? -0.1 : 0.95;
                h.neck += (neckTo - h.neck) * Math.min(1, dt * 1.5);
                const swish = Math.sin(time * (1.3 + h.seed) + h.seed * 20) * 0.22 * (1 - stride * 0.5);
                poseData.set([h.x, groundHeight(h.x, h.z) - 0.06, h.z, h.heading], i * 4);
                lookData.set([h.neck, stride, h.coat, h.scale], i * 4);
                gaitData[i * 4] = h.phase;
                gaitData[i * 4 + 1] = swish;
            });
            pose.needsUpdate = true;
            look.needsUpdate = true;
            gait.needsUpdate = true;
        },
        dispose() {
            instanced.dispose();
            material.dispose();
        },
    };
}
