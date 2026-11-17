/* login.js — MH-10 · Đăng nhập quản trị (CN-17) */
(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const user = document.getElementById('username');
  const pass = document.getElementById('password');
  const error = document.getElementById('login-error');
  const button = document.getElementById('btn-login');
  let busy = false;

  if (new URLSearchParams(location.search).get('expired') === '1') {
    error.textContent = 'Phiên đăng nhập đã hết hạn.';
  }
  user.focus();

  function setBusy(value) {
    busy = value;
    button.setAttribute('aria-disabled', value ? 'true' : 'false');
    button.textContent = value ? 'Đang đăng nhập…' : 'Đăng nhập';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy) return;
    if (!user.value || !pass.value) {
      error.textContent = 'Vui lòng nhập tên đăng nhập và mật khẩu.';
      (user.value ? pass : user).focus();
      return;
    }
    error.textContent = '';
    setBusy(true);
    fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.value, password: pass.value })
    }).then(function (res) {
      if (res.status === 204) { location.replace('/admin'); return; }
      return res.json().catch(function () { return {}; }).then(function (data) {
        error.textContent = data.error || 'Không đăng nhập được, vui lòng thử lại.';
        pass.value = '';                                    // xoá mật khẩu sau mỗi lần sai
        pass.focus();
        setBusy(false);
      });
    }).catch(function () {
      error.textContent = 'Không kết nối được máy chủ. Vui lòng thử lại.';
      setBusy(false);
    });
  });
})();
