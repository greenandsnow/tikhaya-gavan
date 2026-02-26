// api/news-admin.js v3
// POST /api/news-admin
// Topic actions: publish, delete, publish_all, hide, replace
// Source actions: hide_source, restore_source, replace_source

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body;
    var password = process.env.ADMIN_PASSWORD;

    if (!password || body.password !== password) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    var supabaseUrl = process.env.SUPABASE_URL;
    var serviceKey = process.env.SUPABASE_SERVICE_KEY;
    var id = body.id;
    var action = body.action;

    // ── Helper: fetch a news item by id ──
    async function getNewsItem(itemId) {
      var r = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + itemId + '&select=*', {
        headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey }
      });
      var rows = await r.json();
      return (rows && rows.length > 0) ? rows[0] : null;
    }

    // ── Helper: update sources array ──
    async function updateSources(itemId, sources) {
      var r = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + itemId, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ sources: sources })
      });
      return r.ok;
    }

    // ── Helper: fetch RSS for a camp ──
    async function fetchCampRSS(camp) {
      var CAMP_FEEDS = {
        west: [
          { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', lang: 'ru' },
          { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', lang: 'ru' },
          { name: 'BBC World (англ.)', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en' },
          { name: 'DW English', url: 'https://rss.dw.com/rdf/rss-en-all', lang: 'en' },
          { name: 'Медуза', url: 'https://meduza.io/rss/all', lang: 'ru' },
          { name: 'Медиазона', url: 'https://zona.media/rss', lang: 'ru' }
        ],
        ukraine: [
          { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss' },
          { name: 'Украинская правда', url: 'https://www.pravda.com.ua/rus/rss/' }
        ],
        russia: [
          { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml' },
          { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml' }
        ],
        china: [
          { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', lang: 'ru' },
          { name: 'Al Jazeera (англ.)', url: 'https://www.aljazeera.com/xml/rss/all.xml', lang: 'en' }
        ]
      };

      var feeds = CAMP_FEEDS[camp] || [];
      var articles = [];

      for (var feed of feeds) {
        try {
          var resp = await fetch(feed.url, {
            headers: { 'User-Agent': 'TikhayaGavan/1.0 NewsBot' },
            signal: AbortSignal.timeout(10000)
          });
          if (!resp.ok) continue;
          var xml = await resp.text();
          var items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
          for (var i = 0; i < Math.min(items.length, 15); i++) {
            var titleMatch = items[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            var linkMatch = items[i].match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            var descMatch = items[i].match(/<description[^>]*>([\s\S]*?)<\/description>/i);
            var title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim() : '';
            if (title) {
              var langTag = (feed.lang === 'en') ? ' [АНГЛ]' : '';
              articles.push({ source: feed.name + langTag, title: title, url: link, excerpt: desc.substring(0, 300), lang: feed.lang || 'ru' });
            }
          }
        } catch (e) { /* skip */ }
      }
      return articles;
    }

    // ── Helper: fetch ALL camp RSS (for topic replace) ──
    async function fetchAllRSS() {
      var ALL_FEEDS = [
        { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss', camp: 'ukraine' },
        { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', camp: 'west' },
        { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', camp: 'west' },
        { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', camp: 'russia' },
        { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', camp: 'russia' },
        { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', camp: 'china' }
      ];
      var allArticles = [];
      for (var feed of ALL_FEEDS) {
        try {
          var resp = await fetch(feed.url, {
            headers: { 'User-Agent': 'TikhayaGavan/1.0 NewsBot' },
            signal: AbortSignal.timeout(10000)
          });
          if (!resp.ok) continue;
          var xml = await resp.text();
          var items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
          for (var i = 0; i < Math.min(items.length, 10); i++) {
            var titleMatch = items[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            var linkMatch = items[i].match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            var descMatch = items[i].match(/<description[^>]*>([\s\S]*?)<\/description>/i);
            var title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim() : '';
            if (title) {
              allArticles.push({ camp: feed.camp, source: feed.name, title: title, url: link, excerpt: desc.substring(0, 300) });
            }
          }
        } catch (e) { /* skip */ }
      }
      return allArticles;
    }

    // ═══════════════════════════════════════
    // TOPIC-LEVEL ACTIONS
    // ═══════════════════════════════════════

    if (action === 'publish') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json', 'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r.ok, action: 'published' });
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r2 = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=minimal' }
      });
      return res.status(200).json({ ok: r2.ok, action: 'deleted' });
    }

    if (action === 'publish_all') {
      var date = body.date || new Date().toISOString().split('T')[0];
      var r3 = await fetch(supabaseUrl + '/rest/v1/news?date=eq.' + date + '&status=eq.draft', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json', 'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r3.ok, action: 'all_published' });
    }

    if (action === 'hide') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r4 = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json', 'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'hidden' })
      });
      return res.status(200).json({ ok: r4.ok, action: 'hidden' });
    }

    // ── Replace entire topic ──
    if (action === 'replace') {
      if (!id) return res.status(400).json({ error: 'id required' });

      // Hide current
      await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json', 'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'hidden' })
      });

      var today = body.date || new Date().toISOString().split('T')[0];
      var existingResp = await fetch(
        supabaseUrl + '/rest/v1/news?date=eq.' + today + '&status=in.(published,hidden)&select=headline',
        { headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey } }
      );
      var existing = await existingResp.json();
      var existingHeadlines = (existing || []).map(function(e) { return e.headline; });

      var allArticles = await fetchAllRSS();
      if (allArticles.length < 10) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Недостаточно статей из RSS' });
      }

      var anthropicKey = process.env.ANTHROPIC_API_KEY;
      var articlesList = allArticles.map(function(a, i) {
        return i + '. [' + a.source + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');

      var claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          system: 'Ты — редактор новостной ленты. Сгенерируй ОДНУ новую тему дня.\n\nУЖЕ ОПУБЛИКОВАННЫЕ (НЕ ДУБЛИРУЙ):\n' + existingHeadlines.join(', ') +
            '\n\nПравила:\n- Тема ОТЛИЧНАЯ от уже опубликованных\n- 4 источника: west, ukraine, russia, china\n- headline = короткое название\n- summary = 2-3 предложения\n- excerpt копируй дословно\n- Всё на русском\n\nJSON без ```:\n{"headline":"...","summary":"...","topic_tag":"мир","sources":[{"perspective":"west","name":"...","title":"...","excerpt":"...","url":"..."},{"perspective":"ukraine","name":"...","title":"...","excerpt":"...","url":"..."},{"perspective":"russia","name":"...","title":"...","excerpt":"...","url":"..."},{"perspective":"china","name":"...","title":"...","excerpt":"...","url":"..."}]}',
          messages: [{ role: 'user', content: articlesList }]
        })
      });

      var cData = await claudeResp.json();
      var cText = '';
      if (cData.content) { for (var bl of cData.content) { if (bl.type === 'text') cText += bl.text; } }

      var newItem;
      try {
        newItem = JSON.parse(cText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      } catch (pe) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Claude parse error', raw: cText.substring(0, 300) });
      }

      if (!newItem.sources || newItem.sources.length < 4) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Менее 4 источников' });
      }

      var insertResp = await fetch(supabaseUrl + '/rest/v1/news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey, 'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          date: today, headline: newItem.headline, summary: newItem.summary,
          sources: newItem.sources, topic_tag: newItem.topic_tag || 'мир', status: 'published'
        })
      });

      var inserted = await insertResp.json();
      return res.status(200).json({ ok: insertResp.ok, action: 'replaced', new_item: Array.isArray(inserted) ? inserted[0] : inserted });
    }

    // ═══════════════════════════════════════
    // SOURCE-LEVEL ACTIONS
    // ═══════════════════════════════════════

    // ── Hide one source (set hidden: true in sources array) ──
    if (action === 'hide_source') {
      if (!id || !body.perspective) return res.status(400).json({ error: 'id and perspective required' });

      var item = await getNewsItem(id);
      if (!item) return res.status(404).json({ error: 'News item not found' });

      var sources = item.sources || [];
      for (var i = 0; i < sources.length; i++) {
        if (sources[i].perspective === body.perspective) {
          sources[i].hidden = true;
          break;
        }
      }

      var ok = await updateSources(id, sources);
      return res.status(200).json({ ok: ok, action: 'source_hidden', perspective: body.perspective });
    }

    // ── Restore one source (remove hidden flag) ──
    if (action === 'restore_source') {
      if (!id || !body.perspective) return res.status(400).json({ error: 'id and perspective required' });

      var item2 = await getNewsItem(id);
      if (!item2) return res.status(404).json({ error: 'News item not found' });

      var sources2 = item2.sources || [];
      for (var i2 = 0; i2 < sources2.length; i2++) {
        if (sources2[i2].perspective === body.perspective) {
          delete sources2[i2].hidden;
          break;
        }
      }

      var ok2 = await updateSources(id, sources2);
      return res.status(200).json({ ok: ok2, action: 'source_restored', perspective: body.perspective });
    }

    // ── Replace one source (find new article from same camp via Claude) ──
    if (action === 'replace_source') {
      if (!id || !body.perspective) return res.status(400).json({ error: 'id and perspective required' });

      var item3 = await getNewsItem(id);
      if (!item3) return res.status(404).json({ error: 'News item not found' });

      var camp = body.perspective;
      var campArticles = await fetchCampRSS(camp);

      if (campArticles.length < 3) {
        return res.status(200).json({ ok: false, error: 'Недостаточно статей от лагеря «' + camp + '»' });
      }

      // Find current source to exclude
      var currentSource = null;
      for (var cs = 0; cs < item3.sources.length; cs++) {
        if (item3.sources[cs].perspective === camp) {
          currentSource = item3.sources[cs];
          break;
        }
      }

      var anthropicKey2 = process.env.ANTHROPIC_API_KEY;
      var campList = campArticles.map(function(a, idx) {
        return idx + '. [' + a.source + '] ' + a.title + ' — ' + a.excerpt.substring(0, 150) + ' | URL: ' + a.url;
      }).join('\n');

      var campLabels = { west: 'Запад', ukraine: 'Украина', russia: 'Россия', china: 'Глобальный Юг' };

      var claudeResp2 = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey2,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: 'Ты — редактор новостной ленты.\n\n' +
            'Тема новости: «' + item3.headline + '»\n' +
            'Описание темы: ' + (item3.summary || '') + '\n\n' +
            'Текущая статья от лагеря «' + (campLabels[camp] || camp) + '» (НЕ ПОВТОРЯЙ ЕЁ):\n' +
            '- Заголовок: ' + (currentSource ? currentSource.title : '') + '\n' +
            '- URL: ' + (currentSource ? currentSource.url : '') + '\n\n' +
            'ЗАДАЧА: Найди в списке ниже ДРУГУЮ статью, которая НАПРЯМУЮ относится к теме «' + item3.headline + '».\n\n' +
            'ПРИОРИТЕТ ВЫБОРА (для лагеря «Запад»):\n' +
            '1. BBC Russian или DW Russian (русскоязычные)\n' +
            '2. BBC World [АНГЛ] или DW English [АНГЛ] (англоязычные)\n' +
            '3. Медуза или Медиазона (русская оппозиция)\n' +
            'Выбирай по приоритету: сначала русскоязычные BBC/DW, потом английские, потом Медуза/Медиазона.\n\n' +
            'СТРОГИЕ ПРАВИЛА:\n' +
            '- Статья ДОЛЖНА быть про тему «' + item3.headline + '» (не про другие события!)\n' +
            '- URL должен быть ДРУГОЙ (не тот же, что у текущей статьи)\n' +
            '- Для русскоязычных статей: excerpt копируй из RSS дословно\n' +
            '- Для англоязычных статей (с пометкой [АНГЛ]): ПЕРЕВЕДИ заголовок на русский и напиши excerpt — краткое содержание 2-3 предложения на русском своими словами. В поле name пиши без [АНГЛ] (например просто \"BBC World\").\n' +
            '- Если в списке НЕТ ни одной подходящей статьи по этой теме — верни: {"none": true}\n' +
            '- НЕ ПРИДУМЫВАЙ статьи. Используй ТОЛЬКО те, что есть в списке.\n\n' +
            'JSON без ```:\n' +
            'Если нашёл: {"name":"Имя СМИ","title":"Заголовок на русском","excerpt":"Текст на русском","url":"https://..."}\n' +
            'Если не нашёл: {"none": true}',
          messages: [{ role: 'user', content: campList }]
        })
      });

      var cData2 = await claudeResp2.json();
      var cText2 = '';
      if (cData2.content) { for (var bl2 of cData2.content) { if (bl2.type === 'text') cText2 += bl2.text; } }

      var newSource;
      try {
        newSource = JSON.parse(cText2.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      } catch (pe2) {
        return res.status(200).json({ ok: false, error: 'Claude parse error', raw: cText2.substring(0, 200) });
      }

      // If Claude found no matching article
      if (newSource.none === true) {
        return res.status(200).json({ ok: false, error: 'Нет подходящей статьи по теме «' + item3.headline + '» у этого лагеря. Попробуйте «Скрыть» вместо «Заменить».' });
      }

      // Update the source in the array
      var sources3 = item3.sources || [];
      for (var s3 = 0; s3 < sources3.length; s3++) {
        if (sources3[s3].perspective === camp) {
          sources3[s3].name = newSource.name || sources3[s3].name;
          sources3[s3].title = newSource.title || sources3[s3].title;
          sources3[s3].excerpt = newSource.excerpt || sources3[s3].excerpt;
          sources3[s3].url = newSource.url || sources3[s3].url;
          delete sources3[s3].hidden;
          break;
        }
      }

      var ok3 = await updateSources(id, sources3);
      return res.status(200).json({ ok: ok3, action: 'source_replaced', perspective: camp, new_source: newSource });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
