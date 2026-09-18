import React, { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";

const GREEN = "#00b386";
const RED = "#eb5b3c";
const BLUE = "#387ed1";
const ORANGE = "#f59e0b";
const PURPLE = "#7c3aed";

function num(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function get(row, keys) {
  for (const key of keys) {
    const x = num(row?.[key]);
    if (x !== null) return x;
  }
  return null;
}

function rawTime(row) {
  return row?.datetime ?? row?.Datetime ?? row?.timestamp ?? row?.time ?? row?.date ?? row?.Date ?? null;
}

function toUnix(value, fallback) {
  if (!value) return fallback;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

function money(v) {
  const x = num(v);
  return x === null ? "—" : `₹${x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function patternsFrom(analysis) {
  const detailed = analysis?.chart_analysis?.candlestick_patterns;
  if (Array.isArray(detailed) && detailed.length) return detailed;
  if (Array.isArray(analysis?.candle_patterns)) return analysis.candle_patterns.map((name) => ({ name }));
  return [];
}

export default function IntradayChart({
  data = [],
  chartType = "CANDLE",
  symbol = "",
  interval = "5m",
  analysis = null,
  positions = [],
  trades = [],
  live = false,
}) {
  const priceRef = useRef(null);
  const volumeRef = useRef(null);

  const rows = useMemo(() => {
    const base = Math.floor(Date.now() / 1000) - (Array.isArray(data) ? data.length : 0) * 300;
    return (Array.isArray(data) ? data : [])
      .map((row, index) => {
        const open = get(row, ["open", "Open"]);
        const high = get(row, ["high", "High"]);
        const low = get(row, ["low", "Low"]);
        const close = get(row, ["close", "Close"]);
        return {
          time: toUnix(rawTime(row), base + index * 300),
          open,
          high,
          low,
          close,
          volume: get(row, ["volume", "Volume"]),
          vwap: get(row, ["vwap", "VWAP"]),
          ema9: get(row, ["ema9", "EMA9", "ema_9"]),
          ema20: get(row, ["ema20", "EMA20", "ema_20"]),
        };
      })
      .filter((r) => [r.open, r.high, r.low, r.close].every(Number.isFinite))
      .sort((a, b) => a.time - b.time)
      .filter((r, i, a) => i === 0 || r.time !== a[i - 1].time)
      .slice(-120)
      .map((r) => {
        // Bad provider values such as VWAP=0 can destroy the price scale.
        // Keep indicators only when they are positive and reasonably close
        // to the candle itself. OHLC is always left untouched.
        const mid = (r.high + r.low) / 2;
        const validIndicator = (value) =>
          Number.isFinite(value) &&
          value > 0 &&
          Number.isFinite(mid) &&
          Math.abs(value - mid) <= Math.max(mid * 0.15, (r.high - r.low) * 25);

        return {
          ...r,
          vwap: validIndicator(r.vwap) ? r.vwap : null,
          ema9: validIndicator(r.ema9) ? r.ema9 : null,
          ema20: validIndicator(r.ema20) ? r.ema20 : null,
        };
      });
  }, [data]);

  const selected = String(symbol || analysis?.symbol || "").toUpperCase();
  const position = (Array.isArray(positions) ? positions : []).find(
    (p) => String(p?.symbol || "").toUpperCase() === selected
  );

  const entry = num(position?.average_price) ?? num(analysis?.entry_price);
  const stop = num(position?.stop_loss) ?? num(analysis?.stop_loss);
  const t1 = num(position?.exit_target) ?? num(analysis?.target_1) ?? num(analysis?.target1);
  const t2 = num(analysis?.target_2) ?? num(analysis?.target2);
  const latest = rows[rows.length - 1];
  const currentPrice = num(analysis?.current_price) ?? num(analysis?.price) ?? latest?.close ?? null;
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const change = currentPrice !== null && previous ? currentPrice - previous.close : null;
  const changePct = change !== null && previous?.close ? (change / previous.close) * 100 : null;

  useEffect(() => {
    if (!priceRef.current || !volumeRef.current || !rows.length) return;

    priceRef.current.innerHTML = "";
    volumeRef.current.innerHTML = "";

    const common = {
      layout: { background: { color: "#ffffff" }, textColor: "#667085" },
      grid: { vertLines: { color: "#edf1f5" }, horzLines: { color: "#edf1f5" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.12, bottom: 0.12 }, autoScale: true },
      timeScale: { borderColor: "#e5e7eb", timeVisible: true, secondsVisible: false },
      localization: { priceFormatter: (price) => `₹${Number(price).toFixed(2)}` },
      crosshair: { vertLine: { color: "#98a2b3", width: 1 }, horzLine: { color: "#98a2b3", width: 1 } },
    };

    const priceChart = createChart(priceRef.current, {
      ...common,
      width: priceRef.current.clientWidth,
      height: 470,
    });

    const volumeChart = createChart(volumeRef.current, {
      ...common,
      width: volumeRef.current.clientWidth,
      height: 115,
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.15, bottom: 0 } },
    });

    let candleSeries;
    if (String(chartType).toUpperCase() === "CANDLE") {
      candleSeries = priceChart.addSeries(CandlestickSeries, {
        upColor: GREEN,
        downColor: RED,
        borderUpColor: GREEN,
        borderDownColor: RED,
        wickUpColor: GREEN,
        wickDownColor: RED,
        priceLineVisible: true,
        lastValueVisible: true,
        priceLineWidth: 1,
        priceLineStyle: 2,
      });
      candleSeries.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    } else {
      candleSeries = priceChart.addSeries(LineSeries, { color: BLUE, lineWidth: 2, priceLineVisible: true });
      candleSeries.setData(rows.map(({ time, close }) => ({ time, value: close })));
    }

    const addLine = (key, color, width = 2, style = 0) => {
      const points = rows.filter((r) => Number.isFinite(r[key])).map((r) => ({ time: r.time, value: r[key] }));
      if (!points.length) return;
      const s = priceChart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: true,
        // Candles control the visible price range. Indicators are overlays only.
        autoscaleInfoProvider: () => null,
      });
      s.setData(points);
    };

    addLine("ema9", ORANGE, 2);
    addLine("ema20", BLUE, 2);
    addLine("vwap", PURPLE, 2, 2);

    const addLevel = (price, title, color) => {
      if (!Number.isFinite(price) || !candleSeries?.createPriceLine) return;
      candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title });
    };

    addLevel(entry, "ENTRY", BLUE);
    addLevel(stop, "SL", RED);
    addLevel(t1, "T1", GREEN);
    addLevel(t2, "T2", "#15803d");

    const volumeSeries = volumeChart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: true });
    volumeSeries.setData(rows.filter((r) => Number.isFinite(r.volume)).map((r) => ({ time: r.time, value: r.volume, color: r.close >= r.open ? "rgba(0,179,134,.65)" : "rgba(235,91,60,.65)" })));

    const selectedTrades = (Array.isArray(trades) ? trades : []).filter((t) => String(t?.symbol || "").toUpperCase() === selected);
    if (selectedTrades.length && candleSeries && String(chartType).toUpperCase() === "CANDLE") {
      const markers = selectedTrades.map((trade) => {
        const side = String(trade?.side || "").toUpperCase();
        const action = String(trade?.action || "").toUpperCase();
        const exit = action.includes("EXIT") || action.includes("CLOSE") || action.includes("TARGET") || action.includes("STOP");
        return {
          time: toUnix(trade?.timestamp, rows[rows.length - 1].time),
          position: exit || side === "SELL" ? "aboveBar" : "belowBar",
          color: exit ? ORANGE : side === "BUY" ? GREEN : RED,
          shape: exit || side === "SELL" ? "arrowDown" : "arrowUp",
          text: exit ? "EXIT" : side || "TRADE",
        };
      }).sort((a, b) => a.time - b.time);
      try { createSeriesMarkers(candleSeries, markers); } catch (_) {}
    }

    priceChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
    priceChart.timeScale().applyOptions({ barSpacing: 8, minBarSpacing: 4, rightOffset: 3 });
    volumeChart.timeScale().applyOptions({ barSpacing: 8, minBarSpacing: 4, rightOffset: 3 });

    let syncing = false;
    const syncPrice = (range) => {
      if (!range || syncing) return;
      syncing = true;
      volumeChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    const syncVolume = (range) => {
      if (!range || syncing) return;
      syncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    };
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(syncPrice);
    volumeChart.timeScale().subscribeVisibleLogicalRangeChange(syncVolume);

    const resize = () => {
      if (priceRef.current) priceChart.applyOptions({ width: priceRef.current.clientWidth });
      if (volumeRef.current) volumeChart.applyOptions({ width: volumeRef.current.clientWidth });
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      priceChart.remove();
      volumeChart.remove();
    };
  }, [rows, chartType, entry, stop, t1, t2, trades, selected]);

  const patterns = patternsFrom(analysis);
  const reasons = Array.isArray(analysis?.reasons) ? analysis.reasons : [];
  const signal = String(analysis?.signal || "NO TRADE").toUpperCase();

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", borderBottom: "1px solid #e5e7eb" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#172b4d" }}>{selected || "Selected Stock"}</div>
          <div style={{ color: "#667085", fontSize: 12, marginTop: 3 }}>NSE • Intraday • {interval} • Candles</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#172b4d" }}>{money(currentPrice)}</div>
          <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: change === null || change >= 0 ? GREEN : RED }}>
            {change === null ? "Latest price" : `${change >= 0 ? "+" : ""}${money(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`}
            <span style={{ marginLeft: 12, color: live ? GREEN : "#667085" }}>{live ? "● LIVE" : "Market closed"}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "9px 18px", display: "flex", gap: 18, flexWrap: "wrap", borderBottom: "1px solid #e5e7eb", fontSize: 12, fontWeight: 700 }}>
        <span style={{ color: ORANGE }}>— EMA 9</span>
        <span style={{ color: BLUE }}>— EMA 20</span>
        <span style={{ color: PURPLE }}>--- VWAP</span>
        <span>Entry {money(entry)}</span>
        <span style={{ color: RED }}>SL {money(stop)}</span>
        <span style={{ color: GREEN }}>T1 {money(t1)}</span>
        <span style={{ color: "#15803d" }}>T2 {money(t2)}</span>
      </div>

      <div ref={priceRef} style={{ width: "100%", height: 470 }} />
      <div style={{ padding: "6px 16px 0", fontSize: 12, fontWeight: 800, color: "#344054", borderTop: "1px solid #f0f2f5" }}>Volume</div>
      <div ref={volumeRef} style={{ width: "100%", height: 115 }} />

      <div style={{ padding: 16, background: "#fafbfc", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 15 }}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Technical setup</div>
          <div style={{ lineHeight: 1.8, fontSize: 13 }}>
            <div><b>Candle pattern:</b> {patterns.length ? patterns.map((p) => p?.name || p).join(", ") : "No strong pattern"}</div>
            <div><b>5m trend:</b> {String(analysis?.chart_direction ?? analysis?.chart_analysis?.direction ?? "—").toUpperCase()}</div>
            <div><b>15m trend:</b> {String(analysis?.trend_15m ?? analysis?.chart_analysis_15m?.direction ?? "—").toUpperCase()}</div>
            <div><b>Structure:</b> {analysis?.chart_analysis?.structure || "—"}</div>
            <div><b>VWAP:</b> {money(analysis?.vwap)}</div>
            <div><b>EMA 9:</b> {money(analysis?.ema9)}</div>
            <div><b>EMA 20:</b> {money(analysis?.ema20)}</div>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 15 }}>
          <div style={{ fontWeight: 800 }}>Trade suggestion</div>
          <div style={{ display: "inline-block", marginTop: 10, padding: "7px 12px", borderRadius: 7, fontWeight: 900, color: signal === "BUY" ? GREEN : signal === "SELL" ? RED : "#667085", background: signal === "BUY" ? "#e8f8f3" : signal === "SELL" ? "#fff0ed" : "#f2f4f7" }}>{signal}</div>
          <div style={{ marginTop: 12, lineHeight: 1.8, fontSize: 13 }}>
            <div><b>Entry:</b> {money(entry)}</div><div><b>Stop loss:</b> {money(stop)}</div><div><b>Target 1:</b> {money(t1)}</div><div><b>Target 2:</b> {money(t2)}</div>
          </div>
          <div style={{ marginTop: 12, fontWeight: 800, fontSize: 13 }}>Why this setup?</div>
          {reasons.length ? <ul style={{ margin: "7px 0 0", paddingLeft: 20, lineHeight: 1.7, fontSize: 12, color: "#475467" }}>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : <div style={{ marginTop: 7, fontSize: 12, color: "#667085" }}>No setup reasons returned by the backend.</div>}
        </div>
      </div>
    </div>
  );
}
