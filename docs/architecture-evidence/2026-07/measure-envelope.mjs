// Measure the actual wire cost of a 30Hz delta packet vs its binary payload,
// using the real BinaryEncoder and the real envelope shape from steam-networking.js.
import { BinaryEncoder } from 'file:///C:/Users/olovm/serenity-blocks/src/core/network/binary-encoding.js';

// --- realistic 2-player snapshot (20x10 board with some filled rows) ---
function mkGrid() {
    const grid = [];
    for (let y = 0; y < 24; y++) { // GRID_ROWS = 24 incl. hidden rows
        const row = [];
        for (let x = 0; x < 10; x++) {
            row.push(y > 19 && x !== 4 ? { id: y * 10 + x, type: 'T', color: '#ff00ff' } : null);
        }
        grid.push(row);
    }
    return grid;
}
function mkPlayer(steamId, name, pieceX) {
    return {
        steamId, name, color: '#ff00ff',
        score: 12345, lines: 23, level: 2, frags: 3, isAlive: true, awaitingSpawn: false,
        garbagePending: 2, lastAttackerId: null, lockSeq: 41,
        grid: mkGrid(),
        currentPiece: { x: pieceX, y: 7, shape: [[1,1,1],[0,1,0]], color: '#ff00ff', shapeKey: 'T', type: 'T', rotation: 0 },
        nextPieces: [{ shapeKey: 'I' }, { shapeKey: 'O' }, { shapeKey: 'S' }],
        dropCounter: 312.5, dropInterval: 800,
        garbageEntries: [],
        lockedPieces: [],
        blindTimers: null,
        lastInputSeq: 118,
    };
}
const baselineSnap = {
    players: [mkPlayer('76561198012345678', 'HostPlayer', 3), mkPlayer('76561198087654321', 'PeerPlayer', 5)],
    gamePhase: 'playing', roundGeneration: 2, hotPotatoState: null, winner: null,
    timestamp: Date.now(), tick: 5230, simTick: 10460, snapshotSeq: 5230, migrationEpoch: 0,
    digest: 'a1b2c3d4',
};
// current: one player's piece moved one cell + dropCounter advanced (the dominant 30Hz case)
const currentSnap = JSON.parse(JSON.stringify(baselineSnap));
currentSnap.players[0].currentPiece.x = 4;
currentSnap.players[0].dropCounter = 345.8;
currentSnap.tick = 5231; currentSnap.simTick = 10462; currentSnap.snapshotSeq = 5231;
currentSnap.timestamp = Date.now() + 33;

const enc = new BinaryEncoder();
const keyframeBuf = enc.encodeSnapshot(baselineSnap);
const deltaBuf = enc.encodeDeltaSnapshot(currentSnap, baselineSnap);

const b64 = (buf) => Buffer.from(buf).toString('base64');

// --- exact wrapper from steam-networking.js:479-496 ---
function wrap(data, buf, usedDelta) {
    const acks = {};
    for (const p of data.players) acks[p.steamId] = p.lastInputSeq;
    return {
        _binary: true,
        _delta: usedDelta,
        _data: b64(buf),
        _gen: data.roundGeneration,
        _migrationEpoch: data.migrationEpoch,
        _acks: acks,
        _digest: data.digest,
        _originalSize: JSON.stringify(data).length,
        _encodedSize: buf.byteLength,
    };
}
// --- exact envelope from steam-networking.js:1028-1047 ---
function envelope(payload) {
    return {
        envelopeVersion: 1,
        msgType: 'game:state:full',
        matchId: '109775241234567890',
        matchNonce: 'a1b2c3d4e5f60718',
        hostSteamId: '76561198012345678',
        channel: 1,
        seq: 15234,
        tick: null,
        sentAt: Date.now(),
        protocolVersion: '1.0.0',
        payload,
    };
}

for (const [label, buf, usedDelta] of [['KEYFRAME', keyframeBuf, false], ['DELTA', deltaBuf, true]]) {
    if (!buf) { console.log(label, ': encoder returned null'); continue; }
    const payload = wrap(currentSnap, buf, usedDelta);
    const env = envelope(payload);
    const wire = Buffer.from(JSON.stringify(env)); // main.js does Buffer.from(JSON.stringify(data))
    const b64len = payload._data.length;
    const payloadJson = Buffer.from(JSON.stringify(payload)).length;
    console.log(`--- ${label} ---`);
    console.log('binary payload bytes:        ', buf.byteLength);
    console.log('base64 payload chars:        ', b64len);
    console.log('wrapper JSON bytes (payload):', payloadJson, ` (wrapper overhead: ${payloadJson - b64len})`);
    console.log('full wire bytes (envelope):  ', wire.length);
    console.log('envelope-only overhead:      ', wire.length - payloadJson);
    console.log('total overhead vs binary:    ', wire.length - buf.byteLength, ` (${(wire.length / buf.byteLength).toFixed(1)}x)`);
    // per-field envelope costs
    const fields = { envelopeVersion: 1, msgType: 'game:state:full', matchId: '109775241234567890', matchNonce: 'a1b2c3d4e5f60718', hostSteamId: '76561198012345678', channel: 1, seq: 15234, tick: null, sentAt: Date.now(), protocolVersion: '1.0.0' };
    for (const [k, v] of Object.entries(fields)) {
        console.log(`   field ${k}: ${Buffer.from(JSON.stringify({ [k]: v })).length - 2} bytes`);
    }
}
