/**
 * Verdant Hills — the seven kites.
 *
 * Each tetromino has a kite of its colour, tied to a post on one of the home hill's spurs.
 * A lock puts its kite in the air; clears pay out line, so every kite that is flying
 * climbs; when the game goes quiet they come down one by one. A kite is a diamond sail on
 * a long line with a tail of bows. Where it stands is a closed form of time — the line's
 * bearing follows the wind, and the kite swings its lazy figure of eight wider the harder
 * it blows — so the same flight plays on both backends, in the playground's `seek`, and in
 * the unit tests. The tail and the line are shaped in the vertex shader from six rows per
 * kite.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, cross, dot, float, length, mix, normalize, pow, saturate, sin, smoothstep, step,
    uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { verdantHillsGroundHeight } from './verdant-hills-terrain.js';
import { VERDANT_HILLS_KITE_COLOURS } from './verdant-hills-tetrominos.js';

const ROWS = 6;
const TAIL_SEGMENTS = 26;
const LINE_SEGMENTS = 14;
const { degToRad, lerp, clamp } = THREE.MathUtils;
/** Height of a post's top above the ground, where a line is made fast. */
export const VERDANT_HILLS_POST_HEIGHT = 1.3;

/**
 * Where each kite is flown from, in slot order (I, O, T, S, Z, J, L): the post it is tied
 * to (x, z), how much line it has, how far its bearing stands off the wind's (degrees), and
 * the size of its sail in metres. Five fly from the left spur into the open sky left of
 * the board, two from the right spur over the windmill.
 */
export const VERDANT_HILLS_KITE_STATIONS = Object.freeze([
    {
        post: [-33, -28], line: 30, off: -4, size: 3.1,
    },
    {
        post: [24, -47], line: 31, off: -3, size: 3.0,
    },
    {
        post: [-46, -39], line: 37, off: -13, size: 3.4,
    },
    {
        post: [-24, -22], line: 24, off: 7, size: 2.8,
    },
    {
        post: [-58, -51], line: 42, off: -6, size: 3.5,
    },
    {
        post: [33, -66], line: 36, off: -7, size: 3.2,
    },
    {
        post: [-40, -34], line: 33, off: 16, size: 3.0,
    },
]);

/**
 * Where a kite stands. `fly` 0..1 says how far it has been let out, `height` 0..1 how much
 * line the game has paid out, `wind` 0..1 how hard it blows. Writes position into `out`.
 */
export function verdantHillsKitePlace(slot, time, {
    fly = 1, height = 0, wind = 0, flutter = 0, windX = 0.5, windZ = -0.866,
} = {}, out = new THREE.Vector3()) {
    const station = VERDANT_HILLS_KITE_STATIONS[slot];
    const [px, pz] = station.post;
    const base = verdantHillsGroundHeight(px, pz) + VERDANT_HILLS_POST_HEIGHT;
    const out01 = clamp(fly, 0, 1);
    const paid = clamp(height, 0, 1);
    const phase = slot * 2.399;
    // The swing: a lazy eight, wider and quicker the harder it blows.
    const lively = 0.35 + 0.65 * clamp(wind + flutter * 0.6, 0, 1);
    const rate = 0.5 + 0.4 * lively + (slot % 3) * 0.06;
    const swing = Math.sin(time * rate + phase);
    const nod = Math.sin(time * rate * 2 + phase * 2 + 1.2);
    const bearing = Math.atan2(windX, -windZ) + degToRad(station.off + swing * (5 + 11 * lively));
    // A kite just launched hangs low on a short line; paid-out line lets it climb.
    const lift = degToRad(lerp(26.5, 31, paid * (0.82 + 0.18 * Math.sin(phase * 3.1))) + nod * (1.2 + 2.2 * lively))
        * (0.3 + 0.7 * out01);
    const line = station.line * (0.75 + 0.3 * paid) * (0.08 + 0.92 * out01 * out01 * (3 - 2 * out01));
    const x = px + Math.sin(bearing) * Math.cos(lift) * line;
    const z = pz - Math.cos(bearing) * Math.cos(lift) * line;
    // On a short line a kite is barely above its post, and the hill may rise under it: once it
    // is flying it keeps its sail and the head of its tail clear of the grass.
    const flying = clamp(out01 / 0.3, 0, 1);
    const clearance = 0.4 + (station.size * 0.8 + 0.9) * flying * flying * (3 - 2 * flying);
    return out.set(x, Math.max(base + Math.sin(lift) * line, verdantHillsGroundHeight(x, z) + clearance), z);
}

export class VerdantHillsKites {
    constructor({ light }) {
        this.light = light;
        this.count = VERDANT_HILLS_KITE_STATIONS.length;
        this.group = new THREE.Group();
        this.group.name = 'VerdantHillsKites';
        // Per kite: [position xyz, shown] [right xyz, tug] [nose xyz, size] [velocity xyz, wind]
        // [colour rgb, phase] [post xyz, slack].
        this.rows = Array.from({ length: this.count * ROWS }, () => new THREE.Vector4(0, 0, 0, 0));
        this.place = new THREE.Vector3();
        this.ahead = new THREE.Vector3();
        this.nose = new THREE.Vector3();
        this.right = new THREE.Vector3();
        this.normal = new THREE.Vector3();
        this.posts = VERDANT_HILLS_KITE_STATIONS.map(({ post: [x, z] }) => new THREE.Vector3(
            x,
            verdantHillsGroundHeight(x, z) + VERDANT_HILLS_POST_HEIGHT,
            z,
        ));
        VERDANT_HILLS_KITE_COLOURS.forEach((hex, slot) => {
            const colour = new THREE.Color(hex);
            this.rows[slot * ROWS + 4].set(colour.r, colour.g, colour.b, slot * 2.399);
            const post = this.posts[slot];
            this.rows[slot * ROWS + 5].set(post.x, post.y, post.z, 0);
        });
        this.aloft = 0;
    }

    build() {
        const position = [];
        const part = [];
        const indices = [];
        const vertex = (x, y, z, kind, along, across, kite) => {
            position.push(x, y, z);
            part.push(kind, along, across, kite);
            return position.length / 3 - 1;
        };
        for (let kite = 0; kite < this.count; kite += 1) {
            // The sail: a diamond bellied by the wind, in local units of its own height. `along`
            // marks the panel (0 left of the spine, 1 right), `across` the distance from the frame.
            const nose = vertex(0, 0.38, 0, 0, 0.5, 0, kite);
            const tail = vertex(0, -0.62, 0, 0, 0.5, 0, kite);
            const left = vertex(-0.36, 0.1, 0, 0, 0, 0, kite);
            const right = vertex(0.36, 0.1, 0, 0, 1, 0, kite);
            const bellyL = vertex(-0.14, 0.02, -0.09, 0, 0, 1, kite);
            const bellyR = vertex(0.14, 0.02, -0.09, 0, 1, 1, kite);
            const spineL = vertex(0, 0.12, -0.02, 0, 0, 0.2, kite);
            const spineR = vertex(0, 0.12, -0.02, 0, 1, 0.2, kite);
            indices.push(
                nose,
                left,
                bellyL,
                nose,
                bellyL,
                spineL,
                spineL,
                bellyL,
                tail,
                left,
                tail,
                bellyL,
                nose,
                bellyR,
                right,
                nose,
                spineR,
                bellyR,
                spineR,
                tail,
                bellyR,
                right,
                bellyR,
                tail,
            );
            // The tail: a strip the shader hangs from the sail's foot.
            let base = position.length / 3;
            for (let i = 0; i <= TAIL_SEGMENTS; i += 1) {
                vertex(0, 0, 0, 1, i / TAIL_SEGMENTS, -1, kite);
                vertex(0, 0, 0, 1, i / TAIL_SEGMENTS, 1, kite);
                if (i < TAIL_SEGMENTS) {
                    const a = base + i * 2;
                    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                }
            }
            // The line: a strip from the post to the bridle.
            base = position.length / 3;
            for (let i = 0; i <= LINE_SEGMENTS; i += 1) {
                vertex(0, 0, 0, 2, i / LINE_SEGMENTS, -1, kite);
                vertex(0, 0, 0, 2, i / LINE_SEGMENTS, 1, kite);
                if (i < LINE_SEGMENTS) {
                    const a = base + i * 2;
                    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
        geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 4));
        geometry.setIndex(indices);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 70, -50), 300);
        const material = this.createMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'VerdantHillsKites';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.castShadow = false;
        mesh.renderOrder = 45;
        this.mesh = mesh;
        this.geometry = geometry;
        this.material = material;
        this.group.add(mesh);
        return this;
    }

    createMaterial() {
        const { light } = this;
        // Cloth is in the depth buffer although it fades in: the post chain adds the light of the air
        // along each pixel's line of sight, and a kite that left the sky's depth behind it would be
        // given a whole sky's worth and turn pastel. A kite still on its post leaves no depth at all.
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true, depthWrite: true, alphaTest: 0.02, fog: false, side: THREE.DoubleSide,
        });
        material.name = 'VerdantHillsKites';
        const rows = uniformArray(this.rows, 'vec4');
        const part = attribute('aPart', 'vec4'); // kind, along, across, kite
        const local = attribute('position', 'vec3');
        const first = part.w.add(0.5).floor().toInt().mul(ROWS);
        const place = rows.element(first);
        const right = rows.element(first.add(1));
        const nose = rows.element(first.add(2));
        const speed = rows.element(first.add(3));
        const tone = rows.element(first.add(4));
        const post = rows.element(first.add(5));
        const isTail = step(0.5, part.x).mul(step(part.x, 1.5));
        const isLine = step(1.5, part.x);
        const isSail = float(1).sub(step(0.5, part.x));
        const t = light.uTime;
        const size = nose.w;
        const face = normalize(cross(right.xyz, nose.xyz));
        // The sail breathes: its belly fills and spills with the gusts.
        const belly = sin(t.mul(5.1).add(tone.w)).mul(0.25).add(1).add(right.w.mul(0.5));
        const sail = place.xyz
            .add(right.xyz.mul(local.x.mul(size)))
            .add(nose.xyz.mul(local.y.mul(size)))
            .add(face.mul(local.z.mul(size).mul(belly)));
        // The tail hangs from the sail's foot, streams down the wind, and lags behind the swing.
        const foot = place.xyz.add(nose.xyz.mul(size.mul(-0.62)));
        const s = part.y;
        const reach = size.mul(4.4);
        const windward = normalize(vec3(light.uWindDir.x, 0, light.uWindDir.z));
        const blow = speed.w.mul(0.75).add(0.45);
        const hang = normalize(windward.mul(blow).add(vec3(0, -1, 0).mul(float(1.25).sub(blow.mul(0.6)))));
        const ripple = sin(s.mul(11).sub(t.mul(blow.mul(5).add(4))).add(tone.w)).mul(s).mul(size.mul(0.16));
        const flick = sin(s.mul(6.5).sub(t.mul(5.3)).add(tone.w.mul(1.7))).mul(s).mul(size.mul(0.11));
        const sideways = normalize(cross(hang, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0)));
        const trail = foot.add(hang.mul(reach.mul(s)))
            .add(sideways.mul(ripple))
            .add(vec3(0, 1, 0).mul(flick))
            .sub(speed.xyz.mul(s.mul(s).mul(0.5)));
        // Bows along the tail: the strip swells where one is tied.
        const bow = pow(sin(s.mul(Math.PI * 7)).abs(), 6);
        const tailWidth = size.mul(0.025).add(size.mul(0.085).mul(bow)).mul(smoothstep(1.02, 0.9, s));
        const tailSide = normalize(cross(hang, cameraPosition.sub(trail)));
        const tailPoint = trail.add(tailSide.mul(part.z.mul(tailWidth)));
        // The line is made fast on the flyer's side of the sail, and sags a little under its
        // own weight, more when the kite is barely flying.
        const bridle = place.xyz.add(face.mul(size.mul(0.12)));
        const span = bridle.sub(post.xyz);
        const sag = s.mul(float(1).sub(s)).mul(length(span)).mul(post.w.mul(0.3).add(0.06));
        const cord = mix(post.xyz, bridle, s).sub(vec3(0, 1, 0).mul(sag));
        const cordSide = normalize(cross(normalize(span), cameraPosition.sub(cord)));
        // No thinner than a pixel or so, however far away it is.
        const cordWidth = length(cameraPosition.sub(cord)).mul(0.00075).max(0.008);
        const linePoint = cord.add(cordSide.mul(part.z.mul(cordWidth)));
        const shown = saturate(place.w);
        material.positionNode = sail.mul(isSail).add(tailPoint.mul(isTail)).add(linePoint.mul(isLine));
        const kind = varying(part.x, 'verdantKiteKind');
        const along = varying(part.y, 'verdantKiteAlong');
        const frame = varying(local.xy, 'verdantKiteFrame');
        const colour = varying(tone.rgb, 'verdantKiteTone');
        const opacity = varying(shown, 'verdantKiteShown');
        const tug = varying(right.w, 'verdantKiteTug');
        const facing = varying(dot(face, light.uSunDir), 'verdantKiteFacing');
        const sailMask = float(1).sub(step(0.5, kind));
        const lineMask = step(1.5, kind);
        const tailMask = float(1).sub(sailMask).sub(lineMask);
        // Four panels in two shades of the kite's colour, quartered by the white tape over its spars.
        const spar = frame.y.sub(0.1);
        const panel = mix(colour, mix(colour, vec3(1), 0.22), step(0, frame.x.mul(spar)));
        const tape = smoothstep(0.03, 0.017, frame.x.abs()).max(smoothstep(0.03, 0.017, spar.abs()));
        const cloth = mix(panel, vec3(1, 0.99, 0.95), tape.mul(0.9));
        // Ripstop is thin: the sun shines through the sail as readily as off it.
        const lit = light.uSunColor.mul(facing.abs().mul(0.5).add(0.62)).mul(0.3).add(light.uSkyLight.mul(0.55));
        const bows = mix(colour, vec3(1, 0.99, 0.95), step(0.5, sin(along.mul(Math.PI * 7)).mul(0.5).add(0.5)));
        // Cloth is held under the brightness of the sky behind it: the tone curve turns a bright
        // saturated colour pastel, and a kite is read by its colour. A tugged one catches a little
        // more light.
        const sailColour = cloth.mul(lit).mul(tug.mul(0.12).add(0.7));
        const tailColour = bows.mul(lit).mul(0.72);
        const lineColour = vec3(0.86, 0.86, 0.8).mul(lit).mul(0.8);
        material.colorNode = vec4(
            light.haze(sailColour.mul(sailMask).add(tailColour.mul(tailMask)).add(lineColour.mul(lineMask))),
            1,
        );
        material.opacityNode = opacity.mul(mix(float(1), float(0.5), lineMask));
        return material;
    }

    /**
     * Fly the kites for this frame. `frame.kites` says how far each has been let out,
     * `frame.height` how much line the game has paid out.
     */
    update(time, dt, frame = {}) {
        const { light } = this;
        const windX = light.uWindDir.value.x;
        const windZ = light.uWindDir.value.z;
        const state = {
            fly: 0,
            height: Number.isFinite(frame.height) ? frame.height : 0,
            wind: Number.isFinite(frame.wind) ? frame.wind : 0,
            flutter: Number.isFinite(frame.flutter) ? frame.flutter : 0,
            windX,
            windZ,
        };
        let aloft = 0;
        for (let slot = 0; slot < this.count; slot += 1) {
            const row = slot * ROWS;
            const fly = clamp(Number(frame.kites?.[slot]) || 0, 0, 1);
            state.fly = fly;
            const place = verdantHillsKitePlace(slot, time, state, this.place);
            const ahead = verdantHillsKitePlace(slot, time + 0.05, state, this.ahead);
            const station = VERDANT_HILLS_KITE_STATIONS[slot];
            const post = this.posts[slot];
            // The sail faces down its own line; its nose points up along the sky.
            this.normal.copy(place).sub(post).normalize();
            this.right.crossVectors(this.normal, this.nose.set(0, 1, 0)).normalize();
            this.nose.crossVectors(this.right, this.normal).normalize();
            // It banks into its swing.
            const bank = clamp((ahead.x - place.x) * windZ * -1 + (ahead.z - place.z) * windX, -0.4, 0.4) * 6;
            this.right.addScaledVector(this.nose, -bank).normalize();
            this.nose.crossVectors(this.right, this.normal).normalize();
            const tug = clamp(Number(frame.kiteTug?.[slot]) || 0, 0, 1);
            this.rows[row].set(place.x, place.y, place.z, smoothstepJS(fly, 0.02, 0.25));
            this.rows[row + 1].set(this.right.x, this.right.y, this.right.z, tug);
            this.rows[row + 2].set(this.nose.x, this.nose.y, this.nose.z, station.size * (1.12 + 0.13 * fly));
            this.rows[row + 3].set(
                (ahead.x - place.x) / 0.05,
                (ahead.y - place.y) / 0.05,
                (ahead.z - place.z) / 0.05,
                clamp(state.wind + state.flutter * 0.5, 0, 1),
            );
            this.rows[row + 5].w = 1 - fly;
            if (fly > 0.02) aloft += 1;
        }
        this.aloft = aloft;
    }

    /** World position of a kite's sail (for effects that start from it). */
    position(slot, target = new THREE.Vector3()) {
        const row = this.rows[clamp(Math.floor(slot), 0, this.count - 1) * ROWS];
        return target.set(row.x, row.y, row.z);
    }

    dispose() {
        this.geometry?.dispose();
        this.material?.dispose();
        this.group.removeFromParent();
        this.group.clear();
        this.mesh = null;
    }
}

function smoothstepJS(value, low, high) {
    const t = clamp((value - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
}
