import { BaseTheme } from '../base-theme.js';

export default class NeonDuskTheme extends BaseTheme {
    constructor() {
        super('neon-dusk');
        this.meteorInterval = null;
    }

    async createScene() {
        // Stars
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
            this.registerContainer(starsContainer);
        }

        // Clouds
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
            this.registerContainer(cloudsContainer);
        }

        // Meteors
        const meteorsContainer = document.getElementById('neon-dusk-meteors');
        if (meteorsContainer && meteorsContainer.children.length === 0) {
            const meteorCount = 6;

            // Function to spawn meteors periodically
            const spawnMeteor = () => {
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
            this.meteorInterval = setInterval(() => {
                spawnMeteor();
            }, 4000);

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
            this.registerContainer(particlesContainer);
        }
    }

    stop() {
        if (this.meteorInterval) {
            clearInterval(this.meteorInterval);
            this.meteorInterval = null;
        }
        super.stop();
    }
}
