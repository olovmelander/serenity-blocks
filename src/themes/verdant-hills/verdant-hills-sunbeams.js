/**
 * Verdant Hills — the sun's shafts.
 *
 * Where the clouds part, the sun comes down through the valley's air as a shaft: a slanted
 * column of lit haze from the gap in the deck to the pool of light it lays on the land. A
 * four-line clear opens the clouds and sends one great shaft across the valley with its fingers
 * beside it; the storm light and the long gold keep a few standing by themselves, each under a
 * real gap of the cloud field (it fades when a cloud drifts over its place in the deck).
 *
 * Every shaft is one strip that turns to face the lens about its own axis, which is the sun's
 * ray: bright along its middle, combed into fingers, thinning with height as the air does. It is
 * light added to the scene and it is cut by whatever stands in front of it, so the home hill,
 * the oak and the mill stay crisp. Drawn on every tier: it replaces the beam the post chain used
 * to march, which a shaft a few hundred metres wide slipped between the steps of.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, cross, dot, exp, float, mix, normalize, saturate, smoothstep, step, uniformArray,
    varying, vec2, vec3, vec4,
} from 'three/tsl';
import { VERDANT_HILLS_CLOUD_BASE } from './verdant-hills-light.js';

const ROWS = 2;
/** The game's own shaft and the fingers beside it. */
const GAME_BEAMS = 5;
/** The weather's shafts. */
const WEATHER_BEAMS = 8;
export const VERDANT_HILLS_SUNBEAMS = GAME_BEAMS + WEATHER_BEAMS;
/** How far up a shaft is drawn: to a little way into the deck. */
const BEAM_TOP = VERDANT_HILLS_CLOUD_BASE + 240;
/**
 * The fingers of the game's shaft: where each stands from the pool's middle (in pool radii,
 * across and along the view), how wide it is (of the pool's radius) and how bright.
 */
const FINGERS = Object.freeze([
    [0, 0, 0.5, 1],
    [-0.62, 0.3, 0.2, 0.55],
    [0.58, -0.25, 0.24, 0.62],
    [-1.0, -0.35, 0.14, 0.34],
    [1.05, 0.4, 0.16, 0.4],
]);
/**
 * Where the weather's shafts stand in the valley at rest (x, z), how wide each is (metres) and
 * how bright. They ride down the wind with the clouds, each across RIDE metres of the valley,
 * and come round again.
 */
const STANDS = Object.freeze([
    [-430, -520, 62, 1.0], [-250, -720, 84, 0.8], [-560, -900, 100, 0.7], [110, -660, 70, 0.85],
    [300, -470, 56, 1.0], [430, -840, 92, 0.75], [-120, -1010, 110, 0.6], [590, -640, 66, 0.9],
]);
const RIDE = 880;

export class VerdantHillsSunbeams {
    constructor({ light, groundHeight = () => 20 }) {
        this.light = light;
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsSunbeams';
        // Per shaft: [foot xyz, strength] [half width, seed, under a gap of the field (1) or the
        // game's own (0), 0].
        this.rows = Array.from({ length: VERDANT_HILLS_SUNBEAMS * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
        for (let i = 0; i < VERDANT_HILLS_SUNBEAMS; i += 1) {
            this.rows[i * ROWS + 1].set(40, (i * 0.618034) % 1, i >= GAME_BEAMS ? 1 : 0, 0);
        }
        this.live = 0;
    }

    build() {
        const strip = [];
        const indices = [];
        for (let beam = 0; beam < VERDANT_HILLS_SUNBEAMS; beam += 1) {
            const base = beam * 4;
            strip.push(0, -1, beam, 0, 1, beam, 1, -1, beam, 1, 1, beam);
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        const geometry = new THREE.BufferGeometry();
        // The shader places every vertex; `position` only has to exist.
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strip.length), 3));
        geometry.setAttribute('aBeam', new THREE.Float32BufferAttribute(strip, 3));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 600, -600), 4000);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsSunbeams';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 55;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        });
        material.name = 'VerdantHillsSunbeams';
        const rows = uniformArray(this.rows, 'vec4');
        const strip = attribute('aBeam', 'vec3'); // along 0..1 (foot to deck), side, shaft
        const first = strip.z.add(0.5).floor().toInt().mul(ROWS);
        const foot = rows.element(first);
        const shape = rows.element(first.add(1)); // half width, seed, under a gap of the field, -
        const axis = normalize(light.uSunDir);
        const reach = float(BEAM_TOP).sub(foot.y).div(axis.y);
        const centre = foot.xyz.add(axis.mul(strip.x.mul(reach)));
        const toEye = normalize(cameraPosition.sub(centre));
        // The strip faces the lens about the sun's ray. (Never looked straight down: the sun is
        // out of the frame, so the cross product keeps its length.)
        const side = normalize(cross(axis, toEye).add(vec3(0.00001, 0, 0)));
        // A weather's shaft stands only under a real gap of the field: where its ray meets the
        // deck must be clear, and it fades as a cloud drifts over.
        const deck = light.cloudField(light.sunFoot(foot.xyz), 2.5).r;
        const clear = smoothstep(0.16, -0.06, deck.sub(light.uCloudEdge).div(light.uCloudSpan));
        const open = mix(float(1), clear, shape.z);
        const power = foot.w.mul(open);
        // With nothing to show the strip folds to a point: no pixel is paid for it.
        const wide = shape.x.mul(1.9).mul(step(0.004, power));
        material.positionNode = centre.add(side.mul(strip.y.mul(wide)));
        const across = varying(strip.y, 'verdantBeamAcross');
        const along = varying(strip.x, 'verdantBeamAlong');
        const strength = varying(power, 'verdantBeamPower');
        const seed = varying(shape.y, 'verdantBeamSeed');
        // The longer the line of sight lies inside the column, the brighter it is: most looking
        // up along it. Read once a vertex.
        const slant = dot(toEye, axis);
        const depth = varying(float(1).div(float(1).sub(slant.mul(slant)).max(0.16).sqrt()), 'verdantBeamDepth');
        const height = varying(strip.x.mul(reach).mul(axis.y), 'verdantBeamHeight');
        // (Clamped: under MSAA the edge pixels of a strip extrapolate its coordinates.)
        const u = saturate(across.abs());
        const profile = exp(u.mul(u).mul(-3.4)).mul(float(1).sub(u.mul(u)));
        // Fingers: the gap's ragged rim combs the light, and the comb drifts as the cloud does.
        const comb = light.noise(vec2(across.mul(0.55).add(seed.mul(7.3)), seed.add(light.uTime.mul(0.011))));
        const fingers = smoothstep(0.12, 0.88, comb.r.mul(0.7).add(comb.g.mul(0.3))).mul(0.8).add(0.35);
        // Thick low air glows most; the shaft thins as it climbs and melts into the deck. Its
        // foot is the pool of light on the land, so the first metres rise out of that softly.
        const air = exp(height.max(0).mul(-0.0019));
        const ends = smoothstep(0.0, 0.03, along).mul(smoothstep(1.0, 0.7, along));
        const glow = profile.mul(fingers).mul(air).mul(ends).mul(strength)
            .mul(depth);
        // The colour of sunlit haze, a little warmer than the day's light.
        const tone = light.uSunColor.mul(vec3(1.0, 0.9, 0.7)).mul(0.19);
        // Light added to what is behind it; the target's alpha is left alone.
        material.outputNode = vec4(tone.mul(glow), 0);
        return material;
    }

    /**
     * Stand the shafts for this frame. `pool` is the game's pool of light in world terms
     * ({ x, z, radius, strength } or null), `stage` says which way the lens looks, `weather`
     * how strongly the day's own shafts stand (0..1) and `travel` how far the clouds have ridden
     * down the wind since the session began (metres: x, z).
     */
    update(pool, stage, weather = 0, travel = null) {
        const { rows } = this;
        let live = 0;
        const power = pool && Number.isFinite(pool.strength) ? Math.max(0, Math.min(1, pool.strength)) : 0;
        for (let i = 0; i < GAME_BEAMS; i += 1) {
            const row = rows[i * ROWS];
            if (!(power > 0.002) || !stage) {
                row.w = 0;
                continue;
            }
            const [across, away, width, bright] = FINGERS[i];
            const x = pool.x + (stage.right.x * across - stage.forward.x * away) * pool.radius;
            const z = pool.z + (stage.right.z * across - stage.forward.z * away) * pool.radius;
            row.set(x, this.groundHeight(x, z), z, power * bright);
            rows[i * ROWS + 1].x = pool.radius * width;
            live += 1;
        }
        const standing = Number.isFinite(weather) ? Math.max(0, Math.min(1, weather)) : 0;
        const wind = this.light.uWindDir.value;
        // How far down the wind the clouds have come: the shafts ride with their gaps.
        const ridden = travel ? travel.x * wind.x + travel.z * wind.z : 0;
        for (let i = 0; i < WEATHER_BEAMS; i += 1) {
            const row = rows[(GAME_BEAMS + i) * ROWS];
            if (!(standing > 0.002)) {
                row.w = 0;
                continue;
            }
            const [x0, z0, width, bright] = STANDS[i];
            const ride = ((((ridden + i * 137.5) % RIDE) + RIDE) % RIDE) / RIDE;
            const x = x0 + wind.x * (ride - 0.5) * RIDE;
            const z = z0 + wind.z * (ride - 0.5) * RIDE;
            // It comes in and goes out softly at the ends of its ride.
            const ends = Math.sin(Math.PI * ride) ** 0.7;
            row.set(x, this.groundHeight(x, z), z, standing * bright * ends * 0.42);
            rows[(GAME_BEAMS + i) * ROWS + 1].x = width;
            live += 1;
        }
        this.live = live;
    }

    reset() {
        for (let i = 0; i < VERDANT_HILLS_SUNBEAMS; i += 1) this.rows[i * ROWS].w = 0;
        this.live = 0;
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
