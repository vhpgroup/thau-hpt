import "./globals.css";
export const metadata = {
  title: "HPT · Dự án & Kho",
  description:
    "Điều phối dự án, nguồn hàng, kho và bàn giao trong một hệ thống.",
};
export default function Layout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
