import React, { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
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

function getTimeLabel(row, index) {
  const raw =
    row?.datetime ??
    row?.Datetime ??
    row?.date ??
    row?.Date ??
    row?.timestamp ??
    row?.time ??
    "";

  if (!raw) return String(index + 1);

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return String(raw);
  }

  const hasMultipleDays = true;

  return date.toLocaleString("en-IN", {
    day: hasMultipleDays ? "2-digit" : undefined,
    month: hasMultipleDays ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function CandleShape(props) {
  const {
    x,
    width,
    yAxis,
    payload,
  } = props;

  if (!payload || !yAxis?.scale) return null;

  const open = payload.open;
  const high = payload.high;
  const low = payload.low;
  const close = payload.close;

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
  const candleWidth = Math.max(2, Math.min(10, width * 0.65));
  const bodyX = centerX - candleWidth / 2;
  const bodyY = Math.min(openY, closeY);
  const bodyHeight = Math.max(1, Math.abs(closeY - openY));

  const rising = close >= open;
  const candleColor = rising ? "#16a34a" : "#dc2626";

  return (
    <g>
      <line
        x1={centerX}
        x2={centerX}
        y1={highY}
        y2={lowY}
        stroke={candleColor}
        strokeWidth={1.2}
      />

      <rect
        x={bodyX}
        y={bodyY}
        width={candleWidth}
        height={bodyHeight}
        fill={rising ? "#dcfce7" : "#fee2e2"}
        stroke={candleColor}
        strokeWidth={1.2}
      />
    </g>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload;

  if (!row) return null;

  const money = (value) =>
    Number.isFinite(value)
      ? `₹${Number(value).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—";

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        padding: "9px 11px",
        boxShadow: "0 4px 16px rgba(15, 23, 42, 0.12)",
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 4 }}>
        {row.label}
      </div>
      <div>Open: {money(row.open)}</div>
      <div>High: {money(row.high)}</div>
      <div>Low: {money(row.low)}</div>
      <div>Close: {money(row.close)}</div>
      {Number.isFinite(row.vwap) && <div>VWAP: {money(row.vwap)}</div>}
      {Number.isFinite(row.ema9) && <div>EMA 9: {money(row.ema9)}</div>}
      {Number.isFinite(row.ema20) && <div>EMA 20: {money(row.ema20)}</div>}
    </div>
  );
}

export default function IntradayChart({
  data = [],
  chartType = "CANDLE",
}) {
  const chartData = useMemo(
    () =>
      (Array.isArray(data) ? data : [])
        .map((row, index) => {
          const open = getValue(row, ["open", "Open"]);
          const high = getValue(row, ["high", "High"]);
          const low = getValue(row, ["low", "Low"]);
          const close = getValue(row, ["close", "Close"]);

          return {
            ...row,
            label: getTimeLabel(row, index),
            open,
            high,
            low,
            close,
            vwap: getValue(row, ["vwap", "VWAP"]),
            ema9: getValue(row, ["ema9", "EMA9", "ema_9"]),
            ema20: getValue(row, ["ema20", "EMA20", "ema_20"]),
          };
        })
        .filter(
          (row) =>
            Number.isFinite(row.open) &&
            Number.isFinite(row.high) &&
            Number.isFinite(row.low) &&
            Number.isFinite(row.close)
        ),
    [data]
  );

  const domain = useMemo(() => {
    if (!chartData.length) return ["auto", "auto"];

    let min = Infinity;
    let max = -Infinity;

    chartData.forEach((row) => {
      min = Math.min(min, row.low);
      max = Math.max(max, row.high);
    });

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return ["auto", "auto"];
    }

    const range = Math.max(max - min, Math.abs(max) * 0.005, 1);
    const padding = range * 0.08;

    return [
      Math.max(0, min - padding),
      max + padding,
    ];
  }, [chartData]);

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

  const tickEvery = Math.max(
    1,
    Math.ceil(chartData.length / 7)
  );

  return (
    <div
      style={{
        width: "100%",
        height: 430,
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
            top: 15,
            right: 18,
            bottom: 12,
            left: 8,
          }}
        >
          <CartesianGrid
            stroke="#e2e8f0"
            strokeDasharray="3 3"
          />

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
            width={78}
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
            strokeWidth={1.3}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="ema9"
            stroke="#0f766e"
            strokeWidth={1}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          <Line
            type="monotone"
            dataKey="ema20"
            stroke="#c2410c"
            strokeWidth={1}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
