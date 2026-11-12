# Online play through Steam's relays (2026-11-12)

Online Versus no longer lets players see each other's IP addresses. Every packet goes through
Valve's relay servers (Steam Datagram Relay). If the relays cannot be used, a store build does not
play online. Decision: [ADR-0023](adr/0023-online-play-is-relay-only.md).

**Not yet tested against real Steam.** This was built and tested without a Steam client (see
*What was checked*). The [two-account test](#the-two-account-test) below has to pass before
release.

## Why

steamworks.js 0.4.0 offers only Steam's legacy P2P calls (ISteamNetworking). They connect two
players directly whenever Steam can, and then each sees the other's IP address. Steam's newer
ISteamNetworkingMessages interface can run every session through the relays and never share an
address, but steamworks.js does not expose it. The Steam API library it loads
(`steam_api64.dll`, `libsteam_api.so`) exports it in its flat C API.

## How it works

| Piece | What it does |
|---|---|
| `electron/steam-relay-transport.js` | Loads the same Steam API library through koffi, turns ICE off for the whole process (`P2P_Transport_ICE_Enable` = 0), warms up the relay network, and sends, reads, accepts and closes sessions through ISteamNetworkingMessages. Pure apart from koffi and the library path. |
| `electron/steam-integration.js` | Opens the transport as soon as Steam starts, before any callback can accept a session. The `steam:sendP2PPacket` / `readP2PPacket` / `isP2PPacketAvailable` / `closeP2PSession` handlers use it. The renderer's networking is unchanged. |
| `electron/steam-network-transport.js` | The mode the page is told (`steam:getNetworkTransport`): `relay`, `unavailable`, `direct` (development only) or `none`. |
| `electron/p2p-session-gate.js` | Unchanged rules: lobby members only, and everyone but the host talks to the host alone. `allowsSession` exposes the rule to the relay transport. |
| `src/core/steam/steam-networking.js` | Before creating or joining a lobby, asks for the transport and stops with a readable message when it is `unavailable`. |

**Sessions without the callback.** A peer's first message raises a session request, which
steamworks.js cannot pass on (its callbacks are a fixed list). So on each packet read (at most every
200 ms), the main process calls `AcceptSessionWithUser` for every lobby member the gate allows.
Steam accepts a pending request and ignores a peer who has not asked. Sending to a peer accepts its
request too. A peer the gate does not allow is never accepted, and its messages never arrive.

**Watching the sessions.** Every second, each session's state is read. On reaching Connected the
log notes `relayed=… peer address known=…`. A session that ends is reported to the page as
`steam:p2pSessionFailed`, like the legacy connect-fail callback. A session that is connected but
not relayed is closed and reported (with ICE off this should never happen).

**Send types.** The packet codec's legacy types map to the new flags: Unreliable → 0,
UnreliableNoDelay → 5, Reliable → ReliableNoNagle (9), ReliableWithBuffering → Reliable (8). Every
send adds AutoRestartBrokenSession (32). Everything rides channel 0.

**Memory layouts** come from Valve's `steamnetworkingtypes.h` (the same in the open-source
GameNetworkingSockets): the identity is 136 bytes packed (type 16, size 8, the SteamID at 8). A
message has its data pointer at 0, size at 8 and sender at 16. The connection info has its remote
address at 148, state at 176 and flags at 440. The session check trusts the info only while its
state agrees with the call's return value.

**If the relay cannot open** (koffi missing, a missing export, Steam refusing the config): the mode
is `unavailable`. Lobbies cannot be created or joined, and the page shows "Online play needs Steam's
relay network, which could not be started on this computer. Restart Steam and the game, then try
again." The reason is in the Steam log (`logs/steam-init.log` in the game's data folder,
`%APPDATA%\serenity-blocks` on Windows). A development run may set `SERENITY_ALLOW_DIRECT_P2P=1`
to use the legacy calls instead; a store build ignores it.

**Legacy requests are ignored.** Outside that development mode, a peer asking for a session the
old way (which would connect directly) is never accepted.

## Packaging

- `koffi` is pinned to 3.3.5 in `dependencies`. npm installs only the platform's binary package
  (`@koromix/koffi-win32-x64` or `-linux-x64`).
- `build.win` / `build.linux` copy `koffi` (its scripts, `package.json`, `LICENSE.txt`) and the
  platform binary (without its `.lib`) to `resources/native_modules/`, beside steamworks.js. koffi
  finds its binary at `../../../@koromix/koffi-<platform>` from its own folder.
- `scripts/packaged-app-check.mjs` fails a package without koffi's files or a `koffi.node`.
- `THIRD_PARTY_NOTICES.md` §36–37 and `CREDITS.md` name koffi and the Node-API headers in it.

## What the player reads

- The online notice: "An online match connects your computer to the match's host, and the host's
  computer to everyone in the match, always through Steam's relay servers, so the players you play
  with never see your IP address. They see your Steam name and Steam ID, and what you type in chat."
- Creating a public match: "Players who join see your Steam name, never your IP address."
- `PRIVACY_POLICY.md`, *Connections*: through Steam's relay servers, never computer to computer;
  no online play when the relay network cannot be reached.

## What was checked

- Unit tests (`tests/unit/steam-relay-transport.test.js`, with a fake koffi whose Steam keeps
  messages in a fake address space):
  - ICE is turned off before anything else, and the transport refuses to open without it;
  - the identity layout, and the send flags and channel;
  - reads in order, copied out of Steam's memory, every message released, oversize and non-SteamID
    senders dropped;
  - accept and close for the named peer only;
  - session reading, and the layout guard;
  - the wiring: the transport opens before callbacks, legacy requests are ignored, no lobby and no
    packet without the relay.
- Also tested: the store-build rule for the direct fallback, the gate's `allowsSession`, and the
  package checks.
- The real `steam_api64.dll` from steamworks.js 0.4.0, loaded through the real koffi 3.3.5 on
  Windows: all eleven functions resolve with these signatures. Without a Steam login the transport
  refuses with "Steam's networking interfaces are not available", without crashing.
- **Not checked:** a real Steam session. This development machine has no Steam client.

## The one-account check

With Steam running and logged in, after `npm ci`:

```sh
node scripts/steam-relay-smoke.mjs        # AppID from steam_appid.txt, else 480
```

It should print `ok` for Steam, for the relay transport (ICE off) and for "Steam relay network:
current".

## The two-account test

Two computers, ideally on different networks (one on a phone hotspot), each logged in to a
different Steam account, both on this build.

1. On both, run the one-account check above.
2. A hosts an online match (Friends or Anyone). B joins it from the list or by invite.
3. Play a full match. Then B leaves and rejoins, and A leaves while B waits.
4. In each computer's Steam log (`logs/steam-init.log` in the game's data folder,
   `%APPDATA%\serenity-blocks` on Windows) look for:
   - `Relay transport open: ISteamNetworkingMessages, direct connections (ICE) off`;
   - `Accepted a relayed session from lobby member …` on the host;
   - `Session with …: connected, relayed=true, peer address known=false` on both;
   - no `not relayed` and no `Ignored a direct P2P session request` lines.
5. Optional, the strongest check: during the match, run `netstat -an` (Windows) or `ss -u -a`
   (Linux) on A, and confirm no UDP connection to B's public IP address exists. Find B's address
   with any "what is my IP" page on B.
6. Spectating and a host handover (the host quits mid-match with three players) should play as
   before.

If step 2 fails with the relay message on either computer, its Steam log says why the transport
did not open.
