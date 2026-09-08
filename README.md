# HPT — Quản lý dự án và kho

Phần mềm hợp nhất nghiệp vụ của [hpt-project](https://github.com/vhpgroup/hpt-project) và [quan-ly-kho](https://github.com/vhpgroup/quan-ly-kho).

**Trạng thái: có mã nguồn ứng dụng v0.1 dùng Next.js + PostgreSQL.** Đã triển khai luồng nghiệp vụ chính; chưa deploy lên máy chủ công ty hoặc chuyển dữ liệu thật. Xem [hướng dẫn chạy và phạm vi chính xác](docs/07-chay-phan-mem.md). Các tài liệu thiết kế 01–06 mô tả đích đầy đủ, gồm cả hạng mục chưa triển khai.

## Mục tiêu

Một phần mềm, một tài khoản đăng nhập, một cơ sở dữ liệu dùng chung. Quản lý xuyên suốt: dự án → gói thầu → kế hoạch hàng → mua/giữ hàng → nhập kho → xuất giao → bàn giao.

Tách rõ **kế hoạch**, **đã mua/nhận**, **tồn thực tế**, **đang giữ**, **đã xuất** và **đã bàn giao**. Việc nhập kho không tự làm dự án hoàn thành.

## Chạy phần mềm

Cài Node.js >=22.13 và PostgreSQL 17, cấu hình `.env.local` theo `.env.example`, rồi chạy:

```bash
npm ci
npm run db:migrate
npm run admin:create
npm run dev
```

Không có mật khẩu mặc định. [Hướng dẫn Docker, production và kiểm thử](docs/07-chay-phan-mem.md).

## Đọc theo thứ tự

1. [Kiến trúc, phạm vi và màn hình](docs/01-kien-truc.md)
2. [Luồng nghiệp vụ và quy tắc tính](docs/02-nghiep-vu.md)
3. [Từ điển dữ liệu và quan hệ](docs/03-du-lieu.md)
4. [API, phân quyền và giao dịch](docs/04-api-phan-quyen.md)
5. [Chuyển dữ liệu từ hai phần mềm cũ](docs/05-chuyen-du-lieu.md)
6. [Lộ trình và kịch bản nghiệm thu](docs/06-nghiem-thu.md)

## Quyết định thiết kế

- Giao diện và API: Next.js, kế thừa cách tổ chức của `hpt-project`; không nhúng nguyên HTML kho thành một ứng dụng riêng.
- Dữ liệu dùng chung: PostgreSQL trên máy chủ. Không dùng localStorage làm nguồn dữ liệu nghiệp vụ.
- Dùng chung mã hàng; dòng hợp đồng vẫn giữ nguyên tên hàng, đơn vị và mô tả theo hợp đồng.
- Tồn kho từ sổ biến động bất biến; bảng số dư chỉ để tăng tốc và phải đối soát được.
- Chứng từ đã ghi sổ không sửa/xóa trực tiếp; điều chỉnh qua chứng từ liên kết.
- Giá vốn bình quân gia quyền toàn công ty, chốt giá vốn khi xuất; số thập phân chính xác, không dùng số thực JavaScript để chốt tiền.
- Phân quyền tại máy chủ, nhật ký theo danh tính đăng nhập; không tin header tên người dùng.
- Hai repo nguồn được giữ nguyên. Repo này là nơi triển khai bản hợp nhất.

## Phạm vi bản đầu

Đăng nhập và phân quyền; danh mục; dự án/gói thầu; đơn mua; phân bổ và giữ hàng; nhập/xuất/chuyển kho; bàn giao; trả hàng; kiểm kê; serial; báo cáo nghiệp vụ; sao lưu và nhập dữ liệu chuyển đổi có đối soát.

Chưa bao gồm kế toán tổng hợp, hóa đơn điện tử, BHXH, tích hợp muasamcong, vận hành offline đồng bộ nhiều máy hay cổng bảo hành cho khách hàng. Lãi gộp hàng hóa không được gọi là lợi nhuận toàn dự án.

## Nguồn đã khảo sát

- `hpt-project`: commit `c69eba7d4a43353553b067daffb33156a7d905bf`.
- `quan-ly-kho`: commit `64858842701589a510a6062ea5159151231744ca`.

Bản khảo sát phát hiện API dự án chưa xác thực, export giới hạn 500 dòng, import ghi đè có thể hạ kế hoạch dưới lượng đã nhập, và sửa phiếu nhập kho có thể làm sai giá vốn. Các kịch bản này được đưa vào điều kiện nghiệm thu của bản mới.
