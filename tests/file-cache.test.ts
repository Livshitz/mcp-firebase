import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FileCache } from '../src/file-cache';
import { makeTmpDir } from './helpers/tmp-dir';
import { join } from 'path';
import { existsSync } from 'fs';

describe('FileCache', () => {
    let tmp: ReturnType<typeof makeTmpDir>;
    let cache: FileCache;

    beforeEach(() => {
        tmp = makeTmpDir();
        cache = new FileCache(join(tmp.dir, 'cache'));
    });

    afterEach(() => {
        tmp.cleanup();
    });

    describe('write()', () => {
        it('creates dir on construction', () => {
            expect(existsSync(cache.dir)).toBe(true);
        });

        it('returns result with file path', () => {
            const result = cache.write('get_db', 'users', { u1: { name: 'Alice' } });
            expect(result.file).toContain(cache.dir);
            expect(existsSync(result.file)).toBe(true);
        });

        it('filename format: {safePath}_{ts}.json', () => {
            const result = cache.write('get_db', 'users/u1', { name: 'Alice' });
            const filename = result.file.split('/').pop()!;
            expect(filename).toMatch(/^users\.u1_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
        });

        it('uses "root" for empty path', () => {
            const result = cache.write('get_db', '', { x: 1 });
            expect(result.rtdbPath).toBe('/');
            const filename = result.file.split('/').pop()!;
            expect(filename).toMatch(/^root_/);
        });

        it('result has correct shape for object', () => {
            const result = cache.write('get_db', 'users', { u1: {}, u2: {} });
            expect(result.type).toBe('object');
            expect(result.childCount).toBe(2);
            expect(result.sizeBytes).toBeGreaterThan(0);
        });

        it('result has correct shape for array', () => {
            const result = cache.write('get_db', 'items', [1, 2, 3]);
            expect(result.type).toBe('array');
            expect(result.length).toBe(3);
        });

        it('result has correct shape for string', () => {
            const result = cache.write('get_db', 'val', 'hello');
            expect(result.type).toBe('string');
        });

        it('written file contains valid JSON', () => {
            const data = { a: 1, b: [1, 2, 3] };
            const result = cache.write('get_db', 'test', data);
            const { readFileSync } = require('fs');
            const parsed = JSON.parse(readFileSync(result.file, 'utf-8'));
            expect(parsed).toEqual(data);
        });
    });

    describe('preview()', () => {
        // preview is private — test via write() result

        it('null data gives "null" preview', () => {
            const result = cache.write('get_db', 'empty', null);
            expect(result.preview).toBe('null');
        });

        it('array gives "Array(N)" preview', () => {
            const result = cache.write('get_db', 'arr', [1, 2, 3]);
            expect(result.preview).toBe('Array(3)');
        });

        it('object shows up to 3 keys', () => {
            const result = cache.write('get_db', 'obj', { a: 1, b: 2, c: 3 });
            expect(result.preview).toBe('{ a, b, c }');
        });

        it('object with more than 3 keys shows "..."', () => {
            const result = cache.write('get_db', 'obj', { a: 1, b: 2, c: 3, d: 4 });
            expect(result.preview).toContain('...');
        });

        it('long string is truncated to 80 chars', () => {
            const long = 'x'.repeat(100);
            const result = cache.write('get_db', 'str', long);
            expect(result.preview.length).toBeLessThanOrEqual(83); // 80 + '...'
            expect(result.preview).toContain('...');
        });

        it('short string is not truncated', () => {
            const result = cache.write('get_db', 'str', 'short');
            expect(result.preview).toBe('short');
        });

        it('number value renders as string', () => {
            const result = cache.write('get_db', 'n', 42);
            expect(result.preview).toBe('42');
        });
    });
});
