import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';

vi.mock('three/examples/jsm/controls/TransformControls.js', async () => {
    const three = await import('three');

    class MockTransformControls extends three.Object3D {
        constructor(camera, domElement) {
            super();
            this.camera = camera;
            this.domElement = domElement;
            this.object = null;
            this.showX = true;
            this.showY = true;
            this.showZ = true;
            this.listeners = new Map();
        }

        setMode(mode) {
            this.mode = mode;
        }

        setSpace(space) {
            this.space = space;
        }

        attach(object) {
            this.object = object;
        }

        detach() {
            this.object = null;
        }

        addEventListener(type, handler) {
            this.listeners.set(type, handler);
        }

        removeEventListener(type) {
            this.listeners.delete(type);
        }

        dispatchEvent(event) {
            const handler = this.listeners.get(event.type);
            handler?.(event);
        }

        dispose() {}
    }

    return {
        TransformControls: MockTransformControls,
    };
});

let OdysseyLayoutEditor;

function createMockElement(tagName = 'div') {
    const element = {
        tagName: tagName.toUpperCase(),
        style: {},
        children: [],
        dataset: {},
        parentElement: null,
        parentNode: null,
        textContent: '',
        value: '',
        placeholder: '',
        spellcheck: true,
        disabled: false,
        type: '',
        _innerHTML: '',
        appendChild(child) {
            child.parentElement = element;
            child.parentNode = element;
            element.children.push(child);
            return child;
        },
        removeChild(child) {
            element.children = element.children.filter((entry) => entry !== child);
            child.parentElement = null;
            child.parentNode = null;
            return child;
        },
        remove() {
            element.parentElement?.removeChild?.(element);
        },
        setAttribute(name, value) {
            element[name] = value;
        },
        getAttribute(name) {
            return element[name] ?? null;
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        focus: vi.fn(),
        select: vi.fn(),
        classList: {
            add: vi.fn(),
            remove: vi.fn(),
            contains: vi.fn(() => false),
        },
    };

    Object.defineProperty(element, 'innerHTML', {
        get() {
            return element._innerHTML;
        },
        set(value) {
            element._innerHTML = value;
            if (value === '') {
                element.children = [];
            }
        },
    });

    return element;
}

function createMockDocument() {
    const body = createMockElement('body');

    return {
        body,
        createElement: vi.fn((tagName) => createMockElement(tagName)),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
}

function createCanvas() {
    return {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({
            left: 0,
            top: 0,
            width: 1280,
            height: 720,
            right: 1280,
            bottom: 720,
        })),
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
        style: {},
        parentNode: {
            removeChild: vi.fn(),
        },
    };
}

function cloneLayout(layout) {
    return {
        controlPoints: layout.controlPoints.map((point) => ({ ...point })),
        levelPositionsById: { ...layout.levelPositionsById },
    };
}

function createCurve(controlPoints) {
    const curve = new THREE.CatmullRomCurve3(
        controlPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)),
    );
    curve.curveType = 'catmullrom';
    curve.tension = 0.3;
    return curve;
}

function createPresentationLayout(layout, levelData) {
    const chapterGroups = [];
    levelData.forEach((level) => {
        const lastGroup = chapterGroups[chapterGroups.length - 1];
        if (lastGroup && lastGroup.chapterId === level.chapter) {
            lastGroup.endLevelId = level.id;
            return;
        }

        chapterGroups.push({
            chapterId: level.chapter,
            startLevelId: level.id,
            endLevelId: level.id,
        });
    });

    const chapterPositions = chapterGroups.map((group) => Number(layout.levelPositionsById[group.startLevelId] || 0));
    const chapterRanges = chapterGroups.map((group, index) => ({
        chapterId: group.chapterId,
        startLevelId: group.startLevelId,
        endLevelId: group.endLevelId,
        startPosition: Number(layout.levelPositionsById[group.startLevelId] || 0),
        endPosition: index < (chapterGroups.length - 1)
            ? Number(layout.levelPositionsById[chapterGroups[index + 1].startLevelId] || 1)
            : 1,
    }));

    return {
        controlPoints: layout.controlPoints.map((point) => ({ ...point })),
        levelPositionsById: { ...layout.levelPositionsById },
        levelPositions: levelData.map((level) => Number(layout.levelPositionsById[level.id] || 0)),
        chapterPositions: [...chapterPositions, 1],
        totalLevels: levelData.length,
        chapterRanges,
    };
}

function createBoardController(options = {}) {
    const layout = options.layout || {
        controlPoints: [
            { x: 0, y: 0, z: 0 },
            { x: 12, y: 5, z: -18 },
            { x: 28, y: 11, z: -44 },
        ],
        levelPositionsById: {
            1: 0.15,
            2: 0.72,
        },
    };
    const levelData = (options.levelData || [
        {
            id: 1,
            chapter: 1,
            name: 'One',
            pathPosition: 0.15,
            isChapterStart: true,
        },
        {
            id: 2,
            chapter: 1,
            name: 'Two',
            pathPosition: 0.72,
            isChapterStart: false,
        },
    ]).map((level) => ({
        ...level,
        pathPosition: Number(layout.levelPositionsById[level.id] ?? level.pathPosition ?? 0),
    }));
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    camera.position.set(0, 16, 42);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const boardController = {
        scene: new THREE.Scene(),
        camera,
        renderer: {
            domElement: createCanvas(),
        },
        container: {
            clientHeight: 720,
        },
        levelData,
        nodeManager: {
            getChapterColor: vi.fn(() => new THREE.Color('#49ffe9')),
        },
        environmentManager: {
            getBoundaryTransition: vi.fn(() => null),
        },
        pathRenderer: {
            pathCurve: createCurve(layout.controlPoints),
        },
        cameraController: {
            freeMode: false,
            config: {
                freeCamera: {
                    keyboardRotateSpeed: 1.35,
                },
            },
            isFreeMode() {
                return this.freeMode;
            },
            setFreeMode(value) {
                this.freeMode = value;
            },
            setFollowMode() {
                this.freeMode = false;
            },
            getCurrentPosition: vi.fn(() => 0.22),
            rotateFreeCamera: vi.fn(),
            moveFreeCamera: vi.fn(),
            applyFreeLookDelta: vi.fn(),
            dollyFree: vi.fn(),
        },
        shouldHandleWheelEvent: vi.fn(() => true),
        _layout: cloneLayout(layout),
        presentationLayout: createPresentationLayout(layout, levelData),
        getLayoutData() {
            return this._layout;
        },
        async applyLayoutOverride(nextLayout) {
            this._layout = cloneLayout(nextLayout);
            this.presentationLayout = createPresentationLayout(nextLayout, this.levelData);
            this.pathRenderer.pathCurve = createCurve(nextLayout.controlPoints);
            return true;
        },
    };

    return boardController;
}

function createChapterBoardController(options = {}) {
    return createBoardController({
        levelData: [
            {
                id: 1,
                chapter: 1,
                name: 'One',
                pathPosition: 0,
                isChapterStart: true,
            },
            {
                id: 2,
                chapter: 1,
                name: 'Two',
                pathPosition: 0.1,
                isChapterStart: false,
            },
            {
                id: 3,
                chapter: 2,
                name: 'Three',
                pathPosition: 0.3,
                isChapterStart: true,
            },
            {
                id: 4,
                chapter: 2,
                name: 'Four',
                pathPosition: 0.42,
                isChapterStart: false,
            },
            {
                id: 5,
                chapter: 3,
                name: 'Five',
                pathPosition: 0.55,
                isChapterStart: true,
            },
            {
                id: 6,
                chapter: 3,
                name: 'Six',
                pathPosition: 0.72,
                isChapterStart: false,
            },
            {
                id: 7,
                chapter: 3,
                name: 'Seven',
                pathPosition: 1,
                isChapterStart: false,
            },
        ],
        layout: options.layout || {
            controlPoints: [
                { x: 0, y: 0, z: 0 },
                { x: 12, y: 20, z: -18 },
                { x: 24, y: 38, z: -44 },
                { x: 40, y: 62, z: -78 },
            ],
            levelPositionsById: {
                1: 0.00,
                2: 0.10,
                3: 0.30,
                4: 0.42,
                5: 0.55,
                6: 0.72,
                7: 1.00,
            },
        },
    });
}

function createKeyEvent({
    key,
    code,
    altKey = false,
    shiftKey = false,
    ctrlKey = false,
    metaKey = false,
} = {}) {
    return {
        key,
        code,
        altKey,
        shiftKey,
        ctrlKey,
        metaKey,
        defaultPrevented: false,
        target: { tagName: 'DIV' },
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
    };
}

describe('OdysseyLayoutEditor', () => {
    let editor = null;

    beforeEach(async () => {
        if (!OdysseyLayoutEditor) {
            ({ OdysseyLayoutEditor } = await import('../../src/rendering/odyssey/OdysseyLayoutEditor.js'));
        }
        vi.stubGlobal('document', createMockDocument());
        vi.stubGlobal('window', {
            innerHeight: 720,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
    });

    afterEach(() => {
        editor?.dispose?.();
        editor = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('highlights exactly one selected path point and shows a halo on it', () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();

        editor.selectPathHandle(1);
        editor.update(0.016);

        expect(editor.pathHandles[1].scale.x).toBeGreaterThan(editor.pathHandles[0].scale.x);
        expect(editor.pathHandles[1].material.color.getHex()).toBe(0xfff0bd);
        expect(editor.pathHandles[0].material.color.getHex()).toBe(0xffbb55);
        expect(editor.pathSelectionHalo.visible).toBe(true);
        expect(
            editor.pathSelectionHalo.position.distanceTo(editor.pathHandles[1].position),
        ).toBeLessThan(1e-6);
    });

    it('keeps the selected path index highlighted after a handle rebuild', () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.selectPathHandle(2);

        const nextLayout = {
            controlPoints: [
                { x: -4, y: 1, z: 3 },
                { x: 10, y: 6, z: -12 },
                { x: 23, y: 15, z: -31 },
                { x: 41, y: 26, z: -58 },
            ],
            levelPositionsById: {
                1: 0.18,
                2: 0.78,
            },
        };
        boardController._layout = cloneLayout(nextLayout);
        boardController.presentationLayout = createPresentationLayout(nextLayout, boardController.levelData);
        boardController.pathRenderer.pathCurve = createCurve(nextLayout.controlPoints);

        editor.refreshFromBoardLayout();

        expect(editor.pathHandles).toHaveLength(4);
        expect(editor.selectedDescriptor).toEqual({ type: 'path', index: 2 });
        expect(editor.pathHandles[2].scale.x).toBeGreaterThan(editor.pathHandles[1].scale.x);
        expect(editor.transformControls.object).toBe(editor.pathHandles[2]);
        expect(
            editor.pathSelectionHalo.position.distanceTo(editor.pathHandles[2].position),
        ).toBeLessThan(1e-6);
    });

    it('uses arrow keys to nudge a selected path point in free camera without rotating the camera', async () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.selectPathHandle(1);
        editor.enableFreeCamera();

        const nudgeSpy = vi.spyOn(editor, 'nudgeSelectedPathPoint').mockResolvedValue(true);
        const event = createKeyEvent({
            key: 'ArrowLeft',
            code: 'ArrowLeft',
        });

        editor.onKeyDown(event);
        editor.updateFreeCameraMovement(0.25);
        await Promise.resolve();

        expect(nudgeSpy).toHaveBeenCalledTimes(1);
        expect(editor.freeCameraMovementKeys.has('ArrowLeft')).toBe(false);
        expect(boardController.cameraController.rotateFreeCamera).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('still rotates the free camera with IJKL keys', () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.enableFreeCamera();

        const event = createKeyEvent({
            key: 'j',
            code: 'KeyJ',
        });

        editor.onKeyDown(event);
        editor.updateFreeCameraMovement(0.25);

        expect(editor.freeCameraMovementKeys.has('KeyJ')).toBe(true);
        expect(boardController.cameraController.rotateFreeCamera).toHaveBeenCalledTimes(1);
        expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('updates the HUD text to explain path nudging during free camera', () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.selectPathHandle(0);
        editor.enableFreeCamera();

        expect(editor.cameraHintLabel.textContent).toContain('Arrow keys still nudge the selected path point');
        expect(editor.selectionDetailLabel.textContent).toContain('This point stays highlighted in Free Camera');
        expect(editor.selectionDetailLabel.textContent).toContain('IJKL');
    });

    it('can minimize the left layout editor panel to a header-only state and expand it again', () => {
        const boardController = createBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();

        expect(editor.isPanelMinimized).toBe(false);
        expect(editor.panelContent.style.display).toBe('flex');
        expect(editor.panel.style.width).toBe('380px');
        expect(editor.panelTitleLabel.textContent).toBe('Odyssey Layout Editor');
        expect(editor.panelToggleButton.textContent).toBe('▾');

        editor.togglePanelMinimized();

        expect(editor.isPanelMinimized).toBe(true);
        expect(editor.panelContent.style.display).toBe('none');
        expect(editor.panel.style.width).toBe('176px');
        expect(editor.panel.style.overflow).toBe('hidden');
        expect(editor.panelTitleLabel.textContent).toBe('Odyssey Editor');
        expect(editor.panelToggleButton.textContent).toBe('▸');
        expect(editor.panelToggleButton.title).toBe('Expand the Odyssey Layout Editor');

        editor.togglePanelMinimized();

        expect(editor.isPanelMinimized).toBe(false);
        expect(editor.panelContent.style.display).toBe('flex');
        expect(editor.panel.style.width).toBe('380px');
        expect(editor.panel.style.overflow).toBe('auto');
        expect(editor.panelTitleLabel.textContent).toBe('Odyssey Layout Editor');
        expect(editor.panelToggleButton.textContent).toBe('▾');
        expect(editor.panelToggleButton.title).toBe('Minimize the Odyssey Layout Editor');
    });

    it('shows local clamp diagnostics and protected-checkpoint messaging when a chapter drag hits its limit', () => {
        const boardController = createChapterBoardController();
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.setMode('chapter');
        editor.selectDescriptor({ type: 'chapter', chapterId: 3 });
        editor.dragState = { type: 'chapter', chapterId: 3 };
        vi.spyOn(editor, 'findNearestCurvePositionFromPointer').mockReturnValue(0.20);
        const queueSpy = vi.spyOn(editor, 'queueLayoutApply').mockImplementation(() => {});
        const moveEvent = {
            preventDefault: vi.fn(),
            stopImmediatePropagation: vi.fn(),
        };

        editor.onPointerMove(moveEvent);
        editor.onPointerUp({
            pointerId: 1,
            preventDefault: vi.fn(),
            stopImmediatePropagation: vi.fn(),
        });

        expect(queueSpy).toHaveBeenCalledTimes(1);
        expect(editor.chapterDragDiagnostics.localClampUsed).toBe(true);
        expect(editor.chapterDragDiagnostics.localClampSide).toBe('previous');
        expect(editor.selectionDetailLabel.textContent).toContain('Local clamp on previous chapter limit');
        expect(editor.selectionDetailLabel.textContent).toContain('other checkpoints protected');
        expect(editor.statusLabel.textContent).toContain('hit its local clamp');
        expect(editor.modeHintLabel.textContent).toContain('Only the two adjacent chapters compress');
    });

    it('keeps keyboard chapter nudges inside the local clamp and leaves non-adjacent chapters alone', async () => {
        const boardController = createChapterBoardController({
            layout: {
                controlPoints: [
                    { x: 0, y: 0, z: 0 },
                    { x: 12, y: 20, z: -18 },
                    { x: 24, y: 38, z: -44 },
                    { x: 40, y: 62, z: -78 },
                ],
                levelPositionsById: {
                    1: 0.00,
                    2: 0.10,
                    3: 0.30,
                    4: 0.307,
                    5: 0.315,
                    6: 0.72,
                    7: 1.00,
                },
            },
        });
        editor = new OdysseyLayoutEditor(boardController);
        editor.initialize();
        editor.setMode('chapter');
        editor.selectDescriptor({ type: 'chapter', chapterId: 3 });

        editor.onKeyDown(createKeyEvent({
            key: 'ArrowLeft',
            code: 'ArrowLeft',
            shiftKey: true,
        }));
        await Promise.resolve();
        await Promise.resolve();

        expect(boardController.getLayoutData().levelPositionsById[1]).toBeCloseTo(0.00, 6);
        expect(boardController.getLayoutData().levelPositionsById[2]).toBeCloseTo(0.10, 6);
        expect(boardController.getLayoutData().levelPositionsById[3]).toBeCloseTo(0.30, 6);
        expect(boardController.getLayoutData().levelPositionsById[4]).toBeCloseTo(0.30245, 5);
        expect(boardController.getLayoutData().levelPositionsById[5]).toBeCloseTo(0.30525, 5);
        expect(boardController.getLayoutData().levelPositionsById[6]).toBeCloseTo(0.72, 6);
        expect(boardController.getLayoutData().levelPositionsById[7]).toBeCloseTo(1.00, 6);
        expect(editor.chapterDragDiagnostics.localClampUsed).toBe(true);
        expect(editor.chapterDragDiagnostics.localClampSide).toBe('previous');
        expect(editor.statusLabel.textContent).toContain('local clamp');
        expect(editor.statusLabel.textContent).toContain('stayed protected');
    });
});
