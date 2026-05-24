import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseLogoSnapshotBody, type LogoEditorSnapshot } from "./parse-logo-snapshot";

const DATA_DIR = path.join(process.cwd(), "data");
const CURRENT_PATH = path.join(DATA_DIR, "logo-dot-current.json");

export type LogoDotCurrentFile = LogoEditorSnapshot & {
  savedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCurrentFile(raw: string): LogoDotCurrentFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.savedAt !== "string" || parsed.savedAt.length === 0) return null;
  const snapshot = parseLogoSnapshotBody(parsed);
  if (!snapshot) return null;
  return { ...snapshot, savedAt: parsed.savedAt };
}

async function writeCurrentFile(file: LogoDotCurrentFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${CURRENT_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmpPath, CURRENT_PATH);
}

export async function readLogoDotCurrent(): Promise<LogoDotCurrentFile | null> {
  try {
    const raw = await readFile(CURRENT_PATH, "utf8");
    return parseCurrentFile(raw);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function writeLogoDotCurrent(snapshot: LogoEditorSnapshot): Promise<LogoDotCurrentFile> {
  const file: LogoDotCurrentFile = {
    ...snapshot,
    savedAt: new Date().toISOString(),
  };
  await writeCurrentFile(file);
  return file;
}

export { CURRENT_PATH as LOGO_DOT_CURRENT_PATH };
