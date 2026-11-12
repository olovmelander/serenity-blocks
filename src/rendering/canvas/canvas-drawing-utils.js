/**
 * Canvas drawing for the small 2D surfaces: the piece previews of the next queue and the
 * online opponents' mini boards. A piece is drawn whole, as one fused shape
 * (drawPieceSolid), and where it will land as a smooth shadow in its own colour
 * (drawLandingShadowCanvas). The main boards are Phaser's (board-look.js).
 */

import { hexToRgb } from '../../utils/helpers.js';
import { landingShadowRects, mixColor } from '../board-look.js';

/**
 * The landing shadow on a 2D canvas, as the Phaser boards draw it (board-look.js): the piece's
 * whole shape where it will land, a smooth shadow in its own colour, faint at the top and
 * deepening toward where it rests. Plain gradient rects, no lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ArrayLike<ArrayLike<unknown>>} shape the piece's cells
 * @param {number} offsetX px of the shape's left edge
 * @param {number} offsetY px of the shape's top edge at its landing row
 * @param {number} blockSize px per cell
 * @param {string} color the piece's colour (#rrggbb)
 * @param {number} [pulse] 0..1
 */
export function drawLandingShadowCanvas(ctx, shape, offsetX, offsetY, blockSize, color, pulse = 0.5) {
    const parsed = Number.parseInt(String(color || '').replace('#', ''), 16);
    const tint = mixColor(Number.isNaN(parsed) ? 0xffffff : parsed, 0xffffff, 0.2);
    const rgb = `${(tint >> 16) & 255}, ${(tint >> 8) & 255}, ${tint & 255}`;
    ctx.save();
    for (const rect of landingShadowRects(shape, { pulse })) {
        const x = offsetX + rect.x * blockSize;
        const y = offsetY + rect.y * blockSize;
        const h = rect.h * blockSize;
        const gradient = ctx.createLinearGradient?.(0, y, 0, y + h);
        if (gradient) {
            gradient.addColorStop(0, `rgba(${rgb}, ${rect.top})`);
            gradient.addColorStop(1, `rgba(${rgb}, ${rect.bottom})`);
        }
        ctx.fillStyle = gradient || `rgba(${rgb}, ${(rect.top + rect.bottom) / 2})`;
        ctx.fillRect(x, y, rect.w * blockSize, h);
    }
    ctx.restore();
}

/**
 * Compute outline color based on base color and mode
 * @private
 * @param {string} baseColor - Base color (hex)
 * @param {string} mode - 'lighten', 'darken', or explicit hex color
 * @returns {string} Computed color
 */
function computeOutlineColor(baseColor, mode) {
    // If mode is already a color string (starts with # or rgb), use it directly
    if (typeof mode === 'string' && (mode.startsWith('#') || mode.startsWith('rgb'))) {
        return mode;
    }

    // Parse base color
    const rgb = hexToRgb(baseColor);
    if (!rgb) return mode; // Fallback to mode if parsing fails

    let { r, g, b } = rgb;

    // Apply lighten or darken
    if (mode === 'lighten') {
        const factor = 1.4;
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
    } else if (mode === 'darken') {
        const factor = 0.6;
        r = Math.round(r * factor);
        g = Math.round(g * factor);
        b = Math.round(b * factor);
    }

    return rgbToHex(r, g, b);
}

/**
 * Compute gradient stop color
 * @private
 * @param {string} baseColor - Base color (hex)
 * @param {string} stopColorMode - 'base', 'lighten', 'darken', or explicit color
 * @param {number} opacity - Opacity for this stop
 * @returns {string} RGBA color string
 */
function computeStopColor(baseColor, stopColorMode, opacity = 1) {
    let finalColor = baseColor;

    if (stopColorMode === 'base') {
        finalColor = baseColor;
    } else if (stopColorMode === 'lighten' || stopColorMode === 'darken') {
        finalColor = computeOutlineColor(baseColor, stopColorMode);
    } else if (stopColorMode.startsWith('#') || stopColorMode.startsWith('rgb')) {
        finalColor = stopColorMode;
    }

    // Convert to RGBA with opacity
    const rgb = hexToRgb(finalColor);
    if (rgb) {
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
    }

    return finalColor;
}

/**
 * Convert RGB to hex color
 * @private
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string
 */
function rgbToHex(r, g, b) {
    const toHex = (n) => {
        const hex = Math.round(n).toString(16);
        return hex.length === 1 ? `0${hex}` : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Trace the fused outer perimeter of a piece shape as one or more closed loops
 * in pixel coordinates. Mirrors the Phaser board's traceLoops so the next-queue
 * rim is the SAME continuous, centered outline (not per-cell inset segments).
 * @returns {Array<Array<{x:number,y:number}>>}
 */
function traceFusedLoops(shape, offsetX, offsetY, size) {
    const cols = shape[0]?.length ?? 0;
    const has = (x, y) => y >= 0 && y < shape.length && x >= 0 && x < cols && shape[y][x] > 0;
    const edges = [];
    shape.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell) return;
        const x0 = offsetX + x * size; const y0 = offsetY + y * size;
        const x1 = offsetX + (x + 1) * size; const y1 = offsetY + (y + 1) * size;
        if (!has(x, y - 1)) edges.push({
            fx: x0, fy: y0, tx: x1, ty: y0, dx: 1, dy: 0,
        });
        if (!has(x + 1, y)) edges.push({
            fx: x1, fy: y0, tx: x1, ty: y1, dx: 0, dy: 1,
        });
        if (!has(x, y + 1)) edges.push({
            fx: x1, fy: y1, tx: x0, ty: y1, dx: -1, dy: 0,
        });
        if (!has(x - 1, y)) edges.push({
            fx: x0, fy: y1, tx: x0, ty: y0, dx: 0, dy: -1,
        });
    }));
    if (edges.length === 0) return [];

    const startMap = new Map();
    edges.forEach((e) => {
        const k = `${e.fx},${e.fy}`;
        if (!startMap.has(k)) startMap.set(k, []);
        startMap.get(k).push(e);
    });
    const turnScore = (din, c) => {
        const cross = din.dx * c.dy - din.dy * c.dx;
        const dot = din.dx * c.dx + din.dy * c.dy;
        if (cross > 0) return 0;
        if (cross === 0 && dot > 0) return 1;
        if (cross < 0) return 2;
        return 3;
    };
    const used = new Set();
    const loops = [];
    edges.forEach((startEdge) => {
        if (used.has(startEdge)) return;
        const loop = [];
        let e = startEdge;
        let guard = 0;
        while (e && !used.has(e) && guard++ < 100000) {
            used.add(e);
            loop.push({ x: e.fx, y: e.fy });
            const candidates = startMap.get(`${e.tx},${e.ty}`) || [];
            let best = null; let bestScore = 99;
            for (const c of candidates) {
                if (used.has(c)) continue;
                const s = turnScore(e, c);
                if (s < bestScore) { bestScore = s; best = c; }
            }
            e = best;
        }
        if (loop.length >= 3) loops.push(loop);
    });
    return loops;
}

/**
 * Draw a tetromino piece with theme-based styling as a unified fused shape
 * with no internal borders or gaps between blocks.
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array<Array<number>>} shape - 2D array representing piece shape
 * @param {number} offsetX - X offset in pixels
 * @param {number} offsetY - Y offset in pixels
 * @param {number} blockSize - Size of each block in pixels
 * @param {Object} styleConfig - Style configuration { color, renderMode, effects, rendererOverrides }
 * @param {number} alpha - Opacity (0-1)
 */
export function drawPieceStyledUnified(
    ctx,
    shape,
    offsetX,
    offsetY,
    blockSize,
    styleConfig,
    alpha = 1.0,
) {
    if (!shape || shape.length === 0) return;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const size = Math.round(blockSize);

    const effects = {
        ...styleConfig.effects,
        ...(styleConfig.rendererOverrides?.canvas || {}),
    };
    const { color, renderMode } = styleConfig;

    ctx.globalAlpha = alpha;

    // First pass: Fill the unified path of the piece
    ctx.beginPath();
    shape.forEach((row, y) => {
        row.forEach((cell, x) => {
            if (cell > 0) {
                const px = Math.round(offsetX + x * size);
                const py = Math.round(offsetY + y * size);
                // Expand rect by 0.25px on all sides to eliminate sub-pixel antialiasing gaps
                ctx.rect(px - 0.25, py - 0.25, size + 0.5, size + 0.5);
            }
        });
    });

    // Apply glow effect
    if (renderMode === 'glow' && effects.glowRadius > 0) {
        let intensity = effects.glowIntensity || 1;
        if (effects.pulse) {
            const time = Date.now() / 1000;
            const pulse = Math.sin(time * (effects.pulseSpeed || 2)) * (effects.pulseAmplitude || 0.3);
            intensity *= (1 + pulse);
        }
        const glowColor = effects.glowColor === 'auto' ? color : effects.glowColor;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = effects.glowRadius;
        ctx.globalAlpha = intensity * alpha;
    }

    // Apply gradient fill
    if (renderMode === 'gradient' && effects.gradientStops) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x + 1);
                    maxY = Math.max(maxY, y + 1);
                }
            });
        });
        const gx1 = offsetX + minX * size;
        const gy1 = offsetY + minY * size;
        const gx2 = offsetX + maxX * size;
        const gy2 = offsetY + maxY * size;

        let gradient;
        if (effects.gradientType === 'radial') {
            const centerX = (gx1 + gx2) / 2;
            const centerY = (gy1 + gy2) / 2;
            const radius = Math.max(gx2 - gx1, gy2 - gy1) / 2;
            gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        } else {
            gradient = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        }
        effects.gradientStops.forEach((stop) => {
            const stopColor = computeStopColor(color, stop.color, stop.opacity || 1);
            gradient.addColorStop(stop.offset, stopColor);
        });
        ctx.fillStyle = gradient;
    } else {
        // Solid/default mode: apply a continuous TL→BR directional gradient across
        // the whole fused shape (premium depth, no internal seams). Falls back to a
        // flat fill if the bounding box can't be computed.
        let sMinX = Infinity; let sMinY = Infinity; let sMaxX = -Infinity; let sMaxY = -Infinity;
        shape.forEach((row, y) => row.forEach((cell, x) => {
            if (cell > 0) {
                sMinX = Math.min(sMinX, x); sMinY = Math.min(sMinY, y);
                sMaxX = Math.max(sMaxX, x + 1); sMaxY = Math.max(sMaxY, y + 1);
            }
        }));
        const rgb = hexToRgb(color);
        if (rgb && sMaxX > sMinX) {
            const shade = (amt) => {
                const f = amt >= 0
                    ? { r: rgb.r + (255 - rgb.r) * amt, g: rgb.g + (255 - rgb.g) * amt, b: rgb.b + (255 - rgb.b) * amt }
                    : { r: rgb.r * (1 + amt), g: rgb.g * (1 + amt), b: rgb.b * (1 + amt) };
                return `rgb(${Math.round(f.r)}, ${Math.round(f.g)}, ${Math.round(f.b)})`;
            };
            const grad = ctx.createLinearGradient(
                offsetX + sMinX * size,
                offsetY + sMinY * size,
                offsetX + sMaxX * size,
                offsetY + sMaxY * size,
            );
            grad.addColorStop(0, shade(0.18));
            grad.addColorStop(0.5, color);
            grad.addColorStop(1, shade(-0.18));
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = color;
        }
    }

    ctx.fill();

    // Reset shadow/alpha for stroke pass
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha;

    // Gloss sheen (solid/default) — a continuous top highlight clipped to the
    // fused silhouette, additive. Mirrors the Phaser board's glossPass (alpha 0.22)
    // so next-queue previews match the on-board pieces.
    if (renderMode !== 'glow' && renderMode !== 'gradient') {
        let mnX = Infinity; let mnY = Infinity; let mxX = -Infinity; let mxY = -Infinity;
        shape.forEach((row, y) => row.forEach((cell, x) => {
            if (cell > 0) {
                mnX = Math.min(mnX, x); mnY = Math.min(mnY, y);
                mxX = Math.max(mxX, x + 1); mxY = Math.max(mxY, y + 1);
            }
        }));
        if (mxX > mnX) {
            const gx1 = offsetX + mnX * size; const gy1 = offsetY + mnY * size;
            const gx2 = offsetX + mxX * size; const gy2 = offsetY + mxY * size;
            ctx.save();
            ctx.beginPath();
            shape.forEach((row, y) => row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);
                    ctx.rect(px - 0.25, py - 0.25, size + 0.5, size + 0.5);
                }
            }));
            ctx.clip();
            ctx.globalCompositeOperation = 'lighter';
            const sheen = ctx.createLinearGradient(0, gy1, 0, gy1 + (gy2 - gy1) * 0.55);
            sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
            sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sheen;
            ctx.fillRect(gx1, gy1, gx2 - gx1, gy2 - gy1);
            ctx.restore();
        }
    }

    // Premium outer rim — the SAME continuous, centered contour outline used on the
    // Phaser board (traceFusedLoops), not per-cell inset segments. This is what makes
    // the previews read identically to the on-board pieces.
    if (renderMode !== 'glow' && renderMode !== 'gradient') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.lineJoin = 'round';
        traceFusedLoops(shape, offsetX, offsetY, size).forEach((loop) => {
            if (loop.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(loop[0].x, loop[0].y);
            for (let i = 1; i < loop.length; i++) ctx.lineTo(loop[i].x, loop[i].y);
            ctx.closePath();
            ctx.stroke();
        });
    }

    // Second pass: Draw outline only on outer perimeter of the piece
    if (effects.outline && effects.outlineWidth > 0) {
        const outlineColor = computeOutlineColor(color, effects.outlineColor);
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = effects.outlineWidth;

        ctx.beginPath();
        shape.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell > 0) {
                    const px = Math.round(offsetX + x * size);
                    const py = Math.round(offsetY + y * size);

                    const hasTop = y > 0 && shape[y - 1] && shape[y - 1][x];
                    const hasBottom = y < shape.length - 1 && shape[y + 1] && shape[y + 1][x];
                    const hasLeft = x > 0 && row[x - 1];
                    const hasRight = x < row.length - 1 && row[x + 1];

                    if (!hasTop) {
                        ctx.moveTo(px, py + 0.5);
                        ctx.lineTo(px + size, py + 0.5);
                    }
                    if (!hasBottom) {
                        ctx.moveTo(px, py + size - 0.5);
                        ctx.lineTo(px + size, py + size - 0.5);
                    }
                    if (!hasLeft) {
                        ctx.moveTo(px + 0.5, py);
                        ctx.lineTo(px + 0.5, py + size);
                    }
                    if (!hasRight) {
                        ctx.moveTo(px + size - 0.5, py);
                        ctx.lineTo(px + size - 0.5, py + size);
                    }
                }
            });
        });
        ctx.stroke();
    }

    ctx.imageSmoothingEnabled = true;
    ctx.restore();
}

/**
 * Trim a piece shape matrix down to its occupied bounding box so previews are
 * sized/centred on the actual piece (e.g. the I-piece is 4×4 with blank rows).
 * @param {Array<Array<number>>} shape
 * @returns {Array<Array<number>>}
 */
export function trimShape(shape) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    shape.forEach((row, y) => row.forEach((cell, x) => {
        if (cell > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }));
    if (maxX < minX) return shape; // empty, shouldn't happen
    const trimmed = [];
    for (let y = minY; y <= maxY; y++) {
        trimmed.push(shape[y].slice(minX, maxX + 1));
    }
    return trimmed;
}

/**
 * Draw an entire tetromino piece with solid look (outer edges only)
 * This renders the piece as a cohesive unit rather than separate blocks
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array<Array<number>>} shape - 2D array representing piece shape
 * @param {number} offsetX - X offset in pixels
 * @param {number} offsetY - Y offset in pixels
 * @param {number} blockSize - Size of each block in pixels
 * @param {Object} styleConfig - Style configuration { color, renderMode, effects, rendererOverrides }
 */
export function drawPieceSolid(ctx, shape, offsetX, offsetY, blockSize, styleConfig) {
    drawPieceStyledUnified(ctx, shape, offsetX, offsetY, blockSize, styleConfig, 1.0);
}
