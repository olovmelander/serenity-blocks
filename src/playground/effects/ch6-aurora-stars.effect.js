/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * CH6 WAVE 5 PROBE — the auroral crown + the quantised stellar ramp.
 *
 * docs/ODYSSEY_CH6_SPACE_OVERHAUL_PLAN_2026-08.md §5 Wave 5, the two items the wave
 * never built (the comet and the dive-streak stretch shipped in 98704055).
 *
 * THIS PROBE IMPORTS THE SHIPPING MODULES RATHER THAN RE-TYPING THEM. `createHeroPlanet-
 * SurfaceTSL` is the chapter's own gas giant, `createPlanetAuroraCrown` is the mesh that
 * will hang off the hero group, and the star swatch draws its colours from
 * STELLAR_CLASSES. So a clean screenshot here is evidence about the code that ships, not
 * about a lookalike — which is the whole reason the Wave 3 sculptor was re-used verbatim.
 *
 * FRAMING. The camera sits BELOW the equator on purpose. The world sun's +y component
 * lights the north cap, so the south oval is the one currently alight; a level camera
 * would put it on the bottom limb, half-hidden. `?orbit=0` holds this framing; the
 * default orbit is still available for judging the crown from other angles.
 *
 * The star swatch is a flat grid of the six classes at their authored size/emissive
 * gains, parked off to the left, so the ramp can be judged as a ladder rather than
 * hunted for inside a random field.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, length, oneMinus, pow, uniform, uv,
} from 'three/tsl';
import {
    billboardWorld, makeQuadInstancedGeometry,
} from '../../rendering/odyssey/chapter-environments/shared/odyssey-tsl-billboard.js';
import { createHeroPlanetSurfaceTSL } from '../../rendering/odyssey/chapter-environments/cosmic-expanse.tsl.js';
import {
    AURORA_OVAL, createPlanetAuroraCrown,
} from '../../rendering/odyssey/chapter-environments/odyssey-planet-aurora.js';
import {
    STELLAR_CLASSES, pickStellarClass,
} from '../../rendering/odyssey/chapter-environments/odyssey-stellar-ramp.js';
import { createCosmicExpanseEnvironment } from '../../rendering/odyssey/chapter-environments/cosmic-expanse.js';

export const meta = {
    id: 'ch6-aurora-stars',
    title: 'Ch6 Wave 5 (aurora crown + stellar ramp)',
    description: 'Polar auroral ovals on the gas giant, and the quantised blackbody star ladder',
};

const PLANET_RADIUS = 28;

/**
 * A minimal stand-in for the chapter's instanced star billboards — same quad-instancing
 * idea, same core/halo/spike mask family, but built here so the probe has no dependency
 * on cosmic-expanse.js's private helpers. What is under test is the RAMP (colour,
 * emissive push, sizeGain, coreGain), and those all arrive through the attributes.
 */
function buildStarSwatch(rows, spacing) {
    const perClass = rows;
    const count = STELLAR_CLASSES.length * perClass;
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const cores = new Float32Array(count);

    // The LADDER: one column per class, so the six steps can be compared side by side.
    let i = 0;
    STELLAR_CLASSES.forEach((cls, column) => {
        for (let row = 0; row < perClass; row += 1) {
            bases[i * 3] = (column - (STELLAR_CLASSES.length - 1) / 2) * spacing;
            bases[i * 3 + 1] = (row - (perClass - 1) / 2) * spacing;
            bases[i * 3 + 2] = 0;
            // Size varies within a column only through the same squared-random
            // distribution the chapter uses, scaled by the class gain.
            const jitter = 0.55 + (row / Math.max(1, perClass - 1)) * 0.9;
            sizes[i] = 2.2 * cls.sizeGain * jitter;
            colors[i * 3] = cls.color[0] * cls.emissive;
            colors[i * 3 + 1] = cls.color[1] * cls.emissive;
            colors[i * 3 + 2] = cls.color[2] * cls.emissive;
            cores[i] = cls.coreGain;
            i += 1;
        }
    });
    return {
        count, bases, sizes, colors, cores,
    };
}

/**
 * The same field the chapter draws, at probe scale: seeded picks off the weighted ladder,
 * so the SHAPE of the distribution (mostly white/blue-white, warm accents rare) is
 * visible as a field rather than as a table of weights.
 */
function buildStarField(count, radius) {
    let s = 20260816;
    const rng = () => {
        s = Math.imul(s ^ (s >>> 15), 2246822519);
        s = (s + 0x6d2b79f5) >>> 0;
        return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
    };
    const bases = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const cores = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = radius * (0.85 + rng() * 0.3);
        bases[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        bases[i * 3 + 1] = r * Math.cos(phi);
        bases[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        const cls = pickStellarClass(rng);
        const t = rng();
        sizes[i] = (0.9 + t * t * 2.6) * cls.sizeGain;
        colors[i * 3] = cls.color[0] * cls.emissive;
        colors[i * 3 + 1] = cls.color[1] * cls.emissive;
        colors[i * 3 + 2] = cls.color[2] * cls.emissive;
        cores[i] = cls.coreGain;
    }
    return {
        count, bases, sizes, colors, cores,
    };
}

function makeStarMesh(data, name) {
    const {
        count, bases, sizes, colors, cores,
    } = data;
    // The chapter's own instancing + billboard helpers (THREE.Points renders 1px on
    // WebGPU), so the probe's stars are drawn by the same primitive the chapter uses.
    const geometry = makeQuadInstancedGeometry(count, {
        aBase: { array: bases, itemSize: 3 },
        aSize: { array: sizes, itemSize: 1 },
        aColor: { array: colors, itemSize: 3 },
        aCore: { array: cores, itemSize: 1 },
    });

    const aBase = attribute('aBase', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aColor = attribute('aColor', 'vec3');
    const aCore = attribute('aCore', 'float');

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = billboardWorld(aBase, aSize);
    material.colorNode = aColor;

    const p = uv().sub(0.5);
    const fall = oneMinus(length(p).mul(2.0)).max(0.0);
    // coreGain rides the EXPONENT: a high gain is a tighter, harder pinpoint, a low gain
    // a soft one. That is what separates a big dim M giant from a near blue-white.
    const core = pow(fall, aCore.mul(2.6)).mul(1.15);
    const halo = pow(fall, 1.2).mul(0.14);
    const spikes = pow(oneMinus(p.x.abs().mul(14.0)).max(0.0), 3.0)
        .add(pow(oneMinus(p.y.abs().mul(14.0)).max(0.0), 3.0))
        .mul(fall.mul(fall))
        .mul(0.5);
    material.opacityNode = core.add(halo).add(spikes.mul(aCore));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
}

export function create({ scene, params }) {
    const uTime = uniform(0);
    const group = new THREE.Group();
    group.name = 'ch6-wave5-probe';

    // 1. THE HERO, chapter code — and it now carries the aurora's DISC half inside its
    //    own surface graph, so this probe shows both halves exactly as they ship.
    const planet = createHeroPlanetSurfaceTSL(uTime);
    group.add(planet.mesh);

    // 2. THE CROWN — the standing half, the mesh exactly as the chapter builds it.
    const crown = createPlanetAuroraCrown(PLANET_RADIUS, uTime);
    group.add(crown);

    // 3. THE LADDER, parked to the left of the hero and facing the default framing.
    const swatch = makeStarMesh(buildStarSwatch(4, 9), 'stellar-ladder');
    swatch.position.set(96, -34, 52);
    group.add(swatch);

    // 4. THE FIELD, as a shell around everything — the distribution read.
    const field = makeStarMesh(buildStarField(520, 300), 'stellar-field');
    group.add(field);

    // 5. THE REAL near tier, lifted straight out of the chapter and re-seated here. The
    //    swatch and field above are probe-local rebuilds that share only the ramp DATA,
    //    so they cannot prove the shipped graph compiles — and the port moved coreGain
    //    into aColor.w, which is exactly the kind of change that only fails at WGSL
    //    build time. Mounting the chapter's own mesh is the cheap way to find out.
    const chapter = createCosmicExpanseEnvironment({ particleCount: 200 });
    const shipped = chapter.userData.starsNear;
    shipped.removeFromParent();
    shipped.scale.setScalar(0.42);
    group.add(shipped);
    // Everything else the chapter built is dead weight here — release it rather than
    // leaving a whole environment pinned behind one borrowed mesh.
    chapter.traverse((child) => {
        if (child === shipped) return;
        child.geometry?.dispose?.();
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => m?.dispose?.());
    });

    scene.add(group);

    const tris = crown.geometry.index.count / 3;
    // eslint-disable-next-line no-console
    console.log(`[ch6-aurora-stars] crown: ${tris} tris, 1 draw; rings=${AURORA_OVAL.rings.length} x 2 poles`);

    const orbiting = params?.get('orbit') !== '0';

    return {
        cameraRadius: 120,
        update(time) {
            uTime.value = time;
            // The hero spins about its pole exactly as update() spins it in-chapter, so
            // the crown's spin-invariance claim is under test here, not assumed.
            group.rotation.y = time * 0.025;
        },
        camera: orbiting ? undefined : (time, cam) => {
            // Below the equator and slightly to the sunward side: the framing that shows
            // the lit north cap dark and the south oval alight, with the crown arcing
            // past the limb into empty sky.
            cam.position.set(52, -46, 104);
            cam.lookAt(6, -12, 0);
        },
        dispose() {
            scene.remove(group);
            planet.geometry.dispose();
            planet.material.dispose();
            [crown, swatch, field, shipped].forEach((m) => {
                m.geometry.dispose();
                m.material.dispose();
            });
        },
    };
}
