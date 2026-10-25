#!/usr/bin/env python3
"""Turn PersonaMem-v2's benchmark.csv into clean, typed JSONL for the Eigen adapter.

Run isolated and stdlib-only:  python3 -I evals/personamem/prepare.py --data-dir DIR

DIR layout (see docs/planning/public-benchmarks.md section 5.1):
  DIR/benchmark/text/benchmark.csv
  DIR/<chat_history_32k_link>            (the 200 history files the CSV references)

Writes DIR/personamem.benchmark.jsonl. Refuses (non-zero exit) on any row it cannot parse;
nothing is skipped. --print-history-urls prints the download URL of each distinct history
file and exits (the files do not have to exist yet).
"""

import argparse
import ast
import csv
import hashlib
import json
import os
import sys

HF_BASE = "https://huggingface.co/datasets/bowen-upenn/PersonaMem-v2/resolve/main/"
CSV_RELATIVE = os.path.join("benchmark", "text", "benchmark.csv")
OUTPUT_NAME = "personamem.benchmark.jsonl"

COLUMNS = [
    "persona_id",
    "chat_history_32k_link",
    "user_query",
    "correct_answer",
    "incorrect_answers",
    "pref_type",
    "who",
    "updated",
    "prev_pref",
    "conversation_scenario",
    "topic_query",
    "distance_from_related_snippet_to_query_32k",
]


def fail(message):
    print(f"prepare.py: {message}", file=sys.stderr)
    sys.exit(1)


def parse_row(number, raw):
    def bad(column, why):
        fail(f"row {number} (persona {raw.get('persona_id')!r}): {column}: {why}")

    try:
        persona_id = int(raw["persona_id"])
    except ValueError:
        bad("persona_id", f"not an integer: {raw['persona_id']!r}")

    try:
        parsed = ast.literal_eval(raw["user_query"])
    except (ValueError, SyntaxError) as err:
        bad("user_query", f"not a Python literal ({err})")
    if not isinstance(parsed, dict) or parsed.get("role") != "user":
        bad("user_query", "expected a dict with role 'user'")
    query = parsed.get("content")
    if not isinstance(query, str) or not query.strip():
        bad("user_query", "content must be a non-empty string")

    correct = raw["correct_answer"]
    if not correct.strip():
        bad("correct_answer", "empty")

    try:
        incorrect = json.loads(raw["incorrect_answers"])
    except json.JSONDecodeError as err:
        bad("incorrect_answers", f"not JSON ({err})")
    if (
        not isinstance(incorrect, list)
        or len(incorrect) != 3
        or not all(isinstance(a, str) and a.strip() for a in incorrect)
    ):
        bad("incorrect_answers", "expected a JSON list of exactly 3 non-empty strings")
    if len({correct, *incorrect}) != 4:
        bad("incorrect_answers", "the four options must be distinct")

    if raw["updated"] not in ("True", "False"):
        bad("updated", f"expected 'True' or 'False', got {raw['updated']!r}")

    try:
        distance = int(raw["distance_from_related_snippet_to_query_32k"])
    except ValueError:
        bad("distance_from_related_snippet_to_query_32k", "not an integer")
    if distance < 0:
        bad("distance_from_related_snippet_to_query_32k", "negative")

    for column in ("chat_history_32k_link", "pref_type", "who"):
        if not raw[column].strip():
            bad(column, "empty")

    return {
        "personaId": persona_id,
        "link": raw["chat_history_32k_link"],
        "query": query,
        "correctAnswer": correct,
        "incorrectAnswers": incorrect,
        "prefType": raw["pref_type"],
        "who": raw["who"],
        "updated": raw["updated"] == "True",
        "prevPref": raw["prev_pref"] if raw["prev_pref"].strip() else None,
        "scenario": raw["conversation_scenario"],
        "topicQuery": raw["topic_query"],
        "distance32k": distance,
        "questionId": f"p{persona_id}-{hashlib.sha256(query.encode('utf-8')).hexdigest()[:12]}",
    }


def read_rows(data_dir):
    csv_path = os.path.join(data_dir, CSV_RELATIVE)
    if not os.path.isfile(csv_path):
        fail(f"{csv_path} not found (see docs/planning/public-benchmarks.md section 5.1)")
    csv.field_size_limit(2**31 - 1)
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            fail(f"{csv_path} is missing column(s): {', '.join(missing)}")
        for index, raw in enumerate(reader, start=1):
            rows.append(parse_row(index, raw))
    if not rows:
        fail(f"{csv_path} has no rows")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--print-history-urls", action="store_true")
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    rows = read_rows(data_dir)

    link_by_persona = {}
    for row in rows:
        known = link_by_persona.setdefault(row["personaId"], row["link"])
        if known != row["link"]:
            fail(f"persona {row['personaId']} references two history files: {known!r}, {row['link']!r}")

    links = list(dict.fromkeys(row["link"] for row in rows))

    if args.print_history_urls:
        for link in links:
            print(HF_BASE + link)
        return

    missing = [link for link in links if not os.path.isfile(os.path.join(data_dir, link))]
    if missing:
        shown = "\n  ".join(os.path.join(data_dir, link) for link in missing[:10])
        fail(
            f"{len(missing)} history file(s) missing locally (fetch them with --print-history-urls):\n  {shown}"
        )

    seen = set()
    for row in rows:
        if row["questionId"] in seen:
            fail(f"duplicate questionId {row['questionId']}")
        seen.add(row["questionId"])

    out_path = os.path.join(data_dir, OUTPUT_NAME)
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        for row in rows:
            link = row.pop("link")
            row["historyPath"] = os.path.join(data_dir, link)
            ordered = {"personaId": row.pop("personaId"), "historyPath": row.pop("historyPath"), **row}
            handle.write(json.dumps(ordered, ensure_ascii=False) + "\n")
    os.replace(tmp_path, out_path)
    print(f"wrote {len(rows)} rows for {len(link_by_persona)} personas to {out_path}")


if __name__ == "__main__":
    main()
