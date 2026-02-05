import React, { useState, useCallback, useMemo } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import Stepper from './components/Stepper';
import UploadPage from './pages/UploadPage';
import SelectPage from './pages/SelectPage';
import PreprocessPage from './pages/PreprocessPage';
import TextDetectionPage from './pages/TextDetectionPage';
import TextRecognitionPage from './pages/TextRecognitionPage';
import { usePdfPreview } from './hooks/usePdfPreview';

function App() {
  // App state
  const [currentStep, setCurrentStep] = useState(1);
  const [files, setFiles] = useState(null);
  const [selectedPages, setSelectedPages] = useState([]);
  const [processedImages, setProcessedImages] = useState({});
  const [detectionMethod, setDetectionMethod] = useState(null);
  const [detectionProvider, setDetectionProvider] = useState(null);

  // PDF preview hook
  const {
    pages,
    isLoading,
    error,
    progress,
    extractPages,
    loadImages,
    reset: resetPdfPreview,
  } = usePdfPreview();

  // Handle file selection
  const handleFilesSelected = useCallback((selectedFiles) => {
    setFiles(selectedFiles);
    setSelectedPages([]);
  }, []);

  // Handle proceeding from upload step
  const handleUploadNext = useCallback(async () => {
    if (!files || files.length === 0) return;

    const isPdf = files[0].type === 'application/pdf';

    if (isPdf) {
      // Extract PDF pages
      try {
        await extractPages(files[0]);
        setCurrentStep(2);
      } catch (err) {
        console.error('Failed to extract PDF:', err);
      }
    } else {
      // Load images directly
      try {
        const loadedPages = await loadImages(files);
        // Auto-select all images
        setSelectedPages(loadedPages.map((_, i) => i + 1));
        setCurrentStep(3); // Skip page selection for images
      } catch (err) {
        console.error('Failed to load images:', err);
      }
    }
  }, [files, extractPages, loadImages]);

  // Handle selection step
  const handleSelectionChange = useCallback((newSelection) => {
    setSelectedPages(newSelection);
  }, []);

  // Navigation handlers
  const handleStepClick = useCallback((stepId) => {
    if (stepId <= currentStep) {
      setCurrentStep(stepId);
    }
  }, [currentStep]);

  const goToStep = useCallback((step) => {
    setCurrentStep(step);
  }, []);

  // Reset app state
  const handleReset = useCallback(() => {
    setCurrentStep(1);
    setFiles(null);
    setSelectedPages([]);
    setProcessedImages({});
    setDetectionMethod(null);
    setDetectionProvider(null);
    resetPdfPreview();
  }, [resetPdfPreview]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                OCR Preprocess Studio
              </h1>
              <p className="text-xs text-gray-500">
                Prepare documents for text extraction
              </p>
            </div>
          </div>

          {currentStep > 1 && (
            <button
              onClick={handleReset}
              className="text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg transition-all duration-200"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {/* Stepper */}
        <Stepper currentStep={currentStep} onStepClick={handleStepClick} />

        {/* Error display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50/80 backdrop-blur-sm border border-red-200 rounded-xl text-red-600 animate-fade-in shadow-sm">
            <p className="font-semibold">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Progress bar */}
        {isLoading && progress > 0 && (
          <div className="mb-6 animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">
                Processing...
              </span>
              <span className="text-sm font-bold text-blue-600">{progress}%</span>
            </div>
            <div className="h-2.5 bg-blue-100 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300 shadow-sm"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Step content */}
        <div className="min-h-[600px]">
          {currentStep === 1 && (
            <UploadPage
              files={files}
              onFilesSelected={handleFilesSelected}
              onNext={handleUploadNext}
              isLoading={isLoading}
            />
          )}

          {currentStep === 2 && (
            <SelectPage
              pages={pages}
              selectedPages={selectedPages}
              onSelectionChange={handleSelectionChange}
              onBack={() => goToStep(1)}
              onNext={() => goToStep(3)}
              isLoading={isLoading}
            />
          )}

          {currentStep === 3 && (
            <PreprocessPage
              pages={pages}
              selectedPages={selectedPages}
              onBack={() => goToStep(files[0]?.type === 'application/pdf' ? 2 : 1)}
              onNext={() => goToStep(4)}
              onProcessedImagesChange={setProcessedImages}
            />
          )}

          {currentStep === 4 && (
            <TextDetectionPage
              pages={pages}
              selectedPages={selectedPages}
              processedImages={processedImages}
              onBack={() => goToStep(3)}
              onNext={(method, provider) => {
                setDetectionMethod(method);
                setDetectionProvider(provider);
                goToStep(5);
              }}
            />
          )}

          {currentStep === 5 && (
            <TextRecognitionPage
              processedImages={
                // Get the final images (preprocessed or original) for selected pages
                selectedPages.map((pageNum) => {
                  const pageIndex = pageNum - 1;
                  const preprocessed = processedImages[pageNum];
                  const original = pages[pageIndex];
                  return {
                    pageNumber: pageNum,
                    // Use thumbnail for original (from PDF/image extraction)
                    original: original?.thumbnail || original,
                    // Use preprocessed if available, otherwise fall back to thumbnail
                    processed: preprocessed || original?.thumbnail || original,
                  };
                })
              }
              onBack={() => goToStep(4)}
              onComplete={() => {
                // OCR complete - show success state or reset
                alert('OCR processing complete! Transcripts have been saved.');
              }}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white/60 backdrop-blur-sm border-t border-gray-100 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
            <span className="font-semibold text-gray-600">OCR Preprocess Studio</span>
            <span className="text-gray-300">•</span>
            <span>Stage 1</span>
            <span className="text-gray-300">•</span>
            <span className="text-blue-600 font-medium">RenAIssance Project</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
