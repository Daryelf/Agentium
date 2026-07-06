import fs from "node:fs/promises";
import path from "node:path";

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export function slugifyMacroName(value, fallback = "capcut-macro") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

export class CapCutMacroStorage {
  constructor({ getDirectory } = {}) {
    this.getDirectory = getDirectory;
  }

  directory() {
    const directory = typeof this.getDirectory === "function" ? this.getDirectory() : this.getDirectory;
    return path.resolve(directory || path.join(process.cwd(), "capcut-macros"));
  }

  async ensureDir() {
    const directory = this.directory();
    await fs.mkdir(directory, { recursive: true });
    return directory;
  }

  async list() {
    const directory = await this.ensureDir();
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    const macros = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.includes(".backup.")) continue;
      const filePath = path.join(directory, entry.name);
      try {
        const macro = JSON.parse(await fs.readFile(filePath, "utf8"));
        macros.push({
          id: cleanText(macro.id) || entry.name.replace(/\.json$/, ""),
          name: cleanText(macro.name) || entry.name.replace(/\.json$/, ""),
          workflowId: cleanText(macro.workflowId),
          app: cleanText(macro.app) || "CapCut",
          platform: cleanText(macro.platform) || "macOS",
          version: Number(macro.version || 1),
          stepCount: Array.isArray(macro.steps) ? macro.steps.length : 0,
          createdAt: macro.createdAt || "",
          updatedAt: macro.updatedAt || "",
          filePath
        });
      } catch {
        // Keep one corrupted macro file from breaking the whole library.
      }
    }
    return macros.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  async read(idOrName) {
    const macroId = cleanText(idOrName);
    const macros = await this.list();
    const match = macros.find((macro) => macro.id === macroId || macro.name === macroId || slugifyMacroName(macro.name) === macroId);
    if (!match) {
      const error = new Error("CapCut macro not found.");
      error.statusCode = 404;
      throw error;
    }
    return JSON.parse(await fs.readFile(match.filePath, "utf8"));
  }

  async backupIfExists(filePath, macroName = "") {
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }
    const directory = path.dirname(filePath);
    const base = slugifyMacroName(macroName || path.basename(filePath, ".json"));
    const backupPath = path.join(directory, `${base}.backup.${nowStamp()}.json`);
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  }

  async save(macro) {
    const directory = await this.ensureDir();
    const filePath = path.join(directory, `${slugifyMacroName(macro.name)}-${cleanText(macro.id)}.json`);
    const backupPath = await this.backupIfExists(filePath, macro.name);
    await fs.writeFile(filePath, `${JSON.stringify(macro, null, 2)}\n`, "utf8");
    return { filePath, backupPath };
  }

  async delete(idOrName) {
    const macroId = cleanText(idOrName);
    const macros = await this.list();
    const match = macros.find((macro) => macro.id === macroId || macro.name === macroId || slugifyMacroName(macro.name) === macroId);
    if (!match) {
      const error = new Error("CapCut macro not found.");
      error.statusCode = 404;
      throw error;
    }
    const backupPath = await this.backupIfExists(match.filePath, match.name);
    await fs.rm(match.filePath, { force: true });
    return {
      deleted: true,
      macro: match,
      backupPath: backupPath || ""
    };
  }
}
