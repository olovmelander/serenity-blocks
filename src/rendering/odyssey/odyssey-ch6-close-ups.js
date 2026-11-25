// @ts-check
/**
 * CHAPTER 6'S CLOSE-UPS, A JOURNEY (2026-11-25, the deep chapters audit, S1; the owner: "start the
 * implementation in the proposed order").
 *
 * An orb close-up looked along the rail turned a fixed 40 degrees, and the rail runs almost straight
 * through chapter 6 to the black hole, so its eight close-ups were one picture: the orb in the
 * middle, the ringed giant lower left, the upper right empty (the planet's centre moved under 60 px
 * from orb 39 to 48). The chapter's heroes hang at one place each in the world
 * (cosmic-expanse.js resolveCh6HeroPlaces), so a close-up can be aimed at one of them instead:
 * the orb stays in the middle and the hero of that stretch of the chapter stands beside it.
 *   - the first orbs keep the rail's view (the planetrise over the Earth's limb);
 *   - then the giant, beside the orb, a little further out at every orb as it falls behind;
 *   - then the galaxy;
 *   - then the black hole, beside the orb (never behind it, where its disk became wings on the
 *     glass), the rail running from the orb into it; it grows by approach.
 * Each key is a chapter-local t (the orb's own progress through the chapter) with the hero and
 * where it stands: `ax` degrees to its own side of the view (the side it already lies on, seen
 * along the rail) and `ay` degrees up. Between keys the angles ease; a hero changes at a key.
 *
 * Pure (three.js vectors only), so the board and its tests share it.
 */
import * as THREE from 'three/webgpu';

/**
 * The close-ups' keys, by chapter-local t of the orb (chapter 6's orbs: 35 at 0, 36 0.08, 37 0.17,
 * 38 0.25, 39 0.33, 40 0.42, 41 0.50, 42 0.58, 43 0.63, 44 0.67, 45 0.75, 46 0.83, 47 0.91, 48 0.99).
 */
export const CH6_CLOSE_UPS = Object.freeze([
    // (Before 0.12: the rail's own view, the planetrise.)
    Object.freeze({
        t: 0.12, hero: 'planet', ax: 24, ay: -6,
    }),
    Object.freeze({
        t: 0.40, hero: 'planet', ax: 38, ay: -10,
    }),
    // (The galaxy and the hole stand a little above the orb, low enough that the hole's disk band
    // and the galaxy's arms stay inside the frame.)
    Object.freeze({
        t: 0.46, hero: 'galaxy', ax: 28, ay: 4,
    }),
    Object.freeze({
        t: 0.60, hero: 'galaxy', ax: 32, ay: 3,
    }),
    Object.freeze({
        t: 0.61, hero: 'omen', ax: 26, ay: 6,
    }),
    Object.freeze({
        t: 1.00, hero: 'omen', ax: 23, ay: 5,
    }),
]);

/**
 * THE EARTH LEFT BEHIND (2026-11-25). The chapter's first three orbs park at one place (they lie
 * inside the 5->6 seam, where the eye cannot stand), and the first two shared the rail's view as
 * well: two close-ups, one picture. The second orb looks back down at the Earth it has just left
 * instead: the limb, with the sunrise drawn along it. A direction in the world (the Earth lies
 * under the chapter's start): `az` 0 looks north, 90 east; `down` is degrees under the level.
 * `from`..`to` is the chapter-local t it holds over (the second orb stands at 0.08).
 */
export const CH6_EARTH_CLOSE_UP = Object.freeze({
    from: 0.04, to: 0.12, az: 270, down: 35,
});

const _subject = new THREE.Vector3();
const _right = new THREE.Vector3();
const _view = new THREE.Vector3();

/**
 * The key in force at `t`, eased toward the next key with the same hero.
 * @param {number} t chapter-local 0..1
 * @returns {{hero: string, ax: number, ay: number} | null}
 */
export function resolveCh6CloseUpKey(t) {
    const keys = CH6_CLOSE_UPS;
    if (!Number.isFinite(t) || t < keys[0].t) return null;
    for (let i = keys.length - 1; i >= 0; i -= 1) {
        const k = keys[i];
        if (t < k.t) continue;
        const next = keys[i + 1];
        if (!next || next.hero !== k.hero) return { hero: k.hero, ax: k.ax, ay: k.ay };
        const f = THREE.MathUtils.smoothstep(t, k.t, next.t);
        return { hero: k.hero, ax: THREE.MathUtils.lerp(k.ax, next.ax, f), ay: THREE.MathUtils.lerp(k.ay, next.ay, f) };
    }
    return null;
}

/**
 * The view direction for a chapter 6 close-up: the orb in the middle, the key's hero `ax` degrees
 * to its own side and `ay` degrees up. Null where the rail's view holds (or no hero is known).
 * @param {number} t chapter-local progress of the orb
 * @param {THREE.Vector3} orb the orb's centre
 * @param {THREE.Vector3} along the rail's direction at the orb (unit)
 * @param {THREE.Vector3} up the scene's up (unit)
 * @param {{planet?: THREE.Vector3, omen?: THREE.Vector3, galaxyDir?: THREE.Vector3} | null} places
 * @param {THREE.Vector3} [out]
 * @returns {THREE.Vector3 | null}
 */
export function resolveCh6CloseUp(t, orb, along, up, places, out = new THREE.Vector3()) {
    const earth = CH6_EARTH_CLOSE_UP;
    if (Number.isFinite(t) && t >= earth.from && t < earth.to) {
        const az = THREE.MathUtils.degToRad(earth.az);
        const pitch = -THREE.MathUtils.degToRad(earth.down);
        return out.set(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch));
    }
    const key = resolveCh6CloseUpKey(t);
    if (!key || !places) return null;
    if (key.hero === 'galaxy') {
        if (!places.galaxyDir) return null;
        _subject.copy(places.galaxyDir);
    } else {
        const at = key.hero === 'planet' ? places.planet : places.omen;
        if (!at) return null;
        _subject.copy(at).sub(orb);
    }
    if (_subject.lengthSq() < 1e-8) return null;
    _subject.normalize();
    // The hero's own side, seen along the rail: it stays on the side it already lies on.
    _right.crossVectors(along, up);
    const side = _right.dot(_subject) >= 0 ? 1 : -1;
    // Turn the view off the hero: about the up by its side's angle, then down by `ay`, so the hero
    // stands that far to its side and above the middle (where the orb is).
    _view.copy(_subject).applyAxisAngle(up, THREE.MathUtils.degToRad(side * key.ax));
    _right.crossVectors(_view, up);
    if (_right.lengthSq() < 1e-8) return null;
    _right.normalize();
    _view.applyAxisAngle(_right, THREE.MathUtils.degToRad(-key.ay));
    return out.copy(_view).normalize();
}
