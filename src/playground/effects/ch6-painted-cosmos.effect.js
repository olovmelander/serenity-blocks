/**
 * CH6 PAINTED COSMOS — the Wave 0 paint probe (D0 gate artifact).
 *
 * docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 0: before any sculptor or bake
 * code lands in the chapter, prove the core trick clears the reference bar. Three swatches
 * in one frame, judged against the blessed refs in split mode:
 *
 *   1. ONE sculpted nebula mass — the shipped cloud-field sculptor re-used verbatim
 *      (SDF-gradient normals, vertex-colour AO/height/seed), repainted as a nebula:
 *      2-band wrap paint, hue-shift shade (never grey, never darker), darkness-gated
 *      emissive interior, fresnel drawn edge, fake-Mie backlit lining.
 *   2. A banded-terminator gas giant with a thin warm terminator band + backside halo.
 *   3. A posterized backdrop swatch — the LOOK the cubemap bake will produce (bands, not
 *      smooth FBM falloff), with the void floor held at the black-lift family.
 *
 * Refs: ?ref=/playground-refs/ch6-star-catching-howl044.jpg&refMode=split (bar frame);
 * also ch6-ember-collision-howl040 / ch6-levistone-key-laputa018 / ch6-ascent-dusk-laputa050.
 * Playground is NoToneMapping — these albedos deliberately OVERSHOOT (double-grade law).
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, clamp, color, dot, float, mix, mx_noise_float,
    normalWorld, normalize, positionWorld, smoothstep, uniform, vec3,
} from 'three/tsl';
import { buildCloudFieldGeometry } from '../../rendering/odyssey/world/odyssey-cloud-field.js';

export const meta = {
    id: 'ch6-painted-cosmos',
    title: 'Ch6 Painted Cosmos (Wave 0 probe)',
    description: 'Sculpted nebula mass + banded gas giant + posterized backdrop vs the Ghibli bar',
};

// One key light for the whole frame (the accretion/star key) — warm, from upper-left,
// slightly toward the camera so the wrap term has something to wrap.
const SUN_DIR = new THREE.Vector3(-0.85, 0.22, 0.30).normalize();

// Palette. Roles, not decoration: in the chapter these resolve against colour-script
// slots (plan §3.4); the probe pins candidate values to judge against the refs.
const PALETTE = {
    // Nebula: lit rose-amber → shade deep violet — a HUE shift along the warm axis,
    // saturation held (forest Wave 0c law), nothing collapses to grey.
    nebulaLit: 0xe89a64,
    nebulaShade: 0x54428f,
    nebulaCore: 0xffb340, // darkness-gated interior ember (howl044's falling star)
    nebulaEdge: 0xf4c9c2, // pale drawn edge
    // Planet: three value bands, warm→cool, plus the thin terminator amber.
    planetLit: 0xf2d9a8,
    planetMid: 0xc97d6e,
    planetShade: 0x2c3a6e,
    planetTerminator: 0xffa04e,
    planetRim: 0x9fd8ff,
    halo: 0x6fb5e8,
    // Backdrop bands, far→near value order; floor = the Act I black-lift family scaled
    // for the overshooting playground.
    voidFloor: 0x0a0e1f,
    bandDeep: 0x1a2350,
    bandTeal: 0x1f4f66,
    bandRose: 0x8f4a6e,
};

function makeNebulaMaterial(uniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    const ao = attribute('color', 'vec3').x; // sculptor: r = analytic SDF AO
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = uniforms.uSunDir;

    // Wrap diffuse, quantised to TWO bands with an ~8% soft threshold. The ramp's lit end
    // runs past 1 (over-extended-ramp law) so the lit field never saturates flat white.
    const wrap = float(0.72);
    const d = dot(N, L).add(wrap).div(wrap.add(1));
    const band = smoothstep(0.40, 0.52, d);
    const litRamp = mix(color(PALETTE.nebulaLit), color(PALETTE.nebulaLit).mul(1.35), d.mul(0.55));
    const base = mix(color(PALETTE.nebulaShade), litRamp, band);

    // Darkness-gated interior: the SDF crevices (low AO) are where ambient is absent, so
    // that is where the ember lives — Laputa's Levistone rule, not additive glow everywhere.
    const crevice = smoothstep(0.72, 0.18, ao);
    const interior = color(PALETTE.nebulaCore).mul(crevice.mul(crevice).mul(0.85));

    // Drawn edge + fake-Mie lining. Mie sign per the cloud-field plan: fires when the view
    // OPPOSES the sun (dot(V,L) → −1), i.e. the mass is backlit.
    const fresnel = clamp(float(1).sub(dot(N, V)), 0, 1);
    const edge = color(PALETTE.nebulaEdge).mul(fresnel.pow(2.5).mul(0.6));
    const mie = clamp(dot(V, L).add(0.9).mul(-10), 0, 1).pow(4);
    const lining = color(PALETTE.nebulaCore).mul(mie.mul(0.9));

    material.colorNode = base.add(interior).add(edge).add(lining);
    return material;
}

function makePlanetMaterial(uniforms) {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = uniforms.uSunDir;

    // Three-band terminator: two soft-quantised edges over raw N·L, band interiors FLAT.
    const d = dot(N, L);
    const litBand = smoothstep(0.28, 0.40, d);
    const midBand = smoothstep(-0.18, -0.06, d);
    const base = mix(
        color(PALETTE.planetShade),
        mix(color(PALETTE.planetMid), color(PALETTE.planetLit), litBand),
        midBand,
    );

    // The thin warm terminator band — the Ghibli sunset edge — lives where N·L crosses
    // the mid edge; width is authored, not physical.
    const terminator = smoothstep(-0.16, -0.04, d).mul(smoothstep(0.14, 0.02, d));
    const termGlow = color(PALETTE.planetTerminator).mul(terminator.mul(0.8));

    // Day-side atmosphere rim, cool against the warm lit band.
    const fresnel = clamp(float(1).sub(dot(N, V)), 0, 1);
    const rim = color(PALETTE.planetRim)
        .mul(fresnel.pow(3).mul(clamp(d.add(0.35), 0, 1)).mul(0.9));

    material.colorNode = base.add(termGlow).add(rim);
    return material;
}

function makeHaloMaterial(uniforms) {
    // The backside halo shell: additive fresnel falloff seen against the void — the cheap
    // half of the two-part analytic atmosphere (plan §3.1, no scattering integral).
    const material = new THREE.MeshBasicNodeMaterial({
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = uniforms.uSunDir;
    const rim = clamp(dot(N, V).negate(), 0, 1).pow(2.4);
    const sunSide = clamp(dot(N, L).mul(0.5).add(0.62), 0, 1);
    material.colorNode = color(PALETTE.halo);
    material.opacityNode = rim.mul(sunSide).mul(0.55);
    return material;
}

function makeBackdropMaterial() {
    const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    const dir = normalize(positionWorld);

    // Two octaves of noise POSTERIZED into bands — this is the look contract for the
    // Wave 2 cubemap bake (space-3d recipe restyled), not a shipping shader: at chapter
    // time this whole field is texels, so its ALU cost here is irrelevant.
    const n1 = mx_noise_float(dir.mul(2.3).add(vec3(7.1, 0.0, 3.7)));
    const n2 = mx_noise_float(dir.mul(5.1).add(vec3(1.3, 9.2, 5.5)));
    const field = n1.mul(0.72).add(n2.mul(0.28)).mul(0.5).add(0.5);

    // Three soft-quantised bands over the void floor; the floor is the black lift — the
    // void is never RGB-zero (Ghibli law), and depth reads as stacked hue bands, not fog.
    const deep = smoothstep(0.44, 0.50, field);
    const tealBand = smoothstep(0.58, 0.64, field);
    const roseBand = smoothstep(0.74, 0.80, field);
    const graded = mix(
        color(PALETTE.voidFloor),
        mix(
            color(PALETTE.bandDeep),
            mix(color(PALETTE.bandTeal), color(PALETTE.bandRose), roseBand),
            tealBand,
        ),
        deep,
    );

    // Star salt from the high-frequency octave — quantised sizes, no twinkle here (the
    // live near-field batch owns motion; baked stars hold still).
    const starNoise = mx_noise_float(dir.mul(120.0)).mul(0.5).add(0.5);
    const stars = smoothstep(0.86, 0.95, starNoise).mul(1.4);
    material.colorNode = graded.add(vec3(stars));
    return material;
}

export function create({ scene }) {
    const uniforms = {
        uTime: uniform(0),
        uSunDir: uniform(SUN_DIR.clone()),
    };

    const group = new THREE.Group();
    group.name = 'ch6-painted-cosmos-probe';

    // 1. The sculpted nebula mass — a cloud-field spec scaled to nebula proportions and
    // sculpted at NEAR detail by the shipped, test-covered sculptor. Zero new geometry code.
    const spec = {
        id: 'probe-nebula',
        role: 'framing',
        lod: 'near',
        x: 0,
        base: -120,
        z: 0,
        w: 520,
        h: 280,
        yaw: 0.7,
        seed: 33.7,
    };
    const { geometry, triangles } = buildCloudFieldGeometry([spec]);
    const nebula = new THREE.Mesh(geometry, makeNebulaMaterial(uniforms));
    nebula.name = 'probe-nebula-mass';
    group.add(nebula);

    // 2. The banded gas giant + halo shell, framed off to the right like the summit earth.
    const planetGeo = new THREE.SphereGeometry(84, 48, 32);
    const planet = new THREE.Mesh(planetGeo, makePlanetMaterial(uniforms));
    planet.name = 'probe-gas-giant';
    planet.position.set(340, 120, -260);
    group.add(planet);

    const haloGeo = new THREE.SphereGeometry(84 * 1.14, 48, 32);
    const halo = new THREE.Mesh(haloGeo, makeHaloMaterial(uniforms));
    halo.name = 'probe-planet-halo';
    halo.position.copy(planet.position);
    group.add(halo);

    // 3. The posterized backdrop swatch (the bake's look contract).
    const domeGeo = new THREE.SphereGeometry(2400, 48, 32);
    const dome = new THREE.Mesh(domeGeo, makeBackdropMaterial());
    dome.name = 'probe-backdrop';
    group.add(dome);

    scene.add(group);
    // eslint-disable-next-line no-console
    console.log(`[ch6-painted-cosmos] nebula mass: ${triangles} tris (near detail)`);

    return {
        cameraRadius: 700,
        update(time) {
            uniforms.uTime.value = time;
            // Rigid seeded Lissajous drift — the whole mass moves, its silhouette never
            // boils (motion law §3.5). Amplitude is a few units against a 520 u mass.
            nebula.position.set(
                Math.sin(time * 0.050) * 5.0,
                Math.sin(time * 0.037 + 1.7) * 3.0,
                Math.cos(time * 0.043 + 0.6) * 4.0,
            );
            planet.rotation.y = time * 0.02;
        },
        dispose() {
            scene.remove(group);
            [nebula, planet, halo, dome].forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
        },
    };
}
