// ═══════════════════════════════════════════════════════════════════════════════
// Odyssey Ch3 "Surface World" — masterpiece rebuild, HERO element: the Golden Emergence lake.
//
// See docs/ODYSSEY_CH3_SURFACE_WORLD_REBUILD_PLAN.md (visual-upgrade-first track). The camera
// surfaces out of the deep-ocean blue into a still golden-hour lake: a low front-left sun
// (SURFACE_SUN_DIR) rakes a molten sun-glint pillar across the water while a REAL reflector()
// planar mirror folds a dark layered treeline + the graded peach->azure sky dome at the
// waterline. This is the one thing the shipped Ch3 lake lacks — the current
// buildGoldenWaterMaterial fakes tree reflections with uv.y sines (surface-world.tsl.js:566-575)
// and reads as a copper sheet; a genuine mirror makes it a mirror.
//
// Self-contained (Ch3 palette + SURFACE_SUN_DIR baked in) so the proven technique ports back
// into the chapter's own buildGoldenWaterMaterial later, rather than importing a theme material.
// Pattern proven by src/playground/effects/golden-forest-water.effect.js (reflector wiring) and
// the swedish-forest golden-water memory (analytic-only reads as copper until a real reflector +
// dark treeline + sun are present — so this isolation deliberately includes both).
// ═══════════════════════════════════════════════════════════════════════════════

import * as THREE from 'three/webgpu';
import {
    uniform, uv, screenUV, positionWorld, positionLocal, cameraPosition,
    normalize, dot, clamp, pow, mix, vec2, vec3, float, sin, smoothstep, oneMinus, length,
    reflector, fog, rangeFogFactor, color,
} from 'three/tsl';
import {
    createSkyBackgroundTSL,
    createSunRaysTSL,
    SURFACE_SUN_DIR,
} from '../../rendering/odyssey/chapter-environments/surface-world.tsl.js';

export const meta = {
    id: 'surface-world-hero-lake',
    title: 'Surface World — Golden Emergence lake (Ch3 hero · real mirror)',
    description: 'Ch3 hero: real reflector() mirror-lake folding a dark treeline + golden sun',
};

const REFLECTION_LAYER = 2;
// Lake world constants (from surface-world.tsl.js: SURFACE_LAKE_CENTER {x:-30,z:-150}, surface
// world Y = surfaceOffsetY(-15) + seaYOffset(3.0) + 0.4 = -11.6).
const LAKE_X = -30;
const LAKE_Z = -150;
const WATER_Y = -11.6;

export function create({ scene, camera, renderer }) {
    const uTime = uniform(0);
    const uSeason = uniform(0.12); // early-spring golden hour
    const disposables = [];
    const own = (o) => { disposables.push(o); return o; };
    const root = new THREE.Group();
    root.name = 'ch3-hero-lake';
    scene.add(root);

    const prev = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, fogNode: scene.fogNode };
    // The glint pillar intentionally overshoots >1 (relies on ACES downstream); the bare
    // playground is NoToneMapping and would clip flat white, so hand ACES to the renderer here.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Warm aerial haze toward the far shore (distance only — height fog is fiddly at this scale).
    // Matches the horizon band so the treeline dissolves into golden-hour air, not a hard card.
    scene.fogNode = fog(color(0xe9b878), rangeFogFactor(60, 360));

    // ── 1. Graded sky dome (mirrored) — the CH3 golden-hour sky, on the reflection layer ──
    const sky = createSkyBackgroundTSL(uTime, { uSeason });
    sky.material.fog = false; // the dome IS the horizon — never fog the backdrop
    sky.mesh.layers.enable(REFLECTION_LAYER);
    root.add(sky.mesh);

    // ── 2. Dark layered treeline (mirrored) — the value floor the mirror folds at the waterline ──
    // Two flank wings with an open central gap toward the sun/peaks (BotW composition, matching
    // the chapter's createTreeLineTSL intent). Near-black forest green so it reads as silhouette.
    const coneGeo = own(new THREE.ConeGeometry(1, 1, 6)); // unit cone, scaled per instance
    // Warm near-black, fog OFF → dramatic golden-hour silhouettes against the bright sky (and their
    // dark mirror reflections then match). Fog-hazed trees read tan/flat and clash with the mirror.
    const treeMat = own(new THREE.MeshBasicNodeMaterial({ color: 0x0d0a06 }));
    treeMat.fog = false;
    const MAX_TREES = 60;
    const trees = new THREE.InstancedMesh(coneGeo, treeMat, MAX_TREES);
    trees.frustumCulled = false;
    trees.layers.enable(REFLECTION_LAYER);
    const m4 = new THREE.Matrix4();
    const q0 = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const po = new THREE.Vector3();
    let ti = 0;
    const placeTree = (x, z) => {
        if (ti >= MAX_TREES) return;
        const h = 11 + Math.random() * 17;
        const r = 3.2 + Math.random() * 3.2;
        po.set(x + (Math.random() - 0.5) * 9, WATER_Y + h * 0.5, z + (Math.random() - 0.5) * 12);
        sc.set(r, h, r);
        m4.compose(po, q0, sc);
        trees.setMatrixAt(ti, m4);
        ti += 1;
    };
    // Left wing (x -122..-56) + right wing (x 8..70), central gap (~-56..8) open toward the sun.
    for (let k = 0; k < 22; k += 1) placeTree(-122 + (66 * k) / 21, -222 - (k % 2) * 14);
    for (let k = 0; k < 20; k += 1) placeTree(8 + (62 * k) / 19, -222 - (k % 2) * 14);
    // A few near-side flank trees for depth on the left bank.
    for (let k = 0; k < 8; k += 1) placeTree(-118, -150 + (60 * k) / 7);
    trees.count = ti;
    trees.instanceMatrix.needsUpdate = true;
    root.add(trees);

    // ── 3. Real planar mirror (THE hero upgrade — Ch3 has none today) ──
    const reflection = reflector({ resolutionScale: 0.5, bounces: false, generateMipmaps: false });
    reflection.target.rotateX(-Math.PI / 2);
    reflection.target.position.set(0, WATER_Y, 0); // mirror plane at the water surface
    root.add(reflection.target);
    // Virtual camera renders ONLY layer 2 (sky dome + treeline) — never the water/target, so no
    // mirror feedback; keep the mirrored set to the cheap silhouette layer (TDR/cost discipline).
    reflection.reflector.getVirtualCamera(camera).layers.set(REFLECTION_LAYER);

    // ── 4. Hero golden water: fresnel-weighted mirror mix + sun-glint pillar ──
    const sunDir = vec3(SURFACE_SUN_DIR.x, SURFACE_SUN_DIR.y, SURFACE_SUN_DIR.z); // low front-left
    const rt = uTime.mul(0.5);
    // Calm drifting surface tilt (a lake, not chop) — two low-freq sines.
    const wob = sin(positionWorld.x.mul(0.09).add(rt))
        .add(sin(positionWorld.z.mul(0.13).sub(rt.mul(0.8)))).mul(0.5);
    const nrm = normalize(vec3(wob.mul(0.06), float(1.0), wob.mul(0.05)));
    const eye = normalize(cameraPosition.sub(positionWorld));
    const dist = length(cameraPosition.sub(positionWorld));
    const depthF = smoothstep(20.0, 240.0, dist);

    // Reduced-fresnel: dark cool-teal head-on, full mirror only at the grazing far rim.
    const fres = pow(oneMinus(clamp(dot(eye, nrm), 0.0, 1.0)), float(5.0)).mul(0.9).add(0.06);
    // Ripple-distort the reflector UV (flipX() base is REQUIRED to match the stored reflection UV).
    const reflUV = screenUV.flipX().add(vec2(wob.mul(0.022), wob.mul(0.011)));
    const mirror = reflection.sample(reflUV).rgb;
    const bodyCol = mix(vec3(0.035, 0.13, 0.16), vec3(0.06, 0.22, 0.26), depthF); // cool teal
    let waterColor = mix(bodyCol, mirror, fres);

    // Golden sun-glint pillar (camera-relative half-vector spec) — the golden-hour signature.
    const halfV = normalize(sunDir.add(eye));
    const sd = clamp(dot(nrm, halfV), 0.0, 1.0);
    const shimmer = sin(positionWorld.x.mul(0.4).add(rt.mul(3.0)))
        .mul(sin(positionWorld.z.mul(0.5).sub(rt.mul(2.0)))).mul(0.5).add(0.5);
    // Tamed core (2.2 -> 1.3) so the near-camera glint reads molten GOLD, not a blown-white hole.
    const pillar = pow(sd, float(90.0)).mul(1.3).add(pow(sd, float(14.0)).mul(0.26))
        .mul(shimmer.mul(0.5).add(0.6))
        .mul(vec3(1.0, 0.72, 0.34));
    waterColor = waterColor.add(pillar);

    const waterMat = own(new THREE.MeshBasicNodeMaterial());
    waterMat.colorNode = waterColor;
    // Soft radial shore dissolve (plane centre uv 0.5) so the pool blends into the bank.
    const vUv = uv();
    const edge = oneMinus(smoothstep(0.82, 1.0, length(vUv.sub(0.5)).mul(2.0)));
    waterMat.opacityNode = edge;
    // Vertex ripple — phase from positionLocal (NOT positionWorld) to avoid a circular node dep.
    const nLocal = sin(positionLocal.x.mul(0.11).add(rt))
        .add(sin(positionLocal.z.mul(0.09).sub(rt.mul(0.8))));
    waterMat.positionNode = positionLocal.add(vec3(0.0, nLocal.mul(0.16), 0.0));
    waterMat.transparent = true;
    waterMat.depthWrite = false;
    waterMat.side = THREE.DoubleSide;

    const waterGeo = own(new THREE.PlaneGeometry(200, 200, 40, 40));
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(LAKE_X, WATER_Y, LAKE_Z);
    water.frustumCulled = false;
    water.renderOrder = 10; // transparent, after the opaque sky/treeline
    root.add(water); // NOT on layer 2 → never mirrored (no feedback)

    // ── 5. Volumetric god-ray shafts fanning from the low sun (chapter's own builder) ──
    // Reuse createSunRaysTSL so the shafts match in-game and port for free (7 additive beams
    // collapsed into ONE InstancedMesh). No bloom in the bare playground → they read as soft
    // additive streaks (in-game the pipeline blooms them); opacity nudged up to compensate.
    const rays = createSunRaysTSL(uTime, { uSeason });
    own(rays.material);
    own(rays.geometry);
    rays.group.position.set(10, -6, -115); // beams straddle the far treeline, left/sun side
    rays.uniforms.uOpacity.value = 0.9;
    root.add(rays.group);

    return {
        // Low grazing hero framing toward the low front-left sun: horizon high-third (golden-hour
        // sky-heavy), the sun-glint pillar rakes down toward the lens, mirror fills the lower frame.
        camera(time, cam) {
            cam.position.set(0, -7.6, -64);
            cam.lookAt(-34, -5.5, -178);
            cam.fov = 50;
            cam.near = 0.1;
            cam.far = 6000;
            cam.updateProjectionMatrix();
        },
        update(time) {
            uTime.value = time;
            uSeason.value = 0.12;
        },
        resize() {},
        dispose() {
            scene.remove(root);
            reflection.dispose?.();
            trees.dispose?.();
            disposables.forEach((o) => o.dispose?.());
            renderer.toneMapping = prev.toneMapping;
            renderer.toneMappingExposure = prev.exposure;
            scene.fogNode = prev.fogNode;
        },
    };
}
