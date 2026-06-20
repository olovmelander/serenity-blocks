# Asset pipeline — Blackwell (RTX 5080 Laptop) rebuild plan

**Machine:** Legion Pro 7 Gen 10 — Ryzen 9 9955HX3D + RTX 5080 Laptop **16 GB GDDR7**, Blackwell, compute capability **sm_120**.
**Host:** Windows 11 + WSL2 (Ubuntu) + miniconda; plus a native **Windows ComfyUI** (C:\AI).
**Goal:** best-in-class, free, fully-local **photo → 3D mesh → rigged GLB** pipeline for game assets, **maximum quality**.
**Status:** PLAN (2026-06-13). Decision: TRELLIS.2 via ComfyUI (GGUF). Nothing installed yet.

---

## TL;DR

- **Image→3D (primary):** **TRELLIS.2-4B** (MIT) run in **native Windows ComfyUI** via the **GGUF quantized** model (Q6/Q8) — best free quality, fits 16 GB.
- **Image→3D (fallback):** **original `microsoft/TRELLIS` (MIT)** in a WSL conda env — proven on 16 GB, used if the Blackwell `flexgemm` bug blocks TRELLIS.2.
- **Image→3D (legacy fallback):** existing TripoSR (`hunyuan3d` env) — fast, low quality.
- **Rigging:** **UniRig** (best free local auto-rigger) in WSL — env rebuilt for Blackwell.
- **License:** TRELLIS + UniRig are MIT/Apache → EU-safe. Hunyuan3D avoided (Tencent license void in the EU).

---

## The decision & its risk

User wants **maximum quality**, so we use **TRELLIS.2-4B**, the current quality leader.

- TRELLIS.2-4B's official requirement is **24 GB VRAM** + six custom CUDA extensions. On a 16 GB Blackwell card the realistic route is **GGUF quantization inside ComfyUI**:
  - **GGUF** (`Aero-Ex/Trellis2-GGUF`, Q4/Q5/Q6/Q8) shrinks the weights → **Q6/Q8 fit 16 GB**.
  - The custom ops (`flex_gemm`, `o_voxel`, `cumesh`, `nvdiffrast`, `nvdiffrec_render`) ship as **prebuilt Windows wheels** (cp311 + torch 2.7/2.8) → no source compile.
- **Known Blackwell risk:** the `flexgemm` sparse-conv kernel (`SparseConvNeXtBlock3d`) can **silently fail on sm_120** (TRELLIS.2 issue #102, ComfyUI-Trellis2 issue #157). The prebuilt wheels are the community workaround but aren't guaranteed. **Mitigation:** test-generate one asset early; if blocked, fall back to original TRELLIS (§5).
- **Platform consequence:** the prebuilt wheels are `win_amd64`, so **TRELLIS.2 runs in Windows ComfyUI, not WSL**. Rigging stays in WSL UniRig. Hand-off is file-based (GLB on disk).

---

## Why TRELLIS at all (vs other "photo → 3D" tools)

- **One image / a few reference angles → clean game-ready asset** (our case): TRELLIS family is the best free local tool in 2026; clean topology that rigs well; also accepts multi-view input.
- **Many real photos of a real object → faithful capture:** that's **photogrammetry** (Meshroom/COLMAP) — only better for reproducing a specific real object, and its dense/noisy output is poor for rigging. Optional add-on (§6), not the default.

---

## Target architecture

```
photo(s) ─▶ [Windows ComfyUI]  TRELLIS.2-4B GGUF (Q6/Q8)  ─▶ mesh.glb (PBR)
                │ fallback A: [WSL env: trellis]   original TRELLIS  (trellis_gen.py)
                │ fallback B: [WSL env: hunyuan3d]  TripoSR          (triposr_gen.py)
                ▼
           [WSL env: unirig]   UniRig  (unirig_gen.py)  ─▶ rigged.glb (skeleton + skin)
                ▼
           committed into src/themes/<theme>/assets/... ─▶ driven in JS (ocean-reef-dweller-system.js)
```

| Component | Where | Status |
|---|---|---|
| TRELLIS.2 GGUF (primary) | Windows ComfyUI | install nodes + wheels + GGUF (§1) |
| original TRELLIS (fallback A) | WSL conda `trellis` | install on demand (§5) |
| TripoSR (fallback B) | WSL conda `hunyuan3d` | exists |
| UniRig (rigging) | WSL conda `unirig` | rebuild for Blackwell (§3) |

---

## 1. Windows ComfyUI — TRELLIS.2-4B GGUF (PRIMARY)

**Prereq:** ComfyUI already running on a Blackwell-working torch (cu128, torch 2.7/2.8, Python 3.11). Confirm with the MCP `get_environment` / `get_system_stats` before installing — the prebuilt wheels MUST match ComfyUI's exact Python (cp311) and torch (2.7 vs 2.8).

Steps (driven via the ComfyUI MCP once the server is reachable):
1. **Custom node:** install `visualbruno/ComfyUI-Trellis2` (most active for the GGUF + Blackwell path). Alt: `smthemex/ComfyUI_TRELLIS2_SM`.
2. **Blackwell wheels:** install the prebuilt `flex_gemm`, `o_voxel`, `cumesh`, `nvdiffrast`, `nvdiffrec_render` wheels matching ComfyUI's cp311 + torch version into ComfyUI's Python. (Exact URLs pinned at install time from the node's install guide.)
3. **Model:** download `Aero-Ex/Trellis2-GGUF` — start with **Q8** (best quality that fits 16 GB; drop to Q6 if VRAM-tight) — into the GGUF loader's models dir.
4. **Workflow:** use the node's dedicated **GGUF workflow** (old non-GGUF workflows are incompatible). Output: GLB with PBR, `texture_size` 2048–4096.
5. **TEST EARLY:** generate one asset. If it silently fails in shape sampling (the `flexgemm`/sm_120 bug), stop and switch to §5 fallback.

---

## 2. Shared Blackwell base for WSL envs (do once)

1. **Driver:** current NVIDIA Windows driver handles WSL GPU passthrough — no driver inside WSL.
2. **CUDA Toolkit 12.8 in WSL** (`nvcc` for building extensions). Verify `libnvptxcompiler.so` exists under `$CUDA_HOME/lib64` — some 12.8/12.9 installers omit it, breaking PTX JIT for `spconv`/`flash-attn`.
3. **PyTorch:** stable cu128 has `sm_120` — no nightly/source build:
   `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128`
4. **Extension build convention:** `export TORCH_CUDA_ARCH_LIST="12.0" FORCE_CUDA=1` then `pip install --no-build-isolation <pkg>` (builds against the env's torch; avoids silent CPU-only builds).
5. **Per-env sanity:** `python -c "import torch; print('sm_120' in torch.cuda.get_arch_list(), torch.cuda.get_device_capability(0))"` → expect `True (12, 0)`.

---

## 3. `unirig` env — rebuild for Blackwell (WSL)

UniRig needs: torch, **spconv**, **torch_scatter/torch_cluster** (build from source — no cu128 wheels), optional **flash_attn**, pinned **numpy==1.26.4**, **Blender/bpy** for the merge.

```bash
conda create -n unirig python=3.11 -y && conda activate unirig
git clone https://github.com/VAST-AI-Research/UniRig.git ~/tools/UniRig
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r ~/tools/UniRig/requirements.txt        # patch out any torch pin
pip install spconv-cu120                               # PTX→sm_120 JIT (needs libnvptxcompiler.so)
export TORCH_CUDA_ARCH_LIST="12.0" FORCE_CUDA=1
pip install --no-build-isolation torch_scatter torch_cluster
pip install --no-build-isolation flash-attn==2.8.3    # optional; UniRig tolerates absence
pip install numpy==1.26.4                              # MUST be last
pip install bpy                                        # or system Blender for merge.sh
```

`unirig_gen.py` is unchanged; `unirig-gen.sh` already points `UNIRIG_PYTHON` at the env.

---

## 4. Orchestration (scripts to change)

- **CHANGE** `generate-ocean-fauna-assets.mjs` — generation step gains `--engine`:
  `trellis2` (default → call ComfyUI API for GLB), `trellis` (WSL fallback), `triposr` (legacy). Rigging step unchanged (`unirig-gen.sh`).
- **NEW (only if/when we use fallback A)** `scripts/trellis_gen.py` + `scripts/trellis-gen.sh` — original-TRELLIS wrapper matching the `triposr_gen.py` CLI shape.
- **UNCHANGED** `triposr_gen.py`, `unirig_gen.py`.

ComfyUI hand-off: a small helper enqueues the GGUF workflow with the input image, polls for completion, and copies the output GLB to the requested path (mirrors the `*_gen.py` contract). Built once ComfyUI is confirmed working.

---

## 5. Fallback A — original `microsoft/TRELLIS` (WSL, if TRELLIS.2 is blocked)

```bash
conda create -n trellis python=3.11 -y && conda activate trellis
git clone --recurse-submodules https://github.com/microsoft/TRELLIS.git ~/tools/TRELLIS
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -U xformers --index-url https://download.pytorch.org/whl/cu128   # ATTN_BACKEND=xformers
pip install spconv-cu120                                                     # shared with UniRig
export TORCH_CUDA_ARCH_LIST="12.0" FORCE_CUDA=1
pip install --no-build-isolation git+https://github.com/NVlabs/nvdiffrast.git
pip install --no-build-isolation git+https://github.com/JeffreyXiang/diffoctreerast.git
pip install --no-build-isolation git+https://github.com/JeffreyXiang/diff-gaussian-rasterization.git@trellis
pip install pillow trimesh rembg onnxruntime "imageio[ffmpeg]" igraph xatlas pymeshlab
```
Run API: `TrellisImageTo3DPipeline.from_pretrained("microsoft/TRELLIS-image-large")` →
`run(image, formats=["mesh","gaussian"])` → `postprocessing_utils.to_glb(...).export()`.
Set `ATTN_BACKEND=xformers`, `SPCONV_ALGO=native`, `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.

---

## 6. Optional / future

- **Photogrammetry** (real-object capture): Meshroom (AliceVision) / COLMAP. Needs retopo before rigging.
- **Stable Fast 3D**: lowest-install-risk upgrade over TripoSR if everything else proves too painful.

---

## 7. Known Blackwell gotchas

- **TRELLIS.2 `flexgemm` silent failure on sm_120** (#102 / #157) — verify with an early test; fall back to §5.
- **Wheel/torch mismatch** — TRELLIS.2 prebuilt wheels must match ComfyUI's exact cp311 + torch (2.7 vs 2.8).
- **Silent CPU-only extension builds** (WSL) — always `--no-build-isolation` with torch pre-installed.
- **`libnvptxcompiler.so` missing** in some CUDA installers — breaks spconv/flash-attn PTX JIT.
- **`numpy` upgrade** breaks UniRig — pin `numpy==1.26.4` last.

---

## 8. Immediate next step (blocked on this)

**Start the Windows ComfyUI server so the MCP can reach it** (it was unreachable on 2026-06-13), and confirm its **Python (expect 3.11) and torch version (2.7 vs 2.8)** so the correct prebuilt Blackwell wheels are chosen. Then: install node → wheels → GGUF (Q8) → test-generate.
