import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export function makeTmpDir(): { dir: string; cleanup: () => void } {
    const dir = join(tmpdir(), `mcp-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return {
        dir,
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}
