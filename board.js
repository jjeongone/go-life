// SVG 바둑판 렌더러
(function (g) {
  const LETTERS = 'ABCDEFGHJKLMNOPQRST';

  function hoshi(n) {
    const grid = (a) => a.flatMap((x) => a.map((y) => [x, y]));
    if (n === 19) return grid([3, 9, 15]);
    if (n === 13) return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
    if (n === 9) return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
    return [];
  }

  function full(n) { return { x0: 0, y0: 0, x1: n - 1, y1: n - 1 }; }

  // 돌이 있는 영역만 확대해서 보여주기 위한 범위 계산
  function computeViewport(n, idxs, margin = 2) {
    if (n <= 9 || !idxs.length) return full(n);
    let x0 = n, y0 = n, x1 = -1, y1 = -1;
    for (const i of idxs) {
      const x = i % n, y = (i / n) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
    const snap = 2;
    if (x0 <= snap) x0 = 0;
    if (y0 <= snap) y0 = 0;
    if (x1 >= n - 1 - snap) x1 = n - 1;
    if (y1 >= n - 1 - snap) y1 = n - 1;
    const minSpan = 6;
    while (x1 - x0 < minSpan && !(x0 === 0 && x1 === n - 1)) { if (x0 > 0) x0--; if (x1 - x0 < minSpan && x1 < n - 1) x1++; }
    while (y1 - y0 < minSpan && !(y0 === 0 && y1 === n - 1)) { if (y0 > 0) y0--; if (y1 - y0 < minSpan && y1 < n - 1) y1++; }
    // 판 표시 크기를 고정하기 위해 항상 정사각형 영역으로 맞춤 (판 안쪽으로 확장)
    while (x1 - x0 < y1 - y0) { if (x1 < n - 1) x1++; else x0--; }
    while (y1 - y0 < x1 - x0) { if (y1 < n - 1) y1++; else y0--; }
    return { x0, y0, x1, y1 };
  }

  function coordName(n, x, y) { return LETTERS[x] + (n - y); }

  function renderBoard(o) {
    const n = o.size, b = o.board, vp = o.viewport || full(n);
    const labels = o.labels || new Map();
    const coords = o.coords !== false && !o.mini;
    const CS = 40, pad = coords ? 24 : 6, m = CS * 0.6;
    const ox = pad + m, oy = pad + m;
    const W = ox + (vp.x1 - vp.x0) * CS + m + 6;
    const H = oy + (vp.y1 - vp.y0) * CS + m + 6;
    const X = (x) => ox + (x - vp.x0) * CS, Y = (y) => oy + (y - vp.y0) * CS;
    const inVp = (x, y) => x >= vp.x0 && x <= vp.x1 && y >= vp.y0 && y <= vp.y1;

    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" rx="6" class="wood"/>`;
    for (let x = vp.x0; x <= vp.x1; x++) {
      const t = Y(vp.y0) - (vp.y0 > 0 ? m : 0), btm = Y(vp.y1) + (vp.y1 < n - 1 ? m : 0);
      const edge = x === 0 || x === n - 1;
      s += `<line x1="${X(x)}" y1="${t}" x2="${X(x)}" y2="${btm}" class="ln" stroke-width="${edge ? 2 : 1}"/>`;
    }
    for (let y = vp.y0; y <= vp.y1; y++) {
      const l = X(vp.x0) - (vp.x0 > 0 ? m : 0), r = X(vp.x1) + (vp.x1 < n - 1 ? m : 0);
      const edge = y === 0 || y === n - 1;
      s += `<line x1="${l}" y1="${Y(y)}" x2="${r}" y2="${Y(y)}" class="ln" stroke-width="${edge ? 2 : 1}"/>`;
    }
    for (const [x, y] of hoshi(n)) if (inVp(x, y)) s += `<circle cx="${X(x)}" cy="${Y(y)}" r="3.6" class="hoshi"/>`;
    if (coords) {
      for (let x = vp.x0; x <= vp.x1; x++) s += `<text x="${X(x)}" y="${pad * 0.62}" class="coord">${LETTERS[x]}</text>`;
      for (let y = vp.y0; y <= vp.y1; y++) s += `<text x="${pad * 0.5}" y="${Y(y) + 4}" class="coord">${n - y}</text>`;
    }
    for (let y = vp.y0; y <= vp.y1; y++) for (let x = vp.x0; x <= vp.x1; x++) {
      const c = b[y * n + x];
      if (!c) continue;
      s += `<circle cx="${X(x)}" cy="${Y(y) + 1.5}" r="${CS * 0.48}" class="shadow"/>`;
      s += `<circle cx="${X(x)}" cy="${Y(y)}" r="${CS * 0.48}" fill="url(#g${c})" class="st st${c}"/>`;
    }
    for (const [i, num] of labels) {
      const x = i % n, y = (i / n) | 0, c = b[i];
      if (!c || !inVp(x, y)) continue;
      const fs = num >= 100 ? CS * 0.36 : CS * 0.46;
      const cls = 'lbl lbl' + c + (i === o.lastIdx ? ' last' : '');
      s += `<text x="${X(x)}" y="${Y(y) + fs * 0.36}" font-size="${fs}" class="${cls}">${num}</text>`;
    }
    if (o.lastIdx >= 0 && !labels.has(o.lastIdx) && b[o.lastIdx]) {
      const x = o.lastIdx % n, y = (o.lastIdx / n) | 0;
      if (inVp(x, y)) s += `<circle cx="${X(x)}" cy="${Y(y)}" r="${CS * 0.17}" class="lastmark"/>`;
    }
    s += `<circle class="ghost" r="${CS * 0.48}" visibility="hidden"/>`;
    s += '</svg>';

    const wrap = document.createElement('div');
    wrap.className = 'goban' + (o.mini ? ' mini' : '');
    wrap.innerHTML = s;
    const svg = wrap.firstChild;

    if (o.onClick) {
      svg.classList.add('clickable');
      const toIdx = (ev) => {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        const x = Math.round((p.x - ox) / CS) + vp.x0, y = Math.round((p.y - oy) / CS) + vp.y0;
        return inVp(x, y) ? y * n + x : -1;
      };
      svg.addEventListener('click', (ev) => { const i = toIdx(ev); if (i >= 0) o.onClick(i, { alt: ev.shiftKey }); });
      svg.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const i = toIdx(ev); if (i >= 0) o.onClick(i, { alt: true }); });
      if (o.ghostColor) {
        const gh = svg.querySelector('.ghost');
        svg.addEventListener('pointermove', (ev) => {
          if (ev.pointerType !== 'mouse') return;
          const i = toIdx(ev);
          const c = typeof o.ghostColor === 'function' ? o.ghostColor() : o.ghostColor;
          if (i < 0 || b[i] || (c !== 'B' && c !== 'W')) { gh.setAttribute('visibility', 'hidden'); return; }
          gh.setAttribute('cx', X(i % n)); gh.setAttribute('cy', Y((i / n) | 0));
          gh.setAttribute('fill', `url(#g${c})`);
          gh.setAttribute('visibility', 'visible');
        });
        svg.addEventListener('pointerleave', () => gh.setAttribute('visibility', 'hidden'));
      }
    }
    return wrap;
  }

  g.GoBoard = { renderBoard, computeViewport, coordName, LETTERS };
})(window);
