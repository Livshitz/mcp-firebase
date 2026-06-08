#!/usr/bin/env bun
// Vendor convention entrypoint — unclaw (and the agent.libx.js vendor shorthand) resolves
// `vendor/<name>/src/mcp/cli.ts`. The implementation lives in ../cli.ts, which is self-executing
// and honors `--stdio` (argv is shared). Kept as a thin re-export so the published package `bin`
// (src/cli.ts) and the vendor-source convention both work without duplicating logic.
import '../cli.ts';
