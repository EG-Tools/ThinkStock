"use strict";

  const NEWS_MOVING_AVERAGE_DAYS = 1;
  const NEWS_MOVING_AVERAGE_MIN_DAYS = 1;
  const NEWS_MOVING_AVERAGE_MAX_DAYS = 20;
  const AUXILIARY_PANEL_KEYS = Object.freeze([
    "adr",
    "vkospi",
    "fearGreed",
    "newsSentiment",
  ]);
  const AUXILIARY_CHART_CONFIG = Object.freeze({
    adrBandColor: "rgba(100,100,100,0.06)",
    adrHighThreshold: 120,
    adrLowThreshold: 80,
    adrZoneHighColor: "#e6adad",
    adrZoneLowColor: "#b0c6ed",
    fearGreedHighThreshold: 75,
    fearGreedLowThreshold: 25,
    newsSentimentHighThreshold: 110,
    newsSentimentLowThreshold: 90,
    zoneHighFillColor: "rgba(230,173,173,0.15)",
    zoneLowFillColor: "rgba(176,198,237,0.15)",
    seriesKeys: Object.freeze({
      adrKospi: "adr_kospi",
      adrKosdaq: "adr_kosdaq",
      fearGreed: "fear_greed",
      newsSentiment: "news_sentiment",
      vkospi: "vkospi",
      vix: "vix",
    }),
  });

  function normalizeNewsMovingAverageDays(value, fallback = NEWS_MOVING_AVERAGE_DAYS) {
    const numeric = Math.round(Number(value));
    const fallbackValue = Number.isFinite(Number(fallback))
      ? Math.round(Number(fallback))
      : NEWS_MOVING_AVERAGE_DAYS;
    return Math.min(
      NEWS_MOVING_AVERAGE_MAX_DAYS,
      Math.max(NEWS_MOVING_AVERAGE_MIN_DAYS, Number.isFinite(numeric) ? numeric : fallbackValue),
    );
  }

  const contract = Object.freeze({
    AUXILIARY_CHART_CONFIG,
    AUXILIARY_PANEL_KEYS,
    NEWS_MOVING_AVERAGE_DAYS,
    NEWS_MOVING_AVERAGE_MAX_DAYS,
    NEWS_MOVING_AVERAGE_MIN_DAYS,
    normalizeNewsMovingAverageDays,
  });
export {
  AUXILIARY_CHART_CONFIG,
  AUXILIARY_PANEL_KEYS,
  NEWS_MOVING_AVERAGE_DAYS,
  NEWS_MOVING_AVERAGE_MAX_DAYS,
  NEWS_MOVING_AVERAGE_MIN_DAYS,
  normalizeNewsMovingAverageDays,
};
export default contract;
