import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderPlus, Pencil, Play, Settings, Trash2, Upload, X } from "lucide-react";
import { ControlPanel } from "./components/ControlPanel";
import { PianoRollCanvas } from "./components/PianoRollCanvas";
import { PlaybackEngine } from "./engine/playbackEngine";
import { useMidiInput } from "./hooks/useMidiInput";
import { AudioEngine } from "./services/audioEngine";
import {
  addMidiFilesToLibrary,
  createMidiLibraryFolder,
  deleteMidiLibraryFile,
  loadMidiLibrary,
  loadMidiLibraryFile,
  moveMidiLibraryFile,
  updateMidiLibraryFileDisplayName,
  updateMidiLibraryFileDifficulty,
} from "./services/midiLibrary";
import { parseMidiFile } from "./services/midiParser";
import type { AppSettings, MidiLibraryState, MidiNoteMessage, ParsedMidi, PracticeMode } from "./types";
import { loadSettings, saveSettings } from "./utils/storage";
import "./styles.css";

type CalibrationStep = "idle" | "low" | "high";
type AppView = "select" | "perform";
type PerformanceKind = "midi" | "free";
type SoundFontStatus = {
  status: "loading" | "error";
  message?: string;
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [midi, setMidi] = useState<ParsedMidi | null>(null);
  const [library, setLibrary] = useState<MidiLibraryState>({ folders: [], files: [] });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedLibraryFileId, setSelectedLibraryFileId] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [isAddingLibraryFiles, setIsAddingLibraryFiles] = useState(false);
  const [enteringLibraryFileIds, setEnteringLibraryFileIds] = useState<string[]>([]);
  const [view, setView] = useState<AppView>("select");
  const [performanceKind, setPerformanceKind] = useState<PerformanceKind>("midi");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState({ hits: 0, misses: 0, early: 0, late: 0 });
  const [waitGroup, setWaitGroup] = useState({ startTick: null as number | null, pending: [] as number[], completed: [] as number[] });
  const [zoom, setZoom] = useState(1);
  const [panMidi, setPanMidi] = useState(0);
  const [calibrationStep, setCalibrationStep] = useState<CalibrationStep>("idle");
  const [soundFontStatus, setSoundFontStatus] = useState<SoundFontStatus | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const calibrationMinRef = useRef<number | null>(null);
  const lastUiSnapshotMsRef = useRef(0);
  const audio = useMemo(() => new AudioEngine(), []);
  const engine = useMemo(() => new PlaybackEngine(settings, audio), [audio]);
  const activeMidi = performanceKind === "free" ? null : midi;
  const activeLibraryFile = performanceKind === "midi"
    ? library.files.find((file) => file.id === selectedLibraryFileId) ?? null
    : null;

  const prepareSoundFont = useCallback(async (): Promise<boolean> => {
    if (audio.isReady()) return true;
    setSoundFontStatus({ status: "loading" });
    try {
      await audio.prepare();
      setSoundFontStatus(null);
      return true;
    } catch (error) {
      setSoundFontStatus({
        status: "error",
        message: error instanceof Error ? error.message : "내장 SoundFont를 초기화하지 못했습니다.",
      });
      return false;
    }
  }, [audio]);

  const refreshLibrary = useCallback(async (preferredFolderId?: string) => {
    const nextLibrary = await loadMidiLibrary();
    setLibrary(nextLibrary);
    setSelectedFolderId((currentFolderId) => {
      if (currentFolderId && nextLibrary.folders.some((folder) => folder.id === currentFolderId)) return currentFolderId;
      if (preferredFolderId && nextLibrary.folders.some((folder) => folder.id === preferredFolderId)) return preferredFolderId;
      return nextLibrary.folders[0]?.id ?? null;
    });
    setSelectedLibraryFileId((currentFileId) => {
      if (!currentFileId || nextLibrary.files.some((file) => file.id === currentFileId)) return currentFileId;
      return null;
    });
  }, []);

  useEffect(() => {
    engine.setSettings(settings);
    saveSettings(settings);
  }, [engine, settings]);

  useEffect(() => {
    let cancelled = false;
    loadMidiLibrary()
      .then((nextLibrary) => {
        if (cancelled) return;
        setLibrary(nextLibrary);
        setSelectedFolderId(nextLibrary.folders[0]?.id ?? null);
      })
      .catch((error) => {
        if (!cancelled) setLibraryError(error instanceof Error ? error.message : "MIDI 라이브러리를 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    engine.setMidi(activeMidi);
  }, [activeMidi, engine]);

  const handleMidiMessage = useCallback(
    (message: MidiNoteMessage) => {
      if (message.type === "noteon" && calibrationStep !== "idle") {
        if (calibrationStep === "low") {
          calibrationMinRef.current = message.midi;
          setCalibrationStep("high");
          return;
        }
        const minMidi = Math.min(calibrationMinRef.current ?? message.midi, message.midi);
        const maxMidi = Math.max(calibrationMinRef.current ?? message.midi, message.midi);
        setSettings((current) => ({ ...current, userKeyRange: { minMidi, maxMidi } }));
        calibrationMinRef.current = null;
        setCalibrationStep("idle");
        return;
      }
      if (!audio.isReady()) setSoundFontStatus({ status: "loading" });
      void engine.handleMidiMessage(message)
        .then(() => setSoundFontStatus(null))
        .catch((error) => {
          setSoundFontStatus({
            status: "error",
            message: error instanceof Error ? error.message : "내장 SoundFont를 초기화하지 못했습니다.",
          });
        });
    },
    [audio, calibrationStep, engine],
  );

  const { supported: midiSupported, devices, error: midiError } = useMidiInput({
    selectedInputId: settings.selectedMidiInputId,
    onMessage: handleMidiMessage,
  });

  useEffect(() => {
    if (!settings.selectedMidiInputName || devices.length === 0) return;
    const matching = devices.find((device) => device.name === settings.selectedMidiInputName);
    if (matching && matching.id !== settings.selectedMidiInputId) {
      setSettings((current) => ({ ...current, selectedMidiInputId: matching.id }));
      return;
    }
    if (settings.selectedMidiInputId && !devices.some((device) => device.id === settings.selectedMidiInputId)) {
      setSettings((current) => ({ ...current, selectedMidiInputId: null }));
    }
  }, [devices, settings.selectedMidiInputId, settings.selectedMidiInputName]);

  const refreshSnapshot = useCallback((force = false) => {
    const now = performance.now();
    if (!force && now - lastUiSnapshotMsRef.current < 125) return;
    lastUiSnapshotMsRef.current = now;
    const snapshot = engine.getSnapshot();
    setCurrentTime(snapshot.timeSec);
    setIsPlaying(snapshot.isPlaying);
    setScore(snapshot.score);
    setWaitGroup(snapshot.waitGroup);
  }, [engine]);

  const selectMidiFile = useCallback(async (file: File, libraryFileId: string | null) => {
    const parsed = await parseMidiFile(file);
    setMidi(parsed);
    setSelectedLibraryFileId(libraryFileId);
    setPerformanceKind("midi");
    setSettings((current) => ({
      ...current,
      selectedTrackIds: parsed.tracks.map((track) => track.id),
    }));
  }, []);

  const handleLibraryFileSelect = useCallback(async (fileId: string) => {
    try {
      setLibraryError(null);
      const file = await loadMidiLibraryFile(fileId);
      await selectMidiFile(file, fileId);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "MIDI 파일을 열지 못했습니다.");
    }
  }, [selectMidiFile]);

  const handleAddLibraryFiles = useCallback(async (files: File[]) => {
    const targetFolderId = selectedFolderId ?? library.folders[0]?.id;
    if (!targetFolderId) return;

    setIsAddingLibraryFiles(true);
    setLibraryError(null);
    try {
      const addedFiles = await addMidiFilesToLibrary(files, targetFolderId);
      const addedFileIds = addedFiles.map((file) => file.id);
      setEnteringLibraryFileIds((current) => [...new Set([...current, ...addedFileIds])]);
      await refreshLibrary(targetFolderId);
      window.setTimeout(() => {
        setEnteringLibraryFileIds((current) => current.filter((fileId) => !addedFileIds.includes(fileId)));
      }, 320);
      if (addedFiles[0]) {
        const storedFile = await loadMidiLibraryFile(addedFiles[0].id);
        await selectMidiFile(storedFile, addedFiles[0].id);
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "MIDI 파일을 추가하지 못했습니다.");
    } finally {
      setIsAddingLibraryFiles(false);
    }
  }, [library.folders, refreshLibrary, selectMidiFile, selectedFolderId]);

  const handleCreateFolder = useCallback(async (name: string) => {
    try {
      setLibraryError(null);
      const folder = await createMidiLibraryFolder(name);
      await refreshLibrary(folder.id);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "폴더를 만들지 못했습니다.");
    }
  }, [refreshLibrary]);

  const handleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolderId(folderId);
    const selectedFile = library.files.find((file) => file.id === selectedLibraryFileId);
    if (selectedFile?.folderId === folderId) return;
    setSelectedLibraryFileId(null);
    setMidi(null);
  }, [library.files, selectedLibraryFileId]);

  const handleDifficultyChange = useCallback(async (fileId: string, difficulty: number) => {
    setLibraryError(null);
    try {
      const updatedFile = await updateMidiLibraryFileDifficulty(fileId, difficulty);
      setLibrary((current) => ({
        ...current,
        files: current.files.map((file) => file.id === fileId ? updatedFile : file),
      }));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "난이도를 저장하지 못했습니다.");
    }
  }, []);

  const handleDisplayNameChange = useCallback(async (fileId: string, displayName: string) => {
    setLibraryError(null);
    try {
      const updatedFile = await updateMidiLibraryFileDisplayName(fileId, displayName);
      setLibrary((current) => ({
        ...current,
        files: current.files.map((file) => file.id === fileId ? updatedFile : file),
      }));
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "이름을 저장하지 못했습니다.");
    }
  }, []);

  const handleMoveLibraryFile = useCallback(async (fileId: string, folderId: string) => {
    setLibraryError(null);
    try {
      const movedFile = await moveMidiLibraryFile(fileId, folderId);
      setLibrary((current) => ({
        ...current,
        files: current.files.map((file) => file.id === fileId ? movedFile : file),
      }));
      if (fileId === selectedLibraryFileId) {
        setSelectedLibraryFileId(null);
        setMidi(null);
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "MIDI 파일을 이동하지 못했습니다.");
    }
  }, [selectedLibraryFileId]);

  const handleDeleteLibraryFile = useCallback(async (fileId: string) => {
    setLibraryError(null);
    try {
      await deleteMidiLibraryFile(fileId);
      setLibrary((current) => ({
        ...current,
        files: current.files.filter((file) => file.id !== fileId),
      }));
      if (fileId === selectedLibraryFileId) {
        setSelectedLibraryFileId(null);
        setMidi(null);
      }
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "MIDI 파일을 삭제하지 못했습니다.");
    }
  }, [selectedLibraryFileId]);

  const handleModeSelect = useCallback((mode: PracticeMode) => {
    setSettings((current) => ({ ...current, mode }));
  }, []);

  const enterMidiPerformance = useCallback(() => {
    if (!midi) return;
    setPerformanceKind("midi");
    engine.setMidi(midi);
    engine.stop();
    engine.seek(0);
    setView("perform");
    setIsMenuOpen(true);
    void prepareSoundFont();
    refreshSnapshot(true);
  }, [engine, midi, prepareSoundFont, refreshSnapshot]);

  const enterFreePerformance = useCallback(() => {
    setPerformanceKind("free");
    engine.setMidi(null);
    engine.stop();
    engine.seek(0);
    setView("perform");
    setIsMenuOpen(true);
    void prepareSoundFont();
    refreshSnapshot(true);
  }, [engine, prepareSoundFont, refreshSnapshot]);

  const returnToSelection = useCallback(() => {
    engine.stop();
    refreshSnapshot(true);
    setView("select");
  }, [engine, refreshSnapshot]);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
  }, []);

  const handleSoundPresetChange = useCallback((soundPreset: string) => {
    setSettings((current) => ({ ...current, soundPreset }));
  }, []);

  if (view === "select") {
    return (
      <MidiSelectionScreen
        midi={midi}
        library={library}
        selectedFolderId={selectedFolderId}
        selectedLibraryFileId={selectedLibraryFileId}
        selectedMode={settings.mode}
        libraryError={libraryError}
        isAddingLibraryFiles={isAddingLibraryFiles}
        enteringLibraryFileIds={enteringLibraryFileIds}
        onModeSelect={handleModeSelect}
        onAddFiles={handleAddLibraryFiles}
        onCreateFolder={handleCreateFolder}
        onSelectFolder={handleFolderSelect}
        onSelectLibraryFile={handleLibraryFileSelect}
        onDifficultyChange={handleDifficultyChange}
        onDisplayNameChange={handleDisplayNameChange}
        onMoveLibraryFile={handleMoveLibraryFile}
        onDeleteLibraryFile={handleDeleteLibraryFile}
        onEnterMidiPerformance={enterMidiPerformance}
        onEnterFreePerformance={enterFreePerformance}
      />
    );
  }

  return (
    <main className={isMenuOpen ? "app-shell menu-open" : "app-shell"}>
      <button
        type="button"
        className="menu-toggle"
        aria-label={isMenuOpen ? "설정 메뉴 닫기" : "설정 메뉴 열기"}
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        <Settings size={22} />
      </button>
      <ControlPanel
        midi={activeMidi}
        settings={settings}
        isFreePlay={performanceKind === "free"}
        midiSupported={midiSupported}
        midiError={midiError}
        devices={devices}
        currentTime={currentTime}
        isPlaying={isPlaying}
        score={score}
        waitGroup={waitGroup}
        zoom={zoom}
        panMidi={panMidi}
        calibrationStep={calibrationStep}
        onBackToSelection={returnToSelection}
        onSettingsChange={updateSettings}
        onSoundPresetChange={handleSoundPresetChange}
        onPlay={async () => {
          if (!(await prepareSoundFont())) return;
          await audio.ensureStarted();
          engine.play();
          refreshSnapshot(true);
        }}
        onPause={() => {
          engine.pause();
          refreshSnapshot(true);
        }}
        onStop={() => {
          engine.stop();
          refreshSnapshot(true);
        }}
        onSeek={(seconds) => {
          engine.seek(seconds);
          refreshSnapshot(true);
        }}
        onSetAbPoint={(point) => {
          setSettings((current) => ({
            ...current,
            abLoop: {
              ...current.abLoop,
              [point === "A" ? "startSec" : "endSec"]: currentTime,
            },
          }));
        }}
        onZoomChange={setZoom}
        onPanChange={setPanMidi}
        onStartCalibration={() => setCalibrationStep("low")}
      />
      <section className="stage">
        <header className="stage-header">
          <div className="performance-title">
            <h1>{performanceKind === "free" ? "Free Play" : activeLibraryFile?.displayName ?? "이름 미지정"}</h1>
            <p>
              {performanceKind === "free"
                ? "MIDI 없이 자유 연주"
                : `난이도 ${activeLibraryFile?.difficulty ?? 1}/20`}
            </p>
          </div>
          <div className="mode-pill">{performanceKind === "free" ? "Free Play" : settings.mode}</div>
        </header>
        <PianoRollCanvas
          midi={activeMidi}
          settings={settings}
          engine={engine}
          zoom={zoom}
          panMidi={panMidi}
          onSnapshot={refreshSnapshot}
        />
      </section>
      {soundFontStatus && (
        <SoundFontStatusModal
          status={soundFontStatus}
          onClose={() => setSoundFontStatus(null)}
        />
      )}
    </main>
  );
}

type MidiSelectionScreenProps = {
  midi: ParsedMidi | null;
  library: MidiLibraryState;
  selectedFolderId: string | null;
  selectedLibraryFileId: string | null;
  selectedMode: PracticeMode;
  libraryError: string | null;
  isAddingLibraryFiles: boolean;
  enteringLibraryFileIds: string[];
  onModeSelect: (mode: PracticeMode) => void;
  onAddFiles: (files: File[]) => void;
  onCreateFolder: (name: string) => void;
  onSelectFolder: (folderId: string) => void;
  onSelectLibraryFile: (fileId: string) => void;
  onDifficultyChange: (fileId: string, difficulty: number) => void;
  onDisplayNameChange: (fileId: string, displayName: string) => void;
  onMoveLibraryFile: (fileId: string, folderId: string) => void;
  onDeleteLibraryFile: (fileId: string) => Promise<void>;
  onEnterMidiPerformance: () => void;
  onEnterFreePerformance: () => void;
};

function MidiSelectionScreen({
  midi,
  library,
  selectedFolderId,
  selectedLibraryFileId,
  selectedMode,
  libraryError,
  isAddingLibraryFiles,
  enteringLibraryFileIds,
  onModeSelect,
  onAddFiles,
  onCreateFolder,
  onSelectFolder,
  onSelectLibraryFile,
  onDifficultyChange,
  onDisplayNameChange,
  onMoveLibraryFile,
  onDeleteLibraryFile,
  onEnterMidiPerformance,
  onEnterFreePerformance,
}: MidiSelectionScreenProps) {
  const [newFolderName, setNewFolderName] = useState("");
  const [isDraggingMidi, setIsDraggingMidi] = useState(false);
  const [draggedLibraryFileId, setDraggedLibraryFileId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [editingLibraryFileId, setEditingLibraryFileId] = useState<string | null>(null);
  const [editingLibraryName, setEditingLibraryName] = useState("");
  const [deleteConfirmationFileId, setDeleteConfirmationFileId] = useState<string | null>(null);
  const [deletingLibraryFileIds, setDeletingLibraryFileIds] = useState<string[]>([]);
  const selectedFolderFiles = library.files.filter((file) => file.folderId === selectedFolderId);
  const selectedFolder = library.folders.find((folder) => folder.id === selectedFolderId);

  const handleFiles = (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (nextFiles.length > 0) onAddFiles(nextFiles);
  };

  const submitFolder = () => {
    if (!newFolderName.trim()) return;
    onCreateFolder(newFolderName);
    setNewFolderName("");
  };

  return (
    <main
      className={isDraggingMidi ? "selection-shell dragging-midi" : "selection-shell"}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".library-delete-button")) return;
        if (deleteConfirmationFileId) setDeleteConfirmationFileId(null);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setIsDraggingMidi(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDraggingMidi(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setIsDraggingMidi(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <section className="selection-panel">
        <header className="selection-header">
          <div>
            <h1>AchromaticAnamnesisSciopticon</h1>
            <p>MIDI를 고르고 연주 방식을 선택하세요.</p>
          </div>
          <div className="selection-mode segmented" aria-label="연주 모드 선택">
            <button
              type="button"
              className={selectedMode === "game" ? "active" : ""}
              onClick={() => onModeSelect("game")}
            >
              Game
            </button>
            <button
              type="button"
              className={selectedMode === "practice" ? "active" : ""}
              onClick={() => onModeSelect("practice")}
            >
              Practice
            </button>
          </div>
        </header>

        <div className="midi-select-area">
          <label className="midi-drop-button">
            <Upload size={20} />
            <span>{isAddingLibraryFiles ? "MIDI 복사 중" : "MIDI 파일 선택 또는 드롭"}</span>
            <input
              type="file"
              multiple
              accept=".mid,.midi,audio/midi"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files) handleFiles(files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <div className="selection-file-meta">
            <span>선택된 MIDI</span>
            <strong>{midi?.name ?? "아직 선택되지 않음"}</strong>
            <small>{midi ? `${midi.tracks.length} tracks, ${midi.notes.length} notes` : "파일은 앱 라이브러리에 복사 저장됩니다."}</small>
          </div>
        </div>

        <div className="library-manager">
          <aside className="library-folders" aria-label="앱 폴더">
            <div className="library-title-row">
              <strong>앱 폴더</strong>
              <span>{library.folders.length}</span>
            </div>
            <div className="folder-create-row">
              <input
                type="text"
                placeholder="새 폴더"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitFolder();
                }}
              />
              <button type="button" title="폴더 만들기" onClick={submitFolder}>
                <FolderPlus size={17} />
              </button>
            </div>
            <div className="folder-list">
              {library.folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={[
                    "folder-item",
                    folder.id === selectedFolderId ? "active" : "",
                    folder.id === dropTargetFolderId ? "drop-target" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => onSelectFolder(folder.id)}
                  onDragOver={(event) => {
                    if (!draggedLibraryFileId) return;
                    const draggedFile = library.files.find((file) => file.id === draggedLibraryFileId);
                    if (!draggedFile || draggedFile.folderId === folder.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetFolderId(folder.id);
                  }}
                  onDragLeave={() => {
                    if (dropTargetFolderId === folder.id) setDropTargetFolderId(null);
                  }}
                  onDrop={(event) => {
                    if (!draggedLibraryFileId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const draggedFile = library.files.find((file) => file.id === draggedLibraryFileId);
                    setDropTargetFolderId(null);
                    setDraggedLibraryFileId(null);
                    if (draggedFile && draggedFile.folderId !== folder.id) {
                      onMoveLibraryFile(draggedLibraryFileId, folder.id);
                    }
                  }}
                >
                  <span>{folder.name}</span>
                  <small>{library.files.filter((file) => file.folderId === folder.id).length}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="library-files" aria-label="MIDI 라이브러리">
            <div className="library-title-row">
              <strong>{selectedFolder?.name ?? "폴더 없음"}</strong>
              <span>{selectedFolderFiles.length} MIDI</span>
            </div>
            <div className="library-file-list">
              {selectedFolderFiles.map((file) => (
                <div
                  key={file.id}
                  className={[
                    "library-file",
                    file.id === selectedLibraryFileId ? "active" : "",
                    file.id === draggedLibraryFileId ? "dragging" : "",
                    enteringLibraryFileIds.includes(file.id) ? "entering" : "",
                    deletingLibraryFileIds.includes(file.id) ? "deleting" : "",
                  ].filter(Boolean).join(" ")}
                  draggable={file.id !== editingLibraryFileId && !deletingLibraryFileIds.includes(file.id)}
                  onDragStart={(event) => {
                    setDeleteConfirmationFileId(null);
                    setDraggedLibraryFileId(file.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-midi-library-file-id", file.id);
                  }}
                  onDragEnd={() => {
                    setDraggedLibraryFileId(null);
                    setDropTargetFolderId(null);
                  }}
                >
                  <div className="library-file-main">
                    {file.id === editingLibraryFileId ? (
                      <form
                        className="library-name-editor"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onDisplayNameChange(file.id, editingLibraryName);
                          setEditingLibraryFileId(null);
                        }}
                      >
                        <input
                          type="text"
                          value={editingLibraryName}
                          placeholder={file.name}
                          aria-label={`${file.name} 표시 이름`}
                          autoFocus
                          onChange={(event) => setEditingLibraryName(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingLibraryFileId(null);
                          }}
                        />
                        <button type="submit" title="이름 저장" aria-label="이름 저장">
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          title="이름 수정 취소"
                          aria-label="이름 수정 취소"
                          onClick={() => setEditingLibraryFileId(null)}
                        >
                          <X size={15} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="library-file-select"
                          onClick={() => onSelectLibraryFile(file.id)}
                        >
                          <span title={file.displayName ? `파일 이름: ${file.name}` : file.name}>
                            {file.displayName ?? file.name}
                          </span>
                          <small>{formatBytes(file.size)}</small>
                        </button>
                        <button
                          type="button"
                          className="library-name-edit-button"
                          title="이름 수정"
                          aria-label={`${file.displayName ?? file.name} 이름 수정`}
                          onClick={() => {
                            setEditingLibraryFileId(file.id);
                            setEditingLibraryName(file.displayName ?? file.name);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  <DifficultyEditor
                    difficulty={file.difficulty}
                    fileName={file.displayName ?? file.name}
                    onChange={(difficulty) => onDifficultyChange(file.id, difficulty)}
                  />
                  <button
                    type="button"
                    className={file.id === deleteConfirmationFileId ? "library-delete-button armed" : "library-delete-button"}
                    title={file.id === deleteConfirmationFileId ? "한 번 더 눌러 삭제" : "삭제"}
                    aria-label={file.id === deleteConfirmationFileId
                      ? `${file.displayName ?? file.name} 삭제 확인`
                      : `${file.displayName ?? file.name} 삭제`}
                    aria-pressed={file.id === deleteConfirmationFileId}
                    onClick={() => {
                      if (deleteConfirmationFileId === file.id) {
                        setDeleteConfirmationFileId(null);
                        setDeletingLibraryFileIds((current) => [...current, file.id]);
                        window.setTimeout(() => {
                          void onDeleteLibraryFile(file.id).finally(() => {
                            setDeletingLibraryFileIds((current) => current.filter((fileId) => fileId !== file.id));
                          });
                        }, 320);
                        return;
                      }
                      setDeleteConfirmationFileId(file.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {selectedFolderFiles.length === 0 && (
                <div className="empty-library">
                  <strong>아직 MIDI가 없습니다.</strong>
                  <span>이 화면에 파일을 드롭하면 현재 폴더에 복사됩니다.</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {libraryError && <p className="warning">{libraryError}</p>}

        <div className="selection-actions">
          <button type="button" className="primary-action" disabled={!midi} onClick={onEnterMidiPerformance}>
            <Play size={18} />
            선택한 MIDI로 시작
          </button>
          <button type="button" onClick={onEnterFreePerformance}>
            자유 연주
          </button>
        </div>
      </section>
    </main>
  );
}

const DIFFICULTY_LEVELS = Array.from({ length: 20 }, (_, index) => index + 1);

type DifficultyEditorProps = {
  difficulty: number;
  fileName: string;
  onChange: (difficulty: number) => void;
};

function DifficultyEditor({ difficulty, fileName, onChange }: DifficultyEditorProps) {
  return (
    <div
      className="difficulty-editor"
      role="group"
      aria-label={`${fileName} 난이도 ${difficulty}/20`}
      title={`난이도 ${difficulty}/20`}
    >
      {DIFFICULTY_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          className={level <= difficulty ? "difficulty-bar filled" : "difficulty-bar"}
          aria-label={`난이도 ${level}/20으로 설정`}
          aria-pressed={level === difficulty}
          onClick={() => onChange(level)}
        />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type SoundFontStatusModalProps = {
  status: SoundFontStatus;
  onClose: () => void;
};

function SoundFontStatusModal({ status, onClose }: SoundFontStatusModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="soundfont-status-title">
      <div className="modal-panel">
        <div className="modal-title-row">
          <h2 id="soundfont-status-title">
            {status.status === "loading" ? "내장 SoundFont 준비 중" : "SoundFont 오류"}
          </h2>
          {status.status === "error" && (
            <button type="button" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
        {status.status === "loading" ? (
          <>
            <p>MuseScore General 음원을 메모리에 불러오고 있습니다.</p>
            <div className="progress-bar indeterminate" aria-label="SoundFont loading">
              <span />
            </div>
          </>
        ) : (
          <p className="warning">{status.message}</p>
        )}
      </div>
    </div>
  );
}
