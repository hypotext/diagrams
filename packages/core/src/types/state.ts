import { Canvas } from "renderer/ShapeDef";
import { prng } from "seedrandom";
import { VarAD, GradGraphs } from "./ad";
import { MaybeVal } from "./common";
import { Shape } from "./shape";
import { Expr, Path } from "./style";
import { ArgVal, Translation, Value } from "./value";

/**
 * The diagram state modeling the original Haskell types
 */
export interface IState {
  varyingPaths: Path[];
  varyingInitInfo: { [pathStr: string]: number }; // These are the values the style writer set initially
  shapePaths: Path[];
  shapeProperties: any; // TODO: types
  uninitializedPaths: any; // TODO: types
  params: Params;
  objFns: Fn[];
  constrFns: Fn[];
  rng: prng;
  selectorMatches: any; // TODO: types
  policyParams: any; // TODO: types
  oConfig: any; // TODO: types
  pendingPaths: Path[];
  varyingValues: number[];
  translation: Translation;
  originalTranslation: Translation;
  shapeOrdering: string[];
  labelCache: LabelCache;
  shapes: Shape[];
  varyingMap: VaryMap;
  canvas: Canvas;
}
export type State = IState;

/**
 * Output of label generation.
 */
export interface LabelData {
  w: Value<number>;
  h: Value<number>;
  rendered: HTMLElement;
}

export type LabelCache = [string, LabelData][];

export type VaryMap<T = VarAD> = Map<string, T>;

export type FnDone<T> = IFnDone<T>;
export interface IFnDone<T> {
  name: string;
  args: ArgVal<T>[];
  optType: OptType;
}

export type Fn = IFn;

/**
 * Generic export interface for constraint or objective functions
 */
export interface IFn {
  fname: string;
  fargs: Expr[];
  optType: OptType;
}
export type OptType = "ObjFn" | "ConstrFn";

export type OptStatus =
  | "NewIter"
  | "UnconstrainedRunning"
  | "UnconstrainedConverged"
  | "EPConverged";

export type LbfgsParams = ILbfgsParams;

// `n` is the size of the varying state
export interface ILbfgsParams {
  // TODO: Store as matrix types
  lastState: MaybeVal<any>; // nx1 (col vec)
  lastGrad: MaybeVal<any>; // nx1 (col vec)
  // invH: Maybe<any>; // nxn matrix
  s_list: any[]; // list of nx1 col vecs
  y_list: any[]; // list of nx1 col vecs
  numUnconstrSteps: number;
  memSize: number;
}

export type Params = IParams;

export interface IParams {
  optStatus: OptStatus;
  /** Constraint weight for exterior point method **/
  weight: number;
  /** Info for unconstrained optimization **/
  UOround: number;
  lastUOstate: number[];
  lastUOenergy: number;
  /** Info for exterior point method **/
  EPround: number;
  lastEPstate: number[];
  lastEPenergy: number;

  lastGradient: number[]; // Value of gradient evaluated at the last state
  lastGradientPreconditioned: number[]; // Value of gradient evaluated at the last state, preconditioned by LBFGS
  // ^ Those two are stored to make them available to Style later

  // For L-BFGS
  lbfgsInfo: LbfgsParams;

  xsVars: VarAD[]; // Computational graph (leaf vars), from the bottom up

  // For energy/gradient compilation
  graphs: GradGraphs;

  functionsCompiled: boolean;

  // Higher-order functions (not yet applied with hyperparameters, in this case, just the EP weight)
  objective: (epWeight: number) => (xs: number[]) => number;
  gradient: (epWeight: number) => (xs: number[]) => number[];

  // Applied with weight (or hyperparameters in general) -- may change with the EP round
  currObjective(xs: number[]): number;
  currGradient(xs: number[]): number[];

  // `xsVars` are all the leaves of the energy graph
  energyGraph: VarAD; // This is the top of the energy graph (parent node)
  energyGraphSer: any; // Serialized energy graph

  historyUOenergy: number[];
  historyAllEnergies: any[];

  constrWeightNode: VarAD; // Handle to node for constraint weight (so it can be set as the weight changes)
  epWeightNode: VarAD; // similar to constrWeightNode

  // Cached versions of compiling each objective and constraint into a function and gradient
  objFnCache: { [k: string]: FnCached }; // Key is the serialized function name, e.g. `contains(A.shape, B.shape)`
  constrFnCache: { [k: string]: FnCached }; // This is kept separate from objfns because objs/constrs may have the same names (=> clashing keys if in same dict)
}

export type FnCached = IFnCached;

// Just the compiled function and its grad, with no weights for EP/constraints/penalties, etc.
export interface IFnCached {
  f(xs: number[]): number;
  gradf(xs: number[]): number[];
}

export type WeightInfo = IWeightInfo;

export interface IWeightInfo {
  constrWeightNode: VarAD; // Constant
  epWeightNode: VarAD; // Changes (input in optimization, but we do NOT need the gradient WRT it)
  constrWeight: number;
  epWeight: number;
}
