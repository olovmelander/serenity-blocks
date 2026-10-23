/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE OCEAN'S VISITORS — a whale shark and a manta on the ascent (Act I overhaul, 2026-10-20).
 *
 * Chapter 2 had fish specks and nothing that made you look up but the whales. Two visitors join
 * them, each on a clock-only loop so a camera parked at an orb still sees them pass:
 *   - a WHALE SHARK in the deep stretch, long and slow, the scale beat right after the vent;
 *   - a MANTA at the top of the climb, gliding loops just under the bright surface ahead and
 *     banking through Snell's window — the silhouette against the light that underwater film is
 *     made of.
 *
 * ONE ENCOUNTER PER STRETCH (2026-10-22). Olov: the big fishes and sea creatures in chapter 2 "do
 * not work good". Measured in the live journey: every animal circled the rail itself at 20-32 u,
 * the visitors followed the eye 44-62 u above it, and their stretches overlapped, so at orbs 8-9
 * the whale shark, the manta and both whales crowded one frame 40-75 u from the eye, over each
 * other and the orb, and the calf read as a small shark beside the nearer manta. Now each animal
 * has ONE place in the sea (a loop centre over its own orb and a fixed depth, scored on the real
 * camera so it is in frame most of a lap and never over the orb) and its own stretch of the climb
 * (eye-height windows that do not overlap), keyed to where the journey parks the eye: the whale
 * shark over orbs 6-8, the whales over orb 9 (odyssey-whale-pass.js), the manta under the bright
 * surface ahead of orb 10. It arrives and leaves by swimming, whichever way the eye goes.
 *
 * The bodies are the Ocean theme's (built in Blender from numbers), copied into Odyssey's own
 * asset by scripts/odyssey-extract-ocean-visitors.mjs — themes are islands; this file parses that
 * copy with its own reader and swims it with a contained port of the theme's ray and fish strokes
 * (src/themes/ocean/ocean-giants.js), lit as the deep sees it: the belly in shadow against the
 * bright surface, the light wrapping the wing edges, the water between it and the eye over it.
 *
 * ZERO-HITCH CONTRACT (ADR-0020; the whale pass's): nothing touches the GPU until the board says
 * so. `load()` only fetches and parses; the board compiles the group through its live-loop path
 * and only then calls `markReady()`. Until ready the group stays hidden. Any failure leaves the
 * ocean exactly as it was. BISECT LEVER: ?odysseyNoVisitors=1 (board).
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    cos,
    dot,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    modelWorldMatrix,
    normalize,
    oneMinus,
    pow,
    positionGeometry,
    positionWorld,
    round,
    select,
    sin,
    smoothstep,
    uniform,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { odysseyDeepWaterDim } from '../odyssey-colour-script.js';
import { hash21 } from '../chapter-environments/shared/odyssey-tsl-noise.js';
import {
    OCEAN_ESCORT,
    OCEAN_ESCORT_MOTION,
    escortArrivalOut,
    escortHeading,
    escortLoop,
    escortLoopScale,
    resolveEscortTarget,
    stepEscortAnchor,
} from './odyssey-ocean-escort.js';

export const OCEAN_VISITORS_URL = new URL('../assets/chapter-02/visitors/ocean-visitors.glb', import.meta.url).href;

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const COMPONENTS = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const WIDTH = {
    SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4,
};
const UNIT = {
    5120: (q) => Math.max(q / 127, -1),
    5121: (q) => q / 255,
    5122: (q) => Math.max(q / 32767, -1),
    5123: (q) => q / 65535,
};

function readAccessor(doc, bin, index) {
    const acc = doc.accessors[index];
    const view = doc.bufferViews[acc.bufferView];
    const Type = COMPONENTS[acc.componentType];
    const width = WIDTH[acc.type];
    const bytes = Type.BYTES_PER_ELEMENT;
    const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || width * bytes;
    const out = new Type(acc.count * width);
    const data = new DataView(bin.buffer, bin.byteOffset + offset);
    const get = {
        1: (o) => (Type === Int8Array ? data.getInt8(o) : data.getUint8(o)),
        2: (o) => (Type === Int16Array ? data.getInt16(o, true) : data.getUint16(o, true)),
        4: (o) => (Type === Float32Array ? data.getFloat32(o, true) : data.getUint32(o, true)),
    }[bytes];
    for (let i = 0; i < acc.count; i += 1) {
        for (let c = 0; c < width; c += 1) out[(i * width) + c] = get((i * stride) + (c * bytes));
    }
    return {
        array: out, width, normalized: acc.normalized === true, componentType: acc.componentType,
    };
}

function toFloats({
    array, width, normalized, componentType,
}, scale = null, offset = null) {
    const out = new Float32Array(array.length);
    const decode = normalized ? UNIT[componentType] : null;
    for (let i = 0; i < array.length; i += 1) {
        const c = i % width;
        let v = decode ? decode(array[i]) : array[i];
        if (scale) v *= scale[c];
        if (offset) v += offset[c];
        out[i] = v;
    }
    return out;
}

/**
 * Parse the visitors' GLB (the Ocean pack's layout). Each animal is one unit long (a ray: one
 * unit across its wings), nose along +z, back +y.
 * @param {ArrayBuffer|Uint8Array} source
 * @returns {Record<string, { geometry: THREE.BufferGeometry, kind: number }>}
 */
export function parseOceanVisitors(source) {
    const u8 = source instanceof Uint8Array ? source : new Uint8Array(source);
    const head = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (head.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
    let at = 12;
    let doc = null;
    let bin = null;
    while (at + 8 <= u8.byteLength) {
        const chunkLength = head.getUint32(at, true);
        const type = head.getUint32(at + 4, true);
        const body = u8.subarray(at + 8, at + 8 + chunkLength);
        if (type === CHUNK_JSON) doc = JSON.parse(new TextDecoder().decode(body));
        else if (type === CHUNK_BIN) bin = body;
        at += 8 + chunkLength;
    }
    if (!doc || !bin || !doc.scenes?.[0]?.extras?.oceanCreatures) throw new Error('not the ocean visitors pack');
    const kinds = {};
    doc.nodes.forEach((node) => {
        if (node.mesh === undefined) return;
        const prim = doc.meshes[node.mesh].primitives[0];
        const read = (name) => readAccessor(doc, bin, prim.attributes[name]);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(
            toFloats(read('POSITION'), node.scale || [1, 1, 1], node.translation || [0, 0, 0]),
            3,
        ));
        geometry.setAttribute('normal', new THREE.BufferAttribute(toFloats(read('NORMAL')), 3));
        geometry.setAttribute('aShape', new THREE.BufferAttribute(read('_SHAPE').array, 4, true));
        geometry.setAttribute('aSkin', new THREE.BufferAttribute(read('_SKIN').array, 4, true));
        geometry.setAttribute('aPivot', new THREE.BufferAttribute(read('_PIVOT').array, 4, true));
        geometry.setIndex(new THREE.BufferAttribute(readAccessor(doc, bin, prim.indices).array, 1));
        geometry.computeBoundingSphere();
        geometry.name = `OdysseyVisitor:${node.name}`;
        kinds[node.name] = { geometry, kind: node.extras?.kind ?? 0 };
    });
    return kinds;
}

/**
 * The cast. `size` is world units (a ray across its wings, a fish nose to tail); `stroke` seconds
 * per beat at full size; `ray` the manta's wing stroke (else the fish stroke); `bankMax` how far it
 * leans into a turn (rad). Where each swims is its escort slot (odyssey-ocean-escort.js).
 */
export const OCEAN_VISITOR_CAST = Object.freeze([
    Object.freeze({
        name: 'whaleShark',
        size: 46,
        stroke: 4.4,
        ray: false,
        bankMax: 0.5,
    }),
    Object.freeze({
        name: 'manta',
        size: 24,
        stroke: 3.4,
        ray: true,
        // Its wingtips stay under the surface when it swims just beneath it.
        bankMax: 0.3,
    }),
]);

const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

const _target = { x: 0, y: 0, z: 0 };
const _loop = { x: 0, y: 0, z: 0 };
const _loopVelocity = { x: 0, y: 0, z: 0 };

/**
 * One escorting animal's place this frame (shared by the visitors and the whale pair): its anchor
 * swims after its slot in the formation's view, it arrives from the blue the first time it can be
 * seen (or after a jump), and it swims its loop round the anchor. Writes `out` (world position) and
 * `velocity`; returns its fade (0..1, the arrival's).
 * @param {{ pos?: object|null, vel?: object, arrive?: number }} state
 * @param {import('./odyssey-ocean-escort.js').EscortView} view the formation's view (stepEscortFrame)
 * @param {object} slot OCEAN_ESCORT[...]
 * @param {number} seaLevel
 * @param {number} time seconds
 * @param {number} dt seconds
 * @param {THREE.Vector3} out
 * @param {THREE.Vector3} velocity
 * @param {object} [loop] its loop (default the slot's)
 * @param {number} [lift] world units it rides above the anchor
 * @returns {number} fade
 */
export function placeEscorted(state, view, slot, seaLevel, time, dt, out, velocity, loop = slot.loop, lift = 0) {
    const target = resolveEscortTarget(view, slot, seaLevel, _target);
    if (stepEscortAnchor(state, target, dt)) state.arrive = 0;
    state.arrive = Math.min(1, (state.arrive ?? 0) + (dt / OCEAN_ESCORT_MOTION.arriveS));
    const k = escortLoopScale(view.position, target, slot);
    escortLoop(loop, time, _loop, _loopVelocity);
    // Arriving, it swims in along the eye's line of sight from `reach` times as far.
    const outFactor = escortArrivalOut(state.arrive) * (OCEAN_ESCORT_MOTION.reach - 1);
    const eye = view.position;
    out.set(
        state.pos.x + (_loop.x * k) + ((state.pos.x - eye.x) * outFactor),
        state.pos.y + ((_loop.y + lift) * k) + ((state.pos.y - eye.y) * outFactor),
        state.pos.z + (_loop.z * k) + ((state.pos.z - eye.z) * outFactor),
    );
    velocity.set(
        state.vel.x + (_loopVelocity.x * k),
        state.vel.y + (_loopVelocity.y * k),
        state.vel.z + (_loopVelocity.z * k),
    );
    return smooth(state.arrive);
}

/**
 * Per kind, from the theme's tables (ocean-giants.js SWIM / SKINS): stroke shape and colours.
 *   swim  (amplitude, wavenumber, chord / unused, recoil)
 *   skin  back, belly (w: where the line falls on the rest normal's y), accent A, accent B
 */
const KIND_LOOK = {
    whaleShark: {
        swim: [0.075, 5.2, 0, 0.18],
        back: [0.05, 0.075, 0.105],
        belly: [0.56, 0.58, 0.58, -0.35],
        a: [0.008, 0.009, 0.011],
        b: [0.025, 0.032, 0.04],
    },
    manta: {
        swim: [0.15, 1.3, 2.4, 0.12],
        back: [0.011, 0.012, 0.016],
        belly: [0.68, 0.70, 0.70, -0.05],
        a: [0.60, 0.62, 0.63],
        b: [0.04, 0.04, 0.05],
    },
};

const rotY = (v, a) => {
    const c = cos(a).toVar();
    const s = sin(a).toVar();
    return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
};

/**
 * One material for both kinds (one pipeline): the stroke and the paint branch on the kind each
 * vertex carries (constant over a draw, so the branch is coherent); the per-animal phase, beat and
 * turn come from the object's userData through per-object uniforms.
 */
function createVisitorMaterial(uWater, uSurface) {
    const uPhase = uniform(0).onObjectUpdate(({ object }) => object.userData.swimPhase ?? 0);
    const uBeat = uniform(1).onObjectUpdate(({ object }) => object.userData.swimBeat ?? 1);
    const uTurn = uniform(0).onObjectUpdate(({ object }) => object.userData.swimTurn ?? 0);
    const uFade = uniform(0).onObjectUpdate(({ object }) => object.userData.fade ?? 0);
    const mt = KIND_LOOK.manta;
    const ws = KIND_LOOK.whaleShark;

    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'OdysseyOceanVisitors';
    const aShape = attribute('aShape', 'vec4');
    const vNormalW = varying(vec3(0.0, 1.0, 0.0), 'vVisitorN');
    const isRay = aShape.w.mul(255.0).greaterThan(4.5); // pack kinds: whaleShark 3, manta 5

    material.positionNode = Fn(() => {
        const s = aShape.x;
        const code = round(aShape.y.mul(255.0));
        const part = floor(code.div(3.0).add(0.01));
        const isPart = (n) => oneMinus(smoothstep(0.0, 0.5, abs(part.sub(n))));
        const local = positionGeometry.toVar();
        const nrm = attribute('normal', 'vec3').toVar();
        const phase = uPhase;
        const beat = uBeat;
        If(isRay, () => {
            // ── The manta's wings fly: a wave runs out along each wing and back across its chord ──
            const span = clamp(abs(local.x).div(0.5), 0.0, 1.0);
            const wing = pow(smoothstep(0.12, 1.0, span), 1.25);
            const chord = float(0.2).sub(local.z);
            const amp = float(mt.swim[0]).mul(beat);
            const y0 = wing.mul(amp).mul(sin(phase.sub(span.mul(mt.swim[1])).sub(chord.mul(mt.swim[2]))));
            const sp1 = clamp(abs(local.x.add(0.01)).div(0.5), 0.0, 1.0);
            const y1 = pow(smoothstep(0.12, 1.0, sp1), 1.25).mul(amp)
                .mul(sin(phase.sub(sp1.mul(mt.swim[1])).sub(chord.mul(mt.swim[2]))));
            const fx = y1.sub(y0).div(0.01);
            const heave = float(mt.swim[3]).mul(amp).negate().mul(sin(phase));
            const sgn = select(local.x.greaterThanEqual(0.0), float(1.0), float(-1.0));
            const tuck = sgn.mul(y0.mul(y0)).div(max(abs(positionGeometry.x), 0.06)).mul(0.5);
            const whip = sin(phase.mul(1.3).sub(s.mul(7.0))).mul(0.04).mul(beat).mul(smoothstep(0.45, 1.0, s))
                .mul(isPart(2));
            local.addAssign(vec3(whip.sub(tuck), y0.add(heave), 0.0));
            nrm.assign(normalize(vec3(nrm.x.sub(fx.mul(nrm.y)), nrm.y, nrm.z)));
        }).Else(() => {
            // ── The whale shark: the body wave side to side, growing toward the tail ──
            const amp = float(ws.swim[0]).mul(beat.mul(0.6).add(0.4));
            const wave = (x) => {
                const env = pow(clamp(x.sub(0.12).div(0.88), 0.0, 1.0), 1.6)
                    .sub(oneMinus(smoothstep(0.0, 0.35, x)).mul(ws.swim[3]));
                return env.mul(amp).mul(sin(phase.sub(x.mul(ws.swim[1]))));
            };
            const h = wave(s);
            const h2 = wave(s.add(0.01));
            local.addAssign(vec3(h, 0.0, 0.0));
            nrm.assign(rotY(nrm, atan(h2.sub(h).div(0.01)).negate()));
        });
        // Every body bends into its turn (nose and tail toward the inside of it).
        const bend = s.sub(0.4);
        local.subAssign(vec3(uTurn.mul(0.5).mul(bend).mul(bend), 0.0, 0.0));
        nrm.assign(rotY(nrm, atan(uTurn.mul(bend))));
        vNormalW.assign(normalize(modelWorldMatrix.mul(vec4(nrm, 0.0)).xyz));
        return local;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormalW).toVar();
        const restUp = attribute('normal', 'vec3').y;
        const skin = attribute('aSkin', 'vec4');
        const rp = positionGeometry;
        const toEye = cameraPosition.sub(positionWorld);
        const dist = length(toEye);
        const V = toEye.div(max(dist, 1e-3));
        const albedo = vec3(0.0).toVar();
        If(isRay, () => {
            const shade = smoothstep(mt.belly[3] - 0.28, mt.belly[3] + 0.28, restUp);
            albedo.assign(mix(vec3(...mt.belly.slice(0, 3)), vec3(...mt.back), shade));
            // White shoulders on the black back; gill slits and a few dark spots on the belly.
            albedo.assign(mix(albedo, vec3(...mt.a), skin.y));
            const slits = smoothstep(0.35, 0.5, sin(rp.z.mul(260.0)).mul(0.5).add(0.5));
            albedo.assign(mix(albedo, vec3(...mt.b), skin.z.mul(slits)));
        }).Else(() => {
            const shade = smoothstep(ws.belly[3] - 0.28, ws.belly[3] + 0.28, restUp);
            albedo.assign(mix(vec3(...ws.belly.slice(0, 3)), vec3(...ws.back), shade));
            // Rows of pale spots on the dark back (a jittered grid round and along the body).
            const around = atan(rp.x, rp.y);
            const st = vec2(rp.z.mul(46.0), around.mul(6.5));
            const cell = floor(st);
            const f = fract(st);
            const jitter = vec2(hash21(cell), hash21(cell.add(17.3)));
            const spot = oneMinus(smoothstep(0.17, 0.24, length(f.sub(jitter.mul(0.6).add(0.2)))));
            albedo.assign(mix(albedo, vec3(...ws.belly.slice(0, 3)).mul(0.9), spot.mul(shade).mul(0.85)));
            albedo.assign(mix(albedo, vec3(...ws.a), skin.y));
        });
        // The eye.
        albedo.assign(mix(albedo, vec3(0.006, 0.006, 0.008), skin.w));
        const ao = skin.x.mul(0.7).add(0.3);
        // THE DEEP'S LIGHT: from above (the surface) and scattered round. The belly the climb sees
        // is in the animal's own shadow; the light wraps its edges where they turn up to the sky.
        const fromAbove = clamp(N.y, 0.0, 1.0);
        const facing = clamp(abs(dot(N, V)), 0.0, 1.0);
        const rim = pow(oneMinus(facing), 2.4);
        const ambient = uWater.mul(1.7);
        const top = vec3(0.30, 0.70, 0.74).mul(uSurface);
        const lit = albedo.mul(ambient.add(top.mul(fromAbove.mul(0.8).add(0.12)))).mul(ao)
            .add(vec3(0.42, 0.78, 0.84).mul(rim).mul(clamp(N.y.add(0.6), 0.0, 1.0)).mul(uSurface)
                .mul(0.38));
        // The water between it and the eye, and the fade-in from the blue.
        const haze = smoothstep(26.0, 300.0, dist).mul(0.86);
        return mix(lit, uWater, max(haze, oneMinus(uFade)));
    })();
    material.side = THREE.FrontSide;
    material.depthWrite = true;
    // Its own colour-with-distance: scene fog is the chapter-profile lerp (the repo's fog trap).
    material.fog = false;
    return material;
}

/**
 * @param {object} opts
 * @param {number} opts.seaLevel world Y of the sea surface
 * @param {THREE.Color} opts.shallowColour water near the surface
 * @param {THREE.Color} opts.deepColour water in the abyss
 * @param {string} [opts.url]
 */
export function createOceanVisitors({
    seaLevel, shallowColour, deepColour, url = OCEAN_VISITORS_URL,
}) {
    const group = new THREE.Group();
    group.name = 'odyssey-ocean-visitors';
    group.visible = false;
    const uWater = uniform(new THREE.Color().copy(shallowColour));
    const uSurface = uniform(0.5);
    const material = createVisitorMaterial(uWater, uSurface);
    const actors = [];
    let ready = false;
    let loaded = false;
    const scratch = new THREE.Color();
    const basis = new THREE.Matrix4();
    const vF = new THREE.Vector3();
    const vS = new THREE.Vector3();
    const vU = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const velocity = new THREE.Vector3();

    return {
        group,
        /** Fetch + parse only; no GPU work. */
        async load() {
            if (loaded) return true;
            if (typeof fetch !== 'function') return false;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const kinds = parseOceanVisitors(await response.arrayBuffer());
            OCEAN_VISITOR_CAST.forEach((cast) => {
                const body = kinds[cast.name];
                const slot = OCEAN_ESCORT[cast.name];
                if (!body || !slot) return;
                const mesh = new THREE.Mesh(body.geometry, material);
                mesh.name = `odyssey-visitor-${cast.name}`;
                mesh.frustumCulled = false;
                mesh.scale.setScalar(cast.size);
                mesh.visible = false;
                group.add(mesh);
                actors.push({
                    cast,
                    slot,
                    mesh,
                    phase: slot.loop.phase,
                    beatPhase: slot.loop.phase,
                    fade: 0,
                    escort: {},
                    heading: null,
                    turn: 0,
                });
            });
            loaded = actors.length > 0;
            return loaded;
        },
        /** The board calls this after its live-loop compile landed; only then may it draw. */
        markReady() { ready = loaded; },
        get isLoaded() { return loaded; },
        get isReady() { return ready; },
        /**
         * @param {number} time seconds
         * @param {number} delta seconds
         * @param {THREE.Camera} camera
         * @param {number} submerged 0..1
         * @param {boolean} inChapter
         * @param {number} [presence] ocean-life presence from the world's 1->2 carry
         * @param {import('./odyssey-ocean-escort.js').EscortView|null} [view] the escort formation's
         *   view (the board: stepEscortFrame over the rail camera); none, nothing is drawn
         */
        update(time, delta, camera, submerged, inChapter, presence = 1, view = null) {
            const camY = camera?.position?.y ?? seaLevel;
            const life = Number.isFinite(presence) ? Math.min(Math.max(presence, 0), 1) : 1;
            const dt = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 0.1);
            const on = ready && !!view && inChapter && submerged > 0.5 && life > 0.001;
            let any = false;
            const depth = seaLevel - camY;
            const t01 = THREE.MathUtils.clamp((depth - 20) / 220, 0, 1);
            uWater.value.copy(scratch.copy(shallowColour).lerp(deepColour, t01))
                .multiplyScalar(odysseyDeepWaterDim(depth / 140));
            uSurface.value = 0.35 + (0.65 * (1 - THREE.MathUtils.clamp(depth / 200, 0, 1)));
            actors.forEach((actor) => {
                const { cast, slot, mesh } = actor;
                if (!on) {
                    // Out of the water (or the chapter): it arrives afresh next time.
                    actor.escort = {};
                    actor.heading = null;
                    mesh.visible = false;
                    return;
                }
                // Its place in the escort: after its slot, arriving from the blue, round its loop.
                const arrived = placeEscorted(actor.escort, view, slot, seaLevel, time, dt, mesh.position, velocity);
                actor.fade = arrived * life;
                mesh.userData.fade = actor.fade;
                mesh.visible = actor.fade > 0.01;
                if (!mesh.visible) return;
                any = true;
                // Stroke phase integrated on the CPU (never clock x a changing rate); mantas glide.
                actor.beatPhase += dt * 0.21;
                const beat = cast.ray ? 0.35 + (0.65 * (0.5 + (0.5 * Math.sin(actor.beatPhase)))) : 0.85;
                actor.phase += (dt * Math.PI * 2 * (0.6 + (0.4 * beat))) / cast.stroke;
                mesh.userData.swimPhase = actor.phase;
                mesh.userData.swimBeat = beat;
                // Heading from its velocity, mostly level (orientation from WORLD up).
                escortHeading(velocity, vF, actor.heading || { x: 0, y: 0, z: 1 });
                vF.normalize();
                // Turn: how fast the heading swings toward its side (per half second), eased.
                if (actor.heading && dt > 0) {
                    const cross = (actor.heading.x * vF.z) - (actor.heading.z * vF.x);
                    const dotH = (actor.heading.x * vF.x) + (actor.heading.z * vF.z);
                    const rate = (Math.atan2(cross, dotH) / dt) * 0.5;
                    actor.turn += (rate - actor.turn) * (1 - Math.exp(-dt * 3));
                }
                actor.heading = { x: vF.x, y: vF.y, z: vF.z };
                vS.crossVectors(up, vF).normalize();
                vU.crossVectors(vF, vS).normalize();
                const bankMax = cast.bankMax ?? 0.7;
                const bank = THREE.MathUtils.clamp(actor.turn * (cast.ray ? 6.0 : 2.5), -bankMax, bankMax);
                // Bank: the up vector leans toward the inside of the turn.
                vU.multiplyScalar(Math.cos(bank)).addScaledVector(vS, -Math.sin(bank)).normalize();
                vS.crossVectors(vU, vF).normalize();
                basis.makeBasis(vS, vU, vF);
                mesh.quaternion.setFromRotationMatrix(basis);
                mesh.userData.swimTurn = THREE.MathUtils.clamp(actor.turn * 4, -0.6, 0.6);
            });
            group.visible = any;
        },
        dispose() {
            material.dispose();
            actors.forEach((a) => a.mesh.geometry.dispose());
            group.removeFromParent();
        },
    };
}
