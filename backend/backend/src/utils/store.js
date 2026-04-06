import fs from "fs";
import path from "path";

const dataDir = path.resolve("data");

function filePath(name) {
  return path.join(dataDir, `${name}.json`);
}

export function readCollection(name) {
  const full = filePath(name);
  if (!fs.existsSync(full)) return [];
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

export function writeCollection(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf-8");
}

export function nextId(items) {
  return items.length ? Math.max(...items.map(x => Number(x.id) || 0)) + 1 : 1;
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureDefaults() {
  const defaults = {
    usuarios: [],
    fornecedores: [],
    transportadoras: [],
    motoristas: [],
    veiculos: [],
    docas: [],
    janelas: [],
    regras: [],
    agendamentos: [],
    documentos: []
  };

  for (const [name, value] of Object.entries(defaults)) {
    const full = filePath(name);
    if (!fs.existsSync(full)) {
      writeCollection(name, value);
    }
  }
}
