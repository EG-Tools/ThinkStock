from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd


def build_obv_features(
    returns: pd.Series,
    volume: pd.Series,
    windows: Sequence[int] = (20, 63, 126),
) -> pd.DataFrame:
    """Build point-in-time OBV features without using future observations."""
    aligned_volume = pd.to_numeric(volume.reindex(returns.index), errors="coerce")
    signed_volume = aligned_volume.fillna(0) * np.sign(returns).fillna(0)
    obv = signed_volume.cumsum()
    result = pd.DataFrame(index=returns.index)
    for window in windows:
        minimum = max(10, window // 2)
        volume_scale = aligned_volume.abs().rolling(window, min_periods=minimum).sum()
        change = (obv - obv.shift(window)) / volume_scale.replace(0, np.nan)
        price_return = returns.rolling(window, min_periods=window).sum()
        result[f"obv_change_{window}"] = change
        result[f"obv_price_divergence_{window}"] = change - price_return
    if 20 in windows and 63 in windows:
        result["obv_acceleration_20_63"] = (
            result["obv_change_20"] - result["obv_change_63"]
        )
    return result.replace([np.inf, -np.inf], np.nan)
