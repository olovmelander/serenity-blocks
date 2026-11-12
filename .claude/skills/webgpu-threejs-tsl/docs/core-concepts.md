# TSL Core Concepts (three r187)

Types, operators, uniforms, functions and control flow, with samples that were built through
three's own node builders on r187. Read it when writing nontrivial TSL. Two things this file
only touches on are the cause of most shader faults in this repo, and have their own files:
where the builder writes a node's code (`gotchas/tsl-emission.md`) and how a shared helper
`Fn` must be written (`gotchas/tsl-functions-loops.md`).

## Types and Constructors

### Scalar Types
```javascript
import { float, int, uint, bool } from 'three/tsl';

const f = float(1.0);
const i = int(42);
const u = uint(100);
const b = bool(true);
```

### Vector Types
```javascript
import { vec2, vec3, vec4, color } from 'three/tsl';

const v2 = vec2(1.0, 2.0);
const v3 = vec3(1.0, 2.0, 3.0);
const v4 = vec4(1.0, 2.0, 3.0, 1.0);

// Color (RGB, accepts hex or components)
const c = color(0xff0000);     // Red
const c2 = color(1, 0.5, 0);   // Orange
```

### Matrix Types
```javascript
import { mat2, mat3, mat4 } from 'three/tsl';

const m3 = mat3();
const m4 = mat4();
```

### Type Conversion
```javascript
const v = vec3(1, 2, 3);
const v4 = v.toVec4(1.0);      // vec4(1, 2, 3, 1)
const f = int(42).toFloat();   // 42.0
const c = v.toColor();         // Convert to color
```

## Vector Swizzling

Access and reorder vector components using standard notation:

```javascript
const v = vec3(1.0, 2.0, 3.0);

// Single component access
v.x  // 1.0
v.y  // 2.0
v.z  // 3.0

// Multiple components
v.xy   // vec2(1.0, 2.0)
v.xyz  // vec3(1.0, 2.0, 3.0)

// Reorder components
v.zyx  // vec3(3.0, 2.0, 1.0)
v.xxy  // vec3(1.0, 1.0, 2.0)
v.rrr  // vec3(1.0, 1.0, 1.0) - same as xxx

// Alternative accessors (all equivalent)
v.xyz  // position
v.rgb  // color
v.stp  // texture coordinates
```

## Uniforms

Uniforms pass values from JavaScript to shaders:

```javascript
import { uniform } from 'three/tsl';
import * as THREE from 'three/webgpu';

// Create uniforms
const myColor = uniform(new THREE.Color(0x0066ff));
const myFloat = uniform(0.5);
const myVec3 = uniform(new THREE.Vector3(1, 2, 3));

// Update at runtime
myColor.value.set(0xff0000);
myFloat.value = 0.8;
myVec3.value.set(4, 5, 6);

// Use in material
material.colorNode = myColor;
```

### Auto-Updating Uniforms

```javascript
// Update every frame
const animatedValue = uniform(0).onFrameUpdate((frame) => {
  return Math.sin(frame.time);
});

// Update per object render. The callback's argument is the NodeFrame, not the object:
// destructure what you need from it.
const perObjectValue = uniform(0).onObjectUpdate(({ object }) => {
  return object.userData.customValue;
});

// Update once per render cycle (the frame has `deltaTime`, there is no `delta`)
const renderValue = uniform(0).onRenderUpdate(({ deltaTime }) => {
  return deltaTime;
});
```

## Operators

### Arithmetic
```javascript
// Method chaining (preferred)
const result = a.add(b).mul(c).sub(d).div(e);

// Individual operations
a.add(b)   // a + b
a.sub(b)   // a - b
a.mul(b)   // a * b
a.div(b)   // a / b
a.mod(b)   // floats: a - b * floor(a / b) (GLSL mod); ints: a % b
a.negate() // -a
```

A JavaScript operator on a node is never an operator: `-a` coerces the node to `NaN` and prints
it into the shader, and `1 + a` concatenates a string (gotcha #167, #213).

### Comparison
```javascript
a.equal(b)            // a == b
a.notEqual(b)         // a != b
a.lessThan(b)         // a < b
a.greaterThan(b)      // a > b
a.lessThanEqual(b)    // a <= b
a.greaterThanEqual(b) // a >= b
```

### Logical
```javascript
a.and(b)   // a && b
a.or(b)    // a || b
a.not()    // !a
a.xor(b)   // a ^ b
```

### Bitwise
```javascript
a.bitAnd(b)      // a & b
a.bitOr(b)       // a | b
a.bitXor(b)      // a ^ b
a.bitNot()       // ~a
a.shiftLeft(n)   // a << n
a.shiftRight(n)  // a >> n
```

### Assignment (for variables)
```javascript
const v = vec3(0).toVar();  // Create mutable variable

v.assign(vec3(1, 2, 3));    // v = vec3(1, 2, 3)
v.addAssign(vec3(1));       // v += vec3(1)
v.subAssign(vec3(1));       // v -= vec3(1)
v.mulAssign(2.0);           // v *= 2.0
v.divAssign(2.0);           // v /= 2.0
```

## Variables

### Mutable Variables
```javascript
// Create mutable variable with toVar()
const myVar = vec3(1, 0, 0).toVar();
myVar.assign(vec3(0, 1, 0));
myVar.addAssign(vec3(0, 0, 1));

// Name the variable (useful for debugging)
const named = vec3(0).toVar('myPosition');
```

### Constants
```javascript
// Create compile-time constant
const PI_HALF = float(Math.PI / 2).toConst();
```

### Properties (named values for shader stages)
```javascript
import { property } from 'three/tsl';

// Create named property
const myProp = property('vec3', 'customColor');
myProp.assign(vec3(1, 0, 0));
```

## Control Flow

### ⚠️ CRITICAL: Property Assignment vs Variable Reassignment

**TSL intercepts property assignments on nodes, but NOT JavaScript variable reassignment.**

| Pattern | Works? | Why |
|---------|--------|-----|
| `copy.y = value` where `copy = vec3(node)` or `node.toVar()` | ✅ | your own node: r187 declares it as a variable when it is assigned |
| `positionWorld.y = value`, or assigning to a texture sample or a uniform | ❌ | a shared node: the write is silently lost (or invalid, for a uniform) |
| `node.x.assign(value)` on your own node | ✅ | TSL method call |
| `variable = variable.add(1)` | ❌ | JS variable reassignment |

Everything in this section runs INSIDE a `Fn`: `If`, `Loop` and `.assign()` need the function's
flow to write into, and a bare `If(...)` at module level throws.

**This WORKS (vec3 property assignment):**
```javascript
const result = vec3(position);
If(result.y.greaterThan(limit), () => {
  result.y = limit;  // ✅ Property assignment - TSL intercepts!
});
```

**This DOES NOT work (scalar variable reassignment):**
```javascript
let value = buffer.element(index).toFloat();  // Scalar - no .x/.y properties
If(condition, () => {
  value = value.add(1.0);  // ❌ JS variable reassignment - TSL can't see this!
});
return value;  // Returns ORIGINAL node!
```

**Solutions for scalars:**
```javascript
// ✅ Use select() for conditional values. It is a BRANCH, not a blend: with a scalar condition
// it is emitted as if/else and only one side runs, so a node first built inside one side is
// zero on the other (gotcha #68). select(c, a, b).uniformFlow() evaluates both sides instead.
const result = select(condition, valueIfTrue, valueIfFalse);

// ✅ Use .toVar() for mutable variables
const value = buffer.element(index).toVar();
If(condition, () => {
  value.assign(value.add(1.0));  // Works with .toVar()!
});

// ✅ Use direct .assign() on buffer elements
If(condition, () => {
  element.assign(element.add(1.0));  // Direct buffer writes work!
});
```

### Conditionals

```javascript
import { If, select } from 'three/tsl';

// If-ElseIf-Else (use with .toVar() or direct .assign())
const result = vec3(0).toVar();

If(value.greaterThan(0.5), () => {
  result.assign(vec3(1, 0, 0));  // Red
}).ElseIf(value.greaterThan(0.25), () => {
  result.assign(vec3(0, 1, 0));  // Green
}).Else(() => {
  result.assign(vec3(0, 0, 1));  // Blue
});

// Ternary operator (select) - PREFERRED for simple conditionals
const color = select(
  condition,           // if true
  vec3(1, 0, 0),      // return this
  vec3(0, 0, 1)       // else return this
);
```

### Switch-Case

```javascript
import { Switch } from 'three/tsl';

const col = vec3(0).toVar();

Switch(intValue)
  .Case(0, () => { col.assign(color(1, 0, 0)); })
  .Case(1, () => { col.assign(color(0, 1, 0)); })
  .Case(2, () => { col.assign(color(0, 0, 1)); })
  .Default(() => { col.assign(color(1, 1, 1)); });
```

### Loops

```javascript
import { Loop, Break, Continue } from 'three/tsl';

// Simple loop (0 to 9)
const sum = float(0).toVar();
Loop(10, ({ i }) => {
  sum.addAssign(float(i));
});

// Ranged loop with options
Loop({ start: int(0), end: int(count), type: 'int' }, ({ i }) => {
  // Loop body
});

// Nested loops
Loop(width, height, ({ i, j }) => {
  // i = outer loop index
  // j = inner loop index
});

// Loop control
Loop(100, ({ i }) => {
  If(shouldStop, () => {
    Break();  // Exit loop
  });
  If(shouldSkip, () => {
    Continue();  // Skip to next iteration
  });
});
```

### Flow Control

```javascript
import { Discard, Fn, If } from 'three/tsl';

// Discard the fragment: three equivalent spellings, all inside a Fn
If(alpha.lessThan(0.5), () => { Discard(); });
Discard(alpha.lessThan(0.5));
alpha.lessThan(0.5).discard();

// Early return WITH a value: return it from the If callback. Needs a Fn with a layout.
const myFn = Fn(([c]) => {
  If(c.greaterThan(0.5), () => vec3(1, 0, 0));   // emits `return vec3<f32>( 1.0, 0.0, 0.0 );`
  return vec3(0, 0, 1);
}, { c: 'float', return: 'vec3' });
```

In a `Fn` without a layout the early return is dropped with a warning ("Return statement used
in an inline 'Fn()'"). `Return()` takes no argument and emits a bare `return;`: it is only for
functions with no value (a compute kernel). On a material, prefer `maskNode` for a cut-out; a
material with a `fragmentNode` ignores it and must discard itself (gotcha #111).

## Custom Functions with Fn()

### Basic Function
```javascript
import { Fn } from 'three/tsl';

const addVectors = Fn(([a, b]) => {
  return a.add(b);
});

// Usage
const result = addVectors(vec3(1, 0, 0), vec3(0, 1, 0));
```

### Default Parameters
```javascript
// A default is a plain JavaScript value until you make it a node: `a = 1.0` then `a.add(b)`
// throws. These two work only because they are handed to a node's method; write float(1.0)
// whenever the default itself is the receiver.
const oscillate = Fn(([frequency = float(1.0), amplitude = float(1.0)]) => {
  return time.mul(frequency).sin().mul(amplitude);
});

// Call variations
oscillate();           // Uses defaults
oscillate(2.0);        // frequency = 2.0
oscillate(2.0, 0.5);   // frequency = 2.0, amplitude = 0.5
```

### Layouts: one shader function instead of a copy per call

A plain `Fn` is INLINE: its body is written again at every call site. A helper called twenty
times is twenty copies, tens of KB of shader and seconds of compile (gotcha #81). Give a shared
helper a layout and the builder writes one real function:

```javascript
const hash21 = Fn(([pIn]) => {
  const p3 = fract(vec3(pIn.x, pIn.y, pIn.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'my_hash21', type: 'float', inputs: [{ name: 'pIn', type: 'vec2' }] });

// Short form (three names the function fnNN):
const hash21b = Fn(([pIn]) => fract(pIn.x.mul(0.1031)), { pIn: 'vec2', return: 'float' });
```

A laid-out function's code is generated once and reused by every later material on that
backend, so it must depend only on its parameters:

- no captured uniform, uniform array or texture (gotcha #93, #95): pass values in;
- no call to another laid-out helper (the WebGL2 backend then compiles the material twice, #207);
- no parameter named with a word WGSL or GLSL reserves: `from`, `of`, `type`, `set`, `get`,
  `use`, `target`, `filter`, `input`, `mod`, `new`, `smooth`, … (gotcha #178, #223).

A helper that reads the uniform bag or a texture stays an inline `Fn`, or a plain JavaScript
function called inside a material's `Fn`.

### Named Parameters (Object Style)
```javascript
const createGradient = Fn(({ colorA = vec3(0), colorB = vec3(1), t = 0.5 }) => {
  return mix(colorA, colorB, t);
});

// Call with named parameters
createGradient({ colorA: vec3(1, 0, 0), t: uv().x });
```

### Function with Context
```javascript
// Access shader context
const customShader = Fn(({ material, geometry, object }) => {
  if (material.userData.customColor) {
    return uniform(material.userData.customColor);
  }
  return vec3(1);
});
```

## Time and Animation

```javascript
import { time, deltaTime } from 'three/tsl';

// time - seconds since start
const rotation = time.mul(0.5);  // Half rotation per second

// deltaTime - time since last frame
const velocity = speed.mul(deltaTime);
```

### Oscillators

```javascript
import { oscSine, oscSquare, oscTriangle, oscSawtooth } from 'three/tsl';

// All oscillators return 0-1 range
oscSine(time)      // Smooth sine wave
oscSquare(time)    // Square wave (0 or 1)
oscTriangle(time)  // Triangle wave
oscSawtooth(time)  // Sawtooth wave

// Custom frequency
oscSine(time.mul(2.0))  // 2Hz oscillation
```

## Math Functions

### Basic Math
```javascript
import { abs, sign, floor, ceil, fract, mod, min, max, clamp } from 'three/tsl';

abs(x)           // Absolute value
sign(x)          // -1, 0, or 1
floor(x)         // Round down
ceil(x)          // Round up
fract(x)         // Fractional part (x - floor(x))
mod(x, y)        // Modulo
min(x, y)        // Minimum
max(x, y)        // Maximum
clamp(x, 0, 1)   // Clamp to range
```

### Trigonometry
```javascript
import { sin, cos, tan, asin, acos, atan } from 'three/tsl';

sin(x)
cos(x)
tan(x)
asin(x)
acos(x)
atan(x)
atan(y, x)       // two-arg form — TSL atan2 was removed in r185
```

### Exponential
```javascript
import { pow, exp, log, sqrt, inverseSqrt } from 'three/tsl';

pow(x, 2.0)      // x^2
exp(x)           // e^x
log(x)           // Natural log
sqrt(x)          // Square root
inverseSqrt(x)   // 1 / sqrt(x)
```

### Interpolation
```javascript
import { mix, step, smoothstep } from 'three/tsl';

mix(a, b, 0.5)              // Linear interpolation
step(0.5, x)                // 0 if x < 0.5, else 1
smoothstep(0.0, 1.0, x)     // Smooth 0-1 transition
```

### Vector Math
```javascript
import { length, distance, dot, cross, normalize, reflect, refract } from 'three/tsl';

length(v)              // Vector length
distance(a, b)         // Distance between points
dot(a, b)              // Dot product
cross(a, b)            // Cross product (vec3 only)
normalize(v)           // Unit vector
reflect(incident, normal)
refract(incident, normal, eta)
```

### Constants
```javascript
import { PI, TWO_PI, HALF_PI, EPSILON } from 'three/tsl';

PI        // 3.14159...
TWO_PI    // 6.28318...
HALF_PI   // 1.57079...
EPSILON   // Very small number
```

## Utility Functions

```javascript
import { hash, checker, remap, range, rotate } from 'three/tsl';

// Pseudo-random hash. The seed is CAST TO UINT: pass an exact, non-negative integer
// (instanceIndex, a floored cell id shifted positive). A float in 0..1 hashes to one value,
// a vector uses .x only, a negative float clamps to 0 (gotcha #204). Returns [0, 1).
hash(seed)

// Checkerboard pattern
checker(uv())                 // Returns 0 or 1

// Remap value from one range to another
remap(x, 0, 1, -1, 1)        // Map 0-1 to -1 to 1

// Generate value in range
range(min, max)               // Random in range (per instance)

// Rotate 2D vector
rotate(vec2(1, 0), angle)
```
