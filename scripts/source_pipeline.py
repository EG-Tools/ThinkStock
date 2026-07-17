from __future__ import annotations

from time import monotonic
from typing import Callable, Generic, TypeVar

from data_build_support import source_health_summary


T = TypeVar("T")


class SourcePipeline(Generic[T]):
    """Run provider calls through one health-reporting boundary."""

    def __init__(self, report: dict, stale_after_days: dict[str, int] | None = None) -> None:
        self.report = report
        self.stale_after_days = stale_after_days or {}
        self.sources = report.setdefault("sources", {})
        self.events = report.setdefault("events", [])

    def run(
        self,
        name: str,
        loader: Callable[[], T],
        summarize: Callable[[T], dict],
        *,
        allow_failure: bool = False,
        default: T | None = None,
        status: str = "",
    ) -> T:
        started_at = monotonic()
        try:
            value = loader()
        except Exception as exc:
            self.sources[name] = source_health_summary(
                {"rows": 0, "latest": ""},
                started_at,
                self.stale_after_days.get(name),
                status="error",
                error=str(exc),
            )
            self.events.append(f"{name} failed: {str(exc).splitlines()[0]}")
            if allow_failure:
                return default  # type: ignore[return-value]
            raise

        self.sources[name] = source_health_summary(
            summarize(value),
            started_at,
            self.stale_after_days.get(name),
            status=status,
        )
        return value

    def record(
        self,
        name: str,
        summary: dict,
        started_at: float,
        *,
        status: str = "",
        error: str = "",
    ) -> dict:
        health = source_health_summary(
            summary,
            started_at,
            self.stale_after_days.get(name),
            status=status,
            error=error,
        )
        self.sources[name] = health
        return health
