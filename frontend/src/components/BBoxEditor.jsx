import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    X,
    Check,
    Undo2,
    Redo2,
    ZoomIn,
    ZoomOut,
    Maximize2,
    Plus,
    MousePointer2,
    Trash2,
    ChevronLeft,
    ChevronRight,
    RotateCw,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const HANDLE_RADIUS = 6;        // corner handle radius in canvas coords
const ROT_HANDLE_OFFSET = 28;   // rotation handle distance from top-edge midpoint
const MIN_BOX_SIZE = 10;
const MAX_UNDO = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
let _uid = 0;
function uid() { return `bb-${Date.now()}-${_uid++}`; }

/**
 * Convert any PaddleOCR polygon to a box stored as 4 corner points.
 * If the polygon has exactly 4 points we keep them verbatim (preserves rotation).
 * Otherwise we fall back to the bounding-rect as an axis-aligned quad.
 */
function polyToBox(poly, id) {
    if (!poly || poly.length === 0) return null;
    let pts;
    if (poly.length === 4) {
        pts = poly.map(p => [p[0], p[1]]);
    } else {
        // Compute axis-aligned bounding rect from arbitrary polygon
        const xs = poly.map(p => p[0]);
        const ys = poly.map(p => p[1]);
        const x1 = Math.min(...xs), y1 = Math.min(...ys);
        const x2 = Math.max(...xs), y2 = Math.max(...ys);
        pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    }
    return { id: id ?? uid(), points: pts, selected: false };
    // points order: [TL, TR, BR, BL]  (standard PaddleOCR quad order)
}

/** Convert internal box back to PaddleOCR polygon format. */
function boxToPoly(b) { return b.points; }

/** Create an axis-aligned quad from two corners (used by draw mode). */
function makeRectBox(x1, y1, x2, y2) {
    return {
        id: uid(),
        points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
        selected: true,
    };
}

/** Centroid of 4 points. */
function getCenter(pts) {
    return { x: pts.reduce((s, p) => s + p[0], 0) / 4, y: pts.reduce((s, p) => s + p[1], 0) / 4 };
}

/** Rotate a single point around a centre by angle (radians). */
function rotatePoint(px, py, cx, cy, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos];
}

/** Point-in-convex-polygon test (works for quads too). */
function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1];
        const xj = pts[j][0], yj = pts[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

/** Find which corner index (0-3) was hit, or -1. */
function hitCorner(pts, px, py, r) {
    for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(px - pts[i][0], py - pts[i][1]) <= r) return i;
    }
    return -1;
}

/** Position of the blue rotation handle (above the top-edge midpoint). */
function getRotHandlePos(pts) {
    const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const c = getCenter(pts);
    const dx = mid[0] - c.x, dy = mid[1] - c.y;
    const len = Math.hypot(dx, dy) || 1;
    return [mid[0] + (dx / len) * ROT_HANDLE_OFFSET, mid[1] + (dy / len) * ROT_HANDLE_OFFSET];
}

/** Is the mouse hitting the rotation handle? */
function hitRotHandle(pts, px, py, r) {
    const [hx, hy] = getRotHandlePos(pts);
    return Math.hypot(px - hx, py - hy) <= r;
}

/** Bounding axis-aligned rect of 4 points (for size validation). */
function polyBounds(pts) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// ─────────────────────────────────────────────────────────────────────────────
// BBoxEditor — multi-page, supports angled bounding boxes
// ─────────────────────────────────────────────────────────────────────────────
export default function BBoxEditor({ pages = [], onSave, onCancel }) {

    // ── Multi-page ─────────────────────────────────────────────────────────
    const [currentIdx, setCurrentIdx] = useState(0);
    const pageBoxesRef = useRef({});
    const [modifiedPages, setModifiedPages] = useState(new Set());
    const currentPage = pages[currentIdx];

    // ── Refs ───────────────────────────────────────────────────────────────
    const bgCanvasRef = useRef(null);
    const overlayCanvasRef = useRef(null);
    const containerRef = useRef(null);

    // ── Box state ──────────────────────────────────────────────────────────
    const [boxes, setBoxes] = useState([]);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const boxesRef = useRef([]);
    useEffect(() => { boxesRef.current = boxes; }, [boxes]);

    // ── View ────────────────────────────────────────────────────────────────
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
    const [imageReady, setImageReady] = useState(false);

    const zoomRef = useRef(zoom);
    const panRef = useRef(pan);
    const imageSizeRef = useRef(imageSize);

    // Sync refs in render body — guarantees they are current before any effect fires
    zoomRef.current = zoom;
    panRef.current = pan;
    imageSizeRef.current = imageSize;

    // ── Mode ───────────────────────────────────────────────────────────────
    // 'select' | 'draw'
    const [mode, setMode] = useState('select');

    // ── Drag state ─────────────────────────────────────────────────────────
    // Types:
    //  { type:'move',   id, origPts, startX, startY }
    //  { type:'corner', id, cornerIdx, origPts }
    //  { type:'rotate', id, origPts, center, startAngle }
    //  { type:'draw',   startX, startY, currentX, currentY }
    //  { type:'pan',    ... }
    const dragRef = useRef(null);
    const isPanRef = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const selectedId = useMemo(() => boxes.find(b => b.selected)?.id ?? null, [boxes]);

    // ─────────────────────────────────────────────────────────────────────
    // Page management
    // ─────────────────────────────────────────────────────────────────────
    const saveCurrentPage = useCallback(() => {
        if (!currentPage) return;
        pageBoxesRef.current[currentPage.pageNumber] = boxesRef.current.map(b => ({ ...b, selected: false }));
    }, [currentPage]);

    const loadPage = useCallback((page) => {
        setImageReady(false);
        setUndoStack([]);
        setRedoStack([]);

        const saved = pageBoxesRef.current[page.pageNumber];
        const initialBoxes = saved ?? (page.polygons || []).map(poly => polyToBox(poly)).filter(Boolean);
        if (!saved) pageBoxesRef.current[page.pageNumber] = initialBoxes;
        setBoxes(initialBoxes);

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const w = img.naturalWidth, h = img.naturalHeight;
            setImageSize({ w, h });

            const bg = bgCanvasRef.current;
            if (bg) { bg.width = w; bg.height = h; bg.getContext('2d').drawImage(img, 0, 0); }

            if (containerRef.current) {
                const cw = containerRef.current.clientWidth, ch = containerRef.current.clientHeight;
                const fitZ = Math.min(cw / w, ch / h, 1) * 0.9;
                const fitPan = { x: (cw - w * fitZ) / 2, y: (ch - h * fitZ) / 2 };
                setZoom(fitZ); setPan(fitPan);
                zoomRef.current = fitZ; panRef.current = fitPan;
            }
            setImageReady(true);
        };
        img.src = page.imageSrc;
    }, []);

    useEffect(() => { if (pages.length > 0) loadPage(pages[0]); }, []); // eslint-disable-line

    const goToPage = useCallback((idx) => {
        if (idx < 0 || idx >= pages.length || idx === currentIdx) return;
        saveCurrentPage();
        setCurrentIdx(idx);
        loadPage(pages[idx]);
    }, [currentIdx, pages, saveCurrentPage, loadPage]);

    // ─────────────────────────────────────────────────────────────────────
    // Overlay drawing
    // ─────────────────────────────────────────────────────────────────────
    const drawOverlay = useCallback((boxList, drawState) => {
        const canvas = overlayCanvasRef.current;
        const { w, h } = imageSizeRef.current;
        if (!canvas || w === 0) return;

        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const z = zoomRef.current;
        const lw = Math.max(1.5, 2 / z);
        const cr = Math.max(4, HANDLE_RADIUS / z);     // corner radius in canvas coords
        const rr = Math.max(5, (HANDLE_RADIUS + 2) / z); // rotation handle radius

        for (const b of boxList) {
            const sel = b.selected;
            const pts = b.points;

            // Fill + stroke the polygon
            ctx.strokeStyle = sel ? '#f97316' : '#22c55e';
            ctx.lineWidth = lw;
            ctx.fillStyle = sel ? 'rgba(249,115,22,0.12)' : 'rgba(34,197,94,0.08)';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (sel) {
                // Corner handles (white squares with orange border)
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#f97316';
                ctx.lineWidth = lw;
                for (const [px, py] of pts) {
                    ctx.beginPath();
                    ctx.rect(px - cr, py - cr, cr * 2, cr * 2);
                    ctx.fill(); ctx.stroke();
                }

                // Dashed line from top-edge mid to rotation handle
                const [rhx, rhy] = getRotHandlePos(pts);
                const midX = (pts[0][0] + pts[1][0]) / 2;
                const midY = (pts[0][1] + pts[1][1]) / 2;
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = lw;
                ctx.setLineDash([4 / z, 3 / z]);
                ctx.beginPath(); ctx.moveTo(midX, midY); ctx.lineTo(rhx, rhy); ctx.stroke();
                ctx.setLineDash([]);

                // Rotation handle (blue circle)
                ctx.fillStyle = '#3b82f6';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = lw;
                ctx.beginPath(); ctx.arc(rhx, rhy, rr, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
            }
        }

        // Draw rubber-band while in draw mode
        if (drawState) {
            const { startX, startY, currentX, currentY } = drawState;
            const x1 = Math.min(startX, currentX), y1 = Math.min(startY, currentY);
            const x2 = Math.max(startX, currentX), y2 = Math.max(startY, currentY);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = lw;
            ctx.setLineDash([6 / z, 4 / z]);
            ctx.fillStyle = 'rgba(59,130,246,0.10)';
            ctx.beginPath(); ctx.rect(x1, y1, x2 - x1, y2 - y1);
            ctx.fill(); ctx.stroke();
            ctx.setLineDash([]);
        }
    }, []);

    // Redraw whenever boxes change OR when the image finishes loading (imageSize changes)
    useEffect(() => {
        if (imageSize.w > 0) drawOverlay(boxes, null);
    }, [boxes, imageSize, drawOverlay]);

    // ─────────────────────────────────────────────────────────────────────
    // Undo / Redo
    // ─────────────────────────────────────────────────────────────────────
    const pushUndo = useCallback((prevBoxes) => {
        const snap = prevBoxes.map(b => ({ ...b, points: b.points.map(p => [...p]), selected: false }));
        setUndoStack(s => { const n = [...s, snap]; return n.length > MAX_UNDO ? n.slice(-MAX_UNDO) : n; });
        setRedoStack([]);
        setModifiedPages(prev => new Set([...prev, currentPage?.pageNumber]));
    }, [currentPage]);

    const handleUndo = useCallback(() => {
        setUndoStack(s => {
            if (!s.length) return s;
            const prev = s[s.length - 1];
            setRedoStack(r => [...r, boxes.map(b => ({ ...b, points: b.points.map(p => [...p]), selected: false }))]);
            setBoxes(prev); return s.slice(0, -1);
        });
    }, [boxes]);

    const handleRedo = useCallback(() => {
        setRedoStack(r => {
            if (!r.length) return r;
            const next = r[r.length - 1];
            setUndoStack(s => [...s, boxes.map(b => ({ ...b, points: b.points.map(p => [...p]), selected: false }))]);
            setBoxes(next); return r.slice(0, -1);
        });
    }, [boxes]);

    // ─────────────────────────────────────────────────────────────────────
    // Coordinates
    // ─────────────────────────────────────────────────────────────────────
    const screenToImage = useCallback((clientX, clientY) => {
        if (!containerRef.current) return { x: 0, y: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        return {
            x: (clientX - rect.left - panRef.current.x) / zoomRef.current,
            y: (clientY - rect.top - panRef.current.y) / zoomRef.current,
        };
    }, []);

    // ─────────────────────────────────────────────────────────────────────
    // Pointer events
    // ─────────────────────────────────────────────────────────────────────
    const handlePointerDown = useCallback((e) => {
        // Pan: middle-click or ctrl+left-click
        if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
            isPanRef.current = true;
            panStartRef.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
            e.preventDefault(); return;
        }
        if (e.button !== 0) return;

        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);
        const z = zoomRef.current;
        const cr = Math.max(4, HANDLE_RADIUS / z);
        const rr = Math.max(5, (HANDLE_RADIUS + 2) / z);

        // ── DRAW mode ──────────────────────────────────────────────────
        if (mode === 'draw') {
            dragRef.current = { type: 'draw', startX: imgX, startY: imgY, currentX: imgX, currentY: imgY };
            return;
        }

        // ── SELECT mode ────────────────────────────────────────────────
        const selBox = boxes.find(b => b.selected);

        // 1. Rotation handle (check before corners so it doesn't get hidden)
        if (selBox && hitRotHandle(selBox.points, imgX, imgY, rr * 1.5)) {
            const center = getCenter(selBox.points);
            pushUndo(boxes);
            dragRef.current = {
                type: 'rotate',
                id: selBox.id,
                origPts: selBox.points.map(p => [...p]),
                center,
                startAngle: Math.atan2(imgY - center.y, imgX - center.x),
            };
            return;
        }

        // 2. Corner handles on selected box
        if (selBox) {
            const ci = hitCorner(selBox.points, imgX, imgY, cr * 1.5);
            if (ci !== -1) {
                pushUndo(boxes);
                dragRef.current = {
                    type: 'corner',
                    id: selBox.id,
                    cornerIdx: ci,
                    origPts: selBox.points.map(p => [...p]),
                };
                return;
            }
        }

        // 3. Body of any box (top-most first)
        const hit = [...boxes].reverse().find(b => pointInPolygon(imgX, imgY, b.points));
        if (hit) {
            pushUndo(boxes);
            dragRef.current = {
                type: 'move',
                id: hit.id,
                origPts: hit.points.map(p => [...p]),
                startX: imgX, startY: imgY,
            };
            setBoxes(prev => prev.map(b => ({ ...b, selected: b.id === hit.id })));
            return;
        }

        // 4. Click empty space → deselect
        setBoxes(prev => prev.map(b => ({ ...b, selected: false })));
        dragRef.current = null;
    }, [mode, boxes, screenToImage, pushUndo]);

    const handlePointerMove = useCallback((e) => {
        if (isPanRef.current) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            const np = { x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy };
            setPan(np); panRef.current = np; return;
        }

        const drag = dragRef.current;
        if (!drag) return;
        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

        if (drag.type === 'draw') {
            drag.currentX = imgX; drag.currentY = imgY;
            drawOverlay(boxesRef.current, drag); return;
        }

        if (drag.type === 'move') {
            const dx = imgX - drag.startX, dy = imgY - drag.startY;
            setBoxes(prev => prev.map(b => {
                if (b.id !== drag.id) return b;
                return { ...b, points: drag.origPts.map(([px, py]) => [px + dx, py + dy]) };
            }));
            return;
        }

        if (drag.type === 'corner') {
            setBoxes(prev => prev.map(b => {
                if (b.id !== drag.id) return b;
                const newPts = drag.origPts.map(p => [...p]);
                newPts[drag.cornerIdx] = [imgX, imgY];
                // Enforce minimum size
                const { w, h } = polyBounds(newPts);
                if (w < MIN_BOX_SIZE || h < MIN_BOX_SIZE) return b;
                return { ...b, points: newPts };
            }));
            return;
        }

        if (drag.type === 'rotate') {
            const currentAngle = Math.atan2(imgY - drag.center.y, imgX - drag.center.x);
            const delta = currentAngle - drag.startAngle;
            setBoxes(prev => prev.map(b => {
                if (b.id !== drag.id) return b;
                return {
                    ...b,
                    points: drag.origPts.map(([px, py]) => rotatePoint(px, py, drag.center.x, drag.center.y, delta)),
                };
            }));
        }
    }, [screenToImage, drawOverlay]);

    const handlePointerUp = useCallback(() => {
        isPanRef.current = false;
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;

        if (drag.type === 'draw') {
            const x1 = Math.min(drag.startX, drag.currentX), y1 = Math.min(drag.startY, drag.currentY);
            const x2 = Math.max(drag.startX, drag.currentX), y2 = Math.max(drag.startY, drag.currentY);
            if (x2 - x1 >= MIN_BOX_SIZE && y2 - y1 >= MIN_BOX_SIZE) {
                pushUndo(boxesRef.current);
                const nb = makeRectBox(x1, y1, x2, y2);
                setBoxes(prev => [...prev.map(b => ({ ...b, selected: false })), nb]);
                setModifiedPages(prev => new Set([...prev, currentPage?.pageNumber]));
            } else {
                drawOverlay(boxesRef.current, null);
            }
        }

        if (drag.type === 'move' || drag.type === 'corner' || drag.type === 'rotate') {
            setModifiedPages(prev => new Set([...prev, currentPage?.pageNumber]));
        }
    }, [pushUndo, drawOverlay, currentPage]);

    useEffect(() => {
        const up = () => handlePointerUp();
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, [handlePointerUp]);

    // ─────────────────────────────────────────────────────────────────────
    // Scroll zoom
    // ─────────────────────────────────────────────────────────────────────
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = e => {
            e.preventDefault();
            const f = e.deltaY < 0 ? 1.1 : 0.9;
            setZoom(z => { const nz = Math.max(0.05, Math.min(8, z * f)); zoomRef.current = nz; return nz; });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    // ─────────────────────────────────────────────────────────────────────
    // Keyboard
    // ─────────────────────────────────────────────────────────────────────
    const handleDelete = useCallback(() => {
        if (!selectedId) return;
        pushUndo(boxes);
        setBoxes(prev => prev.filter(b => b.id !== selectedId));
        setModifiedPages(prev => new Set([...prev, currentPage?.pageNumber]));
    }, [selectedId, boxes, pushUndo, currentPage]);

    useEffect(() => {
        const onKey = e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'n' || e.key === 'N') { setMode(m => m === 'draw' ? 'select' : 'draw'); return; }
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); handleDelete(); return; }
            if (e.key === 'Escape') { setMode('select'); setBoxes(prev => prev.map(b => ({ ...b, selected: false }))); dragRef.current = null; return; }
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') { e.preventDefault(); handleUndo(); }
                else if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); handleRedo(); }
            }
            if (e.key === 'ArrowLeft') goToPage(currentIdx - 1);
            if (e.key === 'ArrowRight') goToPage(currentIdx + 1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedId, handleDelete, handleUndo, handleRedo, currentIdx, goToPage]);

    // ─────────────────────────────────────────────────────────────────────
    // Fit view
    // ─────────────────────────────────────────────────────────────────────
    const handleFit = useCallback(() => {
        const { w, h } = imageSizeRef.current;
        if (!containerRef.current || w === 0) return;
        const cw = containerRef.current.clientWidth, ch = containerRef.current.clientHeight;
        const fitZ = Math.min(cw / w, ch / h, 1) * 0.9;
        const fitPan = { x: (cw - w * fitZ) / 2, y: (ch - h * fitZ) / 2 };
        setZoom(fitZ); setPan(fitPan); zoomRef.current = fitZ; panRef.current = fitPan;
    }, []);

    // ─────────────────────────────────────────────────────────────────────
    // Cursor style — update based on what's under cursor
    // ─────────────────────────────────────────────────────────────────────
    const [cursor, setCursor] = useState('default');
    const handleMouseMoveForCursor = useCallback((e) => {
        if (mode === 'draw') { setCursor('crosshair'); return; }
        if (isPanRef.current) { setCursor('grabbing'); return; }
        if (dragRef.current) return; // already handling a drag

        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);
        const z = zoomRef.current;
        const selBox = boxes.find(b => b.selected);
        const cr = Math.max(4, HANDLE_RADIUS / z);
        const rr = Math.max(5, (HANDLE_RADIUS + 2) / z);

        if (selBox) {
            if (hitRotHandle(selBox.points, imgX, imgY, rr * 1.5)) { setCursor('grab'); return; }
            if (hitCorner(selBox.points, imgX, imgY, cr * 1.5) !== -1) { setCursor('crosshair'); return; }
        }
        const hit = [...boxes].reverse().find(b => pointInPolygon(imgX, imgY, b.points));
        setCursor(hit ? 'move' : 'default');
    }, [mode, boxes, screenToImage]);

    // ─────────────────────────────────────────────────────────────────────
    // Save all pages
    // ─────────────────────────────────────────────────────────────────────
    const handleSave = useCallback(() => {
        saveCurrentPage();
        const results = {};
        pages.forEach(page => {
            const bxs = pageBoxesRef.current[page.pageNumber];
            results[page.pageNumber] = bxs ? bxs.map(boxToPoly) : page.polygons || [];
        });
        onSave(results);
    }, [pages, onSave, saveCurrentPage]);

    const selBox = boxes.find(b => b.selected);

    // ─────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-950" onContextMenu={e => e.preventDefault()}>

            {/* ── TOOLBAR ────────────────────────────────────────────── */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800">

                {/* Left — title + mode toggle */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg text-white">
                            <MousePointer2 size={16} />
                        </div>
                        <div>
                            <h2 className="text-white font-semibold text-sm leading-none">Box Editor</h2>
                            <p className="text-gray-500 text-[10px] mt-0.5">
                                {boxes.length} box{boxes.length !== 1 ? 'es' : ''}
                                {modifiedPages.size > 0 && <span className="ml-1 text-amber-500">· {modifiedPages.size} page{modifiedPages.size > 1 ? 's' : ''} modified</span>}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
                        <button onClick={() => setMode('select')} title="Select / Move / Resize / Rotate  (Esc)"
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${mode === 'select' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>
                            <MousePointer2 size={13} /> Select
                        </button>
                        <button onClick={() => setMode(m => m === 'draw' ? 'select' : 'draw')} title="Draw New Box  (N)"
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${mode === 'draw' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>
                            <Plus size={13} /> Add <kbd className="ml-1 px-1 text-[9px] bg-gray-700 text-gray-400 rounded">N</kbd>
                        </button>
                    </div>
                </div>

                {/* Center — info + undo/redo + zoom */}
                <div className="flex items-center gap-3">
                    {selBox ? (
                        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-gray-800 rounded-lg text-xs text-gray-300">
                            <RotateCw size={11} className="text-blue-400" />
                            <span className="text-gray-500 text-[10px]">Drag blue ● to rotate · Drag corners to reshape</span>
                        </div>
                    ) : (
                        <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-gray-800 rounded-lg text-xs text-gray-500">
                            Click a box to select · drag its blue handle to rotate
                        </div>
                    )}

                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
                        <button onClick={handleUndo} disabled={!undoStack.length} title="Undo (Ctrl+Z)"
                            className={`p-1.5 rounded-md ${undoStack.length ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-700 cursor-not-allowed'}`}><Undo2 size={15} /></button>
                        <button onClick={handleRedo} disabled={!redoStack.length} title="Redo (Ctrl+Y)"
                            className={`p-1.5 rounded-md ${redoStack.length ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-700 cursor-not-allowed'}`}><Redo2 size={15} /></button>
                    </div>

                    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
                        <button onClick={() => setZoom(z => Math.min(z * 1.25, 8))} className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md"><ZoomIn size={15} /></button>
                        <span className="text-xs text-gray-500 font-mono min-w-[42px] text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(z => Math.max(z / 1.25, 0.05))} className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md"><ZoomOut size={15} /></button>
                        <button onClick={handleFit} title="Fit to view" className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md"><Maximize2 size={15} /></button>
                    </div>

                    {selectedId && (
                        <button onClick={handleDelete} title="Delete (Delete)"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-800/60 text-red-400 hover:text-red-300 text-xs font-semibold transition-colors">
                            <Trash2 size={13} /> Delete
                        </button>
                    )}
                </div>

                {/* Right — cancel / save */}
                <div className="flex items-center gap-2">
                    <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg text-sm font-medium transition-colors">
                        <X size={15} /> Cancel
                    </button>
                    <button onClick={handleSave}
                        className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold rounded-lg text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
                        <Check size={15} />
                        Save All
                        {modifiedPages.size > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[10px]">
                                {modifiedPages.size} page{modifiedPages.size > 1 ? 's' : ''}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ── CANVAS AREA ──────────────────────────────────────────── */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden select-none"
                style={{ background: 'repeating-conic-gradient(#1a1a1a 0% 25%, #222 0% 50%) 50% / 20px 20px', cursor }}
                onMouseDown={handlePointerDown}
                onMouseMove={(e) => { handlePointerMove(e); handleMouseMoveForCursor(e); }}
            >
                {/* Background image (drawn once) */}
                <canvas ref={bgCanvasRef} style={{ position: 'absolute', left: pan.x, top: pan.y, width: imageSize.w * zoom, height: imageSize.h * zoom, imageRendering: zoom > 2 ? 'pixelated' : 'auto', display: imageReady ? 'block' : 'none' }} />

                {/* Interactive overlay */}
                <canvas ref={overlayCanvasRef} style={{ position: 'absolute', left: pan.x, top: pan.y, width: imageSize.w * zoom, height: imageSize.h * zoom, imageRendering: zoom > 2 ? 'pixelated' : 'auto', display: imageReady ? 'block' : 'none', pointerEvents: 'none' }} />

                {!imageReady && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 border-4 border-gray-700 border-t-orange-500 rounded-full animate-spin" />
                    </div>
                )}

                {mode === 'draw' && imageReady && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
                        <div className="px-3 py-1.5 bg-blue-600/90 text-white text-xs font-semibold rounded-full shadow-lg backdrop-blur-sm">
                            Drag to draw · After drawing, drag the <span className="text-blue-200">blue ●</span> to rotate · Press N or Esc to exit
                        </div>
                    </div>
                )}
            </div>

            {/* ── BOTTOM: page nav + shortcuts ─────────────────────────── */}
            <div className="flex-shrink-0 px-4 py-2 bg-gray-900 border-t border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-4 text-[11px] text-gray-500">
                    <span><kbd className="px-1 py-0.5 bg-gray-800 text-gray-400 rounded font-mono text-[10px]">N</kbd> Add box</span>
                    <span><kbd className="px-1 py-0.5 bg-gray-800 text-gray-400 rounded font-mono text-[10px]">Del</kbd> Delete</span>
                    <span><kbd className="px-1 py-0.5 bg-gray-800 text-gray-400 rounded font-mono text-[10px]">Ctrl+Z</kbd> Undo</span>
                    <span className="hidden sm:inline"><kbd className="px-1 py-0.5 bg-gray-800 text-gray-400 rounded font-mono text-[10px]">Ctrl+drag</kbd> Pan</span>
                    <span className="hidden sm:inline text-blue-400">Blue ● = rotate box</span>
                    <span className="hidden sm:inline"><kbd className="px-1 py-0.5 bg-gray-800 text-gray-400 rounded font-mono text-[10px]">← →</kbd> Pages</span>
                </div>

                {pages.length > 1 && (
                    <div className="flex items-center gap-2">
                        <button onClick={() => goToPage(currentIdx - 1)} disabled={currentIdx === 0}
                            className={`p-1.5 rounded-lg ${currentIdx === 0 ? 'text-gray-700' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}>
                            <ChevronLeft size={18} />
                        </button>
                        <div className="flex items-center gap-1">
                            {pages.map((page, idx) => (
                                <button key={page.pageNumber} onClick={() => goToPage(idx)} title={`Page ${page.pageNumber}`}
                                    className={`relative w-7 h-7 rounded-lg text-xs font-semibold transition-all ${idx === currentIdx ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}>
                                    {page.pageNumber}
                                    {modifiedPages.has(page.pageNumber) && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full border border-gray-900" />
                                    )}
                                </button>
                            ))}
                        </div>
                        <button onClick={() => goToPage(currentIdx + 1)} disabled={currentIdx === pages.length - 1}
                            className={`p-1.5 rounded-lg ${currentIdx === pages.length - 1 ? 'text-gray-700' : 'text-gray-300 hover:text-white hover:bg-gray-800'}`}>
                            <ChevronRight size={18} />
                        </button>
                    </div>
                )}

                <span className="text-[11px] text-gray-600">
                    {imageSize.w > 0 && `${imageSize.w} × ${imageSize.h} px`}
                </span>
            </div>
        </div>
    );
}
