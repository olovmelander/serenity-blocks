# Shipping a Paid Electron Game on Steam — Research Report

**Game context:** Serenity Blocks — Electron + Vite web game, electron-builder NSIS target (~619 MB installer), 36 MP3 music tracks = 256.2 MB (verified locally in `public/assets/music`), steamworks.js Steam P2P multiplayer, developer based in Sweden (EU).

**Repo ground truth verified during research** (`c:\Users\olovm\serenity-blocks`):
- `electron/main.js`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — already at the secure baseline. CSP is injected via `session.defaultSession.webRequest.onHeadersReceived` with inline-script SHA-256 hashes (`electron/content-security-policy.js`). `setWindowOpenHandler` denies popups; `will-navigate`/`will-redirect` blocked; `shell.openExternal` restricted to `http:`/`https:`.
- Packaged CSP still whitelists `fonts.googleapis.com` / `fonts.gstatic.com` (remote origins in an offline paid game).
- `package.json` build config: `files: ["dist/**/*", "electron/**/*", "package.json"]` with asar defaulting to **true** → the 256 MB of music is packed inside `app.asar`. steamworks.js / ez-steam-api / koffi ship via `extraResources`. **`extraFiles` copies `steam_appid.txt` into every packaged build** — this contradicts Valve's release guidance (see §3).
- Steam init lives in the **main process** (`electron/steam-integration.js`), bridged to the renderer — correctly avoiding steamworks.js's insecure README advice (see §3 pitfall).

---

## 1. Electron security checklist (2025/2026)

### The practice
Electron's official security tutorial is a 20-point checklist. The items that matter most for a packaged offline game:

- **#3 Enable Context Isolation** and **#4 Enable process sandboxing** — defaults since Electron 12 and 20 respectively; "Disabling context isolation also disables process sandboxing." Preload scripts are more privileged than sandboxed renderers, so isolation is what prevents leaking privileged APIs into page JS.
- **#7 Define a Content-Security-Policy** — "Electron respects the Content-Security-Policy HTTP header which can be set using Electron's `webRequest.onHeadersReceived` handler." CSP's preferred delivery is an HTTP header, but the docs note this "is not possible … when loading a resource using the `file://` protocol", where the fallback is a `<meta http-equiv="Content-Security-Policy">` tag.
- **#17 Validate the sender of all IPC messages** — check `event.senderFrame.url` in every `ipcMain.handle`/`on` before acting (docs example: `if ((new URL(frame.url)).host === 'electronjs.org') return true`).
- **#13/#14/#15** — limit navigation (`will-navigate` + URL check), deny new windows (`setWindowOpenHandler`), never pass untrusted content to `shell.openExternal`.
- **#18 Avoid `file://`, prefer custom protocols** — a registered privileged scheme (e.g. `app://`) gets real response headers (CSP applies natively), stream semantics, and avoids the absolute-path trap this project already hit once (music manifest fetch broke in packaged builds).
- **#19 Check which fuses you can change** — Electron Fuses flip build-time toggles in the shipped binary: `runAsNode: false` (stops `ELECTRON_RUN_AS_NODE` turning your game into a generic Node runtime), `nodeCliInspect: false` (no `--inspect` debugger attach), `embeddedAsarIntegrityValidation + onlyLoadAppFromAsar: true` (rejects tampered/replaced app code). Flip them with `@electron/fuses` in an electron-builder `afterPack` hook.

### Why
A game is a long-lived, auto-trusted local executable. The renderer runs a large JS surface (Three.js, gameplay code, P2P message handling); any markup/JS injection bug in a sandboxed, context-isolated renderer with strict CSP is a nuisance — the same bug with Node integration is arbitrary code execution on the player's machine. For a P2P multiplayer game, **remote peers are untrusted input** into the renderer, which raises the bar from "local app, who cares" to "network-facing attack surface."

### Application to Serenity Blocks
- Baseline (isolation/sandbox/CSP-via-onHeadersReceived/nav-blocking) is **already implemented** — keep it under regression test.
- **Fix:** drop Google Fonts origins from the packaged CSP and self-host the fonts (the game must work fully offline anyway; a paid game phoning Google on boot is also a privacy-policy line item).
- **Verify:** confirm the `onHeadersReceived` CSP actually attaches to the packaged `file://` document load (DevTools → the CSP violation test); official docs recommend the `<meta>` tag for `file://` — add it to `index.html` at build time as belt-and-braces, or migrate to a custom `app://` protocol (also permanently kills the absolute-path class of bugs recorded in project memory).
- **Audit:** every `ipcMain` handler in `electron/main.js`/`steam-integration.js` should validate `event.senderFrame` (main window's frame only). The Steam bridge (P2P send/receive, lobby ops) is the highest-value target.
- **Add:** `@electron/fuses` in `afterPack` (`runAsNode` off, `nodeCliInspect` off, asar integrity on). Cheap tamper resistance for a paid product; note `onlyLoadAppFromAsar` is compatible with `asarUnpack` (unpacked files are still resolved through the asar).

### Pitfalls
- steamworks.js's README tells you to set `contextIsolation: false, nodeIntegration: true` — **do not**. Keep the native module in the main process and bridge over IPC (this repo already does it right).
- Sandbox `true` means the preload can only use the bundled subset (`ipcRenderer` etc.) — no `require` of arbitrary Node modules in preload.
- Fuses + asar integrity will break dev workflows that patch files inside a packaged build; only flip fuses on release builds.

---

## 2. electron-builder packaging for Steam

### asar vs asarUnpack vs extraResources for 256 MB of music
- electron-builder packs `files` into `app.asar` by default. asar is a single concatenated archive; adding/replacing one file shifts every byte after it.
- `asarUnpack` keeps the **same virtual paths** — "Files in app.asar.unpacked/ are accessible via the same paths as if they were in the ASAR — Electron transparently redirects reads" — so `asarUnpack: ["dist/assets/music/**"]` moves the music to loose files on disk **with zero renderer code changes** (the `./assets/music/...` relative fetches keep working).
- electron-builder auto-unpacks native modules/executables; manual `asarUnpack` is only for "unusual cases" — a 256 MB media payload is exactly such a case. electron-vite's guidance: put large assets where they can be excluded from the asar entirely.

**Why this matters on Steam specifically:** SteamPipe chunks depot files into ~1 MB blocks and delta-patches per file: "only changing the modified portions of existing content files. When this content is updated, only these deltas need be sent." Valve's patch-minimization rules: "Ensure asset changes are localized within the pack file", "Avoid shuffling asset ordering", keep pack files to "one or two gigabytes", and "consider adding new pack files for updates instead of modifying existing ones." A ~600 MB `app.asar` containing music is a worst case: add one song or fix one JS file → asar contents shift → SteamPipe sees hundreds of changed 1 MB chunks → players re-download a large fraction of the game for a one-line patch. With music unpacked, a gameplay patch touches only the (now ~20–40 MB) asar, and a new song is one new loose file.

### Steam depot ≠ NSIS installer
Steam depots take **installed raw files**, not installers. The Steamworks upload docs treat retail installer discs as a separate, legacy flow (`build_installer`). Practice: add a `dist:steam` script that runs `electron-builder --win dir` and upload `release/win-unpacked/` as the depot content root. Keep the NSIS target only for non-Steam channels (itch.io, direct sales). Steam handles install, shortcuts, uninstall, redistributables (none needed for Electron), and updates.

### Differential updates: confirmed irrelevant on Steam
- electron-updater's blockmap differential download exists for self-hosted NSIS updates — and performs poorly there anyway ("after comparing blockmaps from two versions, 97% of the data is different … the compression done by the installer destroys the benefits", electron-builder #6265).
- On Steam it is moot **and** contra-policy: Valve — "It is important that you use Steam to handle your updates, and do not require users to download content inside your game after it has launched." Do not ship electron-updater/auto-update code paths in the Steam build; SteamPipe's manifest/chunk system is the delta mechanism.

### Code signing: OV vs EV vs Azure Trusted Signing (Artifact Signing), SmartScreen
- **SmartScreen policy changed in 2024:** "EV certificates previously bypassed SmartScreen entirely on first download … that behavior was removed in 2024, and EV-signed files now go through the same reputation-building process as OV." Paying the EV premium ($400+/yr) solely for SmartScreen is no longer justified (Microsoft Q&A + SmartScreen docs).
- **Azure Trusted Signing** (renamed Azure Artifact Signing): $9.99/month Basic (5 000 signatures), short-lived certs, reputation tied to your validated identity rather than one cert. electron-builder supports it natively via `win.azureSignOptions` (endpoint, codeSigningAccountName, certificateProfileName, publisherName) with Azure env-var credentials; note "Options for usage with signtool.exe cannot be used in conjunction with azureSignOptions."
- **Timestamping is non-negotiable with Trusted Signing:** its certificates are valid for only ~3 days, so an un-timestamped signature expires with the cert days later; with an RFC 3161 timestamp the signature stays valid indefinitely (textslashplain "Authenticode in 2025"). electron-builder timestamps by default — never disable it.
- **EU/Sweden eligibility caveat:** organizations in the EU are eligible; **individual/self-employed developers are currently limited to USA/Canada**. A Swedish sole trader without a registered company may need a classic OV cert from Certum/SSL.com/Sectigo (cloud-signing or USB token — CA/B Forum rules since June 2023 require keys in hardware/HSM, so "just a .pfx file" no longer exists).
- **Steam nuance:** files installed by the Steam client don't carry Mark-of-the-Web, so SmartScreen effectively doesn't gate the Steam-delivered build. Signing still matters for: the direct-download NSIS installer (full SmartScreen exposure), AV false-positive reduction (Electron games are heavily flagged unsigned), and crash-server symbol trust. Verdict: sign everything, but signing is a launch-window task for the *direct* channel, not a Steam blocker.

### Pitfalls
- Don't `asarUnpack` and *also* keep the music duplicated via `extraResources` — pick one; `asarUnpack` is the zero-code-change option here.
- If you ever restructure paths inside the asar, expect a one-time large Steam patch — batch such changes.
- electron-builder's default NSIS compression is why the installer is 619 MB "compressed" — MP3 doesn't recompress; after the Opus migration (§7) the installer shrinks for free.
- `signtoolOptions` in this repo currently configures only the hash algorithm — there is no certificate wired up yet; unsigned NSIS + SmartScreen means "Windows protected your PC" for every direct-download customer.

---

## 3. steamworks.js ecosystem + steam_appid.txt handling

### Ecosystem state
- **greenworks is dead**: "as of 2022, Greenworks has no active maintainer and is no longer in active development"; forks (greenworksjs, arm64 fork) are best-effort. This project already migrated to steamworks.js for the P2P MP stack — correct call.
- **steamworks.js** (ceifa): Rust (napi-rs) implementation, actively maintained, prebuilt binaries from npm ("you don't have to build anything"), TypeScript definitions, promise-based API. Init: `steamworks.init(appId)` or omit and use `steam_appid.txt`. Overlay: `electronEnableSteamOverlay()` (appends the `in-process-gpu` / direct-composition switches). Production: "copy the relevant distro files from `sdk/redistributable_bin/{YOUR_DISTRO}` into the root of your build" (steam_api64.dll next to the exe).
- Known repo constraint (project memory): steamworks.js 0.4.0 lacks `matchmaking.getLobbyFromId()`/`leaveLobby()` — pin the version you validated; treat upgrades as multiplayer-regression events.

### steam_appid.txt: dev vs release (Steamworks docs are explicit)
- Purpose: when launching the exe directly (not via Steam), "create a text file called steam_appid.txt next to your executable containing just the App ID … This overrides the value that Steam provides."
- Release: **"You should not ship this with your builds."** When players launch via Steam, the client provides the App ID via environment (`SteamAppId`); the file is a dev-only override that additionally bypasses the launched-through-Steam check.
- Companion API: `SteamAPI_RestartAppIfNecessary` "checks if your executable was launched through Steam and relaunches it through Steam if it wasn't" — the standard soft ownership check ("you should quit your process as soon as possible" when it returns true). Unnecessary only if you use the Steam DRM wrapper.

### Steam DRM wrapper: skip it for Electron
Valve's own docs describe the DRM wrapper as basic obfuscation that is "easily removed by a motivated attacker", explicitly unsupported for managed (.NET) executables, and conflict-prone with other exe-level protection. An Electron game is a worse fit still: the wrapped exe is the generic Electron binary, exe mangling invalidates the Authenticode signature you just paid for, and integrity fuses (§1) already cover app-code tampering. Valve's recommended alternative is exactly the plan above: `RestartAppIfNecessary` as the ownership check, plus making the legitimate copy more valuable through Steamworks features (multiplayer, achievements, cloud saves) — which pirated copies lose. For this game the Steam P2P multiplayer *is* the DRM.

### Application to Serenity Blocks
- **Bug to fix:** `package.json` → `build.extraFiles` copies `steam_appid.txt` into **every** packaged build root. Shipping it to the Steam depot means any customer can launch the raw exe outside Steam with the dev App ID semantics, and Valve explicitly says not to ship it. Fix options (either):
  1. Remove the `extraFiles` entry; call `steamworks.init(APP_ID)` with the real App ID hardcoded (steamworks.js supports explicit init — no file needed in dev either as long as Steam client is running), or
  2. Keep the file for dev packaging but add a Steam-depot preparation step (or a `steam` build variant) that deletes it from the depot content root before `run_app_build`; make the depot filemapping exclude it (`FileExclusion "steam_appid.txt"` in the depot VDF).
- Add `restartAppIfNecessary(appId)` (exposed by steamworks.js) as the first thing in `main.js` for the Steam build; gate it off in dev.
- `electron/steam-integration.js` already loads steamworks.js from `extraResources` in the main process with retry — keep that pattern; never expose the raw client to the renderer.

### Depot upload via steamcmd (scriptable CI)
From the SDK's `tools/ContentBuilder`: `builder/steamcmd.exe`, `content/`, `output/`, `scripts/`. An `app_build.vdf` names `AppID`, `Desc`, `ContentRoot` (point it at `release/win-unpacked`), `BuildOutput`, and a `Depots` map; run with:
`steamcmd.exe +login <account> +run_app_build ..\scripts\app_build.vdf +quit`.
Useful knobs: `Preview` (dry run), `SetLive "beta"` (auto-publish to a branch). Valve's release flow: push to a password-protected beta branch, verify the packaged game launches through Steam (overlay, P2P invites), then flip the default branch in the partner site. Use a dedicated Steamworks build account with limited permissions for CI credentials.

### Pitfalls
- steamworks.js README's `contextIsolation: false` advice — already covered; ignore it.
- Steam Overlay in Electron requires the GPU switches *before* app ready; `electronEnableSteamOverlay()` placement matters, and overlay + WebGPU on this project's iGPU should be smoke-tested early (project has TDR history).
- Forgetting `steam_api64.dll` in the packaged root = init failure only in production, invisible in dev (dev resolves from `node_modules`).
- The default branch flip is manual in the partner UI by design (Valve requires it for the first release); don't try to fully automate going live.
- **Linux target caveat:** the Steam Linux Runtime lacks libcups, which Chromium (and therefore Electron) links against — Electron apps fail inside the runtime container (ValveSoftware/steam-runtime#579). The current AppImage target is fine for direct distribution, but the Steam Linux depot must be tested inside the actual Steam Runtime (or scoped out of the launch platforms) — don't assume the working AppImage transfers.

---

## 4. Crash reporting

### Options
- **Electron built-in `crashReporter`**: uses **Crashpad** ("Electron uses Crashpad, not Breakpad", same upload protocol), submits minidumps to any Breakpad-protocol server — self-hosted **Socorro**/mini-breakpad-server, or commercial **BugSplat / Backtrace / Bugsnag / Sentry**. Started in the main process it covers all child processes. `uploadToServer: false` lets you collect locally and upload only with consent. Extra params: keys ≤ 39 bytes, values ≤ 127 bytes.
- **Sentry Electron SDK** (`@sentry/electron`): wraps crashReporter/Crashpad *plus* JS errors with breadcrumbs, release health, source-map symbolication of renderer stacks. Minidumps upload "when the application restarts (or immediately after a renderer crash)". Privacy: "Sentry does not store these memory dumps. Once processed, Sentry immediately deletes them and strips all sensitive information from the resulting Issues." Offers **EU data residency on every plan (incl. free Developer)** — data hosted in the EU region.
- **BugSplat**: game-industry-focused, first-class Electron/Crashpad support, "SOC-2 and GDPR compliant"; a good alternative if you want crash-only (no telemetry-ish breadcrumbs) with strong game tooling.

### GDPR / consent posture (Sweden/EU developer)
- Minidumps are personal-data-risky by nature: "memory snapshots … may contain sensitive information, such as environment variables, local path names, or even in-memory data from input fields" (Sentry docs). Usernames appear in file paths on Windows.
- Defensible posture for a paid single-purchase game: crash reporting under **legitimate interest** (Art. 6(1)(f)) *is argued by many vendors*, but the low-friction, low-risk answer for an indie: **ask at first run** (one dialog: "Send anonymous crash reports? [Yes/No]"), store the choice, expose a settings toggle, default the Sentry SDK to `sendDefaultPii: false` (its default), and wire `uploadToServer`/SDK enablement to the stored consent. Scrub in `beforeSend` (strip paths, no Steam ID). Document it in the privacy policy linked on the Steam store page.
- Choose **Sentry EU region** at project creation (cannot be a retrofit) or BugSplat with a DPA; avoids the transatlantic-transfer analysis entirely (otherwise you're relying on the EU-U.S. Data Privacy Framework).

### Application to Serenity Blocks
- Recommendation: `@sentry/electron` with EU region, opt-in dialog at first launch, `release` set to the Steam BuildID/app version so crash trends map to depot builds, upload of Vite source maps for renderer symbolication, and `beforeSend` scrubbing (drop `event.user`, normalize file paths). Native crashes matter here: WebGPU/driver TDRs are a known real-world failure mode on player hardware — GPU-process minidumps are exactly what you need to triage theme-specific driver crashes.
- Attach non-PII context: theme id, graphics quality tier, `app.getGPUFeatureStatus()` renderer string — all within crashReporter's 127-byte value limit if using raw crashReporter.
- Budget alternative: raw `crashReporter` → BugSplat free tier; you lose JS breadcrumbs and release health.

### Pitfalls
- Sentry's default is to include "event metadata, including user information and breadcrumbs" — breadcrumbs can capture console logs containing player paths; configure `maxBreadcrumbs`/scrubbing.
- Renderer crash ≠ JS error: a WebGPU device loss can kill the GPU process without any JS exception — test that the minidump path actually fires (Electron's `process.crash()` test hook).
- Don't enable Sentry tracing/session replay in a game; it's telemetry you'd need separate consent for, and replay is meaningless on a canvas.

---

## 5. Supply-chain hygiene

### Context
2025 was the worst year on record for npm: the Sept 2025 hijack of `chalk`/`debug` (~2.6 B weekly downloads combined) and self-replicating worm campaigns hit exactly the transitive-dependency layer Electron apps bundle into a signed, auto-trusted desktop binary. For a game, a compromised dependency = malware shipped to paying customers under your signature and Steam's distribution.

### Practices → application
1. **Lockfile discipline**: commit `package-lock.json`; CI and release builds use `npm ci` only (fails on lockfile drift). Never build a depot from a machine that ran bare `npm install`/`npm update` that day.
2. **`ignore-scripts`**: set `ignore-scripts=true` in `.npmrc` to neuter install-time payloads (the dominant attack vector). This project's native deps (steamworks.js, koffi) ship **prebuilt** binaries — verify the app still packages correctly with scripts disabled, and run any genuinely-needed postinstalls explicitly.
3. **Update cooldown**: configure Dependabot (or Renovate `minimumReleaseAge`) with a 7–14 day delay; hijacked versions are typically yanked within days. Dependabot alerts = on, auto-merge = off for prod deps.
4. **Audit gates**: `npm audit --omit=dev --audit-level=high` in CI as a soft gate; **socket.dev** (free for public repos, has a GitHub app) adds behavioral detection (new install scripts, network access, obfuscation) that `npm audit` structurally cannot.
5. **SBOM**: `@cyclonedx/cyclonedx-npm` — "probably the most accurate, complete SBOM generator for npm-based projects" — `npx @cyclonedx/cyclonedx-npm --omit dev --output-file sbom.json` in every release CI run; store next to the depot build artifacts (and optionally submit to GitHub's dependency-submission API so Dependabot scans the *built* tree). CycloneDX + SPDX are the two accepted machine-readable formats.
6. **Electron-specific**: minimize *production* dependencies (main-process deps run with full OS privileges); pin exact Electron version; treat `koffi` (arbitrary FFI!) and `steamworks.js`/`ez-steam-api` prebuilt `.node`/`.dll` binaries as the crown jewels — pin exact versions, and record their hashes so a registry re-publish is detectable. The Fuses from §1 (`runAsNode` off) also close the "use the shipped game as a Node interpreter" post-install attack.
7. **Dev/prod separation**: `vite`, capture scripts, MCP tooling etc. must be `devDependencies` so `--omit=dev` audits and the SBOM reflect what actually ships inside the asar.

### Pitfalls
- `npm audit` on the full tree drowns you in dev-only advisories — always `--omit=dev` for ship decisions.
- SBOM from `package.json` alone is junk; generate from the lockfile-installed tree in CI.
- electron-builder itself and its NSIS toolchain are build-time supply chain — pin them too.

---

## 6. Telemetry / analytics with EU privacy compliance

### The practice
- GDPR applies regardless of studio location if EU players are processed; as a Swedish developer under IMY jurisdiction it's unavoidable. Analytics/telemetry requires **freely-given, informed, opt-in consent** — bundled/forced consent is the pattern EU regulators keep striking down in gaming (2025 cases involving Ubisoft/Nintendo/2K show enforcement attention on games specifically). GameAnalytics' own compliance guidance: clear opt-in/opt-out at first launch, no negative consequences for refusing, collect only what a specific purpose needs, disclose immediately before the consent ask, and collect nothing before consent.
- Privacy-by-design for an indie: prefer **no third-party analytics at all**. Steam already gives you the high-value funnel for free (wishlists, sales, playtime, review sentiment, hardware survey) with zero GDPR surface on your side.

### Application to Serenity Blocks
- Recommended tiering:
  - **Tier 0 (ship this):** no analytics SDK. Steamworks partner stats + reviews + crash reports (§4, separate consent) cover a solo dev's actual decisions.
  - **Tier 1 (if design questions demand it):** self-describing, anonymous, opt-in gameplay events (theme usage, mode completion, session length) to your own EU-hosted endpoint; random install UUID, never the Steam ID; consent dialog shared with the crash-report dialog but as a **separate checkbox** (crash ≠ analytics purposes; GDPR consent must be granular).
  - Keep a kill switch: consent revocation in settings stops collection immediately.
- Steam store page: fill in the privacy policy link; enumerate: crash reports (opt-in, processor = Sentry EU / BugSplat), P2P multiplayer (Steam IDs exchanged between peers via Valve's infrastructure — covered by Steam's own terms, but disclose), no other collection.
- P2P note: Steam IDs and lobby data are personal data; since transport is Valve's SDK you're not adding a processor, but your privacy policy should say match data is peer-to-peer and not stored by you.

### Pitfalls
- "Anonymous" telemetry that includes a Steam ID or persistent hardware fingerprint is not anonymous — it's pseudonymous personal data, fully in GDPR scope.
- Consent walls ("accept analytics to play") violate the freely-given requirement.
- If you later add GameAnalytics/Unity-style SDKs, you inherit their SDK's data flows — read their developer DPA and configure EU endpoints; don't initialize the SDK before consent.

---

## 7. Audio codec & packaging (256 MB of music)

### The practice
- **Opus** (Xiph, RFC 6716, royalty-free) is the successor to Vorbis and beats it and MP3 at every bitrate in published listening tests: "multi-format stereo music listening tests have demonstrated the superiority of Opus at 64 kbps and 96 kbps compared to the best AAC-LC, HE-AAC and Ogg Vorbis encoders, and at 96 kbps also to 128 kbps MP3" (opus-codec.org / Hydrogenaudio). At **128 kbps stereo Opus is effectively transparent in ABX testing** for the vast majority of listeners/material; 160 kbps is a safe archival-grade ceiling for ambient/electronic game music.
- Decode cost: Opus decode is marginally heavier than Vorbis, both trivial on desktop CPUs (this matters on embedded, not on a machine running WebGPU compute shaders). Chromium (hence Electron) decodes Opus-in-Ogg natively in `<audio>`/`fetch`+WebAudio — no decoder library to ship.
- **Playback architecture beats codec choice for memory**: `decodeAudioData` expands the *entire track* to Float32 PCM (~10 MB per stereo minute at 44.1 kHz — a 5-minute track ≈ 50 MB RAM). Music must stream via `HTMLAudioElement`/`MediaElementAudioSourceNode` (decode-on-the-fly, constant memory); reserve WebAudio buffers for short SFX.

### Application to Serenity Blocks
- Current: 36 MP3s = 256.2 MB (~7.1 MB/track average → these are high-bitrate MP3s). Re-encode to **Opus in Ogg, VBR ~128–160 kbps** (`ffmpeg -i in -c:a libopus -b:a 144k out.ogg` batch): expected **~100–130 MB total, a 50–60 % cut** — the depot, the NSIS installer (MP3/Opus don't NSIS-compress), download times, and disk footprint all shrink accordingly. The 619 MB installer likely drops near ~450 MB from this change alone.
- **Encode from the original masters, not from the MP3s** — lossy→lossy transcoding compounds artifacts. If tracks were AI-generated/purchased, re-export or fetch lossless sources; if only the MP3s exist, either keep MP3 (Chromium plays it fine) or accept a cautious 160–192 kbps Opus transcode after A/B listening on a few dense tracks.
- Update `songs.json` manifest + any extension assumptions; keep relative `./assets/…` URLs (project memory: absolute paths break packaged Electron).
- Combine with §2: keep music **out of the asar** (`asarUnpack: ["dist/assets/music/**"]`) so each track is an independent SteamPipe delta unit and future song additions patch as pure new content ("adding new pack files for updates instead of modifying existing ones").
- SFX: short one-shots can stay/become Opus too, decoded to buffers at load; total SFX payload is small so codec choice there is about consistency, not size.

### Pitfalls
- Opus is always 48 kHz internally — irrelevant for playback, but don't be surprised by resampled output metadata.
- Very low bitrates (<96 kbps) on ambient pads can exhibit HF smearing; validate the game's quietest ambient tracks specifically, not just the energetic ones.
- Gapless looping: MP3 has encoder padding (gaps at loop points); Opus/Ogg handles gapless correctly — a hidden quality *win* for looping music, but re-check any hand-tuned loop-point offsets after transcode.

---

## Prioritized action list (highest leverage first)

1. **Stop shipping `steam_appid.txt`** in release/depot builds (`extraFiles` in package.json); init steamworks.js with an explicit App ID + add `restartAppIfNecessary` in the Steam build. (§3)
2. **Move music out of app.asar** via `asarUnpack: ["dist/assets/music/**"]` — zero code change, unlocks per-track SteamPipe deltas, avoids full-game re-downloads on every patch. (§2)
3. **Transcode 36 MP3s → Opus 128–160 kbps VBR** from masters: ~50–60 % size cut (256 MB → ~100–130 MB). (§7)
4. **Add a `dist:steam` pipeline**: `electron-builder --win dir` → upload `release/win-unpacked` via `steamcmd +run_app_build` to a beta branch; NSIS stays for non-Steam channels only; no electron-updater in the Steam build. (§2, §3)
5. **CSP hardening**: self-host fonts, drop Google origins from packaged CSP; verify header injection on `file://` or add the `<meta>` CSP / migrate to a custom protocol. (§1)
6. **IPC sender validation audit** across the Steam bridge handlers; add Electron Fuses (`runAsNode` off, `nodeCliInspect` off, asar integrity on) in `afterPack`. (§1)
7. **Crash reporting**: Sentry Electron SDK, EU region, opt-in first-run dialog, `beforeSend` scrubbing, release = app version/BuildID. (§4)
8. **Supply chain**: `npm ci` + `ignore-scripts` in CI, Dependabot with cooldown, socket.dev, CycloneDX SBOM per release, pin steamworks.js/koffi exactly. (§5)
9. **Code signing**: Azure Trusted Signing if operating as an EU-registered org ($9.99/mo, `win.azureSignOptions`); otherwise OV cloud-signing cert — required for the direct-download NSIS channel, lower priority for the Steam-only build. EV no longer buys SmartScreen bypass. (§2)
10. **Telemetry**: skip third-party analytics; Steam partner stats + opt-in crash reports; privacy policy on the store page covering crash reports and P2P Steam-ID exchange. (§6)

---

## Sources

### Electron security
- Electron Security Tutorial (official 20-point checklist, CSP/onHeadersReceived/file:// note, IPC sender validation) — https://www.electronjs.org/docs/latest/tutorial/security
- Context Isolation (official) — https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Process Sandboxing (official; preload privilege warning) — https://www.electronjs.org/docs/latest/tutorial/sandbox
- Electron Fuses (official) — https://www.electronjs.org/docs/latest/tutorial/fuses

### Packaging / electron-builder
- electron-builder Application Contents (files/asarUnpack/extraResources) — https://www.electron.build/docs/contents/
- asarUnpack transparent-path behavior + large-file guidance (electron-vite distribution guide) — https://electron-vite.org/guide/distribution
- "ideally you shouldn't asar anything which needs to be asarUnpack" (electron-builder #2290) — https://github.com/electron-userland/electron-builder/issues/2290
- NSIS differential updater ineffectiveness (electron-builder #6265) — https://github.com/electron-userland/electron-builder/issues/6265
- electron-builder Windows code signing incl. `azureSignOptions` — https://www.electron.build/code-signing-win
- Azure Trusted Signing with electron-builder on GitHub Actions (field guide, config fields) — https://hendrik-erz.de/post/code-signing-with-azure-trusted-signing-on-github-actions
- Azure Artifact Signing product/pricing — https://azure.microsoft.com/en-us/products/artifact-signing
- Code signing on Windows with Azure Trusted Signing (Melatonin; eligibility, reputation model) — https://melatonin.dev/blog/code-signing-on-windows-with-azure-trusted-signing/
- Microsoft: SmartScreen reputation for app developers (EV no longer special) — https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Microsoft: Code signing options for Windows app developers — https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- textslashplain: Authenticode in 2025 — Azure Trusted Signing (3-day cert validity; timestamping criticality) — https://textslashplain.com/2025/03/12/authenticode-in-2025-azure-trusted-signing/
- Trusted Signing open to individual developers (US/Canada only, public preview) — https://techcommunity.microsoft.com/blog/microsoft-security-blog/trusted-signing-is-now-open-for-individual-developers-to-sign-up-in-public-previ/4273554

### Steamworks
- Uploading to Steam (ContentBuilder, app_build VDF, run_app_build, 1 MB chunk deltas, patch-minimization rules, pack-file guidance) — https://partner.steamgames.com/doc/sdk/uploading
- Steamworks API Overview (steam_appid.txt: "You should not ship this with your builds"; RestartAppIfNecessary) — https://partner.steamgames.com/doc/sdk/api
- Updating Your Game — Best Practices ("use Steam to handle your updates"; beta branches; cadence) — https://partner.steamgames.com/doc/store/updates
- Steam DRM (wrapper limitations; RestartAppIfNecessary + Steamworks features as the recommended alternative) — https://partner.steamgames.com/doc/features/drm
- steamworks.js (ceifa) README (init, overlay, redistributables, insecure contextIsolation advice to avoid) — https://github.com/ceifa/steamworks.js/
- steamworks.js overlay issues (repaint/flags caveats) — https://github.com/ceifa/steamworks.js/issues/97 and https://github.com/ceifa/steamworks.js/issues/102
- greenworks (unmaintained status) — https://github.com/greenheartgames/greenworks
- Electron apps can't run in the Steam Linux Runtime (libcups) — https://github.com/ValveSoftware/steam-runtime/issues/579

### Crash reporting
- Electron crashReporter API (Crashpad; Socorro/BugSplat/Backtrace/Sentry-compatible; uploadToServer; param limits) — https://www.electronjs.org/docs/latest/api/crash-reporter
- Sentry Electron Native Crash Reporting (minidump lifecycle, deletion after processing, sensitivity warning) — https://docs.sentry.io/platforms/javascript/guides/electron/features/native-crash-reporting/
- Sentry: Scrubbing Sensitive Data for Electron (sendDefaultPii, beforeSend) — https://docs.sentry.io/platforms/javascript/guides/electron/data-management/sensitive-data/
- Sentry EU Region FAQ (EU data residency on all plans) — https://sentry.zendesk.com/hc/en-us/articles/25074658211227-Sentry-s-EU-Region-FAQ
- BugSplat for Electron (SOC-2/GDPR) — https://www.bugsplat.com/platforms/cross-platform/electron/

### Supply chain
- CycloneDX/cyclonedx-node-npm (SBOM generator) — https://github.com/CycloneDX/cyclonedx-node-npm
- Supply Chain Security for Node.js: lockfile integrity, SBOM, auditing in CI/CD — https://letsbuildsolutions.com/blog/devops/supply-chain-security-for-nodejs-lockfile-integrity-sbom-generation-and-dependency-auditing/
- npm Supply Chain Attacks 2026 defense guide (Sept 2025 chalk/debug hijack, cooldowns, ignore-scripts) — https://bastion.tech/blog/npm-supply-chain-attacks-2026-saas-security-guide

### Telemetry / GDPR
- GameAnalytics: GDPR compliance steps for games (opt-in, granularity, minimal collection) — https://www.gameanalytics.com/blog/gdpr-game-compliant
- heyData: Gaming GDPR 2025 enforcement cases — https://heydata.eu/en/magazine/gaming-gdpr-risks-are-rising-and-these-2025-cases-prove-it

### Audio
- Opus codec comparison (listening tests vs Vorbis/AAC/MP3) — https://opus-codec.org/comparison/
- Hydrogenaudio Opus knowledgebase — https://wiki.hydrogenaudio.org/index.php?title=Opus
- Xiph: Opus Recommended Settings (bitrate guidance) — https://wiki.xiph.org/Opus_Recommended_Settings
- Comparison of audio formats for games (dev.to overview) — https://dev.to/tenry/comparison-of-audio-formats-for-games-jak
