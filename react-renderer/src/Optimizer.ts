import * as tf from "@tensorflow/tfjs";
import {
  Tensor,
  stack,
  scalar,
  Variable,
  Scalar,
  // maximum,
} from "@tensorflow/tfjs";
import {
  argValue,
  evalTranslation,
  insertVaryings,
  genVaryMap,
  evalFns,
} from "./Evaluator";
// import { zip } from "lodash";
import * as _ from "lodash";
import {
  constrDict,
  objDict,
  energyHardcoded,
  gradfHardcoded,
  normList,
  makeADInputVars,
  // energyAndGradADHardcoded,
  energyAndGradAD,
  energyAndGradDynamic,
  variableAD,
  isCustom,
  ops,
  add,
  mul
} from "./Constraints";

////////////////////////////////////////////////////////////////////////////////
// Globals

// growth factor for constraint weights
const weightGrowthFactor = 10;
// weight for constraints
const constraintWeight = 10e4; // HACK: constant constraint weight
// Intial weight for constraints
const initConstraintWeight = 10e-3;
// learning rate for the tfjs optimizer
// const learningRate = 50; // TODO: Behaves terribly with tree.sub / tree.sty
const learningRate = 30;
const optimizer = tf.train.adam(learningRate, 0.9, 0.999);
// EP method convergence criteria
const epStop = 1e-3;
// const epStop = 1e-5;

// Unconstrained method convergence criteria
// TODO. This should REALLY be 10e-10
const uoStop = 1e-2;
// const uoStop = 1e-5;
// const uoStop = 10;

////////////////////////////////////////////////////////////////////////////////

// TODO. These checks should really just be on numbers now

const toPenalty = (x: Tensor): Tensor => {
  return tf.pow(tf.maximum(x, tf.scalar(0)), tf.scalar(2));
};

const epConverged = (x0: Tensor, x1: Tensor, fx0: Scalar, fx1: Scalar): boolean => {
  // TODO: These dx and dfx should really be scaled to account for magnitudes
  const stateChange = sc(x1.sub(x0).norm());
  const energyChange = sc(tf.abs(fx1.sub(fx0)));
  console.log("epConverged?: stateChange: ", stateChange, " | energyChange: ", energyChange);

  return stateChange < epStop || energyChange < epStop;
}

const unconstrainedConverged = (normGrad: Scalar): boolean => {
  console.log("UO convergence check: ||grad f(x)||", scalarValue(normGrad));
  return scalarValue(normGrad) < uoStop;
};

const unconstrainedConverged2 = (normGrad: number): boolean => {
  console.log("UO convergence check: ||grad f(x)||", normGrad);
  return normGrad < uoStop;
};

const epConverged2 = (xs0: number[], xs1: number[], fxs0: number, fxs1: number): boolean => {
  // TODO: These dx and dfx should really be scaled to account for magnitudes
  const stateChange = normList(vecSub(xs1, xs0));
  const energyChange = Math.abs(fxs1 - fxs0);
  console.log("epConverged?: stateChange: ", stateChange, " | energyChange: ", energyChange);

  return stateChange < epStop || energyChange < epStop;
}

const applyFn = (f: FnDone<DiffVar>, dict: any) => {
  if (dict[f.name]) {
    return dict[f.name](...f.args.map(argValue));
  } else {
    throw new Error(
      `constraint or objective ${f.name} not found in dirctionary`
    );
  }
};

/**
 * Given a `State`, take n steps by evaluating the overall objective function
 *
 * @param {State} state
 * @param {number} steps
 * @returns
 */

// TODO. Annotate the return type: a new (copied?) state with the varyingState and opt params set?

// NOTE: `stepEP` implements the exterior point method as described here: 
// https://www.me.utexas.edu/~jensen/ORMM/supplements/units/nlp_methods/const_opt.pdf (p7)

// Things that we should do programmatically improve the conditioning of the objective function:
// 1) scale the constraints so that the penalty generated by each is about the same magnitude
// 2) fix initial value of the penalty parameter so that the magnitude of the penalty term is not much smaller than the magnitude of objective function

export const stepEP = (state: State, steps: number, evaluate = true) => {
  // TODO. Maybe factor this back out into `State -> (VaryingState, OptParams)`?
  const { optStatus, weight } = state.params;
  let newState = { ...state };
  const optParams = newState.params; // this is just a reference, so updating this will update newState as well
  const xs: DiffVar[] = optParams.mutableUOstate; // also a reference

  console.log("step EP | weight: ", weight, "| EP round: ", optParams.EPround, " | UO round: ", optParams.UOround);
  console.log("params: ", optParams);
  console.log("state: ", state);
  console.log("fns: ", prettyPrintFns(state));
  console.log("variables: ", state.varyingPaths.map(p => prettyPrintProperty(p)));

  switch (optStatus.tag) {
    case "NewIter": {
      // Collect the overall objective and varying values
      const overallObjective = evalEnergyOn(state, false); // TODO. Why is this being generated here?

      const newParams: Params = {
        ...state.params,
        mutableUOstate: state.varyingValues.map(differentiable),
        weight: initConstraintWeight,
        UOround: 0,
        EPround: 0,
        optStatus: { tag: "UnconstrainedRunning" },
      };
      // TODO. set `bfgsInfo: defaultBfgsParams`

      return { ...state, params: newParams, overallObjective };
    }

    case "UnconstrainedRunning": {
      // NOTE: use cached varying values
      // TODO. we should be using `varyingValues` below in place of `xs`, not the `xs` from optStatus
      // (basically use the last UO state, not last EP state)

      const f = state.overallObjective;
      const fgrad = gradF(f, false);
      // NOTE: minimize will mutate xs
      const { energy, normGrad } = minimize(f, fgrad, xs, steps);

      // Copy the tensor for xs
      optParams.lastUOstate = tf.clone(tf.stack(xs));
      optParams.lastUOenergy = tf.clone(energy);
      optParams.UOround = optParams.UOround + 1;

      // NOTE: `varyingValues` is updated in `state` after each step by putting it into `newState` and passing it to `evalTranslation`, which returns another state

      // TODO. In the original optimizer, we cheat by using the EP cond here, because the UO cond is sometimes too strong.
      if (unconstrainedConverged(normGrad)) {
        optParams.optStatus.tag = "UnconstrainedConverged"; // TODO. reset bfgs params to default
        console.log("Unconstrained converged with energy", scalarValue(energy));
      } else {
        optParams.optStatus.tag = "UnconstrainedRunning";
        console.log(`Took ${steps} steps. Current energy`, scalarValue(energy));
      }

      break;
    }

    case "UnconstrainedConverged": {
      // No minimization step should be taken. Just figure out if we should start another UO round with higher EP weight.
      // We are using the last UO state and energy because they serve as the current EP state and energy, and comparing it to the last EP stuff.

      // Do EP convergence check on the last EP state (and its energy), and curr EP state (and its energy)
      // (There is no EP state or energy on the first round)
      // TODO. Make a diagram to clarify vocabulary
      console.log("case: unconstrained converged", optParams);

      // We force EP to run at least two rounds (State 0 -> State 1 -> State 2; the first check is only between States 1 and 2)
      if (optParams.EPround > 1 &&
        epConverged(optParams.lastEPstate, optParams.lastUOstate, optParams.lastEPenergy, optParams.lastUOenergy)) {

        optParams.optStatus.tag = "EPConverged";
        console.log("EP converged with energy", scalarValue(optParams.lastUOenergy));

      } else {
        // If EP has not converged, increase weight and continue.
        // The point is that, for the next round, the last converged UO state becomes both the last EP state and the initial state for the next round--starting with a harsher penalty.
        console.log("EP did not converge; starting next round");
        optParams.optStatus.tag = "UnconstrainedRunning";
        optParams.weight = weightGrowthFactor * weight;
        optParams.EPround = optParams.EPround + 1;
        optParams.UOround = 0;
      }

      // Done with EP check, so save the curr EP state as the last EP state for the future.
      optParams.lastEPstate = tf.clone(optParams.lastUOstate);
      optParams.lastEPenergy = tf.clone(optParams.lastUOenergy);

      break;
    }

    case "EPConverged": // do nothing if converged
      return state;
  }

  // return the state with a new set of shapes
  if (evaluate) {
    const varyingValues = xs.map((x) => scalarValue(x as Scalar));
    // console.log("evaluating state with varying values", varyingValues);
    // console.log("varyingMap", zip(state.varyingPaths, varyingValues) as [Path, number][]);

    newState.translation = insertVaryings(
      state.translation,
      _.zip(state.varyingPaths, varyingValues) as [Path, number][]
    );

    newState.varyingValues = varyingValues;
    newState = evalTranslation(newState);
  }

  return newState;
};

export const stepBasic = (state: State, steps: number, evaluate = true) => {
  console.log("stepBasic");
  const { optStatus, weight } = state.params;
  let newState = { ...state };
  const optParams = newState.params; // this is just a reference, so updating this will update newState as well
  let xs: number[] = state.varyingValues;

  console.log("step BASIC | weight: ", weight, "| EP round: ", optParams.EPround, " | UO round: ", optParams.UOround);
  console.log("params: ", optParams);
  // console.log("state: ", state);
  console.log("fns: ", prettyPrintFns(state));
  console.log("variables: ", state.varyingPaths.map(p => prettyPrintProperty(p)));

  switch (optStatus.tag) {
    case "NewIter": {
      console.log("stepBasic newIter, xs", xs);

      // `overallEnergy` is a partially applied function, waiting for an input. 
      // When applied, it will interpret the energy via lookups on the computational graph
      // TODO: Could save the interpreted energy graph across amples
      const overallObjective = evalEnergyOn(state, false);
      const xsVars: VarAD[] = makeADInputVars(xs);
      const energyGraph = overallObjective(...xsVars); // Note: `overallObjective` mutates `xsVars`
      // `energyGraph` is a VarAD that is a handle to the top of the graph

      console.log("interpreted energy graph", energyGraph);

      const newParams: Params = {
        ...state.params,
        mutableUOstate: xsVars, // TODO: Unused; remove
        xsVars,
        energyGraph,
        weight: initConstraintWeight,
        UOround: 0,
        EPround: 0,
        optStatus: { tag: "UnconstrainedRunning" },
      };

      return { ...state, params: newParams, overallObjective };
    }

    case "UnconstrainedRunning": {
      // NOTE: use cached varying values
      // TODO. we should be using `varyingValues` below in place of `xs`, not the `xs` from optStatus
      // (basically use the last UO state, not last EP state)
      console.log("stepBasic step, xs", xs);

      // TODO: Slowly port the rest of stepEP here
      const f = state.overallObjective; // TODO: Remove this if unused
      const xsVars = state.params.xsVars;
      const energyGraph = state.params.energyGraph;

      const res = minimizeBasic(f, xs, xsVars, energyGraph); // NOTE: mutates xsVars
      xs = res.xs;
      // the new `xs` is put into the `newState`, which is returned at end of function
      // we don't need the updated xsVars and energyGraph as they are always cleared on evaluation; only their structure matters
      const { energyVal, normGrad } = res;

      optParams._lastUOstate = xs;
      optParams._lastUOenergy = energyVal;
      optParams.UOround = optParams.UOround + 1;

      // NOTE: `varyingValues` is updated in `state` after each step by putting it into `newState` and passing it to `evalTranslation`, which returns another state

      // TODO. In the original optimizer, we cheat by using the EP cond here, because the UO cond is sometimes too strong.
      if (unconstrainedConverged2(normGrad)) {
        optParams.optStatus.tag = "UnconstrainedConverged"; // TODO. reset bfgs params to default
        console.log("Unconstrained converged with energy", energyVal);
      } else {
        optParams.optStatus.tag = "UnconstrainedRunning";
        console.log(`Took ${steps} steps. Current energy`, energyVal);
      }

      break;
    }

    case "UnconstrainedConverged": {
      // No minimization step should be taken. Just figure out if we should start another UO round with higher EP weight.
      // We are using the last UO state and energy because they serve as the current EP state and energy, and comparing it to the last EP stuff.

      // Do EP convergence check on the last EP state (and its energy), and curr EP state (and its energy)
      // (There is no EP state or energy on the first round)
      // TODO. Make a diagram to clarify vocabulary
      console.log("stepBasic: unconstrained converged", optParams);

      // We force EP to run at least two rounds (State 0 -> State 1 -> State 2; the first check is only between States 1 and 2)
      if (optParams.EPround > 1 &&
        epConverged2(optParams._lastEPstate, optParams._lastUOstate, optParams._lastEPenergy, optParams._lastUOenergy)) {

        optParams.optStatus.tag = "EPConverged";
        console.log("EP converged with energy", optParams._lastUOenergy);

      } else {
        // If EP has not converged, increase weight and continue.
        // The point is that, for the next round, the last converged UO state becomes both the last EP state and the initial state for the next round--starting with a harsher penalty.
        console.log("stepBasic: EP did not converge; starting next round");
        optParams.optStatus.tag = "UnconstrainedRunning";
        optParams.weight = weightGrowthFactor * weight;
        optParams.EPround = optParams.EPround + 1;
        optParams.UOround = 0;
      }

      // Done with EP check, so save the curr EP state as the last EP state for the future.
      optParams._lastEPstate = optParams._lastUOstate;
      optParams._lastEPenergy = optParams._lastUOenergy;

      break;
    }

    case "EPConverged": { // do nothing if converged
      console.log("stepBasic: EP converged");
      return state;
    }
  }

  // return the state with a new set of shapes
  if (evaluate) {
    const varyingValues = xs;
    // console.log("evaluating state with varying values", varyingValues);
    // console.log("varyingMap", zip(state.varyingPaths, varyingValues) as [Path, number][]);

    newState.translation = insertVaryings(
      state.translation,
      _.zip(state.varyingPaths, varyingValues) as [Path, number][]
    );

    newState.varyingValues = varyingValues;
    newState = evalTranslation(newState);
  }

  return newState;
};

const minimizeBasic = (
  f: (...arg: DiffVar[]) => DiffVar,
  xs: number[],
  xsVars: DiffVar[],
  energyGraph: VarAD
) => {
  console.log("minimizeBasic");
  // const numSteps = 1;
  const numSteps = 1000;
  // const numSteps = 10000; // Value for speed testing

  // (10,000 steps / 100ms) * (10 ms / s) = 100k steps/s (on this simple problem, with no line search, and not sure about mem use)
  // this is just a factor of 5 slowdown over the compiled energy function

  const t = 0.01;
  let xs2 = [...xs]; // Don't use xs
  let gradres = [...xs];
  let adRes = energyAndGradDynamic(xs2, xsVars, energyGraph);
  let i = 0;

  while (i < numSteps) {
    adRes = energyAndGradDynamic(xs2, xsVars, energyGraph, false);
    gradres = adRes.gradVal;
    // xs2' = xs2 - t * gradf(xs2)
    xs2 = xs2.map((x, j) => x - t * gradres[j]); // TODO: use vector op / is this access constant-time?
    i++;
  }

  const energyVal = adRes.energyVal;
  const normGrad = normList(gradres);

  console.log("f(x)");
  console.log("|grad f(x)|:", normGrad);

  return {
    xs: xs2,
    energyVal,
    normGrad
  };
};

// TODO: move these fns to utils
const prettyPrintExpr = (arg: any) => {
  // TODO: only handles paths for now; generalize to other exprs
  const obj = arg.contents.contents;
  const varName = obj[0].contents;
  const varField = obj[1];
  return [varName, varField].join(".");
};

const prettyPrintFn = (fn: any) => {
  const name = fn.fname;
  const args = fn.fargs.map(prettyPrintExpr).join(", ");
  return [name, "(", args, ")"].join("");
};

const prettyPrintFns = (state: any) => state.objFns.concat(state.constrFns).map(prettyPrintFn);

// TODO: only handles property paths for now
const prettyPrintProperty = (arg: any) => {
  const obj = arg.contents;
  const varName = obj[0].contents;
  const varField = obj[1];
  const property = obj[2];
  return [varName, varField, property].join(".");
};

/**
 * Generate an energy function from the current state
 *
 * @param {State} state
 * @returns a function that takes in a list of `DiffVar`s and return a `Scalar`
 */
export const evalEnergyOn = (state: State, inlined = false) => {
  // TODO: types
  return (...varyingValuesTF: DiffVar[]): DiffVar => {
    // TODO: Could this line be causing a memory leak?
    const { objFns, constrFns, translation, varyingPaths } = state;

    // construct a new varying map
    const varyingMap = genVaryMap(varyingPaths, varyingValuesTF) as VaryMap<DiffVar>;

    if (inlined) {
      console.log("returning inlined function for `tree-small.sub` and `venn-small.sub`");
      // TODO: Put inlined function here
      const res = stack(varyingValuesTF).sum();
      return res.mul(scalar(0));
    }

    // NOTE: This will mutate the var inputs
    const objEvaled = evalFns(objFns, translation, varyingMap);
    const constrEvaled = evalFns(constrFns, translation, varyingMap);

    const objEngs: DiffVar[] = objEvaled.map((o) => applyFn(o, objDict));
    // TODO: toPenalty needs to use the new ops
    const constrEngs: DiffVar[] = constrEvaled.map((c) => toPenalty(applyFn(c, constrDict)));

    // TODO: Note there are two energies, each of which does NOT know about its children, but the root nodes should now have parents up to the objfn energies. The computational graph can be seen in inspecting varyingValuesTF's parents
    // NOTE: The energies are in the val field of the results (w/o grads)
    // console.log("objEngs", objFns, objEngs);
    // console.log("vars", varyingValuesTF);

    if (isCustom(objEngs[0])) { // TODO make more robust to empty lists
      const objEng: VarAD = ops.vsum(objEngs);
      const constrEng: VarAD = ops.vsum(constrEngs);
      const overallEng: VarAD = add(objEng,
        mul(constrEng,
          variableAD(constraintWeight * state.params.weight)));

      // NOTE: This is necessary because we have to state the seed for the autodiff, which is the last output
      overallEng.gradVal = { tag: "Just", contents: 1.0 };
      // console.log("overall eng from custom AD", overallEng, overallEng.val);
      return overallEng;
    }

    const objEng2: Tensor =
      objEngs.length === 0 ? differentiable(0) : stack(objEngs).sum();
    const constrEng2: Tensor =
      constrEngs.length === 0 ? differentiable(0) : stack(constrEngs).sum();
    const overallEng2 = objEng2.add(
      constrEng2.mul(scalar(constraintWeight * state.params.weight))
    );

    // NOTE: the current version of tfjs requires all input variables to have gradients (i.e. actually involved when computing the overall energy). See https://github.com/tensorflow/tfjs-core/blob/8c2d9e05643988fa7f4575c30a5ad3e732d189b2/tfjs-core/src/engine.ts#L726
    // HACK: therefore, we try to work around it by using all varying values without affecting the value and gradients of the energy function
    const dummyVal = stack(varyingValuesTF).sum();
    return overallEng2.add(dummyVal.mul(scalar(0)));
  };
};

export const step = (state: State, steps: number) => {
  const f = evalEnergyOn(state);
  const fgrad = gradF(f);
  const xs = state.varyingValues.map(differentiable);
  // const xs = state.varyingState; // NOTE: use cached varying values
  // NOTE: minimize will mutates xs
  const { energy } = minimize(f, fgrad, xs, steps);
  // insert the resulting variables back into the translation for rendering
  // NOTE: this is a synchronous operation on all varying values; may block
  const varyingValues = xs.map((x) => scalarValue(x as Scalar));
  const trans = insertVaryings(
    state.translation,
    _.zip(state.varyingPaths, varyingValues) as [Path, number][]
  );
  const newState = { ...state, translation: trans, varyingValues };
  if (scalarValue(energy) > 10) {
    // const newState = { ...state, varyingState: xs };
    newState.params.optStatus.tag = "UnconstrainedRunning";
    console.log(`Took ${steps} steps. Current energy`, scalarValue(energy));
    // return newState;
  } else {
    // const varyingValues = xs.map((x) => tfStr(x));
    // const trans = insertVaryings(
    //   state.translation,
    //   zip(state.varyingPaths, varyingValues) as [Path, number][]
    // );
    // const newState = { ...state, translation: trans, varyingValues };
    newState.params.optStatus.tag = "EPConverged";
    console.log("Converged with energy", scalarValue(energy));
    // return evalTranslation(newState);
  }
  // return the state with a new set of shapes
  return evalTranslation(newState);
};

////////////////////////////////////////////////////////////////////////////////
// All TFjs related functions

export const gradF = (fn: any, inlined = false) => {
  if (inlined) {
    // gradf: (arg: Tensor[]) => Tensor[],
    // TODO: Where do I have access to the state?
    return (args: Scalar[]) => [tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0),
    tf.scalar(0.0)
    ];
  }

  return tf.grads(fn);
}

// TODO: types
export const sc = (x: any): number => x.dataSync()[0];
export const scalarValue = (x: Scalar): number => x.dataSync()[0];
export const tfsStr = (xs: any[]) => xs.map((e) => scalarValue(e));
export const differentiable = (e: number): Variable => tf.scalar(e).variable();
export const flatten = (t: Tensor): Tensor => tf.reshape(t, [-1]); // flattens something like Tensor [[1], [2], [3]] (3x1 tensor) into Tensor [1, 2, 3] (1x3)
export const flatten2 = (t: Tensor[]): Tensor => flatten(tf.stack(t));

export const unflatten = (t: Tensor): Tensor[] => tf.reshape(t, [t.size, 1]).unstack().map(e => e.asScalar());
// unflatten Tensor [1,2,3] (1x3) into [Tensor 1, Tensor 2, Tensor 3] (3x1) -- since this is the type that f and gradf require as input and output
// The problem is that our data representation assumes a Tensor of size zero (i.e. scalar(3) = Tensor 3), not of size 1 (i.e. Tensor [3])

// TODO. This should be ported to work on scalars
const awLineSearch = (
  f: (...arg: Tensor[]) => Scalar,
  gradf: (arg: Tensor[]) => Tensor[],
  xs: Tensor,
  gradfx: Tensor, // not nested
  maxSteps = 100
) => {

  // TODO: Do console logs with a debug flag

  const descentDir = tf.neg(gradfx); // TODO: THIS SHOULD BE PRECONDITIONED BY L-BFGS

  const fFlat = (ys: Tensor) => f(...unflatten(ys));
  const gradfxsFlat = (ys: Tensor) => flatten2(gradf(unflatten(ys)));

  const duf = (u: Tensor) => {
    return (ys: Tensor) => {
      const res = u.dot(gradfxsFlat(ys));
      // console.log("u,xs2", u.arraySync(), xs2.arraySync());
      // console.log("input", unflatten(xs2));
      // console.log("e", f(...unflatten(xs2)));
      // console.log("gu", gradf(unflatten(xs2)));
      // console.log("gu2", flatten2(gradf(unflatten(xs2))));
      return res;
    }
  };

  const dufDescent = duf(descentDir);
  const dufAtx0 = dufDescent(xs);
  const fAtx0 = fFlat(xs);
  const minInterval = 10e-10;

  // HS: duf, TS: dufDescent
  // HS: x0, TS: xs

  // Hyperparameters
  const c1 = 0.001; // Armijo
  const c2 = 0.9; // Wolfe
  // TODO: Will it cause precision issues to use both tf.scalar and `number`?

  // Armijo condition
  // f(x0 + t * descentDir) <= (f(x0) + c1 * t * <grad(f)(x0), x0>)
  // TODO: Check that these inner lines behave as expected with tf.js
  const armijo = (ti: number) => {
    // TODO: Use addStrict (etc.) everywhere?
    const cond1 = fFlat(xs.addStrict(descentDir.mul(ti)));
    const cond2 = fAtx0.add(dufAtx0.mul(ti * c1));
    // console.log("armijo", cond1.arraySync(), cond2.arraySync());
    return sc(tf.lessEqualStrict(cond1, cond2));
  };

  // D(u) := <grad f, u>
  // D(u, f, x) = <grad f(x), u>
  // u is the descentDir (i.e. -grad(f)(x))

  // Strong Wolfe condition
  // |<grad(f)(x0 + t * descentDir), u>| <= c2 * |<grad f(x0), u>|
  const strongWolfe = (ti: number) => {
    const cond1 = tf.abs(dufDescent(xs.addStrict(descentDir.mul(ti))));
    const cond2 = tf.abs(dufAtx0).mul(c2);
    return sc(tf.lessEqualStrict(cond1, cond2));
  };

  // Weak Wolfe condition
  // <grad(f)(x0 + t * descentDir), u> >= c2 * <grad f(x0), u>
  const weakWolfe = (ti: number) => {
    const cond1 = dufDescent(xs.addStrict(descentDir.mul(ti)));
    const cond2 = dufAtx0.mul(c2);
    // console.log("weakWolfe", cond1.arraySync(), cond2.arraySync());
    return sc(tf.greaterEqualStrict(cond1, cond2));
  };

  const wolfe = weakWolfe; // TODO: Set this if using strongWolfe instead

  // Interval check
  const shouldStop = (numUpdates: number, ai: number, bi: number) => {
    const intervalTooSmall = Math.abs(bi - ai) < minInterval;
    const tooManySteps = numUpdates > maxSteps;

    if (intervalTooSmall) { console.log("interval too small"); }
    if (tooManySteps) { console.log("too many steps"); }

    return intervalTooSmall || tooManySteps;
  }

  // Consts / initial values
  // TODO: port comments from original

  // const t = 0.002; // for venn_simple.sty
  // const t = 0.1; // for tree.sty

  let a = 0;
  let b = Infinity;
  let t = 1.0;
  let i = 0;

  // console.log("line search", xs.arraySync(), gradfx.arraySync(), duf(xs)(xs).arraySync());

  // Main loop + update check
  while (true) {
    const needToStop = shouldStop(i, a, b);

    if (needToStop) {
      console.log("stopping early: (i, a, b, t) = ", i, a, b, t);
      break;
    }

    const isArmijo = armijo(t);
    const isWolfe = wolfe(t);
    // console.log("(i, a, b, t), armijo, wolfe", i, a, b, t, isArmijo, isWolfe);

    if (!isArmijo) {
      // console.log("not armijo"); 
      b = t;
    } else if (!isWolfe) {
      // console.log("not wolfe"); 
      a = t;
    } else {
      // console.log("found good interval");
      // console.log("stopping: (i, a, b, t) = ", i, a, b, t);
      break;
    }

    if (b < Infinity) {
      // console.log("already found armijo"); 
      t = (a + b) / 2.0;
    } else {
      // console.log("did not find armijo"); 
      t = 2.0 * a;
    }

    i++;
  }

  return t;
};

/**
 * Use included tf.js optimizer to minimize f over xs (note: xs is mutable)
 *
 * @param {(...arg: tf.Tensor[]) => tf.Tensor} f overall energy function
 * @param {(...arg: tf.Tensor[]) => tf.Tensor[]} gradf gradient function
 * @param {tf.Tensor[]} xs varying state
 * @param {*} names // TODO: what is this
 * @returns // TODO: document
 */
export const minimize = (
  f: (...arg: DiffVar[]) => Scalar,
  gradf: (arg: Tensor[]) => Tensor[],
  xs: DiffVar[],
  maxSteps = 100
): {
  energy: Scalar;
  normGrad: Scalar;
  i: number;
} => {
  // values to be returned
  let energy;
  let i = 0;
  let gradfx = tf.stack(gradf(xs));;
  let normGrad;

  // TODO: Check that the way this loop is being called (and with # steps) satisfies the requirements of EP (e.g. minimizing an unconstrained problem)

  while (i < maxSteps) {
    // TFJS optimizer
    // energy = optimizer.minimize(() => f(...xs) as any, true);

    // custom optimizer (TODO: factor out)
    // right now, just does vanilla gradient descent with line search
    // Note: tf.clone can clone a variable into a tensor, and after that, the two are unrelated
    // TODO: figure out the best way to dispose/tidy the intermediate tensors

    // TODO: clean this up with the `flatten` function
    // TODO: On iteration, can we save time/space by not reshaping/assigning all these tensors??

    gradfx = tf.stack(gradf(xs));
    // TODO: Put inlined gradient here. Or just use JS lists (vectors? Is there a better data structure?) and inlined gradient, idk

    // const xsCopy = flatten2(xs);
    // const stepSize = awLineSearch(f, gradf, xsCopy, flatten(gradfx));
    const stepSize = 0.001;
    // console.log("stepSize via line search:", stepSize);

    // xs' = xs - dt * grad(f(xs))
    // `stack` makes a new immutable tensor of the vars: Tensor [ v1, v2, v3 ] (where each var is a single-elem list [x])
    // TODO: Can we do this without the arraySync call?
    const xsNew = tf.stack(xs).sub(gradfx.mul(stepSize)).arraySync();
    // Set each variable to the result
    xs.forEach((e, j) => e.assign(tf.tensor(xsNew[j])));
    energy = f(...xs);
    // normGrad = gradfx.norm();

    // note: this printing could tank the performance
    // console.log("i = ", i);
    // const vals = xs.map(v => v.dataSync()[0]);
    console.log(`f(xs): ${energy}`);
    // console.log("f'(xs)", tfsStr(gradfx));
    // console.log("||f'(xs)||", sc(normGrad));

    i++;
  }

  // const gradfxLast = gradf(xs);
  // Note that tf.stack(gradfx) gives a Tensor of single-element tensors, e.g. Tensor [[-2], [2]]
  // const normGradLast = tf.stack(gradfxLast).norm();

  energy = f(...xs);
  normGrad = gradfx.norm();

  return {
    energy: energy as Scalar,
    normGrad: normGrad as Scalar,
    i
  };
};

// ---------- Vector utils 
// TODO: factor out

const vecSub = (xs: number[], ys: number[]): number[] =>
  _.zipWith([xs, ys], e => e[1] - e[0]);
