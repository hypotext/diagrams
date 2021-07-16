import * as _ from "lodash";
import { VarAD } from "types/ad";
import { MaybeVal } from "types/common";
import { ArgVal } from "types/value";
import { Expr, Path } from "types/style";

const RAND_RANGE = 100;
const TOL = 1e-3;

// HACK: Copied from EngineUtils
export const exprToNumber = (e: Expr): number => {
  if (e.tag === "Fix") {
    return e.contents;
  }
  console.log("got e", e);
  throw Error("expecting expr to be number");
};

export const normList = (xs: number[]) =>
  Math.sqrt(_.sum(xs.map((e) => e * e)));

// Repeat `x`, `i` times
export function repeat<T>(i: number, x: T) {
  const xs = [];

  for (let j = 0; j < i; j++) {
    xs.push(x);
  }

  return xs;
}

export const all = (xs: boolean[]) =>
  xs.reduce((prev, curr) => prev && curr, true);

// ---------- Vector utils

export const scalev = (c: number, xs: number[]): number[] =>
  _.map(xs, (x) => c * x);

export const addv = (xs: number[], ys: number[]): number[] => {
  if (xs.length !== ys.length) {
    console.error("xs", xs, "ys", ys);
    throw Error("can't add vectors of different length");
  }

  return _.zipWith(xs, ys, (x, y) => x + y);
};

export const subv = (xs: number[], ys: number[]): number[] => {
  if (xs.length !== ys.length) {
    console.error("xs", xs, "ys", ys);
    throw Error("can't sub vectors of different length");
  }

  return _.zipWith(xs, ys, (x, y) => x - y);
};

export const negv = (xs: number[]): number[] => _.map(xs, (e) => -e);

export const dot = (xs: number[], ys: number[]): number => {
  if (xs.length !== ys.length) {
    console.error("xs", xs, "ys", ys);
    throw Error("can't dot vectors of different length");
  }

  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    acc += xs[i] * ys[i];
  }
  return acc;
};

// ---------- Printing utils

// COMBAK: Copied from `EngineUtils`; consolidate
export const isPath = (expr: Expr): expr is Path => {
  return ["FieldPath", "PropertyPath", "AccessPath", "LocalVar"].includes(
    expr.tag
  );
};

export const prettyPrintPath = (p: Expr): string => {
  if (p.tag === "FieldPath") {
    const varName = p.name.contents.value;
    const varField = p.field.value;
    return [varName, varField].join(".");
  } else if (p.tag === "PropertyPath") {
    const varName = p.name.contents.value;
    const varField = p.field.value;
    const property = p.property.value;
    return [varName, varField, property].join(".");
  } else if (p.tag === "AccessPath") {
    const pstr: string = prettyPrintPath(p.path);
    const indices: string[] = p.indices.map(prettyPrintExpr);
    return `${pstr}[${indices.toString()}]`;
  } else {
    console.error("unexpected path type in", p);
    return JSON.stringify(p);
  }
};

export const prettyPrintExpr = (arg: Expr): string => {
  // TODO: only handles paths and floats for now; generalize to other exprs
  if (isPath(arg)) {
    return prettyPrintPath(arg);
  } else if (arg.tag === "Fix") {
    const val = arg.contents;
    return String(val);
  } else if (arg.tag === "CompApp") {
    const [fnName, fnArgs] = [arg.name.value, arg.args];
    return [fnName, "(", ...fnArgs.map(prettyPrintExpr).join(", "), ")"].join(
      ""
    );
  } else {
    // TODO: Finish writing pretty-printer for rest of expressions (UOp, BinOp)
    const res = JSON.stringify(arg);
    return res;
  }
};

export const prettyPrintFn = (fn: any) => {
  const name = fn.fname;
  const args = fn.fargs.map(prettyPrintExpr).join(", ");
  return [name, "(", args, ")"].join("");
};

export const prettyPrintFns = (state: any) =>
  state.objFns.concat(state.constrFns).map(prettyPrintFn);

// ----- Helper functions

export function fromJust<T>(n: MaybeVal<T>): T {
  if (n.tag === "Just") {
    return n.contents;
  }

  throw Error("expected value in fromJust but got Nothing");
}

export const close = (x: number, y: number) => {
  const EPS = 1e-15;
  return Math.abs(x - y) < EPS;
};

export const eqNum = (x: number, y: number): boolean => {
  return Math.abs(x - y) < TOL;
};

export const eqList = (xs: number[], ys: number[]): boolean => {
  if (xs == null || ys == null) return false;
  if (xs.length !== ys.length) return false;

  //   _.every(_.zip(xs, ys), e => eqNum(e[0], e[1]));

  // let xys = _.zip(xs, ys);
  // return xys?.every(e => e ? Math.abs(e[1] - e[0]) < TOL : false) ?? false;
  // Typescript won't pass this code no matter how many undefined-esque checks I put in??

  for (let i = 0; i < xs.length; i++) {
    if (!eqNum(xs[i], ys[i])) return false;
  }

  return true;
};

export const repeatList = (e: any, n: number): any[] => {
  const xs = [];
  for (let i = 0; i < n; i++) {
    xs.push(e);
  }
  return xs;
};

export const randList = (n: number): number[] => {
  return repeatList(0, n).map((e) => RAND_RANGE * (Math.random() - 0.5));
};

// From Evaluator
export const floatVal = (v: VarAD): ArgVal<VarAD> => ({
  tag: "Val",
  contents: {
    tag: "FloatV",
    contents: v,
  },
});

// TODO: use it
// const getConstraint = (name: string) => {
//   if (!constrDict[name]) throw new Error(`Constraint "${name}" not found`);
//   // TODO: types for args
//   return (...args: any[]) => toPenalty(constrDict[name]);
// };

export const linePts = ({ start, end }: any): [VarAD[], VarAD[]] => [
  start.contents,
  end.contents,
];

export const getStart = ({ start }: any): VarAD[] => start.contents;

export const getEnd = ({ end }: any): VarAD[] => end.contents;
