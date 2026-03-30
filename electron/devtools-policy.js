export const MANAGED_DEVTOOLS_HOST_ROLE = 'managed-devtools-host';

export function getDevToolsOpenStrategy({
  isPackagedWindowsApp = false,
  devToolsSmokeMode = false,
} = {}) {
  return {
    useManagedHost: Boolean(devToolsSmokeMode && !isPackagedWindowsApp),
    openOptions: {
      mode: 'detach',
      activate: true,
      title: 'Serenity Blocks DevTools',
    },
  };
}

export function shouldAttachSteamOverlayFrameInvalidator(windowRole = null) {
  return windowRole !== MANAGED_DEVTOOLS_HOST_ROLE;
}

export function decideDevToolsOpenRequest({
  activePendingRequest = null,
  newRequestId,
  source = 'unknown',
  now = Date.now(),
} = {}) {
  if (activePendingRequest?.requestId) {
    return {
      type: 'reuse',
      request: activePendingRequest,
      response: {
        accepted: true,
        requestId: activePendingRequest.requestId,
        alreadyOpen: false,
      },
      ageMs: Number.isFinite(activePendingRequest.startedAt)
        ? Math.max(0, now - activePendingRequest.startedAt)
        : null,
    };
  }

  return {
    type: 'create',
    request: {
      requestId: newRequestId,
      source,
      startedAt: now,
    },
    response: {
      accepted: true,
      requestId: newRequestId,
      alreadyOpen: false,
    },
    ageMs: 0,
  };
}
