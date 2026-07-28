/**
 * Create fmea_checklist table in PostgreSQL
 * 
 * Run: npx ts-node --esm create_checklist_table.ts
 */

import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

async function run() {
  const pool = new Pool({
    host: process.env.PG_HOST,
    port: parseInt(process.env.PG_PORT ?? '5432', 10),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log('[Setup] Connecting to PostgreSQL...');

    // Check if pgvector extension is available
    let hasPgvector = false;
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      hasPgvector = true;
      console.log('[Setup] pgvector extension enabled.');
    } catch (err) {
      console.warn('[Setup] pgvector extension NOT available. Will use JSONB for embeddings.');
    }

    // Drop existing table if needed (for development)
    const dropFirst = process.env.DROP_TABLE === 'true';
    if (dropFirst) {
      console.log('[Setup] Dropping existing fmea_checklist table...');
      await pool.query('DROP TABLE IF EXISTS fmea_checklist');
    }

    // Create the table
    const embeddingType = hasPgvector ? 'VECTOR(1536)' : 'JSONB';
    
    const createSQL = `
      CREATE TABLE IF NOT EXISTS fmea_checklist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        
        -- Grouping keys
        tool_description_normalized VARCHAR(255) NOT NULL,
        tool_category VARCHAR(100),
        failure_mode VARCHAR(255) NOT NULL,
        
        -- AI-generated content (sub-concerns from Option C)
        sub_concern_index INT NOT NULL DEFAULT 1,
        concern TEXT NOT NULL,
        recommendation TEXT,
        
        -- Provenance
        supporting_record_count INT NOT NULL DEFAULT 0,
        supporting_record_ids UUID[] NOT NULL DEFAULT '{}',
        
        -- Embedding for semantic matching
        embedding ${embeddingType},
        
        -- Metadata
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        -- Composite uniqueness
        UNIQUE(tool_description_normalized, failure_mode, sub_concern_index)
      );
    `;

    await pool.query(createSQL);
    console.log('[Setup] Table fmea_checklist created.');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_checklist_tool_desc 
        ON fmea_checklist(tool_description_normalized);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_checklist_failure 
        ON fmea_checklist(failure_mode);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_checklist_category 
        ON fmea_checklist(tool_category);
    `);

    // If pgvector is available, create a vector similarity index
    if (hasPgvector) {
      try {
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_checklist_embedding 
            ON fmea_checklist USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        `);
        console.log('[Setup] Vector similarity index created.');
      } catch (err) {
        // IVFFlat needs enough rows to create lists, might fail on empty table
        console.warn('[Setup] Could not create IVFFlat index (may need data first). Will create after data load.');
      }
    }

    console.log('[Setup] All indexes created.');

    // Verify
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'fmea_checklist'
      ORDER BY ordinal_position
    `);
    
    console.log('\n[Setup] Table schema:');
    for (const row of result.rows) {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    }

    console.log('\n[Setup] Done.');
  } catch (error) {
    console.error('[Setup] Error:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
