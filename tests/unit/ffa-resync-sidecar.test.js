import {
    describe, expect, it,
} from 'vitest';
import { restoreBlindTimers } from '../../src/core/blind.js';
import { rebuildBoardGridFromPieces } from '../../src/core/board.js';
import { resolveCascade } from '../../src/core/cascade-resolver.js';
import { fillBag, GameState } from '../../src/core/game.js';
import { GarbageQueue } from '../../src/core/garbage.js';
import { createSfc32Random } from '../../src/core/rng.js';
import { startDas } from '../../src/core/das.js';
import { advancePlayerInputTick, enqueueInputEdge } from '../../src/core/player-input-state.js';
import {
    applyFfaResyncSidecar,
    captureFfaResyncSidecar,
    validateFfaResyncSidecar,
} from '../../src/core/multiplayer/ffa/resync-sidecar.js';
import { seededRandom } from '../../src/utils/helpers.js';

function makePlayer(steamId, seed = 7) {
    const gameState = new GameState({
        inputHandling: { dasDelay: 85, dasInterval: 25, softDropInterval: 10 },
        lockBonusPolicy: 'legacy-max',
    });
    gameState.randomGenerator = seededRandom(seed);
    return {
        steamId,
        name: `Player ${steamId}`,
        gameState,
        garbageQueue: new GarbageQueue(),
        frags: 0,
        isAlive: true,
        awaitingSpawn: false,
        lastInputSeq: 0,
        lastAttackerId: null,
        _lockSeq: 0,
        _clearSeq: 0,
        _lastAppliedLockSeq: 0,
        _lastAppliedClearSeq: 0,
        _lastLockHostTick: null,
    };
}

function makeGame(players) {
    return {
        players: new Map(players.map((player) => [player.steamId, player])),
        simTick: 420,
        roundGeneration: 3,
        snapshotSeq: 71,
        hostTick: 88,
        migrationEpoch: 2,
        _attackSeq: 19,
        hotPotatoState: {
            enabled: true,
            holderId: players[0]?.steamId ?? null,
            previousHolderId: null,
            expiresAt: 123456,
            durationMs: 12000,
            penaltyLines: 6,
            generation: 4,
            lastEvent: { reason: 'transfer' },
        },
        attackRouter: {
            attackHistory: [{
                attackerId: 'A', targetId: 'B', lines: 4, timestamp: 100,
            }],
        },
        fragTracker: {
            deathLog: [{ deadPlayerSteamId: 'B', killerSteamId: 'A', timestamp: 101 }],
            killFeed: [{ killerId: 'A', victimId: 'B', timestamp: 101 }],
        },
    };
}

function makeSyncpoint(game) {
    return {
        status: 'idle',
        safe: true,
        simTick: game.simTick,
        roundGeneration: game.roundGeneration,
        blockers: [],
    };
}

function makeEnvelope(sidecar) {
    const { capture } = sidecar;
    return {
        header: {
            simTick: capture.simTick,
            roundGeneration: capture.roundGeneration,
            snapshotSeq: capture.snapshotSeq,
            hostTick: capture.hostTick,
            migrationEpoch: capture.migrationEpoch,
            joinSyncpoint: structuredClone(capture.joinSyncpoint),
        },
        packedSnapshot: {
            simTick: capture.simTick,
            snapshotSeq: capture.snapshotSeq,
            tick: capture.hostTick,
            players: sidecar.players.map(({ steamId }) => ({ steamId })),
        },
    };
}

function validateCaptured(sidecar) {
    return validateFfaResyncSidecar(sidecar, makeEnvelope(sidecar));
}

function configureNonDefaultState(player) {
    const { gameState } = player;
    gameState.simTickMs = 1000 / 60;
    gameState.simTimeMs = 1234;
    gameState.simFrame = 74;
    gameState.lastTime = 1200;
    gameState.dropInterval = 333;
    gameState.dropCounter = 129;
    gameState.pieceSpawnTime = 1111;
    gameState.piecesPlaced = 23;
    gameState.lockDelay = 500;
    gameState.lockDelayTicks = 30;
    gameState.lockResetLimit = 15;
    gameState.lockTimer = 200;
    gameState.lockTimerTicks = 12;
    gameState.lockResetCount = 3;
    gameState.isGrounded = true;
    gameState.lockGroundedSince = 1000;
    gameState.score = 4321;
    gameState.lines = 14;
    gameState.level = 3;
    gameState.linesUntilNextLevel = 1;
    gameState.pieceCounts = {
        I: 4, J: 3, L: 2, O: 1, S: 5, T: 6, Z: 7,
    };
    gameState.lineClearCounts = {
        1: 8, 2: 4, 3: 2, 4: 1,
    };
    gameState.lockedPieces = [{
        type: 'I',
        shapeKey: 'I',
        shape: [[1, 1, 1, 1]],
        x: 2,
        y: 21,
        color: '#00ffff',
        pieceId: 77,
        garbageMeta: { attackId: 'historical-1', depth: 2 },
    }];
    gameState._pieceIdCounter = 77;
    rebuildBoardGridFromPieces(gameState.lockedPieces, gameState.boardGrid);
    gameState.currentPiece = {
        type: 'T',
        shapeKey: 'T',
        shape: [[0, 1, 0], [0, 1, 1], [0, 1, 0]],
        color: '#800080',
        x: 4,
        y: 6,
        rotation: 1,
    };
    gameState.nextPieces = ['S', 'Z', 'O', 'L', 'J'];
    gameState.hitStopEnabled = true;
    gameState.hitStopRemaining = 50;
    gameState.hitStopTicks = 3;
    gameState.lastMoveWasRotation = true;
    gameState.b2bActive = true;
    gameState.inputQueue = [{ action: 'move', value: 1 }];
    startDas(gameState.playerInput.das.moveRight);
    gameState.playerInput.das.moveRight.delayAccumulator = 41;
    enqueueInputEdge(gameState.playerInput, {
        tick: 420,
        subframe: 3,
        action: 'move',
        value: 1,
        phase: 'up',
    });
    gameState.lastPlacedPieceX = [3, 4, 5];
    gameState.comboState = {
        depth: 2,
        complexity: 3,
        lockFootprint: [{ x: 4, y: 21 }],
        manualColumns: [4],
        tSpin: true,
        sequence: 9,
    };
    restoreBlindTimers(gameState, {
        field: 1.25,
        fieldMax: 3,
        pending: 0.5,
        pendingMax: 2,
    });
    gameState.garbageAttackSequence = 13;
    gameState.handicap = 3;
    gameState.handicaps = { A: 2, B: 3 };
    gameState.handicapCrowd = 4;
    gameState.goalComplete = true;
    gameState.victoryLapActive = true;
    gameState.victoryLapStartTime = 999;

    for (let i = 0; i < 11; i += 1) gameState.randomGenerator();

    player.frags = 5;
    player.lastInputSeq = 37;
    player.lastAttackerId = 'B';
    player._lockSeq = 14;
    player._clearSeq = 9;
    player._lastAppliedLockSeq = 11;
    player._lastAppliedClearSeq = 7;
    player._lastLockHostTick = 84;
    player.garbageQueue.enqueue({
        type: 'line',
        attackerId: 'B',
        attackerName: 'Bravo',
        color: '#123456',
        holeMask: 0b1000000001,
        variant: 'clean',
        duration: 1.234,
        isLastInBurst: true,
        attackId: 'r3-a19',
        attackSeq: 19,
        lineIndex: 0,
        targetId: 'A',
        createdSimTick: 417,
        sourceSimTick: 416,
        sourceLockSeq: 14,
        applyAfterLockSeq: 13,
        applySimTick: 421,
        rulesHash: 'rules-v1',
        clearSummary: { depth: 2, complexity: 3 },
        connectAbove: false,
        connectBelow: true,
        combo: 3,
        depth: 2,
    });
}

describe('FFA versioned resync sidecar', () => {
    it('deeply round-trips non-default sim, wrapper, queue, and match state', () => {
        const sourcePlayer = makePlayer('A', 17);
        configureNonDefaultState(sourcePlayer);
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));
        const validated = validateCaptured(sidecar);

        // Validation returns a detached value suitable for delayed application.
        sidecar.players[0].gameState.score = 999999;
        sidecar.match.histories.attackHistory[0].lines = 99;
        expect(validated.players[0].gameState.score).toBe(4321);
        expect(validated.match.histories.attackHistory[0].lines).toBe(4);

        const targetPlayer = makePlayer('A', 999);
        const target = makeGame([targetPlayer]);
        applyFfaResyncSidecar(target, validated, { restorePlayerInput: true });

        const recaptured = captureFfaResyncSidecar(target, makeSyncpoint(target));
        expect(recaptured).toEqual(validated);
        expect(targetPlayer._lastAppliedLockSeq).toBe(11);
        expect(targetPlayer._lastAppliedClearSeq).toBe(7);
        expect(targetPlayer._lastLockHostTick).toBe(84);
    });

    it('preserves clustered locked-piece identity through the next cascade', () => {
        const sourcePlayer = makePlayer('A');
        const fullFloor = Array(10).fill(1);
        sourcePlayer.gameState.lockedPieces = [
            {
                type: 'I', shapeKey: 'I', shape: [[1, 1, 1, 1]], x: 0, y: 21, pieceId: 42,
            },
            {
                type: 'O', shapeKey: 'O', shape: [[1]], x: 0, y: 22, pieceId: 43,
            },
            {
                type: 'GARBAGE', shapeKey: 'GARBAGE', shape: [fullFloor], x: 0, y: 23, pieceId: 44,
            },
        ];
        sourcePlayer.gameState._pieceIdCounter = 44;
        rebuildBoardGridFromPieces(
            sourcePlayer.gameState.lockedPieces,
            sourcePlayer.gameState.boardGrid,
        );
        sourcePlayer.gameState.currentPiece = {
            type: 'T', shapeKey: 'T', shape: [[1]], x: 4, y: 5, rotation: 0,
        };
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));

        const targetPlayer = makePlayer('A');
        const target = makeGame([targetPlayer]);
        applyFfaResyncSidecar(target, validateCaptured(sidecar));

        expect(targetPlayer.gameState.lockedPieces).toEqual(sourcePlayer.gameState.lockedPieces);
        expect(targetPlayer.gameState._pieceIdCounter).toBe(44);
        const context = {
            level: 1,
            lines: 0,
            linesUntilNextLevel: 15,
            dropInterval: 1000,
            comboState: { lockFootprint: [], manualColumns: [4] },
        };
        expect(resolveCascade(targetPlayer.gameState.lockedPieces, context))
            .toEqual(resolveCascade(sourcePlayer.gameState.lockedPieces, context));
    });

    it('restores the RNG cursor exactly when the valid seed is zero', () => {
        const sourcePlayer = makePlayer('A', 0);
        for (let i = 0; i < 23; i += 1) sourcePlayer.gameState.randomGenerator();
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));
        expect(sidecar.players[0].rng).toMatchObject({ algorithm: 'lcg-v1', seed: 0 });

        const targetPlayer = makePlayer('A', 999);
        const target = makeGame([targetPlayer]);
        applyFfaResyncSidecar(target, validateCaptured(sidecar));

        const expected = Array.from({ length: 20 }, () => sourcePlayer.gameState.randomGenerator());
        const actual = Array.from({ length: 20 }, () => targetPlayer.gameState.randomGenerator());
        expect(actual).toEqual(expected);
    });

    it('canonicalizes a legacy numeric-string LCG descriptor and preserves continuation', () => {
        const sourcePlayer = makePlayer('A', 0);
        for (let i = 0; i < 23; i += 1) sourcePlayer.gameState.randomGenerator();
        sourcePlayer.gameState.randomGenerator.seed = ' 0 ';
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));
        expect(sidecar.players[0].rng.seed).toBe(0);
        sidecar.players[0].rng.seed = ' 0 ';

        const validated = validateCaptured(sidecar);
        expect(validated.players[0].rng.seed).toBe(0);

        const targetPlayer = makePlayer('A', 999);
        const target = makeGame([targetPlayer]);
        applyFfaResyncSidecar(target, validated);

        expect(targetPlayer.gameState.randomGenerator.seed).toBe(0);
        const expected = Array.from({ length: 20 }, () => sourcePlayer.gameState.randomGenerator());
        const actual = Array.from({ length: 20 }, () => targetPlayer.gameState.randomGenerator());
        expect(actual).toEqual(expected);
    });

    it('restores the sfc32 cursor and integer bag capability exactly', () => {
        const sourcePlayer = makePlayer('A');
        sourcePlayer.gameState.randomGenerator = createSfc32Random(
            'match-42',
            'pieces:shared-v1',
        );
        for (let i = 0; i < 39; i += 1) sourcePlayer.gameState.randomGenerator();
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));
        const canonicalState = sourcePlayer.gameState.randomGenerator.getState();
        const legacySignedA = canonicalState.a | 0;
        expect(legacySignedA).toBeLessThan(0);
        sidecar.players[0].rng.state.a = legacySignedA;
        sidecar.players[0].gameState.rngState.a = legacySignedA;
        expect(sidecar.players[0].rng).toMatchObject({
            algorithm: 'sfc32-v1',
            seed: 'match-42',
            state: { label: 'pieces:shared-v1' },
        });

        const targetPlayer = makePlayer('A', 999);
        const target = makeGame([targetPlayer]);
        const validated = validateCaptured(sidecar);
        expect(validated.players[0].rng.state.a).toBe(canonicalState.a);
        expect(validated.players[0].gameState.rngState.a).toBe(canonicalState.a);
        applyFfaResyncSidecar(target, validated);

        expect(targetPlayer.gameState.randomGenerator.nextInt).toEqual(expect.any(Function));
        const expected = Array.from({ length: 20 }, () => sourcePlayer.gameState.randomGenerator());
        const actual = Array.from({ length: 20 }, () => targetPlayer.gameState.randomGenerator());
        expect(actual).toEqual(expected);

        const sourceQueue = [];
        const targetQueue = [];
        fillBag(sourceQueue, sourcePlayer.gameState.randomGenerator);
        fillBag(targetQueue, targetPlayer.gameState.randomGenerator);
        expect(targetQueue).toEqual(sourceQueue);
    });

    it('preserves receiver-owned held input while applying canonical simulation state', () => {
        const sourcePlayer = makePlayer('A', 17);
        sourcePlayer.gameState.score = 9001;
        sourcePlayer.gameState.simFrame = 450;
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));

        const targetPlayer = makePlayer('A', 999);
        targetPlayer.gameState.simFrame = 500;
        startDas(targetPlayer.gameState.playerInput.das.moveLeft);
        targetPlayer.gameState.playerInput.das.moveLeft.delayAccumulator = 37;
        enqueueInputEdge(targetPlayer.gameState.playerInput, {
            tick: 501,
            subframe: 1,
            action: 'move',
            value: -1,
            phase: 'down',
        });
        const target = makeGame([targetPlayer]);

        applyFfaResyncSidecar(target, validateCaptured(sidecar), {
            preservePlayerInputFor: 'A',
        });

        expect(targetPlayer.gameState.score).toBe(9001);
        expect(targetPlayer.gameState.playerInput.das.moveLeft).toMatchObject({
            active: true,
            delayAccumulator: 37,
        });
        expect(targetPlayer.gameState.playerInput.pendingEdges[0].tick).toBe(451);
        enqueueInputEdge(targetPlayer.gameState.playerInput, {
            tick: 451,
            subframe: 2,
            action: 'move',
            value: -1,
            phase: 'up',
        });
        advancePlayerInputTick(targetPlayer.gameState.playerInput, { tick: 451 });
        expect(targetPlayer.gameState.playerInput.das.moveLeft.active).toBe(false);
    });

    it('canonicalizes default blind timers so a fresh state round-trips structurally', () => {
        const sourcePlayer = makePlayer('A');
        const source = makeGame([sourcePlayer]);
        const validated = validateCaptured(captureFfaResyncSidecar(source, makeSyncpoint(source)));
        const targetPlayer = makePlayer('A', 999);
        const target = makeGame([targetPlayer]);

        applyFfaResyncSidecar(target, validated);

        expect(captureFfaResyncSidecar(target, makeSyncpoint(target))).toEqual(validated);
        expect(validated.players[0].gameState.blindTimers).toMatchObject({
            fieldTicks: 0,
            fieldMaxTicks: 0,
            pendingTicks: 0,
            pendingMaxTicks: 0,
            _blindTickDurationMs: 1000 / 60,
        });
    });

    it('keeps exact garbage provenance instead of accepting hash-only attacker identity', () => {
        const sourcePlayer = makePlayer('A');
        const entry = {
            type: 'line',
            attackerId: '76561198000000001',
            attackerName: 'Exact Attacker',
            targetId: 'A',
            attackId: 'r7-a123',
            attackSeq: 123,
            lineIndex: 2,
            holeMask: 0b1010000101,
            color: '#fedcba',
            variant: 'clean',
            duration: 1.237,
            createdSimTick: 900,
            sourceSimTick: 899,
            sourceLockSeq: 70,
            applyAfterLockSeq: 55,
            applySimTick: 901,
            rulesHash: 'sha256:rules',
            clearSummary: { totalLines: 4, holeMasks: [645] },
            connectAbove: true,
            connectBelow: false,
            combo: 8,
            depth: 5,
            isLastInBurst: true,
            isHotPotato: false,
        };
        sourcePlayer.garbageQueue.enqueue(entry);
        const source = makeGame([sourcePlayer]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));

        const targetPlayer = makePlayer('A');
        const target = makeGame([targetPlayer]);
        applyFfaResyncSidecar(target, validateCaptured(sidecar));

        expect(targetPlayer.garbageQueue.serialize()).toEqual([entry]);
        expect(targetPlayer.garbageQueue.entries[0].attackerId).not.toMatch(/^unknown_/);
    });

    it('rejects malformed, unsafe, mismatched, and non-exact-roster payloads before apply', () => {
        const source = makeGame([makePlayer('A'), makePlayer('B')]);
        const sidecar = captureFfaResyncSidecar(source, makeSyncpoint(source));
        const envelope = makeEnvelope(sidecar);
        const wireSidecar = JSON.parse(JSON.stringify(sidecar));
        expect(() => validateFfaResyncSidecar(wireSidecar, envelope)).not.toThrow();

        const wrongSchema = structuredClone(sidecar);
        wrongSchema.schema = 'other';
        expect(() => validateFfaResyncSidecar(wrongSchema, envelope)).toThrow(/unknown schema/);

        const wrongVersion = structuredClone(sidecar);
        wrongVersion.version = 2;
        expect(() => validateFfaResyncSidecar(wrongVersion, envelope)).toThrow(/unsupported version/);

        const busy = structuredClone(sidecar);
        busy.capture.joinSyncpoint.safe = false;
        busy.capture.joinSyncpoint.status = 'busy';
        busy.capture.joinSyncpoint.blockers = [{ kind: 'active_physics', playerId: 'A' }];
        expect(() => validateFfaResyncSidecar(busy, {
            ...envelope,
            header: { ...envelope.header, joinSyncpoint: busy.capture.joinSyncpoint },
        })).toThrow(/not safe/);

        const wrongFence = structuredClone(envelope);
        wrongFence.header.simTick += 1;
        expect(() => validateFfaResyncSidecar(sidecar, wrongFence)).toThrow(/simTick fence mismatch/);

        const malformedHeaderSeed = structuredClone(envelope);
        malformedHeaderSeed.header.sharedSeed = false;
        expect(() => validateFfaResyncSidecar(sidecar, malformedHeaderSeed))
            .toThrow(/header sharedSeed is invalid/);

        const mismatchedHeaderSeed = structuredClone(envelope);
        mismatchedHeaderSeed.header.sharedSeed = 8;
        expect(() => validateFfaResyncSidecar(sidecar, mismatchedHeaderSeed))
            .toThrow(/disagrees with header sharedSeed/);

        const compatibleHeaderSeed = structuredClone(envelope);
        compatibleHeaderSeed.header.sharedSeed = ' 7 ';
        expect(validateFfaResyncSidecar(sidecar, compatibleHeaderSeed).players[0].rng.seed)
            .toBe(7);

        const missingRoster = structuredClone(envelope);
        missingRoster.packedSnapshot.players.pop();
        expect(() => validateFfaResyncSidecar(sidecar, missingRoster)).toThrow(/does not exactly match/);

        const duplicateRoster = structuredClone(sidecar);
        duplicateRoster.players.push(structuredClone(duplicateRoster.players[0]));
        expect(() => validateFfaResyncSidecar(duplicateRoster, envelope)).toThrow(/duplicate player A/);

        const malformedPieces = JSON.parse(JSON.stringify(sidecar));
        malformedPieces.players[0].gameState.lockedPieces = 'not-an-array';
        expect(() => validateFfaResyncSidecar(malformedPieces, envelope)).toThrow(/lockedPieces/);

        const malformedGrid = JSON.parse(JSON.stringify(sidecar));
        malformedGrid.players[0].gameState.boardGrid = {};
        expect(() => validateFfaResyncSidecar(malformedGrid, envelope)).toThrow(/boardGrid/);

        const shortGrid = JSON.parse(JSON.stringify(sidecar));
        shortGrid.players[0].gameState.boardGrid = [Array(10).fill(null)];
        expect(() => validateFfaResyncSidecar(shortGrid, envelope)).toThrow(/canonical FFA row count/);

        const malformedPreview = JSON.parse(JSON.stringify(sidecar));
        malformedPreview.players[0].gameState.nextPieces = {};
        expect(() => validateFfaResyncSidecar(malformedPreview, envelope)).toThrow(/nextPieces/);

        const malformedPieceShape = JSON.parse(JSON.stringify(sidecar));
        malformedPieceShape.players[0].gameState.currentPiece = { shape: 'bad' };
        expect(() => validateFfaResyncSidecar(malformedPieceShape, envelope)).toThrow(/currentPiece.shape/);

        const incompleteActivePiece = JSON.parse(JSON.stringify(sidecar));
        incompleteActivePiece.players[0].gameState.currentPiece = { shape: [[1]] };
        expect(() => validateFfaResyncSidecar(incompleteActivePiece, envelope)).toThrow(/currentPiece.x/);

        const malformedInput = JSON.parse(JSON.stringify(sidecar));
        malformedInput.players[0].gameState.playerInput = {};
        expect(() => validateFfaResyncSidecar(malformedInput, envelope)).toThrow(/playerInput/);

        const scalarMutations = [
            ['zero sim tick duration', (state) => { state.simTickMs = 0; }, /simTickMs|duration/],
            ['zero level', (state) => { state.level = 0; }, /level must be at least one/],
            ['fractional lock ticks', (state) => { state.lockTimerTicks = 1.5; }, /lockTimerTicks/],
            ['coerced boolean', (state) => { state.isGameOver = 'false'; }, /isGameOver must be boolean/],
            ['active physics', (state) => { state.isProcessingPhysics = true; }, /must be false/],
            ['infinity mode', (state) => { state.isInfinityMode = true; }, /unsupported/],
            ['inconsistent lock ticks', (state) => { state.lockDelayTicks += 1; }, /disagrees/],
        ];
        scalarMutations.forEach(([, mutate, expected]) => {
            const malformed = JSON.parse(JSON.stringify(sidecar));
            mutate(malformed.players[0].gameState);
            expect(() => validateFfaResyncSidecar(malformed, envelope)).toThrow(expected);
        });

        const unknownStateField = JSON.parse(JSON.stringify(sidecar));
        unknownStateField.players[0].gameState.futureClock = 1;
        expect(() => validateFfaResyncSidecar(unknownStateField, envelope))
            .toThrow(/fields are not canonical/);

        const unknownInputField = JSON.parse(JSON.stringify(sidecar));
        unknownInputField.players[0].gameState.playerInput.futureEdge = [];
        expect(() => validateFfaResyncSidecar(unknownInputField, envelope))
            .toThrow(/playerInput fields are not canonical/);

        const incompletePooledPiece = JSON.parse(JSON.stringify(sidecar));
        incompletePooledPiece.players[0].gameState.currentPiece = {
            type: 'T', shapeKey: 'T', shape: [[1]], x: 4, y: 0, rotation: 0,
        };
        expect(() => validateFfaResyncSidecar(incompletePooledPiece, envelope))
            .toThrow(/currentPiece.color/);

        const stalePieceCounter = JSON.parse(JSON.stringify(sidecar));
        stalePieceCounter.players[0].gameState.lockedPieces = [{
            type: 'O', shapeKey: 'O', shape: [[1]], x: 4, y: 20, pieceId: 2,
        }];
        stalePieceCounter.players[0].gameState.pieceIdCounter = 1;
        expect(() => validateFfaResyncSidecar(stalePieceCounter, envelope))
            .toThrow(/below a locked piece id/);

        const partialBlindClock = JSON.parse(JSON.stringify(sidecar));
        delete partialBlindClock.players[0].gameState.blindTimers.pendingTicks;
        expect(() => validateFfaResyncSidecar(partialBlindClock, envelope))
            .toThrow(/requires a fixed-tick mirror/);

        const oversizedGarbage = JSON.parse(JSON.stringify(sidecar));
        oversizedGarbage.players[0].garbageEntries = Array.from({ length: 2049 }, () => ({}));
        expect(() => validateFfaResyncSidecar(oversizedGarbage, envelope)).toThrow(/queue is oversized/);

        const malformedGarbage = JSON.parse(JSON.stringify(sidecar));
        malformedGarbage.players[0].garbageEntries = [{}];
        expect(() => validateFfaResyncSidecar(malformedGarbage, envelope)).toThrow(/entry 0.type/);

        [false, true, '', 'not-a-seed', null, [], {}].forEach((seed) => {
            const malformedSeed = JSON.parse(JSON.stringify(sidecar));
            malformedSeed.players[0].rng.seed = seed;
            expect(() => validateFfaResyncSidecar(malformedSeed, envelope))
                .toThrow(/LCG seed is invalid/);
        });

        const overflowingRng = JSON.parse(JSON.stringify(sidecar));
        overflowingRng.players[0].rng.algorithm = 'sfc32-v1';
        overflowingRng.players[0].rng.seed = 'seed';
        overflowingRng.players[0].rng.state = {
            seed: 'seed', label: 'pieces:A', a: 2 ** 32, b: 1, c: 2, d: 3, drawCount: 4,
        };
        overflowingRng.players[0].gameState.rngState = structuredClone(
            overflowingRng.players[0].rng.state,
        );
        expect(() => validateFfaResyncSidecar(overflowingRng, envelope))
            .toThrow(/Random stream a/);

        const terminalRng = JSON.parse(JSON.stringify(overflowingRng));
        terminalRng.players[0].rng.state.a = 1;
        terminalRng.players[0].rng.state.drawCount = Number.MAX_SAFE_INTEGER - 1;
        terminalRng.players[0].gameState.rngState = structuredClone(
            terminalRng.players[0].rng.state,
        );
        expect(validateFfaResyncSidecar(terminalRng, envelope).players[0].rng.state.drawCount)
            .toBe(Number.MAX_SAFE_INTEGER - 1);

        const exhaustedRng = JSON.parse(JSON.stringify(terminalRng));
        exhaustedRng.players[0].rng.state.drawCount = Number.MAX_SAFE_INTEGER;
        exhaustedRng.players[0].gameState.rngState.drawCount = Number.MAX_SAFE_INTEGER;
        expect(() => validateFfaResyncSidecar(exhaustedRng, envelope))
            .toThrow(/drawCount/);

        const targetPlayer = makePlayer('A');
        targetPlayer.gameState.score = 777;
        const target = makeGame([targetPlayer]);
        expect(() => applyFfaResyncSidecar(target, sidecar)).toThrow(/requires the result/);
        expect(targetPlayer.gameState.score).toBe(777);
        expect(target._attackSeq).toBe(19);
    });
});
