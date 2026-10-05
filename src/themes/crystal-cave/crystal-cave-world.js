/**
 * Crystal Cave — the composition root.
 *
 * Builds the cave from the authored cavern (rock, crystals, pool, air, event light),
 * frames the camera, and turns the reaction director's envelopes and cues into light:
 * which crystals a lock charges, where a fan leaves the board, which tips the lattice
 * links. Shared by the production theme and the playground, so both draw the same cave.
 */
import * as THREE from 'three/webgpu';
import { createCaveLight } from './crystal-cave-light.js';
import { createGemField } from './crystal-cave-gems.js';
import { createCaveRock } from './crystal-cave-rock.js';
import { createCavePool } from './crystal-cave-water.js';
import { createCaveAir } from './crystal-cave-air.js';
import { SPARK_KIND, createCaveEffects } from './crystal-cave-effects.js';
import { CRYSTAL_CAVE_STAGE_DEPTH, CrystalCaveStage } from './crystal-cave-stage.js';
import { CRYSTAL_CAVE_WAVE_SPEED } from './crystal-cave-reactions.js';
import { resolveCrystalCaveQuality } from './crystal-cave-quality.js';

const FAMILIES = 5;
const GROW_SECONDS = 1.15;
const MAX_ACTIONS = 96;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** World position of a point on a crystal's axis: 0 = root, 1 = apex. */
function alongCrystal(crystal, fraction, target = new THREE.Vector3()) {
    const reach = (crystal.height + crystal.tip) * fraction;
    const apex = Math.max(0, fraction * 2 - 1);
    target.set((crystal.apexX ?? 0) * crystal.radius * apex, reach, (crystal.apexZ ?? 0) * crystal.depth * apex);
    target.applyQuaternion(new THREE.Quaternion(crystal.qx, crystal.qy, crystal.qz, crystal.qw));
    return target.set(target.x + crystal.x, target.y + crystal.y, target.z + crystal.z);
}

export class CrystalCaveWorld {
    constructor({
        scene, camera, assets, quality = 'High',
    }) {
        if (!scene?.add) throw new TypeError('CrystalCaveWorld requires a Three.js scene');
        if (!assets?.geometry) throw new TypeError('CrystalCaveWorld requires the loaded cavern');
        this.scene = scene;
        this.camera = camera;
        this.assets = assets;
        this.quality = resolveCrystalCaveQuality(quality);
        this.poolLevel = assets.meta.poolLevel;
        this.time = 0;
        this.seed = 90210;
        this.disposed = false;
        this.group = new THREE.Group();
        this.group.name = 'Crystal Cave';
        scene.add(this.group);
        this.build();
        this.prepareCamera(camera.aspect || 16 / 9);
        this.reset();
    }

    random() {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
        return this.seed / 4294967296;
    }

    build() {
        const { preset } = this.quality;
        const { assets } = this;
        this.light = createCaveLight();
        this.rock = createCaveRock({
            light: this.light,
            geometry: assets.geometry,
            lightScale: assets.meta.lightScale,
            poolLevel: this.poolLevel,
            relief: preset.relief,
        });
        this.group.add(this.rock.mesh);

        // Small crystals thin out on the lower tiers; everything of size always stays.
        // Drawn nearest first: clusters overlap heavily, and the depth test then spares the
        // traced shader every stone that is hidden behind another.
        const [eyeX, eyeY, eyeZ] = assets.meta.camera.eye;
        const range = (crystal) => Math.hypot(crystal.x - eyeX, crystal.y - eyeY, crystal.z - eyeZ);
        this.crystals = assets.crystals
            .filter((crystal) => crystal.group > 0 || crystal.height >= 2.2 || crystal.seed < preset.druzy)
            .sort((first, second) => range(first) - range(second));
        this.gems = createGemField({
            light: this.light,
            capacity: this.crystals.length,
            bounces: preset.bounces,
            dispersion: preset.dispersion,
            inclusions: preset.inclusions,
        });
        this.gems.setCrystals(this.crystals.map((crystal) => ({ ...crystal, growth: crystal.group === 0 ? 1 : 0 })));
        this.group.add(this.gems.mesh);

        this.pool = createCavePool({
            light: this.light,
            scene: this.scene,
            poolLevel: this.poolLevel,
            reflectionScale: preset.reflectionScale,
            refraction: preset.refraction,
            rings: preset.rings,
        });
        this.group.add(this.pool.mesh);

        this.indexCrystals();
        this.air = createCaveAir({
            light: this.light,
            assets: { ...assets, tips: this.tips },
            wave: this.rock.controls,
            quality: preset,
        });
        this.group.add(this.air.group);

        this.effects = createCaveEffects({ light: this.light, poolLevel: this.poolLevel, quality: preset });
        this.effects.setHandlers({
            arrive: (payload) => this.onMoteArrive(payload),
            splash: (x, z, strength, tint) => this.onSplash(x, z, strength, tint),
        });
        this.group.add(this.effects.group);
        this.stage = new CrystalCaveStage(this.camera);
        this.actions = Array.from({ length: MAX_ACTIONS }, () => ({
            active: false, at: 0, kind: '', a: 0, b: 0, c: 0,
        }));
        this.tintScratch = new THREE.Color();
        this.tintHold = new THREE.Color();
        this.pointA = new THREE.Vector3();
        this.pointB = new THREE.Vector3();
        this.pointC = new THREE.Vector3();
    }

    /** Lookup tables the reactions need: who can be charged, who links, who grows. */
    indexCrystals() {
        const { crystals } = this;
        const boardPoint = new THREE.Vector3(0, 2.5, 11);
        const heart = new THREE.Vector3(3, 4, -96);
        const scratch = new THREE.Vector3();
        this.fromBoard = new Float32Array(crystals.length).fill(-1);
        this.fromHeart = new Float32Array(crystals.length).fill(-1);
        this.body = crystals.map((crystal) => alongCrystal(crystal, 0.28));
        this.tipOf = crystals.map((crystal) => alongCrystal(crystal, 1));
        this.targets = Array.from({ length: FAMILIES * 2 }, () => []);
        this.anySide = [[], []];
        const big = [];
        crystals.forEach((crystal, index) => {
            if (crystal.group !== 0) return;
            scratch.set(crystal.x, crystal.y, crystal.z);
            this.fromBoard[index] = scratch.distanceTo(boardPoint) / CRYSTAL_CAVE_WAVE_SPEED;
            this.fromHeart[index] = scratch.distanceTo(heart) / CRYSTAL_CAVE_WAVE_SPEED;
            const side = crystal.x < 0 ? 0 : 1;
            if (crystal.height >= 3 && crystal.z > -48 && crystal.z < 16) {
                const entry = { index, distance: this.body[index].distanceTo(boardPoint) };
                this.targets[crystal.family * 2 + side].push(entry);
                this.anySide[side].push(entry);
            }
            if (crystal.height >= 6.5) big.push(index);
        });
        [...this.targets, ...this.anySide].forEach((list) => {
            list.sort((first, second) => first.distance - second.distance);
            list.length = Math.min(list.length, 12);
        });
        // Glints: the largest tips first, so a smaller budget keeps the heroes.
        this.tips = crystals
            .map((crystal, index) => ({ crystal, index }))
            .filter(({ crystal }) => crystal.group === 0 && crystal.height > 2.2)
            .sort((first, second) => second.crystal.radius - first.crystal.radius)
            .map(({ crystal, index }) => ({
                x: this.tipOf[index].x,
                y: this.tipOf[index].y,
                z: this.tipOf[index].z,
                size: crystal.radius,
                family: crystal.family,
            }));

        // The lattice: a tree over the big tips grown outward from the player (Prim),
        // so a longer chain reaches deeper into the cave.
        const { beams } = this.quality.preset;
        const nodes = big
            .sort((first, second) => this.tipOf[first].distanceTo(boardPoint) - this.tipOf[second].distanceTo(boardPoint))
            .slice(0, Math.max(2, beams + 1));
        this.lattice = [];
        const joined = [nodes[0]];
        const waiting = nodes.slice(1);
        while (waiting.length > 0 && joined.length > 0 && this.lattice.length < beams) {
            let best = null;
            for (const from of joined) {
                for (const to of waiting) {
                    const span = this.tipOf[from].distanceTo(this.tipOf[to]);
                    if (span < 4) continue;
                    if (!best || span < best.span) best = { from, to, span };
                }
            }
            if (!best) break;
            this.lattice.push(best);
            joined.push(best.to);
            waiting.splice(waiting.indexOf(best.to), 1);
        }

        // Sprout sites, nearest the board first: growth spreads outward over a game.
        const sites = new Map();
        crystals.forEach((crystal, index) => {
            if (crystal.group <= 0) return;
            if (!sites.has(crystal.group)) sites.set(crystal.group, []);
            sites.get(crystal.group).push(index);
        });
        this.sites = [...sites.values()]
            .map((members) => ({
                members,
                x: crystals[members[0]].x,
                z: crystals[members[0]].z,
                family: crystals[members[0]].family,
                growth: 0,
                target: 0,
            }))
            .sort((first, second) => Math.hypot(first.x, first.z - 11) - Math.hypot(second.x, second.z - 11));
        this.heartTip = new THREE.Vector3(3, 18, -96);
        let tallest = 0;
        crystals.forEach((crystal, index) => {
            if (crystal.group === 0 && crystal.z < -85 && crystal.height > tallest) {
                tallest = crystal.height;
                this.heartTip.copy(this.tipOf[index]);
            }
        });
    }

    prepareCamera(aspect) {
        const { camera } = this;
        if (!camera || !Number.isFinite(aspect) || aspect <= 0) return;
        const rest = this.assets.meta.camera;
        this.portrait = aspect < 0.9;
        camera.fov = this.portrait ? 72 : rest.fov;
        camera.aspect = aspect;
        camera.near = 0.2;
        camera.far = 320;
        this.eye = new THREE.Vector3(...rest.eye);
        this.aim = new THREE.Vector3(...rest.target);
        camera.position.copy(this.eye);
        camera.lookAt(this.aim);
        camera.updateProjectionMatrix();
        this.stage?.refresh();
    }

    setBoard(rect) {
        this.stage.setBoard(rect);
    }

    schedule(delay, kind, a = 0, b = 0, c = 0) {
        const slot = this.actions.find((action) => !action.active);
        if (!slot) return;
        slot.active = true;
        slot.at = this.time + delay;
        slot.kind = kind;
        slot.a = a;
        slot.b = b;
        slot.c = c;
    }

    familyTint(family, target = this.tintScratch) {
        return target.copy(this.light.familyColors[clamp(Math.round(family), 0, FAMILIES - 1)]);
    }

    /** A mote reached its crystal: the stone rings, and its tip flashes when the light gets there. */
    onMoteArrive(index) {
        if (!(index >= 0)) return;
        const crystal = this.crystals[index];
        this.gems.pulse(index, this.time, 1.15);
        this.effects.spark(SPARK_KIND.flare, this.body[index], this.pointC.set(0, 0, 0), this.familyTint(crystal.family), {
            life: 0.5, size: crystal.radius * 2.4, strength: 0.9,
        });
        this.schedule(0.5, 'tip', index);
    }

    onSplash(x, z, strength, tint) {
        // A handful of sparks may land together; one ring is enough for each patch of water.
        if (this.time - this.lastSplash < 0.07) return;
        this.lastSplash = this.time;
        this.pool.ring(x, z, this.time, clamp(strength * 2.2, 0.12, 0.5), tint);
    }

    burst(origin, count, speed, tint, options = {}) {
        for (let index = 0; index < count; index += 1) {
            const angle = this.random() * Math.PI * 2;
            const lift = this.random();
            this.pointC.set(
                Math.cos(angle) * speed * (0.4 + this.random() * 0.8) + (options.push ?? 0),
                (0.3 + lift * 1.3) * speed * (options.rise ?? 1),
                Math.sin(angle) * speed * (0.3 + this.random() * 0.5) - speed * 0.35,
            );
            this.effects.spark(SPARK_KIND.burst, origin, this.pointC, tint, {
                life: 0.8 + this.random() * 0.9,
                size: 0.09 + this.random() * 0.13,
                strength: options.strength ?? 0.9,
                gravity: options.gravity ?? 5.5,
                drag: 1.3,
                phase: this.random() * 6.28,
                star: index % 5 === 0 ? 1 : 0,
            });
        }
    }

    shower(count) {
        for (let index = 0; index < count; index += 1) {
            this.pointA.set((this.random() - 0.5) * 62, 14 + this.random() * 9, 6 - this.random() * 44);
            this.pointC.set(0, -1.4 - this.random() * 1.6, 0);
            this.effects.spark(SPARK_KIND.fall, this.pointA, this.pointC, this.familyTint(Math.floor(this.random() * FAMILIES)), {
                life: 3.4 + this.random() * 2.4,
                size: 0.07 + this.random() * 0.1,
                strength: 0.95,
                gravity: 0.9,
                drag: 0.55,
                phase: this.random() * 6.28,
                star: index % 4 === 0 ? 1 : 0,
            });
        }
    }

    /** Turn one cue from the director into light. */
    perform(cue, frame) {
        const { effects, stage } = this;
        if (cue.type === 'lock') {
            const tint = cue.tinted ? this.tintScratch.setRGB(cue.tint[0], cue.tint[1], cue.tint[2], THREE.SRGBColorSpace)
                : this.familyTint(cue.family);
            const lockTint = this.tintHold.copy(tint);
            const side = cue.side < 0 ? 0 : 1;
            const edge = stage.edge(cue.side, cue.row, CRYSTAL_CAVE_STAGE_DEPTH, this.pointA);
            let pool = this.targets[cue.family * 2 + side];
            if (pool.length === 0) pool = this.anySide[side];
            const wanted = Math.min(pool.length, 2 + Math.round(cue.strength * 2.5));
            const start = pool.length > 0 ? Math.floor(this.random() * pool.length) : 0;
            for (let pick = 0; pick < wanted; pick += 1) {
                const target = pool[(start + pick) % pool.length];
                const reach = this.body[target.index].distanceTo(edge);
                for (let twin = 0; twin < 2; twin += 1) {
                    this.pointB.copy(edge);
                    this.pointB.y += (this.random() - 0.5) * 1.4;
                    this.pointC.set(cue.side * (1 + this.random() * 3), 2.5 + this.random() * 4.5, -1 - this.random() * 3);
                    effects.mote(
                        this.pointB,
                        this.body[target.index],
                        0.34 + reach * 0.013 + this.random() * 0.16 + twin * 0.09,
                        lockTint,
                        0.36 + cue.strength * 0.2,
                        twin === 0 ? target.index : -1,
                        this.pointC,
                    );
                }
            }
            this.burst(edge, 5 + Math.round(cue.strength * 9), 3.2 + cue.strength * 3, lockTint, { push: cue.side * 2.6 });
            // A glint where the piece touched down, so the light is seen to leave the board.
            effects.spark(SPARK_KIND.flare, edge, this.pointC.set(0, 0, 0), lockTint, {
                life: 0.42, size: 1.5 + cue.strength * 1.6, star: 1,
            });
            const foot = stage.cell(cue.column, 0, CRYSTAL_CAVE_STAGE_DEPTH, this.pointB);
            this.pool.ring(foot.x, foot.z - 1.5, this.time, 0.45 + cue.strength * 0.75, lockTint);
            if (cue.drop > 0.3) this.shower(Math.round(8 + cue.drop * 26));
        } else if (cue.type === 'wave') {
            const far = cue.count > 0;
            const origin = far ? this.heartTip : stage.centre(CRYSTAL_CAVE_STAGE_DEPTH, this.pointA);
            this.rock.controls.waveOrigin.value.copy(origin);
            this.gems.pulseWave(this.time, far ? this.fromHeart : this.fromBoard, 0.5 + cue.strength * 0.7);
            const white = this.tintScratch.setRGB(0.6, 1, 0.95);
            [[-6.5, 5, 0.12], [6.5, 3, 0.16], [-8, -10, 0.42], [8.5, -13, 0.46], [0, -30, 0.86], [-4, -52, 1.3]]
                .slice(0, Math.max(2, this.pool.slots - 3))
                .forEach(([x, z, delay]) => this.schedule(far ? 1.9 - delay : delay, 'ring', x, z, cue.strength * 0.8));
            this.pool.ring(origin.x, far ? origin.z + 6 : origin.z - 2, this.time, cue.strength, white);
        } else if (cue.type === 'clear') {
            for (const side of [-1, 1]) {
                const edge = stage.edge(side, cue.row, CRYSTAL_CAVE_STAGE_DEPTH, this.pointA);
                effects.fan(edge, side, cue.strength, cue.lines, this.time, this.random());
                this.burst(
                    edge,
                    6 + cue.lines * 5,
                    4 + cue.lines,
                    this.familyTint(Math.floor(this.random() * FAMILIES)),
                    { push: side * 4.5, strength: 1 },
                );
                if (cue.lines >= 4) {
                    this.schedule(0.16, 'fan', side, clamp(cue.row + 0.12, 0, 1), cue.strength * 0.8);
                }
            }
        } else if (cue.type === 'grow') {
            let wanted = cue.count;
            for (const site of this.sites) {
                if (wanted === 0) break;
                if (site.target === 1) continue;
                site.target = 1;
                wanted -= 1;
                this.schedule((cue.count - wanted - 1) * 0.16, 'sprout', this.sites.indexOf(site));
            }
            // A full shore answers with light instead.
            for (; wanted > 0 && this.sites.length > 0; wanted -= 1) {
                this.schedule(wanted * 0.12, 'sprout', Math.floor(this.random() * this.sites.length));
            }
        } else if (cue.type === 'shower') {
            const batch = Math.round(this.quality.preset.sparks * 0.07);
            for (let wave = 0; wave < 4; wave += 1) this.schedule(wave * 0.22, 'shower', batch);
        } else if (cue.type === 'combo') {
            const lit = Math.min(this.lattice.length, Math.ceil(frame.lattice * this.lattice.length + 0.5));
            for (let index = 0; index < lit; index += 1) {
                const link = this.lattice[index];
                this.gems.pulse(link.from, this.time, 0.9);
                this.gems.pulse(link.to, this.time + 0.12, 0.9);
            }
            const newest = this.lattice[Math.max(0, lit - 1)];
            if (newest) {
                this.burst(this.tipOf[newest.to], 8, 2.6, this.familyTint(this.crystals[newest.to].family), { gravity: 2.2 });
                this.effects.spark(
                    SPARK_KIND.flare,
                    this.tipOf[newest.to],
                    this.pointC.set(0, 0, 0),
                    this.familyTint(this.crystals[newest.to].family),
                    { life: 0.7, size: 3.4, star: 1 },
                );
            }
            this.pool.ring(
                cue.count % 2 === 0 ? -7 : 7,
                2 - (cue.count % 5) * 4,
                this.time,
                0.5 + cue.strength * 0.5,
                this.familyTint(cue.count % FAMILIES),
            );
        } else if (cue.type === 'release') {
            // The lattice lets go: each beam falls as a line of sparks.
            this.lattice.forEach((link, index) => {
                if (this.effects.beamLevelOf(index) < 0.15) return;
                for (let step = 0; step < 5; step += 1) {
                    this.pointA.copy(this.tipOf[link.from]).lerp(this.tipOf[link.to], (step + this.random()) / 5);
                    this.pointC.set((this.random() - 0.5) * 1.5, this.random() * 1.2, (this.random() - 0.5) * 1.5);
                    effects.spark(SPARK_KIND.fall, this.pointA, this.pointC, this.familyTint(this.crystals[link.to].family), {
                        life: 2 + this.random() * 1.6, size: 0.1 + this.random() * 0.09, gravity: 2.6, drag: 0.7, phase: this.random() * 6.28,
                    });
                }
            });
        } else if (cue.type === 'spin') {
            const edge = stage.edge(cue.side, cue.row, CRYSTAL_CAVE_STAGE_DEPTH, this.pointA);
            edge.x += cue.side * 3.2;
            const tint = this.tintHold.copy(this.familyTint(cue.family));
            effects.spark(SPARK_KIND.flare, edge, this.pointC.set(0, 0, 0), tint, { life: 0.9, size: 4.2, star: 1 });
            for (let index = 0; index < 20; index += 1) {
                const angle = (index / 20) * Math.PI * 2;
                const speed = 5 + (index % 4) * 1.4;
                // Tangential launch: the sparks leave as a turning wheel.
                this.pointC.set(Math.cos(angle + 1.1) * speed, Math.sin(angle + 1.1) * speed, -1.5);
                this.pointB.set(edge.x + Math.cos(angle) * 0.9, edge.y + Math.sin(angle) * 0.9, edge.z);
                effects.spark(SPARK_KIND.burst, this.pointB, this.pointC, index % 2 ? tint : this.tintScratch.setRGB(1, 1, 1), {
                    life: 1.1 + (index % 3) * 0.2, size: 0.14, gravity: 1.2, drag: 1.7, phase: index,
                });
            }
            this.pool.ring(edge.x, edge.z - 2, this.time, 0.8, tint);
        } else if (cue.type === 'heart') {
            const tint = this.tintHold.copy(this.familyTint(4));
            effects.spark(SPARK_KIND.flare, this.heartTip, this.pointC.set(0, 0, 0), tint, {
                life: 1.6, size: 14 * cue.strength + 6, star: 1,
            });
            this.pointA.copy(this.heartTip);
            this.burst(this.pointA, Math.round(16 + cue.strength * 22), 7, tint, { gravity: 2.5, rise: 1.4 });
        } else if (cue.type === 'wither') {
            this.sites.forEach((site) => { site.target = 0; });
            this.lattice.forEach((_link, index) => this.effects.setBeamTarget(index, 0));
        }
    }

    runAction(action) {
        if (action.kind === 'tip') {
            const crystal = this.crystals[action.a];
            this.effects.spark(SPARK_KIND.flare, this.tipOf[action.a], this.pointC.set(0, 0, 0), this.familyTint(crystal.family), {
                life: 0.55, size: crystal.radius * 3.2 + 0.5, strength: 1, star: 1,
            });
        } else if (action.kind === 'ring') {
            this.pool.ring(action.a, action.b, this.time, action.c, this.tintScratch.setRGB(0.55, 1, 0.94));
        } else if (action.kind === 'fan') {
            const edge = this.stage.edge(action.a, action.b, CRYSTAL_CAVE_STAGE_DEPTH, this.pointA);
            this.effects.fan(edge, action.a, action.c, 4, this.time, this.random());
        } else if (action.kind === 'shower') {
            this.shower(action.a);
        } else if (action.kind === 'sprout') {
            const site = this.sites[action.a];
            if (!site) return;
            const tint = this.tintHold.copy(this.familyTint(site.family));
            this.pointA.set(site.x, this.poolLevel + 0.6, site.z);
            this.burst(this.pointA, 9, 3.4, tint, { gravity: 3, rise: 1.5 });
            this.pool.ring(site.x * 0.86, site.z, this.time, 0.42, tint);
            site.members.forEach((index, order) => this.gems.pulse(index, this.time + order * 0.07, 1.2));
        }
    }

    /**
     * @param {number} time simulation seconds
     * @param {number} dt
     * @param {object} [director] the reaction director; its cues are consumed here
     * @param {{x:number,y:number}} [pointer] smoothed pointer, -1..1
     */
    update(time, dt = 0, director = null, pointer = null) {
        if (this.disposed || !Number.isFinite(time) || !Number.isFinite(dt)) return;
        this.time = time;
        const u = this.light.uniforms;
        u.time.value = time;
        const frame = director?.getFrame?.() ?? null;
        if (frame) {
            u.energy.value = frame.energy;
            u.resonance.value = frame.resonance;
            u.flash.value = frame.flash;
            u.flashColor.value.setRGB(frame.flashColor[0], frame.flashColor[1], frame.flashColor[2], THREE.SRGBColorSpace);
            for (let family = 0; family < FAMILIES; family += 1) u.familyLevel.array[family] = frame.familyLevel[family];
            this.rock.controls.waveRadius.value = frame.wave.radius;
            this.rock.controls.waveStrength.value = frame.wave.strength;
            this.air.controls.worms.value = frame.worms * 1.6 - frame.dim * 0.4;
            this.air.controls.shaft.value = (1 + frame.shaft * 1.3) * (1 - frame.dim * 0.6);
            for (let index = 0; index < director.cueCount; index += 1) this.perform(director.cues[index], frame);
            director.clearCues();
            // The lattice holds as many links as the chain has earned.
            const lit = frame.combo >= 2 ? Math.min(this.lattice.length, Math.ceil(frame.lattice * this.lattice.length + 0.5)) : 0;
            this.lattice.forEach((link, index) => {
                this.effects.setBeamTarget(index, index < lit ? 0.5 + frame.lattice * 0.5 : 0);
            });
        }
        for (const action of this.actions) {
            if (action.active && action.at <= time) {
                action.active = false;
                this.runAction(action);
            }
        }
        // Water drips from the vault whether or not anyone is playing.
        if (this.assets.drips.count > 0 && time >= this.nextDrip) {
            const pick = Math.floor(this.random() * this.assets.drips.count);
            const [x, y, z] = [0, 1, 2].map((axis) => this.assets.drips.positions[pick * 3 + axis]);
            const fall = Math.sqrt(Math.max(0, ((y - this.poolLevel) * 2) / 9.8));
            this.pointA.set(x, y, z);
            this.pointC.set(0, -0.5, 0);
            this.effects.spark(SPARK_KIND.burst, this.pointA, this.pointC, this.tintScratch.setRGB(0.55, 0.95, 1), {
                life: fall + 0.5, size: 0.09, strength: 0.8, gravity: 9.8, drag: 0,
            });
            this.nextDrip = time + 0.9 + this.random() * 2.6;
        }
        // Sprouts grow with a little overshoot and withdraw smoothly.
        for (const site of this.sites) {
            if (site.growth === site.target) continue;
            const step = dt / (site.target > site.growth ? GROW_SECONDS : 1.6);
            site.growth = site.target > site.growth ? Math.min(1, site.growth + step) : Math.max(0, site.growth - step);
            site.members.forEach((index, order) => {
                const local = clamp(site.growth * 1.35 - order * 0.07, 0, 1);
                const eased = 1 - (1 - local) ** 3;
                this.gems.setGrowth(index, eased * (1 + 0.16 * Math.sin(local * Math.PI)));
            });
        }
        this.effects.update(dt);
        this.lattice.forEach((link, index) => {
            this.effects.aimBeam(
                index,
                this.tipOf[link.from],
                this.tipOf[link.to],
                this.light.familyColors[this.crystals[link.from].family],
                this.light.familyColors[this.crystals[link.to].family],
                index * 0.37,
            );
        });

        // A slow drift reveals the depth inside the stones.
        const { camera } = this;
        const sway = this.portrait ? 0.35 : 1;
        camera.position.set(
            this.eye.x + (Math.sin(time * 0.071) * 1.05 + (pointer?.x ?? 0) * 0.6) * sway,
            this.eye.y + Math.sin(time * 0.093 + 1.3) * 0.34 - (pointer?.y ?? 0) * 0.25,
            this.eye.z + Math.sin(time * 0.05) * 0.5,
        );
        camera.lookAt(this.aim.x + camera.position.x * 0.22, this.aim.y, this.aim.z);
    }

    /** Back to the idle cave: no pulses, no sprouts, no light in flight. */
    reset() {
        this.seed = 90210;
        this.time = 0;
        this.nextDrip = 1.5;
        this.lastSplash = -10;
        this.actions.forEach((action) => { action.active = false; });
        this.effects.reset();
        this.pool.reset();
        this.gems.clearPulses();
        this.sites.forEach((site) => {
            site.growth = 0;
            site.target = 0;
            site.members.forEach((index) => this.gems.setGrowth(index, 0));
        });
        const u = this.light.uniforms;
        u.energy.value = 0;
        u.resonance.value = 0;
        u.flash.value = 0;
        u.familyLevel.array.fill(1);
        this.rock.controls.waveRadius.value = -100;
        this.rock.controls.waveStrength.value = 0;
        this.air.controls.worms.value = 0;
        this.air.controls.shaft.value = 1;
    }

    getDiagnostics() {
        return {
            quality: this.quality.name,
            crystals: this.gems.count,
            cavernTriangles: this.assets.meta.counts?.triangles ?? 0,
            sprouts: this.sites.length,
            grown: this.sites.filter((site) => site.growth > 0.5).length,
            lattice: this.lattice.length,
            activeSparks: this.effects.activeSparks(),
            pools: { ...this.effects.counts, rings: this.pool.slots },
            air: this.air.counts,
            reflection: Boolean(this.pool.reflection),
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.effects.dispose();
        this.air.dispose();
        this.pool.dispose();
        this.gems.dispose();
        this.rock.dispose();
        this.light.dispose();
        this.group.removeFromParent();
        this.group.clear();
    }
}
