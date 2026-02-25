// api/news-fetch.js
// Cron-задача: собирает RSS → Claude группирует в 4-6 новостей → сохраняет в Supabase
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
  // WESTERN = западные СМИ (британские, немецкие, французские, европейские)
  // UKRAINIAN = украинские СМИ (русскоязычные версии!)
  // RUSSIAN = российские СМИ (включая оппозиционные)
  const RSS_FEEDS = {
    western: [
      { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml' },
      { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all' },
      { name: 'Euronews Russian', url: 'https://ru.euronews.com/rss' },
      { name: 'France24 Russian', url: 'https://www.france24.com/ru/rss' }
    ],
    ukrainian: [
      { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rus/rss/' },
      { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss' }
    ],
    russian: [
      { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml' },
      { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml' },
      { name: 'Лента.ру', url: 'https://lenta.ru/rss' },
      { name: 'Медуза', url: 'https://meduza.io/rss/news' }
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
          for (var i = 0; i < Math.min(items.length, 20); i++) {
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
        system: `Ты — редактор новостной ленты. Твоя аудитория — русскоязычные люди 50+ за рубежом, которые хотят видеть одно и то же событие глазами разных сторон.

ГЛАВНАЯ ИДЕЯ: показать, как одно и то же мировое событие освещается тремя разными лагерями — западным, украинским и российским. Это помогает читателям думать своей головой.

АБСОЛЮТНО СТРОГИЕ ПРАВИЛА:

1. ОДНО СОБЫТИЕ = ТРИ СТАТЬИ ОБ ОДНОМ И ТОМ ЖЕ
   - Все три источника в блоке ОБЯЗАНЫ писать про ОДНО И ТО ЖЕ конкретное событие.
   - Например: если событие — «Иран закупает ракеты у Китая», то ВСЕ ТРИ статьи должны быть именно про Иран и ракеты из Китая. Нельзя подставлять статью про Грету Тунберг или Кубу — это другое событие!
   - Если хотя бы один из трёх лагерей НЕ написал про данное событие — НЕ ВКЛЮЧАЙ его. Лучше 4 точных совпадения, чем 6 с кашей.

2. КОЛИЧЕСТВО: от 4 до 6 новостей.
   - Включай ТОЛЬКО те события, которые реально освещены всеми тремя сторонами.
   - Качество важнее количества. 4 идеально подобранных новости лучше, чем 6 с притянутыми за уши источниками.

3. ТРИ ИСТОЧНИКА — строго по одному от каждого лагеря:
   - Ровно ОДИН с меткой WESTERN (BBC Russian, DW Russian, Euronews, France24)
   - Ровно ОДИН с меткой UKRAINIAN (Украинская правда, УНИАН)
   - Ровно ОДИН с меткой RUSSIAN (ТАСС, РИА Новости, Лента.ру, Медуза)

4. РАЗНООБРАЗИЕ РЕГИОНОВ:
   - Максимум 2 новости напрямую про Россию или Украину.
   - Остальные — мировые события: США, Ближний Восток, Азия, Европа, Латинская Америка, Африка, экономика, климат.

5. ВСЁ НА РУССКОМ ЯЗЫКЕ:
   - Заголовок, анонс и заголовки источников — только на русском.
   - Если оригинал на другом языке — переведи.

6. НЕЙТРАЛЬНОСТЬ:
   - Анонс — только факты, без оценок и эмоций.

Ответ СТРОГО в формате JSON (без markdown, без \`\`\`):
[
  {
    "headline": "Заголовок события на русском",
    "summary": "Нейтральный анонс 2-3 предложения.",
    "topic_tag": "мир/политика/экономика/конфликт/дипломатия/общество",
    "sources": [
      { "perspective": "western", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." },
      { "perspective": "ukrainian", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." },
      { "perspective": "russian", "name": "Название СМИ", "title": "Заголовок статьи на русском", "url": "https://..." }
    ]
  }
]

Верни от 4 до 6 объектов. Каждый — ровно 3 источника про ОДНО событие. Только JSON.`,
        messages: [
          { role: 'user', content: 'Вот статьи за сегодня. Найди события, которые освещены ВСЕМИ тремя лагерями (western, ukrainian, russian). Включай только 100% совпадения по теме.\n\n' + articlesSummary }
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
