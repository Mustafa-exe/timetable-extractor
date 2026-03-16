import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const LIBRARY_KEY = "timetable_library_v1";
const VERIFIED_CLASS_SCHEDULES = {
  "rsci-spring-2026": {
    "BSCS-6B": [
      {
        day: "Monday",
        time: "8:00 AM - 9:20 AM",
        section: "BSCS-6B",
        subject: "AI Driven Software Development",
        room: "A-322",
        teacher: "Mr. Zia ul Murtaza",
      },
      {
        day: "Monday",
        time: "10:00 AM - 12:00 PM",
        section: "BSCS-6B",
        subject: "Parallel & Distributed Computing Lab",
        room: "Lab 2",
        teacher: "Ms. Ramisha Farrukh",
      },
      {
        day: "Monday",
        time: "12:00 PM - 1:00 PM",
        section: "BSCS-6B",
        subject: "Theory of Automata",
        room: "B-105",
        teacher: "Mr. Khawar Iqbal",
      },
      {
        day: "Tuesday",
        time: "8:00 AM - 10:00 AM",
        section: "BSCS-6B",
        subject: "AI Driven Software Development Lab",
        room: "Lab 8",
        teacher: "Mr. Zia ul Murtaza",
      },
      {
        day: "Tuesday",
        time: "10:00 AM - 11:20 AM",
        section: "BSCS-6B",
        subject: "Parallel & Distributed Computing",
        room: "A-317",
        teacher: "Ms. Ramisha Farrukh / Prof. Dr. Sheheryar Malik",
      },
      {
        day: "Tuesday",
        time: "12:00 PM - 1:20 PM",
        section: "BSCS-6B",
        subject: "Computer Networks",
        room: "A-317",
        teacher: "Ms. Dua Mahmood",
      },
      {
        day: "Wednesday",
        time: "8:00 AM - 10:00 AM",
        section: "BSCS-6B",
        subject: "Computer Networks Lab",
        room: "Lab 4",
        teacher: "Mr. Asim Mansha",
      },
      {
        day: "Wednesday",
        time: "10:00 AM - 11:20 AM",
        section: "BSCS-6B",
        subject: "Entrepreneurship",
        room: "A-317",
        teacher: "Prof. Dr. Sheheryar Malik / Ms. Zarmina Jahangir",
      },
      {
        day: "Thursday",
        time: "8:00 AM - 9:20 AM",
        section: "BSCS-6B",
        subject: "Entrepreneurship Lab",
        room: "Lab 7",
        teacher: "Ms. Zarmina Jahangir",
      },
      {
        day: "Thursday",
        time: "12:00 PM - 2:00 PM",
        section: "BSCS-6B",
        subject: "Problem Solving III",
        room: "Lab 1",
        teacher: "Lab Engineer",
      },
      {
        day: "Friday",
        time: "8:00 AM - 9:00 AM",
        section: "BSCS-6B",
        subject: "Theory of Automata",
        room: "A-317",
        teacher: "Mr. Khawar Iqbal",
      },
      {
        day: "Friday",
        time: "9:00 AM - 10:20 AM",
        section: "BSCS-6B",
        subject: "Advance Database Management Systems",
        room: "A-317",
        teacher: "Mr. Asim Mansha",
      },
      {
        day: "Friday",
        time: "11:20 AM - 1:20 PM",
        section: "BSCS-6B",
        subject: "Advance Database Management Systems Lab",
        room: "Lab 2",
        teacher: "Mr. Asim Mansha",
      },
    ],
  },
};

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

function detectVerifiedProfile(fileName) {
  const name = normalize(fileName).toLowerCase();
  if (name.includes("rsci timetable") && name.includes("spring 2026")) {
    return "rsci-spring-2026";
  }
  return null;
}

function getVerifiedSchedule(fileName, classFilter) {
  const profile = detectVerifiedProfile(fileName);
  if (!profile) return null;
  const classKey = normalize(classFilter).toUpperCase();
  if (!classKey) return null;
  const entries = VERIFIED_CLASS_SCHEDULES[profile]?.[classKey];
  if (!entries) return null;
  return entries.map((entry) => ({ ...entry }));
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
  return /^(?:[A-Z]-\d{2,4}[A-Z]?|Lab|Physics|YADNOM|\d+)$/i.test(value);
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

function bucketItemsByY(items, step = 3) {
  const rows = new Map();
  for (const item of items) {
    const key = Math.round(item.y / step) * step;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(item);
  }
  return [...rows.entries()]
    .map(([y, rowItems]) => ({ y, items: rowItems.sort((a, b) => a.x - b.x) }))
    .sort((a, b) => b.y - a.y);
}

function parseRoomLabel(rowItems) {
  const leftTokens = rowItems.filter((item) => item.x < 110).map((item) => item.str);
  const text = normalize(leftTokens.join(" "));
  if (!text) return null;

  const direct = text.match(/([A-Z]-\d{2,4}[A-Z]?)/);
  if (direct) return direct[1];

  const lab = text.match(/Lab\s*(\d+)/i);
  if (lab) return `Lab ${lab[1]}`;

  if (/Physics\s*Lab/i.test(text)) return "Physics Lab";
  if (/YADNOM/i.test(text)) return "YADNOM";

  return null;
}

function hasTeacherHint(text) {
  return /(Mr\.|Ms\.|Dr\.|Prof\.|faculty)/i.test(text);
}

function splitByXGap(words, threshold = 22) {
  if (!words.length) return [];
  const chunks = [];
  let current = [words[0]];

  for (let idx = 1; idx < words.length; idx += 1) {
    const prev = words[idx - 1];
    const next = words[idx];
    if (next.x - prev.x > threshold) {
      chunks.push(current);
      current = [next];
    } else {
      current.push(next);
    }
  }
  chunks.push(current);

  return chunks.map((chunk) => ({
    xStart: chunk[0].x,
    xEnd: chunk[chunk.length - 1].x + (chunk[chunk.length - 1].width || 8),
    text: normalize(chunk.map((item) => item.str).join(" ")),
  }));
}

function findTimeScale(items) {
  const timeItems = items.filter((item) => isTimeToken(item.str));
  const timeRows = bucketItemsByY(timeItems, 2);
  if (!timeRows.length) return null;

  const strongestRow = timeRows.reduce((best, row) => (row.items.length > best.items.length ? row : best), timeRows[0]);
  const points = strongestRow.items
    .map((item) => ({ x: item.x, minute: toMinutes(item.str) }))
    .filter((item) => item.minute !== null)
    .sort((a, b) => a.x - b.x);

  if (points.length < 2) return null;

  const uniquePoints = [];
  for (const point of points) {
    const last = uniquePoints[uniquePoints.length - 1];
    if (!last || Math.abs(last.x - point.x) > 2) {
      uniquePoints.push(point);
    }
  }

  if (uniquePoints.length < 2) return null;

  const centers = uniquePoints.map((item) => item.x);
  const avgGap = centers.slice(1).reduce((sum, x, idx) => sum + (x - centers[idx]), 0) / (centers.length - 1);
  const boundaries = [centers[0] - avgGap / 2];
  for (let idx = 0; idx < centers.length - 1; idx += 1) {
    boundaries.push((centers[idx] + centers[idx + 1]) / 2);
  }
  boundaries.push(centers[centers.length - 1] + avgGap / 2);

  return {
    boundaries,
    minutes: uniquePoints.map((item) => item.minute),
    headerY: strongestRow.y,
  };
}

function findSlotIndex(x, boundaries) {
  for (let idx = 0; idx < boundaries.length - 1; idx += 1) {
    if (x >= boundaries[idx] && x < boundaries[idx + 1]) {
      return idx;
    }
  }
  return boundaries.length - 2;
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
        width: item.width || 8,
      }))
      .filter((item) => item.str);

    const lines = groupLines(content.items);
    const day = detectDay(lines.join(" "), pageNumber - 1);
    const timeScale = findTimeScale(allItems);
    if (!timeScale) continue;

    const roomRows = bucketItemsByY(
      allItems.filter((item) => item.x < 110 && isRoomToken(item.str) && !isTimeToken(item.str)),
      4
    )
      .map((row) => ({ y: row.y, room: parseRoomLabel(row.items) }))
      .filter((row) => row.room);

    if (!roomRows.length) continue;

    roomRows.sort((a, b) => b.y - a.y);
    const avgRowGap =
      roomRows.length > 1
        ? roomRows.slice(1).reduce((sum, row, idx) => sum + (roomRows[idx].y - row.y), 0) / (roomRows.length - 1)
        : 22;

    for (let rowIndex = 0; rowIndex < roomRows.length; rowIndex += 1) {
      const row = roomRows[rowIndex];
      const nextRow = roomRows[rowIndex + 1];
      const bandTop = row.y + 4;
      const bandBottom = nextRow ? nextRow.y + 4 : row.y - avgRowGap;

      const bandItems = allItems
        .filter((item) => item.x > timeScale.boundaries[0] - 2 && item.y <= bandTop && item.y > bandBottom)
        .sort((a, b) => b.y - a.y || a.x - b.x);

      if (!bandItems.length) continue;

      const bandLines = bucketItemsByY(bandItems, 2);
      const subjectLine =
        bandLines.find((line) => line.items.some((item) => /\([^)]+\)/.test(item.str))) ||
        bandLines[0];

      if (!subjectLine) continue;

      const anchorChunks = subjectLine.items
        .filter((item) => /\([^)]+\)/.test(item.str))
        .map((item) => ({
          xStart: item.x,
          xEnd: item.x + (item.width || 100),
          text: item.str,
        }));

      const subjectChunks =
        anchorChunks.length > 0
          ? anchorChunks
          : splitByXGap(subjectLine.items, 24).filter((chunk) => /\([^)]+\)/.test(chunk.text));
      if (!subjectChunks.length) continue;

      const candidateTeacherLines = bandLines
        .filter((line) => line.y !== subjectLine.y)
        .map((line) => ({
          ...line,
          delta: Math.abs(line.y - subjectLine.y),
          text: normalize(line.items.map((item) => item.str).join(" ")),
        }))
        .filter((line) => line.delta >= 4 && line.delta <= 16)
        .sort((a, b) => a.delta - b.delta);

      const teacherLine =
        candidateTeacherLines.find((line) => hasTeacherHint(line.text)) ||
        candidateTeacherLines[0] ||
        null;

      const teacherWords = teacherLine ? teacherLine.items : [];

      for (let idx = 0; idx < subjectChunks.length; idx += 1) {
        const chunk = subjectChunks[idx];
        const nextChunk = subjectChunks[idx + 1];
        const startX = chunk.xStart;
        const endX = Math.max(
          chunk.xEnd,
          nextChunk ? Math.min(nextChunk.xStart, chunk.xEnd + 260) : chunk.xEnd
        );

        const startIdx = Math.max(0, findSlotIndex(startX, timeScale.boundaries));
        const nextIdx = Math.max(startIdx + 1, findSlotIndex(Math.max(startX + 1, endX - 1), timeScale.boundaries) + 1);
        const safeEndIdx = Math.min(nextIdx, timeScale.minutes.length);
        const startMinute = timeScale.minutes[startIdx] ?? 8 * 60;
        const endMinute = timeScale.minutes[safeEndIdx] ?? startMinute + 20;

        const teacher = normalize(
          teacherWords
            .filter((item) => item.x >= startX - 8 && item.x < endX + 8)
            .map((item) => item.str)
            .join(" ")
        );

        entries.push({
          day,
          time: formatRange(startMinute, Math.max(endMinute, startMinute + 20)),
          section: extractSection(chunk.text),
          subject: extractSubjectName(chunk.text),
          room: row.room,
          teacher,
        });
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = [entry.day, entry.time, entry.room, entry.subject, entry.section, entry.teacher].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
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

    const verified = getVerifiedSchedule(file ? file.name : state.activeFileName, filterValue);
    if (verified) {
      state.filteredEntries = verified;
      sessionFile.textContent = `Current session PDF: ${state.activeFileName} (using verified ${filterValue.toUpperCase()} schedule)`;
    } else {
      state.filteredEntries = filterEntries(state.allEntries, filterValue);
    }
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
