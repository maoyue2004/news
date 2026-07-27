/* DOM 装配。依赖 window.ReaderLogic 与页面里的 #reader-data。 */
(function () {
  var L = window.ReaderLogic;
  var DATA = JSON.parse(document.getElementById('reader-data').textContent);
  var READ_KEY = 'airadar.read.v1';
  var STAR_KEY = 'airadar.star.v1';

  function loadSet(key) {
    try {
      var raw = localStorage.getItem(key);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }
  function saveSet(key, set) {
    try {
      localStorage.setItem(key, JSON.stringify([...set]));
    } catch (e) {
      /* 隐私模式下写不进去，功能降级为本次会话有效 */
    }
  }

  var readSet = loadSet(READ_KEY);
  var starSet = loadSet(STAR_KEY);
  var today = DATA.days.length ? DATA.days[0].date : '';
  var state = { view: today ? { kind: 'day', date: today } : { kind: 'sources' }, filter: 'all', query: '' };

  var elStats = document.getElementById('stats');
  var elCal = document.getElementById('calendar');
  var elStream = document.getElementById('stream');
  var elSources = document.getElementById('sources-view');
  var elSearch = document.getElementById('search');
  var elFilters = document.getElementById('filters');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function allItems() {
    return DATA.days.reduce(function (acc, d) { return acc.concat(d.items); }, []);
  }

  function currentItems() {
    if (state.view.kind === 'starred') {
      return allItems().filter(function (it) { return starSet.has(it.id); });
    }
    var day = DATA.days.find(function (d) { return d.date === state.view.date; });
    return day ? day.items : [];
  }

  function currentErrors() {
    if (state.view.kind !== 'day') return [];
    var day = DATA.days.find(function (d) { return d.date === state.view.date; });
    return day && day.errors ? day.errors : [];
  }

  function renderCalendar() {
    var html = DATA.days.map(function (d) {
      var unread = d.items.filter(function (it) { return !readSet.has(it.id); }).length;
      var active = state.view.kind === 'day' && state.view.date === d.date;
      return '<button class="day-btn' + (active ? ' active' : '') + '" data-date="' + esc(d.date) + '">' +
        '<span>' + esc(L.formatDayLabel(d.date, today)) + '</span>' +
        '<span class="day-count">' + (unread ? '<span class="unread-dot"></span> ' : '') + d.items.length + '</span>' +
        '</button>';
    }).join('');
    elCal.innerHTML = html;
  }

  function renderStats() {
    var s = L.computeStats(currentItems(), readSet, starSet);
    var label = state.view.kind === 'starred' ? '收藏' :
      state.view.kind === 'sources' ? '' : L.formatDayLabel(state.view.date, today);
    elStats.innerHTML = label
      ? label + ' <b>' + s.total + '</b> 条 · 未读 <b>' + s.unread + '</b> · ★ <b>' + s.starred + '</b>'
      : '';
  }

  function itemHtml(it) {
    var isRead = readSet.has(it.id);
    var isStar = starSet.has(it.id);
    var time = new Date(it.publishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return '<article class="item' + (isRead ? ' read' : '') + '" data-id="' + esc(it.id) + '">' +
      '<button class="toggle" data-act="read" aria-label="标记已读" aria-pressed="' + isRead + '">' + (isRead ? '☑' : '☐') + '</button>' +
      '<button class="toggle' + (isStar ? ' star-on' : '') + '" data-act="star" aria-label="标星" aria-pressed="' + isStar + '">' + (isStar ? '★' : '☆') + '</button>' +
      '<div class="item-body">' +
        '<div class="item-meta">' +
          '<span class="src">' + esc(it.source) + '</span>' +
          '<span>' + esc(L.TYPE_LABELS[it.type] || it.type) + '</span>' +
          '<span>' + esc((it.lang || '').toUpperCase()) + '</span>' +
          '<span>' + esc(time) + '</span>' +
          L.itemBadges(it) +
        '</div>' +
        '<h3 class="item-title"><a href="' + esc(L.safeUrl(it.url)) + '" target="_blank" rel="noopener">' + esc(it.titleZh || it.titleOriginal) + '</a></h3>' +
        (it.titleZh ? '<p class="item-orig">原标题 ' + esc(it.titleOriginal) + '</p>' : '') +
        '<p class="item-summary">' + esc(it.summaryZh) + '</p>' +
      '</div>' +
    '</article>';
  }

  function renderStream() {
    elSources.classList.add('hidden');
    elStream.classList.remove('hidden');

    var items = L.applyFilter(currentItems(), {
      filter: state.filter, query: state.query, readSet: readSet, starSet: starSet,
    });

    if (!items.length) {
      elStream.innerHTML = '<div class="empty-state">这里没有内容 — 换个筛选条件或看看别的日期。</div>';
      return;
    }

    var groups = L.groupByType(items);
    var html = groups.map(function (g) {
      var breakdown = L.sourceBreakdown(g.items).map(function (b) {
        return esc(b.source) + ' ' + b.count;
      }).join(' · ');
      return '<div class="group-head"><h2>' + esc(g.label) + '</h2>' +
        '<span class="group-count">' + g.items.length + ' 条</span></div>' +
        '<div class="group-breakdown">' + breakdown + '</div>' +
        g.items.map(itemHtml).join('');
    }).join('');

    var errors = currentErrors();
    if (errors.length) {
      html += '<div class="errors-note">今天有 ' + errors.length + ' 个源没抓到：' +
        errors.map(function (e) { return esc(e.source) + '（' + esc(e.message) + '）'; }).join('、') + '</div>';
    }
    elStream.innerHTML = html;
  }

  function renderSources() {
    elStream.classList.add('hidden');
    elSources.classList.remove('hidden');

    var enabled = DATA.sources.filter(function (s) { return s.enabled; });
    var disabled = DATA.sources.filter(function (s) { return !s.enabled; });
    var counts = L.countsBySource(DATA.days);

    function row(s) {
      var st = DATA.status[s.name] || {};
      var last = st.lastSuccess ? new Date(st.lastSuccess).toLocaleDateString('zh-CN') : '—';
      var note = s.enabled
        ? (st.consecutiveFailures ? '连续失败 ' + st.consecutiveFailures + ' 次：' + esc(st.lastErrorMessage || '') : '正常')
        : esc(s.disabledReason || '未启用');
      var today = counts.today[s.name] || 0;
      var win = counts.window[s.name] || 0;
      return '<tr class="' + (s.enabled ? '' : 'disabled') + '">' +
        '<td><a href="' + esc(L.safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a></td>' +
        '<td>' + esc(L.TYPE_LABELS[s.type] || s.type) + '</td>' +
        '<td>' + esc((s.lang || '').toUpperCase()) + '</td>' +
        '<td class="num">' + today + '</td>' +
        '<td class="num">' + win + '</td>' +
        '<td>' + last + '</td><td>' + note + '</td></tr>';
    }

    elSources.innerHTML =
      '<div class="group-head"><h2>正在抓取</h2><span class="group-count">' + enabled.length + ' 个</span></div>' +
      '<div class="table-scroll"><table class="sources-table">' +
      '<tr><th>信源</th><th>类型</th><th>语言</th><th>今日</th><th>最近 30 天</th><th>最近成功</th><th>状态</th></tr>' +
      enabled.map(row).join('') + '</table></div>' +
      '<div class="group-head"><h2>未启用</h2><span class="group-count">' + disabled.length + ' 个</span></div>' +
      '<div class="table-scroll"><table class="sources-table">' +
      '<tr><th>信源</th><th>类型</th><th>语言</th><th>今日</th><th>最近 30 天</th><th>最近成功</th><th>原因</th></tr>' +
      disabled.map(row).join('') + '</table></div>' +
      '<div class="errors-note">信源列表以仓库里的 sources.json 为准。要增删信源，直接告诉 Claude，改动次日生效。' +
      '<br>已读与标星存在这台设备的浏览器里，换设备或清缓存会丢失；' +
      '<button id="export-stars" class="toggle" style="text-decoration:underline">导出收藏</button>' +
      '<button id="import-stars" class="toggle" style="text-decoration:underline">导入收藏</button>' +
      '<input id="import-stars-file" type="file" accept="application/json" style="display:none">' +
      '<span id="import-stars-msg"></span></div>';

    var btn = document.getElementById('export-stars');
    if (btn) btn.addEventListener('click', exportStars);

    var importBtn = document.getElementById('import-stars');
    var importFile = document.getElementById('import-stars-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        importFile.value = '';
        if (file) importStars(file);
      });
    }
  }

  function exportStars() {
    var starred = allItems().filter(function (it) { return starSet.has(it.id); });
    var payload = JSON.stringify({ exportedAt: new Date().toISOString(), items: starred }, null, 2);
    if (window.claude && window.claude.downloads) {
      window.claude.downloads.save({ filename: 'ai-radar-stars.json', data: payload }).catch(function () {});
    } else {
      var blob = new Blob([payload], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ai-radar-stars.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  // 导入只做并集合并，不覆盖已有标星，也绝不碰 readSet ——
  // 导出/导入是给标星做备份用的，已读状态不参与备份（见 README「已知限制」）。
  // 解析失败或格式不对时把提示文字写进按钮旁边的 <span>，不用 alert：
  // alert 会阻塞 Artifact 的 iframe，把整个页面卡住。
  function importStars(file) {
    // render() 会整体重建 #sources-view 的 innerHTML（包括这条消息用的 span），
    // 所以提示文字必须在 render() 之后，对着重建出来的新节点设置，否则消息
    // 前脚写进去、后脚就被 render() 冲掉，页面上根本看不见。
    function setMsg(text) {
      render();
      var el = document.getElementById('import-stars-msg');
      if (el) el.textContent = text;
    }
    var reader = new FileReader();
    reader.onerror = function () { setMsg('读取文件失败'); };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        setMsg('导入失败：不是合法的 JSON 文件');
        return;
      }
      if (!parsed || !Array.isArray(parsed.items)) {
        setMsg('导入失败：文件格式不对，缺少 items 数组');
        return;
      }
      var added = 0;
      parsed.items.forEach(function (it) {
        if (it && typeof it.id === 'string' && it.id && !starSet.has(it.id)) {
          starSet.add(it.id);
          added++;
        }
      });
      saveSet(STAR_KEY, starSet);
      setMsg('已导入 ' + added + ' 条新标星');
    };
    reader.readAsText(file);
  }

  function render() {
    renderCalendar();
    renderStats();
    if (state.view.kind === 'sources') renderSources();
    else renderStream();
    document.querySelectorAll('.view-btn').forEach(function (b) {
      b.classList.toggle('active', state.view.kind === b.dataset.view);
    });
  }

  elCal.addEventListener('click', function (e) {
    var btn = e.target.closest('.day-btn');
    if (!btn) return;
    state.view = { kind: 'day', date: btn.dataset.date };
    render();
  });

  document.querySelectorAll('.view-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.view = { kind: b.dataset.view };
      render();
    });
  });

  elFilters.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    elFilters.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === btn); });
    renderStream();
    renderStats();
  });

  elSearch.addEventListener('input', function () {
    state.query = elSearch.value;
    if (state.view.kind !== 'sources') { renderStream(); renderStats(); }
  });

  elStream.addEventListener('click', function (e) {
    var summary = e.target.closest('.item-summary');
    if (summary) { summary.classList.toggle('expanded'); return; }

    var btn = e.target.closest('.toggle');
    if (!btn) return;
    var id = btn.closest('.item').dataset.id;
    if (btn.dataset.act === 'read') {
      if (readSet.has(id)) readSet.delete(id); else readSet.add(id);
      saveSet(READ_KEY, readSet);
    } else {
      if (starSet.has(id)) starSet.delete(id); else starSet.add(id);
      saveSet(STAR_KEY, starSet);
    }
    render();
  });

  render();
})();
