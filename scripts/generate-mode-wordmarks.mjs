// Extend the original Serenity Blocks vector alphabet; no font dependency.
// Run with: node scripts/generate-mode-wordmarks.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = new URL('../public/assets/branding/modes/', import.meta.url);
mkdirSync(output, { recursive: true });

// 100-unit cap height, 22-unit stems, the master's rounded block corners.
// S/E/R/N/I/T/Y/L/O are the original logo's outlines, translated to the origin.
const glyphs = {
    A: [88, 'M0 100L29 0H59L88 100H64L58 78H30L24 100ZM36 56H52L44 26Z'],
    D: [82, 'M0 0H49Q82 0 82 32V68Q82 100 49 100H0ZM22 22V78H47Q60 78 60 65V35Q60 22 47 22Z'],
    E: [76, 'M76 0H10Q0 0 0 10V90Q0 100 10 100H76V78H22V61H65V39H22V22H76Z'],
    F: [76, 'M0 100V10Q0 0 10 0H76V22H22V42H65V64H22V100Z'],
    G: [82, 'M82 0V22H33Q22 22 22 34V66Q22 78 33 78H60V61H43V40H82V100H30Q0 100 0 70V30Q0 0 30 0Z'],
    I: [22, 'M0 0H22V100H0Z'],
    L: [70, 'M0 0H22V78H70V100H10Q0 100 0 90Z'],
    M: [102, 'M0 100V0H25L51 43L77 0H102V100H80V39L51 83L22 39V100Z'],
    N: [82, 'M0 100V0H24L60 60V0H82V100H58L22 40V100Z'],
    O: [82, 'M30 0H50V22H31Q22 22 22 32V68Q22 78 31 78H51Q60 78 60 68V32H82V70Q82 100 52 100H30Q0 100 0 70V30Q0 0 30 0Z'],
    P: [80, 'M0 100V0H50Q80 0 80 29V34Q80 63 50 63H22V100ZM22 22V43H49Q58 43 58 34V31Q58 22 49 22Z'],
    R: [84, 'M0 100V0H50Q80 0 80 29V34Q80 54 62 61L84 100H57L35 63H22V100ZM22 22V43H49Q58 43 58 34V31Q58 22 49 22Z'],
    S: [80, 'M78 0H26Q0 0 0 26V36Q0 61 26 61H52Q58 61 58 67V72Q58 78 52 78H2V100H54Q80 100 80 74V64Q80 39 54 39H28Q22 39 22 33V28Q22 22 28 22H78Z'],
    T: [78, 'M0 0H78V22H50V100H28V22H0Z'],
    U: [82, 'M0 0H22V68Q22 78 32 78H50Q60 78 60 68V0H82V70Q82 100 52 100H30Q0 100 0 70Z'],
    Y: [84, 'M0 0H25L42 34L59 0H84L53 59V100H31V59Z'],
};

const widthOf = text => [...text].reduce((sum, char) => sum + glyphs[char][0] + 10, -10);
// Bake the horizontal offsets so the spectrum spans the whole word, rather than
// restarting inside each letter's local transform. The alphabet uses absolute paths.
function translatePath(path, x) {
    let command;
    let coordinate = 0;
    return path.replace(/[MLHVQZ]|-?\d+(?:\.\d+)?/g, token => {
        if (/^[A-Z]$/.test(token)) {
            command = token;
            coordinate = 0;
            return token;
        }
        const horizontal = command === 'H' || (command !== 'V' && coordinate % 2 === 0);
        coordinate += 1;
        return String(Number(token) + (horizontal ? x : 0));
    });
}
function rowPaths(text) {
    let x = 0;
    const tiles = [];
    const paths = [...text].map(char => {
        const [width, path] = glyphs[char];
        if (char === 'O') {
            tiles.push(`      <rect x="${x + 56}" y="-4" width="26" height="26" rx="3" fill="#ffac88"/>`);
        }
        const shape = translatePath(path, x);
        x += width + 10;
        return shape;
    }).join(' ');
    return [`      <path d="${paths}"/>`, ...tiles].join('\n');
}

const modes = [
    ['single-player', 'Single Player', ['SINGLE', 'PLAYER']],
    ['multiplayer', 'Multiplayer', ['MULTI', 'PLAYER']],
    ['infinity', 'Infinity', ['INFINITY']],
    ['serenity', 'Serenity', ['SERENITY']],
    ['odyssey', 'Odyssey', ['ODYSSEY']],
];

for (const [id, label, rows] of modes) {
    const width = Math.max(...rows.map(widthOf));
    let y = 4;
    const groups = rows.map((row, index) => {
        const scale = width / widthOf(row);
        const fill = rows.length > 1 && index === 0 ? '#fff6e9' : 'url(#spectrum)';
        const group = `    <g transform="translate(0 ${y}) scale(${scale})" fill="${fill}">\n${rowPaths(row)}\n    </g>`;
        y += 100 * scale + 24;
        return group;
    });
    const height = Math.ceil(y - 24);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">${label}</title>
  <!-- Original lettering; regenerate with scripts/generate-mode-wordmarks.mjs. -->
  <defs>
    <linearGradient id="spectrum" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="100">
      <stop stop-color="#b8a4ff"/>
      <stop offset=".48" stop-color="#9ee8ed"/>
      <stop offset="1" stop-color="#c5f1cf"/>
    </linearGradient>
  </defs>
  <g fill-rule="evenodd">
${groups.join('\n')}
  </g>
</svg>
`;
    writeFileSync(new URL(`${id}.svg`, output), svg);
    console.log(`${id}: ${width} x ${height} (${fileURLToPath(output)})`);
}
