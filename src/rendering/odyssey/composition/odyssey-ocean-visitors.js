/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * THE OCEAN'S VISITORS — a manta and a whale shark in the deep half of the ascent (Act I
 * overhaul, 2026-10-20).
 *
 * The whale pass swims near the top of the column (42 u under the surface), so the deep half of
 * chapter 2 — the vent to ~100 u down, a third of the act — had fish specks and nothing that made
 * you look up. Two visitors now share it, each on a clock-only loop round the ascent so a camera
 * parked at an orb still sees them pass:
 *   - a WHALE SHARK in the deepest stretch, long and slow, the scale beat right after the vent;
 *   - a MANTA higher up, gliding loops overhead and banking through Snell's window — the
 *     silhouette against the light that underwater film is made of.
 * Each keeps a height a little above the eye (a damped follow with a capped climb rate, so when
 * the camera pans between orbs the animal swims up after it rather than riding it).
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
 * The cast. `size` is world units (a ray across its wings, a fish nose to tail); `window` the
 * eye heights (world y) it keeps you company between — it swims in from the blue as the eye
 * reaches the bottom and dives away as the eye nears the top (VISITOR_PASSAGE); `above` how far
 * over the eye it keeps; `loop` its path round the axis (radius, wobble, period s, phase);
 * `stroke` seconds per beat at full size.
 */
export const OCEAN_VISITOR_CAST = Object.freeze([
    Object.freeze({
        name: 'whaleShark',
        size: 46,
        // Top at 236, not 196: the player parks at L6/L7 with the eye at ~170 and the window's top
        // was 18 u on, so the shark turned and dived three seconds after arriving. It now keeps
        // company up past L9 (eye ~207) and leaves on the way to L10.
        window: [116, 236],
        above: 62,
        loop: Object.freeze({
            radius: 30, wobble: 9, period: 64, phase: 0.6, lift: 7,
        }),
        stroke: 4.4,
        // ray = false: the fish stroke (side to side)
        ray: false,
    }),
    Object.freeze({
        name: 'manta',
        size: 24,
        window: [150, 252],
        above: 44,
        loop: Object.freeze({
            radius: 24, wobble: 10, period: 38, phase: 2.4, lift: 6,
        }),
        stroke: 3.4,
        ray: true,
    }),
]);

/** How fast a visitor may climb after the eye (u/s) — it swims up, it is not carried. */
const CLIMB_RATE = 16;

/**
 * THE WAY IN AND THE WAY OUT (2026-10-20, in-game feedback: the animals "just pop up" coming
 * from chapter 1, and dissolved in plain view when their stretch ended).
 *
 * A visitor used to be switched on by progress: its window opened on the eye's height, and the
 * glide from orb 5 to orb 6 crossed the whole fade in a second with the animal already in frame
 * 65 u away. Now it ARRIVES: once the water and its window allow it, it spirals in from
 * `reach` beyond its loop, through the blue, over `approachS` seconds on the clock — met in the
 * haze, not switched on. And it LEAVES by diving: when its window closes (or the water ends) it
 * swims outward and down over `departS` seconds, under the eye, which looks up, so it is out of
 * frame before its last stretch fades (odyssey-act1-fade-out-of-view.test.js).
 */
export const VISITOR_PASSAGE = Object.freeze({
    approachS: 9,
    departS: 7,
    reach: 170,
    dive: 150,
    /** It starts leaving this far (eye height) before its window's top. */
    departMargin: 18,
    /** A short alpha ramp on the first frames, so a compile landing mid-ocean never pops. */
    rampS: 0.6,
});

const smooth = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - (2 * t));
};

/**
 * One step of a visitor's passage: away -> in (approaching, then on its loop) -> out (diving
 * away) -> gone (until the eye is back under its window; at once when the water ends). Pure,
 * three-free: mutates `state`
 * ({phase, approach, depart}) and returns what to add to the loop position (`radial` outward from
 * the axis, `up`) and the alpha.
 * @param {{ phase?: string, approach?: number, depart?: number }} state
 * @param {{ camY: number, on: boolean, dt: number, window: readonly number[] }} input
 */
export function stepVisitorPassage(state, {
    camY, on, dt, window,
}) {
    const P = VISITOR_PASSAGE;
    const [lo, hi] = window;
    const step = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    if (!state.phase) Object.assign(state, { phase: 'away', approach: 0, depart: 0 });
    if (state.phase === 'away' && on && camY >= lo && camY < hi - P.departMargin) {
        state.phase = 'in';
        state.approach = 0;
    }
    // The water ending (the breach, the chapter's edge) is not a cue to dive: nothing to see.
    if (!on && (state.phase === 'in' || state.phase === 'out')) state.phase = 'gone';
    if (state.phase === 'in') {
        state.approach = Math.min(1, state.approach + (step / P.approachS));
        if (camY >= hi - P.departMargin) {
            state.phase = 'out';
            state.depart = 0;
        }
    }
    if (state.phase === 'out') {
        state.depart = Math.min(1, state.depart + (step / P.departS));
        if (state.depart >= 1) state.phase = 'gone';
    }
    if (state.phase === 'gone' && camY < lo) state.phase = 'away';
    if (state.phase === 'in') {
        const k = 1 - smooth(state.approach);
        return {
            radial: P.reach * k, up: 0, alpha: Math.min(1, (state.approach * P.approachS) / P.rampS), shown: true,
        };
    }
    if (state.phase === 'out') {
        const k = smooth(state.depart);
        const alpha = 1 - smooth((state.depart - 0.75) / 0.25);
        return {
            radial: P.reach * k, up: -P.dive * k, alpha, shown: alpha > 0.01,
        };
    }
    return {
        radial: 0, up: 0, alpha: 0, shown: false,
    };
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
 * @param {{x:number, z:number}} opts.axis world XZ of the ascent column
 * @param {number} opts.seaLevel world Y of the sea surface
 * @param {THREE.Color} opts.shallowColour water near the surface
 * @param {THREE.Color} opts.deepColour water in the abyss
 * @param {string} [opts.url]
 */
export function createOceanVisitors({
    axis, seaLevel, shallowColour, deepColour, url = OCEAN_VISITORS_URL,
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

    const pathAt = (cast, t, out) => {
        const { loop } = cast;
        const a = ((t / loop.period) * Math.PI * 2) + loop.phase;
        const r = loop.radius + (Math.sin((a * 2) + (loop.phase * 3)) * loop.wobble);
        out.set(
            axis.x + (Math.cos(a) * r),
            Math.sin((a * 1.5) + loop.phase) * loop.lift,
            axis.z + (Math.sin(a) * r),
        );
        return out;
    };

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
                if (!body) return;
                const mesh = new THREE.Mesh(body.geometry, material);
                mesh.name = `odyssey-visitor-${cast.name}`;
                mesh.frustumCulled = false;
                mesh.scale.setScalar(cast.size);
                mesh.visible = false;
                group.add(mesh);
                actors.push({
                    cast,
                    mesh,
                    phase: cast.loop.phase,
                    beatPhase: cast.loop.phase,
                    y: null,
                    fade: 0,
                    passage: {},
                    p0: new THREE.Vector3(),
                    p1: new THREE.Vector3(),
                    p2: new THREE.Vector3(),
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
         */
        update(time, delta, camera, submerged, inChapter, presence = 1) {
            const camY = camera?.position?.y ?? seaLevel;
            const life = Number.isFinite(presence) ? Math.min(Math.max(presence, 0), 1) : 1;
            const dt = Math.min(Math.max(Number.isFinite(delta) ? delta : 0, 0), 0.1);
            const on = ready && inChapter && submerged > 0.5 && life > 0.001;
            let any = false;
            const depth = seaLevel - camY;
            const t01 = THREE.MathUtils.clamp((depth - 20) / 220, 0, 1);
            uWater.value.copy(scratch.copy(shallowColour).lerp(deepColour, t01))
                .multiplyScalar(odysseyDeepWaterDim(depth / 140));
            uSurface.value = 0.35 + (0.65 * (1 - THREE.MathUtils.clamp(depth / 200, 0, 1)));
            actors.forEach((actor) => {
                const { cast, mesh } = actor;
                // Its passage: in from the blue, round its loop, out by a dive (stepVisitorPassage).
                const passage = stepVisitorPassage(actor.passage, {
                    camY, on, dt, window: cast.window,
                });
                actor.fade = passage.alpha * life;
                mesh.userData.fade = actor.fade;
                mesh.userData.passage = actor.passage.phase;
                mesh.visible = passage.shown && actor.fade > 0.01;
                if (!mesh.visible) { actor.y = null; return; }
                any = true;
                // A damped follow of the eye's height with a capped climb: it swims up after you.
                const wantY = camY + cast.above;
                if (actor.y === null) actor.y = wantY;
                const step = THREE.MathUtils.clamp((wantY - actor.y) * Math.min(1, dt * 1.1), -CLIMB_RATE * dt, CLIMB_RATE * dt);
                actor.y += step;
                // Stroke phase integrated on the CPU (never clock x a changing rate); mantas glide.
                actor.beatPhase += dt * 0.21;
                const beat = cast.ray ? 0.35 + (0.65 * (0.5 + (0.5 * Math.sin(actor.beatPhase)))) : 0.85;
                actor.phase += (dt * Math.PI * 2 * (0.6 + (0.4 * beat))) / cast.stroke;
                mesh.userData.swimPhase = actor.phase;
                mesh.userData.swimBeat = beat;
                // Heading and bank from three points of its path (orientation from WORLD up).
                pathAt(cast, time - 0.5, actor.p0);
                pathAt(cast, time, actor.p1);
                pathAt(cast, time + 0.5, actor.p2);
                vF.subVectors(actor.p2, actor.p0);
                vF.y += step * 2; // climbing after the eye tilts the nose up a little
                if (vF.lengthSq() < 1e-8) vF.set(0, 0, 1);
                vF.normalize();
                vS.crossVectors(up, vF).normalize();
                vU.crossVectors(vF, vS).normalize();
                // Turn: how much the heading swings toward its side per second.
                const d1x = actor.p1.x - actor.p0.x;
                const d1z = actor.p1.z - actor.p0.z;
                const d2x = actor.p2.x - actor.p1.x;
                const d2z = actor.p2.z - actor.p1.z;
                const turn = Math.atan2((d1x * d2z) - (d1z * d2x), (d1x * d2x) + (d1z * d2z));
                const bank = THREE.MathUtils.clamp(turn * (cast.ray ? 6.0 : 2.5), -0.7, 0.7);
                // Bank: the up vector leans toward the inside of the turn.
                vU.multiplyScalar(Math.cos(bank)).addScaledVector(vS, -Math.sin(bank)).normalize();
                vS.crossVectors(vU, vF).normalize();
                basis.makeBasis(vS, vU, vF);
                mesh.quaternion.setFromRotationMatrix(basis);
                // The passage's offset: outward from the axis (the way it came, the way it goes)
                // and, leaving, down under the eye.
                const rx = actor.p1.x - axis.x;
                const rz = actor.p1.z - axis.z;
                const rl = Math.hypot(rx, rz) || 1;
                mesh.position.set(
                    actor.p1.x + ((rx / rl) * passage.radial),
                    actor.y + actor.p1.y + passage.up,
                    actor.p1.z + ((rz / rl) * passage.radial),
                );
                mesh.userData.swimTurn = THREE.MathUtils.clamp(turn * 4, -0.6, 0.6);
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
