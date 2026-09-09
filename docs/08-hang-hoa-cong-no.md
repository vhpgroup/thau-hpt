# Hàng hóa và công nợ — v0.2

## Nâng cấp từ v0.1

Sao lưu PostgreSQL, cập nhật code, chạy `npm ci` và `npm run db:migrate` trước khi khởi động bản mới. Migration `002-catalog-finance.sql` bổ sung bảng/cột; không xóa dữ liệu v0.1. Bộ chạy migration ghi phiên bản và bỏ qua bản đã áp dụng. Không sửa migration 001 trên database đang sử dụng.

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

## Hàng hóa & kho

- Thêm/sửa hàng: mã SKU, tên, nhóm, đơn vị, model, hãng, mã vạch, mô tả, tồn tối thiểu, quản lý serial và trạng thái hoạt động.
- Lọc theo nhóm, trạng thái hoặc dưới tồn tối thiểu; tìm theo SKU/tên/model/hãng/mã vạch.
- Bấm mã hàng để xem tồn từng kho, hàng giữ/khả dụng, giá vốn theo quyền, biến động nhập–xuất, dự án/khách nhận và vị trí serial.
- Sửa kho, địa chỉ, trạng thái; sửa thông tin đối tác và mã số thuế/điện thoại/địa chỉ.
- Không đổi đơn vị hoặc chế độ serial sau khi mã hàng đã được dùng trong dự án, đơn mua hay chứng từ.
- Không ngừng hàng/kho còn tồn hoặc còn nghiệp vụ chưa hoàn tất. Có thể kích hoạt lại hàng đã ngừng.
- Mỗi bản ghi có version. Người lưu sau phải tải lại nếu dữ liệu đã bị người khác sửa.

### Excel danh mục

Tải mẫu từ **Hàng hóa & kho → Nhập Excel**, dùng trang tính đầu tiên. File `.xlsx` tối đa 5 MB, 500 dòng hàng. Cột bắt buộc: Mã hàng, Tên hàng, Đơn vị. Các cột còn lại theo mẫu.

Mã SKU được chuẩn hóa để nhận diện trùng. Mã đã có sẽ được cập nhật; không tạo bản sao, không thay đổi tồn và không ghi phiếu nhập. Nhóm hàng phải được tạo trước. Cột Serial/Hoạt động dùng Có/Không. Không nhận công thức.

Sau khi xem trước sẽ thấy số thêm mới/cập nhật. Nếu dữ liệu hoặc phiên bản thay đổi trước lúc lưu, hệ thống yêu cầu xem trước lại. Một lỗi trong file làm toàn bộ lần nhập không được ghi.

Export `.xlsx` giữ các trường là văn bản để bảo toàn mã/serial và không thực thi công thức từ nội dung. Số tiền được xuất chính xác dưới dạng chuỗi thập phân; người nhận có thể chuyển cột tiền sang số trong Excel nếu cần tính tiếp.

## Công nợ & thu chi

Chọn **Khách hàng · Phải thu** hoặc **Nhà cung cấp · Phải trả**. Hai chiều không tự bù trừ, kể cả cùng một đối tác. Vai trò admin, manager, accountant được truy cập. Tài khoản thủ kho/dự án/viewer không được đọc API hoặc export công nợ.

### Ghi nhận công nợ

1. Lập chứng từ phải thu/phải trả, nhập đối tác, ngày ghi nhận, hạn thanh toán, tổng số tiền VND cần thanh toán và nội dung/căn cứ.
2. Có thể liên kết dự án, gói thầu hoặc đơn mua nhà cung cấp. Liên kết phải khớp đối tác; không lấy giá trị hợp đồng tự sinh nợ.
3. Gửi duyệt → Ghi sổ. Nháp/chờ duyệt chưa tác động số dư.
4. Khoản đã ghi sổ không sửa/xóa số tiền. Khi cần giảm, lập chứng từ giảm công nợ tham chiếu khoản gốc và duyệt riêng.

Số tiền nhập là tổng nghĩa vụ thanh toán; ứng dụng chưa tính VAT hay phát hành hóa đơn. Số tham chiếu hóa đơn của cùng đối tác/cùng chiều không được trùng khi đã sử dụng cho khoản ghi nhận còn hiệu lực. API hỗ trợ gắn chứng từ kho đã ghi sổ khi xác minh được đúng đối tác; giao diện v0.2 liên kết dự án/gói/đơn mua.

### Thanh toán nhiều đợt và ứng trước

1. Lập phiếu thu (phải thu) hoặc chi (phải trả), chọn chuyển khoản/tiền mặt, số tiền, ngày và nội dung.
2. Gửi duyệt → Ghi sổ. Phần tiền chưa phân bổ được theo dõi là ứng trước/chưa phân bổ.
3. Bấm **Phân bổ**, chọn khoản nợ và số tiền. Một phiếu có thể phân bổ cho nhiều khoản nợ; một khoản nợ nhận nhiều đợt thanh toán.
4. Không phân bổ vượt tiền còn lại hoặc nợ còn lại; không phân bổ khác đối tác/khác chiều.

Ví dụ phải thu 1.000.000, nhận 1.200.000 và phân bổ 300.000: nợ còn 700.000, tiền chưa phân bổ 900.000, số dư ròng −200.000. Sau phân bổ thêm 700.000: hết nợ, còn 200.000 ứng trước.

### Điều chỉnh có lịch sử

- Phân bổ sai: hoàn tác phân bổ bằng một bút toán âm liên kết, rồi phân bổ lại. Không xóa bản ghi gốc.
- Hủy phiếu thu/chi đã ghi sổ: chỉ khi đã hoàn tác toàn bộ phân bổ; phải nhập ngày và lý do. Đây là hủy ghi nhận bị nhập sai, **không phải giao dịch hoàn tiền thực tế**.
- Giảm nợ chỉ trong phần chưa thanh toán. Nếu đã phân bổ tiền, cần hoàn tác phần liên quan trước khi giảm.
- Manager/accountant không tự duyệt chứng từ mình lập; admin có quyền duyệt để phù hợp công ty nhỏ.
- Khóa kỳ dùng cùng cấu hình hệ thống. Không ghi lùi trước phát sinh công nợ/thu chi gần nhất của đối tác cùng chiều để không làm sai phân bổ lịch sử.

## Báo cáo và đối soát

Chọn đối tác, chiều và ngày chốt. Bảng gồm còn nợ, ứng trước chưa phân bổ, số dư ròng và nhóm quá hạn 1–30, 31–60, 61–90, trên 90 ngày. Quá hạn tính trên khoản đã ghi sổ còn phải thanh toán; đến đúng ngày hạn chưa coi là quá hạn.

Sổ đối tác ghi tăng nợ, giảm nợ, thu/chi và hủy thu/chi. Phân bổ không làm thay đổi tổng số dư đối tác, chỉ xác định tiền thuộc chứng từ nào. Báo cáo lịch sử tính theo ngày hiệu lực, gồm cả hủy/hoàn tác xảy ra sau đó; xem ngày trước khi hủy vẫn thấy khoản thu/chi còn hiệu lực tại ngày đó.

Xuất Excel theo đúng đối tác/chiều/ngày đang chọn, gồm tổng hợp, chứng từ nợ, thu chi và sổ đối tác. Chưa có đối soát ngân hàng tự động, đa tiền tệ, hạch toán kế toán tổng hợp hoặc chuyển tiền qua ngân hàng.

## API thực tế

- `GET /api/finance?side=ar&partner=<uuid>&asof=YYYY-MM-DD`: số dư, tuổi nợ, chứng từ, phân bổ và sổ; thêm `format=xlsx` để export.
- `POST /api/commands`: `finance.debt.create/submit/post/cancel`, `finance.payment.create/submit/post/cancel/void`, `finance.allocate`, `finance.allocation.reverse`.
- `GET /api/catalog/excel`: export; `?template=1` tải mẫu. `POST` multipart file trả preview và token.
- `POST /api/commands`: `catalog.product.create/update`, `catalog.group.create`, `catalog.warehouse.update`, `catalog.partner.update`, `catalog.products.import`.
- Mọi lệnh ghi dùng Idempotency-Key, transaction và audit chung. Số tiền là decimal, không dùng số thực JavaScript để chốt số dư.

## Kiểm thử bổ sung

Kiểm thử tiền ứng trước, phân bổ nhiều chứng từ/nhiều đợt, chặn trộn đối tác/chiều, hoàn tác/hủy, giảm nợ, báo cáo lịch sử/tuổi nợ, quyền kế toán, khóa kỳ, Excel roundtrip/preview stale và nâng cấp v0.1 giữ dữ liệu. PostgreSQL thật còn kiểm thử hai người cùng phân bổ một khoản tiền; chỉ phần trong số dư được ghi.
