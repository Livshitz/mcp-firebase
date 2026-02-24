import { describe, it, expect, beforeEach } from 'bun:test';
import { BaseRepository } from '../src/base-repository';
import { RtdbDAL } from '../src/dal';
import { EmulatorFirebase, clearDb } from './helpers/emulator-firebase';
import { users } from './helpers/fixtures';

interface User { id?: string; name: string; age: number; }

describe('BaseRepository', () => {
    let fb: EmulatorFirebase;
    let dal: RtdbDAL;
    let repo: BaseRepository<User>;

    beforeEach(async () => {
        await clearDb();
        fb = new EmulatorFirebase();
        dal = new RtdbDAL(fb);
        repo = new BaseRepository<User>(dal, 'users');
    });

    it('create() and getById()', async () => {
        await repo.create('u1', users.u1);
        const result = await repo.getById('u1');
        expect(result).toEqual(users.u1);
    });

    it('getById() returns null for missing', async () => {
        expect(await repo.getById('nope')).toBeNull();
    });

    it('getAll() returns all values', async () => {
        await repo.create('u1', users.u1);
        await repo.create('u2', users.u2);
        const all = await repo.getAll();
        expect(all).toHaveLength(2);
        expect(all).toContainEqual(users.u1);
        expect(all).toContainEqual(users.u2);
    });

    it('getAll() returns [] when empty', async () => {
        expect(await repo.getAll()).toEqual([]);
    });

    it('keys() returns all keys', async () => {
        await repo.create('u1', users.u1);
        await repo.create('u2', users.u2);
        const keys = await repo.keys();
        expect(keys.sort()).toEqual(['u1', 'u2']);
    });

    it('update() merges partial data', async () => {
        await repo.create('u1', users.u1);
        await repo.update('u1', { age: 99 });
        const result = await repo.getById('u1');
        expect(result?.name).toBe('Alice');
        expect(result?.age).toBe(99);
    });

    it('remove() deletes item', async () => {
        await repo.create('u1', users.u1);
        await repo.remove('u1');
        expect(await repo.getById('u1')).toBeNull();
    });

    it('push() creates item with auto-key', async () => {
        const key = await repo.push(users.u3);
        expect(key).toBeTruthy();
        const result = await repo.getById(key!);
        expect(result).toEqual(users.u3);
    });
});
