import { pool, transaction } from "../../../lib/db.js";
import { sessionUser } from "../../../lib/auth.js";
import { handler, json } from "../../../lib/http.js";
import { financeState } from "../../../lib/finance.js";
import { workbook } from "../../../lib/excel.js";
export const runtime = "nodejs";
export const GET = handler(async (request) => {
  const actor = await sessionUser(pool(), request),
    q = new URL(request.url).searchParams;
  const result = await transaction((db) =>
    financeState(db, actor, q.get("asof") || undefined),
  );
  const filter = (r) =>
    (!q.get("partner") || r.partner_id === q.get("partner")) &&
    (!q.get("side") || r.side === q.get("side"));
  for (const key of ["debts", "payments", "settlements", "balances", "events"])
    result[key] = result[key].filter(filter);
  if (q.get("format") === "xlsx") {
    const buffer = await workbook([
      {
        name: "Tổng hợp",
        columns: [
          ["partner_code", "Mã đối tác"],
          ["partner_name", "Đối tác"],
          ["side", "AR phải thu / AP phải trả"],
          ["charged", "Ghi nhận"],
          ["credited", "Giảm nợ"],
          ["paid", "Thu hoặc chi"],
          ["remaining", "Còn nợ"],
          ["advance", "Ứng trước chưa phân bổ"],
          ["net", "Số dư ròng"],
          ["overdue", "Quá hạn"],
          ["due_1_30", "Quá hạn 1-30 ngày"],
          ["due_31_60", "31-60 ngày"],
          ["due_61_90", "61-90 ngày"],
          ["due_over_90", "Trên 90 ngày"],
        ],
        data: result.balances,
      },
      {
        name: "Chứng từ nợ",
        columns: [
          ["code", "Số chứng từ"],
          ["partner_name", "Đối tác"],
          ["kind", "charge ghi nhận / credit giảm"],
          ["business_date", "Ngày ghi nhận"],
          ["due_date", "Đến hạn"],
          ["status", "Trạng thái"],
          ["amount", "Số tiền"],
          ["credited", "Giảm"],
          ["allocated", "Thanh toán"],
          ["remaining", "Còn lại"],
        ],
        data: result.debts,
      },
      {
        name: "Thu chi",
        columns: [
          ["code", "Số phiếu"],
          ["partner_name", "Đối tác"],
          ["side", "AR thu / AP chi"],
          ["business_date", "Ngày"],
          ["effective_status", "Trạng thái tại ngày báo cáo"],
          ["amount", "Số tiền"],
          ["allocated", "Phân bổ"],
          ["remaining", "Chưa phân bổ"],
        ],
        data: result.payments,
      },
      {
        name: "Sổ đối tác",
        columns: [
          ["date", "Ngày"],
          ["partner_id", "Mã tham chiếu đối tác"],
          ["side", "Chiều"],
          ["code", "Chứng từ"],
          ["type", "Nghiệp vụ"],
          ["amount", "Tăng/giảm dư"],
          ["balance", "Số dư"],
          ["note", "Diễn giải"],
        ],
        data: result.events,
      },
    ]);
    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="cong-no.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  }
  return json(result);
});
