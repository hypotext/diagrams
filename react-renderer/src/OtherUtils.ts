import * as _ from "lodash";

const RAND_RANGE = 100;
const TOL = 1e-3;

export const normList = (xs: number[]) =>
  Math.sqrt(_.sum(xs.map(e => e * e)));

export function repeat<T>(i: number, x: T) {
  const xs = [];

  for (let j = 0; j < i; j++) {
    xs.push(x);
  };

  return xs;
};

export const all = (xs: boolean[]) =>
  xs.reduce((prev, curr) => prev && curr, true);

// ---------- Vector utils 

export const scalev = (c: number, xs: number[]): number[] =>
  _.map(xs, x => c * x);

export const addv = (xs: number[], ys: number[]): number[] => {
  if (xs.length !== ys.length) {
    console.error("xs", xs, "ys", ys);
    throw Error("can't add vectors of different length");
  }

  return _.zipWith(xs, ys, (x, y) => x + y);
}

export const subv = (xs: number[], ys: number[]): number[] => {
  if (xs.length !== ys.length) {
    console.error("xs", xs, "ys", ys);
    throw Error("can't sub vectors of different length");
  }

  return _.zipWith(xs, ys, (x, y) => x - y);
};

export const negv = (xs: number[]): number[] =>
  _.map(xs, e => -e);

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

const prettyPrintExpr = (arg: Expr): string => {
  // TODO: only handles paths and floats for now; generalize to other exprs
  if (arg.tag === "EPath") {
    const obj = arg.contents.contents;
    const varName = obj[0].contents;
    const varField = obj[1];
    return [varName, varField].join(".");
  } else if (arg.tag === "AFloat") {
    if (arg.contents.tag === "Fix") {
      const val = arg.contents.contents;
      return String(val);
    } else {
      throw Error("Should not be asked to pretty-print varying float; has it been replaced?");
    }
  } else if (arg.tag === "CompApp") {
    const [fnName, fnArgs] = arg.contents;
    return [fnName, "(", ...(fnArgs.map(prettyPrintExpr).join(", ")), ")"].join("");
  } else {
    // TODO: Finish writing pretty-printer for rest of expressions (UOp, BinOp)
    const res = JSON.stringify(arg);
    console.error("arg", arg);
    console.error(`argument of type ${arg.tag} not yet handled in pretty-printer; returning stopgap`, res);
    return res;
  }
};

const prettyPrintFn = (fn: any) => {
  const name = fn.fname;
  const args = fn.fargs.map(prettyPrintExpr).join(", ");
  return [name, "(", args, ")"].join("");
};

// TODO: only handles property paths for now
export const prettyPrintProperty = (arg: any) => {
  const obj = arg.contents;
  const varName = obj[0].contents;
  const varField = obj[1];
  const property = obj[2];
  return [varName, varField, property].join(".");
};

export const prettyPrintFns = (state: any) => state.objFns.concat(state.constrFns).map(prettyPrintFn);

// ----- Helper functions

export function fromJust<T>(n: MaybeVal<T>): T {
  if (n.tag === "Just") {
    return n.contents;
  }

  throw Error("expected value in fromJust but got Nothing");
}

export const close = (x: number, y: number) => {
  const EPS = 1e-15;
  console.log("x, y", x, y); // TODO make the assert better
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
  return repeatList(0, n).map(e => RAND_RANGE * (Math.random() - 0.5));
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

export const linePts = ({ startX, startY, endX, endY }: any): [VarAD[], VarAD[]] =>
  [[startX.contents, startY.contents], [endX.contents, endY.contents]];

export const getStart = ({ startX, startY }: any): VarAD[] =>
  [startX.contents, startY.contents];

export const getEnd = ({ endX, endY }: any): VarAD[] =>
  [endX.contents, endY.contents];
