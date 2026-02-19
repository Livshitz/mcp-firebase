import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

export type AuditOp = 'put' | 'patch' | 'delete' | 'push' | 'load';

export interface AuditEntry {
    id: string;
    ts: string;
    op: AuditOp;
    path: string;
    status: 'ok' | 'error';
    backupFile?: string;
    error?: string;
    durationMs?: number;
}

export class AuditLog {
    private logFile: string;

    public constructor(public options: Partial<AuditLogOptions> = {}) {
        this.options = { ...new AuditLogOptions(), ...options };
        this.logFile = resolve(this.options.logFile!);
        const dir = dirname(this.logFile);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    /** Generate a sortable ID: timestamp-based for correlation with backup filenames */
    makeId(): string {
        return new Date().toISOString().replace(/[:.]/g, '-');
    }

    append(entry: AuditEntry): void {
        appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf-8');
    }

    /** Read all entries, optionally filtered */
    list(opts: { op?: AuditOp; path?: string; limit?: number } = {}): AuditEntry[] {
        if (!existsSync(this.logFile)) return [];
        const lines = readFileSync(this.logFile, 'utf-8')
            .split('\n')
            .filter(Boolean);
        let entries: AuditEntry[] = lines.map(l => JSON.parse(l));
        if (opts.op) entries = entries.filter(e => e.op === opts.op);
        if (opts.path) entries = entries.filter(e => e.path === opts.path || e.path.startsWith(opts.path + '/'));
        // Return most recent first
        entries.reverse();
        if (opts.limit) entries = entries.slice(0, opts.limit);
        return entries;
    }
}

export class AuditLogOptions {
    enabled = true;
    logFile = '.mcp-firebase/audit/audit.jsonl';
}
