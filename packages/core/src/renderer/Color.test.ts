import { Graph } from "./Color";

/**
 * Checks that # of rows === # of cols within a graph (list of num lists)
 */
const is_square_matrix = (graph: Graph): boolean => {
  return graph.every((row) => {
    return row.length === graph.length;
  });
};

/**
 * Checks that an edge exists between every pair of nodes & no self loops exist
 */
const is_complete_graph = (graph: Graph): boolean => {
  if (!is_square_matrix(graph)) return false;
  for (var i = 0; i < graph.length; i++) {
    for (var j = 0; j < graph.length; j++) {
      // no self loops
      if (i == j && graph[i][j] !== 0) return false;
      // edge weights are symmetric
      else if (i != j && graph[i][j] !== graph[j][i]) return false;
    }
  }
  return true;
};

// some vars to use
const empty_arr: number[][] = [];
const jagged_arr = [
  [1, 2, 3],
  [4, 5],
  [6, 7, 8],
];
const rect_arr = [
  [1, 2],
  [4, 5],
  [8, 9],
];
const square_arr = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];
const self_loops = square_arr;
const asymmetric_graph = [
  [0, 2],
  [5, 0],
];
const complete_graph = [
  [0, 2, 3],
  [2, 0, 5],
  [3, 5, 0],
];

// is_square_matrix
describe("testing is_square_matrix", () => {
  test("is_square_matrix, empty case", () => {
    expect(is_square_matrix(empty_arr)).toBe(true);
  });

  test("is_square_matrix, jagged case", () => {
    expect(is_square_matrix(jagged_arr)).toBe(false);
  });

  test("is_square_matrix, rectangular case", () => {
    expect(is_square_matrix(rect_arr)).toBe(false);
  });

  test("is_square_matrix, square case", () => {
    expect(is_square_matrix(square_arr)).toBe(true);
  });
});

// is_complete_graph
describe("testing is_complete_graph", () => {
  test("is_complete_graph, empty case", () => {
    expect(is_complete_graph(empty_arr)).toBe(true);
  });

  test("is_complete_graph, jagged case", () => {
    expect(is_complete_graph(jagged_arr)).toBe(false);
  });

  test("is_complete_graph, rectangular case", () => {
    expect(is_complete_graph(rect_arr)).toBe(false);
  });

  test("is_complete_graph, self loops", () => {
    expect(is_complete_graph(self_loops)).toBe(false);
  });

  test("is_complete_graph, asymmetric graph", () => {
    expect(is_complete_graph(asymmetric_graph)).toBe(false);
  });

  test("is_complete_graph, complete graph", () => {
    expect(is_complete_graph(complete_graph)).toBe(true);
  });
});
