# Keyboard and controller: bindings that hold up, menus on every input (2026-10)

**Status:** Reference (record of shipped work, 2026-10-26). Owner's ask: "ensure the
keybindings for the keyboard and game controller hold up! And should we be able to navigate
with the keyboard in all menus as well?" The answer to the second part is yes: every menu
now answers the arrow keys the way it answers the D-pad, and Space, Enter and Escape do what
a player expects there.

## 1. How it was checked

- Two read-only code audits: every DOM menu surface for keyboard use (open and close, focus
  in, Tab trap, focus return, arrows, Enter/Space, shortcuts that leak through), and every
  controller path (bindings, mapping, slots, stuck and double input, every mode, menus).
- The real game in Electron, driven by real key events (`sendInputEvent`) and a simulated
  standard-mapping pad (`navigator.getGamepads` stubbed in the page), logging the focused
  element after every press: the main menu and dock, Records, Settings (tabs, content,
  toggles, dropdowns), the pause sheet, Local Versus setup, the Serenity Hub, Serenity Mode,
  Single Player play, game over. Before and after.

## 2. Keyboard bindings

| Defect | Fix |
|---|---|
| Letter bindings were matched by exact `KeyboardEvent.key`: with Caps Lock on, `z` (rotate left), `a` (flip) and all of Player 2's WASD did nothing. | `src/ui/binding-keys.js`: one rule for storing and comparing a bound key (letters in lower case, `Space` by name). controls.js, Settings and the Infinity look use it. |
| A key released while Shift was down (Player 2's hard drop) sent `A` on keyup, which matched nothing: the latch stayed and the piece kept sliding until A was pressed again. | `InputController.heldKeyCodes`: the keyup releases what its physical key (`code`) pressed. |
| Player 1's flip (A) is Player 2's move left: in Local Versus one press moved both pieces; against a bot Player 2's keys moved the bot. | Player 2's keys play only while a person is on seat 2 (`isPlayer2KeyboardActive`, `src/ui/keyboard-game-probes.js`); a key both have bound plays for Player 2 there. |
| The bot seat took a human's soft drop (S, a second pad's down). | `LocalMultiplayerMode._setupInputWrappers` guards soft drop like the others (now one loop over the five inputs and four players). |
| A rebind to a key another action uses was refused without a word; Caps Lock at capture stored `Z`; Tab, Caps Lock, Alt and dead keys could be bound; the held Enter that opened a capture could bind itself. | The two actions swap keys (the other tile lights for a moment), keys are stored normalised, unbindable keys keep the old binding, repeats are not answers. Saved sets are repaired on load (one key per action). |

## 3. Controller

| Defect | Fix |
|---|---|
| The Serenity Hub opened from a menu (Select on the main menu or over Settings) left the pad dead: Serenity's input returned early whenever menu navigation was on. | It returns early only while the Hub is closed. B in the Hub closes only the Hub (the menu buttons are latched as it closes). |
| The press that restarted from game over acted in the new run: Start reopened Settings, A/X/Y rotated. | `latchAllHeld`: everything held waits for its release, into whichever owner comes next. |
| Presses made while the window was in the background (alt-tab) played and closed the pause sheet. | `poll()` does nothing while `document.hasFocus()` is false (held input lets go) and latches what is still held on return. |
| Stick deadzone per axis: left and a little down moved and soft-dropped; a diagonal in a menu moved twice; a saved deadzone of 0 let drift play. | `stickAxisValue`: a round deadzone and only the stronger axis; the deadzone is clamped to 0.1-0.9. |
| No hold-to-repeat in menus (the repeat settings were declared but unused). | `menuDirectionFires`: once on the press, then 420 ms / 180 ms, as on the Odyssey map and the Stillfall atlas; a latched direction never repeats. |
| Menus answered controller 1 only: a second player's Start paused the match but could not resume it. | Every pad drives menus; one press reported by two pads within 60 ms is one press (`claimMenuAction`; Steam Input can show one pad twice). |
| On the first main-menu visit the pad walked only the mode list: Play, Records, Replays and the dock were out of reach. | D-pad right goes to Play, the dock is reached spatially, A presses the focused control, B goes back to the list. |
| LB/RB in Settings left focus on the old tab or on nothing. | Focus follows the new tab. |
| The local-setup dropdowns (bot skill, handicap, team) opened with A but the D-pad moved focus off them. | An open dropdown takes the pad: up/down walk its options, A chooses, B closes it. Hidden native selects behind the enhanced controls are no longer focus targets (`FOCUSABLE_SELECTOR`). |
| Stillfall: LB undid a piece and also changed the theme; its HUD buttons ignored rebinding. | The theme stepper leaves the pad's shoulders to Stillfall; its HUD skips buttons bound to game controls. |
| Gameplay pad bindings were taken as saved (a negative or fractional index killed an action; shared buttons played both). Rebinding refused conflicts silently, which made Serenity's pad bindings impossible to change (its defaults use all 16 buttons). A capture let Start, View or Home become a move, and the D-pad, LB/RB and Select still drove the menu while a tile listened. Escape could not cancel a pad capture. | Sanitised on load and update; swaps on conflict; View, Menu and Home stay menu buttons for game controls, and Pause takes only one of them (a swap would have handed Start to a move); a listening tile owns the pad; Escape cancels. |
| A pad without the standard mapping was used as if it had it. | The Settings status names it: "layout not recognised". (Remapping such pads is not attempted.) |

## 4. Menus on the keyboard

- **Arrows everywhere** (`src/ui/keyboard-menu-navigation.js`, installed with the sheet
  input in modals.js): inside the top sheet, the open multiplayer screen, the Serenity Hub
  and the main menu, the arrows move focus to the nearest control that way (the D-pad's
  rule). It runs last and only where nothing else took the key, so the mode list, tab
  strips, open option lists, the Odyssey navigator and the Stillfall atlas keep their own.
  Walking never changes a setting: up and down always move on, sliders and segmented
  toggles keep left and right, a closed dropdown opens with Enter, Space or Alt+Down
  (`cosmic-select.js`), and Enter turns a toggle.
- **Space and Enter press the focused control.** The hard-drop handler called
  `preventDefault` on Space everywhere a game wasn't over, so no button or checkbox on the
  multiplayer screens, the Odyssey map, navigator, charm guide and failure sheet, replay
  complete or the replay bar answered Space; Space on Records over the main menu started a
  game. Now a menu over the game owns its keys (`menuCoversGame`, sheet-input.js), and off
  play (`isGameplayLive`) a focused control keeps Space and Enter.
- **Escape closes one level.** The global handler ignores an Escape another handler took;
  sheets, multiplayer screens and the Odyssey cue keep theirs; Serenity Mode leaves on it
  again (it opened Settings); a held Escape no longer closes the pause sheet it opened;
  Odyssey's new-journey confirmation, results and finale, the breathing guide and the Hub's
  controls card no longer close a second layer.
- **Focus stays and comes back.** Tab is kept inside the multiplayer screens and the Hub,
  and focus returns to the control that opened them (or into the screen now on top). The
  lobby list keeps its focused row across refreshes.
- **Smaller:** online Tab (the scoreboard) only acts in a match, not over Settings, the
  lobby or results; Enter focuses the match chat (its id was wrong) unless a control has
  focus; on the Odyssey map Enter on the Chapters and Hub tiles no longer plays the orb; H
  and N stand aside over multiplayer screens and the Hale flow.

## 5. Tests and gates

New: `keyboard-bindings-hold-up`, `keyboard-menu-ownership`, `gamepad-menu-repeat`,
`gamepad-hold-up`, `local-multiplayer-bot-seat-input`. `settings-persistence-lifecycle`
binds L3 instead of Home (Home is now a menu button). Typecheck, TS ratchet (+3 files),
lint ratchet (at baseline), architecture fitness (main 5173 → 5120 lines with the dead
legacy Player 2 handler removed, LocalMultiplayerMode 2467 → 2435, core DOM globals
364 → 316, locked in), boundaries.

## 6. Open

- Hardware still owed: a real Xbox/PlayStation/Switch pad, Steam Input's duplicate pad, a
  non-standard pad, and the window-focus rule on a Steam Deck.
- The tower look (Infinity, tall Odyssey wells) has no keyboard keys; the invite toast is
  pointer-only; the host's Escape on online results returns everyone to the lobby without a
  confirmation (as designed, worth a look).
- Odyssey's own sheets still do not send `modalShown`/`modalHidden`, so focus is not handed
  back after them (the map needs no focus).
