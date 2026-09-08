import { cookieToken, tokenHash } from "../../../../lib/auth.js";
import { pool } from "../../../../lib/db.js";
import {
  handler,
  originCheck,
  json,
  sessionCookie,
} from "../../../../lib/http.js";
export const POST = handler(async (request) => {
  originCheck(request);
  const token = cookieToken(request);
  if (token)
    await pool().query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
});
