/**
 * @fileoverview Sound Effects Definitions for Serenity Blocks
 * Defines sound sets (Retro and Zen) with different sound profiles
 */

/**
 * Creates sound sets for different game actions
 * @param {Function} createTone - Function to create audio tones
 * @returns {Object} Sound sets object with Retro and Zen profiles
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
            }
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
            }
        }
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
     * @param {string} setName - Name of the sound set ('Retro' or 'Zen')
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
}
