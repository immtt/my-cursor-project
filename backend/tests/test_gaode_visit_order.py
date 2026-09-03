from app.services.gaode_service import _visit_stores_csv_order
from app.services import gaode_service as gs


def test_visit_stores_csv_order_follows_import_sequence():
    coord_map = {"门店乙": (116.4, 39.9), "门店甲": (116.5, 40.0)}
    assert _visit_stores_csv_order(["门店乙", "门店甲", "门店乙"], coord_map) == ["门店乙", "门店甲"]


def test_amap_get_uses_defined_httpx_timeout(monkeypatch):
    """Live AMap HTTP must use `_HTTPX_TIMEOUT` (typo `_HTTPPX_TIMEOUT` is a NameError)."""
    captured = {}

    class FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"status": "1"}

    class FakeClient:
        def __init__(self, timeout=None):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, params=None):
            return FakeResp()

    monkeypatch.setattr(gs.httpx, "Client", FakeClient)
    out = gs._amap_get("geocode/geo", {"address": "x"})
    assert captured["timeout"] == gs._HTTPX_TIMEOUT
    assert out == {"status": "1"}
