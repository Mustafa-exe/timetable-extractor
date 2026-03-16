import csv
import hashlib
import io
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import pdfplumber
from flask import Flask, flash, redirect, render_template, request, send_file, session, url_for

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB uploads
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret")

PARSED_TIMETABLES: Dict[str, bytes] = {}
PROCESSED_RESULTS: Dict[str, List[Dict[str, str]]] = {}
SAVED_LIBRARY: Dict[str, Dict[str, Any]] = {}
SESSION_UPLOADS: Dict[str, Dict[str, Any]] = {}
FULL_PARSE_CACHE: Dict[str, List[Dict[str, str]]] = {}
FIELDNAMES = ["day", "time", "subject", "section", "room", "teacher"]
TABLE_SETTINGS = {"vertical_strategy": "lines", "horizontal_strategy": "lines"}
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TIME_START_MINUTES = 8 * 60  # 08:00 AM
SLOT_MINUTES = 20
CACHE_LIMIT = 20
SAVED_LIMIT = 10


def prune_cache(bucket: Dict[str, Any], limit: int) -> None:
    while len(bucket) > limit:
        oldest_key = next(iter(bucket))
        bucket.pop(oldest_key, None)


def build_time_boundaries(slot_count: int) -> List[int]:
    return [TIME_START_MINUTES + SLOT_MINUTES * idx for idx in range(slot_count + 1)]


def minutes_to_label(total_minutes: int) -> str:
    hour = total_minutes // 60
    minute = total_minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {suffix}"


def format_time_range(boundaries: List[int], start_idx: int, end_idx: int) -> str:
    start_label = minutes_to_label(boundaries[start_idx])
    end_label = minutes_to_label(boundaries[end_idx])
    return f"{start_label} - {end_label}"


def detect_day_label(page_text: str, fallback: str) -> str:
    upper = (page_text or "").upper()
    for name in DAY_NAMES:
        if name.upper() in upper:
            return name
    return fallback


def resolve_slot_count(table: List[List[Optional[str]]]) -> int:
    if len(table) < 4:
        return 0
    header = table[3]
    usable = [cell for cell in header[2:] if cell is not None]
    count = len(usable)
    return count if count > 0 else max(0, len(header) - 3)


def split_cell(cell_text: str) -> Dict[str, str]:
    lines = [line.strip() for line in cell_text.splitlines() if line.strip()]
    if not lines:
        return {"subject": "", "teacher": "", "section": ""}

    subject_line = lines[0]
    teacher = ", ".join(lines[1:]) if len(lines) > 1 else ""
    section = ""
    match = re.search(r"\(([^)]+)\)\s*$", subject_line)
    if match:
        section = match.group(1).strip()
        subject_line = subject_line[: match.start()].strip()

    return {"subject": subject_line, "teacher": teacher, "section": section}


def day_order(day: str) -> int:
    normalized = (day or "").strip().lower()
    for idx, name in enumerate(DAY_NAMES):
        if name.lower() == normalized:
            return idx
    return len(DAY_NAMES)


def parse_row_cells(
    cells: List[Optional[str]],
    room: str,
    day: str,
    boundaries: List[int],
) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    slot_limit = len(boundaries) - 1
    col = 0

    while col < len(cells):
        cell = cells[col]
        if not (cell and cell.strip()):
            col += 1
            continue

        next_col = col + 1
        while next_col < len(cells) and cells[next_col] is None:
            next_col += 1

        parsed = split_cell(cell)
        if parsed["subject"]:
            start_idx = min(col, slot_limit - 1 if slot_limit > 0 else 0)
            end_idx = min(next_col, slot_limit)
            entries.append(
                {
                    "day": day,
                    "time": format_time_range(boundaries, start_idx, end_idx),
                    "room": room,
                    "subject": parsed["subject"],
                    "section": parsed["section"],
                    "teacher": parsed["teacher"],
                    "_day_order": day_order(day),
                    "_start_minutes": boundaries[start_idx],
                }
            )

        col = next_col

    return entries


def entry_matches_filter(entry: Dict[str, str], filter_token: str) -> bool:
    haystack = " ".join(
        [
            entry.get("subject", ""),
            entry.get("section", ""),
            entry.get("room", ""),
            entry.get("teacher", ""),
            entry.get("day", ""),
        ]
    ).lower()
    return filter_token in haystack


def filter_entries(entries: List[Dict[str, str]], class_filter: Optional[str]) -> List[Dict[str, str]]:
    token = (class_filter or "").strip().lower()
    if not token:
        return [row.copy() for row in entries]
    return [row.copy() for row in entries if entry_matches_filter(row, token)]


def extract_timetable(pdf_bytes: bytes) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""

            tables = page.extract_tables(TABLE_SETTINGS)
            if not tables:
                continue

            table = tables[0]
            slot_count = resolve_slot_count(table)
            if slot_count <= 0:
                continue

            boundaries = build_time_boundaries(slot_count)
            default_day = DAY_NAMES[index - 1] if index - 1 < len(DAY_NAMES) else f"Day {index}"
            day_label = detect_day_label(page_text, default_day)

            for row in table[5:]:
                room = (row[1] or "").strip()
                if not room or room.upper() == "ROOM ▼":
                    continue

                cells = row[2 : 2 + slot_count]
                if len(cells) < slot_count:
                    cells += [None] * (slot_count - len(cells))

                entries.extend(parse_row_cells(cells, room, day_label, boundaries))

    entries.sort(key=lambda item: (item.get("_day_order", 0), item.get("_start_minutes", 0), item.get("room", "")))

    for item in entries:
        item.pop("_day_order", None)
        item.pop("_start_minutes", None)

    return entries


def build_csv(entries: List[Dict[str, str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=FIELDNAMES, extrasaction="ignore")
    writer.writeheader()
    for row in entries:
        writer.writerow(row)
    return buffer.getvalue().encode("utf-8-sig")


def store_csv(entries: List[Dict[str, str]]) -> str:
    csv_bytes = build_csv(entries)
    token = uuid.uuid4().hex
    PARSED_TIMETABLES[token] = csv_bytes
    PROCESSED_RESULTS[token] = [row.copy() for row in entries]
    prune_cache(PARSED_TIMETABLES, CACHE_LIMIT)
    prune_cache(PROCESSED_RESULTS, CACHE_LIMIT)
    return token


@app.route("/", methods=["GET", "POST"])
def index():
    timetable = None
    download_token = None
    class_filter = ""
    active_upload_id = session.get("active_upload_id")
    active_upload = SESSION_UPLOADS.get(active_upload_id) if active_upload_id else None
    active_filename = active_upload.get("filename") if active_upload else None

    if request.method == "POST":
        uploaded = request.files.get("timetable")
        class_filter = (request.form.get("class_filter") or "").strip()
        has_new_upload = bool(uploaded and uploaded.filename)

        if has_new_upload:
            if not uploaded.filename.lower().endswith(".pdf"):
                flash("Only PDF files are supported right now.")
                return redirect(url_for("index"))

            pdf_bytes = uploaded.read()
            pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
            if pdf_hash in FULL_PARSE_CACHE:
                full_entries = [row.copy() for row in FULL_PARSE_CACHE[pdf_hash]]
            else:
                try:
                    full_entries = extract_timetable(pdf_bytes)
                except Exception as exc:  # noqa: BLE001 - surfacing parse errors to the UI
                    flash(f"We could not read that PDF: {exc}")
                    return redirect(url_for("index"))
                FULL_PARSE_CACHE[pdf_hash] = [row.copy() for row in full_entries]
                prune_cache(FULL_PARSE_CACHE, CACHE_LIMIT)

            upload_id = uuid.uuid4().hex
            SESSION_UPLOADS[upload_id] = {
                "filename": uploaded.filename,
                "entries": [row.copy() for row in full_entries],
            }
            prune_cache(SESSION_UPLOADS, CACHE_LIMIT)
            session["active_upload_id"] = upload_id
            active_filename = uploaded.filename
            entries = filter_entries(full_entries, class_filter)
        else:
            if not active_upload:
                flash("Please upload a PDF once, then you can search classes instantly in this session.")
                return redirect(url_for("index"))
            entries = filter_entries(active_upload.get("entries", []), class_filter)
            active_filename = active_upload.get("filename")

        if not entries:
            if class_filter:
                flash(
                    f"We did not find rows mentioning '{class_filter}'. Double-check the class name or clear the filter."
                )
            else:
                flash("No timetable rows were detected. Try uploading a clearer PDF or check the formatting.")
            return redirect(url_for("index"))

        timetable = entries
        download_token = store_csv(entries)

    return render_template(
        "index.html",
        timetable=timetable,
        download_token=download_token,
        class_filter=class_filter,
        saved_total=len(SAVED_LIBRARY),
        active_filename=active_filename,
    )


@app.route("/download/<token>")
def download(token: str):
    csv_bytes = PARSED_TIMETABLES.get(token)
    if not csv_bytes:
        flash("That export has expired. Please upload the timetable again.")
        return redirect(url_for("index"))

    return send_file(
        io.BytesIO(csv_bytes),
        mimetype="text/csv",
        as_attachment=True,
        download_name="timetable.csv",
    )


@app.route("/save/<token>", methods=["POST"])
def save_timetable(token: str):
    entries = PROCESSED_RESULTS.get(token)
    if not entries:
        flash("That timetable is no longer available to save. Please extract it again.")
        return redirect(url_for("index"))

    label = (request.form.get("save_label") or "").strip() or (request.form.get("class_filter") or "").strip()
    label = label or "Saved timetable"

    library_id = uuid.uuid4().hex
    SAVED_LIBRARY[library_id] = {
        "id": library_id,
        "label": label,
        "timestamp": datetime.utcnow(),
        "entries": [row.copy() for row in entries],
        "csv": PARSED_TIMETABLES.get(token) or build_csv(entries),
    }
    prune_cache(SAVED_LIBRARY, SAVED_LIMIT)
    flash("Timetable saved to your library.")
    return redirect(url_for("saved", highlight=library_id))


@app.route("/saved")
def saved():
    highlight = request.args.get("highlight")
    saved_items = sorted(SAVED_LIBRARY.values(), key=lambda item: item["timestamp"], reverse=True)
    return render_template("saved.html", saved_items=saved_items, highlight=highlight)


@app.route("/saved/<library_id>/download")
def download_saved(library_id: str):
    saved_entry = SAVED_LIBRARY.get(library_id)
    if not saved_entry:
        flash("We could not find that saved timetable anymore.")
        return redirect(url_for("saved"))

    csv_bytes = saved_entry.get("csv") or build_csv(saved_entry.get("entries", []))
    label_slug = re.sub(r"[^a-z0-9]+", "-", saved_entry.get("label", "").strip().lower()) or "timetable"
    filename = f"{label_slug}.csv"
    return send_file(
        io.BytesIO(csv_bytes),
        mimetype="text/csv",
        as_attachment=True,
        download_name=filename,
    )


if __name__ == "__main__":
    app.run(debug=True)
