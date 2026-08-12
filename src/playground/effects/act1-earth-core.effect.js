/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * ACT I — EARTH CORE: the value study.
 *
 * Wave 1 of docs/ODYSSEY_ACT_I_REBIRTH_PLAN_2026-08.md. This is the proving ground for the
 * rebuilt chapter's SHAPE and VALUE STRUCTURE, not a port target: everything here exists to
 * answer "does the Laputa device carry a molten cavern?" before a single line lands in
 * `earth-core.js`.
 *
 * THE DEVICE (plan §2.1, Castle in the Sky's levistone mine): a cavern reads as a cavern
 * because it is DARK, and the light that survives is a character. The shipped chapter fails
 * the opposite way — measured ~90 % mid-red, ember glow everywhere, so light is nowhere.
 * Here:
 *
 *   - ONE warm key: the lava lake BELOW the camera. Nothing else emits white-hot light.
 *   - Everything else is RESPONSE. Vault veins are darkness-gated (they brighten only where
 *     the key does not reach — the levistone rule inverted into ember). Columns take a rim
 *     from the lake and nothing from the front. Embers are transmitted light: bright against
 *     black, invisible against the lake.
 *   - ONE cool accent, ≤2 % of frame: the crack shafts leaking surface light from the vault
 *     mouth. That is the whole colour-script foreshadow of Act II, and it is deliberately
 *     starved so the eye reads it as distant rather than as a second key.
 *
 * VALUE GATE, the reason this file exists: ≥50 % of pixels under luma 60. The effect prints
 * its own material count and the gate is measured off the capture (see the wave's outcome).
 *
 * PLAYGROUND IS NoToneMapping; THE GAME IS ACES + exposure + saturation. Colours here are
 * authored to look right FLAT, so the Wave 3 port must overshoot (this repo's standing
 * lesson — see the winter playground-vs-ingame note). Do not copy these hexes verbatim.
 */
import * as THREE from 'three/webgpu';
import {
    abs, attribute, cameraPosition, clamp, color, dot, float, floor, fract, length, max, mix,
    normalize,
    normalWorld, positionGeometry, positionLocal, positionWorld, pow, sin, smoothstep,
    uniform, uv, vec2, vec3,
} from 'three/tsl';
import { fbm3, hash21, ridged3 } from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-noise.js';
import {
    billboardWorld, makeQuadInstancedGeometry,
} from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-billboard.js';

export const meta = {
    id: 'act1-earth-core',
    title: 'Act I — Earth Core (value study)',
    description: 'Laputa-device molten cavern: one warm key below, darkness-gated response, cool crack seed.',
};

/** Lake surface Y. The camera looks ACROSS it, as the shipped chapter intends. */
const LAKE_Y = -10;
/** Vault radius. Sets every noise frequency below — the quench taught us frequency is radius. */
const VAULT_R = 240;

// ── palette (flat-render values; the port overshoots these) ──────────────────────
// TSL NODES, not THREE.Color instances: a raw Color has no `.mul`, and the failure is a
// runtime TypeError inside create() that the playground reports only as "did not mount".
const C_VAULT_BASE = /* @__PURE__ */ color(0x0d0b12); // indigo-charred, NOT red
const C_VAULT_WARM = /* @__PURE__ */ color(0x2a1208); // bounce near the lake
const C_VEIN = /* @__PURE__ */ color(0xff8040);
const C_LAKE_HOT = /* @__PURE__ */ color(0xffd9a0);
const C_LAKE_MID = /* @__PURE__ */ color(0xff6a28);
const C_LAKE_CRUST = /* @__PURE__ */ color(0x150a08);
const C_HEART = /* @__PURE__ */ color(0xffb060);
const C_CRACK = /* @__PURE__ */ color(0x40a0a0); // the cyan seed, ≤2 % of frame

export function create({ scene }) {
    const uTime = uniform(0);
    const materials = [];
    const disposables = [];

    // ── 1. THE VAULT ────────────────────────────────────────────────────────────
    // One BackSide shell carrying three terms that used to be separate meshes: the charred
    // body, the darkness-gated ember veins, and the twinkle "galaxy" (Laputa's ceiling of
    // stars, in ember rather than levistone blue).
    const vaultMat = new THREE.MeshBasicNodeMaterial();
    const vDir = normalize(positionLocal);
    // Height 0 at the lake, 1 at the vault crown.
    const vH = clamp(vDir.y.mul(0.5).add(0.5), 0, 1);

    // The key's reach: the lake lights the FLOOR of the cavern and dies with height. This is
    // the only "light" in the vault, and it is what the veins are gated against.
    const keyReach = pow(float(1).sub(vH), float(3.2));

    // Charred body: near-black everywhere, with the lake's bounce admitted only low down.
    const body = mix(C_VAULT_BASE, C_VAULT_WARM, keyReach.mul(0.85));

    // Rock grain. Low frequency on purpose: the shipped chapter's vein noise reads as speckle
    // at range because it was authored at column scale and shown at vault scale.
    const grain = fbm3(vDir.mul(3.4), 3).mul(0.5).add(0.5);
    const bodyGrained = body.mul(grain.mul(0.5).add(0.72));

    // DARKNESS-GATED VEINS. `ridged3` gives filaments rather than blobs; the gate is the
    // whole device — a vein is invisible where the key already lights the rock, and blazes
    // where it does not. Squaring the gate keeps the mid-heights genuinely dark instead of
    // smearing a gradient of half-lit veins across the shell.
    // FREQUENCY IS SET BY THE RADIUS (the quench's lesson, paid again here): at 2.1 over a
    // 240 u shell each "vein" was tens of metres across and the first capture read as orange
    // NEBULA, not as filaments in rock. 11.0 puts the filament width in the range the eye
    // reads as a crack.
    const veinField = ridged3(vDir.mul(11.0).add(vec3(0, uTime.mul(0.015), 0)), 4);
    const veinMask = smoothstep(float(0.70), float(0.95), veinField);
    const darknessGate = pow(float(1).sub(keyReach), float(2.0));
    const veins = C_VEIN.mul(veinMask.mul(darknessGate).mul(0.55));

    // The galaxy: sparse twinkling points IN the rock. Cheap — one hash, no extra draw.
    // THE POINT MUST BE SHADED WITHIN ITS CELL. Selecting cells with `floor` and then
    // lighting the WHOLE cell renders each star as a hard square patch, which the sphere's
    // curvature skews into a diamond — a capture at t=32 showed a sky full of orange
    // parallelograms (the t=9 shot hid it because the twinkle phase was dim). `fract` gives
    // the position inside the cell, and a radial falloff turns the patch back into a point.
    const starUv = vec2(vDir.x, vDir.z).mul(120).add(vDir.y.mul(60));
    const cell = floor(starUv);
    const star = hash21(cell);
    const inCell = length(fract(starUv).sub(vec2(0.5)));
    const point = smoothstep(float(0.40), float(0.04), inCell);
    const twinkle = sin(uTime.mul(1.7).add(star.mul(40))).mul(0.5).add(0.5);
    const galaxy = C_VEIN.mul(
        smoothstep(float(0.985), float(1.0), star).mul(point).mul(twinkle).mul(darknessGate)
            .mul(0.8),
    );

    // THE CRACK SEED. A cool shaft of surface light entering at the crown, ≤2 % of frame by
    // construction (it lives inside a narrow smoothstep on both height and azimuth). This is
    // the colour script's cyan accent and the only cool thing in the chapter.
    // STARVED ON PURPOSE. The first capture proved how easily this inverts the act: at
    // 0.72/0.55/0.5 the seed painted the whole upper hemisphere teal and the chapter read as
    // a cool cave with warm decorations — the exact opposite of the intent. Narrow on both
    // axes and dim, so it is a hint at the crown and nothing else.
    const crackAxis = smoothstep(float(0.90), float(1.0), vH);
    const crackAz = smoothstep(float(0.82), float(0.99), abs(normalize(vec2(vDir.x, vDir.z)).x));
    const crack = C_CRACK.mul(crackAxis.mul(crackAz).mul(0.14));

    vaultMat.colorNode = bodyGrained.add(veins).add(galaxy).add(crack);
    vaultMat.side = THREE.BackSide;
    vaultMat.depthWrite = false;
    vaultMat.fog = false;
    vaultMat.toneMapped = false;
    materials.push(vaultMat);

    const vaultGeo = new THREE.SphereGeometry(VAULT_R, 48, 32);
    const vaultMesh = new THREE.Mesh(vaultGeo, vaultMat);
    vaultMesh.frustumCulled = false;
    vaultMesh.renderOrder = -100;
    scene.add(vaultMesh);
    disposables.push(vaultGeo);

    // ── 2. THE COLUMN FAMILY ────────────────────────────────────────────────────
    // ONE InstancedMesh replacing the shipped chapter's separate column/obsidian/rock meshes.
    // Tapered, with a BEVELLED top: the shipped columns end in flat polygon caps that read as
    // a modelling mistake the moment the quench veil backlights them (Phase 0 capture).
    const COLUMNS = 16;
    const colGeo = new THREE.CylinderGeometry(2.6, 7.0, 96, 7, 1, false);
    const colMesh = new THREE.InstancedMesh(colGeo, null, COLUMNS);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const axis = new THREE.Vector3(0, 1, 0);
    const rnd = (i, s) => {
        const h = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
        return h - Math.floor(h);
    };
    for (let i = 0; i < COLUMNS; i += 1) {
        const a = (i / COLUMNS) * Math.PI * 2 + rnd(i, 1) * 0.28;
        const r = 62 + rnd(i, 2) * 78;
        const h = 0.75 + rnd(i, 3) * 1.5;
        pos.set(Math.cos(a) * r, LAKE_Y + 40 * h - 6, Math.sin(a) * r);
        q.setFromAxisAngle(axis, rnd(i, 4) * Math.PI * 2);
        scl.set(0.8 + rnd(i, 5) * 0.7, h, 0.8 + rnd(i, 5) * 0.7);
        colMesh.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    colMesh.instanceMatrix.needsUpdate = true;

    const colMat = new THREE.MeshBasicNodeMaterial();
    // Local-space height mask reads positionGeometry: r181's InstanceNode has already
    // rewritten positionLocal by the time a positionNode/colorNode runs (the repo's logged
    // instancing trap). Nothing here displaces, but the mask must still be instance-agnostic.
    const colH = clamp(positionGeometry.y.div(96).add(0.5), 0, 1);
    // The lake is the key: it sits BELOW, so the lit face is the one whose world normal has
    // a downward component. That single sign is what makes the rock read as lit-from-below
    // rather than as ambient-red soup.
    const keyDir = normalize(vec3(0, -1, 0));
    const colNdl = max(dot(normalWorld, keyDir), 0);
    // Distance falloff from the lake centre, so far columns fall into the dark.
    const colDist = clamp(length(positionWorld.xz).div(210), 0, 1);
    const colKey = colNdl.mul(float(1).sub(colDist).mul(0.9).add(0.1));
    // Crust: low-frequency, so it reads as charred plates rather than the shipped speckle.
    const colCrust = fbm3(positionWorld.mul(0.055), 3).mul(0.5).add(0.5);
    // Molten seams survive only at the base, where the rock is still hot.
    const seam = smoothstep(float(0.32), float(0.0), colH)
        .mul(smoothstep(float(0.55), float(0.85), colCrust));
    const colBase = mix(vec3(0.028, 0.022, 0.026), vec3(0.10, 0.055, 0.04), colCrust);
    colMat.colorNode = colBase
        .mul(colKey.mul(1.5).add(0.16))
        .add(C_VEIN.mul(seam).mul(0.55));
    colMat.fog = false;
    colMat.toneMapped = false;
    materials.push(colMat);
    colMesh.material = colMat;
    colMesh.frustumCulled = false;
    scene.add(colMesh);
    disposables.push(colGeo);

    // ── 3. THE LAVA LAKE — the one warm key ─────────────────────────────────────
    const lakeGeo = new THREE.CircleGeometry(190, 72);
    const lakeMat = new THREE.MeshBasicNodeMaterial();
    const lakeUv = positionWorld.xz.mul(0.02);
    // Crust plates drifting on the melt. Journey's diffuse-contrast device in albedo form:
    // steepen the transition so the surface reads as GRAPHIC plates of value, not a gradient.
    const plate = fbm3(vec3(lakeUv.x, lakeUv.y, uTime.mul(0.02)), 4).mul(0.5).add(0.5);
    // CRUST IS THE MINORITY. At 0.46/0.60 nearly the whole plate read as crust and the lake
    // rendered as a dark brown floor with occasional smears — the key was on screen and still
    // not lighting anything (second capture). The lake has to BE the light: mostly molten,
    // with dark plates drifting on it.
    const crustMask = smoothstep(float(0.60), float(0.78), plate);
    // Melt seams glow hottest where the crust is thinnest.
    const heat = float(1).sub(crustMask);
    // MOLTEN, not cream. `pow(heat, 2.2)` let the pale hot tone win most of the surface and
    // the lake rendered as a beach (third capture). The hot stop has to be RARE — it is the
    // last few degrees before white, reached only in the thinnest seams — and the body of the
    // lake stays a deep orange that can still read as rock that melted.
    const molten = mix(C_LAKE_MID.mul(0.62), C_LAKE_HOT, pow(heat, float(5.0)));
    const lakeCol = mix(C_LAKE_CRUST, molten, heat);
    // QUANTISED GLITTER (the Hoshi-no-Tani device, plan §2.3): discrete winking glints on the
    // seams rather than a specular lobe. A hard smoothstep window is the whole trick.
    const glintField = fbm3(vec3(lakeUv.x.mul(6.0), lakeUv.y.mul(6.0), uTime.mul(0.35)), 2);
    const glint = smoothstep(float(0.62), float(0.70), glintField).mul(heat);
    // Radial falloff so the lake does not end in a hard circle against the dark.
    const lakeEdge = float(1).sub(smoothstep(float(120), float(188), length(positionWorld.xz)));
    lakeMat.colorNode = lakeCol.add(C_LAKE_HOT.mul(glint).mul(0.8)).mul(lakeEdge.mul(0.92).add(0.08));
    lakeMat.fog = false;
    lakeMat.toneMapped = false;
    materials.push(lakeMat);
    const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
    lakeMesh.rotation.x = -Math.PI / 2;
    lakeMesh.position.y = LAKE_Y;
    scene.add(lakeMesh);
    disposables.push(lakeGeo);

    // ── 4. THE FIRST HEART (Calcifer grammar) ───────────────────────────────────
    // A teardrop with a 3-stop ramp and a POSE-driven pulse, not a noise sim: Howl's fire is
    // animated in held poses, and its bounce light stays ORANGE (the production note that
    // green firelight was tested and rejected). Wave 6 gives it the farewell aim; here it
    // only has to prove the silhouette and the ramp.
    const heartGeo = new THREE.SphereGeometry(4.2, 28, 20);
    const heartMat = new THREE.MeshBasicNodeMaterial();
    // TEARDROP IN GEOMETRY: taper x/z as y rises so the silhouette comes to a drawn-up point.
    // A plain ellipsoid reads as an egg, and the first capture proved it — Calcifer is
    // recognisable by SHAPE before colour.
    const hUp = clamp(positionLocal.y.div(4.2).mul(0.5).add(0.5), 0, 1);
    const taper = float(1).sub(smoothstep(float(0.25), float(1.0), hUp).mul(0.78));
    heartMat.positionNode = positionLocal.mul(vec3(taper, 1.0, taper));
    // The incandescent core is RADIAL (facing the lens), not vertical. Keying it off height
    // put the white at the BOTTOM of the body — a lightbulb, upside down.
    const hView = normalize(cameraPosition.sub(positionWorld));
    const facing = clamp(dot(hView, normalWorld), 0, 1);
    const core = pow(facing, float(2.4));
    // Body: hottest at the base where it feeds off the lake, cooling toward the point.
    const bodyCol = mix(vec3(0.86, 0.30, 0.06), C_HEART, float(1).sub(hUp).mul(0.55).add(0.25));
    const heartCol = mix(bodyCol, vec3(1.0, 0.90, 0.78), pow(core, float(3.0)).mul(0.8));
    // Held-pose breathing: two sines at unrelated rates read as intent rather than a loop.
    const breathe = sin(uTime.mul(1.1)).mul(0.5).add(sin(uTime.mul(0.37)).mul(0.5)).mul(0.12)
        .add(0.94);
    heartMat.colorNode = heartCol.mul(breathe);
    heartMat.fog = false;
    heartMat.toneMapped = false;
    materials.push(heartMat);
    const heartMesh = new THREE.Mesh(heartGeo, heartMat);
    heartMesh.position.set(0, LAKE_Y + 16, -26);
    heartMesh.scale.set(0.82, 1.35, 0.82); // the teardrop, in geometry not shader
    scene.add(heartMesh);
    disposables.push(heartGeo);

    // ── 5. ONE PARTICLE ATLAS (embers) ──────────────────────────────────────────
    // The shipped chapter runs four separate particle systems (smoke, stars, embers, sparks).
    // One instanced billboard set replaces them; the atlas tile is chosen per instance.
    // TRANSMITTED LIGHT (Nausicaä's spore rig): an ember is a light SOURCE, so it is brightest
    // against the dark vault and vanishes against the lake — which is also what keeps the
    // value gate honest as the count rises.
    const EMBERS = 900;
    const eSeed = new Float32Array(EMBERS);
    const eOrigin = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i += 1) {
        eSeed[i] = rnd(i, 7);
        const a = rnd(i, 8) * Math.PI * 2;
        const r = 12 + rnd(i, 9) * 170;
        eOrigin[i * 3] = Math.cos(a) * r;
        eOrigin[i * 3 + 1] = LAKE_Y + rnd(i, 10) * 150;
        eOrigin[i * 3 + 2] = Math.sin(a) * r;
    }
    const emberGeo = makeQuadInstancedGeometry(EMBERS, {
        aSeed: { array: eSeed, itemSize: 1 },
        aOrigin: { array: eOrigin, itemSize: 3 },
    });
    disposables.push(emberGeo);

    // ── 6. THE CRACK SHAFTS (cool pre-seed) ─────────────────────────────────────
    // Nausicaä's underground chamber: parallel shafts of clean surface light entering through
    // the crack above. Four cards, additive, fading with depth. This is the LIGHT LANGUAGE
    // flip the quench completes — warm key below, cool key arriving from above.
    // SEATED FAR AND THIN. At radius 54 with a 26×300 card the camera stood practically
    // inside them and four additive teal curtains owned the frame (first capture). Distant,
    // narrow and dim is what makes a shaft read as light arriving from somewhere else.
    const SHAFTS = 4;
    const shaftGeo = new THREE.PlaneGeometry(9, 190);
    const shaftMesh = new THREE.InstancedMesh(shaftGeo, null, SHAFTS);
    for (let i = 0; i < SHAFTS; i += 1) {
        const a = (i / SHAFTS) * Math.PI * 2 + 0.5;
        pos.set(Math.cos(a) * 165, LAKE_Y + 150, Math.sin(a) * 165);
        q.setFromAxisAngle(axis, -a);
        scl.set(1, 1, 1);
        shaftMesh.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    shaftMesh.instanceMatrix.needsUpdate = true;
    const shaftMat = new THREE.MeshBasicNodeMaterial();
    const sUv = uv();
    // Brightest where it enters, feathering to nothing as it descends into the warm half.
    const sFade = pow(float(1).sub(sUv.y), float(1.6));
    const sLateral = smoothstep(float(0.5), float(0.0), abs(sUv.x.sub(0.5)));
    const sShimmer = fbm3(vec3(sUv.x.mul(3), sUv.y.mul(2).sub(uTime.mul(0.05)), 0), 2)
        .mul(0.35).add(0.75);
    shaftMat.colorNode = C_CRACK.mul(sShimmer);
    shaftMat.opacityNode = sFade.mul(sLateral).mul(sShimmer).mul(0.05);
    shaftMat.transparent = true;
    shaftMat.depthWrite = false;
    shaftMat.blending = THREE.AdditiveBlending;
    shaftMat.side = THREE.DoubleSide;
    shaftMat.fog = false;
    shaftMat.toneMapped = false;
    materials.push(shaftMat);
    shaftMesh.material = shaftMat;
    shaftMesh.frustumCulled = false;
    shaftMesh.renderOrder = 8;
    scene.add(shaftMesh);
    disposables.push(shaftGeo);

    // ── embers, wired ───────────────────────────────────────────────────────────
    const emberMat = new THREE.MeshBasicNodeMaterial();
    const eSeedN = attribute('aSeed', 'float');
    const eOriginN = attribute('aOrigin', 'vec3');
    // Rise with a slow lateral sway. CONSTANT velocity per Nausicaä: serenity comes from not
    // easing — a burst reads as an explosion, a steady drift reads as air. `fract` recycles
    // each ember without a CPU pass.
    const eRise = fract(uTime.mul(0.035).mul(eSeedN.mul(0.6).add(0.5)).add(eSeedN));
    const eSway = sin(uTime.mul(0.5).add(eSeedN.mul(30))).mul(6.0);
    const emberCenter = vec3(
        eOriginN.x.add(eSway),
        eOriginN.y.add(eRise.mul(150)),
        eOriginN.z.add(eSway.mul(0.6)),
    );
    const emberSize = eSeedN.mul(1.1).add(0.55);
    emberMat.positionNode = billboardWorld(emberCenter, emberSize);
    materials.push(emberMat);
    const eUv = uv();
    const eRadial = float(1).sub(smoothstep(float(0.0), float(0.5), length(eUv.sub(vec2(0.5)))));
    // TRANSMITTED LIGHT: brightness scales with how dark the background behind it is. We
    // cannot read the framebuffer here, so the stand-in is height — the vault darkens with
    // height, so an ember brightens as it climbs. Same curve the vault's key uses, inverted.
    const eHeight = clamp(positionWorld.y.sub(LAKE_Y).div(150), 0, 1);
    const eLife = float(1).sub(eHeight);
    emberMat.colorNode = mix(C_LAKE_HOT, C_VEIN, eHeight).mul(eHeight.mul(0.8).add(0.5));
    emberMat.opacityNode = eRadial.mul(eRadial).mul(eLife.mul(0.55).add(0.12)).mul(0.7);
    emberMat.transparent = true;
    emberMat.depthWrite = false;
    emberMat.blending = THREE.AdditiveBlending;
    emberMat.fog = false;
    emberMat.toneMapped = false;
    const emberMesh = new THREE.Mesh(emberGeo, emberMat);
    emberMesh.frustumCulled = false;
    emberMesh.renderOrder = 6;
    scene.add(emberMesh);
    disposables.push(emberGeo);

    // eslint-disable-next-line no-console
    console.log(`[act1-earth-core] materials=${materials.length} (budget ≤10), `
        + `draws≈${5 + 1} groups, columns=${COLUMNS} embers=${EMBERS} shafts=${SHAFTS}`);

    return {
        cameraRadius: 150,
        camera(time, camera) {
            // Look ACROSS the lake, slightly down. The first framing aimed above the lake and
            // lost the one warm key out of frame — which is how a chapter whose whole premise
            // is "lit from below" ends up reading as ambient soup. The key must be ON SCREEN.
            // INSIDE the column ring (which spans radius 62–140): orbiting at 132 put the lens
            // inside a pillar and 80 % of the frame went to one dark cylinder. The rail flies
            // up the MIDDLE of the cathedral, so the camera belongs there too — near the axis,
            // looking ACROSS the lake at the far wall, lake in the lower third.
            const a = time * 0.06;
            const r = 30;
            camera.position.set(Math.sin(a) * r, LAKE_Y + 30, Math.cos(a) * r);
            camera.lookAt(Math.sin(a) * -150, LAKE_Y + 40, Math.cos(a) * -150);
        },
        update(time) {
            uTime.value = time;
        },
        dispose() {
            [vaultMesh, colMesh, lakeMesh, heartMesh, shaftMesh, emberMesh]
                .forEach((m) => scene.remove(m));
            disposables.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}
