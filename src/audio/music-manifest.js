import { DEMO_TRACK_KEYS, filterSongsForBuild, IS_DEMO_MODE } from '../demo/demo-config.js';

function defineSong(name, file, extra = {}) {
    return {
        name,
        file,
        path: `./assets/music/${file}`,
        ...extra,
    };
}

function toTrackKey(name) {
    return String(name || '').replace(/\s+/g, '');
}

export const FULL_SONGS_MANIFEST = Object.freeze([
    defineSong('Aurora', 'aurora.mp3'),
    defineSong('Bioluminescence', 'bioluminescence.mp3'),
    defineSong('Blood Moon', 'blood-moon.mp3'),
    defineSong('Candlelit Monastery', 'candlelit-monastery.mp3'),
    defineSong('Cherry Blossom Garden', 'cherry-blossom-garden.mp3'),
    defineSong('Cinder Drift', 'cinder-drift.mp3'),
    defineSong('Cosmic Chimes', 'cosmic-chimes.mp3'),
    defineSong('Cosmic Noir', 'cosmic-noir.mp3'),
    defineSong('Crystal Cave', 'crystal-cave.mp3'),
    defineSong('Echoes of the Soul', 'echoes-of-the-soul.mp3'),
    defineSong('Electric Dreams', 'electric-dreams.mp3', {
        bpm: 96,
        phraseBeats: 16,
        energyCurve: [0.24, 0.58, 0.92],
    }),
    defineSong('Ethereal Echoes', 'ethereal-echoes.mp3'),
    defineSong('Falling Pieces', 'falling-pieces.mp3'),
    defineSong('Floating Islands', 'floating-islands.mp3'),
    defineSong('Fluid Dreams', 'fluid-dreams.mp3'),
    defineSong('Galaxy', 'galaxy.mp3'),
    defineSong('Geode Crystalline', 'geode-crystalline.mp3'),
    defineSong('Himalayan Peak', 'himalayan-peak.mp3'),
    defineSong('Ice Temple', 'ice-temple.mp3'),
    defineSong('Lunara', 'lunara.mp3'),
    defineSong('Meditation Temple', 'meditation-temple.mp3'),
    defineSong('Misty Lake', 'misty-lake.mp3'),
    defineSong('Moonlit Forest', 'moonlit-forest.mp3'),
    defineSong('Moonlit Greenhouse', 'moonlit-greenhouse.mp3'),
    defineSong('Neon District', 'neon-district.mp3'),
    defineSong('Neon Dusk', 'neon-dusk.mp3'),
    defineSong('Ocean Deep', 'ocean-deep.mp3'),
    defineSong('Rainy Window', 'rainy-window.mp3'),
    defineSong('Shifting Sands', 'shifting-sands.mp3'),
    defineSong('Starlight', 'starlight.mp3'),
    defineSong('Stellar Drift', 'stellar-drift.mp3'),
    defineSong('Stillwater', 'stillwater.mp3'),
    defineSong('Waves', 'waves.mp3'),
    defineSong('Wolfhour', 'wolfhour.mp3'),
    defineSong('Black Hole', 'black-hole.mp3'),
    defineSong('Aether Tides', 'aether-tides.mp3'),
]);

export const DEMO_SONGS_MANIFEST = Object.freeze(
    filterSongsForBuild(FULL_SONGS_MANIFEST),
);

export const ACTIVE_SONGS_MANIFEST = Object.freeze(
    IS_DEMO_MODE ? DEMO_SONGS_MANIFEST : FULL_SONGS_MANIFEST,
);

export function getMusicManifest() {
    return ACTIVE_SONGS_MANIFEST.map((song) => ({ ...song }));
}

export function getAllowedTrackKeys() {
    return IS_DEMO_MODE ? [...DEMO_TRACK_KEYS] : FULL_SONGS_MANIFEST.map((song) => toTrackKey(song.name));
}
