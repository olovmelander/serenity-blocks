/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE REEF'S MATERIALS (Odyssey masterpiece pass, 2026-11-17): the island's underwater flank
 * (odyssey-ocean-reef.js) drawn in the world's own water.
 *
 * Two static meshes, two draws: the rock with its coral (flat-shaded, coloured per vertex) and
 * the kelp (ribbons that sway in the vertex stage). Both are shaded the way the sea's other
 * forms are: the surface is the only lamp, the water's own haze layers them into plates
 * (`haze`, the renderer's `applyAerial` with the 1->2 life fade), and the depth arc
 * (odyssey-ocean-depth.js) says what the light does at the eye's depth:
 *   - `caustics`: in the shallows the ripples' focused light crawls over every upward face;
 *   - `glow`: in the dark the rock carries small living lights (cold spots that breathe), which
 *     fade out as the climb reaches daylight.
 * Where the light reaches, the rock's upward faces wear a crust (coralline pink, algae green);
 * a frond seen from below glows, because the light comes through it.
 *
 * The meshes are only submitted while the eye is in the water (the sea is opaque from above).
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, clamp, cos, cross, exp, float, length, max, min, mix, normalGeometry, normalize,
    positionLocal, positionWorld, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3,
} from 'three/tsl';
import {
    OCEAN_REEF, buildReefKelpGeometry, buildReefRockGeometry, planOceanReef,
} from './odyssey-ocean-reef.js';

export const OCEAN_SCENERY_LOOK = Object.freeze({
    /** The lamp: how dark a downward face is against an upward one, and how the deep dims both. */
    under: 0.30,
    over: 1.10,
    deepDim: 0.55,
    /** The crust on upward rock in the light (linear). */
    coralline: Object.freeze([0.46, 0.20, 0.36]),
    algae: Object.freeze([0.14, 0.34, 0.15]),
    crust: 0.6,
    /** The caustic light on upward faces (the renderer's seabed web, at the reef's scale). */
    causticColour: Object.freeze([0.62, 0.92, 0.90]),
    causticGain: 0.75,
    /** The living lights in the dark. */
    glowA: Object.freeze([0.10, 0.95, 0.85]),
    glowB: Object.freeze([0.46, 0.30, 1.0]),
    glowGain: 1.5,
    /** How much of its own colour a coral in the dark gives off. */
    coralGlow: 0.6,
    /** The light through a frond seen from below. */
    frondBack: Object.freeze([0.42, 0.46, 0.10]),
});

/**
 * THE SUN'S SHAFTS IN THE UPPER WATER — light that sweeps.
 *
 * The deep keeps its nine great cones (the renderer's). Up where the light is strong the water
 * is full of thinner shafts: each a long soft blade of light let down from the surface along the
 * sun's refracted lean, turned about its own axis to face the eye (so it has no edge to show),
 * brightest under the surface and gone by its foot. They are alive on the clock: every shaft
 * waxes and wanes on its own beat as the ripples over it focus and scatter, a slow shimmer runs
 * down it, its head wanders with the swell, and the whole fan leans a few degrees back and forth
 * as the sea's face tilts (`sweep`), so the light is never where it was.
 */
export const OCEAN_SHAFTS = Object.freeze({
    count: 34,
    lowCount: 18,
    /** Their heads lie in a disc this wide round `centre` (world xz), on the surface. */
    centre: Object.freeze([-14, -22]),
    radius: 118,
    length: Object.freeze([46, 104]),
    width: Object.freeze([5.0, 16.0]),
    /** The lean from the vertical (rad), away from the sun, and how far it sweeps. */
    lean: 0.50,
    sweep: 0.085,
    sweepS: 83,
    turn: 0.16,
    turnS: 131,
    wander: 4.5,
    gain: 0.36,
});

/**
 * The direction the shafts run (down, away from the sun) at time `t`: the CPU twin of the vertex
 * stage, for tests. Unit vector.
 * @param {number[]} sun the world's sun direction (toward the sun)
 * @param {number} t seconds
 */
export function oceanShaftDirection(sun, t, spec = OCEAN_SHAFTS, out = [0, 0, 0]) {
    const az = Math.atan2(-sun[2], -sun[0]) + (spec.turn * Math.sin((t * Math.PI * 2) / spec.turnS));
    const lean = spec.lean + (spec.sweep * Math.sin((t * Math.PI * 2) / spec.sweepS));
    out[0] = Math.cos(az) * Math.sin(lean);
    out[1] = -Math.cos(lean);
    out[2] = Math.sin(az) * Math.sin(lean);
    return out;
}

/**
 * @param {object} o
 * @param {(x: number, z: number) => number} o.heightAt the drawn bed's CPU mirror
 * @param {{x:number,y:number,z:number}[]} o.rail the open-water rail points
 * @param {number} o.seaLevel
 * @param {string} [o.quality] 'high' | 'low'
 * @param {*} o.uTime float uniform
 * @param {*} o.noiseTex the world's tiling detail texture (b = value noise, a = stretched field)
 * @param {(colour: *, worldPosition: *) => *} o.haze the world's water haze
 * @param {(colour: *) => *} o.grade the world's output grade
 * @param {(worldPosition: *) => *} [o.depthNode] the 1->2 steam's depth rule
 * @param {(colour: *) => *} o.gradeLight the grade for light that adds (no world fade toward dark)
 * @param {number[]} o.sun the world's sun direction (toward the sun)
 * @param {*} o.sunColour vec3 uniform
 * @param {*} o.uLife float uniform, the sea's life through the 1->2 carry
 */
export function createOdysseyOceanScenery({
    heightAt, rail, seaLevel, quality = 'high', uTime, noiseTex, haze, grade, depthNode = null,
    gradeLight, sun, sunColour, uLife,
}) {
    const plan = planOceanReef({
        heightAt, rail, seaLevel, quality,
    });
    const L = OCEAN_SCENERY_LOOK;
    const group = new THREE.Group();
    group.name = 'odyssey-ocean-scenery';
    const uCaustics = uniform(0);
    const uGlow = uniform(0);

    const wp = positionWorld;
    const depthU = float(seaLevel).sub(wp.y);
    // How much of the surface's light reaches this depth (what grows, what the caustics lie on).
    const sunny = float(1).sub(smoothstep(float(12), float(95), depthU));
    const eyeDist = length(wp.sub(cameraPosition));
    // The seabed's caustic web (two channels of the tile crossing), drifting.
    const causticAt = (scale) => {
        const t = texture(noiseTex, wp.xz.mul(scale).add(vec2(uTime.mul(0.0052), uTime.mul(-0.0039))));
        const web = min(t.b, clamp(t.a.sub(0.42).mul(3.57), 0, 1));
        return smoothstep(sin(uTime.mul(0.7)).mul(0.04).add(0.50), float(0.78), web);
    };

    // ── rock and coral ──
    const rockMat = new THREE.MeshBasicNodeMaterial();
    {
        const base = attribute('color', 'vec3');
        const up = clamp(normalGeometry.y.mul(0.5).add(0.5), 0, 1);
        // Grey is rock; a pigment is coral (it keeps its colour and takes no crust).
        const chroma = max(base.r, max(base.g, base.b)).sub(min(base.r, min(base.g, base.b)));
        const isRock = float(1).sub(smoothstep(float(0.03), float(0.12), chroma));
        const grain = texture(noiseTex, vec2(wp.x.add(wp.y.mul(0.37)), wp.z.add(wp.y.mul(0.61))).mul(0.041));
        const crustAmt = smoothstep(float(0.36), float(0.66), grain.b).mul(up).mul(sunny).mul(isRock)
            .mul(L.crust);
        const crustCol = mix(vec3(...L.coralline), vec3(...L.algae), smoothstep(float(0.42), float(0.60), grain.a));
        const albedo = mix(base, crustCol, crustAmt).mul(grain.b.mul(0.36).add(0.82));
        const lamp = mix(float(L.under), float(L.over), up.pow(1.3))
            .mul(float(1).sub(clamp(depthU.div(200), 0, 1).mul(L.deepDim)));
        const caustic = causticAt(0.047).mul(smoothstep(float(0.45), float(0.85), up)).mul(sunny).mul(uCaustics);
        const lit = albedo.mul(lamp).add(vec3(...L.causticColour).mul(caustic).mul(L.causticGain).mul(albedo.add(0.25)));
        // The living lights: small cold spots on the rock, each breathing on its own clock.
        const spotTex = texture(noiseTex, vec2(wp.x.add(wp.y.mul(0.53)), wp.z.sub(wp.y.mul(0.41))).mul(0.19));
        const deepMask = smoothstep(float(58), float(112), depthU);
        const breathe = sin(uTime.mul(0.55).add(grain.b.mul(31))).mul(0.4).add(0.6);
        const spots = smoothstep(float(0.70), float(0.80), spotTex.b).mul(isRock);
        // ...and the deep garden's coral carries its own colour as light (it is the cold kind).
        const ownLight = float(1).sub(isRock).mul(L.coralGlow);
        const glow = mix(vec3(...L.glowA), vec3(...L.glowB), smoothstep(float(0.35), float(0.65), grain.a))
            .mul(spots)
            .mul(L.glowGain)
            .add(base.mul(ownLight))
            .mul(deepMask)
            .mul(breathe)
            .mul(uGlow)
            .mul(exp(eyeDist.mul(-0.009)));
        rockMat.colorNode = grade(haze(lit, wp).add(glow));
        if (depthNode) rockMat.depthNode = depthNode(wp);
        rockMat.side = THREE.DoubleSide;
        rockMat.fog = false;
    }
    const rockMesh = new THREE.Mesh(buildReefRockGeometry(plan), rockMat);
    rockMesh.name = 'odyssey-ocean-reef';
    rockMesh.matrixAutoUpdate = false;
    group.add(rockMesh);

    // ── kelp ──
    const kelpMat = new THREE.MeshBasicNodeMaterial();
    {
        const k = attribute('aKelp', 'vec4');
        const s = k.x;
        const phase = k.y;
        const blade = k.z;
        // The stalk bends more the further from its foot; two slow waves so a stand never sways in
        // step, and the current's own surge leans the whole forest together.
        const amp = s.pow(1.25).mul(0.030);
        const swayX = sin(uTime.mul(0.50).add(phase).add(s.mul(0.085))).mul(amp);
        const swayZ = sin(uTime.mul(0.37).add(phase.mul(1.7)).add(s.mul(0.066))).mul(amp.mul(0.7));
        const surge = sin(uTime.mul(0.11).add(s.mul(0.02))).mul(amp.mul(0.9));
        const flutter = sin(uTime.mul(1.4).add(phase.mul(3.1)).add(s.mul(0.6))).mul(blade.mul(0.10));
        kelpMat.positionNode = positionLocal.add(vec3(
            swayX.add(surge.mul(OCEAN_REEF.current[0])).add(flutter.mul(0.5)),
            flutter.mul(0.6).sub(amp.mul(0.12)),
            swayZ.add(surge.mul(OCEAN_REEF.current[1])).add(flutter.mul(0.35)),
        ));
        const base = attribute('color', 'vec3');
        const eye = normalize(cameraPosition.sub(wp));
        // Seen from below a frond glows: the surface's light comes through the blade.
        const back = smoothstep(float(0.05), float(0.75), eye.y.negate());
        const lamp = mix(float(1.15), float(0.42), smoothstep(float(0), float(120), depthU));
        const caustic = causticAt(0.061).mul(sunny).mul(uCaustics);
        const lit = base.mul(lamp)
            .add(vec3(...L.frondBack).mul(back).mul(sunny.mul(0.8).add(0.2)).mul(blade.mul(0.12).add(0.55)))
            .add(vec3(...L.causticColour).mul(caustic).mul(0.22));
        kelpMat.colorNode = grade(haze(lit, wp));
        if (depthNode) kelpMat.depthNode = depthNode(wp);
        kelpMat.side = THREE.DoubleSide;
        kelpMat.fog = false;
    }
    const kelpMesh = new THREE.Mesh(buildReefKelpGeometry(plan), kelpMat);
    kelpMesh.name = 'odyssey-ocean-kelp-forest';
    kelpMesh.matrixAutoUpdate = false;
    group.add(kelpMesh);

    // ── the sun's shafts in the upper water ──
    const SH = OCEAN_SHAFTS;
    const shaftCount = quality === 'low' ? SH.lowCount : SH.count;
    const uShafts = uniform(0);
    const shaftGeo = new THREE.InstancedBufferGeometry();
    {
        const quadGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
        shaftGeo.setIndex(quadGeo.index);
        shaftGeo.setAttribute('position', quadGeo.attributes.position);
        shaftGeo.setAttribute('uv', quadGeo.attributes.uv);
        const head = new Float32Array(shaftCount * 4);
        const hash = (n) => {
            let h = Math.imul(n ^ 0x2545f491, 2654435761);
            h = Math.imul(h ^ (h >>> 13), 1274126177);
            return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
        };
        for (let i = 0; i < shaftCount; i += 1) {
            const a = hash((i * 4) + 1) * Math.PI * 2;
            const r = Math.sqrt(hash((i * 4) + 2)) * SH.radius;
            head[i * 4] = SH.centre[0] + (Math.cos(a) * r);
            head[(i * 4) + 1] = SH.centre[1] + (Math.sin(a) * r);
            head[(i * 4) + 2] = hash((i * 4) + 3);
            head[(i * 4) + 3] = hash((i * 4) + 4);
        }
        shaftGeo.setAttribute('aShaft', new THREE.InstancedBufferAttribute(head, 4));
        shaftGeo.instanceCount = shaftCount;
        quadGeo.dispose();
    }
    const shaftMat = new THREE.MeshBasicNodeMaterial();
    {
        const sh = attribute('aShaft', 'vec4');
        const seed = sh.z;
        const seed2 = sh.w;
        // The shared lean (see `oceanShaftDirection`), swept on the clock.
        const az = float(Math.atan2(-sun[2], -sun[0])).add(sin(uTime.mul((Math.PI * 2) / SH.turnS)).mul(SH.turn));
        const lean = float(SH.lean).add(sin(uTime.mul((Math.PI * 2) / SH.sweepS)).mul(SH.sweep));
        const dir = vec3(cos(az).mul(sin(lean)), cos(lean).negate(), sin(az).mul(sin(lean)));
        const len = mix(float(SH.length[0]), float(SH.length[1]), seed2);
        const wide = mix(float(SH.width[0]), float(SH.width[1]), seed.mul(seed));
        // Its head wanders with the swell.
        const headAt = vec3(
            sh.x.add(sin(uTime.mul(0.052).add(seed.mul(41))).mul(SH.wander)),
            float(seaLevel + 0.6),
            sh.y.add(cos(uTime.mul(0.043).add(seed2.mul(29))).mul(SH.wander)),
        );
        const along = float(0.5).sub(positionLocal.y);
        const axisAt = headAt.add(dir.mul(along.mul(len)));
        const toEye = cameraPosition.sub(axisAt);
        const side = cross(dir, toEye);
        const sideLen = length(side);
        // Turned about its own axis to face the eye; seen straight down its length it has no
        // breadth to show, so it fades there (and the normalize never sees a zero vector).
        const sideDir = side.div(max(sideLen, float(1e-3)));
        shaftMat.positionNode = axisAt.add(sideDir.mul(positionLocal.x.mul(wide)));
        const vAxisOn = varying(sideLen.div(max(length(toEye), float(1e-3))), 'vShaftAxisOn');
        const vBeat = varying(
            sin(uTime.mul(seed.mul(0.31).add(0.17)).add(seed2.mul(40))).mul(0.5).add(0.5)
                .mul(sin(uTime.mul(seed2.mul(0.23).add(0.09)).add(seed.mul(23))).mul(0.3).add(0.7)),
            'vShaftBeat',
        );
        const sUv = uv();
        const across = sin(clamp(sUv.x, 0, 1).mul(Math.PI));
        const down = clamp(float(1).sub(sUv.y), 0, 1);
        const body = across.mul(across)
            .mul(smoothstep(float(0.0), float(0.07), down))
            .mul(float(1).sub(down).pow(1.6));
        // The shimmer that runs down it: the ripples' focus, drawn out along the shaft.
        const shimmer = texture(noiseTex, vec2(seed.mul(7.31).add(sUv.x.mul(0.11)), down.mul(0.55).sub(uTime.mul(0.027)))).b;
        const near = smoothstep(float(5), float(34), length(positionWorld.sub(cameraPosition)));
        const underSea = smoothstep(float(seaLevel + 0.4), float(seaLevel - 2.5), positionWorld.y);
        shaftMat.colorNode = gradeLight(mix(sunColour, vec3(0.62, 0.96, 1.0), 0.6));
        shaftMat.opacityNode = body
            .mul(shimmer.mul(1.1).add(0.25))
            .mul(vBeat.mul(0.85).add(0.15))
            .mul(smoothstep(float(0.10), float(0.42), vAxisOn))
            .mul(near)
            .mul(underSea)
            .mul(uShafts)
            .mul(uLife)
            .mul(SH.gain);
        shaftMat.alphaTest = 0.004;
        shaftMat.transparent = true;
        shaftMat.blending = THREE.AdditiveBlending;
        shaftMat.depthWrite = false;
        shaftMat.side = THREE.DoubleSide;
        shaftMat.fog = false;
    }
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat);
    shaftMesh.name = 'odyssey-ocean-shafts';
    shaftMesh.frustumCulled = false;
    shaftMesh.renderOrder = 3;
    shaftMesh.matrixAutoUpdate = false;
    group.add(shaftMesh);

    return {
        group,
        plan,
        meshes: [rockMesh, kelpMesh, shaftMesh],
        /**
         * @param {{ caustics: number, glow: number, beams: number }} look the depth arc at the eye
         * @param {boolean} inWater whether the eye is in the water (and the sea's life is here)
         */
        update(look, inWater) {
            uCaustics.value = look.caustics;
            uGlow.value = look.glow;
            uShafts.value = look.beams;
            shaftMesh.visible = inWater && look.beams > 0.004 && shaftMesh.userData.filterVisible !== false;
            rockMesh.visible = inWater && rockMesh.userData.filterVisible !== false;
            kelpMesh.visible = inWater && kelpMesh.userData.filterVisible !== false;
        },
        dispose() {
            rockMat.dispose();
            kelpMat.dispose();
            shaftMat.dispose();
        },
    };
}
