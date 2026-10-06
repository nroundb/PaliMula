/* parser.js — result_word.md → 데이터 (DOM 비의존). 규격: 작업지시서_웹앱개발.md 4장 */
(function () {
  const SEP = '\\s“”"\'‘’—–,.;:?!()\\[\\]';
  const key = s => s.normalize('NFC').toLowerCase().replace(/\u1e43/g, '\u1e41');

  function tokenize(t) {
    const re = new RegExp('[^' + SEP + ']+', 'g'), r = [];
    let m;
    while ((m = re.exec(t))) r.push({ text: m[0], key: key(m[0]), start: m.index, end: re.lastIndex });
    return r;
  }

  // 항목 한 줄 → head / pos / meaning (괄호는 짝을 맞춰 찾는다)
  function parseEntry(s) {
    const e = { raw: s, head: s, pos: '', meaning: '', bad: false, key: null, children: [] };
    const idx = [s.indexOf(' — '), s.indexOf(' (')].filter(i => i >= 0);
    const hEnd = idx.length ? Math.min(...idx) : s.length;
    e.head = s.slice(0, hEnd);
    let rest = s.slice(hEnd);
    if (rest.startsWith(' (')) {
      let d = 0, i = 1;
      for (; i < rest.length; i++) {
        if (rest[i] === '(') d++;
        else if (rest[i] === ')' && --d === 0) break;
      }
      if (d !== 0) { e.head = s; e.bad = true; return e; }
      e.pos = rest.slice(1, i + 1);
      rest = rest.slice(i + 1);
    }
    if (rest.startsWith(' — ')) e.meaning = rest.slice(3).trim();
    else if (rest.trim()) { e.head = s; e.pos = ''; e.bad = true; }
    return e;
  }

  function parseEntries(lines, add) {
    const top = [], stack = [];
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const m = raw.match(/^(\s*)\*\s+(.*)$/);
      if (!m) {
        const e = parseEntry(raw.trim());
        e.depth = 0;
        if (e.bad) add('warn', 'W02', '규격에 맞지 않는 항목: ' + raw.trim());
        top.push(e); stack.length = 0; stack.push(e);
        continue;
      }
      const e = parseEntry(m[2]);
      e.depth = Math.floor(m[1].length / 2) + 1;
      if (e.bad) add('warn', 'W02', '규격에 맞지 않는 항목: ' + m[2]);
      else if (!e.meaning) add('error', 'E06', '분해 항목에 뜻풀이가 없습니다: ' + e.head);
      while (stack.length && stack[stack.length - 1].depth >= e.depth) stack.pop();
      const parent = stack[stack.length - 1];
      if (!parent) { add('error', 'E09', '최상위 항목보다 먼저 나온 분해 항목: ' + e.head); continue; }
      parent.children.push(e); stack.push(e);
    }
    return top;
  }

  // 직역의 {한글|빨리어} 표기 → 조각 목록
  function parseKo(p, ko, add) {
    const re = /\{([^{}|]*)\|([^{}]*)\}/g, keys = new Set(p.tokens.map(t => t.key));
    const segs = []; let last = 0, m, n = 0;
    while ((m = re.exec(ko))) {
      if (m.index > last) segs.push({ text: ko.slice(last, m.index), keys: null });
      last = re.lastIndex; n++;
      const ph = m[1], ws = m[2].split(',');
      if (!ph.trim() || ws.some(w => !w || /\s/.test(w))) {
        add('error', 'E04', '표기 문법 오류: {' + m[1] + '|' + m[2] + '}');
        segs.push({ text: ph, keys: null }); continue;
      }
      const ks = ws.map(key), miss = ks.filter(k => !keys.has(k));
      if (miss.length) {
        add('error', 'E03', '원문에 없는 단어: ' + miss.join(', '));
        segs.push({ text: ph, keys: null });
      } else segs.push({ text: ph, keys: ks });
    }
    if (last < ko.length) segs.push({ text: ko.slice(last), keys: null });
    if (/[{}|]/.test(ko.replace(/\{[^{}|]*\|[^{}]*\}/g, ''))) add('error', 'E04', '직역에 짝이 맞지 않는 { } | 문자가 있습니다');
    if (!n) add('warn', 'W03', '직역에 {한글|빨리어} 표기가 없습니다');
    p.koSegments = segs;
    p.koText = segs.map(s => s.text).join('');
  }

  function parsePara(no, body) {
    const d = [], add = (level, code, message) => d.push({ level, code, message });
    const L = body.split('\n');
    const p = { no, diagnostics: d, paliText: '', tokens: [], koText: '', koSegments: [], entries: [], structure: null, aligned: false };
    const si = L.findIndex(l => /^\*\*\[문장 구조 및 특징\]\*\*/.test(l.trim()));
    const ki = L.findIndex(l => l.startsWith('학습용 직역:'));
    if (ki < 0) {
      add('error', 'E02', '`학습용 직역:` 줄이 없습니다');
      p.paliText = L.slice(0, si < 0 ? L.length : si).filter(l => l.trim()).join(' ').trim();
      return p;
    }
    p.paliText = L.slice(0, ki).filter(l => l.trim()).map(l => {
      const m = l.match(/^\s*[*-]\s+(.*)$/);
      if (m) { add('warn', 'W01', '원문 줄 앞의 불릿을 제거했습니다'); return m[1]; }
      return l.trim();
    }).join(' ');
    p.tokens = tokenize(p.paliText);
    parseKo(p, L[ki].slice('학습용 직역:'.length).trim(), add);
    p.entries = parseEntries(L.slice(ki + 1, si < 0 ? L.length : si), add);
    p.aligned = p.tokens.length === p.entries.length;
    if (p.aligned) p.entries.forEach((e, i) => { e.key = p.tokens[i].key; });
    else add('error', 'E01', '원문 ' + p.tokens.length + '단어 / 최상위 항목 ' + p.entries.length + '개');
    if (si >= 0) p.structure = L.slice(si + 1).join('\n').trim() || null;
    if (!p.structure) add('info', 'I02', '구조 설명이 없습니다');
    return p;
  }

  function parseSection(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const diagnostics = [], parts = text.split(/^#### \[(\d+)\][ \t]*$/m), paras = [];
    if (parts[0].trim()) diagnostics.push({ level: 'warn', code: 'W04', message: '첫 문단 앞의 텍스트는 무시했습니다' });
    for (let i = 1; i < parts.length; i += 2) paras.push(parsePara(+parts[i], parts[i + 1]));
    if (!paras.length) diagnostics.push({ level: 'error', code: 'E07', message: '`#### [N]` 문단이 없습니다' });
    for (let i = 1; i < paras.length; i++)
      if (paras[i].no !== paras[i - 1].no + 1)
        diagnostics.push({ level: 'error', code: 'E05', message: '문단번호가 이어지지 않습니다: ' + paras[i - 1].no + ' → ' + paras[i].no });
    return { paras, diagnostics };
  }

  window.Parser = { parseSection, tokenize, key };
})();
