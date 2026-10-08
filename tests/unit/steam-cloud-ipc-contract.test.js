import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
    beforeEach, afterEach, describe, expect, it, vi,
} from 'vitest';

const nativeSource = readFileSync(new URL('../../electron/steam-integration.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');

/** Execute the actual cloud handler bodies and actual preload argument forwarding. */
function createNativeHarness(client) {
    const handlers = new Map();
    const exposed = {};
    const nativeContext = {
        steamworksClient: client,
        Buffer,
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    };
    const helperStart = nativeSource.indexOf('function resolveCloudWriteBuffer');
    const helperEnd = nativeSource.indexOf('\n// ---', helperStart);
    const apiStart = nativeSource.indexOf('function getRemoteStorageApi');
    const apiEnd = nativeSource.indexOf('function getAchievementsApi', apiStart);
    const handlersStart = nativeSource.indexOf('// --- Cloud Storage ---');
    const handlersEnd = nativeSource.indexOf('// --- Friends & Social ---', handlersStart);
    runInNewContext([
        nativeSource.slice(helperStart, helperEnd),
        nativeSource.slice(apiStart, apiEnd),
        nativeSource.slice(handlersStart, handlersEnd),
    ].join('\n'), nativeContext);
    const ipc = {
        invoke: vi.fn(async (channel, ...args) => handlers.get(channel)?.({}, ...args) ?? null),
        on: vi.fn(),
        removeListener: vi.fn(),
    };
    runInNewContext(preloadSource, {
        require: () => ({
            contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
            ipcRenderer: ipc,
        }),
        process: { argv: [] },
    });
    return { nativeContext, ipc, electronAPI: exposed.electronAPI };
}

function createCloud() {
    const files = new Map();
    return {
        files,
        api: {
            fileExists: vi.fn((name) => files.has(name)),
            readFile: vi.fn((name) => {
                if (typeof name !== 'string') throw new TypeError('Expected filename string');
                return files.get(name);
            }),
            writeFile: vi.fn((name, content) => {
                if (typeof name !== 'string' || typeof content !== 'string') throw new TypeError('Expected strings');
                files.set(name, content);
                return true;
            }),
            deleteFile: vi.fn((name) => files.delete(name)),
            getFileTimestamp: vi.fn(() => 123456),
        },
    };
}

async function createService(harness) {
    vi.stubGlobal('window', harness ? { electronAPI: harness.electronAPI } : {});
    const { SteamService } = await import('../../src/core/steam/steam-service.js');
    const service = new SteamService();
    service.isOnline = Boolean(harness);
    service.capabilitiesLoaded = true;
    service.capabilities.cloud = Boolean(harness);
    return service;
}

beforeEach(() => {
    vi.resetModules();
    const values = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Steam Cloud service → preload → native handler contract', () => {
    it('uses the installed cloud namespace and round-trips text with positional arguments', async () => {
        const cloud = createCloud();
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        const document = '{"theme":"forest","name":"森林 🌲"}';
        expect(await service.cloudWrite('unlocks.json', document)).toEqual({ supported: true, success: true });
        expect(harness.ipc.invoke).toHaveBeenLastCalledWith('steam:cloudWrite', 'unlocks.json', document);
        expect(cloud.api.writeFile).toHaveBeenCalledWith('unlocks.json', document);
        expect(await service.cloudRead('unlocks.json')).toEqual({ supported: true, success: true, data: document });
        expect(harness.ipc.invoke).toHaveBeenLastCalledWith('steam:cloudRead', 'unlocks.json');
    });

    it('distinguishes a confirmed missing file from a native read failure or unavailable API', async () => {
        const cloud = createCloud();
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        expect(await service.cloudRead('missing.json')).toEqual({
            supported: true, success: true, data: null, missing: true,
        });
        expect(cloud.api.readFile).not.toHaveBeenCalled();
        cloud.files.set('unlocks.json', 'owned');
        cloud.api.readFile.mockImplementation(() => { throw new Error('remote read denied'); });
        expect(await service.cloudRead('unlocks.json')).toEqual({
            supported: true, success: false, data: null, error: 'remote read denied',
        });
        harness.nativeContext.steamworksClient = null;
        expect(await service.cloudRead('unlocks.json')).toEqual({ supported: false, success: false, data: null });
        expect(await service.cloudWrite('unlocks.json', '{}')).toEqual({ supported: false, success: false });
    });

    it('does not reinterpret invalid data or a raw boot-stub null as safe empty ownership', async () => {
        const cloud = createCloud();
        cloud.files.set('unlocks.json', 'existing');
        cloud.api.readFile.mockReturnValue(null);
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        expect(await service.cloudRead('unlocks.json')).toMatchObject({
            supported: true, success: false, data: null,
        });
        harness.ipc.invoke.mockResolvedValueOnce(null);
        expect(await service.cloudRead('unlocks.json')).toEqual({ supported: false, success: false, data: null });
    });

    it('normalizes write rejection instead of acknowledging it as a durable cloud save', async () => {
        const cloud = createCloud();
        cloud.api.writeFile.mockReturnValue(false);
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        expect(await service.cloudWrite('unlocks.json', '{}')).toEqual({ supported: true, success: false });
        cloud.api.writeFile.mockImplementation(() => { throw new Error('quota'); });
        expect(await service.cloudWrite('unlocks.json', '{}')).toEqual({
            supported: true, success: false, error: 'quota',
        });
    });

    it('replays queued writes and deletes through the same positional native contract', async () => {
        const cloud = createCloud();
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        service.isOnline = false;
        expect(await service.cloudWrite('settings.json', '{"volume":1}')).toMatchObject({ queued: true });
        expect(service.offlineQueue).toHaveLength(1);
        service.isOnline = true;
        await service._flushOfflineQueue();
        expect(cloud.files.get('settings.json')).toBe('{"volume":1}');
        expect(service.offlineQueue).toHaveLength(0);
        service.isOnline = false;
        await service.cloudDelete('settings.json');
        service.isOnline = true;
        await service._flushOfflineQueue();
        expect(cloud.files.has('settings.json')).toBe(false);
        expect(service.offlineQueue).toHaveLength(0);
    });

    it('lets the ownership synchronizer retain its own retry without queuing a stale raw write', async () => {
        const service = await createService(null);
        expect(await service.cloudRead('unlocks.json')).toMatchObject({ supported: false, data: null });
        expect(await service.cloudWrite('unlocks.json', '{}', { queueIfOffline: false })).toEqual({
            supported: false, success: false, queued: false,
        });
        expect(service.offlineQueue).toHaveLength(0);
    });

    it('retains binary compatibility for older remoteStorage.fileWrite adapters', async () => {
        let written;
        const api = {
            fileWrite: vi.fn((name, buffer) => { written = buffer; return name === 'unlocks.json'; }),
            fileRead: vi.fn(() => Buffer.from('stored text')),
            fileExists: vi.fn(() => true),
        };
        const service = await createService(createNativeHarness({ remoteStorage: api }));
        expect(await service.cloudWrite('unlocks.json', 'stored text')).toEqual({ supported: true, success: true });
        expect(Buffer.isBuffer(written)).toBe(true);
        expect(await service.cloudRead('unlocks.json')).toEqual({
            supported: true, success: true, data: 'stored text',
        });
    });

    it('passes file names positionally for presence and timestamp queries too', async () => {
        const cloud = createCloud();
        cloud.files.set('unlocks.json', '{}');
        const harness = createNativeHarness({ cloud: cloud.api });
        const service = await createService(harness);
        expect(await service.cloudExists('unlocks.json')).toEqual({ supported: true, exists: true });
        expect(harness.ipc.invoke).toHaveBeenLastCalledWith('steam:cloudExists', 'unlocks.json');
        expect(await service.cloudGetTimestamp('unlocks.json')).toEqual({ supported: true, timestamp: 123456 });
        expect(harness.ipc.invoke).toHaveBeenLastCalledWith('steam:cloudGetTimestamp', 'unlocks.json');
    });
});
