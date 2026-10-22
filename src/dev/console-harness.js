/**
 * Console test helpers for multiplayer work: window.testMultiplayer / testLobby /
 * testPostMatch, the one-machine local MP harness (?localMp=host|join|watch|browse and
 * localMpHost() / localMpJoin() / localMpWatch() / localMpBrowse()) and the __getFfa /
 * __getMode debug handles. scripts/mp-soak.mjs and scripts/menu-art/stage.js drive them on
 * the dev server.
 *
 * Dev builds only (npm run dev, npm run dev:electron), or a build made with
 * VITE_DEV_HARNESS=1: main.js loads this module behind that check, so players never get a
 * console that starts lobbies with dummy players or auto-joins from a URL.
 */
import { GAME_MODES } from '../core/constants.js';
import { introAnimation } from '../ui/intro-animation.js';

/** @param {any} app the SerenityBlocks app */
export function installConsoleHarness(app) {
    const prepareForMatchStart = async () => {
        const startModal = document.getElementById('start-modal');
        if (startModal) {
            startModal.classList.remove('visible');
        }
        document.body.classList.remove('start-modal-open');

        if (app.modalManager) {
            app.modalManager.hideAll();
        }
        if (app.gamepadController?.disableMenuNavigation) {
            app.gamepadController.disableMenuNavigation();
        }
        if (app.gamepadController?.disableGameModeSelection) {
            app.gamepadController.disableGameModeSelection();
        }

        if (introAnimation?.dismiss) {
            introAnimation.dismiss();
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
    };

    const ensureOnlineMultiplayerMode = async () => {
        const currentMode = app.gameModeManager.getCurrentModeId();
        if (currentMode !== GAME_MODES.ONLINE_MULTIPLAYER) {
            console.log('🧪 [TEST] Switching to online multiplayer mode...');
            await app.gameModeManager.stopCurrentMode();
            await app.gameModeManager.deactivateCurrentMode();
            await prepareForMatchStart();
            await app.gameModeManager.activateMode(GAME_MODES.ONLINE_MULTIPLAYER);
            await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
            await prepareForMatchStart();
        }

        const activeMode = app.gameModeManager.getCurrentMode();
        if (activeMode && !activeMode.isRunning) {
            await app.gameModeManager.startCurrentMode();
        }

        const onlineMode = app.gameModeManager.getMode(GAME_MODES.ONLINE_MULTIPLAYER);
        if (!onlineMode) {
            throw new Error('Online multiplayer mode not available');
        }

        return onlineMode;
    };

    const populateTestPlayers = (ffaGameState, numPlayers) => {
        const dummyNames = [
            'TestBot_Alpha',
            'TestBot_Beta',
            'TestBot_Gamma',
            'TestBot_Delta',
            'TestBot_Epsilon',
            'TestBot_Zeta',
            'TestBot_Eta',
            'TestBot_Theta',
            'TestBot_Iota',
        ];

        for (let i = 1; i < numPlayers; i++) {
            const dummyId = `dummy_${i}_${Date.now()}`;
            const dummyName = dummyNames[i - 1] || `DummyPlayer_${i}`;

            ffaGameState.addPlayer(dummyId, dummyName, false);

            const player = ffaGameState.players.get(dummyId);
            if (player) {
                player.isReady = true;
            }
        }

        const localPlayer = ffaGameState.getLocalPlayer?.();
        if (localPlayer) {
            localPlayer.isReady = true;
        }
    };

    window.testMultiplayer = async (numPlayers = 4) => {
        try {
            console.log(`🧪 [TEST] Creating test lobby with ${numPlayers} players...`);
            const onlineMode = await ensureOnlineMultiplayerMode();
            const playerCount = Math.max(2, Math.min(8, numPlayers));

            console.log('🧪 [TEST] Creating test lobby...');
            const config = {
                gameName: 'TEST LOBBY',
                maxPlayers: playerCount,
                lobbyType: 'public',
                endCondition: 'frags',
                endConditionValue: 10,
                boringRules: false,
            };

            await onlineMode.handleCreateLobby(config);
            await prepareForMatchStart();

            if (onlineMode.lobbyBrowser?.hide) {
                onlineMode.lobbyBrowser.hide();
            }
            if (onlineMode.matchConfigModal?.hide) {
                onlineMode.matchConfigModal.hide();
            }

            const { ffaGameState } = onlineMode;
            if (!ffaGameState) {
                throw new Error('Failed to create game state');
            }

            console.log('🧪 [TEST] Adding dummy players...');
            populateTestPlayers(ffaGameState, playerCount);

            if (ffaGameState.isHost) {
                ffaGameState.broadcastPlayerList();
            }

            if (onlineMode.lobbyWaitingRoom?.startMatch) {
                onlineMode.lobbyWaitingRoom.startMatch();
            } else if (ffaGameState.startMatch) {
                ffaGameState.startMatch();
            }

            console.log(`✅ [TEST] Test lobby created with ${playerCount} players!`);
            console.log('📋 [TEST] All dummy players are auto-ready');
            console.log('🎮 [TEST] Match starting automatically (lobby flow)');

            return {
                lobbyId: onlineMode.currentLobbyId,
                players: Array.from(ffaGameState.players.values()).map((p) => ({
                    name: p.name,
                    steamId: p.steamId,
                    isReady: p.isReady,
                    color: p.color,
                })),
            };
        } catch (err) {
            console.error('❌ [TEST] Failed to create test lobby:', err);
            throw err;
        }
    };

    window.testLobby = async (numPlayers = 4) => {
        try {
            const onlineMode = await ensureOnlineMultiplayerMode();
            const playerCount = Math.max(2, Math.min(8, numPlayers));
            console.log(`🧪 [TEST] Creating ready lobby with ${playerCount} players...`);

            const config = {
                gameName: 'READY LOBBY',
                maxPlayers: playerCount,
                lobbyType: 'public',
                endCondition: 'frags',
                endConditionValue: 10,
                boringRules: false,
            };

            await onlineMode.handleCreateLobby(config);
            await prepareForMatchStart();

            if (onlineMode.lobbyBrowser?.hide) {
                onlineMode.lobbyBrowser.hide();
            }
            if (onlineMode.matchConfigModal?.hide) {
                onlineMode.matchConfigModal.hide();
            }

            const { ffaGameState } = onlineMode;
            if (!ffaGameState) {
                throw new Error('Failed to create game state');
            }

            populateTestPlayers(ffaGameState, playerCount);

            if (ffaGameState.isHost) {
                ffaGameState.broadcastPlayerList();
            }

            console.log(`✅ [TEST] Ready lobby created with ${playerCount} players.`);
            console.log('📋 [TEST] All players are ready. Start the match from the lobby UI.');

            return {
                lobbyId: onlineMode.currentLobbyId,
                players: Array.from(ffaGameState.players.values()).map((p) => ({
                    name: p.name,
                    steamId: p.steamId,
                    isReady: p.isReady,
                    color: p.color,
                })),
            };
        } catch (err) {
            console.error('❌ [TEST] Failed to create ready lobby:', err);
            throw err;
        }
    };

    window.testPostMatch = async (numPlayers = 4) => {
        try {
            const onlineMode = await ensureOnlineMultiplayerMode();
            if (onlineMode._ensureMatchResultsModal) {
                onlineMode._ensureMatchResultsModal();
            }

            const playerCount = Math.max(2, numPlayers);
            const now = Date.now();
            const dummyNames = [
                'Nova',
                'Pulse',
                'Vortex',
                'Blaze',
                'Echo',
                'Quanta',
                'Flux',
                'Zenith',
                'Comet',
                'Rift',
            ];

            const finalStats = Array.from({ length: playerCount }).map((_, index) => {
                const placement = index + 1;
                const frags = Math.max(0, (playerCount - index) * 2);
                return {
                    steamId: `post_${index}_${now}`,
                    name: dummyNames[index] || `Player_${index + 1}`,
                    placement,
                    frags,
                    deaths: Math.max(0, index - 1),
                    score: frags * 1000 + (playerCount - index) * 250,
                    lines: 12 + index * 3,
                    bpm: 90 + index * 6,
                    ppm: 40 + index * 4,
                    apm: 70 + index * 5,
                    color: `hsl(${(index * 45) % 360}, 70%, 55%)`,
                };
            });

            const winner = finalStats[0];
            const killFeed = finalStats.slice(1, Math.min(finalStats.length, 6)).map((entry, idx) => ({
                killer: winner.name,
                victim: entry.name,
                timestamp: now - idx * 15000,
            }));

            const results = {
                isGameOver: true,
                winner: winner.steamId,
                winnerName: winner.name,
                endCondition: 'frags',
                endConditionValue: 10,
                duration: 6 * 60 * 1000 + 32000,
                finalStats,
                killFeed,
            };

            const localPlayerId = finalStats[0]?.steamId;
            onlineMode.matchResultsModal?.show(results, {
                isHost: true,
                localPlayerId,
                gameState: {
                    chatHistory: [
                        { playerName: winner.name, text: 'GGs!' },
                        { playerName: finalStats[1]?.name, text: 'Nice match.' },
                        { text: 'Match ended. Returning to lobby soon.' },
                    ],
                },
            });

            console.log(`✅ [TEST] Match results shown for ${playerCount} players.`);
            return results;
        } catch (err) {
            console.error('❌ [TEST] Failed to show post-match modal:', err);
            throw err;
        }
    };

    // ── LOCAL 2-PLAYER TEST (one machine, NO Steam, NO second PC) ───────────────
    // The browser / no-Steam build runs MOCK P2P over BroadcastChannel + lobbies in
    // localStorage, so two BROWSER WINDOWS are a real host + peer running the actual
    // netcode. Open the dev server in two windows:
    //   window 1: http://localhost:5173/?localMp=host
    //   window 2: http://localhost:5173/?localMp=join
    // (or call window.localMpHost() / window.localMpJoin() in each window's console).
    // maxPlayers defaults to 8 (FFA) so a started 2-window match still has open
    // slots — required to exercise drop-in ("Join (next round)") + spectator/full-roster
    // from a 3rd window (?localMp=browse). Pass {maxPlayers:2} for a strict 1v1 cap test.
    window.localMpHost = async ({ autoStart = true, maxPlayers = 8 } = {}) => {
        const onlineMode = await ensureOnlineMultiplayerMode();
        await onlineMode.handleCreateLobby({
            gameName: 'LOCAL TEST',
            maxPlayers,
            lobbyType: 'public',
            endCondition: 'frags',
            endConditionValue: 5,
            boringRules: false,
        });
        console.log('🧪 [LOCAL MP] Hosting. Open a 2nd window with ?localMp=join (or run localMpJoin()).');
        if (autoStart) {
            // Auto-ready + auto-start once the peer joins → one-click into a match.
            const fg = onlineMode.ffaGameState;
            let hostReadied = false;
            const poll = setInterval(() => {
                if (!fg || fg.gamePhase === 'playing') { clearInterval(poll); return; }
                if (fg.players.size >= 2 && !hostReadied) { fg.setReady?.(true); hostReadied = true; }
                if (hostReadied && fg.allPlayersReady?.()) {
                    clearInterval(poll);
                    console.log('🧪 [LOCAL MP] All ready → starting match');
                    // Start EXACTLY ONCE. lobbyWaitingRoom.startMatch() calls
                    // gameState.startMatch() internally and returns undefined, so the old
                    // `?? fg.startMatch()` fired a SECOND start (different seed) → two board
                    // scenes + two state-sync loops → empty main board + opponent stutter.
                    if (onlineMode.lobbyWaitingRoom?.startMatch) {
                        onlineMode.lobbyWaitingRoom.startMatch();
                    } else {
                        fg.startMatch?.();
                    }
                }
            }, 600);
            setTimeout(() => clearInterval(poll), 90000);
        }
        return onlineMode.currentLobbyId;
    };
    window.localMpJoin = async () => {
        const onlineMode = await ensureOnlineMultiplayerMode();
        // The host's mock lobby lands in shared localStorage; poll briefly in case
        // the host window hasn't created it yet.
        let lobbyId = null;
        for (let i = 0; i < 40 && !lobbyId; i++) {
            const lobbies = (await onlineMode.steamNetworking?.getLobbies?.().catch(() => [])) || [];
            if (lobbies.length) lobbyId = lobbies[lobbies.length - 1].id;
            if (!lobbyId) await new Promise((r) => setTimeout(r, 500));
        }
        if (!lobbyId) {
            console.warn('🧪 [LOCAL MP] No mock lobby found — start the host window (?localMp=host) first.');
            return null;
        }
        await onlineMode.handleJoinLobby(lobbyId);
        // Auto-ready so the host's barrier completes and the match starts.
        setTimeout(() => onlineMode.ffaGameState?.setReady?.(true), 800);
        console.log('🧪 [LOCAL MP] Joined', lobbyId, '— readied up.');
        return lobbyId;
    };
    // Join a running/lobby match as a WATCH-ONLY spectator (no board, no input).
    window.localMpWatch = async () => {
        const onlineMode = await ensureOnlineMultiplayerMode();
        let lobbyId = null;
        for (let i = 0; i < 40 && !lobbyId; i++) {
            const lobbies = (await onlineMode.steamNetworking?.getLobbies?.().catch(() => [])) || [];
            if (lobbies.length) lobbyId = lobbies[lobbies.length - 1].id;
            if (!lobbyId) await new Promise((r) => setTimeout(r, 500));
        }
        if (!lobbyId) {
            console.warn('🧪 [LOCAL MP] No mock lobby found — start the host window (?localMp=host) first.');
            return null;
        }
        await onlineMode.handleJoinLobby(lobbyId, { asSpectator: true });
        console.log('🧪 [LOCAL MP] Spectating', lobbyId);
        return lobbyId;
    };
    // Open the LOBBY BROWSER without auto-joining — this is the path that actually
    // shows the per-lobby Join / "Join (next round)" / 👁 Watch buttons. Use this
    // (not ?localMp=join, which auto-joins past the browser) to see the buttons a
    // late arrival gets against an already-started host.
    window.localMpBrowse = async () => {
        const onlineMode = await ensureOnlineMultiplayerMode();
        await onlineMode.showLobbyBrowser?.();
        console.log('🧪 [LOCAL MP] Lobby browser open — pick a lobby (Join / Join next round / 👁 Watch).');
        return onlineMode.currentLobbyId || null;
    };
    // Debug handle: stable accessor to the live FFA game state for profiling/diagnostics.
    window.__getFfa = () => {
        try {
            return app.gameModeManager.getMode(GAME_MODES.ONLINE_MULTIPLAYER)?.ffaGameState || null;
        } catch {
            return null;
        }
    };
    // Debug handle: the live OnlineMultiplayerMode (for the opponent watcher, render glue, etc.).
    window.__getMode = () => {
        try {
            return app.gameModeManager.getMode(GAME_MODES.ONLINE_MULTIPLAYER) || null;
        } catch {
            return null;
        }
    };
    const __localMpRole = new URLSearchParams(window.location.search).get('localMp');
    if (__localMpRole === 'host') {
        window.localMpHost().catch((e) => console.error('🧪 [LOCAL MP] host auto-start failed:', e));
    } else if (__localMpRole === 'join') {
        window.localMpJoin().catch((e) => console.error('🧪 [LOCAL MP] join auto-start failed:', e));
    } else if (__localMpRole === 'watch') {
        window.localMpWatch().catch((e) => console.error('🧪 [LOCAL MP] watch auto-start failed:', e));
    } else if (__localMpRole === 'browse') {
        window.localMpBrowse().catch((e) => console.error('🧪 [LOCAL MP] browse failed:', e));
    }

    console.log('🧪 Test functions available:');
    console.log('  - window.testMultiplayer(numPlayers) - Create test lobby with dummy players');
    console.log('    Example: testMultiplayer(5)');
    console.log('  - window.testLobby(numPlayers) - Create ready lobby without auto-start');
    console.log('    Example: testLobby(8)');
    console.log('  - window.testPostMatch(numPlayers) - Show match results modal');
    console.log('    Example: testPostMatch(9)');
    console.log('  - LOCAL 2P (no Steam): open ?localMp=host and ?localMp=join in two windows');
}
