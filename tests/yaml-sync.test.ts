import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { YamlSync } from '../src/yaml-sync';
import { RtdbDAL } from '../src/dal';
import { makeMockFirebase } from './helpers/mock-firebase';
import { makeTmpDir } from './helpers/tmp-dir';
import { join } from 'path';
import { writeFileSync, existsSync, readdirSync } from 'fs';
import { stringify } from 'yaml';

describe('YamlSync', () => {
    let tmp: ReturnType<typeof makeTmpDir>;
    let fb: ReturnType<typeof makeMockFirebase>;
    let dal: RtdbDAL;
    let yamlSync: YamlSync;

    beforeEach(() => {
        tmp = makeTmpDir();
        fb = makeMockFirebase();
        dal = new RtdbDAL(fb);
        yamlSync = new YamlSync(dal, tmp.dir);
    });

    afterEach(() => {
        tmp.cleanup();
    });

    describe('dump()', () => {
        it('includes _path field in output', async () => {
            await fb.dbSet('users', { u1: { name: 'Alice' } });
            const filePath = await yamlSync.dump('users');
            const content = require('fs').readFileSync(filePath, 'utf-8');
            const { parse } = require('yaml');
            const doc = parse(content);
            expect(doc._path).toBe('users');
        });

        it('wraps scalar value in _value field', async () => {
            await fb.dbSet('config/flag', 'hello');
            const filePath = await yamlSync.dump('config/flag');
            const { parse } = require('yaml');
            const doc = parse(require('fs').readFileSync(filePath, 'utf-8'));
            expect(doc._value).toBe('hello');
            expect(doc._path).toBe('config/flag');
        });

        it('creates dir if not exists', async () => {
            const subDir = join(tmp.dir, 'newdir');
            const newSync = new YamlSync(dal, subDir);
            await fb.dbSet('data', { x: 1 });
            await newSync.dump('data');
            expect(existsSync(subDir)).toBe(true);
        });

        it('throws if no data at path', async () => {
            await expect(yamlSync.dump('nonexistent')).rejects.toThrow('No data at nonexistent');
        });

        it('uses provided filename', async () => {
            await fb.dbSet('users', { u1: {} });
            const filePath = await yamlSync.dump('users', 'myfile.yaml');
            expect(filePath).toContain('myfile.yaml');
        });

        it('generates filename from path if not provided', async () => {
            await fb.dbSet('users', { u1: {} });
            const filePath = await yamlSync.dump('users');
            expect(filePath).toContain('users');
            expect(filePath.endsWith('.yaml')).toBe(true);
        });

        it('uses provided dir', async () => {
            const subDir = join(tmp.dir, 'custom');
            await fb.dbSet('users', { u1: {} });
            const filePath = await yamlSync.dump('users', 'out.yaml', subDir);
            expect(filePath).toContain(subDir);
        });
    });

    describe('load()', () => {
        it('throws if file not found', async () => {
            await expect(yamlSync.load('notexist.yaml')).rejects.toThrow('File not found');
        });

        it('throws if no _path in file', async () => {
            writeFileSync(join(tmp.dir, 'bad.yaml'), 'key: value\n');
            await expect(yamlSync.load('bad.yaml')).rejects.toThrow('No _path found');
        });

        it('uses update for single-key data', async () => {
            writeFileSync(join(tmp.dir, 'single.yaml'), stringify({ _path: 'users', u1: { name: 'Alice' } }));
            const path = await yamlSync.load('single.yaml');
            expect(path).toBe('users');
            const stored = await fb.dbGet('users/u1');
            expect(stored).toEqual({ name: 'Alice' });
        });

        it('uses set per key for multi-key data', async () => {
            writeFileSync(join(tmp.dir, 'multi.yaml'), stringify({
                _path: 'users',
                u1: { name: 'Alice' },
                u2: { name: 'Bob' },
            }));
            const path = await yamlSync.load('multi.yaml');
            expect(path).toBe('users');
            expect(await fb.dbGet('users/u1')).toEqual({ name: 'Alice' });
            expect(await fb.dbGet('users/u2')).toEqual({ name: 'Bob' });
        });

        it('uses provided dir', async () => {
            const subDir = join(tmp.dir, 'sub');
            require('fs').mkdirSync(subDir, { recursive: true });
            writeFileSync(join(subDir, 'data.yaml'), stringify({ _path: 'cfg', key: 'val' }));
            const path = await yamlSync.load('data.yaml', subDir);
            expect(path).toBe('cfg');
        });
    });

    describe('roundtrip', () => {
        it('dump then load restores data', async () => {
            const original = { u1: { name: 'Alice', age: 30 }, u2: { name: 'Bob', age: 25 } };
            await fb.dbSet('users', original);
            await yamlSync.dump('users', 'users_backup.yaml');
            // Clear
            await fb.dbSet('users', null);
            expect(await fb.dbGet('users')).toBeNull();
            // Restore
            await yamlSync.load('users_backup.yaml');
            const restored = await fb.dbGet('users');
            expect(restored).toMatchObject(original);
        });
    });

    describe('listFiles()', () => {
        it('returns [] for non-existent dir', () => {
            const sync = new YamlSync(dal, join(tmp.dir, 'nonexistent'));
            expect(sync.listFiles()).toEqual([]);
        });

        it('returns only .yaml/.yml files', async () => {
            writeFileSync(join(tmp.dir, 'a.yaml'), '');
            writeFileSync(join(tmp.dir, 'b.yml'), '');
            writeFileSync(join(tmp.dir, 'c.txt'), '');
            const files = yamlSync.listFiles();
            expect(files.sort()).toEqual(['a.yaml', 'b.yml']);
        });
    });

    describe('readFile()', () => {
        it('throws if file not found', () => {
            expect(() => yamlSync.readFile('notexist.yaml')).toThrow('File not found');
        });

        it('returns parsed YAML content', () => {
            writeFileSync(join(tmp.dir, 'data.yaml'), stringify({ _path: 'users', key: 'val' }));
            const content = yamlSync.readFile('data.yaml');
            expect(content._path).toBe('users');
            expect(content.key).toBe('val');
        });
    });
});
