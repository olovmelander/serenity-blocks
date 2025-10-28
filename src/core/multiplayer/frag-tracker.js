/**
 * Frag Tracker - Kill Counting & Win Conditions
 * 
 * Tracks player deaths, awards frags (kills), and checks win conditions
 * Implements all 5 Quadra end conditions: frags, time, points, lines, never
 */

import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

export class FragTracker {
  constructor(ffaGameState) {
    this.gameState = ffaGameState;
    this.isHost = ffaGameState.isHost;
    
    // Kill feed (recent kills for display)
    this.killFeed = [];
    this.MAX_KILL_FEED = 10;
    
    // Death tracking (who killed who)
    this.deathLog = [];
  }
  
  /**
   * Record a player death and award frag to killer
   * (HOST ONLY)
   */
  recordDeath(deadPlayerSteamId, killerSteamId = null) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can record deaths');
      return;
    }
    
    const deadPlayer = this.gameState.players.get(deadPlayerSteamId);
    if (!deadPlayer) {
      return; // Player doesn't exist
    }
    
    // Mark player as dead
    deadPlayer.isAlive = false;
    console.log(`💀 ${deadPlayer.name} has died`);
    
    // Award frag to killer (if not self-kill)
    if (killerSteamId && killerSteamId !== deadPlayerSteamId) {
      const killer = this.gameState.players.get(killerSteamId);
      
      if (killer) {
        killer.frags++;
        console.log(`🏆 ${killer.name} scored a frag! (${killer.frags} total)`);
        
        // Add to kill feed
        this.addToKillFeed({
          killer: killer.name,
          killerSteamId: killer.steamId,
          victim: deadPlayer.name,
          victimSteamId: deadPlayer.steamId,
          timestamp: Date.now(),
        });
        
        // Broadcast frag event
        this.gameState.network.broadcastToAll('game:player:frag', {
          killer: killerSteamId,
          killerName: killer.name,
          victim: deadPlayerSteamId,
          victimName: deadPlayer.name,
          fragCount: killer.frags,
        });
      }
    } else {
      // Self-kill or no killer
      this.addToKillFeed({
        killer: null,
        killerSteamId: null,
        victim: deadPlayer.name,
        victimSteamId: deadPlayer.steamId,
        timestamp: Date.now(),
      });
    }
    
    // Broadcast death event
    this.gameState.network.broadcastToAll('game:player:died', {
      player: deadPlayerSteamId,
      playerName: deadPlayer.name,
      killer: killerSteamId,
    });
    
    // Log death
    this.deathLog.push({
      victim: deadPlayerSteamId,
      victimName: deadPlayer.name,
      killer: killerSteamId,
      killerName: killerSteamId ? this.gameState.players.get(killerSteamId)?.name : null,
      timestamp: Date.now(),
    });
    
    // Check if match should end
    this.checkMatchEnd();
  }
  
  /**
   * Add kill to kill feed
   */
  addToKillFeed(kill) {
    this.killFeed.unshift(kill);
    
    // Keep only recent kills
    if (this.killFeed.length > this.MAX_KILL_FEED) {
      this.killFeed.pop();
    }
  }
  
  /**
   * Check if match should end based on win conditions
   */
  checkMatchEnd() {
    if (!this.isHost) return;
    
    const alivePlayers = Array.from(this.gameState.players.values())
      .filter(p => p.isAlive);
    
    // Check win conditions
    const winner = this.checkWinCondition(alivePlayers);
    
    if (winner) {
      this.endMatch(winner);
    }
  }
  
  /**
   * Check win condition based on match config
   * Returns winning player or null
   */
  checkWinCondition(alivePlayers) {
    const config = this.gameState.matchConfig;
    
    // Last player standing always wins (if only 1 alive)
    if (alivePlayers.length === 1) {
      console.log(`🏆 Last player standing: ${alivePlayers[0].name}`);
      return alivePlayers[0];
    }
    
    // All players dead = draw/no winner
    if (alivePlayers.length === 0) {
      console.log('💀 All players dead - draw!');
      return { steamId: null, name: 'Draw' }; // Special draw case
    }
    
    // Check specific end conditions
    switch (config.endCondition) {
      case 'frags': {
        // First to X frags wins
        const topPlayer = Array.from(this.gameState.players.values())
          .reduce((top, p) => p.frags > top.frags ? p : top);
        
        if (topPlayer.frags >= config.endConditionValue) {
          console.log(`🏆 ${topPlayer.name} reached ${topPlayer.frags} frags!`);
          return topPlayer;
        }
        break;
      }
      
      case 'time': {
        // Highest score after X minutes
        const elapsed = (Date.now() - this.gameState.matchStartTime) / 1000 / 60; // minutes
        
        if (elapsed >= config.endConditionValue) {
          const topPlayer = Array.from(this.gameState.players.values())
            .reduce((top, p) => p.gameState.score > top.gameState.score ? p : top);
          
          console.log(`⏱️ Time's up! ${topPlayer.name} wins with ${topPlayer.gameState.score} points`);
          return topPlayer;
        }
        break;
      }
      
      case 'points': {
        // First to X thousand points wins
        const targetScore = config.endConditionValue * 1000;
        const topPlayer = Array.from(this.gameState.players.values())
          .reduce((top, p) => p.gameState.score > top.gameState.score ? p : top);
        
        if (topPlayer.gameState.score >= targetScore) {
          console.log(`🏆 ${topPlayer.name} reached ${topPlayer.gameState.score} points!`);
          return topPlayer;
        }
        break;
      }
      
      case 'lines': {
        // First to clear X lines wins
        const topPlayer = Array.from(this.gameState.players.values())
          .reduce((top, p) => p.gameState.lines > top.gameState.lines ? p : top);
        
        if (topPlayer.gameState.lines >= config.endConditionValue) {
          console.log(`🏆 ${topPlayer.name} cleared ${topPlayer.gameState.lines} lines!`);
          return topPlayer;
        }
        break;
      }
      
      case 'never': {
        // Match never ends automatically (manual stop only)
        return null;
      }
    }
    
    return null; // No winner yet
  }
  
  /**
   * End the match with a winner
   */
  endMatch(winner) {
    if (!this.isHost) return;
    
    this.gameState.gamePhase = 'finished';
    this.gameState.winner = winner;
    
    console.log(`🎊 MATCH OVER!`);
    console.log(`🏆 WINNER: ${winner.name}`);
    
    // Stop state sync
    this.gameState.stopStateSyncLoop();
    
    // Prepare final stats
    const finalStats = Array.from(this.gameState.players.values()).map(p => ({
      steamId: p.steamId,
      name: p.name,
      score: p.gameState.score,
      lines: p.gameState.lines,
      frags: p.frags,
      isAlive: p.isAlive,
      placement: 0, // Will be filled based on ranking
    }));
    
    // Rank players (by frags, then score, then lines)
    finalStats.sort((a, b) => {
      if (b.frags !== a.frags) return b.frags - a.frags;
      if (b.score !== a.score) return b.score - a.score;
      return b.lines - a.lines;
    });
    
    // Assign placements
    finalStats.forEach((stats, index) => {
      stats.placement = index + 1;
    });
    
    // Broadcast match end
    this.gameState.network.broadcastToAll('game:match:end', {
      winner: winner.steamId,
      winnerName: winner.name,
      endCondition: this.gameState.matchConfig.endCondition,
      finalStats,
      duration: Date.now() - this.gameState.matchStartTime,
      killFeed: this.killFeed,
    });
    
    console.log('📊 Final Standings:');
    finalStats.forEach(stats => {
      console.log(`  ${stats.placement}. ${stats.name} - ${stats.frags} frags, ${stats.score} points, ${stats.lines} lines`);
    });
    
    // Check if this is the final win (game over) or just a round win
    const config = this.gameState.matchConfig;
    const isGameOver = this.checkIfGameIsOver(winner);
    
    if (isGameOver) {
      // GAME OVER - Winner reached the goal!
      console.log('🎊 GAME OVER - Winner reached the goal!');
      
      emitMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, {
        winner,
        finalStats,
        endCondition: config.endCondition,
        endConditionValue: config.endConditionValue,
      });
      
      // TODO: Show game over screen with option to play again
      // For now, auto-restart after 10 seconds
      if (this.gameState.isHost) {
        setTimeout(() => {
          // Full game restart (reset frags too)
          this.gameState.restartFullGame();
        }, 10000);
      }
    } else {
      // ROUND OVER - Continue to next round
      console.log('🏁 ROUND OVER - Next round starting soon...');
      
      if (this.gameState.isHost && this.gameState.players.size >= 1) {
        // Show "Round Over" message briefly
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_OVER, {
          winner,
          finalStats,
        });
        
        setTimeout(() => {
          this.gameState.restartMatch();
        }, 3000);
      }
    }
  }
  
  /**
   * Check if game is truly over (winner reached the goal)
   */
  checkIfGameIsOver(winner) {
    const config = this.gameState.matchConfig;
    
    // "Never" end condition means rounds go on forever
    if (config.endCondition === 'never') {
      return false;
    }
    
    // Last player standing or all dead is just a round win, not game over
    // Game only ends when someone reaches the actual goal
    switch (config.endCondition) {
      case 'frags':
        return winner && winner.frags >= config.endConditionValue;
      case 'points':
        return winner && winner.gameState && winner.gameState.score >= (config.endConditionValue * 1000);
      case 'lines':
        return winner && winner.gameState && winner.gameState.lines >= config.endConditionValue;
      case 'time':
        const elapsed = (Date.now() - this.gameState.matchStartTime) / 1000 / 60;
        return elapsed >= config.endConditionValue;
      default:
        return false;
    }
  }
  
  /**
   * Get current standings (sorted by frags, then score)
   */
  getStandings() {
    const standings = Array.from(this.gameState.players.values()).map(p => ({
      steamId: p.steamId,
      name: p.name,
      frags: p.frags,
      score: p.gameState.score,
      lines: p.gameState.lines,
      isAlive: p.isAlive,
    }));
    
    // Sort by frags, then score, then lines
    standings.sort((a, b) => {
      if (b.frags !== a.frags) return b.frags - a.frags;
      if (b.score !== a.score) return b.score - a.score;
      return b.lines - a.lines;
    });
    
    return standings;
  }
  
  /**
   * Get kill feed
   */
  getKillFeed() {
    return this.killFeed;
  }
  
  /**
   * Clear all tracking data
   */
  reset() {
    this.killFeed = [];
    this.deathLog = [];
  }
}
