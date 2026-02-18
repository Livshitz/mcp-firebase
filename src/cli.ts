#!/usr/bin/env bun
import 'dotenv/config';
import { RouterWrapper } from 'edge.libx.js';
import { FirebaseModule } from './firebase';
import { RtdbDAL } from './dal';
import { YamlSync } from './yaml-sync';
import { registerRoutes } from './routes';

const basePath = process.env.RTDB_BASE_PATH || '/';
const localDir = process.env.RTDB_LOCAL_DIR || '.rtdb-data/';

const firebase = new FirebaseModule({ basePath });
const dal = new RtdbDAL(firebase);
const yamlSync = new YamlSync(dal, localDir);

const rw = RouterWrapper.getNew('/api');
registerRoutes(rw, firebase, dal, yamlSync);

const mcp = rw.asMCP({ name: 'mcp-firebase', version: '0.1.0' });

if (process.argv.includes('--stdio')) {
    mcp.serveStdio();
} else {
    // HTTP mode
    const { createServer } = await import('http');
    rw.router.all('/mcp', mcp.httpHandler as any);
    rw.catchNotFound();

    const port = Number(process.env.PORT) || 3456;
    const server = createServer(rw.createServerAdapter());
    server.listen(port, () => {
        console.log(`mcp-firebase running on http://localhost:${port}`);
        console.log(`  REST: http://localhost:${port}/api/db?path=`);
        console.log(`  MCP:  http://localhost:${port}/api/mcp`);
        console.log(`  Stdio: mcp-firebase --stdio`);
    });
}
