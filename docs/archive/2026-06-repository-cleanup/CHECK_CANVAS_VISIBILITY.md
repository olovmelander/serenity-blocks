# Check Canvas Visibility

## 🔍 Run These Commands After Starting Match:

### 1. Check if canvases exist in DOM:
```javascript
const wrappers = document.querySelectorAll('.opponent-canvas-wrapper');
console.log('Number of opponent wrappers:', wrappers.length);

wrappers.forEach((wrapper, i) => {
  console.log(`\nWrapper ${i + 1}:`);
  console.log('  ID:', wrapper.id);
  console.log('  Display:', getComputedStyle(wrapper).display);
  console.log('  Visibility:', getComputedStyle(wrapper).visibility);
  console.log('  Opacity:', getComputedStyle(wrapper).opacity);
  console.log('  Width:', getComputedStyle(wrapper).width);
  console.log('  Height:', getComputedStyle(wrapper).height);
  console.log('  Min-height:', getComputedStyle(wrapper).minHeight);
  console.log('  Position:', wrapper.getBoundingClientRect());
});
```

### 2. Check container visibility:
```javascript
const container = document.getElementById('opponent-canvases');
console.log('\nOpponent Canvases Container:');
console.log('  Display:', getComputedStyle(container).display);
console.log('  Grid columns:', getComputedStyle(container).gridTemplateColumns);
console.log('  Grid rows:', getComputedStyle(container).gridTemplateRows);
console.log('  Width:', getComputedStyle(container).width);
console.log('  Height:', getComputedStyle(container).height);
console.log('  Children count:', container.children.length);
```

### 3. Check sidebar visibility:
```javascript
const sidebar = document.querySelector('.opponents-sidebar');
console.log('\nOpponents Sidebar:');
console.log('  Display:', getComputedStyle(sidebar).display);
console.log('  Width:', getComputedStyle(sidebar).width);
console.log('  Height:', getComputedStyle(sidebar).height);
console.log('  Position:', sidebar.getBoundingClientRect());
```

### 4. Check if old Phaser container is hidden:
```javascript
const oldContainer = document.getElementById('phaser-multiplayer-container');
console.log('\nOld Phaser Container:');
console.log('  Display:', getComputedStyle(oldContainer).display);
console.log('  Should be: none');
```

---

## ✅ Expected Results:

- **Wrappers:** 4 wrappers found
- **Wrapper display:** "flex"
- **Wrapper height:** At least "200px"
- **Container display:** "grid"
- **Container children:** 4
- **Sidebar display:** "flex"
- **Old container display:** "none"

---

## 🐛 Share Results:

Copy the output of these commands and share it!

