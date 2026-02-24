import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AuditLog, AuditEntry } from '../src/audit';
import { makeTmpDir } from './helpers/tmp-dir';
import { join } from 'path';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return {
        id: new Date().toISOString().replace(/[:.]/g, '-'),
        ts: new Date().toISOString(),
        op: 'put',
        path: '/users',
        status: 'ok',
        ...overrides,
    };
}

describe('AuditLog', () => {
    let tmp: ReturnType<typeof makeTmpDir>;
    let logFile: string;
    let audit: AuditLog;

    beforeEach(() => {
        tmp = makeTmpDir();
        logFile = join(tmp.dir, 'audit.jsonl');
        audit = new AuditLog({ logFile });
    });

    afterEach(() => {
        tmp.cleanup();
    });

    describe('makeId()', () => {
        it('returns ISO-like timestamp with dashes instead of colons/dots', () => {
            const id = audit.makeId();
            // Should not contain : or .
            expect(id).not.toContain(':');
            expect(id).not.toContain('.');
            // Should match the general format YYYY-MM-DDTHH-MM-SS-mmmZ
            expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
        });
    });

    describe('append() and list()', () => {
        it('creates log file on first append', () => {
            audit.append(makeEntry());
            const { existsSync } = require('fs');
            expect(existsSync(logFile)).toBe(true);
        });

        it('list() returns [] when file does not exist', () => {
            expect(audit.list()).toEqual([]);
        });

        it('list() returns all entries', () => {
            audit.append(makeEntry({ op: 'put', path: '/a' }));
            audit.append(makeEntry({ op: 'patch', path: '/b' }));
            const entries = audit.list();
            expect(entries).toHaveLength(2);
        });

        it('list() returns most recent first', () => {
            audit.append(makeEntry({ id: 'first', op: 'put', path: '/x' }));
            audit.append(makeEntry({ id: 'second', op: 'put', path: '/x' }));
            const entries = audit.list();
            expect(entries[0].id).toBe('second');
            expect(entries[1].id).toBe('first');
        });

        it('filters by op', () => {
            audit.append(makeEntry({ op: 'put', path: '/a' }));
            audit.append(makeEntry({ op: 'delete', path: '/b' }));
            const puts = audit.list({ op: 'put' });
            expect(puts).toHaveLength(1);
            expect(puts[0].op).toBe('put');
        });

        it('filters by exact path', () => {
            audit.append(makeEntry({ path: '/users' }));
            audit.append(makeEntry({ path: '/posts' }));
            const result = audit.list({ path: '/users' });
            expect(result).toHaveLength(1);
            expect(result[0].path).toBe('/users');
        });

        it('filters by path prefix', () => {
            audit.append(makeEntry({ path: '/users/u1' }));
            audit.append(makeEntry({ path: '/users/u2' }));
            audit.append(makeEntry({ path: '/posts' }));
            const result = audit.list({ path: '/users' });
            expect(result).toHaveLength(2);
        });

        it('limits results', () => {
            for (let i = 0; i < 10; i++) {
                audit.append(makeEntry({ id: `e${i}` }));
            }
            const result = audit.list({ limit: 3 });
            expect(result).toHaveLength(3);
        });

        it('preserves JSONL integrity — all entries are valid JSON', () => {
            for (let i = 0; i < 5; i++) {
                audit.append(makeEntry({ id: `e${i}`, path: `/p${i}` }));
            }
            const { readFileSync } = require('fs');
            const lines = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
            for (const line of lines) {
                expect(() => JSON.parse(line)).not.toThrow();
            }
        });
    });

    describe('scale', () => {
        it('handles 10,000 entries', () => {
            for (let i = 0; i < 10000; i++) {
                audit.append(makeEntry({ id: `e${i}`, path: `/p${i % 100}` }));
            }
            const all = audit.list();
            expect(all).toHaveLength(10000);
        }, 30000);
    });
});
