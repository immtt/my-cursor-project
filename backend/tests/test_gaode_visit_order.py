from app.services.gaode_service import _visit_stores_csv_order


def test_visit_stores_csv_order_follows_import_sequence():
    coord_map = {"门店乙": (116.4, 39.9), "门店甲": (116.5, 40.0)}
    assert _visit_stores_csv_order(["门店乙", "门店甲", "门店乙"], coord_map) == ["门店乙", "门店甲"]
