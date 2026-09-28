import type { MidiLibraryFile, MidiLibraryFolder, MidiLibraryState } from "../types";

const DB_NAME = "achromatic-anamnesis-sciopticon-midi-library";
const DB_VERSION = 1;
const FOLDERS_STORE = "folders";
const FILES_STORE = "files";
const DEFAULT_FOLDER_ID = "default-library";
const DEFAULT_FOLDER_NAME = "Library";
const DEFAULT_DIFFICULTY = 1;
const MAX_DIFFICULTY = 20;

type StoredMidiFile = MidiLibraryFile & {
  data: ArrayBuffer;
};

export async function loadMidiLibrary(): Promise<MidiLibraryState> {
  const db = await openLibraryDb();
  await ensureDefaultFolder(db);
  const [folders, files] = await Promise.all([
    readAll<MidiLibraryFolder>(db, FOLDERS_STORE),
    readAll<StoredMidiFile>(db, FILES_STORE),
  ]);

  return {
    folders: folders.sort((a, b) => a.createdAt - b.createdAt),
    files: files
      .map(({ data: _data, ...file }) => ({
        ...file,
        displayName: normalizeDisplayName(file.displayName),
        difficulty: normalizeDifficulty(file.difficulty),
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

export async function createMidiLibraryFolder(name: string): Promise<MidiLibraryFolder> {
  const db = await openLibraryDb();
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("폴더 이름을 입력해 주세요.");

  const folder: MidiLibraryFolder = {
    id: createId(),
    name: trimmedName,
    createdAt: Date.now(),
  };

  await putValue(db, FOLDERS_STORE, folder);
  return folder;
}

export async function addMidiFilesToLibrary(files: File[], folderId: string): Promise<MidiLibraryFile[]> {
  const db = await openLibraryDb();
  const folder = await getValue<MidiLibraryFolder>(db, FOLDERS_STORE, folderId);
  if (!folder) throw new Error("선택한 폴더를 찾을 수 없습니다.");

  const midiFiles = files.filter(isMidiFile);
  if (midiFiles.length === 0) throw new Error("MIDI 파일만 추가할 수 있습니다.");

  const storedFiles: StoredMidiFile[] = [];
  for (const file of midiFiles) {
    const now = Date.now();
    storedFiles.push({
      id: createId(),
      folderId,
      name: file.name,
      displayName: null,
      size: file.size,
      type: file.type || "audio/midi",
      difficulty: DEFAULT_DIFFICULTY,
      createdAt: now,
      updatedAt: now,
      data: await file.arrayBuffer(),
    });
  }

  await putMany(db, FILES_STORE, storedFiles);
  return storedFiles.map(({ data: _data, ...file }) => file);
}

export async function loadMidiLibraryFile(fileId: string): Promise<File> {
  const db = await openLibraryDb();
  const storedFile = await getValue<StoredMidiFile>(db, FILES_STORE, fileId);
  if (!storedFile) throw new Error("MIDI 파일을 찾을 수 없습니다.");

  return new File([storedFile.data.slice(0)], storedFile.name, {
    type: storedFile.type || "audio/midi",
    lastModified: storedFile.updatedAt,
  });
}

export async function updateMidiLibraryFileDifficulty(fileId: string, difficulty: number): Promise<MidiLibraryFile> {
  const db = await openLibraryDb();
  const storedFile = await getValue<StoredMidiFile>(db, FILES_STORE, fileId);
  if (!storedFile) throw new Error("MIDI 파일을 찾을 수 없습니다.");

  const updatedFile: StoredMidiFile = {
    ...storedFile,
    difficulty: normalizeDifficulty(difficulty),
    updatedAt: Date.now(),
  };
  await putValue(db, FILES_STORE, updatedFile);

  const { data: _data, ...file } = updatedFile;
  return file;
}

export async function updateMidiLibraryFileDisplayName(fileId: string, displayName: string): Promise<MidiLibraryFile> {
  const db = await openLibraryDb();
  const storedFile = await getValue<StoredMidiFile>(db, FILES_STORE, fileId);
  if (!storedFile) throw new Error("MIDI 파일을 찾을 수 없습니다.");

  const updatedFile: StoredMidiFile = {
    ...storedFile,
    displayName: normalizeDisplayName(displayName),
    updatedAt: Date.now(),
  };
  await putValue(db, FILES_STORE, updatedFile);

  const { data: _data, ...file } = updatedFile;
  return file;
}

export async function moveMidiLibraryFile(fileId: string, folderId: string): Promise<MidiLibraryFile> {
  const db = await openLibraryDb();
  const [storedFile, targetFolder] = await Promise.all([
    getValue<StoredMidiFile>(db, FILES_STORE, fileId),
    getValue<MidiLibraryFolder>(db, FOLDERS_STORE, folderId),
  ]);
  if (!storedFile) throw new Error("MIDI 파일을 찾을 수 없습니다.");
  if (!targetFolder) throw new Error("이동할 폴더를 찾을 수 없습니다.");

  const movedFile: StoredMidiFile = {
    ...storedFile,
    folderId,
    updatedAt: Date.now(),
  };
  await putValue(db, FILES_STORE, movedFile);

  const { data: _data, ...file } = movedFile;
  return file;
}

export async function deleteMidiLibraryFile(fileId: string): Promise<void> {
  const db = await openLibraryDb();
  const storedFile = await getValue<StoredMidiFile>(db, FILES_STORE, fileId);
  if (!storedFile) throw new Error("MIDI 파일을 찾을 수 없습니다.");
  await deleteValue(db, FILES_STORE, fileId);
}

function openLibraryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
        db.createObjectStore(FOLDERS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        const filesStore = db.createObjectStore(FILES_STORE, { keyPath: "id" });
        filesStore.createIndex("folderId", "folderId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function ensureDefaultFolder(db: IDBDatabase): Promise<void> {
  const defaultFolder = await getValue<MidiLibraryFolder>(db, FOLDERS_STORE, DEFAULT_FOLDER_ID);
  if (defaultFolder) return;

  const folders = await readAll<MidiLibraryFolder>(db, FOLDERS_STORE);
  if (folders.length > 0) return;

  await putValue(db, FOLDERS_STORE, {
    id: DEFAULT_FOLDER_ID,
    name: DEFAULT_FOLDER_NAME,
    createdAt: Date.now(),
  });
}

function readAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function getValue<T>(db: IDBDatabase, storeName: string, id: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(id);

    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

function putValue<T>(db: IDBDatabase, storeName: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function putMany<T>(db: IDBDatabase, storeName: string, values: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    values.forEach((value) => store.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteValue(db: IDBDatabase, storeName: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function isMidiFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".mid") || lowerName.endsWith(".midi") || file.type === "audio/midi" || file.type === "audio/x-midi";
}

function normalizeDifficulty(difficulty: number | undefined): number {
  if (!Number.isFinite(difficulty)) return DEFAULT_DIFFICULTY;
  return Math.min(MAX_DIFFICULTY, Math.max(DEFAULT_DIFFICULTY, Math.round(difficulty as number)));
}

function normalizeDisplayName(displayName: string | null | undefined): string | null {
  if (typeof displayName !== "string") return null;
  return displayName.trim() || null;
}

function createId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
