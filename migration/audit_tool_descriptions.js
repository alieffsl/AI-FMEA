/**
 * Tool Description Audit Script
 *
 * One-time analysis of all tool descriptions in the knowledge base.
 * Outputs a review file showing normalization results and potential duplicates.
 */
import pg from 'pg';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { normalizeToolDescription, levenshteinDistance } from './normalizeToolDescription.js';
dotenv.config();
const pool = new pg.Pool({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
});
async function auditToolDescriptions() {
    console.log('[Audit] Querying distinct tool descriptions from fmea_knowledge_base...');
    const result = await pool.query(`
    SELECT 
      tool_description,
      tool_category,
      COUNT(*) as record_count,
      ARRAY_AGG(DISTINCT toy_num) as sample_toy_nums
    FROM fmea_knowledge_base
    WHERE tool_description IS NOT NULL
    GROUP BY tool_description, tool_category
    ORDER BY COUNT(*) DESC
  `);
    console.log(`[Audit] Found ${result.rows.length} distinct tool descriptions`);
    console.log('');
    // Apply normalization
    const groups = result.rows.map(row => ({
        raw_value: row.tool_description,
        normalized_value: normalizeToolDescription(row.tool_description),
        record_count: parseInt(row.record_count),
        tool_category: row.tool_category || undefined,
        sample_toy_nums: row.sample_toy_nums.slice(0, 3), // Limit to 3 samples
    }));
    // Group by normalized value to find merges
    const normalizedMap = new Map();
    for (const group of groups) {
        const existing = normalizedMap.get(group.normalized_value) || [];
        existing.push(group);
        normalizedMap.set(group.normalized_value, existing);
    }
    // Find groups that will be merged
    const merges = [];
    const noChange = [];
    for (const [normalized, rawGroups] of normalizedMap.entries()) {
        if (rawGroups.length > 1) {
            merges.push({
                normalized,
                raw_values: rawGroups.map(g => g.raw_value),
                total_records: rawGroups.reduce((sum, g) => sum + g.record_count, 0),
            });
        }
        else {
            noChange.push(rawGroups[0]);
        }
    }
    // Find potential duplicates using Levenshtein distance
    const potentialDuplicates = [];
    const normalizedValues = Array.from(normalizedMap.keys()).sort();
    for (let i = 0; i < normalizedValues.length - 1; i++) {
        for (let j = i + 1; j < normalizedValues.length; j++) {
            const val1 = normalizedValues[i];
            const val2 = normalizedValues[j];
            const distance = levenshteinDistance(val1.toLowerCase(), val2.toLowerCase());
            if (distance > 0 && distance < 3) {
                potentialDuplicates.push({ value1: val1, value2: val2, distance });
            }
        }
    }
    // Generate report
    const report = {
        summary: {
            total_raw_descriptions: result.rows.length,
            total_normalized_descriptions: normalizedMap.size,
            groups_to_merge: merges.length,
            potential_duplicates: potentialDuplicates.length,
        },
        merges: merges.slice(0, 50), // Top 50 merges
        potential_duplicates: potentialDuplicates.slice(0, 30), // Top 30 similar
        sample_normalizations: groups.slice(0, 100).map(g => ({
            raw: g.raw_value,
            normalized: g.normalized_value,
            count: g.record_count,
            category: g.tool_category,
            changed: g.raw_value !== g.normalized_value,
        })),
    };
    // Write JSON report
    await fs.writeFile('./tool_description_audit.json', JSON.stringify(report, null, 2));
    // Write CSV for spreadsheet review
    const csvLines = [
        'Raw Value,Normalized Value,Record Count,Category,Changed,Sample Toys',
        ...groups.map(g => `"${g.raw_value}","${g.normalized_value}",${g.record_count},"${g.tool_category || ''}",${g.raw_value !== g.normalized_value ? 'YES' : 'NO'},"${g.sample_toy_nums.join(', ')}"`),
    ];
    await fs.writeFile('./tool_description_audit.csv', csvLines.join('\n'));
    // Console summary
    console.log('============================================================');
    console.log('TOOL DESCRIPTION AUDIT SUMMARY');
    console.log('============================================================');
    console.log(`Total raw descriptions:        ${report.summary.total_raw_descriptions}`);
    console.log(`After normalization:           ${report.summary.total_normalized_descriptions}`);
    console.log(`Groups that will merge:        ${report.summary.groups_to_merge}`);
    console.log(`Potential duplicates to review: ${report.summary.potential_duplicates}`);
    console.log('');
    console.log('Top merges (will consolidate):');
    merges.slice(0, 10).forEach(m => {
        console.log(`  ${m.normalized} ← merges ${m.raw_values.length} variants (${m.total_records} records)`);
        m.raw_values.forEach(v => console.log(`    - "${v}"`));
    });
    console.log('');
    console.log('Potential duplicates (review manually):');
    potentialDuplicates.slice(0, 10).forEach(d => {
        console.log(`  "${d.value1}" ↔ "${d.value2}" (distance: ${d.distance})`);
    });
    console.log('');
    console.log('============================================================');
    console.log('✓ Saved to: tool_description_audit.json');
    console.log('✓ Saved to: tool_description_audit.csv');
    console.log('============================================================');
    await pool.end();
}
auditToolDescriptions().catch(err => {
    console.error('[Audit] Fatal error:', err);
    process.exit(1);
});
