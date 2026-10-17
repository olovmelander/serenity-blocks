/**
 * @fileoverview Waystones HUD: the panel beside the well while a road is walked.
 *
 * It shows what WaystonesMode publishes on EVENTS.WAYSTONES_STATE (the stop, its climate
 * and goal, the lanterns, the charms, the road) and sends the between-stops choices back
 * on EVENTS.WAYSTONES_COMMAND: bank or release the stack, take a charm or pass, relight a
 * lantern, choose the next world; set out again once the road has ended. Styles:
 * public/styles/waystones.css.
 *
 * Keys: the sheet's buttons are reached with Tab and pressed with Enter; after each choice
 * the focus lands on the next step's heading, never on a button, so a held Enter cannot
 * choose for you. Enter alone sets out again once the road has ended. The piece keys stay
 * the board's.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { escapeHtml } from '../../utils/dom-safety.js';
import { csIcon } from '../components/cosmic-icons.js';
import { goalText } from '../../core/waystones/climates.js';

/** A click right after the panel re-rendered would land on whatever took the pressed button's place. */
const CLICK_GRACE_MS = 250;

const format = (n) => Number(n || 0).toLocaleString('en-US');
const plural = (count, one, many) => `${format(count)} ${count === 1 ? one : many}`;
const key = (label) => `<kbd class="sb-kbd" data-key aria-hidden="true">${escapeHtml(label)}</kbd>`;
const check = () => csIcon('check', 14, 'btn-icon-svg');

function modifierChips(climate) {
    if (!climate.modifiers.length) return '<span class="ws-chip ws-chip--plain">No rules bent</span>';
    return climate.modifiers.map((modifier) => (
        `<span class="ws-chip" title="${escapeHtml(modifier.description)}">${escapeHtml(modifier.name)}</span>`
    )).join('');
}

function lanternsHtml(state) {
    const lit = Array.from({ length: state.lanternsMax }, (_, index) => (
        `<i class="ws-lantern${index < state.lanterns ? ' is-lit' : ''}" aria-hidden="true"></i>`
    )).join('');
    const label = `${plural(state.lanterns, 'lantern', 'lanterns')} lit of ${state.lanternsMax}`;
    return `<p class="ws-lanterns" role="img" aria-label="${label}">${lit}</p>`;
}

function roadHtml(state) {
    return `<ol class="ws-road" aria-label="The road">${state.road.map((stop) => {
        let label = stop.keeper ? 'Keeper' : `Stop ${stop.index + 1}`;
        if (stop.worldName) label = escapeHtml(stop.worldName);
        return `<li class="ws-road__stop is-${stop.state}${stop.keeper ? ' is-keeper' : ''}" title="${label}">
            <i aria-hidden="true"></i><span class="ws-road__name">${label}</span></li>`;
    }).join('')}</ol>`;
}

function progressHtml(goal) {
    const share = Math.max(0, Math.min(1, goal.progress / goal.target));
    const done = goal.progress >= goal.target;
    return `<div class="ws-progress${done ? ' is-done' : ''}" role="progressbar" aria-label="${escapeHtml(goal.text)}"
            aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${Math.min(goal.progress, goal.target)}">
            <div class="ws-bar"><i style="width:${Math.round(share * 100)}%"></i></div>
            <span class="ws-progress__count">${format(Math.min(goal.progress, goal.target))} / ${format(goal.target)}</span>
        </div>`;
}

function charmsHtml(state) {
    if (!state.charms.length) return '<p class="ws-muted">No charms yet.</p>';
    return `<ul class="ws-charms">${state.charms.map((charm) => (
        `<li class="ws-chip ws-chip--charm" title="${escapeHtml(charm.line)}">${escapeHtml(charm.name)}</li>`
    )).join('')}</ul>`;
}

/** The stack: bank it (it pays once the next stop is cleared) or release it. */
function stackHtml(between) {
    if (between.autoReleased) return `<p class="ws-settled">${check()} The well was empty. Nothing to bank.</p>`;
    if (!between.settled) {
        const why = between.tooTall ? '<p class="ws-muted">The stack reaches the roof; it cannot be carried.</p>' : '';
        return `<div class="ws-choice">
            <button type="button" class="sb-btn sb-btn--primary" data-ws="bank" ${between.canBank ? '' : 'disabled'}>
                ${csIcon('line-stack', 14, 'btn-icon-svg')}<span>Bank it</span>
                <small>${plural(between.stackRows, 'row', 'rows')} · pays ${format(between.tollIfBanked)} when cleared</small>
            </button>
            <button type="button" class="sb-btn sb-btn--quiet" data-ws="release">
                ${csIcon('wave', 14, 'btn-icon-svg')}<span>Release it</span><small>An empty well</small>
            </button>
        </div>
        ${why}
        <p class="ws-muted">A banked stack raises the next stop's ask and pays once that stop is cleared. A released one asks its usual.</p>`;
    }
    if (between.banked) {
        return `<p class="ws-settled">${check()} Banked ${plural(between.carriedRows, 'row', 'rows')} · pays ${format(between.toll)} when the next stop is cleared.</p>`;
    }
    return `<p class="ws-settled">${check()} Released. The well is empty.</p>`;
}

function charmHtml(state, between) {
    if (!between.charmSettled) {
        return `<div class="ws-draft">${between.draft.map((entry) => (
            `<button type="button" class="ws-card" data-ws="charm" data-charm="${escapeHtml(entry.id)}">
                <b>${escapeHtml(entry.name)}</b><span>${escapeHtml(entry.line)}</span></button>`
        )).join('')}
            <button type="button" class="sb-btn sb-btn--quiet ws-pass" data-ws="skip-charm"><span>Pass</span></button>
        </div>`;
    }
    if (between.charmTaken) {
        const taken = state.charms.find((entry) => entry.id === between.charmTaken);
        return `<p class="ws-settled">${csIcon('star', 14, 'btn-icon-svg')} ${escapeHtml(taken?.name || between.charmTaken)}: ${escapeHtml(taken?.line || '')}</p>`;
    }
    return '<p class="ws-settled">No charm this time.</p>';
}

/** Points buy a lantern back, once between stops. */
function relightHtml(state, between) {
    const { relight } = between;
    if (relight.why === 'done') return `<p class="ws-settled">${csIcon('candle', 14, 'btn-icon-svg')} A lantern relit.</p>`;
    if (relight.why === 'full') return '<p class="ws-settled">All lanterns are lit.</p>';
    const short = relight.why === 'short' ? ` · you have ${format(state.score)}` : '';
    return `<button type="button" class="sb-btn sb-btn--quiet ws-relight" data-ws="relight" ${relight.can ? '' : 'disabled'}>
            ${csIcon('candle', 14, 'btn-icon-svg')}<span>Relight a lantern</span>
            <small>${format(relight.cost)} points${short}</small>
        </button>`;
}

/** An offer card leads with the weather, which is what changes; the world is its eyebrow. */
function offerHtml(offer, between) {
    const ready = between.settled && between.charmSettled;
    let ask = null;
    if (between.settled) ask = between.banked ? offer.goalIfBanked : offer.goalIfReleased;
    const askHtml = ask
        ? `<em>${escapeHtml(goalText(ask))}</em>`
        : `<em>Banked: ${escapeHtml(goalText(offer.goalIfBanked))} · Released: ${escapeHtml(goalText(offer.goalIfReleased))}</em>`;
    return `<button type="button" class="ws-card ws-card--world" data-ws="choose" data-offer="${offer.index}" ${ready ? '' : 'disabled'}>
            ${between.sameWorld ? '' : `<span class="ws-card__world">${escapeHtml(offer.world.name)}</span>`}
            <b>${escapeHtml(offer.climate.name)} <small>· ${escapeHtml(offer.climate.pace)}</small></b>
            ${askHtml}
            <span class="ws-card__climate">${escapeHtml(offer.climate.line)}</span>
            <span class="ws-card__chips">${modifierChips(offer.climate)}</span>
        </button>`;
}

/** The stack, a charm, a lantern, the world: four steps in that order. */
function betweenHtml(state) {
    const { between } = state;
    const ready = between.settled && between.charmSettled;
    const worldLabel = between.keeperNext ? 'The Keeper\'s stop' : 'The next world';
    const paid = state.lastPayout > 0
        ? `<p class="ws-settled">${check()} The banked stack paid ${format(state.lastPayout)}.</p>` : '';
    return `<section class="ws-between" aria-label="Between stops">
            ${paid}
            <h3 class="ws-label ws-step" tabindex="-1" data-step="stack">The stack</h3>
            ${stackHtml(between)}
            <h3 class="ws-label ws-step" tabindex="-1" data-step="charm">A charm</h3>
            ${charmHtml(state, between)}
            <h3 class="ws-label ws-step" tabindex="-1" data-step="lantern">A lantern</h3>
            ${relightHtml(state, between)}
            <h3 class="ws-label ws-step" tabindex="-1" data-step="world">${worldLabel}</h3>
            ${between.keeperNext ? '<p class="ws-muted">The Keeper asks half again as much.</p>' : ''}
            ${between.sameWorld ? `<p class="ws-muted">Both roads lead through ${escapeHtml(between.offers[0].world.name)}.</p>` : ''}
            <div class="ws-offers">${between.offers.map((offer) => offerHtml(offer, between)).join('')}</div>
            ${ready ? '' : '<p class="ws-muted">Settle the stack and the charm first.</p>'}
        </section>`;
}

function endedHtml(state) {
    const { ended } = state;
    const title = ended.won ? 'The Keeper\'s light' : 'The road ends here';
    const line = ended.won
        ? `Five stops, ${plural(ended.uniqueWorlds, 'world', 'worlds')}, ${plural(ended.bankedRows, 'row', 'rows')} carried.`
        : `The last lantern went out at stop ${state.stopIndex + 1} of ${state.stopCount}.`;
    const facts = [
        ['Stops', `${ended.stopsCleared} / ${ended.stopCount}`],
        ['Road score', format(ended.score)],
        ['Banked', `${plural(ended.bankedRows, 'row', 'rows')} · paid ${format(ended.toll)}`],
        ['Relit', plural(ended.relights, 'lantern', 'lanterns')],
        ['Charms', ended.charms.length ? state.charms.map((charm) => escapeHtml(charm.name)).join(', ') : 'none'],
        ['Road', escapeHtml(ended.seed)],
    ];
    return `<section class="ws-ended ws-ended--${ended.won ? 'won' : 'lost'}" aria-label="The road's end">
            <h3 class="ws-ended__title" tabindex="-1">${title}</h3>
            <p class="ws-muted">${line}</p>
            <dl class="ws-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            <div class="ws-actions">
                <button type="button" class="sb-btn sb-btn--primary" data-ws="again">
                    ${csIcon('cycle', 14, 'btn-icon-svg')}<span>Set out again</span>${key('Enter')}
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-ws="again-same" data-seed="${escapeHtml(ended.seed)}">
                    ${csIcon('prev', 14, 'btn-icon-svg')}<span>Walk this road again</span>
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-ws="menu">
                    ${csIcon('home', 14, 'btn-icon-svg')}<span>Menu</span>
                </button>
            </div>
        </section>`;
}

class WaystonesHud {
    constructor() {
        this.panel = null;
        this.live = null;
        this.content = null;
        this.stage = null;
        this.state = null;
        this.renderedAt = 0;
        eventBus.on(EVENTS.WAYSTONES_STATE, (state) => this.onState(state));
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
    }

    onState(state) {
        if (!state?.active) {
            this.hide();
            return;
        }
        const previous = this.state;
        this.state = state;
        this.render();
        this.announce(previous);
    }

    mount() {
        if (this.panel?.isConnected) return true;
        this.stage = document.querySelector('.single-player-stage');
        if (!this.stage) return false;
        this.panel = document.createElement('aside');
        this.panel.className = 'ws-panel';
        this.panel.setAttribute('aria-label', 'Waystones road');
        this.panel.addEventListener('click', (event) => this.onClick(event));
        // Space belongs to the board (the drop), never to a focused panel button.
        this.panel.addEventListener('keydown', (event) => {
            if (event.key === ' ' && event.target?.closest?.('button')) {
                event.preventDefault();
                event.target.blur();
            }
        });
        this.live = document.createElement('p');
        this.live.className = 'ws-live';
        this.live.setAttribute('aria-live', 'polite');
        this.panel.appendChild(this.live);
        this.content = document.createElement('div');
        this.content.className = 'ws-panel__content';
        this.panel.appendChild(this.content);
        this.stage.appendChild(this.panel);
        return true;
    }

    hide() {
        this.state = null;
        this.panel?.remove();
        this.panel = null;
        this.live = null;
        this.content = null;
        if (this.stage) {
            delete this.stage.dataset.waystones;
            delete this.stage.dataset.waystonesPhase;
            delete this.stage.dataset.mist;
        }
        this.showLedger(true);
    }

    /** Single Player's ledger means little on the road: the panel carries the score. */
    showLedger(visible) {
        const ledger = this.stage?.querySelector('.single-player-stats-bar');
        if (!ledger) return;
        if (visible) {
            ledger.style.removeProperty('display');
            ledger.removeAttribute('aria-hidden');
        } else {
            ledger.style.setProperty('display', 'none', 'important');
            ledger.setAttribute('aria-hidden', 'true');
        }
    }

    announce(previous) {
        const { state, live } = this;
        if (!state || !live) return;
        let text = '';
        if (state.phase === 'between' && previous?.phase !== 'between') {
            text = `Stop ${state.stopIndex + 1} cleared. Settle the stack, then choose the next world.`;
        } else if (state.phase === 'ended' && previous?.phase !== 'ended') {
            text = state.ended.won ? 'The Keeper\'s light. The road is walked.' : 'The last lantern went out.';
        } else if (state.phase === 'play' && (!previous || previous.stopIndex !== state.stopIndex || previous.phase !== 'play')) {
            text = `Stop ${state.stopIndex + 1}, ${state.world.name}. ${state.climate.name}: ${state.goal.text}.`;
        } else if (state.lastLantern && state.lastLantern !== previous?.lastLantern) {
            text = state.lastLantern.forgiven ? 'The hearth kept the lantern lit.' : `A lantern went out. ${plural(state.lanterns, 'lantern', 'lanterns')} left.`;
        }
        if (text) live.textContent = text;
    }

    /** Where the keyboard rests after a render: the pressed control if it is still there, else the step's heading. */
    settleFocus(focused) {
        const { state, content } = this;
        const pressed = focused ? content.querySelector(`[data-ws="${focused}"]`) : null;
        if (pressed && !pressed.disabled) {
            pressed.focus?.({ preventScroll: true });
            return;
        }
        if (state.phase === 'between') {
            let step = 'world';
            if (!state.between.settled) step = 'stack';
            else if (!state.between.charmSettled) step = 'charm';
            content.querySelector(`.ws-step[data-step="${step}"]`)?.focus?.({ preventScroll: true });
        } else if (state.phase === 'ended') {
            content.querySelector('.ws-ended__title')?.focus?.({ preventScroll: true });
        }
    }

    render() {
        const { state } = this;
        if (!state || !this.mount()) return;
        this.stage.dataset.waystones = 'on';
        // Portrait reserves a taller strip for the sheet of choices and the summary.
        this.stage.dataset.waystonesPhase = state.phase;
        if (state.mist && state.phase === 'play') this.stage.dataset.mist = 'on';
        else delete this.stage.dataset.mist;
        this.showLedger(false);
        const focused = document.activeElement?.closest?.('[data-ws]')?.dataset.ws;
        const eyebrow = state.keeper ? 'The Keeper\'s stop' : `Stop ${state.stopIndex + 1} of ${state.stopCount}`;
        let body = '';
        if (state.switching) {
            body = `<section class="ws-switching"><p class="ws-muted">Setting out for ${escapeHtml(state.world.name)}…</p></section>`;
        } else if (state.phase === 'between') {
            body = betweenHtml(state);
        } else if (state.phase === 'ended') {
            body = endedHtml(state);
        } else if (state.lastLantern) {
            body = `<section class="ws-note"><p class="ws-muted">${state.lastLantern.forgiven
                ? 'The hearth kept the lantern lit. The well is clear; the stop asks its usual.'
                : `A lantern went out. The well is clear; the stop asks its usual. ${plural(state.lanterns, 'lantern', 'lanterns')} left.`}</p></section>`;
        }
        let carried = '';
        if (state.carriedRows) {
            carried = `<p class="ws-muted">${plural(state.carriedRows, 'row', 'rows')} carried in`
                + `${state.carriedToll ? ` · pays ${format(state.carriedToll)} when cleared` : ''}.</p>`;
        }
        this.content.innerHTML = `
            <header class="ws-head">
                <p class="ws-eyebrow">${eyebrow} · ${escapeHtml(state.world.name)}</p>
                <h2 class="ws-title">${escapeHtml(state.climate.name)}</h2>
                <p class="ws-line">${escapeHtml(state.climate.line)}</p>
                <p class="ws-chips">${modifierChips(state.climate)}</p>
            </header>
            <section class="ws-goal">
                <p class="ws-label">Goal</p>
                <p class="ws-goal__text">${escapeHtml(state.goal.text)}</p>
                ${progressHtml(state.goal)}
                ${carried}
            </section>
            <section class="ws-run">
                <div class="ws-run__row"><p class="ws-label">Lanterns</p>${lanternsHtml(state)}</div>
                <div class="ws-run__row"><p class="ws-label">Road score</p><p class="ws-score">${format(state.score)}</p></div>
                <p class="ws-label">Charms</p>${charmsHtml(state)}
            </section>
            ${body}
            <nav class="ws-road-strip">${roadHtml(state)}</nav>`;
        this.renderedAt = performance.now();
        this.settleFocus(focused);
    }

    send(type, extra = {}) {
        eventBus.emit(EVENTS.WAYSTONES_COMMAND, { type, ...extra });
    }

    /** Nothing here acts while a sheet (pause, settings) or the Hub covers the game. */
    covered() {
        return Boolean(document.querySelector('.modal.visible')) || document.body.classList.contains('serenity-hub-open');
    }

    onClick(event) {
        const button = event.target.closest?.('[data-ws]');
        if (!button || button.disabled) return;
        if (event.detail > 0 && performance.now() - this.renderedAt < CLICK_GRACE_MS) return;
        const action = button.dataset.ws;
        if (action === 'menu') {
            eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
            return;
        }
        if (action === 'charm') this.send('charm', { charmId: button.dataset.charm });
        else if (action === 'choose') this.send('choose', { offer: Number(button.dataset.offer) });
        else if (action === 'again-same') this.send('again', { seed: button.dataset.seed });
        else this.send(action);
        // A pointer click hands the keys back to the board once play goes on.
        if (event.detail > 0 && this.state?.phase === 'play') document.activeElement?.blur?.();
    }

    onKeyDown(event) {
        if (!this.state || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
        if (this.covered()) return;
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (event.key === 'Enter' && this.state.phase === 'ended' && !event.target?.closest?.('button')) {
            event.preventDefault();
            this.send('again');
        }
    }
}

let hud = null;

/** Installs the HUD once; it stays idle until Waystones publishes a road. */
export function installWaystonesHud() {
    if (!hud && typeof document !== 'undefined') hud = new WaystonesHud();
    return hud;
}
