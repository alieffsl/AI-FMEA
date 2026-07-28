const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const unzipper = require('unzipper');
const pdfParse = require('pdf-parse');
const officeParser = require('officeparser');

require('dotenv').config({ path: path.join(__dirname, '../migration/.env') });
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXCEL_PATH = path.join(__dirname, '../Copy of MEC-Product-Standard-revision.xlsx');
const MEC_DIR = path.join(__dirname, '../MEC');
const OUT_FILE = path.join(__dirname, '../src/data/mec_product_standard_v2.json');

const mecSchema = {
    "type": "object",
    "properties": {
        "slug": { "type": "string" },
        "title": { "type": "string" },
        "page_type": { "type": "string", "enum": ["guideline_article", "technical_reference"] },
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "content": { "type": "string" },
                    "image_references": { 
                        "type": "array", 
                        "items": { "type": "string" }
                    },
                    "type": { "type": "string", "enum": ["design_rule", "guideline", "goal", "reference"] }
                },
                "required": ["title", "content", "image_references", "type"],
                "additionalProperties": false
            }
        }
    },
    "required": ["slug", "title", "page_type", "sections"],
    "additionalProperties": false
};

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
                const b64 = buffer.toString('base64');
                const ext = path.extname(file.path).slice(1).toLowerCase();
                const mimeType = ext === 'jpg' ? 'jpeg' : ext;
                images.push({
                    name: `${path.basename(filePath)}_${path.basename(file.path)}`,
                    dataUrl: `data:image/${mimeType};base64,${b64}`
                });
            }
        }
    } catch (e) {
        // ignore
    }
    return images;
}

async function extractPdfText(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch(e) { return ""; }
}

async function extractOfficeText(filePath) {
    try {
        const text = await officeParser.parseOfficeAsync(filePath);
        return text;
    } catch (e) { return ""; }
}

async function processExternalFile(filePath, titleContext) {
    console.log(`\n🤖 Analyzing External File: ${path.basename(filePath)}`);
    const ext = path.extname(filePath).toLowerCase();
    
    let rawText = "";
    let images = [];
    
    if (ext === '.pdf') {
        rawText = await extractPdfText(filePath);
    } else if (['.pptx', '.xlsm', '.xlsx', '.docx'].includes(ext)) {
        rawText = await extractOfficeText(filePath);
        images = await extractImagesFromZip(filePath);
    } else if (ext === '.jpg' || ext === '.png' || ext === '.jpeg') {
        // standalone image
        const b64 = fs.readFileSync(filePath).toString('base64');
        const mimeType = ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1);
        images.push({
            name: path.basename(filePath),
            dataUrl: `data:image/${mimeType};base64,${b64}`
        });
        rawText = `[This is a standalone reference image titled: ${titleContext}]`;
    } else {
        console.log(`Skipping unsupported extension ${ext}`);
        return null;
    }
    
    if (!rawText || rawText.trim().length < 5) {
        console.log("No text extracted, skipping AI generation unless it's an image.");
        if (images.length === 0) return null;
    }

    const messages = [
        {
            role: "system",
            content: "You are an expert mechanical engineering AI. Your job is to extract unstructured engineering guidelines from raw text and images, and convert them into highly structured JSON data suitable for a Product Standards website. Remove boilerplate."
        }
    ];

    const contentArray = [
        { type: "text", text: `Title Context: ${titleContext}\n\nHere is the raw text extracted from the document:\n\n${rawText.substring(0, 10000)}` }
    ];

    const imagesToProcess = images.slice(0, 15);
    for (const img of imagesToProcess) {
        contentArray.push({
            type: "image_url",
            image_url: { url: img.dataUrl, detail: "low" }
        });
        contentArray.push({
            type: "text", text: `(Image filename: ${img.name})`
        });
    }
    
    messages.push({ role: "user", content: contentArray });

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            temperature: 0.1,
            response_format: {
                type: "json_schema",
                json_schema: { name: "mec_guideline", schema: mecSchema, strict: true }
            }
        });

        const jsonContent = response.choices[0].message.content;
        return JSON.parse(jsonContent);
    } catch (e) {
        console.error(`❌ OpenAI Error: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log("Starting External Links Append Pipeline...\n");

    const workbook = xlsx.readFile(EXCEL_PATH);
    const sheet = workbook.Sheets['MEC home-tree'];
    
    const externalLinks = [];
    for (let cell in sheet) {
        if (cell[0] === '!') continue;
        if (sheet[cell].l && sheet[cell].l.Target) {
            const target = decodeURIComponent(sheet[cell].l.Target);
            if (target.includes('\\') || target.includes('/')) {
                // It's a file path or URL
                const basename = path.basename(target.replace(/\\/g, '/'));
                if (basename && !basename.startsWith('#')) {
                    externalLinks.push({ text: sheet[cell].v, basename: basename });
                }
            }
        }
    }

    console.log(`Found ${externalLinks.length} external file references.`);

    // Load existing DB
    let database = [];
    if (fs.existsSync(OUT_FILE)) {
        database = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    }
    const existingSlugs = database.map(d => d.slug);

    for (const link of externalLinks) {
        // Find matching file in local MEC dir
        const localFile = allMecFiles.find(f => path.basename(f).toLowerCase() === link.basename.toLowerCase());
        
        if (localFile) {
            console.log(`\nMatch found: ${link.basename} -> ${localFile}`);
            const aiResult = await processExternalFile(localFile, link.text);
            
            if (aiResult) {
                // Ensure unique slug
                let finalSlug = aiResult.slug;
                let counter = 1;
                while (existingSlugs.includes(finalSlug)) {
                    finalSlug = `${aiResult.slug}-${counter}`;
                    counter++;
                }
                aiResult.slug = finalSlug;
                existingSlugs.push(finalSlug);
                
                database.push(aiResult);
                console.log(`   ✅ Appended ${finalSlug} to database.`);
            }
        } else {
            console.log(`\n⚠️ Missing local file for: ${link.basename}`);
        }
    }

    // Save output
    fs.writeFileSync(OUT_FILE, JSON.stringify(database, null, 2), 'utf8');
    console.log(`\n🎉 Append Complete! Database saved to: ${OUT_FILE}`);
}

main().catch(console.error);
