# Steam, records and online release handover

The implementation is on `feature/steam-online-release`, branched from `8dc68d825db61bc04e1cfb4e4c5a1f580ea3e138`. The release App ID and monitored privacy address remain owner inputs. The Steam partner site, depots and store have received no changes from this branch. Use the approved decisions, exact partner names, App ID-day checklist and acceptance cases in the [release plan](STEAM_ONLINE_RELEASE_PLAN_2026-11.md). The [audit](STEAM_ONLINE_RELEASE_AUDIT_2026-11.md) describes the pre-implementation baseline.

## Player-visible changes

| Area | What to expect in the candidate |
|---|---|
| Records | Single Player and Infinity keep their own top 100, lifetime figures, prior PB and result delta. The Records sheet shows local and Steam lists together on wider screens. Odyssey times have millisecond precision. The orb card shows the fastest unassisted clear across journeys and a comparison with friends. The clock ends when the clear is banked. Charms count toward campaign stars. Survival orbs 39 and 58 have no time race. |
| Steam boards | Six aggregate/solo boards and 58 per-orb boards. The game reads the global top ten, friends, and two neighbors on either side of the player, and separately requests the player's actual entry even below the first page. It distinguishes an absent rank, a queued improvement and the last successfully downloaded page. |
| Score sharing | The first eligible finish can be shared from the results or Records. Consent defaults off. It belongs to the game and Steam account on this device. Enabling shares existing eligible personal bests. Stopping sharing cancels future submissions. Existing public entries need the support route in the privacy policy. Casual client scores use catalogue and run checks. The compact checksum is diagnostic. |
| Online | Public, friends-only and invite-only rooms, warm/cold invitations and Join Game use the same lobby admission path. A restricted room clears its join presence. Match traffic uses the relay in the store build. In a duel a disconnect forfeits the round. A continuing match holds the seat for ten seconds. The waiting-room host leaving closes the room. Chat has local mute, Valve text filtering and a profile report route. |
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
3. Sign and timestamp the Windows candidate through the project's normal signing pipeline. The Windows build includes `.node` in electron-builder's signing extensions. On this workstation Application Control rejected the unsigned staged Steam addon and executable with error 4551. The Valve DLL has a valid signature and the staged addon matched the working dependency byte for byte. Check that the production certificate is trusted by the candidate machine, then run the following on the exact staged build, followed by a launch from Steam. A managed machine may also require its administrator's signer approval.

   ```powershell
   Get-AuthenticodeSignature 'release/win-unpacked/Serenity Blocks.exe'
   Get-AuthenticodeSignature 'release/win-unpacked/resources/native_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node'
   npm run steam:qa -- verify-native release/win-unpacked/resources/native_modules
   ```
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
