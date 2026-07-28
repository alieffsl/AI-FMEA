/**
 * Validate an uploaded file for CDI parsing.
 */
export function validateCdiFile(file: File): string | null {
  const maxSize = 50 * 1024 * 1024; // 50MB
  const validExtensions = [".xlsx", ".xlsm"];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

  if (!validExtensions.includes(ext)) {
    return `Invalid file type "${ext}". Only .xlsx and .xlsm files are supported.`;
  }

  if (file.size > maxSize) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 50 MB.`;
  }

  if (file.size === 0) {
    return "The file is empty.";
  }

  return null;
}

/**
 * Validate an image file for tool row upload.
 */
export function validateImageFile(file: File): string | null {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const validExtensions = [".png", ".jpg", ".jpeg", ".webp"];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));

  if (!validTypes.includes(file.type) && !validExtensions.includes(ext)) {
    return `Invalid image type "${ext}". Supported: PNG, JPG, JPEG, WebP.`;
  }

  if (file.size > maxSize) {
    return `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is 10 MB.`;
  }

  return null;
}
