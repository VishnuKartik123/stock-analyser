import React from "react";

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";


function formatDate(value, intraday = false) {
  if (!value) {
    return "";
  }

  try {
    const date = new Date(value);

    if (intraday) {
      return date.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });

  } catch {
    return value;
  }
}


function formatPrice(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(Number(value))
  ) {
    return "-";
  }

  return `₹${Number(value).toFixed(2)}`;
}


function CustomTooltip({
  active,
  payload,
  label,
  intraday,
}) {
  if (
    !active ||
    !payload ||
    payload.length === 0
  ) {
    return null;
  }

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #d1d5db",
        borderRadius: "10px",
        padding: "12px",
        boxShadow:
          "0 5px 20px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          fontWeight: "700",
          marginBottom: "8px",
        }}
      >
        {formatDate(label, intraday)}
      </div>

      {payload.map((item) => (
        <div
          key={item.dataKey}
          style={{
            fontSize: "13px",
            marginBottom: "4px",
          }}
        >
          <strong>{item.name}:</strong>{" "}
          {formatPrice(item.value)}
        </div>
      ))}
    </div>
  );
}


export default function StockChart({
  data = [],
  symbol = "",
  intraday = false,
}) {

  const cleanedData = data
    .filter(
      (item) =>
        item &&
        item.close !== null &&
        item.close !== undefined
    )
    .map((item) => ({
      ...item,

      close: Number(item.close),

      sma20:
        item.sma20 !== null &&
        item.sma20 !== undefined
          ? Number(item.sma20)
          : null,

      sma50:
        item.sma50 !== null &&
        item.sma50 !== undefined
          ? Number(item.sma50)
          : null,

      ema20:
        item.ema20 !== null &&
        item.ema20 !== undefined
          ? Number(item.ema20)
          : null,

      ema9:
        item.ema9 !== null &&
        item.ema9 !== undefined
          ? Number(item.ema9)
          : null,

      vwap:
        item.vwap !== null &&
        item.vwap !== undefined
          ? Number(item.vwap)
          : null,

      bb_upper:
        item.bb_upper !== null &&
        item.bb_upper !== undefined
          ? Number(item.bb_upper)
          : null,

      bb_middle:
        item.bb_middle !== null &&
        item.bb_middle !== undefined
          ? Number(item.bb_middle)
          : null,

      bb_lower:
        item.bb_lower !== null &&
        item.bb_lower !== undefined
          ? Number(item.bb_lower)
          : null,
    }));


  if (cleanedData.length === 0) {
    return (
      <div
        style={{
          height: "450px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          background: "#ffffff",
          color: "#6b7280",
        }}
      >
        No chart data available.
      </div>
    );
  }


  return (
    <div
      style={{
        width: "100%",
        background: "#ffffff",
        borderRadius: "14px",
        padding: "18px",
        boxSizing: "border-box",
        border: "1px solid #e5e7eb",
      }}
    >

      <div
        style={{
          marginBottom: "15px",
        }}
      >

        <h2
          style={{
            margin: 0,
            fontSize: "20px",
          }}
        >
          {symbol}{" "}
          {intraday
            ? "Intraday Chart"
            : "Price Chart"}
        </h2>

        <div
          style={{
            marginTop: "5px",
            color: "#6b7280",
            fontSize: "13px",
          }}
        >
          {intraday
            ? "5-minute candles • VWAP • EMA 9 • EMA 20"
            : "Price with SMA, EMA and Bollinger Bands"}
        </div>

      </div>


      <ResponsiveContainer
        width="100%"
        height={430}
      >

        <ComposedChart
          data={cleanedData}
          margin={{
            top: 10,
            right: 20,
            left: 5,
            bottom: 10,
          }}
        >

          <CartesianGrid
            strokeDasharray="3 3"
          />

          <XAxis
            dataKey="time"
            tickFormatter={(value) =>
              formatDate(value, intraday)
            }
            minTickGap={
              intraday ? 50 : 35
            }
          />

          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(value) =>
              `₹${Number(value).toFixed(0)}`
            }
          />

          <Tooltip
            content={
              <CustomTooltip
                intraday={intraday}
              />
            }
          />

          <Legend />


          <Line
            type="monotone"
            dataKey="close"
            name="Price"
            strokeWidth={3}
            dot={false}
            isAnimationActive={false}
          />


          {intraday ? (
            <>
              <Line
                type="monotone"
                dataKey="vwap"
                name="VWAP"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="ema9"
                name="EMA 9"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="ema20"
                name="EMA 20"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
            </>
          ) : (
            <>
              <Line
                type="monotone"
                dataKey="sma20"
                name="SMA 20"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="sma50"
                name="SMA 50"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="ema20"
                name="EMA 20"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="bb_upper"
                name="BB Upper"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="bb_middle"
                name="BB Middle"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />

              <Line
                type="monotone"
                dataKey="bb_lower"
                name="BB Lower"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}

        </ComposedChart>

      </ResponsiveContainer>

    </div>
  );
}