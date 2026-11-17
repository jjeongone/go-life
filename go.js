// 바둑 규칙 엔진: 착수, 따내기, 자충수, 패 판정
(function (g) {
  const other = (c) => (c === 'B' ? 'W' : 'B');

  function neighbors(n, i) {
    const x = i % n, y = (i / n) | 0, r = [];
    if (x > 0) r.push(i - 1);
    if (x < n - 1) r.push(i + 1);
    if (y > 0) r.push(i - n);
    if (y < n - 1) r.push(i + n);
    return r;
  }

  function group(b, n, i) {
    const color = b[i], stones = [], libs = new Set(), seen = new Set([i]), stack = [i];
    while (stack.length) {
      const p = stack.pop();
      stones.push(p);
      for (const q of neighbors(n, p)) {
        if (b[q] === null) libs.add(q);
        else if (b[q] === color && !seen.has(q)) { seen.add(q); stack.push(q); }
      }
    }
    return { stones, libs: libs.size };
  }

  function boardFromStones(n, stones) {
    const b = new Array(n * n).fill(null);
    for (const s of stones || []) b[s.y * n + s.x] = s.c;
    return b;
  }

  function sameBoard(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // koBoard: 상대가 직전 수를 두기 전의 국면. 같은 국면으로 돌아가면 패 위반.
  function tryPlay(b, n, i, c, koBoard) {
    if (b[i]) return { error: 'occupied' };
    const nb = b.slice();
    nb[i] = c;
    const captured = [];
    for (const j of neighbors(n, i)) {
      if (nb[j] === other(c)) {
        const gr = group(nb, n, j);
        if (gr.libs === 0) for (const s of gr.stones) { nb[s] = null; captured.push(s); }
      }
    }
    if (group(nb, n, i).libs === 0) return { error: 'suicide' };
    if (koBoard && sameBoard(nb, koBoard)) return { error: 'ko' };
    return { board: nb, captured };
  }

  // 문제 배치에서 moves[0..upto) 를 재생.
  // labels: 현재 판 위에 남아 있는 돌의 수순 번호 (idx -> 번호)
  // overwritten: 따낸 자리에 다시 둔 수 ("7 = 3의 자리")
  function replay(n, stones, moves, upto) {
    let b = boardFromStones(n, stones);
    const boards = [b];
    const labels = new Map();
    const firstAt = new Map();
    const overwritten = [];
    const captures = { B: 0, W: 0 };
    let lastIdx = -1;
    const k = upto == null ? moves.length : Math.min(upto, moves.length);
    for (let m = 0; m < k; m++) {
      const mv = moves[m];
      if (mv.pass) { boards.push(b); lastIdx = -1; continue; }
      const i = mv.y * n + mv.x;
      const ko = boards.length >= 2 ? boards[boards.length - 2] : null;
      const res = tryPlay(b, n, i, mv.c, ko);
      if (res.error) { b = b.slice(); b[i] = mv.c; } // 기록이 어긋난 경우에도 표시는 되도록
      else {
        b = res.board;
        for (const s of res.captured) labels.delete(s);
        captures[mv.c] += res.captured.length;
      }
      if (firstAt.has(i)) overwritten.push({ num: m + 1, at: firstAt.get(i) });
      else firstAt.set(i, m + 1);
      labels.set(i, m + 1);
      boards.push(b);
      lastIdx = i;
    }
    return { board: b, boards, labels, overwritten, captures, lastIdx };
  }

  g.GoEngine = { other, neighbors, group, boardFromStones, tryPlay, replay, sameBoard };
})(typeof window !== 'undefined' ? window : globalThis);
