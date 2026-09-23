import React, { useEffect, useMemo, useRef, useState } from "react";
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
  return (
    row?.datetime ??
    row?.Datetime ??
    row?.timestamp ??
    row?.time ??
    row?.date ??
    row?.Date ??
    null
  );
}

function toUnix(value, fallback) {
  if (!value) return fallback;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

function money(v) {
  const x = num(v);
  return x === null
    ? "—"
    : `₹${x.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function volumeText(v) {
  const x = num(v);
  if (x === null) return "—";
  return x.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatCandleTime(unixTime) {
  const x = Number(unixTime);
  if (!Number.isFinite(x)) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(x * 1000));
}

function patternsFrom(analysis) {
  const detailed = analysis?.chart_analysis?.candlestick_patterns;
  if (Array.isArray(detailed) && detailed.length) return detailed;

  if (Array.isArray(analysis?.candle_patterns)) {
    return analysis.candle_patterns.map((name) => ({ name }));
  }

  return [];
}

const IST_TIME_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatAxisTimeIST(timestamp) {
  const x = Number(timestamp);
  if (!Number.isFinite(x)) return "";
  return IST_TIME_FORMATTER.format(new Date(x * 1000));
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

  const [showEma9, setShowEma9] = useState(true);
  const [showEma20, setShowEma20] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [hoveredCandle, setHoveredCandle] = useState(null);
  const [selectedCandle, setSelectedCandle] = useState(null);
  const [visibleBars, setVisibleBars] = useState(80);
  const [scrollStart, setScrollStart] = useState(0);
  const [showPatternMarkers, setShowPatternMarkers] = useState(true);
  const savedLogicalRangeRef = useRef(null);
  const applyingRangeRef = useRef(false);

  const rows = useMemo(() => {
    const source = Array.isArray(data) ? data : [];
    const base = Math.floor(Date.now() / 1000) - source.length * 300;

    return source
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
          patterns: Array.isArray(row?.patterns) ? row.patterns : [],
          patternStatus: row?.pattern_status || null,
          patternTechnicalExecutable:
            row?.pattern_technical_executable === true,
        };
      })
      .filter((r) =>
        [r.open, r.high, r.low, r.close].every(Number.isFinite)
      )
      .sort((a, b) => a.time - b.time)
      .filter((r, i, a) => i === 0 || r.time !== a[i - 1].time)
      .slice(-1200)
      .map((r) => {
        // Ignore broken provider indicator values (for example VWAP=0)
        // so they cannot destroy the candle price scale.
        const mid = (r.high + r.low) / 2;
        const validIndicator = (value) =>
          Number.isFinite(value) &&
          value > 0 &&
          Number.isFinite(mid) &&
          Math.abs(value - mid) <=
            Math.max(mid * 0.15, (r.high - r.low) * 25);

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
  const t1 =
    num(position?.exit_target) ??
    num(analysis?.target_1) ??
    num(analysis?.target1);
  const t2 = num(analysis?.target_2) ?? num(analysis?.target2);

  const latest = rows[rows.length - 1];
  const currentPrice =
    num(analysis?.current_price) ??
    num(analysis?.price) ??
    latest?.close ??
    null;

  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  const change =
    currentPrice !== null && previous
      ? currentPrice - previous.close
      : null;
  const changePct =
    change !== null && previous?.close
      ? (change / previous.close) * 100
      : null;

  const displayCandle = selectedCandle || hoveredCandle || latest || null;
  const displayPatterns = Array.isArray(displayCandle?.patterns)
    ? displayCandle.patterns
    : [];
  const livePattern = analysis?.live_pattern_analysis || null;

  useEffect(() => {
    if (!priceRef.current || !volumeRef.current || !rows.length) return;

    priceRef.current.innerHTML = "";
    volumeRef.current.innerHTML = "";

    const rowByTime = new Map(rows.map((row) => [Number(row.time), row]));

    const common = {
      layout: {
        background: { color: "#ffffff" },
        textColor: "#667085",
      },
      grid: {
        vertLines: { color: "#edf1f5" },
        horzLines: { color: "#edf1f5" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.12, bottom: 0.12 },
        autoScale: true,
      },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => formatAxisTimeIST(time),
      },
      localization: {
        priceFormatter: (price) => `₹${Number(price).toFixed(2)}`,
        timeFormatter: (time) => formatAxisTimeIST(time),
      },
      crosshair: {
        vertLine: {
          color: "#98a2b3",
          width: 1,
          labelVisible: true,
        },
        horzLine: {
          color: "#98a2b3",
          width: 1,
          labelVisible: true,
        },
      },
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
      rightPriceScale: {
        borderColor: "#e5e7eb",
        scaleMargins: { top: 0.15, bottom: 0 },
      },
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

      candleSeries.setData(
        rows.map(({ time, open, high, low, close }) => ({
          time,
          open,
          high,
          low,
          close,
        }))
      );
    } else {
      candleSeries = priceChart.addSeries(LineSeries, {
        color: BLUE,
        lineWidth: 2,
        priceLineVisible: true,
        lastValueVisible: true,
      });

      candleSeries.setData(
        rows.map(({ time, close }) => ({
          time,
          value: close,
        }))
      );
    }

    const addLine = (key, color, width = 2, style = 0) => {
      const points = rows
        .filter((r) => Number.isFinite(r[key]))
        .map((r) => ({
          time: r.time,
          value: r[key],
        }));

      if (!points.length) return null;

      const series = priceChart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: true,
        autoscaleInfoProvider: () => null,
      });

      series.setData(points);
      return series;
    };

    if (showEma9) addLine("ema9", ORANGE, 2);
    if (showEma20) addLine("ema20", BLUE, 2);

    // VWAP can be shown or hidden independently from EMA 9 and EMA 20.
    if (showVwap) addLine("vwap", PURPLE, 2, 2);

    const addLevel = (price, title, color) => {
      if (!Number.isFinite(price) || !candleSeries?.createPriceLine) return;

      candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title,
      });
    };

    addLevel(entry, "ENTRY", BLUE);
    addLevel(stop, "SL", RED);
    addLevel(t1, "T1", GREEN);
    addLevel(t2, "T2", "#15803d");

    const volumeSeries = volumeChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: true,
    });

    volumeSeries.setData(
      rows
        .filter((r) => Number.isFinite(r.volume))
        .map((r) => ({
          time: r.time,
          value: r.volume,
          color:
            r.close >= r.open
              ? "rgba(0,179,134,.65)"
              : "rgba(235,91,60,.65)",
        }))
    );

    const selectedTrades = (Array.isArray(trades) ? trades : []).filter(
      (t) => String(t?.symbol || "").toUpperCase() === selected
    );

    if (candleSeries && String(chartType).toUpperCase() === "CANDLE") {
      const patternMarkers = showPatternMarkers
        ? rows.flatMap((row) => {
        const candlePatterns = Array.isArray(row.patterns) ? row.patterns : [];

        return candlePatterns
          .filter((pattern) => {
            const direction = String(pattern?.direction || "").toUpperCase();
            const forming =
              String(pattern?.status || "").toUpperCase() === "FORMING";

            // Keep the chart clean:
            // 1) show the current forming pattern live, or
            // 2) show only confirmed historical patterns that passed the
            //    technical execution-context filter.
            return (
              (direction === "BULLISH" || direction === "BEARISH") &&
              (forming || pattern?.technical_executable === true)
            );
          })
          .map((pattern) => {
            const direction = String(pattern?.direction || "").toUpperCase();
            const forming = String(pattern?.status || "").toUpperCase() === "FORMING";
            const executable = pattern?.technical_executable === true;

            return {
              time: row.time,
              position: direction === "BULLISH" ? "belowBar" : "aboveBar",
              color: forming
                ? ORANGE
                : executable
                  ? direction === "BULLISH"
                    ? GREEN
                    : RED
                  : "#667085",
              shape: direction === "BULLISH" ? "arrowUp" : "arrowDown",
              text: forming
                ? `${String(pattern?.name || "PATTERN").replaceAll("_", " ")} • FORMING`
                : `${String(pattern?.name || "PATTERN").replaceAll("_", " ")} • EXEC`,
            };
          });
      })
        : [];

      const tradeMarkers = selectedTrades.map((trade) => {
        const side = String(trade?.side || "").toUpperCase();
        const action = String(trade?.action || "").toUpperCase();
        const exit =
          action.includes("EXIT") ||
          action.includes("CLOSE") ||
          action.includes("TARGET") ||
          action.includes("STOP");

        return {
          time: toUnix(trade?.timestamp, rows[rows.length - 1].time),
          position: exit || side === "SELL" ? "aboveBar" : "belowBar",
          color: exit ? ORANGE : side === "BUY" ? GREEN : RED,
          shape: exit || side === "SELL" ? "arrowDown" : "arrowUp",
          text: exit ? "EXIT" : side || "TRADE",
        };
      });

      const markers = [...patternMarkers, ...tradeMarkers].sort(
        (a, b) => a.time - b.time
      );

      if (markers.length) {
        try {
          createSeriesMarkers(candleSeries, markers);
        } catch (_) {
          // Keep chart usable if a marker timestamp is outside loaded data.
        }
      }
    }

    // Show values for the exact candle under the mouse crosshair.
    const crosshairHandler = (param) => {
      if (!param?.time) {
        setHoveredCandle(null);
        return;
      }

      const key =
        typeof param.time === "number"
          ? Number(param.time)
          : null;

      if (key !== null && rowByTime.has(key)) {
        setHoveredCandle(rowByTime.get(key));
      } else {
        setHoveredCandle(null);
      }
    };

    priceChart.subscribeCrosshairMove(crosshairHandler);

    // Clicking a candle locks its OHLC/volume/indicator values in the
    // information bar until another candle is clicked.
    const clickHandler = (param) => {
      if (!param?.time) return;

      const key =
        typeof param.time === "number"
          ? Number(param.time)
          : null;

      if (key !== null && rowByTime.has(key)) {
        setSelectedCandle(rowByTime.get(key));
      }
    };

    priceChart.subscribeClick(clickHandler);

    // Easy candle viewing: start from the LEFT and show a readable number
    // of candles instead of squeezing the whole session into tiny candles.
    const totalBars = rows.length;
    const barsToShow =
      visibleBars === 0
        ? totalBars
        : Math.min(Math.max(visibleBars, 10), totalBars);

    if (totalBars > 0) {
      const maxStart = Math.max(totalBars - barsToShow, 0);
      const centeredStart = Math.floor(maxStart / 2);
      const requestedStart =
        scrollStart === 0 ? centeredStart : scrollStart;
      const start = Math.min(Math.max(requestedStart, 0), maxStart);
      const end = Math.min(start + barsToShow - 1, totalBars - 1);

      const saved = savedLogicalRangeRef.current;
      const rangeToApply =
        saved &&
        Number.isFinite(saved.from) &&
        Number.isFinite(saved.to) &&
        saved.to > saved.from
          ? saved
          : { from: start, to: end };

      applyingRangeRef.current = true;
      priceChart.timeScale().setVisibleLogicalRange(rangeToApply);
      volumeChart.timeScale().setVisibleLogicalRange(rangeToApply);
      applyingRangeRef.current = false;
    }

    priceChart.timeScale().applyOptions({
      rightOffset: 0,
      fixLeftEdge: false,
      fixRightEdge: false,
      barSpacing: 9,
      minBarSpacing: 4,
    });

    volumeChart.timeScale().applyOptions({
      rightOffset: 0,
      fixLeftEdge: false,
      fixRightEdge: false,
      barSpacing: 9,
      minBarSpacing: 4,
    });

    // applyOptions(barSpacing) can alter the viewport. Restore the saved
    // manual zoom once more after all time-scale options have been applied.
    if (savedLogicalRangeRef.current) {
      applyingRangeRef.current = true;
      priceChart.timeScale().setVisibleLogicalRange(savedLogicalRangeRef.current);
      volumeChart.timeScale().setVisibleLogicalRange(savedLogicalRangeRef.current);
      applyingRangeRef.current = false;
    }

    let syncing = false;

    const syncPrice = (range) => {
      if (!range || syncing) return;

      if (
        !applyingRangeRef.current &&
        Number.isFinite(range.from) &&
        Number.isFinite(range.to) &&
        range.to > range.from
      ) {
        savedLogicalRangeRef.current = {
          from: range.from,
          to: range.to,
        };
      }

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
      if (priceRef.current) {
        priceChart.applyOptions({
          width: priceRef.current.clientWidth,
        });
      }

      if (volumeRef.current) {
        volumeChart.applyOptions({
          width: volumeRef.current.clientWidth,
        });
      }
    };

    window.addEventListener("resize", resize);

    return () => {
      // Save the exact user zoom/pan before this chart instance is destroyed
      // by a live-data refresh. The next instance restores this range.
      try {
        const currentRange = priceChart.timeScale().getVisibleLogicalRange();
        if (
          currentRange &&
          Number.isFinite(currentRange.from) &&
          Number.isFinite(currentRange.to) &&
          currentRange.to > currentRange.from
        ) {
          savedLogicalRangeRef.current = {
            from: currentRange.from,
            to: currentRange.to,
          };
        }
      } catch (_) {}

      window.removeEventListener("resize", resize);
      try {
        priceChart.unsubscribeCrosshairMove(crosshairHandler);
        priceChart.unsubscribeClick(clickHandler);
      } catch (_) {}
      priceChart.remove();
      volumeChart.remove();
    };
  }, [
    rows,
    chartType,
    entry,
    stop,
    t1,
    t2,
    trades,
    selected,
    showEma9,
    showEma20,
    showVwap,
    visibleBars,
    scrollStart,
    showPatternMarkers,
  ]);

  const patterns = patternsFrom(analysis);
  const reasons = Array.isArray(analysis?.reasons) ? analysis.reasons : [];
  const signal = String(analysis?.signal || "NO TRADE").toUpperCase();

  const toggleStyle = (enabled, color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 10px",
    borderRadius: 7,
    border: `1px solid ${enabled ? color : "#d0d5dd"}`,
    background: enabled ? "#ffffff" : "#f9fafb",
    color: enabled ? color : "#98a2b3",
    fontWeight: 800,
    cursor: "pointer",
    userSelect: "none",
  });

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 18px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#172b4d",
            }}
          >
            {selected || "Selected Stock"}
          </div>

          <div
            style={{
              color: "#667085",
              fontSize: 12,
              marginTop: 3,
            }}
          >
            NSE • Intraday • {interval} •{" "}
            {String(chartType).toUpperCase() === "CANDLE"
              ? "Candles"
              : "Line"}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#172b4d",
            }}
          >
            {money(currentPrice)}
          </div>

          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              fontWeight: 700,
              color: change === null || change >= 0 ? GREEN : RED,
            }}
          >
            {change === null
              ? "Latest price"
              : `${change >= 0 ? "+" : ""}${money(change)} (${
                  changePct >= 0 ? "+" : ""
                }${changePct.toFixed(2)}%)`}

            <span
              style={{
                marginLeft: 12,
                color: live ? GREEN : "#667085",
              }}
            >
              {live ? "● LIVE" : "Market closed"}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "9px 18px",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          borderBottom: "1px solid #e5e7eb",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <button
          type="button"
          onClick={() => setShowEma9((value) => !value)}
          style={toggleStyle(showEma9, ORANGE)}
          title="Show or hide EMA 9"
        >
          <span>{showEma9 ? "✓" : "○"}</span>
          EMA 9
        </button>

        <button
          type="button"
          onClick={() => setShowEma20((value) => !value)}
          style={toggleStyle(showEma20, BLUE)}
          title="Show or hide EMA 20"
        >
          <span>{showEma20 ? "✓" : "○"}</span>
          EMA 20
        </button>

          <button
            type="button"
            onClick={() => setShowPatternMarkers((value) => !value)}
            style={{
              border: showPatternMarkers
                ? "1px solid #7f56d9"
                : "1px solid #d0d5dd",
              background: showPatternMarkers ? "#f4f3ff" : "#ffffff",
              color: showPatternMarkers ? "#6941c6" : "#667085",
              borderRadius: 7,
              padding: "5px 9px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
            }}
            title="Show or hide Morning Star, Hammer, Engulfing and other candle-pattern markers"
          >
            Patterns {showPatternMarkers ? "ON" : "OFF"}
          </button>

        <button
          type="button"
          onClick={() => setShowVwap((value) => !value)}
          style={toggleStyle(showVwap, PURPLE)}
          title="Show or hide VWAP"
        >
          <span>{showVwap ? "✓" : "○"}</span>
          VWAP
        </button>
        <span>Entry {money(entry)}</span>
        <span style={{ color: RED }}>SL {money(stop)}</span>
        <span style={{ color: GREEN }}>T1 {money(t1)}</span>
        <span style={{ color: "#15803d" }}>T2 {money(t2)}</span>
      </div>

      <div
        style={{
          padding: "8px 18px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          borderBottom: "1px solid #e5e7eb",
          background: "#ffffff",
        }}
      >
        <strong style={{ fontSize: 12, color: "#475467" }}>Candle view:</strong>
        {[
          [40, "40"],
          [80, "80"],
          [120, "120"],
          [0, "All"],
        ].map(([value, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              savedLogicalRangeRef.current = null;
              setVisibleBars(value);
              setScrollStart(0);
            }}
            style={{
              padding: "5px 11px",
              borderRadius: 7,
              border:
                visibleBars === value
                  ? "1px solid #2563eb"
                  : "1px solid #d0d5dd",
              background: visibleBars === value ? "#eff6ff" : "#ffffff",
              color: visibleBars === value ? "#1d4ed8" : "#475467",
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "#667085" }}>
          40 = larger candles · 80 = normal · 120 = more candles · All = full session
        </span>
      </div>

      <div
        style={{
          minHeight: 45,
          padding: "8px 18px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
          background: "#f8fafc",
          borderBottom: "1px solid #e5e7eb",
          fontSize: 12,
        }}
      >
        <strong style={{ color: "#344054" }}>
          {selectedCandle
            ? "Selected candle"
            : hoveredCandle
              ? "Cursor candle"
              : "Latest candle"}
        </strong>

        <span style={{ color: "#667085" }}>
          {displayCandle ? formatCandleTime(displayCandle.time) : "—"}
        </span>

        {selectedCandle && (
          <button
            type="button"
            onClick={() => setSelectedCandle(null)}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid #d0d5dd",
              background: "#ffffff",
              color: "#667085",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}

        <span>
          O <b>{money(displayCandle?.open)}</b>
        </span>
        <span>
          H <b style={{ color: GREEN }}>{money(displayCandle?.high)}</b>
        </span>
        <span>
          L <b style={{ color: RED }}>{money(displayCandle?.low)}</b>
        </span>
        <span>
          C <b>{money(displayCandle?.close)}</b>
        </span>
        <span>
          Vol <b>{volumeText(displayCandle?.volume)}</b>
        </span>

        {showEma9 && (
          <span style={{ color: ORANGE }}>
            EMA9 <b>{money(displayCandle?.ema9)}</b>
          </span>
        )}

        {showEma20 && (
          <span style={{ color: BLUE }}>
            EMA20 <b>{money(displayCandle?.ema20)}</b>
          </span>
        )}

        {showVwap && (
          <span style={{ color: PURPLE }}>
            VWAP <b>{money(displayCandle?.vwap)}</b>
          </span>
        )}
      </div>

      <div
        style={{
          padding: "8px 18px 10px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 5,
            fontSize: 11,
          }}
        >
          <strong style={{ color: "#475467" }}>Time navigator</strong>
          <span style={{ color: "#667085" }}>
            Drag left / right to move through candles
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(
            rows.length -
              (visibleBars === 0
                ? rows.length
                : Math.min(Math.max(visibleBars, 10), rows.length)),
            0
          )}
          step={1}
          value={Math.min(
            scrollStart,
            Math.max(
              rows.length -
                (visibleBars === 0
                  ? rows.length
                  : Math.min(Math.max(visibleBars, 10), rows.length)),
              0
            )
          )}
          onChange={(event) => {
            savedLogicalRangeRef.current = null;
            setScrollStart(Number(event.target.value));
          }}
          disabled={visibleBars === 0 || rows.length <= visibleBars}
          aria-label="Chart time navigator"
          style={{
            width: "100%",
            cursor:
              visibleBars === 0 || rows.length <= visibleBars
                ? "default"
                : "ew-resize",
          }}
        />
      </div>

      <div ref={priceRef} style={{ width: "100%", height: 470 }} />

      <div
        style={{
          padding: "6px 16px 0",
          fontSize: 12,
          fontWeight: 800,
          color: "#344054",
          borderTop: "1px solid #f0f2f5",
        }}
      >
        Volume
      </div>

      <div ref={volumeRef} style={{ width: "100%", height: 115 }} />

      <div
        style={{
          margin: "12px 16px 0",
          padding: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          background: "#ffffff",
          fontSize: 13,
          lineHeight: 1.7,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 5 }}>
          Live candle-pattern monitor
        </div>
        <div>
          <b>Latest pattern:</b>{" "}
          {Array.isArray(livePattern?.patterns) && livePattern.patterns.length
            ? livePattern.patterns
                .map((p) => String(p?.name || p).replaceAll("_", " "))
                .join(", ")
            : "No strong pattern"}
        </div>
        <div>
          <b>Status:</b>{" "}
          {livePattern?.status || "—"}
        </div>
        <div>
          <b>Trade executable:</b>{" "}
          {livePattern?.executable === true
            ? "YES"
            : livePattern?.status === "FORMING"
              ? "WAIT FOR CANDLE CLOSE"
              : "NO"}
        </div>
        <div style={{ color: "#667085" }}>
          {livePattern?.message || "Waiting for live pattern analysis."}
        </div>

        {displayPatterns.length > 0 && (
          <div
            style={{
              marginTop: 9,
              paddingTop: 9,
              borderTop: "1px dashed #d0d5dd",
            }}
          >
            <b>Selected candle pattern:</b>{" "}
            {displayPatterns
              .map((p) => String(p?.name || p).replaceAll("_", " "))
              .join(", ")}
            {" • "}
            <b>Status:</b>{" "}
            {displayPatterns.some((p) => p?.status === "FORMING")
              ? "FORMING"
              : "CONFIRMED"}
            {" • "}
            <b>Historical technical setup:</b>{" "}
            {displayPatterns.some((p) => p?.technical_executable === true)
              ? "YES"
              : "NO"}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 16,
          background: "#fafbfc",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 15,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 10 }}>
            Technical setup
          </div>

          <div style={{ lineHeight: 1.8, fontSize: 13 }}>
            <div>
              <b>Candle pattern:</b>{" "}
              {patterns.length
                ? patterns.map((p) => p?.name || p).join(", ")
                : "No strong pattern"}
            </div>

            <div>
              <b>5m trend:</b>{" "}
              {String(
                analysis?.chart_direction ??
                  analysis?.chart_analysis?.direction ??
                  "—"
              ).toUpperCase()}
            </div>

            <div>
              <b>15m trend:</b>{" "}
              {String(
                analysis?.trend_15m ??
                  analysis?.chart_analysis_15m?.direction ??
                  "—"
              ).toUpperCase()}
            </div>

            <div>
              <b>Structure:</b>{" "}
              {analysis?.chart_analysis?.structure || "—"}
            </div>

            <div>
              <b>VWAP:</b> {money(analysis?.vwap)}
            </div>

            <div>
              <b>EMA 9:</b> {money(analysis?.ema9)}
            </div>

            <div>
              <b>EMA 20:</b> {money(analysis?.ema20)}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 15,
          }}
        >
          <div style={{ fontWeight: 800 }}>Trade suggestion</div>

          <div
            style={{
              display: "inline-block",
              marginTop: 10,
              padding: "7px 12px",
              borderRadius: 7,
              fontWeight: 900,
              color:
                signal === "BUY"
                  ? GREEN
                  : signal === "SELL"
                    ? RED
                    : "#667085",
              background:
                signal === "BUY"
                  ? "#e8f8f3"
                  : signal === "SELL"
                    ? "#fff0ed"
                    : "#f2f4f7",
            }}
          >
            {signal}
          </div>

          <div style={{ marginTop: 12, lineHeight: 1.8, fontSize: 13 }}>
            <div>
              <b>Entry:</b> {money(entry)}
            </div>
            <div>
              <b>Stop loss:</b> {money(stop)}
            </div>
            <div>
              <b>Target 1:</b> {money(t1)}
            </div>
            <div>
              <b>Target 2:</b> {money(t2)}
            </div>
          </div>

          <div style={{ marginTop: 12, fontWeight: 800, fontSize: 13 }}>
            Why this setup?
          </div>

          {reasons.length ? (
            <ul
              style={{
                margin: "7px 0 0",
                paddingLeft: 20,
                lineHeight: 1.7,
                fontSize: 12,
                color: "#475467",
              }}
            >
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <div
              style={{
                marginTop: 7,
                fontSize: 12,
                color: "#667085",
              }}
            >
              No setup reasons returned by the backend.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
