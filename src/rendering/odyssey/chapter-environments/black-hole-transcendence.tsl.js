/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Black Hole Transcendence (Chapter 7) — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — chapter conversion). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5/§6. Faithful TSL ports of
 * black-hole-transcendence.js's five GLSL ShaderMaterials — the void nebula dome,
 * the hero event-horizon accretion disk, the gravitational-lensing Einstein-ring
 * shell, and the two twinkling point fields (transcendence shards + lensed
 * starfield) — rebuilt as NodeMaterials so they run on the WebGPURenderer and its
 * automatic WebGL2 fallback backend.
 *
 * The live file's `ODYSSEY_NOISE_GLSL` (od_* value noise) maps to the shared TSL
 * noise lib: fbm3 → fbm3, ridged3 → ridged3 (same lacunarity/octaves), so the look
 * carries over GLSL→TSL. The additive accretion/photon/lensing/shard/starfield
 * surfaces are tagged `userData.emitsBloom = true` for the future MRT selective-bloom
 * pass; emissiveNode is wired when the TSL post graph lands (kept off here so the
 * standalone pilot harness, which has no MRT bloom, does not double-brighten). The
 * void dome is the backstop and deliberately carries NO emitsBloom.
 *
 * This is ADDITIVE: the live black-hole-transcendence.js (raw GLSL ShaderMaterial on
 * WebGLRenderer) is untouched and keeps working.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    clamp,
    cos,
    dot,
    length,
    max,
    mix,
    normalize,
    oneMinus,
    positionLocal,
    positionViewDirection,
    pow,
    sin,
    smoothstep,
    normalView,
    uniform,
    uv,
    vec3,
    attribute,
} from 'three/tsl';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';
import { billboardWorld, makeQuadInstancedGeometry } from './shared/odyssey-tsl-billboard.js';

// ── Void nebula dome (-100 backstop; must NOT bloom) ─────────────────────────────

/**
 * Deep magenta/indigo nebula backstop — FBM dust + ridged filaments graded against a
 * dark vertical base. Port of domeFragmentShader.
 * @param {object} uTime shared time uniform (uniform(0))
 * @param {object} [uEnergy] shared energy uniform (uniform(0.4))
 */
export function createVoidDomeTSL(uTime = uniform(0), uEnergy = uniform(0.4)) {
    const uOpacity = uniform(1);

    const dir = normalize(positionLocal);
    const h = dir.y.mul(0.5).add(0.5);
    // Deep-violet ambient floor (NOT true RGB-black) so the corridor never reads as a
    // dead black void; the top fades to a richer indigo for vertical depth. Both ends
    // stay far below white — the lead's "raise the void-dome luminance so its FBM
    // filaments read" without any blowout. Floors RAISED hard (B2 stop-the-crush): even a
    // frame with no nebula pocket in view must read as structured deep-violet, never the
    // RGB-black voids the mid-chapter capture frames show.
    const base = mix(vec3(0.072, 0.040, 0.130), vec3(0.150, 0.070, 0.250), h);

    const q = dir.mul(3.4).add(vec3(0.0, 0.0, uTime.mul(0.03)));
    // Octaves 5->3 (perf): this is a full-screen BackSide dome (the mode's heaviest fragment,
    // stacked under the ambient wash). Octaves 4-5 are low-amplitude detail eaten by the
    // pocket smoothstep below + ACES downstream — same cut already verified safe on ch5/ch6.
    const dust = fbm3(q, 3);
    const filaments = ridged3(q.mul(0.8).add(7.0), 3);

    // Nebula POCKETS: a low-frequency ridged field carved into bright/dim cells so the
    // dome reads as clustered nebula structure (pockets) rather than a uniform haze.
    // Widened smoothstep (0.12..0.70) so pockets cover MORE of the dome and the dimmest
    // cells still carry visible nebula instead of going dark.
    const pocketRaw = ridged3(dir.mul(1.15).add(vec3(0.0, 0.0, uTime.mul(0.012)).add(21.0)), 3);
    const pockets = smoothstep(0.12, 0.70, pocketRaw);

    // Hotter, more saturated magenta filaments threading the void (preserves the magenta
    // identity). Filament/dust gains lifted ~30% (B2) and gated by the pocket mask so the
    // bright nebula concentrates in pockets and reads clearly against the deep base, while
    // the lifted pocket floor keeps the whole dome structured rather than sparse hotspots.
    let nebula = vec3(0.62, 0.10, 0.56).mul(filaments).mul(pockets.mul(0.85).add(0.72));
    nebula = nebula.add(vec3(0.14, 0.24, 0.56).mul(dust).mul(pockets.mul(0.7).add(0.78)));

    // RICHER VOID COLOUR (additive, soft): thread cooler-cyan and warm-gold filaments
    // through the magenta/indigo so the void reads multi-hued (magenta/cyan/gold/violet),
    // not a single magenta haze. A second, higher-frequency ridged field carves the
    // gold/cyan veins so they layer over the primary filaments rather than tracking them;
    // gated by `pockets` so the accents stay inside the clustered nebula structure, and
    // kept low-luminance (deep-void discipline — no blowout, ACES downstream).
    const veins = ridged3(q.mul(1.35).add(13.0), 3);
    const goldVein = vec3(0.30, 0.20, 0.06).mul(pow(veins, 2.0)).mul(pockets.mul(0.6).add(0.2));
    const cyanVein = vec3(0.05, 0.22, 0.34).mul(filaments).mul(pockets.mul(0.5).add(0.18));
    nebula = nebula.add(goldVein).add(cyanVein);

    const color = base.add(nebula.mul(uEnergy.mul(0.5).add(0.85)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.transparent = true;
    material.depthWrite = false;

    const geometry = new THREE.SphereGeometry(520, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Hero accretion disk (additive, bloom-eligible) ───────────────────────────────

/**
 * Swirling plasma accretion disk with Doppler beaming and streak bands. Port of
 * accretionFragmentShader on a RingGeometry; vRadius/vAngle/vLocal are recomputed
 * from positionLocal.xy (the ring lies in its local XY plane).
 */
export function createAccretionDiskTSL(uTime = uniform(0), uEnergy = uniform(0.4), options = {}) {
    // Geometry inner/outer radii. The hero copy passes a larger outerRadius so the disk
    // geometry actually extends out to the enlarged uOuter (raising uOuter alone would
    // only re-map the falloff inside the fixed 132-unit ring). Default keeps the close
    // hero + secondary motifs at the original 42..132 torus.
    const innerRadius = options.innerRadius ?? 42;
    const outerRadius = options.outerRadius ?? 132;
    const uInner = uniform(innerRadius);
    const uOuter = uniform(outerRadius);
    // Enriched accretion palette: incandescent gold-white inner edge -> deep saturated
    // magenta plasma -> rich electric-blue Doppler outer. Higher saturation across the
    // ramp so the disk reads with more colour contrast (not a flat pink wash) while
    // keeping the magenta-filament + black-void identity.
    const uHot = uniform(new THREE.Color(0xfff4cf));
    const uMid = uniform(new THREE.Color(0xff2ea8));
    const uCool = uniform(new THREE.Color(0x3aa0ff));

    const local = positionLocal.xy;
    const vRadius = length(local);
    const vAngle = atan(local.y, local.x);

    const t = clamp(vRadius.sub(uInner).div(uOuter.sub(uInner)), 0.0, 1.0);
    const swirl = vAngle.add(uTime.mul(oneMinus(t).mul(2.0).add(0.7)));
    const sp = vec3(cos(swirl), sin(swirl), 0.0).mul(t.mul(3.4).add(0.7));
    const turb = fbm3(sp.mul(1.8).add(vec3(0.0, 0.0, uTime.mul(0.16))));
    const streaks = sin(swirl.mul(4.0).add(t.mul(18.0)).sub(uTime.mul(1.4))).mul(0.5).add(0.5);
    const plasma = mix(turb, streaks, 0.45);

    // SOFT VOLUME radial ramp — feather alpha to EXACTLY 0 before BOTH ring edges so the
    // disk reads as a plasma torus, not a flat card. innerFeather lifts off the horizon,
    // outerFeather dissolves the rim well before the geometry edge (t→1), and body is a
    // fat soft falloff peaking off-centre for an inner/outer parallax volume read.
    const innerFeather = smoothstep(0.0, 0.14, t);
    const outerFeather = oneMinus(smoothstep(0.58, 0.985, t));
    const body = pow(oneMinus(clamp(abs(t.sub(0.2).mul(1.7)), 0.0, 1.0)), 1.6).mul(0.7).add(0.3);
    const radial = innerFeather.mul(outerFeather).mul(body);

    // Bright Doppler-warped INNER EDGE — a hot incandescent lip hugging the horizon,
    // brightest where the beaming approaches. Feathered, so no hard inner ring.
    const innerLip = pow(oneMinus(smoothstep(0.0, 0.11, t)), 1.4).mul(innerFeather);

    // Doppler asymmetry across the disk (local.x): one limb approaches (beamed hot,
    // bright) and the opposite recedes (dim, red/blue-shifted). Kept as a SMOOTH ramp
    // (smoothstep across the full diameter) so there is no hard edge — the iconic
    // asymmetric accretion look comes from the gradient, not a seam. `dopplerSide` is a
    // signed -1..+1 limb selector used both to brighten the approaching limb and to tint.
    const dopplerSide = smoothstep(uOuter.negate(), uOuter, local.x); // 0 receding -> 1 approaching
    const doppler = dopplerSide.mul(0.95).add(0.42); // brightness beaming (wider asymmetry)

    let intensity = radial.mul(plasma.add(0.35)).mul(doppler);
    intensity = intensity.add(innerLip.mul(doppler).mul(0.9)); // hot Doppler inner edge
    intensity = intensity.mul(uEnergy.mul(0.7).add(1.0));

    // Base radial color ramp (gold-white core -> magenta body -> electric blue rim).
    let color = mix(uHot, uMid, smoothstep(0.0, 0.38, t));
    color = mix(color, uCool, smoothstep(0.38, 1.0, t));
    // Doppler COLOR shift: push the approaching limb hot gold-white and the receding limb
    // toward cool blue, smoothly across the diameter (no hard edge). This is the readable
    // "hot gold-white approaching -> magenta body -> blue receding" identity the plan asks
    // for; the mix weight is gentle so the magenta body still dominates the centre.
    color = mix(color, uCool.mul(0.85), oneMinus(dopplerSide).mul(0.45)); // receding -> blue
    color = mix(color, uHot, dopplerSide.mul(0.40)); // approaching -> gold-white
    color = color.add(vec3(0.32, 0.10, 0.42).mul(doppler).mul(radial));

    // RICHER COLOUR INTERPLAY (additive, soft): weave violet + cyan + gold filament
    // accents through the plasma body so the disk reads as multi-hued banded matter
    // (magenta/cyan/gold/violet) instead of a single magenta wash. Each accent rides an
    // out-of-phase angular streak modulated by the existing turbulence, and is gated by
    // `radial` so it stays inside the feathered body (no edge), and scaled low so ACES +
    // threshold bloom never see white.
    const filamentA = sin(swirl.mul(3.0).sub(uTime.mul(0.9))).mul(0.5).add(0.5);
    const filamentB = sin(swirl.mul(5.0).add(t.mul(9.0)).add(uTime.mul(0.6))).mul(0.5).add(0.5);
    const violetBand = vec3(0.46, 0.12, 0.70).mul(pow(filamentA, 2.0).mul(turb.add(0.3)));
    const cyanBand = vec3(0.10, 0.42, 0.62).mul(pow(filamentB, 2.0).mul(streaks.add(0.2)));
    const goldBand = vec3(0.52, 0.34, 0.10)
        .mul(pow(oneMinus(smoothstep(0.0, 0.30, t)), 1.6).mul(filamentB));
    color = color.add(violetBand.add(cyanBand).add(goldBand).mul(radial).mul(0.55));
    color = color.add(uHot.mul(innerLip.mul(0.6))); // incandescent inner lip seats the core

    // Subtle atmosphere/rim haze — a faint magenta-cyan glow that bleeds OUTSIDE the
    // bright body and fades to 0 before the geometry edge, so the hero seats into the
    // void haze rather than floating on black. Kept low (ACES is downstream; no blowout).
    const rimGlow = smoothstep(0.42, 0.74, t).mul(oneMinus(smoothstep(0.74, 0.985, t)));
    const atmo = uCool.mul(rimGlow.mul(0.22));

    // Optional fade multiplier (default 1). The close ENTRY event horizon passes a shared
    // uFade so the .js update() can ramp it OUT by ~25% chapter progress, handing off to
    // the camera-locked hero with no popping.
    const uFade = options.uFade ?? uniform(1);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(intensity).add(atmo);
    material.opacityNode = clamp(intensity.add(rimGlow.mul(0.18)), 0.0, 1.0).mul(uFade);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 200, 6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'accretion-disk-tsl';
    return {
        mesh, material, geometry, uniforms: { uInner, uOuter, uFade },
    };
}

// ── Gravitational-lensing Einstein-ring shell (additive, bloom-eligible) ─────────

/**
 * View-space fresnel band on a sphere — reads as a lensed Einstein ring around the
 * horizon. Port of lensFragmentShader. dot(vNormal, vView) → dot(view-space normal,
 * view direction toward camera).
 */
export function createLensingShellTSL(uTime = uniform(0), uEnergy = uniform(0.4), options = {}) {
    // Vivid lensed Einstein ring: electric cyan grading into a hotter magenta that ties
    // to the accretion mid-tone.
    const uColorA = uniform(new THREE.Color(0x6ae8ff));
    const uColorB = uniform(new THREE.Color(0xff4ec8));
    // Optional fade multiplier (default 1) so the close ENTRY shell can ramp out with the
    // rest of the entry horizon (see createAccretionDiskTSL uFade).
    const uFade = options.uFade ?? uniform(1);

    const vNormal = normalView;
    const vView = positionViewDirection;

    const fres = pow(oneMinus(max(0.0, dot(vNormal, vView))), 2.0);
    const band = smoothstep(0.2, 0.5, fres).mul(oneMinus(smoothstep(0.72, 1.0, fres)));
    const shimmer = sin(uTime.mul(1.6).add(fres.mul(18.0))).mul(0.2).add(0.8);
    // Faint wide atmosphere bleed inside the ring threshold so the Einstein ring seats
    // into the haze with no hard inner cutoff. Additive + low, never a white edge.
    const atmo = smoothstep(0.04, 0.3, fres).mul(oneMinus(smoothstep(0.3, 0.5, fres)));
    const color = mix(uColorA, uColorB, fres).mul(band).mul(shimmer).add(uColorA.mul(atmo.mul(0.22)));
    const alpha = band.mul(uEnergy.mul(0.4).add(0.55)).add(atmo.mul(0.12)).mul(uFade);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;

    const geometry = new THREE.SphereGeometry(50, 40, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lensing-shell-tsl';
    return {
        mesh, material, geometry, uniforms: { uFade },
    };
}

// ── Shared secondary-motif materials (B2 draw-call / program reduction) ───────────

/**
 * B2 STRUCTURAL: the 5 secondary lensing motifs each used to build their OWN accretion
 * disk + lensing shell NodeMaterial (≈10 unique TSL programs) plus their own
 * geometries. The motifs are visually identical (all use the default 42..132 disk and
 * the 50-radius lens shell) and differ only by their parent group transform, so we can
 * share ONE disk material+geometry and ONE lens-shell material+geometry across all five.
 * This collapses the motif disk/shell programs from ~10 → 2 and reuses 2 geometries
 * instead of 10, with NO visual change (the per-motif spin/tilt/scale lives on the
 * group transform, not the material). The shared meshes still bloom (emitsBloom) exactly
 * as before. Returns factories that build fresh Mesh objects (a Mesh is per-instance —
 * only the material + geometry are shared, which is what saves the pipeline compiles).
 *
 * @param {object} uTime shared time uniform
 * @param {object} [uEnergy] shared energy uniform
 * @returns {{disk:{material,geometry}, shell:{material,geometry}, photonRing:{material,geometry},
 *           makeDiskMesh:Function, makeShellMesh:Function, makePhotonRingMesh:Function, dispose:Function}}
 */
export function createSharedMotifMaterialsTSL(uTime = uniform(0), uEnergy = uniform(0.4)) {
    // Build the disk + shell ONCE via the existing validated builders, then strip the
    // single throwaway mesh — we keep only the shared material + geometry and re-mesh
    // them per motif below.
    const disk = createAccretionDiskTSL(uTime, uEnergy);
    const shell = createLensingShellTSL(uTime, uEnergy);

    // The motif photon ring is identical across all five (same RingGeometry + same
    // additive gold material), so share one material + geometry for it too.
    const photonRingGeometry = new THREE.RingGeometry(39, 44, 96, 1);
    const photonRingMaterial = new THREE.MeshBasicMaterial({
        color: 0xffe6b8,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const makeDiskMesh = (name) => {
        const mesh = new THREE.Mesh(disk.geometry, disk.material);
        mesh.name = name ?? 'motif-accretion-disk-shared';
        return mesh;
    };
    const makeShellMesh = (name) => {
        const mesh = new THREE.Mesh(shell.geometry, shell.material);
        mesh.name = name ?? 'motif-lensing-shell-shared';
        return mesh;
    };
    const makePhotonRingMesh = (name) => {
        const mesh = new THREE.Mesh(photonRingGeometry, photonRingMaterial);
        mesh.name = name ?? 'motif-photon-ring-shared';
        return mesh;
    };

    return {
        disk: { material: disk.material, geometry: disk.geometry },
        shell: { material: shell.material, geometry: shell.geometry },
        photonRing: { material: photonRingMaterial, geometry: photonRingGeometry },
        makeDiskMesh,
        makeShellMesh,
        makePhotonRingMesh,
        dispose() {
            disk.geometry.dispose();
            disk.material.dispose();
            shell.geometry.dispose();
            shell.material.dispose();
            photonRingGeometry.dispose();
            photonRingMaterial.dispose();
        },
    };
}

// ── Deep-violet ambient wash (additive, camera-enveloping; must NOT blow white) ──

export const CH7_AMBIENT_WASH_SETTINGS = Object.freeze({
    centerFloor: 0.86,
    rimGain: 0.78,
    opacityFloor: 0.42,
    opacityCap: 0.72,
    sphereRadius: 360,
    floorColor: [0.17, 0.095, 0.31],
});

/**
 * A large additive inner-shell sphere of deep violet that the camera sits inside, so
 * the corridor between hero motifs never reads as dead RGB-black. The wash is a gentle
 * fresnel-graded glow (brighter toward the rim of view, faint dead-ahead) with a faint
 * drifting FBM mottle so it reads as nebular ambience, not a flat tint. Emissive is
 * kept deliberately low (peak ~0.12) and additive+feathered so ACES never sees a
 * white-blowing source. The .js update() re-centres this on the camera each frame.
 * @param {object} uTime shared time uniform
 * @param {object} [uEnergy] shared energy uniform
 */
export function createAmbientWashTSL(uTime = uniform(0), uEnergy = uniform(0.4)) {
    const uOpacity = uniform(1);

    // Fresnel: brighter toward the silhouette rim of the enveloping shell (the edges of
    // the view), faint where we look straight through it — a soft vignette of violet
    // ambience rather than a uniform fog wall. A constant FLOOR is added so the wash
    // also carries deep-violet ambience dead-ahead (where pure rim fresnel reads ~0),
    // killing the "centre of frame goes RGB-black" the lead flagged.
    const vNormal = normalView;
    const vView = positionViewDirection;
    const fres = pow(oneMinus(max(0.0, dot(vNormal, vView))), 1.4);
    // Creative plan ch7 item 1 (the capture contradicts the code — AMPLIFY): centre
    // floor lifted 0.55 → 0.68 so frames 07–14 genuinely sit at the #120A21 violet
    // floor instead of falling back to RGB-black between motifs.
    const view = fres.mul(CH7_AMBIENT_WASH_SETTINGS.rimGain)
        .add(CH7_AMBIENT_WASH_SETTINGS.centerFloor);

    // Drifting pocketed FBM filaments so the wash has internal structure that actually
    // reads as nebula (bright clumps), not a flat band. The ridged term carves brighter
    // violet filaments; the fbm term softens them into clouds.
    const dir = normalize(positionLocal);
    // Octaves 5->3 (perf): second full-screen BackSide dome overlapping the void dome on every
    // background pixel; the high octaves vanish under the pocket smoothstep + low wash intensity.
    const clouds = fbm3(dir.mul(2.2).add(vec3(0.0, 0.0, uTime.mul(0.02))), 3).mul(0.6).add(0.5);
    const filaments = ridged3(dir.mul(1.6).add(vec3(0.0, 0.0, uTime.mul(0.015)).add(13.0)), 3);
    const pockets = smoothstep(0.30, 0.85, filaments).mul(0.9).add(0.5);
    const mottle = clouds.mul(pockets);

    // Deep violet -> magenta-violet across the fresnel ramp; both ends low-luminance.
    const floorColor = vec3(
        CH7_AMBIENT_WASH_SETTINGS.floorColor[0],
        CH7_AMBIENT_WASH_SETTINGS.floorColor[1],
        CH7_AMBIENT_WASH_SETTINGS.floorColor[2],
    );
    const tint = mix(vec3(0.18, 0.075, 0.34), vec3(0.36, 0.10, 0.42), fres);
    const intensity = view.mul(mottle).mul(uEnergy.mul(0.35).add(0.6));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = floorColor.add(tint.mul(intensity));
    // Hard cap the alpha so the additive wash stays a faint ambience (never a wall) —
    // raised again 0.38 → 0.5 (creative plan amplification) so the violet floor holds
    // in every frame; still well below a haze wall, ACES + threshold bloom downstream.
    material.opacityNode = clamp(
        intensity.mul(0.7).add(CH7_AMBIENT_WASH_SETTINGS.opacityFloor),
        0.0,
        CH7_AMBIENT_WASH_SETTINGS.opacityCap,
    ).mul(uOpacity);
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.BackSide;
    material.blending = THREE.AdditiveBlending;
    // Intentionally NO emitsBloom: this is a backstop wash, not a bloom emitter.

    const geometry = new THREE.SphereGeometry(CH7_AMBIENT_WASH_SETTINGS.sphereRadius, 32, 24);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'ambient-violet-wash-tsl';
    mesh.renderOrder = -95; // just in front of the void dome (-100), behind heroes
    mesh.frustumCulled = false;
    mesh.userData.readability = CH7_AMBIENT_WASH_SETTINGS;
    return {
        mesh, material, geometry, uniforms: { uOpacity },
    };
}

// ── Drifting violet corridor dust (instanced billboards, additive feathered) ─────

export const CH7_CORRIDOR_DUST_SETTINGS = Object.freeze({
    minCount: 160,
    maxCount: 820,
    spreadX: 380,
    spreadY: 360,
    depthNear: -55,
    depthSpan: 560,
    minSize: 5.5,
    sizeSpan: 11,
    colorGain: 1.08,
    glowPower: 1.7,
    breatheBase: 0.36,
    breatheSwing: 0.11,
    opacityCap: 0.62,
});

/**
 * Near/mid drifting violet dust motes that hug the corridor span the camera traverses,
 * so no frame between the singularity motifs goes empty. Instanced billboard quads
 * (THREE.Points renders 1px on WebGPU) with a radial alpha feather to 0 before the quad
 * edge. The .js create() lays the motes out across the chapter's local Y travel; the
 * .js update() re-centres the field on the camera so the camera is always inside it.
 * @param {object} uTime shared time uniform
 */
export function createCorridorDustTSL(uTime = uniform(0), requestedCount = 460) {
    // Creative plan ch7 item 1: density raised toward 3× through the dead 07–23
    // midsection (the .js scales off the quality preset); hard-capped for fill-rate.
    const count = Math.max(
        CH7_CORRIDOR_DUST_SETTINGS.minCount,
        Math.min(Math.floor(requestedCount), CH7_CORRIDOR_DUST_SETTINGS.maxCount),
    );
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    // Drifting violet / cyan dust + ember palette (ties to the wash violet + the
    // magenta/cyan accretion). Cyan + magenta-violet weighted heavier so the field reads
    // as the lead's "violet/cyan dust+ember field" with clear parallax depth.
    const palette = [
        new THREE.Color(0x7a4cff),
        new THREE.Color(0xb060ff),
        new THREE.Color(0xff66d8),
        new THREE.Color(0x5c6cff),
        new THREE.Color(0x66e3ff),
        new THREE.Color(0x9affff),
        // Warm accents for richer colour variety (the user's "MORE colors" ask) — soft
        // gold/amber embers threaded through the violet/cyan dust; still additive-feathered.
        new THREE.Color(0xffcf6e),
        new THREE.Color(0xff9a4c),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        // Spread laterally + across the full local-Y corridor travel, biased in front so
        // the camera always has near + mid motes for parallax depth.
        positions[stride] = (Math.random() - 0.5) * CH7_CORRIDOR_DUST_SETTINGS.spreadX;
        positions[stride + 1] = (Math.random() - 0.5) * CH7_CORRIDOR_DUST_SETTINGS.spreadY;
        positions[stride + 2] = CH7_CORRIDOR_DUST_SETTINGS.depthNear
            - Math.random() * CH7_CORRIDOR_DUST_SETTINGS.depthSpan;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
        sizes[index] = CH7_CORRIDOR_DUST_SETTINGS.minSize
            + Math.random() * CH7_CORRIDOR_DUST_SETTINGS.sizeSpan;
        phases[index] = Math.random() * Math.PI * 2;
    }

    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');

    // Slow drift on the soft-puff CENTER (cheap parallax body; no per-frame CPU work).
    const center = vec3(
        aBase.x.add(sin(uTime.mul(0.05).add(aPhase)).mul(7.0)),
        aBase.y.add(cos(uTime.mul(0.04).add(aPhase.mul(1.3))).mul(5.0)),
        aBase.z,
    );
    const positionNode = billboardWorld(center, aSize);

    // Soft round puff feathered to 0 before the quad edge (pow(1 - d*2, 2.0)) with a
    // brighter ember core (pow 2.0 keeps a fuller body than the old 2.2 so motes read at
    // distance) — still fully feathered to 0 at the edge, no hard ring.
    const d = length(uv().sub(0.5));
    const glow = pow(
        clamp(oneMinus(d.mul(2.0)), 0.0, 1.0),
        CH7_CORRIDOR_DUST_SETTINGS.glowPower,
    );
    // Gentle breathing alpha — raised again (0.22 → 0.3 base, creative plan: the bokeh
    // field needs 3–4× perceived density/brightness through the midsection) while
    // staying capped well below a haze wall.
    const breathe = sin(uTime.mul(0.3).add(aPhase))
        .mul(CH7_CORRIDOR_DUST_SETTINGS.breatheSwing)
        .add(CH7_CORRIDOR_DUST_SETTINGS.breatheBase);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor.mul(CH7_CORRIDOR_DUST_SETTINGS.colorGain);
    material.opacityNode = clamp(
        glow.mul(breathe),
        0.0,
        CH7_CORRIDOR_DUST_SETTINGS.opacityCap,
    );
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    // Faint dust — deliberately NOT a bloom emitter (avoids feeding the bloom pass).

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'corridor-violet-dust-tsl';
    mesh.frustumCulled = false;
    mesh.userData.readability = CH7_CORRIDOR_DUST_SETTINGS;
    return { mesh, material, geometry };
}

// ── Infall ember / dust field around the lensed hero (instanced, capped, parallax) ─

/**
 * A DENSE drifting ember/dust/infall field that swirls around the ever-present lensed
 * singularity (the user's "MORE particles" ask). Pure ADDITIVE polish — it does not
 * touch the hero, the lensing, or the corridor field. Instanced billboard quads
 * (THREE.Points renders 1px on WebGPU), radial-feathered to 0 before the quad edge,
 * with three parallax shells (near/mid/far by base radius + size) so the field reads
 * with depth as the camera dollies. The whole field is parented onto the camera-locked
 * hero by the .js update() (it shares the hero anchor + facing, like the infall streams),
 * so the embers always wreathe the on-screen black hole.
 *
 * Motion is entirely GPU-side (uTime + per-instance phase) so update() does NO per-frame
 * CPU work and the geometry is uploaded once: each ember orbits tangentially (cos/sin of
 * a slowly advancing angle) AND breathes radially inward/outward (a bounded sine) so the
 * field reads as matter spiralling toward the horizon without ever leaving its shell —
 * the same bounded-oscillation discipline as the shard drift (no unbounded integration,
 * no per-frame re-upload).
 *
 * @param {object} uTime shared time uniform
 * @param {number} [count] instance count (capped); scale off options.particleCount in .js
 */
export function createInfallEmberFieldTSL(uTime = uniform(0), count = 520) {
    const safeCount = Math.max(48, Math.min(Math.floor(count), 620));
    const bases = new Float32Array(safeCount * 3); // x=baseRadius, y=baseAngle, z=baseZ/height
    const colors = new Float32Array(safeCount * 3);
    const sizes = new Float32Array(safeCount);
    const phases = new Float32Array(safeCount);
    const seeds = new Float32Array(safeCount); // per-ember orbital speed + drift sign

    // Saturated magenta / cyan / gold / violet ember palette (more varied colour, the
    // user's "MORE colors" ask) — soft, capped below white by the additive feather.
    const palette = [
        new THREE.Color(0xff3ad0), // hot magenta
        new THREE.Color(0xff7ae0), // pink
        new THREE.Color(0x7a4cff), // violet
        new THREE.Color(0x4ec8ff), // cyan
        new THREE.Color(0x9affff), // ice cyan
        new THREE.Color(0xffcf6e), // gold
        new THREE.Color(0xff9a4c), // amber ember
        new THREE.Color(0xb060ff), // electric violet
    ];

    // Three parallax shells: near (small radius, big sprite), mid, far (big radius, small
    // sprite). The shell index biases radius + size + drift speed so depth reads as the
    // camera dollies past the hero. Lookup arrays (avoid nested ternaries).
    const SHELL_RADIUS = [70, 150, 260];
    const SHELL_SIZE = [6.0, 4.2, 2.6];
    const SHELL_SPEED = [1.0, 1.0, 0.6];

    for (let index = 0; index < safeCount; index += 1) {
        const stride = index * 3;
        const shell = index % 3;
        const radius = SHELL_RADIUS[shell] + (Math.random() - 0.5) * (60 + shell * 50);
        const angle = Math.random() * Math.PI * 2;
        // Disk-biased height (thin torus around the accretion plane) so embers wreathe the
        // disk rather than forming a uniform sphere; far shell is a touch taller.
        const height = (Math.random() - 0.5) * (34 + shell * 26);

        bases[stride] = radius;
        bases[stride + 1] = angle;
        bases[stride + 2] = height;

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;

        // Near sprites larger; far sprites small + crisp (parallax size cue).
        sizes[index] = SHELL_SIZE[shell] + Math.random() * 3.5;
        phases[index] = Math.random() * Math.PI * 2;
        // Orbital speed + a signed drift component; far shell drifts slower (parallax).
        seeds[index] = (0.10 + Math.random() * 0.22) * SHELL_SPEED[shell]
            * (index % 2 === 0 ? 1 : -1);
    }

    const geometry = makeQuadInstancedGeometry(safeCount, {
        aBase: { array: bases, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aPhase: { array: phases, itemSize: 1 },
        aSeed: { array: seeds, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aPhase = attribute('aPhase', 'float');
    const aSeed = attribute('aSeed', 'float');

    // GPU-side orbital + radial-breathing motion (no per-frame CPU). The angle advances
    // by uTime*aSeed (tangential orbit, alternating direction); the radius breathes inward
    // by a bounded sine so embers read as matter spiralling toward the horizon then being
    // flung out, all within the shell (bounded — same discipline as the shard drift).
    const angle = aBase.y.add(uTime.mul(aSeed));
    const infall = sin(uTime.mul(0.4).mul(abs(aSeed).add(0.3)).add(aPhase)).mul(0.18).add(0.86);
    const radius = aBase.x.mul(infall);
    const center = vec3(
        cos(angle).mul(radius),
        aBase.z.add(sin(uTime.mul(0.22).add(aPhase)).mul(5.0)),
        sin(angle).mul(radius),
    );
    const positionNode = billboardWorld(center, aSize);

    // Soft round ember feathered to 0 before the quad edge (pow keeps a full body but no
    // hard ring), with a gentle twinkle so the dense field shimmers rather than reading
    // as a static cloud.
    const d = length(uv().sub(0.5));
    const glow = pow(clamp(oneMinus(d.mul(2.0)), 0.0, 1.0), 1.9);
    const twinkle = sin(uTime.mul(1.6).add(aPhase.mul(1.7))).mul(0.18).add(0.42);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    // Capped well below a haze wall — additive, ACES + threshold bloom downstream.
    material.opacityNode = clamp(glow.mul(twinkle), 0.0, 0.6);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    // Bloom-eligible: these are glowing embers near the hero (the disk/photon ring bloom),
    // but the low capped alpha keeps them from over-feeding the pass.
    material.userData.emitsBloom = true;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'infall-ember-field-tsl';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ── Twinkling point material (shared by shards + lensed starfield) ───────────────

/**
 * Build a twinkling additive billboard-quad material — the TSL twin of the twinkle*
 * shaders, reworked for WebGPU (THREE.Points renders as 1px GPU points there). The
 * per-instance `aBase`/`aColor`/`aSize`/`aTwinkle` attributes drive an instanced
 * billboard quad: positionNode billboards aBase to the camera (billboardWorld), uv()
 * replaces gl_PointCoord for the round sprite mask, and the old screen-space
 * `gl_PointSize = aSize * tw * (260 / -mv.z)` clamp becomes a WORLD-space size (the
 * 260/-viewZ perspective term is dropped — billboardWorld is world-space so
 * perspective scaling is automatic). aSize (~1.2-4.0) maps into world units so the
 * sprites stay visible against the far-z void without ballooning.
 */
function createTwinkleMaterialTSL(uTime, options = {}) {
    const aBase = attribute('aBase', 'vec3');
    const aColor = attribute('aColor', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'float');

    const tw = sin(uTime.mul(2.2).add(aTwinkle)).mul(0.5).add(0.5);

    // World-space billboard size (replaces the pixel gl_PointSize; perspective is
    // automatic via billboardWorld). aSize*tw scaled into world units and floored so a
    // fully-dimmed twinkle still leaves a faint visible spark.
    const size = aSize.mul(tw).mul(1.1).add(0.5);

    // ── B5: in-shader vertical drift (replaces the per-frame CPU aBase rewrite) ──────
    // The shards used to drift in .js update() via an element-wise loop over aBase.y +
    // a full GPU re-upload (needsUpdate=true) every frame. That CPU loop + re-upload is
    // now gone: when `drift` is requested we add a bounded vertical bob to the billboard
    // center entirely on the GPU, driven by uTime + a per-shard phase (aTwinkle) + the
    // camera-Y uniform (uCameraY, ticked by .js update()). The old loop accumulated an
    // integral of the same sine; this bounded oscillation reads as the same gentle
    // wander but allocates/uploads nothing per frame. Starfield does not drift, so the
    // node is only built when options.drift is set (keeps that material identical).
    let center = aBase;
    let driftUniforms = null;
    if (options.drift) {
        const uCameraY = uniform(0); // .js feeds camera.position.y each frame
        const uDriftAmp = uniform(options.drift.amplitude ?? 2.4);
        const uDriftSpeed = uniform(options.drift.speed ?? 0.6);
        const driftY = sin(uTime.mul(uDriftSpeed).add(aTwinkle).add(uCameraY.mul(0.002)))
            .mul(uDriftAmp);
        center = vec3(aBase.x, aBase.y.add(driftY), aBase.z);
        driftUniforms = { uCameraY, uDriftAmp, uDriftSpeed };
    }
    const positionNode = billboardWorld(center, size);

    // Round sprite mask with a soft falloff (pow(1 - d*2, 1.6)). The GLSL discards at
    // d > 0.5; here the falloff base is clamped to [0,1] so it reaches 0 at the edge
    // (and never goes negative → no pow(neg) NaN), giving the same soft round point
    // under additive blending without a hard discard.
    const d = length(uv().sub(0.5));
    const glow = pow(clamp(oneMinus(d.mul(2.0)), 0.0, 1.0), 1.6);
    const alpha = glow.mul(tw);

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = aColor;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;
    if (driftUniforms) {
        material.userData.driftUniforms = driftUniforms;
    }
    return material;
}

// ── Transcendence shards (additive points, bloom-eligible) ───────────────────────

export function createTranscendenceShardsTSL(uTime = uniform(0)) {
    const count = 150;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    const palette = [
        new THREE.Color(0xff66d8),
        new THREE.Color(0x66e3ff),
        new THREE.Color(0xffd28a),
    ];

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 30 + (Math.random() * 110);
        positions[stride] = Math.cos(angle) * radius;
        positions[stride + 1] = (Math.random() - 0.5) * 130;
        positions[stride + 2] = -760 - (Math.random() * 130);

        const color = palette[index % palette.length];
        colors[stride] = color.r;
        colors[stride + 1] = color.g;
        colors[stride + 2] = color.b;
        sizes[index] = 1.6 + Math.random() * 2.4;
        twinkles[index] = Math.random() * Math.PI * 2;
    }

    // Instanced billboard quads (NOT THREE.Points — points are 1px on WebGPU). The old
    // per-point 'position' becomes the per-instance 'aBase' center.
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
    });

    // B5: request in-shader vertical drift so the per-frame CPU aBase rewrite in .js
    // update() can be removed. The drift uniforms (uCameraY etc.) are surfaced on the
    // returned `uniforms` so .js can keep feeding camera.position.y each frame.
    const material = createTwinkleMaterialTSL(uTime, { drift: { amplitude: 2.4, speed: 0.6 } });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'transcendence-shards-tsl';
    mesh.frustumCulled = false;
    return {
        mesh, material, geometry, uniforms: material.userData.driftUniforms,
    };
}

// ── Lensed starfield (additive points, bloom-eligible) ───────────────────────────

export function createLensingStarfieldTSL(uTime = uniform(0)) {
    const count = 760;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkles = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const angle = Math.random() * Math.PI * 2;
        const radius = 58 + Math.random() * 190;
        // Tangential stretch near the horizon -> stars smear into lensed arcs.
        const bend = 1 + Math.sin(angle * 3.0) * 0.22;
        positions[stride] = Math.cos(angle) * radius * bend;
        positions[stride + 1] = Math.sin(angle) * radius * 0.42;
        positions[stride + 2] = -790 - Math.random() * 200;

        const hot = index % 4 === 0;
        colors[stride] = hot ? 1.0 : 0.6;
        colors[stride + 1] = hot ? 0.66 : 0.8;
        colors[stride + 2] = 1.0;
        // MAGNITUDE VARIANCE (creative plan, DNEG discipline): power-law sizing — most
        // stars tiny, a few bright giants — so the tangential lensing smear reads as
        // distorted STARLIGHT of varied magnitude, never a uniform blur.
        sizes[index] = 0.8 + Math.random() * Math.random() * 4.2;
        twinkles[index] = Math.random() * Math.PI * 2;
    }

    // Instanced billboard quads (NOT THREE.Points — points are 1px on WebGPU). The old
    // per-point 'position' becomes the per-instance 'aBase' center.
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: positions, itemSize: 3 },
        aColor: { array: colors, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aTwinkle: { array: twinkles, itemSize: 1 },
    });

    const material = createTwinkleMaterialTSL(uTime);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lensing-starfield-tsl';
    mesh.frustumCulled = false;
    return { mesh, material, geometry };
}

// ── Non-shader companions (left unconverted; render on WebGPURenderer as-is) ──────
// createEventHorizon's dark horizon (MeshBasicMaterial), photon ring
// (MeshBasicMaterial additive), createAccretionGlowRings (MeshBasicMaterial), and
// createInfallStreams (MeshBasicMaterial tubes) use no custom shader, so the pilot
// assembler rebuilds them with the same NodeMaterial-compatible MeshBasicMaterial.

function createHorizonCore() {
    const geometry = new THREE.SphereGeometry(38, 64, 48);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(1, 1, 0.9);
    return { mesh, material, geometry };
}

function createPhotonRing() {
    const geometry = new THREE.RingGeometry(39, 43, 192, 1);
    // Radially feathered across the ring quad (uv.y spans inner→outer) so alpha reaches
    // 0 before both edges: a soft incandescent lip hugging the horizon, not a hard hoop.
    const material = new THREE.MeshBasicNodeMaterial();
    const rv = uv().y;
    const feather = smoothstep(0.0, 0.42, rv).mul(oneMinus(smoothstep(0.58, 1.0, rv)));
    material.colorNode = vec3(1.0, 0.914, 0.69).mul(feather);
    material.opacityNode = feather.mul(0.9);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;
    const mesh = new THREE.Mesh(geometry, material);
    return { mesh, material, geometry };
}

/**
 * Assemble the converted materials on their original geometries into one group + a
 * single uTime uniform (and a uEnergy uniform) the caller ticks each frame. Mirrors
 * createDeepOceanPilotTSL — used by the standalone WebGPU pilot validation page. The
 * event-horizon anchor reproduces createEventHorizon's group transform
 * (position/rotation) and child order so the lensing shell and disk sit identically.
 */
export function createBlackHoleTranscendencePilotTSL() {
    const uTime = uniform(0);
    const uEnergy = uniform(0.4);
    const group = new THREE.Group();
    group.name = 'black-hole-transcendence-pilot-tsl';

    const dome = createVoidDomeTSL(uTime, uEnergy);
    dome.mesh.position.z = -740;
    group.add(dome.mesh);

    const wash = createAmbientWashTSL(uTime, uEnergy);
    group.add(wash.mesh);

    const dust = createCorridorDustTSL(uTime);
    group.add(dust.mesh);

    // Hero event-horizon anchor (matches createEventHorizon's transform + child order).
    const anchor = new THREE.Group();
    anchor.name = 'dominant-event-horizon-anchor-tsl';
    anchor.position.set(0, 0, -780);
    anchor.rotation.x = -1.05;

    const horizon = createHorizonCore();
    const disk = createAccretionDiskTSL(uTime, uEnergy);
    const photonRing = createPhotonRing();
    const lensShell = createLensingShellTSL(uTime, uEnergy);
    // Dense infall ember field wreathing the hero (parented to the anchor so it shares the
    // disk plane, matching the runtime placement onto the camera-locked hero).
    const embers = createInfallEmberFieldTSL(uTime);
    anchor.add(horizon.mesh, disk.mesh, photonRing.mesh, lensShell.mesh, embers.mesh);
    group.add(anchor);

    const shards = createTranscendenceShardsTSL(uTime);
    group.add(shards.mesh);

    const starfield = createLensingStarfieldTSL(uTime);
    group.add(starfield.mesh);

    const parts = [
        dome, wash, dust, horizon, disk, photonRing, lensShell, embers, shards, starfield,
    ];

    return {
        group,
        uniforms: { uTime, uEnergy },
        dispose() {
            parts.forEach((part) => {
                part.geometry?.dispose?.();
                part.material?.dispose?.();
            });
        },
    };
}

export default createBlackHoleTranscendencePilotTSL;
