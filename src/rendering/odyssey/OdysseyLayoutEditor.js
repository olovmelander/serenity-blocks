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
    nudgeControlPointAtIndex,
    retimeChapterBoundary,
    spreadAllChapterLevelsEvenly,
    spreadChapterLevelsEvenly,
    subdivideControlPointSegments,
    stretchPathControlPoints,
} from './odyssey-layout-editor-utils.js';
import {
    areLayoutSnapshotsEqual,
    cloneLayoutSnapshot,
    commitLayoutHistory,
    createLayoutHistory,
    getCurrentLayoutHistoryEntry,
    getLayoutHistorySnapshot,
    restoreLayoutHistoryIndex,
} from './odyssey-layout-history.js';
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

const FREE_CAMERA_MOVE_SPEED = 24;
const FREE_CAMERA_BOOST_MULTIPLIER = 3.2;
const FREE_CAMERA_PRECISION_MULTIPLIER = 0.35;
const PATH_HANDLE_BASE_COLOR = 0xffbb55;
const PATH_HANDLE_BASE_EMISSIVE = 0xff6600;
const PATH_HANDLE_BASE_EMISSIVE_INTENSITY = 0.9;
const PATH_HANDLE_BASE_SCALE = 1;
const PATH_HANDLE_SELECTED_COLOR = 0xfff0bd;
const PATH_HANDLE_SELECTED_EMISSIVE = 0xffd27a;
const PATH_HANDLE_SELECTED_EMISSIVE_INTENSITY = 1.75;
const PATH_HANDLE_SELECTED_SCALE = 1.34;
const PATH_SELECTION_HALO_BASE_SCALE = 2.9;
const PATH_SELECTION_HALO_PULSE_SCALE = 0.18;
const PATH_SELECTION_HALO_PULSE_SPEED = 4.8;
const PATH_KEYBOARD_NUDGE_STEPS = Object.freeze({
    fineStep: 0.1,
    defaultStep: 0.5,
    coarseStep: 2,
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

function formatHistoryTimestamp(timestamp) {
    try {
        return new Intl.DateTimeFormat([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).format(timestamp);
    } catch {
        return '';
    }
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
        this.pathSelectionHalo = null;
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
        this.applyingLayout = null;
        this.isApplyingLayout = false;
        this.panel = null;
        this.panelContent = null;
        this.panelTitleLabel = null;
        this.panelToggleButton = null;
        this.isPanelMinimized = false;
        this.textArea = null;
        this.statusLabel = null;
        this.selectionLabel = null;
        this.selectionDetailLabel = null;
        this.modeHintLabel = null;
        this.modeButtons = new Map();
        this.dragPlaneButtons = new Map();
        this.cameraModeButtons = new Map();
        this.undoButton = null;
        this.redoButton = null;
        this.cameraHintLabel = null;
        this.historyList = null;
        this.historyState = null;
        this.dragHistoryBaseline = null;
        this.dragHistoryMetadata = null;
        this.freeCameraLookDrag = null;
        this.freeCameraMovementKeys = new Set();
        this.chapterDragDiagnostics = null;
        this.pathSelectionPulseTime = 0;
        this.boundHandlers = {
            pointerdown: this.onPointerDown.bind(this),
            pointermove: this.onPointerMove.bind(this),
            pointerup: this.onPointerUp.bind(this),
            click: this.onClick.bind(this),
            keydown: this.onKeyDown.bind(this),
            keyup: this.onKeyUp.bind(this),
            wheel: this.onWheel.bind(this),
            contextmenu: this.onContextMenu.bind(this),
            blur: this.onWindowBlur.bind(this),
        };
        this.pointer = new THREE.Vector2();
        this.raycaster = new THREE.Raycaster();
        this.sampleVector = new THREE.Vector3();
        this.projectedSample = new THREE.Vector3();
        this.dragIntersection = new THREE.Vector3();
        this.dragPlaneNormal = new THREE.Vector3();
        this.freeCameraStep = new THREE.Vector3();
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
        this.initializeHistoryState();
        this.createCameraProbe();
        this.createPathSelectionHalo();
        this.rebuildHandleMeshes();
        this.refreshFromBoardLayout();
        this.setMode(HANDLE_MODE.PATH);
        this.updateCameraModeUi();

        const canvas = this.renderer?.domElement;
        canvas?.addEventListener('pointerdown', this.boundHandlers.pointerdown);
        canvas?.addEventListener('pointermove', this.boundHandlers.pointermove);
        canvas?.addEventListener('pointerup', this.boundHandlers.pointerup);
        canvas?.addEventListener('click', this.boundHandlers.click);
        canvas?.addEventListener('contextmenu', this.boundHandlers.contextmenu);
        document.addEventListener('keydown', this.boundHandlers.keydown, true);
        document.addEventListener('keyup', this.boundHandlers.keyup, true);
        document.addEventListener('wheel', this.boundHandlers.wheel, { capture: true, passive: false });
        window.addEventListener('blur', this.boundHandlers.blur);
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

            this.beginHistoryTransaction(this.getDragHistoryMetadata());
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
            });
            this.updateSelectionLabel();
        });
        this.transformControls.addEventListener('mouseUp', () => {
            this.endHistoryTransaction();
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
            width: 380px;
            max-height: calc(100vh - 44px);
            overflow: auto;
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

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';

        this.panelTitleLabel = document.createElement('div');
        this.panelTitleLabel.style.cssText = 'font-size: 14px; font-weight: 800; color: #49ffe9;';
        headerRow.appendChild(this.panelTitleLabel);

        this.panelToggleButton = createButton('▾', () => this.togglePanelMinimized());
        this.panelToggleButton.style.minWidth = '38px';
        this.panelToggleButton.style.width = '38px';
        this.panelToggleButton.style.padding = '8px 0';
        this.panelToggleButton.style.fontSize = '18px';
        this.panelToggleButton.style.lineHeight = '1';
        headerRow.appendChild(this.panelToggleButton);
        panel.appendChild(headerRow);

        const panelContent = document.createElement('div');
        panelContent.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        panel.appendChild(panelContent);

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
        panelContent.appendChild(modeRow);

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
        panelContent.appendChild(dragRow);

        const cameraRow = document.createElement('div');
        cameraRow.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;';
        [
            ['free', 'Free Camera', () => this.enableFreeCamera()],
            ['follow', 'In-Game View', () => this.restoreInGameCameraView()],
        ].forEach(([mode, label, onClick]) => {
            const button = createButton(label, onClick);
            this.cameraModeButtons.set(mode, button);
            cameraRow.appendChild(button);
        });
        panelContent.appendChild(cameraRow);

        this.cameraHintLabel = document.createElement('div');
        this.cameraHintLabel.style.cssText = 'min-height: 18px; color: #8bd7ca; font-size: 11px;';
        panelContent.appendChild(this.cameraHintLabel);

        this.selectionLabel = document.createElement('div');
        this.selectionLabel.style.cssText = 'min-height: 38px; color: #9fe9dd;';
        panelContent.appendChild(this.selectionLabel);

        this.selectionDetailLabel = document.createElement('div');
        this.selectionDetailLabel.style.cssText = 'min-height: 18px; color: #78c8bf; font-size: 11px;';
        panelContent.appendChild(this.selectionDetailLabel);

        this.modeHintLabel = document.createElement('div');
        this.modeHintLabel.style.cssText = 'color: #78c8bf; font-size: 11px;';
        panelContent.appendChild(this.modeHintLabel);

        const toolGrid = document.createElement('div');
        toolGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;';
        toolGrid.appendChild(createButton('Insert After', () => this.insertPathPointAfterSelection()));
        toolGrid.appendChild(createButton('Subdivide Path', () => this.subdividePathControlPoints()));
        toolGrid.appendChild(createButton('Dense Path', () => this.densifyFullPathControlPoints()));
        toolGrid.appendChild(createButton('Spread Chapter', () => this.spreadSelectedChapterLevels()));
        toolGrid.appendChild(createButton('Spread All', () => this.spreadAllChapterLevels()));
        toolGrid.appendChild(createButton('Stretch After', () => this.extendPathAfterSelection()));
        toolGrid.appendChild(createButton('Append Tail', () => this.appendPathTailPoint()));
        panelContent.appendChild(toolGrid);

        const actionGrid = document.createElement('div');
        actionGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;';
        this.undoButton = createButton('Undo', () => this.undoLatestChange());
        actionGrid.appendChild(this.undoButton);
        this.redoButton = createButton('Redo', () => this.redoLatestChange());
        actionGrid.appendChild(this.redoButton);
        actionGrid.appendChild(createButton('Copy Layout JSON', () => this.copyLayoutJson()));
        actionGrid.appendChild(createButton('Copy JS Snippet', () => this.copyLayoutSnippet()));
        actionGrid.appendChild(createButton('Copy Control Points', () => this.copyControlPoints()));
        actionGrid.appendChild(createButton('Copy Level Positions', () => this.copyLevelPositions()));
        actionGrid.appendChild(createButton('Copy Chapters', () => this.copyChapterPositions()));
        actionGrid.appendChild(createButton('Reset Layout', () => this.resetLayout()));
        panelContent.appendChild(actionGrid);

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
        panelContent.appendChild(this.textArea);

        const importButton = createButton('Import Pasted JSON', () => this.importLayoutFromTextArea());
        panelContent.appendChild(importButton);

        const historyTitle = document.createElement('div');
        historyTitle.textContent = 'History';
        historyTitle.style.cssText = 'font-size: 12px; font-weight: 800; color: #49ffe9; margin-top: 2px;';
        panelContent.appendChild(historyTitle);

        this.historyList = document.createElement('div');
        this.historyList.style.cssText = `
            max-height: 230px;
            overflow: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-right: 4px;
        `;
        panelContent.appendChild(this.historyList);

        this.statusLabel = document.createElement('div');
        this.statusLabel.style.cssText = 'min-height: 18px; color: #78c8bf;';
        panelContent.appendChild(this.statusLabel);

        document.body.appendChild(panel);
        this.panel = panel;
        this.panelContent = panelContent;
        this.setPanelMinimized(false);
        this.updateHistoryControlsState();
    }

    setPanelMinimized(minimized) {
        this.isPanelMinimized = Boolean(minimized);
        if (!this.panel || !this.panelContent || !this.panelTitleLabel || !this.panelToggleButton) {
            return;
        }

        this.panelContent.style.display = this.isPanelMinimized ? 'none' : 'flex';
        this.panel.style.width = this.isPanelMinimized ? '176px' : '380px';
        this.panel.style.maxHeight = this.isPanelMinimized ? 'none' : 'calc(100vh - 44px)';
        this.panel.style.overflow = this.isPanelMinimized ? 'hidden' : 'auto';
        this.panel.style.padding = this.isPanelMinimized ? '10px 12px' : '14px';
        this.panel.style.gap = this.isPanelMinimized ? '0' : '10px';

        this.panelTitleLabel.textContent = this.isPanelMinimized
            ? 'Odyssey Editor'
            : 'Odyssey Layout Editor';
        this.panelToggleButton.textContent = this.isPanelMinimized ? '▸' : '▾';
        this.panelToggleButton.title = this.isPanelMinimized
            ? 'Expand the Odyssey Layout Editor'
            : 'Minimize the Odyssey Layout Editor';
    }

    togglePanelMinimized() {
        this.setPanelMinimized(!this.isPanelMinimized);
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

    createPathSelectionHalo() {
        const geometry = new THREE.RingGeometry(1.1, 1.72, 48);
        const material = new THREE.MeshBasicMaterial({
            color: 0xfff4c9,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        });
        this.pathSelectionHalo = new THREE.Mesh(geometry, material);
        this.pathSelectionHalo.name = 'odyssey-path-selection-halo';
        this.pathSelectionHalo.visible = false;
        this.pathSelectionHalo.renderOrder = 140;
        this.rootGroup.add(this.pathSelectionHalo);
    }

    normalizeSelectedPathDescriptor(count = this.pathHandles.length) {
        if (this.selectedDescriptor?.type !== 'path') {
            return null;
        }

        if (!Number.isFinite(count) || count <= 0) {
            this.selectedDescriptor = null;
            return null;
        }

        const normalizedIndex = THREE.MathUtils.clamp(
            Number(this.selectedDescriptor.index) || 0,
            0,
            count - 1,
        );
        if (normalizedIndex !== this.selectedDescriptor.index) {
            this.selectedDescriptor = {
                type: 'path',
                index: normalizedIndex,
            };
        }

        return normalizedIndex;
    }

    applyPathHandleVisualState(handle, selected) {
        if (!handle) {
            return;
        }

        handle.scale.setScalar(selected ? PATH_HANDLE_SELECTED_SCALE : PATH_HANDLE_BASE_SCALE);
        const { material } = handle;
        if (!(material instanceof THREE.MeshStandardMaterial)) {
            return;
        }

        material.color.setHex(selected ? PATH_HANDLE_SELECTED_COLOR : PATH_HANDLE_BASE_COLOR);
        material.emissive.setHex(selected ? PATH_HANDLE_SELECTED_EMISSIVE : PATH_HANDLE_BASE_EMISSIVE);
        material.emissiveIntensity = selected
            ? PATH_HANDLE_SELECTED_EMISSIVE_INTENSITY
            : PATH_HANDLE_BASE_EMISSIVE_INTENSITY;
        material.roughness = selected ? 0.24 : 0.32;
        material.metalness = selected ? 0.26 : 0.2;
    }

    syncPathSelectionVisuals(delta = 0) {
        const selectedPathIndex = this.normalizeSelectedPathDescriptor();
        const selectedHandle = Number.isInteger(selectedPathIndex)
            ? this.pathHandles[selectedPathIndex] || null
            : null;
        const shouldHighlightSelection = this.mode === HANDLE_MODE.PATH && !!selectedHandle;

        this.pathHandles.forEach((handle, index) => {
            this.applyPathHandleVisualState(handle, shouldHighlightSelection && index === selectedPathIndex);
        });

        if (shouldHighlightSelection) {
            if (this.transformControls?.object !== selectedHandle) {
                this.transformControls?.attach?.(selectedHandle);
            }
        } else if (this.mode === HANDLE_MODE.PATH && this.transformControls?.object) {
            this.transformControls.detach();
        }

        if (!this.pathSelectionHalo) {
            return;
        }

        if (!shouldHighlightSelection) {
            this.pathSelectionHalo.visible = false;
            return;
        }

        this.pathSelectionPulseTime += Number.isFinite(delta) ? delta : 0;
        const pulse = 1 + (
            Math.sin(this.pathSelectionPulseTime * PATH_SELECTION_HALO_PULSE_SPEED)
            * PATH_SELECTION_HALO_PULSE_SCALE
        );
        this.pathSelectionHalo.visible = true;
        this.pathSelectionHalo.position.copy(selectedHandle.position);
        this.pathSelectionHalo.quaternion.copy(this.camera.quaternion);
        this.pathSelectionHalo.scale.setScalar(PATH_SELECTION_HALO_BASE_SCALE * pulse);
        this.pathSelectionHalo.material.opacity = 0.72 + (0.1 * pulse);
    }

    rebuildHandleMeshes() {
        this.clearHandleGroups();

        const layout = this.boardController.getLayoutData();
        layout.controlPoints.forEach((point, index) => {
            const geometry = new THREE.SphereGeometry(1.05, 20, 20);
            const material = new THREE.MeshStandardMaterial({
                color: PATH_HANDLE_BASE_COLOR,
                emissive: PATH_HANDLE_BASE_EMISSIVE,
                emissiveIntensity: PATH_HANDLE_BASE_EMISSIVE_INTENSITY,
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
        this.syncPathSelectionVisuals();
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

        this.syncPathSelectionVisuals();
        this.updateSelectionLabel();
        this.updateCameraModeUi();
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

    initializeHistoryState() {
        this.historyState = createLayoutHistory(this.boardController.getLayoutData(), {
            label: 'Initial Layout',
            detail: 'Loaded from the current Odyssey path presentation.',
        });
        this.updateHistoryControlsState();
        this.renderHistoryEntries();
    }

    commitHistoryEntry(layoutSnapshot, metadata = {}) {
        const nextHistoryState = commitLayoutHistory(this.historyState, layoutSnapshot, metadata);
        if (nextHistoryState === this.historyState) {
            return false;
        }

        this.historyState = nextHistoryState;
        this.updateHistoryControlsState();
        this.renderHistoryEntries();
        return true;
    }

    async restoreHistoryIndex(index) {
        if (!this.historyState?.entries?.length) {
            return false;
        }

        const nextSnapshot = getLayoutHistorySnapshot(this.historyState, index);
        if (!nextSnapshot) {
            return false;
        }

        this.pendingLayout = null;
        this.endHistoryTransaction({ commit: false });
        const applied = await this.boardController.applyLayoutOverride(nextSnapshot);
        if (!applied) {
            this.updateStatus('History restore failed.');
            return false;
        }

        this.historyState = restoreLayoutHistoryIndex(this.historyState, index);
        this.refreshFromBoardLayout();
        this.updateHistoryControlsState();
        this.renderHistoryEntries();
        const entry = getCurrentLayoutHistoryEntry(this.historyState);
        this.updateStatus(`Restored history entry ${entry?.id ?? index + 1}: ${entry?.label || 'state'}.`);
        return true;
    }

    updateHistoryControlsState() {
        const currentIndex = this.historyState?.currentIndex ?? 0;
        const entryCount = this.historyState?.entries?.length ?? 0;
        if (this.undoButton) {
            applyButtonEnabledState(this.undoButton, currentIndex > 0);
        }
        if (this.redoButton) {
            applyButtonEnabledState(this.redoButton, currentIndex < (entryCount - 1));
        }
    }

    renderHistoryEntries() {
        if (!this.historyList) {
            return;
        }

        this.historyList.innerHTML = '';
        const entries = this.historyState?.entries || [];
        const currentIndex = this.historyState?.currentIndex ?? 0;

        [...entries].reverse().forEach((entry) => {
            const index = entries.indexOf(entry);
            const row = document.createElement('div');
            row.style.cssText = `
                border: 1px solid ${index === currentIndex ? 'rgba(73, 255, 233, 0.6)' : 'rgba(73, 255, 233, 0.16)'};
                background: ${index === currentIndex ? 'rgba(16, 39, 52, 0.9)' : 'rgba(7, 14, 24, 0.78)'};
                border-radius: 12px;
                padding: 9px 10px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            `;

            const titleRow = document.createElement('div');
            titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

            const title = document.createElement('div');
            title.textContent = `#${entry.id} ${entry.label}`;
            title.style.cssText = 'font-weight: 700; color: #dffdf8;';
            titleRow.appendChild(title);

            const stateLabel = document.createElement('div');
            stateLabel.textContent = index === currentIndex ? 'Current' : 'Restore';
            stateLabel.style.cssText = `
                font-size: 10px;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                color: ${index === currentIndex ? '#49ffe9' : '#9fe9dd'};
                cursor: ${index === currentIndex ? 'default' : 'pointer'};
            `;
            if (index !== currentIndex) {
                stateLabel.addEventListener('click', () => {
                    this.restoreHistoryIndex(index).catch((error) => {
                        this.updateStatus(`History restore failed: ${error.message}`);
                    });
                });
            }
            titleRow.appendChild(stateLabel);
            row.appendChild(titleRow);

            if (entry.detail) {
                const detail = document.createElement('div');
                detail.textContent = entry.detail;
                detail.style.cssText = 'font-size: 11px; color: #9ed8d0;';
                row.appendChild(detail);
            }

            const timeLabel = document.createElement('div');
            timeLabel.textContent = formatHistoryTimestamp(entry.timestamp);
            timeLabel.style.cssText = 'font-size: 10px; color: rgba(183, 225, 219, 0.74);';
            row.appendChild(timeLabel);

            this.historyList.appendChild(row);
        });
    }

    update(delta) {
        if (this.cameraProbe && this.boardController.cameraController && this.boardController.pathRenderer?.pathCurve) {
            const progress = this.boardController.cameraController.getCurrentPosition();
            const point = this.boardController.pathRenderer.pathCurve.getPointAt(progress);
            this.cameraProbe.position.copy(point);
        }

        this.updateFreeCameraMovement(delta);
        this.syncPathSelectionVisuals(delta);
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

        this.syncPathSelectionVisuals();
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

    updateCameraModeUi() {
        const isFreeCamera = this.boardController.cameraController?.isFreeMode?.() || false;
        this.cameraModeButtons.forEach((button, buttonMode) => {
            applyButtonActiveState(button, (buttonMode === 'free') === isFreeCamera);
        });

        if (!this.cameraHintLabel) {
            return;
        }

        this.cameraHintLabel.textContent = isFreeCamera
            ? [
                'Free Camera: hold RMB and drag, or use IJKL to rotate.',
                'Arrow keys still nudge the selected path point in Path mode.',
                'WASD moves, Q/E vertical, Shift boosts, Alt slows, wheel dollies.',
            ].join(' ')
            : 'In-Game View: editor uses the authored Odyssey path camera framing.';
    }

    enableFreeCamera() {
        this.boardController.cameraController?.setFreeMode?.(true);
        this.updateCameraModeUi();
        this.updateSelectionLabel();
        this.updateStatus([
            'Free camera enabled.',
            'Use RMB drag or IJKL to rotate;',
            'arrow keys keep nudging the selected path point.',
        ].join(' '));
    }

    restoreInGameCameraView() {
        this.boardController.cameraController?.setFollowMode?.();
        this.updateCameraModeUi();
        this.updateSelectionLabel();
        this.updateStatus('Returned to the normal Odyssey path camera.');
    }

    updateFreeCameraMovement(delta) {
        const { cameraController } = this.boardController;
        if (!cameraController?.isFreeMode?.()) {
            return;
        }

        const rotationSpeed = cameraController.config?.freeCamera?.keyboardRotateSpeed || 1.35;
        let yawDelta = 0;
        let pitchDelta = 0;
        if (this.freeCameraMovementKeys.has('KeyJ')) {
            yawDelta += rotationSpeed * delta;
        }
        if (this.freeCameraMovementKeys.has('KeyL')) {
            yawDelta -= rotationSpeed * delta;
        }
        if (this.freeCameraMovementKeys.has('KeyI')) {
            pitchDelta += rotationSpeed * delta;
        }
        if (this.freeCameraMovementKeys.has('KeyK')) {
            pitchDelta -= rotationSpeed * delta;
        }
        if (yawDelta !== 0 || pitchDelta !== 0) {
            cameraController.rotateFreeCamera(yawDelta, pitchDelta);
        }

        this.freeCameraStep.set(0, 0, 0);
        if (this.freeCameraMovementKeys.has('KeyA')) {
            this.freeCameraStep.x -= 1;
        }
        if (this.freeCameraMovementKeys.has('KeyD')) {
            this.freeCameraStep.x += 1;
        }
        if (this.freeCameraMovementKeys.has('KeyQ')) {
            this.freeCameraStep.y -= 1;
        }
        if (this.freeCameraMovementKeys.has('KeyE')) {
            this.freeCameraStep.y += 1;
        }
        if (this.freeCameraMovementKeys.has('KeyS')) {
            this.freeCameraStep.z -= 1;
        }
        if (this.freeCameraMovementKeys.has('KeyW')) {
            this.freeCameraStep.z += 1;
        }

        if (this.freeCameraStep.lengthSq() === 0) {
            return;
        }

        this.freeCameraStep.normalize();
        let speed = FREE_CAMERA_MOVE_SPEED;
        if (this.freeCameraMovementKeys.has('ShiftLeft') || this.freeCameraMovementKeys.has('ShiftRight')) {
            speed *= FREE_CAMERA_BOOST_MULTIPLIER;
        }
        if (this.freeCameraMovementKeys.has('AltLeft') || this.freeCameraMovementKeys.has('AltRight')) {
            speed *= FREE_CAMERA_PRECISION_MULTIPLIER;
        }
        this.freeCameraStep.multiplyScalar(speed * delta);
        cameraController.moveFreeCamera(this.freeCameraStep);
    }

    isBoardInteractionBlocked() {
        return !!(this.freeCameraLookDrag || this.dragState);
    }

    getPathPointKeyboardDelta(key, step) {
        if (!Number.isFinite(step) || step <= 0) {
            return null;
        }

        if (this.dragPlaneMode === DRAG_PLANE_MODE.XZ) {
            if (key === 'ArrowLeft') return { x: -step, y: 0, z: 0 };
            if (key === 'ArrowRight') return { x: step, y: 0, z: 0 };
            if (key === 'ArrowUp') return { x: 0, y: 0, z: -step };
            if (key === 'ArrowDown') return { x: 0, y: 0, z: step };
            return null;
        }

        if (this.dragPlaneMode === DRAG_PLANE_MODE.YZ) {
            if (key === 'ArrowLeft') return { x: 0, y: 0, z: -step };
            if (key === 'ArrowRight') return { x: 0, y: 0, z: step };
            if (key === 'ArrowUp') return { x: 0, y: step, z: 0 };
            if (key === 'ArrowDown') return { x: 0, y: -step, z: 0 };
            return null;
        }

        if (key === 'ArrowLeft') return { x: -step, y: 0, z: 0 };
        if (key === 'ArrowRight') return { x: step, y: 0, z: 0 };
        if (key === 'ArrowUp') return { x: 0, y: step, z: 0 };
        if (key === 'ArrowDown') return { x: 0, y: -step, z: 0 };
        return null;
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
        const { cameraController } = this.boardController;
        if (cameraController?.isFreeMode?.() && event.button === 2) {
            this.freeCameraLookDrag = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
            };
            this.renderer?.domElement?.setPointerCapture?.(event.pointerId);
            if (this.renderer?.domElement?.style) {
                this.renderer.domElement.style.cursor = 'grabbing';
            }
            this.suppressNextClick = true;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (this.mode === HANDLE_MODE.PATH) {
            const handle = this.pickHandle(event, this.pathHandles);
            if (handle) {
                this.selectDescriptor({ type: 'path', index: handle.userData.index });
                this.transformControls.attach(handle);
                this.beginHistoryTransaction(this.getDragHistoryMetadata());
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
                this.beginHistoryTransaction(this.getDragHistoryMetadata());
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
            this.beginHistoryTransaction(this.getDragHistoryMetadata());
            this.dragState = { type: 'chapter', chapterId: handle.userData.chapterId };
            this.suppressNextClick = true;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }

    onPointerMove(event) {
        if (this.freeCameraLookDrag && this.freeCameraLookDrag.pointerId === event.pointerId) {
            const deltaX = event.clientX - this.freeCameraLookDrag.clientX;
            const deltaY = event.clientY - this.freeCameraLookDrag.clientY;
            this.freeCameraLookDrag.clientX = event.clientX;
            this.freeCameraLookDrag.clientY = event.clientY;
            this.boardController.cameraController?.applyFreeLookDelta?.(deltaX, deltaY);
            this.updateCameraModeUi();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

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
                });
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
                });
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
        if (this.freeCameraLookDrag && this.freeCameraLookDrag.pointerId === event.pointerId) {
            this.renderer?.domElement?.releasePointerCapture?.(event.pointerId);
            this.freeCameraLookDrag = null;
            if (this.renderer?.domElement?.style) {
                this.renderer.domElement.style.cursor = 'default';
            }
            this.suppressNextClick = true;
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (!this.dragState) {
            return;
        }

        const finishedDragState = this.dragState;
        this.dragState = null;
        this.endHistoryTransaction();
        if (
            finishedDragState.type === 'chapter'
            && this.chapterDragDiagnostics?.chapterId === finishedDragState.chapterId
            && this.chapterDragDiagnostics.localClampUsed
        ) {
            this.updateStatus(
                `Chapter ${finishedDragState.chapterId} hit its local clamp. `
                + 'Other chapter checkpoints stayed protected.',
            );
        }
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

        const lowerKey = event.key.toLowerCase();
        const isUndoShortcut = (event.ctrlKey || event.metaKey)
            && !event.shiftKey
            && lowerKey === 'z';
        if (isUndoShortcut) {
            this.undoLatestChange().catch((error) => {
                this.updateStatus(`Undo failed: ${error.message}`);
            });
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        const isRedoShortcut = (event.ctrlKey || event.metaKey)
            && (lowerKey === 'y' || (event.shiftKey && lowerKey === 'z'));
        if (isRedoShortcut) {
            this.redoLatestChange().catch((error) => {
                this.updateStatus(`Redo failed: ${error.message}`);
            });
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (
            this.boardController.cameraController?.isFreeMode?.()
            && [
                'KeyW',
                'KeyA',
                'KeyS',
                'KeyD',
                'KeyQ',
                'KeyE',
                'KeyI',
                'KeyJ',
                'KeyK',
                'KeyL',
                'ShiftLeft',
                'ShiftRight',
                'AltLeft',
                'AltRight',
            ].includes(event.code)
        ) {
            this.freeCameraMovementKeys.add(event.code);
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (event.code === 'KeyF') {
            this.enableFreeCamera();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        if (event.code === 'KeyG') {
            this.restoreInGameCameraView();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }

        const isPathSelected = this.mode === HANDLE_MODE.PATH
            && this.selectedDescriptor?.type === 'path';
        if (isPathSelected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            const step = getKeyboardNudgeStep(event, PATH_KEYBOARD_NUDGE_STEPS);
            const delta = this.getPathPointKeyboardDelta(event.key, step);
            if (delta) {
                this.nudgeSelectedPathPoint(delta).catch((error) => {
                    this.updateStatus(`Path nudge failed: ${error.message}`);
                });
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
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
        this.nudgeSelectedChapterBoundary(direction * step).catch((error) => {
            this.updateStatus(`Chapter nudge failed: ${error.message}`);
        });
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    onKeyUp(event) {
        this.freeCameraMovementKeys.delete(event.code);
    }

    onWheel(event) {
        if (!this.boardController.cameraController?.isFreeMode?.()) {
            return;
        }

        if (!this.boardController.shouldHandleWheelEvent?.(event)) {
            return;
        }

        if (event.ctrlKey) {
            return;
        }

        const viewportHeight = this.container?.clientHeight || globalThis.window?.innerHeight || 900;
        let deltaPixels = event.deltaY || 0;
        if (event.deltaMode === 1) {
            deltaPixels *= 16;
        } else if (event.deltaMode === 2) {
            deltaPixels *= viewportHeight;
        }
        const normalizedDelta = 0.001 * Math.max(Math.min(deltaPixels, 240), -240);
        if (!normalizedDelta) {
            return;
        }

        this.boardController.cameraController.dollyFree(-normalizedDelta * 72);
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    onContextMenu(event) {
        if (this.boardController.cameraController?.isFreeMode?.()) {
            event.preventDefault();
        }
    }

    onWindowBlur() {
        this.freeCameraMovementKeys.clear();
        this.freeCameraLookDrag = null;
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
        this.syncPathSelectionVisuals();
        this.updateSelectionLabel();
    }

    getDragHistoryMetadata() {
        const descriptor = this.dragState || this.selectedDescriptor;
        if (!descriptor) {
            return {
                label: 'Adjusted Layout',
                detail: 'Direct editor drag change.',
            };
        }

        if (descriptor.type === 'path') {
            return {
                label: `Moved Path Point ${descriptor.index + 1}`,
                detail: 'Spline control point repositioned.',
            };
        }

        if (descriptor.type === 'level') {
            return {
                label: `Moved Level ${descriptor.levelId}`,
                detail: 'Level node retimed along the Odyssey path.',
            };
        }

        return {
            label: `Adjusted Chapter ${descriptor.chapterId} Boundary`,
            detail: 'Chapter start boundary retimed along the path.',
        };
    }

    beginHistoryTransaction(metadata = this.getDragHistoryMetadata()) {
        if (this.dragHistoryBaseline) {
            return;
        }

        this.dragHistoryBaseline = this.getWorkingLayoutData();
        this.dragHistoryMetadata = metadata;
    }

    endHistoryTransaction({ commit = true } = {}) {
        const baseline = this.dragHistoryBaseline;
        const metadata = this.dragHistoryMetadata;
        this.dragHistoryBaseline = null;
        this.dragHistoryMetadata = null;

        if (!commit || !baseline) {
            return;
        }

        const currentLayout = this.getWorkingLayoutData();
        if (areLayoutSnapshotsEqual(baseline, currentLayout)) {
            return;
        }

        this.commitHistoryEntry(currentLayout, metadata);
    }

    getOrderedLevelIds() {
        return this.boardController.levelData.map((level) => level.id);
    }

    getWorkingLayoutData() {
        const sourceLayout = this.pendingLayout || this.applyingLayout || this.boardController.getLayoutData();
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
        this.syncPathSelectionVisuals();
    }

    async applyEditorLayout(layoutOverride, successMessage, options = {}) {
        const currentLayout = this.getWorkingLayoutData();
        if (areLayoutSnapshotsEqual(currentLayout, layoutOverride)) {
            if (successMessage) {
                this.updateStatus(successMessage);
            }
            return false;
        }

        const applied = await this.boardController.applyLayoutOverride(layoutOverride);
        if (!applied) {
            this.updateStatus('Layout update failed.');
            return false;
        }

        if (options.history) {
            this.commitHistoryEntry(this.boardController.getLayoutData(), options.history);
        }
        this.refreshFromBoardLayout();
        if (successMessage) {
            this.updateStatus(successMessage);
        }
        return true;
    }

    async undoLatestChange() {
        const previousIndex = (this.historyState?.currentIndex ?? 0) - 1;
        if (previousIndex < 0) {
            this.updateStatus('No previous editor change to restore.');
            return;
        }

        await this.restoreHistoryIndex(previousIndex);
    }

    async redoLatestChange() {
        const nextIndex = (this.historyState?.currentIndex ?? 0) + 1;
        if (nextIndex >= (this.historyState?.entries?.length ?? 0)) {
            this.updateStatus('No later editor state to restore.');
            return;
        }

        await this.restoreHistoryIndex(nextIndex);
    }

    async nudgeSelectedPathPoint(delta) {
        const selectedIndex = this.selectedDescriptor?.type === 'path'
            ? this.selectedDescriptor.index
            : null;
        if (!Number.isInteger(selectedIndex)) {
            return false;
        }

        const workingLayout = this.getWorkingLayoutData();
        const nextControlPoints = nudgeControlPointAtIndex(
            workingLayout.controlPoints,
            selectedIndex,
            delta,
        );
        const nextLayout = {
            controlPoints: nextControlPoints,
            levelPositionsById: workingLayout.levelPositionsById,
        };
        if (areLayoutSnapshotsEqual(workingLayout, nextLayout)) {
            return false;
        }

        const applied = await this.applyEditorLayout(nextLayout, `Path Point ${selectedIndex + 1} nudged.`, {
            history: {
                label: `Nudged Path Point ${selectedIndex + 1}`,
                detail: `Adjusted by x ${delta.x || 0}, y ${delta.y || 0}, z ${delta.z || 0}.`,
            },
        });
        if (applied && this.mode === HANDLE_MODE.PATH) {
            this.transformControls?.attach?.(this.pathHandles[selectedIndex]);
        }
        return applied;
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
        }, `Chapter ${chapterId} levels spread evenly inside its boundaries.`, {
            history: {
                label: `Spread Chapter ${chapterId}`,
                detail: 'Redistributed all chapter levels evenly within the current chapter bounds.',
            },
        });
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
            : 'Inserted a new spline handle after the selected path point.', {
            history: {
                label: selectedIndex >= (workingLayout.controlPoints.length - 1)
                    ? `Extended Tail After Path Point ${selectedIndex + 1}`
                    : `Inserted Path Point After ${selectedIndex + 1}`,
                detail: selectedIndex >= (workingLayout.controlPoints.length - 1)
                    ? 'Added a new control point to the end of the spline.'
                    : 'Inserted a midpoint control point after the selected spline handle.',
            },
        });
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
        }, 'Inserted midpoint spline handles across the full path.', {
            history: {
                label: 'Subdivided Path',
                detail: 'Inserted midpoint spline handles across the full Odyssey path.',
            },
        });
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
        }, `Inserted ${insertedPointsPerSegment} extra spline handles per path segment.`, {
            history: {
                label: 'Densified Path',
                detail: `Inserted ${insertedPointsPerSegment} extra spline handles per path segment.`,
            },
        });
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
        }, 'All chapters redistributed to even spacing within their current boundaries.', {
            history: {
                label: 'Spread All Chapters',
                detail: 'Redistributed every chapter to even spacing across current boundaries.',
            },
        });
    }

    async nudgeSelectedChapterBoundary(delta) {
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
            if (chapterRetime.diagnostics.localClampUsed) {
                this.updateStatus(
                    `Chapter ${chapterId} is already at its local clamp. `
                    + 'Other chapter checkpoints stayed protected.',
                );
            }
            return;
        }

        this.chapterDragDiagnostics = chapterRetime.diagnostics;
        const successMessage = chapterRetime.diagnostics.localClampUsed
            ? `Chapter ${chapterId} boundary nudged to its local clamp. `
                + 'Other chapter checkpoints stayed protected.'
            : `Chapter ${chapterId} boundary nudged. `
                + 'Other chapter checkpoints stayed protected.';
        const applied = await this.applyEditorLayout(nextLayout, successMessage, {
            history: {
                label: `Nudged Chapter ${chapterId} Boundary`,
                detail: `Applied a keyboard nudge of ${delta.toFixed(4)} to the chapter boundary.`,
            },
        });
        if (applied) {
            this.updateSelectionLabel();
        }
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
            : 'Path stretched after the current selection.', {
            history: {
                label: anchorProgress >= 0.995 ? 'Extended Path Tail' : 'Stretched Path After Selection',
                detail: anchorProgress >= 0.995
                    ? 'Added a new trailing spline control point.'
                    : 'Rescaled the spline after the current anchor selection.',
            },
        });
    }

    async appendPathTailPoint() {
        const layout = this.boardController.getLayoutData();
        await this.applyEditorLayout({
            controlPoints: appendTailControlPoint(layout.controlPoints),
            levelPositionsById: layout.levelPositionsById,
        }, 'Appended a new tail control point to extend the path.', {
            history: {
                label: 'Appended Path Tail',
                detail: 'Added a new control point to the end of the Odyssey spline.',
            },
        });
    }

    updateModeHint() {
        if (!this.modeHintLabel) {
            return;
        }

        if (this.mode === HANDLE_MODE.PATH) {
            this.modeHintLabel.textContent = [
                'Path: drag orange spline points.',
                'Free/XZ/YZ set the drag plane.',
                'Selected points stay highlighted, even while Free Camera is active.',
                'Arrow keys nudge the selected point in the current drag plane.',
                'Insert After adds a local handle.',
                'Subdivide Path doubles density; Dense Path adds many more at once.',
                'Use IJKL or RMB drag to rotate Free Camera.',
                'Alt is fine; Shift is coarse. Use Stretch After or Append Tail to add length.',
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
            'Chapters: local checkpoint mode.',
            'Drag a chapter start ring until it hits its local clamp.',
            'Only the two adjacent chapters compress; later checkpoints stay protected.',
            'Spread Chapter evens that chapter inside its current boundaries.',
            'ArrowLeft/ArrowRight nudge the selected chapter.',
            'Alt is fine; Shift is coarse.',
        ].join(' ');
    }

    updateSelectionLabel() {
        if (this.selectedDescriptor?.type === 'path') {
            this.normalizeSelectedPathDescriptor(
                this.boardController.getLayoutData()?.controlPoints?.length ?? 0,
            );
        }

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
            if (!point) {
                this.selectionLabel.textContent = 'Select a path point, level marker, or chapter boundary.';
                if (this.selectionDetailLabel) {
                    this.selectionDetailLabel.textContent = '';
                }
                return;
            }

            const isFreeCamera = this.boardController.cameraController?.isFreeMode?.() || false;
            this.selectionLabel.textContent = [
                `Path Point ${descriptor.index + 1}:`,
                `x ${point.x.toFixed(1)},`,
                `y ${point.y.toFixed(1)},`,
                `z ${point.z.toFixed(1)}`,
            ].join(' ');
            if (this.selectionDetailLabel) {
                this.selectionDetailLabel.textContent = [
                    'Spline edits rebuild the live path, nodes, camera, and chapter anchors.',
                    isFreeCamera
                        ? [
                            'This point stays highlighted in Free Camera.',
                            'Arrow keys nudge it;',
                            'use IJKL or RMB drag to rotate the camera.',
                        ].join(' ')
                        : 'Drag with the mouse or use arrow keys to nudge in the active drag plane.',
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
                    'Local boundary mode:',
                    'only adjacent chapters compress and other checkpoints stay protected.',
                ].join(' ');
                return;
            }

            const compressionText = diagnostics.compressionUsed
                ? [
                    `Compression ${Math.round(diagnostics.compressionRatio * 100)}%`,
                    `on Chapter ${diagnostics.compressedChapterId}`,
                ].join(' ')
                : 'Compression off';
            const clampText = diagnostics.localClampUsed
                ? [
                    'Local clamp on',
                    diagnostics.localClampSide === 'previous'
                        ? 'previous chapter limit'
                        : 'current chapter limit',
                ].join(' ')
                : 'local move';
            const exactText = diagnostics.exactRequested ? 'exact' : 'clamped';
            this.selectionDetailLabel.textContent = [
                compressionText,
                clampText,
                'other checkpoints protected',
                exactText,
            ].join(' • ');
        }
    }

    queueLayoutApply(layoutOverride) {
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
            this.applyingLayout = nextLayout;
            let applied = false;
            try {
                applied = await this.boardController.applyLayoutOverride(nextLayout);
            } finally {
                this.applyingLayout = null;
            }
            if (!applied) {
                throw new Error('Board controller rejected the live layout update.');
            }
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
        await this.applyEditorLayout(ODYSSEY_LAYOUT_DATA, 'Layout reset to the authored Odyssey layout.', {
            history: {
                label: 'Reset Layout',
                detail: 'Restored the Odyssey layout to the authored source data.',
            },
        });
        this.textArea.value = serializeOdysseyLayoutData(this.boardController.getLayoutData());
    }

    async importLayoutFromTextArea() {
        try {
            const parsedLayout = parseOdysseyLayoutData(
                this.textArea.value,
                this.boardController.getLayoutData(),
                this.boardController.levelData,
            );
            await this.applyEditorLayout(parsedLayout, 'Imported layout applied.', {
                history: {
                    label: 'Imported Layout',
                    detail: 'Applied pasted Odyssey layout JSON from the editor text area.',
                },
            });
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
        canvas?.removeEventListener('contextmenu', this.boundHandlers.contextmenu);
        document.removeEventListener('keydown', this.boundHandlers.keydown, true);
        document.removeEventListener('keyup', this.boundHandlers.keyup, true);
        document.removeEventListener('wheel', this.boundHandlers.wheel, { capture: true, passive: false });
        window.removeEventListener('blur', this.boundHandlers.blur);
        this.freeCameraMovementKeys.clear();
        this.freeCameraLookDrag = null;
        this.endHistoryTransaction({ commit: false });
        this.transformControls?.dispose?.();
        if (this.transformControls?.parent) {
            this.transformControls.parent.remove(this.transformControls);
        }
        this.clearHandleGroups();
        this.pathSelectionHalo?.geometry?.dispose?.();
        this.pathSelectionHalo?.material?.dispose?.();
        this.cameraProbe?.geometry?.dispose?.();
        this.cameraProbe?.material?.dispose?.();
        this.scene.remove(this.rootGroup);
        this.panel?.remove?.();
    }
}

export default OdysseyLayoutEditor;
