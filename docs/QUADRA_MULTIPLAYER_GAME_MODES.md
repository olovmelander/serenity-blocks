# Quadra Multiplayer Game Modes

This document describes the multiplayer game modes available in Quadra and their configuration options. This information can be used to implement similar modes in other Tetris-style games.

## Overview

Quadra is a multiplayer Tetris-style game that features multiple multiplayer modes. This document focuses on the two primary competitive modes: Free-For-All and Survivor Mode, along with their configuration options.

## Multiplayer Game Modes

### 1. Free-For-All (FFA)

**Description:** The classic competitive multiplayer mode where every player fights for themselves.

**How it works:**
- All players compete individually
- When you clear lines, you send garbage lines to opponents
- Direct attacks between all players
- Last player standing or first to reach the frag/point limit wins

**Key Features:**
- No teams or alliances
- Standard line attack mechanics
- Pure competitive gameplay
- Default multiplayer mode

**Best for:** Classic competitive matches, skill-based competition

---

### 2. Survivor Mode

**Description:** A team-based mode where teams fight in elimination rounds.

**How it works:**
- Game is divided into rounds
- A round ends when only one team has living members
- After each round, all players restart with:
  - Same piece sequence
  - Clean canvas (no garbage lines)
- Dead players must wait until the next round starts
- Team that wins the most rounds (or last team standing) wins the match

**Key Features:**
- Round-based gameplay
- Team survival emphasis
- Strategic team coordination required
- Fair restart conditions between rounds

**Best for:** Team-based competition, tournament play, tactical gameplay

---

## Attack Types

Both FFA and Survivor modes use the standard attack type:

### ATTACK_LINES (Standard)
- Sends garbage lines to the bottom of opponent's playfield
- Traditional Tetris attack mechanic
- Amount depends on lines cleared simultaneously
- More lines cleared = more garbage sent to opponents
- Used in both FFA and Survivor modes

---

## Game Configuration Options

When setting up a multiplayer match, you can configure the following options:

### End Game Conditions

Choose one of these conditions to determine when the match ends:

| Condition | Description | Parameter |
|-----------|-------------|-----------|
| **Never** | Game continues indefinitely until manually stopped | N/A |
| **Frags** | First player/team to reach X kills wins | Number of frags (e.g., 10, 20, 50) |
| **Time** | Player/team with highest score after X minutes wins | Minutes (e.g., 5, 10, 15) |
| **Points** | First player/team to reach X thousand points wins | Thousands of points (e.g., 50, 100, 200) |
| **Lines** | First player/team to clear X lines wins | Number of lines (e.g., 100, 200, 500) |

### Match Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Game Name** | "[No name]" | Display name for the match |
| **Starting Level** | 1 | Initial difficulty level (1-9, affects piece fall speed) |
| **Level Progression** | Disabled | If enabled, level increases every 15 lines cleared |
| **Allow Handicap** | Enabled | Let players set skill handicap to balance gameplay |
| **Boring Rules** | Disabled | If disabled, attack damage reduces with many players to keep game balanced |
| **Public Game** | Disabled | List game on public server browser |

### Team Settings (for team modes)

- Teams are automatically balanced when possible
- Players can choose team colors
- Team communication channels available
- Team scoring tracked separately

---

## Command-Line Options

For server hosts, these command-line options configure the game:

### Mode Selection
```bash
-ffa           # Free-for-all mode
-survivor      # Survivor mode
```

### Level Configuration
```bash
-levelup       # Enable level progression (every 15 lines)
-nolevelup     # Disable level progression
-level <n>     # Set starting level (1-9)
```

### Game Rules
```bash
-nohandicap    # Disable player handicaps
-boringrules   # Don't reduce attack damage with many players
```

### End Conditions
```bash
-endfrag <x>   # End after X frags (kills)
-endtime <x>   # End after X minutes
-endpoints <x> # End after X thousand points
-endlines <x>  # End after X lines cleared
```

### Server Options
```bash
-public        # Make game publicly listed on game servers
```

---

## Implementation Notes for Phaser.js

When implementing these modes in your Phaser game, consider:

### Core Mechanics to Implement

1. **Attack System**
   - Implement garbage line generation
   - Add visual effects for attacks
   - Attack intensity based on lines cleared
   - Garbage line randomization with one empty space per line

2. **Team System (for Survivor Mode)**
   - Team assignment and balancing
   - Team-based targeting logic
   - Team score tracking
   - Team communication channels

3. **Round System (for Survivor Mode)**
   - Round state management
   - Synchronized restarts between rounds
   - Same piece sequence for all players in each round
   - Canvas clearing between rounds
   - Dead player spectator mode until next round

### Network Considerations

- **State Synchronization:** All players must see the same game state
- **Attack Messages:** Broadcast attacks to affected players
- **Team Communication:** Separate channels for Survivor mode teams
- **Round Transitions:** Synchronized round starts in Survivor mode
- **Score Updates:** Real-time score/frag synchronization

### UI Elements Needed

- Mode selection menu (FFA vs Survivor)
- Game configuration screen (frags, time, points, lines)
- Team selection interface (for Survivor mode)
- In-game HUD showing:
  - Current score/frags
  - Time remaining (if applicable)
  - Team status (for Survivor mode)
  - Round counter (for Survivor mode)
  - Alive/dead player indicators

### Balancing Considerations

- **Attack Scaling:** With many players, reduce attack strength (unless "boring rules" enabled)
- **Handicap System:** Let weaker players start at higher levels or with score bonuses
- **Team Balancing:** Auto-balance teams by skill level when possible (for Survivor mode)

---

## Example Match Configurations

### Quick Deathmatch
- Mode: Free-For-All
- End Condition: 20 Frags
- Starting Level: 3
- Level Progression: Disabled

### Team Tournament
- Mode: Survivor
- End Condition: Best of 5 Rounds
- Starting Level: 1
- Level Progression: Enabled

### Endurance Match
- Mode: Free-For-All
- End Condition: 10 Minutes
- Starting Level: 1
- Level Progression: Enabled

### Sprint Challenge
- Mode: Free-For-All
- End Condition: 200 Lines
- Starting Level: 5
- Level Progression: Disabled

---

## References

For implementation details, refer to these key files in the Quadra source code:

- [game.h](source/game.h) - Game mode definitions and configuration structures
- [game.cc](source/game.cc) - Game mode implementation (lines 68-106 for presets)
- [attack.h](source/attack.h) - Attack type definitions
- [game_menu.cc](source/game_menu.cc) - Mode selection UI (lines 239-245)
- [multi_player.h](source/multi_player.h) - Multiplayer framework
- [packets.h](source/packets.h) - Network packet definitions

---

## Summary

Quadra's two primary multiplayer modes offer distinct gameplay experiences:

- **FFA (Free-For-All):** Pure competitive skill where every player fights for themselves
- **Survivor:** Team elimination rounds with strategic coordination

Each mode can be customized with various end conditions (frags, time, points, lines) and gameplay settings (starting level, level progression, handicaps, attack scaling rules) to create the perfect match for your players.

When implementing in Phaser.js, focus on:
- Solid network synchronization for consistent game state
- Garbage line attack system with proper visual feedback
- Round-based restart system for Survivor mode
- Team management and communication for Survivor mode
- Intuitive UI for mode selection and configuration

Good luck with your implementation!
