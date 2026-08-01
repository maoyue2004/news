const HTML = __AI_NEWS_HTML__;
const TINKER_HTML = __TINKER_HTML__;

const CREATE_READER_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS reader_state (
  user_email TEXT NOT NULL,
  item_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_email, item_id)
)`;

const SELECT_STATE = `
SELECT item_id, is_read, is_starred
FROM reader_state
WHERE user_email = ?
ORDER BY item_id`;

const UPSERT_STATE = `
INSERT INTO reader_state (
  user_email, item_id, is_read, is_starred, updated_at
) VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 0), CURRENT_TIMESTAMP)
ON CONFLICT(user_email, item_id) DO UPDATE SET
  is_read = COALESCE(?, reader_state.is_read),
  is_starred = COALESCE(?, reader_state.is_starred),
  updated_at = CURRENT_TIMESTAMP`;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function authenticatedEmail(request) {
  const value = request.headers.get('oai-authenticated-user-email');
  return value ? value.trim().toLowerCase() : '';
}

function isValidItemId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

async function ensureSchema(db) {
  await db.prepare(CREATE_READER_STATE_TABLE).run();
}

async function readState(db, email) {
  const result = await db.prepare(SELECT_STATE).bind(email).all();
  const read = [];
  const starred = [];
  for (const row of result.results || []) {
    if (row.is_read) read.push(row.item_id);
    if (row.is_starred) starred.push(row.item_id);
  }
  return { read, starred };
}

function validateChanges(payload) {
  if (!payload || !Array.isArray(payload.changes)) {
    return { error: 'changes must be an array' };
  }
  if (payload.changes.length > 500) {
    return { error: 'at most 500 changes are allowed per request' };
  }

  const changes = [];
  for (const change of payload.changes) {
    if (!change || !isValidItemId(change.id)) {
      return { error: 'every change needs a valid id' };
    }
    const hasRead = Object.prototype.hasOwnProperty.call(change, 'read');
    const hasStarred = Object.prototype.hasOwnProperty.call(change, 'starred');
    if (!hasRead && !hasStarred) {
      return { error: 'every change must include read or starred' };
    }
    if (hasRead && typeof change.read !== 'boolean') {
      return { error: 'read must be a boolean' };
    }
    if (hasStarred && typeof change.starred !== 'boolean') {
      return { error: 'starred must be a boolean' };
    }
    changes.push({
      id: change.id,
      read: hasRead ? change.read : null,
      starred: hasStarred ? change.starred : null,
    });
  }
  return { changes };
}

async function handleState(request, env) {
  const email = authenticatedEmail(request);
  if (!email) return json({ error: 'Sign in with ChatGPT to sync reading state.' }, 401);
  if (!env.DB) return json({ error: 'Server storage is unavailable.' }, 503);

  await ensureSchema(env.DB);

  if (request.method === 'GET') {
    return json(await readState(env.DB, email));
  }

  if (request.method !== 'PUT') {
    return json(
      { error: 'Method Not Allowed' },
      405,
      { allow: 'GET, PUT' },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const validated = validateChanges(payload);
  if (validated.error) return json({ error: validated.error }, 400);
  if (validated.changes.length === 0) return json({ ok: true, applied: 0 });

  const statements = validated.changes.map((change) => {
    const read = change.read === null ? null : Number(change.read);
    const starred = change.starred === null ? null : Number(change.starred);
    return env.DB.prepare(UPSERT_STATE).bind(
      email,
      change.id,
      read,
      starred,
      read,
      starred,
    );
  });
  await env.DB.batch(statements);

  return json({ ok: true, applied: statements.length });
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state') {
      try {
        return await handleState(request, env);
      } catch (error) {
        console.error('reader state request failed', error);
        return json({ error: 'Unable to sync reading state right now.' }, 500);
      }
    }

    if (url.pathname === '/tinker' || url.pathname === '/tinker/' || url.pathname === '/tinker.html') {
      if (!TINKER_HTML) return new Response('Not Found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : TINKER_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    return new Response(request.method === 'HEAD' ? null : HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      },
    });
  },
};

export default worker;
