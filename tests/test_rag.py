"""Tests for validate_rag: one valid graph, one case per rejection rule."""

from pathlib import Path

import pytest

from aag_studio.rag import Edge, Graph, LabelSet, Vertex, validate_rag

LABELS_PATH = Path(__file__).parent.parent / "labels.yaml"


@pytest.fixture
def label_set() -> LabelSet:
    return LabelSet.load(LABELS_PATH)


def make_graph(vertices: list[dict], edges: list[dict]) -> Graph:
    return Graph(
        vertices=[Vertex(**v) for v in vertices],
        edges=[Edge(**e) for e in edges],
    )


def test_valid_graph_has_no_violations(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "iphone", "label": "device"},
            {"id": "apple_pw", "label": "password"},
            {"id": "a1", "label": "A"},
        ],
        edges=[
            {
                "id": "e1",
                "src": "usr",
                "tgt": "iphone",
                "label": "ha",
                "time": [[0, None]],
            },
            {
                "id": "e2",
                "src": "apple_pw",
                "tgt": "a1",
                "label": "ga",
                "time": [[0, None]],
            },
            {
                "id": "e3",
                "src": "a1",
                "tgt": "iphone",
                "label": "ga",
                "time": [[0, None]],
            },
        ],
    )
    assert validate_rag(graph, label_set) == []


def test_duplicate_vertex_id_is_rejected(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "usr", "label": "device"},
        ],
        edges=[],
    )
    assert any("duplicate vertex id" in v for v in validate_rag(graph, label_set))


def test_unknown_vertex_label_is_rejected(label_set):
    graph = make_graph(
        vertices=[{"id": "usr", "label": "not_a_real_label"}],
        edges=[],
    )
    assert any("unknown label" in v for v in validate_rag(graph, label_set))


def test_edge_to_unknown_vertex_is_rejected(label_set):
    graph = make_graph(
        vertices=[{"id": "usr", "label": "user"}],
        edges=[
            {
                "id": "e1",
                "src": "usr",
                "tgt": "ghost",
                "label": "ha",
                "time": [[0, None]],
            }
        ],
    )
    assert any("unknown target vertex" in v for v in validate_rag(graph, label_set))


def test_unknown_edge_label_is_rejected(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "iphone", "label": "device"},
        ],
        edges=[
            {
                "id": "e1",
                "src": "usr",
                "tgt": "iphone",
                "label": "not_a_real_label",
                "time": [[0, None]],
            }
        ],
    )
    assert any("unknown label" in v for v in validate_rag(graph, label_set))


def test_agent_to_A_is_rejected(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "a1", "label": "A"},
        ],
        edges=[
            {"id": "e1", "src": "usr", "tgt": "a1", "label": "ga", "time": [[0, None]]}
        ],
    )
    assert any("matches no allowed rule" in v for v in validate_rag(graph, label_set))


def test_A_to_A_is_rejected(label_set):
    graph = make_graph(
        vertices=[
            {"id": "a1", "label": "A"},
            {"id": "a2", "label": "A"},
        ],
        edges=[
            {"id": "e1", "src": "a1", "tgt": "a2", "label": "ga", "time": [[0, None]]}
        ],
    )
    assert any("matches no allowed rule" in v for v in validate_rag(graph, label_set))


def test_edge_label_mismatched_with_signature_is_rejected(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "iphone", "label": "device"},
        ],
        edges=[
            {
                "id": "e1",
                "src": "usr",
                "tgt": "iphone",
                "label": "ga",
                "time": [[0, None]],
            }
        ],
    )
    assert any("should be labelled" in v for v in validate_rag(graph, label_set))


def test_specific_label_matches_general_rule(label_set):
    graph = make_graph(
        vertices=[
            {"id": "usr", "label": "user"},
            {"id": "apple_pw", "label": "password"},
        ],
        edges=[
            {
                "id": "e1",
                "src": "usr",
                "tgt": "apple_pw",
                "label": "ha",
                "time": [[0, None]],
            }
        ],
    )
    assert validate_rag(graph, label_set) == []
