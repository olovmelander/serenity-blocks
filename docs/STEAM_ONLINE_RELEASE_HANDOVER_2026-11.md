# Steam, records and online release handover

The implementation is on `feature/steam-online-release`, branched from `8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138`. The release App ID and monitored privacy address remain owner inputs. The Steam partner site, depots and store have received no changes from this branch. Use the approved decisions, exact partner names, App ID-day checklist and acceptance cases in the [release plan](STEAM_ONLINE_RELEASE_PLAN_2026-11.md). The [audit](STEAM_ONLINE_RELEASE_AUDIT_2026-11.md) describes the pre-implementation baseline.

## Player-visible changes

| Area | What to expect in the candidate |
|---|---|
| Records | Single Player and Infinity keep their own top 100, lifetime figures, prior PB and result delta. The Records sheet shows local and Steam lists together on wider screens. Odyssey times have millisecond precision. The orb card shows the fastest unassisted clear across journeys and a comparison with friends. The clock ends when the clear is banked. Charms count toward campaign stars. Survival orbs 39 and 58 have no time race. |
| Steam boards | Six aggregate/solo boards and 58 per-orb boards. The game reads the global top ten, friends, and two neighbors on either side of the player, and separately requests the player's actual entry even below the first page. It distinguishes an absent rank, a queued improvement and the last successfully downloaded page. |
| Score sharing | The first eligible finish can be shared from the results or Records. Consent defaults off. It belongs to the game and Steam account on this device. Enabling shares existing eligible personal bests. Stopping sharing cancels future submissions. Existing public entries need the support route in the privacy policy. Casual client scores use catalogue and run checks. The compact checksum is diagnostic. |
| Online | Public, friends-only and invite-only rooms, warm/cold invitations and Join Game use the same lobby admission path. A restricted room clears its join presence. Match traffic uses the relay in the store build. In a two-player match a disconnect ends the match and the other player wins it (the default free-for-all has no rounds). A continuing match holds the seat for ten seconds. The waiting-room host leaving closes the room. Chat has local mute, Valve text filtering and a profile report route. |
| Profiles and recovery | A licensed desktop launch selects a Chromium partition by App ID and Steam ID before opening the game. Launching offline reopens the last recognized account for that App ID. “Import local records” reads the original guest profile explicitly, preserves its source and excludes guest evidence from public score publication. Qualifying old scores and completed orbs recovered from the account's Steam Cloud can backfill personal milestones. |
| Steam Input | Controller activation of a text field asks Steam for its floating keyboard. The left stick button opens match chat when available and unbound to gameplay. Keyboard dismissal returns control to the match. Run the remaining on-device checks at 1280 × 800 in gaming mode. |

## Native integration and durability

The lockfile pins `steamworks.js` as an alias for `@pipelab/steamworks.js@0.12.2`. The implementation calls the pinned native addon's initializer and installs one manual callback dispatcher. The wrapper's JavaScript initializer would start an additional callback pump. Synchronous identity, Cloud and friends functions still use the shipped addon. Board calls, asynchronous lobby requests, join notifications, the flat StoreStats acknowledgement and the relay use the same loaded SDK. Races, late results, negative store results and a changed account have explicit tests. Source provenance is [the pinned wrapper](https://github.com/CynToolkit/steamworks.js/tree/05eaed23ec74525e4f79785bda65154c1d175dfe) and [its Steam client initializer](https://github.com/Noxime/steamworks-rs/blob/40a457a61f5ef714d93804e51e0c5e3d405145a3/src/lib.rs).

The pinned npm tarball integrity is `sha512-WQegFI8EUvKpzQOOZd+SosSKrUYOxBubhAsqwYUgD5TyehTrjpNkKWk2stgmDnVw8InDbZZwE2suL/m+sqAvTw==`. Before project signing, the staged Steam addon SHA-256 is `f88ed61a0a7054c6732955a2b1cf1d73214f38ca85061a3c53b3ca6d83ea3772` on Windows x64 and `377458ce0fd917729f652a7e72755375c6f21908a48acfd03bbb9d9af6348f19` on Linux x64.

The catalogue is the common input for the renderer, native validation and partner manifest. Production uses `FindLeaderboard`, verifies direction and display units, and sends `KeepBest`. Missing or misconfigured boards produce a retryable error. A persisted ten-attempt, ten-minute budget, per-board backoff and one outstanding upload protect retries after an uncertain response. All account and board IDs retain their full integer precision. [Valve leaderboard interface](https://partner.steamgames.com/doc/api/ISteamUserStats)

Each new finish gets an immutable ID. Its IndexedDB transaction commits the local score, history and contribution together. A short-lived localStorage entry can replay a finish after an interrupted transaction. A shared pre-migration aggregate is a baseline. The union of unique new contributions gives exactly 12 after two devices each finish once from a common 10. Already collapsed legacy counters cannot reveal how much old play overlapped. Retained local replay links stay on the original device.

Cloud first enumerates the account's files, restores independent writers' checksummed generations, then reconciles the shared files. Each writer keeps two verified copies of the latest generation and one slot for its predecessor. Larger snapshots use gzip. An unrecognized schema or unreadable file keeps recovery work pending. Records offers a retry and a local recovery export. An interrupted public upload retries the same PB. Personal stats send absolute values and become acknowledged after the Steam store callback and read-back. The first native stat mutation for a migrated counter waits for the baseline to reach a verified Cloud generation. With Steam Cloud disabled, individual achievements can still unlock, public sharing follows the player's choice, and cumulative counter work waits for reconciliation. A disk or Cloud quota failure still requires storage to become available.

## Verification on 2026-11-18

The tested implementation ends at `592c6ee10e18adf7426ddf609fa311f3b62af4ed`. There was no Steam client process, service, executable at the default install location, or registered Steam protocol on this Windows machine. Two-account and Deck results need licensed hardware. No Steam build ID exists for this local branch.

| Check | Evidence |
|---|---|
| Regression tests | 1,333 tests in 97 focused files passed, covering records, recovery, account/IPC boundaries, Steam callbacks, gameplay results, multiplayer, packaging and controller input. |
| Repository-wide run | During implementation the full suite reported 26,745 passed, 14 failed and 37 skipped across 1,486 files. All four affected game/Steam test files passed on the final tree. The unrelated TTS recorder still fails setup with Windows `EPERM` while creating a directory symlink, followed by its hook timeout. This is the known local-suite failure. |
| Build and gates | TypeScript, the production Vite build, boot closure and the normal release checks passed. A disposable fixture with a valid ID and populated contact passed both store policies. The actual store gate exited 1 and named the missing awarded App ID and monitored contact. |
| Native package | Electron 44.9.3 Windows and Linux x64 unpacked directories passed the after-pack content and IP-string checks. The Windows development copy loaded the addon and resolved 44 client and 11 relay SDK functions. The staged Linux ELF exports include all 55 functions and its Steam and Koffi addons expose their N-API entry points. |
| Host and hardware limits | Staged unsigned Windows process and addon were denied by the workstation's Application Control policy. The Valve DLL signature was valid. Linux execution, a clean native source rebuild with the Windows/Linux compilers, actual Steam overlay and SDR traffic, and Deck review are open. |
| QA tools | Manifest contains 64 boards, nine stats and four achievement setups. SteamPipe generated a preview build file and two depot files in a disposable directory. Chromium smoke passed all four scenarios, including guest import from the original file URL. |

## Repeatable offline verification

Run from this worktree with Node 24, the lockfile and current Electron installed. If cross-packaging Linux on Windows, npm normally installs only the host's optional Koffi binary. Use a native Linux builder or stage the exact lockfile version of `@koromix/koffi-linux-x64` in the isolated build dependencies. The after-pack hook checks that the target binary is present.

```powershell
npm ci
npm run typecheck
npm run check:release-gates
npm run steam:qa -- manifest
npm run steam:qa -- verify-native
npm run steam:qa-renderer
npm run steam:qa -- size 100000
npm run build
npx --no-install electron-builder --win --linux --x64 --dir --publish never
```

The rendering smoke uses real Electron, Chromium IndexedDB, the packaged game's file-URL origin and disposable profile partitions. It exercises an interrupted local write, duplicate receipt, opt-in/out, focus, global/friends/personal rows, offline reopening, profile isolation and explicit guest import. Its Steam responses are fixtures. The two-writer stats sizing fixture filled six recovery slots plus the shared mirror with 100,000 distinct runs. It used **48,305,065 bytes**, leaving **18,803,799 bytes** of the suggested 64 MiB for other docs. More writers and longer careers change consumption. Use the live quota and file count on the QA accounts before publishing the partner allowance.

## Store candidate and licensed acceptance

1. Enter the awarded App ID in `electron/steam-app-id.js` and replace the contact placeholder at the top of `PRIVACY_POLICY.md` with a monitored address. With `$env:SERENITY_RELEASE='1'`, run `npm run check:release-gates` and build both packages again. The test App ID stays in the dev checkout. The store package must contain zero copies of `steam_appid.txt`.
2. Run `npm run steam:qa -- manifest` and use the emitted names, units and directions for all 64 boards. Enter its nine integer stats and four achievements with their display names and artwork from the plan. Publish the definitions and English rich-presence localization. Configure the app's Remote Storage quota and file count. Keep settings scoped to the app. [Valve partner checklist in the release plan](STEAM_ONLINE_RELEASE_PLAN_2026-11.md#5-app-id-day-checklist)
3. Sign and timestamp the Windows candidate. electron-builder signs `Serenity Blocks.exe` and both native addons while it packages once it has a certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`, or another route under `build.win`). No certificate existed on 26 November, and a store build now stops unless all three read `Valid` (see Round two below). The Windows build includes `.node` in electron-builder's signing extensions. On this workstation Application Control rejected the unsigned staged Steam addon and executable with error 4551. The Valve DLL has a valid signature and the staged addon matched the working dependency byte for byte. Check that the production certificate is trusted by the candidate machine, then run the following on the exact staged build, followed by a launch from Steam. A managed machine may also require its administrator's signer approval.

   ```powershell
   Get-AuthenticodeSignature 'release/win-unpacked/Serenity Blocks.exe'
   Get-AuthenticodeSignature 'release/win-unpacked/resources/native_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node'
   npm run steam:qa -- verify-native release/win-unpacked/resources/native_modules
   ```

   Run that last command on a copy of the folder outside any checkout. Inside one, Node finds the checkout's own install before the package's.
4. On Linux x64 run `npm run steam:qa -- verify-native release/linux-unpacked/resources/native_modules` and then launch the licensed candidate. The Linux SDK's ELF exports and addon architecture were checked from Windows. The staged Linux executable references glibc through 2.25, the Steam addon through 2.30, and Valve's SDK library through 2.14. A source rebuild can be checked on these native builders with the wrapper commit above, its committed `Cargo.lock`, Rust 1.96.0, and `cargo +1.96.0 build --release --locked`. Use the platform toolchain, including MSVC for Windows. Load the rebuilt module beside the same SDK library and rerun ABI and licensed smoke before substituting a distribution binary.
5. Generate local SteamPipe **preview** scripts with `npm run steam:qa -- depots APP_ID WINDOWS_DEPOT_ID LINUX_DEPOT_ID NEW_OUTPUT_DIRECTORY`. Substitute the numbers Valve assigns. Select each OS's launch executable, a default Steam Input Gamepad layout and a restricted QA branch in Steamworks. Grant separate licenses to A and B, and to C for continuing host migration. Each machine needs its own account for concurrent play. Promotion and publication are separate partner actions.
6. Run the complete [T1–T12 two-account script](STEAM_ONLINE_RELEASE_PLAN_2026-11.md#6-live-test-script-for-two-accounts). Start with `npm run steam:qa -- inspect APP_ID EXPECTED_17_DIGIT_QA_STEAMID` on each native machine with Steam running. It checks all boards, returns real stat values and achievement names, and reports quota and a file inventory with generation numbers and hashes for recovery slots. Preserve a private run sheet with branch/build ID, OS, Steam Input layout, account aliases, before/after ranks and totals, and relay diagnostic deltas. Use the [two-machine transport acceptance thresholds](TWO_MACHINE_STEAM_VALIDATION.md).
7. For T9, finish once on each disconnected device from a known common total, use the **same** QA account sequentially, then sync each device twice and open a fresh OS profile. Expect exactly two additional finishes, both local PB extrema and retained progress. For T10, target a disposable QA account with the game closed. Back up the exact named file into a fresh **private directory outside the repository** before each corruption trial.

   ```text
   npm run steam:qa -- backup   APP_ID QA_STEAMID FILE PRIVATE_BACKUP_DIRECTORY
   npm run steam:qa -- truncate APP_ID QA_STEAMID FILE PRIVATE_BACKUP_DIRECTORY
   npm run steam:qa -- restore  APP_ID QA_STEAMID FILE PRIVATE_BACKUP_DIRECTORY
   npm run steam:qa -- future   APP_ID QA_STEAMID FILE PRIVATE_BACKUP_DIRECTORY
   npm run steam:qa -- restore  APP_ID QA_STEAMID FILE PRIVATE_BACKUP_DIRECTORY
   ```

   Try a current stats generation, highscores and the manifest separately. Between injection and restore, launch the game and inspect recovery on the fresh device. Restore while the game is closed. The helper checks the signed-in account and backup, preserves original bytes, and reads its write back. Use the signed build without fault injection for final acceptance.
8. For a repeatable acknowledgement loss or relay outage in an **unpackaged** licensed QA client, start the frontend with `npm run dev` on port 5173. From a second PowerShell in the same checkout use the following. Choose one of `upload-ack`, `stats-ack`, `cloud-write` or `relay-open`. Reopen without the fault after the outcome. Exit 86 means the native acknowledgement arrived before the forced process exit. The expected score, achievement and stat must converge after the retry.

   ```powershell
   $env:STEAM_APP_ID = 'YOUR_AWARDED_APP_ID'
   $env:SERENITY_QA_APP = $env:STEAM_APP_ID
   $env:SERENITY_QA_ACCOUNT = 'YOUR_17_DIGIT_QA_STEAMID'
   $env:STEAMWORKS_MODULE = ([Uri](Resolve-Path scripts/steam-qa-client.mjs).Path).AbsoluteUri
   $env:SERENITY_QA_FAULT = 'upload-ack'
   npm run dev:electron
   Remove-Item Env:SERENITY_QA_FAULT
   npm run dev:electron
   ```

Two machines can verify invites, a relayed duel, disconnect outcomes, records, Cloud, chat, presence and stats. A continuing host migration needs a third licensed participant. Actual Steam Input, overlay keyboard, suspend/resume, legibility, performance and offline return must pass on physical Deck hardware before requesting Valve's compatibility review. [Valve Deck compatibility review](https://partner.steamgames.com/doc/steamdeck/compat)

For rollback, preserve the account's Cloud contents, recovery generations and local profile. Switch the QA branch to the previous build through Steamworks and test re-upgrading on the disposable accounts. Older builds do not understand the new receipts. Already published boards and Steam achievements remain associated with the App ID. Keep QA evidence private and use the advertised support route for removal requests.

## Round two · 26 November 2026

The versus rules changed on 22 November, after everything above was written. The
[drift check](STEAM_ONLINE_RELEASE_DRIFT_2026-11.md) records what that broke and the owner's
decisions D9 to D15. This section is what was built for them, on branch `audit/steam-online-drift`
from `e31421d3b`, merged to main as `b05392134`. The plan's checklist and its test script (now T1 to T15) are revised to match.
Nothing here has run on real Steam.

### What changed for players

| Area | What to expect |
|---|---|
| Kills stat | `ffa_kills` counts every knock-out of a free-for-all. It used to record a ten-frag win as one kill. The bound is the frags goal, or one knock-out per ten seconds played when the goal is not frags; Survivor keeps one per opponent per round. Time played is never taken past what the player's own computer measured, so a host cannot report hours for a minute's match. |
| Builds that cannot play together | One match compatibility number (ADR-0026). The match list shows a room from another version with "Update to join" or "Older version" in place of Join and Watch. A join by invite or lobby ID is refused with the update message before anyone is added. |
| The match list and the waiting room | A row says what kind of room it is ("Survivor · Blind"). The waiting room has an Attacks entry with every setting off its default, one to a line. The Drop in label and the tile of a waiting player say "a key press" in a free-for-all and "next round" in Survivor. |
| Private rooms | The waiting room of a private room shows "Invite only" and no lobby ID. What Steam does with a bare ID is for test T2 to show. |
| A broken link | A player who "wins" because everyone else fell silent while their own Steam connection is down reads "Your connection to Steam was lost, so the match ended." and records no win. When both sides are still connected, both keep their result. |
| Host change | Every player reads "<name> is now hosting this match." |
| Leaving a match | A failed resync reads "The match could not be kept in sync with the host, so you left it." It used to read "removed by the host". |
| Steam status | The player count in "Online Versus · N-player match" follows a drop-in or a leave. |
| Linux | The window has the game's icon. |

### What changed underneath

- **`wireV2`** is re-dated to 2027-03-31 and stays off. The game launches on protocol 1 (ADR-0013,
  third amendment).
- **Orb time boards have a rules freeze.** `tests/unit/odyssey-time-board-freeze.test.js` fingerprints
  each of the 58 timed orbs: its definition, its rule fields, and for the eight rival orbs the bot's
  data and a played digest of the real duel. One orb can carry its own board generation
  (`ODYSSEY_TIME_BOARD_GENERATIONS`), so a retune costs one new board. Until the App ID is set a
  change is re-pinned with `npm run odyssey:board-freeze`; after that, a change that can alter a
  clear time needs a new board for that orb. Bot work on another branch moves the eight rival pins,
  so re-pin after a sync with main.
- **A store build checks its own signatures.** `npm run build:win` with `SERENITY_RELEASE=1` stops
  unless `Serenity Blocks.exe` and both native addons read `Valid`. `npm run check:signatures --
  release/win-unpacked` prints the statuses at any time. `SERENITY_ALLOW_UNSIGNED=1` lets a deliberate
  unsigned build through with a warning.
- **CI can package the desktop app.** `.github/workflows/desktop-package.yml` packages on Ubuntu and
  Windows and loads each package's Steam addon from a copy outside the checkout. Its first run, on
  the merge commit, passed on both.
- **The main checkout's Steam packages match the lockfile** (`steamworks.js` 0.12.2, `koffi` 3.3.5).
  They were copied in from a worktree that had them; no `npm ci` was run there.

### Still open

1. **Owner inputs:** the App ID, the monitored contact address, and a signing identity (D9).
2. **The live test:** T1 to T15 and the three-account script. Two results decide follow-up work:
   what Steam does with a bare ID to a private lobby (T2), and whether a player whose network is cut
   reads "connection lost" in time (T4).
3. **Frag credit across a host change.** Who attacked whom last lives in the host's memory, so a
   knock-out in the first seconds after a host change can go uncredited. Seeding it from each
   player's waiting garbage when a new host takes over is the likely fix; it was left out because
   it touches the takeover path and cannot be proven without three machines.
4. **Two stat edges, the owner's call:** a drawn Survivor ending records a win for whoever sorts
   first, and a player who leaves records no match while the one who stayed records a win.
5. **The Linux package has never been launched.** CI now shows that it packages and that its Steam
   addon loads on Ubuntu. Starting the game from Steam on Linux or on a Deck is still test T12's.
6. **No tool seeds an eight-day-old pending score** (T7).

### Verification on 26 November

Run in the worktree `serenity-blocks-steam-drift` on Windows, Node 24.20.0, with other sessions'
benchmarks running on the same machine.

| Check | Result |
|---|---|
| Full unit suite | 1,563 files, 29,049 tests: 29,006 passed, 35 skipped, 8 failed in 4 files. Six of the eight were one test stub of this branch (`online-match-stage-sessions`), fixed afterwards. The other three files (`local-versus-cameras`, `display-settings-apply`, `theme-registry-lifecycle-acceptance`) are untouched by this branch, timed out or raced under load, and pass on their own. |
| Online, Steam, records and packaging tests, after the fix | 160 files, 1,881 tests: all pass except the known wall-clock test in `local-versus-cameras`, which passes alone. |
| Gates | Typecheck, lint ratchet, type ratchet, architecture fitness (the online mode file is inside its line budget), dependency boundaries, the release gate, the pages artifact check and the IP-string gate all pass. With `SERENITY_RELEASE=1` the release gate still exits 1 for the App ID and the contact, as it should. |
| Build and packages | `npm run build` passes on the final tree. The unpacked Windows and Linux packages were staged earlier the same day with the packaging changes in; the after-pack checks passed on 1,148 files each, with no `steam_appid.txt`. |
| Signatures | `npm run check:signatures -- release/win-unpacked` reports the `.exe` and both addons `NotSigned` and Valve's library `Valid`; as a store build it exits 1, and 0 with `SERENITY_ALLOW_UNSIGNED=1`. |
| Boards | `npm run odyssey:board-freeze -- --check` prints "All 58 orb time boards match their pins", and the manifest prints the same 64 board names as before. |
| Main checkout | `npm run steam:qa -- verify-native` there now prints "44 client and 11 relay symbols resolved, addon loaded". |
| Not verified | Anything on real Steam or on a Deck, and a launch of the Linux package. (The CI job and the freeze test on Ubuntu were unverified here; both ran after the merge, see below.) |

### Checks before the merge, 26 November

Done after the build above, without Steam. Each one found or confirmed something.

| Check | What it showed |
|---|---|
| An independent review of the whole branch | Five findings, all fixed with tests. A host's own "connection lost" exit could be swallowed by a latch left from an earlier session, leaving a finished board with no results (the latch is now cleared when a lobby is created). The time-based kills bound trusted the host's reported duration (it is now bounded by the player's own clock). A new room could be listed for a moment as an older build (the compatibility number is now written first and the key the list filters on last). A real win was lost if the player closed the session during the 600 ms connection check (it is now recorded). The CI job packaged Windows without the game's icon. |
| The join handshake against the real earlier build | The source at `0da5b6bdd` and the branch, each running its own handshake code. Old joiner to new host: refused with "update required", never added to the roster. New joiner to old host: the joiner declines the session with "the host is using an older version". Each build still joins itself. |
| The changed screens in the running game | The real game in a headless browser on the mock transport: the match list with five rooms (kind shown, drop-in label, "Update to join", "Older version"), the waiting room of a public room and of a private Blind room, and the new-host notice. Two layout faults that no unit test could see were found and fixed: a long attack-rules line pushed the waiting room's left panel into a sideways scroll, and that panel's scrollbar was unstyled. The rules now read one to a line. |
| The Steam records smoke on the final tree | `npm run steam:qa-renderer` passes all four scenarios; the Cloud sizing figure and the 64 board names are unchanged. |
| Linux | Not possible here: this machine has no WSL and no Docker. CI on a pull request runs the unit suite on Ubuntu, which is the first place the board freeze's played digests will run off Windows. |

### After the merge

| What | Result |
|---|---|
| The merge | `b05392134` on main, 26 November. Main had not moved since the branch started, so nothing needed resolving, and no pipeline was running when it was pushed. |
| Build and Deploy Pages | Test, build and deploy passed on the merge commit. The full unit suite ran on Ubuntu there, so the board freeze's played digests are the same off Windows. |
| Package Desktop App | Its first run passed on Ubuntu and on Windows. Ubuntu printed "linux x64 44 client and 11 relay symbols resolved, addon loaded": the Linux package's Steam addon loads on Linux without a Steam client. Windows packaged with the game's icon and reported the `.exe` and both addons unsigned, as a test build should. |
