// @ts-check
/**
 * Turn the packed binary-v7 body into the explicit shape accepted by the live
 * snapshot consumer. The copy is load-bearing: delta baselines must remain raw
 * and must never inherit wrapper acknowledgements from a previously hydrated
 * frame.
 *
 * @param {BinaryStateSnapshotV7} snapshot
 * @param {SnapshotHydrationMetadata} [metadata]
 * @returns {StateSnapshot}
 */
export function hydrateBinarySnapshot(snapshot, metadata = {}) {
    const acknowledgements = metadata.acknowledgements || {};
    // Steam networking retains `snapshot` as the raw baseline for future delta
    // frames. The live consumer adopts nested board/piece/garbage arrays by
    // reference, so a shallow copy here lets normal simulation mutate that
    // retained baseline and poison the next delta reconstruction. Packed
    // snapshots contain only structured-cloneable wire data; clone the whole
    // body before adding wrapper-only fields.
    const hydratedBody = structuredClone(snapshot);

    return {
        ...hydratedBody,
        players: hydratedBody.players.map((player) => ({
            ...player,
            lastInputSeq: acknowledgements[player.steamId],
            lastAttackerId: undefined,
            lockSeq: undefined,
        })),
        roundGeneration: metadata.roundGeneration,
        migrationEpoch: metadata.migrationEpoch,
        digest: metadata.digest,
        hotPotatoState: metadata.hotPotatoState === undefined
            ? undefined
            : structuredClone(metadata.hotPotatoState),
    };
}
