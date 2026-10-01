/** Board-safe lunar travel, solved on resize and sampled without per-frame searches. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * Layout uses bottom-left UVs and a height-relative radius. Rects use CSS pixels
 * from the top left. The returned center box is safe at the largest lunar radius.
 */
export function createBloodMoonMotionEnvelope(layout, width, height, rects = []) {
    const w = Math.max(1, finite(width, 1));
    const h = Math.max(1, finite(height, 1));
    const x = clamp(finite(layout?.x, 0.5), 0, 1) * w;
    const y = clamp(finite(layout?.y, 0.5), 0, 1) * h;
    const obstacles = [];
    if (Array.isArray(rects)) {
        for (const rect of rects) {
            if (!rect || ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) continue;
            const left = clamp(rect.left, 0, w);
            const right = clamp(rect.right, 0, w);
            const bottom = clamp(h - rect.bottom, 0, h);
            const top = clamp(h - rect.top, 0, h);
            if (right > left && top > bottom) {
                obstacles.push({
                    left, right, bottom, top,
                });
            }
        }
    }
    let maxRadius = Math.max(0, Math.min(finite(layout?.radius, 0) * h, x, w - x, y, h - y));
    for (const rect of obstacles) {
        maxRadius = Math.min(maxRadius, Math.hypot(
            Math.max(rect.left - x, 0, x - rect.right),
            Math.max(rect.bottom - y, 0, y - rect.top),
        ));
    }
    const envelope = {
        width: w,
        height: h,
        x,
        y,
        left: x,
        right: x,
        bottom: y,
        top: y,
        maxRadius,
        baseRadius: maxRadius / 1.045,
    };
    const safe = () => {
        if (envelope.left < maxRadius || envelope.right > w - maxRadius
            || envelope.bottom < maxRadius || envelope.top > h - maxRadius) return false;
        for (const rect of obstacles) {
            // Nearest distance between the entire center box and each board.
            const dx = Math.max(rect.left - envelope.right, 0, envelope.left - rect.right);
            const dy = Math.max(rect.bottom - envelope.top, 0, envelope.bottom - rect.top);
            if (Math.hypot(dx, dy) < maxRadius) return false;
        }
        return true;
    };
    const travel = Math.min(50, h * 0.06);
    for (const [key, direction] of [['left', -1], ['right', 1], ['bottom', -1], ['top', 1]]) {
        const origin = envelope[key];
        envelope[key] = origin + direction * travel;
        if (safe()) continue;
        let low = 0;
        let high = travel;
        for (let i = 0; i < 12; i++) {
            const amount = (low + high) / 2;
            envelope[key] = origin + direction * amount;
            if (safe()) low = amount;
            else high = amount;
        }
        envelope[key] = origin + direction * low;
    }
    return envelope;
}

/** Pass a reusable out object to avoid allocations in the animation loop. */
export function sampleBloodMoonMotion(envelope, time, pointerX = 0, pointerY = 0, reducedMotion = false, out = {}) {
    const t = reducedMotion ? 0 : Math.max(0, finite(time, 0));
    const px = reducedMotion ? 0 : clamp(finite(pointerX, 0), -1, 1);
    const py = reducedMotion ? 0 : clamp(finite(pointerY, 0), -1, 1);
    const u = clamp((Math.sin(t * 0.11) * 0.7 + Math.sin(t * 0.23) * 0.3) * 0.8 + px * 0.2, -1, 1);
    const v = clamp((Math.sin(t * 0.14) * 0.65 + Math.sin(t * 0.3) * 0.35) * 0.8 + py * 0.2, -1, 1);
    const dx = u * (u >= 0 ? envelope.right - envelope.x : envelope.x - envelope.left);
    const dy = v * (v >= 0 ? envelope.top - envelope.y : envelope.y - envelope.bottom);
    out.x = (envelope.x + dx) / envelope.width;
    out.y = (envelope.y + dy) / envelope.height;
    out.radius = (envelope.baseRadius * (1 + Math.sin(t * 0.16) * 0.045)) / envelope.height;
    return out;
}
