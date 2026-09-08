import { AppError, assert } from "./validation.js";
export const json = (value, status = 200, headers = {}) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function originCheck(request) {
  const expected = process.env.APP_ORIGIN;
  assert(expected, "Máy chủ chưa cấu hình APP_ORIGIN.", 503);
  assert(
    request.headers.get("origin") === new URL(expected).origin,
    "Nguồn yêu cầu không hợp lệ.",
    403,
  );
}
export async function body(request) {
  assert(
    (request.headers.get("content-type") || "").startsWith("application/json"),
    "Cần gửi JSON.",
    415,
  );
  const reader = request.body?.getReader();
  assert(reader, "Thiếu nội dung.");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new AppError(413, "Nội dung tối đa 1 MB.");
    }
    chunks.push(value);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "JSON không hợp lệ.");
  }
  assert(
    data && typeof data === "object" && !Array.isArray(data),
    "Nội dung cần là một đối tượng.",
  );
  return data;
}
export function handler(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AppError) return json({ error: e.message }, e.status);
      if (e.code === "23505")
        return json({ error: "Mã đã tồn tại. Vui lòng dùng mã khác." }, 409);
      if (["23503", "23514", "22P02", "22003"].includes(e.code))
        return json({ error: "Dữ liệu hoặc liên kết không hợp lệ." }, 422);
      console.error("HPT request failed", e.code || e.name);
      return json(
        {
          error:
            "Không thể xử lý. Kiểm tra kết nối cơ sở dữ liệu hoặc liên hệ quản trị.",
        },
        500,
      );
    }
  };
}
export function sessionCookie(token, maxAge = 28800) {
  const secure = process.env.APP_ORIGIN?.startsWith("https://");
  return `hpt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
