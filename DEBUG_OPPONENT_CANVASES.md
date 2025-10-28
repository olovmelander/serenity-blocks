# Debug: Opponent Canvases Not Showing

## 🔍 Quick Diagnosis

**Refresh your browser** and run `testMultiplayer(5)` again.

Then check the console output. You should see:

```
📊 Initializing canvases for 5 players
✅ Main canvas created for Dev_XXX
👥 Found 4 opponents: ['Alice', 'Bob', 'Charlie', 'Diana']
  Creating canvas 1/4 for Alice
  📦 Container found: opponent-canvases, current children: 0
  ✅ Opponent canvas created for Alice (mock_player_1)
  Creating canvas 2/4 for Bob
  📦 Container found: opponent-canvases, current children: 1
  ✅ Opponent canvas created for Bob (mock_player_2)
  ...
```

---

## 🐛 If Container Not Found:

If you see: `❌ Opponent container #opponent-canvases not found in DOM`

**Run this in console:**
```javascript
document.getElementById('opponent-canvases')
// Should return: <div id="opponent-canvases" class="opponent-canvases-list">

// If null, check parent:
document.querySelector('.opponents-sidebar')
```

---

## 🔍 Manual DOM Check:

```javascript
// Check if canvases are created:
document.querySelectorAll('.opponent-canvas-wrapper')
// Should return: NodeList(4) [div.opponent-canvas-wrapper, ...]

// Check canvas count:
document.querySelectorAll('.opponent-canvas-wrapper').length
// Should return: 4

// Check if they're in the right container:
document.getElementById('opponent-canvases').children.length
// Should return: 4
```

---

## 🎨 Check Visibility:

```javascript
// Check if sidebar is visible:
const sidebar = document.querySelector('.opponents-sidebar');
getComputedStyle(sidebar).display  // Should be: "flex"
getComputedStyle(sidebar).visibility  // Should be: "visible"

// Check if canvases list is visible:
const list = document.getElementById('opponent-canvases');
getComputedStyle(list).display  // Should be: "grid"
```

---

## 📊 What to Report:

Please share the console output and answers to these:

1. How many opponents does the console say were found?
2. Does it say container was found or not found?
3. How many `.opponent-canvas-wrapper` elements exist?
4. Is the `.opponents-sidebar` visible?

This will help me fix the exact issue!

