# How to Run Vite Dev Server - Serenity Blocks

**Project:** Serenity Blocks (Phaser 4 Migration)  
**Build Tool:** Vite v5.4.20  
**Node.js:** v22.20.0 (via nvm)  
**Last Updated:** October 15, 2025

---

## 🚀 Quick Start (Recommended Method)

### Step 1: Load nvm (Node Version Manager)
```bash
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### Step 2: Run Vite
```bash
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```

### Step 3: Open in Browser
```
🌐 http://localhost:3000/
```

**That's it!** Vite will start and serve your game.

---

## 📋 All Methods to Run Vite

### Method 1: Direct Node Execution ✅ WORKING
**Use this method when `npm run dev` fails**

```bash
# Full command with nvm loading
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```

**Pros:**
- ✅ Always works
- ✅ No PATH issues
- ✅ Direct control

**Cons:**
- ❌ Longer command
- ❌ Need to load nvm each time

---

### Method 2: npm run dev ⚠️ NEEDS FIX
**Standard method (currently not working)**

```bash
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

**Current Issue:**
```
sh: 1: vite: not found
```

**Why it fails:**
- Vite binary not in system PATH
- `npm run dev` looks for `vite` command
- Node modules bin directory not linked

**How to Fix:**
```bash
# Option A: Use npx (finds local node modules)
npx vite --host 0.0.0.0 --port 3000

# Option B: Add node_modules/.bin to PATH
export PATH="$PWD/node_modules/.bin:$PATH"
npm run dev

# Option C: Reinstall with binlinks
npm rebuild
npm run dev
```

---

### Method 3: npx (Alternative) ✅ SHOULD WORK
**Uses npm's package executor**

```bash
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npx vite --host 0.0.0.0 --port 3000
```

**Pros:**
- ✅ Finds local packages automatically
- ✅ Shorter than Method 1
- ✅ Standard npm tool

**Cons:**
- ⚠️ May need to install packages first

---

## 🔧 Command Options Explained

### Basic Command
```bash
node node_modules/vite/bin/vite.js
```
Starts Vite on default port 5173, localhost only

### With Host Binding
```bash
node node_modules/vite/bin/vite.js --host 0.0.0.0
```
**Purpose:** Makes server accessible from network (not just localhost)  
**Use case:** Testing on mobile devices, accessing from other computers

### With Custom Port
```bash
node node_modules/vite/bin/vite.js --port 3000
```
**Purpose:** Run on specific port (default is 5173)  
**Use case:** Avoid port conflicts, match documentation

### Full Command
```bash
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```
**Purpose:** Network accessible on port 3000  
**Recommended:** ✅ Yes, this is what we use

---

## 📝 Creating a Convenient Start Script

### Option 1: Shell Script (Recommended)

Create `start-dev.sh`:

```bash
#!/bin/bash

echo "🎮 Serenity Blocks - Vite Dev Server"
echo "======================================"

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Check Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"
echo ""
echo "🚀 Starting Vite dev server..."
echo "   📍 Local:   http://localhost:3000/"
echo "   📍 Network: Available on your IP"
echo ""
echo "Press Ctrl+C to stop the server"
echo "======================================"
echo ""

# Start Vite
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```

**Make it executable:**
```bash
chmod +x start-dev.sh
```

**Run it:**
```bash
./start-dev.sh
```

---

### Option 2: npm Script Alias

Update `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:direct": "node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000",
    "start": "node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000"
  }
}
```

**Then run:**
```bash
npm run start
# or
npm run dev:direct
```

---

### Option 3: Bash Alias

Add to `~/.bashrc`:

```bash
# Serenity Blocks dev server
alias serenity-dev='cd /home/melolo/serenity-blocks && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000'
```

**Reload bashrc:**
```bash
source ~/.bashrc
```

**Run from anywhere:**
```bash
serenity-dev
```

---

## 🎯 Vite Dev Server Output

### What You'll See

```
  VITE v5.4.20  ready in 386 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://10.255.255.254:3000/
  ➜  Network: http://172.20.125.42:3000/
```

**Explained:**
- **Local:** Access from same computer
- **Network:** Access from other devices on same network
- **Ready in Xms:** How long Vite took to start

### Expected Warnings

**1. Dynamic Import Warning:**
```
The above dynamic import cannot be analyzed by Vite.
See https://github.com/rollup/plugins/tree/master/packages/dynamic-import-vars#limitations
```

**What it means:** Theme loading uses dynamic imports  
**Is it a problem?** ❌ No, this is expected and works fine  
**Can we fix it?** ✅ Yes, add `/* @vite-ignore */` comment (optional)

**2. Public Directory Warnings:**
```
Files in the public directory are served at the root path.
Instead of /public/index.html, use /index.html.
```

**What it means:** Vite serves `public/` files at root  
**Is it a problem?** ⚠️ Minor, paths work but could be cleaner  
**Can we fix it?** ✅ Yes, update paths to remove `/public/` prefix

---

## 🔍 Troubleshooting

### Issue 1: "vite: not found"

**Symptom:**
```
sh: 1: vite: not found
```

**Solution:**
Use Method 1 (direct node execution) instead of `npm run dev`

---

### Issue 2: "Cannot find module 'vite'"

**Symptom:**
```
Error: Cannot find module 'vite'
```

**Solution:**
```bash
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm install
```

---

### Issue 3: "Port already in use"

**Symptom:**
```
Error: Port 3000 is already in use
```

**Solution:**
```bash
# Option A: Use different port
node node_modules/vite/bin/vite.js --port 3001

# Option B: Kill process using port
lsof -ti:3000 | xargs kill -9

# Option C: Find and stop it
ps aux | grep vite
kill <PID>
```

---

### Issue 4: "Node.js not found"

**Symptom:**
```
node: command not found
```

**Solution:**
```bash
# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Verify
node --version  # Should show v22.20.0
npm --version   # Should show v10.9.3
```

---

### Issue 5: Can't Access from Network

**Symptom:**
Can't open http://YOUR_IP:3000/ from another device

**Solution:**
Make sure you used `--host 0.0.0.0`:
```bash
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```

---

## 🛑 How to Stop the Server

### If Running in Foreground
Press **Ctrl+C** in the terminal

### If Running in Background
```bash
# Find the process
ps aux | grep "vite.js"

# Kill by PID
kill <PID>

# Or kill all Vite processes
pkill -f "vite.js"
```

---

## 📊 Server Status Commands

### Check if Vite is Running
```bash
ps aux | grep "vite.js" | grep -v grep
```

### Check Which Port
```bash
netstat -tlnp 2>/dev/null | grep vite
# or
ss -tlnp 2>/dev/null | grep vite
```

### Test Server Response
```bash
curl -I http://localhost:3000/
```

Should return:
```
HTTP/1.1 200 OK
```

---

## 🎯 Best Practices

### 1. Always Load nvm First
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

### 2. Use Consistent Port
Stick with **port 3000** for all development

### 3. Bind to All Interfaces
Use `--host 0.0.0.0` for flexibility

### 4. Monitor Console Output
Watch for warnings and errors in Vite output

### 5. Keep Terminal Open
Don't close terminal while server is running

---

## 🔗 Quick Reference

### Full Start Command
```bash
cd /home/melolo/serenity-blocks && \
export NVM_DIR="$HOME/.nvm" && \
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && \
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000
```

### URLs
- **Local:** http://localhost:3000/
- **Main Page:** http://localhost:3000/index.html
- **Game:** http://localhost:3000/ (auto-redirects)

### Common Commands
```bash
# Start server
./start-dev.sh

# Stop server
Ctrl+C

# Check status
ps aux | grep vite

# Kill server
pkill -f vite.js
```

---

## 📚 Additional Resources

### Vite Documentation
- **Official Docs:** https://vitejs.dev/
- **Config Reference:** https://vitejs.dev/config/
- **CLI Options:** https://vitejs.dev/guide/cli.html

### Related Files
- **Vite Config:** `/home/melolo/serenity-blocks/vite.config.js`
- **Package.json:** `/home/melolo/serenity-blocks/package.json`
- **This Guide:** `/home/melolo/serenity-blocks/docs/HOW_TO_RUN_VITE_DEV_SERVER.md`

---

## ✅ Checklist: First Time Setup

- [ ] Install Node.js (via nvm) ✅ Done
- [ ] Install npm packages: `npm install` ✅ Done
- [ ] Verify Vite installed: `ls node_modules/vite/` ✅ Done
- [ ] Create start script: `start-dev.sh` ⏭️ Optional
- [ ] Test dev server: Run command above ✅ Done
- [ ] Open browser: http://localhost:3000/ ✅ Ready
- [ ] Check console: Look for Phaser logs ⏭️ Next

---

## 🎮 For Development

### During Development
```bash
# Terminal 1: Run Vite
cd /home/melolo/serenity-blocks
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 3000

# Browser: Open and edit code
# Vite will auto-reload on file changes!
```

### Hot Module Replacement (HMR)
Vite automatically refreshes the browser when you:
- Edit JavaScript files
- Edit CSS files
- Add new files

**No manual refresh needed!** 🎉

---

## 🚀 Production Build

When ready to deploy:

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Or manually
node node_modules/vite/bin/vite.js build
node node_modules/vite/bin/vite.js preview
```

---

**Last Updated:** October 15, 2025  
**Vite Version:** 5.4.20  
**Working Method:** Direct node execution (Method 1)  
**Status:** ✅ Fully functional, serving on port 3000

---

## 📞 Need Help?

If Vite won't start:
1. Check Node.js is installed: `node --version`
2. Check npm is installed: `npm --version`
3. Check Vite is installed: `ls node_modules/vite/`
4. Try Method 1 (direct node execution)
5. Check this guide for troubleshooting section

**The server should now be running! Open http://localhost:3000/ and start coding!** 🎉

