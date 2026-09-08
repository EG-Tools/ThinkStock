# ThinkStock Signal Engine B/C Experiment Record

## Purpose And Status

This document is the durable, compact record of the discarded B and C signal-engine experiments. It exists so future agents know what was tried, why neither candidate replaced the production engine A, and which ideas remain useful. The original intermediate models, predictions, reports, and large research caches were intentionally removed after this summary was written.

- Engine A remains the production signal engine and comparison champion.
- Engines B and C are retired research attempts. They must not be restored as runtime fallbacks.
- B/C emitted signals, scores, thresholds, and hand-labelled turning points are negative evidence, not training labels.
- Shared factual inputs and generic calculations may be reused only when their point-in-time semantics are identical.

## Engine B

### Goal And Evolution

B was intended to be an independent engine that combined price, volume, MACD, disparity, ADR, market credit, term spread, credit spread, VIX/VKOSPI, fear-greed, news sentiment, and leading-cycle context. An early prototype was invalid because it copied A's emitted markers and added a narrow `market selloff deceleration` rule. That prototype demonstrated a comparison overlay but was not an independent engine.

B was then rebuilt from factual inputs without using A's decisions. The recorded experiment used 45 series and 196,563 point-in-time rows, split into 137,590 development rows, 20,335 validation rows, and 24,309 holdout rows. Logistic, quality-weighted, swing-focused, robust, refitted, segmented, and component-conservative variants were tried with different thresholds, phases, and cooldowns.

### Recorded Holdout Result

The experiment reports used A as their baseline. Composite values below are the report's combined directional and excursion quality measure.

| B variant | B buy | A buy | B sell | A sell |
| --- | ---: | ---: | ---: | ---: |
| Initial logistic | 0.5636 | 0.6382 | 0.4462 | 0.5808 |
| Swing-focused | 0.5636 | 0.6382 | 0.4565 | 0.5808 |
| Robust | 0.5640 | 0.6382 | 0.4688 | 0.5808 |
| Refit/segmented | 0.5540 | 0.6382 | 0.4975 | 0.5808 |
| Component-conservative | 0.5649 | 0.6382 | 0.5097 | 0.5808 |

No B variant beat A on the sealed holdout. The final component approach trailed A by about 0.073 on buys and 0.071 on sells. Attempts to improve precision generally reduced recall and signal coverage; attempts to restore coverage weakened directional quality. Sell timing remained the clearest weakness.

### Why B Underperformed

1. One broad model could not represent the different regimes of low-volatility compounders, cyclicals, event-driven stocks, long declines, range-bound stocks, and high-beta growth stocks consistently.
2. Slowly published macro inputs were useful as regime context but became misleading when treated like same-day triggers.
3. Turning-point labels and ordinary forward-return objectives were not fully aligned. A model could improve a 20-day direction score while still marking a visibly poor local high or low.
4. Threshold, cooldown, phase, and feature variants improved selected slices but did not generalize to the untouched holdout.
5. Sell events were more heterogeneous and sparse than buy events, producing unstable fitting and weak transfer across stocks and years.
6. Named dates and visually obvious crashes were repeatedly inspected during development. They are useful audits, but tuning toward them risks target leakage and cannot prove general quality.

### What Was Meaningful

- Independent development, validation, holdout, and audit partitions exposed regressions that visual inspection missed.
- The component-conservative buy model produced a strong small audit slice, but only 24 audit signals; its holdout result remained inferior. This suggests conditional value, not a promotable universal engine.
- Technical indicators should provide timely trigger evidence, while macro, credit, volatility, and sentiment should primarily describe regime, risk budget, and confidence.
- Market/stock structure classification and per-regime calibration remain promising, provided the classifier and rules are frozen before unseen evaluation.
- The failed promotion directly motivated the repository's independent-engine rules and champion/challenger release gate.

## Engine C

### Proposed Method

C was an open-book, stock-structure experiment. It proposed classifying each stock from its recent behavior, index co-movement, volatility, trend, range behavior, and transition pattern, then manually studying meaningful highs and lows across representative stocks. Technical and macro conditions around each point would be combined iteratively until more turning points were explained.

### Why It Was Retired

C did not reach a frozen, independently evaluated candidate. Its central loop repeatedly fitted formulas after viewing the desired high and low outcomes. That creates look-ahead leakage, selection bias, stock-specific rules, and signal proliferation. Reapplying misses from one inspected stock back into previously inspected stocks also turns the development set into the test set. A visually convincing fit therefore could not demonstrate future predictive value.

### What Was Meaningful

- A stock's recent structural type can reasonably select or weight a model; one universal equation is unlikely to fit every stock.
- Regime changes should be detected from information available at that date, not assigned after viewing the subsequent chart.
- Representative-stock diversity is useful for development, but final quality requires ticker-disjoint and date-disjoint evaluation.
- Human-marked turning points may be retained only as a separate qualitative review set. They must never train or tune the candidate being scored on that set.

## Rules For Any Successor

1. Start from point-in-time factual data, not A/B/C signals, scores, thresholds, or marker locations.
2. Define causal labels and success metrics before training. Include timing error, adverse excursion, useful forward movement, signal density, and year/market/stock-type stability.
3. Separate development, validation, ticker-disjoint holdout, date-disjoint holdout, and a sealed audit set.
4. Freeze features, parameters, thresholds, and density policy before opening the holdout or named audit dates.
5. Treat delayed macro series as regime/context inputs unless publication timing proves they were available as triggers.
6. Compare against A at identical dates, prices, costs, and signal-density constraints. A candidate must improve materially without a severe segment regression.
7. Keep a failed candidate research-only. Preserve only a compact conclusion like this document, not its emitted signals as reusable intelligence.

## Removed Local Artifacts

The following regenerable local artifacts were removed after recording the conclusions:

- `.thinkstock-cache/market-timing-b-research*.json`: direct B experiment reports.
- `.thinkstock-cache/timing-universe-15y/`: cached historical universe used by timing research.
- `.thinkstock-cache/ai-backtest/`: large walk-forward and market-timing research intermediates. Much of this directory belonged to separate AI forecast experiments rather than B/C, so none of its results should be inferred as B/C evidence.
- `.thinkstock-cache/qlib-venv/`: optional QLib Python environment. It was not B or C and was removed only because it is large and reproducible.

The browser application and deployment data do not depend on these local research artifacts. If future approved research needs them, regenerate inputs from the maintained scripts rather than restoring stale outputs.
