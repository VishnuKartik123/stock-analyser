import React, { useEffect, useRef, useState } from "react";
import StockChart from "./StockChart";
import IntradayChart from "./IntradayChart";


// ============================================================
// BACKEND
// ============================================================

const BACKEND =
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";

const IS_LOCAL_BACKEND = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
  BACKEND
);

// Closed shadow-trade P&L baseline is captured from the backend's current total
// on first load and persisted in this browser. Historical records are not deleted.
const SHADOW_CLOSED_PNL_BASELINE_KEY = "stockAnalyser.shadowClosedPnlBaseline.v1";

const PAPER_STOCK_OPTIONS = [
  ["RELIANCE", "Reliance Industries"],
  ["TCS", "Tata Consultancy Services"],
  ["INFY", "Infosys"],
  ["HDFCBANK", "HDFC Bank"],
  ["ICICIBANK", "ICICI Bank"],
  ["SBIN", "State Bank of India"],
  ["BHARTIARTL", "Bharti Airtel"],
  ["ITC", "ITC Limited"],
  ["LT", "Larsen & Toubro"],
  ["AXISBANK", "Axis Bank"],
  ["KOTAKBANK", "Kotak Mahindra Bank"],
  ["MARUTI", "Maruti Suzuki"],
  ["TATAMOTORS", "Tata Motors"],
  ["SUNPHARMA", "Sun Pharmaceutical"],
  ["WIPRO", "Wipro"],
  ["HCLTECH", "HCL Technologies"],
  ["ADANIENT", "Adani Enterprises"],
  ["ADANIPORTS", "Adani Ports"],
  ["TITAN", "Titan Company"],
  ["BAJFINANCE", "Bajaj Finance"],
  ["ASIANPAINT", "Asian Paints"],
  ["ULTRACEMCO", "UltraTech Cement"],
  ["NTPC", "NTPC"],
  ["POWERGRID", "Power Grid Corporation"],
  ["ONGC", "Oil & Natural Gas Corporation"],
  ["COALINDIA", "Coal India"],
  ["TATASTEEL", "Tata Steel"],
  ["JSWSTEEL", "JSW Steel"],
  ["HINDALCO", "Hindalco Industries"],
  ["TECHM", "Tech Mahindra"],
  ["INDUSINDBK", "IndusInd Bank"],
  ["DRREDDY", "Dr. Reddy's Laboratories"],
  ["CIPLA", "Cipla"],
  ["DIVISLAB", "Divi's Laboratories"],
  ["EICHERMOT", "Eicher Motors"],
  ["HEROMOTOCO", "Hero MotoCorp"],
  ["BAJAJ-AUTO", "Bajaj Auto"],
  ["BAJAJFINSV", "Bajaj Finserv"],
  ["APOLLOHOSP", "Apollo Hospitals"],
  ["BEL", "Bharat Electronics"],
  ["HAL", "Hindustan Aeronautics"],
  ["TRENT", "Trent"],
  ["ETERNAL", "Eternal"],
  ["JIOFIN", "Jio Financial Services"],
  ["SHRIRAMFIN", "Shriram Finance"],
  ["M&M", "Mahindra & Mahindra"],
  ["NESTLEIND", "Nestle India"],
  ["HINDUNILVR", "Hindustan Unilever"],
  ["BRITANNIA", "Britannia Industries"],
  ["DABUR", "Dabur India"],
  ["PIDILITIND", "Pidilite Industries"],
  ["SIEMENS", "Siemens"],
  ["ABB", "ABB India"],
  ["INDIGO", "InterGlobe Aviation"],
];

// ============================================================
// HELPERS
// ============================================================

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  return `${Number(value).toFixed(2)}%`;
}

// Timestamp policy:
// 1) New backend records contain an explicit timezone (+05:30) and are parsed normally.
// 2) Legacy stock_analyser_history.db records are timezone-less but already contain
//    the IST wall-clock time. For those records, DO NOT append "Z" and DO NOT add
//    another +05:30. Format the stored date/time components directly as IST.
function formatTradeTimestampIST(value) {
  if (value === null || value === undefined || value === "") return "—";

  const raw = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);

  // Legacy SQLite/Render timestamp, e.g. 2026-09-22T15:16:35.036267.
  // It already represents 15:16:35 IST.
  if (!hasTimezone) {
    const match = raw.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/
    );

    if (match) {
      const [, year, month, day, hourText, minute, second] = match;
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];

      const hour24 = Number(hourText);
      const hour12 = hour24 % 12 || 12;
      const dayPeriod = hour24 >= 12 ? "PM" : "AM";
      const monthName = monthNames[Number(month) - 1] || month;

      return `${day} ${monthName} ${year}, ${String(hour12).padStart(
        2,
        "0"
      )}:${minute}:${second} ${dayPeriod} IST`;
    }

    return raw;
  }

  // Timezone-aware timestamps are converted exactly once to Asia/Kolkata.
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const getPart = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${getPart("day")} ${getPart("month")} ${getPart("year")}, ${getPart(
    "hour"
  )}:${getPart("minute")}:${getPart("second")} ${getPart("dayPeriod")} IST`;
}

function signalColor(signal) {
  if (signal === "BUY") return "#16a34a";
  if (signal === "SELL") return "#dc2626";
  if (signal === "WAIT") return "#d97706";
  return "#64748b";
}

function signalBackground(signal) {
  if (signal === "BUY") return "#dcfce7";
  if (signal === "SELL") return "#fee2e2";
  if (signal === "WAIT") return "#fef3c7";
  return "#f1f5f9";
}

function getISTTradingClock(dateValue = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(dateValue);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const total = hour * 3600 + minute * 60 + second;

  const buyStart = 12 * 3600 + 30 * 60;
  const buyEnd = 13 * 3600 + 30 * 60;
  const sellEnd = 14 * 3600 + 30 * 60;

  let phase = "WAIT";
  let action = "WAIT";
  let nextLabel = "12:30 PM IST";
  let targetSeconds = buyStart;
  let message = "Wait for the preferred BUY review window, then re-analyze the whole market.";

  if (total >= buyStart && total < buyEnd) {
    phase = "BUY_WINDOW";
    action = "EXECUTION CHECK NOW";
    nextLabel = "1:30 PM IST";
    targetSeconds = buyEnd;
    message = "BUY review window is active. Execute only if whole-market + stock-level V7 gates all pass.";
  } else if (total >= buyEnd && total < sellEnd) {
    phase = "SELL_WINDOW";
    action = "EXECUTION CHECK NOW";
    nextLabel = "2:30 PM IST";
    targetSeconds = sellEnd;
    message = "SELL review window is active. Execute only if whole-market + stock-level V7 gates all pass.";
  } else if (total >= sellEnd) {
    phase = "NO_NEW_ENTRY";
    action = "NO NEW ENTRY";
    nextLabel = "Next session";
    targetSeconds = null;
    message = "Preferred new-entry windows are finished. Manage open positions only.";
  }

  let countdown = "—";
  if (targetSeconds !== null) {
    let diff = targetSeconds - total;
    if (diff < 0) diff = 0;
    const hh = Math.floor(diff / 3600);
    const mm = Math.floor((diff % 3600) / 60);
    const ss = diff % 60;
    countdown = [hh, mm, ss].map((v) => String(v).padStart(2, "0")).join(":");
  }

  const timeText = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(dateValue);

  return { phase, action, nextLabel, countdown, message, timeText };
}

const inFlightGetRequests = new Map();

async function fetchJson(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const dedupe = method === "GET" && !options.signal;
  if (dedupe && inFlightGetRequests.has(url)) {
    return inFlightGetRequests.get(url);
  }
  const request = fetchJsonUnshared(url, options);
  if (!dedupe) return request;
  inFlightGetRequests.set(url, request);
  try { return await request; }
  finally { if (inFlightGetRequests.get(url) === request) inFlightGetRequests.delete(url); }
}

async function fetchJsonUnshared(url, options = {}) {
  const token = window.localStorage.getItem("stock_analyser_auth_token");

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    window.localStorage.removeItem("stock_analyser_auth_token");
    window.dispatchEvent(new Event("stock-analyser-auth-required"));
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const data = await response.json();

      if (data?.detail) {
        message = data.detail;
      }
    } catch {
      // Ignore JSON parsing failure
    }

    throw new Error(message);
  }

  return response.json();
}

// ============================================================
// REUSABLE COMPONENTS
// ============================================================

function Card({ title, children, style = {} }) {
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.05)",
        ...style,
      }}
    >
      {title && (
        <h3
          style={{
            marginTop: 0,
            marginBottom: 14,
            fontSize: 17,
            color: "#0f172a",
          }}
        >
          {title}
        </h3>
      )}

      {children}
    </div>
  );
}

function Indicator({ label, value, positive, negative }) {
  let valueColor = "#334155";

  if (positive) valueColor = "#16a34a";
  if (negative) valueColor = "#dc2626";

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 14,
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: 13,
          marginBottom: 6,
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: valueColor,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ signal }) {
  let normalizedSignal = "HOLD";

  if (typeof signal === "string") {
    normalizedSignal = signal.toUpperCase();
  } else if (signal && typeof signal === "object") {
    if (typeof signal.signal === "string") {
      normalizedSignal = signal.signal.toUpperCase();
    }
  }

  if (!["BUY", "SELL", "HOLD", "WAIT", "NO TRADE"].includes(normalizedSignal)) {
    normalizedSignal = "HOLD";
  }

  const styles = {
    BUY: {
      background: "#14532d",
      color: "#86efac",
      border: "#22c55e",
    },
    SELL: {
      background: "#7f1d1d",
      color: "#fca5a5",
      border: "#ef4444",
    },
    HOLD: {
      background: "#713f12",
      color: "#fde68a",
      border: "#eab308",
    },
    WAIT: {
      background: "#1e3a8a",
      color: "#93c5fd",
      border: "#3b82f6",
    },
    "NO TRADE": {
      background: "#334155",
      color: "#e2e8f0",
      border: "#64748b",
    },
  };

  const style = styles[normalizedSignal];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 14px",
        borderRadius: "999px",
        background: style.background,
        color: style.color,
        border: `1px solid ${style.border}`,
        fontWeight: 800,
        fontSize: "13px",
        letterSpacing: "0.5px",
      }}
    >
      {normalizedSignal}
    </span>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // ==========================================================
  // STOCK STATE
  // ==========================================================

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [symbol, setSymbol] = useState("NIFTY 50");

  const [quote, setQuote] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [chartData, setChartData] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [backendStatus, setBackendStatus] = useState("Checking...");

  const [period, setPeriod] = useState("6mo");

  // Top-level stock category:
  // NORMAL = delivery/normal stock analysis
  // INTRADAY = intraday Buy / Sell analysis
  const [analysisCategory, setAnalysisCategory] = useState("NORMAL");
  const [appPage, setAppPage] = useState("LIVE");
  const [intelligence, setIntelligence] = useState(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [strategyComparison, setStrategyComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  // Strategy Lab: independent scan/backtest workspace; it never places orders.
  const [strategyLabSymbol, setStrategyLabSymbol] = useState("RELIANCE");
  const [strategyLabInterval, setStrategyLabInterval] = useState("1d");
  const [strategyLabCatalog, setStrategyLabCatalog] = useState([]);
  const [strategyLabSelected, setStrategyLabSelected] = useState(["trend_pullback", "momentum_breakout", "swing_pullback", "donchian_breakout"]);
  const [strategyLabScan, setStrategyLabScan] = useState(null);
  const [strategyLabBacktest, setStrategyLabBacktest] = useState(null);
  const [strategyLabOos, setStrategyLabOos] = useState(null);
  const [strategyLabOosBusy, setStrategyLabOosBusy] = useState(false);
  const [strategyLabOosError, setStrategyLabOosError] = useState("");
  const [strategyLabBusy, setStrategyLabBusy] = useState(false);
  const [strategyLabError, setStrategyLabError] = useState("");
  const [strategyLabRisk, setStrategyLabRisk] = useState("250");
  const [strategyLabCapital, setStrategyLabCapital] = useState("20000");
  const [riskPlanEntry, setRiskPlanEntry] = useState("500");
  const [riskPlanStop, setRiskPlanStop] = useState("490");
  const [riskPlanSide, setRiskPlanSide] = useState("BUY");
  const [riskPlanResult, setRiskPlanResult] = useState(null);
  const [riskPlanBusy, setRiskPlanBusy] = useState(false);
  const [riskPlanError, setRiskPlanError] = useState("");
  const [profitabilityAudit, setProfitabilityAudit] = useState(null);
  const [profitabilityAuditError, setProfitabilityAuditError] = useState("");
  const [profitabilityAuditLoading, setProfitabilityAuditLoading] = useState(false);
  // Swing scanner: daily-bar research only; it never places orders.
  const [swingScanSymbols, setSwingScanSymbols] = useState("RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK,SBIN,LT,BHARTIARTL,ITC,AXISBANK,KOTAKBANK,BAJFINANCE,MARUTI,SUNPHARMA,TITAN,ULTRACEMCO,NTPC,POWERGRID,ONGC,ASIANPAINT,ADANIPORTS,JSWSTEEL,COALINDIA,HCLTECH,WIPRO,TRENT,DRREDDY,INDUSINDBK,M&M");
  const [swingRiskBudget, setSwingRiskBudget] = useState("250");
  const [swingAllocation, setSwingAllocation] = useState("20000");
  const [swingScanResult, setSwingScanResult] = useState(null);
  const [swingScanBusy, setSwingScanBusy] = useState(false);
  const [swingScanError, setSwingScanError] = useState("");
  const [swingScanFilter, setSwingScanFilter] = useState("ALL");
  // Swing workspace mirrors the intraday analyzer layout, but uses daily candles.
  const [swingDetailSymbol, setSwingDetailSymbol] = useState("RELIANCE");
  const [swingDetailPeriod, setSwingDetailPeriod] = useState("6mo");
  const [swingDetailData, setSwingDetailData] = useState([]);
  const [swingDetailQuote, setSwingDetailQuote] = useState(null);
  const [swingDetailLoading, setSwingDetailLoading] = useState(false);
  const [swingDetailError, setSwingDetailError] = useState("");
  const [swingSetupFilter, setSwingSetupFilter] = useState("ALL");
  const [swingNewMatches, setSwingNewMatches] = useState([]);
  const [swingNotificationsEnabled, setSwingNotificationsEnabled] = useState(false);
  const swingNotifiedSymbolsRef = useRef(new Set());

  async function enableSwingNotifications() {
    if (!("Notification" in window)) {
      setSwingScanError("Browser notifications are not supported here. In-app matched trades will still appear at the top after each scan.");
      return;
    }
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      const enabled = permission === "granted";
      setSwingNotificationsEnabled(enabled);
      if (!enabled) setSwingScanError("Notifications were not enabled. Keep the app open to see in-app matched trades after scanning.");
    } catch {
      setSwingScanError("Could not enable browser notifications. In-app matched trades will still appear after each scan.");
    }
  }

  async function loadSwingDetail(nextSymbol = swingDetailSymbol, nextPeriod = swingDetailPeriod) {
    const cleanSymbol = String(nextSymbol || "").trim().toUpperCase();
    if (!cleanSymbol) {
      setSwingDetailError("Enter an NSE stock symbol first.");
      return;
    }
    setSwingDetailSymbol(cleanSymbol);
    setSwingDetailLoading(true);
    setSwingDetailError("");
    try {
      const encoded = encodeURIComponent(cleanSymbol);
      const [history, quote] = await Promise.all([
        fetchJson(`${BACKEND}/api/stock/history?symbol=${encoded}&period=${encodeURIComponent(nextPeriod)}&interval=1d`),
        fetchJson(`${BACKEND}/api/stock/quote?symbol=${encoded}`).catch(() => null),
      ]);
      const rows = history?.data || history || [];
      if (!Array.isArray(rows) || !rows.length) throw new Error("No daily candles were returned for this symbol.");
      setSwingDetailData(rows);
      setSwingDetailQuote(quote);
    } catch (err) {
      setSwingDetailData([]);
      setSwingDetailQuote(null);
      setSwingDetailError(err?.message || "Could not load daily swing-trading data.");
    } finally {
      setSwingDetailLoading(false);
    }
  }

  function addSwingDetailToScanner() {
    const clean = String(swingDetailSymbol || "").trim().toUpperCase();
    if (!clean) return;
    const existing = swingScanSymbols.split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
    const next = Array.from(new Set([clean, ...existing])).slice(0, 30);
    setSwingScanSymbols(next.join(","));
    setSwingScanError("");
  }

  async function runSwingScan() {
    setSwingScanBusy(true); setSwingScanError(""); setSwingScanResult(null); setSwingNewMatches([]);
    try {
      const params = new URLSearchParams({risk_rupees: swingRiskBudget, allocation_rupees: swingAllocation});
      const data = await fetchJson(`${BACKEND}/api/swing-lab/recommend?${params}`);
      const matches = (data?.results || []).filter(row => String(row.status || "").startsWith("REVIEW_CANDIDATE"));
      setSwingScanResult(data);
      setSwingNewMatches(matches);
      if (swingNotificationsEnabled && "Notification" in window && Notification.permission === "granted") {
        const previousMatches = swingNotifiedSymbolsRef.current;
        matches.forEach(row => {
          const symbol = String(row.symbol || "").toUpperCase();
          if (!symbol || previousMatches.has(symbol)) return;
          try {
            new Notification(`Swing setup matched: ${symbol}`, {
              body: `${row.setup || "Technical setup"} · Score ${row.score ?? "—"}/100. Review price, stop and warnings before any order.`,
              tag: `swing-match-${symbol}`,
            });
          } catch { /* In-app matches remain available if OS notifications fail. */ }
        });
        swingNotifiedSymbolsRef.current = new Set(matches.map(row => String(row.symbol || "").toUpperCase()).filter(Boolean));
      } else {
        swingNotifiedSymbolsRef.current = new Set();
      }
    } catch (err) {
      setSwingScanError(err?.message || "Swing scan failed. Check backend and historical-data availability.");
    } finally { setSwingScanBusy(false); }
  }

  function exportSwingScanCsv() {
    const rows = swingScanResult?.results || [];
    if (!rows.length) return;
    const columns = ["symbol","status","score","setup","setup_matches","close","rsi14","atr_pct","volume_ratio","return_20d_pct","return_63d_pct","relative_strength_vs_nifty_pct_points","entry_reference","stop_reference","target_2r_reference","quantity_at_risk_budget","position_value_rupees","planned_price_risk_rupees","reasons","warnings"];
    const quoteCsv = value => `"${String(value == null ? "" : Array.isArray(value) ? value.join("; ") : value).replace(/"/g, '""')}"`;
    const csv = [columns.join(","), ...rows.map(row => columns.map(key => quoteCsv(row[key])).join(","))].join("\r\n");
    const url = window.URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "swing_scan_research.csv"; anchor.click();
    window.URL.revokeObjectURL(url);
  }

  async function loadProfitabilityAudit() {
    setProfitabilityAuditLoading(true);
    setProfitabilityAuditError("");
    try {
      setProfitabilityAudit(await fetchJson(`${BACKEND}/api/intelligence/profitability-audit`));
    } catch (err) {
      setProfitabilityAuditError(err?.message || "Could not load profitability audit");
    } finally {
      setProfitabilityAuditLoading(false);
    }
  }

  async function loadStrategyLabCatalog() {
    try {
      const data = await fetchJson(`${BACKEND}/api/strategy-lab/catalog`);
      setStrategyLabCatalog(data?.strategies || []);
    } catch (err) { setStrategyLabError(err?.message || "Could not load strategy catalog"); }
  }
  async function calculateRiskPlan() {
    setRiskPlanBusy(true); setRiskPlanError(""); setRiskPlanResult(null);
    try {
      const params = new URLSearchParams({
        entry_price: riskPlanEntry,
        stop_price: riskPlanStop,
        side: riskPlanSide,
        total_capital_rupees: "100000",
        allocation_rupees: "20000",
        risk_rupees: "250",
        max_open_risk_rupees: "500",
        current_open_risk_rupees: "0",
        reward_risk: "2"
      });
      setRiskPlanResult(await fetchJson(`${BACKEND}/api/strategy-lab/risk-plan?${params}`));
    } catch (err) { setRiskPlanError(err?.message || "Could not calculate risk plan"); }
    finally { setRiskPlanBusy(false); }
  }
  async function runStrategyLabScan() {
    if (!strategyLabSelected.length) { setStrategyLabError("Select at least one strategy."); return; }
    setStrategyLabBusy(true); setStrategyLabError(""); setStrategyLabBacktest(null);
    try {
      const params = new URLSearchParams({symbols: strategyLabSymbol.trim(), interval: strategyLabInterval, strategies: strategyLabSelected.join(",")});
      setStrategyLabScan(await fetchJson(`${BACKEND}/api/strategy-lab/scan?${params}`));
    } catch (err) { setStrategyLabError(err?.message || "Strategy scan failed"); }
    finally { setStrategyLabBusy(false); }
  }
  async function runStrategyLabBacktest(strategyId) {
    setStrategyLabBusy(true); setStrategyLabError(""); setStrategyLabOos(null); setStrategyLabOosError("");
    try {
      const params = new URLSearchParams({symbol: strategyLabSymbol.trim(), strategy: strategyId, interval: strategyLabInterval, risk_rupees: strategyLabRisk, capital_rupees: strategyLabCapital});
      setStrategyLabBacktest(await fetchJson(`${BACKEND}/api/strategy-lab/backtest?${params}`));
    } catch (err) { setStrategyLabError(err?.message || "Backtest failed"); }
    finally { setStrategyLabBusy(false); }
  }
  async function runStrategyLabOutOfSample(strategyId) {
    setStrategyLabOosBusy(true); setStrategyLabOosError(""); setStrategyLabOos(null);
    try {
      const params = new URLSearchParams({symbol: strategyLabSymbol.trim(), strategy: strategyId, interval: strategyLabInterval, risk_rupees: strategyLabRisk, capital_rupees: strategyLabCapital, test_fraction: "0.30"});
      setStrategyLabOos(await fetchJson(`${BACKEND}/api/strategy-lab/out-of-sample?${params}`));
    } catch (err) { setStrategyLabOosError(err?.message || "Out-of-sample test failed"); }
    finally { setStrategyLabOosBusy(false); }
  }
  useEffect(() => {
    if (appPage === "STRATEGIES" && isAuthenticated) {
      if (strategyLabCatalog.length === 0) loadStrategyLabCatalog();
      if (!profitabilityAudit && !profitabilityAuditLoading) loadProfitabilityAudit();
    }
  }, [appPage, isAuthenticated]);
  async function loadStrategyComparison() {
    setComparisonLoading(true);
    setComparisonError("");
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/strategy-comparison?limit=5000`);
      setStrategyComparison(data);
    } catch (err) { setComparisonError(err?.message || "Unable to load strategy comparison"); }
    finally { setComparisonLoading(false); }
  }

  const [liveShadow, setLiveShadow] = useState(null);
  const [liveShadowError, setLiveShadowError] = useState("");
  async function loadLiveShadow() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/live-shadow?limit=500`);
      setLiveShadow(data); setLiveShadowError("");
    } catch (err) { setLiveShadowError(err?.message || "Live shadow unavailable"); }
  }
  useEffect(() => {
    if (appPage !== "INTELLIGENCE" || !isAuthenticated) return;
    loadLiveShadow();
    const timer = setInterval(loadLiveShadow, 60000);
    return () => clearInterval(timer);
  }, [appPage, isAuthenticated]);

  // V10.9: Local monitoring basket. It never creates or submits paper orders.
  // V11.0: persisted shadow positions are separate from the real paper account.
  const [shadowData, setShadowData] = useState(null);
  const [shadowClosedPnlBaseline, setShadowClosedPnlBaseline] = useState(() => {
    try {
      const saved = window.localStorage.getItem(SHADOW_CLOSED_PNL_BASELINE_KEY);
      return saved !== null && Number.isFinite(Number(saved)) ? Number(saved) : null;
    } catch (_) {
      return null;
    }
  });

  useEffect(() => {
    if (!shadowData || shadowClosedPnlBaseline !== null) return;
    const currentTotal = Number(shadowData.gross_closed_pnl ?? 0);
    if (!Number.isFinite(currentTotal)) return;
    setShadowClosedPnlBaseline(currentTotal);
    try {
      window.localStorage.setItem(SHADOW_CLOSED_PNL_BASELINE_KEY, String(currentTotal));
    } catch (_) {
      // If browser storage is unavailable, keep the baseline for this page session.
    }
  }, [shadowData, shadowClosedPnlBaseline]);
  const [predictionAudit, setPredictionAudit] = useState(null);
  const [predictionAuditError, setPredictionAuditError] = useState("");
  async function loadPredictionAudit() { try {const d=await fetchJson(`${BACKEND}/api/intelligence/shadow/prediction-audit`);setPredictionAudit(d);setPredictionAuditError("");} catch(e){setPredictionAuditError(e?.message||"Audit unavailable");} }
  const [shadowError, setShadowError] = useState("");
  const [shadowBusy, setShadowBusy] = useState(false);
  const [shadowQty, setShadowQty] = useState(1);
  // V11.3: explicit user-confirmed paper TEST orders; never automatic promotion.
  const [testPaperQuantities, setTestPaperQuantities] = useState({});
  const [testPaperBusy, setTestPaperBusy] = useState(null);
  const [testPaperResult, setTestPaperResult] = useState("");
  // V12.4: deterministic suggested test defaults. Original saved prediction takes
  // precedence; otherwise use the shadow quantity and an explicitly labeled
  // illustrative 1% stop / 2% target. Never pretend these are scanner predictions.
  function paperTestDefaults(t, auditItem, edited = {}) {
    const entry = Number(t?.entry_price);
    const side = t?.side;
    const predictedQty = Number(auditItem?.predicted_quantity);
    const originalQty = Number.isSafeInteger(predictedQty) && predictedQty > 0 ? predictedQty : null;
    const virtualQty = Number(t?.quantity);
    const qty = originalQty ?? (Number.isSafeInteger(virtualQty) && virtualQty > 0 ? virtualQty : 1);
    const predictedStop = Number(auditItem?.predicted_stop);
    const predictedTarget = Number(auditItem?.predicted_target);
    const valid = (stop, target) => Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && Number.isFinite(target) && stop > 0 && target > 0 && (side === "SELL" ? target < entry && entry < stop : stop < entry && entry < target);
    const savedStop = Number(edited.stop_loss ?? t?.stop_loss);
    const savedTarget = Number(edited.target_price ?? t?.target_price);
    // Tighter intraday defaults: 0.50% stop and 0.75% target.
    // Retain saved/predicted levels only when they fit these distance caps.
    const stopCapPct = 0.005;
    const targetCapPct = 0.0075;
    const withinTighterCaps = (stop, target) => valid(stop, target) &&
      Math.abs(stop - entry) / entry <= stopCapPct &&
      Math.abs(target - entry) / entry <= targetCapPct;
    const suggestedStop = Number((side === "SELL" ? entry * (1 + stopCapPct) : entry * (1 - stopCapPct)).toFixed(2));
    const suggestedTarget = Number((side === "SELL" ? entry * (1 - targetCapPct) : entry * (1 + targetCapPct)).toFixed(2));
    let stop, target, source;
    if (withinTighterCaps(savedStop, savedTarget)) {stop=savedStop;target=savedTarget;source="saved virtual levels (within tighter caps)";}
    else if (withinTighterCaps(predictedStop, predictedTarget)) {stop=predictedStop;target=predictedTarget;source="original scanner prediction (within tighter caps)";}
    else {
      stop=suggestedStop;target=suggestedTarget;
      source=(valid(savedStop,savedTarget)||valid(predictedStop,predictedTarget))
        ? "tighter 0.50% stop / 0.75% target (wider saved/predicted levels capped for testing)"
        : "tighter 0.50% stop / 0.75% target (testing defaults; not scanner-approved)";
    }
    return {qty,qtySource:originalQty!==null?"original predicted quantity":"virtual monitoring quantity",stop,target,source,valid:valid(stop,target)};
  }
  async function usePaperDefaults(t) {
    let auditItem = (predictionAudit?.trades || []).find(a=>String(a.shadow_id)===String(t.id));
    if (!auditItem) {
      try { const response=await fetchJson(`${BACKEND}/api/intelligence/shadow/prediction-audit`); setPredictionAudit(response); auditItem=(response?.trades||[]).find(a=>String(a.shadow_id)===String(t.id)); }
      catch (_) { /* Use labeled virtual/illustrative fallback when audit unavailable. */ }
    }
    const d=paperTestDefaults(t,auditItem,shadowLevelInputs[t.id]||{});
    setTestPaperQuantities(p=>({...p,[t.id]:String(d.qty)}));
    setShadowLevelInputs(p=>({...p,[t.id]:{...p[t.id],stop_loss:String(d.stop),target_price:String(d.target)}}));
    setTestPaperResult(`${t.symbol}: suggested ${d.qty} shares (${d.qtySource}), SL ₹${d.stop.toFixed(2)}, target ₹${d.target.toFixed(2)} (${d.source}). Review before submitting.`);
    return d;
  }
  async function sendPositiveShadowToPaper(t) {
    setTestPaperResult(`${t?.symbol || "Trade"}: checking paper-trade eligibility...`);
    if (!t || t.status !== "OPEN") { setTestPaperResult("This virtual trade is no longer OPEN. Refresh virtual prices."); return; }
    if (!(Number(t.gross_pnl) > 0)) { setTestPaperResult(`${t.symbol}: gross virtual P&L must be positive. Refresh virtual prices.`); return; }
    const defaults = await usePaperDefaults(t);
    const explicitQty = testPaperQuantities[t.id];
    const enteredQty = explicitQty === undefined || explicitQty === "" ? null : Number(explicitQty);
    const qty = enteredQty === null ? defaults.qty : enteredQty;
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 100000) {
      setTestPaperResult(`${t.symbol}: enter a valid test quantity (1–100000). No order submitted.`); return;
    }
    const edited = shadowLevelInputs[t.id] || {};
    const stop = edited.stop_loss !== undefined && edited.stop_loss !== "" ? Number(edited.stop_loss) : defaults.stop;
    const target = edited.target_price !== undefined && edited.target_price !== "" ? Number(edited.target_price) : defaults.target;
    const referenceEntry = Number(t.entry_price);
    if (!(Number.isFinite(stop) && Number.isFinite(target) && stop > 0 && target > 0 &&
      (t.side === "SELL" ? target < referenceEntry && referenceEntry < stop : stop < referenceEntry && referenceEntry < target))) {
      setTestPaperResult(`${t.symbol}: invalid stop/target relative to entry ₹${referenceEntry.toFixed(2)}. No order submitted.`); return;
    }
    // Avoid modifying an existing paper position or its existing protective levels.
    setTestPaperBusy(t.id);
    try {
      setTestPaperResult(`${t.symbol}: checking existing paper positions...`);
      const existing = await fetchJson(`${BACKEND}/api/intraday-paper/positions`);
      const positions = Array.isArray(existing) ? existing : (existing?.positions || []);
      if (positions.some(p => String(p.symbol).toUpperCase() === String(t.symbol).toUpperCase() && Number(p.quantity) > 0)) {
        setTestPaperResult(`${t.symbol}: an intraday paper position already exists. No new order submitted; manage that position separately.`);
        return;
      }
      const approved = window.confirm(
        `SEND TO PAPER (TEST) — ${t.symbol} ${t.side}\n` +
        `Quantity: ${qty} shares\n` +
        `Virtual gross P&L: ${formatMoney(t.gross_pnl)}\n` +
        `Paper stop-loss: ₹${stop.toFixed(2)}\n` +
        `Paper ${t.side === "SELL" ? "buy-back" : "sell"} target: ₹${target.toFixed(2)}\n` +
        `Defaults: ${defaults.qtySource}; ${defaults.source}\n\n` +
        `The paper order uses a NEW market price. Scanner checks may be overridden for this test.\n` +
        `Confirm submission and setting both protective levels?`
      );
      if (!approved) { setTestPaperResult(`${t.symbol}: paper order cancelled. No order submitted.`); return; }
      setTestPaperResult(`${t.symbol}: submitting paper order...`);
      const data = await fetchJson(`${BACKEND}/api/intraday-paper/order`, {
        method: "POST",
        body: JSON.stringify({symbol:t.symbol, side:t.side, quantity:qty,
          order_type:"MARKET", limit_price:null, order_value:null,
          stop_loss:stop, manual_override:true})
      });
      if (data?.status !== "success") {
        setTestPaperResult(`${t.symbol}: order was not confirmed as executed (${data?.status || "unknown status"}). Virtual trade retained.`);
        return;
      }
      // Stop-loss is included in the order; update it explicitly and confirm the target.
      // Never silently claim full protection when either endpoint rejects a level.
      const errors = [];
      try {
        await fetchJson(`${BACKEND}/api/intraday-paper/stop-loss`, {
          method:"POST", body:JSON.stringify({symbol:t.symbol,stop_loss:stop})
        });
      } catch (e) { errors.push(`stop-loss: ${e?.message || "failed"}`); }
      try {
        await fetchJson(`${BACKEND}/api/intraday-paper/target`, {
          method:"POST", body:JSON.stringify({symbol:t.symbol,target_price:target})
        });
      } catch (e) { errors.push(`target: ${e?.message || "failed"}`); }
      let verified = false;
      try {
        const after = await fetchJson(`${BACKEND}/api/intraday-paper/positions`);
        const items = Array.isArray(after) ? after : (after?.positions || []);
        const position = items.find(p => String(p.symbol).toUpperCase() === String(t.symbol).toUpperCase());
        const correctDirection = position?.direction === (t.side === "SELL" ? "SHORT" : "LONG");
        const correctQty = Number(position?.quantity) === qty;
        const correctStop = Math.abs(Number(position?.stop_loss) - stop) < 0.011;
        const correctTarget = Math.abs(Number(position?.exit_target) - target) < 0.011;
        verified = Boolean(correctDirection && correctQty && correctStop && correctTarget);
        if (!verified) errors.push("paper position quantity, direction or protective levels do not match the requested values");
      } catch(e) { errors.push(`position verification: ${e?.message || "failed"}`); }
      if (errors.length || !verified) {
        setTestPaperResult(`${t.symbol}: PAPER ORDER EXECUTED, but protection/verification is incomplete: ${errors.join("; ")}. Check the open paper position immediately. Do not resend this order.`);
        await loadDayTradeData();
        return;
      }
      setTestPaperResult(`${t.symbol}: PAPER ORDER EXECUTED — ${qty} ${t.side} shares; verified stop-loss ₹${stop.toFixed(2)} and ${t.side === "SELL" ? "buy-back" : "sell"} target ₹${target.toFixed(2)}.`);
      // Archive only after verifying the executed paper quantity and BOTH levels.
      try {
        await fetchJson(`${BACKEND}/api/intelligence/shadow/promote/${encodeURIComponent(t.id)}`, {method:"POST"});
        setResearchMonitorBasket(previous => previous.filter(item => !(item.symbol === t.symbol && item.side === t.side)));
        await loadShadowTrades();
      } catch(e) {
        setTestPaperResult(previous => `${previous} Virtual archive failed: ${e?.message || "unknown error"}; do not resend.`);
      }
      await loadDayTradeData();
    } catch(e) {
      setTestPaperResult(`${t.symbol}: ${e?.message || "Order request failed"}. Check Paper Positions before trying again; a network failure may happen after order acceptance.`);
    } finally { setTestPaperBusy(null); }
  }
  const [autoPaperRequested, setAutoPaperRequested] = useState(false); // UI intent only: execution remains blocked until backend is verified.

  // Match an open virtual shadow trade to a real persisted paper-trade opening/add
  // from the same Indian-market date. Close/square-off rows must never count as entry execution.
  function shadowPaperExecutionLabel(shadow) {
    if (String(shadow?.exit_reason || "").toUpperCase() === "PAPER_PROMOTED") {
      return "PAPER EXECUTED";
    }
    const symbol = String(shadow?.symbol || "").trim().toUpperCase();
    const side = String(shadow?.side || "").trim().toUpperCase();
    const shadowDate = String(shadow?.opened_at || shadow?.created_at || "").slice(0, 10);
    if (!symbol || !side) return "NOT EXECUTED · VIRTUAL ONLY";
    const openingActions = new Set(["OPEN_LONG", "OPEN_SHORT", "ADD_LONG", "ADD_SHORT"]);
    const match = (Array.isArray(dayTradeTrades) ? dayTradeTrades : []).some((trade) => {
      const tradeSymbol = String(trade?.symbol || "").trim().toUpperCase();
      const action = String(trade?.action || "").trim().toUpperCase();
      const actionSide = action.endsWith("_LONG") ? "BUY" : action.endsWith("_SHORT") ? "SELL" : "";
      const tradeSide = String(trade?.side || trade?.executed_side || actionSide || "").trim().toUpperCase();
      const tradeDate = String(trade?.timestamp || trade?.executed_at || trade?.created_at || "").slice(0, 10);
      const openingAction = openingActions.has(action) || (!action && Number(trade?.executed_quantity ?? trade?.quantity ?? 0) > 0 && !String(trade?.status || "").toUpperCase().includes("CLOSED"));
      return tradeSymbol === symbol && tradeSide === side && openingAction
        && (!shadowDate || !tradeDate || shadowDate === tradeDate);
    });
    return match ? "PAPER EXECUTED · MATCHED HISTORY" : "NOT EXECUTED · VIRTUAL ONLY";
  }

  async function loadShadowTrades(refresh = false) {
    try {
      if (refresh) await fetchJson(`${BACKEND}/api/intelligence/shadow/refresh`, {method:"POST"});
      const data = await fetchJson(`${BACKEND}/api/intelligence/shadow/trades`);
      setShadowData(data); setShadowError("");
    } catch (e) { setShadowError(e?.message || "Shadow monitor unavailable"); }
  }
  async function startShadowBasket() {
    if (!researchMonitorBasket.length || shadowBusy) return;
    setShadowBusy(true);
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/shadow/open-batch`, {
        method:"POST", body:JSON.stringify({items:researchMonitorBasket.map(item=>({symbol:item.symbol,side:item.side,quantity:Math.max(1,Math.min(100000,Number(shadowQty)||1))}))})
      });
      const errors=(data.results||[]).filter(x=>x.action==="error");
      setShadowError(errors.length ? errors.map(x=>`${x.symbol}: ${x.error}`).join("; ") : "");
      await loadShadowTrades();
    } catch(e) { setShadowError(e?.message || "Unable to start shadow trades"); }
    finally {setShadowBusy(false);}
  }
  const [shadowLevelInputs,setShadowLevelInputs] = useState({});
  async function saveShadowLevels(t) {
    const values=shadowLevelInputs[t.id]||{};
    const stop=Number(values.stop_loss ?? t.stop_loss);
    const target=Number(values.target_price ?? t.target_price);
    if (!Number.isFinite(stop)||!Number.isFinite(target)||stop<=0||target<=0) {
      setShadowError(`${t.symbol}: enter valid positive stop-loss and target prices`);return;
    }
    if (!(t.side==="SELL" ? target<t.entry_price && t.entry_price<stop : stop<t.entry_price && t.entry_price<target)) {
      setShadowError(`${t.symbol}: invalid levels for ${t.side}; target and stop must be on opposite sides of entry`);return;
    }
    setShadowBusy(true);
    try {
      await fetchJson(`${BACKEND}/api/intelligence/shadow/levels/${encodeURIComponent(t.id)}`,{
        method:"POST",body:JSON.stringify({stop_loss:stop,target_price:target})
      });
      setShadowError("");await loadShadowTrades();
    } catch(e){setShadowError(e?.message||"Could not save virtual stop/target");}
    finally{setShadowBusy(false);}
  }
  async function closeShadowTrade(id) {
    setShadowBusy(true);
    try {
      const closed = await fetchJson(`${BACKEND}/api/intelligence/shadow/close/${encodeURIComponent(id)}`,{method:"POST"});
      const t = closed?.trade;
      if (t) setResearchMonitorBasket(previous => previous.filter(item => !(item.symbol === t.symbol && item.side === t.side)));
      await loadShadowTrades();
    }
    catch(e) {setShadowError(e?.message || "Unable to close shadow trade");}
    finally {setShadowBusy(false);}
  }
  useEffect(() => {
    if (appPage!=="INTELLIGENCE" || !isAuthenticated) return;
    loadShadowTrades();
    const timer=setInterval(()=>loadShadowTrades(true),60000);
    return ()=>clearInterval(timer);
  },[appPage,isAuthenticated]);
  // Review-only polling: never invokes the paper order endpoint.
  useEffect(() => {
    if (appPage !== "INTELLIGENCE" || !isAuthenticated || !autoPaperRequested) return;
    loadPredictionAudit();
    const timer = setInterval(loadPredictionAudit, 30000);
    return () => clearInterval(timer);
  }, [appPage, isAuthenticated, autoPaperRequested]);
  const [researchTransfer, setResearchTransfer] = useState(null);
  const [researchMonitorBasket, setResearchMonitorBasket] = useState([]);
  const [researchSelections, setResearchSelections] = useState({});
  const researchKey = (item) => `${String(item?.symbol || "").trim().toUpperCase()}|${String(item?.side || "").toUpperCase()}`;
  function addResearchToBasket(items) {
    const valid = (items || []).filter(item => item?.symbol && ["BUY", "SELL"].includes(item.side));
    if (!valid.length) return;
    setResearchMonitorBasket(previous => {
      const merged = new Map(previous.map(item => [researchKey(item), item]));
      valid.forEach(item => merged.set(researchKey(item), {
        symbol: String(item.symbol).trim().toUpperCase(), side: item.side,
        recordedAt: item.timestamp, stale: Boolean(item.stale),
        checks_passed: item.checks_passed, checks_total: item.checks_total,
        recorded_qualified: Boolean(item.recorded_qualified),
      }));
      return [...merged.values()];
    });
    setResearchSelections({});
    setAppPage("INTELLIGENCE");
    setAnalysisCategory("INTRADAY");
    const first = valid[0];
    const selected = String(first.symbol).trim().toUpperCase();
    setResearchTransfer({symbol:selected,side:first.side,recordedAt:first.timestamp,stale:Boolean(first.stale)});
    setDayTradeSymbol(selected);
    selectStockForCategory(selected, "INTRADAY");
  }
  function sendResearchToIntraday(item) { addResearchToBasket([item]); }
  function viewResearchBasketItem(item) {
    if (!item?.symbol) return;
    setAppPage("LIVE");
    setAnalysisCategory("INTRADAY");
    setResearchTransfer(item);
    setDayTradeSymbol(item.symbol);
    selectStockForCategory(item.symbol, "INTRADAY");
  }
  async function startVirtualTradesForSelected(items, emptyMessage = "Select at least one stock first") {
    const selected = (items || []).filter(item => item?.symbol && ["BUY", "SELL"].includes(String(item.side || "").toUpperCase()));
    if (!selected.length) {
      setShadowError(emptyMessage);
      return;
    }
    if (selected.length > 25) {
      setShadowError("The virtual-trade basket supports up to 25 stocks per start. Select 25 or fewer.");
      return;
    }
    if (shadowBusy) return;

    // Scroll immediately; do not wait for the basket POST or a second GET.
    const scrollToVirtualTradesTable = (attempt = 0) => {
      const tableArea = document.getElementById("market-shadow-trades-table");
      if (tableArea) {
        const pageTop = tableArea.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: Math.max(0, pageTop - 135), behavior: "auto" });
        return true;
      }
      if (attempt < 30) {
        window.requestAnimationFrame(() => scrollToVirtualTradesTable(attempt + 1));
      }
      return false;
    };

    // Make sure the Intelligence page is selected and start scrolling while
    // the backend request runs in parallel.
    addResearchToBasket(selected);
    setAppPage("INTELLIGENCE");
    window.requestAnimationFrame(() => scrollToVirtualTradesTable());
    setShadowBusy(true);
    setShadowError("");

    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/shadow/open-batch`, {
        method: "POST",
        body: JSON.stringify({items: selected.map(item => ({
          symbol: String(item.symbol).trim().toUpperCase(),
          side: String(item.side).toUpperCase(),
          quantity: Math.max(1, Math.min(100000, Number(shadowQty) || 1)),
        }))}),
      });
      const errors = (data.results || []).filter(result => result.action === "error");

      // Refresh trade data in the background; it must not block the page jump.
      void loadShadowTrades().finally(() => {
        window.requestAnimationFrame(() => scrollToVirtualTradesTable());
      });

      setShadowError(errors.length
        ? errors.map(result => `${result.symbol}: ${result.error}`).join("; ")
        : "Virtual trades started (or were already open) for the selected basket. No real orders were placed.");
    } catch (error) {
      setShadowError(error?.message || "Unable to start virtual trades for selected basket");
    } finally {
      setShadowBusy(false);
    }
  }
  function sendSelectedResearchToIntraday() {
    void startVirtualTradesForSelected(researchCandidates.filter(item => researchSelections[researchKey(item)]));
  }
  function sendSelectedScoreAlertsToIntraday() {
    const scoreAlerts = researchWatchlist?.score_alerts || [];
    void startVirtualTradesForSelected(scoreAlerts.filter(item => researchSelections[researchKey(item)]));
  }

  const [researchWatchlist, setResearchWatchlist] = useState(null);
  const researchCandidates = [...(researchWatchlist?.buy_research || []), ...(researchWatchlist?.sell_research || [])];
  const [researchWatchlistError, setResearchWatchlistError] = useState("");
  const [tradeNotificationsEnabled, setTradeNotificationsEnabled] =
    useState(() => {
      if (!("Notification" in window)) return false;
      return Notification.permission === "granted";
    });
  const [marketDirectionAlert, setMarketDirectionAlert] = useState(null);
  const [marketDirectionError, setMarketDirectionError] = useState("");
  const notifiedMarketDirectionRef = React.useRef("");

  async function loadMarketDirectionAlert() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/market-direction`);
      setMarketDirectionAlert(data);
      setMarketDirectionError("");
      const direction = String(data?.direction || "WAIT").toUpperCase();
      const marketOpen = data?.market_open === true;
      const fingerprint = `${data?.trade_date || ""}|${direction}`;
      if (marketOpen && ["BUY", "SELL"].includes(direction) && fingerprint !== notifiedMarketDirectionRef.current &&
          tradeNotificationsEnabled && "Notification" in window && Notification.permission === "granted") {
        notifiedMarketDirectionRef.current = fingerprint;
        {
          const message = direction === "BUY"
            ? "NIFTY direction is bullish. Start reviewing BUY opportunities."
            : "NIFTY direction is bearish. Start reviewing SELL/short opportunities.";
          const notification = new Notification(`Market direction: ${direction} favoured`, {
            body: `${message} This is a market-direction reminder, not a trade entry signal.`,
            requireInteraction: true,
            tag: `market-direction-${fingerprint}`,
          });
          notification.onclick = () => { window.focus(); notification.close(); };
        }
      }
    } catch (err) {
      setMarketDirectionError(err?.message || "Unable to load market direction");
    }
  }
  useEffect(() => {
    if (appPage !== "INTELLIGENCE" || !isAuthenticated) return;
    loadMarketDirectionAlert();
    const interval = setInterval(loadMarketDirectionAlert, 30000);
    return () => clearInterval(interval);
  }, [appPage, isAuthenticated, tradeNotificationsEnabled]);
  async function loadResearchWatchlist() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/research-watchlist?limit=1000`);
      setResearchWatchlist(data);
      setResearchWatchlistError("");
    } catch (err) { setResearchWatchlistError(err?.message || "Unable to load research watchlist"); }
  }
  useEffect(() => {
    if (appPage !== "INTELLIGENCE" || !isAuthenticated) return;
    loadResearchWatchlist();
    const interval = setInterval(loadResearchWatchlist, 30000);
    return () => clearInterval(interval);
  }, [appPage, isAuthenticated]);

  const [smartWatchlist, setSmartWatchlist] = useState(null);
  const [smartWatchlistError, setSmartWatchlistError] = useState("");
  async function loadSmartWatchlist() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/smart-watchlist?limit=1000`);
      setSmartWatchlist(data);
      setSmartWatchlistError("");
    } catch (err) { setSmartWatchlistError(err?.message || "Unable to load watchlist"); }
  }
  useEffect(() => {
    if (appPage !== "INTELLIGENCE" || !isAuthenticated) return;
    loadSmartWatchlist();
    const interval = setInterval(loadSmartWatchlist, 30000);
    return () => clearInterval(interval);
  }, [appPage, isAuthenticated]);

  const [intelligenceError, setIntelligenceError] = useState("");
  async function loadIntelligence() {
    setIntelligenceLoading(true);
    setIntelligenceError("");
    try {
      const data = await fetchJson(`${BACKEND}/api/intelligence/overview?limit=200`);
      setIntelligence(data);
    } catch (err) { setIntelligenceError(err?.message || "Unable to load intelligence data"); }
    finally { setIntelligenceLoading(false); }
  }
  async function downloadIntelligence(kind, format) {
    try {
      const token = window.localStorage.getItem("stock_analyser_auth_token");
      const response = await fetch(`${BACKEND}/api/intelligence/export?kind=${kind}&format=${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `intelligence_${kind}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setIntelligenceError(err?.message || "Export failed"); }
  }
  useEffect(() => { if (appPage === "INTELLIGENCE" && isAuthenticated) { loadIntelligence(); loadStrategyComparison(); } }, [appPage, isAuthenticated]);

  // ==========================================================
  // INTRADAY STATE
  // ==========================================================

  const [intraday, setIntraday] = useState(null);
  const [intradayData, setIntradayData] = useState([]);

  const [intradayLoading, setIntradayLoading] = useState(false);
  const [intradayError, setIntradayError] = useState("");

  const [intradayInterval, setIntradayInterval] = useState("5m");
  const [intradayChartPeriod, setIntradayChartPeriod] = useState("1d");
  const [intradayChartType, setIntradayChartType] = useState("CANDLE");

  // ==========================================================
  // INTRADAY OPPORTUNITY SCANNER STATE
  // ==========================================================

  const [scannerData, setScannerData] = useState([]);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [scannerUpdatedAt, setScannerUpdatedAt] = useState("");
  const [scannerMarketStatus, setScannerMarketStatus] = useState("—");
  const [scannerSessionPhase, setScannerSessionPhase] = useState("—");
  const [scannerPhaseMessage, setScannerPhaseMessage] = useState("");
  const [liveIST, setLiveIST] = useState(new Date());

  const [todaySuggestionSummary, setTodaySuggestionSummary] = useState(null);
  const [scannerFilter, setScannerFilter] = useState("ALL");
  const [multiTimeframeData, setMultiTimeframeData] = useState([]);
  const [multiTimeframeLoading, setMultiTimeframeLoading] = useState(false);
  const [multiTimeframeError, setMultiTimeframeError] = useState("");
  const [multiTimeframeUpdatedAt, setMultiTimeframeUpdatedAt] = useState("");
  const [multiTimeframeMeta, setMultiTimeframeMeta] = useState(null);
  const [executionReminder, setExecutionReminder] = useState(null);
  const [wholeMarketPretrade, setWholeMarketPretrade] = useState(null);
  // Only show stocks where 5m and 15m agree on the same BUY/SELL direction.
  const alignedMultiTimeframeData = multiTimeframeData.filter((row) => {
    const signal5m = String(row?.signal_5m || "").toUpperCase();
    const signal15m = String(row?.signal_15m || "").toUpperCase();
    const alignment = String(row?.alignment || "").toUpperCase();

    return (
      alignment === "ALIGNED" &&
      (signal5m === "BUY" || signal5m === "SELL") &&
      signal5m === signal15m
    );
  });
  const [strategyMode, setStrategyMode] = useState("NORMAL");
  const [strategyModeLoading, setStrategyModeLoading] = useState(false);

  const notifiedQualifiedSignalsRef = React.useRef(new Set());

  // ==========================================================
  // PAPER TRADING STATE
  // ==========================================================

  const [paperAccount, setPaperAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);

  const [paperSymbol, setPaperSymbol] = useState("RELIANCE");
  const [orderSide, setOrderSide] = useState("BUY");
  const [quantity, setQuantity] = useState(1);
  const [paperOrderType, setPaperOrderType] = useState("MARKET");
  const [paperOrderPrice, setPaperOrderPrice] = useState("");
  const [paperStopLoss, setPaperStopLoss] = useState("");

  // Search and route a stock to Normal Paper Trading or Intraday Trading
  const [paperStockSearch, setPaperStockSearch] = useState("");
  const [paperSearchSelected, setPaperSearchSelected] = useState("");
  const [paperSendMessage, setPaperSendMessage] = useState("");

  // Latest price shown for the stock selected in Paper Trading
  const [paperQuote, setPaperQuote] = useState(null);
  const [paperPriceLoading, setPaperPriceLoading] = useState(false);
  const [paperPriceError, setPaperPriceError] = useState("");

  // Intraday paper trading: supports both LONG and SHORT positions.
  const [dayTradeSymbol, setDayTradeSymbol] = useState("RELIANCE");
  const [dayTradeSide, setDayTradeSide] = useState("BUY");
  const [dayTradeQuantity, setDayTradeQuantity] = useState(1);
  const [dayTradeManualOrderValue, setDayTradeManualOrderValue] = useState("");
  const [dayTradeOrderType, setDayTradeOrderType] = useState("MARKET");
  const [dayTradeOrderPrice, setDayTradeOrderPrice] = useState("");
  const [dayTradeStopLoss, setDayTradeStopLoss] = useState("");
  const [dayTradeTarget1, setDayTradeTarget1] = useState("");
  const [dayTradeQuote, setDayTradeQuote] = useState(null);
  const [dayTradeQuoteLoading, setDayTradeQuoteLoading] = useState(false);
  const [dayTradeQuoteError, setDayTradeQuoteError] = useState("");
  const [dayTradeAccount, setDayTradeAccount] = useState(null);
  const [dayTradePositions, setDayTradePositions] = useState([]);
  const [dayTradeTrades, setDayTradeTrades] = useState([]);
  const intradayHistoryRef = useRef(null);
  const [dayTradePendingOrders, setDayTradePendingOrders] = useState([]);
  const [dayTradeMessage, setDayTradeMessage] = useState("");
  const [dayTradeCandidateStatus, setDayTradeCandidateStatus] = useState(null);
  const [dayTradeCandidateStatusError, setDayTradeCandidateStatusError] = useState("");
  const [dayTradeTargetInputs, setDayTradeTargetInputs] = useState({});
  const [dayTradeStopLossInputs, setDayTradeStopLossInputs] = useState({});
  const [dayTradeManagementAlerts, setDayTradeManagementAlerts] = useState([]);
  const notifiedTradeManagementRef = useRef(new Set());

  // Build a resilient TODAY summary from persisted intraday trade history.
  // This remains available even if the optional scanner summary request fails.
  const localTodayTradeSummary = (() => {
    const nowIST = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );
    const todayKey = [
      nowIST.getFullYear(),
      String(nowIST.getMonth() + 1).padStart(2, "0"),
      String(nowIST.getDate()).padStart(2, "0"),
    ].join("-");

    const completedToday = (Array.isArray(dayTradeTrades) ? dayTradeTrades : []).filter(
      (trade) => {
        const action = String(trade?.action || "").toUpperCase();
        const isCompleted =
          action.includes("CLOSE") ||
          action.includes("SQUARE") ||
          action.includes("EXIT");

        if (!isCompleted || !trade?.timestamp) return false;

        const raw = String(trade.timestamp).trim();
        let tradeDateKey = "";

        if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
          const parsed = new Date(raw);
          if (!Number.isNaN(parsed.getTime())) {
            const parts = new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Kolkata",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(parsed);
            const get = (type) => parts.find((p) => p.type === type)?.value || "";
            tradeDateKey = `${get("year")}-${get("month")}-${get("day")}`;
          }
        } else {
          // Legacy DB timestamps already store the IST wall-clock date.
          tradeDateKey = raw.slice(0, 10);
        }

        return tradeDateKey === todayKey;
      }
    );

    const pnlValues = completedToday.map((trade) => Number(trade?.realized_pnl || 0));
    const wins = pnlValues.filter((pnl) => pnl > 0).length;
    const losses = pnlValues.filter((pnl) => pnl < 0).length;
    const breakeven = pnlValues.filter((pnl) => pnl === 0).length;
    const realizedPnl = pnlValues.reduce((sum, pnl) => sum + pnl, 0);
    const decisiveTrades = wins + losses;

    return {
      completed_trades: completedToday.length,
      wins,
      losses,
      breakeven,
      win_rate: decisiveTrades > 0 ? (wins / decisiveTrades) * 100 : 0,
      realized_pnl: realizedPnl,
    };
  })();

  // Local nightly learning profile
  const [learningProfile, setLearningProfile] = useState(null);
  const [learningProfileLoading, setLearningProfileLoading] = useState(false);
  const [learningProfileError, setLearningProfileError] = useState("");

  const [orderMessage, setOrderMessage] = useState("");

  // ==========================================================
  // BACKEND HEALTH
  // ==========================================================

  async function checkBackend() {
    try {
      const data = await fetchJson(`${BACKEND}/api/health`);

      if (data?.status === "ok") {
        setBackendStatus("Connected");
      } else {
        setBackendStatus("Connected");
      }
    } catch (err) {
      console.error(err);
      setBackendStatus("Disconnected");
    }
  }

  // ==========================================================
  // LOAD DAILY STOCK DATA
  // ==========================================================

  async function loadStock(selectedSymbol) {
    if (!selectedSymbol) return;

    setLoading(true);
    setError("");

    try {
      const encodedSymbol = encodeURIComponent(selectedSymbol);

      const [quoteData, analysisData, historyData] = await Promise.all([
        fetchJson(`${BACKEND}/api/stock/quote?symbol=${encodedSymbol}`),

        fetchJson(`${BACKEND}/api/stock/analysis?symbol=${encodedSymbol}`),

        fetchJson(
          `${BACKEND}/api/stock/history?symbol=${encodedSymbol}&period=${period}&interval=1d`
        ),
      ]);

      setSymbol(selectedSymbol);
      setQuote(quoteData);
      setAnalysis(analysisData);
      setChartData(historyData?.data || historyData || []);

      setError("");
    } catch (err) {
      console.error("Stock loading error:", err);

      setError(
        `Unable to load ${selectedSymbol}. ${
          err?.message || "Please check the backend."
        }`
      );
    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // LOAD INTRADAY DATA
  // ==========================================================

  async function loadIntraday(
    selectedSymbol = symbol,
    selectedPeriod = intradayChartPeriod,
    selectedInterval = intradayInterval
  ) {
    if (!selectedSymbol) return;

    setIntradayLoading(true);
    setIntradayError("");

    try {
      const encodedSymbol = encodeURIComponent(selectedSymbol);

      const [analysisData, historyData] = await Promise.all([
        fetchJson(
          `${BACKEND}/api/stock/intraday-analysis?symbol=${encodedSymbol}&interval=${selectedInterval}`
        ),

        fetchJson(
          `${BACKEND}/api/stock/intraday-history?symbol=${encodedSymbol}&interval=${selectedInterval}&period=${selectedPeriod}`
        ),
      ]);

      setIntraday(analysisData);

      setIntradayData(historyData?.data || historyData || []);

      setIntradayError("");
    } catch (err) {
      console.error("Intraday loading error:", err);

      setIntradayError(
        err?.message ||
          "Intraday data could not be loaded. Try refreshing after market hours or during market hours."
      );

      setIntraday(null);
      setIntradayData([]);
    } finally {
      setIntradayLoading(false);
    }
  }

  // ==========================================================
  // LOAD INTRADAY OPPORTUNITY SCANNER
  // ==========================================================

  useEffect(() => {
    const tick = () => setLiveIST(new Date());
    tick();
    const timer = window.setInterval(tick, 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!("Notification" in window)) return;

    // The app never turns Qualified Alerts off after browser permission is granted.
    if (Notification.permission === "granted") {
      setTradeNotificationsEnabled(true);
    } else {
      setTradeNotificationsEnabled(false);
    }
  }, []);

  async function enableTradeNotifications() {
    if (!("Notification" in window)) {
      alert("This browser does not support desktop notifications.");
      return;
    }

    if (Notification.permission === "granted") {
      setTradeNotificationsEnabled(true);
      return;
    }

    if (Notification.permission === "denied") {
      setTradeNotificationsEnabled(false);
      alert(
        "Notifications are blocked for this site. Please allow notifications in your browser site settings."
      );
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission === "granted") {
      setTradeNotificationsEnabled(true);
      new Notification("Stock Analyzer alerts enabled", {
        body: "Market-direction reminders and qualified BUY/SELL alerts are enabled for this site.",
      });
    } else {
      setTradeNotificationsEnabled(false);
      alert(
        "Please allow notifications for this site to receive market-direction reminders and qualified BUY/SELL alerts."
      );
    }
  }

  function notifyQualifiedTrades(results = []) {
    if (
      !tradeNotificationsEnabled ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) return;

    results.forEach((stock) => {
      const signal = String(stock?.signal ?? "").toUpperCase();
      const stockSymbol = String(stock?.symbol ?? "").toUpperCase();
      if (!stock?.qualified || !["BUY", "SELL"].includes(signal) || !stockSymbol) return;

      const fingerprint = stock?.signal_id || [
        stockSymbol, signal, stock?.entry_price ?? "", stock?.stop_loss ?? "", stock?.target_1 ?? ""
      ].join("|");
      if (notifiedQualifiedSignalsRef.current.has(fingerprint)) return;
      notifiedQualifiedSignalsRef.current.add(fingerprint);

      const entry = Number(stock?.entry_price ?? stock?.entry);
      const stopLoss = Number(stock?.stop_loss);
      const target1 = Number(stock?.target_1 ?? stock?.target1);
      const target2 = Number(stock?.target_2 ?? stock?.target2);
      const quality = Number(stock?.setup_quality ?? 0);
      const rr = Number(stock?.risk_reward ?? 0);

      const details = [`${stockSymbol}: ${signal}`, `Quality ${quality.toFixed(1)}/10`];
      if (Number.isFinite(entry)) details.push(`Entry ₹${entry.toFixed(2)}`);
      if (Number.isFinite(stopLoss)) details.push(`SL ₹${stopLoss.toFixed(2)}`);
      if (Number.isFinite(target1)) details.push(`T1 ₹${target1.toFixed(2)}`);
      if (Number.isFinite(target2)) details.push(`T2 ₹${target2.toFixed(2)}`);
      if (Number.isFinite(rr) && rr > 0) details.push(`R:R 1:${rr.toFixed(2)}`);

      const notification = new Notification(`Qualified ${signal} setup: ${stockSymbol}`, {
        body: `${details.join(" • ")} • Review before execution.`,
        requireInteraction: true,
        tag: `qualified-trade-${fingerprint}`,
      });
      notification.onclick = () => {
        window.focus();
        openScannerStock(stockSymbol);
        notification.close();
      };
    });
  }

  async function loadScanner(force = false) {
    setScannerLoading(true);
    setScannerError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday/scanner?interval=${encodeURIComponent(
          intradayInterval
        )}&force=${force ? "true" : "false"}`
      );

      const scannerResults = data?.results || [];
      setScannerData(scannerResults);
      notifyQualifiedTrades(scannerResults);
      setScannerUpdatedAt(data?.timestamp || "");
      setScannerMarketStatus(data?.market_status || "—");
      setScannerSessionPhase(data?.session_phase || "—");
      setScannerPhaseMessage(data?.phase_message || "");
      setTodaySuggestionSummary(data?.today_summary || null);
      if (data?.execution_reminder) setExecutionReminder(data.execution_reminder);
      if (data?.whole_market_pretrade) setWholeMarketPretrade(data.whole_market_pretrade);
      setScannerError("");
    } catch (err) {
      console.error("Scanner loading error:", err);

      // Do not overwrite a healthy background scanner snapshot with a stale
      // browser-level "Failed to fetch" message. The 5m + 15m snapshot is the
      // preferred fallback for the opportunity panel.
      if (!multiTimeframeMeta?.timestamp && multiTimeframeData.length === 0) {
        setScannerError(
          err?.message || "Unable to load intraday opportunities."
        );
      }
    } finally {
      setScannerLoading(false);
    }
  }

  const multiTimeframeRequestRef = useRef(false);

  async function loadMultiTimeframeScanner(force = false) {
    if (multiTimeframeRequestRef.current) return;

    multiTimeframeRequestRef.current = true;
    setMultiTimeframeLoading(true);
    setMultiTimeframeError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday/scanner-multitimeframe/latest`
      );

      const latestResults = Array.isArray(data?.results) ? data.results : [];

      setMultiTimeframeData(latestResults);
      setMultiTimeframeMeta(data || null);
      setMultiTimeframeUpdatedAt(data?.timestamp || "");
      if (data?.execution_reminder) setExecutionReminder(data.execution_reminder);
      if (data?.whole_market_pretrade) setWholeMarketPretrade(data.whole_market_pretrade);

      // Keep the top opportunity panel synchronized with the healthy
      // background 5m + 15m snapshot. This prevents a transient failure in
      // /api/intraday/scanner from leaving stale "Failed to fetch" state.
      setScannerMarketStatus(data?.market_status || "—");
      setScannerSessionPhase(data?.session_phase || "—");
      setScannerPhaseMessage(data?.phase_message || "");
      setScannerUpdatedAt(data?.timestamp || "");

      if (latestResults.length > 0 || data?.market_status || data?.session_phase) {
        setScannerData(latestResults);
        notifyQualifiedTrades(latestResults);
        setScannerError("");
      }

      setMultiTimeframeError("");
    } catch (err) {
      console.error("Multi-timeframe scanner error:", err);
      setMultiTimeframeError(
        err?.message || "Unable to load 5m + 15m scanner analysis."
      );
    } finally {
      multiTimeframeRequestRef.current = false;
      setMultiTimeframeLoading(false);
    }
  }

  async function loadExecutionReminder() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intraday/execution-reminder`);
      setExecutionReminder(data?.reminder || null);
      if (data?.whole_market_pretrade && Object.keys(data.whole_market_pretrade).length > 0) {
        setWholeMarketPretrade(data.whole_market_pretrade);
      }
    } catch (err) {
      console.warn("Execution reminder loading error:", err);
    }
  }

  async function loadStrategyMode() {
    try {
      const data = await fetchJson(`${BACKEND}/api/intraday/strategy-mode`);
      setStrategyMode(String(data?.mode || "NORMAL").toUpperCase());
    } catch (err) {
      console.error("Strategy mode loading error:", err);
    }
  }

  async function switchStrategyMode() {
    const nextMode = strategyMode === "INVERSE" ? "NORMAL" : "INVERSE";
    setStrategyModeLoading(true);

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday/strategy-mode?mode=${encodeURIComponent(nextMode)}`,
        { method: "POST" }
      );

      const appliedMode = String(data?.mode || nextMode).toUpperCase();
      setStrategyMode(appliedMode);

      // Never leave NORMAL levels in the order form after switching to INVERSE
      // (or vice versa). Fresh levels are loaded from the new-mode analysis.
      setDayTradeStopLoss("");
      setDayTradeTarget1("");
      setDayTradeOrderPrice("");
      setPaperStopLoss("");
      setPaperOrderPrice("");

      // Immediately rebuild both scanner views and the selected stock under
      // the newly selected strategy mode.
      await Promise.allSettled([
        loadScanner(true),
        loadMultiTimeframeScanner(true),
        loadIntraday(symbol, intradayChartPeriod, intradayInterval),
      ]);
    } catch (err) {
      console.error("Strategy mode switch error:", err);
      setMultiTimeframeError(
        err?.message || "Unable to switch strategy mode."
      );
    } finally {
      setStrategyModeLoading(false);
    }
  }

  function openScannerStock(stockSymbol) {
    if (!stockSymbol) return;

    setAnalysisCategory("INTRADAY");
    setIntradayChartType("CANDLE");

    setSymbol(stockSymbol);
    setSearch("");
    setSearchResults([]);

    loadStock(stockSymbol);
    // The backend applies the currently active NORMAL/INVERSE strategy mode,
    // so the detailed Intraday Analyzer always matches the suggestion mode.
    loadIntraday(stockSymbol, intradayChartPeriod, intradayInterval);

    // Go directly to the Full Intraday Analysis section,
    // not to the top of the page.
    window.setTimeout(() => {
      const analysisSection = document.getElementById(
        "intraday-full-analysis"
      );

      if (analysisSection) {
        analysisSection.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 150);
  }

  // ==========================================================
  // SELECT STOCK FOR CURRENT CATEGORY
  // ==========================================================

  function selectStockForCategory(
    selectedSymbol,
    category = analysisCategory
  ) {
    if (!selectedSymbol) return;

    setSymbol(selectedSymbol);
    setSearch("");
    setSearchResults([]);

    // Load quote/basic stock data for both categories.
    loadStock(selectedSymbol);

    if (category === "INTRADAY") {
      setIntradayChartType("CANDLE");
      loadIntraday(selectedSymbol);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeAnalysisCategory(category) {
    setAnalysisCategory(category);

    // Refresh the selected stock using the analysis type chosen at the top.
    if (category === "INTRADAY") {
      setIntradayChartType("CANDLE");
      loadStock(symbol);
      loadIntraday(symbol);
    } else {
      loadStock(symbol);
    }
  }

  // ==========================================================
  // SEARCH STOCKS
  // ==========================================================

  async function searchStocks() {
    const query = search.trim();

    if (!query) {
      setSearchResults([]);
      return;
    }

    try {
      const data = await fetchJson(
        `${BACKEND}/api/search?q=${encodeURIComponent(query)}`
      );

      setSearchResults(data?.results || data || []);
    } catch (err) {
      console.error("Search error:", err);
      setSearchResults([]);
    }
  }

  // ==========================================================
  // LOCAL NIGHTLY LEARNING PROFILE
  // ==========================================================

  async function loadLearningProfile(refreshHistory = false) {
    setLearningProfileLoading(true);

    try {
      if (refreshHistory) {
        await fetchJson(`${BACKEND}/api/learning/refresh`, {
          method: "POST",
        });
      }

      const data = await fetchJson(`${BACKEND}/api/learning/profile`);
      setLearningProfile(data);
      setLearningProfileError("");

      // Keep every visible history/account panel in step with the refreshed
      // archive/runtime data instead of requiring a second manual refresh.
      await Promise.allSettled([
        loadDayTradeData(),
        loadPaperData?.(),
        loadScanner?.(true),
        loadMultiTimeframeScanner?.(true),
      ]);
    } catch (err) {
      console.error("Learning/history refresh error:", err);
      setLearningProfileError(
        err?.message || "Unable to refresh history and learning."
      );
    } finally {
      setLearningProfileLoading(false);
    }
  }

  // ==========================================================
  // PAPER ACCOUNT
  // ==========================================================

  async function loadPaperData() {
    try {
      const [accountData, positionsData, tradesData] = await Promise.all([
        fetchJson(`${BACKEND}/api/paper/account`),

        fetchJson(`${BACKEND}/api/paper/positions`),

        fetchJson(`${BACKEND}/api/paper/trades`),
      ]);

      setPaperAccount(accountData);
      setPositions(positionsData?.positions || positionsData || []);
      setTrades(tradesData?.trades || tradesData || []);
    } catch (err) {
      console.error("Paper trading data error:", err);
    }
  }

  // ==========================================================
  // LOAD PAPER TRADING STOCK PRICE
  // ==========================================================

  const paperQuoteRequestRef = useRef({ symbol: "", running: false });

  async function loadPaperQuote(selectedSymbol = paperSymbol, force = false) {
    const clean = String(selectedSymbol || "").trim().toUpperCase();
    if (!clean) return;

    if (
      paperQuoteRequestRef.current.running &&
      paperQuoteRequestRef.current.symbol === clean
    ) {
      return;
    }

    paperQuoteRequestRef.current = { symbol: clean, running: true };
    setPaperPriceLoading(true);
    setPaperPriceError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/stock/fast-price?symbol=${encodeURIComponent(clean)}&refresh=${
          force ? "true" : "false"
        }`
      );

      setPaperQuote((previous) => ({
        ...(previous || {}),
        ...data,
        symbol: clean,
      }));
      setPaperPriceError("");
    } catch (err) {
      console.error("Paper stock price error:", err);
      setPaperPriceError(
        err?.message || "Unable to load the latest stock price."
      );
    } finally {
      paperQuoteRequestRef.current = { symbol: clean, running: false };
      setPaperPriceLoading(false);
    }
  }

  // ==========================================================
  // PLACE PAPER ORDER
  // ==========================================================

  async function placeOrder() {
    setOrderMessage("");

    const qty = Number(quantity);

    if (!Number.isFinite(qty) || qty <= 0) {
      setOrderMessage("Please enter a valid quantity.");
      return;
    }

    const selectedOrderPrice =
      paperOrderType === "LIMIT"
        ? Number(paperOrderPrice)
        : null;

    if (
      paperOrderType === "LIMIT" &&
      (!Number.isFinite(selectedOrderPrice) || selectedOrderPrice <= 0)
    ) {
      setOrderMessage("Please enter a valid Buy / Sell price.");
      return;
    }

    try {
      const data = await fetchJson(`${BACKEND}/api/paper/order`, {
        method: "POST",

        body: JSON.stringify({
          symbol: paperSymbol,
          side: orderSide,
          quantity: qty,
          order_type: paperOrderType,
          limit_price:
            paperOrderType === "LIMIT" ? selectedOrderPrice : null,
          stop_loss:
            paperStopLoss === "" ? null : Number(paperStopLoss),
        }),
      });

      setOrderMessage(
        data?.message ||
          `${orderSide} order placed successfully for ${qty} share(s) of ${paperSymbol}.`
      );

      await loadPaperData();
    } catch (err) {
      console.error("Order error:", err);

      setOrderMessage(
        `Order failed: ${err?.message || "Unable to place order."}`
      );
    }
  }

  // ==========================================================
  // REMOVE / UNDO PAPER ORDER
  // ==========================================================

  async function removePaperOrder(trade) {
    if (!trade?.id) {
      setOrderMessage(
        "This older paper order has no order ID. Reset the paper account or place a new order first."
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove this ${trade.side || ""} paper order for ${
        trade.quantity || 0
      } share(s) of ${trade.symbol || "this stock"}? Cash and positions will be recalculated.`
    );

    if (!confirmed) return;

    try {
      const data = await fetchJson(
        `${BACKEND}/api/paper/order/${encodeURIComponent(trade.id)}`,
        {
          method: "DELETE",
        }
      );

      setOrderMessage(data?.message || "Paper order removed successfully.");
      await loadPaperData();
    } catch (err) {
      console.error("Remove order error:", err);
      setOrderMessage(
        `Unable to remove order: ${err?.message || "Request failed."}`
      );
    }
  }

  // ==========================================================
  // RESET PAPER ACCOUNT
  // ==========================================================

  async function resetPaperAccount() {
    try {
      const data = await fetchJson(`${BACKEND}/api/paper/reset`, {
        method: "POST",
      });

      setOrderMessage(data?.message || "Paper account reset successfully.");

      await loadPaperData();
    } catch (err) {
      console.error("Reset error:", err);

      setOrderMessage(
        `Reset failed: ${err?.message || "Unable to reset account."}`
      );
    }
  }

  // ==========================================================
  // USE INTRADAY SIGNAL FOR PAPER ORDER
  // ==========================================================

  function useIntradaySignal() {
    if (!intraday) return;

    const signalSide =
      intraday.signal === "BUY"
        ? "BUY"
        : intraday.signal === "SELL"
          ? "SELL"
          : null;

    if (!signalSide) {
      setOrderMessage(
        "There is currently no strong BUY/SELL intraday signal."
      );
      setDayTradeMessage(
        "There is currently no strong BUY/SELL intraday signal."
      );
      return;
    }

    const signalQuantity =
      Number(intraday.suggested_quantity) > 0
        ? Math.floor(Number(intraday.suggested_quantity))
        : 1;

    const signalStopLoss =
      intraday.stop_loss ??
      intraday.stop ??
      intraday.stop_price ??
      "";

    const signalEntry =
      intraday.entry_price ??
      intraday.entry ??
      intraday.current_price ??
      "";

    const signalTarget1 =
      intraday.target_1 ??
      intraday.target1 ??
      "";

    // Keep the normal paper form synchronized for compatibility.
    setOrderSide(signalSide);

    if (PAPER_STOCK_OPTIONS.some(([stockSymbol]) => stockSymbol === symbol)) {
      setPaperSymbol(symbol);
    }

    setQuantity(signalQuantity);

    // IMPORTANT: load the analysis directly into INTRADAY PAPER TRADING.
    // After this, the user only needs to press BUY or SELL.
    setDayTradeSymbol(symbol);
    setDayTradeSide(signalSide);
    setDayTradeQuantity(signalQuantity);
    setDayTradeManualOrderValue("");
    setDayTradeStopLoss(
      signalStopLoss !== null &&
      signalStopLoss !== undefined &&
      signalStopLoss !== ""
        ? String(signalStopLoss)
        : ""
    );
    setDayTradeTarget1(
      signalTarget1 !== null &&
      signalTarget1 !== undefined &&
      signalTarget1 !== ""
        ? String(signalTarget1)
        : ""
    );

    setDayTradeMessage(
      `${strategyMode} ${signalSide} setup loaded for ${symbol}. ` +
      `Entry, stop-loss and target levels are synchronized with the active strategy mode.`
    );

    // Use MARKET by default so pressing BUY/SELL executes at the latest
    // market price. The analysis entry value is retained only as a
    // reference message and is not allowed to block execution.
    setDayTradeOrderType("MARKET");
    setDayTradeOrderPrice("");

    // FAST PATH: the analysis already contains an entry/current price.
    // Show it in the trading ticket immediately instead of waiting for another
    // quote request. Order value and estimated margin therefore calculate now.
    const immediatePrice = Number(signalEntry);
    if (Number.isFinite(immediatePrice) && immediatePrice > 0) {
      setDayTradeQuote({
        symbol,
        price: immediatePrice,
        ltp: immediatePrice,
        current_price: immediatePrice,
        source: "analysis",
      });
      setDayTradeQuoteLoading(false);
      setDayTradeQuoteError("");
    }

    // Refresh the quote in the background after the ticket is already usable.
    window.setTimeout(() => {
      loadDayTradeQuote(symbol, false, true);
    }, 0);

    const loadedMessage =
      `${signalSide} signal loaded into Intraday Paper Trading: ` +
      `Qty ${signalQuantity}` +
      `${
        signalStopLoss !== ""
          ? `, Stop Loss ${formatMoney(signalStopLoss)}`
          : ", Stop Loss not available"
      }` +
      `${
        signalEntry !== ""
          ? `, Analysis Entry ${formatMoney(signalEntry)}`
          : ""
      }` +
      `${
        signalTarget1 !== ""
          ? `, Target 1 ${formatMoney(signalTarget1)}`
          : ""
      }` +
      `${
        Number(intraday.estimated_margin) > 0
          ? `, Est. Margin ${formatMoney(intraday.estimated_margin)}`
          : ""
      }. Press ${signalSide} to execute the trade.`;

    setOrderMessage(loadedMessage);
    setDayTradeMessage(loadedMessage);

    // Move immediately to the execution controls after loading the setup.
    // SELL signals land on SELL / SHORT; BUY signals land on BUY.
    window.setTimeout(() => {
      const actionButton = document.getElementById(
        "intraday-paper-execute-button"
      );
      const tradingSection = document.getElementById(
        "intraday-paper-trading"
      );

      if (actionButton) {
        actionButton.scrollIntoView({
          behavior: "auto",
          block: "center",
        });
        actionButton.focus({ preventScroll: true });
      } else if (tradingSection) {
        tradingSection.scrollIntoView({
          behavior: "auto",
          block: "start",
        });
      }
    }, 0);
  }

  // ==========================================================
  // OPEN-POSITION MANAGEMENT ALERTS
  // ==========================================================

  function notifyTradeManagement(alerts = []) {
    if (
      !tradeNotificationsEnabled ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) return;

    alerts.forEach((item) => {
      const symbol = String(item?.symbol || "").toUpperCase();
      const category = String(item?.category || "").toUpperCase();
      if (!symbol || !category) return;

      // Re-notify only when the active category or suggested levels change.
      const fingerprint = [
        symbol,
        category,
        Number(item?.suggested_target || 0).toFixed(2),
        Number(item?.suggested_stop_loss || 0).toFixed(2),
      ].join("|");

      if (notifiedTradeManagementRef.current.has(fingerprint)) return;

      // Keep only the latest management fingerprint for this symbol.
      [...notifiedTradeManagementRef.current].forEach((value) => {
        if (String(value).startsWith(`${symbol}|`)) {
          notifiedTradeManagementRef.current.delete(value);
        }
      });
      notifiedTradeManagementRef.current.add(fingerprint);

      const target = Number(item?.suggested_target);
      const stop = Number(item?.suggested_stop_loss);
      const pnl = Number(item?.pnl || 0);
      const body = [
        `${symbol} ${item?.direction || ""}`,
        `P&L ${formatMoney(pnl)}`,
        Number.isFinite(Number(item?.peak_unrealized_pnl)) ? `Peak ${formatMoney(Number(item?.peak_unrealized_pnl))}` : null,
        Number(item?.profit_giveback || 0) > 0 ? `Giveback ${formatMoney(Number(item?.profit_giveback || 0))}` : null,
        Number.isFinite(target) ? `Suggested Target ${formatMoney(target)}` : null,
        Number.isFinite(stop) ? `Suggested SL ${formatMoney(stop)}` : null,
      ].filter(Boolean).join(" • ");

      const notification = new Notification(`${item?.title || category}: ${symbol}`, {
        body,
        requireInteraction: true,
        tag: `trade-management-${symbol}`,
      });

      notification.onclick = () => {
        window.focus();
        const section = document.getElementById("intraday-paper-open-positions");
        if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
        notification.close();
      };
    });
  }

  // ==========================================================
  // INTRADAY PAPER TRADING DATA
  // ==========================================================

  async function loadDayTradeData() {
    // IMPORTANT: core account/history requests must never be blocked by an
    // optional management/trigger request. Each section is loaded independently
    // so a slow or failed endpoint cannot make the account look reset or hide
    // persisted trade history.

    // 1) Best-effort trigger checks. Failure here must not block history/account.
    try {
      const pendingTriggerData = await fetchJson(
        `${BACKEND}/api/intraday-paper/check-pending`,
        { method: "POST" }
      );

      if (Number(pendingTriggerData?.executed_count || 0) > 0) {
        const executedText = (pendingTriggerData?.executed || [])
          .map(
            (item) =>
              `${item.side} ${item.symbol} @ ${formatMoney(
                item.trigger_market_price
              )}`
          )
          .join(", ");

        setDayTradeMessage(`Waiting order executed: ${executedText}`);
      }
    } catch (err) {
      console.warn("Pending-order trigger check failed:", err);
    }

    try {
      const triggerData = await fetchJson(
        `${BACKEND}/api/intraday-paper/check-triggers`,
        { method: "POST" }
      );

      if (Number(triggerData?.triggered_count || 0) > 0) {
        const triggeredText = (triggerData?.triggered || [])
          .map((item) => {
            const reason =
              item.trigger_type === "STOP_LOSS" ? "STOP LOSS" : "TARGET";

            return `${item.symbol} ${reason} @ ${formatMoney(
              item.trigger_market_price
            )}`;
          })
          .join(", ");

        setDayTradeMessage(`Automatic exit executed: ${triggeredText}`);
      }
    } catch (err) {
      console.warn("Automatic target/SL check failed:", err);
    }

    // 2) Load the four core paper-trading endpoints independently.
    // Promise.allSettled prevents one failed endpoint from clearing everything.
    const [accountResult, positionsResult, tradesResult, pendingResult] =
      await Promise.allSettled([
        fetchJson(`${BACKEND}/api/intraday-paper/account`),
        fetchJson(`${BACKEND}/api/intraday-paper/positions`),
        fetchJson(`${BACKEND}/api/intraday-paper/trades`),
        fetchJson(`${BACKEND}/api/intraday-paper/pending`),
      ]);

    let coreFailure = false;

    if (accountResult.status === "fulfilled") {
      setDayTradeAccount(accountResult.value);
    } else {
      coreFailure = true;
      console.error("Account load failed:", accountResult.reason);
    }

    if (positionsResult.status === "fulfilled") {
      const positionsData = positionsResult.value;
      setDayTradePositions(positionsData?.positions || positionsData || []);
    } else {
      coreFailure = true;
      console.error("Positions load failed:", positionsResult.reason);
    }

    if (tradesResult.status === "fulfilled") {
      const tradesData = tradesResult.value;

      const normalizedTradeHistory = Array.isArray(tradesData)
        ? tradesData
        : Array.isArray(tradesData?.trades)
        ? tradesData.trades
        : [];

      const sortedTradeHistory = [...normalizedTradeHistory].sort((a, b) => {
        const aTime = new Date(a?.timestamp || 0).getTime();
        const bTime = new Date(b?.timestamp || 0).getTime();
        return bTime - aTime;
      });

      // Never replace valid history with an empty fallback caused by an
      // unrelated optional request. This is the durable SQLite history returned
      // by /api/intraday-paper/trades.
      setDayTradeTrades(sortedTradeHistory);
    } else {
      coreFailure = true;
      console.error("Trade-history load failed:", tradesResult.reason);
    }

    if (pendingResult.status === "fulfilled") {
      const pendingData = pendingResult.value;
      setDayTradePendingOrders(pendingData?.orders || pendingData || []);
    } else {
      console.warn("Pending-order list load failed:", pendingResult.reason);
    }

    // 3) Trade-management is optional and intentionally isolated.
    // If indicator analysis is slow/fails, the 201+ historical trades and
    // account card still load immediately.
    try {
      const managementData = await fetchJson(
        `${BACKEND}/api/intraday-paper/management`
      );

      const managementAlerts = Array.isArray(managementData?.alerts)
        ? managementData.alerts
        : [];

      setDayTradeManagementAlerts(managementAlerts);
      notifyTradeManagement(managementAlerts);
    } catch (err) {
      console.warn("Trade-management load failed:", err);
      setDayTradeManagementAlerts([]);
    }

    if (coreFailure) {
      setDayTradeMessage(
        "Some intraday data could not be refreshed. Existing trade history was preserved; press Refresh History to retry."
      );
    }
  }

  const dayTradeQuoteRequestRef = useRef({ symbol: "", running: false });

  async function loadDayTradeQuote(
    selectedSymbol = dayTradeSymbol,
    force = false,
    preserveCurrent = false
  ) {
    const clean = String(selectedSymbol || "").trim().toUpperCase();
    if (!clean) return;

    if (
      dayTradeQuoteRequestRef.current.running &&
      dayTradeQuoteRequestRef.current.symbol === clean
    ) {
      return;
    }

    dayTradeQuoteRequestRef.current = { symbol: clean, running: true };

    // When Send to Intraday has already supplied an analysis price, do not
    // replace the usable ticket with "Updating..." while refreshing.
    if (!preserveCurrent) {
      setDayTradeQuoteLoading(true);
    }
    setDayTradeQuoteError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/stock/fast-price?symbol=${encodeURIComponent(clean)}&refresh=${
          force ? "true" : "false"
        }`
      );

      const price = Number(data?.price ?? data?.ltp);
      if (Number.isFinite(price) && price > 0) {
        setDayTradeQuote((previous) => ({
          ...(previous || {}),
          ...data,
          symbol: clean,
          price,
          ltp: price,
        }));
      }
    } catch (err) {
      console.error("Intraday paper quote error:", err);
      // Preserve an already-loaded analysis price on a transient refresh error.
      if (!preserveCurrent) {
        setDayTradeQuoteError(
          err?.message || "Unable to load latest stock price."
        );
      }
    } finally {
      dayTradeQuoteRequestRef.current = { symbol: clean, running: false };
      setDayTradeQuoteLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function checkCandidateStatus() {
      const symbol = String(dayTradeSymbol || "").trim().toUpperCase();
      if (!symbol) { setDayTradeCandidateStatus(null); return; }
      try {
        const result = await fetchJson(`${BACKEND}/api/intraday-paper/candidate-status?symbol=${encodeURIComponent(symbol)}&side=${encodeURIComponent(dayTradeSide)}&strategy_mode=${encodeURIComponent(strategyMode)}`);
        if (!cancelled) { setDayTradeCandidateStatus(result); setDayTradeCandidateStatusError(""); }
      } catch (error) {
        if (!cancelled) { setDayTradeCandidateStatus(null); setDayTradeCandidateStatusError(error?.message || "Unable to check candidate status"); }
      }
    }
    checkCandidateStatus();
    const timer = setInterval(checkCandidateStatus, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [dayTradeSymbol, dayTradeSide, strategyMode]);

  async function submitDayTradeOrder({
    symbol: targetSymbol = dayTradeSymbol,
    side: targetSide = dayTradeSide,
    quantity: targetQuantity = dayTradeQuantity,
  } = {}) {
    setDayTradeMessage("");

    const qty = Number(targetQuantity);
    const manualOrderValue =
      dayTradeManualOrderValue === ""
        ? null
        : Number(dayTradeManualOrderValue);

    if (
      manualOrderValue === null &&
      (!Number.isFinite(qty) || qty <= 0)
    ) {
      setDayTradeMessage(
        "Enter a valid quantity or a manual order value."
      );
      return;
    }

    if (
      manualOrderValue !== null &&
      (!Number.isFinite(manualOrderValue) || manualOrderValue <= 0)
    ) {
      setDayTradeMessage("Please enter a valid manual order value.");
      return;
    }

    const selectedOrderPrice =
      dayTradeOrderType === "LIMIT"
        ? Number(dayTradeOrderPrice)
        : null;

    if (
      dayTradeOrderType === "LIMIT" &&
      (!Number.isFinite(selectedOrderPrice) || selectedOrderPrice <= 0)
    ) {
      setDayTradeMessage("Please enter a valid intraday Buy / Sell price.");
      return;
    }

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/order`,
        {
          method: "POST",
          body: JSON.stringify({
            symbol: targetSymbol,
            side: targetSide,
            quantity: qty,
            order_type: dayTradeOrderType,
            limit_price:
              dayTradeOrderType === "LIMIT"
                ? selectedOrderPrice
                : null,
            order_value: manualOrderValue,
            stop_loss:
              dayTradeStopLoss === ""
                ? null
                : Number(dayTradeStopLoss),
            strategy_mode: strategyMode,
          }),
        }
      );

      let finalMessage =
        data?.message ||
        `${targetSide} intraday order executed for ${qty} share(s) of ${targetSymbol}.`;

      const target1Value =
        dayTradeTarget1 === ""
          ? null
          : Number(dayTradeTarget1);

      // For a MARKET order, the position exists immediately, so Target 1
      // can be activated automatically after the entry executes.
      if (
        dayTradeOrderType === "MARKET" &&
        Number.isFinite(target1Value) &&
        target1Value > 0
      ) {
        try {
          await fetchJson(
            `${BACKEND}/api/intraday-paper/target`,
            {
              method: "POST",
              body: JSON.stringify({
                symbol: targetSymbol,
                target_price: target1Value,
              }),
            }
          );

          finalMessage += ` Target 1 ${formatMoney(
            target1Value
          )} activated automatically.`;
        } catch (targetError) {
          console.error("Automatic Target 1 error:", targetError);
          finalMessage +=
            " Trade executed, but Target 1 could not be activated automatically.";
        }
      }

      setDayTradeMessage(finalMessage);

      // MARKET orders return the executed trade immediately. Put it in the
      // history at once, then refresh from SQLite so the UI and DB agree.
      if (data?.trade?.id) {
        setDayTradeTrades((previousTrades) => [
          data.trade,
          ...previousTrades.filter((trade) => trade?.id !== data.trade.id),
        ]);
      }

      await Promise.all([
        loadDayTradeData(),
        loadDayTradeQuote(targetSymbol),
      ]);
    } catch (err) {
      console.error("Intraday order error:", err);
      setDayTradeMessage(
        `Intraday order failed: ${
          err?.message || "Unable to place order."
        }`
      );
    }
  }

  async function cancelDayTradePendingOrder(order) {
    if (!order?.id) return;

    const confirmed = window.confirm(
      `Cancel waiting ${order.side || ""} order for ${
        order.quantity || 0
      } share(s) of ${order.symbol || "this stock"} at ${
        order.limit_price ? formatMoney(order.limit_price) : "the selected price"
      }?`
    );

    if (!confirmed) return;

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/pending/${encodeURIComponent(
          order.id
        )}`,
        { method: "DELETE" }
      );

      setDayTradeMessage(
        data?.message || "Waiting intraday order cancelled."
      );

      await loadDayTradeData();
    } catch (err) {
      console.error("Cancel waiting order error:", err);
      setDayTradeMessage(
        `Unable to cancel waiting order: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function setDayTradeExitTarget(position) {
    const symbol = position?.symbol;
    const target = Number(dayTradeTargetInputs?.[symbol]);

    if (!symbol) return;

    if (!Number.isFinite(target) || target <= 0) {
      setDayTradeMessage(
        `Enter a valid automatic exit price for ${symbol}.`
      );
      return;
    }

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/target`,
        {
          method: "POST",
          body: JSON.stringify({
            symbol,
            target_price: target,
          }),
        }
      );

      setDayTradeMessage(
        data?.message ||
          `Automatic exit target set for ${symbol}.`
      );

      await loadDayTradeData();
    } catch (err) {
      console.error("Set intraday target error:", err);
      setDayTradeMessage(
        `Unable to set target: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function removeDayTradeExitTarget(position) {
    const symbol = position?.symbol;

    if (!symbol) return;

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/target/${encodeURIComponent(
          symbol
        )}`,
        { method: "DELETE" }
      );

      setDayTradeTargetInputs((current) => ({
        ...current,
        [symbol]: "",
      }));

      setDayTradeMessage(
        data?.message ||
          `Automatic exit target removed for ${symbol}.`
      );

      await loadDayTradeData();
    } catch (err) {
      console.error("Remove intraday target error:", err);
      setDayTradeMessage(
        `Unable to remove target: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function setDayTradePositionStopLoss(position) {
    const symbol = position?.symbol;
    const stopLoss = Number(dayTradeStopLossInputs?.[symbol]);

    if (!symbol) return;

    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      setDayTradeMessage(`Enter a valid stop loss for ${symbol}.`);
      return;
    }

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/stop-loss`,
        {
          method: "POST",
          body: JSON.stringify({
            symbol,
            stop_loss: stopLoss,
          }),
        }
      );

      setDayTradeMessage(
        data?.message || `Stop loss updated for ${symbol}.`
      );

      setDayTradeStopLossInputs((current) => ({
        ...current,
        [symbol]: "",
      }));

      await loadDayTradeData();
    } catch (err) {
      console.error("Set intraday stop loss error:", err);
      setDayTradeMessage(
        `Unable to update stop loss: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function removeDayTradePositionStopLoss(position) {
    const symbol = position?.symbol;

    if (!symbol) return;

    const confirmed = window.confirm(
      `Remove the automatic stop loss for ${symbol}?`
    );

    if (!confirmed) return;

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/stop-loss/${encodeURIComponent(symbol)}`,
        { method: "DELETE" }
      );

      setDayTradeStopLossInputs((current) => ({
        ...current,
        [symbol]: "",
      }));

      setDayTradeMessage(
        data?.message || `Stop loss removed for ${symbol}.`
      );

      await loadDayTradeData();
    } catch (err) {
      console.error("Remove intraday stop loss error:", err);
      setDayTradeMessage(
        `Unable to remove stop loss: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function squareOffDayTradePosition(position) {
    const qty = Number(
      position?.quantity ?? Math.abs(Number(position?.signed_quantity || 0))
    );

    if (!position?.symbol || !Number.isFinite(qty) || qty <= 0) {
      setDayTradeMessage("Unable to square off: invalid open position.");
      return;
    }

    // LONG position  -> SELL entire quantity at current market price.
    // SHORT position -> BUY entire quantity at current market price.
    //
    // IMPORTANT:
    // Square Off intentionally ignores:
    // - Exact Price / LIMIT setting
    // - Manual Order Value
    // - Quantity input in the main order form
    // - Buy / Sell selection in the main order form
    //
    // The backend fetches a fresh market price when this request arrives
    // and executes the full closing order as MARKET.
    const side =
      position.direction === "SHORT" ||
      Number(position.signed_quantity) < 0
        ? "BUY"
        : "SELL";

    const confirmed = window.confirm(
      `Square off ${position.symbol} now?\n\n` +
        `${position.direction || ""} position: ${qty} share(s)\n` +
        `Closing side: ${side}\n\n` +
        `The full position will be closed at the latest market price ` +
        `available to the backend at execution time.`
    );

    if (!confirmed) return;

    try {
      setDayTradeMessage(
        `Squaring off ${position.symbol} at current market price...`
      );

      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/order`,
        {
          method: "POST",
          body: JSON.stringify({
            symbol: position.symbol,
            side,
            quantity: qty,
            order_type: "MARKET",
            limit_price: null,
            order_value: null,
            stop_loss: null,
          }),
        }
      );

      const executionPrice =
        data?.trade?.price ??
        data?.trade?.market_price ??
        data?.execution_price ??
        data?.price ??
        null;

      setDayTradeMessage(
        executionPrice
          ? `Square Off completed: ${side} ${qty} share(s) of ${
              position.symbol
            } at ${formatMoney(executionPrice)}.`
          : data?.message ||
              `Square Off completed for ${position.symbol} at market price.`
      );

      await Promise.all([
        loadDayTradeData(),
        loadDayTradeQuote(position.symbol),
      ]);
    } catch (err) {
      console.error("Square off error:", err);

      setDayTradeMessage(
        `Square Off failed: ${
          err?.message || "Unable to execute market closing order."
        }`
      );
    }
  }

  async function resetDayTradeAccount() {
    if (dayTradePositions.length > 0) {
      setDayTradeMessage(
        "Reset blocked: square off all open intraday positions first."
      );
      return;
    }

    const confirmed = window.confirm(
      "Reset the intraday paper account and pending orders? Executed trade history will be preserved."
    );

    if (!confirmed) return;

    try {
      const data = await fetchJson(
        `${BACKEND}/api/intraday-paper/reset`,
        { method: "POST" }
      );

      setDayTradeMessage(
        data?.message || "Intraday paper account reset."
      );

      await loadDayTradeData();
    } catch (err) {
      console.error("Intraday reset error:", err);
      setDayTradeMessage(
        `Reset failed: ${err?.message || "Unable to reset account."}`
      );
    }
  }

  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    async function restoreLogin() {
      if (IS_LOCAL_BACKEND) {
        setIsAuthenticated(true);
        setAuthChecking(false);
        return;
      }

      const token = window.localStorage.getItem("stock_analyser_auth_token");
      if (!token) {
        setAuthChecking(false);
        return;
      }
      try {
        await fetchJson(`${BACKEND}/api/auth/me`);
        setIsAuthenticated(true);
      } catch {
        window.localStorage.removeItem("stock_analyser_auth_token");
        setIsAuthenticated(false);
      } finally {
        setAuthChecking(false);
      }
    }

    const requireLogin = () => setIsAuthenticated(false);
    window.addEventListener("stock-analyser-auth-required", requireLogin);
    restoreLogin();
    return () =>
      window.removeEventListener("stock-analyser-auth-required", requireLogin);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    checkBackend();
    loadStock("NIFTY 50");
    loadPaperData();
    loadDayTradeData();
    loadLearningProfile();
    loadIntraday("NIFTY 50");
  }, [isAuthenticated]);

  // ==========================================================
  // RELOAD DAILY DATA WHEN PERIOD CHANGES
  // ==========================================================

  useEffect(() => {
    if (!symbol) return;

    loadStock(symbol);
  }, [period]);

  // ==========================================================
  // LOAD INTRADAY WHEN SYMBOL OR INTERVAL CHANGES
  // ==========================================================

  useEffect(() => {
    if (!symbol) return;

    loadIntraday(symbol);
  }, [symbol, intradayInterval]);

  // ==========================================================
  // LIVE SELECTED-STOCK CANDLE REFRESH
  // Refresh only the selected intraday stock every 15 seconds.
  // The all-stock scanner remains on its slower refresh cycle.
  // ==========================================================

  useEffect(() => {
    if (!symbol || analysisCategory !== "INTRADAY") return;

    const refreshSelectedStock = () => {
      if (document.visibilityState === "visible") {
        loadIntraday(symbol, intradayChartPeriod);
      }
    };

    const intervalId = setInterval(refreshSelectedStock, 30000);

    return () => clearInterval(intervalId);
  }, [
    symbol,
    intradayInterval,
    intradayChartPeriod,
    analysisCategory,
  ]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadStrategyMode();
  }, [isAuthenticated]);

  // ==========================================================
  // RELOAD SCANNER WHEN TIMEFRAME CHANGES
  // ==========================================================

  useEffect(() => {
    loadScanner(false);
  }, [intradayInterval]);

  // Multi-timeframe scanning is independent of the selected chart timeframe.
  useEffect(() => {
    if (!isAuthenticated) return;
    loadMultiTimeframeScanner(false);
  }, [isAuthenticated]);

  // Selected single-timeframe scanner refreshes every 60 seconds.
  useEffect(() => {
    if (appPage !== "LIVE") return;
    const scannerTimer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        scannerMarketStatus !== "CLOSED" &&
        scannerSessionPhase !== "END_OF_DAY"
      ) {
        loadScanner(false);
      }
    }, 120000);

    return () => clearInterval(scannerTimer);
  }, [appPage, intradayInterval, scannerMarketStatus, scannerSessionPhase]);

  // Read the latest background snapshot periodically while the live workspace is visible.
  // The backend scanner continues independently; avoid needless page-wide refresh work elsewhere.
  useEffect(() => {
    if (!isAuthenticated || appPage !== "LIVE") return;
    loadMultiTimeframeScanner(false);
    const multiTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadMultiTimeframeScanner(false);
      }
    }, 30000);

    return () => clearInterval(multiTimer);
  }, [isAuthenticated, appPage]);

  // Refresh the lightweight V7 execution reminder every 30 seconds.
  useEffect(() => {
    if (!isAuthenticated || appPage !== "LIVE") return;
    loadExecutionReminder();
    const reminderTimer = setInterval(() => {
      if (document.visibilityState === "visible") loadExecutionReminder();
    }, 30000);
    return () => clearInterval(reminderTimer);
  }, [isAuthenticated, appPage]);

  // ==========================================================
  // REFRESH LOCAL LEARNING PROFILE
  // ==========================================================

  useEffect(() => {
    if (!isAuthenticated || appPage !== "LIVE") return;

    const learningTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadLearningProfile();
      }
    }, 120000);

    return () => clearInterval(learningTimer);
  }, [isAuthenticated, appPage]);

  // ==========================================================
  // LOAD PRICE WHEN PAPER-TRADING STOCK CHANGES
  // ==========================================================

  useEffect(() => {
    if (!paperSymbol) return;

    loadPaperQuote(paperSymbol, false);
  }, [paperSymbol]);

  // ==========================================================
  // AUTO REFRESH SELECTED PAPER-TRADING PRICE
  // ==========================================================

  useEffect(() => {
    if (!paperSymbol) return;

    const paperPriceTimer = setInterval(() => {
      if (document.visibilityState === "visible" && appPage === "LIVE") {
        loadPaperQuote(paperSymbol, false);
      }
    }, 15000);

    return () => clearInterval(paperPriceTimer);
  }, [paperSymbol, appPage]);

  // ==========================================================
  // INTRADAY PAPER STOCK PRICE
  // ==========================================================

  useEffect(() => {
    if (!dayTradeSymbol) return;
    loadDayTradeQuote(dayTradeSymbol, false, false);
  }, [dayTradeSymbol]);

  useEffect(() => {
    if (!dayTradeSymbol) return;

    const dayTradeTimer = setInterval(() => {
      if (document.visibilityState !== "visible" || appPage !== "LIVE") return;
      loadDayTradeQuote(dayTradeSymbol);
      loadDayTradeData();
    }, 30000);

    return () => clearInterval(dayTradeTimer);
  }, [dayTradeSymbol, appPage]);

  // ==========================================================
  // SEARCH DEBOUNCE
  // ==========================================================

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim()) {
        searchStocks();
      } else {
        setSearchResults([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [search]);

  // ==========================================================
  // DERIVED VALUES
  // ==========================================================

  const technicalSignal = analysis?.signal || "HOLD";

  const signalScore =
    analysis?.score !== undefined && analysis?.score !== null
      ? analysis.score
      : "—";

  const sentiment = analysis?.sentiment || "Neutral";

  // Show only setups that passed the backend qualification filters.
  const qualifiedScannerData = scannerData.filter(
    (item) =>
      item?.qualified === true &&
      (item?.signal === "BUY" || item?.signal === "SELL")
  );

  const filteredScannerData = qualifiedScannerData
    .filter((item) => {
      if (scannerFilter === "ALL") return true;
      return item.signal === scannerFilter;
    })
    .sort((a, b) => {
      const rank = (x) => x?.v8_rank === "PRIMARY" ? 0 : x?.v8_rank === "QUALIFIED" ? 1 : 2;
      return rank(a) - rank(b) || Number(b?.setup_quality || 0) - Number(a?.setup_quality || 0);
    })
    .slice(0, 8);

  const scannerBuyCount = qualifiedScannerData.filter(
    (item) => item.signal === "BUY"
  ).length;

  const scannerSellCount = qualifiedScannerData.filter(
    (item) => item.signal === "SELL"
  ).length;

  const dayTradeLivePrice = Number(
    dayTradeQuote?.price ?? dayTradeQuote?.ltp ?? 0
  );

  const dayTradeQtyNumber = Math.max(
    0,
    Number(dayTradeQuantity) || 0
  );

  const dayTradeExecutionPrice =
    dayTradeOrderType === "LIMIT" &&
    Number(dayTradeOrderPrice) > 0
      ? Number(dayTradeOrderPrice)
      : dayTradeLivePrice;

  const dayTradeManualValueNumber =
    Number(dayTradeManualOrderValue) > 0
      ? Number(dayTradeManualOrderValue)
      : 0;

  const dayTradeCalculatedQuantity =
    dayTradeManualValueNumber > 0 &&
    dayTradeExecutionPrice > 0
      ? Math.floor(
          dayTradeManualValueNumber / dayTradeExecutionPrice
        )
      : dayTradeQtyNumber;

  const dayTradeExposure =
    dayTradeManualValueNumber > 0
      ? dayTradeCalculatedQuantity * dayTradeExecutionPrice
      : dayTradeExecutionPrice * dayTradeQtyNumber;

  const dayTradeMarginRate = Number(
    dayTradeAccount?.margin_rate ?? 0.2
  );

  const dayTradeEstimatedMargin =
    dayTradeExposure * dayTradeMarginRate;

  const normalizedPaperSearch = paperStockSearch.trim().toUpperCase();

  const filteredPaperStocks = normalizedPaperSearch
    ? PAPER_STOCK_OPTIONS.filter(([stockSymbol, stockName]) => {
        const symbolMatch = stockSymbol
          .toUpperCase()
          .includes(normalizedPaperSearch);

        const nameMatch = stockName
          .toUpperCase()
          .includes(normalizedPaperSearch);

        return symbolMatch || nameMatch;
      })
    : PAPER_STOCK_OPTIONS;

  function selectPaperSearchStock(stockSymbol) {
    setPaperSearchSelected(stockSymbol);
    setPaperStockSearch(stockSymbol);
    setPaperSendMessage("");
  }

  async function sendSearchedStock(destination) {
    const target =
      paperSearchSelected ||
      filteredPaperStocks?.[0]?.[0] ||
      "";

    if (!target) {
      setPaperSendMessage("Search and select a stock first.");
      return;
    }

    if (destination === "NORMAL") {
      setAnalysisCategory("NORMAL");
      setPaperSymbol(target);
      selectStockForCategory(target, "NORMAL");

      setPaperSendMessage(
        `${target} selected in Normal Stock Analysis and Normal Paper Trading.`
      );
      return;
    }

    // Keep the stock synchronized across:
    // 1) Top Intraday Analysis category
    // 2) Intraday Buy / Sell Analyzer
    // 3) Intraday Paper Trading
    setAnalysisCategory("INTRADAY");
    setDayTradeSymbol(target);
    selectStockForCategory(target, "INTRADAY");

    try {
      const analysisData = await fetchJson(
        `${BACKEND}/api/stock/intraday-analysis?symbol=${encodeURIComponent(
          target
        )}&interval=${intradayInterval}`
      );

      const signalSide =
        analysisData?.signal === "BUY"
          ? "BUY"
          : analysisData?.signal === "SELL"
            ? "SELL"
            : dayTradeSide;

      const suggestedQty =
        Number(analysisData?.suggested_quantity) > 0
          ? Math.floor(Number(analysisData.suggested_quantity))
          : 1;

      const stopLoss =
        analysisData?.stop_loss ??
        analysisData?.stop ??
        analysisData?.stop_price ??
        "";

      const target1 =
        analysisData?.target_1 ??
        analysisData?.target1 ??
        "";

      setIntraday(analysisData);
      setDayTradeSide(signalSide);
      setDayTradeQuantity(suggestedQty);
      setDayTradeManualOrderValue("");
      setDayTradeOrderType("MARKET");
      setDayTradeOrderPrice("");
      setDayTradeStopLoss(
        stopLoss !== null && stopLoss !== undefined && stopLoss !== ""
          ? String(stopLoss)
          : ""
      );
      setDayTradeTarget1(
        target1 !== null && target1 !== undefined && target1 !== ""
          ? String(target1)
          : ""
      );

      setPaperSendMessage(
        `${target} sent to Intraday Trading. Qty ${suggestedQty}` +
          `${
            stopLoss !== ""
              ? ` • Stop Loss ${formatMoney(stopLoss)}`
              : ""
          }` +
          `${
            target1 !== ""
              ? ` • Target 1 ${formatMoney(target1)}`
              : ""
          }`
      );

      loadDayTradeQuote(target);
    } catch (err) {
      console.error("Send to Intraday error:", err);

      setPaperSendMessage(
        `${target} selected for Intraday Trading, but the latest signal defaults could not be loaded.`
      );
    }
  }

  // ==========================================================
  // QUICK SYMBOLS
  // ==========================================================

  const quickSymbols = [
    "NIFTY 50",
    "BANK NIFTY",
    "NIFTY IT",
    "NIFTY 100",
    "RELIANCE",
    "TCS",
    "INFY",
    "HDFCBANK",
    "ICICIBANK",
    "SBIN",
  ];

  // ==========================================================
  // AUTHENTICATION UI
  // ==========================================================

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const response = await fetch(`${BACKEND}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token) {
        throw new Error(data?.detail || "Login failed");
      }
      window.localStorage.setItem("stock_analyser_auth_token", data.token);
      setLoginPassword("");
      setIsAuthenticated(true);
    } catch (err) {
      setLoginError(err?.message || "Unable to sign in.");
    } finally {
      setLoginLoading(false);
      setAuthChecking(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem("stock_analyser_auth_token");
    setIsAuthenticated(false);
    setBackendStatus("Checking...");
  }

  // ==========================================================
  // RENDER
  // ==========================================================



  if (authChecking) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f1f5f9", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ fontWeight: 800, color: "#0f172a" }}>Checking login…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, background: "#f1f5f9", fontFamily: "Inter, system-ui, sans-serif" }}>
        <form onSubmit={handleLogin} style={{ width: "100%", maxWidth: 390, background: "white", padding: 28, borderRadius: 18, boxShadow: "0 12px 35px rgba(15,23,42,.12)", border: "1px solid #e2e8f0" }}>
          <h1 style={{ margin: 0, color: "#0f172a", fontSize: 25 }}>Vishnu Stock Analyzer</h1>
          <p style={{ color: "#64748b", marginTop: 8, marginBottom: 22 }}>Sign in to access analysis and paper trading.</p>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Username</label>
          <input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} autoComplete="username" required style={{ width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid #cbd5e1", borderRadius: 10, marginBottom: 16, fontSize: 16 }} />
          <label style={{ display: "block", fontWeight: 700, marginBottom: 6 }}>Password</label>
          <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" required style={{ width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid #cbd5e1", borderRadius: 10, marginBottom: 16, fontSize: 16 }} />
          {loginError && <div style={{ color: "#b91c1c", background: "#fee2e2", padding: 10, borderRadius: 9, marginBottom: 14 }}>{loginError}</div>}
          <button type="submit" disabled={loginLoading} style={{ width: "100%", border: 0, borderRadius: 10, padding: 13, background: "#0f172a", color: "white", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>
            {loginLoading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
        color: "#0f172a",
        fontFamily:
          "Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      }}
    >
      {/* ====================================================
          HEADER
      ==================================================== */}

      <header
        style={{
          background: "#0f172a",
          color: "#ffffff",
          padding: "18px 24px",
          position: "sticky",
          top: 0,
          zIndex: 20,
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 25,
                fontWeight: 800,
              }}
            >
              Vishnu Stock Analyzer
            </h1>

            <div
              style={{
                marginTop: 4,
                color: "#cbd5e1",
                fontSize: 13,
              }}
            >
              Technical analysis • Intraday signals • Paper trading
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleLogout}
              style={{
                border: "1px solid #475569",
                background: "#1e293b",
                color: "#ffffff",
                padding: "8px 13px",
                borderRadius: 999,
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Logout
            </button>
            <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#1e293b",
              padding: "8px 13px",
              borderRadius: 999,
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background:
                  backendStatus === "Connected" ? "#22c55e" : "#ef4444",
              }}
            />

            Backend: {backendStatus}
            </div>
          </div>
        </div>
      </header>

      {/* ====================================================
          MAIN
      ==================================================== */}

      <main
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "24px 18px 50px",
        }}
      >
        <Card style={{ marginBottom: 18, padding: 10, position: "sticky", top: 0, zIndex: 100, background: "#ffffff", boxShadow: "0 3px 12px rgba(15,23,42,.12)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}> 
            <button
              type="button"
              onClick={() => setAppPage("LIVE")}
              style={{
                padding: "13px 16px",
                borderRadius: 10,
                border: appPage === "LIVE" ? "2px solid #0f172a" : "1px solid #cbd5e1",
                background: appPage === "LIVE" ? "#0f172a" : "#ffffff",
                color: appPage === "LIVE" ? "#ffffff" : "#334155",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              PAGE 1 • LIVE TRADING
            </button>
            <button
              type="button"
              onClick={() => setAppPage("HISTORY")}
              style={{
                padding: "13px 16px",
                borderRadius: 10,
                border: appPage === "HISTORY" ? "2px solid #0f172a" : "1px solid #cbd5e1",
                background: appPage === "HISTORY" ? "#0f172a" : "#ffffff",
                color: appPage === "HISTORY" ? "#ffffff" : "#334155",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              PAGE 2 • HISTORY & LEARNING
            </button>
            <button type="button" onClick={() => setAppPage("INTELLIGENCE")}
              style={{padding:"13px 16px",borderRadius:10,cursor:"pointer",fontWeight:900,
                border:appPage==="INTELLIGENCE"?"2px solid #0f172a":"1px solid #cbd5e1",
                background:appPage==="INTELLIGENCE"?"#0f172a":"#ffffff",
                color:appPage==="INTELLIGENCE"?"#ffffff":"#334155"}}>
              PAGE 3 • MARKET INTELLIGENCE
            </button>
            <button type="button" onClick={() => setAppPage("STRATEGIES")}
              style={{padding:"13px 16px",borderRadius:10,cursor:"pointer",fontWeight:900,
                border:appPage==="STRATEGIES"?"2px solid #0f172a":"1px solid #cbd5e1",
                background:appPage==="STRATEGIES"?"#0f172a":"#ffffff",
                color:appPage==="STRATEGIES"?"#ffffff":"#334155"}}>
              PAGE 4 • STRATEGY LAB
            </button>
          </div>
        </Card>

        {appPage === "STRATEGIES" && (
          <div style={{display:"grid",gap:18}}>
            <details style={{border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 12px",background:"#ffffff"}}>
              <summary style={{cursor:"pointer",fontWeight:800,color:"#475569",fontSize:13}}>Optional: inspect a specific stock manually</summary>
              <div style={{marginTop:12}}>
            <Card title="Swing Trading Workspace — Daily Analysis & Chart">
              <p style={{marginTop:0,color:"#475569",lineHeight:1.6}}>Use this simple workflow to shortlist a stock, check its daily trend, and prepare a risk-managed trade plan. The app provides research calculations only; it does not place orders.</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10,marginBottom:14}}>
                {[["1. Choose a stock","Enter an NSE symbol such as RELIANCE or TCS."],["2. Check the chart","Click Analyze Swing Stock. Review the latest price, RSI, moving averages and daily chart."],["3. Run the scanner","Use the watchlist scanner below. Start with Review candidates; read each stock’s reasons and warnings."],["4. Plan before buying","Use the reference price, stop, target and quantity as a checklist. Verify the live price and place any order yourself through your broker."]].map(([heading,body],i)=><div key={heading} style={{padding:12,border:"1px solid #cbd5e1",borderRadius:9,background:i===3?"#eff6ff":"#f8fafc",color:"#1f2937"}}><div style={{fontWeight:900,fontSize:13,marginBottom:5,color:"#0f172a"}}>{heading}</div><div style={{fontSize:12,lineHeight:1.55,color:"#334155"}}>{body}</div></div>)}
              </div>
              <div style={{padding:14,border:"1px solid #cbd5e1",borderRadius:10,background:"#f8fafc",marginBottom:14}}>
                <div style={{fontSize:15,fontWeight:900,color:"#0f172a",marginBottom:9}}>Search Stock for Swing Trading</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  <div style={{position:"relative",flex:"1 1 260px",minWidth:220}}>
                    <input list="swing-stock-symbols" value={swingDetailSymbol} onChange={e=>setSwingDetailSymbol(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key==="Enter") loadSwingDetail();}} placeholder="Type or choose an NSE symbol" aria-label="Search stock for swing trading" style={{width:"100%",boxSizing:"border-box",padding:"11px 12px",borderRadius:8,border:"1px solid #94a3b8",background:"#ffffff",color:"#111827",caretColor:"#111827",WebkitTextFillColor:"#111827",fontSize:14,opacity:1}} />
                    <datalist id="swing-stock-symbols">
                      {Array.from(new Set([...PAPER_STOCK_OPTIONS.map(([symbol])=>symbol),"NIFTY 50","BANKNIFTY","GRASIM","BPCL","IOC","IRCTC","DMART","ZOMATO","PAYTM"])).map(symbol=><option key={symbol} value={symbol} />)}
                    </datalist>
                  </div>
                  <div role="group" aria-label="Daily chart history period" style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                    {[["3mo","3 Months"],["6mo","6 Months"],["1y","1 Year"],["2y","2 Years"]].map(([value,label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={swingDetailPeriod===value}
                        onClick={() => setSwingDetailPeriod(value)}
                        style={{
                          minHeight:42,
                          padding:"10px 13px",
                          borderRadius:8,
                          border:swingDetailPeriod===value?"2px solid #2563eb":"1px solid #cbd5e1",
                          background:swingDetailPeriod===value?"#dbeafe":"#ffffff",
                          color:swingDetailPeriod===value?"#1d4ed8":"#334155",
                          fontWeight:800,
                          fontSize:14,
                          lineHeight:1.2,
                          cursor:"pointer",
                          whiteSpace:"nowrap",
                          opacity:1
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button type="button" disabled={swingDetailLoading} onClick={()=>loadSwingDetail()} style={{padding:"11px 15px",border:0,borderRadius:8,background:"#7c3aed",color:"#fff",fontWeight:800,cursor:swingDetailLoading?"wait":"pointer"}}>{swingDetailLoading?"Loading daily data…":"Analyze Swing Stock"}</button>
                  <button type="button" onClick={enableSwingNotifications} style={{padding:"10px 12px",border:"2px solid #0f766e",borderRadius:8,background:swingNotificationsEnabled?"#ccfbf1":"#ffffff",color:"#115e59",fontWeight:800,fontSize:13,cursor:"pointer"}}>{swingNotificationsEnabled?"✓ Alerts enabled":"Enable setup alerts"}</button>
                  <button type="button" onClick={addSwingDetailToScanner} style={{padding:"11px 15px",border:"1px solid #7c3aed",borderRadius:8,background:"#fff",color:"#6d28d9",fontWeight:800,cursor:"pointer"}}>Add to Swing Scanner</button>
                </div>
                <div style={{marginTop:8,color:"#64748b",fontSize:12,lineHeight:1.5}}>Daily candles only · Suitable for end-of-day review · Review candidates manually before considering a trade.</div>
              </div>
              {swingDetailError && <div role="alert" style={{padding:12,marginBottom:12,borderRadius:8,background:"#fef2f2",border:"1px solid #fecaca",color:"#991b1b",fontSize:13}}>{swingDetailError}</div>}
              {swingDetailData.length>0 && (()=>{
                const latest=swingDetailData[swingDetailData.length-1]||{};
                const prior=swingDetailData.length>1?swingDetailData[swingDetailData.length-2]:{};
                const close=Number(latest.close);
                const previousClose=Number(prior.close);
                const change=Number.isFinite(close)&&Number.isFinite(previousClose)&&previousClose!==0?((close-previousClose)/previousClose)*100:null;
                const metrics=[["Latest close",Number.isFinite(close)?formatMoney(close):"—"],["Daily change",change==null?"—":`${change>=0?"+":""}${change.toFixed(2)}%`],["RSI (14)",latest.rsi14==null?"—":Number(latest.rsi14).toFixed(1)],["SMA 20",latest.sma20==null?"—":formatMoney(latest.sma20)],["SMA 50",latest.sma50==null?"—":formatMoney(latest.sma50)],["MACD",latest.macd==null?"—":Number(latest.macd).toFixed(2)]];
                return <div style={{display:"grid",gap:14}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:10}}>{metrics.map(([label,value])=><div key={label} style={{padding:12,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}><div style={{fontSize:12,color:"#64748b",marginBottom:4}}>{label}</div><strong style={{color:label==="Daily change"&&change!=null?(change>=0?"#15803d":"#b91c1c"):"#0f172a"}}>{value}</strong></div>)}</div>
                  <div style={{border:"1px solid #e2e8f0",borderRadius:10,padding:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}><h4 style={{margin:0,fontSize:16}}>{swingDetailSymbol} · Daily Candlestick Chart</h4><span style={{fontSize:12,color:"#64748b"}}>{swingDetailData.length} daily bars · {latest.time||"Latest available candle"}</span></div>
                    <StockChart data={swingDetailData} />
                  </div>
                  <div style={{padding:12,borderRadius:8,border:"1px solid #fde68a",background:"#fffbeb",color:"#92400e",fontSize:12,lineHeight:1.6}}><strong>Research note:</strong> These are historical daily indicators, not a buy/sell recommendation. Confirm data freshness, liquidity, upcoming results/news, stop distance and position size. Overnight gaps can exceed a stop-loss.</div>
                </div>;
              })()}
              {!swingDetailData.length && !swingDetailLoading && !swingDetailError && <div style={{padding:28,textAlign:"center",border:"1px dashed #cbd5e1",borderRadius:10,color:"#64748b",background:"#f8fafc"}}>Enter a stock symbol and select <strong>Analyze Swing Stock</strong> to load daily history and indicators.</div>}
            </Card>
              </div>
            </details>
            <Card title="Swing Opportunity Scanner — Daily Charts">
              <p style={{marginTop:0,color:"#475569",lineHeight:1.6}}>One click is enough. The backend checks a preset watchlist of 29 NSE stocks, evaluates trend, RSI, MACD, volume, relative strength, volatility and the NIFTY market filter, then returns the best qualifying watchlist candidate—or clearly says <strong>No trade</strong> when conditions are weak. It never places orders.</p>
              <div style={{padding:12,marginBottom:12,border:"1px solid #bfdbfe",borderRadius:9,background:"#eff6ff",color:"#1e3a8a",fontSize:13,lineHeight:1.6}}><strong>How to read the result:</strong> <strong>REVIEW_CANDIDATE</strong> means review the setup further, not “buy immediately.” <strong>WAIT / blocked</strong> means do not treat it as a current entry. <strong>DATA_ERROR</strong> means the stock’s data could not be checked. Open a stock’s “reasons and risk flags” row before deciding.</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginTop:12}}>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Planned risk per candidate (₹)
                  <input type="number" min="10" max="500" value={swingRiskBudget} onChange={e=>setSwingRiskBudget(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Max allocation per candidate (₹)
                  <input type="number" min="1000" max="1000000" value={swingAllocation} onChange={e=>setSwingAllocation(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:12}}>
                <button type="button" disabled={swingScanBusy} onClick={runSwingScan} style={{padding:"11px 16px",border:0,borderRadius:8,background:"#0f172a",color:"white",fontWeight:800,cursor:"pointer"}}>{swingScanBusy?"Analyzing market and stocks…":"Find best swing setup"}</button>
                <span style={{fontSize:12,color:"#64748b"}}>29-stock NSE watchlist · Daily candles · Automatic ranking</span>
                {swingScanResult && <button type="button" onClick={exportSwingScanCsv} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:42,padding:"10px 14px",border:"2px solid #2563eb",borderRadius:8,background:"#2563eb",color:"#ffffff",fontWeight:800,fontSize:14,lineHeight:1.3,cursor:"pointer",opacity:1,visibility:"visible",whiteSpace:"nowrap",flexShrink:0}}>Export CSV</button>}
              </div>
              {swingScanError && <p role="alert" style={{color:"#b91c1c",lineHeight:1.5}}>{swingScanError}</p>}
              {swingScanResult?.recommendation && <div style={{display:"grid",gap:7,marginTop:14,padding:16,border:`2px solid ${swingScanResult.recommendation.decision==="NO_TRADE"?"#f59e0b":"#16a34a"}`,borderRadius:12,background:swingScanResult.recommendation.decision==="NO_TRADE"?"#fffbeb":"#f0fdf4",color:"#1f2937"}}>
                <div style={{fontSize:11,fontWeight:900,letterSpacing:.5,color:swingScanResult.recommendation.decision==="NO_TRADE"?"#92400e":"#166534"}}>BACKEND DECISION</div>
                <strong style={{fontSize:19,lineHeight:1.3}}>{swingScanResult.recommendation.headline}</strong>
                <div style={{fontSize:13,lineHeight:1.6}}>{swingScanResult.recommendation.reason}</div>
                {swingScanResult.recommendation.trade_plan && <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(125px,1fr))",gap:9,marginTop:4}}>{[["Reference close",swingScanResult.recommendation.trade_plan.close==null?"—":formatMoney(swingScanResult.recommendation.trade_plan.close)],["Stop reference",swingScanResult.recommendation.trade_plan.stop_reference==null?"—":formatMoney(swingScanResult.recommendation.trade_plan.stop_reference)],["2R target",swingScanResult.recommendation.trade_plan.target_2r_reference==null?"—":formatMoney(swingScanResult.recommendation.trade_plan.target_2r_reference)],["Suggested quantity",swingScanResult.recommendation.trade_plan.quantity_at_risk_budget??"—"],["Technical score",`${swingScanResult.recommendation.trade_plan.score??"—"}/100`]].map(([label,value])=><div key={label} style={{padding:10,borderRadius:8,background:"#ffffff",border:"1px solid #d1d5db"}}><div style={{fontSize:11,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}</div>}
                <div style={{fontSize:12,lineHeight:1.5}}>{swingScanResult.recommendation.next_step}</div>
                <div style={{fontSize:11,color:"#64748b"}}>Data timestamp: {swingScanResult.generated_at||"—"}. Research only; no orders are placed.</div>
              </div>}
              {swingScanResult && <div style={{display:"grid",gap:10,marginTop:14,padding:14,border:"2px solid #16a34a",borderRadius:12,background:"#f0fdf4",color:"#14532d"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div><div style={{fontWeight:900,fontSize:16}}>Matched swing setups — review first</div><div style={{fontSize:12,marginTop:3}}>These are scanner candidates, not automatic buy signals. Check warnings and confirm current prices.</div></div>
                  <span style={{padding:"5px 9px",borderRadius:999,background:"#dcfce7",border:"1px solid #86efac",fontWeight:900,fontSize:12}}>{swingNewMatches.length} match(es)</span>
                </div>
                {swingNewMatches.length ? [...swingNewMatches].sort((a,b)=>(b.score||0)-(a.score||0)).map(r=><div key={`top-match-${r.symbol}`} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",alignItems:"center",gap:10,padding:12,border:"1px solid #bbf7d0",borderRadius:9,background:"#ffffff",color:"#14532d"}}>
                  <div><div style={{fontSize:11,color:"#64748b"}}>Stock / score</div><strong style={{fontSize:16}}>{r.symbol} · {r.score??0}/100</strong><div style={{fontSize:12,marginTop:3}}>{r.setup||"Technical setup"}</div></div>
                  <div><div style={{fontSize:11,color:"#64748b"}}>Reference price</div><strong>{r.close==null?"—":formatMoney(r.close)}</strong></div>
                  <div><div style={{fontSize:11,color:"#64748b"}}>Stop reference</div><strong>{r.stop_reference==null?"—":formatMoney(r.stop_reference)}</strong></div>
                  <div><div style={{fontSize:11,color:"#64748b"}}>Target (2R)</div><strong>{r.target_2r_reference==null?"—":formatMoney(r.target_2r_reference)}</strong></div>
                  <div><div style={{fontSize:11,color:"#64748b"}}>Illustrative qty</div><strong>{r.quantity_at_risk_budget??"—"}</strong></div>
                  <button type="button" onClick={()=>{setSwingDetailSymbol(r.symbol);loadSwingDetail(r.symbol);}} style={{minHeight:40,padding:"9px 12px",border:0,borderRadius:8,background:"#166534",color:"#ffffff",fontWeight:900,cursor:"pointer"}}>Review chart</button>
                </div>) : <div style={{padding:10,borderRadius:8,background:"#ffffff",color:"#475569",fontSize:13}}>No setups passed the current scanner rules. Check the WAIT results or scan again after new completed daily candles.</div>}
              </div>}
              {swingScanResult && <div style={{display:"grid",gap:12,marginTop:14}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                  {[["Market regime",swingScanResult.market_context?.regime||"UNKNOWN"],["Review candidates",swingScanResult.candidate_count??0],["Symbols with data errors",swingScanResult.error_count??0],["Risk per candidate",formatMoney(swingScanResult.risk_budget_rupees)]].map(([label,value])=><div key={label} style={{padding:12,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}><div style={{fontSize:12,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}
                </div>
                <div style={{padding:12,borderRadius:8,border:"1px solid #cbd5e1",background:swingScanResult.market_context?.regime==="BULLISH"?"#f0fdf4":swingScanResult.market_context?.regime==="BEARISH"?"#fff1f2":"#fffbeb",color:"#334155",fontSize:13,lineHeight:1.6}}><strong>NIFTY market filter:</strong> {swingScanResult.market_context?.message||"Market context unavailable."} <span style={{display:"block",fontSize:12,marginTop:4}}>Generated {swingScanResult.generated_at}. Scores rank rule alignment; they are not probabilities of profit.</span></div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",padding:"4px 0"}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:800,color:"#1f2937"}}>Technical setup:
                    <select value={swingSetupFilter} onChange={e=>setSwingSetupFilter(e.target.value)} style={{minHeight:40,padding:"8px 10px",border:"1px solid #64748b",borderRadius:8,background:"#ffffff",color:"#111827",fontWeight:700}}>
                      <option value="ALL">All detected setups</option>
                      <option value="20-day closing breakout">20-day closing breakout</option>
                      <option value="Trend pullback near EMA20">EMA20 trend pullback</option>
                      <option value="Trend continuation">Trend continuation (EMA20 / SMA50 / SMA200)</option>
                      <option value="MACD bullish momentum">MACD bullish momentum</option>
                      <option value="RSI momentum">RSI momentum (50–68)</option>
                      <option value="Volume expansion">Volume expansion (≥1.5× average)</option>
                      <option value="Relative strength vs NIFTY">Relative strength vs NIFTY</option>
                      <option value="52-week high breakout">52-week high breakout</option>
                      <option value="Bollinger squeeze breakout">Bollinger squeeze breakout</option>
                    </select>
                  </label>
                  <span style={{fontSize:12,color:"#64748b"}}>The backend only flags rule-based setups supported by its daily data; unconfirmed chart patterns are not guessed.</span>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",overflow:"visible",minHeight:44,padding:"2px 0",color:"#1f2937"}}>
                  <strong style={{fontSize:13,color:"#1f2937",flexShrink:0}}>Show:</strong>
                  {[ ["ALL","All results"],["CANDIDATES","Review candidates"],["WAIT","Wait / blocked"],["ERROR","Data errors"] ].map(([value,label])=><button key={value} type="button" aria-pressed={swingScanFilter===value} onClick={()=>setSwingScanFilter(value)} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minHeight:40,padding:"9px 12px",borderRadius:8,border:swingScanFilter===value?"2px solid #1d4ed8":"1px solid #64748b",background:swingScanFilter===value?"#dbeafe":"#ffffff",color:swingScanFilter===value?"#1d4ed8":"#1f2937",fontWeight:800,fontSize:13,lineHeight:1.3,cursor:"pointer",opacity:1,visibility:"visible",whiteSpace:"nowrap",flexShrink:0}}>{label}</button>)}
                </div>
                <div style={{overflowX:"auto",border:"1px solid #e2e8f0",borderRadius:8}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1120}}>
                    <thead><tr>{["Symbol","Score / 100","Status","Setup","Close","RSI","ATR %","Vol ×","RS vs NIFTY","Stop ref.","Target 2R","Qty*","Risk*"].map(label=><th key={label} style={{padding:9,textAlign:"left",background:"#f8fafc",borderBottom:"1px solid #cbd5e1",whiteSpace:"nowrap"}}>{label}</th>)}</tr></thead>
                    <tbody>{(swingScanResult.results||[]).filter(r=>(swingScanFilter==="ALL"?true:swingScanFilter==="CANDIDATES"?String(r.status||"").startsWith("REVIEW_CANDIDATE"):swingScanFilter==="ERROR"?r.status==="DATA_ERROR":!String(r.status||"").startsWith("REVIEW_CANDIDATE")&&r.status!=="DATA_ERROR")&&(swingSetupFilter==="ALL"||(r.setup_matches||[]).includes(swingSetupFilter))).map((r,i)=><tr key={`${r.symbol}-${i}`}>
                      {[r.symbol,`${r.score??0}/100`,r.status,r.setup,r.close==null?"—":formatMoney(r.close),r.rsi14??"—",r.atr_pct==null?"—":`${r.atr_pct}%`,r.volume_ratio==null?"—":`${r.volume_ratio}×`,r.relative_strength_vs_nifty_pct_points==null?"—":`${r.relative_strength_vs_nifty_pct_points} pp`,r.stop_reference==null?"—":formatMoney(r.stop_reference),r.target_2r_reference==null?"—":formatMoney(r.target_2r_reference),r.quantity_at_risk_budget??"—",r.planned_price_risk_rupees==null?"—":formatMoney(r.planned_price_risk_rupees)].map((value,j)=><td key={j} style={{padding:9,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap",fontWeight:j===0||j===1?800:400,color:j===2&&String(r.status||"").startsWith("REVIEW_CANDIDATE")?"#166534":j===2&&r.status==="MARKET_FILTER_BLOCKED"?"#9a3412":"#0f172a"}}>{value}</td>)}
                    </tr>)}</tbody>
                  </table>
                </div>
                <p style={{margin:0,fontSize:12,color:"#64748b"}}>*Quantity and planned risk are illustrations using the entered risk/allocation caps; they exclude costs and do not account for other open positions. Score weights: trend 25, momentum 20, setup 20, volume 15, relative strength 15, volatility fit 5.</p>
                <div style={{display:"grid",gap:8}}>{(swingScanResult.results||[]).filter(r=>(swingScanFilter==="ALL"?true:swingScanFilter==="CANDIDATES"?String(r.status||"").startsWith("REVIEW_CANDIDATE"):swingScanFilter==="ERROR"?r.status==="DATA_ERROR":!String(r.status||"").startsWith("REVIEW_CANDIDATE")&&r.status!=="DATA_ERROR")&&(swingSetupFilter==="ALL"||(r.setup_matches||[]).includes(swingSetupFilter))).map((r,i)=><details key={`details-${r.symbol}-${i}`} style={{border:"1px solid #e2e8f0",borderRadius:8,padding:10}}><summary style={{cursor:"pointer",fontWeight:800,color:"#0f172a"}}>{r.symbol} · {r.status} · {r.score??0}/100 — open simple plan</summary><div style={{display:"grid",gap:10,marginTop:10}}>{String(r.status||"").startsWith("REVIEW_CANDIDATE")&&<div style={{padding:12,border:"1px solid #bfdbfe",borderRadius:8,background:"#eff6ff",color:"#1e3a8a",fontSize:13,lineHeight:1.6}}><strong>Quick plan (research reference only)</strong>{(r.setup_matches||[]).length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:7}}>{r.setup_matches.map((setup,j)=><span key={j} style={{padding:"4px 7px",borderRadius:999,border:"1px solid #93c5fd",background:"#dbeafe",color:"#1e40af",fontSize:11,fontWeight:800}}>{setup}</span>)}</div>}<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginTop:8}}><div><div style={{fontSize:11}}>Reference price</div><strong>{r.close==null?"—":formatMoney(r.close)}</strong></div><div><div style={{fontSize:11}}>Stop reference</div><strong>{r.stop_reference==null?"—":formatMoney(r.stop_reference)}</strong></div><div><div style={{fontSize:11}}>Target at 2R</div><strong>{r.target_2r_reference==null?"—":formatMoney(r.target_2r_reference)}</strong></div><div><div style={{fontSize:11}}>Illustrative quantity</div><strong>{r.quantity_at_risk_budget??"—"}</strong></div></div><div style={{marginTop:7}}>Before entering: confirm the live price, check liquidity and upcoming news/results, verify that the stop distance is acceptable, and calculate total costs. If the setup or data is unclear, skip the trade.</div></div>}<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}><div><strong style={{fontSize:12}}>Why it was flagged</strong>{(r.reasons||[]).length?<ul style={{marginTop:5,paddingLeft:18,color:"#166534",fontSize:12,lineHeight:1.6}}>{r.reasons.map((x,j)=><li key={j}>{x}</li>)}</ul>:<p style={{fontSize:12,color:"#64748b"}}>No qualifying reasons.</p>}</div><div><strong style={{fontSize:12}}>Warnings / things to check</strong>{(r.warnings||[]).length?<ul style={{marginTop:5,paddingLeft:18,color:"#9a3412",fontSize:12,lineHeight:1.6}}>{r.warnings.map((x,j)=><li key={j}>{x}</li>)}</ul>:<p style={{fontSize:12,color:"#64748b"}}>No additional rule-based warnings.</p>}</div></div><p style={{fontSize:11,color:"#64748b",marginBottom:0}}>{r.caveat||"Research only; no order placed."} Data as of {r.as_of||"unknown"}.</p></div></details>)}</div>
                <div style={{padding:12,background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,color:"#9a3412",fontSize:12,lineHeight:1.65}}><strong>Important limitations:</strong> { (swingScanResult.limitations||[]).join(" ") }</div>
              </div>}
            </Card>
            <Card title="Strategy Lab — Intraday, Swing & Derivatives Playbooks">
              <p style={{color:"#475569",lineHeight:1.6,marginTop:0}}>Scan technical setups and run historical strategy tests. Results are research signals, not guaranteed predictions; this workspace does not place orders.</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Underlying / symbol
                  <input value={strategyLabSymbol} onChange={e=>setStrategyLabSymbol(e.target.value.toUpperCase())} placeholder="RELIANCE or ^NSEI" style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Chart timeframe
                  <select value={strategyLabInterval} onChange={e=>setStrategyLabInterval(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}}>
                    <option value="5m">5 minutes</option><option value="15m">15 minutes</option><option value="30m">30 minutes</option><option value="60m">60 minutes</option><option value="1d">Daily — swing</option><option value="1wk">Weekly — positional</option>
                  </select>
                </label>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginTop:12}}>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Risk budget per trade (₹)
                  <input type="number" min="10" max="500" value={strategyLabRisk} onChange={e=>setStrategyLabRisk(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Backtest capital (₹)
                  <input type="number" min="1000" max="1000000" value={strategyLabCapital} onChange={e=>setStrategyLabCapital(e.target.value)} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
              </div>
              <h4 style={{marginBottom:8}}>Select technical setups</h4>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
                {strategyLabCatalog.map(st=><label key={st.id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:10,border:"1px solid #e2e8f0",borderRadius:8}}><input type="checkbox" checked={strategyLabSelected.includes(st.id)} onChange={e=>setStrategyLabSelected(prev=>e.target.checked?[...prev,st.id]:prev.filter(x=>x!==st.id))}/><span><strong>{st.name}</strong><small style={{display:"block",color:"#64748b",marginTop:3}}>{st.horizon} · {st.description}</small></span></label>)}
              </div>
              <button type="button" disabled={strategyLabBusy} onClick={runStrategyLabScan} style={{marginTop:14,padding:"11px 16px",border:0,borderRadius:8,background:"#0f172a",color:"white",fontWeight:800,cursor:"pointer"}}>{strategyLabBusy?"Working…":"Scan selected setups"}</button>
              {strategyLabError && <p role="alert" style={{color:"#b91c1c"}}>{strategyLabError}</p>}
            </Card>
            <Card title="Capital & Position Risk Planner — ₹1,00,000 capital">
              <p style={{marginTop:0,color:"#475569",lineHeight:1.6}}>Research-only sizing calculator. Defaults use a ₹20,000 initial trading allocation, ₹250 planned risk per trade, and a ₹500 total open-risk ceiling. It does not place orders or verify live prices.</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Side
                  <select value={riskPlanSide} onChange={e=>{setRiskPlanSide(e.target.value);setRiskPlanResult(null);}} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}}><option value="BUY">BUY / long</option><option value="SELL">SELL / short</option></select>
                </label>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Entry price (₹)
                  <input type="number" min="0.01" step="0.01" value={riskPlanEntry} onChange={e=>{setRiskPlanEntry(e.target.value);setRiskPlanResult(null);}} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
                <label style={{display:"grid",gap:6,fontSize:13,fontWeight:700}}>Stop price (₹)
                  <input type="number" min="0.01" step="0.01" value={riskPlanStop} onChange={e=>{setRiskPlanStop(e.target.value);setRiskPlanResult(null);}} style={{padding:10,border:"1px solid #cbd5e1",borderRadius:8}} />
                </label>
              </div>
              <button type="button" onClick={calculateRiskPlan} disabled={riskPlanBusy} style={{marginTop:12,padding:"10px 14px",border:0,borderRadius:8,background:"#0f172a",color:"white",fontWeight:800,cursor:"pointer"}}>{riskPlanBusy?"Calculating…":"Calculate safe position size"}</button>
              {riskPlanError && <p role="alert" style={{color:"#b91c1c"}}>{riskPlanError}</p>}
              {riskPlanResult && <div style={{marginTop:12,padding:12,border:"1px solid #cbd5e1",borderRadius:9,background:"#f8fafc"}}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:10}}>
                  {[["Quantity",riskPlanResult.quantity],["Position value",formatMoney(riskPlanResult.position_value_rupees)],["Planned price risk",formatMoney(riskPlanResult.planned_price_risk_rupees)],["2R target",formatMoney(riskPlanResult.target_price)],["Per-share risk",formatMoney(riskPlanResult.per_share_risk_rupees)]].map(([label,value])=><div key={label} style={{padding:10,background:"white",border:"1px solid #e2e8f0",borderRadius:7}}><div style={{fontSize:12,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}
                </div>
                <ul style={{marginBottom:0,color:"#475569",fontSize:12,lineHeight:1.6}}>{(riskPlanResult.warnings||[]).map((warning,i)=><li key={i}>{warning}</li>)}</ul>
              </div>}
            </Card>
            {strategyLabScan && <Card title={`Scan results — ${strategyLabScan.symbols_scanned} symbol(s), ${strategyLabScan.signals_count} signal(s)`}>
              {(strategyLabScan.results||[]).map(r=><div key={r.symbol} style={{padding:"12px 0",borderBottom:"1px solid #e2e8f0"}}><strong>{r.symbol}</strong> · Last price: {r.last_price==null?"—":formatMoney(r.last_price)}<div style={{color:"#64748b",fontSize:12}}>{r.message}</div>{r.signals?.length ? r.signals.map((sig,i)=><div key={`${sig.strategy_id}-${i}`} style={{marginTop:8,padding:10,borderRadius:8,background:sig.side==="BUY"?"#f0fdf4":"#fef2f2",border:`1px solid ${sig.side==="BUY"?"#86efac":"#fecaca"}`}}><strong>{sig.strategy_name}: {sig.side}</strong> · Reference {formatMoney(sig.reference_price)} · Stop {formatMoney(sig.stop_loss)} · 1.5R target {formatMoney(sig.target_1_5R)}<div style={{fontSize:13,marginTop:4}}>{sig.reason}</div><button type="button" onClick={()=>runStrategyLabBacktest(sig.strategy_id)} disabled={strategyLabBusy} style={{marginTop:7,minHeight:42,padding:"10px 14px",border:"2px solid #1d4ed8",borderRadius:8,background:strategyLabBusy?"#94a3b8":"#1d4ed8",color:"#ffffff",fontWeight:900,fontSize:14,cursor:strategyLabBusy?"wait":"pointer",whiteSpace:"nowrap",opacity:1}}>Backtest this setup</button></div>):<div style={{color:"#64748b",marginTop:6}}>No setup triggered on the latest candle. This is not a SELL/BUY recommendation.</div>}</div>)}
            </Card>}
            {strategyLabBacktest && <Card title={"Backtest — " + (strategyLabBacktest.strategy_name || strategyLabBacktest.strategy || "Selected setup")}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>{[["Trades",strategyLabBacktest.trades_count??strategyLabBacktest.total_trades??"—"],["Net P&L",formatMoney(strategyLabBacktest.net_pnl)],["Net expectancy / trade",formatMoney(strategyLabBacktest.net_expectancy_per_trade)],["Win rate",strategyLabBacktest.win_rate_pct==null?"—":(Number(strategyLabBacktest.win_rate_pct).toFixed(1)+"%")],["Max drawdown",formatMoney(strategyLabBacktest.max_drawdown)],["Drawdown / allocation",strategyLabBacktest.max_drawdown_pct_initial_allocation==null?"—":`${Number(strategyLabBacktest.max_drawdown_pct_initial_allocation).toFixed(2)}%`],["Profit factor",strategyLabBacktest.profit_factor==null?"—":(strategyLabBacktest.profit_factor==="Infinity"?"∞":Number(strategyLabBacktest.profit_factor).toFixed(2))]].map(([label,value])=><div key={label} style={{padding:12,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}><div style={{fontSize:12,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}</div>
              <button type="button" disabled={strategyLabOosBusy} onClick={()=>runStrategyLabOutOfSample(strategyLabBacktest.strategy)} style={{marginTop:12,minHeight:46,padding:"12px 16px",border:"2px solid #047857",borderRadius:8,background:strategyLabOosBusy?"#94a3b8":"#047857",color:"#ffffff",fontWeight:900,fontSize:14,cursor:strategyLabOosBusy?"wait":"pointer",whiteSpace:"normal",lineHeight:1.35,opacity:1}}>{strategyLabOosBusy?"Running holdout test…":"Run 70/30 chronological holdout test"}</button>
              {strategyLabOosError && <p role="alert" style={{color:"#b91c1c"}}>{strategyLabOosError}</p>}
              {strategyLabBacktest.data_quality && <div style={{marginTop:10,padding:10,borderRadius:8,border:`1px solid ${strategyLabBacktest.data_quality.status==="passed"?"#bbf7d0":"#fecaca"}`,background:strategyLabBacktest.data_quality.status==="passed"?"#f0fdf4":"#fef2f2",color:strategyLabBacktest.data_quality.status==="passed"?"#166534":"#991b1b",fontSize:12,lineHeight:1.6}}><strong>Historical data checks: {strategyLabBacktest.data_quality.status || "unknown"}</strong><br/>Rows received: {strategyLabBacktest.data_quality.source_rows ?? "—"} · Invalid rows removed: {strategyLabBacktest.data_quality.invalid_rows_removed ?? "—"} · Duplicate timestamps removed: {strategyLabBacktest.data_quality.duplicate_timestamps_removed ?? "—"}. This checks structural consistency, not the truth or completeness of the data vendor's prices.</div>}
              <p style={{fontSize:12,color:"#64748b",lineHeight:1.5}}>Historical simulation only. The backtest applies adverse slippage (default 5 bps per side) and a simplified fixed order fee; Indian statutory charges, taxes, spread, market impact and broker execution are not fully modeled. Stop-loss gaps are modeled at the worse opening price when observable; when stop and target are both touched in one candle, stop-loss is assumed first. These results are not a live-profit forecast.</p>
            </Card>}
            {strategyLabOos && <Card title="Chronological out-of-sample test — held-out data">
              <p style={{marginTop:0,color:"#475569",lineHeight:1.6}}>This evaluates the fixed strategy rules on the last 30% of available candles. The strategy is not optimized on this test window. Treat the result as a diagnostic, not a forecast.</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10}}>{[["Test trades",strategyLabOos.trades_count], ["Test net P&L",formatMoney(strategyLabOos.net_pnl)], ["Net expectancy / trade",formatMoney(strategyLabOos.net_expectancy_per_trade)], ["Win rate",`${Number(strategyLabOos.win_rate_pct||0).toFixed(1)}%`], ["Profit factor",strategyLabOos.profit_factor==null?"—":(strategyLabOos.profit_factor==="Infinity"?"∞":Number(strategyLabOos.profit_factor).toFixed(2))], ["Max drawdown",formatMoney(strategyLabOos.max_drawdown)], ["Strategy return / allocation",`${Number(strategyLabOos.return_pct_initial_allocation||0).toFixed(2)}%`], ["Buy-and-hold price return",strategyLabOos.benchmark_buy_hold_return_pct==null?"—":`${Number(strategyLabOos.benchmark_buy_hold_return_pct).toFixed(2)}%`]].map(([label,value])=><div key={label} style={{padding:12,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8}}><div style={{fontSize:12,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}</div>
              <p style={{fontSize:12,color:"#475569",marginBottom:4}}>Test window: {strategyLabOos.test_window_start} to {strategyLabOos.test_window_end} · {strategyLabOos.test_candles} candles of {strategyLabOos.total_candles} total.</p>
              <p style={{fontSize:12,color:"#b45309",lineHeight:1.6,marginTop:8}}>Costs are simplified and exclude some statutory charges, taxes, spreads and market impact. The buy-and-hold benchmark excludes dividends and costs. Do not repeatedly adjust rules to this same holdout; use additional rolling tests and paper trading.</p>
            </Card>}
            <Card title="Profitability audit — learn from your recorded outcomes">
              <p style={{marginTop:0,color:"#475569",lineHeight:1.6}}>This panel evaluates historical labels and hypothetical shadow trades from the backend database. It is a diagnostic, not a forecast. Refresh after new outcomes are recorded.</p>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
                <button type="button" onClick={loadProfitabilityAudit} disabled={profitabilityAuditLoading} style={{padding:"9px 14px",minHeight:40,border:"1px solid #94a3b8",borderRadius:7,background:"#ffffff",color:"#0f172a",fontWeight:800,fontSize:14,cursor:profitabilityAuditLoading?"wait":"pointer",opacity:1}}>{profitabilityAuditLoading?"Refreshing…":"Refresh audit"}</button>
                {profitabilityAudit?.generated_at && <small style={{color:"#64748b"}}>Updated {profitabilityAudit.generated_at}</small>}
              </div>
              {profitabilityAuditError && <p role="alert" style={{color:"#b91c1c"}}>{profitabilityAuditError}</p>}
              {profitabilityAudit ? <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                  {[
                    ["Labeled model trades",profitabilityAudit.training?.labeled_count ?? "—"],
                    ["Labeled net P&L",formatMoney(profitabilityAudit.training?.net_pnl)],
                    ["Labeled win rate",profitabilityAudit.training?.win_rate_pct==null?"—":`${Number(profitabilityAudit.training.win_rate_pct).toFixed(1)}%`],
                    ["Shadow gross P&L",formatMoney(profitabilityAudit.shadow?.gross_pnl)],
                    ["Shadow win rate",profitabilityAudit.shadow?.win_rate_pct==null?"—":`${Number(profitabilityAudit.shadow.win_rate_pct).toFixed(1)}%`],
                    ["Scanner data errors",profitabilityAudit.scanner?.data_errors ?? "—"]
                  ].map(([label,value])=><div key={label} style={{padding:12,border:"1px solid #e2e8f0",borderRadius:8,background:"#f8fafc"}}><div style={{fontSize:12,color:"#64748b"}}>{label}</div><strong>{value}</strong></div>)}
                </div>
                <div style={{marginTop:12,padding:12,borderRadius:8,border:"1px solid #fed7aa",background:"#fff7ed",color:"#9a3412",lineHeight:1.6}}>
                  <strong>{profitabilityAudit.status==="DO_NOT_DEPLOY"?"Do not deploy real capital yet":"Research-only status"}</strong>
                  <p style={{margin:"5px 0"}}>{profitabilityAudit.recommendation}</p>
                </div>
                <h4 style={{marginBottom:6}}>Model versions by direction</h4>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead><tr>{["Model version","Side","Trades","Win rate","Net P&L"].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid #cbd5e1"}}>{x}</th>)}</tr></thead>
                    <tbody>{(profitabilityAudit.training?.by_model_side||[]).map((r,i)=><tr key={`${r.model_version}-${r.side}-${i}`}>{[r.model_version,r.side,r.trades,r.win_rate_pct==null?"—":`${Number(r.win_rate_pct).toFixed(1)}%`,formatMoney(r.net_pnl)].map((x,j)=><td key={j} style={{padding:8,borderBottom:"1px solid #e2e8f0"}}>{x}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <p style={{fontSize:12,color:"#64748b",lineHeight:1.55,marginBottom:0}}>Costs, realistic fills, slippage, taxes and market impact may not be fully represented. Small samples and unlabelled predictions are not proof of an edge.</p>
              </> : <p style={{color:"#64748b"}}>{profitabilityAuditLoading?"Loading recorded outcomes…":"No audit data loaded yet."}</p>}
            </Card>
            <Card title="Additional setups to evaluate (manual / paper-only)" >
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
                {[{title:"Futures trend-following",desc:"Use index or liquid-stock futures only after daily trend and intraday direction agree. Define contract expiry, lot size, margin and stop before entry."},{title:"Options directional debit",desc:"Bullish: call debit spread; bearish: put debit spread. Prefer defined-risk structures, compare premium, breakeven, max loss and expiry before considering a trade."},{title:"Options range / volatility",desc:"Iron condor or defined-risk credit spread only when volatility, event risk, liquidity and margin are checked. Losses can still be substantial."},{title:"Swing breakout",desc:"Daily close above a multi-week resistance with volume confirmation; place stop below the breakout structure and size by rupee risk."},{title:"Pullback continuation",desc:"Trade a pullback toward EMA20 in an established trend after price confirms continuation; avoid chasing extended candles."},{title:"Mean reversion",desc:"Consider only in a range-bound market with a defined invalidation level; avoid fading strong trends or major news."},{title:"Opening-range breakout",desc:"Mark the opening 15–30 minute range and wait for a confirmed close outside it with volume; avoid low-volume false breaks."},{title:"Position / ETF trend",desc:"Use weekly trend and broad-market confirmation for longer holding periods; review concentration and overnight gap risk."}].map(item=><div key={item.title} style={{padding:12,border:"1px solid #e2e8f0",borderRadius:9}}><strong>{item.title}</strong><p style={{marginBottom:0,color:"#475569",fontSize:13,lineHeight:1.55}}>{item.desc}</p></div>)}
              </div>
              <p style={{marginBottom:0,marginTop:12,padding:10,background:"#fff7ed",borderRadius:8,color:"#9a3412",fontSize:13,lineHeight:1.6}}><strong>Important:</strong> Live futures prices, option-chain Greeks, expiry/lot-size validation and derivative paper execution are not currently connected to this Strategy Lab. These derivatives playbooks are checklists only, not live F&O signals. Do not use them as executable orders.</p>
            </Card>
          </div>
        )}

        {appPage === "INTELLIGENCE" && (
          <div style={{display:"grid",gap:18}}>
            <div role="status" aria-live="polite" style={{padding:16,borderRadius:12,border:"2px solid " + (marketDirectionAlert?.direction === "BUY" ? "#16a34a" : marketDirectionAlert?.direction === "SELL" ? "#dc2626" : "#94a3b8"),background:marketDirectionAlert?.direction === "BUY" ? "#f0fdf4" : marketDirectionAlert?.direction === "SELL" ? "#fef2f2" : "#f8fafc",lineHeight:1.6}}>
              <div style={{fontSize:18,fontWeight:950,color:marketDirectionAlert?.direction === "BUY" ? "#166534" : marketDirectionAlert?.direction === "SELL" ? "#991b1b" : "#334155"}}>
                {marketDirectionAlert?.direction === "BUY" ? "🟢 MARKET DIRECTION: BUY FAVOURED — START REVIEWING BUY SETUPS" : marketDirectionAlert?.direction === "SELL" ? "🔴 MARKET DIRECTION: SELL FAVOURED — START REVIEWING SHORT SETUPS" : "🟡 MARKET DIRECTION: WAIT — MIXED OR UNKNOWN"}
              </div>
              <div>{marketDirectionAlert?.message || "Waiting for current NIFTY direction."}</div>
              <div style={{fontSize:12,color:"#475569",marginTop:4}}>Direction is based on NIFTY intraday/daily trend only. This notification tells you when to begin reviewing the market; it is not a stock-specific entry signal. Manual trades remain enabled.</div>
              {marketDirectionError && <div style={{color:"#b91c1c"}}>Market direction error: {marketDirectionError}</div>}
              <div style={{fontSize:12,color:"#475569",marginTop:4}}>Market status: {marketDirectionAlert?.market_open ? "OPEN" : "CLOSED / NOT CONFIRMED"} · Updated: {marketDirectionAlert?.generated_at || "—"}</div>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,position:"sticky",top:90,zIndex:90,background:"#ffffff",padding:"10px 0",borderBottom:"1px solid #e2e8f0"}}>
              {[["🚨 20+/23 Alerts","perfect-score-alert"],["Research Watchlist","research-watchlist"],["Download JSON / CSV","intelligence-export"],["Strategy Comparison","strategy-comparison"],["Live Shadow Testing","live-shadow-testing"],["Shadow Trade Monitor","market-shadow-monitor"]].map(([label,id]) => (
                <button key={id} type="button" onClick={() => document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"})}
                  style={{padding:"9px 12px",border:"1px solid #94a3b8",borderRadius:8,background:"#f8fafc",color:"#0f172a",fontSize:13,fontWeight:800,cursor:"pointer",opacity:1}}>{label}</button>
              ))}
              <button type="button" onClick={loadResearchWatchlist}
                style={{padding:"9px 13px",border:"1px solid #0f766e",borderRadius:8,background:"#0f766e",color:"#ffffff",fontWeight:800,cursor:"pointer"}}>
                ↻ Refresh research watchlist
              </button>
            </div>
            <div id="perfect-score-alert" style={{scrollMarginTop:110}}>
              <Card title="🚨 High-Score Trade Alerts — 20+/23 Checks">
                <p style={{color:"#475569"}}>Shows only saved BUY/SELL candidates scoring at least 20 out of 23 checks. Feed refreshes every 30 seconds. A score alert is not an order instruction: manual trades remain available, and you should review freshness, market direction, stop-loss and targets before entering.</p>
                {!(researchWatchlist?.score_alerts || []).length ? (
                  <div style={{padding:12,border:"1px solid #cbd5e1",borderRadius:8,background:"#f8fafc"}}>No candidates scoring 20/23 or higher recorded in the current session yet.</div>
                ) : (
                  <>
                    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:8,margin:"10px 0 14px"}}>
                      <button type="button" onClick={() => setResearchSelections(previous => ({...previous,...Object.fromEntries((researchWatchlist?.score_alerts || []).map(item => [researchKey(item), true]))}))} disabled={!(researchWatchlist?.score_alerts || []).length} style={{padding:"8px 11px",border:"1px solid #1d4ed8",borderRadius:7,background:"#2563eb",color:"#ffffff",fontWeight:800,cursor:"pointer"}}>Select all 20+ alerts ({(researchWatchlist?.score_alerts || []).length})</button>
                      <button type="button" onClick={() => setResearchSelections(previous => { const next={...previous}; (researchWatchlist?.score_alerts || []).forEach(item => {delete next[researchKey(item)];}); return next; })} style={{padding:"8px 11px",border:"1px solid #cbd5e1",borderRadius:7,cursor:"pointer"}}>Clear 20+ selection</button>
                      <button type="button" onClick={sendSelectedScoreAlertsToIntraday} disabled={!(researchWatchlist?.score_alerts || []).some(item => researchSelections[researchKey(item)])} style={{padding:"8px 11px",border:0,borderRadius:7,background:"#0f766e",color:"white",fontWeight:900,cursor:"pointer"}}>Send selected to Intraday Monitoring ({(researchWatchlist?.score_alerts || []).filter(item => researchSelections[researchKey(item)]).length})</button>
                    </div>
                    <div style={{fontSize:12,color:"#475569",marginBottom:10}}>Bulk selection adds candidates to the monitoring basket only; it does not place trades.</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10}}>
                    {(researchWatchlist.score_alerts || []).map((item,i)=>(
                      <div key={`${item.symbol}-${item.side}-${item.timestamp}-${i}`} role="status" style={{padding:12,border:`2px solid ${item.checks_passed===23 ? "#16a34a" : "#d97706"}`,borderRadius:9,background:item.checks_passed===23 ? "#f0fdf4" : "#fffbeb",lineHeight:1.6}}>
                        <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,cursor:"pointer"}}><input type="checkbox" checked={Boolean(researchSelections[researchKey(item)])} onChange={event => setResearchSelections(previous => ({...previous,[researchKey(item)]:event.target.checked}))}/><strong>Select {item.symbol} · {item.side}</strong></label>
                        <div style={{fontWeight:900,color:item.checks_passed===23 ? "#166534" : "#92400e"}}>🚨 {item.symbol} · {item.side} · {item.checks_passed}/{item.checks_total}</div>
                        <div style={{padding:"3px 7px",display:"inline-block",margin:"3px 0",borderRadius:6,fontWeight:900,fontSize:11,background:item.executed_today ? "#dcfce7" : "#e2e8f0",color:item.executed_today ? "#166534" : "#334155"}}>{item.executed_today ? "✓ ALREADY EXECUTED TODAY" : "NOT EXECUTED TODAY"}</div>
                        <div style={{fontSize:13}}>Entry ₹{item.entry_price == null ? "—" : Number(item.entry_price).toFixed(2)} · SL ₹{item.stop_loss == null ? "—" : Number(item.stop_loss).toFixed(2)}</div>
                        <div style={{fontSize:13}}>T1 ₹{item.target_1 == null ? "—" : Number(item.target_1).toFixed(2)} · T2 ₹{item.target_2 == null ? "—" : Number(item.target_2).toFixed(2)}</div>
                        <div style={{fontSize:12,fontWeight:800,color:item.executable && item.strict_qualified && item.v8_execution_eligible ? "#166534" : "#9a3412"}}>{item.executable && item.strict_qualified && item.v8_execution_eligible ? "Eligibility passed — verify live conditions" : "Research only · not qualified for execution"}{item.stale ? " · STALE" : ""}</div>
                        <button type="button" onClick={() => sendResearchToIntraday(item)} style={{marginTop:7,padding:"7px 10px",border:"1px solid #0f766e",borderRadius:7,cursor:"pointer"}}>Send to Intraday</button>
                      </div>
                    ))}
                    </div>
                  </>
                )}
              </Card>
            </div>
            <div id="research-watchlist" style={{scrollMarginTop:110}}>
            <Card title="V10.8 — Research Watchlist (MONITOR ONLY)">
              <p style={{color:"#475569"}}>Top saved BUY/SELL observations, including rejected candidates. Market alignment and fewer failed checks are prioritized. This is not a trade recommendation or order approval. Refreshes every 30 seconds.</p>
              <button type="button" onClick={loadResearchWatchlist} style={{padding:"9px 13px",border:"1px solid #94a3b8",borderRadius:8,background:"#f8fafc",color:"#0f172a",fontWeight:700,cursor:"pointer"}}>Refresh research watchlist</button>
              {researchWatchlistError && <p style={{color:"#b91c1c"}}>{researchWatchlistError}</p>}
              {researchWatchlist && <p style={{color:"#475569"}}>Date: {researchWatchlist.trade_date} · Recorded rows: {researchWatchlist.scanned_rows} · Unique pairs: {researchWatchlist.unique_pairs}</p>}
              <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:10,margin:"12px 0"}}>
                <button type="button" onClick={() => setResearchSelections(Object.fromEntries(researchCandidates.map(item => [researchKey(item), true])))} disabled={!researchCandidates.length}>Select all displayed</button>
                <button type="button" onClick={() => setResearchSelections({})}>Clear selection</button>
                <button type="button" onClick={sendSelectedResearchToIntraday} disabled={!researchCandidates.some(item => researchSelections[researchKey(item)])}
                  style={{padding:"9px 13px",borderRadius:8,background:"#0f766e",color:"white",fontWeight:800,border:0,cursor:"pointer"}}>
                  Send selected to Intraday ({researchCandidates.filter(item => researchSelections[researchKey(item)]).length})
                </button>
                <span style={{fontSize:12,color:"#475569"}}>Adds multiple stocks to a monitoring basket; never places orders.</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
                {[["BUY research",researchWatchlist?.buy_research],["SELL research",researchWatchlist?.sell_research]].map(([heading,items])=>(
                  <div key={heading} style={{border:"1px solid #cbd5e1",borderRadius:9,padding:12}}>
                    <strong>{heading}</strong>
                    {!items?.length && <p>No saved candidates for this side.</p>}
                    {(items||[]).map((item,i)=>(
                      <div key={`${item.symbol}-${i}`} style={{padding:"10px 0",borderBottom:"1px solid #e2e8f0",fontSize:13,lineHeight:1.6}}>
                        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                          <input type="checkbox" checked={Boolean(researchSelections[researchKey(item)])}
                            onChange={event => setResearchSelections(previous => ({...previous,[researchKey(item)]:event.target.checked}))}/>
                          <strong>{item.symbol} · {item.side}</strong> — <strong style={{color:"#b91c1c"}}>RESEARCH ONLY</strong>
                        </label>
                        <div>Quality: {item.setup_quality ?? "n/a"} · Checks: {item.checks_passed}/{item.checks_total} · Market aligned: {item.market_aligned ? "Yes" : "No"}</div>
                        <div>Volume: {item.volume_ratio == null ? "n/a" : `${item.volume_ratio.toFixed(2)}×`} · Extension: {item.entry_extension_atr == null ? "n/a" : `${item.entry_extension_atr.toFixed(2)} ATR`}</div>
                        <div>Record age: {item.age_minutes ?? "unknown"} min {item.stale ? "· STALE" : ""}</div>
                        <div>Failed: {item.failed_checks?.length ? item.failed_checks.map(x=>x.replaceAll("_"," ")).join(", ") : "None recorded"}</div>
                        {item.unknown_checks?.length > 0 && <div style={{color:"#92400e"}}>Unknown: {item.unknown_checks.join(", ")}</div>}
                        {item.derived_failed_checks?.length > 0 && <div style={{color:"#991b1b"}}>Derived veto: {item.derived_failed_checks.join(", ")}</div>}
                        <button type="button" onClick={() => sendResearchToIntraday(item)} style={{marginTop:7,padding:"7px 10px",border:"1px solid #0f766e",borderRadius:7,cursor:"pointer"}}>Send to Intraday (monitor only)</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p style={{fontSize:12,color:"#64748b"}}>The completed-candle volume diagnostic is available at /api/intelligence/completed-volume-check?symbol=RELIANCE. It does not alter the execution strategy.</p>
            </Card>
            </div>
            <div id="intelligence-export" style={{scrollMarginTop:110}}>
            <Card title="Download JSON and CSV">
              <p style={{color:"#475569"}}>Export saved candidate assessments (including rejected candidates) and executed trades. These files can be shared for offline strategy research.</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                {[["candidates","json"],["candidates","csv"],["trades","json"],["trades","csv"]].map(([kind,format])=>(
                  <button key={`${kind}-${format}`} onClick={()=>downloadIntelligence(kind,format)}
                    style={{padding:"11px 14px",borderRadius:9,border:"1px solid #cbd5e1",background:"#f8fafc",color:"#0f172a",cursor:"pointer",fontWeight:700}}>
                    {kind.toUpperCase()} • {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </Card>
            </div>
            <div id="strategy-comparison" style={{scrollMarginTop:110}}>
            <Card title="V10 Strategy Comparison — Recorded Outcomes (Research Only)">
              <p style={{color:"#475569"}}>Compare recorded closing transactions by entry direction, strategy mode, and exit reason. This is an observational comparison, not an ORB/VWAP/pullback backtest. It cannot predict future profits.</p>
              <button onClick={loadStrategyComparison} disabled={comparisonLoading} style={{padding:"10px 16px",border:"1px solid #94a3b8",borderRadius:8,background:"#f8fafc",color:"#0f172a",fontWeight:700,cursor:"pointer"}}>{comparisonLoading?"Comparing...":"Refresh comparison"}</button>
              {comparisonError && <p style={{color:"#b91c1c"}}>{comparisonError}</p>}
              {strategyComparison && <>
                <p style={{color:"#475569"}}>Examined {strategyComparison.trades_examined} transactions, including {strategyComparison.closing_transactions} closing transactions; {strategyComparison.candidate_summary?.count} candidates. {strategyComparison.candidate_summary?.after_hours} candidates were captured when the recorded market status was not OPEN.</p>
                <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Group","Cohort","Closes","Wins / Losses","Win %","Net P&L","Avg win","Avg loss","Max closed P&L drawdown"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>{(strategyComparison.cohorts||[]).map((r,i)=><tr key={`${r.group}-${r.label}-${i}`}>
                    <td style={tdStyle}>{r.group}</td><td style={tdStyle}>{r.label}</td><td style={tdStyle}>{r.count}</td><td style={tdStyle}>{r.wins} / {r.losses}</td>
                    <td style={tdStyle}>{r.win_rate===null?"—":`${r.win_rate}%`}</td>
                    <td style={{...tdStyle,color:r.net_pnl<0?"#b91c1c":"#166534",fontWeight:700}}>{formatMoney(r.net_pnl)}</td>
                    <td style={tdStyle}>{formatMoney(r.avg_win)}</td><td style={tdStyle}>{formatMoney(r.avg_loss)}</td><td style={tdStyle}>{formatMoney(r.max_closed_trade_drawdown)}</td>
                  </tr>)}</tbody>
                </table></div>
                <p style={{color:"#64748b",fontSize:13}}>{(strategyComparison.notes||[]).join(" ")}</p>
              </>}
            </Card>
            </div>
            <div id="live-shadow-testing" style={{scrollMarginTop:110}}>
            <Card title="V10.1 Live Shadow Testing — Research Only">
              <p style={{color:"#475569"}}>The existing scanner records live, completed-candle observations during market hours. Diagnostic variants do not approve or execute trades. This panel refreshes every 60 seconds while open.</p>
              <button onClick={loadLiveShadow} style={{padding:"10px 16px",border:"1px solid #94a3b8",borderRadius:8,background:"#f8fafc",color:"#0f172a",fontWeight:700}}>Refresh live shadow</button>
              {liveShadowError && <p style={{color:"#b91c1c"}}>{liveShadowError}</p>}
              {liveShadow && <>
                <p>Recorded observations: <b>{liveShadow.count}</b>. No new observations are expected outside market hours.</p>
                <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>{["Research variant","Observed","Selected","Target first","Stop first","Other resolved","Pending"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                  <tbody>{(liveShadow.variants||[]).map(v=><tr key={v.name}>{[v.name,v.observed,v.selected,v.target_first,v.stop_first,v.other_resolved,v.pending].map((x,i)=><td key={i} style={tdStyle}>{x}</td>)}</tr>)}</tbody>
                </table></div>
                <p style={{color:"#64748b",fontSize:13}}>{(liveShadow.notes||[]).join(" ")}</p>
              </>}
            </Card>
            </div>
          </div>
        )}

        {appPage === "INTELLIGENCE" && researchMonitorBasket.length > 0 && (
          <div style={{padding:14,margin:"12px 0",border:"1px solid #0f766e",borderRadius:10,background:"#f0fdfa",color:"#0f172a"}}>
            <strong style={{color:"#0f172a"}}>Intraday research monitoring basket ({researchMonitorBasket.length}) — no orders placed</strong>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:10}}>
              {researchMonitorBasket.map(item => <div key={researchKey(item)} style={{display:"flex",gap:3,alignItems:"center"}}>
                <button type="button" onClick={() => viewResearchBasketItem(item)}
                  style={{padding:"7px 10px",borderRadius:7,border:"1px solid #0f766e",background:researchTransfer?.symbol===item.symbol?"#ccfbf1":"#ffffff",color:"#0f172a",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  {item.symbol} · {item.side}{item.stale?" · stale":""}
                </button>
                <button type="button" title={`Remove ${item.symbol} ${item.side} from monitoring`} onClick={() => {
                  setResearchMonitorBasket(previous => previous.filter(x => researchKey(x)!==researchKey(item)));
                  if (researchTransfer && researchKey(researchTransfer)===researchKey(item)) setResearchTransfer(null);
                }} style={{cursor:"pointer",border:"1px solid #cbd5e1",borderRadius:6,background:"#ffffff",color:"#b91c1c",fontWeight:800,fontSize:18,minWidth:28,minHeight:28}}>×</button>
              </div>)}
            </div>
            <button type="button" onClick={() => {setResearchMonitorBasket([]);setResearchTransfer(null);}} style={{marginTop:10,cursor:"pointer",background:"#334155",color:"#ffffff",fontWeight:700,border:"1px solid #334155",borderRadius:6,padding:"8px 14px"}}>Clear monitoring basket</button>
          </div>
        )}
        {appPage === "INTELLIGENCE" && (
          <div id="market-shadow-monitor" style={{scrollMarginTop:160,padding:14,margin:"12px 0",border:"1px solid #64748b",borderRadius:10,background:"#f8fafc"}}>
            <strong>V11.2 · Market Intelligence Shadow Trade Monitor — NO REAL ORDERS</strong>
            <p style={{fontSize:12,color:"#475569"}}>Hypothetical entry at fetched indicative quote; gross P&L excludes fees, slippage and taxes. Virtual stop-loss and target levels are also proposed as defaults when manually sending a positive shadow trade to paper; paper target setup is a separate request and may fail. Not a live fill or prediction. Closed and promoted positions disappear from this active table but remain saved in SQLite for learning.</p>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <label>Virtual quantity per stock <input type="number" min="1" max="100000" value={shadowQty} onChange={e=>setShadowQty(e.target.value)} style={{width:80,marginLeft:6}}/></label>
              <button type="button" disabled={shadowBusy||!researchMonitorBasket.length} onClick={startShadowBasket}>Start virtual trades for basket ({researchMonitorBasket.length})</button>
              <button type="button" disabled={shadowBusy} onClick={()=>loadShadowTrades(true)}>Refresh virtual prices</button>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13}}><input type="checkbox" checked={autoPaperRequested} onChange={e=>setAutoPaperRequested(e.target.checked)}/> Request auto paper-trading eligibility checks (no orders)</label>
            </div>
            <p style={{fontSize:12,color:"#92400e",fontWeight:700}}>Automatic paper execution remains OFF. For testing, use the explicit Send to paper (TEST) button on a positive virtual position. This is a MANUAL OVERRIDE, not scanner approval; trading-hour and backend account restrictions still apply.</p>
            <div role="status" aria-live="polite" style={{color:"#0f172a",fontWeight:700,background:"#fef3c7",border:"1px solid #d97706",padding:"10px 12px",borderRadius:7,margin:"10px 0"}}>
              {testPaperResult || "To send a virtual trade to paper: ensure positive P&L, click Auto-fill defaults (optional), then Send to paper (TEST). The system will suggest quantity and SL/target if blank. The result or reason for rejection will appear here."}
            </div>
            {shadowError && <p style={{color:"#b91c1c"}}>{shadowError}</p>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12,margin:"12px 0"}}>
              <div style={{padding:"14px 16px",border:"1px solid #16a34a",borderRadius:10,background:"#f0fdf4",color:"#166534",minWidth:0}}>
                <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>Profit</div>
                <div style={{fontSize:22,fontWeight:900,marginTop:4,overflowWrap:"anywhere"}}>{formatMoney((shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)>0).reduce((sum,t)=>sum+Number(t.gross_pnl||0),0))}</div>
                <div style={{fontSize:11,marginTop:3}}>Open virtual trades in profit</div>
                <div style={{marginTop:10,borderTop:"1px solid #bbf7d0",paddingTop:8}}>
                  {(shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)>0).length===0
                    ? <div style={{fontSize:12}}>No open trades currently in profit.</div>
                    : (shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)>0).map(t=><div key={`profit-${t.id}`} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12,padding:"4px 0",borderBottom:"1px solid #dcfce7"}}><span><strong>{t.symbol}</strong> · {t.side} · Qty {t.quantity}<div style={{fontSize:10,fontWeight:800,color:shadowPaperExecutionLabel(t).startsWith("PAPER EXECUTED")?"#166534":"#92400e"}}>{shadowPaperExecutionLabel(t)}</div></span><strong>{formatMoney(t.gross_pnl)}</strong></div>)}
                </div>
              </div>
              <div style={{padding:"14px 16px",border:"1px solid #dc2626",borderRadius:10,background:"#fef2f2",color:"#991b1b",minWidth:0}}>
                <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>Loss</div>
                <div style={{fontSize:22,fontWeight:900,marginTop:4,overflowWrap:"anywhere"}}>{formatMoney((shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)<0).reduce((sum,t)=>sum+Number(t.gross_pnl||0),0))}</div>
                <div style={{fontSize:11,marginTop:3}}>Open virtual trades in loss</div>
                <div style={{marginTop:10,borderTop:"1px solid #fecaca",paddingTop:8}}>
                  {(shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)<0).length===0
                    ? <div style={{fontSize:12}}>No open trades currently in loss.</div>
                    : (shadowData?.trades||[]).filter(t=>t.status==="OPEN"&&Number(t.gross_pnl)<0).map(t=><div key={`loss-${t.id}`} style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap",fontSize:12,padding:"4px 0",borderBottom:"1px solid #fee2e2"}}><span><strong>{t.symbol}</strong> · {t.side} · Qty {t.quantity}<div style={{fontSize:10,fontWeight:800,color:shadowPaperExecutionLabel(t).startsWith("PAPER EXECUTED")?"#166534":"#92400e"}}>{shadowPaperExecutionLabel(t)}</div></span><strong>{formatMoney(t.gross_pnl)}</strong></div>)}
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10,margin:"10px 0",fontSize:12}}>
              <div style={{padding:10,border:"1px solid #86efac",borderRadius:8,background:"#f0fdf4"}}><strong style={{color:"#166534"}}>PAPER EXECUTED</strong><div style={{marginTop:5}}>{(shadowData?.trades||[]).filter(t=>shadowPaperExecutionLabel(t).startsWith("PAPER EXECUTED")).length ? [...new Set((shadowData?.trades||[]).filter(t=>shadowPaperExecutionLabel(t).startsWith("PAPER EXECUTED")).map(t=>`${t.symbol} · ${t.side}`))].join(", ") : "No matching paper executions found in today's trade history."}</div></div>
              <div style={{padding:10,border:"1px solid #fcd34d",borderRadius:8,background:"#fffbeb"}}><strong style={{color:"#92400e"}}>NOT EXECUTED · VIRTUAL ONLY</strong><div style={{marginTop:5}}>{(shadowData?.trades||[]).filter(t=>t.status==="OPEN").length ? (shadowData?.trades||[]).filter(t=>t.status==="OPEN").map(t=>`${t.symbol} · ${t.side}`).join(", ") : "No open virtual trades."}</div></div>
            </div>
            <p style={{fontSize:12,color:"#475569",marginTop:0}}><strong>Open virtual trades:</strong> {shadowData?.open_count ?? 0} · <strong>Closed gross P&amp;L:</strong> {formatMoney(shadowClosedPnlBaseline === null ? 0 : Number(shadowData?.gross_closed_pnl ?? 0) - shadowClosedPnlBaseline)}</p>
            <div id="market-shadow-trades-table" style={{overflowX:"auto",scrollMarginTop:160}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
              <thead><tr>{["Stock","Side","Qty","Entry ₹","Stop-loss ₹","Buy-back / Sell target ₹","Last/Exit ₹","Gross P&L","Status","Quote fetched","Action"].map(h=><th key={h} style={{padding:7,textAlign:"left",borderBottom:"1px solid #cbd5e1"}}>{h}</th>)}</tr></thead>
              <tbody>{(shadowData?.trades||[]).filter(t=>t.status==="OPEN").map(t=><tr key={t.id}>
                <td>{t.symbol}</td><td>{t.side}</td><td>{t.quantity}</td><td>{t.entry_price?.toFixed(2)}</td>
                <td>{t.status==="OPEN" ? <input type="number" step="0.01" min="0.01" style={{width:85}} placeholder="Stop ₹" aria-label={`${t.symbol} stop loss`} value={shadowLevelInputs[t.id]?.stop_loss ?? t.stop_loss ?? ""} onChange={e=>setShadowLevelInputs(p=>({...p,[t.id]:{...p[t.id],stop_loss:e.target.value}}))}/> : t.stop_loss?.toFixed(2)??"—"}</td>
                <td>{t.status==="OPEN" ? <input type="number" step="0.01" min="0.01" style={{width:85}} placeholder="Target ₹" aria-label={`${t.symbol} target`} value={shadowLevelInputs[t.id]?.target_price ?? t.target_price ?? ""} onChange={e=>setShadowLevelInputs(p=>({...p,[t.id]:{...p[t.id],target_price:e.target.value}}))}/> : t.target_price?.toFixed(2)??"—"}</td>
                <td>{(t.exit_price??t.last_price)?.toFixed(2)}</td>
                <td style={{color:t.gross_pnl>=0?"#15803d":"#b91c1c",fontWeight:700}}>{Math.abs(Number(t.gross_pnl)||0)<0.005?"₹0.00":formatMoney(t.gross_pnl)}</td><td>{t.status}{t.exit_reason ? ` · ${t.exit_reason}` : ""}{t.status==="OPEN" && Number(t.gross_pnl)>0 ? " · POSITIVE (AUDIT ONLY)" : ""}</td><td>{t.last_checked_at}</td>
                <td><div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  {t.status==="OPEN" && <button type="button" disabled={shadowBusy} onClick={()=>saveShadowLevels(t)}>Save SL / Target</button>}{t.status==="OPEN" && <button type="button" disabled={shadowBusy} onClick={()=>closeShadowTrade(t.id)}>Close virtual</button>}
                  {t.status==="OPEN" && Number(t.gross_pnl)>0 && <>
                    <input type="number" min="1" max="100000" step="1" placeholder={`Qty (virtual ${t.quantity})`} aria-label={`Test quantity for ${t.symbol}`}
                      title="Enter the number of shares to execute. If blank, original scanner predicted quantity is used when available."
                      style={{width:105,background:"#ffffff",color:"#0f172a",border:"1px solid #64748b"}} value={testPaperQuantities[t.id]??""}
                      onChange={e=>setTestPaperQuantities(p=>({...p,[t.id]:e.target.value}))}/>
                    <button type="button" disabled={testPaperBusy!==null} onClick={()=>{void usePaperDefaults(t);}}
                      style={{background:"#e0f2fe",color:"#075985",border:"1px solid #0284c7",padding:"8px 10px",borderRadius:6,fontWeight:700}}>Auto-fill defaults</button>
                    <button type="button" disabled={testPaperBusy!==null} onClick={()=>{setTestPaperResult(`${t.symbol}: preparing paper trade...`);void sendPositiveShadowToPaper(t);}}
                      style={{background:"#0f766e",color:"#ffffff",border:"1px solid #115e59",padding:"8px 12px",borderRadius:6,fontWeight:700,cursor:testPaperBusy!==null?"wait":"pointer"}}>
                      {testPaperBusy===t.id?"Processing paper order...":"Send to paper (TEST)"}
                    </button>
                  </>}
                </div></td>
              </tr>)}</tbody>
            </table></div>
          </div>
        )}
        {appPage === "LIVE" && researchTransfer && (
          <div role="status" style={{padding:"12px 16px",margin:"12px 0",border:"1px solid #0f766e",borderRadius:9,background:"#f0fdfa",color:"#134e4a"}}>
            <strong>Monitoring {researchTransfer.symbol} · recorded {researchTransfer.side} research direction</strong>
            <div>Research only — no order placed. Verify live market regime, volume, VWAP, closed 5m/15m confirmation, stop and target before considering a trade.</div>
            {researchTransfer.stale && <div style={{color:"#92400e"}}>The transferred research snapshot was stale.</div>}
            <button type="button" onClick={() => setResearchTransfer(null)} style={{marginTop:6,cursor:"pointer"}}>Dismiss research context</button>
          </div>
        )}
        {appPage === "LIVE" && (
          <>
        {/* ==================================================
            STOCK CATEGORY SELECTOR
        ================================================== */}

        <Card style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  color: "#0f172a",
                }}
              >
                Select Stock Category
              </div>

              <div
                style={{
                  marginTop: 4,
                  color: "#64748b",
                  fontSize: 13,
                }}
              >
                Choose Normal for delivery-style technical analysis or
                Intraday for Buy / Sell trading analysis.
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                minWidth: 310,
              }}
            >
              <button
                type="button"
                onClick={() => changeAnalysisCategory("NORMAL")}
                style={{
                  padding: "12px 18px",
                  borderRadius: 9,
                  border:
                    analysisCategory === "NORMAL"
                      ? "2px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background:
                    analysisCategory === "NORMAL"
                      ? "#2563eb"
                      : "#ffffff",
                  color:
                    analysisCategory === "NORMAL"
                      ? "#ffffff"
                      : "#334155",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Normal
              </button>

              <button
                type="button"
                onClick={() => changeAnalysisCategory("INTRADAY")}
                style={{
                  padding: "12px 18px",
                  borderRadius: 9,
                  border:
                    analysisCategory === "INTRADAY"
                      ? "2px solid #7c3aed"
                      : "1px solid #cbd5e1",
                  background:
                    analysisCategory === "INTRADAY"
                      ? "#7c3aed"
                      : "#ffffff",
                  color:
                    analysisCategory === "INTRADAY"
                      ? "#ffffff"
                      : "#334155",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Intraday
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 13,
              padding: "10px 12px",
              borderRadius: 8,
              background:
                analysisCategory === "INTRADAY"
                  ? "#f5f3ff"
                  : "#eff6ff",
              border:
                analysisCategory === "INTRADAY"
                  ? "1px solid #ddd6fe"
                  : "1px solid #bfdbfe",
              color:
                analysisCategory === "INTRADAY"
                  ? "#6d28d9"
                  : "#1d4ed8",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            Current category:{" "}
            {analysisCategory === "INTRADAY"
              ? "Intraday Buy / Sell Analysis"
              : "Normal Stock Analysis"}
            {" • "}
            Selected stock: {symbol}
          </div>
        </Card>

        {/* ==================================================
            SEARCH
        ================================================== */}

        <Card style={{ marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <input
              type="text"
              placeholder={
                analysisCategory === "INTRADAY"
                  ? "Search stock for intraday analysis..."
                  : "Search stock or index for normal analysis..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 250,
                padding: "12px 14px",
                borderRadius: 9,
                border: "1px solid #cbd5e1",
                fontSize: 15,
                outline: "none",
              }}
            />

            <button
              onClick={searchStocks}
              style={{
                padding: "12px 20px",
                borderRadius: 9,
                border: "none",
                background:
                  analysisCategory === "INTRADAY"
                    ? "#7c3aed"
                    : "#2563eb",
                color: "#ffffff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Search
            </button>
          </div>

          {analysisCategory === "INTRADAY" && (
            <div
              style={{
                marginTop: 9,
                padding: "9px 11px",
                borderRadius: 8,
                background: "#f5f3ff",
                border: "1px solid #ddd6fe",
                color: "#6d28d9",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.5,
              }}
            >
              Search and select a stock, then send it directly to Intraday Buy / Sell Analysis and Intraday Paper Trading.
            </div>
          )}

          {/* Search results */}

          {searchResults.length > 0 && (
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              {searchResults.slice(0, 10).map((item, index) => {
                const itemSymbol =
                  item.symbol || item.ticker || item.name || item;

                return (
                  <button
                    key={`${itemSymbol}-${index}`}
                    onClick={() => {
                      if (analysisCategory === "INTRADAY") {
                        setDayTradeSymbol(itemSymbol);
                        setPaperStockSearch(itemSymbol);
                        setPaperSearchSelected(itemSymbol);
                        setPaperSendMessage(
                          `${itemSymbol} selected in Intraday Buy / Sell Analysis and Intraday Paper Trading.`
                        );
                      }

                      selectStockForCategory(
                        itemSymbol,
                        analysisCategory
                      );
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "1px solid #e2e8f0",
                      background:
                        analysisCategory === "INTRADAY"
                          ? "#faf5ff"
                          : "#f8fafc",
                      borderRadius: 8,
                      cursor: "pointer",
                    }}
                  >
                    <strong>{itemSymbol}</strong>

                    {item.name && item.name !== itemSymbol && (
                      <span
                        style={{
                          marginLeft: 8,
                          color: "#64748b",
                        }}
                      >
                        {item.name}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick buttons */}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 14,
            }}
          >
            {quickSymbols.map((item) => (
              <button
                key={item}
                onClick={() => {
                  selectStockForCategory(item, analysisCategory);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border:
                    item === symbol
                      ? "1px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background: item === symbol ? "#dbeafe" : "#ffffff",
                  color: item === symbol ? "#1d4ed8" : "#334155",
                  cursor: "pointer",
                  fontWeight: item === symbol ? 700 : 500,
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </Card>

        {analysisCategory === "INTRADAY" && (
          <>
        {/* ==================================================
            INTRADAY STOCK OPPORTUNITIES
        ================================================== */}

        <Card
          title="🔥 Intraday Stock Opportunities"
          style={{
            marginBottom: 18,
            border: "2px solid #bfdbfe",
          }}
        >
          {/* V7 WHOLE-MARKET + EXECUTION-TIME DECISION PANEL */}
          <div
            style={{
              padding: 16,
              marginBottom: 14,
              borderRadius: 12,
              border: `2px solid ${
                executionReminder?.status === "ANALYZE_NOW" ? "#60a5fa" :
                executionReminder?.status === "NO_NEW_ENTRY" ? "#94a3b8" : "#fbbf24"
              }`,
              background: executionReminder?.status === "ANALYZE_NOW" ? "#eff6ff" :
                executionReminder?.status === "NO_NEW_ENTRY" ? "#f8fafc" : "#fffbeb",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                  V7 PRE-TRADE MARKET DECISION
                </div>
          {(() => {
            const clock = getISTTradingClock(liveIST);
            return (
              <div style={{
                marginBottom: 14,
                padding: 14,
                borderRadius: 12,
                border: "2px solid #0f172a",
                background: clock.phase === "BUY_WINDOW" ? "#dcfce7" :
                            clock.phase === "SELL_WINDOW" ? "#fee2e2" :
                            clock.phase === "NO_NEW_ENTRY" ? "#f1f5f9" : "#fef3c7"
              }}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
                  <Indicator label="LIVE IST TIME" value={clock.timeText} />
                  <Indicator label="TIME STATUS" value={clock.action} />
                  <Indicator label="NEXT TIME" value={clock.nextLabel} />
                  <Indicator label="COUNTDOWN" value={clock.countdown} />
                </div>
                <div style={{marginTop:10,fontWeight:800,color:"#0f172a"}}>
                  {clock.message}
                </div>
                <div style={{marginTop:8,fontSize:13,color:"#475569"}}>
                  Preferred research windows: BUY 5m → 12:30–1:30 PM IST • SELL 15m → 1:30–2:30 PM IST.
                  Time is a reminder to re-analyze, not an automatic trade signal.
                </div>
              </div>
            );
          })()}

                <div style={{ marginTop: 5, fontSize: 13, color: "#475569" }}>
                  Whole-market confirmation is checked before any stock is allowed to become executable.
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                {executionReminder?.status === "ANALYZE_NOW" ? "🔎 ANALYZE NOW" :
                 executionReminder?.status === "NO_NEW_ENTRY" ? "⛔ NO NEW ENTRY" : "⏰ WAIT"}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 14 }}>
              <Indicator
                label="Market Bias"
                value={wholeMarketPretrade?.allow_buy ? "BUY FAVOURED" : wholeMarketPretrade?.allow_sell ? "SELL FAVOURED" : "DEFENSIVE / MIXED"}
                positive={wholeMarketPretrade?.allow_buy === true}
                negative={wholeMarketPretrade?.allow_sell === true}
              />
              <Indicator label="NIFTY" value={wholeMarketPretrade?.nifty_regime?.regime || "—"} />
              <Indicator label="BANK NIFTY 15m" value={wholeMarketPretrade?.bank_nifty_15m_direction || "—"} />
              <Indicator
                label="Breadth BUY / SELL"
                value={`${wholeMarketPretrade?.scanner_breadth?.buy ?? "—"} / ${wholeMarketPretrade?.scanner_breadth?.sell ?? "—"}`}
              />
              <Indicator label="Next Analysis" value={executionReminder?.next_time_ist || "—"} />
            </div>

            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 800, color: "#334155", lineHeight: 1.55 }}>
              {executionReminder?.message || "Waiting for V7 execution reminder..."}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
              {wholeMarketPretrade?.message || "Waiting for the next whole-market scanner snapshot."}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "#7c3aed" }}>
              Reminder ≠ automatic trade. Execute only when STRICT QUALIFIED + EXECUTABLE + whole-market direction + closed 5m/15m confirmation all agree.
            </div>
          </div>

          {/* TODAY'S SUGGESTION SUMMARY */}
          <div
            style={{
              padding: 16,
              marginBottom: 14,
              borderRadius: 12,
              border: `2px solid ${
                todaySuggestionSummary?.no_further_suggestion_today
                  ? "#94a3b8"
                  : todaySuggestionSummary?.realized_pnl > 0
                    ? "#86efac"
                    : todaySuggestionSummary?.realized_pnl < 0
                      ? "#fca5a5"
                      : "#fde68a"
              }`,
              background:
                todaySuggestionSummary?.no_further_suggestion_today
                  ? "#f8fafc"
                  : todaySuggestionSummary?.realized_pnl > 0
                    ? "#f0fdf4"
                    : todaySuggestionSummary?.realized_pnl < 0
                      ? "#fef2f2"
                      : "#fffbeb",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
              TODAY'S SUGGESTION SUMMARY
            </div>

            {todaySuggestionSummary ? (
              <>
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800 }}>
                  Latest: {todaySuggestionSummary.status === "CORRECT"
                    ? "✅ CORRECT"
                    : todaySuggestionSummary.status === "WRONG"
                      ? "❌ WRONG"
                      : todaySuggestionSummary.status === "BREAKEVEN"
                        ? "➖ BREAKEVEN"
                        : "🟡 WAITING FOR COMPLETED TRADE"}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#334155", fontWeight: 700 }}>
                  Trades: {todaySuggestionSummary.completed_trades ?? 0}
                  {" • "}Wins: {todaySuggestionSummary.wins ?? 0}
                  {" • "}Losses: {todaySuggestionSummary.losses ?? 0}
                  {" • "}P&L: {formatMoney(todaySuggestionSummary.realized_pnl ?? 0)}
                </div>
                <div style={{ marginTop: 7, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                  {todaySuggestionSummary.headline}
                </div>
                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800, color: todaySuggestionSummary.no_further_suggestion_today ? "#475569" : "#2563eb", lineHeight: 1.5 }}>
                  {todaySuggestionSummary.no_further_suggestion_today ? "⛔ " : "🔎 "}
                  {todaySuggestionSummary.next_action}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  Qualified suggestions used: {todaySuggestionSummary.qualified_suggestions_used ?? 0}
                  {" • "}Remaining today: {todaySuggestionSummary.qualified_suggestions_remaining ?? 0}
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800 }}>
                  {scannerSessionPhase === "END_OF_DAY" || scannerMarketStatus === "CLOSED"
                    ? "⛔ MARKET CLOSED — END OF DAY"
                    : localTodayTradeSummary.completed_trades > 0
                      ? localTodayTradeSummary.realized_pnl > 0
                        ? "Latest: ✅ CORRECT"
                        : localTodayTradeSummary.realized_pnl < 0
                          ? "Latest: ❌ WRONG"
                          : "Latest: ➖ BREAKEVEN"
                      : "🟡 SCANNING — WAIT FOR SETUP"}
                </div>

                <div style={{ marginTop: 6, fontSize: 13, color: "#334155", fontWeight: 700 }}>
                  Trades: {localTodayTradeSummary.completed_trades}
                  {" • "}Wins: {localTodayTradeSummary.wins}
                  {" • "}Losses: {localTodayTradeSummary.losses}
                  {" • "}Breakeven: {localTodayTradeSummary.breakeven}
                  {" • "}Win Rate: {localTodayTradeSummary.win_rate.toFixed(2)}%
                  {" • "}P&L: {formatMoney(localTodayTradeSummary.realized_pnl)}
                </div>

                <div style={{ marginTop: 7, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                  {localTodayTradeSummary.completed_trades > 0
                    ? localTodayTradeSummary.realized_pnl > 0
                      ? "Today's completed intraday trades are net positive."
                      : localTodayTradeSummary.realized_pnl < 0
                        ? "Today's completed intraday trades are net negative."
                        : "Today's completed intraday trades are at breakeven."
                    : "No completed intraday trade is recorded for today yet."}
                </div>

                <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800, color: "#475569", lineHeight: 1.5 }}>
                  {scannerSessionPhase === "END_OF_DAY" || scannerMarketStatus === "CLOSED"
                    ? "⛔ Market session is finished. No further suggestion today."
                    : "🔎 The scanner will show a trade only when a setup qualifies."}
                </div>

                <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  {scannerUpdatedAt
                    ? `Scanner last updated: ${scannerUpdatedAt}`
                    : "Waiting for scanner update..."}
                </div>
              </>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 12px",
              marginBottom: 14,
              border: "1px solid #ddd6fe",
              borderRadius: 9,
              background: "#f5f3ff",
            }}
          >
            <div
              style={{
                color: "#6d28d9",
                fontSize: 13,
                fontWeight: 900,
                marginRight: 4,
              }}
            >
              Chart / Analysis Timeframe
            </div>

            <div style={{ color: "#64748b", fontSize: 12, fontWeight: 700 }}>
              5m analysis view. V7 scanner information remains separate from manual paper-order permission.
            </div>

            {["5m"].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setIntradayInterval(item)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border:
                    intradayInterval === item
                      ? "2px solid #7c3aed"
                      : "1px solid #cbd5e1",
                  background:
                    intradayInterval === item
                      ? "#7c3aed"
                      : "#ffffff",
                  color:
                    intradayInterval === item
                      ? "#ffffff"
                      : "#475569",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {item}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#0f172a",
                }}
              >
                Scanner: {intradayInterval} • Market: {scannerMarketStatus}
              </div>

              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  fontWeight: 800,
                  color:
                    scannerSessionPhase === "NORMAL_SCAN"
                      ? "#16a34a"
                      : scannerSessionPhase === "CONSERVATIVE_SCAN"
                        ? "#d97706"
                        : scannerSessionPhase === "MARKET_SETTLING"
                          ? "#2563eb"
                          : "#64748b",
                }}
              >
                Today's Session: {String(scannerSessionPhase || "—").replaceAll("_", " ")}
              </div>

              {scannerPhaseMessage ? (
                <div
                  style={{
                    marginTop: 4,
                    color: "#475569",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {scannerPhaseMessage}
                </div>
              ) : null}

              <div
                style={{
                  marginTop: 4,
                  color: "#64748b",
                  fontSize: 12,
                }}
              >
                BUY setups: {scannerBuyCount} • SELL setups: {scannerSellCount}
                {scannerUpdatedAt ? ` • Updated: ${scannerUpdatedAt}` : ""}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                onClick={enableTradeNotifications}
                style={{
                  padding: "10px 13px",
                  borderRadius: 9,
                  border: tradeNotificationsEnabled
                    ? "1px solid #16a34a"
                    : "1px solid #cbd5e1",
                  background: tradeNotificationsEnabled
                    ? "#dcfce7"
                    : "#ffffff",
                  color: tradeNotificationsEnabled
                    ? "#15803d"
                    : "#475569",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
                title="Browser notifications include market-direction reminders and qualified BUY/SELL alerts."
              >
                {tradeNotificationsEnabled
                  ? "🔔 Market & Qualified Alerts ON"
                  : "🔕 Enable Market & Qualified Alerts"}
              </button>
            </div>

              <button
              onClick={() => loadScanner(true)}
              disabled={scannerLoading}
              style={{
                padding: "10px 15px",
                border: "none",
                borderRadius: 9,
                background: scannerLoading ? "#94a3b8" : "#2563eb",
                color: "#ffffff",
                fontWeight: 800,
                cursor: scannerLoading ? "not-allowed" : "pointer",
              }}
            >
              {scannerLoading ? "Scanning..." : "Refresh Scanner"}
            </button>
          </div>

          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              padding: 11,
              borderRadius: 9,
              marginBottom: 14,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            These are technical setups calculated from recent market data.
            Confirm the live price before taking any real trade.
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 15,
            }}
          >
            {[
              ["ALL", "BUY + SELL"],
              ["BUY", "BUY only"],
              ["SELL", "SELL only"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setScannerFilter(value)}
                style={{
                  padding: "8px 13px",
                  borderRadius: 999,
                  border:
                    scannerFilter === value
                      ? "1px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background:
                    scannerFilter === value ? "#dbeafe" : "#ffffff",
                  color:
                    scannerFilter === value ? "#1d4ed8" : "#475569",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {scannerError && (
            <div
              style={{
                background: "#fee2e2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                padding: 12,
                borderRadius: 9,
                marginBottom: 14,
              }}
            >
              {scannerError}
            </div>
          )}

          {scannerLoading && scannerData.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              Scanning Indian stocks for intraday opportunities...
            </div>
          ) : filteredScannerData.length === 0 ? (
            <div
              style={{
                padding: 26,
                textAlign: "center",
                color: "#64748b",
                background: "#f8fafc",
                borderRadius: 10,
              }}
            >
              No confirmed {scannerFilter === "ALL" ? "BUY/SELL" : scannerFilter} setup right now.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 14,
              }}
            >
              {filteredScannerData.map((item) => {
                const isBuy = item.signal === "BUY";
                const entry =
                  item.entry_price ??
                  (isBuy ? item.entry_high : item.entry_low) ??
                  item.current_price ??
                  item.price;

                const target1 = item.target_1 ?? item.target1;
                const target2 = item.target_2 ?? item.target2;
                const currentPrice = item.current_price ?? item.price;

                const defaultExitRules = isBuy
                  ? [
                      "Book part at Target 1",
                      "Book remaining quantity at Target 2",
                      "Exit immediately if Stop Loss is hit",
                      "Exit early if the intraday signal reverses bearish",
                    ]
                  : [
                      "Book part at Target 1",
                      "Book remaining quantity at Target 2",
                      "Exit immediately if Stop Loss is hit",
                      "Exit early if the intraday signal reverses bullish",
                    ];

                const exitRules =
                  Array.isArray(item.exit_rules) && item.exit_rules.length > 0
                    ? item.exit_rules
                    : defaultExitRules;

                return (
                  <div
                    key={item.symbol}
                    style={{
                      border: `2px solid ${
                        isBuy ? "#bbf7d0" : "#fecaca"
                      }`,
                      borderRadius: 12,
                      padding: 16,
                      background: isBuy ? "#f0fdf4" : "#fef2f2",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 21,
                            fontWeight: 900,
                            color: "#0f172a",
                          }}
                        >
                          {item.symbol}
                        </div>
                        <div
                          style={{
                            marginTop: 2,
                            color: "#64748b",
                            fontSize: 12,
                          }}
                        >
                          {item.name || item.symbol}
                        </div>
                      </div>

                      <StatusBadge signal={item.signal} />
                    </div>

                    <div
                      style={{
                        marginBottom: 12,
                        padding: "9px 11px",
                        borderRadius: 9,
                        fontSize: 13,
                        fontWeight: 900,
                        background: isBuy ? "#dcfce7" : "#fee2e2",
                        color: isBuy ? "#166534" : "#991b1b",
                        border: `1px solid ${isBuy ? "#86efac" : "#fca5a5"}`,
                      }}
                    >
                      V8 {item.v8_rank || "QUALIFIED"} • {item.signal} •
                      {" "}Timeframe is context only — selection requires market alignment, 8+ quality and modeled profit capacity
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 9,
                      }}
                    >
                      <Indicator
                        label="Current Price"
                        value={formatMoney(currentPrice)}
                      />
                      <Indicator
                        label={isBuy ? "Buy / Entry" : "Sell / Entry"}
                        value={formatMoney(entry)}
                      />
                      <Indicator
                        label="Stop Loss"
                        value={formatMoney(item.stop_loss)}
                        negative={item.stop_loss != null}
                      />
                      <Indicator
                        label="Target 1"
                        value={formatMoney(target1)}
                        positive={target1 != null}
                      />
                      <Indicator
                        label="Target 2"
                        value={formatMoney(target2)}
                        positive={target2 != null}
                      />
                      <Indicator
                        label="Setup Quality"
                        value={
                          item.setup_quality != null
                            ? `${formatNumber(item.setup_quality, 1)} / 10`
                            : "—"
                        }
                        positive={item.qualified === true}
                      />
                      <Indicator
                        label="V8 Rank"
                        value={item.v8_rank || (item.qualified === true ? "QUALIFIED" : "WATCH")}
                        positive={item.v8_rank === "PRIMARY" || item.qualified === true}
                        negative={item.qualified !== true}
                      />
                      <Indicator
                        label="Modeled T1 Profit"
                        value={
                          item.modeled_t1_profit_rupees != null
                            ? formatMoney(item.modeled_t1_profit_rupees)
                            : "—"
                        }
                        positive={item.profit_capacity_ok === true}
                        negative={item.profit_capacity_ok === false}
                      />
                      <Indicator
                        label="V4 ML Shadow"
                        value={(() => {
                          const ml = item?.ml_v4_shadow || {};
                          if (item.signal === "SELL") return "RESEARCH ONLY";
                          if (item.signal !== "BUY") return "—";
                          if (ml.status !== "OK") return ml.status || "UNAVAILABLE";
                          const p = Number(ml.probability_pct);
                          const t = Number(ml.threshold_pct);
                          return `${ml.assessment} • ${Number.isFinite(p) ? p.toFixed(1) : "—"}% / ${Number.isFinite(t) ? t.toFixed(1) : "—"}%`;
                        })()}
                        positive={item?.ml_v4_shadow?.assessment === "PASS"}
                        negative={item?.ml_v4_shadow?.assessment === "FAIL"}
                      />
                      <Indicator
                        label="V9 BUY-only Review"
                        value={item?.v9_shadow?.assessment || "NOT AVAILABLE"}
                        positive={item?.v9_shadow?.assessment === "BUY_SHADOW_CANDIDATE"}
                        negative={item?.v9_shadow?.assessment === "SELL_RESEARCH_ONLY" || item?.v9_shadow?.assessment === "WATCH_NOT_EXECUTABLE"}
                      />
                      <Indicator
                        label="ML Mode"
                        value="SHADOW ONLY"
                      />
                      <Indicator
                        label="Suggested Qty"
                        value={
                          Number(item.suggested_quantity) > 0
                            ? formatNumber(item.suggested_quantity, 0)
                            : "—"
                        }
                      />
                      <Indicator
                        label="Est. Margin"
                        value={
                          Number(item.estimated_margin) > 0
                            ? formatMoney(item.estimated_margin)
                            : "—"
                        }
                        positive={item.margin_band_eligible === true}
                      />
                      <Indicator
                        label="Risk / Reward"
                        value={
                          item.risk_reward != null
                            ? `1 : ${formatNumber(item.risk_reward)}`
                            : "—"
                        }
                      />
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        padding: 11,
                        borderRadius: 9,
                        background: "rgba(255,255,255,0.75)",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 800,
                          fontSize: 13,
                          marginBottom: 6,
                        }}
                      >
                        When to exit
                      </div>

                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 19,
                          color: "#475569",
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        {exitRules.map((rule, index) => (
                          <li key={index}>{rule}</li>
                        ))}
                      </ul>
                    </div>

                    {Array.isArray(item.reasons) && item.reasons.length > 0 && (
                      <div
                        style={{
                          marginTop: 10,
                          color: "#475569",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Why:</strong> {item.reasons.slice(0, 3).join(" • ")}
                      </div>
                    )}

                    <button
                      onClick={() => openScannerStock(item.symbol)}
                      style={{
                        marginTop: 13,
                        width: "100%",
                        padding: "10px 12px",
                        border: "none",
                        borderRadius: 8,
                        background: isBuy ? "#16a34a" : "#dc2626",
                        color: "#ffffff",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Open Full Analysis
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

          </>
        )}

        {/* ==================================================
            ERROR
        ================================================== */}

        {error && (
          <div
            style={{
              background: "#fee2e2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              padding: 14,
              borderRadius: 10,
              marginBottom: 18,
            }}
          >
            {error}
          </div>
        )}

        {/* ==================================================
            LOADING
        ================================================== */}

        {loading && (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              background: "#ffffff",
              borderRadius: 12,
              marginBottom: 18,
            }}
          >
            Loading stock data...
          </div>
        )}

        {/* ==================================================
            SELECTED STOCK
        ================================================== */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 25,
              }}
            >
              {symbol}
            </h2>

            {quote?.name && (
              <div
                style={{
                  color: "#64748b",
                  marginTop: 4,
                }}
              >
                {quote.name}
              </div>
            )}
          </div>

          <StatusBadge
            signal={
              analysisCategory === "INTRADAY"
                ? intraday?.signal
                : technicalSignal
            }
          />
        </div>

        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background:
              analysisCategory === "INTRADAY"
                ? "#f5f3ff"
                : "#eff6ff",
            border:
              analysisCategory === "INTRADAY"
                ? "1px solid #ddd6fe"
                : "1px solid #bfdbfe",
            color:
              analysisCategory === "INTRADAY"
                ? "#6d28d9"
                : "#1d4ed8",
            fontWeight: 800,
          }}
        >
          {analysisCategory === "INTRADAY"
            ? `Intraday analysis for ${symbol}`
            : `Normal technical analysis for ${symbol}`}
        </div>

        {/* ==================================================
            QUOTE CARDS
        ================================================== */}

        {quote && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                LTP
              </div>

              <div
                style={{
                  fontSize: 25,
                  fontWeight: 800,
                  marginTop: 5,
                }}
              >
                {formatMoney(quote.price ?? quote.ltp)}
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Change
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  marginTop: 5,
                  color:
                    Number(quote.change) >= 0
                      ? "#16a34a"
                      : "#dc2626",
                }}
              >
                {formatNumber(quote.change)} (
                {formatPercent(quote.change_percent ?? quote.changePct)})
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Open
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 5,
                }}
              >
                {formatMoney(quote.open)}
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                High
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#16a34a",
                  marginTop: 5,
                }}
              >
                {formatMoney(quote.high)}
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Low
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#dc2626",
                  marginTop: 5,
                }}
              >
                {formatMoney(quote.low)}
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Previous Close
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 5,
                }}
              >
                {formatMoney(quote.previous_close)}
              </div>
            </Card>

            <Card>
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Volume
              </div>

              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 5,
                }}
              >
                {formatNumber(quote.volume, 0)}
              </div>
            </Card>
          </div>
        )}

        {analysisCategory === "NORMAL" && (
          <>
        {/* ==================================================
            DAILY CHART
        ================================================== */}

        <Card
          title={`Daily Price Chart — ${symbol}`}
          style={{ marginBottom: 18 }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            {["1mo", "3mo", "6mo", "1y", "2y"].map((item) => (
              <button
                key={item}
                onClick={() => setPeriod(item)}
                style={{
                  padding: "8px 13px",
                  borderRadius: 8,
                  border:
                    period === item
                      ? "1px solid #2563eb"
                      : "1px solid #cbd5e1",
                  background:
                    period === item ? "#dbeafe" : "#ffffff",
                  color:
                    period === item ? "#1d4ed8" : "#475569",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {item}
              </button>
            ))}
          </div>

          {chartData.length > 0 ? (
            <StockChart data={chartData} />
          ) : (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No daily chart data available.
            </div>
          )}
        </Card>

        {/* ==================================================
            DAILY TECHNICAL ANALYSIS
        ================================================== */}

        {analysis && (
          <Card
            title="Technical Analysis"
            style={{ marginBottom: 18 }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(170px, 1fr))",
                gap: 12,
              }}
            >
              <Indicator
                label="SMA 20"
                value={formatMoney(analysis.sma20)}
                positive={
                  quote?.price !== undefined &&
                  Number(quote.price) > Number(analysis.sma20)
                }
                negative={
                  quote?.price !== undefined &&
                  Number(quote.price) < Number(analysis.sma20)
                }
              />

              <Indicator
                label="SMA 50"
                value={formatMoney(analysis.sma50)}
                positive={
                  quote?.price !== undefined &&
                  Number(quote.price) > Number(analysis.sma50)
                }
                negative={
                  quote?.price !== undefined &&
                  Number(quote.price) < Number(analysis.sma50)
                }
              />

              <Indicator
                label="EMA 20"
                value={formatMoney(analysis.ema20)}
              />

              <Indicator
                label="RSI 14"
                value={formatNumber(analysis.rsi14)}
                positive={Number(analysis.rsi14) >= 50}
                negative={Number(analysis.rsi14) < 50}
              />

              <Indicator
                label="MACD"
                value={formatNumber(analysis.macd)}
                positive={Number(analysis.macd) > 0}
                negative={Number(analysis.macd) < 0}
              />

              <Indicator
                label="MACD Signal"
                value={formatNumber(analysis.macd_signal)}
              />

              <Indicator
                label="Bollinger Upper"
                value={formatMoney(analysis.bb_upper)}
              />

              <Indicator
                label="Bollinger Lower"
                value={formatMoney(analysis.bb_lower)}
              />
            </div>
          </Card>
        )}

        {/* ==================================================
            DAILY SIGNAL
        ================================================== */}

        {analysis && (
          <Card
            title="Technical Signal"
            style={{ marginBottom: 18 }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 15,
                flexWrap: "wrap",
                marginBottom: 15,
              }}
            >
              <StatusBadge signal={technicalSignal} />

              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#64748b",
                  }}
                >
                  Signal Score
                </div>

                <div
                  style={{
                    fontSize: 21,
                    fontWeight: 800,
                  }}
                >
                  {signalScore}
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#64748b",
                  }}
                >
                  Sentiment
                </div>

                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  {sentiment}
                </div>
              </div>
            </div>

            {analysis.reasons &&
              Array.isArray(analysis.reasons) &&
              analysis.reasons.length > 0 && (
                <div>
                  <strong>Reasons</strong>

                  <ul
                    style={{
                      marginTop: 8,
                      color: "#475569",
                      lineHeight: 1.7,
                    }}
                  >
                    {analysis.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
          </Card>
        )}

          </>
        )}

        {analysisCategory === "INTRADAY" && (
          <>
        {/* ==================================================
            INTRADAY SECTION
        ================================================== */}


        {analysisCategory === "INTRADAY" && (
          <div
            style={{
              marginBottom: 12,
              padding: "12px 14px",
              border: strategyMode === "INVERSE"
                ? "1px solid #f59e0b"
                : "1px solid #16a34a",
              borderRadius: 10,
              background: strategyMode === "INVERSE" ? "#fffbeb" : "#f0fdf4",
              color: strategyMode === "INVERSE" ? "#92400e" : "#166534",
              fontWeight: 700,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <strong>
                {strategyMode === "INVERSE"
                  ? "INVERSE PAPER TEST ACTIVE"
                  : "NORMAL STRATEGY ACTIVE"}
              </strong>
              {" — "}
              {strategyMode === "INVERSE"
                ? "qualified BUY/SELL directions are inverted for the paper-test."
                : "qualified BUY/SELL directions are shown normally."}
              {" "}New entries stop at 14:30 IST.
            </div>

            <button
              type="button"
              onClick={switchStrategyMode}
              disabled={strategyModeLoading}
              style={{
                border: "1px solid currentColor",
                background: "#ffffff",
                color: "inherit",
                borderRadius: 8,
                padding: "8px 12px",
                fontWeight: 900,
                cursor: strategyModeLoading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {strategyModeLoading
                ? "Switching..."
                : strategyMode === "INVERSE"
                  ? "Switch to Normal"
                  : "Switch to Inverse"}
            </button>
          </div>
        )}

        {/* Always-on 5m + 15m scanner */}
        {analysisCategory === "INTRADAY" && (
          <Card title="5m + 15m Multi-Timeframe Suggestions">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div style={{ color: "#64748b", fontSize: 13 }}>
                Both timeframes are analyzed independently regardless of the
                selected chart profile. Current mode: {strategyMode}.
                {strategyMode === "INVERSE"
                  ? " The inverse paper-test direction is displayed after the original setup passes qualification."
                  : " Qualified directions are displayed normally."}
                {multiTimeframeUpdatedAt
                  ? ` Updated: ${formatTradeTimestampIST(multiTimeframeUpdatedAt)}`
                  : ""}
                <div style={{ marginTop: 5, fontWeight: 700 }}>
                  Market: {multiTimeframeMeta?.market_status || "—"} • Session:{" "}
                  {multiTimeframeMeta?.session_phase || "—"} • Rows:{" "}
                  {multiTimeframeMeta?.count ?? multiTimeframeData.length} • Executable:{" "}
                  {multiTimeframeMeta?.executable_count ?? 0} • Watch:{" "}
                  {multiTimeframeMeta?.watch_count ?? 0}
                </div>
                {multiTimeframeMeta?.phase_message ? (
                  <div style={{ marginTop: 4 }}>
                    {multiTimeframeMeta.phase_message}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={async () => {
                try {
                  await fetchJson(
                    `${BACKEND}/api/intraday/scanner-multitimeframe/refresh-background`,
                    { method: "POST" }
                  );
                } catch (err) {
                  console.error("Background scanner refresh error:", err);
                }
                setTimeout(() => loadMultiTimeframeScanner(false), 700);
              }}
                disabled={multiTimeframeLoading}
                style={{
                  border: "1px solid #2563eb",
                  background: multiTimeframeLoading ? "#94a3b8" : "#2563eb",
                  color: "#ffffff",
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontWeight: 900,
                  cursor: multiTimeframeLoading ? "not-allowed" : "pointer",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
                  opacity: 1,
                }}
              >
                {multiTimeframeLoading ? "Scanning..." : "Refresh 5m + 15m"}
              </button>
            </div>

            {multiTimeframeError ? (
              <div
                style={{
                  background: "#fee2e2",
                  color: "#991b1b",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                {multiTimeframeError}
              </div>
            ) : multiTimeframeData.length === 0 ? (
              <div style={{ color: "#64748b" }}>
                {multiTimeframeMeta?.session_phase === "STARTING"
                  ? "Background scanner is preparing the first snapshot. This page updates automatically."
                  : multiTimeframeLoading
                    ? "Reading latest scanner results..."
                    : "No 5m/15m rows are available yet. Background scanning continues automatically."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 900,
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                      {[
                        "Stock",
                        "5m",
                        "5m Status",
                        "15m",
                        "15m Status",
                        "Alignment",
                        "Final",
                        "Setup Quality",
                        "Suggested Action",
                        "Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            color: "#475569",
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {alignedMultiTimeframeData.map((row) => (
                      <tr key={row.symbol}>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            fontWeight: 900,
                          }}
                        >
                          {row.symbol}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #e2e8f0" }}>
                          <StatusBadge signal={row.signal_5m} />
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #e2e8f0" }}>
                          {row.status_5m || "OBSERVE"}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #e2e8f0" }}>
                          <StatusBadge signal={row.signal_15m} />
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #e2e8f0" }}>
                          {row.status_15m || "OBSERVE"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            fontWeight: 800,
                          }}
                        >
                          {row.alignment || "NONE"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            fontWeight: 900,
                          }}
                        >
                          {row.final_status || "OBSERVE"}
                          <div
                            style={{
                              marginTop: 4,
                              fontWeight: 400,
                              color: "#64748b",
                              maxWidth: 260,
                            }}
                          >
                            {row.combined_reason || ""}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            fontWeight: 900,
                            whiteSpace: "nowrap",
                          }}
                          title={`5m: ${
                            row.analysis_5m?.setup_quality != null
                              ? Number(row.analysis_5m.setup_quality).toFixed(1)
                              : "—"
                          }/10 • 15m: ${
                            row.analysis_15m?.setup_quality != null
                              ? Number(row.analysis_15m.setup_quality).toFixed(1)
                              : "—"
                          }/10`}
                        >
                          {row.analysis_5m?.setup_quality != null &&
                          row.analysis_15m?.setup_quality != null
                            ? `${Math.min(
                                Number(row.analysis_5m.setup_quality),
                                Number(row.analysis_15m.setup_quality)
                              ).toFixed(1)} / 10`
                            : row.analysis_5m?.setup_quality != null
                              ? `${Number(row.analysis_5m.setup_quality).toFixed(1)} / 10`
                              : row.analysis_15m?.setup_quality != null
                                ? `${Number(row.analysis_15m.setup_quality).toFixed(1)} / 10`
                                : "—"}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #e2e8f0",
                            fontWeight: 900,
                            color:
                              row.suggested_action === "BUY"
                                ? "#16a34a"
                                : row.suggested_action === "SELL"
                                  ? "#dc2626"
                                  : "#64748b",
                          }}
                        >
                          {row.suggested_action || row.final_bias || "NO TRADE"}
                          <div
                            style={{
                              fontSize: 11,
                              marginTop: 3,
                              color: row.combined_executable ? "#15803d" : "#64748b",
                            }}
                          >
                            {row.combined_executable ? "EXECUTABLE" : "OBSERVE ONLY"}
                          </div>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #e2e8f0" }}>
                          <button
                            type="button"
                            onClick={() => openScannerStock(row.symbol)}
                            style={{
                              border: "1px solid #2563eb",
                              background: "#2563eb",
                              color: "#ffffff",
                              borderRadius: 7,
                              padding: "8px 12px",
                              fontWeight: 900,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Send to Intraday
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        <div id="intraday-full-analysis">
        <Card
          title="Intraday Buy / Sell Analyzer"
          style={{
            marginBottom: 18,
            border: "2px solid #cbd5e1",
          }}
        >
          {/* Selected stock currently being analyzed */}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: "12px 14px",
              marginBottom: 14,
              border: "1px solid #ddd6fe",
              borderRadius: 9,
              background: "#f5f3ff",
            }}
          >
            <div>
              <div
                style={{
                  color: "#6b7280",
                  fontSize: 12,
                  marginBottom: 3,
                }}
              >
                Stock selected for Intraday Analyzer
                <span
                  style={{
                    marginLeft: 8,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: strategyMode === "INVERSE" ? "#fef3c7" : "#dcfce7",
                    color: strategyMode === "INVERSE" ? "#92400e" : "#166534",
                    fontWeight: 900,
                  }}
                >
                  {strategyMode}
                </span>
              </div>

              <div
                style={{
                  color: "#5b21b6",
                  fontSize: 20,
                  fontWeight: 900,
                }}
              >
                {symbol}
              </div>
            </div>

            <div
              style={{
                color: "#6d28d9",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {intradayLoading
                ? "Updating analysis..."
                : "Visible in Intraday Buy / Sell Analyzer"}
            </div>
          </div>

          {/* Intraday controls */}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 16,
            }}
          >
            <button
              onClick={() => loadIntraday(symbol)}
              disabled={intradayLoading}
              style={{
                padding: "10px 16px",
                borderRadius: 9,
                border: "none",
                background: intradayLoading
                  ? "#94a3b8"
                  : "#7c3aed",
                color: "#ffffff",
                fontWeight: 700,
                cursor: intradayLoading
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {intradayLoading
                ? "Analyzing..."
                : "Refresh Intraday"}
            </button>
          </div>

          {/* Intraday disclaimer */}

          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              padding: 12,
              borderRadius: 9,
              marginBottom: 16,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong>Important:</strong> This is an algorithmic
            educational signal based on technical indicators. It
            is not a guaranteed prediction or financial advice.
            Verify the live market price and volume before making
            any trading decision.
          </div>

          {intradayError && (
            <div
              style={{
                background: "#fee2e2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                padding: 13,
                borderRadius: 9,
                marginBottom: 15,
              }}
            >
              {intradayError}
            </div>
          )}

          {intraday && (
            <>
              {/* ============================================
                  SIGNAL HEADER
              ============================================ */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: signalBackground(
                      intraday.signal
                    ),
                    border: `2px solid ${signalColor(
                      intraday.signal
                    )}55`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      color: "#64748b",
                      marginBottom: 7,
                    }}
                  >
                    Intraday Signal
                  </div>

                  <div
                    style={{
                      fontSize: 31,
                      fontWeight: 900,
                      color: signalColor(
                        intraday.signal
                      ),
                    }}
                  >
                    {intraday.signal || "WAIT"}
                  </div>

                  {intraday.strategy && (
                    <div
                      style={{
                        marginTop: 6,
                        color: "#475569",
                        fontSize: 13,
                      }}
                    >
                      Strategy: {intraday.strategy}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 13 }}>
                    Setup Quality
                  </div>
                  <div
                    style={{
                      fontSize: 27,
                      fontWeight: 800,
                      marginTop: 5,
                      color: intraday.qualified === true ? "#16a34a" : "#475569",
                    }}
                  >
                    {intraday.setup_quality !== null &&
                    intraday.setup_quality !== undefined
                      ? `${formatNumber(intraday.setup_quality, 1)} / 10`
                      : "Analysis only"}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      color: intraday.qualified === true ? "#16a34a" : "#64748b",
                    }}
                  >
                    {intraday.qualified === true
                      ? "V8 QUALIFIED"
                      : "Qualification is determined by the Opportunity Scanner"}
                  </div>
                </div>

                <div
                    style={{
                      color: "#64748b",
                      fontSize: 13,
                    }}
                  >
                    Market Status
                  </div>

                  <div
                    style={{
                      fontSize: 19,
                      fontWeight: 800,
                      marginTop: 7,
                    }}
                  >
                    {scannerSessionPhase && scannerSessionPhase !== "—"
                      ? String(scannerSessionPhase).replaceAll("_", " ")
                      : intraday.market_status || scannerMarketStatus || "—"}
                  </div>

                  {scannerPhaseMessage ? (
                    <div
                      style={{
                        marginTop: 6,
                        color: "#64748b",
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      {scannerPhaseMessage}
                    </div>
                  ) : null}
                </div>

                <div
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: 13,
                    }}
                  >
                    Current Price
                  </div>

                  <div
                    style={{
                      fontSize: 23,
                      fontWeight: 800,
                      marginTop: 5,
                    }}
                  >
                    {formatMoney(intraday.current_price)}
                  </div>
                </div>
              </div>

              {/* ============================================
                  TRADE LEVELS
              ============================================ */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <Indicator
                  label="Entry Price"
                  value={formatMoney(
                    intraday.entry_price
                  )}
                />

                <Indicator
                  label="Stop Loss"
                  value={formatMoney(
                    intraday.stop_loss
                  )}
                  negative={intraday.stop_loss != null}
                />

                <Indicator
                  label="Target 1"
                  value={formatMoney(
                    intraday.target_1
                  )}
                  positive={intraday.target_1 != null}
                />

                <Indicator
                  label="Target 2"
                  value={formatMoney(
                    intraday.target_2
                  )}
                  positive={intraday.target_2 != null}
                />

                <Indicator
                  label="Risk / Reward"
                  value={
                    intraday.risk_reward
                      ? `1 : ${formatNumber(
                          intraday.risk_reward
                        )}`
                      : "—"
                  }
                />

                <Indicator
                  label="Suggested Qty"
                  value={
                    intraday.suggested_quantity
                      ? formatNumber(
                          intraday.suggested_quantity,
                          0
                        )
                      : "—"
                  }
                />

                <Indicator
                  label="Est. Margin"
                  value={
                    Number(intraday.estimated_margin) > 0
                      ? formatMoney(intraday.estimated_margin)
                      : "—"
                  }
                  positive={intraday.margin_band_eligible === true}
                />
              </div>

              {/* ============================================
                  USE SIGNAL BUTTON
              ============================================ */}

              {(intraday.signal === "BUY" ||
                intraday.signal === "SELL") && (
                <div
                  style={{
                    marginBottom: 17,
                    padding: 14,
                    borderRadius: 10,
                    background:
                      intraday.signal === "BUY"
                        ? "#f0fdf4"
                        : "#fef2f2",
                    border:
                      intraday.signal === "BUY"
                        ? "1px solid #bbf7d0"
                        : "1px solid #fecaca",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <strong>
                        {intraday.signal} signal detected
                      </strong>

                      <div
                        style={{
                          color: "#64748b",
                          fontSize: 13,
                          marginTop: 3,
                        }}
                      >
                        You can load this signal into
                        paper trading for review.
                      </div>
                    </div>

                    <button
                      onClick={useIntradaySignal}
                      style={{
                        padding: "10px 16px",
                        border: "none",
                        borderRadius: 8,
                        background:
                          intraday.signal === "BUY"
                            ? "#16a34a"
                            : "#dc2626",
                        color: "#ffffff",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Send to Intraday
                    </button>
                  </div>
                </div>
              )}

              {/* ============================================
                  INTRADAY INDICATORS
              ============================================ */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(165px, 1fr))",
                  gap: 12,
                  marginBottom: 17,
                }}
              >
                <Indicator
                  label="EMA 9"
                  value={formatMoney(
                    intraday.ema9
                  )}
                  positive={
                    Number(intraday.current_price) >
                    Number(intraday.ema9)
                  }
                />

                <Indicator
                  label="EMA 20"
                  value={formatMoney(
                    intraday.ema20
                  )}
                />

                <Indicator
                  label="VWAP"
                  value={formatMoney(
                    intraday.vwap
                  )}
                  positive={
                    Number(intraday.current_price) >
                    Number(intraday.vwap)
                  }
                  negative={
                    Number(intraday.current_price) <
                    Number(intraday.vwap)
                  }
                />

                <Indicator
                  label="RSI 14"
                  value={formatNumber(
                    intraday.rsi14
                  )}
                  positive={
                    Number(intraday.rsi14) >= 50
                  }
                  negative={
                    Number(intraday.rsi14) < 50
                  }
                />

                <Indicator
                  label="MACD"
                  value={formatNumber(
                    intraday.macd
                  )}
                  positive={
                    Number(intraday.macd) >
                    Number(intraday.macd_signal)
                  }
                  negative={
                    Number(intraday.macd) <
                    Number(intraday.macd_signal)
                  }
                />

                <Indicator
                  label="MACD Signal"
                  value={formatNumber(
                    intraday.macd_signal
                  )}
                />

                <Indicator
                  label="ATR 14"
                  value={formatMoney(
                    intraday.atr14
                  )}
                />

                <Indicator
                  label="Volume Ratio"
                  value={
                    intraday.volume_ratio !==
                      null &&
                    intraday.volume_ratio !==
                      undefined
                      ? `${formatNumber(
                          intraday.volume_ratio,
                          2
                        )}x`
                      : "—"
                  }
                  positive={
                    Number(
                      intraday.volume_ratio
                    ) >= 1.2
                  }
                />
              </div>

              {/* ============================================
                  OPENING RANGE
              ============================================ */}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginBottom: 17,
                }}
              >
                <Indicator
                  label="Opening Range High"
                  value={formatMoney(
                    intraday.opening_range_high
                  )}
                />

                <Indicator
                  label="Opening Range Low"
                  value={formatMoney(
                    intraday.opening_range_low
                  )}
                />
              </div>

              {/* ============================================
                  REASONS
              ============================================ */}

              {intraday.reasons &&
                Array.isArray(intraday.reasons) &&
                intraday.reasons.length > 0 && (
                  <div
                    style={{
                      padding: 15,
                      background: "#f8fafc",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      marginBottom: 18,
                    }}
                  >
                    <strong>
                      Why the system generated this signal
                    </strong>

                    <ul
                      style={{
                        marginTop: 9,
                        marginBottom: 0,
                        color: "#475569",
                        lineHeight: 1.7,
                      }}
                    >
                      {intraday.reasons.map(
                        (reason, index) => (
                          <li key={index}>
                            {reason}
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}

              {/* ============================================
                  INTRADAY CHART
              ============================================ */}

              <div
                style={{
                  marginTop: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      fontSize: 16,
                    }}
                  >
                    Intraday Chart
                  </h4>

                  <div
                    style={{
                      display: "flex",
                      gap: 7,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <select
                      value={intradayInterval}
                      onChange={(event) => {
                        const value = event.target.value;
                        setIntradayInterval(value);
                        loadIntraday(symbol, intradayChartPeriod, value);
                      }}
                      title="Candle interval"
                      style={{
                        padding: "8px 34px 8px 11px",
                        borderRadius: 7,
                        border: "1px solid #7c3aed",
                        background: "#ffffff",
                        color: "#6d28d9",
                        fontWeight: 800,
                        cursor: "pointer",
                        outline: "none",
                      }}
                    >
                      <option value="5m">5 Min</option>
                      <option value="30m">30 Min</option>
                    </select>

                    <select
                      value={intradayChartPeriod}
                      onChange={(event) => {
                        const value = event.target.value;
                        setIntradayChartPeriod(value);
                        loadIntraday(symbol, value);
                      }}
                      title="Chart period"
                      style={{
                        padding: "8px 34px 8px 11px",
                        borderRadius: 7,
                        border: "1px solid #2563eb",
                        background: "#ffffff",
                        color: "#1d4ed8",
                        fontWeight: 800,
                        cursor: "pointer",
                        outline: "none",
                      }}
                    >
                      <option value="1d">1 Day</option>
                      <option value="2d">2 Days</option>
                      <option value="5d">5 Days</option>
                      <option value="1wk">1 Week</option>
                      <option value="1mo">1 Month</option>
                    </select>

                    <div
                      style={{
                        width: 1,
                        height: 28,
                        background: "#cbd5e1",
                        margin: "0 2px",
                      }}
                    />

                    {[
                      ["CANDLE", "Candles"],
                      ["LINE", "Line"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setIntradayChartType(value)}
                        style={{
                          padding: "7px 11px",
                          borderRadius: 7,
                          border:
                            intradayChartType === value
                              ? "1px solid #7c3aed"
                              : "1px solid #cbd5e1",
                          background:
                            intradayChartType === value
                              ? "#ede9fe"
                              : "#ffffff",
                          color:
                            intradayChartType === value
                              ? "#6d28d9"
                              : "#475569",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {intradayData.length > 0 ? (
                  <IntradayChart
                    data={intradayData}
                    chartType={intradayChartType}
                    symbol={symbol}
                    interval={intradayInterval}
                    analysis={intraday}
                    positions={dayTradePositions}
                    trades={dayTradeTrades}
                    live={String(intraday?.market_status || scannerMarketStatus).toUpperCase() === "OPEN"}
                  />
                ) : (
                  <div
                    style={{
                      padding: 35,
                      textAlign: "center",
                      color: "#64748b",
                      background: "#f8fafc",
                      borderRadius: 10,
                    }}
                  >
                    No intraday chart data available.
                  </div>
                )}
              </div>

              {/* Last update */}

              {intraday.last_update && (
                <div
                  style={{
                    marginTop: 12,
                    color: "#64748b",
                    fontSize: 12,
                    textAlign: "right",
                  }}
                >
                  Last update: {intraday.last_update}
                </div>
              )}
            </>
          )}

          {!intraday && !intradayLoading && !intradayError && (
            <div
              style={{
                padding: 30,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              Click <strong>Refresh Intraday</strong> to
              generate the intraday signal.
            </div>
          )}
        </Card>
        </div>

          </>
        )}

        {analysisCategory === "NORMAL" && (
          <>
        {/* ==================================================
            PAPER TRADING
        ================================================== */}

        <Card
          title="Paper Trading"
          style={{ marginBottom: 18 }}
        >

          {/* Search stock for Normal Paper Trading */}

          <div
            style={{
              padding: 14,
              border: "1px solid #bfdbfe",
              borderRadius: 10,
              background: "#eff6ff",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#0f172a",
                marginBottom: 9,
              }}
            >
              Search Stock for Normal Paper Trading
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  flex: "1 1 320px",
                  minWidth: 240,
                }}
              >
                <input
                  type="text"
                  value={paperStockSearch}
                  onChange={(e) => {
                    setPaperStockSearch(e.target.value);
                    setPaperSearchSelected("");
                    setPaperSendMessage("");
                  }}
                  placeholder="Search stock symbol or company name..."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid #93c5fd",
                    background: "#ffffff",
                    color: "#111827",
                    fontSize: 14,
                  }}
                />

                {paperStockSearch.trim() && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 5px)",
                      left: 0,
                      right: 0,
                      zIndex: 40,
                      maxHeight: 250,
                      overflowY: "auto",
                      border: "1px solid #cbd5e1",
                      borderRadius: 8,
                      background: "#ffffff",
                      boxShadow:
                        "0 10px 30px rgba(15,23,42,0.15)",
                    }}
                  >
                    {filteredPaperStocks.length === 0 ? (
                      <div
                        style={{
                          padding: 12,
                          color: "#64748b",
                        }}
                      >
                        No matching stock found.
                      </div>
                    ) : (
                      filteredPaperStocks
                        .slice(0, 20)
                        .map(([stockSymbol, stockName]) => (
                          <button
                            key={`normal-search-${stockSymbol}`}
                            type="button"
                            onClick={() =>
                              selectPaperSearchStock(stockSymbol)
                            }
                            style={{
                              width: "100%",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "10px 12px",
                              border: "none",
                              borderBottom:
                                "1px solid #f1f5f9",
                              background:
                                paperSearchSelected === stockSymbol
                                  ? "#dbeafe"
                                  : "#ffffff",
                              color: "#111827",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <strong>{stockSymbol}</strong>

                            <span
                              style={{
                                color: "#64748b",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {stockName}
                            </span>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => sendSearchedStock("NORMAL")}
                style={{
                  padding: "11px 15px",
                  border: "1px solid #2563eb",
                  borderRadius: 8,
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 800,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Send to Normal
              </button>
            </div>

            <div
              style={{
                marginTop: 9,
                color: "#64748b",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Search and select a stock, then send it directly to
              Normal Stock Analysis and Normal Paper Trading.
            </div>

            {paperSendMessage && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 7,
                  background: "#ecfeff",
                  border: "1px solid #a5f3fc",
                  color: "#155e75",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {paperSendMessage}
              </div>
            )}
          </div>
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                color: "#64748b",
                fontSize: 13,
              }}
            >
              Paper Trading Capital
            </div>

            <div
              style={{
                fontSize: 28,
                fontWeight: 900,
                color: "#1d4ed8",
                marginTop: 4,
              }}
            >
              {formatMoney(
                paperAccount?.cash ??
                  paperAccount?.balance ??
                  100000
              )}
            </div>
          </div>

          {/* Order controls */}

          <div
            style={{
              marginBottom: 14,
            }}
          >
            <label
              style={{
                display: "block",
                color: "#64748b",
                fontSize: 13,
                marginBottom: 7,
              }}
            >
              Symbol
            </label>

            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                overflowY: "hidden",
                whiteSpace: "nowrap",
                padding: "4px 2px 10px",
                scrollbarWidth: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {PAPER_STOCK_OPTIONS.map(([stockSymbol, stockName]) => {
                const selected = paperSymbol === stockSymbol;

                return (
                  <button
                    key={stockSymbol}
                    type="button"
                    onClick={() => setPaperSymbol(stockSymbol)}
                    title={stockName}
                    style={{
                      flex: "0 0 auto",
                      minWidth: 118,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: selected
                        ? "2px solid #2563eb"
                        : "1px solid #cbd5e1",
                      background: selected ? "#dbeafe" : "#ffffff",
                      color: selected ? "#1d4ed8" : "#111827",
                      fontWeight: selected ? 800 : 700,
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    {stockSymbol}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                color: "#64748b",
              }}
            >
              Scroll from left to right to view all stocks. Selected stock:{" "}
              <strong style={{ color: "#111827" }}>{paperSymbol}</strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "nowrap",
              gap: 12,
              alignItems: "end",
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
            <div style={{ flex: "0 0 190px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Selected Stock
              </label>

              <div
                style={{
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#111827",
                  fontWeight: 800,
                  minHeight: 43,
                  boxSizing: "border-box",
                }}
              >
                {paperSymbol}
              </div>
            </div>

            <div style={{ flex: "0 0 190px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Live Price
              </label>

              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  minHeight: 43,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap",
                }}
              >
                <strong
                  style={{
                    color: "#111827",
                    fontSize: 16,
                  }}
                >
                  {paperPriceLoading && !paperQuote
                    ? "Loading..."
                    : paperQuote?.price !== undefined &&
                      paperQuote?.price !== null
                    ? formatMoney(paperQuote.price)
                    : paperQuote?.ltp !== undefined &&
                      paperQuote?.ltp !== null
                    ? formatMoney(paperQuote.ltp)
                    : "—"}
                </strong>

                {paperQuote?.change_percent !== undefined &&
                  paperQuote?.change_percent !== null && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color:
                          Number(paperQuote.change_percent) >= 0
                            ? "#16a34a"
                            : "#dc2626",
                      }}
                    >
                      {Number(paperQuote.change_percent) >= 0 ? "+" : ""}
                      {Number(paperQuote.change_percent).toFixed(2)}%
                    </span>
                  )}
              </div>

              <div
                style={{
                  marginTop: 4,
                  minHeight: 16,
                  fontSize: 11,
                  color: paperPriceError ? "#dc2626" : "#64748b",
                }}
              >
                {paperPriceError
                  ? "Price unavailable"
                  : paperPriceLoading
                  ? "Refreshing..."
                  : "Auto refreshes every 15 seconds"}
              </div>
            </div>

            <div style={{ flex: "0 0 190px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Side
              </label>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => setOrderSide("BUY")}
                  style={{
                    flex: 1,
                    padding: "11px 14px",
                    borderRadius: 8,
                    border:
                      orderSide === "BUY"
                        ? "2px solid #15803d"
                        : "1px solid #86efac",
                    background:
                      orderSide === "BUY"
                        ? "#16a34a"
                        : "#dcfce7",
                    color:
                      orderSide === "BUY"
                        ? "#ffffff"
                        : "#166534",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  BUY
                </button>

                <button
                  type="button"
                  onClick={() => setOrderSide("SELL")}
                  style={{
                    flex: 1,
                    padding: "11px 14px",
                    borderRadius: 8,
                    border:
                      orderSide === "SELL"
                        ? "2px solid #b91c1c"
                        : "1px solid #fecaca",
                    background:
                      orderSide === "SELL"
                        ? "#dc2626"
                        : "#fee2e2",
                    color:
                      orderSide === "SELL"
                        ? "#ffffff"
                        : "#991b1b",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  SELL
                </button>
              </div>
            </div>

            <div style={{ flex: "0 0 150px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Quantity
              </label>

              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) =>
                  setQuantity(e.target.value)
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#111827",
                }}
              />
            </div>

            <div style={{ flex: "0 0 190px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Order Type
              </label>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setPaperOrderType("MARKET")}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border:
                      paperOrderType === "MARKET"
                        ? "2px solid #2563eb"
                        : "1px solid #cbd5e1",
                    background:
                      paperOrderType === "MARKET"
                        ? "#2563eb"
                        : "#ffffff",
                    color:
                      paperOrderType === "MARKET"
                        ? "#ffffff"
                        : "#334155",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Market
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPaperOrderType("LIMIT");
                    if (!paperOrderPrice && paperQuote?.price) {
                      setPaperOrderPrice(String(paperQuote.price));
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border:
                      paperOrderType === "LIMIT"
                        ? "2px solid #7c3aed"
                        : "1px solid #cbd5e1",
                    background:
                      paperOrderType === "LIMIT"
                        ? "#7c3aed"
                        : "#ffffff",
                    color:
                      paperOrderType === "LIMIT"
                        ? "#ffffff"
                        : "#334155",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Wait at Price
                </button>
              </div>
            </div>

            <div style={{ flex: "0 0 155px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Buy / Sell Price
              </label>

              <input
                type="number"
                min="0"
                step="0.05"
                value={paperOrderPrice}
                onChange={(e) => setPaperOrderPrice(e.target.value)}
                disabled={paperOrderType !== "LIMIT"}
                placeholder={
                  paperOrderType === "LIMIT"
                    ? "₹ wait for this price"
                    : "Market price"
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  borderRadius: 8,
                  border:
                    paperOrderType === "LIMIT"
                      ? "1px solid #c4b5fd"
                      : "1px solid #e2e8f0",
                  background:
                    paperOrderType === "LIMIT"
                      ? "#ffffff"
                      : "#f8fafc",
                  color: "#111827",
                }}
              />
            </div>

            <div style={{ flex: "0 0 150px" }}>
              <label
                style={{
                  display: "block",
                  color: "#64748b",
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Stop Loss
              </label>

              <input
                type="number"
                min="0"
                step="0.05"
                value={paperStopLoss}
                onChange={(e) => setPaperStopLoss(e.target.value)}
                placeholder="₹ price"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  borderRadius: 8,
                  border: "1px solid #fca5a5",
                  background: "#fff",
                  color: "#111827",
                }}
              />
            </div>

            <button
              onClick={placeOrder}
              style={{
                flex: "0 0 150px",
                padding: "12px 15px",
                border: "none",
                borderRadius: 8,
                background:
                  orderSide === "BUY"
                    ? "#16a34a"
                    : "#dc2626",
                color: "#ffffff",
                fontWeight: 800,
                cursor: "pointer",
                minHeight: 43,
              }}
            >
              Place {orderSide}
            </button>

            <button
              type="button"
              onClick={() => loadPaperQuote(paperSymbol, true)}
              disabled={paperPriceLoading}
              style={{
                flex: "0 0 135px",
                padding: "12px 15px",
                border: "1px solid #93c5fd",
                borderRadius: 8,
                background: "#eff6ff",
                color: "#1d4ed8",
                fontWeight: 800,
                cursor: paperPriceLoading ? "wait" : "pointer",
                minHeight: 43,
                opacity: paperPriceLoading ? 0.7 : 1,
              }}
            >
              {paperPriceLoading ? "Refreshing..." : "Refresh Price"}
            </button>

            <button
              onClick={resetPaperAccount}
              style={{
                flex: "0 0 150px",
                padding: "12px 15px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                background: "#ffffff",
                color: "#334155",
                fontWeight: 700,
                cursor: "pointer",
                minHeight: 43,
              }}
            >
              Reset Account
            </button>
          </div>

          {orderMessage && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 9,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                color: "#334155",
              }}
            >
              {orderMessage}
            </div>
          )}
        </Card>

        {/* ==================================================
            OPEN POSITIONS
        ================================================== */}

        <Card
          title="Open Positions"
          style={{ marginBottom: 18 }}
        >
          {positions.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No open positions.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 750,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Average Price</th>
                    <th style={thStyle}>Current Price</th>
                    <th style={thStyle}>P&L</th>
                  </tr>
                </thead>

                <tbody>
                  {positions.map((position, index) => (
                    <tr
                      key={`${position.symbol || "position"}-${index}`}
                    >
                      <td style={tdStyle}>
                        {position.symbol || "—"}
                      </td>

                      <td style={tdStyle}>
                        {formatNumber(
                          position.quantity,
                          0
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(
                          position.average_price ??
                            position.avg_price
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(
                          position.current_price ??
                            position.price
                        )}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            Number(
                              position.pnl ??
                                position.profit_loss
                            ) >= 0
                              ? "#16a34a"
                              : "#dc2626",
                          fontWeight: 800,
                        }}
                      >
                        {formatMoney(
                          position.pnl ??
                            position.profit_loss
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ==================================================
            TRADE HISTORY
        ================================================== */}

        <div style={{ display: "none" }}><Card title="Trade History">
          {trades.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "#64748b",
              }}
            >
              No trades yet.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 850,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Side</th>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {trades.map((trade, index) => (
                    <tr
                      key={trade.id || `${trade.symbol || "trade"}-${index}`}
                    >
                      <td style={tdStyle}>
                        {formatTradeTimestampIST(
                          trade.timestamp || trade.time
                        )}
                      </td>

                      <td style={tdStyle}>
                        {trade.symbol || "—"}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            trade.side === "BUY"
                              ? "#16a34a"
                              : "#dc2626",
                          fontWeight: 800,
                        }}
                      >
                        {trade.side || "—"}
                      </td>

                      <td style={tdStyle}>
                        {formatNumber(
                          trade.quantity,
                          0
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(trade.price)}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(
                          trade.value ??
                            Number(trade.price || 0) *
                              Number(
                                trade.quantity || 0
                              )
                        )}
                      </td>

                      <td style={tdStyle}>
                        <button
                          onClick={() => removePaperOrder(trade)}
                          disabled={!trade.id}
                          title={
                            trade.id
                              ? "Remove this paper order and recalculate the paper account"
                              : "This order was created before Remove Order was enabled"
                          }
                          style={{
                            padding: "7px 11px",
                            borderRadius: 7,
                            border: trade.id
                              ? "1px solid #fecaca"
                              : "1px solid #e2e8f0",
                            background: trade.id
                              ? "#fff1f2"
                              : "#f8fafc",
                            color: trade.id
                              ? "#be123c"
                              : "#94a3b8",
                            fontWeight: 700,
                            cursor: trade.id
                              ? "pointer"
                              : "not-allowed",
                          }}
                        >
                          Remove Order
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card></div>

          </>
        )}

        {analysisCategory === "INTRADAY" && (
          <>
        {/* ==================================================
            INTRADAY PAPER TRADING
        ================================================== */}

        <div id="intraday-paper-trading">
<Card
          title="Intraday Buy / Sell Paper Trading"
          style={{ marginTop: 18, marginBottom: 18 }}
        >
          {/* Search stock and choose destination */}

          <div
            style={{
              padding: 14,
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#f8fafc",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#0f172a",
                marginBottom: 9,
              }}
            >
              Search Stock for Intraday Trading
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  position: "relative",
                  flex: "1 1 320px",
                  minWidth: 240,
                }}
              >
                <input
                  type="text"
                  value={paperStockSearch}
                  onChange={(e) => {
                    setPaperStockSearch(e.target.value);
                    setPaperSearchSelected("");
                    setPaperSendMessage("");
                  }}
                  placeholder="Search stock symbol or company name..."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "11px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#111827",
                    fontSize: 14,
                  }}
                />

                {paperStockSearch.trim() && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 5px)",
                      left: 0,
                      right: 0,
                      zIndex: 40,
                      maxHeight: 250,
                      overflowY: "auto",
                      border: "1px solid #cbd5e1",
                      borderRadius: 8,
                      background: "#ffffff",
                      boxShadow:
                        "0 10px 30px rgba(15,23,42,0.15)",
                    }}
                  >
                    {filteredPaperStocks.length === 0 ? (
                      <div
                        style={{
                          padding: 12,
                          color: "#64748b",
                        }}
                      >
                        No matching stock found.
                      </div>
                    ) : (
                      filteredPaperStocks
                        .slice(0, 20)
                        .map(([stockSymbol, stockName]) => (
                          <button
                            key={`search-${stockSymbol}`}
                            type="button"
                            onClick={() =>
                              selectPaperSearchStock(stockSymbol)
                            }
                            style={{
                              width: "100%",
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "10px 12px",
                              border: "none",
                              borderBottom:
                                "1px solid #f1f5f9",
                              background:
                                paperSearchSelected === stockSymbol
                                  ? "#dbeafe"
                                  : "#ffffff",
                              color: "#111827",
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            <strong>{stockSymbol}</strong>
                            <span
                              style={{
                                color: "#64748b",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {stockName}
                            </span>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => sendSearchedStock("INTRADAY")}
                style={{
                  padding: "11px 15px",
                  border: "1px solid #7c3aed",
                  borderRadius: 8,
                  background: "#7c3aed",
                  color: "#ffffff",
                  fontWeight: 800,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Send to Intraday
              </button>
            </div>

            <div
              style={{
                marginTop: 9,
                color: "#64748b",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Search and select a stock, then send it directly to
              Intraday Buy / Sell Analysis and Intraday Paper Trading.
            </div>

            {paperSendMessage && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 7,
                  background: "#ecfeff",
                  border: "1px solid #a5f3fc",
                  color: "#155e75",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {paperSendMessage}
              </div>
            )}
          </div>

          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "#0f172a" }}>
              Intraday short selling is enabled.
            </strong>{" "}
            <span style={{ color: "#475569" }}>
              You can press SELL even when you did not buy the stock earlier.
              That opens a SHORT position. BUY is used to cover the short.
              The simulator uses an estimated 20% margin requirement
              (maximum 5x leverage).
            </span>
          </div>

          {/* Local nightly learning summary */}

          <div
            style={{
              background: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>
                  Learning / Training
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                  Refresh updates history first, then rebuilds the learning profile
                </div>
              </div>

              <button
                type="button"
                onClick={() => loadLearningProfile(true)}
                disabled={learningProfileLoading}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#f8fafc",
                  color: "#0f172a",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontWeight: 800,
                  cursor: learningProfileLoading ? "default" : "pointer",
                }}
              >
                {learningProfileLoading ? "Syncing History..." : "Refresh Learning + History"}
              </button>
            </div>

            {learningProfileError ? (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "#fee2e2",
                  color: "#991b1b",
                  fontWeight: 700,
                }}
              >
                {learningProfileError}
              </div>
            ) : learningProfile?.available === false ? (
              <div style={{ color: "#64748b" }}>
                {learningProfile?.message || "No learning profile available yet."}
              </div>
            ) : learningProfile ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
                    gap: 9,
                  }}
                >
                  {[
                    ["Candidates", learningProfile?.candidate_summary?.total ?? 0],
                    ["Resolved", learningProfile?.candidate_summary?.resolved ?? 0],
                    ["Decisive", learningProfile?.candidate_summary?.decisive ?? 0],
                    ["Completed Trades", learningProfile?.trade_summary?.completed_trades ?? 0],
                    [
                      "Wins / Losses",
                      `${learningProfile?.trade_summary?.wins ?? 0} / ${
                        learningProfile?.trade_summary?.losses ?? 0
                      }`,
                    ],
                    [
                      "Executed Win Rate",
                      learningProfile?.trade_summary?.win_rate == null
                        ? "—"
                        : `${(
                            Number(learningProfile.trade_summary.win_rate) * 100
                          ).toFixed(2)}%`,
                    ],
                    [
                      "Net Realized P&L",
                      formatMoney(
                        learningProfile?.trade_summary?.net_realized_pnl ?? 0
                      ),
                    ],
                    [
                      "Unknown Interval",
                      learningProfile?.data_quality?.unknown_interval ?? 0,
                    ],
                    ["Unknown RSI", learningProfile?.data_quality?.unknown_rsi ?? 0],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        padding: 10,
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#64748b" }}>{label}</div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 16,
                          fontWeight: 900,
                          color:
                            label === "Net Realized P&L" &&
                            Number(learningProfile?.trade_summary?.net_realized_pnl) < 0
                              ? "#dc2626"
                              : "#0f172a",
                        }}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                    gap: 9,
                    marginTop: 10,
                  }}
                >
                  {["EXECUTABLE", "STRICT_QUALIFIED", "QUALIFIED_LEGACY", "REJECTED"].map(
                    (name) => {
                      const stats = learningProfile?.cohort_summaries?.[name] || {};
                      const success =
                        stats?.success_rate == null
                          ? "N/A"
                          : `${(Number(stats.success_rate) * 100).toFixed(2)}%`;

                      return (
                        <div
                          key={name}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 8,
                            padding: 10,
                            background: "#ffffff",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 900,
                              color: "#334155",
                              marginBottom: 5,
                            }}
                          >
                            {name.replaceAll("_", " ")}
                          </div>
                          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
                            Resolved: <strong>{stats?.resolved ?? 0}</strong>
                            {" • "}Decisive: <strong>{stats?.decisive ?? 0}</strong>
                            <br />
                            Target / Stop:{" "}
                            <strong>
                              {stats?.target_first ?? 0} / {stats?.stop_first ?? 0}
                            </strong>
                            {" • "}Success: <strong>{success}</strong>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px solid #e2e8f0",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  <span>
                    Last learning update:{" "}
                    <strong style={{ color: "#334155" }}>
                      {learningProfile?.generated_at
                        ? formatTradeTimestampIST(learningProfile.generated_at)
                        : "—"}
                    </strong>
                  </span>
                  <span>
                    Mode:{" "}
                    <strong style={{ color: "#334155" }}>
                      {learningProfile?.policy?.mode || "—"}
                    </strong>
                    {" • "}Live thresholds:{" "}
                    <strong style={{ color: "#334155" }}>
                      {learningProfile?.policy?.auto_change_live_thresholds
                        ? "AUTO"
                        : "UNCHANGED"}
                    </strong>
                  </span>
                </div>
              </>
            ) : (
              <div style={{ color: "#64748b" }}>
                Loading local learning profile...
              </div>
            )}
          </div>

          {/* Account summary */}

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            {[
              [
                "Available Margin",
                formatMoney(
                  dayTradeAccount?.available_margin ??
                    dayTradeAccount?.cash ??
                    100000
                ),
              ],
              [
                "Margin Used",
                formatMoney(dayTradeAccount?.margin_used ?? 0),
              ],
              [
                "Realized P&L",
                formatMoney(dayTradeAccount?.realized_pnl ?? 0),
              ],
              [
                "Unrealized P&L",
                formatMoney(dayTradeAccount?.unrealized_pnl ?? 0),
              ],
              [
                "Account Equity",
                formatMoney(
                  dayTradeAccount?.equity ??
                    dayTradeAccount?.balance ??
                    100000
                ),
              ],
              [
                "Max Leverage",
                `${formatNumber(
                  dayTradeAccount?.max_leverage ?? 5,
                  1
                )}x`,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  padding: 12,
                  border: "1px solid #e2e8f0",
                  borderRadius: 9,
                  background: "#ffffff",
                }}
              >
                <div
                  style={{
                    color: "#64748b",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  {label}
                </div>

                <div
                  style={{
                    color: "#0f172a",
                    fontSize: 18,
                    fontWeight: 900,
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Horizontal stock selector */}

          <label
            style={{
              display: "block",
              color: "#64748b",
              fontSize: 13,
              marginBottom: 7,
            }}
          >
            Intraday Stock
          </label>

          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              overflowY: "hidden",
              whiteSpace: "nowrap",
              padding: "4px 2px 10px",
              marginBottom: 12,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {PAPER_STOCK_OPTIONS.map(([stockSymbol, stockName]) => {
              const selected = dayTradeSymbol === stockSymbol;

              return (
                <button
                  key={`day-${stockSymbol}`}
                  type="button"
                  title={stockName}
                  onClick={() => setDayTradeSymbol(stockSymbol)}
                  style={{
                    flex: "0 0 auto",
                    minWidth: 118,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: selected
                      ? "2px solid #7c3aed"
                      : "1px solid #cbd5e1",
                    background: selected ? "#ede9fe" : "#ffffff",
                    color: selected ? "#6d28d9" : "#111827",
                    fontWeight: selected ? 900 : 700,
                    cursor: "pointer",
                  }}
                >
                  {stockSymbol}
                </button>
              );
            })}
          </div>

          {/* Single-line order controls */}

          <div
            style={{
              display: "flex",
              flexWrap: "nowrap",
              gap: 12,
              alignItems: "end",
              overflowX: "auto",
              paddingBottom: 8,
            }}
          >
            <div style={{ flex: "0 0 150px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Stock
              </div>
              <div
                style={{
                  padding: "11px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                  fontWeight: 900,
                }}
              >
                {dayTradeSymbol}
              </div>
            </div>

            <div style={{ flex: "0 0 165px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Latest Price
              </div>
              <div
                style={{
                  padding: "11px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                  fontWeight: 900,
                }}
              >
                {dayTradeQuoteLoading && !dayTradeQuote
                  ? "Loading..."
                  : dayTradeLivePrice > 0
                  ? formatMoney(dayTradeLivePrice)
                  : "—"}
              </div>
            </div>

            <div style={{ flex: "0 0 190px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Side
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setDayTradeSide("BUY")}
                  style={{
                    flex: 1,
                    padding: "11px 13px",
                    borderRadius: 8,
                    border:
                      dayTradeSide === "BUY"
                        ? "2px solid #15803d"
                        : "1px solid #86efac",
                    background:
                      dayTradeSide === "BUY"
                        ? "#16a34a"
                        : "#dcfce7",
                    color:
                      dayTradeSide === "BUY"
                        ? "#ffffff"
                        : "#166534",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  BUY
                </button>

                <button
                  type="button"
                  onClick={() => setDayTradeSide("SELL")}
                  style={{
                    flex: 1,
                    padding: "11px 13px",
                    borderRadius: 8,
                    border:
                      dayTradeSide === "SELL"
                        ? "2px solid #b91c1c"
                        : "1px solid #fecaca",
                    background:
                      dayTradeSide === "SELL"
                        ? "#dc2626"
                        : "#fee2e2",
                    color:
                      dayTradeSide === "SELL"
                        ? "#ffffff"
                        : "#991b1b",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  SELL
                </button>
              </div>
            </div>

            <div style={{ flex: "0 0 120px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Quantity
              </div>
              <input
                type="number"
                min="1"
                value={dayTradeQuantity}
                onChange={(e) => setDayTradeQuantity(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                }}
              />
            </div>

            <div style={{ flex: "0 0 175px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Manual Order Value
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={dayTradeManualOrderValue}
                onChange={(e) =>
                  setDayTradeManualOrderValue(e.target.value)
                }
                placeholder="₹ optional"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border: "1px solid #93c5fd",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                }}
              />
              <div
                style={{
                  fontSize: 10,
                  color: "#64748b",
                  marginTop: 3,
                  whiteSpace: "nowrap",
                }}
              >
                {dayTradeManualValueNumber > 0
                  ? `Qty = ${dayTradeCalculatedQuantity}`
                  : "Optional · overrides quantity"}
              </div>
            </div>

            <div style={{ flex: "0 0 190px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Order Type
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setDayTradeOrderType("MARKET")}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border:
                      dayTradeOrderType === "MARKET"
                        ? "2px solid #2563eb"
                        : "1px solid #cbd5e1",
                    background:
                      dayTradeOrderType === "MARKET"
                        ? "#2563eb"
                        : "#ffffff",
                    color:
                      dayTradeOrderType === "MARKET"
                        ? "#ffffff"
                        : "#334155",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Market
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDayTradeOrderType("LIMIT");
                    if (!dayTradeOrderPrice && dayTradeLivePrice > 0) {
                      setDayTradeOrderPrice(String(dayTradeLivePrice));
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border:
                      dayTradeOrderType === "LIMIT"
                        ? "2px solid #7c3aed"
                        : "1px solid #cbd5e1",
                    background:
                      dayTradeOrderType === "LIMIT"
                        ? "#7c3aed"
                        : "#ffffff",
                    color:
                      dayTradeOrderType === "LIMIT"
                        ? "#ffffff"
                        : "#334155",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Exact Price
                </button>
              </div>
            </div>

            <div style={{ flex: "0 0 155px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Buy / Sell Price
              </div>

              <input
                type="number"
                min="0"
                step="0.05"
                value={dayTradeOrderPrice}
                onChange={(e) => setDayTradeOrderPrice(e.target.value)}
                disabled={dayTradeOrderType !== "LIMIT"}
                placeholder={
                  dayTradeOrderType === "LIMIT"
                    ? "₹ exact market price"
                    : "Market price"
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border:
                    dayTradeOrderType === "LIMIT"
                      ? "1px solid #c4b5fd"
                      : "1px solid #e2e8f0",
                  borderRadius: 8,
                  background:
                    dayTradeOrderType === "LIMIT"
                      ? "#ffffff"
                      : "#f8fafc",
                  color: "#111827",
                }}
              />
            </div>

            <div style={{ flex: "0 0 170px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Stop Loss (required)
              </div>
              <input
                type="number"
                min="0"
                step="0.05"
                value={dayTradeStopLoss}
                onChange={(e) => setDayTradeStopLoss(e.target.value)}
                placeholder="₹ price"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border: "1px solid #fca5a5",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                }}
              />
              <div style={{ color: "#92400e", fontSize: 11, lineHeight: 1.4, marginTop: 5, maxWidth: 190 }}>
                Hard estimated-risk cap: ₹50. Backend may reduce quantity automatically. Gaps/slippage can exceed the cap.
              </div>
            </div>

            <div style={{ flex: "0 0 150px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Target 1
              </div>
              <input
                type="number"
                min="0"
                step="0.05"
                value={dayTradeTarget1}
                onChange={(e) => setDayTradeTarget1(e.target.value)}
                placeholder="₹ target"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "11px 12px",
                  border: "1px solid #86efac",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                }}
              />
            </div>

            <div style={{ flex: "0 0 160px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Order Value
              </div>
              <div
                style={{
                  padding: "11px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  background: "#ffffff",
                  color: "#111827",
                  fontWeight: 800,
                }}
              >
                {formatMoney(dayTradeExposure)}
              </div>
            </div>

            <div style={{ flex: "0 0 170px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Est. Margin
              </div>
              <div
                style={{
                  padding: "11px 12px",
                  border: "1px solid #c4b5fd",
                  borderRadius: 8,
                  background: "#f5f3ff",
                  color: "#6d28d9",
                  fontWeight: 900,
                }}
              >
                {formatMoney(dayTradeEstimatedMargin)}
              </div>
            </div>

            <button
              id="intraday-paper-execute-button"
              type="button"
              onClick={() => submitDayTradeOrder()}
              style={{
                flex: "0 0 160px",
                padding: "12px 15px",
                border: "none",
                borderRadius: 8,
                background:
                  dayTradeSide === "BUY" ? "#16a34a" : "#dc2626",
                color: "#ffffff",
                fontWeight: 900,
                cursor: "pointer",
                minHeight: 43,
              }}
            >
              {dayTradeSide === "SELL"
                ? "SELL / SHORT"
                : "BUY"}
            </button>

            <button
              type="button"
              onClick={() => loadDayTradeQuote(dayTradeSymbol, true, true)}
              disabled={dayTradeQuoteLoading}
              style={{
                flex: "0 0 130px",
                padding: "12px 15px",
                border: "1px solid #93c5fd",
                borderRadius: 8,
                background: "#eff6ff",
                color: "#1d4ed8",
                fontWeight: 800,
                cursor: dayTradeQuoteLoading ? "wait" : "pointer",
                minHeight: 43,
              }}
            >
              Refresh Price
            </button>

            <button
              type="button"
              onClick={resetDayTradeAccount}
              style={{
                flex: "0 0 130px",
                padding: "12px 15px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                background: "#ffffff",
                color: "#334155",
                fontWeight: 800,
                cursor: "pointer",
                minHeight: 43,
              }}
            >
              Reset
            </button>
          </div>

          {dayTradeQuoteError && (
            <div
              style={{
                marginTop: 8,
                color: "#dc2626",
                fontSize: 12,
              }}
            >
              Price error: {dayTradeQuoteError}
            </div>
          )}

          <div style={{marginTop:12,padding:12,borderRadius:8,border:"1px solid #cbd5e1",background:"#f8fafc",color:"#0f172a",fontSize:13}}>
            <strong>Scanner approval — {dayTradeSymbol} {dayTradeSide}</strong>
            {dayTradeCandidateStatus ? (
              <div style={{marginTop:6,lineHeight:1.6}}>
                <div>Qualified: <strong>{dayTradeCandidateStatus.strict_qualified ? "YES" : "NO"}</strong> · Executable: <strong>{dayTradeCandidateStatus.executable ? "YES" : "NO"}</strong></div>
                {!dayTradeCandidateStatus.found && <div>No matching same-day scanner candidate found.</div>}
                {dayTradeCandidateStatus.failed_checks?.length > 0 && <div><strong>Failed checks:</strong> {dayTradeCandidateStatus.failed_checks.map(s => s.replaceAll("_", " ")).join(", ")}</div>}
                {dayTradeCandidateStatus.rejection_reason && <div><strong>Scanner note:</strong> {dayTradeCandidateStatus.rejection_reason}</div>}
                <div style={{color:"#64748b",fontSize:12}}>Research information only. Final order approval is checked by the backend; closing positions may still be permitted.</div>
              </div>
            ) : <div style={{marginTop:5}}>{dayTradeCandidateStatusError || "Checking latest scanner status…"}</div>}
          </div>

          {dayTradeMessage && (
            <div
              style={{
                marginTop: 12,
                padding: 11,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                background: "#f8fafc",
                color: "#334155",
              }}
            >
              {dayTradeMessage}
            </div>
          )}

          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              borderRadius: 9,
              border: "1px solid #bfdbfe",
              background: "#eff6ff",
              color: "#1e3a8a",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>Exact-price execution:</strong> BUY and SELL orders are
            tracked independently. An Exact Price order executes only when
            the observed market price is exactly equal to the requested
            price to 2 decimal places. If the market skips across that
            value between refreshes, the order becomes
            <strong> ORDER NOT POSSIBLE</strong>. You can also enter a
            Manual Order Value; it overrides Quantity and calculates the
            maximum whole-share quantity.
          </div>

          <div
            style={{
              marginTop: 18,
              marginBottom: 18,
              padding: "14px",
              borderRadius: 10,
              border: "1px solid #fde68a",
              background: "#fffbeb",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                marginBottom: 10,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: "#92400e",
                }}
              >
                Waiting / Not Possible ({dayTradePendingOrders.length})
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: "#92400e",
                }}
              >
                BUY and SELL are independent · execute only when market price exactly matches requested price
              </div>
            </div>

            {dayTradePendingOrders.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  textAlign: "center",
                  color: "#a16207",
                  border: "1px dashed #fcd34d",
                  borderRadius: 8,
                  background: "#ffffff",
                }}
              >
                No waiting or non-executable intraday orders.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 950,
                    background: "#ffffff",
                  }}
                >
                  <thead>
                    <tr>
                      <th style={thStyle}>Time</th>
                      <th style={thStyle}>Symbol</th>
                      <th style={thStyle}>Side</th>
                      <th style={thStyle}>Qty</th>
                      <th style={thStyle}>Order Value</th>
                      <th style={thStyle}>Requested Price</th>
                      <th style={thStyle}>Current Market</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {dayTradePendingOrders.map((order, index) => (
                      <tr
                        key={
                          order.id ||
                          `waiting-${order.symbol}-${index}`
                        }
                      >
                        <td style={tdStyle}>
                          {order.timestamp || "—"}
                        </td>

                        <td style={tdStyle}>
                          {order.symbol || "—"}
                        </td>

                        <td
                          style={{
                            ...tdStyle,
                            color:
                              order.side === "BUY"
                                ? "#16a34a"
                                : "#dc2626",
                            fontWeight: 900,
                          }}
                        >
                          {order.side || "—"}
                        </td>

                        <td style={tdStyle}>
                          {order.quantity ?? "—"}
                        </td>

                        <td style={tdStyle}>
                          {formatMoney(
                            order.calculated_order_value ??
                              order.requested_order_value
                          )}
                        </td>

                        <td
                          style={{
                            ...tdStyle,
                            fontWeight: 900,
                            color: "#7c3aed",
                          }}
                        >
                          {formatMoney(order.limit_price)}
                        </td>

                        <td style={tdStyle}>
                          {formatMoney(order.last_market_price)}
                        </td>

                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "5px 9px",
                              borderRadius: 999,
                              background:
                                order.status === "NOT_POSSIBLE"
                                  ? "#fee2e2"
                                  : "#fef3c7",
                              color:
                                order.status === "NOT_POSSIBLE"
                                  ? "#991b1b"
                                  : "#92400e",
                              fontWeight: 900,
                              fontSize: 12,
                            }}
                          >
                            {order.status === "NOT_POSSIBLE"
                              ? "ORDER NOT POSSIBLE"
                              : "WAITING"}
                          </span>

                          {order.last_error && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                color: "#dc2626",
                              }}
                            >
                              {order.last_error}
                            </div>
                          )}
                        </td>

                        <td style={tdStyle}>
                          <button
                            type="button"
                            onClick={() =>
                              cancelDayTradePendingOrder(order)
                            }
                            style={{
                              padding: "7px 10px",
                              borderRadius: 7,
                              border: "1px solid #dc2626",
                              background: "#ffffff",
                              color: "#dc2626",
                              fontWeight: 800,
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              borderRadius: 9,
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <strong>Square Off:</strong> clicking <strong>Square Off @ Market</strong>
            immediately sends the opposite order for the full open quantity.
            It ignores the Exact Price, Manual Order Value and main BUY/SELL
            controls, and uses the fresh market price fetched by the backend
            at execution time.
            <br /><br />
            <strong>Risk control:</strong> every new or increased position requires a valid Stop Loss. The backend limits estimated entry-to-stop risk to ₹50 by reducing share quantity when needed. This is an estimate, not a guaranteed maximum loss.
            <br /><br />
            <strong>Automatic Stop Loss:</strong> the Stop Loss entered
            when the trade is executed is attached to the open position. For
            LONG positions it automatically SELLs the full quantity when LTP
            reaches/falls below the stop loss; for SHORT positions it
            automatically BUYs back the full quantity when LTP reaches/rises
            above the stop loss. Execution is at the latest market price
            available when the trigger is detected. Detection depends on fresh market data and the backend recovery check; price gaps, stale data, slippage, or outages can cause a larger loss than ₹50.
            <br /><br />
            <strong>Automatic Exit Price:</strong> after opening an
            intraday position, enter a target price in the Open Positions
            table. For a LONG position the system automatically SELLs when
            the market price reaches or moves above the target. For a SHORT
            position it automatically BUYs to cover when the market price
            reaches or moves below the target.
          </div>

          {/* Intraday positions */}

          <div
            id="intraday-paper-open-positions"
            style={{
              marginTop: 20,
              fontWeight: 900,
              color: "#0f172a",
              marginBottom: 8,
            }}
          >
            Intraday Open Positions
          </div>

          {dayTradePositions.length === 0 ? (
            <div
              style={{
                padding: 18,
                textAlign: "center",
                color: "#64748b",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
              }}
            >
              No intraday positions.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 1600,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Position</th>
                    <th style={thStyle}>Qty</th>
                    <th style={thStyle}>Avg Price</th>
                    <th style={thStyle}>LTP</th>
                    <th style={thStyle}>Margin Used</th>
                    <th style={thStyle}>P&L</th>
                    <th style={thStyle}>Stop Loss</th>
                    <th style={thStyle}>Edit Stop Loss</th>
                    <th style={thStyle}>Auto Exit</th>
                    <th style={thStyle}>Target Price</th>
                    <th style={thStyle}>Management</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {dayTradePositions.map((position, index) => (
                    <tr key={`intraday-position-${position.symbol}-${index}`}>
                      <td style={tdStyle}>{position.symbol}</td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            position.direction === "SHORT"
                              ? "#dc2626"
                              : "#16a34a",
                          fontWeight: 900,
                        }}
                      >
                        {position.direction}
                      </td>

                      <td style={tdStyle}>
                        {formatNumber(position.quantity, 0)}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(position.average_price)}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(
                          position.current_price ?? position.ltp
                        )}
                      </td>

                      <td style={tdStyle}>
                        {formatMoney(position.margin_used)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            Number(position.pnl || 0) >= 0
                              ? "#16a34a"
                              : "#dc2626",
                          fontWeight: 900,
                        }}
                      >
                        {formatMoney(position.pnl)}
                      </td>

                      <td style={tdStyle}>
                        {position.stop_loss ? (
                          <div>
                            <div
                              style={{
                                color: "#dc2626",
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                              }}
                            >
                              ACTIVE
                            </div>
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: 12,
                                color: "#dc2626",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {formatMoney(position.stop_loss)}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>
                            Not set
                          </span>
                        )}
                      </td>

                      <td style={tdStyle}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            minWidth: 255,
                          }}
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.05"
                            value={
                              dayTradeStopLossInputs?.[position.symbol] ?? ""
                            }
                            onChange={(e) =>
                              setDayTradeStopLossInputs((current) => ({
                                ...current,
                                [position.symbol]: e.target.value,
                              }))
                            }
                            placeholder={
                              position.stop_loss
                                ? `Current ${formatMoney(position.stop_loss)}`
                                : position.direction === "SHORT"
                                  ? "Stop above LTP ₹"
                                  : "Stop below LTP ₹"
                            }
                            style={{
                              width: 135,
                              padding: "7px 8px",
                              border: "1px solid #cbd5e1",
                              borderRadius: 7,
                              background: "#ffffff",
                              color: "#111827",
                            }}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setDayTradePositionStopLoss(position)
                            }
                            style={{
                              padding: "7px 9px",
                              border: "1px solid #dc2626",
                              borderRadius: 7,
                              background: "#dc2626",
                              color: "#ffffff",
                              fontWeight: 800,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {position.stop_loss ? "Update SL" : "Set SL"}
                          </button>

                          {position.stop_loss && (
                            <button
                              type="button"
                              onClick={() =>
                                removeDayTradePositionStopLoss(position)
                              }
                              style={{
                                padding: "7px 9px",
                                border: "1px solid #dc2626",
                                borderRadius: 7,
                                background: "#ffffff",
                                color: "#dc2626",
                                fontWeight: 800,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={tdStyle}>
                        {position.exit_target ? (
                          <div>
                            <div
                              style={{
                                color: "#16a34a",
                                fontWeight: 900,
                                whiteSpace: "nowrap",
                              }}
                            >
                              ACTIVE
                            </div>
                            <div
                              style={{
                                marginTop: 3,
                                fontSize: 12,
                                color: "#64748b",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {formatMoney(position.exit_target)}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>
                            Not set
                          </span>
                        )}
                      </td>

                      <td style={tdStyle}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            minWidth: 245,
                          }}
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.05"
                            value={
                              dayTradeTargetInputs?.[position.symbol] ?? ""
                            }
                            onChange={(e) =>
                              setDayTradeTargetInputs((current) => ({
                                ...current,
                                [position.symbol]: e.target.value,
                              }))
                            }
                            placeholder={
                              position.direction === "SHORT"
                                ? "Buy-back target ₹"
                                : "Sell target ₹"
                            }
                            style={{
                              width: 125,
                              padding: "7px 8px",
                              border: "1px solid #cbd5e1",
                              borderRadius: 7,
                              background: "#ffffff",
                              color: "#111827",
                            }}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setDayTradeExitTarget(position)
                            }
                            style={{
                              padding: "7px 9px",
                              border: "1px solid #16a34a",
                              borderRadius: 7,
                              background: "#16a34a",
                              color: "#ffffff",
                              fontWeight: 800,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Set Target
                          </button>

                          {position.exit_target && (
                            <button
                              type="button"
                              onClick={() =>
                                removeDayTradeExitTarget(position)
                              }
                              style={{
                                padding: "7px 9px",
                                border: "1px solid #dc2626",
                                borderRadius: 7,
                                background: "#ffffff",
                                color: "#dc2626",
                                fontWeight: 800,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>

                      <td style={{ ...tdStyle, minWidth: 300 }}>
                        {(() => {
                          const advisory = dayTradeManagementAlerts.find(
                            (item) =>
                              String(item?.symbol || "").toUpperCase() ===
                              String(position?.symbol || "").toUpperCase()
                          );

                          // Show ONLY the one currently active category.
                          // If the trade is not yet in profit, show no category card.
                          if (!advisory) {
                            const pnl = Number(position?.unrealized_pnl ?? position?.pnl ?? 0);
                            const avgPrice = Number(position?.average_price ?? position?.avg_price ?? 0);
                            const ltp = Number(position?.ltp ?? position?.current_price ?? 0);
                            const qty = Number(position?.quantity ?? 0);
                            const direction = String(position?.direction || (qty < 0 ? "SHORT" : "LONG")).toUpperCase();
                            const favorable = pnl > 0;
                            const movePct = avgPrice > 0 && ltp > 0
                              ? (direction === "SHORT"
                                  ? ((avgPrice - ltp) / avgPrice) * 100
                                  : ((ltp - avgPrice) / avgPrice) * 100)
                              : 0;

                            return (
                              <div
                                style={{
                                  border: `1px solid ${favorable ? "#16a34a" : "#dc2626"}`,
                                  background: favorable ? "#f0fdf4" : "#fef2f2",
                                  borderRadius: 9,
                                  padding: 10,
                                  minWidth: 220,
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 950,
                                    color: favorable ? "#166534" : "#991b1b",
                                    marginBottom: 5,
                                  }}
                                >
                                  {favorable ? "🟢 IN FAVOUR" : "🔴 AGAINST"}
                                </div>
                                <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>
                                  P&L: <strong>{formatMoney(pnl)}</strong>
                                  <br />
                                  Move from Entry: <strong>{movePct >= 0 ? "+" : ""}{movePct.toFixed(2)}%</strong>
                                  <br />
                                  {favorable
                                    ? "Waiting for a profit-management category."
                                    : position?.stop_loss
                                      ? "Original stop loss remains active."
                                      : "No profit-management action yet."}
                                </div>
                              </div>
                            );
                          }

                          const category = String(advisory.category || "");
                          const categoryStyle =
                            category === "PROFIT_TO_LOSS"
                              ? { border: "#b91c1c", bg: "#fef2f2", text: "#7f1d1d" }
                              : category === "HIGH_GIVEBACK"
                                ? { border: "#ea580c", bg: "#fff7ed", text: "#9a3412" }
                                : category === "TARGET_EXTENSION"
                                  ? { border: "#16a34a", bg: "#f0fdf4", text: "#166534" }
                              : category === "LOCK_PROFIT"
                                ? { border: "#2563eb", bg: "#eff6ff", text: "#1d4ed8" }
                                : category === "MOMENTUM_WEAKENING"
                                  ? { border: "#d97706", bg: "#fffbeb", text: "#92400e" }
                                  : { border: "#dc2626", bg: "#fef2f2", text: "#991b1b" };

                          return (
                            <div
                              style={{
                                border: `1px solid ${categoryStyle.border}`,
                                background: categoryStyle.bg,
                                borderRadius: 9,
                                padding: 10,
                                minWidth: 280,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 950,
                                  color: categoryStyle.text,
                                  marginBottom: 6,
                                }}
                              >
                                {advisory.title}
                              </div>

                              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.45 }}>
                                {advisory.message}
                              </div>

                              <div style={{ marginTop: 8, fontSize: 12, color: "#0f172a", lineHeight: 1.5 }}>
                                Current P&L: <strong>{formatMoney(advisory.pnl)}</strong>
                                <br />
                                Peak P&L: <strong>{formatMoney(advisory.peak_unrealized_pnl)}</strong>
                                <br />
                                Profit Giveback: <strong>{formatMoney(advisory.profit_giveback)}</strong> ({Number(advisory.profit_giveback_pct || 0).toFixed(1)}%)
                                {advisory.peak_unrealized_at ? (
                                  <>
                                    <br />
                                    Peak Time: <strong>{formatTradeTimestampIST(advisory.peak_unrealized_at)}</strong>
                                  </>
                                ) : null}
                                <br />
                                Suggested Target: <strong>{formatMoney(advisory.suggested_target)}</strong>
                                <br />
                                Suggested SL: <strong>{formatMoney(advisory.suggested_stop_loss)}</strong>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                  marginTop: 8,
                                }}
                              >
                                {category !== "EXIT_WARNING" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDayTradeTargetInputs((current) => ({
                                        ...current,
                                        [position.symbol]: String(advisory.suggested_target ?? ""),
                                      }))
                                    }
                                    style={{
                                      padding: "6px 8px",
                                      border: `1px solid ${categoryStyle.border}`,
                                      borderRadius: 7,
                                      background: "#ffffff",
                                      color: categoryStyle.text,
                                      fontWeight: 800,
                                      cursor: "pointer",
                                    }}
                                  >
                                    Use Suggested Target
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setDayTradeStopLossInputs((current) => ({
                                      ...current,
                                      [position.symbol]: String(advisory.suggested_stop_loss ?? ""),
                                    }))
                                  }
                                  style={{
                                    padding: "6px 8px",
                                    border: `1px solid ${categoryStyle.border}`,
                                    borderRadius: 7,
                                    background: "#ffffff",
                                    color: categoryStyle.text,
                                    fontWeight: 800,
                                    cursor: "pointer",
                                  }}
                                >
                                  Use Suggested SL
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </td>

                      <td style={tdStyle}>
                        <button
                          type="button"
                          onClick={() =>
                            squareOffDayTradePosition(position)
                          }
                          style={{
                            padding: "7px 11px",
                            border: "1px solid #cbd5e1",
                            borderRadius: 7,
                            background: "#ffffff",
                            color: "#0f172a",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          Square Off @ Market
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Intraday trade history - loaded from SQLite backend */}

          <div
            ref={intradayHistoryRef}
            style={{
              display: "none",
              marginTop: 28,
              padding: 18,
              border: "2px solid #0f172a",
              borderRadius: 12,
              background: "#f8fafc",
            }}
          >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              fontWeight: 900,
              color: "#0f172a",
              marginBottom: 12,
              fontSize: 18,
            }}
          >
            <span>TRADE HISTORY ({dayTradeTrades.length})</span>
            <button
              type="button"
              onClick={() => loadDayTradeData()}
              style={{
                padding: "8px 12px",
                border: "1px solid #94a3b8",
                borderRadius: 8,
                background: "#ffffff",
                color: "#0f172a",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Refresh History
            </button>
          </div>

          <div
            style={{
              display: "none",
              marginTop: 20,
              fontWeight: 900,
              color: "#0f172a",
              marginBottom: 8,
            }}
          >
            Intraday Trade History
          </div>

          {dayTradeTrades.length === 0 ? (
            <div
              style={{
                padding: 18,
                textAlign: "center",
                color: "#64748b",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
              }}
            >
              No intraday trades yet.
            </div>
          ) : (
            <div
              style={{
                width: "100%",
                overflowX: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: 11,
                }}
              >
                <thead>
                  <tr>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Time</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Symbol</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Side</th>
                    <th style={{...thStyle, width: "8%"}}>Mode</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Qty</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Price</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Stop Loss</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Value</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Margin</th>
                    <th style={{...thStyle, width: "9%"}}>P&L</th>
                    <th style={{...thStyle, padding: "7px 4px", fontSize: 10, whiteSpace: "normal"}}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {dayTradeTrades.map((trade, index) => (
                    <tr key={trade.id || `day-trade-${index}`}>
                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>{formatTradeTimestampIST(trade?.timestamp)}</td>
                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>{trade.symbol || "—"}</td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            trade.side === "SELL"
                              ? "#dc2626"
                              : "#16a34a",
                          fontWeight: 900,
                        }}
                      >
                        {trade.side || "—"}
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "5px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 900,
                            background:
                              String(trade.strategy_mode || "").toUpperCase() === "INVERSE"
                                ? "#fffbeb"
                                : String(trade.strategy_mode || "").toUpperCase() === "NORMAL"
                                  ? "#f0fdf4"
                                  : "#f1f5f9",
                            color:
                              String(trade.strategy_mode || "").toUpperCase() === "INVERSE"
                                ? "#92400e"
                                : String(trade.strategy_mode || "").toUpperCase() === "NORMAL"
                                  ? "#166534"
                                  : "#64748b",
                            border:
                              String(trade.strategy_mode || "").toUpperCase() === "INVERSE"
                                ? "1px solid #f59e0b"
                                : String(trade.strategy_mode || "").toUpperCase() === "NORMAL"
                                  ? "1px solid #16a34a"
                                  : "1px solid #cbd5e1",
                          }}
                        >
                          {String(trade.strategy_mode || "LEGACY").toUpperCase()}
                        </span>
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        {formatNumber(trade.quantity, 0)}
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        {formatMoney(trade.price)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          fontWeight: trade.stop_loss != null ? 900 : 500,
                          color:
                            trade.stop_loss != null
                              ? "#dc2626"
                              : "#94a3b8",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {trade.stop_loss != null
                          ? formatMoney(trade.stop_loss)
                          : "Not set"}
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        {formatMoney(trade.value)}
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        {formatMoney(trade.margin_required ?? 0)}
                      </td>

                      <td
                        style={{
                          ...tdStyle,
                          color:
                            Number(trade.realized_pnl || 0) >= 0
                              ? "#16a34a"
                              : "#dc2626",
                          fontWeight: 800,
                        }}
                      >
                        {formatMoney(trade.realized_pnl ?? 0)}
                      </td>

                      <td style={{...tdStyle, padding: "7px 4px", overflowWrap: "anywhere", whiteSpace: "normal"}}>
                        {trade.action || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              color: "#9a3412",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Margin shown here is a Groww-style estimate using 20% of
            order value (up to 5x leverage). Actual Groww margin can
            vary by stock, volatility, exchange/risk rules and broker
            settings.
          </div>
        </Card>
          </div>

          </>
        )}

          </>
        )}

        {appPage === "HISTORY" && (
          <>
            <Card
              title="History & Learning"
              style={{ marginBottom: 18 }}
            >
              <div style={{ color: "#475569", lineHeight: 1.7 }}>
                Historical records are separated from the live trading screen so Page 1 stays focused on current market analysis and execution.
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 10,
                }}
              >
                <Indicator label="Intraday Records" value={dayTradeTrades.length} />
                <Indicator label="Normal Paper Records" value={trades.length} />
                <Indicator label="Today's Completed" value={localTodayTradeSummary.completed_trades} />
                <Indicator
                  label="Today's P&L"
                  value={formatMoney(localTodayTradeSummary.realized_pnl)}
                  positive={localTodayTradeSummary.realized_pnl > 0}
                  negative={localTodayTradeSummary.realized_pnl < 0}
                />
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => loadDayTradeData()}
                  style={{
                    padding: "9px 13px",
                    border: "1px solid #94a3b8",
                    borderRadius: 8,
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Refresh Intraday History
                </button>
                <button
                  type="button"
                  onClick={() => loadLearningProfile(true)}
                  disabled={learningProfileLoading}
                  style={{
                    padding: "9px 13px",
                    border: "1px solid #94a3b8",
                    borderRadius: 8,
                    background: "#ffffff",
                    color: "#0f172a",
                    fontWeight: 800,
                    cursor: learningProfileLoading ? "wait" : "pointer",
                  }}
                >
                  {learningProfileLoading ? "Refreshing..." : "Refresh Learning"}
                </button>
              </div>
            </Card>

            <Card title={`INTRADAY TRADE HISTORY (${dayTradeTrades.length})`} style={{ marginBottom: 18 }}>
              {dayTradeTrades.length === 0 ? (
                <div style={{ padding: 18, textAlign: "center", color: "#64748b" }}>
                  No intraday trades yet.
                </div>
              ) : (
                <div style={{ width: "100%", overflowX: "auto", maxHeight: 650, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
                    <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
                      <tr>
                        <th style={thStyle}>Time</th>
                        <th style={thStyle}>Symbol</th>
                        <th style={thStyle}>Side</th>
                        <th style={thStyle}>Mode</th>
                        <th style={thStyle}>Qty</th>
                        <th style={thStyle}>Price</th>
                        <th style={thStyle}>Stop Loss</th>
                        <th style={thStyle}>Value</th>
                        <th style={thStyle}>P&L</th>
                        <th style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayTradeTrades.map((trade, index) => (
                        <tr key={trade.id || `${trade.symbol || "trade"}-${index}`}>
                          <td style={tdStyle}>{formatTradeTimestampIST(trade.timestamp || trade.time)}</td>
                          <td style={{ ...tdStyle, fontWeight: 800 }}>{trade.symbol || "—"}</td>
                          <td style={{
                            ...tdStyle,
                            color: String(trade.side || "").toUpperCase() === "BUY" ? "#16a34a" : "#dc2626",
                            fontWeight: 800,
                          }}>{trade.side || "—"}</td>
                          <td style={tdStyle}>{trade.strategy_mode || trade.mode || "—"}</td>
                          <td style={tdStyle}>{formatNumber(trade.quantity, 0)}</td>
                          <td style={tdStyle}>{formatMoney(trade.price)}</td>
                          <td style={tdStyle}>{trade.stop_loss != null ? formatMoney(trade.stop_loss) : "Not set"}</td>
                          <td style={tdStyle}>{formatMoney(trade.value)}</td>
                          <td style={{
                            ...tdStyle,
                            color: Number(trade.realized_pnl || 0) >= 0 ? "#16a34a" : "#dc2626",
                            fontWeight: 800,
                          }}>{formatMoney(trade.realized_pnl ?? 0)}</td>
                          <td style={tdStyle}>{trade.action || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title={`NORMAL PAPER TRADE HISTORY (${trades.length})`} style={{ marginBottom: 18 }}>
              {trades.length === 0 ? (
                <div style={{ padding: 18, textAlign: "center", color: "#64748b" }}>
                  No normal paper trades yet.
                </div>
              ) : (
                <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 850 }}>
                    <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
                      <tr>
                        <th style={thStyle}>Time</th>
                        <th style={thStyle}>Symbol</th>
                        <th style={thStyle}>Side</th>
                        <th style={thStyle}>Quantity</th>
                        <th style={thStyle}>Price</th>
                        <th style={thStyle}>Value</th>
                        <th style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, index) => (
                        <tr key={trade.id || `${trade.symbol || "trade"}-${index}`}>
                          <td style={tdStyle}>{formatTradeTimestampIST(trade.timestamp || trade.time)}</td>
                          <td style={tdStyle}>{trade.symbol || "—"}</td>
                          <td style={tdStyle}>{trade.side || "—"}</td>
                          <td style={tdStyle}>{formatNumber(trade.quantity, 0)}</td>
                          <td style={tdStyle}>{formatMoney(trade.price)}</td>
                          <td style={tdStyle}>{formatMoney(trade.value ?? Number(trade.price || 0) * Number(trade.quantity || 0))}</td>
                          <td style={tdStyle}>{trade.action || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {learningProfile && (
              <Card title="Learning Profile" style={{ marginBottom: 18 }}>
                <pre style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                  lineHeight: 1.55,
                  maxHeight: 360,
                  overflowY: "auto",
                  background: "#f8fafc",
                  padding: 12,
                  borderRadius: 8,
                }}>
                  {JSON.stringify(learningProfile, null, 2)}
                </pre>
              </Card>
            )}
          </>
        )}

        {/* ==================================================
            FOOTER WARNING
        ================================================== */}

        <div
          style={{
            marginTop: 20,
            padding: 14,
            textAlign: "center",
            color: "#64748b",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          This application is for educational and paper-trading
          purposes. Technical indicators and intraday signals can
          be wrong, especially during volatile markets. Always
          verify live market conditions before making financial
          decisions.
        </div>
      {analysisCategory === "INTRADAY" && (
        <button
          type="button"
          onClick={() => {
            setAppPage("HISTORY");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          style={{
            position: "fixed",
            right: 22,
            bottom: 22,
            zIndex: 1000,
            padding: "12px 16px",
            border: "none",
            borderRadius: 999,
            background: "#0f172a",
            color: "#ffffff",
            fontWeight: 900,
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.25)",
          }}
        >
          Page 2 • History ({dayTradeTrades.length})
        </button>
      )}

      </main>
    </div>
  );
}

// ============================================================
// TABLE STYLES
// ============================================================

const thStyle = {
  textAlign: "left",
  padding: "12px 10px",
  borderBottom: "2px solid #e2e8f0",
  color: "#475569",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "12px 10px",
  borderBottom: "1px solid #e2e8f0",
  color: "#334155",
  fontSize: 14,
  whiteSpace: "nowrap",
};

