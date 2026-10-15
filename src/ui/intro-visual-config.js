/**
 * Intro phases and the device budget. Imported by the boot path (intro-animation.js), so it
 * stays free of three.js; the world itself (src/ui/intro-world/) is loaded lazily.
 */

export const INTRO_PHASES = {
    BOOT: 'boot',
    REVEAL: 'reveal',
    IDLE: 'idle',
    HERO_INHALE: 'hero_inhale',
    DISMISS: 'dismiss',
    MENU_BG: 'menu_bg',
};

/** The intro's budget levels and the world tier each one builds. */
export const INTRO_BUDGET_TIERS = Object.freeze({ HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' });

/**
 * The starting budget for this device, from what the browser reports (a frame-rate check may
 * lower it later). A big screen costs fill rate; little memory or few cores mean a small device.
 * @param {{ deviceMemory?: number, hardwareConcurrency?: number, screenPixels?: number }} [info]
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
export function detectIntroBudget({ deviceMemory = 8, hardwareConcurrency = 8, screenPixels = 0 } = {}) {
    if (deviceMemory <= 2 || hardwareConcurrency <= 2) return 'LOW';
    if (deviceMemory <= 4 || hardwareConcurrency <= 4 || screenPixels > 3_500_000) return 'MEDIUM';
    return 'HIGH';
}
