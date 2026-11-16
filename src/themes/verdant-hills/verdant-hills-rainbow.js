/**
 * Verdant Hills — the rainbow over the valley.
 *
 * After the rain a double bow stands over the valley, and a perfect clear draws one across the
 * whole sky from its left foot to its right, as bright as a bow gets. It is drawn where a curtain
 * of rain would hang, a mile and a half out: a band of a sphere round the lens, so the far ridges
 * show through it, the home hill, the oak and the mill stand in front of it, and its feet come
 * down into the valley on either side of the board.
 *
 * The bow is centred straight ahead of the lens and as far under the horizon as the day's sun is
 * above it, so it is the low, wide bow of a high sun: the primary's crown some six degrees over
 * the far ridge, the secondary outside it. (It is a picture's bow: the sun that lights the hills
 * stands ahead and to the right, and a bow needs it at the lens's back. The rain that makes it
 * is never drawn: no veil, no grey.)
 *
 * Its colours are the table of verdant-hills-bow.js, read by the angle from the bow's centre.
 * It is light added to what is behind it, less a little of the sky between the two bows.
 */
import * as THREE from 'three/webgpu';
import {
    acos, attribute, cameraPosition, dot, float, normalize, positionGeometry, positionWorld, saturate, smoothstep,
    step, texture, uniform, varying, vec2, vec4,
} from 'three/tsl';
import { bakeOnce } from '../shared/bake-cache.js';
import { VERDANT_HILLS_BOW_RANGE, VERDANT_HILLS_BOW_WIDTH, bakeVerdantHillsBow } from './verdant-hills-bow.js';
import { VERDANT_HILLS_SUN_ELEVATION_DEGREES } from './verdant-hills-light.js';

const { degToRad } = THREE.MathUtils;
/** How far out the curtain of rain hangs, metres. */
export const VERDANT_HILLS_BOW_DISTANCE = 2400;
/** The arc of the ring that is built: the part that can stand over the land (degrees either side of its crown). */
const ARC = 112;
const SEGMENTS = 96;
/** How bright the standing bow of the rinsed air is, and the one a perfect clear draws. */
export const VERDANT_HILLS_BOW_STANDING = 0.42;
export const VERDANT_HILLS_BOW_GREAT = 1.25;
/** How long a perfect clear's bow takes to draw itself across the sky, seconds. */
export const VERDANT_HILLS_BOW_DRAW_SECONDS = 1.7;

/**
 * The bow's centre as a unit direction from the lens: straight ahead (-Z) and as far below the
 * horizon as the sun stands above it.
 */
export function verdantHillsBowAxis(target = new THREE.Vector3()) {
    const dip = degToRad(VERDANT_HILLS_SUN_ELEVATION_DEGREES);
    return target.set(0, -Math.sin(dip), -Math.cos(dip));
}

/**
 * The direction from the lens to a point of the bow: `angle` degrees from its centre, `around`
 * degrees round it from its crown (negative to the left).
 */
export function verdantHillsBowDirection(angle, around, target = new THREE.Vector3()) {
    const axis = verdantHillsBowAxis(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const right = new THREE.Vector3().crossVectors(axis, up).normalize();
    const theta = degToRad(angle);
    const phi = degToRad(around);
    return target.copy(axis).multiplyScalar(Math.cos(theta))
        .addScaledVector(up, Math.sin(theta) * Math.cos(phi))
        .addScaledVector(right, Math.sin(theta) * Math.sin(phi))
        .normalize();
}

function createBowTexture() {
    const data = bakeOnce(`verdant-hills-bow:${VERDANT_HILLS_BOW_WIDTH}`, () => bakeVerdantHillsBow());
    // Bytes: the table's light never passes one, and a byte's step is far under the eye's.
    const bytes = new Uint8Array(VERDANT_HILLS_BOW_WIDTH * 4);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
    const map = new THREE.DataTexture(bytes, VERDANT_HILLS_BOW_WIDTH, 1, THREE.RGBAFormat);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.NoColorSpace;
    map.name = 'VerdantHillsBow';
    map.needsUpdate = true;
    return map;
}

export class VerdantHillsRainbow {
    /** `eye` is where the lens rests ([x, y, z]). */
    constructor({ light, eye = [0, 63, 0] }) {
        this.light = light;
        this.eye = new THREE.Vector3(...eye);
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsRainbow';
        /**
         * x how bright the weather's bow stands, y how much a perfect clear's adds to it, z how far
         * that one has been drawn across the sky (0..1).
         */
        this.uBow = uniform(new THREE.Vector3(0, 0, 1));
        this.axis = verdantHillsBowAxis();
        /** How bright the bow stands at its fullest this frame (for the diagnostics and the tests). */
        this.strength = 0;
    }

    build() {
        const [from, to] = VERDANT_HILLS_BOW_RANGE;
        const positions = [];
        const arcs = [];
        const indices = [];
        const point = new THREE.Vector3();
        for (let i = 0; i <= SEGMENTS; i += 1) {
            const s = i / SEGMENTS;
            const around = -ARC + 2 * ARC * s;
            for (let side = 0; side < 2; side += 1) {
                verdantHillsBowDirection(side ? to : from, around, point)
                    .multiplyScalar(VERDANT_HILLS_BOW_DISTANCE).add(this.eye);
                positions.push(point.x, point.y, point.z);
                arcs.push(s);
            }
            if (i < SEGMENTS) {
                const a = i * 2;
                indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('aArc', new THREE.Float32BufferAttribute(arcs, 1));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        this.map = createBowTexture();
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsRainbow';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 42;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const [from, to] = VERDANT_HILLS_BOW_RANGE;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, premultipliedAlpha: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        });
        material.name = 'VerdantHillsRainbow';
        const along = varying(attribute('aArc', 'float'), 'verdantBowArc');
        const direction = normalize(positionWorld.sub(cameraPosition));
        const axis = uniform(this.axis);
        // (Clamped: the arc cosine of a dot product a hair over one is not a number.)
        const angle = acos(dot(direction, axis).clamp(-1, 1)).mul(180 / Math.PI);
        const table = texture(this.map, vec2(saturate(angle.sub(from).div(to - from)), 0.5));
        // A perfect clear draws its bow from the left foot over the crown to the right, over
        // whatever bow the weather has standing already.
        const drawn = smoothstep(0.0, 0.14, this.uBow.z.mul(1.16).sub(along));
        const strength = this.uBow.x.add(this.uBow.y.mul(drawn));
        // A bow is brightest toward its feet, and sinks softly into the valley's air.
        const stand = smoothstep(-0.085, -0.02, direction.y)
            .mul(float(1).sub(saturate(direction.y.mul(3.2)).mul(0.34)));
        // The mesh's own ends, far round the ring, never show as an edge.
        const ends = smoothstep(0.0, 0.05, along).mul(smoothstep(1.0, 0.95, along));
        const shown = strength.mul(stand).mul(ends);
        // With no bow in the sky the band folds to a point: its pipeline exists from the first
        // frame, and it costs no pixel until there is something to draw.
        material.positionNode = positionGeometry.mul(step(0.002, this.uBow.x.add(this.uBow.y)));
        // Light added to what is behind it, less a little of the sky between the two bows.
        material.outputNode = vec4(table.rgb.mul(this.light.uSunColor).mul(0.2).mul(shown), table.a.mul(shown.min(1)));
        return material;
    }

    /**
     * Stand the bow for this frame. `standing` is the weather's bow (0..1), `great` the perfect
     * clear's ({ strength 0..1, drawn 0..1 }, or null).
     */
    update(standing = 0, great = null) {
        const rest = Number.isFinite(standing) ? Math.max(0, Math.min(1, standing)) * VERDANT_HILLS_BOW_STANDING : 0;
        const asked = great && Number.isFinite(great.strength) ? Math.max(0, Math.min(1, great.strength)) : 0;
        const drawn = great && Number.isFinite(great.drawn) ? Math.max(0, Math.min(1, great.drawn)) : 1;
        // A great bow over a standing one brightens what stands and draws only its own share.
        const extra = Math.max(0, VERDANT_HILLS_BOW_GREAT - rest) * asked;
        this.strength = rest + extra;
        this.uBow.value.set(rest, extra, drawn);
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.map?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
