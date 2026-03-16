import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
    ODYSSEY_LAYOUT_DATA,
    buildOdysseyPresentationLayout,
    createPatchReadyOdysseyLayoutSnippet,
    parseOdysseyLayoutData,
    serializeOdysseyLayoutData,
} from '../../core/odyssey/data/odyssey-layout.js';
import {
    getChapterPathRange,
    ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET,
} from './path-utils.js';
import {
    appendTailControlPoint,
    densifyControlPointSegments,
    getKeyboardNudgeStep,
    insertControlPointAfterIndex,
    moveLevelAlongPath,
    retimeChapterBoundary,
    spreadAllChapterLevelsEvenly,
    spreadChapterLevelsEvenly,
    subdivideControlPointSegments,
    stretchPathControlPoints,
} from './odyssey-layout-editor-utils.js';
import { MOUNTAIN_AURORA_CURTAIN_CONFIGS } from './chapter-environments/shared/mountain-aurora.js';

const HANDLE_MODE = Object.freeze({
    PATH: 'path',
    LEVEL: 'level',
    CHAPTER: 'chapter',
});

const DRAG_PLANE_MODE = Object.freeze({
    FREE: 'free',
    XZ: 'xz',
    YZ: 'yz',
});

function isEditableKeyboardTarget(target) {
    if (!target) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    const tagName = typeof target.tagName === 'string'
        ? target.tagName.toUpperCase()
        : '';
    return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tagName);
}

function createButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `
        border: 1px solid rgba(73, 255, 233, 0.28);
        background: rgba(10, 18, 34, 0.88);
        color: #dffdf8;
        padding: 8px 10px;
        border-radius: 10px;
        font: 600 12px/1.2 "JetBrains Mono", "Fira Code", monospace;
        cursor: pointer;
    `;
    button.addEventListener('click', onClick);
    return button;
}

function applyButtonActiveState(button, active) {
    button.style.background = active ? 'rgba(20, 171, 153, 0.92)' : 'rgba(10, 18, 34, 0.88)';
    button.style.borderColor = active ? 'rgba(73, 255, 233, 0.7)' : 'rgba(73, 255, 233, 0.28)';
    button.style.color = active ? '#04151a' : '#dffdf8';
}

function applyButtonEnabledState(button, enabled) {
    button.disabled = !enabled;
    button.style.opacity = enabled ? '1' : '0.45';
    button.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

function cloneLayoutSnapshot(layout) {
    return {
        controlPoints: (layout?.controlPoints || []).map((point) => ({ ...point })),
        levelPositionsById: { ...(layout?.levelPositionsById || {}) },
    };
}

function areLayoutSnapshotsEqual(left, right) {
    const leftControlPoints = left?.controlPoints || [];
    const rightControlPoints = right?.controlPoints || [];
    if (leftControlPoints.length !== rightControlPoints.length) {
        return false;
    }

    for (let index = 0; index < leftControlPoints.length; index += 1) {
        const leftPoint = leftControlPoints[index];
        const rightPoint = rightControlPoints[index];
        if (
            leftPoint?.x !== rightPoint?.x
            || leftPoint?.y !== rightPoint?.y
            || leftPoint?.z !== rightPoint?.z
        ) {
            return false;
        }
    }

    const leftEntries = Object.entries(left?.levelPositionsById || {});
    const rightEntries = Object.entries(right?.levelPositionsById || {});
    if (leftEntries.length !== rightEntries.length) {
        return false;
    }

    return leftEntries.every(([levelId, position]) => right?.levelPositionsById?.[levelId] === position);
}

export class OdysseyLayoutEditor {
    constructor(boardController) {
        this.boardController = boardController;
        this.scene = boardController.scene;
        this.camera = boardController.camera;
        this.renderer = boardController.renderer;
        this.container = boardController.container;
        this.mode = HANDLE_MODE.PATH;
        this.dragPlaneMode = DRAG_PLANE_MODE.FREE;
        this.rootGroup = new THREE.Group();
        this.rootGroup.name = 'odyssey-layout-editor';
        this.transformControls = null;
        this.cameraProbe = null;
        this.referenceGroup = new THREE.Group();
        this.pathHandleGroup = new THREE.Group();
        this.levelHandleGroup = new THREE.Group();
        this.chapterHandleGroup = new THREE.Group();
        this.pathHandles = [];
        this.levelHandles = new Map();
        this.chapterHandles = new Map();
        this.selectedDescriptor = null;
        this.dragState = null;
        this.pendingLayout = null;
        this.isApplyingLayout = false;
        this.panel = null;
        this.textArea = null;
        this.statusLabel = null;
        this.selectionLabel = null;
        this.selectionDetailLabel = null;
        this.modeHintLabel = null;
        this.modeButtons = new Map();
        this.dragPlaneButtons = new Map();
        this.undoButton = null;
        this.undoStack = [];
        this.maxUndoStackSize = 80;
        this.dragUndoBaseline = null;
        this.dragUndoRecorded = false;
        this.chapterDragDiagnostics = null;
        this.boundHandlers = {
            pointerdown: this.onPointerDown.bind(this),
            pointermove: this.onPointerMove.bind(this),
            pointerup: this.onPointerUp.bind(this),
            click: this.onClick.bind(this),
            keydown: this.onKeyDown.bind(this),
        };
        this.pointer = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.sampleVector = new THREE.Vector3();
        this.projectedSample = new THREE.Vector3();
        this.dragIntersection = new THREE.Vector3();
        this.dragPlaneNormal = new THREE.Vector3();
        this.suppressNextClick = false;
    }

    initialize() {
        this.scene.add(this.rootGroup);
        this.rootGroup.add(this.referenceGroup);
        this.rootGroup.add(this.pathHandleGroup);
        this.rootGroup.add(this.levelHandleGroup);
        this.rootGroup.add(this.chapterHandleGroup);

        this.createTransformControls();
        this.createEditorHud();
        this.createCameraProbe();
        this.rebuildHandleMeshes();
        this.refreshFromBoardLayout();
        this.setMode(HANDLE_MODE.PATH);

        const canvas = this.renderer?.domElement;
        canvas?.addEventListener('pointerdown', this.boundHandlers.pointerdown);
        canvas?.addEventListener('pointermove', this.boundHandlers.pointermove);
        canvas?.addEventListener('pointerup', this.boundHandlers.pointerup);
        canvas?.addEventListener('click', this.boundHandlers.click);
        document.addEventListener('keydown', this.boundHandlers.keydown, true);
    }

    createTransformControls() {
        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.setMode('translate');
        this.transformControls.setSpace('world');
        this.transformControls.addEventListener('mouseDown', () => {
            if (
                this.mode !== HANDLE_MODE.PATH
                || !this.selectedDescriptor
                || this.selectedDescriptor.type !== 'path'
            ) {
                return;
            }

            this.beginUndoTransaction();
        });
        this.transformControls.addEventListener('objectChange', () => {
            if (
                this.mode !== HANDLE_MODE.PATH
                || !this.selectedDescriptor?.type
                || this.selectedDescriptor.type !== 'path'
            ) {
                return;
            }

            const workingLayout = this.getWorkingLayoutData();
            const controlPoints = this.pathHandles.map((handle) => ({
                x: handle.position.x,
                y: handle.position.y,
                z: handle.position.z,
            }));
            this.queueLayoutApply({
                controlPoints,
                levelPositionsById: workingLayout.levelPositionsById,
            }, { recordUndoFromDrag: true });
            this.updateSelectionLabel();
        });
        this.transformControls.addEventListener('mouseUp', () => {
            this.endUndoTransaction();
        });
        this.scene.add(this.transformControls);
        this.applyDragPlaneMode();
    }

    createEditorHud() {
        const panel = document.createElement('div');
        panel.setAttribute('data-odyssey-wheel-lock', 'true');
        panel.style.cssText = `
            position: fixed;
            top: 22px;
            left: 22px;
            width: 340px;
            z-index: 1600;
            background: rgba(5, 10, 20, 0.9);
            border: 1px solid rgba(73, 255, 233, 0.22);
            border-radius: 18px;
            box-shadow: 0 16px 60px rgba(0, 0, 0, 0.38);
            color: #dffdf8;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            font: 500 12px/1.45 "JetBrains Mono", "Fira Code", monospace;
            backdrop-filter: blur(18px);
        `;

        const title = document.createElement('div');
        title.textContent = 'Odyssey Layout Editor';
        title.style.cssText = 'font-size: 14px; font-weight: 800; color: #49ffe9;';
        panel.appendChild(title);

        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';
        [
            [HANDLE_MODE.PATH, 'Path'],
            [HANDLE_MODE.LEVEL, 'Levels'],
            [HANDLE_MODE.CHAPTER, 'Chapters'],
        ].forEach(([mode, label]) => {
            const button = createButton(label, () => this.setMode(mode));
            this.modeButtons.set(mode, button);
            modeRow.appendChild(button);
        });
        panel.appendChild(modeRow);

        const dragRow = document.createElement('div');
        dragRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;';
        [
            [DRAG_PLANE_MODE.FREE, 'Free'],
            [DRAG_PLANE_MODE.XZ, 'XZ'],
            [DRAG_PLANE_MODE.YZ, 'YZ'],
        ].forEach(([mode, label]) => {
            const button = createButton(label, () => this.setDragPlaneMode(mode));
            this.dragPlaneButtons.set(mode, button);
            dragRow.appendChild(button);
        });
        panel.appendChild(dragRow);

        this.selectionLabel = document.createElement('div');
        this.selectionLabel.style.cssText = 'min-height: 38px; color: #9fe9dd;';
        panel.appendChild(this.selectionLabel);

        this.selectionDetailLabel = document.createElement('div');
        this.selectionDetailLabel.style.cssText = 'min-height: 18px; color: #78c8bf; font-size: 11px;';
        panel.appendChild(this.selectionDetailLabel);

        this.modeHintLabel = document.createElement('div');
        this.modeHintLabel.style.cssText = 'color: #78c8bf; font-size: 11px;';
        panel.appendChild(this.modeHintLabel);

        const toolGrid = document.createElement('div');
        toolGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;';
        toolGrid.appendChild(createButton('Insert After', () => this.insertPathPointAfterSelection()));
        toolGrid.appendChild(createButton('Subdivide Path', () => this.subdividePathControlPoints()));
        toolGrid.appendChild(createButton('Dense Path', () => this.densifyFullPathControlPoints()));
        toolGrid.appendChild(createButton('Spread Chapter', () => this.spreadSelectedChapterLevels()));
        toolGrid.appendChild(createButton('Spread All', () => this.spreadAllChapterLevels()));
        toolGrid.appendChild(createButton('Stretch After', () => this.extendPathAfterSelection()));
        toolGrid.appendChild(createButton('Append Tail', () => this.appendPathTailPoint()));
        panel.appendChild(toolGrid);

        const actionGrid = document.createElement('div');
        actionGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;';
        this.undoButton = createButton('Undo Last', () => this.undoLatestChange());
        actionGrid.appendChild(this.undoButton);
        actionGrid.appendChild(createButton('Copy Layout JSON', () => this.copyLayoutJson()));
        actionGrid.appendChild(createButton('Copy JS Snippet', () => this.copyLayoutSnippet()));
        actionGrid.appendChild(createButton('Copy Control Points', () => this.copyControlPoints()));
        actionGrid.appendChild(createButton('Copy Level Positions', () => this.copyLevelPositions()));
        actionGrid.appendChild(createButton('Copy Chapters', () => this.copyChapterPositions()));
        actionGrid.appendChild(createButton('Reset Layout', () => this.resetLayout()));
        panel.appendChild(actionGrid);

        this.textArea = document.createElement('textarea');
        this.textArea.spellcheck = false;
        this.textArea.placeholder = 'Paste layout JSON here, or use copy/export buttons above.';
        this.textArea.style.cssText = `
            width: 100%;
            min-height: 160px;
            resize: vertical;
            border-radius: 12px;
            border: 1px solid rgba(73, 255, 233, 0.18);
            background: rgba(4, 8, 16, 0.88);
            color: #dffdf8;
            padding: 10px;
            font: 500 12px/1.45 "JetBrains Mono", "Fira Code", monospace;
        `;
        panel.appendChild(this.textArea);

        const importButton = createButton('Import Pasted JSON', () => this.importLayoutFromTextArea());
        panel.appendChild(importButton);

        this.statusLabel = document.createElement('div');
        this.statusLabel.style.cssText = 'min-height: 18px; color: #78c8bf;';
        panel.appendChild(this.statusLabel);

        document.body.appendChild(panel);
        this.panel = panel;
        this.updateUndoButtonState();
    }

    createCameraProbe() {
        const geometry = new THREE.SphereGeometry(1.1, 18, 18);
        const material = new THREE.MeshBasicMaterial({
            color: 0x49ffe9,
            transparent: true,
            opacity: 0.88,
        });
        this.cameraProbe = new THREE.Mesh(geometry, material);
        this.cameraProbe.renderOrder = 100;
        this.referenceGroup.add(this.cameraProbe);
    }

    rebuildHandleMeshes() {
        this.clearHandleGroups();

        const layout = this.boardController.getLayoutData();
        layout.controlPoints.forEach((point, index) => {
            const geometry = new THREE.SphereGeometry(1.05, 20, 20);
            const material = new THREE.MeshStandardMaterial({
                color: 0xffbb55,
                emissive: 0xff6600,
                emissiveIntensity: 0.9,
                metalness: 0.2,
                roughness: 0.32,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(point.x, point.y, point.z);
            mesh.userData = { handleType: 'path', index };
            this.pathHandles.push(mesh);
            this.pathHandleGroup.add(mesh);
        });

        this.boardController.levelData.forEach((level) => {
            const geometry = new THREE.OctahedronGeometry(level.isChapterStart ? 0.95 : 0.58, 0);
            const color = this.boardController.nodeManager?.getChapterColor?.(level.chapter)?.getHex?.() ?? 0x49ffe9;
            const material = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: level.isChapterStart ? 0.9 : 0.45,
                metalness: 0.18,
                roughness: 0.38,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData = {
                handleType: 'level',
                levelId: level.id,
            };
            this.levelHandles.set(level.id, mesh);
            this.levelHandleGroup.add(mesh);
        });

        this.boardController.presentationLayout.chapterRanges.forEach((range) => {
            if (range.chapterId === 1) {
                return;
            }
            const geometry = new THREE.TorusGeometry(1.6, 0.18, 10, 44);
            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.92,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.userData = {
                handleType: 'chapter',
                chapterId: range.chapterId,
            };
            this.chapterHandles.set(range.chapterId, mesh);
            this.chapterHandleGroup.add(mesh);
        });

        this.rebuildReferenceOverlays();
    }

    clearHandleGroups() {
        [this.referenceGroup, this.pathHandleGroup, this.levelHandleGroup, this.chapterHandleGroup].forEach((group) => {
            const removableChildren = [...group.children];
            removableChildren.forEach((child) => {
                if (child === this.cameraProbe) {
                    return;
                }
                child.geometry?.dispose?.();
                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => material.dispose?.());
                } else {
                    child.material?.dispose?.();
                }
                group.remove(child);
            });
        });

        this.pathHandles = [];
        this.levelHandles.clear();
        this.chapterHandles.clear();
    }

    rebuildReferenceOverlays() {
        const chapterPositions = this.boardController.presentationLayout.chapterPositions || [];
        for (let sourceChapter = 1; sourceChapter < (chapterPositions.length - 1); sourceChapter += 1) {
            const boundaryPosition = chapterPositions[sourceChapter];
            const transition = this.boardController.environmentManager?.getBoundaryTransition(sourceChapter);
            const seamWidth = transition?.seamWidth || 0.018;
            const seamStart = Math.max(0, boundaryPosition - seamWidth);
            const seamEnd = Math.min(1, boundaryPosition + seamWidth);
            const start = this.boardController.pathRenderer.pathCurve.getPointAt(seamStart);
            const end = this.boardController.pathRenderer.pathCurve.getPointAt(seamEnd);
            const boundary = this.boardController.pathRenderer.pathCurve.getPointAt(boundaryPosition);
            const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
            const material = new THREE.LineBasicMaterial({
                color: 0x49ffe9,
                transparent: true,
                opacity: 0.55,
            });
            const line = new THREE.Line(geometry, material);
            line.name = `seam-${sourceChapter}-${sourceChapter + 1}`;
            this.referenceGroup.add(line);

            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.45, 12, 12),
                new THREE.MeshBasicMaterial({
                    color: 0x49ffe9,
                    transparent: true,
                    opacity: 0.9,
                }),
            );
            sphere.position.copy(boundary);
            this.referenceGroup.add(sphere);
        }

        const chapter3Range = getChapterPathRange(3);
        if (chapter3Range) {
            const waterSurfaceY = chapter3Range.start.y - ODYSSEY_SURFACE_BREAKOUT_Y_OFFSET;
            const waterGeometry = new THREE.PlaneGeometry(2400, 1800, 1, 1);
            const waterMaterial = new THREE.MeshBasicMaterial({
                color: 0x3ad5ff,
                wireframe: true,
                transparent: true,
                opacity: 0.18,
                side: THREE.DoubleSide,
            });
            const waterPlane = new THREE.Mesh(waterGeometry, waterMaterial);
            waterPlane.name = 'odyssey-water-surface-reference';
            waterPlane.rotation.x = -Math.PI / 2;
            waterPlane.position.set(0, waterSurfaceY, -240);
            this.referenceGroup.add(waterPlane);
        }

        MOUNTAIN_AURORA_CURTAIN_CONFIGS.slice(0, 3).forEach((config, index) => {
            const plane = new THREE.Mesh(
                new THREE.PlaneGeometry(config.width, config.height),
                new THREE.MeshBasicMaterial({
                    color: 0xa7c6ff,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.12,
                }),
            );
            plane.position.set(config.x, config.y, config.z);
            plane.rotation.y = config.rotY;
            plane.name = `mountain-anchor-${index + 1}`;
            this.referenceGroup.add(plane);
        });
    }

    refreshFromBoardLayout() {
        const layout = this.boardController.getLayoutData();
        if (layout.controlPoints.length !== this.pathHandles.length) {
            this.rebuildHandleMeshes();
        } else {
            this.rebuildReferenceOverlaysLive();
        }
        layout.controlPoints.forEach((point, index) => {
            const handle = this.pathHandles[index];
            if (handle) {
                handle.position.set(point.x, point.y, point.z);
            }
        });

        this.boardController.levelData.forEach((level) => {
            const handle = this.levelHandles.get(level.id);
            if (!handle) {
                return;
            }

            const point = this.boardController.pathRenderer.pathCurve.getPointAt(level.pathPosition);
            handle.position.copy(point).add(new THREE.Vector3(0, 1.8, 0));
        });

        this.boardController.presentationLayout.chapterRanges.forEach((range) => {
            const handle = this.chapterHandles.get(range.chapterId);
            if (!handle) {
                return;
            }

            const point = this.boardController.pathRenderer.pathCurve.getPointAt(range.startPosition);
            const tangent = this.boardController.pathRenderer.pathCurve.getTangentAt(range.startPosition);
            handle.position.copy(point);
            handle.lookAt(point.clone().add(tangent));
        });

        this.updateSelectionLabel();
        this.updateStatus('Editor ready.');
    }

    rebuildReferenceOverlaysLive() {
        [...this.referenceGroup.children]
            .filter((child) => child !== this.cameraProbe)
            .forEach((child) => {
                child.geometry?.dispose?.();
                child.material?.dispose?.();
                this.referenceGroup.remove(child);
            });

        this.rebuildReferenceOverlays();
    }

    update() {
        if (this.cameraProbe && this.boardController.cameraController && this.boardController.pathRenderer?.pathCurve) {
            const progress = this.boardController.cameraController.getCurrentPosition();
            const point = this.boardController.pathRenderer.pathCurve.getPointAt(progress);
            this.cameraProbe.position.copy(point);
        }
    }

    setMode(mode) {
        this.mode = mode;
        this.pathHandleGroup.visible = mode === HANDLE_MODE.PATH;
        this.levelHandleGroup.visible = mode === HANDLE_MODE.LEVEL;
        this.chapterHandleGroup.visible = mode === HANDLE_MODE.CHAPTER;

        this.modeButtons.forEach((button, buttonMode) => {
            applyButtonActiveState(button, buttonMode === mode);
        });

        if (mode !== HANDLE_MODE.PATH) {
            this.transformControls.detach();
        }

        this.updateModeHint();
        this.updateSelectionLabel();
    }

    setDragPlaneMode(mode) {
        this.dragPlaneMode = mode;
        this.dragPlaneButtons.forEach((button, buttonMode) => {
            applyButtonActiveState(button, buttonMode === mode);
        });
        this.applyDragPlaneMode();
    }

    applyDragPlaneMode() {
        if (!this.transformControls) {
            return;
        }

        if (this.dragPlaneMode === DRAG_PLANE_MODE.FREE) {
            this.transformControls.showX = true;
            this.transformControls.showY = true;
            this.transformControls.showZ = true;
            return;
        }

        if (this.dragPlaneMode === DRAG_PLANE_MODE.XZ) {
            this.transformControls.showX = true;
            this.transformControls.showY = false;
            this.transformControls.showZ = true;
            return;
        }

        this.transformControls.showX = false;
        this.transformControls.showY = true;
        this.transformControls.showZ = true;
    }

    onPointerDown(event) {
        if (this.mode === HANDLE_MODE.PATH) {
            const handle = this.pickHandle(event, this.pathHandles);
            if (handle) {
                this.selectDescriptor({ type: 'path', index: handle.userData.index });
                this.transformControls.attach(handle);
                this.beginUndoTransaction();
                this.dragState = this.createPathDragState(handle);
                this.suppressNextClick = true;
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            return;
        }

        if (this.mode === HANDLE_MODE.LEVEL) {
            const handle = this.pickHandle(event, [...this.levelHandles.values()]);
            if (handle) {
                this.selectDescriptor({ type: 'level', levelId: handle.userData.levelId });
                this.beginUndoTransaction();
                this.dragState = { type: 'level', levelId: handle.userData.levelId };
                this.suppressNextClick = true;
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            return;
        }

        const handle = this.pickHandle(event, [...this.chapterHandles.values()]);
        if (handle) {
            this.selectDescriptor({ type: 'chapter', chapterId: handle.userData.chapterId });
            this.beginUndoTransaction();
            this.dragState = { type: 'chapter', chapterId: handle.userData.chapterId };
            this.suppressNextClick = true;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    onPointerMove(event) {
        if (this.dragState) {
            if (this.dragState.type === 'path') {
                const handle = this.pathHandles[this.dragState.index];
                const intersection = this.intersectPointerWithPlane(event, this.dragState.dragPlane);
                if (!handle || !intersection) {
                    return;
                }

                handle.position.copy(intersection);
                if (this.dragState.lockedX !== null) {
                    handle.position.x = this.dragState.lockedX;
                }
                if (this.dragState.lockedY !== null) {
                    handle.position.y = this.dragState.lockedY;
                }

                this.queueLayoutApply({
                    controlPoints: this.pathHandles.map((pointHandle) => ({
                        x: pointHandle.position.x,
                        y: pointHandle.position.y,
                        z: pointHandle.position.z,
                    })),
                    levelPositionsById: this.boardController.getLayoutData().levelPositionsById,
                });
                this.updateSelectionLabel();
                if (this.renderer?.domElement?.style) {
                    this.renderer.domElement.style.cursor = 'grabbing';
                }
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            const nextPosition = this.findNearestCurvePositionFromPointer(event);
            if (!Number.isFinite(nextPosition)) {
                return;
            }

            if (this.dragState.type === 'level') {
                const workingLayout = this.getWorkingLayoutData();
                const orderedLevelIds = this.getOrderedLevelIds();
                const nextPositions = moveLevelAlongPath(
                    workingLayout.levelPositionsById,
                    orderedLevelIds,
                    this.dragState.levelId,
                    nextPosition,
                );
                this.queueLayoutApply({
                    controlPoints: workingLayout.controlPoints,
                    levelPositionsById: nextPositions,
                }, { recordUndoFromDrag: true });
            } else if (this.dragState.type === 'chapter') {
                const workingLayout = this.getWorkingLayoutData();
                const workingPresentationLayout = this.getWorkingPresentationLayout(workingLayout);
                const orderedLevelIds = this.getOrderedLevelIds();
                const chapterRetime = retimeChapterBoundary(
                    workingLayout.levelPositionsById,
                    orderedLevelIds,
                    workingPresentationLayout.chapterRanges,
                    this.dragState.chapterId,
                    nextPosition,
                );
                this.chapterDragDiagnostics = chapterRetime.diagnostics;
                this.queueLayoutApply({
                    controlPoints: workingLayout.controlPoints,
                    levelPositionsById: chapterRetime.levelPositionsById,
                }, { recordUndoFromDrag: true });
                this.updateSelectionLabel();
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        const activeObjects = this.mode === HANDLE_MODE.PATH
            ? this.pathHandles
            : null;
        const levelObjects = this.mode === HANDLE_MODE.LEVEL
            ? [...this.levelHandles.values()]
            : null;
        const chapterObjects = this.mode === HANDLE_MODE.CHAPTER
            ? [...this.chapterHandles.values()]
            : null;
        const hoveredObjects = activeObjects || levelObjects || chapterObjects || [];
        const hoveredHandle = this.pickHandle(event, hoveredObjects, false);
        if (this.renderer?.domElement?.style) {
            this.renderer.domElement.style.cursor = hoveredHandle ? 'grab' : 'default';
        }
    }

    onPointerUp(event) {
        if (!this.dragState) {
            return;
        }

        this.dragState = null;
        this.endUndoTransaction();
        this.suppressNextClick = true;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    onClick(event) {
        if (!this.suppressNextClick) {
            return;
        }

        this.suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    onKeyDown(event) {
        if (event.defaultPrevented) {
            return;
        }

        if (isEditableKeyboardTarget(event.target)) {
            return;
        }

        const isUndoShortcut = (event.ctrlKey || event.metaKey)
            && !event.shiftKey
            && event.key.toLowerCase() === 'z';
        if (isUndoShortcut) {
            this.undoLatestChange();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        const isChapterSelected = this.selectedDescriptor?.type === 'chapter';
        if (!isChapterSelected) {
            return;
        }

        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }

        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const step = getKeyboardNudgeStep(event);
        this.nudgeSelectedChapterBoundary(direction * step);
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    pickHandle(event, objects, consume = true) {
        if (!Array.isArray(objects) || objects.length === 0) {
            return null;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const hits = this.raycaster.intersectObjects(objects, false);
        if (consume && hits.length > 0) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        return hits[0]?.object || null;
    }

    createPathDragState(handle) {
        const dragPlane = new THREE.Plane();
        const lockedX = this.dragPlaneMode === DRAG_PLANE_MODE.YZ ? handle.position.x : null;
        const lockedY = this.dragPlaneMode === DRAG_PLANE_MODE.XZ ? handle.position.y : null;

        if (this.dragPlaneMode === DRAG_PLANE_MODE.XZ) {
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), handle.position);
        } else if (this.dragPlaneMode === DRAG_PLANE_MODE.YZ) {
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), handle.position);
        } else {
            this.camera.getWorldDirection(this.dragPlaneNormal);
            dragPlane.setFromNormalAndCoplanarPoint(this.dragPlaneNormal, handle.position);
        }

        return {
            type: 'path',
            index: handle.userData.index,
            dragPlane,
            lockedX,
            lockedY,
        };
    }

    intersectPointerWithPlane(event, plane) {
        if (!plane) {
            return null;
        }

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);

        const intersection = this.raycaster.ray.intersectPlane(plane, this.dragIntersection);
        return intersection ? this.dragIntersection.clone() : null;
    }

    findNearestCurvePositionFromPointer(event, sampleCount = 700) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const pointerY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const curve = this.boardController.pathRenderer?.pathCurve;
        if (!curve) {
            return Number.NaN;
        }

        let bestT = 0;
        let bestDistanceSq = Infinity;

        for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
            const t = sampleIndex / sampleCount;
            curve.getPointAt(t, this.sampleVector);
            this.projectedSample.copy(this.sampleVector).project(this.camera);

            const dx = this.projectedSample.x - pointerX;
            const dy = this.projectedSample.y - pointerY;
            const distanceSq = (dx * dx) + (dy * dy);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestT = t;
            }
        }

        return bestT;
    }

    selectDescriptor(descriptor) {
        this.selectedDescriptor = descriptor;
        if (descriptor?.type !== 'chapter') {
            this.chapterDragDiagnostics = null;
        }
        this.updateSelectionLabel();
    }

    beginUndoTransaction() {
        this.dragUndoBaseline = this.getWorkingLayoutData();
        this.dragUndoRecorded = false;
    }

    endUndoTransaction() {
        this.dragUndoBaseline = null;
        this.dragUndoRecorded = false;
    }

    getOrderedLevelIds() {
        return this.boardController.levelData.map((level) => level.id);
    }

    getWorkingLayoutData() {
        const sourceLayout = this.pendingLayout || this.boardController.getLayoutData();
        return cloneLayoutSnapshot(sourceLayout);
    }

    getWorkingPresentationLayout(layoutData = this.getWorkingLayoutData()) {
        return buildOdysseyPresentationLayout(this.boardController.levelData, layoutData);
    }

    getChapterRangeById(chapterId) {
        return this.boardController.presentationLayout.chapterRanges
            .find((range) => range.chapterId === chapterId) || null;
    }

    selectPathHandle(index) {
        const normalizedIndex = THREE.MathUtils.clamp(
            Number(index) || 0,
            0,
            Math.max(this.pathHandles.length - 1, 0),
        );
        this.selectDescriptor({ type: 'path', index: normalizedIndex });
        if (this.mode === HANDLE_MODE.PATH) {
            this.transformControls?.attach?.(this.pathHandles[normalizedIndex]);
        }
    }

    updateUndoButtonState() {
        if (!this.undoButton) {
            return;
        }

        applyButtonEnabledState(this.undoButton, this.undoStack.length > 0);
    }

    pushUndoSnapshot(layoutSnapshot) {
        const snapshot = cloneLayoutSnapshot(layoutSnapshot);
        const lastSnapshot = this.undoStack[this.undoStack.length - 1];
        if (lastSnapshot && areLayoutSnapshotsEqual(lastSnapshot, snapshot)) {
            return;
        }

        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxUndoStackSize) {
            this.undoStack.shift();
        }
        this.updateUndoButtonState();
    }

    maybeRecordDragUndo(layoutOverride) {
        if (!this.dragUndoBaseline || this.dragUndoRecorded) {
            return;
        }

        if (areLayoutSnapshotsEqual(this.dragUndoBaseline, layoutOverride)) {
            return;
        }

        this.pushUndoSnapshot(this.dragUndoBaseline);
        this.dragUndoRecorded = true;
    }

    async applyEditorLayout(layoutOverride, successMessage, options = {}) {
        const currentLayout = this.getWorkingLayoutData();
        if (!areLayoutSnapshotsEqual(currentLayout, layoutOverride) && options.recordUndo !== false) {
            this.pushUndoSnapshot(currentLayout);
        }
        const applied = await this.boardController.applyLayoutOverride(layoutOverride);
        if (!applied) {
            this.updateStatus('Layout update failed.');
            return false;
        }

        this.refreshFromBoardLayout();
        if (successMessage) {
            this.updateStatus(successMessage);
        }
        return true;
    }

    async undoLatestChange() {
        if (this.undoStack.length === 0) {
            this.updateStatus('No previous editor change to undo.');
            return;
        }

        const previousLayout = this.undoStack.pop();
        this.updateUndoButtonState();
        this.pendingLayout = null;
        this.endUndoTransaction();
        await this.applyEditorLayout(previousLayout, 'Latest editor change reverted.', {
            recordUndo: false,
        });
    }

    async spreadSelectedChapterLevels() {
        const chapterId = this.selectedDescriptor?.type === 'chapter'
            ? this.selectedDescriptor.chapterId
            : null;
        if (!chapterId) {
            this.updateStatus('Select a chapter boundary, then use Spread Chapter.');
            return;
        }

        const chapterRange = this.getChapterRangeById(chapterId);
        if (!chapterRange) {
            this.updateStatus(`Could not resolve Chapter ${chapterId}.`);
            return;
        }

        const workingLayout = this.getWorkingLayoutData();
        const workingPresentationLayout = this.getWorkingPresentationLayout(workingLayout);
        const workingChapterRange = workingPresentationLayout.chapterRanges
            .find((range) => range.chapterId === chapterId) || chapterRange;
        const nextPositions = spreadChapterLevelsEvenly(
            workingLayout.levelPositionsById,
            this.getOrderedLevelIds(),
            workingChapterRange,
        );

        await this.applyEditorLayout({
            controlPoints: workingLayout.controlPoints,
            levelPositionsById: nextPositions,
        }, `Chapter ${chapterId} levels spread evenly inside its boundaries.`);
    }

    async insertPathPointAfterSelection() {
        if (this.selectedDescriptor?.type !== 'path') {
            this.updateStatus('Select an orange path point, then use Insert After.');
            return;
        }

        const workingLayout = this.getWorkingLayoutData();
        const selectedIndex = this.selectedDescriptor.index;
        const nextControlPoints = selectedIndex >= (workingLayout.controlPoints.length - 1)
            ? appendTailControlPoint(workingLayout.controlPoints)
            : insertControlPointAfterIndex(workingLayout.controlPoints, selectedIndex);

        const applied = await this.applyEditorLayout({
            controlPoints: nextControlPoints,
            levelPositionsById: workingLayout.levelPositionsById,
        }, selectedIndex >= (workingLayout.controlPoints.length - 1)
            ? 'Added a new tail path point after the selected spline handle.'
            : 'Inserted a new spline handle after the selected path point.');
        if (applied) {
            this.selectPathHandle(Math.min(selectedIndex + 1, nextControlPoints.length - 1));
        }
    }

    async subdividePathControlPoints() {
        const workingLayout = this.getWorkingLayoutData();
        const nextControlPoints = subdivideControlPointSegments(workingLayout.controlPoints);
        if (nextControlPoints.length === workingLayout.controlPoints.length) {
            this.updateStatus('Path needs at least two control points to subdivide.');
            return;
        }

        const selectedIndex = this.selectedDescriptor?.type === 'path'
            ? this.selectedDescriptor.index
            : null;
        const applied = await this.applyEditorLayout({
            controlPoints: nextControlPoints,
            levelPositionsById: workingLayout.levelPositionsById,
        }, 'Inserted midpoint spline handles across the full path.');
        if (applied && Number.isInteger(selectedIndex)) {
            this.selectPathHandle(Math.min(selectedIndex * 2, nextControlPoints.length - 1));
        }
    }

    async densifyFullPathControlPoints(insertedPointsPerSegment = 3) {
        const workingLayout = this.getWorkingLayoutData();
        const nextControlPoints = densifyControlPointSegments(
            workingLayout.controlPoints,
            insertedPointsPerSegment,
        );
        if (nextControlPoints.length === workingLayout.controlPoints.length) {
            this.updateStatus('Path needs at least two control points to densify.');
            return;
        }

        const selectedIndex = this.selectedDescriptor?.type === 'path'
            ? this.selectedDescriptor.index
            : null;
        const applied = await this.applyEditorLayout({
            controlPoints: nextControlPoints,
            levelPositionsById: workingLayout.levelPositionsById,
        }, `Inserted ${insertedPointsPerSegment} extra spline handles per path segment.`);
        if (applied && Number.isInteger(selectedIndex)) {
            const multiplier = insertedPointsPerSegment + 1;
            this.selectPathHandle(Math.min(selectedIndex * multiplier, nextControlPoints.length - 1));
        }
    }

    async spreadAllChapterLevels() {
        const workingLayout = this.getWorkingLayoutData();
        const workingPresentationLayout = this.getWorkingPresentationLayout(workingLayout);
        const nextPositions = spreadAllChapterLevelsEvenly(
            workingLayout.levelPositionsById,
            this.getOrderedLevelIds(),
            workingPresentationLayout.chapterRanges,
        );

        await this.applyEditorLayout({
            controlPoints: workingLayout.controlPoints,
            levelPositionsById: nextPositions,
        }, 'All chapters redistributed to even spacing within their current boundaries.');
    }

    nudgeSelectedChapterBoundary(delta) {
        const chapterId = this.selectedDescriptor?.type === 'chapter'
            ? this.selectedDescriptor.chapterId
            : null;
        if (!chapterId || !Number.isFinite(delta) || delta === 0) {
            return;
        }

        const workingLayout = this.getWorkingLayoutData();
        const workingPresentationLayout = this.getWorkingPresentationLayout(workingLayout);
        const chapterRange = workingPresentationLayout.chapterRanges
            .find((range) => range.chapterId === chapterId);
        if (!chapterRange) {
            return;
        }

        const nextBoundary = chapterRange.startPosition + delta;
        const chapterRetime = retimeChapterBoundary(
            workingLayout.levelPositionsById,
            this.getOrderedLevelIds(),
            workingPresentationLayout.chapterRanges,
            chapterId,
            nextBoundary,
        );
        const nextLayout = {
            controlPoints: workingLayout.controlPoints,
            levelPositionsById: chapterRetime.levelPositionsById,
        };
        if (areLayoutSnapshotsEqual(workingLayout, nextLayout)) {
            return;
        }

        this.chapterDragDiagnostics = chapterRetime.diagnostics;
        this.pushUndoSnapshot(workingLayout);
        this.queueLayoutApply(nextLayout);
        this.updateSelectionLabel();
    }

    resolveExtensionAnchorProgress() {
        if (!this.selectedDescriptor) {
            return Number.NaN;
        }

        if (this.selectedDescriptor.type === 'chapter') {
            return this.getChapterRangeById(this.selectedDescriptor.chapterId)?.startPosition ?? Number.NaN;
        }

        if (this.selectedDescriptor.type === 'level') {
            return this.boardController.presentationLayout.levelPositionsById[
                this.selectedDescriptor.levelId
            ] ?? Number.NaN;
        }

        if (this.selectedDescriptor.type === 'path') {
            const controlPointCount = this.boardController.getLayoutData().controlPoints.length;
            if (controlPointCount <= 1) {
                return 1;
            }
            return this.selectedDescriptor.index / (controlPointCount - 1);
        }

        return Number.NaN;
    }

    async extendPathAfterSelection(extensionRatio = 0.16) {
        const layout = this.boardController.getLayoutData();
        const anchorProgress = this.resolveExtensionAnchorProgress();
        if (!Number.isFinite(anchorProgress)) {
            this.updateStatus('Select a chapter, level, or path point, then use Stretch After.');
            return;
        }

        const nextControlPoints = anchorProgress >= 0.995
            ? appendTailControlPoint(layout.controlPoints)
            : stretchPathControlPoints(layout.controlPoints, anchorProgress, extensionRatio);

        await this.applyEditorLayout({
            controlPoints: nextControlPoints,
            levelPositionsById: layout.levelPositionsById,
        }, anchorProgress >= 0.995
            ? 'Path tail extended with a new control point.'
            : 'Path stretched after the current selection.');
    }

    async appendPathTailPoint() {
        const layout = this.boardController.getLayoutData();
        await this.applyEditorLayout({
            controlPoints: appendTailControlPoint(layout.controlPoints),
            levelPositionsById: layout.levelPositionsById,
        }, 'Appended a new tail control point to extend the path.');
    }

    updateModeHint() {
        if (!this.modeHintLabel) {
            return;
        }

        if (this.mode === HANDLE_MODE.PATH) {
            this.modeHintLabel.textContent = [
                'Path: drag orange spline points.',
                'Free/XZ/YZ set the drag plane.',
                'Insert After adds a local handle.',
                'Subdivide Path doubles density; Dense Path adds many more at once.',
                'Use Stretch After or Append Tail to add length.',
            ].join(' ');
            return;
        }

        if (this.mode === HANDLE_MODE.LEVEL) {
            this.modeHintLabel.textContent = [
                'Levels: drag nodes along the spline.',
                'Ordering is clamped between neighbors.',
                'Spread All re-evens every chapter after checkpoint edits.',
            ].join(' ');
            return;
        }

        this.modeHintLabel.textContent = [
            'Chapters: Smart boundary mode.',
            'Drag a chapter start ring to set the boundary exactly.',
            'Spread Chapter evens that chapter inside its current boundaries.',
            'ArrowLeft/ArrowRight nudge the selected chapter.',
            'Alt is fine; Shift is coarse.',
        ].join(' ');
    }

    updateSelectionLabel() {
        if (!this.selectionLabel) {
            return;
        }

        const descriptor = this.selectedDescriptor;
        if (!descriptor) {
            this.selectionLabel.textContent = 'Select a path point, level marker, or chapter boundary.';
            if (this.selectionDetailLabel) {
                this.selectionDetailLabel.textContent = '';
            }
            return;
        }

        if (descriptor.type === 'path') {
            const point = this.boardController.getLayoutData().controlPoints[descriptor.index];
            this.selectionLabel.textContent = [
                `Path Point ${descriptor.index + 1}:`,
                `x ${point.x.toFixed(1)},`,
                `y ${point.y.toFixed(1)},`,
                `z ${point.z.toFixed(1)}`,
            ].join(' ');
            if (this.selectionDetailLabel) {
                this.selectionDetailLabel.textContent = [
                    'Spline edits rebuild the live path, nodes, camera,',
                    'and chapter anchors. Insert, subdivide, or densify to add more handles.',
                ].join(' ');
            }
            return;
        }

        if (descriptor.type === 'level') {
            const level = this.boardController.levelData.find((entry) => entry.id === descriptor.levelId);
            const pathPosition = this.boardController.presentationLayout.levelPositionsById[descriptor.levelId];
            this.selectionLabel.textContent = [
                `Level ${descriptor.levelId}:`,
                `${level?.name || 'Unknown'}`,
                `@ ${pathPosition.toFixed(3)}`,
            ].join(' ');
            if (this.selectionDetailLabel) {
                this.selectionDetailLabel.textContent = [
                    'Level markers slide along the shared curve',
                    'and stay strictly ordered.',
                ].join(' ');
            }
            return;
        }

        const chapterRange = this.boardController.presentationLayout.chapterRanges
            .find((range) => range.chapterId === descriptor.chapterId);
        const boundaryStart = chapterRange?.startPosition?.toFixed?.(3) ?? 'n/a';
        this.selectionLabel.textContent = `Chapter ${descriptor.chapterId} boundary: start ${boundaryStart}`;
        if (this.selectionDetailLabel) {
            const diagnostics = this.chapterDragDiagnostics;
            if (!diagnostics || diagnostics.chapterId !== descriptor.chapterId) {
                this.selectionDetailLabel.textContent = [
                    'Smart boundary:',
                    'proportional compression with upstream/downstream retiming as needed.',
                ].join(' ');
                return;
            }

            const compressionText = diagnostics.compressionUsed
                ? [
                    `Compression ${Math.round(diagnostics.compressionRatio * 100)}%`,
                    `on Chapter ${diagnostics.compressedChapterId}`,
                ].join(' ')
                : 'Compression off';
            const tailText = diagnostics.tailRetimeUsed
                ? `${diagnostics.tailDirection} retime on`
                : 'tail retime off';
            const exactText = diagnostics.exactRequested ? 'exact' : 'clamped';
            this.selectionDetailLabel.textContent = [
                compressionText,
                tailText,
                exactText,
            ].join(' • ');
        }
    }

    queueLayoutApply(layoutOverride, options = {}) {
        if (options.recordUndoFromDrag) {
            this.maybeRecordDragUndo(layoutOverride);
        }
        this.pendingLayout = layoutOverride;
        if (this.isApplyingLayout) {
            return;
        }
        this.flushLayoutApply().catch((error) => {
            this.updateStatus(`Layout update failed: ${error.message}`);
        });
    }

    async flushLayoutApply() {
        this.isApplyingLayout = true;
        const processNextLayout = async () => {
            if (!this.pendingLayout) {
                this.isApplyingLayout = false;
                return;
            }

            const nextLayout = this.pendingLayout;
            this.pendingLayout = null;
            await this.boardController.applyLayoutOverride(nextLayout);
            this.refreshFromBoardLayout();
            await processNextLayout();
        };

        await processNextLayout();
    }

    async copyToClipboard(text, label) {
        if (globalThis.navigator?.clipboard?.writeText) {
            await globalThis.navigator.clipboard.writeText(text);
            this.updateStatus(`${label} copied to clipboard.`);
            return;
        }

        this.textArea.value = text;
        this.textArea.focus();
        this.textArea.select();
        this.updateStatus(`${label} placed in the editor text area.`);
    }

    async copyLayoutJson() {
        const layout = this.boardController.getLayoutData();
        const serialized = serializeOdysseyLayoutData(layout);
        this.textArea.value = serialized;
        await this.copyToClipboard(serialized, 'Layout JSON');
    }

    async copyLayoutSnippet() {
        const snippet = createPatchReadyOdysseyLayoutSnippet(this.boardController.getLayoutData());
        this.textArea.value = snippet;
        await this.copyToClipboard(snippet, 'Patch-ready layout snippet');
    }

    async copyControlPoints() {
        const payload = JSON.stringify(this.boardController.getLayoutData().controlPoints, null, 4);
        this.textArea.value = payload;
        await this.copyToClipboard(payload, 'Control points');
    }

    async copyLevelPositions() {
        const payload = JSON.stringify(this.boardController.getLayoutData().levelPositionsById, null, 4);
        this.textArea.value = payload;
        await this.copyToClipboard(payload, 'Level positions');
    }

    async copyChapterPositions() {
        const payload = JSON.stringify(this.boardController.presentationLayout.chapterPositions, null, 4);
        this.textArea.value = payload;
        await this.copyToClipboard(payload, 'Chapter positions');
    }

    async resetLayout() {
        await this.applyEditorLayout(ODYSSEY_LAYOUT_DATA, 'Layout reset to the authored Odyssey layout.');
        this.textArea.value = serializeOdysseyLayoutData(this.boardController.getLayoutData());
    }

    async importLayoutFromTextArea() {
        try {
            const parsedLayout = parseOdysseyLayoutData(
                this.textArea.value,
                this.boardController.getLayoutData(),
                this.boardController.levelData,
            );
            await this.applyEditorLayout(parsedLayout, 'Imported layout applied.');
            this.textArea.value = serializeOdysseyLayoutData(this.boardController.getLayoutData());
        } catch (error) {
            this.updateStatus(`Import failed: ${error.message}`);
        }
    }

    updateStatus(message) {
        if (this.statusLabel) {
            this.statusLabel.textContent = message;
        }
    }

    dispose() {
        const canvas = this.renderer?.domElement;
        canvas?.removeEventListener('pointerdown', this.boundHandlers.pointerdown);
        canvas?.removeEventListener('pointermove', this.boundHandlers.pointermove);
        canvas?.removeEventListener('pointerup', this.boundHandlers.pointerup);
        canvas?.removeEventListener('click', this.boundHandlers.click);
        document.removeEventListener('keydown', this.boundHandlers.keydown, true);
        this.transformControls?.dispose?.();
        if (this.transformControls?.parent) {
            this.transformControls.parent.remove(this.transformControls);
        }
        this.clearHandleGroups();
        this.cameraProbe?.geometry?.dispose?.();
        this.cameraProbe?.material?.dispose?.();
        this.scene.remove(this.rootGroup);
        this.panel?.remove?.();
    }
}

export default OdysseyLayoutEditor;
