// api/news.js
// Возвращает новости за сегодня (или за указанную дату)
// GET /api/news          — новости за сегодня
// GET /api/news?date=2026-02-24 — новости за конкретную дату

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var supabaseUrl = process.env.SUPABASE_URL;
    var supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    var date = req.query.date || new Date().toISOString().split('T')[0];

    var r = await fetch(
      supabaseUrl + '/rest/v1/news?date=eq.' + date + '&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,created_at',
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': 'Bearer ' + supabaseKey
        }
      }
    );

    var news = await r.json();

    // Если за сегодня ничего — попробовать вчера
    if ((!news || news.length === 0) && !req.query.date) {
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yDate = yesterday.toISOString().split('T')[0];

      var r2 = await fetch(
        supabaseUrl + '/rest/v1/news?date=eq.' + yDate + '&order=created_at.asc&select=id,date,headline,summary,sources,topic_tag,created_at',
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': 'Bearer ' + supabaseKey
          }
        }
      );
      news = await r2.json();
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(news || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
