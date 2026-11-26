/** The torn membrane at a mushroom's margin. Original Bézier splines sampled in Blender.
 * Each knot gives angle about the rim, outward offset, drop below the rim and strand thickness.
 * The first spline bridges two anchors. The next two hang from its crotches and the last one
 * braces the longer strands, leaving an open lacework silhouette against the cavern.
 */
const VEIL_PATHS = [
    [
        [-0.185, 0, 0, 1.8], [-0.169, 0.005, 0.056, 1.475], [-0.148, 0.009, 0.11, 1.15],
        [-0.113, 0.012, 0.165, 1.025], [-0.072, 0.014, 0.215, 0.9], [-0.04, 0.016, 0.269, 1.05],
        [0.004, 0.015, 0.298, 1.2], [0.038, 0.013, 0.279, 1.075], [0.061, 0.01, 0.241, 0.95],
        [0.093, 0.005, 0.178, 1], [0.12, 0.002, 0.112, 1.05], [0.152, 0.001, 0.056, 1.35],
        [0.186, 0, 0, 1.65],
    ],
    [
        [-0.072, 0.014, 0.215, 1.25], [-0.079, 0.029, 0.278, 1.075], [-0.079, 0.041, 0.342, 0.9],
        [-0.057, 0.051, 0.408, 0.775], [-0.038, 0.054, 0.475, 0.65], [-0.043, 0.051, 0.525, 0.72],
        [-0.057, 0.044, 0.574, 0.79], [-0.065, 0.039, 0.603, 1.22], [-0.073, 0.036, 0.631, 1.65],
        [-0.078, 0.037, 0.649, 0.915], [-0.082, 0.039, 0.666, 0.18],
    ],
    [
        [0.004, 0.015, 0.298, 1.45], [0.013, 0.002, 0.343, 1.24], [0.022, -0.005, 0.388, 1.03],
        [0.03, 0.005, 0.441, 0.905], [0.046, 0.019, 0.492, 0.78], [0.086, 0.023, 0.541, 0.685],
        [0.124, 0.026, 0.59, 0.59], [0.141, 0.04, 0.65, 0.745], [0.14, 0.048, 0.712, 0.9],
        [0.135, 0.044, 0.73, 1.25], [0.127, 0.038, 0.748, 1.6], [0.119, 0.036, 0.765, 0.88],
        [0.111, 0.035, 0.782, 0.16],
    ],
    [
        [-0.148, 0.009, 0.11, 1.1], [-0.135, 0.016, 0.151, 0.855], [-0.123, 0.022, 0.192, 0.61],
        [-0.116, 0.028, 0.234, 0.555], [-0.108, 0.034, 0.275, 0.5], [-0.098, 0.039, 0.311, 0.585],
        [-0.079, 0.041, 0.342, 0.67], [-0.064, 0.039, 0.353, 0.615], [-0.048, 0.034, 0.36, 0.56],
        [-0.013, 0.016, 0.375, 0.605], [0.022, -0.005, 0.388, 0.65],
    ],
];

/** Light triangular silk tubes share a draw across all the near fruiting bodies. */
export function buildVeil(patches) {
    const positions = [];
    const normals = [];
    const parts = [];
    const indices = [];
    for (let patch = 0; patch < patches; patch++) {
        const angle = ((Math.PI * 2) / patches) * (patch + 0.09 * Math.sin(2.4 * patch));
        const span = Math.min(1, 12 / patches) * (0.82 + 0.21 * Math.sin(1.9 * patch));
        const reach = 0.45 + 0.42 * (0.5 + 0.5 * Math.cos(patch * 2.56));
        for (const path of VEIL_PATHS) {
            const start = positions.length / 3;
            path.forEach(([arc, offset, drop, thickness], knot) => {
                const theta = angle + arc * span;
                const ca = Math.cos(theta);
                const sa = Math.sin(theta);
                const radius = 0.976 + offset;
                const width = 0.0052 * thickness;
                const y = -0.047 - drop * reach;
                for (let edge = 0; edge < 3; edge++) {
                    const azimuth = theta + edge * ((Math.PI * 2) / 3);
                    const dx = Math.cos(azimuth);
                    const dz = Math.sin(azimuth);
                    positions.push(ca * radius + dx * width, y, sa * radius + dz * width);
                    normals.push(dx, 0, dz);
                    // Varyings use the same azimuth as the cap margin at the attachment.
                    parts.push(3, drop * reach, theta / (Math.PI * 2));
                    if (knot > 0) {
                        const a = start + 3 * (knot - 1) + edge;
                        const b = start + 3 * (knot - 1) + ((edge + 1) % 3);
                        indices.push(a, b, a + 3, a + 3, b, b + 3);
                    }
                }
            });
        }
    }
    return {
        positions, normals, parts, indices,
    };
}
