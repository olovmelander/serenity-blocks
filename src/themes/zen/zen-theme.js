import { BaseTheme } from '../base-theme.js';

export default class ZenTheme extends BaseTheme {
    constructor() {
        super('zen');
        this.rippleTimeouts = [];
        this.smokeTimeouts = [];
    }

    async createScene() {
        // Bamboo stalks
        const bambooContainer = document.getElementById('zen-bamboo-container');
        if (bambooContainer && bambooContainer.children.length === 0) {
            const positions = [5, 12, 18, 85, 92];
            positions.forEach((pos, idx) => {
                const bamboo = document.createElement('div');
                bamboo.className = 'zen-bamboo';
                const height = this.random(250, 450);
                bamboo.style.height = `${height}px`;
                bamboo.style.left = `${pos}%`;
                bamboo.style.setProperty('--sway-angle', `${this.random(1, 3)}deg`);
                bamboo.style.animationDuration = `${this.random(6, 10)}s`;
                bamboo.style.animationDelay = `-${this.random(0, 5)}s`;

                // Add segments
                const numSegments = Math.floor(height / 60);
                for (let i = 1; i <= numSegments; i++) {
                    const segment = document.createElement('div');
                    segment.className = 'bamboo-segment';
                    segment.style.top = `${i * 60}px`;
                    bamboo.appendChild(segment);
                }

                // Add leaves
                const numLeaves = this.random(3, 6);
                for (let i = 0; i < numLeaves; i++) {
                    const leaf = document.createElement('div');
                    leaf.className = 'bamboo-leaf';
                    leaf.style.top = `${this.random(20, height - 40)}px`;
                    leaf.style.left = `${this.random(-5, 15)}px`;
                    leaf.style.animationDuration = `${this.random(3, 5)}s`;
                    leaf.style.animationDelay = `-${this.random(0, 3)}s`;
                    bamboo.appendChild(leaf);
                }

                bambooContainer.appendChild(bamboo);
            });
            this.registerContainer(bambooContainer);
        }

        // Zen stones
        const stonesContainer = document.getElementById('zen-stones-container');
        if (stonesContainer && stonesContainer.children.length === 0) {
            const stoneGroups = [
                { x: 25, y: 60, count: 3 },
                { x: 45, y: 40, count: 5 },
                { x: 70, y: 55, count: 2 },
            ];

            stoneGroups.forEach((group) => {
                for (let i = 0; i < group.count; i++) {
                    const stone = document.createElement('div');
                    stone.className = 'zen-stone';
                    const size = this.random(20, 50);
                    stone.style.width = `${size}px`;
                    stone.style.height = `${size * 0.6}px`;
                    stone.style.left = `${group.x + this.random(-8, 8)}%`;
                    stone.style.top = `${group.y + this.random(-5, 5)}%`;
                    stone.style.transform = `rotate(${this.random(-15, 15)}deg)`;
                    stonesContainer.appendChild(stone);
                }
            });
            this.registerContainer(stonesContainer);
        }

        // Floating lanterns
        const lanternsContainer = document.getElementById('zen-lanterns-container');
        if (lanternsContainer && lanternsContainer.children.length === 0) {
            for (let i = 0; i < 5; i++) {
                const lantern = document.createElement('div');
                lantern.className = 'zen-lantern';
                lantern.style.left = `${this.random(10, 90)}%`;
                lantern.style.top = `${this.random(15, 70)}%`;
                lantern.style.setProperty('--rotation', `${this.random(-5, 5)}deg`);
                lantern.style.animationDuration = `${this.random(4, 7)}s`;
                lantern.style.animationDelay = `-${this.random(0, 4)}s`;

                const glow = document.createElement('div');
                glow.className = 'lantern-glow';

                const body = document.createElement('div');
                body.className = 'lantern-body';
                body.appendChild(glow);

                lantern.appendChild(body);
                lanternsContainer.appendChild(lantern);
            }
            this.registerContainer(lanternsContainer);
        }

        // Magical ambient elements
        const petalsContainer = document.getElementById('petals');
        if (petalsContainer && petalsContainer.children.length === 0) {
            // Stars in twilight sky
            for (let i = 0; i < 40; i++) {
                const star = document.createElement('div');
                star.className = 'zen-star';
                star.style.left = `${this.random(0, 100)}%`;
                star.style.top = `${this.random(0, 40)}%`;
                star.style.animationDuration = `${this.random(3, 6)}s`;
                star.style.animationDelay = `-${this.random(0, 5)}s`;
                petalsContainer.appendChild(star);
            }

            // Fireflies - magical floating lights
            for (let i = 0; i < 15; i++) {
                const firefly = document.createElement('div');
                firefly.className = 'zen-firefly';
                const startX = this.random(0, 100);
                const startY = this.random(30, 80);
                firefly.style.setProperty('--x-start', `${startX}vw`);
                firefly.style.setProperty('--y-start', `${startY}vh`);
                firefly.style.setProperty('--x-drift', `${this.random(-30, 30)}vw`);
                firefly.style.setProperty('--y-drift', `${this.random(-20, 20)}vh`);
                firefly.style.animationDuration = `${this.random(8, 15)}s, ${this.random(2, 4)}s`;
                firefly.style.animationDelay = `-${this.random(0, 10)}s, -${this.random(0, 3)}s`;
                petalsContainer.appendChild(firefly);
            }

            // Meditation orbs - ethereal energy
            for (let i = 0; i < 5; i++) {
                const orb = document.createElement('div');
                orb.className = 'zen-orb';
                orb.style.left = `${this.random(10, 90)}%`;
                orb.style.top = `${this.random(20, 70)}%`;
                orb.style.setProperty('--orb-drift-x', `${this.random(-40, 40)}px`);
                orb.style.setProperty('--orb-drift-y', `${this.random(-40, 40)}px`);
                orb.style.animationDuration = `${this.random(10, 18)}s, ${this.random(4, 7)}s`;
                orb.style.animationDelay = `-${this.random(0, 12)}s, -${this.random(0, 5)}s`;
                petalsContainer.appendChild(orb);
            }

            // Incense smoke near stones
            const smokePositions = [
                { x: 27, y: 65 },
                { x: 48, y: 45 },
                { x: 72, y: 58 },
            ];
            smokePositions.forEach((pos) => {
                const createSmoke = () => {
                    if (!this.isActive) return;
                    const smoke = document.createElement('div');
                    smoke.className = 'zen-incense-smoke';
                    smoke.style.left = `${pos.x}%`;
                    smoke.style.top = `${pos.y}%`;
                    smoke.style.animationDuration = `${this.random(8, 12)}s`;
                    smoke.addEventListener(
                        'animationend',
                        () => {
                            smoke.remove();
                        },
                        { once: true },
                    );
                    petalsContainer.appendChild(smoke);
                    const timeout = setTimeout(createSmoke, this.random(3000, 6000));
                    this.smokeTimeouts.push(timeout);
                };
                createSmoke();
            });
            this.registerContainer(petalsContainer);
        }

        // Water Ripple
        const rippleContainer = document.querySelector('#zen-theme .water-feature');
        if (rippleContainer) {
            const createRipple = () => {
                if (!this.isActive) return;
                const ripple = document.createElement('div');
                ripple.className = 'zen-ripple';
                ripple.style.animationDelay = `${Math.random() * 2}s`;
                ripple.addEventListener(
                    'animationend',
                    () => {
                        ripple.remove();
                    },
                    { once: true },
                );
                rippleContainer.appendChild(ripple);
                const timeout = setTimeout(createRipple, Math.random() * 8000 + 5000);
                this.rippleTimeouts.push(timeout);
            };
            createRipple();
            this.registerContainer(rippleContainer);
        }
    }

    stop() {
        // Clear timeouts
        this.rippleTimeouts.forEach((timeout) => clearTimeout(timeout));
        this.smokeTimeouts.forEach((timeout) => clearTimeout(timeout));
        this.rippleTimeouts = [];
        this.smokeTimeouts = [];
        super.stop();
    }
}
