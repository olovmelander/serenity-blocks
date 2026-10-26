/**
 * Grainfields — the geese.
 *
 * Lapporten's Sami name, Čuonjávággi, is the goose valley. Skeins of bean geese cross the sky
 * over the fields in long V's, beating steadily, dark against the bright air; and when the game
 * climbs a level a flock bursts out of the barley in front of the eye and flies away out
 * through the gate (grainfields-goose-flight.js choreographs them all).
 *
 * The bird is the theme's own, modelled in Blender (scripts/blender/grainfields/goose.py): a
 * Taiga bean goose at real size, its plumage in its vertex colours. There is no skeleton: each
 * vertex carries how much the shoulder and the wrist move it (`_wing`), and this vertex stage
 * folds the wings about those two hinges by the five angles the flight module writes per bird,
 * then sets the bird on its heading, banked into its turn. One instanced draw for every goose in
 * sight (the flight module leaves out the rest).
 *
 * The light is the fields': the sun through the deck's gaps, the sky above, the barley's gold
 * bounce under the wings and belly, a little of the low sun through the thin flight feathers
 * when a bird crosses in front of it, then the air between.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    dot,
    exp,
    float,
    max,
    normalGeometry,
    normalize,
    positionGeometry,
    smoothstep,
    step,
    varyingProperty,
    vec3,
    vec4,
} from 'three/tsl';
import { aerial, lightSurface } from './grainfields-light.js';
import { GOOSE_RIG, GOOSE_STRIDE, GooseSkies } from './grainfields-goose-flight.js';

/** The model's attributes, as the vertex stage reads them. */
export const GOOSE_LAYOUT = Object.freeze([['position', 3], ['normal', 3], ['color', 4], ['_wing', 4]]);

/** The per-bird vec4s, in their order in the instance buffer. */
const INSTANCE_NAMES = Object.freeze(['iGooseA', 'iGooseB', 'iGooseC', 'iGooseD']);

/** Rotate the pair (a, b) by `ang`. */
const turn = (a, b, ang) => {
    const c = ang.cos();
    const s = ang.sin();
    return [a.mul(c).sub(b.mul(s)), a.mul(s).add(b.mul(c))];
};

/** Check a goose geometry has the layout the stage reads. */
export function checkGooseGeometry(geometry) {
    for (const [name, size] of GOOSE_LAYOUT) {
        const a = geometry?.getAttribute?.(name);
        if (!a || a.itemSize !== size) throw new Error(`[Grainfields] the goose has no "${name}" (vec${size})`);
    }
    return geometry;
}

function createGooseMaterial(u, t) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = 'GrainfieldsGeese';
    material.fog = false;
    const A = attribute('iGooseA', 'vec4');
    const B = attribute('iGooseB', 'vec4');
    const C = attribute('iGooseC', 'vec4');
    const D = attribute('iGooseD', 'vec4');
    const wing = attribute('_wing', 'vec4');
    const plumage = attribute('color', 'vec4');
    const vNormal = varyingProperty('vec3', 'vGooseNormal');
    const vWorld = varyingProperty('vec3', 'vGooseWorld');
    const vSize = varyingProperty('float', 'vGooseSize');
    const [Sx, Sy, Sz] = GOOSE_RIG.shoulder;
    const [Wx, Wy, Wz] = GOOSE_RIG.wrist;

    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const n = normalGeometry;
        const fwd = B.xyz;
        const up = C.xyz;
        const left = up.cross(fwd).toVar();
        // Fold the rest pose about the wrist, then the shoulder (grainfields-goose-flight.js: foldPoint).
        const side = step(0.0, p.x).mul(2.0).sub(1.0);
        const handTurn = D.z.mul(wing.y).negate().toVar();
        const handLift = D.y.mul(wing.y).add(D.w.mul(wing.z)).toVar();
        const armTurn = D.x.mul(wing.x).negate().toVar();
        const armLift = C.w.mul(wing.x).toVar();
        let [du, dz] = turn(abs(p.x).sub(Wx), p.z.sub(Wz), handTurn);
        let dy;
        [du, dy] = turn(du, p.y.sub(Wy), handLift);
        [du, dz] = turn(du.add(Wx - Sx), dz.add(Wz - Sz), armTurn);
        [du, dy] = turn(du, dy.add(Wy - Sy), armLift);
        // The body heaves with the beat; the head holds still.
        const heave = B.w.mul(float(1.0).sub(wing.w));
        const local = vec3(side.mul(du.add(Sx)), dy.add(Sy).add(heave), dz.add(Sz));
        let [nu, nz] = turn(side.mul(n.x), n.z, handTurn);
        let ny;
        [nu, ny] = turn(nu, n.y, handLift);
        [nu, nz] = turn(nu, nz, armTurn);
        [nu, ny] = turn(nu, ny, armLift);
        const world = A.xyz.add(left.mul(local.x).add(up.mul(local.y)).add(fwd.mul(local.z)).mul(A.w)).toVar();
        vNormal.assign(left.mul(side.mul(nu)).add(up.mul(ny)).add(fwd.mul(nz)));
        vWorld.assign(world);
        vSize.assign(A.w);
        return world;
    })();

    material.colorNode = Fn(() => {
        const N = normalize(vNormal).toVar();
        const P = vWorld;
        const albedo = plumage.xyz.toVar();
        const thin = plumage.w;
        const { colour, sunlit } = lightSurface(u, t.noise, P, N, albedo);
        // The low sun through the thin flight feathers, only when the bird is close to its disc
        // (wider, every wing near the sun glowed and the birds faded into its glare).
        const V = normalize(P.sub(u.eye));
        const toward = dot(V, u.sunDir);
        const through = exp(toward.sub(1.0).mul(55.0)).mul(thin).mul(sunlit).mul(0.5);
        // A warm edge on the thin feathers the sun grazes from behind.
        const graze = smoothstep(0.0, 0.35, dot(N, u.sunDir).negate().add(0.25)).mul(smoothstep(0.55, 0.95, toward));
        const lit = colour.add(u.sun.mul(albedo.add(0.04)).mul(through.add(graze.mul(thin).mul(sunlit).mul(0.04))));
        // A far bird drawn larger than life looks as near as its size says: the air in front of it
        // is that much thinner (it stays a silhouette instead of fading into the haze).
        const seenAt = u.eye.add(P.sub(u.eye).div(max(vSize, 1.0)));
        return vec4(aerial(u, seenAt, lit), 1.0);
    })();
    return material;
}

/**
 * The geese: `count` is the tier's budget of birds drawn at once; `goose` the authored model
 * ({ geometry } from grainfields-assets.js). Without it the sky goes without geese (null).
 */
export function createGeese(u, t, count = 26, goose = null) {
    if (!goose?.geometry) return null;
    const base = checkGooseGeometry(goose.geometry);
    const skies = new GooseSkies(count);
    const { pool } = skies;
    const data = new Float32Array(pool * GOOSE_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, GOOSE_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    for (const [name] of GOOSE_LAYOUT) geometry.setAttribute(name, base.getAttribute(name));
    INSTANCE_NAMES.forEach((name, k) => geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4)));
    geometry.instanceCount = 1;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 100, -1000), 4000);
    const material = createGooseMaterial(u, t);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'GrainfieldsGeese';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;

    // Out of sight: outside the camera's frame (its basis and lens), widened by a bird's reach.
    const eye = [0, 0, 0];
    const view = {
        eye,
        pixelAngle: 0.0007,
        cull: (x, y, z, reach) => {
            const dx = x - eye[0];
            const dy = y - eye[1];
            const dz = z - eye[2];
            const f = u.camFwd.value;
            const depth = dx * f.x + dy * f.y + dz * f.z;
            if (depth < -reach) return true;
            const r = u.camRight.value;
            const v = u.camUp.value;
            const tanV = u.tanHalfFov.value;
            const tanU = tanV * u.aspect.value;
            const across = Math.abs(dx * r.x + dy * r.y + dz * r.z);
            const high = Math.abs(dx * v.x + dy * v.y + dz * v.z);
            const d = Math.max(depth, 0);
            // (A generous margin up and down: the portrait lens is shifted.)
            return across > d * tanU * 1.08 + reach || high > d * tanV * 1.9 + reach;
        },
    };

    return {
        mesh,
        meshes: [mesh],
        skies,
        /** A flight out goes up at `time` along `route` (grainfields-goose-flight.js: planTakeoff). */
        launch(time, route) { return skies.launch(time, route); },
        reset() { skies.reset(); },
        update(time) {
            const e = u.eye.value;
            eye[0] = e.x;
            eye[1] = e.y;
            eye[2] = e.z;
            view.pixelAngle = u.pixelAngle.value;
            const n = skies.write(time, view, data);
            // Nothing in sight: one bird of no size keeps the draw (and its pipeline) warm.
            if (n === 0) data.fill(0, 0, GOOSE_STRIDE);
            geometry.instanceCount = Math.max(1, n);
            buffer.needsUpdate = true;
        },
        /** Where bird `i` of skein `key` ('out', 'a', 'b') is at `time` (the playground's lenses). */
        locate(key, i, time) {
            const e = u.eye.value;
            return skies.locate(key, i, time, { eye: [e.x, e.y, e.z], pixelAngle: u.pixelAngle.value });
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
