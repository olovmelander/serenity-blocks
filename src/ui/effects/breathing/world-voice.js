/**
 * The breathing voice of a stand-alone practice: the Breathing tab's Voice switch (setting
 * `breathingVoice`). As a world begins, the voice introduces it ('worlds/<id>_intro'); on the
 * first few breaths it says the world's own cue words ('worlds/<id>_in', '_out'), then lets you
 * breathe, with the words again now and then. Fewer words, deeper.
 *
 * Silent while a Hale session drives the guide (the session has its own voice), while the switch
 * is off, and for any line not recorded yet: the guide's words are on screen regardless. The
 * audio code loads on first use, not at boot, and follows the game's mute and effects volume.
 */
import { isBreathWorld } from './breath-catalogue.js';

/** Cue words on this many breaths after the introduction... */
export const GUIDED_BREATHS = 3;
/** ...then on one breath in this many. */
export const CUE_EVERY = 10;
/** A phase shorter than this has no room for words. */
export const MIN_CUE_SECONDS = 3;
/** The world appears before the voice begins. */
export const INTRO_DELAY_MS = 1500;

async function loadVoice() {
    const [{ BreathworkAudioManager }, { recordedVoiceFile }] = await Promise.all([
        import('../breathwork-audio-manager.js'),
        import('../breathwork-recorded-voices.js'),
    ]);
    return new BreathworkAudioManager({ resolveClip: recordedVoiceFile });
}

/**
 * @param {object} options
 * @param {object} options.guide the breathing guide (window.breathingIndicator)
 * @param {() => boolean} [options.isOn] whether the Voice switch is on
 * @param {() => Promise<object>|object} [options.createVoice] the audio (a BreathworkAudioManager)
 * @param {EventTarget} [options.target] where the guide and the settings announce changes
 * @returns {{refresh: () => void, stop: () => void}}
 */
export function startWorldVoice({
    guide,
    isOn = () => true,
    createVoice = loadVoice,
    target = globalThis.window,
    later = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
} = {}) {
    let voice = null;
    let loading = null;
    let timer = null;
    let world = null;
    let introduced = false;
    let breaths = 0;
    let generation = 0;
    let stopped = false;

    const speaking = () => !stopped && Boolean(guide?.isActive) && !guide.isExternallyControlled && isOn();
    const ensureVoice = () => {
        if (voice) return Promise.resolve(voice);
        loading = loading || Promise.resolve()
            .then(() => createVoice())
            .then((made) => {
                voice = made;
                return voice;
            })
            .catch((error) => {
                console.warn('[WorldVoice] voice unavailable:', error?.message || error);
                return null;
            });
        return loading;
    };
    const silence = () => {
        generation += 1;
        if (timer !== null) cancel(timer);
        timer = null;
        world = null;
        introduced = false;
        voice?.stopAll();
    };

    /** Voice the world the guide is in now, or nothing; a world already voiced carries on. */
    const refresh = () => {
        const id = speaking() ? guide.currentTechnique : null;
        if (id && id === world) return;
        silence();
        if (!id || !isBreathWorld(id)) return;
        world = id;
        breaths = 0;
        const mine = generation;
        timer = later(() => {
            timer = null;
            ensureVoice().then((ready) => {
                if (!ready || mine !== generation || !speaking()) return;
                ready.setEnabled(true);
                ready.playVoiceWithCallback(`worlds/${id}_intro`, () => {
                    if (mine === generation) introduced = true;
                });
            });
        }, INTRO_DELAY_MS);
    };

    const onPhase = (phase) => {
        if (!speaking() || guide.currentTechnique !== world) {
            if (world) refresh();
            return;
        }
        if (!introduced) return;
        if (phase === 'inhale') breaths += 1;
        if (breaths > GUIDED_BREATHS && breaths % CUE_EVERY !== 0) return;
        const part = { inhale: ['in', 0], exhale: ['out', 2] }[phase];
        if (!part || !(Number(guide.pattern?.[part[1]]) >= MIN_CUE_SECONDS)) return;
        voice?.playCue(`worlds/${world}_${part[0]}`);
    };

    const onSettings = (event) => {
        if (event?.detail && Object.prototype.hasOwnProperty.call(event.detail, 'breathingVoice')) refresh();
    };
    const events = [['breathingGuideChange', refresh], ['breathingTechniqueChange', refresh], ['settingsChanged', onSettings]];
    events.forEach(([type, handler]) => target?.addEventListener?.(type, handler));
    const unfollow = guide?.onPhase?.(onPhase) || (() => {});
    refresh();

    return {
        refresh,
        stop: () => {
            if (stopped) return;
            silence();
            stopped = true;
            unfollow();
            events.forEach(([type, handler]) => target?.removeEventListener?.(type, handler));
            voice?.destroy?.();
            voice = null;
        },
    };
}
