// api/news-fetch.js
// Cron-задача: собирает RSS → Claude группирует в 6 новостей → сохраняет в Supabase
// Вызывается автоматически раз в день через Vercel Cron

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
  const RSS_FEEDS = {
    western: [
      { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
      { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all' },
      { name: 'Медуза', url: 'https://meduza.io/rss/news' },
      { name: 'Euronews Russian', url: 'https://ru.euronews.com/rss' }
    ],
    ukrainian: [
      { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rss/' },
      { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss' }
    ],
    russian: [
      { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml' },
      { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml' },
      { name: 'Лента.ру', url: 'https://lenta.ru/rss' }
    ]
  };

  try {
    // ── Шаг 1: Собираем RSS ──
    var allArticles = [];

    for (var perspective of Object.keys(RSS_FEEDS)) {
      for (var feed of RSS_FEEDS[perspective]) {
        try {
          var feedResp = await fetch(feed.url, {
            headers: { 'User-Agent': 'TikhayaGavan/1.0 NewsBot' },
            signal: AbortSignal.timeout(10000)
          });
          if (!feedResp.ok) continue;
          var xml = await feedResp.text();

          // Простой XML-парсинг (без зависимостей)
          var items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
          for (var i = 0; i < Math.min(items.length, 15); i++) {
            var titleMatch = items[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            var linkMatch = items[i].match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            var descMatch = items[i].match(/<description[^>]*>([\s\S]*?)<\/description>/i);

            var title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim() : '';

            if (title) {
              allArticles.push({
                perspective: perspective,
                source: feed.name,
                title: title,
                url: link,
                description: desc.substring(0, 300)
              });
            }
          }
        } catch (feedErr) {
          console.log('Feed error (' + feed.name + '):', feedErr.message);
        }
      }
    }

    if (allArticles.length < 5) {
      return res.status(200).json({ ok: false, message: 'Not enough articles from RSS', count: allArticles.length });
    }

    // ── Шаг 2: Отправляем в Claude API ──
    var articlesSummary = allArticles.map(function(a) {
      return '[' + a.perspective.toUpperCase() + ' / ' + a.source + '] ' + a.title + (a.description ? ' — ' + a.description : '') + ' | URL: ' + a.url;
    }).join('\n');

    var claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: `Ты — редактор новостной ленты для русскоязычной аудитории 50+ за рубежом.

Твоя задача: из списка статей от разных источников выбери 6 главных МИРОВЫХ событий дня.

СТРОГИЕ ПРАВИЛА:

1. РАЗНООБРАЗИЕ ТЕМ — это главный приоритет!
   - Новости должны охватывать РАЗНЫЕ регионы мира: Ближний Восток, Азия, Европа, Северная и Южная Америка, Африка — не только Россию и Украину.
   - Максимум 2 новости из 6 могут быть напрямую связаны с Россией или Украиной. Остальные 4 должны быть о других мировых событиях.
   - Ищи новости про: США, Иран, Китай, Ближний Восток, Латинскую Америку, ЕС, Африку, Азию, климат, экономику, технологии.

2. ТРИ ИСТОЧНИКА — строго по одному от КАЖДОЙ группы:
   - Ровно ОДИН источник с меткой WESTERN (западный: BBC Russian, DW Russian, Медуза, Euronews)
   - Ровно ОДИН источник с меткой UKRAINIAN (украинский: Украинская правда, УНИАН)
   - Ровно ОДИН источник с меткой RUSSIAN (российский: ТАСС, РИА Новости, Лента.ру)
   - ЗАПРЕЩЕНО: два источника из одной группы. Если нет статьи из какой-то группы — НЕ включай это событие.

3. ВСЁ НА РУССКОМ ЯЗЫКЕ:
   - Заголовок (headline) и анонс (summary) — только на русском.
   - Если оригинальный заголовок статьи на другом языке — переведи его на русский.

4. НЕЙТРАЛЬНОСТЬ:
   - Анонс должен быть нейтральным — только факты, без оценок, комментариев и эмоций.
   - Не принимай сторону ни одного из источников.

Ответ СТРОГО в формате JSON (без markdown, без \`\`\`):
[
  {
    "headline": "Заголовок события на русском",
    "summary": "Краткий нейтральный анонс 2-3 предложения на русском.",
    "topic_tag": "одно слово-тег: мир/политика/экономика/конфликт/дипломатия/общество",
    "sources": [
      { "perspective": "western", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." },
      { "perspective": "ukrainian", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." },
      { "perspective": "russian", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." }
    ]
  }
]

Верни ровно 6 объектов. Каждый объект — ровно 3 источника (western, ukrainian, russian). Только JSON, ничего больше.`,
        messages: [
          { role: 'user', content: 'Вот статьи за сегодня:\n\n' + articlesSummary }
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

    // Парсим JSON из ответа Claude
    var newsItems;
    try {
      // Убираем возможные markdown-обёртки
      var cleanJson = claudeText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      newsItems = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.log('Claude response parse error:', parseErr.message);
      console.log('Raw response:', claudeText.substring(0, 500));
      return res.status(500).json({ error: 'Failed to parse Claude response', raw: claudeText.substring(0, 300) });
    }

    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return res.status(500).json({ error: 'Claude returned no news items' });
    }

    // ── Шаг 3: Сохраняем в Supabase ──
    var today = new Date().toISOString().split('T')[0];
    var saved = 0;

    for (var item of newsItems) {
      // Валидация: должно быть ровно 3 источника с РАЗНЫМИ перспективами
      if (!item.sources || item.sources.length < 3) continue;
      var perspectives = item.sources.map(function(s) { return s.perspective; });
      if (!perspectives.includes('western') || !perspectives.includes('ukrainian') || !perspectives.includes('russian')) continue;
      // Проверка: нет дубликатов перспектив
      var uniqueP = new Set(perspectives);
      if (uniqueP.size < 3) continue;

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

    return res.status(200).json({ ok: true, date: today, articles_collected: allArticles.length, news_saved: saved });

  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
