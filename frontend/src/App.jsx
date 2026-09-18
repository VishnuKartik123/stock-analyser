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

async function fetchJson(url, options = {}) {
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
  const [scannerFilter, setScannerFilter] = useState("ALL");
  const [tradeNotificationsEnabled, setTradeNotificationsEnabled] =
    useState(() => {
      if (!("Notification" in window)) return false;
      return Notification.permission === "granted";
    });
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
  const [dayTradeTargetInputs, setDayTradeTargetInputs] = useState({});
  const [dayTradeStopLossInputs, setDayTradeStopLossInputs] = useState({});

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
    selectedPeriod = intradayChartPeriod
  ) {
    if (!selectedSymbol) return;

    setIntradayLoading(true);
    setIntradayError("");

    try {
      const encodedSymbol = encodeURIComponent(selectedSymbol);

      const [analysisData, historyData] = await Promise.all([
        fetchJson(
          `${BACKEND}/api/stock/intraday-analysis?symbol=${encodedSymbol}&interval=${intradayInterval}`
        ),

        fetchJson(
          `${BACKEND}/api/stock/intraday-history?symbol=${encodedSymbol}&interval=${intradayInterval}&period=${selectedPeriod}`
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
        body: "Qualified BUY/SELL alerts are permanently enabled for this site.",
      });
    } else {
      setTradeNotificationsEnabled(false);
      alert(
        "Please allow notifications for this site to receive Qualified BUY/SELL alerts."
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
      setScannerError("");
    } catch (err) {
      console.error("Scanner loading error:", err);
      setScannerError(
        err?.message || "Unable to load intraday opportunities."
      );
    } finally {
      setScannerLoading(false);
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
    loadIntraday(stockSymbol);

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

  async function loadPaperQuote(selectedSymbol = paperSymbol) {
    if (!selectedSymbol) return;

    setPaperPriceLoading(true);
    setPaperPriceError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/stock/quote?symbol=${encodeURIComponent(selectedSymbol)}`
      );

      setPaperQuote(data);
      setPaperPriceError("");
    } catch (err) {
      console.error("Paper stock price error:", err);
      setPaperQuote(null);
      setPaperPriceError(
        err?.message || "Unable to load the latest stock price."
      );
    } finally {
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

    // Use MARKET by default so pressing BUY/SELL executes at the latest
    // market price. The analysis entry value is retained only as a
    // reference message and is not allowed to block execution.
    setDayTradeOrderType("MARKET");
    setDayTradeOrderPrice("");

    loadDayTradeQuote(symbol);

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

    // Move the user to the trading form after loading all defaults.
    window.setTimeout(() => {
      const tradingSection = document.getElementById(
        "intraday-paper-trading"
      );

      if (tradingSection) {
        tradingSection.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 100);
  }

  // ==========================================================
  // INTRADAY PAPER TRADING DATA
  // ==========================================================

  async function loadDayTradeData() {
    try {
      // First check BUY / SELL LIMIT orders that are waiting for
      // the market to reach the selected execution price.
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

        setDayTradeMessage(
          `Waiting order executed: ${executedText}`
        );
      }

      // Then check automatic exit targets on already-open positions.
      const triggerData = await fetchJson(
        `${BACKEND}/api/intraday-paper/check-triggers`,
        { method: "POST" }
      );

      if (Number(triggerData?.triggered_count || 0) > 0) {
        const triggeredText = (triggerData?.triggered || [])
          .map((item) => {
            const reason =
              item.trigger_type === "STOP_LOSS"
                ? "STOP LOSS"
                : "TARGET";

            return `${item.symbol} ${reason} @ ${formatMoney(
              item.trigger_market_price
            )}`;
          })
          .join(", ");

        setDayTradeMessage(
          `Automatic exit executed: ${triggeredText}`
        );
      }

      const [
        accountData,
        positionsData,
        tradesData,
        pendingData,
      ] = await Promise.all([
        fetchJson(`${BACKEND}/api/intraday-paper/account`),
        fetchJson(`${BACKEND}/api/intraday-paper/positions`),
        fetchJson(`${BACKEND}/api/intraday-paper/trades`),
        fetchJson(`${BACKEND}/api/intraday-paper/pending`),
      ]);

      setDayTradeAccount(accountData);
      setDayTradePositions(positionsData?.positions || positionsData || []);

      // /api/intraday-paper/trades normally returns a raw array.
      // Keep this tolerant of either a raw array or { trades: [...] },
      // then always show newest executions first.
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

      setDayTradeTrades(sortedTradeHistory);
      setDayTradePendingOrders(
        pendingData?.orders || pendingData || []
      );
    } catch (err) {
      console.error("Intraday paper data error:", err);
      setDayTradeMessage(
        `Unable to load intraday paper data: ${
          err?.message || "Backend request failed."
        }`
      );
    }
  }

  async function loadDayTradeQuote(selectedSymbol = dayTradeSymbol) {
    if (!selectedSymbol) return;

    setDayTradeQuoteLoading(true);
    setDayTradeQuoteError("");

    try {
      const data = await fetchJson(
        `${BACKEND}/api/stock/quote?symbol=${encodeURIComponent(
          selectedSymbol
        )}`
      );

      setDayTradeQuote(data);
    } catch (err) {
      console.error("Intraday paper quote error:", err);
      setDayTradeQuote(null);
      setDayTradeQuoteError(
        err?.message || "Unable to load latest stock price."
      );
    } finally {
      setDayTradeQuoteLoading(false);
    }
  }

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
    const confirmed = window.confirm(
      "Reset the intraday paper account, positions and trade history?"
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

    const intervalId = setInterval(refreshSelectedStock, 15000);

    return () => clearInterval(intervalId);
  }, [
    symbol,
    intradayInterval,
    intradayChartPeriod,
    analysisCategory,
  ]);

  // ==========================================================
  // RELOAD SCANNER WHEN TIMEFRAME CHANGES
  // ==========================================================

  useEffect(() => {
    loadScanner(false);
  }, [intradayInterval]);

  // ==========================================================
  // AUTO REFRESH SCANNER EVERY 60 SECONDS
  // ==========================================================

  useEffect(() => {
    const scannerTimer = setInterval(() => {
      loadScanner(false);
    }, 60000);

    return () => clearInterval(scannerTimer);
  }, [intradayInterval]);

  // ==========================================================
  // LOAD PRICE WHEN PAPER-TRADING STOCK CHANGES
  // ==========================================================

  useEffect(() => {
    if (!paperSymbol) return;

    loadPaperQuote(paperSymbol);
  }, [paperSymbol]);

  // ==========================================================
  // AUTO REFRESH SELECTED PAPER-TRADING PRICE
  // ==========================================================

  useEffect(() => {
    if (!paperSymbol) return;

    const paperPriceTimer = setInterval(() => {
      loadPaperQuote(paperSymbol);
    }, 15000);

    return () => clearInterval(paperPriceTimer);
  }, [paperSymbol]);

  // ==========================================================
  // INTRADAY PAPER STOCK PRICE
  // ==========================================================

  useEffect(() => {
    if (!dayTradeSymbol) return;
    loadDayTradeQuote(dayTradeSymbol);
  }, [dayTradeSymbol]);

  useEffect(() => {
    if (!dayTradeSymbol) return;

    const dayTradeTimer = setInterval(() => {
      loadDayTradeQuote(dayTradeSymbol);
      loadDayTradeData();
    }, 15000);

    return () => clearInterval(dayTradeTimer);
  }, [dayTradeSymbol]);

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

  const filteredScannerData = qualifiedScannerData.filter((item) => {
    if (scannerFilter === "ALL") return true;
    return item.signal === scannerFilter;
  });

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
              Intraday timeframe
            </div>

            {["5m", "15m"].map((item) => (
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
                title="Alerts are sent only for setups that pass the strict qualification filters."
              >
                {tradeNotificationsEnabled
                  ? "🔔 Qualified Alerts ON"
                  : "🔕 Enable Qualified Alerts"}
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
                        label="Qualification"
                        value={item.qualified === true ? "QUALIFIED SETUP" : "NOT QUALIFIED"}
                        positive={item.qualified === true}
                        negative={item.qualified !== true}
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
                      ? "QUALIFIED SETUP"
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
                    {[
                      ["1d", "1D"],
                      ["2d", "2D"],
                      ["5d", "5D"],
                      ["1wk", "1 Week"],
                      ["1mo", "1 Month"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setIntradayChartPeriod(value);
                          loadIntraday(symbol, value);
                        }}
                        style={{
                          padding: "7px 10px",
                          borderRadius: 7,
                          border:
                            intradayChartPeriod === value
                              ? "1px solid #2563eb"
                              : "1px solid #cbd5e1",
                          background:
                            intradayChartPeriod === value
                              ? "#dbeafe"
                              : "#ffffff",
                          color:
                            intradayChartPeriod === value
                              ? "#1d4ed8"
                              : "#475569",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}

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
              onClick={() => loadPaperQuote(paperSymbol)}
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

        <Card title="Trade History">
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
                        {trade.timestamp ||
                          trade.time ||
                          "—"}
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
        </Card>

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

            <div style={{ flex: "0 0 150px" }}>
              <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6 }}>
                Stop Loss
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
              onClick={() => loadDayTradeQuote(dayTradeSymbol)}
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
            <strong>Automatic Stop Loss:</strong> the Stop Loss entered
            when the trade is executed is attached to the open position. For
            LONG positions it automatically SELLs the full quantity when LTP
            reaches/falls below the stop loss; for SHORT positions it
            automatically BUYs back the full quantity when LTP reaches/rises
            above the stop loss. Execution is at the latest market price
            available when the trigger is detected.
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
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: 1120,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Symbol</th>
                    <th style={thStyle}>Side</th>
                    <th style={thStyle}>Qty</th>
                    <th style={thStyle}>Price</th>
                    <th style={thStyle}>Stop Loss</th>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Margin</th>
                    <th style={thStyle}>Realized P&L</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {dayTradeTrades.map((trade, index) => (
                    <tr key={trade.id || `day-trade-${index}`}>
                      <td style={tdStyle}>{trade.timestamp || "—"}</td>
                      <td style={tdStyle}>{trade.symbol || "—"}</td>

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

                      <td style={tdStyle}>
                        {formatNumber(trade.quantity, 0)}
                      </td>

                      <td style={tdStyle}>
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

                      <td style={tdStyle}>
                        {formatMoney(trade.value)}
                      </td>

                      <td style={tdStyle}>
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

                      <td style={tdStyle}>
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
          onClick={() =>
            intradayHistoryRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            })
          }
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
          Trade History ({dayTradeTrades.length})
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

