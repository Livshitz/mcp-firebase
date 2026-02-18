import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { parse, stringify } from 'yaml';
import { join } from 'path';
import { RtdbDAL } from './dal';

export class YamlSync {
    constructor(
        private dal: RtdbDAL,
        private localDir: string = '.rtdb-data/',
    ) {}

    private ensureDir(dir: string) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    /** Dump an RTDB path to a local YAML file. Returns the file path. */
    async dump(rtdbPath: string, filename?: string): Promise<string> {
        const data = await this.dal.get(rtdbPath);
        if (data === null) throw new Error(`No data at ${rtdbPath}`);

        this.ensureDir(this.localDir);
        const fname = filename || rtdbPath.replace(/\//g, '_') + '.yaml';
        const filePath = join(this.localDir, fname);
        const output = { _path: rtdbPath, ...(typeof data === 'object' ? data : { _value: data }) };
        writeFileSync(filePath, stringify(output, { lineWidth: 0 }));
        return filePath;
    }

    /** Load a local YAML file to RTDB. Uses _path from the file. */
    async load(filename: string): Promise<string> {
        const filePath = join(this.localDir, filename);
        if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        const content = readFileSync(filePath, 'utf-8');
        const doc = parse(content);
        const path = doc._path;
        if (!path) throw new Error(`No _path found in ${filename}`);
        const { _path, ...data } = doc;
        await this.dal.update(path, data);
        return path;
    }

    /** List local YAML dump files. */
    listFiles(): string[] {
        if (!existsSync(this.localDir)) return [];
        return readdirSync(this.localDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    }

    /** Read a local YAML dump file and return its parsed content. */
    readFile(filename: string): any {
        const filePath = join(this.localDir, filename);
        if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        return parse(readFileSync(filePath, 'utf-8'));
    }
}
