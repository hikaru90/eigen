import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  listLogoDotPresets,
  saveLogoDotPreset,
} from "$lib/server/logo/dot-presets-store";
import { parseLogoSnapshotBody } from "$lib/server/logo/parse-logo-snapshot";
import type { LogoDotPresetSummary } from "../../../logo/preset-types";

export const GET: RequestHandler = async () => {
  const file = await listLogoDotPresets();
  const presets: LogoDotPresetSummary[] = file.presets.map((p) => ({
    id: p.id,
    savedAt: p.savedAt,
    ballCount: p.ballAnchors.length,
  }));
  return json({ nextId: file.nextId, presets });
};

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, "Request body must be JSON");
  }
  const snapshot = parseLogoSnapshotBody(body);
  if (!snapshot) {
    error(400, "Invalid preset payload");
  }
  const preset = await saveLogoDotPreset(snapshot);
  return json({ preset }, { status: 201 });
};
