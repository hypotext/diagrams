import { Maybe } from "utils/Error";
import { IStringLit, ASTNode, Identifier } from "./ast";
import { Env, TypeConstructor } from "./domain";
import { Map } from "immutable";

export type SubRes = [SubstanceEnv, Env];
export type LabelMap = Map<string, Maybe<string>>;
export interface SubstanceEnv {
  exprEqualities: [SubExpr, SubExpr][];
  predEqualities: [ApplyPredicate, ApplyPredicate][];
  bindings: Map<string, SubExpr>;
  labels: LabelMap;
  predicates: ApplyPredicate[];
  ast: SubProg;
}

//#region Substance AST
export interface SubProg {
  tag: "SubProg";
  statements: SubStmt[];
}

export type SubStmt =
  | Decl
  | Bind
  | EqualExprs
  | EqualPredicates
  | ApplyPredicate
  | LabelDecl
  | AutoLabel
  | NoLabel;

export interface LabelDecl extends ASTNode {
  tag: "LabelDecl";
  variable: Identifier;
  label: IStringLit;
}
export interface AutoLabel extends ASTNode {
  tag: "AutoLabel";
  option: LabelOption;
}

export type LabelOption = DefaultLabels | LabelIDs;

export interface DefaultLabels extends ASTNode {
  tag: "DefaultLabels";
}
export interface LabelIDs extends ASTNode {
  tag: "LabelIDs";
  variables: Identifier[];
}

export interface NoLabel extends ASTNode {
  tag: "NoLabel";
  args: Identifier[];
}

export interface Decl extends ASTNode {
  tag: "Decl";
  type: TypeConsApp;
  name: Identifier;
}

export interface TypeConsApp extends TypeConstructor {
  args: TypeConsApp[];
}

export interface Bind extends ASTNode {
  tag: "Bind";
  variable: Identifier;
  expr: SubExpr;
}

export type SubExpr =
  | Identifier
  | ApplyFunction
  | ApplyConstructor
  | Func // NOTE: there's no syntactic difference between function and consturctor, so the parser will parse both into this type first
  | Deconstructor
  | ListLit
  | IStringLit;

export interface ListLit extends ASTNode {
  tag: "ListLit";
  contents: SubExpr[];
}
export interface Func extends ASTNode {
  tag: "Func";
  name: Identifier;
  args: SubExpr[];
}
export interface ApplyFunction extends ASTNode {
  tag: "ApplyFunction";
  name: Identifier;
  args: SubExpr[];
}
export interface ApplyConstructor extends ASTNode {
  tag: "ApplyConstructor";
  name: Identifier;
  args: SubExpr[];
}
export interface Deconstructor extends ASTNode {
  tag: "Deconstructor";
  variable: Identifier;
  field: Identifier;
}

export interface EqualExprs extends ASTNode {
  tag: "EqualExprs";
  left: SubExpr;
  right: SubExpr;
}

export interface EqualPredicates extends ASTNode {
  tag: "EqualPredicates";
  left: ApplyPredicate;
  right: ApplyPredicate;
}
export interface ApplyPredicate extends ASTNode {
  tag: "ApplyPredicate";
  name: Identifier;
  args: SubPredArg[];
}

export type SubPredArg = SubExpr | ApplyPredicate; // NOTE: the parser only parse nested preds into `Func`, but the checker will look up and fix the type dynamically

//#endregion
//#region Substance context
// export type SubOut = ISubOut;
// export type ISubOut = [SubProg, [VarEnv, SubEnv], LabelMap];
// export type SubEnv = ISubEnv;
//#endregion
