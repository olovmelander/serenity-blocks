/* eslint-disable import/first */

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: class BoardJuice {
        destroy() {}
    },
}));

import { OdysseyMode } from '../../src/core/game-modes/OdysseyMode.js';
import { LevelRegistry } from '../../src/core/odyssey/LevelRegistry.js';
import { OdysseyBoardController } from '../../src/rendering/odyssey/OdysseyBoardController.js';

function createClassList(element) {
    const getTokens = () => element.className.split(/\s+/).filter(Boolean);
    const setTokens = (tokens) => {
        element.className = Array.from(new Set(tokens)).join(' ');
    };

    return {
        add(...tokens) {
            setTokens([...getTokens(), ...tokens]);
        },
        remove(...tokens) {
            const removals = new Set(tokens);
            setTokens(getTokens().filter((token) => !removals.has(token)));
        },
        toggle(token, force) {
            const hasToken = getTokens().includes(token);
            const shouldAdd = force ?? !hasToken;
            if (shouldAdd) {
                this.add(token);
                return true;
            }

            this.remove(token);
            return false;
        },
        contains(token) {
            return getTokens().includes(token);
        },
    };
}

function matchesSelector(element, selector) {
    if (selector.startsWith('#')) {
        return element.id === selector.slice(1);
    }

    if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1));
    }

    return false;
}

function querySelectorInTree(root, selector) {
    for (const child of root.children) {
        if (matchesSelector(child, selector)) {
            return child;
        }

        const nested = querySelectorInTree(child, selector);
        if (nested) {
            return nested;
        }
    }

    return null;
}

function createDomHarness() {
    const elementsById = new Map();
    let documentRef = null;

    const registerTree = (node) => {
        if (node.id) {
            elementsById.set(node.id, node);
        }

        node.children.forEach((child) => registerTree(child));
    };

    const unregisterTree = (node) => {
        if (node.id) {
            elementsById.delete(node.id);
        }

        node.children.forEach((child) => unregisterTree(child));
    };

    const createElement = (tagName) => {
        const element = {
            tagName: tagName.toUpperCase(),
            ownerDocument: null,
            children: [],
            parentNode: null,
            style: {},
            dataset: {},
            attributes: new Map(),
            eventListeners: new Map(),
            className: '',
            id: '',
            textContent: '',
            disabled: false,
            _innerHTML: '',
            appendChild(child) {
                child.parentNode = this;
                child.ownerDocument = documentRef;
                this.children.push(child);
                registerTree(child);
                return child;
            },
            removeChild(child) {
                const index = this.children.indexOf(child);
                if (index >= 0) {
                    this.children.splice(index, 1);
                    unregisterTree(child);
                    child.parentNode = null;
                }
                return child;
            },
            remove() {
                this.parentNode?.removeChild?.(this);
            },
            setAttribute(name, value) {
                const normalized = String(value);
                this.attributes.set(name, normalized);
                if (name === 'id') {
                    this.id = normalized;
                    registerTree(this);
                } else if (name === 'class') {
                    this.className = normalized;
                }
            },
            getAttribute(name) {
                if (name === 'id') return this.id || null;
                if (name === 'class') return this.className || null;
                return this.attributes.get(name) ?? null;
            },
            addEventListener(type, handler) {
                const handlers = this.eventListeners.get(type) || [];
                handlers.push(handler);
                this.eventListeners.set(type, handlers);
            },
            removeEventListener(type, handler) {
                const handlers = this.eventListeners.get(type) || [];
                this.eventListeners.set(type, handlers.filter((entry) => entry !== handler));
            },
            dispatchEvent(event) {
                const handlers = this.eventListeners.get(event.type) || [];
                handlers.forEach((handler) => handler(event));
            },
            click() {
                this.dispatchEvent({
                    type: 'click',
                    preventDefault() {},
                    stopPropagation() {},
                    target: this,
                });
            },
            querySelector(selector) {
                return querySelectorInTree(this, selector);
            },
        };

        Object.defineProperty(element, 'classList', {
            value: createClassList(element),
        });

        Object.defineProperty(element, 'isConnected', {
            get() {
                return !!this.parentNode;
            },
        });

        Object.defineProperty(element, 'innerHTML', {
            get() {
                return this._innerHTML;
            },
            set(html) {
                this._innerHTML = html;
                this.children.slice().forEach((child) => this.removeChild(child));

                const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
                let match = tagRegex.exec(html);
                while (match) {
                    const [, childTag, attrs] = match;
                    const child = createElement(childTag);
                    const idMatch = attrs.match(/id="([^"]+)"/i);
                    const classMatch = attrs.match(/class="([^"]+)"/i);
                    if (idMatch) {
                        child.id = idMatch[1];
                    }
                    if (classMatch) {
                        child.className = classMatch[1];
                    }
                    this.appendChild(child);
                    match = tagRegex.exec(html);
                }
            },
        });

        return element;
    };

    const document = {
        createElement(tagName) {
            const element = createElement(tagName);
            element.ownerDocument = document;
            return element;
        },
        getElementById(id) {
            return elementsById.get(id) || null;
        },
        querySelector(selector) {
            return querySelectorInTree(this.body, selector) || querySelectorInTree(this.head, selector);
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    documentRef = document;

    document.body = createElement('body');
    document.body.ownerDocument = document;
    document.head = createElement('head');
    document.head.ownerDocument = document;

    const window = {
        document,
        settings: {},
        setTimeout,
        clearTimeout,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };

    return {
        document,
        window,
    };
}

function createLevelConfig(rows = 20, overrides = {}) {
    return {
        id: 1,
        name: 'Test Level',
        chapter: 1,
        theme: {
            primary: 'forest',
            overlays: [],
        },
        modifiers: {
            active: [],
        },
        mechanics: {
            baseMode: 'standard',
            board: {
                columns: 10,
                rows,
                startingRows: 0,
            },
            speed: {
                startLevel: 1,
                levelProgression: true,
                fixedDropInterval: null,
            },
            pieces: {
                bagType: '7-bag',
                customSequence: null,
                holdEnabled: true,
                previewCount: 5,
            },
        },
        victory: {
            primary: {
                type: 'lines',
                target: 10,
            },
            failure: {
                type: 'top-out',
                value: null,
            },
            bonuses: [],
        },
        metadata: {
            description: 'Test',
            difficulty: 1,
            estimatedTime: 60,
            tip: 'Test',
        },
        ...overrides,
    };
}

function createMode() {
    vi.stubGlobal('localStorage', {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    });

    const mode = new OdysseyMode({
        frameRateController: {
            isRunning: false,
            stopHybridLoop: vi.fn(),
        },
        soundManager: {},
    });
    mode.levelRegistry = new LevelRegistry();
    mode.odysseyState.levelRegistry = mode.levelRegistry;

    const boardScene = {
        syncFromGameState: vi.fn(),
        configureCamera: vi.fn(),
        updateCameraPosition: vi.fn(),
    };

    mode.currentLevelId = 1;
    mode.currentLevelConfig = createLevelConfig();
    mode._startPhaserBoardScene = vi.fn();
    mode._stopPhaserBoardScene = vi.fn();
    mode._getBoardScene = vi.fn(() => boardScene);
    mode._clearPhaserBoard = vi.fn();
    mode._refreshNextQueue = vi.fn();
    mode._updateStats = vi.fn();
    mode._initializeOdysseyHUD = vi.fn();
    mode._initializeMinimap = vi.fn();
    mode._cleanupOdysseyHUD = vi.fn();
    mode._cleanupMinimap = vi.fn();
    mode._applyInfinityLayout = vi.fn();
    mode._restoreInputs = vi.fn();
    mode._hookInputs = vi.fn();
    mode._startLevelTimer = vi.fn();
    mode._startGameLoop = vi.fn();

    return {
        mode,
        boardScene,
    };
}

function appendGameplayShell() {
    const gameContainer = document.createElement('div');
    gameContainer.id = 'single-player-container';
    gameContainer.style.visibility = 'visible';
    gameContainer.style.opacity = '1';
    document.body.appendChild(gameContainer);

    const phaserContainer = document.createElement('div');
    phaserContainer.id = 'phaser-game-container';
    phaserContainer.style.visibility = 'visible';
    phaserContainer.style.opacity = '1';
    document.body.appendChild(phaserContainer);

    const statsBar = document.createElement('div');
    statsBar.className = 'single-player-stats-bar';
    statsBar.style.visibility = 'visible';
    statsBar.style.opacity = '1';
    document.body.appendChild(statsBar);

    const bgContainer = document.createElement('div');
    bgContainer.className = 'background-container';
    bgContainer.style.opacity = '1';
    document.body.appendChild(bgContainer);

    return {
        bgContainer,
        gameContainer,
        phaserContainer,
        statsBar,
    };
}

describe('OdysseyMode level entry bootstrap', () => {
    let dom = null;

    beforeEach(() => {
        dom = createDomHarness();
        vi.stubGlobal('window', dom.window);
        vi.stubGlobal('document', dom.document);
    });

    afterEach(() => {
        dom = null;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('prepareLevelStart builds the first frame without starting timer, loop, or inputs', async () => {
        const { mode, boardScene } = createMode();

        const prepared = await mode.prepareLevelStart();

        expect(prepared).toBe(true);
        expect(mode.gameState).toBeTruthy();
        expect(mode.gameState.currentPiece).toBeTruthy();
        expect(mode.levelPrepared).toBe(true);
        expect(mode.levelRunStarted).toBe(false);
        expect(mode.entryPhase).toBe('prepared');
        expect(mode._startPhaserBoardScene).toHaveBeenCalledTimes(1);
        expect(boardScene.syncFromGameState).toHaveBeenCalled();
        expect(mode._hookInputs).not.toHaveBeenCalled();
        expect(mode._startLevelTimer).not.toHaveBeenCalled();
        expect(mode._startGameLoop).not.toHaveBeenCalled();
    });

    it('awaits board view readiness during activation', async () => {
        const { mode } = createMode();
        let resolveBoardView;
        const boardViewPromise = new Promise((resolve) => {
            resolveBoardView = resolve;
        });

        mode._captureBoardTrack = vi.fn();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showOdysseyUI = vi.fn();
        mode._showBoardView = vi.fn().mockReturnValue(boardViewPromise);
        mode.odysseyState.load = vi.fn();
        mode.odysseyState.startSession = vi.fn();
        mode.journeyEntryTransition = {};
        mode.journeyReturnTransition = {};

        let settled = false;
        const activationPromise = mode.onActivate().then(() => {
            settled = true;
        });

        // onActivate now yields a real paint (waitForCinematicLoadingOverlayPresented)
        // so the loading overlay is on-screen before the board build; that resolves on
        // a macrotask, so flush macrotasks until the build kicks off (bounded).
        for (let i = 0; i < 5 && mode._showBoardView.mock.calls.length === 0; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        expect(mode._showBoardView).toHaveBeenCalledTimes(1);
        expect(mode.boardViewReadyPromise).toBe(boardViewPromise);
        expect(settled).toBe(false);

        resolveBoardView(true);
        await activationPromise;

        expect(settled).toBe(true);
        expect(mode.boardViewReadyPromise).toBeNull();
        expect(mode.isActive).toBe(true);
    });

    it('fails activation cleanly when the Odyssey board cannot initialize', async () => {
        const { mode } = createMode();
        const boardError = new Error('board init failed');

        mode._captureBoardTrack = vi.fn();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showOdysseyUI = vi.fn();
        mode._showBoardView = vi.fn().mockRejectedValue(boardError);
        mode._disposeOdysseyBoard = vi.fn();
        mode._dismissCinematicLoadingOverlay = vi.fn().mockResolvedValue();
        mode.odysseyState.load = vi.fn();
        mode.odysseyState.startSession = vi.fn();
        mode.journeyEntryTransition = {};
        mode.journeyReturnTransition = {};

        await expect(mode.onActivate()).rejects.toThrow('board init failed');

        expect(mode._disposeOdysseyBoard).toHaveBeenCalledTimes(1);
        expect(mode._dismissCinematicLoadingOverlay).toHaveBeenCalledTimes(1);
        expect(mode.boardViewReadyPromise).toBeNull();
        expect(mode.isActive).toBe(false);
    });

    it('beginLevelRun starts inputs, timer, and loop only once after preparation', async () => {
        const { mode } = createMode();
        await mode.prepareLevelStart();

        expect(mode.beginLevelRun()).toBe(true);
        expect(mode._hookInputs).toHaveBeenCalledTimes(1);
        expect(mode._startLevelTimer).toHaveBeenCalledTimes(1);
        expect(mode._startGameLoop).toHaveBeenCalledTimes(1);
        expect(mode.levelRunStarted).toBe(true);
        expect(mode.entryPhase).toBe('running');
        expect(mode.beginLevelRun()).toBe(false);
        expect(mode._hookInputs).toHaveBeenCalledTimes(1);
        expect(mode._startLevelTimer).toHaveBeenCalledTimes(1);
        expect(mode._startGameLoop).toHaveBeenCalledTimes(1);
    });

    it('enterLevel starts gameplay only after the playable callback', async () => {
        window.settings = { effectQuality: 'High' };
        window.setTimeout = vi.fn(() => 1);
        window.clearTimeout = vi.fn();

        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        const order = [];

        mode.odysseyState.isLevelUnlocked = vi.fn(() => true);
        mode.levelRegistry.resolveLevelPresentation = vi.fn(() => levelConfig);
        mode._captureBoardTrack = vi.fn();
        mode._resetLevelMetrics = vi.fn();
        mode._resolveJourneyEntryAnchor = vi.fn(() => ({ x: 0.5, y: 0.5, worldPosition: null }));
        mode._buildJourneyEntryPalette = vi.fn(() => ({}));
        mode._prefetchLevelAssets = vi.fn().mockResolvedValue(true);
        mode._setTransitionMusicDuck = vi.fn();
        mode._restoreTransitionMusicDuck = vi.fn();
        mode._prepareGameplayReveal = vi.fn().mockResolvedValue(true);
        mode._activateLevelThemeVisuals = vi.fn().mockResolvedValue(true);
        mode.prepareLevelStart = vi.fn().mockImplementation(async () => {
            mode.levelPrepared = true;
            mode.gameState = {};
            mode.entryPhase = 'prepared';
            return true;
        });
        mode._waitForEntryRevealReadiness = vi.fn().mockResolvedValue(true);
        mode._showLevelIntro = vi.fn();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode.showLevelStartCue = vi.fn().mockImplementation(async () => {
            order.push('countdown');
            mode.entryPhase = 'countdown';
            return true;
        });
        mode.beginLevelRun = vi.fn().mockImplementation(() => {
            mode.entryPhase = 'running';
            return true;
        });
        mode._beginGameplayReveal = vi.fn().mockImplementation(() => {
            order.push('begin-reveal');
            const revealState = {
                playablePromise: Promise.resolve(true),
                uiPromise: Promise.resolve(true),
            };
            mode.gameplayRevealState = revealState;
            return revealState;
        });

        mode.journeyEntryTransition = {
            play: vi.fn().mockImplementation(async ({ callbacks }) => {
                await callbacks.onBlackoutReached();
                order.push('blackout');

                await callbacks.onRevealStart();
                order.push('reveal');
                expect(mode.beginLevelRun).not.toHaveBeenCalled();
                expect(mode.entryPhase).toBe('revealing');

                await callbacks.onPlayable();
                order.push('playable');
                expect(mode.showLevelStartCue).toHaveBeenCalledTimes(1);
                expect(mode.beginLevelRun).toHaveBeenCalledTimes(1);
                expect(mode.entryPhase).toBe('running');

                return { success: true, aborted: false };
            }),
        };

        const entered = await mode.enterLevel(levelConfig.id);

        expect(entered).toBe(true);
        expect(order).toEqual(['blackout', 'begin-reveal', 'reveal', 'countdown', 'playable']);
        expect(mode._showLevelIntro).toHaveBeenCalledWith(levelConfig);
    });

    it('showLevelStartCue keeps the first frame frozen until GO and adapts for fast levels', async () => {
        vi.useFakeTimers();

        const { mode } = createMode();
        const levelConfig = createLevelConfig(20, { name: 'Solar Eclipse' });
        mode.currentLevelConfig = levelConfig;
        mode.gameState = {
            dropInterval: 450,
        };

        const cuePromise = mode.showLevelStartCue(levelConfig, mode.gameState);

        expect(mode.entryPhase).toBe('countdown');
        expect(document.getElementById('odyssey-level-start-cue')).toBeTruthy();
        expect(document.getElementById('odyssey-level-start-cue-label')?.textContent).toBe('READY');

        await vi.advanceTimersByTimeAsync(799);
        expect(document.getElementById('odyssey-level-start-cue-label')?.textContent).toBe('READY');

        await vi.advanceTimersByTimeAsync(1);
        expect(document.getElementById('odyssey-level-start-cue-label')?.textContent).toBe('GO');

        await vi.advanceTimersByTimeAsync(279);
        expect(document.getElementById('odyssey-level-start-cue')).toBeTruthy();

        await vi.advanceTimersByTimeAsync(1);
        await expect(cuePromise).resolves.toBe(true);
        expect(document.getElementById('odyssey-level-start-cue')).toBeNull();

        vi.useRealTimers();
    });

    it('onStop clears an active level start cue before GO', async () => {
        vi.useFakeTimers();

        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.currentLevelConfig = levelConfig;
        mode.gameState = {
            animationId: null,
            dropInterval: 450,
        };

        const cuePromise = mode.showLevelStartCue(levelConfig, mode.gameState);

        expect(document.getElementById('odyssey-level-start-cue')).toBeTruthy();

        await mode.onStop();

        await expect(cuePromise).resolves.toBe(false);
        expect(document.getElementById('odyssey-level-start-cue')).toBeNull();
        expect(mode.entryPhase).toBe('idle');

        vi.useRealTimers();
    });

    it('reveals immediately when gameplay and theme critical readiness are both ready', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.themeRevealToken = 3;
        mode.transitionManager = {
            waitForThemeCriticalReady: vi.fn().mockResolvedValue(true),
        };
        mode._confirmFirstGameplayComposite = vi.fn().mockResolvedValue(true);
        mode._scheduleThemeFullReadySettlement = vi.fn();

        const ready = await mode._waitForEntryRevealReadiness(levelConfig, 3);

        expect(ready).toBe(true);
        expect(mode.transitionManager.waitForThemeCriticalReady).toHaveBeenCalledTimes(1);
        expect(mode.transitionManager.waitForThemeCriticalReady).toHaveBeenCalledWith(levelConfig, 900);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenCalledWith(2600);
        expect(mode._scheduleThemeFullReadySettlement).toHaveBeenCalledWith(levelConfig, 3, {
            safePresentation: false,
        });
    });

    it('falls back to a neutral backdrop when critical readiness misses the reveal window', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.themeRevealToken = 7;
        mode.transitionManager = {
            waitForThemeCriticalReady: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false),
        };
        mode._confirmFirstGameplayComposite = vi.fn().mockResolvedValue(true);
        mode._showNeutralThemeFallbackBackdrop = vi.fn();
        mode._scheduleThemeFullReadySettlement = vi.fn();

        const ready = await mode._waitForEntryRevealReadiness(levelConfig, 7);

        expect(ready).toBe(true);
        expect(mode.transitionManager.waitForThemeCriticalReady).toHaveBeenNthCalledWith(1, levelConfig, 900);
        expect(mode.transitionManager.waitForThemeCriticalReady).toHaveBeenNthCalledWith(2, levelConfig, 1400);
        expect(mode._showNeutralThemeFallbackBackdrop).toHaveBeenCalledTimes(1);
        expect(mode._scheduleThemeFullReadySettlement).toHaveBeenCalledWith(levelConfig, 7, {
            safePresentation: true,
        });
    });

    it('rejects stale reveal readiness when the entry token has been superseded', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.themeRevealToken = 11;
        mode.transitionManager = {
            waitForThemeCriticalReady: vi.fn().mockResolvedValue(true),
        };
        mode._confirmFirstGameplayComposite = vi.fn().mockImplementation(async () => {
            mode.themeRevealToken = 12;
            return true;
        });
        mode._scheduleThemeFullReadySettlement = vi.fn();

        const ready = await mode._waitForEntryRevealReadiness(levelConfig, 11);

        expect(ready).toBe(false);
        expect(mode._scheduleThemeFullReadySettlement).not.toHaveBeenCalled();
    });

    it('retries a slow first gameplay composite before aborting the entry', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.themeRevealToken = 21;
        mode.transitionManager = {
            waitForThemeCriticalReady: vi.fn().mockResolvedValue(true),
        };
        mode._confirmFirstGameplayComposite = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        mode._showNeutralThemeFallbackBackdrop = vi.fn();
        mode._scheduleThemeFullReadySettlement = vi.fn();

        const ready = await mode._waitForEntryRevealReadiness(levelConfig, 21);

        expect(ready).toBe(true);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenNthCalledWith(1, 2600);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenNthCalledWith(2, 2200);
        expect(mode._showNeutralThemeFallbackBackdrop).not.toHaveBeenCalled();
        expect(mode._scheduleThemeFullReadySettlement).toHaveBeenCalledWith(levelConfig, 21, {
            safePresentation: false,
        });
    });

    it('falls back to a guarded reveal when the first gameplay composite stays slow', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig();
        mode.themeRevealToken = 22;
        mode.transitionManager = {
            waitForThemeCriticalReady: vi.fn().mockResolvedValue(true),
        };
        mode._confirmFirstGameplayComposite = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(false);
        mode._showNeutralThemeFallbackBackdrop = vi.fn();
        mode._scheduleThemeFullReadySettlement = vi.fn();

        const ready = await mode._waitForEntryRevealReadiness(levelConfig, 22);

        expect(ready).toBe(true);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenNthCalledWith(1, 2600);
        expect(mode._confirmFirstGameplayComposite).toHaveBeenNthCalledWith(2, 2200);
        expect(mode._showNeutralThemeFallbackBackdrop).toHaveBeenCalledTimes(1);
        expect(mode._scheduleThemeFullReadySettlement).toHaveBeenCalledWith(levelConfig, 22, {
            safePresentation: true,
        });
    });

    it('gives heavy Odyssey entries a longer blackout hold budget', () => {
        const { mode } = createMode();
        const timings = mode._buildJourneyEntryTimings(createLevelConfig(24, {
            theme: {
                primary: 'crystal-cave',
                transitionIn: 'crossfade',
            },
            mechanics: {
                baseMode: 'infinity',
                board: {
                    columns: 10,
                    rows: 24,
                    startingRows: 4,
                },
            },
        }));

        expect(timings.maxBlackoutHoldMs).toBeGreaterThan(5200);
        expect(timings.maxBlackoutHoldMs).toBe(8900);
    });

    it('board play button captures the selected level immediately for launch', () => {
        const { mode } = createMode();
        mode.selectedLevelId = 7;
        mode.launchOdysseyLevel = vi.fn();

        mode._createBoardInfoOverlay();

        const playBtn = document.getElementById('level-panel-play-btn');
        playBtn.click();
        mode.selectedLevelId = 9;

        expect(mode.launchOdysseyLevel).toHaveBeenCalledTimes(1);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(7, { source: 'board-panel' });
    });

    it('restores the 3D board surface on entry abort without reopening the legacy selector', async () => {
        window.settings = { effectQuality: 'High' };
        window.setTimeout = vi.fn(() => 1);
        window.clearTimeout = vi.fn();

        const { mode } = createMode();
        const levelConfig = createLevelConfig(20, { id: 4 });

        mode.odysseyState.isLevelUnlocked = vi.fn(() => true);
        mode.levelRegistry.resolveLevelPresentation = vi.fn(() => levelConfig);
        mode._captureBoardTrack = vi.fn();
        mode._resetLevelMetrics = vi.fn();
        mode._resolveJourneyEntryAnchor = vi.fn(() => ({ x: 0.5, y: 0.5, worldPosition: null }));
        mode._buildJourneyEntryPalette = vi.fn(() => ({}));
        mode._prefetchLevelAssets = vi.fn().mockResolvedValue(true);
        mode._setTransitionMusicDuck = vi.fn();
        mode._restoreTransitionMusicDuck = vi.fn();
        mode._prepareGameplayReveal = vi.fn().mockResolvedValue(true);
        mode._activateLevelThemeVisuals = vi.fn().mockResolvedValue(false);
        mode.prepareLevelStart = vi.fn().mockResolvedValue(true);
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showLevelSelectUI = vi.fn();
        mode._updateLevelPreview = vi.fn();
        mode.boardController = {
            teardownInteraction: vi.fn(),
            setupInteraction: vi.fn(),
            pauseRendering: vi.fn(),
            resumeRendering: vi.fn(),
            travelToLevel: vi.fn().mockResolvedValue(true),
        };

        mode.journeyEntryTransition = {
            play: vi.fn().mockImplementation(async ({ callbacks }) => {
                const ready = await callbacks.onBlackoutReached();
                if (ready === false) {
                    await callbacks.onAbort({ reason: 'blackout-callback-rejected' });
                    return { success: false, aborted: true, reason: 'blackout-callback-rejected' };
                }
                return { success: true, aborted: false };
            }),
        };

        const entered = await mode.launchOdysseyLevel(levelConfig.id, { source: 'board-panel' });
        await Promise.resolve();
        await Promise.resolve();

        expect(entered).toBe(false);
        expect(mode._showLevelSelectUI).not.toHaveBeenCalled();
        expect(mode.boardController.resumeRendering).toHaveBeenCalledTimes(1);
        expect(mode.boardController.setupInteraction).toHaveBeenCalledTimes(1);
        expect(mode._updateLevelPreview).toHaveBeenCalledWith(levelConfig.id);
        expect(mode.selectedLevelId).toBe(levelConfig.id);
    });

    it('navigator launches focus the board before starting the shared launcher', async () => {
        const { mode } = createMode();
        const levelConfig = createLevelConfig(20, { id: 6, chapterLevel: 1 });
        const order = [];

        mode.isInBoardView = true;
        mode.odysseyState.getProgressSummary = vi.fn(() => ({
            totalStars: 12,
            maxStars: 168,
            overallProgress: 18,
            currentLevel: 6,
        }));
        mode.odysseyState.getChapterProgress = vi.fn(() => ({ stars: 3, maxStars: 24 }));
        mode.odysseyState.isLevelUnlocked = vi.fn(() => true);
        mode.odysseyState.isLevelCompleted = vi.fn(() => false);
        mode.odysseyState.getLevelStars = vi.fn(() => 0);
        mode.levelRegistry.getAllChapters = vi.fn(() => [{ id: 1, name: 'Chapter One' }]);
        mode.levelRegistry.getLevelsInChapter = vi.fn(() => [levelConfig]);
        mode.boardController = {
            travelToLevel: vi.fn().mockImplementation(async () => {
                order.push('travel');
                return true;
            }),
        };
        mode.launchOdysseyLevel = vi.fn().mockImplementation(async () => {
            order.push('launch');
            return true;
        });

        mode._ensureOdysseyNavigatorButton();
        mode.openOdysseyNavigator();

        const selectorBtn = document.querySelector('.odyssey-level-btn');
        selectorBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['travel', 'launch']);
        expect(mode.launchOdysseyLevel).toHaveBeenCalledWith(levelConfig.id, { source: 'selector' });
        expect(mode._isOdysseyNavigatorOpen()).toBe(false);
    });

    it('returnToBoard waits for board rebuild before restoring inputs', async () => {
        const { mode } = createMode();
        const order = [];
        let releaseBoardReady = null;

        mode.currentLevelId = 9;
        mode.currentLevelConfig = createLevelConfig(20, { id: 9 });
        mode._buildJourneyEntryPalette = vi.fn(() => ({
            primary: '#112233',
            accent: '#223344',
            highlight: '#ddeeff',
            shadow: '#05070d',
        }));
        mode._buildJourneyReturnTimings = vi.fn(() => ({ maxBlackoutHoldMs: 1600 }));
        mode._resolveJourneyReturnDepartureAnchor = vi.fn(() => ({
            x: 0.42,
            y: 0.58,
            radius: 0.16,
            onScreen: true,
        }));
        mode._resolveJourneyReturnArrivalAnchor = vi.fn(() => ({
            x: 0.74,
            y: 0.24,
            radius: 0.14,
            onScreen: true,
        }));
        mode.onStop = vi.fn().mockResolvedValue();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showBoardView = vi.fn().mockImplementation(async () => {
            order.push('show-board');
            await new Promise((resolve) => {
                releaseBoardReady = resolve;
            });
            order.push('board-ready');
            return true;
        });
        mode._unlockOdysseyBoardAfterLaunchAttempt = vi.fn(() => {
            order.push('unlock');
        });
        mode.setOdysseyNavigatorButtonVisible = vi.fn((visible) => {
            order.push(`nav-${visible}`);
        });
        mode._restoreInputs = vi.fn(() => {
            order.push('restore-inputs');
        });
        mode.journeyReturnTransition = {
            play: vi.fn().mockImplementation(async ({ callbacks }) => {
                order.push('play');
                const blackoutResult = await callbacks.onBlackoutReached();
                order.push(`arrival-${blackoutResult.arrivalAnchor.x}`);
                await callbacks.onRevealStart();
                order.push('reveal');
                await callbacks.onComplete();
                order.push('complete');
                return { success: true, aborted: false };
            }),
        };

        const returnPromise = mode.returnToBoard();
        await Promise.resolve();
        await Promise.resolve();

        expect(order).toEqual(['play', 'show-board']);
        expect(mode._restoreInputs).not.toHaveBeenCalled();

        releaseBoardReady();
        await returnPromise;

        expect(order).toEqual([
            'play',
            'show-board',
            'board-ready',
            'arrival-0.74',
            'unlock',
            'nav-true',
            'reveal',
            'restore-inputs',
            'complete',
        ]);
        expect(mode._showBoardView).toHaveBeenCalledWith({
            showLoadingOverlay: false,
            minOverlayDisplayMs: 0,
            focusLevelId: 9,
            keepBoardLocked: true,
        });
    });

    it('returnToBoard rebuilds the board focused on the completed level', async () => {
        const { mode } = createMode();

        mode.currentLevelId = 12;
        mode.currentLevelConfig = createLevelConfig(20, { id: 12 });
        mode._buildJourneyEntryPalette = vi.fn(() => ({
            primary: '#112233',
            accent: '#223344',
            highlight: '#ddeeff',
            shadow: '#05070d',
        }));
        mode._buildJourneyReturnTimings = vi.fn(() => ({ maxBlackoutHoldMs: 1600 }));
        mode._resolveJourneyReturnDepartureAnchor = vi.fn(() => ({
            x: 0.4,
            y: 0.6,
            radius: 0.16,
            onScreen: true,
        }));
        mode._resolveJourneyReturnArrivalAnchor = vi.fn(() => ({
            x: 0.61,
            y: 0.31,
            radius: 0.12,
            onScreen: true,
        }));
        mode.onStop = vi.fn().mockResolvedValue();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showBoardView = vi.fn().mockResolvedValue(true);
        mode._unlockOdysseyBoardAfterLaunchAttempt = vi.fn();
        mode.setOdysseyNavigatorButtonVisible = vi.fn();
        mode._restoreInputs = vi.fn();
        mode.journeyReturnTransition = {
            play: vi.fn().mockImplementation(async ({ callbacks }) => {
                const blackoutResult = await callbacks.onBlackoutReached();
                expect(blackoutResult).toEqual({
                    arrivalAnchor: {
                        x: 0.61,
                        y: 0.31,
                        radius: 0.12,
                        onScreen: true,
                    },
                });
                await callbacks.onRevealStart();
                await callbacks.onComplete();
                return { success: true, aborted: false };
            }),
        };

        await expect(mode.returnToBoard()).resolves.toBe(true);

        expect(mode._showBoardView).toHaveBeenCalledWith({
            showLoadingOverlay: false,
            minOverlayDisplayMs: 0,
            focusLevelId: 12,
            keepBoardLocked: true,
        });
        expect(mode._resolveJourneyReturnArrivalAnchor).toHaveBeenCalledWith(12);
    });

    it('returnToBoard abort fallback never re-shows the raw gameplay shell', async () => {
        const { mode } = createMode();
        const {
            bgContainer,
            gameContainer,
            phaserContainer,
            statsBar,
        } = appendGameplayShell();

        mode.currentLevelId = 5;
        mode.currentLevelConfig = createLevelConfig(20, { id: 5 });
        mode._buildJourneyEntryPalette = vi.fn(() => ({
            primary: '#112233',
            accent: '#223344',
            highlight: '#ddeeff',
            shadow: '#05070d',
        }));
        mode._buildJourneyReturnTimings = vi.fn(() => ({ maxBlackoutHoldMs: 1600 }));
        mode._resolveJourneyReturnDepartureAnchor = vi.fn(() => ({
            x: 0.4,
            y: 0.6,
            radius: 0.16,
            onScreen: true,
        }));
        mode.onStop = vi.fn().mockResolvedValue();
        mode._applyBoardAudioPolicy = vi.fn().mockResolvedValue();
        mode._showBoardView = vi.fn().mockResolvedValue(true);
        mode._restoreInputs = vi.fn();
        mode.journeyReturnTransition = {
            play: vi.fn().mockImplementation(async ({ callbacks }) => {
                await callbacks.onAbort({ reason: 'blackout-callback-rejected' });
                return { success: false, aborted: true, reason: 'blackout-callback-rejected' };
            }),
        };

        await expect(mode.returnToBoard()).resolves.toBe(false);

        expect(gameContainer.style.visibility).toBe('hidden');
        expect(gameContainer.style.opacity).toBe('0');
        expect(phaserContainer.style.visibility).toBe('hidden');
        expect(phaserContainer.style.opacity).toBe('0');
        expect(statsBar.style.visibility).toBe('hidden');
        expect(statsBar.style.opacity).toBe('0');
        expect(bgContainer.style.opacity).toBe('0');
        expect(mode._showBoardView).toHaveBeenCalledWith({
            showLoadingOverlay: false,
            minOverlayDisplayMs: 0,
            focusLevelId: 5,
            keepBoardLocked: false,
        });
    });

    it('initializes the board from resolved level presentations and registry layout', async () => {
        window.settings = { effectQuality: 'High' };

        const { mode } = createMode();
        const initializeSpy = vi.spyOn(OdysseyBoardController.prototype, 'initialize')
            .mockResolvedValue();
        const completionSpy = vi.spyOn(mode.odysseyState, 'getLevelCompletion')
            .mockImplementation((levelId) => (levelId === 1 ? { stars: 2 } : null));
        mode.odysseyState.unlockedLevels = new Set([1, 2, 3]);
        mode.transitionManager = {
            preInitWarp: vi.fn(),
        };

        await mode._initializeOdysseyBoard();

        expect(initializeSpy).toHaveBeenCalledTimes(1);
        const [levelData, progressData, presentationLayout] = initializeSpy.mock.calls[0];
        expect(completionSpy).toHaveBeenCalledTimes(mode.levelRegistry.getTotalLevels());
        expect(levelData[0]).toMatchObject({
            id: 1,
            pathPosition: 0,
            iconThemeId: 'cinder-drift',
            transitionPaletteThemeId: 'cinder-drift',
        });
        expect(levelData.at(-1)).toMatchObject({
            id: 59,
            pathPosition: 1,
        });
        expect(progressData).toMatchObject({
            furthestLevel: 3,
            levelProgress: {
                1: {
                    completed: true,
                    stars: 2,
                },
            },
        });
        expect(presentationLayout).toEqual(mode.levelRegistry.getPresentationLayout());
    });
});
