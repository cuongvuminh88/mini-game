/* admin.js — MH-11 Danh sách người chơi, MH-12 Hộp xác nhận xoá.
   Dữ liệu người chơi luôn chèn bằng textContent, không bao giờ innerHTML (QT-87). */
(function () {
  'use strict';

  const SEARCH_DELAY_MS = 300;
  const $ = function (id) { return document.getElementById(id); };
  const el = {
    total: $('total'), search: $('search'), csv: $('btn-csv'), logout: $('btn-logout'),
    status: $('status'), rows: $('rows'), empty: $('empty'),
    prev: $('btn-prev'), next: $('btn-next'), pageInfo: $('page-info'),
    dialog: $('confirm'), confirmText: $('confirm-text'), confirmError: $('confirm-error'),
    cancel: $('btn-cancel'), confirm: $('btn-confirm')
  };

  const params = new URLSearchParams(location.search);
  const view = {
    q: (params.get('q') || '').slice(0, 100),
    page: Math.max(1, parseInt(params.get('page'), 10) || 1),
    pages: 1,
    items: []
  };
  let loadSeq = 0;
  let searchTimer = 0;
  let pending = null;        // { player, returnFocus }
  let deleting = false;

  /* ----- Định dạng ----- */
  const timeFmt = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function formatTime(iso) {
    if (!iso) return '—';
    const p = {};
    timeFmt.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
  }
  function formatNumber(n) { return Number(n).toLocaleString('vi-VN'); }

  /* ----- Gọi API ----- */
  function handleAuth(res) {
    if (res.status === 401 || res.status === 503) {
      location.replace('/admin/login' + (res.status === 401 ? '?expired=1' : ''));
      throw new Error('auth');
    }
    return res;
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (view.q) p.set('q', view.q);
    if (view.page > 1) p.set('page', String(view.page));
    const qs = p.toString();
    history.replaceState(null, '', '/admin' + (qs ? '?' + qs : ''));
    el.csv.href = '/api/admin/players.csv' + (view.q ? '?q=' + encodeURIComponent(view.q) : '');
  }

  function load() {
    const seq = ++loadSeq;
    const p = new URLSearchParams({ page: String(view.page) });
    if (view.q) p.set('q', view.q);
    return fetch('/api/admin/players?' + p.toString(), { credentials: 'same-origin' })
      .then(handleAuth)
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (seq !== loadSeq) return;                       // bỏ kết quả của lần gọi cũ
        view.page = data.page;
        view.pages = data.pages;
        view.items = data.items;
        render(data.total);
        syncUrl();
      })
      .catch(function (err) {
        if (err.message === 'auth' || seq !== loadSeq) return;
        el.status.textContent = 'Không tải được danh sách, vui lòng thử lại.';
      });
  }

  /* ----- Hiển thị ----- */
  function cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function render(total) {
    el.total.textContent = '(' + formatNumber(total) + ')';
    el.rows.textContent = '';
    const frag = document.createDocumentFragment();
    view.items.forEach(function (p) {
      const tr = document.createElement('tr');
      tr.appendChild(cell(p.fullName));
      tr.appendChild(cell(p.email));
      tr.appendChild(cell(p.phone, 'num'));
      tr.appendChild(cell(formatTime(p.createdAt), 'num nowrap'));
      tr.appendChild(cell(formatNumber(p.rounds), 'n num'));
      tr.appendChild(cell(p.bestScore === null ? '—' : formatNumber(p.bestScore), 'n num'));
      tr.appendChild(cell(formatTime(p.lastPlayed), 'num nowrap'));
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-text-danger';
      btn.textContent = 'Xoá';
      btn.setAttribute('aria-label', 'Xoá ' + p.fullName);
      btn.addEventListener('click', function () { openConfirm(p, btn); });
      td.appendChild(btn);
      tr.appendChild(td);
      frag.appendChild(tr);
    });
    el.rows.appendChild(frag);

    const isEmpty = view.items.length === 0;
    el.empty.hidden = !isEmpty;
    if (isEmpty) {
      el.empty.textContent = view.q
        ? 'Không tìm thấy người chơi nào khớp “' + view.q + '”.'
        : 'Chưa có người chơi nào đăng ký.';
    }
    el.pageInfo.textContent = 'Trang ' + view.page + ' / ' + view.pages;
    el.prev.disabled = view.page <= 1;
    el.next.disabled = view.page >= view.pages;
  }

  /* ----- Tìm kiếm (CN-19) ----- */
  function applySearch() {
    clearTimeout(searchTimer);
    const q = el.search.value.trim().slice(0, 100);
    if (q === view.q) return;
    view.q = q;
    view.page = 1;
    el.status.textContent = '';
    load();
  }

  el.search.value = view.q;
  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, SEARCH_DELAY_MS);
  });
  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); applySearch(); }
  });

  /* ----- Phân trang ----- */
  el.prev.addEventListener('click', function () { if (view.page > 1) { view.page -= 1; load(); } });
  el.next.addEventListener('click', function () { if (view.page < view.pages) { view.page += 1; load(); } });

  /* ----- Đăng xuất (CN-22) ----- */
  el.logout.addEventListener('click', function () {
    fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(function () { location.replace('/admin/login'); });
  });

  /* ----- Xoá (CN-20, MH-12) ----- */
  function openConfirm(player, returnFocus) {
    pending = { player: player, returnFocus: returnFocus };
    el.confirmText.textContent = '';
    el.confirmText.append(
      'Xoá người chơi ',
      Object.assign(document.createElement('strong'), { textContent: player.fullName }),
      ' (' + player.email + ')? Toàn bộ ' + formatNumber(player.rounds) +
      ' lượt chơi của người này cũng bị xoá. Không thể hoàn tác.'
    );
    el.confirmError.textContent = '';
    el.dialog.showModal();
    el.cancel.focus();                                       // mặc định: Huỷ
  }

  function closeConfirm() {
    if (el.dialog.open) el.dialog.close();
  }

  el.dialog.addEventListener('close', function () {
    if (pending && pending.returnFocus && document.contains(pending.returnFocus)) pending.returnFocus.focus();
    else el.search.focus();
    pending = null;
  });
  // Bấm ra ngoài hộp = Huỷ
  el.dialog.addEventListener('click', function (e) { if (e.target === el.dialog) closeConfirm(); });
  el.cancel.addEventListener('click', closeConfirm);

  el.confirm.addEventListener('click', function () {
    if (!pending || deleting) return;
    const player = pending.player;
    deleting = true;
    el.confirm.disabled = true;
    fetch('/api/admin/players/' + player.id, { method: 'DELETE', credentials: 'same-origin' })
      .then(handleAuth)
      .then(function (res) {
        // 404 = đã bị xoá ở tab khác → coi như xong (QT-86)
        if (res.status !== 204 && res.status !== 404) throw new Error('http ' + res.status);
        pending.returnFocus = null;
        closeConfirm();
        el.status.textContent = 'Đã xoá ' + player.fullName + '.';
        // Trang hiện tại trống sau khi xoá → lùi về trang trước
        if (view.items.length === 1 && view.page > 1) view.page -= 1;
        return load();
      })
      .catch(function (err) {
        if (err.message === 'auth') return;
        el.confirmError.textContent = 'Không xoá được, vui lòng thử lại.';
      })
      .finally(function () {
        deleting = false;
        el.confirm.disabled = false;
      });
  });

  syncUrl();
  load();
  el.search.focus();
})();
