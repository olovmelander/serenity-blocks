/**
 * @fileoverview Sound Effects Definitions for Serenity Blocks
 * Defines sound sets (Retro, Zen, Pulse, Nebula) with different sound profiles
 */

/**
 * Creates sound sets for different game actions
 * @param {Function} createTone - Function to create audio tones
 * @returns {Object} Sound sets object with Retro, Zen, Pulse, and Nebula profiles
 */
export function createSoundSets(createTone) {
    return {
        Retro: {
            move: () => createTone(200, 0.05, 'square', 0.2),
            rotate: () => createTone(400, 0.08, 'triangle', 0.3),
            drop: () => createTone(120, 0.1, 'sine', 0.4),
            lineClear: () => {
                [523, 659, 784, 1047].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.2, 'sine', 0.4), i * 50)
                );
            },
            levelUp: () => {
                [261, 329, 392, 523, 659].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.15, 'sine', 0.5), i * 60)
                );
            },
            gameOver: () => {
                [400, 350, 300, 250, 200].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.3, 'sawtooth', 0.5), i * 150)
                );
            },
            garbageSend: () => {
                // Whizz sound - ascending sweep
                [800, 1200, 1600].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.08, 'square', 0.25), i * 30)
                );
            },
        },
        Zen: {
            move: () => createTone(100, 0.1, 'sine', 0.1),
            rotate: () => createTone(150, 0.1, 'sine', 0.15),
            drop: () => createTone(80, 0.2, 'sine', 0.2),
            lineClear: () => {
                [261, 329, 392].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.5, 'sine', 0.15), i * 80)
                );
            },
            levelUp: () => {
                [392, 493, 587].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.6, 'sine', 0.2), i * 100)
                );
            },
            gameOver: () => {
                [220, 164, 130].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.8, 'sine', 0.2), i * 200)
                );
            },
            garbageSend: () => {
                // Gentle whoosh
                [600, 800, 1000].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.12, 'sine', 0.15), i * 40)
                );
            },
        },
        Pulse: {
            move: () => createTone(260, 0.06, 'sawtooth', 0.18),
            rotate: () => createTone(420, 0.08, 'square', 0.22),
            drop: () => createTone(180, 0.14, 'triangle', 0.28),
            lineClear: () => {
                [440, 554, 659, 880].forEach((f, i) =>
                    setTimeout(
                        () => createTone(f, 0.18, i % 2 === 0 ? 'sawtooth' : 'square', 0.25),
                        i * 45
                    )
                );
            },
            levelUp: () => {
                [523, 659, 784, 988].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.22, 'square', 0.3), i * 70)
                );
            },
            gameOver: () => {
                [330, 294, 262, 220].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.4, 'triangle', 0.28), i * 160)
                );
            },
            garbageSend: () => {
                // Sharp attack sound
                [900, 1400, 1800].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.1, 'sawtooth', 0.28), i * 25)
                );
            },
        },
        Nebula: {
            move: () => {
                createTone(320, 0.18, 'sine', 0.12);
                setTimeout(() => createTone(210, 0.24, 'triangle', 0.08), 70);
            },
            rotate: () => {
                createTone(520, 0.2, 'triangle', 0.16);
                setTimeout(() => createTone(780, 0.26, 'sine', 0.12), 60);
            },
            drop: () => {
                [240, 180].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.28, 'sine', 0.2), i * 90)
                );
            },
            lineClear: () => {
                [392, 523, 659, 784].forEach((f, i) =>
                    setTimeout(
                        () => createTone(f, 0.35, i % 2 === 0 ? 'sine' : 'triangle', 0.18),
                        i * 110
                    )
                );
                setTimeout(() => createTone(987, 0.4, 'sine', 0.15), 420);
            },
            levelUp: () => {
                [330, 494, 660, 880].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.42, 'triangle', 0.22), i * 120)
                );
                setTimeout(() => createTone(1175, 0.48, 'sine', 0.18), 520);
            },
            gameOver: () => {
                [523, 392, 261, 196].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.5, 'sine', 0.17), i * 210)
                );
                setTimeout(() => createTone(130, 0.7, 'triangle', 0.22), 860);
            },
            garbageSend: () => {
                // Cosmic whoosh with echo
                [700, 1100, 1500].forEach((f, i) =>
                    setTimeout(() => createTone(f, 0.15, 'triangle', 0.2), i * 35)
                );
                setTimeout(() => createTone(1000, 0.2, 'sine', 0.1), 120);
            },
        },
    };
}

/**
 * Sound effect player wrapper
 */
export class SoundEffectPlayer {
    constructor(soundSets, soundSet = 'Zen') {
        this.soundSets = soundSets;
        this.soundSet = soundSet;
    }

    /**
     * Sets the active sound set
     * @param {string} setName - Name of the sound set ('Retro', 'Zen', 'Pulse', or 'Nebula')
     */
    setSoundSet(setName) {
        if (this.soundSets[setName]) {
            this.soundSet = setName;
        }
    }

    /**
     * Plays the move sound effect
     */
    playMove() {
        this.soundSets[this.soundSet].move();
    }

    /**
     * Plays the rotate sound effect
     */
    playRotate() {
        this.soundSets[this.soundSet].rotate();
    }

    /**
     * Plays the drop sound effect
     */
    playDrop() {
        this.soundSets[this.soundSet].drop();
    }

    /**
     * Plays the line clear sound effect
     */
    playLineClear() {
        this.soundSets[this.soundSet].lineClear();
    }

    /**
     * Plays the level up sound effect
     */
    playLevelUp() {
        this.soundSets[this.soundSet].levelUp();
    }

    /**
     * Plays the game over sound effect
     */
    playGameOver() {
        this.soundSets[this.soundSet].gameOver();
    }

    /**
     * Plays the garbage send sound effect (for multiplayer)
     */
    playGarbageSend() {
        this.soundSets[this.soundSet].garbageSend();
    }
}
