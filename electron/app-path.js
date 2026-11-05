import path from 'node:path';

/**
 * Whether a path lies inside a folder, the folder itself excluded. Paths go through path.relative,
 * which knows the platform's rules: on Windows a path's case does not matter. A plain string
 * comparison refused the game its own IPC when it was launched as `c:\...`, because the launcher
 * decides the case of the app's path while Chromium reports the page as `file:///C:/...`.
 *
 * @param {string} rootPath absolute path of the folder
 * @param {string} targetPath absolute path to test
 * @param {import('node:path').PlatformPath} [pathApi] the rules to apply; defaults to this platform's
 * @returns {boolean}
 */
export function isPathInside(rootPath, targetPath, pathApi = path) {
    const fromRoot = pathApi.relative(rootPath, targetPath);
    return fromRoot !== ''
        && fromRoot !== '..'
        && !fromRoot.startsWith(`..${pathApi.sep}`)
        && !pathApi.isAbsolute(fromRoot);
}
