import React, { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) {
      const value = numberValue(row[key]);
      if (value !== null) return value;
    }
  }
  return null;
}

function getRawTime(row) {
  return (
    row?.datetime ??
    row?.Datetime ??
    row?.date ??
    row?.Date ??
    row?.timestamp ??
    row?.time ??
    ""
  );
}

function getTimeLabel(row, index) {
  const raw = getRawTime(row);
  if (!raw) return String(index + 1);

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw);

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";

  return `₹${parsed.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatVolume(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";

  return parsed.toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  });
}

function CandleShape(props) {
  const { x, width, yAxis, payload } = props;

  if (!payload || !yAxis?.scale) return null;

  const { open, high, low, close } = payload;

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  const scale = yAxis.scale;
  const highY = scale(high);
  const lowY = scale(low);
  const openY = scale(open);
  const closeY = scale(close);

  const centerX = x + width / 2;
  const candleWidth = Math.max(3, Math.min(12, width * 0.68));
  const bodyX = centerX - candleWidth / 2;
  const bodyY = Math.min(openY, closeY);
  const bodyHeight = Math.max(2, Math.abs(closeY - openY));

  const rising = close >= open;
  const candleColor = rising ? "#16a34a" : "#dc2626";
  const candleFill = rising ? "#bbf7d0" : "#fecaca";

  return (
    <g>
      <line
        x1={centerX}
        x2={centerX}
        y1={highY}
        y2={lowY}
        stroke={candleColor}
        strokeWidth={1.4}
      />

      <rect
        x={bodyX}
        y={bodyY}
        width={candleWidth}
        height={bodyHeight}
        fill={candleFill}
        stroke={candleColor}
        strokeWidth={1.4}
      />
    </g>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 6px 22px rgba(15, 23, 42, 0.15)",
        fontSize: 12,
        lineHeight: 1.6,
        minWidth: 190,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 5 }}>
        {row.label}
      </div>

      <div>Open: <strong>{money(row.open)}</strong></div>
      <div>High: <strong>{money(row.high)}</strong></div>
      <div>Low: <strong>{money(row.low)}</strong></div>
      <div>Close: <strong>{money(row.close)}</strong></div>

      {Number.isFinite(row.volume) && (
        <div>Volume: <strong>{formatVolume(row.volume)}</strong></div>
      )}

      {Number.isFinite(row.vwap) && (
        <div>VWAP: <strong>{money(row.vwap)}</strong></div>
      )}

      {Number.isFinite(row.ema9) && (
        <div>EMA 9: <strong>{money(row.ema9)}</strong></div>
      )}

      {Number.isFinite(row.ema20) && (
        <div>EMA 20: <strong>{money(row.ema20)}</strong></div>
      )}
    </div>
  );
}

function LevelLabel({ viewBox, text, fill = "#0f172a" }) {
  const { x, y, width } = viewBox || {};

  if (![x, y, width].every(Number.isFinite)) return null;

  return (
    <g>
      <rect
        x={x + width - 112}
        y={y - 10}
        width={108}
        height={20}
        rx={5}
        fill={fill}
      />
      <text
        x={x + width - 58}
        y={y + 4}
        textAnchor="middle"
        fontSize={10}
        fontWeight={800}
        fill="#ffffff"
      >
        {text}
      </text>
    </g>
  );
}

function MarkerLabel({ viewBox, text, fill }) {
  const { x, y } = viewBox || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return (
    <g>
      <rect
        x={x - 44}
        y={y - 28}
        width={88}
        height={20}
        rx={5}
        fill={fill}
      />
      <text
        x={x}
        y={y - 14}
        textAnchor="middle"
        fontSize={10}
        fontWeight={900}
        fill="#ffffff"
      >
        {text}
      </text>
    </g>
  );
}

function findNearestLabel(chartData, timestamp) {
  if (!timestamp || !chartData.length) return null;

  const target = new Date(timestamp).getTime();
  if (!Number.isFinite(target)) return null;

  let best = null;
  let bestDistance = Infinity;

  chartData.forEach((row) => {
    const raw = getRawTime(row);
    const current = new Date(raw).getTime();

    if (!Number.isFinite(current)) return;

    const distance = Math.abs(current - target);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = row.label;
    }
  });

  return best;
}

function normalizePatterns(analysis) {
  const detailed = analysis?.chart_analysis?.candlestick_patterns;

  if (Array.isArray(detailed) && detailed.length) {
    return detailed.map((pattern) => ({
      name: pattern?.name || "Pattern",
      direction: String(pattern?.direction || "NEUTRAL").toUpperCase(),
      strength: numberValue(pattern?.strength),
    }));
  }

  const names = analysis?.candle_patterns;

  if (Array.isArray(names)) {
    return names.map((name) => ({
      name,
      direction: "NEUTRAL",
      strength: null,
    }));
  }

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
  const chartData = useMemo(
    () =>
      (Array.isArray(data) ? data : [])
        .map((row, index) => ({
          ...row,
          label: getTimeLabel(row, index),
          open: getValue(row, ["open", "Open"]),
          high: getValue(row, ["high", "High"]),
          low: getValue(row, ["low", "Low"]),
          close: getValue(row, ["close", "Close"]),
          volume: getValue(row, ["volume", "Volume"]),
          vwap: getValue(row, ["vwap", "VWAP"]),
          ema9: getValue(row, ["ema9", "EMA9", "ema_9"]),
          ema20: getValue(row, ["ema20", "EMA20", "ema_20"]),
        }))
        .filter(
          (row) =>
            Number.isFinite(row.open) &&
            Number.isFinite(row.high) &&
            Number.isFinite(row.low) &&
            Number.isFinite(row.close)
        ),
    [data]
  );

  const selectedSymbol = String(symbol || analysis?.symbol || "").toUpperCase();

  const currentPosition = useMemo(
    () =>
      (Array.isArray(positions) ? positions : []).find(
        (position) =>
          String(position?.symbol || "").toUpperCase() === selectedSymbol
      ) || null,
    [positions, selectedSymbol]
  );

  const selectedTrades = useMemo(
    () =>
      (Array.isArray(trades) ? trades : [])
        .filter(
          (trade) =>
            String(trade?.symbol || "").toUpperCase() === selectedSymbol
        )
        .slice(0, 12),
    [trades, selectedSymbol]
  );

  const domain = useMemo(() => {
    if (!chartData.length) return ["auto", "auto"];

    const values = [];

    chartData.forEach((row) => {
      values.push(row.low, row.high);
    });

    [
      analysis?.current_price,
      analysis?.price,
      analysis?.entry_price,
      analysis?.stop_loss,
      analysis?.target_1,
      analysis?.target1,
      analysis?.target_2,
      analysis?.target2,
      analysis?.support,
      analysis?.resistance,
      currentPosition?.average_price,
      currentPosition?.stop_loss,
      currentPosition?.exit_target,
    ].forEach((value) => {
      const parsed = numberValue(value);
      if (parsed !== null) values.push(parsed);
    });

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return ["auto", "auto"];
    }

    const range = Math.max(max - min, Math.abs(max) * 0.005, 1);
    const padding = range * 0.1;

    return [Math.max(0, min - padding), max + padding];
  }, [chartData, analysis, currentPosition]);

  if (!chartData.length) {
    return (
      <div
        style={{
          padding: 35,
          textAlign: "center",
          color: "#64748b",
          background: "#f8fafc",
          borderRadius: 10,
        }}
      >
        No chart data available.
      </div>
    );
  }

  const latest = chartData[chartData.length - 1];
  const previous = chartData.length > 1 ? chartData[chartData.length - 2] : null;

  const candleChange =
    previous && Number.isFinite(previous.close) && previous.close !== 0
      ? ((latest.close - previous.close) / previous.close) * 100
      : null;

  const currentPrice =
    numberValue(analysis?.current_price) ??
    numberValue(analysis?.price) ??
    latest.close;

  const entry =
    numberValue(currentPosition?.average_price) ??
    numberValue(analysis?.entry_price);

  const stopLoss =
    numberValue(currentPosition?.stop_loss) ??
    numberValue(analysis?.stop_loss);

  const target1 =
    numberValue(currentPosition?.exit_target) ??
    numberValue(analysis?.target_1) ??
    numberValue(analysis?.target1);

  const target2 =
    numberValue(analysis?.target_2) ??
    numberValue(analysis?.target2);

  const support =
    numberValue(analysis?.support) ??
    numberValue(analysis?.chart_analysis?.support);

  const resistance =
    numberValue(analysis?.resistance) ??
    numberValue(analysis?.chart_analysis?.resistance);

  const signal = String(analysis?.signal || "NO TRADE").toUpperCase();
  const qualified =
    analysis?.qualified === true ||
    analysis?.strict_qualified === true ||
    analysis?.executable === true;

  const chartDirection = String(
    analysis?.chart_direction ??
      analysis?.chart_analysis?.direction ??
      "UNKNOWN"
  ).toUpperCase();

  const trend15m = String(
    analysis?.trend_15m ??
      analysis?.chart_analysis_15m?.direction ??
      "UNKNOWN"
  ).toUpperCase();

  const patterns = normalizePatterns(analysis);
  const reasons = Array.isArray(analysis?.reasons) ? analysis.reasons : [];
  const warnings = Array.isArray(analysis?.warnings) ? analysis.warnings : [];

  const tickEvery = Math.max(1, Math.ceil(chartData.length / 8));

  const signalBackground =
    signal === "BUY"
      ? "#dcfce7"
      : signal === "SELL"
      ? "#fee2e2"
      : signal === "WAIT"
      ? "#fef3c7"
      : "#f1f5f9";

  const signalColor =
    signal === "BUY"
      ? "#166534"
      : signal === "SELL"
      ? "#991b1b"
      : signal === "WAIT"
      ? "#92400e"
      : "#475569";

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            padding: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {selectedSymbol || "Stock"} • {interval}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, marginTop: 3 }}>
            {money(currentPrice)}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color:
                candleChange === null
                  ? "#64748b"
                  : candleChange >= 0
                  ? "#16a34a"
                  : "#dc2626",
            }}
          >
            {candleChange === null
              ? "Latest candle"
              : `${candleChange >= 0 ? "+" : ""}${candleChange.toFixed(
                  2
                )}% vs previous candle`}
          </div>
        </div>

        <div
          style={{
            padding: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: live ? "#f0fdf4" : "#f8fafc",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>Live Status</div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 900,
              marginTop: 5,
              color: live ? "#16a34a" : "#64748b",
            }}
          >
            {live ? "● LIVE CANDLES" : "MARKET CLOSED"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
            Selected stock refresh: ~15 sec
          </div>
        </div>

        <div
          style={{
            padding: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: signalBackground,
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Trade Suggestion
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 900,
              marginTop: 5,
              color: signalColor,
            }}
          >
            {qualified && ["BUY", "SELL"].includes(signal)
              ? `QUALIFIED ${signal}`
              : signal}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
            Score {analysis?.score ?? "—"} • R:R{" "}
            {numberValue(analysis?.risk_reward) !== null
              ? `1:${Number(analysis.risk_reward).toFixed(2)}`
              : "—"}
          </div>
        </div>

        <div
          style={{
            padding: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>Chart Context</div>
          <div style={{ marginTop: 5, fontSize: 13, fontWeight: 800 }}>
            5m: {chartDirection}
          </div>
          <div style={{ marginTop: 3, fontSize: 13, fontWeight: 800 }}>
            15m: {trend15m}
          </div>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          height: 500,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 10,
          padding: "10px 6px 4px 0",
          boxSizing: "border-box",
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{
              top: 22,
              right: 18,
              bottom: 12,
              left: 8,
            }}
          >
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />

            <XAxis
              dataKey="label"
              minTickGap={20}
              interval={tickEvery - 1}
              tick={{
                fontSize: 11,
                fill: "#64748b",
              }}
            />

            <YAxis
              domain={domain}
              orientation="right"
              width={88}
              tick={{
                fontSize: 11,
                fill: "#64748b",
              }}
              tickFormatter={(value) =>
                `₹${Number(value).toLocaleString("en-IN", {
                  maximumFractionDigits: 2,
                })}`
              }
            />

            <Tooltip content={<ChartTooltip />} />

            {chartType === "CANDLE" ? (
              <Line
                type="linear"
                dataKey="close"
                stroke="transparent"
                dot={<CandleShape />}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : (
              <Line
                type="monotone"
                dataKey="close"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}

            <Line
              type="monotone"
              dataKey="vwap"
              stroke="#7c3aed"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="ema9"
              stroke="#0f766e"
              strokeWidth={1.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            <Line
              type="monotone"
              dataKey="ema20"
              stroke="#c2410c"
              strokeWidth={1.2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            {Number.isFinite(currentPrice) && (
              <ReferenceLine
                y={currentPrice}
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={
                  <LevelLabel
                    text={`LIVE ${money(currentPrice)}`}
                    fill="#2563eb"
                  />
                }
              />
            )}

            {Number.isFinite(entry) && (
              <ReferenceLine
                y={entry}
                stroke="#0284c7"
                strokeWidth={1.4}
                strokeDasharray="6 3"
                label={
                  <LevelLabel
                    text={`ENTRY ${money(entry)}`}
                    fill="#0284c7"
                  />
                }
              />
            )}

            {Number.isFinite(stopLoss) && (
              <ReferenceLine
                y={stopLoss}
                stroke="#dc2626"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                label={
                  <LevelLabel
                    text={`SL ${money(stopLoss)}`}
                    fill="#dc2626"
                  />
                }
              />
            )}

            {Number.isFinite(target1) && (
              <ReferenceLine
                y={target1}
                stroke="#16a34a"
                strokeWidth={1.4}
                strokeDasharray="6 3"
                label={
                  <LevelLabel
                    text={`T1 ${money(target1)}`}
                    fill="#16a34a"
                  />
                }
              />
            )}

            {Number.isFinite(target2) && (
              <ReferenceLine
                y={target2}
                stroke="#15803d"
                strokeWidth={1.4}
                strokeDasharray="3 3"
                label={
                  <LevelLabel
                    text={`T2 ${money(target2)}`}
                    fill="#15803d"
                  />
                }
              />
            )}

            {Number.isFinite(support) && (
              <ReferenceLine
                y={support}
                stroke="#0891b2"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            )}

            {Number.isFinite(resistance) && (
              <ReferenceLine
                y={resistance}
                stroke="#be123c"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            )}

            {selectedTrades.map((trade, index) => {
              const price = numberValue(trade?.price);
              const label = findNearestLabel(chartData, trade?.timestamp);

              if (price === null || !label) return null;

              const side = String(trade?.side || "").toUpperCase();
              const action = String(trade?.action || "").toUpperCase();
              const isExit =
                action.includes("CLOSE") ||
                action.includes("EXIT") ||
                action.includes("TARGET") ||
                action.includes("STOP");

              const markerText = isExit
                ? `EXIT ${money(price)}`
                : `${side || "TRADE"} ${money(price)}`;

              const markerColor = isExit
                ? "#f97316"
                : side === "BUY"
                ? "#16a34a"
                : "#dc2626";

              return (
                <ReferenceDot
                  key={trade?.id || `${label}-${price}-${index}`}
                  x={label}
                  y={price}
                  r={5}
                  fill={markerColor}
                  stroke="#ffffff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={
                    <MarkerLabel
                      text={markerText}
                      fill={markerColor}
                    />
                  }
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 9,
          fontSize: 12,
          color: "#475569",
        }}
      >
        <span><strong style={{ color: "#7c3aed" }}>— —</strong> VWAP</span>
        <span><strong style={{ color: "#0f766e" }}>——</strong> EMA 9</span>
        <span><strong style={{ color: "#c2410c" }}>——</strong> EMA 20</span>
        <span><strong style={{ color: "#0891b2" }}>···</strong> Support {money(support)}</span>
        <span><strong style={{ color: "#be123c" }}>···</strong> Resistance {money(resistance)}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: 14,
            background: "#ffffff",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            Candle Pattern Analysis
          </div>

          {patterns.length ? (
            patterns.map((pattern, index) => {
              const direction = pattern.direction;
              const color =
                direction === "BULLISH"
                  ? "#16a34a"
                  : direction === "BEARISH"
                  ? "#dc2626"
                  : "#64748b";

              return (
                <div
                  key={`${pattern.name}-${index}`}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "#f8fafc",
                    marginBottom: 7,
                  }}
                >
                  <strong style={{ color }}>{pattern.name}</strong>
                  <span style={{ color: "#64748b" }}>
                    {" "}
                    • {direction}
                    {pattern.strength !== null
                      ? ` • Strength ${pattern.strength}`
                      : ""}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ color: "#64748b", fontSize: 13 }}>
              No strong candlestick pattern detected on the latest analysis.
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.65 }}>
            <div><strong>5m direction:</strong> {chartDirection}</div>
            <div><strong>15m direction:</strong> {trend15m}</div>
            <div>
              <strong>Structure:</strong>{" "}
              {analysis?.chart_analysis?.structure || "—"}
            </div>
            <div>
              <strong>Breakout:</strong>{" "}
              {analysis?.chart_analysis?.breakout || analysis?.breakout || "—"}
            </div>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: 14,
            background: signalBackground,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10, color: signalColor }}>
            Why {selectedSymbol || "this stock"} is{" "}
            {qualified && ["BUY", "SELL"].includes(signal)
              ? `a QUALIFIED ${signal}`
              : signal}
          </div>

          {reasons.length ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: 20,
                lineHeight: 1.75,
                color: "#334155",
                fontSize: 13,
              }}
            >
              {reasons.map((reason, index) => (
                <li key={`${reason}-${index}`}>{reason}</li>
              ))}
            </ul>
          ) : (
            <div style={{ color: "#64748b", fontSize: 13 }}>
              No analysis reasons were returned by the backend.
            </div>
          )}

          {warnings.length > 0 && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid rgba(100,116,139,0.25)",
                fontSize: 12,
                color: "#92400e",
              }}
            >
              <strong>Warnings:</strong> {warnings.join(" • ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
