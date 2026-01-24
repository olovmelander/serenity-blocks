/**
 * Frag Tracker - Kill Counting & Win Conditions
 *
 * Tracks player deaths, awards frags (kills), and checks win conditions
 * Implements all 5 Quadra end conditions: frags, time, points, lines, never
 */

import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { MessageTypes } from '../network/message-types.js';

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
    recordDeath(deadPlayerSteamId, killerSteamId = null, explicitKillerName = null) {
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

        // Resolve killer name
        let killerName = explicitKillerName;
        if (!killerName && killerSteamId) {
            const killer = this.gameState.players.get(killerSteamId);
            if (killer) {
                killerName = killer.name;
            } else {
                // Fallback: try looking up by string if ID mismatch
                const killerStr = String(killerSteamId);
                const killerByStr = this.gameState.players.get(killerStr);
                killerName = killerByStr ? killerByStr.name : `Unknown (ID: ${killerSteamId})`;
            }
        }

        // Broadcast death event
        this.gameState.network.broadcastToAll('game:player:died', {
            player: deadPlayerSteamId,
            playerName: deadPlayer.name,
            killer: killerSteamId,
            killerName: killerName, // Add explicit killer name
        });

        // Log death
        this.deathLog.push({
            victim: deadPlayerSteamId,
            victimName: deadPlayer.name,
            killer: killerSteamId,
            killerName: killerName,
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
            .filter((p) => p.isAlive);

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
                    .reduce((top, p) => (p.frags > top.frags ? p : top));

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
                        .reduce((top, p) => (p.gameState.score > top.gameState.score ? p : top));

                    console.log(`⏱️ Time's up! ${topPlayer.name} wins with ${topPlayer.gameState.score} points`);
                    return topPlayer;
                }
                break;
            }

            case 'points': {
                // First to X thousand points wins
                const targetScore = config.endConditionValue * 1000;
                const topPlayer = Array.from(this.gameState.players.values())
                    .reduce((top, p) => (p.gameState.score > top.gameState.score ? p : top));

                if (topPlayer.gameState.score >= targetScore) {
                    console.log(`🏆 ${topPlayer.name} reached ${topPlayer.gameState.score} points!`);
                    return topPlayer;
                }
                break;
            }

            case 'lines': {
                // First to clear X lines wins
                const topPlayer = Array.from(this.gameState.players.values())
                    .reduce((top, p) => (p.gameState.lines > top.gameState.lines ? p : top));

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

        console.log('🎊 MATCH OVER!');
        console.log(`🏆 WINNER: ${winner?.name || 'Draw'}`);

        const config = this.gameState.matchConfig;
        const duration = Date.now() - this.gameState.matchStartTime;
        const isGameOver = this.checkIfGameIsOver(winner);

        // Stop state sync + loop
        this.gameState.stopStateSyncLoop();
        this.gameState.stopGameLoop();

        // Prepare final stats
        const finalStats = this.buildFinalStats(duration);

        // Broadcast match end
        this.gameState.network.broadcastToAll(MessageTypes.GAME_MATCH_END, {
            winner: winner?.steamId || null,
            winnerName: winner?.name || 'Draw',
            endCondition: config.endCondition,
            endConditionValue: config.endConditionValue,
            finalStats,
            duration,
            killFeed: this.killFeed,
            isGameOver,
        });

        console.log('📊 Final Standings:');
        finalStats.forEach((stats) => {
            console.log(`  ${stats.placement}. ${stats.name} - ${stats.frags} frags, ${stats.score} points, ${stats.lines} lines`);
        });

        if (isGameOver) {
            // GAME OVER - Winner reached the goal!
            console.log('🎊 GAME OVER - Winner reached the goal!');

            emitMultiplayerEvent(MULTIPLAYER_EVENTS.GAME_OVER, {
                winner,
                winnerName: winner?.name || 'Draw',
                finalStats,
                endCondition: config.endCondition,
                endConditionValue: config.endConditionValue,
                duration,
                killFeed: this.killFeed,
                isGameOver: true,
            });
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
   * Build final stats array with deaths/APM
   */
    buildFinalStats(durationMs) {
        const minutes = Math.max(durationMs / 60000, 0.001);
        const deathCounts = this.getDeathCounts();
        const attackStats = this.gameState.getAttackStats ? this.gameState.getAttackStats() : [];
        const attackStatsById = new Map(attackStats.map((stats) => [stats.steamId, stats]));

        const finalStats = Array.from(this.gameState.players.values()).map((p) => {
            const attack = attackStatsById.get(p.steamId);
            const apm = Math.round(((attack && attack.totalAttacks) || 0) / minutes);
            const piecesPlaced = p.gameState.piecesPlaced || 0;
            const bpm = Math.round(piecesPlaced / minutes); // BPM = Blocks(Pieces) Per Minute (matches SP)
            const ppm = Math.round(p.gameState.score / minutes); // PPM = Points Per Minute (matches SP)

            return {
                steamId: p.steamId,
                name: p.name,
                color: p.color,
                score: p.gameState.score,
                lines: p.gameState.lines,
                frags: p.frags,
                deaths: deathCounts.get(p.steamId) || 0,
                apm,
                ppm,
                bpm,
                isAlive: p.isAlive,
                placement: 0,
            };
        });

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

        return finalStats;
    }

    /**
   * Build a map of death counts per player
   */
    getDeathCounts() {
        const counts = new Map();
        this.deathLog.forEach((entry) => {
            if (!entry || !entry.victim) return;
            counts.set(entry.victim, (counts.get(entry.victim) || 0) + 1);
        });
        return counts;
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
        const standings = Array.from(this.gameState.players.values()).map((p) => ({
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
