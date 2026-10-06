/**
 * @fileoverview Keystone main-menu list micro-interactions.
 *
 * Two desktop "feel" layers on top of public/styles/keystone-menu.css:
 *   1. Cursor-follow light  → writes --spotlight-x / --spotlight-y (px from the
 *                             item's centre), read by the current item's wash
 *   2. Audio juice          → warm, soft tonal cues (eased-in sine bodies,
 *                             low-passed, no transient/click): a gentle hum
 *                             on hover, a soft warm "bloom" on select —
 *                             synthesised on the shared AudioContext
 *                             (respects SFX volume + mute, no audio files).
 *
 * It only sets CSS custom properties — never `transform` — so it can't fight the
 * entrance animations. Skips Steam-gated (disabled) items.
 * Self-initialises on the `start` modal.
 */

/* ---- Audio juice ----------------------------------------------------------- */
// Professional, restrained UI sound design — the kind of crisp-but-warm feedback
// you hear in premium AAA/console menus. Each cue is TWO layered elements:
//   • a short filtered-noise TRANSIENT — the tactile "touch" (a soft tick/click)
//   • a brief warm TONAL body          — gives it pitch + weight, not just a click
// Soft attacks (no harsh pop), tight tails (snappy, never droney). Hover is a
// light, quiet tick; confirm is fuller with a subtle UPWARD pitch inflection that
// reads as confident/positive, plus a low sine "thump" for body.
//
// Per-mode base pitch keeps each card's own colour. Synthesised on the shared
// AudioContext; respects the SoundManager's mute + SFX volume. No audio files.
const HOVER_NOTE = {
    single: 523.25, // C5 — cyan
    'local-multiplayer': 587.33, // D5 — violet
    'online-multiplayer': 659.25, // E5 — teal
    serenity: 698.46, // F5 — rose
    infinity: 783.99, // G5 — indigo
    odyssey: 880.0, // A5 — gold
    hale: 698.46, // F5 — shares Serenity's note: both breathe
};

let lastHoverAt = 0;
let lastConfirmAt = 0;

function getSound() {
    return (typeof window !== 'undefined' && window.__serenitySoundManager) || null;
}

// Soft warm tone — pure/triangle sine with an eased fade-in and a long gentle
// tail. Optional small pitch glide. No transients/noise: warmth, not click.
function playBody(ctx, bus, {
    startFreq, endFreq = startFreq, type = 'sine', attack, decay, gain,
}) {
    const now = ctx.currentTime;
    const releaseVoice = bus.retainVoice();
    let osc;
    let g;
    let released = false;
    const cleanup = () => {
        if (released) return;
        released = true;
        if (osc) {
            osc.onended = null;
            osc.disconnect();
        }
        g?.disconnect();
        releaseVoice();
    };
    try {
        osc = ctx.createOscillator();
        g = ctx.createGain();
        osc.onended = cleanup;
        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, now);
        if (endFreq !== startFreq) {
            osc.frequency.exponentialRampToValueAtTime(endFreq, now + decay);
        }
        g.gain.setValueAtTime(0.0001, now);
        // Gentle eased swell in, then a smooth exponential tail out.
        g.gain.linearRampToValueAtTime(gain, now + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
        osc.connect(g);
        g.connect(bus.input);
        osc.start(now);
        osc.stop(now + decay + 0.05);
    } catch (error) {
        cleanup();
        throw error;
    }
}

// Master bus for one cue: warm low-pass to round off the highs, master volume.
function cueBus(ctx, { cutoff, volume }) {
    const sound = getSound();
    const sfx = typeof sound?.getSfxVolume === 'function' ? sound.getSfxVolume() : 1;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.3;
    const master = ctx.createGain();
    master.gain.value = volume * sfx;
    filter.connect(master);
    master.connect(ctx.destination);
    let activeVoices = 0;
    return {
        input: filter,
        retainVoice() {
            activeVoices += 1;
            return () => {
                activeVoices -= 1;
                if (activeVoices === 0) {
                    filter.disconnect();
                    master.disconnect();
                }
            };
        },
    };
}

function playHover(card) {
    const sound = getSound();
    const ctx = sound?.audioContext;
    if (!ctx || sound.isMuted) return;
    // Throttle: rapid pointer sweeps across cards shouldn't machine-gun.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastHoverAt < 80) return;
    lastHoverAt = now;
    if (ctx.state === 'suspended') ctx.resume?.();

    const freq = HOVER_NOTE[card.dataset.mode] || 659.25;
    try {
        const bus = cueBus(ctx, { cutoff: 2200, volume: 0.14 });
        // Warm round tone + a faint soft fifth above for a gentle shimmer — no tick.
        playBody(ctx, bus, {
            startFreq: freq, type: 'sine', attack: 0.03, decay: 0.26, gain: 0.34,
        });
        playBody(ctx, bus, {
            startFreq: freq * 1.5, type: 'sine', attack: 0.045, decay: 0.18, gain: 0.08,
        });
    } catch { /* audio not ready / suspended — silent */ }
}

function playConfirm(card) {
    const sound = getSound();
    const ctx = sound?.audioContext;
    if (!ctx || sound.isMuted) return;
    // De-dupe: keyboard activation fires keydown AND a synthetic click.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastConfirmAt < 120) return;
    lastConfirmAt = now;
    if (ctx.state === 'suspended') ctx.resume?.();

    const freq = HOVER_NOTE[card?.dataset?.mode] || 523.25;
    try {
        const bus = cueBus(ctx, { cutoff: 2600, volume: 0.24 });
        // Soft warm "bloom": a rounded body that lifts a touch in pitch (gentle,
        // confident) over a mellow sine an octave down for warmth — no transient.
        playBody(ctx, bus, {
            startFreq: freq * 0.96, endFreq: freq * 1.04, type: 'sine', attack: 0.025, decay: 0.42, gain: 0.4,
        });
        playBody(ctx, bus, {
            startFreq: freq / 2, type: 'sine', attack: 0.03, decay: 0.5, gain: 0.42,
        });
    } catch { /* silent */ }
}

/* ---- Pointer light ----------------------------------------------------------- */
function bindCard(card) {
    if (card.__csInteractive || card.classList.contains('steam-disabled')) {
        return;
    }
    card.__csInteractive = true;

    let rect = null;
    let frame = 0;
    let pending = null;

    const refresh = () => { rect = card.getBoundingClientRect(); };

    const apply = () => {
        frame = 0;
        if (!pending || !rect || document.body.classList.contains('start-modal-covered')) return;
        const { px, py } = pending;
        card.style.setProperty('--spotlight-x', `${((px - 0.5) * rect.width).toFixed(1)}px`);
        card.style.setProperty('--spotlight-y', `${((py - 0.5) * rect.height).toFixed(1)}px`);
    };

    const onMove = (event) => {
        if (document.body.classList.contains('start-modal-covered')) return;
        if (!rect) refresh();
        const px = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
        const py = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
        pending = { px, py };
        if (!frame) frame = requestAnimationFrame(apply);
    };

    const reset = () => {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        rect = null;
        pending = null;
        card.style.setProperty('--spotlight-x', '0px');
        card.style.setProperty('--spotlight-y', '0px');
    };

    card.addEventListener('pointerenter', () => { refresh(); playHover(card); });
    card.addEventListener('pointermove', onMove, { passive: true });
    card.addEventListener('pointerleave', reset);
    card.addEventListener('blur', reset);

    // Keyboard / gamepad focus also gets the hover blip (focus = navigation cue).
    card.addEventListener('focus', () => playHover(card));
    // Confirm chime on activation. Pointer and gamepad-A fire `click`; keyboard
    // Enter/Space are handled separately below because a <div> never emits click
    // for them (the actual mode launch is wired in game-mode-ui.js).
    card.addEventListener('click', () => playConfirm(card));
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') playConfirm(card);
    });

    card.__csReset = reset;
}

export function initMenuCardInteractions() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#start-modal .game-mode-card').forEach(bindCard);
}

if (typeof window !== 'undefined') {
    window.addEventListener('modalShown', (event) => {
        if (event?.detail?.modalName === 'start') initMenuCardInteractions();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMenuCardInteractions, { once: true });
    } else {
        initMenuCardInteractions();
    }
}
