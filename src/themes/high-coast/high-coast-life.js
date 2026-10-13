/**
 * High Coast — gulls over the bay, and the lighthouse's light.
 *
 *  - Gulls wheel on the air over the water in slow circles (closed form in the clock), wings
 *    flapping now and then; the great rebound (four lines) startles them: they lift off the
 *    shores in a burst and climb before settling back to their rounds.
 *  - The lighthouse on its far island shows its character after sunset (two flashes every ten
 *    seconds) and, while a back-to-back run lasts, burns steady and sweeps its beam through the
 *    haze over the sea.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    clamp,
    dot,
    exp,
    float,
    max,
    mix,
    normalWorld,
    normalize,
    positionLocal,
    positionWorld,
    sin,
    smoothstep,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';
import { EYE, mulberry32, smooth } from './high-coast-core.js';
import { aerial, airClarity } from './high-coast-light.js';

/** The gulls' circles: centre, radius, height, angular speed, phase. */
export function gullRounds(count = 18, seed = 0x6011) {
    const random = mulberry32(seed);
    const out = [];
    const centres = [[-150, -700], [300, -700], [80, -1100], [600, -1300], [-300, -1300], [250, -500]];
    for (let i = 0; i < count; i++) {
        const c = centres[i % centres.length];
        out.push({
            x: c[0] + (random() - 0.5) * 160,
            z: c[1] + (random() - 0.5) * 160,
            r: 25 + random() * 70,
            h: 18 + random() * 45,
            w: (0.18 + random() * 0.16) * (random() < 0.5 ? -1 : 1),
            phase: random() * Math.PI * 2,
            seed: random(),
        });
    }
    return out;
}

/** A gull: two bent wings and a body, unit span (1.3 m in the world). */
function gullGeometry() {
    const v = [
        // left wing: inner panel, outer panel
        0, 0, 0, -0.32, 0.04, -0.06, -0.32, 0.04, 0.08,
        -0.32, 0.04, -0.06, -0.65, -0.03, -0.02, -0.32, 0.04, 0.08,
        // right wing
        0, 0, 0, 0.32, 0.04, 0.08, 0.32, 0.04, -0.06,
        0.32, 0.04, -0.06, 0.32, 0.04, 0.08, 0.65, -0.03, -0.02,
        // body
        0, 0, -0.18, -0.04, 0, 0.2, 0.04, 0, 0.2,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
}

export function createLife(u, t, tier, lantern) {
    const rounds = gullRounds([8, 12, 18][Math.min(2, Math.max(0, tier.props))]);
    const gullGeo = gullGeometry();
    const flap = new Float32Array(rounds.length * 4);
    const flapAttr = new THREE.InstancedBufferAttribute(flap, 4).setUsage(THREE.DynamicDrawUsage);
    gullGeo.setAttribute('aFlap', flapAttr);
    const gullMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    gullMat.name = 'HighCoastGulls';
    gullMat.fog = false;
    const fl = attribute('aFlap', 'vec4');
    gullMat.positionNode = Fn(() => {
        const p = positionLocal;
        // Wing tips beat up and down (the pace a constant; the amount per bird, per moment).
        const tip = p.x.abs().mul(1.6);
        const beat = sin(u.time.mul(7.0).add(fl.y.mul(40.0))).mul(fl.x).mul(tip).mul(0.35);
        return vec3(p.x, p.y.add(beat), p.z);
    })();
    gullMat.colorNode = Fn(() => {
        const P = positionWorld;
        const n = normalize(normalWorld);
        const albedo = vec3(0.7, 0.7, 0.68);
        const lit = albedo.mul(u.sun.mul(dot(n, u.sunDir).abs().mul(0.6).add(0.25)).mul(u.sunUp).add(u.fill.mul(1.1)));
        return vec4(aerial(u, P, lit), 1.0);
    })();
    const gulls = new THREE.InstancedMesh(gullGeo, gullMat, rounds.length);
    gulls.name = 'HighCoastGulls';
    gulls.frustumCulled = false;
    gulls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // The lighthouse's light: a glow facing the eye, and a beam ribbon rebuilt each frame.
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const glowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    glowMat.name = 'HighCoastLanternGlow';
    glowMat.fog = false;
    const light = { flash: 0, beam: 0 };
    // How much of the beam shows across the view (0 when it points at the eye or away).
    const beamAcross = uniform(1.0);
    glowMat.colorNode = Fn(() => {
        const st = uv().sub(0.5).mul(2.0);
        const r2 = st.dot(st);
        const core = exp(r2.mul(-90.0)).mul(5.0).add(exp(r2.mul(-12.0)).mul(1.1)).add(exp(r2.mul(-3.0)).mul(0.18));
        const clarity = airClarity(u, positionWorld);
        return vec4(vec3(1.0, 0.86, 0.6).mul(core).mul(u.beacon.y.max(0.0)).mul(clarity.mul(0.7).add(0.3)), 1.0);
    })();
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.name = 'HighCoastLanternGlow';
    glow.frustumCulled = false;
    glow.renderOrder = 31;
    const beamGeo = new THREE.BufferGeometry();
    const beamPos = new Float32Array(12);
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamPos, 3).setUsage(THREE.DynamicDrawUsage));
    beamGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
    beamGeo.setIndex([0, 2, 1, 1, 2, 3]);
    const beamMat = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    beamMat.name = 'HighCoastLanternBeam';
    beamMat.fog = false;
    beamMat.colorNode = Fn(() => {
        const st = uv();
        const across = st.y.sub(0.5).mul(2.0);
        // A soft shaft: brightest by the lantern, dying away in the haze along its length.
        const core = exp(across.mul(across).mul(-3.5));
        const fade = exp(st.x.mul(-2.6)).mul(smoothstep(0.0, 0.03, st.x));
        // Seen in the haze: stronger the more air the hour holds and the darker the sky.
        const air = u.hazeDensity.mul(0.5).add(u.mistDensity).add(0.3).mul(float(1.0).sub(u.sunUp.mul(0.7)));
        return vec4(vec3(1.0, 0.88, 0.66).mul(core).mul(fade).mul(air)
            .mul(u.beacon.x)
            .mul(beamAcross)
            .mul(1.0), 1.0);
    })();
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.name = 'HighCoastLanternBeam';
    beam.frustumCulled = false;
    beam.renderOrder = 31;

    const state = { startleAt: -1e6 };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const toEye = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const end = new THREE.Vector3();

    const part = {
        mesh: gulls,
        meshes: [gulls, glow, beam],
        light,
        reset() {
            state.startleAt = -1e6;
            state.gather = 0;
        },
        startle(time) { state.startleAt = time; },
        update(time, dt, world) {
            const sea = world ? world.u.sea.value : 0;
            const age = time - state.startleAt;
            // The startle: a lift that rises fast and settles over half a minute.
            const lift = age > 0 ? smooth(0, 1.5, age) * (1 - smooth(8, 30, age)) : 0;
            // A chain draws them in: they gather lower over the near bay as it grows (eased).
            const asked = world ? smooth(2, 6, world.combo) : 0;
            state.gather = (state.gather || 0) + (asked - (state.gather || 0)) * (1 - Math.exp(-0.8 * dt));
            const { gather } = state;
            rounds.forEach((g, i) => {
                const a = g.phase + time * g.w;
                const r = g.r * (1 + lift * 0.8) * (1 - gather * 0.35);
                const cx = g.x + (60 - g.x) * gather * 0.45;
                const cz = g.z + (-650 - g.z) * gather * 0.45;
                pos.set(cx + Math.cos(a) * r, sea + g.h * (1 - gather * 0.4) + lift * (40 + 60 * g.seed) + Math.sin(time * 0.3 + g.seed * 9) * 3, cz + Math.sin(a) * r);
                // Heading along the circle; banked into the turn.
                const heading = Math.atan2(-Math.sin(a) * Math.sign(g.w), -Math.cos(a) * Math.sign(g.w));
                e.set(0, heading, -0.35 * Math.sign(g.w), 'YXZ');
                q.setFromEuler(e);
                sc.setScalar(1.3);
                m.compose(pos, q, sc);
                gulls.setMatrixAt(i, m);
                // Flapping in bouts, and hard while startled.
                const bout = Math.max(0, Math.sin(time * 0.45 + g.seed * 20)) ** 3;
                flap.set([Math.min(1, bout + lift * 1.5), g.seed, 0, 0], i * 4);
            });
            gulls.instanceMatrix.needsUpdate = true;
            flapAttr.needsUpdate = true;
            // The lighthouse: two flashes every ten seconds after sunset; steady while b2b lasts.
            const beacon = world ? world.u.beacon.value.x : 0;
            const lamps = world ? world.u.lamps.value : 0;
            const c = (time % 10) / 10;
            const flashes = Math.exp(-(((c - 0.05) / 0.012) ** 2)) + Math.exp(-(((c - 0.11) / 0.012) ** 2));
            // A level-up: the light signals once (a long flash), day or night.
            const signal = world ? Math.exp(-((((time - world.levelUpAt) - 0.6) / 0.35) ** 2)) : 0;
            light.flash = Math.max(lamps * flashes, beacon * 0.85 + beacon * flashes * 0.4, signal * 1.4);
            if (world) world.u.beacon.value.y = light.flash;
            if (lantern) {
                const eye = world?._camera?.position || new THREE.Vector3(EYE.x, EYE.y, EYE.z);
                const dist = eye.distanceTo(lantern);
                glow.position.copy(lantern);
                glow.quaternion.copy(world?._camera?.quaternion || glow.quaternion);
                glow.scale.setScalar(dist * 0.028);
                // The beam sweeps round (a constant pace) while the run is back-to-back.
                const sweep = time * 0.9;
                dir.set(Math.sin(sweep), -0.012, -Math.cos(sweep)).normalize();
                end.copy(lantern).addScaledVector(dir, 2600);
                toEye.subVectors(eye, lantern);
                const facing = Math.abs(dir.dot(toEye) / Math.max(toEye.length(), 1e-3));
                beamAcross.value = 1 - smooth(0.45, 0.85, facing);
                side.crossVectors(dir, toEye).normalize();
                const w0 = 6;
                const w1 = 150;
                beamPos.set([
                    lantern.x - side.x * w0, lantern.y - side.y * w0, lantern.z - side.z * w0,
                    lantern.x + side.x * w0, lantern.y + side.y * w0, lantern.z + side.z * w0,
                    end.x - side.x * w1, end.y - side.y * w1, end.z - side.z * w1,
                    end.x + side.x * w1, end.y + side.y * w1, end.z + side.z * w1,
                ]);
                beamGeo.attributes.position.needsUpdate = true;
            }
        },
        getState() {
            return { gulls: rounds.length, flash: light.flash };
        },
        dispose() {
            gullGeo.dispose();
            gullMat.dispose();
            glowGeo.dispose();
            glowMat.dispose();
            beamGeo.dispose();
            beamMat.dispose();
            gulls.dispose?.();
        },
    };
    part.update(0, 0, null);
    return part;
}

export { clamp, max, mix };
