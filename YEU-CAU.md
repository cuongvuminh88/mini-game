# YÊU CẦU — Mini game "Đập Chuột"

Game chạy trên trình duyệt. Người chơi bấm vào con chuột thò lên từ các ô trong lưới 3×3 để ghi điểm trong 30 giây.

> Tài liệu này chỉ mô tả yêu cầu, chưa có code.

---

## 1. Phạm vi

- Chạy trên trình duyệt hiện đại (Chrome, Safari, Firefox, Edge, bản mới nhất), cả máy tính và điện thoại.
- Chỉ có một người chơi, không cần đăng nhập, không cần máy chủ.
- Dùng HTML, CSS, JavaScript thuần, không bắt buộc thư viện ngoài.
- Không có âm thanh bắt buộc (có thể bổ sung sau).

---

## 2. Luật chơi

1. Bàn chơi là lưới **3×3 = 9 ô** (hang chuột).
2. Người chơi bấm nút **"Bắt đầu"** để vào lượt chơi. Mỗi lượt kéo dài **30 giây**.
3. Trong lượt chơi, mỗi lần **chỉ có tối đa 1 con chuột** thò lên ở một ô ngẫu nhiên.
4. Chuột ở trên mặt đất trong một khoảng thời gian ngắn (mặc định **0,6 – 1,2 giây**, ngẫu nhiên) rồi tự thụt xuống.
5. Sau khi chuột thụt xuống (do bị đập hoặc hết giờ hiện), chuột mới xuất hiện ở một ô ngẫu nhiên sau một khoảng nghỉ ngắn (mặc định **0,2 – 0,5 giây**).
6. Chuột mới **không xuất hiện lại ở đúng ô vừa xuất hiện** lần trước liền kề.
7. Người chơi bấm (click chuột máy tính hoặc chạm trên màn hình cảm ứng) vào ô đang có chuột để đập.
8. Mỗi con chuột chỉ đập được **một lần**. Sau khi bị đập trúng, chuột thụt xuống ngay.
9. Khi đồng hồ về **0**:
   - Không có chuột mới xuất hiện; chuột đang hiện (nếu có) biến mất.
   - Mọi cú bấm sau thời điểm này đều không được tính.
   - Chuyển sang màn hình Kết thúc.
10. Người chơi có thể chơi lại không giới hạn số lần.

---

## 3. Cách tính điểm

| Hành động | Điểm |
|---|---|
| Bấm trúng ô đang có chuột | **+1** |
| Bấm vào ô trống | 0 (không trừ điểm) |
| Bấm lại vào chuột đã bị đập | 0 |
| Bấm sau khi hết giờ | 0 |

- Điểm bắt đầu mỗi lượt là **0**.
- Điểm không bao giờ âm.
- **Điểm cao nhất (kỷ lục)** được lưu trên trình duyệt (localStorage) và giữ nguyên khi tải lại trang. Nếu trình duyệt không cho lưu, game vẫn chạy bình thường, chỉ là kỷ lục không được giữ lại.
- Khi điểm lượt vừa chơi lớn hơn kỷ lục cũ thì cập nhật kỷ lục và hiện thông báo "Kỷ lục mới!".

---

## 4. Màn hình

Game có 3 trạng thái hiển thị trên cùng một trang.

### 4.1. Màn hình Bắt đầu

- Tên game: **"Đập Chuột"**.
- Mô tả ngắn luật chơi (1–2 dòng), ví dụ: "Bấm trúng chuột để ghi điểm. Bạn có 30 giây!"
- Hiển thị **Kỷ lục** hiện tại (0 nếu chưa chơi lần nào).
- Nút **"Bắt đầu"**.

### 4.2. Màn hình Đang chơi

```
┌───────────────────────────────┐
│  Điểm: 12        Thời gian: 18 │
├───────────────────────────────┤
│   ┌───┐   ┌───┐   ┌───┐       │
│   │   │   │ 🐭│   │   │       │
│   └───┘   └───┘   └───┘       │
│   ┌───┐   ┌───┐   ┌───┐       │
│   │   │   │   │   │   │       │
│   └───┘   └───┘   └───┘       │
│   ┌───┐   ┌───┐   ┌───┐       │
│   │   │   │   │   │   │       │
│   └───┘   └───┘   └───┘       │
└───────────────────────────────┘
```

- **Thanh trên cùng:**
  - **Điểm** hiện tại, cập nhật ngay khi đập trúng.
  - **Thời gian còn lại** tính bằng giây, đếm ngược từ 30 về 0, cập nhật mỗi giây.
  - Khi còn **≤ 5 giây**, đồng hồ đổi màu (ví dụ đỏ) để cảnh báo.
- **Lưới 3×3:**
  - 9 ô có kích thước bằng nhau, xếp đều, nằm giữa màn hình.
  - Ô trống hiển thị hình cái hang.
  - Ô có chuột hiển thị hình con chuột (hiệu ứng thò lên).
  - Khi đập trúng: có phản hồi thị giác rõ ràng (ví dụ chuột đổi hình "bị đập", ô nháy sáng, hoặc hiện "+1" bay lên).
- Con trỏ chuột trên máy tính có thể là hình cái búa (không bắt buộc).

### 4.3. Màn hình Kết thúc

- Dòng chữ **"Hết giờ!"**.
- **Điểm của lượt vừa chơi.**
- **Kỷ lục**, kèm dòng "Kỷ lục mới!" nếu vừa phá kỷ lục.
- Nút **"Chơi lại"**: bấm vào thì bắt đầu ngay lượt mới (điểm về 0, đồng hồ về 30).

### 4.4. Yêu cầu hiển thị chung

- Bố cục co giãn: dùng được ở màn hình rộng **320px** trở lên, không bị cuộn ngang.
- Mỗi ô trong lưới có kích thước tối thiểu **80×80px** để dễ chạm trên điện thoại.
- Chạm trên điện thoại không gây phóng to trang hay chọn chữ.
- Chữ và số đủ lớn, dễ đọc (điểm và thời gian tối thiểu 20px).

---

## 5. Thông số mặc định

| Thông số | Giá trị |
|---|---|
| Kích thước lưới | 3 × 3 |
| Thời gian một lượt | 30 giây |
| Thời gian chuột hiện | 0,6 – 1,2 giây (ngẫu nhiên) |
| Khoảng nghỉ giữa hai con chuột | 0,2 – 0,5 giây (ngẫu nhiên) |
| Số chuột tối đa cùng lúc | 1 |
| Điểm mỗi lần đập trúng | 1 |

Các thông số này nên được đặt tập trung ở một chỗ để dễ chỉnh sau.

---

## 6. Tiêu chí hoàn thành

Game được coi là hoàn thành khi **tất cả** các mục dưới đây đều đạt.

### Chức năng

- [ ] Mở file trên trình duyệt thấy màn hình Bắt đầu, có tên game, luật chơi ngắn, kỷ lục và nút "Bắt đầu".
- [ ] Bấm "Bắt đầu" thì hiện lưới 3×3, điểm = 0, thời gian = 30.
- [ ] Đồng hồ đếm ngược đúng từ 30 về 0 (sai lệch không quá 1 giây so với đồng hồ thật).
- [ ] Chuột xuất hiện ở ô ngẫu nhiên, mỗi lúc chỉ có tối đa 1 con, không lặp lại ở cùng ô hai lần liên tiếp.
- [ ] Chuột tự thụt xuống nếu không bị đập trong thời gian quy định.
- [ ] Bấm trúng chuột được +1 điểm và có phản hồi thị giác.
- [ ] Bấm liên tục nhiều lần vào cùng một con chuột chỉ được +1.
- [ ] Bấm vào ô trống không làm thay đổi điểm.
- [ ] Khi còn ≤ 5 giây, đồng hồ đổi màu.
- [ ] Hết 30 giây: chuột biến mất, không bấm thêm điểm được nữa, hiện màn hình Kết thúc với điểm đúng.
- [ ] Phá kỷ lục thì kỷ lục được cập nhật và hiện "Kỷ lục mới!".
- [ ] Tải lại trang vẫn thấy kỷ lục cũ.
- [ ] Bấm "Chơi lại" bắt đầu lượt mới với điểm 0 và thời gian 30; chơi lại nhiều lần liên tiếp vẫn đúng (không bị chạy hai đồng hồ cùng lúc, chuột không xuất hiện nhanh dần).

### Giao diện và thiết bị

- [ ] Chạy đúng trên Chrome, Safari, Firefox bản mới nhất trên máy tính.
- [ ] Chạy đúng trên điện thoại (Safari iOS, Chrome Android): chạm được vào ô, không bị phóng to, không cuộn ngang ở màn hình rộng 320px.
- [ ] Không có lỗi trong Console của trình duyệt trong suốt một lượt chơi.

### Bàn giao

- [ ] Mở trực tiếp file `index.html` là chơi được, không cần cài đặt hay chạy máy chủ.
- [ ] Các thông số ở mục 5 nằm tập trung một chỗ trong code.

---

## 7. Ngoài phạm vi (chưa làm ở phiên bản này)

- Âm thanh, nhạc nền.
- Nhiều cấp độ khó, chuột tăng tốc theo thời gian.
- Chuột "bom" trừ điểm hoặc chuột vàng nhiều điểm.
- Bảng xếp hạng trực tuyến, đăng nhập.
- Tạm dừng giữa lượt.
