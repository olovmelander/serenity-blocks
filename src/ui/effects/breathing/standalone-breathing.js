/**
 * Breathing on your own, wired into the game once: the guide, the worlds you may choose (the ones
 * you have found), the time that counts as practice (and can open the next world), and each
 * world's sound: its voice (the Voice switch) and the breath tone. main.js only starts it.
 */
import { initBreathingGuide } from './breathing-guide.js';
import { getBreathCollection } from './breath-collection-store.js';
import { announceBreathOpenings } from './breath-openings.js';
import { trackStandalonePractice } from './breath-practice.js';
import { startWorldVoice } from './world-voice.js';

/**
 * @param {{settingsManager?: {get: () => object}, cleanupHandlers?: Function[]}} app
 * @returns {object} the breathing guide
 */
export function startStandaloneBreathing(app) {
    const guide = initBreathingGuide();
    const breath = getBreathCollection();
    guide.canChoose = (id) => breath.isWorldOpen(id);
    const tracker = trackStandalonePractice({
        guide,
        onRecorded: () => announceBreathOpenings(breath.reconcile({ source: 'practice' })),
    });
    const setting = (name) => app?.settingsManager?.get?.()?.[name] !== false;
    const voice = startWorldVoice({ guide, isOn: () => setting('breathingVoice') });
    app?.cleanupHandlers?.push(() => {
        tracker.stop();
        voice.stop();
    });
    return guide;
}
