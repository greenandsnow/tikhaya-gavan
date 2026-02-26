export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const SUPABASE_URL = 'https://nclltofdkjiuneqzemhd.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jbGx0b2Zka2ppdW5lcXplbWhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3OTg5OTksImV4cCI6MjA4NzM3NDk5OX0.FPwKW_8M33M32OWhzhcfF_yftinL7ZlfiEBiZQ4vIG4';

  try {
    // Start date: Saturday Feb 28, 2026 — new crossword appears at 00:00 UTC Saturday
    const startDate = new Date('2026-02-28T00:00:00Z');
    const now = new Date();

    // Calculate weeks since start
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceStart = Math.floor((now - startDate) / msPerWeek);

    // Cycle through 50 puzzles (week_number 1-50)
    const weekNumber = (weeksSinceStart % 50) + 1;

    // Allow override via query param for testing: /api/crossword?week=5
    const testWeek = parseInt(req.query?.week);
    const targetWeek = (testWeek >= 1 && testWeek <= 50) ? testWeek : weekNumber;

    // Direct REST API call to Supabase
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/crosswords?week_number=eq.${targetWeek}&select=id,week_number,puzzle_data&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const rows = await response.json();

    if (!rows || rows.length === 0) {
      // Fallback to week 1
      const fb = await fetch(
        `${SUPABASE_URL}/rest/v1/crosswords?week_number=eq.1&select=id,week_number,puzzle_data&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const fbRows = await fb.json();
      return res.status(200).json({
        week: 1,
        total: 50,
        puzzle: fbRows[0]?.puzzle_data || null
      });
    }

    return res.status(200).json({
      week: targetWeek,
      total: 50,
      puzzle: rows[0].puzzle_data
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
