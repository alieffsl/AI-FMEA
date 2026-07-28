const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

const MEC_DIR = path.join(__dirname, '../MEC');
const OUT_DIR = path.join(__dirname, '../public/mec_images');

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

function getAllFiles(dirPath, arrayOfFiles) {
    if (!fs.existsSync(dirPath)) return [];
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];
    files.forEach(function(file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
            arrayOfFiles.push(path.join(dirPath, "/", file));
        }
    });
    return arrayOfFiles;
}

const allMecFiles = getAllFiles(MEC_DIR);

async function extractImagesFromZip(filePath) {
    const images = [];
    try {
        const directory = await unzipper.Open.file(filePath);
        for (const file of directory.files) {
            if (file.path.match(/(xl|ppt)\/media\/.*\.(png|jpg|jpeg|gif)$/i)) {
                const buffer = await file.buffer();
                const outName = `${path.basename(filePath)}_${path.basename(file.path)}`;
                const outPath = path.join(OUT_DIR, outName);
                fs.writeFileSync(outPath, buffer);
                console.log(`Saved: ${outName}`);
            }
        }
    } catch (e) {
        // ignore
    }
}

async function main() {
    console.log("Extracting images to public/mec_images...");
    for (const file of allMecFiles) {
        const ext = path.extname(file).toLowerCase();
        if (['.pptx', '.xlsm', '.xlsx'].includes(ext)) {
            await extractImagesFromZip(file);
        } else if (['.jpg', '.png', '.jpeg', '.gif'].includes(ext)) {
            const outName = path.basename(file);
            const outPath = path.join(OUT_DIR, outName);
            fs.copyFileSync(file, outPath);
            console.log(`Copied: ${outName}`);
        }
    }
    console.log("Done!");
}

main().catch(console.error);
