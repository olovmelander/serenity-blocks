/**
 * Wolfhour's one warm light: a herder's hut low in the valley, its window lit by the fire inside.
 * Everything else in the world is moonlight and blue air; this is the only warm colour, so it is
 * kept small (a window, a little glow in the mist round it, a thread of smoke above the roof).
 * The flicker is slow and shallow (a few percent), never a flash.
 * Authored in world units with the hut's sill at the origin.
 */
import * as THREE from 'three/webgpu';
import {
    exp, float, mix, smoothstep, texture, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

const WALL = new THREE.Color(0.0055, 0.007, 0.012);
/** Moonlit snow lying on the roof (linear). */
const ROOF_SNOW = new THREE.Color(0.11, 0.135, 0.2);
/** The window's fire (linear, well above 1 so the bloom catches it) and its glow in the air. */
const FIRE = vec3(3.2, 1.25, 0.34);
const GLOW = vec3(0.3, 0.13, 0.04);
/** Where the window and the chimney top sit on the cabin. */
const WINDOW = Object.freeze({ x: -3.6, y: 3.9 });
const CHIMNEY = Object.freeze({ x: 5.3, y: 16.4 });
/** How far in front of the hut its glow is drawn: past the mist bank in front of it. */
const GLOW_DEPTH = 90;

/** The cabin: walls, an overhanging gable roof and a chimney on the far slope. */
function cabinShape() {
    const s = new THREE.Shape();
    s.moveTo(-9, 0);
    s.lineTo(9, 0);
    s.lineTo(9, 7.2);
    s.lineTo(11.2, 7.2);
    s.lineTo(6.2, 11.6);
    s.lineTo(6.2, 16.4);
    s.lineTo(4.4, 16.4);
    s.lineTo(4.4, 13.2);
    s.lineTo(-0.6, 15.6);
    s.lineTo(-11.4, 7.2);
    s.lineTo(-9, 7.2);
    s.lineTo(-9, 0);
    return s;
}

/** The snow on the roof: a thin cap following both slopes, thicker toward the ridge. */
function roofSnowShape() {
    const s = new THREE.Shape();
    s.moveTo(-11.9, 7.5);
    s.lineTo(-0.6, 16.3);
    s.lineTo(4.4, 13.9);
    s.lineTo(4.4, 13.2);
    s.lineTo(-0.6, 15.4);
    s.lineTo(-11, 7.2);
    s.lineTo(-11.9, 7.5);
    return s;
}

/** Firelight's slow flicker at `time`: three incommensurate sines, a few percent deep. */
export function hutFlicker(time) {
    const t = Number.isFinite(time) ? time : 0;
    return 0.94 + Math.sin(t * 2.3) * 0.025 + Math.sin(t * 3.7 + 1.3) * 0.018 + Math.sin(t * 0.61 + 0.4) * 0.02;
}

/** Creates the hut. `noiseMap` (the sky's noise tile) frays the smoke; without it there is none. */
export function createWolfhourHut({ quality = 'High', noiseMap = null } = {}) {
    const group = new THREE.Group();
    group.name = 'Wolfhour hut';
    const uTime = uniform(0);
    const uFlicker = uniform(1);
    const geometries = [];
    const materials = [];
    const mesh = (name, geometry, material) => {
        geometries.push(geometry);
        materials.push(material);
        const m = new THREE.Mesh(geometry, material);
        m.name = name;
        group.add(m);
        return m;
    };

    mesh('Wolfhour hut cabin', new THREE.ShapeGeometry(cabinShape(), 2), new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour hut walls', color: WALL, side: THREE.DoubleSide,
    }));

    const snow = mesh(
        'Wolfhour hut roof snow',
        new THREE.ShapeGeometry(roofSnowShape(), 1),
        new THREE.MeshBasicNodeMaterial({ name: 'Wolfhour hut roof snow', color: ROOF_SNOW, side: THREE.DoubleSide }),
    );
    snow.position.z = 0.1;

    // The window: four panes of firelight split by a dark cross, brighter low where the fire is.
    const windowMaterial = new THREE.MeshBasicNodeMaterial({ name: 'Wolfhour hut window' });
    const w = uv();
    const bars = float(1).sub(smoothstep(0.03, 0.07, w.x.sub(0.5).abs()))
        .max(float(1).sub(smoothstep(0.04, 0.08, w.y.sub(0.5).abs())));
    const hearth = float(1).sub(w.y).mul(0.35).add(0.75);
    windowMaterial.colorNode = FIRE.mul(uFlicker).mul(hearth).mul(float(1).sub(bars.mul(0.88)));
    mesh('Wolfhour hut window', new THREE.PlaneGeometry(3.6, 3), windowMaterial)
        .position.set(WINDOW.x, WINDOW.y, 0.2);

    // The glow: firelight scattered in the mist round the window. It stands in front of the mist
    // bank the hut sits in (the hut itself is behind it). Additive and premultiplied, leaving the
    // target's alpha alone.
    const glowMaterial = new THREE.MeshBasicNodeMaterial({
        name: 'Wolfhour hut glow',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
    });
    const g = uv().sub(0.5).mul(2);
    const r2 = g.dot(g);
    // A small bright core round the window and a wide, low spread along the valley mist.
    const halo = exp(r2.mul(-14)).mul(0.6).add(exp(r2.mul(-3)).mul(0.28)).mul(float(1).sub(r2).max(0));
    glowMaterial.outputNode = vec4(GLOW.mul(halo).mul(uFlicker), 0);
    const glow = mesh('Wolfhour hut glow', new THREE.PlaneGeometry(150, 70), glowMaterial);
    glow.position.set(WINDOW.x, WINDOW.y + 0.6, GLOW_DEPTH);
    glow.renderOrder = 2;

    // Smoke: a thin moonlit thread that leans with the wind and frays as it rises.
    if (noiseMap && quality !== 'Minimal') {
        const smokeMaterial = new THREE.MeshBasicNodeMaterial({
            name: 'Wolfhour hut smoke', transparent: true, depthWrite: false, side: THREE.DoubleSide,
        });
        const s = uv();
        const rise = s.y;
        const fray = texture(noiseMap, vec2(s.x.mul(0.8).add(0.3), rise.mul(1.6).sub(uTime.mul(0.05)))).r;
        // The foot of the quad is the chimney (u = 0.5); the thread leans left as it climbs.
        const across = s.x.sub(0.5).add(rise.mul(rise).mul(0.34)).sub(fray.sub(0.5).mul(rise.mul(0.5)));
        const width = rise.mul(0.17).add(0.035);
        const thread = exp(across.div(width).pow2().mul(-1.6));
        const fade = smoothstep(0, 0.06, rise).mul(float(1).sub(smoothstep(0.35, 1, rise)));
        smokeMaterial.colorNode = mix(vec3(0.07, 0.085, 0.12), vec3(0.11, 0.13, 0.18), rise);
        smokeMaterial.opacityNode = thread.mul(fade).mul(fray.mul(0.7).add(0.45)).mul(0.5).clamp(0, 1);
        mesh('Wolfhour hut smoke', new THREE.PlaneGeometry(26, 46), smokeMaterial)
            .position.set(CHIMNEY.x, CHIMNEY.y + 23, -0.2);
    }

    return {
        group,
        update(time) {
            uTime.value = Number.isFinite(time) ? time : 0;
            uFlicker.value = hutFlicker(time);
        },
        dispose() {
            group.removeFromParent();
            for (const geometry of geometries) geometry.dispose();
            for (const material of materials) material.dispose();
            geometries.length = 0;
            materials.length = 0;
            group.clear();
        },
    };
}
