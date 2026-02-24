import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { BackupManager } from '../src/backup';
import { YamlSync } from '../src/yaml-sync';
import { RtdbDAL } from '../src/dal';
import { makeMockFirebase } from './helpers/mock-firebase';
import { makeTmpDir } from './helpers/tmp-dir';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { stringify } from 'yaml';

describe('BackupManager', () => {
    let tmp: ReturnType<typeof makeTmpDir>;
    let backupDir: string;
    let fb: ReturnType<typeof makeMockFirebase>;
    let dal: RtdbDAL;
    let yamlSync: YamlSync;
    let backup: BackupManager;

    beforeEach(() => {
        tmp = makeTmpDir();
        backupDir = join(tmp.dir, 'backups');
        fb = makeMockFirebase();
        dal = new RtdbDAL(fb);
        yamlSync = new YamlSync(dal, tmp.dir);
        backup = new BackupManager({ dir: backupDir }, yamlSync);
    });

    afterEach(() => {
        tmp.cleanup();
    });

    describe('parseMeta() via list()', () => {
        function writeBackup(filename: string, path: string = '/users') {
            const { mkdirSync } = require('fs');
            mkdirSync(backupDir, { recursive: true });
            const content = stringify({ _path: path, data: 'test' });
            writeFileSync(join(backupDir, filename), content, 'utf-8');
        }

        it('parses filename with op prefix', () => {
            writeBackup('put_users_2026-02-18T12-00-00-000Z.yaml');
            const list = backup.list();
            expect(list).toHaveLength(1);
            expect(list[0].op).toBe('put');
            expect(list[0].path).toBe('users');
            expect(list[0].ts).toBe('2026-02-18T12:00:00.000Z');
        });

        it('parses filename without op prefix', () => {
            writeBackup('users_2026-02-18T12-00-00-000Z.yaml');
            const list = backup.list();
            expect(list).toHaveLength(1);
            expect(list[0].op).toBeUndefined();
            expect(list[0].path).toBe('users');
        });

        it('parses nested path (dots as slashes)', () => {
            writeBackup('put_users.u1_2026-02-18T12-00-00-000Z.yaml');
            const list = backup.list();
            expect(list[0].path).toBe('users/u1');
        });

        it('returns null for invalid filename (no timestamp match)', () => {
            writeBackup('invalid-name.yaml');
            const list = backup.list();
            expect(list).toHaveLength(0);
        });

        it('returns [] when dir does not exist', () => {
            expect(backup.list()).toEqual([]);
        });

        it('handles all op types', () => {
            const ops = ['put', 'patch', 'delete', 'push', 'load'] as const;
            for (const op of ops) {
                writeBackup(`${op}_users_2026-02-18T12-00-00-000Z.yaml`);
            }
            const list = backup.list();
            const foundOps = list.map(m => m.op).filter(Boolean).sort();
            expect(foundOps).toEqual(['delete', 'load', 'patch', 'push', 'put']);
        });
    });

    describe('backup()', () => {
        it('creates backup dir if not exists', async () => {
            await fb.dbSet('data', { x: 1 });
            await backup.backup('data');
            const { existsSync } = require('fs');
            expect(existsSync(backupDir)).toBe(true);
        });

        it('returns path with correct filename format', async () => {
            await fb.dbSet('users', { u1: { name: 'Alice' } });
            const filePath = await backup.backup('users', 'put', '2026-02-18T12-00-00-000Z');
            expect(filePath).toContain('put_users_2026-02-18T12-00-00-000Z.yaml');
            expect(filePath).toContain(backupDir);
        });

        it('throws if yamlSync is not provided', async () => {
            const b = new BackupManager({ dir: backupDir });
            await expect(b.backup('users')).rejects.toThrow('yamlSync not initialized');
        });
    });

    describe('list()', () => {
        function writeBackupFile(filename: string) {
            const { mkdirSync } = require('fs');
            mkdirSync(backupDir, { recursive: true });
            writeFileSync(join(backupDir, filename), stringify({ _path: '/test', v: 1 }));
        }

        it('filters by op', () => {
            writeBackupFile('put_users_2026-02-18T12-00-00-000Z.yaml');
            writeBackupFile('delete_users_2026-02-19T12-00-00-000Z.yaml');
            const puts = backup.list({ op: 'put' });
            expect(puts).toHaveLength(1);
            expect(puts[0].op).toBe('put');
        });

        it('filters by path prefix', () => {
            writeBackupFile('put_users.u1_2026-02-18T12-00-00-000Z.yaml');
            writeBackupFile('put_posts_2026-02-19T12-00-00-000Z.yaml');
            const result = backup.list({ path: 'users' });
            expect(result).toHaveLength(1);
            expect(result[0].path).toBe('users/u1');
        });

        it('returns all items when no filter', () => {
            writeBackupFile('put_a_2026-02-18T10-00-00-000Z.yaml');
            writeBackupFile('put_b_2026-02-19T10-00-00-000Z.yaml');
            const list = backup.list();
            expect(list).toHaveLength(2);
            const paths = list.map(m => m.path).sort();
            expect(paths).toEqual(['a', 'b']);
        });
    });

    describe('restore()', () => {
        it('delegates to yamlSync.load and returns path', async () => {
            // Write a YAML backup file directly
            const { mkdirSync } = require('fs');
            mkdirSync(backupDir, { recursive: true });
            const filename = 'put_users_2026-02-18T12-00-00-000Z.yaml';
            writeFileSync(
                join(backupDir, filename),
                stringify({ _path: 'users', u1: { name: 'Alice' } })
            );
            await fb.dbSet('users', { u1: { name: 'Alice' } });
            const path = await backup.restore(filename);
            expect(path).toBe('users');
        });

        it('throws if yamlSync is not provided', async () => {
            const b = new BackupManager({ dir: backupDir });
            await expect(b.restore('file.yaml')).rejects.toThrow('yamlSync not initialized');
        });
    });
});
