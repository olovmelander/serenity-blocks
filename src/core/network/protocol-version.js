// @ts-check

export const PROTOCOL_V1 = '1.0.0';
export const PROTOCOL_V2 = '2.0.0';

/**
 * Wire versions this build can encode and decode. Keep the list explicit: a
 * min/max offer describes compatibility to a remote, while this list prevents
 * the host from selecting a version that has no local catalog/codec.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_V1, PROTOCOL_V2]);
export const MIN_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
export const LATEST_SUPPORTED_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[
    SUPPORTED_PROTOCOL_VERSIONS.length - 1
];
// Protocol 2 stays opt-in until its soak and mixed-build gates pass. Keep the
// compatibility name explicit so adding a supported version cannot cut over a
// default lobby by changing array order.
export const DEFAULT_PROTOCOL_VERSION = PROTOCOL_V1;
export const CURRENT_PROTOCOL_VERSION = DEFAULT_PROTOCOL_VERSION;
export const CURRENT_ENVELOPE_VERSION = 1;

export const PROTOCOL_REJECTION_REASONS = Object.freeze({
    UPDATE_REQUIRED: 'update_required',
    HOST_UPDATE_REQUIRED: 'host_update_required',
    INVALID_RANGE: 'invalid_protocol_range',
    MISMATCH: 'protocol_mismatch',
    INVALID_SELECTION: 'invalid_protocol_selection',
    ENVELOPE_MISMATCH: 'envelope_mismatch',
});

const REJECTION_MESSAGES = Object.freeze({
    [PROTOCOL_REJECTION_REASONS.UPDATE_REQUIRED]:
        'This match requires a newer version of Serenity Blocks. Update the game and try again.',
    [PROTOCOL_REJECTION_REASONS.HOST_UPDATE_REQUIRED]:
        'The host is using an older incompatible version. Ask the host to update Serenity Blocks.',
    [PROTOCOL_REJECTION_REASONS.INVALID_RANGE]:
        'The other game version could not be verified. Update Serenity Blocks and try again.',
    [PROTOCOL_REJECTION_REASONS.MISMATCH]:
        'This match uses an incompatible network protocol. Update Serenity Blocks and try again.',
    [PROTOCOL_REJECTION_REASONS.INVALID_SELECTION]:
        'The host returned an invalid network version. The join was stopped for safety.',
    [PROTOCOL_REJECTION_REASONS.ENVELOPE_MISMATCH]:
        'This match uses an incompatible network envelope. Update Serenity Blocks and try again.',
});

/** @typedef {{minVersion: string, maxVersion: string}} ProtocolOffer */
/**
 * @typedef {{
 *   accepted: boolean,
 *   protocolVersion: string|null,
 *   reason: string,
 *   message: string|null,
 *   minVersion: string,
 *   maxVersion: string,
 * }} ProtocolNegotiationResult
 */

/** @param {unknown} value @returns {[number, number, number]|null} */
export function parseProtocolVersion(value) {
    if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part))) return null;
    return /** @type {[number, number, number]} */ (parts);
}

/** @param {string} left @param {string} right */
export function compareProtocolVersions(left, right) {
    const a = parseProtocolVersion(left);
    const b = parseProtocolVersion(right);
    if (!a || !b) throw new TypeError('Protocol versions must use numeric major.minor.patch format');
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}

/** @param {unknown} value */
export function isValidProtocolVersion(value) {
    return parseProtocolVersion(value) !== null;
}

/**
 * Accept the new min/max handshake and the old exact protocolVersion field so
 * same-version builds remain joinable during rollout.
 * @param {any} payload
 * @returns {ProtocolOffer|null}
 */
export function readProtocolOffer(payload) {
    const hasMin = payload != null
        && Object.prototype.hasOwnProperty.call(payload, 'minVersion');
    const hasMax = payload != null
        && Object.prototype.hasOwnProperty.call(payload, 'maxVersion');
    if (hasMin !== hasMax) return null;
    const legacyVersion = payload?.protocolVersion;
    const minVersion = hasMin ? payload.minVersion : legacyVersion;
    const maxVersion = hasMax ? payload.maxVersion : legacyVersion;
    if (!isValidProtocolVersion(minVersion) || !isValidProtocolVersion(maxVersion)) return null;
    if (compareProtocolVersions(minVersion, maxVersion) > 0) return null;
    return { minVersion, maxVersion };
}

/** @returns {ProtocolOffer} */
export function getLocalProtocolOffer() {
    return {
        minVersion: MIN_PROTOCOL_VERSION,
        maxVersion: LATEST_SUPPORTED_PROTOCOL_VERSION,
    };
}

/**
 * Bootstrap packets are always parseable as the stable JSON v1 shape, but the
 * gameplay envelope is fixed for the selected session. Missing range fields
 * normalize to the envelope version stamped on a legacy HELLO.
 * @param {any} payload
 * @param {unknown} fallbackEnvelopeVersion
 * @param {number} [localEnvelopeVersion]
 */
export function acceptsEnvelopeVersionOffer(
    payload,
    fallbackEnvelopeVersion,
    localEnvelopeVersion = CURRENT_ENVELOPE_VERSION,
) {
    const exact = payload?.envelopeVersion ?? fallbackEnvelopeVersion;
    const minVersion = payload?.minEnvelopeVersion ?? exact;
    const maxVersion = payload?.maxEnvelopeVersion ?? exact;
    return Number.isSafeInteger(minVersion)
        && Number.isSafeInteger(maxVersion)
        && minVersion > 0
        && minVersion <= maxVersion
        && minVersion <= localEnvelopeVersion
        && maxVersion >= localEnvelopeVersion;
}

/** @param {string} reason */
export function getProtocolRejectionMessage(reason) {
    return REJECTION_MESSAGES[reason] ?? REJECTION_MESSAGES[PROTOCOL_REJECTION_REASONS.MISMATCH];
}

/**
 * Select the highest local wire version inside the remote's advertised range.
 * @param {any} remotePayload
 * @param {readonly string[]} [supportedVersions]
 * @returns {ProtocolNegotiationResult}
 */
export function negotiateProtocolVersion(
    remotePayload,
    supportedVersions = SUPPORTED_PROTOCOL_VERSIONS,
) {
    const localVersions = [...supportedVersions]
        .filter(isValidProtocolVersion)
        .sort(compareProtocolVersions);
    if (localVersions.length === 0) {
        throw new Error('At least one supported protocol version is required');
    }

    const localMin = localVersions[0];
    const localMax = localVersions[localVersions.length - 1];
    const remote = readProtocolOffer(remotePayload);
    if (!remote) {
        const reason = PROTOCOL_REJECTION_REASONS.INVALID_RANGE;
        return {
            accepted: false,
            protocolVersion: null,
            reason,
            message: getProtocolRejectionMessage(reason),
            minVersion: localMin,
            maxVersion: localMax,
        };
    }

    const selected = localVersions.filter((version) => (
        compareProtocolVersions(version, remote.minVersion) >= 0
        && compareProtocolVersions(version, remote.maxVersion) <= 0
    )).at(-1) ?? null;

    if (selected) {
        return {
            accepted: true,
            protocolVersion: selected,
            reason: 'ok',
            message: null,
            minVersion: localMin,
            maxVersion: localMax,
        };
    }

    /** @type {string} */
    let reason = PROTOCOL_REJECTION_REASONS.MISMATCH;
    if (compareProtocolVersions(remote.maxVersion, localMin) < 0) {
        reason = PROTOCOL_REJECTION_REASONS.UPDATE_REQUIRED;
    } else if (compareProtocolVersions(remote.minVersion, localMax) > 0) {
        reason = PROTOCOL_REJECTION_REASONS.HOST_UPDATE_REQUIRED;
    }
    return {
        accepted: false,
        protocolVersion: null,
        reason,
        message: getProtocolRejectionMessage(reason),
        minVersion: localMin,
        maxVersion: localMax,
    };
}

/**
 * Validate that a WELCOME selection is one this client offered and supports.
 * @param {unknown} selectedVersion
 * @param {any} localOfferPayload
 * @param {readonly string[]} [supportedVersions]
 */
export function acceptsProtocolSelection(
    selectedVersion,
    localOfferPayload,
    supportedVersions = SUPPORTED_PROTOCOL_VERSIONS,
) {
    if (!isValidProtocolVersion(selectedVersion)) return false;
    const offer = readProtocolOffer(localOfferPayload);
    if (!offer) return false;
    return supportedVersions.includes(/** @type {string} */ (selectedVersion))
        && compareProtocolVersions(/** @type {string} */ (selectedVersion), offer.minVersion) >= 0
        && compareProtocolVersions(/** @type {string} */ (selectedVersion), offer.maxVersion) <= 0;
}
