import { pool } from "../../../lib/db.js";
import { sessionUser } from "../../../lib/auth.js";
import { command } from "../../../lib/service.js";
import { handler, originCheck, body, json } from "../../../lib/http.js";
export const POST = handler(async (request) => {
  originCheck(request);
  const actor = await sessionUser(pool(), request);
  return json(
    await command(
      actor,
      await body(request),
      request.headers.get("idempotency-key"),
    ),
  );
});
