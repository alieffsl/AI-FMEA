import { useState } from "react";
import { Maximize2, X, ImageOff } from "lucide-react";
import { getAssetDataUri, getAsset } from "../../data/mecProductStandards";

interface MecImageViewerProps {
  assetId: string;
  className?: string;
  /** Maximum height in pixels for the thumbnail view */
  maxHeight?: number;
  /** Whether to show the caption below the image */
  showCaption?: boolean;
}

/**
 * Renders a single MEC asset image with lazy loading and click-to-zoom.
 */
export function MecImageViewer({
  assetId,
  className = "",
  maxHeight = 400,
  showCaption = true,
}: MecImageViewerProps) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [hasError, setHasError] = useState(false);

  const dataUri = getAssetDataUri(assetId);
  const asset = getAsset(assetId);

  if (!dataUri || hasError) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-steel-200 bg-steel-50 p-6 text-steel-400 ${className}`}
        style={{ minHeight: 120 }}
      >
        <div className="flex flex-col items-center gap-2">
          <ImageOff size={24} />
          <span className="text-xs font-medium">Image unavailable</span>
        </div>
      </div>
    );
  }

  const caption = asset?.nearest_text_english || "";

  return (
    <>
      {/* Thumbnail */}
      <div className={`group relative overflow-hidden rounded-xl border border-steel-200 bg-steel-50 ${className}`}>
        <button
          type="button"
          onClick={() => setIsZoomed(true)}
          className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 rounded-xl"
        >
          <img
            src={dataUri}
            alt={caption || `Technical image ${assetId}`}
            className="w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.02]"
            style={{ maxHeight }}
            loading="lazy"
            onError={() => setHasError(true)}
          />
          {/* Hover overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-steel-900/0 transition-colors duration-200 group-hover:bg-steel-900/5">
            <span className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-xs font-semibold text-steel-700 opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
              <Maximize2 size={14} />
              Zoom
            </span>
          </div>
        </button>
        {showCaption && caption && (
          <div className="border-t border-steel-200 bg-white px-3 py-2">
            <p className="text-xs font-medium text-steel-600 leading-relaxed">{caption}</p>
          </div>
        )}
      </div>

      {/* Zoom modal */}
      {isZoomed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close zoom"
            className="absolute inset-0 bg-steel-950/60 backdrop-blur-sm"
            onClick={() => setIsZoomed(false)}
          />
          <div className="relative z-10 flex max-h-[92vh] max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-steel-200 px-5 py-3">
              <div>
                {caption && (
                  <h3 className="text-sm font-bold text-steel-900">{caption}</h3>
                )}
                <p className="mt-0.5 font-mono text-[10px] text-steel-400">{assetId}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsZoomed(false)}
                className="rounded-lg p-2 text-steel-500 transition hover:bg-steel-100 hover:text-steel-900"
              >
                <X size={18} />
              </button>
            </header>
            <div className="compact-scrollbar overflow-auto bg-steel-50 p-4">
              <img
                src={dataUri}
                alt={caption || `Technical image ${assetId}`}
                className="max-h-[80vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Renders a row of MEC images for a section/page.
 */
export function MecImageRow({
  imageIds,
  maxHeight = 320,
}: {
  imageIds: string[];
  maxHeight?: number;
}) {
  if (!imageIds.length) return null;

  const columns = imageIds.length === 1 ? "" : imageIds.length === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`grid gap-4 ${columns}`}>
      {imageIds.map((id) => (
        <MecImageViewer key={id} assetId={id} maxHeight={maxHeight} />
      ))}
    </div>
  );
}
