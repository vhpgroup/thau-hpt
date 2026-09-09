import { pool, transaction } from "../lib/db.js";
import { migrate } from "../lib/migrations.js";
try {
  await transaction(migrate);
  console.log("Database đã cập nhật; dữ liệu cũ được giữ nguyên.");
} finally {
  await pool().end();
}
