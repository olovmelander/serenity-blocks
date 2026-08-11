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

/**
 * Ensure a small square texture exists, for debris/shard particles.
 *
 * A circle reads as a spark or a mote; destruction needs an angular chunk, and in
 * a block game the block itself is the natural shard shape. Tinting this per
 * cleared cell is what makes a line clear look like the row came apart rather
 * than like a light turned on.
 *
 * @param {Phaser.Scene} scene - Scene providing the texture manager.
 * @param {string} key - Texture key to register.
 * @param {number} size - Square edge length in pixels.
 * @param {number} color - Fill color (0xRRGGBB).
 * @param {number} alpha - Fill alpha (0-1).
 */
export function ensureSquareTexture(scene, key, size, color = 0xffffff, alpha = 1) {
    if (!scene || !scene.textures || scene.textures.exists(key)) {
        return;
    }

    const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
    graphics.fillStyle(color, alpha);
    graphics.fillRect(0, 0, size, size);
    graphics.generateTexture(key, size, size);
    graphics.destroy();
}

/**
 * Ensure an elongated "spark" texture exists — a streak with a bright leading
 * head fading to a trailing tail.
 *
 * A round dot has no direction, so a burst of them reads as a cloud no matter how
 * fast it moves. A streak reads as speed, which is the classic arcade spark. The
 * texture points along +X so a particle's `rotate` value maps straight onto
 * Phaser's angle convention (0 = right) and can be aligned to its travel
 * direction.
 *
 * @param {Phaser.Scene} scene - Scene providing the texture manager.
 * @param {string} key - Texture key to register.
 * @param {number} length - Streak length in pixels (along +X).
 * @param {number} thickness - Streak thickness in pixels.
 * @param {number} color - Fill color (0xRRGGBB).
 */
export function ensureStreakTexture(scene, key, length, thickness, color = 0xffffff) {
    if (!scene || !scene.textures || scene.textures.exists(key)) {
        return;
    }

    const graphics = scene.make.graphics({ x: 0, y: 0, add: false });
    const segments = Math.max(4, Math.round(length / 3));
    const segW = length / segments;
    for (let i = 0; i < segments; i++) {
        // Alpha ramps toward the head, and the tail narrows to a point.
        const t = (i + 1) / segments;
        const h = Math.max(1, thickness * (0.35 + 0.65 * t));
        graphics.fillStyle(color, 0.15 + 0.85 * t * t);
        graphics.fillRect(i * segW, (thickness - h) / 2, segW + 1, h);
    }
    graphics.generateTexture(key, length, thickness);
    graphics.destroy();
}
