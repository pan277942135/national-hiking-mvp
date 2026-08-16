import pg from 'pg';

export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | object;
}

let pool: pg.Pool | null = null;

export function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return {
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'national_hiking',
  };
}

export function getPgPool(): pg.Pool | null {
  if (pool) return pool;
  const config = getDatabaseConfig();
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    try {
      pool = new pg.Pool(config);
      return pool;
    } catch {
      return null;
    }
  }
  return null;
}

export async function checkDatabaseConnection(): Promise<{ connected: boolean; message: string; isPostgis?: boolean }> {
  const p = getPgPool();
  if (!p) {
    return {
      connected: false,
      message: 'No PostgreSQL connection configured (DATABASE_URL not set). Using structured in-memory repository store.'
    };
  }

  try {
    const client = await p.connect();
    try {
      const res = await client.query('SELECT 1 as connected, postgis_version() as postgis');
      return {
        connected: true,
        message: 'Connected to PostgreSQL with PostGIS',
        isPostgis: !!res.rows[0]?.postgis
      };
    } catch {
      return {
        connected: true,
        message: 'Connected to PostgreSQL (PostGIS extension check pending)'
      };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return {
      connected: false,
      message: `Database connection failed: ${(err as Error).message}`
    };
  }
}
