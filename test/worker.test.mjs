import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkerSource } from '../scripts/build.mjs';

class MockStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new MockStatement(this.db, this.sql, bindings);
  }

  async run() {
    if (this.sql.includes('CREATE TABLE')) return { success: true };
    if (!this.sql.includes('INSERT INTO reader_state')) {
      throw new Error(`unexpected statement: ${this.sql}`);
    }

    const [email, id, insertRead, insertStarred, updateRead, updateStarred] = this.bindings;
    const key = `${email}\0${id}`;
    const current = this.db.rows.get(key) || {
      user_email: email,
      item_id: id,
      is_read: insertRead ?? 0,
      is_starred: insertStarred ?? 0,
    };
    if (updateRead !== null) current.is_read = updateRead;
    if (updateStarred !== null) current.is_starred = updateStarred;
    this.db.rows.set(key, current);
    return { success: true };
  }

  async all() {
    if (!this.sql.includes('SELECT item_id')) {
      throw new Error(`unexpected statement: ${this.sql}`);
    }
    const [email] = this.bindings;
    return {
      results: [...this.db.rows.values()]
        .filter((row) => row.user_email === email)
        .sort((a, b) => a.item_id.localeCompare(b.item_id)),
    };
  }
}

class MockD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

let moduleId = 0;
async function createWorker(html = '<h1>AI 信源罗盘</h1>') {
  const source = buildWorkerSource(html);
  const encoded = Buffer.from(`${source}\n// ${moduleId++}`).toString('base64');
  return (await import(`data:text/javascript;base64,${encoded}`)).default;
}

function request(path, {
  method = 'GET',
  email,
  body,
} = {}) {
  const headers = {};
  if (email) headers['oai-authenticated-user-email'] = email;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('状态接口拒绝未登录请求', async () => {
  const worker = await createWorker();
  const response = await worker.fetch(request('/api/state'), { DB: new MockD1() });
  assert.equal(response.status, 401);
});

test('已读与收藏写入 D1 后可读取，且按用户隔离', async () => {
  const worker = await createWorker();
  const DB = new MockD1();

  const write = await worker.fetch(request('/api/state', {
    method: 'PUT',
    email: 'User@Example.com',
    body: {
      changes: [
        { id: 'article-1', read: true },
        { id: 'article-2', starred: true },
      ],
    },
  }), { DB });
  assert.equal(write.status, 200);

  const first = await worker.fetch(
    request('/api/state', { email: 'user@example.com' }),
    { DB },
  );
  assert.deepEqual(await first.json(), {
    read: ['article-1'],
    starred: ['article-2'],
  });

  const second = await worker.fetch(
    request('/api/state', { email: 'other@example.com' }),
    { DB },
  );
  assert.deepEqual(await second.json(), { read: [], starred: [] });
});

test('部分更新不会覆盖同一条目的另一种状态', async () => {
  const worker = await createWorker();
  const DB = new MockD1();
  const email = 'user@example.com';

  await worker.fetch(request('/api/state', {
    method: 'PUT',
    email,
    body: { changes: [{ id: 'article-1', read: true, starred: true }] },
  }), { DB });
  await worker.fetch(request('/api/state', {
    method: 'PUT',
    email,
    body: { changes: [{ id: 'article-1', read: false }] },
  }), { DB });

  const response = await worker.fetch(request('/api/state', { email }), { DB });
  assert.deepEqual(await response.json(), {
    read: [],
    starred: ['article-1'],
  });
});

test('状态接口拒绝缺少布尔状态的脏变更', async () => {
  const worker = await createWorker();
  const response = await worker.fetch(request('/api/state', {
    method: 'PUT',
    email: 'user@example.com',
    body: { changes: [{ id: 'article-1' }] },
  }), { DB: new MockD1() });
  assert.equal(response.status, 400);
});

test('非 API 路径继续返回原页面', async () => {
  const worker = await createWorker('<h1>原页面</h1>');
  const response = await worker.fetch(request('/'), { DB: new MockD1() });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>原页面</h1>');
});
