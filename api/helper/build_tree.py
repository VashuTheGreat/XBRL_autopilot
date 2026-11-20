from src.core.logger import logger


def build_role_tree(role_id: str, roles: dict, presentation: dict, concepts: dict):
    with logger.span("build_tree.build_role_tree", role_id=role_id):
        # Step 1: Find role using role ID
        role = next(
            (
                value for value in roles.values()
                if value.get("id") == role_id
            ),
            None
        )

        if not role:
            logger.error("build_tree.role_not_found", role_id=role_id)
            raise ValueError(f"Role not found: {role_id}")

        # Step 2: Get role URI
        role_uri = next(
            (
                uri for uri, value in roles.items()
                if value.get("id") == role_id
            ),
            None
        )

        # Step 3: Get presentation relationships
        arcs = presentation.get(role_uri, [])

        if not arcs:
            logger.info("build_tree.no_arcs_found", role_id=role_id, role_uri=role_uri)
            return {
                "role": role,
                "tree": []
            }

        # Step 4: Build parent-child mapping
        children = {}

        all_nodes = set()
        child_nodes = set()

        for arc in arcs:
            parent = arc["from"]
            child = arc["to"]

            children.setdefault(parent, []).append({
                "qname": child,
                "order": arc.get("order", 0)
            })

            all_nodes.update([parent, child])
            child_nodes.add(child)

        # Step 5: Recursive tree builder
        def build_node(qname, visited=None):
            visited = visited or set()

            if qname in visited:
                logger.error("build_tree.cycle_detected", qname=qname, role_id=role_id)
                raise ValueError(f"Cycle detected: {qname}")

            concept = concepts.get(qname, {})

            label = (
                concept.get("labels", {}).get("label")
                or concept.get("name")
                or qname
            )

            ordered_children = sorted(
                children.get(qname, []),
                key=lambda x: x["order"]
            )

            return {
                "qname": qname,
                "label": label,
                "abstract": concept.get("abstract", False),
                "type": concept.get("type"),
                "children": [
                    build_node(
                        item["qname"],
                        visited | {qname}
                    )
                    for item in ordered_children
                ]
            }

        # Step 6: Find root nodes
        roots = all_nodes - child_nodes

        tree = [
            build_node(root)
            for root in sorted(roots)
        ]

        logger.info("build_tree.completed", role_id=role_id, roots_count=len(tree), total_nodes=len(all_nodes))
        return {
            "role": role,
            "tree": tree
        }
