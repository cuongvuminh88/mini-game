/* =========================================================================
   validate.js — quy tắc kiểm tra dữ liệu đăng ký (QT-60…QT-64, QT-71, QT-84)
   Dùng chung cho máy chủ (require) và trình duyệt (window.Validate),
   để hai bên luôn cùng một luật. Máy chủ là nơi quyết định cuối cùng.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Validate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MSG = Object.freeze({
    nameRequired: 'Vui lòng nhập họ tên.',
    nameInvalid: 'Họ tên từ 2 đến 80 ký tự, chỉ gồm chữ, dấu cách và dấu ’ - .',
    emailRequired: 'Vui lòng nhập email.',
    emailInvalid: 'Email chưa đúng, ví dụ: ten@gmail.com',
    phoneRequired: 'Vui lòng nhập số điện thoại.',
    phoneInvalid: 'Số điện thoại di động Việt Nam gồm 10 số, ví dụ: 0912 345 678',
    consentRequired: 'Bạn cần đồng ý để tiếp tục.'
  });

  const NAME_MIN = 2;
  const NAME_MAX = 80;
  const EMAIL_MAX = 254;
  const SPAWNED_MAX = 60;
  const SEARCH_MAX = 100;

  const NAME_CHARS = /^[\p{L}\p{M} '’.\-]+$/u;
  const HAS_LETTER = /\p{L}/u;
  const EMAIL_RE = /^[^\s@]+@(?:[^\s@.]+\.)+[a-z]{2,}$/;
  const PHONE_SEPARATORS = /[\s.\-()]/g;
  const PHONE_RE = /^0[35789]\d{8}$/;

  // QT-60: NFC, cắt đầu/cuối, gộp khoảng trắng
  function clean(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  function fullName(raw) {
    const value = clean(raw);
    if (!value) return { error: MSG.nameRequired };
    const len = Array.from(value).length;
    if (len < NAME_MIN || len > NAME_MAX || !NAME_CHARS.test(value) || !HAS_LETTER.test(value)) {
      return { error: MSG.nameInvalid };
    }
    return { value: value };
  }

  function email(raw) {
    const value = clean(raw).toLowerCase();
    if (!value) return { error: MSG.emailRequired };
    if (value.length > EMAIL_MAX || !EMAIL_RE.test(value)) return { error: MSG.emailInvalid };
    return { value: value };
  }

  function phone(raw) {
    let value = clean(raw);
    if (!value) return { error: MSG.phoneRequired };
    value = value.replace(PHONE_SEPARATORS, '');
    if (value.startsWith('+84')) value = '0' + value.slice(3);
    else if (/^84\d{9}$/.test(value)) value = '0' + value.slice(2);
    if (!PHONE_RE.test(value)) return { error: MSG.phoneInvalid };
    return { value: value };
  }

  function consent(raw) {
    return raw === true ? { value: true } : { error: MSG.consentRequired };
  }

  // Kiểm tra cả form. Trả { ok, values, errors } — errors theo tên trường.
  function registration(input) {
    const src = input && typeof input === 'object' ? input : {};
    const checks = {
      fullName: fullName(src.fullName),
      email: email(src.email),
      phone: phone(src.phone),
      consent: consent(src.consent)
    };
    const values = {};
    const errors = {};
    Object.keys(checks).forEach(function (key) {
      if (checks[key].error) errors[key] = checks[key].error;
      else values[key] = checks[key].value;
    });
    return { ok: Object.keys(errors).length === 0, values: values, errors: errors };
  }

  // QT-71: chỉ chặn số vô lý
  function round(input) {
    const src = input && typeof input === 'object' ? input : {};
    const score = src.score, hits = src.hits, spawned = src.spawned;
    const isCount = function (n) { return Number.isInteger(n) && n >= 0; };
    if (!isCount(score) || !isCount(hits) || !isCount(spawned)) return { ok: false };
    if (score !== hits || hits > spawned || spawned > SPAWNED_MAX) return { ok: false };
    return { ok: true, values: { score: score, hits: hits, spawned: spawned } };
  }

  // QT-84: chữ thường, bỏ dấu tiếng Việt (đ → d)
  function foldForSearch(value) {
    return clean(value)
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase();
  }

  // "Nguyễn Thị Lan" → "Lan"
  function callName(full) {
    const parts = clean(full).split(' ');
    return parts[parts.length - 1] || '';
  }

  return Object.freeze({
    MSG: MSG,
    SEARCH_MAX: SEARCH_MAX,
    clean: clean,
    fullName: fullName,
    email: email,
    phone: phone,
    consent: consent,
    registration: registration,
    round: round,
    foldForSearch: foldForSearch,
    callName: callName
  });
});
