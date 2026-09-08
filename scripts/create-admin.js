import { pool, transaction } from "../lib/db.js";
import { createUser } from "../lib/auth.js";
try {
  await transaction((db) =>
    createUser(db, {
      username: process.env.ADMIN_USERNAME || "admin",
      name: process.env.ADMIN_NAME || "Quản trị HPT",
      password: process.env.ADMIN_PASSWORD,
      role: "admin",
    }),
  );
  console.log(
    "Đã tạo quản trị viên. Xóa ADMIN_PASSWORD khỏi môi trường sau khi tạo.",
  );
} catch (e) {
  console.error(
    e.code === "23505"
      ? "Tài khoản đã tồn tại; không thay mật khẩu tự động."
      : e.message,
  );
  process.exitCode = 1;
} finally {
  await pool().end();
}
