/**
 * The sound of a stand-alone practice: the Breathing tab's Voice and Breath tones switches
 * (settings `breathingVoice`, `breathingTones`).
 *
 * The voice: as a world begins it introduces it ('worlds/<id>_intro'); on the first few breaths
 * it says the world's cue words on every part of the breath that has room for them: a couplet
 * for the breath in and out (the world's own first, 'worlds/<id>_in' and '_out', then its
 * others, '_in_2' ...), and its words for the hold and the rest ('_hold', '_rest'). Never the
 * same take twice running, and the guide shows the words spoken. Then it lets you breathe, with
 * words again now and then. Fewer words, deeper.
 *
 * The tones: the soft rising tone on the breath in and falling tone on the breath out that a
 * Hale session has, in every world, whenever the voice is not speaking on that breath.
 *
 * Silent while a Hale session drives the guide (the session has its own voice and tones), while
 * a switch is off, and for any line not recorded yet: the guide's words are on screen
 * regardless. The audio code loads on first use, not at boot, and follows the game's mute and
 * effects volume.
 */
import { isBreathWorld, worldCuePairs, worldPauseCues } from './breath-catalogue.js';
import { createCueDraw, drawTake, roomForWords } from './cue-variety.js';

/** Cue words on this many breaths after the introduction... */
export const GUIDED_BREATHS = 3;
/** ...then on one breath in this many. */
export const CUE_EVERY = 10;
/** A part of the breath shorter than this has no tone either. */
export const MIN_TONE_SECONDS = 1;
/** The world appears before the voice begins. */
export const INTRO_DELAY_MS = 1500;

/** The four parts of a breath, in the order of a pattern: the cue each one takes. */
const PARTS = Object.freeze({
    inhale: ['in', 0], hold1: ['hold', 1], exhale: ['out', 2], hold2: ['rest', 3],
});

async function loadVoice() {
    const [{ BreathworkAudioManager }, { recordedVoiceFile, recordedVoiceSeconds }] = await Promise.all([
        import('../breathwork-audio-manager.js'),
        import('../breathwork-recorded-voices.js'),
    ]);
    return new BreathworkAudioManager({ resolveClip: recordedVoiceFile, clipSeconds: recordedVoiceSeconds });
}

async function loadChimes() {
    const { BreathworkChimes } = await import('../breathwork-chimes.js');
    return new BreathworkChimes();
}

/**
 * @param {object} options
 * @param {object} options.guide the breathing guide (window.breathingIndicator)
 * @param {() => boolean} [options.isOn] whether the Voice switch is on
 * @param {() => boolean} [options.tonesOn] whether the Breath tones switch is on
 * @param {() => Promise<object>|object} [options.createVoice] the audio (a BreathworkAudioManager)
 * @param {() => Promise<object>|object} [options.createChimes] the tones (a BreathworkChimes)
 * @param {EventTarget} [options.target] where the guide and the settings announce changes
 * @param {() => number} [options.random] picks among a cue's takes
 * @returns {{refresh: () => void, stop: () => void}}
 */
export function startWorldVoice({
    guide,
    isOn = () => true,
    tonesOn = () => false,
    createVoice = loadVoice,
    createChimes = loadChimes,
    target = globalThis.window,
    later = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    random = Math.random,
} = {}) {
    let voice = null;
    let loading = null;
    let voiceFailed = false;
    let chimes = null;
    let chimesLoading = null;
    let timer = null;
    let world = null;
    let introduced = false;
    let breaths = 0;
    let couplet = null;
    let generation = 0;
    let stopped = false;
    const draw = createCueDraw(random);

    const practising = () => !stopped && Boolean(guide?.isActive) && !guide.isExternallyControlled;
    const speaking = () => practising() && isOn();
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
                voiceFailed = true;
                return null;
            });
        return loading;
    };
    /** The tones, loaded on first use; a practice begins from a click, so the audio may wake. */
    const ensureChimes = () => {
        if (chimes) chimes.prime?.();
        if (chimes || chimesLoading) return;
        chimesLoading = Promise.resolve()
            .then(() => createChimes())
            .then((made) => {
                if (stopped) return;
                chimes = made;
                chimes.prime?.();
            })
            .catch((error) => console.warn('[WorldVoice] tones unavailable:', error?.message || error));
    };
    const silence = () => {
        generation += 1;
        if (timer !== null) cancel(timer);
        timer = null;
        world = null;
        introduced = false;
        couplet = null;
        voice?.stopAll();
    };

    /** Voice the world the guide is in now, or nothing; a world already voiced carries on. */
    const refresh = () => {
        if (practising() && tonesOn()) ensureChimes();
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

    /**
     * The take for one part of this breath, if the part has room for one. A breath keeps one
     * couplet (its out-breath answers its in-breath); the first breath says the world's own.
     */
    const takeFor = (part, seconds) => {
        const fits = (id) => Boolean(id) && (voice?.fits ? voice.fits(id, seconds) : true);
        if (part === 'hold' || part === 'rest') return drawTake(draw, worldPauseCues(world)[part], fits);
        if (!couplet || couplet.breath !== breaths) {
            const pairs = worldCuePairs(world).filter((pair) => fits(pair[part]));
            const id = draw(`worlds/${world}`, pairs.map((pair) => pair.in), breaths <= 1 ? pairs[0]?.in : null);
            const pair = pairs.find((candidate) => candidate.in === id);
            couplet = pair ? { breath: breaths, ...pair } : null;
        }
        if (!couplet || !fits(couplet[part])) return null;
        return { id: couplet[part], words: couplet.words[part === 'in' ? 0 : 1] };
    };

    /** @returns {boolean} whether the voice spoke on this part of the breath */
    const speak = (phase) => {
        if (!speaking() || guide.currentTechnique !== world) {
            if (world) refresh();
            return false;
        }
        if (!introduced) return false;
        if (phase === 'inhale') breaths += 1;
        if (breaths > GUIDED_BREATHS && breaths % CUE_EVERY !== 0) return false;
        const [part, index] = PARTS[phase] || [];
        const seconds = Number(guide.pattern?.[index]) || 0;
        if (!part || !roomForWords(part, seconds)) return false;
        const take = takeFor(part, seconds);
        if (!take) return false;
        guide.setCueWords?.({ [part]: take.words });
        voice?.playCue(take.id);
        return true;
    };

    /** The breath tone, on a breath the voice leaves quiet (and not over a world's introduction). */
    const tone = (phase) => {
        if (!practising() || !tonesOn() || (phase !== 'inhale' && phase !== 'exhale')) return;
        if (!chimes) {
            ensureChimes();
            return;
        }
        if (world && !introduced && !voiceFailed) return;
        const seconds = Number(guide.pattern?.[phase === 'inhale' ? 0 : 2]) || 0;
        chimes.tone(phase === 'inhale' ? 'in' : 'out', seconds, { minSeconds: MIN_TONE_SECONDS });
    };

    const onPhase = (phase) => {
        if (!speak(phase)) tone(phase);
    };

    const onSettings = (event) => {
        const changed = (name) => event?.detail && Object.prototype.hasOwnProperty.call(event.detail, name);
        if (changed('breathingVoice')) refresh();
        if (changed('breathingTones') && !tonesOn()) chimes?.silence?.();
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
            chimes?.silence?.();
            chimes = null;
        },
    };
}
