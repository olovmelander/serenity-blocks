/**
 * Deterministic local-build content identity for Stillwater validation artifacts.
 *
 * This records hashes for the local files that define the validation and the
 * complete Stillwater Vite-manifest closure. It is not a signed attestation and
 * does not prove that a browser or external preview served these exact bytes.
 */
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import {
    readFile,
    realpath,
} from 'fs/promises';
import path from 'path';

export const STILLWATER_PROVENANCE_SCHEMA = 'stillwater-source-build-v5';

const REQUIRED_VALIDATION_LOGIC_PATHS = Object.freeze([
    'scripts/run-electron.mjs',
    'scripts/stillwater-artifact-provenance.mjs',
    'scripts/stillwater-perf-budget.mjs',
    'scripts/stillwater-wave8-validation.mjs',
]);

function normalizeReportPath(value) {
    return String(value).replace(/\\/g, '/');
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .reduce((result, key) => {
            result[key] = canonicalize(value[key]);
            return result;
        }, {});
}

function canonicalStringify(value) {
    return JSON.stringify(canonicalize(value));
}

function hashBytes(value) {
    return createHash('sha256').update(value).digest('hex');
}

function assertHashableBytes(value, label) {
    if (
        typeof value !== 'string'
        && !Buffer.isBuffer(value)
        && !(value instanceof Uint8Array)
    ) {
        throw new TypeError(`${label} must be a string, Buffer, or Uint8Array.`);
    }
}

function normalizeManifestFilePath(value, label) {
    const normalized = normalizeReportPath(value);
    if (
        !normalized
        || normalized.includes('\0')
        || normalized.includes('?')
        || normalized.includes('#')
        || normalized.startsWith('/')
        || /^[a-zA-Z]:\//.test(normalized)
        || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)
        || normalized.split('/').some((segment) => segment === '..' || segment === '.')
        || path.posix.normalize(normalized) !== normalized
    ) {
        throw new Error(`${label} is not a confined relative build path: ${value}`);
    }
    return normalized;
}

function normalizeStringArray(value, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
        throw new TypeError(`${label} must be an array of strings.`);
    }
    return [...new Set(value)].sort((left, right) => left.localeCompare(right));
}

function createFileRecord(file, label) {
    if (!file || typeof file !== 'object') {
        throw new TypeError(`${label} must be an object.`);
    }
    assertHashableBytes(file.bytes, `${label} bytes`);
    return {
        path: normalizeReportPath(file.path),
        sizeBytes: Buffer.byteLength(file.bytes),
        sha256: hashBytes(file.bytes),
    };
}

function createFileSetIdentity(files, label) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error(`${label} must contain at least one file.`);
    }
    const records = files
        .map((file, index) => createFileRecord(file, `${label}[${index}]`))
        .sort((left, right) => left.path.localeCompare(right.path));
    const paths = records.map((record) => record.path);
    if (new Set(paths).size !== paths.length) {
        throw new Error(`${label} contains duplicate paths.`);
    }
    return {
        fileCount: records.length,
        files: records,
        sha256: hashBytes(canonicalStringify(records)),
    };
}

export function canonicalizeGitPorcelainStatus(value) {
    const lines = String(value || '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .filter((line) => line.length > 0)
        .sort((left, right) => left.localeCompare(right));
    return lines.length ? `${lines.join('\n')}\n` : '';
}

export function resolveStillwaterThemeAsset(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new TypeError('Vite manifest must be an object.');
    }
    const candidates = Object.entries(manifest)
        .filter(([, entry]) => (
            entry
            && typeof entry === 'object'
            && typeof entry.file === 'string'
            && /(?:^|\/)theme-stillwater-[^/]+\.js$/i.test(
                normalizeReportPath(entry.file),
            )
        ))
        .map(([manifestKey, entry]) => ({
            manifestKey,
            file: normalizeManifestFilePath(
                entry.file,
                `Vite manifest entry ${manifestKey}`,
            ),
        }))
        .sort((left, right) => (
            left.manifestKey.localeCompare(right.manifestKey)
            || left.file.localeCompare(right.file)
        ));

    if (candidates.length !== 1) {
        throw new Error(
            `Expected exactly one emitted Stillwater theme asset; found ${candidates.length}.`,
        );
    }
    return candidates[0];
}

export function resolveStillwaterManifestClosure(manifest) {
    const themeAsset = resolveStillwaterThemeAsset(manifest);
    const visitedEntries = new Set();
    const emittedFiles = new Set();

    const visit = (manifestKey) => {
        if (visitedEntries.has(manifestKey)) return;
        const entry = manifest[manifestKey];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`Missing Vite manifest dependency entry: ${manifestKey}`);
        }
        if (typeof entry.file !== 'string') {
            throw new Error(`Vite manifest entry has no emitted file: ${manifestKey}`);
        }
        visitedEntries.add(manifestKey);
        emittedFiles.add(normalizeManifestFilePath(
            entry.file,
            `Vite manifest entry ${manifestKey}`,
        ));

        ['assets', 'css'].forEach((field) => {
            normalizeStringArray(entry[field], `${manifestKey}.${field}`)
                .forEach((file) => emittedFiles.add(normalizeManifestFilePath(
                    file,
                    `${manifestKey}.${field}`,
                )));
        });

        const dependencies = [
            ...normalizeStringArray(entry.imports, `${manifestKey}.imports`),
            ...normalizeStringArray(
                entry.dynamicImports,
                `${manifestKey}.dynamicImports`,
            ),
        ].sort((left, right) => left.localeCompare(right));
        dependencies.forEach((dependencyKey) => {
            if (!Object.prototype.hasOwnProperty.call(manifest, dependencyKey)) {
                throw new Error(
                    `Missing Vite manifest dependency entry: ${dependencyKey}`,
                );
            }
            visit(dependencyKey);
        });
    };

    visit(themeAsset.manifestKey);
    return {
        themeManifestKey: themeAsset.manifestKey,
        themeAssetFile: themeAsset.file,
        manifestEntryKeys: [...visitedEntries]
            .sort((left, right) => left.localeCompare(right)),
        files: [...emittedFiles].sort((left, right) => left.localeCompare(right)),
    };
}

export function createStillwaterSourceBuildFingerprint({
    gitHead,
    gitStatus,
    manifestBytes,
    manifestPath,
    manifestClosureFiles,
    manifestEntryKeys,
    performanceBudgetBytes,
    performanceBudgetPath,
    themeAssetPath,
    themeManifestKey,
    validationLogicFiles,
}) {
    const normalizedHead = String(gitHead || '').trim().toLowerCase();
    if (!/^[a-f0-9]{40,64}$/.test(normalizedHead)) {
        throw new Error('Git HEAD must be a 40-64 character hexadecimal object id.');
    }
    assertHashableBytes(manifestBytes, 'Vite manifest bytes');
    assertHashableBytes(performanceBudgetBytes, 'Performance budget bytes');

    const canonicalGitStatus = canonicalizeGitPorcelainStatus(gitStatus);
    const gitStatusEntries = canonicalGitStatus
        ? canonicalGitStatus.trimEnd().split('\n')
        : [];
    const manifestClosure = createFileSetIdentity(
        manifestClosureFiles,
        'Stillwater manifest closure',
    );
    const normalizedEntryKeys = normalizeStringArray(
        manifestEntryKeys,
        'Stillwater manifest entry keys',
    );
    const validationLogic = createFileSetIdentity(
        validationLogicFiles,
        'Stillwater validation logic',
    );
    const validationPaths = validationLogic.files.map((file) => file.path);
    if (
        validationPaths.length !== REQUIRED_VALIDATION_LOGIC_PATHS.length
        || REQUIRED_VALIDATION_LOGIC_PATHS.some(
            (requiredPath) => !validationPaths.includes(requiredPath),
        )
    ) {
        throw new Error(
            'Stillwater validation logic must contain exactly the required four files.',
        );
    }

    const normalizedThemeAssetPath = normalizeReportPath(themeAssetPath);
    const themeAsset = manifestClosure.files.find(
        (file) => file.path === normalizedThemeAssetPath,
    );
    if (!themeAsset) {
        throw new Error('Stillwater entry chunk is missing from its manifest closure.');
    }
    const validationHarness = validationLogic.files.find(
        (file) => file.path === 'scripts/stillwater-wave8-validation.mjs',
    );

    const scope = {
        kind: 'local-build-content-identity',
        cryptographicAttestation: false,
        servedBytesVerified: false,
        gitContextIncludedInFingerprint: false,
    };
    const git = {
        head: normalizedHead,
        dirty: gitStatusEntries.length > 0,
        statusEntryCount: gitStatusEntries.length,
        statusSha256: hashBytes(canonicalGitStatus),
    };
    const build = {
        viteManifest: {
            path: normalizeReportPath(manifestPath),
            sizeBytes: Buffer.byteLength(manifestBytes),
            sha256: hashBytes(manifestBytes),
        },
        performanceBudget: {
            path: normalizeReportPath(performanceBudgetPath),
            sizeBytes: Buffer.byteLength(performanceBudgetBytes),
            sha256: hashBytes(performanceBudgetBytes),
        },
        stillwaterThemeAsset: {
            manifestKey: String(themeManifestKey),
            ...themeAsset,
        },
        stillwaterManifestClosure: {
            manifestEntryKeys: normalizedEntryKeys,
            ...manifestClosure,
        },
        validationHarness: { ...validationHarness },
        validationLogic,
    };
    const identity = {
        schema: STILLWATER_PROVENANCE_SCHEMA,
        scope,
        git,
        build,
    };
    const fingerprintInputs = {
        schema: STILLWATER_PROVENANCE_SCHEMA,
        scope,
        build,
    };

    return {
        ...identity,
        fingerprintSha256: hashBytes(canonicalStringify(fingerprintInputs)),
    };
}

function runGit(rootDir, args) {
    return new Promise((resolve, reject) => {
        execFile(
            'git',
            args,
            {
                cwd: rootDir,
                encoding: 'utf8',
                maxBuffer: 16 * 1024 * 1024,
                windowsHide: true,
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(
                        `git ${args.join(' ')} failed: ${String(stderr || error.message).trim()}`,
                    ));
                    return;
                }
                resolve(stdout);
            },
        );
    });
}

function resolveDistAssetPath(distDirectory, assetFile) {
    const distRoot = path.resolve(distDirectory);
    const assetPath = path.resolve(distRoot, ...assetFile.split('/'));
    const relative = path.relative(distRoot, assetPath);
    if (
        !relative
        || relative === '..'
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative)
    ) {
        throw new Error(`Stillwater manifest asset escapes dist/: ${assetFile}`);
    }
    return assetPath;
}

async function readConfinedDistFile(distDirectory, distRealPath, assetFile) {
    const assetPath = resolveDistAssetPath(distDirectory, assetFile);
    const assetRealPath = await realpath(assetPath);
    const relativeRealPath = path.relative(distRealPath, assetRealPath);
    if (
        relativeRealPath === '..'
        || relativeRealPath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeRealPath)
    ) {
        throw new Error(`Stillwater manifest asset resolves outside dist/: ${assetFile}`);
    }
    return readFile(assetRealPath);
}

export async function collectStillwaterSourceBuildFingerprint({
    rootDir,
    distDirectory = path.join(rootDir, 'dist'),
}) {
    const manifestAbsolutePath = path.join(distDirectory, 'manifest.json');
    const performanceBudgetAbsolutePath = path.join(rootDir, 'perf-budgets.json');
    const validationLogicPaths = REQUIRED_VALIDATION_LOGIC_PATHS.map(
        (relativePath) => ({
            relativePath,
            absolutePath: path.join(rootDir, ...relativePath.split('/')),
        }),
    );
    const [
        gitHead,
        gitStatus,
        manifestBytes,
        performanceBudgetBytes,
        ...validationLogicBytes
    ] = await Promise.all([
        runGit(rootDir, ['rev-parse', '--verify', 'HEAD']),
        runGit(rootDir, [
            'status',
            '--porcelain=v1',
            '--untracked-files=normal',
            '--ignore-submodules=none',
        ]),
        readFile(manifestAbsolutePath),
        readFile(performanceBudgetAbsolutePath),
        ...validationLogicPaths.map((file) => readFile(file.absolutePath)),
    ]);

    let manifest = null;
    try {
        manifest = JSON.parse(manifestBytes.toString('utf8'));
    } catch (error) {
        throw new Error(`Could not parse Vite manifest: ${error.message}`);
    }
    const closure = resolveStillwaterManifestClosure(manifest);
    const distRealPath = await realpath(distDirectory);
    const closureBytes = await Promise.all(
        closure.files.map((file) => (
            readConfinedDistFile(distDirectory, distRealPath, file)
        )),
    );
    const distReportPath = normalizeReportPath(path.relative(rootDir, distDirectory));
    const manifestClosureFiles = closure.files.map((file, index) => ({
        path: `${distReportPath}/${file}`,
        bytes: closureBytes[index],
    }));
    const themeAssetPath = `${distReportPath}/${closure.themeAssetFile}`;
    const validationLogicFiles = validationLogicPaths.map((file, index) => ({
        path: file.relativePath,
        bytes: validationLogicBytes[index],
    }));

    return createStillwaterSourceBuildFingerprint({
        gitHead,
        gitStatus,
        manifestBytes,
        manifestPath: normalizeReportPath(path.relative(rootDir, manifestAbsolutePath)),
        manifestClosureFiles,
        manifestEntryKeys: closure.manifestEntryKeys,
        performanceBudgetBytes,
        performanceBudgetPath: normalizeReportPath(
            path.relative(rootDir, performanceBudgetAbsolutePath),
        ),
        themeAssetPath,
        themeManifestKey: closure.themeManifestKey,
        validationLogicFiles,
    });
}
