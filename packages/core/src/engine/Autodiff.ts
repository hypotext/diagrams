import * as _ from "lodash";
import { all, fromJust, randList, eqList } from "utils/OtherUtils";
import { settings } from "cluster";
import consola, { LogLevel } from "consola";
import { VarAD, IVarAD, GradGraphs } from "types/ad";
import { MaybeVal } from "types/common";
import { WeightInfo } from "types/state";

// To view logs, use LogLevel.Trace, otherwese LogLevel.Warn
// const log = consola.create({ level: LogLevel.Trace }).withScope("Optimizer");
const log = consola.create({ level: LogLevel.Warn }).withScope("Optimizer");

// Logging flags
const PRINT_TEST_RESULTS = true;
const DEBUG_ENERGY = false;
const DEBUG_GRADIENT = true;
const DEBUG_GRADIENT_UNIT_TESTS = false;

// Consts
const NUM_SAMPLES = 5; // Number of samples to evaluate gradient tests at
export const EPS_DENOM = 10e-6; // Avoid divide-by-zero in denominator

// Reverse-mode AD
// Implementation adapted from https://rufflewind.com/2016-12-30/reverse-mode-automatic-differentiation and https://github.com/Rufflewind/revad/blob/eb3978b3ccdfa8189f3ff59d1ecee71f51c33fd7/revad.py

// NOTE: VARIABLES ARE MUTATED DURING AD CALCULATION

// ----- Core AD code

/**
 * Make a number into a gradient `VarAD`. Don't use this!
 */
export const gvarOf = (x: number, vname = "", metadata = ""): VarAD => {
  if (typeof x !== "number") {
    console.error("x", x);
    throw Error("expected number");
  }

  // Grad var, level 1
  return variableAD(x, vname, metadata, false);
};

/**
 * Make a number into a `VarAD`.
 */
export const varOf = (x: number, vname = "", metadata = ""): VarAD => {
  if (typeof x !== "number") {
    console.error("x", x);
    throw Error("expected number");
  }

  return variableAD(x, vname, metadata);
};

/**
 * Return a new `VarAD` that's a constant.
 */
export const constOf = (x: number): VarAD => {
  if (typeof x !== "number") {
    console.error("x", x);
    throw Error("expected number");
  }

  return variableAD(x, String(x), "const");
};

export const constOfIf = (x: number | VarAD): VarAD => {
  if (typeof x === "number") {
    return variableAD(x, String(x), "const");
  }

  return x;
};

/**
 * Return the numerical value held in a `VarAD`.
 */
export const numOf = (x: VarAD): number => x.val;

/**
 * Make a number into a `VarAD`.
 */
export const differentiable = (e: number): VarAD => {
  // log.trace("making it differentiable", e);
  return varOf(e);
};

/**
 * Make a number into a `VarAD`. Don't use this!
 */
export const variableAD = (
  x: number,
  vname = "",
  metadata = "",
  isCompNode = true
): VarAD => {
  const opName = vname ? vname : String(x);

  return {
    tag: "custom",
    metadata,
    op: opName,
    isInput: false,
    val: x,
    isCompNode,
    valDone: true,
    parents: [],
    children: [],
    parentsGrad: [],
    childrenGrad: [],
    gradVal: { tag: "Nothing" },
    gradNode: { tag: "Nothing" },
    index: -100,

    debug: false,
    debugInfo: "",

    nodeVisited: false,
    name: "",
  };
};

export const markInput = (v: VarAD, i: number) => {
  v.isInput = true;
  v.index = i;
  return v;
};

const inputVarAD = (x: number, i: number, vname = ""): VarAD => {
  return markInput(variableAD(x), i);
};

// Copies the input numbers and returns a new list of vars marked as inputs
export const makeADInputVars = (xs: number[]): VarAD[] => {
  const xsCopy = [...xs];
  const xsVars = xsCopy.map((x, i) => markInput(variableAD(x), i));
  // Need to mark these so we know what's special when generating the function code
  return xsVars;
};

// This should only be applied to a leaf node
// It moves forward from the leaf in question, then recursively arrives at the seed node (one output parent), caching each gradient value for an intermediate note
// (However, it doesn't calculate gradient for any other leaf nodes, though they do use the cached intermediate values)

//            (ds/ds = 1)
//                s
//               ^ ^
//              /   \
//               ...
//        z1 = ...  z2 = ...
//              ^   ^
//  dz1/dv = ... \ / dz2/dv = ...
//               (v) = ...
//
//  ds/dv = ds/sz1 * dz1/dv + ds/dz2 * dz2/dv + ...
// The recursive parts are ds/dzi (the parents further up)

// grad(v) means ds/dv (s is the single output seed)

const gradADSymbolic = (v: VarAD): VarAD => {
  // Already computed/cached the gradient
  if (v.gradNode.tag === "Just") {
    return v.gradNode.contents;
  }

  // Build subgraph
  let res;
  if (v.parents.length === 0) {
    // node has no parents, so setting grad to 0 (it doesn't influence the output)
    res = gvarOf(0, "0", "no gradient");
  } else {
    // normal reverse-mode AD chain rule
    // The result is built via pointers to subgraphs that are already built in child nodes of the original comp graph
    res = addN(
      v.parents.map((parent) =>
        mul(
          fromJust(parent.sensitivityNode),
          gradADSymbolic(parent.node),
          false
        )
      ),
      false
    );
  }

  // Mark node as done
  v.gradNode = { tag: "Just", contents: res };

  // Result is a gradient
  res.isCompNode = false;

  // Note that it does not return v
  return res;
};

// df/f[x] with finite differences about xi
const gradFiniteDiff = (f: (args: number[]) => number) => {
  return (xs: number[]): number[] => {
    const EPSG = 10e-5;

    // Scalar estimate (in 1D)
    // const dfxi = (f, x) => (f(x + EPSG / 2.) - f(x - EPSG / 2.)) / EPSG;

    const xsDiff = xs.map((e, i) => {
      const xsLeft = [...xs];
      xsLeft[i] = xsLeft[i] - EPSG / 2;
      const xsRight = [...xs];
      xsRight[i] = xsRight[i] + EPSG / 2;
      return (f(xsRight) - f(xsLeft)) / EPSG;
    });

    return xsDiff;
  };
};

const gradAllSymbolic = (energyGraph: VarAD, xsVars: VarAD[]): VarAD[] => {
  energyGraph.gradNode = { tag: "Just", contents: variableAD(1.0) };
  const dxs = xsVars.map(gradADSymbolic); // Computes it per variable, mutating the graph to set cached results and reuse them
  const gradxs = xsVars.map((x: VarAD) => fromJust(x.gradNode));
  return gradxs;
};

// ----- Ops (extensible)
// NOTE: These all update the graph and return new variables that should be used to build the ops
// NOTE: For the resulting var `z`, z's parents and grad are uninitialized
// TODO: Factor out op helper to deal with graph-building boilerplate

// --- Binary ops

//                (+) (z := v + w)     -- parent
//               ^   ^
// dz/dv = 1    /     \    dz/dw = 1   -- sensitivities
//             v       w               -- children

// TODO: Put these in ops dict
// NOTE: The names of these ops matter for opMap, don't change them

// The point of making the sensitivity nodes here is that when the gradient is computed, each child needs to know what its partial derivative was, which depends on its position (e.g. either the first or second arg in x * y has a different sensitivity). This can't be looked up in, say, a dict
// You have to build it inline bc it involves references to the variables

const just = (v: VarAD): MaybeVal<VarAD> => {
  return { tag: "Just", contents: v };
};

const none: MaybeVal<VarAD> = { tag: "Nothing" };

const check = (
  isCompNode: boolean,
  sensitivityNode: VarAD
): MaybeVal<VarAD> => {
  return isCompNode ? just(sensitivityNode) : none;
};

/**
 * Return `v + w`.
 */
export const add = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val + w.val, "+");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(gvarOf(1.0)) });
    w.parents.push({ node: z, sensitivityNode: just(gvarOf(1.0)) });

    z.children.push({ node: v, sensitivityNode: just(gvarOf(1.0)) });
    z.children.push({ node: w, sensitivityNode: just(gvarOf(1.0)) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return the sum of elements in `xs`.
 */
export const addN = (xs: VarAD[], isCompNode = true): VarAD => {
  // N-way add
  // TODO: Do argument list length checking for other ops generically
  if (xs.length === 0) {
    log.trace("node", xs);
    throw Error("argument list to addN is empty; expected 1+ elements");
  } else if (xs.length === 1) {
    return xs[0];
  } else if (xs.length === 2) {
    return add(xs[0], xs[1], isCompNode);
  } else {
    const z = variableAD(_.sum(_.map(xs, (x) => x.val)), "+ list");
    z.isCompNode = isCompNode;

    if (isCompNode) {
      for (const x of xs) {
        x.parents.push({ node: z, sensitivityNode: just(gvarOf(1.0)) });
        z.children.push({ node: x, sensitivityNode: just(gvarOf(1.0)) });
      }
    } else {
      for (const x of xs) {
        x.parentsGrad.push({ node: z, sensitivityNode: none });
        z.childrenGrad.push({ node: x, sensitivityNode: none });
      }
    }

    return z;
  }
};

/**
 * Return `v * w`.
 */
export const mul = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val * w.val, "*");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(w) });
    w.parents.push({ node: z, sensitivityNode: just(v) });

    z.children.push({ node: v, sensitivityNode: just(w) });
    z.children.push({ node: w, sensitivityNode: just(v) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `v - w`.
 */
export const sub = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val - w.val, "-");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(gvarOf(1.0)) });
    w.parents.push({ node: z, sensitivityNode: just(gvarOf(-1.0)) });

    z.children.push({ node: v, sensitivityNode: just(gvarOf(1.0)) });
    z.children.push({ node: w, sensitivityNode: just(gvarOf(-1.0)) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `v / w`.
 */
export const div = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  if (Math.abs(w.val) < 10e-10) {
    throw Error("divide by zero");
  }

  const z = variableAD(v.val / w.val, "/");
  z.isCompNode = isCompNode;

  // grad(v/w) = [1/w, -v/w^2]
  if (isCompNode) {
    const vnode = just(div(gvarOf(1.0), w, false));
    const w0node = squared(w, false);
    // const w1node = max(epsdg, w0node, false); // TODO: Why does this make it get stuck? w1node is not even used
    const wnode = just(neg(div(v, w0node, false), false));

    v.parents.push({ node: z, sensitivityNode: vnode });
    w.parents.push({ node: z, sensitivityNode: wnode });

    z.children.push({ node: v, sensitivityNode: vnode });
    z.children.push({ node: w, sensitivityNode: wnode });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `max(v, w)`.
 */
export const max = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(Math.max(v.val, w.val), "max");
  z.isCompNode = isCompNode;

  // const vFn = (arg: "unit"): number => v.val > w.val ? 1.0 : 0.0;
  // const wFn = (arg: "unit"): number => v.val > w.val ? 0.0 : 1.0;

  const cond = gt(v, w, false);

  const vNode = ifCond(cond, gvarOf(1.0), gvarOf(0.0), false);
  const wNode = ifCond(cond, gvarOf(0.0), gvarOf(1.0), false);
  // NOTE: this adds a conditional to the computational graph itself, so the sensitivities change based on the input values
  // Note also the closure attached to each sensitivityFn, which has references to v and w (which have references to their values)

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(vNode) });
    w.parents.push({ node: z, sensitivityNode: just(wNode) });

    z.children.push({ node: v, sensitivityNode: just(vNode) });
    z.children.push({ node: w, sensitivityNode: just(wNode) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `min(v, w)`.
 */
export const min = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(Math.min(v.val, w.val), "min");
  z.isCompNode = isCompNode;

  // const vFn = (arg: "unit"): number =< v.val < w.val ? 1.0 : 0.0;
  // const wFn = (arg: "unit"): number =< v.val < w.val ? 0.0 : 1.0;

  const cond = lt(v, w, false);

  const vNode = ifCond(cond, gvarOf(1.0), gvarOf(0.0), false);
  const wNode = ifCond(cond, gvarOf(0.0), gvarOf(1.0), false);
  // NOTE: this adds a conditional to the computational graph itself, so the sensitivities change based on the input values
  // Note also the closure attached to each sensitivityFn, which has references to v and w (which have references to their values)

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(vNode) });
    w.parents.push({ node: z, sensitivityNode: just(wNode) });

    z.children.push({ node: v, sensitivityNode: just(vNode) });
    z.children.push({ node: w, sensitivityNode: just(wNode) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `atan2(y, x)`.
 * NOTE: This function has not been thoroughly tested
 */
export const atan2 = (y: VarAD, x: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(y.val * x.val, "atan2");
  z.isCompNode = isCompNode;

  if (isCompNode) {
      // https://stackoverflow.com/questions/52176354/sympy-can-i-safely-differentiate-atan2
      // grad atan2(y, x) = [-y/(x**2 + y**2),  x/(x**2 + y**2)]
      const denom = add(squared(x, false), squared(y, false), false);
      const ynode = just(div(neg(y, false), denom, false));
      const xnode = just(div(x, denom, false));

    y.parents.push({ node: z, sensitivityNode: ynode });
    x.parents.push({ node: z, sensitivityNode: xnode });

    z.children.push({ node: y, sensitivityNode: ynode });
    z.children.push({ node: x, sensitivityNode: xnode });
  } else {
    y.parentsGrad.push({ node: z, sensitivityNode: none });
    x.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: y, sensitivityNode: none });
    z.childrenGrad.push({ node: x, sensitivityNode: none });
  }

  return z;
};

// --- Unary ops

/**
 * Return `sin(v)`.
 */
export const sin = (v: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(Math.sin(v.val), "sin");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    const node = just(cos(v, false));
    v.parents.push({ node: z, sensitivityNode: node });

    z.children.push({ node: v, sensitivityNode: node });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `cos(v)`.
 */
export const cos = (v: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(Math.cos(v.val), "cos");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    const node = just(neg(sin(v, false), false));
    v.parents.push({ node: z, sensitivityNode: node });

    z.children.push({ node: v, sensitivityNode: node });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `-v`.
 */
export const neg = (v: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(-v.val, "- (unary)");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    v.parents.push({ node: z, sensitivityNode: just(gvarOf(-1.0)) });

    z.children.push({ node: v, sensitivityNode: just(gvarOf(-1.0)) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `v * v`.
 */
export const squared = (v: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val * v.val, "squared");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    const node = just(mul(gvarOf(2.0), v, false));
    v.parents.push({ node: z, sensitivityNode: node });

    z.children.push({ node: v, sensitivityNode: node });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `sqrt(v)`.
 */
export const sqrt = (v: VarAD, isCompNode = true): VarAD => {
  // NOTE: Watch out for negative numbers in sqrt
  // NOTE: Watch out for divide by zero in 1 / [2 sqrt(x)]
  const z = variableAD(Math.sqrt(v.val), "sqrt");
  z.isCompNode = isCompNode;

  const dzDv = (arg: "unit"): number => {
    if (v.val < 0) {
      log.trace(`negative arg ${v.val} in sqrt`);
    }
    return 1.0 / (2.0 * Math.sqrt(Math.max(0, v.val) + EPS_DENOM));
  };

  // TODO: How to do the checks in this graph? I guess sqrt should have a special evaluation/gradient rule?

  // It's important to only construct gradNode if this is a compnode, otherwise it will make recursive calls to the function ops and blow the stack
  if (isCompNode) {
    const gradNode = div(
      gvarOf(1.0),
      mul(gvarOf(2.0), max(gvarOf(0.0), sqrt(v, false), false), false),
      false
    );
    v.parents.push({ node: z, sensitivityNode: just(gradNode) });
    z.children.push({ node: v, sensitivityNode: just(gradNode) });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `1 / v`.
 */
export const inverse = (v: VarAD, isCompNode = true): VarAD => {
  // TODO: Avoid numerical instability
  const z = variableAD(1 / (v.val + EPS_DENOM), "inverse");
  z.isCompNode = isCompNode;

  // -1/(x^2 + epsilon) -- This takes care of the divide-by-zero gradient problem
  if (isCompNode) {
    const node = just(
      neg(
        inverse(add(squared(v, false), gvarOf(EPS_DENOM), false), false),
        false
      )
    );
    v.parents.push({ node: z, sensitivityNode: node });

    z.children.push({ node: v, sensitivityNode: node });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};

/**
 * Return `|v|`.
 */
export const absVal = (v: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(Math.abs(v.val), "abs");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    // x / (|x| + epsilon)
    const node = just(
      div(v, add(absVal(v, false), gvarOf(EPS_DENOM), false), false)
    );
    v.parents.push({ node: z, sensitivityNode: node });

    z.children.push({ node: v, sensitivityNode: node });
  } else {
    v.parentsGrad.push({ node: z, sensitivityNode: none });

    z.childrenGrad.push({ node: v, sensitivityNode: none });
  }

  return z;
};
// ------- Discontinuous / noGrad ops

/**
 * Return a variable with no gradient.
 */
const noGrad: VarAD = gvarOf(0.0, "noGrad");

/**
 * Return a conditional `v > w`.
 */
export const gt = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  // returns a boolean, which is converted to number

  const z = variableAD(v.val > w.val ? 1.0 : 0.0, "gt");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    z.children.push({ node: v, sensitivityNode: just(noGrad) });
    z.children.push({ node: w, sensitivityNode: just(noGrad) });

    v.parents.push({ node: z, sensitivityNode: just(noGrad) });
    w.parents.push({ node: z, sensitivityNode: just(noGrad) });
  } else {
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

/**
 * Return a conditional `v < w`.
 */
export const lt = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  // returns a boolean, which is converted to number
  const z = variableAD(v.val < w.val ? 1.0 : 0.0, "lt");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    z.children.push({ node: v, sensitivityNode: just(noGrad) });
    z.children.push({ node: w, sensitivityNode: just(noGrad) });

    v.parents.push({ node: z, sensitivityNode: just(noGrad) });
    w.parents.push({ node: z, sensitivityNode: just(noGrad) });
  } else {
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

/**
 * Return a conditional `v == w`. (TODO: Maybe check if they are equal up to a tolerance?)
 * Note, the 1.0, 0.0 stuff is irrelevant, in the codegen they are boolean
 */
export const eq = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  // returns a boolean, which is converted to number
  const z = variableAD(v.val === w.val ? 1.0 : 0.0, "eq");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    z.children.push({ node: v, sensitivityNode: just(noGrad) });
    z.children.push({ node: w, sensitivityNode: just(noGrad) });

    v.parents.push({ node: z, sensitivityNode: just(noGrad) });
    w.parents.push({ node: z, sensitivityNode: just(noGrad) });
  } else {
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

/**
 * Return a boolean (number) `v && w`
 */
export const and = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val * w.val, "and");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    z.children.push({ node: v, sensitivityNode: just(noGrad) });
    z.children.push({ node: w, sensitivityNode: just(noGrad) });

    v.parents.push({ node: z, sensitivityNode: just(noGrad) });
    w.parents.push({ node: z, sensitivityNode: just(noGrad) });
  } else {
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

/**
 * Return a boolean (number) `v || w`
 */
export const or = (v: VarAD, w: VarAD, isCompNode = true): VarAD => {
  const z = variableAD(v.val + w.val, "or");
  z.isCompNode = isCompNode;

  if (isCompNode) {
    z.children.push({ node: v, sensitivityNode: just(noGrad) });
    z.children.push({ node: w, sensitivityNode: just(noGrad) });

    v.parents.push({ node: z, sensitivityNode: just(noGrad) });
    w.parents.push({ node: z, sensitivityNode: just(noGrad) });
  } else {
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

/**
 * Return a conditional `if(cond) then v else w`.
 */
export const ifCond = (
  cond: VarAD,
  v: VarAD,
  w: VarAD,
  isCompNode = true
): VarAD => {
  // When the computation graph is evaluated, either v or w is evaluated and returned, depending on the boolean value cond in the generated gradient

  const z = variableAD(cond.val ? v.val : w.val, "ifCond"); // No value?
  z.isCompNode = isCompNode;

  if (isCompNode) {
    const vNode = ifCond(cond, gvarOf(1.0), gvarOf(0.0), false);
    const wNode = ifCond(cond, gvarOf(0.0), gvarOf(1.0), false);

    z.children.push({ node: cond, sensitivityNode: just(noGrad) });
    z.children.push({ node: v, sensitivityNode: just(vNode) });
    z.children.push({ node: w, sensitivityNode: just(wNode) });

    cond.parents.push({ node: z, sensitivityNode: just(noGrad) });
    v.parents.push({ node: z, sensitivityNode: just(vNode) });
    w.parents.push({ node: z, sensitivityNode: just(wNode) });
  } else {
    z.childrenGrad.push({ node: cond, sensitivityNode: none });
    z.childrenGrad.push({ node: v, sensitivityNode: none });
    z.childrenGrad.push({ node: w, sensitivityNode: none });

    cond.parentsGrad.push({ node: z, sensitivityNode: none });
    v.parentsGrad.push({ node: z, sensitivityNode: none });
    w.parentsGrad.push({ node: z, sensitivityNode: none });
  }

  return z;
};

// ------------ Meta / debug ops

/**
 * Mutates a node `v` to store log info. Dumps node value (during evaluation) to the console. You must use the node that `debug` returns, otherwise the debug information will not appear.
 * For more documentation on how to use this function, see the Penrose wiki page.
 */
export const debug = (v: VarAD, debugInfo = "no additional info"): VarAD => {
  v.debug = true;
  v.debugInfo = debugInfo;
  return v;
};

const opMap = {
  "+": {
    fn: (x: number, y: number): number => x + y,
    gradGraph: variableAD(1.0),
  },
  "+ list": {
    fn: (xs: number[]): number => _.sum(xs),
    gradGraph: variableAD(1.0),
  },
  "*": {
    fn: (x: number, y: number): number => x * y,
  },
  "-": {
    fn: (x: number, y: number): number => x - y,
  },
  "/": {
    fn: (x: number, y: number): number => x / y,
  },
  max: {
    fn: (x: number, y: number): number => Math.max(x, y),
  },
  min: {
    fn: (x: number, y: number): number => Math.min(x, y),
  },
  sin: {
    fn: (x: number): number => Math.sin(x),
  },
  cos: {
    fn: (x: number): number => Math.cos(x),
  },
  "- (unary)": {
    fn: (x: number): number => -x,
  },
  squared: {
    fn: (x: number): number => x * x,
  },
  sqrt: {
    fn: (x: number): number => {
      if (x < 0) {
        log.trace(`negative arg ${x} in sqrt`);
      }
      return Math.sqrt(Math.max(0, x));
    },
  },
  inverse: {
    fn: (x: number): number => {
      return 1 / (x + EPS_DENOM);
    },
  },
  abs: {
    fn: (x: number): number => {
      return x / Math.abs(x + EPS_DENOM);
    },
  },
  // Note that these functions treat booleans as numbers: 1.0 = True, 0.0 = False
  gt: {
    fn: (x: number, y: number): number => (x > y ? 1.0 : 0.0),
  },
  lt: {
    fn: (x: number, y: number): number => (x < y ? 1.0 : 0.0),
  },
  ifCond: {
    fn: (cond: number, x: number, y: number): number => (cond > 0.0 ? x : y),
  },
};

// Useful constants

export const zero: VarAD = constOf(0);

// to prevent 1/0 (infinity). put it in the denominator
export const epsd: VarAD = constOf(10e-10);

// Useful grad constants
// TODO -- But it seems to be bad to use them...

export const zeroG: VarAD = gvarOf(0.0);

export const oneG: VarAD = gvarOf(1.0);

export const negoneG: VarAD = gvarOf(1.0);

export const epsdg: VarAD = gvarOf(10e-10);

// ----------------- Other ops

/**
 * Some vector operations that can be used on `VarAD`.
 */
export const ops = {
  // Note that these ops MUST use the custom var ops for grads
  // Note that these ops are hardcoded to assume they are not applied to grad nodes

  /**
   * Return the norm of the 2-vector `[c1, c2]`.
   */
  norm: (c1: VarAD, c2: VarAD) => ops.vnorm([c1, c2]),

  /**
   * Return the Euclidean distance between scalars `c1, c2`.
   */
  dist: (c1: VarAD, c2: VarAD) => ops.vnorm([c1, c2]),

  /**
   * Return the sum of vectors `v1, v2.
   */
  vadd: (v1: VarAD[], v2: VarAD[]): VarAD[] => {
    if (v1.length !== v2.length) {
      throw Error("expected vectors of same length");
    }

    const res = _.zipWith(v1, v2, add);
    return res;
  },

  /**
   * Return the difference of vectors `v1, v2.
   */
  vsub: (v1: VarAD[], v2: VarAD[]): VarAD[] => {
    if (v1.length !== v2.length) {
      throw Error("expected vectors of same length");
    }

    const res = _.zipWith(v1, v2, sub);
    return res;
  },

  /**
   * Return the Euclidean norm squared of vector `v`.
   */
  vnormsq: (v: VarAD[]): VarAD => {
    const res = v.map((e) => squared(e));
    return _.reduce(res, (x, y) => add(x, y, true), variableAD(0.0)); // TODO: Will this one (var(0)) have its memory freed?
    // Note (performance): the use of 0 adds an extra +0 to the comp graph, but lets us prevent undefined if the list is empty
  },

  /**
   * Return the Euclidean norm of vector `v`.
   */
  vnorm: (v: VarAD[]): VarAD => {
    const res = ops.vnormsq(v);
    return sqrt(res);
  },

  /**
   * Return the vector `v` scaled by scalar `c`.
   */
  vmul: (c: VarAD, v: VarAD[]): VarAD[] => {
    return v.map((e) => mul(c, e));
  },

  /**
   * Return the vector `v`, scaled by `-1`.
   */
  vneg: (v: VarAD[]): VarAD[] => {
    return ops.vmul(constOf(-1.0), v);
  },

  /**
   * Return the vector `v` divided by scalar `c`.
   */
  vdiv: (v: VarAD[], c: VarAD): VarAD[] => {
    return v.map((e) => div(e, c));
  },

  /**
   * Return the vector `v`, normalized.
   */
  vnormalize: (v: VarAD[]): VarAD[] => {
    const vsize = add(ops.vnorm(v), varOf(EPS_DENOM));
    return ops.vdiv(v, vsize);
  },

  /**
   * Return the Euclidean distance between vectors `v` and `w`.
   */
  vdist: (v: VarAD[], w: VarAD[]): VarAD => {
    if (v.length !== w.length) {
      throw Error("expected vectors of same length");
    }

    return ops.vnorm(ops.vsub(v, w));
  },

  /**
   * Return the Euclidean distance squared between vectors `v` and `w`.
   */
  vdistsq: (v: VarAD[], w: VarAD[]): VarAD => {
    if (v.length !== w.length) {
      throw Error("expected vectors of same length");
    }

    return ops.vnormsq(ops.vsub(v, w));
  },

  /**
   * Return the dot product of vectors `v1, v2`.
   * Note: if you want to compute a norm squared, use `vnormsq` instead, it generates a smaller computational graph
   */
  vdot: (v1: VarAD[], v2: VarAD[]): VarAD => {
    if (v1.length !== v2.length) {
      throw Error("expected vectors of same length");
    }

    const res = _.zipWith(v1, v2, mul);
    return _.reduce(res, (x, y) => add(x, y, true), variableAD(0.0));
  },

  /**
   * Return the sum of elements in vector `v`.
   */
  vsum: (v: VarAD[]): VarAD => {
    return _.reduce(v, (x, y) => add(x, y, true), variableAD(0.0));
  },

  /**
   * Return `v + c * u`.
   */
  vmove: (v: VarAD[], c: VarAD, u: VarAD[]) => {
    return ops.vadd(v, ops.vmul(c, u));
  },

    /**
     * Rotate a 2D point `[x, y]` by 90 degrees clockwise.
     */
    rot90: ([x, y]: VarAD[]): VarAD[] => {
        return [neg(y), x];
    },

    /**
     * Return 2D determinant/cross product of 2D vectors
     */
    cross2: (v: VarAD[], w: VarAD[]): VarAD => {
        if (v.length !== 2 || w.length !== 2) { throw Error("expected two 2-vectors"); }
        return sub(mul(v[0], w[1]), mul(v[1], w[0]));
    },

    /**
     * Return the angle between two 2D vectors `v` and `w` in radians.
     * From https://github.com/thi-ng/umbrella/blob/develop/packages/vectors/src/angle-between.ts#L11
     * NOTE: This function has not been thoroughly tested
     */
    angleBetween2: (v: VarAD[], w: VarAD[]): VarAD => {
        if (v.length !== 2 || w.length !== 2) { throw Error("expected two 2-vectors"); }
        const t = atan2(ops.cross2(v, w), ops.vdot(v, w));
        return t;
    },
};

export const fns = {
  /**
   * Return the penalty `max(x, 0)`.
   */
  toPenalty: (x: VarAD): VarAD => {
    return squared(max(x, variableAD(0.0)));
  },

  /**
   * Return the center of a shape.
   */
  center: (props: any): VarAD[] => {
    return props.center.contents;
  },
};

// ----- Codegen

// Traverses the computational graph of ops obtained by interpreting the energy function, and generates code corresponding to just the ops (in plain js), which is then turned into an evaluable js function via the Function constructor

// Example of constructing an n-ary function by calling the Function constructor: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function

// const args = ["x0", "x1", "x2"];
// const inputs = [0, 1, 2];
// const f = new Function(...args, 'return x0 + x1 + x2');
// log.trace(f(...inputs));

// (Returns `3`)

// Wrapper since energy only has one output

const noWeight: MaybeVal<VarAD> = { tag: "Nothing" };

const genEnergyFn = (xs: VarAD[], z: IVarAD, weight: MaybeVal<VarAD>): any =>
  genCode(xs, [z], "energy", weight);

// Generate code for multi-output function, given its computational graph and a setting for its outputs
// NOTE: Generates a function that expects inputs to be passed in the same order as here, and the inputs should be sorted by their index
// NOTE: Modifies the input computational graph `outputs` to set and clear visited nodes
const genCode = (
  inputs: VarAD[],
  outputs: IVarAD[],
  setting: string,
  weightNode: MaybeVal<VarAD>
): any => {
  let counter = 0;
  let progInputs: string[] = [];
  let progStmts: string[] = [];
  let progOutputs: string[] = [];

  log.trace(
    "genCode inputs, outputs, weightNode, setting",
    inputs,
    outputs,
    weightNode,
    setting
  );

  let inputsNew;
  log.trace("has weight?", weightNode.tag === "Just");
  if (weightNode.tag === "Nothing") {
    inputsNew = inputs;
  } else {
    inputsNew = [weightNode.contents].concat(inputs);
  }

  // Just traverse + name the inputs first (they have no children, so the traversal stops there), then work backward from the outputs
  // The inputs are the EP weight + original xsVars (if it's energy) or just the xsVars (if it's gradient)
  for (const x of inputsNew) {
    const res = traverseGraph(counter, x, setting);

    if (res.inputs.length !== 1) {
      throw Error("expected one input from an input var traversal");
    }
    progInputs = progInputs.concat(res.inputs.map((e: any) => e.name));
    progStmts = progStmts.concat(res.prog);
    progOutputs = progOutputs.concat(res.output);

    // For any code generated for the next output, start on fresh index
    counter = res.counter + 1;
  }

  // For each output, traverse the graph and combine the results sequentially
  for (const z of outputs) {
    const res = traverseGraph(counter, z, setting);
    progStmts = progStmts.concat(res.prog);
    progOutputs = progOutputs.concat(res.output);

    // For any code generated for the next output, start on fresh index
    counter = res.counter + 1;

    // log.trace("output node traversed", z);
    // log.trace("res stmts", res.prog);
    // log.trace("res output", res.output);
  }

  let returnStmt = "";

  if (setting === "energy") {
    // Return single scalar
    if (!progOutputs || !progOutputs[0]) {
      throw Error("not enough energy outputs -- need exactly 1");
    }
    returnStmt = `return ${progOutputs[0]};`;
  } else if (setting === "grad") {
    // Return list of scalars
    const outputNamesStr = progOutputs.join(", ");
    returnStmt = `return [${outputNamesStr}];`;
  }

  const progStr = progStmts.concat([returnStmt]).join("\n");
  // log.trace("progInputs", "progStr", progInputs, progStr);

  const f = new Function(...progInputs, progStr);
  log.trace("generated f with setting =", setting, "\n", f);

  let g;
  if (weightNode.tag === "Nothing") {
    // So you can call the function without spread
    // hasWeight is for "normal" functions that aren't wrapped in the EP cycle (such as the symbolic gradient unit tests)
    g = (xs: number[]) => f(...xs);
  } else {
    // Curry the function so it can be partially applied with the EP weight later, without regenerating the function
    g = (weight: number[]) => {
      return (xs: number[]) => {
        const xs2 = [weight].concat(xs);
        return f(...xs2);
      };
    };
  }
  log.trace("overall function generated (g):", g);

  for (const x of inputsNew) {
    clearVisitedNodesInput(x);
  }

  for (const z of outputs) {
    clearVisitedNodesOutput(z);
  }

  return g;
};

// NOTE: Mutates z to store that the node was visited, and what its name is
// `i` is the counter, the initial parameter for generating var names
// `i` starts with 0 for the frst call, children name themselves with the passed-in index (so you know the child's name) and pass their counter back up. Parents do the work of incrementing
const traverseGraph = (i: number, z: IVarAD, setting: string): any => {
  const c = "x"; // Base character for var names
  const childType = z.isCompNode ? "children" : "childrenGrad";

  // If this node was already visited, return its name (cached), and counter should not increment
  if (z.nodeVisited) {
    return {
      counter: i,
      prog: [],
      inputs: [],
      output: [],
      references: [z.name],
    };
  }

  // Parents do the work of incrementing
  if (z[childType].length === 0) {
    const leafName = c + String(i);

    // Mark node as visited, with its name as reference for its computed/cached value
    z.nodeVisited = true;
    z.name = leafName;

    // Distinguish between inputs and constants
    if (z.isInput) {
      // Just return self name for function binding
      return {
        counter: i,
        prog: [],
        inputs: [{ name: leafName, index: z.index }],
        output: [],
        references: [],
      };
    }

    const stmts = [];
    let stmt;
    // Otherwise bind const in body
    if (z.op === "noGrad") {
      stmt = `const ${leafName} = 0.0; // No grad`;
    } else {
      stmt = `const ${leafName} = ${z.op};`;
    }

    stmts.push(stmt);

    if (z.debug) {
      const stmt2 = `console.log("${z.debugInfo} (var ${leafName}) | value: ", ${leafName}, "during ${setting} evaluation");`;
      stmts.push(stmt2);
    }

    return {
      counter: i,
      prog: stmts,
      inputs: [],
      output: leafName,
      references: [],
    };
  } else if (z[childType].length === 1) {
    // Unary op
    // debugger;

    const child = z[childType][0].node;
    const res = traverseGraph(i, child, setting);

    let childName;
    let parCounter;
    if (res.references[0]) {
      // Just refer to child if the node was already visited
      // And don't increment counter, since we just looked up a reference, didn't make a new child node
      childName = res.references[0];
      parCounter = res.counter;
    } else {
      childName = c + String(res.counter);
      parCounter = res.counter + 1;
    }

    const parName = c + String(parCounter);

    // Mark node as visited with name as reference
    z.nodeVisited = true;
    z.name = parName;

    const op = z.op;

    const stmts = [];
    let stmt;

    if (z.op === "squared") {
      stmt = `const ${parName} = ${childName} * ${childName};`;
    } else if (z.op === "sqrt") {
      stmt = `const ${parName} = Math.sqrt(${childName});`;
    } else if (z.op === "sin") {
      stmt = `const ${parName} = Math.sin(${childName});`;
    } else if (z.op === "cos") {
      stmt = `const ${parName} = Math.cos(${childName});`;
    } else if (z.op === "+ list") {
      // TODO: Get rid of unary +
      stmt = `const ${parName} = ${childName};`;
    } else if (z.op === "inverse") {
      stmt = `const ${parName} = 1.0 / (${childName} + ${EPS_DENOM});`;
    } else if (z.op === "- (unary)") {
      stmt = `const ${parName} = -${childName};`;
    } else if (z.op === "abs") {
      stmt = `const ${parName} = Math.abs(${childName});`;
    } else {
      stmt = `const ${parName} = (${op})(${childName});`;
    }

    stmts.push(stmt);

    if (z.debug) {
      const stmt2 = `console.log("${z.debugInfo} (var ${parName}) | value: ", ${parName}, "during ${setting} evaluation");`;
      stmts.push(stmt2);
    }

    return {
      counter: parCounter,
      prog: res.prog.concat(stmts),
      inputs: res.inputs,
      output: parName,
      references: [],
    };
  } else if (z[childType].length === 2) {
    // Binary op
    // TODO: refactor repeated code below into the for loop as in ternary
    const child0 = z[childType][0].node;
    const child1 = z[childType][1].node;

    const res0 = traverseGraph(i, child0, setting);
    let childName0;
    let nextCounter;
    if (res0.references[0]) {
      childName0 = res0.references[0];
      nextCounter = res0.counter;
    } else {
      childName0 = c + String(res0.counter);
      nextCounter = res0.counter + 1;
    }

    const res1 = traverseGraph(nextCounter, child1, setting);
    let childName1;
    let parCounter;
    if (res1.references[0]) {
      // Just refer to child if the node was already visited
      childName1 = res1.references[0];
      parCounter = res1.counter;
    } else {
      childName1 = c + String(res1.counter);
      parCounter = res1.counter + 1;
    }

    const parName = c + String(parCounter);

    // Mark node as visited with name as reference
    z.nodeVisited = true;
    z.name = parName;

    const op = z.op;
    const stmts = [];
    let stmt;
    if (op === "max") {
      stmt = `const ${parName} = Math.max(${childName0}, ${childName1});`;
    } else if (op === "min") {
      stmt = `const ${parName} = Math.min(${childName0}, ${childName1});`;
    } else if (z.op === "gt") {
      stmt = `const ${parName} = ${childName0} > ${childName1};`;
    } else if (z.op === "lt") {
      stmt = `const ${parName} = ${childName0} < ${childName1};`;
    } else if (z.op === "and") {
      stmt = `const ${parName} = ${childName0} && ${childName1};`;
    } else if (z.op === "or") {
      stmt = `const ${parName} = ${childName0} || ${childName1};`;
    } else if (z.op === "eq") {
      stmt = `const ${parName} = ${childName0} === ${childName1};`;
    } else if (z.op === "+ list") {
      stmt = `const ${parName} = ${childName0} + ${childName1};`;
    } else if (z.op === "div") {
      stmt = `const ${parName} = ${childName0} / (${childName1} + ${EPS_DENOM});`;
    } else if (z.op === "atan2") {
      stmt = `const ${parName} = Math.atan2(${childName0}, ${childName1});`;
    } else {
      stmt = `const ${parName} = ${childName0} ${op} ${childName1};`;
    }

    stmts.push(stmt);

    if (z.debug) {
      const stmt2 = `console.log("${z.debugInfo} (var ${parName}) | value: ", ${parName}, "during ${setting} evaluation");`;
      stmts.push(stmt2);
    }

    // Array efficiency?
    return {
      counter: parCounter,
      prog: res0.prog.concat(res1.prog).concat(stmts),
      inputs: res0.inputs.concat(res1.inputs),
      output: parName,
      references: [],
    };
  } else {
    // N-ary node
    const childNodes = z[childType].map((e) => e.node);

    const childNames = [];
    let prog: string[] = [];
    let inputs: string[] = [];
    let counter = i;

    // Evaluate each child and get its generated code, inputs, and name first
    for (const childNode of childNodes) {
      const res = traverseGraph(counter, childNode, setting);
      prog = prog.concat(res.prog);
      inputs = inputs.concat(res.inputs);

      // Child was already visited; don't generate code again, just a reference
      if (res.references[0]) {
        childNames.push(res.references[0]);
        counter = res.counter;
      } else {
        childNames.push(c + String(res.counter));
        counter = res.counter + 1;
      }
    }

    const parName = c + String(counter);

    // Mark node as visited with name as reference
    // TODO: factor out these 2 lines from all cases
    z.nodeVisited = true;
    z.name = parName;

    const op = z.op;
    const stmts = [];
    let stmt;

    // Deals with ifCond nodes (ternary)
    // (eval c; eval d; eval e; const xNUM = c ? d : e;)
    // codegen doesn't short-circuit -- it generates code for both branches of the `if` first
    // TODO: Fix this so it doesn't *evaluate* both branches of the `if`, just the one that's relevant to the condition

    if (op === "ifCond") {
      if (childNames.length !== 3) {
        log.trace("args", childNames);
        throw Error("expected three args to if cond");
      }

      stmt = `const ${parName} = ${childNames[0]} ? ${childNames[1]} : ${childNames[2]};`;
    } else if (op === "+ list") {
      const childList = "[".concat(childNames.join(", ")).concat("]");
      stmt = `const ${parName} = ${childList}.reduce((x, y) => x + y);`;
    } else {
      log.trace("node", z, z.op);
      throw Error("unknown n-ary operation");
    }

    stmts.push(stmt);

    // TODO: Factor out this code, which is repeated 3 times
    if (z.debug) {
      const stmt2 = `console.log("${z.debugInfo} (var ${parName}) | value: ", ${parName}, "during ${setting} evaluation");`;
      stmts.push(stmt2);
    }

    return {
      counter,
      prog: prog.concat(stmts),
      inputs,
      output: parName,
      references: [],
    };
  }
};

// Use this function after synthesizing an energy function, if you want to synthesize the gradient as well, since they both rely on mutating the computational graph to mark the visited nodes and their generated names
// Top-down
const clearVisitedNodesOutput = (z: VarAD) => {
  z.nodeVisited = false;
  // z.name = "";
  z.children.forEach((e) => clearVisitedNodesOutput(e.node));
  z.childrenGrad.forEach((e) => clearVisitedNodesOutput(e.node));
  // NOTE: This does NOT clear it for z.childrenGrad
};

// Bottom-up
const clearVisitedNodesInput = (x: VarAD) => {
  x.nodeVisited = false;
  // x.name = "";
  x.parents.forEach((e) => clearVisitedNodesInput(e.node));
  x.parentsGrad.forEach((e) => clearVisitedNodesInput(e.node));
};

// Mutates z (top node) to clear all vals and gradients of its children
// NOTE that this will zero all the nodes in the graph, including the leaves (such as the stepEP parameters)
const clearGraphTopDown = (z: VarAD) => {
  z.val = 0;
  z.valDone = false; // This is necessary so we can cache energy values in comp graph
  z.gradVal = { tag: "Nothing" };
  z.children.forEach((e) => clearGraphTopDown(e.node));
};

const clearGraphBottomUp = (xs: VarAD[]) => {
  xs.forEach((x) => {
    x.val = 0;
    x.valDone = false; // This is necessary so we can cache energy values in comp graph
    x.gradVal = { tag: "Nothing" };
    clearGraphBottomUp(x.parents.map((p) => p.node));
  });
};

// Mutates xsVars (leaf nodes) to set their values to the inputs in xs (and name them accordingly by value)
// NOTE: the xsVars should already have been set as inputs via makeAdInputVars
// NOTE: implicitly, the orders of the values need to match the order of variables
const setInputs = (xsVars: VarAD[], xs: number[]) => {
  xsVars.forEach((v, i) => {
    const val = xs[i];
    v.val = val;
    v.op = String(val);
  });
};

// Mutates graph (defined by z, the head) to evaluate the comp graph from top down, setting all values in children (intermediate node). Returns energy.
// We have to do this in the graph, not the compiled energy, because we need the values of the intermediate nodes to compute the gradient.
// NOTE: This function is basically unused in our system; it's just for demonstration, to show how the computational graph can be dynamically evaluated. In practice, though, we compile the graph into code and run that.

const evalEnergyOnGraph = (z: VarAD) => {
  // Catch leaf nodes first, or nodes whose values have already been computed and set
  // TODO: Make this code more generic/neater over the # children
  if (z.valDone || !z.children || !z.children.length) {
    if (DEBUG_ENERGY) {
      log.trace("z.result", z.val);
    }
    return z.val;
  }

  const zFn = opMap[z.op].fn;

  // TODO: Fix how leaf nodes are stored as numbers, not strings (for the second check)
  // TODO: Check that leaf nodes (numbers) don't have children (this also fails if the leaf val is 0...)
  if (!zFn && !Number(z.op)) throw Error(`invalid op ${z.op}`);

  if (z.children.length === 1) {
    const childVal = evalEnergyOnGraph(z.children[0].node);
    const res = zFn(childVal);
    z.val = res;
    z.valDone = true;

    if (DEBUG_ENERGY) {
      log.trace("z result:", z.op, childVal, "=", z.val);
    }
    return z.val;
  } else if (z.children.length === 2) {
    const childVal0 = evalEnergyOnGraph(z.children[0].node);
    const childVal1 = evalEnergyOnGraph(z.children[1].node);
    const res = zFn(childVal0, childVal1);
    z.val = res;
    z.valDone = true;

    if (DEBUG_ENERGY) {
      log.trace("z result:", z.op, childVal0, childVal1, "=", z.val);
    }
    return z.val;
  } else throw Error(`invalid # children: ${z.children.length}`);
};

const setWeights = (info: WeightInfo) => {
  info.constrWeightNode.val = info.constrWeight;
  info.constrWeightNode.op = String(info.constrWeight);

  info.epWeightNode.val = info.epWeight;
  info.epWeightNode.op = String(info.epWeight);
};

// Given an energyGraph of f, clears the graph and returns the compiled energy and gradient of f as functions
// xsVars are the leaves, energyGraph is the topmost parent of the computational graph
export const energyAndGradCompiled = (
  xs: number[],
  xsVars: VarAD[],
  energyGraph: VarAD,
  weightInfo: MaybeVal<WeightInfo>,
  debug = false
) => {
  // Zero xsvars vals, gradients, and caching setting
  clearGraphBottomUp(xsVars);
  clearVisitedNodesOutput(energyGraph);

  // Set the weight nodes to have the right weight values (may have been updated at some point during the opt)
  if (weightInfo.tag === "Just") {
    setWeights(weightInfo.contents);
  }

  // Set the leaves of the graph to have the new input values
  setInputs(xsVars, xs);

  // Build symbolic gradient of f at xs on the energy graph
  // Note that this does NOT include the weight (i.e. is called on `xsVars`, not `xsVarsWithWeight`! Because the EP weight is not a degree of freedom)
  const gradGraph = gradAllSymbolic(energyGraph, xsVars);

  const epWeightNode: MaybeVal<VarAD> =
    weightInfo.tag === "Just"
      ? just(weightInfo.contents.epWeightNode)
      : { tag: "Nothing" }; // Generate energy and gradient without weight

  const graphs: GradGraphs = {
    inputs: xsVars,
    energyOutput: energyGraph,
    gradOutputs: gradGraph,
    weight: epWeightNode,
  };

  // Synthesize energy and gradient code
  const f0 = genEnergyFn(graphs.inputs, graphs.energyOutput, graphs.weight);
  const gradGen = genCode(
    graphs.inputs,
    graphs.gradOutputs,
    "grad",
    graphs.weight
  );

  if (DEBUG_GRADIENT_UNIT_TESTS) {
    log.trace("Running gradient unit tests", graphs);
    testGradSymbolicAll();
    // throw Error("done with gradient unit tests");
  }

  if (DEBUG_GRADIENT) {
    log.trace("Testing real gradient on these graphs", graphs);
    testGradSymbolic(0, graphs);
    // throw Error("done with testGradSymbolic");
  }

  // Return the energy and grad on the input, as well as updated energy graph
  return {
    graphs,
    f: f0,
    gradf: gradGen,
  };
};

// ----- Functions for testing numeric and symbolic gradients

const assert = (b: boolean, s: any[]) => {
  const res = b ? "passed" : "failed";
  if (PRINT_TEST_RESULTS) {
    // console.assert(b);
    log.trace("Assertion", res, ": ", ...s);
  }
  return b;
};

const testGradFiniteDiff = () => {
  // Only tests with hardcoded functions
  const f = (ys: number[]) => _.sum(_.map(ys, (e: number) => e * e));
  const df = (ys: number[]) => _.map(ys, (e: number) => 2 * e);

  const testResults = [];

  for (let i = 0; i < NUM_SAMPLES; i++) {
    const xs = randList(4);
    const gradEstRes = gradFiniteDiff(f)(xs);
    const expectedRes = df(xs);
    const testRes = assert(eqList(gradEstRes, expectedRes), [
      "test grad finite diff (grad res, expected res)",
      gradEstRes,
      expectedRes,
    ]);
    testResults.push(testRes);
  }

  const testOverall = assert(all(testResults), [
    "all tests passed? test results:",
    testResults,
  ]);
};

// Given a graph with schema: { inputs: VarAD[], output: VarAD, gradOutputs: VarAD }
// Compile the gradient and check it against numeric gradients
// TODO: Currently the tests will "fail" if the magnitude is greater than `eqList`'s sensitivity. Fix this.
const testGradSymbolic = (testNum: number, graphs: GradGraphs): boolean => {
  log.trace(`======= START TEST GRAD SYMBOLIC ${testNum} ======`);

  log.trace("head node (energy output)", graphs.energyOutput);
  log.trace("inputs", graphs.inputs);
  log.trace("grad node(s)", graphs.gradOutputs);

  // Synthesize energy and gradient code
  const f0 = genEnergyFn(graphs.inputs, graphs.energyOutput, graphs.weight);
  const gradGen0 = genCode(
    graphs.inputs,
    graphs.gradOutputs,
    "grad",
    graphs.weight
  );

  const weight = 1; // TODO: Test with several weights
  let f;
  let gradGen;
  log.trace("testGradSymbolic has weight?", graphs.weight);

  if (graphs.weight.tag === "Just") {
    // Partially apply with weight
    f = f0(weight);
    gradGen = gradGen0(weight);
  } else {
    f = f0;
    gradGen = gradGen0;
  }

  // Test the gradient at several points via evaluation
  const gradEst = gradFiniteDiff(f);
  const testResults = [];

  for (let i = 0; i < NUM_SAMPLES; i++) {
    const xsTest = randList(graphs.inputs.length);
    const energyRes = f(xsTest);
    const gradEstRes = gradEst(xsTest);
    const gradGenRes = gradGen(xsTest);

    log.trace("----");
    log.trace("test", i);
    log.trace("energy at x", xsTest, "=", energyRes);
    log.trace("estimated gradient at", xsTest, "=", gradEstRes);
    log.trace("analytic gradient at", xsTest, "=", gradGenRes);

    const testRes = assert(eqList(gradEstRes, gradGenRes), [
      "estimated, analytic gradients:",
      gradEstRes,
      gradGenRes,
    ]);
    testResults.push(testRes);
  }

  const testOverall = assert(all(testResults), [
    "all tests passed? test results:",
    testResults,
  ]);

  // TODO: Visualize both of them
  log.trace(`======= DONE WITH TEST GRAD SYMBOLIC ${testNum} ======`);

  return testOverall;
};

const gradGraph0 = (): GradGraphs => {
  // Build energy graph

  // f(x) = x^2, where x is 100
  // Result: (2 * 100) * 1 <-- this comes from the (new) parent node, dx/dx = 1
  const ref = markInput(variableAD(100.0), 0); // TODO: Should use makeADInputVars
  const head = squared(ref);

  // Build gradient graph
  head.gradNode = { tag: "Just", contents: gvarOf(1.0) };
  const dRef = gradADSymbolic(ref);

  // Print results
  log.trace(
    "computational graphs for test 1 (input, output, gradient)",
    ref,
    head,
    dRef
  );

  return {
    inputs: [ref],
    energyOutput: head,
    gradOutputs: [dRef],
    weight: { tag: "Nothing" },
  };
};

// See codegen-results.md for description
const gradGraph1 = (): GradGraphs => {
  // Build energy graph
  const x0 = markInput(variableAD(-5.0), 0);
  const x1 = markInput(variableAD(6.0), 1);
  const a = sub(x0, x1);
  const b = squared(a);
  const c = sin(a);
  // const c = add(a, variableAD(3.0)); // const?
  const z = mul(b, c);

  // Build gradient graph
  z.gradNode = { tag: "Just", contents: gvarOf(1.0) };
  const dx0 = gradADSymbolic(x0);
  const dx1 = gradADSymbolic(x1);

  return {
    inputs: [x0, x1],
    energyOutput: z,
    gradOutputs: [dx0, dx1],
    weight: { tag: "Nothing" },
  };
};

// Test addition of consts to graph (`c`)
const gradGraph2 = (): GradGraphs => {
  // Build energy graph
  const x0 = markInput(variableAD(-5.0), 0);
  const x1 = markInput(variableAD(6.0), 1);
  const a = sub(x0, x1);
  const b = squared(a);
  const c = add(a, variableAD(3.0));
  const z = mul(b, c);

  // Build gradient graph
  z.gradNode = { tag: "Just", contents: gvarOf(1.0) };
  const dx0 = gradADSymbolic(x0);
  const dx1 = gradADSymbolic(x1);

  return {
    inputs: [x0, x1],
    energyOutput: z,
    gradOutputs: [dx0, dx1],
    weight: { tag: "Nothing" },
  };
};

// Test vars w/ no grad
const gradGraph3 = (): GradGraphs => {
  // Build energy graph

  const x0 = markInput(variableAD(100.0), 0);
  const x1 = markInput(variableAD(-100.0), 0);
  const inputs = [x0, x1];
  const head = squared(x0);

  // Build gradient graph
  const dxs = gradAllSymbolic(head, inputs);

  return {
    inputs,
    energyOutput: head,
    gradOutputs: dxs,
    weight: { tag: "Nothing" },
  };
};

// Test toPenalty
const gradGraph4 = (): GradGraphs => {
  // Build energy graph

  const x0 = markInput(variableAD(100.0), 0);
  const inputs = [x0];
  const head = fns.toPenalty(x0);

  // Build gradient graph
  const dxs = gradAllSymbolic(head, inputs);

  return {
    inputs,
    energyOutput: head,
    gradOutputs: dxs,
    weight: { tag: "Nothing" },
  };
};

// Test ifCond
const gradGraph5 = (): GradGraphs => {
  // Build energy graph
  log.info("test ifCond");
  const [tru, fals] = [constOf(500), constOf(-500)];

  const x0 = markInput(variableAD(100.0), 0);
  const x1 = markInput(variableAD(-100.0), 0);
  const inputs = [x0, x1];

  const head = ifCond(lt(x0, constOf(33)), squared(x1), squared(x0));

  // Build gradient graph
  const dxs = gradAllSymbolic(head, inputs);

  return {
    inputs,
    energyOutput: head,
    gradOutputs: dxs,
    weight: { tag: "Nothing" },
  };
};

// Test max
const gradGraph6 = (): GradGraphs => {
  // Build energy graph
  log.info("test max");

  const x0 = markInput(variableAD(100.0), 0);
  const inputs = [x0];
  const head = max(squared(x0), constOf(0));

  // Build gradient graph
  const dxs = gradAllSymbolic(head, inputs);

  return {
    inputs,
    energyOutput: head,
    gradOutputs: dxs,
    weight: { tag: "Nothing" },
  };
};

// Test div
// TODO < Test all ops automatically
const gradGraph7 = (): GradGraphs => {
  // Build energy graph
  log.info("test div");

  const x0 = markInput(variableAD(100.0), 0);
  const x1 = markInput(variableAD(-100.0), 0);
  const inputs = [x0, x1];
  const head = div(x0, x1);

  // Build gradient graph
  const dxs = gradAllSymbolic(head, inputs);

  return {
    inputs,
    energyOutput: head,
    gradOutputs: dxs,
    weight: { tag: "Nothing" },
  };
};

export const testGradSymbolicAll = () => {
  log.trace("testing symbolic gradients");

  testGradFiniteDiff();

  const graphs: GradGraphs[] = [
    gradGraph0(),
    gradGraph1(),
    gradGraph2(),
    gradGraph3(),
    gradGraph4(),
    gradGraph5(),
    gradGraph6(),
    gradGraph7(),
  ];

  const testResults = graphs.map((graph, i) => testGradSymbolic(i, graph));

  log.trace(`All grad symbolic tests passed?: ${all(testResults)}`);
};
