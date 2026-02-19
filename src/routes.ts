import { IRequest } from 'itty-router';
import { RouterWrapper } from 'edge.libx.js';
import { FirebaseModule } from './firebase';
import { RtdbDAL } from './dal';
import { YamlSync } from './yaml-sync';
import { FileCache } from './file-cache';
import { AuditLog, AuditOp } from './audit';
import { BackupManager } from './backup';
import { readFileSync, existsSync } from 'fs';

/** Extract first value from query param (may be string or string[]) */
const q = (v: any, fallback = ''): string => (Array.isArray(v) ? v[0] : v) || fallback;

/** Shallow summary of data: top-level keys with type/count metadata */
function shallowSummary(data: any): any {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return { type: 'array', length: data.length };
    const summary: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) summary[key] = { type: 'array', length: value.length };
        else if (typeof value === 'object' && value !== null) summary[key] = { type: 'object', childCount: Object.keys(value).length };
        else summary[key] = { type: typeof value, value };
    }
    return summary;
}

/** Wrap a write operation with auto-backup + audit */
async function withAudit(
    op: AuditOp,
    path: string,
    audit: AuditLog | null,
    backup: BackupManager | null,
    fn: () => Promise<any>,
): Promise<{ result: any; auditEntry?: any }> {
    const id = audit?.makeId() ?? new Date().toISOString().replace(/[:.]/g, '-');
    const t0 = Date.now();
    let backupFile: string | undefined;

    // Auto-backup before risky write
    if (backup && backup.options.enabled && backup.options.operations?.includes(op)) {
        try {
            backupFile = await backup.backup(path, op, id);
        } catch (e: any) {
            // Non-fatal: log but don't block the operation
            console.warn(`[mcp-firebase] backup failed for ${op} ${path}: ${e.message}`);
        }
    }

    let status: 'ok' | 'error' = 'ok';
    let error: string | undefined;
    let result: any;

    try {
        result = await fn();
    } catch (e: any) {
        status = 'error';
        error = e.message || String(e);
        throw e;
    } finally {
        if (audit && audit.options.enabled) {
            audit.append({
                id,
                ts: new Date().toISOString(),
                op,
                path,
                status,
                ...(backupFile && { backupFile }),
                ...(error && { error }),
                durationMs: Date.now() - t0,
            });
        }
    }

    return { result, auditEntry: { id, backupFile } };
}

export function registerRoutes(
    rw: RouterWrapper,
    firebase: FirebaseModule,
    dal: RtdbDAL,
    yamlSync: YamlSync,
    fileCache: FileCache,
    audit: AuditLog | null,
    backup: BackupManager | null,
    runtimeInfo: Record<string, any> = {},
) {

    // --- DB CRUD ---

    rw.router.get('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const shallow = q(req.query.shallow, 'true') !== 'false';
        const data = await firebase.get(path);
        if (shallow) return shallowSummary(data);
        return fileCache.write('get_db', path, data);
    });

    rw.router.put('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        const { auditEntry } = await withAudit('put', path, audit, backup, () => firebase.set(path, body));
        return { ok: true, path, ...auditEntry };
    });

    rw.router.patch('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        const { auditEntry } = await withAudit('patch', path, audit, backup, () => firebase.update(path, body));
        return { ok: true, path, ...auditEntry };
    });

    rw.router.delete('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const { auditEntry } = await withAudit('delete', path, audit, backup, () => firebase.delete(path));
        return { ok: true, deleted: path, ...auditEntry };
    });

    // --- DB list/keys/push/query ---

    rw.router.get('/db/list', async (req: IRequest) => {
        const path = q(req.query.path);
        const data = await dal.list(path);
        return fileCache.write('list_db', path, data);
    });

    rw.router.get('/db/keys', async (req: IRequest) => {
        const path = q(req.query.path);
        return await dal.keys(path);
    });

    rw.router.post('/db/push', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        let key: string | null = null;
        const { auditEntry } = await withAudit('push', path, audit, backup, async () => {
            key = await firebase.push(path, body);
        });
        return { ok: true, key, path: `${path}/${key}`, ...auditEntry };
    });

    rw.router.get('/db/query', async (req: IRequest) => {
        const path = q(req.query.path);
        const opts: any = {};
        if (req.query.orderBy) opts.orderBy = q(req.query.orderBy);
        if (req.query.equalTo !== undefined) opts.equalTo = q(req.query.equalTo);
        if (req.query.limitToFirst) opts.limitToFirst = Number(q(req.query.limitToFirst));
        if (req.query.limitToLast) opts.limitToLast = Number(q(req.query.limitToLast));
        if (req.query.startAt !== undefined) opts.startAt = q(req.query.startAt);
        if (req.query.endAt !== undefined) opts.endAt = q(req.query.endAt);
        const data = await firebase.query(path, opts);
        return fileCache.write('query_db', path, data);
    });

    // --- File ops ---

    rw.router.post('/files/dump', async (req: IRequest) => {
        const body = await req.json();
        const path = body.path;
        if (!path) throw { status: 400, message: 'path is required in body' };
        const filePath = await yamlSync.dump(path, body.filename);
        return { ok: true, file: filePath };
    });

    rw.router.post('/files/load', async (req: IRequest) => {
        const body = await req.json();
        const filename = body.filename;
        if (!filename) throw { status: 400, message: 'filename is required in body' };
        const { auditEntry } = await withAudit('load', filename, audit, null, async () => {
            await yamlSync.load(filename);
        });
        return { ok: true, path: filename, ...auditEntry };
    });

    rw.router.get('/files/list', () => {
        return yamlSync.listFiles();
    });

    rw.router.get('/files/read', (req: IRequest) => {
        const filename = q(req.query.filename);
        if (!filename) throw { status: 400, message: 'filename query param is required' };
        return yamlSync.readFile(filename);
    });

    // --- Backup ops ---

    rw.router.post('/backup', async (req: IRequest) => {
        if (!backup) throw { status: 503, message: 'backup is disabled' };
        const body = await req.json().catch(() => ({}));
        const path = body.path || '';
        const file = await backup.backup(path, undefined, undefined);
        return { ok: true, file, path };
    });

    rw.router.get('/backup/list', (req: IRequest) => {
        if (!backup) throw { status: 503, message: 'backup is disabled' };
        const op = q(req.query.op) as AuditOp | '';
        const path = q(req.query.path);
        return backup.list({ ...(op && { op }), ...(path && { path }) });
    });

    rw.router.get('/backup/read', (req: IRequest) => {
        if (!backup) throw { status: 503, message: 'backup is disabled' };
        const filename = q(req.query.filename);
        if (!filename) throw { status: 400, message: 'filename query param is required' };
        return yamlSync.readFile(filename, backup.options.dir);
    });

    rw.router.post('/backup/restore', async (req: IRequest) => {
        if (!backup) throw { status: 503, message: 'backup is disabled' };
        const body = await req.json();
        const filename = body.filename;
        if (!filename) throw { status: 400, message: 'filename is required in body' };
        const restoredPath = await backup.restore(filename);
        if (audit && audit.options.enabled) {
            audit.append({
                id: audit.makeId(),
                ts: new Date().toISOString(),
                op: 'load',
                path: restoredPath,
                status: 'ok',
                backupFile: filename,
            });
        }
        return { ok: true, restoredPath, filename };
    });

    // --- Audit ops ---

    rw.router.get('/audit/list', (req: IRequest) => {
        if (!audit) throw { status: 503, message: 'audit is disabled' };
        const op = q(req.query.op) as AuditOp | '';
        const path = q(req.query.path);
        const limit = req.query.limit ? Number(q(req.query.limit)) : 50;
        return audit.list({ ...(op && { op }), ...(path && { path }), limit });
    });

    // --- Structure & rules ---

    rw.router.get('/structure', async () => {
        // Uses ?shallow=true REST query — only fetches top-level keys, no child data downloaded
        const keys = await firebase.getShallow('');
        if (!keys || typeof keys !== 'object') return keys;
        return Object.fromEntries(Object.keys(keys).map(k => [k, true]));
    });

    rw.router.get('/rules', () => {
        const rulesPath = 'database.rules.json';
        if (!existsSync(rulesPath)) throw { status: 404, message: 'database.rules.json not found in cwd' };
        return JSON.parse(readFileSync(rulesPath, 'utf-8'));
    });

    rw.router.get('/config', () => runtimeInfo);

    // --- MCP descriptions ---

    rw.describeMCP('/db', 'GET', {
        description: 'Read data at any RTDB path. Default: shallow=true returns keys with type/count summary inline. Set shallow=false to fetch full data written to a temp file (returns metadata + file path for you to read). IMPORTANT: Before fetching with shallow=false on any unknown or large path, always check size first using get_db_keys or get_db with shallow=true. Never fetch a deep/full path blindly.',
        params: {
            path: { description: 'RTDB path (e.g. "users/abc", "courses"). Empty = root.' },
            shallow: { description: 'If "true" (default), returns shallow key summary. If "false", writes full data to file and returns metadata + file path. Only use false after confirming the path is small.' },
        },
    });
    rw.describeMCP('/db', 'PUT', {
        description: 'Set (replace) data at an RTDB path. Auto-backs up the path before writing and appends an audit entry.',
        params: {
            path: { description: 'RTDB path to write to', required: true },
            body: { description: 'JSON data to set at the path' },
        },
    });
    rw.describeMCP('/db', 'PATCH', {
        description: 'Merge-update data at an RTDB path (shallow merge). Auto-backs up the path before writing and appends an audit entry.',
        params: {
            path: { description: 'RTDB path to update', required: true },
            body: { description: 'JSON data to merge at the path' },
        },
    });
    rw.describeMCP('/db', 'DELETE', {
        description: 'Remove data at an RTDB path. Auto-backs up the path before deleting and appends an audit entry.',
        params: { path: { description: 'RTDB path to delete', required: true } },
    });
    rw.describeMCP('/db/list', 'GET', {
        description: 'List children at an RTDB path as an array. Returns metadata + file path (use file-reading tools to inspect data). WARNING: Downloads all child data. Use get_db_keys first to check how many children exist before calling this.',
        params: { path: { description: 'RTDB path to list children of' } },
    });
    rw.describeMCP('/db/keys', 'GET', {
        description: 'List child keys at an RTDB path. Use this first to check the size/count of a collection before fetching full data with get_db or get_db_list.',
        params: { path: { description: 'RTDB path to list keys of' } },
    });
    rw.describeMCP('/db/push', 'POST', {
        description: 'Push a new child with auto-generated key at an RTDB path. Appends an audit entry.',
        params: {
            path: { description: 'RTDB path to push to', required: true },
            body: { description: 'JSON data for the new child' },
        },
    });
    rw.describeMCP('/db/query', 'GET', {
        description: 'Query RTDB with orderBy, equalTo, limitToFirst, limitToLast, startAt, endAt. Returns metadata + file path (use file-reading tools to inspect data).',
        params: {
            path: { description: 'RTDB path to query' },
            orderBy: { description: 'Child key to order by' },
            equalTo: { description: 'Value to filter by (used with orderBy)' },
            limitToFirst: { description: 'Limit to first N results' },
            limitToLast: { description: 'Limit to last N results' },
            startAt: { description: 'Start at value (used with orderBy)' },
            endAt: { description: 'End at value (used with orderBy)' },
        },
    });
    rw.describeMCP('/files/dump', 'POST', {
        description: 'Dump an RTDB path to a local YAML file for inspection.',
        params: { body: { description: 'JSON with "path" (required) and optional "filename"' } },
    });
    rw.describeMCP('/files/load', 'POST', {
        description: 'Load a local YAML file back to RTDB (uses _path from file). Appends an audit entry.',
        params: { body: { description: 'JSON with "filename" (the YAML file name)' } },
    });
    rw.describeMCP('/files/list', 'GET', {
        description: 'List local YAML dump files.',
    });
    rw.describeMCP('/files/read', 'GET', {
        description: 'Read and return contents of a local YAML dump file.',
        params: { filename: { description: 'Name of the YAML file to read' } },
    });
    rw.describeMCP('/backup', 'POST', {
        description: 'Create a manual backup of a specific RTDB path (or whole DB if path is empty). Backup stored as YAML in the configured backup directory.',
        params: { body: { description: 'JSON with optional "path" (default: root)' } },
    });
    rw.describeMCP('/backup/list', 'GET', {
        description: 'List all backups. Optionally filter by op (put/patch/delete/push/load) and/or path.',
        params: {
            op: { description: 'Filter by operation type: put, patch, delete, push, load' },
            path: { description: 'Filter by RTDB path prefix' },
        },
    });
    rw.describeMCP('/backup/read', 'GET', {
        description: 'Read the contents of a backup YAML file.',
        params: { filename: { description: 'Backup filename from backup/list' } },
    });
    rw.describeMCP('/backup/restore', 'POST', {
        description: 'Restore a backup file to RTDB. Use to recover from a failed or unwanted operation. The backup\'s _path field determines where data is written.',
        params: { body: { description: 'JSON with "filename" (backup filename from backup/list)' } },
    });
    rw.describeMCP('/audit/list', 'GET', {
        description: 'List recent audit entries for write operations. Most recent first.',
        params: {
            op: { description: 'Filter by operation: put, patch, delete, push, load' },
            path: { description: 'Filter by RTDB path prefix' },
            limit: { description: 'Max entries to return (default: 50)' },
        },
    });
    rw.describeMCP('/structure', 'GET', {
        description: 'Show top-level RTDB structure: keys with types and child counts.',
    });
    rw.describeMCP('/rules', 'GET', {
        description: 'Read database.rules.json from the current working directory.',
    });
    rw.describeMCP('/config', 'GET', {
        description: 'Show resolved runtime config: cwd, envPath, basePath, fileCache dir, audit/backup settings, databaseURL. Use this to troubleshoot misconfiguration.',
    });
}
