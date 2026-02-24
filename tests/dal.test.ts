import { describe, it, expect, beforeEach } from 'bun:test';
import { RtdbDAL } from '../src/dal';
import { EmulatorFirebase, clearDb } from './helpers/emulator-firebase';
import { noRemove, noPush } from './helpers/mock-firebase';
import { users } from './helpers/fixtures';

describe('RtdbDAL', () => {
    let fb: EmulatorFirebase;
    let dal: RtdbDAL;

    beforeEach(async () => {
        await clearDb();
        fb = new EmulatorFirebase();
        dal = new RtdbDAL(fb);
    });

    describe('generateKey (via push fallback)', () => {
        it('returns a 20-char string', async () => {
            const noPushFb = noPush();
            const d = new RtdbDAL(noPushFb);
            const key = await d.push('items', { v: 1 });
            expect(key).toBeDefined();
            expect(typeof key).toBe('string');
            expect(key!.length).toBe(20);
        });

        it('generates keys that are lexicographically sortable by time (large gap)', async () => {
            const noPushFb = noPush();
            const d = new RtdbDAL(noPushFb);
            const k1 = await d.push('items', { i: 0 });
            const t0 = Date.now();
            while (Date.now() === t0) { /* spin until ms advances */ }
            const k2 = await d.push('items', { i: 1 });
            expect(k2! > k1!).toBe(true);
        });

        it('generates 500 concurrent unique keys', async () => {
            const noPushFb = noPush();
            const d = new RtdbDAL(noPushFb);
            const keys = await Promise.all(Array.from({ length: 500 }, () => d.push('items', {})));
            const unique = new Set(keys);
            expect(unique.size).toBe(500);
        });

        it('uses dbPush when available', async () => {
            let pushCalled = false;
            const origPush = fb.dbPush.bind(fb);
            fb.dbPush = async (path, data) => {
                pushCalled = true;
                return origPush(path, data);
            };
            const d = new RtdbDAL(fb);
            await d.push('items', { x: 1 });
            expect(pushCalled).toBe(true);
        });

        it('fallback writes at path/<key>', async () => {
            const noPushFb = noPush();
            const d = new RtdbDAL(noPushFb);
            const key = await d.push('items', { v: 42 });
            const val = await noPushFb.dbGet(`items/${key}`);
            expect(val).toEqual({ v: 42 });
        });
    });

    describe('get', () => {
        it('returns null for missing path', async () => {
            expect(await dal.get('nonexistent')).toBeNull();
        });

        it('returns stored value', async () => {
            await dal.set('users', users);
            expect(await dal.get('users')).toEqual(users);
        });
    });

    describe('set', () => {
        it('overwrites existing data', async () => {
            await dal.set('x', { a: 1 });
            await dal.set('x', { b: 2 });
            expect(await dal.get('x')).toEqual({ b: 2 });
        });

        it('handles nested paths', async () => {
            await dal.set('a/b/c', 'value');
            expect(await dal.get('a/b/c')).toBe('value');
        });
    });

    describe('update', () => {
        it('shallow merges into existing data', async () => {
            await dal.set('obj', { a: 1, b: 2 });
            await dal.update('obj', { b: 99, c: 3 });
            expect(await dal.get('obj')).toEqual({ a: 1, b: 99, c: 3 });
        });
    });

    describe('remove', () => {
        it('removes via dbRemove when available', async () => {
            await dal.set('toDelete', { x: 1 });
            await dal.remove('toDelete');
            expect(await dal.get('toDelete')).toBeNull();
        });

        it('falls back to dbDelete when no dbRemove', async () => {
            const noRemoveFb = noRemove();
            const d = new RtdbDAL(noRemoveFb);
            await noRemoveFb.dbSet('toDelete', { x: 1 });
            await d.remove('toDelete');
            expect(await noRemoveFb.dbGet('toDelete')).toBeNull();
        });

        it('falls back to set(null) when neither dbRemove nor dbDelete', async () => {
            const minimalFb = {
                store: {} as any,
                async dbGet(path: string) { return null; },
                async dbSet(path: string, data: any) { if (data === null) this.store[path] = null; else this.store[path] = data; },
                async dbUpdate(path: string, data: any) {},
            };
            const d = new RtdbDAL(minimalFb);
            await d.remove('something');
        });
    });

    describe('list', () => {
        it('returns [] for null', async () => {
            expect(await dal.list('empty')).toEqual([]);
        });

        it('returns array as-is', async () => {
            await dal.set('arr', [1, 2, 3]);
            expect(await dal.list('arr')).toEqual([1, 2, 3]);
        });

        it('returns object values', async () => {
            await dal.set('obj', users);
            const result = await dal.list('obj');
            expect(result).toHaveLength(3);
            expect(result).toContainEqual(users.u1);
        });

        it('returns [] for scalar', async () => {
            await dal.set('scalar', 'hello');
            expect(await dal.list('scalar')).toEqual([]);
        });
    });

    describe('keys', () => {
        it('returns [] for null', async () => {
            expect(await dal.keys('empty')).toEqual([]);
        });

        it('returns object keys', async () => {
            await dal.set('obj', users);
            const keys = await dal.keys('obj');
            expect(keys.sort()).toEqual(['u1', 'u2', 'u3']);
        });

        it('returns [] for scalar', async () => {
            await dal.set('val', 'str');
            expect(await dal.keys('val')).toEqual([]);
        });
    });

    describe('scale', () => {
        it('handles 1,000 sequential set() calls', async () => {
            for (let i = 0; i < 1000; i++) {
                await dal.set(`items/item${i}`, { i });
            }
            const keys = await dal.keys('items');
            expect(keys.length).toBe(1000);
        }, 60000);
    });
});
