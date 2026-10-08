#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-await-in-loop -- Audio cases run serially so their fades cannot overlap. */
/**
 * Isolated Odyssey music-readiness probe against an existing Vite development server.
 * Imports the real SoundManager and shipped MP3s without booting game/rendering scenes.
 * Compares full-fade synchronization with playback readiness in disposable contexts.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(args) {
    const config = {
        baseUrl: process.env.ODYSSEY_FLOW_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:5173',
        out: path.resolve('artifacts/odyssey-audio'),
        executablePath: process.env.CHROMIUM_PATH,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') config.help = true;
        else if (['--base-url', '--out'].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
            if (arg === '--base-url') config.baseUrl = value;
            else config.out = path.resolve(value);
        } else throw new Error(`Unknown argument: ${arg}`);
    }
    const base = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Base URL must use HTTP or HTTPS');
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    config.appUrl = base.href;
    config.probeUrl = new URL('__odyssey-audio-probe', base).href;
    config.moduleUrl = new URL('src/audio/sound-manager.js', base).href;
    return config;
}

async function loadPlaywright() {
    try {
        // eslint-disable-next-line import/no-unresolved -- Optional external validation tooling.
        return await import('playwright');
    } catch (error) {
        if (!process.env.PLAYWRIGHT_MODULE) {
            throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to its module file; '
                + 'this script does not install project dependencies.', { cause: error });
        }
        const target = process.env.PLAYWRIGHT_MODULE;
        return import(target.startsWith('file:') ? target : pathToFileURL(path.resolve(target)).href);
    }
}

async function measurePolicy(browser, config, waitForFade) {
    const policy = waitForFade ? 'full-fade' : 'playback-ready';
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const consoleLog = [];
    const pageErrors = [];
    const consoleErrors = [];
    page.on('console', (message) => {
        consoleLog.push(`${message.type()}: ${message.text()}`);
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    // This document has no game entry script and never reads a persistent user profile.
    await page.route(config.probeUrl, (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Odyssey audio readiness probe</title>'
            + '<link rel="icon" href="data:,"><button id="start">Start audio probe</button>',
    }));
    try {
        await page.goto(config.probeUrl, { waitUntil: 'domcontentloaded' });
        await page.evaluate(async ({ moduleUrl, appUrl }) => {
            const base = document.createElement('base');
            base.href = appUrl;
            document.head.appendChild(base);
            const { SoundManager } = await import(moduleUrl);
            const manager = new SoundManager();
            window.__audioProbeManager = manager;
            const settings = { themeLinkedMode: false, autoThemeChange: false };
            manager.settingsManager = {
                get: () => settings,
                update: (changes) => Object.assign(settings, changes),
                save: () => {},
            };
            manager.musicVolume = 0.35;
            await manager.initializeTracks();
            if (!['CinderDrift', 'CrystalCave'].every((track) => manager.trackNames.includes(track))) {
                throw new Error('The shipped CinderDrift and CrystalCave tracks are required for this fixture');
            }
            manager.musicTrack = 'CinderDrift';
            document.getElementById('start').onclick = () => {
                // A real click authorizes playback. Never bypass autoplay policy or mute the probe.
                manager.resumeAudioContext();
                window.__audioProbeStarted = manager.startBackgroundMusic({
                    fadeInMs: 0, reason: 'odyssey-audio-probe-source',
                });
            };
        }, { moduleUrl: config.moduleUrl, appUrl: config.appUrl });
        await page.click('#start');
        await page.evaluate(() => window.__audioProbeStarted);
        const result = await page.evaluate(async (shouldWaitForFade) => {
            const manager = window.__audioProbeManager;
            const state = () => ({
                selected: manager.musicTrack,
                actual: manager.getActualTrackKey(),
                playing: manager.isMusicPlaying(),
                paused: manager.audioElement?.paused,
                ended: manager.audioElement?.ended,
                currentTime: manager.audioElement?.currentTime,
                readyState: manager.audioElement?.readyState,
                muted: manager.isMuted,
                volume: manager.musicVolume,
                gain: manager._getCurrentMusicVolume(),
                contextState: manager.audioContext?.state,
                gainWired: manager.musicGainWired,
                pending: manager.pendingTrackKey,
            });
            const initial = state();
            if (!initial.playing || initial.contextState !== 'running'
                || initial.muted || initial.gain <= 0 || initial.actual !== 'CinderDrift') {
                throw new Error(`Source audio is not playing; autoplay/device failure: ${JSON.stringify(initial)}`);
            }
            const tests = [];
            async function run(name, themeLinkedMode, theme, expectedTrack) {
                manager.settingsManager.update({ themeLinkedMode });
                const before = state();
                const startedAt = performance.now();
                const trace = [];
                const mark = (kind, extra = {}) => trace.push({
                    kind, ms: performance.now() - startedAt, ...state(), ...extra,
                });
                const events = ['loadstart', 'loadeddata', 'canplay', 'play', 'playing',
                    'pause', 'waiting', 'error', 'volumechange'];
                const listeners = events.map((kind) => {
                    const listener = () => mark(kind);
                    manager.audioElement.addEventListener(kind, listener);
                    return [kind, listener];
                });
                const originalFade = manager.fadeMusicVolume;
                manager.fadeMusicVolume = async function observeFade(target, duration) {
                    mark('fade-start', { target, duration });
                    await originalFade.call(this, target, duration);
                    mark('fade-complete', { target, duration });
                };
                try {
                    mark('activate-theme-music');
                    manager.applyThemeLinkedMusic(theme);
                    manager.resumeThemeLinkedMusic(true);
                    const playbackAtRequest = state();
                    await manager.ensureTrackPlaybackSynced({
                        reason: 'odyssey-level-entry', force: true, waitForFade: shouldWaitForFade,
                    });
                    mark('sync-resolved');
                    const atReadiness = state();
                    const syncMs = performance.now() - startedAt;
                    // Complete the owned fade before the next case; never truncate audio to save time.
                    await manager.trackSwitchPromise;
                    mark('full-switch-resolved');
                    const after = state();
                    const playing = trace.find((event) => event.kind === 'playing');
                    tests.push({
                        name,
                        themeLinkedMode,
                        theme,
                        expectedTrack,
                        before,
                        playbackAtRequest,
                        atReadiness,
                        after,
                        syncMs,
                        fullSwitchMs: performance.now() - startedAt,
                        newTrackPlayingMs: playing?.ms ?? null,
                        syncWaitAfterPlayingMs: playing ? syncMs - playing.ms : null,
                        trace,
                    });
                } finally {
                    manager.fadeMusicVolume = originalFade;
                    for (const [kind, listener] of listeners) manager.audioElement.removeEventListener(kind, listener);
                }
            }
            await run('Same source; theme linking disabled', false, 'cinder-drift', 'CinderDrift');
            await run('Different theme; default theme linking disabled', false, 'crystal-cave', 'CinderDrift');
            await run('Changed track; theme linking enabled', true, 'crystal-cave', 'CrystalCave');
            await run('Same track; theme linking enabled', true, 'crystal-cave', 'CrystalCave');
            await run('Changed track returning; theme linking enabled', true, 'cinder-drift', 'CinderDrift');
            return {
                initial,
                defaultFadeOutMs: manager.trackFadeOutMs,
                defaultFadeInMs: manager.trackFadeInMs,
                tests,
            };
        }, waitForFade);
        // No platform timing thresholds: require honest playback and preserve the full fade outcome.
        for (const test of result.tests) {
            assert.equal(test.atReadiness.actual, test.expectedTrack, `${test.name}: wrong source at readiness`);
            assert.equal(test.atReadiness.playing, true, `${test.name}: readiness preceded playback`);
            assert.equal(test.atReadiness.contextState, 'running', `${test.name}: audio context is suspended`);
            assert.equal(test.after.playing, true, `${test.name}: playback stopped during the fade`);
            assert.equal(test.after.pending, null, `${test.name}: track switch did not settle`);
            assert.ok(Math.abs(test.after.gain - test.after.volume) < 0.001, `${test.name}: fade gain not restored`);
        }
        assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
        assert.deepEqual(consoleErrors, [], 'Browser console errors');
        return {
            policy, waitForFade, ...result, pageErrors, consoleErrors,
        };
    } finally {
        await writeFile(path.join(config.out, `${policy}-console.log`), consoleLog.join('\n'));
        await context.close();
    }
}

async function main() {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) {
        console.log(`Usage: node scripts/validate-odyssey-audio.mjs [--base-url <url>] [--out <directory>]
Environment: ODYSSEY_FLOW_BASE_URL or BASE_URL, PLAYWRIGHT_MODULE, CHROMIUM_PATH.
Requires an existing Vite development server and separately available Playwright/Chromium.
Runs five identical audio-only cases for each synchronization policy in fresh contexts.
Uses a real user gesture, shipped tracks and nonzero music volume; aborts if playback fails.
Reports media-start, readiness, fade milestones and gain, with a 120-second whole-run limit.
No game scenes, persistent profiles, storage changes or hardware performance claims.`);
        return;
    }
    await mkdir(config.out, { recursive: true });
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({
        ...(config.executablePath ? { executablePath: config.executablePath } : {}),
        headless: true,
        args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    let timedOut = false;
    const deadline = setTimeout(() => {
        timedOut = true;
        browser.close().catch(() => {});
    }, 120_000);
    const policies = [];
    try {
        for (const waitForFade of [true, false]) {
            policies.push(await measurePolicy(browser, config, waitForFade));
        }
        const report = {
            status: 'pass',
            methodology: 'Real SoundManager and shipped MP3 files in separate disposable browser contexts. '
                + 'Identical cases compare default full-fade waits with waitForFade:false. '
                + 'Each policy starts from CinderDrift after a real button click with nonzero gain. '
                + 'Only source setup disables its initial fade; measured cases keep authored fade durations.',
            limitation: 'Audio subsystem timings, not complete orb transition times, a listening evaluation, '
                + 'physical-device audibility or waveform continuity. Playback readiness can occur at zero gain '
                + 'as the preserved fade-in begins. Local server/cache conditions affect media loading.',
            policies,
        };
        await writeFile(path.join(config.out, 'result.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({
            status: report.status,
            out: config.out,
            policies: policies.map((policy) => ({
                policy: policy.policy,
                tests: policy.tests.map((test) => ({
                    name: test.name,
                    readinessMs: Math.round(test.syncMs),
                    fullSwitchMs: Math.round(test.fullSwitchMs),
                    playingMs: test.newTrackPlayingMs === null ? null : Math.round(test.newTrackPlayingMs),
                })),
            })),
        }, null, 2));
    } catch (error) {
        await writeFile(path.join(config.out, 'failure.json'), JSON.stringify({
            status: 'fail', timedOut, message: error.message, completedPolicies: policies,
        }, null, 2));
        throw error;
    } finally {
        clearTimeout(deadline);
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
