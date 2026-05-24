import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  readLogoDotCurrent,
  writeLogoDotCurrent,
} from "$lib/server/logo/dot-current-store";
import { parseLogoSnapshotBody } from "$lib/server/logo/parse-logo-snapshot";

export const GET: RequestHandler = async () => {
  const current = await readLogoDotCurrent();
  return json({ current });
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, "Request body must be JSON");
  }
  const snapshot = parseLogoSnapshotBody(body);
  if (!snapshot) {
    error(400, "Invalid logo editor payload");
  }
  const current = await writeLogoDotCurrent(snapshot);
  return json({ current });
};
