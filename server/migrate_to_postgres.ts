import { getPool } from './db';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../migration/.env') });

const { Pool } = pg;

async function migrateData() {
  const mssqlPool = await getPool();
  const pgPool = new Pool({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT || '5432'),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('[Migration] Connected to MSSQL and PostgreSQL.');

    // 1. Migrate Projects (fmea_toy)
    console.log('[Migration] Migrating Projects...');
    const toysResult = await mssqlPool.request().query(`SELECT ID, toynum, toydesc FROM fmea_toy`);
    for (const toy of toysResult.recordset) {
      if (toy.toynum && toy.toydesc) {
        await pgPool.query(
          `INSERT INTO fmea_projects (project_code, project_name) 
           VALUES ($1, $2) 
           ON CONFLICT (project_code) DO NOTHING`,
          [toy.toynum.toString(), toy.toydesc]
        );
      }
    }
    console.log('[Migration] Projects migrated.');

    // 2. Migrate Tools (new_tool)
    console.log('[Migration] Migrating Tools...');
    const toolsResult = await mssqlPool.request().query(`
      SELECT ID, ToolNum, Description, Resin, InsertMatl, Gate, Cav, PartWeight, ToyNum 
      FROM new_tool
    `);
    for (const tool of toolsResult.recordset) {
      if (tool.ToolNum) {
        if (tool.ToyNum) {
          // Ensure project exists to satisfy foreign key
          await pgPool.query(
            `INSERT INTO fmea_projects (project_code, project_name) 
             VALUES ($1, $2) 
             ON CONFLICT (project_code) DO NOTHING`,
            [tool.ToyNum.toString(), 'Unknown Project']
          );
        }

        await pgPool.query(
          `INSERT INTO fmea_tools (project_code, tool_no, description, material, mold_material, gate_type, cavity, part_weight_g) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
           ON CONFLICT (tool_no) DO NOTHING`,
          [
            tool.ToyNum ? tool.ToyNum.toString() : null,
            tool.ToolNum.toString(),
            tool.Description,
            tool.Resin,
            tool.InsertMatl,
            tool.Gate,
            tool.Cav,
            tool.PartWeight
          ]
        );
      }
    }
    console.log('[Migration] Tools migrated.');

    // 3. Update fmea_knowledge_base with S/O/D and unpack timeline
    console.log('[Migration] Processing FMEA cases timeline and S/O/D...');
    const kbResult = await pgPool.query(`
      SELECT id, toy_num, failure_mode
      FROM fmea_knowledge_base
    `);

    let updatedCount = 0;
    let timelineCount = 0;

    for (const kb of kbResult.rows) {
      // Find matching S/O/D in MSSQL and the original potential ID
      const sodResult = await mssqlPool.request()
        .input('failure', kb.failure_mode)
        .input('toy_num', kb.toy_num)
        .query(`
          SELECT 
            p.ID as legacy_id,
            AVG(CAST(p.sevNum AS INT)) as sev,
            AVG(CAST(p.occNum AS INT)) as occ,
            AVG(CAST(p.detNum AS INT)) as det,
            AVG(CAST(p.riskNum AS INT)) as rpn
          FROM fmea_potential p
          LEFT JOIN new_tool nt ON p.ToolID = nt.ID
          WHERE p.Failure = @failure AND nt.ToyNum = @toy_num
            AND ISNUMERIC(p.sevNum) = 1 AND ISNUMERIC(p.occNum) = 1 AND ISNUMERIC(p.detNum) = 1
          GROUP BY p.ID
        `);

      if (sodResult.recordset.length > 0 && sodResult.recordset[0].sev) {
        const sod = sodResult.recordset[0];
        const legacyId = sod.legacy_id;
        
        await pgPool.query(`
          UPDATE fmea_knowledge_base 
          SET severity = $1, occurrence = $2, detection = $3, rpn = $4, legacy_potential_id = $5
          WHERE id = $6
        `, [Math.round(sod.sev), Math.round(sod.occ), Math.round(sod.det), Math.round(sod.rpn), legacyId, kb.id]);
        updatedCount++;

        // Unpack timeline directly from MSSQL using legacyId
        const recResult = await mssqlPool.request().input('caseId', legacyId).query(`SELECT Recommendation, Input_by FROM fmea_recommendation WHERE Failure_ID = @caseId`);
        for (const rec of recResult.recordset) {
          if (rec.Recommendation) {
            await pgPool.query(`INSERT INTO fmea_case_timeline (knowledge_base_id, event_type, description, logged_by, logged_at) VALUES ($1, $2, $3, $4, NOW())`, [kb.id, 'recommendation', rec.Recommendation, rec.Input_by || 'System']);
            timelineCount++;
          }
        }

        const firstResult = await mssqlPool.request().input('caseId', legacyId).query(`SELECT ID, first as finding, inputBy FROM fmea_first WHERE failureID = @caseId`);
        for (const f of firstResult.recordset) {
          if (f.finding) {
            await pgPool.query(`INSERT INTO fmea_case_timeline (knowledge_base_id, event_type, description, logged_by, logged_at) VALUES ($1, $2, $3, $4, NOW())`, [kb.id, 'first_shot', f.finding, f.inputBy || 'System']);
            timelineCount++;
            
            const firstRecResult = await mssqlPool.request().input('firstId', f.ID).query(`SELECT firstRec, inputBy FROM fmea_firstRec WHERE firstID = @firstId`);
            for (const r of firstRecResult.recordset) {
              if (r.firstRec) {
                await pgPool.query(`INSERT INTO fmea_case_timeline (knowledge_base_id, event_type, description, logged_by, logged_at) VALUES ($1, $2, $3, $4, NOW())`, [kb.id, 'first_shot_action', r.firstRec, r.inputBy || 'System']);
                timelineCount++;
              }
            }
          }
        }

        const nextResult = await mssqlPool.request().input('caseId', legacyId).query(`SELECT next as finding, inputBy FROM fmea_next WHERE failureID = @caseId`);
        for (const n of nextResult.recordset) {
          if (n.finding) {
            await pgPool.query(`INSERT INTO fmea_case_timeline (knowledge_base_id, event_type, description, logged_by, logged_at) VALUES ($1, $2, $3, $4, NOW())`, [kb.id, 'next_shot', n.finding, n.inputBy || 'System']);
            timelineCount++;
          }
        }
      }
    }
    console.log(`[Migration] Updated S/O/D for ${updatedCount} KB records.`);
    console.log(`[Migration] Unpacked ${timelineCount} timeline events.`);
    
    console.log('[Migration] Script completed fully!');
  } catch (error) {
    console.error('[Migration] Fatal error:', error);
  } finally {
    await pgPool.end();
    process.exit(0);
  }
}

migrateData();
