import { VarAD } from "./ad";
import { StyleError } from "./errors";
import { Expr } from "./style";

/**
 * The input parameters to computations/objectives/constraints in Style. It can be either an entire shape (`IGPI`) or a value (`IVal`).
 */
export type ArgVal<T> = IGPI<T> | IVal<T>;

export interface IGPI<T> {
  tag: "GPI";
  contents: GPI<T>;
}

/**
 * A shape (Graphical Primitive Instance, aka GPI) in penrose has a type (_e.g._ `Circle`) and a set of properties (_e.g._ `center`). Each property this a value tagged with its type.
 */
export type GPI<T> = [string, { [k: string]: Value<T> }];

export interface IVal<T> {
  tag: "Val";
  contents: Value<T>;
}

export type Field = string;
export type Name = string;
export type Property = string;
export type FExpr = FieldExpr<VarAD>;
export type ShapeTypeStr = string;
export type PropID = string;
export type GPIMap = { [k: string]: TagExpr<VarAD> };
export type FieldDict = { [k: string]: FieldExpr<VarAD> };

export type StyleOptFn = [string, Expr[]]; // Objective or constraint

// NOTE: To make a deep clone, use `clone` from `rfdc`
/**
 * Translation represents the computational graph compiled from a trio of Penrose programs.
 */
export type Translation = ITrans<VarAD>;

export type Trans = TrMap<VarAD>;

export type TrMap<T> = { [k: string]: { [k: string]: FieldExpr<T> } };

export interface ITrans<T> {
  // TODO: compGraph
  trMap: TrMap<T>;
  warnings: StyleError[];
}

export type FieldExpr<T> = IFExpr<T> | IFGPI<T>;

export interface IFExpr<T> {
  tag: "FExpr";
  contents: TagExpr<T>;
}

export interface IFGPI<T> {
  tag: "FGPI";
  contents: GPIExpr<T>;
}

export type GPIProps<T> = { [k: string]: TagExpr<T> };

export type GPIExpr<T> = [string, { [k: string]: TagExpr<T> }];
export type TagExpr<T> = IOptEval<T> | IDone<T> | IPending<T>;

export interface IOptEval<T> {
  tag: "OptEval";
  contents: Expr;
}

export interface IDone<T> {
  tag: "Done";
  contents: Value<T>;
}

export interface IPending<T> {
  tag: "Pending";
  contents: Value<T>;
}

/**
 * A value in the penrose system.
 */
export type Value<T> =
  | IFloatV<T>
  | IIntV
  | IBoolV<T>
  | IStrV
  | IPtV<T>
  | IPathDataV<T>
  | IPtListV<T>
  | IColorV<T>
  | IPaletteV<T>
  | IFileV<T>
  | IStyleV<T>
  | IListV<T>
  | IVectorV<T>
  | IMatrixV<T>
  | ITupV<T>
  | ILListV<T>
  | IHMatrixV<T>
  | IPolygonV<T>;

export type Elem<T> =
  | IPt<T>
  | ICubicBez<T>
  | ICubicBezJoin<T>
  | IQuadBez<T>
  | IQuadBezJoin<T>
  | IArc<T>;

export type SubPath<T> = IClosed<T> | IOpen<T>;
interface IClosed<T> {
  tag: "Closed";
  contents: Elem<T>[];
}

interface IOpen<T> {
  tag: "Open";
  contents: Elem<T>[];
}

// Unused
// interface ITypePropertyPath {
//   tag: "TypePropertyPath";
// }

/** A floating point number **/
export interface IFloatV<T> {
  tag: "FloatV";
  contents: T;
}

/** An integer **/
export interface IIntV {
  tag: "IntV";
  contents: number;
}

/** A boolean expression (`True` or `False`) **/
export interface IBoolV<T> {
  tag: "BoolV";
  contents: boolean;
}

/** A string literal **/
export interface IStrV {
  tag: "StrV";
  contents: string;
}

/** A point in 2D **/
export interface IPtV<T> {
  tag: "PtV";
  contents: T[];
}

/** A path, similar to an [SVG path](https://developer.mozilla.org/en-US/docs/Web/SVG/Tutorial/Paths) **/
export interface IPathDataV<T> {
  tag: "PathDataV";
  contents: SubPath<T>[];
}

/** A list of points **/
export interface IPtListV<T> {
  tag: "PtListV";
  contents: T[][];
}

/** A list of colors **/
export interface IPaletteV<T> {
  tag: "PaletteV";
  contents: Color<T>[];
}

/** A color encoded in RGB or HSV **/
export interface IColorV<T> {
  tag: "ColorV";
  contents: Color<T>;
}

/** A path to a file **/
export interface IFileV<T> {
  tag: "FileV";
  contents: string;
}

/** A string literal for shape styling (e.g. `dotted`) **/
export interface IStyleV<T> {
  tag: "StyleV";
  contents: string;
}

/** A list **/
export interface IListV<T> {
  tag: "ListV";
  contents: T[];
}

/** A vector of floating-point numbers **/
export interface IVectorV<T> {
  tag: "VectorV";
  contents: T[];
}

/** A 2D matrix **/
export interface IMatrixV<T> {
  tag: "MatrixV";
  contents: T[][];
}

/** A 2-tuple **/
export interface ITupV<T> {
  tag: "TupV";
  contents: T[];
}

/** A list of lists **/
export interface ILListV<T> {
  tag: "LListV";
  contents: T[][];
}

/**
 * @deprecated
 */
export interface IHMatrixV<T> {
  tag: "HMatrixV";
  contents: HMatrix<T>;
}

/**
 * @deprecated
 */
export interface IPolygonV<T> {
  tag: "PolygonV";
  contents: [T[][][], T[][][], T[][], T[][]];
  // contents: T[][][];
}

export type HMatrix<T> = IHMatrix<T>;

export interface IHMatrix<T> {
  xScale: T;
  xSkew: T;
  ySkew: T;
  yScale: T;
  dx: T;
  dy: T;
}

export type Color<T> = IRGBA<T> | IHSVA<T>;

export interface IRGBA<T> {
  tag: "RGBA";
  contents: T[];
}

export interface IHSVA<T> {
  tag: "HSVA";
  contents: T[];
}

// export interface IPt<T> {
//   tag: "Pt";
//   contents: [T, T];
// }

// export interface ICubicBez<T> {
//   tag: "CubicBez";
//   contents: [[T, T], [T, T], [T, T]];
// }

// export interface ICubicBezJoin<T> {
//   tag: "CubicBezJoin";
//   contents: [[T, T], [T, T]];
// }

// export interface IQuadBez<T> {
//   tag: "QuadBez";
//   contents: [[T, T], [T, T]];
// }

// export interface IQuadBezJoin<T> {
//   tag: "QuadBezJoin";
//   contents: [T, T];
// }

// export interface IArc<T> {
//   tag: "Arc";
//   contents: [[T, T], [T, T, T], [T, T]];
// }

export interface IPt<T> {
  tag: "Pt";
  contents: T[];
}

export interface ICubicBez<T> {
  tag: "CubicBez";
  contents: T[][];
}

export interface ICubicBezJoin<T> {
  tag: "CubicBezJoin";
  contents: T[][];
}

export interface IQuadBez<T> {
  tag: "QuadBez";
  contents: T[][];
}

export interface IQuadBezJoin<T> {
  tag: "QuadBezJoin";
  contents: T[];
}

export interface IArc<T> {
  tag: "Arc";
  contents: T[][];
}
