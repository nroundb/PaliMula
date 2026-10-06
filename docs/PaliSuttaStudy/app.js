/* app.js — 주소 처리, 화면 생성, 상호작용. 규격: 작업지시서_웹앱개발.md */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const app = $('#app'), debug = /[?&]debug=1/.test(location.search);
  let manifest, curr, io, saveT, wide = innerWidth >= 768;
  const cache = {};

  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  const applyTheme = () => { document.documentElement.dataset.theme = store('theme') === 'dark' ? 'dark' : 'light'; };
  const applyFont = () => document.documentElement.style.setProperty('--font-scale', store('fontScale') || 1);

  /* ---------- 화면 조각 ---------- */
  const THEME_BTN = '<button id="theme-toggle" aria-label="다크모드 전환">◐</button>';
  const bar = title => `<header class="toolbar"><span class="toolbar-title">${esc(title)}</span>${THEME_BTN}</header>`;
  const msg = (text, back = '#/') => { app.innerHTML = bar('빨리어 경전 단어학습장') + `<main class="screen"><p>${esc(text)}</p><a href="${back}">← 돌아가기</a></main>`; };
  const resume = s => { const lp = store('lastPos:' + s.id); return lp ? `<a class="resume" href="#/${s.id}/${lp.section}/${lp.para}">이어서 보기 (문단 ${lp.para})</a>` : ''; };

  function home() {
    app.innerHTML = bar('빨리어 경전 단어학습장') + '<main class="screen"><h2>경전</h2><div class="grid">' +
      manifest.suttas.map(s => `<div><a class="btn" href="#/${s.id}"><strong>${esc(s.title)}</strong><span>${esc(s.subtitle || '')}</span><span>${s.sections.length}개 section</span></a>${resume(s)}</div>`).join('') +
      '</div></main>';
  }

  function sections(s) {
    app.innerHTML = bar(s.title) + `<main class="screen"><a href="#/">← 경전 목록</a><h2>${esc(s.title)}</h2><p>${esc(s.subtitle || '')}</p>${resume(s)}<div class="grid">` +
      s.sections.map(x => `<a class="btn" href="#/${s.id}/${x.id}"><strong>${esc(x.label)}</strong>${x.paras ? `<span>문단 ${x.paras[0]}–${x.paras[1]}</span>` : ''}</a>`).join('') +
      '</div></main>';
  }

  /* ---------- 학습 화면 ---------- */
  function liHtml(e, top) {
    return `<li><strong class="${top ? 'word-term' : 'sub-word-term'}"${top && e.key ? ` data-word="${esc(e.key)}"` : ''}>${esc(e.head)}</strong>` +
      (e.pos ? ` <span class="pos">${esc(e.pos)}</span>` : '') + (e.meaning ? ` — ${esc(e.meaning)}` : '') +
      (e.children.length ? `<ul>${e.children.map(c => liHtml(c)).join('')}</ul>` : '') + '</li>';
  }
  const fmt = t => esc(t).split(/\n{2,}/).map(b => `<p>${b.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join('');

  function leftHtml(p) {
    let pali = '', last = 0;
    if (p.aligned) {
      for (const t of p.tokens) {
        pali += esc(p.paliText.slice(last, t.start)) + `<span class="pw" data-word="${esc(t.key)}">${esc(t.text)}</span>`;
        last = t.end;
      }
    }
    pali += esc(p.paliText.slice(last));
    const ko = p.koSegments.map(g => g.keys && p.aligned ? `<span class="kw" data-word="${esc(g.keys.join(' '))}">${esc(g.text)}</span>` : esc(g.text)).join('');
    return `<div class="left-block" data-para="${p.no}" id="left-${p.no}" style="--n:${p.no}"><span class="para-no">문단 ${p.no}</span>` +
      (p.aligned ? '' : '<small class="warn">단어 연결 없이 표시됨</small>') +
      (debug ? `<small class="dbg">원문 ${p.tokens.length}단어 / 항목 ${p.entries.length}개</small>` : '') +
      `<p class="pali-text">${pali}</p><p class="ko-text">${ko}</p></div>`;
  }
  const rightHtml = p => `<section class="right-block" data-para="${p.no}" id="right-${p.no}" tabindex="-1" style="--n:${p.no}"><h3>단어풀이</h3><ul class="word-list">${p.entries.map(e => liHtml(e, true)).join('')}</ul>${p.structure ? '<h3>문장구조 및 특징</h3>' + fmt(p.structure) : ''}</section>`;

  function dbgPanel(data, s, sec) {
    const rows = [...data.diagnostics.map(d => [0, d]), ...data.paras.flatMap(p => p.diagnostics.map(d => [p.no, d]))];
    const f = data.paras[0].no, l = data.paras[data.paras.length - 1].no;
    if (sec.paras && (sec.paras[0] !== f || sec.paras[1] !== l))
      rows.push([0, { level: 'warn', code: 'W05', message: `suttas.json의 paras ${sec.paras[0]}–${sec.paras[1]} ≠ 실제 ${f}–${l}` }]);
    const err = rows.filter(r => r[1].level === 'error').length;
    return `<div id="debug-panel"><strong>검증: 오류 ${err}개 / 진단 ${rows.length}개</strong>` +
      rows.map(([n, d]) => `<div>${d.code} ${d.level}${n ? ` · <a href="#/${s.id}/${sec.id}/${n}">문단 ${n}</a>` : ''} — ${esc(d.message)}</div>`).join('') + '</div>';
  }

  async function study(s, i, pn) {
    const sec = s.sections[i], me = (curr = { s, i });
    app.innerHTML = bar(s.title) + '<main class="screen"><p>불러오는 중…</p></main>';
    let data = cache[sec.file];
    if (!data) {
      try {
        const r = await fetch(`data/${sec.file}?v=${encodeURIComponent(manifest.version)}`);
        if (!r.ok) throw new Error(r.status);
        data = cache[sec.file] = Parser.parseSection(await r.text());
      } catch (e) { return msg('section 파일을 불러올 수 없습니다: ' + sec.file, '#/' + s.id); }
    }
    if (curr !== me) return;
    const paras = data.paras;
    if (!paras.length) return msg('이 파일에는 문단(#### [N])이 없습니다: ' + sec.file, '#/' + s.id);
    data.diagnostics.concat(...paras.map(p => p.diagnostics)).filter(d => d.level === 'error').forEach(d => console.warn(sec.file, d.code, d.message));

    const nav = (x, sym) => x ? `<a class="nav-btn" href="#/${s.id}/${x.id}" title="${esc(x.label)}">${sym}</a>` : `<span class="nav-btn off">${sym}</span>`;
    const next = s.sections[i + 1];
    app.innerHTML =
      `<header class="toolbar"><a class="nav-btn" href="#/${s.id}" aria-label="section 목록">←</a><span class="toolbar-title">${esc(s.title)} · ${esc(sec.label)}</span>` +
      nav(s.sections[i - 1], '◀') + nav(next, '▶') +
      `<input type="search" id="word-search" placeholder="단어 검색 (예: sati)" aria-label="단어 검색">` +
      `<select id="para-jump" aria-label="문단 이동"><option value="">문단 이동</option>${paras.map(p => `<option value="${p.no}">문단 ${p.no}</option>`).join('')}</select>` +
      `<div class="font-size-control"><button id="font-dec" aria-label="글자 작게">A-</button><button id="font-inc" aria-label="글자 크게">A+</button></div>${THEME_BTN}<button id="pdf-export">PDF</button></header>` +
      `<div class="container"><aside class="left-pane">${paras.map(leftHtml).join('')}</aside><main class="right-pane">${paras.map(rightHtml).join('')}` +
      `<div class="next-wrap">${next ? `<a class="btn" href="#/${s.id}/${next.id}"><strong>다음 section ▶</strong><span>${esc(next.label)}</span></a>` : `<a class="btn" href="#/${s.id}"><strong>section 목록으로</strong></a>`}</div></main></div>` +
      (debug ? dbgPanel(data, s, sec) : '');

    fit();
    document.fonts && document.fonts.ready.then(fit);
    const first = pn && $('#right-' + pn) ? pn : paras[0].no;
    if (wide) {
      io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) activate(e.target.dataset.para); }), { root: $('.right-pane'), rootMargin: '-50% 0px -50% 0px', threshold: 0 });
      $$('.right-block').forEach(b => io.observe(b));
    }
    activate(first);
    if (pn && $('#right-' + pn)) $('#right-' + pn).scrollIntoView({ block: 'start' });
    else { const rp = $('.right-pane'); if (rp) rp.scrollTop = 0; }
  }

  // 활성 문단: 좌측 블록 전환 + 이동 목록 동기화 + 읽던 위치 저장
  function activate(n) {
    $$('.left-block').forEach(l => l.classList.toggle('active', l.dataset.para == n));
    const lp = $('.left-pane'); if (lp) lp.scrollTop = 0;
    const pj = $('#para-jump'); if (pj) pj.value = n;
    clearTimeout(saveT);
    saveT = setTimeout(() => curr && store('lastPos:' + curr.s.id, { section: curr.s.sections[curr.i].id, para: +n }), 300);
  }

  // 툴바 높이 측정 + 좌측이 긴 문단은 우측 최소 높이를 늘림
  function fit() {
    const tb = $('.toolbar'); if (!tb) return;
    document.documentElement.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
    if (!$('.container')) return;
    if (innerWidth < 768) { $$('.right-block').forEach(b => { b.style.minHeight = ''; }); return; }
    const w = $('.left-pane').clientWidth;
    $$('.left-block').forEach(l => {
      const keep = l.style.cssText;
      l.style.cssText += `;display:block;visibility:hidden;position:absolute;width:${w}px`;
      const h = l.offsetHeight;
      l.style.cssText = keep;
      $('#right-' + l.dataset.para).style.minHeight = Math.max(innerHeight * 0.5, h + 24) + 'px';
    });
  }

  /* ---------- PDF ---------- */
  function printPdf() {
    const { s, i } = curr, pc = document.createElement('div');
    pc.id = 'print-container';
    pc.innerHTML = `<h1>${esc(s.title)} · ${esc(s.sections[i].label)}</h1>` + $$('.left-block').map(l => {
      const n = l.dataset.para;
      return `<div class="print-para-set"><div class="print-para-title">문단 ${n}</div><div class="print-section"><h3>빠알리어 원문</h3>${$('.pali-text', l).outerHTML}</div>` +
        `<div class="print-section"><h3>학습용 직역</h3>${$('.ko-text', l).outerHTML}</div><div class="print-section">${$('#right-' + n).innerHTML}</div></div>`;
    }).join('');
    document.body.appendChild(pc);
    document.body.dataset.printing = 'true';
    addEventListener('afterprint', () => { pc.remove(); delete document.body.dataset.printing; }, { once: true });
    print();
  }

  /* ---------- 이벤트 (위임) ---------- */
  const clearHl = () => $$('.hl').forEach(x => x.classList.remove('hl'));

  document.addEventListener('click', e => {
    const t = e.target, id = t.id;
    if (id === 'theme-toggle') { store('theme', store('theme') === 'dark' ? 'light' : 'dark'); applyTheme(); return; }
    if (id === 'font-inc' || id === 'font-dec') {
      const v = Math.min(1.9, Math.max(0.8, +((store('fontScale') || 1) + (id === 'font-inc' ? 0.1 : -0.1)).toFixed(1)));
      store('fontScale', v); applyFont(); fit(); return;
    }
    if (id === 'pdf-export') return printPdf();
    if (t.classList.contains('para-no')) {
      const r = $('#right-' + t.closest('[data-para]').dataset.para);
      if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const w = t.closest('.pw,.kw,.word-term');
    clearHl();
    if (!w) return;
    const n = w.closest('[data-para]').dataset.para, ks = (w.dataset.word || '').split(' ').filter(Boolean);
    if (!ks.length) return;
    if (!$('#left-' + n).classList.contains('active')) activate(n);
    $$(`[data-para="${n}"] .pw, [data-para="${n}"] .kw, [data-para="${n}"] .word-term`).forEach(x => {
      if ((x.dataset.word || '').split(' ').some(k => ks.includes(k))) x.classList.add('hl');
    });
  });

  document.addEventListener('change', e => {
    if (e.target.id !== 'para-jump' || !e.target.value) return;
    const r = $('#right-' + e.target.value);
    if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'word-search') return;
    const q = fold(e.target.value.trim());
    $$('.word-list li').forEach(li => {
      const own = [...li.childNodes].filter(n => n.tagName !== 'UL').map(n => n.textContent).join('');
      li.classList.toggle('search-hit', !!q && fold(own).includes(q));
    });
  });

  let rt;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if ((innerWidth >= 768) !== wide) { wide = innerWidth >= 768; route(); } else fit();
    }, 150);
  });

  /* ---------- 주소 처리 ---------- */
  function route() {
    if (io) { io.disconnect(); io = null; }
    clearTimeout(saveT); curr = null;
    delete document.body.dataset.printing;
    const [sid, secid, pn] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (!sid) return home();
    const s = manifest.suttas.find(x => x.id === sid);
    if (!s) return msg('경전을 찾을 수 없습니다: ' + sid);
    if (!secid) return sections(s);
    const i = s.sections.findIndex(x => x.id === secid);
    if (i < 0) return msg('section을 찾을 수 없습니다: ' + secid, '#/' + sid);
    study(s, i, +pn || 0);
  }

  (async function boot() {
    applyTheme(); applyFont();
    try {
      const r = await fetch('data/suttas.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      manifest = await r.json();
    } catch (e) { return msg('목록 파일(data/suttas.json)을 불러올 수 없습니다.'); }
    addEventListener('hashchange', route);
    route();
  })();
})();
