/**
 * Fall — the red squirrel's clips, as its asset carries them (assets/squirrel.glb).
 *
 * The clips are authored in Blender (scripts/blender/fall_squirrel/motion.py) and keyed there into
 * one action each; the asset's extras repeat this table and a test holds the two together. `speed` is
 * how fast a gait's planted paws slide back under the body at life size (metres a second): played
 * over the ground at that speed times the drawn scale, they stand still on it.
 */

export const SQUIRREL_CLIPS = Object.freeze({
    idle: Object.freeze({ length: 4, loop: true, speed: 0 }),
    sit: Object.freeze({ length: 4, loop: true, speed: 0 }),
    bound: Object.freeze({ length: 0.3, loop: true, speed: 1.6 }),
    hop: Object.freeze({ length: 14 / 30, loop: true, speed: 0.32 }),
    climb: Object.freeze({ length: 10 / 30, loop: true, speed: 0.7 }),
    descend: Object.freeze({ length: 0.5, loop: true, speed: 0.32 }),
    cling: Object.freeze({ length: 3.6, loop: true, speed: 0 }),
    nibble: Object.freeze({ length: 1.2, loop: true, speed: 0 }),
    chatter: Object.freeze({ length: 0.9, loop: true, speed: 0 }),
    startle: Object.freeze({ length: 1.2, loop: false, speed: 0 }),
    look: Object.freeze({ length: 3, loop: true, speed: 0 }),
    dig: Object.freeze({ length: 11 / 30, loop: true, speed: 0 }),
    pat: Object.freeze({ length: 0.7, loop: true, speed: 0 }),
    scratch: Object.freeze({ length: 0.6, loop: true, speed: 0 }),
    groom: Object.freeze({ length: 0.8, loop: true, speed: 0 }),
    leap: Object.freeze({ length: 16 / 30, loop: false, speed: 0 }),
});

/**
 * How much larger than life the squirrel is drawn. Life size it is a few pixels on the maple fifteen
 * metres off; at this it reads (its tail and its jumps above all) and still sits small on a trunk two
 * metres across, among leaves the size of its head.
 */
export const SQUIRREL_SCALE = 3.3;
