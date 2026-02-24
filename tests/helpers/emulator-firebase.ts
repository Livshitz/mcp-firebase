import { IFirebaseInstance } from '../../src/dal';

const PROJECT_ID = 'mcp-firebase-test';
const EMULATOR_HOST = '127.0.0.1:9000';
const DATABASE_URL = `http://${EMULATOR_HOST}/?ns=${PROJECT_ID}`;

process.env.FIREBASE_DATABASE_EMULATOR_HOST = EMULATOR_HOST;

let _db: import('firebase-admin/database').Database | null = null;

function getDb(): import('firebase-admin/database').Database {
    if (_db) return _db;
    const { initializeApp, getApps } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    const appName = 'emulator-test';
    const existing = getApps().find((a: any) => a.name === appName);
    const app = existing ?? initializeApp({ projectId: PROJECT_ID, databaseURL: DATABASE_URL }, appName);
    _db = getDatabase(app);
    return _db!;
}

export async function clearDb(): Promise<void> {
    await getDb().ref('/').set(null);
}

export class EmulatorFirebase implements IFirebaseInstance {
    async dbGet(path: string): Promise<any> {
        const snap = await getDb().ref(path || '/').get();
        return snap.val();
    }

    async dbSet(path: string, data: any): Promise<void> {
        await getDb().ref(path || '/').set(data);
    }

    async dbUpdate(path: string, data: any): Promise<void> {
        await getDb().ref(path || '/').update(data);
    }

    async dbPush(path: string, data: any): Promise<string | null> {
        const ref = getDb().ref(path || '/').push(data);
        return ref.key;
    }

    async dbRemove(path: string): Promise<void> {
        await getDb().ref(path || '/').remove();
    }

    async dbDelete(path: string): Promise<void> {
        await getDb().ref(path || '/').remove();
    }
}
