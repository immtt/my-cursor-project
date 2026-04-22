def normalize_stores(raw_stores: str) -> set[str]:
    parts = [item.strip() for item in raw_stores.split(",")]
    return {item for item in parts if item}


def calc_store_match_rate(stores_a: str, stores_b: str) -> float:
    set_a = normalize_stores(stores_a)
    set_b = normalize_stores(stores_b)
    if not set_a and not set_b:
        return 1.0
    if not set_a or not set_b:
        return 0.0
    intersection = set_a.intersection(set_b)
    union = set_a.union(set_b)
    return round(len(intersection) / len(union), 4)
