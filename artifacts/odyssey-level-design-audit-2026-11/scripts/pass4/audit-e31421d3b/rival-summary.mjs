// Pass 4: per-rival summary of rival-run.mjs rows (shared by the table scripts).
const NAMES = { 5: 'Cinder', 10: 'Coral', 18: 'Willow', 26: 'Frost', 34: 'Zephyr', 48: 'Nova', 56: 'Prism', 60: 'Neon' };
const GATE = { 'stacker/deliberate': 'novice', 'stacker/native': 'regular', 'cascade/steady': 'skilled', 'expert/native': 'expert', 'quad/native': 'quad' };
const median = (values) => {
    const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const sum = (values) => values.reduce((a, b) => a + (b || 0), 0);

export function summarize(rows) {
    const out = {};
    for (const orb of [...new Set(rows.map((r) => r.orb))].sort((a, b) => a - b)) {
        const mine = rows.filter((r) => r.orb === orb);
        const cell = (filter) => {
            const rs = mine.filter(filter);
            const wins = rs.filter((r) => r.outcome === 'win');
            return {
                n: rs.length,
                wins: wins.length,
                two: wins.filter((r) => r.stars >= 2).length,
                three: wins.filter((r) => r.stars >= 3).length,
                censored: rs.filter((r) => r.outcome === 'censored').length,
                minutes: median(rs.map((r) => r.seconds / 60)),
                winMinutes: median(wins.map((r) => r.seconds / 60)),
                noFrag: rs.filter((r) => r.outcome !== 'win' && r.frags[0] === 0).length,
            };
        };
        const paces = {};
        for (const pace of ['casual', 'regular', 'strong']) {
            paces[pace] = cell((r) => r.cadence === `human-${pace}`);
            paces[`${pace}Stacker`] = cell((r) => r.cadence === `human-${pace}` && r.profile === 'stacker');
            paces[`${pace}Cascade`] = cell((r) => r.cadence === `human-${pace}` && r.profile === 'cascade');
        }
        const gates = {};
        for (const [key, name] of Object.entries(GATE)) gates[name] = cell((r) => `${r.profile}/${r.cadence}` === key);
        const human = mine.filter((r) => r.cadence.startsWith('human-'));
        const deaths = human.flatMap((r) => r.deaths || []);
        const rival = deaths.filter((d) => d.who === 'rival');
        const player = deaths.filter((d) => d.who === 'player');
        const botPieces = sum(human.map((r) => r.pieces?.[1]));
        const seconds = sum(human.map((r) => r.activeSeconds));
        out[orb] = {
            name: NAMES[orb],
            paces,
            gates,
            style: {
                piecesPerMinute: seconds ? botPieces / (seconds / 60) : null,
                rowsPerPiece: botPieces ? sum(human.map((r) => r.rowsSent?.[1])) / botPieces : null,
                rowsPerAttack: sum(human.map((r) => r.attacks?.[1])) ? sum(human.map((r) => r.rowsSent?.[1])) / sum(human.map((r) => r.attacks?.[1])) : null,
                bigPer100: botPieces ? 100 * sum(human.map((r) => r.big?.[1])) / botPieces : null,
                biggest: Math.max(0, ...human.map((r) => r.biggest?.[1] || 0)),
            },
            deaths: {
                rival: rival.length,
                rivalByRows: rival.filter((d) => d.cause === 'rows').length,
                // Rows the well refused while its spawn columns still had four rows or more to spare.
                rivalBySideTower: rival.filter((d) => d.cause === 'rows' && d.tallest - d.centre >= 4).length,
                player: player.length,
                playerByRows: player.filter((d) => d.cause === 'rows').length,
            },
        };
    }
    return out;
}

