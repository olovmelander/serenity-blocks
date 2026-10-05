import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    uniform,
    uniformTexture,
    varying,
    positionLocal,
    positionWorld,
    normalWorld,
    positionView,
    uv,
    vertexColor,
    vec2,
    vec3,
    vec4,
    float,
    sin,
    fract,
    floor,
    abs,
    dot,
    length,
    mix,
    smoothstep,
    pow,
    exp,
    step,
    clamp,
    max,
    mod,
    normalize,
    time,
    texture,
    normalMap,
    screenUV,
    positionViewDirection,
    normalView,
    frontFacing,
    fwidth,
    cameraViewMatrix,
} from 'three/tsl';

const hash2D = /* @__PURE__ */ Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)))
    .setLayout({
        name: 'neonDistrictHash2D', type: 'float', inputs: [{ name: 'p', type: 'vec2' }],
    });

const noise2D = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    const a = hash2D(i);
    const b = hash2D(i.add(vec2(1.0, 0.0)));
    const c = hash2D(i.add(vec2(0.0, 1.0)));
    const d = hash2D(i.add(vec2(1.0, 1.0)));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'neonDistrictNoise2D', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const rand2D = /* @__PURE__ */ Fn(([p]) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453123)))
    .setLayout({
        name: 'neonDistrictRand2D', type: 'float', inputs: [{ name: 'p', type: 'vec2' }],
    });

// 4-octave Fractal Brownian Motion for organic puddle distribution
const fbm4 = /* @__PURE__ */ Fn(([p]) => {
    let noise = noise2D(p);
    noise = noise.add(noise2D(p.mul(2.0).add(vec2(17.0))).mul(0.5));
    noise = noise.add(noise2D(p.mul(4.0).add(vec2(31.0))).mul(0.25));
    noise = noise.add(noise2D(p.mul(8.0).add(vec2(53.0))).mul(0.125));
    // Normalize: sum of weights = 1 + 0.5 + 0.25 + 0.125 = 1.875
    return noise.div(1.875);
}).setLayout({ name: 'neonDistrictFbm4', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export function createSkyNodeMaterial() {
    const material = new THREE.MeshBasicNodeMaterial();
    const direction = normalize(positionWorld);
    const height = direction.y;
    const horizon = float(1.0).sub(smoothstep(-0.05, 0.46, height));
    const zenith = mix(vec3(0.021, 0.018, 0.064), vec3(0.002, 0.006, 0.023), smoothstep(0.05, 0.85, height));
    const cityBank = sin(direction.x.mul(3.2).add(direction.z.mul(1.6))).mul(0.5).add(0.5);
    const cityGlow = mix(vec3(0.015, 0.12, 0.18), vec3(0.23, 0.018, 0.093), cityBank);
    const cloudCoord = direction.xz.mul(4.0).add(vec2(time.mul(0.008), time.mul(-0.004)));
    const smog = noise2D(cloudCoord).mul(0.7).add(noise2D(cloudCoord.mul(2.1).add(7.3)).mul(0.3));
    const cloudBand = smoothstep(0.34, 0.72, smog).mul(float(1.0).sub(smoothstep(0.12, 0.62, height)));
    material.colorNode = zenith.add(cityGlow.mul(horizon.mul(0.65).add(cloudBand.mul(0.2))))
        .add(vec3(0.014, 0.019, 0.038).mul(cloudBand));
    material.emissiveNode = vec3(0.0);
    material.side = THREE.BackSide;
    return { material };
}

export function createStarfieldNodeMaterial() {
    const uTime = uniform(0);
    const uPixelRatio = uniform(1);

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle');
    const aBrightness = attribute('aBrightness');

    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x));
    const brightness = aBrightness.mul(twinkle.mul(0.35).add(0.65));

    const sizeNode = clamp(
        aSize.mul(uPixelRatio).mul(float(200.0).div(positionView.z.negate())),
        2.0,
        50.0,
    );

    const material = new THREE.PointsNodeMaterial();
    material.sizeNode = sizeNode;

    const finalColor = vertexColor().mul(brightness.mul(1.2));
    const alpha = clamp(brightness.add(0.15), 0.0, 1.0);
    // Use separate color and opacity to avoid vec4() TSL issues
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor;
    material.transparent = true;
    material.vertexColors = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    return { material, uniforms: { uTime, uPixelRatio } };
}

export function createBuildingNodeMaterial(params = {}) {
    const uTime = uniform(0);
    const uSeed = uniform(0);
    const uGlowIntensity = uniform(1.0);
    const uWindowScale = uniform(1.0);

    // Keep the grid anchored to the architecture. Camera-dependent coordinate
    // quantization previously made rooms change shape while the camera moved.
    // X-facing walls need ZY projection; using XY on those faces created stripes.
    const faceU = mix(positionWorld.x, positionWorld.z, step(0.5, abs(normalWorld.x)));
    const facade = vec2(faceU, positionWorld.y);
    const sideMask = float(1.0).sub(smoothstep(0.15, 0.65, abs(normalWorld.y)));
    const seed = uSeed.mul(17.0);
    const gridSize = vec2(13.0, 21.0).mul(uWindowScale.mul(0.25).add(0.9));
    const grid = facade.add(vec2(seed, seed.mul(0.7))).div(gridSize);
    const cell = floor(grid);
    const st = fract(grid);
    // Derivatives soften sub-pixel windows without moving the window grid.
    const aa = clamp(fwidth(grid).mul(1.1), vec2(0.018), vec2(0.46));
    const window = smoothstep(vec2(0.16).sub(aa), vec2(0.16).add(aa), st)
        .mul(float(1.0).sub(smoothstep(vec2(0.84).sub(aa), vec2(0.84).add(aa), st)));
    const windowMask = window.x.mul(window.y).mul(sideMask);
    const lod = float(1.0).sub(smoothstep(800.0, 2600.0, length(positionView)));
    const roomRoll = hash2D(cell.add(seed));
    const roomOn = step(0.46, roomRoll);
    const chromaRoll = hash2D(cell.mul(3.7).add(vec2(17.0, 31.0)));
    const warmRoom = vec3(1.0, 0.64, 0.34);
    const coolRoom = vec3(0.3, 0.78, 1.0);
    const pinkRoom = vec3(1.0, 0.1, 0.48);
    const roomColor = mix(mix(warmRoom, coolRoom, step(0.43, chromaRoll)), pinkRoom, step(0.82, chromaRoll));
    const interior = mix(float(0.52), float(1.12), float(1.0).sub(st.y));
    const roomBrightness = mix(float(0.22), float(0.66), hash2D(cell.add(vec2(61.0, 3.0))))
        .mul(lod.mul(0.65).add(0.35));
    const glow = clamp(uGlowIntensity, 0.0, 3.0);
    const windows = roomColor.mul(roomBrightness).mul(interior).mul(windowMask).mul(roomOn)
        .mul(glow);

    // Glass and cladding pick up the district's two neon banks. Smooth spatial
    // light spill keeps each facade dimensional without another light or pass.
    const lightBank = sin(positionWorld.x.mul(0.003).add(positionWorld.z.mul(0.001))).mul(0.5).add(0.5);
    const spillColor = mix(vec3(0.012, 0.07, 0.11), vec3(0.11, 0.012, 0.047), lightBank);
    const streetSpill = float(1.0).sub(smoothstep(0.0, 650.0, positionWorld.y));
    const cladding = vec3(0.008, 0.012, 0.023).add(spillColor.mul(streetSpill.mul(0.6).add(0.18)));
    const glass = spillColor.mul(0.28).add(vec3(0.009, 0.015, 0.026));
    const floorEdge = float(1.0).sub(smoothstep(0.025, aa.y.add(0.07), st.y));
    const columnEdge = float(1.0).sub(smoothstep(0.025, aa.x.add(0.07), st.x));
    const structure = max(floorEdge.mul(0.5), columnEdge).mul(sideMask).mul(lod);
    const facadeColor = mix(cladding, glass, windowMask).add(spillColor.mul(structure.mul(0.3)));

    // A few architectural neon rails frame blocks rather than coating every room.
    const lowDetail = params.detail === 'low';
    const railGrid = facade.x.div(120.0);
    const railAa = clamp(fwidth(railGrid), 0.003, 0.08);
    const rail = float(1.0).sub(smoothstep(0.006, railAa.add(0.025), abs(fract(railGrid).sub(0.5))))
        .mul(sideMask).mul(lod);
    const railColor = mix(vec3(0.06, 0.65, 1.0), vec3(1.0, 0.035, 0.32), lightBank);
    const railGlow = lowDetail ? vec3(0.0) : railColor.mul(rail.mul(0.2)).mul(glow);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = (lowDetail ? cladding : facadeColor).add(windows).add(railGlow);
    material.emissiveNode = windows.mul(0.82).add(railGlow);
    return {
        material,
        uniforms: {
            uTime, uSeed, uGlowIntensity, uWindowScale,
        },
    };
}

export function createMegaTowerNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0x100018));

    const gridUv = uv().mul(vec2(25.0, 100.0));
    const cell = floor(gridUv);
    const st = fract(gridUv);

    const windowMask = step(0.22, st.x)
        .mul(step(0.22, st.y))
        .mul(step(st.x, 0.78))
        .mul(step(st.y, 0.85));

    const noise = rand2D(cell);
    const state = step(0.7, noise);
    const intensity = rand2D(cell).mul(2.2).add(0.8);

    const colPink = vec3(1.0, 0.0, 1.0);
    const colCyan = vec3(0.0, 1.0, 1.0);
    const colPurple = vec3(0.6, 0.0, 1.0);

    const t = uTime.mul(0.2);
    let mixedColor = mix(colPink, colPurple, sin(t).mul(0.5).add(0.5));
    mixedColor = mix(mixedColor, colCyan, sin(t.mul(0.7).add(2.0)).mul(0.5).add(0.5));

    const windowOn = windowMask.mul(state);
    const finalColor = mix(uColor, mixedColor.mul(intensity), windowOn);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.emissiveNode = mixedColor.mul(intensity).mul(windowOn);

    return { material, uniforms: { uTime, uColor } };
}

export function createVhsBillboardNodeMaterial(params) {
    const uTime = uniform(0);
    const uRandomOffset = uniform(params?.randomOffset ?? 0);
    const uMixFactor = uniform(0);
    const uGlitchIntensity = uniform(0);
    const uScanlineIntensity = uniform(0.18);
    const uChromaticAberration = uniform(0.002);

    const tex1 = uniformTexture(params?.texture1 ?? new THREE.Texture());
    const tex2 = uniformTexture(params?.texture2 ?? new THREE.Texture());

    // Billboards on buildings with random 90° rotations can present their back face
    // to the camera; flip U on back faces so ad text never reads mirrored. (Parity
    // with the WebGL `gl_FrontFacing` fix in neon-district-theme.js.)
    const baseUv = uv();
    const uvNode = frontFacing.select(baseUv, vec2(float(1.0).sub(baseUv.x), baseUv.y));
    const billboardTime = uTime.add(uRandomOffset);

    const glitchLine = step(0.99, rand2D(vec2(floor(billboardTime.mul(3.0)), floor(uvNode.y.mul(20.0)))));
    const glitchOffset = glitchLine.mul(uGlitchIntensity)
        .mul(rand2D(vec2(billboardTime, uvNode.y)).sub(0.5))
        .mul(0.1);
    const transitionGlitch = uGlitchIntensity.mul(sin(billboardTime.mul(50.0))).mul(0.02);

    const uvGlitch = vec2(uvNode.x.add(glitchOffset).add(transitionGlitch), uvNode.y);

    const ca = uChromaticAberration.mul(uGlitchIntensity.mul(3.0).add(1.0));

    // PERF FIX: Simplified texture sampling - avoid vec4() with complex node expressions
    // which causes "Length of parameters exceeds maximum length" TSL error
    const leftUv = uvGlitch.add(vec2(ca, 0.0));
    const rightUv = uvGlitch.sub(vec2(ca, 0.0));
    const tex1Sample = tex1.sample(uvGlitch);
    const tex2Sample = tex2.sample(uvGlitch);
    const splitRed = mix(tex1.sample(leftUv).r, tex2.sample(leftUv).r, uMixFactor);
    const splitBlue = mix(tex1.sample(rightUv).b, tex2.sample(rightUv).b, uMixFactor);
    const texColor = vec3(splitRed, mix(tex1Sample.g, tex2Sample.g, uMixFactor), splitBlue);

    const scanline = sin(uvNode.y.mul(300.0).add(billboardTime.mul(2.0))).mul(0.5).add(0.5);
    const scanShape = pow(scanline, float(1.6));
    const scanFactor = float(1.0).sub(scanShape.mul(uScanlineIntensity));

    // Apply scanline directly to rgb without reconstructing vec4
    const edgeDistance = abs(uvNode.sub(0.5));
    const displayGlass = float(1.0).sub(pow(max(edgeDistance.x, edgeDistance.y).mul(2.0), 6.0).mul(0.16));
    const finalRgb = texColor.mul(scanFactor).mul(displayGlass);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalRgb;
    material.opacityNode = float(1.0);
    material.emissiveNode = finalRgb;
    material.transparent = true;
    material.depthWrite = false;

    return {
        material,
        uniforms: {
            uTime,
            uMixFactor,
            uGlitchIntensity,
            uScanlineIntensity,
            uChromaticAberration,
            tex1,
            tex2,
        },
    };
}

/**
 * AAA Phase 4a — Hero moon. A bright, looming synthwave moon with a soft corona
 * halo, retro horizontal banding, crater mottling and a glowing terminator rim.
 * Bright emissive so MRT bloom + the Phase 2 god-rays anchor to it dramatically.
 * The geometry should be a CircleGeometry sized larger than the visible disc so
 * the halo has room to fall off (disc fills the inner ~45% of the quad).
 */
export function createMoonNodeMaterial() {
    const color1 = uniform(new THREE.Color(0xff2bb0)); // bottom hot magenta
    const color2 = uniform(new THREE.Color(0x35e8ff)); // top cyan
    const uHaloColor = uniform(new THREE.Color(0x9b3bff)); // violet corona
    // Kept under 1.0 so the disc keeps its magenta→cyan gradient + banding/craters
    // instead of clipping to white once additive blending + bloom pile on.
    const uBrightness = uniform(0.9);
    const uHaloIntensity = uniform(0.85);

    const uvNode = uv();
    // Normalized radius: 0 at center, 1 at the geometry edge.
    const r = length(uvNode.sub(0.5)).mul(2.0);

    // Disc vs. surrounding corona glow.
    const discMask = float(1.0).sub(smoothstep(0.52, 0.58, r)); // 1 inside disc, soft edge
    const haloPulse = sin(time.mul(0.4)).mul(0.08).add(1.0); // gentle breathing
    const haloCore = float(1.0).sub(smoothstep(0.46, 1.0, r));
    const halo = pow(haloCore, float(2.3)).mul(uHaloIntensity).mul(haloPulse);

    // Vertical synthwave gradient.
    const grad = mix(color1, color2, smoothstep(0.1, 0.86, uvNode.y));

    // Retro horizontal banding + crater mottling on the disc surface.
    const bands = sin(uvNode.y.mul(70.0)).mul(0.06).add(0.94);
    const craters = noise2D(uvNode.mul(7.0).add(vec2(13.0, 13.0))).mul(0.22)
        .add(noise2D(uvNode.mul(18.0).sub(vec2(5.0, 5.0))).mul(0.12))
        .add(0.7);
    const surface = bands.mul(craters);

    // Bright terminator rim near the disc edge (kept modest so it doesn't wash
    // the disc back to white at the limb).
    const rim = smoothstep(0.39, 0.53, r).mul(0.28);
    const coronaDistance = r.sub(0.555);
    const coronaRim = exp(coronaDistance.mul(coronaDistance).mul(-2600.0))
        .mul(uHaloIntensity).mul(0.25);

    const discColor = grad.mul(surface).add(grad.mul(rim)).mul(uBrightness);
    const haloColor = uHaloColor.mul(halo).add(color2.mul(coronaRim));

    const finalColor = discColor.mul(discMask).add(haloColor);
    const alpha = clamp(discMask.add(halo).add(coronaRim), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor; // feeds MRT bloom + god-rays
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: {
            color1, color2, uHaloColor, uBrightness, uHaloIntensity,
        },
    };
}

/**
 * AAA Phase 4b — Drifting smog / cloud strata. A wide horizontal band of scrolling
 * FBM cloud, additive and palette-tinted, hung high in the sky. Several of these at
 * different heights/depths drifting in opposite directions give the upper sky living
 * atmosphere and let the moon backlight the haze.
 */
export function createCloudStrataNodeMaterial(params = {}) {
    const uTint = uniform(params.tint ?? new THREE.Color(0x7a2da0));
    const uSpeed = uniform(params.speed ?? 0.012);
    const uOpacity = uniform(params.opacity ?? 0.3);
    const uScale = uniform(params.scale ?? 1.0);

    const uvNode = uv();

    // Horizontally-stretched scrolling fractal cloud.
    const p = vec2(
        uvNode.x.mul(5.0).mul(uScale).add(time.mul(uSpeed)),
        uvNode.y.mul(2.0),
    );
    const n = fbm4(p);
    const n2 = fbm4(p.mul(2.0).add(vec2(7.3, 2.1)));
    const cloud = smoothstep(0.42, 0.85, n.mul(0.7).add(n2.mul(0.3)));

    // Soft vertical falloff so the strip's top/bottom edges dissolve.
    const vfade = smoothstep(0.0, 0.35, uvNode.y)
        .mul(float(1.0).sub(smoothstep(0.6, 1.0, uvNode.y)))
        .mul(smoothstep(0.0, 0.12, uvNode.x))
        .mul(float(1.0).sub(smoothstep(0.88, 1.0, uvNode.x)));
    const density = cloud.mul(vfade);

    const color = uTint.mul(density.mul(1.4));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = density.mul(uOpacity);
    material.emissiveNode = color.mul(0.55); // subtle bloom contribution
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: {
            uTint, uSpeed, uOpacity, uScale,
        },
    };
}

/**
 * AAA Phase 4c — Sheet-lightning flash plane. A broad horizon-weighted glow whose
 * intensity (`uFlash`) is pulsed from JS to silently flash the far sky, backlighting
 * the smog strata and rim-lighting the skyline. Sits behind everything, additive.
 */
export function createSkyFlashNodeMaterial() {
    const uFlash = uniform(0.0);
    const uColor = uniform(new THREE.Color(0xbcd2ff));

    const uvNode = uv();
    // Concentrated near the horizon (bottom of the plane), soft falloff upward,
    // plus a little horizontal break-up so it doesn't read as a flat rectangle.
    const vGrad = smoothstep(0.7, 0.0, uvNode.y);
    const hBreak = noise2D(vec2(uvNode.x.mul(6.0), uvNode.y.mul(2.0))).mul(0.35).add(0.65);
    const intensity = uFlash.mul(vGrad).mul(hBreak);

    const color = uColor.mul(intensity);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = intensity;
    material.emissiveNode = color;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    return { material, uniforms: { uFlash, uColor } };
}

export function createSkylineNodeMaterial() {
    const uColor1 = uniform(new THREE.Color(0x020005));
    const uColor2 = uniform(new THREE.Color(0x050010));
    const uWindowColor = uniform(new THREE.Color(0x401060));

    const uvNode = uv();
    const worldPos = positionWorld;

    const buildingWidth = float(0.02);
    const bIndex = floor(uvNode.x.div(buildingWidth));
    const bHeight = rand2D(vec2(bIndex, 0.0)).mul(0.4).add(0.2);

    const bIndex2 = floor(uvNode.x.add(0.01).div(buildingWidth.mul(0.8)));
    const bHeight2 = rand2D(vec2(bIndex2, 1.0)).mul(0.5).add(0.15);

    const isBuilding = step(uvNode.y, bHeight).add(step(uvNode.y, bHeight2));
    const windowScale = vec2(300.0, 200.0);
    const windowGrid = fract(uvNode.mul(windowScale));
    const isWindow = step(0.3, windowGrid.x).mul(step(0.3, windowGrid.y));
    const windowNoise = rand2D(floor(uvNode.mul(windowScale)));
    const lightsOn = step(0.9, windowNoise).mul(isWindow).mul(smoothstep(0.0, 0.2, uvNode.y));

    const baseColor = mix(uColor1, uColor2, uvNode.y);
    const finalColor = baseColor.add(uWindowColor.mul(lightsOn).mul(1.6));

    const behindTower = worldPos.z.lessThan(-3000.0).and(abs(worldPos.x).lessThan(2000.0));
    const holeMask = behindTower.select(float(0.0), float(1.0));
    const alpha = clamp(isBuilding.mul(holeMask), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = vec3(0.0);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;

    return { material, uniforms: { uColor1, uColor2, uWindowColor } };
}

export function createSearchlightNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xaaccff));
    const vHeight = positionLocal.y.div(4000.0);
    const alpha = float(1.0).sub(vHeight).mul(0.15);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor;
    material.opacityNode = alpha;
    material.emissiveNode = uColor.mul(alpha);
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;

    return { material, uniforms: { uColor } };
}

export function createHologramNodeMaterial(params) {
    const uTime = uniform(0);
    const uColor1 = uniform(params?.color1 ?? new THREE.Color(0x2be6ff));
    const uColor2 = uniform(params?.color2 ?? new THREE.Color(0xff288c));
    const coord = uv();
    const local = coord.sub(0.5);
    const scan = sin(coord.y.mul(160.0).sub(uTime.mul(3.0))).mul(0.08).add(0.86);
    const sweepDistance = coord.y.sub(fract(uTime.mul(0.12)));
    const sweep = exp(sweepDistance.mul(sweepDistance).mul(-280.0));
    const edgeDistance = max(abs(local.x), abs(local.y));
    const border = smoothstep(0.435, 0.458, edgeDistance)
        .mul(float(1.0).sub(smoothstep(0.468, 0.49, edgeDistance)));
    const fade = float(1.0).sub(smoothstep(0.46, 0.5, edgeDistance));
    const radial = length(local.mul(vec2(1.0, 1.4)));
    const reticleDistance = radial.sub(0.265);
    const reticle = exp(reticleDistance.mul(reticleDistance).mul(-6000.0))
        .mul(smoothstep(-0.18, 0.2, local.y));
    const dataCell = floor(coord.mul(vec2(36.0, 18.0)));
    const data = step(0.87, hash2D(dataCell.add(floor(uTime.mul(0.4)))))
        .mul(step(0.3, fract(coord.x.mul(36.0))))
        .mul(float(1.0).sub(smoothstep(0.25, 0.45, abs(local.y))));
    const color = mix(uColor1, uColor2, smoothstep(0.15, 0.9, coord.y));
    const signal = border.mul(0.8).add(reticle.mul(0.7)).add(data.mul(0.12)).add(sweep.mul(0.12));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(signal.add(0.1)).mul(scan);
    material.opacityNode = clamp(signal.add(0.05), 0.0, 0.85).mul(fade);
    material.emissiveNode = color.mul(signal).mul(scan);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    return { material, uniforms: { uTime, uColor1, uColor2 } };
}

export function createRainNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0xcfe0f0)); // Softer rain tint
    const uIntensity = uniform(1.0);

    const aVelocity = attribute('aVelocity');
    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');

    const vAlpha = varying(float(1.0), 'vAlpha');

    const positionNode = Fn(() => {
        const basePos = positionLocal;
        const fallDistance = uTime.mul(aVelocity).mul(60.0).mul(uIntensity);
        const y = mod(basePos.y.sub(fallDistance), 1200.0);
        const wind = sin(uTime.mul(1.5).add(aPhase.mul(0.1))).mul(0.5);
        const x = basePos.x.add(wind);
        const { z } = basePos;
        const animPos = vec3(x, y, z);

        const distFromCenter = length(vec2(animPos.x, animPos.z)).div(400.0);
        vAlpha.assign(float(1.0).sub(smoothstep(0.5, 1.0, distFromCenter)));

        return animPos;
    })();

    // WebGPU does not support point UVs; keep drops subtle and varied via flicker
    const rand = fract(sin(aPhase.mul(12.9898)).mul(43758.5453));
    const flicker = sin(uTime.mul(2.0).add(aPhase.mul(6.28))).mul(0.5).add(0.5);
    const baseAlpha = mix(float(0.18), float(0.4), rand);
    const alpha = vAlpha.mul(baseAlpha).mul(mix(float(0.6), float(1.0), flicker)).mul(uIntensity.mul(0.6).add(0.4));
    const color = uColor;

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.5)); // Softer glow
    material.sizeNode = aSize.mul(mix(float(6.0), float(10.0), rand)); // Subtle point size variation
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uColor, uIntensity } };
}

export function createSplashNodeMaterial() {
    const uTime = uniform(0);
    const uColor = uniform(new THREE.Color(0xddeeff)); // brightness tint

    const aPhase = attribute('aPhase');
    // AAA Phase 6c: per-splash neon zone colour (defaults to white if absent).
    const aColor = attribute('aColor', 'vec3');
    const vLife = varying(float(0.0), 'vLife');

    const positionNode = Fn(() => {
        const basePos = positionLocal;
        const cycle = mod(uTime.mul(5.0).add(aPhase), 6.28); // Slightly slower
        const life = sin(cycle).max(0.0);
        vLife.assign(life);
        return vec3(basePos.x, basePos.y.add(life.mul(2.5)), basePos.z); // Higher splash
    })();

    const alpha = vLife.mul(0.5); // Increased opacity
    const sizeNode = vLife.mul(8.0).mul(float(300.0).div(positionView.z.negate())); // Larger
    const splashColor = aColor.mul(uColor);

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = splashColor;
    material.opacityNode = alpha;
    material.emissiveNode = splashColor.mul(alpha);
    material.sizeNode = sizeNode;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return { material, uniforms: { uTime, uColor } };
}

/**
 * Wet Ground Material (WebGPU) - Reflective wet asphalt with puddles
 * Uses MeshPhysicalNodeMaterial for clearcoat wet look
 * @param {Object} params - Optional parameters
 * @param {THREE.Texture} params.diffuseMap - Diffuse/albedo texture
 * @param {THREE.Texture} params.normalMap - Normal map texture
 * @param {THREE.Texture} params.roughnessMap - Roughness texture
 * @param {THREE.Texture} params.aoMap - Ambient occlusion texture
 */
export function createWetGroundNodeMaterial(params = {}) {
    const uReflectionStrength = uniform(1.0);
    const uRainIntensity = uniform(1.0);
    const p = positionWorld.xz;
    const surfaceUv = uv().mul(vec2(3.0, 15.0));
    const distance = length(positionView);
    const near = float(1.0).sub(smoothstep(260.0, 950.0, distance));
    const detailed = ['High', 'Ultra', 'Extreme'].includes(params.quality);
    // Tier selection removes ripple work from the low-tier graph altogether.
    const puddleNoise = detailed
        ? fbm4(p.mul(0.018).add(vec2(3.0, 0.0)))
        : noise2D(p.mul(0.018).add(vec2(3.0, 0.0)));
    const puddle = smoothstep(0.36, 0.64, puddleNoise);
    const wetness = puddle.mul(0.58).add(0.34);
    let ripple = vec2(0.0);
    if (detailed) {
        // Two independent impact fields give circular expanding rings. Analytic
        // gradients replace the old 9-cell numerical derivative shader.
        const impact = (offset, scale) => {
            const q = p.mul(scale).add(offset);
            const cell = floor(q);
            const center = vec2(hash2D(cell), hash2D(cell.add(vec2(71.0, 13.0)))).mul(0.46).add(0.27);
            const delta = fract(q).sub(center);
            const radius = length(delta);
            const phase = fract(time.mul(0.68).add(hash2D(cell.add(31.0))));
            const ring = radius.sub(phase.mul(0.52));
            const envelope = exp(ring.mul(ring).mul(-320.0))
                .mul(float(1.0).sub(phase)).mul(smoothstep(0.0, 0.12, phase))
                .mul(float(1.0).sub(smoothstep(0.36, 0.49, radius)));
            return delta.div(max(radius, 0.025)).mul(sin(ring.mul(58.0)).mul(envelope));
        };
        ripple = impact(vec2(0.0), 0.13).add(impact(vec2(11.3, 7.7), 0.09).mul(0.55))
            .mul(near).mul(uRainIntensity)
            .mul(wetness);
    }
    const grain = noise2D(p.mul(0.46));
    let asphalt = vec3(0.017, 0.023, 0.034).mul(grain.mul(0.35).add(0.8));
    if (params.diffuseMap) {
        const tex = uniformTexture(params.diffuseMap).sample(surfaceUv).rgb;
        asphalt = tex.mul(0.038).add(asphalt.mul(0.5));
    }

    // Stretched, broken cyan and fuchsia reflections make the street read as wet
    // in every backend, including tiers without a second planar render.
    const reflectionUv = p.mul(vec2(0.035, 0.0038));
    const shimmer = noise2D(p.mul(vec2(0.028, 0.25)).add(vec2(time.mul(0.02), 0.0)));
    const cyanBand = pow(noise2D(reflectionUv.add(vec2(0.0, time.mul(0.012)))), 3.0);
    const pinkBand = pow(noise2D(reflectionUv.add(vec2(23.0, 8.0))), 3.0);
    const sideSpill = smoothstep(40.0, 260.0, abs(p.x));
    const reflectionLight = vec3(0.04, 0.65, 1.0).mul(cyanBand.mul(0.6))
        .add(vec3(1.0, 0.025, 0.32).mul(pinkBand.mul(0.55)))
        .mul(shimmer.mul(0.65).add(0.35))
        .mul(wetness)
        .mul(sideSpill.mul(0.6).add(0.4))
        .mul(uReflectionStrength);
    const puddleRim = smoothstep(0.32, 0.4, puddleNoise)
        .mul(float(1.0).sub(smoothstep(0.4, 0.48, puddleNoise)));
    let surface = asphalt.add(reflectionLight).add(vec3(0.018, 0.03, 0.035).mul(puddleRim));
    let reflectedEmission = reflectionLight.mul(0.11);
    if (params.reflectorNode) {
        const reflUv = screenUV.flipX().add(ripple.mul(0.006).mul(near));
        const reflected = params.reflectorNode.sample(reflUv).rgb;
        const fresnel = pow(clamp(float(1.0).sub(max(dot(normalView, positionViewDirection), 0.0)), 0.0, 1.0), 4.0);
        const mirrorMask = clamp(wetness.mul(fresnel.mul(0.63).add(0.22)).mul(uReflectionStrength), 0.0, 0.84);
        surface = mix(surface, reflected, mirrorMask);
        // Reflected neon is incident light, so retain a modest emissive component
        // rather than darkening it twice through the asphalt's physical lighting.
        reflectedEmission = reflectedEmission.add(reflected.mul(mirrorMask).mul(0.22));
    }
    const material = new THREE.MeshPhysicalNodeMaterial();
    material.colorNode = surface;
    const baseNormal = params.normalMap ? normalMap(texture(params.normalMap, surfaceUv)) : normalView;
    const viewRipple = cameraViewMatrix.mul(vec4(vec3(ripple.x, 0.0, ripple.y), 0.0)).xyz;
    material.normalNode = normalize(baseNormal.add(viewRipple.mul(0.24)));
    const roughBase = params.roughnessMap
        ? uniformTexture(params.roughnessMap).sample(surfaceUv).r.mul(0.26).add(0.15)
        : float(0.27);
    material.roughnessNode = mix(roughBase, float(0.055), puddle);
    material.metalnessNode = float(0.04);
    material.clearcoatNode = wetness;
    material.clearcoatRoughnessNode = mix(float(0.18), float(0.035), puddle);
    material.emissiveNode = reflectedEmission;
    material.envMapIntensity = 1.35;
    material.ior = 1.33;
    if (params.aoMap) {
        material.aoMap = params.aoMap;
        material.aoMapIntensity = 0.7;
    }
    return { material, uniforms: { uReflectionStrength, uRainIntensity } };
}

export function createNeonHaloNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xff00ff));
    const uIntensity = uniform(1.0);
    const uPulseSpeed = uniform(1.0);
    const uTime = uniform(0);

    // Use UV for radial gradient (sprite centered at 0.5, 0.5)
    const uvNode = uv();
    const center = vec2(0.5, 0.5);
    const dist = length(uvNode.sub(center)).mul(2.0); // 0 at center, 1 at edge

    // Soft radial falloff with multiple layers for glow effect
    const innerGlow = smoothstep(1.0, 0.0, dist);
    const outerGlow = smoothstep(1.2, 0.3, dist).mul(0.5);
    const coreGlow = pow(smoothstep(0.5, 0.0, dist), 2.0);

    // Combine glow layers
    const glow = innerGlow.add(outerGlow).add(coreGlow);

    // Subtle pulse animation
    const pulse = sin(uTime.mul(uPulseSpeed)).mul(0.15).add(0.85);

    // Final color with intensity and pulse
    const finalAlpha = glow.mul(uIntensity).mul(pulse).clamp(0.0, 1.0);
    const finalColor = uColor.mul(glow.add(0.5)); // Brighter at center

    const spriteMaterial = new THREE.SpriteNodeMaterial({
        color: 0xff00ff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    spriteMaterial.colorNode = finalColor;
    spriteMaterial.opacityNode = finalAlpha;
    spriteMaterial.emissiveNode = finalColor.mul(finalAlpha);

    return {
        material: spriteMaterial,
        uniforms: {
            uColor, uIntensity, uPulseSpeed, uTime,
        },
        // Helper to create a proper halo with the given color
        createHalo: (color, intensity = 1.0) => {
            const mat = new THREE.SpriteMaterial({
                color,
                transparent: true,
                opacity: 0.4 * intensity,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            return mat;
        },
    };
}

/**
 * Billboard Halo Material - Quad-based glow that always faces camera
 * Uses MeshBasicNodeMaterial with custom vertex positioning
 */
export function createBillboardHaloNodeMaterial() {
    const uColor = uniform(new THREE.Color(0xff00ff));
    const uIntensity = uniform(1.0);
    const uTime = uniform(0);

    // Radial gradient based on UV
    const uvNode = uv();
    const center = vec2(0.5, 0.5);
    const dist = length(uvNode.sub(center)).mul(2.0);

    // Multi-layer glow
    const innerGlow = pow(smoothstep(1.0, 0.0, dist), 1.5);
    const midGlow = smoothstep(1.0, 0.2, dist).mul(0.6);
    const outerGlow = smoothstep(1.3, 0.5, dist).mul(0.3);

    const glow = innerGlow.add(midGlow).add(outerGlow);

    // Subtle flicker
    const flicker = sin(uTime.mul(8.0)).mul(0.05).add(0.95);

    const finalAlpha = glow.mul(uIntensity).mul(flicker);
    const finalColor = uColor.mul(innerGlow.add(0.3));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = finalColor;
    material.opacityNode = finalAlpha;
    material.emissiveNode = finalColor;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    return { material, uniforms: { uColor, uIntensity, uTime } };
}
