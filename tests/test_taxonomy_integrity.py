"""
test_taxonomy_integrity.py
Comprehensive 3-Layer Validation Suite for MCA XBRL Taxonomies:
Layer 1: Taxonomy Integrity (XSD concepts, types, namespaces, linkbases)
Layer 2: Business Rule Integrity (Mandatory concepts, table line-item checks)
Layer 3: Cross-Taxonomy Isolation (Strict boundary between C&I, Costing, IND-AS)
"""

import sys
import unittest
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from src.core.taxonomy_loader import load_taxonomy, TaxonomyLoader
from src.constants import TAXONOMY_CI, TAXONOMY_COSTING, TAXONOMY_IND_AS


class TestTaxonomyIntegrity(unittest.TestCase):
    """LAYER 1: XSD concept validity, label coverage, and relationship closure."""

    @classmethod
    def setUpClass(cls):
        cls.ci = load_taxonomy(TAXONOMY_CI)
        cls.cost = load_taxonomy(TAXONOMY_COSTING)
        cls.ind_as = load_taxonomy(TAXONOMY_IND_AS)

    def test_01_concept_counts_match_metadata(self):
        """Metadata totalConcepts must match actual length of concepts dict."""
        for tax_type, kb, min_count in [
            ("C&I", self.ci, 3600),
            ("Costing", self.cost, 450),
            ("IND-AS", self.ind_as, 5600),
        ]:
            total = len(kb.concepts)
            meta_count = kb.meta.get("totalConcepts")
            self.assertEqual(total, meta_count, f"{tax_type}: concepts count ({total}) != metadata ({meta_count})")
            self.assertGreaterEqual(total, min_count, f"{tax_type}: concept count too low ({total})")

    def test_02_all_concepts_have_english_labels(self):
        """100% of concepts in all 3 taxonomies must have an English label."""
        for tax_type, kb in [("C&I", self.ci), ("Costing", self.cost), ("IND-AS", self.ind_as)]:
            missing = []
            for qn, c in kb.concepts.items():
                labels = c.get("labels", {})
                en_lbl = labels.get("label") or labels.get("terseLabel")
                if not en_lbl:
                    missing.append(qn)
            self.assertEqual(len(missing), 0, f"{tax_type} has {len(missing)} concepts missing English labels: {missing[:5]}")

    def test_03_concepts_structural_integrity(self):
        """All concepts must have valid QName, name, prefix, namespace, periodType, and source."""
        for tax_type, kb in [("C&I", self.ci), ("Costing", self.cost), ("IND-AS", self.ind_as)]:
            for qn, c in kb.concepts.items():
                self.assertEqual(c.get("qname"), qn)
                self.assertTrue(len(c.get("name", "")) > 0)
                self.assertTrue(len(c.get("prefix", "")) > 0)
                self.assertTrue(c.get("namespace", "").startswith("http"))
                self.assertIn("periodType", c)
                self.assertIsInstance(c.get("abstract"), bool)
                self.assertIsInstance(c.get("nillable"), bool)
                self.assertTrue(len(c.get("source", "")) > 0)

    def test_04_linkbases_zero_dangling_arcs(self):
        """Guarantees zero dangling arcs in presentation, calculation, and definition linkbases."""
        for tax_type, kb in [("C&I", self.ci), ("Costing", self.cost), ("IND-AS", self.ind_as)]:
            concept_qnames = set(kb.concepts.keys())
            for rel_name, rel_dict in [
                ("presentation", kb.presentation),
                ("calculation", kb.calculation),
                ("definition", kb.definition),
            ]:
                dangling_from = []
                dangling_to = []
                for elr, arcs in rel_dict.items():
                    for arc in arcs:
                        if arc["from"] not in concept_qnames:
                            dangling_from.append((elr, arc["from"]))
                        if arc["to"] not in concept_qnames:
                            dangling_to.append((elr, arc["to"]))

                self.assertEqual(len(dangling_from), 0, f"{tax_type} {rel_name} has dangling 'from': {dangling_from[:3]}")
                self.assertEqual(len(dangling_to), 0, f"{tax_type} {rel_name} has dangling 'to': {dangling_to[:3]}")


class TestBusinessRuleIntegrity(unittest.TestCase):
    """LAYER 2: Mandatory concepts, line items, and table rules."""

    @classmethod
    def setUpClass(cls):
        cls.ci = load_taxonomy(TAXONOMY_CI)
        cls.cost = load_taxonomy(TAXONOMY_COSTING)
        cls.ind_as = load_taxonomy(TAXONOMY_IND_AS)

    def test_05_mandatory_concepts_all_exist(self):
        """Every concept marked mandatory must exist in concepts and have isMandatory=True."""
        for tax_type, kb, expected_min in [("C&I", self.ci, 100), ("Costing", self.cost, 50), ("IND-AS", self.ind_as, 150)]:
            mand_list = kb.business_rules.get("mandatoryConcepts", [])
            self.assertGreaterEqual(len(mand_list), expected_min, f"{tax_type} mandatory count too low")

            missing = [qn for qn in mand_list if qn not in kb.concepts]
            self.assertEqual(len(missing), 0, f"{tax_type} has missing mandatory concepts: {missing}")

            for qn in mand_list:
                self.assertTrue(kb.is_mandatory(qn), f"{qn} should be mandatory in {tax_type}")

    def test_06_mandatory_line_items_zero_unresolved(self):
        """100% of concept references in mandatoryLineItems must resolve to valid concepts."""
        for tax_type, kb in [("C&I", self.ci), ("Costing", self.cost), ("IND-AS", self.ind_as)]:
            line_items = kb.business_rules.get("mandatoryLineItems", {})
            unresolved = []
            for tbl, items in line_items.items():
                for item in items:
                    if item not in kb.concepts:
                        unresolved.append((tbl, item))

            self.assertEqual(len(unresolved), 0, f"{tax_type} has {len(unresolved)} unresolved line-items: {unresolved[:5]}")

    def test_07b_zero_empty_rule_text(self):
        """Guarantees 100% of business rules have actual non-empty ruleText descriptions."""
        for tax_type, kb in [("C&I", self.ci), ("Costing", self.cost), ("IND-AS", self.ind_as)]:
            rules = kb.business_rules.get("rules", [])
            self.assertGreater(len(rules), 0, f"{tax_type} has no rules defined")
            empty_rules = [r for r in rules if not str(r.get("ruleText", "")).strip()]
            self.assertEqual(len(empty_rules), 0, f"{tax_type} has {len(empty_rules)} rules with empty ruleText")

    def test_07_ind_as_table_rules_structured(self):
        """IND-AS table rules must be structured with explicit ruleType classifications."""
        table_rules = self.ind_as.business_rules.get("tableRules", {})
        self.assertGreaterEqual(len(table_rules), 100, f"Expected ~108 table rules in IND-AS, got {len(table_rules)}")
        for tbl, rule in table_rules.items():
            self.assertIn("ruleType", rule)
            self.assertIn(rule["ruleType"], [
                "specific_mandatory_line_items",
                "all_line_items_mandatory",
                "all_items_mandatory_except"
            ])


class TestCrossTaxonomyIsolation(unittest.TestCase):
    """LAYER 3: Strict boundary separation between C&I, Costing, and IND-AS."""

    @classmethod
    def setUpClass(cls):
        cls.ci = load_taxonomy(TAXONOMY_CI)
        cls.cost = load_taxonomy(TAXONOMY_COSTING)
        cls.ind_as = load_taxonomy(TAXONOMY_IND_AS)

    def test_08_namespaces_are_strictly_isolated(self):
        """Taxonomies must only contain their official namespaces."""
        # C&I
        self.assertIn("http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap", self.ci.namespaces.values())
        self.assertNotIn("http://www.icmai.in/xbrl/2018-04-01/in-cost", self.ci.namespaces.values())
        self.assertNotIn("http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as", self.ci.namespaces.values())

        # Costing
        self.assertIn("http://www.icmai.in/xbrl/2018-04-01/in-cost", self.cost.namespaces.values())
        self.assertNotIn("http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap", self.cost.namespaces.values())
        self.assertNotIn("http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as", self.cost.namespaces.values())

        # IND-AS
        self.assertIn("http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as", self.ind_as.namespaces.values())
        self.assertNotIn("http://www.icai.org/xbrl/taxonomy/2016-03-31/in-gaap", self.ind_as.namespaces.values())
        self.assertNotIn("http://www.icmai.in/xbrl/2018-04-01/in-cost", self.ind_as.namespaces.values())

    def test_09_concepts_do_not_leak_across_taxonomies(self):
        """Cross-querying concepts between different taxonomies must return None."""
        costing_concept = "in-cost:CostAuditorsObservationsOrSuggestionsExplanatory"
        self.assertIsNotNone(self.cost.get_concept(costing_concept))
        self.assertIsNone(self.ci.get_concept(costing_concept))
        self.assertIsNone(self.ind_as.get_concept(costing_concept))

        ci_concept = "in-gaap:ShareCapital"
        self.assertIsNotNone(self.ci.get_concept(ci_concept))
        self.assertIsNone(self.cost.get_concept(ci_concept))

        ind_as_concept = "ind-as:PropertyPlantAndEquipment"
        self.assertIsNotNone(self.ind_as.get_concept(ind_as_concept))
        self.assertIsNone(self.ci.get_concept(ind_as_concept))
        self.assertIsNone(self.cost.get_concept(ind_as_concept))

    def test_10_cache_isolation(self):
        """TaxonomyLoader must cache each taxonomy independently without crosstalk."""
        TaxonomyLoader.clear_cache()
        ci = TaxonomyLoader.load(TAXONOMY_CI)
        cost = TaxonomyLoader.load(TAXONOMY_COSTING)
        ind_as = TaxonomyLoader.load(TAXONOMY_IND_AS)
        self.assertIsNot(ci, cost)
        self.assertIsNot(cost, ind_as)
        self.assertEqual(ci.taxonomy_type, TAXONOMY_CI)
        self.assertEqual(cost.taxonomy_type, TAXONOMY_COSTING)
        self.assertEqual(ind_as.taxonomy_type, TAXONOMY_IND_AS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
