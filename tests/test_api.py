"""Tests for the graph load/save endpoints."""

import json

import pytest
from fastapi.testclient import TestClient

from aag_studio import api


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "GRAPHS_DIR", tmp_path)
    return TestClient(api.app)


def test_get_labels_returns_the_label_set(client):
    response = client.get("/api/labels")
    assert response.status_code == 200
    assert "vertex_labels" in response.json()


def test_save_then_load_round_trips(client):
    graph = {
        "vertices": [
            {"id": "usr", "label": "user"},
            {"id": "iphone", "label": "iphone"},
        ],
        "edges": [
            {"id": "e1", "src": "usr", "tgt": "iphone", "label": "ha", "time": [[0, None]]}
        ],
    }
    put_response = client.put("/api/graphs/test_graph", json=graph)
    assert put_response.status_code == 200

    get_response = client.get("/api/graphs/test_graph")
    assert get_response.status_code == 200
    assert get_response.json()["vertices"] == graph["vertices"]


def test_invalid_graph_is_rejected_and_not_written(client, tmp_path):
    graph = {
        "vertices": [{"id": "a1", "label": "A"}, {"id": "a2", "label": "A"}],
        "edges": [{"id": "e1", "src": "a1", "tgt": "a2", "label": "ga", "time": [[0, None]]}],
    }
    response = client.put("/api/graphs/bad_graph", json=graph)
    assert response.status_code == 400
    assert not (tmp_path / "bad_graph.json").exists()


def test_missing_graph_is_404(client):
    assert client.get("/api/graphs/does_not_exist").status_code == 404


def test_list_graphs(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    assert client.get("/api/graphs").json() == ["one"]


def test_list_graphs_excludes_layout_sidecars(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "one.layout.json").write_text("{}")
    assert client.get("/api/graphs").json() == ["one"]


def test_delete_graph_removes_it_and_its_layout(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "one.layout.json").write_text("{}")
    response = client.delete("/api/graphs/one")
    assert response.status_code == 200
    assert not (tmp_path / "one.json").exists()
    assert not (tmp_path / "one.layout.json").exists()


def test_delete_missing_graph_is_404(client):
    assert client.delete("/api/graphs/does_not_exist").status_code == 404


def test_missing_layout_returns_empty(client):
    assert client.get("/api/graphs/no_such_graph/layout").json() == {}


def test_save_then_load_layout_round_trips(client):
    positions = {"usr": [12.5, -3], "iphone": [100, 200]}
    put_response = client.put("/api/graphs/test_graph/layout", json=positions)
    assert put_response.status_code == 200
    assert client.get("/api/graphs/test_graph/layout").json() == positions
