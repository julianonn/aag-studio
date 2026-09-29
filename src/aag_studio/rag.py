"""Label set loading, RAG models, and well-formedness validation."""

from pathlib import Path

import yaml
from pydantic import BaseModel

Interval = tuple[int | str, int | str | None]


class LabelSet:
    def __init__(
        self,
        vertex_parents: dict[str, list[str]],
        edge_labels: list[str],
        edge_rules: list[dict[str, str]],
    ) -> None:
        self.vertex_parents = vertex_parents
        self.edge_labels = edge_labels
        self.edge_rules = edge_rules

    @classmethod
    def load(cls, path: Path) -> "LabelSet":
        data = yaml.safe_load(path.read_text())
        return cls(data["vertex_labels"], list(data["edge_labels"]), data["edge_rules"])

    def is_a(self, label: str, ancestor: str) -> bool:
        if label == ancestor:
            return True
        return any(
            self.is_a(parent, ancestor) for parent in self.vertex_parents.get(label, [])
        )

    def edge_label_for(self, source_label: str, target_label: str) -> str | None:
        for rule in self.edge_rules:
            if self.is_a(source_label, rule["source"]) and self.is_a(
                target_label, rule["target"]
            ):
                return rule["label"]
        return None


class Vertex(BaseModel):
    id: str
    label: str


class Edge(BaseModel):
    id: str
    src: str
    tgt: str
    label: str
    time: list[Interval]


class Graph(BaseModel):
    vertices: list[Vertex]
    edges: list[Edge]


def validate_rag(graph: Graph, label_set: LabelSet) -> list[str]:
    violations = []

    vertices_by_id = {}
    for vertex in graph.vertices:
        if vertex.id in vertices_by_id:
            violations.append(f"duplicate vertex id: {vertex.id}")
        vertices_by_id[vertex.id] = vertex
        if vertex.label not in label_set.vertex_parents:
            violations.append(f"vertex {vertex.id} has unknown label: {vertex.label}")

    for edge in graph.edges:
        if edge.src not in vertices_by_id:
            violations.append(
                f"edge {edge.id} references unknown source vertex: {edge.src}"
            )
            continue
        if edge.tgt not in vertices_by_id:
            violations.append(
                f"edge {edge.id} references unknown target vertex: {edge.tgt}"
            )
            continue
        if edge.label not in label_set.edge_labels:
            violations.append(f"edge {edge.id} has unknown label: {edge.label}")
            continue

        source_label = vertices_by_id[edge.src].label
        target_label = vertices_by_id[edge.tgt].label
        expected_label = label_set.edge_label_for(source_label, target_label)
        if expected_label is None:
            violations.append(
                f"edge {edge.id} ({source_label} -> {target_label}) matches no allowed rule"
            )
        elif expected_label != edge.label:
            violations.append(
                f"edge {edge.id} ({source_label} -> {target_label}) should be labelled "
                f"'{expected_label}', not '{edge.label}'"
            )

    return violations
