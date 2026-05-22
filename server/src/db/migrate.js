import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getPool } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Advisory lock prevents two backends from running migrations concurrently
    await client.query('SELECT pg_advisory_lock(8675309)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         SERIAL PRIMARY KEY,
        filename   VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = ['001_initial.sql', '002_phase3.sql', '003_chat.sql', '004_join_code.sql', '005_files.sql'];

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT id FROM migrations WHERE filename = $1',
        [file]
      );
      if (rows.length > 0) continue;

      const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
      console.log(`Migration applied: ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(8675309)');
    client.release();
  }
}
