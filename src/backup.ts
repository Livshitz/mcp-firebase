import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { YamlSync } from './yaml-sync';
import { AuditOp } from './audit';

export interface BackupMeta {
    file: string;
    op?: AuditOp;
    path: string;
    ts: string;
    auditId?: string;
}

export class BackupManager {
    private dir: string;

    public constructor(public options: Partial<BackupManagerOptions> = {}, public yamlSync?: YamlSync) {
        this.options = { ...new BackupManagerOptions(), ...options };
        this.dir = resolve(this.options.dir!);
    }

    private ensureDir() {
        if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    }

    /** Backup a specific RTDB path. Returns the backup file path. */
    async backup(rtdbPath: string, op?: AuditOp, auditId?: string): Promise<string> {
        if (!this.yamlSync) throw new Error('BackupManager: yamlSync not initialized');
        this.ensureDir();
        const safePath = (rtdbPath || 'root').replace(/^\/+|\/+$/g, '').replace(/\//g, '.') || 'root';
        const opPrefix = op ? `${op}_` : '';
        const ts = (auditId || new Date().toISOString().replace(/[:.]/g, '-'));
        const filename = `${opPrefix}${safePath}_${ts}.yaml`;
        await this.yamlSync.dump(rtdbPath, filename, this.dir);
        return join(this.dir, filename);
    }

    /** List all backups, parsed from filenames. Most recent first. */
    list(filter?: { op?: AuditOp; path?: string }): BackupMeta[] {
        if (!existsSync(this.dir)) return [];
        const files = readdirSync(this.dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        let metas = files.map(f => this.parseMeta(f)).filter(Boolean) as BackupMeta[];
        if (filter?.op) metas = metas.filter(m => m.op === filter.op);
        if (filter?.path) metas = metas.filter(m => m.path === filter.path || m.path.startsWith(filter.path + '/'));
        return metas.reverse();
    }

    /** Restore from a backup file. Returns the RTDB path restored to. */
    async restore(filename: string): Promise<string> {
        if (!this.yamlSync) throw new Error('BackupManager: yamlSync not initialized');
        return await this.yamlSync.load(filename, this.dir);
    }

    private parseMeta(filename: string): BackupMeta | null {
        // Format: {op}_{safePath}_{ts}.yaml  OR  {safePath}_{ts}.yaml
        const OPS: AuditOp[] = ['put', 'patch', 'delete', 'push', 'load'];
        const base = filename.replace(/\.ya?ml$/, '');
        // Try to detect op prefix
        let op: AuditOp | undefined;
        let rest = base;
        for (const o of OPS) {
            if (base.startsWith(o + '_')) {
                op = o;
                rest = base.slice(o.length + 1);
                break;
            }
        }
        // Last segment after splitting by _ is the timestamp (ISO with dashes)
        // Timestamp format: 2026-02-18T12-00-00-000Z → 5 parts after split
        // We isolate the ts by finding the last 28-char ISO-like segment
        const tsMatch = rest.match(/(_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z))$/);
        if (!tsMatch) return null;
        const auditId = tsMatch[2];
        const ts = auditId.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
        const safePath = rest.slice(0, rest.length - tsMatch[1].length);
        const path = safePath.replace(/\./g, '/') || '/';
        return { file: filename, op, path, ts, auditId };
    }
}

export class BackupManagerOptions {
    enabled = true;
    dir = '.mcp-firebase/backups/';
    /** Which write operations trigger auto-backup */
    operations: AuditOp[] = ['put', 'patch', 'delete'];
}
