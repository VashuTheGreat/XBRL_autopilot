"""Resolves element / table names written in MCA rule text to taxonomy qnames (port of ``makeResolver``)."""
from __future__ import annotations

from typing import Any

from src.services.engine_rules.jsre import ji, js, trim

# Curated spelling corrections for element references in the MCA rule text that do not match any taxonomy
# name or label. Each maps to the single concept the sentence context implies. A key that resolves to no
# concept of the taxonomy being built is inert.
TYPO_ALIASES = {
    "longtermloandandadvances": "LongTermLoansAndAdvances",
    "shorttermloandandadvances": "ShortTermLoansAndAdvances",
    "currentinvestment": "CurrentInvestments",
    "noncurrentinvestment": "NoncurrentInvestments",
    # C&I [200600] table row: "'TrdaeReceivable' is other than zero" (SubclassificationOfTradeReceivablesTable)
    "trdaereceivable": "TradeReceivables",
    # C&I [300400] rows 1245/1247/1248 insert "The" into the element named in row 1244 / 1247
    "whethermaintenanceofcostrecordsbythecompanyhasbeenmandatedundercompaniescostrecordsandauditrules2014": "WhetherMaintenanceOfCostRecordsByCompanyHasBeenMandatedUnderCompaniesCostRecordsAndAuditRules2014",
    "whetherauditofcostrecordsofthecompanyhasbeenmandatedunderrulesspecifiedinsn1": "WhetherAuditOfCostRecordsOfCompanyHasBeenMandatedUnderRulesSpecifiedInSN1",
    # C&I [400400] table rows: misspelt names of the two Yes/No elements of the same ELR
    "whetertherearecontractsarrangementstransactionsnotatarmslength": "WhetherThereAreContractsArrangementsTransactionsNotAtArmsLengthBasis",
    "whethertherearecontractsarrangementstransactionsatarmslengthbasis": "WhetherThereAreMaterialContractsArrangementsTransactionsAtArmsLengthBasis",
    # C&I [400500] rows 4138/4140: 'CategoryOfSecreterialAuditor'
    "categoryofsecreterialauditor": "CategoryOfSecretarialAuditor",
    # C&I [400100] rows 3685-3687: "name of the service provide(r)"
    "nameoftheserviceprovide": "NameOfTheServiceProvider",
    "nameoftheserviceprovider": "NameOfTheServiceProvider",
    # Ind AS [610900]: the first-time-adoption question is quoted by a label the taxonomy doesn't have
    "whetheristhisfirsttimeadoptionofindas": "WhetherCompanyHasAdoptedIndAsFirstTime",
    # Ind AS [210000] row 105: "Discontinuing" for "Discontinued"
    "profitlossfromdiscontinuingoperationsbeforetax": "ProfitLossFromDiscontinuedOperationsBeforeTax",
    # Ind AS [401100] rows 1488/1566: misspelt current / non-current loans and advances
    "currrentloans": "LoansCurrent",
    "noncurrentloans": "LoansNoncurrent",
    "currrentadvances": "CurrentAdvances",
    # Ind AS [400300] row 3262: "liabilties"
    "noncurrentfinancialliabilties": "NoncurrentFinancialLiabilities",
    # Ind AS [612100] row 5285: the label lacks "during the year"
    "whetherthereisanyimpairmentlossorreversalofimpairmentloss": "WhetherThereIsAnyImpairmentLossOrReversalOfImpairmentLossDuringTheYear",
}

_NON_ALNUM = js(r"[^a-z0-9]")
_BRACKETED = js(r"\[[^\]]*\]")
_QUOTES_EDGE = js(r"^['\"\s]+|['\"\s]+$")
_OPEN_CLOSE = ji(r"\s*\((closing|opening)\)\s*$")
_AFTER_QUOTE = js(r"'.*$")
_IN_NOTES = ji(r"\s+in\s+notes.*$")


def norm(s: str) -> str:
    return _NON_ALNUM.sub("", s.lower())


def local(q: str) -> str:
    return q.split(":")[1]


class Resolver:
    def __init__(self, A: dict[str, Any], typo_aliases: dict[str, str] | None = None):
        self.A = A
        self.typos = TYPO_ALIASES if typo_aliases is None else typo_aliases
        self.by_local: dict[str, list[str]] = {}
        self.by_norm: dict[str, list[str]] = {}
        self.by_label: dict[str, list[str]] = {}
        for q, c in A["concepts"].items():
            self.by_local.setdefault(c["name"], []).append(q)
            self.by_norm.setdefault(norm(c["name"]), []).append(q)
            for lab in (c.get("labels") or {}).values():
                self.by_label.setdefault(norm(_BRACKETED.sub("", lab)), []).append(q)
        self._tables_by_id = {t["id"]: t for t in A["tables"]}

    def _pick(self, arr: list[str] | None) -> str | None:
        if not arr:
            return None
        u = list(dict.fromkeys(arr))
        if len(u) == 1:
            return u[0]
        # prefer reportable items over abstracts/members when a label is shared
        items = [q for q in u if self.A["concepts"][q]["kind"] == "item"]
        return items[0] if len(items) == 1 else sorted(u)[0]

    def concept(self, tok: str | None) -> str | None:
        if not tok:
            return None
        t = trim(_OPEN_CLOSE.sub("", _QUOTES_EDGE.sub("", tok), count=1))
        if t in self.by_local:
            return self._pick(self.by_local[t])
        n = norm(t)
        if n in self.typos:
            return self._pick(self.by_local.get(self.typos[n]))
        return self._pick(self.by_norm.get(n)) or self._pick(self.by_label.get(n))

    def table(self, tok: str) -> list[str] | None:
        n = norm(_IN_NOTES.sub("", _AFTER_QUOTE.sub("", tok, count=1), count=1))
        hits = [
            t["id"] for t in self.A["tables"]
            if norm(local(t["hypercube"])) == n or norm(local(t["hypercube"])) == n + "table"
        ]
        return hits or None

    def tables_by_hc(self, local_name: str) -> list[str]:
        return [t["id"] for t in self.A["tables"] if local(t["hypercube"]) == local_name]

    def table_def(self, table_id: str) -> dict:
        return self._tables_by_id[table_id]

    local = staticmethod(local)
