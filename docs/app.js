import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LIBRARY_KEY = "timetable_library_v1";

const state = {
  allEntries: [],
  filteredEntries: [],
  activeFileName: "",
};

const fileInput = document.querySelector("#timetable");
const fileNameEl = document.querySelector("[data-file-name]");
const fileControl = document.querySelector("[data-file-control]");
const extractForm = document.querySelector("#extract-form");
const filterInput = document.querySelector("#class_filter");
const clearBtn = document.querySelector("#clear-btn");
const saveBtn = document.querySelector("#save-btn");
const downloadBtn = document.querySelector("#download-btn");
const resultsBody = document.querySelector("#results-body");
const resultsWrap = document.querySelector("#results-wrap");
const placeholder = document.querySelector("#placeholder");
const resultsTitle = document.querySelector("#results-title");
const sessionFile = document.querySelector("[data-session-file]");
const libraryList = document.querySelector("#library-list");
const libraryEmpty = document.querySelector("#library-empty");
const libraryCount = document.querySelector("[data-library-count]");
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];

function setLoading(loading) {
  document.body.classList.toggle("is-loading", loading);
}

function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function toMinutes(label) {
  const match = normalize(label).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}

function toAmPm(totalMinutes) {
  let hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatRange(start, end) {
  return `${toAmPm(start)} - ${toAmPm(end)}`;
}

function detectDay(text, fallbackIndex) {
  const upper = text.toUpperCase();
  for (const day of DAYS) {
    if (upper.includes(day.toUpperCase())) return day;
  }
  return DAYS[fallbackIndex] || `Day ${fallbackIndex + 1}`;
}

function isRoomToken(text) {
  const value = normalize(text);
  if (!value) return false;
  return /^(?:[A-Z]-\d{2,4}[A-Z]?|Lab\s*\d+|Physics\s*Lab|YADNOM)$/i.test(value);
}

function isTimeToken(text) {
  return /^\d{1,2}:\d{2}$/.test(normalize(text));
}

function isSubjectToken(text) {
  const value = normalize(text);
  if (!value) return false;
  return /\([^)]+\)/.test(value) && !isTimeToken(value) && !isRoomToken(value);
}

function extractSection(subjectText) {
  const match = subjectText.match(/\(([^)]+)\)/);
  return match ? normalize(match[1]) : "";
}

function extractSubjectName(subjectText) {
  return normalize(subjectText.replace(/\(([^)]+)\)/g, "").trim());
}

function groupLines(items) {
  const buckets = new Map();

  for (const item of items) {
    const str = normalize(item.str);
    if (!str) continue;
    const y = Math.round(item.transform[5]);
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push(item);
  }

  const sortedY = [...buckets.keys()].sort((a, b) => b - a);
  return sortedY.map((y) => {
    const row = buckets.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
    return normalize(row.map((item) => item.str).join(" "));
  });
}

async function parsePdf(file) {
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const entries = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const allItems = content.items
      .map((item) => ({
        str: normalize(item.str),
        x: item.transform[4],
        y: item.transform[5],
      }))
      .filter((item) => item.str);

    const lines = groupLines(content.items);
    const day = detectDay(lines.join(" "), pageNumber - 1);

    const timeItems = allItems.filter((item) => isTimeToken(item.str)).sort((a, b) => a.x - b.x);
    const minuteMarks = [...new Map(timeItems.map((item) => [item.x, toMinutes(item.str)])).entries()]
      .filter(([, minute]) => minute !== null)
      .sort((a, b) => a[0] - b[0]);

    let slotBoundaries = [];
    if (minuteMarks.length >= 2) {
      const firstMinute = minuteMarks[0][1];
      const xPoints = minuteMarks.map(([x]) => x);
      const avgGap = xPoints.slice(1).reduce((sum, x, idx) => sum + (x - xPoints[idx]), 0) / (xPoints.length - 1);
      slotBoundaries = xPoints.map((x, idx) => ({ x, minute: firstMinute + idx * 20 }));
      slotBoundaries.push({ x: xPoints[xPoints.length - 1] + avgGap, minute: firstMinute + xPoints.length * 20 });
    } else {
      slotBoundaries = Array.from({ length: 34 }, (_, idx) => ({ x: 100 + idx * 30, minute: 8 * 60 + idx * 20 }));
    }

    const rows = new Map();
    for (const item of allItems) {
      const key = Math.round(item.y / 6) * 6;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(item);
    }

    const sortedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);

    for (const [rowY, rowItemsRaw] of sortedRows) {
      const rowItems = rowItemsRaw.sort((a, b) => a.x - b.x);
      const roomCell = rowItems.find((item) => isRoomToken(item.str));
      if (!roomCell) continue;

      const room = roomCell.str;
      const subjects = rowItems.filter((item) => isSubjectToken(item.str));
      if (!subjects.length) continue;

      const teacherRow = sortedRows.find(([candidateY]) => Math.abs(candidateY - rowY) >= 5 && Math.abs(candidateY - rowY) <= 22);
      const teacherItems = teacherRow ? teacherRow[1] : [];

      for (let idx = 0; idx < subjects.length; idx += 1) {
        const current = subjects[idx];
        const next = subjects[idx + 1];

        const startBoundaryIndex = slotBoundaries.findIndex((slot, sIdx) => {
          const nextSlot = slotBoundaries[sIdx + 1];
          return nextSlot && current.x >= slot.x && current.x < nextSlot.x;
        });

        const fallbackStart = Math.max(0, startBoundaryIndex);
        let endBoundaryIndex = fallbackStart + 1;

        if (next) {
          const nextStartIndex = slotBoundaries.findIndex((slot, sIdx) => {
            const nextSlot = slotBoundaries[sIdx + 1];
            return nextSlot && next.x >= slot.x && next.x < nextSlot.x;
          });
          if (nextStartIndex > fallbackStart) {
            endBoundaryIndex = nextStartIndex;
          }
        }

        endBoundaryIndex = Math.min(endBoundaryIndex, slotBoundaries.length - 1);
        const startMinute = slotBoundaries[fallbackStart]?.minute ?? 8 * 60;
        const endMinute = slotBoundaries[endBoundaryIndex]?.minute ?? startMinute + 20;

        const subjectXMax = next ? next.x : current.x + 140;
        const teacher = teacherItems
          .filter((item) => item.x >= current.x - 10 && item.x <= subjectXMax + 20)
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        entries.push({
          day,
          time: formatRange(startMinute, Math.max(endMinute, startMinute + 20)),
          section: extractSection(current.str),
          subject: extractSubjectName(current.str),
          room,
          teacher,
        });
      }
    }
  }

  return entries;
}

function filterEntries(entries, value) {
  const token = normalize(value).toLowerCase();
  if (!token) return [...entries];
  return entries.filter((entry) =>
    [entry.day, entry.time, entry.section, entry.subject, entry.room, entry.teacher].join(" ").toLowerCase().includes(token)
  );
}

function renderTable(entries) {
  resultsBody.innerHTML = "";

  for (const row of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.day || "—"}</td>
      <td>${row.time || "—"}</td>
      <td>${row.section || "—"}</td>
      <td>${row.subject || "—"}</td>
      <td>${row.room || "—"}</td>
      <td>${row.teacher || "—"}</td>
    `;
    resultsBody.appendChild(tr);
  }

  const hasRows = entries.length > 0;
  resultsWrap.hidden = !hasRows;
  placeholder.hidden = hasRows;
  saveBtn.disabled = !hasRows;
  downloadBtn.disabled = !hasRows;
}

function toCsv(entries) {
  const header = ["day", "time", "section", "subject", "room", "teacher"];
  const rows = entries.map((row) => header.map((key) => `"${String(row[key] ?? "").replaceAll("\"", "\"\"")}"`).join(","));
  return `${header.join(",")}\n${rows.join("\n")}`;
}

function downloadCsv(entries, fileName = "timetable.csv") {
  const blob = new Blob([toCsv(entries)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function getLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]");
  } catch {
    return [];
  }
}

function setLibrary(items) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(items.slice(0, 20)));
}

function renderLibrary() {
  const items = getLibrary();
  libraryCount.textContent = String(items.length);
  libraryList.innerHTML = "";
  const empty = items.length === 0;
  libraryEmpty.hidden = !empty;

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "library-card";
    card.innerHTML = `
      <div class="library-card__header">
        <div>
          <p class="eyebrow">${item.label}</p>
          <h3>${item.entries.length} sessions</h3>
          <p class="helper">Saved ${new Date(item.savedAt).toLocaleString()}</p>
        </div>
        <div class="library-card__actions">
          <button class="ghost-btn" data-action="load">Load</button>
          <button class="secondary-btn" data-action="download">CSV</button>
          <button class="ghost-btn" data-action="delete">Delete</button>
        </div>
      </div>
    `;

    card.querySelector('[data-action="load"]').addEventListener("click", () => {
      state.allEntries = item.entries;
      state.filteredEntries = filterEntries(state.allEntries, filterInput.value);
      resultsTitle.textContent = filterInput.value.trim() ? `${filterInput.value.trim()} schedule` : "All detected sessions";
      renderTable(state.filteredEntries);
      activateTab("extractor");
    });

    card.querySelector('[data-action="download"]').addEventListener("click", () => {
      downloadCsv(item.entries, `${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "timetable"}.csv`);
    });

    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const updated = getLibrary().filter((x) => x.id !== item.id);
      setLibrary(updated);
      renderLibrary();
    });

    libraryList.appendChild(card);
  }
}

function activateTab(tab) {
  for (const button of tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === tab);
  }
  for (const panel of panels) {
    panel.hidden = panel.dataset.panel !== tab;
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileNameEl.textContent = file ? file.name : "No file selected";
  fileControl.dataset.hasFile = file ? "true" : "false";
});

clearBtn.addEventListener("click", () => {
  filterInput.value = "";
  state.filteredEntries = filterEntries(state.allEntries, "");
  resultsTitle.textContent = "All detected sessions";
  if (state.allEntries.length) renderTable(state.filteredEntries);
});

extractForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const filterValue = filterInput.value.trim();
  const file = fileInput.files?.[0];

  if (!file && state.allEntries.length === 0) {
    alert("Upload a PDF first.");
    return;
  }

  try {
    setLoading(true);

    if (file) {
      state.allEntries = await parsePdf(file);
      state.activeFileName = file.name;
      sessionFile.textContent = `Current session PDF: ${file.name}`;
    }

    state.filteredEntries = filterEntries(state.allEntries, filterValue);
    resultsTitle.textContent = filterValue ? `${filterValue} schedule` : "All detected sessions";

    if (state.filteredEntries.length === 0) {
      placeholder.hidden = false;
      placeholder.innerHTML = "<h3>No rows found</h3><p>Try another class filter or upload a clearer timetable PDF.</p>";
      resultsWrap.hidden = true;
      saveBtn.disabled = true;
      downloadBtn.disabled = true;
      return;
    }

    renderTable(state.filteredEntries);
  } catch (error) {
    console.error(error);
    alert("Could not parse this PDF in browser. Try another timetable file.");
  } finally {
    setLoading(false);
  }
});

saveBtn.addEventListener("click", () => {
  if (!state.filteredEntries.length) return;
  const label = (filterInput.value || state.activeFileName || "Saved timetable").trim();
  const item = {
    id: crypto.randomUUID(),
    label,
    savedAt: Date.now(),
    entries: state.filteredEntries,
  };
  const updated = [item, ...getLibrary()];
  setLibrary(updated);
  renderLibrary();
  activateTab("library");
});

downloadBtn.addEventListener("click", () => {
  if (!state.filteredEntries.length) return;
  const name = (filterInput.value || "timetable").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "timetable";
  downloadCsv(state.filteredEntries, `${name}.csv`);
});

renderLibrary();
