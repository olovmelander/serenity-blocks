/**
 * A tunnel of light for the portal between Odyssey orbs.
 *
 * The entry and return portals used to hold on a near-black screen while the next board or the
 * world prepared, which read as loading. The tunnel turns that wait into travel: rings of the
 * destination's colours stream past (outward when diving into an orb, inward when pulling back
 * out to the world), light streaks give speed, and a glow ahead marks where you are going. On
 * reveal it accelerates and blooms softly into the new scene; the bloom never exceeds a third
 * of white, so it is a glow, not a flash.
 *
 * Plain 2D canvas, drawn above the portal's black veil: no WebGPU pipeline, no shader compile.
 * Counts scale with the quality preset. Pure functions; the transitions own timing and the DOM.
 */
const TUNNEL_COUNTS = Object.freeze({
    Minimal: [7, 18],
    Low: [9, 26],
    Medium: [11, 38],
    High: [13, 52],
    Ultra: [15, 68],
    Extreme: [17, 84],
});
const TAU = Math.PI * 2;
const REQUIRED_CONTEXT = ['beginPath', 'arc', 'stroke', 'fill', 'moveTo', 'lineTo', 'createRadialGradient'];

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const fract = (value) => value - Math.floor(value);

/** Ring and streak layout for one portal run; deterministic when `random` is. */
export function createPortalTunnel({ qualityPreset = 'High', palette = {}, random = Math.random } = {}) {
    const [ringCount, streakCount] = TUNNEL_COUNTS[qualityPreset] || TUNNEL_COUNTS.High;
    const colors = [palette.primary || '#ffd38a', palette.accent || '#fff3c8', palette.highlight || '#ffffff'];
    return {
        colors,
        rings: Array.from({ length: ringCount }, (_, index) => {
            // Each ring is a few arcs of energy with gaps, turning slowly: a corridor, not a target.
            const count = 2 + Math.floor(random() * 3);
            const start = random() * TAU;
            const segments = Array.from({ length: count }, (__, segment) => ({
                start: start + (segment / count) * TAU + (random() - 0.5) * 0.5,
                length: (TAU / count) * (0.45 + random() * 0.4),
            }));
            return {
                phase: index / ringCount,
                color: colors[index % 2],
                sway: random() * TAU,
                spin: (random() < 0.5 ? -1 : 1) * (0.25 + random() * 0.5),
                segments,
            };
        }),
        streaks: Array.from({ length: streakCount }, (_, index) => ({
            angle: random() * TAU,
            phase: random(),
            length: 0.55 + random() * 0.9,
            width: 0.7 + random() * 1.5,
            color: index % 3 === 0 ? colors[2] : colors[1],
        })),
    };
}

/** Test stubs and exotic contexts without strokes simply skip the tunnel. */
export function canDrawPortalTunnel(ctx) {
    return Boolean(ctx) && REQUIRED_CONTEXT.every((method) => typeof ctx[method] === 'function');
}

/**
 * Draw one frame into a cleared, CSS-pixel-scaled context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof createPortalTunnel>} tunnel
 * @param {{width: number, height: number, cx: number, cy: number, travel: number,
 *   intensity: number, direction?: number, bloom?: number}} frame `travel` is integrated
 *   distance in tunnel cycles (callers advance it by elapsed time × speed, so speed changes
 *   never jump); `direction` 1 streams outward, -1 inward.
 * @returns {boolean} whether anything was drawn
 */
export function drawPortalTunnel(ctx, tunnel, frame) {
    const intensity = clamp01(frame.intensity);
    const bloom = clamp01(frame.bloom || 0);
    if (!tunnel || !canDrawPortalTunnel(ctx) || (intensity <= 0.002 && bloom <= 0.002)) return false;
    const {
        width, height, cx, cy, travel = 0, direction = 1,
    } = frame;
    const reach = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1;
    const previousComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    if (intensity > 0.002) {
        // The corridor carries the destination's colour faintly, so the wait is never plain black.
        const wash = ctx.createRadialGradient(cx, cy, reach * 0.02, cx, cy, reach);
        wash.addColorStop(0, tunnel.colors[1]);
        wash.addColorStop(0.4, tunnel.colors[0]);
        wash.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = intensity * 0.09;
        ctx.fillStyle = wash;
        ctx.fillRect?.(0, 0, width, height);
        // The light ahead: where this portal is taking you.
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * 0.3);
        glow.addColorStop(0, tunnel.colors[2]);
        glow.addColorStop(0.12, tunnel.colors[1]);
        glow.addColorStop(0.45, tunnel.colors[0]);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = intensity * 0.3;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, reach * 0.3, 0, TAU);
        ctx.fill();
    }

    // Rings: slow near the centre, rushing past at the edge, as perspective would have it.
    ctx.lineCap = 'round';
    for (const ring of tunnel.rings) {
        let depth = fract(ring.phase + travel * 0.32);
        if (direction < 0) depth = 1 - depth;
        const alpha = intensity * (Math.sin(Math.PI * depth) ** 1.3) * 0.5;
        if (alpha <= 0.003) continue;
        const radius = reach * (0.012 + 1.08 * (depth ** 2.3));
        const sway = Math.sin(travel * 1.7 + ring.sway) * reach * 0.025 * depth;
        const stroke = 0.7 + 3.2 * depth;
        const turn = travel * ring.spin;
        ctx.strokeStyle = ring.color;
        // A wide, faint pass under a fine bright one reads as glow without a costly blur.
        [[stroke * 4.5, alpha * 0.14], [stroke, alpha]].forEach(([lineWidth, lineAlpha]) => {
            ctx.globalAlpha = lineAlpha;
            ctx.lineWidth = lineWidth;
            ring.segments.forEach((segment) => {
                const from = segment.start + turn;
                ctx.beginPath();
                ctx.arc(cx + sway, cy + sway * 0.6, radius, from, from + segment.length);
                ctx.stroke();
            });
        });
    }

    // Streaks give the sense of speed without crossing the centre; each carries a bright head.
    for (const streak of tunnel.streaks) {
        let depth = fract(streak.phase + travel * 0.55);
        if (direction < 0) depth = 1 - depth;
        const alpha = intensity * depth * (1 - depth) * 4 * 0.5;
        if (alpha <= 0.003) continue;
        const inner = reach * (0.05 + 0.92 * depth * depth);
        const outer = inner + reach * streak.length * (0.018 + 0.2 * depth * depth);
        const cos = Math.cos(streak.angle);
        const sin = Math.sin(streak.angle);
        const head = direction < 0 ? inner : outer;
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = streak.color;
        ctx.lineWidth = streak.width * (0.5 + depth);
        ctx.beginPath();
        ctx.moveTo(cx + cos * inner, cy + sin * inner);
        ctx.lineTo(cx + cos * outer, cy + sin * outer);
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, alpha * 1.3);
        ctx.fillStyle = tunnel.colors[2];
        ctx.beginPath();
        ctx.arc(cx + cos * head, cy + sin * head, streak.width * (0.6 + depth * 1.2), 0, TAU);
        ctx.fill();
    }

    // The arrival bloom opens the scene softly instead of cutting from black.
    if (bloom > 0.002) {
        const radius = reach * (0.35 + bloom * 1.1);
        const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        light.addColorStop(0, tunnel.colors[2]);
        light.addColorStop(0.35, tunnel.colors[1]);
        light.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.globalAlpha = bloom * 0.33;
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, TAU);
        ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = previousComposite || 'source-over';
    return true;
}

/** Integrate tunnel travel so a change of speed accelerates smoothly instead of jumping. */
export function advancePortalTravel(state, now, speed = 1) {
    const last = state.lastTravelAt ?? now;
    state.travel = (state.travel || 0) + Math.max(0, Math.min(100, now - last)) * 0.001 * speed;
    state.lastTravelAt = now;
    return state.travel;
}
