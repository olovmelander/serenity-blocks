# Defuse wireV2 first, then harden for Steam

Only one of the ten owner decisions left by the 2026-10-13 audit has a hard date, so settle it first. The `wireV2` flag's CI time bomb turns every push, pull request and GitHub Pages deploy red at **2026-11-01 00:00 UTC**. Protocol 2 should therefore become the host default by **30 October**, after one recorded two-machine Steam session between 22 and 28 October. The same session should verify a new main-process filter that admits only lobby members to P2P. The time bomb itself should become a warning plus a release gate.

The other nine decisions are less urgent, but almost all are cheapest right now. No outside tester yet has a save, a score, a key binding or a copy of the code. So the `app://` origin move, a single pre-launch "generation 3" of the rules with fresh leaderboard names, the new key defaults and an all-rights-reserved licence cost almost nothing before the first external build, and real effort after it. The recommended choices:

- **Launch:** ship under the real AppID, call `restartAppIfNecessary` first, and remove the 480 fallback and `steam_appid.txt`.
- **Steam binding:** replace the frozen steamworks.js 0.4.0 with an exactly pinned, self-mirrored `@pipelab/steamworks.js` 0.12.2.
- **P2P:** filter to lobby members now, and move to relayed ISteamNetworkingMessages before public lobbies.
- **Electron:** jump from end-of-life 38.8.6 to an exact 44.7.1 pin, and add a meta CSP, deny-by-default permissions, IPC sender checks, fuses and `app://`.
- **Rules:** bundle the T/J/L kick, lock-reset and shared-garbage fixes behind a rules registry.
- **Keys:** move Player 1's flip key from A to X and Player 2's hard drop from Shift to F.
- **VSync:** replace the inert toggle with an FPS limit.
- **Developer surfaces:** split release and diagnostics builds at build time.
- **Distribution:** stop publishing the full game on Pages, and take the repo private before announcement.

Two inputs that only the owner can supply gate most of this work: the real Steam AppID, and a booked session with two Windows machines and two Steam accounts. A lawyer still has to answer four questions: whether the bare `"license": "MIT"` already granted rights, how much protection AI-authored material gets, whether the name is clear, and whether the store art passes the Tetris total-look review.

## One hard date, two owner inputs and the first tester build set the order

Research is current as of 2026-10-13, against repo HEAD `3611f9b` on the audit follow-up branch `ccr-3487099f-uml9x6`. The audit's three NET fixes landed earlier that day; the only commit after them is an unrelated score-display change. Two later commits on the same branch add renderer crash and hang recovery (`9e9d086`) and the quit-time save flush (`1fd64b4`); Decision 5 reflects them.

| # | Decision | Recommended choice | Deadline |
|---|---|---|---|
| 1 | `wireV2` | Graduate. Protocol 2 becomes the host default after one recorded two-machine session, v1 stays as an undated rollback, and the time bomb becomes a warning, a scheduled issue and a release gate | Prep by 22 Oct; session 22–28 Oct; PR by 30 Oct; CI fails from 1 Nov 00:00 UTC |
| 2 | AppID and launch | A real AppID constant, `restartAppIfNecessary` first, no 480 fallback, no `steam_appid.txt` in any build, an unpacked-directory depot, no DRM wrapper, Proton for Deck | Code as soon as the AppID exists; a real-AppID two-machine run before release |
| 3 | Steam binding | `@pipelab/steamworks.js@0.12.2` under the `steamworks.js` alias, pinned exactly, mirrored and rebuilt in the owner's CI; `steamworks-ffi-node` as the fallback | ADR in weeks 2–3; packaged spike once the AppID exists; build-out in weeks 4–8 |
| 4 | P2P filtering | Stage 1 now: a main-process member and ban allowlist on requests, sends and every packet, plus a spectator cap and honest lobby types. Stage 2: Messages over SDR, with relay forced for non-friends | Stage 1 before the session; Stage 2 before Public lobbies go live |
| 5 | Electron and hardening | Exact pin 44.7.1, an advisory gate, a meta CSP, deny-by-default permissions, IPC sender checks, fuses, `app://`, crash reporting (crash, hang and quit handling landed 13 Oct) | Start now, merged by about 2 Nov; `app://` before any tester build; 45.x around December |
| 6 | Rules | A registry that stamps `rulesId` and `rulesHash` everywhere, then one pre-launch generation 3: kicks, lock reset and one garbage router | Weeks 4–8, before leaderboards are created |
| 7 | Key defaults | Bind by `KeyboardEvent.code`; P1 flip A→X; P2 hard drop Shift→F; migrate untouched defaults only; block local Start on conflicts | This week |
| 8 | VSync | Remove the toggle and add an FPS limit in the render loop | Before launch (audit: weeks 4–8) |
| 9 | Developer surfaces | A build-time release/diagnostics split, `devTools:false` in release, diagnostics on a password-protected `qa` branch | Weeks 2–3; before any public build |
| 10 | Licence and distribution | All rights reserved now; stop the full-game Pages deploy; a private repo plus a public landing repo; notices, a credits screen, AI disclosure and a privacy policy; counsel review | Licence in the next commit; visibility before announcement; Steam items before review |

The audit's sequencing already groups the work by week ([audit Part 7](REPOSITORY_AUDIT_2026-10-13.md)):

- **This week:** the `wireV2` decision, the P2P filter, the AppID code and the input binding defaults.
- **Weeks 2–3:** Electron 44 with the CSP, fuses and gated developer surfaces.
- **Weeks 4–8:** the rules registry, followed by the rule fixes.

The research supports that order with three refinements:

1. **The two-machine session is the scarcest resource.** Have everything it can verify ready by about 22 October rather than spreading it over several sittings: the protocol-2 soak, the Stage-1 filter, a lobby round-trip on the new Electron, and ideally the real AppID.
2. **Nothing that isn't protocol-specific may block `wireV2`.** If Electron 44 isn't green on the GPU machine by about 21 October, or the AppID doesn't exist yet, run the session on the current build under Spacewar 480. The repo's checklist accepts 480 for drills and requires a real-AppID run before release ([docs/TWO_MACHINE_STEAM_VALIDATION.md](TWO_MACHINE_STEAM_VALIDATION.md)).
3. **The first build that leaves the owner's machines is the true deadline** for every decision whose cost jumps once someone else holds data:
   - the `app://` origin, because saves are keyed by origin;
   - rules generation 3, because scores and replays get stamped;
   - the key defaults, because migrations start to matter;
   - the licence notice, because copies start to circulate.

## Graduate wireV2 after one recorded session, and close the P2P door in the same sitting

### Decision 1: graduate protocol 2 and keep v1 as an undated rollback

**Graduate it.** Protocol 2 should become the host default before 31 October, with protocol 1 kept negotiable behind an undated rollback switch. Don't re-date it or drop it.

- **Compatibility costs nothing.** No public build exists, and only the host reads the flag. `createLobby` is its single reader, and joiners already offer the whole 1.0.0–2.0.0 range ([src/core/steam/steam-networking.js](../src/core/steam/steam-networking.js); [audit R-01](REPOSITORY_AUDIT_2026-10-13.md)).
- **The benefit is large.** Protocol 2's snapshot deltas are **3–6× smaller**. The protocol-1 delta p95 has grown to about **900–980 bytes**. That is just under the 1,200-byte unreliable cap; above the cap, fix F-5 sends packets reliably, which adds head-of-line blocking. An 8-player host uploads about **2.1–2.3 Mbit/s on v1, against about 0.8 on v2** ([gold-standard audit](ONLINE_MULTIPLAYER_GOLD_STANDARD_AUDIT_2026-10.md); [audit NET-14](REPOSITORY_AUDIT_2026-10-13.md)).
- **Graduation may not skip evidence.** ADR-0013 keeps v2 opt-in "until its two-peer soak and mixed-build validation pass", and it aborts a release soak on increased decode failures or resync requests ([ADR-0013](adr/0013-session-global-v2-snapshot-codec.md)). The standard advice on toggles is to test the configuration that will go live and its fallback ([Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)). Graduating without a session would mean deliberately amending an ADR that CLAUDE.md says should not be re-litigated casually.
- **The repo's handshake is already stronger than the industry norm.** Engines such as Unity Netcode reject mismatched builds with a single protocol version: "Different versions doesn't talk to each other" ([Unity NetworkConfig](https://docs.unity3d.com/Packages/com.unity.netcode.gameobjects@2.0/api/Unity.Netcode.NetworkConfig.html)). The repo has a min/max range, one protocol locked per lobby, and bootstrap messages that keep their JSON-v1 shape so an old client receives "update required".
- **Drop v2 only in one case:** the session finds a v2-specific defect that can't be fixed while v1 stays green.

**Preparation, done by about 22 October:**

1. **Counters.** NET-06 found that several counters the exit criteria need don't exist. Expose:
   - decode failures and malformed-v2-frame rejections;
   - resync requests by reason, and keyframes;
   - two-player delta bytes p95 and reliable messages per second;
   - `P2PSessionConnectFail` counts and main-process oversize refusals.
2. **Mock rehearsal.** Rehearse scenarios A, B, C and F on the mock transport with `wireV2=1`.
3. **One build.** Build one commit for both machines, with `npm run check:release-gates` green.
4. **Impairment tool.** Install clumsy, a Windows packet-impairment tool, on one machine ([clumsy](https://github.com/jagt/clumsy)).
5. **Run mode.** Run unpackaged `npm run dev:electron` builds, or the diagnostics build if Decision 9 has landed, so the host can set the flag.

**The session takes about two to two and a half hours:**

1. **Baseline.** 10 minutes of v1. This doubles as v1's first run on real Steam.
2. **Soak.** At least 60 minutes of v2 play, including:
   - a forced divergence;
   - a host kill;
   - 5 minutes at 5% loss, then 5 minutes at about 100 ms lag with jitter;
   - spectator drop-in, if a third client exists.
3. **Mixed builds.** 10 minutes of mixed builds in both directions, plus the `wireV2=0` rollback.

NET-01, which could leave round one with a stale rule set, is fixed on the follow-up branch (`24c36f0`), so build both machines from a commit that includes it.

**Graduate only if all of these hold:**

- Every join negotiates 2.0.0.
- Decode failures and malformed frames stay at zero.
- Resyncs are no higher than the v1 baseline: zero on a clean link, exactly one in the forced divergence, and at most one per impaired five-minute pass.
- The two-player delta p95 is at or under the 80-byte budget.
- No send fails, and no opponent board stalls for more than a second.
- A host migration converges within 10 seconds and stays on v2.
- Both mixed-build directions and the rollback work.

**The graduation PR is due by 30 October.** It:

- sets `DEFAULT_PROTOCOL_VERSION = PROTOCOL_V2`, as the file's own comment anticipates ([src/core/network/protocol-version.js](../src/core/network/protocol-version.js));
- reads `readFlag('wireV2', true)`;
- replaces the flag's `expiry` with a `graduationBar`: delete the protocol-1 gameplay codec after the first public release plus one clean patch;
- adds a dated ADR-0013 note naming the run's build hashes;
- gates `snapshotDeltaWireBytesP95`, whose 80-byte maximum is currently ungated ([perf-budgets.json](../perf-budgets.json)).

If the session can't happen by about 28 October, re-date the flag once, to no later than **15 December**, with an ADR-0013 note naming the planned run.

**The time bomb needs fixing in the same window, not instead of the decision.** Today the registry test compares the wall-clock UTC date with each flag's `expiry` ([tests/unit/flag-registry.test.js](../tests/unit/flag-registry.test.js)). `pages.yml` chains test, build and deploy on every push and pull request. So at **00:00 UTC on 1 November (01:00 in Stockholm)**, every change and every Pages deploy fails, whatever it touches ([audit CORE-04, R-01](REPOSITORY_AUDIT_2026-10-13.md)). Pete Hodgson's feature-toggle guide describes such bombs as something "some go further" with ([Feature Toggles](https://martinfowler.com/articles/feature-toggles.html)). Unleash, a feature-flag service, marks expired flags "potentially stale" and notifies people without breaking anything ([Unleash](https://docs.getunleash.io/reference/feature-toggles)). This repo already retired a nightly job because its daily red "added no information" ([.github/workflows/gpu-validation.yml](../.github/workflows/gpu-validation.yml)). The replacement has four parts:

1. Read "today" from an injectable `FLAG_REGISTRY_TODAY`.
2. Emit a GitHub `::warning::` from 14 days before expiry.
3. Run a weekly scheduled job, at an off-hour minute, that fails and opens or updates an issue.
4. Make `check:release-gates` and the Windows release build hard-fail on expired flags.

The release-gate backstop matters because GitHub can delay or drop scheduled runs, and disables them in public repositories after 60 days without activity ([GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).

One interaction with Decision 9 needs planning. Once release builds ignore `SERENITY_ENABLE_DIAGNOSTICS`, the localStorage flag can only be set in diagnostics builds. The player-facing rollback then becomes a patch that flips the registry default, tested first on a beta branch ([Steamworks: Branches](https://partner.steamgames.com/doc/store/application/branches)).

### Decision 4: admit only lobby members now, and relay through SDR before public lobbies

**What's wrong today.** The main process accepts every `P2PSessionRequest` from the moment Steam initialises, for the app's whole lifetime, menus and Single Player included. On the legacy API this "reveals the player's IP to anyone who knows their SteamID64" ([audit R-05, NET-02](REPOSITORY_AUDIT_2026-10-13.md); [electron/steam-integration.js](../electron/steam-integration.js)).

Valve's contract is the opposite ([ISteamNetworking](https://partner.steamgames.com/doc/api/ISteamNetworking); [ISteamNetworkingMessages](https://partner.steamgames.com/doc/api/ISteamNetworkingMessages)):

- Accept a session only from someone you expect, such as a user "in a lobby with you".
- Otherwise "just ignore the request"; Steam re-posts it while the sender keeps sending.
- Sending a packet implicitly accepts the session.

Valve also warns that P2P games usually trade public IPs, and that "many consumer Internet connections can be easily overwhelmed by a relatively low volume DoS attack" ([Steam Support](https://help.steampowered.com/en/faqs/view/1433-AD20-F11D-B71E)). The 2022 Dark Souls shutdown shows why untrusted P2P ingress matters: the cause was a remote-code-execution flaw that other players could trigger ([VGC](https://www.videogameschronicle.com/news/the-major-dark-souls-exploit-that-took-servers-offline-has-been-published)).

Three neighbouring defects belong in the same change:

- **Kicks don't stick.** Steam lobbies have no kick API; `LobbyKicked_t` is "Currently unused!" ([ISteamMatchmaking](https://partner.steamgames.com/doc/api/ISteamMatchmaking)). So a kicked peer is re-admitted at once.
- **Spectators are uncapped and take Steam seats** (NET-10).
- **Lobby types are mislabelled.** Both "private" and "friends" lobbies become FriendsOnly, while the UI promises a hidden lobby that can be joined by ID (NET-27).

**Stage 1 lands before the session, on the current binding.**

- **The filter.** Write it as a pure, unit-tested function, `isP2PPeerAllowed({ steamId, inLobby, memberSet, banSet, localId })`. Refresh the member set on create, on join, on every `LobbyChatUpdate`, and at most once per cache miss.
- **Session requests.** Accept a request only from a current member who isn't banned, and only while the local user is in a lobby. Never accept proactively.
- **Outbound sends.** Refuse sends to non-members, because a send opens the session.
- **Inbound packets.** Drop packets from non-members in `steam:readP2PPacket`, before decoding and before the IPC hop.
- **Outside a lobby.** Accept nothing and drain everything.
- **The join race needs no timer.** Valve re-posts the request, and the joiner already retries HELLO 12 times at 700 ms intervals before giving up after about 10 seconds (commit `69d517b`).
- **Kicks.** A kick writes to a per-lobby ban set, which:
  - main enforces;
  - the host answers with `JOIN_REJECTED` and the reason `kicked`;
  - is replicated through the roster broadcast and an owner-written lobby-data key, so a migrated host keeps it.

  A member who ignores `PLAYER_KICKED` still holds a Steam seat until it leaves. That limit has to be accepted.
- **Spectators.**
  - Cap them at HELLO, with a `spectators_full` rejection. Four is a reasonable starting cap.
  - Create the Steam lobby with `maxPlayers + spectatorCap` seats, because steamworks.js can't change the limit later.
  - Publish the player and watcher counts as lobby data.
  - Make `LOBBY_PLAYER_JOINED` host-to-peer only (NET-25).
- **Lobby types.**
  - Map public to Public (2) and friends to FriendsOnly (1).
  - Ship "Invite only" as Private (0) only once invites work. A Private lobby can be joined only by invitation, so until then relabel it "Friends only".
  - Call `setJoinable(false)` when a lobby is full, spectators included.

**Stage 2 is the only fix for exposure to lobby members themselves.** The legacy API tries a direct connection first, so in a public lobby any stranger who joins can learn every member's IP. ISteamNetworkingMessages and ISteamNetworkingSockets relay through Steam Datagram Relay (SDR), which keeps IP addresses hidden and checks that "all incoming traffic is authenticated, encrypted, and rate-limited" ([Steam Datagram Relay](https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay)). The Sockets reference says the relay "prevents IP addresses from being revealed" ([ISteamNetworkingSockets](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets)). A game may also force the relay ([Steam Support](https://help.steampowered.com/en/faqs/view/1433-AD20-F11D-B71E)).

Messages fits this codebase better than Sockets. It keeps per-peer addressing and the same "ignore to decline" contract, so the Stage-1 filter ports unchanged. Sockets, by contrast, requires every incoming connection to be accepted or closed "within a second or two" ([ISteamNetworkingSockets](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets)).

The Rust layer that steamworks.js pins already wraps Messages, with an accept/reject session callback ([networking_messages.rs @fbb7963](https://github.com/Noxime/steamworks-rs/blob/fbb79635b06b4feea8261e5ca3e8ea3ef42facf9/src/networking_messages.rs)). The port is therefore N-API glue in the binding chosen under Decision 3:

- call `InitRelayNetworkAccess`;
- set `P2P_Transport_ICE_Enable` to relay-only for non-friends, and to the user's own setting for friends ([GameNetworkingSockets types](https://github.com/ValveSoftware/GameNetworkingSockets/blob/master/include/steam/steamnetworkingtypes.h));
- close sessions on leave or kick;
- split control, gameplay and resync traffic across a few channels;
- batch the IPC.

**Launch posture.** Combining the networking and privacy research, my recommendation is to treat Stage 2 as a launch blocker for Public lobbies. If it slips, launch online play with friends-only lobbies, and state in the privacy policy that peers may see a player's IP address.

## Ship as the real AppID through Steam, on a pinned steamworks.js-lineage fork

### Decision 2: real AppID, Steam-first launch, and nothing named 480 in a release

Three problems make the current setup unsafe to ship.

- **The resolver can silently pick 480.** It falls back from `STEAM_APP_ID` to `steam_appid.txt` to 480 ([electron/steam-integration.js](../electron/steam-integration.js)). steamworks-rs's `init_app` writes the ID into the `SteamAppId` and `SteamGameId` environment variables before initialising, so an explicit 480 overrides whatever Steam passed in ([steamworks crate](https://crates.io/crates/steamworks); [audit ELEC-01](REPOSITORY_AUDIT_2026-10-13.md)).
- **The test-ID file ships.** The repo-root `steam_appid.txt` still holds `480`, and `extraFiles` copies it into every build; a second copy ships as `electron/steam_appid.txt`. The `afterPack` hook strips the first copy and fails any release that contains 480. But Valve's rule is simply "You should not ship this with your builds" ([Steamworks API overview](https://partner.steamgames.com/doc/sdk/api); [scripts/afterPack.cjs](../scripts/afterPack.cjs); [audit ELEC-18](REPOSITORY_AUDIT_2026-10-13.md)).
- **Steam initialises too late for the overlay.** Steam is initialised lazily, after `createWindow`. The overlay hooks only games launched from Steam, and it needs `SteamAPI_Init` to run before the graphics device exists ([Steam Overlay](https://partner.steamgames.com/doc/features/overlay); [electron/main.js](../electron/main.js)).

**Recommended launch path:**

1. **Restart through Steam.** Add an `electron/steam-app-id.js` constant. At the top of `main.js`, in packaged Steam-channel builds, call `restartAppIfNecessary(APP_ID)` before `app.requestSingleInstanceLock()` and `whenReady`, and exit if it returns true. A game started from Explorer or an old shortcut then relaunches through Steam, with playtime, overlay and Cloud attached ([steam_api](https://partner.steamgames.com/doc/api/steam_api)).
2. **Initialise with the real ID only.** Call `init(APP_ID)`. On failure, go offline with a log entry; never fall back to 480.
3. **Fix the files.**
   - Put the real ID in the developer-only repo-root `steam_appid.txt`. That also makes the restart check return false locally.
   - Remove the `extraFiles` entry and delete `electron/steam_appid.txt`.
   - Add release gates that fail on a `\b480\b` match, or on any `steam_appid.txt` in the packaged output.
4. **Build the depot.** Use electron-builder's `--win dir` output as the SteamPipe content root. Check in `app_build` and `depot_build` scripts that exclude `steam_appid.txt` and PDBs. Set the launch option to `Serenity Blocks.exe`, and test on a private beta branch ([Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading)).
5. **Skip the SteamStub DRM wrapper.** Valve says it "is not an anti-piracy solution", that it can trigger antivirus false positives, and that `RestartAppIfNecessary` already covers its launch-through-Steam role ([Steam DRM](https://partner.steamgames.com/doc/features/drm)).
6. **Move Steam initialisation ahead of `createWindow`.** This is a precondition for the overlay experiment under Decision 5.
7. **Channels.**
   - Keep NSIS only if a non-Steam channel is genuinely planned, because a downloaded installer then needs code signing (Decision 5).
   - For Steam Deck, ship the Windows build under Proton. Valve tests a native Linux build first if one exists and submits whichever result is more favourable ([Steam Deck compatibility](https://partner.steamgames.com/doc/steamdeck/compat)). But the repo's Linux build can't reach Steam at all, because its `linux64` natives are stripped (ELEC-14), and WebGPU on Linux Chromium is still described as experimental ([gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).

**Timing.** The audit sizes this as small and lists it for this week, conditional on the owner supplying the ID. That same ID also unblocks the binding spike, the partner-site leaderboards and the `qa` branch, which makes it the most valuable thing the owner can obtain this month.

### Decision 3: adopt the pipelab fork, pinned and mirrored, with ffi-node as the fallback

**Keeping steamworks.js 0.4.0 isn't a real option.**

- Its last release was **2024-08-06** ([npm registry](https://registry.npmjs.org/steamworks.js)).
- It has no leaderboards, no friends list and no NetworkingMessages. It exposes only ten callbacks, and neither `GameOverlayActivated` nor `UserStatsStored` is among them ([steamworks.js](https://www.npmjs.com/package/steamworks.js)).
- Typing `electron/` against its own types finds 22 calls to APIs that don't exist. Leaderboards and friends are dead end to end, and achievements are unimplemented ([audit ELEC-11, SCORE-02, SCORE-10](REPOSITORY_AUDIT_2026-10-13.md)).

**A second native addon beside it is also ruled out.** The SDK header forbids mixing manual callback dispatch with `SteamAPI_RunCallbacks` or `CCallResult` ([steamworks-sys 0.13.0 SDK headers](https://crates.io/crates/steamworks-sys/0.13.0)). The earlier ez-steam-api failure was exactly such a clash between header and DLL generations: newer `steam_api64.dll` builds no longer export `SteamAPI_Init` ([audit ELEC-06](REPOSITORY_AUDIT_2026-10-13.md)). The rule for the ADR: one binding, one DLL taken from that binding's package, one init, and one dispatch loop.

**Recommended: install `steamworks.js@npm:@pipelab/steamworks.js@0.12.2`, pinned exactly.**

- It was released 2026-06-02, on Steamworks SDK 1.62.
- It keeps upstream's `matchmaking`, `networking`, `overlay`, `cloud` and `stats` namespaces. The ~1,140-line Steam module ([electron/steam-integration.js](../electron/steam-integration.js)) and the 2,370-line P2P stack ([src/core/steam/steam-networking.js](../src/core/steam/steam-networking.js)) keep their API.
- It adds:
  - leaderboards: find, find-or-create, KeepBest or ForceUpdate uploads with details, and Global, AroundUser and Friends downloads;
  - a friends list;
  - `networking_messages`;
  - the `GameOverlayActivated` callback.
- At about 1,750 downloads a month, it is the most used leaderboard-capable fork in the lineage ([@pipelab/steamworks.js](https://www.npmjs.com/package/@pipelab/steamworks.js)).
- Valve has said that older SDKs keep working ([SDK 1.62 announcement thread](https://steamcommunity.com/groups/steamworks/eventcomments/612031950881886284)), so 1.62 is fine for a 2026 launch.

The alternatives cost more:

- **steamworks-ffi-node** (17,119 downloads a month; claims SDK 1.64) has its own manager API and `RunCallbacks` dispatch. It ships no DLL, needs koffi unpacked from the asar, and offers Sockets rather than Messages ([steamworks-ffi-node](https://github.com/ArtyProf/steamworks-ffi-node)). Adopting it means rewriting the Steam layer and the P2P transport at the same time.
- **steam-bridge** is three months old. It draws the overlay by rendering Electron offscreen into a native D3D11 window, which is a rendering-path rewrite for a WebGPU game ([steam-bridge](https://github.com/jstroh/steam-bridge)).

**Controlling the fork's risks.** The fork has a single maintainer and a young codebase. Mirror its source into the owner's GitHub, and build it once in the owner's CI to prove it is reproducible. Treat that mirror as the place where the Stage-2 networking glue lands, along with any missing lobby setters (`SetLobbyMemberLimit`, `SetLobbyType`, `SetLobbyOwner`). This reconciles the networking research, which says to fork steamworks.js, with the binding research, which says to adopt pipelab: the mirror is the fork. Keep ffi-node as the fallback if the forks fail a packaged spike.

**The spike runs on a private beta branch under the real AppID.** It covers:

- init;
- an achievement plus `stats.store()`;
- leaderboard find, upload and all three download types;
- lobby create and join with P2P;
- Cloud write and read.

Two questions need answers there:

- Is pipelab's `sendMessageToUser(steamId, data)` enough for Stage 2? It shows no channel or send-flag parameter.
- Do stranger names on global boards need `requestUserInformation`? The jdeffner fork has it and pipelab lacks it ([@jdeffner/steamworks.js](https://github.com/JDeffner/steamworks.js)).

**The build-out puts a `LeaderboardService` in the main process:**

- **Config.** A checked-in `steamworks/app-config.json` that a test compares with the code.
- **Uploads.**
  - One serialized upload queue, because Valve allows "10 uploads per 10 minutes" with only one call outstanding ([ISteamUserStats](https://partner.steamgames.com/doc/api/ISteamUserStats)).
  - Uploads only on a personal best.
  - int32 details, capped at 64.
- **Downloads.** 1-based Global ranges; −N..+N for AroundUser.
- **Board settings.**
  - KeepBest boards for scores (Descending) and for Odyssey times (Ascending, in milliseconds).
  - The FFA win rate becomes a ForceUpdate board behind a minimum-match gate, or a plain stat; KeepBest currently pins it at 100% ([audit SCORE-08](REPOSITORY_AUDIT_2026-10-13.md)).
- **Achievements.** Activate, then call `stats.store()` once per result and once at quit, because Valve says store frequency "should be on the order of minutes".
- **No backend for launch.** If cheating appears, the escalation is Trusted boards, which only a server can write through `SetLeaderboardScore` ([Steamworks Leaderboards](https://partner.steamgames.com/doc/features/leaderboards)). Publisher keys never ship in the client.

**Timing.** Until the service lands, hide the leaderboard UI, as the audit suggests. The ADR belongs in weeks 2–3 and the build-out in weeks 4–8 ([audit Part 7](REPOSITORY_AUDIT_2026-10-13.md)).

## Electron 44.7.1, honest frame pacing and a sealed release build

### Decision 5: pin 44.7.1 now and close six unmet checklist items

**Why upgrade now.**

- **End of life.** Electron 38.8.6 left support on **2026-03-10**.
- **Advisories.** The auditor's `npm audit` lists **24 advisories against it, 8 of them high**, and none was fixed on the 38 line. They include:
  - a context-isolation bypass ([GHSA-h7rp-cf8h-j98x](https://github.com/advisories/GHSA-h7rp-cf8h-j98x));
  - windows that escape their opener's sandbox ([GHSA-gr2m-v5gq-v685](https://github.com/advisories/GHSA-gr2m-v5gq-v685));
  - a DevTools handler that executes arbitrary files ([GHSA-f2r8-jv7c-xqmp](https://github.com/advisories/GHSA-f2r8-jv7c-xqmp)).
- **CI is blind to them.** The hard gate is `npm audit --omit=dev`, and Electron is a devDependency ([.github/workflows/pages.yml](../.github/workflows/pages.yml)).
- **The support window.** Electron supports only the latest three stable majors ([Electron timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)) ([Electron schedule](https://releases.electronjs.org/schedule); [releases.json](https://releases.electronjs.org/releases.json)):
  - 42 leaves support on **20 October**, the day 45 goes stable;
  - 43 ends on 5 January 2027;
  - **44.7.1** (Chromium 152, Node 24.21) is supported until **2 March 2027**.

**The breaking changes from 39 to 46 barely touch the repo** ([breaking changes](https://www.electronjs.org/docs/latest/breaking-changes); [breaking-changes.md on main](https://github.com/electron/electron/blob/main/docs/breaking-changes.md)):

- **42:** CI's `node node_modules/electron/install.js` step must become `npx install-electron --no`.
- **44:** ANGLE becomes statically linked and loaded into every process.
- **45:** the sandboxed-preload shims it removes are unused by `preload.cjs`.
- **46:** `capturePage()` scale changes for three QA harnesses.

**Where the shell stands against Electron's 20-item security checklist.** It already does sandboxing, context isolation, navigation and popup denial, and an `openExternal` allowlist. Six items are unmet ([Electron security](https://www.electronjs.org/docs/latest/tutorial/security)):

- 5, a permission handler;
- 7, the CSP;
- 16, a current Electron;
- 17, IPC sender validation;
- 18, avoiding `file://`;
- 19, fuses.

**Recommended order:**

1. **ADR.** Write an ADR modelled on ADR-0018:
   - pin versions exactly;
   - adopt a new major by about its x.2 release;
   - ship nothing within 30 days of end of life;
   - define "done" as a packaged launch on both the iGPU and NVIDIA machines, `capture:themes`, `validate:odyssey:webgpu`, the Phaser board on WebGL2, a two-machine lobby, and an ADR-0016 performance re-baseline.
2. **Bump.** Set `"electron": "44.7.1"`, after backing up `%APPDATA%/Serenity Blocks`. Chromium upgrades profile data in place, so don't assume a rollback to 38 is safe. If something regresses, bisect with the last builds of 40, 42 and 43.
3. **CI.**
   - Make CI parse `npm audit --json` and fail on high Electron advisories.
   - Give Electron its own Dependabot group, listed before `dev-tooling` ([Dependabot options](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)).
   - Warn 45 days before the pinned major's end of life.
4. **CSP.** Inject a `<meta>` CSP at build time, with sha256 hashes of the inline scripts. Electron says a header CSP can't apply to `file://`. The repo's policy is installed only as a header; it still allows `file:` and Google Fonts, and `SERENITY_DISABLE_CSP=1` switches it off in packaged builds ([electron/content-security-policy.js](../electron/content-security-policy.js)).
5. **Permissions.** Add deny-by-default permission handlers; without one, Electron "will automatically approve all permission requests". Allow only `fullscreen`, `screen-wake-lock` and `clipboard-sanitized-write`, and only from the app origin ([session API](https://github.com/electron/electron/blob/v44.7.1/docs/api/session.md)).
6. **IPC.** Wrap every `ipcMain.handle` in a check that the sender is the main window's main frame at the app origin, plus argument schemas. Replace the generic `invoke`, which covers about 60 channels, with named functions.
7. **Fuses.** Turn them on through electron-builder's `electronFuses`, which the installed 26.15.3 applies after `afterPack` and before signing ([electron-builder fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses); [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)):
   - off: `runAsNode`, `enableNodeOptionsEnvironmentVariable` and `enableNodeCliInspectArguments`;
   - on: `enableEmbeddedAsarIntegrityValidation` and `onlyLoadAppFromAsar`, because integrity checking without the second fuse can be bypassed ([ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity));
   - left on until `app://` lands: `grantFileProtocolExtraPrivileges`.

**`app://` must come before any public or tester build.** Web storage is keyed by origin, and it is disabled for non-standard schemes ([protocol API](https://www.electronjs.org/docs/latest/api/protocol)); 35 renderer files use localStorage or IndexedDB (ELEC-02).

- **Register the scheme** as standard, secure, `supportFetchAPI`, `corsEnabled`, `stream` and `codeCache`, and never `bypassCSP`. A missing `corsEnabled` was itself an advisory ([GHSA-v3j7-r9gq-3gjw](https://github.com/advisories/GHSA-v3j7-r9gq-3gjw)).
- **Serve** `app://serenity/` from `dist`, behind a `path.relative` traversal guard.
- **Send the CSP** as a header from the handler.
- **Then turn** `grantFileProtocolExtraPrivileges` off.
- **Migration.** If no outside tester has a save, no migration is needed. If one does, ship a one-time migration release first; that migration design is still unverified.

**Crash and quit resilience: half of it has landed** ([app API](https://github.com/electron/electron/blob/v44.7.1/docs/api/app.md); [crashReporter](https://www.electronjs.org/docs/latest/api/crash-reporter)):

- **Done on 13 Oct (`9e9d086`):** handlers for `render-process-gone` (reload once, then ask), `unresponsive` (Wait or Reload) and `did-fail-load`, a logged `child-process-gone`, and an error box when startup itself fails. Checked under Xvfb with real renderer kills and hangs.
- **Done on 13 Oct (`1fd64b4`):** a flush handshake on quit with a 2-second timeout. The window's close waits for the game's cleanup and its pending Steam Cloud uploads.
- **Done on 13 Oct (`8dac7f3`):** `crashReporter.start({ uploadToServer: false })` before `ready`; minidumps stay in `app.getPath('crashDumps')`.
- **Still to do:** count GPU crashes on `child-process-gone`.
- **Still to do:** handle Windows `session-end`, because `before-quit` "will not be emitted" on Windows shutdown or logoff, and the window-close flush does not run then either.

**The Steam overlay is a separate A/B test with its own ADR.** steamworks.js's recipe appends `in-process-gpu` and `disable-direct-composition`. That removes GPU-process isolation, so a GPU crash or a timeout detection and recovery (TDR) event takes the whole game down. One Electron studio found the overlay was "the primary source of the app crashing randomly" ([drawize postmortem](https://www.drawize.com/blog/tech-how-to-release-html5-game-on-steam)). Ship it behind a setting, pause single-player modes on `GameOverlayActivated`, and keep an in-game invite path.

**Code signing is optional for a Steam-only release.** If the NSIS installer is distributed anywhere else, use Azure Artifact Signing through `win.azureSignOptions`. Don't buy an EV certificate; it no longer buys SmartScreen reputation ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation); [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win)).

**Next major.** Plan 45.x for about December, once it has a few patches; it is supported until 27 April 2027. If launch slips past the end of January 2027, the 30-day rule rules out 44 anyway.

### Decision 8: remove the VSync toggle and add an FPS limit

**Remove it.** The setting is a lie in the UI. The `set-vsync` IPC only stores a boolean and emits an event, and the "Unlimited" and "240 FPS" options can never exceed the display's refresh rate ([electron/main.js](../electron/main.js); [audit ELEC-13, R-22](REPOSITORY_AUDIT_2026-10-13.md)).

It can't be fixed either:

- Chromium's only levers are process-start switches: `disable-gpu-vsync` and `disable-frame-rate-limit`. The second carries a TODO to change it once variable refresh rate is supported ([gl_switches.cc](https://github.com/chromium/chromium/blob/main/ui/gl/gl_switches.cc); [viz switches.cc](https://github.com/chromium/chromium/blob/main/components/viz/common/switches.cc)).
- The WebGPU canvas configuration has no present mode at all ([WebGPU spec](https://www.w3.org/TR/webgpu/)).
- Electron's `setFrameRate` works only for offscreen rendering ([webContents](https://github.com/electron/electron/blob/v44.7.1/docs/api/web-contents.md)).
- Developers report that "electron (and chromium) no longer has a way to switch off vsync" ([GDevelop forum](https://forum.gdevelop.io/t/how-to-disable-vsync/32745)).
- Even where uncapping works, it brings tearing, heat and uneven pacing that the themes' frame pacers don't expect.

**Replace the toggle with an FPS limit:**

- **Options:** Match display (the default), 120, 60 and 30, plus an optional 40 for handheld play. Offer only caps at or below the measured refresh rate.
- **Enforcement:** in the render loop, skip frames until a whole interval has passed. Keep the simulation on its fixed tick.
- **Edge cases:** warn when the refresh rate isn't a multiple of the cap, and make the Odyssey board honour the cap.
- **Cleanup:** delete the `set-vsync` plumbing, and drop `vsyncEnabled` from stored settings.

A 30 fps cap also serves the Deck's requirement of 30 fps at 800p, and saves laptop power ([Steam Deck compatibility](https://partner.steamgames.com/doc/steamdeck/compat)). If an uncapped mode is wanted for benchmarks, it belongs only in diagnostics builds, as a launch flag. The audit places R-22 in weeks 4–8.

### Decision 9: gate developer surfaces at build time, and ship diagnostics on a password-protected branch

**What still ships to players.** The debug keys and the View menu are already limited to dev or diagnostics runs. But three surfaces still reach every player ([electron/main.js](../electron/main.js); [src/ui/settings.js](../src/ui/settings.js)):

- the Settings "Open DevTools" button, whose IPC handlers are registered unconditionally;
- a "URL parameters" tab that advertises cheats such as `unlockAll=1`;
- environment variables that re-open a Chrome DevTools Protocol (CDP) port on `127.0.0.1:9222` and disable the CSP, in packaged builds too.

Runtime switches are fine for logging but wrong for capabilities: anyone can set a Steam launch option, and in online play a host with DevTools could forge stats. Electron's `devTools` web preference defaults to true ([WebPreferences](https://github.com/electron/electron/blob/v44.7.1/docs/api/structures/web-preferences.md)), and no fuse covers `--remote-debugging-port` ([Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)).

**Recommended:**

1. **Two Vite modes.** Build a release mode and `--mode diagnostics`. Put every developer surface behind the statically replaced `import.meta.env.MODE === 'diagnostics'`, which Vite tree-shakes out of other builds ([Vite env and modes](https://vite.dev/guide/env-and-mode)). `DEV` is the wrong switch: it is false in both production builds, so it would strip QA's hooks too.
2. **A channel stamp.** Write `{"channel":"release"|"diagnostics"}` into the asar at package time, where asar integrity protects it. Main enforces it in release:
   - `devTools:false`;
   - no DevTools handlers;
   - both environment escape hatches ignored;
   - an immediate exit if `remote-debugging-port` or `remote-debugging-pipe` is present, a pattern one Electron overlay vendor documents ([Overlayed security](https://docs.overlayed.gg/essentials/security)).
3. **Safe support affordances stay in release.** Keep the ones that run no code: log to file, "Copy diagnostics", safe mode and local crash dumps.
4. **A `qa` branch.** Publish the diagnostics build on a password-protected `qa` Steam branch. QA and support then get the exact Steam-delivered environment ([Steamworks: Branches](https://partner.steamgames.com/doc/store/application/branches)).

**QA keeps working:**

- The Electron harnesses run their own main scripts on the unfused npm binary.
- The packaged release gets a read-only `--serenity-selftest`. It checks the CSP, `eval` blocking, the absence of `require`, that Steam loads, and the fuse settings.
- Deep automation connects over CDP to the diagnostics build, since Playwright's `_electron.launch` needs the inspect fuse that release turns off ([Playwright Electron](https://playwright.dev/docs/api/class-electron)).

The goal is no one-click cheat surface, not anti-cheat; online integrity still rests on host-authoritative validation. The audit puts this in weeks 2–3, and it must land before any public build. The `qa` branch needs the real AppID.

## One pre-launch rules generation fixes kicks, lock resets and garbage while leaderboards are empty

### Decision 6: stand up a rules registry, then ship one generation 3 before launch

**What the audit found:**

- **The rotation bug is an index, not a table.** The repo's 90° kick tables match the standard entry for entry. But T, J and L spawn flat side up, which is standard state 2, while the lookup treats spawn as state 0. Every transition in the standard table is the left-right mirror of the transition two states away, so **all eight T/J/L transitions kick the wrong way** ([TetrisWiki: SRS](https://tetris.wiki/Super_Rotation_System); [audit CORE-02](REPOSITORY_AUDIT_2026-10-13.md)).
- **A non-standard fallback runs after the table.** A ±1/±2 horizontal fallback can arm T-spin detection (CORE-09).
- **The lock-reset counter never refreshes.** Lock delay matches the modern 500 ms and 15 resets, but the counter isn't refreshed when the piece descends. A piece that spends its resets on a ledge, slides off and falls eight rows locks one frame after landing ([src/core/game.js](../src/core/game.js); [audit CORE-08](REPOSITORY_AUDIT_2026-10-13.md)). Modern games refresh the counter when the piece reaches a lower row. Most games after 2007 capped resets, because unlimited resets were seen as game-breaking ([TetrisWiki: Lock delay](https://tetris.wiki/Lock_delay); [TetrisWiki: Infinity](https://tetris.wiki/Infinity)).
- **Garbage has two inconsistent implementations.**
  - **Local:** player-count scaling is computed but never applied. In three-player play, a clear reported as 3 lines delivers 4 to each opponent ([audit INPUT-04](REPOSITORY_AUDIT_2026-10-13.md)).
  - **Online:** the router cancels incoming garbage first, then scales by 1 − 0.1 per extra opponent, with rounding and a 1-line floor. Calling the repo's own `applyAttackScaling` shows that in 8-player online, a double, a triple and a four-line clear each send **one line per opponent** ([src/core/multiplayer/ffa-attack-router.js](../src/core/multiplayer/ffa-attack-router.js)).
- **Rule identity isn't enforced.** `rulesHash` is computed but never compared, sim-affecting flags are read per machine (NET-04), and a line-clear fix already shipped without a version bump (CORE-18).

**Recommended: build the registry first, then ship every outcome-changing fix as one "generation 3" before launch.**

- **This is established practice.** Competitive games stamp every replay and score with a version and the rule variants in force. osu! stores a game-version field and a mods bitmask ([osu! replay format](https://osu.ppy.sh/wiki/en/Client/File_formats/osr_%28file_format%29)). TETR.IO ships rule parameters as data and aligns rule changes with seasons ([TetrisWiki: TETR.IO](https://tetris.wiki/TETR.IO)).
- **The moment is unusually cheap.** Steam leaderboards don't work at all yet (SCORE-02), so splitting a leaderboard costs nothing now and real effort later.
- **The legal side is favourable.** *Tetris Holding v. Xio* held that "the game mechanics and the rules are not entitled to protection", and that the rights holder "has given the rules of its game to the public domain". Liability rested on wholesale copying of the look ([Xio opinion](https://www.govinfo.gov/content/pkg/USCOURTS-njd-3_09-cv-06115/pdf/USCOURTS-njd-3_09-cv-06115-0.pdf)). The repo's legal review already rates standard kicks and lock delay Low ([tetris_legal_review.md](../tetris_legal_review.md)).
- **Adopt standard behaviour, keep presentation different:** no hold, the flat-side-up spawn, fused borderless pieces, and no third-party rule names in the UI.

**Step 1: the registry.**

- **Descriptors.** Add frozen descriptors in `src/core/rules/registry.js`. IDs take the form `family@generation`, for `solo`, `infinity`, `odyssey`, `versus` and the unranked `serenity`. Numbering continues from today's: `@2.0` for the legacy clock, `@2.1` for the fixed clock, and `@3` for the first fix bundle.
- **Contents.** Each descriptor holds every outcome-relevant choice as data: kick set and index, extra kicks, 180° kicks, lock delay, reset limit, refresh rule, lock-out, spawn column, RNG, clock, lock-bonus arithmetic, and the attack table, cancellation, distribution, scaling, rounding and cap. `rulesHash` hashes its canonical JSON.
- **Stamp `{rulesId, rulesHash}` into:**
  - demo headers, normalising legacy demos to `@2.0` or `@2.1`;
  - local records, which also gain a `mode` field (this fixes SCORE-06);
  - leaderboard names, with a generation suffix such as `SoloScore_g3`, following the existing `FFAWinRate_v1`;
  - lobby metadata and HELLO/WELCOME.
- **Flags.** Turn the per-machine sim flags into host-chosen descriptor fields.
- **History.** Keep old rule interpreters forever. Commit golden demos per rules ID that CI replays, so any outcome change on an existing ID fails and forces a new one ([docs/ARCHITECTURAL_REMEDIATION_PLAN.md](ARCHITECTURAL_REMEDIATION_PLAN.md)).
- **Online.**
  - Require an exact `rulesId` and `rulesHash` match, with an explicit "different game version" rejection.
  - Filter the lobby browser by rules ID.
  - Send Steam's build ID and beta-branch name only as diagnostics: the build ID "may change at any time based on backend updates" and is 0 outside Steam ([ISteamApps](https://partner.steamgames.com/doc/api/ISteamApps)).

**Step 2: generation 3.**

- **`solo@3` and `infinity@3`:**
  - the lookup `(rotation + (T/J/L ? 2 : 0)) % 4`, tested against fixtures built from canonical matrices: 7 pieces × 4 orientations × 2 directions, plus a T-spin triple and a wall T-spin double;
  - the fallback removed, or kept only as a named assist for relaxed modes;
  - a per-piece `lowestRow`, which resets the counter and timer whenever the piece reaches a new lowest row;
  - integer-frame lock bonuses (CORE-01);
  - owner calls on lock-out, the spawn column and the PRNG.
- **`versus@3`:** one `routeAttack` for both local and online play.
  - It cancels incoming garbage before scaling.
  - It distributes with a proposed m(k) = 2/(k+1) and a deterministic per-pair remainder carry, or with a round-robin split, chosen in an ADR after bot-versus-bot simulation. That curve gives 100/67/50/40% for one to four opponents. It keeps total pressure under twice the base, and it stops clears from flattening into equal value.
  - An optional per-insert cap.
  - "No scaling" kept as a named variant.
- **`odyssey@3`:**
  - victory evaluated before spawn (ODY-08);
  - singles counted only for single cascades (ODY-17);
  - stars already earned are kept.

**Step 3: later items, one rules ID at a time.**

- an independently designed 180° table (no standard exists);
- T-spin, back-to-back and combo rewards;
- the R-14 command gate.

**Timing.** The audit schedules the registry and the fixes for weeks 4–8, roughly 3 November to 7 December. The hard constraint is that they land before partner-site leaderboards are created, and before any outside build records a score.

### Decision 7: bind by physical key, and move P1's flip to X and P2's hard drop to F

**The defaults collide by design.** Player 2 moves left with `a`, which is also Player 1's flip key, so one tap moves one player and rotates the other (INPUT-01). Other defects ([audit INPUT-01, INPUT-02, INPUT-13](REPOSITORY_AUDIT_2026-10-13.md)):

- **Bindings match `KeyboardEvent.key`.** A key released while Shift is held arrives as `A`, so the move sticks. CapsLock kills `z`, and AZERTY scrambles WASD (INPUT-02).
- **Shift is a hazard.** Player 2's hard drop is Shift, and pressing Shift five times opens Windows' Sticky Keys prompt ([Zapier](https://zapier.com/blog/turn-off-sticky-keys-windows/)).
- **Opposite directions aren't resolved.** Holding ← and then → for 400 ms gives 9 moves left and 4 right (INPUT-13).

The only sourced convention, the Guideline keyboard map, uses the arrows to move, Up to rotate clockwise, Z to rotate counter-clockwise, Down and Space to drop, and C or Shift for hold ([TetrisWiki: Guideline](https://tetris.wiki/Tetris_Guideline)). It gives X no role. Binding C would turn a habitual hold press into a surprise 180° turn.

| Action | Player 1 now | **Player 1 proposed** | Player 2 now | **Player 2 proposed** |
|---|---|---|---|---|
| Move left / right | ArrowLeft / ArrowRight | ArrowLeft / ArrowRight | a / d | KeyA / KeyD |
| Soft drop | ArrowDown | ArrowDown | s | KeyS |
| Hard drop | Space | Space | Shift | **KeyF** (fallback KeyR) |
| Rotate clockwise | ArrowUp | ArrowUp | w | KeyW |
| Rotate counter-clockwise | z | KeyZ | q | KeyQ |
| Rotate 180° | a | **KeyX** | e | KeyE |

**Recommended: bind by physical `KeyboardEvent.code` and adopt the 14-key, modifier-free pair above.** Show key labels from `navigator.keyboard.getLayoutMap()` where it's available ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/getLayoutMap)).

**The migration.** Gate it with a new `bindingsSchemaVersion`, and run it idempotently on every settings load and every Steam Cloud apply. It:

- converts stored `key` strings to codes;
- switches a binding to its new default only if it still equals the old default and the new key is free in every set that is active at the same time;
- never silently changes a customised value;
- shows a one-time toast: "Player 1 rotate-180° moved from A to X";
- writes the result to a new `keyBindingsByCode` field, so an older client reading Cloud data never sees dead controls.

**Conflict detection must span every map that's live at the same time.** The Serenity hotkeys bind Space and F, and whether they are ever live alongside the gameplay keys is unverified. If they are, Player 2's hard drop should be R instead. With two keyboard seats, a conflict shows a "Swap / Choose key" prompt and blocks local Start until each physical key maps to one seat.

**Input handling.**

- **Opposite directions.** Resolve them with last-input priority with reactivation ([HayBox SOCD](https://www.mintlify.com/jonnyhaystack/haybox/customization/socd)), because neutral cancelling stalls a piece during a roll from one direction to the other. No rules version is needed, since demos record accepted commands.
- **Sticks.** Use a radial deadzone with rescaling and press/release hysteresis rather than per-axis thresholds ([INVERSUS analog sticks](https://www.gamedeveloper.com/design/interpreting-analog-sticks-in-inversus); [Unity InputSettings](https://docs.unity.cn/Packages/com.unity.inputsystem@1.6/api/UnityEngine.InputSystem.InputSettings.html)). Start from engage at 0.5 and release at 0.35, with four exclusive sectors and a narrow soft-drop sector; these values are starting points to tune.

**Timing.** These are this-week items in the audit (R-10). These can follow later:

- **Couch seat-zone presets** that move Player 1 entirely to the right side of the keyboard. P1's Z, X and Space still sit in Player 2's half.
- **A key-test panel** that exposes ghosting on keyboards limited to two simultaneous keys ([Deskthority](https://deskthority.net/wiki/Rollover,_blocking_and_ghosting)).
- **Per-seat handling settings.**
- **An opt-in "Up = hard drop" gamepad preset.**

## Reserve all rights today and stop giving the full game away on Pages

### The licence: declare all rights reserved in the next commit

**The repo isn't unlicensed; it's ambiguously MIT.**

- `package.json` declares `"license": "MIT"`, with an empty author and no `private` flag ([package.json](../package.json)).
- There is no LICENSE file; GitHub's API reports `license: null` ([GitHub API](https://api.github.com/repos/olovmelander/serenity-blocks)).
- That `package.json` ships inside every packaged `app.asar`.

npm documents the field as telling people "how they are permitted to use it" ([npm docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)). MIT permits anyone to "use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies" if the notice is kept ([OSI: MIT](https://opensource.org/license/mit)). A recipient could therefore argue they hold an MIT licence to the code. The argument is weaker for the 529 MB of music and for the art, and only a lawyer can weigh it.

**Recommended, in the next commit:**

1. **`package.json`.** Set `"license": "UNLICENSED"` (or `"SEE LICENSE IN LICENSE"`), `"private": true`, and an author.
2. **A LICENSE or COPYRIGHT file** stating "Copyright © 2025–2026 [the owner, or the owner's company]. All rights reserved", covering code and project-original assets. It should include:
   - an effective commit;
   - carve-outs for third-party material;
   - while the repo is public, a line saying that GitHub's terms allow viewing and forking on GitHub but grant nothing more ([GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)).

**The change only works going forward.** When Aseprite moved from GPLv2 to a proprietary licence, a community fork carried on from the last GPL commit ([Wikipedia: Aseprite](https://en.wikipedia.org/wiki/Aseprite)). So don't rewrite history, and let a lawyer word any reference to the earlier value.

**All rights reserved is reversible; a grant isn't.** The code can still be opened after the sales tail, under MIT or Apache-2.0, with the assets and name reserved: the Amnesia model ([GamingOnLinux](https://www.gamingonlinux.com/2020/09/amnesia-the-dark-descent-and-amnesia-a-machine-for-pigs-go-open-source)). Avoid copyleft, which Valve calls "problematic" with the Steamworks SDK ([Steamworks: open source](https://partner.steamgames.com/doc/sdk/uploading/distributing_opensource)).

**Who holds the copyright.** In the shallow clone at `3611f9b`, the owner is the only human author, with 89 of 283 commits; 194 were authored by an AI agent (`git shortlog -sne`). Relicensing therefore needs no one else's consent. But how strong the reserved copyright is, is itself a question for counsel.

### Visibility and Pages: stop shipping the free game, then go private

**The bigger commercial leak is Pages, not the source.** CI deploys the entire game, with every theme and all the music, to GitHub Pages on every push. It does so from a 697 MB `dist`, against Pages' 1 GB limit ([audit R-42, BOOT-14](REPOSITORY_AUDIT_2026-10-13.md)).

A public repo also exposes:

- 1.52 GB of tracked assets;
- design documents that name Tetris products;
- the project's own legal review and evidence folder, which the review itself calls potential "evidence of access" ([tetris_legal_review.md](../tetris_legal_review.md)).

The Tetris rights holder has sent takedowns to GitHub repositories before ([GitHub DMCA notice, 2023](https://github.com/github/dmca/blob/master/2023/02/2023-02-10-tetris.md)), and one would disable this repo along with its CI and Pages pipeline. As recently as September 2026, it publicly disavowed the White House's falling-block game ([Dexerto](https://www.dexerto.com/gaming/white-house-pulls-tetris-clone-from-online-arcade-after-legal-threat-3407022/)).

**Recommended:**

1. **Decide what Pages should host** — a landing page, a deliberately limited demo, or nothing — and stop the full-game deploy.
2. **Stand up the replacement** in a small, separate public repo.
3. **Check any custom-domain DNS.**
4. **Make the main repo private.** On GitHub Free this unpublishes Pages automatically and leaves existing public forks public ([GitHub: repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)). With 0 forks and 0 stars, there will never be a cheaper moment.
5. **Tidy up around the flip.**
   - Move the legal material to a private location shared with counsel.
   - Enable secret scanning and push protection.
   - Require a contributor licence agreement (CLA) before accepting outside contributions.
   - Do any history rewrite or Git LFS migration only after the repo is private.

One unknown remains: the Actions-minute cost of running this CI in a private repo.

### Steam distribution obligations that apply under any licence

**SDK and secrets.** The Steamworks SDK Access Agreement lets a developer distribute only the `redistributable_bin` files, "along with the Licensee Software in object code form" ([SDK Access Agreement](https://partner.steamgames.com/documentation/sdk_access_agreement)). The repo complies today: it tracks no Steam binaries or headers, and it takes the DLL from the npm package at build time. It should never vendor them. Keys, steamcmd credentials and partner-site exports, which Valve marks confidential, never belong in any repo.

**Notices.** Every build must carry:

- the full MIT notices for Phaser, three.js and the Steam binding;
- Apache-2.0 for the Draco decoders, or delete the decoders, since no code reads them;
- the four OFL font licences ([OFL](https://openfontlicense.org));
- Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html`;
- the CC BY 4.0 attributions, with changes noted ([CREDITS.md](../CREDITS.md)).

Today the bundle keeps only `@license` pointer comments. Generate a `THIRD_PARTY_NOTICES.txt` at build time, and fail the release gate if any notice file is missing. Add the in-app Credits & Legal screen that both the audit and the legal review ask for (R-43, TM-5).

**Provenance gaps to close before submission.** Document these, or replace them:

- the **467 ElevenLabs voice lines** under `public/assets/audio/breathwork/voices/` are absent from CREDITS.md ([scripts/generate-tts.js](../scripts/generate-tts.js));
- the intro sounds `begin.ogg` and `warp.ogg` have no recorded origin;
- neither do the Neon District source paintings ([scripts/neon-district/source-art/README.md](../scripts/neon-district/source-art/README.md)).

**Store review requirements.**

- **Content Survey.** It must be completed before review. Its AI section covers pre-generated content that "ships with your game and is consumed by players":
  - the roughly 36 Suno tracks;
  - the ElevenLabs narration;
  - the TRELLIS, TripoSR and UniRig models;
  - any AI-assisted store art.

  AI coding assistance falls under "efficiency gains", which Valve says "is not the focus of this section" ([Content Survey](https://partner.steamgames.com/doc/gettingstarted/contentsurvey); [Outlook Respawn](https://respawn.outlookindia.com/gaming/gaming-news/valve-clarifies-steam-ai-policy-focus-shifts-to-content-consumed)). The same survey generates the regional ratings.
- **Accessibility.** The Accessibility Feature Wizard is optional, but its answers are searchable ([Steamworks: accessibility features](https://partner.steamgames.com/doc/accessibility_features)).
- **EULA.** The Steam Subscriber Agreement already covers buyers, so a custom EULA is optional ([Steamworks: SSA](https://partner.steamgames.com/doc/marketing/branding/ssa)).
- **Privacy policy.** Publish a short one anyway, linked from the store's website field and from Settings. It should state that:
  - Valve handles accounts;
  - multiplayer is peer-to-peer and exchanges Steam IDs, and, until Stage 2 lands, possibly IP addresses;
  - saves are stored locally, plus Steam Cloud;
  - there are no analytics.

**EU AI Act.** Article 50 has applied since 2 August 2026, but it mainly binds the providers of generative tools. Creative works face only a light disclosure duty, and only for deep fakes ([AI Act Article 50](https://artificialintelligenceact.eu/article/50/)). A Voice Library voice cloned from a real actor is the one edge case.

**Tetris and trademark posture.** The legal review rates the Tetris posture Medium: "a conditional no-go for commercial storefront submission pending counsel review" ([tetris_legal_review.md](../tetris_legal_review.md)). It:

- names store art and screenshots, which don't exist yet, as the main control point;
- calls the seven-piece intro decoration "the highest-leverage remaining visual item";
- flags the live US mark WORD SERENITY (Reg. 6,138,055, class 9) for name clearance; EU and Swedish registers have never been searched.

Running `check:ip-strings` and `check:palette` on pull requests, rather than after merge (REPO-04), keeps that work from regressing.

## Each proof has one right place to run

The three environments can prove different things:

- **This container** can run every CI gate, the full unit suite (over 900 files and about 18,000 tests), the Vite build, and even a packaged Linux build. But it has no GPU, and no Steam client. In the audit's packaged smoke run here, WebGPU was unavailable and the app fell back to WebGL2 on SwiftShader software rendering ([audit Part 2](REPOSITORY_AUDIT_2026-10-13.md)). So nothing visual, nothing about frame pacing and nothing about Steam can be proven here.
- **The owner's Windows GPU machine** is needed for Windows-only work (the ASAR integrity resource, the NSIS and Windows packages, Sticky Keys) and for every WebGPU claim. CLAUDE.md limits each session there to one small effect, because full-journey captures have crashed the iGPU.
- **The two-machine session** is needed for anything about Steam networking, lobbies or relays.

| # | GPU-less container (this one) | Owner's Windows GPU machine | Two-machine Steam session or partner site |
|---|---|---|---|
| 1 `wireV2` | Flag test with an injected date; the new counters exist; mock-transport rehearsal of A, B, C and F with `wireV2=1`; delta-bytes budget gated | Builds both session machines from one commit | 10-min v1 baseline; at least 60 min of v2 soak covering B, C, E (with clumsy) and F; mixed builds both ways plus rollback; all exit criteria |
| 2 AppID | Resolver has no 480 path; gates fail on `\b480\b` or any `steam_appid.txt` in the package | Exe started from Explorer relaunches via Steam; dev run attaches to the real ID; overlay and playtime attach | Install from a private beta branch on both machines; a real-AppID run before release |
| 3 Binding | Alias installs; `electron/` typechecks against the fork's `client.d.ts`; queue, rate-limit and range unit tests; the mirror builds in CI | Packaged spike: init, achievement plus `stats.store()`, boards with all three download types, Cloud | Lobby and P2P regression on the new binding; Messages spike for Stage 2 |
| 4 P2P | Pure-filter tests: member, non-member, banned, out-of-lobby, race with re-post, send refusal. Harness: kicked HELLO rejected, spectator cap, peer-sent join ignored | — | About 20 min: join accepted; leave then send (ignored); kick (blocked); non-member (ignored); packet capture of IP exposure. Stage 2: two different networks show only relay addresses |
| 5 Electron | Install, gates, tests and build; advisory gate fails on 38; Linux package shows the CSP active, `eval` and injected scripts blocked, no `require`; encoded `..` traversal against `app://` | Back up `%APPDATA%` first. Windows package with fuses; `@electron/fuses read`; an asar byte-flip terminates the app; `ELECTRON_RUN_AS_NODE` and `--inspect` ignored. Themes and Odyssey on WebGPU, one effect per session; Phaser on WebGL2; music seeking under `app://`; saves persist; crash, GPU-kill and hang dialogs; perf re-baseline on iGPU and NVIDIA; overlay A/B at 60 and 144 Hz | Lobby round trip on 44 |
| 6 Rules | Canonical-matrix kick fixtures; lowest-row lock tests; golden demos per rules ID; local/online router parity; bot-versus-bot tuning | Playtest the feel of rotation and lock; four-player couch pressure test | A mismatched `rulesId` is rejected with a reason; `versus@3` garbage is identical on both peers |
| 7 Keys | No cross-seat duplicates, including the Serenity hotkeys; one key reaches one seat; migration is idempotent on load and on Cloud apply; SOCD goldens at 30/60/144/240 Hz; stick axis table | Two-person couch test; key-test panel on a cheap keyboard; no Sticky Keys prompt; AZERTY labels; real controllers for stick hysteresis | Optional: one account, old and new builds, Cloud round trip |
| 8 VSync | Cap-interval logic; the settings migration drops `vsyncEnabled` | Frame rate at every cap on 60 Hz and 144 Hz displays; "Match display" performance unchanged; Odyssey honours the cap | — |
| 9 Dev gating | Release `dist` contains no `UrlParametersView`, `unlockAll`, `OdysseyLayoutEditor` or `openDevTools`; `--serenity-selftest` passes; harnesses green in diagnostics mode | F12 and the Settings button are gone in release; `--remote-debugging-port` exits; the diagnostics build opens CDP; `validate:windows:*` | The diagnostics build installs from the password-protected `qa` branch |
| 10 Licence | `package.json` fields; LICENSE; generated notices; the gate fails on a missing notice or a shipped `steam_appid.txt`; IP-string and palette gates on PRs | — (GitHub settings are owner actions) | Partner site: Content Survey, accessibility wizard, controller level after Deck testing, privacy link, EULA choice, check for any EU trader-details requirement |

## Questions only the owner or a lawyer can answer

The research can recommend, but these calls depend on the owner's plans, money and risk appetite, or on law that the notes deliberately don't settle.

| # | Owner decides | Lawyer decides |
|---|---|---|
| 1 | Can two Windows machines, two Steam accounts and about 2.5 hours be booked for 22–28 October, plus a third client for scenario F? If not, accept one re-date to no later than 15 December? | — |
| 2 | When will the real AppID exist? Is any non-Steam (NSIS) channel wanted? A native Linux build later, or Proton only? | Confidentiality terms of the Steam Distribution Agreement, which the research didn't review |
| 3 | Is a mirrored, single-maintainer fork acceptable? Are replays attached to leaderboards wanted (pipelab lacks the attach call)? Would boards ever move to the server-written Trusted model? What overlay default after the A/B test? | Whether shipping Valve binaries redistributed through a third-party npm binding is fine under the SDK agreement |
| 4 | The spectator cap; the "Invite only" relabel until invites work; Public lobbies before Stage 2, or friends-only; drop-in policy | Whether the developer is a GDPR controller for the P2P exchange of Steam IDs and IPs, and what the privacy notice must say |
| 5 | The launch date, which decides 44 versus 45 or 46; whether any outside tester has local saves, which decides the migration release; the crash backend and consent; whether to sign an NSIS build | Consent wording for any crash-report uploads |
| 6 | Score T-spins, back-to-back and combos, or drop the announcements; lock-out; spawn column; PRNG; assist kicks for relaxed modes; the garbage curve and cap after simulation; a 180° table | "T-spin" as a player-facing label; whether rotation behaviour belongs in counsel's total-look review |
| 7 | F or R for Player 2's hard drop; restart or keep DAS charge on reactivation; move gamepad hard drop off B; ship an "Up = hard drop" preset | — (key layouts are functional, so low risk) |
| 8 | Which caps to offer, including 40 for handhelds; an uncapped benchmark flag in diagnostics builds | — |
| 9 | Which support affordances ship in release; who receives the `qa` password | — |
| 10 | What Pages hosts, and the web build's support level; when to go private; whether to open the code later; the legal entity; a trademark filing budget; whether to have a EULA | The effect of the bare MIT declaration and the wording of the fix; protection for AI-authored code, music, voice and models, and which vendor terms apply; US copyright registration; name clearance and an EU or Swedish filing; the Tetris review's P0 items and the store art; EU Digital Services Act trader status and consumer law; EULA validity; litigation risk from the public legal documents |

## Conclusion

The ten decisions look independent, but they meet at three seams, and the right order follows from them:

- **The HELLO handshake** carries the wire range today. It should carry `rulesId` and `rulesHash` next, and Steam's build ID only as a diagnostic.
- **The main-process Steam module** is where the AppID, the restart check, the member filter, the binding and the overlay's init order all live.
- **The release/diagnostics split** retires the very environment-variable and localStorage levers that the October session relies on.

Most of the avoidable waste here comes from doing things out of order:

- creating partner-site boards before the generation-3 names exist;
- swapping the binding between the soak and its verification;
- taking the repo private before Pages has a replacement;
- letting a tester build out before `app://` lands.

In practice, the first build that leaves the owner's machines is the real deadline for half the list. It ends the period in which origins, rules, key defaults and licences can change for free.

The most consequential open item is an empirical question, not a judgment call. Nobody knows whether legacy ISteamNetworking exchanges addresses before a session is accepted, and the packet capture planned for the October session settles it:

- **If addresses don't leak before acceptance,** Stage 1 protects everyone outside a lobby, and Stage 2 is needed only before public matchmaking.
- **If they do,** anyone who knows a player's SteamID64 can learn that player's IP whatever the filter does. Stage 2 then becomes a launch blocker for all online play, and the privacy policy changes with it.

That ten-minute capture deserves the same priority as the protocol soak itself.
