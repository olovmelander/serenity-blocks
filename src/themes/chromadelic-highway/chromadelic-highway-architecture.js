/**
 * Chromadelic Highway — sculpted 3D highway architecture (Blender-authored meshes, GPU-instanced).
 *
 * Renders the two Blender-built architectural families from chromadelic-highway-pylon-model.js:
 *   1. Gate Cantilever Pylons (createGatePylons): paired left/right obsidian-chrome wing buttresses
 *      locked to the EXACT same ring lattice (zR, slot J mod 16) as createTunnelRings, anchoring
 *      each arching neon ring to the highway deck with glowing neon conduit channels, crisp
 *      barycentric beveled specular creases and floating crystal prism shards.
 *   2. Roadside Speed-Chevron Stanchions (createRoadChevrons): sleek swept-forward crystal curb
 *      fins streaming at high cadence along both flanks of the rainbow road for visceral 3D
 *      peripheral speed and runway-style event light pulses.
 *
 * Self-shaded scene-linear HDR (no scene lights), zero per-frame CPU uploads, 100 % closed-form
 * on the shared travel clock, identical on WebGPU and WebGL2.
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
    floor,
    fract,
    fwidth,
    instanceIndex,
    int,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    step,
    uniform,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    RING_SPACING,
    TUNNEL_SPAN,
    TUNNEL_Z_FAR,
    TUNNEL_Z_NEAR,
    chdNeonColor,
    chdRoadCurve,
    chdWaves,
} from './chromadelic-highway-tsl.js';
import { latticeRingCount } from './chromadelic-highway-fx.js';
import {
    CHEVRON_EDGE,
    CHEVRON_KIND,
    CHEVRON_NORMAL,
    CHEVRON_POSITION,
    PYLON_EDGE,
    PYLON_KIND,
    PYLON_NORMAL,
    PYLON_POSITION,
} from './chromadelic-highway-pylon-model.js';

const PINK_BOUNCE = vec3(1.0, 0.08, 0.56);
const VIOLET_BOUNCE = vec3(0.68, 0.22, 1.0);
const GOLD_TINT = vec3(1.0, 0.84, 0.44);
const TAU = Math.PI * 2;
const ARC_THETA0 = THREE.MathUtils.degToRad(-20);
const ARC_THETA1 = THREE.MathUtils.degToRad(200);

/** Matches createTunnelRings shapeFactor so pillars contract cleanly to meet hex & oct rings! */
function ringShapeAtFoot(shapeN) {
    const N = max(shapeN, 3.0);
    const seg = float(TAU).div(N);
    const half = float(Math.PI).div(N);
    // Evaluate at theta = -0.095 rad (where y = 25 + 260*sin(theta) ≈ 0, the arch foot)
    const thetaFoot = float(-0.095);
    const local = fract(thetaFoot.sub(float(Math.PI / 2).sub(half)).div(seg)).sub(0.5).mul(seg);
    const c = cos(half);
    return mix(float(1.0), c.div(cos(local)).mul(float(2.0).div(c.add(1.0))), step(2.5, shapeN));
}

function buildInstancedStaticGeo(positions, normals, edges, kinds, instanceCount) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aNorm', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 3));
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
    geometry.instanceCount = instanceCount;
    return geometry;
}

/**
 * Paired 3D Gate Cantilever Pylons on the ring lattice (ONE draw call for both flanks).
 * Even instances stand on the right (+X); odd instances mirror onto the left (-X).
 */
export function createGatePylons({ count = 8, shared } = {}) {
    const n = latticeRingCount(count);
    const total = n * 2;
    const {
        uTime,
        uTravel,
        uRingPalette,
        uRingGlow,
        uRingForm,
        uDEmerge,
        uCascade,
        uCascadeCol,
        uCascadePrism,
        uCascade2,
        uCascadeCol2,
        uCascadePrism2,
        uChase,
        uChase2,
        uGoldGild,
        uPulse,
        waves,
    } = shared;
    const uIntensity = uniform(1.0);
    const uGold = uGoldGild ?? uniform(0);

    const geometry = buildInstancedStaticGeo(PYLON_POSITION, PYLON_NORMAL, PYLON_EDGE, PYLON_KIND, total);

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide, // left-hand instances mirror X, inverting winding cleanly
        transparent: true,
        depthWrite: true,
    });
    material.name = 'chromadelic-pylons';
    material.fog = false;

    // Shared lattice computation (identical to ringLattice in chromadelic-highway-fx.js)
    const zStart = TUNNEL_Z_NEAR - n * RING_SPACING;
    const pairIdx = floor(float(instanceIndex).mul(0.5));
    const sideBit = float(instanceIndex).sub(pairIdx.mul(2.0)); // 0 right (+1), 1 left (-1)
    const sideSign = mix(float(1.0), float(-1.0), sideBit);

    const q = uTravel.div(RING_SPACING).add(pairIdx);
    const zR = float(zStart).add(fract(q.div(n)).mul(n * RING_SPACING));
    const J = floor(float(TUNNEL_Z_NEAR).add(uTravel).sub(zR).div(RING_SPACING)
        .add(0.5));
    const slot = int(J.sub(floor(J.mul(1.0 / 16.0)).mul(16.0)));
    const curve = chdRoadCurve(zR, uTime);
    const C0 = vec3(curve.x, curve.y, zR);
    const depth = max(cameraViewMatrix.mul(vec4(C0, 1.0)).z.negate(), 1.0);
    // Visible from card emergence down to near-camera dissolve (collapse behind card).
    const shown = step(depth, uDEmerge.add(240.0)).mul(step(140.0, depth));

    const ringCore = uRingPalette.element(slot);
    const ringGlow = uRingGlow.element(slot);
    const ringForm = uRingForm ? uRingForm.element(slot) : vec4(0.0, 0.0, 1.0, 0.0);
    // Exact outer X of this arch's foot (258.5 circle, 241.3 hexagon, 249.7 octagon) so wings
    // ALWAYS kiss the exact ring perimeter and never poke detached ears past polygon rings!
    const footFactor = ringShapeAtFoot(ringForm.x);
    const footX = float(258.5).mul(footFactor);

    const frontOf = (u) => {
        const age = max(uTime.sub(u.x), 0.0);
        const dN = depth.sub(u.y.sub(u.z.mul(age))).div(200.0);
        return u.w.mul(exp(dN.mul(dN).negate()));
    };
    const cascadeA = frontOf(uCascade);
    const cascadeB = uCascade2 ? frontOf(uCascade2) : float(0.0);
    const cascade = cascadeA.add(cascadeB);
    const prismCascade = cascadeA.mul(uCascadePrism).add(cascadeB.mul(uCascadePrism2 ?? float(0.0)));
    const wv = chdWaves(zR, waves, ringCore);

    const waveHue = wv.color.div(max(wv.amount, 0.001));
    const waveMix = min(wv.amount, 1.0).mul(0.65);
    const tintA = min(cascadeA, 1.0).mul(uCascadeCol.w);
    const tintB = min(cascadeB, 1.0).mul(uCascadeCol2 ? uCascadeCol2.w : float(0.0));
    // Match the EXACT left (theta≈185°) and right (theta≈-5°) rainbow gradient foot of prism rings!
    const footTheta = mix(float(-0.09), float(Math.PI + 0.09), sideBit);
    const footArcN = footTheta.sub(ARC_THETA0).div(ARC_THETA1 - ARC_THETA0);
    const footPrism = chdNeonColor(fract(ringGlow.w).add(footArcN.mul(0.88)), float(0.54));
    const baseRingCol = mix(ringCore, footPrism, step(0.5, ringGlow.w));
    const liveCol = mix(
        mix(mix(baseRingCol, waveHue, waveMix), uCascadeCol.xyz, tintA),
        uCascadeCol2 ? uCascadeCol2.xyz : vec3(1.0),
        tintB,
    );
    const flash = min(max(wv.amount.mul(0.8), cascade), 1.6);

    const mapPylonLocal = (p) => {
        // Remap span x ∈ [99.5..261] smoothly to [99.5..footX] so hex/oct arches fit to the millimeter!
        const tSpan = clamp(p.x.sub(99.5).div(159.0), 0.0, 1.35);
        const mappedX = float(99.5).add(tSpan.mul(footX.sub(99.5)));
        return vec3(mappedX.mul(sideSign), p.y, p.z);
    };

    material.vertexNode = Fn(() => {
        const local = mapPylonLocal(positionGeometry);
        const world = C0.add(local.mul(shown));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        // Derivatives first (uniform control flow).
        const e = attribute('aEdge', 'vec3');
        const edgeDist = min(e.x, min(e.y, e.z));
        const fwE = max(fwidth(edgeDist), 0.001);
        const edgeLine = float(1.0).sub(smoothstep(fwE.mul(0.5), fwE.mul(1.9), edgeDist));

        const kind = attribute('aKind', 'float');
        const p = positionGeometry;
        const nRaw = attribute('aNorm', 'vec3');

        const vMeta = vertexStage(vec4(depth, sideBit, flash, prismCascade));
        const vCol = vertexStage(liveCol);
        const vJ = vertexStage(J);
        const vWorld = vertexStage(C0.add(mapPylonLocal(p)));
        const vNorm = vertexStage(normalize(vec3(nRaw.x.mul(sideSign), nRaw.y, nRaw.z)));
        const vSpan = vertexStage(clamp(p.x.sub(99.5).div(159.0), 0.0, 1.0));

        const vDepth = vMeta.x;
        const vSide = vMeta.y;
        const vFlash = vMeta.z;
        const vPrism = vMeta.w;

        const N = normalize(vNorm).toVar();
        const V = normalize(cameraPosition.sub(vWorld)).toVar();
        const ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
        const fresnel = pow(float(1.0).sub(ndv), 2.8).toVar();

        // Key light from behind the board (vanishing core) + road flank under-bounce.
        const Lkey = normalize(vec3(0.0, 60.0, -4000.0).sub(vWorld));
        const keyDiff = clamp(dot(N, Lkey).mul(0.55).add(0.45), 0.0, 1.0);
        const halfKey = normalize(Lkey.add(V));
        const keySpec = pow(clamp(abs(dot(N, halfKey)), 0.0, 1.0), 28.0);
        const roadBounceCol = mix(VIOLET_BOUNCE, PINK_BOUNCE, vSide);
        const underBounce = clamp(N.y.negate().mul(0.6).add(0.4), 0.0, 1.0);

        // Chase light flowing outward along the aero wing from highway curb into the neon arch!
        const armPos = vSpan;
        const chaseOf = (u) => {
            const age = uTime.sub(u.x);
            const s = age.div(max(u.y, 0.1));
            const df = armPos.sub(clamp(s, 0.0, 1.0)).div(0.18);
            const live = step(0.0, s).mul(float(1.0).sub(smoothstep(0.85, 1.5, s))).mul(step(0.5, u.z));
            return exp(df.mul(df).negate()).mul(live).mul(u.w);
        };
        const chase = min(chaseOf(uChase).add(uChase2 ? chaseOf(uChase2) : float(0.0)), 1.6);

        // Smooth chromadelic energy flow: blends highway curb rail color at root (vSpan=0)
        // seamlessly into the neon arch's exact foot color at the emitter tip (vSpan=1)!
        const spanFlow = mix(roadBounceCol, vCol, smoothstep(0.0, 0.65, vSpan));
        const prismCol = chdNeonColor(fract(armPos.mul(0.65).add(vJ.mul(0.17))), float(0.58));
        const accentCol = mix(
            mix(spanFlow, GOLD_TINT, clamp(uGold, 0.0, 0.9)),
            prismCol,
            min(vPrism.mul(1.4), 1.0),
        ).toVar();

        // Material 0: Sleek dark obsidian-glass aero wing (ultra-deep polished body, glossy Fresnel rim!).
        const matHull = vec3(0.008, 0.006, 0.024)
            .add(roadBounceCol.mul(underBounce).mul(0.065))
            .add(accentCol.mul(keyDiff).mul(0.065))
            .add(accentCol.mul(fresnel).mul(0.38).mul(float(1.0).add(vFlash.mul(0.6)).add(chase.mul(0.5))))
            .add(mix(accentCol, vec3(1.0), 0.42).mul(keySpec).mul(0.48));

        // Material 1: Continuous glowing plasma conduits feeding curb energy straight into the neon arch!
        const conduitPulse = float(0.85).add(sin(vSpan.mul(8.0).sub(uTime.mul(4.5)).add(vJ)).mul(0.15));
        const conduitHot = mix(
            accentCol,
            vec3(1.0),
            clamp(float(0.32).add(vFlash.mul(0.30)).add(chase.mul(0.28)), 0.0, 0.88),
        );
        const matNeon = conduitHot.mul(conduitPulse)
            .mul(float(1.45).add(vFlash.mul(1.15)).add(chase.mul(1.25)).add(uPulse.mul(0.36)));

        // Material 2: Glowing diamond prism emitter node igniting the foot of the neon arch!
        const matPrism = mix(accentCol, vec3(1.0), float(0.52).add(fresnel.mul(0.3)))
            .mul(float(1.55).add(vFlash.mul(1.25)).add(chase.mul(1.1)))
            .add(mix(accentCol, vec3(1.0), 0.7).mul(edgeLine).mul(0.85));

        const isNeon = step(0.5, kind).mul(step(kind, 1.5));
        const isPrism = step(1.5, kind);
        const shaded = mix(mix(matHull, matNeon, isNeon), matPrism, isPrism);

        // Smooth distance alpha fade into cosmic space (zero dark black horizon twigs!).
        const fade = smoothstep(uDEmerge.add(220.0), uDEmerge.sub(80.0), vDepth)
            .mul(smoothstep(155.0, 320.0, vDepth))
            .mul(uIntensity);
        return vec4(min(shaded, vec3(4.5)), fade);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-pylons';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;

    return {
        mesh,
        material,
        count: n,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * Sleek roadside Speed-Chevron Stanchions anchored along the highway outer curbs (ONE draw call).
 * Twice the ring cadence so peripheral vision registers exhilarating 3D velocity at every moment.
 */
export function createRoadChevrons({ count = 16, shared } = {}) {
    // Keep count a divisor of 240 so TRAVEL_WRAP (84000) wraps cleanly across the tunnel span.
    const n = Math.max(4, Math.min(32, Math.floor(count)));
    const total = n * 2;
    const spacing = TUNNEL_SPAN / n;
    const {
        uTime, uTravel, uPulse, uRailTick, uGoldGild, uDEmerge, waves,
    } = shared;
    const uIntensity = uniform(1.0);
    const uGold = uGoldGild ?? uniform(0);

    const geometry = buildInstancedStaticGeo(CHEVRON_POSITION, CHEVRON_NORMAL, CHEVRON_EDGE, CHEVRON_KIND, total);

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
    });
    material.name = 'chromadelic-chevrons';
    material.fog = false;

    const pairIdx = floor(float(instanceIndex).mul(0.5));
    const sideBit = float(instanceIndex).sub(pairIdx.mul(2.0)); // 0 right (+1), 1 left (-1)
    const sideSign = mix(float(1.0), float(-1.0), sideBit);

    const q = uTravel.div(spacing).add(pairIdx);
    const zC = float(TUNNEL_Z_FAR).add(fract(q.div(n)).mul(TUNNEL_SPAN));
    const curve = chdRoadCurve(zC, uTime);
    const C0 = vec3(curve.x, curve.y, zC);
    const depth = max(cameraViewMatrix.mul(vec4(C0, 1.0)).z.negate(), 1.0);
    const shown = step(depth, uDEmerge.add(480.0)).mul(step(95.0, depth));

    const sideCol = mix(VIOLET_BOUNCE, PINK_BOUNCE, sideBit);
    const wv = chdWaves(zC, waves, sideCol);
    const waveHue = wv.color.div(max(wv.amount, 0.001));
    const liveCol = mix(mix(sideCol, waveHue, min(wv.amount, 1.0).mul(0.75)), GOLD_TINT, clamp(uGold, 0.0, 0.9));

    material.vertexNode = Fn(() => {
        const p = positionGeometry;
        const kind = attribute('aKind', 'float');
        const isPrism = step(1.5, kind);
        const bob = sin(uTime.mul(2.6).add(pairIdx.mul(0.9))).mul(1.4).mul(isPrism);
        const local = vec3(p.x.mul(sideSign), p.y.add(bob), p.z);
        const world = C0.add(local.mul(shown));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const e = attribute('aEdge', 'vec3');
        const edgeDist = min(e.x, min(e.y, e.z));
        const fwE = max(fwidth(edgeDist), 0.001);
        const edgeLine = float(1.0).sub(smoothstep(fwE.mul(0.45), fwE.mul(1.8), edgeDist));

        const kind = attribute('aKind', 'float');
        const nRaw = attribute('aNorm', 'vec3');
        const p = positionGeometry;

        const vMeta = vertexStage(vec4(depth, wv.amount, sideBit, 0.0));
        const vCol = vertexStage(liveCol);
        const vWorld = vertexStage(C0.add(vec3(p.x.mul(sideSign), p.y, p.z)));
        const vNorm = vertexStage(normalize(vec3(nRaw.x.mul(sideSign), nRaw.y, nRaw.z)));

        const vDepth = vMeta.x;
        const vWave = vMeta.y;
        const N = normalize(vNorm);
        const V = normalize(cameraPosition.sub(vWorld));
        const fresnel = pow(float(1.0).sub(clamp(abs(dot(N, V)), 0.0, 1.0)), 2.5);

        const hull = vec3(0.015, 0.010, 0.036)
            .add(vCol.mul(fresnel).mul(0.34).mul(float(1.0).add(vWave.mul(0.8)).add(uRailTick.mul(0.5))));
        const blade = mix(vCol, vec3(1.0), clamp(float(0.25).add(vWave.mul(0.4)).add(uRailTick.mul(0.35)), 0.0, 0.85))
            .mul(float(1.4).add(vWave.mul(1.6)).add(uPulse.mul(0.5)).add(uRailTick.mul(0.7)));
        const crystal = mix(vCol, vec3(1.0), 0.5).mul(float(0.85).add(edgeLine.mul(0.7)).add(vWave.mul(1.3)));

        const isBlade = step(0.5, kind).mul(step(kind, 1.5));
        const isCrystal = step(1.5, kind);
        const shaded = mix(mix(hull, blade, isBlade), crystal, isCrystal);

        const fade = smoothstep(uDEmerge.add(420.0), uDEmerge.sub(40.0), vDepth)
            .mul(smoothstep(105.0, 230.0, vDepth))
            .mul(uIntensity);
        return vec4(min(shaded, vec3(4.5)), fade);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-chevrons';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;

    return {
        mesh,
        material,
        count: n,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
