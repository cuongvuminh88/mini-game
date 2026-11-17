// Lớp database — PostgreSQL qua node-postgres (pg).
// Kết nối đọc từ biến môi trường PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD.
// Mọi câu SQL đều dùng tham số $1, $2… — không ghép chuỗi người dùng (QT-75).
'use strict';

const { Pool } = require('pg');

const PAGE_SIZE = 20;

const pool = new Pool({ max: 10, idleTimeoutMillis: 30000 });
pool.on('error', (err) => console.error('[db] lỗi kết nối nền:', err.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id           BIGSERIAL   PRIMARY KEY,
  token        TEXT        NOT NULL UNIQUE,
  full_name    TEXT        NOT NULL,
  name_search  TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  phone        TEXT        NOT NULL,
  consent_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id         BIGSERIAL   PRIMARY KEY,
  player_id  BIGINT      NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score      INTEGER     NOT NULL CHECK (score >= 0),
  hits       INTEGER     NOT NULL CHECK (hits >= 0),
  spawned    INTEGER     NOT NULL CHECK (spawned >= hits),
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rounds_player   ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_players_created ON players(created_at DESC);
`;

// Chờ database sẵn sàng rồi tạo bảng. Hết lượt thử thì ném lỗi để process thoát (QT-78).
async function init({ attempts = 15, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] chưa kết nối được (${err.code || err.message}), thử lại ${i}/${attempts}…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// QT-65: email đã có thì dùng lại hồ sơ cũ, không ghi đè.
// Trả về { id, token, created } — created=false nghĩa là email đã tồn tại.
async function registerPlayer({ token, fullName, nameSearch, email, phone }) {
  const inserted = await pool.query(
    `INSERT INTO players (token, full_name, name_search, email, phone, consent_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (email) DO NOTHING
     RETURNING id, token`,
    [token, fullName, nameSearch, email, phone]
  );
  if (inserted.rowCount === 1) return { ...inserted.rows[0], created: true };
  const existing = await pool.query('SELECT id, token FROM players WHERE email = $1', [email]);
  return { ...existing.rows[0], created: false };
}

async function findPlayerByToken(token) {
  const { rows } = await pool.query('SELECT id, full_name FROM players WHERE token = $1', [token]);
  return rows[0] || null;
}

async function addRound(playerId, { score, hits, spawned }) {
  await pool.query(
    'INSERT INTO rounds (player_id, score, hits, spawned) VALUES ($1, $2, $3, $4)',
    [playerId, score, hits, spawned]
  );
}

// QT-84: thoát % _ \ để LIKE chỉ khớp đúng ký tự người dùng gõ
function likePattern(value) {
  return '%' + value.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

// Điều kiện tìm kiếm dùng chung cho danh sách, đếm và xuất CSV.
function searchFilter(search) {
  if (!search || !search.raw) return { where: '', params: [] };
  const params = [likePattern(search.folded), likePattern(search.lower)];
  let where = `WHERE (p.name_search LIKE $1 ESCAPE '\\' OR p.email LIKE $2 ESCAPE '\\'`;
  if (search.digits.length >= 3) {
    params.push(likePattern(search.digits));
    where += ` OR p.phone LIKE $3 ESCAPE '\\'`;
  }
  where += ')';
  return { where, params };
}

const LIST_COLUMNS = `
  p.id, p.full_name, p.email, p.phone, p.created_at, p.consent_at,
  COUNT(r.id)::int AS rounds, MAX(r.score) AS best_score, MAX(r.played_at) AS last_played`;

async function listPlayers(search, page) {
  const { where, params } = searchFilter(search);
  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM players p ${where}`, params);
  const total = countRes.rows[0].n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const limitIdx = params.length + 1;
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}
     FROM players p LEFT JOIN rounds r ON r.player_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
    [...params, PAGE_SIZE, (current - 1) * PAGE_SIZE]
  );
  return { total, page: current, pages, pageSize: PAGE_SIZE, items: rows };
}

async function allPlayers(search) {
  const { where, params } = searchFilter(search);
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS}
     FROM players p LEFT JOIN rounds r ON r.player_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC, p.id DESC`,
    params
  );
  return rows;
}

// QT-86: xoá hẳn; ON DELETE CASCADE xoá luôn các lượt. Trả true nếu có xoá.
async function deletePlayer(id) {
  const res = await pool.query('DELETE FROM players WHERE id = $1', [id]);
  return res.rowCount === 1;
}

module.exports = {
  pool, init, registerPlayer, findPlayerByToken, addRound,
  listPlayers, allPlayers, deletePlayer, PAGE_SIZE
};
