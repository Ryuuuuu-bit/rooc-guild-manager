// Syncs member.characterClass from the guild's public Google Sheet
// ("Ragnarok Origin Classic" tracking sheet — members fill in their own
// class there). Admin-triggered only (a "ซิงค์จาก Sheet" button on the
// Members page) — never automatic, since matching/mapping needs a human
// glance before anything gets written.
import { env } from "@/lib/env";
import { CLASS_OPTIONS, type ClassOption } from "@/lib/classes";

export interface SheetRow {
  name: string;
  classRaw: string;
}

export interface ClassSyncProposal {
  memberId: string;
  memberDisplayName: string;
  currentClass: string | null;
  sheetName: string;
  sheetClassRaw: string;
  /** Best-guess class to prefill the review dropdown with — null when the
   * raw sheet value is ambiguous and has never been resolved for this
   * member before, so an admin has to pick manually. */
  suggestedClass: string | null;
}

export interface ClassSyncResult {
  proposals: ClassSyncProposal[];
  /** Sheet "Name" values with no matching member (by inGameName). */
  unmatchedSheetNames: string[];
  /** inGameName values shared by more than one member — skipped, since we
   * can't tell which member a sheet row is about. */
  duplicateNames: string[];
  totalSheetRows: number;
}

/**
 * Minimal RFC4180-ish CSV parser. Google Sheets' CSV export can quote
 * fields that contain commas/newlines (some of this sheet's stat/notes
 * columns do), so a naive `split(",")` would misalign columns on those
 * rows even though we only read two of them.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c === "\r") {
      if (text[i + 1] !== "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      }
      // else: bare \r before \n — let the \n branch handle the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sheetCsvUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${env.classSyncSheetId}/export?format=csv&gid=${env.classSyncSheetGid}`;
}

export async function fetchSheetRows(): Promise<SheetRow[]> {
  const res = await fetch(sheetCsvUrl(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `ดึงข้อมูลจาก Google Sheet ไม่สำเร็จ (HTTP ${res.status}) — ตรวจสอบว่า Sheet เปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" หรือยัง`
    );
  }
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error(
      'ดึงข้อมูลจาก Google Sheet ไม่สำเร็จ — Sheet อาจไม่ได้เปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" (ได้หน้า HTML กลับมาแทน CSV)'
    );
  }

  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.toLowerCase() === "name");
  const classIdx = header.findIndex((h) => h.toLowerCase().startsWith("class"));
  if (nameIdx === -1 || classIdx === -1) {
    throw new Error('ไม่พบคอลัมน์ "Name" หรือ "Class" ใน Sheet — โครงสร้างชีตอาจเปลี่ยนไปจากที่ตั้งค่าไว้');
  }

  const out: SheetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameIdx] ?? "").trim();
    const classRaw = (r[classIdx] ?? "").trim();
    if (!name || !classRaw) continue;
    out.push({ name, classRaw });
  }
  return out;
}

// Sheet class labels that map onto exactly one of our CLASS_OPTIONS —
// applied automatically. Anything else (e.g. "Wiz", "Doram", or a brand
// new label like "Sage") is ambiguous and needs an admin's pick, at least
// the first time it's seen for a given member.
const DIRECT_CLASS_MAP: Record<string, ClassOption> = {
  bio: "Bio",
  priest: "Priest",
  rouge: "Rouge",
  bard: "B/D",
  dance: "B/D",
  knight: "Knight",
};

interface MemberForSync {
  id: string;
  inGameName: string | null;
  characterClass: string | null;
  sheetClassRaw: string | null;
  displayName: string;
}

export function buildClassSyncProposals(members: MemberForSync[], sheetRows: SheetRow[]): ClassSyncResult {
  const byName = new Map<string, MemberForSync[]>();
  for (const m of members) {
    const key = m.inGameName?.trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(m);
    byName.set(key, list);
  }

  const proposals: ClassSyncProposal[] = [];
  const unmatchedSheetNames = new Set<string>();
  const duplicateNames = new Set<string>();

  for (const row of sheetRows) {
    const key = row.name.trim().toLowerCase();
    const matches = byName.get(key);
    if (!matches || matches.length === 0) {
      unmatchedSheetNames.add(row.name);
      continue;
    }
    if (matches.length > 1) {
      duplicateNames.add(row.name);
      continue;
    }

    const member = matches[0];
    const rawKey = row.classRaw.toLowerCase();
    const direct = DIRECT_CLASS_MAP[rawKey];
    const alreadyResolved = member.sheetClassRaw?.trim().toLowerCase() === rawKey && !!member.characterClass;

    let suggestedClass: string | null;
    if (direct) {
      suggestedClass = direct;
    } else if (alreadyResolved) {
      suggestedClass = member.characterClass;
    } else {
      suggestedClass = null;
    }

    const nothingToDo =
      suggestedClass !== null &&
      suggestedClass === member.characterClass &&
      member.sheetClassRaw?.trim().toLowerCase() === rawKey;
    if (nothingToDo) continue;

    proposals.push({
      memberId: member.id,
      memberDisplayName: member.displayName,
      currentClass: member.characterClass,
      sheetName: row.name,
      sheetClassRaw: row.classRaw,
      suggestedClass,
    });
  }

  return {
    proposals,
    unmatchedSheetNames: [...unmatchedSheetNames],
    duplicateNames: [...duplicateNames],
    totalSheetRows: sheetRows.length,
  };
}

export function isValidClassOption(value: string): value is ClassOption {
  return (CLASS_OPTIONS as readonly string[]).includes(value);
}
