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
    Info,
    ChevronDown,
    PenLine,
    ArrowUp,
    ArrowDown,
    Split,
    Link2,
    Sparkles,
    Cpu,
    Download,
    FileText as FileTextIcon,
    FileJson,
    FileType,
    RefreshCw,
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

function shortPageLabel(pageKey) {
    return String(pageKey).replace('_left', 'L').replace('_right', 'R');
}

function getPageBaseNumber(pageKey) {
    const value = String(pageKey).toLowerCase();
    const match = value.match(/(\d+)/);
    return match ? Number(match[1]) : null;
}

function getPageSide(pageKey) {
    const value = String(pageKey).toLowerCase();
    if (value.includes('left') || value.endsWith('l')) return 'left';
    if (value.includes('right') || value.endsWith('r')) return 'right';
    return null;
}

function resolveTranscriptKey(transcript, pageKey) {
    if (!transcript) return null;
    const keys = Object.keys(transcript);
    const asString = String(pageKey);
    if (asString in transcript) return asString;

    const targetNum = getPageBaseNumber(asString);
    const targetSide = getPageSide(asString);

    if (targetNum == null) return null;

    const exactSideKey = keys.find((k) => {
        const keyNum = getPageBaseNumber(k);
        const keySide = getPageSide(k);
        return keyNum === targetNum && keySide === targetSide;
    });
    if (exactSideKey) return exactSideKey;

    return keys.find((k) => getPageBaseNumber(k) === targetNum) || null;
}


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
    transcript = {},
    onBack,
    datasetMode = false,
    onDatasetNext,
    onNext = null,
    // Persistence props — restored when navigating back from export
    initialDetectedPages = {},
    initialAlignmentByPage = {},
    onStateChange,
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
    const [detectedPages, setDetectedPages] = useState(() => initialDetectedPages);
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
    const cancelProcessingRef = useRef(false);

    // ── Alignment state (dataset mode) ─────────────────────
    const [alignmentByPage, setAlignmentByPage] = useState(() => initialAlignmentByPage);

    // ── Hover state for bidirectional highlight ─────────────
    const [hoveredBoxIndex, setHoveredBoxIndex] = useState(null);
    const [hoveredLineIndex, setHoveredLineIndex] = useState(null);

    const imgRef = useRef(null);
    // Tracks which pages have already been seeded so the seed effect never
    // overwrites alignment that already exists (avoids stale-closure re-fire).
    const seededPages = useRef(new Set());

    // ── Persist detection + alignment state to parent whenever it changes ──
    useEffect(() => {
        if (onStateChange) onStateChange({ pages: detectedPages, alignment: alignmentByPage });
    }, [detectedPages, alignmentByPage]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derived data ───────────────────────────────────────
    const availablePages = useMemo(() => selectedPages || [], [selectedPages]);
    const currentPageNum = availablePages[viewingPageIndex] || 1;
    const totalPages = availablePages.length;

    const currentLines = detectedPages[currentPageNum] || [];
    const isCurrentDetected = currentPageNum in detectedPages;
    const detectedCount = Object.keys(detectedPages).length;
    const transcriptKeyForCurrentPage = resolveTranscriptKey(transcript, currentPageNum);

    const currentAlignmentRows = alignmentByPage[currentPageNum] || [];

    // Sort detected boxes top → bottom using the midpoint-Y of the top edge.
    // For rotated boxes the top edge midpoint is more stable than the single min-Y corner.
    // Algorithm: sort the 4 polygon vertices by Y, take the two with smallest Y,
    // their average Y is the sort key.
    const sortedBoxIndices = useMemo(() => {
        return currentLines
            .map((poly, idx) => {
                const byY = [...poly].sort((a, b) => a[1] - b[1]);
                const topMidY = (byY[0][1] + byY[1][1]) / 2;
                return { idx, topMidY };
            })
            .sort((a, b) => a.topMidY - b.topMidY)
            .map(item => item.idx);
    }, [currentLines]);

    const getImageUrl = useCallback((pageNum) => {
        if (processedImages?.[pageNum]) return processedImages[pageNum];
        // Use find-by-pageNumber so split pages ("1_left", "1_right") resolve correctly
        const page = pages?.find(p => p.pageNumber === pageNum);
        return page?.thumbnail || null;
    }, [pages, processedImages]);

    const currentImageUrl = getImageUrl(currentPageNum);

    useEffect(() => {
        if (!isCurrentDetected) return;
        // Only seed once per page — skip if already seeded or already has rows
        // (handleBBoxSave manages alignment after that point).
        if (seededPages.current.has(currentPageNum)) return;

        const transcriptKey = resolveTranscriptKey(transcript, currentPageNum);
        const transcriptLines = transcriptKey ? (transcript[transcriptKey] || []) : [];

        // One row per transcript line; boxIndex = original polygon index of the
        // corresponding sorted box (null if there are fewer boxes than lines).
        const initialRows = transcriptLines.map((line, index) => ({
            id: `${currentPageNum}-${index}-${Date.now()}`,
            text: line,
            boxIndex: index < sortedBoxIndices.length ? sortedBoxIndices[index] : null,
        }));

        seededPages.current.add(currentPageNum);
        setAlignmentByPage((prev) => ({
            ...prev,
            [currentPageNum]: initialRows,
        }));
    }, [isCurrentDetected, currentPageNum, sortedBoxIndices, transcript]);

    // Reset hover state when navigating pages
    useEffect(() => {
        setHoveredBoxIndex(null);
        setHoveredLineIndex(null);
    }, [viewingPageIndex]);

    const updateAlignmentRows = useCallback((pageNum, updater) => {
        setAlignmentByPage((prev) => {
            const oldRows = prev[pageNum] || [];
            const nextRows = updater(oldRows);
            return { ...prev, [pageNum]: nextRows };
        });
    }, []);

    const updateLineText = useCallback((lineIndex, value) => {
        updateAlignmentRows(currentPageNum, (rows) => rows.map((row, idx) => (
            idx === lineIndex ? { ...row, text: value } : row
        )));
    }, [currentPageNum, updateAlignmentRows]);

    // Re-pair existing text lines with the current sorted box order.
    // This is useful after manually editing / moving boxes in the BBox editor
    // or after any structural change to the detected boxes.
    const realignCurrentPage = useCallback(() => {
        setAlignmentByPage(prev => {
            const existingRows = prev[currentPageNum] || [];
            const texts = existingRows.map(r => r.text);
            const newRows = texts.map((text, i) => ({
                id: `${currentPageNum}-${i}-${Date.now()}`,
                text,
                boxIndex: i < sortedBoxIndices.length ? sortedBoxIndices[i] : null,
            }));
            return { ...prev, [currentPageNum]: newRows };
        });
    }, [currentPageNum, sortedBoxIndices]);

    const assignBoxToLine = useCallback((lineIndex, boxIndexValue) => {
        const parsed = boxIndexValue === '' ? null : Number(boxIndexValue);
        updateAlignmentRows(currentPageNum, (rows) => rows.map((row, idx) => (
            idx === lineIndex ? { ...row, boxIndex: Number.isNaN(parsed) ? null : parsed } : row
        )));
    }, [currentPageNum, updateAlignmentRows]);

    const moveLine = useCallback((lineIndex, direction) => {
        updateAlignmentRows(currentPageNum, (rows) => {
            const targetIndex = lineIndex + direction;
            if (targetIndex < 0 || targetIndex >= rows.length) return rows;
            const next = [...rows];
            const temp = next[lineIndex];
            next[lineIndex] = next[targetIndex];
            next[targetIndex] = temp;
            return next;
        });
    }, [currentPageNum, updateAlignmentRows]);

    const mergeLineWithNext = useCallback((lineIndex) => {
        updateAlignmentRows(currentPageNum, (rows) => {
            if (lineIndex < 0 || lineIndex >= rows.length - 1) return rows;
            const current = rows[lineIndex];
            const next = rows[lineIndex + 1];
            const merged = {
                ...current,
                text: `${current.text} ${next.text}`.trim(),
                boxIndex: current.boxIndex ?? next.boxIndex ?? null,
            };
            return [...rows.slice(0, lineIndex), merged, ...rows.slice(lineIndex + 2)];
        });
    }, [currentPageNum, updateAlignmentRows]);

    const splitLine = useCallback((lineIndex) => {
        updateAlignmentRows(currentPageNum, (rows) => {
            if (lineIndex < 0 || lineIndex >= rows.length) return rows;
            const row = rows[lineIndex];
            const words = row.text.split(/\s+/).filter(Boolean);
            if (words.length < 2) return rows;

            const splitAt = Math.ceil(words.length / 2);
            const first = words.slice(0, splitAt).join(' ');
            const second = words.slice(splitAt).join(' ');

            const firstRow = { ...row, text: first };
            const secondRow = {
                id: `${row.id}-split-${Date.now()}`,
                text: second,
                boxIndex: null,
            };

            return [...rows.slice(0, lineIndex), firstRow, secondRow, ...rows.slice(lineIndex + 1)];
        });
    }, [currentPageNum, updateAlignmentRows]);

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

                ctx.lineWidth = Math.max(2, Math.round(Math.max(w, h) / 500));
                ctx.lineJoin = 'round';

                let drawn = 0;
                for (let i = 0; i < currentLines.length; i++) {
                    const poly = currentLines[i];
                    if (!poly || poly.length < 3) continue;

                    const isHovered = hoveredBoxIndex === i;
                    ctx.strokeStyle = isHovered ? '#f97316' : '#22c55e';
                    ctx.fillStyle = isHovered ? 'rgba(249,115,22,0.25)' : 'rgba(34,197,94,0.08)';
                    ctx.lineWidth = isHovered
                        ? Math.max(3, Math.round(Math.max(w, h) / 300))
                        : Math.max(2, Math.round(Math.max(w, h) / 500));

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
    }, [currentImageUrl, currentLines, hoveredBoxIndex]);

    // Reset image display state on page change only
    useEffect(() => {
        setImageLoaded(false);
        setCompositeUrl(null);
        setHoveredBoxIndex(null);
        setHoveredLineIndex(null);
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
            cancelProcessingRef.current = false;
            for (let i = 0; i < total; i++) {
                if (cancelProcessingRef.current) break;
                const pageNum = availablePages[i];
                setProcessAllProgress({ current: i + 1, total });
                // Do NOT force viewingPageIndex — user can navigate freely while processing

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
        <div className="h-full overflow-y-auto space-y-2 pr-0.5 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
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
                                disabled={loading}
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
                                disabled={loading}
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
                                        disabled={loading}
                                        className="flex-1 min-w-0 px-2 py-1 bg-white rounded border border-gray-200 text-xs text-gray-700 font-mono focus:border-teal-400 focus:ring-1 focus:ring-teal-200 outline-none disabled:opacity-50"
                                    />
                                    {p.unit && (
                                        <span className="text-[10px] text-gray-400 w-5 shrink-0">{p.unit}</span>
                                    )}
                                </div>
                            ))}
                            <button
                                onClick={() => setTuningParams({ ...DEFAULT_PARAMS })}
                                disabled={loading}
                                className="text-[11px] text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 disabled:opacity-50"
                            >
                                Reset to defaults
                            </button>
                        </div>
                    )}

                    {/* Detect This Page Button */}
                    <button
                        onClick={handleDetect}
                        disabled={loading || !currentImageUrl}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold text-white transition-all duration-200 ${loading || !currentImageUrl
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

                    {/* Process All Pages Button + Cancel */}
                    <div className="flex gap-1">
                    <button
                        onClick={handleDetectAll}
                        disabled={processingAll || loading || availablePages.length === 0}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${processingAll || loading || availablePages.length === 0
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                            : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                            }`}
                    >
                        {processingAll ? (
                            <><Loader2 size={14} className="animate-spin" /> {processAllProgress?.current}/{processAllProgress?.total}…</>
                        ) : (
                            <><Layers size={14} /> All ({totalPages})</>
                        )}
                    </button>
                    {processingAll && (
                        <button
                            onClick={() => { cancelProcessingRef.current = true; }}
                            className="px-2.5 py-2 rounded-lg text-xs font-bold bg-red-100 text-red-600 hover:bg-red-200 border border-red-200 transition-colors"
                            title="Cancel batch processing"
                        >
                            ✕
                        </button>
                    )}
                    </div>

                    {/* Edit All Boxes Button — available even during batch */}
                    <button
                        onClick={() => setShowBBoxEditor(true)}
                        disabled={loading || detectedCount === 0}
                        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${loading || detectedCount === 0
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                            : 'bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700 shadow-sm hover:shadow-md active:scale-[0.98]'
                            }`}
                    >
                        <PenLine size={14} /> Edit All Boxes ({detectedCount})
                    </button>

                    {/* Result stats */}
                    {processingTime !== null && !loading && (
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
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden">
                <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 to-white border-b border-gray-100 flex items-center justify-between shrink-0">
                    <h3 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        <ImageIcon size={16} className="text-teal-600" />
                        Pages
                    </h3>
                    <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
                        {detectedCount}/{totalPages}
                    </span>
                </div>
                <div className="p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                        {availablePages.map((pageNum, idx) => (
                            <div key={pageNum} className="relative">
                                <ThumbnailItem
                                    image={pages?.find(p => p.pageNumber === pageNum) || null}
                                    processedSrc={processedImages?.[pageNum] || null}
                                    index={idx}
                                    isActive={idx === viewingPageIndex}
                                    isDetected={pageNum in detectedPages}
                                    onClick={() => goToPage(idx)}
                                    pageLabel={shortPageLabel(pageNum)}
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
        </div>
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

        // Fully recompute alignment for every page whose polygon list changed.
        // Algorithm:
        //   1. Sort new polygons top→bottom by midpoint-Y of the two topmost vertices.
        //   2. Collect the current text lines in their existing display order.
        //      - If alignment already exists for the page, use those row texts.
        //      - Otherwise fall back to the raw transcript lines.
        //   3. Re-pair: text[i] ↔ sortedIdx[i].  Extra texts get boxIndex=null.
        //      Extra boxes (more boxes than texts) get a blank row at the end.
        // This preserves any manual text edits while fixing the sort order.
        setAlignmentByPage(prevAlignment => {
            const next = { ...prevAlignment };

            Object.entries(results).forEach(([pageNumStr, newPolygons]) => {
                const pageNum = Number(pageNumStr);

                // Step 1 — re-sort polygon indices top→bottom
                const sortedIdxs = newPolygons
                    .map((poly, idx) => {
                        const byY = [...poly].sort((a, b) => a[1] - b[1]);
                        const topMidY = (byY[0][1] + byY[1][1]) / 2;
                        return { idx, topMidY };
                    })
                    .sort((a, b) => a.topMidY - b.topMidY)
                    .map(item => item.idx);

                // Step 2 — gather text lines (existing edits, else raw transcript)
                const existingRows = prevAlignment[pageNum];
                let texts;
                if (existingRows && existingRows.length > 0) {
                    texts = existingRows.map(r => r.text);
                } else {
                    const tk = resolveTranscriptKey(transcript, pageNum);
                    texts = tk ? (transcript[tk] || []) : [];
                }

                // Step 3 — rebuild rows: one row per text line, re-paired with
                // the new sort order.  Never create extra blank rows for extra
                // boxes — the alignment panel is text-driven, not box-driven.
                // If there are MORE boxes than texts, extra boxes are simply
                // unassigned (no row).  If there are MORE texts than boxes,
                // those extra texts keep boxIndex=null (shown as "unassigned").
                const newRows = texts.map((text, i) => ({
                    id: `${pageNum}-${i}-${Date.now()}`,
                    text,
                    boxIndex: i < sortedIdxs.length ? sortedIdxs[i] : null,
                }));

                next[pageNum] = newRows;
                // Mark as seeded so the seed effect won't overwrite this on re-render.
                seededPages.current.add(pageNum);
            });

            return next;
        });

        setEditedPages(prev => {
            const next = new Set(prev);
            Object.keys(results).forEach(k => next.add(Number(k)));
            return next;
        });
        setShowBBoxEditor(false);
    }, [transcript]);

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
                        {shortPageLabel(currentPageNum)} / {totalPages}
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
                            {processingAll ? `batch: ${processAllProgress?.current}/${processAllProgress?.total}` : 'Detecting…'}
                        </span>
                    )}
                    {isCurrentDetected && !loading && (
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
                            key={`${currentPageNum}-${displayUrl?.slice(-20)}`}
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

            {/* Loading overlay — only for single-page detection; batch shows a badge in the header */}
            {loading && (
                <div className="absolute inset-0 bg-teal-500/10 backdrop-blur-sm flex items-center justify-center z-20 pointer-events-none">
                    <div className="bg-white rounded-xl shadow-lg px-5 py-3 text-center">
                        <Loader2 size={28} className="animate-spin text-teal-600 mx-auto mb-2" />
                        <p className="text-sm font-medium text-gray-700">Detecting lines…</p>
                    </div>
                </div>
            )}
            {/* Non-blocking batch progress badge */}
            {processingAll && processAllProgress && (
                <div className="absolute top-2 right-2 z-20 flex items-center gap-2 bg-blue-600/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm pointer-events-none">
                    <Loader2 size={12} className="animate-spin" />
                    Processing {processAllProgress.current}/{processAllProgress.total}…
                </div>
            )}
        </div>
    );

    const alignedTranscriptByPage = useMemo(() => {
        const result = {};
        Object.keys(alignmentByPage).forEach((pageNum) => {
            const rows = alignmentByPage[pageNum] || [];
            result[pageNum] = rows.map((row) => row.text).filter((txt) => txt && txt.trim().length > 0);
        });
        return result;
    }, [alignmentByPage]);

    // ════════════════════════════════════════════════════════
    // RIGHT PANEL — Step 4 Alignment
    // ════════════════════════════════════════════════════════
    const rightPanel = (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-3 py-2 bg-gradient-to-r from-teal-50/80 via-white to-emerald-50/50 border-b border-gray-100/80 flex items-center justify-between shrink-0">
                <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm">
                    <div className="p-1 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg text-white">
                        <FileText size={12} />
                    </div>
                    <span>Step 4 — Alignment</span>
                </h3>
                <span className="text-xs text-gray-500 font-medium">Page {shortPageLabel(currentPageNum)}</span>
            </div>

            <div className="px-3 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between text-xs text-gray-500">
                <span>Detected: {isCurrentDetected ? `${currentLines.length} boxes` : 'Pending'}</span>
                <span>Transcript: {transcriptKeyForCurrentPage ? `${(transcript[transcriptKeyForCurrentPage] || []).length} lines` : 'Not matched'}</span>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-1.5 bg-gradient-to-br from-gray-50/50 to-gray-100/20">
                {!isCurrentDetected && (
                    <div className="text-xs text-gray-500 bg-white rounded-lg border border-gray-200 px-3 py-2">
                        Detect this page first to align lines.
                    </div>
                )}

                {isCurrentDetected && !transcriptKeyForCurrentPage && (
                    <div className="text-xs text-amber-700 bg-amber-50 rounded-lg border border-amber-200 px-3 py-2">
                        No transcript page matched for {shortPageLabel(currentPageNum)}.
                    </div>
                )}

                {isCurrentDetected && currentAlignmentRows.map((row, lineIndex) => {
                    const assignedBoxIdx = row.boxIndex;
                    const isBoxHovered = assignedBoxIdx !== null && assignedBoxIdx !== undefined && hoveredBoxIndex === assignedBoxIdx;
                    const isLineHovered = hoveredLineIndex === lineIndex;
                    const isHighlighted = isBoxHovered || isLineHovered;
                    const isUnassigned = assignedBoxIdx === null || assignedBoxIdx === undefined;

                    return (
                        <div
                            key={row.id}
                            className={`rounded-lg border p-2.5 space-y-1.5 shadow-sm transition-colors cursor-pointer ${
                                isHighlighted
                                    ? 'bg-orange-50 border-orange-300 shadow-orange-100'
                                    : 'bg-white border-gray-200 hover:border-teal-300 hover:bg-teal-50/30'
                            }`}
                            onMouseEnter={() => {
                                setHoveredLineIndex(lineIndex);
                                if (assignedBoxIdx !== null && assignedBoxIdx !== undefined) {
                                    setHoveredBoxIndex(assignedBoxIdx);
                                }
                            }}
                            onMouseLeave={() => {
                                setHoveredLineIndex(null);
                                setHoveredBoxIndex(null);
                            }}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                    <span className={`text-[11px] font-semibold ${isHighlighted ? 'text-orange-600' : 'text-gray-500'}`}>
                                        Line {lineIndex + 1}
                                    </span>
                                    {isUnassigned && (
                                        <span className="text-[9px] px-1 py-0.5 bg-amber-100 text-amber-600 rounded font-semibold">
                                            unassigned
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => moveLine(lineIndex, -1)}
                                        disabled={lineIndex === 0}
                                        className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                                        title="Move line up"
                                    >
                                        <ArrowUp size={12} />
                                    </button>
                                    <button
                                        onClick={() => moveLine(lineIndex, 1)}
                                        disabled={lineIndex >= currentAlignmentRows.length - 1}
                                        className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                                        title="Move line down"
                                    >
                                        <ArrowDown size={12} />
                                    </button>
                                    <button
                                        onClick={() => mergeLineWithNext(lineIndex)}
                                        disabled={lineIndex >= currentAlignmentRows.length - 1}
                                        className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                                        title="Merge with next line"
                                    >
                                        <Link2 size={12} />
                                    </button>
                                    <button
                                        onClick={() => splitLine(lineIndex)}
                                        className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                                        title="Split line into two"
                                    >
                                        <Split size={12} />
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <label className="text-[11px] text-gray-500 w-14 shrink-0">Line box</label>
                                <select
                                    value={row.boxIndex ?? ''}
                                    onChange={(e) => assignBoxToLine(lineIndex, e.target.value)}
                                    className="flex-1 px-2 py-1.5 bg-gray-50 rounded border border-gray-200 text-xs text-gray-700"
                                >
                                    <option value="">Unassigned</option>
                                    {sortedBoxIndices.map((origIdx, sortedPos) => (
                                        <option key={origIdx} value={origIdx}>Box {sortedPos + 1} (row {origIdx + 1})</option>
                                    ))}
                                </select>
                            </div>

                            <textarea
                                value={row.text}
                                onChange={(e) => updateLineText(lineIndex, e.target.value)}
                                rows={2}
                                className="w-full px-2.5 py-2 bg-white border border-gray-200 rounded text-xs text-gray-700 resize-y focus:outline-none focus:ring-1 focus:ring-teal-200 focus:border-teal-400"
                            />
                        </div>
                    );
                })}

                {/* Extra unassigned lines beyond available boxes */}
                {isCurrentDetected && currentAlignmentRows.length === 0 && transcriptKeyForCurrentPage && (
                    <div className="text-xs text-gray-500 bg-white rounded-lg border border-gray-200 px-3 py-2">
                        No transcript lines found for this page.
                    </div>
                )}
            </div>

            <div className="px-3 py-2 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between text-xs text-gray-500 shrink-0 gap-2">
                <span className="shrink-0">{currentAlignmentRows.length} lines · {currentAlignmentRows.filter(r => r.boxIndex !== null && r.boxIndex !== undefined).length} assigned</span>
                {currentAlignmentRows.length > 0 &&
                    currentAlignmentRows.every(r => r.boxIndex !== null && r.boxIndex !== undefined) && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold shrink-0">
                        <CheckCircle2 size={11} /> All matched
                    </span>
                )}
                {isCurrentDetected && currentAlignmentRows.length > 0 && (
                    <button
                        onClick={realignCurrentPage}
                        title="Re-pair transcript lines with boxes in their current top-to-bottom order"
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 hover:border-teal-300 font-semibold transition-colors shrink-0"
                    >
                        <RefreshCw size={11} />
                        Realign
                    </button>
                )}
            </div>
        </div>
    );


    // ════════════════════════════════════════════════════════
    // OCR RIGHT PANEL — model picker shown in OCR mode
    // ════════════════════════════════════════════════════════
    const ocrRightPanel = (
        <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-gray-200/80 shadow-sm overflow-hidden flex flex-col h-full">
            {/* Header */}
            <div className="px-3 py-2.5 bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/50 border-b border-gray-100/80 shrink-0 flex items-center gap-2">
                <div className="p-1 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg text-white">
                    <Sparkles size={12} />
                </div>
                <h3 className="font-bold text-gray-800 text-sm">Perform OCR</h3>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-4">

                {/* ── Local Model ─────────────────────────────── */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                            <Cpu size={12} className="text-gray-500" />
                            <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Local Model</p>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-600 font-bold rounded-full border border-amber-200">Coming Soon</span>
                    </div>

                    <div className="relative">
                        <select
                            disabled
                            className="w-full appearance-none px-2.5 py-2 bg-gray-100 rounded-lg text-xs text-gray-400 font-medium border border-gray-200 outline-none pr-7 cursor-not-allowed"
                        >
                            <option>Select a local model…</option>
                            <option>PaddleOCR v5 (CPU / GPU)</option>
                            <option>Tesseract 5</option>
                            <option>EasyOCR</option>
                        </select>
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                        Local models run fully offline with no API key. Integration is in progress — check back soon.
                    </p>
                </div>

            </div>

            {/* ── Export footer — always visible ───────────────── */}
            <div className="shrink-0 border-t border-gray-100 p-3 bg-gradient-to-r from-gray-50/80 to-white space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Download size={11} /> Export Transcript
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                    <button
                        disabled={detectedCount === 0}
                        onClick={() => {
                            const lines = availablePages.flatMap(p => detectedPages[p] || []);
                            const txt = lines.map((poly, i) => `Line ${i + 1}`).join('\n');
                            const blob = new Blob([txt], { type: 'text/plain' });
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                            a.download = 'transcript.txt'; a.click();
                        }}
                        className="flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] font-semibold transition-all
                            disabled:opacity-40 disabled:cursor-not-allowed
                            bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                        <FileTextIcon size={15} />
                        TXT
                    </button>
                    <button
                        disabled={detectedCount === 0}
                        onClick={() => {
                            const data = {};
                            availablePages.forEach(p => { if (detectedPages[p]) data[p] = detectedPages[p]; });
                            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                            a.download = 'boxes.json'; a.click();
                        }}
                        className="flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] font-semibold transition-all
                            disabled:opacity-40 disabled:cursor-not-allowed
                            bg-white border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                        <FileJson size={15} />
                        JSON
                    </button>
                    <button
                        disabled={detectedCount === 0}
                        onClick={() => {
                            const rows = ['page,line_index,x1,y1,x2,y2,x3,y3,x4,y4'];
                            availablePages.forEach(p => {
                                (detectedPages[p] || []).forEach((poly, i) => {
                                    rows.push([p, i, ...poly.flat()].join(','));
                                });
                            });
                            const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
                            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                            a.download = 'boxes.csv'; a.click();
                        }}
                        className="flex flex-col items-center gap-1 py-2 rounded-lg border text-[10px] font-semibold transition-all
                            disabled:opacity-40 disabled:cursor-not-allowed
                            bg-white border-gray-200 text-gray-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                        <FileType size={15} />
                        CSV
                    </button>
                </div>
                {detectedCount === 0 && (
                    <p className="text-[10px] text-gray-400 text-center">Detect at least one page to export.</p>
                )}
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

                {/* Dataset mode: Continue to Export button */}
                {datasetMode && detectedCount > 0 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <button
                            onClick={() => {
                                if (onDatasetNext) {
                                    onDatasetNext({
                                        boxesByPage: detectedPages,
                                        alignedTranscriptByPage,
                                    });
                                }
                            }}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                        >
                            Continue to Export
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                {/* OCR mode: Continue to Perform OCR button */}
                {!datasetMode && detectedCount > 0 && onNext && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <button
                            onClick={onNext}
                            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-bold rounded-lg shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                        >
                            Continue to OCR
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </header>

            {/* Main 3-column layout */}
            <main className="flex-1 min-h-0 p-2 overflow-hidden">
<div className="h-full hidden lg:block">
                    <ResizablePanels
                        leftPanel={leftSidebar}
                        centerPanel={centerPanel}
                        rightPanel={datasetMode ? rightPanel : ocrRightPanel}
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
