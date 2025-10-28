# How to Run Serenity Blocks

Quick guide to run the game in browser or desktop mode.

---

## 🌐 Option 1: Browser Mode (Fastest, Recommended for Development)

**Best for:** Quick testing, hot reload, fast iteration

### Step 1: Start Vite Dev Server

```bash
npm run dev
```

### Step 2: Open Browser

- Navigate to: **http://localhost:5173**
- Open DevTools (F12) to see console output

### Features in Browser Mode:
- ✅ Full game functionality
- ✅ Hot reload (instant updates)
- ✅ Fast performance
- ✅ Mock Steam mode (local testing)
- ❌ No real Steam features (Spacewar AppID)

---

## 🖥️ Option 2: Electron Mode (Desktop App with Steam)

**Best for:** Testing Steam features, final testing before release

### Step 1: Start Vite Dev Server (in one terminal)

```bash
npm run dev
```

**Wait for this message:**
```
VITE v5.4.20 ready in XXXms

➜  Local:   http://localhost:5173/
```

### Step 2: Start Electron (in a NEW terminal)

**Open a second terminal**, then run:

```bash
npm run dev:electron
```

### Features in Electron Mode:
- ✅ Desktop application
- ✅ Real Steam integration (if Steam is running)
- ✅ Spacewar AppID (480) for testing
- ✅ Full Steamworks API access
- ⚠️ Slower on WSL2 (GPU limitations)

---

## 🚨 Troubleshooting

### "Port 5173 is already in use"

**Problem:** Vite is already running from a previous session.

**Solution:**
```bash
# Kill the process using port 5173
lsof -ti:5173 | xargs kill -9

# Or just find and kill it manually
ps aux | grep vite
kill -9 [PID]

# Then restart
npm run dev
```

### Electron shows "ERR_CONNECTION_REFUSED"

**Problem:** Vite dev server is not running.

**Solution:** Make sure Vite is running FIRST (Step 1), then start Electron (Step 2).

### Electron is slow on WSL2

**Problem:** WSL2 has limited GPU acceleration.

**Solution:** Use **Browser Mode** for development. Only use Electron for final Steam testing.

---

## 🧪 Testing Commands

Once the game is running, open the browser console (F12) and try:

```javascript
// Test Steam integration
testSteam()

// Test Phase 2 (game state & anti-cheat)
testFFA()

// Test Phase 3 (combat & host migration)
testPhase3()

// Create a match
createFFAMatch()

// Access the FFA instance
window.ffa
```

---

## 📋 Quick Reference

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start Vite dev server (port 5173) |
| `npm run dev:electron` | Start Electron app (requires Vite running) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |

---

## 💡 Recommended Workflow

### For Active Development:
1. **Use Browser Mode** (`npm run dev` only)
2. Faster iteration, better performance on WSL2
3. Hot reload works perfectly

### For Steam Testing:
1. **Terminal 1:** `npm run dev`
2. **Terminal 2:** `npm run dev:electron`
3. Test Steam features (lobbies, P2P, etc.)

### Before Release:
1. Build: `npm run build`
2. Test production build
3. Package for Steam

---

## ✅ Success Indicators

**Browser Mode Working:**
```
✅ Vite dev server running on http://localhost:5173
✅ Game loads in browser
✅ Console shows: "✅ Serenity Blocks initialized successfully!"
✅ Console shows: "✅ Steam initialized successfully!" (Mock mode)
```

**Electron Mode Working:**
```
✅ Vite dev server running on http://localhost:5173
✅ Electron window opens
✅ Game loads in Electron
✅ Console shows: "✅ Steam initialized successfully!"
✅ DevTools open automatically (for debugging)
```

---

**Need help?** Check the console for error messages and refer to the troubleshooting section above.

