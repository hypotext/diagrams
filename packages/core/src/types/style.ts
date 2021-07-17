//#region Style AST
// TODO: unify type name convention (e.g. stop using `I` for interfaces and drop some of the Haskell ported types)

import { VarAD } from "./ad";
import { ASTNode, Identifier, IntLit, IStringLit } from "./ast";
import { IndexVar } from "./domain";

/** Top level type for Style AST */
export interface StyProg extends ASTNode {
  tag: "StyProg";
  blocks: HeaderBlock[];
}

// type HeaderBlock = [Header, Block];
export interface HeaderBlock extends ASTNode {
  tag: "HeaderBlock";
  header: Header;
  block: Block;
}

export interface Block extends ASTNode {
  tag: "Block";
  statements: Stmt[];
}

export type Header = Selector | Namespace;

export interface Selector extends ASTNode {
  tag: "Selector";
  head: DeclPatterns;
  with?: DeclPatterns;
  where?: RelationPatterns;
  namespace?: Namespace;
}

// NOTE: Instead of a js array typed child. I explicitly wrap them in an ASTNode so location and ancestry info can be better preserved.
// TODO: consider dropping the suffix pattern. It's a bit confusing, and DeclList would have been clearer.
export interface DeclPatterns extends ASTNode {
  tag: "DeclPatterns";
  contents: DeclPattern[];
}

export interface Namespace extends ASTNode {
  tag: "Namespace";
  contents: StyVar;
}

export interface DeclPattern extends ASTNode {
  tag: "DeclPattern";
  type: StyT;
  id: BindingForm;
}

export type RelationPattern = RelBind | RelPred;

export interface RelationPatterns extends ASTNode {
  tag: "RelationPatterns";
  contents: RelationPattern[];
}

export interface RelBind extends ASTNode {
  tag: "RelBind";
  id: BindingForm;
  expr: SelExpr;
}

export interface RelPred extends ASTNode {
  tag: "RelPred";
  name: Identifier;
  args: PredArg[];
}

export type PredArg = SEBind | RelPred;

// NOTE: the original type is unnecessarily nested and contain type constructor, which is deprecated.
export type StyT = Identifier | StyTIndexed;

export interface StyTIndexed extends ASTNode {
  tag: "StyTIndexed";
  name: Identifier;
  index: IndexVar;
}

export type IndexExpr = Identifier | IntLit;

export interface RangeExpr extends ASTNode {
  tag: "RangeExpr";
  lower: IndexExpr;
  upper: IndexExpr;
  variable: IndexExpr;
  lowerInclusive: boolean;
  upperInclusive: boolean;
}

export interface ISTTypeVar {
  tag: "STTypeVar";
  contents: STypeVar;
}

export interface ISTCtor {
  tag: "STCtor";
  contents: STypeCtor;
}

export type STypeVar = ISTypeVar;

export interface ISTypeVar {
  typeVarNameS: string;
  typeVarPosS: SourcePos;
}

export type STypeCtor = ISTypeCtor;

export interface ISTypeCtor {
  nameConsS: string;
  argConsS: SArg[];
  posConsS: SourcePos;
}

export type SArg = ISAVar | ISAT;

export interface ISAVar {
  tag: "SAVar";
  contents: BindingForm;
}

export interface ISAT {
  tag: "SAT";
  contents: StyT;
}

export type SelExpr = SEBind | SEFunc | SEValCons | SEFuncOrValCons | SEList;
export interface SEList extends ASTNode {
  tag: "SEList";
  contents: SelExpr[];
}

export interface SEBind extends ASTNode {
  tag: "SEBind";
  contents: BindingForm;
}

export interface SEFunc extends ASTNode {
  tag: "SEFunc";
  name: Identifier;
  args: SelExpr[];
}

export interface SEValCons extends ASTNode {
  tag: "SEValCons";
  name: Identifier;
  args: SelExpr[];
}
// NOTE: This type is used by the style compiler; since the grammar is ambiguous, the compiler will need to narrow down the type of this node when checking the AST.
export interface SEFuncOrValCons extends ASTNode {
  tag: "SEFuncOrValCons";
  name: Identifier;
  args: SelExpr[];
}

export type SourcePos = ISourcePos;

export interface ISourcePos {
  sourceName: string;
  sourceLine: Pos;
  sourceColumn: Pos;
}

export type Pos = IPos;

export type IPos = number;

export type Stmt = PathAssign | IOverride | Delete | IAnonAssign;

export interface PathAssign extends ASTNode {
  tag: "PathAssign";
  type: StyType;
  path: Path;
  value: Expr;
}

export interface IOverride extends ASTNode {
  tag: "Override";
  path: Path;
  value: Expr;
}

export interface Delete extends ASTNode {
  tag: "Delete";
  contents: Path;
}

export interface IAnonAssign extends ASTNode {
  tag: "AnonAssign";
  contents: Expr;
}

export type StyType = ITypeOf | IListOf;

export interface ITypeOf {
  tag: "TypeOf";
  contents: string;
}

export interface IListOf {
  tag: "ListOf";
  contents: string;
}

export type BindingForm = SubVar | StyVar;

export interface SubVar extends ASTNode {
  tag: "SubVar";
  contents: Identifier;
}

export interface StyVar extends ASTNode {
  tag: "StyVar";
  contents: Identifier;
}

export type Expr =
  // | IIntLit
  | AnnoFloat
  | IStringLit
  | IBoolLit
  | Path // NOTE: changed from EPath
  | ICompApp
  | IObjFn
  | IConstrFn
  // | IAvoidFn // TODO: unimplemented
  | IBinOp
  | IUOp
  | IList
  | ITuple
  | IVector
  | IMatrix
  | IVectorAccess
  | IMatrixAccess
  | IListAccess
  | GPIDecl
  | ILayering
  | IPluginAccess;
// | IThenOp; // TODO: deprecated transformation exprs

export interface IIntLit {
  tag: "IntLit";
  contents: number;
}

// interface IAFloat {
//     tag: "AFloat";
//     contents: AnnoFloat;
// }

export interface IBoolLit extends ASTNode {
  tag: "BoolLit";
  contents: boolean;
}

export interface ICompApp extends ASTNode {
  tag: "CompApp";
  name: Identifier;
  args: Expr[];
}

export interface IObjFn extends ASTNode {
  tag: "ObjFn";
  name: Identifier;
  args: Expr[];
}

export interface IConstrFn extends ASTNode {
  tag: "ConstrFn";
  name: Identifier;
  args: Expr[];
}

export interface IAvoidFn {
  tag: "AvoidFn";
  contents: [string, Expr[]];
}

export type BinaryOp = "BPlus" | "BMinus" | "Multiply" | "Divide" | "Exp";

// NOTE: unary + operator not parsed, as they don't change values
export type UnaryOp = "UMinus";
export interface IBinOp extends ASTNode {
  tag: "BinOp";
  op: BinaryOp;
  left: Expr;
  right: Expr;
}
export interface IUOp extends ASTNode {
  tag: "UOp";
  op: UnaryOp;
  arg: Expr;
}

export interface IList extends ASTNode {
  tag: "List";
  contents: Expr[];
}

export interface ITuple extends ASTNode {
  tag: "Tuple";
  contents: [Expr, Expr];
}

export interface IVector extends ASTNode {
  tag: "Vector";
  contents: Expr[];
}

export interface IMatrix extends ASTNode {
  tag: "Matrix";
  contents: Expr[];
}

export interface IVectorAccess extends ASTNode {
  tag: "VectorAccess";
  contents: [Path, Expr];
}

export interface IMatrixAccess extends ASTNode {
  tag: "MatrixAccess";
  contents: [Path, Expr[]];
}

export interface IListAccess extends ASTNode {
  tag: "ListAccess";
  contents: [Path, number];
}

export interface GPIDecl extends ASTNode {
  tag: "GPIDecl";
  shapeName: Identifier;
  properties: PropertyDecl[];
}

export interface ILayering extends ASTNode {
  tag: "Layering";
  below: Path;
  above: Path;
}

export interface IPluginAccess extends ASTNode {
  tag: "PluginAccess";
  contents: [string, Expr, Expr];
}

export interface IThenOp {
  tag: "ThenOp";
  contents: [Expr, Expr];
}

export type AnnoFloat = IFix | IVary | IVaryInit | IVaryAD;

export interface IFix extends ASTNode {
  tag: "Fix";
  contents: number;
}

export interface IVary extends ASTNode {
  tag: "Vary";
}

// Varying float that is initialized at some number as specified by the style-writer
export interface IVaryInit extends ASTNode {
  tag: "VaryInit";
  contents: number;
}

export interface IVaryAD extends ASTNode {
  tag: "VaryAD";
  contents: VarAD;
}

export interface PropertyDecl extends ASTNode {
  tag: "PropertyDecl";
  name: Identifier;
  value: Expr;
}

// TODO: check how the evaluator/compiler should interact with ASTNode
// COMBAK: LocalVar and SubObj are indistinguiable for the parser. The Style compiler will need to disambiguate among them, especially in the case of AccessPath
export type Path =
  | SubObj
  | IFieldPath
  | IPropertyPath
  | IAccessPath
  | LocalVar
  | IInternalLocalVar;
// LocalVar is only used internally by the compiler
// Unused
// | ITypePropertyPath;

export interface SubObj extends ASTNode {
  tag: "SubObj";
  name: BindingForm;
}
export interface IFieldPath extends ASTNode {
  tag: "FieldPath";
  name: BindingForm;
  field: Identifier;
}

export interface IPropertyPath extends ASTNode {
  tag: "PropertyPath";
  name: BindingForm;
  field: Identifier;
  property: Identifier;
}

export interface IAccessPath extends ASTNode {
  tag: "AccessPath";
  path: Path;
  indices: Expr[];
}

// COMBAK: This is named inconsistently since the parser calls it `LocalVar`, should be ILocalVar
export interface LocalVar extends ASTNode {
  tag: "LocalVar";
  contents: Identifier;
}

export interface IInternalLocalVar extends ASTNode {
  // Note, better to not extend ASTNode as it's only used internally by compiler, but breaks parser otherwise
  tag: "InternalLocalVar";
  contents: string;
}
//#endregion
