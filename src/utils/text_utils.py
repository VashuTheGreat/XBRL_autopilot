"""Text helpers for XBRL: label cleaning, normalization, tokenization, numbers in text, and header dates."""
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
    "liabilites": "liabilities",
    "liablities": "liabilities",
    "liabilties": "liabilities",
    "recievables": "receivables",
}

STOPWORDS = frozenset({
    "the", "of", "a", "an", "to", "for", "in", "on", "from", "by", "with", "as",
    "at", "its", "per", "under", "and", "or", "is", "are", "be"
})
_LEADING_ENUM = re.compile(
    r"^\s*(?:\(?[ivxlcdm]+\)|\(?[a-z]\)|\(?\d{1,2}\)|[ivxlcdm]+\.|[a-z]\.|\d{1,2}\.|[-–•*])\s+",
    re.I,
)
_NOTE_PREFIX = re.compile(r"^\s*note\s*(?:no\.?)?\s*\d+[a-z]?\s*[:.\-–]?\s*", re.I)
_BRACKETS = re.compile(r"\[[^\]]*\]|\((?:refer|see|note)[^)]*\)", re.I)
_NON_WORD = re.compile(r"[^a-z0-9]+")


def clean_label(s: str) -> str:
    """A row label as a person reads it: no enumeration ("(i)", "a."), no "NOTE 8 :", single spaces."""
    t = str(s).replace("\n", " ").replace("\xa0", " ")
    t = _BRACKETS.sub(" ", t)
    t = _NOTE_PREFIX.sub("", t)
    for _ in range(2):
        t = _LEADING_ENUM.sub("", t)
    return re.sub(r"\s+", " ", t).strip(" :-–")


def norm_label(s: str) -> str:
    """Lower-case words only, for exact comparison."""
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
    """Very light stemming."""
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


_TOKEN_SYNONYMS = {"year": "period", "earlier": "previous", "prior": "previous"}


def tokens(s: str) -> list[str]:
    out = []
    for w in norm_label(s).split():
        if w in STOPWORDS:
            continue
        t = stem(w)
        out.append(_TOKEN_SYNONYMS.get(t, t))
    return out


_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
_DATES_IN_TEXT = re.compile("|".join([
    r"\b\d{4}-\d{2}-\d{2}\b",
    rf"\b{_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{2,4}}\b",
    rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH},?\s+\d{{2,4}}\b",
    r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b",
    r"\b(?:fy\s*)?\d{4}\s*[-–/]\s*\d{2,4}\b",
]), re.I)
_NUMBER_IN_TEXT = re.compile(r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?")


def numbers_in_text(text: str) -> list[str]:
    """The figures a text cell states, in order, with its dates removed and grouping commas dropped."""
    plain = _DATES_IN_TEXT.sub(" ", text)
    return [m.group(0).replace(",", "") for m in _NUMBER_IN_TEXT.finditer(plain)]
