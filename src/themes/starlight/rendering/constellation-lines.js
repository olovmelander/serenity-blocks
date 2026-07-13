/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Starlight — Constellation Renderer
 *
 * Draws the ConstellationController's figure as glowing warm-gold NODE stars +
 * silver-cyan LINES that grow between them (arc-length reveal via per-edge
 * progress). Two instanced billboard meshes whose attributes wrap the
 * controller's Float32Arrays directly (mutate there, flag needsUpdate here).
 * Additive + bloom-eligible so the post pass carries the magic. Uses the proven
 * InstancedBufferGeometry + attribute() pattern (renders on both backends).
 */
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraProjectionMatrix,
    cameraViewMatrix,
    exp,
    float,
    length,
    max,
    positionLocal,
    smoothstep,
    uniform,
    uv,
    vec3,
    vec4,
} from 'three/tsl';
import { MAX_NODES, MAX_EDGES } from '../sim/constellations.js';

function quad(yFrom, yTo) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('position', new THREE.Float32BufferAttribute([
        -0.5, yFrom, 0,
        0.5, yFrom, 0,
        0.5, yTo, 0,
        -0.5, yTo, 0,
    ], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    return g;
}

export function createConstellationRenderer(controller, options = {}) {
    const uIntensity = uniform(options.intensity ?? 1.2);
    const uNodeSize = uniform(options.nodeSize ?? 0.7);
    const uWidth = uniform(options.lineWidth ?? 0.16);

    const group = new THREE.Group();

    // ── Nodes (gold glowing stars) ──
    const nodeGeo = quad(-0.5, 0.5);
    const aNodePos = new THREE.InstancedBufferAttribute(controller.nodePos, 3);
    const aNodeScale = new THREE.InstancedBufferAttribute(controller.nodeScale, 1);
    const aNodeAlpha = new THREE.InstancedBufferAttribute(controller.nodeAlpha, 1);
    [aNodePos, aNodeScale, aNodeAlpha].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    nodeGeo.setAttribute('aNodePos', aNodePos);
    nodeGeo.setAttribute('aNodeScale', aNodeScale);
    nodeGeo.setAttribute('aNodeAlpha', aNodeAlpha);
    nodeGeo.instanceCount = MAX_NODES;

    const nodeMat = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    nodeMat.vertexNode = Fn(() => {
        const pos = attribute('aNodePos', 'vec3');
        const scl = attribute('aNodeScale', 'float');
        const vp = cameraViewMatrix.mul(vec4(pos, 1.0)).toVar();
        const size = uNodeSize.mul(scl);
        const off = positionLocal.xy.mul(size);
        vp.x.addAssign(off.x);
        vp.y.addAssign(off.y);
        return cameraProjectionMatrix.mul(vp);
    })();
    const nodeColor = Fn(() => {
        const alpha = attribute('aNodeAlpha', 'float');
        const uvc = uv().sub(0.5);
        const d = length(uvc).mul(2.0);
        const core = exp(d.mul(d).mul(-4.0));
        const col = vec3(1.0, 0.81, 0.48); // warm gold "this is special"
        return vec4(col.mul(core).mul(alpha).mul(uIntensity), core.mul(alpha));
    })();
    nodeMat.colorNode = nodeColor;
    nodeMat.emissiveNode = nodeColor.rgb;
    nodeMat.userData.emitsBloom = true;
    const nodeMesh = new THREE.Mesh(nodeGeo, nodeMat);
    nodeMesh.frustumCulled = false;
    nodeMesh.renderOrder = 8;
    group.add(nodeMesh);

    // ── Edges (silver-cyan growing lines) ──
    const edgeGeo = quad(0.0, 1.0);
    const aEdgeA = new THREE.InstancedBufferAttribute(controller.edgeA, 3);
    const aEdgeB = new THREE.InstancedBufferAttribute(controller.edgeB, 3);
    const aEdgeProgress = new THREE.InstancedBufferAttribute(controller.edgeProgress, 1);
    const aEdgeAlpha = new THREE.InstancedBufferAttribute(controller.edgeAlpha, 1);
    [aEdgeA, aEdgeB, aEdgeProgress, aEdgeAlpha].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    edgeGeo.setAttribute('aEdgeA', aEdgeA);
    edgeGeo.setAttribute('aEdgeB', aEdgeB);
    edgeGeo.setAttribute('aEdgeProgress', aEdgeProgress);
    edgeGeo.setAttribute('aEdgeAlpha', aEdgeAlpha);
    edgeGeo.instanceCount = MAX_EDGES;

    const edgeMat = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    edgeMat.vertexNode = Fn(() => {
        const A = attribute('aEdgeA', 'vec3');
        const B = attribute('aEdgeB', 'vec3');
        const prog = attribute('aEdgeProgress', 'float');
        const dirw = B.sub(A).toVar();
        const len = length(dirw);
        const dirn = dirw.div(max(len, float(0.0001)));
        const perp = vec3(dirn.y.negate(), dirn.x, 0.0); // in-plane perpendicular
        const along = positionLocal.y.mul(prog); // arc-length reveal (head→tip)
        const worldPos = A.add(dirw.mul(along)).add(perp.mul(positionLocal.x.mul(uWidth)));
        return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(worldPos, 1.0)));
    })();
    const edgeColor = Fn(() => {
        const alpha = attribute('aEdgeAlpha', 'float');
        const across = abs(uv().x.sub(0.5)).mul(2.0);
        const widthFall = smoothstep(0.0, 1.0, across).oneMinus();
        const col = vec3(0.62, 0.91, 1.0); // silver-cyan
        return vec4(col.mul(widthFall).mul(alpha).mul(uIntensity), widthFall.mul(alpha));
    })();
    edgeMat.colorNode = edgeColor;
    edgeMat.emissiveNode = edgeColor.rgb;
    edgeMat.userData.emitsBloom = true;
    const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
    edgeMesh.frustumCulled = false;
    edgeMesh.renderOrder = 7;
    group.add(edgeMesh);

    group.visible = false; // idle: hidden until a sign is on screen

    return {
        group,
        uniforms: { uIntensity, uNodeSize, uWidth },
        // Idle-gated: an empty sign pool pays no attribute re-upload and no draw calls.
        update() {
            const active = controller.hasActive();
            group.visible = active;
            if (!active) return;
            aNodePos.needsUpdate = true;
            aNodeScale.needsUpdate = true;
            aNodeAlpha.needsUpdate = true;
            aEdgeA.needsUpdate = true;
            aEdgeB.needsUpdate = true;
            aEdgeProgress.needsUpdate = true;
            aEdgeAlpha.needsUpdate = true;
        },
        dispose() {
            nodeGeo.dispose();
            nodeMat.dispose();
            edgeGeo.dispose();
            edgeMat.dispose();
        },
    };
}
