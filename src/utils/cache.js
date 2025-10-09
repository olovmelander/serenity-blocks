// =================================================================================
// CACHE MANAGER - Canvas and asset caching for performance
// =================================================================================

/**
 * Theme-specific canvas caches for procedurally generated backgrounds
 * These caches prevent regenerating expensive canvas operations on every theme switch
 */
export const moonlitForestTreeCache = new Map();
export const wolfhourBackgroundCache = new Map();
export const himalayanPeakCache = new Map();
export const iceTempleCache = new Map();
export const crystalCaveCache = new Map();
export const lanternFestivalElementPool = { lanterns: [], reflections: [], petals: [], embers: [] };
export const lunaraBackgroundCache = new Map();

/**
 * Grid cache for rendering the game board grid lines
 * Cached to offscreen canvas for improved rendering performance
 */
export let gridCache = null;
export let gridCacheCtx = null;

/**
 * Initialize grid cache canvas
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 */
export function initGridCache(width, height) {
    gridCache = document.createElement('canvas');
    gridCache.width = width;
    gridCache.height = height;
    gridCacheCtx = gridCache.getContext('2d');
}

/**
 * Get grid cache context
 * @returns {Object} { canvas, ctx }
 */
export function getGridCache() {
    return { canvas: gridCache, ctx: gridCacheCtx };
}

/**
 * Clear all theme caches (useful for memory cleanup)
 */
export function clearThemeCaches() {
    moonlitForestTreeCache.clear();
    wolfhourBackgroundCache.clear();
    himalayanPeakCache.clear();
    iceTempleCache.clear();
    crystalCaveCache.clear();
    lunaraBackgroundCache.clear();
    lanternFestivalElementPool.lanterns = [];
    lanternFestivalElementPool.reflections = [];
    lanternFestivalElementPool.petals = [];
    lanternFestivalElementPool.embers = [];
}
