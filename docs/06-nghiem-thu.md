# Lộ trình và nghiệm thu

## 1. Thứ tự triển khai

| Mốc | Đầu ra chạy được | Điều kiện hoàn thành |
|---|---|---|
| 1. Nền tảng | Next.js, PostgreSQL migrations, đăng nhập, quyền, danh mục | Người không đăng nhập bị chặn; quyền kiểm tra server; không có tài khoản mặc định |
| 2. Sổ kho | Nháp/duyệt/ghi sổ, nhập/xuất/chuyển, giá vốn, audit | Không âm tồn, không ghi trùng, rollback nguyên tử; chứng từ đã ghi sổ bất biến |
| 3. Dự án và mua | Dự án, gói, kế hoạch, đơn mua, phân bổ, giữ hàng | Không phân bổ/giữ trùng nguồn; nhận từng đợt đúng |
| 4. Giao và hậu xử lý | Xuất dự án, bàn giao phần, trả hàng, kiểm kê, serial | Lượng/serial nguồn đúng; bàn giao không vượt xuất; trả mở lại đúng nhu cầu |
| 5. Báo cáo và chuyển đổi | Báo cáo, export, vùng tạm import, đối soát | Export đủ dòng; import cùng quy tắc sửa; thử phục hồi và chuyển đổi |
| 6. Vận hành | HTTPS, cấu hình, giám sát, sao lưu, hướng dẫn nhân viên | Nghiệm thu luồng thực tế và phê duyệt số dư trước mở ghi |

Các mốc là kế hoạch, không phải trạng thái đã triển khai. Không đưa số ngày cam kết khi chưa biết môi trường triển khai và dữ liệu chuyển đổi.

## 2. Kịch bản bắt buộc

| ID | Tình huống | Kết quả cần đạt |
|---|---|---|
| AUTH-01 | Gọi API đọc/sửa không có phiên | 401; không đọc hoặc ghi dữ liệu |
| AUTH-02 | Nhân viên gửi role=admin hoặc x-actor giả | Không tăng quyền; audit vẫn là tài khoản thật |
| AUTH-03 | Người dự án A gọi dữ liệu/phiếu dự án B | Bị chặn đúng scope, kể cả export/tệp |
| AUTH-04 | Người không có quyền giá vốn gọi API | Không nhận đơn giá vốn hoặc tổng giá trị suy được giá vốn |
| AUTH-05 | Gửi POST từ origin lạ bằng cookie | Bị chặn CSRF/Origin |
| STOCK-01 | Nhập 10, xuất 3 | Tồn 7; sổ và số dư khớp |
| STOCK-02 | Hai người cùng xuất 4 khi còn 5 | Chỉ một phiếu ghi sổ; phiếu kia báo thiếu tồn |
| STOCK-03 | Hai người cùng giữ 4 khi còn khả dụng 5 | Chỉ một giữ thành công |
| STOCK-04 | Tồn 15, giữ A=10, B muốn giữ 6 | B bị chặn, khả dụng 5 |
| STOCK-05 | Xuất 4 từ giữ A=10 | Tồn giảm 4, giữ A còn 6, không trừ khả dụng hai lần |
| STOCK-06 | Gửi lại cùng Idempotency-Key/payload | Một chứng từ hiệu lực, cùng phản hồi |
| STOCK-07 | Cùng key khác payload | 409, không ghi thêm |
| STOCK-08 | Lỗi audit hoặc serial giữa giao dịch | Không có thay đổi tồn/giá/giữ nào được commit |
| STOCK-09 | Chuyển 3 từ kho A sang B | A giảm 3, B tăng 3; tổng lượng/giá trị không đổi |
| STOCK-10 | Sửa/xóa phiếu posted | Bị chặn; phải lập điều chỉnh |
| COST-01 | Nhập 10×100 rồi 10×200 | Lượng 20, giá trị 3000, bình quân 150 |
| COST-02 | Lưu lại phiếu nhập 10×200 đã posted | Bị chặn; giá vốn vẫn 150, không thành 175 như lỗi nguồn |
| COST-03 | Xuất ở giá vốn 100, sau đó nhập làm giá vốn tăng, khách trả | Giá trị trả theo dòng xuất gốc 100 |
| COST-04 | Xuất hết lượng có giá vốn lẻ | Giá trị tồn về 0, không để dư do làm tròn |
| COST-05 | Ghi lùi vào kỳ khóa hoặc trước biến động đã chốt giá | Bị chặn hoặc yêu cầu điều chỉnh kỳ mở |
| COST-06 | Trả NCC giá hoàn khác giá vốn | Tồn giảm theo giá vốn, giá hoàn lưu riêng |
| PROJ-01 | Kế hoạch 20, nhận kho 15, xuất 10, bàn giao 8 | Nhận 15, đang giao 2, bàn giao 8; chưa hoàn thành |
| PROJ-02 | P=20,H=8,T=2,R=5,O=5 | Còn bàn giao 12, còn xuất 10, còn cần nguồn 0 |
| PROJ-03 | Bàn giao nhiều lần vượt lượng xuất còn lại | Bị chặn transaction, không chỉ ở UI |
| PROJ-04 | Hạ kế hoạch dưới cam kết, cả sửa tay và Excel | Cùng validation; không để import bỏ qua kiểm tra |
| PROJ-05 | Một gói có 1 máy và 100 mét dây | Không tính tiến độ chung bằng cộng hai đơn vị |
| PROJ-06 | Đạt 99.6% được làm tròn 100 | Không tự hoàn tất khi dòng còn thiếu |
| BUY-01 | Đặt 20, phân bổ A=12/B=8, nhận 10 cho A | Còn đặt A=2/B=8, giữ A tăng 10; không cộng giữ cho B |
| BUY-02 | Nhập vượt lượng đơn mua chưa nhận | Bị chặn, yêu cầu điều chỉnh đơn đã duyệt |
| BUY-03 | Hủy phần chưa nhận của đơn mua | Giảm O tương ứng, nhu cầu mua mở lại |
| RETURN-01 | Khách trả giảm giao 2 sau bàn giao 8 | H còn 6; tồn nhận tăng 2 nếu công ty nhận lại sở hữu |
| RETURN-02 | Khách gửi bảo hành 2 | H không giảm; không tăng tồn sở hữu hoặc lãi gộp |
| RETURN-03 | Trả nhiều lần vượt lượng nguồn | Bị chặn, gồm trường hợp hai request đồng thời |
| SERIAL-01 | Xuất hàng theo serial với số serial thiếu/trùng/sai kho | Bị chặn |
| SERIAL-02 | Hai request xuất cùng serial | Chỉ một thành công |
| SERIAL-03 | Nhập lại serial khách trả đúng nguồn | Hợp lệ, không tạo thiết bị trùng |
| COUNT-01 | Phiếu xuất tác động hàng đang kiểm kê | Bị chặn theo phạm vi khóa |
| COUNT-02 | Duyệt kiểm kê hai lần | Một bộ điều chỉnh duy nhất |
| EXPORT-01 | Có 502 dòng thỏa bộ lọc | Export đủ 502, không cắt 500 như nguồn |
| IMPORT-01 | Mã/tên có chữ hoa tiếng Việt và khoảng trắng | Preview/commit nhận diện trùng nhất quán |
| IMPORT-02 | Import lại cùng batch nguồn | Không tăng lượng hoặc nhân đôi dòng |
| MIG-01 | Receipt dự án trùng phiếu nhập kho | Chỉ một sự kiện tồn; có mapping hai nguồn |
| MIG-02 | Vừa có stocks vừa lịch sử vouchers | Không mở sổ rồi cộng lại toàn bộ lịch sử |
| RECOVERY-01 | Phục hồi backup vào môi trường riêng | Tồn/giá trị/chứng từ/serial đối soát khớp |

## 3. Các luồng nghiệm thu qua giao diện

1. Tạo sản phẩm → tạo dự án/gói → kế hoạch 20 máy → giữ 5 máy có sẵn → đặt thêm 15 → nhận 10 → xuất giao 12 → bàn giao 8 → xem chính xác nguồn hàng và lượng còn thiếu.
2. Nhập hàng theo serial → xuất cho khách → xác nhận bàn giao → khách trả một serial → đối chiếu tồn, giá vốn và tiến độ.
3. Nhân viên lập phiếu → quản lý trả lại → nhân viên sửa → quản lý ghi sổ → thử sửa trực tiếp bị chặn → lập phiếu điều chỉnh đúng quyền.
4. Chốt kiểm kê có chênh lệch → duyệt → sổ có chứng từ điều chỉnh và mở lại phạm vi ghi.
5. Nhập thử dữ liệu cũ → xử lý dòng trùng hai nguồn → xem báo cáo chênh lệch → phê duyệt mở sổ → nhập/xuất tiếp được.

## 4. Định nghĩa hoàn thành

Phần mềm hợp nhất chỉ được gọi là hoàn thành khi có giao diện, API, migration database, kiểm thử các invariant trên, hướng dẫn cài đặt/vận hành và kết quả nghiệm thu. Một repo chung chứa hai ứng dụng độc lập hoặc hai iframe không đáp ứng mục tiêu.

Bộ tài liệu hiện tại hoàn thành bước thiết kế; chưa thay thế các điều kiện triển khai và nghiệm thu này.
