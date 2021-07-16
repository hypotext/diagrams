import { checkDomain, compileDomain, parseDomain } from "compiler/Domain";
import { compileStyle } from "compiler/Style";
import {
  checkSubstance,
  compileSubstance,
  parseSubstance,
  prettySubstance,
} from "compiler/Substance";
import consola, { LogLevel } from "consola";
import { evalShapes } from "engine/Evaluator";
import { genFns, genOptProblem, initializeMat, step } from "engine/Optimizer";
import { insertPending } from "engine/PropagateUpdate";
import RenderStatic, {
  RenderInteractive,
  RenderShape,
} from "renderer/Renderer";
import { resampleBest } from "renderer/Resample";
import { Synthesizer, SynthesizerSetting } from "synthesis/Synthesizer";
import { Env } from "types/domain";
import { PenroseError } from "types/errors";
import { Registry, Trio } from "types/io";
import * as ShapeTypes from "types/shape";
import { Fn, LabelCache, State } from "types/state";
import { SubstanceEnv } from "types/substance";
import { collectLabels } from "utils/CollectLabels";
import { andThen, Result, showError } from "utils/Error";
import { prettyPrintFn, prettyPrintPath } from "utils/OtherUtils";
import { bBoxDims, toHex } from "utils/Util";
import { colorUninitShapes, colorUninitText } from "renderer/Color";

const log = consola.create({ level: LogLevel.Warn }).withScope("Top Level");

/**
 * Resample all shapes in the state by generating a number of samples (`numSamples`) and picking the sample with the lowest initial energy value.
 * @param state current state
 * @param numSamples number of samples to choose from
 */
export const resample = (state: State, numSamples: number): State => {
  return resampleBest(state, numSamples);
};

/**
 * Take n steps in the optimizer given the current state.
 * @param state current state
 * @param numSteps number of steps to take (default: 1)
 */
export const stepState = (state: State, numSteps = 10000): State => {
  return step(state, numSteps);
};

/**
 * Repeatedly take one step in the optimizer given the current state until convergence.
 * @param state current state
 */
export const stepUntilConvergence = (state: State, numSteps = 10000): State => {
  let currentState = state;
  while (!stateConverged(currentState)) {
    currentState = step(currentState, numSteps, true);
  }
  currentState = colorUninitText(colorUninitShapes(currentState));
  return currentState;
};

/**
 * Embed a static Penrose diagram in a DOM node.
 * @param domainProg a Domain program string
 * @param subProg a Substance program string
 * @param styProg a Style program string
 * @param node a node in the DOM tree
 */
export const diagram = async (
  domainProg: string,
  subProg: string,
  styProg: string,
  node: HTMLElement
): Promise<void> => {
  const res = compileTrio(domainProg, subProg, styProg);
  if (res.isOk()) {
    const state: State = await prepareState(res.value);
    const optimized = stepUntilConvergence(state);
    node.appendChild(RenderStatic(optimized));
  } else {
    throw Error(
      `Error when generating Penrose diagram: ${showError(res.error)}`
    );
  }
};

/**
 * Embed an interactive Penrose diagram in a DOM node.
 *
 * @param domainProg a Domain program string
 * @param subProg a Substance program string
 * @param styProg a Style program string
 * @param node a node in the DOM tree
 */
export const interactiveDiagram = async (
  domainProg: string,
  subProg: string,
  styProg: string,
  node: HTMLElement
): Promise<void> => {
  const updateData = (state: State) => {
    const stepped = stepUntilConvergence(state);
    node.replaceChild(
      RenderInteractive(stepped, updateData),
      node.firstChild as Node
    );
  };
  const res = compileTrio(domainProg, subProg, styProg);
  if (res.isOk()) {
    const state: State = await prepareState(res.value);
    const optimized = stepUntilConvergence(state);
    node.appendChild(RenderInteractive(optimized, updateData));
  } else {
    throw Error(
      `Error when generating Penrose diagram: ${showError(res.error)}`
    );
  }
};

/**
 * Given a trio of Domain, Substance, and Style programs, compile them into an initial `State`. Note that this function does _not_ evaluate the shapes. Generation of shapes is handled in `prepareState`.
 * @param domainProg a Domain program string
 * @param subProg a Substance program string
 * @param styProg a Style program string
 */
export const compileTrio = (
  domainProg: string,
  subProg: string,
  styProg: string
): Result<State, PenroseError> => {
  const domainRes: Result<Env, PenroseError> = compileDomain(domainProg);

  const subRes: Result<[SubstanceEnv, Env], PenroseError> = andThen(
    (env) => compileSubstance(subProg, env),
    domainRes
  );

  const styRes: Result<State, PenroseError> = andThen(
    (res) => compileStyle(styProg, ...res),
    subRes
  );

  return styRes;
};

/**
 * Generate all shapes, collect labels and images (if applicable), and generate the optimization problem given an initial `State`.
 * @param state an initial diagram state
 */
export const prepareState = async (state: State): Promise<State> => {
  await initializeMat();
  // TODO: errors
  const stateAD = {
    ...state,
    originalTranslation: state.originalTranslation,
  };

  // After the pending values load, they only use the evaluated shapes (all in terms of numbers)
  // The results of the pending values are then stored back in the translation as autodiff types
  const stateEvaled: State = evalShapes(stateAD);

  const labelCache: LabelCache = await collectLabels(stateEvaled.shapes);

  const stateWithPendingProperties = insertPending({
    ...stateEvaled,
    labelCache,
  });

  const withOptProblem: State = genOptProblem(stateWithPendingProperties);
  const withOptProblemAndCachedFns: State = genFns(withOptProblem);

  return withOptProblemAndCachedFns;
};

/**
 * Returns true if state is converged
 * @param state current state
 */
export const stateConverged = (state: State): boolean =>
  state.params.optStatus === "EPConverged";

/**
 * Returns true if state is the initial frame
 * @param state current state
 */
export const stateInitial = (state: State): boolean =>
  state.params.optStatus === "NewIter";

/**
 * Read and flatten the registry file for Penrose examples into a list of program trios.
 *
 * @param registry JSON file of the registry
 */
export const readRegistry = (registry: Registry): Trio[] => {
  const { substances, styles, domains, trios } = registry;
  const res = [];
  for (const { domain: dslID, style: styID, substance: subID } of trios) {
    const domain = domains[dslID];
    const substance = substances[subID];
    const style = styles[styID];
    const trio = {
      substanceURI: substance.URI,
      styleURI: style.URI,
      domainURI: domain.URI,
      substanceName: substance.name,
      styleName: style.name,
      domainName: domain.name,
      name: `${subID}-${styID}`,
    };
    res.push(trio);
  }
  return res;
};

/**
 * Evaluate the overall energy of a `State`. If the `State` does not have an optimization problem initialized (i.e. it doesn't have a defined `objective` field), this function will call `genOptProblem` to initialize it. Otherwise, it will evaluate the cached objective function.
 * @param s a state with or without an optimization problem initialized
 * @returns a scalar value of the current energy
 */
export const evalEnergy = (s: State): number => {
  const { objective, weight } = s.params;
  // NOTE: if `prepareState` hasn't been called before, log a warning message and generate a fresh optimization problem
  if (!objective) {
    log.warn(
      "State is not prepared for energy evaluation. Call `prepareState` to initialize the optimization problem first."
    );
    const newState = genOptProblem(s);
    // TODO: caching
    return evalEnergy(newState);
  }
  return objective(weight)(s.varyingValues);
};

/**
 * Evaluate a list of constraints/objectives: this will be useful if a user want to apply a subset of constrs/objs on a `State`. If the `State` doesn't have the constraints/objectives compiled, it will generate them first. Otherwise, it will evaluate the cached functions.
 * @param fns a list of constraints/objectives
 * @param s a state with or without its opt functions cached
 * @returns a list of scalar values of the energies of the requested functions, evaluated at the `varyingValues` in the `State`
 */
export const evalFns = (fns: Fn[], s: State): number[] => {
  const { objFnCache, constrFnCache } = s.params;

  // NOTE: if `prepareState` hasn't been called before, log a warning message and generate a fresh optimization problem
  if (!objFnCache || !constrFnCache) {
    log.warn(
      "State is not prepared for energy evaluation. Call `prepareState` to initialize the cached objective/constraint functions first."
    );
    const newState = genFns(s);
    // TODO: caching
    return evalFns(fns, newState);
  }

  // Evaluate the energy of each requested function (of the given type) on the varying values in the state
  const xs = s.varyingValues;
  return fns.map((fn: Fn) => {
    const fnsCached = fn.optType === "ObjFn" ? objFnCache : constrFnCache;
    const fnStr = prettyPrintFn(fn);

    if (!(fnStr in fnsCached)) {
      console.log("fns", fnsCached);
      throw Error(
        `Internal error: could not find ${fn.optType} ${fnStr} in cached functions`
      );
    }
    const cachedFnInfo = fnsCached[fnStr];
    return cachedFnInfo.f(xs); // Could also return gradient if desired
  });
};

export type PenroseState = State;

export {
  compileDomain,
  compileSubstance,
  checkDomain,
  checkSubstance,
  parseSubstance,
  parseDomain,
  RenderStatic,
  RenderShape,
  Synthesizer,
  RenderInteractive,
  ShapeTypes,
  bBoxDims,
  prettySubstance,
  toHex,
  initializeMat,
  showError,
  Result,
  prettyPrintFn,
};
export type { PenroseError } from "./types/errors";
export type { Registry, Trio };
export type { Env };
export type { SynthesizerSetting };
export type { SubProg } from "types/substance";
