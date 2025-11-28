/**
 * @fileoverview Epic intro animation for SERENITY BLOCKS
 * Features cosmic particle effects, nebula clouds, stardust, 3D transforms, and galaxy colors
 */

import Phaser from 'phaser';

export class IntroAnimation {
    constructor() {
        this.container = null;
        this.isActive = false;
        this.hasCompleted = false;
        this.boundHandlers = {};
        this.phaserGame = null;
        this.particleEmitters = [];
        this.soundManager = null;
        this.introMusicTrack = 'CosmicChimes';
    }

    /**
     * Initialize and show the intro animation
     * @returns {Promise<void>} Resolves when user dismisses the intro
     */
    async show(soundManager = null) {
        if (this.hasCompleted) {
            return Promise.resolve();
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();

        this.isActive = true;
        this.createIntroHTML();
        this.setupEventListeners();
        this.startAnimations();

        // Return a promise that resolves when the intro is dismissed
        return new Promise((resolve) => {
            this.onComplete = resolve;
        });
    }

    /**
     * Set the shared sound manager used for intro music
     * @param {?Object} soundManager
     */
    setSoundManager(soundManager) {
        this.soundManager = soundManager;
    }

    /**
     * Ensure the intro music track is playing
     */
    ensureIntroMusic() {
        if (!this.soundManager) return;

        const trackKey = this.introMusicTrack;
        const hasTrackList = Array.isArray(this.soundManager.trackNames)
            && this.soundManager.trackNames.length > 0;

        if (hasTrackList && this.soundManager.trackNames.includes(trackKey)) {
            if (this.soundManager.musicTrack !== trackKey) {
                this.soundManager.setTrack(trackKey);
            } else if (typeof this.soundManager.isMusicPlaying === 'function'
                && !this.soundManager.isMusicPlaying()) {
                this.soundManager.startBackgroundMusic();
            }
            return;
        }

        if (typeof this.soundManager.isMusicPlaying === 'function'
            && this.soundManager.isMusicPlaying()) {
            return;
        }

        if (typeof this.soundManager.playAudioFile === 'function') {
            this.soundManager.musicTrack = trackKey;
            this.soundManager.playAudioFile('./assets/music/Cosmic Chimes.mp3');
        }
    }

    /**
     * Create the intro animation HTML structure
     */
    createIntroHTML() {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';

        // Create Phaser canvas container
        const phaserCanvas = document.createElement('div');
        phaserCanvas.id = 'intro-phaser-canvas';
        this.container.appendChild(phaserCanvas);

        // Initialize Phaser cosmic particle system
        this.initPhaserCosmicParticles(phaserCanvas);

        // Create particle background (floating up from bottom)
        const particles = this.createParticles();
        this.container.appendChild(particles);

        // Create floating orbs
        const orbs = this.createOrbs();
        this.container.appendChild(orbs);

        // Create title container
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container';

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        // Create chromatic aberration overlay
        const chromatic = document.createElement('div');
        chromatic.className = 'intro-chromatic';
        this.container.appendChild(chromatic);

        // Create prompt text
        const prompt = document.createElement('div');
        prompt.className = 'intro-prompt';
        prompt.innerHTML = 'PRESS ANY KEY / CLICK / TAP TO BEGIN';
        this.container.appendChild(prompt);

        // Add to body
        document.body.appendChild(this.container);
    }

    /**
     * Create animated title with individual letters
     * @returns {HTMLElement}
     */
    createAnimatedTitle() {
        const title = document.createElement('h1');
        title.className = 'intro-title';

        const text = 'SERENITY BLOCKS';
        const letters = text.split('');

        letters.forEach((char) => {
            if (char === ' ') {
                const space = document.createElement('span');
                space.className = 'intro-space';
                title.appendChild(space);
            } else {
                const letter = document.createElement('span');
                letter.className = 'intro-letter';
                letter.textContent = char;
                title.appendChild(letter);
            }
        });

        return title;
    }

    /**
     * Create floating particle background with vibrant colors
     * @returns {HTMLElement}
     */
    createParticles() {
        const particlesContainer = document.createElement('div');
        particlesContainer.className = 'intro-particles';

        // Vibrant color palette matching the theme
        const colors = [
            'rgba(100, 200, 255, 0.8)', // Cyan/Blue
            'rgba(147, 51, 234, 0.8)', // Purple
            'rgba(59, 130, 246, 0.8)', // Blue
            'rgba(236, 72, 153, 0.8)', // Pink
            'rgba(16, 185, 129, 0.8)', // Emerald/Green
            'rgba(139, 92, 246, 0.8)', // Violet
            'rgba(20, 184, 166, 0.8)', // Teal
            'rgba(255, 153, 0, 0.8)', // Orange
            'rgba(255, 255, 0, 0.8)', // Yellow
            'rgba(0, 255, 255, 0.8)', // Cyan
        ];

        // Create 80 particles (increased from 50 for more vibrant effect)
        for (let i = 0; i < 80; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-particle';

            // Random size with some variation (increased for better visibility)
            const size = Math.random() * 6 + 2;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            // Random starting position
            particle.style.left = `${Math.random() * 100}%`;

            // Random animation duration and delay
            const duration = Math.random() * 10 + 15;
            const delay = Math.random() * 5;
            particle.style.animationDuration = `${duration}s`;
            particle.style.animationDelay = `${delay}s`;

            // Random horizontal drift
            const drift = (Math.random() - 0.5) * 200;
            particle.style.setProperty('--drift', `${drift}px`);

            // Assign random color from palette
            const color = colors[Math.floor(Math.random() * colors.length)];
            particle.style.setProperty('--particle-color', color);

            particlesContainer.appendChild(particle);
        }

        return particlesContainer;
    }

    /**
     * Create glowing orbs in background
     * @returns {HTMLElement}
     */
    createOrbs() {
        const orbsContainer = document.createElement('div');
        orbsContainer.className = 'intro-orbs';

        const orbConfigs = [
            {
                color: 'rgba(100, 200, 255, 0.3)', size: 300, x: '10%', y: '20%', floatX: 50, floatY: -30, delay: 0,
            },
            {
                color: 'rgba(147, 51, 234, 0.2)', size: 400, x: '80%', y: '70%', floatX: -60, floatY: 40, delay: 2,
            },
            {
                color: 'rgba(59, 130, 246, 0.25)', size: 250, x: '50%', y: '10%', floatX: 30, floatY: 50, delay: 4,
            },
            {
                color: 'rgba(16, 185, 129, 0.2)', size: 350, x: '20%', y: '80%', floatX: -40, floatY: -50, delay: 1,
            },
        ];

        orbConfigs.forEach((config) => {
            const orb = document.createElement('div');
            orb.className = 'intro-orb';
            orb.style.width = `${config.size}px`;
            orb.style.height = `${config.size}px`;
            orb.style.left = config.x;
            orb.style.top = config.y;
            orb.style.setProperty('--orb-color', config.color);
            orb.style.setProperty('--float-x', `${config.floatX}px`);
            orb.style.setProperty('--float-y', `${config.floatY}px`);
            orb.style.animationDelay = `${config.delay}s`;
            orbsContainer.appendChild(orb);
        });

        return orbsContainer;
    }

    /**
     * Create prismatic light rays
     * @returns {HTMLElement}
     */
    createLightRays() {
        const raysContainer = document.createElement('div');
        raysContainer.className = 'intro-light-rays';

        const rayColors = [
            'rgba(100, 200, 255, 0.4)',
            'rgba(147, 51, 234, 0.3)',
            'rgba(59, 130, 246, 0.4)',
            'rgba(236, 72, 153, 0.3)',
            'rgba(16, 185, 129, 0.3)',
        ];

        // Create 12 rays
        for (let i = 0; i < 12; i++) {
            const ray = document.createElement('div');
            ray.className = 'intro-ray';
            ray.style.setProperty('--ray-color', rayColors[i % rayColors.length]);
            ray.style.transform = `translate(-50%, 0) rotate(${(i * 360) / 12}deg)`;

            // Stagger the animation
            const delay = (i * 2) / 12;
            ray.style.animationDelay = `${delay}s`;

            raysContainer.appendChild(ray);
        }

        return raysContainer;
    }

    /**
     * Initialize Phaser cosmic particle system with galaxy colors
     */
    initPhaserCosmicParticles(container) {
        console.log('[IntroAnimation] Initializing Phaser cosmic particles...');

        const config = {
            type: Phaser.AUTO,
            parent: container,
            width: window.innerWidth,
            height: window.innerHeight,
            transparent: true,
            backgroundColor: 'rgba(0,0,0,0)',
            scene: {
                create: this.createCosmicScene.bind(this),
            },
        };

        try {
            this.phaserGame = new Phaser.Game(config);
            console.log('[IntroAnimation] Phaser game created successfully');
        } catch (error) {
            console.error('[IntroAnimation] Failed to create Phaser game:', error);
        }
    }

    /**
     * Create cosmic particle scene with nebula clouds, stardust, and galaxy effects
     */
    createCosmicScene() {
        console.log('[IntroAnimation] Creating cosmic scene...');
        const scene = this.phaserGame.scene.scenes[0];
        const { width } = scene.scale;
        const { height } = scene.scale;
        console.log('[IntroAnimation] Scene dimensions:', width, 'x', height);

        // Create particle textures
        const graphics = scene.make.graphics({ x: 0, y: 0, add: false });

        // Stardust particle (small, bright)
        graphics.clear();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(2, 2, 2);
        graphics.generateTexture('stardust', 4, 4);

        // Nebula particle (larger, soft with gradient)
        graphics.clear();
        graphics.fillStyle(0xffffff, 1);
        graphics.fillCircle(10, 10, 10);
        graphics.fillStyle(0xffffff, 0.5);
        graphics.fillCircle(10, 10, 8);
        graphics.fillStyle(0xffffff, 0.2);
        graphics.fillCircle(10, 10, 6);
        graphics.generateTexture('nebula', 20, 20);

        // Cosmic dust (medium size)
        graphics.clear();
        graphics.fillStyle(0xffffff, 0.8);
        graphics.fillCircle(3, 3, 3);
        graphics.generateTexture('cosmic-dust', 6, 6);

        graphics.destroy();

        // Actual game tetromino colors (from constants.js)
        const tetrominoColors = {
            I: 0x00ff00, // Green
            O: 0xff9900, // Orange
            T: 0x0000ff, // Blue
            S: 0x00ffff, // Cyan
            Z: 0xff0000, // Red
            J: 0xffff00, // Yellow
            L: 0xcc00cc, // Purple
        };

        // Galaxy color palette for other effects
        const galaxyColors = [
            0x9333ea, // Purple
            0x3b82f6, // Blue
            0x06b6d4, // Cyan
            0x10b981, // Emerald
            0xec4899, // Pink
            0x8b5cf6, // Violet
            0x14b8a6, // Teal
        ];

        // Create background stars (static)
        console.log('[IntroAnimation] Creating 200 background stars...');
        for (let i = 0; i < 200; i++) {
            const star = scene.add.circle(
                Math.random() * width,
                Math.random() * height,
                Math.random() * 1.5 + 0.5,
                0xffffff,
                Math.random() * 0.8 + 0.2,
            );

            // Twinkling animation
            scene.tweens.add({
                targets: star,
                alpha: Math.random() * 0.3,
                duration: Math.random() * 2000 + 1000,
                yoyo: true,
                repeat: -1,
                ease: 'Sine.easeInOut',
            });
        }
        console.log('[IntroAnimation] Stars created');

        // Particle emitters from center removed for cleaner look
        console.log('[IntroAnimation] Skipping center particle emitters for cleaner cosmic look');

        // Create floating tetromino pieces
        this.createFloatingTetrominos(scene, width, height, tetrominoColors);

        // Create shooting stars occasionally
        scene.time.addEvent({
            delay: 2000,
            callback: () => {
                const startX = Math.random() * width;
                const startY = Math.random() * height * 0.3;
                const angle = Math.random() * 45 + 45; // Diagonal downward

                const shootingStar = scene.add.circle(startX, startY, 2, 0xffffff, 1);
                const trail = scene.add.particles(startX, startY, 'stardust', {
                    speed: 0,
                    scale: { start: 0.5, end: 0 },
                    alpha: { start: 1, end: 0 },
                    lifespan: 500,
                    frequency: 10,
                    tint: 0x64c8ff,
                    blendMode: 'ADD',
                    follow: shootingStar,
                });

                scene.tweens.add({
                    targets: shootingStar,
                    x: startX + Math.cos(angle * Math.PI / 180) * 400,
                    y: startY + Math.sin(angle * Math.PI / 180) * 400,
                    alpha: 0,
                    duration: 1500,
                    ease: 'Cubic.easeOut',
                    onComplete: () => {
                        shootingStar.destroy();
                        trail.destroy();
                    },
                });
            },
            loop: true,
        });

        // Store scene reference for cleanup
        this.cosmicScene = scene;
    }

    /**
     * Create floating tetromino pieces with rotation and game colors
     */
    createFloatingTetrominos(scene, width, height, tetrominoColors) {
        console.log('[IntroAnimation] Creating continuous floating tetromino pieces...');

        // Define tetromino shapes (each is an array of [x, y] offsets)
        const tetrominoShapes = {
            I: [[0, 0], [1, 0], [2, 0], [3, 0]], // I-piece
            O: [[0, 0], [1, 0], [0, 1], [1, 1]], // O-piece
            T: [[0, 0], [1, 0], [2, 0], [1, 1]], // T-piece
            S: [[1, 0], [2, 0], [0, 1], [1, 1]], // S-piece
            Z: [[0, 0], [1, 0], [1, 1], [2, 1]], // Z-piece
            J: [[0, 0], [0, 1], [1, 1], [2, 1]], // J-piece
            L: [[2, 0], [0, 1], [1, 1], [2, 1]], // L-piece
        };

        const shapeNames = Object.keys(tetrominoShapes);
        const blockSize = 6;
        const cellSize = blockSize;
        const maxTetrominos = 15; // Max tetrominos on screen at once
        let activeTetrominos = 0;

        // Array to store all active tetromino containers for collision detection
        const activeTetrominoContainers = [];

        const isSceneActive = () => {
            if (!scene || !scene.sys || !scene.sys.displayList) {
                return false;
            }
            const scenePlugin = scene.scene;
            if (scenePlugin && typeof scenePlugin.isActive === 'function' && !scenePlugin.isActive()) {
                return false;
            }
            return true;
        };

        // Function to spawn a single tetromino
        const spawnTetromino = () => {
            if (!isSceneActive()) return;

            if (activeTetrominos >= maxTetrominos) return;

            activeTetrominos++;

            // Random shape
            const shapeName = shapeNames[Math.floor(Math.random() * shapeNames.length)];
            const baseShape = tetrominoShapes[shapeName];
            const color = tetrominoColors[shapeName]; // Use actual game color for this shape

            // Normalize shape so the smallest coordinate starts at zero
            const minX = Math.min(...baseShape.map(([bx]) => bx));
            const minY = Math.min(...baseShape.map(([, by]) => by));
            const shape = baseShape.map(([bx, by]) => [bx - minX, by - minY]);

            // Random starting position (from any edge)
            const edge = Math.floor(Math.random() * 4);
            let startX;
            let startY;
            let velocityX;
            let velocityY;

            switch (edge) {
            case 0: // Top
                startX = Math.random() * width;
                startY = -100;
                velocityX = (Math.random() - 0.5) * 40;
                velocityY = Math.random() * 30 + 20;
                break;
            case 1: // Right
                startX = width + 100;
                startY = Math.random() * height;
                velocityX = -(Math.random() * 30 + 20);
                velocityY = (Math.random() - 0.5) * 40;
                break;
            case 2: // Bottom
                startX = Math.random() * width;
                startY = height + 100;
                velocityX = (Math.random() - 0.5) * 40;
                velocityY = -(Math.random() * 30 + 20);
                break;
            case 3: // Left
                startX = -100;
                startY = Math.random() * height;
                velocityX = Math.random() * 30 + 20;
                velocityY = (Math.random() - 0.5) * 40;
                break;
            default:
                startX = Math.random() * width;
                startY = Math.random() * height;
                velocityX = (Math.random() - 0.5) * 40;
                velocityY = (Math.random() - 0.5) * 40;
                break;
            }

            // Create container for the tetromino
            const container = scene.add.container(startX, startY);

            // Draw a single solid shape using graphics so the tetromino appears as one piece
            const tetrominoGraphics = scene.add.graphics();
            tetrominoGraphics.fillStyle(color, 1);
            shape.forEach(([bx, by]) => {
                const x = bx * cellSize;
                const y = by * cellSize;
                tetrominoGraphics.fillRect(x, y, blockSize, blockSize);
            });
            tetrominoGraphics.setAlpha(0.95);
            container.add(tetrominoGraphics);

            // Create neon outline glow that follows the tetromino shape
            const glowGraphics = scene.add.graphics();
            const occupied = new Set(shape.map(([bx, by]) => `${bx},${by}`));

            // Draw outline only on exterior edges
            const drawOutline = (thickness, alpha) => {
                glowGraphics.lineStyle(thickness, color, alpha);

                shape.forEach(([bx, by]) => {
                    const x = bx * cellSize;
                    const y = by * cellSize;

                    // Check each edge and only draw if it's an exterior edge
                    if (!occupied.has(`${bx},${by - 1}`)) {
                        glowGraphics.beginPath();
                        glowGraphics.moveTo(x, y);
                        glowGraphics.lineTo(x + blockSize, y);
                        glowGraphics.strokePath();
                    }
                    if (!occupied.has(`${bx + 1},${by}`)) {
                        glowGraphics.beginPath();
                        glowGraphics.moveTo(x + blockSize, y);
                        glowGraphics.lineTo(x + blockSize, y + blockSize);
                        glowGraphics.strokePath();
                    }
                    if (!occupied.has(`${bx},${by + 1}`)) {
                        glowGraphics.beginPath();
                        glowGraphics.moveTo(x, y + blockSize);
                        glowGraphics.lineTo(x + blockSize, y + blockSize);
                        glowGraphics.strokePath();
                    }
                    if (!occupied.has(`${bx - 1},${by}`)) {
                        glowGraphics.beginPath();
                        glowGraphics.moveTo(x, y);
                        glowGraphics.lineTo(x, y + blockSize);
                        glowGraphics.strokePath();
                    }
                });
            };

            // Draw multiple layers for neon glow effect
            drawOutline(4, 0.2); // Outer glow (thick, soft)
            drawOutline(2.5, 0.4); // Middle glow
            drawOutline(1.5, 0.7); // Inner glow (bright)

            container.add(glowGraphics);
            container.sendToBack(glowGraphics);

            // Store velocity and physics properties for continuous movement
            container.velocityX = velocityX;
            container.velocityY = velocityY;
            container.tetrominoColor = color;
            container.tetrominoShape = shape;

            // Calculate bounding circle for collision detection
            const maxDistance = Math.max(
                ...shape.map(([bx, by]) => Math.sqrt((bx * cellSize) ** 2 + (by * cellSize) ** 2)),
            );
            container.collisionRadius = maxDistance + blockSize;

            // Add to active containers array
            activeTetrominoContainers.push(container);

            // Add to scene update to move continuously
            const cleanupContainer = () => {
                activeTetrominos = Math.max(0, activeTetrominos - 1);
                const index = activeTetrominoContainers.indexOf(container);
                if (index > -1) {
                    activeTetrominoContainers.splice(index, 1);
                }
                if (scene?.events) {
                    scene.events.off('update', updateMovement);
                }
                if (container && container.destroy) {
                    container.destroy();
                }
            };

            const updateMovement = () => {
                if (!isSceneActive()) {
                    cleanupContainer();
                    return;
                }

                if (!container || !container.active) {
                    cleanupContainer();
                    return;
                }

                // Move the container
                container.x += container.velocityX * 0.016; // Assuming 60fps
                container.y += container.velocityY * 0.016;

                // Check for collisions with other tetrominos
                this.checkTetrominoCollisions(container, activeTetrominoContainers, scene, color);

                // Check if out of bounds (with margin for cleanup)
                const margin = 200;
                if (container.x < -margin
                    || container.x > width + margin
                    || container.y < -margin
                    || container.y > height + margin) {
                    cleanupContainer();
                }
            };

            scene.events.on('update', updateMovement);

            // Animate rotation
            scene.tweens.add({
                targets: container,
                angle: Math.random() > 0.5 ? 360 : -360,
                duration: 8000 + Math.random() * 8000,
                ease: 'Linear',
                repeat: -1,
            });

            // Animate alpha (neon pulse effect)
            scene.tweens.add({
                targets: container,
                alpha: 0.7,
                duration: 1500 + Math.random() * 1500,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1,
            });

            // Animate glow intensity (neon flicker)
            scene.tweens.add({
                targets: glowGraphics,
                alpha: 0.6,
                duration: 1000 + Math.random() * 1000,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1,
            });

            // Animate scale (very subtle breathe for distant feel)
            scene.tweens.add({
                targets: container,
                scale: 0.9,
                duration: 3000 + Math.random() * 3000,
                ease: 'Sine.easeInOut',
                yoyo: true,
                repeat: -1,
            });
        };

        // Spawn initial tetrominos
        for (let i = 0; i < 10; i++) {
            setTimeout(() => spawnTetromino(), i * 800);
        }

        // Continuously spawn new tetrominos
        scene.time.addEvent({
            delay: 1500, // Try to spawn every 1.5 seconds
            callback: spawnTetromino,
            loop: true,
        });

        console.log(`[IntroAnimation] Continuous tetromino spawning started (max: ${maxTetrominos})`);
    }

    /**
     * Check collisions between tetrominos and apply bounce physics
     */
    checkTetrominoCollisions(container, allContainers, scene, color) {
        if (!container.active) return;

        for (let i = 0; i < allContainers.length; i++) {
            const other = allContainers[i];

            // Skip self and inactive containers
            if (other === container || !other.active) continue;

            // Calculate distance between centers
            const dx = other.x - container.x;
            const dy = other.y - container.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // Check if collision occurred
            const minDistance = container.collisionRadius + other.collisionRadius;
            if (distance < minDistance && distance > 0) {
                // Collision detected! Apply bounce physics
                this.applyBouncePhysics(container, other, dx, dy, distance);

                // Create visual effects at collision point
                const collisionX = container.x + (dx / distance) * container.collisionRadius;
                const collisionY = container.y + (dy / distance) * container.collisionRadius;
                this.createCollisionEffect(scene, collisionX, collisionY, color, other.tetrominoColor);
            }
        }
    }

    /**
     * Apply bounce physics when two tetrominos collide
     */
    applyBouncePhysics(container1, container2, dx, dy, distance) {
        // Normalize collision vector
        const nx = dx / distance;
        const ny = dy / distance;

        // Calculate relative velocity
        const dvx = container2.velocityX - container1.velocityX;
        const dvy = container2.velocityY - container1.velocityY;

        // Calculate relative velocity in collision normal direction
        const dotProduct = dvx * nx + dvy * ny;

        // Don't apply forces if objects are moving apart
        if (dotProduct > 0) return;

        // Apply elastic collision with damping (bounce coefficient)
        const bounceCoefficient = 0.8; // Some energy loss for realistic bounce
        const impulse = (1 + bounceCoefficient) * dotProduct;

        // Update velocities (assuming equal mass)
        container1.velocityX += impulse * nx * 0.5;
        container1.velocityY += impulse * ny * 0.5;
        container2.velocityX -= impulse * nx * 0.5;
        container2.velocityY -= impulse * ny * 0.5;

        // Add slight random perturbation to prevent perfect alignment
        const randomFactor = 0.05;
        container1.velocityX += (Math.random() - 0.5) * randomFactor;
        container1.velocityY += (Math.random() - 0.5) * randomFactor;

        // Separate overlapping objects to prevent sticking
        const overlap = (container1.collisionRadius + container2.collisionRadius - distance) / 2;
        container1.x -= nx * overlap;
        container1.y -= ny * overlap;
        container2.x += nx * overlap;
        container2.y += ny * overlap;
    }

    /**
     * Create visual effects at collision point
     */
    createCollisionEffect(scene, x, y, color1, color2) {
        // Create particle burst at collision point
        const particleCount = 8;
        const particles = [];

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const speed = 30 + Math.random() * 20;
            const particle = scene.add.circle(x, y, 1.5, i % 2 === 0 ? color1 : color2, 1);
            particle.velocityX = Math.cos(angle) * speed;
            particle.velocityY = Math.sin(angle) * speed;
            particles.push(particle);

            // Animate particle
            scene.tweens.add({
                targets: particle,
                alpha: 0,
                scale: 0,
                duration: 400,
                ease: 'Cubic.easeOut',
                onComplete: () => particle.destroy(),
            });
        }

        // Move particles
        const moveParticles = () => {
            particles.forEach((p) => {
                if (p.active) {
                    p.x += p.velocityX * 0.016;
                    p.y += p.velocityY * 0.016;
                }
            });
        };

        const moveInterval = setInterval(() => {
            if (particles.every((p) => !p.active)) {
                clearInterval(moveInterval);
            } else {
                moveParticles();
            }
        }, 16);

        // Create flash effect at collision point
        const flash = scene.add.circle(x, y, 10, 0xffffff, 0.8);
        flash.setBlendMode(Phaser.BlendModes.ADD);

        scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2,
            duration: 300,
            ease: 'Cubic.easeOut',
            onComplete: () => flash.destroy(),
        });

        // Create expanding ring effect
        const ring = scene.add.graphics();
        ring.lineStyle(2, color1, 1);
        ring.strokeCircle(0, 0, 5);
        ring.x = x;
        ring.y = y;

        scene.tweens.add({
            targets: ring,
            alpha: 0,
            scale: 3,
            duration: 500,
            ease: 'Cubic.easeOut',
            onComplete: () => ring.destroy(),
        });
    }

    /**
     * Setup event listeners for user input
     */
    setupEventListeners() {
        // Mouse click
        this.boundHandlers.click = (e) => this.handleInteraction(e);
        this.container.addEventListener('click', this.boundHandlers.click);

        // Keyboard
        this.boundHandlers.keydown = (e) => this.handleInteraction(e);
        window.addEventListener('keydown', this.boundHandlers.keydown);

        // Touch
        this.boundHandlers.touchstart = (e) => this.handleInteraction(e);
        this.container.addEventListener('touchstart', this.boundHandlers.touchstart);

        // Gamepad (check for button press)
        this.gamepadCheckInterval = setInterval(() => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp) {
                    // Check if any button is pressed
                    for (let j = 0; j < gp.buttons.length; j++) {
                        if (gp.buttons[j].pressed) {
                            this.handleInteraction({ type: 'gamepad' });
                            break;
                        }
                    }
                }
            }
        }, 100);
    }

    /**
     * Handle user interaction (click, key press, tap, gamepad)
     */
    handleInteraction(event) {
        if (!this.isActive) return;

        // Create ripple effect at click/touch position
        if (event.clientX !== undefined && event.clientY !== undefined) {
            this.createRipple(event.clientX, event.clientY);
            this.createBurstParticles(event.clientX, event.clientY);
        } else {
            // For keyboard/gamepad, ripple from center
            const rect = this.container.getBoundingClientRect();
            this.createRipple(rect.width / 2, rect.height / 2);
            this.createBurstParticles(rect.width / 2, rect.height / 2);
        }

        // Dismiss only the text, keep the background
        this.dismissText();
    }

    /**
     * Create ripple effect at position
     */
    createRipple(x, y) {
        const ripple = document.createElement('div');
        ripple.className = 'intro-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.transform = 'translate(-50%, -50%)';
        this.container.appendChild(ripple);

        setTimeout(() => ripple.remove(), 1500);
    }

    /**
     * Create particle burst effect at position with vibrant colors
     */
    createBurstParticles(x, y) {
        const particleCount = 30; // Increased from 20

        // Vibrant color palette for burst particles
        const burstColors = [
            '#64c8ff', // Cyan
            '#9333ea', // Purple
            '#3b82f6', // Blue
            '#ec4899', // Pink
            '#10b981', // Emerald
            '#8b5cf6', // Violet
            '#14b8a6', // Teal
            '#ff9900', // Orange
            '#ffff00', // Yellow
            '#00ffff', // Cyan
        ];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'intro-burst-particle';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;

            // Random direction
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = Math.random() * 150 + 50;
            const burstX = Math.cos(angle) * distance;
            const burstY = Math.sin(angle) * distance;

            particle.style.setProperty('--burst-x', `${burstX}px`);
            particle.style.setProperty('--burst-y', `${burstY}px`);

            // Assign random color
            const color = burstColors[i % burstColors.length];
            particle.style.backgroundColor = color;
            particle.style.boxShadow = `0 0 10px ${color}`;

            this.container.appendChild(particle);

            setTimeout(() => particle.remove(), 1000);
        }
    }

    /**
     * Start animation effects
     */
    startAnimations() {
        // All animations are CSS-based and start automatically
        // This method can be used for any additional JS-based effects
    }

    /**
     * Dismiss only the text elements (title and prompt) while keeping the background
     */
    dismissText() {
        if (!this.isActive) return;

        this.isActive = false;

        // Remove event listeners
        this.container.removeEventListener('click', this.boundHandlers.click);
        window.removeEventListener('keydown', this.boundHandlers.keydown);
        this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Get text elements
        const titleContainer = this.container.querySelector('.intro-title-container');
        const prompt = this.container.querySelector('.intro-prompt');
        const chromatic = this.container.querySelector('.intro-chromatic');

        // Fade out prompt and chromatic effect
        if (prompt) prompt.classList.add('fade-out-text');
        if (chromatic) chromatic.classList.add('fade-out-text');

        // Transition title to top as logo
        if (titleContainer) {
            titleContainer.classList.add('shrink-to-logo');
        }

        // Lower the z-index so modal cards can appear on top
        if (this.container) {
            this.container.style.zIndex = '100';
            // Remove cursor pointer since we don't want clicks anymore
            this.container.style.cursor = 'default';
            this.container.style.pointerEvents = 'none';
        }

        // After animation completes, clean up and resolve
        setTimeout(() => {
            if (prompt) prompt.style.display = 'none';
            if (chromatic) chromatic.style.display = 'none';

            // Resolve the promise
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1000);
    }

    /**
     * Dismiss the intro animation completely
     */
    dismiss() {
        // Allow dismissal even if not active anymore
        if (!this.container) return;

        this.isActive = false;
        this.hasCompleted = true;

        // Remove event listeners if still attached
        if (this.container) {
            this.container.removeEventListener('click', this.boundHandlers.click);
            this.container.removeEventListener('touchstart', this.boundHandlers.touchstart);
        }
        window.removeEventListener('keydown', this.boundHandlers.keydown);

        if (this.gamepadCheckInterval) {
            clearInterval(this.gamepadCheckInterval);
        }

        // Fade out
        if (this.container) {
            this.container.classList.add('fade-out');
        }

        // Remove from DOM after fade
        setTimeout(() => {
            // Destroy Phaser game instance
            if (this.phaserGame) {
                this.phaserGame.destroy(true);
                this.phaserGame = null;
            }
            this.particleEmitters = [];
            this.cosmicScene = null;

            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            this.container = null;

            // Resolve the promise if not already resolved
            if (this.onComplete) {
                this.onComplete();
            }
        }, 1000);
    }

    /**
     * Skip the intro animation (for development/testing)
     */
    skip() {
        if (this.container) {
            this.container.classList.add('hidden');
        }

        // Cleanup Phaser
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
            this.phaserGame = null;
        }
        this.particleEmitters = [];
        this.cosmicScene = null;

        this.hasCompleted = true;
        if (this.onComplete) {
            this.onComplete();
        }
    }

    /**
     * Reset the intro animation (for replay)
     */
    reset() {
        this.hasCompleted = false;
        this.isActive = false;

        // Cleanup Phaser
        if (this.phaserGame) {
            this.phaserGame.destroy(true);
            this.phaserGame = null;
        }
        this.particleEmitters = [];
        this.cosmicScene = null;

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }

    /**
     * Show only the background animation with shrunken logo at top
     * (for returning to start modal from gameplay)
     */
    showBackgroundOnly(soundManager = null) {
        // If already showing, do nothing
        if (this.container && document.body.contains(this.container)) {
            return;
        }

        if (soundManager) {
            this.setSoundManager(soundManager);
        }

        this.ensureIntroMusic();
        this.isActive = false; // Not active for interaction
        this.hasCompleted = true; // Mark as completed so show() won't work

        // Create container
        this.container = document.createElement('div');
        this.container.id = 'intro-animation';
        this.container.classList.add('background-only'); // Add class for background-only mode
        this.container.style.zIndex = '100';
        this.container.style.pointerEvents = 'none';

        // Create Phaser canvas container
        const phaserCanvas = document.createElement('div');
        phaserCanvas.id = 'intro-phaser-canvas';
        this.container.appendChild(phaserCanvas);

        // Initialize Phaser cosmic particle system
        this.initPhaserCosmicParticles(phaserCanvas);

        // Create particle background (floating up from bottom)
        const particles = this.createParticles();
        this.container.appendChild(particles);

        // Create floating orbs
        const orbs = this.createOrbs();
        this.container.appendChild(orbs);

        // Create title container with shrunken logo
        const titleContainer = document.createElement('div');
        titleContainer.className = 'intro-title-container shrink-to-logo';

        // Create title with individual letters
        const title = this.createAnimatedTitle();
        titleContainer.appendChild(title);

        // Add shimmer effect
        const shimmer = document.createElement('div');
        shimmer.className = 'intro-shimmer';
        titleContainer.appendChild(shimmer);

        this.container.appendChild(titleContainer);

        // Add to DOM
        document.body.appendChild(this.container);

        // Trigger animations
        requestAnimationFrame(() => {
            this.container.classList.add('active');
        });
    }
}

// Create singleton instance
export const introAnimation = new IntroAnimation();
