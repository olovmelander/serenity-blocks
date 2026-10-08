/**
 * Halcyon Apex — the crystals.
 *
 * Every crystal in the sanctuary is the same cut, a six-sided bipyramid, drawn as one instanced
 * mesh: the ley shards along the causeway, the Apex over the pyramid, the Halcyon before the
 * sun, the stones' crystals round the dial, the obelisks' and the splinters that circle the two
 * great ones. None of them stands on anything: they float, and a chain of clears lifts them.
 *
 * A crystal is shaded as a cut stone without a framebuffer read: each facet mirrors the sky by
 * its own Fresnel; behind the mirror lies the sky along the refracted ray, broken into wedges by
 * the far facets, with the sun refracted once per colour channel so its image splits when a
 * crystal stands before it; the light it holds glows from its core; every arris is lit.
 *
 * Where each crystal is (and how it turns) is a function of the world's clocks, evaluated on the
 * CPU once a frame for a few dozen instances and shared by the crystals and their halos.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
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
    normalize,
    positionGeometry,
    reflect,
    refract,
    sin,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    LEY_A,
    LEY_B,
    LIFT_MAX,
    SITE,
    TAU,
    clamp01,
    haAtmosphere,
    haClearLight,
    haFresnel,
    haFxMaterial,
    haPart,
    haPulseLight,
    haSkyBase,
    smooth,
} from './halcyon-apex-tsl.js';
import { GEM } from './halcyon-apex-plan.js';

const SIDES = 6;
/** The unit cut: girdle at y = 0 (radius 1), apexes at y = ±1. */
function cutGeometry(count) {
    const positions = [];
    const facets = [];
    const bary = [];
    const corner = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let i = 0; i < SIDES; i++) {
        const a0 = (i / SIDES) * TAU;
        const a1 = ((i + 1) / SIDES) * TAU;
        const mid = (a0 + a1) / 2;
        const g0 = [Math.cos(a0), 0, Math.sin(a0)];
        const g1 = [Math.cos(a1), 0, Math.sin(a1)];
        [[g0, [0, 1, 0], g1, 1], [g0, g1, [0, -1, 0], -1]].forEach(([p, q, r, sign]) => {
            [p, q, r].forEach((v, k) => {
                positions.push(v[0], v[1], v[2]);
                facets.push(Math.cos(mid), Math.sin(mid), sign);
                bary.push(...corner[k]);
            });
        });
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aFacet', new THREE.Float32BufferAttribute(facets, 3));
    geometry.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
    geometry.instanceCount = count;
    return geometry;
}

/** How brightly a crystal of each kind burns at rest, and how much the Halcyon's sun shows through. */
const KIND_GLOW = {
    [GEM.shard]: 0.9, [GEM.apex]: 1.5, [GEM.halcyon]: 0.5, [GEM.dial]: 0.8, [GEM.obelisk]: 0.9, [GEM.apexOrbit]: 0.7, [GEM.halcyonOrbit]: 0.5,
};
/** Where the girdle sits between the apexes (−1 … 1): shards are points, the Halcyon a plumb. */
const KIND_WAIST = {
    [GEM.shard]: -0.42, [GEM.apex]: -0.08, [GEM.halcyon]: 0.24, [GEM.dial]: -0.2, [GEM.obelisk]: -0.1, [GEM.apexOrbit]: 0, [GEM.halcyonOrbit]: 0.1,
};

/**
 * @param {object} u     shared sanctuary uniforms
 * @param {object} plan
 * @param {object} [opts]
 * @param {boolean} [opts.dispersion=true]  the sun's refracted image splits per colour channel
 */
export function createCrystals(u, plan, opts = {}) {
    const dispersion = opts.dispersion !== false;
    const { gems } = plan;
    const count = gems.length;
    const aPos = new Float32Array(count * 4);
    const aShape = new Float32Array(count * 4);
    const aLey = new Float32Array(count * 4);
    gems.forEach((g, i) => {
        aShape.set([g.half, g.girth, KIND_WAIST[g.kind], g.hash], i * 4);
        aLey.set([g.s, g.line, g.kind, KIND_GLOW[g.kind]], i * 4);
    });
    const posAttr = new THREE.InstancedBufferAttribute(aPos, 4);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const shapeAttr = new THREE.InstancedBufferAttribute(aShape, 4);
    const leyAttr = new THREE.InstancedBufferAttribute(aLey, 4);
    const geometry = cutGeometry(count);
    geometry.setAttribute('aPos', posAttr);
    geometry.setAttribute('aShape', shapeAttr);
    geometry.setAttribute('aLey', leyAttr);

    const pos = attribute('aPos', 'vec4');
    const shape = attribute('aShape', 'vec4');
    const ley = attribute('aLey', 'vec4');
    const facet = attribute('aFacet', 'vec3');

    // ── Where a vertex is, and which way its facet looks ──
    const half = shape.x;
    const girth = shape.y;
    const waist = shape.z;
    const cy = cos(pos.w);
    const sy = sin(pos.w);
    const turn = (v) => vec3(v.x.mul(cy).add(v.z.mul(sy)), v.y, v.z.mul(cy).sub(v.x.mul(sy)));
    const localY = positionGeometry.y.mul(half).add(float(1.0).sub(abs(positionGeometry.y)).mul(waist).mul(half));
    const local = vec3(positionGeometry.x.mul(girth), localY, positionGeometry.z.mul(girth));
    const world = turn(local).add(pos.xyz);
    const span = half.mul(float(1.0).sub(waist.mul(facet.z)));
    const apothem = girth.mul(Math.cos(Math.PI / SIDES));
    const facetNormal = normalize(turn(vec3(facet.x.mul(span), apothem.mul(facet.z), facet.y.mul(span))));

    const vNormal = varying(facetNormal, 'haGemN');
    const vWorld = varying(world, 'haGemP');
    const vBary = varying(attribute('aBary', 'vec3'), 'haGemB');
    const vLey = varying(ley, 'haGemL');
    // (centre, how far from the girdle toward an apex 0..1)
    const vCore = varying(vec4(pos.xyz, abs(positionGeometry.y)), 'haGemC');
    const vHash = varying(shape.w, 'haGemH');

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'HalcyonApexCrystals';
    material.fog = false;
    material.positionNode = world;

    /** The light a crystal holds and the pulses running through it: vec4(colour, amount). */
    const innerLight = (kind, s, line) => {
        const isApex = float(1.0).sub(abs(kind.sub(GEM.apex)).clamp(0.0, 1.0));
        const isHalcyon = float(1.0).sub(abs(kind.sub(GEM.halcyon)).clamp(0.0, 1.0));
        const pulse = haPulseLight(u, line, s).mul(u.pulsesLive);
        const held = u.heldA.mul(u.held.x).mul(isApex).add(u.heldB.mul(u.held.y).mul(isHalcyon));
        return vec4(pulse.rgb.mul(3.2).add(held.mul(0.55)), pulse.w);
    };

    material.fragmentNode = Fn(() => {
        const p = vWorld;
        const N = normalize(vNormal).toVar();
        const V = normalize(p.sub(cameraPosition)).toVar();
        const kind = vLey.z.add(0.5).floor();
        const cosNV = clamp(dot(V, N).negate(), 0.0, 1.0).toVar();
        const fres = haFresnel(cosNV, 0.07).toVar();

        // ── The mirror: sky above, lagoon below ──
        const R = reflect(V, N).toVar();
        const below = smoothstep(-0.25, 0.02, R.y.negate());
        const mirror = mix(haSkyBase(u, vec3(R.x, abs(R.y), R.z)), u.shallow.mul(0.42), below.mul(0.55)).toVar();
        const rs = max(dot(R, u.sunDir), 0.0);
        const rs8 = rs.mul(rs).mul(rs).mul(rs).mul(rs)
            .mul(rs)
            .mul(rs)
            .mul(rs);
        const glint = u.sun.mul(rs8.mul(rs8).mul(rs8).mul(rs8)).mul(u.sunLit).mul(5.0);

        // ── Behind the mirror: the sky along the refracted ray, cut into wedges by the far facets ──
        const T = refract(V, N, float(1 / 1.46)).toVar();
        const edge = min(vBary.x, min(vBary.y, vBary.z)).toVar();
        const wedge = fract(dot(T, vec3(2.3, 1.7, 2.9)).add(vHash.mul(7.0)).add(vBary.x.mul(1.6)).add(vBary.y.mul(0.7)));
        const facetTone = mix(float(0.42), float(1.25), smoothstep(0.42, 0.5, wedge).mul(float(1.0).sub(smoothstep(0.86, 0.94, wedge))));
        const through = haSkyBase(u, vec3(T.x, abs(T.y).mul(0.6).add(0.08), T.z));
        const body = u.crystal.mul(0.72).add(0.05);
        const inside = through.mul(body).mul(facetTone).toVar();
        // The sun seen through the stone: once per colour channel, so its image splits.
        const sunThrough = vec3(0.0).toVar();
        const lobe = (ior) => {
            const t = refract(V, N, float(1 / ior));
            const c = max(dot(t, u.sunDir), 0.0);
            const c4 = c.mul(c).mul(c).mul(c);
            const c16 = c4.mul(c4).mul(c4).mul(c4);
            return c16.mul(c16).mul(c16).mul(c16).mul(c16)
                .mul(c16);
        };
        if (dispersion) sunThrough.assign(vec3(lobe(1.38), lobe(1.46), lobe(1.56)));
        else sunThrough.assign(vec3(lobe(1.46)));
        inside.addAssign(u.sun.mul(sunThrough).mul(mix(body, vec3(1.0), 0.35)).mul(u.sunLit.mul(0.8).add(0.2)).mul(facetTone.mul(0.5).add(0.5))
            .mul(0.62));

        // ── The light it holds: brightest in the core, where the stone is thickest ──
        const light = innerLight(kind, vLey.x, vLey.y);
        const thick = clamp(float(1.0).sub(vCore.w), 0.0, 1.0).mul(cosNV.mul(0.6).add(0.4));
        const breathe = sin(u.time.mul(0.9).add(vHash.mul(40.0))).mul(0.14).add(0.86);
        const lifted = clamp(u.lift.mul(0.11), 0.0, 1.0);
        const idle = vLey.w.mul(breathe).mul(u.power.mul(1.5).add(lifted).add(1.0)).mul(u.breath);
        const glow = u.crystal.mul(idle).mul(thick.mul(0.9).add(0.12)).add(u.ley.mul(light.w).mul(1.3).mul(thick.add(0.2)))
            .add(light.rgb.mul(thick.add(0.25)));

        // ── Every arris catches the light ──
        const arris = float(1.0).sub(smoothstep(0.0, 0.055, edge));
        const edgeLight = haSkyBase(u, normalize(vec3(N.x, abs(N.y).add(0.3), N.z))).mul(0.8).add(u.crystal.mul(idle.mul(0.5)))
            .mul(arris);

        const wave = haClearLight(u, p).mul(u.clearLive);
        const col = mix(inside, mirror.add(glint), fres).add(glow).add(edgeLight)
            .add(wave.rgb.mul(thick.add(0.35)).mul(1.3));
        return vec4(haAtmosphere(u, col, p), 1.0);
    })();

    const part = haPart('HalcyonApexCrystals', geometry, material, -36);
    part.mesh.castShadow = true;

    // ── Halos: the air round each crystal, lit by it ──
    const haloGeometry = new THREE.InstancedBufferGeometry();
    haloGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    haloGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    haloGeometry.setAttribute('aPos', posAttr);
    haloGeometry.setAttribute('aShape', shapeAttr);
    haloGeometry.setAttribute('aLey', leyAttr);
    haloGeometry.instanceCount = count;
    const haloMaterial = haFxMaterial('HalcyonApexHalos');
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(pos.xyz, 1.0));
    const reachM = half.mul(1.7).add(girth.mul(1.6));
    const px = reachM.mul(u.viewport.y.mul(1.05)).div(max(clip.w, 0.5));
    haloMaterial.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)), clip.z, clip.w);
    const haloKind = ley.z.add(0.5).floor();
    const haloLight = innerLight(haloKind, ley.x, ley.y);
    const haloIdle = ley.w.mul(u.power.mul(1.6).add(clamp(u.lift.mul(0.11), 0.0, 1.0)).add(1.0)).mul(u.breath);
    const vHalo = varying(u.crystal.mul(haloIdle.mul(0.065)).add(u.ley.mul(haloLight.w).mul(0.3)).add(haloLight.rgb.mul(0.34)), 'haHaloC');
    haloMaterial.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q.mul(vec2(1.0, 0.72)));
        const soft = exp(d.mul(d).mul(-5.5)).mul(float(1.0).sub(smoothstep(0.7, 1.0, d)));
        return vec4(vHalo.mul(soft), 0.0);
    })();
    const halos = haPart('HalcyonApexHalos', haloGeometry, haloMaterial, 20);

    // ── Where each crystal is this frame ──
    const state = new Array(count);
    for (let i = 0; i < count; i++) state[i] = [0, 0, 0];
    /** How far each crystal has turned while lifted (radians): integrated, so it never jumps. */
    const turned = new Float32Array(count);
    const liftOf = (index, lift, stride) => smooth(0, 1, clamp01(lift * stride - index));
    /**
     * @param {object} f  { time, delta, lift, spin, halcyon:[x,y,z], dialYaw, calm }
     */
    part.place = (f) => {
        const {
            time, delta = 0, lift, spin, halcyon, dialYaw, calm = 1,
        } = f;
        const cd = Math.cos(dialYaw);
        const sd = Math.sin(dialYaw);
        const { apex } = plan;
        const apexBob = Math.sin(time * 0.31) * 0.8 * calm + lift * 0.3;
        const halcyonBob = Math.sin(time * 0.23 + 1.1) * 1.1 * calm + lift * 0.22;
        for (let i = 0; i < count; i++) {
            const g = gems[i];
            let { x } = g;
            let { y } = g;
            let { z } = g;
            let { yaw } = g;
            const wob = Math.sin(time * (0.7 + g.hash * 0.5) + g.hash * 40) * calm;
            if (g.kind === GEM.shard) {
                const a = liftOf(g.index, lift, 1.4);
                y += wob * 0.07 + a * (1.5 + 0.3 * (lift / LIFT_MAX) + wob * 0.22);
                turned[i] += a * delta * 0.9 * calm;
                yaw += spin * (0.5 + g.hash * 0.5) + turned[i];
            } else if (g.kind === GEM.apex) {
                y += apexBob;
                yaw += spin * 0.22;
            } else if (g.kind === GEM.halcyon) {
                [x, y, z] = halcyon;
                y += halcyonBob;
                yaw += spin * 0.16;
            } else if (g.kind === GEM.dial) {
                const a = liftOf(g.index, lift, 0.55);
                const lx = g.x * cd + g.z * sd;
                const lz = g.z * cd - g.x * sd;
                x = halcyon[0] + lx;
                z = halcyon[2] + lz;
                y += wob * 0.1 + a * (2.2 + wob * 0.3);
                turned[i] += a * delta * 0.7 * calm;
                yaw += spin * (0.6 + g.hash * 0.4) + turned[i];
            } else if (g.kind === GEM.obelisk) {
                const a = liftOf(4 + g.index * 0.5, lift, 1);
                y += wob * 0.16 + a * 2.6;
                yaw += spin * 0.5;
            } else {
                // A splinter in orbit round one of the great crystals.
                const round = g.kind === GEM.apexOrbit;
                const cx = round ? apex[0] : halcyon[0];
                const cyy = round ? apex[1] + apexBob : halcyon[1] + halcyonBob;
                const cz = round ? apex[2] : halcyon[2];
                const angle = g.z + spin * (0.35 + g.hash * 0.5) * (g.index % 2 ? 1 : -0.7);
                const radius = g.x * (1 + (lift / LIFT_MAX) * 0.45);
                x = cx + Math.cos(angle) * radius;
                z = cz + Math.sin(angle) * radius;
                y = cyy + g.y * (1 + (lift / LIFT_MAX) * 0.35) + wob * 0.5;
                yaw += spin * (1.2 + g.hash * 2);
            }
            aPos.set([x, y, z, yaw], i * 4);
            state[i][0] = x;
            state[i][1] = y;
            state[i][2] = z;
        }
        posAttr.needsUpdate = true;
    };
    /** Forget what the lifted crystals have turned (a seek, a new run). */
    part.reset = () => {
        turned.fill(0);
    };
    /** World position of crystal `i` as of the last `place`. */
    part.positionOf = (i) => state[i];
    part.count = count;
    part.gems = gems;
    part.lineLength = (line) => (line === 0 ? LEY_A.length : LEY_B.length);
    part.site = SITE;
    return { crystals: part, halos };
}
