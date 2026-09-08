import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { one, transaction } from "./db.js";
import { AppError, assert, text } from "./validation.js";
const scrypt = promisify(scryptCallback);
export const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password) {
  assert(
    typeof password === "string" &&
      password.length >= 12 &&
      password.length <= 128,
    "Mật khẩu cần 12–128 ký tự.",
  );
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [salt, expected] = stored.split(":");
  const actual = await scrypt(password, salt, 64);
  const wanted = Buffer.from(expected, "hex");
  return wanted.length === actual.length && timingSafeEqual(wanted, actual);
}
export async function createUser(db, input) {
  const username = text(input.username, "Tài khoản", 60).toLowerCase();
  assert(
    /^[a-z0-9._-]+$/.test(username),
    "Tài khoản chỉ dùng chữ thường, số, dấu chấm, gạch ngang.",
  );
  assert(
    ["admin", "manager", "warehouse", "project", "viewer"].includes(input.role),
    "Vai trò không hợp lệ.",
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      username,
      text(input.name, "Họ tên"),
      await hashPassword(input.password),
      input.role,
    ],
  );
  return { id };
}
const dummy = "0123456789abcdef0123456789abcdef:" + "00".repeat(64);
export async function login(input, database) {
  const username = text(input.username, "Tài khoản", 60).toLowerCase();
  const result = await transaction(async (db) => {
    const attempt = await one(
      db,
      "SELECT * FROM login_attempts WHERE username=$1",
      [username],
    );
    if (
      attempt &&
      new Date(attempt.reset_at) > new Date() &&
      attempt.failures >= 8
    )
      return { error: 429 };
    const user = await one(db, "SELECT * FROM users WHERE username=$1", [
      username,
    ]);
    const valid = await verifyPassword(
      input.password,
      user?.password_hash || dummy,
    );
    if (!valid || !user?.active) {
      await db.query(
        `INSERT INTO login_attempts(username,failures,reset_at) VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.failures+1 END,
      reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END`,
        [username],
      );
      return { error: 401 };
    }
    await db.query("DELETE FROM login_attempts WHERE username=$1", [username]);
    const token = randomBytes(32).toString("hex");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [tokenHash(token), user.id],
    );
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        active: user.active,
      },
    };
  }, database);
  if (result.error)
    throw new AppError(
      result.error,
      result.error === 429
        ? "Thử đăng nhập quá nhiều lần. Vui lòng đợi 15 phút."
        : "Tài khoản hoặc mật khẩu không đúng.",
    );
  return result;
}
export function cookieToken(request) {
  const match = (request.headers.get("cookie") || "").match(
    /(?:^|;\s*)hpt_session=([a-f0-9]{64})(?:;|$)/,
  );
  return match?.[1];
}
export async function sessionUser(db, request) {
  const token = cookieToken(request);
  const user = token
    ? await one(
        db,
        `SELECT u.id,u.name,u.username,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
        [tokenHash(token)],
      )
    : null;
  assert(user, "Vui lòng đăng nhập.", 401);
  return user;
}
