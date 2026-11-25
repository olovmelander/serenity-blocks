/**
 * Fall — the grove's visitors, drawn: what fall-happenings.js says is happening.
 *
 *   geese    a skein in a V, high over the grove, crossing the one window of open sky the game
 *            leaves: the strip above the board card, between the two great crowns. It is laid out
 *            in the eye's own frame (a share of the picture's height, at a depth behind the crowns),
 *            so it reads as a V of beating wings whatever the screen, crosses that window for about
 *            five seconds, and enters and leaves whole beyond the picture's edges.
 *   jays     one jay, then a second, down out of a great crown (from above the picture) on one side
 *            of the board, low past the windfall's lookout or over the stump, close to the eye where
 *            the blue of the wing shows, and away out of the picture's side. Never across the card.
 *   acorns   a handful dropping from the near crown on one side, from just above the picture into
 *            the litter a few metres from the eye beside the card: each falls, bounces (lifting the
 *            leaves it lands among), rolls a little and lies, and sinks away as the happening ends.
 *
 * (The fourth happening, the wandering shaft, is light: FallLight.setSpot.)
 *
 * Birds are one small mesh each, a body and two-jointed wings, posed on the CPU (a dozen and a half
 * at most) and flapped in the vertex stage; acorns fall in closed form in theirs. Nothing here is
 * drawn between happenings, and nothing allocates while one runs.
 */
import * as THREE from 'three/webgpu';
import {
    attribute, cameraPosition, color, cos, cross, dot, exp, float, instancedBufferAttribute, max, min, mix,
    normalGeometry,
    normalize, positionGeometry, positionLocal, positionWorld, pow, saturate, sin, smoothstep, uniform, varying, vec3,
    cameraFar, cameraNear, viewZToPerspectiveDepth,
} from 'three/tsl';
import { fallWorldTier } from './fall-airs.js';

const TAU = Math.PI * 2;
/** Where a wing's second joint is, as a share of its span. */
const WING_ELBOW = 0.46;
/**
 * The skein, in the eye's frame: how far along the view it flies (m, behind the great crowns, so they
 * hide it either side of the sky window), and in shares of the picture's height its wingspan, how far
 * back each rank flies and how far it stands out from the line, and where its middle flies (the
 * strip above the board card and its preview, in the game's own layout). At most `most` geese: a V
 * that fits the window.
 */
export const SKEIN = Object.freeze({
    depth: 62,
    span: 0.042,
    back: 0.032,
    spread: 0.0125,
    band: 0.053,
    most: 7,
    beat: 2.1,
    haze: 0.3,
    skyDepth: 420,
});
/**
 * The jays' flights, one each side of the board (world metres): a cubic loop in from beyond the
 * picture's side edge, low and side-on across the near grove, round past the perch (the windfall's
 * lookout on the right, the stump on the left) and back out of the same edge, a little higher. They
 * bank into the turn, so the wings and their blue are seen from above. A flight takes `seconds`; the
 * second jay leaves `follow` after the first, `offset` from its path.
 */
export const JAY = Object.freeze({
    seconds: 3.8,
    follow: 0.85,
    scale: 0.48,
    beat: 8.5,
    bank: 0.85,
    offset: Object.freeze([0, 0.4, -0.5]),
    flights: Object.freeze([
        // Right of the board: past the oak's trunk to the windfall's lookout, and back out right.
        Object.freeze([[12.5, 2.2, 10.2], [0.6, 2.2, 8.4], [1.2, 3.6, 6.8], [12.5, 4.2, 6.4]]),
        // Left of it: across the bright mist to the stump, and back out left.
        Object.freeze([[-12.5, 2.4, 10.2], [-1.0, 2.6, 8.4], [-1.6, 4.2, 7.0], [-12.5, 5.0, 6.6]]),
    ]),
});
/**
 * Acorns: how hard they fall (m/s2), what a bounce keeps of the speed, how big they are drawn (m and
 * a factor), how long a roll takes to die out (s) and what it keeps of the drift; and where they land,
 * one side of the board at a time ([x0, x1, z0, z1] patches of litter a few metres from the eye, beside
 * the card, clear of the windfall and the stump; the first patch of a side is the nearer, and most fall
 * there).
 */
export const ACORN = Object.freeze({
    // (A little slower than a real fall and a livelier bounce: seen from a few metres a real one is
    // over before the eye finds it.)
    gravity: 7,
    bounce: 0.36,
    size: 0.075,
    over: 2.6,
    rollSeconds: 0.35,
    roll: 0.7,
    patches: Object.freeze([
        Object.freeze([Object.freeze([-3.3, -2.4, 5.8, 7.3]), Object.freeze([-3.6, -2.8, 3.4, 4.6])]),
        Object.freeze([Object.freeze([2.0, 2.7, 7.3, 8.2]), Object.freeze([5.0, 6.6, 4.6, 5.6])]),
    ]),
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (lo, hi, x) => {
    const t = clamp((x - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
};
/** A number in [0, 1) from two integers. */
function hash01(a, b) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The height (m) at which the picture's top edge stands over the floor at (x, z), for an eye frame
 * (origin, forward, up, tanV): above it a thing is out of the picture.
 */
function frameTopAt(frame, x, z) {
    const {
        origin, forward: f, up: u, tanV,
    } = frame;
    const dx = x - origin.x;
    const dz = z - origin.z;
    const rise = (tanV * (f.x * dx + f.z * dz) - (u.x * dx + u.z * dz)) / Math.max(1e-6, u.y - tanV * f.y);
    return origin.y + rise;
}

/** Rotate a vector by a unit quaternion (TSL). */
function rotate(vector, quaternion) {
    const axis = quaternion.xyz;
    return vector.add(cross(axis, cross(axis, vector).add(vector.mul(quaternion.w))).mul(2));
}

/**
 * A bird: a body of rings along its length (+z the bill), a tail, two wings of two panels each. A
 * wing vertex carries (side, span 0..1, 1) in `aWing`, and the vertex stage lays it out along the
 * posed wing; a body vertex carries zeros. `colour(part, t)` paints it.
 */
function birdGeometry({
    rings, wing, tail = null, paint,
}) {
    const position = [];
    const normal = [];
    const wingData = [];
    const colour = [];
    const index = [];
    const sides = 6;
    rings.forEach(([z, rx, ry, lift], ring) => {
        for (let k = 0; k < sides; k += 1) {
            const angle = (k / sides) * TAU;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            position.push(rx * c, lift + ry * s, z);
            normal.push(c, s, 0);
            wingData.push(0, 0, 0);
            colour.push(...paint('body', ring / (rings.length - 1), s));
        }
    });
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
        for (let k = 0; k < sides; k += 1) {
            const a = ring * sides + k;
            const b = ring * sides + ((k + 1) % sides);
            index.push(a, b, a + sides, b, b + sides, a + sides);
        }
    }
    const flat = (x, y, z, part, t, wingSide = 0, span = 0) => {
        position.push(x, y, z);
        normal.push(0, 1, 0);
        wingData.push(wingSide, span, wingSide === 0 ? 0 : 1);
        colour.push(...paint(part, t, 0));
        return position.length / 3 - 1;
    };
    if (tail) {
        const [z0, z1, w0, w1, lift] = tail;
        const a = flat(-w0, lift, z0, 'tail', 0);
        const b = flat(w0, lift, z0, 'tail', 0);
        const c = flat(-w1, lift, z1, 'tail', 1);
        const d = flat(w1, lift, z1, 'tail', 1);
        index.push(a, b, c, b, d, c);
    }
    // Each wing: root, elbow, tip; a leading and a trailing edge at each (the tip may be one point).
    for (const side of [-1, 1]) {
        const stations = wing.map(([span, lead, trail], i) => [
            flat(span * side, wing.lift, lead, 'wing', i / (wing.length - 1), side, span),
            flat(span * side, wing.lift, trail, 'wing-trail', i / (wing.length - 1), side, span),
        ]);
        for (let i = 0; i < stations.length - 1; i += 1) {
            const [a, b] = stations[i];
            const [c, d] = stations[i + 1];
            index.push(a, b, c, b, d, c);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wingData, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
}

/** A goose as the grove sees it from far below: long neck, long wings, dark with a pale belly. */
function gooseGeometry() {
    const wing = [[0.07, 0.13, -0.15], [WING_ELBOW, 0.11, -0.17], [0.8, -0.02, -0.17], [1.0, -0.13, -0.16]];
    wing.lift = 0.02;
    return birdGeometry({
        rings: [[-0.44, 0.012, 0.01, 0], [-0.3, 0.07, 0.06, 0], [-0.1, 0.11, 0.1, 0], [0.1, 0.1, 0.09, 0],
            [0.24, 0.05, 0.05, 0.01], [0.46, 0.03, 0.03, 0.02], [0.54, 0.042, 0.04, 0.025], [0.64, 0.006, 0.006, 0.02]],
        wing,
        paint: (part, t, under) => {
            if (part === 'body') {
                if (t > 0.55) return [0.02, 0.018, 0.016];
                if (t < 0.18) return [0.17, 0.16, 0.15];
                return under < -0.3 ? [0.12, 0.11, 0.1] : [0.06, 0.05, 0.042];
            }
            return part === 'wing' ? [0.055, 0.046, 0.04] : [0.028, 0.025, 0.022];
        },
    });
}

/**
 * A jay: a plump pinkish-buff body, a white rump over a black tail, broad rounded wings with black
 * primaries, a white patch and the blue coverts.
 */
function jayGeometry() {
    const wing = [[0.08, 0.17, -0.13], [0.26, 0.17, -0.16], [WING_ELBOW, 0.16, -0.17], [0.62, 0.13, -0.17],
        [0.84, 0.07, -0.16], [1.0, -0.02, -0.11]];
    wing.lift = 0.03;
    return birdGeometry({
        rings: [[-0.17, 0.035, 0.03, 0.01], [-0.06, 0.1, 0.09, 0], [0.08, 0.108, 0.1, 0], [0.2, 0.078, 0.075, 0.02],
            [0.28, 0.072, 0.07, 0.035], [0.35, 0.05, 0.048, 0.035], [0.44, 0.006, 0.006, 0.03]],
        wing,
        tail: [-0.12, -0.5, 0.05, 0.085, 0.025],
        paint: (part, t) => {
            if (part === 'body') {
                if (t < 0.2) return [0.5, 0.49, 0.46];
                if (t > 0.93) return [0.04, 0.035, 0.03];
                return t > 0.62 ? [0.44, 0.27, 0.2] : [0.4, 0.25, 0.19];
            }
            if (part === 'tail') return t < 0.2 ? [0.5, 0.49, 0.46] : [0.02, 0.02, 0.022];
            // Leading edge: buff at the shoulder, the blue coverts at the elbow, black to the tip.
            if (part === 'wing') {
                if (t < 0.3) return [0.3, 0.19, 0.15];
                return t < 0.5 ? [0.05, 0.16, 0.5] : [0.02, 0.02, 0.022];
            }
            // Trailing edge: the white patch on the secondaries, black beyond.
            if (t < 0.3) return [0.16, 0.1, 0.08];
            return t < 0.5 ? [0.5, 0.49, 0.46] : [0.02, 0.02, 0.022];
        },
    });
}

/** An acorn: a nut in a cup (the cup is the upper third, by height). */
function acornGeometry() {
    const profile = [[0.0, -0.5], [0.2, -0.44], [0.33, -0.25], [0.37, 0.0], [0.34, 0.18], [0.42, 0.2], [0.4, 0.34],
        [0.26, 0.47], [0.05, 0.5], [0.03, 0.62]].map(([r, y]) => new THREE.Vector2(r, y));
    const geometry = new THREE.LatheGeometry(profile, 8);
    geometry.computeVertexNormals();
    return geometry;
}

export class FallVisitors {
    /**
     * @param {object} o
     * @param {object} o.light                 the grove's light rig
     * @param {string} [o.quality]
     * @param {(x:number,z:number)=>number} o.groundHeight
     */
    constructor({
        light, quality = 'High', groundHeight,
    }) {
        this.light = light;
        this.tier = fallWorldTier(quality);
        this.groundHeight = groundHeight;
        this.group = new THREE.Group();
        this.group.name = 'FallVisitors';
        this.owned = [];
        /** The occurrence each kind was last laid out for (a happening's slot and roll). */
        this.laid = { acorns: null };
        this.hits = [];
        this.uAcorn = uniform(new THREE.Vector2(0, 1));
        // The eye's frame, as frameOf() last read it.
        this.frame = {
            origin: new THREE.Vector3(),
            forward: new THREE.Vector3(),
            up: new THREE.Vector3(),
            right: new THREE.Vector3(),
            tanV: 0.52,
            tanH: 0.92,
            top: 0.17,
        };
        this.scratch = {
            a: new THREE.Vector3(),
            b: new THREE.Vector3(),
            c: new THREE.Vector3(),
            d: new THREE.Vector3(),
            p: new THREE.Vector3(),
            tangent: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(),
            basis: new THREE.Matrix4(),
            q: new THREE.Quaternion(),
            roll: new THREE.Quaternion(),
            axis: new THREE.Vector3(0, 0, 1),
        };
    }

    own(resource) {
        this.owned.push(resource);
        return resource;
    }

    build() {
        this.geese = this.buildBirds('FallGeese', gooseGeometry(), this.tier.geese, SKEIN.haze, SKEIN.skyDepth);
        this.jays = this.buildBirds('FallJays', jayGeometry(), this.tier.jays);
        this.buildAcorns();
        return this;
    }

    /** A flock of one kind: every bird's place, turn and wing pose are written by update(). */
    buildBirds(name, geometry, count, hazeShare = 1, skyDepth = 0) {
        const { light } = this;
        const total = Math.max(1, count);
        const place = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
        const turn = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
        const pose = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4); // inner, outer, fold, -
        for (const buffer of [place, turn, pose]) buffer.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < total; i += 1) turn.setXYZW(i, 0, 0, 0, 1);
        const at = instancedBufferAttribute(place);
        const facing = instancedBufferAttribute(turn);
        const wings = instancedBufferAttribute(pose);
        const wing = attribute('aWing', 'vec3');
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide }));
        material.name = name;
        // A wing vertex is laid along its two panels: out to the elbow at the inner angle, on to its
        // own span at the inner and outer angles together; a folded wing is drawn in to the body.
        const reach = float(1).sub(wings.z.mul(0.72));
        const inner = min(wing.y, WING_ELBOW).mul(reach);
        const outer = max(wing.y.sub(WING_ELBOW), 0).mul(reach);
        const tip = wings.x.add(wings.y);
        const spanX = inner.mul(cos(wings.x)).add(outer.mul(cos(tip))).mul(wing.x);
        const spanY = inner.mul(sin(wings.x)).add(outer.mul(sin(tip)));
        const posed = vec3(
            mix(positionGeometry.x, spanX, wing.z),
            positionGeometry.y.add(spanY.mul(wing.z)),
            positionGeometry.z.sub(wing.y.mul(wings.z).mul(wing.z).mul(0.22)),
        );
        material.positionNode = positionLocal.sub(positionGeometry).add(rotate(posed.mul(at.w), facing)).add(at.xyz);
        // Lit as the grove is: the hemisphere's light (mostly the bounce, seen from below), the low
        // sun where it reaches, a rim against it; then the grove's own air.
        const normal = normalize(varying(rotate(normalGeometry, facing)));
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const paint = attribute('color', 'vec3');
        const sun = light.sunlight();
        const rim = pow(saturate(dot(view, light.uSunDir).negate()), 3).mul(0.5);
        const lit = paint.mul(light.uSunColor).mul(saturate(dot(normal, light.uSunDir)).mul(0.9).add(rim)).mul(sun)
            .add(paint.mul(light.ambient(normal)).mul(1.7));
        // (A far flock keeps its dark against the sky: only a share of the air between.)
        material.colorNode = light.haze(lit, { world, strength: float(hazeShare) });
        // A flock in the sky is drawn at the sky's depth: the lens lays the shafts' lit air over
        // everything nearer than the dome (fall-post.js), which would wash a skein 150 m off to a
        // pale ghost. It still hides behind every tree, and nothing is behind it but the sky.
        if (skyDepth > 0) material.depthNode = viewZToPerspectiveDepth(float(-skyDepth), cameraNear, cameraFar);
        const mesh = new THREE.InstancedMesh(this.own(geometry), material, total);
        mesh.name = name;
        // (Hidden, not emptied, between happenings: every drawable keeps a count.)
        mesh.visible = false;
        // (A flock at the sky's depth is drawn after the sky dome, which would otherwise paint over it.)
        if (skyDepth > 0) mesh.renderOrder = 6;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        return {
            mesh, place, turn, pose, count,
        };
    }

    /** The acorns: where each lets go, where it lands, when, and how it tumbles (set a happening at a time). */
    buildAcorns() {
        const { light } = this;
        const count = Math.max(1, this.tier.acorns);
        const drop = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // x, floor, z, height let go from
        const fall = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4); // delay, drift x, drift z, spin
        const at = instancedBufferAttribute(drop);
        const how = instancedBufferAttribute(fall);
        const material = this.own(new THREE.MeshBasicNodeMaterial({ fog: false }));
        material.name = 'FallAcorns';
        const age = this.uAcorn.x;
        const g = ACORN.gravity;
        // Closed form: the fall, then one bounce that keeps a share of the speed, then a short roll
        // that dies away, then it lies.
        const t = max(age.sub(how.x), 0);
        const down = max(at.w.sub(at.y), 0.01);
        const landing = down.mul(2 / g).sqrt();
        const falling = min(t, landing);
        const hop = landing.mul(g * ACORN.bounce);
        const hopTime = hop.mul(2 / g);
        const after = min(max(t.sub(landing), 0), hopTime);
        const rolling = max(t.sub(landing).sub(hopTime), 0);
        const rolled = float(1).sub(exp(rolling.div(ACORN.rollSeconds).negate())).mul(ACORN.rollSeconds * ACORN.roll);
        // How far along its drift it has gone (in seconds of the drift's speed).
        const travel = after.add(rolled);
        const height = at.w.sub(falling.mul(falling).mul(g / 2)).add(hop.mul(after)).sub(after.mul(after).mul(g / 2));
        // It tumbles while it flies and turns over as it rolls; it is not there before it lets go,
        // and sinks into the litter as the happening ends.
        const turned = falling.add(after).mul(how.w).add(rolled.mul(how.w).mul(2.4));
        const axis = normalize(vec3(sin(how.w.mul(7.1)), 0.35, cos(how.w.mul(5.3))));
        const local = positionGeometry;
        const spun = local.mul(cos(turned)).add(cross(axis, local).mul(sin(turned)))
            .add(axis.mul(dot(axis, local)).mul(float(1).sub(cos(turned))));
        const there = smoothstep(0, 0.02, t).mul(float(1).sub(smoothstep(this.uAcorn.y.sub(1.2), this.uAcorn.y, age)));
        material.positionNode = positionLocal.sub(positionGeometry).add(spun.mul(ACORN.size * ACORN.over).mul(there))
            .add(vec3(
                at.x.add(how.y.mul(travel)),
                height.add(ACORN.size * ACORN.over * 0.3),
                at.z.add(how.z.mul(travel)),
            ));
        const normal = normalize(varying(normalGeometry.mul(cos(turned))
            .add(cross(axis, normalGeometry).mul(sin(turned)))
            .add(axis.mul(dot(axis, normalGeometry)).mul(float(1).sub(cos(turned))))));
        const cup = smoothstep(0.17, 0.21, positionGeometry.y);
        const albedo = mix(color(0x9a6426), color(0x3b2a17), cup);
        const world = positionWorld;
        const view = normalize(cameraPosition.sub(world));
        const gloss = pow(saturate(dot(normalize(view.add(light.uSunDir)), normal)), 26).mul(cup.oneMinus()).mul(0.5);
        const lit = albedo.mul(saturate(dot(normal, light.uSunDir)).mul(1.8).add(0.1)).add(gloss)
            .mul(light.uSunColor).mul(light.sunlight())
            .add(albedo.mul(light.ambient(normal)).mul(1.3));
        material.colorNode = light.haze(lit, { world });
        const mesh = new THREE.InstancedMesh(this.own(acornGeometry()), material, count);
        mesh.name = 'FallAcorns';
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.acorns = {
            mesh, drop, fall, count: this.tier.acorns,
        };
    }

    /**
     * Draw what is happening.
     * @param {number} time     the grove's clock (s): wing beats run on it
     * @param {{ kind: string|null, slot: number, age: number, length: number, u: number, roll: number }} happening
     * @param {object | null} stage   the eye's framing at rest (FallStage: origin, forward, up, right, tanV,
     *     tanH and the board's card): the skein, the jays' safety and the acorns' starts are fitted to it
     * @param {{ fields?: object[] } | null} [env]    the leaves' environment: an acorn's landing lifts the litter
     * @param {number} [dt]
     */
    update(time, happening, stage = null, env = null, dt = 0) {
        const kind = happening?.kind ?? null;
        this.fly(this.geese, kind === 'geese' ? this.poseSkein(time, happening, stage) : 0);
        this.fly(this.jays, kind === 'jays' ? this.poseJays(time, happening) : 0);
        const dropping = kind === 'acorns' && this.acorns.count > 0;
        this.acorns.mesh.visible = dropping;
        if (dropping) this.dropAcorns(happening, env, dt, stage);
        else this.laid.acorns = null;
    }

    /** Show `shown` birds of a flock (none: the flock is not drawn). */
    fly(flock, shown) {
        const { mesh } = flock;
        mesh.visible = shown > 0;
        if (shown > 0) {
            mesh.count = shown;
            flock.place.needsUpdate = true;
            flock.turn.needsUpdate = true;
            flock.pose.needsUpdate = true;
        }
    }

    /** One bird's place, heading and wings. `forward` must be a unit vector; `bank` rolls it about it. */
    poseBird(flock, index, position, forward, scale, innerAngle, outerAngle, fold = 0, bank = 0) {
        const s = this.scratch;
        s.right.crossVectors(s.up.set(0, 1, 0), forward);
        if (s.right.lengthSq() < 1e-8) s.right.set(1, 0, 0);
        s.right.normalize();
        s.up.crossVectors(forward, s.right).normalize();
        s.basis.makeBasis(s.right, s.up, forward);
        s.q.setFromRotationMatrix(s.basis);
        if (bank) s.q.multiply(s.roll.setFromAxisAngle(s.axis, bank));
        flock.place.setXYZW(index, position.x, position.y, position.z, scale);
        flock.turn.setXYZW(index, s.q.x, s.q.y, s.q.z, s.q.w);
        flock.pose.setXYZW(index, innerAngle, outerAngle, fold, 0);
    }

    /**
     * The eye's frame for a happening: its place, the way it looks, its up and right, and the
     * tangents of its half-angles, from the stage (the camera at rest) or, without one, the game's
     * landscape view.
     */
    frameOf(stage) {
        const f = this.frame;
        if (stage?.origin && stage.forward && stage.up && stage.right && Number.isFinite(stage.tanV)) {
            f.origin.copy(stage.origin);
            f.forward.copy(stage.forward);
            f.up.copy(stage.up);
            f.right.copy(stage.right);
            f.tanV = stage.tanV;
            f.tanH = Number.isFinite(stage.tanH) ? stage.tanH : stage.tanV * (16 / 9);
            f.top = Number.isFinite(stage.board?.y0) ? stage.board.y0 : 0.17;
        } else {
            f.origin.set(0, 2.6, 15);
            f.forward.set(0, 0.08, -1).normalize();
            f.right.set(1, 0, 0);
            f.up.crossVectors(f.right, f.forward);
            f.tanV = Math.tan(THREE.MathUtils.degToRad(27.5));
            f.tanH = f.tanV * (16 / 9);
            f.top = 0.17;
        }
        return f;
    }

    /**
     * The skein at its happening's age, laid out in the eye's frame: a V of beating wings crossing the
     * picture at a steady pace in the strip above the board card, its middle `SKEIN.band` of the
     * picture down (less when the card stands higher). It starts and ends with every goose beyond the
     * picture's edge. Returns how many geese fly.
     */
    poseSkein(time, happening, stage) {
        const { geese } = this;
        const shown = Math.min(geese.count, SKEIN.most);
        if (!shown) return 0;
        const s = this.scratch;
        const f = this.frameOf(stage);
        const d = SKEIN.depth;
        // Metres of the picture's height at the skein's depth: every size of it is a share of this.
        const tall = 2 * d * f.tanV;
        const ranks = Math.ceil((shown - 1) / 2);
        const back = SKEIN.back * tall;
        const spread = SKEIN.spread * tall;
        const scale = (SKEIN.span * tall) / 2;
        // The lane runs from beyond one edge to beyond the other by the V's length and a wing.
        const margin = (ranks * back + scale * 1.2) / (d * f.tanH) + 0.03;
        const way = happening.roll < 0.5 ? 1 : -1;
        const across = way * (happening.u * 2 - 1) * (1 + margin);
        // In the strip between the picture's top and the card and its preview, a little higher or
        // lower each time.
        const band = SKEIN.band + (((happening.roll * 7.3) % 1) - 0.5) * 0.008;
        const ndcY = 1 - band * 2;
        s.c.copy(f.origin).addScaledVector(f.forward, d).addScaledVector(f.right, across * d * f.tanH)
            .addScaledVector(f.up, ndcY * d * f.tanV);
        s.tangent.copy(f.right).multiplyScalar(way);
        // (A goose's level is the world's: flatten its heading.)
        s.tangent.y = 0;
        s.tangent.normalize();
        for (let i = 0; i < shown; i += 1) {
            const rank = Math.ceil(i / 2);
            const side = i % 2 === 0 ? 1 : -1;
            const phase = hash01(i, 17);
            // Each goose holds its station loosely.
            const slip = Math.sin(time * 0.37 + phase * 5) * 0.06 * back;
            const lift = (Math.sin(time * 0.6 + phase * 7) * 0.05 + Math.sin(time * 0.5 + phase * 9) * 0.04) * spread;
            s.p.copy(s.c).addScaledVector(s.tangent, -(rank * back + slip))
                .addScaledVector(f.up, rank * spread * side + lift);
            // The V's arms beat one after another down the line.
            const beat = time * SKEIN.beat * TAU - rank * 0.7 + phase * 0.8;
            const flap = 0.08 + Math.sin(beat) * 0.55;
            this.poseBird(geese, i, s.p, s.tangent, scale, flap, Math.sin(beat - 0.9) * 0.5);
        }
        return shown;
    }

    /**
     * The jays at their happening's age: each comes down out of a great crown from above the picture,
     * low past the perch on that side of the board and away out of the picture's side, the second a
     * little after the first on a path of its own; in bursts of wing beats (the blue shows) with the
     * wings folded between. Returns how many are drawn.
     */
    poseJays(time, happening) {
        const { jays } = this;
        const s = this.scratch;
        const flight = JAY.flights[happening.roll < 0.5 ? 0 : 1];
        let shown = 0;
        for (let i = 0; i < jays.count; i += 1) {
            const u = (happening.age - i * JAY.follow) / JAY.seconds;
            if (u > 0 && u < 1) {
                const own = hash01(happening.slot * 13 + i, 91);
                const [a, b, c, d] = flight;
                const [ox, oy, oz] = JAY.offset;
                s.a.set(a[0] + ox * i, a[1] + oy * i, a[2] + oz * i);
                s.b.set(b[0] + ox * i, b[1] + oy * i + own * 0.3, b[2] + oz * i);
                s.c.set(c[0] + ox * i, c[1] + oy * i + own * 0.3, c[2] + oz * i);
                s.d.set(d[0] + ox * i, d[1] + oy * i, d[2] + oz * i);
                const k = 1 - u;
                s.p.set(0, 0, 0).addScaledVector(s.a, k * k * k).addScaledVector(s.b, 3 * k * k * u)
                    .addScaledVector(s.c, 3 * k * u * u)
                    .addScaledVector(s.d, u * u * u);
                s.tangent.set(0, 0, 0).addScaledVector(s.a, -3 * k * k).addScaledVector(s.b, 3 * k * k - 6 * k * u)
                    .addScaledVector(s.c, 6 * k * u - 3 * u * u)
                    .addScaledVector(s.d, 3 * u * u);
                // Flap-and-fold: beats for most of each half second, the wings shut for the rest (it sinks a little).
                const cycle = ((happening.age - i * JAY.follow) / 0.52 + own) % 1;
                const fold = smooth(0.66, 0.76, cycle) * (1 - smooth(0.9, 1, cycle));
                s.p.y -= fold * 0.12;
                s.tangent.normalize();
                s.tangent.y -= fold * 0.3;
                s.tangent.normalize();
                const beat = time * JAY.beat * TAU;
                // Banked into the turn (most at its height), so the wings are seen from above.
                const bank = (happening.roll < 0.5 ? 1 : -1) * JAY.bank * Math.sin(Math.PI * u) ** 2
                    + Math.sin(u * 7 + own * 5) * 0.12;
                this.poseBird(
                    jays,
                    shown,
                    s.p,
                    s.tangent,
                    JAY.scale,
                    0.12 + Math.sin(beat) * 0.85 * (1 - fold),
                    Math.sin(beat - 0.8) * 0.6 * (1 - fold),
                    fold,
                    bank,
                );
                shown += 1;
            }
        }
        return shown;
    }

    /**
     * The acorns of one happening. Laid out once when it begins: the side of the board, where each
     * lands among the litter (most in the nearer patch), when it lets go, from just above the
     * picture's top over that place; after that the vertex stage does the falling, the bounce and the
     * roll. Each landing lifts the litter round it for a moment (a small burst in the leaves'
     * environment).
     */
    dropAcorns(happening, env, dt, stage = null) {
        const { acorns } = this;
        const key = happening.slot * 1000 + Math.round(happening.roll * 997);
        if (this.laid.acorns !== key) {
            this.laid.acorns = key;
            this.hits.length = 0;
            const f = this.frameOf(stage);
            const patches = ACORN.patches[happening.roll < 0.5 ? 0 : 1];
            for (let i = 0; i < acorns.count; i += 1) {
                const r = (n) => hash01(key + i * 31, n);
                const [x0, x1, z0, z1] = patches[r(9) < 0.62 ? 0 : 1];
                const x = x0 + (x1 - x0) * r(1);
                const z = z0 + (z1 - z0) * r(3);
                const floor = this.groundHeight(x, z);
                // Just above the picture's top there: it falls into view out of the leaves.
                const from = frameTopAt(f, x, z) + 0.5 + r(2) * 0.8;
                const delay = 0.2 + r(5) ** 0.8 * 2.4;
                // It drifts a little as it bounces and rolls (m/s), away from the board's middle.
                const away = x < 0 ? -1 : 1;
                acorns.drop.setXYZW(i, x, floor, z, from);
                acorns.fall.setXYZW(i, delay, (0.2 + r(6) * 0.6) * away, (r(7) - 0.5) * 1.1, 4 + r(8) * 7);
                this.hits.push({
                    x, y: floor, z, at: delay + Math.sqrt((2 * Math.max(0.01, from - floor)) / ACORN.gravity),
                });
            }
            acorns.drop.needsUpdate = true;
            acorns.fall.needsUpdate = true;
        }
        this.uAcorn.value.set(happening.age, happening.length);
        if (env && Array.isArray(env.fields)) {
            const window = Math.max(0.1, Number.isFinite(dt) ? dt : 0);
            for (const hit of this.hits) {
                if (happening.age >= hit.at && happening.age < hit.at + window) {
                    env.fields.push({
                        kind: 'burst', x: hit.x, y: hit.y - 0.25, z: hit.z, radius: 1.2, power: 8, up: 6,
                    });
                }
            }
        }
    }

    dispose() {
        this.group.traverse((object) => {
            if (object.isInstancedMesh) object.dispose();
        });
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.group.removeFromParent();
        this.group.clear();
    }
}
