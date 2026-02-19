#!/usr/bin/env bun
import { config } from 'dotenv';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// Load local project config: mcp-firebase.json in cwd
const localConfigPath = resolve(process.cwd(), 'mcp-firebase.json');
const localConfig: Record<string, any> = existsSync(localConfigPath)
    ? JSON.parse(readFileSync(localConfigPath, 'utf-8'))
    : {};

// Load .env: local config > --env-path flag > cwd/.env
const envIdx = process.argv.indexOf('--env-path');
const envPath = resolve(localConfig.envPath || (envIdx !== -1 ? process.argv[envIdx + 1] : '.env'));
config({ path: envPath });

// Fallback: extract databaseURL from FIREBASE_CONFIG if FIREBASE_DATABASE_URL not set
if (!process.env.FIREBASE_DATABASE_URL && process.env.FIREBASE_CONFIG) {
    try {
        const fc = JSON.parse(process.env.FIREBASE_CONFIG);
        if (fc.databaseURL) process.env.FIREBASE_DATABASE_URL = fc.databaseURL;
    } catch {}
}

import { RouterWrapper } from 'edge.libx.js';
import { FirebaseModule } from './firebase';
import { RtdbDAL } from './dal';
import { YamlSync } from './yaml-sync';
import { FileCache } from './file-cache';
import { AuditLog } from './audit';
import { BackupManager } from './backup';
import { registerRoutes } from './routes';

const basePath = localConfig.basePath || process.env.RTDB_BASE_PATH || '/';

// All mcp-firebase working dirs default under .mcp-firebase/ for clean organization
const workDir = localConfig.workDir || '.mcp-firebase';
const localDir = localConfig.localDir || process.env.RTDB_LOCAL_DIR || `${workDir}/dumps/`;

// --- Audit config ---
const auditCfg = localConfig.audit ?? {};
const auditEnabled = auditCfg.enabled !== false; // default: true
const audit = auditEnabled
    ? new AuditLog({
          enabled: true,
          logFile: auditCfg.logFile || `${workDir}/audit/audit.jsonl`,
      })
    : null;

// --- Backup config ---
const backupCfg = localConfig.backup ?? {};
const backupEnabled = backupCfg.enabled !== false; // default: true
const firebase = new FirebaseModule({ basePath });
const dal = new RtdbDAL(firebase);
const yamlSync = new YamlSync(dal, localDir);
const fileCache = new FileCache(localConfig.cacheDir || `${workDir}/cache`);

const backup = backupEnabled
    ? new BackupManager(
          {
              enabled: true,
              dir: backupCfg.dir || `${workDir}/backups/`,
              operations: backupCfg.operations ?? ['put', 'patch', 'delete'],
          },
          yamlSync,
      )
    : null;

const runtimeInfo = {
    cwd: process.cwd(),
    localConfigPath: existsSync(localConfigPath) ? localConfigPath : null,
    envPath,
    basePath,
    workDir,
    dumps: localDir,
    cache: fileCache.dir,
    audit: audit ? { enabled: true, logFile: audit.options.logFile } : { enabled: false },
    backup: backup ? { enabled: true, dir: backup.options.dir, operations: backup.options.operations } : { enabled: false },
    databaseURL: process.env.FIREBASE_DATABASE_URL || null,
};

const rw = RouterWrapper.getNew('/api');
registerRoutes(rw, firebase, dal, yamlSync, fileCache, audit, backup, runtimeInfo);

const mcp = rw.asMCP({
    name: 'mcp-firebase',
    version: '0.1.0',
    instructions: `You are connected to a Firebase Realtime Database (RTDB) via mcp-firebase.

Best practices — follow these always:
- NEVER fetch a path with shallow=false or use get_db_list without first checking its size.
  Always call get_db_keys or get_db (shallow=true, the default) first to see how many children exist.
- For large collections (>20 children), use get_db_query with filters (orderBy + limitToFirst/limitToLast) instead of fetching everything.
- Use get_structure to explore the top-level layout of the database — it is fast and cheap (shallow REST call).
- Prefer get_db (shallow=true) to understand an unknown path before going deeper.
- Write operations (put_db, patch_db, delete_db) auto-backup and audit. Confirm destructive changes with the user first.
- Use get_db_keys to check existence and count before iterating over a collection.
- When looking for a specific record, use get_db_query with equalTo instead of downloading the whole collection.`,
});

if (process.argv.includes('--stdio')) {
    mcp.serveStdio();
} else {
    // HTTP mode
    const { createServer } = await import('http');
    rw.router.all('/mcp', mcp.httpHandler as any);
    rw.catchNotFound();

    const port = Number(process.env.PORT) || 3456;
    const server = createServer(rw.createServerAdapter());
    server.listen(port, () => {
        console.log(`mcp-firebase running on http://localhost:${port}`);
        console.log(`  REST: http://localhost:${port}/api/db?path=`);
        console.log(`  MCP:  http://localhost:${port}/api/mcp`);
        console.log(`  Stdio: mcp-firebase --stdio`);
    });
}
