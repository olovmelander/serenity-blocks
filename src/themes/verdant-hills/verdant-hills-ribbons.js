/**
 * Verdant Hills — the wind, drawn.
 *
 * A gust has no colour of its own, so the hills draw it the way a picture book does: a
 * thin bright ribbon that runs out along the wind, throws a loop, and thins away. A lock
 * sends one from the edge of the board in the colour of its kite; a clear sends them
 * streaming from both sides; the great gust lays long ones across the whole view; a combo
 * winds them around the board.
 *
 * One mesh holds every ribbon. Each is a strip whose vertices know only how far along it
 * they are; the vertex shader places them on the ribbon's path from six rows of a uniform
 * array (start, heading, colour, pace, shape, loop axis), so launching a ribbon is writing
 * six vectors and nothing is allocated while the game runs.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, cos, cross, float, max, min, mix, normalize, saturate, sin, smoothstep,
    uniformArray, varying, vec3, vec4,
} from 'three/tsl';

const SEGMENTS = 44;
const ROWS = 6;
const UP = new THREE.Vector3(0, 1, 0);

export class VerdantHillsRibbons {
    constructor({ light, tier }) {
        this.light = light;
        this.count = Math.max(1, Math.floor(tier.ribbons));
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsRibbons';
        // Per ribbon: [origin xyz, age] [heading xyz, length] [colour rgb, strength]
        // [speed, loop radius, loop start, life] [loops, width, phase, lift] [loop axis xyz, wobble].
        this.rows = Array.from({ length: this.count * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.cursor = 0;
        this.scratch = new THREE.Vector3();
        this.axis = new THREE.Vector3();
    }

    build() {
        const { count } = this;
        const strip = new Float32Array(count * (SEGMENTS + 1) * 2 * 3);
        const indices = [];
        for (let ribbon = 0; ribbon < count; ribbon += 1) {
            const base = ribbon * (SEGMENTS + 1) * 2;
            for (let step = 0; step <= SEGMENTS; step += 1) {
                for (let side = 0; side < 2; side += 1) {
                    strip.set([step / SEGMENTS, side * 2 - 1, ribbon], (base + step * 2 + side) * 3);
                }
                if (step < SEGMENTS) {
                    const a = base + step * 2;
                    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        // The shader places every vertex; `position` only has to exist.
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(strip.length), 3));
        geometry.setAttribute('aStrip', new THREE.BufferAttribute(strip, 3));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, -20), 400);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsRibbons';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 70;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
        });
        material.name = 'VerdantHillsRibbons';
        const rows = uniformArray(this.rows, 'vec4');
        const strip = attribute('aStrip', 'vec3'); // along 0..1 (head to tail), side, ribbon
        const first = strip.z.add(0.5).floor().toInt().mul(ROWS);
        const start = rows.element(first);
        const heading = rows.element(first.add(1));
        const tone = rows.element(first.add(2));
        const pace = rows.element(first.add(3)); // speed, loop radius, loop start, life
        const shape = rows.element(first.add(4)); // loops, width, phase, lift
        const loop = rows.element(first.add(5)); // loop axis, wobble
        const age = start.w;
        // The head runs out fast and eases as the gust spends itself.
        const run = pace.x.mul(age).mul(float(1).sub(age.div(pace.w.max(0.01)).mul(0.3)));
        const travelled = run.sub(strip.x.mul(heading.w));
        const radius = pace.y.max(0.001);
        const turns = shape.x.mul(Math.PI * 2);
        /** The ribbon's path: straight out, round its loops, straight on, rising and wavering. */
        const path = (reach) => {
            const out = max(reach, 0);
            const angle = min(max(out.sub(pace.z), 0).div(radius), turns);
            const beyond = max(out.sub(pace.z).sub(radius.mul(turns)), 0);
            const along = min(out, pace.z).add(radius.mul(sin(angle))).add(beyond);
            const waver = sin(out.mul(0.55).add(shape.z)).mul(loop.w).mul(saturate(out.mul(0.4)));
            const side = normalize(cross(heading.xyz, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0)));
            return start.xyz.add(heading.xyz.mul(along))
                .add(loop.xyz.mul(radius.mul(float(1).sub(cos(angle)))))
                .add(vec3(0, 1, 0).mul(shape.w.mul(out).add(waver)))
                .add(side.mul(waver.mul(0.6).add(angle.mul(radius).mul(0.05))));
        };
        const here = path(travelled);
        const tangent = normalize(path(travelled.add(0.06)).sub(here).add(vec3(0.00001, 0, 0)));
        const across = normalize(cross(tangent, cameraPosition.sub(here)));
        // Thin at the head, thinnest at the tail, and nothing at all where it has not yet left.
        const taper = sin(saturate(strip.x).mul(Math.PI)).max(0).pow(0.6).mul(smoothstep(0.0, 0.25, travelled));
        const alive = smoothstep(0.0, 0.1, age).mul(smoothstep(pace.w, pace.w.mul(0.55), age)).mul(saturate(tone.w));
        material.positionNode = here.add(across.mul(strip.y.mul(shape.y).mul(taper).mul(alive.mul(0.5).add(0.5))));
        const edge = varying(strip.y, 'verdantRibbonEdge');
        const fade = varying(taper.mul(alive), 'verdantRibbonFade');
        const tint = varying(tone.rgb, 'verdantRibbonTint');
        const core = saturate(float(1).sub(edge.abs()));
        // A white heart in a sleeve of the kite's colour, lit like everything else out there.
        const colour = mix(tint, vec3(1), core.pow(2.4).mul(0.62))
            .mul(light.uSunColor.mul(0.3).add(light.uSkyLight.mul(0.5)));
        material.colorNode = vec4(colour, 1);
        material.opacityNode = core.pow(1.3).mul(fade).mul(0.86);
        return material;
    }

    /**
     * Send a ribbon out. `origin` and `heading` are vectors; `axis` is the way its loops lean
     * (default: upward). Replaces a free slot or the ribbon nearest its end.
     */
    launch({
        origin, heading, colour, length = 4, speed = 9, life = 1.4, width = 0.07, strength = 1, loops = 1,
        loopRadius = 0.5, loopAt = 2.2, lift = 0.04, wobble = 0.12, axis = UP, phase = 0,
    }) {
        if (!origin || !heading || !(strength > 0)) return -1;
        // A ribbon that cannot be placed or pointed is not launched at all.
        const placed = [origin.x, origin.y, origin.z, heading.x, heading.y, heading.z].every(Number.isFinite);
        if (!placed || !(heading.x * heading.x + heading.y * heading.y + heading.z * heading.z > 1e-12)) return -1;
        let selected = -1;
        let furthest = -1;
        for (let step = 0; step < this.count; step += 1) {
            const index = (this.cursor + step) % this.count;
            const tone = this.rows[index * ROWS + 2];
            if (tone.w <= 0) {
                selected = index;
                break;
            }
            const progress = this.rows[index * ROWS].w / Math.max(0.01, this.rows[index * ROWS + 3].w);
            if (progress > furthest) {
                furthest = progress;
                selected = index;
            }
        }
        this.cursor = (selected + 1) % this.count;
        const row = selected * ROWS;
        const forward = this.scratch.copy(heading).normalize();
        // The loop's axis is kept square to the heading, so a loop closes on itself.
        const lean = this.axis.copy(axis).addScaledVector(forward, -axis.dot(forward));
        if (lean.lengthSq() < 1e-6) lean.set(0, 1, 0).addScaledVector(forward, -forward.y);
        // A ribbon sent straight up or down has no upward lean left: it loops sideways.
        if (lean.lengthSq() < 1e-6) lean.set(1, 0, 0).addScaledVector(forward, -forward.x);
        lean.normalize();
        this.rows[row].set(origin.x, origin.y, origin.z, 0);
        this.rows[row + 1].set(forward.x, forward.y, forward.z, length);
        this.rows[row + 2].set(colour?.r ?? 1, colour?.g ?? 1, colour?.b ?? 1, Math.min(1, strength));
        this.rows[row + 3].set(speed, loopRadius, loopAt, life);
        this.rows[row + 4].set(loops, width, phase, lift);
        this.rows[row + 5].set(lean.x, lean.y, lean.z, wobble);
        return selected;
    }

    update(dt) {
        if (!(dt > 0)) return;
        for (let index = 0; index < this.count; index += 1) {
            const row = index * ROWS;
            if (this.rows[row + 2].w > 0) {
                this.rows[row].w += dt;
                if (this.rows[row].w >= this.rows[row + 3].w) this.rows[row + 2].w = 0;
            }
        }
    }

    active() {
        let live = 0;
        for (let index = 0; index < this.count; index += 1) if (this.rows[index * ROWS + 2].w > 0) live += 1;
        return live;
    }

    reset() {
        this.rows.forEach((row) => row.set(0, 0, 0, 0));
        this.cursor = 0;
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}
