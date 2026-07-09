/* eslint-disable import/no-extraneous-dependencies */
/**
 * Starlight - Constellation Controller (the signature magic)
 *
 * "Constellations that draw themselves." A self-contained overlay (no stardust
 * compute-morph dependency): on trigger it places a figure in the visible sky
 * around the central game canvas, then runs a state machine. Node stars pop in,
 * luminous lines grow between them, the sign holds with a gentle breath, then
 * fades. Appears ambiently (rare) and on big game moments.
 *
 * Pure CPU here: writes flat arrays the renderer (constellation-lines.js) wraps
 * as InstancedBufferAttributes (mutate here, flag needsUpdate there).
 */
export const MAX_SIGNS = 12;
export const MAX_NODES_PER_SIGN = 10;
export const MAX_EDGES_PER_SIGN = 12;
export const MAX_NODES = MAX_SIGNS * MAX_NODES_PER_SIGN;
export const MAX_EDGES = MAX_SIGNS * MAX_EDGES_PER_SIGN;

// Figures in normalized 2D (~unit circle). nodes:[[x,y]], edges:[[a,b]].
const FIGURES = {
    // 5-point star drawn as a single-stroke pentagram - a rare signature.
    wish: {
        nodes: [[0, 1], [0.951, 0.309], [0.588, -0.809], [-0.588, -0.809], [-0.951, 0.309]],
        edges: [[0, 2], [2, 4], [4, 1], [1, 3], [3, 0]],
    },
    aries: {
        nodes: [[-0.95, -0.18], [-0.55, 0.45], [-0.08, 0.12], [0.55, 0.45], [0.95, -0.18]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    },
    taurus: {
        nodes: [[-1, 0.55], [-0.45, 0.1], [0, -0.1], [0.45, 0.1], [1, 0.55], [0, -0.9]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5]],
    },
    gemini: {
        nodes: [[-0.65, 0.9], [-0.65, 0], [-0.65, -0.9], [0.65, 0.9], [0.65, 0], [0.65, -0.9]],
        edges: [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [1, 4], [2, 5]],
    },
    cancer: {
        nodes: [[-0.95, 0.38], [-0.45, 0.62], [0.05, 0.28], [-0.05, -0.18], [0.48, -0.55], [0.95, -0.32]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
    },
    leo: {
        nodes: [[-0.95, -0.2], [-0.45, 0.35], [-0.05, 0.72], [0.35, 0.48], [0.42, -0.12], [0.8, -0.55], [1, -0.05]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    },
    virgo: {
        nodes: [
            [-1, 0.45], [-0.62, -0.2], [-0.28, 0.34], [0.02, -0.24],
            [0.32, 0.28], [0.62, -0.22], [0.95, -0.48], [0.72, 0.12],
        ],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [5, 7], [7, 6]],
    },
    libra: {
        nodes: [[-1, -0.35], [-0.45, -0.35], [-0.2, 0.25], [0, 0.48], [0.2, 0.25], [0.45, -0.35], [1, -0.35]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [1, 5]],
    },
    scorpio: {
        nodes: [[-1, 0.42], [-0.62, -0.14], [-0.22, 0.34], [0.15, -0.2], [0.52, 0.18], [0.82, -0.38], [1, -0.02]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]],
    },
    sagittarius: {
        nodes: [[-0.85, -0.65], [-0.2, -0.05], [0.45, 0.55], [0.95, 0.82], [0.7, 0.28], [0.25, 0.9], [-0.55, 0.15]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [1, 6]],
    },
    capricorn: {
        nodes: [
            [-1, 0.35], [-0.55, -0.05], [-0.15, 0.32], [0.18, -0.05],
            [0.48, -0.58], [0.88, -0.42], [0.78, 0.02], [0.38, 0.22],
        ],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 3]],
    },
    aquarius: {
        nodes: [
            [-1, 0.25], [-0.65, 0.55], [-0.3, 0.25], [0.05, 0.55],
            [0.4, 0.25], [0.75, 0.55], [-0.75, -0.4], [-0.35, -0.1],
            [0.05, -0.4], [0.45, -0.1],
        ],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [7, 8], [8, 9]],
    },
    pisces: {
        nodes: [[-0.95, 0.55], [-0.55, 0.2], [-0.95, -0.15], [0, 0.08], [0.95, 0.55], [0.55, 0.2], [0.95, -0.15]],
        edges: [[0, 1], [1, 2], [1, 3], [3, 5], [4, 5], [5, 6]],
    },
    orion: {
        nodes: [[-0.72, 0.78], [0.64, 0.68], [-0.22, 0.12], [0.08, 0.02], [0.38, -0.08], [-0.74, -0.72], [0.7, -0.78]],
        edges: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
    },
    cygnus: {
        nodes: [[0, 1], [0, 0.35], [0, -0.2], [0, -0.9], [-0.9, 0.08], [0.9, 0.08]],
        edges: [[0, 1], [1, 2], [2, 3], [4, 2], [2, 5]],
    },
    lyra: {
        nodes: [[-0.35, 0.85], [0.48, 0.55], [0.75, -0.18], [0.05, -0.82], [-0.72, -0.22], [-0.08, 0.08]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 5], [5, 2]],
    },
    crown: {
        nodes: [[-1, -0.25], [-0.62, 0.42], [-0.22, 0.78], [0.22, 0.78], [0.62, 0.42], [1, -0.25]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
    },
    diamond: {
        nodes: [[0, 1], [0.7, 0], [0, -1], [-0.7, 0]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
    },
    dipper: {
        nodes: [[-1, 0.2], [-0.5, 0.4], [-0.4, -0.1], [-0.9, -0.3], [0, 0.5], [0.5, 0.72], [1, 0.62]],
        edges: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5], [5, 6]],
    },
};

const ZODIAC_NAMES = [
    'aries',
    'taurus',
    'gemini',
    'cancer',
    'leo',
    'virgo',
    'libra',
    'scorpio',
    'sagittarius',
    'capricorn',
    'aquarius',
    'pisces',
];
const CELESTIAL_NAMES = ['orion', 'cygnus', 'lyra', 'crown', 'dipper', 'diamond'];
const AMBIENT_NAMES = [...ZODIAC_NAMES, ...CELESTIAL_NAMES];
const EARNED_NAMES = ['wish', ...ZODIAC_NAMES, 'orion', 'cygnus', 'crown'];

export const CONSTELLATION_FIGURE_NAMES = Object.freeze(Object.keys(FIGURES));
export const CONSTELLATION_ZODIAC_NAMES = Object.freeze([...ZODIAC_NAMES]);

const PLACEMENT_LANES = Object.freeze([
    [-22, 12],
    [22, 10],
    [-24, -2],
    [24, -4],
    [-17, -12],
    [17, -12],
    [-8, 15],
    [8, 15],
    [0, 16],
]);

function smoothstep01(x) {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
}

export class ConstellationController {
    constructor(options = {}) {
        this.nodePos = new Float32Array(MAX_NODES * 3);
        this.nodeScale = new Float32Array(MAX_NODES);
        this.nodeAlpha = new Float32Array(MAX_NODES);
        this.edgeA = new Float32Array(MAX_EDGES * 3);
        this.edgeB = new Float32Array(MAX_EDGES * 3);
        this.edgeProgress = new Float32Array(MAX_EDGES);
        this.edgeAlpha = new Float32Array(MAX_EDGES);
        this.activeNodes = 0;
        this.activeEdges = 0;

        this.state = 'idle';
        this.t = 0;
        this._lastFigure = null;
        this.ambient = options.ambient !== false;
        this._nextAmbient = 6 + Math.random() * 12;
        this._laneCursor = Math.floor(Math.random() * PLACEMENT_LANES.length);
        this._slotCursor = 0;
        this._birthSeq = 0;

        this.drawDur = 1.8;
        this.holdDur = options.holdDur ?? 12.0;
        this.fadeDur = 2.4;

        this._signs = Array.from({ length: MAX_SIGNS }, (_, slot) => ({
            slot,
            state: 'idle',
            t: 0,
            birth: 0,
            fig: null,
            nodeOffset: slot * MAX_NODES_PER_SIGN,
            edgeOffset: slot * MAX_EDGES_PER_SIGN,
            activeNodes: 0,
            activeEdges: 0,
        }));
        this._clearAll();
    }

    _pickFigure(name) {
        let pool = AMBIENT_NAMES;
        if (name === 'zodiac') pool = ZODIAC_NAMES;
        else if (name === 'earned') pool = EARNED_NAMES;
        else if (name && FIGURES[name]) return name;

        let fig = pool[Math.floor(Math.random() * pool.length)];
        if (fig === this._lastFigure && pool.length > 1) {
            const others = pool.filter((f) => f !== this._lastFigure);
            fig = others[Math.floor(Math.random() * others.length)];
        }
        return fig;
    }

    _findSlot() {
        for (let i = 0; i < MAX_SIGNS; i += 1) {
            const idx = (this._slotCursor + i) % MAX_SIGNS;
            if (this._signs[idx].state === 'idle') {
                this._slotCursor = (idx + 1) % MAX_SIGNS;
                return this._signs[idx];
            }
        }
        return null;
    }

    _syncState() {
        let nodeCount = 0;
        let edgeCount = 0;
        let anyActive = false;
        for (const sign of this._signs) {
            if (sign.state !== 'idle') {
                anyActive = true;
                nodeCount += sign.activeNodes;
                edgeCount += sign.activeEdges;
            }
        }
        this.activeNodes = nodeCount;
        this.activeEdges = edgeCount;
        this.state = anyActive ? 'active' : 'idle';
    }

    _clearSlotArrays(sign) {
        for (let i = 0; i < MAX_NODES_PER_SIGN; i += 1) {
            const idx = sign.nodeOffset + i;
            this.nodePos[idx * 3] = 0;
            this.nodePos[idx * 3 + 1] = 0;
            this.nodePos[idx * 3 + 2] = -40;
            this.nodeScale[idx] = 0;
            this.nodeAlpha[idx] = 0;
        }
        for (let e = 0; e < MAX_EDGES_PER_SIGN; e += 1) {
            const idx = sign.edgeOffset + e;
            this.edgeA[idx * 3] = 0;
            this.edgeA[idx * 3 + 1] = 0;
            this.edgeA[idx * 3 + 2] = -40;
            this.edgeB[idx * 3] = 0;
            this.edgeB[idx * 3 + 1] = 0;
            this.edgeB[idx * 3 + 2] = -40;
            this.edgeProgress[idx] = 0;
            this.edgeAlpha[idx] = 0;
        }
    }

    _retireSlot(sign) {
        this._clearSlotArrays(sign);
        sign.state = 'idle';
        sign.t = 0;
        sign.fig = null;
        sign.activeNodes = 0;
        sign.activeEdges = 0;
        this._syncState();
    }

    _clearAll() {
        for (const sign of this._signs) this._retireSlot(sign);
    }

    /** Place + start drawing a figure (random if unnamed, anti-repeat). */
    trigger(name) {
        const fig = this._pickFigure(name);
        this._lastFigure = fig;
        const f = FIGURES[fig];
        const sign = this._findSlot();
        if (!sign) return null;
        this._clearSlotArrays(sign);

        // Placement: side/top/lower-corner sky lanes, avoiding the game canvas.
        this._laneCursor = (this._laneCursor + 1) % PLACEMENT_LANES.length;
        const lane = PLACEMENT_LANES[this._laneCursor];
        const cx = lane[0] + (Math.random() * 2 - 1) * 3.5;
        const cy = lane[1] + (Math.random() * 2 - 1) * 2.2;
        const cz = -40;
        const scale = 3.7 + Math.random() * 2.3;
        const rot = (Math.random() * 2 - 1) * 0.5;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        sign.activeNodes = Math.min(MAX_NODES_PER_SIGN, f.nodes.length);
        for (let i = 0; i < sign.activeNodes; i += 1) {
            const idx = sign.nodeOffset + i;
            const x = f.nodes[i][0];
            const y = f.nodes[i][1];
            this.nodePos[idx * 3] = cx + (x * cosR - y * sinR) * scale;
            this.nodePos[idx * 3 + 1] = cy + (x * sinR + y * cosR) * scale;
            this.nodePos[idx * 3 + 2] = cz;
        }

        sign.activeEdges = 0;
        for (let e = 0; e < f.edges.length && sign.activeEdges < MAX_EDGES_PER_SIGN; e += 1) {
            const a = f.edges[e][0];
            const b = f.edges[e][1];
            if (a >= sign.activeNodes || b >= sign.activeNodes) continue;

            const edgeIdx = sign.edgeOffset + sign.activeEdges;
            const nodeA = sign.nodeOffset + a;
            const nodeB = sign.nodeOffset + b;
            this.edgeA[edgeIdx * 3] = this.nodePos[nodeA * 3];
            this.edgeA[edgeIdx * 3 + 1] = this.nodePos[nodeA * 3 + 1];
            this.edgeA[edgeIdx * 3 + 2] = this.nodePos[nodeA * 3 + 2];
            this.edgeB[edgeIdx * 3] = this.nodePos[nodeB * 3];
            this.edgeB[edgeIdx * 3 + 1] = this.nodePos[nodeB * 3 + 1];
            this.edgeB[edgeIdx * 3 + 2] = this.nodePos[nodeB * 3 + 2];
            sign.activeEdges += 1;
        }

        sign.state = 'drawing';
        sign.t = 0;
        sign.birth = this._birthSeq;
        this._birthSeq += 1;
        sign.fig = fig;
        this._syncState();
        return fig;
    }

    triggerMany(count, name = 'zodiac') {
        const total = Math.max(0, Math.min(MAX_SIGNS, Math.floor(count)));
        const placed = [];
        for (let i = 0; i < total; i += 1) {
            const fig = this.trigger(name);
            if (!fig) break;
            placed.push(fig);
        }
        return placed;
    }

    update(dt) {
        if (this.ambient) {
            this._nextAmbient -= dt;
            if (this._nextAmbient <= 0) {
                this._nextAmbient = 20 + Math.random() * 24;
                if (this.activeNodes < MAX_NODES_PER_SIGN * 2) this.trigger();
            }
        }

        for (const sign of this._signs) {
            if (sign.state === 'idle') continue;
            this._updateSign(sign, dt);
        }
        this._syncState();
    }

    _updateSign(sign, dt) {
        sign.t += dt;
        this.t = Math.max(this.t, sign.t);
        if (sign.state === 'drawing') {
            this._updateDrawing(sign);
            if (sign.t >= this.drawDur) {
                this._fillFull(sign);
                sign.state = 'hold';
                sign.t = 0;
            }
        } else if (sign.state === 'hold') {
            const breath = 0.82 + 0.18 * Math.sin(sign.t * 1.4 + sign.slot * 0.7);
            for (let i = 0; i < sign.activeNodes; i += 1) {
                this.nodeAlpha[sign.nodeOffset + i] = breath;
            }
            for (let e = 0; e < sign.activeEdges; e += 1) {
                this.edgeAlpha[sign.edgeOffset + e] = breath;
            }
            if (sign.t >= this.holdDur) {
                sign.state = 'fading';
                sign.t = 0;
            }
        } else if (sign.state === 'fading') {
            const a = Math.max(0, 1 - sign.t / this.fadeDur);
            for (let i = 0; i < sign.activeNodes; i += 1) {
                this.nodeAlpha[sign.nodeOffset + i] = a;
            }
            for (let e = 0; e < sign.activeEdges; e += 1) {
                this.edgeAlpha[sign.edgeOffset + e] = a;
            }
            if (sign.t >= this.fadeDur) this._retireSlot(sign);
        }
    }

    _updateDrawing(sign) {
        // Nodes pop in a staggered cascade; lines grow staggered after.
        const nodeCascade = 0.55;
        for (let i = 0; i < sign.activeNodes; i += 1) {
            const idx = sign.nodeOffset + i;
            const start = (i / Math.max(1, sign.activeNodes)) * nodeCascade;
            const local = smoothstep01((sign.t - start) / 0.3);
            this.nodeScale[idx] = local;
            this.nodeAlpha[idx] = local;
        }
        const edgeBase = 0.4;
        const edgeSpan = Math.max(0.3, this.drawDur - edgeBase - 0.3);
        for (let e = 0; e < sign.activeEdges; e += 1) {
            const idx = sign.edgeOffset + e;
            const start = edgeBase + (e / Math.max(1, sign.activeEdges)) * edgeSpan;
            const local = smoothstep01((sign.t - start) / 0.45);
            this.edgeProgress[idx] = local;
            this.edgeAlpha[idx] = local;
        }
    }

    _fillFull(sign) {
        for (let i = 0; i < sign.activeNodes; i += 1) {
            const idx = sign.nodeOffset + i;
            this.nodeScale[idx] = 1;
            this.nodeAlpha[idx] = 1;
        }
        for (let e = 0; e < sign.activeEdges; e += 1) {
            const idx = sign.edgeOffset + e;
            this.edgeProgress[idx] = 1;
            this.edgeAlpha[idx] = 1;
        }
    }

    dispose() {
        this.nodePos = null;
        this.nodeScale = null;
        this.nodeAlpha = null;
        this.edgeA = null;
        this.edgeB = null;
        this.edgeProgress = null;
        this.edgeAlpha = null;
        this._signs = null;
    }
}
