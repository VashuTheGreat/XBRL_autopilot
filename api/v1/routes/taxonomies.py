from fastapi import APIRouter, Query
from fastapi.responses import Response
from src.core.logger import logger
from typing import Annotated, Any, Dict, List, Optional
from api.v1.schemas.taxonomies import RecommendTaxonomies as RecommendTaxonomiesSchema
from src.pipeline.recom_taxonomies import RecommendTaxonomies
from src.core.authority import Authority
from src.constants import CI_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB, COSTING_TAXONOMY_VDB
from api.responses import success_response, error_response
from api.helper.build_tree import build_role_tree
from src.services.engine_authority.store import AuthorityNotAvailable, default_store as engine_authorities
router = APIRouter()

_authority_cache: dict[str, Authority] = {}


def get_authority(taxonomy_id: str) -> Authority:
    if taxonomy_id not in _authority_cache:
        _authority_cache[taxonomy_id] = Authority(taxonomy_id)
    return _authority_cache[taxonomy_id]


@router.get("")
async def get_taxonomies_list():
    data = {
        "taxonomies": [
            {
                "id": CI_TAXONOMY_VDB,
                "name": "Companies and Industry",
                "version": "2016-03-31",
                "available": True,
            },
            {
                "id": IND_AS_TAXONOMY_VDB,
                "name": "Indian Accounting Standards",
                "available": True,
            },
            {
                "id": COSTING_TAXONOMY_VDB,
                "name": "Costing",
                "available": True,
            },
        ]
    }

    with logger.span("taxonomies.get"):
        return success_response(
            data=data,
            message="List of available Taxonomies done",
            status_code=200,
        )


@router.get("/recommend")
async def recommend_taxonomies(payload: Annotated[RecommendTaxonomiesSchema, Query()]):
    with logger.span("taxonomies.recommend", keys_count=len(payload.keys)):
        try:
            target_coll = payload.collection
            raw_docs = await RecommendTaxonomies(keys=payload.keys, collection=target_coll)
            return success_response(
                data=raw_docs,
                message="Taxonomies recommended successfully",
            )
        except Exception:
            logger.exception("taxonomies.recommend_failed")
            return success_response(data=[], message="Taxonomies recommendation unavailable")


@router.get("/{id}/concepts")
async def get_taxonomy_concepts(
    id: str,
    search: Optional[str] = Query(None, description="Search filter for concept QName, name, or label"),
    limit: Optional[int] = Query(None, ge=1, description="Limit number of concepts returned"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    qname_only: bool = Query(False, description="Return only list of QNames"),
):
    """Concepts ki list - List all concepts for a given taxonomy."""
    with logger.span("taxonomies.concepts.list", taxonomy_id=id):
        try:
            authority = get_authority(id)
            concepts_dict = authority.get_concepts()

            if qname_only:
                concepts: list = list(concepts_dict.keys())
                if search:
                    search_lower = search.strip().lower()
                    concepts = [q for q in concepts if search_lower in q.lower()]
            else:
                concepts = list(concepts_dict.values())
                if search:
                    search_lower = search.strip().lower()
                    filtered = []
                    for c in concepts:
                        qn = c.get("qname", "")
                        nm = c.get("name", "")
                        labels = c.get("labels", {})
                        label_vals = " ".join(str(v) for v in labels.values()) if isinstance(labels, dict) else ""
                        if (
                            search_lower in qn.lower()
                            or search_lower in nm.lower()
                            or search_lower in label_vals.lower()
                        ):
                            filtered.append(c)
                    concepts = filtered

            total = len(concepts)
            if limit is not None:
                concepts = concepts[offset : offset + limit]
            elif offset > 0:
                concepts = concepts[offset:]

            logger.info(
                "taxonomies.concepts.list.success",
                taxonomy_id=id,
                total=total,
                returned=len(concepts),
            )
            return success_response(
                data=concepts,
                message=f"List of concepts for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.concepts.list.not_found", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.concepts.list.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve concepts for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/concepts/search")
async def search_taxonomy_concepts(
    id: str,
    q: str = Query(..., min_length=1, description="Query string to search in concept QName, name, or labels"),
    limit: Optional[int] = Query(None, ge=1, description="Limit number of concepts returned"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    summary: bool = Query(False, description="Ranked compact results {total, items} (label, type, periodType, balance, elrCodes)"),
    reportable_only: bool = Query(True, description="With summary=true: only elements a value can be reported for"),
):
    """Label/QName se concept search - Search concepts in taxonomy by query string."""
    with logger.span("taxonomies.concepts.search", taxonomy_id=id, query=q):
        try:
            authority = get_authority(id)
            if summary:
                result = authority.search_concepts(q, limit=limit or 50, offset=offset, reportable_only=reportable_only)
                return success_response(data=result, message=f"Ranked search results for '{q}' in taxonomy '{id}'", status_code=200)
            concepts_dict = authority.get_concepts()

            q_clean = q.strip().lower()
            matched = []

            for c in concepts_dict.values():
                qn = c.get("qname", "")
                nm = c.get("name", "")
                labels = c.get("labels", {})
                label_vals = " ".join(str(v) for v in labels.values()) if isinstance(labels, dict) else ""

                if (
                    q_clean in qn.lower()
                    or q_clean in nm.lower()
                    or q_clean in label_vals.lower()
                ):
                    matched.append(c)

            total = len(matched)
            if limit is not None:
                results = matched[offset : offset + limit]
            elif offset > 0:
                results = matched[offset:]
            else:
                results = matched

            logger.info(
                "taxonomies.concepts.search.success",
                taxonomy_id=id,
                query=q,
                total=total,
                returned=len(results),
            )
            return success_response(
                data=results,
                message=f"Search results for '{q}' in taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.concepts.search.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.concepts.search.failed", taxonomy_id=id, query=q)
            return error_response(
                message=f"Failed to search concepts in taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/concepts/{qname}")
async def get_taxonomy_concept_detail(
    id: str,
    qname: str,
    include_rules: bool = Query(False, description="Also return the MCA business rules for this element"),
):
    """Specific concept ki complete details - Complete details for a concept."""
    with logger.span("taxonomies.concepts.detail", taxonomy_id=id, qname=qname):
        try:
            authority = get_authority(id)
            concept = authority.get_concept(qname)

            if not concept:
                logger.warning(
                    "taxonomies.concepts.detail.not_found",
                    taxonomy_id=id,
                    qname=qname,
                )
                return error_response(
                    message=f"Concept '{qname}' not found in taxonomy '{id}'",
                    status_code=404,
                )

            if include_rules:
                concept = {**concept, "summary": authority.concept_summary(qname), "businessRules": authority.rules_for_concept(qname)}

            logger.info(
                "taxonomies.concepts.detail.success",
                taxonomy_id=id,
                qname=concept.get("qname", qname),
            )
            return success_response(
                data=concept,
                message=f"Concept '{concept.get('qname', qname)}' details retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.concepts.detail.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.concepts.detail.failed", taxonomy_id=id, qname=qname)
            return error_response(
                message=f"Failed to retrieve concept '{qname}' for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/types")
async def get_taxonomy_types(id: str):
    """Available data types - Available data types for a given taxonomy."""
    with logger.span("taxonomies.types.get", taxonomy_id=id):
        try:
            authority = get_authority(id)
            types_dict = authority.get_types()

            logger.info(
                "taxonomies.types.get.success",
                taxonomy_id=id,
                count=len(types_dict),
            )
            return success_response(
                data=types_dict,
                message=f"Available data types for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.types.get.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.types.get.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve types for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/relationships/presentation")
async def get_taxonomy_presentation_relationships(
    id: str,
    role_uri: Optional[str] = Query(None, description="Filter presentation relationships by role URI"),
    concept: Optional[str] = Query(None, description="Filter relationships involving a specific concept QName"),
):
    """Presentation relationships - Extended link role presentation arcs."""
    with logger.span("taxonomies.relationships.presentation", taxonomy_id=id):
        try:
            authority = get_authority(id)
            presentation_dict = authority.get_presentation()

            if role_uri:
                data = {role_uri: presentation_dict.get(role_uri, [])}
            elif concept:
                c_clean = concept.strip().lower()
                filtered = {}
                for r_uri, arcs in presentation_dict.items():
                    matched_arcs = [
                        arc
                        for arc in arcs
                        if str(arc.get("from", "")).lower() == c_clean
                        or str(arc.get("to", "")).lower() == c_clean
                    ]
                    if matched_arcs:
                        filtered[r_uri] = matched_arcs
                data = filtered
            else:
                data = presentation_dict

            logger.info(
                "taxonomies.relationships.presentation.success",
                taxonomy_id=id,
                roles_count=len(data),
            )
            return success_response(
                data=data,
                message=f"Presentation relationships for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.relationships.presentation.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.relationships.presentation.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve presentation relationships for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/relationships/calculation")
async def get_taxonomy_calculation_relationships(
    id: str,
    role_uri: Optional[str] = Query(None, description="Filter calculation relationships by role URI"),
    concept: Optional[str] = Query(None, description="Filter relationships involving a specific concept QName"),
):
    """Calculation relationships - Extended link role calculation arcs and summation weights."""
    with logger.span("taxonomies.relationships.calculation", taxonomy_id=id):
        try:
            authority = get_authority(id)
            calculation_dict = authority.get_calculation()

            if role_uri:
                data = {role_uri: calculation_dict.get(role_uri, [])}
            elif concept:
                c_clean = concept.strip().lower()
                filtered = {}
                for r_uri, arcs in calculation_dict.items():
                    matched_arcs = [
                        arc
                        for arc in arcs
                        if str(arc.get("from", "")).lower() == c_clean
                        or str(arc.get("to", "")).lower() == c_clean
                    ]
                    if matched_arcs:
                        filtered[r_uri] = matched_arcs
                data = filtered
            else:
                data = calculation_dict

            logger.info(
                "taxonomies.relationships.calculation.success",
                taxonomy_id=id,
                roles_count=len(data),
            )
            return success_response(
                data=data,
                message=f"Calculation relationships for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.relationships.calculation.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.relationships.calculation.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve calculation relationships for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/relationships/definition")
async def get_taxonomy_definition_relationships(
    id: str,
    role_uri: Optional[str] = Query(None, description="Filter definition relationships by role URI"),
    concept: Optional[str] = Query(None, description="Filter relationships involving a specific concept QName"),
):
    """Definition relationships - Dimensional definition arcs and hypercube structures."""
    with logger.span("taxonomies.relationships.definition", taxonomy_id=id):
        try:
            authority = get_authority(id)
            definition_dict = authority.get_definition()

            if role_uri:
                data = {role_uri: definition_dict.get(role_uri, [])}
            elif concept:
                c_clean = concept.strip().lower()
                filtered = {}
                for r_uri, arcs in definition_dict.items():
                    matched_arcs = [
                        arc
                        for arc in arcs
                        if str(arc.get("from", "")).lower() == c_clean
                        or str(arc.get("to", "")).lower() == c_clean
                    ]
                    if matched_arcs:
                        filtered[r_uri] = matched_arcs
                data = filtered
            else:
                data = definition_dict

            logger.info(
                "taxonomies.relationships.definition.success",
                taxonomy_id=id,
                roles_count=len(data),
            )
            return success_response(
                data=data,
                message=f"Definition relationships for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.relationships.definition.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.relationships.definition.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve definition relationships for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/business-rules")
async def get_taxonomy_business_rules(
    id: str,
    category: Optional[str] = Query(
        None,
        description="Filter by rule category: mandatoryConcepts, mandatoryConsolidated, conditionalMandatory, mandatoryLineItems, genericRules, rules, tableRules",
    ),
    concept: Optional[str] = Query(
        None,
        description="Filter rules for a specific concept QName or element name",
    ),
):
    """Business rules - Business rules for a given taxonomy."""
    with logger.span("taxonomies.business_rules.get", taxonomy_id=id):
        try:
            authority = get_authority(id)
            br_dict = authority.get_business_rules()

            if category:
                cat_clean = category.strip()
                if cat_clean in br_dict:
                    result_data = {cat_clean: br_dict[cat_clean]}
                else:
                    return error_response(
                        message=f"Category '{category}' not found in business rules. Available categories: {list(br_dict.keys())}",
                        status_code=404,
                    )
            elif concept:
                c_clean = concept.strip().lower()
                all_rules = br_dict.get("rules", [])
                matching_rules = [
                    r
                    for r in all_rules
                    if str(r.get("concept", "")).lower() == c_clean
                    or str(r.get("element", "")).lower() == c_clean
                ]
                result_data = {
                    "concept": concept,
                    "matchedRules": matching_rules,
                    "isMandatory": concept in br_dict.get("mandatoryConcepts", []),
                    "isMandatoryConsolidated": concept in br_dict.get("mandatoryConsolidated", []),
                    "isConditionalMandatory": concept in br_dict.get("conditionalMandatory", []),
                }
            else:
                result_data = br_dict

            logger.info(
                "taxonomies.business_rules.get.success",
                taxonomy_id=id,
                has_rules=bool(result_data),
            )
            return success_response(
                data=result_data,
                message=f"Business rules for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.business_rules.get.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.business_rules.get.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve business rules for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/business-rules/{rule_id}")
async def get_taxonomy_business_rule_detail(id: str, rule_id: str):
    """Specific rule details for a given taxonomy."""
    with logger.span("taxonomies.business_rules.detail", taxonomy_id=id, rule_id=rule_id):
        try:
            authority = get_authority(id)
            rule = authority.get_business_rule(rule_id)

            if not rule:
                logger.warning(
                    "taxonomies.business_rules.detail.not_found",
                    taxonomy_id=id,
                    rule_id=rule_id,
                )
                return error_response(
                    message=f"Business rule '{rule_id}' not found in taxonomy '{id}'",
                    status_code=404,
                )

            logger.info(
                "taxonomies.business_rules.detail.success",
                taxonomy_id=id,
                rule_id=rule_id,
            )
            return success_response(
                data=rule,
                message=f"Business rule '{rule_id}' details retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.business_rules.detail.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.business_rules.detail.failed", taxonomy_id=id, rule_id=rule_id)
            return error_response(
                message=f"Failed to retrieve business rule '{rule_id}' for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/roles")
async def get_taxonomy_roles(id: str):
    """List of all roles for a given taxonomy."""
    with logger.span("taxonomies.roles.list", taxonomy_id=id):
        try:
            authority = get_authority(id)
            roles = authority.get_roles()
            logger.info(
                "taxonomies.roles.list.success",
                taxonomy_id=id,
                count=len(roles),
            )
            return success_response(
                data=roles,
                message=f"Roles for taxonomy '{id}' retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.roles.list.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.roles.list.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve roles for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/roles/{role_id}")
async def get_taxonomy_role_detail(id: str, role_id: str):
    """Specific role ki details - Return role dictionary where role['id'] == role_id."""
    with logger.span("taxonomies.roles.detail", taxonomy_id=id, role_id=role_id):
        try:
            authority = get_authority(id)
            found_role = authority.get_role(role_id)

            if not found_role:
                logger.warning(
                    "taxonomies.roles.detail.not_found",
                    taxonomy_id=id,
                    role_id=role_id,
                )
                return error_response(
                    message=f"Role with id '{role_id}' not found in taxonomy '{id}'",
                    status_code=404,
                )

            logger.info(
                "taxonomies.roles.detail.success",
                taxonomy_id=id,
                role_id=role_id,
            )
            return success_response(
                data=found_role,
                message=f"Role '{role_id}' details retrieved successfully",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.roles.detail.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.roles.detail.failed", taxonomy_id=id, role_id=role_id)
            return error_response(
                message=f"Failed to retrieve role '{role_id}' for taxonomy '{id}'",
                status_code=500,
            )


@router.get("/{id}/rules")
async def get_taxonomical_rules(id: str):
    """Return the rules of the particular taxonomy."""
    with logger.span("taxonomies.rules.get", taxonomy_id=id):
        try:
            authority = get_authority(id)
            data = authority.get_business_rules()
            return success_response(
                data=data,
                message="Taxonomies rules succeed",
                status_code=200,
            )
        except ValueError as ve:
            logger.warning("taxonomies.rules.invalid_taxonomy", error=str(ve))
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.rules.failed", taxonomy_id=id)
            return error_response(
                message=f"Failed to retrieve rules for taxonomy '{id}'",
                status_code=500,
            )



@router.get("/{taxonomy_id}/roles/{role_id}/tree")
def get_role_tree(taxonomy_id: str, role_id: str):
    """Returns the xml tree for mapping and view purpose"""

    kb = get_authority(taxonomy_id)
    with logger.span("taxonomies.roles.tree",taxonomy_id=taxonomy_id,role_id=role_id):
        try:
            
            return build_role_tree(
                role_id=role_id,
                roles=kb.get_roles(),
                presentation=kb.get_presentation(),
                concepts=kb.get_concepts()
            )

        except ValueError as ve:
            logger.warning("taxonomies.rules.invalid_tree",error=str(ve))
            return error_response(
                message=str(ve),
                status_code=404
            )

        except Exception:
            logger.exception("taxonomies.rules.tree.failed")
            return error_response(
                message=f"Failed to retrieve tree for taxonomy '{taxonomy_id}' and '{role_id}'",
                status_code=500,
            )


@router.get("/{id}/authority")
async def get_engine_authority(id: str):
    """The engine authority of a taxonomy (ADR-0010): concepts, ELRs, presentation/calculation/definition networks,
    tables, hypercubes, dimension defaults and the filing conventions (schemaRef, CIN scheme).

    Built by src.ingestion.build_engine_authorities from the official MCA taxonomy. Several MB, so the file is
    wrapped in the usual {data, success, message} envelope as bytes, without being parsed.
    """
    with logger.span("taxonomies.authority", taxonomy_id=id):
        try:
            raw = engine_authorities.raw(id)
        except AuthorityNotAvailable as e:
            return error_response(message=str(e), status_code=404)
        body = b'{"data":' + raw + b',"message":"Engine authority","success":true,"errors":null}'
        return Response(content=body, media_type="application/json")


@router.get("/{id}/elrs")
async def get_taxonomy_elrs(id: str):
    """Statements, notes and disclosures (presentation ELRs) with code, title and group."""
    with logger.span("taxonomies.elrs.list", taxonomy_id=id):
        try:
            elrs = get_authority(id).list_elrs()
            return success_response(data=elrs, message=f"{len(elrs)} ELRs in taxonomy '{id}'", status_code=200)
        except ValueError as ve:
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.elrs.list.failed", taxonomy_id=id)
            return error_response(message=f"Failed to list ELRs for taxonomy '{id}'", status_code=500)


@router.get("/{id}/elrs/{key}/tree")
async def get_taxonomy_elr_tree(id: str, key: str):
    """Presentation tree of one ELR; key = code ('100100'), role id or role URI."""
    with logger.span("taxonomies.elrs.tree", taxonomy_id=id, key=key):
        try:
            tree = get_authority(id).elr_tree(key)
            if tree is None:
                return error_response(message=f"ELR '{key}' not found in taxonomy '{id}'", status_code=404)
            return success_response(data=tree, message=f"Presentation tree of '{key}'", status_code=200)
        except ValueError as ve:
            return error_response(message=str(ve), status_code=404)
        except Exception:
            logger.exception("taxonomies.elrs.tree.failed", taxonomy_id=id, key=key)
            return error_response(message=f"Failed to build the tree of '{key}'", status_code=500)
