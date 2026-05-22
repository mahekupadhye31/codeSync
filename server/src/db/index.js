import pg from 'pg';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) throw new Error('Database not connected — call connectDB() first');
  return pool;
}

export async function connectDB() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Verify connectivity
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  console.log('PostgreSQL connected');
}

// Convenience wrapper
export async function query(text, params) {
  return getPool().query(text, params);
}
