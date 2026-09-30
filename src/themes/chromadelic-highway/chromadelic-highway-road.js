/**
 * Chromadelic Highway — the rainbow road and its neon rails.
 *
 * A prism-glass highway drawn in LIGHT. The player sees it as two stained-glass wedges in the
 * bottom corners beside the board (and a strip under the board on tall layouts), so:
 *   - seven glass lanes in the exact tetromino colours, left → right I O T S Z J L (= ROYGBIV:
 *     warm on the left, cool on the right, like the sky above them), luminance-normalised so
 *     yellow/green do not outshine blue/violet, brightest where the road is visible and calmer
 *     where it runs on behind the board,
 *   - pristine anti-aliased seams (energy-conserving: far seams fade to their true average),
 *     four dashed + two solid framing the centre, and bright spectral curbs,
 *   - a gate line in each ring's colour under every ring and a pool of its light on the glass,
 *     locked to ONE travel clock and the same ring id as the rings above,
 *   - lane-hued glitter near the camera (High and up) and a wet-glass fresnel sheen,
 *   - travelling light waves for gameplay events (chdWaves) that lift LINES, not the floor.
 *
 * Static geometry bent on the GPU by chdRoadCurve (no per-frame uploads); shaded in road space
 * via uv()/attributes, which the vertex bend does not touch. All fwidth() calls sit at the top
 * of the colour Fn (derivatives need uniform control flow).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    clamp,
    exp,
    float,
    floor,
    fract,
    fwidth,
    int,
    length,
    max,
    min,
    mix,
    normalize,
    positionLocal,
    positionWorld,
    pow,
    screenUV,
    sin,
    smoothstep,
    step,
    uniform,
    uniformArray,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    DASH_PERIOD,
    RAIL_PACKET_PERIOD,
    RING_SPACING,
    ROAD_HALF_WIDTH,
    ROAD_LENGTH,
    ROAD_NEAR_Z,
    TRAVEL_WRAP,
    TUNNEL_Z_NEAR,
    chdHash21,
    chdLineAA,
    chdRoadCurve,
    chdRoundBoxSdf,
    chdWaves,
} from './chromadelic-highway-tsl.js';

/** Tetromino colours in lane order, left → right: I O T S Z J L. */
export const LANE_COLORS_HEX = ['#ff1493', '#ff8c00', '#ffea00', '#00ff80', '#00f5ff', '#4d90fe', '#bf40ff'];

const LANE_COUNT = LANE_COLORS_HEX.length;
const LANE_WIDTH = (ROAD_HALF_WIDTH * 2) / LANE_COUNT;

const luma = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/** Glass tint law: tint = lane · (0.35 / luma)^0.6 (linear). */
export function laneTint(hex) {
    const c = new THREE.Color(hex);
    return c.multiplyScalar((0.35 / Math.max(luma(c), 0.15)) ** 0.6);
}

/** Seam core law: core = lane · clamp((0.6 / luma)^0.35, 0.85, 1.5) — every hue blooms alike. */
export function laneCore(hex) {
    const c = new THREE.Color(hex);
    return c.multiplyScalar(THREE.MathUtils.clamp((0.6 / Math.max(luma(c), 0.12)) ** 0.35, 0.85, 1.5));
}

/**
 * @param {object} opts
 * @param {number} [opts.segments=100]
 * @param {object} opts.shared  { uTime, uTravel, uPulse, uPace, uHaze, uRingPalette, uGateFar,
 *                                uRingFadeNear, waves }
 * @param {object} [opts.features] { dashes, sheen, glitter }
 */
export function createRoad({ segments = 100, shared, features = {} } = {}) {
    const {
        uTime, uTravel, uPulse, uHaze, uRingPalette, uGateFar, waves,
        uViewportPx, uCardRectPx, uCardRadiusPx, uApron,
    } = shared;
    const f = {
        dashes: true, sheen: true, glitter: true, ...features,
    };
    const uLaneTint = uniformArray(LANE_COLORS_HEX.map((h) => laneTint(h)), 'color');
    const uLaneCore = uniformArray(LANE_COLORS_HEX.map((h) => laneCore(h)), 'color');
    const uBrightness = uniform(1.0);
    const uGlassLift = uniform(0); // capped reactive lift of the floor (≤ 0.1)

    const geometry = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, ROAD_LENGTH, 1, segments);
    geometry.rotateX(-Math.PI / 2);
    // Lay the strip out once: x = ±100, y = 0, z from ROAD_NEAR_Z (near) to ROAD_NEAR_Z - LENGTH.
    const pos = geometry.attributes.position.array;
    for (let i = 0; i <= segments; i++) {
        const z = ROAD_NEAR_Z - (i / segments) * ROAD_LENGTH;
        pos[i * 6] = -ROAD_HALF_WIDTH;
        pos[i * 6 + 1] = 0;
        pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = ROAD_HALF_WIDTH;
        pos[i * 6 + 4] = 0;
        pos[i * 6 + 5] = z;
    }
    geometry.attributes.position.needsUpdate = true;
    // Row 0 (PlaneGeometry's far edge after rotateX) is laid at the NEAR end, which reverses the
    // winding: flip every triangle so the faces point up and FrontSide culling keeps the road.
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
        const b = index[i + 1];
        index[i + 1] = index[i + 2];
        index[i + 2] = b;
    }
    geometry.index.needsUpdate = true;
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    material.name = 'chromadelic-road';
    material.fog = false;
    material.positionNode = positionLocal.add(chdRoadCurve(positionLocal.z, uTime));

    material.colorNode = Fn(() => {
        const st = uv();
        const X = st.x.sub(0.5).mul(ROAD_HALF_WIDTH * 2); // -100 .. 100
        const s = float(1.0).sub(st.y).mul(ROAD_LENGTH); // 0 near → 2900 far
        const z = float(ROAD_NEAR_Z).sub(s);
        const dC = max(s.sub(120.0), 1.0); // ≈ distance from the camera along the road
        // Derivatives first, of the CONTINUOUS coordinates.
        const fwX = max(fwidth(X), 0.0001);
        const fwS = max(fwidth(s), 0.0001);

        // Lanes.
        const lanePos = X.add(ROAD_HALF_WIDTH).div(LANE_WIDTH); // 0 .. 7
        const laneIdx = clamp(floor(lanePos), 0.0, LANE_COUNT - 1);
        const tint = uLaneTint.element(int(laneIdx));
        const core = uLaneCore.element(int(laneIdx));

        // Card-anchored ramps (screen space, from the solver): brightest where the wedges meet
        // the card, calm behind it, and a dimmed launch apron under the board on tall layouts.
        const p = screenUV.mul(uViewportPx);
        const sdf = chdRoundBoxSdf(p, uCardRectPx, uCardRadiusPx);
        const prox = float(1.0).sub(smoothstep(0.0, uViewportPx.y.mul(0.3), sdf));
        const behind = float(1.0).sub(smoothstep(-24.0, 0.0, sdf));
        const apron = uApron.w.mul(float(1.0).sub(smoothstep(uApron.y.sub(24.0), uApron.y, abs(p.x.sub(uApron.x)))))
            .mul(step(uApron.z, p.y));
        const ramp = mix(float(0.9), float(1.5), prox).mul(mix(float(1.0), float(0.3), behind));

        // Seams at interior lane boundaries 1..6; 3 and 4 solid, the rest dashed and streaming.
        const seamIdx = floor(lanePos.add(0.5));
        const dSeam = lanePos.sub(seamIdx).mul(LANE_WIDTH);
        const interior = step(0.5, seamIdx).mul(step(seamIdx, LANE_COUNT - 0.5));
        let seamMul = float(1.0);
        if (f.dashes) {
            const solid = step(2.5, seamIdx).mul(step(seamIdx, 4.5));
            const dashPhase = fract(s.add(uTravel).div(DASH_PERIOD).add(seamIdx.mul(0.25)));
            const dash = float(1.0).sub(smoothstep(0.44, 0.56, dashPhase));
            const dashAA = mix(dash, 0.5, clamp(fwS.div(DASH_PERIOD).mul(3.0), 0.0, 1.0));
            // Solid centre pair, and solid seams on the apron under the board.
            seamMul = mix(dashAA.mul(0.7).add(0.3), float(1.0), max(solid, apron));
        }
        const seamLine = chdLineAA(dSeam, float(0.45), fwX).mul(interior).mul(seamMul).mul(mix(1.0, 0.4, apron));
        const seamSkirt = exp(abs(dSeam).div(1.8).negate()).mul(0.12).mul(interior);

        // Curbs: the brightest line on the road, just inside each edge.
        const curb = chdLineAA(abs(X).sub(98.0), float(1.2), fwX);

        // Gate lines under the rings. Same lattice AND the same ring id as the ring shader:
        // J = (TUNNEL_Z_NEAR + travel − zGate) / 350, slot = J mod 4.
        const g = float(TUNNEL_Z_NEAR).add(uTravel).sub(z).div(RING_SPACING);
        const gj = floor(g.add(0.5));
        const dG = gj.sub(g).mul(RING_SPACING); // = z − zGate: > 0 on the camera side of the gate
        const slot = gj.sub(floor(gj.mul(1.0 / 16.0)).mul(16.0)); // J mod 16: the ring palette entry
        const ringCol = uRingPalette.element(int(clamp(slot, 0.0, 15.0)));
        const zGate = z.sub(dG);
        const dGate = float(280.0).sub(zGate); // gate distance from the camera
        const gateLife = smoothstep(uGateFar, uGateFar.add(450.0), zGate)
            .mul(smoothstep(150.0, 330.0, dGate));

        // Wet-glass fresnel (dark at the bottom edge, glowing toward the horizon).
        const V = normalize(cameraPosition.sub(positionWorld));
        const F = float(0.04).add(float(0.96).mul(pow(float(1.0).sub(clamp(V.y, 0.0, 1.0)), 5.0)));

        const gate = chdLineAA(dG, float(0.9), fwS).mul(0.6);
        const pool = exp(max(dG, 0.0).div(65.0).negate()).mul(step(0.0, dG)).mul(F.mul(0.7).add(0.3))
            .mul(0.1);

        // Travelling event light (capped): lifts LINES, barely lifts the floor.
        const w = chdWaves(z, waves, core);
        const lineGain = float(1.0).add(w.amount.mul(3.0)).add(uPulse.mul(0.35));

        // Glass: stained by its lane, calmer at the centre, brightest where the wedges meet the
        // board, near-black behind it (only a sliver shows through the translucent card).
        const glassK = mix(mix(float(0.08), float(0.14), prox), float(0.03), behind);
        const centreDamp = mix(0.55, 1.0, smoothstep(20.0, 70.0, abs(X)));
        const body = vec3(0.0021, 0.0012, 0.0044).add(tint.mul(glassK).mul(centreDamp).mul(mix(1.0, 0.5, apron)));

        const col = body
            .add(core.mul(seamLine).mul(ramp).mul(lineGain))
            .add(tint.mul(seamSkirt))
            .add(core.mul(curb).mul(ramp).mul(1.15).mul(lineGain))
            .add(ringCol.mul(gate.add(pool)).mul(gateLife))
            .add(w.color.mul(0.2).add(core.mul(uGlassLift)))
            .toVar();
        if (f.sheen) {
            col.addAssign(F.mul(0.3).mul(mix(vec3(0.023, 0.007, 0.08), tint.mul(0.35), 0.3))
                .mul(mix(1.0, 0.3, behind)));
        }
        if (f.glitter) {
            // Pixel-round glints (cell offsets divided by the pixel footprint), only where a
            // cell spans enough pixels not to shimmer; lane-hued, not prismatic.
            const cellCoord = vec2(X, s.add(uTravel)).div(8.0);
            const cellRaw = floor(cellCoord);
            // Hash the row modulo the travel wrap (TRAVEL_WRAP / 8 rows) so the glints do not
            // re-randomise when uTravel wraps.
            const cell = vec2(cellRaw.x, cellRaw.y.sub(floor(cellRaw.y.div(TRAVEL_WRAP / 8)).mul(TRAVEL_WRAP / 8)));
            const h = chdHash21(cell);
            const h2 = chdHash21(cell.add(vec2(17.0, 3.0)));
            const h3 = chdHash21(cell.add(vec2(5.0, 29.0)));
            const pW = fract(cellCoord).sub(0.5).sub(vec2(h2, h3).sub(0.5).mul(0.6)).mul(8.0);
            const pp = pW.div(vec2(fwX, fwS));
            const glintShape = exp(pp.x.mul(pp.x).add(pp.y.mul(pp.y)).div(1.96).negate());
            const twinkle = pow(sin(uTime.mul(h2.mul(5.0).add(3.0)).add(h3.mul(40.0))).mul(0.5).add(0.5), 6.0);
            const glitterFade = smoothstep(6.0, 14.0, float(8.0).div(fwS));
            const glitter = step(0.88, h).mul(glintShape).mul(twinkle).mul(glitterFade);
            col.addAssign(mix(core, vec3(1.0), 0.35).mul(glitter).mul(1.2));
        }

        const hazeT = smoothstep(1500.0, 2750.0, dC);
        return vec4(min(mix(col.mul(uBrightness), uHaze, hazeT), vec3(8.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-road';
    mesh.frustumCulled = false; // bent on the GPU beyond its static bounds
    mesh.renderOrder = -10;

    return {
        mesh,
        material,
        uniforms: {
            uLaneTint, uLaneCore, uBrightness, uGlassLift,
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * Two neon light-curtain rails in ONE draw: a vertical ribbon per road edge, bent by the road
 * curve, with a pixel-floored white-hot base tube, a soft glow wall above it, packets racing
 * toward the camera on the shared travel clock, and event waves running along them. The rails
 * are the leading lines from the bottom corners into the board: pink (I) left, violet (L) right.
 * DoubleSide + forceSinglePass: the right curtain faces away from the camera.
 */
export function createRails({
    segments = 100, height = 9, offset = 106, shared, features = {},
} = {}) {
    const {
        uTime, uTravel, uPulse, uHaze, uRailTick, waves,
    } = shared;
    const f = { curtain: true, ...features };
    const uLeftColor = uniform(laneCore(LANE_COLORS_HEX[0]));
    const uRightColor = uniform(laneCore(LANE_COLORS_HEX[LANE_COUNT - 1]));
    const uIntensity = uniform(1.0);

    const verts = [];
    const aSide = [];
    const aAlong = [];
    const aH = [];
    const idx = [];
    // The tube sits on the curtain's bottom edge: extend the ribbon 3 units below the road so
    // the tube's anti-aliased falloff stays inside the polygon (no MSAA needed).
    const bottom = -3;
    for (let side = 0; side < 2; side++) {
        const x = side === 0 ? -offset : offset;
        const base = verts.length / 3;
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const z = ROAD_NEAR_Z - t * ROAD_LENGTH;
            verts.push(x, bottom, z, x, height, z);
            aSide.push(side, side);
            aAlong.push(t, t);
            aH.push(bottom, height);
        }
        for (let i = 0; i < segments; i++) {
            const a = base + i * 2;
            idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 1));
    geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(aAlong, 1));
    geometry.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
    geometry.setIndex(idx);

    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    material.name = 'chromadelic-rails';
    material.fog = false;
    material.forceSinglePass = true;
    material.positionNode = positionLocal.add(chdRoadCurve(positionLocal.z, uTime));

    material.colorNode = Fn(() => {
        // Road-space coordinates from the static attributes (the vertex bend does not touch them).
        const sideN = attribute('aSide', 'float');
        const s = attribute('aAlong', 'float').mul(ROAD_LENGTH); // 0 near → 2900 far
        const hW = attribute('aH', 'float'); // height above the road, world units
        const fwH = max(fwidth(hW), 0.0001);
        const z = float(ROAD_NEAR_Z).sub(s);
        const dC = max(s.sub(120.0), 1.0);
        const base = mix(uLeftColor, uRightColor, sideN);
        const aHn = clamp(hW.div(height), 0.0, 1.0);

        // Pixel-floored hot base tube (peak 1.6 × the seam core ≈ 2.2) + a soft wall above it.
        const tube = chdLineAA(hW.sub(0.45), float(0.45), fwH).mul(1.6).add(exp(abs(hW).div(1.2).negate()).mul(0.25));
        let energy = tube;
        if (f.curtain) {
            const curtain = pow(float(1.0).sub(aHn), 2.6).mul(0.35).mul(step(0.0, hW));
            // Packets racing toward the camera (1.6x travel keeps the wrap seamless).
            const packetPhase = fract(s.add(uTravel.mul(1.6)).div(RAIL_PACKET_PERIOD)).sub(0.5).mul(RAIL_PACKET_PERIOD);
            const packets = exp(packetPhase.mul(packetPhase).mul(-0.004)).mul(0.9);
            energy = tube.add(curtain).mul(float(1.0).add(packets));
        }
        const w = chdWaves(z, waves, base);
        const camDist = length(positionWorld.sub(cameraPosition));
        const nearFade = smoothstep(60.0, 180.0, camDist);
        const farFade = float(1.0).sub(smoothstep(1500.0, 2750.0, dC));
        const e = energy
            .mul(float(1.0).add(w.amount.mul(2.5)))
            .mul(float(1.0).add(uPulse.mul(0.5)).add(uRailTick.mul(0.4)))
            .mul(nearFade)
            .mul(uIntensity);
        const waveHue = w.color.div(max(w.amount, 0.001));
        const hot = mix(mix(base, waveHue, min(w.amount, 1.0).mul(0.6)), vec3(1.0), tube.mul(0.12).min(0.3));
        const col = mix(uHaze.mul(0.25).mul(e), hot.mul(e), farFade);
        // Premultiplied additive: alpha 1 so (SrcAlpha, One) adds the colour exactly once.
        return vec4(min(col, vec3(8.0)), 1.0);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-rails';
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;

    return {
        mesh,
        material,
        uniforms: { uLeftColor, uRightColor, uIntensity },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
