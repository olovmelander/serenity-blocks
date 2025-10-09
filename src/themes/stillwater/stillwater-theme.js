import { BaseTheme } from '../base-theme.js';

export default class StillwaterTheme extends BaseTheme {
    constructor() {
        super('stillwater');
    }

    async createScene() {
        // NOTE: This is a simplified version - see script.js lines 5767-5954 for full implementation

        // Water Ripples
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
            this.registerContainer(ripplesContainer);
        }

        // Mist layers
        ['stillwater-mist-back', 'stillwater-mist-mid', 'stillwater-mist-front'].forEach((id, index) => {
            const mistContainer = document.getElementById(id);
            if (mistContainer && mistContainer.children.length === 0) {
                const mist = document.createElement('div');
                mist.className = `stillwater-mist-layer-${index}`;
                mist.style.animationDelay = `-${index * 15}s`;
                mistContainer.appendChild(mist);
                this.registerContainer(mistContainer);
            }
        });

        // Layer 1 - Distant Trees (Deep forest background)
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
            this.registerContainer(distantTreesContainer);
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
            this.registerContainer(midTreesContainer);
        }

        // Layer 3 - Close Trees (Defined trunks)
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
            this.registerContainer(closeTreesContainer);
        }

        // Layer 4 - Foreground Trees (Large prominent trunks)
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
            this.registerContainer(foregroundTreesContainer);
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
            this.registerContainer(rocksContainer);
        }

        // Layer 9 - Floating Particles
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

            this.registerContainer(particlesContainer);
        }
    }
}
