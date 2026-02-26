// api/news-admin.js v2
// POST /api/news-admin
// Actions: publish, delete, publish_all, hide, replace

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

    // ── Publish one ──
    if (action === 'publish') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r.ok, action: 'published' });
    }

    // ── Delete one ──
    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r2 = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        }
      });
      return res.status(200).json({ ok: r2.ok, action: 'deleted' });
    }

    // ── Publish all drafts for a date ──
    if (action === 'publish_all') {
      var date = body.date || new Date().toISOString().split('T')[0];
      var r3 = await fetch(supabaseUrl + '/rest/v1/news?date=eq.' + date + '&status=eq.draft', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'published' })
      });
      return res.status(200).json({ ok: r3.ok, action: 'all_published' });
    }

    // ── Hide one (скрыть опубликованную тему) ──
    if (action === 'hide') {
      if (!id) return res.status(400).json({ error: 'id required' });
      var r4 = await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'hidden' })
      });
      return res.status(200).json({ ok: r4.ok, action: 'hidden' });
    }

    // ── Replace: hide + generate new topic ──
    if (action === 'replace') {
      if (!id) return res.status(400).json({ error: 'id required' });

      // 1. Скрываем текущую тему
      await fetch(supabaseUrl + '/rest/v1/news?id=eq.' + id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ status: 'hidden' })
      });

      // 2. Получаем список уже опубликованных тем за сегодня (чтобы не дублировать)
      var today = body.date || new Date().toISOString().split('T')[0];
      var existingResp = await fetch(
        supabaseUrl + '/rest/v1/news?date=eq.' + today + '&status=in.(published,hidden)&select=headline,topic_tag',
        { headers: { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey } }
      );
      var existing = await existingResp.json();
      var existingHeadlines = (existing || []).map(function(e) { return e.headline; });

      // 3. Парсим RSS (упрощённый набор — по 10 статей от ключевых источников)
      var FEEDS = [
        { name: 'УНИАН', url: 'https://rss.unian.net/site/news_rus.rss', camp: 'ukraine', lang: 'ru' },
        { name: 'BBC Russian', url: 'https://feeds.bbci.co.uk/russian/rss.xml', camp: 'west', lang: 'ru' },
        { name: 'DW Russian', url: 'https://rss.dw.com/rdf/rss-ru-all', camp: 'west', lang: 'ru' },
        { name: 'ТАСС', url: 'https://tass.ru/rss/v2.xml', camp: 'russia', lang: 'ru' },
        { name: 'РИА Новости', url: 'https://ria.ru/export/rss2/archive/index.xml', camp: 'russia', lang: 'ru' },
        { name: 'Синьхуа', url: 'https://russian.news.cn/ewjkxml.xml', camp: 'china', lang: 'ru' }
      ];

      var allArticles = [];
      for (var feed of FEEDS) {
        try {
          var fResp = await fetch(feed.url, {
            headers: { 'User-Agent': 'TikhayaGavan/1.0 NewsBot' },
            signal: AbortSignal.timeout(10000)
          });
          if (!fResp.ok) continue;
          var xml = await fResp.text();
          var items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
          for (var i = 0; i < Math.min(items.length, 10); i++) {
            var titleMatch = items[i].match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            var linkMatch = items[i].match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            var descMatch = items[i].match(/<description[^>]*>([\s\S]*?)<\/description>/i);
            var title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
            var desc = descMatch ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').trim() : '';
            if (title) {
              allArticles.push({ camp: feed.camp, source: feed.name, title: title, url: link, excerpt: desc.substring(0, 300), lang: feed.lang });
            }
          }
        } catch (e) { /* skip */ }
      }

      if (allArticles.length < 10) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Недостаточно статей из RSS' });
      }

      // 4. Claude — одна новая тема
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
          system: 'Ты — редактор новостной ленты. Сгенерируй ОДНУ новую тему дня на основе статей ниже.\n\nУЖЕ ОПУБЛИКОВАННЫЕ ТЕМЫ (НЕ ДУБЛИРУЙ ИХ):\n' +
            existingHeadlines.join(', ') +
            '\n\nПравила:\n- Выбери тему, ОТЛИЧНУЮ от уже опубликованных\n- 4 источника: west, ukraine, russia, china — по одному от каждого лагеря\n- headline = название темы коротко\n- summary = нейтральный анонс 2-3 предложения\n- excerpt копируй из RSS дословно\n- Всё на русском\n\nВерни ТОЛЬКО JSON (без ```, без markdown):\n{\n  "headline": "...",\n  "summary": "...",\n  "topic_tag": "мир/политика/экономика/конфликт",\n  "sources": [\n    { "perspective": "west", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n    { "perspective": "ukraine", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n    { "perspective": "russia", "name": "...", "title": "...", "excerpt": "...", "url": "..." },\n    { "perspective": "china", "name": "...", "title": "...", "excerpt": "...", "url": "..." }\n  ]\n}',
          messages: [{ role: 'user', content: articlesList }]
        })
      });

      var cData = await claudeResp.json();
      var cText = '';
      if (cData.content) {
        for (var block of cData.content) {
          if (block.type === 'text') cText += block.text;
        }
      }

      var newItem;
      try {
        newItem = JSON.parse(cText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());
      } catch (pe) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Claude parse error', raw: cText.substring(0, 300) });
      }

      // Проверяем 4 перспективы
      if (!newItem.sources || newItem.sources.length < 4) {
        return res.status(200).json({ ok: false, action: 'replace', error: 'Менее 4 источников' });
      }

      // 5. Сохраняем как published
      var insertResp = await fetch(supabaseUrl + '/rest/v1/news', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          date: today,
          headline: newItem.headline,
          summary: newItem.summary,
          sources: newItem.sources,
          topic_tag: newItem.topic_tag || 'мир',
          status: 'published'
        })
      });

      var inserted = await insertResp.json();
      return res.status(200).json({
        ok: insertResp.ok,
        action: 'replaced',
        hidden_id: id,
        new_item: Array.isArray(inserted) ? inserted[0] : inserted
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
