# Controls Settings UX Expansion Plan

## Goals
- Extend the Controls tab so players can configure up to four gamepads without overwhelming the interface.
- Elevate clarity and visual harmony so the modal matches Serenity Blocks' calm, neon-accented presentation.
- Simplify input rebinding and status feedback to reduce friction for both solo and multiplayer setups.

## Current Snapshot
- Gamepad support is limited to two dedicated sub-tabs and static connection labels for two controllers.
- Sub-tabs stack horizontally; once more sections are added they will wrap unpredictably on smaller widths.
- Key/gamepad rebinding widgets look similar to read-only labels, creating uncertainty about interactivity.
- Connection status lives in a single text block, making it hard to tell which pad the UI is referencing.

## Experience Principles
- **Planetarium calm**: Retain dark glass panels, soft glows, and emoji/icon accents to stay on-brand.
- **Glanceable grouping**: Keep actions grouped in 2×N grids so users scan categories quickly.
- **Progressive disclosure**: Hide advanced options until needed (e.g. expansion panels, accordions).
- **Responsive touchpoints**: Ensure larger hit targets and clear focus states for controller + keyboard nav.

## Proposed UX Enhancements

### 1. Navigation Layout
- Convert the control sub-tabs into a vertically stacked rail (left-aligned) that scrolls independently of content.
- Add compact badges (e.g. `● Connected`, `○ Awaiting`) next to gamepad tabs for real-time status.
- Group keyboard and gamepad tabs into labeled clusters with subtle dividers to reinforce hierarchy.

### 2. Content Structure
- Introduce framed sections with descriptive headers and short helper copy for each action cluster.
- For rebinding tiles, add a dedicated call-to-action state (`Press to bind`) with glow hover/focus feedback.
- Add context cards (“How rebinding works”, “Reset to defaults”) that users can collapse if desired.
- Surface multiplayer-specific tips (e.g. “Player 3 shares preview on right board”) in contextual info boxes.

### 3. Visual Styling
- Use consistent 12px corner radius and translucent panels to mirror other modal sections.
- Apply gradient highlight bars atop active sections (matching accent color palette already used in tabs).
- Add iconography (existing emoji or SVG) to section titles for quick recognition and visual rhythm.
- Maintain typography scale: headers at 18–20px, helper text 13–14px with 70% opacity to avoid glare.

### 4. Interaction Improvements
- Integrate toast/snackbar feedback when a binding succeeds or conflicts with another input.
- Provide a “Detect controller” action that pings the selected pad and briefly animates the tab badge.
- Offer a reset button per section to revert to defaults without affecting other players.
- Ensure focus order works seamlessly for keyboard, mouse, and gamepad navigation in the modal.

## Gamepad 3 & 4 Expansion Plan

### UI Additions
- Add two new sub-tabs: `🎮 Player 3 Gamepad` and `🎮 Player 4 Gamepad`, mirroring existing layout.
- Expand the gamepad status block to list up to four controllers with colored indicators matching each tab.
- Update tooltips/helper copy to reflect four-player naming (Player 3/4 or Spectator assignments if needed).
- Consider dynamic tab generation (loop over detected players) to avoid future hard-coding.

### Logic & Data Binding
- Extend the gamepad controller module to track four pads, exposing status events for UI badges.
- Update binding storage (localStorage / settings manager) to hold mappings for `gamepad3` and `gamepad4`.
- Ensure multiplayer scenes can reference new mappings when assigning inputs for additional players.
- Validate that disconnect/reconnect flows reassign the correct player slot and refresh status labels.

### Accessibility & Feedback
- Use distinct accent hues for each controller (e.g. teal, amber, violet, cyan) to help users differentiate players visually.
- Announce connection changes via ARIA-live region so screen-reader users stay informed.
- Provide conflict warnings if two pads try to occupy the same player slot with instructions for resolution.

## Implementation Roadmap
1. **Audit & Wireframe**
   - Capture screenshots of current modal states; draft low-fidelity sketches for vertical navigation and new sections.
   - Align with existing style tokens in `styles/main.css` and related modal stylesheets.
2. **Markup Refactor**
   - Restructure the Controls tab container into a two-column layout (nav rail + content area).
   - Introduce semantic grouping elements (`section`, `header`, helper text containers) for readability.
   - Add placeholder elements for badges, tooltips, and reset buttons.
3. **Styling Pass**
   - Update CSS to support new layout, responsive behavior, and interactive states (hover/focus/active).
   - Define utility classes for status badges and highlight bars that can be reused elsewhere.
4. **Gamepad Logic Extension**
   - Expand `GamepadController` (and related settings bindings) to handle pads 3 & 4 consistently.
   - Wire up tab badges/status text to controller events; ensure updates occur in the modal and HUD if applicable.
5. **Interaction Enhancements**
   - Implement rebinding feedback (toast/snackbar) and “detect controller” functionality.
   - Add per-section reset handlers and confirm they sync with persistence layer.
6. **QA & Polish**
   - Test keyboard/gamepad navigation order, resizing behavior, and controller hot-plug scenarios.
   - Verify settings persist across sessions and that multiplayer scenes honor new bindings.
   - Gather playtest feedback focused on discoverability and ease of configuring multiple pads.

## Dependencies & Considerations
- Review existing documentation (`GAMEPAD_CONTROLLER_PLAN.md`, `SERENITY_CONTROLS_UX_IMPROVEMENTS.md`) to stay consistent with past decisions.
- Coordinate with multiplayer layout updates to ensure Player 3/4 references align with in-game HUD naming.
- Keep modal performance in mind; lazy-load heavy helper content if it impacts initial settings load time.

## Success Criteria
- Users can intuitively locate and configure up to four gamepads in under one minute without external guidance.
- Visual design complements the serene, neon-accented aesthetic and remains legible on both desktop and handheld displays.
- Input conflicts and connection changes provide immediate, clear feedback that guides the user to resolution.
