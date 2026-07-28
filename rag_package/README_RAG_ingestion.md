# Accessories standard baseline - RAG package

Source workbook: `Copy of Standart Accesoris_Updated.xlsx`

## Use these files

- `data/accessories_rag_chunks.jsonl` - primary file for RAG ingestion.
- `data/baseline_checks.csv` - one row per standard/checklist item.
- `data/image_index.csv` - one row per picture occurrence with stable `image_id` and extracted file path.
- `data/drawing_text_index.csv` - text extracted from Excel text boxes and labels.
- `images/original/` - original embedded image files from the workbook.
- `images/thumbnails/` - small thumbnails used by the cleaned workbook.

## Recommended RAG flow

1. Ingest `accessories_rag_chunks.jsonl`.
2. Embed the `text` field.
3. Store all fields under `metadata` for filtering by accessory, standard_id, content_type, and source_sheet.
4. Keep `image_paths` as evidence attachments. For text-only RAG, create human/vision captions for each image and append them to the matching image chunk.
5. Use `Baseline_Checks` as the source of truth for future maintenance: one atomic requirement per row, linked to images by `Evidence_Image_IDs`.

## Counts

- Source worksheets: 18
- Baseline checklist rows: 74
- Checklist rows with text: 63
- Reference rows: 13
- Image occurrences: 81
- Drawing/text labels: 93
- RAG chunks: 268
- Data-quality flags: 19
