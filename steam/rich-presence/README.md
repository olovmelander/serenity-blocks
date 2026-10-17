# Steam Rich Presence tokens

`english.vdf` holds the lines a friend sees under your name in their Steam friends list
("Single Player · Level 7", "Online Versus · Waiting in a lobby (2/8)"). Steam shows the
`steam_display` key only as a `#token` defined in a file uploaded to Steamworks. Plain text
there shows nothing, which is why the game sends tokens
(`src/core/steam/rich-presence-manager.js`). The `status` key carries the same line as
plain text for Steam's game-info view.

**Upload (once, and again whenever a token changes):** Steamworks → the app → Edit Steamworks
Settings → Community → Rich Presence → upload `english.vdf` (UTF-8) → Publish. Check the
live result with Steam's Rich Presence tester (steamcommunity.com/dev/testrichpresence)
while the game runs.

Every token the game sends must exist here, and every `%key%` in a token must be a key the
game sets with it: `tests/unit/rich-presence-tokens.test.js` checks both.
