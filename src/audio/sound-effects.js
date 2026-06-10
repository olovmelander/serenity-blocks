/**
 * @fileoverview Sound Effects Definitions for Serenity Blocks
 * Defines sound sets (Retro, Zen, Pulse, Nebula) with different sound profiles
 */

/**
 * Creates sound sets for different game actions
 * @param {Function} createTone - Function to create audio tones
 * @returns {Object} Sound sets object with Retro, Zen, Pulse, and Nebula profiles
 */
export function createSoundSets(createTone, createRichTone) {
    // Fallback if createRichTone is not provided (for backward compatibility)
    const richTone = createRichTone || ((params) => {
        // Simple fallback to createTone using primary oscillator
        const osc = params.oscillators[0];
        createTone(osc.freq, params.duration, osc.type, osc.gain * params.volume);
    });

    return {
        Retro: {
            move: () => createTone(200, 0.05, 'square', 0.2),
            rotate: () => createTone(400, 0.08, 'triangle', 0.3),
            drop: () => createTone(120, 0.1, 'sine', 0.4),
            lineClear: () => {
                [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => createTone(f, 0.2, 'sine', 0.4), i * 50));
            },
            levelUp: () => {
                [261, 329, 392, 523, 659].forEach((f, i) => setTimeout(() => createTone(f, 0.15, 'sine', 0.5), i * 60));
            },
            gameOver: () => {
                [400, 350, 300, 250, 200].forEach((f, i) => setTimeout(() => createTone(f, 0.3, 'sawtooth', 0.5), i * 150));
            },
            garbageSend: () => {
                // Whizz sound - ascending sweep
                [800, 1200, 1600].forEach((f, i) => setTimeout(() => createTone(f, 0.08, 'square', 0.25), i * 30));
            },
        },
        Zen: {
            move: () => createTone(100, 0.1, 'sine', 0.1),
            rotate: () => createTone(150, 0.1, 'sine', 0.15),
            drop: () => createTone(80, 0.2, 'sine', 0.2),
            lineClear: () => {
                [261, 329, 392].forEach((f, i) => setTimeout(() => createTone(f, 0.5, 'sine', 0.15), i * 80));
            },
            levelUp: () => {
                [392, 493, 587].forEach((f, i) => setTimeout(() => createTone(f, 0.6, 'sine', 0.2), i * 100));
            },
            gameOver: () => {
                [220, 164, 130].forEach((f, i) => setTimeout(() => createTone(f, 0.8, 'sine', 0.2), i * 200));
            },
            garbageSend: () => {
                // Gentle whoosh
                [600, 800, 1000].forEach((f, i) => setTimeout(() => createTone(f, 0.12, 'sine', 0.15), i * 40));
            },
        },
        Pulse: {
            move: () => createTone(260, 0.06, 'sawtooth', 0.18),
            rotate: () => createTone(420, 0.08, 'square', 0.22),
            drop: () => createTone(180, 0.14, 'triangle', 0.28),
            lineClear: () => {
                [440, 554, 659, 880].forEach((f, i) => setTimeout(
                    () => createTone(f, 0.18, i % 2 === 0 ? 'sawtooth' : 'square', 0.25),
                    i * 45,
                ));
            },
            levelUp: () => {
                [523, 659, 784, 988].forEach((f, i) => setTimeout(() => createTone(f, 0.22, 'square', 0.3), i * 70));
            },
            gameOver: () => {
                [330, 294, 262, 220].forEach((f, i) => setTimeout(() => createTone(f, 0.4, 'triangle', 0.28), i * 160));
            },
            garbageSend: () => {
                // Sharp attack sound
                [900, 1400, 1800].forEach((f, i) => setTimeout(() => createTone(f, 0.1, 'sawtooth', 0.28), i * 25));
            },
        },
        Nebula: {
            move: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 320, gain: 0.15 },
                    { type: 'triangle', freq: 160, gain: 0.1 },
                ],
                envelope: { attack: 0.02, decay: 0.15, release: 0.1 },
                filter: { type: 'lowpass', frequency: 1200, Q: 0.5 },
                volume: 0.2,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'triangle', freq: 520, gain: 0.15 },
                    {
                        type: 'sine', freq: 1040, gain: 0.05, detune: 15,
                    },
                ],
                envelope: { attack: 0.03, decay: 0.2, release: 0.1 },
                filter: { type: 'highpass', frequency: 600 },
                volume: 0.2,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 80, gain: 0.6 },
                    {
                        type: 'sawtooth', freq: 160, gain: 0.1, detune: -10,
                    },
                ],
                envelope: { attack: 0.01, decay: 0.3, release: 0.2 },
                filter: { type: 'lowpass', frequency: 300, envAmount: -100 },
                volume: 0.5,
            }),
            lineClear: () => {
                [392, 523, 659, 784].forEach((f, i) => setTimeout(
                    () => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.2 },
                            {
                                type: 'sine', freq: f * 2, gain: 0.05, detune: 5,
                            },
                        ],
                        envelope: { attack: 0.05, decay: 0.5, release: 0.3 },
                        volume: 0.25,
                    }),
                    i * 100,
                ));
                setTimeout(() => richTone({
                    oscillators: [{ type: 'sine', freq: 987, gain: 0.2 }],
                    envelope: { attack: 0.1, decay: 0.8, release: 0.5 },
                    volume: 0.2,
                }), 420);
            },
            levelUp: () => {
                [330, 494, 660, 880].forEach((f, i) => setTimeout(() => richTone({
                    oscillators: [{ type: 'triangle', freq: f, gain: 0.25 }],
                    envelope: { attack: 0.05, decay: 0.4, release: 0.2 },
                    volume: 0.3,
                }), i * 120));
                setTimeout(() => richTone({
                    oscillators: [{ type: 'sine', freq: 1175, gain: 0.2 }],
                    envelope: { attack: 0.1, decay: 1.0, release: 0.5 },
                    volume: 0.25,
                }), 520);
            },
            gameOver: () => {
                [523, 392, 261, 196].forEach((f, i) => setTimeout(() => richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: f, gain: 0.2 },
                        { type: 'square', freq: f / 2, gain: 0.1 },
                    ],
                    envelope: { attack: 0.1, decay: 0.6, release: 0.4 },
                    filter: { type: 'lowpass', frequency: 800, envAmount: -400 },
                    volume: 0.3,
                }), i * 210));
                setTimeout(() => richTone({
                    oscillators: [{ type: 'triangle', freq: 130, gain: 0.4 }],
                    envelope: { attack: 0.5, decay: 2.0, release: 1.0 },
                    volume: 0.4,
                }), 860);
            },
            garbageSend: () => {
                richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: 200, gain: 0.2 },
                        { type: 'square', freq: 400, gain: 0.1 },
                    ],
                    filter: { type: 'lowpass', frequency: 200, envAmount: 1500 },
                    envelope: { attack: 0.05, decay: 0.3, release: 0.1 },
                    volume: 0.35,
                });
            },
        },
        Cosmic: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 220, gain: 0.3 }],
                filter: { type: 'lowpass', frequency: 600, Q: 1 },
                envelope: { attack: 0.01, decay: 0.1, release: 0.05 },
                volume: 0.25,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 440, gain: 0.2 },
                    { type: 'sine', freq: 445, gain: 0.2 }, // Detuned
                ],
                envelope: { attack: 0.02, decay: 0.15, release: 0.1 },
                volume: 0.25,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 55, gain: 0.8 }, // Deep sub
                    { type: 'triangle', freq: 110, gain: 0.2 },
                ],
                envelope: { attack: 0.01, decay: 0.4, release: 0.2 },
                filter: { type: 'lowpass', frequency: 150, envAmount: 50 },
                volume: 0.6,
            }),
            lineClear: () => {
                // Ethereal chord
                [261.63, 329.63, 392.00, 523.25].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [{ type: 'sine', freq: f, gain: 0.2 }],
                        envelope: { attack: 0.2, decay: 1.5, release: 1.0 },
                        volume: 0.25,
                    }), i * 50);
                });
            },
            levelUp: () => {
                [440, 554, 659, 880, 1108].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'triangle', freq: f, gain: 0.15 },
                            { type: 'sine', freq: f * 2, gain: 0.1 },
                        ],
                        envelope: { attack: 0.1, decay: 1.0, release: 0.5 },
                        volume: 0.3,
                    }), i * 100);
                });
            },
            gameOver: () => {
                richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: 110, gain: 0.4 },
                        { type: 'sawtooth', freq: 108, gain: 0.4 }, // Heavy detune
                    ],
                    filter: { type: 'lowpass', frequency: 2000, envAmount: -1800 },
                    envelope: { attack: 0.1, decay: 3.0, release: 1.0 },
                    volume: 0.5,
                });
            },
            garbageSend: () => {
                richTone({
                    noise: { type: 'pink', gain: 0.3 },
                    filter: {
                        type: 'bandpass', frequency: 400, envAmount: 2000, Q: 5,
                    },
                    envelope: { attack: 0.05, decay: 0.4, release: 0.2 },
                    volume: 0.4,
                });
            },
        },
        Pyrestorm: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 120, gain: 0.6 }], // Boosted gain
                noise: { type: 'pink', gain: 0.2 },
                filter: { type: 'lowpass', frequency: 600, Q: 0.5 }, // Opened filter slightly
                envelope: { attack: 0.01, decay: 0.1, release: 0.05 },
                volume: 0.5, // Boosted volume
            }),
            rotate: () => richTone({
                noise: { type: 'pink', gain: 0.4 },
                filter: {
                    type: 'bandpass', frequency: 300, envAmount: 400, Q: 1,
                },
                envelope: { attack: 0.05, decay: 0.2, release: 0.1 },
                volume: 0.4,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 40, gain: 0.9 },
                    { type: 'triangle', freq: 80, gain: 0.3 },
                ],
                noise: { type: 'pink', gain: 0.1 },
                filter: { type: 'lowpass', frequency: 150, Q: 1 },
                envelope: { attack: 0.01, decay: 0.5, release: 0.3 },
                volume: 0.8, // Boosted volume
            }),
            lineClear: () => {
                // Warm fire chord (C minor add9)
                [65.41, 77.78, 98.00, 146.83].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sawtooth', freq: f, gain: 0.2 },
                            { type: 'sine', freq: f * 2, gain: 0.15 },
                        ],
                        noise: { type: 'pink', gain: 0.05 },
                        filter: { type: 'lowpass', frequency: 400, envAmount: 300 },
                        envelope: { attack: 0.1, decay: 1.0, release: 0.8 },
                        volume: 0.4,
                    }), i * 40);
                });
                // Sparkle burst
                setTimeout(() => richTone({
                    noise: { type: 'white', gain: 0.2 },
                    filter: { type: 'highpass', frequency: 2000 },
                    envelope: { attack: 0.01, decay: 0.3 },
                    volume: 0.3,
                }), 100);
            },
            levelUp: () => {
                richTone({
                    oscillators: [{ type: 'sawtooth', freq: 100, gain: 0.4 }],
                    noise: { type: 'pink', gain: 0.5 },
                    filter: {
                        type: 'lowpass', frequency: 200, envAmount: 1000, Q: 2,
                    },
                    envelope: { attack: 0.5, decay: 1.5, release: 1.0 },
                    volume: 0.6,
                });
            },
            gameOver: () => {
                richTone({
                    oscillators: [{ type: 'sine', freq: 50, gain: 0.7 }],
                    noise: { type: 'pink', gain: 0.4 },
                    filter: { type: 'lowpass', frequency: 400, envAmount: -300 },
                    envelope: { attack: 0.1, decay: 4.0, release: 2.0 },
                    volume: 0.7,
                });
            },
            garbageSend: () => {
                richTone({
                    oscillators: [{ type: 'sawtooth', freq: 150, gain: 0.4 }],
                    noise: { type: 'pink', gain: 0.5 },
                    filter: {
                        type: 'bandpass', frequency: 200, envAmount: 800, Q: 3,
                    },
                    envelope: { attack: 0.02, decay: 0.3, release: 0.1 },
                    volume: 0.5,
                });
            },
        },
        SwedishForest: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 400, gain: 0.3 }], // Very soft wood block
                noise: { type: 'pink', gain: 0.1 }, // Barely audible crunch
                filter: { type: 'lowpass', frequency: 3000 },
                envelope: { attack: 0.005, decay: 0.12, release: 0.05 },
                volume: 0.1, // Very subtle
            }),
            rotate: () => richTone({
                oscillators: [{ type: 'triangle', freq: 200, gain: 0.25 }],
                noise: { type: 'white', gain: 0.08 },
                filter: {
                    type: 'bandpass', frequency: 500, envAmount: 400, Q: 1,
                },
                envelope: { attack: 0.05, decay: 0.25, release: 0.1 },
                volume: 0.15, // Subtle wind
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 50, gain: 0.9 },
                    { type: 'sine', freq: 150, gain: 0.25 },
                ],
                filter: { type: 'lowpass', frequency: 250, Q: 0.5 },
                envelope: { attack: 0.02, decay: 0.6, release: 0.3 },
                volume: 0.3, // Reduced impact
            }),
            lineClear: () => {
                // Nordic ambient chord (Am9: A2, C3, E3, B3) - Cold, spacious, organic
                [110.00, 130.81, 164.81, 246.94].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.3 },
                            { type: 'triangle', freq: f, gain: 0.15 },
                        ],
                        filter: { type: 'lowpass', frequency: 1200, envAmount: 300 },
                        envelope: { attack: 0.15, decay: 2.0, release: 1.5 },
                        volume: 0.3, // Reduced from 0.4
                    }), i * 60);
                });
                // Subtle mist texture
                setTimeout(() => richTone({
                    noise: { type: 'pink', gain: 0.15 },
                    filter: { type: 'highpass', frequency: 2000 },
                    envelope: { attack: 0.5, decay: 1.5, release: 1.0 },
                    volume: 0.15, // Reduced from 0.2
                }), 50);
            },
            levelUp: () => {
                // Aurora swell
                [220, 440, 880].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [{ type: 'sine', freq: f, gain: 0.2 }],
                        filter: {
                            type: 'bandpass', frequency: f, envAmount: 600, Q: 2,
                        },
                        envelope: { attack: 0.5, decay: 2.0, release: 1.0 },
                        volume: 0.3, // Reduced from 0.35
                    }), i * 100);
                });
            },
            gameOver: () => {
                // Deep forest silence
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 55, gain: 0.6 },
                        { type: 'sine', freq: 54, gain: 0.6 }, // Slow beating
                    ],
                    filter: { type: 'lowpass', frequency: 200 },
                    envelope: { attack: 0.5, decay: 4.0, release: 2.0 },
                    volume: 0.5, // Reduced from 0.7
                });
            },
            garbageSend: () => {
                // Falling branch/heavy impact
                richTone({
                    oscillators: [{ type: 'square', freq: 60, gain: 0.3 }],
                    noise: { type: 'pink', gain: 0.4 },
                    filter: { type: 'lowpass', frequency: 400, envAmount: -150 },
                    envelope: { attack: 0.01, decay: 0.3, release: 0.1 },
                    volume: 0.4, // Reduced from 0.5
                });
            },
        },
        Galaxy: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 800, gain: 0.15 }], // High, distant blip
                noise: { type: 'pink', gain: 0.05 }, // Granular dust
                filter: { type: 'highpass', frequency: 2000 },
                envelope: { attack: 0.005, decay: 0.05, release: 0.05 },
                volume: 0.2,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 300, gain: 0.2 },
                    { type: 'sine', freq: 302, gain: 0.2 }, // Phasing
                ],
                filter: { type: 'lowpass', frequency: 800, envAmount: 200 },
                envelope: { attack: 0.05, decay: 0.3, release: 0.2 },
                volume: 0.25,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 35, gain: 1.0 }, // Massive sub-bass
                    { type: 'triangle', freq: 70, gain: 0.3 },
                ],
                envelope: { attack: 0.01, decay: 0.8, release: 0.5 },
                filter: { type: 'lowpass', frequency: 100, Q: 0.8 },
                volume: 0.9,
            }),
            lineClear: () => {
                // Ethereal Space Chord (Eb Lydian: Eb, G, Bb, D, F)
                [155.56, 196.00, 233.08, 293.66, 349.23].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.2 },
                            { type: 'sine', freq: f * 1.01, gain: 0.1 }, // Detuned layer
                        ],
                        envelope: { attack: 0.3, decay: 2.5, release: 2.0 },
                        volume: 0.35,
                    }), i * 80);
                });
                // Stardust shimmer
                setTimeout(() => richTone({
                    noise: { type: 'white', gain: 0.1 },
                    filter: { type: 'highpass', frequency: 4000 },
                    envelope: { attack: 0.1, decay: 1.0, release: 1.0 },
                    volume: 0.15,
                }), 200);
            },
            levelUp: () => {
                // Interstellar sweep
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 200, gain: 0.3 },
                        { type: 'sine', freq: 202, gain: 0.3 },
                    ],
                    filter: {
                        type: 'bandpass', frequency: 200, envAmount: 2000, Q: 5,
                    },
                    envelope: { attack: 1.0, decay: 3.0, release: 2.0 },
                    volume: 0.5,
                });
            },
            gameOver: () => {
                // Universe collapse
                richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: 50, gain: 0.4 },
                        { type: 'sine', freq: 40, gain: 0.6 },
                    ],
                    filter: { type: 'lowpass', frequency: 1000, envAmount: -900 },
                    envelope: { attack: 0.1, decay: 5.0, release: 3.0 },
                    volume: 0.7,
                });
            },
            garbageSend: () => {
                // Meteor impact
                richTone({
                    oscillators: [{ type: 'square', freq: 80, gain: 0.2 }],
                    noise: { type: 'pink', gain: 0.4 },
                    filter: { type: 'lowpass', frequency: 200, envAmount: -100 },
                    envelope: { attack: 0.01, decay: 0.4, release: 0.2 },
                    volume: 0.5,
                });
            },
        },
        StellarDrift: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 60, gain: 0.5 }], // Sub-heavy thud
                noise: { type: 'pink', gain: 0.05 },
                filter: { type: 'lowpass', frequency: 150, envAmount: -50 }, // Muffled
                envelope: { attack: 0.01, decay: 0.1, release: 0.05 },
                volume: 0.4,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 50, gain: 0.3 },
                    { type: 'sine', freq: 52, gain: 0.3 }, // Detuned pulse
                ],
                filter: {
                    type: 'bandpass', frequency: 100, envAmount: 50, Q: 1,
                },
                envelope: { attack: 0.05, decay: 0.3, release: 0.1 },
                volume: 0.35,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 35, gain: 0.8 }, // Deep sub
                    { type: 'triangle', freq: 70, gain: 0.2 },
                ],
                filter: { type: 'lowpass', frequency: 120, Q: 0.8 },
                envelope: { attack: 0.01, decay: 0.6, release: 0.4 },
                volume: 0.8,
            }),
            lineClear: () => {
                // "Slow-evolving interstellar dark ambient drone"
                // Using a long, evolving chord with low frequencies
                // Frequencies: 40Hz, 80Hz, 120Hz (harmonic series)
                [40, 80, 120, 160].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.3 },
                            { type: 'sine', freq: f * 1.01, gain: 0.1 }, // Detuned
                        ],
                        noise: { type: 'pink', gain: 0.05 }, // "Textural cosmic rumble"
                        filter: { type: 'lowpass', frequency: 300, envAmount: 100 },
                        envelope: { attack: 0.5, decay: 3.0, release: 2.0 }, // "Long arcs"
                        volume: 0.4,
                    }), i * 100);
                });
            },
            levelUp: () => {
                // "Distant metallic hull groans"
                richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: 60, gain: 0.2 },
                        { type: 'square', freq: 118, gain: 0.15 }, // Dissonant
                    ],
                    filter: {
                        type: 'bandpass', frequency: 200, envAmount: -50, Q: 5,
                    }, // Resonant moan
                    envelope: { attack: 1.0, decay: 4.0, release: 2.0 },
                    volume: 0.5,
                });
            },
            gameOver: () => {
                // "Filtered vacuum noise"
                richTone({
                    noise: { type: 'pink', gain: 0.4 },
                    filter: { type: 'lowpass', frequency: 400, envAmount: -300 }, // Closing down
                    envelope: { attack: 0.1, decay: 5.0, release: 3.0 },
                    oscillators: [{ type: 'sine', freq: 30, gain: 0.6 }], // Ultra low sub
                    volume: 0.6,
                });
            },
            garbageSend: () => {
                richTone({
                    oscillators: [{ type: 'square', freq: 50, gain: 0.2 }],
                    filter: { type: 'lowpass', frequency: 200, envAmount: 100 },
                    envelope: { attack: 0.05, decay: 0.4, release: 0.2 },
                    volume: 0.4,
                });
            },
        },
        CinderDrift: {
            move: () => richTone({
                // Deep low-end thud (55-60Hz sine) - raised freq, lower gain
                oscillators: [{ type: 'sine', freq: 55, gain: 0.4 }],
                filter: { type: 'lowpass', frequency: 120, envAmount: -30 }, // Less muffled
                envelope: { attack: 0.02, decay: 0.15, release: 0.1 },
                volume: 0.4,
            }),
            rotate: () => richTone({
                // Grinding texture - lighter touch
                oscillators: [
                    { type: 'sawtooth', freq: 50, gain: 0.15 },
                    { type: 'triangle', freq: 48, gain: 0.15 },
                ],
                noise: { type: 'brown', gain: 0.08 },
                filter: {
                    type: 'bandpass', frequency: 90, Q: 0.5, envAmount: 20,
                },
                envelope: { attack: 0.05, decay: 0.2, release: 0.1 },
                volume: 0.35,
            }),
            drop: () => richTone({
                // Impact - raised sub freq, reduced decay
                oscillators: [
                    { type: 'sine', freq: 45, gain: 0.6 },
                    { type: 'square', freq: 45, gain: 0.1 },
                ],
                noise: { type: 'brown', gain: 0.15 },
                filter: {
                    type: 'lowpass', frequency: 150, Q: 1.0, envAmount: -20,
                },
                envelope: { attack: 0.01, decay: 0.6, release: 0.4 },
                volume: 0.8,
            }),
            lineClear: () => {
                // "Long evolving drone" - shifted up
                const freqs = [60, 90, 120]; // Shifted up ~10-20Hz
                freqs.forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.25 },
                            { type: 'sawtooth', freq: f * 1.005, gain: 0.06 },
                        ],
                        filter: {
                            type: 'lowpass', frequency: 200 + (i * 50), Q: 2, envAmount: 50,
                        },
                        envelope: {
                            attack: 0.5 + (i * 0.2), decay: 2.0, sustain: 0.3, release: 3.0,
                        },
                        volume: 0.45,
                    }), i * 150);
                });
            },
            levelUp: () => richTone({
                // Swell - less sub focus
                oscillators: [
                    { type: 'sawtooth', freq: 65, gain: 0.25 },
                    { type: 'sine', freq: 50, gain: 0.4 },
                ],
                filter: {
                    type: 'lowpass', frequency: 250, Q: 2, envAmount: 200,
                },
                envelope: { attack: 1.5, decay: 3.0, release: 4.0 },
                volume: 0.6,
            }),
            gameOver: () => richTone({
                // Ambient fade - lighter
                oscillators: [{ type: 'sine', freq: 40, gain: 0.4 }],
                noise: { type: 'pink', gain: 0.15 },
                filter: { type: 'lowpass', frequency: 80, Q: 3 },
                envelope: { attack: 0.1, decay: 4.0, release: 5.0 },
                volume: 0.5,
            }),
            garbageSend: () => richTone({
                // Rumble
                oscillators: [{ type: 'sawtooth', freq: 50, gain: 0.25 }],
                noise: { type: 'brown', gain: 0.08 },
                filter: { type: 'lowpass', frequency: 100, envAmount: -10 },
                envelope: { attack: 0.2, decay: 0.5, release: 0.3 },
                volume: 0.4,
            }),
        },
        Bioluminescence: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 220, gain: 0.3 }], // Soft sonar ping
                filter: {
                    type: 'lowpass', frequency: 600, envAmount: -200, Q: 2,
                }, // Watery damping
                envelope: { attack: 0.01, decay: 0.15, release: 0.05 },
                volume: 0.25,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 400, gain: 0.2 },
                    { type: 'sine', freq: 404, gain: 0.2 }, // Slow fluid phasing
                ],
                noise: { type: 'white', gain: 0.05 }, // Bubbles
                filter: {
                    type: 'bandpass', frequency: 800, envAmount: 400, Q: 1.5,
                },
                envelope: { attack: 0.1, decay: 0.3, release: 0.2 },
                volume: 0.25,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 32, gain: 1.0 }, // Massive deep ocean sub
                    { type: 'sine', freq: 64, gain: 0.3 },
                ],
                noise: { type: 'pink', gain: 0.1 }, // Muffled splash
                filter: { type: 'lowpass', frequency: 120, Q: 1 },
                envelope: { attack: 0.02, decay: 1.0, release: 0.8 },
                volume: 0.9,
            }),
            lineClear: () => {
                // Glowing Cluster Chord (F# Major add9: F#2, A#2, C#3, G#3)
                [185.00, 233.08, 277.18, 415.30].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.25 },
                            { type: 'triangle', freq: f, gain: 0.1 },
                        ],
                        filter: { type: 'lowpass', frequency: 800, envAmount: 400 },
                        envelope: { attack: 0.2, decay: 2.0, release: 1.5 },
                        volume: 0.35,
                    }), i * 70);
                });
                // Bioluminescent sparkles (Granular details)
                for (let j = 0; j < 3; j++) {
                    setTimeout(() => richTone({
                        noise: { type: 'white', gain: 0.08 },
                        filter: { type: 'highpass', frequency: 3000 + (j * 1000) },
                        envelope: { attack: 0.01, decay: 0.1, release: 0.05 },
                        volume: 0.15,
                    }), 150 + (j * 80));
                }
            },
            levelUp: () => {
                // Whale-like swell
                richTone({
                    oscillators: [{ type: 'sine', freq: 150, gain: 0.4 }],
                    filter: {
                        type: 'lowpass', frequency: 200, envAmount: 600, Q: 4,
                    },
                    envelope: { attack: 1.5, decay: 3.0, release: 2.0 },
                    volume: 0.5,
                });
            },
            gameOver: () => {
                // Abyssal descent
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 45, gain: 0.6 },
                        { type: 'sine', freq: 43, gain: 0.6 }, // Deep beating
                    ],
                    filter: { type: 'lowpass', frequency: 100 },
                    envelope: { attack: 0.5, decay: 5.0, release: 3.0 },
                    volume: 0.7,
                });
            },
            garbageSend: () => {
                // Pressure wave
                richTone({
                    oscillators: [{ type: 'sine', freq: 80, gain: 0.5 }],
                    noise: { type: 'pink', gain: 0.2 },
                    filter: { type: 'lowpass', frequency: 300, envAmount: -200 },
                    envelope: { attack: 0.05, decay: 0.5, release: 0.2 },
                    volume: 0.6,
                });
            },
        },
        Wolfhour: {
            move: () => richTone({
                oscillators: [{ type: 'sine', freq: 800, gain: 0.15 }], // Icy bell
                noise: { type: 'white', gain: 0.05 }, // Tiny crunch
                filter: { type: 'highpass', frequency: 1500 },
                envelope: { attack: 0.005, decay: 0.1, release: 0.05 },
                volume: 0.25,
            }),
            rotate: () => richTone({
                oscillators: [{ type: 'sine', freq: 300, gain: 0.1 }], // Wind resonance
                noise: { type: 'pink', gain: 0.2 },
                filter: {
                    type: 'bandpass', frequency: 400, envAmount: 300, Q: 2,
                }, // Howling sweep
                envelope: { attack: 0.1, decay: 0.3, release: 0.2 },
                volume: 0.3,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 45, gain: 0.8 }, // Thud
                    { type: 'triangle', freq: 150, gain: 0.25 }, // Crisp snap
                ],
                noise: { type: 'white', gain: 0.15 }, // Icy crunch
                filter: { type: 'lowpass', frequency: 300, Q: 1.5, envAmount: 200 },
                envelope: { attack: 0.01, decay: 0.3, release: 0.15 }, // Tighter lock sound
                volume: 0.85,
            }),
            lineClear: () => {
                // Deep Healing Frequencies (Solfeggio Scale, octave down)
                // 198Hz, 208Hz, 216Hz, 264Hz — warm, grounded resonance
                [198, 208, 216, 264].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.5 }, // Deep healing tone
                            { type: 'sine', freq: f * 0.5, gain: 0.2 }, // Sub-octave warmth
                        ],
                        filter: { type: 'lowpass', frequency: 500, envAmount: 100, Q: 1.5 },
                        envelope: { attack: 0.25, decay: 3.0, release: 2.5 }, // Slow, deep Tibetan bowl
                        volume: 0.55,
                    }), i * 120); // Slow, meditative roll
                });

                // Earth drone (87Hz — deep grounding sub)
                setTimeout(() => richTone({
                    oscillators: [
                        { type: 'sine', freq: 87, gain: 0.6 },
                        { type: 'sine', freq: 88, gain: 0.6 }, // Slow beating/pulsing
                    ],
                    filter: { type: 'lowpass', frequency: 200, Q: 1 },
                    envelope: { attack: 0.5, decay: 3.5, release: 2.5 },
                    volume: 0.4,
                }), 50);
            },
            levelUp: () => {
                // Ethereal rising choir
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 150, gain: 0.3 },
                        { type: 'sawtooth', freq: 151, gain: 0.1 },
                    ],
                    noise: { type: 'pink', gain: 0.1 }, // Peak wind
                    filter: {
                        type: 'bandpass', frequency: 300, envAmount: 800, Q: 3,
                    }, // Rising howl
                    envelope: { attack: 1.5, decay: 4.0, release: 3.0 },
                    volume: 0.65,
                });
            },
            gameOver: () => {
                // The Wolfhour Void
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 40, gain: 0.7 }, // Deep earth groan
                        { type: 'sine', freq: 42, gain: 0.7 }, // Pulsing unease
                    ],
                    noise: { type: 'pink', gain: 0.2 }, // Distant wind
                    filter: { type: 'lowpass', frequency: 150, envAmount: -100 },
                    envelope: { attack: 0.5, decay: 6.0, release: 4.0 }, // Very long fade into silence
                    volume: 0.9,
                });
            },
            garbageSend: () => {
                // Shattering ice and rift rumble
                richTone({
                    oscillators: [{ type: 'square', freq: 80, gain: 0.2 }],
                    noise: { type: 'white', gain: 0.4 }, // Sharp ice shatter
                    filter: { type: 'bandpass', frequency: 1000, envAmount: -800, Q: 1.5 },
                    envelope: { attack: 0.01, decay: 0.5, release: 0.3 },
                    volume: 0.6,
                });
            },
        },
        NeonDusk: {
            move: () => richTone({
                oscillators: [{ type: 'triangle', freq: 300, gain: 0.15 }], // Softer click
                noise: { type: 'white', gain: 0.03 }, // Reduced glitch dust
                filter: { type: 'lowpass', frequency: 1200, envAmount: -400 },
                envelope: { attack: 0.005, decay: 0.08, release: 0.02 },
                volume: 0.15, // Reduced from 0.25
            }),
            rotate: () => richTone({
                oscillators: [{ type: 'sine', freq: 400, gain: 0.15 }],
                noise: { type: 'pink', gain: 0.05 },
                filter: {
                    type: 'bandpass', frequency: 600, envAmount: 400, Q: 1.5,
                }, // Softer swipe
                envelope: { attack: 0.02, decay: 0.2, release: 0.1 },
                volume: 0.15, // Reduced from 0.25
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 45, gain: 0.9 }, // Deep neon sub
                    { type: 'sawtooth', freq: 90, gain: 0.1 }, // Reduced buzz
                ],
                filter: { type: 'lowpass', frequency: 150, Q: 0.6 },
                envelope: { attack: 0.01, decay: 0.6, release: 0.4 },
                volume: 0.5, // Reduced from 0.85
            }),
            lineClear: () => {
                // Twilight Glow Chord (Db Major 9: Db3, F3, Ab3, C4, Eb4)
                [138.59, 174.61, 207.65, 261.63, 311.13].forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.2 },
                            { type: 'triangle', freq: f, gain: 0.1 },
                        ],
                        filter: { type: 'lowpass', frequency: 800, envAmount: 300 },
                        envelope: { attack: 0.1, decay: 1.5, release: 1.2 },
                        volume: 0.25, // Reduced from 0.35
                    }), i * 50);
                });
                // Glitch artifacts
                for (let j = 0; j < 3; j++) { // Reduced count
                    setTimeout(() => richTone({
                        noise: { type: 'white', gain: 0.05 }, // Reduced gain
                        filter: { type: 'highpass', frequency: 4000 },
                        envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
                        volume: 0.05, // Reduced from 0.1
                    }), 100 + (Math.random() * 300));
                }
            },
            levelUp: () => {
                // Power up swell
                richTone({
                    oscillators: [
                        { type: 'sawtooth', freq: 100, gain: 0.15 },
                        { type: 'square', freq: 100, gain: 0.08 },
                    ],
                    filter: {
                        type: 'lowpass', frequency: 200, envAmount: 1500, Q: 2,
                    },
                    envelope: { attack: 0.5, decay: 2.0, release: 1.0 },
                    volume: 0.3, // Reduced from 0.5
                });
            },
            gameOver: () => {
                // System shutdown
                richTone({
                    oscillators: [{ type: 'sawtooth', freq: 60, gain: 0.3 }],
                    noise: { type: 'pink', gain: 0.15 },
                    filter: { type: 'lowpass', frequency: 800, envAmount: -700 },
                    envelope: { attack: 0.1, decay: 3.0, release: 1.0 },
                    volume: 0.4, // Reduced from 0.6
                });
            },
            garbageSend: () => {
                // Digital impact
                richTone({
                    oscillators: [{ type: 'square', freq: 120, gain: 0.2 }],
                    filter: {
                        type: 'bandpass', frequency: 400, envAmount: -150, Q: 3,
                    },
                    envelope: { attack: 0.01, decay: 0.3, release: 0.1 },
                    volume: 0.3, // Reduced from 0.4
                });
            },
        },
        ChromaticImpasto: {
            move: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 65, gain: 0.6 }, // Deep heart-beat sub
                    { type: 'triangle', freq: 130, gain: 0.15 }, // Warm body
                ],
                noise: { type: 'brown', gain: 0.08 }, // Subtle organic texture
                filter: {
                    type: 'lowpass', frequency: 250, envAmount: 50, Q: 1,
                },
                envelope: { attack: 0.01, decay: 0.2, release: 0.15 }, // Smooth, weighted movement
                volume: 0.5,
            }),
            rotate: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 90, gain: 0.3 },
                    {
                        type: 'sawtooth', freq: 85, gain: 0.1, detune: 5,
                    }, // Chorused texture
                ],
                noise: { type: 'pink', gain: 0.05 },
                filter: {
                    type: 'bandpass', frequency: 180, envAmount: 150, Q: 1.5,
                }, // Deep "whoosh" rather than scrape
                envelope: { attack: 0.03, decay: 0.25, release: 0.1 },
                volume: 0.4,
            }),
            drop: () => richTone({
                oscillators: [
                    { type: 'sine', freq: 40, gain: 1.0 }, // Powerful sub-bass impact
                    { type: 'sine', freq: 80, gain: 0.4 },
                ],
                noise: { type: 'brown', gain: 0.15 }, // Heavy impact thud
                filter: {
                    type: 'lowpass', frequency: 120, Q: 0.8, envAmount: -20,
                },
                envelope: { attack: 0.005, decay: 0.6, release: 0.4 },
                volume: 0.85,
            }),
            lineClear: () => {
                // "Healing" Resonant Chord (C Minor 9: C2, Eb2, G2, Bb2, D3) - Deep, dark, meditative
                const freqs = [65.41, 77.78, 98.00, 116.54, 146.83];
                freqs.forEach((f, i) => {
                    setTimeout(() => richTone({
                        oscillators: [
                            { type: 'sine', freq: f, gain: 0.4 }, // Pure fundamental
                            { type: 'triangle', freq: f * 2, gain: 0.1 }, // First harmonic warmth
                        ],
                        filter: {
                            type: 'lowpass', frequency: 400, envAmount: 200, Q: 2,
                        }, // Gong-like resonance
                        envelope: { attack: 0.1 + (i * 0.05), decay: 2.5, release: 2.0 }, // Long, sustaining tail
                        volume: 0.5,
                    }), i * 40); // Slower strum for grandeur
                });
                // Deep atmospheric shimmer
                setTimeout(() => richTone({
                    noise: { type: 'pink', gain: 0.08 },
                    filter: {
                        type: 'lowpass', frequency: 600, envAmount: -200, Q: 1,
                    },
                    envelope: { attack: 0.5, decay: 2.0, release: 1.5 },
                    volume: 0.2,
                }), 100);
            },
            levelUp: () => {
                // Deep rising energy (Kundalini rise)
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 110, gain: 0.4 },
                        { type: 'sine', freq: 112, gain: 0.4 }, // Binaural beat pulsing
                    ],
                    filter: {
                        type: 'lowpass', frequency: 200, envAmount: 800, Q: 4,
                    },
                    envelope: { attack: 1.0, decay: 3.0, release: 2.0 },
                    volume: 0.6,
                });
            },
            gameOver: () => {
                // Deep resolving drone (Om-like resolution into silence)
                richTone({
                    oscillators: [
                        { type: 'sine', freq: 55, gain: 0.5 }, // Low A
                        { type: 'sine', freq: 82.4, gain: 0.3 }, // E
                    ],
                    noise: { type: 'brown', gain: 0.2 },
                    filter: { type: 'lowpass', frequency: 150, envAmount: -50 },
                    envelope: { attack: 0.5, decay: 4.0, release: 3.0 },
                    volume: 0.7,
                });
            },
            garbageSend: () => {
                // Heavy, grounded push
                richTone({
                    oscillators: [{ type: 'square', freq: 60, gain: 0.2 }],
                    filter: {
                        type: 'lowpass', frequency: 150, envAmount: 300, Q: 1,
                    },
                    envelope: { attack: 0.05, decay: 0.4, release: 0.2 },
                    volume: 0.5,
                });
            },
        },
    };
}

/**
 * Sound effect player wrapper
 */
export class SoundEffectPlayer {
    constructor(soundSets, soundSet = 'Zen', createTone = null, createRichTone = null) {
        this.soundSets = soundSets;
        this.soundSet = soundSet;
        this.lastMoveSoundAt = -Infinity;
        this.moveSoundCooldownMs = 55;
        // Direct tone generators for new procedural effects (cascade, T-spin, B2B, perfect clear).
        // Injected by SoundManager so we don't need to duplicate them into every sound profile.
        this._createTone = createTone;
        this._createRichTone = createRichTone;
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
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (now - this.lastMoveSoundAt < this.moveSoundCooldownMs) {
            return;
        }

        this.lastMoveSoundAt = now;
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
     * Plays the line clear sound effect.
     * @param {number} [cascadeCount=1] - Current cascade depth (1 = manual clear).
     *   Values > 1 trigger an additional rising chime on top of the base clear sound.
     */
    playLineClear(cascadeCount = 1) {
        this.soundSets[this.soundSet].lineClear();
    }

    /**
     * Whole-tone pitch arpeggiation chime for cascade chains (Puyo-style).
     * Each cascade step goes up 2 semitones from a base of C5 (523 Hz).
     * Cascade 2 → C#5/Db5, 3 → D#5/Eb5, … growing brighter with depth.
     * @param {number} cascadeCount
     */
    playCascadeChime(cascadeCount) {
        if (!this._createTone) return;
        const semitones = (cascadeCount - 1) * 2; // 2 semitones per stage
        const pitchFactor = Math.pow(1.05946, semitones);
        const baseFreq = 523.25; // C5
        const freq = baseFreq * pitchFactor;
        // A short, bright bell tone that rises with each cascade.
        this._createTone(freq, 0.18, 'sine', Math.min(0.25 + cascadeCount * 0.04, 0.55));
        // Octave overtone for sparkle
        setTimeout(() => this._createTone(freq * 2, 0.12, 'triangle', 0.12), 40);
    }

    /**
     * Arpeggiated celebratory chord for perfect clears.
     * Plays across all 5 notes of a pentatonic scale starting from C4.
     */
    playPerfectClear() {
        if (!this._createTone) return;
        const pentatonic = [261.63, 293.66, 329.63, 392.00, 523.25]; // C4 pentatonic
        pentatonic.forEach((f, i) => {
            setTimeout(() => {
                this._createTone(f, 0.4, 'sine', 0.35);
                this._createTone(f * 2, 0.25, 'triangle', 0.15);
            }, i * 70);
        });
        // Final resolution chord: octave hit at 380ms
        setTimeout(() => this._createTone(523.25, 0.6, 'sine', 0.4), 380);
    }

    /**
     * Signature vortex spin sound for T-spin clears.
     * Rising-then-falling chirp to evoke the spin motion.
     */
    playTSpin() {
        if (!this._createTone) return;
        // Rising chirp
        [660, 784, 880].forEach((f, i) => {
            setTimeout(() => this._createTone(f, 0.1, 'triangle', 0.3), i * 35);
        });
        // Falling tail
        setTimeout(() => this._createTone(659, 0.15, 'sine', 0.2), 120);
    }

    /**
     * Charged energy hit for Back-to-Back difficult clears.
     * A short power-chord stab to punctuate the B2B bonus.
     */
    playB2B() {
        if (!this._createTone) return;
        // Quick double-hit: root + major third
        this._createTone(440, 0.15, 'square', 0.28);
        setTimeout(() => this._createTone(554, 0.12, 'square', 0.2), 30);
        // Decay shimmer
        setTimeout(() => this._createTone(880, 0.2, 'sine', 0.15), 80);
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

    /**
     * PHASE 3.4: Plays the garbage received sound effect (for multiplayer)
     */
    playGarbageReceived() {
        if (this.soundSets[this.soundSet].garbageReceived) {
            this.soundSets[this.soundSet].garbageReceived();
        } else {
            // Fallback to a lower-pitched version of garbage send
            this.soundSets[this.soundSet].garbageSend();
        }
    }

    /**
     * PHASE 3.4: Plays the garbage countered sound effect (for multiplayer)
     */
    playGarbageCountered() {
        if (this.soundSets[this.soundSet].garbageCountered) {
            this.soundSets[this.soundSet].garbageCountered();
        } else {
            // Fallback to line clear sound (defensive action)
            this.soundSets[this.soundSet].lineClear();
        }
    }

    /**
     * PHASE 3.4: Plays the player death sound effect (for multiplayer)
     */
    playPlayerDeath() {
        if (this.soundSets[this.soundSet].playerDeath) {
            this.soundSets[this.soundSet].playerDeath();
        } else {
            // Fallback to game over sound
            this.soundSets[this.soundSet].gameOver();
        }
    }
}
