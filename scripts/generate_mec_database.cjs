const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const unzipper = require('unzipper');
const pdfParse = require('pdf-parse');
const officeParser = require('officeparser');

require('dotenv').config({ path: path.join(__dirname, '../migration/.env') });
const { OpenAI } = require('openai');

if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in migration/.env');
    process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const EXCEL_PATH = path.join(__dirname, '../Copy of MEC-Product-Standard-revision.xlsx');
const MEC_DIR = path.join(__dirname, '../MEC');
const OUT_FILE = path.join(__dirname, '../src/data/mec_product_standard_v2.json');

const mecSchema = {
    "type": "object",
    "properties": {
        "slug": { "type": "string", "description": "URL-friendly identifier" },
        "title": { "type": "string" },
        "page_type": { "type": "string", "enum": ["guideline_article", "technical_reference"] },
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "content": { "type": "string", "description": "Markdown formatted guidelines. Incorporate relevant data from external files." },
                    "image_references": { 
                        "type": "array", 
                        "items": { "type": "string" },
                        "description": "Filenames of relevant images discussed"
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

// Helper: recursively get all files in MEC dir
function getAllFiles(dirPath, arrayOfFiles) {
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

const allMecFiles = fs.existsSync(MEC_DIR) ? getAllFiles(MEC_DIR) : [];

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
        console.warn(`[WARN] Could not extract images from ${filePath}: ${e.message}`);
    }
    return images;
}

async function extractPdfText(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch(e) {
        console.warn(`[WARN] Could not parse PDF ${filePath}: ${e.message}`);
        return "";
    }
}

async function extractOfficeText(filePath) {
    try {
        const text = await officeParser.parseOfficeAsync(filePath);
        return text;
    } catch (e) {
        console.warn(`[WARN] Could not parse Office text ${filePath}: ${e.message}`);
        return "";
    }
}

async function processSheet(sheetName, sheet) {
    console.log(`\n🤖 Analyzing Sheet: ${sheetName}`);
    
    // 1. Get Raw Text
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    let rawText = "";
    for (const row of data) {
        if (row && row.length > 0) {
            rawText += row.filter(Boolean).join(" | ") + "\n";
        }
    }
    rawText = rawText.trim();
    if (!rawText || rawText.length < 10) {
        console.log(`Skipping ${sheetName} (too short or empty).`);
        return null;
    }

    // 2. Find Linked Files
    const linkedFiles = [];
    for (const file of allMecFiles) {
        const basename = path.basename(file);
        // If the sheet text contains the filename (ignoring case)
        if (rawText.toLowerCase().includes(basename.toLowerCase())) {
            linkedFiles.push(file);
        } else {
            // Also check hyperlinks in the sheet
            for (let cell in sheet) {
                if (sheet[cell].l && sheet[cell].l.Target && sheet[cell].l.Target.toLowerCase().includes(basename.toLowerCase())) {
                    if (!linkedFiles.includes(file)) linkedFiles.push(file);
                }
            }
        }
    }

    // 3. Extract External Content
    let externalText = "";
    let externalImages = [];
    
    for (const file of linkedFiles) {
        console.log(`   📎 Found reference to: ${path.basename(file)}`);
        const ext = path.extname(file).toLowerCase();
        
        if (ext === '.pdf') {
            const text = await extractPdfText(file);
            externalText += `\n\n--- Content from ${path.basename(file)} ---\n${text.substring(0, 5000)}... (truncated)\n`;
        } else if (['.pptx', '.xlsm', '.xlsx', '.docx'].includes(ext)) {
            const text = await extractOfficeText(file);
            externalText += `\n\n--- Content from ${path.basename(file)} ---\n${text.substring(0, 5000)}... (truncated)\n`;
            
            // Extract images from office files
            const imgs = await extractImagesFromZip(file);
            externalImages = externalImages.concat(imgs);
        }
    }

    // 4. Construct AI Prompt
    const messages = [
        {
            role: "system",
            content: "You are an expert mechanical engineering AI. Your job is to extract unstructured engineering guidelines from raw Excel dumps and associated files, and convert them into highly structured, non-repetitive JSON data suitable for a Product Standards website. Combine the insights from the sheet and the external files logically. Remove boilerplate like 'Back to Home Tree'."
        }
    ];

    const contentArray = [
        { type: "text", text: `Here is the raw text from the Excel sheet titled "${sheetName}":\n\n${rawText}` }
    ];

    if (externalText) {
        contentArray.push({ type: "text", text: `\n\nHere is text extracted from referenced external files:\n${externalText}` });
    }

    // Add up to 10 images to avoid context overload
    const imagesToProcess = externalImages.slice(0, 10);
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

    // 5. Call OpenAI
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: messages,
            temperature: 0.1,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "mec_guideline",
                    schema: mecSchema,
                    strict: true
                }
            }
        });

        const jsonContent = response.choices[0].message.content;
        return JSON.parse(jsonContent);
    } catch (e) {
        console.error(`❌ OpenAI API Error on sheet ${sheetName}: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log("Starting MEC AI Full Extraction Pipeline...\n");

    const workbook = xlsx.readFile(EXCEL_PATH);
    const database = [];

    // Skip sheets that are purely TOC or history
    const ignoreSheets = ['MaintantContact-History', 'MEC home-tree'];
    
    for (const sheetName of workbook.SheetNames) {
        if (ignoreSheets.includes(sheetName)) continue;
        
        const sheet = workbook.Sheets[sheetName];
        const aiResult = await processSheet(sheetName, sheet);
        
        if (aiResult) {
            console.log(`   ✅ Successfully parsed ${sheetName} into JSON.`);
            database.push(aiResult);
        }
    }

    // Save output
    fs.writeFileSync(OUT_FILE, JSON.stringify(database, null, 2), 'utf8');
    console.log(`\n🎉 Extraction Complete! Database saved to: ${OUT_FILE}`);
}

main().catch(console.error);
