const VALID_LOG_LEVELS = new Set(['debug', 'log', 'info', 'warn', 'error']);

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function coerceLogLevel(level) {
  if (typeof level !== 'string') {
    return 'info';
  }

  const normalized = level.trim().toLowerCase();
  return VALID_LOG_LEVELS.has(normalized) ? normalized : 'info';
}

export function serializeLogValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeLogValue(item, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const serialized = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      serialized[key] = serializeLogValue(entryValue, seen);
    });
    seen.delete(value);
    return serialized;
  }

  return String(value);
}

export function formatLogArguments(args = []) {
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }

  return args.map((arg) => {
    if (typeof arg === 'string') {
      return arg;
    }

    const serialized = serializeLogValue(arg);
    if (typeof serialized === 'string') {
      return serialized;
    }

    try {
      return JSON.stringify(serialized);
    } catch {
      return String(serialized);
    }
  }).join(' ');
}

export function normalizeRendererReportedLog(payload = {}, fallbackProcessType = 'renderer') {
  const sourceProcess = payload?.sourceProcess === 'preload' ? 'preload' : fallbackProcessType;
  const args = Array.isArray(payload?.args)
    ? payload.args.map((arg) => serializeLogValue(arg))
    : [];
  const message = typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message
    : formatLogArguments(args);

  return {
    sourceProcess,
    level: coerceLogLevel(payload?.level),
    message: message || '',
    timestamp: typeof payload?.timestamp === 'string' && payload.timestamp
      ? payload.timestamp
      : new Date().toISOString(),
    stack: typeof payload?.stack === 'string' && payload.stack ? payload.stack : null,
    details: payload?.details && typeof payload.details === 'object' && !Array.isArray(payload.details)
      ? serializeLogValue(payload.details)
      : {},
    args,
  };
}

function urlsMatch(targetUrl, mainWindowUrl) {
  if (targetUrl === mainWindowUrl) {
    return true;
  }

  const parsedTargetUrl = safeParseUrl(targetUrl);
  const parsedMainWindowUrl = safeParseUrl(mainWindowUrl);
  if (!parsedTargetUrl || !parsedMainWindowUrl) {
    return false;
  }

  return parsedTargetUrl.protocol === parsedMainWindowUrl.protocol
    && parsedTargetUrl.host === parsedMainWindowUrl.host
    && parsedTargetUrl.pathname === parsedMainWindowUrl.pathname;
}

export function resolveRendererDebugTarget({
  targets = [],
  mainWindowUrl = '',
} = {}) {
  const pageTargets = Array.isArray(targets)
    ? targets.filter((target) => target && target.type === 'page')
    : [];

  if (pageTargets.length === 0) {
    return null;
  }

  if (typeof mainWindowUrl === 'string' && mainWindowUrl) {
    const matchedTarget = pageTargets.find((target) => urlsMatch(target.url, mainWindowUrl));
    if (matchedTarget) {
      return matchedTarget;
    }
  }

  return pageTargets[0];
}

export function resolveDevToolsFrontendUrl({
  target = null,
  remoteDebuggingUrl = '',
} = {}) {
  const frontendPath = typeof target?.devtoolsFrontendUrl === 'string'
    ? target.devtoolsFrontendUrl.trim()
    : '';

  if (!frontendPath || typeof remoteDebuggingUrl !== 'string' || !remoteDebuggingUrl) {
    return null;
  }

  try {
    return new URL(frontendPath, `${remoteDebuggingUrl}/`).toString();
  } catch {
    return null;
  }
}

export function buildDebugToolsStatus({
  isPackagedWindowsApp = false,
  remoteDebuggingPort = null,
  remoteDebuggingUrl = null,
  mainInspectorPort = null,
  mainInspectorUrl = null,
  lastRendererDebuggerUrl = null,
  logPaths = {},
} = {}) {
  const hasRemotePort = remoteDebuggingPort !== null
    && remoteDebuggingPort !== undefined
    && remoteDebuggingPort !== '';
  const hasMainInspectorPort = mainInspectorPort !== null
    && mainInspectorPort !== undefined
    && mainInspectorPort !== '';
  const normalizedRemotePort = hasRemotePort && Number.isFinite(Number(remoteDebuggingPort))
    ? Number(remoteDebuggingPort)
    : null;
  const normalizedMainPort = hasMainInspectorPort && Number.isFinite(Number(mainInspectorPort))
    ? Number(mainInspectorPort)
    : null;

  return {
    packagedExternalDebugger: Boolean(isPackagedWindowsApp),
    embeddedDevToolsSupported: !isPackagedWindowsApp,
    rendererDebugger: {
      mode: isPackagedWindowsApp ? 'external' : 'embedded',
      enabled: Boolean(remoteDebuggingUrl),
      port: normalizedRemotePort,
      baseUrl: remoteDebuggingUrl || null,
      jsonListUrl: remoteDebuggingUrl ? `${remoteDebuggingUrl}/json/list` : null,
      lastOpenedUrl: lastRendererDebuggerUrl || null,
    },
    mainInspector: {
      enabled: normalizedMainPort !== null,
      port: normalizedMainPort,
      webSocketUrl: mainInspectorUrl || null,
      chromeInspectUrl: 'chrome://inspect/#devices',
      attachHint: normalizedMainPort !== null
        ? `Attach Chrome/Edge or VS Code to 127.0.0.1:${normalizedMainPort}.`
        : 'Set SERENITY_MAIN_INSPECT_PORT or --serenity-main-inspect-port to enable main-process debugging.',
    },
    logPaths: logPaths || {},
  };
}

export function getPrimaryDebugMenuLabel(isPackagedWindowsApp = false) {
  return isPackagedWindowsApp ? 'Open Renderer Debugger' : 'Toggle Developer Tools';
}
