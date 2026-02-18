import { RtdbDAL } from './dal';

/**
 * Generic CRUD repository for a typed RTDB collection.
 */
export class BaseRepository<T extends { id?: string }> {
    constructor(
        protected dal: RtdbDAL,
        protected collectionPath: string,
    ) {}

    async getById(id: string): Promise<T | null> {
        return this.dal.get<T>(`${this.collectionPath}/${id}`);
    }

    async getAll(): Promise<T[]> {
        return this.dal.list<T>(this.collectionPath);
    }

    async keys(): Promise<string[]> {
        return this.dal.keys(this.collectionPath);
    }

    async create(id: string, data: T): Promise<void> {
        await this.dal.set(`${this.collectionPath}/${id}`, data);
    }

    async update(id: string, data: Partial<T>): Promise<void> {
        await this.dal.update(`${this.collectionPath}/${id}`, data);
    }

    async remove(id: string): Promise<void> {
        await this.dal.remove(`${this.collectionPath}/${id}`);
    }

    async push(data: T): Promise<string | null> {
        return this.dal.push(this.collectionPath, data);
    }
}
