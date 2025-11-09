import { BaseTheme } from '../base-theme.js';

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');
        this.meteorPool = [];
        this.meteorsContainer = null;
        this.meteorAnimationFrame = null;
        this.lastMeteorFrameTime = 0;
    }

    async createScene() {
        // Stars
        const starsContainer = document.getElementById('neon-dusk-stars');
        if (starsContainer && starsContainer.children.length === 0) {
            const starCount = 150;
            const fragment = document.createDocumentFragment();
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
                fragment.appendChild(star);
            }
            starsContainer.appendChild(fragment);
            this.registerContainer(starsContainer);
        }

        // Clouds
        const cloudsContainer = document.getElementById('neon-dusk-clouds');
        if (cloudsContainer && cloudsContainer.children.length === 0) {
            const cloudCount = 8;
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < cloudCount; i++) {
                const cloud = document.createElement('div');
                cloud.className = 'neon-dusk-cloud';
                cloud.style.top = `${10 + Math.random() * 50}%`;
                const duration = Math.random() * 40 + 60;
                cloud.style.setProperty('--cloud-duration', `${duration}s`);
                cloud.style.setProperty('--cloud-delay', `-${Math.random() * duration}s`);
                fragment.appendChild(cloud);
            }
            cloudsContainer.appendChild(fragment);
            this.registerContainer(cloudsContainer);
        }

        // Meteors
        const meteorsContainer = document.getElementById('neon-dusk-meteors');
        if (meteorsContainer) {
            this.meteorsContainer = meteorsContainer;
            if (this.meteorPool.length === 0 || meteorsContainer.children.length === 0) {
                this.initializeMeteors(meteorsContainer);
            } else {
                this.resumeMeteorPool();
            }
            this.registerContainer(meteorsContainer);
        }

        // Mountain Silhouettes - Back Layer
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
            this.registerContainer(mountainsBack);
        }

        // Mountain Silhouettes - Mid Layer
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
            this.registerContainer(mountainsMid);
        }

        // Mountain Silhouettes - Front Layer
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
            this.registerContainer(mountainsFront);
        }

        // Floating Neon Particles / Polygons
        const particlesContainer = document.getElementById('neon-dusk-particles');
        if (particlesContainer && particlesContainer.children.length === 0) {
            const particleCount = 40;
            const colors = ['#00ffff', '#ff00ff', '#00ff88', '#ff0088', '#ffff00'];
            const fragment = document.createDocumentFragment();

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
                fragment.appendChild(particle);
            }
            particlesContainer.appendChild(fragment);
            this.registerContainer(particlesContainer);
        }
    }

    stop() {
        this.pauseMeteorPool();
        super.stop();
    }

    cleanup() {
        this.teardownMeteorPool();
        super.cleanup();
    }

    initializeMeteors(container) {
        const meteorCount = 6;
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < meteorCount; i++) {
            const meteor = document.createElement('div');
            meteor.className = 'neon-dusk-meteor';
            meteor.style.animation = 'none';
            meteor.style.left = '0';
            meteor.style.top = '0';
            meteor.style.opacity = '0';
            meteor.style.transform = 'translate3d(-9999px, -9999px, 0) rotate(-45deg)';

            this.meteorPool.push({
                element: meteor,
                active: false,
                elapsed: 0,
                duration: this.random(2.2, 3.5),
                delayRemaining: this.random(0.2, 4),
                startX: 0,
                startY: 0,
                distanceX: 0,
                distanceY: 0,
            });

            fragment.appendChild(meteor);
        }

        container.appendChild(fragment);
        this.startMeteorLoop();
    }

    resumeMeteorPool() {
        this.meteorPool.forEach((meteor) => {
            meteor.active = false;
            meteor.elapsed = 0;
            meteor.delayRemaining = this.random(0.3, 3.5);
            meteor.element.style.opacity = '0';
            meteor.element.style.transform = 'translate3d(-9999px, -9999px, 0) rotate(-45deg)';
        });
        this.startMeteorLoop();
    }

    pauseMeteorPool() {
        this.stopMeteorLoop();
        this.meteorPool.forEach((meteor) => {
            meteor.active = false;
            meteor.elapsed = 0;
            meteor.delayRemaining = this.random(1, 4);
            meteor.element.style.opacity = '0';
        });
    }

    teardownMeteorPool() {
        this.stopMeteorLoop();
        if (!this.meteorPool.length) {
            return;
        }

        if (this.meteorsContainer) {
            this.meteorsContainer.textContent = '';
        }

        this.meteorPool = [];
        this.meteorsContainer = null;
    }

    startMeteorLoop() {
        if (this.meteorAnimationFrame || !this.meteorsContainer) {
            return;
        }

        const tick = (timestamp) => {
            if (!this.meteorAnimationFrame) {
                return;
            }

            if (!this.lastMeteorFrameTime) {
                this.lastMeteorFrameTime = timestamp;
            }

            const delta = Math.min((timestamp - this.lastMeteorFrameTime) / 1000, 0.1);
            this.lastMeteorFrameTime = timestamp;

            if (!this.isActive) {
                this.stopMeteorLoop();
                return;
            }

            this.updateMeteors(delta);
            this.meteorAnimationFrame = requestAnimationFrame(tick);
        };

        this.lastMeteorFrameTime = 0;
        this.meteorAnimationFrame = requestAnimationFrame(tick);
    }

    stopMeteorLoop() {
        if (this.meteorAnimationFrame) {
            cancelAnimationFrame(this.meteorAnimationFrame);
            this.meteorAnimationFrame = null;
        }
        this.lastMeteorFrameTime = 0;
    }

    updateMeteors(delta) {
        this.meteorPool.forEach((meteor) => {
            if (!meteor.active) {
                meteor.delayRemaining -= delta;
                if (meteor.delayRemaining <= 0) {
                    this.activateMeteor(meteor);
                }
                return;
            }

            meteor.elapsed += delta;
            const progress = meteor.elapsed / meteor.duration;

            if (progress >= 1) {
                this.resetMeteor(meteor);
                return;
            }

            const translateX = meteor.startX + meteor.distanceX * progress;
            const translateY = meteor.startY + meteor.distanceY * progress;
            meteor.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) rotate(-45deg)`;
            meteor.element.style.opacity = `${this.computeMeteorOpacity(progress)}`;
        });
    }

    activateMeteor(meteor) {
        if (!this.meteorsContainer) {
            return;
        }

        const width = this.meteorsContainer.offsetWidth || window.innerWidth;
        const height = this.meteorsContainer.offsetHeight || window.innerHeight;
        const startX = this.random(-0.15 * width, width * 0.4);
        const startY = this.random(0, height * 0.6);
        const travelDistance = Math.max(width, height) * this.random(0.9, 1.4);

        meteor.active = true;
        meteor.elapsed = 0;
        meteor.duration = this.random(2.2, 3.6);
        meteor.startX = startX;
        meteor.startY = startY;
        meteor.distanceX = travelDistance;
        meteor.distanceY = travelDistance;
        meteor.element.style.opacity = '0';
        meteor.element.style.transform = `translate3d(${startX}px, ${startY}px, 0) rotate(-45deg)`;
    }

    resetMeteor(meteor) {
        meteor.active = false;
        meteor.elapsed = 0;
        meteor.delayRemaining = this.random(1.2, 4.2);
        meteor.element.style.opacity = '0';
    }

    computeMeteorOpacity(progress) {
        if (progress <= 0.1) {
            return progress / 0.1; // Fade in to 1 by 10%
        }

        if (progress >= 0.9) {
            return ((1 - progress) / 0.1) * 0.5; // 90% -> 0.5, 100% -> 0
        }

        const normalized = (progress - 0.1) / 0.8; // 0 at 10%, 1 at 90%
        return 1 - normalized * 0.5;
    }
}
