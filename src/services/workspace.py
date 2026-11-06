"""Workspace management: project storage, automated versioning, backups, and XML archive."""

from __future__ import annotations
import datetime
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

BACKUPS_KEPT = 10
PROJECT_EXT = ".mca-ci.json"


def clean_name(s: Any, max_len: int = 80) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\u0000-\u001f]+', " ", str(s or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"[. ]+$", "", cleaned)
    return cleaned[:max_len].strip()


def under_name(s: Any) -> str:
    return clean_name(s).replace(" ", "_")


def fy_label(meta: Dict[str, Any]) -> str:
    s = meta.get("periods", {}).get("cy", {}).get("start", "")
    e = meta.get("periods", {}).get("cy", {}).get("end", "")
    if not s or not e:
        return "year-not-set"
    return f"{s[:4]}-{e[2:4]}"


fyLabel = fy_label


def project_path(meta: Dict[str, Any]) -> Dict[str, str]:
    name = clean_name(meta.get("name")) or "Unnamed company"
    cin = meta.get("cin")
    company = f"{name} ({clean_name(cin, 30)})" if cin else name
    fy = fy_label(meta)
    rep = under_name(meta.get("reportType")) or "Standalone"
    base = f"{under_name(meta.get('name')) or 'Unnamed_company'}_{fy}_{rep}"
    return {
        "company": company,
        "year": f"FY {fy}",
        "base": base,
        "file": f"{base}{PROJECT_EXT}",
    }


projectPath = project_path


def stamp_project(
    data: Dict[str, Any],
    device: str = "",
    build: str = "",
    now: Optional[datetime.datetime] = None,
) -> Dict[str, Any]:
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    meta = data.setdefault("meta", {})
    prev = meta.get("lastSaved", {})
    n = (int(prev.get("n", 0)) if prev else 0) + 1
    stamp = {
        "n": n,
        "at": now.isoformat(),
        "device": str(device or "")[:60],
        "build": str(build or ""),
    }
    meta["lastSaved"] = stamp
    return stamp


stampProject = stamp_project


def filing_key(meta: Dict[str, Any]) -> str:
    p = meta.get("periods", {}).get("cy", {})
    return f"{meta.get('cin', '')}|{p.get('start', '')}|{p.get('end', '')}|{meta.get('reportType', '')}"


filingKey = filing_key


def target_path(meta: Dict[str, Any], link: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    std = project_path(meta)
    same = (
        link
        and link.get("file")
        and link.get("folder")
        and (not link.get("key") or link.get("key") == filing_key(meta))
    )
    if not same:
        return {**std, "folder": [std["company"], std["year"]]}
    folder = link["folder"]
    return {
        "company": folder[0] if len(folder) > 0 else "",
        "year": folder[1] if len(folder) > 1 else "",
        "folder": folder,
        "base": link["file"].replace(PROJECT_EXT, ""),
        "file": link["file"],
    }


targetPath = target_path


def newer_elsewhere(base: Optional[Dict[str, Any]], other: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not other:
        return {"newer": False, "other": None}
    if not base:
        return {"newer": True, "other": other}
    n_other = int(other.get("n", 0))
    n_base = int(base.get("n", 0))
    is_newer = n_other > n_base or (n_other == n_base and other.get("at") != base.get("at"))
    return {"newer": is_newer, "other": other}


newerElsewhere = newer_elsewhere


def read_workspace_project(root: Union[str, Path], meta: Dict[str, Any], link: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    root_p = Path(root)
    p = target_path(meta, link)
    target_dir = root_p.joinpath(*p["folder"])
    target_file = target_dir / p["file"]
    if not target_file.is_file():
        return None
    text = target_file.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
        return {
            "path": p,
            "json": data,
            "text": text,
            "lastSaved": data.get("meta", {}).get("lastSaved"),
        }
    except json.JSONDecodeError:
        return None


readWorkspaceProject = read_workspace_project


def save_to_workspace(
    root: Union[str, Path],
    project_json: Dict[str, Any],
    base: Optional[Dict[str, Any]] = None,
    force: bool = False,
    device: str = "",
    build: str = "",
    now: Optional[datetime.datetime] = None,
    link: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    root_p = Path(root)
    p = target_path(project_json.get("meta", {}), link)
    target_dir = root_p.joinpath(*p["folder"])
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / p["file"]

    cur = None
    if target_file.is_file():
        try:
            cur = json.loads(target_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    if cur and not force:
        cur_saved = cur.get("meta", {}).get("lastSaved")
        if newer_elsewhere(base, cur_saved)["newer"]:
            return {"status": "newer", "path": p, "other": cur_saved}

    backed_up = None
    if cur:
        bk_dir = target_dir / "backups"
        bk_dir.mkdir(exist_ok=True)
        v = cur.get("meta", {}).get("lastSaved", {}).get("n", 0)
        date_str = now.strftime("%Y-%m-%d_%H%M")
        bk_name = f"{p['base']}_{date_str}_v{v}{PROJECT_EXT}"
        bk_file = bk_dir / bk_name
        bk_file.write_text(json.dumps(cur, indent=2), encoding="utf-8")
        backed_up = bk_name

        existing_backups = sorted(
            [f for f in bk_dir.iterdir() if f.is_file() and f.name.endswith(PROJECT_EXT)],
            key=lambda f: f.stat().st_mtime,
        )
        while len(existing_backups) > BACKUPS_KEPT:
            oldest = existing_backups.pop(0)
            try:
                oldest.unlink()
            except OSError:
                pass

    stamp = stamp_project(project_json, device=device, build=build, now=now)
    target_file.write_text(json.dumps(project_json, indent=2), encoding="utf-8")
    return {"status": "saved", "path": p, "lastSaved": stamp, "backedUp": backed_up}


saveToWorkspace = save_to_workspace


def save_xml_to_workspace(
    root: Union[str, Path],
    xml_text: str,
    project_json: Dict[str, Any],
    gate_result: Optional[Dict[str, Any]] = None,
    now: Optional[datetime.datetime] = None,
    link: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if now is None:
        now = datetime.datetime.now(datetime.timezone.utc)
    root_p = Path(root)
    meta = project_json.get("meta", {})
    p = target_path(meta, link)
    target_dir = root_p.joinpath(*p["folder"])
    xml_dir = target_dir / "xml"
    xml_dir.mkdir(parents=True, exist_ok=True)

    cin = meta.get("cin") or clean_name(meta.get("name")) or "Unnamed"
    rep = under_name(meta.get("reportType")) or "Standalone"
    cy_end = meta.get("periods", {}).get("cy", {}).get("end") or "no-date"
    today_str = now.strftime("%Y-%m-%d")

    v = 1
    existing = [f.name for f in xml_dir.iterdir() if f.is_file() and f.name.endswith(".xml")]
    for fn in existing:
        m = re.match(r".*_v(\d+)_.*\.xml$", fn)
        if m:
            v = max(v, int(m.group(1)) + 1)

    xml_name = f"{cin}_{rep}_{cy_end}_v{v}_{today_str}.xml"
    xml_file = xml_dir / xml_name
    xml_file.write_text(xml_text, encoding="utf-8")

    bk_dir = target_dir / "backups"
    bk_dir.mkdir(exist_ok=True)
    proj_v = project_json.get("meta", {}).get("lastSaved", {}).get("n", 0)
    for_xml_name = f"{p['base']}_v{proj_v}_for-XML-v{v}{PROJECT_EXT}"
    (bk_dir / for_xml_name).write_text(json.dumps(project_json, indent=2), encoding="utf-8")

    return {
        "file": xml_name,
        "path": list(p["folder"]) + ["xml", xml_name],
        "v": v,
        "forXmlBackup": for_xml_name,
    }


saveXmlToWorkspace = save_xml_to_workspace


def list_workspace(root: Union[str, Path]) -> List[Dict[str, Any]]:
    root_p = Path(root)
    if not root_p.is_dir():
        return []

    filings = []
    for comp_dir in root_p.iterdir():
        if not comp_dir.is_dir():
            continue
        for fy_dir in comp_dir.iterdir():
            if not fy_dir.is_dir():
                continue
            for proj_file in fy_dir.glob(f"*{PROJECT_EXT}"):
                if proj_file.is_file():
                    try:
                        data = json.loads(proj_file.read_text(encoding="utf-8"))
                        meta = data.get("meta", {})
                        filings.append({
                            "company": comp_dir.name,
                            "year": fy_dir.name,
                            "file": proj_file.name,
                            "path": str(proj_file),
                            "meta": meta,
                            "lastSaved": meta.get("lastSaved"),
                            "key": filing_key(meta),
                        })
                    except Exception:
                        pass

    filings.sort(key=lambda x: (x["company"], x["year"], x["file"]))
    return filings


listWorkspace = list_workspace
