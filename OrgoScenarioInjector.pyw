# -*- coding: utf-8 -*-
"""
Orgo Scenario Injector UI
Place this file at the root of the Orgo repository and double-click it on Windows.

The UI is only a launcher/front-end. The injection engine remains:
    tools/scenario-injector/cli.mjs
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


APP_TITLE = "Orgo Scenario Injector"
ROOT = Path(__file__).resolve().parent
TOOL_DIR = ROOT / "tools" / "scenario-injector"
CLI = TOOL_DIR / "cli.mjs"
DEFAULT_API_URL = os.environ.get("ORGO_SCENARIO_API_URL", "http://127.0.0.1:4000/api/v3")


def _windows_subprocess_kwargs() -> dict:
    """Keep node.exe/cmd.exe hidden when launched from a .pyw process."""
    if os.name != "nt":
        return {}

    kwargs: dict = {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    kwargs["startupinfo"] = startupinfo
    return kwargs


class InjectorUI(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1040x760")
        self.minsize(900, 650)

        self._events: queue.Queue[tuple[str, object]] = queue.Queue()
        self._busy = False

        self.api_url = tk.StringVar(value=DEFAULT_API_URL)
        self.organization = tk.StringVar(value=os.environ.get("ORGO_SCENARIO_ORGANIZATION", ""))
        self.email = tk.StringVar(value=os.environ.get("ORGO_SCENARIO_EMAIL", ""))
        self.password = tk.StringVar(value=os.environ.get("ORGO_SCENARIO_PASSWORD", ""))
        self.token = tk.StringVar(value=os.environ.get("ORGO_SCENARIO_TOKEN", ""))

        self.brief_path = tk.StringVar()
        self.prompt_path = tk.StringVar(value=str(ROOT / "scenario-prompt.md"))
        self.scenario_path = tk.StringVar()
        self.report_path = tk.StringVar()

        self._build_ui()
        self.after(100, self._poll_events)
        self.after(150, self._startup_checks)

    # ---------- UI ----------

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(3, weight=1)

        header = ttk.Frame(self, padding=(14, 12, 14, 4))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)

        ttk.Label(header, text=APP_TITLE, font=("Segoe UI", 18, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(
            header,
            text="Template IA → validation → dry-run → injection contrôlée via l'API Orgo",
        ).grid(row=1, column=0, sticky="w", pady=(3, 0))

        paths = ttk.LabelFrame(self, text="Scénario", padding=10)
        paths.grid(row=1, column=0, sticky="ew", padx=14, pady=8)
        paths.columnconfigure(1, weight=1)

        self._path_row(paths, 0, "Brief (optionnel)", self.brief_path, self._pick_brief)
        self._path_row(paths, 1, "Prompt IA", self.prompt_path, self._pick_prompt_save)
        self._path_row(paths, 2, "Scenario JSON", self.scenario_path, self._pick_scenario)
        self._path_row(paths, 3, "Rapport d'injection", self.report_path, self._pick_report_save)

        controls = ttk.Frame(paths)
        controls.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(10, 0))

        self.btn_template = ttk.Button(controls, text="1. Générer template IA", command=self.generate_template)
        self.btn_template.pack(side="left", padx=(0, 6))

        self.btn_validate = ttk.Button(controls, text="2. Valider JSON", command=self.validate_scenario)
        self.btn_validate.pack(side="left", padx=6)

        self.btn_plan = ttk.Button(controls, text="3. Plan / Dry-run", command=self.plan_scenario)
        self.btn_plan.pack(side="left", padx=6)

        self.btn_inject = ttk.Button(controls, text="4. Injecter dans Orgo", command=self.inject_scenario)
        self.btn_inject.pack(side="left", padx=6)

        self.btn_open_prompt = ttk.Button(controls, text="Ouvrir prompt", command=self.open_prompt)
        self.btn_open_prompt.pack(side="right", padx=(6, 0))

        api = ttk.LabelFrame(self, text="Connexion Orgo — utilisée seulement pour l'injection réelle", padding=10)
        api.grid(row=2, column=0, sticky="ew", padx=14, pady=8)
        api.columnconfigure(1, weight=1)
        api.columnconfigure(3, weight=1)

        ttk.Label(api, text="API URL").grid(row=0, column=0, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(api, textvariable=self.api_url).grid(row=0, column=1, columnspan=3, sticky="ew", pady=4)

        ttk.Label(api, text="Organisation").grid(row=1, column=0, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(api, textvariable=self.organization).grid(row=1, column=1, sticky="ew", padx=(0, 12), pady=4)

        ttk.Label(api, text="Email").grid(row=1, column=2, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(api, textvariable=self.email).grid(row=1, column=3, sticky="ew", pady=4)

        ttk.Label(api, text="Mot de passe").grid(row=2, column=0, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(api, textvariable=self.password, show="•").grid(row=2, column=1, sticky="ew", padx=(0, 12), pady=4)

        ttk.Label(api, text="Bearer token").grid(row=2, column=2, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(api, textvariable=self.token, show="•").grid(row=2, column=3, sticky="ew", pady=4)

        ttk.Label(
            api,
            text="Si un token est fourni, il est utilisé à la place de organisation/email/mot de passe. "
                 "Les secrets ne sont pas enregistrés par cette UI.",
        ).grid(row=3, column=0, columnspan=4, sticky="w", pady=(7, 0))

        logbox = ttk.LabelFrame(self, text="Sortie", padding=8)
        logbox.grid(row=3, column=0, sticky="nsew", padx=14, pady=(8, 8))
        logbox.rowconfigure(0, weight=1)
        logbox.columnconfigure(0, weight=1)

        self.log = tk.Text(logbox, wrap="word", state="disabled", font=("Consolas", 10))
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(logbox, orient="vertical", command=self.log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scroll.set)

        footer = ttk.Frame(self, padding=(14, 0, 14, 12))
        footer.grid(row=4, column=0, sticky="ew")
        footer.columnconfigure(0, weight=1)

        self.status = ttk.Label(footer, text="Prêt")
        self.status.grid(row=0, column=0, sticky="w")

        ttk.Button(footer, text="Ouvrir dossier outil", command=self.open_tool_folder).grid(row=0, column=1, padx=(8, 0))
        ttk.Button(footer, text="Fermer", command=self.destroy).grid(row=0, column=2, padx=(8, 0))

        self._action_buttons = [
            self.btn_template,
            self.btn_validate,
            self.btn_plan,
            self.btn_inject,
        ]

    def _path_row(self, parent, row, label, variable, picker) -> None:
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)
        ttk.Entry(parent, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=4)
        ttk.Button(parent, text="…", width=4, command=picker).grid(row=row, column=2, padx=(8, 0), pady=4)

    # ---------- startup ----------

    def _startup_checks(self) -> None:
        self._write(f"Root Orgo : {ROOT}\n")
        self._write(f"Moteur    : {CLI}\n")

        if not CLI.is_file():
            self._write("\nERREUR : tools/scenario-injector/cli.mjs est introuvable.\n")
            messagebox.showerror(
                APP_TITLE,
                "Le moteur Scenario Injector est introuvable.\n\n"
                f"Attendu :\n{CLI}\n\n"
                "Place ce .pyw à la racine d'Orgo après avoir installé l'overlay Scenario Injector.",
            )
            self._set_actions_enabled(False)
            return

        self._run(["node", "--version"], title="Vérification Node", callback=self._node_checked)

    def _node_checked(self, code: int, out: str, err: str) -> None:
        if code != 0:
            messagebox.showerror(APP_TITLE, "Node.js n'est pas disponible dans le PATH.")
            self._set_actions_enabled(False)
            return
        version = out.strip() or err.strip()
        self.status.configure(text=f"Prêt — Node {version}")

    # ---------- file dialogs ----------

    def _pick_brief(self) -> None:
        path = filedialog.askopenfilename(
            title="Choisir un brief",
            initialdir=str(ROOT),
            filetypes=[("Markdown / texte", "*.md *.txt"), ("Tous les fichiers", "*.*")],
        )
        if path:
            self.brief_path.set(path)

    def _pick_prompt_save(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Enregistrer le prompt IA",
            initialdir=str(ROOT),
            initialfile=Path(self.prompt_path.get() or "scenario-prompt.md").name,
            defaultextension=".md",
            filetypes=[("Markdown", "*.md"), ("Tous les fichiers", "*.*")],
        )
        if path:
            self.prompt_path.set(path)

    def _pick_scenario(self) -> None:
        path = filedialog.askopenfilename(
            title="Choisir le résultat JSON de l'IA",
            initialdir=str(ROOT),
            filetypes=[("JSON", "*.json"), ("Tous les fichiers", "*.*")],
        )
        if path:
            self.scenario_path.set(path)
            if not self.report_path.get():
                p = Path(path)
                self.report_path.set(str(p.with_name(f"{p.stem}.import-report.json")))

    def _pick_report_save(self) -> None:
        initial = self.report_path.get()
        path = filedialog.asksaveasfilename(
            title="Rapport d'injection",
            initialdir=str(Path(initial).parent if initial else ROOT),
            initialfile=Path(initial).name if initial else "scenario.import-report.json",
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("Tous les fichiers", "*.*")],
        )
        if path:
            self.report_path.set(path)

    # ---------- commands ----------

    def generate_template(self) -> None:
        out = self._resolved_path(self.prompt_path.get())
        if not out:
            messagebox.showwarning(APP_TITLE, "Choisis le fichier de sortie du prompt IA.")
            return

        args = ["node", str(CLI), "template", "--out", str(out)]
        brief = self._resolved_path(self.brief_path.get())
        if brief:
            if not brief.is_file():
                messagebox.showerror(APP_TITLE, f"Brief introuvable :\n{brief}")
                return
            args.extend(["--brief", str(brief)])

        self._run(args, title="Génération du template", callback=self._template_done)

    def _template_done(self, code: int, out: str, err: str) -> None:
        if code == 0:
            self.status.configure(text="Template IA généré")
            messagebox.showinfo(APP_TITLE, f"Template IA généré :\n{self.prompt_path.get()}")
        else:
            self._command_failed("La génération du template a échoué.", code, out, err)

    def validate_scenario(self) -> None:
        scenario = self._require_scenario()
        if not scenario:
            return
        self._run(
            ["node", str(CLI), "validate", str(scenario)],
            title="Validation du scénario",
            callback=lambda c, o, e: self._simple_result("Validation", c, o, e),
        )

    def plan_scenario(self) -> None:
        scenario = self._require_scenario()
        if not scenario:
            return
        self._run(
            ["node", str(CLI), "plan", str(scenario)],
            title="Plan / Dry-run",
            callback=lambda c, o, e: self._simple_result("Plan / Dry-run", c, o, e),
        )

    def inject_scenario(self) -> None:
        scenario = self._require_scenario()
        if not scenario:
            return

        api_url = self.api_url.get().strip()
        if not api_url:
            messagebox.showerror(APP_TITLE, "API URL est obligatoire.")
            return

        token = self.token.get().strip()
        if not token:
            missing = [
                name
                for name, value in (
                    ("organisation", self.organization.get().strip()),
                    ("email", self.email.get().strip()),
                    ("mot de passe", self.password.get()),
                )
                if not value
            ]
            if missing:
                messagebox.showerror(
                    APP_TITLE,
                    "Authentification incomplète.\n\n"
                    "Fournis un Bearer token OU organisation + email + mot de passe.\n"
                    f"Manquant : {', '.join(missing)}",
                )
                return

        try:
            doc = json.loads(scenario.read_text(encoding="utf-8"))
            scenario_id = doc.get("scenario", {}).get("id", scenario.name)
            op_count = len(doc.get("operations", []))
        except Exception:
            scenario_id = scenario.name
            op_count = "?"

        answer = messagebox.askyesno(
            "Confirmer l'injection",
            "Cette action va écrire réellement dans Orgo.\n\n"
            f"Scénario : {scenario_id}\n"
            f"Opérations : {op_count}\n"
            f"API : {api_url}\n\n"
            "Continuer ?",
            icon="warning",
        )
        if not answer:
            return

        report = self._resolved_path(self.report_path.get())
        if not report:
            report = scenario.with_name(f"{scenario.stem}.import-report.json")
            self.report_path.set(str(report))

        env = os.environ.copy()
        env["ORGO_SCENARIO_API_URL"] = api_url

        if token:
            env["ORGO_SCENARIO_TOKEN"] = token
            env.pop("ORGO_SCENARIO_ORGANIZATION", None)
            env.pop("ORGO_SCENARIO_EMAIL", None)
            env.pop("ORGO_SCENARIO_PASSWORD", None)
        else:
            env["ORGO_SCENARIO_ORGANIZATION"] = self.organization.get().strip()
            env["ORGO_SCENARIO_EMAIL"] = self.email.get().strip()
            env["ORGO_SCENARIO_PASSWORD"] = self.password.get()
            env.pop("ORGO_SCENARIO_TOKEN", None)

        self._run(
            [
                "node",
                str(CLI),
                "inject",
                str(scenario),
                "--apply",
                "--report",
                str(report),
            ],
            title="Injection réelle",
            env=env,
            callback=lambda c, o, e: self._inject_done(c, o, e, report),
        )

    # ---------- subprocess ----------

    def _run(self, args: list[str], *, title: str, env=None, callback=None) -> None:
        if self._busy:
            messagebox.showwarning(APP_TITLE, "Une opération est déjà en cours.")
            return

        self._busy = True
        self._set_actions_enabled(False)
        self.status.configure(text=f"{title}…")
        self._write(f"\n=== {title} ===\n")
        self._write("$ " + self._safe_command_preview(args) + "\n")

        def worker() -> None:
            try:
                completed = subprocess.run(
                    args,
                    cwd=str(ROOT),
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    **_windows_subprocess_kwargs(),
                )
                self._events.put(("process", (completed.returncode, completed.stdout, completed.stderr, callback)))
            except Exception as exc:
                self._events.put(("exception", (exc, callback)))

        threading.Thread(target=worker, daemon=True).start()

    def _poll_events(self) -> None:
        try:
            while True:
                kind, payload = self._events.get_nowait()
                self._busy = False
                self._set_actions_enabled(True)

                if kind == "process":
                    code, out, err, callback = payload
                    if out:
                        self._write(out.rstrip() + "\n")
                    if err:
                        self._write(err.rstrip() + "\n")
                    if callback:
                        callback(code, out, err)
                    elif code == 0:
                        self.status.configure(text="Terminé")
                    else:
                        self.status.configure(text=f"Échec — code {code}")

                elif kind == "exception":
                    exc, callback = payload
                    self._write(f"ERREUR : {exc}\n")
                    self.status.configure(text="Erreur")
                    messagebox.showerror(APP_TITLE, str(exc))
                    if callback:
                        callback(1, "", str(exc))
        except queue.Empty:
            pass
        finally:
            self.after(100, self._poll_events)

    # ---------- results ----------

    def _simple_result(self, label: str, code: int, out: str, err: str) -> None:
        if code == 0:
            self.status.configure(text=f"{label} : PASS")
        else:
            self._command_failed(f"{label} a échoué.", code, out, err)

    def _inject_done(self, code: int, out: str, err: str, report: Path) -> None:
        if code == 0:
            self.status.configure(text="Injection : PASS")
            messagebox.showinfo(
                APP_TITLE,
                "Injection terminée.\n\n"
                f"Rapport :\n{report}",
            )
        else:
            self._command_failed("L'injection a échoué.", code, out, err)

    def _command_failed(self, message: str, code: int, out: str, err: str) -> None:
        self.status.configure(text=f"Échec — code {code}")
        detail = err.strip() or out.strip() or f"Code de sortie {code}"
        messagebox.showerror(APP_TITLE, f"{message}\n\n{detail[-1800:]}")

    # ---------- helpers ----------

    def _require_scenario(self) -> Path | None:
        scenario = self._resolved_path(self.scenario_path.get())
        if not scenario:
            messagebox.showwarning(APP_TITLE, "Choisis un fichier scenario.json.")
            return None
        if not scenario.is_file():
            messagebox.showerror(APP_TITLE, f"Scenario JSON introuvable :\n{scenario}")
            return None
        return scenario

    def _resolved_path(self, value: str) -> Path | None:
        value = value.strip().strip('"')
        if not value:
            return None
        path = Path(value)
        if not path.is_absolute():
            path = ROOT / path
        return path.resolve()

    def _safe_command_preview(self, args: list[str]) -> str:
        # No credentials are passed on the command line, so this is safe to display.
        return " ".join(f'"{a}"' if " " in a else a for a in args)

    def _set_actions_enabled(self, enabled: bool) -> None:
        state = "normal" if enabled else "disabled"
        for button in self._action_buttons:
            button.configure(state=state)

    def _write(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def open_prompt(self) -> None:
        path = self._resolved_path(self.prompt_path.get())
        if not path or not path.exists():
            messagebox.showwarning(APP_TITLE, "Le prompt IA n'existe pas encore.")
            return
        self._open_path(path)

    def open_tool_folder(self) -> None:
        self._open_path(TOOL_DIR if TOOL_DIR.exists() else ROOT)

    def _open_path(self, path: Path) -> None:
        try:
            if os.name == "nt":
                os.startfile(str(path))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:
            messagebox.showerror(APP_TITLE, str(exc))


if __name__ == "__main__":
    InjectorUI().mainloop()
