/**
 * Grainfields — the dust and chaff gameplay throws up over the field.
 *
 * The events used to be the sun through the storm deck alone (a beam, a tear, a front of light),
 * so at the four hours without a heavy deck they showed next to nothing; and from an eye 1.45 m
 * over a metre of barley anything that lies ON the field more than a dozen metres out is a strip
 * a few pixels high. What reads at every hour stands in the AIR over the stand: dust and chaff,
 * dull in the shade, gold in the sun and blazing with the sun beyond them.
 *
 *   puff    a cloud of the field's dry dust: it bursts out, slows, swells, rises on its own warmth
 *           and drifts off on the wind. It hides a little of what lies behind it (dust is not
 *           light), so it shows against a bright sky as well as against the storm
 *   flake   a husk, a fleck of straw or a petal of the field's wildflowers (poppy, cornflower, corn
 *           marigold, corncockle: the pieces' colours grow in the barley): it tumbles, catching
 *           the light as it turns, and flutters down. A thing, not a light: over the gold field
 *           and the bright sky a spark of added light is lost, a fleck with its own colour is not
 *   wound   a flake caught in a twist's dust devil: wound round the column's axis as it climbs,
 *           the spiral opening with its height, the axis walking over the field with the column
 *
 * One instanced quad per record in a ring the CPU writes when an event lands (where, which way,
 * when, how long, how big, which kind, what colour); the vertex stage flies each from its record
 * in closed form, so nothing is written per frame and a seek simply empties the ring. Records may
 * be born ahead of the clock (a front of wind that reaches a place a second from now).
 * Camera-facing. Blended as light plus cover: rgb is added and the target shows through by
 * 1 − alpha, and the target's own alpha is left alone.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    instanceIndex,
    length,
    max,
    mix,
    positionGeometry,
    select,
    sin,
    smoothstep,
    texture,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { deckShadow, gfHash21 } from './grainfields-tsl.js';

export const CHAFF_KIND = Object.freeze({ puff: 0, flake: 1, wound: 2 });

/**
 * How a dust devil walks over the field (metres a second, world x and z): slowly, across the view
 * and a little away. A constant, so a wound flake's place is a closed form of its own record (and
 * the column, its whirl in the barley and its flakes all walk together).
 */
export const DEVIL_WALK = Object.freeze([1.15, -0.45]);

/** A flake's half-length on the screen is at most this many pixels, however near it flies. */
const FLAKE_MAX_PX = 5.5;

/** Per second: `drag` slows a throw, `rise` lifts (a puff's warmth) or drops (a flake), `drift` the wind's share. */
const FLIGHT = Object.freeze({
    puff: Object.freeze({ drag: 2.2, rise: 0.55, drift: 0.6 }),
    flake: Object.freeze({ drag: 1.15, rise: -0.42, drift: 0.9 }),
});

/** Light plus cover: the colour is added over (1 − alpha) of the target; the target's alpha stays. */
export function lightAndCover(material) {
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendEquationAlpha = THREE.AddEquation;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.premultipliedAlpha = true;
    material.fog = false;
    return material;
}

function chaffMaterial(u, t) {
    const material = lightAndCover(new THREE.MeshBasicNodeMaterial());
    material.name = 'GrainfieldsChaff';
    material.side = THREE.DoubleSide;
    const aFrom = attribute('aFrom', 'vec4'); // spawn xyz, birth time
    const aGo = attribute('aGo', 'vec4'); // velocity xyz, life (s); wound: radius, climb, turn, life
    const aLook = attribute('aLook', 'vec4'); // size at birth, size grown, kind, seed (+ a puff's pigment, tenths, as its integer part)
    const aTint = attribute('aTint', 'vec4'); // colour rgb; wound: how fast the spiral opens (per metre)
    const vColour = varying(vec4(0.0), 'gfChaffColour'); // rgb (already times its cover), cover
    const vShape = varying(vec4(0.0), 'gfChaffShape'); // softness, seed, dust puff, drifting seed down
    material.positionNode = Fn(() => {
        const age = u.time.sub(aFrom.w).toVar();
        const life = max(aGo.w, 0.1);
        const k = clamp(age.div(life), 0.0, 1.0).toVar();
        const a = max(age, 0.0).toVar();
        const isPuff = aLook.z.lessThan(0.5);
        const isWound = aLook.z.greaterThan(1.5);
        // The light seed down in a perfect clear turns less than once per second. A devil's husks
        // spin several times faster round their column; both use the same spiral flight record.
        const down = isWound.and(aGo.z.abs().lessThan(1.0)).toVar();
        const h = gfHash21(vec2(float(instanceIndex), aLook.w.fract().mul(97.0))).toVar();
        // A throw slowing in the air, the rise (or the fall), the wind, a flake's flutter.
        const drag = select(isPuff, float(FLIGHT.puff.drag), float(FLIGHT.flake.drag));
        const rise = select(isPuff, float(FLIGHT.puff.rise), float(FLIGHT.flake.rise));
        const drift = select(isPuff, float(FLIGHT.puff.drift), float(FLIGHT.flake.drift));
        const thrown = aGo.xyz.mul(float(1.0).sub(exp(a.mul(drag).negate())).div(drag));
        const wind = vec3(u.windDir.x, 0.0, u.windDir.y).mul(u.windStrength.add(0.25).mul(drift).mul(a));
        const flutter = vec3(sin(a.mul(5.3).add(h.mul(40.0))), 0.0, sin(a.mul(4.1).add(h.mul(23.0))))
            .mul(select(isPuff, float(0.0), float(0.14)));
        const flown = aFrom.xyz.add(thrown).add(wind).add(vec3(0.0, rise.mul(a), 0.0)).add(flutter);
        // Wound round a dust devil's axis: climbing, the spiral opening, the axis walking.
        const climbed = aGo.y.mul(a);
        const turn = aLook.w.fract().mul(6.2832).add(aGo.z.mul(a));
        const out = aGo.x.mul(float(1.0).add(aTint.w.mul(climbed)));
        const wound = vec3(
            aFrom.x.add(a.mul(DEVIL_WALK[0])).add(cos(turn).mul(out)),
            aFrom.y.add(climbed),
            aFrom.z.add(a.mul(DEVIL_WALK[1])).add(sin(turn).mul(out)),
        );
        const centre = select(isWound, wound, flown).toVar();
        // A puff swells as it slows; a flake keeps its size.
        const size = mix(aLook.x, aLook.y, float(1.0).sub(exp(a.mul(-1.6)))).toVar();
        const dist = length(centre.sub(u.eye)).toVar();
        // Never under about a pixel; and a flake never over a few pixels either: one sized to show
        // sixty metres out would cross the frame as a blob when the wind carries it past the lens.
        const pixel = dist.mul(u.pixelAngle);
        const s = select(isPuff, max(size, pixel.mul(1.2)), size.clamp(pixel.mul(1.2), pixel.mul(FLAKE_MAX_PX)));
        const p = positionGeometry;
        // A flake is a fleck of straw or husk, longer than it is wide, tumbling as it flies (the
        // quad is squeezed and turned in the screen's plane); a puff is round.
        const tumble = h.mul(6.2832).add(a.mul(select(down, h.mul(0.7).add(0.42), h.mul(4.5).add(2.5))));
        const squeezed = vec2(p.x, p.y.mul(select(down, float(0.67), float(0.34))));
        const turned = vec2(
            squeezed.x.mul(cos(tumble)).sub(squeezed.y.mul(sin(tumble))),
            squeezed.x.mul(sin(tumble)).add(squeezed.y.mul(cos(tumble))),
        );
        const corner = select(isPuff, p.xy, turned);
        const at = centre.add(u.camRight.mul(corner.x.mul(s))).add(u.camUp.mul(corner.y.mul(s)));
        // Born quickly, gone over its last stretch; nothing before its birth. Right at the lens a
        // flake would be a blob across the frame: it thins out inside a couple of metres.
        const live = smoothstep(0.0, 0.07, k).mul(float(1.0).sub(smoothstep(0.5, 1.0, k)))
            .mul(select(age.greaterThan(0.0), float(1.0), float(0.0)))
            .mul(smoothstep(0.7, 2.2, dist))
            .toVar();
        // The sun through the deck at it, far more with the sun beyond it (dust scatters forward).
        const sunlit = deckShadow(u, t.noise, centre).mul(u.sunUp);
        const V = centre.sub(u.eye).normalize();
        const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
        const a2 = ahead.mul(ahead);
        const phase = a2.mul(a2).mul(1.8).add(a2.mul(0.5)).add(0.25);
        // A flake: a fleck of its own colour, lit as a leaf is (either face, more with the sun
        // beyond it), lighter and darker as it turns. Under a pixel it thins instead of standing
        // as a dot.
        const glint = sin(tumble.mul(1.6)).mul(select(down, float(0.12), float(0.29))).add(0.92);
        const area = size.div(s.max(1e-4)).clamp(0.0, 1.0);
        const cover = area.mul(area);
        const flakeLight = u.sun.mul(sunlit.mul(phase.mul(0.5).add(0.38))).add(u.fill.mul(1.3)).add(u.bounce.mul(0.5))
            .add(u.glow.mul(u.day.oneMinus().mul(0.25)));
        const flakeCover = live.mul(cover.mul(0.8).add(0.2)).mul(0.92);
        // (Half of the light's own hue is let go: under the golden hour's orange sun a blue petal
        // would be grey, and the petals are how a lock shows its piece.)
        const white = dot(flakeLight, vec3(0.2126, 0.7152, 0.0722));
        const flake = aTint.xyz.mul(0.62).mul(mix(flakeLight, vec3(white), 0.5)).mul(glint).mul(flakeCover);
        // A puff: the field's pale dust, lit as a cloud is (the sun, the sky, the barley's gold from
        // below), a breath of its event's colour in it. Its cover thins as it swells.
        // (aLook.w's integer part says how much of its event's pigment the dust carries: a lock's
        // puff is the piece's colour, a hard drop's the field's own dust with a breath of it.)
        const pigment = clamp(aLook.w.floor().mul(0.1), 0.0, 1.0);
        const dustTone = mix(vec3(0.5, 0.41, 0.28), aTint.xyz.mul(0.9).add(0.12), pigment);
        const dustLight = u.sun.mul(sunlit.mul(phase.mul(0.2).add(0.16))).add(u.fill.mul(1.25)).add(u.bounce.mul(0.7))
            .add(u.glow.mul(u.day.oneMinus().mul(0.2)));
        const thin = aLook.x.div(size.max(1e-3));
        const puffCover = live.mul(thin.mul(0.6).add(0.4)).mul(0.42);
        const puff = dustTone.mul(dustLight).mul(puffCover);
        vColour.assign(select(isPuff, vec4(puff, puffCover), vec4(flake, flakeCover)));
        const dust = select(isPuff, float(1.0), float(0.0));
        const silk = select(down, float(1.0), float(0.0));
        vShape.assign(vec4(select(isPuff, float(2.0), float(7.0)), h, dust, silk));
        // A dead record's quad collapses onto its spawn point at no size.
        return mix(aFrom.xyz, at, select(live.greaterThan(0.0), float(1.0), float(0.0)));
    })();
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const r2 = dot(q, q);
        // A flake is a crisp fleck (the squeezed quad makes it long); a puff is a soft ragged
        // cloudlet: a Gaussian, so it has no edge at all, bitten into bays and thinned in patches
        // by the noise (each puff reads its own patch of it).
        const fleck = float(1.0).sub(smoothstep(0.42, 1.0, r2.add(q.x.abs().mul(q.y.abs()))));
        // A dry seed with a silky fan: slim at the dark kernel, open and translucent toward its tip.
        const fanWidth = smoothstep(-0.72, 0.78, q.x).mul(0.86).add(0.12);
        const fan = smoothstep(-0.9, -0.52, q.x).mul(smoothstep(0.06, 0.36, float(1.0).sub(r2)))
            .mul(float(1.0).sub(smoothstep(fanWidth.mul(0.48), fanWidth, q.y.abs())));
        const soft = exp(r2.mul(vShape.x.negate()));
        const at = uv().mul(0.3).add(vec2(vShape.y, vShape.y.mul(7.3)));
        const billow = texture(t.noise, at).g;
        const wisp = texture(t.noise, at.mul(2.7).add(0.41)).b;
        const body = soft.mul(smoothstep(0.34, 0.64, billow.add(soft.mul(0.22)))).mul(wisp.mul(0.7).add(0.5));
        const shape = mix(mix(fleck, fan, vShape.w), body, vShape.z);
        return vec4(vColour.xyz.mul(shape), vColour.w.mul(shape));
    })();
    material.outputNode = material.colorNode;
    return material;
}

/**
 * The events' dust and chaff: a ring of `count` records. `fly({ x, y, z, vx, vy, vz, life, size,
 * grow, kind, rgb, seed, time })` throws one (a wound flake: `radius`, `climb`, `turn`, `open`; a
 * puff: `pigment`, the share of `rgb` in its dust);
 * `reset()` empties the ring. `share` (0.45..1) is how much of a full burst this ring can carry.
 */
export function createChaff(u, t, count = 900) {
    const ring = Math.max(160, Math.round(count));
    const plane = new THREE.PlaneGeometry(2, 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    const from = new Float32Array(ring * 4);
    const go = new Float32Array(ring * 4);
    const look = new Float32Array(ring * 4);
    const tint = new Float32Array(ring * 4);
    const empty = () => {
        from.fill(0);
        go.fill(0);
        look.fill(0);
        tint.fill(0);
        for (let i = 0; i < ring; i++) from[i * 4 + 3] = -1e6;
    };
    empty();
    const attrs = {
        aFrom: new THREE.InstancedBufferAttribute(from, 4),
        aGo: new THREE.InstancedBufferAttribute(go, 4),
        aLook: new THREE.InstancedBufferAttribute(look, 4),
        aTint: new THREE.InstancedBufferAttribute(tint, 4),
    };
    Object.entries(attrs).forEach(([name, a]) => {
        a.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, a);
    });
    // Draw one collapsed quad at rest so this pipeline warms with the scene.
    geometry.instanceCount = 1;
    const material = chaffMaterial(u, t);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsChaff';
    mesh.frustumCulled = false;
    mesh.renderOrder = 26.5;
    let next = 0;
    let dirty = false;
    let thrown = 0;
    let lastExpiry = -Infinity;

    return {
        mesh,
        meshes: [mesh],
        ring,
        share: Math.min(1, Math.max(0.45, Math.sqrt(ring / 900))),
        get thrown() { return thrown; },
        /** The records as written (tests read them). */
        records: {
            from, go, look, tint,
        },
        fly({
            x, y, z, vx = 0, vy = 1, vz = 0, life = 3, size = 0.03, grow = size, kind = CHAFF_KIND.flake, rgb = [1, 0.84, 0.5],
            seed = 0.5, time = 0, radius = 1, climb = 4, turn = 3, open = 0.1, pigment = 0.15,
        }) {
            const o = next * 4;
            const wound = kind === CHAFF_KIND.wound;
            from[o] = x;
            from[o + 1] = y;
            from[o + 2] = z;
            from[o + 3] = time;
            go[o] = wound ? radius : vx;
            go[o + 1] = wound ? climb : vy;
            go[o + 2] = wound ? turn : vz;
            go[o + 3] = life;
            look[o] = size;
            look[o + 1] = grow;
            look[o + 2] = kind;
            // (A puff's pigment share, in tenths, is the seed's integer part; the seed its fraction.)
            look[o + 3] = Math.min(0.999, Math.max(0, seed)) + (kind === CHAFF_KIND.puff ? Math.round(Math.min(1, Math.max(0, pigment)) * 10) : 0);
            tint[o] = rgb[0];
            tint[o + 1] = rgb[1];
            tint[o + 2] = rgb[2];
            tint[o + 3] = wound ? open : 0;
            geometry.instanceCount = Math.max(geometry.instanceCount, next + 1);
            lastExpiry = Math.max(lastExpiry, time + life);
            next = (next + 1) % ring;
            thrown += 1;
            dirty = true;
        },
        update(time) {
            if (geometry.instanceCount > 1 && time >= lastExpiry) {
                geometry.instanceCount = 1;
                next = 0;
            }
            if (!dirty) return;
            Object.values(attrs).forEach((a) => { a.needsUpdate = true; });
            dirty = false;
        },
        reset() {
            empty();
            next = 0;
            thrown = 0;
            lastExpiry = -Infinity;
            geometry.instanceCount = 1;
            dirty = true;
        },
        dispose() {
            geometry.dispose();
            plane.dispose();
            material.dispose();
        },
    };
}
