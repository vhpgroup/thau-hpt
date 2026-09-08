# Chuyển dữ liệu và đối soát

## 1. Phạm vi

Nguồn mã đã khảo sát: `hpt-project` tại `c69eba7d4a43353553b067daffb33156a7d905bf` và `quan-ly-kho` tại `64858842701589a510a6062ea5159151231744ca`. Trước khi viết bộ chuyển đổi phải kiểm tra lại schema của bản thực tế đang dùng.

**Hiện chưa có database SQLite hay JSON dữ liệu vận hành được cung cấp. Không có dữ liệu thật nào đã được chuyển.** Mã nguồn hoặc dữ liệu demo trong Git không thay thế bản sao lưu đang sử dụng.

## 2. Ánh xạ

| Nguồn | Đích | Cách xử lý |
|---|---|---|
| Dự án: `projects` | projects | Giữ legacy ID trong bảng mapping; thêm mã nội bộ ổn định |
| Dự án: `packages` | packages | Giữ liên kết dự án, mã TBMT, hạn giao, giá trị hợp đồng |
| Dự án: `items` | project_items + products | Ghép mã hàng qua bước ánh xạ; không tự suy giá mua từ unit_price |
| Dự án: `receipts` | Vùng tạm chứng từ/tiến độ lịch sử | Đối chiếu nhập kho trước khi quyết định là nhập vật lý hay chỉ mốc theo dõi |
| Dự án: `settings` | Cấu hình/danh mục | Chuẩn hóa đơn vị và đơn vị phụ trách |
| Dự án: `audit_logs` | Kho lịch sử nguồn chỉ đọc | Gắn nhãn danh tính cũ chưa xác thực, không coi là actor đã xác minh |
| Kho: `products` | products | SKU làm gợi ý khóa, kiểm tra model/đơn vị/quy cách |
| Kho: `warehouses` | warehouses | Ghép kho trùng hoặc tạo kho; không cộng hai bản sao cùng kho |
| Kho: suppliers/customers trong JSON thực tế | partners | Kiểm tra tên trường khi viết adapter; hợp nhất vai trò nếu cùng đối tác |
| Kho: `vouchers` | Kho chứng từ lịch sử hoặc chứng từ chuyển đổi | Theo chiến lược đã chọn dưới đây |
| Kho: `stocks` | Số dư đối soát đầu kỳ | Không vừa nạp số dư vừa replay toàn bộ phiếu vào sổ mới |
| Kho: `products.costPrice` | Giá trị mở sổ sau duyệt | Phải kiểm tra vì nguồn có lỗi sửa phiếu nhập |
| Kho: `users` | Danh sách đề xuất cấp tài khoản | Không di chuyển mật khẩu SHA-256 làm chuẩn mới; cấp lại và bắt đổi |

## 3. Chọn chiến lược lịch sử

**Mặc định: chốt số dư đầu kỳ + lưu lịch sử cũ chỉ đọc.** Đây là lựa chọn phù hợp khi lịch sử có sửa/hủy phiếu khiến không tái tính giá vốn đáng tin cậy.

- Chốt số lượng theo hàng/kho, serial thực có và giá trị tồn được người phụ trách duyệt.
- Tạo chứng từ mở sổ một lần; giá vốn đầu kỳ dựa trên giá trị đã đối soát.
- Lưu chứng từ cũ ở khu vực lịch sử, không cho chúng làm tăng/giảm tồn mới.
- Tiến độ dự án đầu kỳ phải tách bàn giao, đang giao, đang giữ, đơn mua đang mở bằng số liệu được xác nhận. Không suy bàn giao từ tổng receipts cũ.

**Replay toàn bộ lịch sử** chỉ dùng nếu chứng từ, giá trị, ngày và chuỗi sửa/hủy đủ để tái tạo. Cần chạy thử, so tổng lượng và giá trị với bản chốt. Không tự sửa giá vốn nguồn để làm khớp.

Trong cả hai chiến lược, số dư mở sổ không nhập lặp lại khi chạy lại cùng batch. Mọi bản ghi có khóa nguồn và checksum.

## 4. Ngăn cộng trùng hai nguồn

Một lần nhận máy scan có thể xuất hiện ở `hpt-project.receipts` và `quan-ly-kho.vouchers`. Các trường ngày, lượng, tên/model, dự án, NCC chỉ tạo **ứng viên khớp**, không là bằng chứng để tự hợp nhất.

Vùng tạm có cột: nguồn, ID gốc, ngày, mã hàng đề xuất, kho, lượng, chứng từ đối chiếu, loại nghiệp vụ, quyết định, người duyệt. Mỗi dòng phải được phân loại:

1. Cùng sự kiện với phiếu kho đã có → chỉ tạo liên kết tiến độ, không tạo nhập kho mới.
2. Sự kiện nhận vật lý riêng đã xác minh → được nhập theo chiến lược lịch sử đã chọn.
3. Chỉ là số theo dõi dự án → lưu mốc lịch sử, không ảnh hưởng tồn.
4. Không rõ → đưa danh sách lỗi cần xử lý; chặn hoàn tất phạm vi liên quan.

Không cho hệ thống tự đoán receipt bằng 0 là nhập kho 0. Nguồn dùng receipt 0 để biểu diễn đã cập nhật nhưng chưa nhập; đây là mốc theo dõi, không phải biến động kho.

## 5. Quy trình thực hiện

1. Xuất bản sao SQLite nhất quán bằng backup API hoặc quy trình đóng ứng dụng/checkpoint đúng cách; không chỉ copy file `.db` khi còn WAL đang ghi. Xuất JSON kho trên đúng máy đang dùng.
2. Lưu bản gốc ngoài Git, ghi checksum, thời điểm và người cung cấp.
3. Chạy parser trong vùng tạm; kiểm tra schema, số lượng dòng, kiểu dữ liệu, ID trùng và liên kết mồ côi.
4. Chuẩn hóa mã hàng/đơn vị/đối tác/kho; người phụ trách duyệt các ghép chưa chắc chắn.
5. Lập báo cáo so sánh tồn hàng/kho, giá trị tồn, đơn mua mở và tiến độ từng dòng dự án.
6. Chạy thử trên database riêng; kiểm tra kịch bản nhập tiếp, xuất tiếp, trả hàng và bàn giao phần còn lại.
7. Chốt ngày chuyển: dừng ghi hệ thống cũ, lấy snapshot cuối, chạy lại import idempotent và đối soát.
8. Người phụ trách xác nhận báo cáo; mở ghi hệ thống mới. Nguồn cũ giữ chỉ đọc.

## 6. Tiêu chí và quay lui

- Tồn số lượng từng mã/kho và serial phải khớp 100% hoặc có phiếu điều chỉnh được duyệt.
- Giá trị tồn phải có báo cáo chênh lệch và phê duyệt, không chỉ so tổng công ty vì sai lệch từng mã có thể bù nhau.
- Không có receipt/phiếu nguồn bị cộng hai lần; không có legacy ID mồ côi hoặc import trùng.
- Tổng phần đầu kỳ bàn giao/đang giao/giữ/đang đặt không vượt kế hoạch nếu chưa có phụ lục giải thích.
- Trước khi mở ghi: có thể bỏ database thử và nạp lại snapshot.
- Sau khi có giao dịch thật trên hệ thống mới: không phục hồi đè snapshot cũ. Phải dừng ghi, sao lưu trạng thái mới và đối soát giao dịch phát sinh trước khi quyết định quay lui.

Không tự xóa, archive hoặc thay đổi hai repo nguồn trong bước chuyển đổi.
