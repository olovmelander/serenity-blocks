/* eslint-disable import/no-unresolved */
/**
 * Murmuration — the swarm simulation.
 *
 * Tens to hundreds of thousands of motes updated in one WebGPU compute dispatch per frame
 * (or the same arithmetic on the CPU for the WebGL2 backend). No neighbour search: every
 * mote reads the same velocity field and is carried by it, which is what makes the mass
 * move like one body.
 *
 * Per mote, per step:
 *   1. THE FIELD — a slow gyre round the board, soft walls that keep the swarm an annulus
 *      framing the play area, and the divergence-free shear waves of `flow-field.js`. The
 *      mote's velocity relaxes toward the field, so it flows instead of being pushed.
 *   2. FORMATIONS — a damped spring toward the mote's target, with a sideways term that
 *      makes the swarm spiral into a shape instead of sliding straight to it.
 *   3. IMPULSES — eight slots of gameplay forces. A slot is either a blunt push/swirl/pull
 *      with a linear reach, or a WAVE: a ring that travels outward and lights the motes
 *      it crosses.
 *   4. Damping, a speed cap, integration, and an invisible rebirth at end of life.
 *
 * WHERE THE STRUCTURE COMES FROM. A divergence-free field keeps a uniform cloud uniform,
 * and a uniform cloud is fog. So most motes are reborn at one of a few slowly wandering
 * SOURCES and live 12–30 seconds: each source trails a ribbon tens of units long down
 * the flow, the gyre's differential rotation winds the ribbons into arms, and the fine
 * waves fray them. The rest are reborn anywhere in the annulus, as dust between the arms.
 *
 * Storage (4 floats per mote):
 *   positions:  xyz + age       (age 0..1; the renderer fades a mote in and out with it)
 *   velocities: xyz + lifetime  (seconds)
 *   colors:     seedA, seedB, flash, energy
 *               (two static random seeds; flash = lit by a passing wave; energy = speed glow)
 *   targets:    xyz + weight    (formation target; weight 0 = free)
 */
import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    abs,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    int,
    length,
    max,
    mix,
    pow,
    sign,
    sin,
    smoothstep,
    step,
    storage,
    uniform,
    uniformArray,
    vec3,
    vec4,
} from 'three/tsl';
import { generateShape } from './shape-formations.js';
import { flowFieldNode, prepareFlowField, sampleFlowPrepared } from './flow-field.js';

// The CPU path (WebGL2) pays per mote on the main thread, so its counts stay where they
// were. The native path's cost is fill rate, not simulation, so it carries more, smaller
// motes: the swarm reads as a body of light instead of a scatter of dots.
export const FLUID_BUDGETS = Object.freeze({
    Minimal: Object.freeze({ count: 5000, focalRadius: 7.4, gravityStrength: 0.55 }),
    Low: Object.freeze({ count: 12000, focalRadius: 8.2, gravityStrength: 0.58 }),
    Medium: Object.freeze({ count: 25000, focalRadius: 9.0, gravityStrength: 0.62 }),
    High: Object.freeze({ count: 45000, focalRadius: 9.5, gravityStrength: 0.65 }),
    Ultra: Object.freeze({ count: 65000, focalRadius: 9.8, gravityStrength: 0.68 }),
    Extreme: Object.freeze({ count: 90000, focalRadius: 10.0, gravityStrength: 0.72 }),
});

export const NATIVE_FLUID_COUNTS = Object.freeze({
    Minimal: 9000,
    Low: 20000,
    Medium: 36000,
    High: 60000,
    Ultra: 90000,
    Extreme: 130000,
});

/**
 * @param {string} qualityName
 * @param {{ native?: boolean }} [options] native = WebGPU compute is available
 */
export function getFluidBudget(qualityName, options = {}) {
    const name = typeof qualityName === 'string' && Object.hasOwn(FLUID_BUDGETS, qualityName) ? qualityName : 'High';
    const budget = { ...FLUID_BUDGETS[name] };
    if (options.native === true) budget.count = NATIVE_FLUID_COUNTS[name];
    return budget;
}

// Max simultaneous impulses. When all are busy the weakest is replaced.
export const MAX_IMPULSES = 8;

export const IMPULSE_TYPE = Object.freeze({
    RADIAL: 0, // outward push from origin
    VORTEX: 1, // swirl around origin (dir = axis)
    ATTRACTOR: 2, // inward pull toward origin
});

/** The sources the ribbons trail from. */
export const EMITTER_COUNT = 6;

/** Spring stiffness per unit of formation strength, and the extra drag that settles it. */
const SHAPE_STIFFNESS = 16;
const SHAPE_DRAG = 3.4;
const SHAPE_SWIRL = 6;
/** A fitted figure's half-size before any figure is drawn, and the least it is taken to be. */
const DEFAULT_SHAPE_SPAN = 4.9;
const MIN_SHAPE_SPAN = 0.5;
/** How quickly a mote's velocity relaxes onto the field (1/s). */
const FIELD_FOLLOW = 1.7;
/** Wall spring, per unit of containment strength. */
const WALL_STIFFNESS = 2.4;
/** How far apart individual motes place the inner and outer walls (fractions of the radius). */
const WALL_SPREAD_IN = 0.5;
const WALL_SPREAD_OUT = 0.26;
/** Half-thickness of the disc, in half-extent units, before the z walls begin. */
const DISC_HALF = 0.8;
/**
 * How much depth counts in a wave's distance. The swarm is a thick tilted disc seen face
 * on: a spherical shell would cross it at a different screen radius for every depth and
 * smear into a wide glow. Nearly ignoring z makes the wave a ring ON SCREEN.
 */
const WAVE_DEPTH = 0.3;
/** How fast a wave's light leaves a mote (1/s): fast, so the ring stays a ring. */
const FLASH_DECAY = 40;
/** Legacy (non-wave) impulse decay, 1/s. */
const IMPULSE_DECAY = 4;
const TAU = Math.PI * 2;

function mulberry32(seed) {
    let a = seed >>> 0; // eslint-disable-line no-bitwise
    return () => {
        /* eslint-disable no-bitwise */
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t ^= (t + Math.imul(t ^ (t >>> 7), 61 | t));
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        /* eslint-enable no-bitwise */
    };
}

const smooth01 = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const hash01 = (x) => { const n = Math.sin(x) * 43758.5453; return n - Math.floor(n); };

export class FluidParticleSim {
    constructor(count, options = {}) {
        this.count = Math.max(1, Math.floor(count));
        this.isCPU = options.cpu === true;
        this.focalPoint = options.focalPoint?.clone?.() || new THREE.Vector3(0, 0, 0);
        this._seed = Number.isFinite(options.seed) ? options.seed : 0x4d55524d; // "MURM"

        // ─── Storage ───
        this.positionData = new Float32Array(this.count * 4);
        this.velocityData = new Float32Array(this.count * 4);
        this.colorData = new Float32Array(this.count * 4);
        this.targetData = new Float32Array(this.count * 4);
        const Attribute = this.isCPU ? THREE.InstancedBufferAttribute : THREE.StorageBufferAttribute;
        this.positionBuffer = new Attribute(this.positionData, 4);
        this.velocityBuffer = new Attribute(this.velocityData, 4);
        this.colorBuffer = new Attribute(this.colorData, 4);
        this.targetBuffer = new Attribute(this.targetData, 4);
        if (this.isCPU) {
            this.positionBuffer.setUsage(THREE.DynamicDrawUsage);
            this.velocityBuffer.setUsage(THREE.DynamicDrawUsage);
            this.colorBuffer.setUsage(THREE.DynamicDrawUsage);
        }
        this.currentShape = 'free';

        // ─── Impulse slots (3 vec4 each) ───
        //   positions[i] = (x, y, z, strength)       strength 0 = idle
        //   params[i]    = (dirX, dirY, dirZ, type)
        //   waves[i]     = (radius, width, flash, squashY)   width 0 = a blunt impulse
        this._impulsePositions = [];
        this._impulseParams = [];
        this._impulseWaves = [];
        this._impulseMeta = [];
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            this._impulsePositions.push(uniform(new THREE.Vector4(0, 0, 0, 0)));
            this._impulseParams.push(uniform(new THREE.Vector4(0, 1, 0, 0)));
            this._impulseWaves.push(uniform(new THREE.Vector4(0, 0, 0, 1)));
            this._impulseMeta.push({ speed: 0, decay: IMPULSE_DECAY });
        }

        // ─── Globals ───
        this.uDelta = uniform(0);
        this.uTime = uniform(0);
        this.uFocalPoint = uniform(this.focalPoint.clone());
        this.uFocalRadius = uniform(options.focalRadius ?? 6.0);
        this.uGravityStrength = uniform(options.gravityStrength ?? 0.75);
        this.uTurbulence = uniform(options.turbulence ?? 0.5);
        this.uDamping = uniform(0.985);
        this.uMaxSpeed = uniform(8.0);

        // The swarm's half-extents: an ellipsoid in which the motes fill the annulus
        // between uRing.x and uRing.y (as fractions of the half-extents). The hole in the
        // middle is where the board stands.
        const radius = this.uFocalRadius.value;
        this.uExtent = uniform(
            options.extent?.clone?.() || new THREE.Vector3(radius, radius * 0.48, radius * 0.46),
        );
        this.uRing = uniform(new THREE.Vector2(options.ringInner ?? 0.24, options.ringOuter ?? 1.0));
        // Angular rate of the gyre at mid-radius (rad/s); the play's momentum raises it.
        this.uGyre = uniform(options.gyre ?? 0.26);
        // The disc is tipped out of the screen plane so one wing swims toward the lens
        // and the other away: z_plane = dot(q.xy, tilt), in half-extent units.
        this.uTilt = uniform(new THREE.Vector2(options.tiltX ?? 0.55, options.tiltY ?? 0.2));

        // Sources: xyz = world position, w = spread radius. The share of motes reborn as
        // dust anywhere in the annulus instead is uAmbient.
        this._emitters = Array.from({ length: EMITTER_COUNT }, () => new THREE.Vector4(0, 0, 0, 0.3));
        this.uEmitters = uniformArray(this._emitters, 'vec4');
        this.uAmbient = uniform(options.ambientShare ?? 0.22);
        // Weights of the flow's two octaves: (the slow weather, the eddies).
        this.uFlowGains = uniform(new THREE.Vector2(options.flowCoarse ?? 1, options.flowFine ?? 1));

        // The board's place in the world; its half-width sizes the swarm's inner hole.
        this.uBoardCenter = uniform(new THREE.Vector3(0, 0, 0));
        this.uBoardHalfExtents = uniform(new THREE.Vector3(0, 0, 0));

        // ─── Formations ───
        this.uShapeStrength = uniform(0);
        // How much of the free flow survives inside a formation (0 = frozen, 1 = untouched).
        this.uShapeOverride = uniform(0.35);
        // Rotation of the whole formation about the vertical axis: (cos, sin).
        this.uShapeRot = uniform(new THREE.Vector2(1, 0));
        this.uShapeScale = uniform(1);
        // Twin formations: on a wide frame a figure centred behind the board is half
        // hidden by it, so the swarm draws a mirrored pair, one either side. x = 1 when
        // twinned, y = how far each copy's centre is from the focal point (world units).
        this.uShapeTwin = uniform(new THREE.Vector2(0, 0));
        // Half-size of the figure as fitted (world units): the renderer runs a formation's
        // hue across this, so a small figure takes the same gradient as a large one.
        this.uShapeSpan = uniform(DEFAULT_SHAPE_SPAN);
        this._shapeFit = { halfWidth: Infinity, halfHeight: Infinity };
        this._shapeLayout = {
            twin: false, offsetX: 0, halfWidth: Infinity, halfHeight: Infinity,
        };

        this.computeNode = null;
        this._flow = [0, 0, 0];
        this._updateEmitters(0);
        this._initParticleState();
        generateShape('free', this.targetData, this.count);
        this.targetBuffer.needsUpdate = true;
    }

    /** Where source `k` is at `time`, in swarm space (q.xy; z is relative to the tilted disc). */
    _emitterAt(k, time, out) {
        const ring = this.uRing.value;
        const lane = (k + 0.5) / EMITTER_COUNT;
        // Alternate lanes inside and outside so neighbouring sources are not neighbours in radius.
        const mixLane = (k % 2 === 0 ? lane : 1 - lane) * 0.74 + 0.13;
        const r = ring.x + (ring.y - ring.x) * mixLane + Math.sin(time * 0.07 + k * 1.9) * 0.06;
        // The sources wander against the gyre, slowly: the ribbons never set into a pattern.
        const angle = (k / EMITTER_COUNT) * TAU + k * 0.61 - time * 0.04;
        out.x = Math.cos(angle) * r;
        out.y = Math.sin(angle) * r;
        out.z = Math.sin(time * 0.11 + k * 2.1) * 0.3;
        return out;
    }

    _updateEmitters(time) {
        const focal = this.uFocalPoint.value;
        const extent = this.uExtent.value;
        const tilt = this.uTilt.value;
        const q = this._emitterQ || (this._emitterQ = { x: 0, y: 0, z: 0 });
        // The spread follows the swarm's size, so a phone's narrow loop gets finer sources.
        const spread = 0.085 * Math.min(extent.x, extent.y * 2);
        for (let k = 0; k < EMITTER_COUNT; k += 1) {
            this._emitterAt(k, time, q);
            this._emitters[k].set(
                focal.x + q.x * extent.x,
                focal.y + q.y * extent.y,
                focal.z + (q.x * tilt.x + q.y * tilt.y + q.z) * extent.z,
                spread,
            );
        }
    }

    /**
     * The first frame, already composed: every ribbon laid out along its source's path as
     * if the swarm had been flying for a minute, and dust between.
     */
    _initParticleState() {
        const random = mulberry32(this._seed);
        const fp = this.focalPoint;
        const extent = this.uExtent.value;
        const ring = this.uRing.value;
        const tilt = this.uTilt.value;
        const gyre = this.uGyre.value;
        const ambient = this.uAmbient.value;
        const source = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < this.count; i += 1) {
            const i4 = i * 4;
            const seedA = random();
            const seedB = random();
            const age = random();
            const lifetime = 12 + random() * 18;
            let qx; let qy; let qz;
            if (seedB <= ambient) {
                const theta = random() * TAU;
                const r = ring.x + (ring.y - ring.x) * Math.sqrt(random());
                qx = Math.cos(theta) * r;
                qy = Math.sin(theta) * r;
                qz = (random() - 0.5) * 1.6;
            } else {
                // Born at its source `age × lifetime` seconds ago, carried round by the gyre
                // since, and spread by the waves the longer it has flown.
                const elapsed = age * lifetime;
                this._emitterAt(i % EMITTER_COUNT, -elapsed, source);
                const r0 = Math.hypot(source.x, source.y);
                const theta = Math.atan2(source.y, source.x) + (gyre / (r0 + 0.35)) * elapsed;
                const spread = 0.035 + 0.011 * elapsed;
                qx = Math.cos(theta) * r0 + (random() + random() - 1) * spread;
                qy = Math.sin(theta) * r0 + (random() + random() - 1) * spread * 2;
                qz = source.z + (random() + random() - 1) * spread * 2;
            }
            const r = Math.hypot(qx, qy);
            this.positionData[i4] = fp.x + qx * extent.x;
            this.positionData[i4 + 1] = fp.y + qy * extent.y;
            this.positionData[i4 + 2] = fp.z + (qx * tilt.x + qy * tilt.y + qz) * extent.z;
            this.positionData[i4 + 3] = age;

            const omega = gyre / (r + 0.35);
            this.velocityData[i4] = -qy * omega * extent.x;
            this.velocityData[i4 + 1] = qx * omega * extent.y;
            this.velocityData[i4 + 2] = 0;
            this.velocityData[i4 + 3] = lifetime;

            this.colorData[i4] = seedA; // colour offset, twinkle phase
            this.colorData[i4 + 1] = seedB; // dust or ribbon; size class; the top few are "hero" motes
            this.colorData[i4 + 2] = 0; // flash
            this.colorData[i4 + 3] = 0.2 + random() * 0.2; // energy
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    /** Back to the composed first frame (deterministic captures re-run the sim from here). */
    reset(seed) {
        if (Number.isFinite(seed)) this._seed = seed;
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            this._impulsePositions[i].value.set(0, 0, 0, 0);
            this._impulseWaves[i].value.set(0, 0, 0, 1);
        }
        this._updateEmitters(0);
        this._initParticleState();
    }

    createComputeNode() {
        if (this.isCPU) return null;
        const positions = storage(this.positionBuffer, 'vec4', this.count);
        const velocities = storage(this.velocityBuffer, 'vec4', this.count);
        const colors = storage(this.colorBuffer, 'vec4', this.count);
        const targets = storage(this.targetBuffer, 'vec4', this.count);

        const dt = this.uDelta;
        const time = this.uTime;
        const focal = this.uFocalPoint;
        const extent = this.uExtent;
        const ring = this.uRing;
        const tilt = this.uTilt;
        const gyre = this.uGyre;
        const contain = this.uGravityStrength;
        const turb = this.uTurbulence;
        const damping = this.uDamping;
        const maxSpeed = this.uMaxSpeed;
        const shapeStr = this.uShapeStrength;
        const shapeOverride = this.uShapeOverride;
        const shapeRot = this.uShapeRot;
        const shapeScale = this.uShapeScale;
        const shapeTwin = this.uShapeTwin;
        const emitters = this.uEmitters;
        const ambientShare = this.uAmbient;
        const flowGains = this.uFlowGains;
        const impulsePositions = this._impulsePositions;
        const impulseParams = this._impulseParams;
        const impulseWaves = this._impulseWaves;

        const computeFn = Fn(() => {
            const index = instanceIndex;
            const pos = positions.element(index).toVar();
            const vel = velocities.element(index).toVar();
            const col = colors.element(index).toVar();
            const tgt = targets.element(index).toVar();

            const p = pos.xyz.toVar();
            const v = vel.xyz.toVar();
            const age = pos.w.toVar();
            const flash = col.z.toVar();
            const idxF = float(index).toVar();

            // How firmly this mote is held by a formation (0 free … 1 held).
            const shapeW = shapeStr.mul(tgt.w).toVar();
            const hold = smoothstep(0.0, 0.5, shapeW).toVar();
            const flowKeep = float(1.0).sub(hold.mul(float(1.0).sub(shapeOverride.mul(0.4)))).toVar();

            // ── 1. The field ──
            const q = p.sub(focal).div(extent).toVar(); // swarm space: the annulus is r ∈ [in, out]
            const r = length(q.xy).toVar();
            const radial = q.xy.div(max(r, float(0.001))).toVar();
            const zOff = q.z.sub(dot(q.xy, tilt)).toVar();
            const flowOn = clamp(turb.mul(4.0), 0.0, 1.0).toVar();

            // Gyre: differential rotation (faster inside), an ellipse in world space.
            const omega = gyre.mul(flowOn).div(r.add(0.35)).toVar();
            const field = vec3(
                q.y.negate().mul(omega).mul(extent.x),
                q.x.mul(omega).mul(extent.y),
                0.0,
            ).toVar();

            // Soft walls: no force inside the annulus, a spring back toward it outside. Each
            // mote keeps its own idea of where the walls are, so the swarm has no shared
            // edge to pile up along: its rim frays instead of drawing an ellipse.
            const ringIn = ring.x.mul(col.x.mul(WALL_SPREAD_IN).add(1.0 - WALL_SPREAD_IN * 0.4)).toVar();
            const ringOut = ring.y.mul(col.x.mul(WALL_SPREAD_OUT).add(1.0 - WALL_SPREAD_OUT * 0.8)).toVar();
            const wall = max(ringIn.sub(r), float(0.0)).sub(max(r.sub(ringOut), float(0.0)))
                .mul(contain).mul(WALL_STIFFNESS);
            field.x.addAssign(radial.x.mul(wall).mul(extent.x));
            field.y.addAssign(radial.y.mul(wall).mul(extent.y));
            const zWall = max(abs(zOff).sub(DISC_HALF), float(0.0)).mul(sign(zOff)).negate()
                .mul(contain)
                .mul(WALL_STIFFNESS);
            field.z.addAssign(zWall.mul(extent.z));

            // The shear waves — made to slide ALONG the walls instead of into them. A flow
            // that presses on a wall piles motes against it; removing the component that
            // heads out of the annulus keeps the density even right up to the edge.
            const flow = flowFieldNode(p, time, flowGains.x, flowGains.y).mul(turb).toVar();
            const flowR = dot(flow.xy.div(extent.xy), radial).toVar();
            const leaving = max(
                smoothstep(ringOut.sub(0.3), ringOut.add(0.05), r).mul(step(0.0, flowR)),
                float(1.0).sub(smoothstep(ringIn, ringIn.add(0.2), r)).mul(step(flowR, 0.0)),
            );
            const trim = flowR.mul(leaving).negate();
            flow.x.addAssign(radial.x.mul(trim).mul(extent.x));
            flow.y.addAssign(radial.y.mul(trim).mul(extent.y));
            const leavingZ = smoothstep(DISC_HALF - 0.3, DISC_HALF + 0.05, abs(zOff))
                .mul(step(0.0, flow.z.mul(sign(zOff))));
            flow.z.mulAssign(float(1.0).sub(leavingZ));
            field.addAssign(flow);

            const follow = float(1.0).sub(exp(dt.mul(-FIELD_FOLLOW))).mul(flowKeep).mul(flowOn);
            v.addAssign(field.sub(v).mul(follow));

            // ── 2. Formation: spring + spiral approach ──
            // The figure turns about its own vertical axis; a twinned mote then takes the
            // copy on its side of the board, mirrored so the pair is symmetric.
            const tLocal = tgt.xyz.mul(shapeScale).toVar();
            const side = step(0.5, col.x).mul(2.0).sub(1.0).toVar();
            const turnedX = tLocal.x.mul(shapeRot.x).add(tLocal.z.mul(shapeRot.y));
            const tWorld = vec3(
                turnedX.mul(mix(float(1.0), side, shapeTwin.x)).add(side.mul(shapeTwin.x).mul(shapeTwin.y)),
                tLocal.y,
                tLocal.z.mul(shapeRot.x).sub(tLocal.x.mul(shapeRot.y)),
            ).add(focal).toVar();
            const toTarget = tWorld.sub(p).toVar();
            const distTarget = length(toTarget).toVar();
            v.addAssign(toTarget.mul(shapeW.mul(SHAPE_STIFFNESS)).mul(dt));
            v.addAssign(
                cross(vec3(0.0, 0.0, 1.0), toTarget)
                    .mul(shapeW.mul(SHAPE_SWIRL))
                    .mul(smoothstep(0.6, 5.0, distTarget))
                    .mul(dt),
            );

            // ── 3. Impulses ──
            // Old light fades first, so the frame a wave reaches a mote shows it at full.
            flash.mulAssign(exp(dt.mul(-FLASH_DECAY)));
            for (let i = 0; i < MAX_IMPULSES; i += 1) {
                const ip = impulsePositions[i];
                const ipar = impulseParams[i];
                const iw = impulseWaves[i];
                const offset = p.sub(ip.xyz).toVar();
                const dTrue = max(length(offset), float(0.05)).toVar();
                const outDir = offset.div(dTrue).toVar();
                // A squashed metric turns the ring into an ellipse lying along a cleared row.
                const d = length(vec3(offset.x, offset.y.mul(iw.w), offset.z.mul(WAVE_DEPTH))).toVar();
                const reach = max(float(1.0).sub(d.mul(0.18)), float(0.0));
                const g = d.sub(iw.x).div(max(iw.y, float(0.001)));
                const isWave = step(0.001, iw.y);
                const shape = mix(reach.mul(reach), exp(g.mul(g).negate()), isWave).toVar();
                const force = shape.mul(ip.w).mul(dt).toVar();

                const isAttract = step(1.5, ipar.w);
                const isVortex = step(0.5, ipar.w).sub(isAttract);
                const isRadial = float(1.0).sub(step(0.5, ipar.w));
                v.addAssign(outDir.mul(isRadial.sub(isAttract)).mul(force));
                v.addAssign(cross(ipar.xyz, outDir).mul(isVortex).mul(force));
                flash.assign(max(flash, shape.mul(iw.z)));
            }

            // ── 4. Damping + speed cap ──
            v.mulAssign(pow(damping, dt.mul(60.0)));
            v.mulAssign(exp(shapeW.mul(dt).mul(-SHAPE_DRAG)));
            const speed = length(v).toVar();
            If(speed.greaterThan(maxSpeed), () => {
                v.mulAssign(maxSpeed.div(speed));
            });

            // ── 5. Integrate ──
            p.addAssign(v.mul(dt));

            // ── 6. Life: strays age fast; a dead mote is reborn at its source, as dust in
            // the annulus, or on its formation target. The renderer has already faded it
            // to nothing by then. ──
            const stray = step(1.7, r).add(step(2.4, abs(zOff))).mul(float(1.0).sub(hold));
            age.addAssign(dt.div(vel.w).mul(stray.mul(8.0).add(1.0)));
            If(age.greaterThan(1.0), () => {
                const r1 = fract(sin(idxF.mul(12.9898).add(time.mul(0.37))).mul(43758.5453));
                const r2 = fract(sin(idxF.mul(78.233).add(time.mul(0.53))).mul(43758.5453));
                const r3 = fract(sin(idxF.mul(39.425).add(time.mul(0.71))).mul(43758.5453));
                // Dust
                const rr = mix(ring.x, ring.y, r1.sqrt());
                const theta = r2.mul(6.2832);
                const qx = cos(theta).mul(rr);
                const qy = sin(theta).mul(rr);
                const qz = qx.mul(tilt.x).add(qy.mul(tilt.y)).add(r3.sub(0.5).mul(1.6));
                const dust = focal.add(vec3(qx, qy, qz).mul(extent));
                // Ribbon: at the mote's source, denser toward its centre.
                const source = emitters.element(int(idxF.mod(float(EMITTER_COUNT))));
                const jitter = vec3(r1, r2, r3).sub(0.5).mul(2.0).toVar();
                const ribbon = source.xyz.add(jitter.mul(abs(jitter)).mul(source.w));
                const born = mix(ribbon, dust, step(col.y, ambientShare));
                p.assign(mix(born, tWorld, step(0.25, shapeW)));
                v.assign(vec3(0.0));
                age.assign(0.0);
            });

            // ── 7. Light: energy follows speed ──
            const energyTarget = clamp(speed.div(maxSpeed).mul(1.6).add(0.12), 0.0, 1.0);
            const energy = col.w.add(energyTarget.sub(col.w).mul(float(1.0).sub(exp(dt.mul(-7.0)))));

            positions.element(index).assign(vec4(p, age));
            velocities.element(index).assign(vec4(v, vel.w));
            colors.element(index).assign(vec4(col.x, col.y, flash, energy));
        });

        this.computeNode = computeFn().compute(this.count);
        return this.computeNode;
    }

    /** WebGL2 twin of the compute step — the same arithmetic, in the same order. */
    stepCPU() {
        if (!this.isCPU) return;
        const dt = this.uDelta.value;
        if (!(dt > 0)) return;
        const time = this.uTime.value;
        const focal = this.uFocalPoint.value;
        const fX = focal.x; const fY = focal.y; const fZ = focal.z;
        const extent = this.uExtent.value;
        const eX = extent.x; const eY = extent.y; const eZ = extent.z;
        const invX = 1 / eX; const invY = 1 / eY; const invZ = 1 / eZ;
        const ringInBase = this.uRing.value.x; const ringOutBase = this.uRing.value.y;
        const tiltX = this.uTilt.value.x; const tiltY = this.uTilt.value.y;
        const turb = this.uTurbulence.value;
        const flowOn = Math.max(0, Math.min(1, turb * 4));
        const gyre = this.uGyre.value * flowOn;
        const contain = this.uGravityStrength.value * WALL_STIFFNESS;
        const shape = this.uShapeStrength.value;
        const keepScale = 1 - this.uShapeOverride.value * 0.4;
        const rotC = this.uShapeRot.value.x;
        const rotS = this.uShapeRot.value.y;
        const shapeScale = this.uShapeScale.value;
        const twin = this.uShapeTwin.value.x > 0.5;
        const twinOffset = this.uShapeTwin.value.y;
        const followBase = (1 - Math.exp(-FIELD_FOLLOW * dt)) * flowOn;
        const damping = this.uDamping.value ** (dt * 60);
        const maxSpeed = this.uMaxSpeed.value;
        const maxSpeedSq = maxSpeed * maxSpeed;
        const energyRate = 1 - Math.exp(-7 * dt);
        const flashDecay = Math.exp(-FLASH_DECAY * dt);
        const ambient = this.uAmbient.value;
        const emitters = this._emitters;
        const positions = this.positionData;
        const velocities = this.velocityData;
        const colors = this.colorData;
        const targets = this.targetData;
        const flow = this._flow;
        const flowing = turb > 0;
        const gainCoarse = this.uFlowGains.value.x; const gainFine = this.uFlowGains.value.y;
        if (flowing) prepareFlowField(time);

        // Active impulses, unpacked once into a flat list.
        const imp = this._impulseScratch || (this._impulseScratch = new Float64Array(MAX_IMPULSES * 12));
        let impCount = 0;
        for (let k = 0; k < MAX_IMPULSES; k += 1) {
            const ip = this._impulsePositions[k].value;
            if (!(ip.w > 0.01)) continue;
            const par = this._impulseParams[k].value;
            const wave = this._impulseWaves[k].value;
            imp.set(
                [ip.x, ip.y, ip.z, ip.w, par.x, par.y, par.z, par.w, wave.x, wave.y, wave.z, wave.w],
                impCount * 12,
            );
            impCount += 1;
        }

        for (let i = 0; i < this.count; i += 1) {
            const j = i * 4;
            let x = positions[j]; let y = positions[j + 1]; let z = positions[j + 2];
            let vx = velocities[j]; let vy = velocities[j + 1]; let vz = velocities[j + 2];
            let flash = colors[j + 2] * flashDecay;

            const seedA = colors[j];
            const ringIn = ringInBase * (seedA * WALL_SPREAD_IN + 1 - WALL_SPREAD_IN * 0.4);
            const ringOut = ringOutBase * (seedA * WALL_SPREAD_OUT + 1 - WALL_SPREAD_OUT * 0.8);
            const outerBand = ringOut - 0.3; const innerBand = ringIn + 0.2;
            const shapeW = shape * targets[j + 3];
            const hold = shapeW > 0 ? smooth01(0, 0.5, shapeW) : 0;

            // 1. Field
            const qx = (x - fX) * invX;
            const qy = (y - fY) * invY;
            const qz = (z - fZ) * invZ;
            const r = Math.sqrt(qx * qx + qy * qy);
            const rs = r > 0.001 ? r : 0.001;
            const radX = qx / rs; const radY = qy / rs;
            const zOff = qz - (qx * tiltX + qy * tiltY);
            const zAbs = zOff < 0 ? -zOff : zOff;
            const zSign = zOff < 0 ? -1 : 1;
            if (followBase > 0) {
                const omega = gyre / (r + 0.35);
                let wall = 0;
                if (r < ringIn) wall = (ringIn - r) * contain;
                else if (r > ringOut) wall = -(r - ringOut) * contain;
                let fx = (-qy * omega + radX * wall) * eX;
                let fy = (qx * omega + radY * wall) * eY;
                let fz = zAbs > DISC_HALF ? -(zAbs - DISC_HALF) * zSign * contain * eZ : 0;
                if (flowing) {
                    sampleFlowPrepared(x, y, z, flow, gainCoarse, gainFine);
                    let wx = flow[0] * turb; let wy = flow[1] * turb; let wz = flow[2] * turb;
                    // Only motes near a wall need the wall-sliding trim.
                    if (r > outerBand || r < innerBand) {
                        const flowR = wx * invX * radX + wy * invY * radY;
                        let leaving = 0;
                        if (flowR >= 0 && r > outerBand) leaving = smooth01(outerBand, ringOut + 0.05, r);
                        if (flowR <= 0 && r < innerBand) {
                            leaving = Math.max(leaving, 1 - smooth01(ringIn, innerBand, r));
                        }
                        if (leaving > 0) {
                            const trim = -flowR * leaving;
                            wx += radX * trim * eX; wy += radY * trim * eY;
                        }
                    }
                    if (zAbs > DISC_HALF - 0.3 && wz * zSign >= 0) {
                        wz *= 1 - smooth01(DISC_HALF - 0.3, DISC_HALF + 0.05, zAbs);
                    }
                    fx += wx; fy += wy; fz += wz;
                }
                const follow = followBase * (1 - hold * keepScale);
                vx += (fx - vx) * follow; vy += (fy - vy) * follow; vz += (fz - vz) * follow;
            }

            // 2. Formation
            const lx = targets[j] * shapeScale;
            const lz = targets[j + 2] * shapeScale;
            let tx = lx * rotC + lz * rotS;
            if (twin) {
                const side = seedA >= 0.5 ? 1 : -1;
                tx = tx * side + side * twinOffset;
            }
            tx += fX;
            const ty = targets[j + 1] * shapeScale + fY;
            const tz = lz * rotC - lx * rotS + fZ;
            let drag = damping;
            if (shapeW > 0) {
                const dx = tx - x; const dy = ty - y; const dz = tz - z;
                const pull = shapeW * SHAPE_STIFFNESS * dt;
                vx += dx * pull; vy += dy * pull; vz += dz * pull;
                const swirl = shapeW * SHAPE_SWIRL * smooth01(0.6, 5, Math.sqrt(dx * dx + dy * dy + dz * dz)) * dt;
                vx += -dy * swirl; vy += dx * swirl; // cross(ẑ, toTarget)
                drag *= Math.exp(-shapeW * SHAPE_DRAG * dt);
            }

            // 3. Impulses
            for (let a = 0; a < impCount; a += 1) {
                const o = a * 12;
                const ox = x - imp[o]; const oy = y - imp[o + 1]; const oz = z - imp[o + 2];
                const dSq = ox * ox + oy * oy + oz * oz;
                const dTrue = dSq > 0.0025 ? Math.sqrt(dSq) : 0.05;
                const sy = oy * imp[o + 11];
                const sz = oz * WAVE_DEPTH;
                const d = Math.sqrt(ox * ox + sy * sy + sz * sz);
                let falloff;
                if (imp[o + 9] > 0.001) {
                    const g = (d - imp[o + 8]) / imp[o + 9];
                    falloff = g * g < 30 ? Math.exp(-g * g) : 0;
                } else {
                    const reach = 1 - d * 0.18;
                    falloff = reach > 0 ? reach * reach : 0;
                }
                if (falloff <= 0) continue;
                const force = (falloff * imp[o + 3] * dt) / dTrue;
                const type = imp[o + 7];
                if (type < 0.5) {
                    vx += ox * force; vy += oy * force; vz += oz * force;
                } else if (type < 1.5) {
                    vx += (imp[o + 5] * oz - imp[o + 6] * oy) * force;
                    vy += (imp[o + 6] * ox - imp[o + 4] * oz) * force;
                    vz += (imp[o + 4] * oy - imp[o + 5] * ox) * force;
                } else {
                    vx -= ox * force; vy -= oy * force; vz -= oz * force;
                }
                const lit = falloff * imp[o + 10];
                if (lit > flash) flash = lit;
            }

            // 4. Damping + cap
            vx *= drag; vy *= drag; vz *= drag;
            const speedSq = vx * vx + vy * vy + vz * vz;
            let speed = Math.sqrt(speedSq);
            if (speedSq > maxSpeedSq) {
                const cap = maxSpeed / speed; vx *= cap; vy *= cap; vz *= cap;
                speed = maxSpeed;
            }

            // 5. Integrate
            x += vx * dt; y += vy * dt; z += vz * dt;

            // 6. Life
            const stray = ((r > 1.7 ? 1 : 0) + (zAbs > 2.4 ? 1 : 0)) * (1 - hold);
            let age = positions[j + 3] + (dt / velocities[j + 3]) * (1 + stray * 8);
            if (age > 1) {
                if (shapeW >= 0.25) {
                    x = tx; y = ty; z = tz;
                } else {
                    const r1 = hash01(i * 12.9898 + time * 0.37);
                    const r2 = hash01(i * 78.233 + time * 0.53);
                    const r3 = hash01(i * 39.425 + time * 0.71);
                    if (colors[j + 1] <= ambient) {
                        const rr = ringInBase + (ringOutBase - ringInBase) * Math.sqrt(r1);
                        const theta = r2 * 6.2832;
                        const bx = Math.cos(theta) * rr; const by = Math.sin(theta) * rr;
                        x = fX + bx * eX;
                        y = fY + by * eY;
                        z = fZ + (bx * tiltX + by * tiltY + (r3 - 0.5) * 1.6) * eZ;
                    } else {
                        const source = emitters[i % EMITTER_COUNT];
                        const jx = (r1 - 0.5) * 2; const jy = (r2 - 0.5) * 2; const jz = (r3 - 0.5) * 2;
                        x = source.x + jx * Math.abs(jx) * source.w;
                        y = source.y + jy * Math.abs(jy) * source.w;
                        z = source.z + jz * Math.abs(jz) * source.w;
                    }
                }
                vx = 0; vy = 0; vz = 0;
                age = 0;
            }

            positions[j] = x; positions[j + 1] = y; positions[j + 2] = z; positions[j + 3] = age;
            velocities[j] = vx; velocities[j + 1] = vy; velocities[j + 2] = vz;
            let energyTarget = (speed / maxSpeed) * 1.6 + 0.12;
            if (energyTarget > 1) energyTarget = 1;
            colors[j + 2] = flash;
            colors[j + 3] += (energyTarget - colors[j + 3]) * energyRate;
        }
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
    }

    /**
     * Start an impulse. A plain call is a blunt push/swirl/pull that fades in a quarter
     * second. Pass `wave` to launch a travelling ring instead.
     *
     * @param {{x:number,y:number,z:number}} position
     * @param {number} strength
     * @param {{x:number,y:number,z:number}|null} [dir]  vortex axis
     * @param {number} [type]  IMPULSE_TYPE
     * @param {{ speed?: number, width?: number, flash?: number, squash?: number, decay?: number,
     *   radius?: number }} [wave]
     */
    pushImpulse(position, strength, dir, type = IMPULSE_TYPE.RADIAL, wave = null) {
        let slot = -1;
        let weakest = Infinity;
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            const { w } = this._impulsePositions[i].value;
            if (w < 0.01) { slot = i; break; }
            if (w < weakest) { weakest = w; slot = i; }
        }
        this._impulsePositions[slot].value.set(position.x, position.y, position.z, strength);
        const d = dir || { x: 0, y: 0, z: 1 };
        this._impulseParams[slot].value.set(d.x, d.y, d.z, type);
        const meta = this._impulseMeta[slot];
        if (wave) {
            this._impulseWaves[slot].value.set(
                wave.radius ?? 0,
                Math.max(0.05, wave.width ?? 1),
                wave.flash ?? 0,
                wave.squash ?? 1,
            );
            meta.speed = wave.speed ?? 8;
            meta.decay = wave.decay ?? 1.6;
        } else {
            this._impulseWaves[slot].value.set(0, 0, 0, 1);
            meta.speed = 0;
            meta.decay = IMPULSE_DECAY;
        }
        return slot;
    }

    /** Impulses fade on their own; a wave's ring also travels. */
    decayImpulses(delta) {
        for (let i = 0; i < MAX_IMPULSES; i += 1) {
            const ip = this._impulsePositions[i].value;
            if (ip.w <= 0) continue;
            const meta = this._impulseMeta[i];
            const k = Math.exp(-delta * meta.decay);
            const wave = this._impulseWaves[i].value;
            ip.w *= k;
            wave.z *= k;
            wave.x += meta.speed * delta;
            if (ip.w < 0.01) {
                ip.w = 0;
                wave.z = 0;
            }
        }
    }

    /**
     * The board's place in the world. The swarm keeps a soft elliptical hole there: wide
     * enough that the densest part of the gyre passes beside the board, not behind it.
     */
    setBoardZone({ center, halfExtents } = {}) {
        if (center) this.uBoardCenter.value.copy(center);
        if (halfExtents) {
            this.uBoardHalfExtents.value.copy(halfExtents);
            const hole = halfExtents.x / Math.max(0.001, this.uExtent.value.x);
            if (Number.isFinite(hole) && hole > 0) {
                this.uRing.value.x = Math.max(0.14, Math.min(0.46, hole * 0.92));
            }
        }
    }

    /** The swarm's half-extents in world units (follows the frame's aspect). */
    setExtent(x, y, z) {
        this.uExtent.value.set(Math.max(0.5, x), Math.max(0.5, y), Math.max(0.5, z));
    }

    /** The half-size a formation may occupy; larger authored shapes are scaled to fit. */
    setShapeFit(halfWidth, halfHeight) {
        this._shapeFit.halfWidth = halfWidth > 0 ? halfWidth : Infinity;
        this._shapeFit.halfHeight = halfHeight > 0 ? halfHeight : Infinity;
    }

    /**
     * Where formations go. `twin` draws each figure as a mirrored pair centred `offsetX`
     * either side of the focal point, each fitted to halfWidth × halfHeight; otherwise one
     * figure sits on the focal point and `setShapeFit` bounds it. Applies from the next
     * `setShape` (a figure already formed keeps the layout it was given).
     */
    setShapeLayout({
        twin = false, offsetX = 0, halfWidth = Infinity, halfHeight = Infinity,
    } = {}) {
        this._shapeLayout.twin = twin === true && offsetX > 0;
        this._shapeLayout.offsetX = offsetX;
        this._shapeLayout.halfWidth = halfWidth > 0 ? halfWidth : Infinity;
        this._shapeLayout.halfHeight = halfHeight > 0 ? halfHeight : Infinity;
    }

    /**
     * Change the formation the swarm is drawn to. Rewrites the targets; the running
     * forces carry out the morph.
     * @param {string} shapeName  a name from shape-formations.js ('free' releases)
     * @param {object} [opts]     shape options, plus `jitter` (world units, default 0.14),
     *                            `layout: 'center'` to keep one centred figure on a wide frame,
     *                            and `keepDust: true` to leave the dust motes in the flow
     * @returns {boolean} false when the shape is unknown
     */
    setShape(shapeName, opts = {}) {
        const ok = generateShape(shapeName, this.targetData, this.count, opts);
        if (!ok) {
            console.warn(`[FluidParticleSim] Unknown shape: ${shapeName}`);
            return false;
        }
        if (shapeName !== 'free') this._finishShape(opts);
        this.targetBuffer.needsUpdate = true;
        this.currentShape = shapeName;
        return true;
    }

    /**
     * Fit the authored targets to the frame and scatter each one a little. The generators
     * place motes on regular lattices (golden-angle indexing); thousands of motes on a
     * lattice draw moiré bands, and a small per-mote offset turns the bands into grain.
     */
    _finishShape(opts) {
        const targets = this.targetData;
        let halfW = 0;
        let halfH = 0;
        for (let i = 0; i < this.count; i += 1) {
            const j = i * 4;
            halfW = Math.max(halfW, Math.abs(targets[j]));
            halfH = Math.max(halfH, Math.abs(targets[j + 1]));
        }
        const layout = this._shapeLayout;
        const twin = layout.twin && opts.layout !== 'center';
        const box = twin ? layout : this._shapeFit;
        const fit = Math.min(
            1,
            box.halfWidth / Math.max(halfW, 0.001),
            box.halfHeight / Math.max(halfH, 0.001),
        );
        this.uShapeTwin.value.set(twin ? 1 : 0, twin ? layout.offsetX : 0);
        this.uShapeSpan.value = Math.max(MIN_SHAPE_SPAN, Math.max(halfW, halfH) * fit);
        const jitter = (opts.jitter ?? 0.14) * Math.max(0.45, fit);
        // With `keepDust` the dust between the ribbons stays in the flow: the figure
        // forms in front of a swarm that is still moving, instead of emptying the frame.
        const dustStays = opts.keepDust === true;
        const ambient = this.uAmbient.value;
        const seeds = this.colorData;
        for (let i = 0; i < this.count; i += 1) {
            const j = i * 4;
            if (dustStays && seeds[j + 1] <= ambient) targets[j + 3] = 0;
            const a = hash01(i * 0.731 + 1.3) * TAU;
            const b = hash01(i * 1.913 + 7.7) * 2 - 1;
            const rad = Math.cbrt(hash01(i * 3.117 + 4.1)) * jitter;
            const s = Math.sqrt(1 - b * b);
            targets[j] = targets[j] * fit + Math.cos(a) * s * rad;
            targets[j + 1] = targets[j + 1] * fit + Math.sin(a) * s * rad;
            targets[j + 2] = targets[j + 2] * fit + b * rad;
        }
        this.shapeFitScale = fit;
    }

    /**
     *   0    free
     *   0.3  a suggestion — the swarm leans into the shape and keeps flowing
     *   0.7  a clear formation
     *   1.5  tight
     */
    setShapeStrength(strength) {
        this.uShapeStrength.value = Math.max(0, strength || 0);
    }

    /** How much of the free flow survives inside a formation (0 frozen … 1 untouched). */
    setShapeOverride(override) {
        this.uShapeOverride.value = Math.max(0, Math.min(1, override || 0));
    }

    /** Turn the whole formation about the vertical axis (radians) and scale it. */
    setShapePose(yaw = 0, scale = 1) {
        this.uShapeRot.value.set(Math.cos(yaw), Math.sin(yaw));
        this.uShapeScale.value = scale;
    }

    update(delta, time, options = {}) {
        this.uDelta.value = Math.min(delta, 0.033); // cap big deltas (tab-switch)
        this.uTime.value = time;
        if (Number.isFinite(options.gravityStrength)) {
            this.uGravityStrength.value = options.gravityStrength;
        }
        if (Number.isFinite(options.turbulence)) {
            this.uTurbulence.value = options.turbulence;
        }
        if (Number.isFinite(options.gyre)) this.uGyre.value = options.gyre;
        if (options.focalPoint) {
            this.uFocalPoint.value.copy(options.focalPoint);
        }
        this._updateEmitters(time);
        this.decayImpulses(this.uDelta.value);
    }

    getPositionBuffer() { return this.positionBuffer; }

    getVelocityBuffer() { return this.velocityBuffer; }

    getColorBuffer() { return this.colorBuffer; }

    dispose() {
        this.computeNode = null;
        this.positionBuffer = null;
        this.velocityBuffer = null;
        this.colorBuffer = null;
        this.targetBuffer = null;
        this.positionData = null;
        this.velocityData = null;
        this.colorData = null;
        this.targetData = null;
        this._impulsePositions = null;
        this._impulseParams = null;
        this._impulseWaves = null;
        this._impulseMeta = null;
    }
}
