/* 渲染与交互。依赖 logic.js 里的纯函数和页面内嵌的 __TINKER__ 数据。 */

(function () {
  const data = JSON.parse(document.getElementById('tinker-data').textContent);
  const { days, sources, status, names, generatedAt } = data;
  const label = (facet, id) => (names[facet] && names[facet][id]) || id;
  const allItems = flatten(days);
  const state = loadState();
  const REMOTE_PREFIX = 'tinker:';
  const MIGRATED_KEY = 'tinker.server-sync.v1';
  const PENDING_KEY = 'tinker.pending-sync.v1';
  let pendingChanges = loadPending();
  let syncReady = false;
  let syncInFlight = null;

  const ui = { view: 'all', tool: null, topic: null, query: '', date: null, panel: false };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- 云端状态 ---------- */

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function loadPending() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePending() {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(pendingChanges)); } catch { /* 忽略 */ }
  }

  function stateRequest(method, body) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    };
    if (body !== undefined) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return Promise.resolve().then(() => fetch('/api/state', options)).then((response) => (
      response.json().catch(() => ({})).then((payload) => {
        if (!response.ok) throw new Error(payload.error || '云端同步失败');
        return payload;
      })
    ));
  }

  function mergePending(id, change) {
    const current = pendingChanges[id] || {};
    if (hasOwn(change, 'read')) current.read = change.read;
    if (hasOwn(change, 'starred')) current.starred = change.starred;
    pendingChanges[id] = current;
  }

  function queueRemoteChange(id, change) {
    mergePending(id, change);
    savePending();
    if (syncReady) flushPending();
  }

  function pendingList() {
    return Object.keys(pendingChanges).map((localId) => {
      const change = { localId, id: REMOTE_PREFIX + localId };
      if (hasOwn(pendingChanges[localId], 'read')) change.read = pendingChanges[localId].read;
      if (hasOwn(pendingChanges[localId], 'starred')) change.starred = pendingChanges[localId].starred;
      return change;
    });
  }

  function samePatch(current, sent) {
    return current
      && (!hasOwn(sent, 'read') || current.read === sent.read)
      && (!hasOwn(sent, 'starred') || current.starred === sent.starred)
      && Object.keys(current).length === Object.keys(sent).length - 2;
  }

  function flushPending() {
    if (syncInFlight) return syncInFlight;
    const snapshot = pendingList();
    if (!snapshot.length) return Promise.resolve();

    let succeeded = false;
    syncInFlight = Promise.resolve().then(() => {
      let chain = Promise.resolve();
      for (let i = 0; i < snapshot.length; i += 200) {
        const changes = snapshot.slice(i, i + 200).map(({ localId, ...change }) => change);
        chain = chain.then(() => stateRequest('PUT', { changes }));
      }
      return chain;
    }).then(() => {
      for (const sent of snapshot) {
        if (samePatch(pendingChanges[sent.localId], sent)) delete pendingChanges[sent.localId];
      }
      savePending();
      succeeded = true;
    }).catch(() => {
      // 保留本机状态与待同步队列；下次操作或刷新时继续补传。
    }).finally(() => {
      syncInFlight = null;
      if (succeeded && Object.keys(pendingChanges).length) flushPending();
    });
    return syncInFlight;
  }

  function addLocalMigration() {
    for (const id of Object.keys(state.read)) {
      if (!hasOwn(pendingChanges[id] || {}, 'read')) mergePending(id, { read: true });
    }
    for (const id of Object.keys(state.starred)) {
      if (!hasOwn(pendingChanges[id] || {}, 'starred')) mergePending(id, { starred: true });
    }
    savePending();
  }

  function replaceWithRemote(remote) {
    state.read = {};
    state.starred = {};
    for (const remoteId of Array.isArray(remote.read) ? remote.read : []) {
      if (remoteId.startsWith(REMOTE_PREFIX)) state.read[remoteId.slice(REMOTE_PREFIX.length)] = true;
    }
    for (const remoteId of Array.isArray(remote.starred) ? remote.starred : []) {
      if (remoteId.startsWith(REMOTE_PREFIX)) state.starred[remoteId.slice(REMOTE_PREFIX.length)] = true;
    }
    saveState(state);
  }

  function initializeSync() {
    let remote;
    return stateRequest('GET').then((result) => {
      remote = result;
      let migrated = false;
      try { migrated = localStorage.getItem(MIGRATED_KEY) === '1'; } catch { /* 忽略 */ }
      if (!migrated) addLocalMigration();
      if (!Object.keys(pendingChanges).length) return undefined;
      return flushPending().then(() => {
        if (Object.keys(pendingChanges).length) throw new Error('仍有状态等待同步');
        return stateRequest('GET').then((latest) => { remote = latest; });
      });
    }).then(() => {
      replaceWithRemote(remote);
      try { localStorage.setItem(MIGRATED_KEY, '1'); } catch { /* 忽略 */ }
      syncReady = true;
      render();
    }).catch(() => {
      syncReady = true;
    });
  }

  function setItemState(id, key, value) {
    if (value) state[key][id] = true; else delete state[key][id];
    saveState(state);
    queueRemoteChange(id, { [key === 'read' ? 'read' : 'starred']: value });
  }

  /* ---------- 主题 ---------- */

  const themeBtn = $('#theme');
  themeBtn.addEventListener('click', () => {
    const now = document.documentElement.getAttribute('data-theme');
    const dark = now ? now === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('tinker.theme', dark ? 'light' : 'dark'); } catch { /* 忽略 */ }
  });
  try {
    const saved = localStorage.getItem('tinker.theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch { /* 忽略 */ }

  /* ---------- 侧栏 ---------- */

  function renderRail() {
    const views = $('#views');
    views.textContent = '';
    const unread = allItems.filter((i) => !state.read[i.id]).length;
    const starred = allItems.filter((i) => state.starred[i.id]).length;
    for (const [key, label, count] of [
      ['all', '全部', allItems.length],
      ['unread', '未读', unread],
      ['starred', '收藏', starred],
    ]) {
      const b = el('button', 'view-btn');
      b.append(el('span', null, label), el('span', 'count', String(count)));
      b.setAttribute('aria-pressed', String(!ui.panel && ui.view === key));
      b.addEventListener('click', () => { ui.view = key; ui.panel = false; render(); });
      views.append(b);
    }
    const src = el('button', 'view-btn');
    src.append(el('span', null, '信源与健康度'), el('span', 'count', String(sources.length)));
    src.setAttribute('aria-pressed', String(ui.panel));
    src.addEventListener('click', () => { ui.panel = !ui.panel; render(); });
    views.append(src);

    // 工具和话题是两组独立筛选器，可以叠加（比如「Claude Code」+「MCP」）。
    for (const facet of ['tools', 'topics']) {
      const box = $(`#${facet}`);
      box.textContent = '';
      const key = facet === 'tools' ? 'tool' : 'topic';
      const rows = facetCounts(allItems, facet).slice(0, 20);
      if (!rows.length) {
        box.append(el('p', 'rail-empty', '本期没有'));
        continue;
      }
      for (const [id, count] of rows) {
        const b = el('button', 'chip');
        b.append(el('span', 'label', label(facet, id)), el('span', 'count', String(count)));
        b.setAttribute('aria-pressed', String(ui[key] === id));
        b.addEventListener('click', () => { ui[key] = ui[key] === id ? null : id; ui.panel = false; render(); });
        box.append(b);
      }
    }

    const cal = $('#calendar');
    cal.textContent = '';
    if (!days.length) return;
    const have = new Map(days.map((d) => [d.date, (d.items || []).length]));
    for (const date of lastNDates(days[0].date, 28)) {
      const b = el('button', 'cal-day', date.slice(8));
      const n = have.get(date);
      b.dataset.has = n ? 'yes' : 'no';
      b.title = n ? `${date}：${n} 篇` : `${date}：无`;
      b.setAttribute('aria-pressed', String(ui.date === date));
      b.setAttribute('aria-label', b.title);
      b.addEventListener('click', () => { ui.date = ui.date === date ? null : date; ui.panel = false; render(); });
      cal.append(b);
    }
  }

  /* ---------- 条目 ---------- */

  function meter(rating) {
    const m = el('span', 'meter');
    m.setAttribute('aria-label', `评分 ${rating} / 5`);
    for (let i = 1; i <= 5; i += 1) {
      const bar = el('i');
      if (i <= rating) bar.dataset.on = '1';
      m.append(bar);
    }
    return m;
  }

  function entryNode(item, rank) {
    const node = el('article', 'entry');
    node.dataset.read = String(Boolean(state.read[item.id]));
    if (item.rating >= 5) node.dataset.pick = 'true';

    const gutter = el('div', 'entry-gutter');
    gutter.append(el('span', 'entry-rank', String(rank).padStart(2, '0')), meter(item.rating || 0));
    node.append(gutter);

    const main = el('div');

    const h = el('h3', 'entry-title');
    if (item.rating >= 5) h.append(el('span', 'pick-flag', '今日精选'));
    const a = el('a', null, item.titleZh || item.titleOriginal);
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // 点标题即视为已读：这是唯一一个「用户真的去看了」的可靠信号。
    a.addEventListener('click', () => { setItemState(item.id, 'read', true); render(); });
    h.append(a);
    main.append(h);

    if (item.whyRead) main.append(el('p', 'why', item.whyRead));
    if (item.summaryZh) main.append(el('p', 'summary', item.summaryZh));

    const meta = el('div', 'entry-meta');
    meta.append(el('span', null, item.source));
    if (item.author) { meta.append(el('span', 'sep', '·'), el('span', null, item.author)); }
    meta.append(el('span', 'sep', '·'), el('span', null, (item.publishedAt || item.date || '').slice(0, 10)));
    for (const t of item.tools || []) meta.append(el('span', 'tool-tag', label('tools', t)));
    for (const t of item.topics || []) meta.append(el('span', 'topic-tag', label('topics', t)));
    if (item.thin) {
      const f = el('span', 'thin-flag', '⚠ 仅标题');
      f.title = '抓不到正文，摘要只依据标题撰写';
      meta.append(f);
    }

    const actions = el('div', 'entry-actions');
    const star = el('button', 'act', state.starred[item.id] ? '★ 已收藏' : '☆ 收藏');
    star.setAttribute('aria-pressed', String(Boolean(state.starred[item.id])));
    star.addEventListener('click', () => {
      setItemState(item.id, 'starred', !state.starred[item.id]);
      render();
    });
    const read = el('button', 'act', state.read[item.id] ? '标为未读' : '标为已读');
    read.addEventListener('click', () => {
      setItemState(item.id, 'read', !state.read[item.id]);
      render();
    });
    actions.append(star, read);
    meta.append(actions);

    main.append(meta);
    node.append(main);
    return node;
  }

  /* ---------- 信源面板 ---------- */

  function renderPanel() {
    const wrap = $('#panel');
    wrap.textContent = '';
    const yields = new Map();
    for (const item of allItems) yields.set(item.source, (yields.get(item.source) || 0) + 1);

    wrap.append(el('p', 'panel-intro',
      `共 ${sources.length} 个信源。「近 30 天入选」为 0 的源不代表坏了——`
      + '个人博客本来就月更，而且只有真正聊 agent 的那几篇才会进来。连续失败 7 次以上的才需要处理。'));

    const table = el('table', 'sources');
    const head = el('tr');
    for (const t of ['信源', '类型', '状态', '近 30 天入选', '说明']) head.append(el('th', null, t));
    // Element.append() 返回 undefined，不能链式取回刚追加的节点。
    // 之前写的是 table.append(el('thead')).lastChild.append(head)，直接抛 TypeError，
    // 整个信源面板从上线起就打不开——而我一次都没点过那个按钮。
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const body = el('tbody');
    const kindLabel = { search: '按词搜索', forum: '论坛', aggregator: '聚合', weekly: '周刊', blog: '个人博客' };
    for (const s of [...sources].sort((a, b) => (yields.get(b.name) || 0) - (yields.get(a.name) || 0))) {
      const tr = el('tr');
      const nameCell = el('td');
      const link = el('a', null, s.name);
      link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      nameCell.append(link);
      const st = sourceState(status[s.name]);
      const badge = el('span', 'state', st.label);
      badge.dataset.s = st.s;
      const stateCell = el('td');
      stateCell.append(badge);
      tr.append(nameCell, el('td', 'kind', kindLabel[s.kind] || s.kind), stateCell,
        el('td', 'num', String(yields.get(s.name) || 0)), el('td', 'desc', s.desc || ''));
      body.append(tr);
    }
    table.append(body);
    const scroll = el('div', 'table-wrap');
    scroll.append(table);
    wrap.append(scroll);
  }

  /* ---------- 总渲染 ---------- */

  function render() {
    renderRail();
    const panel = $('#panel');
    const stream = $('#stream');
    panel.classList.toggle('hidden', !ui.panel);
    stream.classList.toggle('hidden', ui.panel);
    if (ui.panel) { renderPanel(); return; }

    stream.textContent = '';
    const shown = filterItems(allItems, ui, state);
    if (!shown.length) {
      stream.append(el('p', 'empty', '这个筛选下还没有内容。换个工具标签或日期看看。'));
      return;
    }

    const byDate = new Map();
    for (const item of shown) {
      if (!byDate.has(item.date)) byDate.set(item.date, []);
      byDate.get(item.date).push(item);
    }
    for (const [date, items] of byDate) {
      const day = days.find((d) => d.date === date);
      const head = el('div', 'day-head');
      head.append(el('h2', 'day-date', date), el('span', 'day-count', `${items.length} 篇`));
      stream.append(head);
      if (day && day.dailyNote && !ui.tool && !ui.topic && !ui.query) {
        const note = el('p', 'day-note');
        note.append(el('strong', null, '编者按　'), document.createTextNode(day.dailyNote));
        stream.append(note);
      }
      const list = el('div', 'entries');
      items.forEach((item, i) => list.append(entryNode(item, i + 1)));
      stream.append(list);
    }
  }

  const search = $('#search');
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { ui.query = search.value.trim(); ui.panel = false; render(); }, 140);
  });

  $('#generated').textContent = `更新于 ${new Date(generatedAt).toLocaleString('zh-CN', { hour12: false })}`;
  render();
  initializeSync();
})();
