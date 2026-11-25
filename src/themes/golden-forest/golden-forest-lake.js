/**
 * Golden Forest — the lake.
 *
 * A real planar mirror of the shores, sky and fireflies (three's ReflectorNode), broken up
 * the way still water is: glassy in the lee of the banks, ruffled where the breeze lays
 * its cat's-paws, tea-brown and clear over the gravel at your feet. The lake also carries
 * a small pool of analytic rings — every piece that locks, every line that clears, and the
 * odd rising fish sends one across the water, bending the reflection as it goes. Three larger
 * things cross it too, each an event's own (setTracks): the great wave of gold four lines send
 * from the board to the far shore, the spiral a twist winds into the water, and the pulse of
 * gold a back-to-back sends down the sun's road. The air (the light rig's) ruffles it and sets
 * how broad that road lies.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, Loop, abs, atan, cameraPosition, color, cos, dot, exp, float, floor, fract, hash, int, length, max, mix,
    normalize, positionWorld, pow, reflect, reflector, saturate, screenUV, sign, sin, smoothstep, sqrt, step, texture,
    uniform, uniformArray, vec2, vec3,
} from 'three/tsl';
import { GOLDEN_FOREST_BREEZE } from './golden-forest-light.js';
import { GoldenForestRipples } from './golden-forest-ripples.js';
import {
    GOLDEN_FOREST_BOUNDS, GOLDEN_FOREST_MAP_BIAS, GOLDEN_FOREST_MAP_RANGE,
} from './golden-forest-terrain.js';

/** Everything the lake mirrors is on this layer as well as the default one. */
export const GOLDEN_FOREST_MIRROR_LAYER = 1;
export const GOLDEN_FOREST_RING_SPEED = 2.6;
const RING_WAVE_NUMBER = 5.2;
/** Great waves and spirals the lake carries at once (golden-forest-reactions.js starts as many). */
const TRACK_SLOTS = 3;
/**
 * The great wave: metres a second its crest runs, where it starts from, its life (s), and the
 * crest's width (m, and the share of its radius it broadens by).
 */
export const GOLDEN_FOREST_WAVE = Object.freeze({
    speed: 15, start: 3, life: 9, width: 2.6, spread: 0.03,
});
/** The spiral: its life (s), how fast its reach grows (m/s from a first reach) and it turns. */
export const GOLDEN_FOREST_SWIRL = Object.freeze({
    life: 4.6, reach: 1.5, grow: 1.7, spin: 5.2,
});
/** The pulse on the sun's road: metres from the eye it starts and ends at, and its life (s). */
export const GOLDEN_FOREST_ROAD = Object.freeze({ far: 100, near: 5, life: 3.4 });

export class GoldenForestLake {
    constructor({
        light, tier, lakeMap, samples = 0,
    }) {
        this.light = light;
        this.tier = tier;
        this.lakeMap = lakeMap;
        /** Samples of the mirror's target: the scene pass's, so a mirrored material builds one pipeline. */
        this.samples = samples;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestLake';
        this.ripples = new GoldenForestRipples(tier.ripples);
        this.uShimmer = uniform(0);
        // How hot play runs (GoldenForestWorld.wear): the rings tilt the mirror less as they crowd.
        this.uHeat = uniform(0);
        // A back-to-back's gold (0..1.5): it broadens the sun's road while it lasts.
        this.uGold = uniform(0);
        // Where the eye rests, and how many glitter cells a unit of view angle holds (watch()).
        this.uEye = uniform(new THREE.Vector3(0, 1.6, 8));
        this.uGlintCells = uniform(260);
        // The events' own marks on the water (setTracks): great waves (x, z, radius, strength),
        // spirals (x, z, age, strength signed by the way it turns), and two pulses on the sun's
        // road (distance from the eye, strength; twice).
        this.waveRows = Array.from({ length: TRACK_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.swirlRows = Array.from({ length: TRACK_SLOTS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.uWaveCount = uniform(0, 'int');
        this.uSwirlCount = uniform(0, 'int');
        this.uRoad = uniform(new THREE.Vector4(0, 0, 0, 0));
        this.reflection = null;
        this.owned = [];
    }

    /** Lake-map coordinate for a world position (TSL). */
    mapCoordinate(world = positionWorld) {
        const {
            minX, maxX, minZ, maxZ,
        } = GOLDEN_FOREST_BOUNDS;
        return vec2(world.x.sub(minX).div(maxX - minX), world.z.sub(minZ).div(maxZ - minZ));
    }

    build({ mirror = true } = {}) {
        const geometry = new THREE.PlaneGeometry(1800, 620, 1, 1);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, -250);
        if (mirror && this.tier.reflection > 0) {
            this.reflection = reflector({
                resolutionScale: this.tier.reflection, bounces: false, generateMipmaps: false, samples: this.samples,
            });
            this.reflection.target.rotateX(-Math.PI / 2);
            this.reflection.target.name = 'GoldenForestLakeMirror';
            this.group.add(this.reflection.target);
        }
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'GoldenForestWater';
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 2;
        this.mesh = mesh;
        this.group.add(mesh);
        this.owned.push(geometry, material);
        return this;
    }

    /** Mirror only what was tagged: the lake itself and anything left untagged stay out. */
    watch(camera) {
        if (!camera) return;
        // The glitter is laid out from the resting eye, so it stays on the water as the camera
        // breathes; about seven pixels a cell in a 1080-line frame.
        this.uEye.value.copy(camera.position);
        const angle = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2);
        this.uGlintCells.value = 1080 / (7 * angle);
        if (!this.reflection) return;
        this.reflection.reflector.getVirtualCamera(camera).layers.set(GOLDEN_FOREST_MIRROR_LAYER);
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({ fog: false });
        material.name = 'GoldenForestWaterMaterial';
        const world = positionWorld;
        const t = light.uTime;
        const map = texture(this.lakeMap, this.mapCoordinate(world));
        const depth = map.r.mul(GOLDEN_FOREST_MAP_RANGE).sub(GOLDEN_FOREST_MAP_BIAS).negate();
        const toEye = cameraPosition.sub(world);
        const range = length(toEye);
        const view = toEye.div(range);

        // -- the surface ---------------------------------------------------------------
        const wind = vec2(light.uWindDir.x, light.uWindDir.z);
        const drift = wind.mul(t.mul(0.02));
        const swell = light.noise(world.xz.mul(0.011).sub(drift.mul(0.35)));
        const chop = light.noise(world.xz.mul(0.06).sub(drift));
        const ripple = light.noise(world.xz.mul(0.31).sub(drift.mul(2.6)).add(chop.rg.mul(0.3)));
        // Cat's-paws: patches the breeze has ruffled, sliding over glassy water.
        const paws = smoothstep(0.42, 0.7, light.noise(world.xz.mul(0.004).sub(drift.mul(0.12))).g.mul(0.7)
            .add(swell.b.mul(0.3)));
        const lee = smoothstep(0.02, 0.5, map.g);
        // Glassy at rest; the gusts and the evening wind play raises spread the cat's-paws out of the
        // lee, and a breezy air lays them over the whole lake.
        const ruffle = paws.mul(0.75).add(0.16).mul(lee.mul(0.8).add(0.2)).add(light.uGust.mul(0.3))
            .add(light.uWind.sub(GOLDEN_FOREST_BREEZE).mul(0.55))
            .add(light.uRuffle.mul(paws.mul(0.6).add(0.4)));
        const waves = swell.rg.sub(0.5).mul(0.05)
            .add(chop.gb.sub(0.5).mul(0.11))
            .add(ripple.ba.sub(0.5).mul(0.16))
            .mul(ruffle);

        // -- rings ---------------------------------------------------------------------
        const rings = uniformArray(this.ripples.rings);
        let ringSlope = vec2(0, 0);
        let ringLight = float(0);
        for (let i = 0; i < this.ripples.count; i += 1) {
            const ring = rings.element(i); // x, z, age, strength
            const offset = world.xz.sub(ring.xy);
            const distance = length(offset).add(0.0001);
            const front = distance.sub(ring.z.mul(GOLDEN_FOREST_RING_SPEED));
            const packet = exp(front.div(ring.z.mul(0.5).add(0.55)).pow2().negate());
            const amplitude = packet.mul(ring.w).mul(exp(ring.z.mul(-0.42))).div(distance.mul(0.09).add(1));
            const phase = front.mul(RING_WAVE_NUMBER);
            ringSlope = ringSlope.add(offset.div(distance).mul(sin(phase).mul(amplitude).mul(0.44)));
            ringLight = ringLight.add(amplitude.mul(cos(phase).mul(0.5).add(0.5)));
        }
        // Rings that stack (a cascade, a run of hard drops) interfere rather than burn the water
        // white: their tilt and their light both ease off as they pile up.
        ringSlope = ringSlope.div(length(ringSlope).mul(0.6).add(1));
        ringLight = ringLight.div(sqrt(ringLight.pow2().add(1)));

        // -- the events' own marks --------------------------------------------------------
        // Each list is read to its count, so a lake nothing has crossed pays for none of it.
        const greatWaves = uniformArray(this.waveRows, 'vec4');
        const spirals = uniformArray(this.swirlRows, 'vec4');
        const sunFlat = normalize(vec2(light.uSunDir.x, light.uSunDir.z));
        const marks = Fn(() => {
            const tilt = vec2(0, 0).toVar();
            const gold = float(0).toVar();
            const at = world.xz.toVar();
            // The great wave: one broad crest running out from the board with a train of lesser
            // swells behind it, gold on the flank it turns to the sun.
            Loop({
                start: int(0), end: int(this.uWaveCount), type: 'int', condition: '<',
            }, ({ i }) => {
                const wave = greatWaves.element(i); // x, z, radius, strength
                const offset = at.sub(wave.xy).toVar();
                const distance = length(offset).add(0.0001).toVar();
                const outward = offset.div(distance).toVar();
                const behind = distance.sub(wave.z).toVar();
                const width = wave.z.mul(GOLDEN_FOREST_WAVE.spread).add(GOLDEN_FOREST_WAVE.width).toVar();
                const crest = exp(behind.div(width).pow2().negate()).toVar();
                const trailing = exp(behind.add(width.mul(2.4)).div(width.mul(2.2)).pow2().negate());
                const train = sin(behind.mul(0.8)).mul(trailing)
                    .mul(0.4);
                tilt.addAssign(outward.mul(behind.div(width).mul(crest).mul(-1.5).add(train)
                    .mul(wave.w)));
                gold.addAssign(crest.mul(wave.w).mul(dot(outward, sunFlat).mul(0.3).add(0.7)));
            });
            // The spiral: two arms winding out of where the piece turned, running round as they spread.
            Loop({
                start: int(0), end: int(this.uSwirlCount), type: 'int', condition: '<',
            }, ({ i }) => {
                const swirl = spirals.element(i); // x, z, age, strength (signed: the way it turns)
                const offset = at.sub(swirl.xy).toVar();
                const distance = length(offset).add(0.0001).toVar();
                const strength = abs(swirl.w).toVar();
                const reach = swirl.z.mul(GOLDEN_FOREST_SWIRL.grow).add(GOLDEN_FOREST_SWIRL.reach);
                const hold = exp(distance.div(reach).pow2().negate()).mul(strength).toVar();
                const phase = distance.mul(2.6).sub(atan(offset.y, offset.x).mul(2).mul(sign(swirl.w)))
                    .sub(swirl.z.mul(GOLDEN_FOREST_SWIRL.spin))
                    .toVar();
                tilt.addAssign(offset.div(distance).mul(sin(phase)).mul(hold).mul(0.5));
                gold.addAssign(cos(phase).mul(0.5).add(0.5).pow2()
                    .mul(hold)
                    .mul(0.8));
            });
            return vec3(tilt, gold);
        })();
        // A back-to-back's pulse: a long low swell lying across the lake, running from the far shore
        // to the eye (uRoad: its distance from the eye and its strength, twice). It tilts the mirror
        // as it passes, so it is seen as a line of bent reflection before it is seen as light.
        const fromEye = world.xz.sub(this.uEye.xz);
        const reachEye = length(fromEye).add(0.0001);
        const roadPulse = (distance, strength) => {
            const behind = reachEye.sub(distance).div(distance.mul(0.16).add(3.5));
            const crest = exp(behind.pow2().negate()).mul(strength);
            return { crest, tilt: behind.mul(crest).mul(-1.2) };
        };
        const roadA = roadPulse(this.uRoad.x, this.uRoad.y);
        const roadB = roadPulse(this.uRoad.z, this.uRoad.w);
        const pulse = roadA.crest.add(roadB.crest);
        ringSlope = ringSlope.add(marks.xy).add(fromEye.div(reachEye).mul(roadA.tilt.add(roadB.tilt)));
        // In hot play the rings come thick and fast: they keep their gold crests and glints but
        // tilt the mirror less, so the near water stays a deep mirror instead of filling with sky.
        const slope = waves.add(ringSlope.mul(this.uHeat.mul(-0.6).add(1)));
        const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));

        // -- what the water shows --------------------------------------------------------
        let mirrored;
        if (this.reflection) {
            // Reflections stretch down the screen far more than across it, and far water
            // averages its ripples into a blur rather than a wobble.
            const calm = float(1).div(range.mul(0.018).add(1));
            const bend = vec2(slope.x.mul(0.05), slope.y.mul(0.13)).mul(calm.mul(0.85).add(0.15));
            mirrored = this.reflection.sample(screenUV.flipX().add(bend).clamp(0.002, 0.998)).rgb;
        } else mirrored = light.sky(reflect(view.negate(), normal));
        const facing = saturate(dot(normal, view));
        const fresnel = pow(facing.oneMinus(), 5).mul(0.94).add(0.06);
        const sunlit = light.sunlight();
        // Tea-coloured water: the gravel shows through for a pace or two, then is gone.
        const bed = light.noise(world.xz.mul(0.9));
        const gravel = mix(color(0x3a2410), color(0x9a7038), bed.g.mul(0.6).add(bed.a.mul(0.4)));
        const clear = exp(depth.max(0).mul(-1.25));
        const up = vec3(0, 1, 0);
        const body = gravel.mul(clear).mul(light.uSunColor.mul(sunlit).mul(0.3).add(light.ambient(up).mul(1.2)))
            .add(color(0x1a0d05).mul(clear.oneMinus()).mul(light.ambient(up)).mul(1.4));
        const shallow = float(1).sub(smoothstep(0.0, 0.16, depth));
        // The sun's own glitter, crisper than the mirror can hold it.
        const micro = normalize(vec3(waves.x.mul(-2.4).sub(ringSlope.x), 1, waves.y.mul(-2.4).sub(ringSlope.y)));
        const glitter = pow(saturate(dot(micro, normalize(view.add(light.uSunDir)))), 700).mul(sunlit);
        // Sun glitter: points of light that come and go on the ruffled water in the sun's path. A
        // ripple facet flashes when it is tilted to the halfway vector between the eye and the
        // sun; with a slope spread `rough`, the share of facets that are is about
        // exp(-tan^2(theta_h) / 2 rough^2), so each cell lights with that chance. That draws the
        // sun's column narrow across and long toward the eye, as on real water, and a breeze
        // widens it. The cells are laid out in the angles the eye sees (bearing, depression), so
        // a cell is a few pixels wide at any range and never shimmers into slivers far off.
        const rel = world.xz.sub(this.uEye.xz);
        const bearing = rel.x.div(max(rel.y.negate(), 0.5));
        const depression = this.uEye.y.sub(world.y).div(max(length(rel), 0.5));
        const grid = vec2(bearing, depression).mul(this.uGlintCells);
        const cell = floor(grid).add(4096);
        const id = cell.x.mul(1597).add(cell.y.mul(7919));
        const seed = hash(id);
        const jitter = vec2(hash(id.add(1)), hash(id.add(2))).sub(0.5).mul(0.5);
        const spot = exp(length(fract(grid).sub(0.5).sub(jitter)).pow2().mul(-16));
        const twinkle = pow(saturate(sin(t.mul(hash(id.add(3)).mul(4).add(1.5)).add(seed.mul(40)))), 6);
        const halfway = normalize(view.add(light.uSunDir));
        const tilt2 = halfway.x.mul(halfway.x).add(halfway.z.mul(halfway.z)).div(max(halfway.y.mul(halfway.y), 1e-4));
        // (A back-to-back's gold broadens the road: more of the water's facets find the sun.)
        const rough = ruffle.min(1).mul(0.07).add(0.03).add(this.uGold.mul(0.045));
        const odds = exp(tilt2.div(rough.mul(rough).mul(2)).negate());
        const sparkle = spot.mul(twinkle).mul(step(float(1).sub(odds.mul(0.85)), seed))
            .mul(sunlit).mul(float(1).sub(shallow));
        // The pulse's crest is molten gold, broadest and brightest on the sun's road and thinning
        // away to either side of it (the road's own glitter is white already: the gold must lie
        // beside it too).
        const road = light.uGlitter.mul(pulse.mul(2.2).add(1));
        const beside = pow(saturate(dot(fromEye.div(reachEye), sunFlat)), 5).mul(0.85).add(0.15);
        const surface = mix(body, mirrored, fresnel)
            .add(light.uSunColor.mul(glitter).mul(this.uShimmer.mul(1.2).add(1.3)).mul(road))
            .add(light.uSunColor.mul(sparkle).mul(this.uShimmer.mul(1.2).add(2.8)).mul(road))
            .add(mix(vec3(1.8, 0.6, 0.08), light.uSunColor.mul(0.4), 0.3).mul(pulse).mul(beside)
                .mul(float(1).sub(shallow))
                .mul(0.4))
            // Rings carry a thread of gold on their crests.
            // (A thread, not a sheet: crowded rings in hot play draw finer threads, not a pale disc.)
            .add(vec3(1.5, 0.78, 0.2).mul(ringLight).mul(light.uGlow.mul(0.15).add(0.22))
                .mul(this.uHeat.mul(-0.45).add(1)))
            // The great wave's crest and the spiral's arms are molten gold.
            .add(mix(vec3(1.5, 0.78, 0.2), light.uSunColor.mul(0.5), 0.4).mul(marks.z)
                .mul(light.uGlow.mul(0.3).add(0.75)));
        // The waterline is soft: the last finger of water barely tints the gravel under it.
        const wetGravel = gravel.mul(0.55).mul(light.uSunColor.mul(sunlit).mul(0.4).add(light.ambient(up).mul(1.2)));
        material.colorNode = light.haze(mix(surface, wetGravel, shallow.mul(0.8)), { world });
        return material;
    }

    /**
     * `worn` (GoldenForestWorld.wear) carries how hot play runs: the sun's path on the water burns
     * brighter with it, and a back-to-back's gold pours down it.
     */
    update(dt, frame = {}, worn = null) {
        this.ripples.update(dt);
        const unit = (value) => (Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0);
        const gold = Number.isFinite(worn?.gold) ? THREE.MathUtils.clamp(worn.gold, 0, 1.5) : 0;
        this.uHeat.value = unit(worn?.level);
        this.uGold.value = gold;
        this.uShimmer.value = Math.min(1.6, unit(frame.shimmer) + unit(worn?.level) * 0.2
            + unit(worn?.fever) * 0.2 + gold * 0.4);
    }

    /**
     * The events' marks for this frame: great waves and spirals ({ x, z: where on the water,
     * age, strength, turn }) and pulses on the sun's road ({ age, strength }). Live ones are
     * packed at the front of each list; the rest cost nothing.
     */
    setTracks({ waves = [], swirls = [], roads = [] } = {}) {
        // (An age that is no number, or negative, is not on the water: its strength and its radius
        // would be negative, and a pulse's bell NaN.)
        const live = (track) => track && Number.isFinite(track.x) && Number.isFinite(track.z)
            && track.age >= 0 && Number.isFinite(track.age) && track.strength > 0
            && Number.isFinite(track.strength);
        let count = 0;
        for (let i = 0; i < waves.length && count < TRACK_SLOTS; i += 1) {
            const wave = waves[i];
            if (!live(wave) || wave.age >= GOLDEN_FOREST_WAVE.life) continue;
            const share = wave.age / GOLDEN_FOREST_WAVE.life;
            // It rises out of the water over its first moments and thins as it spreads.
            const strength = Math.min(1.5, wave.strength) * Math.min(1, wave.age / 0.35) * (1 - share) ** 1.15;
            const radius = GOLDEN_FOREST_WAVE.start + wave.age * GOLDEN_FOREST_WAVE.speed;
            this.waveRows[count].set(wave.x, wave.z, radius, strength);
            count += 1;
        }
        this.uWaveCount.value = count;
        count = 0;
        for (let i = 0; i < swirls.length && count < TRACK_SLOTS; i += 1) {
            const swirl = swirls[i];
            if (!live(swirl) || swirl.age >= GOLDEN_FOREST_SWIRL.life) continue;
            const share = swirl.age / GOLDEN_FOREST_SWIRL.life;
            const strength = Math.min(1.5, swirl.strength) * Math.min(1, swirl.age / 0.25) * (1 - share) ** 1.4;
            const signed = Math.max(1e-4, strength) * (swirl.turn < 0 ? -1 : 1);
            this.swirlRows[count].set(swirl.x, swirl.z, swirl.age, signed);
            count += 1;
        }
        this.uSwirlCount.value = count;
        const road = [0, 0, 0, 0];
        count = 0;
        for (let i = 0; i < roads.length && count < 2; i += 1) {
            const pulse = roads[i];
            const running = pulse && pulse.strength > 0 && Number.isFinite(pulse.strength)
                && Number.isFinite(pulse.age) && pulse.age >= 0 && pulse.age < GOLDEN_FOREST_ROAD.life;
            if (!running) {
                continue;
            }
            const share = pulse.age / GOLDEN_FOREST_ROAD.life;
            // It runs the road quickly at first and slows as it nears the eye.
            const run = 1 - (1 - Math.min(1, share * 1.2)) ** 2.2;
            road[count * 2] = GOLDEN_FOREST_ROAD.far + (GOLDEN_FOREST_ROAD.near - GOLDEN_FOREST_ROAD.far) * run;
            road[count * 2 + 1] = Math.min(1.5, pulse.strength) * Math.sin(Math.PI * share) ** 0.7;
            count += 1;
        }
        this.uRoad.value.set(road[0], road[1], road[2], road[3]);
    }

    reset() {
        this.ripples.reset();
        this.setTracks();
    }

    dispose() {
        this.reflection?.dispose?.();
        this.reflection = null;
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
