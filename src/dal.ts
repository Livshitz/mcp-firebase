/**
 * Generic RTDB Data Access Layer
 * Works with any Firebase instance via dependency injection.
 */

export interface IFirebaseInstance {
  dbGet(path: string): Promise<any>;
  dbSet(path: string, data: any): Promise<void>;
  dbUpdate(path: string, data: any): Promise<void>;
  dbPush?(path: string, data: any): Promise<string | null>;
  dbRemove?(path: string): Promise<void>;
  dbDelete?(path: string): Promise<void>;
}

export class RtdbDAL {
  constructor(
    private firebaseInstance: IFirebaseInstance,
    public options?: Partial<RtdbDALOptions>
  ) {
    this.options = { ...new RtdbDALOptions(), ...options };
  }

  async get<T>(path: string): Promise<T | null> {
    const data = await this.firebaseInstance.dbGet(path);
    return data as T | null;
  }

  async set<T>(path: string, data: T): Promise<void> {
    await this.firebaseInstance.dbSet(path, data);
  }

  async update(path: string, data: any): Promise<void> {
    await this.firebaseInstance.dbUpdate(path, data);
  }

  async push<T>(path: string, data: T): Promise<string | null> {
    if (this.firebaseInstance.dbPush) {
      return await this.firebaseInstance.dbPush(path, data);
    }
    // Fallback: generate key manually
    const key = this.generateKey();
    await this.firebaseInstance.dbSet(`${path}/${key}`, data);
    return key;
  }

  async remove(path: string): Promise<void> {
    if (this.firebaseInstance.dbRemove) {
      await this.firebaseInstance.dbRemove(path);
    } else if (this.firebaseInstance.dbDelete) {
      await this.firebaseInstance.dbDelete(path);
    } else {
      await this.firebaseInstance.dbSet(path, null);
    }
  }

  async list<T>(path: string): Promise<T[]> {
    const data = await this.firebaseInstance.dbGet(path);
    if (!data) return [];
    if (Array.isArray(data)) return data as T[];
    if (typeof data === 'object') return Object.values(data) as T[];
    return [];
  }

  async keys(path: string): Promise<string[]> {
    const data = await this.firebaseInstance.dbGet(path);
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data);
  }

  private generateKey(): string {
    const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    const now = Date.now();
    let key = '';
    for (let i = 0; i < 8; i++) key = PUSH_CHARS.charAt(now % 64) + key;
    for (let i = 0; i < 12; i++) key += PUSH_CHARS.charAt(Math.floor(Math.random() * 64));
    return key;
  }
}

export class RtdbDALOptions {
  enableLogging? = false;
}
