import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from src.constants import (
    CI_OUTPUT_JSON,
    INDAS_OUTPUT_JSON,
    COST_OUTPUT_JSON,
    CI_TAXONOMY_VDB,
    IND_AS_TAXONOMY_VDB,
    COSTING_TAXONOMY_VDB,
)

_KB_CACHE: Dict[str, Dict[str, Any]] = {}


def _load_kb(path: Path | str) -> Dict[str, Any]:
    path_str = str(path)
    if path_str not in _KB_CACHE:
        with open(path_str, "r", encoding="utf-8") as f:
            _KB_CACHE[path_str] = json.load(f)
    return _KB_CACHE[path_str]


SUPPORTED_TAXONOMIES: Dict[str, Path] = {
        CI_TAXONOMY_VDB: CI_OUTPUT_JSON,
        IND_AS_TAXONOMY_VDB: INDAS_OUTPUT_JSON,
        COSTING_TAXONOMY_VDB: COST_OUTPUT_JSON,
    }

class Authority:
    

    def __init__(self, taxonomy_id: str):
        if taxonomy_id not in self.SUPPORTED_TAXONOMIES:
            raise ValueError("taxonomy id not found")

        self.taxonomy_id = taxonomy_id
        json_path = self.SUPPORTED_TAXONOMIES[taxonomy_id]
        self.knowledge_base = _load_kb(json_path)

    def get_meta(self) -> Dict[str, Any]:
        return self.knowledge_base.get("meta", {})

    def get_namespaces(self) -> Dict[str, str]:
        return self.knowledge_base.get("namespaces", {})

    def get_roles(self) -> Dict[str, Any]:
        return self.knowledge_base.get("roles", {})

    def get_presentation(self) -> Dict[str, Any]:
        return self.knowledge_base.get("presentation", {})

    def get_calculation(self) -> Dict[str, Any]:
        return self.knowledge_base.get("calculation", {})

    def get_definition(self) -> Dict[str, Any]:
        return self.knowledge_base.get("definition", {})

    def get_concepts(self) -> Dict[str, Any]:
        return self.knowledge_base.get("concepts", {})

    def get_types(self) -> Dict[str, Any]:
        return self.knowledge_base.get("types", {})

    def get_business_rules(self) -> Dict[str, Any]:
        return self.knowledge_base.get("businessRules", {})

   
