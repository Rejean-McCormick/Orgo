#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
concat_orgo.py

Concatène tous les fichiers texte/code du repo Orgo en un seul .txt, avec :
  - TOC en tête (liste de tous les fichiers inclus, en chemin absolu)
  - Blocs par fichier, encadrés par:
        ===== BEGIN chemin/relatif =====
        ... contenu ...
        ===== END chemin/relatif =====

Règles par défaut :
  - Racine = dossier contenant ce script (mettez-le à la racine de C:\MyCode\Orgo)
  - Exclut automatiquement les répertoires :
        .git, .github, Documentation,
        node_modules, .next, dist, build, out, coverage, .cache, .venv, venv, __pycache__, target, bin, obj
  - Ignore les fichiers manifestement binaires
  - Respecte une taille max par fichier (par défaut 2 Mo)
  - N’écrase pas le fichier de sortie

Usage typique (depuis C:\MyCode\Orgo) :
  python concat_orgo.py
    -> crée Code_Orgo_<timestamp>.txt

Options utiles :
  python concat_orgo.py --out MyOrgoDump.txt
  python concat_orgo.py --include "apps/api/**" --include "apps/web/**"
  python concat_orgo.py --exclude "packages/ui/**"
"""

from __future__ import annotations
import argparse
import fnmatch
import os
from pathlib import Path
from typing import Set, List, Optional
from datetime import datetime

# ====== Extensions et noms pris en charge ======
DEFAULT_EXTS: Set[str] = {
    ".txt", ".tx", ".md", ".markdown",
    ".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".cfg", ".conf", ".properties",
    ".html", ".htm", ".css", ".scss", ".less",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".py", ".pyi",
    ".java", ".kt", ".swift", ".rb", ".php", ".go", ".rs",
    ".c", ".h", ".cpp", ".cc", ".hpp", ".cs",
    ".sql",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
    ".graphql", ".gql",
    ".gradle",
    ".pl", ".lua", ".r",
    ".env",
    ".svg",
    ".ndjson",
}
NAMES_WITHOUT_EXT: Set[str] = {
    "Dockerfile", "Makefile", "CMakeLists.txt",
    ".gitignore", ".gitattributes", ".editorconfig",
    ".all-contributorsrc", ".prettierignore", ".releaserc", "LICENSE",
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "tsconfig.json", "eslint.config.js", "eslint.config.mjs", ".eslintrc",
    ".prettierrc", "prettier.config.js", "postcss.config.js",
    "routes.json",
}

# ====== Exclusions ======
DEFAULT_EXCLUDE_DIRS: Set[str] = {
    # VCS / infra
    ".git", ".github", ".hg", ".svn",
    # Builds / caches
    "node_modules", ".next",
    "dist", "build", "out", "coverage", ".cache",
    ".venv", "venv", "__pycache__",
    "target", "bin", "obj",
    # Orgo-specific
    "Documentation",
}

BINARY_EXTS: Set[str] = {
    ".zip", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".png", ".jpg", ".jpeg", ".webp", ".ico", ".gif", ".pdf", ".ttf", ".woff", ".woff2"
}

# On évite de ré-intégrer des sorties précédentes
OUT_EXCLUDES: List[str] = [
    "Code_*.txt",
]

# ====== CLI ======
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Concatène les fichiers texte/code du repo Orgo en un seul fichier texte structuré."
    )
    p.add_argument(
        "-o", "--out", default=None,
        help="Nom du fichier de sortie (par défaut: Code_<nom-dossier>_<timestamp>.txt)"
    )
    p.add_argument(
        "--ext",
        help="Extensions additionnelles ou personnalisées, CSV (par ex: js,ts,tsx,md)"
    )
    p.add_argument(
        "--include", action="append", default=[],
        help="Glob d'inclusion relatif (répétable). Si fourni, seul ce qui matche est pris."
    )
    p.add_argument(
        "--exclude", action="append", default=[],
        help="Glob d'exclusion relatif (répétable) en plus des exclusions par défaut."
    )
    p.add_argument(
        "--max-size", type=int, default=2_000_000,
        help="Taille max par fichier en octets (défaut: 2_000_000)."
    )
    p.add_argument(
        "--no-headers", action="store_true",
        help="Supprime les en-têtes BEGIN/END par fichier (seule la TOC reste)."
    )
    return p.parse_args()

def normalize_exts(exts_csv: Optional[str]) -> Set[str]:
    if not exts_csv:
        return set(DEFAULT_EXTS)
    parts = [e.strip().lower() for e in exts_csv.split(",") if e.strip()]
    out = set()
    for e in parts:
        if not e.startswith("."):
            e = "." + e
        out.add(e)
    return out

# ====== Heuristiques texte ======
def is_probably_text(sample: bytes) -> bool:
    if not sample:
        return True
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError:
        pass
    ctrl = sum(1 for b in sample if b < 32 and b not in (9, 10, 13))
    return (ctrl / max(1, len(sample))) < 0.01

def pick_encoding(path: Path) -> Optional[str]:
    try:
        with path.open("rb") as f:
            sample = f.read(32768)
    except Exception:
        return None
    if not is_probably_text(sample):
        return None
    for enc in ("utf-8", "utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            sample.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"

# ====== Utilitaires ======
def relpath(base: Path, p: Path) -> str:
    try:
        r = p.relative_to(base)
    except Exception:
        r = p
    return str(r).replace("\\", "/")

def should_include_file(
    base: Path,
    file_path: Path,
    allowed_exts: Set[str],
    include_globs: List[str],
    exclude_globs: List[str],
    max_size: int,
    out_path: Path,
) -> bool:
    if not file_path.is_file():
        return False

    # Exclut les extensions manifestement binaires
    if file_path.suffix.lower() in BINARY_EXTS:
        return False

    # Ne pas se reprendre soi-même
    try:
        if file_path.resolve() == out_path.resolve():
            return False
    except Exception:
        pass

    # Taille max
    try:
        if file_path.stat().st_size > max_size:
            return False
    except Exception:
        return False

    rel = relpath(base, file_path)

    # Glob d'exclusion supplémentaires
    for pat in exclude_globs:
        if fnmatch.fnmatch(rel, pat):
            return False

    # Si on a des includes, on les respecte strictement
    if include_globs:
        ok = any(fnmatch.fnmatch(rel, pat) for pat in include_globs)
        if not ok:
            return False

    # Extensions connues ou noms spéciaux
    if file_path.suffix.lower() in allowed_exts or file_path.name in NAMES_WITHOUT_EXT:
        return True

    # Sinon, heuristique: texte probable ?
    enc = pick_encoding(file_path)
    return enc is not None

def walk_select(
    base_dir: Path,
    allowed_exts: Set[str],
    include_globs: List[str],
    exclude_globs: List[str],
    max_size: int,
    out_path: Path,
) -> List[Path]:
    selected: List[Path] = []
    for root, dirs, files in os.walk(base_dir, followlinks=False):
        # Filtrage de répertoires par nom (DEFAULT_EXCLUDE_DIRS)
        dirs[:] = [d for d in dirs if d not in DEFAULT_EXCLUDE_DIRS]

        root_path = Path(root)
        for name in files:
            fp = root_path / name
            try:
                if fp.resolve() == out_path.resolve():
                    continue
            except Exception:
                pass
            if should_include_file(
                base_dir, fp, allowed_exts, include_globs, exclude_globs, max_size, out_path
            ):
                selected.append(fp)

    selected.sort(key=lambda p: relpath(base_dir, p).lower())
    return selected

# ====== Écriture avec TOC ======
def write_concat(
    base_dir: Path,
    files: List[Path],
    out_path: Path,
    no_headers: bool,
) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    abs_paths: List[str] = []
    for p in files:
        try:
            abs_paths.append(str(p.resolve()))
        except Exception:
            abs_paths.append(str(p))

    count = 0
    with out_path.open("w", encoding="utf-8", newline="\n") as out:
        # TOC
        out.write(f"===== TOC ({len(files)} fichiers) =====\n")
        for i, ap in enumerate(abs_paths, 1):
            out.write(f"{i}. {ap}\n")
        out.write("===== END TOC =====\n\n")

        # Contenus
        for p in files:
            enc = pick_encoding(p) or "utf-8"
            rel = relpath(base_dir, p)

            if not no_headers:
                out.write(f"\n===== BEGIN {rel} =====\n")

            try:
                with p.open("r", encoding=enc, errors="strict") as f:
                    for line in f:
                        out.write(line)
            except UnicodeDecodeError:
                # Fallback si encodage foireux
                with p.open("r", encoding="latin-1", errors="replace") as f:
                    for line in f:
                        out.write(line)

            if not no_headers:
                out.write(f"\n===== END {rel} =====\n")

            out.write("\n")
            count += 1

    return count

# ====== Exécution mono-fichier ======
def run_single_output(base_dir: Path, args: argparse.Namespace) -> None:
    if args.out:
        out_path = (base_dir / args.out).resolve()
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_name = f"Code_{base_dir.name}_{stamp}.txt"
        out_path = (base_dir / out_name).resolve()

    allowed_exts = normalize_exts(args.ext)
    include_globs = list(args.include or [])
    # Ajout des patterns d'exclusion de sorties générées
    exclude_globs = list(args.exclude or []) + list(OUT_EXCLUDES)

    files = walk_select(
        base_dir,
        allowed_exts,
        include_globs,
        exclude_globs,
        args.max_size,
        out_path,
    )
    n = write_concat(base_dir, files, out_path, args.no_headers)
    print(f"{n} fichier(s) concaténé(s) -> {out_path.name}")

def main() -> None:
    args = parse_args()
    # Racine = dossier contenant ce script (mettez-le à C:\MyCode\Orgo)
    base_dir = Path(__file__).resolve().parent
    run_single_output(base_dir, args)

if __name__ == "__main__":
    main()
