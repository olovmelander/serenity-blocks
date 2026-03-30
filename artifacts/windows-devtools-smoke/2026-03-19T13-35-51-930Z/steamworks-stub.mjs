export const SteamCallback = {
  GameLobbyJoinRequested: 'GameLobbyJoinRequested',
  SteamServersConnected: 'SteamServersConnected',
  SteamServersDisconnected: 'SteamServersDisconnected',
  SteamServerConnectFailure: 'SteamServerConnectFailure',
};

export function init(appId) {
  return {
    appId,
    localplayer: {
      getSteamId() {
        return { steamId64: '76561197960287930' };
      },
      getName() {
        return 'Smoke Tester';
      },
    },
    callback: {
      register() {
        return {
          disconnect() {},
        };
      },
    },
    utils: {
      getServerRealTime() {
        return Math.floor(Date.now() / 1000);
      },
    },
    friends: {
      clearRichPresence() {},
    },
  };
}

export default {
  init,
  SteamCallback,
};
