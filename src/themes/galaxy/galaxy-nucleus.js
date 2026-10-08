/**
 * Galaxy — the nucleus and its jets.
 *
 * The bulge's own light belongs to the disc's volume (galaxy-disc.js). This is what burns at its
 * heart, and what a chain of clears turns it into:
 *
 *   the flare   a point with diffraction spikes and, as it charges, a long lens streak — two
 *               screen-space quads centred on the nucleus;
 *   the jets    two beams along the galaxy's axis, each a ribbon that turns to face the camera:
 *               a hot spine in a turbulent sheath, knots of light riding outward, opening as it
 *               goes. At rest they are a faint stub. Every step of a chain pushes them further
 *               out; a four-line clear fires them to their full reach behind a bright head.
 *
 * The near jet is drawn over the disc and the far one under it, so the dust dims the one that
 * points away.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    cross,
    exp,
    float,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    sqrt,
    step,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    JET_REACH, gxBell, gxFxMaterial, gxPart, gxQuadGeometry,
} from './galaxy-tsl.js';

/** Half-width of a jet's ribbon (light-units): room for the sheath where it is widest. */
const JET_WIDTH = 17;
/** Seconds a burst's head takes to run the jet's whole reach. */
export const JET_BURST_TRAVEL = 0.46;

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

/** The flare and the lens streak. @param {object} u shared galaxy uniforms */
export function createNucleus(u) {
    const geometry = gxQuadGeometry(2, { aKind: [new Float32Array([0, 1]), 1] });
    const kind = attribute('aKind', 'float');
    const uniforms = {
        /** (flare gain, streak gain) */
        glare: uniform(new THREE.Vector2(0.6, 0.0)),
    };
    const material = gxFxMaterial('GalaxyNucleus');
    const clip = viewProjection(u.centre);
    const vh = u.viewport.y;
    const flare = vec2(vh.mul(0.15), vh.mul(0.15));
    const streak = vec2(vh.mul(0.62), vh.mul(0.02));
    const px = mix(flare, streak, kind);
    material.vertexNode = vec4(
        clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(u.viewport.mul(0.5)).mul(clip.w)),
        clip.z,
        clip.w,
    );
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0).toVar();
        const d2 = q.dot(q).toVar();
        const fade = float(1.0).sub(smoothstep(0.8, 1.0, abs(q.x))).mul(float(1.0).sub(smoothstep(0.8, 1.0, abs(q.y))));

        // The flare: a point, a halo and four spikes, a little off the frame's axes.
        const tilt = 0.31;
        const a = vec2(
            q.x.mul(Math.cos(tilt)).add(q.y.mul(Math.sin(tilt))),
            q.y.mul(Math.cos(tilt)).sub(q.x.mul(Math.sin(tilt))),
        );
        const point = exp(d2.mul(-260.0)).mul(5.0).add(exp(d2.mul(-38.0)).mul(0.7))
            .add(exp(sqrt(d2).mul(-6.0)).mul(0.12));
        const spikes = exp(abs(a.y).mul(-80.0)).mul(exp(abs(a.x).mul(-3.6)))
            .add(exp(abs(a.x).mul(-80.0)).mul(exp(abs(a.y).mul(-3.6))));
        const shimmer = sin(u.time.mul(2.3)).mul(0.04).add(0.96);
        const flareCol = u.nucleus.mul(point.add(spikes.mul(0.75))).mul(uniforms.glare.x).mul(shimmer);

        // The streak: what a lens makes of a light this bright.
        const band = exp(q.y.mul(q.y).mul(-7.0)).mul(exp(abs(q.x).mul(-3.0)));
        const streakCol = mix(u.jet, u.nucleus, 0.35).mul(band).mul(uniforms.glare.y);

        return vec4(mix(flareCol, streakCol, step(0.5, kind)).mul(fade).mul(u.breath), 0.0);
    })();
    const part = gxPart('GalaxyNucleus', geometry, material, 22);
    part.uniforms = uniforms;
    return part;
}

/**
 * One jet. `side` = +1 for the one along the axis (it leans toward the camera), −1 for the other.
 * @param {object} u shared galaxy uniforms
 */
export function createJet(u, side) {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute([side, side, side, side], 1));
    const sideNode = attribute('aSide', 'float');

    const material = gxFxMaterial(side > 0 ? 'GalaxyJetNear' : 'GalaxyJetFar');
    const along = positionGeometry.y.add(0.5);
    const axis = u.axis.mul(sideNode);
    const across = normalize(cross(axis, normalize(cameraPosition.sub(u.centre))));
    const world = u.centre.add(axis.mul(along.mul(JET_REACH))).add(across.mul(positionGeometry.x.mul(JET_WIDTH * 2)));
    material.vertexNode = viewProjection(world);

    material.colorNode = Fn(() => {
        const st = uv();
        const a = st.y.toVar();
        const x = st.x.sub(0.5).mul(2.0).toVar();
        const reach = max(u.jets.x, 0.02).toVar();
        const al = a.div(reach).toVar();
        const body = float(1.0).sub(smoothstep(0.7, 1.0, al));
        // It opens as it goes: a cone with a rounded start.
        const width = mix(sqrt(a), a, 0.5).mul(0.46).add(0.036);
        const xx = x.div(width).toVar();
        const sheath = exp(xx.mul(xx).mul(-1.5));
        const spine = exp(xx.mul(xx).mul(-24.0));
        // Turbulence carried outward in the sheath; knots riding the spine.
        const n1 = u.noiseLod(vec2(x.mul(0.33).add(sideNode.mul(0.27)), a.mul(2.4).sub(u.time.mul(0.5))), 1.0).r;
        const n2 = u.noiseLod(vec2(x.mul(0.85).add(0.61), a.mul(6.5).sub(u.time.mul(1.25))), 0.0).g;
        const turbulence = smoothstep(0.26, 0.8, n1.mul(0.6).add(n2.mul(0.4)));
        const wave = sin(a.mul(JET_REACH * 0.34).sub(u.time.mul(5.2))).mul(0.5).add(0.5);
        const knots = wave.mul(wave).mul(wave);
        const fall = float(1.0).div(al.mul(1.5).add(1.0));
        const light = sheath.mul(turbulence).mul(0.85).add(spine.mul(knots.mul(1.7).add(0.8)))
            .mul(fall)
            .mul(body)
            .mul(u.jets.y)
            .toVar();
        // A burst: a bright head running the whole reach.
        const age = u.time.sub(u.jets.z);
        const head = gxBell(a.sub(age.div(JET_BURST_TRAVEL)).div(0.2)).mul(step(0.0, age)).mul(u.jets.w);
        light.addAssign(sheath.mul(0.7).add(spine.mul(2.2)).mul(head).mul(3.0));

        const sheathTone = mix(u.jet, u.armInner, smoothstep(0.35, 1.3, abs(xx)).mul(0.45));
        const tone = mix(sheathTone, vec3(1.0, 0.98, 0.96), spine.mul(0.38));
        // The jet that points away is the dimmer one.
        const facing = mix(float(0.55), float(1.0), step(0.0, sideNode));
        return vec4(tone.mul(light).mul(facing).mul(u.breath), 0.0);
    })();

    return gxPart(material.name, geometry, material, side > 0 ? 20 : -12);
}
