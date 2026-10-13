/**
 * Pyrestorm — incandescent matter in flight.
 *
 *  - The jets: the crater's fountain (spatter climbing hundreds of metres and falling back on the
 *    cone) and the fissure's curtain (a line of low fountains), in closed form: every particle
 *    loops its own arc on the clock, so nothing is spawned. The fountain's height is a uniform
 *    that scales each arc's rise (never its period: a chain can raise the fountain without
 *    jolting a single particle's phase).
 *  - The bombs: what events throw (a lock's Strombolian burst, the blast's ring, sparks, the
 *    splashes where bombs land), written once into a ring buffer when thrown and flown on the GPU.
 *  - The motes: embers drifting up from the valley past the eye and ash falling out of the plume.
 *
 * All additive, drawn as streaks along their motion (a 1/30 s exposure) at least a pixel wide,
 * cooling from yellow-white to a dull red as they fly.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    exp,
    float,
    floor,
    fract,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    vec2,
    vec3,
    vec4,
    varying,
} from 'three/tsl';
import {
    CRATER, EYE, FISSURE, TAU, mulberry32,
} from './pyrestorm-core.js';
import { pyBlackbody, pyHash21 } from './pyrestorm-tsl.js';

const G = 9.81;
/** The crater fountain's ordinary height (m) and the fissure's. */
export const FOUNTAIN_HEIGHT = 640;
export const FISSURE_HEIGHT = 165;

/**
 * A streak's clip position: a quad from `p` back along the screen motion of `v` (m/s) over the
 * exposure, `px` pixels wide (and at least that long).
 */
function streakVertex(u, p, v, px, exposure) {
    const viewP = cameraViewMatrix.mul(vec4(p, 1.0));
    const viewV = cameraViewMatrix.mul(vec4(v, 0.0)).xyz;
    const depth = viewP.z.negate().max(1.0);
    const pixel = u.pixelAngle.mul(depth);
    // Screen-plane motion over the exposure (metres in view space).
    const move = viewV.xy.mul(exposure);
    const len = length(move);
    const dir = len.greaterThan(1e-4).select(move.div(max(len, 1e-4)), vec2(0.0, 1.0));
    const side = vec2(dir.y.negate(), dir.x);
    const corner = positionGeometry.xy;
    const width = pixel.mul(px);
    const along = len.add(width).mul(corner.y.add(0.5)).sub(width.mul(0.5));
    const offset = dir.mul(along.negate()).add(side.mul(corner.x.mul(width)));
    return cameraProjectionMatrix.mul(viewP.add(vec4(offset, 0.0, 0.0)));
}

/** The streak's profile across and along (soft round ends). */
function streakProfile() {
    const c = varying(positionGeometry.xy, 'vPyStreak');
    const across = exp(c.x.mul(c.x).mul(-14.0));
    const along = smoothstep(-0.5, -0.3, c.y).mul(float(1.0).sub(smoothstep(0.35, 0.5, c.y).mul(0.5)));
    return across.mul(along);
}

function additive(name) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.name = name;
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    // vec4(rgb, 0) adds rgb only with premultiplied alpha (else the blend multiplies by alpha 0).
    m.premultipliedAlpha = true;
    // A streak's quad faces whichever way its motion turns it on screen: both faces draw.
    m.side = THREE.DoubleSide;
    m.fog = false;
    m.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return m;
}

function quad() {
    const q = new THREE.PlaneGeometry(1, 1);
    q.deleteAttribute('normal');
    q.deleteAttribute('uv');
    return q;
}

// ── The jets ──────────────────────────────────────────────────────────────────────

export function createJets(u, tier) {
    const crater = tier.jets;
    const fissure = tier.fissureJets;
    const count = crater + fissure;
    const random = mulberry32(0x7e75);
    // Per particle: (seed, emitter: 0 crater / 1 fissure, place along the fissure, speed share).
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        data[i * 4] = random();
        data[i * 4 + 1] = i < crater ? 0 : 1;
        data[i * 4 + 2] = random();
        data[i * 4 + 3] = 0.55 + 0.45 * Math.sqrt(random());
    }
    const geometry = quad();
    const attr = new THREE.InstancedBufferAttribute(data, 4);
    geometry.setAttribute('aJet', attr);
    const material = additive('PyrestormJets');
    const jet = attribute('aJet', 'vec4');
    const fa = new THREE.Vector3(FISSURE.a[0], 0, FISSURE.a[1]);
    const fb = new THREE.Vector3(FISSURE.b[0], 0, FISSURE.b[1]);
    // Ground under the fissure's ends (its rampart's crest).
    const fissureY = 60;

    const state = () => {
        const seed = jet.x;
        const isF = jet.y;
        // Rise: the fountain's height × this particle's share; time aloft follows the ordinary
        // height only (constant per particle), so a taller fountain never jumps a phase.
        // The fissure's line feeds three vents (taller), tapering to nothing at its ends.
        const along0 = jet.z;
        const ventAt = (c, w) => exp(along0.sub(c).div(w).mul(along0.sub(c).div(w)).negate());
        const vents = max(ventAt(0.22, 0.07), max(ventAt(0.55, 0.09), ventAt(0.81, 0.06))).mul(0.8).add(0.2)
            .mul(smoothstep(0.0, 0.1, along0))
            .mul(float(1.0).sub(smoothstep(0.9, 1.0, along0)));
        const h0 = mix(float(FOUNTAIN_HEIGHT), float(FISSURE_HEIGHT).mul(vents), isF).mul(jet.w.mul(jet.w));
        const vy0 = h0.mul(2.0 * G).sqrt();
        const period = vy0.mul(2.0 / G).add(mix(float(0.6), float(0.3), isF));
        const clock = u.time.add(seed.mul(period));
        const cycle = floor(clock.div(period));
        const age = clock.sub(cycle.mul(period));
        const h1 = pyHash21(vec2(seed.mul(91.7), cycle));
        const h2 = pyHash21(vec2(cycle, seed.mul(53.3)));
        // Where it leaves: the crater's mouth, or a point along the fissure.
        const along = jet.z;
        const vent = mix(
            vec3(CRATER.x, CRATER.y, CRATER.z).add(vec3(h1.sub(0.5).mul(90.0), 0.0, h2.sub(0.5).mul(90.0))),
            vec3(fa.x, fissureY, fa.z).add(vec3(fb.x - fa.x, 0.0, fb.z - fa.z).mul(along)).add(vec3(h2.sub(0.5).mul(30.0), 0.0, h1.sub(0.5).mul(30.0))),
            isF,
        );
        // Sideways: a cone of spread round the vertical (the fissure's curtain leans less).
        const a = h1.mul(TAU);
        const spread = mix(float(0.24), float(0.14), isF).mul(h2.mul(0.7).add(0.3));
        const vh = vy0.mul(spread);
        const v0 = vec3(cos(a).mul(vh), vy0, sin(a).mul(vh));
        // The fountain uniform scales the arc's rise; activity shrinks everything at game over.
        const lift = mix(u.fountain, u.fountain.mul(0.5).add(0.5), isF).mul(u.activity.mul(0.6).add(0.4));
        const t = age;
        const p = vec3(vent.x.add(v0.x.mul(t)), vent.y.add(v0.y.mul(t).sub(t.mul(t).mul(0.5 * G)).mul(lift)), vent.z.add(v0.z.mul(t)));
        const v = vec3(v0.x, v0.y.sub(t.mul(G)).mul(lift), v0.z);
        const life = age.div(period);
        return {
            p, v, life, isF,
        };
    };
    material.vertexNode = Fn(() => {
        const s = state();
        return streakVertex(u, s.p, s.v, mix(float(2.4), float(1.9), s.isF), 1 / 24);
    })();
    material.outputNode = Fn(() => {
        const s = state();
        // Hot leaving the vent, cooling through orange to red as it falls.
        const temp = float(0.98).sub(s.life.mul(0.55)).sub(s.life.mul(s.life).mul(0.2));
        const fade = smoothstep(0.0, 0.03, s.life).mul(float(1.0).sub(smoothstep(0.88, 1.0, s.life)));
        const power = mix(float(1.7), float(1.0), s.isF).mul(u.activity.mul(0.7).add(0.3));
        return vec4(pyBlackbody(temp).mul(streakProfile()).mul(fade).mul(power), 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'PyrestormJets';
    mesh.frustumCulled = false;
    mesh.renderOrder = 28;
    const glow = createFireGlow(u);
    return {
        mesh,
        meshes: [mesh, ...glow.meshes],
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
            glow.dispose();
        },
    };
}

/**
 * The fire's own glow: the fountain's hot body over the vent (a soft billboard as tall as the
 * fountain stands) and the fissure's curtain (a strip along the line, bright at its foot and
 * flickering ragged at its top), so both read as fire, not as a sprinkle of sparks.
 */
function createFireGlow(u) {
    // The vent: one camera-facing quad.
    const ventGeo = quad();
    const vent = additive('PyrestormVentGlow');
    vent.vertexNode = Fn(() => {
        const h = u.fountain.mul(u.activity.mul(0.6).add(0.4)).mul(FOUNTAIN_HEIGHT);
        const centre = vec3(CRATER.x, CRATER.y, CRATER.z).add(vec3(0.0, h.mul(0.42), 0.0));
        const view = cameraViewMatrix.mul(vec4(centre, 1.0));
        const size = vec2(h.mul(0.4).add(100.0), h.mul(0.62).add(130.0));
        return cameraProjectionMatrix.mul(view.add(vec4(positionGeometry.xy.mul(size).mul(2.0), 0.0, 0.0)));
    })();
    vent.outputNode = Fn(() => {
        const c = varying(positionGeometry.xy, 'vPyVent').mul(2.0);
        // A column of glow, hottest low and on its axis.
        const core = exp(c.x.mul(c.x).mul(-9.0).add(c.y.add(0.35).mul(c.y.add(0.35)).mul(-2.2)));
        // Faded to nothing at the quad's border (no box shows when the fountain is boosted).
        const win = float(1.0).sub(c.x.mul(c.x)).max(0.0).mul(float(1.0).sub(c.y.mul(c.y)).max(0.0));
        const halo = exp(c.dot(c).mul(-2.6)).mul(0.25).mul(win.mul(win));
        const heat = u.fountain.mul(u.activity);
        const T = float(0.58).add(core.mul(0.24)).add(heat.sub(1.0).mul(0.05)).min(0.95);
        return vec4(pyBlackbody(T).mul(core.mul(win).mul(0.32).add(halo.mul(0.8))).mul(heat.mul(0.6).add(0.2)), 0.0);
    })();
    const ventMesh = new THREE.Mesh(ventGeo, vent);
    ventMesh.name = 'PyrestormVentGlow';
    ventMesh.frustumCulled = false;
    ventMesh.renderOrder = 27;

    // The fissure's curtain: a vertical strip along the line, facing the eye's side.
    const curtainGeo = new THREE.PlaneGeometry(1, 1, 48, 1);
    curtainGeo.deleteAttribute('normal');
    curtainGeo.deleteAttribute('uv');
    const curtain = additive('PyrestormCurtain');
    curtain.vertexNode = Fn(() => {
        const t = positionGeometry.x.add(0.5);
        const up = positionGeometry.y.add(0.5);
        const base = vec3(FISSURE.a[0], 58.0, FISSURE.a[1]).add(vec3(FISSURE.b[0] - FISSURE.a[0], 0.0, FISSURE.b[1] - FISSURE.a[1]).mul(t));
        const h = u.fountain.mul(0.5).add(0.5).mul(u.activity.mul(0.6).add(0.4)).mul(FISSURE_HEIGHT * 1.15);
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(base.add(vec3(0.0, up.mul(h), 0.0)), 1.0)));
    })();
    curtain.outputNode = Fn(() => {
        const g = varying(positionGeometry.xy, 'vPyCurtain');
        const x = g.x.add(0.5);
        const y = g.y.add(0.5);
        // Ragged top: the jets' heights flicker along the line.
        const f1 = sin(x.mul(83.0).add(u.time.mul(3.1))).mul(0.5).add(0.5);
        const f2 = sin(x.mul(211.0).sub(u.time.mul(5.3)).add(1.7)).mul(0.5).add(0.5);
        const f3 = sin(x.mul(29.0).add(u.time.mul(0.7)).add(sin(x.mul(7.0)).mul(2.0))).mul(0.5).add(0.5);
        const bump = (c, w) => exp(x.sub(c).div(w).mul(x.sub(c).div(w)).negate());
        const vents = max(bump(0.22, 0.07), max(bump(0.55, 0.09), bump(0.81, 0.06))).mul(0.85).add(0.15);
        const top = f1.mul(0.3).add(f2.mul(0.2)).add(f3.mul(0.4)).add(0.1)
            .mul(vents);
        const body = float(1.0).sub(smoothstep(top.mul(0.3), top, y)).mul(f2.mul(0.5).add(0.5));
        const foot = exp(y.mul(-7.0));
        const ends = smoothstep(0.0, 0.06, x).mul(float(1.0).sub(smoothstep(0.94, 1.0, x)));
        const T = float(0.72).add(foot.mul(0.25)).sub(y.mul(0.25));
        return vec4(pyBlackbody(T).mul(body.mul(0.22).add(foot.mul(0.42))).mul(ends).mul(vents.mul(0.6).add(0.4))
            .mul(u.activity.mul(0.7).add(0.3)), 0.0);
    })();
    const curtainMesh = new THREE.Mesh(curtainGeo, curtain);
    curtainMesh.name = 'PyrestormCurtain';
    curtainMesh.frustumCulled = false;
    curtainMesh.renderOrder = 27;
    return {
        meshes: [ventMesh, curtainMesh],
        dispose() {
            ventGeo.dispose();
            vent.dispose();
            curtainGeo.dispose();
            curtain.dispose();
        },
    };
}

// ── The bombs (event-thrown) ──────────────────────────────────────────────────────

export const BOMB = Object.freeze({
    bomb: 0, spark: 1, splash: 2, ember: 3,
});

export class Bombs {
    constructor(u, count = 512) {
        this.u = u;
        this.count = count;
        this.cursor = 0;
        this.start = new Float32Array(count * 4);
        this.move = new Float32Array(count * 4);
        this.look = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            this.start[i * 4 + 3] = -1e6;
            this.move[i * 4 + 3] = 0.001;
        }
        const geometry = quad();
        this.attr = {
            start: new THREE.InstancedBufferAttribute(this.start, 4).setUsage(THREE.DynamicDrawUsage),
            move: new THREE.InstancedBufferAttribute(this.move, 4).setUsage(THREE.DynamicDrawUsage),
            look: new THREE.InstancedBufferAttribute(this.look, 4).setUsage(THREE.DynamicDrawUsage),
        };
        geometry.setAttribute('aStart', this.attr.start);
        geometry.setAttribute('aMove', this.attr.move);
        geometry.setAttribute('aLook', this.attr.look);
        this.geometry = geometry;
        this.material = this.createMaterial();
        this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
        this.mesh.name = 'PyrestormBombs';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 29;
        this.dirty = false;
    }

    createMaterial() {
        const { u } = this;
        const material = additive('PyrestormBombs');
        const start = attribute('aStart', 'vec4');
        const move = attribute('aMove', 'vec4');
        const look = attribute('aLook', 'vec4');
        // look: (tint r, g, b packed as a fire tint), size px + kind × 100
        const kindOf = () => floor(look.w.div(100.0));
        const state = () => {
            const age = u.time.sub(start.w).max(0.0);
            const kind = kindOf();
            // Gravity for bombs, sparks and splashes; an ember rises and drifts.
            const g = kind.equal(3.0).select(float(-0.6), float(G));
            const drag = kind.equal(1.0).select(float(0.6), float(0.0));
            const k = drag.greaterThan(0.0).select(float(1.0).sub(exp(age.mul(drag).negate())).div(drag.max(1e-3)), age);
            const p = start.xyz.add(move.xyz.mul(k)).sub(vec3(0.0, age.mul(age).mul(0.5).mul(g), 0.0));
            const v = move.xyz.mul(exp(age.mul(drag).negate())).sub(vec3(0.0, age.mul(g), 0.0));
            return {
                p, v, age, life: move.w, kind,
            };
        };
        material.vertexNode = Fn(() => {
            const s = state();
            const alive = s.age.greaterThanEqual(0.0).and(u.time.greaterThanEqual(start.w)).and(s.age.lessThan(s.life));
            const px = look.w.sub(s.kind.mul(100.0));
            // A bomb leaves a long trail (a quarter second), sparks a short one.
            const exposure = s.kind.equal(0.0).select(float(0.22), float(0.06));
            const clip = streakVertex(u, s.p, s.v, px, exposure);
            return alive.select(clip, vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.outputNode = Fn(() => {
            const s = state();
            const f = clamp(s.age.div(s.life), 0.0, 1.0);
            // Bombs cool slowly; sparks and splashes flash and die.
            const temp = s.kind.equal(0.0).select(float(0.95).sub(f.mul(0.45)), float(0.9).sub(f.mul(0.7)));
            const fade = float(1.0).sub(smoothstep(0.6, 1.0, f)).mul(smoothstep(0.0, 0.02, f));
            const gain = s.kind.equal(0.0).select(float(2.4), s.kind.equal(2.0).select(float(1.4), float(1.8)));
            // A piece's colour tints the fire (look.rgb is the fire tint, ~1 = plain lava).
            const rgb = pyBlackbody(temp).mul(look.xyz);
            return vec4(rgb.mul(streakProfile()).mul(fade).mul(gain), 0.0);
        })();
        return material;
    }

    /** Throw one: position (m), velocity (m/s), born (theme clock), life (s), tint, px, kind. */
    spawn({
        x, y, z, vx, vy, vz, born, life, tint = [1, 1, 1], px = 2, kind = BOMB.bomb,
    }) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.count;
        this.start[i * 4] = x;
        this.start[i * 4 + 1] = y;
        this.start[i * 4 + 2] = z;
        this.start[i * 4 + 3] = born;
        this.move[i * 4] = vx;
        this.move[i * 4 + 1] = vy;
        this.move[i * 4 + 2] = vz;
        this.move[i * 4 + 3] = life;
        this.look[i * 4] = tint[0];
        this.look[i * 4 + 1] = tint[1];
        this.look[i * 4 + 2] = tint[2];
        this.look[i * 4 + 3] = kind * 100 + Math.max(0.6, Math.min(40, px));
        this.dirty = true;
        return i;
    }

    clear() {
        for (let i = 0; i < this.count; i++) this.start[i * 4 + 3] = -1e6;
        this.cursor = 0;
        this.dirty = true;
    }

    live(time) {
        let n = 0;
        for (let i = 0; i < this.count; i++) {
            const age = time - this.start[i * 4 + 3];
            if (age >= 0 && age < this.move[i * 4 + 3]) n++;
        }
        return n;
    }

    update() {
        if (!this.dirty) return;
        this.attr.start.needsUpdate = true;
        this.attr.move.needsUpdate = true;
        this.attr.look.needsUpdate = true;
        this.dirty = false;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
        this.mesh.dispose?.();
    }
}

// ── The motes at the eye ──────────────────────────────────────────────────────────

/**
 * Embers rising out of the valley past the eye (a few, bright, wandering) and ash falling out of
 * the plume (many, faint, lit by the fire). Closed form: each loops through a box before the eye.
 */
export function createMotes(u, count) {
    const random = mulberry32(0x3073);
    const data = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        data[i * 4] = random();
        data[i * 4 + 1] = random();
        data[i * 4 + 2] = random();
        // A few are embers (rising off the rivers where they reach the near corners), the rest ash.
        data[i * 4 + 3] = random() < 0.035 ? 1 : 0;
    }
    const geometry = quad();
    geometry.setAttribute('aMote', new THREE.InstancedBufferAttribute(data, 4));
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'PyrestormMotes';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.side = THREE.DoubleSide;
    material.fog = false;
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    const mote = attribute('aMote', 'vec4');
    const box = new THREE.Vector3(520, 220, 760);
    // Where the two rivers come nearest the eye (the bottom corners): the embers' sources.
    const cornerL = new THREE.Vector3(-760, 40, -1250);
    const cornerR = new THREE.Vector3(820, 40, -1230);
    const state = () => {
        const ember = mote.w;
        // Ash falls slowly past the eye; embers climb fast off the lava.
        const speed = mix(float(-1.6), float(26.0), ember);
        const span = mix(float(box.y), float(320.0), ember);
        const period = box.y / 2.2;
        const cyc = fract(mote.y.add(u.time.mul(speed).div(span)));
        // Ash: a box before the eye, carried right and away by the wind.
        const wx = u.time.mul(2.4);
        const ax = fract(mote.x.add(wx.div(box.x))).sub(0.5).mul(box.x);
        const ash = vec3(ax.add(EYE.x), cyc.mul(box.y).add(EYE.y - 140.0), mote.z.mul(box.z).negate().sub(18.0).add(EYE.z));
        // Embers: a spread round one of the corners, wandering as they rise and drifting downwind.
        const corner = mix(cornerL, cornerR, mote.x.greaterThan(0.5).select(float(1.0), float(0.0)));
        const wander = sin(u.time.mul(1.3).add(mote.z.mul(40.0))).mul(14.0);
        const rise = cyc.mul(320.0);
        const em = corner.add(vec3(
            fract(mote.z.mul(7.3)).sub(0.5).mul(520.0).add(wander)
                .add(rise.mul(0.35)),
            rise,
            fract(mote.x.mul(5.1)).sub(0.5).mul(300.0),
        ));
        const p = mix(ash, em, ember);
        const v = mix(vec3(2.4, speed, 0.0), vec3(cos(u.time.mul(1.3).add(mote.z.mul(40.0))).mul(18.0).add(9.0), speed, 0.0), ember);
        return {
            p, v, cyc, ember, period,
        };
    };
    material.vertexNode = Fn(() => {
        const s = state();
        // Embers streak (a longer exposure, wider); ash is a fine grain.
        return streakVertex(u, s.p, s.v, mix(float(1.1), float(3.0), s.ember), mix(float(1 / 30), float(1 / 9), s.ember));
    })();
    material.outputNode = Fn(() => {
        const s = state();
        const edge = smoothstep(0.0, 0.12, s.cyc).mul(float(1.0).sub(smoothstep(0.88, 1.0, s.cyc)));
        const flicker = sin(u.time.mul(9.0).add(mote.x.mul(60.0))).mul(0.3).add(0.7);
        const emberCol = pyBlackbody(float(0.62).add(mote.z.mul(0.2))).mul(flicker).mul(0.9);
        // Ash catches the fire's light from below.
        const ashCol = u.fireColour.mul(0.012).add(u.ambient.mul(0.35)).mul(u.activity.mul(0.6).add(0.4));
        const dist = length(s.p.sub(u.eye));
        // Ash only near the eye; embers by their corners, cooling as they climb.
        const near = mix(float(1.0).sub(smoothstep(300.0, 760.0, dist)), float(1.0).sub(s.cyc.mul(0.55)), s.ember);
        const rgb = mix(ashCol, emberCol, s.ember).mul(edge).mul(near).mul(streakProfile());
        return vec4(rgb, 0.0);
    })();
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'PyrestormMotes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 30;
    return {
        mesh,
        meshes: [mesh],
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose?.();
        },
    };
}

export { normalize };
