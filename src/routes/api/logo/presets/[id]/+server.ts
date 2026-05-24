import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getLogoDotPreset } from "$lib/server/logo/dot-presets-store";

export const GET: RequestHandler = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) {
    error(400, "Preset id must be a positive integer");
  }
  const preset = await getLogoDotPreset(id);
  if (!preset) {
    error(404, `No preset with id ${id}`);
  }
  return json({ preset });
};
