/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * @fileoverview Cosmic Expanse (Chapter 6) — TSL/WebGPU conversion.
 *
 * Part of the Odyssey AAA WebGPU migration (P3 — board off WebGLRenderer). See
 * docs/ODYSSEY_MODE_AAA_OVERHAUL_PLAN.md §5. Faithful TSL ports of cosmic-expanse.js's
 * three GLSL ShaderMaterials — the FBM nebula void dome (backstop), the volumetric
 * black-hole accretion disk + gravitational-lensing shell (the HERO), and the banded
 * gas-giant hero planet — rebuilt as NodeMaterials so they run on the WebGPURenderer
 * and its WebGL2 fallback backend (one codebase, both backends).
 *
 * The live chapter imports ODYSSEY_NOISE_GLSL (od_* value noise: fbm3/ridged3); those
 * map 1:1 to the matching exports of the shared TSL noise lib (fbm3/ridged3), so the
 * converted look is preserved (same lattice, same lacunarity/octaves).
 *
 * The accretion disk and lensing shell are additive glows, so they are tagged
 * `userData.emitsBloom = true` for the future MRT selective-bloom pass; emissiveNode is
 * NOT wired here (that lands with the TSL post graph). The void dome is the backstop
 * and the gas giant is a lit surface — neither blooms.
 *
 * ADDITIVE: this is a NEW sibling module. The live cosmic-expanse.js (WebGL board) is
 * untouched. The Points systems (nebula volume, suction particles, void stars) and the
 * plain MeshBasic decorations (horizon, photon ring, glow rings, atmosphere, ring
 * system) render on WebGPURenderer as-is and are not converted here.
 */

import * as THREE from 'three/webgpu';
import {
    abs,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    normalView,
    oneMinus,
    positionLocal,
    positionViewDirection,
    pow,
    sin,
    smoothstep,
    uniform,
    uv,
    varying,
    vec3,
} from 'three/tsl';
import { fbm3, ridged3 } from './shared/odyssey-tsl-noise.js';

// ── Nebula void dome — FBM galactic backdrop (-100 backstop; must NOT bloom) ──────

export function createVoidSkyTSL(uTime, uEnergy, uOpacity = uniform(1)) {
    const time = uTime ?? uniform(0);
    const energy = uEnergy ?? uniform(0.3);

    const dir = normalize(positionLocal);
    const h = dir.y.mul(0.5).add(0.5);

    // Deep space vertical gradient — DEEP CLEAR VACUUM. Push the base toward true
    // black so the void reads as empty space, with only the faintest indigo lift at
    // the top for tonal depth (NOT a purple fog wash). This is the floor between the
    // nebula pockets, so it must stay near-black across most of the sphere.
    const base = mix(vec3(0.0015, 0.0015, 0.006), vec3(0.008, 0.005, 0.024), pow(h, 1.4));

    // Galactic band: a tilted plane of denser dust. Tighten the falloff hard (11.0)
    // so the band is a narrow lane, not a broad haze spread across the sky.
    const bandDot = dot(dir, normalize(vec3(0.4, 0.18, 1.0)));
    const band = exp(pow(bandDot, 2.0).mul(11.0).negate());

    // ── BLOOD-MOON NEBULA TECHNIQUE (adapted to TSL) ──────────────────────────────
    // The reference nebula (blood-moon nebulaFragment) DOMAIN-WARPS the sample coords
    // with FBM before sampling the cloud, then highlights the warp GRADIENT to fake gas
    // catching light. We do the same in 3D: build a low-frequency warp vector from two
    // decorrelated FBM fields and bend the lookup point with it. This turns the flat
    // thresholded blobs into billowing, fibrous, domain-warped gas with depth — the
    // single biggest "looks like blood-moon" win — while the high thresholds below keep
    // the deep-vacuum pocketing (true-black gaps), so it never becomes a wash.
    // 3 octaves per warp axis — low-frequency bend only, held LOW to keep the backdrop
    // sphere's per-fragment cost bounded (perf-safe; the deepening detail comes from the
    // warp displacing the EXISTING full-octave dust/filament lookups, not extra octaves).
    const warpField = vec3(
        fbm3(dir.mul(1.7).add(vec3(0.0, 0.0, time.mul(0.015))), 3),
        fbm3(dir.mul(1.7).add(vec3(11.5, 4.0, time.mul(0.012).negate())), 3),
        fbm3(dir.mul(1.7).add(vec3(23.0, 9.0, time.mul(0.010))), 3),
    ).sub(0.5).mul(0.85);
    // Warped sample coord — the "fluid billowy distortion" from the reference, in 3D.
    const q = dir.mul(2.6).add(warpField).add(vec3(0.0, 0.0, time.mul(0.02)));

    // POCKET the nebula: take warped low-frequency FBM and THRESHOLD it so colour only
    // appears where the cloud density crosses a high floor — large near-black gaps
    // between a few bright clouds, instead of an even wash. smoothstep(0.50,0.82)
    // clips away the low/mid noise (the wash) and a square + extra power steepens the
    // remaining peaks into discrete pockets. (The warp now feeds richer interior shape.)
    // 3 octaves (was the default 5): the dust feeds a hard smoothstep(0.50,0.82) pocket
    // threshold + pow(1.7), which clips the octave-4/5 high-frequency wiggle (amplitude
    // ~0.06/0.03) almost entirely — so the pocketed result is ~unchanged while the dome's
    // per-fragment noise cost drops. Verified on the playground vs the baseline.
    const dustRaw = fbm3(q, 3);
    const pocket = smoothstep(0.50, 0.82, dustRaw);
    const dust = pow(pocket, 1.7).mul(pocket.mul(0.5).add(0.5));

    // Filaments: ridged crests on the SAME warped field, also thresholded, riding ALONG
    // the band lane so the brightest tendrils concentrate in the galactic plane. The
    // domain warp makes these read as twisting fibrous strands, not concentric rings.
    const filRaw = ridged3(q.mul(0.8).add(13.0), 3);
    const filaments = smoothstep(0.42, 0.76, filRaw).mul(band.mul(0.8).add(0.2));

    // FILAMENT CORES — the blood-moon "volume highlight": a tight high threshold on the
    // ridged crest gives bright incandescent strand cores (the densest gas catching the
    // accretion light). Squared so only the very brightest crest tips light up hot.
    const filCore = pow(smoothstep(0.62, 0.86, filRaw), 2.0);

    // A second, larger-scale pocket mask for a couple of big indigo/magenta clouds —
    // very low frequency so it gates whole regions on/off (true black between).
    const macroRaw = fbm3(dir.mul(1.15).add(vec3(7.0, 2.0, time.mul(0.01))), 4);
    const macro = smoothstep(0.55, 0.86, macroRaw);

    // B3b — a THIRD macro pocket on a DIFFERENT seed/scale so a COOL cobalt-teal
    // cloud body coexists with the warm magenta pockets (cool + warm with true-black
    // gaps between, per the north-star frame's deep-blue pocket). Offset seed +
    // different frequency means this mask gates separate regions of the sphere.
    const macroCoolRaw = fbm3(dir.mul(0.92).add(vec3(31.0, 17.0, time.mul(0.008).negate())), 4);
    const macroCool = smoothstep(0.58, 0.88, macroCoolRaw);
    const dustCool = fbm3(q.mul(0.86).add(23.0), 3);
    const pocketCool = smoothstep(0.48, 0.82, dustCool);
    const coolDust = pow(pocketCool, 1.6).mul(pocketCool.mul(0.5).add(0.5));

    // Vivid, concentrated pockets — DEEPER + MORE SATURATED bodies (blood-moon depth):
    // saturated indigo cloud bodies, hot magenta cores in the densest spots, warm rust
    // filaments along the band with bright incandescent strand cores, AND a cool
    // cobalt/teal pocket on the separate cool mask. Everything is gated by the threshold
    // masks so the regions between go to the near-black base (cool + warm coexist).
    let nebula = vec3(0.22, 0.06, 0.46).mul(dust).mul(macro.mul(0.7).add(0.3));
    nebula = nebula.add(vec3(0.54, 0.11, 0.40).mul(pow(dust, 2.0)).mul(macro)); // magenta cores
    nebula = nebula.add(vec3(0.40, 0.10, 0.13).mul(filaments).mul(0.85)); // rust tendrils in the band
    nebula = nebula.add(vec3(1.0, 0.55, 0.42).mul(filCore).mul(band).mul(0.5)); // hot strand cores
    // Cool cobalt/teal cloud body — a separate temperature so Space reads as cool+warm.
    nebula = nebula.add(vec3(0.05, 0.18, 0.46).mul(coolDust).mul(macroCool.mul(0.78).add(0.22)));
    nebula = nebula.add(vec3(0.12, 0.34, 0.52).mul(pow(coolDust, 2.0)).mul(macroCool).mul(0.75)); // teal cores

    // Energy gently brightens the EXISTING pockets (does not fill the gaps).
    const color = base.add(nebula.mul(energy.mul(0.5).add(0.7)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = uOpacity;
    material.side = THREE.BackSide;
    material.depthWrite = false;
    material.transparent = true;

    const geometry = new THREE.SphereGeometry(2400, 64, 48);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100;
    return { mesh, material, geometry };
}

// ── Accretion disk — swirling Keplerian plasma with Doppler beaming (bloom) ───────

export function createAccretionDiskTSL(uTime, uEnergy) {
    const time = uTime ?? uniform(0);
    const energy = uEnergy ?? uniform(0.3);
    const uInner = uniform(28);
    const uOuter = uniform(96);
    // Wider hot→cool spread for richer banding against the deepened void: a hotter
    // white-gold core, a more saturated orange mid, and a deeper event-horizon violet.
    const uHot = uniform(new THREE.Color(0xfff0c4));
    const uMid = uniform(new THREE.Color(0xff5a14));
    const uCool = uniform(new THREE.Color(0x6a2cff));

    // Vertex-derived varyings (length / atan / xy of the ring vertex).
    const posL = positionLocal;
    const vRadius = varying(length(posL.xy));
    const vAngle = varying(atan(posL.y, posL.x));
    const vLocal = varying(posL.xy);

    const t = clamp(vRadius.sub(uInner).div(uOuter.sub(uInner)), 0.0, 1.0);

    // Differential rotation: inner orbits faster than outer (Keplerian feel).
    const swirl = vAngle.add(time.mul(oneMinus(t).mul(1.6).add(0.55)));
    const sp = vec3(cos(swirl), sin(swirl), 0.0).mul(t.mul(3.0).add(0.6));
    const turb = fbm3(sp.mul(1.6).add(vec3(0.0, 0.0, time.mul(0.12))), 4);
    const streaks = sin(swirl.mul(3.0).add(t.mul(16.0)).sub(time.mul(1.1))).mul(0.5).add(0.5);
    const plasma = mix(turb, streaks, 0.4);

    // SOFT VOLUME radial ramp — feather alpha to EXACTLY 0 before BOTH the inner and
    // outer ring edges so the disk reads as plasma volume, never a hard-edged card.
    // innerFeather lifts off zero just past the photon ring, midBody is a fat soft
    // band, and outerFeather dissolves the rim well before the geometry edge (t→1).
    const innerFeather = smoothstep(0.0, 0.16, t);
    const outerFeather = oneMinus(smoothstep(0.62, 0.985, t));
    // A second, slower falloff stacked on the body gives an inner/outer parallax read
    // (bright torus core that bleeds out both ways) rather than one flat brightness.
    const body = pow(oneMinus(clamp(abs(t.sub(0.22).mul(1.7)), 0.0, 1.0)), 1.6).mul(0.7).add(0.3);
    const radial = innerFeather.mul(outerFeather).mul(body);

    // Bright Doppler-warped INNER EDGE — a hot incandescent lip hugging the horizon,
    // warped by the beaming so the approaching side flares hotter. Feathered both sides.
    const innerLip = pow(oneMinus(smoothstep(0.0, 0.12, t)), 1.4).mul(innerFeather);

    // Doppler beaming: the side rotating toward the camera is brighter/bluer.
    const doppler = smoothstep(uOuter.negate(), uOuter, vLocal.x).mul(0.7).add(0.55);

    let intensity = radial.mul(plasma.mul(0.95).add(0.3)).mul(doppler);
    intensity = intensity.add(innerLip.mul(doppler).mul(0.9)); // hot Doppler inner edge
    intensity = intensity.mul(energy.mul(0.55).add(1.0));

    let color = mix(uHot, uMid, smoothstep(0.0, 0.4, t));
    color = mix(color, uCool, smoothstep(0.4, 1.0, t));
    color = color.add(vec3(0.15, 0.18, 0.30).mul(doppler).mul(radial)); // blue-shift highlight
    color = color.add(uHot.mul(innerLip.mul(0.6))); // incandescent inner lip seats the core

    // Subtle atmosphere/rim haze — a faint magenta-violet bloom of glow that bleeds
    // OUTSIDE the bright body and fades to 0 before the edge, so the hero seats into the
    // void haze instead of floating on black. Kept low so ACES never sees a white edge.
    const rimGlow = smoothstep(0.45, 0.78, t).mul(oneMinus(smoothstep(0.78, 0.985, t)));
    const atmo = uCool.mul(rimGlow.mul(0.22));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(intensity).add(atmo);
    material.opacityNode = clamp(intensity.add(rimGlow.mul(0.18)), 0.0, 1.0);
    material.transparent = true;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    material.blending = THREE.AdditiveBlending;
    material.userData.emitsBloom = true;

    const geometry = new THREE.RingGeometry(28, 96, 240, 6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'accretion-disk';
    return { mesh, material, geometry };
}

// ── Gravitational-lensing shell — fresnel glow that rings the horizon (bloom) ─────

export function createLensShellTSL(uTime) {
    const time = uTime ?? uniform(0);
    const uColor = uniform(new THREE.Color(0x9bbcff));

    // fresnel = pow(1 - max(0, dot(N, V)), 3); N=view-space normal, V=view dir.
    const ndotv = max(0.0, dot(normalView, positionViewDirection));
    const fres = pow(oneMinus(ndotv), 3.0);
    // Feather the Einstein ring on BOTH fresnel edges so it dissolves softly into the
    // void instead of clipping hard at the silhouette — a soft band, not a hoop.
    const ring = smoothstep(0.30, 0.78, fres).mul(oneMinus(smoothstep(0.90, 1.0, fres)));
    const shimmer = sin(time.mul(1.4).add(fres.mul(12.0))).mul(0.15).add(0.85);
    // Faint wide atmosphere bleed below the ring threshold so the shell seats into the
    // haze (no hard inner cutoff). Kept very low — additive, never a white edge.
    const atmo = smoothstep(0.06, 0.42, fres).mul(oneMinus(smoothstep(0.42, 0.78, fres)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uColor.mul(ring.mul(shimmer).add(atmo.mul(0.22)));
    material.opacityNode = ring.mul(0.5).add(atmo.mul(0.12));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.FrontSide;
    material.userData.emitsBloom = true;

    const geometry = new THREE.SphereGeometry(30, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'lensing-shell';
    return { mesh, material, geometry };
}

// ── Black-hole anchor — assembles the converted disk + lens shell with the plain ──
//    MeshBasic decorations (horizon / photon ring / glow rings) faithfully reproduced.

export function createBlackHoleTSL(uTime, uEnergy) {
    const group = new THREE.Group();
    group.name = 'volumetric-black-hole-anchor';

    // Event horizon — a perfectly dark, slightly oblate sphere (plain MeshBasic).
    const horizon = new THREE.Mesh(
        new THREE.SphereGeometry(24, 48, 32),
        new THREE.MeshBasicNodeMaterial({ color: 0x000000 }),
    );
    horizon.scale.set(1.0, 1.0, 0.9);
    group.add(horizon);

    // Shader accretion disk (the dominant feature) — converted to TSL.
    const disk = createAccretionDiskTSL(uTime, uEnergy);
    group.add(disk.mesh);

    // Photon ring — thin bright ring hugging the horizon, in the disk plane. Radially
    // feathered across the ring quad (uv.y spans inner→outer) so alpha reaches 0 before
    // both edges: a soft incandescent lip, not a hard-edged hoop.
    const photonMat = new THREE.MeshBasicNodeMaterial();
    const photonV = uv().y;
    const photonFeather = smoothstep(0.0, 0.42, photonV).mul(oneMinus(smoothstep(0.58, 1.0, photonV)));
    photonMat.colorNode = vec3(1.0, 0.94, 0.75).mul(photonFeather);
    photonMat.opacityNode = photonFeather.mul(0.85);
    photonMat.transparent = true;
    photonMat.depthWrite = false;
    photonMat.blending = THREE.AdditiveBlending;
    photonMat.side = THREE.DoubleSide;
    photonMat.userData.emitsBloom = true;
    const photonRing = new THREE.Mesh(new THREE.RingGeometry(25.5, 28.5, 160, 1), photonMat);
    group.add(photonRing);

    // Two coplanar additive glow rings to feed bloom and add depth. Each is now a soft
    // radial-feathered halo (alpha→0 before both ring edges) so the hero seats into the
    // void haze with no concentric hard ring lines floating on black.
    const glowColors = [new THREE.Color(0xff7b3a), new THREE.Color(0x7f3cff)];
    [0, 1].forEach((index) => {
        const glowMat = new THREE.MeshBasicNodeMaterial();
        const gv = uv().y;
        // Soft bell across the ring band: feathered to 0 at both inner + outer edges.
        const gFeather = pow(smoothstep(0.0, 0.5, gv).mul(oneMinus(smoothstep(0.5, 1.0, gv))).mul(4.0), 1.1);
        const gc = glowColors[index];
        glowMat.colorNode = vec3(gc.r, gc.g, gc.b).mul(gFeather);
        glowMat.opacityNode = clamp(gFeather, 0.0, 1.0).mul(0.12 - index * 0.04);
        glowMat.transparent = true;
        glowMat.depthWrite = false;
        glowMat.blending = THREE.AdditiveBlending;
        glowMat.side = THREE.DoubleSide;
        glowMat.userData.emitsBloom = true;
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(40 + index * 22, 70 + index * 30, 96, 1),
            glowMat,
        );
        group.add(ring);
    });

    // Gravitational-lensing fresnel shell — converted to TSL.
    const lens = createLensShellTSL(uTime);
    group.add(lens.mesh);

    return {
        group,
        disk,
        lens,
        dispose() {
            [horizon, photonRing].forEach((m) => {
                m.geometry?.dispose?.();
                m.material?.dispose?.();
            });
            disk.geometry?.dispose?.();
            disk.material?.dispose?.();
            lens.geometry?.dispose?.();
            lens.material?.dispose?.();
        },
    };
}

// ── Gas-giant hero planet — latitudinal storm bands + day/night + atmosphere rim ──

export function createHeroPlanetSurfaceTSL(uTime) {
    const time = uTime ?? uniform(0);
    // Richer, higher-contrast gas-giant palette so the hero reads as a crisp
    // focal point against the deep void instead of a dim banded ball: warm
    // butterscotch crests, deep cobalt troughs, near-black shadowed bands, plus
    // a saturated crimson storm and a hot tangerine limb.
    const uCrest = uniform(new THREE.Color(0xd9a86a)); // warm butterscotch band crest
    const uTrough = uniform(new THREE.Color(0x3f5fb0)); // cool cobalt band trough
    const uShadow = uniform(new THREE.Color(0x0c1226)); // deep shadowed band
    const uStorm = uniform(new THREE.Color(0xff6a3a)); // great-red-spot storm
    const uLightDir = uniform(new THREE.Vector3(0.72, 0.34, 0.6).normalize());

    const n = normalize(positionLocal);

    // Latitudinal storm bands — sharper, multi-frequency turbulent warp so the
    // banding reads as flowing cloud belts with crisp edges, not a soft blur.
    const warp = fbm3(n.mul(2.6).add(time.mul(0.04))).mul(3.4)
        .add(fbm3(n.mul(6.0).add(time.mul(0.07))).mul(1.1));
    const bands = sin(n.y.mul(13.0).add(warp));
    // Push contrast: bias the band term toward its extremes so crests/troughs pop.
    const bandT = clamp(pow(bands.mul(0.5).add(0.5), float(0.7)), 0.0, 1.0);

    // Fine swirling cloud turbulence layered on top of the belts.
    const swirl = fbm3(n.mul(5.5).add(vec3(time.mul(0.06), time.mul(0.02), 0.0)), 4);
    const detail = clamp(bandT.add(swirl.sub(0.5).mul(0.5)), 0.0, 1.0);

    // Crest ↔ trough, then drop the darkest belts toward shadow for depth.
    let color = mix(uTrough, uCrest, detail);
    color = mix(uShadow, color, smoothstep(0.0, 0.32, detail));

    // Great-Red-Spot style cyclonic storm — a persistent oval cell in the
    // southern hemisphere, swirled by ridged noise.
    const spotCenter = normalize(vec3(0.55, -0.32, 0.62));
    const spotDot = dot(n, spotCenter);
    const spotMask = smoothstep(0.86, 0.985, spotDot);
    const spotSwirl = ridged3(n.mul(9.0).add(time.mul(0.12))).mul(0.6).add(0.4);
    color = mix(color, uStorm.mul(spotSwirl), spotMask.mul(0.85));

    // Day / night terminator (view-space normal vs. light dir).
    const diffuse = max(0.0, dot(normalView, normalize(uLightDir)));
    color = color.mul(diffuse.mul(0.92).add(0.16));

    // Hot rim/limb light — a tight tangerine sunlit limb on the lit side so the
    // planet has a crisp 3D edge (the lead's "rim light"), feathered by fresnel.
    const fresEdge = max(0.0, dot(normalView, positionViewDirection));
    const limb = pow(oneMinus(fresEdge), 5.0);
    color = color.add(vec3(1.0, 0.62, 0.28).mul(limb).mul(diffuse.mul(0.8).add(0.2)).mul(1.1));

    // Cool scattered atmosphere rim (wider, dimmer than the hot limb).
    const fresAtmo = pow(oneMinus(fresEdge), 2.4);
    color = color.add(vec3(0.26, 0.46, 0.9).mul(fresAtmo).mul(diffuse.mul(0.55).add(0.35)));

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;

    const geometry = new THREE.SphereGeometry(28, 48, 32);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'hero-planet-surface';
    return { mesh, material, geometry };
}

// ── Distant galaxy / quasar — a sharp, persistent deep-space anchor (bloom) ───────
//
// A single far-placed quad (front-facing -z toward the forward camera; DoubleSide so
// any tilt/roll still shows) carrying a procedural spiral galaxy: a hot pinpoint
// quasar core, two log-spiral arms, and a thin foreshortened disc, radial-feathered to
// zero well before the quad edge (per the AAA particle contract — no square clip, no
// haze bleed). This gives Space a fixed bright focal point that reads as DEEP + far
// (the opposite of Sky's haze) — no fog. The caller rolls it slowly on z for life.
export function createDistantGalaxyTSL(uTime) {
    const time = uTime ?? uniform(0);
    const uCore = uniform(new THREE.Color(0xfff4d6)); // hot white-gold quasar core
    const uArm = uniform(new THREE.Color(0x8fb4ff)); // cool blue-white spiral arms
    const uDust = uniform(new THREE.Color(0xff8a5a)); // warm dust-lane tint

    // Centered sprite coords; squash y so the disc reads as a tilted oblate galaxy.
    const p = uv().sub(0.5);
    const pe = vec3(p.x, p.y.mul(2.1), 0.0); // elliptical (foreshortened) radius
    const r = length(pe.xy);
    const ang = atan(pe.y, pe.x);

    // Hard radial mask: feather to 0 before the quad edge (radius 0.46), so no
    // square clipping and no haze bleeding into the corridor.
    const disc = oneMinus(smoothstep(0.0, 0.46, r));

    // Hot pinpoint core — sharp, persistent quasar nucleus.
    const core = pow(oneMinus(smoothstep(0.0, 0.09, r)), 2.4);

    // Two log-spiral arms: brightness peaks where the spiral phase aligns.
    const spiral = sin(ang.mul(2.0).sub(r.mul(26.0)).add(time.mul(0.08)));
    const arms = pow(max(0.0, spiral), 3.0).mul(smoothstep(0.04, 0.18, r)).mul(disc);

    // Dust lanes — a counter-rotating darker/warmer modulation along the arms.
    const dust = pow(max(0.0, sin(ang.mul(2.0).sub(r.mul(26.0)).add(Math.PI * 0.5))), 2.0);

    let color = uCore.mul(core.mul(1.6));
    color = color.add(uArm.mul(arms.mul(0.9)));
    color = color.add(uDust.mul(arms.mul(dust).mul(0.5)));
    // Faint inner halo so the core has a glow seat without going hazy.
    color = color.add(uCore.mul(disc.mul(disc).mul(0.12)));

    const alpha = clamp(core.add(arms.mul(0.8)).add(disc.mul(disc).mul(0.1)), 0.0, 1.0);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color;
    material.opacityNode = alpha;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'distant-galaxy-anchor';
    return { mesh, material, geometry };
}

// ── Hero nebula PILLAR — a one-time Pillars-of-Creation reveal (bloom) ────────────
//
// A single tall plane carrying a vertical ridged column of warm-rust→magenta gas with
// a hot pinpoint star at its tip (a star-forming region). Radial+vertical feathered to
// 0 well before the quad edge (no square clip, no haze bleed), additive, emitsBloom.
// Fades IN via uApproach (0→1 from chapter progress) so it is revealed mid-chapter as a
// signature beat, then holds. The caller places it off the mid-act path.
export function createNebulaPillarTSL(uTime, uApproach) {
    const time = uTime ?? uniform(0);
    const approach = uApproach ?? uniform(0);
    const uBase = uniform(new THREE.Color(0x3a1430)); // dark dusty base of the column
    const uMid = uniform(new THREE.Color(0xb0407a)); // magenta body
    const uHot = uniform(new THREE.Color(0xffd2a0)); // warm-rust hot illuminated edge
    const uTip = uniform(new THREE.Color(0xfff4d8)); // hot pinpoint star at the tip

    // Centered sprite coords; v runs 0 (bottom) → 1 (top) of the column.
    const p = uv().sub(0.5);
    const vCol = uv().y;

    // Ridged vertical column: a narrow gas pillar that tapers toward the tip. The width
    // mask narrows with height (smaller |x| allowed up top) so the column reads tapered.
    const taper = mix(float(0.34), float(0.12), smoothstep(0.1, 0.95, vCol));
    const widthMask = oneMinus(smoothstep(float(0.0), taper, abs(p.x)));
    // Ridged3 modulation along the column for billowing dusty structure (scrolls slowly).
    const ridge = ridged3(vec3(p.x.mul(5.0), vCol.mul(3.2).sub(time.mul(0.05)), 0.0));
    const ridged = smoothstep(0.28, 0.85, ridge);
    // Vertical body envelope: lift off the bottom, fade before the top edge.
    const vBody = smoothstep(0.02, 0.22, vCol).mul(oneMinus(smoothstep(0.78, 0.99, vCol)));
    const column = widthMask.mul(vBody).mul(ridged.mul(0.7).add(0.3));

    // Hot pinpoint star at the tip (the star-forming nucleus): a tight bright core near
    // the top-centre, with a thin diffraction glint so it reads as a true point source.
    const tipCenter = vec3(p.x, p.y.sub(0.34), 0.0);
    const tipR = length(tipCenter.xy);
    const tipStar = pow(oneMinus(smoothstep(0.0, 0.085, tipR)), 2.6);
    const tipSpike = pow(oneMinus(abs(tipCenter.x).mul(16.0)).max(0.0), 3.0)
        .add(pow(oneMinus(abs(tipCenter.y).mul(16.0)).max(0.0), 3.0))
        .mul(oneMinus(smoothstep(0.0, 0.2, tipR)))
        .mul(0.45);

    // Colour the column base→mid→hot edge by structure, seat the hot star tip on top.
    let color = mix(uBase, uMid, smoothstep(0.2, 0.7, ridged));
    color = mix(color, uHot, smoothstep(0.7, 1.0, ridged).mul(0.6));
    color = color.mul(column);
    color = color.add(uTip.mul(tipStar.add(tipSpike)));

    // Cap below 1.0 (additive, capped, soft) and fade in with uApproach so the reveal
    // is a mid-chapter beat, not present at entry.
    const reveal = smoothstep(0.18, 0.62, approach);
    const intensity = clamp(column.add(tipStar.add(tipSpike).mul(0.9)), 0.0, 0.92).mul(reveal);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = color.mul(reveal);
    material.opacityNode = intensity;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
    material.userData.emitsBloom = true;

    const geometry = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'nebula-pillar';
    return { mesh, material, geometry };
}

// ── Hero planet anchor — converted gas-giant surface + plain atmosphere/ring decor ─

export function createHeroPlanetTSL(uTime) {
    const group = new THREE.Group();
    group.name = 'hero-planet-nebula-anchor';
    // Pull the gas giant in from the far-left edge so the forward-looking camera
    // actually frames it: a gentler x/y offset places it inside the frame, upper-
    // right of and slightly nearer than the black hole rather than half-clipped.
    group.position.set(-62, 46, -640);

    const planet = createHeroPlanetSurfaceTSL(uTime);
    group.add(planet.mesh);

    const decor = [];

    // Atmosphere halo — fresnel-shaped TSL glow shell so the rim reads as a soft
    // blue scattering ring hugging the limb (not a flat additive ball). Tagged
    // emitsBloom so the disciplined bloom pass picks up the atmosphere edge.
    const haloFres = pow(oneMinus(max(0.0, dot(normalView, positionViewDirection))), 3.2);
    const haloMat = new THREE.MeshBasicNodeMaterial();
    haloMat.colorNode = vec3(0.42, 0.6, 1.0);
    haloMat.opacityNode = haloFres.mul(0.55);
    haloMat.transparent = true;
    haloMat.depthWrite = false;
    haloMat.blending = THREE.AdditiveBlending;
    haloMat.side = THREE.BackSide;
    haloMat.userData.emitsBloom = true;
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(31.5, 48, 32), haloMat);
    group.add(atmosphere);
    decor.push(atmosphere);

    // Multi-band ring system — three concentric belts with a Cassini-style gap,
    // a procedural fine-band texture (uv radial) and a subtle warm/cool tint, so
    // the rings read as structured ice ringlets rather than one flat hoop.
    const ringInner = [36, 46, 58];
    const ringOuter = [44, 56, 64];
    const ringColor = [
        new THREE.Color(0xcdd8ff),
        new THREE.Color(0xe8d3b0),
        new THREE.Color(0x9fb6ff),
    ];
    const ringOpacity = [0.34, 0.26, 0.18];
    ringInner.forEach((inner, bandIndex) => {
        const outer = ringOuter[bandIndex];
        const color = ringColor[bandIndex];
        const opacity = ringOpacity[bandIndex];
        const ringMat = new THREE.MeshBasicNodeMaterial();
        // Radial coordinate across the ring quad (uv.y spans inner→outer on a
        // RingGeometry's v); fine ripples + soft inner/outer feather.
        const rv = uv().y;
        const ripple = sin(rv.mul(48.0)).mul(0.5).add(0.5).mul(0.5)
            .add(0.5);
        const feather = smoothstep(0.0, 0.12, rv).mul(oneMinus(smoothstep(0.85, 1.0, rv)));
        ringMat.colorNode = vec3(color.r, color.g, color.b).mul(ripple);
        ringMat.opacityNode = feather.mul(ripple).mul(opacity);
        ringMat.transparent = true;
        ringMat.depthWrite = false;
        ringMat.blending = THREE.AdditiveBlending;
        ringMat.side = THREE.DoubleSide;
        const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128, 2), ringMat);
        ring.rotation.x = Math.PI * 0.42;
        ring.rotation.z = 0.18;
        group.add(ring);
        decor.push(ring);
    });

    return {
        group,
        planet,
        dispose() {
            planet.geometry?.dispose?.();
            planet.material?.dispose?.();
            decor.forEach((m) => {
                m.geometry?.dispose?.();
                m.material?.dispose?.();
            });
        },
    };
}

/**
 * Assemble the converted materials into one group + a single uTime/uEnergy uniform the
 * caller ticks each frame. Mirrors deep-ocean.tsl.js's createDeepOceanPilotTSL — used by
 * the standalone WebGPU pilot validation page. Mesh placement (positions/rotations/scale)
 * matches createCosmicExpanseEnvironment in cosmic-expanse.js.
 */
export function createCosmicExpansePilotTSL() {
    const uTime = uniform(0);
    const uEnergy = uniform(0.3);
    const uApproach = uniform(0);
    const group = new THREE.Group();
    group.name = 'cosmic-expanse-pilot-tsl';

    const voidSky = createVoidSkyTSL(uTime, uEnergy);
    group.add(voidSky.mesh);

    const blackHole = createBlackHoleTSL(uTime, uEnergy);
    blackHole.group.position.set(0, 0, -800);
    blackHole.group.rotation.x = -1.12;
    blackHole.group.scale.setScalar(1.5);
    group.add(blackHole.group);

    const heroPlanet = createHeroPlanetTSL(uTime);
    group.add(heroPlanet.group);

    const galaxy = createDistantGalaxyTSL(uTime);
    galaxy.mesh.position.set(150, 150, -820);
    galaxy.mesh.scale.setScalar(120);
    group.add(galaxy.mesh);

    const pillar = createNebulaPillarTSL(uTime, uApproach);
    pillar.mesh.position.set(-170, 40, -600);
    pillar.mesh.scale.set(200, 420, 1);
    group.add(pillar.mesh);

    return {
        group,
        uniforms: { uTime, uEnergy, uApproach },
        dispose() {
            voidSky.geometry?.dispose?.();
            voidSky.material?.dispose?.();
            blackHole.dispose();
            heroPlanet.dispose();
            galaxy.geometry?.dispose?.();
            galaxy.material?.dispose?.();
            pillar.geometry?.dispose?.();
            pillar.material?.dispose?.();
        },
    };
}

export default createCosmicExpansePilotTSL;
