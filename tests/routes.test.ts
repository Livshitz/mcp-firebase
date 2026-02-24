import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { makeTmpDir } from './helpers/tmp-dir';
import { RtdbDAL } from '../src/dal';
import { FileCache } from '../src/file-cache';
import { AuditLog } from '../src/audit';
import { BackupManager } from '../src/backup';
import { YamlSync } from '../src/yaml-sync';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { stringify } from 'yaml';

/** In-memory mock of FirebaseModule (routes use firebase.get/set/update/delete/push/getShallow) */
class MockFirebaseModule {
    private store: Record<string, any> = {};

    private getByPath(path: string): any {
        if (!path) return { ...this.store };
        const segs = path.split('/').filter(Boolean);
        let cur: any = this.store;
        for (const s of segs) {
            if (cur == null || typeof cur !== 'object') return null;
            cur = cur[s];
        }
        return cur ?? null;
    }

    private setByPath(path: string, data: any): void {
        if (!path) { if (data === null) this.store = {}; else this.store = { ...data }; return; }
        const segs = path.split('/').filter(Boolean);
        let cur: any = this.store;
        for (let i = 0; i < segs.length - 1; i++) {
            if (cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
            cur = cur[segs[i]];
        }
        const last = segs[segs.length - 1];
        if (data === null) delete cur[last]; else cur[last] = data;
    }

    async get(path: string): Promise<any> { return this.getByPath(path); }
    async set(path: string, data: any): Promise<void> { this.setByPath(path, data); }
    async update(path: string, data: any): Promise<void> {
        const existing = this.getByPath(path) || {};
        this.setByPath(path, { ...existing, ...data });
    }
    async delete(path: string): Promise<void> { this.setByPath(path, null); }
    async push(path: string, data: any): Promise<string> {
        const key = Math.random().toString(36).slice(2, 22);
        this.setByPath(`${path}/${key}`, data);
        return key;
    }
    async getShallow(path: string): Promise<Record<string, true> | null> {
        const data = this.getByPath(path);
        if (!data || typeof data !== 'object') return null;
        return Object.fromEntries(Object.keys(data).map(k => [k, true as true]));
    }
    // IFirebaseInstance adapters (for dal)
    async dbGet(path: string) { return this.get(path); }
    async dbSet(path: string, data: any) { return this.set(path, data); }
    async dbUpdate(path: string, data: any) { return this.update(path, data); }
    async dbRemove(path: string) { return this.delete(path); }
    async dbDelete(path: string) { return this.delete(path); }
    async dbPush(path: string, data: any) { return this.push(path, data); }
    // Expose store for tests
    get _store() { return this.store; }
    set _store(v) { this.store = v; }
}

// Import the private helpers by extracting them from a module evaluation
// Since they're not exported, we test them indirectly through route behavior.
// For the pure helpers (q, shallowSummary, withAudit), we inline-test equivalents.

// ---- Stub RouterWrapper ----

type Handler = (req: any) => Promise<any> | any;
interface RouteEntry { method: string; path: string; handler: Handler; }

class StubRouterWrapper {
    public routes: RouteEntry[] = [];
    public mcpDescriptions: any[] = [];
    public router = {
        get: (path: string, handler: Handler) => this.routes.push({ method: 'GET', path, handler }),
        put: (path: string, handler: Handler) => this.routes.push({ method: 'PUT', path, handler }),
        patch: (path: string, handler: Handler) => this.routes.push({ method: 'PATCH', path, handler }),
        delete: (path: string, handler: Handler) => this.routes.push({ method: 'DELETE', path, handler }),
        post: (path: string, handler: Handler) => this.routes.push({ method: 'POST', path, handler }),
    };
    describeMCP(path: string, method: string, meta: any) {
        this.mcpDescriptions.push({ path, method, ...meta });
    }
    getHandler(method: string, path: string): Handler {
        const entry = this.routes.find(r => r.method === method && r.path === path);
        if (!entry) throw new Error(`No handler for ${method} ${path}`);
        return entry.handler;
    }
}

function makeReq(query: Record<string, any> = {}, body?: any): any {
    return {
        query,
        json: async () => body,
    };
}

describe('routes.ts', () => {
    let tmp: ReturnType<typeof makeTmpDir>;
    let fb: MockFirebaseModule;
    let dal: RtdbDAL;
    let fileCache: FileCache;
    let audit: AuditLog;
    let backup: BackupManager;
    let yamlSync: YamlSync;
    let rw: StubRouterWrapper;

    beforeEach(async () => {
        tmp = makeTmpDir();
        fb = new MockFirebaseModule();
        dal = new RtdbDAL(fb);
        fileCache = new FileCache(join(tmp.dir, 'cache'));
        audit = new AuditLog({ logFile: join(tmp.dir, 'audit.jsonl') });
        yamlSync = new YamlSync(dal, join(tmp.dir, 'dumps'));
        backup = new BackupManager({ dir: join(tmp.dir, 'backups') }, yamlSync);
        rw = new StubRouterWrapper();

        const { registerRoutes } = await import('../src/routes');
        registerRoutes(rw as any, fb as any, dal, yamlSync, fileCache, audit, backup, { version: '1.0' });
    });

    afterEach(() => {
        tmp.cleanup();
    });

    describe('GET /db', () => {
        it('returns shallow summary by default', async () => {
            await fb.dbSet('users', { u1: { name: 'Alice' }, u2: { name: 'Bob' } });
            const handler = rw.getHandler('GET', '/db');
            const result = await handler(makeReq({ path: 'users' }));
            // shallowSummary — each value is described by type
            expect(result).toHaveProperty('u1');
            expect(result.u1.type).toBe('object');
        });

        it('returns fileCache result when shallow=false', async () => {
            await fb.dbSet('users', { u1: { name: 'Alice' } });
            const handler = rw.getHandler('GET', '/db');
            const result = await handler(makeReq({ path: 'users', shallow: 'false' }));
            expect(result).toHaveProperty('file');
            expect(result).toHaveProperty('sizeBytes');
        });
    });

    describe('PUT /db', () => {
        it('sets data and returns ok', async () => {
            const handler = rw.getHandler('PUT', '/db');
            const result = await handler(makeReq({ path: 'users' }, { u1: { name: 'Alice' } }));
            expect(result.ok).toBe(true);
            expect(result.path).toBe('users');
            const stored = await fb.get('users');
            expect(stored).toEqual({ u1: { name: 'Alice' } });
        });
    });

    describe('PATCH /db', () => {
        it('merges data and returns ok', async () => {
            await fb.set('users', { u1: { name: 'Alice' } });
            const handler = rw.getHandler('PATCH', '/db');
            const result = await handler(makeReq({ path: 'users' }, { u2: { name: 'Bob' } }));
            expect(result.ok).toBe(true);
        });
    });

    describe('DELETE /db', () => {
        it('deletes data and returns ok with deleted path', async () => {
            await fb.set('toDelete', { x: 1 });
            const handler = rw.getHandler('DELETE', '/db');
            const result = await handler(makeReq({ path: 'toDelete' }));
            expect(result.ok).toBe(true);
            expect(result.deleted).toBe('toDelete');
        });
    });

    describe('GET /db/keys', () => {
        it('returns keys using getShallow', async () => {
            // Mock getShallow on fb
            (fb as any).getShallow = async (path: string) => ({ u1: true, u2: true });
            const handler = rw.getHandler('GET', '/db/keys');
            const result = await handler(makeReq({ path: 'users' }));
            expect(Array.isArray(result)).toBe(true);
            expect(result.sort()).toEqual(['u1', 'u2']);
        });

        it('returns [] when getShallow returns null', async () => {
            (fb as any).getShallow = async () => null;
            const handler = rw.getHandler('GET', '/db/keys');
            const result = await handler(makeReq({ path: 'empty' }));
            expect(result).toEqual([]);
        });
    });

    describe('POST /db/push', () => {
        it('pushes data and returns key', async () => {
            const handler = rw.getHandler('POST', '/db/push');
            const result = await handler(makeReq({ path: 'items' }, { v: 1 }));
            expect(result.ok).toBe(true);
            expect(result.key).toBeTruthy();
            expect(result.path).toContain('items/');
        });
    });

    describe('GET /files/read', () => {
        it('throws 400 if no filename', async () => {
            const handler = rw.getHandler('GET', '/files/read');
            let thrown: any;
            try { await handler(makeReq({})); } catch (e) { thrown = e; }
            expect(thrown).toMatchObject({ status: 400 });
        });

        it('returns file content for valid filename', async () => {
            const dumpsDir = join(tmp.dir, 'dumps');
            require('fs').mkdirSync(dumpsDir, { recursive: true });
            writeFileSync(join(dumpsDir, 'data.yaml'), stringify({ _path: 'users', u1: { name: 'Alice' } }));
            const handler = rw.getHandler('GET', '/files/read');
            const result = await handler(makeReq({ filename: 'data.yaml' }));
            expect(result._path).toBe('users');
        });
    });

    describe('POST /files/load', () => {
        it('throws 400 if no filename', async () => {
            const handler = rw.getHandler('POST', '/files/load');
            await expect(handler(makeReq({}, {}))).rejects.toMatchObject({ status: 400 });
        });

        it('loads file and returns ok', async () => {
            const dumpsDir = join(tmp.dir, 'dumps');
            require('fs').mkdirSync(dumpsDir, { recursive: true });
            writeFileSync(join(dumpsDir, 'data.yaml'), stringify({ _path: 'users', u1: { name: 'Alice' } }));
            const handler = rw.getHandler('POST', '/files/load');
            const result = await handler(makeReq({}, { filename: 'data.yaml' }));
            expect(result.ok).toBe(true);
        });
    });

    describe('GET /backup/list', () => {
        it('returns empty array when no backups', async () => {
            const handler = rw.getHandler('GET', '/backup/list');
            const result = await handler(makeReq({}));
            expect(result).toEqual([]);
        });

        it('throws 503 when backup is null', async () => {
            const rwNull = new StubRouterWrapper();
            const { registerRoutes } = await import('../src/routes');
            registerRoutes(rwNull as any, fb as any, dal, yamlSync, fileCache, audit, null, {});
            const handler = rwNull.getHandler('GET', '/backup/list');
            let thrown: any;
            try { await handler(makeReq({})); } catch (e) { thrown = e; }
            expect(thrown).toMatchObject({ status: 503 });
        });
    });

    describe('POST /backup/restore', () => {
        it('throws 400 if no filename', async () => {
            const handler = rw.getHandler('POST', '/backup/restore');
            await expect(handler(makeReq({}, {}))).rejects.toMatchObject({ status: 400 });
        });

        it('restores backup and returns ok', async () => {
            const backupDir = join(tmp.dir, 'backups');
            require('fs').mkdirSync(backupDir, { recursive: true });
            const filename = 'put_users_2026-02-18T12-00-00-000Z.yaml';
            writeFileSync(join(backupDir, filename), stringify({ _path: 'users', u1: { name: 'Alice' } }));
            const handler = rw.getHandler('POST', '/backup/restore');
            const result = await handler(makeReq({}, { filename }));
            expect(result.ok).toBe(true);
            expect(result.filename).toBe(filename);
        });
    });

    describe('q() helper behavior', () => {
        it('extracts first element from array query param', async () => {
            await fb.set('test', { a: 1 });
            const handler = rw.getHandler('GET', '/db');
            // Simulate array query param (as itty-router sometimes gives)
            const result = await handler(makeReq({ path: ['test', 'ignored'] }));
            expect(result).toBeDefined();
        });
    });

    describe('shallowSummary() behavior', () => {
        it('returns data as-is for non-object', async () => {
            await fb.set('val', 'hello');
            const handler = rw.getHandler('GET', '/db');
            const result = await handler(makeReq({ path: 'val' }));
            expect(result).toBe('hello');
        });

        it('summarizes array with type and length', async () => {
            await fb.set('arr', [1, 2, 3]);
            const handler = rw.getHandler('GET', '/db');
            const result = await handler(makeReq({ path: 'arr' }));
            expect(result).toEqual({ type: 'array', length: 3 });
        });

        it('summarizes object children with type metadata', async () => {
            await fb.set('data', { num: 42, str: 'hello', obj: { nested: true } });
            const handler = rw.getHandler('GET', '/db');
            const result = await handler(makeReq({ path: 'data' }));
            expect(result.num.type).toBe('number');
            expect(result.str.type).toBe('string');
            expect(result.obj.type).toBe('object');
            expect(result.obj.childCount).toBe(1);
        });
    });

    describe('withAudit() behavior', () => {
        it('appends audit entry after PUT', async () => {
            const handler = rw.getHandler('PUT', '/db');
            await handler(makeReq({ path: 'test' }, { x: 1 }));
            const entries = audit.list();
            expect(entries.length).toBeGreaterThan(0);
            expect(entries[0].op).toBe('put');
            expect(entries[0].path).toBe('test');
            expect(entries[0].status).toBe('ok');
        });

        it('appends audit entry with error status on failure', async () => {
            // Make firebase.set throw (routes call firebase.set, not dal)
            const origSet = fb.set.bind(fb);
            fb.set = async () => { throw new Error('Firebase error'); };
            const handler = rw.getHandler('PUT', '/db');
            try {
                await handler(makeReq({ path: 'test' }, { x: 1 }));
            } catch {}
            fb.set = origSet;
            const entries = audit.list({ op: 'put' });
            expect(entries.length).toBeGreaterThan(0);
            expect(entries[0].status).toBe('error');
        });
    });
});
