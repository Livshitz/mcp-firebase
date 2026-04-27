# mcp-firebase

Standalone MCP server for Firebase Realtime Database. Use it from **Cursor**, **Claude Code**, or any MCP host. Full RTDB read/write/query access, plus local YAML dump/load for debugging.

Also usable as an importable library.

## Quick Start

**From npm (recommended):** package [`@livx.cc/mcp-firebase`](https://www.npmjs.com/package/@livx.cc/mcp-firebase). Run with project root as cwd so `mcp-firebase.json` resolves.

```bash
# MCP stdio (installs/updates the package; -y = non-interactive)
bunx -y @livx.cc/mcp-firebase --stdio

# HTTP mode (REST + `/api/mcp`); PORT defaults to 3456
bunx -y @livx.cc/mcp-firebase
```

**From a clone of this repo:**

```bash
# MCP stdio mode — loads .env from mcp-firebase.json / cwd
bun run src/cli.ts --stdio

# Explicit .env path
bun run src/cli.ts --stdio --env-path /path/to/.env

# HTTP mode (REST + MCP endpoint)
bun run src/cli.ts
```

## Cursor (project MCP)

1. **Open the app folder as the workspace root** — the same directory that will contain `mcp-firebase.json` (and usually your app’s `.env` or the path in `envPath`). `${workspaceFolder}` in the config below is that root.
2. **Install [Bun](https://bun.sh)** so `bunx` is available on your PATH (this package is run via the published `mcp-firebase` bin with Bun).
3. Add **`.cursor/mcp.json`**:

```json
{
  "mcpServers": {
    "mcp-firebase": {
      "type": "stdio",
      "command": "bunx",
      "args": ["-y", "@livx.cc/mcp-firebase", "--stdio"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

4. **Configure RTDB** — add **`mcp-firebase.json`** at the project root (next to `.cursor/`) and point **`envPath`** at the `.env` that sets `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_DATABASE_URL` (or `FIREBASE_CONFIG`). See [Environment Variables](#environment-variables) and the **per-project** JSON example in [Claude Code Config](#claude-code-config) (the same `mcp-firebase.json` applies to Cursor).
5. **Reload** the Cursor window (or restart Cursor) so the server starts. If tools do not appear, open the **Output** panel, choose **MCP** or **MCP Logs** in the dropdown, and check for connection errors.

Optional: pin a version, e.g. `"args": ["-y", "@livx.cc/mcp-firebase@0.1.12", "--stdio"]`.  
Optional: a **user-wide** config at `~/.cursor/mcp.json` uses the same shape; the **project** file overrides per [Cursor’s MCP docs](https://cursor.com/docs/mcp).

## Claude Code Config

**Global** — add to `~/.claude.json` once, works in all projects (loads `.env` from each project's cwd):

```json
{
  "mcpServers": {
    "firebase": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/path/to/mcp-firebase/src/cli.ts", "--stdio"]
    }
  }
}
```

**Per-project override** — create `mcp-firebase.json` in the project root:

```json
{
  "envPath": "./config/.env.firebase",
  "basePath": "/myApp",
  "workDir": ".mcp-firebase",
  "readOnly": true
}
```

- **`readOnly`:** `true` blocks write tools (`put_db`, `patch_db`, `delete_db`, `post_db_push`, `post_files_load`, `post_backup_restore`). `false` allows them. If the key is omitted, use env `MCP_READONLY`: writes are allowed only when `MCP_READONLY=false`; otherwise the server is read-only.
- All fields are optional. Priority: `mcp-firebase.json` > `--env-path` flag > env vars > defaults.

**Directory layout** — everything under `workDir` (default: `.mcp-firebase/`):

```
.mcp-firebase/
  cache/     ← query/read results (get_db shallow=false, list, query)
  dumps/     ← manual YAML dumps (files/dump)
  backups/   ← auto + manual backups before write ops
  audit/     ← audit.jsonl (append-only write log)
```

Override individual dirs if needed:

```json
{
  "workDir": ".mcp-firebase",
  "localDir": ".mcp-firebase/dumps/",
  "cacheDir": ".mcp-firebase/cache/",
  "audit": { "logFile": ".mcp-firebase/audit/audit.jsonl" },
  "backup": {
    "dir": ".mcp-firebase/backups/",
    "operations": ["put", "patch", "delete"]
  }
}
```

`backup.operations` controls which write ops trigger an automatic pre-op snapshot. `push` is excluded by default (append-only; rollback is a delete). Add it explicitly if needed.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT` | Yes* | Path to service account JSON file, or the JSON string itself |
| `FIREBASE_DATABASE_URL` | Yes* | Firebase RTDB URL |
| `FIREBASE_CONFIG` | No | If set and `FIREBASE_DATABASE_URL` is missing, `databaseURL` is read from this JSON (same shape as Firebase client config) |
| `MCP_READONLY` | No | When `mcp-firebase.json` has no `readOnly` key: if `MCP_READONLY=false`, writes are allowed; otherwise read-only (default) |
| `RTDB_BASE_PATH` | No | Path prefix for all operations (default: `/`; override via `mcp-firebase.json` `basePath`) |
| `RTDB_LOCAL_DIR` | No | Directory for YAML dump files (default: under `workDir`, see above) |

\*Required for RTDB access. `FIREBASE_SERVICE_ACCOUNT` auto-detects format: if the value starts with `{`, it's parsed as JSON; otherwise treated as a file path.

## MCP Tools

The server sends best-practice `instructions` to the agent on connect (via the MCP `initialize` response). The host (e.g. Cursor or Claude Code) may add these to the agent context — no extra slash command is required in the default setup. Instructions cover: always check size before fetching, use `get_db_keys` first, prefer queries over full downloads for large collections.

### Database Operations

| Tool | Description |
|------|-------------|
| `get_db` | Read data at any RTDB path. Default `shallow=true` returns key/type summary inline. `shallow=false` writes full data to cache and returns metadata + file path. **Always check size first before using `shallow=false`.** |
| `put_db` | Set (replace) data. Auto-backs up path first, appends audit entry. Returns `{ id, backupFile }` for correlation. |
| `patch_db` | Merge-update data. Auto-backs up path first, appends audit entry. |
| `delete_db` | Remove data. Auto-backs up path first, appends audit entry. |
| `get_db_list` | List children as array — writes to cache, returns metadata + file path. **Use `get_db_keys` first to check count.** |
| `get_db_keys` | List child keys only (returned inline). **Use this first to check collection size before fetching data.** |
| `post_db_push` | Push new child with auto-generated key. Appends audit entry. |
| `get_db_query` | Query with orderBy/equalTo/limitToFirst/limitToLast — writes to cache, returns metadata + file path |

### File Operations

| Tool | Description |
|------|-------------|
| `post_files_dump` | Dump RTDB path to local YAML file |
| `post_files_load` | Load YAML file back to RTDB. Appends audit entry. |
| `get_files_list` | List local YAML dump files |
| `get_files_read` | Read a local YAML dump file |

### Backup Operations

| Tool | Description |
|------|-------------|
| `post_backup` | Create a manual backup of a path (or whole DB if path omitted). Stored as YAML in `.mcp-firebase/backups/`. |
| `get_backup_list` | List all backups. Filter by `op` and/or `path`. Returns filename, op, path, timestamp. |
| `get_backup_read` | Read the contents of a backup file. |
| `post_backup_restore` | Restore a backup to RTDB. Uses the backup's `_path` to determine target. Appends audit entry. |

### Audit Operations

| Tool | Description |
|------|-------------|
| `get_audit_list` | List recent write-op audit entries. Filter by `op`, `path`, `limit` (default 50). Most recent first. |

### Inspection

| Tool | Description |
|------|-------------|
| `get_structure` | Show top-level RTDB keys (cheap shallow REST call — no child data downloaded) |
| `get_rules` | Read `database.rules.json` from cwd |
| `get_config` | Show resolved runtime config: cwd, envPath, basePath, dirs, audit/backup settings, databaseURL |

## Library Usage

```typescript
import { FirebaseModule, RtdbDAL, BaseRepository, AuditLog, BackupManager, YamlSync } from '@livx.cc/mcp-firebase';

const firebase = new FirebaseModule({
  serviceAccountPath: './service-account.json',
  databaseURL: 'https://your-project.firebaseio.com',
  basePath: '/v1/',
});

const dal = new RtdbDAL(firebase);
const yamlSync = new YamlSync(dal);

// Audit log (append-only JSONL)
const audit = new AuditLog({ logFile: '.rtdb-audit/audit.jsonl' });

// Backup manager
const backup = new BackupManager({ dir: '.rtdb-backups/', operations: ['put', 'patch', 'delete'] }, yamlSync);

// Manual backup
const file = await backup.backup('users/abc', 'put');

// List backups filtered by path
const backups = backup.list({ path: 'users' });

// Restore a backup
await backup.restore('put_users.abc_2026-02-18T12-00-00-000Z.yaml');

// Query audit log
const entries = audit.list({ op: 'delete', limit: 20 });

// Typed repository
const users = new BaseRepository<User>(dal, 'users');
const user = await users.getById('abc');
await users.update('abc', { name: 'Bob' });
```

## Audit & Backup

Every write op (`put`, `patch`, `delete`, `push`, `load`) appends a JSON line to the configured audit file (default: `.mcp-firebase/audit/audit.jsonl`):

```json
{ "id": "2026-02-18T12-00-00-000Z", "ts": "2026-02-18T12:00:00.000Z", "op": "delete", "path": "users/abc", "status": "ok", "backupFile": ".mcp-firebase/backups/delete_users.abc_2026-02-18T12-00-00-000Z.yaml", "durationMs": 42 }
```

The `backupFile` field correlates the audit entry to its pre-op snapshot. Backup filenames encode `{op}_{path}_{timestamp}.yaml`.

**Recovery flow:**
1. `get_audit_list` — find the bad operation, note its `id` / `backupFile`
2. `get_backup_list` — confirm the backup exists
3. `post_backup_restore { "filename": "..." }` — restore the pre-op state

## YAML File Format

Dump files use a `_path` convention to track the RTDB source path:

```yaml
_path: users/abc
name: Alice
email: alice@example.com
role: admin
```

Loading a file writes its contents (minus `_path`) back to the specified RTDB path.
