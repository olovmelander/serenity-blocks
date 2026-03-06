/**
 * Shared z-layer constants for Odyssey transition overlays.
 * Keeps layering deterministic across compositor, warp, and legacy theme overlays.
 */
export const TRANSITION_LAYERS = {
    THEME_OVERLAY: 10030,
    COMPOSITOR_ROOT: 10040,
    BOARD_SNAPSHOT: 10041,
    WARP_LAYER: 10042,
    ARRIVAL_FLASH: 10043,
    REVEAL_MASK: 10044,
};

export default TRANSITION_LAYERS;
