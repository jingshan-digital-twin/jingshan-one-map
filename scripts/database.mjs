import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local');
const data = resolve(local, 'pgdata');
const dataArg = '.local/pgdata';
const logArg = '.local/postgres.log';
const envFile = resolve(root, '.env');
const adminPasswordFile = resolve(local, 'pg-admin-password');
const postgresBundle = resolve(local, 'postgres', 'bin');
const pgBin = process.env.PG_BIN ?? (existsSync(resolve(postgresBundle, 'postgres.exe')) ? postgresBundle : '');
const host = '127.0.0.1';
const port = 55432;
const database = 'web_screen_dev';
const appUser = 'screen_app';
const adminUser = 'screen_admin';

function postgresTool(name) {
  return pgBin ? resolve(pgBin, `${name}.exe`) : `${name}.exe`;
}

function run(name, args) {
  execFileSync(postgresTool(name), args, { cwd: root, stdio: 'inherit' });
}

function pgctl(args) {
  run('pg_ctl', ['-D', dataArg, ...args]);
}

function isRunning() {
  const result = spawnSync(postgresTool('pg_ctl'), ['-D', dataArg, 'status'], { cwd: root, stdio: 'ignore' });
  if (result.error) throw result.error;
  return result.status === 0;
}

function storedPassword(file) {
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString('hex') + '\n', { flag: 'wx' });
  const value = readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{48}$/.test(value)) throw new Error('Unexpected PostgreSQL password file format.');
  return value;
}

function initialize() {
  mkdirSync(local, { recursive: true });
  const initialized = existsSync(resolve(data, 'PG_VERSION'));
  if (initialized && (!existsSync(adminPasswordFile) || !existsSync(envFile))) {
    throw new Error('Local database is present but its credentials are missing. Restore .env and .local/pg-admin-password.');
  }
  const adminPassword = storedPassword(adminPasswordFile);
  if (!existsSync(envFile)) {
    writeFileSync(envFile, [
      `PGHOST=${host}`, `PGPORT=${port}`, `PGDATABASE=${database}`, `PGUSER=${appUser}`,
      `PGPASSWORD=${randomBytes(24).toString('hex')}`, 'API_PORT=3001', '',
    ].join('\n'), { flag: 'wx' });
  }
  if (!initialized) {
    const initdb = process.env.PG_BIN ? postgresTool('initdb') : 'initdb.exe';
    execFileSync(initdb, ['-D', dataArg, '-U', adminUser, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C', '--pwfile=.local/pg-admin-password'], {
      cwd: root, stdio: 'inherit',
    });
  }
  return adminPassword;
}

async function start() {
  if (isRunning()) return;
  const args = ['-h', host, '-p', String(port)];
  // On Windows the server can inherit pg_ctl's pipes and keep spawnSync waiting after startup.
  const startupLog = resolve(local, 'pg-ctl-start.log');
  const output = openSync(startupLog, 'w');
  let result;
  try {
    result = spawnSync(postgresTool('pg_ctl'), ['-D', dataArg, '-w', '-l', logArg, '-o', args.join(' '), 'start'], {
      cwd: root, stdio: ['ignore', output, output], windowsHide: true,
    });
  } finally {
    closeSync(output);
  }
  if (result.error) throw result.error;
  if (result.status === 0) return;
  const startupMessage = readFileSync(startupLog, 'utf8').trim();
  if (!startupMessage.includes('could not create restricted token')) {
    throw new Error(startupMessage || `PostgreSQL startup failed. See ${logArg}.`);
  }

  const log = openSync(resolve(root, logArg), 'a');
  const child = spawn(postgresTool('postgres'), ['-D', dataArg, ...args], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
  });
  closeSync(log);
  let startupError;
  child.once('error', (error) => { startupError = error; });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(250);
    if (startupError) throw startupError;
    if (child.exitCode !== null) break;
    const status = spawnSync(postgresTool('pg_isready'), ['-h', host, '-p', String(port), '-t', '1'], { stdio: 'ignore' });
    if (status.status === 0 && isRunning()) return;
  }
  throw new Error(`PostgreSQL startup failed. See ${logArg}.`);
}

async function withConnection(user, password, db, action) {
  const client = new pg.Client({ host, port, database: db, user, password, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}

async function setup() {
  const adminPassword = initialize();
  const appPassword = parseEnv(readFileSync(envFile, 'utf8')).PGPASSWORD;
  if (!/^[a-f0-9]{48}$/.test(appPassword ?? '')) throw new Error('Unexpected project password format.');
  await start();
  await withConnection(adminUser, adminPassword, 'postgres', async (client) => {
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [appUser]);
    if (!role.rowCount) await client.query(`CREATE ROLE ${appUser} LOGIN PASSWORD '${appPassword}'`);
    const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!db.rowCount) await client.query(`CREATE DATABASE ${database} OWNER ${appUser}`);
  });
  await withConnection(adminUser, adminPassword, database, async (client) => {
    const available = await client.query("SELECT 1 FROM pg_available_extensions WHERE name = 'postgis'");
    if (available.rowCount) {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
      const { rows } = await client.query('SELECT postgis_lib_version() AS version');
      console.log(`PostGIS ${rows[0].version}`);
    }
  });
  await withConnection(appUser, appPassword, database, (client) => {
    return client.query(readFileSync(resolve(root, 'server', 'schema.sql'), 'utf8'));
  });
  console.log(`PostgreSQL ready at ${host}:${port}/${database}`);
}

const command = process.argv[2];
try {
  if (command === 'setup') {
    await setup();
  } else if (command === 'stop') {
    if (existsSync(resolve(data, 'PG_VERSION')) && isRunning()) {
      pgctl(['-w', '-m', 'fast', 'stop']);
    }
  } else {
    throw new Error('Usage: node scripts/database.mjs setup|stop');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
