export const SCORE_DETAIL_FLAGS = {
    NONE: 0,
    REPLAY_PRESENT: 1 << 0,
    REPLAY_VERIFIED: 1 << 1,
    REPLAY_MISMATCH: 1 << 2,
    OFFLINE_SUBMISSION: 1 << 3,
};

const MAX_INT32 = 2147483647;
const MIN_INT32 = -2147483648;

const toInt32 = (value, fallback = 0) => {
    if (!Number.isFinite(value)) return fallback;
    const intValue = Math.round(value);
    if (intValue > MAX_INT32) return MAX_INT32;
    if (intValue < MIN_INT32) return MIN_INT32;
    return intValue;
};

export const packScoreDetails = (details = {}) => {
    const duration = toInt32(details.duration ?? details.durationSeconds ?? 0, 0);
    const lines = toInt32(details.linesCleared ?? details.lines ?? 0, 0);
    const level = toInt32(details.highestLevel ?? details.level ?? 0, 0);
    const extraValue = toInt32(
        details.extraValue ?? details.bestCascade ?? details.timeMs ?? details.timeSeconds ?? 0,
        0,
    );
    const flags = toInt32(details.flags ?? 0, 0);
    const checksum = toInt32(details.checksum32 ?? 0, 0);
    const version = toInt32(details.detailVersion ?? 1, 1);

    return [version, duration, lines, level, extraValue, flags, checksum];
};

export const normalizeScoreDetails = (details = {}) => ({
    scoreDetails: details,
    scoreDetailsPacked: packScoreDetails(details),
});
