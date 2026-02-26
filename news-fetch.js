// api/news-fetch.js v4
// УНИАН = якорь. Темы дня, не конкретные события.
// 4 лагеря: Запад (BBC+DW, запасные: Медуза, Медиазона), Украина (УНИАН+УП),
//           Россия (ТАСС+РИА), Глобальный Юг (Синьхуа, запасной: Al Jazeera)
// Публикует автоматически (status: published).

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // ── RSS-источники ──
  const ANCHOR = { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss', camp: 'ukraine', lang: 'ru' };

  const FEEDS = [
    { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rus/rss/', camp: 'ukraine', lang: 'ru' },
    { name: 'Укрінформ', url: 'https://www.ukrinform.ru/rss/block-lastnews', camp: 'ukraine', lang: 'ru' },
    { name: 'НВ', url: 'https://nv.ua/rss/all.xml', camp: 'ukraine', lang: 'ru' },
    { name: 'Цензор.НЕТ', url: 'https://censor.net/includes/news_ru.xml', camp: 'ukraine', lang: 'ru' },
    { name: 'Обозреватель', url: 'https://www.obozrevatel.com/rss.xml', camp: 'ukraine', lang: 'ru' },
    { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', camp: 'west', lang: 'ru', priority: true },
    { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', camp: 'west', lang: 'ru', priority: true },
    { name: 'Медуза', url: 'https://meduza.io/rss/all', camp: 'west', lang: 'ru', priority: false },
    { name: 'Медиазона', url: 'https://zona.media/rss', camp: 'west', lang: 'ru', priority: false },
    { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', camp: 'russia', lang: 'ru' },
    { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', camp: 'russia', lang: 'ru' },
    { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', camp: 'china', lang: 'ru', priority: true },
    { name: 'Al Jazeera (англ.)', url: 'https://www.aljazeera.com/xml/rss/all.xml', camp: 'china', lang: 'en', priority: false }
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
          articles.push({
            camp: feed.camp,
            source: feed.name,
            title: title,
            url: link,
            excerpt: desc.substring(0, 500),
            lang: feed.lang,
            priority: feed.priority !== false
          });
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
      console.log('УНИАН feed small:', anchorArticles.length, '- continuing with other sources');
    }

    // ── Шаг 2: Парсим остальные ──
    var pool = { ukraine: [], west: [], russia: [], china: [] };
    for (var feed of FEEDS) {
      var arts = await fetchFeed(feed);
      for (var a of arts) {
        pool[a.camp].push(a);
      }
    }

    // Проверяем общий объём
    if (anchorArticles.length < 3 && pool.ukraine.length < 5) {
      return res.status(200).json({ ok: false, message: 'Not enough Ukrainian sources', anchor: anchorArticles.length, ukraine: pool.ukraine.length });
    }

    var stats = {
      ukraine: pool.ukraine.length + anchorArticles.length,
      west: pool.west.length,
      russia: pool.russia.length,
      china: pool.china.length
    };
    // Добавляем УНИАН в общий пул Украины
    for (var aa of anchorArticles) { pool.ukraine.push(aa); }
    var total = stats.ukraine + stats.west + stats.russia + stats.china;

    // ── Шаг 3: Claude — тренды дня из ВСЕХ источников ──
    function formatList(arr) {
      return arr.map(function(a, i) {
        var langTag = a.lang === 'en' ? ' [АНГЛ]' : '';
        return i + '. [' + a.source + langTag + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');
    }

    var prompt = '=== УКРАИНСКИЕ СМИ (УНИАН, Укр. правда, Укрінформ, НВ, Цензор.НЕТ, Обозреватель) ===\n' + formatList(pool.ukraine) +
      '\n\n=== ЗАПАДНЫЕ СМИ (BBC, DW, Медуза, Медиазона) ===\n' + formatList(pool.west) +
      '\n\n=== РОССИЙСКИЕ СМИ (ТАСС, РИА) ===\n' + formatList(pool.russia) +
      '\n\n=== ГЛОБАЛЬНЫЙ ЮГ (Синьхуа, Al Jazeera) ===\n' + formatList(pool.china);

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
        system: 'Ты — редактор новостной ленты «Тихая гавань» для русскоязычных людей 50+ за рубежом (в основном Канада, Израиль, Германия, США).\n\n' +
          'КОНЦЕПЦИЯ: «Темы дня — четыре взгляда». Находим ТРЕНДОВЫЕ темы дня (о которых пишут несколько лагерей) и показываем, как каждый лагерь их освещает.\n\n' +
          'АЛГОРИТМ:\n' +
          '1. Просмотри ВСЕ источники от всех 4 лагерей.\n' +
          '2. Найди темы, которые упоминаются в НЕСКОЛЬКИХ лагерях — это и есть тренды дня.\n' +
          '3. Тема, о которой пишут 3-4 лагеря — важнее темы, о которой пишет только 1.\n' +
          '4. Для каждой темы выбери по ОДНОЙ лучшей статье от каждого из 4 лагерей.\n\n' +
          'ПОСТОЯННАЯ ТЕМА №1 — «Война в Украине»:\n' +
          '- Эта тема ВСЕГДА присутствует первой, каждый день, без исключений.\n' +
          '- headline всегда = «Война в Украине»\n' +
          '- Сюда входит ВСЁ: обстрелы, фронт, жертвы, переговоры о мире, действия Трампа/Зеленского/Путина в контексте войны, санкции, поставки оружия.\n' +
          '- «СВО», «Специальная военная операция», «конфликт на Украине» = «Война в Украине».\n' +
          '- topic_tag для этой темы = «война»\n\n' +
          'ОСТАЛЬНЫЕ 3-5 ТЕМ — определяются по трендам. ПРИОРИТЕТЫ АУДИТОРИИ (от высшего к низшему):\n' +
          '1. Трамп / политика США — влияет на всех\n' +
          '2. Израиль / Ближний Восток — большая русскоязычная община\n' +
          '3. Европа (Германия, Франция, ЕС) — миграция, экономика, политика\n' +
          '4. Громкие мировые события (саммиты, катастрофы, экономика)\n' +
          '5. Остальное\n' +
          'При прочих равных — выбирай тему, которая ближе аудитории.\n\n' +
          'ЛАГЕРИ (ровно 4 источника на тему):\n' +
          '- "west" — ПРИОРИТЕТ: BBC Russian или DW Russian. Если нет — Медуза или Медиазона.\n' +
          '- "ukraine" — УНИАН, Украинская правда, Укрінформ, НВ, Цензор.НЕТ или Обозреватель\n' +
          '- "russia" — ТАСС или РИА Новости\n' +
          '- "china" — ПРИОРИТЕТ: Синьхуа. Если нет — Al Jazeera (перевести на русский).\n\n' +
          'ПРАВИЛА ПОДАЧИ:\n' +
          '- Всего 4 или 6 тем (чётное число). Первая ВСЕГДА «Война в Украине».\n' +
          '- headline = название темы коротко\n' +
          '- summary = нейтральный анонс 2-3 предложения, только факты\n' +
          '- excerpt: для русскоязычных — СКОПИРУЙ из RSS ДОСЛОВНО. Для англоязычных [АНГЛ] — ПЕРЕВЕДИ заголовок и напиши краткое изложение 2-3 предложения на русском.\n' +
          '- Всё на русском.\n\n' +
          'АНТИПРОСТРАНСТВА:\n' +
          '- НЕ включай чистую пропаганду без фактов.\n' +
          '- Российские и китайские источники подаются КАК ЕСТЬ (excerpt дословно) — читатель сам увидит разницу. Это и есть смысл «четырёх взглядов».\n' +
          '- Но если статья — только лозунги без фактов, выбери другую от того же лагеря.\n\n' +
          'JSON (без markdown, без ```):\n' +
          '[\n' +
          '  {\n' +
          '    "headline": "Война в Украине",\n' +
          '    "summary": "...",\n' +
          '    "topic_tag": "война",\n' +
          '    "sources": [\n' +
          '      { "perspective": "west", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n' +
          '      { "perspective": "ukraine", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n' +
          '      { "perspective": "russia", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n' +
          '      { "perspective": "china", "name": "...", "title": "...", "excerpt": "...", "url": "..." }\n' +
          '    ]\n' +
          '  },\n' +
          '  { "headline": "Другая тема", ... }\n' +
          ']',
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

    // ── Шаг 4: Сохраняем как published (автопубликация) ──
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
          status: 'published'
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
      published: saved,
      skipped: skipped
    });

  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
