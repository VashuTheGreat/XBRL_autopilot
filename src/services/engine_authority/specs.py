"""What the engine authority builder needs to know about each MCA taxonomy.

Everything else (concepts, ELRs, networks, tables) is read from the official taxonomy files in ``data/``.
The values here are filing conventions that the taxonomy files don't contain: the schemaRef the MCA XBRL
Validator accepts, the CIN identifier scheme, and checked patches that reproduce the taxonomy copy the
validator itself uses.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from src.constants import (
    CI_ENGINE_AUTHORITY_JSON,
    CI_TAXONOMY_DIR,
    CI_TAXONOMY_VDB,
    INDAS_ENGINE_AUTHORITY_JSON,
    INDAS_TAXONOMY_DIR,
    IND_AS_TAXONOMY_VDB,
)

CIN_SCHEME = "http://www.mca.gov.in/CIN"
CIN_SCHEME_SOURCE = "Filing Manual CNI v4.0 §1.3.1(2)"
_V3_SOURCE = (
    'MCA XBRL Validator V3 ("Please use new schema URL: https://www.mca.gov.in/V3XBRL/ instead of V2 Schema URL: '
    'http://www.mca.gov.in/XBRL/ in all taxonomies (C&I), (IND-AS), and (Costing)")'
)


@dataclass(frozen=True)
class ValidatorPatch:
    """A text replacement applied to one taxonomy file. ``find`` must occur exactly once."""

    file: str  # relative to the taxonomy root, '/'-separated
    reason: str
    find: str
    replace: str


@dataclass(frozen=True)
class TaxonomySpec:
    id: str  # knowledge-base id (ci_taxonomy | ind_as_taxonomy)
    name: str
    taxonomy_version: str
    root: Path  # folder holding the entry point
    entry_point: str  # the one named by the instance's schemaRef
    schema_ref: str
    schema_ref_source: str
    retired_schema_refs: tuple[str, ...]
    output: Path
    source_label: str  # how source files are named in meta.sources (repo-relative root)
    patches: tuple[ValidatorPatch, ...] = field(default_factory=tuple)
    # further entry points of the same package whose DTS belongs to the filing (loaded as one DTS with entry_point)
    companion_entry_points: tuple[str, ...] = ()

    @property
    def entry_files(self) -> list[Path]:
        return [self.root / e for e in (self.entry_point, *self.companion_entry_points)]


CI_2016 = TaxonomySpec(
    id=CI_TAXONOMY_VDB,
    name="MCA C&I Taxonomy 2016 authority model",
    taxonomy_version="Indian C&I General Purpose Taxonomy 2016-03-31 Ver 1.0",
    root=CI_TAXONOMY_DIR,
    entry_point="in-ci-ent-2016-03-31.xsd",
    schema_ref="https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd",
    schema_ref_source=_V3_SOURCE + "; replaces the V2 address of Filing Manual CNI v4.0 §1.3.1(1)",
    retired_schema_refs=("http://www.mca.gov.in/XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd",),
    output=CI_ENGINE_AUTHORITY_JSON,
    source_label="data/c&I taxonomy/Final C and I Taxonomy 2016 V1.2@31-03-2016/Taxonomy-2016-03-31",
    patches=(
        # The taxonomy the MCA XBRL Validator downloads accepts the V3 SRN format (two letters + seven digits).
        ValidatorPatch(
            file="IN-CA/in-ca-types-2016-03-31.xsd",
            reason="MCA V3 SRN format (two letters + seven digits) accepted by the MCA XBRL Validator taxonomy",
            find='<xsd:pattern value="[A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]"/>',
            replace='<xsd:pattern value="[A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]"/>\n'
            '        <xsd:pattern value="[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9][0-9]"/>',
        ),
    ),
)

IND_AS_2017 = TaxonomySpec(
    id=IND_AS_TAXONOMY_VDB,
    name="MCA Ind AS Taxonomy 2017 authority model",
    taxonomy_version="Indian Ind AS Taxonomy 2017-03-31 Ver 1.2",
    root=INDAS_TAXONOMY_DIR,
    entry_point="in-ci-ent-2017-03-31.xsd",
    # Evidence: the MCA-accepted Dixon instance (data/Instance_Dixon_Global_Private_2025-26_001.xml).
    schema_ref="https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd",
    schema_ref_source=_V3_SOURCE + "; as used by the MCA-accepted Dixon Ind AS instance (FY 2025-26)",
    retired_schema_refs=("http://www.mca.gov.in/XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd",),
    output=INDAS_ENGINE_AUTHORITY_JSON,
    # The Ind AS package splits AOC-4 over two entry points: in-ci-ent (Ind AS statements and notes) and in-ca-ent
    # (in-ca 700xxx: general information about the company, auditors' report, directors' report, signatories,
    # KMP, secretarial audit). An MCA-accepted Ind AS instance names in-ci-ent and reports facts from both
    # (Dixon FY 2025-26), so the filing's DTS is their union.
    companion_entry_points=("in-ca-ent-2017-03-31.xsd",),
    source_label="data/IND-AS taxonomy/Taxonomy for IND-AS V1.2@31-03-2017/Ind AS taxonomy/Ind AS taxonomy",
)

SPECS: dict[str, TaxonomySpec] = {s.id: s for s in (CI_2016, IND_AS_2017)}
