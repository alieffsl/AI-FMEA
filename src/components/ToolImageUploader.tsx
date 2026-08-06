import { useCallback, useRef, useState } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
import type { ToolImage } from "../types/project";
import { validateImageFile } from "../lib/validation";

/**
 * Attachments are held in this browser session only.
 *
 * They are deliberately not part of the `/api/fmea/generate` payload: the API
 * does not read them and `File` objects serialise to `{}` over JSON. The label
 * and tooltip say so, so the column is not mistaken for evidence that feeds
 * matching.
 */
const ATTACHMENT_HINT =
  "Reference image for this session only. Not uploaded and not used for matching.";

type ToolImageUploaderProps = {
  images: ToolImage[];
  toolRowId: string;
  onImagesChange: (toolRowId: string, images: ToolImage[]) => void;
};

let imgIdCounter = 0;

export function ToolImageUploader({ images, toolRowId, onImagesChange }: ToolImageUploaderProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const newImages: ToolImage[] = [];
      for (const file of Array.from(files)) {
        const err = validateImageFile(file);
        if (err) {
          setError(err);
          return;
        }
        setError(null);
        newImages.push({
          id: `img-${++imgIdCounter}`,
          file,
          thumbnailUrl: URL.createObjectURL(file),
          filename: file.name,
        });
      }
      onImagesChange(toolRowId, [...images, ...newImages]);
    },
    [images, toolRowId, onImagesChange],
  );

  function removeImage(imageId: string) {
    const img = images.find((i) => i.id === imageId);
    if (img) URL.revokeObjectURL(img.thumbnailUrl);
    onImagesChange(
      toolRowId,
      images.filter((i) => i.id !== imageId),
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Thumbnails */}
      {images.map((img) => (
        <div
          key={img.id}
          className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-steel-200"
          title={`${img.filename} — ${ATTACHMENT_HINT}`}
        >
          <img src={img.thumbnailUrl} alt={img.filename} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => removeImage(img.id)}
            className="absolute inset-0 flex items-center justify-center bg-steel-900/50 opacity-0 transition group-hover:opacity-100"
            aria-label={`Remove attachment ${img.filename}`}
            title="Remove"
          >
            <Trash2 size={12} className="text-white" />
          </button>
        </div>
      ))}

      {/* Add button */}
      <label
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-steel-300 text-steel-400 transition hover:border-steel-500 hover:text-steel-600 hover:bg-steel-50"
        title={`Attach reference image. ${ATTACHMENT_HINT}`}
      >
        <ImagePlus size={14} />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {error ? (
        <div className="flex items-center gap-1 text-xs text-red-600">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
