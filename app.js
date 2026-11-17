(function () {
  const { boardFromStones, tryPlay, replay, other } = GoEngine;
  const { renderBoard, computeViewport, coordName } = GoBoard;

  const STORE_KEY = 'golife.problems.v1';
  const UI_KEY = 'golife.ui.v1';
  const GRADES = {
    correct: { label: '정답', ic: '○' },
    wrong: { label: '오답', ic: '✕' },
    unsure: { label: '보류', ic: '△' },
  };
  const ERR = {
    occupied: '이미 돌이 있는 자리예요',
    suicide: '착수 금지: 자충수예요',
    ko: '패: 바로 되따낼 수 없어요',
  };
  const COLOR = { B: '흑', W: '백' };

  // ---------- storage ----------
  // 서버(node server.js)로 열면 레포의 data/problems/<id>.json 에 저장,
  // index.html 을 파일로 바로 열면 브라우저 localStorage 에 저장.
  let mode = 'local';
  const snap = new Map(); // 서버에 마지막으로 저장된 내용 (id -> JSON 문자열)
  let queue = Promise.resolve();

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  }
  async function load() {
    if (location.protocol.startsWith('http')) {
      try {
        const r = await fetch('api/problems', { cache: 'no-store' });
        if (r.ok) {
          const arr = await r.json();
          mode = 'server';
          arr.forEach((p) => snap.set(p.id, JSON.stringify(p)));
          return arr;
        }
      } catch {}
    }
    mode = 'local';
    return loadLocal();
  }
  function request(method, id, body) {
    queue = queue.then(async () => {
      const r = await fetch('api/problems/' + encodeURIComponent(id), {
        method, headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    }).catch((e) => {
      if (method === 'PUT') snap.delete(id); // 다음 저장 때 다시 시도
      toast('파일 저장 실패: ' + e.message + ' (서버가 켜져 있는지 확인하세요)');
    });
  }
  // 바뀐 문제만 파일로 저장하고, 지워진 문제는 파일도 삭제
  function save() {
    if (mode === 'local') {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(problems)); }
      catch (e) { toast('저장 실패: ' + e.message); }
      return;
    }
    const ids = new Set();
    for (const p of problems) {
      ids.add(p.id);
      const j = JSON.stringify(p);
      if (snap.get(p.id) !== j) { snap.set(p.id, j); request('PUT', p.id, j); }
    }
    for (const id of [...snap.keys()]) if (!ids.has(id)) { snap.delete(id); request('DELETE', id); }
  }
  function loadUI() {
    try { return Object.assign({ fullBoard: false, filter: 'all' }, JSON.parse(localStorage.getItem(UI_KEY))); }
    catch { return { fullBoard: false, filter: 'all' }; }
  }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {} }

  let problems = [];
  const ui = loadUI();

  // ---------- helpers ----------
  const $app = document.getElementById('app');
  const $ = (sel) => $app.querySelector(sel);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; };
  const fmtDateTime = (t) => { const d = new Date(t); return `${fmtDate(t)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const stoneIcon = (c) => `<span class="stone ${c}"></span>`;
  const gradeBadge = (g) => g && GRADES[g]
    ? `<span class="badge ${g}">${GRADES[g].ic} ${GRADES[g].label}</span>`
    : `<span class="badge none">미채점</span>`;
  const lastAttempt = (p) => (p.attempts && p.attempts.length ? p.attempts[p.attempts.length - 1] : null);
  const stoneIdxs = (p) => p.stones.map((s) => s.y * p.size + s.x);
  const moveIdxs = (p, moves) => moves.filter((m) => !m.pass).map((m) => m.y * p.size + m.x);
  const moveName = (p, m) => (m.pass ? '패스' : coordName(p.size, m.x, m.y));

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  let keyHandler = null;
  document.addEventListener('keydown', (e) => {
    if (!keyHandler) return;
    if (e.target.closest('input, textarea, select')) return;
    keyHandler(e);
  });

  function moveChips(p, moves, cur) {
    return moves.map((m, k) => {
      const cls = cur == null ? '' : k + 1 === cur ? ' cur' : k + 1 > cur ? ' future' : '';
      return `<span class="mv${cls}" data-k="${k + 1}"><b>${k + 1}</b>${stoneIcon(m.c)}${moveName(p, m)}</span>`;
    }).join('');
  }

  const zoomSeg = () => `<div class="seg sm" id="zoom">
      <button data-v="0" class="${ui.fullBoard ? '' : 'on'}">부분 확대</button>
      <button data-v="1" class="${ui.fullBoard ? 'on' : ''}">전체 판</button></div>`;
  function bindZoom(draw) {
    $app.querySelectorAll('#zoom button').forEach((b) => b.onclick = () => {
      ui.fullBoard = b.dataset.v === '1';
      saveUI();
      $app.querySelectorAll('#zoom button').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    });
  }

  // ---------- router ----------
  function route() {
    keyHandler = null;
    window.scrollTo(0, 0);
    const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
    if (parts[0] === 'new') return viewEdit(null);
    if (parts[0] === 'p') {
      const p = problems.find((x) => x.id === parts[1]);
      if (!p) { location.replace('#/'); return; }
      if (parts[2] === 'edit') return viewEdit(p);
      if (parts[2] === 'solve') return viewSolve(p);
      if (parts[2] === 'answer') return viewDetail(p, parts[3] || 'latest');
      return viewDetail(p, null);
    }
    viewList();
  }
  window.addEventListener('hashchange', route);

  // ---------- 목록 ----------
  function viewList() {
    const filters = [['all', '전체'], ['todo', '안 푼 문제'], ['correct', '정답'], ['wrong', '오답'], ['unsure', '보류'], ['ungraded', '미채점']];
    const match = (p) => {
      const a = lastAttempt(p);
      switch (ui.filter) {
        case 'todo': return !a;
        case 'ungraded': return a && !a.grade;
        case 'correct': case 'wrong': case 'unsure': return a && a.grade === ui.filter;
        default: return true;
      }
    };
    const list = [...problems].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).filter(match);

    $app.innerHTML = `
      <div class="toolbar">
        <a class="btn primary" href="#/new">+ 새 문제 입력</a>
        <input class="search" type="search" placeholder="제목·메모 검색" id="q">
        <span class="spacer"></span>
        <button class="btn" id="exp">내보내기</button>
        <button class="btn" id="imp">불러오기</button>
        ${migratable().length ? `<button class="btn primary" id="mig">브라우저 기록 ${migratable().length}개를 레포로 옮기기</button>` : ''}
      </div>
      <div class="chips">${filters.map(([k, l]) => `<button class="chip${ui.filter === k ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      ${problems.length === 0
        ? `<div class="empty"><div class="big">아직 저장된 사활 문제가 없어요</div>
             <p>‘새 문제 입력’으로 문제를 만들거나, 백업 파일(JSON)을 ‘불러오기’ 하세요.</p></div>`
        : list.length === 0 ? `<div class="empty">해당하는 문제가 없어요</div>`
        : `<div class="grid">${list.map((p) => {
            const a = lastAttempt(p), n = (p.attempts || []).length;
            return `<a class="card" href="#/p/${p.id}" data-text="${esc((p.title + ' ' + (p.memo || '')).toLowerCase())}">
              <div class="thumb" data-id="${p.id}"></div>
              <div class="body">
                <div class="title">${esc(p.title)}</div>
                <div class="sub">${stoneIcon(p.toPlay)} ${COLOR[p.toPlay]}선 · ${n ? `풀이 ${n}회 ${gradeBadge(a.grade)}` : '안 풀었음'}</div>
              </div></a>`;
          }).join('')}</div>`}
    `;

    $app.querySelectorAll('.thumb').forEach((el) => {
      const p = problems.find((x) => x.id === el.dataset.id);
      el.appendChild(renderBoard({ size: p.size, board: boardFromStones(p.size, p.stones), viewport: computeViewport(p.size, stoneIdxs(p)), mini: true }));
    });
    $app.querySelectorAll('.chip').forEach((b) => b.onclick = () => { ui.filter = b.dataset.f; saveUI(); viewList(); });
    $('#q').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      $app.querySelectorAll('.card').forEach((c) => { c.style.display = !q || c.dataset.text.includes(q) ? '' : 'none'; });
    };
    $('#exp').onclick = exportJSON;
    if ($('#mig')) $('#mig').onclick = migrate;
    $('#imp').onclick = () => document.getElementById('importFile').click();
  }

  // ---------- 문제 입력 / 수정 ----------
  function viewEdit(p) {
    let size = p ? p.size : 19;
    let board = p ? boardFromStones(p.size, p.stones) : new Array(size * size).fill(null);
    let tool = 'B';
    let toPlay = p ? p.toPlay : 'B';

    $app.innerHTML = `
      <div class="layout">
        <section class="board-col">
          <div class="board-head"><span class="label">배치 입력 · 전체 판</span></div>
          <div id="board"></div>
        </section>
        <aside class="panel">
          <div class="crumb"><a href="${p ? '#/p/' + p.id : '#/'}">← ${p ? '문제로' : '목록'}</a></div>
          <h1>${p ? '문제 수정' : '새 문제 입력'}</h1>
          <div class="field"><label>제목</label><input type="text" id="title" value="${esc(p ? p.title : '')}" placeholder="예: 기경중묘 12번"></div>
          <div class="field"><label>판 크기</label>
            <div class="seg" id="size">${[19, 13, 9].map((s) => `<button data-v="${s}" class="${s === size ? 'on' : ''}">${s}줄</button>`).join('')}</div></div>
          <div class="field"><label>돌 놓기 <span class="hint">(B / W / E 키, 우클릭·Shift+클릭은 반대색)</span></label>
            <div class="seg" id="tool">
              <button data-v="B" class="on">${stoneIcon('B')} 흑</button>
              <button data-v="W">${stoneIcon('W')} 백</button>
              <button data-v="E">지우개</button>
            </div></div>
          <div class="field"><label>먼저 두는 쪽</label>
            <div class="seg" id="toPlay">
              <button data-v="B">${stoneIcon('B')} 흑선</button>
              <button data-v="W">${stoneIcon('W')} 백선</button>
            </div></div>
          <div class="field"><label>메모 (목표, 출처 등)</label><textarea id="memo" placeholder="예: 흑선 활 / 백선 흑사">${esc(p ? p.memo : '')}</textarea></div>
          <div class="row">
            <button class="btn primary" id="saveSolve">저장하고 풀기</button>
            <button class="btn" id="save">저장</button>
            <span class="spacer" style="flex:1"></span>
            <button class="btn ghost" id="clear">판 비우기</button>
          </div>
        </aside>
      </div>`;

    const setSeg = (id, v) => $app.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    setSeg('toPlay', toPlay);

    function draw() {
      $('#board').replaceChildren(renderBoard({
        size, board,
        onClick: (i, { alt }) => {
          let c = tool;
          if (alt && c !== 'E') c = other(c);
          if (c === 'E') board[i] = null;
          else board[i] = board[i] === c ? null : c;
          draw();
        },
        ghostColor: () => tool,
      }));
    }
    draw();

    const setTool = (t) => { tool = t; setSeg('tool', t); };
    $app.querySelectorAll('#tool button').forEach((b) => b.onclick = () => setTool(b.dataset.v));
    $app.querySelectorAll('#toPlay button').forEach((b) => b.onclick = () => { toPlay = b.dataset.v; setSeg('toPlay', toPlay); });
    $app.querySelectorAll('#size button').forEach((b) => b.onclick = () => {
      const s = +b.dataset.v;
      if (s === size) return;
      if (board.some(Boolean) && !confirm('판 크기를 바꾸면 놓은 돌이 모두 지워져요. 계속할까요?')) return;
      size = s; board = new Array(size * size).fill(null); setSeg('size', s); draw();
    });
    $('#clear').onclick = () => { if (board.some(Boolean) && confirm('판을 비울까요?')) { board.fill(null); draw(); } };
    // 한글 입력 상태에서도 동작하도록 물리 키(e.code)와 한글 자모(ㅠ/ㅈ/ㄷ)를 함께 확인
    keyHandler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.code === 'KeyB' || k === 'b' || k === 'ㅠ') setTool('B');
      else if (e.code === 'KeyW' || k === 'w' || k === 'ㅈ') setTool('W');
      else if (e.code === 'KeyE' || k === 'e' || k === 'ㄷ') setTool('E');
    };

    function commit() {
      const stones = [];
      board.forEach((c, i) => { if (c) stones.push({ x: i % size, y: (i / size) | 0, c }); });
      if (!stones.length) { toast('돌을 하나 이상 놓아 주세요'); return null; }
      const title = $('#title').value.trim() || `사활 ${fmtDate(Date.now())} #${problems.length + 1}`;
      const memo = $('#memo').value.trim();
      const now = Date.now();
      if (p) {
        const changed = JSON.stringify(stones) !== JSON.stringify(p.stones) || size !== p.size;
        if (changed && (p.attempts || []).length && !confirm('이미 풀이 기록이 있어요. 배치를 바꾸면 이전 답의 재생이 어긋날 수 있어요. 저장할까요?')) return null;
        Object.assign(p, { title, memo, size, stones, toPlay, updatedAt: now });
        save();
        return p;
      }
      const np = { id: uid(), title, memo, size, stones, toPlay, attempts: [], createdAt: now, updatedAt: now };
      problems.push(np);
      save();
      return np;
    }
    $('#save').onclick = () => { const r = commit(); if (r) { toast('저장했어요'); location.hash = '#/p/' + r.id; } };
    $('#saveSolve').onclick = () => { const r = commit(); if (r) location.hash = '#/p/' + r.id + '/solve'; };
  }

  // ---------- 풀기 ----------
  function viewSolve(p) {
    const moves = [];
    let grading = false;
    let grade = null;
    let note = '';
    const first = p.toPlay || 'B';
    const nextColor = () => (moves.length % 2 === 0 ? first : other(first));

    $app.innerHTML = `
      <div class="layout">
        <section class="board-col">
          <div class="board-head">
            <div id="status" class="status"></div>
            ${zoomSeg()}
          </div>
          <div id="board"></div>
          <div class="controls" id="controls"></div>
        </section>
        <aside class="panel">
          <div class="crumb"><a href="#/p/${p.id}" id="quit">← 문제로 나가기</a></div>
          <h1>${esc(p.title)}</h1>
          <div class="meta">${stoneIcon(first)} ${COLOR[first]}선 · ${p.size}줄</div>
          ${p.memo ? `<p class="memo">${esc(p.memo)}</p>` : ''}
          <div id="side"></div>
        </aside>
      </div>`;

    function viewport() {
      if (ui.fullBoard) return null;
      const vp = computeViewport(p.size, stoneIdxs(p));
      const out = moveIdxs(p, moves).some((i) => { const x = i % p.size, y = (i / p.size) | 0; return x < vp.x0 || x > vp.x1 || y < vp.y0 || y > vp.y1; });
      return out ? computeViewport(p.size, stoneIdxs(p).concat(moveIdxs(p, moves))) : vp;
    }

    function play(i) {
      const r = replay(p.size, p.stones, moves);
      const ko = r.boards.length >= 2 ? r.boards[r.boards.length - 2] : null;
      const c = nextColor();
      const res = tryPlay(r.board, p.size, i, c, ko);
      if (res.error) { toast(ERR[res.error]); return; }
      moves.push({ x: i % p.size, y: (i / p.size) | 0, c });
      draw();
    }
    const stepBack = () => { if (moves.length) { moves.pop(); draw(); } };

    function draw() {
      const r = replay(p.size, p.stones, moves);
      const nc = nextColor();
      $('#board').replaceChildren(renderBoard({
        size: p.size, board: r.board, labels: r.labels, lastIdx: r.lastIdx, viewport: viewport(),
        onClick: grading ? null : play, ghostColor: grading ? null : nextColor,
      }));

      $('#status').innerHTML = grading
        ? `<span class="turn-pill">채점 중 <span class="count">${moves.length}수 풀이</span></span>`
        : `<button class="icon-btn" id="stepBack" title="한 수 뒤로 (←)" aria-label="한 수 뒤로" ${moves.length ? '' : 'disabled'}>←</button>
           <span class="turn-pill">${stoneIcon(nc)} ${COLOR[nc]} 차례 <span class="count">${moves.length + 1}수째</span></span>`;

      $('#controls').innerHTML = grading
        ? `<button class="btn" id="back">← 계속 두기</button>`
        : `<span class="spacer"></span>
           <button class="btn primary" id="done" ${moves.length ? '' : 'disabled'}>풀이 완료 · 채점 →</button>`;

      const kifu = `
        <div class="field"><label>수순 ${moves.length ? `(${moves.length}수)` : ''}</label>
          <div class="kifu">${moveChips(p, moves, moves.length) || '<div class="empty-k">바둑판을 눌러 첫 수를 두세요</div>'}</div>
          ${r.overwritten.length ? `<div class="notes">${r.overwritten.map((o) => `${o.num} = ${o.at}의 자리`).join(', ')}</div>` : ''}
        </div>`;
      $('#side').innerHTML = grading ? `
          <div class="grading">
            <div style="font-weight:700">직접 채점해 주세요</div>
            <div class="grades">${Object.entries(GRADES).map(([k, g]) => `<button class="${k}${grade === k ? ' on' : ''}" data-g="${k}"><span class="ic">${g.ic}</span>${g.label}</button>`).join('')}</div>
            <div class="field"><label>메모</label><textarea id="note" placeholder="예: 2의 젖힘이 급소였음">${esc(note)}</textarea></div>
            <button class="btn primary block" id="saveAtt">풀이 저장</button>
          </div>${kifu}`
        : kifu;

      if (grading) {
        $('#back').onclick = () => { note = $('#note').value; grading = false; draw(); };
        $app.querySelectorAll('.grades button').forEach((b) => b.onclick = () => {
          grade = b.dataset.g;
          $app.querySelectorAll('.grades button').forEach((x) => x.classList.toggle('on', x === b));
        });
        $('#saveAtt').onclick = () => {
          const a = { id: uid(), moves: moves.slice(), grade, note: $('#note').value.trim(), createdAt: Date.now() };
          (p.attempts = p.attempts || []).push(a);
          p.updatedAt = Date.now();
          save();
          toast('풀이를 저장했어요');
          location.hash = `#/p/${p.id}/answer/${a.id}`;
        };
      } else {
        $('#stepBack').onclick = stepBack;
        $('#done').onclick = () => { grading = true; draw(); };
      }
    }
    draw();
    bindZoom(draw);
    $('#quit').onclick = (e) => { if (moves.length && !confirm('저장하지 않은 풀이가 사라져요. 나갈까요?')) e.preventDefault(); };
    keyHandler = (e) => { if (!grading && e.key === 'ArrowLeft') stepBack(); };

  }

  // ---------- 문제 보기 / 이전 답 보기 ----------
  function viewDetail(p, attemptParam) {
    const attempts = p.attempts || [];
    let attempt = null;
    if (attemptParam) {
      attempt = attemptParam === 'latest' ? attempts[attempts.length - 1] : attempts.find((a) => a.id === attemptParam);
      if (!attempt) { location.replace('#/p/' + p.id); return; }
    }
    let step = attempt ? attempt.moves.length : 0;

    $app.innerHTML = `
      <div class="layout">
        <section class="board-col">
          <div class="board-head"><span class="label">${attempt ? `#${attempts.indexOf(attempt) + 1} 풀이 보기` : '문제'}</span>${zoomSeg()}</div>
          <div id="board"></div>${attempt ? `
          <div class="stepper">
            <button class="btn" id="s0">⏮</button>
            <button class="btn" id="sPrev">◀</button>
            <span class="pos" id="pos"></span>
            <button class="btn" id="sNext">▶</button>
            <button class="btn" id="sEnd">⏭</button>
          </div>` : ''}</section>
        <aside class="panel">
          <div class="crumb"><a href="#/">← 목록</a></div>
          <h1>${esc(p.title)}</h1>
          <div class="meta">${stoneIcon(p.toPlay)} ${COLOR[p.toPlay]}선 · ${p.size}줄 · ${fmtDate(p.createdAt)} 입력</div>
          ${p.memo ? `<p class="memo">${esc(p.memo)}</p>` : ''}
          ${attempt ? answerPanel() : problemPanel()}
        </aside>
      </div>`;

    function problemPanel() {
      const la = lastAttempt(p);
      return `
        <a class="btn primary block" href="#/p/${p.id}/solve">${attempts.length ? '다시 풀기' : '풀기'}</a>
        ${attempts.length
          ? `<a class="btn block" href="#/p/${p.id}/answer/latest">이전에 입력한 답 보기 (${attempts.length}회) ${gradeBadge(la.grade)}</a>`
          : `<p class="hint" style="text-align:center">아직 풀이 기록이 없어요</p>`}
        <hr class="sep">
        <div class="row">
          <a class="btn" href="#/p/${p.id}/edit">문제 수정</a>
          <span style="flex:1"></span>
          <button class="btn danger" id="del">삭제</button>
        </div>`;
    }

    function answerPanel() {
      const idx = attempts.indexOf(attempt);
      return `
        <div class="row">
          <a class="btn" href="#/p/${p.id}">문제만 보기</a>
          <a class="btn primary" href="#/p/${p.id}/solve">다시 풀기</a>
        </div>
        <div class="field"><label>풀이 기록</label>
          <div class="attempts">${attempts.map((a, k) => `
            <a class="att${a === attempt ? ' on' : ''}" href="#/p/${p.id}/answer/${a.id}">
              <b>#${k + 1}</b><span class="when">${fmtDateTime(a.createdAt)} · ${a.moves.length}수</span>${gradeBadge(a.grade)}
            </a>`).reverse().join('')}</div></div>
        <hr class="sep">
        <div class="field"><label>#${idx + 1} 수순 <span class="hint">(←/→ 키로 넘기기)</span></label>
          <div class="kifu" id="mvlist"></div>
          <div class="notes" id="ow"></div></div>
        <div class="field"><label>채점</label>
          <div class="grades">${Object.entries(GRADES).map(([k, g]) => `<button class="${k}${attempt.grade === k ? ' on' : ''}" data-g="${k}"><span class="ic">${g.ic}</span>${g.label}</button>`).join('')}</div></div>
        <div class="field"><label>메모</label><textarea id="note" placeholder="풀이 메모">${esc(attempt.note)}</textarea></div>
        <div class="row"><span style="flex:1"></span><button class="btn danger" id="delAtt">이 풀이 삭제</button></div>`;
    }

    function draw() {
      let board, labels, lastIdx = -1;
      if (attempt) {
        const r = replay(p.size, p.stones, attempt.moves, step);
        board = r.board; labels = r.labels; lastIdx = r.lastIdx;
        $('#pos').textContent = `${step} / ${attempt.moves.length}`;
        $('#mvlist').innerHTML = moveChips(p, attempt.moves, step);
        $app.querySelectorAll('#mvlist .mv').forEach((el) => el.onclick = () => { step = +el.dataset.k; draw(); });
        $('#ow').textContent = r.overwritten.map((o) => `${o.num} = ${o.at}의 자리`).join(', ');
      } else {
        board = boardFromStones(p.size, p.stones);
      }
      const vp = ui.fullBoard ? null : computeViewport(p.size, stoneIdxs(p).concat(attempt ? moveIdxs(p, attempt.moves) : []));
      $('#board').replaceChildren(renderBoard({ size: p.size, board, labels, lastIdx, viewport: vp }));
    }
    draw();

    bindZoom(draw);

    if (!attempt) {
      $('#del').onclick = () => {
        if (!confirm(`'${p.title}' 문제와 풀이 기록을 모두 삭제할까요?`)) return;
        problems = problems.filter((x) => x !== p);
        save();
        location.hash = '#/';
      };
      return;
    }

    const go = (s) => { step = Math.max(0, Math.min(attempt.moves.length, s)); draw(); };
    $('#s0').onclick = () => go(0);
    $('#sPrev').onclick = () => go(step - 1);
    $('#sNext').onclick = () => go(step + 1);
    $('#sEnd').onclick = () => go(attempt.moves.length);
    keyHandler = (e) => {
      if (e.key === 'ArrowLeft') go(step - 1);
      else if (e.key === 'ArrowRight') go(step + 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(attempt.moves.length);
    };
    $app.querySelectorAll('.grades button').forEach((b) => b.onclick = () => {
      attempt.grade = attempt.grade === b.dataset.g ? null : b.dataset.g;
      p.updatedAt = Date.now();
      save();
      viewDetail(p, attempt.id);
    });
    $('#note').onchange = (e) => { attempt.note = e.target.value.trim(); save(); toast('메모를 저장했어요'); };
    $('#delAtt').onclick = () => {
      if (!confirm('이 풀이 기록을 삭제할까요?')) return;
      p.attempts = attempts.filter((a) => a !== attempt);
      save();
      location.hash = p.attempts.length ? `#/p/${p.id}/answer/latest` : `#/p/${p.id}`;
    };
  }

  // ---------- 브라우저(localStorage) 기록 → 레포 파일로 옮기기 ----------
  function migratable() {
    if (mode !== 'server') return [];
    const have = new Set(problems.map((p) => p.id));
    return loadLocal().filter((p) => p && p.id && !have.has(p.id));
  }
  async function migrate() {
    const items = migratable();
    if (!items.length || !confirm(`브라우저에 저장된 문제 ${items.length}개를 레포의 data/problems/ 로 옮길까요?`)) return;
    problems.push(...items);
    save();
    await queue;
    if (items.every((p) => snap.has(p.id))) {
      localStorage.removeItem(STORE_KEY);
      toast(`${items.length}개를 레포로 옮겼어요`);
    }
    route();
  }

  // ---------- 백업 내보내기 / 불러오기 ----------
  function exportJSON() {
    const data = JSON.stringify({ app: 'saha-note', version: 1, exportedAt: Date.now(), problems }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const d = new Date();
    a.download = `saha-note-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.problems;
      if (!Array.isArray(arr)) throw new Error('형식이 올바르지 않아요');
      let added = 0, updated = 0;
      for (const imp of arr) {
        if (!imp || !imp.id || !imp.size || !Array.isArray(imp.stones)) continue;
        imp.attempts = imp.attempts || [];
        const i = problems.findIndex((x) => x.id === imp.id);
        if (i < 0) { problems.push(imp); added++; }
        else if ((imp.updatedAt || 0) > (problems[i].updatedAt || 0)) { problems[i] = imp; updated++; }
      }
      save();
      route();
      toast(`${added}개 추가, ${updated}개 갱신`);
    } catch (err) {
      toast('불러오기 실패: ' + err.message);
    }
  });

  load().then((arr) => {
    problems = arr;
    const tag = document.getElementById('storeMode');
    tag.textContent = mode === 'server' ? '레포에 저장 · data/problems' : '브라우저에 저장';
    tag.title = mode === 'server' ? '기록이 레포의 data/problems/ 폴더에 파일로 저장돼요' : 'npm start 로 서버를 켜고 열면 레포 안에 파일로 저장돼요';
    tag.classList.add(mode);
    route();
  });
})();
