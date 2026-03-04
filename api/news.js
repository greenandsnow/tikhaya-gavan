// api/news.js
// GET /api/news          — published новости за сегодня
// GET /api/news?date=... — за конкретную дату
// GET /api/news?status=draft — для админки
// POST /api/news { urls: [...] } — проверка ссылок

module.exports = async function handler(req, res) {

  // ── POST: проверка ссылок ──
  if (req.method === 'POST') {
    try {
      var urls = req.body && req.body.urls;
      if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls required' });
      if (urls.length > 20) urls = urls.slice(0, 20);

      var results = {};
      await Promise.all(urls.map(async function(url) {
        try {
          var controller = new AbortController();
          var timeout = setTimeout(function() { controller.abort(); }, 5000);
          var r = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          clearTimeout(timeout);
          results[url] = (r.status >= 200 && r.status < 400) ? 'ok' : 'dead';
        } catch(e) {
          results[url] = 'dead';
        }
      }));

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(results);
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET: новости ──
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabaseUrl = process.env.SUPABASE_URL;
    var serviceKey = process.env.SUPABASE_SERVICE_KEY;

    var now = new Date();
    var todayUTC = now.getUTCFullYear() + '-'
      + String(now.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(now.getUTCDate()).padStart(2, '0');

    var date = req.query.date || todayUTC;
    var status = req.query.status || 'published';
    var key = serviceKey;

    var url = supabaseUrl + '/rest/v1/news?date=eq.' + date + '&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,status,sort_order,created_at';
    if (['draft', 'hidden', 'published'].includes(status)) {
      url += '&status=eq.' + status;
    } else {
      url += '&status=eq.published';
    }

    var r = await fetch(url, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
    });
    var news = await r.json();

    if ((!news || news.length === 0) && !req.query.date && status === 'published') {
      var yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      var yDate = yesterday.getUTCFullYear() + '-'
        + String(yesterday.getUTCMonth() + 1).padStart(2, '0') + '-'
        + String(yesterday.getUTCDate()).padStart(2, '0');

      var r2 = await fetch(
        supabaseUrl + '/rest/v1/news?date=eq.' + yDate + '&status=eq.published&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,status,sort_order,created_at',
        { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } }
      );
      news = await r2.json();
    }

    res.setHeader('Cache-Control', req.query.status ? 'no-store' : 'public, max-age=60');
    return res.status(200).json(news || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
