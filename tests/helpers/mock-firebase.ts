import { IFirebaseInstance } from '../../src/dal';
import { randomUUID } from 'crypto';

function getByPath(store: any, segments: string[]): any {
    let cur = store;
    for (const s of segments) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[s];
    }
    return cur ?? null;
}

function setByPath(store: any, segments: string[], value: any): void {
    if (segments.length === 0) return;
    let cur = store;
    for (let i = 0; i < segments.length - 1; i++) {
        if (cur[segments[i]] == null || typeof cur[segments[i]] !== 'object') {
            cur[segments[i]] = {};
        }
        cur = cur[segments[i]];
    }
    const last = segments[segments.length - 1];
    if (value === null) {
        delete cur[last];
    } else {
        cur[last] = value;
    }
}

function splitPath(path: string): string[] {
    return path.split('/').filter(Boolean);
}

export class MockFirebase implements IFirebaseInstance {
    public store: Record<string, any> = {};

    async dbGet(path: string): Promise<any> {
        if (!path || path === '/') return Object.keys(this.store).length ? { ...this.store } : null;
        return getByPath(this.store, splitPath(path));
    }

    async dbSet(path: string, data: any): Promise<void> {
        if (!path || path === '/') {
            if (data === null) {
                this.store = {};
            } else {
                this.store = { ...data };
            }
            return;
        }
        setByPath(this.store, splitPath(path), data);
    }

    async dbUpdate(path: string, data: any): Promise<void> {
        const existing = await this.dbGet(path) || {};
        const merged = typeof existing === 'object' && !Array.isArray(existing)
            ? { ...existing, ...data }
            : data;
        await this.dbSet(path, merged);
    }

    async dbPush(path: string, data: any): Promise<string> {
        const key = randomUUID().replace(/-/g, '').slice(0, 20);
        await this.dbSet(`${path}/${key}`, data);
        return key;
    }

    async dbRemove(path: string): Promise<void> {
        await this.dbSet(path, null);
    }

    async dbDelete(path: string): Promise<void> {
        await this.dbSet(path, null);
    }
}

/** MockFirebase without dbRemove/dbDelete */
export class MockFirebaseNoRemove implements IFirebaseInstance {
    public store: Record<string, any> = {};
    private base = new MockFirebase();

    async dbGet(path: string): Promise<any> { this.base.store = this.store; return this.base.dbGet(path); }
    async dbSet(path: string, data: any): Promise<void> { this.base.store = this.store; await this.base.dbSet(path, data); this.store = this.base.store; }
    async dbUpdate(path: string, data: any): Promise<void> { this.base.store = this.store; await this.base.dbUpdate(path, data); this.store = this.base.store; }
}

/** MockFirebase without dbPush */
export class MockFirebaseNoPush implements IFirebaseInstance {
    public store: Record<string, any> = {};
    private base = new MockFirebase();

    async dbGet(path: string): Promise<any> { this.base.store = this.store; return this.base.dbGet(path); }
    async dbSet(path: string, data: any): Promise<void> { this.base.store = this.store; await this.base.dbSet(path, data); this.store = this.base.store; }
    async dbUpdate(path: string, data: any): Promise<void> { this.base.store = this.store; await this.base.dbUpdate(path, data); this.store = this.base.store; }
    async dbRemove(path: string): Promise<void> { this.base.store = this.store; await this.base.dbRemove(path); this.store = this.base.store; }
    async dbDelete(path: string): Promise<void> { this.base.store = this.store; await this.base.dbDelete(path); this.store = this.base.store; }
}

export function makeMockFirebase(): MockFirebase {
    return new MockFirebase();
}

export function noRemove(): MockFirebaseNoRemove {
    return new MockFirebaseNoRemove();
}

export function noPush(): MockFirebaseNoPush {
    return new MockFirebaseNoPush();
}
