import pytest
from src.core.authority import get_authority
from src.services.footnotes import (
    list_footnotes,
    footnotes_of,
    add_footnote,
    update_footnote_text,
    link_footnote,
    unlink_footnote,
    remove_footnote,
)
from src.engine.generator import generate_instance
from src.services.session import Session
from tests.fixtures import base_session


@pytest.fixture(scope="session")
def A():
    return get_authority()


def test_footnotes_crud_and_links(A):
    q = A.qname_of_local
    s = base_session(A)
    s.set_value(q("OtherIncome"), "CY", "100")
    k = s.get_value(q("OtherIncome"), "CY").key

    # Add footnotes
    a = add_footnote(s.filing, "First note", [k])
    b = add_footnote(s.filing, "Second note", [k])

    assert set(footnotes_of(s.filing, k)) == {a, b}

    # Delete first footnote
    remove_footnote(s.filing, a)
    c = add_footnote(s.filing, "Third note", [k])
    assert c != b
    assert len(list_footnotes(s.filing)) == 2

    # Update text
    update_footnote_text(s.filing, b, "Second note, edited")
    assert s.filing.footnotes[b].text == "Second note, edited"

    # Unlink and link
    unlink_footnote(s.filing, c, k)
    assert footnotes_of(s.filing, k) == [b]

    link_footnote(s.filing, c, k)
    assert set(footnotes_of(s.filing, k)) == {b, c}

    # Validation errors
    with pytest.raises(ValueError, match="empty"):
        add_footnote(s.filing, "  ", [k])

    with pytest.raises(ValueError, match="has a value"):
        add_footnote(s.filing, "x", ["no#such#cell"])


def test_footnotes_exported_in_xml(A):
    q = A.qname_of_local
    s = base_session(A)
    s.set_value(q("OtherIncome"), "CY", "100")
    k = s.get_value(q("OtherIncome"), "CY").key

    add_footnote(s.filing, "Includes interest & dividends <net>", [k])
    add_footnote(s.filing, "Orphan note — no cell", [])

    gen_res = generate_instance(A, s.filing)
    xml = gen_res["xml"]

    assert 'xml:lang="en">Includes interest &amp; dividends &lt;net&gt;</link:footnote>' in xml
    assert 'xlink:arcrole="http://www.xbrl.org/2003/arcrole/fact-footnote"' in xml
    assert "Orphan note" not in xml
