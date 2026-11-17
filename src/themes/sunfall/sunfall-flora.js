/**
 * Sunfall — what play lets loose in the air, and what the cave breathes out.
 *
 * **Flora** (`buildFlora`): one instanced mesh of small two-sided blades, each a record written
 * once (where, when, how fast, what) and moved in closed form from the world's clock, so a replay
 * draws the same frame and nothing is simulated:
 * - petals shaken off the vines at the rows a clear takes (in the pieces' pigments), drifting
 *   down past the card;
 * - beads of water flung off a strand by a hard drop's snap;
 * - leaves wound up round the sunfall by a twist (the Turning);
 * - a rain of petals down the whole column at a perfect clear;
 * - white birds lifted out of the canopy by a level-up, spiralling up the light and out;
 * - on their own clock: a leaf let go by a strand now and then, a pair of birds crossing.
 *
 * **Vapour** (`buildVapour`): soft puffs that rise and thin: steam off the sunlit crowns after
 * rain (the weather's), the spray boiling up where the cataract lands, the breath a broken
 * chain lets out up the column.
 *
 * Both read the same sun mask as everything else: a petal or a puff is bright only in the light.
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
    exp,
    float,
    floor,
    fract,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    select,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    CANOPY_LEVEL, OCULUS_CENTER, PIECE_CODES, clamp01, footFor, mulberry32,
} from './sunfall-core.js';
import { SUNFALL_LIGHT, pieceSwatchNode, sfSunMask } from './sunfall-tsl.js';
import { flatVarying } from '../shared/flat-varying.js';

/** What a flora record is (its `kind`). */
export const FLORA_KIND = Object.freeze({
    petal: 0, bead: 1, whirl: 2, bird: 3,
});
/** A record's colour code past the seven pieces: a green leaf, a gold one, white. */
export const FLORA_CODE = Object.freeze({ leaf: 7, gold: 8, white: 9 });

const PIECE_INDEX = Object.freeze(Object.fromEntries(PIECE_CODES.map((code, i) => [code, i])));
const FAR_AWAY = -1e6;

export function createFloraMaterial(u) {
    const A = attribute('aFloraA', 'vec4'); // where (or, for a whirl: angle, height, radius), birth
    const B = attribute('aFloraB', 'vec4'); // velocity (or: turn rate, climb, radial drift), life
    const C = attribute('aFloraC', 'vec4'); // colour code, size (m), seed, kind
    const OC = OCULUS_CENTER;

    /** Where the record is now, and what it needs for its frame (shared by both stages). */
    const centreOf = Fn(() => {
        const age = u.time.sub(A.w);
        const seed = C.z;
        const kind = floor(C.w.add(0.5));
        // A petal: thrown, slowed by the air, sinking at its own rate, rocking as it falls.
        const drag = float(1.0).sub(exp(age.mul(-1.4))).div(1.4);
        const sink = mix(1.0, 2.1, fract(seed.mul(7.31))).mul(age);
        const rock = age.mul(mix(1.6, 2.9, fract(seed.mul(3.7)))).add(seed.mul(40.0));
        const sway = vec3(sin(rock), sin(rock.mul(2.0)).mul(0.25), cos(rock.mul(0.83)))
            .mul(mix(0.25, 0.7, fract(seed.mul(11.3)))).mul(smoothstep(0.0, 1.2, age));
        const pFall = A.xyz.add(B.xyz.mul(drag)).add(vec3(0.0, sink.negate(), 0.0)).add(sway);
        // A bead of water: flung, then gravity.
        const pBead = A.xyz.add(B.xyz.mul(age)).add(vec3(0.0, age.mul(age).mul(-4.9), 0.0));
        // A whirl: round the sunfall's axis, climbing.
        const y = A.y.add(B.y.mul(age));
        const th = A.x.add(B.x.mul(age));
        const r = max(A.z.add(B.z.mul(age)), 2.0);
        const S = u.sunDir;
        const axis = vec3(OC[0], OC[1], OC[2]).sub(S.mul(float(OC[1]).sub(y).div(max(S.y, 0.15))));
        const pWhirl = axis.add(vec3(cos(th).mul(r), sin(th.mul(1.7).add(seed.mul(9.0))).mul(3.0), sin(th).mul(r)));
        return select(kind.lessThan(0.5), pFall, select(kind.lessThan(1.5), pBead, pWhirl));
    });

    const positionNode = Fn(() => {
        const age = u.time.sub(A.w).toVar();
        const life = max(B.w, 0.01);
        const k = clamp(age.div(life), 0.0, 1.0).toVar();
        const live = step(0.0, age).mul(step(age, life));
        const seed = C.z;
        const kind = floor(C.w.add(0.5)).toVar();
        const centre = centreOf().toVar();
        const toCam = cameraPosition.sub(centre).toVar();
        const dist = length(toCam);
        // It opens, lives and shrinks away; far things never fall under a few pixels.
        const grow = smoothstep(0.0, 0.08, k).mul(float(1.0).sub(smoothstep(0.86, 1.0, k)));
        const minPx = select(kind.lessThan(1.5), float(1.6), float(3.4));
        const size = max(C.y, dist.mul(u.pixelAngle).mul(minPx)).mul(grow).mul(live).toVar();
        const gx = positionGeometry.x;
        const gy = positionGeometry.y;

        // A tumbling blade: it turns about the vertical and rolls about its own length.
        const yaw = seed.mul(6.283).add(age.mul(mix(0.6, 1.8, fract(seed.mul(5.1)))));
        const roll = age.mul(mix(1.5, 4.0, fract(seed.mul(2.3)))).add(seed.mul(31.0));
        const ax = vec3(cos(yaw), 0.0, sin(yaw));
        const bx = vec3(sin(yaw).negate().mul(cos(roll)), sin(roll), cos(yaw).mul(cos(roll)));
        const pBlade = centre.add(ax.mul(gx.mul(size))).add(bx.mul(gy.mul(size).mul(0.62)));

        // A bead faces the eye.
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const up = normalize(cross(toCam, right));
        const pBead = centre.add(right.mul(gx.mul(size))).add(up.mul(gy.mul(size).mul(2.6)));

        // A bird: wings across its heading, beating.
        const th = A.x.add(B.x.mul(age));
        const r = max(A.z.add(B.z.mul(age)), 2.0);
        const heading = normalize(vec3(sin(th).negate().mul(r).mul(B.x), B.y, cos(th).mul(r).mul(B.x)));
        const wing = normalize(cross(heading, vec3(0.0, 1.0, 0.0)));
        const beat = sin(u.time.mul(mix(8.0, 11.0, fract(seed.mul(13.0)))).add(seed.mul(50.0)));
        const pBird = centre.add(wing.mul(gx.mul(size).mul(2.0))).add(heading.mul(gy.mul(size).mul(0.8)))
            .add(vec3(0.0, abs(gx).mul(beat).mul(size).mul(1.1), 0.0));

        return select(
            kind.lessThan(0.5),
            pBlade,
            select(kind.lessThan(1.5), pBead, select(kind.lessThan(2.5), pBlade, pBird)),
        );
    })();

    // The sun on it, read once where it is (flat: one value a blade).
    const sunOn = flatVarying(sfSunMask(u, centreOf()), 'sfFloraSun');
    const vCode = flatVarying(C.x, 'sfFloraCode');
    const vKind = flatVarying(C.w, 'sfFloraKind');
    const vSeed = flatVarying(C.z, 'sfFloraSeed');

    const shape = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const kind = floor(vKind.add(0.5));
        const ax = abs(p.x);
        // A petal or leaf: pointed at both ends.
        const blade = step(abs(p.y), float(1.0).sub(ax.mul(ax)).mul(0.96));
        const bead = step(length(p.mul(vec2(1.0, 0.8))), 0.92);
        // A bird from above: a short body and two swept wings that taper.
        const body = step(ax, 0.1).mul(step(abs(p.y), 0.85));
        const sweep = abs(p.y.sub(ax.mul(-0.45).add(0.12)));
        const wings = step(sweep, float(0.3).mul(float(1.0).sub(ax.mul(0.78))));
        return select(kind.lessThan(0.5), blade, select(kind.lessThan(1.5), bead, select(
            kind.lessThan(2.5),
            blade,
            max(body, wings),
        )));
    });

    const colorNode = Fn(() => {
        const p = uv().sub(0.5).mul(2.0);
        const kind = floor(vKind.add(0.5));
        const code = floor(vCode.add(0.5));
        // The pieces' pigments as petals (lighter toward the tip), a leaf's green or gold, white.
        const pigment = pieceSwatchNode(min(code, 6.0)).mul(mix(0.62, 0.95, abs(p.x))).add(0.04);
        const leaf = mix(vec3(0.07, 0.22, 0.04), vec3(0.16, 0.34, 0.05), fract(vSeed.mul(9.0)));
        const gold = mix(vec3(0.5, 0.3, 0.04), vec3(0.42, 0.14, 0.03), fract(vSeed.mul(5.0)));
        const white = vec3(0.82, 0.84, 0.86);
        const albedo = select(code.lessThan(6.5), pigment, select(code.lessThan(7.5), leaf, select(
            code.lessThan(8.5),
            gold,
            white,
        )));
        const crease = float(1.0).sub(smoothstep(0.1, 0.0, abs(p.y)).mul(0.22));
        // In the sunfall a blade is lit through; in the shade it keeps the cave's cool light.
        // (Like the blossoms it came from, a petal shows its pigment in the cave's shade.)
        const ambient = u.mistTint.mul(0.9).add(u.bounceVault.mul(0.45)).add(vec3(0.34))
            .mul(u.skyGain.mul(0.6).add(0.4));
        const sun = u.beamCore.mul(sunOn.mul(u.sunGain).mul(SUNFALL_LIGHT.sun * 0.2));
        // Far blades (a whirl, a bird) flash as they turn in the sun: glitter round the column.
        const far = step(1.5, kind);
        const turnA = u.time.mul(mix(2.2, 5.0, fract(vSeed.mul(2.3)))).add(vSeed.mul(31.0));
        const flash = pow(abs(sin(turnA)), 6.0).mul(far).mul(sunOn).mul(u.sunGain);
        const lit = albedo.mul(crease).mul(ambient.add(sun)).add(u.beamCore.mul(flash.mul(2.6)));
        // A bead is a point of light: the sky in it, the sun when it crosses the column.
        const glint = u.skyZenith.mul(1.5).add(u.beamScatter.mul(0.9))
            .add(u.beamCore.mul(sunOn.mul(u.sunGain).mul(SUNFALL_LIGHT.sun * 0.45)))
            .mul(float(1.0).sub(length(p).mul(0.6)));
        return select(kind.greaterThan(0.5).and(kind.lessThan(1.5)), glint, lit);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;
    material.opacityNode = shape();
    material.alphaTest = 0.5;
    material.side = THREE.DoubleSide;
    return material;
}

/**
 * The flora mesh and what feeds it. `update(snap)` reads the director's locks, clears and beats;
 * `spawn(record)` writes one record into the ring (the oldest is reused).
 */
export function buildFlora(world, { strands = null } = {}) {
    const { u, preset } = world;
    const slots = Math.max(0, Math.floor(preset.floraSlots ?? 640));
    const group = new THREE.Group();
    group.name = 'sunfall-flora';
    if (slots < 8) return { group, update() {}, dispose() {} };

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.deleteAttribute('normal');
    const fa = new Float32Array(slots * 4);
    const fb = new Float32Array(slots * 4);
    const fc = new Float32Array(slots * 4);
    const attrA = new THREE.InstancedBufferAttribute(fa, 4).setUsage(THREE.DynamicDrawUsage);
    const attrB = new THREE.InstancedBufferAttribute(fb, 4).setUsage(THREE.DynamicDrawUsage);
    const attrC = new THREE.InstancedBufferAttribute(fc, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aFloraA', attrA);
    geometry.setAttribute('aFloraB', attrB);
    geometry.setAttribute('aFloraC', attrC);
    const material = createFloraMaterial(u);
    const mesh = new THREE.InstancedMesh(geometry, material, slots);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);

    let rng = mulberry32(world.seed ^ 0xf10a);
    let cursor = 0;
    let dirty = false;
    const clearAll = () => {
        for (let i = 0; i < slots; i += 1) {
            fa.set([0, -1000, 0, FAR_AWAY], i * 4);
            fb.set([0, 0, 0, 0.01], i * 4);
            fc.set([0, 0, 0, 0], i * 4);
        }
        cursor = 0;
        dirty = true;
    };
    clearAll();

    const spawn = ({
        at, birth, velocity = [0, 0, 0], life = 5, code = FLORA_CODE.leaf, size = 0.3, kind = FLORA_KIND.petal,
    }) => {
        fa.set([at[0], at[1], at[2], birth], cursor * 4);
        fb.set([velocity[0], velocity[1], velocity[2], life], cursor * 4);
        fc.set([code, size, rng(), kind], cursor * 4);
        cursor = (cursor + 1) % slots;
        dirty = true;
    };
    const between = (a, b) => a + (b - a) * rng();
    const pieceIndex = (code) => PIECE_INDEX[code] ?? Math.floor(rng() * 7);
    /** How many of a full count this tier and the motion setting carry. */
    const share = (count, snap) => Math.max(1, Math.round(count * Math.min(1, slots / 640)
        * (snap.reducedMotion ? 0.4 : 1)));

    /** Petals let go by the vines at a board row, on both sides of the card. */
    const shedPetals = (snap, row, codes, count, time) => {
        if (!strands?.anchorAt) return;
        for (const side of [-1, 1]) {
            const anchor = strands.anchorAt(side, row);
            if (!anchor) continue;
            for (let i = 0; i < count; i += 1) {
                spawn({
                    at: [
                        anchor[0] + between(-0.9, 0.9), anchor[1] + between(-1.4, 1.4), anchor[2] + between(-0.6, 0.6),
                    ],
                    birth: time + i * 0.035,
                    // Thrown outward from the card, a little toward the eye, then the air takes it.
                    velocity: [side * between(1.2, 7.5), between(-0.5, 3.2), between(-0.8, 2.6)],
                    life: between(4.5, 7.5),
                    code: pieceIndex(codes[i % Math.max(1, codes.length)]),
                    size: between(0.4, 0.66),
                    kind: FLORA_KIND.petal,
                });
            }
        }
    };

    /** Beads of water flung off the strand a hard drop snaps. */
    const flingBeads = (snap, ev) => {
        if (!strands?.anchorAt) return;
        const side = ev.u < 0.5 ? -1 : 1;
        const row = ev.cells?.[0]?.row ?? 12;
        const count = share(26, snap);
        for (let i = 0; i < count; i += 1) {
            const anchor = strands.anchorAt(side, row + between(-6, 5));
            if (!anchor) return;
            spawn({
                at: anchor,
                birth: ev.time + i * 0.012,
                velocity: [side * between(0.2, 1.8), between(-1.5, 2.6), between(-0.6, 0.9)],
                life: between(1.2, 2.0),
                code: FLORA_CODE.white,
                size: between(0.13, 0.22),
                kind: FLORA_KIND.bead,
            });
        }
    };

    /** Leaves wound up round the sunfall (the Turning), all turning the way the fringe turns. */
    const windLeaves = (snap, time, count) => {
        const turn = snap.reducedMotion ? 0.35 : 1;
        for (let i = 0; i < count; i += 1) {
            const pick = rng();
            let code = FLORA_CODE.leaf;
            if (pick < 0.3) code = FLORA_CODE.gold;
            else if (pick < 0.45) code = Math.floor(rng() * 7);
            spawn({
                at: [rng() * Math.PI * 2, between(CANOPY_LEVEL + 6, 50), between(34, 62)],
                birth: time + rng() * 0.5,
                velocity: [between(0.75, 1.25) * turn, between(9, 17), between(-1, 3)],
                life: between(4.2, 6),
                code,
                size: between(2.4, 4.2),
                kind: FLORA_KIND.whirl,
            });
        }
    };

    /** A rain of petals down the whole column, in every piece's pigment. */
    const petalRain = (snap, time, count) => {
        const sd = snap.sunDir;
        for (let i = 0; i < count; i += 1) {
            const y = between(CANOPY_LEVEL + 30, OCULUS_CENTER[1] - 6);
            const t = (OCULUS_CENTER[1] - y) / Math.max(0.15, sd[1]);
            const a = rng() * Math.PI * 2;
            const r = Math.sqrt(rng()) * 44;
            spawn({
                at: [OCULUS_CENTER[0] - sd[0] * t + Math.cos(a) * r, y, OCULUS_CENTER[2] - sd[2] * t + Math.sin(a) * r],
                birth: time + rng() * 1.6,
                velocity: [between(-1.5, 1.5), between(-1, 0.5), between(-1.5, 1.5)],
                life: between(7, 10),
                code: i % 7,
                size: between(1.3, 2.1),
                kind: FLORA_KIND.petal,
            });
        }
    };

    /** White birds lifted out of the canopy, spiralling up the light and out through the oculus. */
    const liftBirds = (snap, time, count, { stagger = 2.4, radius = [44, 78], climb = [17, 25] } = {}) => {
        const way = rng() < 0.5 ? -1 : 1;
        for (let i = 0; i < count; i += 1) {
            spawn({
                at: [rng() * Math.PI * 2, between(CANOPY_LEVEL + 4, CANOPY_LEVEL + 22), between(radius[0], radius[1])],
                birth: time + rng() * stagger,
                velocity: [way * between(0.42, 0.62), between(climb[0], climb[1]), between(-2.2, -0.8)],
                life: between(11, 14),
                code: FLORA_CODE.white,
                size: between(1.9, 2.6),
                kind: FLORA_KIND.bird,
            });
        }
    };

    let session = -1;
    let lastLock = 0;
    let lastClear = 0;
    let lastBeat = 0;
    let nextLeaf = 6;
    let nextPair = 38;
    const update = (snap) => {
        if (!snap) return;
        if (snap.sessionSerial !== session) {
            session = snap.sessionSerial;
            lastLock = 0;
            lastClear = 0;
            lastBeat = 0;
            rng = mulberry32(world.seed ^ 0xf10a);
            clearAll();
            nextLeaf = snap.time + 6;
            nextPair = snap.time + 38;
        }
        for (const ev of snap.lockEvents || []) {
            if (ev.serial <= lastLock) continue;
            lastLock = ev.serial;
            if (ev.hard) flingBeads(snap, ev);
        }
        for (const ev of snap.clearEvents || []) {
            if (ev.serial <= lastClear) continue;
            lastClear = ev.serial;
            const codes = ev.codes?.length ? ev.codes : PIECE_CODES;
            const each = share(ev.lines >= 4 ? 12 : 7, snap);
            ev.rows.forEach((row) => shedPetals(snap, row, codes, each, ev.time));
        }
        for (const beat of snap.beats || []) {
            if (beat.serial <= lastBeat) continue;
            lastBeat = beat.serial;
            if (beat.kind === 'twist') windLeaves(snap, beat.time, share(44 + 14 * (beat.lines || 0), snap));
            else if (beat.kind === 'perfect') {
                petalRain(snap, beat.time, share(210, snap));
                for (let row = 2; row < 20; row += 3) {
                    shedPetals(snap, row, PIECE_CODES, share(4, snap), beat.time + row * 0.03);
                }
            } else if (beat.kind === 'levelUp') liftBirds(snap, beat.time, share(22, snap));
            else if (beat.kind === 'over') {
                // The vines let their leaves go.
                for (let row = 1; row < 20; row += 2) {
                    for (const side of [-1, 1]) {
                        const anchor = strands?.anchorAt?.(side, row);
                        if (!anchor) continue;
                        spawn({
                            at: anchor,
                            birth: beat.time + rng() * 2.4,
                            velocity: [between(-0.5, 0.5), 0, between(-0.3, 0.3)],
                            life: between(6, 9),
                            code: rng() < 0.6 ? FLORA_CODE.gold : FLORA_CODE.leaf,
                            size: between(0.26, 0.42),
                            kind: FLORA_KIND.petal,
                        });
                    }
                }
            }
        }
        // On the world's own clock: a strand lets a leaf go; now and then two birds cross the light.
        if (snap.time >= nextLeaf) {
            nextLeaf = snap.time + between(4, 10);
            const anchor = strands?.anchorAt?.(rng() < 0.5 ? -1 : 1, between(0, 14));
            if (anchor) {
                spawn({
                    at: anchor,
                    birth: snap.time,
                    velocity: [between(-0.6, 0.6), 0, between(-0.3, 0.5)],
                    life: between(6, 9),
                    code: rng() < 0.5 ? FLORA_CODE.gold : FLORA_CODE.leaf,
                    size: between(0.24, 0.4),
                    kind: FLORA_KIND.petal,
                });
            }
        }
        if (snap.time >= nextPair) {
            nextPair = snap.time + between(34, 62);
            liftBirds(snap, snap.time, 2 + Math.floor(rng() * 3), { stagger: 0.9, radius: [70, 120], climb: [9, 14] });
        }
        if (dirty) {
            attrA.needsUpdate = true;
            attrB.needsUpdate = true;
            attrC.needsUpdate = true;
            dirty = false;
        }
    };

    return {
        group,
        mesh,
        spawn,
        update,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

export function createVapourMaterial(u, textures) {
    const A = attribute('aPuffA', 'vec4'); // where, birth
    const B = attribute('aPuffB', 'vec4'); // velocity, life
    const C = attribute('aPuffC', 'vec4'); // size at birth, size at the end, seed, strength
    const centreOf = Fn(() => {
        const age = u.time.sub(A.w);
        const lean = sin(age.mul(0.4).add(C.z.mul(30.0))).mul(age).mul(0.35);
        return A.xyz.add(B.xyz.mul(age)).add(vec3(lean, 0.0, lean.mul(0.5)));
    });
    const positionNode = Fn(() => {
        const age = u.time.sub(A.w).toVar();
        const life = max(B.w, 0.01);
        const k = clamp(age.div(life), 0.0, 1.0);
        const live = step(0.0, age).mul(step(age, life));
        const centre = centreOf().toVar();
        const toCam = cameraPosition.sub(centre);
        const right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        const up = normalize(cross(toCam, right));
        const size = mix(C.x, C.y, k.sqrt()).mul(live);
        return centre.add(right.mul(positionGeometry.x.mul(size))).add(up.mul(positionGeometry.y.mul(size).mul(1.25)));
    })();
    const sunOn = flatVarying(sfSunMask(u, centreOf()), 'sfPuffSun');
    const vAge = flatVarying(clamp(u.time.sub(A.w).div(max(B.w, 0.01)), 0.0, 1.0), 'sfPuffAge');
    const vSeed = flatVarying(C.z, 'sfPuffSeed');
    const vStrength = flatVarying(C.w, 'sfPuffStrength');
    const out = Fn(() => {
        const st = uv();
        const p = st.sub(0.5).mul(2.0);
        // A soft body frayed by its own billows (they slide upward through it as it rises).
        const slide = vec2(vSeed.mul(7.0), vSeed.mul(3.0).sub(vAge.mul(0.5)));
        const n = texture(textures.fbm, st.mul(0.7).add(slide)).level(1.0);
        const r = length(p).add(n.x.sub(0.5).mul(0.7));
        const body = smoothstep(1.0, 0.25, r).mul(mix(0.55, 1.15, n.y));
        const fade = smoothstep(0.0, 0.14, vAge).mul(float(1.0).sub(smoothstep(0.45, 1.0, vAge)));
        const dens = clamp(body.mul(fade).mul(vStrength), 0.0, 1.0);
        const light = mix(
            u.mistTint.mul(0.3).add(u.beamScatter.mul(0.42)),
            u.beamScatter.mul(SUNFALL_LIGHT.sun * 0.075),
            sunOn,
        ).mul(u.sunGain.mul(0.6).add(0.4));
        return vec4(light.mul(dens), dens.mul(0.42));
    })();
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = out;
    material.outputNode = out;
    material.transparent = true;
    material.premultipliedAlpha = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    return material;
}

/** The vapour puffs: steam off the crowns, the cataract's spray, a broken chain's breath. */
export function buildVapour(world) {
    const { u, preset, textures } = world;
    const slots = Math.max(0, Math.floor(preset.vapourSlots ?? 56));
    const group = new THREE.Group();
    group.name = 'sunfall-vapour';
    if (slots < 4) return { group, update() {}, dispose() {} };

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.deleteAttribute('normal');
    const pa = new Float32Array(slots * 4);
    const pb = new Float32Array(slots * 4);
    const pc = new Float32Array(slots * 4);
    const attrA = new THREE.InstancedBufferAttribute(pa, 4).setUsage(THREE.DynamicDrawUsage);
    const attrB = new THREE.InstancedBufferAttribute(pb, 4).setUsage(THREE.DynamicDrawUsage);
    const attrC = new THREE.InstancedBufferAttribute(pc, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aPuffA', attrA);
    geometry.setAttribute('aPuffB', attrB);
    geometry.setAttribute('aPuffC', attrC);
    const material = createVapourMaterial(u, textures);
    const mesh = new THREE.InstancedMesh(geometry, material, slots);
    mesh.frustumCulled = false;
    mesh.renderOrder = 45;
    group.add(mesh);

    let rng = mulberry32(world.seed ^ 0x57ea);
    let cursor = 0;
    let dirty = false;
    const clearAll = () => {
        for (let i = 0; i < slots; i += 1) {
            pa.set([0, -1000, 0, FAR_AWAY], i * 4);
            pb.set([0, 0, 0, 0.01], i * 4);
            pc.set([0, 0, 0, 0], i * 4);
        }
        cursor = 0;
        dirty = true;
    };
    clearAll();
    const between = (a, b) => a + (b - a) * rng();
    const puff = ({
        at, birth, velocity, life, size, strength = 1,
    }) => {
        pa.set([at[0], at[1], at[2], birth], cursor * 4);
        pb.set([velocity[0], velocity[1], velocity[2], life], cursor * 4);
        pc.set([size[0], size[1], rng(), strength], cursor * 4);
        cursor = (cursor + 1) % slots;
        dirty = true;
    };
    /** A point on the canopy inside the pool of light. */
    const inPool = (snap, radius) => {
        const foot = footFor(snap.sunDir, CANOPY_LEVEL);
        const a = rng() * Math.PI * 2;
        const r = Math.sqrt(rng()) * radius;
        return [foot[0] + Math.cos(a) * r, CANOPY_LEVEL + 6, foot[2] + Math.sin(a) * r];
    };

    let session = -1;
    let lastBeat = 0;
    let nextSteam = 0;
    const update = (snap) => {
        if (!snap) return;
        if (snap.sessionSerial !== session) {
            session = snap.sessionSerial;
            lastBeat = 0;
            rng = mulberry32(world.seed ^ 0x57ea);
            clearAll();
            nextSteam = snap.time;
        }
        // Steam off the sunlit crowns while the weather steams.
        const steam = snap.weather?.steam ?? 0;
        if (steam > 0.2 && snap.time >= nextSteam) {
            nextSteam = snap.time + between(0.45, 0.8) / clamp01(steam + 0.2);
            puff({
                at: inPool(snap, 74),
                birth: snap.time,
                velocity: [between(-0.6, 0.6), between(3.2, 5.4), between(-0.6, 0.6)],
                life: between(9, 13),
                size: [between(10, 16), between(34, 52)],
                strength: 0.9 * steam,
            });
        } else if (steam <= 0.2) nextSteam = snap.time;
        for (const beat of snap.beats || []) {
            if (beat.serial <= lastBeat) continue;
            lastBeat = beat.serial;
            if (beat.kind === 'quad') {
                // The spray boils up where the cataract lands (its front takes 1.5 s to fall).
                for (let i = 0; i < Math.min(12, slots >> 2); i += 1) {
                    puff({
                        at: inPool(snap, 34),
                        birth: beat.time + 1.5 + rng() * 2.2,
                        velocity: [between(-2.5, 2.5), between(5, 10), between(-2.5, 2.5)],
                        life: between(4.5, 7),
                        size: [between(16, 24), between(52, 80)],
                        strength: 1,
                    });
                }
            } else if (beat.kind === 'release') {
                // A broken chain's breath: mist drawn up the column and out through the oculus.
                const sd = snap.sunDir;
                const count = Math.min(6 + Math.round((beat.peak || 3) * 0.8), slots >> 2);
                for (let i = 0; i < count; i += 1) {
                    const y = between(CANOPY_LEVEL + 20, 30);
                    const t = (OCULUS_CENTER[1] - y) / Math.max(0.15, sd[1]);
                    const a = rng() * Math.PI * 2;
                    const r = Math.sqrt(rng()) * 30;
                    const climb = between(24, 34);
                    const lean = climb / Math.max(0.15, sd[1]);
                    puff({
                        at: [
                            OCULUS_CENTER[0] - sd[0] * t + Math.cos(a) * r,
                            y,
                            OCULUS_CENTER[2] - sd[2] * t + Math.sin(a) * r,
                        ],
                        birth: beat.time + rng() * 0.9,
                        // Up along the column (it leans with the sun).
                        velocity: [sd[0] * lean, climb, sd[2] * lean],
                        life: between(5, 7),
                        size: [between(18, 28), between(44, 66)],
                        strength: 0.9,
                    });
                }
            }
        }
        if (dirty) {
            attrA.needsUpdate = true;
            attrB.needsUpdate = true;
            attrC.needsUpdate = true;
            dirty = false;
        }
    };

    return {
        group,
        mesh,
        puff,
        update,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
