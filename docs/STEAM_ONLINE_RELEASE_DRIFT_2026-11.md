# Steam, records and online: drift check

**26 November 2026, main at `e31421d3b`. Approved the same day: every recommendation below was taken. What was built is in [Outcome](#outcome) and in the [handover](STEAM_ONLINE_RELEASE_HANDOVER_2026-11.md#round-two--26-november-2026). The findings are kept as written, as the record of what was true before the fixes.**

Everything round one built on 18 November still passes its offline checks on current main. The
versus rebuild of 22 November broke one Steam stat, left the join path with no check that two
builds can play together, and made the live test script wrong for the default game type. Two
release risks sit outside that drift: nothing is code-signed, and the Linux package has never been
run. Nothing has been proven on real Steam yet.

This builds on the [audit](STEAM_ONLINE_RELEASE_AUDIT_2026-11.md) (the baseline before the build),
the [plan](STEAM_ONLINE_RELEASE_PLAN_2026-11.md) (decisions D1 to D8, checklist, test script) and the
[handover](STEAM_ONLINE_RELEASE_HANDOVER_2026-11.md). Decisions D1 to D8 stand, except where D13 below
asks about one of them.

## Outcome

| Finding | Decision | State on branch `audit/steam-online-drift` |
|---|---|---|
| B1 · Missing App ID and contact | yours | Open. |
| B2 · Nothing is signed | D9: sign | A store build now stops when the `.exe` or an addon is unsigned. The certificate is yours to get. |
| B3 · Live test and its script | | Script rewritten (T1 to T15, three accounts, two-machine scenarios). Not run. |
| B4 · Kills stat | D10 | Fixed, with a test that plays a free-for-all through the real frag tracker. The time-based bound uses the player's own clock, not the host's figure. |
| S1 · Mixed builds | D11 | Fixed: the match compatibility number (ADR-0026), in the list and the handshake. |
| S2 · `wireV2` expiry | D12 | Re-dated to 2027-03-31; ADR-0013 amended. |
| S3 · List hides the room's kind | | Fixed: game type and attack style in the list, attack rules in the waiting room, the Drop in label. |
| S4 · Private rooms | D13: keep invite-only | The lobby ID is hidden in a private room. What Steam does with a bare ID is still for T2. |
| S5 · Both win on a broken link | D14 | Fixed for the side whose own connection is down. Needs T4 to prove the timing on real Steam. |
| S6 · Silent host change | | The notice is built. The frag credit after a host change is not: see the handover's open list. |
| S7 · Orb boards, no freeze | D15 | Built: a per-orb fingerprint test and per-orb board generations. |
| S8 · Linux never run, no CI packaging | | The CI job is written and has never run. The Linux package still needs a Linux machine. |
| S9 · Main checkout's packages | | Done: copied in, the addon loads there. |
| S10 · Larger updates with hidden cells | | A Full blind case is in T4. No code change. |
| S11 · Privacy date | | Done, with one clause for the version a lobby publishes. |
| P1, P2, P3, P6, P8 | | Fixed. |
| P4, P5 · Two stat edges | | Open: your call. |
| P7 · Icon in the bare package command | | Noted in the handover; `npm run build:win` is the command to use. |

## Three things only you can do

1. **Get the App ID and a monitored contact address.** The store build refuses to package without
   both. They go in `electron/steam-app-id.js:21` and `PRIVACY_POLICY.md:3`.
2. **Decide how the Windows build gets signed** (D9). Signing needs a legal identity, so it follows
   your company decision and can take days to weeks to arrange.
3. **Line up the machines and accounts for the live test.** Two licensed accounts on two PCs with
   Steam installed, a third for a host change during a match, and one Linux PC or a Steam Deck. This
   laptop has no Steam client and there is no Linux machine.

## How to read the findings

Every reference is `file:line` at `e31421d3b`. Each finding says how it was established:

| Label | Meaning |
|---|---|
| **Ran** | I ran the real module or command and saw the result. |
| **Test** | An existing unit test proves it. |
| **Read** | Read in the code, not executed. |
| **Steam** | Only a real Steam session can prove it. Not proven. |

## Blockers

### B1 · The store build is missing its two inputs

- **What happens:** `SERENITY_RELEASE=1 npm run check:release-gates` exits 1 and names the missing
  App ID and contact address. That is the gate working as designed. (Ran)
- **Closed since the audit:** the gate now rejects an empty contact
  (`scripts/release-gate-policy.mjs:33`, Test), and the ID check rejects 0, 480 and anything above
  32 bits (`electron/steam-app-id.js:29-31`, Read).
- **Fix:** yours, item 1 above.

### B2 · Nothing is code-signed, and there is no signing setup

- **What happens:** Windows 11 with Smart App Control on blocks an unsigned program unless
  Microsoft's cloud service already trusts the file, and Microsoft offers no per-app exception
  ([Microsoft's FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)).
  This laptop has it on, and on 18 November it refused the staged build (handover, error 4551). So
  the candidate may not start on your own machine on App ID day.
- **Evidence:** the staged `Serenity Blocks.exe`, `steamworksjs.win32-x64-msvc.node` and
  `koffi.node` all report `NotSigned`; Valve's `steam_api64.dll` is `Valid`. (Ran)
  `package.json:99,134` sets what to sign and how, but no certificate. `scripts/build-win.mjs:20-23`
  only documents the `CSC_LINK` variable. The handover's step 3 says "the project's normal signing
  pipeline"; there is none. (Read)
- **Fix:** decision D9.

### B3 · The live test has never run, and its script no longer matches the game

- **What happens:** the run log is still empty (`docs/TWO_MACHINE_STEAM_VALIDATION.md:93`). The
  script was written for rounds and a duel forfeit. The default is now a free-for-all to 10 frags
  where a knocked-out player comes back at a key press.
- **Examples:** T4 says "play 10 min on shipping defaults", but shipping defaults end at 10 frags.
  T11's "frags within bounds" passes while the stat is wrong (B4). Two-machine scenarios C and D
  need a third player to mean anything. Ten new mechanics have no test case at all. The full list
  is in the appendix.
- **Fix:** I rewrite the script in step 2. You run it once the accounts and machines exist.

### B4 · The kills stat records far too few kills in the default game type

- **What happens:** winning a free-for-all with 10 frags adds 1 to `ffa_kills` against one
  opponent and 3 in a four-player match. A wrong match stays wrong: a match's record is written
  once (`src/core/progression/score-statistics.js:235`) and the Steam stat is only ever raised
  (`electron/steam-native-client.js:183`).
- **Why:** the cap is "opponents × rounds" (`src/core/game-modes/online-steam-stats.js:26-27`).
  The round count only rises on a round restart (`src/core/game-modes/OnlineMultiplayerMode.js:741,1528`),
  and a free-for-all has no rounds (`src/core/multiplayer/frag-tracker.js:298`). The default goal is
  10 frags, settable up to 100 (`src/core/multiplayer/ffa-p2p-game-state.js:171-173`,
  `src/ui/match-config-modal.js:185`).
- **Proof:** Ran. The real frag tracker played a two-player free-for-all to 10; its result went
  through the real stats writer and came out as `kills: 1`. Four players gave 3.
- **Why the suite is green:** the only test pins the old rule
  (`tests/unit/online-peer-input-limits.test.js:121-130`). No test feeds a free-for-all result to
  the stats writer.
- **Fix:** decision D10. It must land before any licensed account plays a match on the real App ID.

## Should fix

### S1 · Two builds that cannot play together can still meet in a lobby

- **What happens today:** no public build exists, so nobody is affected. After the first patch that
  changes the wire or the versus rules, a player still running the old build gets "You were removed
  from the match by the host." If the patch changes only rules, both builds are admitted and play on
  out of sync.
- **Why:** the 22 November change moved the snapshot body to version 8
  (`src/core/network/binary-encoding.js:18`) and changed the resync sidecar's fields, but the
  protocol versions that the handshake compares did not move
  (`src/core/network/protocol-version.js:3-4`, `src/core/multiplayer/ffa/resync-sidecar.js:17`).
  ADR-0013 lines 42 to 44 require a new protocol version for that. The lobby list never reads the
  version a host publishes (`electron/steam-integration.js:1162-1176`). An unknown kick reason maps
  to "kicked" (`src/core/game-modes/OnlineMultiplayerMode.js:896-898`), so the update messages that
  already exist (`src/ui/online-session-exit.js:6-7`) are never shown.
- **Proof:** Ran. The network modules from the 18 November merge and today's both offer versions
  1.0.0 to 2.0.0 and accept each other's hello. Their decoders then throw "expected 8, got 7" and
  the reverse. A join with that decoder ends in `resync_retry_exhausted` and a kick. A rules-only
  mismatch is Read.
- **No test** fails when the body format or the sidecar changes without a protocol change.
- **Fix:** decision D11.

### S2 · The `wireV2` flag expires on 31 December and turns the suite red on 1 January

- **Why:** `src/core/flags.js:140` and `tests/unit/flag-registry.test.js:39`. (Read; the date was
  not simulated.) The session that would graduate it needs two machines on real Steam.
- **State of the flag:** off by default. Its code was kept in step with the 22 November change and
  its tests pass. (Test) ADR-0013 still says "binary-v7" in three places.
- **Fix:** decision D12.

### S3 · The lobby list does not say what kind of room it is

- **What happens:** a browsing player sees name, players, win condition and status. They cannot
  tell a free-for-all from a Survivor room, or a Blind room from a plain one, before joining. The
  host publishes no key for game type or attack style (`src/core/steam/steam-networking.js:396-412`).
- **Wrong label:** the Drop in button says "you play from the next round"
  (`src/ui/lobby-browser.js:348`). In a free-for-all you join at a key press.
- **In the waiting room:** guests see the game type but not the attack style, smallest attacking
  clear, cancelling or attack scaling (`src/ui/lobby-waiting-room.js:78-103`). A guest in a Blind
  room finds out in play.
- **Proof:** Read; the waiting room's game type line is Test (`tests/unit/online-game-type.test.js`).
- **Fix:** publish game type and attack style as lobby keys, show them on the row and in the
  waiting room, and word the Drop in label by game type. This shares its lobby-data work with D11.

### S4 · Private rooms: the game tells the host to share an ID that D6 says should not work

- **What happens:** the create sheet says "Invite only" (`src/ui/match-config-modal.js:66`). The
  waiting room shows the lobby ID with "Share it so friends can join." for every room type
  (`src/ui/lobby-waiting-room.js:107-113`), and three code comments say a private room is joined
  "by invite or by the lobby ID" (`src/core/multiplayer/lobby-type.js:7-8`).
- **What is unknown:** the game has no admission check of its own. Valve's page says a private
  lobby is joined from an invite, but does not say a bare ID is refused
  ([ISteamMatchmaking](https://partner.steamgames.com/doc/api/isteammatchmaking)). T2's "uninvited
  ID entry cannot grant entry" rests on that alone. (Steam)
- **Fix:** decision D13.

### S5 · When the link breaks in a two-player match, both players win

- **What happens:** each side sees the other go silent, takes over as host and awards itself the
  match, with the same match ID. Each then records a win for it. A player whose own internet dies
  also sees a victory. This is older than the versus change and holds in both game types.
- **Proof:** Ran, with the link cut both ways and both games running: winner H0 on one side, winner
  P1 on the other, identical record ID, unchanged after the link returned.
- **Fix:** decision D14.

### S6 · A host change during a match is silent

- **What happens:** the match carries on, respawn and hot potato included (Test and Ran), but no
  player is told the host changed. `HOST_MIGRATED` is emitted
  (`src/core/network/host-migration.js:317`) and nothing in `src/` listens. The plan asked for a
  "new host" status.
- **Also lost in a host change:** who attacked whom last. It lives only in the old host's memory
  (`src/core/network/snapshot-contract.js:98`), so a knock-out right after the change gives nobody
  the frag. (Ran)
- **Fix:** a short toast naming the new host. Carrying the last attacker in the resync is small;
  I would do it with D11's sidecar change so the format moves once.

### S7 · Orb time boards have no rules freeze

- **What happens:** the eight rival orbs (5, 10, 18, 26, 34, 48, 56, 60) all have time boards.
  Their bot tuning changed after the board generation was set to v7
  (`src/core/odyssey/data/level-design-2026-11.js`, three commits since `d73c20b3f`), and the bot
  code they use (`src/core/ai`, through `src/core/odyssey/OdysseyBotMatch.js:7-8`) changed in 43
  commits since. No board generation moved and no test would notice.
  Before launch only your own machines hold such times. After launch the same change would mix two
  difficulties on one public board.
- **Cost of a late fix:** all 58 orb boards share one prefix
  (`src/core/steam/steam-catalogue.js:9,43`). A new generation means 58 new boards on the partner
  site and every player's orb times starting over.
- **Proof:** Read. I did not measure whether each rival's pace actually moved.
- **Fix:** decision D15.

### S8 · The Linux package has never been run, and CI never packages the desktop app

- **What happens:** the Linux package stages correctly from Windows and contains the right
  binaries (Ran). Its native verifier must run on Linux and exits 1 here because it looks for the
  host platform's addon. `.github/workflows/` builds only the web version.
- **Fix:** a CI job that packages both targets and runs `steam:qa -- verify-native` on Ubuntu. I
  can write it, but my GitHub token cannot push workflow files, so you would push that one file. It
  proves the addon loads on Linux; a launch from Steam still needs your Linux machine or Deck.

### S9 · This checkout cannot run the Steam code

- **What happens:** the main checkout has `steamworks.js` 0.4.0 installed and no `koffi`. The
  lockfile wants 0.12.2 and 3.3.5. `npm run dev:electron` from this folder loads the old binding.
  Clean installs and CI are fine. (Ran)
- **Fix:** copy the three package folders from a worktree that has them, as was done for three
  r187. No `npm ci` here. Other sessions use this folder, so I will only do it with your OK.

### S10 · Hidden cells make match traffic about thirty times larger

- **What happens:** on a tick where cells are hidden, the host's update to each player grows from
  65 bytes to about 1.8 KB with eight players (467 bytes with two). Everything stays far below the
  64 KB packet cap; the largest full snapshot is 10.4 KB. (Ran)
- **What is unknown:** these updates are sent unreliably. Whether 2 to 3.5 KB unreliable messages
  arrive well through Valve's relays is not known. (Steam)
- **Fix:** a Blind and Full blind case in T4, with the network counters recorded. No code change
  until that shows a problem.

### S11 · The privacy page's date is stale

- `PRIVACY_POLICY.md:123` says 12 November. The 18 November merge added score sharing,
  achievements and recovery copies without changing it. The text itself still covers the new versus
  modes. (Read)
- **Fix:** set the date when the contact address goes in.

## Polish

| ID | What | Where | Proof |
|---|---|---|---|
| P1 | Other players' tile for someone who joins or returns mid-match reads "Next round" in a free-for-all. The state underneath is right. | `src/ui/opponent-watch-manager.js:1936-1938` | Read |
| P2 | The player count in the "in a match" rich presence line is set once at match start and not refreshed on a drop-in or a leave. | `src/core/game-modes/OnlineMultiplayerMode.js:699-702` | Read |
| P3 | The Linux package ships Electron's default icon. | `docs/desktop-icons.md:46` | Read |
| P4 | A drawn Survivor ending still records a win for whoever sorts first. | `src/core/multiplayer/frag-tracker.js:305` | Read |
| P5 | A player who leaves records no match, while the one who stayed records a win. A drop-in seconds before the end records a full match. | `src/core/game-modes/online-steam-stats.js:44-49` | Read |
| P6 | `matchStatsForSteam` computes a score and level that are never saved, and its comment about one knock-out per round is no longer true. | `src/core/game-modes/online-steam-stats.js:26-30` | Read |
| P7 | The handover's bare `electron-builder` command gives an `.exe` with Electron's icon. `npm run build:win` sets the real one. | `scripts/build-win.mjs` | Ran |
| P8 | The plan cites `electron/steam-app-id.js:18`; the constant is on line 21. | plan line 125 | Read |

## What still holds

- **Boards:** the manifest gives 64 boards with the names, sort and display the plan lists, orbs 39
  and 58 excluded. (Ran)
- **Stats:** each match counts once per player, a repeat delivery adds nothing, and the match ID is
  stable across respawn, a return inside the held seat and a host change. (Ran, Read)
- **Versus and Steam:** no online teams, and no achievement or board depends on versus. (Read)
- **Disconnects:** 5 seconds of silence means departed, the seat is held 10 seconds with three or
  more players, a returner keeps frags and score, and a waiting-room host leaving closes the room.
  (Test, Ran)
- **Presence:** all 13 rich presence tokens are still truthful. No new upload is needed. (Test)
- **Relay-only:** nothing under `electron/` changed since the Steam merge. (Ran)
- **Privacy and store text:** both agree with the new default. (Read)
- **Controller:** every new option on the create sheet is reachable by pad, by code. Hardware is
  unproven. (Read)

## Decisions for you

The plan's D1 to D8 stand. These are new. My recommendation is first in each.

**D9 · Windows signing (B2).**
- *Recommended:* sign the `.exe` and both addons before the first upload. Cost: an annual fee and
  an identity check in your name or your company's, plus about half a day to wire it into
  `build:win`. I have not priced it or checked what a Swedish sole trader or AB can get.
- *Alternative:* ship unsigned. Cost: players with Smart App Control on may be unable to start the
  game, and this laptop may be unable to run the candidate.

**D10 · What bounds kills in a free-for-all (B4).**
- *Recommended:* cap at the frags goal when the goal is frags, otherwise at one knock-out per ten
  seconds played. Survivor keeps opponents × rounds. Cost: about an hour with tests.
- *Alternative:* no cap. Cost: a modified host could add any number to a guest's lifetime kills.
- *Later, if kills ever feed a board:* each client counts its own frags from the knock-outs it sees.

**D11 · Builds that cannot play together (S1).**
- *Recommended:* one match-compatibility number covering the snapshot body, the resync sidecar and
  the versus rules. The host publishes it. The list shows a room from another version as "Needs
  update" with Join off, the handshake refuses with the update messages that already exist, and a
  test fails when the format or rules change without a new number. Cost: about a day. After that,
  every wire or rules change bumps one number.
- *Alternative:* hide other-version rooms. Cost: a player cannot see why a friend's room is missing.
- *Alternative:* leave it. Cost: after the first patch, mixed builds get a kick that blames the
  host, or play on out of sync.

**D12 · The `wireV2` flag (S2).**
- *Recommended:* keep it off, launch on protocol 1, and re-date it to 31 March 2027 with an
  ADR-0013 amendment that names T4's soak as the bar. Cost: minutes.
- *Alternative:* remove protocol 2. Cost: the lighter frames go, and they matter more after S10.
- *Not recommended:* turn it on now. It has never run on real Steam.

**D13 · Private rooms (S4). This touches your D6, "true invite-only private rooms".**
- *Recommended:* keep D6. In a private room show the Invite button and hide the lobby ID and its
  "Share it" hint. T2 then shows whether Steam refuses a bare ID. If it does not, I come back with a
  host-side check. Cost: under an hour now.
- *Alternative:* make the ID a room code and say so: "Not listed. Join by invite or with the lobby
  ID." Cost: wording only, and D6 changes.

**D14 · A broken link in a two-player match (S5).**
- *Recommended:* the side whose own Steam connection is down sees "Connection lost" and records no
  win. If both are still online, both keep their result, because without a server neither can know
  who dropped. Cost: a few hours with tests; T4 gets a case for it.
- *Alternative:* leave it. Cost: each side counts a win. It is a personal stat, not a board.

**D15 · A rules freeze for orb time boards (S7).**
- *Recommended:* a test that fingerprints each orb (goal, layout, rival tuning, bot version) and
  fails when an orb changes without a new board for that orb. Let one orb carry its own generation,
  so a retune costs one new board. Freeze for good on App ID day, before the 58 boards are entered.
  Cost: about half a day, and after launch a retuned orb's board starts over.
- *Alternative:* keep one shared generation. Cost: any retune after launch means 58 new boards and
  every player's orb times starting over.
- *Alternative:* take the eight rival orbs off the time boards, as the two survival orbs are. Cost:
  50 orb boards, and your D2 changes.

## What I would do after approval, in order

1. The kills cap with a free-for-all test (D10).
2. The compatibility number, the lobby keys for game type and attack style, the list and waiting
   room labels, and the last attacker in the resync, as one change to the lobby data and sidecar
   (D11, S3, S6).
3. The `wireV2` date and the ADR-0013 text (D12).
4. Private room wording, the new-host toast and the broken-link rule (D13, S6, D14).
5. The orb fingerprint test (D15).
6. The docs: T1 to T12 and the three-account script rewritten for both game types, the fault-control
   table replaced with the commands that exist, a dated section in the handover, the privacy date.
7. With your OK each: the package copy into the main checkout (S9) and the CI packaging job (S8).
8. Signing in `build:win` once D9 gives an identity.

All of it on this branch (`audit/steam-online-drift`) in this worktree, with tests. No merge until
you say "sync with main and merge".

## Verification record

Run on 26 November in the worktree `../serenity-blocks-steam-drift` at `e31421d3b`, Node 24.20.0,
with dependencies installed from the same lockfile.

| Check | Result |
|---|---|
| CI on `e31421d3b` | Test, build and deploy jobs all passed. The test job runs the full suite, typecheck, lint and the release gate on Ubuntu. |
| `npm run typecheck` | Exit 0. |
| `npm run check:release-gates` | Exit 0 with the two expected warnings. With `SERENITY_RELEASE=1`: exit 1, naming the App ID and the contact. |
| `npm run steam:qa -- manifest` | 64 boards, 9 stats, 4 achievements. Names match the plan. |
| `npm run steam:qa -- verify-native` | "44 client and 11 relay symbols resolved, addon loaded", from the dependency and from the staged Windows package. |
| `npm run steam:qa -- size 100000` | 48,305,065 bytes, 18,803,799 left of 64 MiB. Identical to 18 November. |
| `npm run steam:qa-renderer` | All four scenarios passed in real Electron. |
| `npm run build` | Built in 68 s, boot closure OK. |
| `electron-builder --win --linux --x64 --dir` | Both unpacked packages staged. After-pack content and name checks passed, zero `steam_appid.txt`. |
| Signatures on the staged Windows package | `.exe` and both addons `NotSigned`; Valve's DLL `Valid`. Smart App Control state: on. |
| Focused unit tests | Three runs, one per area: 4 files (65 tests), 15 files (203 tests) and 4 files (46 tests). All passed. Two files appear in two of the runs. |
| Probes of the real modules | Free-for-all result through the stats writer; old and new network modules side by side; snapshot and delta sizes; a silent peer, a return inside the seat hold, a cut link and a host change with hot potato. |

## Not checked

- Anything on real Steam: stats and boards, Cloud, invites, the relay, large unreliable updates,
  what Steam does with a bare ID to a private lobby, the lobby owner after a host change.
- The Linux package running, and anything on a Steam Deck.
- The full suite locally. CI ran it on this commit.
- Whether each rival orb's pace actually moved with the bot changes.
- What a killed client records for the match it left, and the Survivor disconnect path end to end.
- Controller behaviour on hardware.

## Appendix: lines the versus change made wrong

| Where | What it says | What is true now |
|---|---|---|
| Handover line 12 | "In a duel a disconnect forfeits the round." | It ends the match and the other player wins it. The default type has no rounds. |
| Plan T4 (line 156) | "On shipping defaults … Play 10 min" | Shipping defaults end at 10 frags. Create with Endless or a 10-minute goal, once per game type. |
| Plan T4 | "Duel departure awards one result to the survivor." | True only when the leaver's game stops. A cut link gives both a win (S5). |
| Plan T11 (line 163) | "one win for the winner and frags within bounds" | Write down the frags on the results sheet and expect `ffa_kills` to rise by exactly that. |
| Plan T11 | "Finish a match and rematch … one match per player" | A rematch is a second match. Expect two. |
| Plan line 166 | "KO/next-round status" for a returning player | Free-for-all: out, then a key press, with frags and score kept. After the seat expires: a new drop-in with zero frags. |
| Plan line 105 | "spectating or next-round admission" | Next round in Survivor, a key press in a free-for-all. |
| Plan lines 83 to 84 | `ffa_kills`: "Bounded frags from those matches." | Restate once D10 sets the bound. |
| Plan lines 170 to 176 | Menu options such as "Fail next relay open" | They do not exist. The real tools are `SERENITY_QA_FAULT` (`relay-open`, `upload-ack`, `stats-ack`, `cloud-write`) and `steam:qa -- backup / truncate / future / restore`. No tool seeds an eight-day-old pending score. |
| Two-machine A | "Play a real 10-minute match" | Name the win condition and the game type. |
| Two-machine C | Kill the host, "match continues" | With two machines one player is left and the match is over. Needs three. |
| Two-machine D | Rejoin "within ~30 s", "no stuck awaitingSpawn" | The seat is held 10 s after 5 s of silence. In a free-for-all, waiting for a key is the correct state. Needs three players. |
| Two-machine F | Drop-in "spawns cleanly on the next round" | At a key press in a free-for-all. |
| Waiting room help text | "A disconnect forfeits a duel." | Still true. No change. |

**Cases to add because the mechanic is new:**

1. Game type chosen at creation, seen by the guest in the waiting room and in the match.
2. Knock-out and respawn across the real relay, with totals kept.
3. The frags goal ending the match once on both machines, with one results sheet.
4. A drop-in from the public list into a running free-for-all.
5. One Survivor match, so rounds and the round banner stay covered.
6. Hot potato: the holder chip, a pass at the target, the holder disconnecting.
7. Blind and Full blind: the same cells hidden on both screens, through a resync and a host change.
8. Smallest attacking clear set to 3: a double sends nothing.
9. Two different builds meeting in a lobby.
10. On the Deck: coming back from a knock-out with the pad only. The card says "key".
