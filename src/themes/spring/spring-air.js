/**
 * Spring — the air over the valley: willow down and birch pollen drifting on the breeze over the
 * knoll and the river, glowing where the sun stands behind them.
 *
 * One mesh of camera-facing quads (an instanced geometry with no instance data at all): where a
 * mote is follows from its index and the air's clock alone, in the vertex shader, so nothing is
 * written per frame but a few uniforms. Each mote has a home at a bearing and a distance from the
 * eye (log-spaced, so the near air is as full as the far), runs down the breeze from it over a
 * span and is born again upwind, wobbling across the breeze and bobbing as it goes. A share of
 * the motes is down (larger, soft, white, blazing against the sun), the rest pollen (fine gold
 * specks that flicker as they turn).
 *
 * The game moves the air (the world integrates its clocks and eases its uniforms, spring-world.js):
 *   lock          the air puffs out and up round the patch of bloom the lock opened, and lights
 *   clear         a breath runs out across the valley from the eye: a band that lifts and lights
 *                 the motes as it passes, the stronger the more lines
 *   chain         the air stirs: it thickens, runs faster down the breeze, wobbles wider, and two
 *                 slow gyres turn it on either side of the card, the faster the longer the chain
 *   back-to-back  the motes sparkle
 *   perfect       the air stills and turns gold
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    Loop,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    int,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    pow,
    sin,
    smoothstep,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import { DEG } from './spring-core.js';
import { EYE, EYE_GROUND } from './spring-plan.js';
import { airClarity } from './spring-light.js';
import { EVENT_ROWS, PATCHES, spHash21 } from './spring-tsl.js';

/**
 * Where the air is and how it moves:
 *   near, far     distances from the eye the motes' homes span (m, log-spaced)
 *   from, to      bearings they span (degrees right of the view axis; the portrait lens turns left)
 *   span          how far a mote runs down the breeze before it is born again upwind (m, near … far)
 *   speed         how fast the breeze carries it (m/s, slowest … fastest)
 *   down          the share of the motes that are willow down (the rest pollen)
 *   breeze        the breeze across the knoll (unit x, z): down the valley, toward the right
 *   gyre          the chain's two gyres, left and right of the card: how far out on the knoll's
 *                 top they stand (m, short of its brow: beyond it a whirl's foot is hidden), which
 *                 way each turns (+1 clockwise seen from above) and how far their turning reaches
 *                 (m). Where they stand follows the layout (SpringWorld.placeGyres writes
 *                 `u.airGyres`); `rest` is where they stand in the landscape lens beside the card.
 */
export const AIR = Object.freeze({
    near: 2.2,
    far: 85,
    from: -54,
    to: 46,
    span: Object.freeze([14, 70]),
    speed: Object.freeze([0.5, 1.4]),
    down: 0.3,
    breeze: Object.freeze([0.86, -0.51]),
    gyre: Object.freeze({
        distance: 9.5,
        turn: Object.freeze([1, -1]),
        reach: 9,
        rest: Object.freeze([-4.6, -8.3, 4.6, -8.3]),
    }),
});

const LOG_NEAR = Math.log(AIR.near);
const LOG_FAR = Math.log(AIR.far);

/** The quad every mote is drawn on (corners ±0.5). */
function quad() {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.getAttribute('position'));
    return geometry;
}

export class SpringAir {
    constructor(u, count = 1200) {
        this.u = u;
        this.count = Math.max(1, Math.round(count));
        this.geometry = quad();
        this.geometry.instanceCount = this.count;
        this.material = this.createMaterial();
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.name = 'SpringAir';
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 29;
    }

    createMaterial() {
        const { u } = this;
        const material = new THREE.MeshBasicNodeMaterial();
        material.name = 'SpringAir';
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.premultipliedAlpha = true;
        material.fog = false;
        // The mote's light (rgb) and whether it is down (w), worked out once a corner.
        const vGlow = varying(vec4(0.0), 'spAirGlow');
        material.vertexNode = Fn(() => {
            const i = float(instanceIndex);
            const h1 = spHash21(vec2(i, 1.7));
            const h2 = spHash21(vec2(i, 9.3));
            const h3 = spHash21(vec2(i, 23.1));
            const h4 = spHash21(vec2(i, 41.9));
            const h5 = spHash21(vec2(i, 57.3));
            const h6 = spHash21(vec2(i, 71.1));
            const isDown = smoothstep(1.0 - AIR.down - 0.001, 1.0 - AIR.down, h5);
            const clock = u.air.x;
            const gyre = u.air.y;
            const stir = u.air.z;
            const still = u.air.w;

            // Its home, and its run down the breeze from there.
            const dist = exp(mix(float(LOG_NEAR), float(LOG_FAR), h1));
            const bearing = mix(float(AIR.from * DEG), float(AIR.to * DEG), h2);
            const home = vec2(sin(bearing).mul(dist).add(EYE.x), cos(bearing).mul(dist).negate().add(EYE.z));
            const span = mix(float(AIR.span[0]), float(AIR.span[1]), h1);
            const speed = mix(float(AIR.speed[0]), float(AIR.speed[1]), h3).mul(mix(float(1.0), float(0.7), isDown));
            const runK = fract(clock.mul(speed).div(span).add(h4)).sub(0.5);
            const breeze = vec2(AIR.breeze[0], AIR.breeze[1]);
            const across = vec2(breeze.y.negate(), breeze.x);
            const wobble = sin(clock.mul(mix(0.45, 1.1, h2)).add(h1.mul(40.0)))
                .mul(mix(0.35, 1.3, isDown)).mul(stir.mul(1.5).add(1.0));
            const drift = home.add(breeze.mul(runK.mul(span))).add(across.mul(wobble)).toVar();

            // The chain's gyres: the air within their reach turns about them, the inner faster.
            const lift = float(0.0).toVar();
            [u.airGyres.xy, u.airGyres.zw].forEach((at, k) => {
                // (Pinned before the move: an expression is emitted where it is read.)
                const rel = drift.sub(at).toVar();
                const reach = exp(length(rel).mul(-1.0 / AIR.gyre.reach)).toVar();
                const a = gyre.mul(reach).mul(AIR.gyre.turn[k]);
                const ca = cos(a);
                const sa = sin(a);
                const turned = vec2(rel.x.mul(ca).sub(rel.y.mul(sa)), rel.x.mul(sa).add(rel.y.mul(ca)));
                drift.assign(at.add(turned));
                lift.addAssign(stir.mul(reach).mul(1.6));
            });

            // Its height: over the knoll's turf near the eye, higher over the river and the valley.
            const nearH = h3.mul(h3).mul(4.0).add(EYE_GROUND + 0.2);
            const farH = mix(float(2.6), float(13.0), h3);
            const bob = sin(clock.mul(0.9).add(h4.mul(30.0))).mul(mix(0.15, 0.45, isDown));
            const y = mix(nearH, farH, smoothstep(9.0, 18.0, dist)).add(bob).add(lift);
            const centre = vec3(drift.x, y, drift.y).toVar();

            // A lock's puff: the air round its patch of bloom is pushed out and up, and lit.
            const puffLight = float(0.0).toVar();
            // (Not named `patch`: that is a reserved word in WGSL.)
            Loop({
                start: int(0), end: int(PATCHES), type: 'int', condition: '<', name: 'bloomRow',
            }, ({ bloomRow }) => {
                const row = u.events.element(bloomRow.mul(2).add(EVENT_ROWS.patch));
                const age = u.time.sub(row.z);
                const live = smoothstep(0.0, 0.35, age).mul(float(1.0).sub(smoothstep(1.5, 7.0, age)))
                    .mul(row.w);
                const away = centre.xz.sub(row.xy).toVar();
                const r = max(length(away), 0.05).toVar();
                const near = exp(r.mul(-0.35)).mul(live).toVar();
                centre.addAssign(vec3(away.x.div(r), 0.0, away.y.div(r)).mul(near.mul(2.2))
                    .add(vec3(0.0, near.mul(1.3), 0.0)));
                puffLight.addAssign(near);
            });

            // A clear's breath: a band running out from the eye that lifts and lights the air.
            const waveAge = u.time.sub(u.airWave.x);
            const reachNow = length(centre.xz.sub(vec2(EYE.x, EYE.z)));
            const waveLive = smoothstep(0.0, 0.2, waveAge).mul(float(1.0).sub(smoothstep(3.5, 7.0, waveAge)))
                .mul(u.airWave.y);
            const offFront = reachNow.sub(waveAge.mul(u.airWave.z)).div(reachNow.mul(0.12).add(2.0));
            const band = exp(offFront.mul(offFront).negate()).mul(waveLive);
            centre.addAssign(vec3(0.0, band.mul(1.4), 0.0));

            // On screen: at least about a pixel and a half wide, its light spread thinner when it is
            // drawn wider than it is (so a far speck does not shimmer away, nor glare).
            const view = cameraViewMatrix.mul(vec4(centre, 1.0));
            const depth = max(view.z.negate(), 0.01);
            const size = mix(mix(0.005, 0.011, h4), mix(0.014, 0.028, h4), isDown);
            const drawn = max(size, depth.mul(u.pixelAngle).mul(1.5));
            const cover = size.div(drawn).pow(2.0);
            const lifted = view.add(vec4(positionGeometry.xy.mul(drawn.mul(2.0)), 0.0, 0.0));

            // Seen: the chain thickens the air (more of the motes show), the ends of a run and the
            // nearest and farthest air fade.
            const shown = float(1.0).sub(smoothstep(mix(0.7, 1.0, stir).sub(0.08), mix(0.7, 1.0, stir), h6));
            const toEye = length(centre.sub(u.eye));
            const fade = shown
                .mul(float(1.0).sub(smoothstep(0.36, 0.5, runK.abs())))
                .mul(smoothstep(1.0, 2.4, toEye))
                .mul(float(1.0).sub(smoothstep(AIR.far * 0.7, AIR.far, toEye)));

            // Lit as fine matter in the air: dim from the sky, bright with the sun behind it (down far
            // more than pollen), through the valley's haze.
            const V = normalize(centre.sub(u.eye));
            const ahead = clamp(dot(V, u.sunDir), 0.0, 1.0);
            const a2 = ahead.mul(ahead);
            // (Down is white: the sun lights a tuft from any side; pollen is a dark speck but for a glint.)
            const pollenPhase = a2.mul(a2).mul(2.2).add(a2.mul(0.5)).add(0.42);
            const downPhase = a2.mul(a2).mul(3.6).add(a2.mul(0.6)).add(0.62);
            const phase = mix(pollenPhase, downPhase, isDown);
            const lit = u.sun.mul(u.sunUp).mul(phase).add(u.fill.mul(0.45));
            const tone = mix(vec3(1.0, 0.8, 0.42), vec3(1.0, 0.98, 0.93), isDown);
            const gold = mix(tone, vec3(1.0, 0.82, 0.48), still.mul(0.6));
            // Pollen turns as it flies and flickers; back-to-back makes every mote sparkle.
            const turn = sin(u.time.mul(mix(4.0, 9.0, h3)).add(h2.mul(60.0)));
            const flicker = mix(turn.mul(0.35).add(0.65), float(1.0), isDown);
            const glint = max(sin(u.time.mul(mix(2.5, 5.5, h5)).add(h1.mul(80.0))), 0.0);
            const sparkle = pow(glint, 12.0).mul(u.glory).mul(2.5);
            const gain = float(1.0).add(stir.mul(0.5)).add(still.mul(0.6)).add(band.mul(2.2))
                .add(puffLight.mul(1.6))
                .add(u.flush.mul(0.5));
            const glow = gold.mul(lit).mul(flicker.add(sparkle)).mul(gain).mul(fade)
                .mul(cover.mul(0.7).add(0.3))
                .mul(airClarity(u, centre).mul(0.75).add(0.25))
                .mul(0.5);
            vGlow.assign(vec4(glow, isDown));
            return fade.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0.0, 0.0, -2.0, 1.0));
        })();
        material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
        material.outputNode = Fn(() => {
            const corner = positionGeometry.xy.mul(2.0);
            const r2 = dot(corner, corner);
            // Pollen a bright point; down a soft tuft with a brighter heart.
            const speck = exp(r2.mul(-3.2));
            const tuft = exp(r2.mul(-2.0)).mul(0.75).add(exp(r2.mul(-8.0)).mul(0.5));
            return vec4(vGlow.xyz.mul(mix(speck, tuft, vGlow.w)), 0.0);
        })();
        return material;
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
