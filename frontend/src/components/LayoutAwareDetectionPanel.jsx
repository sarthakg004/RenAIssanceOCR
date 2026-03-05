import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    Play,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Layers,
    Image as ImageIcon,
    FileText,
    Lock,
    Info,
    ChevronDown,
    PenLine,
} from 'lucide-react';
import ResizablePanels from './ocr/ResizablePanels';
import BBoxEditor from './BBoxEditor';

const API_BASE = 'http://localhost:8000';

// ─── Layout model options (8) ──────────────────────────────
const LAYOUT_MODELS = [
    { id: 'PP-DocLayout_plus-L', name: 'PP-DocLayout+ Large', desc: 'Best accuracy' },
    { id: 'PP-DocLayout-L', name: 'PP-DocLayout Large', desc: 'High accuracy' },
    { id: 'PP-DocLayout-M', name: 'PP-DocLayout Medium', desc: 'Balanced' },
    { id: 'PP-DocLayout-S', name: 'PP-DocLayout Small', desc: 'Fastest' },
    { id: 'PicoDet-L_layout_17cls', name: 'PicoDet-L 17cls', desc: '17-class layout' },
    { id: 'RT-DETR-H_layout_17cls', name: 'RT-DETR-H 17cls', desc: '17-class, high acc' },
    { id: 'PicoDet-L_layout_3cls', name: 'PicoDet-L 3cls', desc: '3-class layout' },
    { id: 'PicoDet-S_layout_3cls', name: 'PicoDet-S 3cls', desc: '3-class, fastest' },
];

// ─── Detection model options (5) ───────────────────────────
const DETECTION_MODELS = [
    { id: 'PP-OCRv5_server_det', name: 'PP-OCRv5 Server Det', desc: 'High accuracy, slower' },
    { id: 'PP-OCRv5_mobile_det', name: 'PP-OCRv5 Mobile Det', desc: 'Fast, lighter' },
    { id: 'DB', name: 'DBNet', desc: 'Classic, reliable' },
    { id: 'DB++', name: 'DB++', desc: 'Enhanced DBNet' },
    { id: 'EAST', name: 'EAST', desc: 'Efficient text detection' },
    { id: 'SAST', name: 'SAST', desc: 'Segmentation-based' },
];

// ─── Default tuning parameters ─────────────────────────────
const DEFAULT_PARAMS = {
    region_padding: 50,
    layout_expand: 2,
    score_thresh: 0.5,
    upscale_min_h: 60,
    nms_iou_thresh: 0.3,
    gap_multiplier: 2.0,
};

// ─── Parameter definitions for UI controls ─────────────────
const PARAM_DEFS = [
    { key: 'region_padding', label: 'Region Padding', unit: 'px', min: 0, max: 200, step: 5, type: 'int', tooltip: 'Padding around detected regions before OCR' },
    { key: 'layout_expand', label: 'Layout Expand', unit: 'px', min: 0, max: 50, step: 1, type: 'int', tooltip: 'Expand layout bounding boxes before cropping' },
    { key: 'score_thresh', label: 'Score Threshold', unit: '', min: 0.1, max: 1.0, step: 0.05, type: 'float', tooltip: 'Minimum confidence score for text detection' },
    { key: 'upscale_min_h', label: 'Upscale Min H', unit: 'px', min: 20, max: 200, step: 10, type: 'int', tooltip: 'Upscale crops shorter than this height' },
    { key: 'nms_iou_thresh', label: 'NMS IoU Thresh', unit: '', min: 0.1, max: 0.9, step: 0.05, type: 'float', tooltip: 'IoU threshold for non-max suppression' },
    { key: 'gap_multiplier', label: 'Gap Multiplier', unit: '×', min: 0.5, max: 5.0, step: 0.5, type: 'float', tooltip: 'Gap threshold multiplier for line merging' },
];


// ─── Thumbnail Item ─────────────────────────────────────────
function ThumbnailItem({ image, index, isActive, isDetected, onClick, pageLabel, processedSrc }) {
    const imageSrc = processedSrc || image?.processed || image?.original || image?.thumbnail;

    return (
        <button
            onClick={onClick}
            className={`
                relative aspect-[3/4] rounded-lg overflow-hidden transition-all duration-200
                border-2 group
                ${isActive
                    ? 'border-teal-500 ring-2 ring-teal-200 shadow-md'
                    : isDetected
                        ? 'border-emerald-300 hover:border-emerald-400'
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }
            `}
        >
            {imageSrc ? (
                <img src={imageSrc} alt={`Page ${pageLabel}`} className="w-full h-full object-cover" />
            ) : (
                <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
                    <ImageIcon size={20} className="text-gray-300" />
                </div>
            )}

            {isDetected && !isActive && (
                <div className="absolute top-1.5 right-1.5">
                    <CheckCircle2 size={16} className="text-emerald-500 bg-white rounded-full shadow-sm" />
                </div>
            )}

            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent pt-4 pb-1">
                <span className="block text-center text-white text-xs font-medium">{pageLabel}</span>
            </div>
        </button>
    );
}


// ─── Main Component ─────────────────────────────────────────
export default function LayoutAwareDetectionPage({
    pages,
    selectedPages,
    processedImages,
    onBack,
}) {
    // ── Model selection ────────────────────────────────────
    const [selectedDetModel, setSelectedDetModel] = useState('PP-OCRv5_server_det');
    const [selectedLayoutModel, setSelectedLayoutModel] = useState('PP-DocLayout_plus-L');

    // ── Tuning parameters ──────────────────────────────────
    const [tuningParams, setTuningParams] = useState({ ...DEFAULT_PARAMS });
    const [showAdvanced, setShowAdvanced] = useState(false);

    // ── UI state ───────────────────────────────────────────
    const [viewingPageIndex, setViewingPageIndex] = useState(0);
    const [loading, setLoading] = useState(false);
    const [detectedPages, setDetectedPages] = useState({});
    const [error, setError] = useState(null);
    const [warning, setWarning] = useState(null);
    const [processingTime, setProcessingTime] = useState(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [compositeUrl, setCompositeUrl] = useState(null);

    // ── BBox editor state ──────────────────────────────────
    const [showBBoxEditor, setShowBBoxEditor] = useState(false);
    // Track which pages have been manually edited (for thumbnail indicator)
    const [editedPages, setEditedPages] = useState(new Set());

    // ── Process All Pages state ────────────────────────────
    const [processingAll, setProcessingAll] = useState(false);
    const [processAllProgress, setProcessAllProgress] = useState(null);

    const imgRef = useRef(null);

    // ── Derived data ───────────────────────────────────────
    const availablePages = useMemo(() => selectedPages || [], [selectedPages]);
    const currentPageNum = availablePages[viewingPageIndex] || 1;
    const totalPages = availablePages.length;

    const currentLines = detectedPages[currentPageNum] || [];
    const isCurrentDetected = currentPageNum in detectedPages;
    const detectedCount = Object.keys(detectedPages).length;

    const getImageUrl = useCallback((pageNum) => {
        if (processedImages?.[pageNum]) return processedImages[pageNum];
        const idx = pageNum - 1;
        if (pages?.[idx]) return pages[idx].thumbnail;
        return null;
    }, [pages, processedImages]);

    const currentImageUrl = getImageUrl(currentPageNum);

    // ── Helper: update one tuning param ────────────────────
    const updateParam = useCallback((key, value) => {
        setTuningParams(prev => ({ ...prev, [key]: value }));
    }, []);

    // ── Composite image with bboxes baked in ───────────────
    useEffect(() => {
        if (!currentImageUrl || currentLines.length === 0) {
            setCompositeUrl(null);
            return;
        }

        let cancelled = false;
        const img = new Image();

        img.onerror = (err) => {
            console.error('[composite] Image load failed:', err);
            if (!cancelled) setCompositeUrl(null);
        };

        img.onload = () => {
            if (cancelled) return;
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (w === 0 || h === 0) {
                console.warn('[composite] Image has zero dimensions');
                return;
            }
            console.log('[composite] building', w, 'x', h, 'with', currentLines.length, 'boxes');

            try {
                const offscreen = document.createElement('canvas');
                offscreen.width = w;
                offscreen.height = h;
                const ctx = offscreen.getContext('2d');

                // Draw original image
                ctx.drawImage(img, 0, 0, w, h);

                // Draw bounding boxes
                ctx.strokeStyle = '#22c55e';
                ctx.lineWidth = Math.max(2, Math.round(Math.max(w, h) / 500));
                ctx.lineJoin = 'round';
                ctx.fillStyle = 'rgba(34,197,94,0.08)';

                let drawn = 0;
                for (const poly of currentLines) {
                    if (!poly || poly.length < 3) continue;
                    ctx.beginPath();
                    ctx.moveTo(poly[0][0], poly[0][1]);
                    for (let k = 1; k < poly.length; k++) {
                        ctx.lineTo(poly[k][0], poly[k][1]);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    drawn++;
                }

                const dataUrl = offscreen.toDataURL('image/png');
                console.log(`[composite] baked ${drawn} boxes, dataUrl length: ${dataUrl.length}`);

                if (!cancelled) {
                    setCompositeUrl(dataUrl);
                }
            } catch (err) {
                console.error('[composite] Canvas compositing failed:', err);
                if (!cancelled) setCompositeUrl(null);
            }
        };

        img.src = currentImageUrl;

        return () => { cancelled = true; };
    }, [currentImageUrl, currentLines]);

    // Reset image display state on page change only
    useEffect(() => {
        setImageLoaded(false);
        setCompositeUrl(null);
    }, [viewingPageIndex]);

    const displayUrl = compositeUrl || currentImageUrl;

    // ── Navigation ─────────────────────────────────────────
    const goToPage = useCallback((index) => {
        if (index >= 0 && index < totalPages) {
            setViewingPageIndex(index);
            setError(null);
            setWarning(null);
            setProcessingTime(null);
        }
    }, [totalPages]);

    // ── Helper: convert image URL to blob ──────────────────
    const urlToBlob = useCallback(async (url) => {
        if (url.startsWith('data:')) {
            const [header, b64] = url.split(',');
            const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return new Blob([u8], { type: mime });
        }
        const r = await fetch(url);
        return r.blob();
    }, []);

    // ── Build FormData with all params ─────────────────────
    const buildFormData = useCallback((blob) => {
        const fd = new FormData();
        fd.append('image', blob, 'page.png');
        fd.append('use_gpu', 'true');
        fd.append('layout_model', selectedLayoutModel);
        fd.append('det_model', selectedDetModel);
        fd.append('region_padding', String(tuningParams.region_padding));
        fd.append('layout_expand', String(tuningParams.layout_expand));
        fd.append('score_thresh', String(tuningParams.score_thresh));
        fd.append('upscale_min_h', String(tuningParams.upscale_min_h));
        fd.append('nms_iou_thresh', String(tuningParams.nms_iou_thresh));
        fd.append('gap_multiplier', String(tuningParams.gap_multiplier));
        return fd;
    }, [selectedLayoutModel, selectedDetModel, tuningParams]);

    // ── Single page detection ──────────────────────────────
    const handleDetect = async () => {
        if (!currentImageUrl) return;
        setLoading(true);
        setError(null);
        setWarning(null);
        setProcessingTime(null);

        try {
            const blob = await urlToBlob(currentImageUrl);
            console.log('[handleDetect] blob size', blob.size, 'type', blob.type);

            const formData = buildFormData(blob);

            const response = await fetch(`${API_BASE}/api/detect/layout-aware-lines`, {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            console.log('[handleDetect] response', JSON.stringify(data).slice(0, 500));

            if (data.error) {
                setError(data.error);
            } else {
                setDetectedPages(prev => ({ ...prev, [currentPageNum]: data.lines || [] }));
                setProcessingTime(data.processing_time_ms);
                if (data.warning) setWarning(data.warning);
                console.log('[handleDetect] stored', (data.lines || []).length, 'lines for page', currentPageNum);
            }
        } catch (err) {
            console.error('[handleDetect] error', err);
            setError(`Request failed: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // ── Process All Pages (memory-efficient sequential loop)
    const handleDetectAll = async () => {
        if (processingAll || availablePages.length === 0) return;
        setProcessingAll(true);
        setError(null);
        setWarning(null);

        const total = availablePages.length;
        let lastWarning = null;
        // Snapshot already-detected pages to avoid stale closure
        const alreadyDetected = new Set(Object.keys(detectedPages).map(Number));

        try {
            for (let i = 0; i < total; i++) {
                const pageNum = availablePages[i];
                setProcessAllProgress({ current: i + 1, total });
                setViewingPageIndex(i);

                // Skip already detected pages
                if (alreadyDetected.has(pageNum)) continue;

                const imageUrl = getImageUrl(pageNum);
                if (!imageUrl) continue;

                const blob = await urlToBlob(imageUrl);
                const formData = buildFormData(blob);

                const response = await fetch(`${API_BASE}/api/detect/layout-aware-lines`, {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();

                if (data.error) {
                    setError(`Page ${pageNum}: ${data.error}`);
                    break;
                }

                setDetectedPages(prev => ({ ...prev, [pageNum]: data.lines || [] }));
                alreadyDetected.add(pageNum);
                if (data.warning) lastWarning = data.warning;

                // Small delay between pages to allow GC + UI updates
                await new Promise(r => setTimeout(r, 100));
            }

            if (lastWarning) setWarning(lastWarning);
        } catch (err) {
            console.error('[handleDetectAll] error', err);
            setError(`Batch processing failed: ${err.message}`);
        } finally {
            setProcessingAll(false);
            setProcessAllProgress(null);
        }
    };

    const isAnyLoading = loading || processingAll;

    // ════════════════════════════════════════════════════════
    // LEFT SIDEBAR
    // ════════════════════════════════════════════════════════
    const leftSidebar = (
        <>
            {/* Parameters Card */}
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm shrink-0">
                <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 to-white border-b border-gray-100">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <Layers size={16} className="text-teal-600" />
                        Parameters
                    </h3>
                </div>
                <div className="p-3 space-y-3">
                    {/* GPU Required Info */}
                    <div className="flex items-start gap-2 px-2.5 py-2 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-700">
                        <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
                        <div>
                            <span className="font-semibold">GPU Required</span>
                            <p className="text-blue-600 mt-0.5">Models require GPU for stable inference.</p>
                        </div>
                    </div>

                    {/* Layout Model Dropdown */}
                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Layout Model</label>
                        <div className="relative">
                            <select
                                value={selectedLayoutModel}
                                onChange={(e) => setSelectedLayoutModel(e.target.value)}
                                disabled={isAnyLoading}
                                className="w-full appearance-none px-2.5 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-700 font-medium border border-gray-200 focus:border-teal-400 focus:ring-1 focus:ring-teal-200 outline-none pr-7 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {LAYOUT_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Detection Model Dropdown */}
                    <div>
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Detection Model</label>
                        <div className="relative">
                            <select
                                value={selectedDetModel}
                                onChange={(e) => setSelectedDetModel(e.target.value)}
                                disabled={isAnyLoading}
                                className="w-full appearance-none px-2.5 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-700 font-medium border border-gray-200 focus:border-teal-400 focus:ring-1 focus:ring-teal-200 outline-none pr-7 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {DETECTION_MODELS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
                                ))}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Advanced Parameters Toggle */}
                    <button
                        onClick={() => setShowAdvanced(v => !v)}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 transition-colors"
                    >
                        <span className="flex items-center gap-1.5">
                            <Info size={13} className="text-gray-500" />
                            Advanced Parameters
                        </span>
                        <ChevronDown size={12} className={`text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Advanced Parameters Grid */}
                    {showAdvanced && (
                        <div className="space-y-2 pt-1 pb-1 px-1 bg-gray-50/50 rounded-lg border border-gray-100">
                            {PARAM_DEFS.map(p => (
                                <div key={p.key} className="flex items-center gap-2 px-1">
                                    <label
                                        className="text-[11px] text-gray-500 font-medium w-[90px] shrink-0 truncate cursor-help"
                                        title={p.tooltip}
                                    >
                                        {p.label}
                                    </label>
                                    <input
                                        type="number"
                                        value={tuningParams[p.key]}
                                        onChange={(e) => {
                                            const v = p.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                                            if (!isNaN(v)) updateParam(p.key, v);
                                        }}
                                        min={p.min}
                                        max={p.max}
                                        step={p.step}
                                        disabled={isAnyLoading}
                                        className="flex-1 min-w-0 px-2 py-1 bg-white rounded border border-gray-200 text-xs text-gray-700 font-mono focus:border-teal-400 focus:ring-1 focus:ring-teal-200 outline-none disabled:opacity-50"
                                    />
                                    {p.unit && (
                                        <span className="text-[10px] text-gray-400 w-5 shrink-0">{p.unit}</span>
                                    )}
                                </div>
                            ))}
                            <button
                                onClick={() => setTuningParams({ ...DEFAULT_PARAMS })}
                                disabled={isAnyLoading}
                                className="text-[11px] text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 disabled:opacity-50"
                            >
                                Reset to defaults
                            </button>
                        </div>
                    )}

                    {/* Detect This Page Button */}
                    <button
                        onClick={handleDetect}
                        disabled={isAnyLoading || !currentImageUrl}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-white transition-all duration-200 ${isAnyLoading || !currentImageUrl
                            ? 'bg-gray-300 cursor-not-allowed'
                            : 'bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 shadow-md hover:shadow-lg active:scale-[0.98]'
                            }`}
                    >
                        {loading ? (
                            <><Loader2 size={16} className="animate-spin" /> Detecting…</>
                        ) : (
                            <><Play size={16} /> Detect This Page</>
                        )}
                    </button>

                    {/* Process All Pages Button */}
                    <button
                        onClick={handleDetectAll}
                        disabled={isAnyLoading || availablePages.length === 0}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${isAnyLoading || availablePages.length === 0
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                            : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                            }`}
                    >
                        {processingAll ? (
                            <><Loader2 size={14} className="animate-spin" /> Processing {processAllProgress?.current}/{processAllProgress?.total}…</>
                        ) : (
                            <><Layers size={14} /> Process All Pages ({totalPages})</>
                        )}
                    </button>

                    {/* Edit All Boxes Button */}
                    <button
                        onClick={() => setShowBBoxEditor(true)}
                        disabled={isAnyLoading || detectedCount === 0}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${isAnyLoading || detectedCount === 0
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                            : 'bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                            }`}
                    >
                        <PenLine size={14} /> Edit All Boxes ({detectedCount})
                    </button>

                    {/* Result stats */}
                    {processingTime !== null && !isAnyLoading && (
                        <div className="flex items-center justify-between text-xs px-1">
                            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                                <CheckCircle2 size={13} /> {currentLines.length} lines
                            </span>
                            <span className="text-gray-400">{(processingTime / 1000).toFixed(1)}s</span>
                        </div>
                    )}

                    {warning && (
                        <div className="flex items-start gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5 border border-amber-200">
                            <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {warning}
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
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
                <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <ImageIcon size={16} className="text-teal-600" />
                        Pages
                    </h3>
                    <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
                        {detectedCount}/{totalPages}
                    </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 min-h-0">
                    <div className="grid grid-cols-2 gap-1.5">
                        {availablePages.map((pageNum, idx) => (
                            <div key={pageNum} className="relative">
                                <ThumbnailItem
                                    image={pages?.[pageNum - 1] || null}
                                    processedSrc={processedImages?.[pageNum] || null}
                                    index={idx}
                                    isActive={idx === viewingPageIndex}
                                    isDetected={pageNum in detectedPages}
                                    onClick={() => goToPage(idx)}
                                    pageLabel={pageNum}
                                />
                                {/* Edited indicator badge */}
                                {editedPages.has(pageNum) && (
                                    <span className="absolute top-1 left-1 px-1 py-0.5 bg-amber-500 text-white text-[9px] font-bold rounded shadow-sm leading-none">
                                        edited
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );

    // ── BBox editor: build pages array from all detected pages ─────────
    const bboxEditorPages = useMemo(() =>
        availablePages
            .filter(pageNum => pageNum in detectedPages)
            .map(pageNum => ({
                pageNumber: pageNum,
                imageSrc: getImageUrl(pageNum),
                polygons: detectedPages[pageNum] || [],
            })),
        [availablePages, detectedPages, getImageUrl]
    );

    // ── BBox editor save handler — receives all modified pages ──────────
    const handleBBoxSave = useCallback((results) => {
        // results: { [pageNumber]: Array<polygon> }
        setDetectedPages(prev => ({ ...prev, ...results }));
        setEditedPages(prev => {
            const next = new Set(prev);
            Object.keys(results).forEach(k => next.add(Number(k)));
            return next;
        });
        setShowBBoxEditor(false);
    }, []);

    // ════════════════════════════════════════════════════════
    // CENTER PANEL — Image Preview
    // ════════════════════════════════════════════════════════
    const centerPanel = (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden flex flex-col h-full relative">
            {/* Navigation header */}
            <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => goToPage(viewingPageIndex - 1)}
                        disabled={viewingPageIndex === 0}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <span className="font-semibold text-gray-800 text-sm min-w-[80px] text-center">
                        {currentPageNum} / {totalPages}
                    </span>
                    <button
                        onClick={() => goToPage(viewingPageIndex + 1)}
                        disabled={viewingPageIndex >= totalPages - 1}
                        className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>

                {/* Status — simplified, no per-page edit button here anymore */}
                <div className="flex items-center gap-2">
                    {isAnyLoading && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-600 text-xs font-medium rounded-full animate-pulse">
                            <Loader2 size={12} className="animate-spin" />
                            {processingAll ? `${processAllProgress?.current}/${processAllProgress?.total}` : 'Detecting…'}
                        </span>
                    )}
                    {isCurrentDetected && !isAnyLoading && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-full">
                            <CheckCircle2 size={12} /> {currentLines.length} lines
                            {editedPages.has(currentPageNum) && (
                                <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-semibold">edited</span>
                            )}
                        </span>
                    )}
                </div>
            </div>

            {/* Scrollable image container — actual size, scroll if too large */}
            <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-100 to-gray-50 min-h-0">
                {!currentImageUrl && (
                    <div className="h-full flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <ImageIcon size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No image selected</p>
                        </div>
                    </div>
                )}

                {currentImageUrl && (
                    <div className="p-4 flex items-center justify-center min-h-full">
                        <img
                            ref={imgRef}
                            src={displayUrl}
                            alt={`Page ${currentPageNum}`}
                            className={`rounded-lg shadow-xl select-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                            onLoad={() => setImageLoaded(true)}
                            draggable={false}
                            style={{ display: 'block', transition: 'opacity 0.2s ease-out' }}
                        />
                    </div>
                )}
            </div>

            {/* Loading overlay */}
            {isAnyLoading && (
                <div className="absolute inset-0 bg-teal-500/10 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
                    <div className="bg-white rounded-xl shadow-lg px-5 py-3 text-center pointer-events-auto">
                        <Loader2 size={28} className="animate-spin text-teal-600 mx-auto mb-2" />
                        <p className="text-sm font-medium text-gray-700">
                            {processingAll
                                ? `Processing page ${processAllProgress?.current} of ${processAllProgress?.total}…`
                                : 'Detecting lines…'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );

    // ════════════════════════════════════════════════════════
    // RIGHT PANEL — Transcript (Coming Soon)
    // ════════════════════════════════════════════════════════
    const rightPanel = (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden flex flex-col h-full">
            {/* Header */}
            <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 via-white to-emerald-50/50 border-b border-gray-100/80 flex items-center justify-between shrink-0">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                    <div className="p-1 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg text-white">
                        <FileText size={12} />
                    </div>
                    <span>Transcript</span>
                    {isCurrentDetected && (
                        <span className="text-xs text-gray-400 font-normal">#{currentPageNum}</span>
                    )}
                </h3>
            </div>

            {/* OCR Model selector */}
            <div className="px-3 py-3 border-b border-gray-100 shrink-0">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">OCR Model</label>
                <div className="relative">
                    <select
                        disabled
                        className="w-full appearance-none px-2.5 py-1.5 bg-gray-50 rounded-lg text-xs text-gray-400 font-medium border border-gray-200 outline-none pr-7 cursor-not-allowed"
                    >
                        <option>PP-OCRv5_server_rec</option>
                        <option>PP-OCRv5_mobile_rec</option>
                        <option>PP-OCRv4_server_rec</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                </div>
                <button
                    disabled
                    className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-gray-100 text-gray-400 cursor-not-allowed"
                >
                    <Play size={14} />
                    Generate Transcript
                </button>
            </div>

            {/* Coming Soon placeholder */}
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 bg-gradient-to-br from-gray-50/50 to-gray-100/30 min-h-0">
                <div className="p-3 bg-gradient-to-br from-gray-100 to-gray-50 rounded-xl mb-3">
                    <Lock size={36} className="opacity-40" />
                </div>
                <p className="font-semibold text-sm">Coming Soon</p>
                <p className="text-xs mt-1 text-center px-4">
                    OCR recognition models will be integrated here to generate transcripts from detected lines.
                </p>
            </div>

            {/* Footer */}
            <div className="px-3 py-2 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between text-xs text-gray-400 shrink-0">
                <span>Detection: {isCurrentDetected ? `${currentLines.length} lines` : 'Pending'}</span>
                <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-semibold text-[10px]">
                    <Lock size={10} /> Preview
                </span>
            </div>
        </div>
    );


    // ════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════
    return (
        <div className="h-full w-full flex flex-col bg-gradient-to-br from-slate-50 via-teal-50/20 to-emerald-50/30 overflow-hidden">

            {/* BBox Editor Modal */}
            {showBBoxEditor && bboxEditorPages.length > 0 && (
                <BBoxEditor
                    pages={bboxEditorPages}
                    onSave={handleBBoxSave}
                    onCancel={() => setShowBBoxEditor(false)}
                />
            )}

            {/* Header */}
            <header className="h-12 bg-white/95 backdrop-blur-md border-b border-gray-200 shrink-0 relative z-10">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <button onClick={onBack} className="flex items-center gap-1 text-gray-600 hover:text-teal-600 hover:bg-teal-50 px-2 py-1 rounded-lg transition-all text-sm">
                        <ChevronLeft size={16} />
                        <span className="font-medium hidden sm:inline">Back</span>
                    </button>
                    <div className="h-4 w-px bg-gray-200 hidden sm:block" />
                    <div className="flex items-center gap-1.5 hidden sm:flex">
                        <div className="p-1 bg-gradient-to-br from-teal-500 to-emerald-600 rounded text-white">
                            <Layers size={14} />
                        </div>
                        <span className="text-sm font-bold text-gray-700">Layout-Aware Detection</span>
                    </div>
                </div>

                {/* Center progress */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="flex items-center gap-3 px-4 py-1.5 bg-gradient-to-r from-teal-50 via-white to-emerald-50 rounded-full border border-teal-100/60 shadow-sm">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${detectedCount === totalPages && totalPages > 0
                            ? 'bg-gradient-to-br from-emerald-500 to-green-600'
                            : 'bg-gradient-to-br from-teal-500 to-emerald-600'
                            }`}>
                            <Layers size={12} />
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-40 h-1.5 bg-teal-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-teal-500 to-emerald-500"
                                    style={{ width: `${totalPages > 0 ? (detectedCount / totalPages) * 100 : 0}%` }} />
                            </div>
                            <span className="text-xs font-bold text-teal-700">{detectedCount}/{totalPages}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main 3-column layout */}
            <main className="flex-1 min-h-0 p-2 overflow-hidden">
                <div className="h-full hidden lg:block">
                    <ResizablePanels
                        leftPanel={leftSidebar}
                        centerPanel={centerPanel}
                        rightPanel={rightPanel}
                        defaultLeftWidth={280}
                        defaultRightWidth={300}
                        minLeftWidth={240}
                        maxLeftWidth={420}
                        minRightWidth={240}
                        maxRightWidth={450}
                        minCenterWidth={350}
                    />
                </div>
                {/* Mobile fallback */}
                <div className="h-full lg:hidden flex flex-col gap-2 overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-hidden">
                        {centerPanel}
                    </div>
                </div>
            </main>
        </div>
    );
}
