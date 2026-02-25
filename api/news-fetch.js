// api/news-fetch.js v2
// BBC Russian = якорь. Берём топ-новости BBC, ищем то же событие у остальных.
// 4 лагеря: Украина, Россия, Запад (BBC+DW), Китай (Синьхуа)
// Хранит первый абзац (excerpt) из RSS для каждого источника.

module.exports = async function handler(req, res) {
  // ВРЕМЕННО ОТКЛЮЧЕНО для теста — после теста раскомментируйте!
   const authHeader = req.headers['authorization'];
   const cronSecret = process.env.CRON_SECRET;
   if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
     return res.status(401).json({ error: 'Unauthorized' });
   }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // ── RSS-источники по лагерям ──
  const ANCHOR_FEED = { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', camp: 'west' };

  const OTHER_FEEDS = [
    // Запад (второй западный — для подстраховки, если BBC не хватит)
    { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', camp: 'west' },
    // Украина
    { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rus/rss/', camp: 'ukraine' },
    { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss', camp: 'ukraine' },
    // Россия
    { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', camp: 'russia' },
    { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', camp: 'russia' },
    // Китай
    { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', camp: 'china' }
  ];

  // ── Парсинг RSS ──
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
            excerpt: desc.substring(0, 500) // первый абзац / описание
          });
        }
      }
    } catch (e) {
      console.log('Feed error (' + feed.name + '):', e.message);
    }
    return articles;
  }

  try {
    // ── Шаг 1: Парсим BBC (якорь) ──
    var bbcArticles = await fetchFeed(ANCHOR_FEED);
    if (bbcArticles.length < 3) {
      return res.status(200).json({ ok: false, message: 'BBC feed too small', count: bbcArticles.length });
    }

    // ── Шаг 2: Парсим остальные ──
    var otherArticles = { ukraine: [], russia: [], west: [], china: [] };
    for (var feed of OTHER_FEEDS) {
      var arts = await fetchFeed(feed);
      for (var a of arts) {
        otherArticles[a.camp].push(a);
      }
    }

    var stats = {
      bbc: bbcArticles.length,
      ukraine: otherArticles.ukraine.length,
      russia: otherArticles.russia.length,
      west: otherArticles.west.length,
      china: otherArticles.china.length
    };
    var total = stats.bbc + stats.ukraine + stats.russia + stats.west + stats.china;

    // ── Шаг 3: Формируем промпт для Claude ──
    function formatList(arr) {
      return arr.map(function(a, i) {
        return i + '. [' + a.source + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');
    }

    var prompt = `ЯКОРНЫЕ НОВОСТИ (BBC Russian — это главный ориентир):
${formatList(bbcArticles)}

=== 🇺🇦 УКРАИНСКИЕ СМИ ===
${formatList(otherArticles.ukraine)}

=== 🇷🇺 РОССИЙСКИЕ СМИ ===
${formatList(otherArticles.russia)}

=== 🌍 ЗАПАДНЫЕ СМИ (кроме BBC) ===
${formatList(otherArticles.west)}

=== 🇨🇳 КИТАЙСКИЕ СМИ ===
${formatList(otherArticles.china)}`;

    var claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: `Ты — редактор новостной ленты «Тихая гавань» для русскоязычных людей 50+ за рубежом.

КОНЦЕПЦИЯ: Одно событие — четыре взгляда. Читатель видит новость глазами Украины, России, Запада и Китая. Это инструмент критического мышления.

АЛГОРИТМ:
1. Посмотри на BBC (это якорь) — выбери 5-6 ГЛАВНЫХ мировых событий.
2. Для КАЖДОГО события найди статью об этом КОНКРЕТНОМ событии у каждого из 4 лагерей.
3. Если хотя бы один лагерь НЕ написал о событии — ПРОПУСТИ это событие.
4. Оставь только те события, которые освещены ВСЕМИ четырьмя лагерями.

СТРОГИЕ ПРАВИЛА:
- Ровно 4 источника на каждую новость: west + ukraine + russia + china
- ОДНО И ТО ЖЕ конкретное событие во всех четырёх
- Максимум 2 новости про Россию/Украину, остальные — мировые
- Headline и summary — на русском, нейтрально, только факты
- Для каждого источника: perspective, name, title (заголовок на русском), excerpt (первый абзац/описание из RSS, КАК ЕСТЬ — не переписывать), url

JSON (без markdown, без \`\`\`):
[
  {
    "headline": "Нейтральный заголовок события",
    "summary": "2-3 предложения. Факты без оценок.",
    "topic_tag": "мир/политика/экономика/конфликт/дипломатия/общество",
    "sources": [
      { "perspective": "west", "name": "BBC Russian", "title": "Заголовок", "excerpt": "Первый абзац из RSS как есть", "url": "https://..." },
      { "perspective": "ukraine", "name": "УНИАН", "title": "Заголовок", "excerpt": "Первый абзац из RSS как есть", "url": "https://..." },
      { "perspective": "russia", "name": "ТАСС", "title": "Заголовок", "excerpt": "Первый абзац из RSS как есть", "url": "https://..." },
      { "perspective": "china", "name": "Синьхуа", "title": "Заголовок", "excerpt": "Первый абзац из RSS как есть", "url": "https://..." }
    ]
  }
]

ВАЖНО про excerpt: скопируй описание статьи из RSS ДОСЛОВНО, без изменений. Это оригинальный текст источника. Если описание на украинском — оставь на украинском. Не переписывай и не суммаризируй.`,
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
      return res.status(500).json({ error: 'Failed to parse Claude response', raw: claudeText.substring(0, 400) });
    }

    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return res.status(500).json({ error: 'Claude returned no items' });
    }

    // ── Шаг 4: Валидация и сохранение ──
    var today = new Date().toISOString().split('T')[0];
    var saved = 0;
    var required = ['west', 'ukraine', 'russia', 'china'];

    for (var item of newsItems) {
      if (!item.sources || item.sources.length < 4) continue;
      var perspectives = item.sources.map(function(s) { return s.perspective; });
      var hasAll = required.every(function(r) { return perspectives.includes(r); });
      if (!hasAll) continue;
      if (new Set(perspectives).size < 4) continue;

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
          topic_tag: item.topic_tag || 'мир'
        })
      });

      if (insertResp.ok) saved++;
    }

    return res.status(200).json({
      ok: true,
      date: today,
      feeds: stats,
      total_articles: total,
      news_saved: saved
    });

  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
