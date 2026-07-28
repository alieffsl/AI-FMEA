import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const config: sql.config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER || '',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME,
  options: {
    encrypt: true, 
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise: Promise<sql.ConnectionPool>;

export function getPool() {
  if (!poolPromise) {
    console.log('[DB] Connecting to SQL Server...');
    poolPromise = sql.connect(config)
      .then(pool => {
        console.log('[DB] Connected successfully to Proddev.');
        return pool;
      })
      .catch(err => {
        console.error('[DB] Connection failed:', err);
        throw err;
      });
  }
  return poolPromise;
}

// Ensure connection is closed when the app shuts down
process.on('SIGINT', async () => {
  if (poolPromise) {
    const pool = await poolPromise;
    pool.close();
    console.log('[DB] Connection closed.');
  }
  process.exit(0);
});
