"""Compact, deterministic GLB writer for the Fall grove assets.

Blender's own exporter writes float32 everything; the grove ships tens of thousands of
leaf and bark vertices, so this writer stores quantised attributes (KHR_mesh_quantization)
and point-cloud "instance" primitives with application attributes (`_ROT`, `_PARAMS`...).
The loader in src/themes/fall/fall-assets.js dequantises positions once at load.
"""

import json
import struct

import numpy as np

_COMPONENT = {
    np.dtype("int8"): 5120,
    np.dtype("uint8"): 5121,
    np.dtype("int16"): 5122,
    np.dtype("uint16"): 5123,
    np.dtype("uint32"): 5125,
    np.dtype("float32"): 5126,
}
_TYPE = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


def quantize_unit(values, dtype):
    """Map floats in [-1, 1] (signed) or [0, 1] (unsigned) to a normalised integer type."""
    info = np.iinfo(dtype)
    values = np.asarray(values, dtype=np.float64)
    if info.min < 0:
        return np.clip(np.round(values * info.max), -info.max, info.max).astype(dtype)
    return np.clip(np.round(values * info.max), 0, info.max).astype(dtype)


class GlbWriter:
    def __init__(self, generator="Serenity Blocks - Fall grove (Blender authoring)"):
        self.doc = {
            "asset": {"version": "2.0", "generator": generator},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [{}],
            "extensionsUsed": ["KHR_mesh_quantization"],
            "extensionsRequired": ["KHR_mesh_quantization"],
        }
        self._chunks = []
        self._length = 0

    def _view(self, payload, target=None, stride=None):
        padding = (-self._length) % 4
        if padding:
            self._chunks.append(b"\x00" * padding)
            self._length += padding
        view = {"buffer": 0, "byteOffset": self._length, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        if stride is not None:
            view["byteStride"] = stride
        self._chunks.append(payload)
        self._length += len(payload)
        self.doc["bufferViews"].append(view)
        return len(self.doc["bufferViews"]) - 1

    def accessor(self, array, normalized=False, target=ARRAY_BUFFER, bounds=False):
        """Add one accessor. Vertex rows are padded to a 4-byte stride as glTF requires."""
        array = np.ascontiguousarray(array)
        if array.ndim == 1:
            array = array.reshape(-1, 1)
        count, width = array.shape
        component = _COMPONENT[array.dtype]
        row = array.dtype.itemsize * width
        stride = None
        payload_array = array
        if target == ARRAY_BUFFER and row % 4:
            stride = row + ((-row) % 4)
            padded = np.zeros((count, stride // array.dtype.itemsize), dtype=array.dtype)
            padded[:, :width] = array
            payload_array = padded
        view = self._view(payload_array.tobytes(), target, stride)
        accessor = {"bufferView": view, "componentType": component, "count": int(count), "type": _TYPE[width]}
        if normalized:
            accessor["normalized"] = True
        if bounds:
            accessor["min"] = [float(v) for v in array.min(axis=0)]
            accessor["max"] = [float(v) for v in array.max(axis=0)]
        self.doc["accessors"].append(accessor)
        return len(self.doc["accessors"]) - 1

    def add_mesh(self, name, attributes, indices=None, mode=4, extras=None, position_bits=16):
        """Add a mesh node.

        `attributes` maps a glTF semantic to (array, normalized). POSITION is given as float
        metres and stored as normalised int16 with the node's scale/translation restoring it.
        """
        prepared = {}
        node = {"name": name}
        for semantic, (array, normalized) in attributes.items():
            array = np.asarray(array)
            if semantic == "POSITION":
                array = array.astype(np.float64)
                low = array.min(axis=0)
                high = array.max(axis=0)
                centre = (low + high) * 0.5
                half = np.maximum((high - low) * 0.5, 1e-6)
                if position_bits == 16:
                    quantised = quantize_unit((array - centre) / half, np.int16)
                    prepared[semantic] = self.accessor(quantised, normalized=True, bounds=True)
                    # normalised int16 decodes to q / 32767, so the node restores metres.
                    node["translation"] = [float(v) for v in centre]
                    node["scale"] = [float(v) for v in half]
                else:
                    prepared[semantic] = self.accessor(array.astype(np.float32), bounds=True)
            else:
                prepared[semantic] = self.accessor(array, normalized=normalized)
        primitive = {"attributes": prepared, "mode": mode}
        if indices is not None:
            indices = np.asarray(indices).reshape(-1)
            dtype = np.uint16 if int(indices.max(initial=0)) < 65535 else np.uint32
            primitive["indices"] = self.accessor(indices.astype(dtype), target=ELEMENT_ARRAY_BUFFER)
        mesh = {"name": name, "primitives": [primitive]}
        self.doc["meshes"].append(mesh)
        node["mesh"] = len(self.doc["meshes"]) - 1
        if extras:
            node["extras"] = extras
        self.doc["nodes"].append(node)
        self.doc["scenes"][0]["nodes"].append(len(self.doc["nodes"]) - 1)
        return node

    def set_extras(self, extras):
        self.doc["scenes"][0]["extras"] = extras

    def write(self, path):
        binary = b"".join(self._chunks)
        binary += b"\x00" * ((-len(binary)) % 4)
        self.doc["buffers"][0]["byteLength"] = len(binary)
        text = json.dumps(self.doc, separators=(",", ":"), sort_keys=True).encode("utf-8")
        text += b" " * ((-len(text)) % 4)
        total = 12 + 8 + len(text) + 8 + len(binary)
        with open(path, "wb") as handle:
            handle.write(struct.pack("<III", 0x46546C67, 2, total))
            handle.write(struct.pack("<II", len(text), 0x4E4F534A))
            handle.write(text)
            handle.write(struct.pack("<II", len(binary), 0x004E4942))
            handle.write(binary)
        return total
