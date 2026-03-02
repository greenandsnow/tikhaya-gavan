// api/news.js
// GET /api/news          — published новости за сегодня
// GET /api/news?date=... — за конкретную дату
// GET /api/news?status=draft — для админки (нужен service key)

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabaseUrl = process.env.SUPABASE_URL;
    var serviceKey = process.env.SUPABASE_SERVICE_KEY;

    // Дата UTC (как в базе)
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

    // Если за сегодня нет published — попробовать вчера
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
