import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/**
 * 页面渲染路径的测试。
 *
 * 之前这一层完全没有覆盖，代价是「信源与健康度」面板从上线起就打不开：
 * `table.append(el('thead')).lastChild.append(head)` —— DOM 的 append() 返回
 * undefined，链式取 lastChild 直接抛 TypeError。纯逻辑测试再多也照不到这里，
 * 因为它根本不碰 DOM。
 *
 * 这里用一个够用的 DOM 桩把 logic.js + ui.js 跑起来，断言关键节点真的被建出来。
 * 桩只实现 ui.js 用到的那部分——刻意不引 jsdom，那是给这个仓库加一个大依赖
 * 去测三百行浏览器代码，不划算。
 */

/** 够用的 DOMTokenList：Set 没有 toggle/contains，直接拿来当 classList 会挂。 */
class TokenList {
  constructor() { this.set = new Set(); }

  add(...c) { for (const x of c) this.set.add(x); }

  remove(...c) { for (const x of c) this.set.delete(x); }

  contains(c) { return this.set.has(c); }

  has(c) { return this.set.has(c); }

  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) this.set.add(c); else this.set.delete(c);
    return on;
  }

  toString() { return [...this.set].join(' '); }
}

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.classList = new TokenList();
    this._text = '';
    this.listeners = {};
  }

  get className() { return this.classList.toString(); }

  set className(v) {
    this.classList = new TokenList();
    this.classList.add(...String(v).split(/\s+/).filter(Boolean));
  }

  get textContent() {
    return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }

  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }

  append(...nodes) {
    // 真实 DOM 的 append 返回 undefined —— 桩必须保持一致，
    // 否则就照不出「链式取回刚追加的节点」这类 bug。
    for (const n of nodes) this.children.push(n);
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }

  getAttribute(k) { return this.attributes[k] ?? null; }

  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }

  click() { for (const fn of this.listeners.click ?? []) fn(); }

  get lastChild() { return this.children[this.children.length - 1] ?? null; }

  /** 深度遍历，测试里用来找节点。 */
  *walk() {
    for (const c of this.children) {
      if (typeof c === 'string') continue;
      yield c;
      yield* c.walk();
    }
  }

  find(pred) { for (const n of this.walk()) if (pred(n)) return n; return null; }

  findAll(pred) { return [...this.walk()].filter(pred); }
}

function makeDom(dataJson) {
  const byId = {};
  for (const id of ['theme', 'views', 'tools', 'topics', 'calendar', 'stream', 'panel', 'search', 'generated']) {
    byId[id] = new FakeNode('div');
  }
  byId['tinker-data'] = Object.assign(new FakeNode('script'), { _text: dataJson });

  const document = {
    getElementById: (id) => byId[id] ?? null,
    querySelector: (sel) => byId[sel.replace(/^#/, '')] ?? null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (t) => String(t),
    documentElement: new FakeNode('html'),
  };
  document.documentElement.setAttribute = () => {};
  document.documentElement.getAttribute = () => null;
  return { document, byId };
}

function runUi(data) {
  const { document, byId } = makeDom(JSON.stringify(data));
  const sandbox = {
    document,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console,
    Date,
    JSON,
    Map,
    Set,
    Boolean,
    String,
    Number,
    Array,
    Object,
  };
  sandbox.window = sandbox;
  const code = `${readFileSync('templates/tinker/logic.js', 'utf8')}\n${readFileSync('templates/tinker/ui.js', 'utf8')}`;
  vm.runInNewContext(code, sandbox, { filename: 'tinker-page.js' });
  return byId;
}

const day = {
  date: '2026-08-01',
  dailyNote: '编者按内容',
  items: [
    {
      id: 'a', source: '某博客', kind: 'blog', url: 'https://e.com/a',
      titleOriginal: 'orig', titleZh: '第一篇', whyRead: '值得读的理由', summaryZh: '摘要',
      rating: 5, tools: ['claude-code'], topics: ['mcp'], publishedAt: '2026-08-01T00:00:00Z', author: '张三',
    },
    {
      id: 'b', source: '某论坛', kind: 'forum', url: 'https://e.com/b',
      titleOriginal: 'orig2', titleZh: '第二篇', whyRead: '另一个理由', summaryZh: '摘要二',
      rating: 4, tools: ['cursor'], topics: [], publishedAt: '2026-08-01T00:00:00Z',
    },
  ],
};

const data = {
  days: [day],
  sources: [
    { name: '某博客', url: 'https://e.com', kind: 'blog', desc: '说明一' },
    { name: '某论坛', url: 'https://f.com', kind: 'forum', desc: '说明二' },
  ],
  status: { 某博客: { consecutiveFailures: 0 }, 某论坛: { consecutiveFailures: 9 } },
  names: { tools: { 'claude-code': 'Claude Code', cursor: 'Cursor' }, topics: { mcp: 'MCP' } },
  generatedAt: '2026-08-01T12:00:00Z',
};

test('页面能渲染出条目、推荐理由和两种标签', () => {
  const byId = runUi(data);
  const text = byId.stream.textContent;
  assert.ok(text.includes('第一篇'), '标题要出现');
  assert.ok(text.includes('值得读的理由'), 'whyRead 要出现');
  assert.ok(text.includes('编者按内容'), '编者按要出现');
  assert.ok(text.includes('今日精选'), '5 分条目要打精选标');

  const toolTag = byId.stream.find((n) => n.classList.has('tool-tag'));
  const topicTag = byId.stream.find((n) => n.classList.has('topic-tag'));
  assert.equal(toolTag.textContent, 'Claude Code');
  assert.equal(topicTag.textContent, 'MCP');
});

test('侧栏把工具和话题渲染成两组独立筛选器', () => {
  const byId = runUi(data);
  assert.ok(byId.tools.textContent.includes('Claude Code'));
  assert.ok(byId.tools.textContent.includes('Cursor'));
  assert.ok(byId.topics.textContent.includes('MCP'));
  assert.ok(!byId.tools.textContent.includes('MCP'), 'MCP 是话题，不该出现在工具组');
});

test('信源面板能打开并渲染出表格与健康度', () => {
  // 这条就是为那个 bug 写的：面板曾经一点就抛 TypeError，整块打不开。
  const byId = runUi(data);
  const btn = byId.views.findAll((n) => n.tagName === 'BUTTON')
    .find((n) => n.textContent.includes('信源与健康度'));
  assert.ok(btn, '侧栏要有信源入口');

  btn.click();

  const table = byId.panel.find((n) => n.tagName === 'TABLE');
  assert.ok(table, '面板要渲染出表格');
  const text = byId.panel.textContent;
  assert.ok(text.includes('某博客') && text.includes('某论坛'), '每个源都要有一行');
  assert.ok(text.includes('说明一'), '源的说明要展示');
  assert.ok(text.includes('正常'), '健康的源标正常');
  assert.ok(text.includes('失败 9 次'), '失败次数要如实展示');
  assert.equal(byId.panel.classList.has('hidden'), false, '面板要可见');
  assert.equal(byId.stream.classList.has('hidden'), true, '打开面板时条目流要隐藏');
});

test('再点一次信源入口会切回条目流', () => {
  const byId = runUi(data);
  const btn = byId.views.findAll((n) => n.tagName === 'BUTTON')
    .find((n) => n.textContent.includes('信源与健康度'));
  btn.click();
  const btn2 = byId.views.findAll((n) => n.tagName === 'BUTTON')
    .find((n) => n.textContent.includes('信源与健康度'));
  btn2.click();
  assert.equal(byId.stream.classList.has('hidden'), false);
  assert.equal(byId.panel.classList.has('hidden'), true);
});
