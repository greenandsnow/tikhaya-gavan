// api/news.js
// GET /api/news          — published новости за сегодня
// GET /api/news?date=... — за конкретную дату
// GET /api/news?status=draft — для админки (нужен service key)

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabaseUrl = process.env.SUPABASE_URL;
    var supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    var serviceKey = process.env.SUPABASE_SERVICE_KEY;

    var date = req.query.date || new Date().toISOString().split('T')[0];
    var status = req.query.status || 'published';

    // Используем service key для всех запросов (обходит RLS)
    var key = serviceKey;

    var url = supabaseUrl + '/rest/v1/news?date=eq.' + date + '&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,status,created_at';
    if (status === 'draft' || status === 'hidden' || status === 'published') {
      url += '&status=eq.' + status;
    } else {
      url += '&status=eq.published';
    }

    var r = await fetch(url, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
    });
    var news = await r.json();

    // Если за сегодня нет published — попробовать вчера
    if ((!news || news.length === 0) && !req.query.date && status === 'published') {
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yDate = yesterday.toISOString().split('T')[0];

      var r2 = await fetch(
        supabaseUrl + '/rest/v1/news?date=eq.' + yDate + '&status=eq.published&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,status,created_at',
        { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } }
      );
      news = await r2.json();
    }

    if (req.query.status) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
    return res.status(200).json(news || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
