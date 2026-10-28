/**
 * Golden Forest — the birds: common cranes gathering at the lake to roost.
 *
 * A kettle of cranes circles over the far shore, wings spread flat and still, banked into the
 * turn, now and then a bird beating a few slow strokes; and a skein crosses the sky in a V on a
 * lane through the low sun (golden-forest-crane-flight.js choreographs them). A big clear
 * startles the kettle: the circles burst wide, the column lifts and every bird beats hard until
 * it settles.
 *
 * The bird is the theme's own, modelled in Blender (scripts/blender/golden_forest/crane.py): a
 * common crane at real size, its plumage in its vertex colours, in a near and a far level of
 * detail. There is no skeleton: each vertex carries how much the shoulder and the wrist move it
 * (`_wing`), and this vertex stage folds the wings about those two hinges by the five angles the
 * flight module writes per bird, then sets the bird on its heading, banked into its turn. Two
 * instanced draws (near and far) for every crane in the sky; they stand in the lake's mirror too.
 *
 * The light is the lake's: the sky from above and the warm bounce from below, the low sun on the
 * faces turned to it with a warm rim on their edges, and through the thin flight feathers when a
 * bird crosses its disc. Against the bright evening a crane reads as a silhouette, so its body is
 * held darker than the sky behind it; then the golden air between.
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    dot,
    exp,
    float,
    max,
    min,
    normalGeometry,
    normalize,
    positionGeometry,
    step,
    uniform,
    varyingProperty,
    vec3,
} from 'three/tsl';
import { CRANE_RIG, CRANE_STRIDE, CraneSky } from './golden-forest-crane-flight.js';

/** The model's attributes, as the vertex stage reads them. */
export const CRANE_LAYOUT = Object.freeze([['position', 3], ['normal', 3], ['color', 4], ['_wing', 4]]);

/** The per-bird vec4s, in their order in the instance buffer. */
const INSTANCE_NAMES = Object.freeze(['iCraneA', 'iCraneB', 'iCraneC', 'iCraneD']);

/** A lit crane is held under this share of the luminance of the sky behind it. */
const SILHOUETTE = 0.18;
/**
 * How much of the ground-level air lies over a crane: the birds fly in the thinner air above the
 * water's haze, and a backlit silhouette must stay legible against the bright evening.
 */
const AIR = 0.48;
/** Where the eye stands when no camera is given (the landscape framing's). */
const DEFAULT_EYE = Object.freeze([0, 3.8, 14.5]);

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** Rotate the pair (a, b) by `ang`. */
const turn = (a, b, ang) => {
    const c = ang.cos();
    const s = ang.sin();
    return [a.mul(c).sub(b.mul(s)), a.mul(s).add(b.mul(c))];
};

/** Check a crane geometry has the layout the stage reads. */
export function checkCraneGeometry(geometry) {
    for (const [name, size] of CRANE_LAYOUT) {
        const a = geometry?.getAttribute?.(name);
        if (!a || a.itemSize !== size) throw new Error(`[GoldenForest] the crane has no "${name}" (vec${size})`);
    }
    return geometry;
}

function createCraneMaterial(light) {
    const material = new THREE.MeshBasicNodeMaterial({ fog: false });
    material.name = 'GoldenForestBirds';
    const A = attribute('iCraneA', 'vec4');
    const B = attribute('iCraneB', 'vec4');
    const C = attribute('iCraneC', 'vec4');
    const D = attribute('iCraneD', 'vec4');
    const wing = attribute('_wing', 'vec4');
    const plumage = attribute('color', 'vec4');
    const vNormal = varyingProperty('vec3', 'vCraneNormal');
    const vWorld = varyingProperty('vec3', 'vCraneWorld');
    const vSize = varyingProperty('float', 'vCraneSize');
    const [Sx, Sy, Sz] = CRANE_RIG.shoulder;
    const [Wx, Wy, Wz] = CRANE_RIG.wrist;

    material.positionNode = Fn(() => {
        const p = positionGeometry;
        const n = normalGeometry;
        const fwd = B.xyz;
        const up = C.xyz;
        const left = up.cross(fwd).toVar();
        // Fold the rest pose about the wrist, then the shoulder (golden-forest-crane-flight.js: foldPoint).
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
        // The body heaves with the beat; the neck and head hold their line.
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
        const V = normalize(P.sub(cameraPosition)).toVar();
        const L = light.uSunDir;
        const albedo = plumage.xyz.toVar();
        const thin = plumage.w;
        const NdL = max(dot(N, L), 0.0);
        // The sky from above and the bounce from below; the low sun on the faces turned to it.
        const body = albedo.mul(light.ambient(N).add(light.uSunColor.mul(NdL).mul(0.8))).toVar();
        // A backlit crane is a silhouette: held under the sky behind it (lit against the bright
        // evening it would vanish into it).
        const behind = dot(light.sky(V), LUMA);
        const held = body.mul(min(float(1.0), behind.mul(SILHOUETTE).div(max(dot(body, LUMA), 1e-4))));
        // A warm rim on the edges turned to the sun (not the whole thin wing seen from below,
        // which is grazing almost everywhere).
        const edge = float(1.0).sub(abs(dot(N, V)));
        const edge2 = edge.mul(edge);
        const rim = edge2.mul(edge2).mul(NdL.mul(0.9).add(0.03)).mul(0.5);
        // The sun through the thin flight feathers, only right by its disc (wider, every wing
        // near the sun glowed and the birds faded into its glare).
        const sunward = max(dot(V, L), 0.0).toVar();
        const through = exp(sunward.sub(1.0).mul(150.0)).mul(thin).mul(0.18);
        const lit = held.add(albedo.add(0.03).mul(light.uSunColor).mul(rim.add(through)));
        // A far bird drawn larger than life looks as near as its size says: the air in front of
        // it is that much thinner (it stays a silhouette instead of fading into the haze).
        const seenAt = cameraPosition.add(P.sub(cameraPosition).div(max(vSize, 1.0)));
        // Toward the sun the air is at its brightest: a crane crossing it keeps its edge.
        const sunAir = float(1.0).sub(sunward.pow(6.0).mul(0.55));
        return light.haze(lit, { world: seenAt, strength: sunAir.mul(AIR) });
    })();
    return material;
}

function createDraw(base, pool, material, name) {
    const data = new Float32Array(pool * CRANE_STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(data, CRANE_STRIDE);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    for (const [attr] of CRANE_LAYOUT) geometry.setAttribute(attr, base.getAttribute(attr));
    INSTANCE_NAMES.forEach((attr, k) => {
        geometry.setAttribute(attr, new THREE.InterleavedBufferAttribute(buffer, 4, k * 4));
    });
    geometry.instanceCount = 1;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, -150), 2000);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    return {
        mesh, geometry, buffer, data, drawn: 0,
    };
}

export class GoldenForestBirds {
    /**
     * `crane` is the authored model ({ near, far } geometries from golden-forest-assets.js);
     * without it the sky goes without birds. `camera` gives the eye the birds are sized from.
     */
    constructor({
        light, tier, rng = Math.random, crane = null, camera = null,
    }) {
        this.light = light;
        this.tier = tier;
        this.rng = rng;
        this.crane = crane;
        this.camera = camera;
        this.group = new THREE.Group();
        this.group.name = 'GoldenForestBirds';
        /** The startle as last worn (0..1). */
        this.uStartle = uniform(0);
        this.owned = [];
        this.draws = [];
        this.count = 0;
        this.sky = null;
        this.eye = [...DEFAULT_EYE];
    }

    build() {
        const budget = Math.max(0, Math.floor(this.tier.birds));
        if (!budget) return this;
        // The sky's own seed from the theme's generator, so a seeded world draws the same birds.
        // Two draws a bird, as the birds before the cranes took: everything built after them
        // (the fireflies, the lake) keeps the same random sequence, crane or no crane.
        const seed = Math.floor(this.rng() * 0x7fffffff) >>> 0;
        for (let i = 1; i < budget * 2; i += 1) this.rng();
        if (!this.crane?.near) return this;
        const near = checkCraneGeometry(this.crane.near);
        const far = this.crane.far ? checkCraneGeometry(this.crane.far) : near;
        this.sky = new CraneSky(budget, seed);
        this.count = this.sky.count;
        const material = createCraneMaterial(this.light);
        this.material = material;
        this.draws = [
            createDraw(near, budget, material, 'GoldenForestBirds'),
            createDraw(far, budget, material, 'GoldenForestBirdsFar'),
        ];
        this.draws.forEach((draw) => {
            this.group.add(draw.mesh);
            this.owned.push(draw.geometry);
        });
        this.owned.push(material);
        this.write(0);
        return this;
    }

    /** The two draws (near, far), as meshes. */
    get meshes() {
        return this.draws.map((draw) => draw.mesh);
    }

    write(time) {
        if (!this.sky) return;
        const position = this.camera?.position;
        if (position) {
            this.eye[0] = position.x;
            this.eye[1] = position.y;
            this.eye[2] = position.z;
        }
        const [near, far] = this.draws;
        const drawn = this.sky.write(time, this.uStartle.value, this.eye, near.data, far.data);
        [[near, drawn.near], [far, drawn.far]].forEach(([draw, n]) => {
            // Nothing in this draw: one bird of no size keeps it (and its pipeline) warm.
            if (n === 0) draw.data.fill(0, 0, CRANE_STRIDE);
            draw.geometry.instanceCount = Math.max(1, n);
            draw.drawn = n;
            draw.buffer.needsUpdate = true;
        });
    }

    /**
     * `worn.flock` is the startle as the world eases it (a quad lifts the flock over a moment
     * instead of in one frame; a fever keeps it up), calmed by Reduce motion's share.
     */
    update(frame = {}, dt = 0, worn = null, time = this.light?.uTime?.value ?? 0) {
        const source = worn && Number.isFinite(worn.flock) ? worn.flock : frame.flock;
        const motion = worn && Number.isFinite(worn.motion) ? THREE.MathUtils.clamp(worn.motion, 0, 1) : 1;
        const startle = Number.isFinite(source) ? THREE.MathUtils.clamp(source, 0, 1) * motion : 0;
        this.uStartle.value = startle;
        if (!this.sky) return;
        // A startled bird beats up to half again as fast: its phase gains that much more per second.
        this.sky.advance(dt, startle);
        this.write(Number.isFinite(time) ? time : 0);
    }

    /** Back to the opening sky (a seek replays from here). */
    reset() {
        this.uStartle.value = 0;
        this.sky?.reset();
    }

    /** How many cranes each draw holds this frame (near, far). */
    drawnCounts() {
        return { near: this.draws[0]?.drawn ?? 0, far: this.draws[1]?.drawn ?? 0 };
    }

    dispose() {
        this.owned.forEach((resource) => resource.dispose());
        this.owned.length = 0;
        this.draws = [];
        this.group.removeFromParent();
        this.group.clear();
        this.sky = null;
    }
}
