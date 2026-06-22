from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ")
    return re.sub(r"\s+", " ", value).strip()


def detect_kind(pdf_path: Path) -> str:
    name = pdf_path.name
    if "单选" in name:
        return "single"
    if "判断" in name:
        return "judge"
    if "多选" in name:
        return "multi"

    pages = len(PdfReader(str(pdf_path)).pages)
    if pages == 24:
        return "single"
    if pages == 15:
        return "judge"
    if pages == 7:
        return "multi"
    raise ValueError(f"Cannot detect question type for {pdf_path.name}: {pages} pages")


def parse_pdf(pdf_path: Path, kind: str) -> list[dict]:
    reader = PdfReader(str(pdf_path))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    letters = "AB" if kind == "judge" else "ABCDE"
    label = r"[\u3001]" if kind == "judge" else r"[\u3001.]"
    option_start_re = re.compile(r"(?m)^\s*A" + label + r"\s*")
    option_re = re.compile(
        r"(?ms)^\s*([" + letters + r"])" + label + r"\s*(.*?)(?=^\s*[" + letters + r"]" + label + r"\s*|\Z)"
    )
    answer_re = re.compile(r"[\uff08(]\s*([" + letters + r"]{1,5})\s*[\uff09)]")

    rows: list[dict] = []
    errors: list[str] = []
    for chunk in re.split(r"(?m)(?=^\s*\d+\.)", text):
        if not chunk.strip():
            continue
        number_match = re.match(r"\s*(\d+)\.(.*)\Z", chunk, re.S)
        if not number_match:
            errors.append(f"Cannot read question number near: {chunk[:80]!r}")
            continue

        number = int(number_match.group(1))
        body = number_match.group(2).strip()
        option_start = option_start_re.search(body)
        if not option_start:
            errors.append(f"Question {number}: cannot find options")
            continue

        question_part = body[: option_start.start()]
        options_part = body[option_start.start() :]
        answer_match = answer_re.search(question_part)
        if not answer_match:
            errors.append(f"Question {number}: cannot find answer")
            continue

        answer = "".join(dict.fromkeys(answer_match.group(1)))
        question_part = question_part[: answer_match.start()] + question_part[answer_match.end() :]
        options = [
            {"key": option.group(1), "text": clean_text(option.group(2))}
            for option in option_re.finditer(options_part)
        ]
        option_keys = {option["key"] for option in options}
        if not options or any(key not in option_keys for key in answer):
            errors.append(f"Question {number}: answer {answer} does not match options {sorted(option_keys)}")
            continue

        rows.append(
            {
                "id": number,
                "type": kind,
                "question": clean_text(question_part),
                "answer": answer,
                "options": options,
            }
        )

    if errors:
        raise RuntimeError("\n".join(errors))

    rows.sort(key=lambda row: row["id"])
    if not rows:
        raise RuntimeError(f"{kind}: no questions parsed")
    expected = list(range(1, rows[-1]["id"] + 1))
    actual = [row["id"] for row in rows]
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        print(f"Warning: {kind} missing question numbers {missing}")
    return rows


def main() -> None:
    candidates = sorted([path for path in ROOT.glob("*.pdf") if "I-" in path.name], key=lambda path: path.name)
    selected: dict[str, Path] = {}
    for pdf_path in candidates:
        kind = detect_kind(pdf_path)
        current = selected.get(kind)
        if current is None or pdf_path.stat().st_mtime > current.stat().st_mtime:
            selected[kind] = pdf_path

    missing = [kind for kind in ("single", "judge", "multi") if kind not in selected]
    if missing:
        raise RuntimeError(f"Missing question-bank PDFs for: {', '.join(missing)}")

    question_bank = {"single": [], "judge": [], "multi": []}
    source_files = {}
    for kind in ("single", "judge", "multi"):
        pdf_path = selected[kind]
        question_bank[kind] = parse_pdf(pdf_path, kind)
        source_files[kind] = pdf_path.name

    payload = {
        "meta": {
            "title": "铁路货运组织 I",
            "sourceFiles": source_files,
            "counts": {kind: len(rows) for kind, rows in question_bank.items()},
        },
        "questions": question_bank,
    }
    js = "window.QUESTION_BANK = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n"
    (ROOT / "questions.js").write_text(js, encoding="utf-8")

    for kind, rows in question_bank.items():
        print(f"{kind}: {len(rows)} questions")
    print("Wrote questions.js")


if __name__ == "__main__":
    main()
