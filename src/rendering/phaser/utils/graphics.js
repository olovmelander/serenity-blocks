/**
 * Shared Phaser graphics helpers for Serenity Blocks.
 * Utilities defined here should remain side-effect free (apart from texture creation)
 * and operate purely on the scene instance that invokes them.
 */

/**
 * Ensure a lightweight circular texture exists for particle systems.
 * Generates the texture procedurally the first time and reuses it afterwards.
 *
 * @param {Phaser.Scene} scene - Scene providing the texture manager.
 * @param {string} key - Texture key to register.
 * @param {number} radius - Circle radius in pixels.
 * @param {number} color - Fill color (0xRRGGBB).
 * @param {number} alpha - Fill alpha (0-1).
 */
export function ensureCircleTexture(scene, key, radius, color = 0xffffff, alpha = 1) {
    if (!scene || !scene.textures || scene.textures.exists(key)) {
        return;
    }

    const diameter = radius * 2;
    const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(color, alpha);
    graphics.fillCircle(radius, radius, radius);
    graphics.generateTexture(key, diameter, diameter);
    graphics.destroy();
}
