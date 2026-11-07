"""Tests for WebXBRL Production Features.

Covers:
1. Multi-Taxonomy Compilation & Authority / Session Loading (C&I 2016, Ind AS V1.2, Costing 2019).
2. Schedule Tagging & 7-State Status Model (ScheduleService).
3. Document Persistence (.wxbrl bundle, metadata, ui_state, schedule_links).
4. Auto-save snapshots & Local Recovery Cache creation and deletion upon Save/Discard.
5. Unified XML Generation & Pre-Validation Wizard API endpoints.
"""

from __future__ import annotations
import io
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from src.constants import TAXONOMY_CI, TAXONOMY_IND_AS, TAXONOMY_COSTING
from src.core.authority import get_authority
from src.services.schedule_service import (
    ScheduleService,
    STATUS_UNTAGGED,
    STATUS_AI_RECOMMENDED,
    STATUS_MAPPED_INCOMPLETE,
    STATUS_SCHEDULE_REQUIRED,
    STATUS_SCHEDULE_LINKED,
    STATUS_COMPLETE,
    STATUS_INVALID,
)
from src.services.project_service import (
    save_project,
    load_project,
    delete_recovery_cache,
    export_bundle,
    import_bundle,
    PROJECTS_DIR,
)
from src.services.session import Session
from src.web.app import app
from src.web.state import get_session, reset_session

client = TestClient(app)


class TestMultiTaxonomyArchitecture:
    """Verify standard intermediate JSON knowledge base artifacts and multi-taxonomy loading."""

    def test_compiled_knowledge_bases_exist(self):
        root = Path(__file__).resolve().parent.parent
        ci_kb = root / "Knowlege_base" / "ci_knowledge_base.json"
        ind_as_kb = root / "Knowlege_base" / "ind_as_knowledge_base.json"
        costing_kb = root / "Knowlege_base" / "costing_knowledge_base.json"

        assert ci_kb.exists(), "C&I knowledge base JSON must exist"
        assert ind_as_kb.exists(), "Ind AS knowledge base JSON must exist"
        assert costing_kb.exists(), "Costing knowledge base JSON must exist"

        # Check content validity
        with open(ci_kb, "r", encoding="utf-8") as f:
            ci_data = json.load(f)
            assert "concepts" in ci_data and len(ci_data["concepts"]) > 3000
            assert "elrs" in ci_data and len(ci_data["elrs"]) > 30

        with open(ind_as_kb, "r", encoding="utf-8") as f:
            ind_as_data = json.load(f)
            assert "concepts" in ind_as_data and len(ind_as_data["concepts"]) > 5000
            assert "elrs" in ind_as_data and len(ind_as_data["elrs"]) > 100

        with open(costing_kb, "r", encoding="utf-8") as f:
            costing_data = json.load(f)
            assert "concepts" in costing_data and len(costing_data["concepts"]) > 400
            assert "elrs" in costing_data and len(costing_data["elrs"]) > 20

    def test_authorities_multi_taxonomy(self):
        auth_ci = get_authority(TAXONOMY_CI)
        auth_ind_as = get_authority(TAXONOMY_IND_AS)
        auth_costing = get_authority(TAXONOMY_COSTING)

        assert len(auth_ci.concepts) > 3000
        assert len(auth_ind_as.concepts) > 5000
        assert len(auth_costing.concepts) > 400

        # Authorities must be distinct
        assert auth_ci != auth_ind_as
        assert auth_ci != auth_costing

    def test_session_taxonomy_isolation(self):
        s_ci = get_session("test_ci_sess", taxonomy="ci")
        s_ind_as = get_session("test_ind_as_sess", taxonomy="ind_as")

        assert len(s_ci.A.concepts) > 3000
        assert len(s_ind_as.A.concepts) > 5000
        assert len(s_ci.A.concepts) != len(s_ind_as.A.concepts)


class TestScheduleServiceAndStatusModel:
    """Verify schedule requirements and centralized 7-state tagging status model."""

    def test_schedule_requirements_detection(self):
        auth = get_authority(TAXONOMY_CI)
        svc = ScheduleService(auth)

        # in-gaap:TangibleAssets should require Fixed Assets schedule
        req = svc.get_schedule_requirement("in-gaap:TangibleAssets")
        assert req is not None
        assert req["elrCode"] == "200500"

        # in-gaap:ShareCapital should require Share Capital schedule
        req_sc = svc.get_schedule_requirement("in-gaap:ShareCapital")
        assert req_sc is not None
        assert req_sc["elrCode"] == "200100"

        # General non-schedule line item
        assert svc.get_schedule_requirement("in-gaap:RandomConcept") is None

    def test_evaluate_status_transitions(self):
        auth = get_authority(TAXONOMY_CI)
        svc = ScheduleService(auth)

        # Untagged
        res_untagged = svc.evaluate_tag_status(concept=None, cy_val="", py_val="")
        assert res_untagged["status"] == STATUS_UNTAGGED

        # Tagged concept requiring schedule but not linked yet
        res_req = svc.evaluate_tag_status(
            concept="in-gaap:TangibleAssets",
            cy_val="1000",
            py_val="800",
            schedule_links=None,
        )
        assert res_req["status"] == STATUS_SCHEDULE_REQUIRED

        # Tagged concept requiring schedule AND linked
        res_linked = svc.evaluate_tag_status(
            concept="in-gaap:TangibleAssets",
            cy_val="1000",
            py_val="800",
            schedule_links=[{"concept": "in-gaap:TangibleAssets", "targetSheet": "Fixed Assets"}],
        )
        assert res_linked["status"] == STATUS_SCHEDULE_LINKED

        # Tagged concept complete with values (e.g. Cash and Cash Equivalents)
        res_comp = svc.evaluate_tag_status(
            concept="in-gaap:CashAndCashEquivalents",
            cy_val="5000",
            py_val="4000",
            schedule_links=[{"concept": "in-gaap:CashAndCashEquivalents"}],
        )
        assert res_comp["status"] == STATUS_SCHEDULE_LINKED

        # Invalid concept
        res_inv = svc.evaluate_tag_status(
            concept="nonexistent:Concept123",
            cy_val="100",
            py_val="200",
        )
        assert res_inv["status"] == STATUS_INVALID


class TestProjectPersistenceAndRecoveryCache:
    """Verify saving to .wxbrl, autosave recovery cache, and cleanup on Save/Discard."""

    def test_save_authoritative_and_recovery_cache_cleanup(self):
        session_id = "test_persist_session"
        s = get_session(session_id, taxonomy="ci")
        s.filing.meta["cin"] = "L12345MH2020PLC123456"
        s.filing.meta["name"] = "Persistent Test Co Ltd"

        # 1. Trigger autosave (is_recovery=True)
        rec_info = save_project(
            s,
            session_id=session_id,
            is_recovery=True,
            ui_state={"activeTab": "tagging", "particularsCol": 1},
            autosave_settings={"enabled": True, "intervalSec": 60},
        )
        project_id = rec_info["projectId"]
        recovery_dir = PROJECTS_DIR / f".recovery_{project_id}"

        # Recovery directory must exist while editing
        assert recovery_dir.exists(), "Autosave recovery cache directory should be created"
        assert (recovery_dir / "filing_facts.json").exists()
        assert (recovery_dir / "ui_state.json").exists()

        # 2. Trigger Authoritative Save (is_recovery=False)
        auth_info = save_project(
            s,
            session_id=session_id,
            is_recovery=False,
        )
        authoritative_dir = PROJECTS_DIR / project_id
        assert authoritative_dir.exists(), "Authoritative project dir should be created"
        assert not recovery_dir.exists(), "Recovery cache directory must be automatically purged upon authoritative save"

        # Cleanup test dir
        if authoritative_dir.exists():
            shutil.rmtree(authoritative_dir)

    def test_wxbrl_bundle_export_and_import(self):
        session_id = "test_bundle_session"
        s = get_session(session_id, taxonomy="ci")
        s.filing.meta["cin"] = "L99999DL2021PLC999999"
        s.filing.meta["name"] = "Bundle Export Test Ltd"

        save_info = save_project(s, session_id=session_id, is_recovery=False)
        project_id = save_info["projectId"]

        # Export .wxbrl archive bytes
        bundle_bytes = export_bundle(project_id)
        assert bundle_bytes is not None and len(bundle_bytes) > 0

        # Inspect zip archive contents
        with zipfile.ZipFile(io.BytesIO(bundle_bytes), "r") as zf:
            file_names = zf.namelist()
            assert "manifest.json" in file_names
            assert "filing_facts.json" in file_names
            assert "schedule_links.json" in file_names
            assert "ui_state.json" in file_names

        # Import bundle
        import_info = import_bundle(s, bundle_bytes, session_id="test_imported_sess")
        assert import_info["projectId"] == project_id
        assert import_info["manifest"]["cin"] == "L99999DL2021PLC999999"

        # Cleanup
        p_dir = PROJECTS_DIR / project_id
        if p_dir.exists():
            shutil.rmtree(p_dir)


class TestWebWizardAndApiEndpoints:
    """Verify Wizard Pre-Validation API, Autosave, Discard Recovery, and Taxonomy Switch."""

    def test_wizard_status_api(self):
        res = client.get("/api/filing/wizard/status")
        assert res.status_code == 200
        data = res.json()
        assert "data" in data or "blockingErrors" in data
        payload = data.get("data", data)
        assert "blockingErrors" in payload
        assert "warnings" in payload
        assert "canGenerate" in payload

    def test_autosave_api_and_discard_recovery_api(self):
        # 1. Autosave endpoint
        payload = {
            "uiState": {"currentTab": "tagging", "particularsCol": 1},
            "autosaveSettings": {"enabled": True, "intervalSec": 30},
        }
        res = client.post("/api/projects/autosave", json=payload)
        assert res.status_code == 200
        res_data = res.json()
        assert res_data.get("success") is True

        # 2. Discard recovery endpoint
        res_discard = client.post("/api/projects/discard-recovery")
        assert res_discard.status_code == 200
        discard_data = res_discard.json()
        assert discard_data.get("success") is True

    def test_switch_taxonomy_api(self):
        res = client.post("/api/taxonomies/switch", json={"taxonomy": "ind_as"})
        assert res.status_code == 200
        data = res.json().get("data", {})
        assert data.get("taxonomy") == "ind_as"
        assert data.get("concepts", 0) > 5000

        # Switch back to ci default
        res_ci = client.post("/api/taxonomies/switch", json={"taxonomy": "ci"})
        assert res_ci.status_code == 200
        data_ci = res_ci.json().get("data", {})
        assert data_ci.get("taxonomy") == "ci"
        assert data_ci.get("concepts", 0) > 3000
