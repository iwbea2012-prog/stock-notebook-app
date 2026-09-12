/* 銘柄ノート — スタンドアロン版 (localStorage only, no backend account) */

const STOCKS_KEY = "kabuNoteStocks_v1";
const CONFIG_KEY = "kabuNoteConfig_v1";
const $app = document.getElementById("app");

/* ---------- storage helpers ---------- */

function loadStocks() {
  try {
    const raw = localStorage.getItem(STOCKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("failed to parse stocks", e);
    return [];
  }
}

function saveStocks(stocks) {
  localStorage.setItem(STOCKS_KEY, JSON.stringify(stocks));
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function findStock(id) {
  return loadStocks().find((s) => s.id === id);
}

function upsertStock(stock) {
  const stocks = loadStocks();
  const idx = stocks.findIndex((s) => s.id === stock.id);
  if (idx >= 0) stocks[idx] = stock;
  else stocks.unshift(stock);
  saveStocks(stocks);
}

function deleteStock(id) {
  saveStocks(loadStocks().filter((s) => s.id !== id));
}

/* ---------- utils ---------- */

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function nowLocalDatetime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDatetime(s) {
  if (!s) return "";
  return s.replace("T", " ");
}

function formatPrice(stock) {
  if (stock.price == null || stock.price === "") return "—";
  const n = Number(stock.price);
  if (Number.isNaN(n)) return "—";
  return "¥" + n.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function normalizeCode(input) {
  return String(input || "").trim();
}

function tickerFromCode(code) {
  // already has a suffix (e.g. user pasted "7203.T")?
  if (/\.[A-Za-z]+$/.test(code)) return code.toUpperCase();
  return `${code}.T`;
}

function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- proxy (serverless relay for Yahoo Finance) ---------- */

function getProxyBase() {
  return (loadConfig().proxyBaseUrl || "").replace(/\/+$/, "");
}

async function fetchQuote(ticker) {
  const base = getProxyBase();
  if (!base) throw new Error("NO_PROXY");
  const res = await fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}`);
  if (!res.ok) throw new Error("HTTP_" + res.status);
  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("NO_DATA");
  return {
    price: meta.regularMarketPrice,
    currency: meta.currency,
    companyName: meta.longName || meta.shortName,
  };
}

async function searchSymbols(query) {
  const base = getProxyBase();
  if (!base) throw new Error("NO_PROXY");
  const res = await fetch(`${base}/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("HTTP_" + res.status);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function fetchFiveYearChart(ticker) {
  const base = getProxyBase();
  if (!base) throw new Error("NO_PROXY");
  const res = await fetch(`${base}/chart?symbol=${encodeURIComponent(ticker)}&range=5y&interval=1wk`);
  if (!res.ok) throw new Error("HTTP_" + res.status);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("NO_DATA");
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = timestamps
    .map((t, i) => ({ t, c: closes[i] }))
    .filter((p) => p.c != null);
  return points.map((p) => ({
    date: new Date(p.t * 1000).toISOString().slice(0, 10),
    close: p.c,
  }));
}

/* ---------- router ---------- */

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);

function currentRoute() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "list" };
  if (parts[0] === "add") return { name: "add" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "stock" && parts[1]) return { name: "stock", id: decodeURIComponent(parts[1]) };
  return { name: "list" };
}

function render() {
  const route = currentRoute();
  if (route.name === "list") return renderList();
  if (route.name === "add") return renderAdd();
  if (route.name === "settings") return renderSettings();
  if (route.name === "stock") return renderStock(route.id);
  renderList();
}

/* ---------- list view ---------- */

function renderList() {
  const stocks = loadStocks().slice().sort((a, b) => {
    return (b.lastViewedAt || "").localeCompare(a.lastViewedAt || "");
  });

  if (stocks.length === 0) {
    $app.innerHTML = `
      <div class="empty-state">
        <p>まだ銘柄が登録されていません。</p>
        <p><a href="#/add">＋ 最初の銘柄を追加する</a></p>
      </div>
    `;
    return;
  }

  $app.innerHTML = `
    <div class="list">
      ${stocks.map(stockCardHtml).join("")}
    </div>
  `;
}

function stockCardHtml(s) {
  const benefit = s.benefit || {};
  const benefitBadge = benefit.hasBenefit
    ? `<span class="badge">🎁 株主優待あり</span>`
    : "";
  const viewCount = (s.viewLog || []).length;
  return `
    <a class="stock-card" href="#/stock/${encodeURIComponent(s.id)}">
      <div class="row-top">
        <div>
          <span class="name">${escapeHtml(s.companyName)}</span>
          <span class="code">(${escapeHtml(s.id)})</span>
        </div>
        <div class="price">${formatPrice(s)}</div>
      </div>
      <div class="meta-row">
        ${benefitBadge}
        <span class="small-muted">閲覧 ${viewCount}回${s.lastViewedAt ? " ・ 最終 " + formatDatetime(s.lastViewedAt) : ""}</span>
      </div>
    </a>
  `;
}

/* ---------- add view ---------- */

function renderAdd() {
  $app.innerHTML = `
    <a class="back-link" href="#/">← 一覧に戻る</a>
    <div class="card">
      <h2>銘柄を追加</h2>
      ${getProxyBase() ? `
        <label for="f-search">銘柄コード or 企業名で検索</label>
        <input type="text" id="f-search" placeholder="例: 7203 / Toyota（日本語社名は精度が低めです）" autocomplete="off">
        <div id="f-search-status" class="small-muted" style="margin-top:4px;"></div>
        <ul id="f-search-results" class="history-list" style="max-height:260px;"></ul>
      ` : `
        <p class="small-muted">
          検索機能を使うには、先に「設定」から中継サーバーのURLを登録してください。今はコードと銘柄名を直接入力してください。
        </p>
      `}
      <label for="f-code">証券コード（4桁の数字）</label>
      <input type="text" id="f-code" inputmode="numeric" placeholder="例: 7203">
      <label for="f-name">銘柄名</label>
      <input type="text" id="f-name" placeholder="例: トヨタ自動車">
      <div id="f-error" class="error-text"></div>
      <button class="btn btn-primary btn-block" id="f-submit">追加する</button>
    </div>
  `;

  wireAddForm();
}

function wireAddForm() {
  const codeEl = document.getElementById("f-code");
  const nameEl = document.getElementById("f-name");
  const searchEl = document.getElementById("f-search");

  if (searchEl) {
    const statusEl = document.getElementById("f-search-status");
    const resultsEl = document.getElementById("f-search-results");
    let debounceTimer = null;

    searchEl.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = searchEl.value.trim();
      resultsEl.innerHTML = "";
      if (q.length < 2) {
        statusEl.textContent = "";
        return;
      }
      statusEl.textContent = "検索中...";
      debounceTimer = setTimeout(async () => {
        try {
          const results = await searchSymbols(q);
          statusEl.textContent = results.length ? "候補をタップすると下欄に自動入力されます。" : "候補が見つかりませんでした。コード or 英語名で試すか、下に直接入力してください。";
          resultsEl.innerHTML = results.map((r) => {
            const code = r.symbol.replace(/\.[A-Za-z]+$/, "");
            return `
              <li style="cursor:pointer;" data-code="${escapeHtml(code)}" data-ticker="${escapeHtml(r.symbol)}" data-name="${escapeHtml(r.name)}" class="search-hit">
                <strong>${escapeHtml(r.name)}</strong>
                <span class="small-muted">（${escapeHtml(r.symbol)} ・ ${escapeHtml(r.exchange)}）</span>
              </li>
            `;
          }).join("");
          resultsEl.querySelectorAll(".search-hit").forEach((li) => {
            li.addEventListener("click", () => {
              codeEl.value = li.dataset.code;
              nameEl.value = li.dataset.name;
              statusEl.textContent = `「${li.dataset.name}」を入力欄にセットしました。内容を確認して追加してください。`;
              resultsEl.innerHTML = "";
            });
          });
        } catch (e) {
          statusEl.textContent = "検索に失敗しました（" + e.message + "）。下に直接入力してください。";
        }
      }, 400);
    });
  }

  document.getElementById("f-submit").addEventListener("click", () => {
    const code = normalizeCode(codeEl.value);
    const name = nameEl.value.trim();
    const errorEl = document.getElementById("f-error");
    if (!code || !name) {
      errorEl.textContent = "証券コードと銘柄名の両方を入力してください。";
      return;
    }
    if (findStock(code)) {
      errorEl.textContent = "その証券コードはすでに登録されています。";
      return;
    }
    const now = nowLocalDatetime();
    const stock = {
      id: code,
      ticker: tickerFromCode(code),
      companyName: name,
      price: null,
      priceAsOf: null,
      lastViewedAt: now,
      viewLog: [now],
      benefit: {
        hasBenefit: false,
        minShares: 100, // 2018年の単元株制度統一以降、東証銘柄はほぼ100株単位（例外あり・要確認）
        recordMonth: "",
        detail: "",
        checkedAt: null,
        externalLink: "",
      },
      notes: "",
    };
    upsertStock(stock);
    location.hash = `#/stock/${encodeURIComponent(code)}`;
  });
}

/* ---------- settings view ---------- */

function renderSettings() {
  const cfg = loadConfig();
  $app.innerHTML = `
    <a class="back-link" href="#/">← 一覧に戻る</a>
    <div class="card">
      <h2>設定</h2>
      <p class="small-muted">
        株価・5年チャートを取得するには、Yahoo Financeへの中継用サーバーレス関数（Cloudflare Workerなど）のURLが必要です。
        リポジトリ同梱の <code>worker/worker.js</code> をデプロイして得られたURLをここに貼り付けてください。
      </p>
      <label for="f-proxy">中継サーバーのURL</label>
      <input type="url" id="f-proxy" placeholder="https://your-worker.example.workers.dev" value="${escapeHtml(cfg.proxyBaseUrl || "")}">
      <div class="btn-row">
        <button class="btn btn-primary" id="f-save">保存</button>
      </div>
    </div>
    <div class="card">
      <h3>このアプリについて</h3>
      <p class="small-muted">
        登録した銘柄・閲覧履歴・優待メモは、すべてこの端末のブラウザ内だけに保存されます（他の端末やブラウザとは共有されません）。
        ブラウザのデータを消去すると内容も失われるのでご注意ください。
      </p>
    </div>
  `;

  document.getElementById("f-save").addEventListener("click", () => {
    const url = document.getElementById("f-proxy").value.trim();
    saveConfig({ ...cfg, proxyBaseUrl: url });
    toast("設定を保存しました");
  });
}

/* ---------- stock detail view ---------- */

function renderStock(id) {
  const stock = findStock(id);
  if (!stock) {
    $app.innerHTML = `<a class="back-link" href="#/">← 一覧に戻る</a><p>銘柄が見つかりませんでした。</p>`;
    return;
  }

  // record a view (once per page load / navigation into this stock)
  logView(stock);

  const benefit = stock.benefit || {};
  const yahooLink = `https://finance.yahoo.co.jp/quote/${encodeURIComponent(stock.ticker)}`;
  const minkabuLink = `https://minkabu.jp/stock/${encodeURIComponent(stock.id)}/yutai`;
  const searchLink = `https://www.google.com/search?q=${encodeURIComponent(`${stock.companyName} ${stock.id} 株主優待 権利確定月`)}`;

  $app.innerHTML = `
    <a class="back-link" href="#/">← 一覧に戻る</a>

    <div class="card">
      <div class="detail-header">
        <div>
          <h2 style="margin-bottom:2px;">${escapeHtml(stock.companyName)}</h2>
          <div class="small-muted">${escapeHtml(stock.id)}（${escapeHtml(stock.ticker)}）</div>
        </div>
        <div class="price-block">
          <div class="price">${formatPrice(stock)}</div>
          <div class="asof">${stock.priceAsOf ? formatDatetime(stock.priceAsOf) + " 時点" : "未取得"}</div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="btn-refresh-price">株価を更新</button>
        <button class="btn btn-danger" id="btn-delete">削除</button>
      </div>
      <div id="price-status" class="chart-status"></div>
    </div>

    <div class="card">
      <h3>閲覧履歴</h3>
      <ul class="history-list">
        ${(stock.viewLog || []).slice().reverse().slice(0, 30).map((v) => `<li>${formatDatetime(v)}</li>`).join("") || "<li>まだありません</li>"}
      </ul>
      ${(stock.viewLog || []).length > 30 ? `<div class="small-muted" style="margin-top:6px;">最新30件のみ表示しています（累計 ${stock.viewLog.length} 回）</div>` : ""}
    </div>

    <div class="card">
      <h3>株主優待</h3>
      <div class="checkbox-row">
        <input type="checkbox" id="b-has" ${benefit.hasBenefit ? "checked" : ""}>
        <label for="b-has" style="margin:0;">株主優待あり</label>
      </div>
      <label for="b-shares">優待に必要な株数</label>
      <input type="number" id="b-shares" min="0" step="1" value="${benefit.minShares ?? ""}">
      <div class="small-muted" style="margin-top:2px;">2018年の制度統一以降、東証銘柄は基本100株単位です（デフォルト値。優待により200株以上必要な場合もあるので下のリンクで確認してください）。</div>
      <label for="b-month">権利確定月</label>
      <input type="text" id="b-month" placeholder="例: 3月, 9月" value="${escapeHtml(benefit.recordMonth || "")}">
      <label for="b-detail">優待内容・条件（自由記述）</label>
      <textarea id="b-detail" placeholder="例: 100株以上で3,000円相当のクオカード。1年以上継続保有で増額。">${escapeHtml(benefit.detail || "")}</textarea>
      <label for="b-link">優待情報の参照リンク（任意）</label>
      <input type="url" id="b-link" placeholder="https://..." value="${escapeHtml(benefit.externalLink || "")}">
      <div class="link-row">
        <a href="${minkabuLink}" target="_blank" rel="noopener">みんかぶで優待を見る</a>
        <a href="${yahooLink}" target="_blank" rel="noopener">Yahoo!ファイナンス</a>
        <a href="${searchLink}" target="_blank" rel="noopener">Googleで調べる</a>
        ${benefit.externalLink ? `<a href="${escapeHtml(benefit.externalLink)}" target="_blank" rel="noopener">保存したリンクを開く</a>` : ""}
      </div>
      ${benefit.checkedAt ? `<div class="small-muted" style="margin-top:8px;">最終確認日: ${escapeHtml(benefit.checkedAt)}</div>` : ""}
      <button class="btn btn-primary btn-block" id="btn-save-benefit">優待情報を保存</button>
    </div>

    <div class="card">
      <h3>過去5年の株価チャート</h3>
      <button class="btn btn-secondary" id="btn-load-chart">チャートを表示</button>
      <div class="chart-wrap">
        <canvas id="chart-canvas" height="220"></canvas>
      </div>
      <div id="chart-status" class="chart-status"></div>
    </div>

    <div class="card">
      <h3>メモ</h3>
      <textarea id="f-notes" placeholder="自由メモ">${escapeHtml(stock.notes || "")}</textarea>
      <button class="btn btn-secondary btn-block" id="btn-save-notes">メモを保存</button>
    </div>
  `;

  wireStockDetail(stock);
}

function logView(stock) {
  const now = nowLocalDatetime();
  stock.viewLog = stock.viewLog || [];
  stock.viewLog.push(now);
  stock.lastViewedAt = now;
  upsertStock(stock);
}

function wireStockDetail(stock) {
  document.getElementById("btn-delete").addEventListener("click", () => {
    if (confirm(`「${stock.companyName}」を削除しますか？閲覧履歴もすべて失われます。`)) {
      deleteStock(stock.id);
      location.hash = "#/";
    }
  });

  document.getElementById("btn-refresh-price").addEventListener("click", async () => {
    const statusEl = document.getElementById("price-status");
    if (!getProxyBase()) {
      statusEl.textContent = "先に「設定」から中継サーバーのURLを登録してください。";
      return;
    }
    statusEl.textContent = "取得中...";
    try {
      const q = await fetchQuote(stock.ticker);
      const fresh = findStock(stock.id);
      fresh.price = q.price;
      fresh.priceAsOf = nowLocalDatetime();
      upsertStock(fresh);
      statusEl.textContent = "更新しました。";
      render();
    } catch (e) {
      statusEl.textContent = "株価の取得に失敗しました（" + e.message + "）。";
    }
  });

  document.getElementById("btn-save-benefit").addEventListener("click", () => {
    const fresh = findStock(stock.id);
    fresh.benefit = {
      hasBenefit: document.getElementById("b-has").checked,
      minShares: document.getElementById("b-shares").value ? Number(document.getElementById("b-shares").value) : null,
      recordMonth: document.getElementById("b-month").value.trim(),
      detail: document.getElementById("b-detail").value.trim(),
      checkedAt: todayLocalDate(),
      externalLink: document.getElementById("b-link").value.trim(),
    };
    upsertStock(fresh);
    toast("優待情報を保存しました");
    render();
  });

  document.getElementById("btn-save-notes").addEventListener("click", () => {
    const fresh = findStock(stock.id);
    fresh.notes = document.getElementById("f-notes").value;
    upsertStock(fresh);
    toast("メモを保存しました");
  });

  document.getElementById("btn-load-chart").addEventListener("click", async () => {
    const statusEl = document.getElementById("chart-status");
    if (!getProxyBase()) {
      statusEl.textContent = "先に「設定」から中継サーバーのURLを登録してください。";
      return;
    }
    statusEl.textContent = "チャートを取得中...";
    try {
      const points = await fetchFiveYearChart(stock.ticker);
      statusEl.textContent = `${points.length}件のデータを取得しました（取得のみ・保存はしません）。`;
      drawChart(points);
    } catch (e) {
      statusEl.textContent = "チャートの取得に失敗しました（" + e.message + "）。";
    }
  });
}

let currentChart = null;
function drawChart(points) {
  const ctx = document.getElementById("chart-canvas").getContext("2d");
  if (currentChart) currentChart.destroy();
  currentChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => p.date),
      datasets: [{
        label: "終値",
        data: points.map((p) => p.close),
        borderColor: "#4338ca",
        backgroundColor: "rgba(67,56,202,0.08)",
        pointRadius: 0,
        borderWidth: 2,
        fill: true,
        tension: 0.15,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { ticks: { maxTicksLimit: 6 } },
      },
    },
  });
}
