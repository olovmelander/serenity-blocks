/**
 * @fileoverview The board's big moments: a knock-out, a round won and the match won
 * (shared-effects.js exposes them as playKnockout / playRoundWin / playVictory).
 *
 * - Knock-out: a coral flare at the roof, then the stack goes dark under a tide that
 *   wipes down the well with a coral seam on its edge, its colour drains away (a
 *   Phaser 4 colour-matrix filter on the board camera), pieces break off and fall, and
 *   the board settles back, grey and dim, until the next round.
 * - Round won: gold light rises from the floor and fireworks go up from the well.
 * - Match won: the same, longer and brighter, with a glow behind the well.
 *
 * Light only: no full-board fills or camera flashes. Under reduced motion nothing
 * flies or shakes; the light and the colour change remain.
 */

import {
    FX, TONE, addLight, destroyOnComplete, ensureFxTextures, lightBlend, mixColor,
} from './fx-kit.js';

const rand = (min, max) => min + Math.random() * (max - min);

/** Scene time when it has one (pauses and hit-stops with the scene), else the window's. */
function later(scene, ms, fn) {
    if (typeof scene?.time?.delayedCall === 'function') return scene.time.delayedCall(ms, fn);
    return setTimeout(fn, ms);
}

function boardSize(scene) {
    const bs = scene.blockSize || 40;
    return { bs, W: (scene.cols || 10) * bs, H: (scene.rows || 20) * bs };
}

/** A one-shot particle burst that cleans itself up. */
function burst(scene, key, x, y, count, config, life) {
    if (typeof scene?.add?.particles !== 'function' || count <= 0) return null;
    const emitter = scene.add.particles(x, y, key, { ...config, emitting: false });
    if (!emitter) return null;
    emitter.setDepth?.(config.depth ?? 14);
    emitter.setScrollFactor?.(0);
    emitter.explode?.(count, x, y);
    later(scene, life + 200, () => emitter.destroy?.());
    return emitter;
}

/**
 * One firework: a mote climbs from the floor, then bursts into embers and a ring.
 * @param {Phaser.Scene} scene
 * @param {{x:number, y:number, colors:number[], delay?:number, scale?:number}} shell
 */
export function launchFirework(scene, {
    x, y, colors, delay = 0, scale = 1,
}) {
    const { bs, H } = boardSize(scene);
    later(scene, delay, () => {
        if (!scene?.sys?.isActive?.() && scene?.sys) return;
        const lead = colors[0];
        // The climb: one bright mote with a soft halo, no trail.
        const mote = addLight(scene, FX.EMBER, x, H + bs * 0.2, {
            tint: mixColor(lead, TONE.CREAM, 0.5), width: bs * 0.5, height: bs * 0.5, depth: 15,
        });
        const halo = addLight(scene, FX.GLOW, x, H + bs * 0.2, {
            tint: lead, width: bs * 1.6, height: bs * 1.6, alpha: 0.5, depth: 14,
        });
        const climb = 460;
        if (mote && scene.tweens?.add) {
            scene.tweens.add({
                targets: [mote, halo].filter(Boolean), y, duration: climb, ease: 'Cubic.easeOut',
            });
            scene.tweens.add({
                targets: [mote, halo].filter(Boolean),
                alpha: 0,
                delay: climb - 40,
                duration: 120,
                onComplete: () => { mote.destroy?.(); halo?.destroy?.(); },
            });
        }
        later(scene, mote ? climb : 0, () => {
            // The burst: a flash, a ring, embers in the shell's colours.
            const flash = addLight(scene, FX.GLOW, x, y, {
                tint: mixColor(lead, TONE.CREAM, 0.35), width: bs * 5 * scale, height: bs * 5 * scale, alpha: 0.75, depth: 14,
            });
            if (flash) {
                scene.tweens?.add?.({
                    targets: flash,
                    alpha: 0,
                    scale: flash.scale * 1.25,
                    duration: 420,
                    ease: 'Quad.easeOut',
                    onComplete: destroyOnComplete(flash),
                });
            }
            const ring = addLight(scene, FX.RING, x, y, {
                tint: lead, width: bs * 1.2, height: bs * 1.2, alpha: 0.8, depth: 14,
            });
            if (ring) {
                scene.tweens?.add?.({
                    targets: ring,
                    scale: ring.scale * 4.2 * scale,
                    alpha: 0,
                    duration: 640,
                    ease: 'Expo.easeOut',
                    onComplete: destroyOnComplete(ring),
                });
            }
            const life = 1300;
            burst(scene, FX.EMBER, x, y, Math.round(44 * scale), {
                speed: { min: 110 * scale, max: 250 * scale },
                angle: { min: 0, max: 360 },
                gravityY: 170,
                lifespan: { min: 800, max: life },
                scale: { start: (bs / 40) * 0.62, end: 0 },
                alpha: { start: 1, end: 0 },
                tint: colors,
                blendMode: lightBlend(scene),
                depth: 15,
            }, life);
        });
    });
}

/** Gold light rising from the floor of the well, then settling. */
function riseLight(scene, tint, peak, hold) {
    const { W, H } = boardSize(scene);
    const light = addLight(scene, FX.RISE, W / 2, H, {
        tint, width: W, height: H * 0.9, alpha: 0, originY: 1, depth: 6,
    });
    if (!light || !scene.tweens?.add) return;
    const base = light.scaleY;
    light.scaleY = base * 0.4;
    scene.tweens.add({
        targets: light, alpha: peak, scaleY: base, duration: 380, ease: 'Sine.easeOut',
    });
    scene.tweens.add({
        targets: light,
        alpha: 0,
        delay: 380 + hold,
        duration: 900,
        ease: 'Sine.easeIn',
        onComplete: destroyOnComplete(light),
    });
}

/**
 * A round won on this board.
 * @param {Phaser.Scene} scene
 * @param {{color?:number, reduced?:boolean}} [opts]
 */
export function playRoundWinFx(scene, { color = TONE.GOLD, reduced = false } = {}) {
    if (!ensureFxTextures(scene)) return;
    const { W, H } = boardSize(scene);
    riseLight(scene, mixColor(TONE.GOLD, color, 0.25), 0.34, 420);
    if (reduced) return;
    const colors = [color, TONE.GOLD, TONE.CREAM];
    launchFirework(scene, {
        x: W * 0.32, y: H * 0.34, colors, delay: 80,
    });
    launchFirework(scene, {
        x: W * 0.7, y: H * 0.24, colors: [TONE.GOLD, color, TONE.CREAM], delay: 420, scale: 0.9,
    });
}

/**
 * The match won on this board: the round's light, more fireworks, and a glow behind
 * the well that breathes until the results arrive.
 * @param {Phaser.Scene} scene
 * @param {{color?:number, reduced?:boolean}} [opts]
 */
export function playVictoryFx(scene, { color = TONE.GOLD, reduced = false } = {}) {
    if (!ensureFxTextures(scene)) return;
    const { W, H } = boardSize(scene);
    riseLight(scene, mixColor(TONE.GOLD, color, 0.2), 0.42, 1300);
    const halo = addLight(scene, FX.GLOW, W / 2, H * 0.42, {
        tint: mixColor(TONE.GOLD, color, 0.3), width: W * 1.7, height: H * 0.95, alpha: 0, depth: 2,
    });
    if (halo && scene.tweens?.add) {
        scene.tweens.add({
            targets: halo,
            alpha: 0.22,
            duration: 520,
            ease: 'Sine.easeOut',
            yoyo: true,
            hold: 900,
            onComplete: destroyOnComplete(halo),
        });
    }
    if (reduced) return;
    const shells = [
        [0.3, 0.3, 0, 1], [0.72, 0.22, 300, 1.05], [0.5, 0.14, 650, 1.15], [0.24, 0.5, 980, 0.85], [0.78, 0.44, 1250, 0.9],
    ];
    shells.forEach(([fx, fy, delay, scale], i) => launchFirework(scene, {
        x: W * fx, y: H * fy, delay, scale, colors: i % 2 ? [TONE.GOLD, color, TONE.CREAM] : [color, TONE.GOLD, TONE.CREAM],
    }));
}

/** The occupied cells on screen, as screen-space centres with their colours. */
function stackCells(scene, limit) {
    const grid = scene.gameState?.boardGrid || scene.gameState?.board;
    if (!Array.isArray(grid)) return [];
    const { bs } = boardSize(scene);
    const inf = Boolean(scene.gameState?.isInfinityMode);
    const top = inf ? (scene.cameras?.main?.scrollY ?? 0) / bs : scene.hiddenRows || 0;
    const rows = scene.rows || 20;
    const cells = [];
    for (let r = Math.max(0, Math.floor(top)); r < Math.min(grid.length, top + rows); r++) {
        const row = grid[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (!cell) continue;
            cells.push({ x: c * bs + bs / 2, y: (r - top) * bs + bs / 2, cell });
        }
    }
    if (cells.length <= limit) return cells;
    const stride = cells.length / limit;
    return Array.from({ length: limit }, (_, i) => cells[Math.floor(i * stride)]);
}

/**
 * A knock-out on this board.
 * @param {Phaser.Scene} scene
 * @param {{colorOf?:(cell:Object)=>number, reduced?:boolean}} [opts]
 * @returns {Object|null} the colour filter, for restoreKnockoutFx
 */
export function playKnockoutFx(scene, { colorOf = () => TONE.SLATE, reduced = false } = {}) {
    const { bs, W, H } = boardSize(scene);
    const lit = ensureFxTextures(scene);
    const camera = scene.cameras?.main;

    // 1. The roof flares coral.
    if (lit) {
        const flare = addLight(scene, FX.GLOW, W / 2, 0, {
            tint: TONE.CORAL, width: W * 1.5, height: bs * 6, alpha: 0.7, depth: 12,
        });
        const edge = addLight(scene, FX.FLARE, W / 2, bs * 0.15, {
            tint: mixColor(TONE.CORAL, TONE.CREAM, 0.4), width: W * 1.25, height: bs * 0.7, alpha: 1, depth: 13,
        });
        [flare, edge].filter(Boolean).forEach((light, i) => scene.tweens?.add?.({
            targets: light, alpha: 0, duration: i ? 420 : 620, ease: 'Quad.easeOut', onComplete: destroyOnComplete(light),
        }));
    }

    // 2. The tide: the well goes dark from the roof down, a coral seam on its edge.
    const veil = scene.add?.graphics?.();
    const seam = lit ? addLight(scene, FX.BAND, W / 2, 0, {
        tint: TONE.CORAL, width: W * 1.04, height: bs * 1.6, alpha: 0.95, depth: 11,
    }) : null;
    if (veil) {
        veil.setScrollFactor?.(0);
        veil.setDepth?.(10);
        const tide = { h: 0 };
        scene.tweens?.add?.({
            targets: tide,
            h: H,
            duration: reduced ? 360 : 640,
            ease: 'Sine.easeIn',
            onUpdate: () => {
                veil.clear();
                veil.fillStyle(TONE.NIGHT, 0.5);
                veil.fillRect(0, 0, W, tide.h);
                if (seam) seam.y = tide.h;
            },
            onComplete: () => {
                if (seam) {
                    scene.tweens?.add?.({
                        targets: seam, alpha: 0, duration: 260, onComplete: destroyOnComplete(seam),
                    });
                }
            },
        });
    }

    // 3. Its colour drains away (Phaser 4 camera filter), and the board settles back.
    let filter = null;
    try {
        filter = camera?.filters?.internal?.addColorMatrix?.() || null;
    } catch (e) {
        filter = null;
    }
    const drain = { t: 0 };
    scene.tweens?.add?.({
        targets: drain,
        t: 1,
        duration: 900,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
            const m = filter?.colorMatrix;
            if (!m) return;
            m.reset?.();
            m.saturate?.(-0.92 * drain.t);
            m.brightness?.(1 - 0.38 * drain.t, true);
        },
    });
    if (camera && scene.tweens?.add) {
        scene.tweens.add({
            targets: camera, alpha: 0.5, delay: 650, duration: 650, ease: 'Sine.easeInOut',
        });
    } else {
        camera?.setAlpha?.(0.5);
    }

    // 4. Pieces break off the stack and fall out of the well.
    if (lit && !reduced) {
        later(scene, 380, () => {
            stackCells(scene, 46).forEach(({ x, y, cell }, i) => {
                const chunk = addLight(scene, FX.SHARD, x, y, {
                    tint: mixColor(colorOf(cell), TONE.SLATE, 0.55), width: bs * 0.42, height: bs * 0.42, normal: true, depth: 12,
                });
                if (!chunk) return;
                const fall = H - y + bs * rand(2, 5);
                scene.tweens?.add?.({
                    targets: chunk,
                    y: y + fall,
                    x: x + rand(-1, 1) * bs * 0.8,
                    angle: rand(-160, 160),
                    alpha: 0,
                    delay: (i % 12) * 26,
                    duration: rand(620, 980),
                    ease: 'Quad.easeIn',
                    onComplete: destroyOnComplete(chunk),
                });
            });
        });
        scene.shakeCamera?.(1.6, 260);
    }
    later(scene, 1800, () => veil?.destroy?.());
    return filter;
}

/** Undoes a knock-out's colour filter and alpha (a new round). */
export function restoreKnockoutFx(scene, filter) {
    const camera = scene?.cameras?.main;
    if (!camera) return;
    scene.tweens?.killTweensOf?.(camera);
    camera.setAlpha?.(1);
    try {
        if (filter) camera.filters?.internal?.remove?.(filter);
    } catch (e) {
        // camera torn down
    }
}
