import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { parse, stringify } from 'yaml';
import { join } from 'path';
import { RtdbDAL } from './dal';

export class YamlSync {
    constructor(
        private dal: RtdbDAL,
        private localDir: string = '.mcp-firebase/dumps/',
    ) {}

    private ensureDir(dir: string) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    /** Dump an RTDB path to a local YAML file. Returns the file path. */
    async dump(rtdbPath: string, filename?: string, dir?: string): Promise<string> {
        const data = await this.dal.get(rtdbPath);
        if (data === null) throw new Error(`No data at ${rtdbPath}`);

        const targetDir = dir || this.localDir;
        this.ensureDir(targetDir);
        const fname = filename || rtdbPath.replace(/\//g, '_') + '.yaml';
        const filePath = join(targetDir, fname);
        const output = { _path: rtdbPath, ...(typeof data === 'object' ? data : { _value: data }) };
        writeFileSync(filePath, stringify(output, { lineWidth: 0 }));
        return filePath;
    }

    /** Load a local YAML file to RTDB. Uses _path from the file.
     *  For large files, writes top-level keys one-by-one to avoid silent hangs. */
    async load(filename: string, dir?: string): Promise<string> {
        const targetDir = dir || this.localDir;
        const filePath = join(targetDir, filename);
        if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        const content = readFileSync(filePath, 'utf-8');
        const doc = parse(content);
        const path = doc._path;
        if (!path) throw new Error(`No _path found in ${filename}`);
        const { _path, ...data } = doc;

        const keys = Object.keys(data);
        if (keys.length <= 1) {
            await this.dal.update(path, data);
            return path;
        }

        // Write each top-level key individually so large imports don't silently hang
        let done = 0;
        for (const key of keys) {
            await this.dal.set(`${path}/${key}`, data[key]);
            done++;
            process.stderr.write(`[mcp-firebase] load ${filename}: ${done}/${keys.length} (${key})\n`);
        }
        return path;
    }

    /** List local YAML dump files. */
    listFiles(dir?: string): string[] {
        const targetDir = dir || this.localDir;
        if (!existsSync(targetDir)) return [];
        return readdirSync(targetDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    }

    /** Read a local YAML dump file and return its parsed content. */
    readFile(filename: string, dir?: string): any {
        const targetDir = dir || this.localDir;
        const filePath = join(targetDir, filename);
        if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        return parse(readFileSync(filePath, 'utf-8'));
    }
}
