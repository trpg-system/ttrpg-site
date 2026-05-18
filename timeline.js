// ── 상태 ─────────────────────────────────────────
let allEvents     = [];
let dragSrcId     = null;
let savedNickname = '';
const handoutCache = {};

// ── DOM ──────────────────────────────────────────
const timelineEl   = document.getElementById('timeline');
const overlay      = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalClose   = document.getElementById('modalClose');

// ── 초기 로드 ────────────────────────────────────
async function loadTimeline() {
  try {
    const res = await fetch('/api/events');
    if (!res.ok) throw new Error();
    allEvents = await res.json();
    renderTimeline();
  } catch {
    timelineEl.innerHTML = '<div class="error">타임라인을 불러오지 못했습니다.</div>';
  }
}

async function loadHandoutSection() {
  try {
    const r = await fetch('/api/handouts');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const handouts = await r.json();
    handouts.forEach(h => { handoutCache[h.id] = h; });
    renderHandoutGrid(handouts);
  } catch (e) {
    document.getElementById('handoutGrid').innerHTML = `<div class="error">불러오기 실패: ${e.message}</div>`;
  }
}

function renderHandoutGrid(handouts) {
  const grid = document.getElementById('handoutGrid');
  if (!handouts.length) {
    grid.innerHTML = '<div class="handout-grid-empty">아직 핸드아웃이 없습니다.</div>';
    return;
  }
  grid.innerHTML = '';
  handouts.forEach(h => grid.appendChild(buildHandoutBlock(h)));
}

function buildHandoutBlock(h) {
  const block = document.createElement('div');
  block.className = 'handout-block';
  block.dataset.hid = h.id;

  const acqMeta = [
    h.acquired_date     ? `📅 ${h.acquired_date}`     : '',
    h.acquired_location ? `📍 ${h.acquired_location}` : '',
  ].filter(Boolean).join('  ');

  block.innerHTML = `
    <div class="handout-block-icon">📄</div>
    <div class="handout-block-body">
      <div class="handout-block-title">${escHtml(h.title)}</div>
      <div class="handout-block-preview">${escHtml(h.content)}</div>
      ${acqMeta ? `<div class="handout-block-meta">${escHtml(acqMeta)}</div>` : ''}
    </div>
    <div class="handout-block-actions">
      <button class="btn-block-action btn-block-view">보기</button>
      <button class="btn-block-action btn-block-delete">🗑</button>
    </div>
  `;

  block.querySelector('.btn-block-view').addEventListener('click', () => openHandout(h.id));
  block.querySelector('.btn-block-delete').addEventListener('click', () => confirmDeleteBlock(h.id, block));
  return block;
}

function confirmDeleteBlock(handoutId, block) {
  // 기존 확인창이 있으면 제거
  const existing = block.querySelector('.inline-delete-confirm');
  if (existing) { existing.remove(); return; }

  const box = document.createElement('div');
  box.className = 'inline-delete-confirm';
  box.innerHTML = `
    <span>삭제할까요?</span>
    <button class="btn-delete-confirm">삭제</button>
    <button class="btn-cancel">취소</button>
  `;
  block.appendChild(box);

  box.querySelector('.btn-cancel').addEventListener('click', () => box.remove());
  box.querySelector('.btn-delete-confirm').addEventListener('click', async () => {
    await fetch(`/api/handouts/${handoutId}`, { method: 'DELETE' });
    delete handoutCache[handoutId];
    const evt = allEvents.find(e => e.handout_id === handoutId);
    if (evt) { evt.handout_id = null; renderTimeline(); }
    block.remove();
    if (!document.querySelector('.handout-block')) {
      document.getElementById('handoutGrid').innerHTML =
        '<div class="handout-grid-empty">아직 핸드아웃이 없습니다.</div>';
    }
  });
}

// ── 타임라인 렌더 ────────────────────────────────
function renderTimeline() {
  timelineEl.innerHTML = '';
  if (!allEvents.length) {
    timelineEl.innerHTML = '<div class="loading">등록된 사건이 없습니다.</div>';
    return;
  }
  allEvents.forEach(evt => {
    const hasHandout = !!evt.handout_id;
    const item = document.createElement('div');
    item.className = `timeline-item${hasHandout ? '' : ' no-handout'}`;
    item.dataset.id = evt.id;

    const card = document.createElement('div');
    card.className = 'event-card';
    card.draggable = true;

    const actionsHtml = hasHandout
      ? `<div class="card-actions">
           <button class="btn-action btn-open-handout">📄 핸드아웃 보기</button>
           <button class="btn-action btn-toggle-deduction">💬 추리</button>
         </div>`
      : '';

    card.innerHTML = `
      <div class="event-card-top">
        <div class="drag-handle" title="드래그하여 순서 변경">⠿</div>
        <div class="event-body">
          <div class="event-date">${escHtml(evt.date)}</div>
          <div class="event-title">${escHtml(evt.title)}</div>
          <div class="event-summary">${escHtml(evt.summary)}</div>
          ${actionsHtml}
        </div>
      </div>
    `;

    // 추리 패널
    const panel = document.createElement('div');
    panel.className = 'deduction-panel';
    panel.innerHTML = `
      <div class="deduction-panel-inner">
        <div class="deduction-panel-body">
          <div class="deduction-label">💬 추리</div>
          <div class="comment-list" id="cl-${escHtml(evt.id)}">
            <div class="tab-empty">불러오는 중...</div>
          </div>
          <div class="comment-form">
            <div class="comment-form-top">
              <input class="comment-nickname-input" placeholder="닉네임"
                     value="${escHtml(savedNickname)}" maxlength="20">
            </div>
            <textarea class="comment-text-input"
                      placeholder="추리한 내용, 단서, 가설 등을 적어보세요."></textarea>
            <div class="comment-form-bottom">
              <span class="comment-error">닉네임과 내용을 모두 입력해주세요.</span>
              <button class="btn-comment-submit">추리 추가</button>
            </div>
          </div>
        </div>
      </div>
    `;

    item.appendChild(card);
    if (hasHandout) item.appendChild(panel);
    timelineEl.appendChild(item);

    // 버튼 바인딩
    if (hasHandout) {
      card.querySelector('.btn-open-handout').addEventListener('click', e => {
        e.stopPropagation();
        openHandout(evt.handout_id);
      });
      const toggleBtn = card.querySelector('.btn-toggle-deduction');
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
          panel.classList.remove('open');
          toggleBtn.classList.remove('active');
        } else {
          panel.classList.add('open');
          toggleBtn.classList.add('active');
          loadDeductions(evt.handout_id, panel, evt.id);
        }
      });
      bindCommentForm(panel, evt.handout_id);
    }

    // 드래그 & 드롭
    card.addEventListener('dragstart', onDragStart.bind(item));
    card.addEventListener('dragover',  onDragOver.bind(item));
    card.addEventListener('dragleave', onDragLeave.bind(item));
    card.addEventListener('drop',      onDrop.bind(item));
    card.addEventListener('dragend',   onDragEnd);
  });
}

// ── 추리 댓글 로드 ───────────────────────────────
async function loadDeductions(handoutId, panel, eventId) {
  const listId = `cl-${eventId}`;
  const listEl = panel.querySelector(`#${listId}`) || panel.querySelector('.comment-list');
  if (handoutCache[handoutId]) {
    renderCommentList(listEl, handoutCache[handoutId].player_deductions || [], handoutId);
    return;
  }
  try {
    const data = await fetch(`/api/handouts/${handoutId}`).then(r => r.json());
    handoutCache[handoutId] = data;
    renderCommentList(listEl, data.player_deductions || [], handoutId);
  } catch {
    listEl.innerHTML = '<div class="tab-empty">불러오기 실패</div>';
  }
}

function renderCommentList(listEl, deductions, handoutId) {
  if (!deductions.length) {
    listEl.innerHTML = '<div class="tab-empty">아직 작성된 추리가 없습니다.</div>';
    return;
  }
  listEl.innerHTML = deductions.map(c => `
    <div class="comment-item" data-cid="${escHtml(c.id)}">
      <button class="comment-delete" title="삭제">✕</button>
      <div class="comment-header">
        <span class="comment-nickname">${escHtml(c.nickname)}</span>
        <span class="comment-time">${formatTime(c.timestamp)}</span>
      </div>
      <div class="comment-text">${escHtml(c.text)}</div>
    </div>`).join('');
  listEl.querySelectorAll('.comment-item').forEach(el => bindCommentDelete(el, listEl, handoutId));
}

function bindCommentDelete(el, listEl, handoutId) {
  el.querySelector('.comment-delete').addEventListener('click', async () => {
    await fetch(`/api/handouts/${handoutId}/deductions/${el.dataset.cid}`, { method: 'DELETE' });
    if (handoutCache[handoutId])
      handoutCache[handoutId].player_deductions =
        handoutCache[handoutId].player_deductions.filter(c => c.id !== el.dataset.cid);
    el.remove();
    if (!listEl.querySelector('.comment-item'))
      listEl.innerHTML = '<div class="tab-empty">아직 작성된 추리가 없습니다.</div>';
  });
}

function bindCommentForm(panel, handoutId) {
  const nicknameInput = panel.querySelector('.comment-nickname-input');
  const textInput     = panel.querySelector('.comment-text-input');
  const errEl         = panel.querySelector('.comment-error');
  const submitBtn     = panel.querySelector('.btn-comment-submit');
  const listEl        = panel.querySelector('.comment-list');

  submitBtn.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim();
    const text     = textInput.value.trim();
    if (!nickname || !text) { errEl.classList.add('visible'); return; }
    errEl.classList.remove('visible');
    savedNickname = nickname;
    document.querySelectorAll('.comment-nickname-input').forEach(el => el.value = nickname);

    const comment = await fetch(`/api/handouts/${handoutId}/deductions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, text }),
    }).then(r => r.json());
    textInput.value = '';

    if (handoutCache[handoutId]) {
      if (!handoutCache[handoutId].player_deductions) handoutCache[handoutId].player_deductions = [];
      handoutCache[handoutId].player_deductions.push(comment);
    }

    const emptyEl = listEl.querySelector('.tab-empty');
    if (emptyEl) emptyEl.remove();
    const el = document.createElement('div');
    el.className = 'comment-item';
    el.dataset.cid = comment.id;
    el.innerHTML = `
      <button class="comment-delete" title="삭제">✕</button>
      <div class="comment-header">
        <span class="comment-nickname">${escHtml(comment.nickname)}</span>
        <span class="comment-time">${formatTime(comment.timestamp)}</span>
      </div>
      <div class="comment-text">${escHtml(comment.text)}</div>`;
    listEl.appendChild(el);
    bindCommentDelete(el, listEl, handoutId);
  });
}

// ── 드래그 & 드롭 ────────────────────────────────
function onDragStart(e) {
  dragSrcId = this.dataset.id;
  this.querySelector('.event-card').classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
  e.preventDefault();
  if (this.dataset.id !== dragSrcId) this.querySelector('.event-card').classList.add('drag-over');
}
function onDragLeave() { this.querySelector('.event-card').classList.remove('drag-over'); }
function onDrop(e) {
  e.preventDefault();
  this.querySelector('.event-card').classList.remove('drag-over');
  const targetId = this.dataset.id;
  if (!dragSrcId || dragSrcId === targetId) return;
  const si = allEvents.findIndex(ev => ev.id === dragSrcId);
  const ti = allEvents.findIndex(ev => ev.id === targetId);
  allEvents.splice(ti, 0, allEvents.splice(si, 1)[0]);
  renderTimeline();
  fetch('/api/events/reorder', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: allEvents.map(e => e.id) }),
  });
}
function onDragEnd() {
  document.querySelectorAll('.event-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
}

// ── 핸드아웃 보기 (모달) ─────────────────────────
async function openHandout(id) {
  showModal('<div class="loading">불러오는 중...</div>');
  try {
    let h = handoutCache[id];
    if (!h) { h = await fetch(`/api/handouts/${id}`).then(r => r.json()); handoutCache[id] = h; }
    renderHandout(h);
  } catch {
    modalContent.innerHTML = '<div class="error">핸드아웃을 불러오지 못했습니다.</div>';
  }
}

// ── 핸드아웃 생성 (모달) ─────────────────────────
function openCreateHandout() {
  const eventId = null;
  showModal(`
    <div class="modal-header-bar">
      <span class="modal-header-title">새 핸드아웃 추가</span>
    </div>
    <div class="tab-panel active" style="display:block">
      <div class="edit-form" id="createForm">
        <div class="edit-form-row">
          <label>제목 <span class="required">*</span></label>
          <input type="text" id="cTitle" placeholder="핸드아웃 제목">
        </div>
        <div class="edit-form-row">
          <label>내용</label>
          <textarea id="cContent" placeholder="핸드아웃 내용"></textarea>
        </div>
        <div class="edit-form-row">
          <label>NPC</label>
          <input type="text" id="cNpc" placeholder="이름, 설명 등">
        </div>
        <div class="edit-form-row">
          <label>아이템</label>
          <input type="text" id="cItem" placeholder="이름, 설명 등">
        </div>
        <div class="edit-form-row">
          <label>획득 날짜</label>
          <input type="text" id="cAcqDate" placeholder="예) 1일차 오후 2시">
        </div>
        <div class="edit-form-row">
          <label>획득 위치</label>
          <input type="text" id="cAcqLoc" placeholder="예) 그레이폴 여관">
        </div>
        <div class="save-row">
          <button class="btn-save" id="btnCreate">생성</button>
          <button class="btn-cancel" id="btnCreateCancel">취소</button>
          <span class="save-status" id="createError" style="color:#c06060"></span>
        </div>
      </div>
    </div>
  `);

  document.getElementById('btnCreateCancel').addEventListener('click', closeModal);
  document.getElementById('btnCreate').addEventListener('click', async () => {
    const title = document.getElementById('cTitle').value.trim();
    if (!title) {
      const err = document.getElementById('createError');
      err.textContent = '제목을 입력해주세요.';
      err.classList.add('visible');
      return;
    }
    const newH = await fetch('/api/handouts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content:          document.getElementById('cContent').value,
        npc:              document.getElementById('cNpc').value,
        item:             document.getElementById('cItem').value,
        acquired_date:    document.getElementById('cAcqDate').value,
        acquired_location:document.getElementById('cAcqLoc').value,
        event_id: eventId,
      }),
    }).then(r => r.json());

    handoutCache[newH.id] = newH;
    closeModal();

    // 그리드에 블록 추가
    const grid = document.getElementById('handoutGrid');
    const emptyEl = grid.querySelector('.handout-grid-empty');
    if (emptyEl) emptyEl.remove();
    grid.appendChild(buildHandoutBlock(newH));
  });
}

// ── 핸드아웃 렌더 ────────────────────────────────
function renderHandout(h) {
  const metaRow = [
    h.npc  ? `<span><strong>NPC</strong> ${escHtml(h.npc)}</span>`   : '',
    h.item ? `<span><strong>아이템</strong> ${escHtml(h.item)}</span>` : '',
  ].filter(Boolean).join('');
  const acqRow = [
    h.acquired_date     ? `<span><strong>획득 날짜</strong> ${escHtml(h.acquired_date)}</span>`     : '',
    h.acquired_location ? `<span><strong>획득 위치</strong> ${escHtml(h.acquired_location)}</span>` : '',
  ].filter(Boolean).join('');

  showModal(`
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="original">원문</button>
      <button class="tab-btn" data-tab="summary">요약</button>
    </div>

    <!-- 원문 탭 -->
    <div class="tab-panel active" data-panel="original">
      <!-- 보기 모드 -->
      <div id="viewMode">
        <div class="original-view-header">
          <div class="handout-title" id="viewTitle">${escHtml(h.title)}</div>
          <div class="view-header-btns">
            <button class="btn-edit-toggle" id="btnEditToggle">✏ 수정</button>
            <button class="btn-delete" id="btnDelete">🗑</button>
          </div>
        </div>
        <div class="handout-body" id="viewContent">${escHtml(h.content)}</div>
        ${metaRow  ? `<div class="handout-meta-row" id="viewMeta">${metaRow}</div>`   : '<div id="viewMeta"></div>'}
        ${acqRow   ? `<div class="handout-acq-row" id="viewAcq">${acqRow}</div>`      : '<div id="viewAcq"></div>'}
      </div>

      <!-- 수정 모드 (기본 숨김) -->
      <div id="editMode" hidden>
        <div class="edit-form">
          <div class="edit-form-row"><label>제목</label>
            <input type="text" id="eTitle" value="${escHtml(h.title)}"></div>
          <div class="edit-form-row"><label>내용</label>
            <textarea id="eContent">${escHtml(h.content)}</textarea></div>
          <div class="edit-form-row"><label>NPC</label>
            <input type="text" id="eNpc" value="${escHtml(h.npc || '')}" placeholder="이름, 설명 등"></div>
          <div class="edit-form-row"><label>아이템</label>
            <input type="text" id="eItem" value="${escHtml(h.item || '')}" placeholder="이름, 설명 등"></div>
          <div class="edit-form-row"><label>획득 날짜</label>
            <input type="text" id="eAcqDate" value="${escHtml(h.acquired_date || '')}" placeholder="예) 1일차 오후 2시"></div>
          <div class="edit-form-row"><label>획득 위치</label>
            <input type="text" id="eAcqLoc" value="${escHtml(h.acquired_location || '')}" placeholder="예) 그레이폴 여관"></div>
          <div class="save-row">
            <button class="btn-save" id="btnSaveAll">저장</button>
            <button class="btn-cancel" id="btnCancelEdit">취소</button>
            <span class="save-status" id="statusAll">저장되었습니다.</span>
          </div>
        </div>
      </div>

      <!-- 삭제 확인 -->
      <div id="deleteConfirm" hidden>
        <div class="delete-confirm-box">
          <span>핸드아웃을 삭제할까요? 복구할 수 없습니다.</span>
          <button class="btn-delete-confirm" id="btnDeleteConfirm">삭제</button>
          <button class="btn-cancel" id="btnDeleteCancel">취소</button>
        </div>
      </div>
    </div>

    <!-- 요약 탭 -->
    <div class="tab-panel" data-panel="summary">
      <div class="edit-form">
        <div class="edit-form-row">
          <label>핸드아웃 요약</label>
          <textarea id="fSummary" placeholder="이 핸드아웃의 내용을 요약해 적어보세요.">${escHtml(h.player_summary || '')}</textarea>
        </div>
        <div class="save-row">
          <button class="btn-save" id="btnSaveSummary">저장</button>
          <span class="save-status" id="statusSummary">저장되었습니다.</span>
        </div>
      </div>
    </div>
  `);

  // 탭 전환
  modalContent.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalContent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      modalContent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      modalContent.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
  });

  // 수정 모드 토글
  document.getElementById('btnEditToggle').addEventListener('click', () => {
    document.getElementById('viewMode').hidden = true;
    document.getElementById('editMode').hidden = false;
  });
  document.getElementById('btnCancelEdit').addEventListener('click', () => {
    document.getElementById('editMode').hidden = true;
    document.getElementById('viewMode').hidden = false;
  });

  // 저장 (모든 필드 한 번에)
  document.getElementById('btnSaveAll').addEventListener('click', async () => {
    const updated = {
      title:             document.getElementById('eTitle').value,
      content:           document.getElementById('eContent').value,
      npc:               document.getElementById('eNpc').value,
      item:              document.getElementById('eItem').value,
      acquired_date:     document.getElementById('eAcqDate').value,
      acquired_location: document.getElementById('eAcqLoc').value,
    };
    await patchHandout(h.id, updated);
    Object.assign(h, updated);
    if (handoutCache[h.id]) Object.assign(handoutCache[h.id], updated);

    // 보기 모드 갱신
    document.getElementById('viewTitle').textContent = updated.title;
    document.getElementById('viewContent').textContent = updated.content;
    document.getElementById('viewMeta').innerHTML = [
      updated.npc  ? `<span><strong>NPC</strong> ${escHtml(updated.npc)}</span>`   : '',
      updated.item ? `<span><strong>아이템</strong> ${escHtml(updated.item)}</span>` : '',
    ].filter(Boolean).join('');
    document.getElementById('viewAcq').innerHTML = [
      updated.acquired_date     ? `<span><strong>획득 날짜</strong> ${escHtml(updated.acquired_date)}</span>`     : '',
      updated.acquired_location ? `<span><strong>획득 위치</strong> ${escHtml(updated.acquired_location)}</span>` : '',
    ].filter(Boolean).join('');

    // 타임라인 카드 제목 갱신
    const evt = allEvents.find(e => e.handout_id === h.id);
    if (evt) {
      const el = document.querySelector(`[data-id="${evt.id}"] .event-title`);
      if (el) el.textContent = updated.title;
    }

    showStatus('statusAll');
    document.getElementById('editMode').hidden = true;
    document.getElementById('viewMode').hidden = false;
  });

  // 삭제 버튼 → 확인창
  document.getElementById('btnDelete').addEventListener('click', () => {
    document.getElementById('deleteConfirm').hidden = false;
    document.getElementById('btnDelete').hidden = true;
    document.getElementById('btnEditToggle').hidden = true;
  });
  document.getElementById('btnDeleteCancel').addEventListener('click', () => {
    document.getElementById('deleteConfirm').hidden = true;
    document.getElementById('btnDelete').hidden = false;
    document.getElementById('btnEditToggle').hidden = false;
  });
  document.getElementById('btnDeleteConfirm').addEventListener('click', async () => {
    await fetch(`/api/handouts/${h.id}`, { method: 'DELETE' });
    delete handoutCache[h.id];
    const evt = allEvents.find(e => e.handout_id === h.id);
    if (evt) evt.handout_id = null;
    closeModal();
    renderTimeline();
  });

  // 요약 저장
  document.getElementById('btnSaveSummary').addEventListener('click', async () => {
    await patchHandout(h.id, { player_summary: document.getElementById('fSummary').value });
    if (handoutCache[h.id]) handoutCache[h.id].player_summary = document.getElementById('fSummary').value;
    showStatus('statusSummary');
  });
}

// ── 공통 유틸 ────────────────────────────────────
function showModal(html) {
  modalContent.innerHTML = html;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() { overlay.hidden = true; document.body.style.overflow = ''; }
modalClose.addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function patchHandout(id, data) {
  await fetch(`/api/handouts/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
function showStatus(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

document.getElementById('btnNewHandout').addEventListener('click', openCreateHandout);

loadTimeline();
loadHandoutSection();
