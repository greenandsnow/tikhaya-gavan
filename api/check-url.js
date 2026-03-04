// api/check-url.js
// POST /api/check-url { urls: [...] }
// Проверяет список URL через HEAD-запрос, возвращает { url: ok/dead }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var urls = req.body && req.body.urls;
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls required' });
    if (urls.length > 20) urls = urls.slice(0, 20); // лимит

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
        // 200-399 считаем живой, 404/410/5xx — мёртвой
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
};
