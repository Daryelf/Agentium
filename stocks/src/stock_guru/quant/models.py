from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Mapping


@dataclass(frozen=True)
class TrendMetrics:
    simple_moving_averages: Mapping[str, float | None]
    exponential_moving_averages: Mapping[str, float | None]
    price_distance_pct: Mapping[str, float | None]
    short_term: str
    medium_term: str
    long_term: str
    alignment: str
    golden_cross_active: bool | None
    death_cross_active: bool | None
    recent_golden_cross: bool | None
    recent_death_cross: bool | None


@dataclass(frozen=True)
class MomentumMetrics:
    rsi14: float | None
    macd_line: float | None
    macd_signal: float | None
    macd_histogram: float | None
    returns: Mapping[str, float | None]
    rate_of_change: Mapping[str, float | None]
    five_day_segments: tuple[float, ...]
    acceleration_5d: float | None
    acceleration_state: str


@dataclass(frozen=True)
class VolatilityMetrics:
    atr14: float | None
    atr_pct: float | None
    historical_volatility_20: float | None
    historical_volatility_60: float | None
    rolling_std_20: float | None
    downside_volatility_20: float | None
    maximum_drawdown: float | None
    recent_drawdown_63: float | None
    gap_frequency_60: float | None
    average_daily_range_20: float | None
    average_daily_range_pct_20: float | None


@dataclass(frozen=True)
class VolumeMetrics:
    current_volume: float | None
    average_volume_20: float | None
    average_volume_50: float | None
    relative_volume_20: float | None
    relative_volume_50: float | None
    volume_weighted_average_price_20: float | None
    trend_ratio: float | None
    acceleration_ratio: float | None
    trend: str
    price_volume_confirmation: str
    accumulation_distribution_balance: float | None
    accumulation_distribution_state: str
    abnormal_volume: bool | None


@dataclass(frozen=True)
class RelativeStrengthMetrics:
    returns: Mapping[str, float | None]
    versus_spy: Mapping[str, float | None]
    versus_qqq: Mapping[str, float | None]
    sector_etf: str | None
    versus_sector: Mapping[str, float | None]


@dataclass(frozen=True)
class PriceZone:
    lower: float
    upper: float
    midpoint: float
    sources: tuple[str, ...]
    touches: int
    distance_pct: float


@dataclass(frozen=True)
class QuantFeatureSnapshot:
    version: int
    symbol: str
    generated_at: str
    as_of: str | None
    bars: int
    price: float | None
    feature_status: str
    source_data_status: str
    source_provider: str
    source_quality_score: int | None
    source_updated_at: str | None
    trend: TrendMetrics
    momentum: MomentumMetrics
    volatility: VolatilityMetrics
    volume: VolumeMetrics
    relative_strength: RelativeStrengthMetrics
    support_zones: tuple[PriceZone, ...]
    resistance_zones: tuple[PriceZone, ...]
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)
