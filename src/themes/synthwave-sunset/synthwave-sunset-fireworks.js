/**
 * Synthwave Sunset — fireworks over the sea, fired from a barge off the pier's end, and the
 * sparks the pier and the wheel throw themselves.
 *
 * One instanced additive draw holds every particle: the rising shells with their sparking tails,
 * the stars of each burst, and the ground effects (roman candles and a waterfall of sparks off
 * the pier, the wheel's Catherine-wheel spray). Motion is analytic in the vertex stage (spawn
 * state + age: exponential drag, gravity), so a burst costs one ranged upload at spawn and nothing
 * per frame. Each particle is a camera-facing streak along its own on-screen motion, sized in
 * metres with a pixel floor, writing premultiplied light with alpha 0 (it adds to the frame and
 * leaves the reflection pass's alpha alone, so the sea and the wet sand mirror the fireworks).
 *
 * Trails cost no shader work: a particle born a moment after another with the same spawn state
 * flies the same path that moment behind it, so a star's trail is a few dimmer copies of the star
 * (`trail`), and a willow's branches droop as real curves instead of straight streaks.
 *
 * The shells (SHELL_KINDS): peony, chrysanthemum (glitter), ring, saturn (a ring round a core),
 * pistil (a core of another colour), palm (a few thick arms that droop, crackling at their
 * ends), crossette (stars that split in four), strobe (white stars that hang and blink), crackle
 * (a cloud of popping sparks), willow and brocade (gold branches that fall a long way).
 *
 * The world also lights the sky round the bursts (`u.burst0/1`, read by the sky function); under
 * Reduce flashing that glow keeps REDUCED_FLASH_SCALE of its strength, the stars fade in instead
 * of popping and the strobes burn steady. The two glows ACCUMULATE: a burst joins the weaker of
 * them (its light added to what is still lit, the glow's centre and colour easing toward the new
 * burst), so a volley builds a smoke-lit sky that the sea mirrors instead of blinking from burst
 * to burst.
 *
 * The particle pool is a ring, but a full ring never cuts a star in mid-air: a new particle takes
 * the slot with the least light left among the next few (a dead one if there is one).
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    cameraProjectionMatrix,
    clamp,
    exp,
    float,
    fract,
    length,
    max,
    mix,
    modelViewMatrix,
    positionGeometry,
    screenSize,
    select,
    sin,
    smoothstep,
    step,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { RIG } from './synthwave-sunset-tsl.js';
import { Swell } from '../shared/swell.js';

/**
 * The barge the shells rise from (world), the burst heights (m above the sea) and where the
 * bursts spread (m, along x round `centreX` and along z round the barge): the free sky left of a
 * game's board, over and beside the wheel.
 */
export const FIREWORKS = Object.freeze({
    barge: new THREE.Vector3(-14, 1, -182),
    burstMin: 60,
    burstMax: 92,
    centreX: -9,
    spreadX: 86,
    spreadZ: 34,
});

export const FIREWORK_COLORS = Object.freeze([0x7ff0d4, 0xff5fa8, 0xffe46a, 0xc8a2ff, 0x6fd8ff, 0xffb04c]);

/** The finale's willow: long-lived gold falling stars. */
export const WILLOW_GOLD = new THREE.Color(0xffb04c);

/** The shells the barge can fire. */
export const SHELL_KINDS = Object.freeze([
    'peony', 'chrys', 'ring', 'saturn', 'pistil', 'palm', 'crossette', 'strobe', 'crackle', 'willow', 'brocade',
]);

/** Particle kinds (iMotion.z). Stars up to the shell head are streaks along their motion. */
const KIND = Object.freeze({
    star: 0, glitter: 1, shell: 2, spark: 3, strobe: 5,
});

/** Slots a new particle may take, looking ahead of the ring's cursor (the one with least light left). */
const POOL_PROBE = 48;
/** How fast a sky glow's centre and colour follow the bursts that feed it (1/s). */
const GLOW_FOLLOW = 7;
/** Extra burst height (m) at `high` 1: deeper cascade waves and the crown burst higher. */
const HIGH_LIFT = 22;
/** Seconds between a star and each copy of it that makes its trail. */
const TRAIL_GAP = 0.045;
/** Seconds of its own motion a star is drawn out along (the vertex stage's streak). */
const STREAK = 0.17;
const G = 9.81;

const WHITE = new THREE.Color(1, 0.96, 0.9);
const CRACKLE = new THREE.Color(1, 0.86, 0.6);

function instanced(count, itemSize) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    return attr;
}

/**
 * The particle material. Attributes per particle:
 *   iSpawn  (x, y, z, t0)          world spawn point and time
 *   iVel    (vx, vy, vz, life)     initial velocity, life (s)
 *   iLook   (r, g, b, size m)      colour (linear, HDR) and size
 *   iMotion (drag, gravity, kind, seed)  kind: KIND
 */
function createParticleMaterial(u) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'SynthwaveFireworks';
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.premultipliedAlpha = true;
    material.fog = false;

    const spawn = attribute('iSpawn', 'vec4');
    const vel = attribute('iVel', 'vec4');
    const look = attribute('iLook', 'vec4');
    const motion = attribute('iMotion', 'vec4');
    const age = u.time.sub(spawn.w);
    const life = max(vel.w, 1e-3);
    const alive = step(0.0, age).mul(step(age, life));
    const lifeT = clamp(age.div(life), 0.0, 1.0);
    const drag = max(motion.x, 1e-3);
    const decay = exp(age.mul(drag).negate());
    const travel = float(1.0).sub(decay).div(drag);
    const g = motion.y;
    const pos = spawn.xyz.add(vel.xyz.mul(travel)).add(vec3(0.0, g.mul(age).mul(age).mul(-0.5), 0.0));
    const velNow = vel.xyz.mul(decay).sub(vec3(0.0, g.mul(age), 0.0));

    // A streak along the on-screen motion: the quad's x runs along the view-space velocity.
    const mv = modelViewMatrix.mul(vec4(pos, 1.0)).toVar();
    const vView = modelViewMatrix.mul(vec4(velNow, 0.0)).xy;
    const depth = max(mv.z.negate(), 0.1);
    const pxWorld = depth.mul(2.0).div(cameraProjectionMatrix.element(1).element(1).mul(screenSize.y));
    const width = max(look.w, pxWorld.mul(1.5));
    const speed = length(vView);
    // A float select blended in (r186 can collapse a vector through select()).
    const moving = select(speed.greaterThan(1e-3), float(1.0), float(0.0));
    const dir = mix(vec2(0.0, 1.0), vView.div(max(speed, 1e-3)), moving);
    // The star's trail: about a sixth of a second of its own motion (a long exposure).
    const streakLen = width.add(speed.mul(STREAK).mul(step(motion.z, 2.5)));
    const corner = positionGeometry.xy;
    const offset = dir.mul(corner.x.mul(streakLen)).add(vec2(dir.y.negate(), dir.x).mul(corner.y.mul(width)));
    material.vertexNode = cameraProjectionMatrix.mul(vec4(mv.xy.add(offset.mul(alive)), mv.z, 1.0));
    // The pixel floor's extra area and the streak's length spread the same light thinner.
    const grow = look.w.div(width);
    const dim = grow.mul(grow).mul(width.div(streakLen).pow(0.5));

    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        // Hot head at the leading end, fading tail behind it.
        const along = q.x;
        const across = q.y;
        const shape = exp(across.mul(across).mul(-3.5)).mul(exp(along.sub(0.55).mul(along.sub(0.55)).mul(-2.2)))
            .mul(smoothstep(-1.0, 0.3, along));
        const kind = motion.z;
        const seed = motion.w;
        const calm = u.fireworkCalm;
        // Stars: a brief white-hot start, their colour, a last flicker; glitter twinkles out.
        const hot = exp(age.mul(-9.0)).mul(0.8);
        const fade = float(1.0).sub(smoothstep(0.55, 1.0, lifeT));
        const flick = sin(u.time.mul(38.0).add(seed.mul(91.0))).mul(0.5).add(0.5);
        const isGlitter = step(0.5, kind).mul(step(kind, 1.5));
        const glitter = mix(float(1.0), step(0.55, flick).mul(1.6), isGlitter.mul(smoothstep(0.45, 0.7, lifeT)));
        // Strobes hang and blink, each on its own beat (steady and dimmer under Reduce flashing).
        const isStrobe = step(4.5, kind);
        const blink = step(0.62, fract(age.mul(4.6).add(seed.mul(7.0)))).mul(2.2);
        const strobe = mix(float(1.0), mix(blink, float(0.55), calm), isStrobe.mul(smoothstep(0.08, 0.3, lifeT)));
        const popIn = mix(float(1.0), smoothstep(0.0, 0.35, age), calm);
        const twinkle = mix(glitter, float(1.0), calm).mul(strobe);
        const warm = hot.mul(float(1.0).sub(calm));
        const col = look.xyz.mul(float(1.0).add(warm)).add(vec3(warm.mul(0.6)));
        return col.mul(shape).mul(fade).mul(twinkle).mul(popIn)
            .mul(alive)
            .mul(dim)
            .mul(u.fireworkLevel);
    })();
    material.outputNode = vec4(material.colorNode, 0.0);
    return material;
}

export class Fireworks {
    /**
     * @param {object} u  world uniforms (time, fireworkLevel, fireworkCalm, burst0, burst1)
     * @param {object} opts
     * @param {number} opts.capacity  particle pool
     * @param {() => number} opts.rand
     * @param {number} [opts.mirrorLayer]
     */
    constructor(u, { capacity, rand, mirrorLayer }) {
        this.u = u;
        this.rand = rand;
        this.capacity = Math.max(64, capacity | 0);
        const geometry = new THREE.PlaneGeometry(1, 1);
        this.iSpawn = instanced(this.capacity, 4);
        this.iVel = instanced(this.capacity, 4);
        this.iLook = instanced(this.capacity, 4);
        this.iMotion = instanced(this.capacity, 4);
        for (let i = 0; i < this.capacity; i += 1) this.iSpawn.array[i * 4 + 3] = -1e6;
        geometry.setAttribute('iSpawn', this.iSpawn);
        geometry.setAttribute('iVel', this.iVel);
        geometry.setAttribute('iLook', this.iLook);
        geometry.setAttribute('iMotion', this.iMotion);
        this.mesh = new THREE.InstancedMesh(geometry, createParticleMaterial(u), this.capacity);
        this.mesh.name = 'SynthwaveFireworks';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 30;
        if (Number.isInteger(mirrorLayer)) this.mesh.layers.enable(mirrorLayer);
        this.cursor = 0;
        /** The world time spawns are judged against (which slot has the least light left). */
        this.now = 0;
        /** Bursts waiting for their shell to arrive: { at, pos, color, kind, scale }. */
        this.pending = [];
        /** Told of every burst as it goes off (the world startles the gulls with it). */
        this.onBurst = null;
        /**
         * The sky's two glows: each an accumulating swell (a burst adds to what is still lit, it
         * never restarts it) whose centre and colour ease toward the bursts that feed it.
         */
        const glow = () => ({
            swell: new Swell({
                attack: 0.04, release: 1 / 1.8, ceiling: 1.5, knee: 1.0, headroom: 1.4,
            }),
            pos: new THREE.Vector3(),
            aim: new THREE.Vector3(),
            color: new THREE.Color(),
            tint: new THREE.Color(),
        });
        this.glows = [glow(), glow()];
        this.glowClock = Number.NaN;
        this._c = new THREE.Color();
        this._c2 = new THREE.Color();
        this._hsl = { h: 0, s: 0, l: 0 };
        this._p = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._a = new THREE.Vector3();
        this._b = new THREE.Vector3();
    }

    /**
     * A slot for a new particle: the ring's next one if its particle is spent, otherwise the one
     * with the least life left among the next POOL_PROBE (a full pool takes the most-faded star,
     * never one still burning, and never a spark not yet born).
     */
    allocate() {
        const cap = this.capacity;
        const S = this.iSpawn.array;
        const V = this.iVel.array;
        let best = this.cursor;
        let bestLeft = Infinity;
        for (let k = 0; k < POOL_PROBE; k += 1) {
            const i = (this.cursor + k) % cap;
            const left = S[i * 4 + 3] + V[i * 4 + 3] - this.now;
            if (left <= 0) {
                best = i;
                break;
            }
            if (left < bestLeft) {
                best = i;
                bestLeft = left;
            }
        }
        this.cursor = (best + 1) % cap;
        return best;
    }

    spawn(t0, p, v, life, color, size, drag, gravity, kind) {
        const i = this.allocate();
        const o = i * 4;
        const S = this.iSpawn.array;
        const V = this.iVel.array;
        const L = this.iLook.array;
        const M = this.iMotion.array;
        S[o] = p.x; S[o + 1] = p.y; S[o + 2] = p.z; S[o + 3] = t0;
        V[o] = v.x; V[o + 1] = v.y; V[o + 2] = v.z; V[o + 3] = life;
        L[o] = color.r; L[o + 1] = color.g; L[o + 2] = color.b; L[o + 3] = size;
        M[o] = drag; M[o + 1] = gravity; M[o + 2] = kind; M[o + 3] = this.rand();
        for (const attr of [this.iSpawn, this.iVel, this.iLook, this.iMotion]) {
            // Neighbouring slots share one upload range (one buffer write per run, not per star).
            const ranges = attr.updateRanges;
            const last = ranges[ranges.length - 1];
            if (last && last.start + last.count === o) last.count += 4;
            else attr.addUpdateRange(o, 4);
            attr.needsUpdate = true;
        }
    }

    /**
     * A star and its trail: `trail` dimmer copies, each born TRAIL_GAP after the last, flying the
     * same path that much behind it.
     */
    star(t0, p, v, life, color, size, drag, gravity, kind, trail = 0, gap = TRAIL_GAP) {
        this.spawn(t0, p, v, life, color, size, drag, gravity, kind);
        // Each copy is itself a streak STREAK seconds long, so copies `gap` apart overlap: their
        // light is shared out, and the trail burns about as bright as the star, not many times it.
        const share = Math.min(1, (gap / STREAK) * 1.5);
        for (let k = 1; k <= trail; k += 1) {
            const f = 1 - k / (trail + 1);
            this.spawn(
                t0 + k * gap,
                p,
                v,
                life,
                this._c2.copy(color).multiplyScalar(f * f * share),
                size * (0.55 + 0.45 * f),
                drag,
                gravity,
                kind === KIND.strobe ? KIND.star : kind,
            );
        }
    }

    /** Where a particle is `tau` seconds after its spawn (the vertex stage's motion). */
    static travel(p, v, drag, gravity, tau, out) {
        const k = (1 - Math.exp(-drag * tau)) / drag;
        return out.set(p.x + v.x * k, p.y + v.y * k - 0.5 * gravity * tau * tau, p.z + v.z * k);
    }

    /**
     * A cloud of crackle: `count` sparks popping at random within `radius` of `pos`, between
     * `t0` and `t0 + seconds`, each a white-gold flash a tenth of a second long.
     */
    crackle(t0, pos, radius, count, seconds, color = CRACKLE) {
        const r = this.rand;
        const p = this._p;
        const v = this._v;
        for (let k = 0; k < count; k += 1) {
            // Uniform in the ball, a little flattened.
            const a = r() * Math.PI * 2;
            const y = r() * 2 - 1;
            const rr = radius * Math.cbrt(r());
            const s = Math.sqrt(1 - y * y);
            p.set(pos.x + Math.cos(a) * s * rr, pos.y + y * rr * 0.8, pos.z + Math.sin(a) * s * rr);
            v.set((r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 6);
            this.spawn(
                t0 + r() * seconds,
                p,
                v,
                0.09 + r() * 0.1,
                this._c2.copy(color).multiplyScalar(3.4 + r() * 2),
                0.42,
                3.0,
                2.0,
                KIND.spark,
            );
        }
    }

    /**
     * Launch one shell now; it bursts on arrival.
     * @param {number} t      world time
     * @param {object} o      { color (THREE.Color, linear), kind (SHELL_KINDS), scale (0.5..1.8),
     *                         delay (s), stars (count), x (-0.5..0.5: where across the spread it
     *                         bursts; random without), high (0..1: higher), rise (s: the shell's
     *                         flight; random without) }
     */
    launch(t, o = {}) {
        const r = this.rand;
        this.now = t;
        const t0 = t + (o.delay ?? 0);
        const base = FIREWORKS.barge.clone().add(new THREE.Vector3((r() - 0.5) * 18, 0, (r() - 0.5) * 12));
        const across = Number.isFinite(o.x) ? THREE.MathUtils.clamp(o.x, -0.5, 0.5) + (r() - 0.5) * 0.06 : r() - 0.5;
        const falls = o.kind === 'willow' || o.kind === 'brocade';
        const burst = new THREE.Vector3(
            FIREWORKS.centreX + across * FIREWORKS.spreadX,
            FIREWORKS.burstMin + r() * (FIREWORKS.burstMax - FIREWORKS.burstMin) * (falls ? 1.1 : 1)
                + THREE.MathUtils.clamp(o.high ?? 0, 0, 1) * HIGH_LIFT,
            FIREWORKS.barge.z + (r() - 0.5) * FIREWORKS.spreadZ,
        );
        // The shell's flight time: a salute's shells share one, so they burst together.
        const rise = Number.isFinite(o.rise) ? THREE.MathUtils.clamp(o.rise, 0.8, 1.8) : 1.05 + r() * 0.35;
        // The shell: solve the launch velocity so drag-free flight reaches the burst point at `rise`.
        const v = burst.clone().sub(base).divideScalar(rise);
        v.y += 0.5 * G * rise;
        const shellCol = this._c.setRGB(1.0, 0.72, 0.42).multiplyScalar(2.2);
        this.spawn(t0, base, v, rise, shellCol, 0.55, 1e-3, G, KIND.shell);
        // The mortar's flash on the barge.
        this.spawn(t0, base, this._v.set(0, 3, 0), 0.14, this._c.setRGB(1.0, 0.8, 0.55).multiplyScalar(3.5), 2.6, 1.0, 0, KIND.spark);
        // A tail of sparks shed along the way.
        const tail = 14;
        for (let k = 0; k < tail; k += 1) {
            const f = (k + 0.5) / tail;
            const tk = f * rise;
            const at = base.clone().addScaledVector(v, tk).add(new THREE.Vector3(0, -0.5 * G * tk * tk, 0));
            this.spawn(
                t0 + tk,
                at,
                new THREE.Vector3((r() - 0.5) * 3, -2 - r() * 3, (r() - 0.5) * 3),
                0.5 + r() * 0.4,
                this._c.setRGB(1.0, 0.6, 0.3).multiplyScalar(1.4),
                0.32,
                2.0,
                4,
                KIND.spark,
            );
        }
        this.pending.push({
            at: t0 + rise,
            pos: burst,
            color: (o.color ?? new THREE.Color(FIREWORK_COLORS[0])).clone(),
            kind: o.kind ?? 'peony',
            scale: o.scale ?? 1,
            stars: o.stars ?? 150,
        });
    }

    /** Spawn the stars of every burst whose shell has arrived. */
    update(t) {
        this.now = t;
        for (let i = this.pending.length - 1; i >= 0; i -= 1) {
            const b = this.pending[i];
            if (t < b.at) continue;
            this.pending.splice(i, 1);
            this.burst(b);
        }
    }

    /**
     * `count` stars flung evenly over a sphere (a golden spiral) from `pos`.
     * @param {object} s  { speed, life, drag, gravity, level, size, kind, trail, every (the
     *                    colour of every `every`-th star: `alt`) }
     */
    sphere(at, pos, count, color, s, alt = null) {
        const r = this.rand;
        const v = this._v;
        for (let k = 0; k < count; k += 1) {
            const y = 1 - (2 * (k + 0.5)) / count;
            const rad = Math.sqrt(1 - y * y);
            const phi = k * 2.399963;
            const sp = s.speed * (0.85 + r() * 0.3);
            v.set(Math.cos(phi) * rad * sp, y * sp, Math.sin(phi) * rad * sp);
            const c = alt && s.every && k % s.every === 0 ? alt : color;
            this.star(
                at,
                pos,
                v,
                s.life + r() * 0.7,
                this._c.copy(c).multiplyScalar(s.level),
                s.size,
                s.drag,
                s.gravity,
                s.kind ?? KIND.star,
                s.trail ?? 0,
            );
        }
    }

    /** `count` stars flung round a ring square to `axis` from `pos`. */
    ring(at, pos, count, color, axis, s) {
        const r = this.rand;
        const t1 = this._a.crossVectors(axis, this._p.set(1, 0, 0)).normalize();
        const t2 = this._b.crossVectors(axis, t1);
        const v = this._v;
        for (let k = 0; k < count; k += 1) {
            const a = (k / count) * Math.PI * 2;
            const sp = s.speed * (0.94 + r() * 0.12);
            v.copy(t1).multiplyScalar(Math.cos(a) * sp).addScaledVector(t2, Math.sin(a) * sp);
            this.star(
                at,
                pos,
                v,
                s.life + r() * 0.5,
                this._c.copy(color).multiplyScalar(s.level),
                s.size,
                s.drag,
                s.gravity,
                s.kind ?? KIND.star,
                s.trail ?? 0,
            );
        }
    }

    burst(b) {
        const r = this.rand;
        const {
            pos, color, kind, at,
        } = b;
        const k = b.scale;
        const n = b.stars;
        const alt = new THREE.Color(FIREWORK_COLORS[Math.floor(r() * FIREWORK_COLORS.length)]);
        const axis = new THREE.Vector3(r() - 0.5, 1, r() - 0.5).normalize();
        const plain = {
            speed: 40 * k, life: 2.1, drag: 1.45, gravity: 3.0, level: 3.2, size: 0.72,
        };
        if (kind === 'ring') {
            this.ring(at, pos, Math.round(n * 0.5), color, axis, { ...plain, trail: 1 });
        } else if (kind === 'saturn') {
            // A ring round a core of another colour.
            this.ring(at, pos, Math.round(n * 0.45), color, axis, { ...plain, speed: 46 * k, trail: 1 });
            this.sphere(at, pos, Math.round(n * 0.4), alt, { ...plain, speed: 20 * k, life: 1.8 });
        } else if (kind === 'pistil') {
            // A sphere with a slower core of another colour inside it.
            this.sphere(at, pos, Math.round(n * 0.75), color, plain);
            this.sphere(at, pos, Math.round(n * 0.3), alt, {
                ...plain, speed: 17 * k, life: 1.9, kind: KIND.glitter,
            });
        } else if (kind === 'chrys') {
            this.sphere(at, pos, Math.round(n * 0.75), color, {
                ...plain, kind: KIND.glitter, trail: 1, every: 7,
            }, alt);
        } else if (kind === 'willow' || kind === 'brocade') {
            // Gold branches that fall a long way: every star trails, and the trails droop.
            const crown = kind === 'brocade';
            this.sphere(at, pos, Math.round(n * (crown ? 0.62 : 0.5)), WILLOW_GOLD, {
                speed: (crown ? 35 : 27) * k,
                life: crown ? 4.3 : 3.8,
                drag: crown ? 0.95 : 1.0,
                gravity: crown ? 5.2 : 6.0,
                level: 2.4,
                size: 0.6,
                kind: KIND.glitter,
                trail: crown ? 4 : 3,
            });
        } else if (kind === 'palm') {
            // A few thick arms thrown up and out, each with a long trail, crackling at their ends.
            const arms = 9 + Math.floor(r() * 4);
            const v = this._v;
            const tip = this._p;
            const life = 2.5;
            for (let a = 0; a < arms; a += 1) {
                const az = ((a + r() * 0.5) / arms) * Math.PI * 2;
                const el = 0.5 + r() * 0.7;
                const sp = 37 * k * (0.9 + r() * 0.2);
                v.set(Math.cos(az) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(az) * Math.cos(el) * sp);
                this.star(at, pos, v, life + r() * 0.4, this._c.copy(color).multiplyScalar(3.0), 0.95, 1.05, 7.0, KIND.star, 7, 0.05);
                Fireworks.travel(pos, v, 1.05, 7.0, life * 0.8, tip);
                this.crackle(at + life * 0.7, tip.clone(), 4.5 * k, Math.max(3, Math.round(n * 0.03)), 0.5);
            }
        } else if (kind === 'crossette') {
            // Stars that fly out and split in four.
            const stars = 14;
            const split = 0.7;
            const v = this._v;
            const at2 = at + split;
            const drag = 1.25;
            for (let s = 0; s < stars; s += 1) {
                const y = 1 - (2 * (s + 0.5)) / stars;
                const rad = Math.sqrt(1 - y * y);
                const phi = s * 2.399963;
                const sp = 38 * k;
                v.set(Math.cos(phi) * rad * sp, y * sp, Math.sin(phi) * rad * sp);
                this.star(at, pos, v, split, this._c.copy(color).multiplyScalar(3.4), 0.85, drag, 3.0, KIND.star, 2);
                const where = Fireworks.travel(pos, v, drag, 3.0, split, new THREE.Vector3());
                const along = v.clone().normalize();
                const side = new THREE.Vector3().crossVectors(along, this._p.set(0.3, 1, 0.2)).normalize();
                const up = new THREE.Vector3().crossVectors(along, side);
                const carry = v.clone().multiplyScalar(Math.exp(-drag * split) * 0.5);
                for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const child = carry.clone().addScaledVector(side, a * 15 * k).addScaledVector(up, c * 15 * k);
                    this.star(at2, where, child, 1.2 + r() * 0.3, this._c.copy(s % 2 ? alt : color).multiplyScalar(3.0), 0.6, 1.5, 3.5, KIND.star, 1);
                }
            }
        } else if (kind === 'strobe') {
            // White stars that stop, hang and blink.
            this.sphere(at, pos, Math.round(n * 0.45), WHITE, {
                speed: 34 * k, life: 3.0, drag: 2.7, gravity: 0.9, level: 2.6, size: 0.6, kind: KIND.strobe,
            });
            this.sphere(at, pos, Math.round(n * 0.25), color, { ...plain, speed: 44 * k, life: 1.3 });
        } else if (kind === 'crackle') {
            // A small burst that sets off a cloud of popping sparks.
            this.sphere(at, pos, Math.round(n * 0.3), color, { ...plain, speed: 30 * k, life: 1.2 });
            this.crackle(at + 0.25, pos.clone(), 19 * k, Math.round(n * 0.9), 1.1);
        } else {
            // Peony: a plain sphere, every seventh star another colour.
            this.sphere(at, pos, n, color, { ...plain, every: 7 }, alt);
        }
        // Light the sky round the burst: it joins the weaker glow, adding to what is still lit.
        const [g0, g1] = this.glows;
        const glow = g0.swell.valueAt(b.at) <= g1.swell.valueAt(b.at) ? g0 : g1;
        const before = glow.swell.valueAt(b.at);
        glow.swell.hit(b.scale, b.at);
        const gold = kind === 'willow' || kind === 'brocade';
        const lit = gold ? WILLOW_GOLD : b.color;
        if (before < 0.02) {
            // Nothing lit there: it starts where the burst is.
            glow.pos.copy(pos);
            glow.aim.copy(pos);
            glow.color.copy(lit);
            glow.tint.copy(lit);
        } else {
            // Lit: its centre and colour move toward the new burst by the burst's share of the light.
            const share = b.scale / (before + b.scale);
            glow.aim.lerp(pos, share);
            glow.tint.lerp(lit, share);
            // Blended colours drift toward white: keep the smoke-lit sky a colour, not a haze.
            glow.tint.getHSL(this._hsl);
            if (this._hsl.s < 0.75) glow.tint.setHSL(this._hsl.h, 0.75, this._hsl.l);
        }
        this.onBurst?.(b);
    }

    /**
     * A roman candle's comet: one bright star with a long trail thrown from `from` at `velocity`,
     * ending in a puff of crackle.
     * @param {number} t
     * @param {object} o  { from, velocity (THREE.Vector3), color, delay, life, size, crackle }
     */
    comet(t, o) {
        this.now = t;
        const t0 = t + (o.delay ?? 0);
        const life = o.life ?? 1.5;
        const drag = 0.55;
        const color = this._c.copy(o.color ?? WILLOW_GOLD).multiplyScalar(2.6);
        this.star(t0, o.from, o.velocity, life, color, o.size ?? 0.8, drag, G, KIND.star, 7, 0.05);
        // The mortar's flash on the deck.
        this.spawn(t0, o.from, this._v.set(0, 2, 0), 0.12, this._c2.setRGB(1.0, 0.82, 0.6).multiplyScalar(3), 1.8, 1.0, 0, KIND.spark);
        const n = o.crackle ?? 10;
        if (n > 0) {
            const end = Fireworks.travel(o.from, o.velocity, drag, G, life * 0.92, new THREE.Vector3());
            this.crackle(t0 + life * 0.86, end, 3.6, n, 0.35);
        }
    }

    /**
     * A waterfall of sparks off an edge (the pier's seaward side): `count` gold sparks let fall
     * from the line a → b over `seconds`, lit from a's end to b's over `sweep` seconds.
     * @param {number} t
     * @param {object} o  { a, b (THREE.Vector3), count, seconds, sweep, color }
     */
    waterfall(t, o) {
        this.now = t;
        const r = this.rand;
        const p = this._p;
        const v = this._v;
        const seconds = o.seconds ?? 4;
        const sweep = o.sweep ?? 0.9;
        const color = o.color ?? WILLOW_GOLD;
        for (let k = 0; k < o.count; k += 1) {
            const f = r();
            p.copy(o.a).lerp(o.b, f);
            p.x += (r() - 0.5) * 0.5;
            p.z += (r() - 0.5) * 0.5;
            v.set((r() - 0.5) * 1.6, -0.6 - r() * 2.2, (r() - 0.5) * 1.6);
            // Thick at first, thinning out toward the end.
            const when = f * sweep + (r() ** 1.35) * seconds;
            this.spawn(
                t + when,
                p,
                v,
                0.95 + r() * 0.5,
                this._c.copy(color).multiplyScalar(2.0 + r() * 1.6),
                0.3 + r() * 0.12,
                0.5,
                8.6,
                KIND.glitter,
            );
        }
    }

    /**
     * A Catherine wheel's spray: sparks thrown off a turning rim along its tangent.
     * @param {number} t
     * @param {object} o  { center, ax, ay (unit vectors spanning the rim's plane), radius, count,
     *                    seconds, speed, spin (±1), colorA, colorB }
     */
    spray(t, o) {
        this.now = t;
        const r = this.rand;
        const p = this._p;
        const v = this._v;
        const spin = o.spin ?? 1;
        // The spray leaves from a few jets round the rim, which turn with it.
        const jets = 5;
        const turn = (o.turn ?? 3.2) * spin;
        for (let k = 0; k < o.count; k += 1) {
            const when = r() * o.seconds;
            const a = ((k % jets) / jets) * Math.PI * 2 + turn * when + (r() - 0.5) * 0.12;
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            p.copy(o.center).addScaledVector(o.ax, ca * o.radius).addScaledVector(o.ay, sa * o.radius);
            const sp = o.speed * (0.7 + r() * 0.6);
            const out = r() * 0.35;
            v.set(0, 0, 0)
                .addScaledVector(o.ax, (-sa * spin + ca * out) * sp)
                .addScaledVector(o.ay, (ca * spin + sa * out) * sp);
            v.x += (r() - 0.5) * 3;
            v.z += (r() - 0.5) * 3;
            const c = r() < 0.5 ? o.colorA : o.colorB;
            this.star(t + when, p, v, 0.7 + r() * 0.55, this._c.copy(c).multiplyScalar(3.0), 0.42, 1.3, 7.0, KIND.star, 2, 0.04);
        }
    }

    /** The sky glows' summed light at `t` (unscaled), for the post stack's bloom. */
    glowLight(t) {
        return this.glows[0].swell.valueAt(t) + this.glows[1].swell.valueAt(t);
    }

    /** Write the two sky glows into the world uniforms (direction from the rest eye, strength). */
    writeGlows(t, scale) {
        this._eye ??= new THREE.Vector3(RIG.x, RIG.height, RIG.z);
        this._dir ??= new THREE.Vector3();
        const dt = t - this.glowClock;
        this.glowClock = t;
        const follow = dt > 0 && dt < 0.5 ? 1 - Math.exp(-GLOW_FOLLOW * dt) : 1;
        this.glows.forEach((g, i) => {
            g.pos.lerp(g.aim, follow);
            g.color.lerp(g.tint, follow);
            const dir = this._dir.copy(g.pos).sub(this._eye).normalize();
            const uni = i === 0 ? this.u.burst0 : this.u.burst1;
            const col = i === 0 ? this.u.burstCol0 : this.u.burstCol1;
            uni.value.set(dir.x, dir.y, dir.z, g.swell.valueAt(t) * scale);
            col.value.copy(g.color);
        });
    }

    clear() {
        this.pending.length = 0;
        for (let i = 0; i < this.capacity; i += 1) this.iSpawn.array[i * 4 + 3] = -1e6;
        this.iSpawn.clearUpdateRanges();
        this.iSpawn.needsUpdate = true;
        this.glows.forEach((g) => g.swell.reset());
        this.glowClock = Number.NaN;
    }

    dispose() {
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
