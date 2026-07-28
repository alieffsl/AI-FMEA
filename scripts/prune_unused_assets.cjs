const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATABASE_PATH = path.join(ROOT, "src/data/mec_product_standard_v2.json");
const IMAGE_ROOT = path.join(ROOT, "public/mec_images");
const APPLY = process.argv.includes("--apply");

function withinDirectory(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const pages = JSON.parse(fs.readFileSync(DATABASE_PATH, "utf8"));
const referencedImages = new Set(
  pages
    .flatMap((page) => page.sections)
    .flatMap((section) => section.image_references)
    .filter((reference) => !reference.startsWith("/"))
    .map((reference) => reference.toLowerCase()),
);

const unused = fs
  .readdirSync(IMAGE_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !referencedImages.has(entry.name.toLowerCase()))
  .map((entry) => {
    const filePath = path.resolve(IMAGE_ROOT, entry.name);
    if (!withinDirectory(filePath, IMAGE_ROOT)) throw new Error(`Unsafe asset path: ${filePath}`);
    return { filePath, size: fs.statSync(filePath).size };
  });

if (APPLY) {
  for (const asset of unused) fs.unlinkSync(asset.filePath);
}

const bytes = unused.reduce((total, asset) => total + asset.size, 0);
console.log(
  `${APPLY ? "Removed" : "Found"} ${unused.length} unreferenced extracted images ` +
  `(${(bytes / 1024 / 1024).toFixed(2)} MB).${APPLY ? "" : " Re-run with --apply to delete them."}`,
);
