import { login } from "../../../../lib/auth.js";
import {
  handler,
  originCheck,
  body,
  json,
  sessionCookie,
} from "../../../../lib/http.js";
export const runtime = "nodejs";
export const POST = handler(async (request) => {
  originCheck(request);
  const r = await login(await body(request));
  return json({ user: r.user }, 200, { "Set-Cookie": sessionCookie(r.token) });
});
