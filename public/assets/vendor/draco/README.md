# Bundled glTF Draco decoder

These unmodified decoder assets are copied from the pinned `three@0.186.1`
package, `examples/jsm/libs/draco/gltf/`. They are the glTF-targeted decoder
variant used by Three's DRACOLoader. The adjacent upstream README declares
Apache License 2.0; the complete license text is included in LICENSE.

Koi Pond loads these files from the application's own BASE_URL so authored
compressed tree meshes remain available without contacting gstatic. Keep the
JavaScript wrapper and WebAssembly binary together when updating the package.

| File | SHA-256 |
| --- | --- |
| `draco_decoder.js` | 8625489da79a805f4f2a7d511c3e52d8b4085608a9d2a4d5f4f9de5db0aea04f |
| `draco_decoder.wasm` | a680d927bed9cb864ddbd63521868891af2bfbe755092761b4837487618df8ac |
| `draco_wasm_wrapper.js` | 8bb2952d2ba7d67e1414f8df819410cb0434a666be53f671fff75f68843d76f6 |
