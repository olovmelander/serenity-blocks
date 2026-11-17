/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE SEA VENT — where the lava meets the sea (masterpiece pass, 2026-11-17).
 *
 * The shaft's throat opens onto the sea floor (ADR-0017: the vent's lip is at the world's own
 * seabed height), and the 1->2 seam is the eye climbing out of it. Until now nothing stood there:
 * the steam closed over the frame, turned white, and thinned into mid-blue water — a fade through
 * fog. This is what stands at the lip, so the crossing is a place:
 *
 *   - BLACK SMOKERS: a ring of tall chimneys on the vent's rim, sulphide-black, their flanks split
 *     by fissures that glow, crust over and split again, their undersides lit by the lava below.
 *     The camera looks straight up the shaft, so from inside the steam they are dark spires
 *     converging on the sea's eye, and from the water they stand round the frame until the eye has
 *     climbed past their mouths;
 *   - SMOKE: a plume rolling up from each mouth, soot-black, ember-lit from underneath, breaking
 *     into shreds as it rises;
 *   - BUBBLES: columns of gas racing up past the eye from the vent, their rims orange where the
 *     lava lights them and silver higher up;
 *   - SPARKS OF LIFE: slow blue-green points in the dark water beyond, seen only while the water
 *     is dark (and only in the sea's eye while the eye is still in the steam).
 *
 * Everything is world-anchored (the chapter group's LOCAL frame, as earth-core-shaft.js) and a
 * continuous function of the camera's progress and the clock. Four draws, three materials' worth
 * of pipelines beside the shell; the group is exempt from the manager's crossfade
 * (`odysseyFadeExempt`): the eye leaves these things below it, and what is still in a free
 * camera's view dissolves by `seaVentPresence` before the chapter group goes.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    length,
    max,
    min,
    mix,
    modelWorldMatrixInverse,
    normalLocal,
    normalize,
    oneMinus,
    positionLocal,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { noise3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';
import { pickByQualityTier } from './shared/odyssey-quality-tier.js';
import { SHAFT } from './earth-core-shaft.js';
import { EARTH_CORE_THROUGH_STEAM_ORDER, basaltRandom, earthCoreNoise01 } from './earth-core.tsl.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * The chimneys: azimuth round the shaft's axis (0 = toward the opening's vista, which is
 * screen-DOWN while climbing, where the rail and the orbs rise: kept clear), distance from the
 * axis, height above the vent's lip, girth at the foot.
 *
 * WHERE A CHIMNEY CAN BE SEEN. The camera looks straight up (fov 58: 29 deg toward the frame's top
 * and bottom, ~42 deg toward its sides), so a point at radius R from the axis is in frame only
 * while it is more than R / tan(that angle) above the eye. The tall ones stand toward the frame's
 * top and sides: from orb 5's station (the eye ~22 u under the lip) their upper halves ring the
 * sea's eye, and the last mouths leave the frame ~27 u over the lip (p ~0.075), while the water is
 * still dark and well before the vent's presence starts to fade (seaVentPresence). A stack still
 * in frame once the ocean's blue has come up is a black shape that then dissolves in plain view
 * (capture p 0.081, heights 86/98): hence these heights.
 */
export const SEA_VENT_CHIMNEYS = Object.freeze([
    Object.freeze({
        azimuth: 62 * DEG, r: 35, height: 46, girth: 6.4, seed: 3,
    }),
    Object.freeze({
        azimuth: 104 * DEG, r: 30, height: 49, girth: 7.6, seed: 7,
    }),
    Object.freeze({
        azimuth: 148 * DEG, r: 37, height: 44, girth: 6.0, seed: 11,
    }),
    Object.freeze({
        azimuth: -166 * DEG, r: 31, height: 72, girth: 8.2, seed: 17,
    }),
    Object.freeze({
        azimuth: -120 * DEG, r: 36, height: 60, girth: 6.8, seed: 23,
    }),
    Object.freeze({
        azimuth: -74 * DEG, r: 30, height: 52, girth: 7.2, seed: 29,
    }),
]);

/** Rows of a chimney per world unit of height, and facets round it. */
const CHIMNEY_ROW_STEP = 2.0;
const CHIMNEY_SIDES = 18;
/** How far under the lip a chimney's foot is buried. */
const CHIMNEY_FOOT = 12;
/** How high a plume rolls over its chimney's mouth before it has broken up. */
const PLUME_HEIGHT = 38;
const PLUME_ROWS = 16;
const PLUME_SIDES = 14;

/** Bubbles and sparks of life per quality tier. */
export const SEA_VENT_BUBBLES_BY_TIER = Object.freeze({ high: 760, medium: 420, low: 220 });
export const SEA_VENT_SPARKS_BY_TIER = Object.freeze({ high: 150, medium: 100, low: 60 });

const smooth01 = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/**
 * How much of the vent is there for a camera at `progress`: 0 from the lake and the low shaft, 1
 * through the crossing, 0 again before the chapter group leaves the scene (boundary + the 1->2
 * ecotone's half-width, 0.0222).
 *
 * In: with the steam, as it closes over the throat. From the low shaft the vent's mouth is a hole
 * in the rock overhead with the First Heart in it; the stacks beyond resolve out of the vapour as
 * the climb enters it (they are 90-140 u up in thick steam then: faint shapes), they are not seen
 * through clear air against the vault. Out: in the follow camera's view the chimneys have long
 * left the frame; this is for a free camera that looks back down, and the plumes' last shreds.
 * @param {number} progress camera progress
 * @param {number} boundary the 1->2 chapter boundary
 * @returns {number} 0..1
 */
export function seaVentPresence(progress, boundary) {
    if (!Number.isFinite(progress) || !Number.isFinite(boundary)) return 1;
    return smooth01((progress - (boundary - 0.0235)) / 0.005)
        * (1 - smooth01((progress - (boundary + 0.0150)) / 0.0065));
}

/**
 * How dark the water still is for the sparks of life (they are seen only in the dark): 1 in the
 * abyss at the vent, 0 where the ocean's own blue has taken over.
 * @param {number} progress camera progress
 * @param {number} boundary the 1->2 chapter boundary
 * @returns {number} 0..1
 */
export function seaVentDarkness(progress, boundary) {
    if (!Number.isFinite(progress) || !Number.isFinite(boundary)) return 1;
    return 1 - smooth01((progress - (boundary + 0.004)) / 0.0145);
}

const _rock = new ImprovedNoise();

/**
 * One chimney as rings round a leaning, wandering centreline: a flared foot of piled pillows, a
 * knobbly tapering stack with flanges (the shelves a smoker grows), a beehive swelling under the
 * mouth, and an open ragged rim with the mouth sunk inside it.
 * @returns {{ positions: number[], indices: number[], vent: number[], top: THREE.Vector3, mouthR: number }}
 */
function buildChimney(spec, plan, lipY, vertexOffset) {
    const random = basaltRandom(1009 + (spec.seed * 31));
    const d = plan.dirAt(spec.azimuth);
    const baseX = plan.axis.x + (d.x * spec.r);
    const baseZ = plan.axis.z + (d.z * spec.r);
    const y0 = lipY - CHIMNEY_FOOT;
    const total = spec.height + CHIMNEY_FOOT;
    const rows = Math.max(8, Math.round(total / CHIMNEY_ROW_STEP));
    const leanAz = random() * TAU;
    // A little toward the axis, so the stacks lean in over the vent as real ones lean on a mound.
    const leanX = (Math.cos(leanAz) * 0.6) - (d.x * 0.9);
    const leanZ = (Math.sin(leanAz) * 0.6) - (d.z * 0.9);
    const leanAmt = 2.5 + (random() * 4.5);
    const flanges = [0.34 + (random() * 0.1), 0.56 + (random() * 0.1), 0.76 + (random() * 0.08)];
    const flangeAmp = [0.34 + (random() * 0.3), 0.26 + (random() * 0.3), 0.2 + (random() * 0.25)];
    const positions = [];
    const vent = [];
    const indices = [];
    const seed = random();
    let top = null;
    let mouthR = 1;
    for (let j = 0; j <= rows; j += 1) {
        const f = j / rows;
        const y = y0 + (f * total);
        const sway = _rock.noise(spec.seed * 3.7, f * 2.6, 1.3) * 2.2;
        const cx = baseX + (leanX * leanAmt * (f ** 1.6)) + (sway * d.z);
        const cz = baseZ + (leanZ * leanAmt * (f ** 1.6)) - (sway * d.x);
        // Girth: a flared foot, a taper, a beehive under the mouth, flanges, and the rim.
        let girth = spec.girth * (0.40 + (0.60 * ((1 - f) ** 0.9)));
        girth *= 1 + (0.7 * (1 - smooth01(f / 0.2)));
        girth *= 1 + (0.34 * Math.exp(-(((f - 0.9) / 0.06) ** 2)));
        for (let k = 0; k < flanges.length; k += 1) {
            girth *= 1 + (flangeAmp[k] * Math.exp(-(((f - flanges[k]) / 0.014) ** 2)));
        }
        if (j === rows) mouthR = girth;
        for (let i = 0; i < CHIMNEY_SIDES; i += 1) {
            const a = (i / CHIMNEY_SIDES) * TAU;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const lumps = (_rock.noise((ca * 1.7) + spec.seed, y * 0.11, (sa * 1.7) - spec.seed) * 0.26)
                + (_rock.noise((ca * 4.3) + 9.1, y * 0.31, (sa * 4.3) + spec.seed) * 0.12);
            // The rim is broken: its last rows rise and fall round the mouth.
            const rim = f > 0.96 ? (_rock.noise(ca * 2.9, spec.seed * 1.3, sa * 2.9) * 2.4 * ((f - 0.96) / 0.04)) : 0;
            const r = girth * (1 + lumps);
            positions.push(cx + (ca * r), y + rim, cz + (sa * r));
            vent.push(f, seed, y - lipY, 0);
        }
        if (j === rows) top = new THREE.Vector3(cx, y, cz);
    }
    for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < CHIMNEY_SIDES; i += 1) {
            const a = vertexOffset + (j * CHIMNEY_SIDES) + i;
            const b = vertexOffset + (j * CHIMNEY_SIDES) + ((i + 1) % CHIMNEY_SIDES);
            const c = a + CHIMNEY_SIDES;
            const e = b + CHIMNEY_SIDES;
            indices.push(a, c, b, b, c, e);
        }
    }
    // The mouth: a disc sunk a little inside the rim, glowing (aVent.w = 1 at its heart).
    const ringStart = vertexOffset + (rows * CHIMNEY_SIDES);
    const centre = vertexOffset + (positions.length / 3);
    positions.push(top.x, top.y - 1.6, top.z);
    vent.push(1, seed, top.y - 1.6 - lipY, 1);
    for (let i = 0; i < CHIMNEY_SIDES; i += 1) {
        indices.push(ringStart + ((i + 1) % CHIMNEY_SIDES), ringStart + i, centre);
    }
    return {
        positions, indices, vent, top, mouthR,
    };
}

/**
 * Every chimney (each with a lesser stack or two at its shoulder) in one indexed geometry.
 * Attributes: position, normal, aVent = (fraction up the stack, seed, height over the lip, mouth).
 * @param {object} plan from planEarthCoreShaft
 * @returns {{ geometry: THREE.BufferGeometry, mouths: {top: THREE.Vector3, r: number, seed: number}[] }}
 */
export function buildSeaVentChimneys(plan) {
    const lipY = plan.lakeY + SHAFT.H_TOP;
    const positions = [];
    const vent = [];
    const indices = [];
    const mouths = [];
    const add = (spec, smokes) => {
        const part = buildChimney(spec, plan, lipY, positions.length / 3);
        part.positions.forEach((v) => positions.push(v));
        part.vent.forEach((v) => vent.push(v));
        part.indices.forEach((v) => indices.push(v));
        if (smokes) mouths.push({ top: part.top, r: part.mouthR, seed: (spec.seed * 0.137) % 1 });
    };
    SEA_VENT_CHIMNEYS.forEach((spec) => {
        add(spec, true);
        // The shoulder stacks: shorter, slimmer, a few units round the rim from the main one.
        const random = basaltRandom(77 + spec.seed);
        const count = 1 + (random() < 0.5 ? 1 : 0);
        for (let k = 0; k < count; k += 1) {
            const side = k === 0 ? 1 : -1;
            add({
                azimuth: spec.azimuth + (side * (9 + (random() * 7)) * DEG),
                r: spec.r + 2 + (random() * 6),
                height: spec.height * (0.34 + (random() * 0.24)),
                girth: spec.girth * (0.55 + (random() * 0.2)),
                seed: spec.seed + 100 + (k * 13),
            }, false);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aVent', new THREE.Float32BufferAttribute(vent, 4));
    geometry.setIndex(indices);
    // Wound to be seen from outside: the stacks' flanks face away from their own axes (the vent
    // test holds it).
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return { geometry, mouths };
}

/**
 * The plumes: one tube per smoking mouth, widening as it rises and bending a little with the
 * water. Attributes: position, normal (radial), aPlume = (fraction up the plume, seed, radius).
 * @param {{top: THREE.Vector3, r: number, seed: number}[]} mouths
 * @returns {THREE.BufferGeometry}
 */
export function buildSeaVentPlumes(mouths) {
    const positions = [];
    const normals = [];
    const plume = [];
    const indices = [];
    mouths.forEach((m, mi) => {
        const offset = positions.length / 3;
        const bendAz = (m.seed * 9.7) + (mi * 1.9);
        for (let j = 0; j <= PLUME_ROWS; j += 1) {
            const s = j / PLUME_ROWS;
            const y = m.top.y - 1.0 + (s * PLUME_HEIGHT);
            const bend = (s * s) * 7.0;
            const cx = m.top.x + (Math.cos(bendAz) * bend);
            const cz = m.top.z + (Math.sin(bendAz) * bend);
            const r = m.r * (0.5 + (1.35 * (s ** 0.8)));
            for (let i = 0; i < PLUME_SIDES; i += 1) {
                const a = (i / PLUME_SIDES) * TAU;
                positions.push(cx + (Math.cos(a) * r), y, cz + (Math.sin(a) * r));
                normals.push(Math.cos(a), 0.0, Math.sin(a));
                plume.push(s, m.seed, r);
            }
        }
        for (let j = 0; j < PLUME_ROWS; j += 1) {
            for (let i = 0; i < PLUME_SIDES; i += 1) {
                const a = offset + (j * PLUME_SIDES) + i;
                const b = offset + (j * PLUME_SIDES) + ((i + 1) % PLUME_SIDES);
                const c = a + PLUME_SIDES;
                const e = b + PLUME_SIDES;
                indices.push(a, c, b, b, c, e);
            }
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aPlume', new THREE.Float32BufferAttribute(plume, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
}

/** The eye's position in the chapter group's local frame. */
const cameraLocal = () => modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;

/**
 * What lies between the eye and a point: lit vapour while the eye is in the steam, the abyss's own
 * dark water once it is in the sea (`u.uAirColour`, `u.uAirK`, set by the chapter).
 */
function throughTheAir(u, colour, pointLocal) {
    const dist = length(cameraLocal().sub(pointLocal)).mul(u.uAirK);
    const reach = exp(dist.mul(dist).negate());
    return mix(u.uAirColour, colour, reach);
}

function createChimneyMaterial(u, lipY) {
    const n3 = earthCoreNoise01();
    const vP = varying(attribute('position', 'vec3'), 'vVentP');
    const vN = varying(normalLocal, 'vVentN');
    const vS = varying(attribute('aVent', 'vec4'), 'vVentS');
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
        const P = vP.toVar();
        const N = normalize(vN).toVar();
        const S = vS.toVar();
        const over = max(P.y.sub(lipY), 0.0).toVar();
        // Sulphide rock: black, with rusty and pale mineral stains in broad reaches, and a grit.
        const stain = n3(P.mul(0.07).add(vec3(S.y.mul(13.0), 0.0, 0.0))).toVar();
        const grain = n3(P.mul(1.9)).toVar();
        const rough = mix(float(0.7), float(1.3), grain).toVar();
        const rock = mix(vec3(0.006, 0.006, 0.008), vec3(0.020, 0.011, 0.006), smoothstep(0.45, 0.8, stain))
            .mul(rough);

        // THE KEY: the lava in the vent, below. What looks down at it catches it; the rest takes
        // a little of it wrapped round, falling away with height over the lip.
        const down = clamp(N.y.negate(), 0.0, 1.0);
        const wrap = clamp(N.y.mul(-0.5).add(0.5), 0.0, 1.0);
        const reach = exp(over.div(-17.0)).add(exp(over.div(-70.0)).mul(0.10)).toVar();
        const breath = sin(u.uTime.mul(0.37)).mul(0.10).add(0.90).add(u.uVentPulse.mul(0.35));
        const lavaLight = vec3(1.0, 0.34, 0.075)
            .mul(pow(down, 2.0).mul(1.1).add(wrap.mul(wrap).mul(0.10)))
            .mul(reach).mul(breath)
            .mul(rough);

        // FISSURES THAT CRUST OVER AND SPLIT AGAIN. Veins run up the stack (the field is stretched
        // along it); a slow field wandering through the rock opens them here and seals them there,
        // so a reach of glowing cracks dims to a dark seam and another splits open beside it.
        const crackP = vec3(P.x, P.y.mul(0.38), P.z).mul(0.19);
        const veins = ridged3(crackP, 3, n3).div(0.875).toVar();
        const tide = n3(P.mul(0.045).add(vec3(S.y.mul(7.0), u.uTime.mul(-0.022), u.uTime.mul(0.017)))).toVar();
        const open = smoothstep(0.40, 0.66, tide.add(u.uVentPulse.mul(0.12))).toVar();
        const core = smoothstep(mix(float(0.94), float(0.83), open), 0.975, veins);
        const halo = smoothstep(0.66, 0.93, veins).mul(open);
        const heat = exp(over.div(-48.0)).mul(0.8).add(0.30).add(smoothstep(0.86, 1.0, S.x).mul(0.4));
        const crack = vec3(1.0, 0.50, 0.13).mul(core).mul(2.2)
            .add(vec3(0.85, 0.17, 0.035).mul(halo).mul(0.34))
            .mul(heat)
            .mul(mix(float(0.22), float(1.0), open));

        // The mouth breathes ember light, and the rim under it catches it.
        const mouth = vec3(1.0, 0.40, 0.09).mul(S.w).mul(sin(u.uTime.mul(1.3).add(S.y.mul(40.0))).mul(0.12).add(0.88));

        // The sea's own light, from above: a cold edge on what turns away, so a stack that the
        // lava does not reach still has a silhouette against the dark water.
        const view = normalize(cameraLocal().sub(P));
        const rim = pow(oneMinus(clamp(abs(dot(N, view)), 0.0, 1.0)), 3.0);
        const sea = vec3(0.020, 0.058, 0.090).mul(rim.mul(0.9).add(clamp(N.y, 0.0, 1.0).mul(0.25))).mul(u.uSea);

        const lit = rock.mul(0.5).add(lavaLight).add(crack).add(mouth)
            .add(sea);
        return throughTheAir(u, min(lit, vec3(1.3, 1.05, 0.8)), P);
    })();
    material.opacityNode = u.uPresence;
    // Drawn after the steam's shell, in front of it (the shell is a backdrop 110 u out); it
    // writes depth so the smoke and the bubbles sort against it.
    material.transparent = true;
    material.depthWrite = true;
    // Not there at all while its presence is zero (a transparent fragment still writes depth).
    material.alphaTest = 0.004;
    material.side = THREE.FrontSide;
    material.fog = false;
    material.userData.emitsBloom = true;
    return material;
}

function createPlumeMaterial(u) {
    const aPl = attribute('aPlume', 'vec3');
    const s = aPl.x;
    // ROLLING: the billows travel up the plume (the noise is read in a frame that sinks with
    // time), bigger and slower as the plume widens.
    const roll = vec3(0.0, u.uTime.mul(-2.6), 0.0);
    const posG = attribute('position', 'vec3');
    const nP = posG.add(roll).mul(0.085).add(vec3(aPl.y.mul(31.0), 0.0, aPl.y.mul(17.0)));
    const lump = noise3(nP).mul(0.62).add(noise3(nP.mul(2.3)).mul(0.38));
    const swell = lump.sub(0.42).mul(aPl.z).mul(1.5);
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionLocal.add(attribute('normal', 'vec3').mul(swell));

    const vP = varying(posG, 'vPlumeP');
    const vN = varying(attribute('normal', 'vec3'), 'vPlumeN');
    const vS = varying(vec3(s, aPl.y, lump), 'vPlumeS');
    const view = normalize(cameraLocal().sub(vP));
    const facing = abs(dot(normalize(vN), view));
    const fP = vP.add(roll).mul(0.085).add(vec3(vS.y.mul(31.0), 0.0, vS.y.mul(17.0)));
    // The light is below: a billow's underside is where the smoke thickens as you go up.
    const here = noise3(fP).mul(0.62).add(noise3(fP.mul(2.3)).mul(0.38));
    const above = noise3(fP.add(vec3(0.0, 0.16, 0.0))).mul(0.62)
        .add(noise3(fP.add(vec3(0.0, 0.16, 0.0)).mul(2.3)).mul(0.38));
    const under = clamp(above.sub(here).mul(5.5).add(0.32), 0.0, 1.0);
    const fine = noise3(fP.mul(5.1).add(vec3(0.0, u.uTime.mul(-0.5), 0.0)));
    material.colorNode = Fn(() => {
        const along = clamp(vS.x, 0.0, 1.0);
        const soot = vec3(0.006, 0.007, 0.010).mul(here.mul(0.8).add(0.6));
        // Ember light on the undersides, strongest over the mouth, gone a third of the way up.
        // (Soot against blue-black water is a shape only where the vent lights it: capture p 0.065
        // with the light gone a fifth of the way up showed no plumes at all.)
        const emberReach = exp(along.mul(-4.5)).mul(0.5).add(exp(along.mul(-18.0)).mul(0.9));
        const lava = vec3(1.0, 0.30, 0.06).mul(under.mul(under)).mul(emberReach)
            .mul(u.uVentPulse.mul(0.4).add(0.85));
        // Thin smoke lets the sea's own dim light through at its edges.
        const thin = oneMinus(smoothstep(0.15, 0.7, facing));
        const sea = vec3(0.022, 0.060, 0.094).mul(thin).mul(u.uSea);
        return throughTheAir(u, soot.add(lava).add(sea), vP);
    })();
    material.opacityNode = Fn(() => {
        const along = clamp(vS.x, 0.0, 1.0);
        // A soft silhouette, eaten into shreds toward the top.
        const edge = smoothstep(0.04, 0.5, facing);
        const eaten = smoothstep(
            along.mul(0.70).sub(0.06),
            along.mul(0.70).add(0.22),
            here.add(fine.sub(0.5).mul(0.32)),
        );
        const foot = smoothstep(0.0, 0.05, along);
        const head = oneMinus(smoothstep(0.55, 1.0, along));
        return edge.mul(eaten).mul(foot).mul(head).mul(0.8)
            .mul(u.uPresence)
            .mul(u.uSmoke);
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.FrontSide;
    material.fog = false;
    return material;
}

/**
 * Bubbles and sparks of life: one instanced draw of view-facing quads.
 *   aA = (x, z, r1, r2), aB = (r3 | y, r4, kind, size); kind 0 = bubble, 1 = spark.
 */
function createVentParticles(u, plan, lipY, bubbleCount, sparkCount, mouths) {
    const count = bubbleCount + sparkCount;
    const aA = new Float32Array(count * 4);
    const aB = new Float32Array(count * 4);
    const random = basaltRandom(4409);
    // Where the gas comes up: round the vent's throat, and beside each smoking mouth.
    const columns = [];
    for (let k = 0; k < 7; k += 1) {
        const az = ((k / 7) * TAU) + (random() * 0.5);
        const r = 7 + (random() * 13);
        const d = plan.dirAt(az);
        columns.push({ x: plan.axis.x + (d.x * r), z: plan.axis.z + (d.z * r), spread: 1.6 + (random() * 2.4) });
    }
    mouths.forEach((m) => {
        const toAxisX = plan.axis.x - m.top.x;
        const toAxisZ = plan.axis.z - m.top.z;
        const len = Math.hypot(toAxisX, toAxisZ) || 1;
        columns.push({
            x: m.top.x + ((toAxisX / len) * 9), z: m.top.z + ((toAxisZ / len) * 9), spread: 2.2 + (random() * 2.0),
        });
    });
    for (let i = 0; i < bubbleCount; i += 1) {
        const col = columns[i % columns.length];
        const a = random() * TAU;
        const rr = Math.sqrt(random()) * col.spread;
        aA.set([col.x + (Math.cos(a) * rr), col.z + (Math.sin(a) * rr), random(), random()], i * 4);
        const big = random();
        aB.set([random(), random(), 0, 0.10 + (0.5 * big * big * big)], i * 4);
    }
    for (let i = bubbleCount; i < count; i += 1) {
        // The sparks of life: a wide loose shell round and over the vent, out past the chimneys.
        const a = random() * TAU;
        const rr = 20 + ((random() ** 0.7) * 95);
        const d = plan.dirAt(a);
        aA.set([plan.axis.x + (d.x * rr), plan.axis.z + (d.z * rr), random(), random()], i * 4);
        aB.set([lipY + 26 + (random() * 150) + (rr * 0.35), random(), 1, 0.5 + (0.9 * random())], i * 4);
    }
    const geometry = makeQuadInstancedGeometry(count, {
        aA: { array: aA, itemSize: 4 },
        aB: { array: aB, itemSize: 4 },
    });

    const A = attribute('aA', 'vec4');
    const B = attribute('aB', 'vec4');
    const kind = B.z;
    const yLo = lipY - 8;
    const span = 104;
    // BUBBLES: each rises on the banked gas clock (it runs faster in a pulse of the vent), bigger
    // ones faster, wobbling on a helix, the column widening as it climbs.
    const speed = B.w.mul(26.0).add(7.0);
    const phase = fract(u.uGasPhase.mul(speed).div(span).add(A.w.mul(17.0)));
    const rise = phase.mul(span);
    const angle = u.uTime.mul(B.y.mul(2.6).add(1.6)).add(A.z.mul(TAU)).add(rise.mul(0.19));
    const wobble = B.x.mul(0.8).add(0.25).add(phase.mul(1.6));
    const bubbleCentre = vec3(
        A.x.add(cos(angle).mul(wobble)).add(A.z.sub(0.5).mul(phase).mul(9.0)),
        float(yLo).add(rise),
        A.y.add(sin(angle).mul(wobble)).add(B.y.sub(0.5).mul(phase).mul(9.0)),
    );
    // SPARKS: a slow drift round their own place.
    const driftT = u.uTime.mul(A.z.mul(0.10).add(0.05)).add(A.w.mul(TAU));
    const sparkCentre = vec3(
        A.x.add(sin(driftT).mul(4.0)),
        B.x.add(sin(driftT.mul(0.7).add(1.3)).mul(3.0)),
        A.y.add(cos(driftT.mul(0.83)).mul(4.0)),
    );
    const centre = mix(bubbleCentre, sparkCentre, kind);
    const toEye = cameraLocal().sub(centre);
    const dist = length(toEye);
    // A bubble swells a little as it rises; a spark keeps its size on screen out to a distance.
    const size = mix(
        B.w.mul(phase.mul(0.7).add(0.8)).mul(u.uVentPulse.mul(0.3).add(1.0)),
        B.w.mul(clamp(dist.div(60.0), 0.6, 2.2)),
        kind,
    );
    const corner = positionLocal.xy;
    const material = new THREE.MeshBasicNodeMaterial();
    // Faced to the camera's own right and up (set by the chapter each frame): a quad built from
    // the world's up collapses straight overhead, which is where these are.
    material.positionNode = centre
        .add(u.uCamRight.mul(corner.x.mul(size)))
        .add(u.uCamUp.mul(corner.y.mul(size)));

    // Per instance, to the fragment: (kind, how much of it shows, how much the lava lights it).
    const overLip = max(bubbleCentre.y.sub(lipY), 0.0);
    // Bubbles: there from just under the lip, thinning out toward the top of their rise, and not
    // drawn at the lens (a quad a metre from the eye is a disc across the frame).
    const bubbleFade = smoothstep(0.0, 0.06, phase).mul(oneMinus(smoothstep(0.55, 1.0, phase)))
        .mul(smoothstep(1.6, 6.0, dist));
    // Sparks: only in dark water, only where the view is the sea (not across the lit steam).
    const viewR = length(toEye.xz).div(max(dist, 1e-3));
    const inSea = oneMinus(smoothstep(u.uEyeR.sub(0.06), u.uEyeR.add(0.02), viewR));
    const twinkle = sin(u.uTime.mul(A.z.mul(0.9).add(0.35)).add(A.w.mul(40.0))).mul(0.5).add(0.5);
    const sparkFade = inSea.mul(u.uDark).mul(twinkle.mul(twinkle).mul(0.85).add(0.15))
        .mul(smoothstep(8.0, 24.0, dist));
    const lavaLit = exp(overLip.div(-30.0));
    const vK = varying(vec3(kind, mix(bubbleFade, sparkFade, kind), lavaLit), 'vVentK');
    const vTint = varying(mix(
        mix(vec3(0.62, 0.86, 1.0), vec3(1.0, 0.46, 0.13), lavaLit),
        mix(vec3(0.05, 0.85, 0.62), vec3(0.10, 0.50, 1.0), A.z),
        kind,
    ), 'vVentTint');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r = length(q);
        // A bubble seen from below: a bright rim, a faint body, a glint off-centre.
        const ring = smoothstep(0.58, 0.82, r).mul(oneMinus(smoothstep(0.86, 1.0, r)));
        const body = oneMinus(smoothstep(0.0, 0.9, r)).mul(0.10);
        const glint = oneMinus(smoothstep(0.0, 0.22, length(q.sub(vec2(-0.32, 0.36)))));
        const bubble = ring.mul(0.85).add(body).add(glint.mul(0.9));
        // A spark of life: a soft glow with a small heart (a living light, not a star).
        const soft = clamp(oneMinus(r), 0.0, 1.0);
        const spark = soft.mul(soft).mul(0.30).add(pow(soft, 5.0).mul(0.55));
        const shape = mix(bubble, spark, vK.x);
        return vTint.mul(shape).mul(vK.y).mul(u.uPresence).mul(mix(float(0.75), float(1.0), vK.x));
    })();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.fog = false;
    material.userData.emitsBloom = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sea-vent-bubbles';
    mesh.frustumCulled = false;
    return mesh;
}

/**
 * Build the vent.
 * @param {object} chapterUniforms the chapter's uniforms (uTime)
 * @param {object} plan from planEarthCoreShaft
 * @param {object} [options] the chapter's create() options (qualityTier)
 * @returns {THREE.Group} with `userData.seaVent` (its uniforms and state, for updateSeaVent)
 */
export function createSeaVent(chapterUniforms, plan, options = {}) {
    const lipY = plan.lakeY + SHAFT.H_TOP;
    const u = {
        uTime: chapterUniforms.uTime,
        // The gas's rise clock, banked on the CPU (never time x a changing rate).
        uGasPhase: uniform(0),
        uVentPulse: uniform(0),
        uCamRight: chapterUniforms.uCamRight ?? uniform(new THREE.Vector3(1, 0, 0)),
        uCamUp: chapterUniforms.uCamUp ?? uniform(new THREE.Vector3(0, 0, 1)),
        uAirColour: uniform(new THREE.Color(0.2, 0.06, 0.015)),
        uAirK: uniform(0.004),
        // 0 while the eye is in the steam, 1 once it is in the sea.
        uSea: uniform(0),
        // Not there until the chapter drives it (updateSeaVent).
        uPresence: uniform(0),
        uSmoke: uniform(1),
        uDark: uniform(1),
        uEyeR: uniform(-0.2),
    };
    const group = new THREE.Group();
    group.name = 'earth-core-sea-vent';
    // The chapter drives this group's own handoff (seaVentPresence): never forced transparent or
    // crossfaded by the manager.
    group.userData.odysseyFadeExempt = true;

    const { geometry: chimneyGeometry, mouths } = buildSeaVentChimneys(plan);
    const chimneys = new THREE.Mesh(chimneyGeometry, createChimneyMaterial(u, lipY));
    chimneys.name = 'sea-vent-chimneys';
    chimneys.frustumCulled = false;
    chimneys.renderOrder = EARTH_CORE_THROUGH_STEAM_ORDER;
    group.add(chimneys);

    const plumes = new THREE.Mesh(buildSeaVentPlumes(mouths), createPlumeMaterial(u));
    plumes.name = 'sea-vent-plumes';
    plumes.frustumCulled = false;
    plumes.renderOrder = EARTH_CORE_THROUGH_STEAM_ORDER + 1;
    group.add(plumes);

    const bubbles = createVentParticles(
        u,
        plan,
        lipY,
        pickByQualityTier(options, SEA_VENT_BUBBLES_BY_TIER),
        pickByQualityTier(options, SEA_VENT_SPARKS_BY_TIER),
        mouths,
    );
    bubbles.renderOrder = EARTH_CORE_THROUGH_STEAM_ORDER + 2;
    group.add(bubbles);

    group.userData.seaVent = {
        uniforms: u, lipY, mouths, chimneys, plumes, bubbles,
    };
    return group;
}

const _steamAir = new THREE.Color(0.085, 0.022, 0.006);
const _seaAir = new THREE.Color(0.0045, 0.012, 0.022);

/**
 * Drive the vent for this frame.
 * @param {THREE.Group} group from createSeaVent
 * @param {object} state
 * @param {number} state.delta seconds
 * @param {THREE.Camera|null} state.camera
 * @param {number|null} state.progress camera progress
 * @param {number} state.boundary the 1->2 chapter boundary
 * @param {number} state.veil the steam's fog weight at the eye (0..1)
 * @param {number} state.eyeRadius the sea's eye (steamQuenchEyeRadius)
 * @param {number} state.pulse the vent's pulse on the chapter clock (0..1)
 * @param {boolean} [state.reducedMotion]
 */
export function updateSeaVent(group, {
    delta = 0, camera = null, progress = null, boundary = 0.0649, veil = 0, eyeRadius = -0.2, pulse = 0,
    reducedMotion = false,
} = {}) {
    const vent = group?.userData?.seaVent;
    if (!vent) return;
    const u = vent.uniforms;
    const dt = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 0.1);
    const beat = reducedMotion ? 0 : Math.min(1, Math.max(0, pulse));
    u.uVentPulse.value = beat;
    u.uGasPhase.value += dt * (reducedMotion ? 0.45 : 1 + (1.1 * beat));
    if (camera?.matrixWorld) {
        const e = camera.matrixWorld.elements;
        u.uCamRight.value.set(e[0], e[1], e[2]);
        u.uCamUp.value.set(e[4], e[5], e[6]);
    }
    const p = Number.isFinite(progress) ? progress : 0;
    // The eye is in the sea from the boundary (it passes the vent's lip there).
    const sea = smooth01((p - (boundary - 0.004)) / 0.008);
    u.uSea.value = sea;
    // What lies between the eye and the vent: lit vapour in the steam (thick: a chimney 80 u up
    // is a shape in it), dark water in the sea (clearer: the stacks stand out of it).
    u.uAirColour.value.copy(_steamAir).lerp(_seaAir, sea);
    u.uAirK.value = THREE.MathUtils.lerp(0.003 + (0.005 * Math.min(1, veil)), 0.0075, sea);
    u.uPresence.value = seaVentPresence(p, boundary);
    // The plumes thin out before the stacks do: smoke spreading into the water as the eye climbs.
    u.uSmoke.value = 1 - smooth01((p - (boundary + 0.004)) / 0.0115);
    u.uDark.value = seaVentDarkness(p, boundary);
    u.uEyeR.value = eyeRadius;
}
