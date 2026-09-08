import { pool } from "../../../lib/db.js";
import { sessionUser } from "../../../lib/auth.js";
import { readState } from "../../../lib/read.js";
import { handler, json } from "../../../lib/http.js";
export const dynamic = "force-dynamic";
export const GET = handler(async (request) =>
  json(await readState(await sessionUser(pool(), request))),
);
