import { describe, it, expect } from 'bun:test';
import { RouterWrapper } from 'edge.libx.js';
import { registerRoutes } from '../src/routes';

/** Round-trips write tools through the real MCP adapter (tools/call → route → firebase), mock DB only. */
describe('MCP tools/call writes store exactly `body` (#39 stray path key)', () => {
    const writes: any[] = [];
    const fb: any = {
        set: async (p: string, d: any) => { writes.push(['set', p, d]); },
        update: async (p: string, d: any) => { writes.push(['update', p, d]); },
        push: async (p: string, d: any) => { writes.push(['push', p, d]); return 'k1'; },
    };
    const rw = RouterWrapper.getNew('/api');
    registerRoutes(rw as any, fb, {} as any, {} as any, {} as any, null, null, {});
    const mcp: any = rw.asMCP({ name: 'test' } as any);
    const call = (name: string, args: any) => mcp.handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

    for (const [tool, op, body] of [
        ['put_db', 'set', ['a', 'b']],
        ['put_db', 'set', { x: 1 }],
        ['patch_db', 'update', { x: 1 }],
        ['post_db_push', 'push', { x: 1 }],
    ] as const) {
        it(`${tool} ${JSON.stringify(body)}`, async () => {
            writes.length = 0;
            await call(tool, { path: 'agf/s', body });
            expect(writes).toEqual([[op, 'agf/s', body]]);
        });
    }
});
