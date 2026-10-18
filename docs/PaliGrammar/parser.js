(function () {
  var $ = function (s) { return document.querySelector(s); };
  var MD = 'data/md/';
  var DEFAULT_TITLES = { SUMMARY: '요약', NOTE: '참고', WARNING: '주의', TIP: '팁' };
  var docs = [], missing = [];

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>'); }

  function parseFM(t) {
    var m = t.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/), meta = {};
    if (!m) return { meta: meta, body: t };
    m[1].split(/\r?\n/).forEach(function (l) {
      var i = l.indexOf(':');
      if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    return { meta: meta, body: t.replace(/^\uFEFF/, '').slice(m[0].length) };
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    });
  }

  function render(md) {
    var box = document.createElement('div');
    box.innerHTML = marked.parse(md, { gfm: true });
    box.querySelectorAll('blockquote').forEach(function (bq) {
      var p = bq.firstElementChild;
      if (!p || p.tagName !== 'P') return;
      var m = p.innerHTML.match(/^\s*\[!(SUMMARY|NOTE|WARNING|TIP)\][ \t]*([^\n]*)\n?/i);
      if (!m) return;
      var type = m[1].toUpperCase(), div = document.createElement('div');
      div.className = 'callout ' + type.toLowerCase();
      var t = document.createElement('span');
      t.className = 'callout-title';
      t.innerHTML = m[2].trim() || DEFAULT_TITLES[type];
      p.innerHTML = p.innerHTML.slice(m[0].length);
      if (!p.textContent.trim()) p.remove();
      div.appendChild(t);
      while (bq.firstChild) div.appendChild(bq.firstChild);
      bq.replaceWith(div);
    });
    box.querySelectorAll('table').forEach(function (tb) {
      var w = document.createElement('div');
      w.className = 'table-scroll';
      tb.replaceWith(w);
      w.appendChild(tb);
    });
    box.querySelectorAll('a[href^="http"]').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });
    return box.innerHTML;
  }

  function buildToc() {
    var html = '', groups = [], map = {};
    docs.forEach(function (d) {
      var g = d.group || '기타';
      if (!map[g]) { map[g] = []; groups.push(g); }
      map[g].push(d);
    });
    groups.forEach(function (g) {
      html += '<div class="group">' + esc(g) + '</div><ul>';
      map[g].forEach(function (d) {
        html += '<li><a href="#/' + d.id + '" data-id="' + d.id + '">' + inline(d.title) + '</a></li>';
      });
      html += '</ul>';
    });
    if (missing.length) {
      html += '<div class="group">확인 필요</div>' + missing.map(function (f) {
        return '<div class="missing">파일을 찾을 수 없음: ' + esc(f) + '</div>';
      }).join('');
    }
    $('#toc').innerHTML = html;
  }

  function show() {
    var id = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var i = docs.findIndex(function (d) { return d.id === id; });
    if (i < 0) i = 0;
    var d = docs[i];
    if (!d) { $('#doc').innerHTML = '<p>표시할 문서가 없습니다. data/config.json의 docs 목록을 확인하세요.</p>'; return; }
    $('#doc').innerHTML = '<h1>' + inline(d.title) + '</h1>' + render(d.body);
    document.title = d.title.replace(/`/g, '') + ' - ' + $('#siteTitle').textContent;
    document.querySelectorAll('#toc a').forEach(function (a) {
      if (a.dataset.id === d.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var prev = docs[i - 1], next = docs[i + 1];
    $('#pager').innerHTML =
      (prev ? '<a class="prev" href="#/' + prev.id + '"><small>이전 글</small>' + inline(prev.title) + '</a>' : '<span class="spacer"></span>') +
      (next ? '<a class="next" href="#/' + next.id + '"><small>다음 글</small>' + inline(next.title) + '</a>' : '<span class="spacer"></span>');
    document.body.classList.remove('open');
    window.scrollTo(0, 0);
  }

  function fail(msg) { $('#doc').innerHTML = '<div class="callout warning"><span class="callout-title">불러오지 못했습니다</span><p>' + msg + '</p></div>'; }

  function init() {
    fetchText('data/config.json').then(function (t) {
      var cfg = JSON.parse(t);
      $('#siteTitle').textContent = cfg.title || '';
      if (cfg.home) $('#homeLink').href = cfg.home;
      return Promise.all((cfg.docs || []).map(function (f) {
        return fetchText(MD + f).then(function (txt) {
          var p = parseFM(txt);
          return { id: f.replace(/\.md$/i, ''), title: p.meta.title || f, group: p.meta.group, body: p.body };
        }).catch(function () { missing.push(f); return null; });
      }));
    }).then(function (list) {
      docs = list.filter(Boolean);
      buildToc();
      show();
      window.addEventListener('hashchange', show);
    }).catch(function () {
      fail(location.protocol === 'file:'
        ? '이 파일을 더블클릭해서 열면 동작하지 않습니다. 웹(GitHub Pages)에 올리거나, 폴더에서 <code>python -m http.server</code>를 실행한 뒤 <code>http://localhost:8000</code>으로 접속하세요.'
        : 'data/config.json을 읽지 못했습니다. 파일 위치와 형식(JSON)을 확인하세요.');
    });
  }

  $('#menuBtn').addEventListener('click', function () { document.body.classList.toggle('open'); });

  $('#printBtn').addEventListener('click', async function () {
    var btn = this, label = btn.textContent, doc = $('#doc'), y = window.scrollY;
    var name = (doc.querySelector('h1') ? doc.querySelector('h1').textContent : 'document').trim().replace(/[\\/:*?"<>|]/g, '');
    btn.disabled = true; btn.textContent = 'PDF 만드는 중…';
    try {
      await document.fonts.ready;
      window.scrollTo(0, 0);
      await html2pdf().set({
        margin: [14, 14, 14, 14], filename: name + '.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.callout', 'h2', 'h3', 'li'] }
      }).from(doc).save();
    } catch (e) {
      alert('PDF를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      window.scrollTo(0, y);
      btn.disabled = false; btn.textContent = label;
    }
  });

  init();
})();
