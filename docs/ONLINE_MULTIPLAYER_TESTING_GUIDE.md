# 🌐 Online Multiplayer Testing Guide

This guide explains how to test the **Online Multiplayer** mode "for real" across different computers using Steam P2P networking.

## ✅ Prerequisites

To test online multiplayer, you need:

1. **Two Computers** (PC/Mac/Linux) on the same network or different networks (internet works!).
2. **Steam Installed & Running** on both computers.
3. **Two Different Steam Accounts** (recommended) or one account logged in on both (Spacewar sometimes allows this, but two accounts are safer).
4. **Node.js** installed on both computers.

---

## 🛠️ Setup Instructions (Perform on BOTH computers)

### 1. Get the Code
Clone the repository or copy the entire `serenity-blocks` folder to the second computer.

### 2. Install Dependencies
Open a terminal in the project folder and run:
```bash
npm install
```
*Note: This installs Electron and other dependencies.*

### 3. Verify `steam_appid.txt`
Make sure a file named `steam_appid.txt` exists in the **root** of the project folder (next to `package.json`).
It must contain exactly:
```
480
```
*Reason: App ID 480 is "Spacewar", a test application provided by Valve for developers. We use this to test Steam features without a real app ID.*

### 4. Rebuild Greenworks (If needed)
If you encounter errors about `greenworks` version mismatches, you may need to rebuild it or ensure `npm install` ran successfully.
*Usually, `npm install` handles this automatically via the `install` script in package.json.*

---

## 🚀 Running the Game

**IMPORTANT:** Steam **MUST** be running in the background before you start the game.

### 1. Start the Electron App
Run this command in the terminal:
```bash
npm run dev:electron
```

### 2. Verify Steam Connection
Check the terminal output. You should see a green success message:
```
✅ Steam initialized: [YourSteamName] ([YourSteamID])
```
*If you see "Running in browser mode" or "Greenworks not available", verify that Steam is open and `steam_appid.txt` is present.*

---

## 🎮 How to Connect

### Player 1 (Host)
1. Go to **Online Multiplayer** from the main menu.
2. Click **Create Lobby**.
3. Choose settings (e.g., "Public", "Frags", "10").
4. Click **Create**.
5. You are now in the Waiting Room.

### Player 2 (Client)
1. Go to **Online Multiplayer**.
2. Click **Message** (Lobby Browser). *Wait for the list to refresh.*
3. You should see "FFA Match" (or whatever name Player 1 used) hosted by Player 1.
4. Click **Join**.
5. You should appear in Player 1's Waiting Room!

---

## 🧪 Testing Checklist

Once connected, verify these features:
- [ ] **Presence:** Do you see each other in the Waiting Room?
- [ ] **Ready State:** Click "Ready" on both. Does the game start?
- [ ] **Gameplay:** Can you see the other player's board updates?
- [ ] **Garbage:** Send lines. Does the other player receive garbage?
- [ ] **Chat:** Press Enter to chat. does it appear for both?
- [ ] **Results:** When the match ends, do both see the results screen?

## ⚠️ Troubleshooting

**"Steam is not running" Error:**
- Restart Steam.
- Ensure `steam_appid.txt` is in the root folder.
- Restart the game process.

**"Greenworks not available":**
- This usually means the binary is missing or incompatible.
- Try deleting `node_modules` and running `npm install` again.
- Ensure you are running `npm run dev:electron`, NOT `npm run dev` (which is browser-only).

**Lobby not appearing:**
- Ensure both players are in the same Steam Download Region (sometimes affects Spacewar discovery).
- Try inviting via Steam Friends list (Shift+Tab -> Right Click Friend -> Invite to Game).
