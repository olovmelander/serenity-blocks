/**
 * Input Validator - Anti-Cheat System
 * 
 * Host-side validation to prevent cheating:
 * - Rate limiting (prevent bots/macro spam)
 * - Input validation (ensure legal moves)
 * - Timestamp verification (prevent replay attacks)
 */

export class InputValidator {
  constructor() {
    // Track input rates per player
    this.inputRates = new Map();
    this.lastInputTime = new Map();
    this.inputCounts = new Map();
    
    // Anti-cheat limits (tuned for responsive 60fps gameplay)
    this.MAX_INPUTS_PER_SECOND = 60; // Allow fast inputs for smooth 60fps gameplay
    this.MIN_INPUT_INTERVAL = 1000 / this.MAX_INPUTS_PER_SECOND; // ~16.67ms (60fps)
    this.RATE_LIMIT_WINDOW = 1000; // 1 second window
    
    // Input history for pattern detection
    this.inputHistory = new Map(); // steamId -> array of recent inputs
    this.MAX_HISTORY_SIZE = 100;
  }
  
  /**
   * Validate player input (called by host only)
   * Returns: { valid: boolean, reason?: string }
   */
  validateInput(steamId, inputType, data, timestamp = Date.now()) {
    // Check rate limiting first (prevent spam/bots)
    const rateCheck = this.checkInputRate(steamId, timestamp);
    if (!rateCheck.valid) {
      return rateCheck;
    }
    
    // Validate timestamp (prevent old/future inputs)
    const timestampCheck = this.validateTimestamp(timestamp);
    if (!timestampCheck.valid) {
      return timestampCheck;
    }
    
    // Validate input data based on type
    switch (inputType) {
      case 'move':
        return this.validateMove(data);
      case 'rotate':
        return this.validateRotate(data);
      case 'drop':
        return this.validateDrop(data);
      default:
        return { valid: false, reason: 'Unknown input type' };
    }
  }
  
  /**
   * Check if player is exceeding input rate limits
   */
  checkInputRate(steamId, timestamp) {
    const now = timestamp || Date.now();
    
    // Get last input time
    const lastInput = this.lastInputTime.get(steamId) || 0;
    const timeSinceLastInput = now - lastInput;
    
    // Too fast? Likely a bot or macro
    if (timeSinceLastInput < this.MIN_INPUT_INTERVAL) {
      console.warn(`⚠️ Player ${steamId} exceeded input rate limit (${timeSinceLastInput}ms < ${this.MIN_INPUT_INTERVAL}ms)`);
      return { 
        valid: false, 
        reason: `Input too fast (${timeSinceLastInput}ms)` 
      };
    }
    
    // Track inputs in rolling window
    if (!this.inputCounts.has(steamId)) {
      this.inputCounts.set(steamId, []);
    }
    
    const inputs = this.inputCounts.get(steamId);
    
    // Remove old inputs outside the window
    const cutoff = now - this.RATE_LIMIT_WINDOW;
    const recentInputs = inputs.filter(t => t > cutoff);
    
    // Add current input
    recentInputs.push(now);
    this.inputCounts.set(steamId, recentInputs);
    
    // Check if too many inputs in window
    if (recentInputs.length > this.MAX_INPUTS_PER_SECOND) {
      console.warn(`⚠️ Player ${steamId} sent ${recentInputs.length} inputs in 1 second`);
      return { 
        valid: false, 
        reason: `Too many inputs (${recentInputs.length} in 1s)` 
      };
    }
    
    // Update last input time
    this.lastInputTime.set(steamId, now);
    
    return { valid: true };
  }
  
  /**
   * Validate timestamp (prevent replay attacks)
   */
  validateTimestamp(timestamp) {
    const now = Date.now();
    const diff = Math.abs(now - timestamp);
    
    // Allow 5 second clock drift (generous for network latency)
    const MAX_CLOCK_DRIFT = 5000;
    
    if (diff > MAX_CLOCK_DRIFT) {
      return { 
        valid: false, 
        reason: `Invalid timestamp (${diff}ms drift)` 
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Validate move input
   */
  validateMove(data) {
    // Move must be -1 (left) or 1 (right)
    if (data.direction !== -1 && data.direction !== 1) {
      return { 
        valid: false, 
        reason: `Invalid move direction: ${data.direction}` 
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Validate rotate input
   */
  validateRotate(data) {
    // Rotate must be 'left', 'right', or 'flip'
    const validDirections = ['left', 'right', 'flip'];
    
    if (!validDirections.includes(data.direction)) {
      return { 
        valid: false, 
        reason: `Invalid rotate direction: ${data.direction}` 
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Validate drop input
   */
  validateDrop(data) {
    // Drop must be 'soft' or 'hard'
    const validTypes = ['soft', 'hard'];
    
    if (!validTypes.includes(data.type)) {
      return { 
        valid: false, 
        reason: `Invalid drop type: ${data.type}` 
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Track input history for pattern detection (future use)
   */
  trackInput(steamId, inputType, data) {
    if (!this.inputHistory.has(steamId)) {
      this.inputHistory.set(steamId, []);
    }
    
    const history = this.inputHistory.get(steamId);
    history.push({
      type: inputType,
      data,
      timestamp: Date.now(),
    });
    
    // Keep only recent history
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }
  }
  
  /**
   * Get player stats (for debugging/admin)
   */
  getPlayerStats(steamId) {
    const history = this.inputHistory.get(steamId) || [];
    const recentInputs = this.inputCounts.get(steamId) || [];
    
    return {
      totalInputs: history.length,
      recentInputs: recentInputs.length,
      avgInputRate: recentInputs.length, // per second
      lastInputTime: this.lastInputTime.get(steamId),
    };
  }
  
  /**
   * Reset player data (when they leave)
   */
  resetPlayer(steamId) {
    this.inputRates.delete(steamId);
    this.lastInputTime.delete(steamId);
    this.inputCounts.delete(steamId);
    this.inputHistory.delete(steamId);
  }
  
  /**
   * Clear all data
   */
  reset() {
    this.inputRates.clear();
    this.lastInputTime.clear();
    this.inputCounts.clear();
    this.inputHistory.clear();
  }
}

