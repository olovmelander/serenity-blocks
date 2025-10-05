// =================================================================================
// THEMES.JS - Advanced Animation Logic for Serenity Blocks
// =================================================================================

// A helper function for random numbers in a range
function random(min, max) {
    return Math.random() * (max - min) + min;
}

// =================================================================================
// 🌲 FOREST THEME
// =================================================================================

// All Forest theme particle animations are now handled by the WebGLRenderer.
// The old startForestAnimations, stopForestAnimations, and Firefly class have been removed.

function createHimalayanPeakScene() {
    // 1. Procedural Peaks for WebGL - with canvas caching optimization
    if (webglRenderer) {
        const peakLayers = [
            // z-index values are for WebGL depth, not CSS z-index. Closer to -1 is further away.
            { zIndex: -0.9, color: 'rgba(60, 70, 90, 0.7)', jaggedness: 0.3, snowLine: 0.4, seed: 12345 },
            { zIndex: -0.8, color: 'rgba(80, 90, 110, 0.8)', jaggedness: 0.5, snowLine: 0.3, seed: 23456 },
            { zIndex: -0.7, color: 'rgba(100, 110, 130, 0.9)', jaggedness: 0.7, snowLine: 0.2, seed: 34567 }
        ];

        peakLayers.forEach(layer => {
            const C_WIDTH = 2048;
            const C_HEIGHT = window.innerHeight > 1080 ? 1080 : window.innerHeight; // Cap height for performance

            // Create cache key based on layer properties and dimensions
            const cacheKey = `peak-${layer.zIndex}-${layer.color}-${layer.jaggedness}-${layer.snowLine}-${C_WIDTH}x${C_HEIGHT}`;

            // Check if we have this peak cached
            if (himalayanPeakCache.has(cacheKey)) {
                const cachedCanvas = himalayanPeakCache.get(cacheKey);
                webglRenderer.addLayer(cachedCanvas, layer.zIndex);
                return;
            }

            // Generate new peak with seeded random for deterministic output
            const rng = seededRandom(layer.seed);
            const canvas = document.createElement('canvas');
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = layer.color;
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);
            let y = canvas.height * 0.8;
            for (let x = 0; x < C_WIDTH; x++) {
                const angle = x / C_WIDTH * Math.PI * 4;
                y = canvas.height * 0.7 - Math.sin(angle) * 100 - Math.cos(angle * 0.5) * 50;
                y += (rng() - 0.5) * layer.jaggedness * 20;
                ctx.lineTo(x, y);

                // Draw snow caps
                if (y < canvas.height * layer.snowLine) {
                    ctx.fillStyle = 'rgba(240, 245, 255, 0.9)';
                    ctx.fillRect(x, y - 5, 1, 10);
                    ctx.fillStyle = layer.color;
                }
            }
            ctx.lineTo(C_WIDTH, canvas.height);
            ctx.closePath();
            ctx.fill();

            // Cache the generated canvas
            himalayanPeakCache.set(cacheKey, canvas);

            // Add the generated canvas as a layer to the WebGL renderer
            webglRenderer.addLayer(canvas, layer.zIndex);
        });
    }

    // 2. High-altitude clouds
    const cloudContainer = document.getElementById('himalayan-clouds');
    if (cloudContainer && cloudContainer.children.length === 0) {
        for (let i = 0; i < 10; i++) {
            let cloud = document.createElement('div');
            cloud.className = 'himalayan-cloud';
            cloud.style.top = `${60 + Math.random() * 30}%`;
            const duration = Math.random() * 100 + 120;
            cloud.style.animationDuration = `${duration}s`;
            cloud.style.animationDelay = `-${Math.random() * duration}s`;
            cloudContainer.appendChild(cloud);
        }
    }

    // 3. Prayer Flags
    const flagContainer = document.getElementById('himalayan-flags');
    if (flagContainer && flagContainer.children.length === 0) {
        let strand = document.createElement('div');
        strand.className = 'himalayan-prayer-strand';
        const flagColors = ['#00a8ff', '#9c88ff', '#fbc531', '#4cd137', '#e84118'];
        for (let i = 0; i < 15; i++) {
            let flag = document.createElement('div');
            flag.className = 'himalayan-prayer-flag';
            flag.style.backgroundColor = flagColors[i % flagColors.length];
            flag.style.left = `${5 + i * 6}%`;
            flag.style.animationDelay = `-${i * 0.1}s`;
            strand.appendChild(flag);
        }
        flagContainer.appendChild(strand);
    }

    // 4. Thin Air Particles are now handled by WebGLRenderer

    // 5. Sun Rays
    const sunRayContainer = document.getElementById('himalayan-sun-rays');
    if (sunRayContainer && sunRayContainer.children.length === 0) {
        for (let i = 0; i < 25; i++) {
            let ray = document.createElement('div');
            ray.className = 'himalayan-sun-ray';
            ray.style.transform = `rotate(${Math.random() * 360}deg)`;
            ray.style.animationDelay = `-${Math.random() * 12}s`;
            sunRayContainer.appendChild(ray);
        }
    }
}

function createIceTempleScene() {
    // LAYER 1: Starfield Background with Twinkling
    const starsContainer = document.getElementById('ice-temple-stars');
    if (starsContainer && starsContainer.children.length === 0) {
        const starCount = 250;
        const rng = seededRandom(11111);
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'ice-temple-star';
            const size = rng() * 1.5 + 0.5;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${rng() * 100}%`;
            star.style.top = `${rng() * 100}%`;
            star.style.setProperty('--min-opacity', `${rng() * 0.2 + 0.3}`);
            star.style.setProperty('--max-opacity', `${rng() * 0.2 + 0.6}`);
            star.style.setProperty('--twinkle-duration', `${rng() * 2 + 3}s`);
            star.style.setProperty('--twinkle-delay', `${rng() * 5}s`);
            starsContainer.appendChild(star);
        }
    }

    // LAYER 2: Aurora Borealis
    const auroraContainer = document.getElementById('ice-temple-aurora');
    if (auroraContainer && auroraContainer.children.length === 0) {
        const colors = ['#74b9ff', '#55efc4', '#a29bfe', '#8b7bd8'];
        for (let i = 0; i < 4; i++) {
            let curtain = document.createElement('div');
            curtain.className = 'ice-aurora-curtain';
            curtain.style.setProperty('--aurora-color', colors[i]);
            curtain.style.setProperty('--aurora-duration', `${20 + i * 5}s`);
            curtain.style.setProperty('--aurora-delay', `${i * 5}s`);
            curtain.style.left = `${i * 25}%`;
            if (i % 2 === 1) {
                curtain.style.animationDirection = 'alternate-reverse';
            }
            auroraContainer.appendChild(curtain);
        }
    }

    // LAYER 3: Distant Ice Mountains with Canvas
    const mountainsDistant = document.getElementById('ice-temple-mountains-distant');
    if (mountainsDistant) {
        const cacheKey = 'ice-temple-mountains-distant-3000x800';

        if (iceTempleCache.has(cacheKey)) {
            const cachedData = iceTempleCache.get(cacheKey);
            mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
            mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
        } else {
            const rng = seededRandom(22222);
            const canvas = document.createElement('canvas');
            canvas.width = 3000;
            canvas.height = 800;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'rgba(26, 58, 90, 0.6)';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);

            // Create jagged mountain silhouette
            for (let x = 0; x <= canvas.width; x += 80 + rng() * 40) {
                const peakHeight = rng() * 300 + 200;
                ctx.lineTo(x, canvas.height - peakHeight);
                ctx.lineTo(x + 40 + rng() * 30, canvas.height - peakHeight + rng() * 100);
            }

            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();

            const dataURL = `url(${canvas.toDataURL()})`;
            iceTempleCache.set(cacheKey, {
                backgroundImage: dataURL,
                backgroundSize: '3000px 800px'
            });
            mountainsDistant.style.backgroundImage = dataURL;
            mountainsDistant.style.backgroundSize = '3000px 800px';
        }
    }

    // LAYER 4: Midground Crystal Formations (WebGL)
    if (webglRenderer) {
        const cacheKey = `ice-temple-mid-crystals-${window.innerWidth}x${window.innerHeight}`;

        if (iceTempleCache.has(cacheKey)) {
            const cachedCanvas = iceTempleCache.get(cacheKey);
            webglRenderer.addLayer(cachedCanvas, -0.6);
        } else {
            const rng = seededRandom(33333);
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');

            // Draw translucent geometric crystal towers
            for (let i = 0; i < 12; i++) {
                const x = rng() * canvas.width;
                const baseY = canvas.height * (0.5 + rng() * 0.3);
                const height = rng() * 250 + 150;
                const width = rng() * 50 + 30;

                // Add glow effect
                ctx.shadowColor = 'rgba(116, 185, 255, 0.8)';
                ctx.shadowBlur = 20;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                ctx.fillStyle = 'rgba(116, 185, 255, 0.4)';
                ctx.strokeStyle = 'rgba(227, 242, 255, 0.6)';
                ctx.lineWidth = 1;

                // Hexagonal crystal
                ctx.beginPath();
                for (let j = 0; j < 6; j++) {
                    const angle = (Math.PI / 3) * j;
                    const px = x + Math.cos(angle) * width;
                    const py = baseY - height + Math.sin(angle) * width * 0.3;
                    if (j === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                // Crystal shaft
                ctx.fillStyle = 'rgba(116, 185, 255, 0.3)';
                ctx.fillRect(x - width * 0.4, baseY - height, width * 0.8, height);

                // Reset shadow for next iteration
                ctx.shadowBlur = 0;
            }

            iceTempleCache.set(cacheKey, canvas);
            webglRenderer.addLayer(canvas, -0.6);
        }
    }

    // LAYER 5: Foreground Ice Architecture (Stalactites & Stalagmites)
    if (webglRenderer) {
        const cacheKey = `ice-temple-foreground-${window.innerWidth}x${window.innerHeight}`;

        if (iceTempleCache.has(cacheKey)) {
            const cachedCanvas = iceTempleCache.get(cacheKey);
            webglRenderer.addLayer(cachedCanvas, -0.3);
        } else {
            const rng = seededRandom(44444);
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;

            // Add glow effect for ice architecture
            ctx.shadowColor = 'rgba(200, 230, 255, 0.9)';
            ctx.shadowBlur = 25;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Stalactites from ceiling
            for (let i = 0; i < 8; i++) {
                const x = rng() * canvas.width;
                const h = rng() * canvas.height * 0.4 + canvas.height * 0.15;
                const w = rng() * 60 + 40;

                ctx.fillStyle = 'rgba(227, 242, 255, 0.7)';
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x - w, h * 0.3);
                ctx.lineTo(x, h);
                ctx.lineTo(x + w, h * 0.3);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // Stalagmites from floor
            for (let i = 0; i < 8; i++) {
                const x = rng() * canvas.width;
                const h = rng() * canvas.height * 0.4 + canvas.height * 0.15;
                const w = rng() * 60 + 40;

                ctx.fillStyle = 'rgba(227, 242, 255, 0.7)';
                ctx.beginPath();
                ctx.moveTo(x, canvas.height);
                ctx.lineTo(x - w, canvas.height - h * 0.3);
                ctx.lineTo(x, canvas.height - h);
                ctx.lineTo(x + w, canvas.height - h * 0.3);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            // Reset shadow
            ctx.shadowBlur = 0;

            iceTempleCache.set(cacheKey, canvas);
            webglRenderer.addLayer(canvas, -0.3);
        }
    }

    // LAYER 6: Frozen Mist Overlay
    const mistContainer = document.getElementById('ice-temple-mist');
    if (mistContainer && mistContainer.children.length === 0) {
        for (let i = 0; i < 3; i++) {
            const mist = document.createElement('div');
            mist.className = 'ice-temple-mist-layer';
            mist.style.setProperty('--mist-duration', `${15 + i * 5}s`);
            mist.style.setProperty('--mist-delay', `${i * 5}s`);
            mist.style.opacity = `${0.1 + i * 0.05}`;
            if (i % 2 === 0) {
                mist.style.animationDirection = 'reverse';
            }
            mistContainer.appendChild(mist);
        }
    }

    // LAYER 7: Snowfall Particles
    const snowContainer = document.getElementById('ice-temple-snow');
    if (snowContainer && snowContainer.children.length === 0) {
        const rng = seededRandom(55555);
        for (let i = 0; i < 40; i++) {
            const snowflake = document.createElement('div');
            snowflake.className = 'ice-temple-snowflake';
            const size = rng() * 2 + 1;
            snowflake.style.width = `${size}px`;
            snowflake.style.height = `${size}px`;
            snowflake.style.left = `${rng() * 100}%`;
            snowflake.style.setProperty('--fall-duration', `${rng() * 10 + 10}s`);
            snowflake.style.setProperty('--fall-delay', `${rng() * 10}s`);
            snowflake.style.setProperty('--sway-amount', `${rng() * 40 - 20}px`);
            snowContainer.appendChild(snowflake);
        }
    }

    // LAYER 8: Prismatic Light Refractions
    const refractionContainer = document.getElementById('ice-temple-refractions');
    if (refractionContainer && refractionContainer.children.length === 0) {
        const colors = ['rgba(116, 185, 255, 0.4)', 'rgba(255, 255, 255, 0.5)', 'rgba(162, 155, 254, 0.4)'];
        const rng = seededRandom(66666);
        for (let i = 0; i < 12; i++) {
            let ray = document.createElement('div');
            ray.className = 'ice-refraction-ray';
            ray.style.left = `${rng() * 100}%`;
            ray.style.top = `${rng() * 100}%`;
            ray.style.setProperty('--ray-color', colors[i % colors.length]);
            ray.style.setProperty('--ray-angle', `${rng() * 360}deg`);
            ray.style.setProperty('--ray-rotation-duration', `${rng() * 30 + 30}s`);
            ray.style.setProperty('--ray-pulse-duration', `${rng() * 3 + 2}s`);
            ray.style.setProperty('--ray-delay', `${rng() * 10}s`);
            refractionContainer.appendChild(ray);
        }
    }
}

function createMoonlitGreenhouseScene() {
    // 1. Plant Silhouettes
    const plantLayers = [
        { el: document.getElementById('greenhouse-plants-back'), count: 15, color: 'rgba(5, 20, 15, 0.6)' },
        { el: document.getElementById('greenhouse-plants-mid'), count: 12, color: 'rgba(10, 30, 25, 0.7)' },
        { el: document.getElementById('greenhouse-plants-front'), count: 10, color: 'rgba(15, 40, 35, 0.8)' }
    ];

    const plantSVGs = [
        'M 50 100 C 20 80, 20 40, 50 0 C 80 40, 80 80, 50 100', // Fern-like
        'M 50 100 V 50 A 40 40 0 1 1 50 50', // Monstera-like leaf
        'M 50 100 L 50 0 M 50 20 L 80 10 M 50 40 L 20 30 M 50 60 L 80 50' // Branchy
    ];

    plantLayers.forEach(layer => {
        if (layer.el && layer.el.children.length === 0) {
            for (let i = 0; i < layer.count; i++) {
                let plant = document.createElement('div');
                plant.className = 'greenhouse-plant';
                const svg = plantSVGs[Math.floor(Math.random() * plantSVGs.length)];
                plant.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${svg}" fill="${layer.color}" stroke="${layer.color}" stroke-width="2"/></svg>')`;

                const size = Math.random() * 150 + 100;
                plant.style.width = `${size}px`;
                plant.style.height = `${size}px`;
                plant.style.left = `${Math.random() * 100}%`;
                plant.style.bottom = `${Math.random() * 20 - 10}%`;
                plant.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                plant.style.animationDelay = `-${Math.random() * 10}s`;
                layer.el.appendChild(plant);
            }
        }
    });

    // 2. Dewdrops
    const dewdropContainer = document.getElementById('greenhouse-dewdrops');
    if (dewdropContainer && dewdropContainer.children.length === 0) {
        for (let i = 0; i < 60; i++) {
            let dewdrop = document.createElement('div');
            dewdrop.className = 'dewdrop';
            dewdrop.style.left = `${Math.random() * 100}%`;
            dewdrop.style.top = `${Math.random() * 100}%`;
            dewdrop.style.animationDelay = `-${Math.random() * 8}s`;
            dewdropContainer.appendChild(dewdrop);
        }
    }

    // 3. Moths
    const mothContainer = document.getElementById('greenhouse-moths');
    if (mothContainer && mothContainer.children.length === 0) {
        for (let i = 0; i < 7; i++) {
            let moth = document.createElement('div');
            moth.className = 'greenhouse-moth';
            moth.style.setProperty('--x-start', `${Math.random() * 100}vw`);
            moth.style.setProperty('--y-start', `${Math.random() * 100}vh`);
            moth.style.setProperty('--x-end', `${Math.random() * 100}vw`);
            moth.style.setProperty('--y-end', `${Math.random() * 100}vh`);
            const duration = Math.random() * 15 + 10;
            moth.style.animationDuration = `${duration}s`;
            moth.style.animationDelay = `-${Math.random() * duration}s`;
            mothContainer.appendChild(moth);
        }
    }
}

function createMeditationTempleScene() {
    // 1. Prayer Flags
    const flagContainer = document.getElementById('meditation-temple-prayer-flags');
    if (flagContainer && flagContainer.children.length === 0) {
        const flagColors = ['#00a8ff', '#9c88ff', '#fbc531', '#4cd137', '#e84118'];
        for (let i = 0; i < 5; i++) { // 5 strands of flags
            let strand = document.createElement('div');
            strand.className = 'prayer-flag-strand';
            strand.style.left = `${10 + i * 18}%`;
            strand.style.top = `${10 + Math.random() * 15}%`;
            strand.style.transform = `rotate(${Math.random() * 10 - 5}deg)`;

            for (let j = 0; j < 7; j++) { // 7 flags per strand
                let flag = document.createElement('div');
                flag.className = 'prayer-flag';
                flag.style.backgroundColor = flagColors[j % flagColors.length];
                flag.style.left = `${j * 15}%`;
                flag.style.animationDelay = `-${j * 0.1 + Math.random() * 0.5}s`;
                strand.appendChild(flag);
            }
            flagContainer.appendChild(strand);
        }
    }

    // 2. Incense Smoke from Braziers
    const incenseContainer = document.getElementById('meditation-temple-incense');
    if (incenseContainer && incenseContainer.children.length === 0) {
        for (let i = 0; i < 5; i++) {
            let wisp = document.createElement('div');
            wisp.className = 'temple-incense-wisp';
            wisp.style.left = `${20 + Math.random() * 60}%`;
            wisp.style.bottom = '20%'; // Start from brazier height
            const duration = Math.random() * 25 + 20;
            wisp.style.animationDuration = `${duration}s`;
            wisp.style.animationDelay = `-${Math.random() * duration}s`;
            incenseContainer.appendChild(wisp);
        }
    }

    // 3. Ancient Trees
    const treeContainer = document.getElementById('meditation-temple-trees');
    if (treeContainer && treeContainer.children.length === 0) {
        const canvas = document.createElement('canvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const ctx = canvas.getContext('2d');

        // Draw a few gnarled trees
        drawGnarledTree(ctx, canvas.width * 0.1, canvas.height, 120, -90, 12, 'rgba(40, 30, 20, 0.7)');
        drawGnarledTree(ctx, canvas.width * 0.85, canvas.height, 150, -90, 15, 'rgba(30, 20, 10, 0.8)');

        canvas.style.position = 'absolute';
        canvas.style.bottom = '0';
        canvas.style.left = '0';
        treeContainer.appendChild(canvas);
    }

    function drawGnarledTree(ctx, x, y, len, angle, width, color) {
        if (width < 0.5) return;
        ctx.beginPath();
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.moveTo(x, y);
        const x2 = x + len * Math.cos(angle * Math.PI / 180);
        const y2 = y + len * Math.sin(angle * Math.PI / 180);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const newLen = len * (0.6 + Math.random() * 0.1);
        drawGnarledTree(ctx, x2, y2, newLen, angle + Math.random() * 30 + 10, width * 0.7, color);
        drawGnarledTree(ctx, x2, y2, newLen, angle - (Math.random() * 30 + 10), width * 0.7, color);
        if (Math.random() > 0.6) {
            drawGnarledTree(ctx, x2, y2, newLen * 0.5, angle + Math.random() * 20 - 10, width * 0.5, color);
        }
    }

    // 4. Bells, Prayer Wheels, and Monks
    const templeContainer = document.getElementById('meditation-temple-main');
    if (templeContainer && templeContainer.children.length === 0) {
        // Add swaying bells
        for (let i = 0; i < 3; i++) {
            let bell = document.createElement('div');
            bell.className = 'temple-bell';
            bell.style.left = `${25 + i * 25}%`;
            bell.style.top = '45%';
            bell.style.animationDelay = `-${Math.random() * 8}s`;
            templeContainer.appendChild(bell);
        }
        // Add spinning prayer wheels
        for (let i = 0; i < 4; i++) {
            let wheel = document.createElement('div');
            wheel.className = 'prayer-wheel';
            wheel.style.left = `${10 + i * 22}%`;
            wheel.style.bottom = '-10%';
            wheel.style.animationDelay = `-${Math.random() * 15}s`;
            templeContainer.appendChild(wheel);
        }
    }

    const midMountainContainer = document.getElementById('meditation-temple-mountains-mid');
    if (midMountainContainer && midMountainContainer.children.length < 2) { // Check to avoid re-adding
        // Add monk silhouettes
        for (let i = 0; i < 2; i++) {
            let monk = document.createElement('div');
            monk.className = 'monk-silhouette';
            monk.style.left = `${20 + i * 50 + Math.random() * 10}%`;
            monk.style.bottom = `${35 + Math.random() * 5}%`;
            monk.style.transform = `scaleX(${Math.random() > 0.5 ? 1 : -1})`;
            midMountainContainer.appendChild(monk);
        }
    }
}

function createFloatingIslandsScene() {
    const palette = {
        grass: { bright: '#7CB342', deep: '#558B2F', highlight: '#AED581' },
        soil: { base: '#8B7355', dark: '#654321' },
        rock: { face: '#7A6A5D', moss: '#4A7C59' },
        tree: { trunk: '#5D4E37', foliageBright: '#9ACD32', foliageMid: '#6B8E23', foliageShadow: '#4A6A2E' },
    };

    const waterfallIntervals = [];

    const createWaterfallEffect = (container, startX, startY, fallHeight) => {
        const fallRate = 30; // particles per second
        const intervalId = setInterval(() => {
            const particle = document.createElement('div');
            particle.className = 'waterfall-particle';

            const x = startX + random(-8, 8);
            const duration = (fallHeight / random(250, 400)); // Adjust speed

            particle.style.left = `${x}px`;
            particle.style.top = `${startY}px`;
            particle.style.height = `${random(40, 80)}px`;
            particle.style.animationDuration = `${duration}s`;

            container.appendChild(particle);

            // Create mist puff when particle "lands"
            const mistPuff = document.createElement('div');
            mistPuff.className = 'waterfall-mist-puff';
            mistPuff.style.left = `${x}px`;
            mistPuff.style.bottom = `${random(-20, 30)}px`;
            // Delay the mist puff animation to match the particle's fall time
            mistPuff.style.animationDelay = `${duration - 0.2}s`;
            container.appendChild(mistPuff);

            // Remove particles and mist after animations
            const totalLifetime = (duration + 2) * 1000; // fall duration + mist duration
            setTimeout(() => {
                particle.remove();
                mistPuff.remove();
            }, totalLifetime);

        }, 1000 / fallRate);

        waterfallIntervals.push(intervalId);
    };

    const drawMajesticTree = (ctx, x, y, height) => {
        const trunkWidth = height / 7;
        const canopyRadius = height / 1.8;
        const trunkGradient = ctx.createLinearGradient(x - trunkWidth / 2, y, x + trunkWidth / 2, y);
        trunkGradient.addColorStop(0, '#3E2F1F');
        trunkGradient.addColorStop(0.5, palette.tree.trunk);
        trunkGradient.addColorStop(1, '#6F5C42');
        ctx.fillStyle = trunkGradient;
        ctx.beginPath();
        ctx.moveTo(x - trunkWidth / 2, y);
        ctx.lineTo(x + trunkWidth / 2, y);
        ctx.lineTo(x + trunkWidth * 0.7, y - height);
        ctx.lineTo(x - trunkWidth * 0.7, y - height);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = palette.tree.foliageShadow;
        ctx.beginPath();
        ctx.arc(x, y - height, canopyRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette.tree.foliageMid;
        ctx.beginPath();
        ctx.arc(x - canopyRadius / 5, y - height - canopyRadius / 5, canopyRadius * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette.tree.foliageBright;
        ctx.beginPath();
        ctx.arc(x + canopyRadius / 6, y - height - canopyRadius / 4, canopyRadius * 0.75, 0, Math.PI * 2);
        ctx.fill();
    };

    const drawIsland = (ctx, island) => {
        const { x, y, width, height } = island;
        const topSurface = [];
        for (let i = 0; i <= width; i++) {
            const angle = (i / width) * Math.PI;
            const bump = Math.sin(angle) * 20 + Math.sin(angle*3) * 5;
            topSurface.push({x: x + i, y: y - bump});
        }
        island.topSurface = topSurface; // Store for waterfalls

        const bottomSurface = [];
        for (let i = width; i >= 0; i--) {
            const angle = (i / width) * Math.PI;
            const bump = Math.sin(angle) * (height*0.8) + Math.sin(angle*2) * 20 + Math.random() * 15;
            bottomSurface.push({x: x + i, y: y + bump});
        }
        const rockGradient = ctx.createLinearGradient(x, y, x, y + height);
        rockGradient.addColorStop(0, palette.soil.base);
        rockGradient.addColorStop(0.5, palette.rock.face);
        rockGradient.addColorStop(1, palette.soil.dark);
        ctx.fillStyle = rockGradient;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(bottomSurface[0].x, bottomSurface[0].y);
        bottomSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
        for(let i=0; i<width/8; i++) {
            const rootStartX = x + random(width * 0.1, width * 0.9);
            const rootStartY = y + height * random(0.5, 1);
            ctx.strokeStyle = palette.soil.dark;
            ctx.lineWidth = random(2, 6);
            ctx.beginPath();
            ctx.moveTo(rootStartX, rootStartY);
            ctx.bezierCurveTo(rootStartX + random(-20, 20), rootStartY + 30, rootStartX + random(-10, 10), rootStartY + 60, rootStartX + random(-5, 5), rootStartY + 90);
            ctx.stroke();
        }
        ctx.fillStyle = palette.grass.deep;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.lineTo(topSurface[topSurface.length-1].x, topSurface[topSurface.length-1].y + 20);
        ctx.lineTo(topSurface[0].x, topSurface[0].y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = palette.grass.bright;
        ctx.beginPath();
        ctx.moveTo(topSurface[0].x, topSurface[0].y);
        topSurface.forEach(p => ctx.lineTo(p.x, p.y + 5));
        ctx.closePath();
        ctx.fill();
        if(island.tree) {
            drawMajesticTree(ctx, x + width / 2, topSurface[Math.floor(width/2)].y, island.tree.height);
        }
        for(let i=0; i<island.bushes; i++) {
            const bushX = x + random(0, width);
            const bushY = topSurface[Math.floor(bushX - x)].y;
            ctx.fillStyle = palette.tree.foliageMid;
            ctx.beginPath();
            ctx.arc(bushX, bushY, 15, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = palette.tree.foliageBright;
            ctx.beginPath();
            ctx.arc(bushX-5, bushY-5, 12, 0, Math.PI*2);
            ctx.fill();
        }
    };
    const C_WIDTH = 4096;
    const C_HEIGHT = window.innerHeight;

    // Set the width of the containers to match the parallax canvas
    document.querySelectorAll('.fi-waterfall-container').forEach(wc => {
        wc.style.width = `${C_WIDTH}px`;
    });

    const layers = [
        { el: document.getElementById('fi-layer-front'), wc: document.getElementById('fi-waterfall-front'),
          islands: [ { x: C_WIDTH*0.1, y: C_HEIGHT*0.5, width: 600, height: 250, tree: { height: 200 }, bushes: 5, waterfall: { edge: 0.9, width: 25 } } ] },
        { el: document.getElementById('fi-layer-mid'), wc: document.getElementById('fi-waterfall-mid'),
          islands: [ { x: C_WIDTH*0.6, y: C_HEIGHT*0.3, width: 450, height: 180, tree: { height: 120 }, bushes: 3, waterfall: { edge: 0.85, width: 20 } },
                     { x: C_WIDTH*0.8, y: C_HEIGHT*0.6, width: 300, height: 120, tree: { height: 80 }, bushes: 2, waterfall: false } ] },
        { el: document.getElementById('fi-layer-back'), wc: document.getElementById('fi-waterfall-back'),
          islands: [ { x: C_WIDTH*0.3, y: C_HEIGHT*0.4, width: 250, height: 100, tree: { height: 60 }, bushes: 1, waterfall: { edge: 0.9, width: 15 } },
                     { x: C_WIDTH*0.05, y: C_HEIGHT*0.7, width: 200, height: 80, tree: { height: 50 }, bushes: 0, waterfall: false } ] }
    ];

    layers.forEach(layer => {
        if (layer.el && layer.el.querySelector('canvas') === null) {
            const canvas = document.createElement('canvas');
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');
            layer.islands.forEach(island => drawIsland(ctx, island));
            canvas.style.position = 'absolute';
            canvas.style.left = '0';
            canvas.style.bottom = '0';
            canvas.style.width = `${C_WIDTH}px`;
            canvas.style.height = '100%';
            layer.el.insertBefore(canvas, layer.el.firstChild);
        }

        if (layer.wc) {
            layer.islands.forEach(island => {
                if (island.waterfall && island.topSurface) {
                    const edgeIndex = Math.floor(island.topSurface.length * island.waterfall.edge);
                    const edgePoint = island.topSurface[edgeIndex];
                    const fallHeight = C_HEIGHT - edgePoint.y;
                    createWaterfallEffect(layer.wc, edgePoint.x, edgePoint.y, fallHeight);
                }
            });
        }
    });

    const mountainContainer = document.getElementById('fi-mountains-back');
    if (mountainContainer && mountainContainer.children.length === 0) {
        const canvas = document.createElement('canvas');
        canvas.width = C_WIDTH;
        canvas.height = C_HEIGHT;
        const ctx = canvas.getContext('2d');
        const mountainColors = ['#8FA5B8', '#7A8FA0'];
        for (let i = 0; i < mountainColors.length; i++) {
            ctx.fillStyle = mountainColors[i];
            ctx.beginPath();
            ctx.moveTo(0, C_HEIGHT);
            let y = C_HEIGHT * (0.5 + i * 0.1);
            for (let x = 0; x < C_WIDTH; x += 20) {
                ctx.lineTo(x, y - Math.sin(x * 0.001 + i) * 100 + Math.random()*20);
            }
            ctx.lineTo(C_WIDTH, C_HEIGHT);
            ctx.closePath();
            ctx.fill();
        }
        canvas.style.position = 'absolute';
        canvas.style.left = '0';
        canvas.style.bottom = '0';
        canvas.style.width = `${C_WIDTH}px`;
        canvas.style.height = '100%';
        mountainContainer.appendChild(canvas);
    }
    return {
        cleanup: () => {
            waterfallIntervals.forEach(clearInterval);
            document.querySelectorAll('.waterfall-particle, .waterfall-mist-puff').forEach(el => el.remove());
        }
    };
}

function createCherryBlossomGardenScene() {
    // 1. Dreamy sky details
    const cloudContainer = document.getElementById('cherry-blossom-clouds');
    if (cloudContainer && cloudContainer.children.length === 0) {
        const cloudCount = window.innerWidth > 1100 ? 7 : 5;
        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'cherry-blossom-cloud';
            cloud.style.top = `${5 + Math.random() * 25}%`;
            cloud.style.setProperty('--cloud-scale', `${0.6 + Math.random() * 0.7}`);
            const duration = 60 + Math.random() * 40;
            cloud.style.setProperty('--cloud-duration', `${duration}s`);
            cloud.style.animationDelay = `-${Math.random() * duration}s`;
            cloudContainer.appendChild(cloud);
        }
    }

    // 2. Falling Petals are now handled by WebGLRenderer.

    // 3. Procedural, swaying trees
    const branchContainer = document.getElementById('cherry-blossom-branches');
    if (branchContainer && branchContainer.children.length === 0) {
        const canvas = document.createElement('canvas');
        const C_WIDTH = 2048;
        const C_HEIGHT = 1080;
        canvas.width = C_WIDTH;
        canvas.height = C_HEIGHT;
        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const treeLayers = [
            { count: 3, color: '#2c1e1e', bloomColors: ['#ff8fab', '#ff7f9e', '#e7738c'], baseWidth: 28 },
            { count: 5, color: '#3b2a2a', bloomColors: ['#ff8fab', '#ff7f9e', '#e7738c'], baseWidth: 22 }
        ];

        const drawBranch = (x1, y1, len, angle, width, colors, depth = 0) => {
            if (width < 2 || depth > 10) return; // Add depth limit to prevent stack overflow

            ctx.beginPath();
            ctx.lineWidth = width;
            ctx.strokeStyle = colors.color;
            ctx.moveTo(x1, y1);
            const x2 = x1 + len * Math.cos(angle * Math.PI / 180);
            const y2 = y1 + len * Math.sin(angle * Math.PI / 180);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Create dense flower clusters on smaller branches
            if (width < 15) {
                const clusterSize = 40 + (15 - width) * 5;
                const numBlooms = 30 + (15 - width) * 3;
                for (let i = 0; i < numBlooms; i++) {
                    const angleOffset = (Math.random() * 2 - 1) * Math.PI;
                    const radiusOffset = Math.random() * clusterSize;
                    const bloomX = x2 + Math.cos(angleOffset) * radiusOffset;
                    const bloomY = y2 + Math.sin(angleOffset) * radiusOffset;
                    const bloomRadius = Math.random() * 10 + 5;

                    ctx.beginPath();
                    ctx.arc(bloomX, bloomY, bloomRadius, 0, Math.PI * 2);
                    ctx.fillStyle = colors.bloomColors[Math.floor(Math.random() * colors.bloomColors.length)];
                    ctx.globalAlpha = Math.random() * 0.4 + 0.6;
                    ctx.fill();
                }
                ctx.globalAlpha = 1.0;
            }

            const newLen = len * (0.75 + Math.random() * 0.1);
            drawBranch(x2, y2, newLen, angle + (Math.random() * 20 + 10), width * 0.75, colors, depth + 1);
            drawBranch(x2, y2, newLen, angle - (Math.random() * 20 + 10), width * 0.75, colors, depth + 1);
        };

        treeLayers.forEach(layer => {
            for (let i = 0; i < layer.count; i++) {
                const x = Math.random() * C_WIDTH;
                const y = C_HEIGHT;
                const length = Math.random() * 50 + 100;
                drawBranch(x, y, length, -90, layer.baseWidth, { color: layer.color, bloomColors: layer.bloomColors });
            }
        });

        canvas.style.position = 'absolute';
        canvas.style.bottom = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        branchContainer.appendChild(canvas);
    }

    // 4. Floating Cherry Leaves
    const leafContainer = document.getElementById('cherry-blossom-leaves');
    if (leafContainer && leafContainer.children.length === 0) {
        const leafCount = 50; // Increased count
        for (let i = 0; i < leafCount; i++) {
            const leaf = document.createElement('div');
            leaf.className = 'cherry-leaf';

            const yStart = -10 - Math.random() * 20;
            leaf.style.setProperty('--y-start', `${yStart}vh`);
            leaf.style.setProperty('--y-end', `${110 + Math.random() * 10}vh`);

            const xStart = Math.random() * 100;
            leaf.style.setProperty('--x-start', `${xStart}vw`);
            leaf.style.setProperty('--x-end', `${xStart + (Math.random() - 0.5) * 60}vw`);

            leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
            leaf.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

            leaf.style.setProperty('--leaf-size', `${Math.random() * 5 + 8}px`); // Smaller, more numerous petals

            const duration = 12 + Math.random() * 8;
            leaf.style.animationDuration = `${duration}s`;
            leaf.style.animationDelay = `-${Math.random() * duration}s`;

            leafContainer.appendChild(leaf);
        }
    }
}

function createCandlelitMonasteryScene() {
    // 1. Stone Archways and Columns (WebGL) - Ancient weathered textures
    if (webglRenderer) {
        const archwayLayers = [
            { zIndex: -0.9, brightness: 0.4, detail: 'low' },
            { zIndex: -0.8, brightness: 0.6, detail: 'mid' },
            { zIndex: -0.7, brightness: 0.8, detail: 'high' }
        ];

        archwayLayers.forEach(layer => {
            const canvas = document.createElement('canvas');
            const C_WIDTH = window.innerWidth * 2;
            const C_HEIGHT = window.innerHeight;
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');

            // Stone texture with age marks
            const baseColor = `rgba(${45 + layer.brightness * 30}, ${35 + layer.brightness * 25}, ${25 + layer.brightness * 20}, 0.9)`;
            ctx.fillStyle = baseColor;

            const singleArchSVGWidth = 800;
            const scaledArchWidth = 400;
            const numRepeats = Math.ceil(C_WIDTH / scaledArchWidth);

            for (let i = 0; i < numRepeats; i++) {
                ctx.save();
                ctx.translate(i * scaledArchWidth, 0);

                const scaleX = scaledArchWidth / singleArchSVGWidth;
                const scaleY = C_HEIGHT / 600;
                ctx.scale(scaleX, scaleY);

                // Draw archways
                const path = new Path2D("M 100 600 C 100 300, 300 300, 300 600 Z M 500 600 C 500 300, 700 300, 700 600 Z");
                ctx.fill(path);

                // Add weathered texture and cracks
                if (layer.detail !== 'low') {
                    ctx.strokeStyle = `rgba(30, 20, 15, ${0.3 * layer.brightness})`;
                    ctx.lineWidth = 2;
                    // Vertical weathering
                    for (let j = 0; j < 3; j++) {
                        const x = 150 + Math.random() * 100;
                        ctx.beginPath();
                        ctx.moveTo(x, 300);
                        ctx.lineTo(x + (Math.random() - 0.5) * 20, 600);
                        ctx.stroke();
                    }
                }

                ctx.restore();
            }

            webglRenderer.addLayer(canvas, layer.zIndex);
        });
    }

    // 2. Pillar Candles - Varying heights with realistic flickering
    const candleContainer = document.getElementById('monastery-candles');
    if (candleContainer && candleContainer.children.length === 0) {
        // Create rows of candles
        const candleRows = [
            { count: 8, bottom: 5, heightRange: [120, 180] },  // Front row - tallest
            { count: 10, bottom: 15, heightRange: [90, 150] }, // Mid row
            { count: 12, bottom: 25, heightRange: [60, 120] }  // Back row - shortest
        ];

        candleRows.forEach(row => {
            for (let i = 0; i < row.count; i++) {
                let candle = document.createElement('div');
                candle.className = 'monastery-candle';

                const height = Math.random() * (row.heightRange[1] - row.heightRange[0]) + row.heightRange[0];
                candle.style.height = `${height}px`;
                candle.style.left = `${(i / row.count) * 95 + Math.random() * 5}%`;
                candle.style.bottom = `${row.bottom + Math.random() * 5}%`;
                candle.style.animationDelay = `-${Math.random() * 5}s`;

                // Realistic flame with glow
                let flame = document.createElement('div');
                flame.className = 'candle-flame';
                flame.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;
                candle.appendChild(flame);

                candleContainer.appendChild(candle);
            }
        });
    }

    // 3. Incense Smoke is now handled by WebGLRenderer

    // 4. Stained Glass Windows - Colored light patterns
    const lightContainer = document.getElementById('monastery-stained-glass-light');
    if (lightContainer && lightContainer.children.length === 0) {
        const stainedGlassColors = [
            'rgba(180, 50, 50, 0.4)',   // Ruby red
            'rgba(50, 100, 180, 0.4)',  // Sapphire blue
            'rgba(180, 120, 50, 0.4)',  // Amber gold
            'rgba(120, 50, 150, 0.4)',  // Purple
            'rgba(50, 150, 100, 0.4)'   // Emerald green
        ];

        // Create multiple colored light beams
        for (let i = 0; i < 3; i++) {
            let lightBeam = document.createElement('div');
            lightBeam.className = 'stained-glass-beam';
            const color = stainedGlassColors[Math.floor(Math.random() * stainedGlassColors.length)];
            lightBeam.style.background = `linear-gradient(180deg, ${color} 0%, transparent 100%)`;
            lightBeam.style.left = `${15 + i * 35}%`;
            lightBeam.style.width = `${150 + Math.random() * 100}px`;
            lightBeam.style.animationDelay = `-${Math.random() * 8}s`;
            lightContainer.appendChild(lightBeam);
        }
    }

    // 5. Dancing Shadows from Candlelight
    const shadowContainer = document.getElementById('monastery-shadows');
    if (shadowContainer && shadowContainer.children.length === 0) {
        for (let i = 0; i < 8; i++) {
            let shadow = document.createElement('div');
            shadow.className = 'dancing-shadow';
            shadow.style.left = `${Math.random() * 100}%`;
            shadow.style.animationDelay = `-${Math.random() * 6}s`;
            shadow.style.animationDuration = `${4 + Math.random() * 3}s`;
            shadowContainer.appendChild(shadow);
        }
    }

    // 6. Prayer Beads - Swaying gently
    const beadsContainer = document.getElementById('monastery-prayer-beads');
    if (beadsContainer && beadsContainer.children.length === 0) {
        for (let i = 0; i < 4; i++) {
            let beads = document.createElement('div');
            beads.className = 'prayer-beads';
            beads.style.left = `${20 + i * 20}%`;
            beads.style.top = `${Math.random() * 10}%`;
            beads.style.animationDelay = `-${Math.random() * 4}s`;
            beadsContainer.appendChild(beads);
        }
    }

    // 7. Religious Artifacts - Silhouettes
    const artifactContainer = document.getElementById('monastery-artifacts');
    if (artifactContainer && artifactContainer.children.length === 0) {
        const artifacts = [
            { type: 'cross', left: 10, bottom: 15, size: 80 },
            { type: 'bowl', left: 85, bottom: 20, size: 60 },
            { type: 'bell', left: 50, bottom: 10, size: 70 }
        ];

        artifacts.forEach(artifact => {
            let elem = document.createElement('div');
            elem.className = `artifact artifact-${artifact.type}`;
            elem.style.left = `${artifact.left}%`;
            elem.style.bottom = `${artifact.bottom}%`;
            elem.style.width = `${artifact.size}px`;
            elem.style.height = `${artifact.size}px`;
            artifactContainer.appendChild(elem);
        });
    }
}

// The Firefly class has been migrated to a particle behavior in WebGLRenderer.

        // =================================================================================
        // HIGH SCORE MANAGER - IndexedDB-based score tracking
        // =================================================================================
        class HighScoreManager {
            constructor() {
                this.db = null;
                this.DB_NAME = 'SerenityBlocksDB';
                this.DB_VERSION = 1;
                this.STORES = {
                    HIGH_SCORES: 'highScores',
                    STATISTICS: 'statistics',
                    GAME_HISTORY: 'gameHistory'
                };
            }

            async init() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        this.db = request.result;
                        resolve();
                    };

                    request.onupgradeneeded = (event) => {
                        const db = event.target.result;

                        // High Scores Store - sorted by score descending
                        if (!db.objectStoreNames.contains(this.STORES.HIGH_SCORES)) {
                            const highScoreStore = db.createObjectStore(this.STORES.HIGH_SCORES, {
                                keyPath: 'id',
                                autoIncrement: true
                            });
                            highScoreStore.createIndex('score', 'score', { unique: false });
                            highScoreStore.createIndex('timestamp', 'timestamp', { unique: false });
                        }

                        // Statistics Store - single record with aggregate stats
                        if (!db.objectStoreNames.contains(this.STORES.STATISTICS)) {
                            db.createObjectStore(this.STORES.STATISTICS, { keyPath: 'id' });
                        }

                        // Game History Store - recent games (keep last 50)
                        if (!db.objectStoreNames.contains(this.STORES.GAME_HISTORY)) {
                            const historyStore = db.createObjectStore(this.STORES.GAME_HISTORY, {
                                keyPath: 'id',
                                autoIncrement: true
                            });
                            historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                        }
                    };
                });
            }

            async saveScore(scoreData) {
                if (!this.db) await this.init();

                const gameRecord = {
                    score: scoreData.score,
                    lines: scoreData.lines,
                    level: scoreData.level,
                    speedMultiplier: scoreData.speedMultiplier,
                    theme: scoreData.theme,
                    musicTrack: scoreData.musicTrack,
                    timestamp: Date.now()
                };

                // Save to high scores
                await this._addToStore(this.STORES.HIGH_SCORES, gameRecord);

                // Save to game history
                await this._addToStore(this.STORES.GAME_HISTORY, gameRecord);

                // Trim high scores to top 100
                await this._trimHighScores(100);

                // Trim game history to last 50 games
                await this._trimGameHistory(50);

                // Update statistics
                await this._updateStatistics(gameRecord);

                return gameRecord;
            }

            async getTopScores(limit = 10) {
                if (!this.db) await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
                    const store = transaction.objectStore(this.STORES.HIGH_SCORES);
                    const index = store.index('score');
                    const request = index.openCursor(null, 'prev'); // Descending order

                    const scores = [];
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor && scores.length < limit) {
                            scores.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(scores);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            }

            async getStatistics() {
                if (!this.db) await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.STORES.STATISTICS], 'readonly');
                    const store = transaction.objectStore(this.STORES.STATISTICS);
                    const request = store.get('stats');

                    request.onsuccess = () => {
                        const stats = request.result || {
                            id: 'stats',
                            totalGames: 0,
                            totalScore: 0,
                            totalLines: 0,
                            highestScore: 0,
                            highestLevel: 0,
                            bestScorePerLevel: {}
                        };
                        resolve(stats);
                    };
                    request.onerror = () => reject(request.error);
                });
            }

            async getGameHistory(limit = 20) {
                if (!this.db) await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.STORES.GAME_HISTORY], 'readonly');
                    const store = transaction.objectStore(this.STORES.GAME_HISTORY);
                    const index = store.index('timestamp');
                    const request = index.openCursor(null, 'prev'); // Most recent first

                    const history = [];
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor && history.length < limit) {
                            history.push(cursor.value);
                            cursor.continue();
                        } else {
                            resolve(history);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            }

            async getRank(score) {
                if (!this.db) await this.init();

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readonly');
                    const store = transaction.objectStore(this.STORES.HIGH_SCORES);
                    const index = store.index('score');
                    const request = index.openCursor(IDBKeyRange.lowerBound(score, true), 'prev');

                    let rank = 1;
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            rank++;
                            cursor.continue();
                        } else {
                            resolve(rank);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            }

            // Private helper methods
            async _addToStore(storeName, data) {
                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    const request = store.add(data);

                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            }

            async _trimHighScores(limit) {
                const transaction = this.db.transaction([this.STORES.HIGH_SCORES], 'readwrite');
                const store = transaction.objectStore(this.STORES.HIGH_SCORES);
                const index = store.index('score');
                const request = index.openCursor(null, 'prev');

                let count = 0;
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        count++;
                        if (count > limit) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
            }

            async _trimGameHistory(limit) {
                const transaction = this.db.transaction([this.STORES.GAME_HISTORY], 'readwrite');
                const store = transaction.objectStore(this.STORES.GAME_HISTORY);
                const index = store.index('timestamp');
                const request = index.openCursor(null, 'prev');

                let count = 0;
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        count++;
                        if (count > limit) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
            }

            async _updateStatistics(gameRecord) {
                const stats = await this.getStatistics();

                stats.totalGames++;
                stats.totalScore += gameRecord.score;
                stats.totalLines += gameRecord.lines;
                stats.highestScore = Math.max(stats.highestScore, gameRecord.score);
                stats.highestLevel = Math.max(stats.highestLevel, gameRecord.level);

                // Track best score per level
                if (!stats.bestScorePerLevel[gameRecord.level] ||
                    gameRecord.score > stats.bestScorePerLevel[gameRecord.level]) {
                    stats.bestScorePerLevel[gameRecord.level] = gameRecord.score;
                }

                return new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([this.STORES.STATISTICS], 'readwrite');
                    const store = transaction.objectStore(this.STORES.STATISTICS);
                    const request = store.put(stats);

                    request.onsuccess = () => resolve(stats);
                    request.onerror = () => reject(request.error);
                });
            }
        }

        // Global variable to store available songs
        let availableSongs = [];

        // Load songs from JSON file
        async function loadSongs() {
            try {
                const response = await fetch('songs/songs.json');
                const songs = await response.json();
                availableSongs = songs;
                console.log(`✅ Loaded ${songs.length} songs from songs.json`);
                return songs;
            } catch (error) {
                console.error('❌ Failed to load songs.json:', error);
                // Fallback to default songs
                availableSongs = [
                    { name: 'Echoes of the Soul', file: 'Echoes of the Soul.mp3', path: 'songs/Echoes of the Soul.mp3' }
                ];
                return availableSongs;
            }
        }

        class SoundManager {
            constructor() {
                this.audioContext = null; this.isMuted = false; this.musicInterval = null;
                this.musicTrack = 'EchoesOfTheSoul'; this.soundSet = 'Zen';
                this.musicVolume = 1.0; this.sfxVolume = 1.0;
                this.currentTrackId = null;
                this.audioElement = null; // HTML5 Audio element for playing MP3 files
                this.trackNames = []; // Will be populated from songs.json
                this.songsData = []; // Store full song data
                this.soundSets = {
                    Retro: {
                        move: () => this.createTone(200, 0.05, 'square', 0.2),
                        rotate: () => this.createTone(400, 0.08, 'triangle', 0.3),
                        drop: () => this.createTone(120, 0.1, 'sine', 0.4),
                        lineClear: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.createTone(f, 0.2, 'sine', 0.4), i*50)),
                        levelUp: () => [261, 329, 392, 523, 659].forEach((f, i) => setTimeout(() => this.createTone(f, 0.15, 'sine', 0.5), i*60)),
                        gameOver: () => [400, 350, 300, 250, 200].forEach((f, i) => setTimeout(() => this.createTone(f, 0.3, 'sawtooth', 0.5), i*150))
                    },
                    Zen: {
                        move: () => this.createTone(100, 0.1, 'sine', 0.1),
                        rotate: () => this.createTone(150, 0.1, 'sine', 0.15),
                        drop: () => this.createTone(80, 0.2, 'sine', 0.2),
                        lineClear: () => [261, 329, 392].forEach((f, i) => setTimeout(() => this.createTone(f, 0.5, 'sine', 0.15), i*80)),
                        levelUp: () => [392, 493, 587].forEach((f, i) => setTimeout(() => this.createTone(f, 0.6, 'sine', 0.2), i*100)),
                        gameOver: () => [220, 164, 130].forEach((f, i) => setTimeout(() => this.createTone(f, 0.8, 'sine', 0.2), i*200))
                    }
                };
            }
            init() { if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
            createTone(frequency, duration = 0.1, type = 'sine', volume = 0.3, onended = null, isMusic = false) {
                if (!this.audioContext || this.isMuted) return;
                const volumeMultiplier = isMusic ? this.musicVolume : this.sfxVolume;
                const adjustedVolume = volume * volumeMultiplier;
                if (adjustedVolume <= 0) return;
                const osc = this.audioContext.createOscillator(), gain = this.audioContext.createGain();
                osc.connect(gain); gain.connect(this.audioContext.destination);
                osc.type = type; osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
                gain.gain.setValueAtTime(adjustedVolume, this.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);
                osc.start(); osc.stop(this.audioContext.currentTime + duration);
                if (onended) osc.onended = onended;
            }
            setTrack(trackName) {
                if (!this.trackNames.includes(trackName)) return;
                this.musicTrack = trackName;
                settings.musicTrack = trackName;
                saveSettings();
                document.getElementById('music-track').value = trackName;
                this.stopBackgroundMusic();
                if (!this.isMuted) this.startBackgroundMusic();
            }

            nextTrack() {
                const currentIndex = this.trackNames.indexOf(this.musicTrack);
                const nextIndex = (currentIndex + 1) % this.trackNames.length;
                this.setTrack(this.trackNames[nextIndex]);
            }
            setSoundSet(setName) { this.soundSet = setName; }

            // Initialize tracks from songs.json
            async initializeTracks() {
                const songs = await loadSongs();
                this.songsData = songs;
                // Convert song names to camelCase for compatibility
                this.trackNames = songs.map(song => this.nameToKey(song.name));

                // Set default track if current track doesn't exist
                if (!this.trackNames.includes(this.musicTrack) && this.trackNames.length > 0) {
                    this.musicTrack = this.trackNames[0];
                }

                // Populate the dropdown
                this.populateMusicDropdown();

                return this;
            }

            // Convert display name to internal key (e.g., "Ocean Deep" -> "OceanDeep")
            nameToKey(name) {
                return name.replace(/\s+/g, '');
            }

            // Get song path from track name
            getSongPath(trackName) {
                const song = this.songsData.find(s => this.nameToKey(s.name) === trackName);
                return song ? song.path : this.songsData[0]?.path || 'songs/Echoes of the Soul.mp3';
            }

            // Populate the music track dropdown
            populateMusicDropdown() {
                const dropdown = document.getElementById('music-track');
                if (!dropdown) return;

                dropdown.innerHTML = ''; // Clear existing options

                this.songsData.forEach(song => {
                    const option = document.createElement('option');
                    option.value = this.nameToKey(song.name);
                    option.textContent = song.name;
                    dropdown.appendChild(option);
                });

                dropdown.value = this.musicTrack;
            }

            // Get song for theme (theme-linked mode)
            getSongForTheme(themeName) {
                // Normalize theme name: remove hyphens and convert to camelCase for matching
                const normalizedTheme = themeName.split('-').map((word, index) =>
                    index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) :
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join('');

                // Try exact match first
                let song = this.songsData.find(s =>
                    this.nameToKey(s.name).toLowerCase() === normalizedTheme.toLowerCase()
                );

                // If no exact match, try partial match
                if (!song) {
                    song = this.songsData.find(s =>
                        this.nameToKey(s.name).toLowerCase().includes(themeName.replace(/-/g, '').toLowerCase()) ||
                        themeName.replace(/-/g, '').toLowerCase().includes(this.nameToKey(s.name).toLowerCase())
                    );
                }

                return song ? this.nameToKey(song.name) : null;
            }

            // Apply theme-linked music if enabled
            applyThemeLinkedMusic(themeName) {
                if (!settings.themeLinkedMode) return;

                const linkedSong = this.getSongForTheme(themeName);
                if (linkedSong) {
                    console.log(`🎵 Theme-linked: ${themeName} → ${linkedSong}`);
                    this.setTrack(linkedSong);
                } else {
                    // No match found, continue with current track or pick random
                    console.log(`🎵 No theme match for ${themeName}, continuing current track`);
                }
            }

            playMove() { this.soundSets[this.soundSet].move(); }
            playRotate() { this.soundSets[this.soundSet].rotate(); }
            playDrop() { this.soundSets[this.soundSet].drop(); }
            playLineClear() { this.soundSets[this.soundSet].lineClear(); }
            playLevelUp() { this.soundSets[this.soundSet].levelUp(); }
            playGameOver() { this.soundSets[this.soundSet].gameOver(); }
            startBackgroundMusic() {
                if (this.isMuted) return;
                this.stopBackgroundMusic();
                this.currentTrackId = Symbol();
                const trackId = this.currentTrackId;

                // Get the song path dynamically from songs.json
                const songPath = this.getSongPath(this.musicTrack);
                this.playAudioFile(songPath);
            }
            startGongBathMusic(trackId) {
                const baseNotes = [41.20, 48.99, 55.00, 61.74]; // E1, G1, A1, B1

                const playGong = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;

                    const baseFreq = baseNotes[~~(Math.random() * baseNotes.length)];
                    const duration = random(15, 20);
                    const mainVolume = random(0.1, 0.2);

                    // Main gong tone - sine for a smoother fundamental
                    this.createTone(baseFreq, duration, 'sine', mainVolume, null, true);

                    // Subtle lower octave sine for fundamental depth
                    this.createTone(baseFreq / 2, duration * 1.1, 'sine', mainVolume * 0.6, null, true);

                    // Inharmonic overtones for shimmer
                    for (let i = 2; i < 9; i++) {
                        if (Math.random() > 0.65) { // Make overtones more sparse
                            // Use non-integer multiples for a more gong-like inharmonic sound
                            const overtoneFreq = baseFreq * (i + random(-0.1, 0.1));
                            const overtoneVolume = mainVolume / (i * 2) * (random(0.5, 1.0));
                            const overtoneDuration = duration * random(0.7, 1.1);
                             setTimeout(() => {
                                if (this.isMuted || trackId !== this.currentTrackId) return;
                                this.createTone(overtoneFreq, overtoneDuration, 'sine', overtoneVolume, null, true);
                            }, random(100, 400)); // Stagger the overtones more
                        }
                    }

                    const nextGongIn = random(10000, 18000);
                    setTimeout(playGong, nextGongIn);
                };

                playGong();
            }
            startNebulaMusic(trackId) {
                const b = [65, 73, 82, 73], m = [262, 294, 330, 349, 392, 440, 494, 523]; let bi=0, mi=0;
                const interval = setInterval(() => { if (this.isMuted || trackId !== this.currentTrackId) { clearInterval(interval); return; } this.createTone(b[bi++ % b.length], 0.4, 'triangle', 0.1, null, true); if (bi % 2 === 0) this.createTone(m[mi++ % m.length], 0.2, 'sine', 0.15, null, true); }, 250);
                this.musicInterval = interval;
            }

            startAmbientMusic(trackId) {
                const s=[261, 311, 349, 392, 466], d=130;
                const interval = setInterval(() => { if (this.isMuted || trackId !== this.currentTrackId) { clearInterval(interval); return; } this.createTone(s[~~(Math.random()*s.length)], 0.8, 'sine', 0.15, null, true); if(Math.random()>0.7)this.createTone(s[~~(Math.random()*s.length)]/2,1.2,'sine',0.1, null, true); if(Math.random()>0.9)this.createTone(d,2.5,'sine',0.08, null, true); }, 900);
                this.musicInterval = interval;
            }
            startDecayMusic(trackId) {
                const n=[220, 277.18, 329.63];
                const interval = setInterval(() => { if (this.isMuted || trackId !== this.currentTrackId) { clearInterval(interval); return; } const note=n[~~(Math.random()*n.length)]; this.createTone(note*(1+(Math.random()-0.5)*0.005), 4, 'sine', Math.random()*0.05+0.05, null, true); }, 2000+Math.random()*2000);
                this.musicInterval = interval;
            }
            startNostalgiaMusic(trackId) {
                const m=[293.66, 329.63, 293.66, 220, 146.83]; let mi=0;
                const interval = setInterval(() => { if (this.isMuted || trackId !== this.currentTrackId) { clearInterval(interval); return; } const n=m[mi++ % m.length]; this.createTone(n, 2.5, 'triangle', 0.1, null, true); if(Math.random()>0.6) this.createTone(n*2,2.5,'sine',0.05, null, true); }, 1500);
                this.musicInterval = interval;
            }
            startZenMusic(trackId) {
                const scale = [261.63, 392.00, 440.00, 523.25], drone = 110;
                const interval = setInterval(() => {
                    if (this.isMuted || trackId !== this.currentTrackId) { clearInterval(interval); return; }
                    if (Math.random() > 0.8) this.createTone(drone, 10, 'sine', 0.05, null, true);
                    if (Math.random() > 0.7) this.createTone(scale[~~(Math.random()*scale.length)], 3, 'sine', 0.1, null, true);
                }, 4000);
                 this.musicInterval = interval;
            }
             startAuroraMusic(trackId) {
                const play = () => { if (this.isMuted || trackId !== this.currentTrackId) return; this.createTone(Math.random() * 100 + 80, 8, 'sine', Math.random() * 0.1, play, true); };
                play();
            }
            startGalaxyMusic(trackId) {
                const playDrone = () => { if(this.isMuted || trackId !== this.currentTrackId) return; this.createTone(55, 15, 'sawtooth', 0.03, playDrone, true); };
                const playSparkles = () => { if(this.isMuted || trackId !== this.currentTrackId) return; this.createTone(Math.random() * 1000 + 1000, 0.1, 'triangle', Math.random() * 0.05, null, true); setTimeout(playSparkles, Math.random() * 2000 + 500); };
                playDrone(); playSparkles();
            }
            startRainfallMusic(trackId) {
                const notes = [523, 587, 659, 784]; let idx = 0;
                const playNote = () => { if(this.isMuted || trackId !== this.currentTrackId) return; this.createTone(notes[idx % notes.length], 0.5, 'sine', 0.1, null, true); idx++; setTimeout(playNote, Math.random() * 800 + 400); };
                playNote();
            }
            startKoiMusic(trackId) {
                const scale = [261, 329, 392, 523, 587];
                const playPluck = () => { if(this.isMuted || trackId !== this.currentTrackId) return; this.createTone(scale[~~(Math.random()*scale.length)], 1.5, 'triangle', 0.15, null, true); setTimeout(playPluck, Math.random() * 2000 + 1000); };
                playPluck();
            }
            startMeadowMusic(trackId) {
                const padScale = [130.81, 196.00, 261.63];
                const bellScale = [523.25, 659.25, 783.99];
                const playPad = () => { if(this.isMuted || trackId !== this.currentTrackId) return; this.createTone(padScale[~~(Math.random()*padScale.length)], 12, 'sine', 0.1, playPad, true); };
                const playBell = () => { if(this.isMuted || trackId !== this.currentTrackId) return; if(Math.random() > 0.6) this.createTone(bellScale[~~(Math.random()*bellScale.length)], 3, 'sine', 0.08, null, true); setTimeout(playBell, Math.random() * 5000 + 3000); };
                playPad(); playBell();
            }
            startMiracleToneMusic(trackId) {
                const play = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(528, 10, 'sine', 0.1, null, true);
                    this.createTone(264, 10, 'sine', 0.05, null, true);
                    setTimeout(() => { if (!this.isMuted && trackId === this.currentTrackId) play(); }, 12000);
                };
                play();
            }
            startHealingDroneMusic(trackId) {
                const play = () => { if (this.isMuted || trackId !== this.currentTrackId) return; this.createTone(174, 15, 'sine', 0.15, play, true); };
                play();
            }

            startCosmicChimesMusic(trackId) {
                const scale = [880, 932.33, 1046.50, 1174.66, 1318.51];
                const playChime = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const freq = scale[~~(Math.random() * scale.length)];
                    this.createTone(freq, 4, 'triangle', Math.random() * 0.08 + 0.02, null, true);
                    setTimeout(playChime, Math.random() * 5000 + 3000);
                };
                playChime();
            }

            startSingingBowlMusic(trackId) {
                const drone = 82.41;
                const strikeNote = 329.63;
                const playDrone = () => {
                    if(this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(drone, 15, 'sine', 0.1, playDrone, true);
                };
                const playStrike = () => {
                    if(this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(strikeNote, 8, 'sine', 0.1, null, true);
                    this.createTone(strikeNote * 2, 8, 'sine', 0.05, null, true);
                    setTimeout(playStrike, Math.random() * 15000 + 10000);
                };
                playDrone();
                playStrike();
            }

            startStarlightMusic(trackId) {
                const scale = [1046.50, 1174.66, 1318.51, 1396.91, 1567.98];
                const playNote = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const note = scale[~~(Math.random() * scale.length)];
                    this.createTone(note, 2, 'triangle', Math.random() * 0.1 + 0.05, null, true);
                    if (Math.random() > 0.8) {
                        this.createTone(note / 2, 3, 'sine', 0.05, null, true);
                    }
                    setTimeout(playNote, Math.random() * 3000 + 1500);
                };
                playNote();
            }

            startSwedishForestMusic(trackId) {
                const droneFreq = 60;
                const playDrone = () => {
                    if(this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(droneFreq, 20, 'sawtooth', 0.04, playDrone, true);
                };

                const playWind = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    for (let i = 0; i < 5; i++) {
                        this.createTone(80 + Math.random() * 40, 2 + Math.random() * 3, 'sine', 0.005 + Math.random() * 0.01, null, true);
                    }
                    setTimeout(playWind, Math.random() * 4000 + 2000);
                };

                const scale = [392.00, 440.00, 587.33, 659.25];
                const playTones = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    if (Math.random() > 0.6) {
                        const note = scale[~~(Math.random() * scale.length)];
                        this.createTone(note, 5, 'triangle', 0.08, null, true);
                        if (Math.random() > 0.5) { this.createTone(note/2, 5, 'sine', 0.04, null, true); }
                    }
                    setTimeout(playTones, Math.random() * 8000 + 5000);
                };

                playDrone();
                playWind();
                playTones();
            }

            startBreathOfStillnessMusic(trackId) {
                const droneFreq = 55; // A1, a very grounding frequency
                const playDrone = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(droneFreq, 25, 'sine', 0.15, playDrone, true); // Long, soft drone
                    this.createTone(droneFreq * 2, 25, 'sine', 0.05, null, true); // Add a subtle harmonic
                };

                // "Wind" - multiple, slightly detuned high-frequency sines
                const playWind = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    for (let i = 0; i < 6; i++) {
                        this.createTone(1000 + random(-200, 200), random(5, 10), 'sine', random(0.001, 0.005), null, true);
                    }
                    setTimeout(playWind, random(4000, 7000));
                };

                // "Flowing Water" / spacious pads - gentle, evolving mid-range tones
                const playPads = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const scale = [220, 277, 330, 370]; // A3, C#4, E4, F#4
                    const note = scale[~~(Math.random() * scale.length)];
                    this.createTone(note, random(10, 15), 'sine', random(0.05, 0.1), null, true);
                    setTimeout(playPads, random(8000, 12000));
                };

                playDrone();
                setTimeout(playWind, 1000);
                setTimeout(playPads, 3000);
            }

            startSacredJourneyMusic(trackId) {
                // Frame Drum
                const playDrum = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    // A low, soft thump using a sawtooth wave for a bit of attack
                    this.createTone(70, 0.4, 'sawtooth', 0.15, null, true);
                    this.createTone(65, 0.5, 'sine', 0.1, null, true);
                    setTimeout(playDrum, random(4000, 6000)); // Slow, spacious rhythm
                };

                // Rattle/Shaker
                const playRattle = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    // Simulate a rattle with very short bursts of noise-like triangle waves
                    for (let i = 0; i < 5; i++) {
                        setTimeout(() => {
                           this.createTone(random(800, 1200), 0.05, 'triangle', random(0.01, 0.03), null, true);
                        }, i * random(30, 60));
                    }
                    setTimeout(playRattle, random(5000, 9000));
                };

                // Throat-singing drone
                const playDrone = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const baseFreq = 65; // C2
                    this.createTone(baseFreq, 12, 'sawtooth', 0.08, null, true);
                    // Add harmonics to create a richer, throat-like texture
                    this.createTone(baseFreq * 3, 12, 'sine', 0.04, null, true);
                    this.createTone(baseFreq * 5, 12, 'sine', 0.02, null, true);
                    setTimeout(playDrone, random(15000, 20000));
                };

                // Distant Flute
                const playFlute = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const scale = [261, 329, 392, 440]; // Minor pentatonic feel
                    const note = scale[~~(Math.random() * scale.length)];
                    this.createTone(note, random(3, 5), 'sine', 0.07, null, true);
                    setTimeout(playFlute, random(10000, 15000));
                };

                playDrum();
                setTimeout(playRattle, 2000);
                setTimeout(playDrone, 5000);
                setTimeout(playFlute, 8000);
            }

            startReturnToLightMusic(trackId) {
                // Heartbeat Pulse
                const playHeartbeat = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(45, 0.15, 'sine', 0.2, null, true); // First beat
                    setTimeout(() => {
                        if (this.isMuted || trackId !== this.currentTrackId) return;
                        this.createTone(45, 0.1, 'sine', 0.15, null, true); // Second beat, slightly softer
                    }, 350);
                    setTimeout(playHeartbeat, 1200); // ~50 BPM
                };

                // Uplifting Chimes and Bells
                const playChimes = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const scale = [523.25, 659.25, 783.99, 987.77, 1046.50]; // C5, E5, G5, B5, C6
                    const note = scale[~~(Math.random() * scale.length)];
                    // Use triangle for a softer, bell-like tone
                    this.createTone(note, random(4, 6), 'triangle', random(0.05, 0.1), null, true);
                    // Add a higher, shimmering harmonic
                     if (Math.random() > 0.6) {
                        this.createTone(note * 2, random(3, 5), 'sine', random(0.02, 0.04), null, true);
                    }
                    setTimeout(playChimes, random(3000, 5000));
                };

                 // Airy Textures
                const playAiryPads = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const baseFreq = 261.63; // C4
                    this.createTone(baseFreq, 15, 'sine', 0.06, null, true);
                    this.createTone(baseFreq * 1.5, 15, 'sine', 0.04, null, true); // Perfect fifth for harmony
                    this.createTone(baseFreq * 2, 15, 'sine', 0.03, null, true); // Octave
                    setTimeout(playAiryPads, random(18000, 25000));
                };

                playHeartbeat();
                setTimeout(playChimes, 1500);
                setTimeout(playAiryPads, 5000);
            }

            startMoonlitForestMusic(trackId) {
                // Deep grounding drone - like the earth beneath the forest
                const playDrone = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    this.createTone(58.27, 30, 'sine', 0.12, playDrone, true); // A#1 - very grounding
                    this.createTone(58.27 * 1.5, 30, 'sine', 0.06, null, true); // Perfect fifth harmonic
                };

                // Gentle night crickets - very sparse, high frequency tones
                const playCrickets = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    if (Math.random() > 0.7) {
                        for (let i = 0; i < random(2, 4); i++) {
                            setTimeout(() => {
                                if (this.isMuted || trackId !== this.currentTrackId) return;
                                this.createTone(random(3000, 4500), random(0.05, 0.15), 'sine', random(0.008, 0.015), null, true);
                            }, i * random(100, 300));
                        }
                    }
                    setTimeout(playCrickets, random(5000, 9000));
                };

                // Moonlit breeze - soft, whispering high tones
                const playBreeze = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    for (let i = 0; i < 4; i++) {
                        this.createTone(random(800, 1400), random(4, 7), 'sine', random(0.003, 0.008), null, true);
                    }
                    setTimeout(playBreeze, random(8000, 14000));
                };

                // Meditative forest bells - very calm, pentatonic scale
                const playBells = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    const scale = [233.08, 261.63, 311.13, 349.23, 415.30]; // A#3, C4, D#4, F4, G#4 - minor pentatonic
                    if (Math.random() > 0.5) {
                        const note = scale[~~(Math.random() * scale.length)];
                        this.createTone(note, random(6, 9), 'triangle', random(0.04, 0.07), null, true);
                        // Subtle harmonic
                        if (Math.random() > 0.6) {
                            this.createTone(note * 2, random(5, 8), 'sine', random(0.02, 0.03), null, true);
                        }
                    }
                    setTimeout(playBells, random(8000, 15000));
                };

                // Distant owl - occasional very low hooting sound
                const playOwl = () => {
                    if (this.isMuted || trackId !== this.currentTrackId) return;
                    if (Math.random() > 0.6) {
                        // Two-note hoot
                        this.createTone(220, 0.4, 'sine', 0.08, null, true);
                        setTimeout(() => {
                            if (this.isMuted || trackId !== this.currentTrackId) return;
                            this.createTone(196, 0.5, 'sine', 0.07, null, true);
                        }, 600);
                    }
                    setTimeout(playOwl, random(20000, 35000));
                };

                playDrone();
                setTimeout(playCrickets, 2000);
                setTimeout(playBreeze, 5000);
                setTimeout(playBells, 8000);
                setTimeout(playOwl, 12000);
            }

            playAudioFile(filename) {
                // Stop any existing music first
                this.stopBackgroundMusic();

                // Create or reuse audio element
                if (!this.audioElement) {
                    this.audioElement = new Audio();
                    // Add event listener for automatic song progression
                    this.audioElement.addEventListener('ended', () => {
                        this.nextTrack();
                    });
                }

                // Set the source and configure
                this.audioElement.src = filename;
                this.audioElement.volume = this.musicVolume;
                this.audioElement.muted = this.isMuted;
                this.audioElement.loop = false; // Disable loop to enable automatic progression

                // Play the audio (handle autoplay restrictions)
                const playPromise = this.audioElement.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.log('Audio playback prevented:', error);
                    });
                }
            }

            stopBackgroundMusic() {
                this.currentTrackId = null;
                if (this.musicInterval) {
                    clearInterval(this.musicInterval);
                    this.musicInterval = null;
                }
                // Also stop audio element if it exists
                if (this.audioElement) {
                    this.audioElement.pause();
                    this.audioElement.currentTime = 0;
                }
            }
            toggleMute() {
                this.isMuted = !this.isMuted;
                if (this.audioElement) {
                    this.audioElement.muted = this.isMuted;
                }
                this.isMuted ? this.stopBackgroundMusic() : this.startBackgroundMusic();
                return this.isMuted;
            }
        }

        const COLS = 10, ROWS = 20, HIDDEN_ROWS = 4;
        let BLOCK_SIZE = 30;
        const COLORS = { I: '#00ff00', O: '#ff9900', T: '#0000ff', S: '#00ffff', Z: '#ff0000', J: '#ffff00', L: '#cc00cc' };
        const SHAPES = { I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], O: [[1,1],[1,1]], T: [[0,0,0],[1,1,1],[0,1,0]], S: [[0,1,1],[1,1,0],[0,0,0]], Z: [[1,1,0],[0,1,1],[0,0,0]], J: [[0,0,0],[1,1,1],[0,0,1]], L: [[0,0,0],[1,1,1],[1,0,0]] };
        const PIECE_KEYS = 'IOTZSLJ', SCORE_VALUES = { 1: 100, 2: 300, 3: 500, 4: 800 };
        const LEVEL_SPEEDS = [ 1000, 900, 800, 700, 600, 500, 450, 400, 360, 320, 290, 260, 240, 220, 200, 185, 170, 155, 145, 135, 125, 115, 105, 95, 90, 85, 80, 75, 70, 65, 62, 59, 56, 53, 50, 48, 46, 44, 42, 40 ];
        const THEMES = ['forest', 'ocean', 'sunset', 'mountain', 'zen', 'winter', 'fall', 'summer', 'spring', 'aurora', 'galaxy', 'rainy-window', 'koi-pond', 'meadow', 'cosmic-chimes', 'singing-bowl', 'starlight', 'swedish-forest', 'geode', 'bioluminescence', 'desert-oasis', 'bamboo-grove', 'misty-lake', 'waves', 'fluid-dreams', 'lantern-festival', 'crystal-cave', 'candlelit-monastery', 'cherry-blossom-garden', 'floating-islands', 'meditation-temple', 'moonlit-greenhouse', 'ice-temple', 'himalayan-peak', 'electric-dreams', 'moonlit-forest', 'wolfhour', 'lunara', 'pyrestorm', 'neon-dusk', 'stillwater'];

        let canvas, ctx, nextCanvases = [], board, lockedPieces = [], currentPiece = null;
        let nextPieces = [], score = 0, lines = 0, level = 1, dropInterval = 1000;
        let dropCounter = 0, lastTime = 0, startTime, piecesPlaced = 0, isGameOver = false, isPaused = false;
        let lastRenderedLevel = 0; // Track last level for canvas style optimization
        let isProcessingPhysics = false, inputQueue = null, dasTimer = null, dasIntervalTimer = null, softDropTimer = null;
let animationId = null, linesUntilNextLevel = 10, activeTheme = 'forest', randomThemeInterval = null, activeThemeAnimationId = null, webglRenderer = null, activeThemeData = null;

        let settings = { dasDelay: 120, dasInterval: 40, musicTrack: 'Ambient', soundSet: 'Zen', musicVolume: 1.0, sfxVolume: 1.0, backgroundMode: 'Level', backgroundTheme: 'forest', themeLinkedMode: false, controlScheme: 'ontouchstart' in window ? 'Touch' : 'Keyboard', keyBindings: { moveLeft: 'ArrowLeft', moveRight: 'ArrowRight', rotateRight: 'ArrowUp', rotateLeft: 'z', flip: 'a', softDrop: 'ArrowDown', hardDrop: 'Space' } };
        const soundManager = new SoundManager();
        const highScoreManager = new HighScoreManager();
let touchStartX = null, touchStartY = null, touchStartTime = null, lastTap = 0, touchLastX = null, touchLastY = null;

        function createCosmicChimesScene() {
            const dustContainer = document.getElementById('space-dust');
            if (dustContainer && dustContainer.children.length === 0) {
                for (let i = 0; i < 70; i++) {
                    let particle = document.createElement('div');
                    particle.className = 'dust-particle';
                    const size = Math.random() * 2 + 1;
                    particle.style.width = `${size}px`;
                    particle.style.height = `${size}px`;
                    particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                    particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                    particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                    particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                    particle.style.animationDelay = `-${Math.random() * 30}s`;
                    dustContainer.appendChild(particle);
                }
            }
            const chimesContainer = document.getElementById('chimes');
            if (chimesContainer && chimesContainer.children.length === 0) {
                 for (let i = 0; i < 12; i++) {
                    let chime = document.createElement('div');
                    chime.className = 'chime';
                    chime.style.left = `${5 + Math.random() * 90}%`;
                    chime.style.top = `${-10 + Math.random() * 30}%`;
                    chime.style.setProperty('--r-start', `${Math.random() * 10 - 5}deg`);
                    chime.style.setProperty('--r-end', `${Math.random() * 10 - 5}deg`);
                    chime.style.animationDelay = `-${Math.random() * 12}s`;
                    chimesContainer.appendChild(chime);
                }
            }
        }
        function createSingingBowlScene() {
            const ripplesContainer = document.getElementById('bowl-ripples');
            if (ripplesContainer && ripplesContainer.children.length === 0) {
                for (let i=0; i<5; i++) { // Increased ripple count
                    let ripple = document.createElement('div');
                    ripple.className = 'bowl-ripple';
                    const duration = Math.random() * 4 + 6; // 6-10s duration
                    ripple.style.animationDuration = `${duration}s`;
                    ripple.style.animationDelay = `-${Math.random() * duration}s`;
                    // Vary opacity slightly for a layered look
                    ripple.style.opacity = Math.random() * 0.4 + 0.6;
                    ripplesContainer.appendChild(ripple);
                }
            }
            const motesContainer = document.getElementById('bowl-motes');
            if (motesContainer && motesContainer.children.length === 0) {
                for (let i=0; i<40; i++) { // Increased mote count
                    let mote = document.createElement('div');
                    mote.className = 'bowl-mote';
                    const size = Math.random() * 4 + 1; // Varied size
                    mote.style.width = `${size}px`;
                    mote.style.height = `${size}px`;
                    // Spawn motes from within the bowl area
                    mote.style.left = `${Math.random() * 40 + 30}%`;
                    mote.style.animationDuration = `${Math.random() * 8 + 12}s`; // 12-20s duration
                    mote.style.animationDelay = `-${Math.random() * 20}s`;
                    // Set random horizontal drift for the weave animation
                    mote.style.setProperty('--x-drift', `${Math.random() * 10 - 5}vw`);
                    motesContainer.appendChild(mote);
                }
            }
        }
        function createZenScene() {
            // Bamboo stalks
            const bambooContainer = document.getElementById('zen-bamboo-container');
            if (bambooContainer && bambooContainer.children.length === 0) {
                const positions = [5, 12, 18, 85, 92];
                positions.forEach((pos, idx) => {
                    const bamboo = document.createElement('div');
                    bamboo.className = 'zen-bamboo';
                    const height = random(250, 450);
                    bamboo.style.height = `${height}px`;
                    bamboo.style.left = `${pos}%`;
                    bamboo.style.setProperty('--sway-angle', `${random(1, 3)}deg`);
                    bamboo.style.animationDuration = `${random(6, 10)}s`;
                    bamboo.style.animationDelay = `-${random(0, 5)}s`;

                    // Add segments
                    const numSegments = Math.floor(height / 60);
                    for (let i = 1; i <= numSegments; i++) {
                        const segment = document.createElement('div');
                        segment.className = 'bamboo-segment';
                        segment.style.top = `${(i * 60)}px`;
                        bamboo.appendChild(segment);
                    }

                    // Add leaves
                    const numLeaves = random(3, 6);
                    for (let i = 0; i < numLeaves; i++) {
                        const leaf = document.createElement('div');
                        leaf.className = 'bamboo-leaf';
                        leaf.style.top = `${random(20, height - 40)}px`;
                        leaf.style.left = `${random(-5, 15)}px`;
                        leaf.style.animationDuration = `${random(3, 5)}s`;
                        leaf.style.animationDelay = `-${random(0, 3)}s`;
                        bamboo.appendChild(leaf);
                    }

                    bambooContainer.appendChild(bamboo);
                });
            }

            // Zen stones
            const stonesContainer = document.getElementById('zen-stones-container');
            if (stonesContainer && stonesContainer.children.length === 0) {
                const stoneGroups = [
                    { x: 25, y: 60, count: 3 },
                    { x: 45, y: 40, count: 5 },
                    { x: 70, y: 55, count: 2 }
                ];

                stoneGroups.forEach(group => {
                    for (let i = 0; i < group.count; i++) {
                        const stone = document.createElement('div');
                        stone.className = 'zen-stone';
                        const size = random(20, 50);
                        stone.style.width = `${size}px`;
                        stone.style.height = `${size * 0.6}px`;
                        stone.style.left = `${group.x + random(-8, 8)}%`;
                        stone.style.top = `${group.y + random(-5, 5)}%`;
                        stone.style.transform = `rotate(${random(-15, 15)}deg)`;
                        stonesContainer.appendChild(stone);
                    }
                });
            }

            // Floating lanterns
            const lanternsContainer = document.getElementById('zen-lanterns-container');
            if (lanternsContainer && lanternsContainer.children.length === 0) {
                for (let i = 0; i < 5; i++) {
                    const lantern = document.createElement('div');
                    lantern.className = 'zen-lantern';
                    lantern.style.left = `${random(10, 90)}%`;
                    lantern.style.top = `${random(15, 70)}%`;
                    lantern.style.setProperty('--rotation', `${random(-5, 5)}deg`);
                    lantern.style.animationDuration = `${random(4, 7)}s`;
                    lantern.style.animationDelay = `-${random(0, 4)}s`;

                    const glow = document.createElement('div');
                    glow.className = 'lantern-glow';

                    const body = document.createElement('div');
                    body.className = 'lantern-body';
                    body.appendChild(glow);

                    lantern.appendChild(body);
                    lanternsContainer.appendChild(lantern);
                }
            }

            // Magical ambient elements
            const petalsContainer = document.getElementById('petals');
            if (petalsContainer && petalsContainer.children.length === 0) {
                // Stars in twilight sky
                for (let i = 0; i < 40; i++) {
                    const star = document.createElement('div');
                    star.className = 'zen-star';
                    star.style.left = `${random(0, 100)}%`;
                    star.style.top = `${random(0, 40)}%`;
                    star.style.animationDuration = `${random(3, 6)}s`;
                    star.style.animationDelay = `-${random(0, 5)}s`;
                    petalsContainer.appendChild(star);
                }

                // Fireflies - magical floating lights
                for (let i = 0; i < 15; i++) {
                    const firefly = document.createElement('div');
                    firefly.className = 'zen-firefly';
                    const startX = random(0, 100);
                    const startY = random(30, 80);
                    firefly.style.setProperty('--x-start', `${startX}vw`);
                    firefly.style.setProperty('--y-start', `${startY}vh`);
                    firefly.style.setProperty('--x-drift', `${random(-30, 30)}vw`);
                    firefly.style.setProperty('--y-drift', `${random(-20, 20)}vh`);
                    firefly.style.animationDuration = `${random(8, 15)}s, ${random(2, 4)}s`;
                    firefly.style.animationDelay = `-${random(0, 10)}s, -${random(0, 3)}s`;
                    petalsContainer.appendChild(firefly);
                }

                // Meditation orbs - ethereal energy
                for (let i = 0; i < 5; i++) {
                    const orb = document.createElement('div');
                    orb.className = 'zen-orb';
                    orb.style.left = `${random(10, 90)}%`;
                    orb.style.top = `${random(20, 70)}%`;
                    orb.style.setProperty('--orb-drift-x', `${random(-40, 40)}px`);
                    orb.style.setProperty('--orb-drift-y', `${random(-40, 40)}px`);
                    orb.style.animationDuration = `${random(10, 18)}s, ${random(4, 7)}s`;
                    orb.style.animationDelay = `-${random(0, 12)}s, -${random(0, 5)}s`;
                    petalsContainer.appendChild(orb);
                }

                // Incense smoke near stones
                const smokePositions = [
                    { x: 27, y: 65 },
                    { x: 48, y: 45 },
                    { x: 72, y: 58 }
                ];
                smokePositions.forEach(pos => {
                    const createSmoke = () => {
                        if (activeTheme !== 'zen') return;
                        const smoke = document.createElement('div');
                        smoke.className = 'zen-incense-smoke';
                        smoke.style.left = `${pos.x}%`;
                        smoke.style.top = `${pos.y}%`;
                        smoke.style.animationDuration = `${random(8, 12)}s`;
                        smoke.addEventListener('animationend', () => {
                            smoke.remove();
                        }, { once: true });
                        petalsContainer.appendChild(smoke);
                        setTimeout(createSmoke, random(3000, 6000));
                    };
                    createSmoke();
                });
            }

            // Water Ripple
            const rippleContainer = document.querySelector('#zen-theme .water-feature');
            if (rippleContainer) {
                const createRipple = () => {
                    if (activeTheme !== 'zen') return;
                    let ripple = document.createElement('div');
                    ripple.className = 'zen-ripple';
                    ripple.style.animationDelay = `${Math.random() * 2}s`;
                    ripple.addEventListener('animationend', () => {
                        ripple.remove();
                    }, { once: true });
                    rippleContainer.appendChild(ripple);
                    setTimeout(createRipple, Math.random() * 8000 + 5000);
                }
                createRipple();
            }
        }
        function createBioluminescenceScene() {
            const mushroomContainer = document.getElementById('bio-mushrooms');
            if (mushroomContainer && mushroomContainer.children.length === 0) {
                const numMushrooms = 20;
                for (let i = 0; i < numMushrooms; i++) {
                    const mushroom = document.createElement('div');
                    mushroom.className = 'bio-mushroom';
                    const cap = document.createElement('div');
                    cap.className = 'bio-mushroom-cap';
                    const stem = document.createElement('div');
                    stem.className = 'bio-mushroom-stem';

                    mushroom.appendChild(cap);
                    mushroom.appendChild(stem);

                    const size = Math.random() * 60 + 40;
                    mushroom.style.width = `${size}px`;
                    mushroom.style.height = `${size * 1.25}px`;
                    mushroom.style.left = `${Math.random() * 95}%`;
                    mushroom.style.bottom = `-${Math.random() * 20}px`;
                    mushroom.style.zIndex = Math.floor(Math.random() * 4) + 1;
                    cap.style.animationDelay = `-${Math.random() * 10}s`;

                    mushroomContainer.appendChild(mushroom);
                }
            }
            const sporeContainer = document.getElementById('bio-spores');
            if (sporeContainer && sporeContainer.children.length === 0) {
                 for (let i = 0; i < 50; i++) {
                    let spore = document.createElement('div');
                    spore.className = 'bio-spore';
                    spore.style.left = `${Math.random() * 100}%`;
                    spore.style.bottom = `${Math.random() * 100}%`;
                    spore.style.setProperty('--x-drift', `${Math.random() * 10 - 5}vw`);
                    spore.style.animationDelay = `-${Math.random() * 20}s`;
                    sporeContainer.appendChild(spore);
                }
            }
        }
        function createGeodeScene() {
            // 1. Varied Crystals
            const crystalContainer = document.getElementById('geode-crystals');
            if (crystalContainer && crystalContainer.children.length === 0) {
                const crystalPalettes = [
                    ['#a29bfe', '#74b9ff', '#d6a2e8'], // Amethyst/Fluorite
                    ['#ff7675', '#fab1a0', '#fdcb6e'], // Rose Quartz/Citrine
                    ['#55efc4', '#81ecec', '#74b9ff'], // Aquamarine/Celestite
                    ['#fffe7a', '#ffb5b5', '#b5ffe7']  // Opal/Iridescent
                ];
                 const crystalShapes = [
                    'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)', // Classic crystal
                    'polygon(0% 0%, 100% 0%, 100% 75%, 50% 100%, 0% 75%)',    // Shard
                    'polygon(20% 0%, 80% 0%, 100% 20%, 100% 80%, 80% 100%, 20% 100%, 0% 80%, 0% 20%)', // Octagon
                    'polygon(50% 0%, 90% 20%, 100% 60%, 50% 100%, 0% 60%, 10% 20%)' // Pointed
                ];
                const numCrystals = 18;
                for (let i = 0; i < numCrystals; i++) {
                    const crystal = document.createElement('div');
                    crystal.className = 'crystal';
                    const palette = crystalPalettes[Math.floor(Math.random() * crystalPalettes.length)];
                    const shape = crystalShapes[Math.floor(Math.random() * crystalShapes.length)];

                    const size = Math.random() * 80 + 50;
                    crystal.style.width = `${size}px`;
                    crystal.style.height = `${size * (Math.random() * 0.5 + 0.8)}px`;
                    crystal.style.left = `${Math.random() * 90}%`;
                    crystal.style.top = `${Math.random() * 80}%`;
                    crystal.style.clipPath = shape;

                    const glow = document.createElement('div');
                    glow.className = 'crystal-glow';
                    glow.style.clipPath = shape;

                    crystal.style.background = `linear-gradient(${Math.random()*360}deg, ${palette.join(', ')})`;
                    glow.style.background = `linear-gradient(${Math.random()*360}deg, ${palette.join(', ')})`;

                    crystal.style.setProperty('--r-start', `${Math.random() * 10 - 5}deg`);
                    crystal.style.setProperty('--r-end', `${Math.random() * 10 - 5}deg`);
                    crystal.style.animationDelay = `-${Math.random() * 40}s`;
                    glow.style.animationDelay = `-${Math.random() * 8}s`;

                    crystal.appendChild(glow);
                    crystalContainer.appendChild(crystal);
                }
            }

            // 2. Layered Geode Dust
            const dustLayers = [
                { container: document.getElementById('geode-dust-back'), count: 40, minSize: 0.5, maxSize: 1.5, minDuration: 30, maxDuration: 40, opacity: 0.4 },
                { container: document.getElementById('geode-dust-mid'), count: 30, minSize: 1, maxSize: 2, minDuration: 20, maxDuration: 30, opacity: 0.6 },
                { container: document.getElementById('geode-dust-front'), count: 20, minSize: 1.5, maxSize: 2.5, minDuration: 15, maxDuration: 25, opacity: 0.8 }
            ];

            dustLayers.forEach(layer => {
                if (layer.container && layer.container.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        let particle = document.createElement('div');
                        particle.className = 'geode-dust-particle';
                        const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                        particle.style.width = `${size}px`;
                        particle.style.height = `${size}px`;
                        particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                        particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                        particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                        particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                        particle.style.setProperty('--opacity', layer.opacity);
                        const duration = Math.random() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                        particle.style.animationDuration = `${duration}s`;
                        particle.style.animationDelay = `-${Math.random() * duration}s`;
                        layer.container.appendChild(particle);
                    }
                }
            });
        }
        function createStarlightScene() {
             const layers = [
                { container: document.getElementById('starlights-back'), count: 40, minSize: 0.5, maxSize: 1.5 },
                { container: document.getElementById('starlights-mid'), count: 30, minSize: 1, maxSize: 2 },
                { container: document.getElementById('starlights-front'), count: 20, minSize: 1.5, maxSize: 2.5 }
            ];
            layers.forEach(layer => {
                if (layer.container && layer.container.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        let star = document.createElement('div');
                        star.className = 'starlight';
                        const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                        star.style.width = `${size}px`;
                        star.style.height = `${size}px`;
                        star.style.left = `${Math.random() * 100}%`;
                        star.style.top = `${Math.random() * 100}%`;
                        star.style.animationDelay = `-${Math.random() * 8}s`;
                        layer.container.appendChild(star);
                    }
                }
            });

            // Add shooting stars
            const shootingStarContainer = document.getElementById('starlight-shooting-stars');
            if (shootingStarContainer && shootingStarContainer.children.length === 0) {
                for (let i = 0; i < 5; i++) {
                    let star = document.createElement('div');
                    star.className = 'shooting-star-starlight';
                    star.style.top = `${Math.random() * 100}%`;
                    const duration = Math.random() * 4 + 3; // 3-7 seconds
                    star.style.animationDuration = `${duration}s`;
                    star.style.animationDelay = `-${Math.random() * 20}s`; // Staggered start times
                    star.style.width = `${Math.random() * 100 + 150}px`;
                    shootingStarContainer.appendChild(star);
                }
            }
        }
        function createMeadowScene() {
            // 1. Swaying Grass (120+ blades)
            const grassContainer = document.querySelector('.meadow-grass');
            if (grassContainer && grassContainer.children.length === 0) {
                for (let i = 0; i < 150; i++) {
                    let blade = document.createElement('div');
                    blade.className = 'grass-blade';
                    blade.style.left = `${Math.random() * 100}%`;
                    blade.style.height = `${Math.random() * 60 + 40}px`;
                    const swayDuration = Math.random() * 4 + 4;
                    blade.style.animationDuration = `${swayDuration}s`;
                    blade.style.animationDelay = `-${Math.random() * swayDuration}s`;
                    // Vary green color slightly
                    blade.style.background = `linear-gradient(to top, #4a7c3b, hsl(90, 39%, ${Math.random() * 15 + 45}%))`;
                    grassContainer.appendChild(blade);
                }
            }

            // 2. Colorful Flowers
            const flowerContainer = document.getElementById('meadow-flowers');
            if (flowerContainer && flowerContainer.children.length === 0) {
                const flowerData = [
                    { color: '#e53935', svg: '<path d="M10 25 L5 15 A5 5 0 1 1 15 15 L10 25 Z" fill="{color}"/>' }, // Tulip-like
                    { color: '#fdd835', svg: '<circle cx="10" cy="10" r="5" fill="{color}"/><circle cx="10" cy="10" r="2" fill="#8d6e63"/>' }, // Buttercup
                    { color: '#8e24aa', svg: '<path d="M10 25 L5 20 L0 10 L5 0 L15 0 L20 10 L15 20 Z" fill="{color}"/>' } // Aster-like
                ];
                for (let i = 0; i < 25; i++) {
                    let flower = document.createElement('div');
                    flower.className = 'meadow-flower';
                    const data = flowerData[Math.floor(Math.random() * flowerData.length)];
                    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 25">${data.svg.replace('{color}', data.color)}</svg>`;
                    flower.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}')`;
                    flower.style.left = `${Math.random() * 98}%`;
                    flower.style.bottom = `${Math.random() * 60}%`;
                    flower.style.animationDelay = `-${Math.random() * 10}s`;
                    flowerContainer.appendChild(flower);
                }
            }

            // 3. Enhanced Butterflies
            const butterflyContainer = document.getElementById('meadow-butterflies');
            if (butterflyContainer && butterflyContainer.children.length === 0) {
                const wingColors = [
                    { stroke: 'gold', fill: 'rgba(255,215,0,0.7)' },
                    { stroke: '#a29bfe', fill: 'rgba(162,155,254,0.7)' },
                    { stroke: '#ff7675', fill: 'rgba(255,118,117,0.7)' }
                ];
                for (let i = 0; i < 10; i++) {
                    let butterfly = document.createElement('div');
                    butterfly.className = 'butterfly';
                    const wingLeft = document.createElement('div');
                    wingLeft.className = 'butterfly-wing left';
                    const wingRight = document.createElement('div');
                    wingRight.className = 'butterfly-wing right';

                    const colors = wingColors[Math.floor(Math.random() * wingColors.length)];
                    const wingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 30"><path d="M 15 15 C 0 0, 0 30, 15 15" stroke="${colors.stroke}" fill="${colors.fill}" stroke-width="2"/></svg>`;
                    wingLeft.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(wingSvg)}')`;
                    wingRight.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(wingSvg)}')`;

                    butterfly.appendChild(wingLeft);
                    butterfly.appendChild(wingRight);

                    for(let j=1; j<=8; j++){ // 8 keyframe points
                        butterfly.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                        butterfly.style.setProperty(`--y${j}`, `${Math.random() * 70}vh`);
                    }
                    const duration = Math.random() * 10 + 15;
                    butterfly.style.animationDuration = `${duration}s`;
                    butterfly.style.animationDelay = `-${Math.random() * duration}s`;
                    const flapSpeed = Math.random() * 0.3 + 0.3;
                    wingLeft.style.animationDuration = `${flapSpeed}s`;
                    wingRight.style.animationDuration = `${flapSpeed}s`;

                    butterflyContainer.appendChild(butterfly);
                }
            }

            // 4. Improved Pollen
            const pollenContainer = document.getElementById('meadow-pollen');
            if (pollenContainer && pollenContainer.children.length === 0) {
                for (let i = 0; i < 100; i++) { // Increased count
                    let particle = document.createElement('div');
                    particle.className = 'pollen-particle';
                    particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                    particle.style.setProperty('--y-start', `${100 + Math.random() * 30}vh`);
                    particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                    for(let j = 1; j <= 3; j++) {
                        particle.style.setProperty(`--x-gust${j}`, `${Math.random() * 60 - 30}vw`); // Wider gusts
                    }
                    particle.style.animationDelay = `-${Math.random() * 10}s`;
                    pollenContainer.appendChild(particle);
                }
            }
        }
        function createKoiPondScene() {
            // 1. Lily Pads
            const lilyPadContainer = document.getElementById('lily-pads');
            if (lilyPadContainer && lilyPadContainer.children.length === 0) {
                const numPads = 6;
                for (let i = 0; i < numPads; i++) {
                    let pad = document.createElement('div');
                    pad.className = 'lily-pad';
                    const size = Math.random() * 50 + 70;
                    pad.style.width = `${size}px`;
                    pad.style.height = `${size}px`;
                    pad.style.setProperty('--x-pos', `${10 + Math.random() * 80}vw`);
                    pad.style.setProperty('--y-pos', `${10 + Math.random() * 80}vh`);
                    pad.style.animationDelay = `-${Math.random() * 20}s`;
                    lilyPadContainer.appendChild(pad);
                }
            }

            // 2. Koi Fish & Ripples
            const koiContainer = document.getElementById('koi-fish');
            const rippleContainer = document.getElementById('koi-ripples');
            const koiInstances = [];

            if (koiContainer && koiContainer.children.length === 0) {
                const numKoi = 7;
                const koiColors = [
                    { base: '#f08c28', spots: ['#000', '#fff'] }, // Kohaku/Orange
                    { base: '#fff', spots: ['#d44d2d', '#000'] }, // Sanke/White
                    { base: '#333', spots: ['#f08c28', '#fff'] }, // Bekko/Black
                    { base: '#f2c94c', spots: ['#fff'] } // Yamabuki/Yellow
                ];

                for (let i = 0; i < numKoi; i++) {
                    let koi = document.createElement('div');
                    koi.className = 'koi';

                    const colors = koiColors[Math.floor(Math.random() * koiColors.length)];
                    let spotsSvg = '';
                    const spotCount = Math.floor(Math.random() * 4) + 2;
                    for(let j=0; j < spotCount; j++){
                        spotsSvg += `<circle cx="${Math.random()*80+10}" cy="${Math.random()*20+10}" r="${Math.random()*6+4}" fill="${colors.spots[Math.floor(Math.random()*colors.spots.length)]}" opacity="${Math.random() * 0.3 + 0.6}"/>`;
                    }
                    const koiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><path d="M50 0 C20 0, 0 20, 0 20 S20 40, 50 40 C80 40, 100 20, 100 20 S80 0, 50 0 Z" fill="${colors.base}"/>${spotsSvg}</svg>`;
                    koi.style.backgroundImage = `url('data:image/svg+xml;utf8,${encodeURIComponent(koiSvg)}')`;

                    for(let j=1; j<=5; j++){
                        koi.style.setProperty(`--x${j}`, `${Math.random() * 90}vw`);
                        koi.style.setProperty(`--y${j}`, `${Math.random() * 90}vh`);
                        koi.style.setProperty(`--r${j}`, `${Math.random() * 360}deg`);
                    }
                    const duration = Math.random() * 10 + 20;
                    koi.style.animationDuration = `${duration}s`;
                    koi.style.animationDelay = `-${Math.random() * duration}s`;

                    koiContainer.appendChild(koi);
                    koiInstances.push(koi);
                }

                let lastRippleTime = 0;
                function rippleLoop(timestamp) {
                    if (activeTheme !== 'koi-pond' || isGameOver) {
                        activeThemeAnimationId = null;
                        return;
                    }
                    // Generate ripple roughly every 500-1000ms
                    if (timestamp - lastRippleTime > Math.random() * 500 + 500) {
                         lastRippleTime = timestamp;
                         // Pick a random fish to generate a ripple
                         const koi = koiInstances[Math.floor(Math.random() * koiInstances.length)];
                         const rect = koi.getBoundingClientRect();

                         // Only create ripple if fish is on screen
                         if (rect.top > 0 && rect.left > 0 && rect.bottom < window.innerHeight && rect.right < window.innerWidth) {
                            let ripple = document.createElement('div');
                            ripple.className = 'koi-ripple';
                            // Position ripple behind the fish head
                            const rippleX = rect.left + rect.width * 0.2;
                            const rippleY = rect.top + rect.height / 2;
                            ripple.style.left = `${rippleX}px`;
                            ripple.style.top = `${rippleY}px`;
                            ripple.style.width = `${rect.width * 1.5}px`;
                            ripple.style.height = `${rect.width * 1.5}px`;
                            ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
                            rippleContainer.appendChild(ripple);
                         }
                    }
                    activeThemeAnimationId = requestAnimationFrame(rippleLoop);
                }
                rippleLoop(0);
            }
        }
        function createRainyWindow() {
            const canvas = document.getElementById('rain-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            function resizeCanvas() {
                if (!canvas) return;
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
            window.addEventListener('resize', resizeCanvas, false);
            resizeCanvas();

            let drops = [];
            function createDrop(isInitial) {
                return {
                    x: Math.random() * canvas.width,
                    y: isInitial ? Math.random() * canvas.height : -50,
                    r: Math.random() * 1.5 + 1,
                    vy: Math.random() * 3 + 2,
                    isStreaking: false
                };
            }
            for(let i=0; i<150; i++){ drops.push(createDrop(true)); }

            // Cache style strings outside animation loop (performance optimization)
            const streakStyle = 'rgba(220, 230, 255, 0.3)';
            const dropStyle = 'rgba(220, 230, 255, 0.6)';

            function animate() {
                if (activeTheme !== 'rainy-window') {
                    return;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if(Math.random() > 0.8) drops.push(createDrop(false));

                for (let i = drops.length - 1; i >= 0; i--) {
                    let drop = drops[i];
                    if (drop.r > 3.5) drop.isStreaking = true;
                    drop.y += drop.vy;
                    if (drop.isStreaking) {
                        ctx.beginPath();
                        ctx.moveTo(drop.x, drop.y - drop.r * 4);
                        ctx.lineTo(drop.x, drop.y);
                        ctx.strokeStyle = streakStyle;
                        ctx.lineWidth = drop.r * 0.6;
                        ctx.stroke();
                    }
                    ctx.beginPath();
                    ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
                    ctx.fillStyle = dropStyle;
                    ctx.fill();

                    // Optimized collision detection: use squared distance to avoid sqrt()
                    for (let j = i - 1; j >= 0; j--) {
                        let other = drops[j];
                        let dx = drop.x - other.x;
                        let dy = drop.y - other.y;
                        let distanceSq = dx * dx + dy * dy;
                        let combinedRadius = drop.r + other.r;
                        let combinedRadiusSq = combinedRadius * combinedRadius;

                        if (distanceSq < combinedRadiusSq) {
                            // Merge drops: calculate new radius using Pythagorean theorem
                            drop.r = Math.min(Math.sqrt(drop.r * drop.r + other.r * other.r), 15);
                            // Swap-and-pop for O(1) removal instead of O(n) splice
                            drops[j] = drops[drops.length - 1];
                            drops.pop();
                            i--;
                            break;
                        }
                    }
                    if (drop.y > canvas.height + 50) {
                        drops[i] = drops[drops.length - 1];
                        drops.pop();
                    }
                }
                activeThemeAnimationId = requestAnimationFrame(animate);
            }
            animate();
        }
        function resizeGame() {
            let blockSizeFromHeight;
            let blockSizeFromWidth;
            const bodyStyle = window.getComputedStyle(document.body);

            if (window.innerWidth > 768) { // Desktop Mode
                const margin = 0.95;
                const availableHeight = window.innerHeight * margin;
                const availableWidth = window.innerWidth * margin;

                blockSizeFromHeight = availableHeight / (ROWS + 5); // Original estimation is fine here

                const sidebarWidth = 180;
                const gap = 30;
                blockSizeFromWidth = (availableWidth - sidebarWidth - gap) / COLS;
            } else { // Mobile Mode
                const bodyHPadding = parseFloat(bodyStyle.paddingLeft) + parseFloat(bodyStyle.paddingRight);
                const availableWidth = window.innerWidth - bodyHPadding;
                blockSizeFromWidth = availableWidth / COLS;

                // Precise height calculation
                const nextPiecesContainer = document.querySelector('.next-pieces-container');
                const sidebar = document.querySelector('.sidebar');
                const gameContainer = document.querySelector('.game-container');
                const gameArea = document.querySelector('.game-area');

                const gameContainerGap = parseFloat(window.getComputedStyle(gameContainer).gap) || 0;
                const gameAreaGap = parseFloat(window.getComputedStyle(gameArea).gap) || 0;

                const otherElementsHeight =
                    nextPiecesContainer.offsetHeight +
                    sidebar.offsetHeight +
                    gameContainerGap +
                    gameAreaGap;

                const bodyVPadding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
                const totalAvailableHeight = window.innerHeight - bodyVPadding;

                const canvasAvailableHeight = totalAvailableHeight - otherElementsHeight;

                blockSizeFromHeight = canvasAvailableHeight / ROWS;
            }

            BLOCK_SIZE = Math.floor(Math.min(blockSizeFromHeight, blockSizeFromWidth));

            canvas.width = COLS * BLOCK_SIZE;
            canvas.height = ROWS * BLOCK_SIZE;

            // Maintain aspect ratio of next piece canvases relative to new BLOCK_SIZE
            if (nextCanvases && nextCanvases.length > 0) {
                nextCanvases[0].width = BLOCK_SIZE * 2;
                nextCanvases[0].height = BLOCK_SIZE * (50/30);
                for (let i = 1; i < 5; i++) {
                    nextCanvases[i].width = BLOCK_SIZE * (50/30);
                    nextCanvases[i].height = BLOCK_SIZE * (40/30);
                }
            }

            // Regenerate grid cache when canvas size changes
            generateGridCache();

            // Redraw the game with new sizes if the game is active
            if (!isGameOver && currentPiece) {
                draw();
                drawNextPieces();
            }
        }

        function generateGridCache() {
            // Create offscreen canvas for grid if it doesn't exist
            if (!gridCache) {
                gridCache = document.createElement('canvas');
                gridCacheCtx = gridCache.getContext('2d');
            }

            // Set cache canvas to match game canvas size
            gridCache.width = canvas.width;
            gridCache.height = canvas.height;

            // Draw grid lines onto cache
            gridCacheCtx.strokeStyle = 'rgba(255,255,255,0.05)';
            gridCacheCtx.lineWidth = 1;

            // Draw vertical lines
            for (let x = 0; x <= COLS; x++) {
                gridCacheCtx.beginPath();
                gridCacheCtx.moveTo(x * BLOCK_SIZE, 0);
                gridCacheCtx.lineTo(x * BLOCK_SIZE, canvas.height);
                gridCacheCtx.stroke();
            }

            // Draw horizontal lines
            for (let y = 0; y <= ROWS; y++) {
                gridCacheCtx.beginPath();
                gridCacheCtx.moveTo(0, y * BLOCK_SIZE);
                gridCacheCtx.lineTo(canvas.width, y * BLOCK_SIZE);
                gridCacheCtx.stroke();
            }
        }

        let soundInitialized = false;
        let gridCache = null;  // Offscreen canvas for cached grid
        let gridCacheCtx = null;

        async function init() {
            canvas = document.getElementById('game-canvas'); ctx = canvas.getContext('2d');
            nextCanvases = Array.from({length: 5}, (_, i) => document.getElementById(`next-${i}`));
            const backgroundCanvas = document.getElementById('background-canvas');
            if (backgroundCanvas) {
                webglRenderer = new WebGLRenderer(backgroundCanvas);
            }

            resizeGame();
            window.addEventListener('resize', resizeGame);

            // Initialize tracks asynchronously before continuing
            await soundManager.initializeTracks();
            console.log('🎵 Sound manager ready with', soundManager.trackNames.length, 'tracks');

            createParticles(); loadSettings(); setupUI();
            document.addEventListener('fullscreenchange', () => {
                const fullscreenBtn = document.getElementById('fullscreen-toggle');
                fullscreenBtn.textContent = document.fullscreenElement ? '><' : '⛶';
            });

            window.addEventListener('touchstart', handleTouchStart, { passive: false });
            window.addEventListener('touchmove', handleTouchMove, { passive: false });
            window.addEventListener('touchend', handleTouchEnd, { passive: false });

            resetGame();
        }

        function createSwedishForest() {
            // Pine tree generation for parallax layers
            const layers = [
                { el: document.getElementById('sf-layer-1'), count: 80, height: 150, color: 'rgba(20, 40, 50, 0.7)' },
                { el: document.getElementById('sf-layer-2'), count: 60, height: 250, color: 'rgba(30, 55, 70, 0.8)' },
                { el: document.getElementById('sf-layer-3'), count: 40, height: 400, color: 'rgba(40, 70, 90, 0.9)' }
            ];

            layers.forEach(layer => {
                if(layer.el && layer.el.children.length === 0) {
                    const T_WIDTH = 100;
                    let canvas = document.createElement('canvas');
                    canvas.width = layer.count * T_WIDTH;
                    canvas.height = layer.height;
                    let ctx = canvas.getContext('2d');

                    for(let i = 0; i < layer.count; i++) {
                        const h = layer.height * (0.6 + Math.random() * 0.4);
                        const tH = h * (0.1 + Math.random() * 0.05);
                        const x = i * T_WIDTH + (Math.random() - 0.5) * 20;

                        // Draw trunk
                        ctx.fillStyle = layer.color;
                        ctx.fillRect(x + T_WIDTH/2 - 5, canvas.height - tH, 10, tH);

                        // Draw foliage
                        let y = canvas.height - tH;
                        let w = T_WIDTH * 0.9;
                        let numLayers = 5 + Math.floor(Math.random() * 3);
                        let layerHeight = y / numLayers;

                        for (let j = 0; j < numLayers; j++) {
                            let cY = y - (j * layerHeight);
                            let cW = w * ((numLayers - j) / numLayers) * (1 + (Math.random() - 0.5) * 0.2);
                            let sway = (Math.random() - 0.5) * 10;

                            ctx.beginPath();
                            ctx.moveTo(x + T_WIDTH/2 + sway, cY - layerHeight);
                            ctx.lineTo(x + T_WIDTH/2 - cW/2, cY);
                            ctx.lineTo(x + T_WIDTH/2 + cW/2, cY);
                            ctx.closePath();
                            ctx.fill();
                        }
                    }
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.bottom = '0';
                    canvas.style.width = `${canvas.width}px`;
                    canvas.style.height = `${canvas.height}px`;
                    layer.el.appendChild(canvas);
                }
            });

            // God ray generation
            const godRayContainer = document.querySelector('.god-ray-container');
            if (godRayContainer && godRayContainer.children.length === 0) {
                for (let i = 0; i < 15; i++) {
                    let ray = document.createElement('div');
                    ray.className = 'god-ray';
                    ray.style.left = `${Math.random() * 120 - 10}%`;
                    ray.style.top = '0px';
                    ray.style.width = `${Math.random() * 4 + 2}px`;
                    ray.style.height = '120%';
                    ray.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                    ray.style.opacity = `${Math.random() * 0.1 + 0.05}`;
                    godRayContainer.appendChild(ray);
                }
            }
        }
        function createGalaxyScene() {
            // Background Stars
            const starsContainer = document.getElementById('galaxy-stars-bg');
            if (starsContainer && starsContainer.children.length === 0) {
                for (let i = 0; i < 200; i++) {
                    let star = document.createElement('div');
                    star.className = 'galaxy-star-bg';
                    const size = Math.random() * 2 + 0.5;
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${Math.random() * 100}%`;
                    star.style.top = `${Math.random() * 100}%`;
                    star.style.animationDelay = `${Math.random() * 15}s`;
                    starsContainer.appendChild(star);
                }
            }

        }
        function createAuroraScene() {
            const auroraContainer = document.getElementById('aurora-theme');
            const starsContainer = document.getElementById('aurora-stars');
            const dynamicStyleId = 'aurora-dynamic-styles';

            // 1. Smooth cleanup - fade out old elements before removing
            const oldElements = Array.from(auroraContainer.children).filter(child => child !== starsContainer);
            if (oldElements.length > 0) {
                oldElements.forEach(el => {
                    el.style.transition = 'opacity 5s ease-out';
                    el.style.opacity = '0';
                });

                // Remove after fade completes
                setTimeout(() => {
                    const oldStyleElement = document.getElementById(dynamicStyleId);
                    if (oldStyleElement) {
                        oldStyleElement.remove();
                    }
                    while (auroraContainer.lastChild && auroraContainer.lastChild !== starsContainer) {
                        auroraContainer.removeChild(auroraContainer.lastChild);
                    }
                }, 5000);

                // Delay new aurora creation for smooth crossfade
                setTimeout(() => createAuroraLayers(), 3500);
                return;
            }

            createAuroraLayers();
        }

        function createAuroraLayers() {
            const auroraContainer = document.getElementById('aurora-theme');
            const starsContainer = document.getElementById('aurora-stars');
            const dynamicStyleId = 'aurora-dynamic-styles';
        
            // 2. Preserve existing star generation
            if (starsContainer && starsContainer.children.length === 0) {
                for (let i = 0; i < 150; i++) {
                    let star = document.createElement('div');
                    star.className = 'aurora-star';
                    const size = random(0.5, 1.5);
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${random(0, 100)}%`;
                    star.style.top = `${random(0, 100)}%`;
                    star.style.animationDelay = `${random(0, 10)}s`;
                    starsContainer.appendChild(star);
                }
            }
        
            // 3. Enhanced Color System with natural aurora palettes
            const colorPalettes = [
                // Classic Green Aurora (most common in nature)
                { colors: ['#00ff87', '#39ff14', '#7fff00', '#40e0d0', '#00ffaa'], name: 'emerald', weight: 3 },
                // Pink-Purple Aurora (rare, occurs at very high altitudes)
                { colors: ['#ff1493', '#ff66cc', '#bf00ff', '#a29bfe', '#ff00aa'], name: 'magenta', weight: 1 },
                // Teal-Blue Aurora (nitrogen-based)
                { colors: ['#00ffff', '#64ffda', '#40e0d0', '#00ffaa', '#00ddff'], name: 'cyan', weight: 2 },
                // Mixed Classic (green with pink/purple accents)
                { colors: ['#00ff87', '#39ff14', '#ff1493', '#bf00ff', '#40e0d0'], name: 'mixed', weight: 2 },
                // Rare Red Aurora (extremely rare, very high altitude)
                { colors: ['#ff006e', '#ff4757', '#ff1493', '#ff0055', '#bf00ff'], name: 'ruby', weight: 0.5 },
                // Yellow-Green blend (oxygen at lower altitudes)
                { colors: ['#7fff00', '#9acd32', '#adff2f', '#00ff87', '#40e0d0'], name: 'lime', weight: 2 },
                // Deep blue-violet (nitrogen)
                { colors: ['#6a5acd', '#7b68ee', '#8a2be2', '#9370db', '#ba55d3'], name: 'violet', weight: 1.5 }
            ];

            // Weighted random selection for more natural distribution
            const weightedPalette = [];
            colorPalettes.forEach(palette => {
                const weight = Math.floor(palette.weight * 10);
                for (let i = 0; i < weight; i++) {
                    weightedPalette.push(palette);
                }
            });

            const numLayers = Math.floor(random(4, 6)); // Fewer layers for subtlety
            let dynamicKeyframes = '';

            // Create shimmer particle container with fade-in
            const shimmerContainer = document.createElement('div');
            shimmerContainer.className = 'aurora-shimmer-container';
            shimmerContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 60%; z-index: 20; pointer-events: none; opacity: 0; transition: opacity 6s ease-in;';
            auroraContainer.appendChild(shimmerContainer);

            // Trigger fade-in
            setTimeout(() => {
                shimmerContainer.style.opacity = '1';
            }, 50);

            // Add shimmer particles with varied characteristics
            const numShimmers = Math.floor(random(25, 40)); // Fewer particles for subtlety
            for (let i = 0; i < numShimmers; i++) {
                const particle = document.createElement('div');
                particle.className = 'aurora-shimmer';

                // Randomize starting position with clustering effect (upper sky only)
                const clusterX = random(10, 90);
                const clusterY = random(5, 35); // Focus on upper third of screen
                particle.style.left = `${clusterX + random(-15, 15)}%`;
                particle.style.top = `${clusterY + random(-8, 8)}%`;

                // Varied timing for organic feel
                const duration = random(20, 45);
                particle.style.animationDelay = `-${random(0, duration)}s`;
                particle.style.animationDuration = `${duration}s`;

                // Vary particle size
                const size = random(1.5, 3.5);
                particle.style.width = `${size}px`;
                particle.style.height = `${size}px`;

                shimmerContainer.appendChild(particle);
            }
        
            // Create aurora curtains with realistic motion and smooth fade-in
            for (let i = 0; i < numLayers; i++) {
                const layer = document.createElement('div');
                const animationName = `aurora-flow-layer-${i}-${Date.now()}`;
                const pulseAnimationName = `aurora-pulse-${i}-${Date.now()}`;
                const waveAnimationName = `aurora-wave-${i}-${Date.now()}`;
                const colorCycleAnimationName = `aurora-color-cycle-${i}-${Date.now()}`;
                const fadeInAnimationName = `aurora-fadein-${i}-${Date.now()}`;

                // Select palette using weighted random for natural distribution
                const palette = weightedPalette[Math.floor(random(0, weightedPalette.length))];
                const initialColorIndex = Math.floor(random(0, palette.colors.length));
                const color = palette.colors[initialColorIndex];
                const nextColor = palette.colors[(initialColorIndex + 1) % palette.colors.length];
                const thirdColor = palette.colors[(initialColorIndex + 2) % palette.colors.length];
                
                // Position with depth and natural variation (constrained to upper sky)
                const depth = i / numLayers; // 0 (far) to 1 (close)
                const top = random(-60, -10) - (depth * 15); // Keep in upper portion
                const width = random(100, 180) + (depth * 40); // More subtle widths
                const height = random(120, 200) + (depth * 30); // More constrained heights
                const opacity = random(0.25, 0.45) + (depth * 0.15); // Much more subtle
                const blur = random(15, 35) - (depth * 8); // More blur for softer look
                const zIndex = Math.floor(i * 2) + 5;

                // More organic gradient shapes with multiple focus points
                const gradX = random(20, 80);
                const gradY = random(20, 60);
                const transparentStop = random(35, 55);
                const colorStop = random(75, 92);

                // Create multi-stop gradient for more natural, subtle appearance
                layer.style.background = `radial-gradient(ellipse ${random(35, 60)}% ${random(70, 100)}% at ${gradX}% ${gradY}%,
                    transparent 0%,
                    transparent ${transparentStop}%,
                    ${color} ${colorStop}%,
                    ${color} 100%)`;

                layer.style.position = 'absolute';
                layer.style.top = `${top}%`;
                layer.style.left = `${random(-40, 10)}%`;
                layer.style.width = `${width}%`;
                layer.style.height = `${height}%`;
                layer.style.opacity = '0'; // Start invisible for fade-in animation
                layer.style.mixBlendMode = 'screen';
                layer.style.willChange = 'transform, filter, opacity';
                layer.style.zIndex = zIndex;
                layer.style.filter = `blur(${blur}px) saturate(${random(0.9, 1.2)})`;

                // Store target opacity as data attribute for pulse animation
                layer.setAttribute('data-target-opacity', opacity);

                // Multiple animation layers for complex, natural motion
                const flowDuration = random(50, 100); // Much slower, more majestic
                const pulseDuration = random(18, 35);
                const waveDuration = random(25, 50);
                const colorCycleDuration = random(80, 140);
                
                const flowDirection = Math.random() > 0.5 ? 'alternate' : 'alternate-reverse';
                const waveDirection = Math.random() > 0.5 ? 'alternate' : 'alternate-reverse';
                
                // Stagger fade-in for each layer
                const fadeInDelay = i * 0.7; // 700ms between each layer appearing

                layer.style.animation = `
                    ${fadeInAnimationName} 7s ease-in ${fadeInDelay}s forwards,
                    ${animationName} ${flowDuration}s ease-in-out infinite ${flowDirection} ${fadeInDelay + 7}s,
                    ${pulseAnimationName} ${pulseDuration}s ease-in-out infinite alternate ${fadeInDelay + 7}s,
                    ${waveAnimationName} ${waveDuration}s ease-in-out infinite ${waveDirection} ${fadeInDelay + 7}s
                `;

                // Use CSS transition for smooth color changes instead of keyframes
                layer.style.transition = `background ${colorCycleDuration * 0.4}s ease-in-out`;

                // Fade-in animation with target opacity
                const fadeInKeyframes = `
                    0% { opacity: 0; }
                    100% { opacity: ${opacity}; }
                `;
                dynamicKeyframes += `@keyframes ${fadeInAnimationName} {\n${fadeInKeyframes}}\n`;
            
                // Generate organic flow animation with ultra-smooth, sinuous motion
                let flowKeyframes = '0% { transform: translateX(0%) rotate(0deg) scaleX(1); }\n';
                const numFlowPoints = Math.floor(random(12, 18)); // Many more points for buttery smooth curves
                for (let j = 1; j < numFlowPoints; j++) { // Exclude last point, set separately
                    const percent = (j / numFlowPoints) * 100;
                    // Use sine wave for more natural drift pattern
                    const driftBase = Math.sin((percent / 100) * Math.PI * 2) * random(15, 35);
                    const driftNoise = random(-5, 5); // Less noise for smoother motion
                    const drift = driftBase + driftNoise;
                    const rotate = Math.sin((percent / 100) * Math.PI * 3) * random(8, 18);
                    const scaleX = 0.95 + Math.sin((percent / 100) * Math.PI * 4) * 0.15;
                    flowKeyframes += `${percent.toFixed(2)}% { transform: translateX(${drift.toFixed(2)}%) rotate(${rotate.toFixed(2)}deg) scaleX(${scaleX.toFixed(3)}); }\n`;
                }
                flowKeyframes += '100% { transform: translateX(0%) rotate(0deg) scaleX(1); }\n';
            
                // Generate pulsing/breathing effect with smooth, subtle transitions
                const pulseKeyframes = `
                    0% {
                        opacity: ${opacity * 0.7};
                        filter: blur(${blur}px) brightness(0.9) saturate(${random(0.9, 1.2)});
                    }
                    25% {
                        opacity: ${Math.min(opacity * 1.05, 0.7)};
                        filter: blur(${blur * 0.96}px) brightness(1.05) saturate(${random(0.95, 1.25)});
                    }
                    50% {
                        opacity: ${Math.min(opacity * 1.2, 0.75)};
                        filter: blur(${blur * 0.92}px) brightness(1.2) saturate(${random(1, 1.3)});
                    }
                    75% {
                        opacity: ${Math.min(opacity * 1.05, 0.7)};
                        filter: blur(${blur * 0.96}px) brightness(1.05) saturate(${random(0.95, 1.25)});
                    }
                    100% {
                        opacity: ${opacity * 0.7};
                        filter: blur(${blur}px) brightness(0.9) saturate(${random(0.9, 1.2)});
                    }
                `;
            
                // Generate vertical wave motion with ultra-smooth natural undulation
                let waveKeyframes = '0% { transform: translateY(0%) scaleY(1) skewX(0deg); }\n';
                const numWavePoints = Math.floor(random(15, 22)); // Many more points for ultra-fluid motion
                for (let j = 1; j < numWavePoints; j++) { // Exclude last point
                    const percent = (j / numWavePoints) * 100;
                    // Multi-frequency wave for complex, natural motion
                    const wave1 = Math.sin((percent / 100) * Math.PI * 2) * random(10, 22);
                    const wave2 = Math.sin((percent / 100) * Math.PI * 5) * random(3, 8);
                    const wave = wave1 + wave2;
                    const scaleY = 0.92 + Math.sin((percent / 100) * Math.PI * 3) * 0.18;
                    const skewX = Math.sin((percent / 100) * Math.PI * 4) * random(6, 12);
                    waveKeyframes += `${percent.toFixed(2)}% { transform: translateY(${wave.toFixed(2)}%) scaleY(${scaleY.toFixed(3)}) skewX(${skewX.toFixed(2)}deg); }\n`;
                }
                waveKeyframes += '100% { transform: translateY(0%) scaleY(1) skewX(0deg); }\n';
            
                // Set up smooth color cycling using setInterval with CSS transitions
                const colorSequence = [
                    {
                        color: color,
                        gradX: gradX,
                        gradY: gradY,
                        ellipseW: random(40, 70),
                        ellipseH: random(80, 120),
                        transparentStop: transparentStop,
                        colorStop: colorStop
                    },
                    {
                        color: nextColor,
                        gradX: random(15, 85),
                        gradY: random(25, 75),
                        ellipseW: random(45, 75),
                        ellipseH: random(85, 125),
                        transparentStop: random(30, 50),
                        colorStop: random(70, 90)
                    },
                    {
                        color: thirdColor,
                        gradX: random(15, 85),
                        gradY: random(25, 75),
                        ellipseW: random(38, 68),
                        ellipseH: random(78, 118),
                        transparentStop: random(32, 48),
                        colorStop: random(72, 92)
                    }
                ];

                let colorIndex = 0;
                const cycleColors = () => {
                    if (activeTheme !== 'aurora' || !layer.parentElement) return;

                    colorIndex = (colorIndex + 1) % colorSequence.length;
                    const nextGrad = colorSequence[colorIndex];

                    layer.style.background = `radial-gradient(ellipse ${nextGrad.ellipseW}% ${nextGrad.ellipseH}% at ${nextGrad.gradX}% ${nextGrad.gradY}%,
                        transparent 0%,
                        transparent ${nextGrad.transparentStop}%,
                        ${nextGrad.color} ${nextGrad.colorStop}%,
                        ${nextGrad.color} 100%)`;
                };

                // Start color cycling after fade-in completes
                setTimeout(() => {
                    if (activeTheme === 'aurora' && layer.parentElement) {
                        setInterval(cycleColors, colorCycleDuration * 1000 / 3);
                    }
                }, (fadeInDelay + 7) * 1000);

                dynamicKeyframes += `@keyframes ${animationName} {\n${flowKeyframes}}\n`;
                dynamicKeyframes += `@keyframes ${pulseAnimationName} {\n${pulseKeyframes}}\n`;
                dynamicKeyframes += `@keyframes ${waveAnimationName} {\n${waveKeyframes}}\n`;
                
                auroraContainer.appendChild(layer);
            
                // Add random surge effect for subtle dynamic energy bursts
                if (Math.random() > 0.65) { // Less frequent, more special surges
                    const surgeDelay = random(5000, 60000);
                    setTimeout(() => {
                        if (activeTheme === 'aurora' && layer.parentElement) {
                            const surgeName = `aurora-surge-${Date.now()}`;
                            const surgeDuration = random(6, 12);
                            const surgeKeyframes = `
                                @keyframes ${surgeName} {
                                    0% {
                                        opacity: ${opacity};
                                        filter: blur(${blur}px) brightness(0.9) saturate(${random(0.9, 1.2)});
                                    }
                                    15% {
                                        opacity: ${Math.min(opacity * 1.3, 0.7)};
                                        filter: blur(${blur * 0.9}px) brightness(1.4) saturate(${random(1.2, 1.5)});
                                    }
                                    50% {
                                        opacity: ${Math.min(opacity * 1.6, 0.8)};
                                        filter: blur(${blur * 0.85}px) brightness(1.8) saturate(${random(1.3, 1.6)});
                                    }
                                    85% {
                                        opacity: ${Math.min(opacity * 1.3, 0.7)};
                                        filter: blur(${blur * 0.9}px) brightness(1.4) saturate(${random(1.2, 1.5)});
                                    }
                                    100% {
                                        opacity: ${opacity};
                                        filter: blur(${blur}px) brightness(0.9) saturate(${random(0.9, 1.2)});
                                    }
                                }
                            `;
                            const surgeStyle = document.createElement('style');
                            surgeStyle.textContent = surgeKeyframes;
                            document.head.appendChild(surgeStyle);

                            layer.style.animation += `, ${surgeName} ${surgeDuration}s ease-in-out`;

                            setTimeout(() => surgeStyle.remove(), surgeDuration * 1000 + 1000);
                        }
                    }, surgeDelay);
                }
            }
        
            // Inject all keyframe styles
            const styleElement = document.createElement('style');
            styleElement.id = dynamicStyleId;
            styleElement.textContent = dynamicKeyframes;
            document.head.appendChild(styleElement);
        }
        function createSpringScene() {
            // Drifting Clouds
            const cloudContainer = document.getElementById('spring-clouds');
            if (cloudContainer && cloudContainer.children.length === 0) {
                for (let i = 0; i < 15; i++) {
                    let cloud = document.createElement('div');
                    cloud.className = 'spring-cloud';
                    const size = Math.random() * 150 + 100;
                    cloud.style.width = `${size}px`;
                    cloud.style.height = `${size * 0.6}px`;
                    cloud.style.top = `${Math.random() * 50}%`;
                    cloud.style.opacity = Math.random() * 0.4 + 0.3;
                    const duration = Math.random() * 80 + 60;
                    cloud.style.animationDuration = `${duration}s`;
                    cloud.style.animationDelay = `-${Math.random() * duration}s`;
                    cloudContainer.appendChild(cloud);
                }
            }

            // Multi-layered Rain
            const rainLayers = [
                { container: document.getElementById('rain-back'), count: 50, width: '0.8px', height: '40px', duration: 0.6, drift: -10 },
                { container: document.getElementById('rain-mid'), count: 60, width: '1px', height: '60px', duration: 0.5, drift: -15 },
                { container: document.getElementById('rain-front'), count: 30, width: '1.2px', height: '80px', duration: 0.4, drift: -20 }
            ];
            rainLayers.forEach(layer => {
                if (layer.container && layer.container.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        let drop = document.createElement('div');
                        drop.className = 'spring-raindrop';
                        drop.style.left = `${Math.random() * 105}%`; // Allow some overflow
                        drop.style.width = layer.width;
                        drop.style.height = layer.height;
                        const animDuration = Math.random() * 0.2 + layer.duration;
                        drop.style.animationDuration = `${animDuration}s`;
                        drop.style.animationDelay = `-${Math.random() * animDuration * 5}s`;
                        drop.style.setProperty('--x-drift', `${layer.drift}px`);
                        layer.container.appendChild(drop);
                    }
                }
            });

            // Unfurling Sprouts with Life Cycle
            const sproutsContainer = document.getElementById('sprouts-container');
            if (sproutsContainer && sproutsContainer.children.length === 0) {
                for (let i = 0; i < 25; i++) {
                    let sprout = document.createElement('div');
                    sprout.className = 'sprout';
                    sprout.style.left = `${5 + Math.random() * 90}%`;
                    sprout.style.animationDelay = `-${Math.random() * 25}s`;

                    const leftLeaf = document.createElement('div');
                    leftLeaf.className = 'left';
                    const rightLeaf = document.createElement('div');
                    rightLeaf.className = 'right';

                    // Vary sway speed for each sprout
                    const swayDuration = Math.random() * 2 + 4;
                    leftLeaf.style.animationDuration = `${swayDuration}s`;
                    rightLeaf.style.animationDuration = `${swayDuration}s`;

                    sprout.appendChild(leftLeaf);
                    sprout.appendChild(rightLeaf);
                    sproutsContainer.appendChild(sprout);
                }
            }
        }
        function createRainyWindow() {
            const canvas = document.getElementById('rain-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            function resizeCanvas() {
                if (!canvas) return;
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
            }
            window.addEventListener('resize', resizeCanvas, false);
            resizeCanvas();

            let drops = [];
            function createDrop(isInitial) {
                return {
                    x: Math.random() * canvas.width,
                    y: isInitial ? Math.random() * canvas.height : -50,
                    r: Math.random() * 1.5 + 1,
                    vy: Math.random() * 3 + 2,
                    isStreaking: false
                };
            }
            for(let i=0; i<150; i++){ drops.push(createDrop(true)); }

            // Cache style strings outside animation loop (performance optimization)
            const streakStyle = 'rgba(220, 230, 255, 0.3)';
            const dropStyle = 'rgba(220, 230, 255, 0.6)';

            function animate() {
                if (activeTheme !== 'rainy-window') {
                    return;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                if(Math.random() > 0.8) drops.push(createDrop(false));

                for (let i = drops.length - 1; i >= 0; i--) {
                    let drop = drops[i];
                    if (drop.r > 3.5) drop.isStreaking = true;
                    drop.y += drop.vy;
                    if (drop.isStreaking) {
                        ctx.beginPath();
                        ctx.moveTo(drop.x, drop.y - drop.r * 4);
                        ctx.lineTo(drop.x, drop.y);
                        ctx.strokeStyle = streakStyle;
                        ctx.lineWidth = drop.r * 0.6;
                        ctx.stroke();
                    }
                    ctx.beginPath();
                    ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
                    ctx.fillStyle = dropStyle;
                    ctx.fill();

                    // Optimized collision detection: use squared distance to avoid sqrt()
                    for (let j = i - 1; j >= 0; j--) {
                        let other = drops[j];
                        let dx = drop.x - other.x;
                        let dy = drop.y - other.y;
                        let distanceSq = dx * dx + dy * dy;
                        let combinedRadius = drop.r + other.r;
                        let combinedRadiusSq = combinedRadius * combinedRadius;

                        if (distanceSq < combinedRadiusSq) {
                            // Merge drops: calculate new radius using Pythagorean theorem
                            drop.r = Math.min(Math.sqrt(drop.r * drop.r + other.r * other.r), 15);
                            // Swap-and-pop for O(1) removal instead of O(n) splice
                            drops[j] = drops[drops.length - 1];
                            drops.pop();
                            i--;
                            break;
                        }
                    }
                    if (drop.y > canvas.height + 50) {
                        drops[i] = drops[drops.length - 1];
                        drops.pop();
                    }
                }
                activeThemeAnimationId = requestAnimationFrame(animate);
            }
            animate();
        }
        function createSummerScene() {
            // God Rays
            const godRayContainer = document.querySelector('.god-rays-summer');
            if (godRayContainer && godRayContainer.children.length === 0) {
                for (let i = 0; i < 20; i++) {
                    let ray = document.createElement('div');
                    ray.className = 'summer-god-ray';
                    ray.style.left = `${Math.random() * 140 - 20}%`;
                    ray.style.top = '0px';
                    ray.style.width = `${Math.random() * 4 + 2}px`;
                    ray.style.height = '120%';
                    ray.style.transform = `rotate(${Math.random() * 40 - 20}deg)`;
                    ray.style.animationDelay = `-${Math.random() * 8}s`; // Add delay for breathing effect
                    godRayContainer.appendChild(ray);
                }
            }

            // Dandelion Seeds
            const seedContainer = document.getElementById('dandelion-seeds');
            if (seedContainer && seedContainer.children.length === 0) {
                for (let i = 0; i < 60; i++) { // Increased seed count
                    let seed = document.createElement('div');
                    seed.className = 'dandelion-seed';
                    const xStart = Math.random() * 100;
                    const yStart = 100 + Math.random() * 20;
                    const xEnd = Math.random() * 100;
                    const yEnd = -20 + Math.random() * -20;
                    seed.style.setProperty('--x-start', `${xStart}vw`);
                    seed.style.setProperty('--y-start', `${yStart}vh`);
                    seed.style.setProperty('--x-mid', `${xStart + (Math.random() - 0.5) * 40}vw`);
                    seed.style.setProperty('--y-mid', `${(yStart + yEnd) / 2}vh`);
                    seed.style.setProperty('--x-end', `${xEnd}vw`);
                    seed.style.setProperty('--y-end', `${yEnd}vh`);
                    seed.style.animationDuration = `${Math.random() * 10 + 15}s`;
                    seed.style.animationDelay = `-${Math.random() * 25}s`;
                    seedContainer.appendChild(seed);
                }
            }

            // Swaying Grass
            const grassContainer = document.querySelector('.summer-grass');
            if (grassContainer && grassContainer.children.length === 0) {
                for (let i = 0; i < 120; i++) {
                    let blade = document.createElement('div');
                    blade.className = 'summer-grass-blade';
                    blade.style.left = `${Math.random() * 100}%`;
                    blade.style.height = `${Math.random() * 40 + 20}px`;
                    blade.style.animationDelay = `-${Math.random() * 7}s`;
                    blade.style.filter = `brightness(${Math.random() * 0.3 + 0.8})`;
                    grassContainer.appendChild(blade);
                }
            }
        }
        function createAutumnScene() {
            // Define leaf shapes and colors
            const leafShapes = [
                'M15 0 C0 5, 5 25, 15 30 C25 25, 30 5, 15 0 Z', // Simple teardrop
                'M15 0 L17 10 L30 12 L18 18 L22 30 L15 25 L8 30 L12 18 L0 12 L13 10 Z', // Maple-like
                'M15 0 C 0 10, 0 20, 5 30 C 10 25, 20 25, 25 30 C 30 20, 30 10, 15 0 Z' // Oak-like
            ];
            const leafColors = ['#d44d2d', '#f7a156', '#a26e49', '#6d4c3c'];

            // Multi-layered falling leaves
            const leafLayers = [
                { container: document.getElementById('fall-leaves-back'), count: 20, minSize: 15, maxSize: 25, minDuration: 15, maxDuration: 20 },
                { container: document.getElementById('fall-leaves-mid'), count: 15, minSize: 20, maxSize: 35, minDuration: 10, maxDuration: 15 },
                { container: document.getElementById('fall-leaves-front'), count: 10, minSize: 25, maxSize: 45, minDuration: 7, maxDuration: 12 }
            ];

            leafLayers.forEach(layer => {
                if (layer.container && layer.container.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        let leaf = document.createElement('div');
                        leaf.className = 'leaf';
                        const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                        const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                        leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;
                        const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                        leaf.style.width = `${size}px`;
                        leaf.style.height = `${size}px`;

                        leaf.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                        leaf.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                        leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
                        leaf.style.setProperty('--r-end', `${Math.random() * 1440 - 720}deg`);
                        for(let j = 1; j <= 4; j++) {
                            leaf.style.setProperty(`--x-gust${j}`, `${Math.random() * 20 - 10}vw`);
                        }

                        const duration = Math.random() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                        leaf.style.animationDuration = `${duration}s`;
                        leaf.style.animationDelay = `-${Math.random() * duration}s`;
                        layer.container.appendChild(leaf);
                    }
                }
            });

            // Dynamic Ground leaves
            const groundContainer = document.querySelector('.ground-leaves');
            if (groundContainer && groundContainer.children.length === 0) {
                groundContainer.style.backgroundImage = ''; // Clear any old canvas
                for (let i = 0; i < 80; i++) {
                    let leaf = document.createElement('div');
                    leaf.className = 'ground-leaf';
                    const shape = leafShapes[Math.floor(Math.random() * leafShapes.length)];
                    const color = leafColors[Math.floor(Math.random() * leafColors.length)];
                    leaf.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><path d="${shape}" fill="${encodeURIComponent(color)}"/></svg>')`;

                    const size = Math.random() * 25 + 20;
                    leaf.style.width = `${size}px`;
                    leaf.style.height = `${size}px`;
                    leaf.style.left = `${Math.random() * 100}%`;
                    leaf.style.bottom = `${Math.random() * 40 - 10}px`; // Stagger vertically
                    leaf.style.opacity = Math.random() * 0.5 + 0.5;

                    leaf.style.setProperty('--r1', `${Math.random() * 20 - 10}deg`);
                    leaf.style.setProperty('--r2', `${Math.random() * 20 - 10}deg`);
                    leaf.style.animationDuration = `${Math.random() * 5 + 5}s`;
                    leaf.style.animationDelay = `-${Math.random() * 10}s`;

                    groundContainer.appendChild(leaf);
                }
            }

            // Wind Particles
            const windContainer = document.getElementById('fall-wind-particles');
            if (windContainer && windContainer.children.length === 0) {
                for (let i = 0; i < 10; i++) {
                    let particle = document.createElement('div');
                    particle.className = 'fall-wind-particle';
                    particle.style.top = `${Math.random() * 100}%`;
                    const duration = Math.random() * 3 + 2;
                    particle.style.animationDuration = `${duration}s`;
                    particle.style.animationDelay = `-${Math.random() * duration}s`;
                    windContainer.appendChild(particle);
                }
            }
        }
        function createWinterScene() {
            // Multi-layered snowfall
            const snowflakeLayers = [
                { container: document.getElementById('snowflakes-back'), count: 70, minSize: 1, maxSize: 3, minDuration: 20, maxDuration: 30 },
                { container: document.getElementById('snowflakes-mid'), count: 50, minSize: 2, maxSize: 5, minDuration: 10, maxDuration: 15 },
                { container: document.getElementById('snowflakes-front'), count: 30, minSize: 4, maxSize: 8, minDuration: 5, maxDuration: 8 }
            ];

            snowflakeLayers.forEach(layer => {
                if (layer.container && layer.container.children.length === 0) {
                    for (let i = 0; i < layer.count; i++) {
                        let flake = document.createElement('div');
                        flake.className = 'snowflake';
                        const size = Math.random() * (layer.maxSize - layer.minSize) + layer.minSize;
                        flake.style.width = `${size}px`;
                        flake.style.height = `${size}px`;
                        const xStart = Math.random() * 120 - 10;
                        const windEffect = (Math.random() - 0.5) * 50; // Wind gust effect
                        flake.style.setProperty('--x-start', `${xStart}vw`);
                        flake.style.setProperty('--x-end', `${xStart + windEffect + (Math.random() * 20 - 10)}vw`);
                        flake.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);
                        const duration = Math.random() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                        flake.style.animationDuration = `${duration}s`;
                        flake.style.animationDelay = `-${Math.random() * duration}s`;
                        layer.container.appendChild(flake);
                    }
                }
            });

            // Ice crystal generation
            const crystalContainer = document.querySelector('.ice-crystals');
            if (crystalContainer && crystalContainer.children.length === 0) {
                for (let i = 0; i < 5; i++) { // Reduced count for subtlety
                    let crystal = document.createElement('div');
                    crystal.className = 'ice-crystal';

                    // Position near corners
                    const corner = Math.floor(Math.random() * 4);
                    const xPos = (corner % 2 === 0) ? `${Math.random() * 20}%` : `${80 + Math.random() * 20}%`;
                    const yPos = (corner < 2) ? `${Math.random() * 20}%` : `${80 + Math.random() * 20}%`;
                    crystal.style.left = xPos;
                    crystal.style.top = yPos;

                    const size = Math.random() * 80 + 40; // Adjusted size
                    crystal.style.width = `${size}px`;
                    crystal.style.height = `${size}px`;
                    crystal.style.animationDelay = `-${Math.random() * 30}s`;
                    crystalContainer.appendChild(crystal);
                }
            }
        }
        function createEnchantedForest() {
            // Tree generation for parallax layers with mystical elements
            const layers = [
                { el: document.getElementById('enchanted-forest-back'), count: 40, color: 'rgba(10, 15, 25, 0.7)', height: 250, detail: 'low' },
                { el: document.getElementById('enchanted-forest-mid'), count: 30, color: 'rgba(20, 30, 50, 0.8)', height: 350, detail: 'mid' },
                { el: document.getElementById('enchanted-forest-front'), count: 20, color: 'rgba(30, 45, 75, 0.9)', height: 500, detail: 'high' }
            ];

            layers.forEach(layer => {
                if(layer.el && layer.el.children.length === 0) {
                    const T_WIDTH = 150;
                    let canvas = document.createElement('canvas');
                    canvas.width = layer.count * T_WIDTH;
                    canvas.height = layer.height;
                    let ctx = canvas.getContext('2d');

                    for(let i = 0; i < layer.count; i++) {
                        const x = i * T_WIDTH + Math.random() * (T_WIDTH / 2);
                        const h = layer.height * (0.7 + Math.random() * 0.3);
                        const trunkWidth = 10 + Math.random() * 10;

                        // Draw organic trunk with curves
                        ctx.strokeStyle = layer.color;
                        ctx.fillStyle = layer.color;
                        ctx.lineWidth = trunkWidth;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';

                        ctx.beginPath();
                        ctx.moveTo(x, canvas.height);
                        const segments = 8;
                        for(let s = 1; s <= segments; s++) {
                            const segmentH = canvas.height - (h / segments) * s;
                            const sway = Math.sin(s * 0.5) * (Math.random() * 15 - 7.5);
                            ctx.lineTo(x + sway, segmentH);
                        }
                        ctx.stroke();

                        // Draw branches with foliage
                        const branchCount = layer.detail === 'high' ? 8 : layer.detail === 'mid' ? 6 : 4;
                        for(let j = 0; j < branchCount; j++) {
                            const branchY = canvas.height - h * 0.3 + (Math.random() * (h * 0.6));
                            const branchLen = Math.random() * 50 + 30;
                            const angle = (Math.random() - 0.5) * Math.PI * 0.8;
                            const branchSway = Math.sin(j * 0.8) * 8;

                            ctx.lineWidth = Math.random() * 4 + 2;
                            ctx.beginPath();
                            ctx.moveTo(x + branchSway, branchY);
                            const endX = x + branchSway + Math.cos(angle) * branchLen;
                            const endY = branchY + Math.sin(angle) * branchLen;
                            ctx.quadraticCurveTo(
                                x + branchSway + Math.cos(angle) * branchLen * 0.5,
                                branchY + Math.sin(angle) * branchLen * 0.5 - 10,
                                endX, endY
                            );
                            ctx.stroke();

                            // Add foliage clusters
                            if(layer.detail !== 'low') {
                                ctx.globalAlpha = 0.6;
                                ctx.fillStyle = `rgba(${40 + Math.random() * 30}, ${60 + Math.random() * 40}, ${80 + Math.random() * 40}, 0.4)`;
                                const foliageSize = Math.random() * 25 + 15;
                                ctx.beginPath();
                                ctx.arc(endX, endY, foliageSize, 0, Math.PI * 2);
                                ctx.fill();
                                ctx.globalAlpha = 1;
                            }
                        }

                        // Add glowing moss/lichen on front layer
                        if(layer.detail === 'high' && Math.random() > 0.5) {
                            ctx.fillStyle = `rgba(100, 200, 150, ${0.3 + Math.random() * 0.3})`;
                            const mossY = canvas.height - h * (0.2 + Math.random() * 0.4);
                            ctx.beginPath();
                            ctx.ellipse(x, mossY, trunkWidth * 0.6, 15, 0, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.bottom = '0';
                    canvas.style.width = `${canvas.width}px`;
                    canvas.style.height = `${canvas.height}px`;
                    layer.el.appendChild(canvas);

                    // Add mystical elements to DOM
                    if(layer.detail === 'high') {
                        // Add mushrooms
                        for(let i = 0; i < 15; i++) {
                            const mushroom = document.createElement('div');
                            mushroom.className = 'forest-mushroom';
                            mushroom.style.left = `${Math.random() * 100}%`;
                            mushroom.style.animationDelay = `${Math.random() * 3}s`;
                            layer.el.appendChild(mushroom);
                        }
                        // Add wisps
                        for(let i = 0; i < 20; i++) {
                            const wisp = document.createElement('div');
                            wisp.className = 'forest-wisp';
                            wisp.style.left = `${Math.random() * 100}%`;
                            wisp.style.bottom = `${Math.random() * 80 + 10}%`;
                            wisp.style.animationDelay = `${Math.random() * 20}s`;
                            wisp.style.animationDuration = `${15 + Math.random() * 10}s`;
                            layer.el.appendChild(wisp);
                        }
                    } else if(layer.detail === 'mid') {
                        // Add eyes in the darkness
                        for(let i = 0; i < 8; i++) {
                            const eyes = document.createElement('div');
                            eyes.className = 'forest-eyes';
                            eyes.style.left = `${Math.random() * 100}%`;
                            eyes.style.top = `${30 + Math.random() * 40}%`;
                            eyes.style.animationDelay = `${Math.random() * 8}s`;
                            eyes.style.animationDuration = `${6 + Math.random() * 4}s`;
                            layer.el.appendChild(eyes);
                        }
                    }
                }
            });
        }
        
        function createSunset() {
            const themeContainer = document.getElementById('sunset-theme');
            const sun = themeContainer.querySelector('.sun');

            // Set initial random path (though it won't be used)

            // Remove the event listener that was changing the path

            // Procedurally generate clouds (keep existing cloud code)
            const cloudLayers = [
                { el: document.getElementById('sunset-clouds-back'), count: 10, color: 'rgba(255, 255, 255, 0.2)', height: 300, width: 800 },
                { el: document.getElementById('sunset-clouds-mid'), count: 8, color: 'rgba(255, 230, 200, 0.5)', height: 250, width: 600 },
                { el: document.getElementById('sunset-clouds-front'), count: 6, color: 'rgba(255, 240, 220, 0.8)', height: 200, width: 400 }
            ];

            cloudLayers.forEach(layer => {
                if (layer.el && layer.el.children.length === 0) {
                    let canvas = document.createElement('canvas');
                    canvas.width = layer.count * layer.width;
                    canvas.height = layer.height;
                    let ctx = canvas.getContext('2d');

                    for (let i = 0; i < layer.count; i++) {
                        const x = i * layer.width + Math.random() * (layer.width / 2);
                        const y = Math.random() * (canvas.height * 0.4) + canvas.height * 0.1;
                        const w = layer.width * (0.6 + Math.random() * 0.4);
                        const h = layer.height * (0.4 + Math.random() * 0.3);
                        ctx.fillStyle = layer.color;
                        ctx.filter = `blur(${Math.random() * 10 + 5}px)`;

                        for(let j=0; j<8; j++) {
                            const puffX = x + (Math.random() - 0.5) * w;
                            const puffY = y + (Math.random() - 0.5) * h;
                            const puffR = Math.random() * (w/4) + (w/8);
                            ctx.beginPath();
                            ctx.arc(puffX, puffY, puffR, 0, 2 * Math.PI);
                            ctx.fill();
                        }
                    }
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.top = `${Math.random() * 20}%`;
                    canvas.style.width = `${canvas.width}px`;
                    canvas.style.height = `100%`;
                    layer.el.appendChild(canvas);
                }
            });

            // Procedurally generate mountain silhouette (keep existing code)
            const mountainContainer = document.querySelector('.mountain-silhouette');
            if (mountainContainer && mountainContainer.children.length === 0) {
                let canvas = document.createElement('canvas');
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight * 0.25;
                let ctx = canvas.getContext('2d');

                const drawMountainRange = (color, startY, amplitude, peaks) => {
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(0, canvas.height);
                    let x = 0;
                    while (x < canvas.width) {
                        const peakWidth = canvas.width / peaks;
                        const step = peakWidth / 20;
                        for (let i = 0; i < 20; i++) {
                            const y = startY + Math.sin((x / peakWidth) * Math.PI * 2) * amplitude * Math.sin((x/canvas.width)*Math.PI);
                            ctx.lineTo(x, y);
                            x += step;
                        }
                    }
                    ctx.lineTo(canvas.width, canvas.height);
                    ctx.closePath();
                    ctx.fill();
                };

                drawMountainRange('rgba(20, 20, 40, 0.6)', canvas.height * 0.7, canvas.height * 0.4, 3);
                drawMountainRange('rgba(40, 40, 60, 0.8)', canvas.height * 0.8, canvas.height * 0.3, 5);
                drawMountainRange('rgba(60, 60, 80, 1.0)', canvas.height * 0.9, canvas.height * 0.2, 8);

                canvas.style.position = 'absolute';
                canvas.style.left = '0';
                canvas.style.bottom = '0';
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                mountainContainer.appendChild(canvas);
            }

            // Sunflares - positioned around the sun
            const sunflareContainer = document.getElementById('sunset-sunflares');
            if (sunflareContainer && sunflareContainer.children.length === 0) {
                const flareConfigs = [
                    { color: 'rgba(255, 200, 100, 0.6)', size: 150, offsetX: 0, offsetY: 0 },      // Center main flare
                    { color: 'rgba(255, 150, 80, 0.5)', size: 100, offsetX: 80, offsetY: -40 },    // Top right
                    { color: 'rgba(255, 220, 150, 0.4)', size: 120, offsetX: -70, offsetY: 50 },   // Bottom left
                    { color: 'rgba(255, 180, 120, 0.5)', size: 90, offsetX: 60, offsetY: 70 },     // Bottom right
                    { color: 'rgba(255, 240, 200, 0.3)', size: 180, offsetX: -20, offsetY: -10 },  // Slightly off-center large
                    { color: 'rgba(255, 160, 100, 0.4)', size: 110, offsetX: -90, offsetY: -60 }   // Top left
                ];

                flareConfigs.forEach((flare, i) => {
                    let flareEl = document.createElement('div');
                    flareEl.className = 'sunset-sunflare';
                    flareEl.style.width = `${flare.size}px`;
                    flareEl.style.height = `${flare.size}px`;
                    flareEl.style.background = `radial-gradient(circle, ${flare.color} 0%, transparent 70%)`;
                    flareEl.style.marginLeft = `${flare.offsetX}px`;
                    flareEl.style.marginTop = `${flare.offsetY}px`;
                    flareEl.style.animationDelay = `-${i * 0.5}s`;
                    sunflareContainer.appendChild(flareEl);
                });
            }

            // God Rays (keep existing code)
            const godRayContainer = document.querySelector('.sunset-god-rays');
            if (godRayContainer && godRayContainer.children.length === 0) {
                for (let i = 0; i < 30; i++) {
                    let ray = document.createElement('div');
                    ray.className = 'sunset-god-ray';
                    ray.style.transform = `rotate(${i * 12 + Math.random() * 4 - 2}deg)`;
                    ray.style.animationDelay = `-${Math.random() * 25}s`;
                    godRayContainer.appendChild(ray);
                }
            }

            // Enhanced Dust Motes - Particle System
            const dustContainer = document.getElementById('dust-motes');
            if (dustContainer && dustContainer.children.length === 0) {
                // Create multiple types of particles
                const particleTypes = [
                    { count: 60, size: [1, 3], speed: [15, 25], color: 'rgba(255, 240, 200, 0.6)' }, // Dust motes
                    { count: 30, size: [2, 4], speed: [20, 35], color: 'rgba(255, 220, 180, 0.5)' }, // Light particles
                    { count: 20, size: [1, 2], speed: [10, 18], color: 'rgba(255, 255, 240, 0.7)' }, // Sparkles
                ];

                particleTypes.forEach(type => {
                    for (let i = 0; i < type.count; i++) {
                        let particle = document.createElement('div');
                        particle.className = 'sunset-dust-particle';
                        
                        const size = random(type.size[0], type.size[1]);
                        particle.style.width = `${size}px`;
                        particle.style.height = `${size}px`;
                        particle.style.background = type.color;
                        particle.style.borderRadius = '50%';
                        particle.style.position = 'absolute';
                        particle.style.boxShadow = `0 0 ${size * 2}px ${type.color}`;
                        
                        // Random starting position
                        particle.style.left = `${Math.random() * 100}%`;
                        particle.style.top = `${Math.random() * 100}%`;
                        
                        // Random animation properties
                        const duration = random(type.speed[0], type.speed[1]);
                        particle.style.animation = `sunset-particle-float ${duration}s ease-in-out infinite alternate`;
                        particle.style.animationDelay = `-${Math.random() * duration}s`;
                        
                        // Store end position as CSS variables for animation
                        particle.style.setProperty('--end-x', `${(Math.random() - 0.5) * 30}vw`);
                        particle.style.setProperty('--end-y', `${(Math.random() - 0.5) * 30}vh`);
                        
                        dustContainer.appendChild(particle);
                    }
                });

                // Add particle animation to stylesheet if not exists
                if (!document.getElementById('sunset-particle-style')) {
                    const style = document.createElement('style');
                    style.id = 'sunset-particle-style';
                    style.textContent = `
                        @keyframes sunset-particle-float {
                            0% {
                                transform: translate(0, 0) scale(1);
                                opacity: 0;
                            }
                            10% {
                                opacity: 1;
                            }
                            90% {
                                opacity: 1;
                            }
                            100% {
                                transform: translate(var(--end-x), var(--end-y)) scale(0.5);
                                opacity: 0;
                            }
                        }
                    `;
                    document.head.appendChild(style);
                }
            }

            // Add birds during day
            if (!dustContainer.querySelector('.sunset-bird')) {
                for (let i = 0; i < 5; i++) {
                    let bird = document.createElement('div');
                    bird.className = 'sunset-bird';
                    bird.style.position = 'absolute';
                    bird.style.width = '20px';
                    bird.style.height = '8px';
                    bird.style.top = `${20 + Math.random() * 40}%`;
                    bird.style.left = '-5%';
                    bird.innerHTML = '<svg width="20" height="8" viewBox="0 0 20 8"><path d="M 0 4 Q 5 0, 10 4 Q 15 0, 20 4" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/></svg>';
                    
                    const duration = random(25, 40);
                    bird.style.animation = `sunset-bird-fly ${duration}s linear infinite`;
                    bird.style.animationDelay = `-${Math.random() * duration}s`;
                    
                    dustContainer.appendChild(bird);
                }

                // Add bird animation
                if (!document.getElementById('sunset-bird-style')) {
                    const style = document.createElement('style');
                    style.id = 'sunset-bird-style';
                    style.textContent = `
                        @keyframes sunset-bird-fly {
                            0% {
                                transform: translateX(0) translateY(0);
                                opacity: 0;
                            }
                            5% {
                                opacity: 0.4;
                            }
                            95% {
                                opacity: 0.4;
                            }
                            100% {
                                transform: translateX(110vw) translateY(-20vh);
                                opacity: 0;
                            }
                        }
                    `;
                    document.head.appendChild(style);
                }
            }

            // Sparkling stars for night time
            const starsContainer = document.getElementById('sunset-stars');
            if (starsContainer && starsContainer.children.length === 0) {
                for (let i = 0; i < 200; i++) {
                    let star = document.createElement('div');
                    star.className = 'sunset-star';

                    // Random size (1-3px)
                    const size = Math.random() * 2 + 1;
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;

                    // Random position
                    star.style.left = `${Math.random() * 100}%`;
                    star.style.top = `${Math.random() * 60}%`; // Stars mostly in upper part of sky

                    // Random animation delay for twinkling effect
                    star.style.animationDelay = `${Math.random() * 2}s`;
                    star.style.animationDuration = `${2 + Math.random() * 3}s`;

                    starsContainer.appendChild(star);
                }
            }

            return {
                cleanup: () => {
                    // Clean up if needed
                    const dustParticles = dustContainer.querySelectorAll('.sunset-dust-particle, .sunset-bird');
                    dustParticles.forEach(p => p.remove());
                    const stars = starsContainer.querySelectorAll('.sunset-star');
                    stars.forEach(s => s.remove());
                }
            };
        }
        function createMountainScene() {
            // Stars
            const starsContainer = document.getElementById('mountain-stars');
            if (starsContainer && starsContainer.children.length === 0) {
                for (let i = 0; i < 150; i++) {
                    let star = document.createElement('div');
                    star.className = 'mountain-star';
                    const size = Math.random() * 2 + 1;
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${Math.random() * 100}%`;
                    star.style.top = `${Math.random() * 50}%`;
                    const dayNightCycle = document.querySelector('.mountain-sky').style.animation;
                    // This is a simplified way; a better implementation would use JS to track animation progress
                    star.style.setProperty('--start-op', 0);
                    star.style.setProperty('--end-op', Math.random() * 0.8);
                    star.style.animationDelay = `${Math.random() * 10}s`;
                    starsContainer.appendChild(star);
                }
            }

            // Mountain Ranges
            const mountainLayers = [
                { el: document.getElementById('mountain-range-back'), color: '#3E517A', height: 0.6, peaks: 5, jaggedness: 0.4 },
                { el: document.getElementById('mountain-range-mid'), color: '#2C3E50', height: 0.7, peaks: 7, jaggedness: 0.6 },
                { el: document.getElementById('mountain-range-front'), color: '#1B2631', height: 0.8, peaks: 9, jaggedness: 0.8 }
            ];
            mountainLayers.forEach(layer => {
                if (layer.el && layer.el.children.length === 0) {
                    const canvas = document.createElement('canvas');
                    const C_WIDTH = 2048;
                    canvas.width = C_WIDTH * 2;
                    canvas.height = window.innerHeight;
                    const ctx = canvas.getContext('2d');

                    ctx.fillStyle = layer.color;
                    ctx.beginPath();
                    ctx.moveTo(0, canvas.height);
                    let y = canvas.height * layer.height;
                    let x = 0;
                    while (x < canvas.width) {
                        const peakWidth = canvas.width / (layer.peaks * 2);
                        const step = peakWidth / 20;
                        for (let i = 0; i < 20; i++) {
                            const sineX = (x / peakWidth) * Math.PI;
                            const sineY = Math.sin(sineX) * (peakWidth/3) * (0.5 + Math.sin(x*0.01)*0.5);
                            const noise = (Math.random() - 0.5) * layer.jaggedness * step;
                            ctx.lineTo(x, y - sineY + noise);
                            x += step;
                        }
                    }
                    ctx.lineTo(canvas.width, canvas.height);
                    ctx.closePath();
                    ctx.fill();
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.bottom = '0';
                    canvas.style.width = `${canvas.width}px`;
                    canvas.style.height = `100%`;
                    layer.el.appendChild(canvas);
                }
            });

            // Clouds
            const cloudContainer = document.querySelector('.mountain-clouds');
            if (cloudContainer && cloudContainer.children.length === 0) {
                 let canvas = document.createElement('canvas');
                 canvas.width = 4096;
                 canvas.height = 400; // Increased height for more vertical variation
                 let ctx = canvas.getContext('2d');
                 ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';

                 for (let i = 0; i < 15; i++) { // Generate 15 cloud clusters
                     const startX = Math.random() * canvas.width;
                     const startY = Math.random() * (canvas.height * 0.6) + (canvas.height * 0.1);
                     const cloudLength = Math.random() * 400 + 200; // Make clouds longer
                     const puffCount = 20;

                     ctx.filter = `blur(${Math.random() * 10 + 8}px)`;

                     for(let j = 0; j < puffCount; j++) {
                         const progress = j / puffCount;
                         // Distribute puffs along the length, with some randomness
                         const puffX = startX + progress * cloudLength + (Math.random() - 0.5) * 50;
                         // Create a gentle arc for the cloud shape
                         const puffY = startY + Math.sin(progress * Math.PI) * 40 + (Math.random() - 0.5) * 30;
                         // Puffs are smaller at the edges
                         const maxRadius = Math.sin(progress * Math.PI) * 60 + 20;
                         const puffR = Math.random() * maxRadius;

                         ctx.beginPath();
                         ctx.arc(puffX, puffY, puffR, 0, 2 * Math.PI);
                         ctx.fill();
                     }
                 }
                 canvas.style.position = 'absolute';
                 canvas.style.left = '0';
                 canvas.style.top = '0';
                 canvas.style.width = `${canvas.width}px`;
                 canvas.style.height = `100%`;
                 cloudContainer.appendChild(canvas);
            }
        }
        function createDeepOcean() {
            // Caustics
            const causticsContainer = document.querySelector('#ocean-theme .caustics-container');
            if (causticsContainer && causticsContainer.children.length === 0) {
                const light = document.createElement('div');
                light.className = 'caustic-light';
                causticsContainer.appendChild(light);
            }

            // God Rays
            const godRayContainer = document.querySelector('.ocean-god-rays');
            if (godRayContainer && godRayContainer.children.length === 0) {
                for (let i = 0; i < 15; i++) {
                    let ray = document.createElement('div');
                    ray.className = 'ocean-god-ray';
                    ray.style.left = `${Math.random() * 120 - 10}%`;
                    ray.style.top = '0px';
                    ray.style.width = `${Math.random() * 3 + 1}px`;
                    ray.style.height = '120%';
                    ray.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
                    ray.style.opacity = `${Math.random() * 0.1 + 0.05}`;
                    godRayContainer.appendChild(ray);
                }
            }

            // Floating Sediment - Adds underwater depth and movement
            const sedimentContainer = document.getElementById('ocean-sediment-layer');
            if (sedimentContainer) {
                sedimentContainer.innerHTML = ''; // Clear old sediment
                for (let i = 0; i < 100; i++) {
                    let particle = document.createElement('div');
                    particle.className = 'ocean-sediment';
                    const size = Math.random() * 3 + 1;
                    particle.style.width = `${size}px`;
                    particle.style.height = `${size}px`;
                    const startX = Math.random() * 100;
                    const startY = Math.random() * 100;
                    particle.style.setProperty('--x-start', `${startX}vw`);
                    particle.style.setProperty('--y-start', `${startY}vh`);
                    particle.style.setProperty('--x-end', `${startX + (Math.random() * 40 - 20)}vw`);
                    particle.style.setProperty('--y-end', `${startY + (Math.random() * 40 - 20)}vh`);
                    particle.style.animationDelay = `-${Math.random() * 30}s`;
                    particle.style.animationDuration = `${Math.random() * 40 + 30}s`;
                    sedimentContainer.appendChild(particle);
                }
            }

            // Bubbles - More bubbles for underwater feel
            const bubblesContainer = document.getElementById('bubbles');
            if (bubblesContainer) {
                bubblesContainer.innerHTML = ''; // Clear old bubbles
                for (let i = 0; i < 150; i++) {
                    let el = document.createElement('div');
                    el.className = 'bubble';
                    const size = Math.random() * 12 + 3;
                    el.style.width = `${size}px`;
                    el.style.height = `${size}px`;
                    el.style.left = `${Math.random() * 100}%`;
                    el.style.animationDuration = `${Math.random() * 15 + 8}s`;
                    el.style.animationDelay = `-${Math.random() * 20}s`;
                    el.style.setProperty('--x-drift', `${Math.random() * 6 - 3}vw`);
                    el.style.setProperty('--x-drift-end', `${Math.random() * 6 - 3}vw`);
                    bubblesContainer.appendChild(el);
                }
            }

            // Plankton - More particles for immersive underwater feel
            const planktonContainer = document.getElementById('ocean-plankton-layer');
            if (planktonContainer) {
                planktonContainer.innerHTML = ''; // Clear old plankton
                for (let i = 0; i < 200; i++) {
                    let particle = document.createElement('div');
                    particle.className = 'ocean-plankton';
                    const size = Math.random() * 2 + 0.5;
                    particle.style.width = `${size}px`;
                    particle.style.height = `${size}px`;
                    particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
                    particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
                    particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
                    particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
                    particle.style.animationDelay = `-${Math.random() * 15}s`;
                    particle.style.animationDuration = `${Math.random() * 20 + 15}s`;
                    planktonContainer.appendChild(particle);
                }
            }

            // Jellyfish - More jellyfish for life
            const jellyfishContainer = document.getElementById('jellyfish-layer');
            if (jellyfishContainer) {
                jellyfishContainer.innerHTML = ''; // Clear old jellyfish
                for (let i = 0; i < 12; i++) {
                    let fish = document.createElement('div');
                    fish.className = 'jellyfish';
                    let body = document.createElement('div');
                    body.className = 'jelly-body';
                    let tentacles = document.createElement('div');
                    tentacles.className = 'jelly-tentacles';

                    for (let j = 0; j < 5; j++) {
                        let tentacle = document.createElement('div');
                        tentacle.className = 'tentacle';
                        tentacle.style.height = `${Math.random() * 40 + 30}px`;
                        tentacle.style.left = `${Math.random() * 40 - 20}px`;
                        tentacle.style.animationDelay = `-${Math.random() * 4}s`;
                        tentacles.appendChild(tentacle);
                    }

                    fish.appendChild(body);
                    fish.appendChild(tentacles);

                    fish.style.setProperty('--x-start', `${-10 + Math.random() * 120}vw`);
                    fish.style.setProperty('--y-start', `${110}vh`);
                    fish.style.setProperty('--x-end', `${-10 + Math.random() * 120}vw`);
                    fish.style.setProperty('--y-end', `${-20}vh`);
                    fish.style.animationDuration = `${Math.random() * 20 + 15}s`;
                    fish.style.animationDelay = `-${Math.random() * 35}s`;
                    body.style.animationDelay = `-${Math.random() * 4}s`;

                    jellyfishContainer.appendChild(fish);
                }
            }

            // Ocean floor layers
            const layers = [
                { el: document.getElementById('ocean-floor-bg'), count: 80, color: 'rgba(5, 30, 50, 0.6)', height: 120 },
                { el: document.getElementById('ocean-floor-mid'), count: 50, color: 'rgba(10, 40, 65, 0.8)', height: 180 },
                { el: document.getElementById('ocean-floor-fg'), count: 30, color: 'rgba(15, 50, 80, 1.0)', height: 250 }
            ];

            layers.forEach(layer => {
                if (layer.el && layer.el.children.length === 0) {
                    const C_WIDTH = 250;
                    let canvas = document.createElement('canvas');
                    canvas.width = layer.count * C_WIDTH;
                    canvas.height = layer.height;
                    let ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });

                    // Clear canvas to transparent
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    // Draw ground at bottom only
                    ctx.fillStyle = layer.color;
                    ctx.beginPath();
                    ctx.moveTo(0, canvas.height);
                    let y = canvas.height * 0.85; // Start higher to leave more transparent space
                    ctx.lineTo(0, y);
                    for (let i = 0; i < canvas.width; i++) {
                        y += (Math.random() - 0.5) * 0.5;
                        y = Math.max(canvas.height * 0.6, Math.min(canvas.height * 0.9, y));
                        ctx.lineTo(i, y);
                    }
                    ctx.lineTo(canvas.width, y);
                    ctx.lineTo(canvas.width, canvas.height);
                    ctx.closePath();
                    ctx.fill();

                    // Draw flora
                    for (let i = 0; i < layer.count * 1.5; i++) {
                        const x = Math.random() * canvas.width;
                        let groundY = 0;
                        // Find ground Y at this x (approximate)
                        for (let j = 0; j < canvas.height; j++) {
                            if (ctx.getImageData(x, j, 1, 1).data[3] > 0) {
                                groundY = j;
                                break;
                            }
                        }
                        if (groundY === 0) continue;


                        if (Math.random() > 0.3) { // Seaweed
                            ctx.strokeStyle = `rgba(${parseInt(layer.color.slice(5,-1).split(',')[0]) + 10}, ${parseInt(layer.color.slice(5,-1).split(',')[1]) + 10}, ${parseInt(layer.color.slice(5,-1).split(',')[2]) + 10}, ${parseFloat(layer.color.slice(5,-1).split(',')[3]) * 1.2})`;
                            const h = (Math.random() * 0.8 + 0.2) * layer.height;
                            ctx.beginPath();
                            ctx.moveTo(x, groundY);
                            ctx.bezierCurveTo(x + (Math.random()-0.5)*50, groundY - h*0.3, x + (Math.random()-0.5)*50, groundY - h*0.7, x + (Math.random()-0.5)*30, groundY-h);
                            ctx.lineWidth = Math.random() * 3 + 1;
                            ctx.stroke();
                        } else { // Coral Fan
                            ctx.fillStyle = `rgba(${parseInt(layer.color.slice(5,-1).split(',')[0]) - 5}, ${parseInt(layer.color.slice(5,-1).split(',')[1]) + 5}, ${parseInt(layer.color.slice(5,-1).split(',')[2]) + 5}, ${parseFloat(layer.color.slice(5,-1).split(',')[3])})`;
                            const h = (Math.random() * 0.2 + 0.1) * layer.height;
                            const w = (Math.random() * 0.4 + 0.2) * C_WIDTH / 4;
                            ctx.beginPath();
                            ctx.moveTo(x, groundY);
                            for (let j=0; j<5; j++) {
                                ctx.lineTo(x + (Math.random() - 0.5) * w, groundY - Math.random() * h);
                            }
                            ctx.closePath();
                            ctx.fill();
                        }
                    }
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.bottom = '0';
                    canvas.style.width = `${canvas.width}px`;
                    canvas.style.height = `${canvas.height}px`;
                    canvas.style.pointerEvents = 'none';
                    canvas.style.backgroundColor = 'transparent';
                    layer.el.appendChild(canvas);
                }
            });
        }
        function createParticles() {
            const containers = {
                stars: { count: 100, el: 'stars' }, fireflies: { count: 20, el: 'fireflies' },
                petals: { count: 25, el: 'petals' },
                forestSpirits: { count: 10, el: 'forest-spirits' }
            };

            for (const key in containers) {
                const container = document.getElementById(containers[key].el);
                if (container && container.children.length === 0) {
                    for (let i = 0; i < containers[key].count; i++) {
                        let el = document.createElement('div');
                        switch(key) {
                            case 'stars': el.className = 'star'; el.style.width = `${Math.random()*2+1}px`; el.style.height=el.style.width; el.style.left = `${Math.random()*100}%`; el.style.top = `${Math.random()*100}%`; el.style.animationDelay = `${Math.random()*5}s`; break;
                            case 'fireflies': el.className = 'firefly'; el.style.setProperty('--x-start', `${Math.random() * 100}vw`); el.style.setProperty('--y-start', `${Math.random() * 100}vh`); el.style.setProperty('--x-end', `${Math.random() * 100}vw`); el.style.setProperty('--y-end', `${Math.random() * 100}vh`); el.style.animationDelay = `${Math.random() * 15}s`; break;
                            case 'clouds': el.className='cloud'; el.style.top=`${Math.random()*40+5}%`; el.style.transform=`scale(${Math.random()*0.5+0.5})`; el.style.animationDuration=`${Math.random()*40+30}s`; el.style.animationDelay=`${Math.random()*30}s`; break;
                            case 'petals': el.className='petal'; el.style.left=`${Math.random()*100}%`; el.style.setProperty('--r-start', `${Math.random()*360}deg`); el.style.setProperty('--r-end', `${Math.random()*720-360}deg`); el.style.setProperty('--x-drift', `${Math.random()*40-20}vw`); el.style.animationDelay = `${Math.random()*12}s`; break;
                            case 'snowflakes': el.className = 'snowflake'; el.textContent = '❄'; const snowSize = Math.random() * 0.8 + 0.4; el.style.fontSize = `${snowSize}rem`; el.style.left = `${Math.random()*100}%`; el.style.animationDuration=`${Math.random()*10+8}s`; el.style.animationDelay=`${Math.random()*10}s`; el.style.setProperty('--x-drift', `${Math.random()*6-3}vw`); el.style.setProperty('--r-end', `${Math.random()*360-180}deg`); break;
                            case 'leaves': el.className = 'leaf'; const leafColor = ['#c84c0f', '#e67e22', '#f1c40f'][Math.floor(Math.random() * 3)]; el.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M10 0 C0 5, 5 15, 10 20 C15 15, 20 5, 10 0 Z" fill="${encodeURIComponent(leafColor)}"/></svg>')`; el.style.left=`${Math.random()*100}%`; el.style.animationDuration=`${Math.random()*8+7}s`; el.style.animationDelay=`${Math.random()*10}s`; el.style.setProperty('--x-drift', `${Math.random()*20-10}vw`); el.style.setProperty('--r-end', `${Math.random()*1080-540}deg`); break;
                            case 'sunRays': el.className = 'sun-ray'; el.style.height = `${Math.random()*400+300}px`; el.style.width = `${Math.random()*30+20}px`; el.style.top = '0'; el.style.left = `${Math.random()*100-25}%`; el.style.setProperty('--r-start', `${Math.random()*10-5}deg`); el.style.setProperty('--r-end', `${Math.random()*10-5}deg`); el.style.animationDelay = `${Math.random()*5}s`; break;
                            case 'sparkles': el.className = 'sparkle'; el.style.left = `${Math.random()*100}%`; el.style.top = `${Math.random()*100}%`; el.style.animationDelay = `${Math.random()*2}s`; break;
                            case 'sprouts': el.className = 'sprout'; el.style.left = `${Math.random()*100}%`; el.style.bottom = `${Math.random()* -20}px`; el.style.animationDuration = `${Math.random()*8+6}s`; el.style.animationDelay = `${Math.random()*14}s`; el.style.setProperty('--r-end', `${Math.random()*180-90}deg`); break;
                            case 'raindrops': el.className = 'raindrop'; el.style.left = `${Math.random()*100}%`; el.style.height = `${Math.random()*50+50}px`; el.style.width = `${Math.random() * 1.5 + 1}px`; el.style.animationDuration = `${Math.random()*0.5+0.3}s`; el.style.animationDelay = `${Math.random()*5}s`; el.style.setProperty('--x-drift-rain', `${Math.random() * 10 - 5}vw`); break;
                            case 'koi': el.className = 'koi'; ['--x1','--y1','--x2','--y2','--x3','--y3','--x4','--y4', '--x5', '--y5', '--x6', '--y6', '--x7', '--y7', '--x8', '--y8'].forEach(v => el.style.setProperty(v, `${Math.random()*80+10}vw`)); ['--r1','--r2','--r3','--r4', '--r5', '--r6', '--r7', '--r8'].forEach(v => el.style.setProperty(v, `${Math.random()*360}deg`)); el.style.animationDelay = `${Math.random()*35}s`; break;
                            case 'pollen': el.className = 'pollen'; el.style.left = `${Math.random()*100}%`; el.style.top = `${Math.random()*100}%`; el.style.setProperty('--x', `${Math.random()*100-50}px`); el.style.setProperty('--y', `${Math.random()*100-50}px`); el.style.animationDelay = `${Math.random()*8}s`; break;
                            case 'butterflies': el.className = 'butterfly'; ['--x1','--y1','--x2','--y2','--x3','--y3','--x4','--y4', '--x5', '--y5', '--x6', '--y6', '--x7', '--y7', '--x8', '--y8'].forEach(v => el.style.setProperty(v, `${Math.random()*80+10}vw`)); el.style.animationDelay = `${Math.random()*15}s`; break;
                            case 'galaxyStars': el.className = 'galaxy-star'; el.style.width = `${Math.random()*2+1}px`; el.style.height=el.style.width; el.style.left = `${Math.random()*100}%`; el.style.top = `${Math.random()*100}%`; el.style.animationDelay = `${Math.random()*8}s`; break;
                            case 'chimes': el.className = 'chime'; el.style.left = `${Math.random() * 95}%`; el.style.top = `${Math.random() * 30 + 35}%`; el.style.transform = `rotate(${Math.random() * 20 - 10}deg) scaleY(${Math.random() * 0.3 + 0.8})`; el.style.animationDelay = `${Math.random() * 10}s`; break;
                            case 'ripples': el.className = 'ripple'; el.style.left = '50%'; el.style.top = '50%'; el.style.transform = 'translate(-50%, -50%)'; el.style.animationDelay = `${i * 1.6}s`; break;
                            case 'starlights': el.className = 'starlight'; const starlightSize = Math.random() * 2.5 + 1; el.style.width = `${starlightSize}px`; el.style.height = `${starlightSize}px`; el.style.left = `${Math.random() * 100}%`; el.style.top = `${Math.random() * 100}%`; el.style.animationDelay = `${Math.random() * 6}s`; break;
                            case 'forestSpirits': el.className = 'forest-spirit'; el.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`); el.style.setProperty('--y-start', `${Math.random() * 30 + 60}vh`); el.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`); el.style.setProperty('--y-end', `${Math.random() * 30 + 30}vh`); el.style.animationDelay = `${Math.random() * 25}s`; break;
                        }
                        container.appendChild(el);
                    }
                }
            }
        }

        function setBackground(themeName) {
            if (activeThemeAnimationId) {
                cancelAnimationFrame(activeThemeAnimationId);
                activeThemeAnimationId = null;
            }
            if (activeThemeData && typeof activeThemeData.cleanup === 'function') {
                activeThemeData.cleanup();
                activeThemeData = null;
            }

            if (!THEMES.includes(themeName) || (activeTheme === themeName && !isGameOver)) return;
            activeTheme = themeName;

            const themeCreationFunctions = {
                'swedish-forest': createSwedishForest, 'ocean': createDeepOcean,
                'sunset': createSunset, 'mountain': createMountainScene, 'zen': createZenScene,
                'forest': createEnchantedForest, 'winter': createWinterScene, 'fall': createAutumnScene,
                'summer': createSummerScene, 'spring': createSpringScene, 'aurora': createAuroraScene,
                'galaxy': createGalaxyScene, 'rainy-window': createRainyWindow, 'koi-pond': createKoiPondScene,
                'meadow': createMeadowScene, 'cosmic-chimes': createCosmicChimesScene,
                'singing-bowl': createSingingBowlScene, 'starlight': createStarlightScene,
                'geode': createGeodeScene, 'bioluminescence': createBioluminescenceScene,
                'desert-oasis': createDesertOasisScene, 'bamboo-grove': createBambooGroveScene,
                'misty-lake': createMistyLakeScene, 'waves': createWavesScene,
                'fluid-dreams': createFluidDreamsScene, 'lantern-festival': createLanternFestivalScene,
                'crystal-cave': createCrystalCaveScene, 'candlelit-monastery': createCandlelitMonasteryScene,
                'cherry-blossom-garden': createCherryBlossomGardenScene, 'floating-islands': createFloatingIslandsScene,
                'meditation-temple': createMeditationTempleScene, 'moonlit-greenhouse': createMoonlitGreenhouseScene,
                'ice-temple': createIceTempleScene, 'himalayan-peak': createHimalayanPeakScene, 'electric-dreams': createElectricDreamsScene,
                'moonlit-forest': createMoonlitForestScene, 'wolfhour': createWolfhourScene, 'lunara': createLunaraScene,
                'pyrestorm': createPyrestormScene, 'neon-dusk': createNeonDuskScene, 'stillwater': createStillwaterScene
            };

            let themeData = null;
            document.querySelectorAll('.theme-container').forEach(el => {
                if (el.id === `${themeName}-theme`) {
                    el.classList.add('active');
                    if (themeCreationFunctions[themeName]) {
                        activeThemeData = themeCreationFunctions[themeName]();
                    }
                } else {
                    el.classList.remove('active');
                }
            });

            if (webglRenderer) {
                webglRenderer.loadTheme(themeName, activeThemeData);
            }

            // Apply theme-linked music if enabled
            soundManager.applyThemeLinkedMusic(themeName);
        }

function createCrystalCaveScene() {
    // 1. Massive Crystal Formations (WebGL) - Various sizes from ceiling and floor
    if (webglRenderer) {
        const crystalLayers = [
            // Background layer - deep cave colors
            { zIndex: -0.9, count: 12, colors: ['rgba(30, 20, 60, 0.6)', 'rgba(20, 30, 70, 0.6)', 'rgba(40, 20, 80, 0.6)'], height: 0.6, seed: 78901 },
            // Mid layer - richer colors
            { zIndex: -0.8, count: 10, colors: ['rgba(60, 40, 100, 0.7)', 'rgba(30, 60, 90, 0.7)', 'rgba(50, 80, 100, 0.7)'], height: 0.75, seed: 89012 },
            // Front layer - prominent crystals
            { zIndex: -0.7, count: 8, colors: ['rgba(80, 60, 130, 0.8)', 'rgba(50, 90, 130, 0.8)', 'rgba(70, 100, 150, 0.8)'], height: 0.85, seed: 90123 }
        ];

        crystalLayers.forEach(layer => {
            const C_WIDTH = 2048;
            const C_HEIGHT = window.innerHeight;

            // Create cache key based on layer properties and dimensions
            const cacheKey = `crystal-${layer.zIndex}-${layer.count}-${layer.height}-${layer.colors.join(',')}-${C_WIDTH}x${C_HEIGHT}`;

            // Check if we have this crystal layer cached
            if (crystalCaveCache.has(cacheKey)) {
                const cachedCanvas = crystalCaveCache.get(cacheKey);
                webglRenderer.addLayer(cachedCanvas, layer.zIndex);
                return;
            }

            // Generate new crystal layer with seeded random for deterministic output
            const rng = seededRandom(layer.seed);
            const canvas = document.createElement('canvas');
            canvas.width = C_WIDTH;
            canvas.height = C_HEIGHT;
            const ctx = canvas.getContext('2d');

            // Draw massive crystals with varied sizes
            for (let i = 0; i < layer.count; i++) {
                const x = rng() * C_WIDTH;
                const color = layer.colors[Math.floor(rng() * layer.colors.length)];

                // Vary crystal sizes dramatically
                const isMassive = rng() > 0.6;
                const baseWidth = isMassive ? rng() * 150 + 100 : rng() * 80 + 40;
                const baseHeight = (rng() * 0.4 + 0.4) * canvas.height * layer.height;

                ctx.fillStyle = color;
                ctx.strokeStyle = `rgba(180, 200, 255, 0.15)`;
                ctx.lineWidth = 2;

                // Draw from ceiling
                if (rng() > 0.3) {
                    ctx.beginPath();
                    ctx.moveTo(x - baseWidth / 2, 0);
                    // Add jagged facets
                    ctx.lineTo(x - baseWidth / 4, baseHeight * 0.3);
                    ctx.lineTo(x, baseHeight);
                    ctx.lineTo(x + baseWidth / 4, baseHeight * 0.4);
                    ctx.lineTo(x + baseWidth / 2, 0);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // Add inner glow highlight
                    const gradient = ctx.createLinearGradient(x, 0, x, baseHeight);
                    gradient.addColorStop(0, 'rgba(200, 220, 255, 0.05)');
                    gradient.addColorStop(0.5, 'rgba(180, 200, 255, 0.1)');
                    gradient.addColorStop(1, 'rgba(150, 180, 255, 0.02)');
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }

                // Draw from floor
                if (rng() > 0.3) {
                    const floorX = rng() * C_WIDTH;
                    const floorWidth = isMassive ? rng() * 140 + 90 : rng() * 70 + 35;
                    const floorHeight = (rng() * 0.4 + 0.35) * canvas.height * layer.height;

                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(floorX - floorWidth / 2, canvas.height);
                    ctx.lineTo(floorX - floorWidth / 4, canvas.height - floorHeight * 0.4);
                    ctx.lineTo(floorX, canvas.height - floorHeight);
                    ctx.lineTo(floorX + floorWidth / 4, canvas.height - floorHeight * 0.35);
                    ctx.lineTo(floorX + floorWidth / 2, canvas.height);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // Add inner glow
                    const floorGradient = ctx.createLinearGradient(floorX, canvas.height, floorX, canvas.height - floorHeight);
                    floorGradient.addColorStop(0, 'rgba(200, 220, 255, 0.05)');
                    floorGradient.addColorStop(0.5, 'rgba(180, 200, 255, 0.1)');
                    floorGradient.addColorStop(1, 'rgba(150, 180, 255, 0.02)');
                    ctx.fillStyle = floorGradient;
                    ctx.fill();
                }
            }

            // Cache the generated canvas
            crystalCaveCache.set(cacheKey, canvas);
            webglRenderer.addLayer(canvas, layer.zIndex);
        });
    }

    // 2. Glowing Crystal Clusters - Amethyst, Emerald, Sapphire
    const clusterContainer = document.getElementById('crystal-cave-glow-clusters');
    if (clusterContainer && clusterContainer.children.length === 0) {
        const clusterColors = [
            '#9b59b6', // Amethyst
            '#d896ff', // Light Amethyst
            '#10ac84', // Emerald
            '#1dd1a1', // Light Emerald
            '#3742fa', // Sapphire
            '#5f27cd'  // Deep Sapphire
        ];

        for (let i = 0; i < 20; i++) {
            let cluster = document.createElement('div');
            cluster.className = 'crystal-cluster';
            const color = clusterColors[Math.floor(Math.random() * clusterColors.length)];
            cluster.style.setProperty('--glow-color', color);
            cluster.style.left = `${Math.random() * 95 + 2.5}%`;
            cluster.style.top = `${Math.random() * 90 + 5}%`;
            const size = Math.random() * 60 + 35;
            cluster.style.width = `${size}px`;
            cluster.style.height = `${size}px`;
            cluster.style.animationDelay = `-${Math.random() * 8}s`;
            clusterContainer.appendChild(cluster);
        }
    }

    // 3. Floating Crystal Shards are now handled by WebGLRenderer
    // 5. Sparkling Mineral Dust is now handled by WebGLRenderer

    // 4. Bioluminescent Moss - Soft breathing glow
    const mossContainer = document.getElementById('crystal-cave-moss');
    if (mossContainer && mossContainer.children.length === 0) {
        for (let i = 0; i < 15; i++) {
            let patch = document.createElement('div');
            patch.className = 'moss-patch';

            // Position on cave walls (edges and corners)
            const position = Math.random();
            if (position < 0.4) {
                // Left or right walls
                patch.style.left = Math.random() > 0.5 ? `${Math.random() * 15}%` : `${85 + Math.random() * 15}%`;
                patch.style.top = `${Math.random() * 100}%`;
            } else {
                // Top or bottom
                patch.style.top = Math.random() > 0.5 ? `${Math.random() * 20}%` : `${80 + Math.random() * 20}%`;
                patch.style.left = `${Math.random() * 100}%`;
            }

            const size = Math.random() * 150 + 100;
            patch.style.width = `${size}px`;
            patch.style.height = `${size}px`;
            patch.style.animationDelay = `-${Math.random() * 6}s`;
            mossContainer.appendChild(patch);
        }
    }

    // 6. Light Refractions - Rainbow patterns through crystals
    const refractionContainer = document.getElementById('crystal-cave-refractions');
    if (refractionContainer && refractionContainer.children.length === 0) {
        for (let i = 0; i < 8; i++) {
            let ray = document.createElement('div');
            ray.className = 'refraction-ray';
            ray.style.left = `${Math.random() * 100}%`;
            ray.style.top = `${Math.random() * 100}%`;
            ray.style.transform = `rotate(${Math.random() * 360}deg)`;
            ray.style.animationDelay = `-${Math.random() * 15}s`;

            // Vary the refraction intensity
            const intensity = Math.random() * 0.4 + 0.6;
            ray.style.opacity = intensity;

            refractionContainer.appendChild(ray);
        }
    }
}

function createLanternFestivalScene() {
    // Check if already initialized with pooled elements
    if (lanternFestivalElementPool.initialized) {
        // Reuse existing elements - just make sure they're in the right containers
        const lanternLayers = [
            { container: document.getElementById('lanterns-back'), count: 20 },
            { container: document.getElementById('lanterns-mid'), count: 15 },
            { container: document.getElementById('lanterns-front'), count: 10 }
        ];

        let lanternIndex = 0;
        lanternLayers.forEach(layer => {
            if (layer.container) {
                // Reattach pooled lanterns to this layer
                for (let i = 0; i < layer.count; i++) {
                    if (lanternFestivalElementPool.lanterns[lanternIndex]) {
                        layer.container.appendChild(lanternFestivalElementPool.lanterns[lanternIndex]);
                        lanternIndex++;
                    }
                }
            }
        });

        // Reattach reflections
        const waterContainer = document.getElementById('lantern-water');
        if (waterContainer) {
            lanternFestivalElementPool.reflections.forEach(reflection => {
                waterContainer.appendChild(reflection);
            });
        }

        // Reattach petals
        const petalContainer = document.getElementById('lantern-petals');
        if (petalContainer) {
            lanternFestivalElementPool.petals.forEach(petal => {
                petalContainer.appendChild(petal);
            });
        }

        // Reattach embers
        const emberContainer = document.getElementById('lantern-embers');
        if (emberContainer) {
            lanternFestivalElementPool.embers.forEach(ember => {
                emberContainer.appendChild(ember);
            });
        }

        return; // Skip expensive generation
    }

    // First time - create elements with seeded random for deterministic output
    const rng = seededRandom(88888); // Seed for lantern festival

    // 1. Lanterns
    const lanternLayers = [
        { container: document.getElementById('lanterns-back'), count: 20, minSize: 20, maxSize: 40, minDuration: 40, maxDuration: 60 },
        { container: document.getElementById('lanterns-mid'), count: 15, minSize: 40, maxSize: 60, minDuration: 30, maxDuration: 50 },
        { container: document.getElementById('lanterns-front'), count: 10, minSize: 60, maxSize: 80, minDuration: 20, maxDuration: 40 }
    ];

    const lanternShapes = [
        // Classic round
        '<path d="M10 80 C 10 80, 0 60, 0 40 C 0 20, 10 0, 10 0 L 40 0 C 40 0, 50 20, 50 40 C 50 60, 40 80, 40 80 Z" />',
        // Cylinder
        '<path d="M0 10 C0 -10, 50 -10, 50 10 L 50 70 C 50 90, 0 90, 0 70 Z" />',
        // Diamond
        '<path d="M25 0 L50 40 L25 80 L0 40 Z" />'
    ];
    const lanternColors = ['#ff7675', '#feca57', '#ff9f43', '#ee5253', '#ab54c5'];

    const waterContainer = document.getElementById('lantern-water');

    lanternLayers.forEach(layer => {
        if (layer.container && layer.container.children.length === 0) {
            for (let i = 0; i < layer.count; i++) {
                const lantern = document.createElement('div');
                lantern.className = 'lantern';

                const color = lanternColors[Math.floor(rng() * lanternColors.length)];
                const shape = lanternShapes[Math.floor(rng() * lanternShapes.length)];
                lantern.style.backgroundImage = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 80"><g fill="${encodeURIComponent(color)}" opacity="0.9">${shape}</g></svg>')`;

                const size = rng() * (layer.maxSize - layer.minSize) + layer.minSize;
                lantern.style.width = `${size}px`;
                lantern.style.height = `${size * 1.2}px`;

                const xPos = rng() * 100;
                lantern.style.left = `${xPos}%`;

                const duration = rng() * (layer.maxDuration - layer.minDuration) + layer.minDuration;
                lantern.style.animationDuration = `${duration}s`;
                lantern.style.animationDelay = `-${rng() * duration}s`;

                lantern.style.setProperty('--x-sway1', `${(rng() - 0.5) * 10}vw`);
                lantern.style.setProperty('--x-sway2', `${(rng() - 0.5) * 10}vw`);
                lantern.style.setProperty('--start-opacity', `${rng() * 0.5 + 0.5}`);

                layer.container.appendChild(lantern);
                lanternFestivalElementPool.lanterns.push(lantern); // Store in pool

                // Add reflection for front lanterns
                if (layer.container.id === 'lanterns-front' && waterContainer) {
                    const reflection = document.createElement('div');
                    reflection.className = 'lantern-reflection';
                    reflection.style.width = `${size}px`;
                    reflection.style.height = `${size}px`;
                    reflection.style.left = `${xPos}%`;

                    // Match animation properties
                    reflection.style.animationDuration = `${duration}s, 4s`;
                    reflection.style.animationDelay = `-${rng() * duration}s, -${rng() * 4}s`;
                    reflection.style.setProperty('--x-sway1', `${(rng() - 0.5) * 10}vw`);
                    reflection.style.setProperty('--x-sway2', `${(rng() - 0.5) * 10}vw`);
                    reflection.style.setProperty('--start-opacity', `0.4`); // Reflections are fainter

                    waterContainer.appendChild(reflection);
                    lanternFestivalElementPool.reflections.push(reflection); // Store in pool
                }
            }
        }
    });

    // 2. Petals
    const petalContainer = document.getElementById('lantern-petals');
    if (petalContainer && petalContainer.children.length === 0) {
        for (let i = 0; i < 20; i++) {
            let petal = document.createElement('div');
            petal.className = 'lantern-petal';
            petal.style.setProperty('--x-start', `${rng() * 100}vw`);
            petal.style.setProperty('--y-start', `-10vh`);
            petal.style.setProperty('--x-end', `${rng() * 100}vw`);
            petal.style.setProperty('--y-end', `110vh`);
            petal.style.setProperty('--r-start', `${rng() * 360}deg`);
            petal.style.setProperty('--r-end', `${rng() * 720 - 360}deg`);
            const duration = rng() * 10 + 15;
            petal.style.animationDuration = `${duration}s`;
            petal.style.animationDelay = `-${rng() * duration}s`;
            petalContainer.appendChild(petal);
            lanternFestivalElementPool.petals.push(petal); // Store in pool
        }
    }

    // 3. Embers
    const emberContainer = document.getElementById('lantern-embers');
    if (emberContainer && emberContainer.children.length === 0) {
        for (let i = 0; i < 40; i++) {
            let ember = document.createElement('div');
            ember.className = 'lantern-ember';
            ember.style.left = `${rng() * 100}%`;
            ember.style.bottom = `-${rng() * 20}vh`; // Start from below or near bottom
            const duration = rng() * 8 + 6;
            ember.style.animationDuration = `${duration}s`;
            ember.style.animationDelay = `-${rng() * duration}s`;
            emberContainer.appendChild(ember);
            lanternFestivalElementPool.embers.push(ember); // Store in pool
        }
    }

    // Mark as initialized
    lanternFestivalElementPool.initialized = true;
}

function createFluidDreamsScene() {
    // 1. Morphing Blobs for Gooey Effect
    const blobContainer = document.getElementById('morphing-blobs');
    if (blobContainer && blobContainer.children.length === 0) {
        const numBlobs = 8;
        for (let i = 0; i < numBlobs; i++) {
            let blob = document.createElement('div');
            blob.className = 'morph-blob';
            const size = Math.random() * 150 + 100; // 100px to 250px
            blob.style.width = `${size}px`;
            blob.style.height = `${size}px`;

            // Set random animation properties using CSS variables
            blob.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
            blob.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
            blob.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
            blob.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
            blob.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
            blob.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);

            blob.style.animationDelay = `-${Math.random() * 10}s, -${Math.random() * 15}s, -${Math.random() * 20}s`;
            blobContainer.appendChild(blob);
        }
    }

    // 2. Iridescent Bubbles
    const bubbleContainer = document.getElementById('iridescent-bubbles');
    if (bubbleContainer && bubbleContainer.children.length === 0) {
        const numBubbles = 20;
        for (let i = 0; i < numBubbles; i++) {
            let bubble = document.createElement('div');
            bubble.className = 'iridescent-bubble';
            const size = Math.random() * 80 + 20; // 20px to 100px
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;

            bubble.style.setProperty('--x-start', `${Math.random() * 100}vw`);
            bubble.style.setProperty('--y-start', `${110}vh`); // Start from bottom
            bubble.style.setProperty('--x-end', `${Math.random() * 100}vw`);
            bubble.style.setProperty('--y-end', `${-10}vh`); // Float to top
            bubble.style.setProperty('--scale', `${Math.random() * 0.4 + 0.8}`);

            const duration = Math.random() * 15 + 20; // 20s to 35s
            bubble.style.animationDuration = `${duration}s`;
            bubble.style.animationDelay = `-${Math.random() * duration}s`;
            bubbleContainer.appendChild(bubble);
        }
    }

    // 3. Flowing Ribbons
    const ribbonContainer = document.getElementById('ribbon-streams');
    if (ribbonContainer && ribbonContainer.children.length === 0) {
        const numRibbons = 5;
        for (let i = 0; i < numRibbons; i++) {
            let ribbon = document.createElement('div');
            ribbon.className = 'ribbon-stream';

            ribbon.style.setProperty('--x-start', `${Math.random() * 120 - 10}vw`);
            ribbon.style.setProperty('--y-start', `${Math.random() * 120 - 10}vh`);
            ribbon.style.setProperty('--x-end', `${Math.random() * 120 - 10}vw`);
            ribbon.style.setProperty('--y-end', `${Math.random() * 120 - 10}vh`);
            ribbon.style.setProperty('--r-start', `${Math.random() * 720 - 360}deg`);
            ribbon.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);

            const duration = Math.random() * 20 + 30; // 30s to 50s
            ribbon.style.animationDelay = `-${Math.random() * duration}s, -${Math.random() * 10}s`;
            ribbonContainer.appendChild(ribbon);
        }
    }
}

// Cache for moonlit forest tree backgrounds to avoid expensive regeneration
const moonlitForestTreeCache = new Map();

// Cache for Wolfhour backgrounds to avoid expensive canvas regeneration
const wolfhourBackgroundCache = new Map();

// Cache for Himalayan Peak backgrounds to avoid expensive canvas regeneration
const himalayanPeakCache = new Map();

// Cache for Ice Temple backgrounds to avoid expensive canvas regeneration
const iceTempleCache = new Map();

// Cache for Crystal Cave backgrounds to avoid expensive canvas regeneration
const crystalCaveCache = new Map();

// Element pool for Lantern Festival to avoid expensive DOM regeneration
const lanternFestivalElementPool = {
    initialized: false,
    lanterns: [],
    reflections: [],
    petals: [],
    embers: []
};

// Seeded random number generator for deterministic procedural generation
function seededRandom(seed) {
    let state = seed;
    return function() {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function createMoonlitForestScene() {
    // Define tree colors for different layers
    const treeLayers = [
        { el: document.getElementById('moonlit-forest-back'),  color: '#7A9B7E', foliageColor: '#5A8067', count: 40, height: window.innerHeight * 0.7 },
        { el: document.getElementById('moonlit-forest-mid'),   color: '#3D5F4A', foliageColor: '#4A6B56', count: 30, height: window.innerHeight * 0.85 },
        { el: document.getElementById('moonlit-forest-front'), color: '#1A2820', foliageColor: '#2F4A3A', count: 20, height: window.innerHeight }
    ];

    // Helper function to draw a more realistic tree
    const drawTree = (ctx, x, y, len, angle, width, foliageColor) => {
        if (width < 1 && len < 20) { // Stop recursion for tiny branches
            // Draw a leaf cluster at the end of small branches
            ctx.beginPath();
            ctx.arc(x, y, random(5, 15), 0, Math.PI * 2);
            ctx.fillStyle = foliageColor;
            ctx.globalAlpha = random(0.3, 0.6);
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }
        if (len < 10) return;


        ctx.beginPath();
        ctx.lineWidth = width;
        ctx.moveTo(x, y);
        const x2 = x + len * Math.cos(angle * Math.PI / 180);
        const y2 = y + len * Math.sin(angle * Math.PI / 180);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const newLen = len * (0.7 + Math.random() * 0.15);
        const newWidth = width * 0.75;
        // Main branch continues somewhat straight
        drawTree(ctx, x2, y2, newLen, angle + random(-15, 15), newWidth, foliageColor);
        // Side branch forks off
        if (width > 1) {
            drawTree(ctx, x2, y2, newLen * 0.8, angle + random(20, 50), newWidth * 0.8, foliageColor);
            drawTree(ctx, x2, y2, newLen * 0.8, angle - random(20, 50), newWidth * 0.8, foliageColor);
        }
    };

    // 1. Procedurally generate trees for parallax layers (with caching)
    treeLayers.forEach((layer, layerIndex) => {
        if(layer.el) {
            // Create a cache key based on layer properties and window dimensions
            // v2: Added gradient fade at top for smooth sky blending
            const cacheKey = `v2-${layerIndex}-${layer.color}-${layer.foliageColor}-${layer.count}-${layer.height}`;

            // Check if we have a cached version
            if (moonlitForestTreeCache.has(cacheKey)) {
                const cachedData = moonlitForestTreeCache.get(cacheKey);
                layer.el.style.backgroundImage = cachedData.backgroundImage;
                layer.el.style.backgroundSize = cachedData.backgroundSize;
            } else {
                // Generate the tree background
                const C_WIDTH = 4096; // Wider canvas for more variety in parallax
                const C_HEIGHT = layer.height;
                let canvas = document.createElement('canvas');
                canvas.width = C_WIDTH;
                canvas.height = C_HEIGHT;
                let ctx = canvas.getContext('2d');
                ctx.strokeStyle = layer.color;

                // Draw ground/undergrowth silhouette
                ctx.fillStyle = layer.foliageColor;
                ctx.beginPath();
                ctx.moveTo(0, C_HEIGHT);
                let groundY = C_HEIGHT * 0.95;
                for (let x = 0; x < C_WIDTH; x++) {
                    groundY += (Math.random() - 0.5) * 2;
                    ctx.lineTo(x, groundY);
                }
                ctx.lineTo(C_WIDTH, C_HEIGHT);
                ctx.closePath();
                ctx.fill();


                // Draw trees
                for(let i = 0; i < layer.count; i++) {
                    const x = Math.random() * C_WIDTH;
                    const y = C_HEIGHT * (0.95 + Math.random() * 0.05);
                    const len = C_HEIGHT * (0.2 + Math.random() * 0.3);
                    const angle = -90 + random(-10, 10);
                    const width = 10 + Math.random() * (layer.height / 30);
                    drawTree(ctx, x, y, len, angle, width, layer.foliageColor);
                }

                // Add gradient fade at the top to blend smoothly with sky
                const fadeHeight = C_HEIGHT * 0.35; // Fade the top 35% of the canvas
                const gradient = ctx.createLinearGradient(0, 0, 0, fadeHeight);
                gradient.addColorStop(0, 'rgba(0, 0, 0, 1)'); // Fully transparent at top
                gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.3)'); // Gradual fade
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Fully visible at bottom

                ctx.globalCompositeOperation = 'destination-out'; // Use gradient as alpha mask
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, C_WIDTH, fadeHeight);
                ctx.globalCompositeOperation = 'source-over'; // Reset to normal

                const backgroundImage = `url(${canvas.toDataURL()})`;
                const backgroundSize = `${C_WIDTH}px ${C_HEIGHT}px`;

                // Cache the generated background
                moonlitForestTreeCache.set(cacheKey, { backgroundImage, backgroundSize });

                // Apply to the layer
                layer.el.style.backgroundImage = backgroundImage;
                layer.el.style.backgroundSize = backgroundSize;
            }
        }
    });

    // 2. Glowing Mushrooms
    const mushroomContainer = document.getElementById('glowing-mushrooms');
    if (mushroomContainer && mushroomContainer.children.length === 0) {
        for (let i = 0; i < 30; i++) {
            let mushroom = document.createElement('div');
            mushroom.className = 'glowing-mushroom';
            mushroom.style.left = `${Math.random() * 98}%`;
            mushroom.style.bottom = `${Math.random() * 90}%`; // Spread them out more vertically
            mushroom.style.transform = `scale(${Math.random() * 0.4 + 0.6})`;
            mushroom.style.setProperty('--delay', `-${Math.random() * 12}s`);
            mushroomContainer.appendChild(mushroom);
        }
    }

    // 3. Moonbeams
    const moonbeamContainer = document.querySelector('.moonbeam-container');
    if (moonbeamContainer && moonbeamContainer.children.length === 0) {
        for (let i = 0; i < 10; i++) {
            let beam = document.createElement('div');
            beam.className = 'moonbeam';
            const angle = Math.random() * 20 - 10;
            beam.style.left = `${Math.random() * 100}%`;
            beam.style.setProperty('--r-start', `${angle - 8}deg`);
            beam.style.setProperty('--r-end', `${angle + 8}deg`);
            beam.style.setProperty('--opacity', `${Math.random() * 0.3 + 0.1}`);
            beam.style.animationDelay = `-${Math.random() * 45}s`;
            moonbeamContainer.appendChild(beam);
        }
    }

    // 4. Wildlife and Leaves
    const wildlifeContainer = document.getElementById('moonlit-wildlife');
    if (wildlifeContainer && wildlifeContainer.children.length === 0) {
        // Glowing Eyes
        for (let i = 0; i < 7; i++) {
            let eyes = document.createElement('div');
            eyes.className = 'glowing-eyes';
            eyes.style.left = `${Math.random() * 95}%`;
            eyes.style.bottom = `${Math.random() * 40}%`; // Keep them in the undergrowth
            eyes.style.animationDelay = `-${Math.random() * 12}s`;
            wildlifeContainer.appendChild(eyes);
        }
        // Flying Owl
        let owl = document.createElement('div');
        owl.className = 'flying-owl';
        owl.style.animationDelay = `-${Math.random() * 45}s`;
        wildlifeContainer.appendChild(owl);
    }

    const themeContainer = document.getElementById('moonlit-forest-theme');
    if (themeContainer) {
        // Clear old leaves before adding new ones
        themeContainer.querySelectorAll('.moonlit-leaf').forEach(e => e.remove());
        // Falling Leaves
        for (let i = 0; i < 10; i++) { // Fewer, more subtle leaves
            let leaf = document.createElement('div');
            leaf.className = 'moonlit-leaf';
            const xStart = Math.random() * 100;
            leaf.style.setProperty('--x-start', `${xStart}vw`);
            leaf.style.setProperty('--x-end', `${xStart + (Math.random() * 15 - 7.5)}vw`);
            leaf.style.setProperty('--r-start', `${Math.random() * 360}deg`);
            leaf.style.setProperty('--r-end', `${Math.random() * 540 - 270}deg`);
            const duration = Math.random() * 12 + 12;
            leaf.style.animationDuration = `${duration}s`;
            leaf.style.animationDelay = `-${Math.random() * duration}s`;
            themeContainer.appendChild(leaf);
        }
    }
}

function createWolfhourScene() {
    // 1. Create dense star field
    const starsContainer = document.getElementById('wolfhour-stars');
    if (starsContainer && starsContainer.children.length === 0) {
        const starCount = 300;
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'wolfhour-star';
            const size = Math.random() * 2 + 0.5;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            star.style.setProperty('--min-opacity', `${Math.random() * 0.3 + 0.2}`);
            star.style.setProperty('--max-opacity', `${Math.random() * 0.3 + 0.7}`);
            star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
            star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
            starsContainer.appendChild(star);
        }

        // Create shooting stars periodically
        setInterval(() => {
            if (activeTheme !== 'wolfhour') return;
            const shootingStar = document.createElement('div');
            shootingStar.className = 'wolfhour-shooting-star';
            shootingStar.style.left = `${Math.random() * 100}%`;
            shootingStar.style.top = `${Math.random() * 40}%`;
            const distance = Math.random() * 300 + 200;
            shootingStar.style.setProperty('--shoot-x', `${-distance}px`);
            shootingStar.style.setProperty('--shoot-y', `${distance}px`);
            shootingStar.style.setProperty('--shoot-duration', `${Math.random() * 1 + 1.5}s`);
            starsContainer.appendChild(shootingStar);
            setTimeout(() => shootingStar.remove(), 3000);
        }, 8000);
    }

    // 2. Create nebula clouds using canvas (with caching)
    const nebulaBack = document.getElementById('wolfhour-nebula-back');
    const nebulaMid = document.getElementById('wolfhour-nebula-mid');

    if (nebulaBack) {
        const cacheKey = 'wolfhour-nebula-back-2000x800';

        if (wolfhourBackgroundCache.has(cacheKey)) {
            // Use cached version
            nebulaBack.style.backgroundImage = wolfhourBackgroundCache.get(cacheKey);
        } else {
            // Generate with seeded random for deterministic output
            const rng = seededRandom(12345);
            const canvas = document.createElement('canvas');
            canvas.width = 2000;
            canvas.height = 800;
            const ctx = canvas.getContext('2d');

            // Create wispy nebula texture
            for (let i = 0; i < 50; i++) {
                const x = rng() * canvas.width;
                const y = rng() * canvas.height;
                const radius = rng() * 200 + 100;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                const opacity = rng() * 0.15 + 0.05;
                gradient.addColorStop(0, `rgba(200, 200, 200, ${opacity})`);
                gradient.addColorStop(0.5, `rgba(150, 150, 150, ${opacity * 0.5})`);
                gradient.addColorStop(1, 'rgba(100, 100, 100, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const dataURL = `url(${canvas.toDataURL()})`;
            wolfhourBackgroundCache.set(cacheKey, dataURL);
            nebulaBack.style.backgroundImage = dataURL;
        }
    }

    if (nebulaMid) {
        const cacheKey = 'wolfhour-nebula-mid-2000x800';

        if (wolfhourBackgroundCache.has(cacheKey)) {
            // Use cached version
            nebulaMid.style.backgroundImage = wolfhourBackgroundCache.get(cacheKey);
        } else {
            // Generate with seeded random for deterministic output
            const rng = seededRandom(54321);
            const canvas = document.createElement('canvas');
            canvas.width = 2000;
            canvas.height = 800;
            const ctx = canvas.getContext('2d');

            // Create denser nebula for mid layer
            for (let i = 0; i < 40; i++) {
                const x = rng() * canvas.width;
                const y = rng() * canvas.height;
                const radius = rng() * 250 + 150;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
                const opacity = rng() * 0.2 + 0.1;
                gradient.addColorStop(0, `rgba(220, 220, 220, ${opacity})`);
                gradient.addColorStop(0.5, `rgba(180, 180, 180, ${opacity * 0.6})`);
                gradient.addColorStop(1, 'rgba(120, 120, 120, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const dataURL = `url(${canvas.toDataURL()})`;
            wolfhourBackgroundCache.set(cacheKey, dataURL);
            nebulaMid.style.backgroundImage = dataURL;
        }
    }

    // 3. Create mystical light rays
    const lightRaysContainer = document.getElementById('wolfhour-light-rays');
    if (lightRaysContainer && lightRaysContainer.children.length === 0) {
        const rayCount = 12;
        for (let i = 0; i < rayCount; i++) {
            const ray = document.createElement('div');
            ray.className = 'wolfhour-light-ray';
            ray.style.left = `${Math.random() * 100}%`;
            const angleStart = Math.random() * 6 - 3;
            const angleEnd = angleStart + (Math.random() * 4 - 2);
            ray.style.setProperty('--ray-angle-start', `${angleStart}deg`);
            ray.style.setProperty('--ray-angle-end', `${angleEnd}deg`);
            ray.style.setProperty('--ray-duration', `${Math.random() * 6 + 8}s`);
            ray.style.setProperty('--ray-delay', `${Math.random() * 10}s`);
            lightRaysContainer.appendChild(ray);
        }
    }

    // 4. Create cosmic rifts (glowing cracks in space)
    const cosmicRiftsContainer = document.getElementById('wolfhour-cosmic-rifts');
    if (cosmicRiftsContainer && cosmicRiftsContainer.children.length === 0) {
        const riftCount = 8;
        for (let i = 0; i < riftCount; i++) {
            const rift = document.createElement('div');
            rift.className = 'wolfhour-cosmic-rift';
            rift.style.left = `${Math.random() * 100}%`;
            rift.style.top = `${Math.random() * 60}%`;
            rift.style.setProperty('--rift-length', `${Math.random() * 100 + 100}px`);
            rift.style.setProperty('--rift-duration', `${Math.random() * 3 + 3}s`);
            rift.style.setProperty('--rift-delay', `${Math.random() * 5}s`);
            rift.style.transform = `rotate(${Math.random() * 30 - 15}deg)`;
            cosmicRiftsContainer.appendChild(rift);
        }
    }

    // 5. Create ethereal spirits
    const spiritsContainer = document.getElementById('wolfhour-spirits');
    if (spiritsContainer && spiritsContainer.children.length === 0) {
        const spiritCount = 6;
        for (let i = 0; i < spiritCount; i++) {
            const spirit = document.createElement('div');
            spirit.className = 'wolfhour-spirit';
            spirit.style.left = `${Math.random() * 100}%`;
            spirit.style.top = `${Math.random() * 80 + 10}%`;

            const xStart = Math.random() * 40 - 20;
            const xMid = Math.random() * 80 - 40;
            const xEnd = Math.random() * 120 - 60;
            const yStart = Math.random() * 20;
            const yMid = -(Math.random() * 100 + 50);
            const yEnd = -(Math.random() * 200 + 100);

            spirit.style.setProperty('--spirit-x-start', `${xStart}px`);
            spirit.style.setProperty('--spirit-x-mid', `${xMid}px`);
            spirit.style.setProperty('--spirit-x-end', `${xEnd}px`);
            spirit.style.setProperty('--spirit-y-start', `${yStart}px`);
            spirit.style.setProperty('--spirit-y-mid', `${yMid}px`);
            spirit.style.setProperty('--spirit-y-end', `${yEnd}px`);
            spirit.style.setProperty('--spirit-duration', `${Math.random() * 15 + 20}s`);
            spirit.style.setProperty('--spirit-delay', `${Math.random() * 20}s`);
            spiritsContainer.appendChild(spirit);
        }
    }

    // 6. Create jagged mountain silhouettes (with caching)
    const mountainsDistant = document.getElementById('wolfhour-mountains-distant');
    if (mountainsDistant) {
        const cacheKey = 'wolfhour-mountains-distant-4000x800';

        if (wolfhourBackgroundCache.has(cacheKey)) {
            // Use cached version
            const cachedData = wolfhourBackgroundCache.get(cacheKey);
            mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
            mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
        } else {
            // Generate with seeded random for deterministic output
            const rng = seededRandom(11111);
            const canvas = document.createElement('canvas');
            canvas.width = 4000;
            canvas.height = 800;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#404040';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);

            // Create jagged peaks
            for (let x = 0; x < canvas.width; x += 20) {
                const y = canvas.height - (rng() * 300 + 200) - Math.sin(x * 0.01) * 100;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();

            const backgroundImage = `url(${canvas.toDataURL()})`;
            const backgroundSize = '2000px 100%';
            wolfhourBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
            mountainsDistant.style.backgroundImage = backgroundImage;
            mountainsDistant.style.backgroundSize = backgroundSize;
        }
    }

    const mountainsFore = document.getElementById('wolfhour-mountains-fore');
    if (mountainsFore) {
        const cacheKey = 'wolfhour-mountains-fore-4000x600';

        if (wolfhourBackgroundCache.has(cacheKey)) {
            // Use cached version
            const cachedData = wolfhourBackgroundCache.get(cacheKey);
            mountainsFore.style.backgroundImage = cachedData.backgroundImage;
            mountainsFore.style.backgroundSize = cachedData.backgroundSize;
        } else {
            // Generate with seeded random for deterministic output
            const rng = seededRandom(22222);
            const canvas = document.createElement('canvas');
            canvas.width = 4000;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);

            // Create sharper, darker peaks
            for (let x = 0; x < canvas.width; x += 15) {
                const y = canvas.height - (rng() * 400 + 150) - Math.cos(x * 0.015) * 80;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();

            const backgroundImage = `url(${canvas.toDataURL()})`;
            const backgroundSize = '2000px 100%';
            wolfhourBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
            mountainsFore.style.backgroundImage = backgroundImage;
            mountainsFore.style.backgroundSize = backgroundSize;
        }
    }
}

// Cache for Lunara background elements
const lunaraBackgroundCache = new Map();

function createLunaraScene() {
    // 1. Create twinkling stars
    const starsContainer = document.getElementById('lunara-stars');
    if (starsContainer && starsContainer.children.length === 0) {
        const starCount = 200;
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'lunara-star';
            const size = Math.random() * 2 + 0.5;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
            star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
            starsContainer.appendChild(star);
        }
    }

    // 2. Create aurora-like streaks
    const auroraContainer = document.getElementById('lunara-aurora');
    if (auroraContainer && auroraContainer.children.length === 0) {
        const auroraCount = 5;
        for (let i = 0; i < auroraCount; i++) {
            const aurora = document.createElement('div');
            aurora.className = 'lunara-aurora';
            aurora.style.left = `${Math.random() * 100}%`;
            aurora.style.top = `${Math.random() * 40}%`;
            aurora.style.setProperty('--aurora-duration', `${Math.random() * 10 + 15}s`);
            aurora.style.setProperty('--aurora-delay', `${Math.random() * 5}s`);
            auroraContainer.appendChild(aurora);
        }
    }

    // 3. Create twin planets with glow
    const planetsContainer = document.getElementById('lunara-planets');
    if (planetsContainer && planetsContainer.children.length === 0) {
        const cacheKey = 'lunara-planets-canvas';

        if (lunaraBackgroundCache.has(cacheKey)) {
            planetsContainer.style.backgroundImage = lunaraBackgroundCache.get(cacheKey);
        } else {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const ctx = canvas.getContext('2d');

            // Large purple planet
            const planet1X = canvas.width * 0.35;
            const planet1Y = canvas.height * 0.25;
            const planet1Radius = Math.min(canvas.width, canvas.height) * 0.2;

            // Draw glow
            const glow1 = ctx.createRadialGradient(planet1X, planet1Y, planet1Radius * 0.8, planet1X, planet1Y, planet1Radius * 1.5);
            glow1.addColorStop(0, 'rgba(200, 150, 255, 0.3)');
            glow1.addColorStop(1, 'rgba(200, 150, 255, 0)');
            ctx.fillStyle = glow1;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw planet
            const planet1Grad = ctx.createRadialGradient(planet1X - planet1Radius * 0.3, planet1Y - planet1Radius * 0.3, planet1Radius * 0.2, planet1X, planet1Y, planet1Radius);
            planet1Grad.addColorStop(0, '#d8b5ff');
            planet1Grad.addColorStop(0.5, '#a855f7');
            planet1Grad.addColorStop(1, '#6b21a8');
            ctx.fillStyle = planet1Grad;
            ctx.beginPath();
            ctx.arc(planet1X, planet1Y, planet1Radius, 0, Math.PI * 2);
            ctx.fill();

            // Smaller pink planet
            const planet2X = canvas.width * 0.5;
            const planet2Y = canvas.height * 0.2;
            const planet2Radius = Math.min(canvas.width, canvas.height) * 0.12;

            // Draw glow
            const glow2 = ctx.createRadialGradient(planet2X, planet2Y, planet2Radius * 0.8, planet2X, planet2Y, planet2Radius * 1.5);
            glow2.addColorStop(0, 'rgba(255, 200, 240, 0.3)');
            glow2.addColorStop(1, 'rgba(255, 200, 240, 0)');
            ctx.fillStyle = glow2;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw planet
            const planet2Grad = ctx.createRadialGradient(planet2X - planet2Radius * 0.3, planet2Y - planet2Radius * 0.3, planet2Radius * 0.2, planet2X, planet2Y, planet2Radius);
            planet2Grad.addColorStop(0, '#ffd4f0');
            planet2Grad.addColorStop(0.5, '#f472b6');
            planet2Grad.addColorStop(1, '#be185d');
            ctx.fillStyle = planet2Grad;
            ctx.beginPath();
            ctx.arc(planet2X, planet2Y, planet2Radius, 0, Math.PI * 2);
            ctx.fill();

            const dataURL = `url(${canvas.toDataURL()})`;
            lunaraBackgroundCache.set(cacheKey, dataURL);
            planetsContainer.style.backgroundImage = dataURL;
        }
    }

    // 4. Create distant mountains with caching
    const mountainsDistant = document.getElementById('lunara-mountains-distant');
    if (mountainsDistant) {
        const cacheKey = 'lunara-mountains-distant-3000x600';

        if (lunaraBackgroundCache.has(cacheKey)) {
            const cachedData = lunaraBackgroundCache.get(cacheKey);
            mountainsDistant.style.backgroundImage = cachedData.backgroundImage;
            mountainsDistant.style.backgroundSize = cachedData.backgroundSize;
        } else {
            const rng = seededRandom(33333);
            const canvas = document.createElement('canvas');
            canvas.width = 3000;
            canvas.height = 600;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#b794f6');
            gradient.addColorStop(1, '#9f7aea');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);

            for (let x = 0; x < canvas.width; x += 30) {
                const y = canvas.height - (rng() * 200 + 150) - Math.sin(x * 0.008) * 80;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();

            const backgroundImage = `url(${canvas.toDataURL()})`;
            const backgroundSize = '150% 100%';
            lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
            mountainsDistant.style.backgroundImage = backgroundImage;
            mountainsDistant.style.backgroundSize = backgroundSize;
        }
    }

    // 5. Create mid-ground mountains
    const mountainsMid = document.getElementById('lunara-mountains-mid');
    if (mountainsMid) {
        const cacheKey = 'lunara-mountains-mid-3000x700';

        if (lunaraBackgroundCache.has(cacheKey)) {
            const cachedData = lunaraBackgroundCache.get(cacheKey);
            mountainsMid.style.backgroundImage = cachedData.backgroundImage;
            mountainsMid.style.backgroundSize = cachedData.backgroundSize;
        } else {
            const rng = seededRandom(44444);
            const canvas = document.createElement('canvas');
            canvas.width = 3000;
            canvas.height = 700;
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#9f7aea');
            gradient.addColorStop(1, '#7c3aed');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.moveTo(0, canvas.height);

            for (let x = 0; x < canvas.width; x += 25) {
                const y = canvas.height - (rng() * 300 + 200) - Math.cos(x * 0.01) * 100;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(canvas.width, canvas.height);
            ctx.closePath();
            ctx.fill();

            const backgroundImage = `url(${canvas.toDataURL()})`;
            const backgroundSize = '150% 100%';
            lunaraBackgroundCache.set(cacheKey, { backgroundImage, backgroundSize });
            mountainsMid.style.backgroundImage = backgroundImage;
            mountainsMid.style.backgroundSize = backgroundSize;
        }
    }

    // 6. Create snow-covered pine trees (left side)
    const forestLeft = document.getElementById('lunara-forest-left');
    if (forestLeft && forestLeft.children.length === 0) {
        const treeCount = 8;
        for (let i = 0; i < treeCount; i++) {
            const tree = document.createElement('div');
            tree.className = 'lunara-tree';
            const height = Math.random() * 200 + 250;
            tree.style.height = `${height}px`;
            tree.style.left = `${i * 12}%`;
            tree.style.bottom = '0';
            tree.style.setProperty('--sway-duration', `${Math.random() * 3 + 4}s`);
            tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
            forestLeft.appendChild(tree);
        }
    }

    // 7. Create snow-covered pine trees (right side)
    const forestRight = document.getElementById('lunara-forest-right');
    if (forestRight && forestRight.children.length === 0) {
        const treeCount = 8;
        for (let i = 0; i < treeCount; i++) {
            const tree = document.createElement('div');
            tree.className = 'lunara-tree';
            const height = Math.random() * 200 + 250;
            tree.style.height = `${height}px`;
            tree.style.right = `${i * 12}%`;
            tree.style.bottom = '0';
            tree.style.setProperty('--sway-duration', `${Math.random() * 3 + 4}s`);
            tree.style.setProperty('--sway-delay', `${Math.random() * 2}s`);
            forestRight.appendChild(tree);
        }
    }
}

function createPyrestormScene() {
    // Layer 2 - Volcano Peaks with eruptions
    const volcanoContainer = document.getElementById('pyrestorm-volcano-peaks');
    if (volcanoContainer && volcanoContainer.children.length === 0) {
        const volcanoCount = 5;
        const positions = [10, 25, 45, 65, 85];

        for (let i = 0; i < volcanoCount; i++) {
            // Create volcano shape
            const volcano = document.createElement('div');
            volcano.className = 'pyrestorm-volcano';
            volcano.style.left = `${positions[i]}%`;
            const scale = 0.7 + Math.random() * 0.6;
            volcano.style.transform = `scale(${scale})`;

            // Add glowing cracks
            const crackCount = 3 + Math.floor(Math.random() * 4);
            for (let j = 0; j < crackCount; j++) {
                const crack = document.createElement('div');
                crack.className = 'pyrestorm-volcano-crack';
                const crackHeight = 50 + Math.random() * 150;
                crack.style.height = `${crackHeight}px`;
                crack.style.left = `${-50 + Math.random() * 100}px`;
                crack.style.bottom = `${Math.random() * 100}px`;
                crack.style.animationDelay = `${Math.random() * 3}s`;
                volcano.appendChild(crack);
            }

            // Add eruption effect
            const eruption = document.createElement('div');
            eruption.className = 'pyrestorm-eruption';
            eruption.style.left = '50%';
            eruption.style.bottom = '350px';
            eruption.style.transform = 'translateX(-50%)';
            eruption.style.setProperty('--eruption-duration', `${8 + Math.random() * 7}s`);
            eruption.style.setProperty('--eruption-delay', `${Math.random() * 10}s`);
            volcano.appendChild(eruption);

            volcanoContainer.appendChild(volcano);
        }
    }

    // Layer 3 - Lava Rivers
    const lavaRiversContainer = document.getElementById('pyrestorm-lava-rivers');
    if (lavaRiversContainer && lavaRiversContainer.children.length === 0) {
        const riverCount = 8;

        for (let i = 0; i < riverCount; i++) {
            const river = document.createElement('div');
            river.className = 'pyrestorm-lava-river';
            river.style.left = `${i * 15}%`;
            river.style.setProperty('--flow-speed', `${10 + Math.random() * 10}s`);
            river.style.animationDelay = `${Math.random() * 5}s`;
            river.style.width = `${100 + Math.random() * 100}px`;

            // Add lava splashes
            const splashCount = 2 + Math.floor(Math.random() * 3);
            for (let j = 0; j < splashCount; j++) {
                const splash = document.createElement('div');
                splash.className = 'pyrestorm-lava-splash';
                splash.style.left = `${Math.random() * 100}%`;
                splash.style.bottom = `${20 + Math.random() * 40}%`;
                splash.style.setProperty('--splash-duration', `${2 + Math.random() * 3}s`);
                splash.style.setProperty('--splash-delay', `${Math.random() * 4}s`);
                river.appendChild(splash);
            }

            lavaRiversContainer.appendChild(river);
        }
    }

    // Layer 4 - Foreground Rocks
    const rocksContainer = document.getElementById('pyrestorm-foreground-rocks');
    if (rocksContainer && rocksContainer.children.length === 0) {
        const rockCount = 6;
        const rockPositions = [5, 18, 35, 55, 72, 88];

        for (let i = 0; i < rockCount; i++) {
            const rock = document.createElement('div');
            rock.className = 'pyrestorm-rock';
            const width = 80 + Math.random() * 120;
            const height = 100 + Math.random() * 150;
            rock.style.width = `${width}px`;
            rock.style.height = `${height}px`;
            rock.style.left = `${rockPositions[i]}%`;

            // Add glowing cracks
            const crackCount = 1 + Math.floor(Math.random() * 3);
            for (let j = 0; j < crackCount; j++) {
                const crack = document.createElement('div');
                crack.className = 'pyrestorm-rock-crack';
                crack.style.top = `${20 + Math.random() * 60}%`;
                crack.style.setProperty('--crack-duration', `${3 + Math.random() * 3}s`);
                crack.style.setProperty('--crack-delay', `${Math.random() * 4}s`);
                rock.appendChild(crack);
            }

            rocksContainer.appendChild(rock);
        }
    }

    // Layer 5a - Embers
    const embersContainer = document.getElementById('pyrestorm-embers');
    if (embersContainer && embersContainer.children.length === 0) {
        const emberCount = 100;

        for (let i = 0; i < emberCount; i++) {
            const ember = document.createElement('div');
            ember.className = 'pyrestorm-ember';
            const size = 2 + Math.random() * 4;
            ember.style.width = `${size}px`;
            ember.style.height = `${size}px`;
            ember.style.left = `${Math.random() * 100}%`;
            ember.style.bottom = `${Math.random() * 30}%`;
            ember.style.setProperty('--ember-duration', `${8 + Math.random() * 12}s`);
            ember.style.setProperty('--ember-delay', `${Math.random() * 10}s`);
            ember.style.setProperty('--ember-drift', `${-50 + Math.random() * 100}px`);
            embersContainer.appendChild(ember);
        }
    }

    // Layer 5b - Smoke Plumes
    const smokeContainer = document.getElementById('pyrestorm-smoke');
    if (smokeContainer && smokeContainer.children.length === 0) {
        const smokeCount = 15;

        for (let i = 0; i < smokeCount; i++) {
            const smoke = document.createElement('div');
            smoke.className = 'pyrestorm-smoke-plume';
            smoke.style.left = `${Math.random() * 100}%`;
            smoke.style.bottom = `${Math.random() * 40}%`;
            const width = 150 + Math.random() * 200;
            const height = 250 + Math.random() * 150;
            smoke.style.width = `${width}px`;
            smoke.style.height = `${height}px`;
            smoke.style.setProperty('--smoke-duration', `${12 + Math.random() * 15}s`);
            smoke.style.setProperty('--smoke-delay', `${Math.random() * 12}s`);
            smoke.style.setProperty('--smoke-drift', `${-100 + Math.random() * 200}px`);
            smokeContainer.appendChild(smoke);
        }
    }
}

function createNeonDuskScene() {
    // Layer 1 - Twinkling Stars
    const starsContainer = document.getElementById('neon-dusk-stars');
    if (starsContainer && starsContainer.children.length === 0) {
        const starCount = 150;
        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'neon-dusk-star';
            const size = Math.random() * 2.5 + 1;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 60}%`;
            star.style.setProperty('--twinkle-duration', `${Math.random() * 3 + 2}s`);
            star.style.setProperty('--twinkle-delay', `${Math.random() * 5}s`);
            starsContainer.appendChild(star);
        }
    }

    // Layer 2 - Neon Purple Clouds
    const cloudsContainer = document.getElementById('neon-dusk-clouds');
    if (cloudsContainer && cloudsContainer.children.length === 0) {
        const cloudCount = 8;
        for (let i = 0; i < cloudCount; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'neon-dusk-cloud';
            cloud.style.top = `${10 + Math.random() * 50}%`;
            const duration = Math.random() * 40 + 60;
            cloud.style.setProperty('--cloud-duration', `${duration}s`);
            cloud.style.setProperty('--cloud-delay', `-${Math.random() * duration}s`);
            cloudsContainer.appendChild(cloud);
        }
    }

    // Layer 3 - Shooting Meteors
    const meteorsContainer = document.getElementById('neon-dusk-meteors');
    if (meteorsContainer && meteorsContainer.children.length === 0) {
        const meteorCount = 6;

        // Function to spawn meteors periodically
        const spawnMeteor = () => {
            if (activeTheme !== 'neon-dusk') return;

            const meteor = document.createElement('div');
            meteor.className = 'neon-dusk-meteor';
            meteor.style.left = `${Math.random() * 100}%`;
            meteor.style.top = `${Math.random() * 60}%`;
            const duration = Math.random() * 2 + 2;
            meteor.style.setProperty('--meteor-duration', `${duration}s`);
            meteor.style.setProperty('--meteor-delay', '0s');
            meteorsContainer.appendChild(meteor);

            // Remove after animation completes
            setTimeout(() => {
                if (meteor.parentNode) {
                    meteor.parentNode.removeChild(meteor);
                }
            }, duration * 1000);
        };

        // Spawn initial meteors
        for (let i = 0; i < meteorCount; i++) {
            setTimeout(spawnMeteor, Math.random() * 5000);
        }

        // Continuously spawn meteors
        const meteorInterval = setInterval(() => {
            if (activeTheme === 'neon-dusk') {
                spawnMeteor();
            } else {
                clearInterval(meteorInterval);
            }
        }, 4000);
    }

    // Layer 4 - Mountain Silhouettes (Back, Mid, Front)
    // Back Mountains
    const mountainsBack = document.getElementById('neon-dusk-mountains-back');
    if (mountainsBack && mountainsBack.children.length === 0) {
        const mountain = document.createElement('div');
        mountain.className = 'neon-dusk-mountain-back';
        mountain.style.width = '100%';
        mountain.style.height = '100%';
        mountain.style.setProperty('--p1', '8%');
        mountain.style.setProperty('--h1', '65%');
        mountain.style.setProperty('--p2', '18%');
        mountain.style.setProperty('--h2', '45%');
        mountain.style.setProperty('--p3', '28%');
        mountain.style.setProperty('--h3', '55%');
        mountain.style.setProperty('--p4', '38%');
        mountain.style.setProperty('--h4', '35%');
        mountain.style.setProperty('--p5', '48%');
        mountain.style.setProperty('--h5', '50%');
        mountain.style.setProperty('--p6', '58%');
        mountain.style.setProperty('--h6', '40%');
        mountain.style.setProperty('--p7', '68%');
        mountain.style.setProperty('--h7', '55%');
        mountain.style.setProperty('--p8', '78%');
        mountain.style.setProperty('--h8', '45%');
        mountain.style.setProperty('--p9', '88%');
        mountain.style.setProperty('--h9', '60%');
        mountainsBack.appendChild(mountain);
    }

    // Mid Mountains
    const mountainsMid = document.getElementById('neon-dusk-mountains-mid');
    if (mountainsMid && mountainsMid.children.length === 0) {
        const mountain = document.createElement('div');
        mountain.className = 'neon-dusk-mountain-mid';
        mountain.style.width = '100%';
        mountain.style.height = '100%';
        mountain.style.setProperty('--p1', '12%');
        mountain.style.setProperty('--h1', '60%');
        mountain.style.setProperty('--p2', '22%');
        mountain.style.setProperty('--h2', '40%');
        mountain.style.setProperty('--p3', '32%');
        mountain.style.setProperty('--h3', '50%');
        mountain.style.setProperty('--p4', '42%');
        mountain.style.setProperty('--h4', '30%');
        mountain.style.setProperty('--p5', '52%');
        mountain.style.setProperty('--h5', '45%');
        mountain.style.setProperty('--p6', '62%');
        mountain.style.setProperty('--h6', '35%');
        mountain.style.setProperty('--p7', '72%');
        mountain.style.setProperty('--h7', '50%');
        mountain.style.setProperty('--p8', '82%');
        mountain.style.setProperty('--h8', '40%');
        mountainsMid.appendChild(mountain);
    }

    // Front Mountains
    const mountainsFront = document.getElementById('neon-dusk-mountains-front');
    if (mountainsFront && mountainsFront.children.length === 0) {
        const mountain = document.createElement('div');
        mountain.className = 'neon-dusk-mountain-front';
        mountain.style.width = '100%';
        mountain.style.height = '100%';
        mountain.style.setProperty('--p1', '10%');
        mountain.style.setProperty('--h1', '55%');
        mountain.style.setProperty('--p2', '20%');
        mountain.style.setProperty('--h2', '35%');
        mountain.style.setProperty('--p3', '30%');
        mountain.style.setProperty('--h3', '45%');
        mountain.style.setProperty('--p4', '40%');
        mountain.style.setProperty('--h4', '25%');
        mountain.style.setProperty('--p5', '50%');
        mountain.style.setProperty('--h5', '40%');
        mountain.style.setProperty('--p6', '60%');
        mountain.style.setProperty('--h6', '30%');
        mountain.style.setProperty('--p7', '70%');
        mountain.style.setProperty('--h7', '45%');
        mountain.style.setProperty('--p8', '80%');
        mountain.style.setProperty('--h8', '35%');
        mountain.style.setProperty('--p9', '90%');
        mountain.style.setProperty('--h9', '50%');
        mountainsFront.appendChild(mountain);
    }

    // Layer 5 - Floating Neon Particles / Polygons
    const particlesContainer = document.getElementById('neon-dusk-particles');
    if (particlesContainer && particlesContainer.children.length === 0) {
        const particleCount = 40;
        const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ff0088', '#ffff00'];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'neon-dusk-particle';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.bottom = `${Math.random() * 100}%`;
            const particleColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.setProperty('--particle-color', particleColor);
            particle.style.setProperty('--particle-duration', `${Math.random() * 10 + 15}s`);
            particle.style.setProperty('--particle-delay', `${Math.random() * 10}s`);
            particle.style.setProperty('--drift-x', `${Math.random() * 200 - 100}px`);
            particlesContainer.appendChild(particle);
        }
    }
}

function createStillwaterScene() {
    // Layer 1 - Distant Trees (Deep forest background with organic shapes)
    const distantTreesContainer = document.getElementById('stillwater-distant-trees');
    if (distantTreesContainer && distantTreesContainer.children.length === 0) {
        const clusters = [
            { start: 0, end: 20, baseHeight: 140 },
            { start: 25, end: 45, baseHeight: 120 },
            { start: 50, end: 70, baseHeight: 135 },
            { start: 75, end: 95, baseHeight: 125 }
        ];

        clusters.forEach(cluster => {
            const tree = document.createElement('div');
            tree.className = 'stillwater-distant-tree-cluster';
            tree.style.left = `${cluster.start}%`;
            tree.style.width = `${cluster.end - cluster.start}%`;
            tree.style.setProperty('--height', `${cluster.baseHeight}px`);
            tree.style.setProperty('--sway-duration', `${Math.random() * 20 + 40}s`);
            tree.style.setProperty('--sway-delay', `-${Math.random() * 20}s`);
            distantTreesContainer.appendChild(tree);
        });
    }

    // Layer 2 - Mid Trees (Varied organic silhouettes)
    const midTreesContainer = document.getElementById('stillwater-mid-trees');
    if (midTreesContainer && midTreesContainer.children.length === 0) {
        const treePositions = [5, 12, 23, 35, 42, 56, 63, 71, 82, 90];
        treePositions.forEach((pos, i) => {
            const tree = document.createElement('div');
            tree.className = 'stillwater-mid-tree';
            const height = Math.random() * 80 + 160;
            const width = Math.random() * 35 + 25;
            tree.style.left = `${pos}%`;
            tree.style.setProperty('--tree-height', `${height}px`);
            tree.style.setProperty('--tree-width', `${width}px`);
            tree.style.setProperty('--sway-duration', `${Math.random() * 15 + 30}s`);
            tree.style.setProperty('--sway-delay', `-${Math.random() * 15}s`);
            tree.style.setProperty('--sway-amount', `${Math.random() * 1 + 0.5}deg`);
            midTreesContainer.appendChild(tree);
        });
    }

    // Layer 3 - Close Trees (Defined trunks with organic shapes)
    const closeTreesContainer = document.getElementById('stillwater-close-trees');
    if (closeTreesContainer && closeTreesContainer.children.length === 0) {
        const treePosi = [8, 28, 48, 68, 88];
        treePosi.forEach((pos, i) => {
            const tree = document.createElement('div');
            tree.className = 'stillwater-close-tree';
            const height = Math.random() * 100 + 200;
            tree.style.left = `${pos}%`;
            tree.style.setProperty('--tree-height', `${height}px`);
            tree.style.setProperty('--sway-duration', `${Math.random() * 12 + 25}s`);
            tree.style.setProperty('--sway-delay', `-${Math.random() * 12}s`);
            closeTreesContainer.appendChild(tree);
        });
    }

    // Layer 4 - Foreground Trees (Large, prominent trunks)
    const foregroundTreesContainer = document.getElementById('stillwater-foreground-trees');
    if (foregroundTreesContainer && foregroundTreesContainer.children.length === 0) {
        const positions = [2, 18, 38, 62, 78, 94];
        positions.forEach((pos, i) => {
            const tree = document.createElement('div');
            tree.className = 'stillwater-foreground-tree';
            const height = Math.random() * 150 + 250;
            const width = Math.random() * 30 + 25;
            tree.style.left = `${pos}%`;
            tree.style.setProperty('--tree-height', `${height}px`);
            tree.style.setProperty('--tree-width', `${width}px`);
            tree.style.setProperty('--sway-duration', `${Math.random() * 10 + 20}s`);
            tree.style.setProperty('--sway-delay', `-${Math.random() * 10}s`);
            foregroundTreesContainer.appendChild(tree);
        });
    }

    // Layer 5 - Rocks along waterline
    const rocksContainer = document.getElementById('stillwater-rocks');
    if (rocksContainer && rocksContainer.children.length === 0) {
        const rockCount = 15;
        for (let i = 0; i < rockCount; i++) {
            const rock = document.createElement('div');
            rock.className = 'stillwater-rock';
            const size = Math.random() * 25 + 15;
            rock.style.width = `${size}px`;
            rock.style.height = `${size * 0.6}px`;
            rock.style.left = `${Math.random() * 100}%`;
            rock.style.borderRadius = `${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}% ${Math.random() * 50}%`;
            rocksContainer.appendChild(rock);
        }
    }

    // Layer 6 - Water Ripples
    const ripplesContainer = document.getElementById('stillwater-water-ripples');
    if (ripplesContainer && ripplesContainer.children.length === 0) {
        const rippleCount = 8;
        for (let i = 0; i < rippleCount; i++) {
            const ripple = document.createElement('div');
            ripple.className = 'stillwater-water-ripple';
            ripple.style.left = `${Math.random() * 100}%`;
            ripple.style.top = `${Math.random() * 80 + 10}%`;
            ripple.style.animationDelay = `${Math.random() * 12}s`;
            ripple.style.animationDuration = `${Math.random() * 8 + 10}s`;
            ripplesContainer.appendChild(ripple);
        }
    }

    // Layer 8 - Multi-layer Mist
    ['stillwater-mist-back', 'stillwater-mist-mid', 'stillwater-mist-front'].forEach((id, index) => {
        const mistContainer = document.getElementById(id);
        if (mistContainer && mistContainer.children.length === 0) {
            const mist = document.createElement('div');
            mist.className = `stillwater-mist-layer-${index}`;
            mist.style.animationDelay = `-${index * 15}s`;
            mistContainer.appendChild(mist);
        }
    });

    // Layer 9 - Floating Particles (Dust motes, spores)
    const particlesContainer = document.getElementById('stillwater-particles');
    if (particlesContainer && particlesContainer.children.length === 0) {
        // Dust motes
        const dustCount = 50;
        for (let i = 0; i < dustCount; i++) {
            const dust = document.createElement('div');
            dust.className = 'stillwater-dust-mote';
            const size = Math.random() * 2 + 1;
            dust.style.width = `${size}px`;
            dust.style.height = `${size}px`;
            dust.style.left = `${Math.random() * 100}%`;
            dust.style.top = `${Math.random() * 100}%`;
            dust.style.setProperty('--drift-x', `${Math.random() * 100 - 50}px`);
            dust.style.setProperty('--drift-y', `${Math.random() * 150 - 75}px`);
            dust.style.setProperty('--float-duration', `${Math.random() * 20 + 20}s`);
            dust.style.animationDelay = `${Math.random() * 20}s`;
            particlesContainer.appendChild(dust);
        }

        // Fireflies (mystical blinking lights)
        const fireflyCount = 15;
        for (let i = 0; i < fireflyCount; i++) {
            const firefly = document.createElement('div');
            firefly.className = 'stillwater-firefly';
            const size = Math.random() * 4 + 3;
            firefly.style.width = `${size}px`;
            firefly.style.height = `${size}px`;
            firefly.style.left = `${Math.random() * 100}%`;
            firefly.style.top = `${Math.random() * 80 + 10}%`;
            firefly.style.setProperty('--drift-x', `${Math.random() * 120 - 60}px`);
            firefly.style.setProperty('--drift-y', `${Math.random() * 80 - 40}px`);
            firefly.style.setProperty('--float-duration', `${Math.random() * 15 + 15}s`);
            firefly.style.setProperty('--blink-duration', `${Math.random() * 3 + 2}s`);
            firefly.style.animationDelay = `${Math.random() * 15}s`;
            particlesContainer.appendChild(firefly);
        }

        // Mystical orbs (larger glowing particles)
        const orbCount = 8;
        for (let i = 0; i < orbCount; i++) {
            const orb = document.createElement('div');
            orb.className = 'stillwater-mystical-orb';
            const size = Math.random() * 12 + 8;
            orb.style.width = `${size}px`;
            orb.style.height = `${size}px`;
            orb.style.left = `${Math.random() * 100}%`;
            orb.style.top = `${Math.random() * 70 + 15}%`;
            orb.style.setProperty('--drift-x', `${Math.random() * 150 - 75}px`);
            orb.style.setProperty('--drift-y', `${Math.random() * 100 - 50}px`);
            orb.style.setProperty('--float-duration', `${Math.random() * 25 + 25}s`);
            orb.style.setProperty('--pulse-duration', `${Math.random() * 4 + 3}s`);
            orb.style.animationDelay = `${Math.random() * 20}s`;
            particlesContainer.appendChild(orb);
        }

        // Light rays (mystical beams through mist)
        const rayCount = 5;
        for (let i = 0; i < rayCount; i++) {
            const ray = document.createElement('div');
            ray.className = 'stillwater-light-ray';
            ray.style.left = `${Math.random() * 100}%`;
            ray.style.top = `${Math.random() * 40}%`;
            ray.style.setProperty('--ray-angle', `${Math.random() * 30 - 15}deg`);
            ray.style.setProperty('--ray-duration', `${Math.random() * 10 + 15}s`);
            ray.style.animationDelay = `${Math.random() * 15}s`;
            particlesContainer.appendChild(ray);
        }
    }
}

function createElectricDreamsScene() {
    // 1. Create morphing, glowing veins
    // OPTIMIZATION: Use will-change and transform3d to force GPU compositing
    const veinContainer = document.getElementById('electric-veins');
    if (veinContainer && veinContainer.children.length === 0) {
        const numVeins = 10;
        for (let i = 0; i < numVeins; i++) {
            let vein = document.createElement('div');
            vein.className = 'electric-vein';
            const size = Math.random() * 120 + 80; // 80px to 200px
            vein.style.width = `${size}px`;
            vein.style.height = `${size}px`;

            // Set random animation properties for organic movement
            vein.style.setProperty('--x-start', `${Math.random() * 80 + 10}vw`);
            vein.style.setProperty('--y-start', `${Math.random() * 80 + 10}vh`);
            vein.style.setProperty('--x-end', `${Math.random() * 80 + 10}vw`);
            vein.style.setProperty('--y-end', `${Math.random() * 80 + 10}vh`);
            vein.style.setProperty('--scale-start', `${Math.random() * 0.5 + 0.8}`);
            vein.style.setProperty('--scale-end', `${Math.random() * 0.5 + 0.8}`);
            vein.style.setProperty('--hue-start', `${Math.random() * 360}deg`);
            vein.style.setProperty('--hue-end', `${Math.random() * 360}deg`);

            const moveDuration = Math.random() * 15 + 20; // 20-35s
            const pulseDuration = Math.random() * 2 + 5; // 5-7s
            vein.style.animationDuration = `${moveDuration}s, ${pulseDuration}s, 20s`;
            vein.style.animationDelay = `-${Math.random() * moveDuration}s, -${Math.random() * pulseDuration}s, -${Math.random() * 20}s`;

            // OPTIMIZATION: Force GPU compositing for better performance
            vein.style.willChange = 'transform, filter';
            vein.style.transform = 'translate3d(0,0,0)'; // Force GPU layer

            veinContainer.appendChild(vein);
        }
    }

    // 2. Create glowing particles
    // OPTIMIZATION: Use transform3d and reduce particle count slightly
    const particleContainer = document.getElementById('electric-particles');
    if (particleContainer && particleContainer.children.length === 0) {
        const numParticles = 40; // Reduced from 50 for better performance
        for (let i = 0; i < numParticles; i++) {
            let particle = document.createElement('div');
            particle.className = 'electric-particle';
            const size = Math.random() * 3 + 1;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
            particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
            particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
            particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);

            const duration = Math.random() * 10 + 10; // 10-20s
            particle.style.animationDuration = `${duration}s`;
            particle.style.animationDelay = `-${Math.random() * duration}s`;

            // OPTIMIZATION: Force GPU compositing
            particle.style.willChange = 'transform, opacity';
            particle.style.transform = 'translate3d(0,0,0)';

            particleContainer.appendChild(particle);
        }
    }
}

function createWavesScene() {
    const particleContainer = document.getElementById('waves-particles');
    if (particleContainer && particleContainer.children.length === 0) {
        for (let i = 0; i < 30; i++) {
            let particle = document.createElement('div');
            particle.className = 'wave-particle';
            const size = Math.random() * 2.5 + 1;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.setProperty('--x-start', `${Math.random() * 100}vw`);
            particle.style.setProperty('--y-start', `${Math.random() * 100}vh`);
            particle.style.setProperty('--x-end', `${Math.random() * 100}vw`);
            particle.style.setProperty('--y-end', `${Math.random() * 100}vh`);
            particle.style.animationDelay = `-${Math.random() * 15}s`;
            particleContainer.appendChild(particle);
        }
    }
}

        function createDesertOasisScene() {
            // 1. Stars with shooting stars
            const starsContainer = document.getElementById('desert-stars');
            if (starsContainer && starsContainer.children.length === 0) {
                // Regular twinkling stars
                for (let i = 0; i < 120; i++) {
                    const star = document.createElement('div');
                    star.className = 'desert-star';
                    const size = Math.random() * 2 + 0.5;
                    star.style.width = `${size}px`;
                    star.style.height = `${size}px`;
                    star.style.left = `${Math.random() * 100}%`;
                    star.style.top = `${Math.random() * 70}%`;
                    star.style.setProperty('--twinkle-delay', `${Math.random() * 8}s`);
                    star.style.animationDelay = `-${Math.random() * 12}s`;
                    starsContainer.appendChild(star);
                }

                // Shooting stars
                const createShootingStar = () => {
                    if (activeTheme !== 'desert-oasis') return;
                    const shootingStar = document.createElement('div');
                    shootingStar.className = 'shooting-star';
                    shootingStar.style.left = `${Math.random() * 50 + 25}%`;
                    shootingStar.style.top = `${Math.random() * 30}%`;
                    shootingStar.style.setProperty('--angle', `${Math.random() * 30 + 30}deg`);
                    starsContainer.appendChild(shootingStar);
                    shootingStar.addEventListener('animationend', () => shootingStar.remove());
                    setTimeout(createShootingStar, Math.random() * 30000 + 30000);
                };
                setTimeout(createShootingStar, 15000);
            }

            // 2. Distant Pyramids peeking from behind dunes (WebGL)
            if (webglRenderer) {
                const pyramidCanvas = document.createElement('canvas');
                const C_WIDTH = 3072;
                pyramidCanvas.width = C_WIDTH;
                pyramidCanvas.height = window.innerHeight;
                const ctx = pyramidCanvas.getContext('2d');

                // Draw pyramids at different positions with variety
                const pyramids = [
                    { x: 0.12, scale: 0.65, color: 'rgba(160, 110, 75, 0.5)', yOffset: 0 },
                    { x: 0.25, scale: 0.85, color: 'rgba(170, 120, 80, 0.58)', yOffset: -0.02 },
                    { x: 0.42, scale: 1.1, color: 'rgba(155, 105, 70, 0.62)', yOffset: 0.01 },
                    { x: 0.58, scale: 0.95, color: 'rgba(165, 115, 75, 0.6)', yOffset: -0.01 },
                    { x: 0.73, scale: 0.75, color: 'rgba(175, 125, 85, 0.56)', yOffset: 0.02 },
                    { x: 0.88, scale: 0.9, color: 'rgba(180, 130, 90, 0.54)', yOffset: 0 }
                ];

                pyramids.forEach(pyramid => {
                    const baseX = pyramid.x * C_WIDTH;
                    const baseSize = 280 * pyramid.scale;
                    const height = 220 * pyramid.scale;
                    const baseY = pyramidCanvas.height * (0.65 + pyramid.yOffset); // Position lower so more is hidden by dunes

                    // Draw pyramid body
                    const pyramidGradient = ctx.createLinearGradient(baseX - baseSize / 2, baseY, baseX + baseSize / 2, baseY);
                    pyramidGradient.addColorStop(0, pyramid.color);
                    pyramidGradient.addColorStop(0.5, pyramid.color.replace(/[\d.]+\)$/, (parseFloat(pyramid.color.match(/[\d.]+\)$/)[0]) * 0.85) + ')'));
                    pyramidGradient.addColorStop(1, pyramid.color);

                    ctx.fillStyle = pyramidGradient;
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY - height);
                    ctx.lineTo(baseX + baseSize / 2, baseY);
                    ctx.lineTo(baseX - baseSize / 2, baseY);
                    ctx.closePath();
                    ctx.fill();

                    // Add shadow on right side
                    const shadowGradient = ctx.createLinearGradient(baseX, baseY - height, baseX + baseSize / 2, baseY);
                    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
                    shadowGradient.addColorStop(1, 'rgba(80, 50, 30, 0.35)');
                    ctx.fillStyle = shadowGradient;
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY - height);
                    ctx.lineTo(baseX + baseSize / 2, baseY);
                    ctx.lineTo(baseX, baseY);
                    ctx.closePath();
                    ctx.fill();

                    // Add highlight on left side
                    const highlightGradient = ctx.createLinearGradient(baseX - baseSize / 2, baseY, baseX, baseY - height);
                    highlightGradient.addColorStop(0, 'rgba(255, 240, 200, 0)');
                    highlightGradient.addColorStop(0.3, 'rgba(255, 235, 190, 0.12)');
                    highlightGradient.addColorStop(1, 'rgba(255, 230, 180, 0.08)');
                    ctx.fillStyle = highlightGradient;
                    ctx.beginPath();
                    ctx.moveTo(baseX, baseY - height);
                    ctx.lineTo(baseX - baseSize / 2, baseY);
                    ctx.lineTo(baseX, baseY);
                    ctx.closePath();
                    ctx.fill();
                });

                webglRenderer.addLayer(pyramidCanvas, -0.97);
            }

            // 3. Majestic Sand Dune Layers (WebGL) - Warm golden-orange palette
            if (webglRenderer) {
                const duneLayers = [
                    // Far background dunes - lightest, most hazy, covering pyramids
                    { zIndex: -0.95, count: 10, colors: ['rgba(252, 218, 175, 0.5)', 'rgba(248, 212, 168, 0.48)', 'rgba(250, 220, 180, 0.49)'], height: 0.42, shadowIntensity: 0.08 },
                    // Mid-background dunes - warmer golden tones
                    { zIndex: -0.85, count: 9, colors: ['rgba(242, 192, 142, 0.65)', 'rgba(238, 186, 136, 0.63)', 'rgba(245, 198, 148, 0.64)'], height: 0.58, shadowIntensity: 0.16 },
                    // Mid-foreground dunes - richer amber-gold tones, very tall
                    { zIndex: -0.75, count: 8, colors: ['rgba(228, 165, 110, 0.78)', 'rgba(224, 158, 102, 0.78)', 'rgba(232, 172, 118, 0.76)'], height: 0.75, shadowIntensity: 0.28 },
                    // Foreground dunes - deep burnt orange with strong shadows, most dramatic
                    { zIndex: -0.65, count: 7, colors: ['rgba(215, 142, 88, 0.9)', 'rgba(210, 136, 82, 0.9)', 'rgba(220, 148, 94, 0.88)'], height: 0.88, shadowIntensity: 0.42 }
                ];

                duneLayers.forEach(layer => {
                    const canvas = document.createElement('canvas');
                    const C_WIDTH = 3072;
                    canvas.width = C_WIDTH;
                    canvas.height = window.innerHeight;
                    const ctx = canvas.getContext('2d');

                    // Draw majestic dunes with smooth curves
                    for (let i = 0; i < layer.count; i++) {
                        const x = (i / layer.count) * C_WIDTH + Math.random() * (C_WIDTH / layer.count) * 0.5;
                        const color = layer.colors[Math.floor(Math.random() * layer.colors.length)];

                        // Dune dimensions - wide and sweeping with dramatic height variation
                        const duneWidth = Math.random() * 700 + 500;
                        const duneHeight = (Math.random() * 0.5 + 0.7) * canvas.height * layer.height;

                        // Add organic variation to dune peak position
                        const peakOffset = (Math.random() - 0.5) * duneWidth * 0.15;

                        // Create smooth dune shape with gradient for light side
                        const lightGradient = ctx.createLinearGradient(x - duneWidth / 2, canvas.height - duneHeight, x + peakOffset, canvas.height);
                        lightGradient.addColorStop(0, color);
                        lightGradient.addColorStop(0.5, color.replace(/[\d.]+\)$/, (parseFloat(color.match(/[\d.]+\)$/)[0]) * 0.94) + ')'));
                        lightGradient.addColorStop(0.8, color.replace(/[\d.]+\)$/, (parseFloat(color.match(/[\d.]+\)$/)[0]) * 0.88) + ')'));
                        lightGradient.addColorStop(1, color.replace(/[\d.]+\)$/, (parseFloat(color.match(/[\d.]+\)$/)[0]) * 0.82) + ')'));

                        ctx.fillStyle = lightGradient;
                        ctx.beginPath();
                        ctx.moveTo(x - duneWidth / 2, canvas.height);

                        // More organic curve for windward side using bezier curves
                        const cp1x = x - duneWidth / 2.8 + Math.random() * 30 - 15;
                        const cp1y = canvas.height - duneHeight * 0.4;
                        const cp2x = x - duneWidth / 5 + Math.random() * 20 - 10;
                        const cp2y = canvas.height - duneHeight * 0.85;

                        ctx.bezierCurveTo(
                            cp1x, cp1y,
                            cp2x, cp2y,
                            x + peakOffset,
                            canvas.height - duneHeight
                        );

                        // Sharper curve for leeward side (shadow side)
                        const cp3x = x + peakOffset + duneWidth / 6;
                        const cp3y = canvas.height - duneHeight * 0.6;

                        ctx.quadraticCurveTo(
                            cp3x,
                            cp3y,
                            x + duneWidth / 2,
                            canvas.height
                        );

                        ctx.closePath();
                        ctx.fill();

                        // Add strong shadow on leeward side with richer darker tones
                        const shadowGradient = ctx.createLinearGradient(x + peakOffset, canvas.height - duneHeight, x + duneWidth / 2, canvas.height);
                        shadowGradient.addColorStop(0, `rgba(100, 55, 30, ${layer.shadowIntensity * 1.2})`);
                        shadowGradient.addColorStop(0.4, `rgba(85, 48, 28, ${layer.shadowIntensity * 0.9})`);
                        shadowGradient.addColorStop(1, `rgba(70, 40, 25, ${layer.shadowIntensity * 0.4})`);
                        ctx.fillStyle = shadowGradient;
                        ctx.beginPath();
                        ctx.moveTo(x + peakOffset, canvas.height - duneHeight);
                        ctx.quadraticCurveTo(
                            cp3x,
                            cp3y,
                            x + duneWidth / 2,
                            canvas.height
                        );
                        ctx.lineTo(x + peakOffset, canvas.height);
                        ctx.closePath();
                        ctx.fill();

                        // Add bright highlight on sunlit crest - warmer golden tones
                        const highlightGradient = ctx.createLinearGradient(x + peakOffset - duneWidth / 5, canvas.height - duneHeight, x + peakOffset, canvas.height - duneHeight * 0.96);
                        highlightGradient.addColorStop(0, 'rgba(255, 245, 220, 0.32)');
                        highlightGradient.addColorStop(0.6, 'rgba(255, 240, 210, 0.18)');
                        highlightGradient.addColorStop(1, 'rgba(255, 235, 200, 0)');
                        ctx.fillStyle = highlightGradient;
                        ctx.beginPath();
                        ctx.moveTo(x + peakOffset - duneWidth / 5, canvas.height - duneHeight * 0.96);
                        ctx.bezierCurveTo(
                            cp2x, cp2y * 1.02,
                            x + peakOffset - duneWidth / 8, canvas.height - duneHeight * 0.88,
                            x + peakOffset,
                            canvas.height - duneHeight
                        );
                        ctx.quadraticCurveTo(
                            x + peakOffset - duneWidth / 10,
                            canvas.height - duneHeight * 0.93,
                            x + peakOffset - duneWidth / 5,
                            canvas.height - duneHeight * 0.82
                        );
                        ctx.closePath();
                        ctx.fill();
                    }

                    webglRenderer.addLayer(canvas, layer.zIndex);
                });

                // Add atmospheric haze layers for depth
                const hazeCanvas = document.createElement('canvas');
                hazeCanvas.width = C_WIDTH;
                hazeCanvas.height = window.innerHeight;
                const hazeCtx = hazeCanvas.getContext('2d');

                // Multiple haze layers for atmospheric perspective
                const hazeGradient1 = hazeCtx.createLinearGradient(0, hazeCanvas.height * 0.3, 0, hazeCanvas.height * 0.7);
                hazeGradient1.addColorStop(0, 'rgba(250, 220, 180, 0.12)');
                hazeGradient1.addColorStop(0.5, 'rgba(245, 210, 170, 0.08)');
                hazeGradient1.addColorStop(1, 'rgba(240, 200, 160, 0.02)');
                hazeCtx.fillStyle = hazeGradient1;
                hazeCtx.fillRect(0, hazeCanvas.height * 0.3, hazeCanvas.width, hazeCanvas.height * 0.4);

                // Warmer haze near horizon
                const hazeGradient2 = hazeCtx.createLinearGradient(0, hazeCanvas.height * 0.45, 0, hazeCanvas.height * 0.6);
                hazeGradient2.addColorStop(0, 'rgba(255, 230, 190, 0.15)');
                hazeGradient2.addColorStop(1, 'rgba(250, 220, 180, 0)');
                hazeCtx.fillStyle = hazeGradient2;
                hazeCtx.fillRect(0, hazeCanvas.height * 0.45, hazeCanvas.width, hazeCanvas.height * 0.15);

                webglRenderer.addLayer(hazeCanvas, -0.7);
            }

            // 4. Flying sand particles - golden colored wind effect
            const sandContainer = document.getElementById('desert-sand-particles');
            if (sandContainer && sandContainer.children.length === 0) {
                for (let i = 0; i < 80; i++) {
                    const particle = document.createElement('div');
                    particle.className = 'sand-particle';
                    const startX = Math.random() * 100;
                    const startY = Math.random() * 100;
                    particle.style.setProperty('--x-start', `${startX}vw`);
                    particle.style.setProperty('--y-start', `${startY}vh`);
                    particle.style.setProperty('--x-drift', `${Math.random() * 60 + 30}vw`);
                    particle.style.setProperty('--y-drift', `${Math.random() * 25 - 12}vh`);
                    const duration = Math.random() * 18 + 12;
                    particle.style.animationDuration = `${duration}s`;
                    particle.style.animationDelay = `-${Math.random() * duration}s`;
                    const size = Math.random() * 3 + 0.8;
                    particle.style.width = `${size}px`;
                    particle.style.height = `${size}px`;
                    sandContainer.appendChild(particle);
                }
            }
        }

        function createMistyLakeScene() {
            // Layered mountain silhouettes with more detail
            const mountainLayers = [
                { el: document.getElementById('misty-mountains-back'), color: '#b8c5d6', peaks: 4, height: 0.35, roughness: 0.02 },
                { el: document.getElementById('misty-mountains-mid'), color: '#7a8fa8', peaks: 5, height: 0.45, roughness: 0.03 },
                { el: document.getElementById('misty-mountains-front'), color: '#5a6b7d', peaks: 6, height: 0.55, roughness: 0.04 }
            ];

            mountainLayers.forEach((layer) => {
                if (layer.el && layer.el.children.length === 0) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 4096;
                    canvas.height = window.innerHeight * 0.5;
                    const ctx = canvas.getContext('2d');

                    ctx.fillStyle = layer.color;
                    ctx.beginPath();
                    ctx.moveTo(0, canvas.height);

                    // More natural mountain profile with variation
                    for (let x = 0; x < canvas.width; x += 15) {
                        const progress = (x / canvas.width) * layer.peaks;
                        const baseY = Math.sin(progress * Math.PI) * canvas.height * layer.height;
                        const variation = (Math.sin(x * 0.01) * 0.5 + Math.sin(x * 0.02) * 0.3) * canvas.height * layer.roughness;
                        const y = canvas.height - (baseY + variation);
                        ctx.lineTo(x, y);
                    }

                    ctx.lineTo(canvas.width, canvas.height);
                    ctx.closePath();
                    ctx.fill();

                    canvas.style.position = 'absolute';
                    canvas.style.top = '0';
                    canvas.style.left = '0';
                    canvas.style.width = '200%';
                    canvas.style.height = '100%';
                    layer.el.appendChild(canvas);
                }
            });

            // Drifting clouds
            const cloudsContainer = document.getElementById('misty-clouds');
            if (cloudsContainer && cloudsContainer.children.length === 0) {
                for (let i = 0; i < 6; i++) {
                    const cloud = document.createElement('div');
                    cloud.className = 'misty-cloud';
                    cloud.style.left = `${Math.random() * 120 - 20}%`;
                    cloud.style.top = `${Math.random() * 30 + 5}%`;
                    cloud.style.setProperty('--cloud-drift', `${Math.random() * 30 + 20}vw`);
                    const size = Math.random() * 150 + 100;
                    cloud.style.width = `${size}px`;
                    cloud.style.height = `${size * 0.4}px`;
                    const duration = Math.random() * 200 + 300;
                    cloud.style.animationDuration = `${duration}s`;
                    cloud.style.animationDelay = `-${Math.random() * duration}s`;
                    cloudsContainer.appendChild(cloud);
                }
            }

            // Flying birds in formation
            const birdsContainer = document.getElementById('misty-birds');
            if (birdsContainer && birdsContainer.children.length === 0) {
                for (let i = 0; i < 2; i++) {
                    const formation = document.createElement('div');
                    formation.className = 'bird-formation';
                    formation.style.left = `${Math.random() * 50 - 20}%`;
                    formation.style.top = `${Math.random() * 20 + 10}%`;
                    const duration = Math.random() * 80 + 120;
                    formation.style.animationDuration = `${duration}s`;
                    formation.style.animationDelay = `-${Math.random() * duration}s`;

                    // V-formation of birds (5 birds)
                    for (let j = 0; j < 5; j++) {
                        const bird = document.createElement('div');
                        bird.className = 'misty-bird';
                        const vOffset = Math.abs(j - 2) * 15;
                        bird.style.left = `${j * 25}px`;
                        bird.style.top = `${vOffset}px`;
                        bird.style.animationDelay = `${j * 0.1}s`;
                        formation.appendChild(bird);
                    }
                    birdsContainer.appendChild(formation);
                }
            }

            // Lake reflections (mirror effect)
            const reflectionsContainer = document.getElementById('misty-reflections');
            if (reflectionsContainer && reflectionsContainer.children.length === 0) {
                // Create subtle ripple distortion on reflections
                const rippleOverlay = document.createElement('div');
                rippleOverlay.className = 'reflection-ripple-overlay';
                reflectionsContainer.appendChild(rippleOverlay);
            }

            // Water lilies and reeds
            const liliesContainer = document.getElementById('misty-water-lilies');
            if (liliesContainer && liliesContainer.children.length === 0) {
                for (let i = 0; i < 12; i++) {
                    const lily = document.createElement('div');
                    lily.className = 'water-lily';
                    lily.style.left = `${Math.random() * 80 + 10}%`;
                    lily.style.bottom = `${Math.random() * 30 + 5}%`;
                    lily.style.setProperty('--bob-offset', `${Math.random() * 3 + 1}px`);
                    lily.style.animationDuration = `${Math.random() * 2 + 4}s`;
                    lily.style.animationDelay = `-${Math.random() * 6}s`;
                    liliesContainer.appendChild(lily);
                }
            }

            // Fish creating ripples
            const fishContainer = document.getElementById('misty-fish');
            if (fishContainer && fishContainer.children.length === 0) {
                for (let i = 0; i < 5; i++) {
                    const fish = document.createElement('div');
                    fish.className = 'lake-fish';
                    fish.style.left = `${Math.random() * 100}%`;
                    fish.style.bottom = `${Math.random() * 40 + 10}%`;
                    const duration = Math.random() * 15 + 20;
                    fish.style.animationDuration = `${duration}s`;
                    fish.style.animationDelay = `-${Math.random() * duration}s`;
                    fishContainer.appendChild(fish);
                }
            }

            // Lake ripples (gentle concentric circles)
            const ripplesContainer = document.getElementById('misty-lake-ripples');
            if (ripplesContainer && ripplesContainer.children.length === 0) {
                for (let i = 0; i < 4; i++) {
                    const ripple = document.createElement('div');
                    ripple.className = 'lake-ripple';
                    ripple.style.left = `${Math.random() * 100}%`;
                    ripple.style.bottom = `${Math.random() * 40 + 10}%`;
                    const duration = Math.random() * 5 + 8;
                    ripple.style.animationDuration = `${duration}s`;
                    ripple.style.animationDelay = `-${Math.random() * duration}s`;
                    ripplesContainer.appendChild(ripple);
                }
            }

            // Wispy mist columns rising from lake
            const mistContainer = document.getElementById('misty-mist');
            if (mistContainer && mistContainer.children.length === 0) {
                for (let i = 0; i < 20; i++) {
                    const column = document.createElement('div');
                    column.className = 'mist-column';
                    column.style.left = `${Math.random() * 100}%`;
                    column.style.setProperty('--mist-width', `${Math.random() * 4 + 3}vw`);
                    column.style.animationDuration = `${Math.random() * 25 + 35}s`;
                    column.style.animationDelay = `-${Math.random() * 60}s`;
                    mistContainer.appendChild(column);
                }
            }
        }

        function createBambooGroveScene() {
            // 1. Streamlined bamboo stalks (reduced density)
            ['bamboo-grove-back', 'bamboo-grove-mid', 'bamboo-grove-front'].forEach((layerId, layerIndex) => {
                const container = document.getElementById(layerId);
                if (!container || container.children.length > 0) return;

                const stalksCount = [15, 20, 12][layerIndex];
                const layerDepth = ['back', 'mid', 'front'][layerIndex];

                for (let i = 0; i < stalksCount; i++) {
                    const stalk = document.createElement('div');
                    stalk.className = `bamboo-stalk bamboo-stalk-${layerDepth}`;

                    const height = Math.random() * 250 + (layerIndex === 2 ? 380 : layerIndex === 1 ? 330 : 280);
                    const leftPos = (i / stalksCount * 100) + (Math.random() * 4 - 2);
                    const swayDuration = Math.random() * 3 + 5;
                    const swayAngle = Math.random() * 1.5 + 1;
                    const swayDelay = -Math.random() * swayDuration;

                    stalk.style.height = `${height}px`;
                    stalk.style.left = `${leftPos}%`;
                    stalk.style.setProperty('--sway-angle', `${swayAngle}deg`);
                    stalk.style.animationDuration = `${swayDuration}s`;
                    stalk.style.animationDelay = `${swayDelay}s`;

                    // Add bamboo segments (nodes)
                    const segments = Math.floor(height / 55);
                    for (let s = 0; s < segments; s++) {
                        const segment = document.createElement('div');
                        segment.className = 'bamboo-node';
                        segment.style.top = `${s * 55}px`;
                        stalk.appendChild(segment);
                    }

                    // Add leaves to fewer stalks
                    if (Math.random() > 0.6) {
                        const leafCount = Math.floor(Math.random() * 2) + 1;
                        for (let l = 0; l < leafCount; l++) {
                            const leaf = document.createElement('div');
                            leaf.className = 'bamboo-stalk-leaf';
                            leaf.style.top = `${Math.random() * 25 + 15}%`;
                            leaf.style.setProperty('--leaf-rotation', `${Math.random() * 50 - 25}deg`);
                            leaf.style.animationDelay = `-${Math.random() * 3}s`;
                            stalk.appendChild(leaf);
                        }
                    }

                    container.appendChild(stalk);
                }
            });

            // 2. Reduced sun dapples
            const dappleContainer = document.getElementById('bamboo-sun-dapples');
            if (dappleContainer && dappleContainer.children.length === 0) {
                for (let i = 0; i < 15; i++) {
                    const dapple = document.createElement('div');
                    dapple.className = 'sun-dapple';
                    dapple.style.left = `${Math.random() * 100}%`;
                    dapple.style.top = `${Math.random() * 100}%`;
                    const size = Math.random() * 100 + 70;
                    dapple.style.width = `${size}px`;
                    dapple.style.height = `${size}px`;
                    dapple.style.setProperty('--pulse-scale', Math.random() * 0.25 + 0.9);
                    dapple.style.animationDelay = `-${Math.random() * 12}s`;
                    dappleContainer.appendChild(dapple);
                }
            }

            // 3. Reduced falling leaves
            const leafContainer = document.getElementById('bamboo-leaves');
            if (leafContainer && leafContainer.children.length === 0) {
                for (let i = 0; i < 8; i++) {
                    const leaf = document.createElement('div');
                    leaf.className = 'bamboo-leaf';
                    leaf.style.left = `${Math.random() * 100}%`;
                    leaf.style.setProperty('--r-end', `${Math.random() * 720 - 360}deg`);
                    leaf.style.setProperty('--x-drift', `${Math.random() * 12 - 6}vw`);
                    leaf.style.setProperty('--leaf-scale', Math.random() * 0.4 + 0.8);
                    const duration = Math.random() * 12 + 15;
                    leaf.style.animationDuration = `${duration}s`;
                    leaf.style.animationDelay = `-${Math.random() * duration}s`;
                    leafContainer.appendChild(leaf);
                }
            }

            // 4. Reduced dragonflies
            const faunaContainer = document.getElementById('bamboo-fauna');
            if (faunaContainer && faunaContainer.children.length === 0) {
                for (let i = 0; i < 2; i++) {
                    const dragonfly = document.createElement('div');
                    dragonfly.className = 'dragonfly';

                    const centerX = Math.random() * 50 + 25;
                    const centerY = Math.random() * 40 + 25;
                    for (let j = 1; j <= 8; j++) {
                        const angle = (j / 8) * Math.PI * 2;
                        const radius = 12 + Math.random() * 8;
                        dragonfly.style.setProperty(`--x${j}`, `${centerX + Math.sin(angle * 2) * radius}vw`);
                        dragonfly.style.setProperty(`--y${j}`, `${centerY + Math.sin(angle) * radius * 0.5}vh`);
                    }

                    const duration = Math.random() * 10 + 18;
                    dragonfly.style.animationDuration = `${duration}s`;
                    dragonfly.style.animationDelay = `-${Math.random() * duration}s`;
                    faunaContainer.appendChild(dragonfly);
                }
            }

            // 5. Reduced mist particles
            const mistContainer = document.querySelector('.bamboo-mist');
            if (mistContainer && mistContainer.children.length === 0) {
                for (let i = 0; i < 12; i++) {
                    const mistParticle = document.createElement('div');
                    mistParticle.className = 'mist-particle';
                    mistParticle.style.left = `${Math.random() * 100}%`;
                    mistParticle.style.bottom = `${Math.random() * 25}%`;
                    mistParticle.style.setProperty('--drift-x', `${Math.random() * 40 - 20}vw`);
                    mistParticle.style.setProperty('--drift-y', `${Math.random() * 12 - 6}vh`);
                    const size = Math.random() * 120 + 100;
                    mistParticle.style.width = `${size}px`;
                    mistParticle.style.height = `${size}px`;
                    const duration = Math.random() * 50 + 60;
                    mistParticle.style.animationDuration = `${duration}s`;
                    mistParticle.style.animationDelay = `-${Math.random() * duration}s`;
                    mistContainer.appendChild(mistParticle);
                }
            }

            // 6. Reduced pathway stones
            const pathContainer = document.getElementById('bamboo-path');
            if (pathContainer && pathContainer.children.length === 0) {
                for (let i = 0; i < 5; i++) {
                    const stone = document.createElement('div');
                    stone.className = 'path-stone';
                    stone.style.left = `${i * 18 + 10 + Math.random() * 5}%`;
                    stone.style.bottom = `${6 + Math.random() * 3}%`;
                    const size = Math.random() * 25 + 35;
                    stone.style.width = `${size}px`;
                    stone.style.height = `${size * 0.3}px`;
                    pathContainer.appendChild(stone);
                }
            }
        }

        function startRandomThemeChanger() {
            stopRandomThemeChanger();
            if (settings.backgroundMode !== 'Random' || isGameOver) return;
            randomThemeInterval = setInterval(() => {
                let newTheme;
                do { newTheme = THEMES[Math.floor(Math.random() * THEMES.length)]; } while (newTheme === activeTheme);
                setBackground(newTheme);
            }, 60000);
        }

        function stopRandomThemeChanger() {
            if (randomThemeInterval) clearInterval(randomThemeInterval);
            randomThemeInterval = null;
        }

        function updateBackground(level) {
            if (settings.backgroundMode !== 'Level') return;
            const themeIndex = Math.floor((level - 1) / 2) % THEMES.length;
            setBackground(THEMES[themeIndex]);
        }

        function initSound() { soundManager.init(); soundManager.startBackgroundMusic(); }

        function resetGame() {
            lockedPieces = []; currentPiece = null; nextPieces = [];
            score = 0; lines = 0; level = 1; linesUntilNextLevel = 10;
            dropInterval = LEVEL_SPEEDS[0]; dropCounter = 0; piecesPlaced = 0;
            isGameOver = false; isProcessingPhysics = false; inputQueue = null;
            lastRenderedLevel = 0; // Reset to trigger canvas style update
            startTime = Date.now(); fillBag(); updateStats(); spawnPiece();
            stopRandomThemeChanger();
            if (settings.backgroundMode === 'Specific') {
                setBackground(settings.backgroundTheme);
            } else {
                setBackground('forest');
            }
        }
        function fillBag() { while(nextPieces.length<10) { const bag=[...PIECE_KEYS].sort(()=>Math.random()-0.5); nextPieces.push(...bag); } }
        function spawnPiece() {
            const shapeKey = nextPieces.shift();
            currentPiece = { shapeKey, shape: SHAPES[shapeKey], x: ~~(COLS/2)-~~(SHAPES[shapeKey][0].length/2), y: 0, color: COLORS[shapeKey] };
            fillBag(); drawNextPieces(); piecesPlaced++;
            if (inputQueue) { const a=inputQueue; inputQueue=null; setTimeout(() => { if (a.type==='move') move(a.dir); else if (a.type==='rotate') rotate(a.dir); }, 0); }
            if (!isValidPosition(currentPiece)) gameOver();
        }
        function generateBoard(pieces) {
            const b = Array.from({length:ROWS+HIDDEN_ROWS},()=>Array(COLS).fill(null));
            for (const p of pieces) { p.shape.forEach((r,y)=>r.forEach((v,x) => { if(v>0){ const bx=p.x+x, by=p.y+y; if(by>=0&&by<b.length&&bx>=0&&bx<COLS) b[by][bx]={color:p.shapeKey, id:p.pieceId||p.shapeKey}; } })); } return b;
        }
        function isValidPosition(p, cX=p.x, cY=p.y) {
            const boardData = generateBoard(lockedPieces);
            for (let y=0; y<p.shape.length; y++) for (let x=0; x<p.shape[y].length; x++) if (p.shape[y][x]>0) { const bx=cX+x, by=cY+y; if (bx<0||bx>=COLS||by>=boardData.length||(boardData[by]&&boardData[by][bx]!==null)) return false; } return true;
        }
        function move(dir) { if(!currentPiece||isProcessingPhysics) return; if(isValidPosition(currentPiece, currentPiece.x+dir, currentPiece.y)) { currentPiece.x+=dir; soundManager.playMove(); } }
        function rotate(dir='right') {
            if (!currentPiece||isProcessingPhysics) return; const o=currentPiece.shape;
            let r; if (dir==='right') r=o[0].map((_,i)=>o.map(row=>row[i]).reverse()); else if(dir==='left') r=o[0].map((_,i)=>o.map(row=>row[i])).reverse(); else r=o.map(row=>row.slice().reverse()).reverse();
            currentPiece.shape=r; for(const k of [0,1,-1,2,-2]) { if(isValidPosition(currentPiece, currentPiece.x+k, currentPiece.y)) { currentPiece.x+=k; soundManager.playRotate(); return; } } currentPiece.shape=o;
        }
        function softDrop() { if(!currentPiece||isProcessingPhysics) return; if(isValidPosition(currentPiece, currentPiece.x, currentPiece.y+1)) { currentPiece.y++; score+=level; dropCounter=0; } else lockPiece(); }
        function hardDrop() { if(!currentPiece||isProcessingPhysics) return; let d=0; while(isValidPosition(currentPiece,currentPiece.x,currentPiece.y+1)){currentPiece.y++;d++;} score+=d*2*level; lockPiece(); }
        function lockPiece() { if(!currentPiece) return; soundManager.playDrop(); lockedPieces.push({...currentPiece, shape:[...currentPiece.shape], pieceId: Date.now() + Math.random()}); currentPiece=null; dropCounter=0; processPhysics(); }
async function processPhysics() {
    isProcessingPhysics = true;
    let linesClearedThisTurn = 0;

    while (true) {
        // Phase 1: Line detection and clearing
        const boardData = generateBoard(lockedPieces);
        const fullLines = [];
        for (let y = boardData.length - 1; y >= 0; y--) {
            if (boardData[y].every(cell => cell !== null)) {
                fullLines.push(y);
            }
        }

        if (fullLines.length === 0) {
            break; // No more lines to clear, physics are stable
        }

        // --- Line Clear Animation and Scoring ---
        linesClearedThisTurn += fullLines.length;
        const oldLevel = level;
        lines += fullLines.length;
        linesUntilNextLevel -= fullLines.length;
        if (linesUntilNextLevel <= 0) {
            level++;
            linesUntilNextLevel += 10; // Use += in case of multi-level-up
            dropInterval = LEVEL_SPEEDS[Math.min(level - 1, LEVEL_SPEEDS.length - 1)];
            soundManager.playLevelUp();
            showLevelUpNotification(level);
        }
        if (oldLevel !== level) updateBackground(level);
        score += (SCORE_VALUES[fullLines.length] || SCORE_VALUES[4]) * level;
        soundManager.playLineClear();
        showScorePopup((SCORE_VALUES[fullLines.length] || SCORE_VALUES[4]) * level);

        // --- Visual Feedback ---
        canvas.classList.add('line-flash');
        setTimeout(() => canvas.classList.remove('line-flash'), 200);
        const markedBoard = generateBoard(lockedPieces);
        fullLines.forEach(y => {
            for (let x = 0; x < COLS; x++) markedBoard[y][x] = {color:'C', id:'cleared'};
        });
        board = markedBoard;
        draw();
        await new Promise(resolve => setTimeout(resolve, 200));

        // --- Remove cleared lines from pieces ---
        let newPieces = [];
        lockedPieces.forEach(p => {
            const newShape = [];
            p.shape.forEach((row, localY) => {
                const globalY = p.y + localY;
                if (!fullLines.includes(globalY)) {
                    newShape.push(row);
                }
            });

            if (newShape.length > 0) {
                p.shape = newShape;
                newPieces.push(p);
            }
        });
        lockedPieces = newPieces;

        // Split pieces into individual blocks for independent gravity
        lockedPieces = findConnectedComponents(generateBoard(lockedPieces));

        // Phase 2: Apply gravity to individual blocks
        // Blocks fall independently until stable
        let blocksStillFalling = true;
        while (blocksStillFalling) {
            blocksStillFalling = false;
            const currentBoard = generateBoard(lockedPieces);

            // Process blocks from bottom to top to prevent double-processing
            // Sort pieces by their bottom edge (y + shape.length)
            lockedPieces.sort((a, b) => (b.y + b.shape.length) - (a.y + a.shape.length));

            for (const piece of lockedPieces) {
                // Check if this entire block cluster can fall one row
                let canFall = true;

                piece.shape.forEach((row, localY) => {
                    row.forEach((cell, localX) => {
                        if (cell > 0) {
                            const boardX = piece.x + localX;
                            const boardY = piece.y + localY + 1; // Check one row below

                            // Check boundaries
                            if (boardY >= currentBoard.length) {
                                canFall = false;
                                return;
                            }

                            // Check if there's a block below that's NOT part of this piece
                            if (currentBoard[boardY][boardX] !== null &&
                                !isPartOfPiece(boardX, boardY, piece)) {
                                canFall = false;
                                return;
                            }
                        }
                    });
                });

                if (canFall) {
                    piece.y++;
                    blocksStillFalling = true;
                }
            }

            // Visual feedback for falling blocks
            if (blocksStillFalling) {
                draw();
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // Phase 3: Recursive cascade - continue the loop to check for new lines
        // The while(true) loop will automatically check for new complete lines
    }

    // --- Finalize ---
    isProcessingPhysics = false;
    updateStats();
    spawnPiece();
}
function isPartOfPiece(boardX, boardY, piece) {
    const localX = boardX - piece.x;
    const localY = boardY - piece.y;
    if (localY >= 0 && localY < piece.shape.length && localX >= 0 && localX < piece.shape[0].length) {
        return piece.shape[localY][localX] > 0;
    }
    return false;
}
        function findConnectedComponents(boardData) {
            const pieces=[], visited=Array.from({length:boardData.length},()=>Array(boardData[0].length).fill(false));
            for(let r=0;r<boardData.length;r++) for(let c=0;c<boardData[0].length;c++) {
                if(boardData[r][c]!==null&&!visited[r][c]) {
                    const cellData=boardData[r][c], component=[], queue=[[r,c]]; visited[r][c]=true;
                    let minR=r,maxR=r,minC=c,maxC=c;
                    while(queue.length>0) {
                        const [row,col]=queue.shift(); component.push({r:row,c:col});
                        minR=Math.min(minR,row); maxR=Math.max(maxR,row); minC=Math.min(minC,col); maxC=Math.max(maxC,col);
                        [[-1,0],[1,0],[0,-1],[0,1]].forEach(([dr,dc])=>{ const nr=row+dr,nc=col+dc; if(nr>=0&&nr<boardData.length&&nc>=0&&nc<boardData[0].length&&!visited[nr][nc]&&boardData[nr][nc]!==null&&boardData[nr][nc].id===cellData.id){visited[nr][nc]=true;queue.push([nr,nc]);}});
                    }
                    const shape=Array.from({length:maxR-minR+1},()=>Array(maxC-minC+1).fill(0));
                    component.forEach(({r,c})=>{shape[r-minR][c-minC]=1});
                    pieces.push({x:minC, y:minR, shape, shapeKey:cellData.color, color:COLORS[cellData.color], pieceId:cellData.id});
                }
            }
            return pieces;
        }
        function updateCanvasStyle() {
            // Update canvas border and shadow based on level
            // Only called when level actually changes (optimization)
            if (level>=10) {
                canvas.style.borderColor = '#ef4444';
                canvas.style.boxShadow = '0 0 30px rgba(239, 68, 68, 0.6), 0 0 60px rgba(239, 68, 68, 0.4)';
            }
            else if (level>=5) {
                canvas.style.borderColor = '#fbbf24';
                canvas.style.boxShadow = '0 0 30px rgba(251, 191, 36, 0.6), 0 0 60px rgba(251, 191, 36, 0.4)';
            }
            else {
                canvas.style.borderColor = '#8b5cf6';
                canvas.style.boxShadow = '0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.3)';
            }
            lastRenderedLevel = level;
        }
        function draw() {
            // Only update canvas styles when level changes (performance optimization)
            if (level !== lastRenderedLevel) {
                updateCanvasStyle();
            }
            ctx.clearRect(0,0,canvas.width,canvas.height);
            // Use cached grid instead of redrawing it every frame
            if (gridCache) {
                ctx.drawImage(gridCache, 0, 0);
            }
            const boardData=generateBoard(lockedPieces);
            boardData.forEach((row,y)=>{ if(y<HIDDEN_ROWS)return; row.forEach((cell,x)=>{ if(cell!==null&&cell.color!=='C')drawBlock(x,y-HIDDEN_ROWS,COLORS[cell.color],boardData,false,null,0,0,x,y); else if(cell!==null&&cell.color==='C')drawBlock(x,y-HIDDEN_ROWS,'#ffffff',boardData,false,null,0,0,x,y);});});
            if(currentPiece) {
                let ghostY=currentPiece.y; while(isValidPosition(currentPiece,currentPiece.x,ghostY+1))ghostY++;
                currentPiece.shape.forEach((r,y)=>r.forEach((c,x)=>{ if(c>0&&ghostY+y>=HIDDEN_ROWS)drawBlock(currentPiece.x+x,ghostY+y-HIDDEN_ROWS,'rgba(255,255,255,0.2)',null,true); if(c>0&&currentPiece.y+y>=HIDDEN_ROWS)drawBlock(currentPiece.x+x,currentPiece.y+y-HIDDEN_ROWS,currentPiece.color,null,false,currentPiece.shape,currentPiece.x,currentPiece.y-HIDDEN_ROWS,x,y);}));
            }
        }
        function drawBlock(x,y,c,boardData=null,isGhost=false,shape=null,pieceX=0,pieceY=0,blockX=0,blockY=0) {
            ctx.fillStyle=c; ctx.fillRect(x*BLOCK_SIZE,y*BLOCK_SIZE,BLOCK_SIZE,BLOCK_SIZE);
            if(!isGhost){
                ctx.strokeStyle='rgba(0,0,0,0.7)';
                ctx.lineWidth=2;
                if(shape){
                    if(blockY===0||!shape[blockY-1]||!shape[blockY-1][blockX]){ctx.beginPath();ctx.moveTo(x*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo((x+1)*BLOCK_SIZE,y*BLOCK_SIZE);ctx.stroke();}
                    if(blockY===shape.length-1||!shape[blockY+1]||!shape[blockY+1][blockX]){ctx.beginPath();ctx.moveTo(x*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.lineTo((x+1)*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                    if(blockX===0||!shape[blockY][blockX-1]){ctx.beginPath();ctx.moveTo(x*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo(x*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                    if(blockX===shape[blockY].length-1||!shape[blockY][blockX+1]){ctx.beginPath();ctx.moveTo((x+1)*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo((x+1)*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                }else if(boardData){
                    const by=y+HIDDEN_ROWS;
                    const currentCell=boardData[by]?boardData[by][blockX]:null;
                    const currentId=currentCell?currentCell.id:null;
                    if(by===0||!boardData[by-1]||boardData[by-1][blockX]===null||boardData[by-1][blockX].id!==currentId){ctx.beginPath();ctx.moveTo(blockX*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo((blockX+1)*BLOCK_SIZE,y*BLOCK_SIZE);ctx.stroke();}
                    if(by===boardData.length-1||!boardData[by+1]||boardData[by+1][blockX]===null||boardData[by+1][blockX].id!==currentId){ctx.beginPath();ctx.moveTo(blockX*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.lineTo((blockX+1)*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                    if(blockX===0||boardData[by][blockX-1]===null||boardData[by][blockX-1].id!==currentId){ctx.beginPath();ctx.moveTo(blockX*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo(blockX*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                    if(blockX===boardData[by].length-1||boardData[by][blockX+1]===null||boardData[by][blockX+1].id!==currentId){ctx.beginPath();ctx.moveTo((blockX+1)*BLOCK_SIZE,y*BLOCK_SIZE);ctx.lineTo((blockX+1)*BLOCK_SIZE,(y+1)*BLOCK_SIZE);ctx.stroke();}
                }
            }
        }
        function drawNextPieces() {
            nextCanvases.forEach((canv,idx)=>{
                const ctx2=canv.getContext('2d'); ctx2.clearRect(0,0,canv.width,canv.height);
                if(nextPieces[idx]){
                    const s=SHAPES[nextPieces[idx]], c=COLORS[nextPieces[idx]], bs = BLOCK_SIZE * (idx === 0 ? 0.4 : 0.33), ox=(canv.width-s[0].length*bs)/2, oy=(canv.height-s.length*bs)/2;
                    s.forEach((r,y)=>r.forEach((cell,x)=>{
                        if(cell>0){
                            ctx2.fillStyle=c;
                            ctx2.fillRect(ox+x*bs,oy+y*bs,bs,bs);
                            if(idx===0){
                                const highlightSize = Math.max(1, bs/4);
                                const highlightOffset = Math.max(1, bs/12);
                                ctx2.fillStyle='rgba(255,255,255,0.3)';
                                ctx2.fillRect(ox+x*bs+highlightOffset,oy+y*bs+highlightOffset,highlightSize,highlightSize);
                            }
                            ctx2.strokeStyle='rgba(0,0,0,0.5)';
                            ctx2.lineWidth=Math.max(0.5, bs/15);
                            ctx2.strokeRect(ox+x*bs,oy+y*bs,bs,bs);
                        }
                    }));
                }
            });
        }
        function updateStats() {
            document.getElementById('score').textContent=score; document.getElementById('lines').textContent=lines;
            const lvlEl=document.getElementById('level'); lvlEl.textContent=level; lvlEl.className='stat-value'; if(level>=10)lvlEl.classList.add('danger');else if(level>=5)lvlEl.classList.add('warning');
            document.getElementById('next-level').textContent=linesUntilNextLevel;
            const baseSpd=LEVEL_SPEEDS[0], currSpd=LEVEL_SPEEDS[Math.min(level-1, LEVEL_SPEEDS.length-1)], spdMult=(baseSpd/currSpd).toFixed(1);
            const spdEl=document.getElementById('speed'); spdEl.textContent=`${spdMult}x`; spdEl.className='stat-value'; if(parseFloat(spdMult)>=20)spdEl.classList.add('danger');else if(parseFloat(spdMult)>=5)spdEl.classList.add('warning');
            const elapsed=(Date.now()-startTime)/60000; document.getElementById('bpm').textContent=elapsed>0?~~(piecesPlaced*4/elapsed):0;
        }
        function showScorePopup(p) { const el=document.createElement('div'); el.className='score-popup'; el.textContent=`+${p}`; el.style.left='50%';el.style.top='50%'; const c=document.getElementById('score-popups');c.appendChild(el); setTimeout(()=>c.removeChild(el),1000); }
        function showLevelUpNotification(lvl) {
            const n=document.createElement('div'); n.style.cssText=`position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);font-family:'Orbitron',sans-serif;font-size:32px;font-weight:900;color:#fbbf24;text-shadow:0 0 20px rgba(251,191,36,0.8);animation:levelUp 1.5s ease-out forwards;pointer-events:none;z-index:100;`;
            n.textContent=`LEVEL ${lvl}!`; const s=document.createElement('style'); s.textContent=`@keyframes levelUp{0%{transform:translate(-50%,-50%) scale(0.5);opacity:0;}50%{transform:translate(-50%,-50%) scale(1.2);opacity:1;}100%{transform:translate(-50%,-200%) scale(1);opacity:0;}}`;
            document.head.appendChild(s); const c=document.getElementById('score-popups');c.appendChild(n); setTimeout(()=>{c.removeChild(n);document.head.removeChild(s);},1500);
        }
        function gameLoop(time) {
            if(isGameOver) return;
            if (isPaused) {
                animationId = requestAnimationFrame(gameLoop);
                return;
            }
            const delta=time-lastTime; lastTime=time;
            if(!isProcessingPhysics&&currentPiece){ dropCounter+=delta; if(dropCounter>dropInterval)softDrop(); }
            draw(); updateStats(); animationId=requestAnimationFrame(gameLoop);
        }
        function startGame() {
            document.getElementById('start-modal').classList.remove('visible');
            document.getElementById('game-over-modal').classList.remove('visible');
            resetGame();
            lastTime = performance.now();
            if (animationId) cancelAnimationFrame(animationId);
            if (settings.backgroundMode === 'Random') {
                startRandomThemeChanger();
            }
            animationId = requestAnimationFrame(gameLoop);
        }
        async function gameOver() {
            isGameOver = true;
            stopRandomThemeChanger();
            soundManager.playGameOver();
            const speedMultiplier=(LEVEL_SPEEDS[0]/dropInterval).toFixed(1);

            // Save score to IndexedDB
            try {
                const scoreData = {
                    score: score,
                    lines: lines,
                    level: level,
                    speedMultiplier: parseFloat(speedMultiplier),
                    theme: activeTheme,
                    musicTrack: soundManager.musicTrack
                };

                await highScoreManager.saveScore(scoreData);
                const rank = await highScoreManager.getRank(score);
                const stats = await highScoreManager.getStatistics();
                const topScores = await highScoreManager.getTopScores(10);

                let rankingHTML = '';
                if (rank === 1) {
                    rankingHTML = `<div style="font-size:20px;color:#10b981;margin:10px 0;font-weight:bold;">🏆 NEW HIGH SCORE! 🏆</div>`;
                } else if (rank <= 10) {
                    rankingHTML = `<div style="font-size:16px;color:#fbbf24;margin:10px 0;">Rank: #${rank} in your top 10!</div>`;
                } else {
                    rankingHTML = `<div style="font-size:14px;color:#9ca3af;margin:10px 0;">Personal Rank: #${rank}</div>`;
                }

                const personalBest = stats.highestScore > score ?
                    `<div style="font-size:14px;color:#9ca3af;margin:5px 0;">Personal Best: ${stats.highestScore}</div>` : '';

                document.getElementById('final-stats').innerHTML=`
                    <div style="font-size:24px;margin-bottom:10px;color:#fbbf24;">Score: ${score}</div>
                    ${rankingHTML}
                    ${personalBest}
                    <div style="margin-bottom:5px;">Level ${level} (${speedMultiplier}x speed)</div>
                    <div>Lines Cleared: ${lines}</div>
                    <div style="font-size:12px;color:#9ca3af;margin-top:10px;">Total Games: ${stats.totalGames}</div>
                `;
            } catch (error) {
                console.error('Error saving score:', error);
                document.getElementById('final-stats').innerHTML=`<div style="font-size:24px;margin-bottom:10px;color:#fbbf24;">Score: ${score}</div><div style="margin-bottom:5px;">Level ${level} (${speedMultiplier}x speed)</div><div>Lines Cleared: ${lines}</div>`;
            }

            document.getElementById('game-over-modal').classList.add('visible');
        }

        function pauseGame() {
            if (isGameOver) return;
            isPaused = true;
            document.getElementById('settings-modal').classList.add('visible');
        }

        function resumeGame() {
            if (isGameOver) return;
            isPaused = false;
            lastTime = performance.now();
            document.getElementById('settings-modal').classList.remove('visible');
        }

        function togglePause() {
            if (document.getElementById('settings-modal').classList.contains('visible')) {
                resumeGame();
            } else if (document.getElementById('high-scores-modal').classList.contains('visible')) {
                closeHighScores();
            } else {
                pauseGame();
            }
        }

        function toggleFullScreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
                });
            } else {
                if (document.exitFullscreen) document.exitFullscreen();
            }
        }
        async function showHighScores() {
            if (!isGameOver) {
                isPaused = true;
            }

            try {
                const topScores = await highScoreManager.getTopScores(10);
                const stats = await highScoreManager.getStatistics();

                // Build high scores table
                let scoresHTML = '<h2 style="margin-bottom: 15px; color: #fbbf24;">Top 10 Scores</h2>';
                if (topScores.length === 0) {
                    scoresHTML += '<p style="color: #9ca3af;">No scores yet. Start playing!</p>';
                } else {
                    scoresHTML += '<table style="width: 100%; border-collapse: collapse;">';
                    scoresHTML += '<thead><tr style="border-bottom: 2px solid rgba(255,255,255,0.3);"><th style="text-align: left; padding: 8px;">Rank</th><th style="text-align: right; padding: 8px;">Score</th><th style="text-align: center; padding: 8px;">Level</th><th style="text-align: center; padding: 8px;">Lines</th><th style="text-align: right; padding: 8px;">Date</th></tr></thead><tbody>';

                    topScores.forEach((score, index) => {
                        const date = new Date(score.timestamp);
                        const dateStr = date.toLocaleDateString();
                        const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                        const rowColor = index % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'transparent';

                        scoresHTML += `<tr style="background: ${rowColor};">
                            <td style="padding: 8px; font-weight: bold;">${rankEmoji}</td>
                            <td style="padding: 8px; text-align: right; color: #fbbf24; font-weight: bold;">${score.score.toLocaleString()}</td>
                            <td style="padding: 8px; text-align: center;">${score.level}</td>
                            <td style="padding: 8px; text-align: center;">${score.lines}</td>
                            <td style="padding: 8px; text-align: right; color: #9ca3af; font-size: 12px;">${dateStr}</td>
                        </tr>`;
                    });

                    scoresHTML += '</tbody></table>';
                }

                document.getElementById('high-scores-list').innerHTML = scoresHTML;

                // Build statistics section
                let statsHTML = '<h2 style="margin-bottom: 15px; color: #fbbf24;">Statistics</h2>';
                statsHTML += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">';
                statsHTML += `<div><strong>Total Games:</strong> ${stats.totalGames}</div>`;
                statsHTML += `<div><strong>Highest Score:</strong> ${stats.highestScore.toLocaleString()}</div>`;
                statsHTML += `<div><strong>Total Lines:</strong> ${stats.totalLines.toLocaleString()}</div>`;
                statsHTML += `<div><strong>Highest Level:</strong> ${stats.highestLevel}</div>`;

                if (stats.totalGames > 0) {
                    const avgScore = Math.round(stats.totalScore / stats.totalGames);
                    const avgLines = Math.round(stats.totalLines / stats.totalGames);
                    statsHTML += `<div><strong>Avg Score:</strong> ${avgScore.toLocaleString()}</div>`;
                    statsHTML += `<div><strong>Avg Lines:</strong> ${avgLines}</div>`;
                }

                statsHTML += '</div>';

                document.getElementById('statistics-section').innerHTML = statsHTML;
            } catch (error) {
                console.error('Error loading high scores:', error);
                document.getElementById('high-scores-list').innerHTML = '<p style="color: #ef4444;">Error loading scores</p>';
            }

            document.getElementById('high-scores-modal').classList.add('visible');
        }

        function closeHighScores() {
            if (!isGameOver) {
                isPaused = false;
                lastTime = performance.now();
            }
            document.getElementById('high-scores-modal').classList.remove('visible');
        }

        function setupUI(){
            document.getElementById('settings-btn').addEventListener('click', pauseGame);
            document.getElementById('close-settings').addEventListener('click', resumeGame);
            document.getElementById('high-scores-btn').addEventListener('click', showHighScores);
            document.getElementById('close-high-scores').addEventListener('click', closeHighScores);
            document.getElementById('fullscreen-toggle').addEventListener('click', toggleFullScreen);
            document.getElementById('next-track-btn').addEventListener('click', () => soundManager.nextTrack());
            document.getElementById('random-theme-btn').addEventListener('click', () => {
                let newTheme;
                do { newTheme = THEMES[Math.floor(Math.random() * THEMES.length)]; } while (newTheme === activeTheme);
                setBackground(newTheme);
                if (settings.backgroundMode === 'Specific') {
                    settings.backgroundTheme = newTheme;
                    document.getElementById('background-theme').value = newTheme;
                    saveSettings();
                } else if (settings.backgroundMode === 'Random') {
                    // Restart the random timer when manually triggered
                    startRandomThemeChanger();
                }
            });
            const ds=document.getElementById('das-delay'),dv=document.getElementById('das-delay-value'),is=document.getElementById('das-interval'),iv=document.getElementById('das-interval-value');
            ds.value=settings.dasDelay;dv.textContent=settings.dasDelay; is.value=settings.dasInterval;iv.textContent=settings.dasInterval;
            ds.addEventListener('input',(e)=>{settings.dasDelay=parseInt(e.target.value);dv.textContent=settings.dasDelay;saveSettings();});
            is.addEventListener('input',(e)=>{settings.dasInterval=parseInt(e.target.value);iv.textContent=settings.dasInterval;saveSettings();});
            const mvs=document.getElementById('music-volume'),mvv=document.getElementById('music-volume-value'),svs=document.getElementById('sfx-volume'),svv=document.getElementById('sfx-volume-value');
            mvs.value=settings.musicVolume*100;mvv.textContent=Math.round(settings.musicVolume*100); svs.value=settings.sfxVolume*100;svv.textContent=Math.round(settings.sfxVolume*100);
            mvs.addEventListener('input',(e)=>{settings.musicVolume=parseInt(e.target.value)/100;soundManager.musicVolume=settings.musicVolume;if(soundManager.audioElement){soundManager.audioElement.volume=settings.musicVolume;}mvv.textContent=e.target.value;saveSettings();});
            svs.addEventListener('input',(e)=>{settings.sfxVolume=parseInt(e.target.value)/100;soundManager.sfxVolume=settings.sfxVolume;svv.textContent=e.target.value;saveSettings();});
            const mt=document.getElementById('music-track');
            mt.value=settings.musicTrack;
            mt.addEventListener('change',(e)=>{settings.musicTrack=e.target.value;soundManager.setTrack(settings.musicTrack);saveSettings();});
            const st=document.getElementById('sfx-set');
            st.value=settings.soundSet;
            st.addEventListener('change',(e)=>{settings.soundSet=e.target.value;soundManager.setSoundSet(settings.soundSet);saveSettings();});

            const tlm=document.getElementById('theme-linked-mode');
            tlm.value=settings.themeLinkedMode.toString();
            tlm.addEventListener('change',(e)=>{settings.themeLinkedMode=e.target.value==='true';saveSettings();});

            const bgModeSelect = document.getElementById('background-mode');
            const themeSetting = document.getElementById('theme-setting');
            const bgThemeSelect = document.getElementById('background-theme');

            function setThemeSelectorVisibility(visible) {
                themeSetting.style.display = visible ? 'contents' : 'none';
            }

            bgModeSelect.value = settings.backgroundMode;
            bgThemeSelect.value = settings.backgroundTheme;
            setThemeSelectorVisibility(settings.backgroundMode === 'Specific');

            bgModeSelect.addEventListener('change', (e) => {
                settings.backgroundMode = e.target.value;
                stopRandomThemeChanger();
                if (settings.backgroundMode === 'Specific') {
                    setThemeSelectorVisibility(true);
                    setBackground(settings.backgroundTheme);
                } else {
                    setThemeSelectorVisibility(false);
                    if (settings.backgroundMode === 'Random' && !isGameOver) {
                        startRandomThemeChanger();
                    } else { // Level mode
                        updateBackground(level);
                    }
                }
                saveSettings();
            });

            bgThemeSelect.addEventListener('change', (e) => {
                settings.backgroundTheme = e.target.value;
                if (settings.backgroundMode === 'Specific') {
                    setBackground(settings.backgroundTheme);
                }
                saveSettings();
            });

            const cs = document.getElementById('control-scheme');
            cs.value = settings.controlScheme;
            cs.addEventListener('change', (e) => {
                settings.controlScheme = e.target.value;
                saveSettings();
                updateControlsDisplay();
            });

            document.querySelectorAll('.key-input').forEach(el=>{ const a=el.id.substring(4);el.textContent=settings.keyBindings[a];el.addEventListener('click',()=>listenForKey(el));el.addEventListener('keydown',(e)=>handleKeybinding(e,el)); });
            updateControlsDisplay();
        }
        function listenForKey(el) { document.querySelectorAll('.key-input').forEach(e=>e.classList.remove('listening')); el.classList.add('listening'); el.textContent='Press a key...'; }
        function handleKeybinding(e,el){ e.preventDefault(); const a=el.id.substring(4), k=e.key===' '?'Space':e.key; if(Object.values(settings.keyBindings).includes(k)&&settings.keyBindings[a]!==k){ el.textContent=settings.keyBindings[a];el.classList.remove('listening');return; } settings.keyBindings[a]=k; el.textContent=k; el.classList.remove('listening'); saveSettings(); updateControlsDisplay(); }
        function saveSettings(){localStorage.setItem('serenityBlocksSettings',JSON.stringify(settings));}
        function loadSettings(){ const s=localStorage.getItem('serenityBlocksSettings'); if(s){ const l=JSON.parse(s); settings={...settings,...l}; settings.keyBindings={...settings.keyBindings,...l.keyBindings};} soundManager.musicTrack=settings.musicTrack; soundManager.soundSet=settings.soundSet; soundManager.musicVolume=settings.musicVolume; soundManager.sfxVolume=settings.sfxVolume; }
        function updateControlsDisplay() {
            const l = document.getElementById('controls-list');
            l.innerHTML = '';
            const o = ['moveLeft', 'moveRight', 'rotateRight', 'rotateLeft', 'flip', 'softDrop', 'hardDrop'];
            if (settings.controlScheme === 'Keyboard') {
                document.querySelectorAll('.key-input').forEach(el => el.parentElement.style.display = 'contents');
                o.forEach(a => {
                    if (settings.keyBindings[a]) {
                        const t = a.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                        l.innerHTML += `<div>${t}: ${settings.keyBindings[a]}</div>`;
                    }
                });
            } else {
                 document.querySelectorAll('.key-input').forEach(el => el.parentElement.style.display = 'none');
                 l.innerHTML = '<div>Swipe to move</div><div>Tap to rotate</div><div>Flick down to drop</div>';
            }
        }

        function handleTouchStart(e) {
            if (settings.controlScheme !== 'Touch') return;
            if (e.target.tagName === 'BUTTON' || e.target.classList.contains('key-input') || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            e.preventDefault();
            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchLastX = touch.clientX;
            touchLastY = touch.clientY;
            touchStartTime = Date.now();
        }

        function handleTouchMove(e) {
            if (!touchStartX || settings.controlScheme !== 'Touch') return;
            e.preventDefault();

            const touch = e.touches[0];
            const deltaX = touch.clientX - touchLastX;
            const deltaY = touch.clientY - touchLastY;

            const moveThreshold = BLOCK_SIZE;
            const softDropThreshold = BLOCK_SIZE / 2;

            // Horizontal movement check
            if (Math.abs(deltaX) > moveThreshold) {
                move(deltaX > 0 ? 1 : -1);
                touchLastX = touch.clientX;
            }

            // Vertical movement check
            if (deltaY > softDropThreshold) {
                softDrop();
                touchLastY = touch.clientY;
            }
        }

        function handleTouchEnd(e) {
            if (!touchStartX || settings.controlScheme !== 'Touch') return;
            e.preventDefault();

            if(!soundInitialized){soundInitialized=true;initSound();}
            if (document.getElementById('start-modal').classList.contains('visible') || document.getElementById('game-over-modal').classList.contains('visible')) {
                startGame();
                touchStartX = null; touchStartY = null; touchStartTime = null; lastTap = 0; touchLastX = null; touchLastY = null;
                return;
            }

            const touch = e.changedTouches[0];
            const deltaX = touch.clientX - touchStartX;
            const deltaY = touch.clientY - touchStartY;
            const deltaTime = Date.now() - touchStartTime;

            const tapThreshold = 25;
            const flickTime = 300;
            const flickDistY = 60;

            // It's a tap if the finger moved less than the threshold and the touch was short
            if (deltaTime < flickTime && Math.abs(deltaX) < tapThreshold && Math.abs(deltaY) < tapThreshold) {
                const canvasRect = canvas.getBoundingClientRect();
                const touchXonCanvas = touch.clientX - canvasRect.left;
                if (touchXonCanvas < canvas.width / 2) {
                    rotate('left');
                } else {
                    rotate('right');
                }
            }
            // It's a flick if the touch was short and moved a significant distance
            else if (deltaTime < flickTime) {
                // Vertical flick for hard drop
                if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > flickDistY) {
                    hardDrop();
                }
            }

            touchStartX = null;
            touchStartY = null;
            touchStartTime = null;
            touchLastX = null;
            touchLastY = null;
        }

        let keyMap={};
        document.addEventListener('keydown',(e)=>{
            if(e.key === 'Escape') {
                togglePause();
                return;
            }
            if(!soundInitialized){soundInitialized=true;initSound();}
            if(document.activeElement.classList.contains('key-input'))return;
            if(document.getElementById('start-modal').classList.contains('visible')||document.getElementById('game-over-modal').classList.contains('visible')){startGame();return;}
            if(isGameOver)return; const k=e.key===' '?'Space':e.key, a=Object.keys(settings.keyBindings).find(key=>settings.keyBindings[key]===k);
            if(!a||keyMap[a])return; keyMap[a]=true;
            if(isProcessingPhysics){ if(!inputQueue&&(a==='moveLeft'||a==='moveRight'||a.startsWith('rotate')||a==='flip')){inputQueue={type:a.startsWith('rotate')||a==='flip'?'rotate':'move',dir:a==='moveLeft'?-1:(a==='moveRight'?1:(a==='rotateLeft'?'left':(a==='flip'?'flip':'right')))};}return;}
            switch(a){
                case'moveLeft':move(-1);dasTimer=setTimeout(()=>{dasIntervalTimer=setInterval(()=>move(-1),settings.dasInterval);},settings.dasDelay);break;
                case'moveRight':move(1);dasTimer=setTimeout(()=>{dasIntervalTimer=setInterval(()=>move(1),settings.dasInterval);},settings.dasDelay);break;
                case'softDrop':softDrop();softDropTimer=setInterval(()=>softDrop(),50);break; case'rotateRight':rotate('right');break; case'rotateLeft':rotate('left');break; case'flip':rotate('flip');break;
                case'hardDrop':e.preventDefault();hardDrop();break;
            }
        });
        document.addEventListener('keyup',(e)=>{
            const k=e.key===' '?'Space':e.key, a=Object.keys(settings.keyBindings).find(key=>settings.keyBindings[key]===k);
            if(a)keyMap[a]=false;
            if(a==='moveLeft'||a==='moveRight'){clearTimeout(dasTimer);clearInterval(dasIntervalTimer);dasIntervalTimer=null;dasIntervalTimer=null;}
            if(a==='softDrop'){clearInterval(softDropTimer);softDropTimer=null;}
        });
        document.addEventListener('click',(e)=>{
            console.log('Click detected!', e.target);
            if(!soundInitialized){soundInitialized=true;initSound();}
            if(e.target.tagName==='BUTTON'||e.target.classList.contains('key-input')||e.target.tagName==='SELECT'||e.target.tagName==='INPUT')return;
            if(document.getElementById('start-modal').classList.contains('visible')||document.getElementById('game-over-modal').classList.contains('visible')){
                console.log('Starting game...');
                startGame();
            }
        });
        console.log('Event listeners registered');
        window.addEventListener('load', init);