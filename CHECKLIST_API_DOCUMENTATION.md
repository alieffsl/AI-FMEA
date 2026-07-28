# FMEA Historical Checklist API Documentation

## Overview
The FMEA Historical Checklist system provides pre-computed, AI-consolidated checklist entries from 6,485 historical FMEA records. The system uses semantic matching to retrieve relevant concerns and recommendations based on tool descriptions and failure modes.

## Database Statistics
- **660 unique (tool × failure_mode) groups**
- **1,394 checklist entries** (AI-consolidated sub-concerns)
- **2,112 supporting knowledge base records**
- **251 unique tool descriptions**
- **39 unique failure modes**
- **Average 1.5 supporting records per entry**

## API Endpoints

### 1. GET /api/checklist/stats
Get overview statistics for the checklist system.

**Response:**
```json
{
  "overview": {
    "unique_groups": "660",
    "total_entries": "1394",
    "total_supporting": "2112",
    "avg_supporting": "1.52",
    "unique_tools": "251",
    "unique_failure_modes": "39"
  },
  "topTools": [...],
  "topFailureModes": [...]
}
```

### 2. GET /api/checklist/match
Match checklist entries for a single tool + failure mode.

**Query Parameters:**
- `toolDescription` (required): Tool description (e.g., "Shoes-RT", "Necklace")
- `failureMode` (required): Failure mode (e.g., "Mix-up assembly", "First Shot Failure")
- `threshold` (optional, default 0.75): Minimum similarity score (0-1)
- `limit` (optional, default 10): Maximum results to return

**Example Request:**
```
GET /api/checklist/match?toolDescription=Shoes-RT&failureMode=Mix-up%20assembly
```

**Response:**
```json
{
  "matches": [
    {
      "id": "20ab4c11-9869-49c0-8b31-5756e013e94c",
      "tool_description_normalized": "Shoes RT",
      "tool_category": "shoes",
      "failure_mode": "Mix-up assembly",
      "sub_concern_index": 1,
      "concern": "Absence of clear identification features on the right shoe contributes to assembly errors.",
      "recommendation": "Add a plastic tab and flag on the right shoe for clear identification.",
      "supporting_record_count": 5,
      "supporting_record_ids": ["607347af-588c-4975-a25c-e8577f4bab8c", ...],
      "supporting_failure_ids": [570, 7010, 479, 485, 519],
      "similarity": 1.0
    },
    ...
  ],
  "count": 5,
  "toolDescription": "Shoes-RT",
  "failureMode": "Mix-up assembly"
}
```

### 3. POST /api/checklist/match-batch
Match checklist entries for multiple tools in a single request.

**Request Body:**
```json
{
  "tools": [
    { "toolDescription": "Necklace", "failureMode": "Sharp point" },
    { "toolDescription": "Earring-LT", "failureMode": "Broken part (Function)" }
  ],
  "threshold": 0.75,
  "maxResultsPerTool": 5
}
```

**Response:**
```json
{
  "results": {
    "Necklace||Sharp point": [...],
    "Earring-LT||Broken part (Function)": [...]
  },
  "totalTools": 2,
  "totalMatches": 8
}
```

### 4. GET /api/checklist/failure-modes
Get list of all available failure modes with entry counts.

**Response:**
```json
{
  "failureModes": [
    { "failure_mode": "First Shot Failure", "entry_count": "369" },
    { "failure_mode": "Improper function", "entry_count": "285" },
    ...
  ]
}
```

## Matching Algorithm

### 1. Exact Match (Priority)
- Normalizes tool description using shared rules
- Searches for exact match on (normalized_tool_description, failure_mode)
- Returns all matching sub-concerns sorted by supporting count

### 2. Semantic Fallback
- If no exact match, searches within same failure_mode
- Uses text similarity based on common words
- Returns matches above similarity threshold
- Sorts by similarity score and supporting count

## Tool Description Normalization

Tool descriptions are normalized to improve matching:

**Rules:**
1. Strip leading tool number patterns (e.g., "JJB33-001-torso-ft" → "torso-ft")
2. Replace separators (hyphens, underscores, periods) with spaces
3. Collapse multiple spaces
4. Apply Title Case with uppercase preservation (LT, RT, FT, NS, FS)
5. Apply confident pluralization (shoes → Shoe, accessories → Accessory)

**Examples:**
- "Shoes-Rt" → "Shoes RT"
- "earrings lt" → "Earrings LT"
- "JJB33-001-torso-ft" → "Torso FT"

## Top Tools (by entry count)

1. Torso FT - 43 entries
2. Necklace - 41 entries
3. Earring LT - 27 entries
4. Shoe - 20 entries
5. Shoes RT - 20 entries

## Top Failure Modes (by entry count)

1. First Shot Failure - 369 entries
2. Improper function - 285 entries
3. Fail abuse - 94 entries
4. Mix-up assembly - 84 entries
5. Cost Saving - 72 entries

## Integration Guide

### Frontend Usage Example
```typescript
// Fetch checklist for a single tool
const response = await fetch(
  `/api/checklist/match?` +
  `toolDescription=${encodeURIComponent(tool.description)}` +
  `&failureMode=${encodeURIComponent(failureMode)}`
);
const data = await response.json();

// Display matches
data.matches.forEach(entry => {
  console.log(`Concern: ${entry.concern}`);
  console.log(`Recommendation: ${entry.recommendation}`);
  console.log(`Supported by ${entry.supporting_record_count} records`);
});
```

### Batch Processing Example
```typescript
// Match checklist for multiple tools
const tools = [
  { toolDescription: "Necklace", failureMode: "Sharp point" },
  { toolDescription: "Earring-LT", failureMode: "Broken part (Function)" }
];

const response = await fetch('/api/checklist/match-batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tools, maxResultsPerTool: 5 })
});

const data = await response.json();
// Access results by key: data.results["Necklace||Sharp point"]
```

## Server Configuration

**Port:** 3001  
**CORS:** Enabled  
**Database:** PostgreSQL (AWS RDS)  
**Dependencies:**
- express
- pg (PostgreSQL client)
- dotenv

## Files

- `server/index.ts` - Main server file with API endpoints
- `server/checklistService.ts` - Core matching logic
- `server/normalizeToolDescription.ts` - Shared normalization function
- `migration/generate_checklist.ts` - Checklist generation pipeline
- `migration/normalizeToolDescription.ts` - Original normalization implementation

## Next Steps

### Phase 5: Frontend UI
- Create `HistoricalChecklist.tsx` component
- Integrate into Generate Draft page
- Display checklist matches grouped by failure_mode
- Auto-fetch on tool selection
- Show concern/recommendation cards with supporting count

### Future Enhancements
- Implement true embedding-based semantic search with OpenAI API
- Add caching layer for frequently accessed matches
- Implement fuzzy matching for typos
- Add user feedback mechanism to improve match quality
