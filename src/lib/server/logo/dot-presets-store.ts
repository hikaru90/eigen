import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fieldParamsFromPartial } from "../../../routes/logo/metaball-params";
import type { LogoDotPreset, LogoDotPresetFile } from "../../../routes/logo/preset-types";

const PRESETS_DIR = path.join(process.cwd(), "data");
const PRESETS_PATH = path.join(PRESETS_DIR, "logo-dot-presets.json");

const EMPTY_FILE: LogoDotPresetFile = { nextId: 1, presets: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBallAnchor(value: unknown): value is LogoDotPreset["ballAnchors"][number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.r === "number" &&
    Number.isFinite(value.r) &&
    typeof value.jitterOx === "number" &&
    Number.isFinite(value.jitterOx) &&
    typeof value.jitterOy === "number" &&
    Number.isFinite(value.jitterOy)
  );
}

function parsePreset(value: unknown): LogoDotPreset | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "number" || !Number.isInteger(value.id) || value.id < 1) return null;
  if (typeof value.savedAt !== "string" || value.savedAt.length === 0) return null;
  if (!Array.isArray(value.ballAnchors) || !value.ballAnchors.every(parseBallAnchor)) {
    return null;
  }
  const numericFields = [
    "canvasWidth",
    "canvasHeight",
    "ballRadius",
    "positionJitter",
    "noiseAmount",
    "noiseSeed",
    "typeFontSize",
  ] as const;
  for (const key of numericFields) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) return null;
  }
  if (typeof value.connectBalls !== "boolean") return null;
  if (typeof value.typeText !== "string") return null;
  const fieldParams =
    value.fieldParams === undefined
      ? fieldParamsFromPartial()
      : fieldParamsFromPartial(value.fieldParams as Record<string, unknown>);
  return { ...(value as LogoDotPreset), fieldParams };
}

function parseFile(raw: string): LogoDotPresetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_FILE };
  }
  if (!isRecord(parsed)) return { ...EMPTY_FILE };
  const nextId =
    typeof parsed.nextId === "number" && Number.isInteger(parsed.nextId) && parsed.nextId >= 1
      ? parsed.nextId
      : 1;
  const presetsRaw = Array.isArray(parsed.presets) ? parsed.presets : [];
  const presets = presetsRaw
    .map(parsePreset)
    .filter((p): p is LogoDotPreset => p !== null)
    .sort((a, b) => a.id - b.id);
  const maxId = presets.reduce((max, p) => Math.max(max, p.id), 0);
  return {
    nextId: Math.max(nextId, maxId + 1),
    presets,
  };
}

async function readStore(): Promise<LogoDotPresetFile> {
  try {
    const raw = await readFile(PRESETS_PATH, "utf8");
    return parseFile(raw);
  } catch (err) {
    const code = isRecord(err) && "code" in err ? err.code : undefined;
    if (code === "ENOENT") return { ...EMPTY_FILE };
    throw err;
  }
}

async function writeStore(file: LogoDotPresetFile): Promise<void> {
  await mkdir(PRESETS_DIR, { recursive: true });
  const tmpPath = `${PRESETS_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmpPath, PRESETS_PATH);
}

export async function listLogoDotPresets(): Promise<LogoDotPresetFile> {
  return readStore();
}

export async function getLogoDotPreset(id: number): Promise<LogoDotPreset | null> {
  const file = await readStore();
  return file.presets.find((p) => p.id === id) ?? null;
}

export async function saveLogoDotPreset(
  snapshot: Omit<LogoDotPreset, "id" | "savedAt">,
): Promise<LogoDotPreset> {
  const file = await readStore();
  const preset: LogoDotPreset = {
    ...snapshot,
    id: file.nextId,
    savedAt: new Date().toISOString(),
  };
  file.nextId += 1;
  file.presets = [...file.presets, preset];
  await writeStore(file);
  return preset;
}
