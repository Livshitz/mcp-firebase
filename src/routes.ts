import { IRequest } from 'itty-router';
import { RouterWrapper } from 'edge.libx.js';
import { FirebaseModule } from './firebase';
import { RtdbDAL } from './dal';
import { YamlSync } from './yaml-sync';
import { readFileSync, existsSync } from 'fs';

/** Extract first value from query param (may be string or string[]) */
const q = (v: any, fallback = ''): string => (Array.isArray(v) ? v[0] : v) || fallback;

export function registerRoutes(rw: RouterWrapper, firebase: FirebaseModule, dal: RtdbDAL, yamlSync: YamlSync) {

    // --- DB CRUD ---

    rw.router.get('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        return await firebase.get(path);
    });

    rw.router.put('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        await firebase.set(path, body);
        return { ok: true, path };
    });

    rw.router.patch('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        await firebase.update(path, body);
        return { ok: true, path };
    });

    rw.router.delete('/db', async (req: IRequest) => {
        const path = q(req.query.path);
        await firebase.delete(path);
        return { ok: true, deleted: path };
    });

    // --- DB list/keys/push/query ---

    rw.router.get('/db/list', async (req: IRequest) => {
        const path = q(req.query.path);
        return await dal.list(path);
    });

    rw.router.get('/db/keys', async (req: IRequest) => {
        const path = q(req.query.path);
        return await dal.keys(path);
    });

    rw.router.post('/db/push', async (req: IRequest) => {
        const path = q(req.query.path);
        const body = await req.json();
        const key = await firebase.push(path, body);
        return { ok: true, key, path: `${path}/${key}` };
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
        return await firebase.query(path, opts);
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
        const rtdbPath = await yamlSync.load(filename);
        return { ok: true, path: rtdbPath };
    });

    rw.router.get('/files/list', () => {
        return yamlSync.listFiles();
    });

    rw.router.get('/files/read', (req: IRequest) => {
        const filename = q(req.query.filename);
        if (!filename) throw { status: 400, message: 'filename query param is required' };
        return yamlSync.readFile(filename);
    });

    // --- Structure & rules ---

    rw.router.get('/structure', async () => {
        const root = await firebase.get('');
        if (!root || typeof root !== 'object') return root;
        // Return shallow: keys + type/count for each
        const structure: Record<string, any> = {};
        for (const [key, value] of Object.entries(root)) {
            if (typeof value === 'object' && value !== null) {
                structure[key] = { type: 'object', childCount: Object.keys(value).length };
            } else {
                structure[key] = { type: typeof value, value };
            }
        }
        return structure;
    });

    rw.router.get('/rules', () => {
        const rulesPath = 'database.rules.json';
        if (!existsSync(rulesPath)) throw { status: 404, message: 'database.rules.json not found in cwd' };
        return JSON.parse(readFileSync(rulesPath, 'utf-8'));
    });

    // --- MCP descriptions ---

    rw.describeMCP('/db', 'GET', {
        description: 'Read data at any RTDB path. Pass path as query param.',
        params: { path: { description: 'RTDB path (e.g. "users/abc", "courses"). Empty = root.' } },
    });
    rw.describeMCP('/db', 'PUT', {
        description: 'Set (replace) data at an RTDB path.',
        params: {
            path: { description: 'RTDB path to write to' },
            body: { description: 'JSON data to set at the path' },
        },
    });
    rw.describeMCP('/db', 'PATCH', {
        description: 'Merge-update data at an RTDB path (shallow merge).',
        params: {
            path: { description: 'RTDB path to update' },
            body: { description: 'JSON data to merge at the path' },
        },
    });
    rw.describeMCP('/db', 'DELETE', {
        description: 'Remove data at an RTDB path.',
        params: { path: { description: 'RTDB path to delete' } },
    });
    rw.describeMCP('/db/list', 'GET', {
        description: 'List children at an RTDB path as an array of values.',
        params: { path: { description: 'RTDB path to list children of' } },
    });
    rw.describeMCP('/db/keys', 'GET', {
        description: 'List child keys at an RTDB path.',
        params: { path: { description: 'RTDB path to list keys of' } },
    });
    rw.describeMCP('/db/push', 'POST', {
        description: 'Push a new child with auto-generated key at an RTDB path.',
        params: {
            path: { description: 'RTDB path to push to' },
            body: { description: 'JSON data for the new child' },
        },
    });
    rw.describeMCP('/db/query', 'GET', {
        description: 'Query RTDB with orderBy, equalTo, limitToFirst, limitToLast, startAt, endAt.',
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
        description: 'Load a local YAML file back to RTDB (uses _path from file).',
        params: { body: { description: 'JSON with "filename" (the YAML file name)' } },
    });
    rw.describeMCP('/files/list', 'GET', {
        description: 'List local YAML dump files.',
    });
    rw.describeMCP('/files/read', 'GET', {
        description: 'Read and return contents of a local YAML dump file.',
        params: { filename: { description: 'Name of the YAML file to read' } },
    });
    rw.describeMCP('/structure', 'GET', {
        description: 'Show top-level RTDB structure: keys with types and child counts.',
    });
    rw.describeMCP('/rules', 'GET', {
        description: 'Read database.rules.json from the current working directory.',
    });
}
