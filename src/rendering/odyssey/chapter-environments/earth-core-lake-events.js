/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * WHAT THE LAKE THROWS, AND WHAT THE SHAFT DROPS (masterpiece pass, 2026-11-17).
 *
 * The matter of two of the chapter's events (earth-core-clock.js is their schedule), in ONE
 * instanced draw of camera-facing quads, additive:
 *
 *   - THE DOME FOUNTAIN: gobbets of melt thrown up from the fountain's vent on ballistic arcs and
 *     falling back into it (each on its own flight, so the jet plays rather than pulses), and a
 *     few broad soft lights at its foot — the incandescent dome itself. The lake's own shader
 *     (createLavaFloorTSL, uFountain) swells the surface under it and sends rings of fresh melt
 *     out through the crust.
 *   - THE ROCK FALL: a ledge of the shaft's wall lets go. A dozen glowing chunks drop past the
 *     climb toward the lake, each trailing the sparks it sheds.
 *
 * Every particle's place is a closed form of the clock and the event's own numbers (uniforms the
 * chapter writes once per event, while the event's power is zero): nothing is simulated, nothing
 * pops. Per instance: aS = four seeds; aK = (kind, chunk seed 1, chunk seed 2, lag).
 * Kind 0 = fountain gobbet, 1 = the dome's light, 2 = a falling chunk, 3 = a spark off a chunk.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraPosition,
    clamp,
    cos,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    modelWorldMatrixInverse,
    oneMinus,
    positionLocal,
    pow,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { pickByQualityTier } from './shared/odyssey-quality-tier.js';
import { basaltRandom } from './earth-core.tsl.js';
import { shaftRadiusAt } from './earth-core-shaft.js';

const TAU = Math.PI * 2;

/** Gobbets of the fountain per quality tier (the dome's lights and the rock fall are fixed). */
export const LAKE_EVENT_GOBBETS_BY_TIER = Object.freeze({ high: 110, medium: 70, low: 40 });
const DOME_LIGHTS = 5;
const ROCK_CHUNKS = 12;
const SPARKS_PER_CHUNK = 6;

/** How hard the fountain's melt and the falling rock are pulled down (u/s^2): slag, not confetti. */
const FOUNTAIN_GRAVITY = 14;
const ROCK_GRAVITY = 11;

/**
 * Where a rock fall starts, in the chapter group's local frame: on the shaft's wall at `azimuth`,
 * high enough over the watcher that the fall crosses the up-looking frame (a point on the wall is
 * in frame only while it is more than about its radius above the eye; see SHAFT_FALLS), never
 * above the throat.
 * @param {object} plan from planEarthCoreShaft
 * @param {number} azimuth radians round the shaft's axis
 * @param {number} height01 0..1 from the clock
 * @param {number} eyeHeight the watcher's height above the lake
 * @param {THREE.Vector3} [out]
 * @returns {{ origin: THREE.Vector3, inward: THREE.Vector3, h: number }}
 */
export function rockFallOrigin(plan, azimuth, height01, eyeHeight, out = new THREE.Vector3()) {
    const eye = Number.isFinite(eyeHeight) ? Math.max(0, eyeHeight) : 0;
    // 80-100 u over the eye where the shaft allows: the fall starts near the middle of the
    // up-looking frame and travels out to its edge as it comes down past the watcher (from 52 u
    // up it was a second at the frame's rim: capture p 0.026).
    const h = Math.min(132, Math.max(70, eye + 80 + (20 * height01)));
    const d = plan.dirAt(azimuth);
    const r = shaftRadiusAt(h) - 3.5;
    out.set(plan.axis.x + (d.x * r), plan.lakeY + h, plan.axis.z + (d.z * r));
    return { origin: out, inward: new THREE.Vector3(-d.x, 0, -d.z), h };
}

/**
 * @param {object} chapterUniforms the chapter's uniforms (uTime, uCamRight, uCamUp)
 * @param {object} plan from planEarthCoreShaft
 * @param {object} [options] the chapter's create() options (qualityTier)
 * @returns {THREE.Mesh} with `userData.lakeEvents` (its uniforms, for updateLakeEvents)
 */
export function createLakeEvents(chapterUniforms, plan, options = {}) {
    const gobbets = pickByQualityTier(options, LAKE_EVENT_GOBBETS_BY_TIER);
    const rockCount = ROCK_CHUNKS * (1 + SPARKS_PER_CHUNK);
    const count = gobbets + DOME_LIGHTS + rockCount;
    const aS = new Float32Array(count * 4);
    const aK = new Float32Array(count * 4);
    const random = basaltRandom(9173);
    let i = 0;
    for (let k = 0; k < gobbets; k += 1, i += 1) {
        aS.set([random(), random(), random(), random()], i * 4);
        aK.set([0, 0, 0, 0], i * 4);
    }
    for (let k = 0; k < DOME_LIGHTS; k += 1, i += 1) {
        aS.set([random(), random(), random(), random()], i * 4);
        aK.set([1, 0, 0, 0], i * 4);
    }
    for (let c = 0; c < ROCK_CHUNKS; c += 1) {
        const c1 = random();
        const c2 = random();
        aS.set([random(), random(), random(), random()], i * 4);
        aK.set([2, c1, c2, 0], i * 4);
        i += 1;
        for (let k = 0; k < SPARKS_PER_CHUNK; k += 1, i += 1) {
            aS.set([random(), random(), random(), random()], i * 4);
            aK.set([3, c1, c2, 0.06 + (0.85 * random())], i * 4);
        }
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aS: { array: aS, itemSize: 4 },
        aK: { array: aK, itemSize: 4 },
    });

    const u = {
        uTime: chapterUniforms.uTime,
        uCamRight: chapterUniforms.uCamRight,
        uCamUp: chapterUniforms.uCamUp,
        // (x, y, z, power): the fountain's vent on the lake, and how hard it plays.
        uFountain: uniform(new THREE.Vector4(0, plan.lakeY, 0, 0)),
        // (height of the jet, radius of the dome, 0, 0)
        uFountainB: uniform(new THREE.Vector4(12, 8, 0, 0)),
        // (x, y, z, power): where the ledge lets go.
        uRock: uniform(new THREE.Vector4(0, plan.lakeY + 90, 0, 0)),
        // (inward x, inward z, seconds since it let go, 0)
        uRockB: uniform(new THREE.Vector4(1, 0, 0, 0)),
    };

    const S = attribute('aS', 'vec4');
    const K = attribute('aK', 'vec4');
    const kind = K.x;
    const isLight = step(0.5, kind).mul(oneMinus(step(1.5, kind)));
    const isRock = step(1.5, kind);
    const isSpark = step(2.5, kind);

    // ── The fountain's gobbets: up at a speed that reaches their own apex, back down, again. ──
    // Most of the melt is thrown low and falls straight back; a few gobbets reach the jet's top.
    const apex = u.uFountainB.x.mul(S.z.mul(S.z).mul(0.78).add(0.22));
    const v0 = sqrt(apex.mul(2 * FOUNTAIN_GRAVITY));
    // The flight ends a little before the gobbet is back at the lake (it has cooled out by then).
    const flight = v0.mul((2 / FOUNTAIN_GRAVITY) * 0.94);
    const life = fract(u.uTime.div(flight).add(S.y.mul(13.0)));
    const tau = life.mul(flight);
    const throwAz = S.x.mul(TAU);
    const throwOut = S.w.mul(S.w).mul(2.4).add(0.3).mul(u.uFountainB.x.div(14.0));
    const gobbet = vec3(
        u.uFountain.x.add(cos(throwAz).mul(throwOut.mul(tau).add(S.w.mul(u.uFountainB.y).mul(0.3)))),
        u.uFountain.y.add(v0.mul(tau)).sub(tau.mul(tau).mul(FOUNTAIN_GRAVITY * 0.5)).add(0.4),
        u.uFountain.z.add(sin(throwAz).mul(throwOut.mul(tau).add(S.w.mul(u.uFountainB.y).mul(0.3)))),
    );
    // ── The dome's lights: broad and soft, low over the vent, breathing. ──
    const light = vec3(
        u.uFountain.x.add(S.x.sub(0.5).mul(u.uFountainB.y).mul(0.4)),
        u.uFountain.y.add(S.z.mul(u.uFountainB.x).mul(0.42)).add(0.6),
        u.uFountain.z.add(S.y.sub(0.5).mul(u.uFountainB.y).mul(0.4)),
    );
    // ── The rock fall: each chunk leaves its own spot on the ledge a moment after the first,
    // pushed out from the wall, and drops; a spark is the same fall a little later, scattered. ──
    const inward = vec3(u.uRockB.x, 0.0, u.uRockB.y);
    const along = vec3(u.uRockB.y.negate(), 0.0, u.uRockB.x);
    const age = u.uRockB.z.sub(K.y.mul(1.6)).sub(K.w);
    const fallT = max(age, 0.0);
    const rock = vec3(u.uRock.x, u.uRock.y, u.uRock.z)
        .add(along.mul(K.y.sub(0.5).mul(9.0)))
        .add(vec3(0.0, K.z.sub(0.5).mul(3.0), 0.0))
        .add(inward.mul(K.z.mul(3.2).add(1.6).mul(fallT)))
        .add(along.mul(K.y.sub(0.5).mul(2.4).mul(fallT)))
        .sub(vec3(0.0, fallT.mul(fallT).mul(ROCK_GRAVITY * 0.5), 0.0))
        // A spark drifts off its chunk's line.
        .add(vec3(S.x.sub(0.5), S.y.sub(0.5).mul(0.6), S.z.sub(0.5)).mul(K.w.mul(4.0)).mul(isSpark));

    const centre = mix(mix(gobbet, light, isLight), rock, isRock);
    const camLocal = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const dist = length(camLocal.sub(centre));
    const size = mix(
        mix(
            // A gobbet shrinks as it cools; the low, heavy ones are the big ones.
            oneMinus(S.z).mul(1.5).add(0.7).mul(oneMinus(life.mul(0.45))),
            u.uFountainB.y.mul(S.w.mul(0.7).add(1.0)),
            isLight,
        ),
        mix(S.w.mul(1.6).add(1.5), S.w.mul(0.5).add(0.45), isSpark),
        isRock,
    );
    const corner = positionLocal.xy;
    const material = new THREE.MeshBasicNodeMaterial();
    // Faced to the camera's own right and up (the chapter writes them each frame): the rock fall
    // is straight overhead of the climb, where a quad built from the world's up collapses.
    // Gobbets are drawn a little long: they move mostly up and down.
    material.positionNode = centre
        .add(u.uCamRight.mul(corner.x.mul(size)))
        .add(u.uCamUp.mul(corner.y.mul(size).mul(mix(
            mix(float(1.9), float(1.0), isRock),
            // The jet's light stands tall over the vent.
            u.uFountainB.x.div(u.uFountainB.y).mul(S.z.mul(0.5).add(0.5)),
            isLight,
        ))));

    const lakeY = float(plan.lakeY);
    const gobbetFade = u.uFountain.w
        .mul(smoothstep(0.0, 0.06, life)).mul(oneMinus(smoothstep(0.7, 1.0, life)));
    const lightFade = u.uFountain.w.mul(sin(u.uTime.mul(S.x.mul(2.0).add(1.4)).add(S.y.mul(TAU))).mul(0.14).add(0.62));
    const rockFade = u.uRock.w.mul(step(0.0, age)).mul(smoothstep(0.0, 0.25, fallT))
        // Out as it meets the lake.
        .mul(smoothstep(lakeY, lakeY.add(4.0), rock.y))
        .mul(mix(float(1.0), oneMinus(clamp(K.w.mul(1.0), 0.0, 0.8)), isSpark));
    // The air between is hot and smoky: a far event is dimmer, never fogged to a colour.
    const through = exp(dist.mul(-0.0045));
    const vFade = varying(mix(mix(gobbetFade, lightFade, isLight), rockFade, isRock).mul(through), 'vLakeEvFade');
    // Heat by life: pale gold thrown, orange at the apex, red falling back; a chunk burns orange,
    // its sparks gold.
    const vHeat = varying(mix(
        mix(oneMinus(life), float(0.72), isLight),
        mix(float(0.30), oneMinus(K.w.mul(1.2)), isSpark),
        isRock,
    ), 'vLakeEvHeat');
    const vKind = varying(vec3(isLight, isRock.mul(oneMinus(isSpark)), 0.0), 'vLakeEvKind');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r = clamp(length(q), 0.0, 1.0);
        const soft = oneMinus(r);
        const heat = clamp(vHeat, 0.0, 1.0);
        const red = vec3(0.60, 0.07, 0.012);
        const orange = vec3(1.0, 0.40, 0.06);
        const gold = vec3(1.0, 0.80, 0.42);
        const ramp = mix(mix(red, orange, smoothstep(0.0, 0.5, heat)), gold, smoothstep(0.5, 1.0, heat));
        // A gobbet or a spark: a hot heart in its own glow. The dome's light: broad, no heart.
        // A chunk: a lump of glowing rock, solid to its broken edge, hottest at its heart (drawn
        // as a ring of light round a dark stone it read as a bubble: capture p 0.026).
        const blob = pow(soft, 1.6).mul(0.55).add(pow(soft, 5.0).mul(0.9));
        const broad = soft.mul(soft).mul(0.42);
        const lump = length(q.mul(vec2(1.0, 1.22)))
            .add(sin(q.x.mul(6.0).add(q.y.mul(4.0)).add(vHeat.mul(9.0))).mul(0.16));
        const stone = oneMinus(smoothstep(0.52, 0.86, lump))
            .mul(oneMinus(smoothstep(0.0, 0.8, lump)).mul(0.55).add(0.5));
        const shape = mix(mix(blob, broad, vKind.x), stone, vKind.y);
        return ramp.mul(shape).mul(vFade);
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    // Additive light is not fogged toward a fog colour (it would paint the quad): it dims (through).
    material.fog = false;
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'earth-core-lake-events';
    mesh.frustumCulled = false;
    // The chapter drives it (its power is zero between events and outside the cavern).
    mesh.userData.odysseyFadeExempt = true;
    mesh.userData.lakeEvents = {
        uniforms: u, plan, rockSlot: null, fountainSlot: null,
    };
    return mesh;
}

/**
 * Drive the events' matter for this frame.
 * @param {THREE.Mesh} mesh from createLakeEvents
 * @param {object} state
 * @param {object} state.clock from sampleEarthCoreClock
 * @param {number} state.eyeHeight the watcher's height above the lake (chapter-local)
 * @param {number} state.presence 0..1: how much of the cavern is still the frame (0 past the steam)
 * @param {boolean} [state.reducedMotion] no thrown or falling matter (the lake's glow still plays)
 */
export function updateLakeEvents(mesh, {
    clock, eyeHeight = 0, presence = 1, reducedMotion = false,
} = {}) {
    const ev = mesh?.userData?.lakeEvents;
    if (!ev || !clock) return;
    const { uniforms: u, plan } = ev;
    const motion = reducedMotion ? 0 : Math.min(1, Math.max(0, presence));
    const { fountain, rockfall } = clock;
    // The vent moves when the clock's slot does: its envelope is zero at both ends of a slot, so
    // nothing is in the air then.
    if (ev.fountainSlot !== fountain.slot) {
        ev.fountainSlot = fountain.slot;
        u.uFountain.value.x = fountain.x;
        u.uFountain.value.z = fountain.z;
        u.uFountainB.value.x = fountain.height;
        u.uFountainB.value.y = fountain.radius;
    }
    u.uFountain.value.y = plan.lakeY;
    u.uFountain.value.w = fountain.power * motion;
    // The ledge is chosen as the fall begins (from where the watcher is then) and kept.
    // (A fall already under way when the chapter comes into view is let go by: no half-fall.)
    if (ev.rockSlot !== rockfall.slot && rockfall.age > -0.4 && rockfall.age <= 0.5) {
        ev.rockSlot = rockfall.slot;
        const { origin, inward } = rockFallOrigin(plan, rockfall.azimuth, rockfall.height, eyeHeight);
        u.uRock.value.x = origin.x;
        u.uRock.value.y = origin.y;
        u.uRock.value.z = origin.z;
        u.uRockB.value.x = inward.x;
        u.uRockB.value.y = inward.z;
    }
    u.uRockB.value.z = rockfall.age;
    u.uRock.value.w = ev.rockSlot === rockfall.slot ? rockfall.power * motion : 0;
}
