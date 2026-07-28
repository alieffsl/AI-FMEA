import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export async function generateFmeaRows(tools: any[], historicalData: any[]) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  const prompt = `
You are an expert Tooling FMEA Engineer. Your task is to generate FMEA draft rows for the provided new tools.
You have been provided with highly specific "Historical Failure Data" that matches the exact "Tool Descriptions" (e.g. Snake, Ear, Hand) in the new tools.

Historical Failure Data mapped by Tool Description:
${JSON.stringify(historicalData, null, 2)}

New Tools to Evaluate:
${JSON.stringify(tools.map(t => ({ toolNo: t.toolNo, toolDescription: t.toolDescription, material: t.material })), null, 2)}

Instructions:
1. For each New Tool, look at its "toolDescription". Find the matching historical data block above.
2. If historical data exists for that tool description, extract the "potential_failure", the exact "recom_act" (Recommended Action), and the severity/occurrence/detection scores. Use these exact learnings for the new tool! This is critical for our organizational learning.
3. If no historical data exists for a tool, infer realistic injection molding tooling failures (e.g., Short Shot, Flash, Sink Marks) and assign realistic scores based on material and tool description.
4. Calculate RPN = severity * occurrence * detection.
5. Return the result strictly as a JSON Array of objects matching this exact TypeScript interface:

Array<{
  id: string; // unique uuid
  toolRowId: string; // the toolNo
  toolNo: string;
  partDescription: string;
  processStep: string; // e.g. "Injection Molding"
  potentialFailureMode: string;
  potentialEffect: string;
  severity: number;
  potentialCause: string;
  occurrence: number;
  currentPreventionControl: string;
  currentDetectionControl: string;
  detection: number;
  rpn: number;
  recommendedAction: string;
  responsibleFunction: string; // e.g. "Tooling Engineer"
  targetDate: string; // leave empty ""
  evidenceUsed: string[]; // List string descriptions of historical data used to make this decision
  confidence: "High" | "Medium" | "Low";
  confidenceScore: number; // 0-100
  aiRationale: string;
  status: "draft";
  reviewerNotes: string; // leave empty ""
  baselineStandards: any[]; // empty array []
  imageUrl?: string;
}>

Do NOT include markdown block formatting like \`\`\`json. Output ONLY the raw JSON array string.
`;

  console.log('[AI] Calling Gemini API...');
  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim().replace(/^```json/g, '').replace(/```$/g, '').trim();
    return JSON.parse(responseText);
  } catch (e: any) {
    console.error("[AI] Gemini failed. Falling back to deterministic RAG mapping.", e.message);
    
    // Deterministic fallback: exactly copy the historical data
    return tools.map(t => {
      // Find history for this tool
      const history = historicalData.find(h => h.toolDescription === t.toolDescription)?.history;
      const bestMatch = history && history.length > 0 ? history[0] : null;

      return {
        id: Math.random().toString(36).substring(7),
        toolRowId: t.toolNo || '',
        toolNo: t.toolNo || '',
        partDescription: t.toolDescription || '',
        processStep: 'Injection Molding',
        potentialFailureMode: bestMatch ? bestMatch.potential_failure : 'Flash / Short Shot (Fallback)',
        potentialEffect: bestMatch ? 'Part rejection' : 'Poor cosmetics',
        severity: bestMatch ? parseInt(bestMatch.severity) || 5 : 5,
        potentialCause: 'Process variation or mold design issue',
        occurrence: bestMatch ? parseInt(bestMatch.occurrence) || 3 : 3,
        currentPreventionControl: 'Standard mold flow analysis',
        currentDetectionControl: 'Visual inspection',
        detection: bestMatch ? parseInt(bestMatch.detection) || 3 : 3,
        rpn: bestMatch ? (parseInt(bestMatch.severity) || 5) * (parseInt(bestMatch.occurrence) || 3) * (parseInt(bestMatch.detection) || 3) : 45,
        recommendedAction: bestMatch ? bestMatch.recom_act : 'Adjust injection pressure and check gating.',
        responsibleFunction: 'Tooling Engineer',
        targetDate: '',
        evidenceUsed: bestMatch ? ['Matched previous tool: ' + bestMatch.matched_tool] : ['General best practice'],
        confidence: bestMatch ? 'High' : 'Low',
        confidenceScore: bestMatch ? 95 : 40,
        aiRationale: bestMatch ? 'Direct match from historical database' : 'Fallback generated without DB match.',
        status: 'draft',
        reviewerNotes: '',
        baselineStandards: [],
        imageUrl: bestMatch && bestMatch.recommendationImg ? `http://ptmi/INSIDE/Upload/FMEA/Recommendation/${bestMatch.recommendationImg}` : undefined
      };
    });
  }
}
