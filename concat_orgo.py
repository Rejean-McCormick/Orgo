#!/usr/bin/env python3
"""
build_code_dump.py

Generate multiple “code dump” .txt files from the Orgo monorepo.

Rules:
- Certain files (config, tests, lockfiles, etc.) are excluded globally.
- package.json files are always included.
- Remaining files are grouped into category dumps (4–10 files) based on
  their parent folders (CATEGORIES below).
- When every file in a folder and its subfolders is relevant for a category,
  we concatenate all those files for that category.
- Each dump .txt file starts each file section with an index header.

Run from repo root:
    python build_code_dump.py
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Dict, List, Set

# ------------------------------------------------------------
# Configuration
# ------------------------------------------------------------

ROOT = Path(__file__).resolve().parent

# File extensions to consider by default
ALLOWED_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".prisma",
    ".css",
    ".toml",
    ".conf",
    ".env",
    ".tsv",
    ".txt",
}

# Glob-style patterns for files to exclude (applied on posix-style rel path)
EXCLUDE_PATTERNS = [
    # root / infra / plumbing
    ".gitignore",
    ".dockerignore",
    "yarn.lock",
    "turbo.json",
    "docker-compose.yml",
    "ai_bundle.md",
    "concat_orgo.py",
    "LICENSE",
    # generic configs
    "tsconfig.json",
    "tsconfig.build.json",
    "tsconfig*.json",
    ".eslintrc.js",
    ".prettierrc",
    "jest.config.js",
    "jest.setup.js",
    "next-env.d.ts",
    "next.config.js",
    "postcss.config.js",
    "tailwind.config.js",
    "webpack-hmr.config.js",
    "nest-cli.json",
    "Dockerfile",
    # tests
    "*.spec.ts",
    "*.test.tsx",
    "*e2e-spec.ts",
    "test/jest-e2e.json",
    # prisma migrations (keep schema.prisma separately)
    "prisma/migrations/*/migration.sql",
    "prisma/migrations/migration_lock.toml",
    # misc / placeholders
    ".gitkeep",
]

# Category → list of “roots” (directories or specific files)
# A file is assigned to the first category that matches it.
CATEGORIES: Dict[str, List[str]] = {
    # 1
    "00_root_and_monorepo_meta.txt": [
        "package.json",            # repo root package.json
        "package-scripts.js",
        "README.md",               # only root README (others are excluded by rule)
    ],
    # 2
    "01_api_bootstrap_and_persistence.txt": [
        "apps/api/package.json",
        "apps/api/src/main.ts",
        "apps/api/src/app.module.ts",
        "apps/api/src/app.controller.ts",
        "apps/api/src/app.service.ts",
        "apps/api/src/config",
        "apps/api/src/persistence",
        "apps/api/prisma/schema.prisma",
    ],
    # 3
    "02_api_backbone_identity_and_persons.txt": [
        "apps/api/src/orgo/backbone/identity",
        "apps/api/src/orgo/backbone/persons",
    ],
    # 4
    "03_api_backbone_organizations_and_rbac.txt": [
        "apps/api/src/orgo/backbone/organizations",
        "apps/api/src/orgo/backbone/rbac",
    ],
    # 5
    "04_api_config_profiles_and_feature_flags.txt": [
        "apps/api/src/orgo/config",
    ],
    # 6
    "05_api_core_and_supporting_core.txt": [
        "apps/api/src/orgo/core",
    ],
    # 7
    "06_api_domain_insights_security_and_orgo_module.txt": [
        "apps/api/src/orgo/domain",
        "apps/api/src/orgo/insights",
        "apps/api/src/orgo/security",
        "apps/api/src/orgo/orgo.module.ts",
    ],
    # 8
    "07_web_app_shell_pages_and_store.txt": [
        "apps/web/package.json",
        "apps/web/pages",
        "apps/web/src/store",
        "apps/web/src/styles/global.css",
    ],
    # 9
    "08_web_orgo_frontend_types_screens_and_shared_ui.txt": [
        "apps/web/src/orgo",
        "apps/web/src/screens",
        "packages/ui",
        "packages/config/nginx.conf",
        "packages/config/package.json",
        "packages/tsconfig/package.json",
    ],
}

OUTPUT_DIR = ROOT / "ai_dumps"


# ------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------

def relpath(path: Path) -> str:
    """Return posix-style relative path from ROOT."""
    return path.relative_to(ROOT).as_posix()


def is_package_json(path: Path) -> bool:
    return path.name == "package.json"


def is_allowed_file(path: Path) -> bool:
    """Return True if the file is a candidate before exclusions."""
    if not path.is_file():
        return False
    # Always allow package.json
    if is_package_json(path):
        return True
    return path.suffix.lower() in ALLOWED_EXTENSIONS


def is_excluded(path: Path) -> bool:
    """Return True if the file should be excluded based on patterns and special rules."""
    rel = relpath(path)

    # Keep root README.md, exclude other READMEs
    if path.name == "README.md":
        if path.parent == ROOT:
            return False
        return True

    for pattern in EXCLUDE_PATTERNS:
        if fnmatch.fnmatch(rel, pattern):
            return True

    return False


def collect_files_under(root_subpath: str) -> List[Path]:
    """
    Collect all candidate files under a given subpath.
    If root_subpath is a file, return it if allowed+not-excluded.
    """
    root_path = (ROOT / root_subpath).resolve()
    files: List[Path] = []

    if root_path.is_file():
        if is_allowed_file(root_path) and not is_excluded(root_path):
            files.append(root_path)
        return files

    if not root_path.exists():
        return files

    for p in root_path.rglob("*"):
        if not p.is_file():
            continue
        if not is_allowed_file(p):
            continue
        if is_excluded(p):
            continue
        files.append(p)

    return files


def assign_files_to_categories() -> Dict[str, List[Path]]:
    """
    Walk over CATEGORIES and collect files from each root.
    A file goes into the first category that mentions it.
    No duplicates across categories.
    """
    assigned: Dict[str, List[Path]] = {name: [] for name in CATEGORIES}
    already_taken: Set[Path] = set()

    for out_name, roots in CATEGORIES.items():
        for root_subpath in roots:
            for f in collect_files_under(root_subpath):
                if f in already_taken:
                    continue
                assigned[out_name].append(f)
                already_taken.add(f)

    return assigned


def write_dump_file(output_path: Path, files: List[Path]) -> None:
    """
    Write a dump file with a file index at the beginning of each section.

    Format:
        === FILE 1/NN: relative/path.ts ===

        <content>
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)

    files_sorted = sorted(files, key=lambda p: relpath(p))
    total = len(files_sorted)

    with output_path.open("w", encoding="utf-8") as out:
        for idx, f in enumerate(files_sorted, start=1):
            header = f"=== FILE {idx}/{total}: {relpath(f)} ===\n\n"
            out.write(header)

            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
            except Exception as e:
                content = f"<<ERROR READING FILE: {e}>>"

            out.write(content.rstrip() + "\n\n\n")


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

def main() -> None:
    category_files = assign_files_to_categories()

    for out_name, files in category_files.items():
        if not files:
            continue  # skip empty categories

        # Ajout du préfixe "orgo_" au nom de chaque fichier généré
        out_filename = f"orgo_{out_name}" if not out_name.startswith("orgo_") else out_name
        out_path = OUTPUT_DIR / out_filename

        print(f"Writing {out_path} ({len(files)} files)...")
        write_dump_file(out_path, files)

    print("Done.")


if __name__ == "__main__":
    main()
