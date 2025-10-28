/**
 * FFA P2P Game State - Host-Authoritative Multiplayer
 * 
 * This manages the game state for Free-For-All multiplayer using P2P.
 * The host is authoritative (validates all moves, broadcasts state).
 */

import { MessageTypes } from '../network/message-types.js';
import { GameState } from '../game.js';
import { GarbageQueue, bitsToColumns, columnsToMask } from '../garbage.js';
import { InputValidator } from '../validation/input-validator.js';
import {
  fillBag, spawnPiece, move, rotate, softDrop, hardDrop, markBoardDirty,
} from '../game.js';
import { processPhysics } from '../physics.js';
import { PLAYER_COLORS } from '../constants.js';
import { FFAAttackRouter } from './ffa-attack-router.js';
import { FragTracker } from './frag-tracker.js';
import { HostMigration } from './host-migration.js';
import { unifiedLoop } from './unified-game-loop.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

export class FFAGameStateP2P {
  constructor(steamNetworking, localPlayerId) {
    this.network = steamNetworking;
    this.localPlayerId = localPlayerId;
    this.isHost = steamNetworking.isHost;
    
    // All player states (Map<steamId, PlayerState>)
    this.players = new Map();
    
    // Initialize local player
    this.addPlayer(localPlayerId, steamNetworking.playerName, true);
    
    // Match state
    this.gamePhase = 'waiting'; // waiting, countdown, playing, finished
    this.sharedSeed = 0; // Deterministic RNG seed (same pieces for all)
    this.matchConfig = {
      endCondition: 'frags', // 'frags', 'time', 'points', 'lines', 'never'
      endConditionValue: 10,
      startLevel: 1,
      levelProgression: false,
      allowHandicap: true,
      boringRules: false,
    };
    this.winner = null;
    this.matchStartTime = 0;
    
    // Input validation (host only)
    this.inputValidator = this.isHost ? new InputValidator() : null;
    
    // State sync (host broadcasts at 30Hz)
    this.stateSyncInterval = null;
    this.STATE_SYNC_RATE = 30; // Hz

    // Track last state for delta detection (reduces network spam)
    this.lastBroadcastState = new Map(); // steamId -> last state snapshot
    
    // Phase 3 systems
    this.attackRouter = new FFAAttackRouter(this);
    this.fragTracker = new FragTracker(this);
    this.hostMigration = new HostMigration(this);
    
    // Game loop (unified RAF-driven loop)
    this.unifiedLoop = unifiedLoop;
    this.loopRunning = false;
    this.loopCallbacksConfigured = false;
    
    // Setup network handlers
    this.setupNetworkHandlers();
    
    // If peer, announce joining to host
    if (!this.isHost) {
      this.announceJoin();
    }
  }
  
  /**
   * Add a player to the match
   */
  addPlayer(steamId, name, isLocal = false) {
    if (this.players.has(steamId)) {
      console.warn(`⚠️ Player ${steamId} already exists`);
      return;
    }
    
    // Check if PLAYER_COLORS is available
    if (!PLAYER_COLORS || PLAYER_COLORS.length === 0) {
      console.error('❌ PLAYER_COLORS is not available!', PLAYER_COLORS);
      return;
    }
    
    // Assign color based on join order (wraps around if > 8 players)
    const colorIndex = this.players.size % PLAYER_COLORS.length;
    const playerColor = PLAYER_COLORS[colorIndex];
    
    console.log(`🎨 Assigning color to ${name}: index=${colorIndex}, color=${playerColor}`);
    console.log(`   Available colors:`, PLAYER_COLORS);
    console.log(`   PLAYER_COLORS type:`, typeof PLAYER_COLORS, Array.isArray(PLAYER_COLORS));
    
    const playerState = {
      steamId,
      name,
      color: playerColor, // NEW: Assign unique player color
      isLocal,
      gameState: new GameState(),
      garbageQueue: new GarbageQueue(),
      isAlive: true,
      isReady: false,
      frags: 0,
      joinedAt: Date.now(),
      lastAttackerId: null, // Track who last sent garbage to this player (for kill attribution)
    };
    
    this.players.set(steamId, playerState);
    console.log(`✅ Player added: ${name} (${steamId})${isLocal ? ' [LOCAL]' : ''} - Color: ${playerColor}`);
    console.log(`   Total players: ${this.players.size}`);
    console.log(`   All player colors now:`, Array.from(this.players.values()).map(p => ({ name: p.name, color: p.color })));
    
    // Trigger UI update event
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED, {
      players: this.players,
    });
    
    // Host broadcasts updated player list
    if (this.isHost) {
      this.broadcastPlayerList();
      if (this.loopRunning) {
        this.syncUnifiedLoopPlayers();
      }
    }
  }
  
  /**
   * Remove a player from the match
   */
  removePlayer(steamId) {
    const player = this.players.get(steamId);
    if (!player) return;
    
    console.log(`👋 Player left: ${player.name}`);
    this.players.delete(steamId);
    
    // Clean up validator data (host only)
    if (this.isHost && this.inputValidator) {
      this.inputValidator.resetPlayer(steamId);
    }
    
    // Broadcast updated player list
    if (this.isHost) {
      this.broadcastPlayerList();
      if (this.loopRunning) {
        this.syncUnifiedLoopPlayers();
      } else if (this.unifiedLoop) {
        this.unifiedLoop.unregisterPlayer(steamId);
      }
    }
  }
  
  /**
   * Announce joining to host (peer only)
   */
  announceJoin() {
    if (this.isHost) return;
    
    console.log('📢 Announcing join to host...');
    
    // Send join message to host
    this.network.sendP2PMessage(
      this.network.hostSteamId,
      MessageTypes.LOBBY_PLAYER_JOINED,
      {
        steamId: this.localPlayerId,
        name: this.network.playerName,
      }
    );
  }
  
  /**
   * Setup network message handlers
   */
  setupNetworkHandlers() {
    // === INPUT MESSAGES (Peer → Host) ===
    
    this.network.on(MessageTypes.GAME_INPUT_MOVE, (msg) => {
      if (this.isHost) {
        this.processPlayerInput(msg.from, 'move', msg.data, msg.timestamp);
      }
    });
    
    this.network.on(MessageTypes.GAME_INPUT_ROTATE, (msg) => {
      if (this.isHost) {
        this.processPlayerInput(msg.from, 'rotate', msg.data, msg.timestamp);
      }
    });
    
    this.network.on(MessageTypes.GAME_INPUT_DROP, (msg) => {
      if (this.isHost) {
        this.processPlayerInput(msg.from, 'drop', msg.data, msg.timestamp);
      }
    });
    
    // === STATE SYNC MESSAGES (Host → Peers) ===
    
    this.network.on(MessageTypes.GAME_STATE_FULL, (msg) => {
      if (!this.isHost) {
        this.syncFromHost(msg.data);
      }
    });
    
    this.network.on(MessageTypes.LOBBY_PLAYER_JOINED, (msg) => {
      console.log('📬 LOBBY_PLAYER_JOINED received:', msg);
      console.log('   isHost:', this.isHost);
      console.log('   msg.data:', msg.data);
      
      // Host receives join announcement from peer
      if (this.isHost && msg.data.steamId && msg.data.name) {
        console.log(`📢 Host received join from: ${msg.data.name} (${msg.data.steamId})`);
        if (msg.data.steamId !== this.localPlayerId) {
          this.addPlayer(msg.data.steamId, msg.data.name);
        }
      }
      
      // Peers receive player list update from host
      if (!this.isHost && msg.data.players) {
        console.log(`📢 Peer received player list update from host:`, msg.data.players);
        msg.data.players.forEach(p => {
          if (!this.players.has(p.steamId)) {
            console.log(`   Adding player: ${p.name} with color from host: ${p.color}`);
            this.addPlayer(p.steamId, p.name, p.steamId === this.localPlayerId);
            // Override auto-assigned color with host's color
            const player = this.players.get(p.steamId);
            if (player && p.color) {
              console.log(`   🎨 Overriding color for ${p.name}: ${player.color} → ${p.color}`);
              player.color = p.color;
            }
          } else {
            // Update existing player
            console.log(`   Updating existing player: ${p.name}`);
            const player = this.players.get(p.steamId);
            console.log(`     Current color: ${player.color}, Host color: ${p.color}`);
            player.isReady = p.isReady;
            player.isAlive = p.isAlive;
            // Update color if provided (ensures consistency)
            if (p.color) {
              console.log(`   🎨 Updating color for ${p.name}: ${player.color} → ${p.color}`);
              player.color = p.color;
            }
          }
        });
        console.log(`   📊 Final player colors:`, Array.from(this.players.values()).map(p => ({ name: p.name, color: p.color })));
      }
    });
    
    this.network.on(MessageTypes.LOBBY_PLAYER_LEFT, (msg) => {
      this.removePlayer(msg.data.steamId);
    });
    
    this.network.on(MessageTypes.LOBBY_GAME_START, (msg) => {
      if (!this.isHost) {
        console.log('📬 Peer received game start from host!');
        this.startMatch(msg.data.sharedSeed, msg.data.config);
        
        // Notify main.js to show the game UI for peer
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_STARTED, { gameState: this });
      }
    });
    
    this.network.on(MessageTypes.LOBBY_PLAYER_READY, (msg) => {
      const player = this.players.get(msg.data.steamId);
      if (player) {
        player.isReady = msg.data.isReady;
        console.log(`${player.name} is ${msg.data.isReady ? 'ready' : 'not ready'}`);
      }
    });
    
    // === PHASE 3: FFA COMBAT & HOST MIGRATION ===
    
    this.network.on('game:player:died', (msg) => {
      console.log(`💀 ${msg.data.playerName} died`);
    });
    
    this.network.on('game:player:frag', (msg) => {
      console.log(`🏆 ${msg.data.killerName} fragged ${msg.data.victimName}!`);
    });
    
    this.network.on('game:match:end', (msg) => {
      console.log(`🎊 MATCH OVER! Winner: ${msg.data.winnerName}`);
      this.gamePhase = 'finished';
      this.winner = msg.data.winner;
    });
    
    this.network.on('game:garbage:sent', (msg) => {
      console.log(`💥 ${msg.data.fromName} sent ${msg.data.totalLines} lines to ${msg.data.targetCount} players`);
    });
    
    this.network.on('game:host:migrated', (msg) => {
      console.log(`🔄 Host migrated to: ${msg.data.newHostName}`);
      this.network.hostSteamId = msg.data.newHost;
    });
    
    this.network.on('game:host:handoff', (msg) => {
      console.log(`🔄 Host handoff requested: ${msg.data.reason}`);
      if (!this.isHost) {
        this.hostMigration.becomeHost();
      }
    });
    
    // Round restart (when host starts new round)
    this.network.on(MessageTypes.GAME_ROUND_RESTART, (msg) => {
      if (this.isHost) return; // Host already handled this locally
      
      const isFullReset = msg.data.fullReset === true;
      console.log(`🔄 ${isFullReset ? 'Full game' : 'Round'} restarting...`);
      
      // Stop current game
      this.stopGameLoop();
      this.stopStateSyncLoop();
      
      // Reset trackers
      if (this.fragTracker) {
        this.fragTracker.reset();
      }
      if (this.attackRouter) {
        this.attackRouter.clearHistory();
      }
      
      // Reset ALL players
      this.players.forEach((player, steamId) => {
        player.isAlive = true; // Revive everyone
        player.garbageQueue.clear();
        player.lastAttackerId = null; // Clear last attacker for new round
        
        if (isFullReset) {
          // Full reset (including frags)
          player.frags = 0; // RESET FRAGS for new game
          player.gameState = new GameState();
          player.gameState.level = this.matchConfig.startLevel;
        } else {
          // Round reset (keep frags/scores)
          const oldScore = player.gameState.score;
          const oldLines = player.gameState.lines;
          const oldLevel = player.gameState.level;
          
          player.gameState = new GameState();
          player.gameState.score = oldScore; // Keep score across rounds
          player.gameState.lines = oldLines; // Keep lines across rounds
          player.gameState.level = oldLevel; // Keep level progression
        }
      });
      
      // Reset match state
      this.winner = null;
      this.gamePhase = 'waiting';
      
      // Dispatch event to clear death visuals
      emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
        players: Array.from(this.players.keys()),
      });
      
      // Show countdown with the same prefix text as host
      this.showCountdown(() => {
        this.gamePhase = 'playing';
        
        // Re-initialize players with the same seed from host (for deterministic pieces)
        const newSeed = msg.data.newSeed;
        this.players.forEach((player, steamId) => {
          player.gameState.randomGenerator = this.createSeededRNG(newSeed + player.steamId.charCodeAt(0));
          
          // Fill bag and spawn first piece
          fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
          spawnPiece(player.gameState, null, null);
        });
        
        // Start game loop (needed for rendering on peer side)
        this.startGameLoop();
        
        console.log(`🎮 ${isFullReset ? 'Game' : 'Round'} started on peer!`);
      }, msg.data.prefixText || 'ROUND OVER');
    });
    
    // PHASE 4.4: Chat messages
    this.network.on('game:chat', (msg) => {
      console.log(`💬 Chat from ${msg.data.playerName}: ${msg.data.message}`);
      
      // Dispatch to UI (don't echo back to sender)
      if (msg.data.steamId !== this.localPlayerId) {
        emitMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, {
          playerName: msg.data.playerName,
          message: msg.data.message,
          steamId: msg.data.steamId,
          timestamp: msg.data.timestamp,
        });
      }
    });
  }
  
  /**
   * Process player input (HOST ONLY)
   */
  processPlayerInput(steamId, inputType, data, timestamp) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can process inputs');
      return;
    }
    
    const player = this.players.get(steamId);
    if (!player || !player.isAlive) {
      return; // Player doesn't exist or is dead
    }
    
    // Validate input (anti-cheat)
    const validation = this.inputValidator.validateInput(steamId, inputType, data, timestamp);
    if (!validation.valid) {
      console.warn(`⚠️ Invalid input from ${player.name}: ${validation.reason}`);
      // TODO: Could kick player for repeated violations
      return;
    }
    
    // Track input for pattern detection
    this.inputValidator.trackInput(steamId, inputType, data);
    
    const gameState = player.gameState;
    
    // Skip if processing physics or no piece
    if (gameState.isProcessingPhysics || !gameState.currentPiece) {
      return;
    }
    
    // Apply input to player's game state
    const physicsCallbacks = this.buildPhysicsCallbacks(steamId);
    
    switch (inputType) {
      case 'move':
        move(gameState, data.direction, null, null);
        break;
      case 'rotate':
        rotate(gameState, data.direction, null, null);
        break;
      case 'drop':
        if (data.type === 'soft') {
          softDrop(gameState, null, physicsCallbacks);
        } else if (data.type === 'hard') {
          hardDrop(gameState, null, physicsCallbacks);
        }
        break;
    }
    
    // CRITICAL: Force immediate visual update after input
    // Don't wait for next state sync (30Hz) - render immediately (60Hz)
    this.renderAllPlayers();
  }
  
  /**
   * Send local player input to host
   */
  sendInput(inputType, data) {
    if (this.gamePhase !== 'playing') {
      return; // Can't send inputs if game isn't playing
    }
    
    const timestamp = Date.now();
    
    if (this.isHost) {
      // Host processes its own input immediately
      this.processPlayerInput(this.localPlayerId, inputType, data, timestamp);
    } else {
      // Peer sends input to host
      const messageType = inputType === 'move' ? MessageTypes.GAME_INPUT_MOVE
                        : inputType === 'rotate' ? MessageTypes.GAME_INPUT_ROTATE
                        : MessageTypes.GAME_INPUT_DROP;
      
      this.network.sendP2PMessage(this.network.hostSteamId, messageType, {
        ...data,
        timestamp,
      });
    }
  }
  
  /**
   * Insert pending garbage for a player (after piece spawns)
   * HOST ONLY
   */
  insertPendingGarbage(steamId) {
    if (!this.isHost) return;
    
    const player = this.players.get(steamId);
    if (!player || !player.isAlive) return;
    
    const garbageQueue = player.garbageQueue;
    const totalLines = garbageQueue.getTotalLines();
    
    if (totalLines === 0) return;
    
    console.log(`💥 Inserting ${totalLines} garbage lines for ${player.name}`);
    console.log(`💥 Queue has ${garbageQueue.entries.length} total entries before dequeue`);
    
    // Take lines from queue
    const burst = garbageQueue.dequeueLineBurst();
    
    if (!burst || burst.length === 0) return;
    
    console.log(`💥 Dequeued ${burst.length} entries from garbage queue`);
    
    // Log all entries in burst to debug attackerId
    burst.forEach((entry, idx) => {
      console.log(`  Entry ${idx}: type=${entry.type}, attackerId=${entry.attackerId || 'MISSING'}, color=${entry.color}`);
    });
    
    // Track who sent the garbage for kill attribution
    // Use the last garbage entry's attacker (most recent attacker gets the frag)
    const attackerId = burst.length > 0 
      ? (burst[burst.length - 1].attackerId || burst.find(entry => entry.attackerId)?.attackerId || null)
      : null;
    
    if (attackerId) {
      const attacker = this.players.get(attackerId);
      console.log(`💥 ✅ Garbage from ${attacker?.name || attackerId} is being inserted into ${player.name}'s board`);
      // Track this attacker as the last one who sent garbage to this player
      player.lastAttackerId = attackerId;
    } else {
      console.log(`💥 ❌ NO ATTACKER FOUND in garbage burst! This will be a self-kill.`);
    }
    
    // Insert into game board
    burst.forEach(entry => {
      this.insertGarbageLine(player.gameState, entry);
    });
    
    // PHASE 3.2: Dispatch garbage insertion event for visual effects
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
      steamId,
      playerName: player.name,
      linesInserted: burst.length,
      isLocal: steamId === this.localPlayerId,
    });
    
    // Check if player topped out
    if (this.checkTopOut(player.gameState)) {
      console.log(`💀 ${player.name} topped out!`);
      player.isAlive = false;
      player.gameState.isGameOver = true;
      
      // Award frag to the player who sent the garbage
      if (attackerId) {
        const attacker = this.players.get(attackerId);
        console.log(`🏆 Kill attributed to: ${attacker?.name || attackerId}`);
      } else {
        console.log(`💀 Self-kill (no attacker found in garbage entries)`);
      }
      this.fragTracker.recordDeath(steamId, attackerId);
      
      // Dispatch top-out event
      emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
        steamId,
        playerName: player.name,
        isLocal: steamId === this.localPlayerId,
      });
    }
  }
  
  /**
   * PHASE 3.2: Cancel garbage with outgoing attacks (garbage counter)
   * This is a competitive mechanic where sending garbage reduces incoming garbage
   */
  applyGarbageCounter(attackerSteamId, outgoingLines) {
    if (!this.isHost) return;
    
    const attacker = this.players.get(attackerSteamId);
    if (!attacker || !attacker.isAlive) return;
    
    const incomingLines = attacker.garbageQueue.getTotalLines();
    
    if (incomingLines === 0) {
      return; // No incoming garbage to counter
    }
    
    // Calculate how many lines can be countered
    const canceledLines = Math.min(incomingLines, outgoingLines);
    
    if (canceledLines > 0) {
      // Remove canceled lines from queue
      const originalQueue = attacker.garbageQueue.entries.length;
      let removed = 0;
      
      while (removed < canceledLines && attacker.garbageQueue.entries.length > 0) {
        const entry = attacker.garbageQueue.entries[0];
        if (entry.type === 'line') {
          attacker.garbageQueue.entries.shift();
          removed++;
        } else {
          break; // Don't remove non-line entries
        }
      }
      
      console.log(`🛡️ ${attacker.name} countered ${removed} garbage lines (${incomingLines} → ${attacker.garbageQueue.getTotalLines()})`);
      
      // Dispatch counter event for visual/audio feedback
      emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_COUNTERED, {
        steamId: attackerSteamId,
        playerName: attacker.name,
        linesCanceled: removed,
        remainingGarbage: attacker.garbageQueue.getTotalLines(),
        isLocal: attackerSteamId === this.localPlayerId,
      });
    }
  }
  
  /**
   * Insert a single garbage line into the board
   */
  insertGarbageLine(gameState, garbageEntry) {
    // Shift all locked pieces up by 1 row
    gameState.lockedPieces.forEach(piece => {
      piece.y -= 1;
    });
    
    // Create garbage row with holes based on entry.holeMask
    const COLS = 10; // Board width
    const ROWS = 20; // Visible rows
    const HIDDEN_ROWS = 4; // Hidden rows at top
    const garbageRow = Array(COLS).fill(true);
    
    let holeMask = null;
    if (garbageEntry.holeMask !== undefined && garbageEntry.holeMask !== null) {
      // Convert holeMask based on its type:
      // - If it's a number (bitfield), convert it to boolean array
      // - If it's already an array, use it (or convert object-with-numeric-keys)
      if (typeof garbageEntry.holeMask === 'number') {
        // Convert bitfield to column indices, then to boolean mask
        const holeColumns = bitsToColumns(garbageEntry.holeMask);
        holeMask = columnsToMask(holeColumns);
      } else if (Array.isArray(garbageEntry.holeMask)) {
        holeMask = garbageEntry.holeMask;
      } else {
        // Handle object-with-numeric-keys case (from JSON deserialization)
        holeMask = Array.from(garbageEntry.holeMask);
      }
      
      holeMask.forEach((hasHole, col) => {
        if (hasHole) {
          garbageRow[col] = false;
        }
      });
    }
    
    // Add garbage as locked pieces at bottom of visible area
    const garbageY = ROWS + HIDDEN_ROWS - 1;
    garbageRow.forEach((isSolid, col) => {
      if (isSolid) {
        gameState.lockedPieces.push({
          x: col,
          y: garbageY,
          shape: [[1]],
          color: garbageEntry.color || '#808080',
          shapeKey: 'garbage',
        });
      }
    });
    
    console.log(`  Added garbage line at y=${garbageY}, holes at:`, 
      holeMask ? holeMask.map((h, i) => h ? i : null).filter(x => x !== null) : 'none');
    markBoardDirty(gameState);
  }
  
  /**
   * Check if game board has topped out
   */
  checkTopOut(gameState) {
    const HIDDEN_ROWS = 4;
    // Check if any locked pieces are at or above the spawn line (top of visible area)
    // Since pieces now spawn at y=HIDDEN_ROWS, having locked pieces there means no room to spawn
    return gameState.lockedPieces.some(piece => {
      return piece.y <= HIDDEN_ROWS;
    });
  }
  
  /**
   * Start the match (host initiates, peers receive)
   */
  startMatch(seed = null, config = null) {
    if (this.isHost && !seed) {
      // Host generates seed
      this.sharedSeed = Math.floor(Math.random() * 1000000);
      
      // Apply config if provided
      if (config) {
        this.matchConfig = { ...this.matchConfig, ...config };
      }
      
      // Initialize all players with shared seed
      this.players.forEach(player => {
        this.initializePlayerForMatch(player, this.sharedSeed);
      });
      
      // Broadcast game start to all peers
      this.network.broadcastToAll(MessageTypes.LOBBY_GAME_START, {
        sharedSeed: this.sharedSeed,
        config: this.matchConfig,
      });
      
      // Start state sync loop (30Hz)
      this.startStateSyncLoop();
    } else if (!this.isHost && seed) {
      // Peer receives seed and config from host
      this.sharedSeed = seed;
      if (config) {
        this.matchConfig = { ...this.matchConfig, ...config };
      }
      
      // Initialize local player
      const localPlayer = this.players.get(this.localPlayerId);
      this.initializePlayerForMatch(localPlayer, seed);
    }
    
    console.log(`🎮 Match starting...`);
    console.log(`   Seed: ${this.sharedSeed}`);
    console.log(`   End Condition: ${this.matchConfig.endCondition} = ${this.matchConfig.endConditionValue}`);
    console.log(`   Players: ${this.players.size}`);
    
    // Show "GAME START" countdown before starting
    this.showCountdown(() => {
      this.gamePhase = 'playing';
      this.matchStartTime = Date.now();
      
      // Start game loop for all players
      this.startGameLoop();
      
      console.log(`🎮 Match started!`);
      
      // Dispatch match started event for UI (both host and peer)
      emitMultiplayerEvent(MULTIPLAYER_EVENTS.MATCH_STARTED, { gameState: this });
    });
  }
  
  /**
   * Initialize a player for the match with deterministic RNG
   */
  initializePlayerForMatch(player, seed) {
    // Reset game state
    player.gameState.reset();
    player.garbageQueue = new GarbageQueue();
    player.isAlive = true;
    // DO NOT reset frags here - they persist across rounds until full game reset
    
    // Set deterministic RNG (same seed = same pieces)
    player.gameState.randomGenerator = this.createSeededRNG(seed + player.steamId.charCodeAt(0));
    
    // Fill initial bag with deterministic pieces
    fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
    
    // Spawn first piece (no game over callback needed at start)
    spawnPiece(player.gameState, null, null);
    
    console.log(`✅ Player ${player.name} initialized with seed ${seed}`);
  }
  
  /**
   * Create seeded random number generator
   * This ensures all players get the same piece sequence!
   */
  createSeededRNG(seed) {
    let state = seed;
    return function() {
      // Linear congruential generator (LCG)
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };
  }
  
  /**
   * Start broadcasting game state at 30Hz (host only)
   */
  startStateSyncLoop() {
    if (!this.isHost) return;
    
    // Clear any existing interval
    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval);
    }
    
    // Broadcast at 30Hz, but only when state has changed
    let lastBroadcastTime = 0;
    const minBroadcastInterval = 1000 / this.STATE_SYNC_RATE;

    this.stateSyncInterval = setInterval(() => {
      if (this.gamePhase === 'playing') {
        const now = Date.now();

        // Check if any player state has changed since last broadcast
        const hasChanges = this.hasSignificantStateChanges();

        // Broadcast if changes detected OR if it's been too long (fallback sync)
        if (hasChanges || (now - lastBroadcastTime) > 500) {
          this.broadcastGameState();
          lastBroadcastTime = now;
        }
      }
    }, minBroadcastInterval);

    console.log(`📡 State sync started (${this.STATE_SYNC_RATE}Hz with delta optimization)`);
  }
  
  /**
   * Stop state sync loop
   */
  stopStateSyncLoop() {
    if (this.stateSyncInterval) {
      clearInterval(this.stateSyncInterval);
      this.stateSyncInterval = null;
      console.log('📡 State sync stopped');
    }
  }
  
  /**
   * Check if any player state has changed significantly
   * Used to avoid broadcasting when nothing has changed
   */
  hasSignificantStateChanges() {
    if (!this.isHost) return false;

    for (const [steamId, player] of this.players) {
      const lastState = this.lastBroadcastState.get(steamId);

      if (!lastState) {
        return true; // No previous state, so broadcast
      }

      const currentState = player.gameState;

      // Check for significant changes
      const hasChanges = (
        lastState.score !== currentState.score ||
        lastState.lines !== currentState.lines ||
        lastState.level !== currentState.level ||
        lastState.currentPieceY !== currentState.currentPiece?.y ||
        lastState.currentPieceX !== currentState.currentPiece?.x ||
        lastState.dropCounter !== currentState.dropCounter ||
        player.frags !== lastState.frags ||
        player.isAlive !== lastState.isAlive
      );

      if (hasChanges) {
        return true;
      }
    }

    return false; // No changes detected
  }

  /**
   * Broadcast current game state to all peers (host only)
   * Enhanced to include full board state for accurate rendering
   */
  broadcastGameState() {
    if (!this.isHost) return;

    // Update last broadcast state snapshots
    for (const [steamId, player] of this.players) {
      this.lastBroadcastState.set(steamId, {
        score: player.gameState.score,
        lines: player.gameState.lines,
        level: player.gameState.level,
        currentPieceY: player.gameState.currentPiece?.y,
        currentPieceX: player.gameState.currentPiece?.x,
        dropCounter: player.gameState.dropCounter,
        frags: player.frags,
        isAlive: player.isAlive,
      });
    }
    
    const state = {
      players: Array.from(this.players.entries()).map(([steamId, player]) => ({
        steamId,
        name: player.name,
        score: player.gameState.score,
        lines: player.gameState.lines,
        level: player.gameState.level,
        frags: player.frags,
        isAlive: player.isAlive,
        garbagePending: player.garbageQueue.getTotalLines(),
        
        // CRITICAL: Full board state for rendering
        grid: player.gameState.grid,
        currentPiece: player.gameState.currentPiece,
        nextPieces: player.gameState.nextPieces,
        dropCounter: player.gameState.dropCounter,
        dropInterval: player.gameState.dropInterval,
        
        // CRITICAL: Include locked pieces for accurate rendering
        lockedPieces: player.gameState.lockedPieces.map(piece => ({
          x: piece.x,
          y: piece.y,
          shape: piece.shape,
          color: piece.color,
          shapeKey: piece.shapeKey,
        })),
      })),
      gamePhase: this.gamePhase,
      winner: this.winner ? {
        steamId: this.winner.steamId,
        name: this.winner.name,
      } : null,
      timestamp: Date.now(),
    };
    
    this.network.broadcastToAll(MessageTypes.GAME_STATE_FULL, state);
  }
  
  /**
   * Sync state from host (peer only)
   * CRITICAL: Must trigger visual updates
   */
  syncFromHost(state) {
    if (this.isHost) return;
    
    // Update all player states from host
    state.players.forEach(playerData => {
      const player = this.players.get(playerData.steamId);
      if (player) {
        // Update stats
        player.gameState.score = playerData.score;
        player.gameState.lines = playerData.lines;
        player.gameState.level = playerData.level;
        player.frags = playerData.frags;
        player.isAlive = playerData.isAlive;
        
        // CRITICAL: Update full board state for rendering
        player.gameState.grid = playerData.grid;
        player.gameState.currentPiece = playerData.currentPiece ? {
          ...playerData.currentPiece
        } : null;
        player.gameState.nextPieces = playerData.nextPieces ? [...playerData.nextPieces] : [];
        player.gameState.dropCounter = playerData.dropCounter || 0;
        player.gameState.dropInterval = playerData.dropInterval || 1000;
        
        // CRITICAL: Update locked pieces (critical for rendering)
        player.gameState.lockedPieces = playerData.lockedPieces || [];
        player.gameState.boardCache = null;
        player.gameState.boardCacheDirty = true;
      }
    });
    
    this.gamePhase = state.gamePhase;
    this.winner = state.winner;
    
    // CRITICAL: Trigger rendering after state update
    // Note: The render loop also calls this, but we call it here too
    // to ensure immediate visual update when state arrives
    this.renderAllPlayers();
  }
  
  /**
   * Broadcast player list (host only)
   */
  broadcastPlayerList() {
    if (!this.isHost) return;
    
    const playerList = Array.from(this.players.values()).map(p => ({
      steamId: p.steamId,
      name: p.name,
      color: p.color, // NEW: Include player color
      isReady: p.isReady,
      isAlive: p.isAlive,
    }));
    
    this.network.broadcastToAll(MessageTypes.LOBBY_PLAYER_JOINED, {
      players: playerList,
    });
  }
  
  /**
   * Set local player ready status
   */
  setReady(isReady) {
    const localPlayer = this.players.get(this.localPlayerId);
    if (localPlayer) {
      localPlayer.isReady = isReady;
      
      // Broadcast to everyone
      if (this.isHost) {
        this.broadcastPlayerList();
      } else {
        this.network.sendP2PMessage(this.network.hostSteamId, MessageTypes.LOBBY_PLAYER_READY, {
          steamId: this.localPlayerId,
          isReady,
        });
      }
    }
  }
  
  /**
   * Check if all players are ready
   */
  allPlayersReady() {
    if (this.players.size < 2) return false; // Need at least 2 players
    
    return Array.from(this.players.values()).every(p => p.isReady);
  }
  
  /**
   * Get player by Steam ID
   */
  getPlayer(steamId) {
    return this.players.get(steamId);
  }
  
  /**
   * Get local player
   */
  getLocalPlayer() {
    return this.players.get(this.localPlayerId);
  }
  
  /**
   * Send garbage attack to all opponents (after line clear)
   * 
   * @param {Object} cascadeSummary - Summary of cascade (lines, colors, etc.)
   */
  sendGarbageAttack(cascadeSummary) {
    if (!this.isHost) {
      // Peers send attack info to host
      this.network.sendP2PMessage(this.network.hostSteamId, 'game:attack:request', {
        cascadeSummary,
        timestamp: Date.now(),
      });
      return;
    }
    
    // Host routes attack
    this.attackRouter.routeAttack(this.localPlayerId, cascadeSummary);
  }
  
  /**
   * Record player death (host only)
   * 
   * @param {String} deadPlayerSteamId - Steam ID of dead player
   * @param {String} killerSteamId - Steam ID of killer (null for self-kill)
   */
  recordPlayerDeath(deadPlayerSteamId, killerSteamId = null) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can record deaths');
      return;
    }
    
    this.fragTracker.recordDeath(deadPlayerSteamId, killerSteamId);
  }
  
  /**
   * Get current kill feed
   */
  getKillFeed() {
    return this.fragTracker.getKillFeed();
  }
  
  /**
   * Get current standings (ranked by frags, then score)
   */
  getStandings() {
    return this.fragTracker.getStandings();
  }
  
  /**
   * Handle host disconnection (peer only)
   */
  handleHostDisconnect() {
    if (this.isHost) {
      console.warn('⚠️ You are the host');
      return;
    }
    
    this.hostMigration.handleHostDisconnect();
  }
  
  /**
   * Get attack statistics
   */
  getAttackStats() {
    return this.attackRouter.getStats();
  }
  
  /**
   * Force end match (host only)
   */
  forceEndMatch() {
    if (!this.isHost) {
      console.warn('⚠️ Only host can force end match');
      return;
    }
    
    // Get top player as winner
    const standings = this.fragTracker.getStandings();
    const winner = standings.length > 0 ? this.players.get(standings[0].steamId) : null;
    
    if (winner) {
      this.fragTracker.endMatch(winner);
    }
  }
  
  /**
   * Configure unified loop callbacks once
   */
  configureUnifiedLoopCallbacks() {
    if (this.loopCallbacksConfigured || !this.unifiedLoop) {
      return;
    }

    this.unifiedLoop.onRender = () => {
      this.renderAllPlayers();
    };

    this.unifiedLoop.onUpdate = (currentTime, delta) => {
      if (this.gamePhase !== 'playing') {
        return;
      }

      if (this.isHost) {
        this.updateAllPlayers(delta);
      }
    };

    this.loopCallbacksConfigured = true;
  }

  /**
   * Create physics callbacks for unified game loop player registration
   */
  createPhysicsCallbacks(steamId) {
    return this.buildPhysicsCallbacks(steamId);
  }

  buildPhysicsCallbacks(steamId) {
    const isLocal = () => steamId === this.localPlayerId;
    const getPlayer = () => this.players.get(steamId);

    return {
      onGarbageReady: (summary) => {
        this.attackRouter.routeAttack(steamId, summary);
      },
      triggerFlash: (clearedRows = []) => {
        const player = getPlayer();
        if (!player) return;

        const rows = Array.isArray(clearedRows) ? clearedRows.slice() : [];
        const linesCleared = rows.length || (Array.isArray(clearedRows) ? 0 : Number(clearedRows) || 0);

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR, {
          steamId,
          playerName: player.name,
          rows,
          linesCleared,
          isLocal: isLocal(),
        });
      },
      onLineClearImpact: (lineCount = 1) => {
        const player = getPlayer();
        if (!player) return;

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT, {
          steamId,
          playerName: player.name,
          linesCleared: lineCount,
          isLocal: isLocal(),
        });
      },
      triggerCombo: (comboCount) => {
        if (comboCount > 1) {
          const player = getPlayer();
          if (!player) return;

          emitMultiplayerEvent(MULTIPLAYER_EVENTS.COMBO, {
            steamId,
            playerName: player.name,
            comboCount,
            isLocal: isLocal(),
          });
        }
      },
      onPieceLock: (piece) => {
        const player = getPlayer();
        if (!player) return;

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PIECE_LOCK, {
          steamId,
          playerName: player.name,
          piece,
          isLocal: isLocal(),
        });
      },
      spawnPiece: () => this._spawnNextPieceForPlayer(steamId),
    };
  }

  _spawnNextPieceForPlayer(steamId) {
    const player = this.players.get(steamId);
    if (!player) return;

    const gameState = player.gameState;
    if (gameState.currentPiece || gameState.isGameOver) {
      return;
    }

    spawnPiece(
      gameState,
      null,
      () => {
        const latestPlayer = this.players.get(steamId);
        if (!latestPlayer) {
          return;
        }

        console.log(`💀 ${latestPlayer.name} topped out on spawn!`);
        gameState.isGameOver = true;
        latestPlayer.isAlive = false;

        const lastAttackerId = latestPlayer.lastAttackerId;
        if (lastAttackerId) {
          const attacker = this.players.get(lastAttackerId);
          console.log(`🏆 Death on spawn attributed to last attacker: ${attacker?.name || lastAttackerId}`);
        } else {
          console.log('💀 Death on spawn with no attacker tracked (self-kill)');
        }

        this.fragTracker.recordDeath(steamId, lastAttackerId);

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
          steamId,
          playerName: latestPlayer.name,
          isLocal: steamId === this.localPlayerId,
        });
      }
    );

    if (!gameState.isGameOver) {
      this.insertPendingGarbage(steamId);
    }
  }

  /**
   * Register all players with the unified multiplayer loop (host only)
   */
  syncUnifiedLoopPlayers() {
    if (!this.unifiedLoop) {
      return;
    }

    this.unifiedLoop.clearPlayers();

    if (!this.isHost) {
      return;
    }

    this.players.forEach((player, steamId) => {
      if (!player) return;
      const physicsCallbacks = this.createPhysicsCallbacks(steamId);
      this.unifiedLoop.registerPlayer(steamId, player.gameState, physicsCallbacks, null);
    });
  }

  /**
   * Start the game loop (runs on both host and peer)
   */
  startGameLoop() {
    this.configureUnifiedLoopCallbacks();

    if (this.isHost) {
      this.syncUnifiedLoopPlayers();
    } else if (this.unifiedLoop) {
      this.unifiedLoop.clearPlayers();
    }

    if (this.unifiedLoop && !this.loopRunning) {
      this.unifiedLoop.start();
      this.loopRunning = true;
      console.log(`🎮 Unified game loop started (${this.isHost ? 'HOST' : 'PEER'} mode)`);
    }
  }
  
  /**
   * Render all player game boards (HOST & PEER)
   * This is called every frame to update visuals
  */
  renderAllPlayers() {
    // Notify main.js that rendering is needed
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.RENDER_FRAME, {
      players: Array.from(this.players.entries()).map(([steamId, player]) => ({
        steamId,
        name: player.name,
        color: player.color, // Include player color for UI badges and garbage coloring
        gameState: player.gameState,
        garbageQueue: player.garbageQueue,
        isLocal: steamId === this.localPlayerId,
        isAlive: player.isAlive,
        frags: player.frags,
      })),
    });
  }
  
  /**
   * Stop the game loop
   */
  stopGameLoop() {
    if (this.unifiedLoop && this.loopRunning) {
      this.unifiedLoop.stop();
      this.loopRunning = false;
      console.log('🛑 Game loop stopped');
    }

    if (this.unifiedLoop) {
      this.unifiedLoop.clearPlayers();
    }
  }
  
  /**
   * Update all players' game states (HOST ONLY)
   */
  updateAllPlayers(deltaTime) {
    this.players.forEach((player, steamId) => {
      if (!player) return;

      const gameState = player.gameState;
      if (gameState.isGameOver && player.isAlive) {
        const lastAttackerId = player.lastAttackerId;
        if (lastAttackerId) {
          const attacker = this.players.get(lastAttackerId);
          console.log(`🏆 Death attributed to last attacker: ${attacker?.name || lastAttackerId}`);
        } else {
          console.log('💀 Death with no attacker tracked (self-kill)');
        }

        this.fragTracker.recordDeath(steamId, lastAttackerId);
      }
    });
    
    // Check win condition
    this.fragTracker.checkMatchEnd();
  }
  
  /**
   * Restart the match (new round with same players)
   * HOST ONLY - Shows countdown 3, 2, 1, GO!
   */
  restartMatch() {
    if (!this.isHost) {
      console.warn('⚠️ Only host can restart match');
      return;
    }
    
    console.log('🔄 Restarting match...');
    
    // Stop current game
    this.stopGameLoop();
    this.stopStateSyncLoop();
    
    // Reset trackers
    if (this.fragTracker) {
      this.fragTracker.reset();
    }
    if (this.attackRouter) {
      this.attackRouter.clearHistory();
    }
    
    // IMPORTANT: Reset ALL players (including dead ones) but KEEP FRAGS/SCORES
    this.players.forEach((player, steamId) => {
      player.isAlive = true; // Revive everyone
      // DO NOT RESET FRAGS - they accumulate across rounds!
      player.garbageQueue.clear();
      player.lastAttackerId = null; // Clear last attacker for new round
      
      // Reset game state but preserve score and lines from previous rounds
      const oldScore = player.gameState.score;
      const oldLines = player.gameState.lines;
      const oldLevel = player.gameState.level;
      
      player.gameState = new GameState();
      player.gameState.score = oldScore; // Keep score across rounds
      player.gameState.lines = oldLines; // Keep lines across rounds
      player.gameState.level = oldLevel; // Keep level progression
    });
    
    // Reset match state (but keep matchStartTime for time-based win conditions)
    this.winner = null;
    this.gamePhase = 'waiting';
    
    console.log('🎮 Starting next round...');
    
    // Broadcast round restart to all peers BEFORE showing countdown
    const newSeed = Math.floor(Math.random() * 1000000);
    this.network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, {
      newSeed: newSeed,
      prefixText: 'ROUND OVER',
    });
    
    // Dispatch event to clear death visuals for all players
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
      players: Array.from(this.players.keys()),
    });
    
    // Show "ROUND OVER" then countdown: 3, 2, 1, GO!
    this.showCountdown(() => {
      this.gamePhase = 'playing';
      
      // Re-initialize players for next round (use the same seed we broadcast)
      this.players.forEach((player, steamId) => {
        // Set new deterministic RNG for this round
        player.gameState.randomGenerator = this.createSeededRNG(newSeed + player.steamId.charCodeAt(0));
        
        // Fill bag and spawn first piece
        fillBag(player.gameState.nextPieces, player.gameState.randomGenerator);
        spawnPiece(player.gameState, null, null);
      });
      
      // Start game loop
      this.startGameLoop();
      
      // Host: Start state sync loop (30Hz broadcasts to peers)
      if (this.isHost) {
        this.startStateSyncLoop();
      }
      
      console.log(`🎮 Round started!`);
    }, 'ROUND OVER'); // Show "ROUND OVER" before countdown
  }
  
  /**
   * Full game restart (resets frags too) - used when game is truly over
   * HOST ONLY
   */
  restartFullGame() {
    if (!this.isHost) {
      console.warn('⚠️ Only host can restart full game');
      return;
    }
    
    console.log('🔄 Restarting full game (resetting frags)...');
    
    // Stop current game
    this.stopGameLoop();
    this.stopStateSyncLoop();
    
    // Reset trackers
    if (this.fragTracker) {
      this.fragTracker.reset();
    }
    if (this.attackRouter) {
      this.attackRouter.clearHistory();
    }
    
    // Reset ALL players including frags/scores (full reset)
    this.players.forEach((player, steamId) => {
      player.isAlive = true;
      player.frags = 0; // RESET FRAGS for new game
      player.garbageQueue.clear();
      player.lastAttackerId = null; // Clear last attacker for new game
      
      // Complete reset
      player.gameState = new GameState();
      player.gameState.level = this.matchConfig.startLevel;
    });
    
    // Reset match state
    this.winner = null;
    this.gamePhase = 'waiting';
    
    console.log('🎮 Starting new game...');
    
    // Broadcast full game restart to all peers BEFORE showing countdown
    const newSeed = Math.floor(Math.random() * 1000000);
    this.network.broadcastToAll(MessageTypes.GAME_ROUND_RESTART, {
      newSeed: newSeed,
      prefixText: 'GAME START',
      fullReset: true, // Indicates this is a full game restart (reset frags)
    });
    
    // Dispatch event to clear death visuals
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.ROUND_RESTART, {
      players: Array.from(this.players.keys()),
    });
    
    // Show "GAME START" then countdown
    this.showCountdown(() => {
      this.startMatch();
    }, 'GAME START'); // Show "GAME START" before countdown
  }
  
  /**
   * Show countdown overlay with optional text: [TEXT] → 3, 2, 1, GO!
   * @param {Function} callback - Called after countdown finishes
   * @param {string} prefixText - Optional text to show before countdown (e.g., "ROUND OVER", "GAME START")
   */
  showCountdown(callback, prefixText = null) {
    const countdownElement = document.getElementById('multiplayer-countdown');
    
    if (!countdownElement) {
      console.warn('⚠️ Countdown element not found');
      if (callback) callback();
      return;
    }
    
    console.log('🎬 Starting countdown animation...', { prefixText });
    
    let count = 3;
    
    // Enhanced full-screen overlay with animation support
    const forceFullScreen = () => {
      countdownElement.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 99999 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: rgba(0, 0, 0, 0.85) !important;
        backdrop-filter: blur(15px) !important;
        font-family: 'Orbitron', sans-serif !important;
        font-weight: 900 !important;
        text-align: center !important;
        color: #ffffff !important;
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.9), 0 0 50px rgba(102, 126, 234, 0.7), 0 0 80px rgba(102, 126, 234, 0.4) !important;
        transform: none !important;
        translate: none !important;
        inset: 0 !important;
        opacity: 1 !important;
      `;
    };
    
    // Show prefix text first (if provided)
    if (prefixText) {
      forceFullScreen();
      countdownElement.textContent = prefixText;
      countdownElement.style.fontSize = '80px';
      countdownElement.style.color = '#fbbf24'; // Yellow/gold
      countdownElement.style.animation = 'countdownFadeInScale 0.4s ease-out forwards';
      
      console.log(`📢 Showing prefix: "${prefixText}"`);
      
      setTimeout(() => {
        countdownElement.style.animation = 'countdownFadeOut 0.2s ease-out forwards';
        setTimeout(() => startCountdown(), 200);
      }, 1400); // Show prefix for 1.4 seconds
    } else {
      forceFullScreen();
      startCountdown();
    }
    
    function startCountdown() {
      const showNumber = () => {
        // Use requestAnimationFrame for smooth UI updates
        requestAnimationFrame(() => {
          countdownElement.textContent = count;
          countdownElement.style.fontSize = '140px';
          countdownElement.style.color = count === 3 ? '#ef4444' : count === 2 ? '#f59e0b' : '#10b981'; // Red -> Orange -> Green
          countdownElement.style.animation = 'none'; // Clear previous animation
          
          // Force reflow to restart animation
          void countdownElement.offsetHeight;
          
          countdownElement.style.animation = 'countdownPulse 0.5s ease-out forwards';

          console.log(`🔢 Showing countdown: ${count}`);

          // Broadcast countdown to all players
          emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count });
        });

        count--;

        if (count >= 0) {
          setTimeout(showNumber, 750); // Smooth timing between numbers
        } else {
          // Show "GO!" immediately after countdown
          requestAnimationFrame(() => {
            countdownElement.textContent = 'GO!';
            countdownElement.style.fontSize = '160px';
            countdownElement.style.color = '#10b981'; // Bright Green
            countdownElement.style.animation = 'none';
            
            // Force reflow
            void countdownElement.offsetHeight;
            
            countdownElement.style.animation = 'countdownGo 0.6s ease-out forwards';

            emitMultiplayerEvent(MULTIPLAYER_EVENTS.COUNTDOWN, { count: 'GO' });
          });

          // Fade out entire overlay and start game
          setTimeout(() => {
            requestAnimationFrame(() => {
              countdownElement.style.transition = 'opacity 0.3s ease-out';
              countdownElement.style.opacity = '0';
            });
            
            setTimeout(() => {
              countdownElement.style.display = 'none';
              countdownElement.style.transition = '';
              countdownElement.style.opacity = ''; // Reset opacity
              if (callback) callback();
            }, 300);
          }, 600);
        }
      };

      showNumber();
    }
  }
  
  /**
   * Clean up (leave match)
   */
  cleanup() {
    this.stopGameLoop();
    this.stopStateSyncLoop();
    
    if (this.inputValidator) {
      this.inputValidator.reset();
    }
    
    if (this.fragTracker) {
      this.fragTracker.reset();
    }
    
    if (this.attackRouter) {
      this.attackRouter.clearHistory();
    }
    
    this.players.clear();
    this.gamePhase = 'waiting';
    this.winner = null;
    
    console.log('🧹 FFA game state cleaned up');
  }
}
