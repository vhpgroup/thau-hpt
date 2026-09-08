# Chạy phần mềm v0.1

## Trạng thái mã nguồn

Ứng dụng Next.js và API đã được triển khai, dùng PostgreSQL. Không dùng dữ liệu demo mặc định hoặc mật khẩu ghi sẵn trong repo. Chưa triển khai lên máy chủ công ty và chưa nhập dữ liệu thật.

Các tài liệu 01–06 là thiết kế đích. Mã v0.1 dùng tên bảng và hợp đồng API gọn hơn; tài liệu này mô tả chính xác bản đang chạy, không coi mọi hạng mục thiết kế đích là đã có.

## Chạy trên máy chủ Node.js

Yêu cầu Node.js >= 22.13, PostgreSQL 17 và npm. Khởi tạo một database mới, không dùng database của hai phần mềm cũ.

```bash
npm ci
cp .env.example .env.local
```

Sửa `.env.local`: DATABASE_URL là kết nối PostgreSQL; APP_ORIGIN phải đúng origin truy cập, ví dụ `http://localhost:3000` lúc chạy thử hoặc `https://kho.example.com` khi triển khai. Không thêm dấu `/` hay đường dẫn vào origin. ADMIN_PASSWORD đặt mật khẩu mạnh từ 12 ký tự.

```bash
npm run db:migrate
npm run admin:create
npm run dev
```

Truy cập `http://localhost:3000`. Dùng tài khoản vừa tạo. Xóa ADMIN_PASSWORD khỏi cấu hình sau khi bootstrap. `admin:create` không ghi đè tài khoản đã tồn tại.

Chạy production:

```bash
npm run build
npm start
```

API kiểm tra origin cho mọi thao tác ghi và đăng nhập. APP_ORIGIN sai sẽ bị chặn, không được tắt kiểm tra để khắc phục.

## Docker

Tạo `.env` tại thư mục repo cho Docker Compose, chứa POSTGRES_PASSWORD (chuỗi ngẫu nhiên URL-safe đủ mạnh) và APP_ORIGIN. Không commit file này.

```bash
docker compose up -d db
```

Chạy `db:migrate` và `admin:create` từ máy host bằng `.env.local`, kết nối `localhost:5432`. Sau đó:

```bash
docker compose up -d --build app
```

Compose chỉ bind cổng database và app vào loopback. Đặt reverse proxy HTTPS trước app để dùng trong mạng công ty/Internet; origin trên proxy và APP_ORIGIN phải khớp. Runtime container chạy dưới user `node`; không tự chạy migration mỗi khi container khởi động. Volume database phải được sao lưu, không xóa khi cập nhật ứng dụng.

## Các chức năng đã có

| Phần | V0.1 |
|---|---|
| Đăng nhập | Scrypt có salt, phiên 8 giờ lưu hash, giới hạn đăng nhập sai, đặt lại mật khẩu thu hồi phiên |
| Người dùng | Admin/manager/warehouse/project/viewer; dự án giới hạn theo owner; giá vốn chỉ admin/manager |
| Danh mục | Tạo hàng, kho thường/cách ly, đối tác; mã chuẩn hóa duy nhất |
| Dự án | Tạo dự án/gói/kế hoạch, điều chỉnh lượng có lý do và version, không hạ dưới cam kết |
| Mua hàng | Nhiều dòng, mỗi dòng gắn một dòng dự án hoặc hàng dự trữ; gửi duyệt/duyệt/đóng phần chưa nhận |
| Kho | Phiếu nhiều dòng; nháp/gửi duyệt/hủy/ghi sổ; nhập, xuất, chuyển, trả khách, trả NCC, điều chỉnh |
| Giữ hàng | Tạo/giải phóng; nhập theo đơn phân bổ tự chuyển đang đặt thành đang giữ; xuất dự án phải có giữ |
| Bàn giao | Theo từng dòng xuất, từng phần, có người nhận và danh sách serial |
| Serial | Số lượng nguyên, kiểm tra vị trí, serial gốc khi trả, chặn nhận trùng |
| Kiểm kê | Khóa cả kho khi mở, đếm các mã đã chọn, ghi phiếu tăng/giảm nguyên tử, hủy mở khóa |
| Giá vốn | Decimal chính xác phía server, bình quân toàn công ty, khách trả lấy vốn nguồn, chuyển kho không đổi tổng |
| Báo cáo | NXT theo ngày/kho, tồn/giữ/khả dụng, định giá tồn, lãi gộp theo lượng bàn giao, CSV không cắt 500 dòng |
| Kiểm soát | Chống ghi trùng, audit, khóa kỳ một chiều, chặn ghi lùi trước ngày chốt giá |
| Chuyển đổi | Công cụ đọc nguồn cũ tạo bản đối soát; không tự ghi dữ liệu chưa xác minh |

Giá đơn mua được lấy lại phía server khi nhận, kể cả tài khoản thủ kho không được xem giá. Admin được duyệt phiếu mình lập để bootstrap công ty nhỏ; manager cần người khác duyệt phiếu mình lập.

Phiếu nháp nhập sai có thể hủy và lập lại. Chưa cung cấp sửa nhiều dòng phiếu nháp; phiếu đã ghi sổ không sửa/xóa.

## Luồng dùng thử từ dữ liệu trống

1. Danh mục: tạo kho, sản phẩm, nhà cung cấp và khách hàng.
2. Dự án: tạo dự án → gói thầu → dòng kế hoạch 20 máy, đơn giá bán.
3. Mua hàng: đặt 20 máy, chọn dòng kế hoạch; gửi duyệt và duyệt.
4. Bấm Nhận hàng: nhập kho 15 máy, chọn kho; gửi duyệt và ghi sổ. Dự án có giữ 15, đang đặt 5.
5. Chứng từ: lập xuất giao 10 máy, chọn cùng dòng dự án/kho; ghi sổ. Tồn còn 5, giữ còn 5, đang giao 10.
6. Bàn giao: xác nhận 8 máy. Dự án hiển thị đã bàn giao 8, đang giao 2.
7. Nếu khách trả giảm giao, lập phiếu trả tham chiếu dòng xuất và dòng dự án; không dùng điều chỉnh tăng thay cho trả hàng.

## Giới hạn hiện tại và hạng mục tiếp theo

- Chưa có tệp biên bản đính kèm/in mẫu chứng từ, cấp quyền chi tiết theo kho, hồ sơ nghiệm thu hoặc phụ lục có tệp.
- Chưa có giao thẳng, đổi hàng theo cặp, hoàn nhập hàng chưa bàn giao hoặc bảo hành hàng khách gửi. Không dùng phiếu trả giảm giao để thay thế các nghiệp vụ này.
- Chưa có tự động chuyển đổi dữ liệu thật, import Excel nghiệp vụ, chỉnh sửa/ngừng danh mục và sơ đồ quyền tùy biến. Cần đối soát nguồn trước khi viết adapter commit dữ liệu.
- Chưa có lịch sao lưu tự động trong ứng dụng. Quản trị hạ tầng phải cấu hình `pg_dump`/backup và kiểm tra khôi phục trước dùng thật.
- Trạng thái hiện tải snapshot nghiệp vụ chung; phù hợp dữ liệu nội bộ quy mô nhỏ. Chưa phân trang server từng module, audit trên UI chỉ 100 mục mới nhất. Cần phân trang trước khi vận hành khối lượng lớn.
- Một advisory lock PostgreSQL bảo vệ mọi giao dịch ghi trên nhiều tiến trình; ưu tiên đúng tồn hơn thông lượng. Không bỏ khóa khi chưa thay bằng khóa dòng được kiểm thử cạnh tranh.
- NXT theo kỳ là báo cáo lượng; lãi gộp hiện là lũy kế theo phần bàn giao và đơn giá hợp đồng cố định, chưa phải sổ kế toán/công nợ.

## Đối soát dữ liệu cũ

```bash
npm run migration:preview -- warehouse /path/to/backup.json
npm run migration:preview -- project /path/to/hpt.db
```

Nguồn SQLite cần là snapshot nhất quán đã xử lý WAL. Kết quả trong `migration-output/` bị gitignore; không commit dữ liệu kinh doanh. Chương trình chỉ đọc và tạo ứng viên, không replay phiếu, không mang mật khẩu người dùng cũ sang.

## Kiểm thử

```bash
npm test
npm run build
```

`npm test` dùng PGlite chạy PostgreSQL engine nhúng cho SQL và nghiệp vụ; test adapter bỏ advisory lock vì chỉ chạy một kết nối. Kiểm thử cạnh tranh thực phải dùng PostgreSQL server:

```bash
TEST_DATABASE_URL=postgres://user:password@localhost:5432/test_database npm run test:postgres
```

Kiểm thử cạnh tranh tạo schema UUID riêng rồi xóa đúng schema đó. Không chạy bằng tài khoản database sản xuất. GitHub Actions có PostgreSQL 17 service và chạy cả hai nhóm cùng build.
