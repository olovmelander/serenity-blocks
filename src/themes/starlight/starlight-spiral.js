/**
 * Starlight — a twist's answer: a spiral of light unfurls in the free sky.
 *
 * The night sky has its own: a spent rocket stage venting fuel as it tumbles throws a slowly
 * turning spiral of sunlit vapour, a bright eye at its heart and a blue funnel of light falling
 * from it. Here a twist sends one: the arm unwinds outward from the eye over a second, turns, and
 * thins away over a few more; the funnel hangs below it and fades. A twist that cleared nothing
 * sends a smaller one.
 *
 * Drawn per pixel on a billboard (one quad a spiral, two at once, and again in the lake). The arm
 * is ONE open logarithmic arm drawn as a line of one thickness, `off` the distance round to it in
 * radii (gotcha #1715: a power of a cosine is soft bands, and wound tight it reads as rings), with
 * a one-sided wake behind it. The world writes each spiral as two rows of `u.spirals`: (unit world
 * direction, start time) and (turning sense ±1, radius in radians, power, 0).
 */
import * as THREE from 'three/webgpu';
import {
    atan,
    attribute,
    cameraPosition,
    clamp,
    exp,
    float,
    fract,
    int,
    log,
    max,
    positionGeometry,
    smoothstep,
    step,
    uv,
    varying,
    vec3,
    vec4,
} from 'three/tsl';
import {
    SKY_RADIUS, mirrorDir, mirrorShare,
} from './starlight-tsl.js';

/** Spirals in the air at once. */
export const SPIRALS = 2;
/** Seconds a spiral lives. */
export const SPIRAL_LIFE = 5.5;
/**
 * How tightly the arm winds: radians round per e-fold of radius. One arm needs about a turn and a
 * half between the eye and the rim to read as a spiral (at 1.25 it is a hook); still open enough
 * that it never reads as rings.
 */
const WIND = 2.7;

const clampAbs = (x) => clamp(x.abs(), 0.0, 1.0);

function spiralMaterial({
    u, noise, tier, mirrored,
}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: true,
        side: THREE.DoubleSide,
        fog: false,
    });
    const slot = int(attribute('aSpiral', 'float').mul(2.0).add(0.5));
    const place = u.spirals.element(slot);
    const shape = u.spirals.element(slot.add(1));
    const age = u.time.sub(place.w);
    const alive = step(0.0, age).mul(step(age, SPIRAL_LIFE)).mul(step(0.001, shape.z));
    let centre = place.xyz;
    let flip = float(1.0);
    let shown = alive.mul(smoothstep(0.02, 0.06, place.y));
    if (mirrored) {
        centre = mirrorDir(u, noise, cameraPosition, place.xyz, tier);
        flip = float(-1.0);
        shown = shown.mul(mirrorShare(centre)).mul(step(centre.y, -0.0006)).mul(0.75);
    }
    // A billboard facing the lens (its image in the lake upside down).
    const size = shape.y.mul(step(0.001, shown));
    const corner = u.camRight.mul(positionGeometry.x).add(u.camUp.mul(positionGeometry.y.mul(flip))).mul(2.0);
    material.positionNode = cameraPosition.add(centre.add(corner.mul(size)).mul(SKY_RADIUS));
    // (age, turning sense, power × how much shows, 0)
    const vSpiral = varying(vec4(age, shape.x, shape.z.mul(shown), 0.0));

    const q = uv().sub(0.5).mul(2.0);
    const r = max(q.length(), 1e-4);
    const a = vSpiral.x;
    // The arm unwinds outward from the eye, turns slowly, then thins away.
    const reach = exp(a.div(-0.75)).oneMinus().mul(0.88).add(0.1);
    const turn = a.mul(0.9);
    const psi = atan(q.y, q.x).mul(vSpiral.y).sub(log(r).mul(WIND)).sub(turn);
    const off = fract(psi.div(Math.PI * 2).add(0.5)).sub(0.5).mul(Math.PI * 2).mul(r);
    const width = r.mul(0.05).add(0.022);
    const offW = off.div(width);
    const arm = exp(offW.mul(offW).negate());
    // A one-sided wake: the vapour the arm has left behind it.
    const wake = exp(max(off.mul(-1.0), 0.0).div(r.mul(0.28).add(0.02)).negate()).mul(step(off, 0.0)).mul(0.28);
    const within = smoothstep(reach, reach.sub(0.12), r).mul(smoothstep(0.04, 0.1, r));
    const eye = exp(r.mul(r).div(0.0025).negate()).mul(2.2);
    // The funnel: a blue beam falling from the eye, widening, fading.
    const below = max(q.y.negate(), 0.0);
    const fanW = below.mul(0.22).add(0.02);
    const fanX = q.x.div(fanW);
    const funnel = exp(fanX.mul(fanX).negate()).mul(smoothstep(0.0, 0.12, below)).mul(exp(below.div(-0.55)))
        .mul(smoothstep(0.0, 0.6, a));
    const life = smoothstep(0.0, 0.18, a).mul(smoothstep(SPIRAL_LIFE, SPIRAL_LIFE * 0.45, a));
    const fadeOut = exp(a.div(-2.6)).mul(0.6).add(0.4);
    const light = vec3(0.78, 0.9, 1.0).mul(arm.mul(within).mul(fadeOut).mul(r.mul(-0.6).add(1.0)))
        .add(vec3(0.4, 0.6, 1.0).mul(wake.mul(within)))
        .add(vec3(0.9, 0.96, 1.0).mul(eye))
        .add(vec3(0.25, 0.5, 1.0).mul(funnel.mul(0.55)));
    // The quad's own edge never shows.
    const edge = smoothstep(1.0, 0.86, max(clampAbs(q.x), clampAbs(q.y)));
    material.outputNode = vec4(light.mul(life).mul(edge).mul(vSpiral.z), 0.0);
    material.colorNode = vec4(0.0, 0.0, 0.0, 1.0);
    return material;
}

export function createSpirals({ u, noise, tier }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const slots = new Float32Array(SPIRALS);
    for (let i = 0; i < SPIRALS; i += 1) slots[i] = i;
    const slotAttr = new THREE.InstancedBufferAttribute(slots, 1);
    const build = (mirrored) => {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.index = base.index;
        geometry.setAttribute('position', base.attributes.position);
        geometry.setAttribute('uv', base.attributes.uv);
        geometry.setAttribute('aSpiral', slotAttr);
        geometry.instanceCount = SPIRALS;
        const mesh = new THREE.Mesh(geometry, spiralMaterial({
            u, noise, tier, mirrored,
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = mirrored ? 26 : 27;
        mesh.name = mirrored ? 'starlight-spirals-mirror' : 'starlight-spirals';
        mesh.visible = false;
        return mesh;
    };
    const sky = build(false);
    const lake = build(true);
    const group = new THREE.Group();
    group.name = 'starlight-spirals';
    group.add(lake, sky);
    return {
        object: group,
        /** Drawn only while a spiral is alive. */
        setVisible(on) {
            sky.visible = on;
            lake.visible = on;
        },
        dispose() {
            [sky, lake].forEach((mesh) => {
                mesh.geometry.dispose();
                mesh.material.dispose();
            });
            base.dispose();
        },
    };
}
