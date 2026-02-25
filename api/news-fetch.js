// api/news-fetch.js v3
// УНИАН = якорь. Темы дня, не конкретные события.
// 4 лагеря: Запад (BBC+DW), Украина (УНИАН+УП), Россия (ТАСС+РИА), Китай (Синьхуа)
// Сохраняет как draft — публикация через админку.

module.exports = async function handler(req, res) {
  // ВРЕМЕННО ОТКЛЮЧЕНО для теста — после теста раскомментируйте!
  // const authHeader = req.headers['authorization'];
  // const cronSecret = process.env.CRON_SECRET;
  // if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // ── RSS-источники ──
  const ANCHOR = { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss', camp: 'ukraine' };

  const FEEDS = [
    { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rus/rss/', camp: 'ukraine' },
    { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', camp: 'west' },
    { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', camp: 'west' },
    { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', camp: 'russia' },
    { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', camp: 'russia' },
    { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', camp: 'china' }
  ];

  async function fetchFeed(feed) {
    var articles = [];
    try {
      var resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'TikhayaGavan/1.0 NewsBot' },
        signal: AbortSignal.timeout(12000)
      });
      if (!resp.ok) return articles;
      var xml = await resp.text();
      var items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
      for (var i = 0; i < Math.min(items.length, 25); i++) {
        var titleMatch = items[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        var linkMatch = items[i].match(/<link[^>]*>([\s\S]*?)<\/link>/i);
        var descMatch = items[i].match(/<description[^>]*>([\s\S]*?)<\/description>/i);
        var title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
        var link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
        var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim() : '';
        if (title) {
          articles.push({ camp: feed.camp, source: feed.name, title: title, url: link, excerpt: desc.substring(0, 500) });
        }
      }
    } catch (e) {
      console.log('Feed error (' + feed.name + '):', e.message);
    }
    return articles;
  }

  try {
    // ── Шаг 1: Парсим УНИАН (якорь) ──
    var anchorArticles = await fetchFeed(ANCHOR);
    if (anchorArticles.length < 3) {
      return res.status(200).json({ ok: false, message: 'УНИАН feed too small', count: anchorArticles.length });
    }

    // ── Шаг 2: Парсим остальные ──
    var pool = { ukraine: [], west: [], russia: [], china: [] };
    for (var feed of FEEDS) {
      var arts = await fetchFeed(feed);
      for (var a of arts) {
        pool[a.camp].push(a);
      }
    }

    var stats = {
      anchor: anchorArticles.length,
      ukraine: pool.ukraine.length,
      west: pool.west.length,
      russia: pool.russia.length,
      china: pool.china.length
    };
    var total = stats.anchor + stats.ukraine + stats.west + stats.russia + stats.china;

    // ── Шаг 3: Claude — темы дня ──
    function formatList(arr, label) {
      return arr.map(function(a, i) {
        return i + '. [' + a.source + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');
    }

    var prompt = `ЯКОРНЫЕ НОВОСТИ (УНИАН — главный ориентир):
${formatList(anchorArticles, 'A')}

=== УКРАИНСКИЕ СМИ (дополнительно) ===
${formatList(pool.ukraine, 'U')}

=== ЗАПАДНЫЕ СМИ ===
${formatList(pool.west, 'W')}

=== РОССИЙСКИЕ СМИ ===
${formatList(pool.russia, 'R')}

=== КИТАЙСКИЕ СМИ ===
${formatList(pool.china, 'C')}`;

    var claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `Ты — редактор новостной ленты «Тихая гавань» для русскоязычных людей 50+ за рубежом (в основном Канада, Израиль, Германия, США).

КОНЦЕПЦИЯ: «Темы дня — четыре взгляда». Мы берём главные ТЕМЫ дня и показываем, как каждый лагерь СМИ освещает эту тему. Не обязательно одно и то же событие — главное, что тема одна (например, «Мексика», «Иран», «Зимняя Олимпиада»).

АЛГОРИТМ:
1. Посмотри на УНИАН (якорь) — определи 4-6 главных ТЕМ дня.
2. Тема = страна, регион или глобальная проблема (Украина, Иран, США, экономика ЕС, Ближний Восток, Олимпиада и т.д.)
3. Для каждой темы найди ОДНУ самую подходящую статью от каждого из 4 лагерей.
4. Статьи не обязаны быть про одно событие — они должны быть ПРО ОДНУ ТЕМУ.

ЛАГЕРИ (ровно 4 источника на тему):
- "west" — BBC Russian или DW Russian
- "ukraine" — УНИАН или Украинская правда
- "russia" — ТАСС или РИА Новости
- "china" — Синьхуа

ПРАВИЛА:
- 4 или 6 тем (чётное число). Если тем мало — 4. Если много — 6.
- Максимум 2 темы про Россию/Украину напрямую. Остальные — мировые.
- headline = название темы, коротко: «Мексика и США», «Ядерная программа Ирана», «Зимняя Олимпиада»
- summary = нейтральный анонс 2-3 предложения, только факты
- excerpt = СКОПИРУЙ описание статьи из RSS ДОСЛОВНО, без изменений. Это оригинальный текст источника.
- Всё на русском. Если заголовок на другом языке — переведи.

JSON (без markdown, без \`\`\`):
[
  {
    "headline": "Короткое название темы",
    "summary": "Нейтральный анонс 2-3 предложения.",
    "topic_tag": "мир/политика/экономика/конфликт/дипломатия/общество/спорт",
    "sources": [
      { "perspective": "west", "name": "BBC Russian", "title": "Заголовок", "excerpt": "Текст из RSS", "url": "https://..." },
      { "perspective": "ukraine", "name": "УНИАН", "title": "Заголовок", "excerpt": "Текст из RSS", "url": "https://..." },
      { "perspective": "russia", "name": "ТАСС", "title": "Заголовок", "excerpt": "Текст из RSS", "url": "https://..." },
      { "perspective": "china", "name": "Синьхуа", "title": "Заголовок", "excerpt": "Текст из RSS", "url": "https://..." }
    ]
  }
]`,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    var claudeData = await claudeResp.json();
    var claudeText = '';
    if (claudeData.content) {
      for (var block of claudeData.content) {
        if (block.type === 'text') claudeText += block.text;
      }
    }

    var newsItems;
    try {
      var cleanJson = claudeText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      newsItems = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.log('Parse error:', parseErr.message);
      return res.status(500).json({ error: 'Parse failed', raw: claudeText.substring(0, 400) });
    }

    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return res.status(500).json({ error: 'No items from Claude' });
    }

    // ── Шаг 4: Сохраняем как draft ──
    var today = new Date().toISOString().split('T')[0];
    var saved = 0;
    var skipped = [];
    var required = ['west', 'ukraine', 'russia', 'china'];

    for (var item of newsItems) {
      if (!item.sources || item.sources.length < 4) {
        skipped.push({ headline: item.headline, reason: 'sources < 4', count: item.sources ? item.sources.length : 0 });
        continue;
      }
      var perspectives = item.sources.map(function(s) { return s.perspective; });
      var hasAll = required.every(function(r) { return perspectives.includes(r); });
      if (!hasAll) {
        skipped.push({ headline: item.headline, reason: 'missing perspectives', has: perspectives, needs: required });
        continue;
      }

      var insertResp = await fetch(supabaseUrl + '/rest/v1/news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          date: today,
          headline: item.headline,
          summary: item.summary,
          sources: item.sources,
          topic_tag: item.topic_tag || 'мир',
          status: 'draft'
        })
      });

      if (insertResp.ok) {
        saved++;
      } else {
        var errText = await insertResp.text();
        skipped.push({ headline: item.headline, reason: 'supabase error', status: insertResp.status, error: errText.substring(0, 200) });
      }
    }

    return res.status(200).json({
      ok: true,
      date: today,
      feeds: stats,
      total_articles: total,
      claude_items: newsItems.length,
      drafts_saved: saved,
      skipped: skipped,
      debug_claude_raw: claudeText.substring(0, 500),
      message: 'Темы сохранены как черновики. Откройте /admin-news для модерации.'
    });

  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
