from app.utils.store_match import calc_store_match_rate, normalize_stores


def test_normalize_stores():
    result = normalize_stores("门店甲, 门店乙,门店甲")
    assert result == {"门店甲", "门店乙"}


def test_calc_store_match_rate():
    rate = calc_store_match_rate("A,B,C", "B,C,D")
    assert round(rate, 4) == 0.5


def test_calc_store_match_rate_empty():
    assert calc_store_match_rate("", "") == 1.0
