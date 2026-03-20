import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ArrowLeft,
    Cpu,
    Play,
    Loader2,
    CheckCircle2,
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    Download,
    FileText,
    FileJson,
    RefreshCw,
    Layers,
    Image as ImageIcon,
    Info,
    Monitor,
} from 'lucide-react';
import ResizablePanels from './ocr/ResizablePanels';
import {
    getCRNNModels,
    runCRNNRecognition,
    exportCRNNResultsAsText,
    exportCRNNResultsAsJSON,
    downloadBlob,
} from '../features/ocr/services/ocrApi';


// ═══════════════════════════════════════════════════════════════════
// CRNNRecognitionPage
// ═══════════════════════════════════════════════════════════════════

export default function CRNNRecognitionPage({
    pages,
    selectedPages,
    processedImages,
    detectedBoxes,       // { pageNum: [ [[x,y],[x,y],[x,y],[x,y]], ... ] }
    onBack,
}) {
    // ── Model selection ────────────────────────────────
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState(null);

    // ── Page navigation ────────────────────────────────
    const [viewingPageIndex, setViewingPageIndex] = useState(0);
    const availablePages = useMemo(() => selectedPages || [], [selectedPages]);
    const currentPageNum = availablePages[viewingPageIndex] || 1;
    const totalPages = availablePages.length;

    // ── Recognition state ──────────────────────────────
    const [recognizedByPage, setRecognizedByPage] = useState({});  // {pageNum: [{box_index, text}]}
    const [processing, setProcessing] = useState(false);
    const [processingAll, setProcessingAll] = useState(false);
    const [processAllProgress, setProcessAllProgress] = useState(null);
    const cancelRef = useRef(false);
    const [error, setError] = useState(null);
    const [lastDevice, setLastDevice] = useState(null);
    const [lastTime, setLastTime] = useState(null);

    // ── Hover highlight ────────────────────────────────
    const [hoveredBoxIndex, setHoveredBoxIndex] = useState(null);
    const [hoveredTextIndex, setHoveredTextIndex] = useState(null);
    const activeHighlight = hoveredBoxIndex ?? hoveredTextIndex;

    // ── Export ──────────────────────────────────────────
    const [exporting, setExporting] = useState(null);

    // ── Composite image canvas ─────────────────────────
    const [compositeUrl, setCompositeUrl] = useState(null);
    const imgRef = useRef(null);

    // ── Derived data ───────────────────────────────────
    const currentBoxes = detectedBoxes?.[currentPageNum] || [];
    const currentResults = recognizedByPage[currentPageNum] || [];
    const isCurrentRecognized = currentPageNum in recognizedByPage;
    const recognizedCount = Object.keys(recognizedByPage).length;

    const getImageUrl = useCallback((pageNum) => {
        if (processedImages?.[pageNum]) return processedImages[pageNum];
        const page = pages?.find(p => p.pageNumber === pageNum);
        return page?.thumbnail || null;
    }, [pages, processedImages]);

    const currentImageUrl = getImageUrl(currentPageNum);

    // Sort boxes top → bottom
    const sortedBoxIndices = useMemo(() => {
        return currentBoxes
            .map((poly, idx) => {
                const byY = [...poly].sort((a, b) => a[1] - b[1]);
                const topMidY = (byY[0][1] + byY[1][1]) / 2;
                return { idx, topMidY };
            })
            .sort((a, b) => a.topMidY - b.topMidY)
            .map(item => item.idx);
    }, [currentBoxes]);

    // Map sorted position → recognized text
    const sortedResults = useMemo(() => {
        if (!currentResults.length) return [];
        const byIndex = {};
        currentResults.forEach(r => { byIndex[r.box_index] = r.text; });
        return sortedBoxIndices.map(origIdx => ({
            boxIndex: origIdx,
            text: byIndex[origIdx] ?? '',
        }));
    }, [currentResults, sortedBoxIndices]);


    // ── Load models on mount ───────────────────────────
    useEffect(() => {
        async function load() {
            setModelsLoading(true);
            setModelsError(null);
            try {
                const data = await getCRNNModels();
                setModels(data.models || []);
                if (data.models?.length > 0) {
                    setSelectedModel(data.models[0].id);
                }
            } catch (e) {
                setModelsError(e.message);
            } finally {
                setModelsLoading(false);
            }
        }
        load();
    }, []);


    // ── Composite image with bboxes ────────────────────
    useEffect(() => {
        if (!currentImageUrl || currentBoxes.length === 0) {
            setCompositeUrl(null);
            return;
        }

        let cancelled = false;
        const img = new Image();
        img.onerror = () => { if (!cancelled) setCompositeUrl(null); };
        img.onload = () => {
            if (cancelled) return;
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (w === 0 || h === 0) return;

            const offscreen = document.createElement('canvas');
            offscreen.width = w;
            offscreen.height = h;
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);

            const baseLineWidth = Math.max(2, Math.round(Math.max(w, h) / 500));

            for (let i = 0; i < currentBoxes.length; i++) {
                const poly = currentBoxes[i];
                if (!poly || poly.length < 3) continue;

                const isHovered = activeHighlight === i;
                ctx.strokeStyle = isHovered ? '#f97316' : '#06b6d4';
                ctx.fillStyle = isHovered ? 'rgba(249,115,22,0.25)' : 'rgba(6,182,212,0.08)';
                ctx.lineWidth = isHovered ? baseLineWidth * 2 : baseLineWidth;

                ctx.beginPath();
                ctx.moveTo(poly[0][0], poly[0][1]);
                for (let k = 1; k < poly.length; k++) {
                    ctx.lineTo(poly[k][0], poly[k][1]);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            if (!cancelled) setCompositeUrl(offscreen.toDataURL('image/png'));
        };
        img.src = currentImageUrl;
        return () => { cancelled = true; };
    }, [currentImageUrl, currentBoxes, activeHighlight]);

    // Reset on page change
    useEffect(() => {
        setCompositeUrl(null);
        setHoveredBoxIndex(null);
        setHoveredTextIndex(null);
        setError(null);
        setLastTime(null);
    }, [viewingPageIndex]);


    // ── Navigation ─────────────────────────────────────
    const goToPage = useCallback((index) => {
        if (index >= 0 && index < totalPages) setViewingPageIndex(index);
    }, [totalPages]);


    // ── Recognize current page ─────────────────────────
    const handleRecognize = useCallback(async () => {
        if (!selectedModel || currentBoxes.length === 0 || processing) return;
        setProcessing(true);
        setError(null);

        try {
            const result = await runCRNNRecognition(currentImageUrl, currentBoxes, selectedModel);
            if (result.success) {
                setRecognizedByPage(prev => ({ ...prev, [currentPageNum]: result.results }));
                setLastDevice(result.device);
                setLastTime(result.processing_time_ms);
            } else {
                setError(result.error || 'Recognition failed');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setProcessing(false);
        }
    }, [selectedModel, currentBoxes, currentImageUrl, currentPageNum, processing]);


    // ── Recognize all pages ────────────────────────────
    const handleRecognizeAll = useCallback(async () => {
        if (!selectedModel || processingAll) return;
        setProcessingAll(true);
        cancelRef.current = false;
        setError(null);

        try {
            for (let i = 0; i < availablePages.length; i++) {
                if (cancelRef.current) break;
                const pageNum = availablePages[i];
                if (pageNum in recognizedByPage) continue;

                const boxes = detectedBoxes?.[pageNum] || [];
                if (boxes.length === 0) continue;

                setProcessAllProgress({ current: i + 1, total: availablePages.length });
                const imageUrl = getImageUrl(pageNum);
                if (!imageUrl) continue;

                const result = await runCRNNRecognition(imageUrl, boxes, selectedModel);
                if (result.success) {
                    setRecognizedByPage(prev => ({ ...prev, [pageNum]: result.results }));
                    setLastDevice(result.device);
                } else {
                    setError(`Page ${pageNum}: ${result.error}`);
                    break;
                }
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setProcessingAll(false);
            setProcessAllProgress(null);
        }
    }, [selectedModel, processingAll, availablePages, recognizedByPage, detectedBoxes, getImageUrl]);


    // ── Export ──────────────────────────────────────────
    const handleExport = useCallback((format) => {
        if (recognizedCount === 0) return;
        setExporting(format);

        // Build page-wise results
        const resultsByPage = {};
        for (const [pageNum, results] of Object.entries(recognizedByPage)) {
            const boxes = detectedBoxes?.[pageNum] || [];
            // Sort by top-to-bottom
            const indices = boxes
                .map((poly, idx) => {
                    const byY = [...poly].sort((a, b) => a[1] - b[1]);
                    return { idx, y: (byY[0][1] + byY[1][1]) / 2 };
                })
                .sort((a, b) => a.y - b.y)
                .map(item => item.idx);

            const byIndex = {};
            results.forEach(r => { byIndex[r.box_index] = r.text; });
            resultsByPage[pageNum] = indices.map(i => byIndex[i] ?? '');
        }

        let blob;
        if (format === 'json') {
            blob = exportCRNNResultsAsJSON(resultsByPage);
        } else {
            blob = exportCRNNResultsAsText(resultsByPage);
        }
        downloadBlob(blob, `crnn_ocr_${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'txt'}`);
        setExporting(null);
    }, [recognizedCount, recognizedByPage, detectedBoxes]);


    // ═══════════════════════════════════════════════════════
    // LEFT SIDEBAR
    // ═══════════════════════════════════════════════════════
    const leftSidebar = (
        <div className="h-full overflow-y-auto space-y-2 pr-0.5 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
            {/* Config Card */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm">
                <div className="px-3 py-2 bg-gradient-to-r from-cyan-50/80 to-white border-b border-gray-100">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <Cpu size={16} className="text-cyan-600" />
                        CRNN Recognition
                    </h3>
                </div>
                <div className="p-3 space-y-3">
                    {/* Device Info */}
                    {lastDevice && (
                        <div className="flex items-start gap-2 px-2.5 py-2 bg-cyan-50 rounded-lg border border-cyan-200 text-xs text-cyan-700">
                            <Monitor size={14} className="shrink-0 mt-0.5 text-cyan-500" />
                            <span>Running on <strong>{lastDevice.toUpperCase()}</strong></span>
                        </div>
                    )}

                    {/* Model Selector */}
                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                            CRNN Model
                        </label>
                        {modelsLoading ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                                <Loader2 size={14} className="animate-spin" /> Loading models…
                            </div>
                        ) : modelsError ? (
                            <div className="text-xs text-red-500 py-2">{modelsError}</div>
                        ) : models.length === 0 ? (
                            <div className="text-xs text-amber-600 py-2">No models found in RenAIssanceExperimental/</div>
                        ) : (
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                disabled={processing || processingAll}
                                className="w-full appearance-none px-2.5 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-700 font-medium border border-gray-200 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-200 outline-none cursor-pointer disabled:opacity-50"
                            >
                                {models.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* No API Key Info */}
                    <div className="flex items-start gap-2 px-2.5 py-2 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-700">
                        <Info size={14} className="shrink-0 mt-0.5 text-emerald-500" />
                        <span>Local model — <strong>no API key</strong> required</span>
                    </div>

                    {/* Run OCR Button */}
                    <button
                        onClick={handleRecognize}
                        disabled={processing || processingAll || !selectedModel || currentBoxes.length === 0}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-white transition-all duration-200 ${processing || processingAll || !selectedModel || currentBoxes.length === 0
                            ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-cyan-500 to-teal-600 hover:from-cyan-600 hover:to-teal-700 shadow-md hover:shadow-lg active:scale-[0.98]'
                            }`}
                    >
                        {processing ? (
                            <><Loader2 size={16} className="animate-spin" /> Recognizing…</>
                        ) : (
                            <><Play size={16} /> Run OCR</>
                        )}
                    </button>

                    {/* Run All Pages */}
                    <div className="flex gap-1">
                        <button
                            onClick={handleRecognizeAll}
                            disabled={processing || processingAll || !selectedModel}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${processing || processingAll || !selectedModel
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                                : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                                }`}
                        >
                            {processingAll ? (
                                <><Loader2 size={14} className="animate-spin" /> {processAllProgress?.current}/{processAllProgress?.total}…</>
                            ) : (
                                <><Layers size={14} /> All Pages ({totalPages})</>
                            )}
                        </button>
                        {processingAll && (
                            <button
                                onClick={() => { cancelRef.current = true; }}
                                className="px-2.5 py-2 rounded-lg text-xs font-bold bg-red-100 text-red-600 hover:bg-red-200 border border-red-200 transition-colors"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Stats */}
                    {lastTime !== null && !processing && (
                        <div className="flex items-center justify-between text-xs px-1">
                            <span className="flex items-center gap-1 text-cyan-600 font-semibold">
                                <CheckCircle2 size={13} /> {currentResults.length} lines
                            </span>
                            <span className="text-gray-400">{(lastTime / 1000).toFixed(1)}s</span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-2 py-1.5 border border-red-200">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
                        </div>
                    )}
                </div>
            </div>

            {/* Page Thumbnails */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                <div className="px-3 py-2 bg-gradient-to-r from-cyan-50/80 to-white border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <ImageIcon size={16} className="text-cyan-600" />
                        Pages
                    </h3>
                    <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
                        {recognizedCount}/{totalPages}
                    </span>
                </div>
                <div className="p-2 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                    <div className="grid grid-cols-2 gap-1.5">
                        {availablePages.map((pageNum, idx) => {
                            const isActive = idx === viewingPageIndex;
                            const isRecognized = pageNum in recognizedByPage;
                            const hasBoxes = (detectedBoxes?.[pageNum] || []).length > 0;
                            const imgSrc = getImageUrl(pageNum);

                            return (
                                <button
                                    key={pageNum}
                                    onClick={() => goToPage(idx)}
                                    className={`relative aspect-[3/4] rounded-lg overflow-hidden transition-all duration-200 border-2 group ${isActive
                                        ? 'border-cyan-500 ring-2 ring-cyan-200 shadow-md'
                                        : isRecognized
                                            ? 'border-emerald-300 hover:border-emerald-400'
                                            : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                                        }`}
                                >
                                    {imgSrc ? (
                                        <img src={imgSrc} alt={`Page ${pageNum}`} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                                            <ImageIcon size={20} className="text-gray-300" />
                                        </div>
                                    )}
                                    {isRecognized && !isActive && (
                                        <div className="absolute top-1.5 right-1.5">
                                            <CheckCircle2 size={16} className="text-emerald-500 bg-white rounded-full shadow-sm" />
                                        </div>
                                    )}
                                    {!isRecognized && hasBoxes && !isActive && (
                                        <div className="absolute top-1.5 right-1.5">
                                            <Layers size={14} className="text-cyan-400 bg-white rounded-full shadow-sm p-0.5" />
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent pt-4 pb-1">
                                        <span className="block text-center text-white text-xs font-medium">{pageNum}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );


    // ═══════════════════════════════════════════════════════
    // CENTER PANEL — Image with boxes
    // ═══════════════════════════════════════════════════════
    const displayUrl = compositeUrl || currentImageUrl;

    const centerPanel = (
        <div className="h-full flex flex-col bg-gray-50/50 rounded-xl">
            {/* Page nav header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-white/80 rounded-t-xl">
                <button
                    onClick={() => goToPage(viewingPageIndex - 1)}
                    disabled={viewingPageIndex <= 0}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                >
                    <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-semibold text-gray-700">
                    Page {currentPageNum}
                    <span className="text-gray-400 font-normal ml-1.5">
                        ({viewingPageIndex + 1} / {totalPages})
                    </span>
                </span>
                <button
                    onClick={() => goToPage(viewingPageIndex + 1)}
                    disabled={viewingPageIndex >= totalPages - 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition-colors"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Image */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-4">
                {displayUrl ? (
                    <img
                        ref={imgRef}
                        src={displayUrl}
                        alt={`Page ${currentPageNum}`}
                        className="max-w-full h-auto rounded-lg shadow-sm border border-gray-200"
                        style={{ maxHeight: 'calc(100vh - 180px)' }}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
                        <ImageIcon size={48} strokeWidth={1} />
                        <span className="text-sm">No image available</span>
                    </div>
                )}
            </div>

            {/* Status bar */}
            <div className="px-4 py-2 border-t border-gray-100 bg-white/80 rounded-b-xl flex items-center justify-between text-xs text-gray-500">
                <span>{currentBoxes.length} bounding boxes</span>
                {isCurrentRecognized && (
                    <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <CheckCircle2 size={12} /> Recognized
                    </span>
                )}
            </div>
        </div>
    );


    // ═══════════════════════════════════════════════════════
    // RIGHT PANEL — Recognized text
    // ═══════════════════════════════════════════════════════
    const rightPanel = (
        <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200/80 shadow-sm">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-cyan-50/80 to-white rounded-t-xl">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <FileText size={16} className="text-cyan-600" />
                        Recognized Text
                    </h3>
                    {recognizedCount > 0 && (
                        <div className="flex gap-1">
                            <button
                                onClick={() => handleExport('text')}
                                disabled={exporting === 'text'}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                                title="Export as Text"
                            >
                                <Download size={11} /> TXT
                            </button>
                            <button
                                onClick={() => handleExport('json')}
                                disabled={exporting === 'json'}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                                title="Export as JSON"
                            >
                                <FileJson size={11} /> JSON
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Text lines */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                {sortedResults.length > 0 ? (
                    sortedResults.map((item, sortedIdx) => {
                        const isHighlighted = activeHighlight === item.boxIndex;
                        return (
                            <div
                                key={`${currentPageNum}-${item.boxIndex}`}
                                className={`flex items-start gap-2 px-3 py-2 rounded-lg transition-all duration-150 cursor-default ${isHighlighted
                                    ? 'bg-orange-50 border border-orange-300 shadow-sm'
                                    : 'bg-gray-50/60 border border-transparent hover:bg-cyan-50/50 hover:border-cyan-200'
                                    }`}
                                onMouseEnter={() => setHoveredTextIndex(item.boxIndex)}
                                onMouseLeave={() => setHoveredTextIndex(null)}
                            >
                                <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${isHighlighted
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-cyan-100 text-cyan-700'
                                    }`}>
                                    {sortedIdx + 1}
                                </span>
                                <p className={`text-sm leading-relaxed flex-1 break-words ${item.text ? 'text-gray-800' : 'text-gray-300 italic'
                                    }`}>
                                    {item.text || '(empty)'}
                                </p>
                            </div>
                        );
                    })
                ) : processing ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-16">
                        <Loader2 size={28} className="animate-spin text-cyan-500" />
                        <span className="text-sm">Running CRNN recognition…</span>
                    </div>
                ) : currentBoxes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-16">
                        <Layers size={28} strokeWidth={1} />
                        <span className="text-sm text-center">No bounding boxes detected for this page.<br />Go back to run detection first.</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3 py-16">
                        <Play size={28} strokeWidth={1} />
                        <span className="text-sm text-center">Click <strong>Run OCR</strong> to recognize text<br />from {currentBoxes.length} bounding boxes.</span>
                    </div>
                )}
            </div>

            {/* Footer info */}
            {isCurrentRecognized && (
                <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <span>{sortedResults.length} lines recognized</span>
                    <span>Hover to highlight</span>
                </div>
            )}
        </div>
    );


    // ═══════════════════════════════════════════════════════
    // MAIN LAYOUT
    // ═══════════════════════════════════════════════════════
    return (
        <div className="h-screen w-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-cyan-50/30">
            {/* Top bar */}
            <header className="flex-shrink-0 bg-white/90 backdrop-blur-md border-b border-gray-100/70 shadow-sm z-40">
                <div className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onBack}
                            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-cyan-600 hover:bg-cyan-50 px-3 py-1.5 rounded-lg transition-all"
                        >
                            <ArrowLeft size={16} /> Back
                        </button>
                        <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md shadow-cyan-500/25">
                            <Cpu className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-800 leading-none">CRNN Recognition</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">Local line-level OCR</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="bg-cyan-50 text-cyan-700 px-2.5 py-1 rounded-full font-semibold">
                            {recognizedCount}/{totalPages} pages
                        </span>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1 overflow-hidden p-2">
                <ResizablePanels
                    leftPanel={leftSidebar}
                    centerPanel={centerPanel}
                    rightPanel={rightPanel}
                    defaultLeftWidth={240}
                    defaultRightWidth={340}
                    minLeftWidth={200}
                    minRightWidth={260}
                />
            </main>
        </div>
    );
}
