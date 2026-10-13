/**
 * Solar Eclipse — the salt mirror: the water under every direction that looks down.
 *
 * waterAt() is called inside the dome's fragment function for a direction below the horizon. It
 * finds where that direction meets the water (MIRROR.eye metres under the lens), how the water
 * there is tilted, and so the direction the water sends the eye on to: the dome then draws the
 * sky in THAT direction, so the black sun, its corona, the far shore and every event stand in
 * the mirror without being drawn twice.
 *
 *   swell     three long, faint swells, fading wherever a wave would be finer than a few pixels
 *             (far off the water is glass); the wind's patches roughen some reaches and leave
 *             others still, and a chain (u.glass) stills them all
 *   ripples   rings the gameplay drops (a lock at the card's foot, a clear into the sun's own
 *             reflection) and a whirl for a T-spin: a short train of crests spreading and dying
 *   salt      the crust's polygons near the lens: dry ridges between them break the mirror and
 *             catch the light of the horizon; they fade into the film with distance
 *   glint     the diamond's light laid on the water as a glitter path (an analytic facet
 *             distribution, sparkling where its facets can be resolved)
 */
import {
    Loop,
    If,
    atan,
    clamp,
    cos,
    dot,
    exp,
    float,
    floor,
    fract,
    int,
    length,
    log2,
    max,
    min,
    mix,
    normalize,
    pow,
    select,
    sin,
    smoothstep,
    sqrt,
    vec2,
    vec3,
} from 'three/tsl';
import { MIRROR, TAU } from './solar-eclipse-core.js';
import { noiseAt, seGauss, seHash21 } from './solar-eclipse-tsl.js';

const RIPPLE_K = TAU / MIRROR.rippleLength;

/**
 * @param {{ u: object, noise: THREE.Texture, tier: object }} env
 * @param {Node} d  vec3, the unit direction, looking down
 * @returns {{ look: Node, mirror: Node, salt: Node, g: Node, foot: Node, n: Node }}
 *   look    the direction the water sends the eye on to (always above the horizon)
 *   mirror  how much of the sky the water returns (Fresnel over the salt's own floor)
 *   salt    how much of the pixel is a dry ridge of the crust, 0..1
 *   g       the ground point (metres), `foot` the metres one pixel spans there, `n` the normal
 */
export function waterAt(env, d) {
    const { u, noise, tier } = env;
    const t = u.time;
    const down = max(d.y.negate(), 1e-5);
    const s = float(MIRROR.eye).div(down);
    const g = vec2(d.x, d.z).mul(s).toVar();
    const dist = length(g).toVar();
    // Metres one pixel spans along the line of sight (the depth footprint).
    const foot = s.mul(u.texel).div(down).toVar();
    const slope = vec2(0.0, 0.0).toVar();

    // ── The swell, and the wind's patches ──
    if (tier.swell) {
        const patch = noiseAt(noise, g.mul(1 / 42).add(vec2(t.mul(0.0019), 0.31)), 0).r;
        const wind = smoothstep(0.32, 0.74, patch).mul(float(1.0).sub(u.glass.mul(0.88)));
        MIRROR.swell.forEach(([len, amp, heading, speed]) => {
            const dir = vec2(Math.cos(heading), Math.sin(heading));
            const k = TAU / len;
            const phase = dot(g, dir).mul(k).sub(t.mul(speed * k));
            // A wave finer than about six pixels would only alias: there the water is glass.
            const seen = smoothstep(2.5, 6.5, float(len).div(foot));
            slope.addAssign(dir.mul(cos(phase).mul(amp).mul(seen)));
        });
        slope.mulAssign(wind.mul(0.8).add(0.2).mul(float(1.0).sub(u.glass.mul(0.6))));
    }

    // ── The rings and whirls the gameplay drops ──
    const ringSeen = smoothstep(1.6, 5.0, float(MIRROR.rippleLength).div(foot));
    If(ringSeen.greaterThan(0.001), () => {
        Loop({
            start: int(0), end: int(MIRROR.ripples), type: 'int', condition: '<', name: 'rp',
        }, ({ rp: i }) => {
            const A = u.ripples.element(i.mul(2)); // (x, z, dropped at, strength)
            const B = u.ripples.element(i.mul(2).add(1)); // (kind, turn, −, −)
            const age = t.sub(A.z);
            If(A.w.greaterThan(0.001).and(age.greaterThan(0.0)).and(age.lessThan(MIRROR.rippleLife * 1.6)), () => {
                const v = g.sub(A.xy);
                const rho = max(length(v), 1e-3);
                const out = v.div(rho);
                If(B.x.lessThan(0.5), () => {
                    // A ring: a short train of crests spreading, the slope thinning as it widens
                    // (core.js ringSlope reads the same).
                    const front = age.mul(MIRROR.rippleSpeed);
                    const x = rho.sub(front);
                    const width = age.mul(0.35).add(1.1).mul(MIRROR.rippleLength);
                    const envelope = seGauss(x.div(width)).mul(exp(age.div(-MIRROR.rippleLife * 0.4)));
                    const spread = float(1.0).div(sqrt(front.mul(1.4).add(1.0)));
                    slope.addAssign(out.mul(A.w.mul(envelope).mul(spread).mul(cos(x.mul(RIPPLE_K))).mul(ringSeen)));
                }).Else(() => {
                    // A whirl: spiral crests wound round the centre, turning, spreading, dying.
                    const ang = atan(v.y, v.x);
                    const reach = age.mul(1.1).add(1.4);
                    const envelope = exp(rho.div(reach).negate()).mul(exp(age.div(-2.2)))
                        .mul(smoothstep(0.0, 0.4, age));
                    const arms = sin(rho.mul(RIPPLE_K * 0.55).sub(ang.mul(3.0)).sub(age.mul(B.y)));
                    const across = vec2(out.y.negate(), out.x);
                    slope.addAssign(across.mul(0.6).add(out.mul(0.4)).mul(arms.mul(envelope).mul(A.w).mul(ringSeen)));
                });
            });
        });
    });

    // ── The mirror ──
    const n = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate())).toVar();
    const reflected = d.sub(n.mul(dot(d, n).mul(2.0)));
    // Never down into the water again: a steep crest would hand the sky's own floor back.
    const look = normalize(vec3(reflected.x, max(reflected.y, 0.0004), reflected.z)).toVar();
    const facing = max(dot(d, n).negate(), 0.0);
    const fresnel = pow(float(1.0).sub(facing), 5.0).mul(0.98).add(0.02);
    const mirror = mix(float(MIRROR.floor), float(1.0), fresnel).toVar();

    // ── The salt crust near the lens ──
    const salt = float(0.0).toVar();
    if (tier.salt) {
        const near = float(1.0).sub(smoothstep(MIRROR.polygonsTo * 0.45, MIRROR.polygonsTo, dist));
        If(near.greaterThan(0.001), () => {
            // The crust is never a clean honeycomb: its borders wander and swell.
            const wander = noiseAt(noise, g.mul(0.11).add(vec2(0.37, 0.71)), 0).rg.sub(0.5);
            const at = g.div(MIRROR.cell).add(wander.mul(0.55));
            const id = floor(at);
            const f = fract(at);
            const f1 = float(8.0).toVar();
            const f2 = float(8.0).toVar();
            const crust = float(0.0).toVar();
            for (let j = -1; j <= 1; j += 1) {
                for (let i = -1; i <= 1; i += 1) {
                    const o = vec2(i, j);
                    const cell = id.add(o);
                    const jitter = vec2(seHash21(cell), seHash21(cell.add(17.31))).mul(0.78).add(0.11);
                    const r = o.add(jitter).sub(f);
                    const dd = dot(r, r);
                    // The nearest seed's own crust: some polygons' ridges stand higher.
                    crust.assign(select(dd.lessThan(f1), seHash21(cell.add(5.7)), crust));
                    f2.assign(min(f2, max(f1, dd)));
                    f1.assign(min(f1, dd));
                }
            }
            // About the distance to the border between the two nearest seeds (metres).
            const edge = sqrt(f2).sub(sqrt(f1)).mul(0.5 * MIRROR.cell);
            // Its ridges swell and thin along their length, and sink under the film here and there.
            const along = noiseAt(noise, g.mul(0.42).add(vec2(0.13, 0.58)), 0);
            const half = crust.mul(0.5).add(along.b.mul(0.9)).add(0.2).mul(MIRROR.rim);
            const blur = max(half, foot.mul(0.75));
            const ridge = float(1.0).sub(smoothstep(blur.mul(0.45), blur, edge));
            const standing = smoothstep(0.3, 0.55, along.a.add(crust.mul(0.25)));
            // Far off, a ridge thinner than a pixel only greys it: keep its share, not its width.
            salt.assign(ridge.mul(half.div(blur)).mul(near).mul(standing.mul(0.55).add(0.25)));
        });
    }

    return {
        look, mirror, salt, g, foot, n,
    };
}

/**
 * The diamond's light on the water: the glitter path. `d` looks down, `n` is the water's normal
 * there; the facets too fine to model are a slope distribution of width SIGMA, so the path is a
 * narrow column standing under the reflected diamond, sparkling where a facet is resolved.
 */
const SIGMA = 0.016;

export function glintAt(env, d, n, g, foot) {
    const { u, noise } = env;
    const h = normalize(u.glint.xyz.sub(d)).toVar();
    // The half vector's tilt off the water's own normal, in its plane.
    const hn = max(dot(h, n), 1e-3);
    const tilt = h.sub(n.mul(hn)).div(hn);
    const facets = exp(dot(tilt, tilt).div(SIGMA * SIGMA).negate());
    // Sparkles: single facets flashing, the grain read at the level its footprint asks for.
    const lod = clamp(log2(max(foot.mul(0.35 * 256), 1.0)), 0.0, 6.0);
    const grain = noiseAt(noise, g.mul(0.35).add(vec2(u.time.mul(0.05), u.time.mul(-0.03))), lod).a;
    const resolved = smoothstep(4.0, 1.5, lod);
    const sparkle = mix(float(1.0), pow(grain, 6.0).mul(22.0), resolved.mul(0.85));
    return facets.mul(sparkle).mul(u.glint.w);
}

/** The shadow bands racing over the salt as the light breaks through (a factor about 1). */
export function bandsAt(env, g) {
    const { u } = env;
    const a = sin(dot(g, vec2(0.94, 0.34)).mul(5.2).sub(u.time.mul(13.0)));
    const b = sin(dot(g, vec2(0.71, -0.7)).mul(3.1).sub(u.time.mul(9.0)).add(1.7));
    return float(1.0).add(a.mul(b).mul(0.55).add(a.mul(0.25)).mul(u.bands));
}
