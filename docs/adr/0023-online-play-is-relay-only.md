# 0023 — Online play goes through Steam's relays, or not at all

- **Status:** accepted
- **Date:** 2026-11-12

## Context

Online Versus used steamworks.js 0.4.0's P2P calls, which are Steam's legacy ISteamNetworking
interface. That interface connects two players directly whenever Steam can, and a direct
connection shows each player the other's IP address. The game limited who it connected to
(lobby members only, every match a star through its host: `electron/p2p-session-gate.js`) and
told players in a notice, but it could not stop the address being seen.

Steam's newer ISteamNetworkingMessages interface can run every session through Valve's relays
(Steam Datagram Relay) with ICE turned off, which never shares an address. steamworks.js 0.4.0
does not expose it, but the Steam API library it loads exports it in its flat C API.

## Decision

**Online play runs only through Steam's relays.** `electron/steam-relay-transport.js` calls
ISteamNetworkingMessages through koffi (a C FFI, pinned, packaged beside steamworks.js) and turns
ICE off for the whole process before any session exists.

- If the relay transport cannot open, a store build does not play online: creating or joining a
  lobby is refused with a message, and nothing is sent. There is no silent fallback to direct
  connections.
- A development run may fall back to the legacy calls with `SERENITY_ALLOW_DIRECT_P2P=1`
  (`electron/debug-flags.js`); a store build ignores it.
- A legacy (direct) session request is never accepted outside that development mode.
- A session found connected but not relayed is closed (with ICE off it should never happen).
- The player-facing text (the online notice, the public-match note, the privacy page) promises
  that no player sees another's IP address. It may say so only while this holds.

## Consequences

- The privacy promise depends on koffi and its platform binary being in the package:
  `scripts/packaged-app-check.mjs` fails a package without them.
- A player whose Steam cannot reach the relay network cannot play online. Steam's relays serve
  P2P for every Steam game, so this is expected to be rare. It shows as a clear message.
- Relays add some latency compared with a direct route. Players are not offered a direct option.
- Changing the transport, or adding a direct-connection option, is a change to this ADR and to
  the privacy page, not a networking tweak.
- Steam's session-request callback is not available through steamworks.js, so pending sessions
  are accepted by polling `AcceptSessionWithUser` for the peers the session gate allows.

Record: [ONLINE_RELAY_TRANSPORT_2026-11.md](../ONLINE_RELAY_TRANSPORT_2026-11.md).
