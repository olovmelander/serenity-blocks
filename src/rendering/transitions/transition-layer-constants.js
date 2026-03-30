/**
 * Shared z-layer constants for Odyssey transition overlays.
 * Keeps layering deterministic across compositor, warp, and legacy theme overlays.
 */
export const TRANSITION_LAYERS = {
    THEME_OVERLAY: 10030,
    COMPOSITOR_ROOT: 10040,
    BOARD_SNAPSHOT: 10041,
    ORB_LOCK_BRIDGE: 10042,
    WARP_LAYER: 10043,
    ARRIVAL_FLASH: 10044,
    ARRIVAL_SILHOUETTE: 10045,
    REVEAL_MASK: 10046,
    JOURNEY_ENTRY: 10047,
    JOURNEY_RETURN: 10048,
};

export default TRANSITION_LAYERS;
