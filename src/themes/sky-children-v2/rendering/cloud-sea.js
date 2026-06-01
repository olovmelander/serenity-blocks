/* eslint-disable import/no-unresolved */
/**
 * Sky Children V2 AAA — The Cloud Sea (HERO)
 *
 * The signature subject of this art direction: a sea of clouds pooling in the
 * golden-hour valley, with billowing tops catching the low sun. Two analytic
 * layers — no per-pixel raymarch, so it stays on a background frame budget:
 *
 *   Layer A — the deck: a large displaced plane whose vertices ride FBM+Worley
 *             noise (cauliflower billows), shaded as a thin cloud volume.
 *   Layer B — hero puffs: a few drifting low-poly cloud clusters above the deck
 *             for parallax + silhouette interest.
 *
 * Shading (shared by both layers, per docs/SKY_CHILDREN_V2_AAA_PLAN.md §3.1):
 *   - Beer's-law absorption + powder effect for the lit/shadow split
 *   - Henyey-Greenstein forward scatter → the backlit "silver lining" toward the sun
 *   - lit = warm gold, shadow = COOL VIOLET (never grey — look-bible anchor #1)
 *   - Fresnel rim on billow edges (anchor #3)
 *   - aerial perspective toward the SHARED uFogColor (== sky horizon) with distance
 *
 * Reads the orchestrator's shared uniform block (u.uTime/uGust/uSunDir/uSunColor/
 * uShadowTint/uRimColor/uFogColor/uCameraPos), so it warms/cools with the
 * MoodDirector for free. Replaces the old sphere-puff clouds.
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    clamp,
    dot,
    exp,
    float,
    length,
    max,
    mix,
    normalize,
    normalLocal,
    normalWorld,
    positionLocal,
    positionWorld,
    pow,
    smoothstep,
    uv,
    varying,
    vec2,
    vec3,
} from 'three/tsl';
import {
    fbm2, worley2, valueNoise2,
} from '../sky-children-noise.js';
import { wrappedDiffuse, fresnelRim, glitter } from '../sky-children-lighting.js';

// ── Deck world layout. Plane lies in XZ (Y up), baked at world position via
// geometry rotate+translate so positionLocal.xz == world XZ (the himalayan gotcha). ──
const DECK_W = 2800;
const DECK_D = 1300; // broad cloud sea covering fore→far ground...
const DECK_Y = 8; // ...pooling LOW so green hilltops emerge as an archipelago of
const DECK_Z = -440; // grass islands poking up through the clouds (Sky-COTL look)
const DECK_AMP = 38; // increased billow amplitude for 3D volumetric puffiness
const NOISE_SCALE = 0.0052; // higher frequency for smaller, tighter cloud cells
const NORMAL_EPS = 3.0; // tighter normal epsilon for high-detail displacement normal computation

// Henyey-Greenstein phase (g baked as JS constants → cheap; guarded against the
// pow-of-negative NaN hazard via max()).
function hgPhase(mu, g) {
    const g2 = g * g;
    const denom = float(1 + g2).sub(float(2 * g).mul(mu));
    return float((1 - g2) * 0.0795775).div(pow(max(denom, float(0.0015)), float(1.5)));
}

// Billow field — rolling FBM + inverted Worley cauliflower, domain-warped and
// drifted by time*gust. Returns roughly [0, ~1.2]. Used for both displacement
// (×amp) and the shading density.
const cloudField = /* @__PURE__ */ Fn(([pInput, tInput]) => {
    const t = float(tInput);
    const p = vec2(pInput).mul(NOISE_SCALE)
        .add(vec2(t.mul(0.006), t.mul(0.0032))).toVar();
    const warp = vec2(
        valueNoise2(p.add(vec2(11.2, 3.7))),
        valueNoise2(p.add(vec2(5.1, 9.3))),
    ).sub(0.5).mul(0.7);
    const f = fbm2(p.add(warp)).toVar();
    const w = worley2(p.mul(1.7).add(warp)).toVar();
    const billow = f.mul(0.7).add(clamp(float(1.0).sub(w), float(0.0), float(1.0)).mul(0.45));
    return clamp(billow, float(0.0), float(1.2));
});

/**
 * Shared cloud shading. Plain JS (inlines nodes — NOT an Fn, which can't compile
 * a JS struct). Returns { color, emissive, alpha } nodes.
 *
 * @param u       shared uniform block
 * @param N       world-space normal node
 * @param worldP  world position node
 * @param density density node [0..~1.2]
 */
function cloudShade(u, N, worldP, density) {
    const sunDir = normalize(u.uSunDir).toVar();
    const viewDir = normalize(u.uCameraPos.sub(worldP)).toVar();

    // Wrapped diffuse — a bit less wrap so billow faces keep lit/shadow CONTRAST
    // (puffy form), rather than reading as one flat blown-white sheet.
    const wrapped = wrappedDiffuse(N, sunDir, 0.42).toVar();

    // Beer's law (thin = bright transmit) + powder (dark thin edges where scatter cancels).
    const beer = exp(density.mul(-1.5)).toVar();
    const powder = float(1.0).sub(exp(density.mul(-2.4))).toVar();
    const litAmount = clamp(wrapped.mul(powder).add(beer.mul(0.22)), float(0.0), float(1.0)).toVar();

    // Body: soft cool blue-grey shadow → bright warm-white lit. Bright white puffy
    // clouds (Sky-COTL reference) while keeping a colored (not black) shadow side.
    const shadowCol = u.uShadowTint.mul(0.62).add(vec3(0.16, 0.20, 0.30)); // deeper, bluer cloud shadow → form
    const litCol = u.uSunColor.mul(0.70).add(vec3(0.05, 0.05, 0.06)); // softer white, not blown
    const bodyBase = mix(shadowCol, litCol, litAmount);

    // Henyey-Greenstein silver lining: glow on edges between viewer and sun.
    const mu = dot(viewDir.negate(), sunDir);
    const silver = u.uSunColor.mul(clamp(hgPhase(mu, 0.62), float(0.0), float(2.2)))
        .mul(beer).mul(0.3).toVar();

    // Fresnel rim on billow edges (depth-scaled separation, anchor #3).
    const rim = u.uRimColor.mul(fresnelRim(N, viewDir, 2.4, 1.0))
        .mul(litAmount.mul(0.6).add(0.4)).mul(0.45).toVar();

    // Selective STABLE glitter on sunlit billow tops — sun glinting off ice/foam
    // (anchor #5). Static hash → no strobe; threshold lifts on combos via uSparkle.
    const threshold = mix(float(0.975), float(0.91), u.uSparkle);
    const glints = glitter(worldP, N, sunDir, viewDir, threshold, 1.6)
        .mul(litAmount).mul(clamp(N.y, float(0.0), float(1.0)));
    const glintCol = vec3(1.0, 0.95, 0.85).mul(glints).toVar();

    // Functional sum — NO reassignment (.addAssign needs an active Fn stack).
    const body = bodyBase.add(silver).add(rim).add(glintCol);

    // Aerial perspective toward the shared fog/sky-horizon color.
    const dist = length(u.uCameraPos.sub(worldP));
    const fog = clamp(float(1.0).sub(exp(dist.mul(-0.0011))), float(0.0), float(1.0)).toVar();
    const color = mix(body, u.uFogColor, fog.mul(0.92));

    // Silver lining + rim + glints bloom (reduced by haze).
    const emissive = silver.add(rim).add(glintCol).mul(float(1.0).sub(fog.mul(0.7)));

    return { color, emissive, litAmount };
}

function createDeck(u, segments) {
    const segX = Math.max(48, segments);
    const segZ = Math.max(32, Math.floor(segments * (DECK_D / DECK_W)));
    const geometry = new THREE.PlaneGeometry(DECK_W, DECK_D, segX, segZ);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, DECK_Y, DECK_Z); // positionLocal.xz == world XZ

    const deckNormal = varying(
        Fn(() => {
            const p = vec2(positionLocal.x, positionLocal.z).toVar();
            const e = float(NORMAL_EPS);
            const hC = cloudField(p, u.uTime).mul(DECK_AMP);
            const hX = cloudField(p.add(vec2(NORMAL_EPS, 0.0)), u.uTime).mul(DECK_AMP);
            const hZ = cloudField(p.add(vec2(0.0, NORMAL_EPS)), u.uTime).mul(DECK_AMP);
            return normalize(vec3(hC.sub(hX), e, hC.sub(hZ)));
        })(),
        'vDeckNormal',
    );

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
    });
    material.positionNode = Fn(() => {
        const p = vec2(positionLocal.x, positionLocal.z);
        const h = cloudField(p, u.uTime).mul(DECK_AMP);
        return vec3(positionLocal.x, positionLocal.y.add(h), positionLocal.z);
    })();

    const shadeDeck = () => {
        const density = cloudField(positionWorld.xz, u.uTime);
        return cloudShade(u, normalize(deckNormal), positionWorld, density);
    };

    material.colorNode = Fn(() => shadeDeck().color)();
    material.emissiveNode = Fn(() => shadeDeck().emissive)();
    material.userData.emitsBloom = true;

    // Edge fade (kill the rectangular boundary) × density-driven wispy fringes.
    material.opacityNode = Fn(() => {
        const q = uv();
        const edge = smoothstep(float(0.0), float(0.14), q.x)
            .mul(smoothstep(float(1.0), float(0.86), q.x))
            .mul(smoothstep(float(0.0), float(0.14), q.y))
            .mul(smoothstep(float(1.0), float(0.86), q.y));
        const density = cloudField(positionWorld.xz, u.uTime);
        const body = float(0.5).add(smoothstep(float(0.05), float(0.42), density).mul(0.5));
        return edge.mul(body);
    })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1; // after opaque terrain/mountains, before hero puffs
    return { mesh, geometry, material };
}

function createPuffMaterial(u) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
    });

    // Pseudo-3D billow displacement along the local normal.
    material.positionNode = Fn(() => {
        const lp = positionLocal.toVar();
        const n = fbm2(lp.xz.mul(0.55).add(lp.y.mul(0.4)));
        return lp.add(normalLocal.mul(n.mul(0.42)));
    })();

    const shadePuff = () => {
        const n = fbm2(positionLocal.xz.mul(0.55).add(positionLocal.y.mul(0.4)));
        const density = clamp(float(0.4).add(n.mul(0.6)), float(0.0), float(1.0));
        return cloudShade(u, normalize(normalWorld), positionWorld, density);
    };

    material.colorNode = Fn(() => shadePuff().color)();
    material.emissiveNode = Fn(() => shadePuff().emissive)();
    material.userData.emitsBloom = true;

    // Soft round silhouette: fade alpha toward grazing angle.
    material.opacityNode = Fn(() => {
        const viewDir = normalize(u.uCameraPos.sub(positionWorld));
        const facing = clamp(dot(normalize(normalWorld), viewDir), float(0.0), float(1.0));
        return pow(facing, float(0.7)).mul(0.8);
    })();

    return material;
}

/**
 * @param {object} u    shared uniform block from the orchestrator
 * @param {object} opts { deckSegments, clusterCount, puffsPerCluster }
 */
export function createCloudSea(u, opts = {}) {
    const group = new THREE.Group();
    const disposables = [];

    // Layer A — the deck. Disabled by default: a horizontal cloud-sea floor only
    // works from a high vantage; under the current low valley-meadow camera it
    // either streaks at eye level or carpets the foreground with lit facets. Re-
    // enable (opts.deck=true) once the P5 CameraDirector reframes to a high shot.
    if (opts.deck === true) {
        const deck = createDeck(u, opts.deckSegments ?? 120);
        group.add(deck.mesh);
        disposables.push(deck.geometry, deck.material);
    }

    // Layer B — drifting hero puffs (shared material).
    const puffMaterial = createPuffMaterial(u);
    disposables.push(puffMaterial);
    const puffGeometry = new THREE.SphereGeometry(1, 16, 12);
    disposables.push(puffGeometry);

    const clusters = [];
    const clusterCount = opts.clusterCount ?? 6;
    const basePuffs = opts.puffsPerCluster ?? 4;

    for (let i = 0; i < clusterCount; i += 1) {
        const cluster = new THREE.Group();
        const puffCount = basePuffs + Math.floor(Math.random() * 3);
        for (let j = 0; j < puffCount; j += 1) {
            const puff = new THREE.Mesh(puffGeometry, puffMaterial);
            const bx = (Math.random() - 0.5) * 5.2;
            const bz = (Math.random() - 0.5) * 4.4;
            puff.position.set(bx, (Math.random() - 0.5) * 0.7 - Math.abs(bx * 0.14), bz);
            const s = 2.4 + Math.random() * 3.0 - Math.abs(bx * 0.3);
            puff.scale.set(
                s * (1.1 + Math.random() * 0.3),
                s * (0.74 + Math.random() * 0.22),
                s * (1.1 + Math.random() * 0.3),
            );
            cluster.add(puff);
        }
        // A white cloud bank toward the horizon + sky (above the hills, maxHeight
        // ~90), pushed back so it reads as a Sky-COTL cloud sea, not ground litter.
        cluster.position.set(
            (Math.random() - 0.5) * 860,
            130 + Math.random() * 150,
            -560 + Math.random() * 360,
        );
        cluster.scale.setScalar(2.0 + Math.random() * 2.4);
        cluster.renderOrder = 2;
        cluster.userData = {
            driftSpeed: 0.34 + Math.random() * 1.0,
            driftSpan: 380 + Math.random() * 140,
            baseY: cluster.position.y,
            bobPhase: Math.random() * Math.PI * 2,
            bobAmp: 0.5 + Math.random() * 1.3,
        };
        group.add(cluster);
        clusters.push(cluster);
    }

    return {
        group,
        clusters,
        dispose() {
            disposables.forEach((d) => d?.dispose?.());
        },
    };
}
