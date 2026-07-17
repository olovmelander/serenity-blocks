(() => {
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const keys = ['ArrowLeft','ArrowLeft','ArrowRight','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ArrowUp',' '];
  const dispatch = (key, type) => document.dispatchEvent(new KeyboardEvent(type, { key: key === ' ' ? ' ' : key, code: key === ' ' ? 'Space' : key, bubbles: true }));
  const bot = window.__bot = { moves: 0, stop: false };
  const step = () => {
    if (bot.stop) return;
    const gs = window.__gs && window.__gs();
    if (gs && gs.isGameOver) { try { window.startGame(); } catch (e) {} setTimeout(step, 800); return; }
    const key = keys[Math.floor(rnd() * keys.length)];
    dispatch(key, 'keydown');
    setTimeout(() => dispatch(key, 'keyup'), 30 + rnd() * 40);
    bot.moves++;
    setTimeout(step, 90 + rnd() * 160);
  };
  step();
})()
