import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export class FileCache {
    public dir: string;

    constructor(dir = '.mcp-firebase/cache') {
        this.dir = resolve(dir);
        mkdirSync(this.dir, { recursive: true });
    }

    write(toolName: string, rtdbPath: string, data: any) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const safePath = (rtdbPath || 'root').replace(/^\/+|\/+$/g, '').replace(/\//g, '.') || 'root';
        const filename = `${safePath}_${ts}.json`;
        const filePath = join(this.dir, filename);
        const json = JSON.stringify(data, null, 2);
        writeFileSync(filePath, json, 'utf-8');

        return {
            file: filePath,
            rtdbPath: rtdbPath || '/',
            type: Array.isArray(data) ? 'array' : typeof data,
            ...(Array.isArray(data) && { length: data.length }),
            ...(data && typeof data === 'object' && !Array.isArray(data) && { childCount: Object.keys(data).length }),
            sizeBytes: json.length,
            preview: this.preview(data),
        };
    }

    private preview(data: any): string {
        if (data == null) return 'null';
        if (Array.isArray(data)) return `Array(${data.length})`;
        if (typeof data === 'object') {
            const keys = Object.keys(data).slice(0, 3);
            const more = Object.keys(data).length > 3 ? ', ...' : '';
            return `{ ${keys.join(', ')}${more} }`;
        }
        const s = String(data);
        return s.length > 80 ? s.slice(0, 80) + '...' : s;
    }
}
