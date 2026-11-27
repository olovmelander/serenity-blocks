// @ts-check
/**
 * CHAPTER 1'S CLOSE-UPS LOOK INTO THE SHAFT (2026-11-25).
 *
 * Every chapter once framed its orbs from the south, looking north a little down. Chapter 1's rail
 * climbs a vertical shaft, so that view met the shaft's wall a few units behind the orb: a dark
 * face of streaked rock in all but the first close-up, while the chapter's own pictures lay out of
 * frame, under the eye (the lava lake with its cracked crust and the falls of lava into it) and
 * over it (the vault's fire).
 *
 * A close-up here looks down across the shaft instead, onto the lake, from a different side at
 * each orb so the five are five pictures: the lake's crust under the first orbs, the falls and the
 * glowing depth under the higher ones, and from the last orb, at the vent's lip, the whole lake
 * far below, ringed by the throat the rail has climbed.
 *
 * THE LAST ORB LOOKS BACK DOWN (2026-11-27). It kept the shared view while it parked in the sea
 * (it looked into the water it was about to enter). It parks in the lava's light now, before the
 * sea is drawn (odyssey-chapter-arrival.js: an Earth Core orb standing in chapter 2's water was
 * the sea beginning one orb before its chapter), and there the shared view met the lip's flat rock.
 *
 * Each key is a chapter-local t (the orb's progress through the chapter) with the view's bearing
 * (`az`: 0 looks north, 90 east) and how far it looks down (`down`, degrees). An orb takes the key
 * nearest to it; they were chosen from frames of the running game, direction by direction.
 *
 * Pure (three.js vectors only), so the board and its tests share it.
 */
import * as THREE from 'three/webgpu';

/** Chapter 1's orbs stand at t 0, 0.20, 0.40, 0.61 and 0.86 of the chapter. */
export const CH1_CLOSE_UPS = Object.freeze([
    Object.freeze({ t: 0.00, az: 0, down: 30 }),
    Object.freeze({ t: 0.20, az: 270, down: 36 }),
    Object.freeze({ t: 0.40, az: 180, down: 40 }),
    Object.freeze({ t: 0.61, az: 270, down: 40 }),
    Object.freeze({ t: 0.86, az: 0, down: 70 }),
]);

/**
 * Which way chapter 1's close-up looks for an orb at chapter-local `t`.
 * @param {number} t the orb's progress through the chapter, 0..1
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3|null} a unit direction (from the eye toward the orb), or null outside the chapter
 */
export function resolveCh1CloseUp(t, out = new THREE.Vector3()) {
    if (!Number.isFinite(t) || t < 0 || t > 1) return null;
    let key = CH1_CLOSE_UPS[0];
    for (const k of CH1_CLOSE_UPS) {
        if (Math.abs(k.t - t) < Math.abs(key.t - t)) key = k;
    }
    const az = THREE.MathUtils.degToRad(key.az);
    const pitch = -THREE.MathUtils.degToRad(key.down);
    return out.set(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch));
}
