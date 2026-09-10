from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from scripts.qlib_obv_features import build_obv_features


class QlibObvFeatureTests(unittest.TestCase):
    def test_obv_change_tracks_signed_volume(self) -> None:
        index = pd.date_range("2025-01-01", periods=30, freq="D")
        returns = pd.Series([0.0, *([0.01] * 29)], index=index)
        volume = pd.Series([100.0] * 30, index=index)

        features = build_obv_features(returns, volume, windows=(20,))

        self.assertAlmostEqual(features.loc[index[-1], "obv_change_20"], 1.0)

    def test_future_rows_do_not_change_past_features(self) -> None:
        index = pd.date_range("2025-01-01", periods=90, freq="D")
        returns = pd.Series(np.sin(np.arange(90)) / 100, index=index)
        volume = pd.Series(100 + np.arange(90), index=index, dtype="float64")
        prefix = build_obv_features(returns.iloc[:70], volume.iloc[:70])
        extended_returns = pd.concat([
            returns,
            pd.Series([0.5, -0.5], index=pd.date_range("2025-04-01", periods=2, freq="D")),
        ])
        extended_volume = pd.concat([
            volume,
            pd.Series([1_000_000.0, 1_000_000.0], index=extended_returns.index[-2:]),
        ])
        extended = build_obv_features(extended_returns, extended_volume)

        pd.testing.assert_frame_equal(prefix, extended.loc[prefix.index])


if __name__ == "__main__":
    unittest.main()
