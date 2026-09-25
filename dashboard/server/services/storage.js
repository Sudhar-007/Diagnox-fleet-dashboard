import fs from 'node:fs';
import path from 'node:path';

export class StorageCorruptError extends Error {
  constructor(name, reason, movedTo) {
    super(`${name}: ${reason}; the unreadable file was kept as ${movedTo}`);
    this.movedTo = movedTo;
  }
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Where manager-entered data lives. One interface, swappable backends:
//   json:     one file per collection under DATA_DIR (default; works offline)
//   postgres: planned; selected when DATABASE_URL is set
// Every backend exposes:
//   load(name)  -> array, or null when the collection does not exist yet.
//                  A collection that exists but cannot be read throws StorageCorruptError
//                  (never "empty"), so callers can't overwrite real data by accident.
//   save(name, array)
//   persistent  -> whether the data survives a server restart
export function createJsonStorage({ dir, persistent = true }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, `${name}.json`);

  // Move an unreadable file aside instead of deleting or overwriting it.
  function quarantine(name, reason) {
    const movedTo = `${file(name)}.corrupt-${Date.now()}`;
    fs.renameSync(file(name), movedTo);
    throw new StorageCorruptError(name, reason, path.basename(movedTo));
  }

  return {
    kind: 'json',
    persistent,
    load(name) {
      let raw;
      try {
        raw = fs.readFileSync(file(name), 'utf8');
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return quarantine(name, 'not valid JSON');
      }
      if (!Array.isArray(parsed)) return quarantine(name, 'not a list');
      return parsed;
    },
    // Write a temp file, flush it to disk, then rename over the target, so a crash or
    // power loss leaves either the old file or the new one, never half of one.
    // Windows can briefly lock the target (antivirus, indexer); retry the rename.
    save(name, items) {
      const target = file(name);
      const tmp = `${target}.tmp`;
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, JSON.stringify(items, null, 2));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      for (let attempt = 1; ; attempt++) {
        try {
          fs.renameSync(tmp, target);
          return;
        } catch (err) {
          if (!RETRYABLE.has(err.code) || attempt >= 5) throw err;
          sleepSync(50 * attempt);
        }
      }
    },
  };
}

// In-memory backend for tests.
export function createMemoryStorage() {
  const data = new Map();
  return {
    kind: 'memory',
    persistent: false,
    load: (name) => (data.has(name) ? structuredClone(data.get(name)) : null),
    save: (name, items) => data.set(name, structuredClone(items)),
  };
}
