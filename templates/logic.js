/* 纯逻辑，不碰 DOM。挂在 window.ReaderLogic 上，供 ui.js 与单测共用。 */
(function () {
  var TYPE_ORDER = ['blog', 'newsletter', 'lab', 'media', 'community', 'podcast', 'video'];
  var TYPE_LABELS = {
    blog: '博客', newsletter: 'Newsletter', lab: '实验室',
    media: '媒体', community: '社区', podcast: '播客', video: '视频',
  };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 日文件由 Claude 逐条手写，type 字段可能缺失或写错（不在 TYPE_ORDER 里）。
  // 这类条目不能被静默丢弃 —— 否则 computeStats（在过滤前统计）报的总数会比
  // 实际渲染出来的条目数多，用户看到顶栏「23 条」但正文只有 20 条，且毫无痕迹。
  // 统一归进一个「其他」桶，排在已知类型后面。
  var OTHER_LABEL = '其他';

  function groupByType(items) {
    var buckets = {};
    var otherKey = '__other__';
    items.forEach(function (it) {
      var key = TYPE_ORDER.indexOf(it.type) !== -1 ? it.type : otherKey;
      (buckets[key] = buckets[key] || []).push(it);
    });
    function toGroup(t) {
      var list = buckets[t].slice().sort(function (a, b) {
        return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      });
      return { type: t, label: t === otherKey ? OTHER_LABEL : TYPE_LABELS[t], items: list };
    }
    var groups = TYPE_ORDER
      .filter(function (t) { return buckets[t] && buckets[t].length; })
      .map(toGroup);
    if (buckets[otherKey] && buckets[otherKey].length) {
      groups.push(toGroup(otherKey));
    }
    return groups;
  }

  // opts.source：按信源名精确筛选，undefined/null 表示不筛选（与不传这个
  // 字段的旧调用方完全等价）。和 filter/query 取交集，顺序上先判断 source
  // 最省事——不匹配就不用再算后面的已读/标星/搜索。
  function applyFilter(items, opts) {
    var q = (opts.query || '').trim().toLowerCase();
    return items.filter(function (it) {
      if (opts.source != null && it.source !== opts.source) return false;
      if (opts.filter === 'unread' && opts.readSet.has(it.id)) return false;
      if (opts.filter === 'starred' && !opts.starSet.has(it.id)) return false;
      if (!q) return true;
      var hay = [it.titleZh, it.summaryZh, it.titleOriginal, it.source].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function computeStats(items, readSet, starSet) {
    var unread = 0, starred = 0;
    items.forEach(function (it) {
      if (!readSet.has(it.id)) unread++;
      if (starSet.has(it.id)) starred++;
    });
    return { total: items.length, unread: unread, starred: starred };
  }

  // 条目 meta 行的徽标：brief（播客/视频只看官方简介，未收听/未观看）与
  // thin（抓不到正文，中文摘要只能依据标题写）各自独立判断，可能同时出现。
  // 不碰 DOM，纯字符串拼接，抽到这里方便单测覆盖（ui.js 里的渲染只是调用它）。
  function itemBadges(it) {
    var out = '';
    if (it.brief) {
      out += '<span class="brief-note">' + (it.type === 'video' ? '▶' : '🎧') + ' 基于官方简介，未收听</span>';
    }
    if (it.thin) {
      out += '<span class="brief-note">⚠ 仅标题</span>';
    }
    return out;
  }

  // href 白名单：条目的 url 一路从远端 RSS feed 流进来，属于不可信数据。
  // 只放行 http/https，其余（javascript:、data:、vbscript:、file: 等，以及
  // 解析失败的）一律换成 '#'，防止 <a href="..."> 被注入伪协议后点击执行脚本。
  // 用 new URL() 解析后看 protocol：WHATWG URL 解析规则本身就会剥离输入两端的
  // C0 控制符/空白、以及内嵌的 tab（\t）、换行（\n）、回车（\r），并把 scheme
  // 归一化成小写，所以 'JaVaScRiPt:x'、'  javascript:x'、'java\tscript:x'、
  // 'java\nscript:x' 这些绕过写法解析出来的 protocol 都是规整的 'javascript:'，
  // 不需要自己再手写剥离逻辑。
  function safeUrl(url) {
    try {
      var u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '#';
    } catch (e) {
      return '#';
    }
  }

  // 分组标题下的信源分布：统计当前实际展示的条目（调用方已经把筛选/搜索
  // 应用完了，这里只管数数），按条数降序、条数相同按信源名升序排稳定。
  // 超过 topN 个信源时，多出来的合并成一条「其他」，放在最后。
  // 如果指定了 pinned（信源名），该信源永远出现在结果里，不会被并入「其他」。
  function sourceBreakdown(items, topN, pinned) {
    topN = topN == null ? 5 : topN;
    // 如果 pinned 是 undefined/null/空串，就当作没有 pin
    pinned = (pinned == null || pinned === '') ? undefined : pinned;
    var counts = {};
    items.forEach(function (it) {
      counts[it.source] = (counts[it.source] || 0) + 1;
    });
    var list = Object.keys(counts).map(function (source) {
      return { source: source, count: counts[source] };
    }).sort(function (a, b) {
      return b.count - a.count || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
    });
    if (list.length <= topN) return list;
    var head = list.slice(0, topN);
    var rest = list.slice(topN);

    // 检查 pinned 是否在 rest 中（即排名超过topN但存在）
    var pinnedItem = null;
    if (pinned) {
      for (var i = 0; i < rest.length; i++) {
        if (rest[i].source === pinned) {
          pinnedItem = rest[i];
          rest = rest.slice(0, i).concat(rest.slice(i + 1));
          break;
        }
      }
    }

    if (pinnedItem) {
      head.push(pinnedItem);
    }

    // 如果 rest 还有剩余，合并成「其他」
    if (rest.length > 0) {
      var restCount = rest.reduce(function (n, x) { return n + x.count; }, 0);
      head.push({ source: OTHER_LABEL, count: restCount, isOther: true });
    }

    return head;
  }

  // 信源管理页用：今日与最近窗口（days 覆盖的全部天数）里各信源的条数。
  // days[0] 是最新一天（与 ui.js 里 today 的取法一致），today 只统计它；
  // window 统计传入的全部 days。days 为空时两者都返回空对象。
  function countsBySource(days) {
    var today = {};
    var windowCounts = {};
    days.forEach(function (day, idx) {
      (day.items || []).forEach(function (it) {
        windowCounts[it.source] = (windowCounts[it.source] || 0) + 1;
        if (idx === 0) today[it.source] = (today[it.source] || 0) + 1;
      });
    });
    return { today: today, window: windowCounts };
  }

  // 导出/导入的数据格式。version 2 起同时带已读（version 1 的文件只有 items）。
  //
  // 标星导出条目全文（换设备后能直接看清收藏了什么），已读只导出 id 列表——
  // 已读动辄上千条，存全文没有意义，而且 id 本身就是 URL 指纹，稳定可比。
  //
  // readSet 原样导出，不与 items 取交集：localStorage 里会留着 30 天窗口之外
  // 已经不在页面数据里的 id，过滤掉就不是无损备份了。
  var STATE_EXPORT_VERSION = 2;

  function buildStateExport(items, readSet, starSet, exportedAt) {
    return {
      exportedAt: exportedAt,
      version: STATE_EXPORT_VERSION,
      items: items.filter(function (it) { return starSet.has(it.id); }),
      read: [].slice.call(readSet ? Array.from(readSet) : []),
    };
  }

  function isUsableId(x) {
    return typeof x === 'string' && x !== '';
  }

  // 返回 { ok: true, starIds, readIds } 或 { ok: false, error }。
  // 单条脏数据（缺 id、id 不是字符串）跳过即可，不该让整份文件导入失败；
  // 但顶层字段类型不对说明文件本身是坏的，报错，不能静默当成空——
  // 静默会让用户以为导入成功了，实际一条都没进去。
  function parseStateImport(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '文件格式不对，顶层不是一个对象' };
    }
    if (!Array.isArray(parsed.items)) {
      return { ok: false, error: '文件格式不对，缺少 items 数组' };
    }
    // read 缺失是合法的：version 1 的旧备份就没有这个字段。
    if (parsed.read !== undefined && !Array.isArray(parsed.read)) {
      return { ok: false, error: '文件格式不对，read 不是数组' };
    }
    var starIds = [];
    parsed.items.forEach(function (it) {
      if (it && isUsableId(it.id)) starIds.push(it.id);
    });
    var readIds = (parsed.read || []).filter(isUsableId);
    return { ok: true, starIds: starIds, readIds: readIds };
  }

  function formatDayLabel(dateStr, todayStr) {
    var diff = Math.round((Date.parse(todayStr + 'T00:00:00Z') - Date.parse(dateStr + 'T00:00:00Z')) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    var d = new Date(dateStr + 'T00:00:00Z');
    return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + WEEKDAYS[d.getUTCDay()];
  }

  window.ReaderLogic = {
    TYPE_ORDER: TYPE_ORDER,
    TYPE_LABELS: TYPE_LABELS,
    groupByType: groupByType,
    applyFilter: applyFilter,
    computeStats: computeStats,
    sourceBreakdown: sourceBreakdown,
    countsBySource: countsBySource,
    buildStateExport: buildStateExport,
    parseStateImport: parseStateImport,
    formatDayLabel: formatDayLabel,
    itemBadges: itemBadges,
    safeUrl: safeUrl,
  };
})();
