# Đập Chuột

Game Đập Chuột chạy trên trình duyệt.

- `app/`: code game (HTML, CSS, JS)
- `design/`: design system (`tokens.css` và trang xem trước)
- `docs/`: tài liệu thiết kế game
- `server.js`: server Node.js nhỏ phục vụ `app/` (và `design/` tại `/design/`)

## Cách chạy bằng Docker

Cần cài [Docker Desktop](https://www.docker.com/products/docker-desktop/) (có sẵn Docker Compose).

1. Build và khởi động (chạy nền):

   ```bash
   docker compose up -d --build
   ```

2. Mở trình duyệt tại **http://localhost:3000**

3. Xem log:

   ```bash
   docker compose logs -f app
   ```

4. Dừng và xoá container:

   ```bash
   docker compose down
   ```

Sau khi sửa code trong `app/` hoặc `design/`, chạy lại bước 1 để build image mới.

Muốn đổi cổng trên máy (ví dụ 8080), sửa `ports` trong `compose.yaml` thành `"8080:3000"`.

### Lỗi `failed to xattr ... ._<tên file>` khi build

Ổ ngoài định dạng exFAT làm macOS tự sinh các file rác `._*`, và Docker không đọc được chúng khi build. Dọn các file này rồi build lại:

```bash
dot_clean -m .
```

### Chạy không cần Docker

Nếu máy có Node.js 18 trở lên:

```bash
npm start
```
