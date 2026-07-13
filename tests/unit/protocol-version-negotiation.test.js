import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    MessageTypes,
    PROTOCOL_CATALOG_BY_VERSION,
} from '../../src/core/network/message-types.js';
import {
    acceptsEnvelopeVersionOffer,
    acceptsProtocolSelection,
    CURRENT_PROTOCOL_VERSION,
    CURRENT_ENVELOPE_VERSION,
    DEFAULT_PROTOCOL_VERSION,
    getLocalProtocolOffer,
    LATEST_SUPPORTED_PROTOCOL_VERSION,
    negotiateProtocolVersion,
    PROTOCOL_V1,
    PROTOCOL_V2,
    PROTOCOL_REJECTION_REASONS,
    readProtocolOffer,
    SUPPORTED_PROTOCOL_VERSIONS,
} from '../../src/core/network/protocol-version.js';
import { SteamNetworking } from '../../src/core/steam/steam-networking.js';

const TEST_SUPPORTED_VERSIONS = Object.freeze([
    '1.0.0',
    '1.5.0',
    '2.0.0',
    '3.0.0',
]);

describe('protocol version offers', () => {
    it('advertises v1 through v2 while keeping new lobbies on protocol v1', () => {
        expect(PROTOCOL_V1).toBe('1.0.0');
        expect(PROTOCOL_V2).toBe('2.0.0');
        expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([PROTOCOL_V1, PROTOCOL_V2]);
        expect(DEFAULT_PROTOCOL_VERSION).toBe(PROTOCOL_V1);
        expect(CURRENT_PROTOCOL_VERSION).toBe(PROTOCOL_V1);
        expect(LATEST_SUPPORTED_PROTOCOL_VERSION).toBe(PROTOCOL_V2);
        expect(getLocalProtocolOffer()).toEqual({
            minVersion: PROTOCOL_V1,
            maxVersion: PROTOCOL_V2,
        });
    });

    it('normalizes a legacy exact protocolVersion into an exact range', () => {
        expect(readProtocolOffer({ protocolVersion: '1.5.0' })).toEqual({
            minVersion: '1.5.0',
            maxVersion: '1.5.0',
        });

        expect(negotiateProtocolVersion(
            { protocolVersion: '1.5.0' },
            TEST_SUPPORTED_VERSIONS,
        )).toMatchObject({
            accepted: true,
            protocolVersion: '1.5.0',
            reason: 'ok',
        });
    });

    it('accepts a compatible range', () => {
        expect(negotiateProtocolVersion(
            { minVersion: '1.4.0', maxVersion: '1.6.0' },
            TEST_SUPPORTED_VERSIONS,
        )).toMatchObject({
            accepted: true,
            protocolVersion: '1.5.0',
            reason: 'ok',
            minVersion: '1.0.0',
            maxVersion: '3.0.0',
        });
    });

    it('selects the highest overlapping local version independent of input order', () => {
        const result = negotiateProtocolVersion(
            { minVersion: '1.0.0', maxVersion: '2.0.0' },
            ['2.0.0', '3.0.0', '1.0.0', '1.5.0'],
        );

        expect(result).toMatchObject({
            accepted: true,
            protocolVersion: '2.0.0',
            minVersion: '1.0.0',
            maxVersion: '3.0.0',
        });
    });

    it('tells an older remote to update when its maximum is below the local minimum', () => {
        expect(negotiateProtocolVersion(
            { minVersion: '1.0.0', maxVersion: '1.9.9' },
            ['2.0.0', '3.0.0'],
        )).toMatchObject({
            accepted: false,
            protocolVersion: null,
            reason: PROTOCOL_REJECTION_REASONS.UPDATE_REQUIRED,
        });
    });

    it('reports that the host must update when the remote minimum exceeds the local maximum', () => {
        expect(negotiateProtocolVersion(
            { minVersion: '3.0.1', maxVersion: '4.0.0' },
            ['1.0.0', '2.0.0', '3.0.0'],
        )).toMatchObject({
            accepted: false,
            protocolVersion: null,
            reason: PROTOCOL_REJECTION_REASONS.HOST_UPDATE_REQUIRED,
        });
    });

    it.each([
        ['missing payload', undefined],
        ['non-object payload', '1.0.0'],
        ['short exact version', { protocolVersion: '1.0' }],
        ['non-numeric exact version', { protocolVersion: 'one.0.0' }],
        ['malformed minimum', { minVersion: '1.0', maxVersion: '2.0.0' }],
        ['malformed maximum', { minVersion: '1.0.0', maxVersion: 'latest' }],
        ['reversed range', { minVersion: '2.0.0', maxVersion: '1.0.0' }],
    ])('rejects a %s as an invalid range', (_label, payload) => {
        expect(readProtocolOffer(payload)).toBeNull();
        expect(negotiateProtocolVersion(payload, TEST_SUPPORTED_VERSIONS)).toMatchObject({
            accepted: false,
            protocolVersion: null,
            reason: PROTOCOL_REJECTION_REASONS.INVALID_RANGE,
        });
    });

    it.each([
        [
            'minimum-only range beside a legacy exact field',
            { protocolVersion: '1.5.0', minVersion: '1.0.0' },
        ],
        [
            'maximum-only range beside a legacy exact field',
            { protocolVersion: '1.5.0', maxVersion: '2.0.0' },
        ],
        ['minimum-only range', { minVersion: '1.0.0' }],
        ['maximum-only range', { maxVersion: '2.0.0' }],
    ])('rejects a partial %s instead of filling its missing bound', (_label, payload) => {
        expect(readProtocolOffer(payload)).toBeNull();
        expect(negotiateProtocolVersion(payload, TEST_SUPPORTED_VERSIONS)).toMatchObject({
            accepted: false,
            protocolVersion: null,
            reason: PROTOCOL_REJECTION_REASONS.INVALID_RANGE,
        });
    });

    it('only accepts a selected version that was offered and is locally supported', () => {
        const offer = { minVersion: '1.0.0', maxVersion: '2.0.0' };

        expect(acceptsProtocolSelection('2.0.0', offer, TEST_SUPPORTED_VERSIONS)).toBe(true);
        expect(acceptsProtocolSelection('3.0.0', offer, TEST_SUPPORTED_VERSIONS)).toBe(false);
        expect(acceptsProtocolSelection('1.2.0', offer, TEST_SUPPORTED_VERSIONS)).toBe(false);
        expect(acceptsProtocolSelection('invalid', offer, TEST_SUPPORTED_VERSIONS)).toBe(false);
    });
});

describe('envelope version offers', () => {
    it('accepts an exact current envelope version, including the legacy fallback', () => {
        expect(acceptsEnvelopeVersionOffer(
            { envelopeVersion: CURRENT_ENVELOPE_VERSION },
            null,
        )).toBe(true);
        expect(acceptsEnvelopeVersionOffer({}, CURRENT_ENVELOPE_VERSION)).toBe(true);
    });

    it('accepts a range that overlaps the exact local envelope version', () => {
        expect(acceptsEnvelopeVersionOffer(
            { minEnvelopeVersion: 1, maxEnvelopeVersion: 3 },
            1,
            2,
        )).toBe(true);
    });

    it.each([
        ['older exact version', { envelopeVersion: 1 }, 2],
        ['newer exact version', { envelopeVersion: 3 }, 2],
        ['range below local', { minEnvelopeVersion: 1, maxEnvelopeVersion: 2 }, 3],
        ['range above local', { minEnvelopeVersion: 3, maxEnvelopeVersion: 4 }, 2],
        ['reversed range', { minEnvelopeVersion: 3, maxEnvelopeVersion: 2 }, 2],
        ['non-integer range', { minEnvelopeVersion: 1, maxEnvelopeVersion: 2.5 }, 2],
    ])('rejects an envelope %s', (_label, payload, localVersion) => {
        expect(acceptsEnvelopeVersionOffer(payload, null, localVersion)).toBe(false);
    });
});

describe('SteamNetworking session version policy', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the session default on v1 while advertising v2 capability', () => {
        const network = new SteamNetworking();

        expect(network.protocolVersion).toBe(PROTOCOL_V1);
        expect(network.sessionProtocolVersion).toBeNull();
        expect(network.getProtocolOffer()).toMatchObject({
            minVersion: PROTOCOL_V1,
            maxVersion: PROTOCOL_V2,
        });
    });

    it('advertises min/max and negotiates independently of supported-version order', () => {
        const network = new SteamNetworking();
        network.supportedProtocolVersions = ['2.0.0', '3.0.0', '1.0.0', '1.5.0'];

        expect(network.getProtocolOffer()).toMatchObject({
            minVersion: '1.0.0',
            maxVersion: '3.0.0',
        });
        expect(network.negotiateProtocol({
            minVersion: '1.0.0',
            maxVersion: '3.0.0',
        })).toMatchObject({
            accepted: true,
            protocolVersion: '3.0.0',
        });
    });

    it('pins every later peer negotiation to the first locked session version', () => {
        const network = new SteamNetworking();
        network.supportedProtocolVersions = ['3.0.0', '1.0.0', '2.0.0'];

        expect(network.lockProtocolSession('2.0.0')).toBe(true);
        expect(network.negotiateProtocol({
            minVersion: '1.0.0',
            maxVersion: '3.0.0',
        })).toMatchObject({
            accepted: true,
            protocolVersion: '2.0.0',
        });
        expect(network.lockProtocolSession('3.0.0')).toBe(false);
        expect(network.setNegotiatedProtocol('peer-a', '3.0.0')).toBe(false);
        expect(network.setNegotiatedProtocol('peer-a', '2.0.0')).toBe(true);
        expect(network.sessionProtocolVersion).toBe('2.0.0');
    });
});

describe('versioned protocol catalogs', () => {
    it('publishes explicit complete v1 and v2 route tables', () => {
        expect(PROTOCOL_CATALOG_BY_VERSION).toEqual({
            [PROTOCOL_V1]: expect.any(Object),
            [PROTOCOL_V2]: expect.any(Object),
        });
    });

    it('has exactly one complete catalog for every locally supported wire version', () => {
        expect(Object.keys(PROTOCOL_CATALOG_BY_VERSION).sort()).toEqual(
            [...SUPPORTED_PROTOCOL_VERSIONS].sort(),
        );

        const wireMessageTypes = Object.values(MessageTypes).sort();
        for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
            const catalog = PROTOCOL_CATALOG_BY_VERSION[version];
            expect(catalog, `missing protocol catalog for ${version}`).toBeDefined();
            expect(Object.keys(catalog).sort(), `incomplete protocol catalog for ${version}`)
                .toEqual(wireMessageTypes);
        }
    });
});
