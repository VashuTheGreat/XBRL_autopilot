"""Text helpers for matching row labels to element labels: normalisation, tokens, dates in column headers."""
from __future__ import annotations

import datetime as dt
import re

_SPELLING = {
    "&": " and ",
    "p&l": "profit and loss",
    "pl": "profit and loss",
    "w.i.p": "work in progress",
    "wip": "work in progress",
    "cwip": "capital work in progress",
    "ppe": "property plant and equipment",
    "rs.": "",
    "rs": "",
    "inr": "",
    # misspellings seen in client workbooks
    "liabilites": "liabilities",
    "liablities": "liabilities",
    "liabilties": "liabilities",
    "recievables": "receivables",
}
# words that carry no meaning for matching (kept short: "net", "other", "total" do carry meaning)
STOPWORDS = frozenset({"the", "of", "a", "an", "to", "for", "in", "on", "from", "by", "with", "as", "at", "its", "per", "under", "and", "or", "is", "are", "be"})
_LEADING_ENUM = re.compile(r"^\s*(?:\(?[ivxlcdm]+\)|\(?[a-z]\)|\(?\d{1,2}\)|[ivxlcdm]+\.|[a-z]\.|\d{1,2}\.|[-–•*])\s+", re.I)
_NOTE_PREFIX = re.compile(r"^\s*note\s*(?:no\.?)?\s*\d+[a-z]?\s*[:.\-–]?\s*", re.I)
_BRACKETS = re.compile(r"\[[^\]]*\]|\((?:refer|see|note)[^)]*\)", re.I)
_NON_WORD = re.compile(r"[^a-z0-9]+")


def clean_label(s: str) -> str:
    """A row label as a person reads it: no enumeration ("(i)", "a."), no "NOTE 8 :", no "[Refer note …]", single spaces."""
    t = str(s).replace("\n", " ").replace(" ", " ")
    t = _BRACKETS.sub(" ", t)
    t = _NOTE_PREFIX.sub("", t)
    for _ in range(2):
        t = _LEADING_ENUM.sub("", t)
    return re.sub(r"\s+", " ", t).strip(" :-–")


def norm_label(s: str) -> str:
    """Lower-case words only, for exact comparison ("Trade Receivables" == "trade receivables")."""
    t = clean_label(s).lower()
    t = t.replace("&", " and ").replace("non-current", "noncurrent").replace("non current", "noncurrent")
    t = t.replace("stock-in-trade", "stock in trade").replace("work-in-progress", "work in progress")
    words = [w for w in _NON_WORD.split(t) if w]
    out: list[str] = []
    for w in words:
        rep = _SPELLING.get(w)
        if rep is None:
            out.append(w)
        elif rep:
            out.extend(rep.split())
    return " ".join(out)


def stem(w: str) -> str:
    """Very light stemming so "receivables" ~ "receivable", "expenses" ~ "expense", "liabilities" ~ "liability"."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


# Statement wording → taxonomy wording, word by word (taxonomy labels say "period" where statements say "year")
_TOKEN_SYNONYMS = {"year": "period", "earlier": "previous", "prior": "previous"}

# Common Schedule III / Ind AS line wording whose taxonomy label is phrased differently (normalised text → label text)
PHRASE_ALIASES = {
    "other bank balances": "bank balance other than cash and cash equivalents",
    "bank balances other than above": "bank balance other than cash and cash equivalents",
    "bank balances other than cash and cash equivalents": "bank balance other than cash and cash equivalents",
    "cash generated from operating activities": "cash flows from used in operations",
    "cash generated from operations": "cash flows from used in operations",
    "profit loss for the year": "profit loss for period",
    "profit for the year": "profit loss for period",
    "total comprehensive income for the year": "comprehensive income",
    "income tax for earlier years": "current tax pertaining to previous years",
}

QUALIFIERS = ("current", "noncurrent")


def tokens(s: str) -> list[str]:
    out = []
    for w in norm_label(s).split():
        if w in STOPWORDS:
            continue
        t = stem(w)
        out.append(_TOKEN_SYNONYMS.get(t, t))
    return out


def qualifier(label: str, context: list[str]) -> str | None:
    """current / noncurrent, from the label itself or else the innermost heading that says so."""
    for text in (label, *reversed(context)):
        toks = set(tokens(text))
        if "noncurrent" in toks:
            return "noncurrent"
        if "current" in toks and "account" not in toks:  # "In Current Accounts" is a bank account
            return "current"
    return None


_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
_DMY_TEXT = re.compile(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:of\s+)?([a-z]{3,9})[\s,.'-]*(\d{4}|\d{2})\b", re.I)
_MDY_TEXT = re.compile(r"\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})\b", re.I)
_NUMERIC = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b")
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _year(y: str) -> int:
    n = int(y)
    return n + 2000 if n < 100 else n


def _safe(y: int, m: int, d: int) -> dt.date | None:
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


def header_dates(text: str) -> list[dt.date]:
    """Dates written in a column header: "As at 31st March 2026", "31.03.2026", "March 31, 2026", "2026-03-31"."""
    t = str(text).replace("\n", " ")
    found: list[dt.date] = []
    for d, mon, y in _DMY_TEXT.findall(t):
        m = _MONTHS.get(mon[:3].lower())
        if m and (x := _safe(_year(y), m, int(d))):
            found.append(x)
    for mon, d, y in _MDY_TEXT.findall(t):
        m = _MONTHS.get(mon[:3].lower())
        if m and (x := _safe(int(y), m, int(d))):
            found.append(x)
    for d, m, y in _NUMERIC.findall(t):
        if x := _safe(_year(y), int(m), int(d)):
            found.append(x)
    for y, m, d in _ISO.findall(t):
        if x := _safe(int(y), int(m), int(d)):
            found.append(x)
    return found


_SCALES = [
    (re.compile(r"\bcrores?\b|\bcr\.?\b", re.I), "Crores"),
    (re.compile(r"\blakhs?\b|\blacs?\b|\blacs\b", re.I), "Lakhs"),
    (re.compile(r"\bmillions?\b|\bmn\b", re.I), "Millions"),
    (re.compile(r"\bthousands?\b|'000|\b000s\b", re.I), "Thousands"),
]


def scale_of(text: str) -> str | None:
    """The rounding level a sheet states ("(Rs. in Lakh unless otherwise stated)" → Lakhs)."""
    t = str(text)
    if not re.search(r"\b(?:rs|inr|rupees|₹|amount|figures)\b|₹|in\s+(?:lakh|crore|thousand|million)", t, re.I):
        return None
    for rx, level in _SCALES:
        if rx.search(t):
            return level
    return None
