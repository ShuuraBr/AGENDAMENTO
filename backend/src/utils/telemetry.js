import fs from 'fs';
import path from 'path';

const logsDir = path.resolve(process.cwd(), 'logs');

function ensureLogsDir() {
  fs.mkdirSync(logsDir, { recursive: true });
  return logsDir;
}

function safeClone(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { value: String(value ?? '') };
  }
}

export function appendJsonLine(filename, payload = {}) {
  const dir = ensureLogsDir();
  const file = path.join(dir, filename);
  const entry = {
    timestamp: new Date().toISOString(),
    ...safeClone(payload)
  };
  fs.appendFileSync(file, `${JSON.stringify(entry)}
`, 'utf8');
  return file;
}

export function logTechnicalEvent(event, payload = {}) {
  return appendJsonLine('technical-events.jsonl', { event, ...payload });
}

export function logEmailDispatch(payload = {}) {
  return appendJsonLine('email-dispatch.jsonl', payload);
}

export function getLogFilesHealth() {
  ensureLogsDir();
  const files = ['technical-events.jsonl', 'email-dispatch.jsonl'];
  return files.map((name) => {
    const file = path.join(logsDir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
    const stats = fs.statSync(file);
    return {
      file: name,
      exists: true,
      sizeBytes: Number(stats.size || 0),
      writable: true,
      readable: true
    };
  });
}
