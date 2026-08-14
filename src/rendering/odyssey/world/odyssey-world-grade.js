/**
 * THE ONE WORLD'S OUTPUT CONTRACT — how the world hands its HDR image to the post stack.
 *
 * These three numbers decide what every Act II colour LOOKS LIKE on screen, and they used to
 * live as module-private constants inside OdysseyBoardController. That made them invisible to
 * the playground, and a playground that renders the world with different output settings than
 * the game is not a preview — it is a second, quieter opinion. The repo has paid for that lesson
 * twice: `odyssey-world-height.js` records FOUR different answers to "how high is the eye", and
 * the cloud deck's own colours were authored flat in the playground and arrived in-game as
 * "ragged NAVY shards" (odyssey-world-renderer.js, the note above `cloudBase`).
 *
 * So they live here, beside the world they configure, exactly as the steam quench's window
 * half-widths moved next to the quench "so the board and the seam-12-dive playground drive the
 * same quench by construction". Both the board and the playground rig import THESE.
 *
 * The full chain a colour travels, which is why no single number here reads as obviously right:
 *   1. the world multiplies by `ONE_WORLD_OUTPUT_SCALE` and pulls toward luma by
 *      `ONE_WORLD_OUTPUT_SATURATION` (this file),
 *   2. the renderer stays LINEAR (`NoToneMapping`) — tonemapping is in the TSL graph,
 *   3. `OdysseyTslPipeline` applies manual ACES, then a master film stock (saturation 1.15,
 *      contrast 1.07, black crush 0.018) and a PER-CHAPTER signature on top (chapter 4 lifts a
 *      further ~1.10).
 * The world therefore hands the stack a deliberately FLATTER, DIMMER image than it wants on
 * screen. Authoring a colour to look right before step 3 is how you get navy shards.
 */

/**
 * Scene-linear scale for the world's HDR output before the post stack. 1.0 leaves an ACES
 * curve no headroom and blooms the sky over everything. 0.55 was fitted while the scene fog
 * still washed the world to pastel; with the world's materials opted out of that fog the
 * whole frame came back ~40 % too dark, hence 0.82.
 */
export const ONE_WORLD_OUTPUT_SCALE = 0.82;

/**
 * ...and the world hands that stack a FLATTER image than it wants on screen, because the
 * stack is not neutral: master grade lifts saturation 1.15x, chapter 4 lifts a further 1.10x,
 * and a 0.018 black crush plus a 1.07 S-curve sits underneath both. Fed the palette as
 * authored, the sky's low red channel came out CLAMPED AT ZERO — a pure ultramarine no
 * daylight sky has. The grade supplies the vividness; the world supplies the hue.
 */
export const ONE_WORLD_OUTPUT_SATURATION = 0.72;

/** Sky dome radius for the board camera (near 0.1 / far 9000). */
export const ONE_WORLD_SKY_RADIUS = 3600;

/**
 * The board runs the colour script's exposure through the POST stack (`uExposure`), not through
 * the world, so the world must not apply it a second time. A playground rig that leaves this
 * `true` (the world's own default) double-exposes every colour it is trying to judge.
 */
export const ONE_WORLD_APPLY_EXPOSURE = false;
