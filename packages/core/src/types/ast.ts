//#region AST nodes
export interface SourceLoc {
  line: number;
  col: number;
}

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<T>;

export type ASTNode = Optional<ConcreteNode, "start" | "end">;

export type NodeType =
  | "Substance"
  | "Style"
  | "Domain"
  | "SyntheticSubstance"
  | "SyntheticStyle";

export interface SyntheticNode extends ASTNode {
  nodeType: "SyntheticSubstance" | "SyntheticStyle";
}
export interface ConcreteNode {
  tag: string;
  start: SourceLoc;
  end: SourceLoc;
  nodeType: NodeType;
  children: ASTNode[];
  // TODO: add file source and node type
  // sourceFile: FilePath
  // Optionally for querying
  // parent: ASTNode; // NOTE: pointer type; don't serialize this
}

export interface Identifier extends ASTNode {
  tag: "Identifier";
  type: string; // meta-info: either `value` or `type-identifier` according to the parser
  value: string; // the actual value
}
export interface IStringLit extends ASTNode {
  tag: "StringLit";
  contents: string;
}
export interface IntLit extends ASTNode {
  tag: "IntLit";
  contents: number;
}
//#endregion
