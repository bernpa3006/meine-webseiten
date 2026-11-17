// Vercel Serverless Function: Aktienkurse und Titelsuche (Quelle: Yahoo Finance)
// GET /api/quotes?symbols=AAPL,NESN.SW   -> Kurse
// GET /api/quotes?q=nestle               -> Titelsuche

const UA = 'Mozilla/5.0 (compatible; Kursblick/1.0)';
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function yget(path) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const r = await fetch('https://' + host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (r.ok) return await r.json();
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function quote(symbol) {
  try {
    const j = await yget(
      '/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1mo&interval=1d&includePrePost=false'
    );
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res) return { symbol, error: true };
    const meta = res.meta || {};
    const closes = ((res.indicators && res.indicators.quote && res.indicators.quote[0].close) || []).filter(
      (v) => typeof v === 'number'
    );
    const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : closes[closes.length - 1];
    if (typeof price !== 'number') return { symbol, error: true };
    const prev = closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose;
    const change = typeof prev === 'number' ? price - prev : 0;
    const pct = typeof prev === 'number' && prev !== 0 ? (change / prev) * 100 : 0;
    return {
      symbol,
      name: meta.shortName || meta.longName || symbol,
      price,
      change,
      pct,
      currency: meta.currency || '',
      exchange: meta.exchangeName || '',
      spark: closes.slice(-30),
      time: meta.regularMarketTime || null,
    };
  } catch (e) {
    return { symbol, error: true };
  }
}

async function search(q) {
  const j = await yget(
    '/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=6&newsCount=0&listsCount=0'
  );
  return ((j && j.quotes) || [])
    .filter((x) => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF' || x.quoteType === 'INDEX'))
    .slice(0, 6)
    .map((x) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.quoteType,
    }));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = new URL(req.url, 'http://localhost');
    const q = (url.searchParams.get('q') || '').trim();
    if (q) {
      res.status(200).json({ results: await search(q.slice(0, 40)) });
      return;
    }
    const symbols = (url.searchParams.get('symbols') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z0-9.\-^=]{1,15}$/.test(s))
      .slice(0, 40);
    if (!symbols.length) {
      res.status(400).json({ error: 'symbols oder q fehlt' });
      return;
    }
    const quotes = await Promise.all(symbols.map(quote));
    res.status(200).json({ quotes, fetchedAt: Date.now() });
  } catch (e) {
    res.status(502).json({ error: 'Datenquelle nicht erreichbar' });
  }
};
