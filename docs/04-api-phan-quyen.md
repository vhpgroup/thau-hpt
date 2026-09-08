# API, phân quyền và giao dịch

Đây là hợp đồng API dự kiến dưới `/api/v1`; chưa có endpoint đang chạy.

## 1. Quy ước

- Phiên đăng nhập bằng cookie HttpOnly, Secure trên HTTPS, SameSite; token ngẫu nhiên, hash lưu server, hết hạn và thu hồi được.
- Mật khẩu dùng thuật toán băm mật khẩu có salt và tham số chi phí phù hợp. Không dùng lại SHA-256 thuần của bản kho.
- Request thay đổi trạng thái phải kiểm tra Origin/CSRF và Content-Type. Không cho GET thay đổi dữ liệu.
- ID/vai trò/người thao tác gửi từ client không quyết định quyền. Lấy actor từ phiên đã xác thực.
- Request tạo/ghi sổ chứng từ gửi `Idempotency-Key`. Lưu dấu vân tay request và phản hồi trong cùng transaction nghiệp vụ.
- PATCH gửi `version`; phiên bản cũ trả 409, không ghi đè thay đổi của người khác.
- Decimal truyền chuỗi: `{"qty":"10.000","unitPrice":"1250000.000000"}`.
- Danh sách trả `{data, meta:{page,pageSize,total}}`; export không phụ thuộc pageSize.
- Lỗi trả `{error:{code,message,fields,requestId}}`; không trả SQL, stack trace hoặc bí mật.
- 401 chưa đăng nhập; 403 thiếu quyền; 404 không tồn tại hoặc ngoài phạm vi cần che; 409 xung đột; 422 sai nghiệp vụ; 413 tệp quá lớn.

## 2. Endpoint

| Nhóm | Endpoint | Ý nghĩa |
|---|---|---|
| Phiên | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Đăng nhập/thoát và danh tính |
| Người dùng | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/revoke-sessions` | Quản trị tài khoản |
| Danh mục | `GET/POST /products`, `/warehouses`, `/partners`; `PATCH /.../:id` | CRUD có version và inactive |
| Dự án | `GET/POST /projects`, `GET/PATCH /projects/:id` | Dự án trong phạm vi quyền |
| Gói | `GET/POST /projects/:id/packages`, `GET/PATCH /packages/:id` | Gói thầu |
| Kế hoạch | `GET/POST /packages/:id/items`, `PATCH /project-items/:id` | Dòng kế hoạch nháp |
| Phụ lục | `POST /projects/:id/revisions`, `POST /project-revisions/:id/approve` | Thay đổi kế hoạch đã duyệt |
| Mua | `GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/:id` | Đơn mua nháp |
| Duyệt mua | `POST /purchase-orders/:id/submit`, `/approve`, `/close-remainder` | Duyệt hoặc đóng phần chưa nhận |
| Phân bổ | `POST /purchase-orders/:id/allocations` | Gắn nguồn mua vào nhu cầu |
| Giữ hàng | `GET/POST /reservations`, `POST /reservations/:id/release` | Giữ và giải phóng phần chưa dùng |
| Kho | `GET/POST /inventory-documents`, `GET/PATCH /inventory-documents/:id` | Chứng từ nháp kèm dòng |
| Ghi sổ | `POST /inventory-documents/:id/submit`, `/post`, `/cancel`, `/adjustments` | Chuyển trạng thái và tạo điều chỉnh |
| Bàn giao | `GET/POST /handovers`, `POST /handovers/:id/confirm` | Xác nhận theo dòng xuất |
| Kiểm kê | `GET/POST /stock-counts`, `PATCH /stock-counts/:id/lines`, `POST /stock-counts/:id/post` | Chốt đếm và điều chỉnh |
| Tồn | `GET /stocks`, `GET /stock-movements`, `GET /serials/:id` | Tồn, sổ, lịch sử serial |
| Báo cáo | `GET /reports/inventory`, `/project-progress`, `/gross-margin` | Tổng hợp theo quyền |
| Export | `GET /reports/:report/export` | Toàn bộ bộ lọc, cùng quyền báo cáo |
| Audit | `GET /audit-logs` | Nhật ký trong phạm vi được xem |
| Chuyển đổi | `POST /migration-batches`, `GET /migration-batches/:id`, `POST /migration-batches/:id/validate`, `/commit` | Tạo vùng tạm, đối soát, áp dụng |

Tệp migration và attachment phải giới hạn dung lượng/loại và đọc bằng parser dữ liệu, không chạy nội dung. Import Excel preview và commit dùng cùng bộ normalize/validate; token preview gắn hash tệp và version dữ liệu, dữ liệu đổi thì yêu cầu preview lại.

## 3. Vai trò mặc định

| Hành động | Quản trị | Quản lý | Dự án | Mua hàng | Thủ kho | Kế toán/xem |
|---|---|---|---|---|---|---|
| Quản lý tài khoản/quyền | Có | Không | Không | Không | Không | Không |
| Xem dự án | Toàn bộ | Toàn bộ | Được giao | Theo nhu cầu mua được giao | Theo phiếu kho được giao | Theo quyền |
| Lập kế hoạch | Có | Có | Được giao | Không | Không | Không |
| Duyệt phụ lục | Có | Có | Không | Không | Không | Không |
| Lập đơn mua | Có | Có | Yêu cầu mua | Có | Không | Không |
| Duyệt đơn mua | Có | Có | Không | Không | Không | Không |
| Tạo giữ hàng | Có | Có | Được giao | Không | Có trong kho được giao | Không |
| Lập phiếu kho | Có | Có | Yêu cầu giao | Yêu cầu nhận | Có | Không |
| Ghi sổ kho | Có | Có | Không | Không | Theo quyền cấp thêm | Không |
| Xác nhận bàn giao | Có | Có | Được giao | Không | Theo quyền cấp thêm | Không |
| Xem giá vốn | Có | Có | Theo quyền cấp thêm | Không mặc định | Không mặc định | Có theo quyền |
| Khóa/mở kỳ | Có | Có theo quyền | Không | Không | Không | Theo quyền cấp thêm |
| Áp dụng migration | Có | Không | Không | Không | Không | Không |

Mặc định người lập không tự duyệt chứng từ của mình. Công ty nhỏ có thể cấp quyền ngoại lệ `approve_own_document` rõ ràng và ghi audit; không mặc định dùng tài khoản quản trị chung.

Quyền xem giá được áp dụng cả ở API/export, không chỉ ẩn cột. Báo cáo lãi gộp và tổng giá trị tồn có thể tiết lộ giá vốn nên dùng cùng quyền tài chính.

## 4. Thuật toán ghi sổ nguyên tử

1. Xác thực phiên, quyền hành động và phạm vi mọi dự án/kho trong phiếu.
2. Bắt đầu transaction; giữ khóa idempotency. Cùng key/payload đã hoàn tất trả lại kết quả cũ, khác payload trả 409.
3. Khóa hàng chứng từ; kiểm tra status=submitted và version hiện hành.
4. Kiểm tra kỳ mở và mốc nghiệp vụ. Khóa product_valuations theo thứ tự product_id tăng dần; tạo hàng số dư chưa tồn tại bằng upsert an toàn.
5. Khóa stock_balances theo (product_id,warehouse_id), rồi khóa giữ hàng, dòng mua, phân bổ, serial và dòng nguồn theo thứ tự cố định.
6. Đọc lại số liệu dưới khóa. Kiểm tra khả dụng, lượng giữ, lượng còn nhận/giao/trả, số serial và tổng link.
7. Ghi stock_movements, valuation_movements; cập nhật balances; tiêu thụ giữ hàng/phân bổ; ghi serial movements.
8. Đặt posted, chốt actor/time; ghi audit và kết quả idempotency; commit.
9. Gửi thông báo hoặc tác vụ phụ sau commit. Nếu cần đảm bảo gửi, dùng transactional outbox; không để email làm transaction kho treo.

Giao dịch đọc kiểu read-committed chỉ an toàn nếu mọi writer tuân thủ cùng khóa trên hàng tổng hợp. Nếu dùng serializable, phải retry có giới hạn với cùng idempotency key. Kiểm thử hai yêu cầu tranh lượng cuối cùng là điều kiện bắt buộc.

## 5. Bảo mật và vận hành

- Rate limit đăng nhập; trả thông báo sai đăng nhập không phân biệt tên người dùng có tồn tại.
- Không tài khoản/mật khẩu mặc định trong mã. Tạo admin lần đầu bằng quy trình bootstrap riêng; bắt đổi mật khẩu khi cấp tạm.
- Tệp tải về phải kiểm tra quyền thực thể, không chỉ biết object key là tải được.
- Database user ứng dụng không có quyền quản trị schema trong vận hành; migration dùng vai trò riêng.
- Sao lưu có lịch và kiểm tra khôi phục; thời hạn lưu và mục tiêu mất dữ liệu/thời gian phục hồi được chốt trước chạy thật.
- CSV phòng công thức từ dữ liệu văn bản; export bảng tính đặt kiểu ô văn bản cho trường không phải số/ngày.
- Không log token, mật khẩu hoặc toàn bộ tệp nhập có thông tin nhạy cảm.
