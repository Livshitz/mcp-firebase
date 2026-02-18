import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getDatabase, Database, Reference } from 'firebase-admin/database';
import { IFirebaseInstance } from './dal';

export class FirebaseModule implements IFirebaseInstance {
    public firebaseApp: App;
    private database: Database;
    private basePath: string;

    public constructor(public options?: Partial<FirebaseModuleOptions>) {
        this.options = { ...new FirebaseModuleOptions(), ...options };
        this.basePath = this.options.basePath || '/';
        this.initialize();
    }

    private initialize(): void {
        const serviceAccountInput = this.options.serviceAccountPath
            || process.env.FIREBASE_SERVICE_ACCOUNT
            || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

        if (!serviceAccountInput) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required (file path or JSON string)');
        }

        let serviceAccount: any;
        if (typeof serviceAccountInput === 'string' && serviceAccountInput.trimStart().startsWith('{')) {
            serviceAccount = JSON.parse(serviceAccountInput);
        } else {
            const fs = require('fs');
            serviceAccount = JSON.parse(fs.readFileSync(serviceAccountInput, 'utf8'));
        }

        const databaseURL = this.options.databaseURL || process.env.FIREBASE_DATABASE_URL;
        if (!databaseURL) {
            throw new Error('FIREBASE_DATABASE_URL env var or databaseURL option is required');
        }

        const appName = this.options.appName || '[DEFAULT]';
        let app = getApps().find(a => a.name === appName);
        if (!app) {
            app = initializeApp({ credential: cert(serviceAccount), databaseURL }, appName);
        }

        this.firebaseApp = app;
        this.database = getDatabase(this.firebaseApp);
    }

    private ref(path: string): Reference {
        return this.database.ref(this.getPath(path));
    }

    async get(path: string): Promise<any> {
        const snapshot = await this.ref(path).once('value');
        return snapshot.val();
    }

    async set(path: string, data: any): Promise<void> {
        await this.ref(path).set(data);
    }

    async update(path: string, data: any): Promise<void> {
        await this.ref(path).update(data);
    }

    async delete(path: string): Promise<void> {
        await this.ref(path).remove();
    }

    async push(path: string, data: any): Promise<string | null> {
        const newRef = this.ref(path).push(data);
        return newRef.key;
    }

    async query(path: string, opts: QueryOptions): Promise<any> {
        let ref: any = this.ref(path);
        if (opts.orderBy) ref = ref.orderByChild(opts.orderBy);
        if (opts.equalTo !== undefined) ref = ref.equalTo(opts.equalTo);
        if (opts.limitToFirst) ref = ref.limitToFirst(opts.limitToFirst);
        if (opts.limitToLast) ref = ref.limitToLast(opts.limitToLast);
        if (opts.startAt !== undefined) ref = ref.startAt(opts.startAt);
        if (opts.endAt !== undefined) ref = ref.endAt(opts.endAt);
        const snapshot = await ref.once('value');
        return snapshot.val();
    }

    // IFirebaseInstance adapter
    async dbGet(path: string): Promise<any> { return this.get(path); }
    async dbSet(path: string, data: any): Promise<void> { return this.set(path, data); }
    async dbUpdate(path: string, data: any): Promise<void> { return this.update(path, data); }
    async dbRemove(path: string): Promise<void> { return this.delete(path); }
    async dbDelete(path: string): Promise<void> { return this.delete(path); }
    async dbPush(path: string, data: any): Promise<string | null> { return this.push(path, data); }

    getPath(relativePath: string): string {
        const cleanBase = this.basePath.endsWith('/') ? this.basePath : `${this.basePath}/`;
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        return `${cleanBase}${cleanPath}`;
    }

    getDatabase(): Database {
        return this.database;
    }
}

export interface QueryOptions {
    orderBy?: string;
    equalTo?: any;
    limitToFirst?: number;
    limitToLast?: number;
    startAt?: any;
    endAt?: any;
}

export class FirebaseModuleOptions {
    serviceAccountPath?: string;
    databaseURL?: string = process.env.FIREBASE_DATABASE_URL || '';
    basePath = '/';
    appName?: string;
}
