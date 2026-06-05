const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

const toHex = (buffer) => Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fallbackHash = (input) => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
};

const checksum32FromHex = (hex) => {
    if (!hex || hex.length < 8) return 0;
    const slice = hex.slice(0, 8);
    const value = parseInt(slice, 16);
    return Number.isFinite(value) ? value : 0;
};

export const buildReplayProof = async ({ demo, expectedScore, expectedLines, expectedLevel, expectedDurationMs }) => {
    const issues = [];

    if (!demo || !Array.isArray(demo.inputs) || demo.inputs.length === 0) {
        return {
            verified: false,
            issues: ['missing_demo'],
            hash: null,
            checksum32: 0,
            inputCount: demo?.inputs?.length || 0,
            durationMs: demo?.metadata?.duration || null,
        };
    }

    const metadata = demo.metadata || {};
    const initialState = demo.initialState || {};

    if (!Number.isFinite(initialState.seed)) {
        issues.push('missing_seed');
    }

    let lastTimestamp = -1;
    const validActions = new Set(['move', 'rotate', 'hardDrop', 'softDrop']);
    demo.inputs.forEach((input) => {
        if (!input || !Number.isFinite(input.t) || input.t < 0) {
            issues.push('invalid_input_timestamp');
            return;
        }
        if (input.t < lastTimestamp) {
            issues.push('input_order_mismatch');
        }
        if (!validActions.has(input.a)) {
            issues.push('unknown_input_action');
        }
        lastTimestamp = input.t;
    });

    if (Number.isFinite(expectedScore) && metadata.finalScore !== expectedScore) {
        issues.push('score_mismatch');
    }

    if (Number.isFinite(expectedLines) && metadata.linesCleared !== expectedLines) {
        issues.push('lines_mismatch');
    }

    if (Number.isFinite(expectedLevel) && metadata.level !== expectedLevel) {
        issues.push('level_mismatch');
    }

    if (Number.isFinite(expectedDurationMs) && Number.isFinite(metadata.duration)) {
        const diff = Math.abs(metadata.duration - expectedDurationMs);
        if (diff > 3000) {
            issues.push('duration_mismatch');
        }
    }

    const payload = JSON.stringify({
        version: demo.version,
        gameMode: demo.gameMode,
        timestamp: demo.timestamp,
        initialState: {
            seed: initialState.seed,
            level: initialState.level,
            dropInterval: initialState.dropInterval,
            settings: initialState.settings || {},
            rulesVersion: initialState.rulesVersion || '1.0',
        },
        inputs: demo.inputs,
        metadata: {
            finalScore: metadata.finalScore,
            linesCleared: metadata.linesCleared,
            level: metadata.level,
            duration: metadata.duration,
        },
    });

    let hash = null;
    if (textEncoder && typeof crypto !== 'undefined' && crypto.subtle?.digest) {
        const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(payload));
        hash = toHex(digest);
    } else {
        hash = fallbackHash(payload);
    }

    return {
        verified: issues.length === 0,
        issues,
        hash,
        checksum32: checksum32FromHex(hash),
        inputCount: demo.inputs.length,
        seed: initialState.seed ?? null,
        durationMs: metadata.duration || null,
    };
};
