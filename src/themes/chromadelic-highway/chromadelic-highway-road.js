/**
 * Chromadelic Highway — the liquid prism-glass rainbow road and its dual neon rails.
 *
 * A jewel-like prism-glass cosmic viaduct drawn in light:
 *   - Seven stained-glass lanes in the exact tetromino colours (I O T S Z J L = ROYGBIV),
 *     luminance-normalised with deep recessed glass centers, glowing refracted edge bevels,
 *     subtle flowing iridescent prism harmonics and crisp high-speed racing chevrons/dashes.
 *   - True wet-glass specular reflections of every arching neon ring overhead (both intense
 *     outer-flank pools where the cantilever pylons seat AND elongated mirror reflections
 *     shimmering down the center glass).
 *   - Clean board-aware calm zone gated strictly by `uBoardActive`: zero ghost dark rectangle
 *     in menus, transitions or no-board captures, and a soft smoothstep apron transition!
 *   - Seamless luminous horizon dissolve into the glowing cosmic core (no cardboard cut-off).
 *   - Distinct event responses on the glass: single-lane lock ignition ripple, hard-drop
 *     compression chevron slam, diagonal twist shear-wave, liquid-gold B2B curb gilding,
 *     and full-spectrum Fever iridescence.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
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
    sqrt,
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
    chdNeonColor,
    chdRoadCurve,
    chdRoundBoxSdf,
    chdWaves,
} from './chromadelic-highway-tsl.js';

/** Tetromino colours in lane order, left → right: I O T S Z J L. */
export const LANE_COLORS_HEX = ['#ff1493', '#ff8c00', '#ffea00', '#00ff80', '#00f5ff', '#4d90fe', '#bf40ff'];

const LANE_COUNT = LANE_COLORS_HEX.length;
const LANE_WIDTH = (ROAD_HALF_WIDTH * 2) / LANE_COUNT;
const GOLD_COL = vec3(1.0, 0.84, 0.44);

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
 * @param {object} opts.shared
 * @param {object} [opts.features] { dashes, sheen, glitter }
 */
export function createRoad({ segments = 100, shared, features = {} } = {}) {
    const {
        uTime,
        uTravel,
        uPulse,
        uHaze,
        uRingPalette,
        uGateFar,
        waves,
        uViewportPx,
        uCardRectPx,
        uCardRadiusPx,
        uApron,
        uDEmerge,
    } = shared;
    const uBoardActive = shared.uBoardActive ?? uniform(0);
    const uRoadSheen = shared.uRoadSheen ?? uniform(1.0);
    const uGoldGild = shared.uGoldGild ?? uniform(0.0);
    const uFeverGlow = shared.uFeverGlow ?? uniform(0.0);
    // (laneIndex 0..6, energy, zFront, hardDropBoost) for tactile piece-lock / hard-drop ripples.
    const uLanePulse = shared.uLanePulse ?? uniform(new THREE.Vector4(3, 0, -500, 0));
    // (age, energy, sign, 0) for diagonal Twist glass shear wave.
    const uTwistGlass = shared.uTwistGlass ?? uniform(new THREE.Vector4(10, 0, 1, 0));
    // (zFront, energy, 0, 0) for Hard Drop compression shock-chevron across all lanes.
    const uSlamWave = shared.uSlamWave ?? uniform(new THREE.Vector4(-5000, 0, 0, 0));

    const f = {
        dashes: true, sheen: true, glitter: true, ...features,
    };
    const uLaneTint = uniformArray(LANE_COLORS_HEX.map((h) => laneTint(h)), 'color');
    const uLaneCore = uniformArray(LANE_COLORS_HEX.map((h) => laneCore(h)), 'color');
    const uBrightness = uniform(1.0);
    const uGlassLift = uniform(0);
    const uPoolGain = uniform(0.24);

    const geometry = new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, ROAD_LENGTH, 1, segments);
    geometry.rotateX(-Math.PI / 2);
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
    const index = geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
        const b = index[i + 1];
        index[i + 1] = index[i + 2];
        index[i + 2] = b;
    }
    geometry.index.needsUpdate = true;
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.FrontSide,
        transparent: true,
        depthWrite: false,
    });
    material.name = 'chromadelic-road';
    material.fog = false;
    material.positionNode = positionLocal.add(chdRoadCurve(positionLocal.z, uTime));

    material.colorNode = Fn(() => {
        const st = uv();
        const X = st.x.sub(0.5).mul(ROAD_HALF_WIDTH * 2); // -100 .. 100
        const s = float(1.0).sub(st.y).mul(ROAD_LENGTH); // 0 near -> 2900 far
        const z = float(ROAD_NEAR_Z).sub(s);
        const dC = max(s.sub(120.0), 1.0);
        // Derivatives first, of continuous coordinates.
        const fwX = max(fwidth(X), 0.0001);
        const fwS = max(fwidth(s), 0.0001);

        // Lanes + position inside each lane (0 at lane center -> 1 at lane edge).
        const lanePos = X.add(ROAD_HALF_WIDTH).div(LANE_WIDTH); // 0 .. 7
        const laneIdx = clamp(floor(lanePos), 0.0, LANE_COUNT - 1);
        const inLane = abs(fract(lanePos).sub(0.5)).mul(2.0); // 0 center -> 1 edge
        const tint = uLaneTint.element(int(laneIdx));
        const core = uLaneCore.element(int(laneIdx));

        // Board-aware screen ramps: purely smooth radial SDF around the rounded card — ZERO horizontal
        // apron shelf on any aspect ratio (16:9, ultrawide, or portrait phone)!
        const p = screenUV.mul(uViewportPx);
        const sdf = chdRoundBoxSdf(p, uCardRectPx, uCardRadiusPx);
        const prox = float(1.0).sub(smoothstep(0.0, uViewportPx.y.mul(0.32), sdf)).mul(uBoardActive);
        const behind = float(1.0).sub(smoothstep(-28.0, 2.0, sdf)).mul(uBoardActive);
        const apron = uApron.w.mul(uBoardActive)
            .mul(float(1.0).sub(smoothstep(0.0, uViewportPx.y.mul(0.09), sdf)))
            .mul(smoothstep(uApron.z.sub(60.0), uApron.z.add(60.0), p.y))
            .mul(0.35);
        const ramp = mix(float(1.05), float(1.52), prox).mul(mix(float(1.0), float(0.28), behind));

        // Seams at interior lane boundaries 1..6; 3 and 4 solid framing the center, outer lanes dashed.
        const seamIdx = floor(lanePos.add(0.5));
        const dSeam = lanePos.sub(seamIdx).mul(LANE_WIDTH);
        const interior = step(0.5, seamIdx).mul(step(seamIdx, LANE_COUNT - 0.5));
        let seamMul = float(1.0);
        let paneLight = float(1.0);
        let join = float(0.0);
        let cut = float(0.0);
        let facet = float(0.0);
        if (f.dashes) {
            const solid = step(2.5, seamIdx).mul(step(seamIdx, 4.5));
            const dashCoord = s.add(uTravel).div(DASH_PERIOD);
            const dashPhase = fract(dashCoord.add(seamIdx.mul(0.2)));
            const dash = smoothstep(0.03, 0.08, dashPhase).mul(float(1.0).sub(smoothstep(0.52, 0.62, dashPhase)));
            const dashAA = mix(dash, 0.52, clamp(fwS.div(DASH_PERIOD).mul(2.8), 0.0, 1.0));
            // Crisp higher-contrast streaming dashes for immediate velocity perception!
            seamMul = mix(dashAA.mul(0.84).add(0.16), float(1.0), max(solid, apron));

            // Cut-glass slabs. Stagger the joints across lanes so they describe the road's
            // travel without laying another bright horizontal bar across the highway.
            const across = fract(lanePos).sub(0.5).mul(LANE_WIDTH);
            const panePeriod = 84; // 1,000 panels per travel wrap
            const slant = sin(laneIdx.mul(2.2).add(0.8)).mul(0.65);
            const panePhase = s.add(uTravel).add(laneIdx.mul(31)).add(across.mul(slant)).div(panePeriod);
            const pane = fract(panePhase.add(0.5)).sub(0.5).mul(panePeriod);
            const footprint = fwS.add(fwX.mul(abs(slant)));
            const resolved = float(1).sub(smoothstep(4, 15, footprint));
            const tile = floor(panePhase.add(0.5));
            const tileID = tile.sub(floor(tile.div(1000)).mul(1000));
            const tone = chdHash21(vec2(laneIdx.add(11), tileID.add(7)));
            paneLight = mix(float(1), tone.mul(0.32).add(0.87), resolved);
            join = chdLineAA(pane, float(0.58), footprint).mul(resolved);
            cut = chdLineAA(pane.sub(1.15), float(0.32), footprint).mul(resolved);
            // Only the angled terminal edge of each slab catches a second, finer bevel.
            const corner = abs(across).sub(12).mul(1.3).add(pane)
                .sub(2);
            facet = chdLineAA(corner, float(0.36), footprint.add(fwX))
                .mul(smoothstep(7, 13.5, abs(across))).mul(resolved);
        }
        const seamLine = chdLineAA(dSeam, float(0.48), fwX).mul(interior).mul(seamMul).mul(mix(1.0, 0.45, apron));
        const seamSkirt = exp(abs(dSeam).div(2.2).negate()).mul(0.16).mul(interior);

        // Curbs: razor-bright spectral neon rails (gilded liquid-gold on Back-to-Back!).
        const curb = chdLineAA(abs(X).sub(98.0), float(1.35), fwX);
        const innerCurb = chdLineAA(abs(X).sub(93.5), float(0.35), fwX).mul(0.55);

        // Overhead neon arch gate lines + wet-glass perspective specular reflection!
        const g = float(TUNNEL_Z_NEAR).add(uTravel).sub(z).div(RING_SPACING);
        const gj = floor(g.add(0.5));
        const dG = gj.sub(g).mul(RING_SPACING); // > 0 on the camera side of the ring gate
        const slot = gj.sub(floor(gj.mul(1.0 / 16.0)).mul(16.0));
        const ringCol = uRingPalette.element(int(clamp(slot, 0.0, 15.0)));
        const zGate = z.sub(dG);
        const dGate = float(280.0).sub(zGate);
        const gateLife = smoothstep(uGateFar, uGateFar.add(450.0), zGate)
            .mul(smoothstep(140.0, 310.0, dGate))
            .mul(smoothstep(uDEmerge.add(250.0), uDEmerge, dGate));

        // Wet-glass Fresnel (glossy specular reflection grows toward grazing horizon angles).
        const V = normalize(cameraPosition.sub(positionWorld));
        const F = float(0.05).add(float(0.95).mul(pow(float(1.0).sub(clamp(V.y, 0.0, 1.0)), 4.6))).toVar();

        const gate = chdLineAA(dG, float(0.75), fwS).mul(0.16);
        // Perspective mirror reflection of the arching neon ring on wet prism glass:
        //   - strong flank glow near the curbs where the ring cantilevers meet the road
        //   - elongated central specular streak mirroring the glowing arch crown!
        const flankReflect = smoothstep(45.0, 98.0, abs(X)).mul(0.65).add(0.35);
        const crownStreak = exp(X.div(46.0).pow2().negate()).mul(0.55);
        const glassRipple = sin(s.mul(0.055).add(X.mul(0.08)).sub(uTime.mul(1.4))).mul(0.08).add(0.92);
        const poolDecay = mix(float(46.0), float(138.0), step(0.0, dG));
        const pool = exp(abs(dG).div(poolDecay).negate())
            .mul(F.mul(0.75).add(0.25))
            .mul(flankReflect.add(crownStreak))
            .mul(glassRipple)
            .mul(uPoolGain)
            .mul(uRoadSheen);

        // Travelling event waves + distinct tactile event signatures on the glass!
        const w = chdWaves(z, waves, core);
        const lineGain = float(1.0).add(w.amount.mul(3.1)).add(uPulse.mul(0.38));

        // 1. Single-lane tactile ignition ripple (PIECE_LOCK) — illuminates the matched prism glass lane!
        const laneHit = exp(laneIdx.sub(uLanePulse.x).div(0.55).pow2().negate());
        const dLaneZ = z.sub(uLanePulse.z).div(155.0);
        const laneHead = exp(z.sub(uLanePulse.z).div(38.0).pow2().negate());
        const laneRipple = laneHit.mul(exp(dLaneZ.mul(dLaneZ).negate()).mul(0.85).add(laneHead.mul(0.95))).mul(uLanePulse.y);

        // 2. Hard Drop V-chevron compression shockwave snapping forward down all 7 rainbow lanes!
        const slamZ = z.sub(uSlamWave.x).add(abs(X).mul(0.75)).div(38.0);
        const slamTrail = z.sub(uSlamWave.x).add(abs(X).mul(0.75)).div(135.0);
        const slamBand = exp(slamZ.mul(slamZ).negate()).mul(1.35)
            .add(exp(slamTrail.mul(slamTrail).negate()).mul(0.45))
            .mul(uSlamWave.y);

        // 3. Twist diagonal prismatic shear wave across the stained-glass lanes!
        const twistPhase = z.mul(0.022).add(X.mul(0.045).mul(uTwistGlass.z)).add(uTwistGlass.x.mul(11.0));
        const twistRipple = pow(sin(twistPhase).mul(0.5).add(0.5), 4.0).mul(uTwistGlass.y)
            .mul(smoothstep(1800.0, 220.0, dC));

        // Liquid prism-glass body: deeper rich dark-glass center trough + jewel-bright inner edge bevels
        // + subtle longitudinal harmonic energy pulse that wakes up during Fever!
        const glassK = mix(mix(float(0.095), float(0.165), prox), float(0.028), behind);
        const edgeBevel = pow(inLane, 3.2).mul(0.50).add(0.56);
        const flowWave = sin(s.mul(0.014).add(uTravel.mul(0.014)).add(laneIdx.mul(0.95))).mul(0.14).add(0.86);
        const centreDamp = mix(0.68, 1.0, smoothstep(18.0, 66.0, abs(X)));
        const laneColor = mix(
            tint,
            chdNeonColor(fract(lanePos.div(7.0).add(s.mul(0.0007)).sub(uTime.mul(0.18))), float(0.45)),
            uFeverGlow.mul(0.35),
        );
        const body = vec3(0.0018, 0.0011, 0.0046)
            .add(laneColor.mul(glassK).mul(1.25).mul(edgeBevel).mul(flowWave)
                .mul(centreDamp)
                .mul(paneLight)
                .mul(float(1).sub(join.mul(0.76)))
                .mul(mix(1.0, 0.55, apron)));

        const curbCol = mix(core, GOLD_COL, clamp(uGoldGild, 0.0, 0.92));
        const seamCol = mix(core, GOLD_COL, clamp(uGoldGild.mul(0.55), 0.0, 0.6));

        const col = body
            .add(seamCol.mul(seamLine).mul(ramp).mul(lineGain))
            .add(tint.mul(seamSkirt))
            .add(mix(tint, core, 0.35).mul(cut.mul(0.13).add(facet.mul(0.25))).mul(ramp))
            .add(curbCol.mul(curb.add(innerCurb)).mul(ramp).mul(1.22).mul(lineGain))
            .add(ringCol.mul(gate.add(pool)).mul(gateLife))
            .add(w.color.mul(0.24).add(core.mul(uGlassLift)))
            .add(mix(core, vec3(1.0), 0.45).mul(laneRipple).mul(1.15))
            .add(mix(vec3(1.0, 0.96, 0.90), core, 0.32).mul(slamBand).mul(1.65))
            .add(vec3(1.0, 0.92, 0.2).mul(twistRipple).mul(0.62))
            .toVar();

        if (f.sheen) {
            // Wet-glass sky reflection + glossy center mirror highlight.
            const sheenTint = mix(vec3(0.026, 0.009, 0.095), tint.mul(0.42), 0.36);
            col.addAssign(F.mul(0.36).mul(uRoadSheen).mul(sheenTint).mul(mix(1.0, 0.25, behind)));
        }
        if (f.glitter) {
            // Reflect the camera ray about the deck. Its exit from the arch cylinder
            // selects ONE real gate on the travelling lattice. Sample that gate at its
            // own Z and road bend, including its polygonal outline and spectrum slot.
            const slope = vec2(V.x.negate(), max(V.y, 0.001)).div(max(V.z, 0.02)).toVar();
            const crossSection = vec2(X, -25);
            const a = max(dot(slope, slope), 0.0001);
            const b = dot(crossSection, slope);
            const c = dot(crossSection, crossSection).sub(260 * 260);
            const reach = sqrt(max(b.mul(b).sub(a.mul(c)), 0)).sub(b).div(a);
            const mirrorID = floor(float(TUNNEL_Z_NEAR).add(uTravel).sub(z).add(reach)
                .div(RING_SPACING)
                .add(0.5));
            const mirrorZ = float(TUNNEL_Z_NEAR).add(uTravel).sub(mirrorID.mul(RING_SPACING)).toVar();
            const mirrorSlot = int(mirrorID.sub(floor(mirrorID.div(16)).mul(16)));
            const center = chdRoadCurve(mirrorZ, uTime);
            const hit = positionWorld.xy.add(slope.mul(z.sub(mirrorZ))).sub(center.xy).sub(vec2(0, 25)).toVar();
            const theta = atan(hit.y, hit.x);
            const sides = shared.uRingForm.element(mirrorSlot).x;
            const half = float(Math.PI).div(max(sides, 3));
            const local = fract(theta.sub(Math.PI / 2).add(half).div(half.mul(2))).sub(0.5).mul(half.mul(2));
            const apothem = cos(half);
            const radius = mix(float(260), apothem.mul(520).div(cos(local).mul(apothem.add(1))), step(2.5, sides));
            // Each pane refracts its copy a little differently at its bevel, breaking up
            // what would otherwise read as a second, perfectly sharp arch floating below.
            const refract = paneLight.sub(1).mul(7).add(pow(inLane, 3).mul(1.9));
            const arcDistance = abs(length(hit).sub(radius).add(refract));
            // A wider colored shoulder underlies a fine mirror line. Attenuate unresolved
            // reflections and separate individual panes with their cool leaded joints.
            const shoulder = float(1).sub(smoothstep(2, 16, arcDistance));
            const line = float(1).sub(smoothstep(0.7, 5.2, arcDistance));
            const sourceDepth = cameraPosition.z.sub(mirrorZ);
            const visible = smoothstep(145, 325, sourceDepth)
                .mul(float(1).sub(smoothstep(uDEmerge.sub(40), uDEmerge.add(420), sourceDepth)))
                .mul(smoothstep(uGateFar, uGateFar.add(190), mirrorZ))
                .mul(float(1).sub(smoothstep(1.7, 7, fwS)))
                .mul(float(1).sub(behind.mul(0.88)));
            const glow = shared.uRingGlow.element(mirrorSlot);
            const arcFraction = theta.add(Math.PI / 9).div((11 * Math.PI) / 9);
            const prism = chdNeonColor(fract(glow.w).add(arcFraction.mul(0.88)), float(0.52));
            const reflectedHue = mix(uRingPalette.element(mirrorSlot), prism, step(0.5, glow.w));
            const mirrored = mix(reflectedHue, GOLD_COL, clamp(uGoldGild.mul(0.75), 0, 0.85));
            const paneReflectance = paneLight.sub(0.87).mul(1.62).add(0.62);
            const silvering = F.mul(0.6).add(0.34).mul(paneReflectance).mul(float(1).sub(join.mul(0.82)));
            col.addAssign(mirrored.mul(shoulder.mul(0.22).add(line.mul(0.44))).mul(silvering)
                .mul(uRoadSheen).mul(visible));

            // Crisp diamond micro-glints skimming across the wet glass at grazing angles.
            const cellCoord = vec2(X, s.add(uTravel)).div(6.5);
            const cellRaw = floor(cellCoord);
            const cell = vec2(cellRaw.x, cellRaw.y.sub(floor(cellRaw.y.div(TRAVEL_WRAP / 6.5)).mul(TRAVEL_WRAP / 6.5)));
            const h = chdHash21(cell);
            const h2 = chdHash21(cell.add(vec2(17.0, 3.0)));
            const h3 = chdHash21(cell.add(vec2(5.0, 29.0)));
            const pW = fract(cellCoord).sub(0.5).sub(vec2(h2, h3).sub(0.5).mul(0.64)).mul(6.5);
            const pp = pW.div(vec2(fwX, fwS));
            const glintShape = exp(pp.x.mul(pp.x).add(pp.y.mul(pp.y)).div(1.75).negate());
            const twinkle = pow(sin(uTime.mul(h2.mul(6.0).add(3.5)).add(h3.mul(40.0))).mul(0.5).add(0.5), 7.0);
            const glitterFade = smoothstep(5.5, 13.0, float(6.5).div(fwS));
            const glitter = step(0.84, h).mul(glintShape).mul(twinkle).mul(glitterFade)
                .mul(F.mul(0.75).add(0.25));
            col.addAssign(mix(core, vec3(1.0), 0.48).mul(glitter).mul(1.35));
        }

        // Seamless infinite horizon dissolve: smoothly melts both color AND alpha into cosmic light
        // before the far curve tip so there is NEVER a dark road tail or flat cutoff!
        const hazeT = smoothstep(950.0, 2150.0, dC);
        const alphaDissolve = float(1.0).sub(smoothstep(1050.0, 2280.0, dC));
        const endCol = mix(col.mul(uBrightness), uHaze.mul(0.92), hazeT.mul(0.62));
        return vec4(min(endCol, vec3(8.0)), alphaDissolve);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'chromadelic-road';
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    return {
        mesh,
        material,
        uniforms: {
            uLaneTint, uLaneCore, uBrightness, uGlassLift, uPoolGain,
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}

/**
 * Dual-layered holographic neon light-curtain rails in ONE draw call:
 *   - white-hot pixel-floored primary base tube
 *   - soft vertical plasma curtain wall
 *   - sleek upper harmonic energy guide-wire hovering above the rail
 *   - blazing packets racing relentlessly toward the camera on the shared travel clock
 *   - liquid-gold gilding on B2B and rainbow spectrum flow in Fever/Perfect Clear.
 */
export function createRails({
    segments = 100, height = 13, offset = 105, shared, features = {},
} = {}) {
    const {
        uTime, uTravel, uPulse, uHaze, uRailTick, waves,
    } = shared;
    const uGoldGild = shared.uGoldGild ?? uniform(0);
    const uFeverGlow = shared.uFeverGlow ?? uniform(0);
    const f = { curtain: true, ...features };
    const uLeftColor = uniform(laneCore(LANE_COLORS_HEX[0]));
    const uRightColor = uniform(laneCore(LANE_COLORS_HEX[LANE_COUNT - 1]));
    const uIntensity = uniform(1.0);

    const verts = [];
    const aSide = [];
    const aAlong = [];
    const aH = [];
    const idx = [];
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
        const sideN = attribute('aSide', 'float');
        const s = attribute('aAlong', 'float').mul(ROAD_LENGTH);
        const hW = attribute('aH', 'float');
        const fwH = max(fwidth(hW), 0.0001);
        const z = float(ROAD_NEAR_Z).sub(s);
        const dC = max(s.sub(120.0), 1.0);
        const sideBase = mix(uLeftColor, uRightColor, sideN);
        const feverSpec = chdNeonColor(fract(s.mul(0.0011).sub(uTime.mul(0.28)).add(sideN.mul(0.5))), float(0.55));
        const base = mix(mix(sideBase, feverSpec, uFeverGlow.mul(0.75)), GOLD_COL, clamp(uGoldGild, 0.0, 0.92));
        const aHn = clamp(hW.div(height), 0.0, 1.0);

        // Primary blazing base tube + sleek upper harmonic ribbon floating at y = 8.2.
        const tube = chdLineAA(hW.sub(0.5), float(0.48), fwH).mul(1.75)
            .add(exp(abs(hW.sub(0.4)).div(1.3).negate()).mul(0.28));
        const upperWire = chdLineAA(hW.sub(8.2), float(0.22), fwH).mul(0.58)
            .mul(float(0.65).add(uPulse.mul(0.5)).add(uFeverGlow.mul(0.65)));

        let energy = tube.add(upperWire);
        if (f.curtain) {
            const curtain = pow(float(1.0).sub(aHn), 2.7).mul(0.32).mul(step(0.0, hW));
            const packetPhase = fract(s.add(uTravel.mul(1.6)).div(RAIL_PACKET_PERIOD)).sub(0.5).mul(RAIL_PACKET_PERIOD);
            const packets = exp(packetPhase.mul(packetPhase).mul(-0.0045)).mul(1.15);
            // Counter-phase high-speed harmonic micro-beads along the upper wire.
            const microPhase = fract(s.add(uTravel.mul(2.4)).div(140.0)).sub(0.5).mul(140.0);
            const microBead = exp(microPhase.mul(microPhase).mul(-0.015)).mul(0.85);
            energy = tube.add(curtain).mul(float(1.0).add(packets))
                .add(upperWire.mul(float(1.0).add(microBead)));
        }
        const w = chdWaves(z, waves, base);
        const camDist = length(positionWorld.sub(cameraPosition));
        const nearFade = smoothstep(55.0, 175.0, camDist);
        const farFade = float(1.0).sub(smoothstep(1380.0, 2680.0, dC));
        const e = energy
            .mul(float(1.0).add(w.amount.mul(2.6)))
            .mul(float(1.0).add(uPulse.mul(0.52)).add(uRailTick.mul(0.5)))
            .mul(nearFade)
            .mul(uIntensity);
        const waveHue = w.color.div(max(w.amount, 0.001));
        const hot = mix(mix(base, waveHue, min(w.amount, 1.0).mul(0.6)), vec3(1.0), tube.mul(0.14).min(0.34));
        const col = mix(uHaze.mul(0.22).mul(e), hot.mul(e), farFade);
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
