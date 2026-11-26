/**
 * Chromadelic Highway — distinct event spectacle instruments.
 *
 * Every major gameplay event gets its OWN unmistakable geometric shape (zero duplicate
 * "generic ring flash" effects), 100 % closed-form and seek-safe, precompiled at build time
 * (collapsing to zero area while dormant so resting cost is ~0), and cleanly framed OUTSIDE
 * the gameplay board card so play stays effortless even during a Perfect Clear:
 *
 *   1. createTwistHelix()        — Counter-rotating 3D chromatic double-helix corkscrew vortex
 *                                  spiraling outward down the tunnel around the board (TWIST).
 *   2. createWarpTunnelRibbons() — 12 longitudinal rainbow/gold hyper-warp light-rails linking
 *                                  arch to arch along the tunnel walls (3-Line, QUAD, B2B,
 *                                  PERFECT CLEAR, FEVER).
 *   3. createCosmicPortals()     ? an advancing octagonal gate, paired gold crescents,
 *                                  cascade chevrons, a twelve-prism finale and chain links.
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
    cross,
    exp,
    float,
    fract,
    instanceIndex,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionGeometry,
    pow,
    screenUV,
    sin,
    smoothstep,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    vertexStage,
} from 'three/tsl';
import {
    chdNeonColor,
    chdRoadCurve,
    chdRoundBoxSdf,
} from './chromadelic-highway-tsl.js';

const TAU = Math.PI * 2;
const GOLD_COL = vec3(1.0, 0.86, 0.46);
const LEMON_COL = vec3(1.0, 0.92, 0.08);
const MAGENTA_CYAN = vec3(0.18, 0.92, 1.0);

export const PORTAL_KIND = Object.freeze({
    level: 0, backToBack: 1, cascade: 2, perfect: 3, chain: 4,
});

function eventClearance(shared) {
    const {
        uViewportPx, uCardRectPx, uCardRadiusPx, uHudRectPx, uBoardActive,
    } = shared;
    const pixel = screenUV.mul(uViewportPx);
    const card = chdRoundBoxSdf(pixel, uCardRectPx, uCardRadiusPx);
    const hud = chdRoundBoxSdf(pixel, uHudRectPx, uCardRadiusPx.mul(0.55));
    const feather = max(4, uViewportPx.y.mul(0.035));
    return mix(1, smoothstep(0, feather, min(card, hud)), uBoardActive);
}

/**
 * 1. TWIST: Counter-rotating 3D chromatic double-helix corkscrew vortex spiraling down the tunnel.
 * Two instanced 3D ribbons wrapping cleanly at radius ~248 around the board card.
 * `shared.uTwistHelix` = vec4(birth, duration, sign ±1, amp).
 */
export function createTwistHelix({
    segments = 128, radius = 252, centerY = 152, shared,
} = {}) {
    const {
        uTime, uTwistHelix, uTwistMotion, uViewportH, uProjScaleY,
    } = shared;
    const uIntensity = uniform(1.0);

    // Strip geometry along s in [0, 1], side in {-1, +1}
    const pos = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
        const s = i / segments;
        for (let side = -1; side <= 1; side += 2) {
            pos.push(s, side, 0);
            uvs.push(s, (side + 1) * 0.5);
        }
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(idx);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.instanceCount = 2; // strand 0 and strand 1 (180° apart)

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-twist-helix';
    material.fog = false;
    material.forceSinglePass = true;

    const helixPoint = (s, strand, age, signDir) => {
        // Travels smoothly from behind the board (z = -1550) out past the camera (z = +130).
        const z = mix(float(-1550.0), float(130.0), s);
        const curve = chdRoadCurve(z, uTime);
        // 2.6 full corkscrew turns down the corridor, spinning briskly in `signDir` as it expands!
        const ang = s.mul(TAU * 2.6).sub(age.mul(8.5).mul(uTwistMotion)).mul(signDir).add(strand.mul(Math.PI));
        // Smooth raised elliptical spiral (never floor-clamped -> 100% continuous silky curves!).
        const scale = mix(float(0.84), float(1.12), s);
        const rx = float(radius).mul(scale);
        const ry = float(142.0).mul(scale);
        return vec3(
            curve.x.add(cos(ang).mul(rx)),
            curve.y.add(float(centerY)).add(sin(ang).mul(ry)),
            z,
        );
    };

    material.vertexNode = Fn(() => {
        const s = positionGeometry.x;
        const side = positionGeometry.y;
        const strand = float(instanceIndex);
        const age = uTime.sub(uTwistHelix.x);
        const dur = max(uTwistHelix.y, 0.1);
        const life = age.div(dur);
        const alive = step(0.0, age).mul(step(life, 1.05)).mul(step(0.01, uTwistHelix.w));
        const signDir = uTwistHelix.z;

        const P0 = helixPoint(s, strand, age, signDir);
        const P1 = helixPoint(min(s.add(0.012), 1.0), strand, age, signDir);
        const tang = normalize(P1.sub(P0).add(vec3(0.0, 0.0, 0.001)));
        const toCam = cameraPosition.sub(P0);
        const dist = max(length(toCam), 1.0);
        const across = normalize(cross(tang, toCam.div(dist)));

        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        // Sleek tapered ribbon width: 14–22 px in screen space, collapsed to 0 when dormant.
        const headEnv = smoothstep(0.0, 0.12, s).mul(smoothstep(1.0, 0.85, s));
        const width = max(float(11.0), worldPerPx.mul(16.0)).mul(headEnv.mul(0.65).add(0.35)).mul(alive);
        const world = P0.add(across.mul(side.mul(width)));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const st = uv();
        const s = st.x;
        const v = abs(st.y.mul(2.0).sub(1.0));
        const strand = vertexStage(float(instanceIndex));

        const age = uTime.sub(uTwistHelix.x);
        const dur = max(uTwistHelix.y, 0.1);
        const life = clamp(age.div(dur), 0.0, 1.0);
        const alive = step(0.0, age).mul(step(age, dur)).mul(uTwistHelix.w);

        // Traveling bright corkscrew pulse sweeps from far (s=0) toward near (s=1)!
        const front = mix(0.6, clamp(life.mul(1.35), 0.0, 1.2), uTwistMotion);
        const trail = exp(s.sub(front).div(0.32).pow2().negate()).mul(1.25)
            .add(smoothstep(front.add(0.08), front.sub(0.38), s).mul(0.62));
        const fade = smoothstep(0.0, 0.08, life).mul(float(1.0).sub(smoothstep(0.66, 1.0, life)))
            .mul(smoothstep(0.0, 0.08, s)).mul(smoothstep(1.0, 0.86, s));

        const core = exp(v.mul(v).mul(-16.0));
        const halo = exp(v.mul(-3.2)).mul(float(1.0).sub(smoothstep(0.75, 1.0, v)));
        // Rhythmic plasma spark beads riding the spiral spine!
        const bead = pow(sin(s.mul(TAU * 12.0).sub(age.mul(18.0).mul(uTwistMotion))).mul(0.5).add(0.5), 6.0).mul(core).mul(1.1);

        // Strand 0: electric T-piece violet-magenta-lemon; Strand 1: razor cyan-aqua spiral complement!
        const strandCol = mix(
            mix(vec3(0.92, 0.24, 1.0), LEMON_COL, 0.45),
            mix(MAGENTA_CYAN, vec3(0.28, 1.0, 0.72), 0.35),
            strand,
        );
        const hot = mix(strandCol, vec3(1.0), clamp(core.mul(0.72).add(bead.mul(0.3)), 0.0, 0.92));

        const col = hot.mul(core.mul(2.45).add(halo.mul(0.72)).add(bead)).mul(trail).mul(fade).mul(alive)
            .mul(eventClearance(shared))
            .mul(uIntensity);
        return vec4(min(col, vec3(5.5)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-twist-helix';
    mesh.frustumCulled = false;
    mesh.renderOrder = 18;

    return {
        mesh,
        material,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * 2. QUAD / 3-LINE / B2B / PERFECT CLEAR / FEVER: Longitudinal Hyper-Warp Tunnel Light-Rails.
 * 12 instanced luminous rails running along the tunnel arch perimeter (radius = 258), linking
 * arch to arch into a blazing cosmic Rainbow-Road hyper-tunnel!
 * `shared.uWarpRails` = vec4(tripleEnergy, quadPrismEnergy, b2bGoldEnergy, perfectCrownEnergy).
 */
export function createWarpTunnelRibbons({
    rails = 12, segments = 64, radius = 258, centerY = 25, shared,
} = {}) {
    const {
        uTime, uTravel, uWarpRails, uViewportH, uProjScaleY, uViewportPx, uHeroPx,
    } = shared;
    const uIntensity = uniform(1.0);

    const pos = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= segments; i++) {
        const s = i / segments;
        for (let side = -1; side <= 1; side += 2) {
            pos.push(s, side, 0);
            uvs.push(s, (side + 1) * 0.5);
        }
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(idx);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.instanceCount = rails;

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-warp-rails';
    material.fog = false;
    material.forceSinglePass = true;

    const totalEnergy = max(max(uWarpRails.x, uWarpRails.y), max(uWarpRails.z, uWarpRails.w));

    material.vertexNode = Fn(() => {
        const s = positionGeometry.x;
        const side = positionGeometry.y;
        const idxF = float(instanceIndex);
        const frac = idxF.add(0.5).div(float(rails));
        const theta = mix(float(THREE.MathUtils.degToRad(-12)), float(THREE.MathUtils.degToRad(192)), frac);

        const alive = step(0.006, totalEnergy);
        const z = mix(float(-1900.0), float(150.0), s);
        const curve = chdRoadCurve(z, uTime);
        const P0 = vec3(
            curve.x.add(cos(theta).mul(radius)),
            curve.y.add(float(centerY)).add(sin(theta).mul(radius)),
            z,
        );
        const toCam = cameraPosition.sub(P0);
        const dist = max(length(toCam), 1.0);
        const across = normalize(cross(vec3(0.0, 0.0, 1.0), toCam.div(dist)));
        const worldPerPx = dist.div(float(0.5).mul(uViewportH).mul(uProjScaleY));
        const width = max(float(3.5), worldPerPx.mul(6.5)).mul(alive);
        const world = P0.add(across.mul(side.mul(width)));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(world, 1.0)));
    })();

    material.colorNode = Fn(() => {
        const st = uv();
        const s = st.x; // 0 far -> 1 near
        const v = abs(st.y.mul(2.0).sub(1.0));
        const railFrac = vertexStage(float(instanceIndex).add(0.5).div(float(rails)));

        // Streaming high-speed plasma packets tearing forward along every tunnel rail!
        const z = mix(float(-1900.0), float(150.0), s);
        const packetCoord = fract(z.sub(uTravel.mul(2.2)).div(260.0).add(railFrac.mul(1.7)));
        const packet = exp(packetCoord.sub(0.5).div(0.16).pow2().negate()).mul(0.85).add(0.32);

        const core = exp(v.mul(v).mul(-12.0));
        const halo = exp(v.mul(-3.0)).mul(float(1.0).sub(smoothstep(0.75, 1.0, v)));
        const profile = core.mul(1.6).add(halo.mul(0.45));

        // 3-Line: focuses on outer flank rails; B2B: upper-crown gold rails; Quad/Perfect: all 12 rails!
        const flankMask = smoothstep(0.35, 0.08, abs(railFrac.sub(0.5)).negate().add(0.5));
        const crownMask = smoothstep(0.48, 0.12, abs(railFrac.sub(0.5)));

        const prismCol = chdNeonColor(fract(railFrac.mul(1.15).add(s.mul(0.4)).sub(uTime.mul(0.45))), float(0.56));
        const tripleCol = chdNeonColor(fract(railFrac.mul(0.5).add(0.5)), float(0.54));

        const cTriple = tripleCol.mul(uWarpRails.x).mul(flankMask).mul(0.85);
        const cQuad = prismCol.mul(uWarpRails.y).mul(1.15);
        const cGold = mix(GOLD_COL, vec3(1.0), 0.3).mul(uWarpRails.z).mul(crownMask.mul(0.75).add(0.35)).mul(1.1);
        const cPerf = mix(prismCol, GOLD_COL, 0.22).mul(uWarpRails.w).mul(1.08);

        const pPx = screenUV.mul(uViewportPx);
        const heroM = float(1.0).sub(smoothstep(uHeroPx.z, uHeroPx.z.add(uViewportPx.y.mul(0.05)), length(pPx.sub(uHeroPx.xy))));

        const endFade = smoothstep(0.0, 0.16, s).mul(smoothstep(1.0, 0.82, s));
        const col = cTriple.add(cQuad).add(cGold).add(cPerf)
            .mul(profile)
            .mul(packet)
            .mul(endFade)
            .mul(eventClearance(shared))
            .mul(float(1.0).sub(heroM.mul(0.45)))
            .mul(uIntensity);
        return vec4(min(col, vec3(4.5)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-warp-rails';
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;

    return {
        mesh,
        material,
        uniforms: { uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * Build the five outlines once. Each edge has two shoulders carrying a signed distance
 * to the centre line. Only the narrow strips occupied by visible light are rasterised.
 */
function portalGeometry() {
    const positions = [];
    const strokes = [];
    const ranges = [];
    const uvs = [];
    const indices = [];
    const polar = (turn, radius = 1) => [radius * Math.cos(turn * TAU), radius * Math.sin(turn * TAU)];
    const arc = (begin, end, radius, steps) => Array.from({ length: steps + 1 }, (_, i) => (
        polar(begin + (end - begin) * (i / steps), radius)
    ));

    function stroke(kind, points, {
        width = 1, gain = 1, prism = 0, closed = false,
    } = {}) {
        if (!ranges[kind]) ranges[kind] = { start: indices.length, end: indices.length };
        const start = positions.length / 3;
        const count = points.length;
        const pointAt = (i) => points[closed ? (i + count) % count : Math.max(0, Math.min(count - 1, i))];
        const normal = (a, b) => {
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const len = Math.hypot(dx, dy) || 1;
            return [-dy / len, dx / len];
        };
        for (let i = 0; i < count; i++) {
            const p = points[i];
            const incoming = normal(pointAt(i - 1), p);
            const outgoing = normal(p, pointAt(i + 1));
            const mx = incoming[0] + outgoing[0];
            const my = incoming[1] + outgoing[1];
            const len = Math.hypot(mx, my) || 1;
            const nx = mx / len;
            const ny = my / len;
            const ref = i === count - 1 && !closed ? incoming : outgoing;
            const join = width / Math.max(0.55, nx * ref[0] + ny * ref[1]);
            for (const side of [-1, 1]) {
                positions.push(p[0], p[1], kind);
                strokes.push(side * join * nx, side * join * ny, gain, prism);
                uvs.push(side, Math.atan2(p[1], p[0]) / TAU);
            }
            if (closed || i + 1 < count) {
                const a = start + i * 2;
                const b = start + ((i + 1) % count) * 2;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
        ranges[kind].end = indices.length;
    }

    // The level marker has eight long flat faces. Detached brackets pick out its corners.
    const octagon = Array.from({ length: 8 }, (_, i) => polar((i + 0.5) / 8));
    stroke(PORTAL_KIND.level, octagon, { closed: true });
    for (let i = 0; i < 8; i++) {
        const angle = (i + 0.5) / 8;
        stroke(
            PORTAL_KIND.level,
            [polar(angle - 0.026, 1.012), polar(angle, 1.068), polar(angle + 0.026, 1.012)],
            { width: 0.55, gain: 0.8 },
        );
    }

    // Two gold crescents pass each other. A thin return line and diamond clasps distinguish the pair.
    for (const turn of [0, 0.5]) {
        stroke(PORTAL_KIND.backToBack, arc(turn - 0.19, turn + 0.19, 1, 36));
        stroke(PORTAL_KIND.backToBack, arc(turn - 0.14, turn + 0.16, 0.94, 28), { width: 0.43, gain: 0.7 });
        const a = turn + 0.225;
        stroke(
            PORTAL_KIND.backToBack,
            [polar(a - 0.011), polar(a, 1.034), polar(a + 0.011), polar(a, 0.966)],
            { width: 0.55, closed: true },
        );
    }

    // Successive waves from one drop climb outward as three stacked chevrons in each wing.
    for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
            const x = 0.82 + i * 0.13;
            const h = 0.34 - i * 0.054;
            stroke(
                PORTAL_KIND.cascade,
                [[side * (x - 0.17), -h], [side * x, 0], [side * (x - 0.17), h]],
                { width: 0.62 + i * 0.13, gain: 0.65 + i * 0.18 },
            );
        }
    }

    // A perfect field opens twelve faceted prisms, each with its own hue and a fine internal facet.
    for (let i = 0; i < 12; i++) {
        const a = i / 12;
        const outer = polar(a, i % 2 ? 1.10 : 1.21);
        const left = polar(a - 0.028, 0.94);
        const right = polar(a + 0.028, 0.94);
        const inner = polar(a, 0.835);
        stroke(PORTAL_KIND.perfect, [outer, left, inner, right], { closed: true, width: 0.84, prism: 0.86 });
        stroke(PORTAL_KIND.perfect, [left, polar(a + 0.004, 0.965), outer], { width: 0.46, gain: 0.66, prism: 1 });
        stroke(
            PORTAL_KIND.perfect,
            [inner, polar(a + 1 / 24, 0.79), polar(a + 1 / 12, 0.835)],
            { width: 0.42, gain: 0.65, prism: 0.32 },
        );
    }

    // Consecutive scoring locks assemble a necklace of links, independently of cascade depth.
    for (let i = 0; i < 12; i++) {
        const a = i / 12;
        const pts = Array.from({ length: 20 }, (_, j) => {
            const theta = TAU * (j / 20);
            return polar(a + 0.046 * Math.cos(theta), 0.96 + 0.046 * Math.sin(theta));
        });
        stroke(PORTAL_KIND.chain, pts, {
            closed: true, width: 0.7, gain: i % 2 ? 0.7 : 1, prism: 0.24,
        });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('stroke', new THREE.Float32BufferAttribute(strokes, 4));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    // Keep one collapsed triangle submitted so the first scoring event already has a pipeline.
    geometry.setDrawRange(0, 3);
    return { geometry, ranges };
}

export function createCosmicPortals({ shared } = {}) {
    const { uViewportPx, uPortalA, uPortalB } = shared;
    const uIntensity = uniform(1);
    const { geometry, ranges } = portalGeometry();
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-portals';
    material.fog = false;
    material.forceSinglePass = true;

    const ink = attribute('stroke', 'vec4');
    const slot = int(positionGeometry.z.add(0.5));
    const state = uPortalA.element(slot);
    const palette = uPortalB.element(slot);
    material.vertexNode = Fn(() => {
        const alive = step(0.004, state.z);
        const aspect = uViewportPx.y.div(max(uViewportPx.x, 1));
        const xy = positionGeometry.xy.mul(state.x).add(ink.xy.mul(state.y));
        // y = 0.458 of the image from the top: the highway's distant vanishing point.
        return vec4(xy.mul(vec2(aspect, 1)).mul(alive.mul(2)).add(vec2(0, 0.084)), 0.5, 1);
    })();
    const emission = vertexStage(Fn(() => {
        const wheel = chdNeonColor(fract(uv().y.add(palette.w.mul(0.12)).add(0.13)), float(0.54));
        return vec4(mix(palette.xyz, wheel, ink.w), state.z.mul(ink.z));
    })());
    material.outputNode = Fn(() => {
        const across = clamp(abs(uv().x), 0, 1).toVar();
        const core = exp(across.mul(across).mul(-20)).toVar();
        const shoulder = float(1).sub(smoothstep(0, 1, across));
        const hot = mix(emission.rgb, vec3(1), core.mul(0.32));
        const light = hot.mul(core.mul(1.5).add(shoulder.mul(0.52)))
            .mul(emission.w).mul(eventClearance(shared)).mul(uIntensity);
        return vec4(light, 0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-portals';
    mesh.frustumCulled = false;
    mesh.renderOrder = 16;
    return {
        mesh,
        material,
        uniforms: { uIntensity },
        setActiveRange(first, last) {
            if (last < first) geometry.setDrawRange(0, 3);
            else geometry.setDrawRange(ranges[first].start, ranges[last].end - ranges[first].start);
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
