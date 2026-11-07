/* eslint-disable no-restricted-globals -- `self` is the Worker global scope */
/**
 * Web Worker entry: renders the launch sounds (launch-sounds.js) off the page's thread, so the
 * boot warp's reveal never waits on them (SoundManager.prewarmLaunchSounds). Answers
 * { name, sampleRate } with { name, rendered } (its channel buffers transferred; null if unknown).
 */
import { renderLaunchSound } from './launch-sounds.js';

self.onmessage = (event) => {
    const { name, sampleRate } = event?.data || {};
    let rendered = null;
    try {
        rendered = renderLaunchSound(name, sampleRate);
    } catch {
        rendered = null;
    }
    self.postMessage({ name, rendered }, rendered ? rendered.channels.map((channel) => channel.buffer) : []);
};
