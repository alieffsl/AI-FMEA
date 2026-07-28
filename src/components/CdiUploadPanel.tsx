import { useCallback, useState } from "react";
import { FileSpreadsheet, UploadCloud, X, AlertCircle, ShieldCheck } from "lucide-react";
import { validateCdiFile } from "../lib/validation";

type CdiUploadPanelProps = {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
  error: string | null;
  onLoadDemo: () => void;
};

export function CdiUploadPanel({ onFileSelected, isLoading, error, onLoadDemo }: CdiUploadPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const validationError = validateCdiFile(file);
      if (validationError) {
        // Let parent handle display — but we can also set local state
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected],
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function onDragLeave() {
    setIsDragOver(false);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ""; // reset so same file can be re-selected
  }

  return (
    <div className="mx-auto max-w-2xl animate-slide-up">
      {/* Upload area */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`relative rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
          isDragOver
            ? "border-accent-500 bg-accent-50 shadow-md dark:bg-accent-500/10"
            : "border-steel-200 bg-white hover:border-steel-300 hover:shadow-sm dark:border-steel-700 dark:bg-steel-900"
        } ${isLoading ? "pointer-events-none opacity-60" : ""}`}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-5 py-4">
            {/* Single clean spinner */}
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-steel-200 border-t-accent-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-steel-900 dark:text-white">Parsing CDI file…</p>
              <p className="mt-1.5 text-sm text-steel-500 dark:text-steel-400">Detecting headers, extracting tool rows</p>
            </div>
            {/* Shimmer bar */}
            <div className="h-1 w-48 overflow-hidden rounded-full bg-steel-100">
              <div className="h-full w-full animate-shimmer rounded-full" />
            </div>
          </div>
        ) : (
          <div>
            {/* Upload icon — flat, precise */}
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500 text-white">
              <UploadCloud size={28} />
            </div>
            <h2 className="mt-5 text-lg font-bold text-steel-900 dark:text-white">Upload CDI Excel File</h2>
            <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-steel-500 dark:text-steel-400">
              Drag and drop your CDI file here, or click to browse.
              <br />
              Supports{" "}
              <span className="font-mono-eng rounded bg-steel-100 px-1.5 py-0.5 text-xs font-medium text-steel-700 dark:bg-steel-800 dark:text-steel-300">.xlsx</span>{" "}
              and{" "}
              <span className="font-mono-eng rounded bg-steel-100 px-1.5 py-0.5 text-xs font-medium text-steel-700 dark:bg-steel-800 dark:text-steel-300">.xlsm</span>{" "}
              formats.
            </p>

            <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl bg-accent-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-accent-600 hover:shadow-md active:scale-[0.97]">
                <FileSpreadsheet size={18} />
                Choose CDI File
                <input
                  type="file"
                  accept=".xlsx,.xlsm"
                  className="sr-only"
                  onChange={onInputChange}
                />
              </label>

              <button
                type="button"
                onClick={onLoadDemo}
                className="inline-flex items-center gap-2 rounded-xl border border-steel-200 bg-white px-6 py-3 text-sm font-medium text-steel-700 transition-all duration-200 hover:border-steel-300 hover:bg-steel-50 active:scale-[0.97] dark:border-steel-700 dark:bg-steel-900 dark:text-steel-300 dark:hover:border-steel-600 dark:hover:bg-steel-800"
              >
                Load Demo Data
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 animate-slide-up">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="font-bold">Upload Error</p>
            <p className="mt-1 text-red-700">{error}</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-lg p-1.5 text-red-400 transition hover:bg-red-100 hover:text-red-700"
            onClick={() => {}}
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {/* Privacy notice */}
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-steel-400">
        <ShieldCheck size={14} className="text-steel-400" />
        <span>Parsed locally in your browser. No data is uploaded to any server.</span>
      </div>
    </div>
  );
}
