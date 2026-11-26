import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { platformIdentity } from './platform-identity.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { jingshanRouter } from './jingshan.ts';
import { workbookOrigin } from './cim-config.ts';
import { allowsDevWriteOrigin } from './write-origin.ts';

interface Project {
  id: number;
  name: string;
  longitude: number;
  latitude: number;
  status: 'draft' | 'published';
}

const pool = new pg.Pool({ connectionTimeoutMillis: 3000 });
pool.on('error', (error) => console.error('PostgreSQL connection error:', error.message));

const app = express();
app.disable('x-powered-by');
const host = process.env.API_HOST ?? '127.0.0.1';
const serveDist = process.env.SERVE_DIST === '1';
const appUser = process.env.APP_USER ?? 'admin';
const appPassword = process.env.APP_PASSWORD;

app.use(platformIdentity(pool, serveDist || process.env.PLATFORM_AUTH === '1', appUser, appPassword));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  const requestHost = req.get('host');
  const allowedOrigin = serveDist
    ? requestHost && (origin === 'http://' + requestHost || origin === 'https://' + requestHost)
    : allowsDevWriteOrigin(origin ?? '', requestHost, process.env.JINGSHAN_DEV_LAN_IP);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && !allowedOrigin) {
    res.status(403).json({ error: '写入请求必须来自同一站点。反向代理需保留 Host 请求头。' });
    return;
  }
  next();
});
app.use('/api/jingshan', jingshanRouter(pool));
app.use(express.json({ limit: '16kb' }));

app.get('/api/health', async (_req, res) => {
  const { rows } = await pool.query<{ database: string }>('SELECT current_database() AS database');
  res.json(serveDist ? { ok: true } : { ok: true, database: rows[0]?.database });
});

async function listPublishedProjects() {
  const { rows } = await pool.query<Project>(
    "SELECT id, name, longitude, latitude, status FROM projects WHERE status = 'published' ORDER BY id DESC",
  );
  return rows;
}

app.get('/api/projects', async (_req, res) => {
  res.json(await listPublishedProjects());
});

app.get('/api/projects/geojson', async (_req, res) => {
  const projects = await listPublishedProjects();
  res.json({
    type: 'FeatureCollection',
    features: projects.map(({ id, name, longitude, latitude }) => ({
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: { id, name },
    })),
  });
});

app.post('/api/projects', async (req, res) => {
  const { name, longitude, latitude } = (req.body ?? {}) as Record<string, unknown>;
  const projectName = typeof name === 'string' ? name.trim() : '';
  if (!projectName || Array.from(projectName).length > 120 || projectName.includes('\0')) {
    res.status(400).json({ error: 'Project name must contain 1 to 120 characters.' });
    return;
  }
  if (
    typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
  ) {
    res.status(400).json({ error: 'Enter numeric longitude (−180 to 180) and latitude (−90 to 90).' });
    return;
  }

  const { rows } = await pool.query<Project>(
    'INSERT INTO projects (name, longitude, latitude) VALUES ($1, $2, $3) RETURNING *',
    [projectName, longitude, latitude],
  );
  res.status(201).json(rows[0]);
});

app.post('/api/projects/:id/publish', async (req, res) => {
  const id = Number(req.params.id);
  if (!/^\d+$/.test(req.params.id) || !Number.isInteger(id) || id < 1 || id > 2_147_483_647) {
    res.status(400).json({ error: 'Enter a valid project ID.' });
    return;
  }

  const { rows } = await pool.query<Project>(
    "UPDATE projects SET status = 'published' WHERE id = $1 RETURNING *",
    [id],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Project was not found.' });
    return;
  }
  res.json(rows[0]);
});

if (serveDist) {
  app.use('/api', (_req, res) => { res.status(404).json({ error: '接口不存在。' }); });
  app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url)), {
    setHeaders(res, path) {
      if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    },
  }));
}

const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: status === 400 ? 'Invalid request.' : 'Request body is too large.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'The API could not complete the request. See the server log.' });
};
app.use(handleError);

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('API_PORT must be an integer from 1 to 65535.');
}
if (serveDist) {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}
if (workbookOrigin) {
  await pool.query(await readFile(new URL('./cim-seed.sql', import.meta.url), 'utf8'), [workbookOrigin]);
}
const server = app.listen(port, host, () => console.log(`HTTP listening on http://${host}:${port}`));
if (serveDist) {
  const stop = () => server.close(() => { void pool.end(); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
