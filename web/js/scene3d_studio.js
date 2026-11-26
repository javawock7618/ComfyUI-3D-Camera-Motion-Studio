import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const EASING_MODES = ["Linear", "Ease In", "Ease Out", "Ease In-Out"];
const RENDER_MODES = ["Standard", "Wireframe", "Depth", "Normal"];
const INITIAL_KEYFRAMES = [
    { frame: 0, camPos: [4, 3, 4], target: [0, 0.5, 0], easing: "Ease In-Out" },
];
const WINDOW_SIZE_STORAGE_KEY = "comfyui_3d_camera_studio_window_size_v7";
const DEFAULT_WINDOW_SIZE = [700, 780];

function loadSavedWindowSize() {
    try {
        const raw = window.localStorage?.getItem(WINDOW_SIZE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const w = Number(parsed?.width);
        const h = Number(parsed?.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w >= 460 && h >= 480 && w <= 2600 && h <= 2200) {
            return [Math.round(w), Math.round(h)];
        }
    } catch (_) {}
    return null;
}

function saveWindowSize(size) {
    try {
        if (!Array.isArray(size) || size.length < 2) return;
        const w = Number(size[0]);
        const h = Number(size[1]);
        if (Number.isFinite(w) && Number.isFinite(h) && w >= 460 && h >= 480 && w <= 2600 && h <= 2200) {
            window.localStorage?.setItem(
                WINDOW_SIZE_STORAGE_KEY,
                JSON.stringify({ width: Math.round(w), height: Math.round(h) })
            );
        }
    } catch (_) {}
}

function createDefaultKeyframes() {
    return INITIAL_KEYFRAMES.map((kf) => ({
        frame: kf.frame,
        camPos: [...kf.camPos],
        target: [...kf.target],
        easing: kf.easing,
    }));
}

function applyEasing(t, mode = "Linear") {
    const clamped = Math.max(0, Math.min(1, t));
    switch (mode) {
        case "Ease In":
            return clamped * clamped * clamped;
        case "Ease Out": {
            const inv = 1 - clamped;
            return 1 - inv * inv * inv;
        }
        case "Ease In-Out":
            return clamped < 0.5
                ? 4 * clamped * clamped * clamped
                : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
        case "Linear":
        default:
            return clamped;
    }
}

async function loadThree() {
    if (window.__THREE_STUDIO_MODULES__) {
        return window.__THREE_STUDIO_MODULES__;
    }
    const THREE = await import("https://esm.sh/three@0.169.0");
    const { OrbitControls } = await import("https://esm.sh/three@0.169.0/examples/jsm/controls/OrbitControls.js");
    const { GLTFLoader } = await import("https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js");

    window.__THREE_STUDIO_MODULES__ = { THREE, OrbitControls, GLTFLoader };
    return window.__THREE_STUDIO_MODULES__;
}

function disposeObject3D(rootObj) {
    rootObj.traverse((child) => {
        if (child.isMesh) {
            child.geometry?.dispose?.();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of mats) {
                if (!mat) continue;
                for (const key of Object.keys(mat)) {
                    const val = mat[key];
                    if (val && val.isTexture) {
                        val.dispose?.();
                    }
                }
                mat.dispose?.();
            }
        }
    });
}

function roundToStep(val, step = 0.1) {
    const rounded = Math.round(val / step) * step;
    return Math.round(rounded * 1e6) / 1e6;
}

function createRgbGizmo(THREE, camera, rendererDom, orbitControls, onTransformChange) {
    const root = new THREE.Group();
    root.visible = false;

    const moveGroup = new THREE.Group();
    const rotateGroup = new THREE.Group();
    root.add(moveGroup);
    root.add(rotateGroup);

    const AXES = [
        { name: "x", color: 0xe53e3e, dir: new THREE.Vector3(1, 0, 0) },
        { name: "y", color: 0x38a169, dir: new THREE.Vector3(0, 1, 0) },
        { name: "z", color: 0x3182ce, dir: new THREE.Vector3(0, 0, 1) },
    ];

    const pickables = [];

    for (const ax of AXES) {
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({
            color: ax.color,
            depthTest: false,
            transparent: true,
            opacity: 0.92,
        });

        const shaftGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 12);
        shaftGeo.translate(0, 0.45, 0);
        const shaft = new THREE.Mesh(shaftGeo, mat);

        const tipGeo = new THREE.ConeGeometry(0.08, 0.22, 16);
        tipGeo.translate(0, 1.0, 0);
        const tip = new THREE.Mesh(tipGeo, mat);

        const hitGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.15, 10);
        hitGeo.translate(0, 0.55, 0);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.userData = { gizmoMode: "translate", axis: ax.name };
        pickables.push(hitMesh);

        g.add(shaft, tip, hitMesh);

        if (ax.name === "x") g.rotation.z = -Math.PI / 2;
        if (ax.name === "z") g.rotation.x = Math.PI / 2;

        moveGroup.add(g);
    }

    for (const ax of AXES) {
        const ringGeo = new THREE.TorusGeometry(0.85, 0.024, 12, 48);
        const mat = new THREE.MeshBasicMaterial({
            color: ax.color,
            depthTest: false,
            transparent: true,
            opacity: 0.92,
        });
        const ring = new THREE.Mesh(ringGeo, mat);

        const hitGeo = new THREE.TorusGeometry(0.85, 0.11, 10, 40);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitRing = new THREE.Mesh(hitGeo, hitMat);
        hitRing.userData = { gizmoMode: "rotate", axis: ax.name };
        pickables.push(hitRing);

        const rGroup = new THREE.Group();
        rGroup.add(ring, hitRing);

        if (ax.name === "x") rGroup.rotation.y = Math.PI / 2;
        if (ax.name === "y") rGroup.rotation.x = Math.PI / 2;

        rotateGroup.add(rGroup);
    }

    let attachedObj = null;
    let mode = "translate";
    let activeAxis = null;
    let isDragging = false;
    let dragPlane = new THREE.Plane();
    let dragStartPoint = new THREE.Vector3();
    let objStartPos = new THREE.Vector3();
    let objStartQuat = new THREE.Quaternion();
    let axisWorldDir = new THREE.Vector3();
    let startAngle = 0;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const camDir = new THREE.Vector3();
    const tmpVec = new THREE.Vector3();

    function updateNdc(clientX, clientY) {
        const rect = rendererDom.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        return true;
    }

    function hitTest(clientX, clientY) {
        if (!root.visible || !attachedObj) return null;
        if (!updateNdc(clientX, clientY)) return null;
        raycaster.setFromCamera(ndc, camera);
        const activePickables = pickables.filter((p) => p.userData.gizmoMode === mode);
        const hits = raycaster.intersectObjects(activePickables, false);
        return hits.length > 0 ? hits[0].object.userData.axis : null;
    }

    function onPointerDown(e) {
        if (e.button !== 0 || !root.visible || !attachedObj) return false;
        const axis = hitTest(e.clientX, e.clientY);
        if (!axis) return false;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        activeAxis = axis;
        isDragging = true;
        orbitControls.enabled = false;

        root.getWorldPosition(objStartPos);
        objStartQuat.copy(attachedObj.quaternion);

        if (axis === "x") axisWorldDir.set(1, 0, 0);
        else if (axis === "y") axisWorldDir.set(0, 1, 0);
        else axisWorldDir.set(0, 0, 1);

        camera.getWorldDirection(camDir);
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(ndc, camera);

        if (mode === "translate") {
            tmpVec.crossVectors(axisWorldDir, camDir);
            const normal = new THREE.Vector3().crossVectors(tmpVec, axisWorldDir).normalize();
            if (normal.lengthSq() < 1e-4) normal.copy(camDir);
            dragPlane.setFromNormalAndCoplanarPoint(normal, objStartPos);
            raycaster.ray.intersectPlane(dragPlane, dragStartPoint);
        } else if (mode === "rotate") {
            dragPlane.setFromNormalAndCoplanarPoint(axisWorldDir, objStartPos);
            const pt = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(dragPlane, pt)) {
                const v = pt.clone().sub(objStartPos);
                const basis1 = new THREE.Vector3();
                const basis2 = new THREE.Vector3();
                if (Math.abs(axisWorldDir.y) < 0.9) {
                    basis1.crossVectors(axisWorldDir, new THREE.Vector3(0, 1, 0)).normalize();
                } else {
                    basis1.crossVectors(axisWorldDir, new THREE.Vector3(1, 0, 0)).normalize();
                }
                basis2.crossVectors(axisWorldDir, basis1).normalize();
                startAngle = Math.atan2(v.dot(basis2), v.dot(basis1));
                dragPlane.userData = { basis1, basis2 };
            }
        }

        const onWindowMove = (ev) => {
            if (!isDragging || !attachedObj) return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            if (!updateNdc(ev.clientX, ev.clientY)) return;
            raycaster.setFromCamera(ndc, camera);

            if (mode === "translate") {
                const currPt = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(dragPlane, currPt)) {
                    const delta = currPt.sub(dragStartPoint);
                    const alongAxis = delta.dot(axisWorldDir);
                    attachedObj.position.copy(objStartPos).addScaledVector(axisWorldDir, alongAxis);
                    root.position.copy(attachedObj.position);
                    onTransformChange?.(attachedObj);
                }
            } else if (mode === "rotate") {
                const currPt = new THREE.Vector3();
                if (raycaster.ray.intersectPlane(dragPlane, currPt)) {
                    const { basis1, basis2 } = dragPlane.userData || {};
                    if (basis1 && basis2) {
                        const v = currPt.sub(objStartPos);
                        const currAngle = Math.atan2(v.dot(basis2), v.dot(basis1));
                        const deltaAngle = currAngle - startAngle;
                        const rotQuat = new THREE.Quaternion().setFromAxisAngle(axisWorldDir, deltaAngle);
                        attachedObj.quaternion.copy(objStartQuat).premultiply(rotQuat);
                        onTransformChange?.(attachedObj);
                    }
                }
            }
        };

        const onWindowUp = (ev) => {
            if (!isDragging) return;
            isDragging = false;
            activeAxis = null;
            orbitControls.enabled = true;
            window.removeEventListener("pointermove", onWindowMove, true);
            window.removeEventListener("pointerup", onWindowUp, true);
            if (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
            }
        };

        window.addEventListener("pointermove", onWindowMove, true);
        window.addEventListener("pointerup", onWindowUp, true);
        return true;
    }

    function updateScaleToCamera() {
        if (!root.visible || !attachedObj) return;
        root.position.copy(attachedObj.position);
        const dist = camera.position.distanceTo(root.position);
        const s = Math.max(0.25, Math.min(8.0, dist * 0.22));
        root.scale.setScalar(s);
    }

    return {
        object: root,
        get dragging() {
            return isDragging;
        },
        get visible() {
            return root.visible;
        },
        set visible(v) {
            root.visible = Boolean(v);
        },
        attach(obj) {
            attachedObj = obj;
            if (attachedObj) {
                root.position.copy(attachedObj.position);
                root.visible = true;
                updateScaleToCamera();
            } else {
                root.visible = false;
            }
        },
        detach() {
            attachedObj = null;
            root.visible = false;
        },
        setMode(nextMode) {
            mode = nextMode === "rotate" ? "rotate" : "translate";
            moveGroup.visible = mode === "translate";
            rotateGroup.visible = mode === "rotate";
        },
        onPointerDown,
        update: updateScaleToCamera,
        dispose() {
            for (const p of pickables) {
                p.geometry?.dispose?.();
                p.material?.dispose?.();
            }
            moveGroup.traverse((c) => {
                if (c.isMesh) {
                    c.geometry?.dispose?.();
                    c.material?.dispose?.();
                }
            });
            rotateGroup.traverse((c) => {
                if (c.isMesh) {
                    c.geometry?.dispose?.();
                    c.material?.dispose?.();
                }
            });
        },
    };
}

function createStudioWidget(node) {
    const { THREE, OrbitControls, GLTFLoader } = window.__THREE_STUDIO_MODULES__;

    const state = {
        models: [],
        selectedModelId: null,
        gizmoMode: "translate",
        width: 512,
        height: 512,
        totalFrames: 24,
        fps: 24.0,
        currentFrame: 0,
        isPlaying: false,
        easing: "Ease In-Out",
        exportRenderMode: "Standard",
        exportGrid: true,
        showPathGuide: true,
        keyframes: createDefaultKeyframes(),
        isRendering: false,
    };

    const root = document.createElement("div");
    root.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 360px;
        box-sizing: border-box;
        background: #181a1f;
        color: #e6e8ef;
        border: 1px solid #2e323d;
        border-radius: 6px;
        overflow: hidden;
        font-family: sans-serif;
        font-size: 12px;
        user-select: none;
    `;

    const topRow = document.createElement("div");
    topRow.style.cssText = `
        display: flex;
        flex: 1;
        min-height: 0;
    `;

    const viewportArea = document.createElement("div");
    viewportArea.style.cssText = `
        position: relative;
        flex: 1;
        min-width: 0;
        min-height: 0;
        background: #0c0e12;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    `;

    const viewportWrap = document.createElement("div");
    viewportWrap.style.cssText = `
        position: relative;
        width: 240px;
        height: 240px;
        background: #101216;
        border: 1px solid #3a4152;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
        overflow: hidden;
        touch-action: none;
    `;

    const hudInfo = document.createElement("div");
    hudInfo.style.cssText = `
        position: absolute;
        top: 6px;
        left: 6px;
        background: rgba(16, 18, 22, 0.78);
        padding: 3px 7px;
        border-radius: 4px;
        pointer-events: none;
        font-size: 10px;
        color: #aab2c5;
        z-index: 3;
        white-space: nowrap;
    `;
    hudInfo.textContent = "512x512 | Frame: 0 / 23 (0.00s) | 24.0 FPS | Ease In-Out";
    viewportWrap.appendChild(hudInfo);
    viewportArea.appendChild(viewportWrap);

    const rightPanel = document.createElement("div");
    rightPanel.style.cssText = `
        width: 210px;
        flex-shrink: 0;
        min-height: 0;
        box-sizing: border-box;
        border-left: 1px solid #2e323d;
        background: #1e2128;
        display: flex;
        flex-direction: column;
        padding: 6px 7px;
        gap: 4px;
        overflow-y: auto;
        overflow-x: hidden;
    `;

    const rightTitle = document.createElement("div");
    rightTitle.textContent = "3D Models (.glb)";
    rightTitle.style.cssText = "font-weight: bold; font-size: 11px; color: #fff; flex-shrink: 0; line-height: 1.2;";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".glb";
    fileInput.multiple = true;
    fileInput.style.display = "none";

    const presetFileInput = document.createElement("input");
    presetFileInput.type = "file";
    presetFileInput.accept = ".json,application/json";
    presetFileInput.style.display = "none";

    const modelBtnRow = document.createElement("div");
    modelBtnRow.style.cssText = "display: flex; gap: 4px; flex-shrink: 0;";

    const loadBtn = document.createElement("button");
    loadBtn.textContent = "+ Load .glb";
    loadBtn.style.cssText = `
        flex: 1;
        padding: 4px 5px;
        background: #2b6cb0;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 11px;
    `;
    loadBtn.onclick = () => fileInput.click();

    const deleteModelBtn = document.createElement("button");
    deleteModelBtn.textContent = "Delete";
    deleteModelBtn.style.cssText = `
        padding: 4px 7px;
        background: #9b2c2c;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 11px;
    `;

    modelBtnRow.appendChild(loadBtn);
    modelBtnRow.appendChild(deleteModelBtn);

    const shapeAddRow = document.createElement("div");
    shapeAddRow.style.cssText = `
        display: flex;
        gap: 3px;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
        background: #14161b;
        border: 1px solid #2e323d;
        border-radius: 4px;
        padding: 3px;
    `;

    const SHAPE_OPTIONS = [
        {
            value: "box",
            label: "Add Box",
            svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2L14 5.2V10.8L8 14L2 10.8V5.2L8 2Z"/><path d="M8 8L14 5.2M8 8V14M8 8L2 5.2"/></svg>`,
        },
        {
            value: "sphere",
            label: "Add Sphere",
            svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.5"/></svg>`,
        },
        {
            value: "cylinder",
            label: "Add Cylinder",
            svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="3.5" rx="5" ry="2"/><path d="M3 3.5V12.5C3 13.6 5.2 14.5 8 14.5C10.8 14.5 13 13.6 13 12.5V3.5"/></svg>`,
        },
        {
            value: "plane",
            label: "Add Plane",
            svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><polygon points="3,11.5 6.5,4.5 13.5,4.5 10,11.5"/></svg>`,
        },
        {
            value: "cone",
            label: "Add Cone",
            svg: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2.5L3 12.2H13L8 2.5Z"/><ellipse cx="8" cy="12.2" rx="5" ry="1.8"/></svg>`,
        },
    ];

    for (const optDef of SHAPE_OPTIONS) {
        const iconBtn = document.createElement("button");
        iconBtn.type = "button";
        iconBtn.title = optDef.label;
        iconBtn.setAttribute("aria-label", optDef.label);
        iconBtn.innerHTML = optDef.svg;
        iconBtn.style.cssText = `
            flex: 1;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #232732;
            color: #e2e8f0;
            border: 1px solid #353b4a;
            border-radius: 3px;
            cursor: pointer;
            padding: 0;
            transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
        `;
        iconBtn.onmouseenter = () => {
            iconBtn.style.background = "#2f855a";
            iconBtn.style.borderColor = "#48bb78";
            iconBtn.style.color = "#fff";
        };
        iconBtn.onmouseleave = () => {
            iconBtn.style.background = "#232732";
            iconBtn.style.borderColor = "#353b4a";
            iconBtn.style.color = "#e2e8f0";
        };
        iconBtn.onclick = () => {
            addBasicShape(optDef.value);
        };
        shapeAddRow.appendChild(iconBtn);
    }

    const gizmoRow = document.createElement("div");
    gizmoRow.style.cssText = "display: flex; gap: 4px; align-items: center; flex-shrink: 0;";

    const moveModeBtn = document.createElement("button");
    moveModeBtn.textContent = "Move (XYZ)";
    moveModeBtn.style.cssText = `
        flex: 1;
        padding: 3px 5px;
        background: #3182ce;
        color: #fff;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10.5px;
        font-weight: bold;
    `;

    const rotateModeBtn = document.createElement("button");
    rotateModeBtn.textContent = "Rotate";
    rotateModeBtn.style.cssText = `
        flex: 1;
        padding: 3px 5px;
        background: #2d3748;
        color: #cbd5e0;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10.5px;
        font-weight: bold;
    `;

    gizmoRow.appendChild(moveModeBtn);
    gizmoRow.appendChild(rotateModeBtn);

    const modelListEl = document.createElement("div");
    modelListEl.style.cssText = `
        min-height: 44px;
        max-height: 82px;
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 3px;
        background: #14161b;
        padding: 3px;
        border-radius: 4px;
    `;

    // GLB Animation clip selector & play/sync toggle for selected animated model
    const glbAnimBox = document.createElement("div");
    glbAnimBox.style.cssText = `
        display: none;
        flex-direction: column;
        flex-shrink: 0;
        gap: 3px;
        padding: 4px 5px;
        background: #14161b;
        border: 1px solid #2e323d;
        border-radius: 4px;
        font-size: 10px;
    `;

    const glbAnimHeader = document.createElement("div");
    glbAnimHeader.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 4px;";

    const glbAnimLabel = document.createElement("span");
    glbAnimLabel.textContent = "GLB Motion";
    glbAnimLabel.style.cssText = "color: #90cdf4; font-weight: bold;";

    const glbAnimEnabledWrap = document.createElement("label");
    glbAnimEnabledWrap.style.cssText = "display: flex; align-items: center; gap: 2px; color: #cbd5e0; cursor: pointer;";
    const glbAnimCheckbox = document.createElement("input");
    glbAnimCheckbox.type = "checkbox";
    glbAnimCheckbox.checked = true;
    glbAnimCheckbox.style.cssText = "cursor: pointer; margin: 0;";
    const glbAnimCheckText = document.createElement("span");
    glbAnimCheckText.textContent = "Sync";
    glbAnimEnabledWrap.append(glbAnimCheckbox, glbAnimCheckText);

    glbAnimHeader.append(glbAnimLabel, glbAnimEnabledWrap);

    const glbAnimSelect = document.createElement("select");
    glbAnimSelect.style.cssText = `
        width: 100%;
        background: #1e2128;
        color: #fff;
        border: 1px solid #383e4d;
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 10px;
        cursor: pointer;
    `;

    glbAnimBox.append(glbAnimHeader, glbAnimSelect);

    const transformBox = document.createElement("div");
    transformBox.style.cssText = `
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        gap: 3px;
        padding-top: 4px;
        border-top: 1px solid #2e323d;
        font-size: 10.5px;
    `;

    function makeCompactAxisInput(axisLabel, axisColor, step, getCurrentValue, onChange) {
        const cell = document.createElement("div");
        cell.style.cssText = `
            display: flex;
            align-items: center;
            flex: 1;
            min-width: 0;
            background: #14161b;
            border: 1px solid #323846;
            border-radius: 3px;
            overflow: hidden;
        `;

        const tag = document.createElement("span");
        tag.textContent = axisLabel;
        tag.title = `Drag left/right to adjust by ${step}`;
        tag.style.cssText = `
            color: ${axisColor};
            font-weight: bold;
            font-size: 10px;
            padding: 2px 4px;
            cursor: ew-resize;
            background: rgba(255, 255, 255, 0.04);
            user-select: none;
            flex-shrink: 0;
        `;

        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = String(step);
        inp.style.cssText = `
            width: 100%;
            min-width: 0;
            background: transparent;
            color: #fff;
            border: none;
            outline: none;
            padding: 2px 3px;
            font-size: 10.5px;
            font-family: inherit;
        `;

        inp.onchange = () => {
            const parsed = parseFloat(inp.value);
            const nextVal = Number.isFinite(parsed) ? roundToStep(parsed, step) : 0;
            onChange(nextVal);
        };

        let isDragging = false;
        let startX = 0;
        let startValue = 0;
        const pxPerStep = 8;

        const onMouseMove = (e) => {
            if (!isDragging) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            const dx = e.clientX - startX;
            const stepsDelta = Math.round(dx / pxPerStep);
            const nextVal = roundToStep(startValue + stepsDelta * step, step);
            onChange(nextVal);
        };

        const onMouseUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            tag.style.background = "rgba(255, 255, 255, 0.04)";
            document.body.style.cursor = "";
            window.removeEventListener("mousemove", onMouseMove, true);
            window.removeEventListener("mouseup", onMouseUp, true);
            if (e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        };

        tag.onmousedown = (e) => {
            if (e.button !== 0 || tag.dataset.disabled === "true") return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            isDragging = true;
            startX = e.clientX;
            startValue = roundToStep(getCurrentValue(), step);
            tag.style.background = "rgba(49, 130, 206, 0.38)";
            document.body.style.cursor = "ew-resize";
            window.addEventListener("mousemove", onMouseMove, true);
            window.addEventListener("mouseup", onMouseUp, true);
        };

        cell.appendChild(tag);
        cell.appendChild(inp);

        return {
            cell,
            inp,
            setDisabled(disabled) {
                inp.disabled = disabled;
                tag.dataset.disabled = disabled ? "true" : "false";
                cell.style.opacity = disabled ? "0.45" : "1";
                tag.style.cursor = disabled ? "default" : "ew-resize";
            },
        };
    }

    // Compact 3-column Pos row
    const posHeader = document.createElement("div");
    posHeader.textContent = "Position";
    posHeader.style.cssText = "color: #9aa2b4; font-size: 10px;";
    const posGrid = document.createElement("div");
    posGrid.style.cssText = "display: flex; gap: 3px;";

    const posXInput = makeCompactAxisInput(
        "X",
        "#fc8181",
        0.1,
        () => state.models.find((m) => m.id === state.selectedModelId)?.pos[0] ?? 0,
        (v) => updateSelectedModel("x", v)
    );
    const posYInput = makeCompactAxisInput(
        "Y",
        "#68d391",
        0.1,
        () => state.models.find((m) => m.id === state.selectedModelId)?.pos[1] ?? 0,
        (v) => updateSelectedModel("y", v)
    );
    const posZInput = makeCompactAxisInput(
        "Z",
        "#63b3ed",
        0.1,
        () => state.models.find((m) => m.id === state.selectedModelId)?.pos[2] ?? 0,
        (v) => updateSelectedModel("z", v)
    );
    posGrid.append(posXInput.cell, posYInput.cell, posZInput.cell);

    // Compact 3-column Rot row
    const rotHeader = document.createElement("div");
    rotHeader.textContent = "Rotation (°)";
    rotHeader.style.cssText = "color: #9aa2b4; font-size: 10px; margin-top: 1px;";
    const rotGrid = document.createElement("div");
    rotGrid.style.cssText = "display: flex; gap: 3px;";

    const rotXInput = makeCompactAxisInput(
        "X",
        "#fc8181",
        1.0,
        () => state.models.find((m) => m.id === state.selectedModelId)?.rotDeg[0] ?? 0,
        (v) => updateSelectedModel("rx", v)
    );
    const rotYInput = makeCompactAxisInput(
        "Y",
        "#68d391",
        1.0,
        () => state.models.find((m) => m.id === state.selectedModelId)?.rotDeg[1] ?? 0,
        (v) => updateSelectedModel("ry", v)
    );
    const rotZInput = makeCompactAxisInput(
        "Z",
        "#63b3ed",
        1.0,
        () => state.models.find((m) => m.id === state.selectedModelId)?.rotDeg[2] ?? 0,
        (v) => updateSelectedModel("rz", v)
    );
    rotGrid.append(rotXInput.cell, rotYInput.cell, rotZInput.cell);

    // Scale + Reset on a single compact row
    const scaleResetRow = document.createElement("div");
    scaleResetRow.style.cssText = "display: flex; gap: 4px; align-items: center; margin-top: 2px;";

    const scaleInput = makeCompactAxisInput(
        "Scale",
        "#cbd5e0",
        0.1,
        () => state.models.find((m) => m.id === state.selectedModelId)?.scale ?? 1,
        (v) => updateSelectedModel("scale", v)
    );

    const resetTransformBtn = document.createElement("button");
    resetTransformBtn.textContent = "Reset";
    resetTransformBtn.title = "Reset Position, Rotation, and Scale";
    resetTransformBtn.style.cssText = `
        padding: 3px 8px;
        background: #2d3748;
        color: #e2e8f0;
        border: 1px solid #4a5568;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        font-weight: bold;
        flex-shrink: 0;
    `;
    scaleResetRow.append(scaleInput.cell, resetTransformBtn);

    const presetBox = document.createElement("div");
    presetBox.style.cssText = `
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        gap: 3px;
        padding-top: 4px;
        border-top: 1px solid #2e323d;
    `;

    const presetTitle = document.createElement("div");
    presetTitle.textContent = "Scene / KF Preset (.json)";
    presetTitle.style.cssText = "font-weight: bold; font-size: 10px; color: #9aa2b4;";

    const presetBtnRow = document.createElement("div");
    presetBtnRow.style.cssText = "display: flex; gap: 4px;";

    const savePresetBtn = document.createElement("button");
    savePresetBtn.textContent = "Save JSON";
    savePresetBtn.style.cssText = `
        flex: 1;
        padding: 4px 5px;
        background: #2c7a7b;
        color: #fff;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        font-weight: bold;
    `;

    const loadPresetBtn = document.createElement("button");
    loadPresetBtn.textContent = "Load JSON";
    loadPresetBtn.style.cssText = `
        flex: 1;
        padding: 4px 5px;
        background: #4a5568;
        color: #fff;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        font-size: 10px;
        font-weight: bold;
    `;
    loadPresetBtn.onclick = () => presetFileInput.click();

    presetBtnRow.appendChild(savePresetBtn);
    presetBtnRow.appendChild(loadPresetBtn);
    presetBox.appendChild(presetTitle);
    presetBox.appendChild(presetBtnRow);

    transformBox.append(posHeader, posGrid, rotHeader, rotGrid, scaleResetRow);

    rightPanel.appendChild(rightTitle);
    rightPanel.appendChild(modelBtnRow);
    rightPanel.appendChild(shapeAddRow);
    rightPanel.appendChild(gizmoRow);
    rightPanel.appendChild(modelListEl);
    rightPanel.appendChild(glbAnimBox);
    rightPanel.appendChild(transformBox);
    rightPanel.appendChild(presetBox);

    topRow.appendChild(viewportArea);
    topRow.appendChild(rightPanel);

    const bottomPanel = document.createElement("div");
    bottomPanel.style.cssText = `
        flex-shrink: 0;
        box-sizing: border-box;
        border-top: 1px solid #2e323d;
        background: #1e2128;
        padding: 7px 10px 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    `;

    const controlsRow = document.createElement("div");
    controlsRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: nowrap;
        overflow-x: auto;
    `;

    const leftControls = document.createElement("div");
    leftControls.style.cssText = "display: flex; gap: 5px; align-items: center; flex-wrap: nowrap; min-width: 0;";

    const previewBtn = document.createElement("button");
    previewBtn.textContent = "▶ Preview";
    previewBtn.style.cssText = `
        padding: 4px 8px;
        background: #3182ce;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const easingWrap = document.createElement("label");
    easingWrap.style.cssText = "display: flex; align-items: center; gap: 3px; color: #cbd5e0; font-size: 11px; white-space: nowrap; flex-shrink: 0;";
    easingWrap.textContent = "Ease";

    const easingSelect = document.createElement("select");
    easingSelect.style.cssText = `
        background: #14161b;
        color: #fff;
        border: 1px solid #383e4d;
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        cursor: pointer;
    `;
    for (const mode of EASING_MODES) {
        const opt = document.createElement("option");
        opt.value = mode;
        opt.textContent = mode;
        if (mode === state.easing) opt.selected = true;
        easingSelect.appendChild(opt);
    }
    easingWrap.appendChild(easingSelect);



    const gridCheckWrap = document.createElement("label");
    gridCheckWrap.title = "Include floor grid when exporting images";
    gridCheckWrap.style.cssText = "display: flex; align-items: center; gap: 3px; color: #cbd5e0; font-size: 11px; cursor: pointer; white-space: nowrap; flex-shrink: 0;";

    const gridCheckbox = document.createElement("input");
    gridCheckbox.type = "checkbox";
    gridCheckbox.checked = state.exportGrid;
    gridCheckbox.style.cssText = "cursor: pointer; margin: 0;";
    gridCheckbox.onchange = () => {
        state.exportGrid = gridCheckbox.checked;
    };

    const gridCheckText = document.createElement("span");
    gridCheckText.textContent = "Grid";
    gridCheckWrap.appendChild(gridCheckbox);
    gridCheckWrap.appendChild(gridCheckText);

    const pathCheckWrap = document.createElement("label");
    pathCheckWrap.title = "Show camera trajectory line and keyframe markers in preview";
    pathCheckWrap.style.cssText = "display: flex; align-items: center; gap: 3px; color: #cbd5e0; font-size: 11px; cursor: pointer; white-space: nowrap; flex-shrink: 0;";

    const pathCheckbox = document.createElement("input");
    pathCheckbox.type = "checkbox";
    pathCheckbox.checked = state.showPathGuide;
    pathCheckbox.style.cssText = "cursor: pointer; margin: 0;";
    pathCheckbox.onchange = () => {
        state.showPathGuide = pathCheckbox.checked;
        updateCameraPathVisuals();
    };

    const pathCheckText = document.createElement("span");
    pathCheckText.textContent = "Path";
    pathCheckWrap.appendChild(pathCheckbox);
    pathCheckWrap.appendChild(pathCheckText);

    const addKfBtn = document.createElement("button");
    addKfBtn.textContent = "◆ Add KF";
    addKfBtn.style.cssText = `
        padding: 4px 7px;
        background: #2f855a;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const delKfBtn = document.createElement("button");
    delKfBtn.textContent = "✕ Del";
    delKfBtn.title = "Delete keyframe at current frame";
    delKfBtn.style.cssText = `
        padding: 4px 6px;
        background: #742a2a;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const resetKfBtn = document.createElement("button");
    resetKfBtn.textContent = "↺ Reset";
    resetKfBtn.title = "Clear all keyframes and reset to initial state";
    resetKfBtn.style.cssText = `
        padding: 4px 6px;
        background: #4a5568;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const kfCountLabel = document.createElement("span");
    kfCountLabel.style.cssText = "color: #9aa2b4; font-size: 11px; white-space: nowrap; flex-shrink: 0;";

    const prevKfBtn = document.createElement("button");
    prevKfBtn.textContent = "◀";
    prevKfBtn.title = "Jump to previous keyframe";
    prevKfBtn.style.cssText = `
        padding: 4px 5px;
        background: #2d3748;
        color: #e2e8f0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const nextKfBtn = document.createElement("button");
    nextKfBtn.textContent = "▶";
    nextKfBtn.title = "Jump to next keyframe";
    nextKfBtn.style.cssText = `
        padding: 4px 5px;
        background: #2d3748;
        color: #e2e8f0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const updateKfBtn = document.createElement("button");
    updateKfBtn.textContent = "✎ Upd";
    updateKfBtn.title = "Overwrite current frame keyframe with current camera, target, and FOV";
    updateKfBtn.style.cssText = `
        padding: 4px 6px;
        background: #2b6cb0;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10.5px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const resetTargetBtn = document.createElement("button");
    resetTargetBtn.textContent = "◎ Tgt";
    resetTargetBtn.title = "Snap camera target to selected model or scene origin [0, 0.5, 0]";
    resetTargetBtn.style.cssText = `
        padding: 4px 6px;
        background: #2d3748;
        color: #90cdf4;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10.5px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const fovWrap = document.createElement("label");
    fovWrap.title = "Camera vertical FOV (degrees)";
    fovWrap.style.cssText = "display: flex; align-items: center; gap: 2px; color: #cbd5e0; font-size: 10.5px; white-space: nowrap; flex-shrink: 0;";
    fovWrap.textContent = "FOV";

    const fovSelect = document.createElement("select");
    fovSelect.style.cssText = `
        background: #14161b;
        color: #fff;
        border: 1px solid #383e4d;
        border-radius: 3px;
        padding: 2px 3px;
        font-size: 10.5px;
        cursor: pointer;
    `;
    for (const deg of [30, 38, 45, 55, 65, 75]) {
        const opt = document.createElement("option");
        opt.value = String(deg);
        opt.textContent = `${deg}°`;
        if (deg === 45) opt.selected = true;
        fovSelect.appendChild(opt);
    }
    fovWrap.appendChild(fovSelect);

    const undoBtn = document.createElement("button");
    undoBtn.textContent = "↶";
    undoBtn.title = "Undo (Ctrl+Z)";
    undoBtn.style.cssText = `
        padding: 4px 6px;
        background: #2d3748;
        color: #e2e8f0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    const redoBtn = document.createElement("button");
    redoBtn.textContent = "↷";
    redoBtn.title = "Redo (Ctrl+Y / Ctrl+Shift+Z)";
    redoBtn.style.cssText = `
        padding: 4px 6px;
        background: #2d3748;
        color: #e2e8f0;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    leftControls.appendChild(previewBtn);
    leftControls.appendChild(undoBtn);
    leftControls.appendChild(redoBtn);
    leftControls.appendChild(easingWrap);
    leftControls.appendChild(fovWrap);
    leftControls.appendChild(gridCheckWrap);
    leftControls.appendChild(pathCheckWrap);
    leftControls.appendChild(prevKfBtn);
    leftControls.appendChild(nextKfBtn);
    leftControls.appendChild(addKfBtn);
    leftControls.appendChild(updateKfBtn);
    leftControls.appendChild(delKfBtn);
    leftControls.appendChild(resetKfBtn);
    leftControls.appendChild(resetTargetBtn);
    leftControls.appendChild(kfCountLabel);

    const rightExportGroup = document.createElement("div");
    rightExportGroup.style.cssText = "display: flex; align-items: center; gap: 6px; flex-shrink: 0;";

    const outModeWrap = document.createElement("label");
    outModeWrap.title = "Render look mode for Export Images (Standard / Wireframe / Depth / Normal)";
    outModeWrap.style.cssText = "display: flex; align-items: center; gap: 3px; color: #cbd5e0; font-size: 11px; white-space: nowrap; flex-shrink: 0;";
    outModeWrap.textContent = "Out";

    const outModeSelect = document.createElement("select");
    outModeSelect.style.cssText = `
        background: #14161b;
        color: #fff;
        border: 1px solid #383e4d;
        border-radius: 3px;
        padding: 2px 4px;
        font-size: 11px;
        cursor: pointer;
    `;
    for (const rMode of RENDER_MODES) {
        const opt = document.createElement("option");
        opt.value = rMode;
        opt.textContent = rMode;
        if (rMode === state.exportRenderMode) opt.selected = true;
        outModeSelect.appendChild(opt);
    }
    outModeSelect.onchange = () => {
        state.exportRenderMode = RENDER_MODES.includes(outModeSelect.value) ? outModeSelect.value : "Standard";
        updateHud();
    };
    outModeWrap.appendChild(outModeSelect);

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export Images";
    exportBtn.style.cssText = `
        padding: 5px 10px;
        background: #d69e2e;
        color: #111;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        font-size: 11.5px;
        white-space: nowrap;
        flex-shrink: 0;
    `;

    rightExportGroup.appendChild(outModeWrap);
    rightExportGroup.appendChild(exportBtn);

    controlsRow.appendChild(leftControls);
    controlsRow.appendChild(rightExportGroup);

    // Properly spaced 3-tier timeline track (Markers -> Ruler labels -> Scrubber) with zero overlap!
    const trackWrap = document.createElement("div");
    trackWrap.style.cssText = `
        position: relative;
        height: 60px;
        box-sizing: border-box;
        background: #14161b;
        border: 1px solid #323746;
        border-radius: 4px;
        padding: 4px 12px 5px 12px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
    `;

    const markersLayer = document.createElement("div");
    markersLayer.style.cssText = `
        position: relative;
        width: 100%;
        height: 11px;
        pointer-events: none;
        z-index: 3;
        flex-shrink: 0;
    `;

    const rulerLayer = document.createElement("div");
    rulerLayer.style.cssText = `
        position: relative;
        width: 100%;
        height: 18px;
        pointer-events: none;
        font-size: 9px;
        color: #8892a6;
        flex-shrink: 0;
    `;

    const scrubber = document.createElement("input");
    scrubber.type = "range";
    scrubber.min = 0;
    scrubber.max = state.totalFrames - 1;
    scrubber.value = 0;
    scrubber.style.cssText = `
        position: relative;
        width: 100%;
        height: 16px;
        cursor: pointer;
        z-index: 2;
        margin: 0;
        flex-shrink: 0;
    `;

    trackWrap.appendChild(markersLayer);
    trackWrap.appendChild(rulerLayer);
    trackWrap.appendChild(scrubber);

    bottomPanel.appendChild(controlsRow);
    bottomPanel.appendChild(trackWrap);

    root.appendChild(topRow);
    root.appendChild(bottomPanel);
    root.appendChild(fileInput);
    root.appendChild(presetFileInput);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12151c);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(...state.keyframes[0].camPos);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewportWrap.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...state.keyframes[0].target);
    controls.enableDamping = true;
    controls.enableZoom = true;
    controls.zoomSpeed = 1.0;
    controls.update();

    const pathGuideGroup = new THREE.Group();
    scene.add(pathGuideGroup);

    const pathLineMat = new THREE.LineBasicMaterial({ color: 0x63b3ed, transparent: true, opacity: 0.85 });
    let pathLineObj = null;
    const kfMarkerGeo = new THREE.SphereGeometry(0.11, 14, 14);
    const kfMarkerMat = new THREE.MeshBasicMaterial({ color: 0xf6e05e });
    const targetMarkerGeo = new THREE.OctahedronGeometry(0.08, 0);
    const targetMarkerMat = new THREE.MeshBasicMaterial({ color: 0x68d391 });
    const targetLineMat = new THREE.LineBasicMaterial({ color: 0x48bb78, transparent: true, opacity: 0.35 });

    const MAX_HISTORY = 40;
    const undoStack = [];
    const redoStack = [];
    let isApplyingHistory = false;

    function captureHistorySnapshot() {
        const objects = {};
        for (const m of state.models) {
            if (!m?.name) continue;
            objects[m.name] = {
                pos: Array.isArray(m.pos) ? [...m.pos] : [0, 0, 0],
                rotDeg: Array.isArray(m.rotDeg) ? [...m.rotDeg] : [0, 0, 0],
                scale: typeof m.scale === "number" ? m.scale : 1.0,
            };
        }
        return {
            frame: state.currentFrame,
            selectedModelId: state.selectedModelId,
            keyframes: state.keyframes.map((kf) => ({
                frame: kf.frame,
                camPos: [...kf.camPos],
                target: [...kf.target],
                easing: kf.easing || state.easing || "Linear",
                fov: typeof kf.fov === "number" ? kf.fov : 45,
                objects: kf.objects ? JSON.parse(JSON.stringify(kf.objects)) : null,
            })),
            objects,
        };
    }

    function updateHistoryButtonsUI() {
        const canUndo = undoStack.length > 0 && !state.isRendering;
        const canRedo = redoStack.length > 0 && !state.isRendering;
        undoBtn.disabled = !canUndo;
        redoBtn.disabled = !canRedo;
        undoBtn.style.opacity = canUndo ? "1" : "0.4";
        redoBtn.style.opacity = canRedo ? "1" : "0.4";
    }

    function pushHistoryState() {
        if (isApplyingHistory || state.isRendering) return;
        undoStack.push(captureHistorySnapshot());
        if (undoStack.length > MAX_HISTORY) {
            undoStack.shift();
        }
        redoStack.length = 0;
        updateHistoryButtonsUI();
    }

    function restoreHistorySnapshot(snap) {
        if (!snap) return;
        isApplyingHistory = true;
        try {
            state.keyframes = snap.keyframes.map((kf) => ({
                frame: kf.frame,
                camPos: [...kf.camPos],
                target: [...kf.target],
                easing: kf.easing || state.easing || "Linear",
                fov: typeof kf.fov === "number" ? kf.fov : 45,
                objects: kf.objects ? JSON.parse(JSON.stringify(kf.objects)) : null,
            }));

            if (snap.objects) {
                for (const m of state.models) {
                    const st = snap.objects[m.name];
                    if (!st) continue;
                    m.pos = [...st.pos];
                    m.rotDeg = [...st.rotDeg];
                    m.scale = st.scale;
                    applyModelTransform(m);
                }
            }

            if (snap.selectedModelId && state.models.some((m) => m.id === snap.selectedModelId)) {
                state.selectedModelId = snap.selectedModelId;
            }

            renderMarkers();
            refreshModelUI();
            applyCameraForFrame(Math.max(0, Math.min(state.totalFrames - 1, snap.frame ?? 0)));
            updateCameraPathVisuals();
        } finally {
            isApplyingHistory = false;
            updateHistoryButtonsUI();
        }
    }

    function performUndo() {
        if (undoStack.length === 0 || state.isRendering) return;
        setPlaying(false);
        const currentSnap = captureHistorySnapshot();
        const prevSnap = undoStack.pop();
        redoStack.push(currentSnap);
        restoreHistorySnapshot(prevSnap);
    }

    function performRedo() {
        if (redoStack.length === 0 || state.isRendering) return;
        setPlaying(false);
        const currentSnap = captureHistorySnapshot();
        const nextSnap = redoStack.pop();
        undoStack.push(currentSnap);
        restoreHistorySnapshot(nextSnap);
    }

    undoBtn.onclick = performUndo;
    redoBtn.onclick = performRedo;

    const handleKeyDown = (e) => {
        if (state.isRendering) return;
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = (e.key || "").toLowerCase();
            if (key === "z" && !e.shiftKey) {
                const rect = root.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    e.preventDefault();
                    performUndo();
                }
            } else if (key === "y" || (key === "z" && e.shiftKey)) {
                const rect = root.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    e.preventDefault();
                    performRedo();
                }
            }
        }
    };
    window.addEventListener("keydown", handleKeyDown);

    function snapshotObjectsState() {
        const snap = {};
        for (const m of state.models) {
            if (!m?.name) continue;
            snap[m.name] = {
                pos: Array.isArray(m.pos) ? [...m.pos] : [0, 0, 0],
                rotDeg: Array.isArray(m.rotDeg) ? [...m.rotDeg] : [0, 0, 0],
                scale: typeof m.scale === "number" ? m.scale : 1.0,
            };
        }
        return snap;
    }

    function evaluateObjectsAtFrame(frameIdx, sortedKeyframes, prevKf, nextKf, t) {
        const prevObjs = prevKf?.objects || null;
        const nextObjs = nextKf?.objects || null;
        if (!prevObjs && !nextObjs) return null;

        const allNames = new Set([
            ...Object.keys(prevObjs || {}),
            ...Object.keys(nextObjs || {}),
        ]);
        const result = {};

        for (const name of allNames) {
            const p = prevObjs?.[name];
            const n = nextObjs?.[name];
            if (p && n) {
                const pPos = p.pos || [0, 0, 0];
                const nPos = n.pos || [0, 0, 0];
                const pRot = p.rotDeg || [0, 0, 0];
                const nRot = n.rotDeg || [0, 0, 0];
                const pScale = typeof p.scale === "number" ? p.scale : 1.0;
                const nScale = typeof n.scale === "number" ? n.scale : 1.0;
                result[name] = {
                    pos: [
                        pPos[0] + (nPos[0] - pPos[0]) * t,
                        pPos[1] + (nPos[1] - pPos[1]) * t,
                        pPos[2] + (nPos[2] - pPos[2]) * t,
                    ],
                    rotDeg: [
                        pRot[0] + (nRot[0] - pRot[0]) * t,
                        pRot[1] + (nRot[1] - pRot[1]) * t,
                        pRot[2] + (nRot[2] - pRot[2]) * t,
                    ],
                    scale: pScale + (nScale - pScale) * t,
                };
            } else if (p) {
                result[name] = {
                    pos: Array.isArray(p.pos) ? [...p.pos] : [0, 0, 0],
                    rotDeg: Array.isArray(p.rotDeg) ? [...p.rotDeg] : [0, 0, 0],
                    scale: typeof p.scale === "number" ? p.scale : 1.0,
                };
            } else if (n) {
                result[name] = {
                    pos: Array.isArray(n.pos) ? [...n.pos] : [0, 0, 0],
                    rotDeg: Array.isArray(n.rotDeg) ? [...n.rotDeg] : [0, 0, 0],
                    scale: typeof n.scale === "number" ? n.scale : 1.0,
                };
            }
        }
        return result;
    }

    function applyObjectKeyframesForFrame(frameIdx, prevKf, nextKf, t) {
        const evalObjs = evaluateObjectsAtFrame(frameIdx, null, prevKf, nextKf, t);
        if (!evalObjs) return;

        let selectedChanged = false;
        for (const m of state.models) {
            const st = evalObjs[m.name];
            if (!st) continue;
            m.pos = [...st.pos];
            m.rotDeg = [...st.rotDeg];
            m.scale = st.scale;
            applyModelTransform(m);
            if (m.id === state.selectedModelId) {
                selectedChanged = true;
            }
        }
        if (selectedChanged) {
            const selected = state.models.find((m) => m.id === state.selectedModelId);
            if (selected) syncTransformInputs(selected);
            attachGizmoToSelected();
        }
    }

    function evaluateCameraAtFrame(frameIdx) {
        const clamped = Math.max(0, Math.min(state.totalFrames - 1, frameIdx));
        const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
        if (sorted.length === 0) {
            return {
                camPos: [camera.position.x, camera.position.y, camera.position.z],
                target: [controls.target.x, controls.target.y, controls.target.z],
                segMode: state.easing || "Linear",
            };
        }

        let prev = sorted[0];
        let next = sorted[sorted.length - 1];
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].frame <= clamped) prev = sorted[i];
            if (sorted[i].frame >= clamped) {
                next = sorted[i];
                break;
            }
        }

        const segMode = prev?.easing || state.easing || "Linear";
        const span = Math.max(1, next.frame - prev.frame);
        const rawT = prev.frame === next.frame ? 0 : (clamped - prev.frame) / span;
        const t = applyEasing(rawT, segMode);

        const prevFov = typeof prev.fov === "number" ? prev.fov : (parseFloat(fovSelect.value) || 45);
        const nextFov = typeof next.fov === "number" ? next.fov : (parseFloat(fovSelect.value) || 45);

        return {
            camPos: [
                prev.camPos[0] + (next.camPos[0] - prev.camPos[0]) * t,
                prev.camPos[1] + (next.camPos[1] - prev.camPos[1]) * t,
                prev.camPos[2] + (next.camPos[2] - prev.camPos[2]) * t,
            ],
            target: [
                prev.target[0] + (next.target[0] - prev.target[0]) * t,
                prev.target[1] + (next.target[1] - prev.target[1]) * t,
                prev.target[2] + (next.target[2] - prev.target[2]) * t,
            ],
            fov: prevFov + (nextFov - prevFov) * t,
            prevKf: prev,
            nextKf: next,
            easedT: t,
            segMode,
        };
    }

    function updateCameraPathVisuals() {
        while (pathGuideGroup.children.length > 0) {
            const ch = pathGuideGroup.children[0];
            pathGuideGroup.remove(ch);
            if (ch.geometry && ch.geometry !== kfMarkerGeo && ch.geometry !== targetMarkerGeo) {
                ch.geometry.dispose?.();
            }
        }
        pathLineObj = null;

        if (!state.showPathGuide || state.isRendering || state.keyframes.length === 0) {
            pathGuideGroup.visible = false;
            return;
        }
        pathGuideGroup.visible = true;

        const pts = [];
        const steps = Math.max(2, state.totalFrames);
        for (let f = 0; f < steps; f++) {
            const evalRes = evaluateCameraAtFrame(f);
            pts.push(new THREE.Vector3(...evalRes.camPos));
        }

        if (pts.length >= 2) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
            pathLineObj = new THREE.Line(lineGeo, pathLineMat);
            pathGuideGroup.add(pathLineObj);
        }

        for (const kf of state.keyframes) {
            const camSphere = new THREE.Mesh(kfMarkerGeo, kfMarkerMat);
            camSphere.position.set(...kf.camPos);
            pathGuideGroup.add(camSphere);

            if (kf.target) {
                const tgtMesh = new THREE.Mesh(targetMarkerGeo, targetMarkerMat);
                tgtMesh.position.set(...kf.target);
                pathGuideGroup.add(tgtMesh);

                const sightGeo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(...kf.camPos),
                    new THREE.Vector3(...kf.target),
                ]);
                pathGuideGroup.add(new THREE.Line(sightGeo, targetLineMat));
            }
        }
    }

    let gizmoGestureRecorded = false;
    const rgbGizmo = createRgbGizmo(THREE, camera, renderer.domElement, controls, (obj) => {
        const entry = state.models.find((m) => m.object === obj);
        if (!entry) return;
        if (!gizmoGestureRecorded) {
            pushHistoryState();
            gizmoGestureRecorded = true;
        }
        entry.pos = [obj.position.x, obj.position.y, obj.position.z];
        entry.rotDeg = [
            THREE.MathUtils.radToDeg(obj.rotation.x),
            THREE.MathUtils.radToDeg(obj.rotation.y),
            THREE.MathUtils.radToDeg(obj.rotation.z),
        ];
        entry.scale = obj.scale.x;
        syncTransformInputs(entry);
    });
    scene.add(rgbGizmo.object);

    function updateGizmoModeUI() {
        const isMove = state.gizmoMode === "translate";
        rgbGizmo.setMode(state.gizmoMode);
        moveModeBtn.style.background = isMove ? "#3182ce" : "#2d3748";
        moveModeBtn.style.color = isMove ? "#fff" : "#cbd5e0";
        rotateModeBtn.style.background = !isMove ? "#3182ce" : "#2d3748";
        rotateModeBtn.style.color = !isMove ? "#fff" : "#cbd5e0";
    }

    moveModeBtn.onclick = () => {
        state.gizmoMode = "translate";
        updateGizmoModeUI();
    };

    rotateModeBtn.onclick = () => {
        state.gizmoMode = "rotate";
        updateGizmoModeUI();
    };

    function attachGizmoToSelected() {
        if (state.isRendering) {
            rgbGizmo.detach();
            return;
        }
        const selected = state.models.find((m) => m.id === state.selectedModelId) || null;
        if (selected) {
            rgbGizmo.attach(selected.object);
        } else {
            rgbGizmo.detach();
        }
    }

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    renderer.domElement.addEventListener(
        "pointerdown",
        (e) => {
            pointerDownPos = { x: e.clientX, y: e.clientY };
            gizmoGestureRecorded = false;
            if (state.isRendering) return;
            rgbGizmo.onPointerDown(e);
        },
        true
    );

    renderer.domElement.addEventListener("pointerup", (e) => {
        if (e.button !== 0 || state.isRendering || rgbGizmo.dragging) return;
        const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (moveDist > 4) return;

        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointerNdc, camera);
        const candidates = state.models.map((m) => m.object);
        const hits = raycaster.intersectObjects(candidates, true);

        if (hits.length > 0) {
            let hitObj = hits[0].object;
            while (hitObj) {
                const found = state.models.find((m) => m.object === hitObj);
                if (found) {
                    state.selectedModelId = found.id;
                    refreshModelUI();
                    break;
                }
                hitObj = hitObj.parent;
            }
        }
    });

    const zoomOffset = new THREE.Vector3();
    let isPointerInPreview = false;

    viewportArea.addEventListener("pointerenter", () => {
        isPointerInPreview = true;
    });
    viewportArea.addEventListener("pointerleave", () => {
        isPointerInPreview = false;
    });

    const handleViewportWheel = (e) => {
        if (state.isRendering) return;
        const rect = viewportArea.getBoundingClientRect();
        const inside =
            isPointerInPreview ||
            (e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom);
        if (!inside) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        else if (e.deltaMode === 2) delta *= 120;

        const zoomFactor = Math.pow(0.95, -delta / 100);
        zoomOffset.copy(camera.position).sub(controls.target);
        const currentDist = zoomOffset.length();
        const nextDist = THREE.MathUtils.clamp(
            currentDist * zoomFactor,
            controls.minDistance ?? 0.2,
            controls.maxDistance ?? 200
        );

        if (currentDist > 1e-5) {
            zoomOffset.setLength(nextDist);
            camera.position.copy(controls.target).add(zoomOffset);
            controls.update();
        }
    };

    window.addEventListener("wheel", handleViewportWheel, { passive: false, capture: true });
    viewportArea.addEventListener("wheel", handleViewportWheel, { passive: false, capture: true });
    viewportWrap.addEventListener("wheel", handleViewportWheel, { passive: false, capture: true });
    renderer.domElement.addEventListener("wheel", handleViewportWheel, { passive: false, capture: true });

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.4);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const grid = new THREE.GridHelper(20, 20, 0x3b4252, 0x242933);
    scene.add(grid);

    const sampleMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.4 })
    );
    sampleMesh.position.set(0, 0.5, 0);
    scene.add(sampleMesh);
    state.models.push({
        id: "sample_box",
        name: "SampleCube.glb",
        object: sampleMesh,
        pos: [0, 0.5, 0],
        rotDeg: [0, 0, 0],
        scale: 1,
    });
    state.selectedModelId = "sample_box";

    const getWidget = (name) => node.widgets?.find((w) => w.name === name);

    const hidePayloadWidget = () => {
        const pw = getWidget("frames_payload");
        if (!pw) return;
        pw.computeSize = () => [0, -4];
        pw.type = "hidden";
        if (pw.inputEl) pw.inputEl.style.display = "none";
        if (pw.element) pw.element.style.display = "none";
    };
    hidePayloadWidget();

    function getActiveSegmentEasing(sorted, prev, frameIdx) {
        const segEasing = prev?.easing || state.easing || "Linear";
        const exactKf = sorted.find((k) => k.frame === frameIdx);
        if (exactKf) {
            return exactKf.easing || segEasing;
        }
        return segEasing;
    }

    function updateHud(activeEasing = state.easing) {
        const sec = (state.currentFrame / Math.max(1, state.fps)).toFixed(2);
        const fpsText = Number.isInteger(state.fps) ? state.fps.toFixed(1) : String(state.fps);
        hudInfo.textContent = `${state.width}x${state.height} | Frame: ${state.currentFrame} / ${state.totalFrames - 1} (${sec}s) | ${fpsText} FPS | ${activeEasing}`;
    }

    function syncEasingSelectForFrame(frameIdx) {
        const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
        let prev = sorted[0];
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].frame <= frameIdx) prev = sorted[i];
        }
        const mode = getActiveSegmentEasing(sorted, prev, frameIdx);
        state.easing = mode;
        if (document.activeElement !== easingSelect) {
            easingSelect.value = mode;
        }
        return mode;
    }

    function applyGlbAnimationsForFrame(frameIdx) {
        const safeFps = Math.max(0.1, state.fps || 24);
        const timeSec = frameIdx / safeFps;

        for (const m of state.models) {
            if (!m.mixer || !Array.isArray(m.clips) || m.clips.length === 0) continue;
            if (m.animEnabled === false) continue;

            const clipIdx = Math.max(0, Math.min(m.clips.length - 1, m.selectedClipIndex ?? 0));
            const clip = m.clips[clipIdx];
            if (!clip) continue;

            const duration = Math.max(1e-4, clip.duration || 1);
            const wrappedTime = timeSec % duration;
            m.mixer.setTime(wrappedTime);
        }
    }

    function refreshGlbAnimUI(selected) {
        if (!selected || !Array.isArray(selected.clips) || selected.clips.length === 0) {
            glbAnimBox.style.display = "none";
            return;
        }

        glbAnimBox.style.display = "flex";
        glbAnimCheckbox.checked = selected.animEnabled !== false;

        glbAnimSelect.innerHTML = "";
        selected.clips.forEach((clip, idx) => {
            const opt = document.createElement("option");
            opt.value = String(idx);
            const dur = (clip.duration || 0).toFixed(2);
            opt.textContent = `${clip.name || `Clip ${idx + 1}`} (${dur}s)`;
            if (idx === (selected.selectedClipIndex ?? 0)) opt.selected = true;
            glbAnimSelect.appendChild(opt);
        });
    }

    glbAnimCheckbox.onchange = () => {
        const selected = state.models.find((m) => m.id === state.selectedModelId);
        if (!selected) return;
        selected.animEnabled = glbAnimCheckbox.checked;
        applyGlbAnimationsForFrame(state.currentFrame);
    };

    glbAnimSelect.onchange = () => {
        const selected = state.models.find((m) => m.id === state.selectedModelId);
        if (!selected) return;
        const nextIdx = parseInt(glbAnimSelect.value, 10) || 0;
        selected.selectedClipIndex = nextIdx;
        if (selected.mixer && Array.isArray(selected.actions)) {
            selected.actions.forEach((act, i) => {
                if (i === nextIdx) {
                    act.enabled = true;
                    act.reset();
                    act.play();
                } else {
                    act.stop();
                }
            });
        }
        applyGlbAnimationsForFrame(state.currentFrame);
    };

    function applyCameraForFrame(frameIdx) {
        const clamped = Math.max(0, Math.min(state.totalFrames - 1, frameIdx));
        state.currentFrame = clamped;
        scrubber.value = clamped;

        applyGlbAnimationsForFrame(clamped);

        const activeMode = syncEasingSelectForFrame(clamped);
        if (state.keyframes.length > 0) {
            const evalRes = evaluateCameraAtFrame(clamped);
            applyObjectKeyframesForFrame(clamped, evalRes.prevKf, evalRes.nextKf, evalRes.easedT ?? 0);
            camera.position.set(...evalRes.camPos);
            controls.target.set(...evalRes.target);
            if (typeof evalRes.fov === "number" && Math.abs(camera.fov - evalRes.fov) > 1e-4) {
                camera.fov = evalRes.fov;
                camera.updateProjectionMatrix();
                if (document.activeElement !== fovSelect) {
                    const nearest = [30, 38, 45, 55, 65, 75].reduce((a, b) =>
                        Math.abs(b - Math.round(evalRes.fov)) < Math.abs(a - Math.round(evalRes.fov)) ? b : a
                    );
                    fovSelect.value = String(nearest);
                }
            }
            controls.update();
        }

        updateHud(activeMode);
    }

    easingSelect.onchange = () => {
        const mode = EASING_MODES.includes(easingSelect.value) ? easingSelect.value : "Linear";
        state.easing = mode;

        const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
        const exactKf = sorted.find((k) => k.frame === state.currentFrame);
        if (exactKf) {
            exactKf.easing = mode;
        } else {
            let prev = sorted[0];
            for (let i = 0; i < sorted.length; i++) {
                if (sorted[i].frame <= state.currentFrame) prev = sorted[i];
            }
            if (prev) prev.easing = mode;
        }

        renderMarkers();
        applyCameraForFrame(state.currentFrame);
        updateCameraPathVisuals();
    };

    function renderRuler() {
        rulerLayer.innerHTML = "";
        const maxF = Math.max(1, state.totalFrames - 1);
        const safeFps = Math.max(0.1, state.fps);

        const targetTicks = 7;
        const step = Math.max(1, Math.ceil(maxF / targetTicks));

        const ticks = [];
        for (let f = 0; f <= maxF; f += step) {
            ticks.push(f);
        }
        if (ticks[ticks.length - 1] !== maxF) {
            if (ticks.length > 1 && maxF - ticks[ticks.length - 1] < step * 0.45) {
                ticks[ticks.length - 1] = maxF;
            } else {
                ticks.push(maxF);
            }
        }

        for (let i = 0; i < ticks.length; i++) {
            const f = ticks[i];
            const pct = (f / maxF) * 100;
            const sec = (f / safeFps).toFixed(1);
            const isFirst = i === 0;
            const isLast = i === ticks.length - 1;

            const tickEl = document.createElement("div");
            const xTransform = isFirst ? "0%" : isLast ? "-100%" : "-50%";
            const alignItems = isFirst ? "flex-start" : isLast ? "flex-end" : "center";

            tickEl.style.cssText = `
                position: absolute;
                left: ${pct}%;
                bottom: 0;
                transform: translateX(${xTransform});
                display: flex;
                flex-direction: column;
                align-items: ${alignItems};
                line-height: 1.05;
            `;

            const lblEl = document.createElement("span");
            lblEl.textContent = `${f}f (${sec}s)`;
            lblEl.style.cssText = `
                color: ${f === state.currentFrame ? "#90cdf4" : "#8892a6"};
                font-weight: ${f === state.currentFrame ? "bold" : "normal"};
                white-space: nowrap;
            `;

            const lineEl = document.createElement("div");
            lineEl.style.cssText = `
                width: 1px;
                height: 4px;
                background: #4a5568;
                margin-top: 1px;
            `;

            tickEl.appendChild(lblEl);
            tickEl.appendChild(lineEl);
            rulerLayer.appendChild(tickEl);
        }
    }

    function renderMarkers() {
        markersLayer.innerHTML = "";
        const maxF = Math.max(1, state.totalFrames - 1);
        for (const kf of state.keyframes) {
            const pct = (kf.frame / maxF) * 100;
            const kfEase = kf.easing || state.easing || "Linear";
            const dot = document.createElement("div");
            dot.title = `Keyframe @ Frame ${kf.frame} (${kfEase}) — Drag left/right to move`;
            dot.style.cssText = `
                position: absolute;
                left: ${pct}%;
                top: 1px;
                transform: translateX(-50%) rotate(45deg);
                width: 8px;
                height: 8px;
                background: ${kf.frame === state.currentFrame ? "#63b3ed" : "#f6e05e"};
                border: 1px solid #111;
                border-radius: 1px;
                cursor: ew-resize;
                pointer-events: auto;
            `;

            dot.onmousedown = (e) => {
                if (e.button !== 0 || state.isRendering) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                setPlaying(false);
                const startX = e.clientX;
                const origFrame = kf.frame;
                let hasMoved = false;
                let dragHistoryPushed = false;
                dot.style.background = "#63b3ed";
                document.body.style.cursor = "ew-resize";

                const computeFrameFromClientX = (clientX) => {
                    const rect = markersLayer.getBoundingClientRect();
                    const w = Math.max(1, rect.width);
                    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / w));
                    return Math.round(ratio * maxF);
                };

                const onMouseMove = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    if (!hasMoved && Math.abs(ev.clientX - startX) >= 3) {
                        hasMoved = true;
                    }
                    if (!hasMoved) return;
                    if (!dragHistoryPushed) {
                        pushHistoryState();
                        dragHistoryPushed = true;
                    }

                    let nextFrame = computeFrameFromClientX(ev.clientX);
                    const occupiedByOther = state.keyframes.some(
                        (other) => other !== kf && other.frame === nextFrame
                    );
                    if (occupiedByOther) {
                        let resolved = null;
                        for (let offset = 1; offset <= maxF; offset++) {
                            const candUp = nextFrame + offset;
                            if (
                                candUp <= maxF &&
                                !state.keyframes.some((other) => other !== kf && other.frame === candUp)
                            ) {
                                resolved = candUp;
                                break;
                            }
                            const candDown = nextFrame - offset;
                            if (
                                candDown >= 0 &&
                                !state.keyframes.some((other) => other !== kf && other.frame === candDown)
                            ) {
                                resolved = candDown;
                                break;
                            }
                        }
                        nextFrame = resolved !== null ? resolved : origFrame;
                    }

                    kf.frame = nextFrame;
                    const newPct = (kf.frame / maxF) * 100;
                    dot.style.left = `${newPct}%`;
                    dot.title = `Keyframe @ Frame ${kf.frame} (${kfEase}) — Drag left/right to move`;
                    applyCameraForFrame(kf.frame);
                    renderRuler();
                    updateCameraPathVisuals();
                };

                const onMouseUp = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    document.body.style.cursor = "";
                    window.removeEventListener("mousemove", onMouseMove, true);
                    window.removeEventListener("mouseup", onMouseUp, true);

                    if (!hasMoved) {
                        applyCameraForFrame(kf.frame);
                        renderMarkers();
                    } else {
                        state.keyframes.sort((a, b) => a.frame - b.frame);
                        renderMarkers();
                        applyCameraForFrame(kf.frame);
                        updateCameraPathVisuals();
                    }
                };

                window.addEventListener("mousemove", onMouseMove, true);
                window.addEventListener("mouseup", onMouseUp, true);
            };

            markersLayer.appendChild(dot);
        }
        kfCountLabel.textContent = `KFs: ${state.keyframes.length}`;
        renderRuler();
    }

    function setPlaying(play) {
        state.isPlaying = play;
        previewBtn.textContent = play ? "❚❚ Stop" : "▶ Preview";
        previewBtn.style.background = play ? "#c05621" : "#3182ce";
    }

    function resizeViewport() {
        const availW = Math.max(80, (viewportArea.clientWidth || 300) - 16);
        const availH = Math.max(80, (viewportArea.clientHeight || 250) - 16);
        const aspect = Math.max(0.05, state.width / Math.max(1, state.height));

        let boxW = availW;
        let boxH = boxW / aspect;
        if (boxH > availH) {
            boxH = availH;
            boxW = boxH * aspect;
        }

        boxW = Math.max(40, Math.floor(boxW));
        boxH = Math.max(40, Math.floor(boxH));

        viewportWrap.style.width = `${boxW}px`;
        viewportWrap.style.height = `${boxH}px`;

        renderer.setSize(boxW, boxH, false);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        updateHud();
    }

    function syncFromNodeWidgets() {
        const wWidget = getWidget("width");
        const hWidget = getWidget("height");
        const nextW = Math.max(64, parseInt(wWidget?.value ?? state.width, 10) || 512);
        const nextH = Math.max(64, parseInt(hWidget?.value ?? state.height, 10) || 512);
        const sizeChanged = nextW !== state.width || nextH !== state.height;
        if (sizeChanged) {
            state.width = nextW;
            state.height = nextH;
            resizeViewport();
        }

        let needsRulerRefresh = false;

        const tfWidget = getWidget("total_frames");
        const nextTotal = Math.max(2, parseInt(tfWidget?.value ?? state.totalFrames, 10) || 24);
        if (nextTotal !== state.totalFrames) {
            state.totalFrames = nextTotal;
            scrubber.max = state.totalFrames - 1;
            applyCameraForFrame(Math.min(state.currentFrame, state.totalFrames - 1));
            needsRulerRefresh = true;
            updateCameraPathVisuals();
        }

        const fpsWidget = getWidget("fps");
        const parsedFps = parseFloat(fpsWidget?.value ?? state.fps);
        const widgetFps = Number.isFinite(parsedFps) ? Math.max(0.1, Math.min(240.0, parsedFps)) : 24.0;
        if (Math.abs(widgetFps - state.fps) > 1e-6) {
            state.fps = widgetFps;
            updateHud();
            needsRulerRefresh = true;
        }

        if (needsRulerRefresh) {
            renderMarkers();
        }
    }

    previewBtn.onclick = () => {
        if (state.isRendering) return;
        syncFromNodeWidgets();
        setPlaying(!state.isPlaying);
    };

    function syncTransformInputs(selected) {
        const hasSelection = Boolean(selected);
        deleteModelBtn.disabled = !hasSelection;
        deleteModelBtn.style.opacity = hasSelection ? "1" : "0.45";
        resetTransformBtn.disabled = !hasSelection;
        resetTransformBtn.style.opacity = hasSelection ? "1" : "0.45";

        const allInputs = [posXInput, posYInput, posZInput, rotXInput, rotYInput, rotZInput, scaleInput];
        for (const item of allInputs) {
            item.setDisabled(!hasSelection);
        }

        if (selected) {
            if (document.activeElement !== posXInput.inp) posXInput.inp.value = roundToStep(selected.pos[0], 0.1).toFixed(1);
            if (document.activeElement !== posYInput.inp) posYInput.inp.value = roundToStep(selected.pos[1], 0.1).toFixed(1);
            if (document.activeElement !== posZInput.inp) posZInput.inp.value = roundToStep(selected.pos[2], 0.1).toFixed(1);
            if (document.activeElement !== rotXInput.inp) rotXInput.inp.value = roundToStep(selected.rotDeg[0], 1).toFixed(0);
            if (document.activeElement !== rotYInput.inp) rotYInput.inp.value = roundToStep(selected.rotDeg[1], 1).toFixed(0);
            if (document.activeElement !== rotZInput.inp) rotZInput.inp.value = roundToStep(selected.rotDeg[2], 1).toFixed(0);
            if (document.activeElement !== scaleInput.inp) scaleInput.inp.value = roundToStep(selected.scale, 0.1).toFixed(1);
        } else {
            for (const item of allInputs) {
                item.inp.value = "";
            }
        }
    }

    function refreshModelUI() {
        modelListEl.innerHTML = "";
        const selected = state.models.find((m) => m.id === state.selectedModelId) || null;

        for (const m of state.models) {
            const item = document.createElement("div");
            const isSel = m.id === state.selectedModelId;
            item.textContent = m.name;
            item.style.cssText = `
                padding: 4px 6px;
                border-radius: 3px;
                cursor: pointer;
                background: ${isSel ? "#2b6cb0" : "#1e222b"};
                color: ${isSel ? "#fff" : "#cbd5e0"};
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: 11px;
                flex-shrink: 0;
            `;
            item.onclick = () => {
                state.selectedModelId = m.id;
                refreshModelUI();
            };
            modelListEl.appendChild(item);
        }

        refreshGlbAnimUI(selected);
        syncTransformInputs(selected);
        attachGizmoToSelected();
    }

    deleteModelBtn.onclick = () => {
        if (!state.selectedModelId) return;
        const idx = state.models.findIndex((m) => m.id === state.selectedModelId);
        if (idx === -1) return;

        const [removed] = state.models.splice(idx, 1);
        rgbGizmo.detach();
        removed.mixer?.stopAllAction?.();
        scene.remove(removed.object);
        disposeObject3D(removed.object);

        state.selectedModelId = state.models[idx]?.id ?? state.models[idx - 1]?.id ?? null;
        refreshModelUI();
    };

    function applyModelTransform(modelEntry) {
        modelEntry.object.position.set(modelEntry.pos[0], modelEntry.pos[1], modelEntry.pos[2]);
        modelEntry.object.rotation.set(
            THREE.MathUtils.degToRad(modelEntry.rotDeg[0]),
            THREE.MathUtils.degToRad(modelEntry.rotDeg[1]),
            THREE.MathUtils.degToRad(modelEntry.rotDeg[2])
        );
        modelEntry.object.scale.setScalar(modelEntry.scale);
    }

    function updateSelectedModel(axis, val) {
        const selected = state.models.find((m) => m.id === state.selectedModelId);
        if (!selected) return;
        pushHistoryState();

        if (axis === "x") selected.pos[0] = roundToStep(val, 0.1);
        if (axis === "y") selected.pos[1] = roundToStep(val, 0.1);
        if (axis === "z") selected.pos[2] = roundToStep(val, 0.1);
        if (axis === "rx") selected.rotDeg[0] = roundToStep(val, 0.1);
        if (axis === "ry") selected.rotDeg[1] = roundToStep(val, 0.1);
        if (axis === "rz") selected.rotDeg[2] = roundToStep(val, 0.1);
        if (axis === "scale") selected.scale = Math.max(0.1, roundToStep(val, 0.1));

        applyModelTransform(selected);
        syncTransformInputs(selected);
        attachGizmoToSelected();
    }

    resetTransformBtn.onclick = () => {
        const selected = state.models.find((m) => m.id === state.selectedModelId);
        if (!selected) return;
        pushHistoryState();
        selected.pos = [0, 0, 0];
        selected.rotDeg = [0, 0, 0];
        selected.scale = 1.0;
        applyModelTransform(selected);
        syncTransformInputs(selected);
        attachGizmoToSelected();
    };

    const shapeCounters = { box: 0, sphere: 0, cylinder: 0, plane: 0, cone: 0 };

    function buildShapeMesh(shapeType) {
        let geo;
        let defaultPos = [0, 0.5, 0];
        let defaultRot = [0, 0, 0];

        if (shapeType === "sphere") {
            geo = new THREE.SphereGeometry(0.55, 24, 16);
            defaultPos = [0, 0.55, 0];
        } else if (shapeType === "cylinder") {
            geo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 24);
            defaultPos = [0, 0.5, 0];
        } else if (shapeType === "plane") {
            geo = new THREE.PlaneGeometry(2.0, 2.0);
            geo.rotateX(-Math.PI / 2);
            defaultPos = [0, 0.01, 0];
        } else if (shapeType === "cone") {
            geo = new THREE.ConeGeometry(0.55, 1.1, 24);
            defaultPos = [0, 0.55, 0];
        } else {
            geo = new THREE.BoxGeometry(1, 1, 1);
            defaultPos = [0, 0.5, 0];
        }

        const mat = new THREE.MeshStandardMaterial({
            color: 0x718096,
            roughness: 0.55,
            metalness: 0.05,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        return { mesh, defaultPos, defaultRot };
    }

    function addBasicShape(shapeType, customName = null, customPos = null, customRot = null, customScale = null) {
        const normalized = SHAPE_OPTIONS.some((o) => o.value === shapeType) ? shapeType : "box";
        shapeCounters[normalized] = (shapeCounters[normalized] || 0) + 1;
        const labelBase = normalized.charAt(0).toUpperCase() + normalized.slice(1);
        const name = customName || `${labelBase}_${shapeCounters[normalized]}`;

        const { mesh, defaultPos, defaultRot } = buildShapeMesh(normalized);
        const pos = Array.isArray(customPos) && customPos.length === 3 ? customPos.map(Number) : [...defaultPos];
        const rotDeg = Array.isArray(customRot) && customRot.length === 3 ? customRot.map(Number) : [...defaultRot];
        const scale = typeof customScale === "number" && Number.isFinite(customScale) ? Math.max(0.1, customScale) : 1.0;

        const id = `shape_${normalized}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const entry = {
            id,
            name,
            shapeType: normalized,
            object: mesh,
            pos,
            rotDeg,
            scale,
        };
        applyModelTransform(entry);
        scene.add(mesh);
        state.models.push(entry);
        state.selectedModelId = id;
        refreshModelUI();
        return entry;
    }

    const loader = new GLTFLoader();
    fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const url = URL.createObjectURL(file);
            loader.load(
                url,
                (gltf) => {
                    const obj = gltf.scene;
                    scene.add(obj);
                    const clips = Array.isArray(gltf.animations) ? gltf.animations : [];
                    let mixer = null;
                    let actions = [];
                    if (clips.length > 0) {
                        mixer = new THREE.AnimationMixer(obj);
                        actions = clips.map((clip) => {
                            const act = mixer.clipAction(clip);
                            act.setLoop(THREE.LoopRepeat, Infinity);
                            return act;
                        });
                        actions[0]?.play?.();
                    }
                    const id = `glb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    state.models.push({
                        id,
                        name: file.name,
                        object: obj,
                        pos: [0, 0, 0],
                        rotDeg: [0, 0, 0],
                        scale: 1,
                        mixer,
                        clips,
                        actions,
                        selectedClipIndex: 0,
                        animEnabled: true,
                    });
                    state.selectedModelId = id;
                    refreshModelUI();
                    applyGlbAnimationsForFrame(state.currentFrame);
                    URL.revokeObjectURL(url);
                },
                undefined,
                (err) => {
                    console.error("[3D Camera Motion Studio] GLB load failed:", err);
                    URL.revokeObjectURL(url);
                }
            );
        }
        fileInput.value = "";
    };

    savePresetBtn.onclick = () => {
        const presetData = {
            version: 1,
            width: state.width,
            height: state.height,
            totalFrames: state.totalFrames,
            fps: state.fps,
            easing: state.easing,
            exportRenderMode: state.exportRenderMode,
            exportGrid: state.exportGrid,
            showPathGuide: state.showPathGuide,
            keyframes: state.keyframes.map((kf) => ({
                frame: kf.frame,
                camPos: [...kf.camPos],
                target: [...kf.target],
                easing: kf.easing || state.easing || "Linear",
                fov: typeof kf.fov === "number" ? kf.fov : 45,
                objects: kf.objects ? JSON.parse(JSON.stringify(kf.objects)) : null,
            })),
            models: state.models.map((m) => ({
                name: m.name,
                shapeType: m.shapeType || null,
                pos: [...m.pos],
                rotDeg: [...m.rotDeg],
                scale: m.scale,
            })),
        };
        const blob = new Blob([JSON.stringify(presetData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `camera_studio_preset_${Date.now()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    presetFileInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const wWidget = getWidget("width");
            const hWidget = getWidget("height");
            const tfWidget = getWidget("total_frames");
            const fpsWidget = getWidget("fps");

            if (typeof data.width === "number" && wWidget) wWidget.value = data.width;
            if (typeof data.height === "number" && hWidget) hWidget.value = data.height;
            if (typeof data.totalFrames === "number" && tfWidget) tfWidget.value = data.totalFrames;
            if (typeof data.fps === "number" && fpsWidget) fpsWidget.value = data.fps;

            if (typeof data.exportGrid === "boolean") {
                state.exportGrid = data.exportGrid;
                gridCheckbox.checked = state.exportGrid;
            }
            if (typeof data.showPathGuide === "boolean") {
                state.showPathGuide = data.showPathGuide;
                pathCheckbox.checked = state.showPathGuide;
            }
            if (typeof data.easing === "string" && EASING_MODES.includes(data.easing)) {
                state.easing = data.easing;
                easingSelect.value = state.easing;
            }
            if (typeof data.exportRenderMode === "string" && RENDER_MODES.includes(data.exportRenderMode)) {
                state.exportRenderMode = data.exportRenderMode;
                outModeSelect.value = state.exportRenderMode;
            }

            if (Array.isArray(data.keyframes) && data.keyframes.length > 0) {
                state.keyframes = data.keyframes.map((kf) => ({
                    frame: Math.max(0, parseInt(kf.frame, 10) || 0),
                    camPos: Array.isArray(kf.camPos) && kf.camPos.length === 3 ? kf.camPos.map(Number) : [4, 3, 4],
                    target: Array.isArray(kf.target) && kf.target.length === 3 ? kf.target.map(Number) : [0, 0.5, 0],
                    easing: EASING_MODES.includes(kf.easing) ? kf.easing : state.easing,
                    fov: typeof kf.fov === "number" && Number.isFinite(kf.fov) ? kf.fov : 45,
                    objects: kf.objects && typeof kf.objects === "object" ? JSON.parse(JSON.stringify(kf.objects)) : null,
                }));
            }

            if (Array.isArray(data.models)) {
                for (const savedM of data.models) {
                    let match = state.models.find((m) => m.name === savedM.name);
                    if (!match && savedM.shapeType && SHAPE_OPTIONS.some((o) => o.value === savedM.shapeType)) {
                        match = addBasicShape(
                            savedM.shapeType,
                            savedM.name,
                            savedM.pos,
                            savedM.rotDeg,
                            savedM.scale
                        );
                    }
                    if (match) {
                        if (Array.isArray(savedM.pos) && savedM.pos.length === 3) {
                            match.pos = savedM.pos.map((v) => roundToStep(Number(v) || 0, 0.1));
                        }
                        if (Array.isArray(savedM.rotDeg) && savedM.rotDeg.length === 3) {
                            match.rotDeg = savedM.rotDeg.map((v) => roundToStep(Number(v) || 0, 0.1));
                        } else if (match.object?.rotation) {
                            match.rotDeg = [
                                roundToStep(THREE.MathUtils.radToDeg(match.object.rotation.x), 0.1),
                                roundToStep(THREE.MathUtils.radToDeg(match.object.rotation.y), 0.1),
                                roundToStep(THREE.MathUtils.radToDeg(match.object.rotation.z), 0.1),
                            ];
                        }
                        if (typeof savedM.scale === "number") {
                            match.scale = Math.max(0.1, roundToStep(savedM.scale, 0.1));
                        }
                        applyModelTransform(match);
                    }
                }
            }

            syncFromNodeWidgets();
            renderMarkers();
            refreshModelUI();
            applyCameraForFrame(0);
            updateCameraPathVisuals();
        } catch (err) {
            console.error("[3D Camera Motion Studio] Preset load failed:", err);
        }
        presetFileInput.value = "";
    };

    fovSelect.onchange = () => {
        const nextFov = THREE.MathUtils.clamp(parseFloat(fovSelect.value) || 45, 15, 120);
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
        const exactKf = state.keyframes.find((k) => k.frame === state.currentFrame);
        if (exactKf) {
            exactKf.fov = nextFov;
        }
    };

    prevKfBtn.onclick = () => {
        if (state.keyframes.length === 0) return;
        setPlaying(false);
        const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
        const prevList = sorted.filter((k) => k.frame < state.currentFrame);
        const targetKf = prevList.length > 0 ? prevList[prevList.length - 1] : sorted[sorted.length - 1];
        applyCameraForFrame(targetKf.frame);
        renderRuler();
    };

    nextKfBtn.onclick = () => {
        if (state.keyframes.length === 0) return;
        setPlaying(false);
        const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
        const nextList = sorted.filter((k) => k.frame > state.currentFrame);
        const targetKf = nextList.length > 0 ? nextList[0] : sorted[0];
        applyCameraForFrame(targetKf.frame);
        renderRuler();
    };

    resetTargetBtn.onclick = () => {
        setPlaying(false);
        const selected = state.models.find((m) => m.id === state.selectedModelId);
        if (selected?.object) {
            controls.target.copy(selected.object.position);
        } else {
            controls.target.set(0, 0.5, 0);
        }
        controls.update();
    };

    addKfBtn.onclick = () => {
        pushHistoryState();
        const f = state.currentFrame;
        const camPos = [camera.position.x, camera.position.y, camera.position.z];
        const target = [controls.target.x, controls.target.y, controls.target.z];
        const easing = state.easing || "Ease In-Out";
        const fov = camera.fov || 45;
        const objects = snapshotObjectsState();

        const existingIdx = state.keyframes.findIndex((k) => k.frame === f);
        if (existingIdx >= 0) {
            state.keyframes[existingIdx] = { frame: f, camPos, target, easing, fov, objects };
        } else {
            state.keyframes.push({ frame: f, camPos, target, easing, fov, objects });
        }
        renderMarkers();
        applyCameraForFrame(f);
        updateCameraPathVisuals();
    };

    updateKfBtn.onclick = () => {
        pushHistoryState();
        const f = state.currentFrame;
        const camPos = [camera.position.x, camera.position.y, camera.position.z];
        const target = [controls.target.x, controls.target.y, controls.target.z];
        const easing = state.easing || "Ease In-Out";
        const fov = camera.fov || 45;
        const objects = snapshotObjectsState();

        const existingIdx = state.keyframes.findIndex((k) => k.frame === f);
        if (existingIdx >= 0) {
            state.keyframes[existingIdx] = { frame: f, camPos, target, easing, fov, objects };
        } else {
            const sorted = [...state.keyframes].sort((a, b) => a.frame - b.frame);
            let nearestIdx = 0;
            let bestDist = Infinity;
            sorted.forEach((k, idx) => {
                const d = Math.abs(k.frame - f);
                if (d < bestDist) {
                    bestDist = d;
                    nearestIdx = idx;
                }
            });
            const targetFrame = sorted[nearestIdx]?.frame ?? f;
            const realIdx = state.keyframes.findIndex((k) => k.frame === targetFrame);
            if (realIdx >= 0) {
                state.keyframes[realIdx] = { frame: targetFrame, camPos, target, easing, fov, objects };
                applyCameraForFrame(targetFrame);
            }
        }
        renderMarkers();
        updateCameraPathVisuals();
    };

    delKfBtn.onclick = () => {
        if (state.keyframes.length <= 1) return;
        pushHistoryState();
        state.keyframes = state.keyframes.filter((k) => k.frame !== state.currentFrame);
        renderMarkers();
        applyCameraForFrame(state.currentFrame);
        updateCameraPathVisuals();
    };

    resetKfBtn.onclick = () => {
        setPlaying(false);
        pushHistoryState();
        state.keyframes = createDefaultKeyframes();
        renderMarkers();
        applyCameraForFrame(0);
        updateCameraPathVisuals();
    };

    scrubber.oninput = () => {
        setPlaying(false);
        applyCameraForFrame(parseInt(scrubber.value, 10));
        renderRuler();
    };

    async function uploadBatchToTemp(payloadObj) {
        const fname = `studio_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`;
        const blob = new Blob([JSON.stringify(payloadObj)], { type: "application/json" });
        const formData = new FormData();
        formData.append("image", blob, fname);
        formData.append("type", "temp");
        formData.append("subfolder", "camera_3d_studio");

        const res = await api.fetchApi("/upload/image", {
            method: "POST",
            body: formData,
        });
        if (!res.ok) {
            throw new Error(`Temp batch upload failed: ${res.status}`);
        }
        const info = await res.json();
        const savedName = info?.name || fname;
        const savedSub = info?.subfolder ? `${info.subfolder}/${savedName}` : savedName;
        return `studio_batch:${savedSub}`;
    }

    function setPayloadValue(payloadWidget, pointerOrJson) {
        if (!payloadWidget) return;
        payloadWidget.value = pointerOrJson;
        if (payloadWidget.inputEl) {
            payloadWidget.inputEl.value = pointerOrJson;
            payloadWidget.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    exportBtn.onclick = async () => {
        if (state.isRendering) return;
        setPlaying(false);
        state.isRendering = true;
        exportBtn.textContent = "Rendering...";
        exportBtn.disabled = true;

        try {
            syncFromNodeWidgets();

            const payloadWidget = getWidget("frames_payload");
            const outW = state.width;
            const outH = state.height;

            const savedFrame = state.currentFrame;
            const savedPixelRatio = renderer.getPixelRatio();
            const savedGridVisible = grid.visible;
            const savedGizmoVisible = rgbGizmo.visible;
            const savedPathVisible = pathGuideGroup.visible;

            rgbGizmo.visible = false;
            pathGuideGroup.visible = false;
            renderer.setPixelRatio(1);
            renderer.setSize(outW, outH, false);
            renderer.setClearColor(0x12151c, 1.0);

            const savedAspect = camera.aspect;
            camera.aspect = outW / Math.max(1, outH);
            camera.updateProjectionMatrix();

            grid.visible = Boolean(state.exportGrid);

            const renderMode = state.exportRenderMode || "Standard";
            const savedMaterials = [];
            const depthMat = new THREE.MeshDepthMaterial({
                depthPacking: THREE.BasicDepthPacking,
            });
            const normalMat = new THREE.MeshNormalMaterial({
                side: THREE.DoubleSide,
            });

            if (renderMode !== "Standard") {
                scene.traverse((obj) => {
                    if (!obj.isMesh || obj === rgbGizmo.object || pathGuideGroup.getObjectById(obj.id)) return;
                    savedMaterials.push({
                        mesh: obj,
                        material: obj.material,
                        wireframeFlags: Array.isArray(obj.material)
                            ? obj.material.map((m) => Boolean(m?.wireframe))
                            : [Boolean(obj.material?.wireframe)],
                    });
                    if (renderMode === "Wireframe") {
                        if (Array.isArray(obj.material)) {
                            obj.material.forEach((m) => {
                                if (m && "wireframe" in m) m.wireframe = true;
                            });
                        } else if (obj.material && "wireframe" in obj.material) {
                            obj.material.wireframe = true;
                        }
                    } else if (renderMode === "Depth") {
                        obj.material = depthMat;
                    } else if (renderMode === "Normal") {
                        obj.material = normalMat;
                    }
                });
            }

            const framesData = [];
            try {
                for (let f = 0; f < state.totalFrames; f++) {
                    applyCameraForFrame(f);
                    renderer.render(scene, camera);
                    framesData.push(renderer.domElement.toDataURL("image/png"));
                    await new Promise((r) => setTimeout(r, 12));
                }
            } finally {
                for (const item of savedMaterials) {
                    item.mesh.material = item.material;
                    if (renderMode === "Wireframe") {
                        if (Array.isArray(item.mesh.material)) {
                            item.mesh.material.forEach((m, idx) => {
                                if (m && "wireframe" in m) m.wireframe = Boolean(item.wireframeFlags[idx]);
                            });
                        } else if (item.mesh.material && "wireframe" in item.mesh.material) {
                            item.mesh.material.wireframe = Boolean(item.wireframeFlags[0]);
                        }
                    }
                }
                depthMat.dispose();
                normalMat.dispose();
            }

            grid.visible = savedGridVisible;
            renderer.setPixelRatio(savedPixelRatio);
            camera.aspect = savedAspect;
            camera.updateProjectionMatrix();
            resizeViewport();
            applyCameraForFrame(savedFrame);
            rgbGizmo.visible = savedGizmoVisible;
            pathGuideGroup.visible = savedPathVisible;

            exportBtn.textContent = "Queueing...";

            const batchObj = {
                width: outW,
                height: outH,
                fps: state.fps,
                easing: state.easing,
                grid: state.exportGrid,
                frames: framesData,
            };

            let widgetVal = "";
            try {
                widgetVal = await uploadBatchToTemp(batchObj);
            } catch (uploadErr) {
                console.warn("[3D Camera Motion Studio] Fallback to inline payload:", uploadErr);
                widgetVal = JSON.stringify(batchObj);
            }

            setPayloadValue(payloadWidget, widgetVal);

            if (typeof app.queuePrompt === "function") {
                await app.queuePrompt(0, 1);
            }
        } finally {
            state.isRendering = false;
            exportBtn.textContent = "Export Images";
            exportBtn.disabled = false;
            attachGizmoToSelected();
            updateCameraPathVisuals();
        }
    };

    const resizeObserver = new ResizeObserver(() => {
        syncFromNodeWidgets();
        resizeViewport();
    });
    resizeObserver.observe(root);

    const syncTimer = window.setInterval(() => {
        if (!state.isRendering) {
            syncFromNodeWidgets();
        }
    }, 150);

    updateHistoryButtonsUI();
    updateGizmoModeUI();
    refreshModelUI();
    renderMarkers();
    applyCameraForFrame(0);
    resizeViewport();
    updateCameraPathVisuals();

    let rafId = 0;
    let lastTime = performance.now();
    let frameAccumulator = 0;

    const animate = (now) => {
        rafId = requestAnimationFrame(animate);
        const dt = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        if (state.isPlaying && !state.isRendering) {
            frameAccumulator += dt * state.fps;
            const stepFrames = Math.floor(frameAccumulator);
            if (stepFrames >= 1) {
                frameAccumulator -= stepFrames;
                const nextFrame = (state.currentFrame + stepFrames) % state.totalFrames;
                applyCameraForFrame(nextFrame);
                renderRuler();
            }
        } else {
            frameAccumulator = 0;
        }

        controls.update();
        rgbGizmo.update();
        renderer.render(scene, camera);
    };
    rafId = requestAnimationFrame(animate);

    const prevOnRemoved = node.onRemoved;
    node.onRemoved = function () {
        window.clearInterval(syncTimer);
        cancelAnimationFrame(rafId);
        window.removeEventListener("keydown", handleKeyDown);
        resizeObserver.disconnect();
        window.removeEventListener("wheel", handleViewportWheel, { capture: true });
        viewportArea.removeEventListener("wheel", handleViewportWheel, { capture: true });
        viewportWrap.removeEventListener("wheel", handleViewportWheel, { capture: true });
        renderer.domElement.removeEventListener("wheel", handleViewportWheel, { capture: true });
        rgbGizmo.dispose();
        kfMarkerGeo.dispose();
        kfMarkerMat.dispose();
        targetMarkerGeo.dispose();
        targetMarkerMat.dispose();
        pathLineMat.dispose();
        targetLineMat.dispose();
        for (const m of state.models) {
            m.mixer?.stopAllAction?.();
            disposeObject3D(m.object);
        }
        renderer.dispose();
        return prevOnRemoved?.apply(this, arguments);
    };

    const domWidget = node.addDOMWidget("3D Camera Motion Studio", "div", root, {
        serialize: false,
        hideOnZoom: false,
    });
    // Fixed constant height (no dependency on node.size) so LiteGraph never loops
    // while giving Nodes 1.0 a bit more vertical room by default.
    domWidget.computeSize = (width) => {
        const w = typeof width === "number" && width > 0 ? width : 640;
        return [w, 475];
    };
    return domWidget;
}

app.registerExtension({
    name: "ComfyUI.3D.Camera.Studio",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "Camera3DStudioNode") return;

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const res = origOnNodeCreated?.apply(this, arguments);
            const nodeRef = this;

            let isApplying = false;
            let isDraggingResize = false;
            let lastAppliedKey = "";

            const getClampedSize = (rawSize) => {
                if (!Array.isArray(rawSize) || rawSize.length < 2) return null;
                const w = Number(rawSize[0]);
                const h = Number(rawSize[1]);
                if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
                // Clamp to sane bounds so an accidental drag or DOM measurement can never grow infinitely
                const cw = Math.max(480, Math.min(1800, Math.round(w)));
                const ch = Math.max(520, Math.min(1600, Math.round(h)));
                return [cw, ch];
            };

            const applySizeOnce = (target) => {
                const clamped = getClampedSize(target);
                if (!clamped) return;
                const [sw, sh] = clamped;
                const key = `${sw}x${sh}`;
                const curW = Math.round(nodeRef.size?.[0] || 0);
                const curH = Math.round(nodeRef.size?.[1] || 0);

                if (lastAppliedKey === key && Math.abs(curW - sw) <= 2 && Math.abs(curH - sh) <= 2) {
                    return;
                }
                if (Math.abs(curW - sw) <= 2 && Math.abs(curH - sh) <= 2) {
                    lastAppliedKey = key;
                    return;
                }

                isApplying = true;
                lastAppliedKey = key;
                try {
                    if (Array.isArray(nodeRef.size)) {
                        nodeRef.size[0] = sw;
                        nodeRef.size[1] = sh;
                    }
                    nodeRef.setSize?.([sw, sh]);
                    nodeRef.setDirtyCanvas?.(true, true);
                } finally {
                    window.setTimeout(() => {
                        isApplying = false;
                    }, 80);
                }
            };

            const restoreSaved = () => {
                const saved = loadSavedWindowSize();
                if (saved) {
                    applySizeOnce(saved);
                }
            };

            // Initial size on creation (saved if present, else default)
            const initialSaved = loadSavedWindowSize();
            applySizeOnce(initialSaved || DEFAULT_WINDOW_SIZE);

            // Hook onConfigure synchronously before async Three.js load
            const origOnConfigure = nodeRef.onConfigure;
            nodeRef.onConfigure = function (info) {
                const r = origOnConfigure?.apply(this, arguments);
                const saved = loadSavedWindowSize();
                if (saved) {
                    if (info && Array.isArray(info.size)) {
                        info.size[0] = saved[0];
                        info.size[1] = saved[1];
                    }
                    lastAppliedKey = "";
                    applySizeOnce(saved);
                    window.setTimeout(() => restoreSaved(), 120);
                }
                return r;
            };

            // Track manual resize gesture cleanly (no interval polling that fights user drag!)
            const onDown = (e) => {
                if (e.button === 0 || e.button === undefined) {
                    isDraggingResize = true;
                }
            };

            const onUp = () => {
                if (!isDraggingResize) return;
                isDraggingResize = false;
                if (!isApplying && Array.isArray(nodeRef.size) && nodeRef.size.length >= 2) {
                    const clamped = getClampedSize(nodeRef.size);
                    if (clamped) {
                        saveWindowSize(clamped);
                        lastAppliedKey = `${clamped[0]}x${clamped[1]}`;
                    }
                }
            };

            window.addEventListener("pointerdown", onDown, true);
            window.addEventListener("mousedown", onDown, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("mouseup", onUp, true);

            const origOnResize = nodeRef.onResize;
            nodeRef.onResize = function (size) {
                const r = origOnResize?.apply(this, arguments);
                if (isDraggingResize && !isApplying) {
                    const candidate = Array.isArray(size) && size.length >= 2 ? size : this.size;
                    const clamped = getClampedSize(candidate);
                    if (clamped) {
                        saveWindowSize(clamped);
                        lastAppliedKey = `${clamped[0]}x${clamped[1]}`;
                    }
                }
                return r;
            };

            loadThree().then(() => {
                createStudioWidget(nodeRef);
                restoreSaved();
            });

            const prevRemoved = nodeRef.onRemoved;
            nodeRef.onRemoved = function () {
                window.removeEventListener("pointerdown", onDown, true);
                window.removeEventListener("mousedown", onDown, true);
                window.removeEventListener("pointerup", onUp, true);
                window.removeEventListener("mouseup", onUp, true);
                return prevRemoved?.apply(this, arguments);
            };

            return res;
        };
    },
});
