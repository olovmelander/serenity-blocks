# 0026 — One number says whether two builds can play a match together

- **Status:** accepted
- **Date:** 2026-11-26

## Context

The join handshake compares protocol versions, which choose an envelope and a snapshot frame
([ADR-0013](0013-session-global-v2-snapshot-codec.md)). Three other things must also match for two
builds to play a match, and none of them moved a protocol version when they changed on 2026-11-22
([ADR-0025](0025-versus-attack-styles.md)):

- the packed snapshot body (format 7 to 8),
- the resync sidecar's fields ([ADR-0014](0014-versioned-reliable-resync-sidecar.md)),
- the versus rules, which every client applies to its own board with its own build's copy
  ([ADR-0024](0024-versus-rules.md)).

Run side by side, the network modules from before and after that change accepted each other's
hello and then failed to decode each other's snapshots. The join ended in a kick that told the
player "You were removed from the match by the host." A change to the rules alone would have been
admitted and played out of sync. No public build existed, so no player met this; after the first
patch on Steam they would have, because a running game keeps its old build until it restarts.

## Decision

**`MATCH_COMPATIBILITY` in `src/core/network/match-compatibility.js` is one integer for everything
two builds must share to play a match. It is raised whenever an older build can no longer play a
match with this one.** The protocol versions keep their meaning.

- **In the match list.** A host publishes the number in its lobby data (key `compat`). A room whose
  number differs is still listed, with Join, Drop in and Watch replaced by a disabled button that
  says which side has to update. A lobby with no number counts as older.
- **In the handshake.** The joiner's hello and the host's welcome both carry the number, and each
  side checks the other's. A mismatch is refused with the existing `update_required` or
  `host_update_required` reason, before anyone is added to the roster. This covers joins that never
  pass the list: an invite, Join game, a lobby ID.
- **The same number also covers a returning player.** A held seat is not given back to a client
  whose number no longer matches.

Hiding other-version rooms was rejected: a player could not see why a friend's room was missing.

## Consequences

- Every change to the snapshot body, the sidecar's fields, the versus rules or the pinned core
  rules asks one question: can a build without this change still play a match with one that has
  it? If not, the number goes up, and builds on either side stop offering each other's rooms.
- Before the first public build the number's value is free. After it, raising the number splits
  players until they update, so a patch that raises it should not be shipped lightly.
- Lobbies also publish the game type and the attack style (`game_type`, `attack_style`), so the
  list says what kind of room a match is. Those are labels, not part of the number.
- The number does not cover the launch build's App ID, the relay transport or Steam's own
  versioning. Steam already keeps players of different apps apart.

## Enforcement

`tests/unit/match-compatibility.test.js` pins what the number stands for: the body format, the
envelope and protocol versions, the sidecar's version and field list, a digest of the versus rule
modules' code (comments and layout excluded) and a digest of the hand-computed rule fixtures. When
any of them changes the test fails and tells the developer to decide, raise the number if needed,
and re-pin. `tests/unit/ffa-join-handshake.test.js` covers the refusal from both sides, and
`tests/unit/online-lobby-kind.test.js` the list. The test cannot tell a rules change from a
refactor; that judgement is the developer's, which is why the failure message spells out the
question.
