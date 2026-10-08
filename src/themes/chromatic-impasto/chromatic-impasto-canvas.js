/**
 * Chromatic Impasto — the paint on the GPU.
 *
 * Two half-float targets hold the painting:
 *
 *   pigment  rgb = the colour of the paint on top, a = how wet it is (1 = just laid)
 *   relief   r = how thick the paint stands, g = what it is made of (> 0 gold leaf, < 0
 *            fluorescent), a = scratch (the blend's own alpha)
 *
 * A stroke is not simulated; it is DRAWN into both, once: the painter hands over the piece of
 * ribbon its brush covered this frame (chromatic-impasto-strokes.js) and the stamp shader lays
 * bristle tracks, starved streaks, ridges, a pooled start and a pushed lip inside it. Pigment is
 * composited "over" (new paint hides old); relief keeps a share of what is underneath, so paint
 * laid on paint piles up. Nothing reads the targets back while writing them, so there is no
 * ping-pong and an idle canvas costs nothing.
 *
 * Two more passes touch the paint: `dry` (wetness falls, by blending alone) and `bake` (the
 * twist a chain of clears has given the display is resampled into the paint, into the spare
 * pair, and the pairs swap).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    atan,
    attribute,
    clamp,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    positionLocal,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    step,
    texture,
    uniform,
    uv,
    vec2,
    vec4,
} from 'three/tsl';

import { RELIEF, TAU } from './chromatic-impasto-core.js';
import {
    ciCanvasUv, ciHash21, ciNoise2, ciTrack, ciTwist, ciWeave,
} from './chromatic-impasto-tsl.js';
import { QUAD_FLOATS, StrokeBatch, VERTEX_STRIDE } from './chromatic-impasto-strokes.js';

/** Angular lobes of a splat's rim. */
const SPLAT_LOBES = 13;

/**
 * What a stroke lays at this fragment: coverage, height, colour. Call inside a Fn.
 */
function stampNodes() {
    const uv4 = attribute('aUv', 'vec4');
    const colA = attribute('aColA', 'vec4');
    const colB = attribute('aColB', 'vec4');
    const par = attribute('aPar', 'vec4');
    const par2 = attribute('aPar2', 'vec4');
    const seed = floor(colA.w.add(0.5));
    const isBlob = par.x.greaterThan(1.5);
    const load = par.y;
    const dry = par.z;
    const bristle = par.w;
    const mixB = colB.w;
    const hasB = step(0.001, mixB);
    const point = positionLocal.xy;

    // ── A ribbon: u across (−1..1), s along (canvas units), L its length, w its half-width ──
    const u = uv4.x;
    const s = uv4.y;
    const L = max(uv4.z, 1e-4);
    const w = max(uv4.w, 1e-4);
    const au = abs(u);
    const bw = float(RELIEF.bristle).mul(mix(2.4, 1.0, bristle));
    // Bristles are not a ruler: they sit unevenly in the ferrule, and the head splays a little
    // one way and the other as it travels.
    const laid = u.mul(w).div(bw).add(seed.mul(0.37));
    const uneven = ciTrack(laid.mul(0.31), seed.add(41.0)).sub(0.5).mul(1.7);
    const splay = ciTrack(s.div(w.mul(1.7)).add(seed.mul(0.53)), seed.add(9.0)).sub(0.5).mul(1.2);
    const bc = laid.add(uneven.add(splay).mul(bristle)).toVar();
    const bi = floor(bc);
    const bf = fract(bc);
    const h1 = ciHash21(vec2(bi, seed)).toVar();
    const h2 = ciHash21(vec2(bi.add(57.0), seed.add(11.0))).toVar();
    const h3 = ciHash21(vec2(bi.add(113.0), seed.add(29.0))).toVar();
    // Bristles work in clumps: a slow value across the stroke, and what each clump and each
    // bristle does along it.
    const clump = ciTrack(bc.div(3.6).add(seed.mul(0.13)), seed.add(77.0)).toVar();
    const n = ciTrack(s.div(bw.mul(18.0)).add(h1.mul(40.0)), bi.add(seed.mul(3.0))).toVar();
    const nc = ciTrack(s.div(bw.mul(46.0)).add(clump.mul(9.0)), floor(bc.div(3.6)).add(seed.mul(5.0))).toVar();
    const tRel = clamp(s.div(L), 0.0, 1.0);
    // The brush runs dry: thin bristles first, in broken streaks.
    const supply = load.mul(float(1.0).sub(dry.mul(pow(tRel, 1.4)))).toVar();
    const starve = h2.mul(0.45).add(n.mul(0.35)).add(nc.mul(0.25)).mul(dry)
        .mul(smoothstep(0.12, 1.0, tRel))
        .mul(1.3);
    const present = smoothstep(0.02, 0.2, supply.sub(starve));
    // Edges: a bristle brush frays track by track; a knife cuts clean, with a slow wobble.
    const wobble = ciTrack(s.div(w.mul(1.3)).add(seed.mul(0.71)), step(0.0, u).mul(5.0).add(seed)).sub(0.5);
    const edgeAt = float(0.9).add(wobble.mul(0.12));
    const clean = float(1.0).sub(smoothstep(edgeAt.sub(0.05), edgeAt.add(0.03), au));
    const fray = step(au.sub(0.74).div(0.26), h3.mul(0.85).add(0.15));
    const edge = clean.mul(mix(1.0, fray, bristle));
    // The touch-down is round; at the end every track lifts off at its own length.
    const lead = clamp(s.sub(w.mul(0.12).mul(h1).mul(bristle)).div(w.mul(0.75)), 0.0, 1.0);
    const capIn = sqrt(max(float(1.0).sub(float(1.0).sub(lead).pow2()), 0.0));
    const startMask = float(1.0).sub(smoothstep(capIn.sub(0.1), capIn.add(0.02), au)).mul(step(0.0005, lead));
    const liftAt = L.sub(w.mul(mix(0.05, h1.mul(1.2).add(0.12), bristle)));
    const endMask = float(1.0).sub(smoothstep(liftAt.sub(w.mul(0.1)), liftAt, s));
    const tail = clamp(L.sub(s).div(w.mul(0.55)), 0.0, 1.0);
    const capOut = sqrt(max(float(1.0).sub(float(1.0).sub(tail).pow2()), 0.0));
    const endRound = float(1.0).sub(smoothstep(capOut.sub(0.1), capOut.add(0.02), au));
    // Thin paint catches only the high places of the cloth (an uneven tooth, not a grid).
    const tooth = ciWeave(point).mul(0.45).add(ciNoise2(point.mul(150.0)).mul(0.55));
    const thin = float(1.0).sub(smoothstep(0.2, 0.7, supply));
    const skip = mix(1.0, smoothstep(0.25, 0.6, tooth.add(supply.mul(0.6))), thin.mul(0.7));
    const covR = edge.mul(startMask).mul(endMask).mul(endRound).mul(present)
        .mul(skip);

    // Relief: the sides squeezed up into rails, shallow tracks between them with a deep one
    // here and there, a pool where the brush came down and a lip where it pushed the paint to.
    const groove = sin(bf.mul(Math.PI));
    const deep = step(0.8, h1);
    const ridge = mix(1.0, mix(groove.mul(0.16).add(0.84), groove.mul(0.5).add(0.5), deep), bristle);
    const body = mix(0.95, clump.mul(0.34).add(0.76), bristle);
    const rail = smoothstep(0.42, 0.9, au);
    const cross = mix(rail.mul(rail).add(0.5), rail.mul(0.55).add(0.72), bristle);
    const brim = float(1.0).sub(smoothstep(0.9, 1.0, au).mul(0.6));
    const pool = exp(s.div(w.mul(0.9)).negate()).mul(0.3);
    const lip = exp(L.sub(s).div(w.mul(0.5)).negate()).mul(mix(0.9, 0.3, bristle));
    const chatter = ciTrack(s.div(w.mul(0.42)).add(seed.mul(0.29)), seed.add(3.0)).sub(0.5).mul(0.09)
        .mul(float(1.0).sub(bristle));
    const hR = supply.mul(0.65).add(0.35).mul(body).mul(ridge)
        .mul(cross)
        .mul(brim)
        .mul(nc.mul(0.3).add(0.85))
        .mul(pool.add(lip).add(1.0))
        .add(chatter);

    // Pigment: the second colour rides on some clumps, in bands that break and rejoin; within
    // a colour the paint is nearly even.
    const carried = clump.mul(0.7).add(h3.mul(0.3)).add(nc.sub(0.5).mul(0.5));
    const mR = smoothstep(float(0.9).sub(mixB), float(1.1).sub(mixB), carried).mul(hasB);
    const colR = mix(colA.rgb, colB.rgb, mR).mul(clump.mul(0.12).add(h2.mul(0.06)).add(0.91));

    // ── A blob: q = local point in radii ──
    const q = uv4.xy;
    const r = length(q);
    const turn = atan(q.y, q.x).div(TAU).add(0.5);
    const lobe = (count, salt) => {
        const a = turn.mul(count);
        const i = floor(a);
        const f = fract(a);
        const sm = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
        const wrap = (v) => v.sub(floor(v.div(count)).mul(count));
        return mix(ciHash21(vec2(wrap(i), seed.add(salt))), ciHash21(vec2(wrap(i.add(1.0)), seed.add(salt))), sm);
    };
    const spike = lobe(SPLAT_LOBES, 0.0);
    const ripple = lobe(SPLAT_LOBES * 2 + 1, 41.0);
    // `dry` is how far the rim is thrown out in fingers.
    const rim = float(1.0).add(dry.mul(spike.mul(spike).mul(spike).mul(0.8).sub(0.06))).add(ripple.sub(0.5).mul(0.12));
    const rr = r.div(rim);
    const covB = float(1.0).sub(smoothstep(0.88, 1.0, rr));
    // A splat is a crater: thin where it struck, thick where the paint was thrown out to.
    const dome = sqrt(max(float(1.0).sub(rr.mul(rr)), 0.0));
    const wall = smoothstep(0.45, 0.82, rr).mul(float(1.0).sub(smoothstep(0.82, 1.0, rr)));
    const grain = ciNoise2(q.mul(3.0).add(seed.mul(0.61)));
    const crater = dome.mul(0.5).add(wall.mul(0.75)).add(0.1);
    const bead = dome.mul(0.95).add(0.08);
    const hB = load.mul(mix(bead, crater, bristle)).mul(grain.mul(0.3).add(0.85));
    const marble = ciNoise2(q.mul(2.3).add(seed.mul(1.7)));
    const mB = smoothstep(float(0.85).sub(mixB), float(1.05).sub(mixB), marble).mul(hasB);
    const colBl = mix(colA.rgb, colB.rgb, mB).mul(grain.mul(0.16).add(0.92));

    return {
        cov: clamp(select(isBlob, covB, covR), 0.0, 1.0),
        height: max(select(isBlob, hB, hR), 0.0).mul(par2.x),
        color: select(isBlob, colBl, colR),
        special: par2.y,
        keep: par2.z,
    };
}

/** "Over", premultiplied: out = src + dst · (1 − src.a), for colour and alpha alike. */
function overBlend(material) {
    material.transparent = true;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

function plain(material) {
    material.depthTest = false;
    material.depthWrite = false;
    material.fog = false;
    material.toneMapped = false;
    material.side = THREE.DoubleSide;
    return material;
}

function makeTarget(width, height, name) {
    const target = new THREE.RenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0,
    });
    target.texture.name = name;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    // The stirring may reach past the cloth: what it turns into view from there is the paint
    // mirrored in the cloth's edge, never one edge texel smeared into a streak.
    target.texture.wrapS = THREE.MirroredRepeatWrapping;
    target.texture.wrapT = THREE.MirroredRepeatWrapping;
    target.texture.generateMipmaps = false;
    return target;
}

export class PaintCanvas {
    /**
     * @param {object} params
     * @param {THREE.WebGPURenderer|null} params.renderer  null = CPU only (tests): strokes are
     *        still emitted and counted, nothing is drawn
     * @param {number} [params.maxQuads=2048]
     */
    constructor({ renderer = null, maxQuads = 2048 } = {}) {
        this.renderer = renderer;
        this.width = 0;
        this.height = 0;
        this.halfX = 1;
        this.halfY = 1;
        this.front = 0;
        this.pigment = [null, null];
        this.relief = [null, null];
        this.draws = 0;
        this.bakes = 0;
        this.disposed = false;
        /** True once the targets hold a painting (cleared and stamped), false while they are raw. */
        this.painted = false;

        this.batch = new StrokeBatch(maxQuads, () => this.flush());

        /** Canvas half-extent (canvas units), and one texel in canvas units. */
        this.uHalf = uniform(new THREE.Vector2(1, 1));
        this.uTexel = uniform(new THREE.Vector2(0.002, 0.002));
        this.uFill = uniform(new THREE.Vector4(0, 0, 0, 0));
        this.uDry = uniform(1);
        this.uBakeTwist = uniform(new THREE.Vector4(0, 0, 0, 1));
        /** The size (texels) of the texture a bake reads. */
        this.uBakeSize = uniform(new THREE.Vector2(1, 1));

        const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        blank.needsUpdate = true;
        this.blank = blank;
        /** What the display samples. Their values follow the front pair. */
        this.pigmentNode = texture(blank);
        this.reliefNode = texture(blank);
        this.bakeSource = [texture(blank), texture(blank)];

        this.buildStamp(maxQuads);
        this.buildPasses();
    }

    buildStamp(maxQuads) {
        // (Not DynamicDrawUsage: three uploads a dynamic attribute on every draw, and the second
        // draw of a flush, finding no update range left, would write the whole buffer.)
        this.buffer = new THREE.InterleavedBuffer(this.batch.data, VERTEX_STRIDE);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
        geometry.setAttribute('aUv', new THREE.InterleavedBufferAttribute(this.buffer, 4, 3));
        geometry.setAttribute('aColA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 7));
        geometry.setAttribute('aColB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 11));
        geometry.setAttribute('aPar', new THREE.InterleavedBufferAttribute(this.buffer, 4, 15));
        geometry.setAttribute('aPar2', new THREE.InterleavedBufferAttribute(this.buffer, 4, 19));
        const index = new Uint32Array(maxQuads * 6);
        for (let i = 0; i < maxQuads; i++) {
            const v = i * 4;
            index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
        }
        geometry.setIndex(new THREE.BufferAttribute(index, 1));
        geometry.setDrawRange(0, 0);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
        this.geometry = geometry;

        this.pigmentMaterial = plain(new THREE.NodeMaterial());
        this.pigmentMaterial.name = 'Chromatic Impasto — stamp pigment';
        this.pigmentMaterial.fragmentNode = Fn(() => {
            const st = stampNodes();
            return vec4(st.color.mul(st.cov), st.cov);
        })();
        overBlend(this.pigmentMaterial);

        this.reliefMaterial = plain(new THREE.NodeMaterial());
        this.reliefMaterial.name = 'Chromatic Impasto — stamp relief';
        this.reliefMaterial.fragmentNode = Fn(() => {
            const st = stampNodes();
            // The alpha is what the old relief loses: all of it but the share that is kept. (What
            // the paint is made of rides in the same blend, so paint dragged over gold leaf picks
            // a share of it up, as it would.)
            return vec4(st.height.mul(st.cov), st.special.mul(st.cov), 0.0, st.cov.mul(float(1.0).sub(st.keep)));
        })();
        overBlend(this.reliefMaterial);

        this.mesh = new THREE.Mesh(geometry, this.pigmentMaterial);
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    }

    buildPasses() {
        // Fill: a whole target set to one value.
        this.fillMaterial = plain(new THREE.NodeMaterial());
        this.fillMaterial.name = 'Chromatic Impasto — fill';
        this.fillMaterial.fragmentNode = vec4(this.uFill);
        this.fillMaterial.blending = THREE.NoBlending;
        this.fillQuad = new THREE.QuadMesh(this.fillMaterial);

        // Dry: pigment.a *= k, by blending alone (colour: dst kept; alpha: dst · src.a).
        this.dryMaterial = plain(new THREE.NodeMaterial());
        this.dryMaterial.name = 'Chromatic Impasto — dry';
        this.dryMaterial.fragmentNode = vec4(0.0, 0.0, 0.0, this.uDry);
        this.dryMaterial.transparent = true;
        this.dryMaterial.blending = THREE.CustomBlending;
        this.dryMaterial.blendEquation = THREE.AddEquation;
        this.dryMaterial.blendSrc = THREE.ZeroFactor;
        this.dryMaterial.blendDst = THREE.OneFactor;
        this.dryMaterial.blendSrcAlpha = THREE.ZeroFactor;
        this.dryMaterial.blendDstAlpha = THREE.SrcAlphaFactor;
        this.dryQuad = new THREE.QuadMesh(this.dryMaterial);

        // Bake: new(p) = old(twist(p)). Five taps hold the thin detail the twist shears.
        // Bake: new(p) = old(twist(p)), resampled with Catmull-Rom in five bilinear taps. A long
        // game bakes dozens of times: bilinear would melt the bristle tracks a little more each
        // time, this keeps them. Where nothing is twisted every weight but one is zero and the
        // texel is copied exactly.
        const bakeNode = (source, relief) => Fn(() => {
            // (The quad's v runs down from the top, as the targets' does.)
            const st = uv();
            const p = vec2(st.x.mul(2.0).sub(1.0), float(1.0).sub(st.y.mul(2.0))).mul(this.uHalf);
            const tw = ciTwist(p, this.uBakeTwist);
            const at = ciCanvasUv(tw.point, this.uHalf).mul(this.uBakeSize);
            const base = floor(at.sub(0.5)).add(0.5).toVar();
            const f = at.sub(base).toVar();
            const w0 = f.mul(f.mul(vec2(1.0).sub(f.mul(0.5))).sub(0.5));
            const w1 = f.mul(f).mul(f.mul(1.5).sub(2.5)).add(1.0);
            const w2 = f.mul(f.mul(vec2(2.0).sub(f.mul(1.5))).add(0.5));
            const w3 = f.mul(f).mul(f.mul(0.5).sub(0.5));
            const w12 = w1.add(w2).toVar();
            const p0 = base.sub(1.0).div(this.uBakeSize);
            const p3 = base.add(2.0).div(this.uBakeSize);
            const p12 = base.add(w2.div(w12)).div(this.uBakeSize);
            const kUp = w12.x.mul(w0.y);
            const kLeft = w0.x.mul(w12.y);
            const kMid = w12.x.mul(w12.y);
            const kRight = w3.x.mul(w12.y);
            const kDown = w12.x.mul(w3.y);
            const sum = source.sample(vec2(p12.x, p0.y)).mul(kUp)
                .add(source.sample(vec2(p0.x, p12.y)).mul(kLeft))
                .add(source.sample(p12).mul(kMid))
                .add(source.sample(vec2(p3.x, p12.y)).mul(kRight))
                .add(source.sample(vec2(p12.x, p3.y)).mul(kDown));
            const out = sum.div(kUp.add(kLeft).add(kMid).add(kRight).add(kDown));
            // The filter's negative lobes must not leave negative paint behind (what the paint is
            // made of, in the relief's second channel, is signed and stays so).
            return relief ? vec4(max(out.x, 0.0), out.y, out.z, max(out.w, 0.0)) : max(out, vec4(0.0));
        })();
        this.bakeMaterials = this.bakeSource.map((source, i) => {
            const material = plain(new THREE.NodeMaterial());
            material.name = `Chromatic Impasto — bake ${i === 0 ? 'pigment' : 'relief'}`;
            material.fragmentNode = bakeNode(source, i === 1);
            material.blending = THREE.NoBlending;
            return material;
        });
        this.bakeQuads = this.bakeMaterials.map((m) => new THREE.QuadMesh(m));
    }

    /**
     * Size the painting.
     *
     * A new resolution over the same cloth (the frame kept its shape: a render-scale step, a
     * DPR change) keeps the paint: it is resampled into the new targets. A cloth of another
     * shape, or a first size, starts bare, and the caller replays its log.
     *
     * @returns {'same'|'resampled'|'bare'}
     */
    setSize(width, height, halfX, halfY) {
        const w = Math.max(8, Math.round(width));
        const h = Math.max(8, Math.round(height));
        const sameCloth = Math.abs(halfX - this.halfX) < 1e-4 && Math.abs(halfY - this.halfY) < 1e-4;
        this.halfX = halfX;
        this.halfY = halfY;
        this.uHalf.value.set(halfX, halfY);
        this.camera.left = -halfX;
        this.camera.right = halfX;
        this.camera.top = halfY;
        this.camera.bottom = -halfY;
        this.camera.updateProjectionMatrix();
        if (w === this.width && h === this.height && this.pigment[0]) {
            this.uTexel.value.set((2 * halfX) / w, (2 * halfY) / h);
            return sameCloth ? 'same' : 'bare';
        }
        const old = { pigment: this.pigment[this.front], relief: this.relief[this.front] };
        const oldSize = [this.width, this.height];
        const spare = { pigment: this.pigment[1 - this.front], relief: this.relief[1 - this.front] };
        const keep = sameCloth && this.painted && this.ready;
        this.width = w;
        this.height = h;
        this.uTexel.value.set((2 * halfX) / w, (2 * halfY) / h);
        for (let i = 0; i < 2; i++) {
            this.pigment[i] = makeTarget(w, h, `Chromatic Impasto — pigment ${i}`);
            this.relief[i] = makeTarget(w, h, `Chromatic Impasto — relief ${i}`);
        }
        this.front = 0;
        if (keep) {
            this.batch.reset();
            this.uBakeTwist.value.set(0, 0, 0, 1);
            this.uBakeSize.value.set(oldSize[0], oldSize[1]);
            this.bakeSource[0].value = old.pigment.texture;
            this.bakeSource[1].value = old.relief.texture;
            this.into(this.pigment[0], (r) => this.bakeQuads[0].render(r));
            this.into(this.relief[0], (r) => this.bakeQuads[1].render(r));
        } else {
            this.painted = false;
        }
        this.bakeSource[0].value = this.blank;
        this.bakeSource[1].value = this.blank;
        old.pigment?.dispose();
        old.relief?.dispose();
        spare.pigment?.dispose();
        spare.relief?.dispose();
        this.point();
        return keep ? 'resampled' : 'bare';
    }

    /** Aim the display's texture nodes at the front pair. */
    point() {
        if (!this.pigment[this.front]) return;
        this.pigmentNode.value = this.pigment[this.front].texture;
        this.reliefNode.value = this.relief[this.front].texture;
    }

    /** Run `fn` with the renderer aimed at `target`, nothing cleared, and put everything back. */
    into(target, fn) {
        const { renderer } = this;
        const previous = renderer.getRenderTarget();
        const { autoClear } = renderer;
        renderer.autoClear = false;
        renderer.setRenderTarget(target);
        try {
            fn(renderer);
        } finally {
            renderer.setRenderTarget(previous);
            renderer.autoClear = autoClear;
        }
    }

    get ready() {
        return Boolean(this.renderer && this.pigment[0] && !this.disposed);
    }

    /** Bare cloth: the ground colour, dry, with no paint standing on it. */
    clear(ground) {
        this.batch.reset();
        if (!this.ready) return;
        this.uFill.value.set(ground[0], ground[1], ground[2], 0);
        this.into(this.pigment[this.front], (r) => this.fillQuad.render(r));
        this.uFill.value.set(0, 0, 0, 0);
        this.into(this.relief[this.front], (r) => this.fillQuad.render(r));
        this.painted = true;
    }

    /**
     * Draw the passes a game would otherwise meet for the first time in the middle of play (a
     * first bake, a first drying step), to no effect: their pipelines compile now. The bake is
     * drawn into the spare pair, which nothing reads.
     */
    warm() {
        if (!this.ready) return;
        const back = 1 - this.front;
        this.uBakeTwist.value.set(0, 0, 0, 1);
        this.uBakeSize.value.set(this.width, this.height);
        this.bakeSource[0].value = this.pigment[this.front].texture;
        this.bakeSource[1].value = this.relief[this.front].texture;
        this.into(this.pigment[back], (r) => this.bakeQuads[0].render(r));
        this.into(this.relief[back], (r) => this.bakeQuads[1].render(r));
        this.bakeSource[0].value = this.blank;
        this.bakeSource[1].value = this.blank;
        this.dry(1);
    }

    /** Draw what the painter has emitted since the last flush. */
    flush() {
        const { batch } = this;
        const { quads } = batch;
        batch.reset();
        if (quads === 0 || !this.ready) return;
        this.buffer.clearUpdateRanges();
        this.buffer.addUpdateRange(0, quads * QUAD_FLOATS);
        this.buffer.needsUpdate = true;
        this.geometry.setDrawRange(0, quads * 6);
        this.mesh.material = this.pigmentMaterial;
        this.into(this.pigment[this.front], (r) => r.render(this.scene, this.camera));
        this.mesh.material = this.reliefMaterial;
        this.into(this.relief[this.front], (r) => r.render(this.scene, this.camera));
        this.draws += 1;
    }

    /** The paint dries a little: wetness × k. */
    dry(k) {
        if (!this.ready) return;
        this.uDry.value = k;
        this.into(this.pigment[this.front], (r) => this.dryQuad.render(r));
    }

    /**
     * Bake a twist into the paint: afterwards the display, untwisted, shows what it showed
     * through the twist.
     */
    bake(cx, cy, angle, reach) {
        this.flush();
        this.bakes += 1;
        if (!this.ready) return;
        const back = 1 - this.front;
        this.uBakeTwist.value.set(cx, cy, angle, reach);
        this.uBakeSize.value.set(this.width, this.height);
        this.bakeSource[0].value = this.pigment[this.front].texture;
        this.bakeSource[1].value = this.relief[this.front].texture;
        this.into(this.pigment[back], (r) => this.bakeQuads[0].render(r));
        this.into(this.relief[back], (r) => this.bakeQuads[1].render(r));
        this.front = back;
        this.point();
    }

    disposeTargets() {
        for (let i = 0; i < 2; i++) {
            this.pigment[i]?.dispose();
            this.relief[i]?.dispose();
            this.pigment[i] = null;
            this.relief[i] = null;
        }
        this.pigmentNode.value = this.blank;
        this.reliefNode.value = this.blank;
        this.bakeSource[0].value = this.blank;
        this.bakeSource[1].value = this.blank;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.disposeTargets();
        this.geometry.dispose();
        this.pigmentMaterial.dispose();
        this.reliefMaterial.dispose();
        this.fillMaterial.dispose();
        this.dryMaterial.dispose();
        this.bakeMaterials.forEach((m) => m.dispose());
        this.blank.dispose();
        this.scene.remove(this.mesh);
    }
}
