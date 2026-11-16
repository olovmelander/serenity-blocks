/**
 * Verdant Hills — the balloons.
 *
 * Hot-air balloons go up from two fields in the valley, one left of the board and one right of
 * it, and drift away down the valley for seven minutes, small and bright in the kites' colours.
 * The clock sends one up every two and a half minutes whatever is played, so the sky is never
 * the same for long, and every new level launches one of its own: a long run fills the valley's
 * air with them. Line clears fire their burners, and in the afterglow each one burns by itself
 * now and then and glows like a lantern.
 *
 * Where a balloon stands is a closed form of its age (`verdantHillsBalloonPlace`), so the same
 * flight plays on both backends, in the playground's seek and in the tests. One mesh holds every
 * balloon; three rows of a uniform array place and paint each.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, dot, float, fract, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, saturate,
    sin, smoothstep, step, uniformArray, uv, varying, vec3,
} from 'three/tsl';
import { VERDANT_HILLS_KITE_COLOURS } from './verdant-hills-tetrominos.js';

const ROWS = 3;
/** Balloons the clock keeps in the air at once, and how many more the levels can add. */
const CLOCK_SLOTS = 3;
const LEVEL_SLOTS = 4;
export const VERDANT_HILLS_BALLOONS = CLOCK_SLOTS + LEVEL_SLOTS;
/** Seconds a balloon is in the air, and between two of the clock's. */
export const VERDANT_HILLS_BALLOON_LIFE = 430;
export const VERDANT_HILLS_BALLOON_EVERY = 150;
/** The clock's first launch of a session; the two before it are already on their way. */
const CLOCK_FIRST = 20;
/** Height of the envelope from its mouth to its crown, metres. */
const ENVELOPE = 20;
/** Seconds an envelope takes to fill before it lifts, and to come down small at the end. */
const FILL = 7;
const FADE = 25;

/**
 * The two fields (x, z) and the air's drift from each (a unit direction): the left-hand lane
 * goes straight away down the valley, the right-hand one (which comes up from behind the mill's
 * hill) away and to the right with the wind, so neither crosses behind the board.
 */
export const VERDANT_HILLS_BALLOON_LANES = Object.freeze([
    Object.freeze({ field: [-215, -340], drift: [-0.121, -0.993] }),
    Object.freeze({ field: [140, -405], drift: [0.603, -0.798] }),
]);

/** Each balloon's colours (two kite slots) and the cut of its cloth, in launch order. */
const LIVERIES = Object.freeze([
    [0, 2, 0], [1, 6, 1], [3, 2, 2], [4, 1, 3], [5, 0, 0], [6, 4, 2], [2, 5, 1], [0, 1, 3], [3, 6, 0], [4, 2, 1],
]);

const hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};

/**
 * Where the balloon of flight `flight` stands `age` seconds after it was let go (writes x, y, z
 * into `out` and returns how much of its size it has: 0 before it fills and after it has gone).
 * `ground(x, z)` is the land's height.
 */
export function verdantHillsBalloonPlace(flight, age, ground, out = new THREE.Vector3()) {
    const n = Math.floor(flight);
    const lane = VERDANT_HILLS_BALLOON_LANES[((n % 2) + 2) % 2];
    const [fx, fz] = lane.field;
    // No two start from the same spot of the field or fly quite alike.
    const startX = fx + (hash(n * 3 + 1) - 0.5) * 50;
    const startZ = fz + (hash(n * 3 + 2) - 0.5) * 50;
    const speed = 1.35 + hash(n * 3 + 3) * 0.6;
    const cruise = 120 + hash(n * 5 + 4) * 85;
    const phase = hash(n * 7 + 5) * Math.PI * 2;
    const aloft = Math.max(0, age - FILL);
    // It lifts slowly, gathers way, and levels off at its height.
    const along = speed * (aloft - 16 * (1 - Math.exp(-aloft / 16)));
    const climb = cruise * (1 - Math.exp(-aloft / 34));
    const weave = 22 * Math.sin(aloft * 0.031 + phase) * Math.min(1, aloft / 40);
    const [dx, dz] = lane.drift;
    const x = startX + dx * along - dz * weave;
    const z = startZ + dz * along + dx * weave;
    out.set(x, ground(startX, startZ) + 3.2 + climb + 2.4 * Math.sin(aloft * 0.17 + phase), z);
    if (!(age > 0) || age >= VERDANT_HILLS_BALLOON_LIFE) return 0;
    const fill = Math.min(1, age / FILL);
    const fade = Math.min(1, (VERDANT_HILLS_BALLOON_LIFE - age) / FADE);
    return fill * fill * (3 - 2 * fill) * fade * fade * (3 - 2 * fade);
}

/** The envelope's radius (of its height) at `t` up it: a narrow mouth, widest above the middle, a round crown. */
function envelopeRadius(t) {
    return 0.062 * (1 - t) + 0.4 * Math.sin(Math.PI * t ** 1.35) ** 0.6;
}

/** One balloon about its mouth: the envelope (part 0) and the basket under it (part 1). */
function createBalloonGeometry() {
    const around = 24;
    const up = 16;
    const positions = [];
    const normals = [];
    const uvs = [];
    const parts = [];
    const indices = [];
    for (let j = 0; j <= up; j += 1) {
        const t = j / up;
        const radius = envelopeRadius(t);
        // The slope of the profile gives the normal its lift.
        const slope = (envelopeRadius(Math.min(1, t + 0.01)) - envelopeRadius(Math.max(0, t - 0.01))) / 0.02;
        for (let i = 0; i <= around; i += 1) {
            const angle = (i / around) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius * ENVELOPE, t * ENVELOPE, Math.sin(angle) * radius * ENVELOPE);
            const lift = j === up ? 1 : -slope;
            const length = Math.hypot(1, lift) || 1;
            normals.push(Math.cos(angle) / length, lift / length, Math.sin(angle) / length);
            uvs.push(i / around, t);
            parts.push(0);
        }
    }
    for (let j = 0; j < up; j += 1) {
        for (let i = 0; i < around; i += 1) {
            const a = j * (around + 1) + i;
            const b = a + around + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    // The basket: a small box hung under the mouth.
    const basket = new THREE.BoxGeometry(1.7, 1.3, 1.7);
    basket.translate(0, -2.5, 0);
    const base = positions.length / 3;
    const basketPositions = basket.getAttribute('position');
    const basketNormals = basket.getAttribute('normal');
    for (let i = 0; i < basketPositions.count; i += 1) {
        positions.push(basketPositions.getX(i), basketPositions.getY(i), basketPositions.getZ(i));
        normals.push(basketNormals.getX(i), basketNormals.getY(i), basketNormals.getZ(i));
        uvs.push(0, 0);
        parts.push(1);
    }
    for (let i = 0; i < basket.index.count; i += 1) indices.push(base + basket.index.getX(i));
    basket.dispose();
    return {
        positions, normals, uvs, parts, indices,
    };
}

export class VerdantHillsBalloons {
    constructor({ light, groundHeight = () => 8 }) {
        this.light = light;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsBalloons';
        // Per balloon: [place xyz, size] [first colour rgb, burner] [second colour rgb, cut of the cloth].
        this.rows = Array.from({ length: VERDANT_HILLS_BALLOONS * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.place = new THREE.Vector3();
        this.tones = VERDANT_HILLS_KITE_COLOURS.map((hex) => new THREE.Color(hex));
        /** The levels' launches: when each was let go (the clock's are a closed form of the time). */
        this.launches = [];
        this.launched = 0;
        this.aloft = 0;
        this.time = 0;
    }

    build() {
        const one = createBalloonGeometry();
        const count = one.positions.length / 3;
        const positions = new Float32Array(count * 3 * VERDANT_HILLS_BALLOONS);
        const normals = new Float32Array(count * 3 * VERDANT_HILLS_BALLOONS);
        const uvs = new Float32Array(count * 2 * VERDANT_HILLS_BALLOONS);
        const parts = new Float32Array(count * 2 * VERDANT_HILLS_BALLOONS);
        const indices = [];
        for (let slot = 0; slot < VERDANT_HILLS_BALLOONS; slot += 1) {
            positions.set(one.positions, slot * count * 3);
            normals.set(one.normals, slot * count * 3);
            uvs.set(one.uvs, slot * count * 2);
            for (let i = 0; i < count; i += 1) parts.set([slot, one.parts[i]], (slot * count + i) * 2);
            for (const index of one.indices) indices.push(index + slot * count);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('aBalloon', new THREE.BufferAttribute(parts, 2));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 150, -700), 1600);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsBalloons';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'VerdantHillsBalloons';
        const rows = uniformArray(this.rows, 'vec4');
        const tag = attribute('aBalloon', 'vec2'); // slot, part (0 envelope, 1 basket)
        const first = tag.x.add(0.5).floor().toInt().mul(ROWS);
        const place = rows.element(first);
        const paintA = rows.element(first.add(1));
        const paintB = rows.element(first.add(2));
        // A balloon not in the air is folded to a point under the land.
        material.positionNode = place.xyz.add(positionGeometry.mul(place.w));
        // The pose never turns: the geometry's own normal is the world's.
        const normal = normalize(varying(normalGeometry, 'verdantBalloonNormal'));
        const first3 = varying(paintA.rgb, 'verdantBalloonFirst');
        const second3 = varying(paintB.rgb, 'verdantBalloonSecond');
        const burner = varying(paintA.w, 'verdantBalloonBurner');
        const cut = varying(paintB.w, 'verdantBalloonCut');
        const basket = varying(tag.y, 'verdantBalloonPart');
        const st = uv();
        const gore = fract(st.x.mul(12));
        const cream = vec3(0.94, 0.9, 0.78);
        // Four cuts of cloth: gores in turn, hoops, a spiral, and chevrons.
        const gores = step(0.5, fract(st.x.mul(6)));
        const hoop = fract(st.y.mul(2.5));
        const hoops = mix(mix(first3, cream, step(0.34, hoop)), second3, step(0.67, hoop));
        const spiral = step(0.5, fract(st.x.mul(6).add(st.y.mul(2.6))));
        const chevron = step(0.5, fract(st.y.mul(5).add(gore.sub(0.5).abs().mul(1.4))));
        const pick = (index) => saturate(float(1).sub(cut.sub(index).abs()));
        let cloth = mix(first3, second3, gores).mul(pick(0))
            .add(hoops.mul(pick(1)))
            .add(mix(first3, second3, spiral).mul(pick(2)))
            .add(mix(second3, mix(first3, cream, 0.35), chevron).mul(pick(3)));
        // A plain crown and a scorched skirt at the mouth, and a seam between every two gores.
        cloth = mix(cloth, first3, smoothstep(0.9, 0.94, st.y));
        cloth = mix(cloth, vec3(0.16, 0.13, 0.11), smoothstep(0.05, 0.02, st.y));
        const seam = smoothstep(0.42, 0.5, gore.sub(0.5).abs());
        cloth = cloth.mul(seam.mul(0.2).oneMinus());
        const tone = mix(cloth, vec3(0.26, 0.18, 0.1), step(0.5, basket));
        // Each gore bellies out between its seams: it is shaded like the round panel it is.
        const sun = light.uSunDir;
        const facing = dot(normal, sun);
        const belly = gore.sub(0.5).mul(0.5).oneMinus().mul(seam.mul(0.12).oneMinus());
        // Nylon is thin: the side turned from the sun glows with the light that comes through.
        const lit = saturate(facing.mul(0.62).add(0.42)).mul(belly).add(saturate(facing.negate()).mul(0.3));
        const world = positionWorld;
        const day = tone.mul(lit).mul(light.uSunColor).mul(light.cloudShadow(world)).mul(0.3)
            .add(tone.mul(light.ambient(normal)).mul(0.9));
        // The burner: the envelope lights from the mouth up, as a lantern does, most of all at dusk.
        const flame = vec3(1.0, 0.52, 0.17);
        const lantern = mix(flame, cloth.mul(flame).mul(2.2), 0.55)
            .mul(pow(saturate(float(1).sub(st.y)), 1.6).mul(0.85).add(0.12))
            .mul(burner).mul(light.uNight.mul(1.5).add(0.28))
            .mul(step(basket, 0.5));
        // A slow shimmer runs up the cloth while the burner roars.
        const roar = sin(st.y.mul(26).sub(light.uTime.mul(9))).mul(0.12).add(1);
        material.colorNode = light.haze(day, { world }).add(lantern.mul(roar));
        return material;
    }

    /** Let a balloon go for a new level, at `time` (this world's clock). */
    launch(time = this.time) {
        const at = Number.isFinite(time) ? time : this.time;
        // Flight numbers three apart: the lanes take turns (the first from the left-hand field, in
        // sight at once; the right-hand one rises from behind the mill's hill), and no level's
        // balloon wears the cloth of the clock's balloon that went up beside it.
        this.launches.push({ at, flight: 1002 + this.launched * 3 });
        this.launched += 1;
        if (this.launches.length > LEVEL_SLOTS) this.launches.shift();
    }

    /**
     * Fly the balloons for this frame. `burn` (0..1) is how hard play fires the burners; `night`
     * (0..1) how far dusk has come, when each also burns by itself now and then.
     */
    update(time, { burn = 0, night = 0 } = {}) {
        this.time = Number.isFinite(time) ? time : this.time;
        const { rows, place, tones } = this;
        const fire = Number.isFinite(burn) ? Math.max(0, Math.min(1, burn)) : 0;
        const dusk = Number.isFinite(night) ? Math.max(0, Math.min(1, night)) : 0;
        let aloft = 0;
        const fly = (slot, flight, age) => {
            const row = slot * ROWS;
            const size = age === null ? 0 : verdantHillsBalloonPlace(flight, age, this.groundHeight, place);
            if (!(size > 0)) {
                rows[row].set(0, -500, 0, 0);
                rows[row + 1].w = 0;
                return;
            }
            const [a, b, cut] = LIVERIES[((flight % LIVERIES.length) + LIVERIES.length) % LIVERIES.length];
            rows[row].set(place.x, place.y, place.z, size);
            // Its own burns: a second or so of flame every eight, each balloon on its own beat;
            // by day only as it lifts off and when play fires it.
            const beat = Math.max(0, Math.sin(this.time * 0.74 + flight * 2.4)) ** 10;
            const lift = Math.max(0, 1 - Math.abs(age - 10) / 10);
            const burner = Math.min(1, fire + beat * (0.25 + 0.75 * dusk) + lift);
            rows[row + 1].set(tones[a].r, tones[a].g, tones[a].b, burner);
            rows[row + 2].set(tones[b].r, tones[b].g, tones[b].b, cut);
            aloft += 1;
        };
        // The clock's balloons: flight k was let go at CLOCK_FIRST + k·EVERY, the newest first.
        const newest = Math.floor((this.time - CLOCK_FIRST) / VERDANT_HILLS_BALLOON_EVERY);
        for (let i = 0; i < CLOCK_SLOTS; i += 1) {
            const k = newest - i;
            const age = this.time - (CLOCK_FIRST + k * VERDANT_HILLS_BALLOON_EVERY);
            fly(((k % CLOCK_SLOTS) + CLOCK_SLOTS) % CLOCK_SLOTS, k + 400, age);
        }
        for (let i = 0; i < LEVEL_SLOTS; i += 1) {
            const launch = this.launches[i];
            fly(CLOCK_SLOTS + i, launch ? launch.flight : 0, launch ? this.time - launch.at : null);
        }
        this.aloft = aloft;
    }

    /** Forget the levels' balloons (a new session, a replay): the clock's are the time's own. */
    reset() {
        this.launches.length = 0;
        this.launched = 0;
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
