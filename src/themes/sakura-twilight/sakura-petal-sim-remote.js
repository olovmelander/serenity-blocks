/**
 * Sakura's petals stepped in a module Worker (sakura-petal-sim.worker.js) while the game plays: the
 * simulation was 2-3 ms of every storm frame on the page (play-feel probe 2026-10-16, storms at
 * 121-125 fps). The proxy has the simulation's face (step, spawn, reset, counts and the three render
 * buffers): the page sends each frame's step with its wind and fields and the events' spawns, and
 * copies the worker's last result into the render buffers, one frame behind. A worker that is
 * still busy carries the time over to the next request; a worker that fails hands the simulation
 * back to the page, which continues from the state it last saw.
 *
 * Built from a page simulation fresh from its reset (the same first frame as without a worker).
 * The worker draws the petals' chances from its own seed: the page's random sequence is the
 * rest of the garden's.
 */

/** What a frame's wind and fields carry across (numbers and kinds only). */
function plainEnv(env = {}) {
    const plain = {};
    ['windX', 'windZ', 'breeze', 'gust'].forEach((key) => {
        if (Number.isFinite(env[key])) plain[key] = env[key];
    });
    const flat = (object) => {
        const out = {};
        Object.entries(object).forEach(([key, value]) => {
            if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') out[key] = value;
        });
        return out;
    };
    plain.front = env.front ? flat(env.front) : null;
    plain.fields = (env.fields || []).map(flat);
    return plain;
}

export class SakuraPetalSimRemote {
    /**
     * @param {import('./sakura-petal-sim.js').SakuraPetalSim} local  a page simulation, just reset
     * @param {() => Worker} createWorker
     * @param {number} [seed]  the worker's own chances
     */
    constructor(local, createWorker, seed = 0x5aa7) {
        this.local = local;
        this.count = local.count;
        this.reserve = local.reserve;
        this.ambient = local.ambient;
        // The render buffers stay the page simulation's: the petals' attributes wrap them.
        this.outPosition = local.outPosition;
        this.outRotation = local.outRotation;
        this.outLook = local.outLook;
        this.time = local.time;
        this.airborne = local.airborne;
        this.lastCounts = local.counts();
        this.spawns = [];
        this.resetQueued = false;
        this.carry = 0;
        this.inFlight = false;
        this.failed = false;
        this.disposed = false;
        this.spare = {
            position: new Float32Array(this.outPosition.length),
            rotation: new Float32Array(this.outRotation.length),
            look: new Float32Array(this.outLook.length),
        };
        this.worker = createWorker();
        this.worker.onmessage = (event) => this.receive(event?.data);
        this.worker.onerror = () => this.fail();
        this.worker.postMessage({
            type: 'init',
            options: {
                count: local.count, reserve: local.reserve, crownPoints: local.crownPoints, bounds: local.bounds,
            },
            seed,
            state: local.snapshot(),
        });
    }

    spawn(...args) {
        if (this.failed) {
            this.local.spawn(...args);
            return;
        }
        this.spawns.push(args);
    }

    reset() {
        if (this.failed) {
            this.local.reset();
            return;
        }
        this.resetQueued = true;
        this.spawns.length = 0;
    }

    step(dt, env) {
        if (this.disposed) return;
        if (this.failed) {
            this.local.step(dt, env);
            this.airborne = this.local.airborne;
            this.time = this.local.time;
            return;
        }
        if (!Number.isFinite(dt) || dt <= 0) return;
        // (The simulation clamps a step to 0.05 s: time the worker could not take is let go.)
        this.carry = Math.min(0.05, this.carry + dt);
        if (this.inFlight || !this.spare) return;
        const out = this.spare;
        this.spare = null;
        this.inFlight = true;
        const { spawns } = this;
        this.spawns = [];
        try {
            this.worker.postMessage({
                type: 'step', dt: this.carry, env: plainEnv(env), spawns, reset: this.resetQueued, out,
            }, [out.position.buffer, out.rotation.buffer, out.look.buffer]);
            this.carry = 0;
            this.resetQueued = false;
        } catch {
            this.fail();
        }
    }

    receive(data) {
        if (this.disposed || this.failed || data?.type !== 'frame') return;
        const { out } = data;
        this.outPosition.set(out.position);
        this.outRotation.set(out.rotation);
        this.outLook.set(out.look);
        this.spare = out;
        this.inFlight = false;
        this.airborne = data.airborne;
        this.time = data.time;
        this.lastCounts = data.counts;
    }

    /** The worker failed: the page carries on from the last state it was shown. */
    fail() {
        if (this.failed || this.disposed) return;
        this.failed = true;
        this.worker?.terminate();
        this.worker = null;
        // The page simulation resumes where its buffers stand (the positions, sizes and turns
        // the last frame showed); its velocities restart from the moment it was handed over.
        const { local } = this;
        local.outPosition = this.outPosition;
        local.outRotation = this.outRotation;
        local.outLook = this.outLook;
        for (let i = 0; i < local.count; i += 1) {
            local.position[i * 3] = this.outPosition[i * 4];
            local.position[i * 3 + 1] = this.outPosition[i * 4 + 1];
            local.position[i * 3 + 2] = this.outPosition[i * 4 + 2];
        }
    }

    counts() {
        return this.failed ? this.local.counts() : { ...this.lastCounts };
    }

    dispose() {
        this.disposed = true;
        this.worker?.terminate();
        this.worker = null;
    }
}
