/**
 * The four Odyssey charms as small three.js (r186, WebGPU/TSL with the WebGL2 backend) icons:
 * Tide, a cresting wave of liquid aqua chrome; Still Air, a leaf of brushed lavender metal under
 * a clear coat; Long Breath, an hourglass of glass on polished bronze; Hearth, a faceted obsidian
 * ember lit along its cracks. Each stands on a thin metal ring in its own tone, which is also its
 * state light: dim while ready, lit while active or armed, grey once used.
 *
 * Every surface reflects one small studio: a dark indigo room with a cool softbox overhead, a
 * warm key in front and to the left, a lavender rim behind and to the right, and a bright line
 * on the horizon. It is baked here as a tiny equirectangular map and sampled by hand on
 * MeshBasicNodeMaterial: a metal needs reflections more than it needs lights, and a basic
 * material compiles in a few milliseconds where a standard one with an environment takes tens,
 * and the tray appears mid-play. The studio turns slowly, so highlights glide across the metal
 * even while an icon rests.
 *
 * This module builds the scene only. The HUD tray (ui/odyssey/odyssey-charm-icon-stage.js)
 * and the playground effect (playground/effects/charm-icons.effect.js) own cameras, renderers
 * and the frame loop. Built for a 40 px tile and a 1.25-unit orthographic frame per icon: bold
 * silhouettes, no fine detail, under 2,000 triangles for all four.
 */
import * as THREE from 'three/webgpu';
import {
    abs, asin, atan, cameraPosition, clamp, color, cos, dot, faceDirection, float, mix, normalWorld, normalize,
    positionLocal, positionWorld, pow, reflect, sin, smoothstep, texture, uniform, vec2, vec3,
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
const TAU = Math.PI * 2;

// ---- The studio ---------------------------------------------------------------------------------

/** The equirectangular map's width (its height is half); eight mip levels blur it by roughness. */
export const ODYSSEY_CHARM_STUDIO_WIDTH = 256;
/** Radiance is stored as (rgb / range) ^ (1 / 2.2) in eight bits: the key panel reaches the range. */
export const ODYSSEY_CHARM_STUDIO_RANGE = 6;

/**
 * The studio's lights: softboxes by direction (azimuth from the camera's side, elevation) and
 * half-angles, and one band round the whole horizon. Radiance is linear, above one for the lights.
 */
export const ODYSSEY_CHARM_STUDIO_LIGHTS = Object.freeze([
    // A wide, cool softbox overhead.
    {
        az: 0, el: 74, w: 58, h: 30, rgb: [1.7, 1.65, 1.9],
    },
    // The warm key: upper left, in front.
    {
        az: -42, el: 22, w: 13, h: 19, rgb: [6, 5.3, 4.2],
    },
    // A lavender rim: right, behind.
    {
        az: 138, el: 14, w: 5, h: 26, rgb: [2.4, 2.2, 5],
    },
    // A bright line on the horizon, all the way round.
    {
        band: true, el: -1.5, h: 1.3, rgb: [1.6, 1.75, 2.1],
    },
    // The panel's aqua bounce, low in front.
    {
        az: 12, el: -26, w: 42, h: 9, rgb: [0.3, 0.62, 0.78],
    },
]);

const smoothEdge = (q) => {
    // A softbox: flat across its face, a short soft edge.
    const t = Math.min(1, Math.max(0, (Math.abs(q) - 0.7) / 0.3));
    return 1 - t * t * (3 - 2 * t);
};

/**
 * The studio as equirectangular RGBA bytes, width × width / 2, row 0 the nadir. A pure function
 * of its width: the same studio every time.
 * @param {number} [width]
 * @returns {Uint8Array}
 */
export function bakeOdysseyCharmStudio(width = ODYSSEY_CHARM_STUDIO_WIDTH) {
    const W = width;
    const H = width >> 1;
    const data = new Uint8Array(W * H * 4);
    const boxes = ODYSSEY_CHARM_STUDIO_LIGHTS.filter((light) => !light.band).map((light) => {
        const az = (light.az * Math.PI) / 180;
        const el = (light.el * Math.PI) / 180;
        const f = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        // Right = up × forward; up = forward × right.
        const r = [f[2], 0, -f[0]];
        const rl = Math.hypot(r[0], r[1], r[2]) || 1;
        r[0] /= rl;
        r[2] /= rl;
        const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
        return {
            f,
            r,
            u,
            tw: Math.tan((light.w * Math.PI) / 180),
            th: Math.tan((light.h * Math.PI) / 180),
            rgb: light.rgb,
        };
    });
    const bands = ODYSSEY_CHARM_STUDIO_LIGHTS.filter((light) => light.band);
    const encode = (value) => Math.round(Math.min(1, value / ODYSSEY_CHARM_STUDIO_RANGE) ** (1 / 2.2) * 255);
    for (let j = 0; j < H; j++) {
        const lat = ((j + 0.5) / H - 0.5) * Math.PI;
        const latDeg = (lat * 180) / Math.PI;
        const cl = Math.cos(lat);
        const dy = Math.sin(lat);
        // The room: indigo, darker toward the zenith, a shade lighter below the horizon.
        const up = Math.max(0, dy);
        const down = Math.max(0, -dy);
        const room = [
            0.03 + down * 0.03 - up * 0.012, 0.027 + down * 0.024 - up * 0.011, 0.055 + down * 0.05 - up * 0.02,
        ];
        let bandLight = [0, 0, 0];
        bands.forEach((band) => {
            const w = smoothEdge((latDeg - band.el) / band.h);
            bandLight = bandLight.map((value, k) => value + band.rgb[k] * w);
        });
        for (let i = 0; i < W; i++) {
            const lon = ((i + 0.5) / W - 0.5) * TAU;
            const dx = cl * Math.cos(lon);
            const dz = cl * Math.sin(lon);
            let r = room[0] + bandLight[0];
            let g = room[1] + bandLight[1];
            let b = room[2] + bandLight[2];
            for (let k = 0; k < boxes.length; k++) {
                const box = boxes[k];
                const d = dx * box.f[0] + dy * box.f[1] + dz * box.f[2];
                if (d <= 0.05) continue;
                const tx = (dx * box.r[0] + dy * box.r[1] + dz * box.r[2]) / d;
                if (Math.abs(tx) >= box.tw) continue;
                const ty = (dx * box.u[0] + dy * box.u[1] + dz * box.u[2]) / d;
                if (Math.abs(ty) >= box.th) continue;
                const w = smoothEdge(tx / box.tw) * smoothEdge(ty / box.th);
                r += box.rgb[0] * w;
                g += box.rgb[1] * w;
                b += box.rgb[2] * w;
            }
            const at = (j * W + i) * 4;
            data[at] = encode(r);
            data[at + 1] = encode(g);
            data[at + 2] = encode(b);
            data[at + 3] = 255;
        }
    }
    return data;
}

/**
 * The studio as a texture every icon reflects. Hosts that make one pass it to each icon and
 * dispose it with the renderer; without one, the icons share a module-wide copy.
 * @param {number} [width]
 */
export function createOdysseyCharmStudio(width = ODYSSEY_CHARM_STUDIO_WIDTH) {
    const data = bakeOdysseyCharmStudio(width);
    const studio = new THREE.DataTexture(data, width, width >> 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    studio.wrapS = THREE.RepeatWrapping;
    studio.wrapT = THREE.ClampToEdgeWrapping;
    studio.magFilter = THREE.LinearFilter;
    studio.minFilter = THREE.LinearMipmapLinearFilter;
    studio.generateMipmaps = true;
    studio.colorSpace = THREE.NoColorSpace;
    studio.flipY = false;
    studio.name = 'odyssey-charm-studio';
    studio.needsUpdate = true;
    return studio;
}

let sharedStudio = null;
const studioOrShared = (studio) => {
    if (studio) return studio;
    if (!sharedStudio) sharedStudio = createOdysseyCharmStudio();
    return sharedStudio;
};

// ---- The shading ----------------------------------------------------------------------------------

/** The key's direction and colour, for the one sharp sparkle the map's blur would soften. */
const KEY_DIRECTION = normalize(vec3(-0.62, 0.37, 0.69));
const KEY_COLOUR = vec3(1.2, 1.1, 0.95);

/** The studio's radiance along a direction, blurred by the map's mip level. */
function studioRadiance(studio, direction, lod) {
    const u = atan(direction.z, direction.x.add(1e-5)).div(TAU).add(0.5);
    const v = asin(clamp(direction.y, -1, 1)).div(Math.PI).add(0.5);
    const encoded = texture(studio, vec2(u, v)).level(float(lod)).rgb;
    return pow(encoded, 2.2).mul(ODYSSEY_CHARM_STUDIO_RANGE);
}

/** A direction turned about the vertical: the studio drifting round the icon. */
function spun(direction, uSpin) {
    const c = cos(uSpin);
    const s = sin(uSpin);
    return vec3(direction.x.mul(c).sub(direction.z.mul(s)), direction.y, direction.x.mul(s).add(direction.z.mul(c)));
}

/** The nodes every surface shares: its normal (back faces turned), its view, and its reflection. */
function surface(uSpin, twoSided = false) {
    const N = twoSided ? normalize(normalWorld).mul(faceDirection) : normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const NdotV = clamp(dot(N, V), 0, 1);
    const fresnel = pow(float(1).sub(NdotV), 5);
    const R = spun(reflect(V.negate(), N), uSpin);
    return {
        N, V, fresnel, R,
    };
}

/**
 * A polished metal in a charm's tone: the studio reflected through its own colour (a coloured
 * metal reflects in its colour), the key as one sharp sparkle, a clear coat over it where asked,
 * and the state light on its rim. `uDim` greys it (used), `uGlow` scales the rim light.
 * @param {{ base: number | object, glow: number, uniforms: object, studio: THREE.Texture, roughness?: number,
 *   rim?: number, flat?: boolean, coat?: number, emissive?: object }} options
 */
function metalMaterial({
    base, glow, uniforms, studio, roughness = 0.25, rim = 0.6, flat = false, coat = 0, emissive = null,
}) {
    const { uGlow, uDim, uSpin } = uniforms;
    const material = new THREE.MeshBasicNodeMaterial();
    material.flatShading = flat;
    const {
        N, V, fresnel, R,
    } = surface(uSpin);
    const F0 = mix(typeof base === 'number' ? color(base) : base, GREY, uDim.mul(0.85));
    const F = F0.add(float(1).sub(F0).mul(fresnel));
    // The room is dark between its lights: a floor of the metal's own colour keeps it coloured there.
    let shade = studioRadiance(studio, R, roughness * 6.5).mul(F).mul(mix(float(1), float(0.38), uDim))
        .add(F0.mul(0.24).mul(mix(float(1), float(0.5), uDim)));
    const H = normalize(KEY_DIRECTION.add(V));
    const shininess = 2 ** (11 * (1 - roughness));
    shade = shade.add(pow(clamp(dot(N, H), 0, 1), shininess).mul(KEY_COLOUR).mul(F).mul(0.9));
    if (coat > 0) {
        const coatF = float(0.04).add(fresnel.mul(0.96));
        shade = shade.add(studioRadiance(studio, R, 0.4).mul(coatF).mul(coat).mul(float(1).sub(uDim.mul(0.7))));
    }
    const stateLight = color(glow).mul(fresnel.mul(rim).add(0.03)).mul(uGlow).mul(float(1).sub(uDim.mul(0.9)));
    material.colorNode = emissive ? shade.add(stateLight).add(emissive) : shade.add(stateLight);
    return material;
}

/** Glass in a charm's tone: the studio in its surface, a little of its colour in its body, clear in the middle. */
function glassMaterial({
    tint, glow, uniforms, studio,
}) {
    const { uGlow, uDim, uSpin } = uniforms;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const { fresnel, R } = surface(uSpin, true);
    const F = float(0.04).add(fresnel.mul(0.96));
    const body = mix(color(tint), GREY, uDim.mul(0.85)).mul(0.16);
    const stateLight = color(glow).mul(fresnel.mul(0.9).add(0.02)).mul(uGlow).mul(float(1).sub(uDim.mul(0.9)));
    material.colorNode = studioRadiance(studio, R, 0.4).mul(F).mul(1.3).mul(mix(float(1), float(0.45), uDim))
        .add(body)
        .add(stateLight);
    material.opacityNode = mix(float(0.26), float(0.96), fresnel).mul(mix(float(1), float(0.7), uDim));
    return material;
}

/** A thin metal ring under an icon, lit by its state. */
function stateRing(tone, uniforms, studio) {
    const { uRing, uDim } = uniforms;
    const geometry = new THREE.TorusGeometry(0.92, 0.028, 10, 64);
    const material = metalMaterial({
        base: color(tone).mul(0.55),
        glow: tone,
        uniforms,
        studio,
        roughness: 0.3,
        rim: 0,
        emissive: color(tone).mul(uRing.mul(1.6)).mul(float(1).sub(uDim.mul(0.85))),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = -0.82;
    return { mesh, dispose: () => { geometry.dispose(); material.dispose(); } };
}

function sphere(radius, material, detail = 12) {
    const geometry = new THREE.SphereGeometry(radius, detail, detail);
    return { mesh: new THREE.Mesh(geometry, material), geometry };
}

// ---- The icons ------------------------------------------------------------------------------------

/** Tide: a wave of liquid aqua chrome curling over its own swell, three beads of spray rising from the crest. */
function buildTide(tones, uniforms, studio) {
    const group = new THREE.Group();
    // The crest: deeper teal at the foot, aqua where it curls; a coloured chrome reflects in its colour.
    const water = mix(color(tones.body), color(tones.tone), smoothstep(-0.55, 0.75, positionLocal.y));
    const material = metalMaterial({
        base: water, glow: tones.glow, uniforms, studio, roughness: 0.1, rim: 0.7,
    });
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
    const sprayMaterial = metalMaterial({
        base: tones.tone, glow: tones.glow, uniforms, studio, roughness: 0.06, rim: 1.0,
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

/** Still Air: a leaf of brushed lavender metal under a clear coat, resting on nothing, two chrome motes drifting round it. */
function buildStillAir(tones, uniforms, studio) {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.0);
    shape.bezierCurveTo(0.62, 0.58, 0.66, -0.42, 0, -1.0);
    shape.bezierCurveTo(-0.66, -0.42, -0.62, 0.58, 0, 1.0);
    const leafGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 18,
    });
    leafGeometry.center();
    // A pale midrib, and the blade lighter toward its edges.
    const rib = smoothstep(0.07, 0.0, abs(positionLocal.x));
    const edge = smoothstep(0.1, 0.62, abs(positionLocal.x));
    const blade = mix(color(tones.body), color(tones.tone), edge.mul(0.55).add(rib.mul(0.8)));
    const material = metalMaterial({
        base: blade, glow: tones.glow, uniforms, studio, roughness: 0.32, rim: 0.6, coat: 0.7,
    });
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
    const moteMaterial = metalMaterial({
        base: tones.tone, glow: tones.glow, uniforms, studio, roughness: 0.06, rim: 1.0,
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

/** Long Breath: an hourglass of pale gold glass on polished bronze, a thread of sand falling between the bulbs. */
function buildLongBreath(tones, uniforms, studio) {
    const group = new THREE.Group();
    const { uGlow, uDim, uPulse } = uniforms;
    const glass = glassMaterial({
        tint: tones.tone, glow: tones.glow, uniforms, studio,
    });
    const bronze = metalMaterial({
        base: 0xb07a3a, glow: tones.glow, uniforms, studio, roughness: 0.2, rim: 0.25,
    });
    // Sand: fine gold, matte but glinting, warming with the pulse.
    const sand = metalMaterial({
        base: tones.body,
        glow: tones.glow,
        uniforms,
        studio,
        roughness: 0.55,
        rim: 0.2,
        emissive: color(tones.glow).mul(uPulse.mul(0.3).add(0.1)).mul(uGlow).mul(float(1).sub(uDim.mul(0.9))),
    });
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
    // The glass draws last, over the sand and the bronze it holds.
    top.renderOrder = 1;
    bottom.renderOrder = 1;
    group.add(capTop, capBottom, ...pillars, pile, topSand, thread, top, bottom);
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

/** Hearth: a faceted obsidian ember, the studio in its polished facets, lit from within along its cracks, three sparks rising. */
function buildHearth(tones, uniforms, studio) {
    const group = new THREE.Group();
    const { uGlow, uDim, uPulse } = uniforms;
    // Cracks: the zero crossings of two warped sine fields make a net of thin lines, lit from
    // within and breathing with the pulse.
    const p = positionLocal.mul(5.2);
    const fieldA = sin(p.x.mul(1.6).add(sin(p.y.mul(2.1).add(p.z.mul(0.8)))));
    const fieldB = sin(p.y.mul(1.4).add(sin(p.z.mul(1.7).add(p.x.mul(0.9)))));
    const cracks = smoothstep(0.16, 0.0, abs(fieldA).min(abs(fieldB)));
    // Dark polished copper-iron: its facets catch the studio, the cracks glow through.
    const stone = metalMaterial({
        base: mix(color(0x2a1a1e), color(0x7a4a3a), 0.6),
        glow: tones.glow,
        uniforms,
        studio,
        roughness: 0.14,
        rim: 0.3,
        flat: true,
        emissive: color(tones.glow).mul(cracks.mul(uPulse.mul(0.8).add(0.7)).add(0.02)).mul(uGlow)
            .mul(float(1).sub(uDim.mul(0.92))),
    });
    const stoneGeometry = new THREE.IcosahedronGeometry(0.72, 1);
    const rock = new THREE.Mesh(stoneGeometry, stone);
    rock.position.y = -0.08;
    group.add(rock);
    const sparkMaterial = metalMaterial({
        base: tones.glow, glow: tones.glow, uniforms, studio, roughness: 0.1, rim: 1.6,
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

/** How fast the studio turns round an icon, in radians per second: a highlight crosses a face in a few seconds. */
export const ODYSSEY_CHARM_STUDIO_SPIN = 0.4;

/**
 * One charm icon: its group (centred, about 2 units tall, standing on its ring at y = -0.82),
 * its state uniforms, and an update on a clock in seconds.
 * @param {string} id a charm id
 * @param {{ studio?: THREE.Texture }} [options] the studio to reflect (createOdysseyCharmStudio)
 */
export function createOdysseyCharmIcon(id, { studio = null } = {}) {
    const tones = ODYSSEY_CHARM_ICON_TONES[id];
    const build = BUILDERS[id];
    if (!tones || !build) return null;
    const uniforms = {
        uGlow: uniform(1), uDim: uniform(0), uRing: uniform(STATE_LOOK.ready.ring), uPulse: uniform(0.5), uSpin: uniform(0),
    };
    const reflected = studioOrShared(studio);
    const icon = build(tones, uniforms, reflected);
    const ring = stateRing(tones.tone, uniforms, reflected);
    // The ring stays level under the icon while the icon itself rocks and turns.
    const group = new THREE.Group();
    group.add(icon.group, ring.mesh);
    let state = 'ready';
    return {
        id,
        group,
        uniforms,
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
            uniforms.uSpin.value = time * ODYSSEY_CHARM_STUDIO_SPIN;
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

/**
 * The lights a host scene may add for any lit material of its own: a warm key from the upper
 * left and a lavender sky over indigo ground. The icons themselves shade from the studio.
 */
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
