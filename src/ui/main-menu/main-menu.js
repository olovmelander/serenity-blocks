/**
 * @fileoverview Keystone main menu: the current mode, its stage, keyboard arrows, the
 * dock and the Hale Sessions entry. Markup: index.html `#start-modal`. Styles:
 * public/styles/keystone-menu.css. Record: docs/MENU_UI_OVERHAUL_2026-10.md.
 *
 * Launching a mode stays where it was: a mode card's click fires `startGameWithMode`
 * (game-mode-ui.js) and gamepad A clicks the focused card. This module only decides
 * which mode is *current* (hovered, focused or last played), describes it on the
 * stage with the player's own progress, and routes the menu's secondary actions.
 */
import '../menu-card-interactions.js';
// Installs the serenity:toast listener at boot (a failed game start is announced as a toast).
import '../components/toast.js';
import { installInputModeTracking, getInputMode } from '../keystone/input-mode.js';
import { installFocusRing } from '../keystone/focus-ring.js';
import { installPlayRail } from '../keystone/play-rail.js';
import { getThemeIds, getThemeMeta } from '../../themes/theme-registry.js';
import { getThemeCollection } from '../../themes/theme-collection.js';
import { BREATH_WORLDS, breathPosterUrl } from '../effects/breathing/breath-catalogue.js';
import { getBreathCollection as breathCollectionNow } from '../effects/breathing/breath-collection-store.js';
import { BREATH_LADDER, STARTER_SESSIONS } from '../effects/breathing/breath-collection.js';
import { driftOption } from '../serenity-mode/serenity-options.js';
import { haleSessionName } from '../effects/breathing/breath-openings.js';
import { formatPracticeTime, readPracticeLog, summarizePractice } from '../effects/breathwork-practice-log.js';
import { statisticsForMode } from '../../core/progression/score-statistics.js';
import { MENU_ART_DIR, StageArt } from './stage-art.js';
import { readFlag } from '../../core/flags.js';
import { FAULT_LINES_PUZZLES, openPuzzleIds } from '../../core/fault-lines/puzzle-bank.js';
import { installFaultLinesHud, readSolvedFaultLines } from '../fault-lines/fault-lines-hud.js';
import { installWaystonesHud } from '../waystones/waystones-hud.js';
import { STOP_COUNT } from '../../core/waystones/road.js';
import { odysseyMeterHtml } from '../keystone/odyssey-meter.js';

const LAST_MODE_KEY = 'serenity.menu.lastMode';
const ODYSSEY_PROGRESS_KEY = 'serenityBlocks_odysseyProgress';
const WORDMARK_DIR = './assets/branding/modes/';
const HOVER_SETTLE_MS = 50;
const QUIT_CONFIRM_MS = 4000;
const QUIT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" '
    + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3.8v7.4"/><path d="M7.1 6.6a7.2 7.2 0 1 0 9.8 0"/></svg>';

/**
 * Copy and presentation for each entry in the list. Numbers come from live data. `art`
 * names the stage picture in public/assets/menu-art/; `focus` is its object-position on
 * the stage. Odyssey shows the player's chapter (`odyssey-<chapter>.webp`) and Hale
 * Sessions the poster of their newest session's world instead.
 */
const MODES = {
    single: {
        eyebrow: 'Stack · Classic',
        title: 'Single Player',
        art: { file: 'single' },
        wordmark: { file: 'single-player', tall: true },
        lede: 'The classic climb. Clear lines to raise the level — every level drops the pieces a little faster. Keep the stack low and chase your best.',
        action: 'Play',
    },
    infinity: {
        eyebrow: 'Stack · Endurance',
        title: 'Infinity',
        art: { file: 'infinity' },
        wordmark: { file: 'infinity' },
        lede: 'A well one thousand rows tall. Your stack can rise far above the screen, and the run ends only at the roof. Leave few holes and chain cascades as far as one run will carry you.',
        action: 'Play',
    },
    // Preview: listed only with ?faultLines=1 (see MainMenu's constructor).
    'fault-lines': {
        eyebrow: 'Stack · Puzzles',
        title: 'Fault Lines',
        art: { file: 'fault-lines' },
        lede: 'A structure, a few pieces and one goal. Gravity waits while you choose; then the cascade runs. Each body falls as one, and bodies never glue together.',
        action: 'Play',
    },
    // Preview: listed only with ?waystones=1 (see MainMenu's constructor).
    waystones: {
        eyebrow: 'Stack · The road',
        title: 'Waystones',
        art: { file: 'waystones' },
        lede: 'Five stops across the worlds you have collected. Each world bends the rules its own way and asks one thing of you. Your stack comes with you: bank it for a toll and a bigger ask, or release it.',
        action: 'Set out',
    },
    'local-multiplayer': {
        eyebrow: 'Stack · Local versus',
        title: 'Local Versus',
        art: { file: 'local-versus' },
        wordmark: { file: 'local-versus', tall: true },
        lede: 'Up to four players on one screen — keyboards, controllers or bots. Clear lines to send garbage across, and win by frags, lines, score or time: you set the rules.',
        action: 'Set up a match',
    },
    'online-multiplayer': {
        eyebrow: 'Stack · Online versus',
        title: 'Online Versus',
        art: { file: 'online-versus' },
        wordmark: { file: 'online-versus', tall: true },
        lede: 'Free-for-all lobbies for two to eight players. Create a match, browse the open ones, or drop into a game already under way.',
        action: 'Find a match',
        unavailableNote: 'Online play runs through Steam. Start Serenity Blocks from Steam to create and join lobbies.',
    },
    serenity: {
        eyebrow: 'Breath · Worlds and music',
        title: 'Serenity',
        art: { file: 'serenity' },
        wordmark: { file: 'serenity' },
        lede: 'Nothing to play — a living world and its music fill the screen. Let the worlds drift with the songs, breathe with the guide over them, or set a timer and let it all fade to sleep.',
        action: 'Enter Serenity',
    },
    hale: {
        eyebrow: 'Breath · Guided breathwork',
        title: 'Hale Sessions',
        lede: 'Nine voice-guided sessions in the breathing worlds, from the short Hale First Breath to the deep holds of Hale Elixir. The Odyssey and your practice open them, one by one.',
        action: 'Choose a session',
    },
    odyssey: {
        eyebrow: 'Ascend',
        title: 'Odyssey',
        wordmark: { file: 'odyssey' },
        lede: 'A journey from the molten core of the Earth to the edge of a black hole — and beyond. Every level brings its own goal and its own world.',
        action: 'Begin the journey',
    },
};

const MODE_ORDER = ['single', 'infinity', 'fault-lines', 'waystones', 'local-multiplayer', 'online-multiplayer', 'serenity', 'hale', 'odyssey'];

/** Hale sessions in the order the breath path opens them (breath-collection.js). */
const HALE_SESSION_ORDER = [...STARTER_SESSIONS, ...BREATH_LADDER.map((step) => step.session)];

const numberFormat = typeof Intl !== 'undefined' ? new Intl.NumberFormat() : null;
const formatNumber = (value) => (numberFormat ? numberFormat.format(value) : String(value));

/**
 * What Serenity holds for this player: the worlds collected (as the Hub counts them), the
 * breathing worlds open, and how it drifts. Read when the stage shows it; either collection
 * missing (storage blocked) leaves that fact at its total.
 */
function readSerenityState() {
    const state = { themes: null, breath: null, drift: 'off' };
    try {
        const collection = getThemeCollection();
        const summary = collection.getSummary();
        state.themes = {
            owned: summary.owned,
            total: summary.total,
            preview: Boolean(summary.developmentUnlockAll),
            firstName: getThemeMeta(collection.getOwnedThemeIds()[0])?.displayName || '',
        };
    } catch { /* the total below */ }
    try {
        const breath = breathCollectionNow();
        state.breath = { open: BREATH_WORLDS.filter(({ id }) => breath.isWorldOpen(id)).length };
    } catch { /* the total below */ }
    const settings = typeof window !== 'undefined' ? window.settingsManager?.get?.() || window.settings : null;
    state.drift = settings?.serenityDrift || 'off';
    return state;
}

/** How many Hale sessions the player has open, or null when the collection cannot be read. */
function readHaleOpenCount() {
    try {
        const collection = breathCollectionNow();
        return HALE_SESSION_ORDER.filter((id) => collection.isSessionOpen(id)).length;
    } catch {
        return null;
    }
}

/**
 * Serenity's facts and note from what the player has (pure, for the tests).
 * @param {{ themes: {owned: number, total: number, preview?: boolean, firstName?: string}|null,
 *   breath: {open: number}|null, drift?: string }} state
 */
export function serenityFacts({ themes, breath, drift = 'off' }) {
    const facts = [];
    let note = '';
    if (themes) {
        facts.push([themes.preview ? 'Worlds available' : 'Worlds collected',
            `${formatNumber(themes.owned)} / ${formatNumber(themes.total)}`]);
        if (themes.owned <= 1 && !themes.preview && themes.firstName) {
            note = `Your first world is ${themes.firstName}. Each Odyssey orb brings another home.`;
        }
    } else {
        facts.push(['Worlds', formatNumber(getThemeIds().length)]);
    }
    facts.push(['Breathing worlds', breath
        ? `${formatNumber(breath.open)} / ${formatNumber(BREATH_WORLDS.length)}`
        : formatNumber(BREATH_WORLDS.length)]);
    facts.push(['Drift', driftOption(drift).label]);
    return { facts, note };
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function readStorage(key) {
    try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch { /* private browsing: the menu simply forgets */ }
}

/** Saved Odyssey progress, reduced to what the stage shows. */
export function readOdysseyProgress(raw = readStorage(ODYSSEY_PROGRESS_KEY)) {
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        const completed = data?.completedLevels && typeof data.completedLevels === 'object'
            ? Object.entries(data.completedLevels)
            : [];
        const completedIds = new Set(completed.map(([id]) => Number(id)).filter(Number.isFinite));
        const stars = completed.reduce((sum, [, entry]) => sum + (Number(entry?.stars) || 0), 0);
        const currentLevel = Number(data?.currentLevel) || 1;
        return {
            completedIds,
            completedCount: completedIds.size,
            stars,
            currentLevel,
            currentChapter: Number(data?.currentChapter) || 1,
            started: completedIds.size > 0 || currentLevel > 1,
        };
    } catch {
        return null;
    }
}

/** The level/chapter shape of the journey, loaded only when Odyssey is first shown. */
let odysseyShapePromise = null;
function loadOdysseyShape() {
    if (!odysseyShapePromise) {
        odysseyShapePromise = import('../../core/odyssey/LevelRegistry.js')
            .then(({ getLevelRegistry }) => {
                const registry = getLevelRegistry();
                const chapters = registry.getAllChapters().map((chapter) => ({
                    id: chapter.id,
                    name: chapter.name,
                    levels: registry.getLevelsInChapter(chapter.id).map((level) => level.id),
                }));
                const levelCount = chapters.reduce((sum, chapter) => sum + chapter.levels.length, 0);
                return { chapters, levelCount };
            })
            .catch(() => null);
    }
    return odysseyShapePromise;
}

/**
 * The chapter the player's next level is in, from the journey's shape: the first chapter on
 * a fresh save. Without the shape, the saved chapter number alone (no name).
 */
export function chapterForProgress(shape, progress) {
    if (!shape) return progress?.currentChapter ? { id: progress.currentChapter, name: '' } : null;
    const level = progress?.currentLevel || 1;
    return shape.chapters.find((entry) => entry.levels.includes(level))
        || shape.chapters.find((entry) => entry.id === progress?.currentChapter)
        || shape.chapters[0]
        || null;
}

/** The furthest session along the breath path that is open (the first one always is). */
export function newestOpenSession(order, isOpen) {
    return order.filter((id) => isOpen(id)).pop() || order[0];
}

/**
 * The newest Hale session the player has open, for the stage picture: the furthest step of
 * the breath path (breath-collection.js), loaded only when the menu first shows.
 */
let haleNewestLoader = null;
function loadHaleNewest() {
    if (!haleNewestLoader) {
        haleNewestLoader = Promise.all([
            import('../effects/breathing/breath-collection-store.js'),
            import('../effects/breathing/session-worlds.js'),
        ]).then(([{ getBreathCollection }, { SESSION_WORLDS }]) => () => {
            const collection = getBreathCollection();
            const id = newestOpenSession(HALE_SESSION_ORDER, (session) => collection.isSessionOpen(session));
            return { id, world: SESSION_WORLDS[id]?.featured || null };
        }).catch(() => null);
    }
    return haleNewestLoader;
}

class MainMenu {
    constructor(root) {
        this.root = root;
        this.modal = root.closest('#start-modal');
        this.stage = root.querySelector('.sb-stage');
        if (readFlag('faultLines', false)) installFaultLinesHud();
        else root.querySelector('.game-mode-card[data-mode="fault-lines"]')?.remove();
        // The HUD idles until a road is published, so any way into the mode has its panel.
        installWaystonesHud();
        if (!readFlag('waystones', false)) root.querySelector('.game-mode-card[data-mode="waystones"]')?.remove();
        this.cards = Array.from(root.querySelectorAll('.game-mode-card'));
        this.current = null;
        this.hoverTimer = null;
        this.scoreStats = null;
        this.odysseyShape = null;
        this.haleNewest = null;
        this.buildStageShell();
        this.mountQuit();
        this.bind();
        this.setCurrent(this.initialMode(), { immediate: true });
        this.refreshData();
    }

    initialMode() {
        const remembered = readStorage(LAST_MODE_KEY);
        if (remembered && MODES[remembered] && this.cardFor(remembered)) return remembered;
        return readOdysseyProgress()?.started ? 'odyssey' : 'single';
    }

    cardFor(mode) {
        return this.cards.find((card) => card.dataset.mode === mode) || null;
    }

    isDisabled(card) {
        return !card || card.dataset.disabled === 'true' || card.classList.contains('steam-disabled');
    }

    /**
     * Desktop builds end the dock with Quit. It takes two presses (the label asks for
     * the second), so a stray controller press never closes the game.
     */
    mountQuit() {
        const dock = this.root.querySelector('.sb-dock');
        if (typeof window.electronAPI?.invoke !== 'function' || !dock || dock.querySelector('.sb-dock__btn--quit')) {
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sb-dock__btn sb-dock__btn--quit';
        button.innerHTML = `${QUIT_ICON}<span>Quit</span>`;
        const label = button.querySelector('span');
        let timer = null;
        const reset = () => {
            clearTimeout(timer);
            button.classList.remove('is-confirming');
            label.textContent = 'Quit';
        };
        button.addEventListener('click', () => {
            if (!button.classList.contains('is-confirming')) {
                button.classList.add('is-confirming');
                label.textContent = 'Press again to quit';
                timer = setTimeout(reset, QUIT_CONFIRM_MS);
                return;
            }
            reset();
            Promise.resolve(window.electronAPI.invoke('desktop:quit')).catch(() => {});
        });
        button.addEventListener('blur', reset);
        dock.appendChild(button);
    }

    buildStageShell() {
        if (!this.stage) return;
        this.stage.innerHTML = '<div class="sb-stage__panel"><div class="sb-stage__content"></div></div>';
        this.panel = this.stage.querySelector('.sb-stage__panel');
        this.art = new StageArt(this.panel, { isActive: () => this.isMenuActive() });
    }

    /** Every picture the stage can show next, fetched once the menu is idle. */
    preloadArt() {
        if (this.artPreloaded || !this.art) return;
        this.artPreloaded = true;
        const run = () => Promise.all([this.ensureOdysseyShape(), this.ensureHaleNewest()]).then(() => {
            this.art.preload(MODE_ORDER.filter((mode) => mode !== this.current).map((mode) => this.artFor(mode)?.src));
        });
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2500 });
        else setTimeout(run, 1200);
    }

    ensureOdysseyShape() {
        if (this.odysseyShape) return Promise.resolve(this.odysseyShape);
        return loadOdysseyShape().then((shape) => {
            if (shape && !this.odysseyShape) {
                this.odysseyShape = shape;
                if (this.current === 'odyssey') this.renderStage();
            }
            return shape;
        });
    }

    ensureHaleNewest() {
        if (this.haleNewest) return Promise.resolve(this.haleNewest);
        return loadHaleNewest().then((newest) => {
            if (newest && !this.haleNewest) {
                this.haleNewest = newest;
                if (this.current === 'hale') this.renderStage();
            }
            return newest;
        });
    }

    bind() {
        this.cards.forEach((card) => {
            const { mode } = card.dataset;
            card.addEventListener('pointerenter', () => this.setCurrent(mode));
            card.addEventListener('focus', () => this.setCurrent(mode, { immediate: true }));
        });

        // Hale Sessions is a list entry, not a game mode: it opens the guided sessions.
        const hale = this.cardFor('hale');
        if (hale) {
            hale.setAttribute('role', 'button');
            const desc = hale.querySelector('.mode-card-desc');
            if (desc) {
                desc.id = desc.id || 'mode-desc-hale';
                hale.setAttribute('aria-describedby', desc.id);
            }
            hale.setAttribute('aria-label', 'Hale Sessions');
            hale.addEventListener('click', () => this.openHaleSessions());
            hale.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                this.openHaleSessions();
            });
        }

        this.root.querySelectorAll('[data-proxy]').forEach((button) => {
            button.addEventListener('click', () => {
                document.getElementById(button.dataset.proxy)?.click();
            });
        });

        this.stage?.addEventListener('click', (event) => {
            const action = event.target.closest?.('[data-action="play"]');
            if (action && action.getAttribute('aria-disabled') !== 'true') this.activate(this.current);
        });

        document.addEventListener('keydown', (event) => this.onKeyDown(event), true);

        window.addEventListener('startGameWithMode', (event) => {
            const mode = event?.detail?.mode;
            if (MODES[mode]) writeStorage(LAST_MODE_KEY, mode);
        });

        window.addEventListener('modalShown', (event) => {
            if (event?.detail?.modalName !== 'start') return;
            this.refreshData();
            this.focusCurrentForKeys();
            this.preloadArt();
        });

        // Steam availability can change while the menu is open.
        const online = this.cardFor('online-multiplayer');
        if (online && typeof MutationObserver !== 'undefined') {
            new MutationObserver(() => {
                if (this.current === 'online-multiplayer') this.renderStage();
            }).observe(online, { attributes: true, attributeFilter: ['class', 'data-disabled'] });
        }
    }

    isMenuActive() {
        return Boolean(this.modal?.classList.contains('visible'))
            && !document.body.classList.contains('start-modal-covered')
            && !document.body.classList.contains('serenity-hub-open')
            // A Hale flow or breathing guide started from the menu owns Space and Enter.
            && !document.querySelector('.hale-flow:not([hidden]), #breathing-guide:not([hidden])');
    }

    /** Arrow keys walk the list; Enter with nothing focused plays the current mode. */
    onKeyDown(event) {
        if (!this.isMenuActive() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const active = document.activeElement;
        const onCard = this.cards.includes(active);
        const idle = !active || active === document.body || active === this.modal;
        const onStage = Boolean(active && this.stage?.contains(active));

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!onCard && !idle) return;
            event.preventDefault();
            this.step(event.key === 'ArrowDown' ? 1 : -1, onCard ? active : null);
            return;
        }
        if ((event.key === 'Home' || event.key === 'End') && (onCard || idle)) {
            event.preventDefault();
            const list = this.cards.filter((card) => card.offsetParent !== null);
            (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
            return;
        }
        if (event.key === 'ArrowRight' && onCard) {
            const play = this.stage?.querySelector('[data-action="play"]');
            if (play && play.offsetParent !== null) {
                event.preventDefault();
                play.focus();
            }
            return;
        }
        if (event.key === 'ArrowLeft' && onStage) {
            event.preventDefault();
            this.cardFor(this.current)?.focus();
            return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && idle) {
            // Without this the global handler would start whichever mode was selected
            // last, not the one the menu is showing.
            event.preventDefault();
            event.stopPropagation();
            this.activate(this.current);
        }
    }

    step(direction, fromCard) {
        const list = this.cards.filter((card) => card.offsetParent !== null);
        if (!list.length) return;
        const start = fromCard ? list.indexOf(fromCard) : list.indexOf(this.cardFor(this.current));
        const next = list[Math.max(0, Math.min(list.length - 1, (start < 0 ? 0 : start + direction)))];
        next?.focus();
    }

    focusCurrentForKeys() {
        const mode = getInputMode();
        if (mode !== 'keyboard' && mode !== 'gamepad') return;
        // After the gamepad's own first-focus pass, so the remembered mode wins.
        setTimeout(() => {
            if (!this.isMenuActive()) return;
            const active = document.activeElement;
            if (active && active !== document.body && !this.cards.includes(active)) return;
            const card = this.cardFor(this.current);
            if (card && !this.isDisabled(card)) card.focus({ preventScroll: true });
        }, 160);
    }

    activate(mode) {
        if (mode === 'hale') {
            this.openHaleSessions();
            return;
        }
        const card = this.cardFor(mode);
        if (card && !this.isDisabled(card)) card.click();
    }

    async openHaleSessions() {
        writeStorage(LAST_MODE_KEY, 'hale');
        const app = typeof window !== 'undefined' ? window.serenityBlocks : null;
        try {
            // The sessions need the breathing guide, which starts with the deferred services.
            await app?.startDeferredDesktopServices?.('menu-hale');
            const hub = app?.serenityHub || (await app?.initializeGlobalSerenityHub?.());
            if (hub?.openHaleSessions) {
                hub.openHaleSessions();
                return;
            }
        } catch (error) {
            console.warn('[MainMenu] Could not open Hale sessions directly:', error);
        }
        document.getElementById('hale-sessions-btn')?.click();
    }

    setCurrent(mode, { immediate = false } = {}) {
        if (!MODES[mode]) return;
        clearTimeout(this.hoverTimer);
        const apply = () => {
            if (mode === this.current) return;
            this.current = mode;
            this.cards.forEach((card) => card.classList.toggle('is-current', card.dataset.mode === mode));
            this.root.dataset.current = mode;
            if (this.modal) this.modal.dataset.current = mode;
            this.renderStage();
        };
        // A pointer sweeping down the list should not flicker the stage.
        if (immediate) apply();
        else this.hoverTimer = setTimeout(apply, HOVER_SETTLE_MS);
    }

    async refreshData() {
        const manager = typeof window !== 'undefined' ? window.serenityBlocks?.highScoreManager : null;
        if (manager?.getStatistics) {
            try {
                this.scoreStats = await manager.getStatistics();
            } catch {
                this.scoreStats = null;
            }
        }
        this.renderStage();
    }

    factsFor(mode) {
        const facts = [];
        let note = '';
        let meter = null;
        let { eyebrow } = MODES[mode];
        let { action } = MODES[mode];

        if (mode === 'single') {
            // Records counts Infinity runs too; this stage is Single Player's own.
            const stats = this.scoreStats ? statisticsForMode(this.scoreStats, 'single') : null;
            if (stats && stats.totalGames > 0) {
                facts.push(['Best score', formatNumber(stats.highestScore || 0)]);
                facts.push(['Highest level', formatNumber(stats.highestLevel || 0)]);
                facts.push(['Games', formatNumber(stats.totalGames)]);
            } else {
                note = 'Your first game sets the record. Find every score after that in Records.';
            }
        } else if (mode === 'infinity') {
            facts.push(['Rows', formatNumber(1000)]);
            facts.push(['Goal', 'Biggest cascade']);
        } else if (mode === 'fault-lines') {
            const solvedIds = readSolvedFaultLines();
            const solved = solvedIds.length;
            const open = openPuzzleIds(solvedIds);
            const tiers = new Set(FAULT_LINES_PUZZLES.map((puzzle) => puzzle.tier));
            const openTiers = new Set(FAULT_LINES_PUZZLES.filter((puzzle) => open.has(puzzle.id)).map((p) => p.tier));
            facts.push(['Puzzles solved', `${formatNumber(solved)} / ${formatNumber(FAULT_LINES_PUZZLES.length)}`]);
            facts.push(['Tiers open', `${openTiers.size} / ${tiers.size}`]);
            if (solved > 0) action = 'Continue';
            else note = 'Preview. Solve three in a tier to open the next. Every piece can be taken back.';
        } else if (mode === 'waystones') {
            let owned = 1;
            try { ({ owned } = getThemeCollection().getSummary()); } catch { /* a private window keeps Forest */ }
            facts.push(['Stops', String(STOP_COUNT)]);
            facts.push(['Worlds on the road', formatNumber(owned)]);
            facts.push(['Lanterns', '3']);
            note = 'Preview. A top-out costs a lantern; the third ends the road. Charms between stops; the Keeper at the end.';
        } else if (mode === 'local-multiplayer') {
            facts.push(['Players', '2–4']);
            facts.push(['Bots', 'Any seat']);
            facts.push(['Teams', 'Optional']);
        } else if (mode === 'online-multiplayer') {
            facts.push(['Players', '2–8']);
            facts.push(['Who can join', 'Anyone · Friends · Invite only']);
            // The card's chip already says why; the note says what to do.
            if (this.isDisabled(this.cardFor(mode))) note = MODES[mode].unavailableNote;
        } else if (mode === 'serenity') {
            const serenity = serenityFacts(readSerenityState());
            facts.push(...serenity.facts);
            ({ note } = serenity);
        } else if (mode === 'hale') {
            const summary = summarizePractice(readPracticeLog());
            const open = readHaleOpenCount();
            facts.push(open === null
                ? ['Sessions', formatNumber(HALE_SESSION_ORDER.length)]
                : ['Sessions open', `${formatNumber(open)} / ${formatNumber(HALE_SESSION_ORDER.length)}`]);
            if (summary.hasHistory) {
                facts.push(['Streak', `${summary.streak} ${summary.streak === 1 ? 'day' : 'days'}`]);
                facts.push(['Practised', formatPracticeTime(summary.seconds)]);
            } else {
                note = 'Some sessions include long breath holds. Read each session’s notes before you begin.';
            }
        } else if (mode === 'odyssey') {
            const progress = readOdysseyProgress();
            const shape = this.odysseyShape;
            if (shape) eyebrow = `Ascend · ${shape.chapters.length} chapters · ${shape.levelCount} levels`;
            if (progress?.started) {
                action = 'Continue';
                const total = shape?.levelCount;
                facts.push(['Levels cleared', total ? `${progress.completedCount} / ${total}` : formatNumber(progress.completedCount)]);
                facts.push(['Stars', total ? `${progress.stars} / ${total * 3}` : formatNumber(progress.stars)]);
                const chapter = this.odysseyChapter(progress);
                if (chapter?.name) facts.push([`Chapter ${chapter.id}`, chapter.name.split(' & ')[0]]);
            }
            if (shape) meter = this.odysseyMeter(shape, progress);
        }
        return {
            facts, note, meter, eyebrow, action,
        };
    }

    odysseyChapter(progress = readOdysseyProgress()) {
        return chapterForProgress(this.odysseyShape, progress);
    }

    /** The stage picture for a mode: `{ src, focus?, caption? }`, or null. */
    artFor(mode) {
        if (mode === 'odyssey') {
            const chapter = this.odysseyChapter();
            const id = chapter?.id || 1;
            return {
                src: `${MENU_ART_DIR}odyssey-${id}.webp`,
                caption: chapter?.name ? `Chapter ${id} · ${chapter.name.split(' & ')[0]}` : '',
            };
        }
        if (mode === 'hale') {
            const newest = this.haleNewest?.();
            return newest?.world ? { src: breathPosterUrl(newest.world), caption: haleSessionName(newest.id) } : null;
        }
        const art = MODES[mode]?.art;
        return art ? { src: `${MENU_ART_DIR}${art.file}.webp`, focus: art.focus } : null;
    }

    odysseyMeter(shape, progress) {
        return odysseyMeterHtml(shape.chapters, {
            completedIds: progress?.completedIds,
            next: progress?.currentLevel || 1,
        });
    }

    renderStage() {
        if (!this.panel || !this.current) return;
        const mode = this.current;
        const spec = MODES[mode];

        if (mode === 'odyssey' && !this.odysseyShape) this.ensureOdysseyShape();
        if (mode === 'hale' && !this.haleNewest) this.ensureHaleNewest();

        const {
            facts, note, meter, eyebrow, action,
        } = this.factsFor(mode);
        const disabled = mode === 'online-multiplayer' && this.isDisabled(this.cardFor(mode));
        const title = spec.wordmark
            ? `<img class="sb-stage__wordmark${spec.wordmark.tall ? ' sb-stage__wordmark--tall' : ''}" src="${WORDMARK_DIR}${spec.wordmark.file}.svg" alt="${escapeHtml(spec.title)}">`
            : escapeHtml(spec.title);
        const factsHtml = facts.length
            ? `<dl class="sb-stage__facts">${facts.map(([label, value]) => `<div class="sb-stage__fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`
            : '';

        const content = document.createElement('div');
        content.className = 'sb-stage__content';
        content.innerHTML = `
            <p class="sb-eyebrow">${escapeHtml(eyebrow)}</p>
            <h2 class="sb-stage__title">${title}</h2>
            <p class="sb-stage__lede">${escapeHtml(spec.lede)}</p>
            ${factsHtml}
            ${meter ? `<div class="sb-stage__progress">${meter}</div>` : ''}
            ${note ? `<p class="sb-stage__note">${escapeHtml(note)}</p>` : ''}
            <div class="sb-stage__actions">
                <button type="button" class="sb-btn sb-btn--primary" data-action="play"${disabled ? ' aria-disabled="true"' : ''}
                    aria-label="${escapeHtml(`${action} — ${spec.title}`)}">
                    <span>${escapeHtml(disabled ? 'Unavailable' : action)}</span>
                    <kbd class="sb-kbd" data-key aria-hidden="true">Enter</kbd><kbd class="sb-kbd" data-pad aria-hidden="true">A</kbd>
                </button>
            </div>`;

        this.art?.show(this.artFor(mode));

        // Keep focus if it sat on the old stage button.
        const previous = this.panel.querySelector('.sb-stage__content');
        const hadFocus = Boolean(previous?.contains(document.activeElement));
        if (previous) previous.replaceWith(content);
        else this.panel.appendChild(content);
        if (hadFocus) content.querySelector('[data-action="play"]')?.focus({ preventScroll: true });
    }
}

let menu = null;

export function initMainMenu() {
    if (menu || typeof document === 'undefined') return menu;
    const root = document.querySelector('#start-modal .sb-menu');
    if (!root) return null;
    installInputModeTracking();
    installFocusRing();
    installPlayRail();
    menu = new MainMenu(root);
    return menu;
}

export { MODES as MAIN_MENU_MODES, MODE_ORDER as MAIN_MENU_ORDER };

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMainMenu, { once: true });
    } else {
        initMainMenu();
    }
}
