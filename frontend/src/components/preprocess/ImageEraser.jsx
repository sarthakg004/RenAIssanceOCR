import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Eraser,
    Check,
    X,
    Undo2,
    ZoomIn,
    ZoomOut,
    Minus,
    Plus,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

/**
 * ImageEraser - Full-screen modal eraser with multi-page support
 *
 * Features:
 * - Canvas erasing with smooth quadratic bezier strokes
 * - Adjustable brush size + keyboard shortcuts
 * - Per-stroke undo
 * - Pan & zoom (scroll + ctrl-drag)
 * - Page navigation: erase across pages, save all at once
 */
export default function ImageEraser({
    pages = [],           // [{ pageNumber, imageSrc }]
    initialPageIndex = 0,
    onSaveAll,            // (results: { [pageNumber]: dataUrl }) => void
    onCancel,
}) {
    // ========== MULTI-PAGE STATE ==========
    const [currentIdx, setCurrentIdx] = useState(initialPageIndex);
    // Store per-page canvas data: { [pageNumber]: ImageData }
    const pageDataRef = useRef({});
    const currentPage = pages[currentIdx];

    // ========== REFS ==========
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const lastPointRef = useRef(null);

    // ========== STATE ==========
    const [brushSize, setBrushSize] = useState(50);
    const [isDrawing, setIsDrawing] = useState(false);
    const [canvasReady, setCanvasReady] = useState(false);
    const [strokeHistory, setStrokeHistory] = useState([]);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const [modifiedPages, setModifiedPages] = useState(new Set());

    // ========== SAVE CURRENT PAGE STATE before switching ==========
    const saveCurrentPageData = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !currentPage) return;
        const ctx = canvas.getContext('2d');
        pageDataRef.current[currentPage.pageNumber] = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }, [currentPage]);

    // ========== LOAD IMAGE ==========
    const loadPage = useCallback((page) => {
        setCanvasReady(false);
        setStrokeHistory([]);

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            setImageSize({ w: img.naturalWidth, h: img.naturalHeight });

            const ctx = canvas.getContext('2d');

            // If we have saved data for this page, restore it; otherwise draw fresh
            const saved = pageDataRef.current[page.pageNumber];
            if (saved && saved.width === img.naturalWidth && saved.height === img.naturalHeight) {
                ctx.putImageData(saved, 0, 0);
            } else {
                ctx.drawImage(img, 0, 0);
            }

            // Fit to container
            if (containerRef.current) {
                const cw = containerRef.current.clientWidth;
                const ch = containerRef.current.clientHeight;
                const fitZoom = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1) * 0.92;
                setZoom(fitZoom);
                setPan({
                    x: (cw - img.naturalWidth * fitZoom) / 2,
                    y: (ch - img.naturalHeight * fitZoom) / 2,
                });
            }

            setCanvasReady(true);
        };
        img.src = page.imageSrc;
    }, []);

    // Load initial page
    useEffect(() => {
        if (currentPage) loadPage(currentPage);
    }, []);

    // ========== PAGE NAVIGATION ==========
    const goToPage = useCallback((newIdx) => {
        if (newIdx < 0 || newIdx >= pages.length || newIdx === currentIdx) return;
        saveCurrentPageData();
        setCurrentIdx(newIdx);
    }, [currentIdx, pages.length, saveCurrentPageData]);

    // Load page when index changes
    useEffect(() => {
        if (currentPage) loadPage(currentPage);
    }, [currentIdx]);

    // ========== COORDINATE HELPERS ==========
    const screenToCanvas = useCallback(
        (clientX, clientY) => {
            if (!containerRef.current) return { x: 0, y: 0 };
            const rect = containerRef.current.getBoundingClientRect();
            return {
                x: (clientX - rect.left - pan.x) / zoom,
                y: (clientY - rect.top - pan.y) / zoom,
            };
        },
        [zoom, pan]
    );

    const getClientPos = (e) => {
        if (e.touches && e.touches.length > 0) {
            return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
        }
        return { clientX: e.clientX, clientY: e.clientY };
    };

    // ========== SNAPSHOT (UNDO) ==========
    const saveSnapshot = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setStrokeHistory((prev) => {
            const next = [...prev, snapshot];
            return next.length > 20 ? next.slice(-20) : next;
        });
    }, []);

    const handleUndo = useCallback(() => {
        if (strokeHistory.length === 0) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(strokeHistory[strokeHistory.length - 1], 0, 0);
        setStrokeHistory((prev) => prev.slice(0, -1));
    }, [strokeHistory]);

    // ========== DRAWING ==========
    const drawDot = useCallback(
        (cx, cy) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(cx, cy, brushSize / 2, 0, Math.PI * 2);
            ctx.fill();
        },
        [brushSize]
    );

    const drawSegment = useCallback(
        (from, to) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.quadraticCurveTo(from.x, from.y, mx, my);
            ctx.stroke();
        },
        [brushSize]
    );

    // ========== POINTER EVENTS ==========
    const handlePointerDown = useCallback(
        (e) => {
            if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
                setIsPanning(true);
                const { clientX, clientY } = getClientPos(e);
                panStartRef.current = { x: clientX, y: clientY, panX: pan.x, panY: pan.y };
                e.preventDefault();
                return;
            }
            if (e.touches && e.touches.length > 1) return;

            const { clientX, clientY } = getClientPos(e);
            const pt = screenToCanvas(clientX, clientY);
            saveSnapshot();
            setIsDrawing(true);
            lastPointRef.current = pt;
            drawDot(pt.x, pt.y);
            setModifiedPages((prev) => new Set([...prev, currentPage?.pageNumber]));
        },
        [screenToCanvas, saveSnapshot, drawDot, pan, currentPage]
    );

    const handlePointerMove = useCallback(
        (e) => {
            const { clientX, clientY } = getClientPos(e);

            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setCursorPos({ x: clientX - rect.left, y: clientY - rect.top });
            }

            if (isPanning) {
                const dx = clientX - panStartRef.current.x;
                const dy = clientY - panStartRef.current.y;
                setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
                return;
            }

            if (!isDrawing) return;
            e.preventDefault();

            const pt = screenToCanvas(clientX, clientY);
            const last = lastPointRef.current;
            if (last) drawSegment(last, pt);
            lastPointRef.current = pt;
        },
        [isDrawing, isPanning, screenToCanvas, drawSegment]
    );

    const handlePointerUp = useCallback(() => {
        setIsDrawing(false);
        setIsPanning(false);
        lastPointRef.current = null;
    }, []);

    useEffect(() => {
        const up = () => {
            setIsDrawing(false);
            setIsPanning(false);
            lastPointRef.current = null;
        };
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        return () => {
            window.removeEventListener('mouseup', up);
            window.removeEventListener('touchend', up);
        };
    }, []);

    // ========== KEYBOARD ==========
    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === '[') setBrushSize((s) => Math.max(5, s - 5));
            else if (e.key === ']') setBrushSize((s) => Math.min(100, s + 5));
            else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleUndo();
            } else if (e.key === 'ArrowLeft') {
                goToPage(currentIdx - 1);
            } else if (e.key === 'ArrowRight') {
                goToPage(currentIdx + 1);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handleUndo, goToPage, currentIdx]);

    // ========== ZOOM ==========
    const handleZoomIn = () => setZoom((z) => Math.min(z * 1.25, 5));
    const handleZoomOut = () => setZoom((z) => Math.max(z / 1.25, 0.1));

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const handleWheel = (e) => {
            e.preventDefault();
            setZoom((z) => Math.max(0.1, Math.min(5, z * (e.deltaY > 0 ? 0.9 : 1.1))));
        };
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // ========== SAVE ALL ==========
    const handleSaveAll = useCallback(() => {
        // Save current page state first
        saveCurrentPageData();

        const results = {};

        // For each page, produce a dataURL
        // We need to use a temporary canvas to export pages we aren't currently viewing
        const tmpCanvas = document.createElement('canvas');

        pages.forEach((page) => {
            const saved = pageDataRef.current[page.pageNumber];
            if (saved) {
                tmpCanvas.width = saved.width;
                tmpCanvas.height = saved.height;
                tmpCanvas.getContext('2d').putImageData(saved, 0, 0);
                results[page.pageNumber] = tmpCanvas.toDataURL('image/png');
            }
            // If not saved (never visited / unmodified), skip — parent keeps original
        });

        // Also get the current canvas if it's modified
        if (currentPage && modifiedPages.has(currentPage.pageNumber)) {
            const canvas = canvasRef.current;
            if (canvas) {
                results[currentPage.pageNumber] = canvas.toDataURL('image/png');
            }
        }

        onSaveAll(results);
    }, [saveCurrentPageData, pages, currentPage, modifiedPages, onSaveAll]);

    // ========== RENDER ==========
    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
            {/* ====== TOOLBAR ====== */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
                {/* Left */}
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-red-500 to-pink-600 rounded-lg text-white">
                        <Eraser className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-white font-semibold text-sm">Eraser Tool</h2>
                        <p className="text-gray-400 text-xs">
                            Paint to erase • Scroll to zoom • Ctrl+drag to pan
                        </p>
                    </div>
                </div>

                {/* Center: Controls */}
                <div className="flex items-center gap-4 bg-gray-700/60 px-4 py-2 rounded-xl">
                    {/* Brush */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setBrushSize((s) => Math.max(5, s - 5))} className="p-1 text-gray-300 hover:text-white"><Minus size={14} /></button>
                        <input type="range" min={5} max={100} step={1} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-28 accent-blue-500" />
                        <button onClick={() => setBrushSize((s) => Math.min(100, s + 5))} className="p-1 text-gray-300 hover:text-white"><Plus size={14} /></button>
                        <span className="text-xs text-gray-300 font-mono w-10 text-center">{brushSize}px</span>
                    </div>

                    <div className="w-px h-6 bg-gray-600" />

                    {/* Zoom */}
                    <div className="flex items-center gap-1">
                        <button onClick={handleZoomOut} className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-600 rounded"><ZoomOut size={16} /></button>
                        <span className="text-xs text-gray-400 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={handleZoomIn} className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-600 rounded"><ZoomIn size={16} /></button>
                    </div>

                    <div className="w-px h-6 bg-gray-600" />

                    {/* Undo */}
                    <button
                        onClick={handleUndo}
                        disabled={strokeHistory.length === 0}
                        className={`p-1.5 rounded ${strokeHistory.length > 0 ? 'text-gray-300 hover:text-white hover:bg-gray-600' : 'text-gray-600 cursor-not-allowed'}`}
                        title="Undo (Ctrl+Z)"
                    >
                        <Undo2 size={16} />
                    </button>
                </div>

                {/* Right */}
                <div className="flex items-center gap-2">
                    <button onClick={onCancel} className="flex items-center gap-2 px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg text-sm font-medium">
                        <X size={16} /> Cancel
                    </button>
                    <button
                        onClick={handleSaveAll}
                        className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-lg hover:shadow-lg hover:-translate-y-0.5 transition-all text-sm"
                    >
                        <Check size={16} />
                        Save All
                        {modifiedPages.size > 0 && (
                            <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[10px]">
                                {modifiedPages.size} page{modifiedPages.size > 1 ? 's' : ''}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* ====== CANVAS AREA ====== */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden cursor-none select-none"
                style={{ background: 'repeating-conic-gradient(#2a2a2a 0% 25%, #333 0% 50%) 50% / 20px 20px' }}
                onMouseDown={handlePointerDown}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onTouchStart={handlePointerDown}
                onTouchMove={handlePointerMove}
                onTouchEnd={handlePointerUp}
            >
                <canvas
                    ref={canvasRef}
                    style={{
                        position: 'absolute',
                        left: pan.x,
                        top: pan.y,
                        width: imageSize.w * zoom,
                        height: imageSize.h * zoom,
                        imageRendering: zoom > 2 ? 'pixelated' : 'auto',
                    }}
                />

                {/* Brush cursor */}
                {canvasReady && (
                    <div
                        className="pointer-events-none absolute"
                        style={{
                            left: cursorPos.x - (brushSize * zoom) / 2,
                            top: cursorPos.y - (brushSize * zoom) / 2,
                            width: brushSize * zoom,
                            height: brushSize * zoom,
                            borderRadius: '50%',
                            border: '2px solid rgba(239, 68, 68, 0.8)',
                            boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
                        }}
                    />
                )}

                {/* Loading */}
                {!canvasReady && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 border-3 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                )}
            </div>

            {/* ====== BOTTOM: Page navigation ====== */}
            <div className="flex-shrink-0 px-4 py-2.5 bg-gray-800 border-t border-gray-700 flex items-center justify-between">
                {/* Left: shortcuts */}
                <div className="flex items-center gap-4 text-[11px] text-gray-500">
                    <span><kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400 font-mono text-[10px]">[</kbd> / <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400 font-mono text-[10px]">]</kbd> Brush</span>
                    <span><kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400 font-mono text-[10px]">Ctrl+Z</kbd> Undo</span>
                </div>

                {/* Center: Page nav */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => goToPage(currentIdx - 1)}
                        disabled={currentIdx === 0}
                        className={`p-1.5 rounded-lg ${currentIdx === 0 ? 'text-gray-600' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`}
                    >
                        <ChevronLeft size={18} />
                    </button>

                    <div className="flex items-center gap-1.5">
                        {pages.map((page, idx) => (
                            <button
                                key={page.pageNumber}
                                onClick={() => goToPage(idx)}
                                className={`relative w-7 h-7 rounded-lg text-xs font-medium transition-all ${idx === currentIdx
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                                    }`}
                            >
                                {page.pageNumber}
                                {modifiedPages.has(page.pageNumber) && (
                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-400 rounded-full border-2 border-gray-800" />
                                )}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => goToPage(currentIdx + 1)}
                        disabled={currentIdx === pages.length - 1}
                        className={`p-1.5 rounded-lg ${currentIdx === pages.length - 1 ? 'text-gray-600' : 'text-gray-300 hover:text-white hover:bg-gray-700'}`}
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>

                {/* Right: page info */}
                <span className="text-xs text-gray-500">
                    Page {currentPage?.pageNumber} • {currentIdx + 1}/{pages.length}
                </span>
            </div>
        </div>
    );
}
