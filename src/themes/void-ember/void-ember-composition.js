const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** Preserve the authored orbit, keeping the breathing star disc visible in portrait. */
export function getVoidEmberAnchor(time, aspect = 1) {
    const x1 = Math.sin(time * 0.067) * 0.38;
    const x2 = Math.sin(time * 0.031 + 1.7) * 0.12;
    const y1 = Math.sin(time * 0.053 + 0.8) * 0.38;
    const y2 = Math.cos(time * 0.041 + 2.3) * 0.12;
    // The scene reconstructs a sphere of radius0.135 in height-normalized units.
    // 0.17 includes its event/breath growth and antialiasing; corona may fill the edge.
    const portrait = Number.isFinite(aspect) && aspect > 0 && aspect < 1;
    const marginX = portrait ? Math.min(0.46, 0.17 / aspect) : 0.05;
    const marginY = portrait ? 0.17 : 0.05;
    return {
        x: clamp(0.50 + x1 + x2, marginX, 1 - marginX),
        y: clamp(0.50 + y1 + y2, marginY, 1 - marginY),
    };
}
