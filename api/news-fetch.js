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
    function formatList(arr) {
      return arr.map(function(a, i) {
        var langTag = a.lang === 'en' ? ' [АНГЛ]' : '';
        return i + '. [' + a.source + langTag + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');
    }

    var prompt = 'ЯКОРНЫЕ НОВОСТИ (УНИАН — главный ориентир):\n' + formatList(anchorArticles) +
      '\n\n=== УКРАИНСКИЕ СМИ (дополнительно) ===\n' + formatList(pool.ukraine) +
      '\n\n=== ЗАПАДНЫЕ СМИ (приоритет: BBC, DW; запасные: Медуза, Медиазона) ===\n' + formatList(pool.west) +
      '\n\n=== РОССИЙСКИЕ СМИ ===\n' + formatList(pool.russia) +
      '\n\n=== ГЛОБАЛЬНЫЙ ЮГ (приоритет: Синьхуа; запасной: Al Jazeera) ===\n' + formatList(pool.china);

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
        system: 'Ты — редактор новостной ленты «Тихая гавань» для русскоязычных людей 50+ за рубежом (в основном Канада, Израиль, Германия, США).\n\nКОНЦЕПЦИЯ: «Темы дня — четыре взгляда». Берём главные ТЕМЫ дня и показываем, как каждый лагерь СМИ освещает эту тему.\n\nАЛГОРИТМ:\n1. Посмотри на УНИАН (якорь) — определи 4-6 главных ТЕМ дня.\n2. Тема = страна, регион или глобальная проблема.\n3. Для каждой темы найди ОДНУ самую подходящую статью от каждого из 4 лагерей.\n4. Статьи не обязаны быть про одно событие — они должны быть ПРО ОДНУ ТЕМУ.\n\nПРИОРИТЕТЫ:\n- Серьёзные события в Украине (обстрелы, фронт, жертвы) ВСЕГДА в приоритете — минимум одна такая тема, если есть в УНИАН.\n- Для аудитории это самая актуальная тема, не игнорируй её.\n\nЛАГЕРИ (ровно 4 источника на тему):\n- \"west\" — ПРИОРИТЕТ: BBC Russian или DW Russian. Если по теме нет статьи у BBC/DW — используй Медузу или Медиазону.\n- \"ukraine\" — УНИАН или Украинская правда\n- \"russia\" — ТАСС или РИА Новости\n- \"china\" — ПРИОРИТЕТ: Синьхуа. Если по теме нет статьи у Синьхуа — используй Al Jazeera.\n\nПРАВИЛА ПОДАЧИ:\n- 4 или 6 тем (чётное число). Если тем мало — 4. Если много — 6.\n- Максимум 2 темы про Россию/Украину напрямую. Остальные — мировые.\n- headline = название темы коротко\n- summary = нейтральный анонс 2-3 предложения, только факты\n- excerpt: для русскоязычных источников — СКОПИРУЙ описание из RSS ДОСЛОВНО. Для англоязычных (Al Jazeera [АНГЛ]) — ПЕРЕВЕДИ заголовок на русский и напиши краткое изложение (2-3 предложения своими словами на русском).\n- Всё на русском. Если заголовок на другом языке — переведи.\n\nАНТИПРОПАГАНДА:\n- НЕ включай статьи, которые являются чистой пропагандой без информационного содержания.\n- Российские и китайские источники подаются КАК ЕСТЬ (их excerpt копируется дословно) — читатель сам увидит разницу в подаче. Это и есть смысл «четырёх взглядов».\n- Но если статья не содержит фактов, а только лозунги — пропусти её и выбери другую от того же лагеря на ту же тему.\n\nJSON (без markdown, без ```):\n[\n  {\n    \"headline\": \"Короткое название темы\",\n    \"summary\": \"Нейтральный анонс 2-3 предложения.\",\n    \"topic_tag\": \"мир/политика/экономика/конфликт/дипломатия/общество/спорт\",\n    \"sources\": [\n      { \"perspective\": \"west\", \"name\": \"BBC Russian\", \"title\": \"Заголовок\", \"excerpt\": \"Текст\", \"url\": \"https://...\" },\n      { \"perspective\": \"ukraine\", \"name\": \"УНИАН\", \"title\": \"Заголовок\", \"excerpt\": \"Текст\", \"url\": \"https://...\" },\n      { \"perspective\": \"russia\", \"name\": \"ТАСС\", \"title\": \"Заголовок\", \"excerpt\": \"Текст\", \"url\": \"https://...\" },\n      { \"perspective\": \"china\", \"name\": \"Синьхуа\", \"title\": \"Заголовок\", \"excerpt\": \"Текст\", \"url\": \"https://...\" }\n    ]\n  }\n]',
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
