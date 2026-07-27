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

  function applyFilter(items, opts) {
    var q = (opts.query || '').trim().toLowerCase();
    return items.filter(function (it) {
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
    formatDayLabel: formatDayLabel,
    itemBadges: itemBadges,
    safeUrl: safeUrl,
  };
})();
