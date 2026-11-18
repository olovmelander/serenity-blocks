// Where the aurora curtains hung behind the retired chapter 3/4 scenes (ADR-0022). The curtains
// are gone with those scenes; the DEV layout editor still draws these as reference frames.
export const MOUNTAIN_AURORA_CURTAIN_CONFIGS = Object.freeze([
    Object.freeze({
        x: 0, y: 600, z: -1500, width: 4000, height: 1500, rotY: 0, opacity: 1.0,
    }),
    Object.freeze({
        x: -500, y: 500, z: -1300, width: 2500, height: 1200, rotY: 0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 500, y: 550, z: -1350, width: 2500, height: 1200, rotY: -0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 0, y: 800, z: -2000, width: 5000, height: 1800, rotY: 0, opacity: 0.6,
    }),
]);
