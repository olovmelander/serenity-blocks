# One controller, the whole game (2026-11)

**Status:** Reference (record of shipped work, 2026-11-02). Owner's ask: "when having connected
an xbox controller we need to ensure we can use it everywhere in the game, we need to be able to
get to the settings menu by pressing the start button, navigate in all menus, get to the serenity
hub by pressing another button, maybe select, and really have a keybinding and implementation that
work in every part of the game, navigating and while playing. Like how do we scroll the infinity
minimap, how do we navigate to the serenity hub, how do we navigate in the menus and lobbies etc,
do a proper audit and set the correct keybindings so that the UX is best in class."

Builds on [INPUT_HOLD_UP_2026-10.md](INPUT_HOLD_UP_2026-10.md) (bindings that hold up, menu
hold-repeat, every pad in menus). Central code: `src/ui/gamepad-controller.js`.

## 1. The map: one meaning per button, everywhere

| Button | Everywhere | In play (falling blocks) |
|---|---|---|
| **Menu (☰, Start)** | Settings, which is also the pause sheet (Resume, Serenity Hub, Main menu, Quit). From the open Hub it hands over to Settings. Closes Settings again. | Same. Player 2–4's Menu pauses. |
| **View (Select)** | **The Serenity Hub, in every mode** (was: Serenity Mode only; elsewhere through Settings). Over Settings the Hub takes Settings' place. Closes the Hub again. *Stillfall:* its puzzle atlas (that mode's own overview); the Hub is Menu → Serenity Hub there. *Odyssey showcase lap:* Finish. | Same, unless the player bound a game control to View. |
| **A / B** | Choose / back, in every menu, sheet, lobby and the Hub. A Steam invite: A joins, B declines. | Rotate / hard drop (rebindable). |
| **D-pad, left stick** | Move focus; held, it repeats (menus *and now the Hub*). | Move, soft drop. |
| **LB / RB** | Tabs: Settings, the Hub, Records, the Odyssey chapters, the charm guide. Replays: speed. | Theme step (outside Serenity, Odyssey, Stillfall); Odyssey charms; Stillfall undo/restart. |
| **Right stick** | **Scrolls any menu** (new): the scroll area holding focus, else the nearest one. | Infinity and Odyssey tall wells: look around the tower. |
| **R3** | — | Infinity: look at once. **Online versus: the scoreboard** (Tab's twin, new). |
| **Y** | — | Rotate left. *Serenity Mode:* button hints (was View). |

**Serenity Mode** keeps its own rebindable layout (Settings → Controls → Serenity): X breathing,
LB/RB song, LT/RT volume, L3 random theme, R3 fullscreen, D-pad technique and world, A touch, B back.
Its `toggleHub` binding is the Hub's button in every mode, so one rebind moves it everywhere; a
binding that plays the game outside Serenity (an old Y) falls back to View there.

**Replays** (new, `src/ui/replay-pad-controls.js`): A play/pause, B stop, D-pad/left stick seek
5 s (held, it repeats), LB/RB speed, Menu and View pass through.

**Online spectators** (new, `src/ui/spectator-pad-controls.js`): D-pad ← → spotlight the previous
or next board (it was a mouse click on a mini-board).

The map is on screen where it is used: Settings → Controls → General ("On a controller,
everywhere"), the play rail (the Hub tile names View in every mode but Stillfall), the main menu's
hint row (View · Serenity Hub, pad only), Serenity's first-visit line and Y overlay (from the live
bindings), the replay bar, the invite toast, the Odyssey HUD's pause and charm lines, Infinity's
tower map and altimeter, the spectator hint.

## 2. How it was checked

- Two read-only audits of every surface against keyboard and mouse parity: multiplayer (local
  setup, lobby browser, create match, waiting room, results, chat, invites, the player card,
  spectating) and Odyssey / Stillfall / misc (map, navigator, charm guide, showcase, tower look,
  finale and result sheets, Stillfall's atlas and panel, intro, photosensitivity warning, replays,
  breathing guide, Serenity's tray and world bar, focus pause, cursor). Plus the core paths by
  hand: main menu, Settings, the pause sheet, the Hub, Serenity, Infinity, game over.
- Unit tests: `tests/unit/gamepad-controller-ux.test.js` (View→Hub in play, in menus, over
  Settings, not over lobbies, lazily before the Hub loads, the shared cooldown, the fallback; Start
  from the Hub; the Hub's hold-repeat and latch; Start held back by `data-blocks-settings`;
  right-stick scroll; invite answers and their latch; A on an unfocused lobby; R3; the layout
  migration, through `SettingsManager.load`) and `tests/unit/replay-spectator-pad.test.js`.

## 3. What changed

| Gap (found by the audit) | Fix |
|---|---|
| No pad button reached the Hub in play outside Serenity (the keyboard had H); in the main menu View worked only once the deferred Hub had loaded. | View (Serenity's `toggleHub`) opens the Hub in every mode (`processHubButton`, `processMenuHubButton`); before the Hub exists the app builds it and opens it (`SerenityBlocks.openSerenityHub`, also behind the Hub tile and the dock's button). One shared 500 ms cooldown. |
| Serenity used View for the hints and Y for the Hub, the opposite of the new rule. | Defaults swapped (Y hints, View Hub); a save still on the old default pair takes the new one once (`src/core/controller-layout.js`, `controllerLayoutVersion` 2, also applied to an older Steam Cloud keybinds copy). |
| Start did nothing while the Hub was open. | It hands the Hub over to Settings (`closeForSettings`: closed without resuming play, Settings opens in the same task). |
| The Hub's D-pad and stick took one press per card. | Held, they repeat at the menus' rate; a direction held from play waits for its release (`latchHubButtons`, `hubRepeat`). |
| Nothing scrolled a menu's text, tables or logs (results tables, Settings help, the URL parameters tab, chat logs, the waiting room's facts). | The right stick scrolls the open sheet and the main menu (`processMenuScroll`). |
| A pad user who accepted a Steam invite in the overlay had it time out (the toast could not be reached). | A joins, B declines wherever the pad is not playing; in play the toast says ☰ first (`processInviteToast`, `data-pad-answers`). |
| Replays: no pause, seek, speed or stop on a pad. | The replay bar owns the pad while it is up, with glyphs on its controls. |
| Start over a look around a tall Odyssey well (and the gear's click) opened Settings without ending the look, unlike Escape. | `pauseGame()`'s gear path and the Hub's `pauseGameOnly()` end the look first (`endExplorationForMenu`), as `openSettingsMenu()` does. |
| Start could open Settings mid-return to the Odyssey map (Escape is held there since 2026-10-23). | The return marks itself `data-blocks-settings` while it holds Escape; Start reads it. |
| A with nothing focused on a lobby screen pressed its first control: Leave. | The first A only places focus (the primary control, else the first). |
| Create match opened on its Match name field, which a pad cannot type. | On a pad it opens on Create match. |
| Online: the scoreboard was Tab only; a spectator chose a board by mouse only. | R3 toggles the scoreboard; the D-pad walks the spotlight. |
| Hints that named only keys: Infinity's "Drag to look" and "Scroll or drag", the Odyssey pause line and charm caption, the intro's "Press any key", Serenity's first-visit line, the spectator hint; Local Versus seats 1–2 showed keyboard keys to a pad player. | Each says what the controller does when one is the input (`.sb-when-pad` / `.sb-when-not-pad`, `data-pad` keycaps); seats show their controller's buttons when it is connected. |
| The cursor stayed over the menus while a pad drove them. | Hidden while the pad is the input; moving the mouse brings it back. |

## 4. Open (not done here)

- **Serenity's effects tray** (E) has no pad route: every Serenity pad button is taken. Candidates:
  a Hub entry, or holding a button. Owner's call.
- **Typing** (join by lobby ID, chat, match name): there is no in-game on-screen keyboard; on Steam
  Deck and in Big Picture, Steam's keyboard opens on a focused field. In-match chat opens on Enter
  only.
- **The main menu's player card** sits outside the menu's spatial navigation (its Steam friends
  action is on the pad's Guide button anyway; Retry is mouse-only).
- Keyboard-only conveniences without a pad twin: Home/End on the map, the navigator and the
  atlas; the charm guide's 1–4 jump; the map's auto-continue checkbox (it is on the journey-flow
  sheet); the tower map's click-to-jump (the stick covers it).
- The Odyssey arrival notes still say "Press 1–4 during an orb" (the HUD caption and tiles
  follow the pad).
- **Hardware pass:** run the real game with an Xbox pad through the map in §1 (each mode, each
  sheet, a lobby, a replay, an invite), as the 2026-10 pass did with a simulated pad.
