from __future__ import annotations

import ctypes
import fnmatch
import re
from datetime import datetime
import json
import os
import shutil
import struct
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any


# -----------------------------------------------------------------------------
# ZmartZnap (optimized standalone Windows clipboard snapshot)
# - No console (.pyw)
# - Recursively snapshots this script's folder in one directory pass
# - ZIP compression: DEFLATE, level 2
# - Exclusions aligned with Smart Dumper
# - Copies znapshot_<folder>_<MMDDHHmm>.zip to the Windows clipboard
# - Leaves NO ZIP in the project folder
# - Keeps only a temporary backing ZIP while the clipboard still references it
# - Deletes the temporary ZIP when the clipboard changes
# - Stale ZIP instances are cleaned up on the next run
# - Shows OK / FAIL for ~0.5 second
# -----------------------------------------------------------------------------

ALWAYS_IGNORE_DIRS: set[str] = {
    ".git", ".svn", ".hg", ".idea", ".vscode", ".ipynb_checkpoints",
    "node_modules", "venv", ".venv", "env", "__pycache__", ".mypy_cache",
    ".pytest_cache", "dist", "build", "coverage", "target", "out",
    "abstract_wiki_architect.egg-info", "WEB-INF", "obj",
}

ALWAYS_IGNORE_EXT: set[str] = {
    ".pyc", ".pyo", ".pyd", ".exe", ".dll", ".so", ".dylib", ".class",
    ".jar", ".war", ".bin", ".iso", ".img", ".log", ".sqlite", ".db",
    ".zip", ".gz", ".tar", ".png", ".jpg", ".jpeg", ".gif", ".ico",
    ".svg", ".lock", ".pdf", ".mp4", ".mp3",
}

ALWAYS_IGNORE_FILES: set[str] = {
    ".env", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock",
    "Gemfile.lock", "poetry.lock", "Cargo.lock", ".DS_Store", "Thumbs.db",
    "Entity", "Fact", "Modifier", "Predicate", "Property",
}

INDEX_NAME = "SNAPSHOT_INDEX.txt"
USE_SMARTIGNORE_EXCLUDE = True
STATE_DIR_NAME = "ZmartZnapClipboard"


class IgnoreEngine:
    """Fast, single-pass matcher retaining legacy ignore-rule syntax."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.smartignore_patterns: list[tuple[re.Pattern[str], bool, bool, bool]] = []
        if USE_SMARTIGNORE_EXCLUDE:
            try:
                lines = (self.root / ".smartignore").read_text(
                    encoding="utf-8", errors="replace"
                ).splitlines()
            except OSError:
                lines = []
            for raw in lines:
                pattern = raw.strip()
                if not pattern or pattern.startswith("#"):
                    continue
                dir_only = pattern.endswith("/")
                if dir_only:
                    pattern = pattern[:-1].strip()
                    if not pattern:
                        continue
                anchored = pattern.startswith("/")
                if anchored:
                    pattern = pattern[1:]
                contains_slash = "/" in pattern
                self.smartignore_patterns.append((
                    re.compile(fnmatch.translate(os.path.normcase(pattern))),
                    dir_only, anchored, contains_slash,
                ))

    @staticmethod
    def _parse_ignore_line(raw: str) -> tuple[str, bool, bool, bool] | None:
        line = raw.rstrip("\n").rstrip("\r")
        if not line:
            return None
        if line.startswith("\ufeff"):
            line = line.lstrip("\ufeff")
        while line.endswith(" ") and not line.endswith("\\ "):
            line = line[:-1]
        if line.endswith("\\ "):
            line = line[:-2] + " "
        if not line.strip():
            return None
        escaped_prefix = line.startswith("\\#") or line.startswith("\\!")
        if escaped_prefix:
            line = line[1:]
        if line.startswith("#") and not escaped_prefix:
            return None
        neg = False
        if line.startswith("!") and not escaped_prefix:
            neg = True
            line = line[1:]
            if not line:
                return None
        dir_only = line.endswith("/")
        if dir_only:
            line = line[:-1]
        anchored = line.startswith("/")
        if anchored:
            line = line[1:]
        if not line:
            return None
        return line, neg, dir_only, anchored

    def local_rules(self, current: Path, relative_dir: str, names: set[str]) -> tuple:
        """Load only ignore files in the current directory, once."""
        local: list[tuple] = []
        for ignore_name in (".gitignore", ".smartignore"):
            if ignore_name not in names:
                continue
            try:
                with (current / ignore_name).open(
                    "r", encoding="utf-8-sig", errors="replace"
                ) as stream:
                    for line in stream:
                        parsed = self._parse_ignore_line(line)
                        if parsed is None:
                            continue
                        pattern, neg, dir_only, anchored = parsed
                        local.append((
                            re.compile(fnmatch.translate(os.path.normcase(pattern))),
                            os.path.normcase(pattern), neg, dir_only,
                            anchored or "/" in pattern, relative_dir,
                        ))
            except OSError:
                pass
        return tuple(local)

    def smartignore_match(self, rel_posix: str, *, is_dir: bool) -> bool:
        if not self.smartignore_patterns:
            return False
        rel_posix = os.path.normcase(rel_posix)
        basename = rel_posix.rsplit(os.sep if os.name == "nt" else "/", 1)[-1]
        for compiled, dir_only, anchored, contains_slash in self.smartignore_patterns:
            if dir_only and not is_dir:
                continue
            if anchored:
                if compiled.match(rel_posix):
                    return True
            elif not contains_slash:
                if compiled.match(basename):
                    return True
            else:
                if compiled.match(rel_posix):
                    return True
                # Match a non-anchored pattern at any nested path boundary.
                separator = os.sep if os.name == "nt" else "/"
                start = 0
                while True:
                    found = rel_posix.find(separator, start)
                    if found == -1:
                        break
                    if compiled.match(rel_posix[found + 1:]):
                        return True
                    start = found + 1
        return False

    def gitignore_match(self, rel_posix: str, *, is_dir: bool, rules: tuple) -> bool:
        if not rules:
            return False
        ignored = False
        name = os.path.normcase(rel_posix.rsplit("/", 1)[-1])
        full = os.path.normcase(rel_posix)
        for compiled, pattern, neg, dir_only, path_pattern, base_dir in rules:
            if dir_only and not is_dir:
                continue
            if base_dir:
                if rel_posix == base_dir:
                    # A nested ignore file can unexpectedly exclude its own
                    # directory in the legacy matcher. Preserve that behavior.
                    rel_from_base = "."
                elif rel_posix.startswith(base_dir + "/"):
                    rel_from_base = os.path.normcase(rel_posix[len(base_dir) + 1:])
                else:
                    continue
            else:
                rel_from_base = full
            matched = compiled.match(rel_from_base if path_pattern else name) is not None
            if not matched and dir_only and path_pattern:
                # Preserve legacy prefix matching for directory patterns.
                matched = (rel_from_base == pattern or
                           rel_from_base.startswith(pattern + os.sep))
            if matched:
                ignored = not neg
        return ignored


def collect_files(root: Path, engine: IgnoreEngine) -> list[tuple[Path, str]]:
    """One scandir pass, pruning ignored directories and avoiding per-file resolve."""
    root = root.resolve()
    files: list[tuple[Path, str]] = []
    visited_dirs: set[Path] = set()
    visited_files: set[str] = set()
    stack: list[tuple[Path, tuple]] = [(root, ())]

    while stack:
        current, inherited_rules = stack.pop()
        try:
            # Resolving directories, not every file, catches junctions and aliases.
            current = current.resolve()
            current.relative_to(root)
        except (OSError, ValueError, RuntimeError):
            continue
        if current in visited_dirs:
            continue
        visited_dirs.add(current)
        try:
            with os.scandir(current) as handle:
                entries = list(handle)
        except OSError:
            continue

        relative_dir = current.relative_to(root).as_posix()
        if relative_dir == ".":
            relative_dir = ""
        rules = inherited_rules + engine.local_rules(
            current, relative_dir, {entry.name for entry in entries}
        )
        # Legacy code rechecks every parent after loading all ignore files.
        # Check once per directory instead of once for each descendant file.
        if relative_dir and engine.gitignore_match(
            relative_dir, is_dir=True, rules=rules
        ):
            continue

        for entry in entries:
            name = entry.name
            try:
                is_dir = entry.is_dir(follow_symlinks=True)
            except OSError:
                continue
            if is_dir:
                if name in ALWAYS_IGNORE_DIRS:
                    continue
                try:
                    directory = Path(entry.path).resolve()
                    rel = directory.relative_to(root).as_posix()
                except (OSError, ValueError, RuntimeError):
                    continue
                if directory in visited_dirs:
                    continue
                if engine.smartignore_match(rel, is_dir=True):
                    continue
                if engine.gitignore_match(rel, is_dir=True, rules=rules):
                    continue
                stack.append((directory, rules))
                continue

            if name in ALWAYS_IGNORE_FILES:
                continue
            if Path(name).suffix.lower() in ALWAYS_IGNORE_EXT:
                continue
            try:
                if not entry.is_file(follow_symlinks=True):
                    continue
                # A normal DirEntry is already within this resolved directory.
                # Only symlinks require additional canonicalization.
                candidate = Path(entry.path).resolve() if entry.is_symlink() else current / name
                relative = candidate.relative_to(root).as_posix()
            except (OSError, ValueError, RuntimeError):
                continue
            if candidate.name in ALWAYS_IGNORE_FILES or candidate.suffix.lower() in ALWAYS_IGNORE_EXT:
                continue
            # The generated index owns this top-level archive path.
            if relative == INDEX_NAME or relative in visited_files:
                continue
            if engine.smartignore_match(relative, is_dir=False):
                continue
            if engine.gitignore_match(relative, is_dir=False, rules=rules):
                continue
            files.append((candidate, relative))
            visited_files.add(relative)

    files.sort(key=lambda pair: pair[1].lower())
    return files


def build_zip(root: Path, output: Path) -> Path:
    """Build an atomic ZIP from the original files, without staging copies."""
    root = root.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.partial")
    try:
        temp.unlink(missing_ok=True)
    except OSError:
        pass

    engine = IgnoreEngine(root)
    files = collect_files(root, engine)
    try:
        with zipfile.ZipFile(
            temp, "w", compression=zipfile.ZIP_DEFLATED,
            compresslevel=2, strict_timestamps=False,
        ) as archive:
            for source, relative in files:
                archive.write(source, arcname=relative)
            index_lines = [
                "ZmartZnap snapshot file index",
                f"Files included: {len(files)}",
                "",
                *(relative for _source, relative in files),
                "",
                f"Index file: {INDEX_NAME}",
            ]
            archive.writestr(INDEX_NAME, "\n".join(index_lines) + "\n")
        os.replace(temp, output)
        return output
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def snapshot_filename(root: Path, when: datetime | None = None) -> str:
    """Local month, day, hour and minute; project folder used as ZIP prefix."""
    timestamp = (when or datetime.now()).strftime("%m%d%H%M")
    return f"znapshot_{root.name}_{timestamp}.zip"


def state_root() -> Path:
    return Path(tempfile.gettempdir()) / STATE_DIR_NAME


def _filetime_value(ft: Any) -> int:
    return (int(ft.dwHighDateTime) << 32) | int(ft.dwLowDateTime)


def current_process_creation_time() -> int:
    if os.name != "nt":
        return 0

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    kernel32.GetProcessTimes.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME),
        ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME),
    ]
    kernel32.GetProcessTimes.restype = ctypes.c_int

    created = FILETIME()
    exited = FILETIME()
    kernel = FILETIME()
    user = FILETIME()
    handle = kernel32.GetCurrentProcess()
    if not kernel32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
        raise OSError("GetProcessTimes failed")
    return _filetime_value(created)


def process_matches(pid: int, creation_time: int) -> bool:
    if os.name != "nt" or pid <= 0:
        return False

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", ctypes.c_uint32), ("dwHighDateTime", ctypes.c_uint32)]

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.restype = ctypes.c_int
    kernel32.GetProcessTimes.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME),
        ctypes.POINTER(FILETIME), ctypes.POINTER(FILETIME),
    ]
    kernel32.GetProcessTimes.restype = ctypes.c_int

    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        created = FILETIME()
        exited = FILETIME()
        kernel = FILETIME()
        user = FILETIME()
        if not kernel32.GetProcessTimes(handle, ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
            return False
        return _filetime_value(created) == creation_time
    finally:
        kernel32.CloseHandle(handle)


def cleanup_path(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    except OSError:
        pass


def safe_instance_dir(raw: object) -> Path | None:
    try:
        base = state_root().resolve()
        candidate = Path(str(raw)).resolve()
        candidate.relative_to(base)
        if candidate.parent != base or not candidate.name.startswith("snap_"):
            return None
        return candidate
    except (OSError, ValueError):
        return None


def cleanup_stale_instances() -> None:
    base = state_root()
    if not base.exists():
        return

    referenced_dirs: set[Path] = set()
    for marker in base.glob("instance_*.json"):
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
            pid = int(data.get("pid", 0))
            created = int(data.get("creation_time", 0))
            instance_dir = safe_instance_dir(data.get("instance_dir", ""))
            if instance_dir is not None:
                referenced_dirs.add(instance_dir)
            if process_matches(pid, created):
                continue
            if instance_dir is not None:
                cleanup_path(instance_dir)
            cleanup_path(marker)
        except Exception:
            cleanup_path(marker)

    # Remove orphan temp directories that no live marker references.
    for child in base.iterdir():
        if child.is_dir() and child.name.startswith("snap_") and child not in referenced_dirs:
            cleanup_path(child)


def create_instance_marker(instance_dir: Path, zip_path: Path) -> Path:
    base = state_root()
    base.mkdir(parents=True, exist_ok=True)
    pid = os.getpid()
    created = current_process_creation_time()
    marker = base / f"instance_{pid}_{created}.json"
    payload = {
        "pid": pid,
        "creation_time": created,
        "instance_dir": str(instance_dir),
        "zip_path": str(zip_path),
    }
    marker.write_text(json.dumps(payload), encoding="utf-8")
    return marker


def copy_file_to_windows_clipboard(path: Path) -> int:
    """Put one file on the Windows clipboard as CF_HDROP and return clipboard sequence."""
    if os.name != "nt":
        raise OSError("Windows clipboard required")

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    CF_HDROP = 15
    GMEM_MOVEABLE = 0x0002

    kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalUnlock.restype = ctypes.c_int
    kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
    kernel32.GlobalFree.restype = ctypes.c_void_p
    user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    user32.OpenClipboard.restype = ctypes.c_int
    user32.EmptyClipboard.restype = ctypes.c_int
    user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    user32.SetClipboardData.restype = ctypes.c_void_p
    user32.CloseClipboard.restype = ctypes.c_int
    user32.GetClipboardSequenceNumber.restype = ctypes.c_uint32

    absolute = str(path.resolve())
    header = struct.pack("<IiiII", 20, 0, 0, 0, 1)
    payload = header + absolute.encode("utf-16le") + b"\x00\x00\x00\x00"

    handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(payload))
    if not handle:
        raise MemoryError("GlobalAlloc failed")

    clipboard_open = False
    ownership_transferred = False
    try:
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            raise OSError("GlobalLock failed")
        try:
            ctypes.memmove(pointer, payload, len(payload))
        finally:
            kernel32.GlobalUnlock(handle)

        for _ in range(20):
            if user32.OpenClipboard(None):
                clipboard_open = True
                break
            time.sleep(0.025)
        if not clipboard_open:
            raise OSError("OpenClipboard failed")
        if not user32.EmptyClipboard():
            raise OSError("EmptyClipboard failed")
        if not user32.SetClipboardData(CF_HDROP, handle):
            raise OSError("SetClipboardData failed")
        ownership_transferred = True
    finally:
        if clipboard_open:
            user32.CloseClipboard()
        if not ownership_transferred:
            kernel32.GlobalFree(handle)

    return int(user32.GetClipboardSequenceNumber())


def clipboard_sequence() -> int:
    if os.name != "nt":
        return -1
    user32 = ctypes.windll.user32
    user32.GetClipboardSequenceNumber.restype = ctypes.c_uint32
    return int(user32.GetClipboardSequenceNumber())


def flash_status(text: str, title: str = "ZmartZnap") -> None:
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        win = tk.Toplevel(root)
        win.title(title)
        win.resizable(False, False)
        win.attributes("-topmost", True)
        try:
            win.overrideredirect(True)
        except tk.TclError:
            pass

        width = 560
        height = 240
        bg = "#1e6864"
        win.configure(bg=bg)
        label = tk.Label(
            win,
            text=text,
            font=("Segoe UI", 46, "bold"),
            fg="white",
            bg=bg,
        )
        label.pack(fill="both", expand=True)

        x = max(0, (win.winfo_screenwidth() - width) // 2)
        y = max(0, (win.winfo_screenheight() - height) // 2)
        win.geometry(f"{width}x{height}+{x}+{y}")
        win.deiconify()
        win.lift()
        win.after(500, root.destroy)
        root.mainloop()
    except Exception:
        pass


def wait_until_clipboard_changes(sequence: int) -> None:
    # Keep the backing ZIP alive while CF_HDROP references it.
    while clipboard_sequence() == sequence:
        time.sleep(0.20)


def main() -> None:
    marker: Path | None = None
    instance_dir: Path | None = None
    status = "FAIL"

    try:
        if os.name != "nt":
            raise OSError("ZmartZnap is Windows-only")

        cleanup_stale_instances()
        root = Path(__file__).resolve().parent
        base = state_root()
        base.mkdir(parents=True, exist_ok=True)
        instance_dir = Path(tempfile.mkdtemp(prefix="snap_", dir=base))
        zip_path = build_zip(root, instance_dir / snapshot_filename(root))
        marker = create_instance_marker(instance_dir, zip_path)
        sequence = copy_file_to_windows_clipboard(zip_path)
        status = "OK"
        flash_status(status)

        # Hidden lifetime: the clipboard points to a physical file. Deleting it
        # immediately would make Ctrl+V fail. Delete it as soon as the clipboard
        # is replaced. Stale instances are cleaned up at the next launch.
        wait_until_clipboard_changes(sequence)

    except Exception:
        status = "FAIL"
        if marker is not None:
            cleanup_path(marker)
        if instance_dir is not None:
            cleanup_path(instance_dir)
        flash_status(status)
        return
    finally:
        if status == "OK":
            if instance_dir is not None:
                cleanup_path(instance_dir)
            if marker is not None:
                cleanup_path(marker)


if __name__ == "__main__":
    main()
