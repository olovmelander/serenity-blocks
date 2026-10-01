# Wolfhour isolated validation

This directory retains the initial overhaul fixtures, reproduction scripts and
accepted captures. Later motion, moon, breathing and impact reports sit in the
adjacent `wolfhour-*` directories. Their summaries describe the later revisions.

The shared Chrome MCP helper requires an explicit CLI path rather than a
machine-specific npm cache. From the repository root in PowerShell:

```powershell
npm install --prefix .cache/wolfhour-capture --no-save chrome-devtools-mcp@1.7.0
$env:WOLFHOUR_MCP_BIN = Join-Path (Get-Location) '.cache/wolfhour-capture/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'
```

Run only one isolated visual fixture at a time, following
[the WebGPU workflow](../../docs/WEBGPU_THREEJS_WORKFLOW.md). Capture scripts
document their fixture URLs and environment overrides. Frozen source snapshots,
generated fixture bundles, tool schema dumps and draft captures are local outputs
excluded by `.gitignore`; retained manifests identify the captured source.
