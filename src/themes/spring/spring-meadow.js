/**
 * Spring — the meadow on the knoll.
 *
 * Thousands of clumps of spring grass and seven kinds of flowers on the knoll's top and its
 * shoulders, all of them geometry, none of them moved by the CPU. Each plant carries its root and
 * a turn as instance data; the vertex shader stands it up, bends it in the valley's breeze, opens
 * and closes its flowers with the day (wood anemones shut at night), and swells its heads when a
 * breath from the board runs through the meadow. The kinds grow in drifts, the way a real meadow
 * sorts itself: anemones in carpets, marigolds where the ground is wet by the water.
 *
 * The game speaks to it two ways: a lock makes a patch of the locked piece's own flower burst
 * into bloom where it lands, the buds opening outward from the spot and staying open a while;
 * a line clear opens every flower on the knoll at once in a flush of bloom; and as play heats
 * the kinds the player has been playing open (and glow) all over the knoll, until in a fever the
 * whole knoll stands in flower.
 *
 * Adapted from Summer's meadow (summer-meadow.js): every flower kind and level of detail shares
 * one material, the grass another; instance data lives on the geometry, not in the node graph.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    dot,
    exp,
    float,
    int,
    length,
    max,
    mix,
    normalGeometry,
    normalize,
    positionGeometry,
    positionWorld,
    pow,
    sin,
    smoothstep,
    step,
    texture,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { mulberry32 } from './spring-core.js';
import { aerial } from './spring-light.js';
import { EYE } from './spring-plan.js';
import {
    groundHeight, groundNormal, knollOutside, valueNoise, waterEdge,
} from './spring-terrain.js';
import { EVENT_ROWS } from './spring-tsl.js';
import { AIR } from './spring-air.js';
import { SPRING_FLOWERS, createSpringFlowerGeometry, createSpringGrassGeometry } from './spring-flowers.js';
import { drainSteps } from '../shared/build-steps.js';

const NEAR_VARIANTS = 2;
/** Where the meadow grows: bearings (degrees, wide enough for portrait's turn) and distances (m). */
export const MEADOW = Object.freeze({
    from: -62, to: 48, nearest: 0.9, near: 11.5, farthest: 34,
});
/**
 * A lock's patch of bloom: how fast its opening runs out from the spot (m/s), how long it holds
 * open (s), and how long it takes to close again (s).
 */
export const PATCH = Object.freeze({ speed: 3.5, hold: 18, close: 6 });
/**
 * The light the game sends through the flowers (spring-meadow gameLight): a patch's ring (its
 * width, s of the opening's travel; its gain), its own flowers' glow after the ring (how long it
 * lasts, s; its gain), a clear's breath (its band's width, m; its gain), and the glow the heat of
 * play lends the kinds the player has been playing (its gain at full heat).
 */
export const PATCH_LIGHT = Object.freeze({
    ring: 0.3, ringGain: 1.1, glow: 1.8, glowGain: 1.4, band: 1.6, breathGain: 0.9, heatGain: 0.4,
});
/** The breeze's direction across the knoll (unit x, z): down the valley, toward the right. */
const BREEZE = Object.freeze([0.86, -0.51]);

const smoothJs = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/**
 * How much of the meadow's growth a spot keeps (0 on water, bare granite or steep rock, 1 deep in
 * the knoll's turf), and how wet it is (0 dry … 1 at the water's edge).
 */
export function meadowCover(baked, x, z, w = {}, n = [0, 1, 0]) {
    waterEdge(baked, x, z, w);
    if (w.edge < 0.35) return { cover: 0, wet: 1 };
    groundNormal(baked, x, z, n, 0.6);
    const flat = smoothJs(0.72, 0.9, n[1]);
    const knoll = knollOutside(x, z);
    // The knoll's top is deep turf; its shoulder is broken by granite; the banks are grassy.
    const turf = knoll < 0 ? 1 : 0.55 + 0.45 * (1 - smoothJs(0, 5, knoll));
    // Bare patches where the granite breaks through (the land's slabs show there).
    const bare = smoothJs(0.62, 0.78, valueNoise(x / 3.1, z / 3.1, 71)) * smoothJs(-3, 2, knoll) * 0.8;
    const wet = 1 - smoothJs(0.4, 5, w.edge);
    return { cover: Math.max(0, flat * turf * (1 - bare)), wet };
}

export class SpringMeadow {
    constructor(u, tex, tier, baked, { seed = 0x5eed } = {}) {
        this.u = u;
        this.tex = tex;
        this.tier = tier;
        this.baked = baked;
        this.rng = mulberry32(seed);
        this.group = new THREE.Group();
        this.group.name = 'SpringMeadow';
        this.owned = [];
        this.stats = {
            grass: 0, flowers: 0, grassTriangles: 0, flowerTriangles: 0,
        };
        /** Flower counts by kind, for diagnostics and tests. */
        this.census = Object.fromEntries(SPRING_FLOWERS.map((flower) => [flower.id, 0]));
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        drainSteps(this.buildSteps());
        return this;
    }

    /** The meadow in steps for the world's breathing build: the grass near and far, the flowers. */
    * buildSteps() {
        yield* this.grassSteps();
        yield 'grass';
        this.buildFlowers();
    }

    /** A random spot in the meadow's wedge: `bias` > 1 crowds the picks toward the lens. */
    spot(nearest, farthest, bias) {
        const { rng } = this;
        const depth = nearest + (farthest - nearest) * rng() ** bias;
        // Most of the growth is where a 16:9 screen looks; the rest serves portrait's turn.
        const wide = rng() < 0.8;
        const from = wide ? -40 : MEADOW.from;
        const to = wide ? 38 : MEADOW.to;
        const angle = ((from + (to - from) * rng()) * Math.PI) / 180;
        return { x: EYE.x + Math.sin(angle) * depth, z: EYE.z - Math.cos(angle) * depth, depth };
    }

    /** One draw of `geometry` for a list of plants (x, y, z, yaw, scale, phase, hue). */
    plant(geometry, material, plants, name) {
        if (!plants.length) return null;
        const count = plants.length / 7;
        const roots = new Float32Array(count * 4);
        const turns = new Float32Array(count * 4);
        // Nearest first: the blades and heads under the lens fill the depth before the ones they
        // hide are shaded (the picture is the same in any order).
        const order = Array.from({ length: count }, (_, i) => i);
        const away = (i) => Math.hypot(plants[i * 7] - EYE.x, plants[i * 7 + 2] - EYE.z);
        const depth = Float64Array.from(order, away);
        order.sort((a, b) => depth[a] - depth[b] || a - b);
        for (let i = 0; i < count; i += 1) {
            const o = order[i] * 7;
            roots.set([plants[o], plants[o + 1], plants[o + 2], plants[o + 5]], i * 4);
            turns.set([Math.cos(plants[o + 3]), Math.sin(plants[o + 3]), plants[o + 4], plants[o + 6]], i * 4);
        }
        // The vertex data is shared; only the instance data belongs to this draw.
        const instanced = this.own(new THREE.BufferGeometry());
        Object.entries(geometry.attributes).forEach(([key, value]) => instanced.setAttribute(key, value));
        instanced.setIndex(geometry.index);
        instanced.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 4));
        instanced.setAttribute('aTurn', new THREE.InstancedBufferAttribute(turns, 4));
        instanced.boundingSphere = new THREE.Sphere(new THREE.Vector3(EYE.x, 0, EYE.z), 80);
        const mesh = new THREE.InstancedMesh(instanced, material, count);
        mesh.name = name;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = 3;
        this.group.add(mesh);
        return mesh;
    }

    /**
     * What the air is doing at a root (TSL): `push` the horizontal shove in metres for a point
     * one metre up a stem (scaled by height squared), `gust` how hard the passing band blows (0..1).
     */
    air(root, phase) {
        const { u } = this;
        const t = u.time;
        const dir = vec2(BREEZE[0], BREEZE[1]);
        const along = root.x.mul(dir.x).add(root.z.mul(dir.y));
        const cross = root.x.mul(dir.y).sub(root.z.mul(dir.x));
        // Bands of wind travelling downwind, long across it: cat's-paws on the grass.
        const band = sin(along.mul(0.085).sub(t.mul(0.62)).add(cross.mul(0.021)))
            .add(sin(along.mul(0.19).sub(t.mul(1.05)).sub(cross.mul(0.047)).add(1.7)).mul(0.6))
            .add(sin(along.mul(0.043).sub(t.mul(0.33)).add(cross.mul(0.013)).add(4.1)).mul(0.8))
            .div(2.4);
        const gust = smoothstep(-0.25, 0.85, band);
        const force = gust.mul(0.42).add(0.24).mul(u.gust);
        const flutter = sin(t.mul(phase.mul(1.7).add(2.2)).add(phase.mul(40.0)).add(along.mul(0.6))).mul(0.34)
            .add(sin(t.mul(5.3).add(phase.mul(91.0))).mul(0.12)).add(0.8);
        return { push: dir.mul(force.mul(flutter)).mul(0.5), gust };
    }

    /**
     * How far the patches of bloom open a flower of `kind` rooted at `root` (TSL, 0..1): each
     * patch opens its own kind outward from where its lock landed, holds, and closes again. Plain
     * sums, no vars: the same nodes feed the position and a varying.
     */
    patches(root, kind) {
        const { u } = this;
        let open = float(0);
        for (let k = 0; k < this.tier.patches; k += 1) {
            const where = u.events.element(EVENT_ROWS.patch + k * 2); // x, z, born, power
            const what = u.events.element(EVENT_ROWS.patch + k * 2 + 1); // slot, radius
            const age = u.time.sub(where.z);
            const distance = length(root.xz.sub(where.xy));
            const mine = float(1.0).sub(step(0.5, abs(kind.sub(what.x))));
            const reached = smoothstep(0.0, 0.6, age.sub(distance.div(PATCH.speed)));
            const closing = float(1.0).sub(smoothstep(PATCH.hold, PATCH.hold + PATCH.close, age));
            const inside = smoothstep(what.y, what.y.mul(0.35), distance);
            open = open.add(mine.mul(reached).mul(closing).mul(inside).mul(where.w));
        }
        return clamp(open, 0.0, 1.0);
    }

    /**
     * The light the game sends through the meadow over a plant rooted at `root` (TSL, linear rgb,
     * before the petals take it): each lock's patch rolls a ring of light out from where it landed
     * as it opens, in its flower's colour, and its own flowers glow from within for a moment
     * after the ring has passed them; a clear's breath runs out from the eye as a warm band.
     */
    gameLight(root, kind) {
        const { u } = this;
        let light = vec3(0.0);
        for (let k = 0; k < this.tier.patches; k += 1) {
            const where = u.events.element(EVENT_ROWS.patch + k * 2); // x, z, born, power
            const what = u.events.element(EVENT_ROWS.patch + k * 2 + 1); // slot, radius
            const distance = length(root.xz.sub(where.xy));
            const front = u.time.sub(where.z).sub(distance.div(PATCH.speed));
            const ring = exp(front.div(PATCH_LIGHT.ring).pow2().negate())
                .mul(smoothstep(what.y.mul(1.6), what.y.mul(0.7), distance));
            const mine = float(1.0).sub(step(0.5, abs(kind.sub(what.x))));
            const glow = mine.mul(smoothstep(0.0, 0.35, front)).mul(exp(front.max(0.0).div(-PATCH_LIGHT.glow)))
                .mul(smoothstep(what.y, what.y.mul(0.35), distance));
            // Its flower's colour at full strength (the violet's and the hepatica's are dark petals:
            // their light must read as well as the campion's).
            const petal = u.palette.element(int(clamp(what.x, 0.0, 6.0))).xyz;
            const colour = petal.div(max(petal.x, max(petal.y, petal.z)).max(0.05)).mul(0.8);
            light = light.add(colour.mul(ring.mul(PATCH_LIGHT.ringGain).add(glow.mul(PATCH_LIGHT.glowGain)))
                .mul(where.w));
        }
        // Clears' breaths: (start, power) of each of two, running out from the eye.
        const reach = length(root.xz.sub(vec2(EYE.x, EYE.z)));
        const band = (start, power) => {
            const age = u.time.sub(start);
            const off = reach.sub(age.mul(AIR.breath.speed)).div(PATCH_LIGHT.band);
            return exp(off.mul(off).negate()).mul(power).mul(step(0.0, age))
                .mul(float(1.0).sub(smoothstep(4.0, 7.0, age)));
        };
        const breath = band(u.airWave.x, u.airWave.y).add(band(u.airWave.z, u.airWave.w));
        // The heat of play: the kinds the player has been playing glow from within all over the
        // knoll (their row's w, see heatOpen()).
        const own = u.palette.element(int(clamp(kind, 0.0, 6.0)));
        const ownColour = own.xyz.div(max(own.x, max(own.y, own.z)).max(0.05)).mul(0.8);
        return light.add(vec3(1.0, 0.9, 0.66).mul(breath.mul(PATCH_LIGHT.breathGain)))
            .add(ownColour.mul(own.w.mul(PATCH_LIGHT.heatGain)));
    }

    /** How far the heat of play opens a flower of `kind` all over the knoll (TSL, 0..1). */
    heatOpen(kind) {
        return this.u.palette.element(int(clamp(kind, 0.0, 6.0))).w;
    }

    /** Stand a plant on its root, turned and scaled, and bend it in the breeze. */
    stand(flex, shape = null) {
        const root = attribute('aRoot', 'vec4'); // x, y, z, phase
        const turn = attribute('aTurn', 'vec4'); // cos, sin, scale, hue
        const paint = attribute('paint', 'vec4');
        const air = this.air(root.xyz, root.w);
        const local = shape ? shape(air) : positionGeometry;
        const sized = local.mul(turn.z);
        const stood = vec3(
            sized.x.mul(turn.x).sub(sized.z.mul(turn.y)),
            sized.y,
            sized.x.mul(turn.y).add(sized.z.mul(turn.x)),
        );
        const height = paint.x.mul(turn.z);
        const bend = air.push.mul(paint.x.mul(paint.x).mul(turn.z).mul(flex));
        // A stem that leans over also comes down a little.
        const droop = dot(bend, bend).mul(0.5).div(height.add(0.05));
        const normal = vec3(
            normalGeometry.x.mul(turn.x).sub(normalGeometry.z.mul(turn.y)),
            normalGeometry.y,
            normalGeometry.x.mul(turn.y).add(normalGeometry.z.mul(turn.x)),
        );
        return {
            root, turn, paint, air, normal, position: stood.add(root.xyz).add(vec3(bend.x, droop.negate(), bend.y)),
        };
    }

    // ── grass ───────────────────────────────────────────────────────────────────────────

    createGrassMaterial() {
        const { u, tex } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SpringGrass';
        const plant = this.stand(1.4);
        material.positionNode = plant.position;
        const st = uv();
        const { root, paint } = plant;
        const air = varying(plant.air.gust, 'springGrassAir');
        material.colorNode = Fn(() => {
            const P = positionWorld;
            const field = texture(tex.noise, root.xz.div(40.0));
            const tuft = texture(tex.noise, root.xz.div(5.0));
            // Dark at the root where blades shade each other, the new green of May above.
            const base = mix(vec3(0.012, 0.03, 0.006), vec3(0.03, 0.068, 0.012), field.g);
            const tip = mix(vec3(0.075, 0.2, 0.03), vec3(0.16, 0.3, 0.05), tuft.r.mul(0.6).add(st.x.mul(0.4)));
            const fresh = mix(base, tip, smoothstep(0.04, 0.85, st.y));
            // Last year's blades, bleached to straw and lying over.
            const straw = mix(vec3(0.2, 0.15, 0.08), vec3(0.42, 0.36, 0.22), st.y.mul(0.7).add(st.x.mul(0.3)));
            const blade = mix(fresh, straw, paint.y.mul(0.9)).toVar();
            const N = normalize(plant.normal);
            const L = u.sunDir;
            const V = normalize(P.sub(u.eye));
            const facing = dot(N, L).abs().mul(0.8).add(0.28);
            // Looking up the light, every blade is a sliver of green glass.
            const through = pow(clamp(dot(V, L), 0.0, 1.0), 3.0).mul(st.y.mul(st.y));
            const glow = blade.mul(vec3(1.2, 1.5, 0.5)).mul(through.mul(0.9).add(0.04));
            const sun = u.sun.mul(u.sunUp);
            const sky = mix(u.bounce, u.fill, 0.75).mul(st.y.mul(0.7).add(0.3));
            // A gust lays the blades over: their backs catch a little more of the sky.
            const lit = blade.mul(facing).add(glow).mul(sun).mul(0.42)
                .add(blade.mul(sky).mul(air.mul(st.y).mul(0.3).add(1.25)));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        return material;
    }

    * grassSteps() {
        const { rng, tier, baked } = this;
        const material = this.createGrassMaterial();
        const w = {};
        const n = [0, 1, 0];
        const scatter = (wanted, nearest, farthest, bias, far) => {
            const plants = [];
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 6; attempt += 1) {
                const place = this.spot(nearest, farthest, bias);
                const { cover } = meadowCover(baked, place.x, place.z, w, n);
                if (rng() >= cover) continue;
                const scale = (0.8 + rng() * 0.5) * (far ? 1 + place.depth * 0.02 : 1);
                const y = groundHeight(baked, place.x, place.z) - 0.02;
                plants.push(place.x, y, place.z, rng() * Math.PI * 2, scale, rng(), rng());
                made += 1;
            }
            return plants;
        };
        const near = this.own(createSpringGrassGeometry({ far: false, seed: 11 }));
        const far = this.own(createSpringGrassGeometry({ far: true, seed: 23 }));
        const nearPlants = scatter(tier.grassNear, MEADOW.nearest, MEADOW.near, 1.4, false);
        yield 'grass near';
        const farPlants = scatter(tier.grassFar, MEADOW.near - 2, MEADOW.farthest, 1.2, true);
        this.plant(near, material, nearPlants, 'SpringGrass near');
        this.plant(far, material, farPlants, 'SpringGrass far');
        this.stats.grass = (nearPlants.length + farPlants.length) / 7;
        this.stats.grassTriangles = (nearPlants.length / 7) * (near.index.count / 3)
            + (farPlants.length / 7) * (far.index.count / 3);
    }

    // ── flowers ─────────────────────────────────────────────────────────────────────────

    createFlowerMaterial() {
        const { u } = this;
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = 'SpringFlowers';
        const head = attribute('head', 'vec4'); // offset from the head's middle, flower kind
        const albedo = attribute('color', 'vec3');
        // How far the game has opened this plant: a lock's patch of its kind, a clear's flush, the
        // heat of play over the kinds the player has been playing.
        const opened = this.patches(attribute('aRoot', 'vec4').xyz, head.w).max(u.flush.mul(0.8))
            .max(this.heatOpen(head.w));
        // A head opens with the day, and wide when the game opens it.
        const plant = this.stand(0.45, () => {
            const open = u.open.mul(0.42).add(0.58).add(opened.mul(0.7));
            return positionGeometry.add(head.xyz.mul(open.sub(1.0)));
        });
        material.positionNode = plant.position;
        const { paint, turn } = plant;
        const shine = varying(opened, 'springFlowerOpened');
        const played = varying(this.gameLight(attribute('aRoot', 'vec4').xyz, head.w), 'springFlowerLight');
        material.colorNode = Fn(() => {
            const P = positionWorld;
            const V = normalize(P.sub(u.eye));
            const N = normalize(plant.normal);
            const L = u.sunDir;
            const petal = smoothstep(0.55, 0.9, paint.y);
            const tone = albedo.mul(turn.w.mul(0.24).add(0.88));
            const facing = dot(N, L).abs().mul(0.7).add(0.3);
            // Petals are thin: with the sun behind them they light up from inside.
            const through = pow(clamp(dot(V, L), 0.0, 1.0), 2.2);
            const lantern = pow(tone, vec3(0.85)).mul(through.mul(0.7).add(0.1)).mul(petal.mul(0.75).add(0.25));
            // Low on the plant its neighbours shade it.
            const shade = smoothstep(0.0, 0.12, paint.x.mul(turn.z)).mul(0.5).add(0.5);
            const sun = u.sun.mul(u.sunUp);
            const sky = mix(u.bounce, u.fill, N.y.mul(0.3).add(0.6));
            const lit = tone.mul(facing).add(lantern).mul(sun).mul(0.36)
                .add(tone.mul(sky).mul(1.35))
                .mul(shade)
                // Opened by the game, its petals spread to the light: a little brighter, fresher.
                .add(tone.mul(petal).mul(shine.mul(0.9)).mul(u.fill.mul(1.6).add(u.sun.mul(u.sunUp).mul(0.14))))
                // The game's light: petals lit from within, the stem and leaves a little.
                .add(played.mul(petal.mul(0.8).add(0.2)).mul(1.6));
            return vec4(aerial(u, P, lit), 1.0);
        })();
        return material;
    }

    buildFlowers() {
        const { rng, tier, baked } = this;
        const material = this.createFlowerMaterial();
        const total = SPRING_FLOWERS.reduce((sum, flower) => sum + flower.share, 0);
        const w = {};
        const n = [0, 1, 0];
        /** Pick a kind for a spot: each grows in its own drifts, the marigolds by the water. */
        const choose = (x, z, wet) => {
            let sum = 0;
            const weights = SPRING_FLOWERS.map((flower, index) => {
                const [frequency, threshold] = flower.patch;
                const patchiness = valueNoise(x * frequency * 4, z * frequency * 4, index * 13 + 5);
                const drift = smoothJs(threshold, threshold + 0.26, patchiness);
                const water = flower.wet > 0.5 ? 0.15 + wet * 3 * flower.wet : 1 - wet * 0.7 * (1 - flower.wet);
                const weight = (flower.share / total) * (0.06 + drift) * water;
                sum += weight;
                return weight;
            });
            let pick = rng() * sum;
            for (let i = 0; i < weights.length; i += 1) {
                pick -= weights[i];
                if (pick <= 0) return i;
            }
            return weights.length - 1;
        };
        const scatter = (wanted, nearest, farthest, bias, far) => {
            const lists = SPRING_FLOWERS.map(() => Array.from({ length: far ? 1 : NEAR_VARIANTS }, () => []));
            for (let made = 0, attempt = 0; made < wanted && attempt < wanted * 8; attempt += 1) {
                const place = this.spot(nearest, farthest, bias);
                const { cover, wet } = meadowCover(baked, place.x, place.z, w, n);
                if (rng() >= cover) continue;
                const kind = choose(place.x, place.z, wet);
                const flower = SPRING_FLOWERS[kind];
                // Far flowers are drawn larger than life so the meadow keeps its colour.
                const scale = (0.85 + rng() * 0.4) * (far ? 1.05 + place.depth * 0.02 : 1);
                const list = lists[kind][Math.floor(rng() * lists[kind].length) % lists[kind].length];
                const y = groundHeight(baked, place.x, place.z) - 0.012;
                list.push(place.x, y, place.z, rng() * Math.PI * 2, scale, rng(), rng());
                this.census[flower.id] += 1;
                made += 1;
            }
            return lists;
        };
        const draw = (lists, far) => lists.forEach((variants, kind) => variants.forEach((plants, variant) => {
            if (!plants.length) return;
            const { id } = SPRING_FLOWERS[kind];
            const geometry = this.own(createSpringFlowerGeometry(id, { far, variant }));
            this.plant(geometry, material, plants, `SpringFlower ${id}${far ? ' far' : ''} ${variant}`);
            this.stats.flowers += plants.length / 7;
            this.stats.flowerTriangles += (plants.length / 7) * (geometry.index.count / 3);
        }));
        draw(scatter(tier.flowersNear, MEADOW.nearest + 0.4, MEADOW.near - 1, 1.3, false), false);
        draw(scatter(tier.flowersFar, MEADOW.near - 2.5, MEADOW.farthest, 1.15, true), true);
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
