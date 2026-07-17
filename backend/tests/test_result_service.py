import csv

from app.services.result_service import export_results_csv


def test_export_neutralizes_spreadsheet_formulas(tmp_path):
    output_path = tmp_path / "results.csv"
    export_results_csv(
        str(output_path),
        [
            {
                "sys_waybill_no": '=HYPERLINK("https://attacker.example","open")',
                "manual_waybill_no": "@SUM(1+1)",
                "match_status": "full",
                "store_match_rate": 100.0,
                "volume_diff_rate": 0.0,
                "line_consistent": True,
                "est_distance_diff": -2.0,
                "est_duration_diff": 5,
            }
        ],
    )

    with output_path.open(newline="", encoding="utf-8") as exported_file:
        row = next(csv.DictReader(exported_file))

    assert row["sys_waybill_no"] == '\'=HYPERLINK("https://attacker.example","open")'
    assert row["manual_waybill_no"] == "'@SUM(1+1)"
    assert row["match_status"] == "full"
    assert row["est_distance_diff"] == "-2.0"
