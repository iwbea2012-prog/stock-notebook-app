/**
 * 銘柄ノート — Yahoo Finance 中継用 Cloudflare Worker
 *
 * ブラウザから直接 Yahoo Finance の非公式APIを呼ぶとCORSでブロックされるため、
 * このWorkerがサーバー側で代わりに取得し、CORSヘッダーを付けて返す。
 *
 * デプロイ手順は ../README.md を参照。
 *
 * エンドポイント:
 *   GET /quote?symbol=7203.T          → 直近の株価（1日分）
 *   GET /chart?symbol=7203.T&range=5y&interval=1wk  → 期間チャート用データ
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 証券コード.市場サフィックス の形（例: 7203.T, AAPL）だけを許可する
const SYMBOL_RE = /^[A-Za-z0-9.\-=^]{1,15}$/;
const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const symbol = url.searchParams.get("symbol") || "";
    if (!SYMBOL_RE.test(symbol)) {
      return json({ error: "invalid or missing symbol" }, 400);
    }

    let range;
    let interval;
    if (url.pathname === "/quote") {
      range = "5d";
      interval = "1d";
    } else if (url.pathname === "/chart") {
      range = url.searchParams.get("range") || "5y";
      interval = url.searchParams.get("interval") || "1wk";
      if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
        return json({ error: "invalid range or interval" }, 400);
      }
    } else {
      return json({ error: "not found" }, 404);
    }

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;

    try {
      const upstream = await fetch(yahooUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; StockNotebook/1.0)" },
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
      });
    } catch (e) {
      return json({ error: "upstream fetch failed" }, 502);
    }
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}
