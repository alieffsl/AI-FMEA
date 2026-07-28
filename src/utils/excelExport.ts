import * as XLSX from 'xlsx';
import type { FmeaDraftRow } from '../types/fmea';

/**
 * Export FMEA draft rows to Excel file
 * Structure: Tool No | Part Description | Failure Mode | Source | Concern | Recommendation
 */
export function exportFmeaToExcel(rows: FmeaDraftRow[]): void {
  // Prepare data for Excel
  const excelData: any[] = [];
  
  rows.forEach(row => {
    const hasChecklist = row.checklistEntries && row.checklistEntries.length > 0;
    
    if (hasChecklist) {
      // Add Previous FMEA entries
      row.checklistEntries!.forEach((entry) => {
        excelData.push({
          'Tool No': row.toolNo,
          'Part Description': row.partDescription,
          'Failure Mode': row.potentialFailureMode,
          'Source': 'Previous FMEA',
          'Concern': entry.concern,
          'Recommendation': entry.recommendation,
          'Supporting Cases': entry.supporting_record_count,
          'Similarity': entry.similarity ? `${Math.round(entry.similarity * 100)}%` : 'N/A',
          'S': row.severity,
          'O': row.occurrence,
          'D': row.detection,
          'RPN': row.rpn
        });
      });
    } else {
      // No checklist data available
      excelData.push({
        'Tool No': row.toolNo,
        'Part Description': row.partDescription,
        'Failure Mode': row.potentialFailureMode,
        'Source': 'Previous FMEA',
        'Concern': 'No previous FMEA data available',
        'Recommendation': '-',
        'Supporting Cases': 0,
        'Similarity': 'N/A',
        'S': row.severity,
        'O': row.occurrence,
        'D': row.detection,
        'RPN': row.rpn
      });
    }
    
    // Add MEC Standard placeholder row
    excelData.push({
      'Tool No': row.toolNo,
      'Part Description': row.partDescription,
      'Failure Mode': row.potentialFailureMode,
      'Source': 'MEC & Tooling Standard',
      'Concern': 'Coming soon',
      'Recommendation': 'Coming soon',
      'Supporting Cases': '-',
      'Similarity': '-',
      'S': row.severity,
      'O': row.occurrence,
      'D': row.detection,
      'RPN': row.rpn
    });
  });
  
  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(excelData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 15 }, // Tool No
    { wch: 20 }, // Part Description
    { wch: 20 }, // Failure Mode
    { wch: 25 }, // Source
    { wch: 40 }, // Concern
    { wch: 40 }, // Recommendation
    { wch: 15 }, // Supporting Cases
    { wch: 10 }, // Similarity
    { wch: 5 },  // S
    { wch: 5 },  // O
    { wch: 5 },  // D
    { wch: 6 }   // RPN
  ];
  
  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'FMEA Draft');
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const filename = `FMEA_Draft_${timestamp}.xlsx`;
  
  // Download file
  XLSX.writeFile(workbook, filename);
  
  console.log(`[Export] Generated ${filename} with ${excelData.length} rows`);
}
