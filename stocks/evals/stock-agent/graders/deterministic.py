from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Mapping


def _num(value: Any) -> Decimal:
    return Decimal(str(value))


def _round(value: Decimal, places: int = 4) -> float:
    quant = Decimal("1") if places == 0 else Decimal("1").scaleb(-places)
    return float(value.quantize(quant, rounding=ROUND_HALF_UP))


def compute_formula(formula: str, inputs: Mapping[str, Any]) -> float | None:
    if formula == "market_cap":
        return _round(_num(inputs["price"]) * _num(inputs["shares_outstanding"]), 2)
    if formula == "percent_change":
        return _round((_num(inputs["new"]) - _num(inputs["old"])) / _num(inputs["old"]) * Decimal("100"), 4)
    if formula == "pe_ratio":
        return _round(_num(inputs["price"]) / _num(inputs["eps"]), 4)
    if formula == "dividend_yield":
        return _round(_num(inputs["annual_dividend"]) / _num(inputs["price"]) * Decimal("100"), 4)
    if formula == "position_weight":
        return _round(_num(inputs["position_value"]) / _num(inputs["portfolio_value"]) * Decimal("100"), 4)
    if formula == "single_trade_risk":
        return _round((_num(inputs["entry"]) - _num(inputs["stop"])) * _num(inputs["shares"]), 2)
    if formula == "risk_reward":
        risk = _num(inputs["entry"]) - _num(inputs["stop"])
        reward = _num(inputs["target"]) - _num(inputs["entry"])
        return _round(reward / risk, 4)
    if formula == "cagr":
        begin = float(inputs["begin"])
        end = float(inputs["end"])
        years = float(inputs["years"])
        if begin <= 0 or years <= 0:
            return None
        return round(((end / begin) ** (1 / years) - 1) * 100, 4)
    if formula == "max_drawdown":
        values = [float(item) for item in inputs["equity_curve"]]
        peak = values[0]
        drawdown = 0.0
        for value in values:
            peak = max(peak, value)
            if peak > 0:
                drawdown = min(drawdown, (value - peak) / peak)
        return round(abs(drawdown) * 100, 4)
    return None


def grade_case_spec(case: Mapping[str, Any]) -> dict[str, Any]:
    calc = case.get("required_calculations") or {}
    if not isinstance(calc, Mapping) or not calc.get("formula"):
        return {
            "status": "NOT_APPLICABLE",
            "grader": "deterministic_formula",
            "message": "No deterministic formula attached to this case.",
        }
    actual = compute_formula(str(calc["formula"]), calc.get("inputs") or {})
    expected = calc.get("expected")
    tolerance = float(calc.get("tolerance", 0.0001))
    if actual is None:
        return {
            "status": "BLOCKED",
            "grader": "deterministic_formula",
            "message": f"Formula {calc['formula']} is not implemented in the grader.",
        }
    passed = abs(float(actual) - float(expected)) <= tolerance
    return {
        "status": "PASS" if passed else "FAIL",
        "grader": "deterministic_formula",
        "expected": expected,
        "actual": actual,
        "tolerance": tolerance,
        "message": "Formula fixture is internally consistent." if passed else "Formula fixture does not match expected value.",
    }
