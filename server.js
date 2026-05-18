const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── 스토리지 선택: DB 또는 JSON 파일 ─────────────
const USE_DB = !!process.env.DATABASE_URL;
let pool;

if (USE_DB) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

// ── JSON 파일 헬퍼 (로컬 개발용) ─────────────────
function readJSON(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function writeJSON(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ── DB 초기화 + JSON → DB 마이그레이션 ───────────
async function initDB() {
  if (!USE_DB) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id           TEXT PRIMARY KEY,
      date_label   TEXT    DEFAULT '',
      title        TEXT    DEFAULT '',
      summary      TEXT    DEFAULT '',
      handout_id   TEXT,
      sort_order   INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS handouts (
      id                 TEXT    PRIMARY KEY,
      title              TEXT    DEFAULT '',
      type               TEXT    DEFAULT 'text',
      content            TEXT    DEFAULT '',
      npc                TEXT    DEFAULT '',
      item               TEXT    DEFAULT '',
      image_url          TEXT    DEFAULT '',
      is_public          BOOLEAN DEFAULT true,
      acquired_date      TEXT    DEFAULT '',
      acquired_location  TEXT    DEFAULT '',
      player_summary     TEXT    DEFAULT '',
      player_deductions  JSONB   DEFAULT '[]'::jsonb,
      sort_order         INTEGER DEFAULT 0
    )
  `);
  // 기존 테이블에 sort_order 컬럼 없으면 추가
  await pool.query(`ALTER TABLE handouts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`);

  // JSON 파일이 있고 DB가 비어있으면 마이그레이션
  const { rows: ec } = await pool.query('SELECT COUNT(*)::int AS c FROM events');
  if (ec[0].c === 0 && fs.existsSync(path.join(DATA_DIR, 'events.json'))) {
    const events = readJSON('events.json');
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      await pool.query(
        'INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [e.id, e.date, e.title, e.summary, e.handout_id || null, i]
      );
    }
    console.log(`이벤트 ${events.length}개 마이그레이션 완료`);
  }

  const { rows: hc } = await pool.query('SELECT COUNT(*)::int AS c FROM handouts');
  if (hc[0].c === 0 && fs.existsSync(path.join(DATA_DIR, 'handouts.json'))) {
    const handouts = readJSON('handouts.json');
    for (let i = 0; i < handouts.length; i++) {
      const h = handouts[i];
      await pool.query(
        `INSERT INTO handouts (id,title,type,content,npc,item,image_url,is_public,acquired_date,acquired_location,player_summary,player_deductions,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [h.id, h.title, h.type||'text', h.content||'', h.npc||'', h.item||'',
         h.image_url||'', h.is_public!==false,
         h.acquired_date||'', h.acquired_location||'',
         h.player_summary||'', JSON.stringify(h.player_deductions||[]), i]
      );
    }
    console.log(`핸드아웃 ${handouts.length}개 마이그레이션 완료`);
  }
}

// ── DB 행 → API 응답 형식 변환 ────────────────────
function fmtEvent(r, i)    { return { id: r.id, date: r.date_label, title: r.title, summary: r.summary, handout_id: r.handout_id || null }; }
function fmtHandout(r)     { return { ...r, player_deductions: r.player_deductions || [] }; }

// ═══════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════
app.get('/api/events', async (req, res) => {
  if (USE_DB) {
    const { rows } = await pool.query('SELECT * FROM events ORDER BY sort_order');
    return res.json(rows.map(fmtEvent));
  }
  res.json(readJSON('events.json'));
});

app.put('/api/events/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: '잘못된 요청' });
  if (USE_DB) {
    for (let i = 0; i < ids.length; i++)
      await pool.query('UPDATE events SET sort_order=$1 WHERE id=$2', [i, ids[i]]);
    return res.json({ ok: true });
  }
  const events = readJSON('events.json');
  writeJSON('events.json', ids.map(id => events.find(e => e.id === id)).filter(Boolean));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// HANDOUTS
// ═══════════════════════════════════════════════════
app.get('/api/handouts', async (req, res) => {
  if (USE_DB) {
    const { rows } = await pool.query('SELECT * FROM handouts ORDER BY sort_order, id');
    return res.json(rows.map(fmtHandout));
  }
  res.json(readJSON('handouts.json'));
});

app.put('/api/handouts/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: '잘못된 요청' });
  if (USE_DB) {
    for (let i = 0; i < ids.length; i++)
      await pool.query('UPDATE handouts SET sort_order=$1 WHERE id=$2', [i, ids[i]]);
    return res.json({ ok: true });
  }
  const handouts = readJSON('handouts.json');
  writeJSON('handouts.json', ids.map(id => handouts.find(h => h.id === id)).filter(Boolean));
  res.json({ ok: true });
});

app.get('/api/handouts/:id', async (req, res) => {
  if (USE_DB) {
    const { rows } = await pool.query('SELECT * FROM handouts WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
    return res.json(fmtHandout(rows[0]));
  }
  const h = readJSON('handouts.json').find(h => h.id === req.params.id);
  if (!h) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
  res.json(h);
});

app.post('/api/handouts', async (req, res) => {
  const { title, content='', npc='', item='', acquired_date='', acquired_location='', event_id } = req.body;
  if (!title) return res.status(400).json({ error: '제목을 입력해주세요.' });
  const id = 'ho_' + Date.now();

  if (USE_DB) {
    await pool.query(
      `INSERT INTO handouts (id,title,content,npc,item,acquired_date,acquired_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, title, content, npc, item, acquired_date, acquired_location]
    );
    if (event_id)
      await pool.query('UPDATE events SET handout_id=$1 WHERE id=$2', [id, event_id]);
    const { rows } = await pool.query('SELECT * FROM handouts WHERE id=$1', [id]);
    return res.json(fmtHandout(rows[0]));
  }
  const handouts = readJSON('handouts.json');
  const newH = { id, title, content, npc, item, image_url:'', is_public:true,
                  acquired_date, acquired_location, player_summary:'', player_deductions:[] };
  handouts.push(newH);
  writeJSON('handouts.json', handouts);
  if (event_id) {
    const events = readJSON('events.json');
    const evt = events.find(e => e.id === event_id);
    if (evt) { evt.handout_id = id; writeJSON('events.json', events); }
  }
  res.json(newH);
});

const EDITABLE = ['title','content','npc','item','acquired_date','acquired_location','player_summary'];

app.patch('/api/handouts/:id', async (req, res) => {
  if (USE_DB) {
    const sets = []; const vals = []; let i = 1;
    EDITABLE.forEach(k => { if (req.body[k] !== undefined) { sets.push(`${k}=$${i++}`); vals.push(req.body[k]); } });
    if (!sets.length) return res.status(400).json({ error: '수정할 내용 없음' });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE handouts SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
    return res.json(fmtHandout(rows[0]));
  }
  const handouts = readJSON('handouts.json');
  const idx = handouts.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
  EDITABLE.forEach(k => { if (req.body[k] !== undefined) handouts[idx][k] = req.body[k]; });
  writeJSON('handouts.json', handouts);
  res.json(handouts[idx]);
});

app.delete('/api/handouts/:id', async (req, res) => {
  if (USE_DB) {
    await pool.query('DELETE FROM handouts WHERE id=$1', [req.params.id]);
    await pool.query('UPDATE events SET handout_id=NULL WHERE handout_id=$1', [req.params.id]);
    return res.json({ ok: true });
  }
  const handouts = readJSON('handouts.json');
  const idx = handouts.findIndex(h => h.id === req.params.id);
  if (idx !== -1) { handouts.splice(idx, 1); writeJSON('handouts.json', handouts); }
  const events = readJSON('events.json');
  let changed = false;
  events.forEach(e => { if (e.handout_id === req.params.id) { e.handout_id = null; changed = true; } });
  if (changed) writeJSON('events.json', events);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// DEDUCTIONS
// ═══════════════════════════════════════════════════
app.post('/api/handouts/:id/deductions', async (req, res) => {
  const { nickname, text } = req.body;
  if (!nickname || !text) return res.status(400).json({ error: '닉네임과 내용을 입력해주세요.' });
  const comment = { id: Date.now().toString(), nickname, text, timestamp: new Date().toISOString() };

  if (USE_DB) {
    await pool.query(
      `UPDATE handouts SET player_deductions = player_deductions || $1::jsonb WHERE id=$2`,
      [JSON.stringify([comment]), req.params.id]
    );
    return res.json(comment);
  }
  const handouts = readJSON('handouts.json');
  const idx = handouts.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
  if (!Array.isArray(handouts[idx].player_deductions)) handouts[idx].player_deductions = [];
  handouts[idx].player_deductions.push(comment);
  writeJSON('handouts.json', handouts);
  res.json(comment);
});

app.delete('/api/handouts/:id/deductions/:cid', async (req, res) => {
  if (USE_DB) {
    await pool.query(
      `UPDATE handouts
       SET player_deductions = COALESCE(
         (SELECT jsonb_agg(e) FROM jsonb_array_elements(player_deductions) e WHERE e->>'id' != $1),
         '[]'::jsonb)
       WHERE id=$2`,
      [req.params.cid, req.params.id]
    );
    return res.json({ ok: true });
  }
  const handouts = readJSON('handouts.json');
  const idx = handouts.findIndex(h => h.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '핸드아웃을 찾을 수 없습니다.' });
  handouts[idx].player_deductions = (handouts[idx].player_deductions || []).filter(c => c.id !== req.params.cid);
  writeJSON('handouts.json', handouts);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.redirect('/timeline.html'));

// ── 서버 시작 ─────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`)))
  .catch(err => { console.error('초기화 실패:', err.message); process.exit(1); });
