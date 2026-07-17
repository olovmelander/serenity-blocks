/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Summer — "Midsommar Solstice"
 * ─────────────────────────────────────────────────────────────────────────────
 * A Swedish-midsummer lakeside meadow at the endless golden hour: a wildflower
 * meadow swaying in the foreground, a calm reflective lake, a flower-decked
 * maypole (midsommarstång) and a Falu-red cottage on the far shore, framed by
 * birch and pine under a tall blue→peach→coral sky with a low warm sun.
 *
 * Authored playground-first (screenshot-verified) then mounted by the thin
 * BaseTheme wrapper at src/themes/summer/summer-theme.js.
 *
 * Performance: the old summer theme rendered 250k × 48-tri grass blades on
 * WebGL. This is WebGPU/TSL with low-segment instanced blades whose wind is
 * 100% in the vertex shader (zero per-frame JS), concentrated in the visible
 * foreground wedge. See docs/SUMMER_MIDSUMMER_MASTERPIECE_PLAN.md.
 *
 * ⚠️ TSL gotcha (load-bearing): a material's positionNode runs BEFORE the
 * InstancedMesh instanceMatrix is applied, and instanceMatrixNode is not exposed.
 * So wind bend is done in LOCAL blade space (bend amount from positionLocal.y);
 * world-coherent gusts sample noise at a per-instance `aWorldXZ` attribute we set
 * on the CPU at build time. instanceMatrix then places/rotates the bent blade.
 */
import * as THREE from 'three/webgpu';
import {
    Fn, float, vec2, vec3, vec4, uniform, attribute, instanceIndex, uv,
    mix, clamp, abs, sin, cos, pow, max, min, dot, cross, normalize, smoothstep, fract,
    atan2, length, dFdx, dFdy, positionLocal, positionWorld, normalWorld, cameraPosition,
    reflector, mx_noise_float, pass, mrt, output, emissive, viewportUV,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
// Reuse Chapter 3's skinned songbirds (goldfinch + swallow) — same species the old
// summer theme used, but the pipeline-authored flapping versions from Odyssey.
import { loadOdysseyGltfCached } from '../../rendering/odyssey/chapter-environments/shared/odyssey-gltf-loader.js';
import { getChapter3FlyingBirdAssetById } from '../../rendering/odyssey/chapter-environments/shared/chapter-03-bird-assets.js';
import { createSummerTrees } from '../../themes/summer/rendering/summer-trees.js';
import { createSummerGameplayFX } from '../../themes/summer/rendering/summer-gameplay-fx.js';
import { SummerGameplayRouting } from '../../themes/summer/composition/summer-gameplay-routing.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import summerFloraUrl from '../../themes/summer/assets/summer_flora.glb?url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { disposeBloomNodeDeep } from '../../themes/shared/bloom-dispose.js';
import midsummerPoleUrl from '../../themes/summer/assets/midsummer_pole.glb?url';
import cottageUrl from '../../themes/summer/assets/swedish_cottage.glb?url';
import dockBoatUrl from '../../themes/summer/assets/dock_boat.glb?url';

function makeDracoLoader() {
    const d = new DRACOLoader();
    d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    return d;
}

export const meta = {
    id: 'summer-meadow',
    title: 'Summer — Midsommar Solstice',
    description: 'Swedish-midsummer lakeside meadow at golden hour: wildflowers, maypole, Falu-red cottage, reflective lake.',
};

// ── palette ──────────────────────────────────────────────────────────────────
// Golden-hour split-complementary harmony: warm sunset sky (peach + golden) against
// layered greens (pine→canopy→sunlit) and calming lake-blue, with a Falu-red accent.
//   Soft Sky Blue #85B9D1 · Sunset Peach #F8A898 · Golden Yellow #FCD581
//   Deep Pine #2A4B38 · Midtone Canopy #4A7C59 · Sunlit Grass #97AD43
//   Falu Red #A23629 · Lake Blue #5B92A8
const PAL = {
    skyZenith: 0x85b9d1,
    skyUpper: 0x9ec6d6,
    skyMid: 0xc6cdc9,
    skyPeach: 0xf8a898,
    skyHorizon: 0xfcd581,
    skyHorizonDeep: 0xf6b779,
    sunDisc: 0xffe9a8,
    sunCore: 0xfff4d6,
    sunWarm: 0xfcd581,
    haze: 0xf8a898, // sunset-peach aerial perspective / ambient fog
    grassShadow: 0x2a4b38,
    grassMid: 0x4a7c59,
    grassSun: 0x97ad43,
    sss: 0xfcd581,
    waterShallow: 0x5b92a8,
    waterDeep: 0x355f72,
    falu: 0xa23629,
    faluRoof: 0x5d2424,
    trim: 0xf4efe3,
    window: 0xffd98a,
    pineLight: 0x4a7c59,
    pineDark: 0x2a4b38,
    birchBark: 0xe8e4d6,
    birchLeaf: 0x9ac24f,
    poleWrap: 0x5e7d38,
    poleWood: 0x7a5a33,
    wreath: 0x4e7a33,
    daisy: 0xfcfbf5,
    daisyCenter: 0xf2c53d,
    cornflower: 0x5a7bd4,
    lupine: 0x8e7cc3,
    buttercup: 0xf6c324,
    poppy: 0xd7352b,
};

function colorParts(hex) {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
}
const cv = (hex) => { const [r, g, b] = colorParts(hex); return vec3(r, g, b); };

export function create({
    THREE: T = THREE, scene, camera, renderer, params,
}) {
    const P = params || new URLSearchParams('');
    const disposables = [];
    const objects = [];
    const track = (o) => { disposables.push(o); return o; };
    const add = (o) => { scene.add(o); objects.push(o); return o; };

    // Wider, more panoramic FOV to match the reference's broad lakeside vista.
    camera.fov = 60;
    camera.updateProjectionMatrix();

    // ── uniforms ──────────────────────────────────────────────────────────────
    const uTime = uniform(0);
    const uWarmth = uniform(0.15);
    const uBreeze = uniform(0);
    const uSparkle = uniform(0);
    const uRaise = uniform(0);
    // Combo reactions that make the SCENE ITSELF answer (plan §4 scene symbiosis):
    // uFlare pulses the sun halo/disc + god-ray shafts; uFlowerBloom shimmers the
    // real wildflowers. Both 0 at rest so the graph compiles once.
    const uFlare = uniform(0);
    const uFlowerBloom = uniform(0);
    // Vector3 (not a vec3 node) so the wrapper can drive it via uAccent.value.set(r,g,b).
    const uAccent = uniform(new T.Vector3(1.0, 0.82, 0.48));

    // Low warm sun, center-right and far (a glow behind the hills, like the reference).
    const sunDir = new T.Vector3(0.34, 0.1, -0.93).normalize();
    const uSunDir = uniform(vec3(sunDir.x, sunDir.y, sunDir.z));
    const uSunWarm = uniform(cv(PAL.sunWarm));
    // Sun tangent basis for analytic crepuscular sun-shafts (no raymarch).
    const sunRight = new T.Vector3().crossVectors(sunDir, new T.Vector3(0, 1, 0)).normalize();
    const sunUp = new T.Vector3().crossVectors(sunRight, sunDir).normalize();
    const uSunRight = uniform(vec3(sunRight.x, sunRight.y, sunRight.z));
    const uSunUp = uniform(vec3(sunUp.x, sunUp.y, sunUp.z));

    // A faint warm key + sky fill for the few PBR surfaces (glossy glass); the unlit
    // stylized scene ignores these.
    const sunLight = new T.DirectionalLight(0xfcd581, 1.4);
    sunLight.position.set(sunDir.x * 120, sunDir.y * 120 + 60, sunDir.z * 120);
    add(sunLight);
    add(new T.HemisphereLight(0x85b9d1, 0x4a7c59, 0.35));

    // ── LIGHTER-TOUCH HYBRID — golden-hour PolyHaven HDRI as an ENVIRONMENT MAP only ─
    // Tone mapping stays OFF so the vibrant stylized meadow keeps its pop (global ACES
    // muted it). The HDRI is used purely for glossy REFLECTIONS — the cottage windows
    // mirror the warm sky. No scene-wide PBR re-grade.
    renderer.toneMapping = T.NoToneMapping;
    new RGBELoader().load('/hdri/belfast_sunset_puresky_2k.hdr', (hdr) => {
        hdr.mapping = T.EquirectangularReflectionMapping;
        try {
            const pmrem = new T.PMREMGenerator(renderer);
            scene.environment = pmrem.fromEquirectangular(hdr).texture;
            pmrem.dispose();
        } catch (e) {
            scene.environment = hdr; // fallback: equirect environment directly
            console.warn('[Summer] PMREM failed, using equirect env', e);
        }
        console.log('[Summer] HDRI environment loaded.');
    }, undefined, (e) => console.warn('[Summer] HDRI load failed', e));

    // ── shared shading helpers (manual, unlit — full art control) ───────────────
    // Aerial-perspective fog: distant surfaces melt into the warm horizon haze.
    const FOG_NEAR = 70.0, FOG_FAR = 340.0, FOG_MAX = 0.66;
    const haze = cv(PAL.haze);
    const distFog = (colNode) => {
        const d = length(positionWorld.sub(cameraPosition));
        const f = smoothstep(FOG_NEAR, FOG_FAR, d).mul(FOG_MAX);
        return mix(colNode, haze, f);
    };
    // Cheap stylized half-lambert: warm golden key (uSunWarm) + cool Soft-Sky-Blue fill
    // from above + a low neutral ambient — the split-complementary warm/cool balance.
    const skyFill = cv(0x85b9d1);
    const ambient = cv(0x4a5763);
    const shade = (albedo, N) => {
        const ndl = max(dot(N, uSunDir), float(0.0));
        const halfL = ndl.mul(0.5).add(0.5);
        const up = max(dot(N, vec3(0, 1, 0)).mul(0.5).add(0.5), float(0.0));
        const lit = albedo.mul(
            uSunWarm.mul(halfL.mul(1.05))
                .add(skyFill.mul(up.mul(0.32)))
                .add(ambient.mul(0.5)),
        );
        return distFog(lit);
    };
    // Geometric (flat) face normal from screen-space derivatives — gives the
    // low-poly faceted look on MeshBasicNodeMaterial props (no scene lights).
    const faceN = normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));

    // ── Bake a Blender-exported GLB template (one node, several per-material primitives)
    // into ONE vertex-coloured BufferGeometry, normalized to unit height with the root at
    // y=0 and centred in X/Z — ready for the instanced TSL-wind pipeline. Each primitive's
    // glTF material colour (linear) becomes that part's vertex colour, so the meadow's
    // makeFloraMat (which reads attribute('color')) reproduces the Blender look.
    const extractColoredGeo = (root, { unit = false } = {}) => {
        if (!root) return null;
        root.updateMatrixWorld(true);
        const parts = [];
        root.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
            g.applyMatrix4(o.matrixWorld);
            const posAttr = g.getAttribute('position');
            const ng = new T.BufferGeometry();
            ng.setAttribute('position', posAttr.clone());
            const col = (o.material && o.material.color) ? o.material.color : new T.Color(0x808080);
            const arr = new Float32Array(posAttr.count * 3);
            for (let i = 0; i < posAttr.count; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
            ng.setAttribute('color', new T.Float32BufferAttribute(arr, 3));
            parts.push(ng);
        });
        if (!parts.length) return null;
        const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        merged.computeBoundingBox();
        const bb = merged.boundingBox;
        const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
        const h = (bb.max.y - bb.min.y) || 1;
        merged.translate(-cx, -bb.min.y, -cz);
        if (unit) merged.scale(1 / h, 1 / h, 1 / h); // trees → unit height; flowers/grass keep native ratios
        return merged;
    };

    // ═══ SKY DOME ═══════════════════════════════════════════════════════════════
    const skyMat = track(new T.MeshBasicNodeMaterial());
    {
        const dir = normalize(positionLocal);
        const y = dir.y;
        let sky = mix(cv(PAL.skyHorizonDeep), cv(PAL.skyHorizon), smoothstep(-0.18, 0.02, y));
        sky = mix(sky, cv(PAL.skyPeach), smoothstep(-0.02, 0.12, y));
        sky = mix(sky, cv(PAL.skyMid), smoothstep(0.08, 0.30, y));
        sky = mix(sky, cv(PAL.skyUpper), smoothstep(0.26, 0.52, y));
        sky = mix(sky, cv(PAL.skyZenith), smoothstep(0.5, 0.92, y));

        const sunAlign = max(dot(dir, uSunDir), float(0.0));

        // ── Defined sunset STRATUS bands (reference-matched) ──────────────────────
        // Several soft horizontal cloud layers stacked low in the sky, warm peach →
        // coral → cream, drifting slowly toward the sun. The low "hero" band is the
        // most solid; upper bands break into wispier gaps for layered depth.
        const cloudX = atan2(dir.z, dir.x);
        const fbm2 = (uu, vv) => {
            const a = mx_noise_float(vec3(uu, vv, 0.0));
            const b = mx_noise_float(vec3(uu.mul(2.4).add(5.1), vv.mul(2.4), 2.0));
            return a.mul(0.6).add(b.mul(0.4)).mul(0.5).add(0.5); // 0..1
        };
        const stratus = (yc, th, soft, freq, amp, drift, breakup) => {
            const u = cloudX.add(uTime.mul(drift));
            const yc2 = float(yc)
                .add(sin(u.mul(freq)).mul(amp))
                .add(mx_noise_float(vec3(u.mul(0.8), float(yc * 7.0), 0.0)).mul(amp * 0.8));
            const top = smoothstep(yc2.add(th), yc2.sub(soft), y); // soft fade above
            const bot = smoothstep(yc2.sub(th).sub(soft), yc2.sub(th), y); // firmer base
            const fb = fbm2(u.mul(1.6), float(yc * 5.0).add(dir.y.mul(3.0)));
            const band = top.mul(bot).mul(mix(float(1.0), smoothstep(0.32, 0.62, fb), float(breakup)));
            return clamp(band, 0.0, 1.0);
        };
        const warmBias = smoothstep(0.0, 0.8, sunAlign);
        // Keep clouds their own coral tone near the sun (low warm wash) so they stay
        // DEFINED against the bright sky instead of blending to white.
        const bandCol = (top, under, hot) => mix(mix(cv(top), cv(under), float(0.6)), cv(hot), warmBias.mul(0.4));
        const bHi = stratus(0.46, 0.020, 0.060, 2.0, 0.012, 0.010, 1.0);
        const bUp = stratus(0.34, 0.028, 0.050, 1.6, 0.018, 0.008, 0.55);
        const bMid = stratus(0.23, 0.040, 0.030, 1.3, 0.022, 0.006, 0.15); // HERO band — most solid
        const bLow = stratus(0.12, 0.050, 0.070, 1.1, 0.016, 0.005, 0.40);
        sky = mix(sky, bandCol(0xffe2b4, 0xffc878, 0xfff0d6), bLow.mul(0.90));
        sky = mix(sky, bandCol(0xfbd9b6, 0xef9a6e, 0xffe0b8), bMid.mul(0.95));
        sky = mix(sky, bandCol(0xd6c6d2, 0xeebfa0, 0xffe0b8), bUp.mul(0.80));
        sky = mix(sky, bandCol(0xc8d2dc, 0xe4d0c4, 0xffe6c0), bHi.mul(0.48));
        const cloudGlow = bMid.add(bLow).mul(pow(sunAlign, float(2.5))).mul(0.5);
        sky = sky.add(uSunWarm.mul(cloudGlow));

        // Analytic crepuscular sun-shafts (god rays) — angular streaks around the sun.
        const perp = dir.sub(uSunDir.mul(dot(dir, uSunDir)));
        const rayAngle = atan2(dot(perp, uSunUp), dot(perp, uSunRight));
        const rayA = pow(sin(rayAngle.mul(20.0).add(uTime.mul(0.03))).mul(0.5).add(0.5), float(2.6));
        const rayB = pow(sin(rayAngle.mul(12.0).sub(uTime.mul(0.02)).add(1.7)).mul(0.5).add(0.5), float(2.0));
        const rays = rayA.mul(0.6).add(rayB.mul(0.4));
        const shaftMask = pow(sunAlign, float(2.0)).mul(smoothstep(-0.05, 0.16, y));
        // Combo flare surges the crepuscular shafts (uSparkle continuous + uFlare startle).
        const shafts = rays.mul(shaftMask).mul(float(0.42).add(uSparkle.mul(0.4)).add(uFlare.mul(0.6)));

        // Sun halo + disc (these + shafts feed bloom via emissive). The sun visibly
        // pulses on a combo milestone — a warm answer high above the board line.
        const flareBoost = float(1.0).add(uFlare.mul(0.9));
        const halo = pow(sunAlign, float(5.0)).mul(0.6).add(pow(sunAlign, float(60.0)).mul(0.8));
        const disc = smoothstep(0.9975, 0.9994, sunAlign);
        sky = sky.add(uSunWarm.mul(halo).mul(flareBoost).mul(0.5)).add(uSunWarm.mul(shafts));
        skyMat.colorNode = clamp(sky, 0.0, 4.0);
        skyMat.emissiveNode = uSunWarm.mul(halo.mul(0.7).add(shafts.mul(0.5)).add(cloudGlow.mul(0.6))).mul(flareBoost)
            .add(cv(PAL.sunCore).mul(disc.mul(float(1.6).add(uFlare.mul(1.4)))));
    }
    skyMat.side = T.BackSide;
    skyMat.depthWrite = false;
    skyMat.fog = false;
    skyMat.toneMapped = false;
    const skyDome = add(new T.Mesh(track(new T.SphereGeometry(6000, 48, 24)), skyMat));
    skyDome.frustumCulled = false;

    // ═══ GROUND (meadow base + far banks) ════════════════════════════════════════
    {
        const groundGeo = track(new T.PlaneGeometry(520, 520, 1, 1));
        groundGeo.rotateX(-Math.PI / 2);
        const gMat = track(new T.MeshBasicNodeMaterial());
        // Subtle large-scale color variation so the bare ground isn't flat.
        const n = mx_noise_float(vec3(positionWorld.x.mul(0.02), positionWorld.z.mul(0.02), 0.0));
        const base = mix(cv(PAL.grassShadow), cv(PAL.grassMid), n.mul(0.5).add(0.5)); // pine→canopy ground
        gMat.colorNode = shade(base, vec3(0, 1, 0));
        const ground = add(new T.Mesh(groundGeo, gMat));
        ground.position.y = -0.12; // sits below the lake's clamped wave troughs (no green show-through)
    }

    // ═══ ROLLING HILLS — layered green ridges behind the lake (aerial perspective) ═
    {
        // Low, wide, SHALLOW-in-Z ridges placed BEHIND the lake/cottage/trees (z<-190)
        // so they read as a distant backdrop and never reach forward to occlude the
        // cottage or bury the far trees. (Earlier full-radius domes reached ~z-70.)
        // Layered greens (canopy → sunlit) receding into the warm haze with distance.
        const hillSpecs = [
            // x, z, radius, yScale, color
            [-130, -198, 95, 0.32, 0x4a7c59], // canopy
            [-30, -218, 110, 0.30, 0x5d8a52],
            [70, -208, 100, 0.32, 0x4a7c59],
            [165, -202, 90, 0.34, 0x77994d],
            [20, -252, 140, 0.28, 0x97ad43], // sunlit (farthest)
        ];
        for (const [hx, hz, r, ys, col] of hillSpecs) {
            const geo = track(new T.IcosahedronGeometry(r, 1));
            const hmat = track(new T.MeshBasicNodeMaterial());
            hmat.colorNode = shade(cv(col), faceN);
            const hill = add(new T.Mesh(geo, hmat));
            hill.scale.set(2.8, ys, 0.3); // very wide, low, SHALLOW in z → distant backdrop ridge
            hill.position.set(hx, -r * ys * 0.5, hz); // bury half; a low hump shows behind the treeline
            hill.frustumCulled = false;
        }
    }

    // ═══ LAKE (reflector + fresnel sky-tint + sun glitter) ═══════════════════════
    const WATER_Y = 0.0;
    let reflectionNode = null;
    {
        const reflectOff = P.has('summerNoReflect') || P.has('noReflect');
        const waterGeo = track(new T.PlaneGeometry(176, 112, 56, 40));
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = track(new T.MeshBasicNodeMaterial());

        // Calm faceted ripple (low amplitude — a mirror, not chop).
        const wx = positionLocal.x, wz = positionLocal.z;
        const ripple = sin(wx.mul(0.10).add(uTime.mul(0.5)))
            .add(sin(wz.mul(0.083).add(uTime.mul(0.42))))
            .add(sin(wx.mul(0.022).add(wz.mul(0.018)).add(uTime.mul(0.3))).mul(0.6))
            .mul(uBreeze.mul(0.7).add(0.5));
        // Clamp the DOWNWARD ripple so wave troughs never dip below the ground plane
        // (y=-0.12) — otherwise the green ground showed through as drifting "islands"
        // wherever a trough sank past the water's clearance. Upward crests are free.
        waterMat.positionNode = positionLocal.add(vec3(0, ripple.mul(0.05).max(float(-0.05)), 0));

        const N = vec3(0, 1, 0);
        const Vw = normalize(cameraPosition.sub(positionWorld));
        const fres = pow(clamp(float(1.0).sub(dot(N, Vw)), 0.0, 1.0), float(4.0));
        const skyTint = mix(cv(PAL.skyMid), cv(PAL.skyHorizon), float(0.5));
        let waterCol = mix(cv(PAL.waterDeep), cv(PAL.waterShallow), fres.mul(0.6).add(0.25));
        waterCol = mix(waterCol, skyTint, fres.mul(0.5));

        if (!reflectOff) {
            reflectionNode = reflector({ resolutionScale: 0.45 }); // sharper → reads as a mirror, not a blob
            reflectionNode.target.rotateX(-Math.PI / 2);
            reflectionNode.target.position.y = WATER_Y;
            add(reflectionNode.target);
            // Tint reflections toward the water + cap their strength so far-shore tree
            // reflections read as soft mirror images rather than saturated green smudges.
            const reflCol = mix(reflectionNode.rgb, cv(PAL.waterShallow), float(0.36));
            const reflAmt = clamp(fres.mul(0.6).add(0.08), 0.0, 0.58);
            waterCol = mix(waterCol, reflCol, reflAmt);
        }

        // Warm reflected-sunset wash toward the horizon (longer at low sun angles).
        const sunBand = pow(clamp(dot(Vw, uSunDir), 0.0, 1.0), float(3.0));
        waterCol = mix(waterCol, cv(PAL.skyHorizon), sunBand.mul(0.4));
        // Sun glitter — specular streak toward the low sun + ripple sparkle.
        const H = normalize(uSunDir.add(Vw));
        const glint = pow(clamp(dot(N, H), 0.0, 1.0), float(120.0));
        const sparkleN = mx_noise_float(vec3(wx.mul(0.6), wz.mul(0.6), uTime.mul(0.8))).mul(0.5).add(0.5);
        const glitter = glint.mul(sparkleN.add(0.45)).mul(uSparkle.mul(0.8).add(1.0));
        waterCol = waterCol.add(uSunWarm.mul(glitter).mul(2.0));

        // ── Asymmetric lake outline matching the reference ────────────────────────
        // A sideways teardrop: bulbous LEFT cove, a convex NEAR-shore bulge centred
        // left-of-middle, tapering to a thin tongue behind the cottage bank on the
        // RIGHT. (Local +Z = near shore toward the camera.) Built from an offset,
        // anisotropic ellipse SDF + a right-side positional pinch + a left-cove notch.
        const cx = wx.add(8.0); // recentre the basin left
        const cz = wz.sub(4.0); // recentre slightly toward the far shore
        const ax = mix(float(96.0), float(66.0), smoothstep(-32.0, 44.0, cx)); // wide left → narrow right
        const az = mix(float(45.0), float(58.0), smoothstep(-12.0, 30.0, cz)); // more near-shore extent
        const ex = cx.div(ax), ez = cz.div(az);
        let er = length(vec2(ex, ez));
        er = er.add(smoothstep(30.0, 92.0, wx).mul(0.42)); // right-side pinch → tapering tongue
        const ang = atan2(ez, ex);
        const bay = smoothstep(2.5, 3.06, ang.abs()).mul(0.13); // left cove (|ang|~π = -x side)
        const nearBulge = smoothstep(0.0, 54.0, cz).mul(0.05); // belly the near shore toward camera
        const wob = sin(ang.mul(3.0)).mul(0.022).add(sin(ang.mul(5.0).add(1.3)).mul(0.014));
        const edge = float(0.97).add(wob).add(nearBulge).sub(bay);
        const shoreMask = smoothstep(edge.add(0.05), edge.sub(0.08), er);
        const foam = smoothstep(edge.sub(0.16), edge.sub(0.02), er); // soft foam ring at the shore
        waterCol = mix(waterCol, cv(0xd2e4e6), foam.mul(0.4));

        waterMat.colorNode = distFog(waterCol);
        waterMat.emissiveNode = uSunWarm.mul(glint.mul(1.1));
        // Alpha-TEST (opaque) not alpha-blend: transparent objects break the MRT bloom
        // pass in this WebGPU pipeline (blacked most of the screen). alphaTest keeps the
        // organic shoreline as a hard cutout while staying in the opaque pass.
        waterMat.opacityNode = shoreMask;
        waterMat.alphaTest = 0.5;
        waterMat.transparent = false;
        waterMat.depthWrite = true;
        waterMat.toneMapped = false;
        const water = add(new T.Mesh(waterGeo, waterMat));
        water.position.set(0, WATER_Y, -74); // pulled forward to meet the meadow (no bare gap) + thicker lake band
    }

    // Shared wind direction (XZ) for all meadow vegetation (grass + flowers + trees).
    const windDir = vec2(0.94, 0.34);

    // ═══ MEADOW — instanced Blender grass TUFTS, wind-animated (THE CRUX) ═════════
    // Geometry = the Blender F_Grass tuft (baked root→tip vertex colour), loaded from the
    // GLB. Wind bends in LOCAL space with a world-coherent gust sampled at the per-instance
    // aWorldXZ attribute (gotcha: positionNode runs before instanceMatrix).
    const buildGrassTufts = (tuftGeo) => {
        if (!tuftGeo) return;
        const GRASS = Math.max(1500, parseInt(P.get('grass'), 10) || 11000);
        const geo = track(tuftGeo);
        geo.computeBoundingBox();
        const TUFT_H = (geo.boundingBox.max.y - geo.boundingBox.min.y) || 1;
        const grassMat = track(new T.MeshBasicNodeMaterial());

        const wxz = attribute('aWorldXZ', 'vec2');
        const ph = wxz.x.mul(0.6).add(wxz.y.mul(0.45));
        const heightFrac = clamp(positionLocal.y.div(TUFT_H), 0.0, 1.0);
        const sway = sin(uTime.mul(1.1).add(ph)).mul(0.13);
        const gustN = mx_noise_float(vec3(wxz.x.mul(0.045).add(uTime.mul(0.16)), wxz.y.mul(0.045), 0.0));
        const gust = gustN.mul(0.2).mul(uBreeze.mul(1.8).add(0.55));
        const turb = sin(uTime.mul(3.2).add(ph.mul(11.0))).mul(0.045);
        const bend = sway.add(gust).add(turb).mul(heightFrac.mul(heightFrac));
        grassMat.positionNode = positionLocal.add(vec3(windDir.x.mul(bend), float(0.0), windDir.y.mul(bend)));

        // Shading: baked vertical gradient (vertex colour) + root AO + golden backlight SSS.
        const vc = attribute('color', 'vec3');
        let gcol = vc.mul(mix(float(0.6), float(1.12), heightFrac));
        const Vg = normalize(positionWorld.sub(cameraPosition));
        const backlit = pow(clamp(dot(uSunDir, Vg), 0.0, 1.0), float(2.5));
        gcol = gcol.add(cv(PAL.sss).mul(backlit).mul(heightFrac).mul(uWarmth.mul(0.5).add(0.55)));
        gcol = gcol.mul(mix(vec3(1, 1, 1), cv(0xffe6b0), float(0.16)));
        grassMat.colorNode = distFog(gcol);
        grassMat.side = T.DoubleSide;

        const inst = new T.InstancedMesh(geo, grassMat, GRASS);
        const aWorldXZ = new Float32Array(GRASS * 2);
        const m = new T.Matrix4(), pos = new T.Vector3(), quat = new T.Quaternion(), scl = new T.Vector3();
        const yAxis = new T.Vector3(0, 1, 0);
        for (let i = 0; i < GRASS; i++) {
            const depth = Math.pow(Math.random(), 1.5);
            const z = 11 - 30 * depth; // +11 (near) .. -19 (shoreline)
            const halfW = 16 + (11 - z) * 1.9; // full-width carpet
            const x = (Math.random() * 2 - 1) * halfW;
            pos.set(x, 0, z);
            quat.setFromAxisAngle(yAxis, Math.random() * Math.PI * 2);
            const s = 0.9 + Math.random() * 0.7;
            scl.set(s, s * (0.85 + Math.random() * 0.4), s);
            m.compose(pos, quat, scl);
            inst.setMatrixAt(i, m);
            aWorldXZ[i * 2] = x; aWorldXZ[i * 2 + 1] = z;
        }
        inst.instanceMatrix.needsUpdate = true;
        geo.setAttribute('aWorldXZ', new T.InstancedBufferAttribute(aWorldXZ, 2));
        inst.frustumCulled = false;
        add(inst);
    };

    // ═══ WILDFLOWERS — per-species low-poly 3D blooms (daisy/buttercup/lupine/etc.) ═
    // Real 3D geometry (petals, domed centres, tall lupine/cornflower spikes) built in
    // summer-flora.js with baked vertex colour; one InstancedMesh per species. Wind is the
    // shared height-masked TSL sway+gust (uTime/uBreeze), bent in LOCAL space with a
    // per-instance world-XZ phase (aWorldXZ) — same instancing pattern as the grass.
    const makeFloraMat = ({
        height, amp, stiff, flutter, freq = 1.0,
    }) => {
        const mat = track(new T.MeshBasicNodeMaterial());
        const yN = clamp(positionLocal.y.div(height), 0.0, 1.0);
        const mask = pow(yN, float(stiff));
        const wxz = attribute('aWorldXZ', 'vec2');
        const ph = wxz.x.mul(0.6).add(wxz.y.mul(0.45));
        // `freq` scales ALL time rates — trees pass a very low freq so they drift slowly;
        // the small flowers keep the default (slightly quicker) rate.
        const gustN = mx_noise_float(vec3(wxz.x.mul(0.05).add(uTime.mul(0.16 * freq)), wxz.y.mul(0.05), 0.0));
        const sway = sin(uTime.mul(1.05 * freq).add(ph)).mul(0.7)
            .add(sin(uTime.mul(0.46 * freq).add(ph.mul(1.7))).mul(0.3));
        const gust = gustN.mul(0.5).mul(uBreeze.mul(1.6).add(0.5));
        const bend = sway.add(gust).mul(float(amp)).mul(mask);
        const flut = sin(uTime.mul(5.5 * freq).add(ph.mul(3.0))).mul(float(flutter)).mul(yN);
        // Combo bloom: each flower stands up + opens a little, staggered by its own
        // world-XZ phase so a combo reads as a shimmer/bloom rippling through the
        // real meadow (not a flat exposure flash). uFlowerBloom is the combo scalar.
        const bloomPhase = sin(uTime.mul(1.9).add(ph.mul(2.3))).mul(0.5).add(0.5);
        const bloomAmt = uFlowerBloom.mul(bloomPhase.mul(0.55).add(0.45)).clamp(0.0, 1.0);
        const lift = bloomAmt.mul(yN).mul(0.06);
        mat.positionNode = positionLocal.add(vec3(
            windDir.x.mul(bend).add(flut),
            bend.abs().mul(-0.05).add(lift),
            windDir.y.mul(bend).add(flut.mul(0.5)),
        ));
        const flowerBase = distFog(shade(attribute('color', 'vec3'), faceN));
        // Brighten + warm the petals toward the golden accent as the bloom passes.
        const flowerGlow = flowerBase.mul(1.35).add(uAccent.mul(0.22));
        mat.colorNode = mix(flowerBase, flowerGlow, bloomAmt);
        mat.side = T.DoubleSide;
        return mat;
    };

    // Build the wildflowers from the Blender flower templates (daisy/buttercup + purple/
    // pink/blue floret spikes). Each species → one InstancedMesh; height for the wind mask
    // is read from the (native-proportioned) geometry so spikes stand taller than daisies.
    const buildWildflowers = (geos) => {
        const FLOWERS = Math.max(400, parseInt(P.get('flowers'), 10) || 9000);
        const geoH = (g) => { g.computeBoundingBox(); return (g.boundingBox.max.y - g.boundingBox.min.y) || 1; };
        // Daisy-dominant like the reference; poppies are a scattered red accent (not a carpet).
        const SPECIES = [
            {
                geo: geos.daisy, w: { amp: 0.16, stiff: 1.2, flutter: 0.04 }, frac: 0.42, sMin: 1.3, sMax: 1.9,
            },
            {
                geo: geos.buttercup, w: { amp: 0.20, stiff: 1.1, flutter: 0.05 }, frac: 0.22, sMin: 1.6, sMax: 2.3,
            },
            {
                geo: geos.poppy, w: { amp: 0.18, stiff: 1.1, flutter: 0.05 }, frac: 0.055, sMin: 1.4, sMax: 1.8,
            },
            {
                geo: geos.spikePurple, w: { amp: 0.22, stiff: 1.3, flutter: 0.03 }, frac: 0.14, sMin: 1.2, sMax: 1.8,
            },
            {
                geo: geos.spikeBlue, w: { amp: 0.22, stiff: 1.3, flutter: 0.03 }, frac: 0.12, sMin: 1.2, sMax: 1.8,
            },
            {
                geo: geos.spikePink, w: { amp: 0.22, stiff: 1.3, flutter: 0.03 }, frac: 0.08, sMin: 1.2, sMax: 1.8,
            },
        ].filter((s) => s.geo);
        const m = new T.Matrix4(), pos = new T.Vector3(), quat = new T.Quaternion(), scl = new T.Vector3();
        const yAxis = new T.Vector3(0, 1, 0);
        for (const sp of SPECIES) {
            const count = Math.max(1, Math.round(FLOWERS * sp.frac));
            const geo = track(sp.geo);
            const inst = new T.InstancedMesh(geo, makeFloraMat({ height: geoH(geo), ...sp.w }), count);
            const aWorldXZ = new Float32Array(count * 2);
            for (let i = 0; i < count; i++) {
                const depth = Math.pow(Math.random(), 1.8);
                const z = 12 - 30 * depth; // +12 (near) .. -18 (shoreline)
                const halfW = 13 + (12 - z) * 1.5; // density concentrated near camera
                const x = (Math.random() * 2 - 1) * halfW;
                pos.set(x, 0, z);
                quat.setFromAxisAngle(yAxis, Math.random() * Math.PI * 2);
                const s = sp.sMin + Math.random() * (sp.sMax - sp.sMin);
                scl.set(s, s * (0.9 + Math.random() * 0.3), s);
                m.compose(pos, quat, scl);
                inst.setMatrixAt(i, m);
                aWorldXZ[i * 2] = x; aWorldXZ[i * 2 + 1] = z;
            }
            inst.instanceMatrix.needsUpdate = true;
            geo.setAttribute('aWorldXZ', new T.InstancedBufferAttribute(aWorldXZ, 2));
            inst.frustumCulled = false;
            add(inst);
        }
    };

    // ═══ MAYPOLE (midsommarstång) — rigged GLB, standing beside the cottage ══════
    const maypole = new T.Group();
    maypole.position.set(45, 0, -134); // beside the cottage (72,0,-141), clear of its left edge (~x58), a touch forward
    add(maypole);

    let maypoleGlbMesh = null;
    let maypoleMixer = null;
    const maypoleRings = []; // the two hanging flower wreaths (pivot at the crossbar) — gently sway

    {
        const loader = new GLTFLoader();
        loader.setDRACOLoader(makeDracoLoader());
        loader.load(midsummerPoleUrl, (gltf) => {
            const model = gltf.scene;
            // Render UNLIT + faceted like the other props (cottage/dock/boat) — the GLB
            // carries per-material base colours. The "raise & glow" reactive beat is
            // driven in-shader by uRaise × uAccent (added to colour + emissive for bloom).
            const glow = uAccent.mul(uRaise).mul(0.5);
            model.traverse((o) => {
                if (o.isMesh && o.material) {
                    const src = Array.isArray(o.material) ? o.material[0] : o.material;
                    const hex = src.color ? src.color.getHex() : 0x5e7d38;
                    const mat = track(new T.MeshBasicNodeMaterial());
                    mat.colorNode = shade(cv(hex), faceN).add(glow);
                    mat.emissiveNode = glow;
                    mat.side = T.DoubleSide;
                    o.material = mat;
                    o.frustumCulled = false;
                }
            });
            // Scale to ~19u tall (a touch under the cottage's 20u) + base-seat.
            model.updateMatrixWorld(true);
            const h0 = new T.Box3().setFromObject(model).getSize(new T.Vector3()).y;
            model.scale.setScalar(19 / Math.max(0.001, h0));
            model.updateMatrixWorld(true);
            model.position.y = -new T.Box3().setFromObject(model).min.y;
            maypole.add(model);
            maypoleGlbMesh = model;

            // The two wreaths are separate GLB nodes (RingL/RingR) whose pivot is the
            // crossbar attach point → swing them like pendulums in update().
            ['RingL', 'RingR'].forEach((name) => {
                const r = model.getObjectByName(name);
                if (r) maypoleRings.push({
                    obj: r, bx: r.rotation.x, bz: r.rotation.z, ph: maypoleRings.length * 1.7,
                });
            });
            console.log(`[Summer] Loaded low-poly midsummer pole GLB (${maypoleRings.length} wreaths).`);
        }, undefined, (err) => console.warn('[Summer] Failed to load midsummer pole GLB:', err));
    }

    // ═══ COTTAGE — Blender-modelled low-poly Swedish stuga (GLB) on the far shore ══
    const cottage = new T.Group();
    cottage.position.set(72, 0, -141); // far shore, just beyond the lake, right-of-centre
    cottage.rotation.y = Math.PI - 0.68; // front + right gable toward the lake, turned left (ref)
    add(cottage);
    {
        const loader = new GLTFLoader();
        loader.setDRACOLoader(makeDracoLoader());
        // Traditional Falu-red (Falu rödfärg) plank wall texture. The GLB's `Falu`
        // material ships a flat, *desaturated* factor (renders muddy pink), so we
        // override it here. Base #9E281B = the SAME hue + 83% saturation as the user's
        // #FF2C2C, just at the deep oxide brightness of real Falu red — so it reads
        // rich/saturated (never washed-out) without being fire-engine vivid. Thin
        // darker seams + faint grain give boarded relief. Rendered UNLIT so it shows true.
        const faluTex = (() => {
            const S = 512, cv = document.createElement('canvas');
            cv.width = cv.height = S;
            const g = cv.getContext('2d');
            g.fillStyle = '#a23629'; g.fillRect(0, 0, S, S); // Falu Red accent (#A23629) fills ~95%
            const planks = 7, pw = S / planks;
            g.fillStyle = 'rgba(60,14,9,0.55)'; // thin darker plank seams
            for (let i = 1; i < planks; i++) g.fillRect(Math.round(i * pw) - 1, 0, 2, S);
            for (let i = 0; i < 150; i++) { // faint vertical grain (reds only — keeps saturation)
                const x = (Math.sin(i * 53.13) * 0.5 + 0.5) * S, h = 40 + ((i * 97) % 180), y = (i * 131) % S;
                g.globalAlpha = 0.05; g.fillStyle = (i % 2) ? '#b5402c' : '#761a10';
                g.fillRect(x, y, 1, h);
            }
            g.globalAlpha = 1;
            const tex = new T.CanvasTexture(cv);
            tex.wrapS = tex.wrapT = T.RepeatWrapping;
            tex.repeat.set(2, 1.4);
            tex.colorSpace = T.SRGBColorSpace;
            tex.anisotropy = 4;
            return tex;
        })();
        loader.load(cottageUrl, (gltf) => {
            const model = gltf.scene;
            // Stylized UNLIT cottage (vibrant Falu walls + Firewatch roof) — the ONE
            // realistic touch is the GLASS: a glossy PBR window that mirrors the golden
            // HDRI sky (the rest stays flat so the look + vibrancy are unchanged).
            model.traverse((o) => {
                if (o.isMesh && o.material) {
                    const src = Array.isArray(o.material) ? o.material[0] : o.material;
                    const isWall = src.name && src.name.startsWith('Falu');
                    const isRoof = src.name && src.name.includes('Roof');
                    const isGlass = src.name && src.name.includes('Glass');
                    if (isGlass) {
                        // Glossy PBR glass — reflects the warm sky via scene.environment.
                        const g = track(new T.MeshStandardNodeMaterial());
                        g.color = new T.Color(0x1f2c38); g.roughness = 0.06; g.metalness = 0.0;
                        g.envMapIntensity = 2.4; g.side = T.DoubleSide;
                        o.material = g; o.frustumCulled = false; return;
                    }
                    if (isRoof) {
                        // Firewatch flat-faceted terracotta (unlit) + faint tile courses.
                        const rmat = track(new T.MeshBasicNodeMaterial());
                        const rbase = cv(0xc0512e);
                        const tone = max(dot(faceN, uSunDir), float(0.0)).mul(0.42).add(0.66);
                        const course = sin(positionWorld.y.mul(9.0)).mul(0.5).add(0.5);
                        const line = smoothstep(0.80, 0.98, course).mul(0.13);
                        rmat.colorNode = rbase.mul(tone).mul(float(1.0).sub(line));
                        rmat.side = T.DoubleSide;
                        o.material = rmat; o.frustumCulled = false; return;
                    }
                    const map = isWall ? faluTex : (src.map || null);
                    const basic = new T.MeshBasicMaterial({
                        map,
                        color: map ? 0xffffff : (src.color ? src.color.clone() : new T.Color(0xffffff)),
                        side: T.DoubleSide,
                    });
                    if (src.transparent) { basic.transparent = true; basic.opacity = src.opacity; }
                    o.material = basic;
                    o.frustumCulled = false;
                }
            });
            // Scale to ~20u tall (a touch over the maypole's ~19u) + base-seat on the ground.
            model.updateMatrixWorld(true);
            const h0 = new T.Box3().setFromObject(model).getSize(new T.Vector3()).y;
            model.scale.setScalar(20 / Math.max(0.001, h0));
            model.updateMatrixWorld(true);
            model.position.y = -new T.Box3().setFromObject(model).min.y;
            cottage.add(model);
            console.log('[Summer] Loaded Swedish cottage GLB.');
        }, undefined, (err) => console.warn('[Summer] cottage GLB failed:', err));
    }

    // (Far treeline is now GLB silhouette trees from summer-trees.js — no flat cones.)

    // ═══ DOCK + ROWBOAT — Blender-modelled wooden jetty + rowboat on the lake ════════
    // Aligned to the reference: the jetty juts from the cottage-side bank out over the
    // water, with the warm-wooden rowboat moored beside it. The boat gently sways.
    let boatSway = null;
    {
        const loader = new GLTFLoader();
        loader.setDRACOLoader(makeDracoLoader());
        loader.load(dockBoatUrl, (gltf) => {
            const root = gltf.scene;
            const dockObj = root.getObjectByName('Dock');
            const boatObj = root.getObjectByName('Rowboat');
            // Unlit faceted shading (matches the scene's flat low-poly props).
            root.traverse((o) => {
                if (o.isMesh && o.material) {
                    const hex = o.material.color ? o.material.color.getHex() : 0x8a7355;
                    const m = track(new T.MeshBasicNodeMaterial());
                    m.colorNode = shade(cv(hex), faceN);
                    m.side = T.DoubleSide;
                    o.material = m;
                    o.frustumCulled = false;
                }
            });
            // DOCK — static jetty jutting from the cottage bank into the lake.
            if (dockObj) {
                const dock = new T.Group();
                dock.position.set(44, 0.30, -104); // far lake just left of the cottage, into the water (reference)
                dock.rotation.y = -0.5;
                dock.scale.setScalar(3.8);
                dock.add(dockObj);
                add(dock);
            }
            // ROWBOAT — moored right beside the dock; bobs + rocks gently (see update()).
            if (boatObj) {
                const boat = new T.Group();
                boat.position.set(32, 0.42, -100); // at the dock's water end, left of it (reference)
                boat.rotation.y = 0.4;
                boat.scale.setScalar(4.2);
                boat.add(boatObj);
                add(boat);
                boatSway = { group: boat, baseY: boat.position.y, phase: 1.3 };
            }
            console.log('[Summer] Loaded dock + rowboat GLB.');
        }, undefined, (err) => console.warn('[Summer] dock/boat GLB failed:', err));
    }

    // ═══ LAKE MIST — soft warm haze hugging the far shore / water ════════════════
    {
        const mistMat = track(new T.MeshBasicNodeMaterial());
        const driftN = mx_noise_float(vec3(positionWorld.x.mul(0.02).add(uTime.mul(0.02)), uTime.mul(0.01), 0.0));
        mistMat.colorNode = cv(0xf3e3cf);
        // Dense near the water, fading up; gently broken by noise.
        mistMat.opacityNode = smoothstep(0.62, 0.0, uv().y).mul(driftN.mul(0.2).add(0.34));
        mistMat.transparent = true;
        mistMat.depthWrite = false;
        mistMat.fog = false;
        mistMat.toneMapped = false;
        const mist = add(new T.Mesh(track(new T.PlaneGeometry(340, 16)), mistMat));
        mist.position.set(0, 2.6, -126);
    }

    // ═══ FIREFLIES & POLLEN — drifting golden-hour motes (additive billboards) ═══════
    // Two kinds share one instanced field: gentle warm POLLEN dust that shimmers, and
    // brighter yellow-green FIREFLIES that blink/twinkle independently. All drift on a
    // slow multi-frequency current. Additive over the dark meadow → they glow; invisible
    // against the bright sky (as real motes are).
    {
        const MOTES = Math.max(200, parseInt(P.get('motes'), 10) || 720);
        const moteGeo = track(new T.PlaneGeometry(0.17, 0.17)); // faces +Z ≈ camera
        const moteMat = track(new T.MeshBasicNodeMaterial());
        const fi = float(instanceIndex);
        const ph = fract(sin(fi.mul(91.17)).mul(7841.3));
        const ph2 = fract(sin(fi.mul(33.71)).mul(1287.7));
        const kind = fract(sin(fi.mul(57.31)).mul(4517.1));
        const isFly = smoothstep(0.60, 0.64, kind); // ~0 = pollen, ~1 = firefly (~36% are flies)

        // Slow organic multi-frequency drift (positionNode runs pre-instanceMatrix).
        const t = uTime.add(ph.mul(6.283));
        const drift = vec3(
            sin(t.mul(0.5)).mul(0.6).add(sin(t.mul(0.21).add(ph2.mul(6.0))).mul(0.3)),
            sin(t.mul(0.4).add(ph2.mul(6.0))).mul(0.35).add(sin(uTime.mul(0.15).add(ph.mul(3.0))).mul(0.25)),
            cos(t.mul(0.45)).mul(0.6),
        );
        moteMat.positionNode = positionLocal.add(drift);

        const pr = uv().sub(0.5).mul(2.0);
        const fall = pow(clamp(float(1.0).sub(length(pr)), 0.0, 1.0), float(2.2)); // soft round glow
        // Twinkle: fireflies pulse fast + sharp (blink); pollen shimmers slow + soft.
        const twk = pow(
            sin(uTime.mul(mix(float(1.1), float(3.0), isFly)).add(ph.mul(6.283))).mul(0.5).add(0.5),
            mix(float(1.0), float(2.6), isFly),
        );
        const twinkle = mix(float(0.7).add(twk.mul(0.45)), float(0.1).add(twk.mul(1.0)), isFly);
        // Colour: pollen warm cream, fireflies warm yellow-green; fireflies brighter.
        const col = mix(cv(0xffe7ad), cv(0xd9ff86), isFly.mul(0.7));
        const bright = mix(float(1.0), float(2.1), isFly);
        moteMat.colorNode = col.mul(fall).mul(bright).mul(twinkle);
        moteMat.opacityNode = fall.mul(twinkle).mul(float(0.42).add(uSparkle.mul(0.5)).add(uWarmth.mul(0.1)));
        moteMat.emissiveNode = col.mul(fall).mul(twinkle).mul(isFly.mul(1.2).add(0.3)); // feeds bloom (flies glow most)
        moteMat.transparent = true;
        moteMat.depthWrite = false;
        moteMat.blending = T.AdditiveBlending;
        moteMat.toneMapped = false;

        const motes = new T.InstancedMesh(moteGeo, moteMat, MOTES);
        const m = new T.Matrix4();
        const pos = new T.Vector3();
        const q = new T.Quaternion(); // identity → quads face the camera
        const s = new T.Vector3();
        for (let i = 0; i < MOTES; i++) {
            const z = 12 - 52 * Math.random(); // +12 (near) .. -40 (mid-lake air)
            const x = (Math.random() * 2 - 1) * (16 + (12 - z) * 1.3);
            const y = 0.3 + Math.random() * 6.5;
            pos.set(x, y, z);
            const sc = 0.45 + Math.random() * 1.4;
            s.set(sc, sc, sc);
            m.compose(pos, q, s);
            motes.setMatrixAt(i, m);
        }
        motes.instanceMatrix.needsUpdate = true;
        motes.frustumCulled = false;
        add(motes);
    }

    // ═══ GOD-RAYS — warm light shafts slanting from the low sun (additive billboards) ═
    // Cheap volumetric look: a fan of soft additive quads facing the camera, slanted
    // toward the sun and depth-TESTED so the foreground trees occlude them → rays read
    // as filtering "through the trees". No post-process pass. Disable with ?godrays=0.
    if (P.get('godrays') !== '0') {
        const shaftMat = track(new T.MeshBasicNodeMaterial());
        const su = uv();
        const edge = pow(clamp(float(1.0).sub(su.x.sub(0.5).abs().mul(2.0)), 0.0, 1.0), float(1.7)); // soft sides
        const vert = su.y.mul(smoothstep(1.0, 0.78, su.y)).add(0.04); // bright top, soft tip
        const flick = sin(positionWorld.x.mul(0.25).add(uTime.mul(0.5))).mul(0.14).add(0.86); // gentle shimmer
        const glow = edge.mul(vert).mul(flick);
        shaftMat.colorNode = cv(0xffe6ad).mul(glow);
        shaftMat.opacityNode = glow.mul(float(0.17).add(uSparkle.mul(0.22)));
        shaftMat.emissiveNode = cv(0xffe6ad).mul(glow).mul(0.4);
        shaftMat.transparent = true;
        shaftMat.depthWrite = false; // depthTEST stays on → trees occlude the shafts
        shaftMat.blending = T.AdditiveBlending;
        shaftMat.toneMapped = false;
        shaftMat.side = T.DoubleSide;

        const SHAFTS = 11;
        for (let i = 0; i < SHAFTS; i++) {
            const geo = track(new T.PlaneGeometry(4 + Math.random() * 5, 48 + Math.random() * 34));
            const shaft = new T.Mesh(geo, shaftMat);
            // Fanned across the sun side (it glows upper-right), high in the air over the lake.
            shaft.position.set(
                -8 + (i / (SHAFTS - 1)) * 92 + (Math.random() - 0.5) * 8,
                16 + Math.random() * 11,
                -68 - Math.random() * 36,
            );
            shaft.rotation.z = -0.30 - Math.random() * 0.42; // slant toward the upper-right sun
            shaft.rotation.y = (Math.random() - 0.5) * 0.25;
            shaft.renderOrder = 3;
            shaft.frustumCulled = false;
            add(shaft);
        }
    }

    // ═══ BIRDS — Chapter-3 skinned songbirds (goldfinch + swallow), reused ═══════
    // Loaded async (GLB + skeletal "Flap" clip); they keep their baked vertex colours
    // (flat unlit, to match the stylised look) and fly lazy circles over the lake/meadow.
    const birds = [];
    const birdMats = [];
    if (!P.has('noBirds')) {
        // Further out + roaming. yawOffset aligns each GLB's nose to its heading.
        const BIRD_FLIGHTS = [
            {
                assetId: 'swallow-flying', center: [-22, -88], radius: 44, height: 27, speed: 0.135, scale: 1.05, bob: 2.4, offset: 0.0, yawOffset: 0,
            },
            {
                assetId: 'goldfinch-flying', center: [26, -80], radius: 36, height: 22, speed: 0.16, scale: 0.92, bob: 1.8, offset: 2.3, yawOffset: 0,
            },
            {
                assetId: 'swallow-flying', center: [-4, -104], radius: 58, height: 34, speed: 0.105, scale: 1.12, bob: 2.8, offset: 4.1, yawOffset: 0,
            },
            {
                assetId: 'goldfinch-flying', center: [40, -98], radius: 30, height: 25, speed: 0.185, scale: 0.85, bob: 1.5, offset: 5.5, yawOffset: 0,
            },
        ];
        const loadBird = async (flight) => {
            const record = getChapter3FlyingBirdAssetById(flight.assetId);
            if (!record?.url) return;
            const gltf = await loadOdysseyGltfCached(record.url);
            const model = gltf.scene;
            model.traverse((c) => {
                if (!c.isMesh) return;
                c.frustumCulled = false;
                c.castShadow = false;
                c.receiveShadow = false;
                const mats = Array.isArray(c.material) ? c.material : [c.material];
                const repl = mats.map(() => {
                    const mm = new T.MeshBasicMaterial({
                        color: 0xffffff, vertexColors: true, side: T.DoubleSide, toneMapped: false,
                    });
                    birdMats.push(mm);
                    return mm;
                });
                c.material = Array.isArray(c.material) ? repl : repl[0];
            });
            model.scale.setScalar((record.runtimeScale ?? 4.4) * (flight.scale ?? 1));
            const root = new T.Group();
            root.rotation.order = 'YXZ'; // yaw → pitch → roll (natural flight orientation)
            root.add(model);
            add(root);
            let mixer = null;
            if (gltf.animations.length) {
                mixer = new T.AnimationMixer(model);
                gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            }
            birds.push({ root, mixer, ...flight });
        };
        BIRD_FLIGHTS.forEach((f) => { loadBird(f).catch((e) => console.warn('[summer] bird load failed', e)); });
    }

    // ═══ VEGETATION — load the Blender models (summer_flora.glb) and build everything ═
    // One GLB holds the spruce/pine/birch + daisy/buttercup/3 floret-spikes + grass tuft.
    // Each template's per-material colours are baked into one vertex-coloured geometry,
    // then all of it runs through the shared instanced TSL-wind pipeline so the whole
    // meadow + forest sway off the one uTime/uBreeze clock.
    let summerTrees = null;
    if (!P.has('noTrees')) {
        new GLTFLoader().load(summerFloraUrl, (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            const get = (n, opts) => extractColoredGeo(gltf.scene.getObjectByName(n), opts);
            const treeGeos = {
                spruce: get('T_Spruce', { unit: true }),
                pine: get('T_Pine', { unit: true }),
                birch: get('T_Birch', { unit: true }),
            };
            const flowerGeos = {
                daisy: get('F_Daisy'),
                buttercup: get('F_Buttercup'),
                poppy: get('F_Poppy'),
                spikePurple: get('F_SpikePurple'),
                spikePink: get('F_SpikePink'),
                spikeBlue: get('F_SpikeBlue'),
            };
            buildGrassTufts(get('F_Grass'));
            buildWildflowers(flowerGeos);
            summerTrees = createSummerTrees(scene, { makeTreeMat: makeFloraMat, treeGeos });
            summerTrees.placeForest();
            console.log('[Summer] Built meadow + forest from Blender summer_flora.glb');
        }, undefined, (e) => console.warn('[summer] summer_flora.glb failed:', e));
    }

    // ═══ POST — MRT emissive bloom (only the sun / water-glitter / window / flecks glow) ═
    // The 'emissive' MRT channel captures only materials with an emissiveNode, so bloom is
    // art-directed (not a luminance threshold).
    // ⚠️ DISABLED BY DEFAULT (opt-in via ?bloom): the MRT bloom pass currently blacks out
    // most of the frame in this WebGPU pipeline (renders the scene only in a thin right
    // strip) — a render-target/MRT regression still to be diagnosed. The scene reads well
    // without it (the sun glow comes from the sky emissive gradient). Direct render is used
    // when postProcessing is null (see controller.render).
    let postProcessing = null;
    let bloomNode = null;
    if (P.has('bloom')) {
        postProcessing = new T.PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        scenePass.setMRT(mrt({ output, emissive }));
        const sceneColor = scenePass.getTextureNode('output');
        const emissiveTex = scenePass.getTextureNode('emissive');
        bloomNode = bloom(emissiveTex, 0.45, 0.66, 0.0); // threshold 0 — emissive is already only the glow
        const vuv = viewportUV;
        const d = length(vuv.sub(vec2(0.5, 0.5)));
        const lit = sceneColor.add(bloomNode);
        const vigF = smoothstep(0.34, 0.96, d); // 0 centre → 1 edge
        const graded = lit.rgb.mul(float(1.0).sub(vigF.mul(0.2)));
        const dth = fract(sin(dot(vuv.mul(317.0), vec2(127.1, 269.5))).mul(43758.5)).sub(0.5).mul(0.0022);
        postProcessing.outputNode = vec4(clamp(graded.add(vec3(dth)), 0.0, 1.0), 1.0);
    }

    // ── pointer parallax ────────────────────────────────────────────────────────
    const mouse = {
        x: 0, y: 0, tx: 0, ty: 0,
    };
    const onPointer = (e) => {
        mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
    };
    if (typeof window !== 'undefined') window.addEventListener('pointermove', onPointer);

    const maypoleBaseY = maypole.position.y;
    let lastT = 0;

    // Meandering flight path: a slow loop perturbed by faster offset loops so it
    // never reads as a perfect circle; gentle independent altitude drift.
    const birdPos = (b, tt, out) => {
        const t = tt * b.speed + b.offset;
        const r = b.radius;
        out[0] = b.center[0] + Math.cos(t) * r + Math.sin(t * 1.7 + b.offset) * r * 0.3;
        out[2] = b.center[1] + Math.sin(t * 0.9) * r + Math.cos(t * 1.33 + b.offset) * r * 0.24;
        out[1] = b.height
            + Math.sin(tt * 0.5 + b.offset) * b.bob
            + Math.sin(tt * 1.7 + b.offset * 1.4) * b.bob * 0.32;
    };
    const _bp = [0, 0, 0];
    const _ba = [0, 0, 0];
    const _bb = [0, 0, 0];

    // ── Midsummer Promise gameplay FX ───────────────────────────────────────────
    // Discrete dew-lock seals + seven-flower ring dance. Renderer-neutral routing
    // turns canonical events (fed by the theme via pulse()) into pooled commands
    // the FX drains each frame. Idle-cheap: zero draws when nothing is active.
    const initialReducedMotion = P.has('reducedMotion') || P.has('reduced');
    const gameplayRouting = new SummerGameplayRouting({ reducedMotion: initialReducedMotion });
    const gameplayFx = createSummerGameplayFX({
        scene,
        camera,
        isWebGPU: renderer?.backend?.isWebGPUBackend === true,
        quality: P.get('quality') || 'High',
        reducedMotion: initialReducedMotion,
        effectPlaneZ: 3,
    });

    // Playground-only: `?comboSim=N` freezes the scene into a combo-N reacted
    // state (the theme drives setReactive in-game; the playground idles). Lets a
    // capture show the living-meadow response without a running game.
    const comboSim = parseInt(P.get('comboSim'), 10);
    if (Number.isFinite(comboSim) && comboSim > 0) {
        const c = Math.min(1, comboSim / 10);
        uWarmth.value = 0.25 + c * 0.5;
        uSparkle.value = 0.35 + c * 0.65;
        uBreeze.value = 0.3 + c * 0.5;
        uFlare.value = Math.min(1, c * 1.2);
        uFlowerBloom.value = Math.min(1, 0.35 + c * 0.65);
        uAccent.value.set(1.0, 0.86, 0.55);
    }

    // ── controller ────────────────────────────────────────────────────────────
    return {
        cameraRadius: 24,
        // Theme bridge: canonical gameplay events arrive here with full payloads.
        pulse(kind, payload) {
            gameplayRouting.dispatch(kind, payload || {});
        },
        // Theme bridge: live quality / reduced-motion / enable state.
        configureGameplay({ quality, reducedMotion, intensity } = {}) {
            if (quality !== undefined) gameplayFx.setQuality(quality);
            if (reducedMotion !== undefined) {
                gameplayRouting.setReducedMotion(reducedMotion);
                gameplayFx.setReducedMotion(reducedMotion);
            }
            if (intensity !== undefined) {
                gameplayRouting.setIntensityMultiplier(intensity);
                gameplayFx.setIntensity(intensity);
            }
        },
        camera(time, cam) {
            mouse.x += (mouse.tx - mouse.x) * 0.05;
            mouse.y += (mouse.ty - mouse.y) * 0.05;
            const sway = Math.sin(time * 0.05) * 0.6 + mouse.x * 1.6;
            const lift = 6.0 - mouse.y * 0.5;
            // Standing at the meadow's edge looking across the lake. Camera raised + a
            // gentle down-tilt so the LAKE reads as a prominent lower-centre band (~13%
            // of frame, matching the reference) rather than a thin distant strip; the
            // look target is panned LEFT so the right-bank cottage + dock + boat sit in
            // the right third.
            cam.position.set(6 + sway, lift, 14 + Math.sin(time * 0.04) * 0.5);
            cam.lookAt(-6 + sway * 0.2, 1.2, -78);
        },
        update(time) {
            const dt = Math.min(0.05, Math.max(0, time - lastT));
            lastT = time;
            uTime.value = time;
            // Drain routed gameplay commands into the FX pools, then advance them on
            // the authoritative clock (idle-cheap when no events are active).
            const gameplayCommands = gameplayRouting.drainCommands();
            for (let i = 0; i < gameplayCommands.length; i++) gameplayFx.enqueue(gameplayCommands[i]);
            gameplayFx.update(time);
            // Director-driven uniforms are written by the wrapper via setReactive();
            // in the playground they idle. Maypole raise beat:
            maypole.position.y = maypoleBaseY + uRaise.value * 0.9;
            // Birds: advance the Flap clip + meandering flight, facing the heading
            // with pitch (climb/dive) and roll banked into each turn.
            for (let i = 0; i < birds.length; i++) {
                const b = birds[i];
                b.mixer?.update(dt);
                birdPos(b, time, _bp);
                birdPos(b, time + 0.08, _ba);
                birdPos(b, time + 0.16, _bb);
                b.root.position.set(_bp[0], _bp[1], _bp[2]);
                const dx = _ba[0] - _bp[0];
                const dy = _ba[1] - _bp[1];
                const dz = _ba[2] - _bp[2];
                const horiz = Math.hypot(dx, dz) || 1e-4;
                const yaw0 = Math.atan2(dx, dz);
                b.root.rotation.y = yaw0 + (b.yawOffset ?? 0);
                b.root.rotation.x = Math.max(-0.45, Math.min(0.45, -Math.atan2(dy, horiz) * 0.7));
                let dyaw = Math.atan2(_bb[0] - _ba[0], _bb[2] - _ba[2]) - yaw0;
                while (dyaw > Math.PI) dyaw -= Math.PI * 2;
                while (dyaw < -Math.PI) dyaw += Math.PI * 2;
                b.root.rotation.z = Math.max(-0.55, Math.min(0.55, -dyaw * 5.0));
            }
            // Update GLB tree wind sway + LOD switching
            summerTrees?.update(dt, camera);

            // Rowboat: gentle bob + rock on the calm lake (keeps base yaw).
            if (boatSway) {
                const g = boatSway.group;
                g.position.y = boatSway.baseY + Math.sin(time * 0.9 + boatSway.phase) * 0.06;
                g.rotation.z = Math.sin(time * 0.7 + boatSway.phase) * 0.045;
                g.rotation.x = Math.sin(time * 1.15 + boatSway.phase * 1.5) * 0.025;
            }

            // Maypole "raise & glow" beat is driven in-shader (uRaise × uAccent) + the
            // raise LIFT applied above. The two flower wreaths swing gently like pendulums
            // (more in a breeze, with a little extra swing on the raise beat).
            if (maypoleMixer) maypoleMixer.update(dt);
            if (maypoleRings.length) {
                const amp = 0.07 + uBreeze.value * 0.06 + uRaise.value * 0.05;
                for (const r of maypoleRings) {
                    r.obj.rotation.x = r.bx + Math.sin(time * 0.85 + r.ph) * amp;
                    r.obj.rotation.z = r.bz + Math.sin(time * 0.63 + r.ph + 0.6) * amp * 0.8;
                }
            }
        },
        // Owns the render so the MRT bloom pass is applied (both hosts call this if present).
        render() {
            if (postProcessing) postProcessing.render();
            else renderer.render(scene, camera);
        },
        renderAsync() {
            if (postProcessing) return postProcessing.renderAsync();
            return renderer.renderAsync(scene, camera);
        },
        // Bridge for the theme wrapper: push SeasonDirector state into uniforms.
        setReactive(s) {
            uWarmth.value = s.warmth;
            uBreeze.value = s.breeze;
            uSparkle.value = s.sparkle;
            uRaise.value = s.raise;
            uFlare.value = s.flare ?? 0;
            uFlowerBloom.value = s.flowerBloom ?? 0;
            uAccent.value.set(s.accent.r, s.accent.g, s.accent.b);
        },
        dispose() {
            if (typeof window !== 'undefined') window.removeEventListener('pointermove', onPointer);
            gameplayRouting.dispose();
            gameplayFx.dispose();
            birds.forEach((b) => b.mixer?.stopAllAction?.());
            birdMats.forEach((m) => m.dispose?.());
            summerTrees?.dispose?.();
            if (maypoleMixer) {
                maypoleMixer.stopAllAction();
            }
            if (maypoleGlbMesh) {
                maypoleGlbMesh.traverse((o) => {
                    if (o.isMesh) {
                        o.geometry?.dispose();
                        o.material?.dispose();
                    }
                });
            }
            objects.forEach((o) => scene.remove(o));
            reflectionNode?.dispose?.();
            disposeBloomNodeDeep(bloomNode);
            postProcessing?.dispose?.();
            disposables.forEach((d) => d.dispose?.());
        },
    };
}
