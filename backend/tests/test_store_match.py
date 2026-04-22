from app.utils.store_match import (
    calc_store_match_rate,
    diff_stores_by_side,
    normalize_stores,
    same_and_diff_stores_csv,
)


def test_normalize_stores():
    result = normalize_stores("门店甲, 门店乙,门店甲")
    assert result == {"门店甲", "门店乙"}


def test_calc_store_match_rate():
    rate = calc_store_match_rate("A,B,C", "B,C,D")
    assert round(rate, 4) == round(2 / 3, 4)


def test_calc_store_match_rate_empty():
    assert calc_store_match_rate("", "") == 1.0


def test_same_and_diff_stores_csv():
    s, d = same_and_diff_stores_csv("门店甲, 门店乙", "门店乙,门店丙")
    assert s == "门店乙"
    assert set(d.split(",")) == {"门店甲", "门店丙"}


def test_same_and_diff_stores_csv_one_side():
    s, d = same_and_diff_stores_csv("A,B", "")
    assert s == "" and d == "A,B"


def test_diff_stores_by_side():
    only_s, only_m = diff_stores_by_side("门店甲, 门店乙", "门店乙,门店丙")
    assert only_s == "门店甲"
    assert only_m == "门店丙"
