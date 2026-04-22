def normalize_stores(raw_stores: str) -> set[str]:
    parts = [item.strip() for item in raw_stores.split(",")]
    return {item for item in parts if item}


def calc_store_match_rate(stores_a: str, stores_b: str) -> float:
    """PRD：匹配度 = 重合门店数 / max(系统门店数, 手动门店数)。"""
    set_a = normalize_stores(stores_a)
    set_b = normalize_stores(stores_b)
    if not set_a and not set_b:
        return 1.0
    if not set_a or not set_b:
        return 0.0
    intersection = set_a.intersection(set_b)
    denom = max(len(set_a), len(set_b))
    return round(len(intersection) / denom, 4)


def same_and_diff_stores_csv(stores_a: str, stores_b: str) -> tuple[str, str]:
    """两侧拼载门店集合：交集（相同门店）、对称差集（仅一侧有的门店），逗号拼接且按名称排序便于展示。"""
    sa = normalize_stores(stores_a or "")
    sb = normalize_stores(stores_b or "")
    same = sorted(sa & sb)
    diff = sorted((sa - sb) | (sb - sa))
    return ",".join(same), ",".join(diff)


def diff_stores_by_side(
    system_stores: str, manual_stores: str
) -> tuple[str, str]:
    """仅系统有 / 仅手工有，逗号拼接、按名称排序。第一参为系统侧、第二为手工侧。"""
    sa = normalize_stores(system_stores or "")
    sb = normalize_stores(manual_stores or "")
    only_sys = sorted(sa - sb)
    only_man = sorted(sb - sa)
    return ",".join(only_sys), ",".join(only_man)
