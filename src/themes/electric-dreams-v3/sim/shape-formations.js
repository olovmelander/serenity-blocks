/**
 * Electric Dreams V3 — Shape Formations
 *
 * Pure functions that fill a Float32Array with target positions for N particles.
 * Each particle has a "target" the fluid sim's attraction force pulls it toward.
 * Switching shapes = rewriting these targets; particles morph in via spring physics.
 *
 * Storage layout per particle (vec4):
 *   xyz  = target position (world units)
 *   w    = per-particle attraction multiplier (1 = full pull, 0 = ignore target)
 *          Most shapes use 1; some (e.g., 'release') use 0 to free particles.
 *
 * Design constraints:
 *   - Fill operations are O(n) with NO allocations — `arr` is reused across calls
 *   - Distributions use golden-angle / Fibonacci-style indexing for even coverage
 *     (avoids visible "stripes" from naive uniform sampling)
 *   - Shapes are centered on origin by default; orchestrator offsets as needed
 *
 * Adding new shapes:
 *   1. Write a `fillX(arr, n, opts)` function (same signature)
 *   2. Register in SHAPE_GENERATORS at the bottom
 *   3. Document expected `opts` keys (radius, scale, etc.)
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 — for spiral distribution
const GOLDEN_RATIO_F = 0.6180339887498949;

// ──────────────────────────────────────────────────────────────────────────
// Sphere — particles spread evenly over a sphere surface via Fibonacci spiral.
// Reads as the "default fluid" formation. Looks like a star/planet.
// opts: { radius=7 }
// Sized to fill ~70% of the visible vertical range at the focal plane.
// ──────────────────────────────────────────────────────────────────────────
function fillSphere(arr, n, opts = {}) {
    const r = opts.radius ?? 7.0;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        // Fibonacci sphere distribution — even coverage, no clumping at poles.
        const y = 1 - (i / Math.max(1, n - 1)) * 2; // -1 to 1
        const rad = Math.sqrt(1 - y * y);
        const theta = GOLDEN_ANGLE * i;
        arr[i4] = r * Math.cos(theta) * rad;
        arr[i4 + 1] = r * y;
        arr[i4 + 2] = r * Math.sin(theta) * rad;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Torus — donut, ORIENTED FACING CAMERA (ring lies in XY plane).
// Particles densely cover the tube surface; Z = tube thickness (depth).
// opts: { majorRadius=7.5, minorRadius=2.0, windings=22 }
// ──────────────────────────────────────────────────────────────────────────
function fillTorus(arr, n, opts = {}) {
    const R = opts.majorRadius ?? 7.5;
    const r = opts.minorRadius ?? 2.0;
    const windings = opts.windings ?? 22;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = i / n;
        const u = t * Math.PI * 2 * windings; // around tube cross-section
        const v = (((i * GOLDEN_RATIO_F) % 1) * Math.PI) * 2; // around main ring
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);
        const cosV = Math.cos(v);
        const sinV = Math.sin(v);
        // Ring spans XY (faces camera); Z = tube thickness pushing toward/away.
        arr[i4] = (R + r * cosV) * cosU;
        arr[i4 + 1] = (R + r * cosV) * sinU;
        arr[i4 + 2] = r * sinV;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Helix — vertical double helix (DNA-like).
// opts: { radius=4.5, height=11, turns=5, strands=2 }
// ──────────────────────────────────────────────────────────────────────────
function fillHelix(arr, n, opts = {}) {
    const r = opts.radius ?? 4.5;
    const height = opts.height ?? 11;
    const turns = opts.turns ?? 5;
    const strands = opts.strands ?? 2;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const strand = i % strands;
        const t = Math.floor(i / strands) / Math.max(1, Math.floor(n / strands));
        const angle = t * turns * Math.PI * 2 + (strand / strands) * Math.PI * 2;
        arr[i4] = r * Math.cos(angle);
        arr[i4 + 1] = (t - 0.5) * height;
        arr[i4 + 2] = r * Math.sin(angle);
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Galaxy — multi-arm spiral, ORIENTED FACING CAMERA (disc lies in XY plane).
// Denser at center via sqrt distribution.
// opts: { arms=4, maxRadius=11, armTightness=0.5, thickness=1.0 }
// ──────────────────────────────────────────────────────────────────────────
function fillGalaxy(arr, n, opts = {}) {
    const arms = opts.arms ?? 4;
    const maxR = opts.maxRadius ?? 11;
    const tight = opts.armTightness ?? 0.5;
    const thickness = opts.thickness ?? 1.0;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = Math.sqrt(i / n); // sqrt → denser center (visually more "galaxy-like")
        const arm = i % arms;
        const armAngle = (arm / arms) * Math.PI * 2;
        const angle = armAngle + t * Math.PI * 4 * tight;
        const rad = t * maxR;
        // Scatter within the arm (jitter for arm thickness in-plane)
        const jitter = (((i * 13.7) % 1) - 0.5) * thickness;
        const jitter2 = (((i * 7.31) % 1) - 0.5) * thickness;
        // Disc spans XY (faces camera); Z = small disc-thickness (depth).
        arr[i4] = rad * Math.cos(angle) + jitter * Math.sin(angle);
        arr[i4 + 1] = rad * Math.sin(angle) + jitter2 * Math.cos(angle);
        arr[i4 + 2] = (((i * 1.61803) % 1) - 0.5) * 0.6; // disc depth/thickness
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Heart — parametric heart curve, with depth extrusion.
// opts: { scale=0.55, depth=1.6 }
// (parametric heart has ~32u native size; 0.55 → ~18u displayed)
// ──────────────────────────────────────────────────────────────────────────
function fillHeart(arr, n, opts = {}) {
    const scale = opts.scale ?? 0.55;
    const depth = opts.depth ?? 1.6;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = (i / n) * Math.PI * 2;
        const sinT = Math.sin(t);
        const x = 16 * sinT * sinT * sinT;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        // Z thickness via golden-angle indexing
        const z = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * depth;
        // Radial scatter for fullness (not just outline)
        const rscale = 0.6 + 0.4 * ((i * 0.31) % 1);
        arr[i4] = x * scale * rscale;
        arr[i4 + 1] = y * scale * rscale;
        arr[i4 + 2] = z;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Cube — uniformly distributed on 6 faces, ROTATED FOR ISOMETRIC VIEW.
// Camera looks down -Z; an axis-aligned cube only shows its +Z face.
// We bake a 45° Y rotation + ~35° X rotation into positions so the classic
// 3-faces-visible isometric silhouette emerges.
// opts: { size=7, isoYaw=PI/4, isoPitch=atan(1/sqrt(2)) }
// ──────────────────────────────────────────────────────────────────────────
function fillCube(arr, n, opts = {}) {
    const s = (opts.size ?? 7) * 0.5;
    // True isometric: pitch = arctan(1/√2) ≈ 35.264°, yaw = 45°.
    const yaw = opts.isoYaw ?? Math.PI / 4;
    const pitch = opts.isoPitch ?? Math.atan(1 / Math.sqrt(2));
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    let lx; let ly; let lz; // local cube-space before rotation
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const face = i % 6;
        const u = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * 2 * s;
        const v = (((i * 0.31415926) % 1) - 0.5) * 2 * s;
        switch (face) {
        case 0: lx = s; ly = u; lz = v; break; // +X face
        case 1: lx = -s; ly = u; lz = v; break; // -X face
        case 2: lx = u; ly = s; lz = v; break; // +Y face (top)
        case 3: lx = u; ly = -s; lz = v; break; // -Y face (bottom)
        case 4: lx = u; ly = v; lz = s; break; // +Z face (toward camera)
        default: lx = u; ly = v; lz = -s; break; // -Z face (away)
        }
        // Yaw around Y axis (rotates X & Z)
        const ax = cy * lx + sy * lz;
        const az = -sy * lx + cy * lz;
        // Pitch around X axis (rotates Y & Z)
        const by = cp * ly - sp * az;
        const bz = sp * ly + cp * az;
        arr[i4] = ax;
        arr[i4 + 1] = by;
        arr[i4 + 2] = bz;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Star (5-pointed, 2D) — particles distribute along star outline + interior.
// opts: { outerRadius=8, innerRadius=3.2, points=5, depth=1.2 }
// ──────────────────────────────────────────────────────────────────────────
function fillStar(arr, n, opts = {}) {
    const R = opts.outerRadius ?? 8;
    const ri = opts.innerRadius ?? 3.2;
    const points = opts.points ?? 5;
    const depth = opts.depth ?? 1.2;
    const segments = points * 2; // alternating outer/inner vertices
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        // Build a parametric star: t in [0,1] traces around the boundary.
        const t = (i / n) * segments;
        const segIdx = Math.floor(t);
        const segT = t - segIdx;
        const angleStart = (segIdx / segments) * Math.PI * 2 - Math.PI * 0.5;
        const angleEnd = ((segIdx + 1) / segments) * Math.PI * 2 - Math.PI * 0.5;
        const radStart = segIdx % 2 === 0 ? R : ri;
        const radEnd = segIdx % 2 === 0 ? ri : R;
        const angle = angleStart + segT * (angleEnd - angleStart);
        const rad = radStart + segT * (radEnd - radStart);
        // Radial fullness — some particles toward center, not just outline
        const fill = 0.4 + 0.6 * (((i * 0.31) % 1));
        arr[i4] = rad * fill * Math.cos(angle);
        arr[i4 + 1] = rad * fill * Math.sin(angle);
        arr[i4 + 2] = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Wave — vertical sheet ORIENTED FACING CAMERA (XY plane), with sinusoidal
// Z displacement so peaks pop OUT toward the camera and troughs recede.
// opts: { width=22, height=12, amplitude=2.2, frequency=0.45 }
// ──────────────────────────────────────────────────────────────────────────
function fillWave(arr, n, opts = {}) {
    const w = opts.width ?? 22;
    const h = opts.height ?? 12;
    const amp = opts.amplitude ?? 2.2;
    const freq = opts.frequency ?? 0.45;
    // Grid layout: sqrt(n) × sqrt(n)
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const gx = i % side;
        const gy = Math.floor(i / side);
        const x = (gx / Math.max(1, side - 1) - 0.5) * w;
        const y = (gy / Math.max(1, side - 1) - 0.5) * h;
        // Wave displacement in Z so peaks come TOWARD camera (positive Z).
        const z = Math.sin(x * freq) * Math.cos(y * freq) * amp;
        arr[i4] = x;
        arr[i4 + 1] = y;
        arr[i4 + 2] = z;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Butterfly — Lissajous-style figure-8 with depth.
// opts: { scale=6, depth=1.4 }
// (Inspired by the happy-accident X-shape from the user's screenshot.)
// ──────────────────────────────────────────────────────────────────────────
function fillButterfly(arr, n, opts = {}) {
    const scale = opts.scale ?? 6.0;
    const depth = opts.depth ?? 1.4;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = (i / n) * Math.PI * 2;
        // Butterfly curve (Fay, 1989) — classic parametric beauty
        const factor = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.sin(t / 12) ** 5;
        const x = Math.sin(t) * factor;
        const y = Math.cos(t) * factor;
        // Radial fullness
        const fill = 0.5 + 0.5 * (((i * 0.71) % 1));
        arr[i4] = x * scale * 0.18 * fill;
        arr[i4 + 1] = y * scale * 0.18 * fill;
        arr[i4 + 2] = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Ring — flat circular ring (annulus), ORIENTED FACING CAMERA (XY plane).
// Cleaner version of torus for some events.
// opts: { radius=7.5, thickness=1.2, depth=0.6 }
// ──────────────────────────────────────────────────────────────────────────
function fillRing(arr, n, opts = {}) {
    const R = opts.radius ?? 7.5;
    const thick = opts.thickness ?? 1.2;
    const depth = opts.depth ?? 0.6;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const angle = (i / n) * Math.PI * 2;
        const r = R + ((((i * GOLDEN_RATIO_F) % 1) - 0.5) * 2) * thick;
        // Ring in XY (faces camera); Z = small depth jitter.
        arr[i4] = r * Math.cos(angle);
        arr[i4 + 1] = r * Math.sin(angle);
        arr[i4 + 2] = (((i * 0.31) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Tetromino "+" cross — square boss formation (game-themed).
// opts: { armLength=5.5, thickness=1.6 }
// ──────────────────────────────────────────────────────────────────────────
function fillTetromino(arr, n, opts = {}) {
    const L = opts.armLength ?? 5.5;
    const th = opts.thickness ?? 1.6;
    // Plus-sign made of 5 unit squares
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const segment = i % 5;
        const u = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * 2;
        const v = (((i * 0.31415) % 1) - 0.5) * 2;
        // Each segment is a square of side `th`, positioned at one of 5 spots
        let cx = 0; let cy = 0;
        switch (segment) {
        case 0: cx = 0; cy = 0; break; // center
        case 1: cx = L; cy = 0; break; // right arm
        case 2: cx = -L; cy = 0; break; // left arm
        case 3: cx = 0; cy = L; break; // top arm
        default: cx = 0; cy = -L; break; // bottom arm
        }
        arr[i4] = cx + u * th;
        arr[i4 + 1] = cy + v * th;
        arr[i4 + 2] = (((i * 0.71) % 1) - 0.5) * th * 0.8;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TetrominoSet - all 7 unique tetrominoes spread across the screen.
// opts: { cellSize=1.15, cellFill=0.9, depth=0.8 }
// ──────────────────────────────────────────────────────────────────────────
const TETROMINO_SET_PIECES = Object.freeze([
    Object.freeze([-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0]), // I
    Object.freeze([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), // O
    Object.freeze([-1, -0.5, 0, -0.5, 1, -0.5, 0, 0.5]), // T
    Object.freeze([-0.5, -0.5, 0.5, -0.5, -1, 0.5, 0, 0.5]), // S
    Object.freeze([-1, -0.5, 0, -0.5, 0, 0.5, 1, 0.5]), // Z
    Object.freeze([-1, -0.5, 0, -0.5, 1, -0.5, -1, 0.5]), // J
    Object.freeze([-1, -0.5, 0, -0.5, 1, -0.5, 1, 0.5]), // L
]);

const TETROMINO_SET_LAYOUT = Object.freeze([
    -9.6, 4.2,
    -3.2, 4.2,
    3.2, 4.2,
    9.6, 4.2,
    -6.4, -4.2,
    0, -4.2,
    6.4, -4.2,
]);

function fillTetrominoSet(arr, n, opts = {}) {
    const cellSize = opts.cellSize ?? 1.15;
    const cellFill = opts.cellFill ?? 0.9;
    const depth = opts.depth ?? 0.8;
    const pieceCount = TETROMINO_SET_PIECES.length;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const pieceIndex = i % pieceCount;
        const piece = TETROMINO_SET_PIECES[pieceIndex];
        const cellIndex = (Math.floor(i / pieceCount) + pieceIndex) % 4;
        const cellOffset = cellIndex * 2;
        const cx = TETROMINO_SET_LAYOUT[pieceIndex * 2];
        const cy = TETROMINO_SET_LAYOUT[pieceIndex * 2 + 1];
        const u = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * cellSize * cellFill;
        const v = (((i * 0.31415) % 1) - 0.5) * cellSize * cellFill;
        arr[i4] = cx + piece[cellOffset] * cellSize + u;
        arr[i4 + 1] = cy + piece[cellOffset + 1] * cellSize + v;
        arr[i4 + 2] = (pieceIndex - 3) * 0.08 + (((i * 0.71) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Pyramid (tetrahedron) — 4 triangular faces.
// Particles distributed across face surfaces via barycentric coords.
// opts: { size=7 }
// ──────────────────────────────────────────────────────────────────────────
function fillPyramid(arr, n, opts = {}) {
    const s = opts.size ?? 7;
    // Regular tetrahedron vertices centered at origin (apex up).
    const h = s * 0.816; // 2/sqrt(6) * s — exact tetrahedron height
    const apex = [0, h * 0.75, 0];
    const v1 = [-s * 0.577, -h * 0.25, s * 0.5];
    const v2 = [s * 0.577, -h * 0.25, s * 0.5];
    const v3 = [0, -h * 0.25, -s * 0.866];
    const faces = [[apex, v1, v2], [apex, v1, v3], [apex, v2, v3], [v1, v2, v3]];
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const face = faces[i % 4];
        // Barycentric (a, b, c) with a+b+c=1 — uniform random on triangle.
        let a = (i * GOLDEN_RATIO_F) % 1;
        let b = (i * 0.31415) % 1;
        if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const c = 1 - a - b;
        arr[i4] = face[0][0] * a + face[1][0] * b + face[2][0] * c;
        arr[i4 + 1] = face[0][1] * a + face[1][1] * b + face[2][1] * c;
        arr[i4 + 2] = face[0][2] * a + face[1][2] * b + face[2][2] * c;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Octahedron — 8 triangular faces (diamond shape, point up & down).
// opts: { size=7 }
// ──────────────────────────────────────────────────────────────────────────
function fillOctahedron(arr, n, opts = {}) {
    const s = opts.size ?? 7;
    // 6 vertices at axis tips
    const top = [0, s, 0];
    const bot = [0, -s, 0];
    const px = [s, 0, 0];
    const nx = [-s, 0, 0];
    const pz = [0, 0, s];
    const nz = [0, 0, -s];
    // 8 faces — top half (4 with apex=top), bottom half (4 with apex=bot)
    const faces = [
        [top, px, pz], [top, pz, nx], [top, nx, nz], [top, nz, px],
        [bot, px, pz], [bot, pz, nx], [bot, nx, nz], [bot, nz, px],
    ];
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const face = faces[i % 8];
        let a = (i * GOLDEN_RATIO_F) % 1;
        let b = (i * 0.31415) % 1;
        if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const c = 1 - a - b;
        arr[i4] = face[0][0] * a + face[1][0] * b + face[2][0] * c;
        arr[i4 + 1] = face[0][1] * a + face[1][1] * b + face[2][1] * c;
        arr[i4 + 2] = face[0][2] * a + face[1][2] * b + face[2][2] * c;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Hexagon — flat 6-sided polygon in XY plane (faces camera).
// opts: { radius=7, depth=0.5 }
// ──────────────────────────────────────────────────────────────────────────
function fillHexagon(arr, n, opts = {}) {
    const R = opts.radius ?? 7;
    const depth = opts.depth ?? 0.5;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        // 6 edges, each parametrized linearly between adjacent vertices.
        const tFull = (i / n) * 6;
        const edge = Math.floor(tFull);
        const tEdge = tFull - edge;
        const a0 = (edge / 6) * Math.PI * 2;
        const a1 = ((edge + 1) / 6) * Math.PI * 2;
        const angle = a0 + tEdge * (a1 - a0);
        // Radial fullness (some particles toward center, not just outline)
        const fill = 0.3 + 0.7 * ((i * 0.31) % 1);
        const r = R * fill;
        arr[i4] = r * Math.cos(angle);
        arr[i4 + 1] = r * Math.sin(angle);
        arr[i4 + 2] = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Sunflower — Fibonacci seed pattern (the famous golden-angle spiral).
// Particles spiral out from center using the angle that nature uses for
// optimal seed packing — very organic, immediately recognizable.
// opts: { radius=10, depth=0.5 }
// ──────────────────────────────────────────────────────────────────────────
function fillSunflower(arr, n, opts = {}) {
    const R = opts.radius ?? 10;
    const depth = opts.depth ?? 0.5;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = i / n;
        const angle = i * GOLDEN_ANGLE;
        const radius = Math.sqrt(t) * R; // sqrt → uniform area density
        arr[i4] = radius * Math.cos(angle);
        arr[i4 + 1] = radius * Math.sin(angle);
        arr[i4 + 2] = (((i * 0.31) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Infinity (lemniscate of Bernoulli) — ∞ shape facing camera.
// opts: { scale=7, depth=1.0 }
// ──────────────────────────────────────────────────────────────────────────
function fillInfinity(arr, n, opts = {}) {
    const a = opts.scale ?? 7;
    const depth = opts.depth ?? 1.0;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = (i / n) * Math.PI * 2;
        const sint = Math.sin(t);
        const cost = Math.cos(t);
        const denom = 1 + sint * sint;
        // Radial fullness so it's a thick figure-8, not a thin line
        const fill = 0.55 + 0.45 * ((i * 0.31) % 1);
        arr[i4] = ((a * cost) / denom) * fill;
        arr[i4 + 1] = ((a * sint * cost) / denom) * fill;
        arr[i4 + 2] = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Trefoil knot — 3D knot (the simplest non-trivial knot in topology).
// Particles wrap a tube around the parametric knot curve.
// opts: { scale=2.8, tubeRadius=0.7 }
// ──────────────────────────────────────────────────────────────────────────
function fillTrefoil(arr, n, opts = {}) {
    const scale = opts.scale ?? 2.8;
    const tubeR = opts.tubeRadius ?? 0.7;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        // Spread along curve param + tube offset
        const t = (i / n) * Math.PI * 2;
        const cx = (2 + Math.cos(3 * t)) * Math.cos(2 * t);
        const cy = (2 + Math.cos(3 * t)) * Math.sin(2 * t);
        const cz = Math.sin(3 * t);
        // Tube cross-section — random radial scatter
        const phi = ((i * GOLDEN_RATIO_F) % 1) * Math.PI * 2;
        const tubeMag = tubeR * (0.5 + ((i * 0.31) % 1) * 0.5);
        arr[i4] = cx * scale + tubeMag * Math.cos(phi);
        arr[i4 + 1] = cy * scale + tubeMag * Math.sin(phi) * 0.6;
        arr[i4 + 2] = cz * scale + tubeMag * Math.sin(phi) * 0.4;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Vortex — tornado/funnel. Wide at top, narrowing toward bottom.
// Vertical axis (Y); spiral winds many times around.
// opts: { topRadius=7, bottomRadius=0.8, height=11, turns=7 }
// ──────────────────────────────────────────────────────────────────────────
function fillVortex(arr, n, opts = {}) {
    const topR = opts.topRadius ?? 7;
    const botR = opts.bottomRadius ?? 0.8;
    const h = opts.height ?? 11;
    const turns = opts.turns ?? 7;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = i / n;
        const angle = t * turns * Math.PI * 2;
        // Radius interpolates from top → bottom
        const radius = topR + (botR - topR) * t;
        const y = (0.5 - t) * h;
        // Radial scatter so it's a thick funnel, not a thin line
        const scatter = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * radius * 0.25;
        arr[i4] = (radius + scatter) * Math.cos(angle);
        arr[i4 + 1] = y;
        arr[i4 + 2] = (radius + scatter) * Math.sin(angle);
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WavySphere — sphere with sinusoidal radial perturbation (spherical harmonic).
// Reads like a quivering crystal or a deep-sea anemone.
// opts: { radius=7, waves=6, amplitude=0.35 }
// ──────────────────────────────────────────────────────────────────────────
function fillWavySphere(arr, n, opts = {}) {
    const r = opts.radius ?? 7;
    const waves = opts.waves ?? 6;
    const amp = opts.amplitude ?? 0.35;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const y = 1 - (i / Math.max(1, n - 1)) * 2;
        const radCircle = Math.sqrt(1 - y * y);
        const theta = GOLDEN_ANGLE * i;
        const phi = Math.acos(y);
        // Spherical harmonic: ripples along longitude + latitude
        const wave = Math.sin(theta * waves) * Math.cos(phi * waves * 0.5) * amp;
        const radius = r * (1 + wave);
        arr[i4] = radius * Math.cos(theta) * radCircle;
        arr[i4 + 1] = radius * y;
        arr[i4 + 2] = radius * Math.sin(theta) * radCircle;
        arr[i4 + 3] = 1;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Lightning - jagged ribbon bolt in the XY plane with a little depth.
// opts: { scale=1.35, thickness=0.75, depth=0.8 }
function fillLightning(arr, n, opts = {}) {
    const scale = opts.scale ?? 1.35;
    const thickness = opts.thickness ?? 0.75;
    const depth = opts.depth ?? 0.8;
    const segments = 5;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const p = (i / n) * segments;
        const segment = Math.min(segments - 1, Math.floor(p));
        const t = p - segment;
        let x0; let y0; let x1; let y1;
        switch (segment) {
        case 0:
            x0 = -1.5; y0 = 5.8; x1 = 2.0; y1 = 1.1;
            break;
        case 1:
            x0 = 2.0; y0 = 1.1; x1 = 0.15; y1 = 1.0;
            break;
        case 2:
            x0 = 0.15; y0 = 1.0; x1 = 1.55; y1 = -5.8;
            break;
        case 3:
            x0 = 1.55; y0 = -5.8; x1 = -2.25; y1 = -0.55;
            break;
        default:
            x0 = -2.25; y0 = -0.55; x1 = -0.35; y1 = -0.55;
            break;
        }
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
        const edgeTaper = 0.45 + 0.55 * Math.sin(Math.PI * t);
        const offset = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * thickness * edgeTaper;
        arr[i4] = (x0 + dx * t + (-dy / len) * offset) * scale;
        arr[i4 + 1] = (y0 + dy * t + (dx / len) * offset) * scale;
        arr[i4 + 2] = (((i * 0.31) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// Snowflake - six radial arms with angled branchlets.
// opts: { radius=8.5, branchRadius=4.6, branchLength=2.8, thickness=0.45, depth=0.7 }
function fillSnowflake(arr, n, opts = {}) {
    const radius = opts.radius ?? 8.5;
    const branchRadius = opts.branchRadius ?? 4.6;
    const branchLength = opts.branchLength ?? 2.8;
    const thickness = opts.thickness ?? 0.45;
    const depth = opts.depth ?? 0.7;
    const arms = 6;
    const features = arms * 3;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const feature = i % features;
        const arm = Math.floor(feature / 3);
        const branch = feature % 3;
        const armAngle = (arm / arms) * Math.PI * 2;
        const localT = (i * GOLDEN_RATIO_F) % 1;
        const side = branch === 2 ? -1 : 1;
        let x; let y; let angle; let length;
        if (branch === 0) {
            angle = armAngle;
            length = radius * (0.08 + localT * 0.92);
            x = Math.cos(angle) * length;
            y = Math.sin(angle) * length;
        } else {
            const baseX = Math.cos(armAngle) * branchRadius;
            const baseY = Math.sin(armAngle) * branchRadius;
            angle = armAngle + side * Math.PI * 0.28;
            length = branchLength * localT;
            x = baseX + Math.cos(angle) * length;
            y = baseY + Math.sin(angle) * length;
        }
        const normal = angle + Math.PI * 0.5;
        const offset = (((i * 0.31) % 1) - 0.5) * thickness;
        arr[i4] = x + Math.cos(normal) * offset;
        arr[i4 + 1] = y + Math.sin(normal) * offset;
        arr[i4 + 2] = (((i * 0.71) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// Lotus - layered polar rose petals, filled toward the center.
// opts: { radius=9, petals=8, depth=0.8 }
function fillLotus(arr, n, opts = {}) {
    const radius = opts.radius ?? 9;
    const petals = opts.petals ?? 8;
    const depth = opts.depth ?? 0.8;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const theta = ((i * GOLDEN_RATIO_F) % 1) * Math.PI * 2;
        const petal = Math.abs(Math.sin(theta * petals * 0.5));
        const petalLimit = radius * (0.22 + 0.78 * petal ** 0.72);
        const fill = Math.sqrt((i * 0.31) % 1);
        const r = petalLimit * fill;
        arr[i4] = r * Math.cos(theta);
        arr[i4 + 1] = r * Math.sin(theta) * 0.86;
        arr[i4 + 2] = (0.5 - fill) * depth + (((i * 0.71) % 1) - 0.5) * depth * 0.35;
        arr[i4 + 3] = 1;
    }
}

// Crescent - tapered sickle arc facing the camera.
// opts: { radius=7.1, thickness=2.6, depth=0.8 }
function fillCrescent(arr, n, opts = {}) {
    const radius = opts.radius ?? 7.1;
    const thickness = opts.thickness ?? 2.6;
    const depth = opts.depth ?? 0.8;
    const arc = opts.arc ?? 2.65;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = i / n;
        const theta = (t - 0.5) * arc;
        const centerX = Math.cos(theta) * radius - radius * 0.55;
        const centerY = Math.sin(theta) * radius;
        const taper = 0.16 + 0.84 * Math.sin(Math.PI * t);
        const offset = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * thickness * taper;
        arr[i4] = centerX + Math.cos(theta) * offset;
        arr[i4 + 1] = centerY + Math.sin(theta) * offset;
        arr[i4 + 2] = (((i * 0.31) % 1) - 0.5) * depth;
        arr[i4 + 3] = 1;
    }
}

// Crystal shard - elongated faceted double pyramid with a slight skew.
// opts: { height=12, radius=3.8, sides=6 }
function fillCrystalShard(arr, n, opts = {}) {
    const height = opts.height ?? 12;
    const radius = opts.radius ?? 3.8;
    const sides = opts.sides ?? 6;
    const faceCount = sides * 2;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const face = i % faceCount;
        const topHalf = face < sides;
        const side = face % sides;
        const angle0 = (side / sides) * Math.PI * 2 + (topHalf ? 0.12 : -0.12);
        const angle1 = ((side + 1) / sides) * Math.PI * 2 + (topHalf ? 0.12 : -0.12);
        let a = (i * GOLDEN_RATIO_F) % 1;
        let b = (i * 0.31415) % 1;
        if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const c = 1 - a - b;
        const apexY = topHalf ? height * 0.55 : -height * 0.55;
        const apexX = topHalf ? 0.55 : -0.45;
        const apexZ = topHalf ? 0.35 : -0.25;
        const r0 = radius * (0.9 + 0.1 * Math.sin(side));
        const r1 = radius * (0.9 + 0.1 * Math.cos(side));
        const x0 = Math.cos(angle0) * r0;
        const z0 = Math.sin(angle0) * r0;
        const x1 = Math.cos(angle1) * r1;
        const z1 = Math.sin(angle1) * r1;
        arr[i4] = apexX * a + x0 * b + x1 * c;
        arr[i4 + 1] = apexY * a;
        arr[i4 + 2] = apexZ * a + z0 * b + z1 * c;
        arr[i4 + 3] = 1;
    }
}

// Mobius - a single twisted ribbon loop.
// opts: { radius=5.8, width=2.2 }
function fillMobius(arr, n, opts = {}) {
    const radius = opts.radius ?? 5.8;
    const width = opts.width ?? 2.2;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const u = (i / n) * Math.PI * 2;
        const v = (((i * GOLDEN_RATIO_F) % 1) - 0.5) * 2 * width;
        const half = u * 0.5;
        const band = radius + v * Math.cos(half);
        arr[i4] = band * Math.cos(u);
        arr[i4 + 1] = band * Math.sin(u) * 0.72;
        arr[i4 + 2] = v * Math.sin(half);
        arr[i4 + 3] = 1;
    }
}

// Comet - glowing head with a tapered trailing plume.
// opts: { headRadius=2.6, tailLength=13, tailWidth=3.2 }
function fillComet(arr, n, opts = {}) {
    const headRadius = opts.headRadius ?? 2.6;
    const tailLength = opts.tailLength ?? 13;
    const tailWidth = opts.tailWidth ?? 3.2;
    const headCount = Math.max(1, Math.floor(n * 0.36));
    const tailCount = Math.max(1, n - headCount);
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        if (i < headCount) {
            const y = 1 - (i / Math.max(1, headCount - 1)) * 2;
            const rad = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = GOLDEN_ANGLE * i;
            arr[i4] = 4.2 + headRadius * Math.cos(theta) * rad;
            arr[i4 + 1] = headRadius * y;
            arr[i4 + 2] = headRadius * Math.sin(theta) * rad;
        } else {
            const tailI = i - headCount;
            const t = tailI / Math.max(1, tailCount - 1);
            const angle = tailI * GOLDEN_ANGLE;
            const taper = (1 - t) ** 1.55;
            const plumeR = tailWidth * taper * Math.sqrt((tailI * 0.31) % 1);
            arr[i4] = 3.6 - tailLength * t;
            arr[i4 + 1] = Math.sin(angle) * plumeR;
            arr[i4 + 2] = Math.cos(angle) * plumeR * 0.65;
        }
        arr[i4 + 3] = 1;
    }
}

// Nautilus - logarithmic spiral shell with a growing rounded tube.
// opts: { maxRadius=8.8, turns=3.7, tubeRadius=1.25 }
function fillNautilus(arr, n, opts = {}) {
    const maxRadius = opts.maxRadius ?? 8.8;
    const turns = opts.turns ?? 3.7;
    const tubeRadius = opts.tubeRadius ?? 1.25;
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        const t = i / n;
        const angle = t * turns * Math.PI * 2;
        const radius = maxRadius * (0.08 + 0.92 * t ** 1.35);
        const tubeAngle = ((i * GOLDEN_RATIO_F) % 1) * Math.PI * 2;
        const tube = tubeRadius * (0.22 + 0.78 * t);
        const radialOffset = Math.cos(tubeAngle) * tube;
        const r = radius + radialOffset;
        arr[i4] = r * Math.cos(angle);
        arr[i4 + 1] = r * Math.sin(angle) * 0.78;
        arr[i4 + 2] = Math.sin(tubeAngle) * tube;
        arr[i4 + 3] = 1;
    }
}

// Free — zero attraction. Particles ignore targets and behave as free fluid.
// Useful as a "release" state when returning from a formation.
// ──────────────────────────────────────────────────────────────────────────
function fillFree(arr, n) {
    for (let i = 0; i < n; i += 1) {
        const i4 = i * 4;
        arr[i4] = 0;
        arr[i4 + 1] = 0;
        arr[i4 + 2] = 0;
        arr[i4 + 3] = 0; // attraction multiplier = 0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────
export const SHAPE_GENERATORS = Object.freeze({
    sphere: fillSphere,
    torus: fillTorus,
    helix: fillHelix,
    galaxy: fillGalaxy,
    heart: fillHeart,
    cube: fillCube,
    star: fillStar,
    wave: fillWave,
    butterfly: fillButterfly,
    ring: fillRing,
    tetromino: fillTetromino,
    tetrominoSet: fillTetrominoSet,
    // New in this batch — geometric + organic + math curves.
    pyramid: fillPyramid,
    octahedron: fillOctahedron,
    hexagon: fillHexagon,
    sunflower: fillSunflower,
    infinity: fillInfinity,
    trefoil: fillTrefoil,
    vortex: fillVortex,
    wavySphere: fillWavySphere,
    lightning: fillLightning,
    snowflake: fillSnowflake,
    lotus: fillLotus,
    crescent: fillCrescent,
    crystalShard: fillCrystalShard,
    mobius: fillMobius,
    comet: fillComet,
    nautilus: fillNautilus,
    free: fillFree,
});

export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPE_GENERATORS));

/**
 * Fill `arr` (Float32Array of length n*4) with target positions for `shapeName`.
 * Returns true on success, false if shape is unknown (arr is left untouched).
 * `arr` is mutated in place — no allocations.
 */
export function generateShape(shapeName, arr, n, opts = {}) {
    const gen = SHAPE_GENERATORS[shapeName];
    if (!gen) return false;
    gen(arr, n, opts);
    return true;
}
