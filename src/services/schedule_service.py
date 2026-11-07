"""Schedule & Notes Relationship Service.

Manages relationships between primary financial statement concepts,
mandated schedule linkbases, and workbook schedule worksheets.

Tracks schedule completeness and provides the domain logic for
the centralized tagging status model:
  - UNTAGGED
  - AI_RECOMMENDED
  - MAPPED_INCOMPLETE
  - SCHEDULE_REQUIRED
  - SCHEDULE_LINKED
  - COMPLETE
  - INVALID
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple
from src.core.logger import logger

# Mapping of primary financial statement concepts to their mandated schedule ELR codes and titles
# for MCA C&I 2016
CI_MANDATED_SCHEDULES: Dict[str, Dict[str, Any]] = {
    "in-gaap:TangibleAssets": {
        "elrCode": "200500",
        "elrTitle": "Notes - Tangible assets",
        "sheetHint": "Fixed Assets",
        "description": "Gross block, additions, deductions, depreciation and net carrying amount schedule required.",
    },
    "in-gaap:IntangibleAssets": {
        "elrCode": "200600",
        "elrTitle": "Notes - Intangible assets",
        "sheetHint": "Fixed Assets",
        "description": "Intangible asset additions, amortisation, and impairment schedule required.",
    },
    "in-gaap:ShareCapital": {
        "elrCode": "200100",
        "elrTitle": "Notes - Share capital",
        "sheetHint": "BS Sch",
        "description": "Authorised, issued, subscribed share capital and shareholder details required.",
    },
    "in-gaap:ReservesAndSurplus": {
        "elrCode": "200200",
        "elrTitle": "Notes - Reserves and surplus",
        "sheetHint": "BS Sch",
        "description": "Opening balance, additions during the year, deductions and closing balance required.",
    },
    "in-gaap:LongTermBorrowings": {
        "elrCode": "200300",
        "elrTitle": "Notes - Borrowings",
        "sheetHint": "BS Sch",
        "description": "Term loans, bonds/debentures, and security details required.",
    },
    "in-gaap:ShortTermBorrowings": {
        "elrCode": "200300",
        "elrTitle": "Notes - Borrowings",
        "sheetHint": "BS Sch",
        "description": "Short-term borrowings break-up required.",
    },
    "in-gaap:TradePayables": {
        "elrCode": "200600",
        "elrTitle": "Notes - Subclassification and notes on liabilities and assets",
        "sheetHint": "BS Sch",
        "description": "MSME vs Other trade payables aging details required.",
    },
    "in-gaap:TradeReceivables": {
        "elrCode": "200600",
        "elrTitle": "Notes - Subclassification and notes on liabilities and assets",
        "sheetHint": "BS Sch",
        "description": "Trade receivables aging and doubtful debts provision details required.",
    },
    "in-gaap:Inventories": {
        "elrCode": "200600",
        "elrTitle": "Notes - Subclassification and notes on liabilities and assets",
        "sheetHint": "BS Sch",
        "description": "Raw materials, work-in-progress, finished goods valuation details required.",
    },
    "in-gaap:CashAndCashEquivalents": {
        "elrCode": "200600",
        "elrTitle": "Notes - Subclassification and notes on liabilities and assets",
        "sheetHint": "BS Sch",
        "description": "Bank balances, fixed deposits, cash on hand break-up required.",
    },
    "in-gaap:RevenueFromOperations": {
        "elrCode": "200700",
        "elrTitle": "Notes - Additional disclosures on balance sheet and P&L",
        "sheetHint": "PL Sch",
        "description": "Sale of products, sale of services, other operating revenue break-up required.",
    },
    "in-gaap:EmployeeBenefitExpense": {
        "elrCode": "200700",
        "elrTitle": "Notes - Additional disclosures on balance sheet and P&L",
        "sheetHint": "PL Sch",
        "description": "Salaries, wages, bonus, PF contribution details required.",
    },
}

# Centralized Tagging Status Codes
STATUS_UNTAGGED = "UNTAGGED"
STATUS_AI_RECOMMENDED = "AI_RECOMMENDED"
STATUS_MAPPED_INCOMPLETE = "MAPPED_INCOMPLETE"
STATUS_SCHEDULE_REQUIRED = "SCHEDULE_REQUIRED"
STATUS_SCHEDULE_LINKED = "SCHEDULE_LINKED"
STATUS_COMPLETE = "COMPLETE"
STATUS_INVALID = "INVALID"


class ScheduleService:
    """Manages schedule requirements, linking, and status evaluation."""

    def __init__(self, authority: Any):
        self.A = authority

    def get_schedule_requirement(self, concept: str) -> Optional[Dict[str, Any]]:
        """Returns mandated schedule metadata if the concept requires an associated schedule."""
        if not concept:
            return None
        return CI_MANDATED_SCHEDULES.get(concept)

    def evaluate_tag_status(
        self,
        concept: Optional[str],
        cy_val: Any,
        py_val: Any,
        schedule_links: Optional[List[Dict[str, Any]]] = None,
        confidence: Optional[float] = None,
        is_ai_staged: bool = False,
    ) -> Dict[str, Any]:
        """Evaluates the centralized 7-state tagging status for a line item."""
        if not concept:
            return {
                "status": STATUS_UNTAGGED,
                "label": "Untagged",
                "color": "var(--status-untagged, #6c757d)",
                "icon": "⚪",
                "isComplete": False,
            }

        if is_ai_staged:
            conf_pct = int((confidence or 0.95) * 100)
            return {
                "status": STATUS_AI_RECOMMENDED,
                "label": f"AI Suggested ({conf_pct}%)",
                "color": "var(--status-ai, #4f46e5)",
                "icon": "✨",
                "isComplete": False,
            }

        # Check concept validity in active authority
        c_info = self.A.concept(concept)
        if not c_info:
            return {
                "status": STATUS_INVALID,
                "label": "Invalid Tag (Not in Taxonomy)",
                "color": "var(--status-invalid, #dc2626)",
                "icon": "❌",
                "isComplete": False,
            }

        has_values = (cy_val is not None and str(cy_val).strip() != "") or (py_val is not None and str(py_val).strip() != "")
        if not has_values and not c_info.get("abstract"):
            return {
                "status": STATUS_MAPPED_INCOMPLETE,
                "label": "Mapped (No Values)",
                "color": "var(--status-incomplete, #f59e0b)",
                "icon": "⚠️",
                "isComplete": False,
            }

        # Check if concept mandates schedule details
        req = self.get_schedule_requirement(concept)
        if req:
            links = [l for l in (schedule_links or []) if l.get("concept") == concept]
            if not links:
                return {
                    "status": STATUS_SCHEDULE_REQUIRED,
                    "label": f"Schedule Required: [{req['elrCode']}] {req['elrTitle']}",
                    "color": "var(--status-schedule-req, #ef4444)",
                    "icon": "🔴",
                    "scheduleInfo": req,
                    "isComplete": False,
                }
            return {
                "status": STATUS_SCHEDULE_LINKED,
                "label": f"Schedule Linked ({len(links)} item{'s' if len(links) > 1 else ''})",
                "color": "var(--status-schedule-linked, #2563eb)",
                "icon": "🔗",
                "scheduleInfo": req,
                "isComplete": True,
            }

        return {
            "status": STATUS_COMPLETE,
            "label": "Complete",
            "color": "var(--status-complete, #16a34a)",
            "icon": "✅",
            "isComplete": True,
        }
