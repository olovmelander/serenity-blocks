/**
 * The four Odyssey charms as small three.js (r186, WebGPU/TSL with the WebGL2 backend) icons:
 * Tide, a cresting wave; Still Air, a leaf drifting on nothing; Long Breath, an hourglass; Hearth,
 * an ember stone with its ring. Each icon stands on a thin ring in its own tone, which is also
 * its state light: dim while ready, lit while active or armed, grey once used.
 *
 * This module builds the scene only. The HUD tray (ui/odyssey/odyssey-charm-icon-stage.js)
 * and the playground effect (playground/effects/charm-icons.effect.js) own cameras, renderers
 * and the frame loop. Built for a 40 px chip and a 1.25-unit orthographic frame per icon: bold
 * silhouettes, no fine detail, under 2,000 triangles for all four.
 */
import * as THREE from 'three/webgpu';
import {
    abs, cameraPosition, clamp, color, dot, float, mix, normalWorld, normalize, positionLocal, positionWorld, pow, sin,
    smoothstep, uniform, vec3,
} from 'three/tsl';

export const ODYSSEY_CHARM_ICON_IDS = Object.freeze(['tide', 'still-air', 'long-breath', 'hearth']);

/** Each charm's tone (the keystone palette: aqua, lavender, gold, coral) and its deeper body colour. */
export const ODYSSEY_CHARM_ICON_TONES = Object.freeze({
    tide: Object.freeze({ tone: 0x9ee8ed, body: 0x1f7f93, glow: 0x7fe3ef }),
    'still-air': Object.freeze({ tone: 0xb8a4ff, body: 0x6b58c9, glow: 0xcdbfff }),
    'long-breath': Object.freeze({ tone: 0xf3d28d, body: 0xb8862a, glow: 0xffe3a3 }),
    hearth: Object.freeze({ tone: 0xffac88, body: 0x3a2328, glow: 0xff7a3d }),
});

/** How each chip state lights its icon. */
const STATE_LOOK = Object.freeze({
    ready: Object.freeze({ glow: 1, dim: 0, ring: 0.42 }),
    active: Object.freeze({ glow: 1.35, dim: 0, ring: 1 }),
    armed: Object.freeze({ glow: 1.35, dim: 0, ring: 1 }),
    used: Object.freeze({ glow: 0.12, dim: 1, ring: 0.1 }),
    empty: Object.freeze({ glow: 0.12, dim: 1, ring: 0.1 }),
});

const GREY = vec3(0.46, 0.44, 0.52);

/**
 * A lit, rimmed material in a charm's tone. `uDim` greys it (used), `uGlow` scales the rim light.
 * @param {{ base: number, glow: number, uGlow: object, uDim: object, roughness?: number, metalness?: number,
 *   rim?: number, flat?: boolean }} options
 */
function iconMaterial({
    base, glow, uGlow, uDim, roughness = 0.45, metalness = 0.08, rim = 0.9, flat = false,
}) {
    const material = new THREE.MeshStandardNodeMaterial({ roughness, metalness });
    material.flatShading = flat;
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(clamp(float(1).sub(dot(N, V)), 0, 1), 2.4);
    material.colorNode = mix(color(base), GREY, uDim.mul(0.85));
    material.emissiveNode = color(glow).mul(fresnel.mul(rim).add(0.08)).mul(uGlow).mul(float(1).sub(uDim.mul(0.9)));
    return material;
}

/** A thin flat ring under an icon, lit by its state. */
function stateRing(tone, uRing, uDim) {
    const geometry = new THREE.TorusGeometry(0.92, 0.028, 10, 64);
    const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
    material.colorNode = mix(color(tone).mul(0.35), GREY.mul(0.6), uDim);
    material.emissiveNode = color(tone).mul(uRing.mul(1.6)).mul(float(1).sub(uDim.mul(0.85)));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = -0.82;
    return { mesh, dispose: () => { geometry.dispose(); material.dispose(); } };
}

function sphere(radius, material, detail = 12) {
    const geometry = new THREE.SphereGeometry(radius, detail, detail);
    return { mesh: new THREE.Mesh(geometry, material), geometry };
}

/** Tide: a wave curling over its own swell, three drops of spray rising from the crest. */
function buildTide(tones, uniforms) {
    const group = new THREE.Group();
    const { uGlow, uDim } = uniforms;
    const material = iconMaterial({
        base: tones.body, glow: tones.glow, uGlow, uDim, roughness: 0.32, metalness: 0.05, rim: 1.1,
    });
    // The crest: deeper teal at the foot, aqua where it curls.
    const water = mix(color(tones.body), color(tones.tone), smoothstep(-0.55, 0.75, positionLocal.y));
    material.colorNode = mix(water, GREY, uDim.mul(0.85));
    // A breaker: the face climbs from the left, the lip curls forward and down over the hollow.
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.15, -0.6, 0), new THREE.Vector3(-0.6, -0.46, 0.04), new THREE.Vector3(-0.08, -0.06, 0.02),
        new THREE.Vector3(0.26, 0.44, 0), new THREE.Vector3(0.5, 0.72, -0.02), new THREE.Vector3(0.8, 0.6, -0.04),
        new THREE.Vector3(0.86, 0.28, -0.03), new THREE.Vector3(0.64, 0.1, 0),
    ]);
    const crestGeometry = new THREE.TubeGeometry(curve, 64, 0.2, 14, false);
    const crest = new THREE.Mesh(crestGeometry, material);
    const swellGeometry = new THREE.SphereGeometry(0.72, 24, 16);
    const swell = new THREE.Mesh(swellGeometry, material);
    swell.scale.set(1.6, 0.3, 0.72);
    swell.position.set(-0.12, -0.64, 0);
    group.add(crest, swell);
    const sprayMaterial = iconMaterial({
        base: tones.tone, glow: tones.glow, uGlow, uDim, roughness: 0.25, rim: 1.4,
    });
    const drops = [0, 1, 2].map((index) => {
        const drop = sphere(0.075 - index * 0.012, sprayMaterial, 10);
        group.add(drop.mesh);
        return { ...drop, index };
    });
    return {
        group,
        update(time) {
            group.position.y = Math.sin(time * 1.4) * 0.05;
            group.rotation.z = Math.sin(time * 0.9) * 0.04;
            drops.forEach(({ mesh, index }) => {
                const phase = time * 1.1 + index * 2.1;
                const rise = ((phase % 1) + 1) % 1;
                mesh.position.set(0.92 - index * 0.17 + Math.sin(phase * 2.3) * 0.06, 0.5 + rise * 0.5, 0.12 - index * 0.06);
                mesh.scale.setScalar(1 - rise * 0.6);
            });
        },
        dispose() {
            crestGeometry.dispose();
            swellGeometry.dispose();
            drops.forEach((drop) => drop.geometry.dispose());
            material.dispose();
            sprayMaterial.dispose();
        },
    };
}

/** Still Air: a leaf resting on nothing, rocking as if it had all the time in the world, two motes drifting round it. */
function buildStillAir(tones, uniforms) {
    const group = new THREE.Group();
    const { uGlow, uDim } = uniforms;
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.0);
    shape.bezierCurveTo(0.62, 0.58, 0.66, -0.42, 0, -1.0);
    shape.bezierCurveTo(-0.66, -0.42, -0.62, 0.58, 0, 1.0);
    const leafGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 18,
    });
    leafGeometry.center();
    const material = iconMaterial({
        base: tones.body, glow: tones.glow, uGlow, uDim, roughness: 0.5, metalness: 0.02, rim: 1.0,
    });
    // A pale midrib, and the blade lighter toward its edges.
    const rib = smoothstep(0.07, 0.0, abs(positionLocal.x));
    const edge = smoothstep(0.1, 0.62, abs(positionLocal.x));
    const blade = mix(color(tones.body), color(tones.tone), edge.mul(0.55).add(rib.mul(0.8)));
    material.colorNode = mix(blade, GREY, uDim.mul(0.85));
    // The blade curls up at its edges.
    material.positionNode = positionLocal.add(vec3(0, 0, positionLocal.x.mul(positionLocal.x).mul(0.32)));
    const leaf = new THREE.Mesh(leafGeometry, material);
    // Seen a little from above, the blade turned toward the eye.
    leaf.rotation.x = -0.55;
    leaf.rotation.z = 0.35;
    leaf.position.y = 0.1;
    const stemGeometry = new THREE.CylinderGeometry(0.035, 0.05, 0.5, 8);
    const stem = new THREE.Mesh(stemGeometry, material);
    stem.position.set(0.3, -0.72, 0.1);
    stem.rotation.z = -0.9;
    group.add(leaf, stem);
    const moteMaterial = iconMaterial({
        base: tones.tone, glow: tones.glow, uGlow, uDim, roughness: 0.3, rim: 1.4,
    });
    const motes = [0, 1].map((index) => {
        const mote = sphere(0.06, moteMaterial, 10);
        group.add(mote.mesh);
        return { ...mote, index };
    });
    return {
        group,
        update(time) {
            group.rotation.z = Math.sin(time * 0.8) * 0.3;
            group.rotation.y = Math.sin(time * 0.45) * 0.45;
            group.position.y = Math.sin(time * 0.6) * 0.07 + 0.05;
            motes.forEach(({ mesh, index }) => {
                const a = time * 0.5 + index * Math.PI;
                mesh.position.set(Math.cos(a) * 0.95, Math.sin(a * 1.7) * 0.28 + 0.1, Math.sin(a) * 0.55);
            });
        },
        dispose() {
            leafGeometry.dispose();
            stemGeometry.dispose();
            motes.forEach((mote) => mote.geometry.dispose());
            material.dispose();
            moteMaterial.dispose();
        },
    };
}

/** Long Breath: an hourglass of pale gold glass on bronze caps, a thread of sand falling between the bulbs. */
function buildLongBreath(tones, uniforms) {
    const group = new THREE.Group();
    const { uGlow, uDim, uPulse } = uniforms;
    const glass = iconMaterial({
        base: tones.tone, glow: tones.glow, uGlow, uDim, roughness: 0.18, metalness: 0.0, rim: 1.3,
    });
    glass.transparent = true;
    glass.opacity = 0.62;
    glass.depthWrite = false;
    const bronze = iconMaterial({
        base: 0x6b4a2a, glow: tones.glow, uGlow, uDim, roughness: 0.5, metalness: 0.55, rim: 0.4,
    });
    const sand = iconMaterial({
        base: tones.body, glow: tones.glow, uGlow, uDim, roughness: 0.7, metalness: 0.1, rim: 0.3,
    });
    sand.emissiveNode = color(tones.glow).mul(uPulse.mul(0.35).add(0.15)).mul(uGlow).mul(float(1).sub(uDim.mul(0.9)));
    const bulbGeometry = new THREE.ConeGeometry(0.58, 0.78, 28, 1, true);
    const top = new THREE.Mesh(bulbGeometry, glass);
    top.rotation.x = Math.PI;
    top.position.y = 0.42;
    const bottom = new THREE.Mesh(bulbGeometry, glass);
    bottom.position.y = -0.42;
    const capGeometry = new THREE.CylinderGeometry(0.66, 0.66, 0.09, 28);
    const capTop = new THREE.Mesh(capGeometry, bronze);
    capTop.position.y = 0.84;
    const capBottom = new THREE.Mesh(capGeometry, bronze);
    capBottom.position.y = -0.84;
    const pillarGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.68, 8);
    const pillars = [0, 1, 2].map((index) => {
        const pillar = new THREE.Mesh(pillarGeometry, bronze);
        const angle = (index / 3) * Math.PI * 2 + 0.4;
        pillar.position.set(Math.cos(angle) * 0.6, 0, Math.sin(angle) * 0.6);
        return pillar;
    });
    const pileGeometry = new THREE.ConeGeometry(0.34, 0.26, 24);
    const pile = new THREE.Mesh(pileGeometry, sand);
    pile.position.y = -0.68;
    const topSandGeometry = new THREE.CylinderGeometry(0.3, 0.42, 0.14, 24);
    const topSand = new THREE.Mesh(topSandGeometry, sand);
    topSand.position.y = 0.62;
    const threadGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.74, 6);
    const thread = new THREE.Mesh(threadGeometry, sand);
    thread.position.y = -0.3;
    group.add(top, bottom, capTop, capBottom, ...pillars, pile, topSand, thread);
    return {
        group,
        update(time) {
            group.rotation.y = time * 0.55;
            group.rotation.z = Math.sin(time * 0.7) * 0.05;
            thread.scale.y = 0.92 + Math.sin(time * 11) * 0.08;
        },
        dispose() {
            [bulbGeometry, capGeometry, pillarGeometry, pileGeometry, topSandGeometry, threadGeometry]
                .forEach((geometry) => geometry.dispose());
            glass.dispose();
            bronze.dispose();
            sand.dispose();
        },
    };
}

/** Hearth: a faceted ember stone, lit from within along its cracks, three sparks rising. */
function buildHearth(tones, uniforms) {
    const group = new THREE.Group();
    const { uGlow, uDim, uPulse } = uniforms;
    const stone = iconMaterial({
        base: tones.body, glow: tones.glow, uGlow, uDim, roughness: 0.78, metalness: 0.05, rim: 0.35, flat: true,
    });
    // Cracks: the zero crossings of two warped sine fields make a net of thin lines, lit from
    // within and breathing with the pulse.
    const p = positionLocal.mul(5.2);
    const fieldA = sin(p.x.mul(1.6).add(sin(p.y.mul(2.1).add(p.z.mul(0.8)))));
    const fieldB = sin(p.y.mul(1.4).add(sin(p.z.mul(1.7).add(p.x.mul(0.9)))));
    const cracks = smoothstep(0.16, 0.0, abs(fieldA).min(abs(fieldB)));
    stone.emissiveNode = color(tones.glow).mul(cracks.mul(uPulse.mul(0.9).add(0.5)).add(0.03)).mul(uGlow)
        .mul(float(1).sub(uDim.mul(0.92)));
    const stoneGeometry = new THREE.IcosahedronGeometry(0.72, 1);
    const rock = new THREE.Mesh(stoneGeometry, stone);
    rock.position.y = -0.08;
    group.add(rock);
    const sparkMaterial = iconMaterial({
        base: tones.glow, glow: tones.glow, uGlow, uDim, roughness: 0.3, rim: 2.0,
    });
    const sparks = [0, 1, 2].map((index) => {
        const spark = sphere(0.055, sparkMaterial, 8);
        group.add(spark.mesh);
        return { ...spark, index };
    });
    return {
        group,
        update(time) {
            rock.rotation.y = time * 0.35;
            rock.rotation.x = Math.sin(time * 0.5) * 0.12;
            sparks.forEach(({ mesh, index }) => {
                const phase = (((time * 0.42 + index * 0.33) % 1) + 1) % 1;
                mesh.position.set(
                    Math.sin(phase * 6.0 + index) * 0.28 * (1 - phase * 0.4),
                    -0.1 + phase * 1.35,
                    Math.cos(phase * 5.0 + index * 2) * 0.22,
                );
                mesh.scale.setScalar(1.1 - phase * 0.9);
            });
        },
        dispose() {
            stoneGeometry.dispose();
            sparks.forEach((spark) => spark.geometry.dispose());
            stone.dispose();
            sparkMaterial.dispose();
        },
    };
}

const BUILDERS = Object.freeze({
    tide: buildTide, 'still-air': buildStillAir, 'long-breath': buildLongBreath, hearth: buildHearth,
});

/**
 * One charm icon: its group (centred, about 2 units tall, standing on its ring at y = -0.82),
 * its state uniforms, and an update on a clock in seconds.
 * @param {string} id a charm id
 */
export function createOdysseyCharmIcon(id) {
    const tones = ODYSSEY_CHARM_ICON_TONES[id];
    const build = BUILDERS[id];
    if (!tones || !build) return null;
    const uniforms = {
        uGlow: uniform(1), uDim: uniform(0), uRing: uniform(STATE_LOOK.ready.ring), uPulse: uniform(0.5),
    };
    const icon = build(tones, uniforms);
    const ring = stateRing(tones.tone, uniforms.uRing, uniforms.uDim);
    // The ring stays level under the icon while the icon itself rocks and turns.
    const group = new THREE.Group();
    group.add(icon.group, ring.mesh);
    let state = 'ready';
    return {
        id,
        group,
        getState: () => state,
        /** @param {'ready'|'active'|'armed'|'used'|'empty'} next */
        setState(next) {
            const look = STATE_LOOK[next] || STATE_LOOK.ready;
            state = STATE_LOOK[next] ? next : 'ready';
            uniforms.uGlow.value = look.glow;
            uniforms.uDim.value = look.dim;
            uniforms.uRing.value = look.ring;
        },
        update(time) {
            icon.update(time);
            const breathing = state === 'armed' || state === 'active';
            uniforms.uPulse.value = 0.5 + Math.sin(time * (breathing ? 3.2 : 1.6)) * 0.5;
            if (breathing) {
                const look = STATE_LOOK[state];
                uniforms.uRing.value = look.ring * (0.8 + uniforms.uPulse.value * 0.35);
            }
        },
        dispose() {
            icon.dispose();
            ring.dispose();
        },
    };
}

/** The lights every icon scene shares: a warm key from the upper left and a lavender sky over indigo ground. */
export function createOdysseyCharmIconLights() {
    const key = new THREE.DirectionalLight(0xfff1dc, 2.6);
    key.position.set(2.5, 4.5, 4);
    const fill = new THREE.HemisphereLight(0xcfc4ff, 0x2a2140, 1.15);
    return {
        lights: [key, fill],
        dispose() {
            key.dispose();
            fill.dispose();
        },
    };
}

/** The frame one icon fills in an orthographic camera: half the width, in scene units. */
export const ODYSSEY_CHARM_ICON_HALF_EXTENT = 1.22;

/** An orthographic camera that frames one icon, looking a little down at it. */
export function createOdysseyCharmIconCamera(aspect = 1) {
    const h = ODYSSEY_CHARM_ICON_HALF_EXTENT;
    const camera = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, 30);
    camera.position.set(0, 1.35, 7);
    camera.lookAt(0, -0.12, 0);
    return camera;
}
