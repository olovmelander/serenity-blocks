/**
 * Everything Serenity Mode puts on screen and keeps running beside the theme, in one place:
 * the world bar and its arrows, Drift, the rest timer and its veil, touching the world, the
 * effects tray, short notices, the first-visit key hints, the screen wake lock and the media
 * keys.
 *
 * SerenityMode (src/core/game-modes/SerenityMode.js) owns the lifecycle and the key map and
 * calls in here; this module owns the DOM, so the mode stays free of it. Record:
 * docs/SERENITY_MODE_DRIFT_2026-10.md.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { THEME_MUSIC_CATALOG, resolveMusicTrackKey } from '../../core/progression/theme-music-catalog.js';
import { describeKey } from '../settings.js';
import { resolveHubThemeThumbnailUrl } from '../serenity-hub/theme-thumbnail-manifest.js';
import { getThemeMeta } from '../../themes/theme-registry.js';
import { CATEGORY_LABELS } from '../serenity-hub/ThemesTab.js';
import { SerenityWorldBar } from './serenity-world-bar.js';
import { knownAccent, themeAccent } from './serenity-theme-accent.js';
import { SerenityWorldStepper, saveThemeChoice, themeName } from './serenity-world-stepper.js';
import { SerenityDrift } from './serenity-drift.js';
import {
    DEFAULT_DRIFT_PACE, driftOption, nextDriftOption, nextRestOption, normalizeDrift, normalizeDriftPace,
    restChipLabel,
} from './serenity-options.js';
import { REST_FADE_MS, SerenityRestTimer } from './serenity-rest.js';
import { SerenityRestVeil } from './serenity-rest-veil.js';
import { SerenityTouch } from './serenity-touch.js';
import { SerenityEffects } from './serenity-effects.js';
import { SerenityEffectsTray } from './serenity-effects-tray.js';
import {
    hideSerenityNotice, showFirstHints, showSerenityNotice, takeHintVisit,
} from './serenity-notice.js';
import { ScreenWakeLock } from './serenity-wake-lock.js';
import { SerenityMediaSession } from './serenity-media-session.js';

const HINT_DELAY_MS = 1600;
/** The mode's loading veil can stay a while (a theme seen for the first time): wait for it. */
const LOADING_WAIT_MS = 500;
const LOADING_WAIT_TRIES = 60;
const SONG_TITLES = new Map(THEME_MUSIC_CATALOG.map((song) => [song.trackKey, song]));

/** @param {string|null|undefined} trackKey @returns {{title: string, themeId: string}|null} */
export function songOf(trackKey) {
    const song = trackKey ? SONG_TITLES.get(resolveMusicTrackKey(trackKey)) : null;
    return song ? { title: song.name, themeId: song.themeId } : null;
}

const keycap = (key) => describeKey(key).text;

export class SerenityModeUi {
    /** @param {any} mode the SerenityMode instance (its deps, hub and key bindings) */
    constructor(mode) {
        this.mode = mode;
        this.deps = mode.deps || {};
        this.bar = null;
        this.touch = null;
        this.effects = null;
        this.effectsTray = null;
        /** Where Play all has got to, while it runs. @type {{index: number, total: number}|null} */
        this.effectsTour = null;
        this.resting = false;
        this.restAsleep = false;
        this.restTimer = null;
        this.listeners = [];
        this.hintTimer = null;
        this.removeHints = null;
        this.restCoveredTheme = false;
        this.lastDriftPace = DEFAULT_DRIFT_PACE;
    }

    get settings() {
        return this.deps.settingsManager?.get?.() || {};
    }

    get guide() {
        return typeof window !== 'undefined' ? window.breathingIndicator || null : null;
    }

    get hubOpen() {
        return this.mode.serenityHub?.isOpen === true;
    }

    /** A Hale session, or its full-screen preparation, countdown or result, has the screen. */
    get sessionHolds() {
        return this.mode.serenityHub?.sessionsTab?.holdsScreen === true;
    }

    /** Whether the theme is what is on screen (nothing covers it and the mode is running). */
    get worldVisible() {
        const { guide } = this;
        const guideCovers = Boolean(guide?.isActive) && !guide?.isOverTheme;
        return Boolean(this.mode.isRunning) && !this.hubOpen && !guideCovers && !this.resting && !this.sessionHolds;
    }

    start() {
        const { themeManager, settingsManager } = this.deps;
        this.stepper = new SerenityWorldStepper({
            themeManager,
            settingsManager,
            onPreview: () => this.refresh({ announce: true }),
            onSettled: (_theme, ok) => {
                if (!ok) showSerenityNotice('That theme could not open');
                // A theme seen for the first time can take a few seconds to build: say it arrived.
                this.refresh({ announce: true });
            },
            onAlone: () => this.sayAlone(),
        });
        this.bar = new SerenityWorldBar({
            onStep: (direction) => this.stepWorld(direction),
            onDrift: () => this.setDrift(nextDriftOption(this.drift.pace)),
            onRest: () => this.setRest(nextRestOption(this.restTimer.minutes)),
            onEffects: () => this.toggleEffects(),
            onStopEffects: () => this.stopEffects(),
            onSkipEffects: (direction) => this.effects?.skip(direction),
        });
        this.drift = new SerenityDrift({
            activeTheme: () => themeManager?.activeThemeName || null,
            pickNextTheme: () => themeManager?.getRandomTheme?.() || null,
            themeForTrack: (trackKey) => songOf(trackKey)?.themeId || null,
            canUse: (id) => themeManager?.canSelectTheme?.(id) !== false
                && themeManager?.isThemeUnlocked?.(id) !== false,
            applyTheme: (id) => {
                // A Hale session's screens do not change world under it; drift tries again later.
                if (this.sessionHolds) return;
                Promise.resolve(themeManager?.switchTheme?.(id)).catch((error) => {
                    console.warn('[Serenity] Drift could not open a theme:', error);
                });
            },
        });
        this.restTimer = new SerenityRestTimer({ onEnd: () => this.beginRest() });
        this.restVeil = new SerenityRestVeil();
        this.touch = new SerenityTouch({
            isLive: () => this.worldVisible,
            onSwipe: (direction) => this.stepWorld(direction),
            onTouch: () => this.bar?.wake(),
        });
        this.effects = new SerenityEffects({
            colorFor: (shapeKey) => this.pieceColor(shapeKey),
            onChange: (state) => {
                if (!state.touring) this.effectsTour = null;
                this.effectsTray?.setState(state);
                this._holdForEffects();
                this.refresh();
            },
            onTourStep: (effect, index, total) => {
                // The dock counts ("Effects · 6 of 16"); the notice names the effect.
                this.effectsTour = { index, total };
                showSerenityNotice(effect.name, 3200);
            },
            onTourDone: () => showSerenityNotice('Every effect played'),
        });
        this.effectsTray = new SerenityEffectsTray({
            onPlay: (id) => this.playEffect(id),
            onPlayAll: () => this.playAllEffects(),
            onClose: () => this.closeEffects(),
            onStop: () => this.stopEffects(),
            keys: {
                effects: keycap(this.mode.keyFor('toggleEffects')),
                previous: keycap(this.mode.keyFor('previousTheme')),
                next: keycap(this.mode.keyFor('nextTheme')),
            },
        });
        this.wakeLock = new ScreenWakeLock();
        this.wakeLock.acquire();
        this.media = new SerenityMediaSession({
            play: () => this.setPlayback(true),
            pause: () => this.setPlayback(false),
            next: () => this.stepSong(1),
            previous: () => this.stepSong(-1),
        });
        this.media.start();

        const saved = normalizeDrift(this.settings.serenityDrift);
        this.lastDriftPace = normalizeDriftPace(this.settings.serenityDriftPace || saved);
        this.drift.setPace(saved);
        // Known after the pace: entering the mode does not move away from the theme it opened on.
        this.drift.lastTrack = this.deps.soundManager?.musicTrack || null;
        this._listen();
        this.syncCover();
        this.refresh();
        this.describeSong();
        this._whenWorldShows(0);
    }

    /**
     * Once the mode's loading veil has gone, name the world you arrived in, and on the first
     * visits show the keys.
     */
    _whenWorldShows(tries) {
        this.hintTimer = setTimeout(() => {
            this.hintTimer = null;
            if (document.getElementById('cinematic-loading-overlay') && tries < LOADING_WAIT_TRIES) {
                this._whenWorldShows(tries + 1);
                return;
            }
            if (!this.worldVisible) return;
            this.bar?.announce();
            // Effects opened this early have the bottom of the screen: the keys wait for a visit.
            const effectsBusy = this.effectsOpen || Boolean(this.effects?.touring);
            if (!effectsBusy && takeHintVisit()) this.removeHints = showFirstHints(this.hintItems());
        }, tries === 0 ? HINT_DELAY_MS : LOADING_WAIT_MS);
    }

    stop() {
        if (this.hintTimer !== null) clearTimeout(this.hintTimer);
        this.hintTimer = null;
        this.removeHints?.();
        this.removeHints = null;
        if (this.resting) this.wakeFromRest({ quiet: true });
        this.listeners.forEach((off) => off());
        this.listeners = [];
        this.stepper?.cancel();
        this.drift?.destroy();
        this.restTimer?.cancel();
        this.restVeil?.destroy();
        this.touch?.destroy();
        this.touch = null;
        this.effects?.destroy();
        this.effects = null;
        this.effectsTray?.destroy();
        this.effectsTray = null;
        this.bar?.destroy();
        this.bar = null;
        this.wakeLock?.release();
        this.media?.stop();
        hideSerenityNotice();
        document.documentElement.style.removeProperty('--serenity-accent');
    }

    _listen() {
        const on = (target, type, handler) => {
            target.addEventListener(type, handler);
            this.listeners.push(() => target.removeEventListener(type, handler));
        };
        this.listeners.push(eventBus.on(EVENTS.THEME_CHANGED, () => {
            this.drift.noteThemeChanged();
            this.refresh({ announce: !this.stepper.target });
            this.describeSong();
        }));
        on(window, 'musicTrackChanged', (event) => {
            const trackKey = event.detail?.trackName || this.deps.soundManager?.musicTrack;
            this.drift.noteTrackChanged(trackKey);
            this.refresh({ announce: true });
            this.describeSong();
            const song = songOf(trackKey);
            if (song && !this.worldVisible && !this.hubOpen && !this.resting) showSerenityNotice(`♪ ${song.title}`);
        });
        on(window, 'serenityHubVisibilityChange', () => this.syncCover());
        on(window, 'breathingGuideChange', () => this.syncCover());
        on(window, 'breathingPresentationChange', () => this.syncCover());
    }

    /** The bar steps aside, and drift waits, whenever something else has the screen. */
    syncCover() {
        if (!this.bar) return;
        const { guide } = this;
        const guideActive = Boolean(guide?.isActive);
        this.bar.setCovered(this.hubOpen || guideActive || this.resting);
        // The tray steps aside with the bar, and what it was playing ends.
        const effectsCovered = this.hubOpen || guideActive || this.resting || this.sessionHolds;
        this.effectsTray?.setCovered(effectsCovered);
        if (effectsCovered) this.effects?.stop();
        if (this.hubOpen) this.drift.hold('hub');
        else this.drift.release('hub');
        // Breathing over the theme leaves the world to drift; its own world or a session covers it.
        if (guideActive && (!guide.isOverTheme || guide.isExternallyControlled)) this.drift.hold('breathing');
        else this.drift.release('breathing');
        if (this.hubOpen || guideActive) this.removeHints?.();
    }

    /** @param {{announce?: boolean}} [options] */
    refresh({ announce = false } = {}) {
        if (!this.bar) return;
        const { themeManager, soundManager } = this.deps;
        const shown = this.stepper.target || themeManager?.activeThemeName || null;
        const { index, total } = this.stepper.position(shown);
        const drift = driftOption(this.drift.pace);
        const restLeft = this.restTimer.msLeft;
        const accent = this.accentFor(shown);
        this.lastRefreshAt = Date.now();
        this.bar.update({
            name: themeName(shown),
            group: CATEGORY_LABELS[getThemeMeta(shown)?.group] || '',
            index,
            total,
            accent,
            driftFill: this.driftFill(),
            song: songOf(soundManager?.musicTrack)?.title || '',
            driftChip: drift.chip,
            driftLabel: `Drift between themes: ${drift.label.toLowerCase()}`,
            restChip: restChipLabel(restLeft),
            restLabel: restLeft > 0
                ? `Rest timer: ${restChipLabel(restLeft).replace('Rest · ', '')}` : 'Rest timer: off',
            arriving: Boolean(this.stepper.target) || Boolean(themeManager?.isTransitioning),
            effectsOpen: this.effectsOpen,
            effectsTour: this.effectsTour,
        });
        this.effectsTray?.setTheme(themeName(shown));
        this.effectsTray?.setNote(this.effectsNote());
        if (announce) this.bar.announce();
    }

    /**
     * The theme's own light (from its artwork, worked out once): known at once when it has been
     * seen, its category's hue until then. Also lent to the notices, the tray and the overlays.
     */
    accentFor(themeId) {
        const accent = knownAccent(themeId);
        document.documentElement.style.setProperty('--serenity-accent', accent.join(', '));
        if (themeId && themeId !== this.accentPending) {
            this.accentPending = themeId;
            themeAccent(themeId).then((rgb) => {
                const shown = this.stepper?.target || this.deps.themeManager?.activeThemeName;
                if (this.bar && shown === themeId && rgb.join() !== accent.join()) this.refresh();
            });
        }
        return accent;
    }

    /**
     * How far the world has come toward its next drift: with the music, the song's own progress
     * while it plays; otherwise drift's clock. Null when it does not drift (or waits).
     */
    driftFill() {
        if (this.drift.pace === 'music') {
            const audio = this.deps.soundManager?.audioElement;
            const { duration, currentTime } = audio || {};
            if (audio && !audio.paused && !this.deps.soundManager?.isMuted && Number.isFinite(duration) && duration > 0
                && !this.drift.isHeld) {
                return { from: currentTime / duration, ms: (duration - currentTime) * 1000 };
            }
        }
        return this.drift.progress();
    }

    describeSong() {
        const song = songOf(this.deps.soundManager?.musicTrack);
        if (song) this.media?.describe({ title: song.title, artwork: resolveHubThemeThumbnailUrl(song.themeId) || '' });
    }

    /** The pointer moved: the caption is there for a while (and says where drift has got to). */
    activity() {
        if (!this.worldVisible) return;
        if (Date.now() - (this.lastRefreshAt || 0) > 2000) this.refresh();
        this.bar?.wake();
    }

    sayAlone() {
        showSerenityNotice('Your only theme so far · the Odyssey brings more home');
        this.bar?.announce();
    }

    // ── The world ───────────────────────────────────────────────────────────────────────

    /** Previous (-1) or next (1) theme: the arrows, ← →, a swipe, the D-pad. */
    stepWorld(direction) {
        if (this.wakeFromRest()) return;
        this.stepper.step(direction < 0 ? -1 : 1);
    }

    /** B: a theme from the shuffle deck, kept as your choice like a pick in the Hub. */
    async randomWorld() {
        if (this.wakeFromRest()) return false;
        const { themeManager, settingsManager } = this.deps;
        const before = themeManager?.activeThemeName;
        const others = this.stepper.position().list.filter((id) => id !== before);
        if (!others.length) {
            this.sayAlone();
            return false;
        }
        const ok = await this.mode._randomTheme();
        if (ok) saveThemeChoice(settingsManager, themeManager.activeThemeName);
        return ok;
    }

    /** A controller's A, or a press where nothing else is. */
    touchWorld() {
        if (this.wakeFromRest()) return;
        if (this.worldVisible && !this.guide?.isActive) this.touch?.touch();
    }

    // ── Effects ─────────────────────────────────────────────────────────────────────────

    get effectsOpen() {
        return this.effectsTray?.isOpen === true;
    }

    /**
     * E and the bar's chip: the effects tray open or closed.
     * @param {{ fromKey?: boolean }} [options] from the keyboard, focus moves into the tray
     */
    toggleEffects({ fromKey = false } = {}) {
        if (this.wakeFromRest()) return;
        if (this.effectsOpen) this.closeEffects();
        else this.openEffects({ focus: fromKey });
    }

    /** @param {{ focus?: boolean }} [options] */
    openEffects({ focus = false } = {}) {
        if (!this.effectsTray || this.effectsOpen) return;
        if (!this.worldVisible) {
            showSerenityNotice('Effects play over the theme · close what covers it first');
            return;
        }
        this.removeHints?.();
        this.effectsTray.open({ focus });
        this._holdForEffects();
        this.refresh();
    }

    /**
     * E, Esc (the tray's own), its ×: close it. Only the tray goes: what is playing plays on,
     * so it can be watched with the whole screen. @returns {boolean} whether it was open
     */
    closeEffects() {
        if (!this.effectsOpen) return false;
        this.effectsTray.close();
        this._holdForEffects();
        this.refresh();
        return true;
    }

    /** Stop what is playing: the dock's Stop, Esc with the tray folded away, the tray's Stop. */
    stopEffects() {
        if (!this.effects) return;
        this.effects.stop();
        hideSerenityNotice();
    }

    /** The world you are watching stays while you try its effects and while they play. */
    _holdForEffects() {
        if (!this.drift) return;
        const busy = this.effectsOpen || Boolean(this.effects?.playing) || Boolean(this.effects?.touring);
        if (busy) this.drift.hold('effects');
        else this.drift.release('effects');
    }

    /**
     * Play one effect on the theme on screen (the tray, or the console:
     * `serenityBlocks.gameModeManager.getCurrentMode().playEffect('quad')`).
     * @param {string} id one of EFFECTS (src/ui/serenity-mode/serenity-effects.js)
     * @returns {boolean} whether it played
     */
    playEffect(id) {
        if (this.wakeFromRest() || !this.worldVisible || !this.effects) return false;
        return this.effects.play(id);
    }

    /**
     * Every effect in turn; a second press stops. The tray folds away as it starts, so the theme
     * has the whole screen: each effect is named in a notice, and the dock shows Stop.
     */
    playAllEffects() {
        if (this.wakeFromRest() || !this.worldVisible || !this.effects) return;
        if (this.effects.touring) {
            this.stopEffects();
            return;
        }
        const fromKeyboard = this.effectsTray?.hasKeyboardFocus() === true;
        this.effects.playAll();
        if (this.closeEffects()) {
            // Say where Stop went; from the keyboard, take the focus there too.
            this.bar?.announce();
            if (fromKeyboard) this.bar?.focusStop();
        }
    }

    /** Why the theme may not answer: its reactions are switched off in Settings. */
    effectsNote() {
        return this.settings.backgroundComboEffects === false
            ? 'Theme reactions are off · Settings › Visual › Background reacts to combos'
            : '';
    }

    /** A piece in the theme's own colours, as a game paints it (game.js resolveActiveTetrominoColor). */
    pieceColor(shapeKey) {
        if (this.settings.themeBasedTetrominos === false) return null;
        return this.deps.themeManager?.activeTheme?.getTetrominoConfig?.()?.colors?.[shapeKey] || null;
    }

    // ── Drift and rest ──────────────────────────────────────────────────────────────────

    getDriftState() {
        return { pace: this.drift?.pace || 'off', lastPace: this.lastDriftPace };
    }

    /** @param {string} pace */
    setDrift(pace) {
        const next = normalizeDrift(pace);
        if (next !== 'off') this.lastDriftPace = next;
        this.drift.setPace(next);
        this.deps.settingsManager?.update?.({ serenityDrift: next, serenityDriftPace: this.lastDriftPace });
        this.deps.settingsManager?.scheduleSave?.();
        showSerenityNotice(driftOption(next).chip);
        this.refresh();
        window.dispatchEvent(new CustomEvent('serenityDriftChange', { detail: this.getDriftState() }));
    }

    /** D: drift on (at the pace you chose last) or off. */
    toggleDrift() {
        if (this.wakeFromRest()) return;
        this.setDrift(this.drift.isOn ? 'off' : this.lastDriftPace);
    }

    getRestState() {
        return { minutes: this.restTimer?.minutes || 0, msLeft: this.restTimer?.msLeft || 0 };
    }

    /** @param {number} minutes 0 turns it off */
    setRest(minutes) {
        this.restTimer.set(minutes);
        showSerenityNotice(minutes > 0 ? `Rest in ${minutes} min · the music fades and the screen dims` : 'Rest off');
        this.refresh();
        window.dispatchEvent(new CustomEvent('serenityRestChange', { detail: this.getRestState() }));
    }

    /** Time to rest: the music fades and the screen dims, then the theme stops drawing. */
    beginRest() {
        if (this.resting || !this.mode.isRunning) return;
        const { guide } = this;
        if (guide?.isExternallyControlled && guide.isActive) {
            // A Hale session finishes first; rest a minute after.
            this.restTimer.set(1);
            return;
        }
        this.resting = true;
        this.restAsleep = false;
        if (guide?.isActive) this.mode._hideBreathingIndicator?.();
        this.mode.serenityHub?.hide?.();
        this.drift.hold('rest');
        this.removeHints?.();
        this.syncCover();
        const { soundManager } = this.deps;
        Promise.resolve(soundManager?.fadeMusicVolume?.(0, REST_FADE_MS)).catch(() => {});
        this.restVeil.dim();
        this.restSleepTimer = setTimeout(() => {
            this.restSleepTimer = null;
            if (!this.resting) return;
            this.restAsleep = true;
            Promise.resolve(soundManager?.pauseAudioElement?.(false)).catch(() => {});
            if (!this.guide?.isActive) {
                window.isThemeCovered = true;
                this.restCoveredTheme = true;
            }
            this.wakeLock.release();
        }, REST_FADE_MS);
        window.dispatchEvent(new CustomEvent('serenityRestChange', { detail: this.getRestState() }));
    }

    /**
     * Any input while resting brings the world back and is used up doing so.
     * @returns {boolean} whether it was resting
     */
    wakeFromRest({ quiet = false } = {}) {
        if (!this.resting) return false;
        this.resting = false;
        if (this.restSleepTimer) clearTimeout(this.restSleepTimer);
        this.restSleepTimer = null;
        this.restVeil.wake();
        if (this.restCoveredTheme) window.isThemeCovered = false;
        this.restCoveredTheme = false;
        const { soundManager } = this.deps;
        if (soundManager) {
            soundManager.cancelMusicVolumeFade?.();
            soundManager.setMusicVolume?.(soundManager.getMusicVolume?.() ?? soundManager.musicVolume ?? 1);
            if (this.restAsleep && !quiet) {
                Promise.resolve(soundManager.resumeBackgroundMusic?.()).catch(() => {});
            }
        }
        this.restAsleep = false;
        if (!quiet) this.wakeLock.acquire();
        this.drift.release('rest');
        this.syncCover();
        this.refresh();
        if (!quiet) showSerenityNotice('Welcome back');
        window.dispatchEvent(new CustomEvent('serenityRestChange', { detail: this.getRestState() }));
        return true;
    }

    // ── Music ───────────────────────────────────────────────────────────────────────────

    /** ↑ ↓ (and LT / RT): music volume, saved like the Hub's slider. */
    nudgeVolume(direction, step = 0.05) {
        if (this.wakeFromRest()) return;
        const { soundManager, settingsManager } = this.deps;
        if (!soundManager) return;
        const current = soundManager.getMusicVolume?.() ?? soundManager.musicVolume ?? 1;
        const next = Math.round(Math.min(1, Math.max(0, current + Math.sign(direction) * step)) * 100) / 100;
        soundManager.setMusicVolume?.(next);
        if (settingsManager?.update) {
            settingsManager.update({ musicVolume: next });
            if (settingsManager.scheduleSave) settingsManager.scheduleSave();
            else settingsManager.save?.();
        }
        const percent = `Music ${Math.round(next * 100)}%`;
        const muteKey = keycap(this.mode.keyFor('toggleMute'));
        showSerenityNotice(soundManager.isMuted ? `${percent} · muted, ${muteKey} to listen` : percent);
    }

    /** , . (and the media keys): previous or next song. */
    stepSong(direction) {
        if (this.wakeFromRest()) return;
        const { soundManager } = this.deps;
        if (direction < 0) soundManager?.previousTrack?.();
        else soundManager?.nextTrack?.();
    }

    /** M: music off and on. */
    toggleMute() {
        if (this.wakeFromRest()) return;
        const { soundManager } = this.deps;
        if (!soundManager?.toggleMute) return;
        const muted = soundManager.toggleMute();
        this.mode.serenityHub?.musicTab?.renderMuteState?.(muted);
        showSerenityNotice(muted ? 'Music muted' : 'Music on');
    }

    /** @param {boolean} play */
    setPlayback(play) {
        if (this.wakeFromRest()) return;
        const { soundManager } = this.deps;
        if (!soundManager) return;
        const audio = soundManager.audioElement;
        if (play && (!audio || audio.paused)) {
            Promise.resolve(soundManager.resumeBackgroundMusic?.()).catch(() => {});
            showSerenityNotice('Music playing');
        } else if (!play && audio && !audio.paused) {
            Promise.resolve(soundManager.pauseAudioElement?.(false)).catch(() => {});
            showSerenityNotice('Music paused');
        }
    }

    // ── Screen ──────────────────────────────────────────────────────────────────────────

    toggleFullscreen() {
        if (this.wakeFromRest()) return;
        const leaving = Boolean(document.fullscreenElement);
        const request = leaving ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
        Promise.resolve(request).then(() => {
            showSerenityNotice(leaving ? 'Full screen off' : 'Full screen');
        }).catch(() => showSerenityNotice('Full screen is not available here'));
    }

    notice(message) {
        showSerenityNotice(message);
    }

    /** The first-visit hint line, in the input the player is using. */
    hintItems() {
        const status = this.deps.gamepadController?.getConnectionStatus?.();
        if (status?.controller1?.connected || status?.controller2?.connected) {
            return [[['←', '→'], 'Theme'], [['X'], 'Breathe'], [['Y'], 'Hub'], [['A'], 'Touch the world'],
                [['Select'], 'All controls']];
        }
        if (window.matchMedia?.('(pointer: coarse)').matches) {
            return [[[], 'Swipe sideways to change the theme'], [[], 'Tap the world to touch it']];
        }
        const key = (action) => keycap(this.mode.keyFor(action));
        return [
            [[key('previousTheme'), key('nextTheme')], 'Theme'],
            [[key('toggleBreathing')], 'Breathe'],
            [[key('toggleDrift')], 'Drift'],
            [[key('toggleHub')], 'Hub'],
            [[key('toggleControlHints')], 'All controls'],
        ];
    }
}
