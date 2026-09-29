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


def test_list_graphs(client):
    client.put("/api/graphs/one", json={"vertices": [], "edges": []})
    graphs = client.get("/api/graphs").json()
    assert [g["name"] for g in graphs] == ["one"]
    assert "created" in graphs[0] and "modified" in graphs[0]


def test_list_graphs_excludes_layout_sidecars(client):
    client.put("/api/graphs/one", json={"vertices": [], "edges": []})
    graphs = client.get("/api/graphs").json()
    assert [g["name"] for g in graphs] == ["one"]


def test_created_timestamp_does_not_change_on_later_saves(client):
    client.put("/api/graphs/one", json={"vertices": [], "edges": []})
    first_created = client.get("/api/graphs").json()[0]["created"]

    client.put("/api/graphs/one", json={"vertices": [{"id": "a", "label": "resource"}], "edges": []})
    second_created = client.get("/api/graphs").json()[0]["created"]

    assert first_created == second_created


def test_rename_graph_moves_file_and_layout(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "one.layout.json").write_text('{"positions": {}}')
    response = client.post("/api/graphs/one/rename", json={"new_name": "two"})
    assert response.status_code == 200
    assert not (tmp_path / "one.json").exists()
    assert (tmp_path / "two.json").exists()
    assert (tmp_path / "two.layout.json").exists()


def test_rename_to_existing_name_is_rejected(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "two.json").write_text(json.dumps({"vertices": [], "edges": []}))
    response = client.post("/api/graphs/one/rename", json={"new_name": "two"})
    assert response.status_code == 400
    assert (tmp_path / "one.json").exists()


def test_delete_graph_removes_it_and_its_layout(client, tmp_path):
    (tmp_path / "one.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "one.layout.json").write_text("{}")
    response = client.delete("/api/graphs/one")
    assert response.status_code == 200
    assert not (tmp_path / "one.json").exists()
    assert not (tmp_path / "one.layout.json").exists()


def test_delete_missing_graph_is_404(client):
    assert client.delete("/api/graphs/does_not_exist").status_code == 404


def test_frontend_graph_route_serves_index_html(client):
    response = client.get("/graphs/anything")
    assert response.status_code == 200
    assert b"<title>" in response.content


def test_missing_layout_returns_empty(client):
    assert client.get("/api/graphs/no_such_graph/layout").json() == {}


def test_save_then_load_layout_round_trips(client):
    positions = {"usr": [12.5, -3], "iphone": [100, 200]}
    put_response = client.put("/api/graphs/test_graph/layout", json=positions)
    assert put_response.status_code == 200
    assert client.get("/api/graphs/test_graph/layout").json() == positions


def test_layout_save_does_not_clobber_created_timestamp(client):
    client.put("/api/graphs/one", json={"vertices": [], "edges": []})
    created = client.get("/api/graphs").json()[0]["created"]

    client.put("/api/graphs/one/layout", json={"positions": {"a": [1, 2]}})

    graphs = client.get("/api/graphs").json()
    assert graphs[0]["created"] == created


def test_broken_graph_file_returns_400(client, tmp_path):
    (tmp_path / "broken.json").write_text("{ not valid json }")
    response = client.get("/api/graphs/broken")
    assert response.status_code == 400
    assert "Broken graph file" in response.json()["detail"]


def test_broken_layout_file_returns_400(client, tmp_path):
    (tmp_path / "broken.json").write_text(json.dumps({"vertices": [], "edges": []}))
    (tmp_path / "broken.layout.json").write_text("{ not valid json }")
    response = client.get("/api/graphs/broken/layout")
    assert response.status_code == 400
    assert "Broken layout file" in response.json()["detail"]
