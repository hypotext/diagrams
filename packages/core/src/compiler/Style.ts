import { checkExpr, checkPredicate, checkVar } from "compiler/Substance";
import consola, { LogLevel } from "consola";
import { constrDict, objDict } from "contrib/Constraints";
// Dicts (runtime data)
import { compDict } from "contrib/Functions";
import { constOf, numOf, varOf } from "engine/Autodiff";
import {
  addWarn,
  defaultLbfgsParams,
  dummyASTNode,
  dummyIdentifier,
  findExpr,
  findExprSafe,
  initConstraintWeight,
  insertExpr,
  insertExprs,
  insertGPI,
  isPath,
  isTagExpr,
  valueNumberToAutodiffConst,
} from "engine/EngineUtils";
import { alg, Graph } from "graphlib";
import _ from "lodash";
import nearley from "nearley";
import { lastLocation } from "parser/ParserUtil";
import styleGrammar from "parser/StyleParser";
import {
  Canvas,
  findDef,
  PropType,
  Sampler,
  ShapeDef,
  shapedefs,
} from "renderer/ShapeDef";
import rfdc from "rfdc";
import { VarAD } from "types/ad";
import { ASTNode, Identifier } from "types/ast";
import { Either, Just, Left, MaybeVal, Right } from "types/common";
import { ConstructorDecl, Env, TypeConstructor } from "types/domain";
import {
  ParseError,
  PenroseError,
  StyleError,
  StyleErrors,
  StyleResults,
  StyleWarnings,
  SubstanceError,
} from "types/errors";
import { Fn, OptType, Params, State } from "types/state";
import {
  BindingForm,
  Block,
  DeclPattern,
  Expr,
  GPIDecl,
  Header,
  HeaderBlock,
  IAccessPath,
  ICompApp,
  IConstrFn,
  ILayering,
  IObjFn,
  Path,
  PredArg,
  PropertyDecl,
  RelationPattern,
  RelBind,
  RelPred,
  SEBind,
  Selector,
  SelExpr,
  Stmt,
  StyProg,
  StyT,
  StyVar,
} from "types/style";
import { LocalVarSubst, ProgType, SelEnv, Subst } from "types/styleSemantics";
import {
  ApplyConstructor,
  ApplyFunction,
  ApplyPredicate,
  Func,
  LabelMap,
  SubExpr,
  SubPredArg,
  SubProg,
  SubstanceEnv,
  SubStmt,
  TypeConsApp,
} from "types/substance";
import {
  Field,
  FieldDict,
  FieldExpr,
  GPIMap,
  GPIProps,
  IFGPI,
  IOptEval,
  Property,
  PropID,
  ShapeTypeStr,
  StyleOptFn,
  TagExpr,
  Translation,
  Value,
} from "types/value";
import { err, isErr, ok, parseError, Result, toStyleErrors } from "utils/Error";
import { prettyPrintPath } from "utils/OtherUtils";
import { randFloat } from "utils/Util";

import { checkTypeConstructor, isDeclaredSubtype } from "./Domain";

const log = consola
  .create({ level: LogLevel.Warn })
  .withScope("Style Compiler");
const clone = rfdc({ proto: false, circles: false });

//#region consts
const ANON_KEYWORD = "ANON";
const LOCAL_KEYWORD = "$LOCAL";

const LABEL_FIELD = "label";

const UnknownTagError = new Error("unknown tag");

const VARYING_INIT_FN_NAME = "VARYING_INIT";

// For statically checking existence
const FN_DICT = {
  CompApp: compDict,
  ObjFn: objDict,
  ConstrFn: constrDict,
};

const FN_ERR_TYPE = {
  CompApp: "InvalidFunctionNameError" as const,
  ObjFn: "InvalidObjectiveNameError" as const,
  ConstrFn: "InvalidConstraintNameError" as const,
};

//#endregion

//#region utils

const dummyId = (name: string): Identifier =>
  dummyIdentifier(name, "SyntheticStyle");

// numbers from 0 to r-1 w/ increment of 1
const numbers = (r: number): number[] => {
  const l = 0;
  if (l > r) {
    throw Error("invalid range");
  }
  const arr = [];
  for (let i = l; i < r; i++) {
    arr.push(i);
  }
  return arr;
};

export function numbered<A>(xs: A[]): [A, number][] {
  if (!xs) throw Error("fail");
  return _.zip(xs, numbers(xs.length)) as [A, number][]; // COMBAK: Don't know why typescript has problem with this
}

// TODO move to util

export function isLeft<A>(val: any): val is Left<A> {
  if ((val as Left<A>).tag === "Left") return true;
  return false;
}

export function isRight<B>(val: any): val is Right<B> {
  if ((val as Right<B>).tag === "Right") return true;
  return false;
}

export function toLeft<A>(val: A): Left<A> {
  return { contents: val, tag: "Left" };
}

export function toRight<B>(val: B): Right<B> {
  return { contents: val, tag: "Right" };
}

export function ToLeft<A, B>(val: A): Either<A, B> {
  return { contents: val, tag: "Left" };
}

export function ToRight<A, B>(val: B): Either<A, B> {
  return { contents: val, tag: "Right" };
}

export function foldM<A, B, C>(
  xs: A[],
  f: (acc: B, curr: A, i: number) => Either<C, B>,
  init: B
): Either<C, B> {
  let res = init;
  let resW: Either<C, B> = toRight(init); // wrapped

  for (let i = 0; i < xs.length; i++) {
    resW = f(res, xs[i], i);
    if (resW.tag === "Left") {
      return resW;
    } // Stop fold early on first error and return it
    res = resW.contents;
  }

  return resW;
}

function justs<T>(xs: MaybeVal<T>[]): T[] {
  return xs
    .filter((x) => x.tag === "Just")
    .map((x) => {
      if (x.tag === "Just") {
        return x.contents;
      }
      throw Error("unexpected"); // Shouldn't happen
    });
}

const safeContentsList = (x: any) => (x ? x.contents : []);

const toString = (x: BindingForm): string => x.contents.value;

// https://stackoverflow.com/questions/12303989/cartesian-product-of-multiple-arrays-in-javascript
const cartesianProduct = (...a: any[]) =>
  a.reduce((a, b) => a.flatMap((d: any) => b.map((e: any) => [d, e].flat())));

const pathString = (p: Path): string => {
  // COMBAK: This should be replaced by prettyPrintPath
  if (p.tag === "FieldPath") {
    return `${p.name.contents.value}.${p.field.value}`;
  } else if (p.tag === "PropertyPath") {
    return `${p.name.contents.value}.${p.field.value}.${p.property.value}`;
  } else throw Error("pathStr not implemented");
};

const getShapeName = (s: string, f: Field): string => {
  return `${s}.${f}`;
};

//#endregion

//#region Some code for prettyprinting

const ppExpr = (e: SelExpr): string => {
  if (e.tag === "SEBind") {
    return e.contents.contents.value;
  } else if (["SEFunc", "SEValCons", "SEFuncOrValCons"].includes(e.tag)) {
    const args = e.args.map(ppExpr);
    return `${e.name.value}(${args})`;
  } else if (((e as any) as StyVar).tag === "StyVar") {
    return ((e as any) as StyVar).contents.value;
  } else {
    console.log("res", e);
    throw Error("unknown tag");
  }
};

const ppRelArg = (r: PredArg): string => {
  if (r.tag === "RelPred") {
    return ppRelPred(r);
  } else {
    return ppExpr(r);
  }
};

const ppRelBind = (r: RelBind): string => {
  const expr = ppExpr(r.expr);
  return `${r.id.contents.value} := ${expr}`;
};

const ppRelPred = (r: RelPred): string => {
  const args = r.args.map(ppRelArg).join(", ");
  const name = r.name.value;
  return `${name}(${args})`;
};

export const ppRel = (r: RelationPattern): string => {
  if (r.tag === "RelBind") {
    return ppRelBind(r);
  } else if (r.tag === "RelPred") {
    return ppRelPred(r);
  } else throw Error("unknown tag");
};

//#endregion

//#region Types and code for selector checking and environment construction

const initSelEnv = (): SelEnv => {
  // Note that JS objects are by reference, so you have to make a new one each time
  return {
    sTypeVarMap: {},
    varProgTypeMap: {},
    skipBlock: false,
    header: { tag: "Nothing" },
    warnings: [],
    errors: [],
  };
};

// Add a mapping from Sub or Sty var to the selector's environment
// g, (x : |T)
// NOTE: Mutates the map in `m`
const addMapping = (
  k: BindingForm,
  v: StyT,
  m: SelEnv,
  p: ProgType
): SelEnv => {
  m.sTypeVarMap[toString(k)] = v;
  m.varProgTypeMap[toString(k)] = [p, k];
  return m;
};

// add warning/error to end of existing errors in selector env
const addErrSel = (selEnv: SelEnv, err: StyleError): SelEnv => {
  return {
    ...selEnv,
    errors: selEnv.errors.concat([err]),
  };
};

// TODO: Test this
// Judgment 3. G; g |- |S_o ok ~> g'
// `checkDeclPattern`
const checkDeclPatternAndMakeEnv = (
  varEnv: Env,
  selEnv: SelEnv,
  stmt: DeclPattern
): SelEnv => {
  const [styType, bVar] = [stmt.type, stmt.id];

  const typeErr = checkTypeConstructor(toSubstanceType(styType), varEnv);
  if (isErr(typeErr)) {
    // TODO(errors)
    return addErrSel(selEnv, {
      tag: "SelectorDeclTypeError",
      typeName: styType,
    });
  }

  const varName: string = bVar.contents.value;

  // TODO(errors)
  if (Object.keys(selEnv.sTypeVarMap).includes(varName)) {
    return addErrSel(selEnv, { tag: "SelectorVarMultipleDecl", varName: bVar });
  }

  if (bVar.tag === "StyVar") {
    // rule Decl-Sty-Context
    // NOTE: this does not aggregate *all* possible errors. May just return first error.
    // y \not\in dom(g)
    return addMapping(bVar, styType, selEnv, { tag: "StyProgT" });
  } else if (bVar.tag === "SubVar") {
    // rule Decl-Sub-Context
    // x \not\in dom(g)

    const substanceType = varEnv.vars.get(varName);

    // If any Substance variable doesn't exist in env, ignore it,
    // but flag it so we know to not translate the lines in the block later.
    if (!substanceType) {
      return { ...selEnv, skipBlock: true };
    }

    // check "T <: |T", assuming type constructors are nullary
    // Specifically, the Style type for a Substance var needs to be more general. Otherwise, if it's more specific, that's a coercion
    // e.g. this is correct: Substance: "SpecialVector `v`"; Style: "Vector `v`"
    const declType = toSubstanceType(styType);
    if (!isDeclaredSubtype(substanceType, declType, varEnv)) {
      // COMBAK: Order?
      // TODO(errors)
      return addErrSel(selEnv, {
        tag: "SelectorDeclTypeMismatch",
        subType: declType,
        styType: substanceType,
      });
    }

    return addMapping(bVar, styType, selEnv, { tag: "SubProgT" });
  } else throw Error("unknown tag");
};

// Judgment 6. G; g |- [|S_o] ~> g'
// `checkDeclPatterns` w/o error-checking, just addMapping for StyVars and SubVars
const checkDeclPatternsAndMakeEnv = (
  varEnv: Env,
  selEnv: SelEnv,
  decls: DeclPattern[]
): SelEnv => {
  return decls.reduce(
    (s, p) => checkDeclPatternAndMakeEnv(varEnv, s, p),
    selEnv
  );
};

/**
 * Helper fxn for checking well-formedness of selectors with predicate aliases
 * @param m : Map<string, any> (only the keys of the map are used)
 */
const getKeyWordsFromMap = (m: any): string[] => {
  let keywords: string[] = [];
  const iterator = m.keys();
  for (let i = 0; i < m.size; i++) {
    keywords.push(iterator.next().value);
  }
  return keywords;
};

/**
 * Helper fxn for checking that predicate alias names don't conflict with
 * existing domain keywords
 *
 * Returns a list of domain keywords that the aliases cannot match
 */
const getDomainKeywords = (varEnv: Env): string[] => {
  const keyWordMaps = [
    varEnv.types,
    varEnv.functions,
    varEnv.predicates,
    varEnv.constructors,
    varEnv.constructorsBindings,
  ];

  const keywords = _.flatMap(keyWordMaps, getKeyWordsFromMap);

  const subtypeKeywords = varEnv.subTypes.map(([t1, t2]) => {
    return t1.name.value;
  });

  return keywords.concat(subtypeKeywords);
};

/**
 * Helper fxn for checking that predicate alias names don't conflict with
 * existing selector style variable names
 *
 * Returns a list of selector keywords that the aliases cannot match
 */
const getSelectorStyVarNames = (selEnv: SelEnv): string[] => {
  return Object.keys(selEnv.sTypeVarMap);
};

/**
 * Checks for if an alias name conflicts with domain or selector keywords
 */
const aliasConflictsWithDomainOrSelectorKeyword = (
  alias: Identifier,
  varEnv: Env,
  selEnv: SelEnv
): boolean => {
  const domainKeywords = getDomainKeywords(varEnv);
  const selectorKeywords = getSelectorStyVarNames(selEnv);
  return (
    domainKeywords.includes(alias.value) ||
    selectorKeywords.includes(alias.value)
  );
};

// TODO: Test this function
// Judgment 4. G |- |S_r ok
const checkRelPattern = (
  varEnv: Env,
  selEnv: SelEnv,
  rel: RelationPattern
): StyleErrors => {
  // rule Bind-Context
  if (rel.tag === "RelBind") {
    // TODO: use checkSubStmt here (and in paper)?
    // TODO: make sure the ill-typed bind selectors fail here (after Sub statics is fixed)
    // G |- B : T1
    const res1 = checkVar(rel.id.contents, varEnv);

    // TODO(error)
    if (isErr(res1)) {
      const subErr1: SubstanceError = res1.error;
      // TODO(error): Do we need to wrap this error further, or is returning SubstanceError with no additional Style info ok?
      // return ["substance typecheck error in B"];
      return [{ tag: "TaggedSubstanceError", error: subErr1 }];
    }

    const [vtype, env1] = res1.value;

    // G |- E : T2
    const res2 = checkExpr(toSubExpr(varEnv, rel.expr), varEnv);

    // TODO(error)
    if (isErr(res2)) {
      const subErr2: SubstanceError = res2.error;
      return [{ tag: "TaggedSubstanceError", error: subErr2 }];
      // return ["substance typecheck error in E"];
    }

    const [etype, env2] = res2.value;

    // T1 = T2
    const typesEq = isDeclaredSubtype(vtype, etype, varEnv);

    // TODO(error) -- improve message
    if (!typesEq) {
      return [
        { tag: "SelectorRelTypeMismatch", varType: vtype, exprType: etype },
      ];
      // return ["types not equal"];
    }

    return [];
  } else if (rel.tag === "RelPred") {
    if (
      rel.alias &&
      aliasConflictsWithDomainOrSelectorKeyword(rel.alias, varEnv, selEnv)
    ) {
      return [{ tag: "SelectorAliasNamingError", alias: rel.alias }];
    }

    // rule Pred-Context
    // G |- Q : Prop
    const res = checkPredicate(toSubPred(rel), varEnv);
    if (isErr(res)) {
      const subErr3: SubstanceError = res.error;
      return [{ tag: "TaggedSubstanceError", error: subErr3 }];
      // return ["substance typecheck error in Pred"];
    }
    return [];
  } else {
    throw Error("unknown tag");
  }
};

// Judgment 5. G |- [|S_r] ok
const checkRelPatterns = (
  varEnv: Env,
  selEnv: SelEnv,
  rels: RelationPattern[]
): StyleErrors => {
  return _.flatMap(
    rels,
    (rel: RelationPattern): StyleErrors => checkRelPattern(varEnv, selEnv, rel)
  );
};

const toSubstanceType = (styT: StyT): TypeConsApp => {
  // TODO: Extend for non-nullary types (when they are implemented in Style)
  return {
    tag: "TypeConstructor",
    name: styT,
    args: [],
  };
};

// TODO: Test this
// NOTE: `Map` is immutable; we return the same `Env` reference with a new `vars` set (rather than mutating the existing `vars` Map)
const mergeMapping = (
  varProgTypeMap: { [k: string]: [ProgType, BindingForm] },
  varEnv: Env,
  [varName, styType]: [string, StyT]
): Env => {
  const res = varProgTypeMap[varName];
  if (!res) {
    throw Error("var has no binding form?");
  }
  const [progType, bindingForm] = res;

  if (bindingForm.tag === "SubVar") {
    // G || (x : |T) |-> G
    return varEnv;
  } else if (bindingForm.tag === "StyVar") {
    // G || (y : |T) |-> G[y : T] (shadowing any existing Sub vars)
    return {
      ...varEnv,
      vars: varEnv.vars.set(
        bindingForm.contents.value,
        toSubstanceType(styType)
      ),
    };
  } else {
    throw Error("unknown tag");
  }
};

// TODO: don't merge the varmaps! just put g as the varMap (otherwise there will be extraneous bindings for the relational statements)
// Judgment 1. G || g |-> ...
const mergeEnv = (varEnv: Env, selEnv: SelEnv): Env => {
  return Object.entries(selEnv.sTypeVarMap).reduce(
    (acc, curr) => mergeMapping(selEnv.varProgTypeMap, acc, curr),
    varEnv
  );
};

// ported from `checkPair`, `checkSel`, and `checkNamespace`
const checkHeader = (varEnv: Env, header: Header): SelEnv => {
  if (header.tag === "Selector") {
    // Judgment 7. G |- Sel ok ~> g
    const sel: Selector = header;

    const selEnv_afterHead = checkDeclPatternsAndMakeEnv(
      varEnv,
      initSelEnv(),
      sel.head.contents
    );

    // Check `with` statements
    // TODO: Did we get rid of `with` statements?
    const selEnv_decls = checkDeclPatternsAndMakeEnv(
      varEnv,
      selEnv_afterHead,
      safeContentsList(sel.with)
    );

    const relErrs = checkRelPatterns(
      mergeEnv(varEnv, selEnv_decls),
      selEnv_decls,
      safeContentsList(sel.where)
    );

    // TODO(error): The errors returned in the top 3 statements
    return {
      ...selEnv_decls,
      errors: selEnv_decls.errors.concat(relErrs), // COMBAK: Reverse the error order?
    };
  } else if (header.tag === "Namespace") {
    // TODO(error)
    return initSelEnv();
  } else throw Error("unknown Style header tag");
};

// Returns a sel env for each selector in the Style program, in the same order
// previously named `checkSels`
export const checkSelsAndMakeEnv = (
  varEnv: Env,
  prog: HeaderBlock[]
): SelEnv[] => {
  // Note that even if there is an error in one selector, it does not stop checking of the other selectors
  const selEnvs: SelEnv[] = prog.map((e) => {
    const res = checkHeader(varEnv, e.header);
    // Put selector AST in just for debugging
    res.header = { tag: "Just", contents: e.header };
    return res;
  });
  return selEnvs;
};

//#endregion

//#region Types and code for finding substitutions

// Judgment 20. A substitution for a selector is only correct if it gives exactly one
//   mapping for each Style variable in the selector. (Has test)
export const fullSubst = (selEnv: SelEnv, subst: Subst): boolean => {
  // Check if a variable is a style variable, not a substance one
  const isStyVar = (e: string): boolean =>
    selEnv.varProgTypeMap[e][0].tag === "StyProgT";

  // Equal up to permutation (M.keys ensures that there are no dups)
  const selStyVars = Object.keys(selEnv.sTypeVarMap).filter(isStyVar);
  const substStyVars = Object.keys(subst);
  // Equal up to permutation (keys of an object in js ensures that there are no dups)
  return _.isEqual(selStyVars.sort(), substStyVars.sort());
};

// Check that there are no duplicate keys or vals in the substitution
export const uniqueKeysAndVals = (subst: Subst): boolean => {
  // All keys already need to be unique in js, so only checking values
  const vals = Object.values(subst);
  const valsSet = {};

  for (let i = 0; i < vals.length; i++) {
    valsSet[vals[i]] = 0; // This 0 means nothing, we just want to create a set of values
  }

  // All entries were unique if length didn't change (ie the nub didn't change)
  return Object.keys(valsSet).length === vals.length;
};

// Optimization to filter out Substance statements that have no hope of matching any of the substituted relation patterns, so we don't do redundant work for every substitution (of which there could be millions). This function is only called once per selector.
const couldMatchRels = (
  typeEnv: Env,
  rels: RelationPattern[],
  stmt: SubStmt
): boolean => {
  // TODO < (this is an optimization; will only implement if needed)
  return true;
};

/**
 * Helper fxn for @function isValidRelSubst.
 *
 * Determines if all the variables in @param sebind
 * exist as valid keys in @param subst.
 */
const sebindExistsInSubst = (sebind: SEBind, subst: Subst): boolean => {
  if (sebind.contents.tag !== "StyVar") {
    throw new Error("expected sty var");
  }
  const validKeywords = Object.keys(subst);
  return validKeywords.includes(sebind.contents.contents.value);
};

/**
 * Helper fxn for @function isValidRelSubst.
 *
 * Determines if all the variables in @param expr
 * exist as valid keys in @param subst.
 */
const selExprExistsInSubst = (expr: SelExpr, subst: Subst): boolean => {
  if (expr.tag === "SEBind") {
    return sebindExistsInSubst(expr, subst);
  } else if (expr.tag === ("SEFunc" || "SEValCons" || "SEFuncOrValCons")) {
    return expr.args.every((arg) => selExprExistsInSubst(arg, subst));
  } else throw new Error("unknown tag");
};

/**
 * Helper fxn for @function isValidRelSubst.
 *
 * Determines if all the variables in @param arg
 * exist as valid keys in @param subst.
 */
const predArgExistsInSubst = (arg: PredArg, subst: Subst): boolean => {
  if (arg.tag === "RelPred") {
    return isValidRelSubst(subst, arg);
  } else if (arg.tag === "SEBind") {
    return sebindExistsInSubst(arg, subst);
  } else throw new Error("unknown tag");
};

/**
 * Determines if all the variables in @param rel exist as valid
 * keys in @param subst.
 *
 * Ex, IsSubset(x,y) must have 'x' and 'y' exist as keys in @param subst
 * for the relation to be valid.
 */
const isValidRelSubst = (subst: Subst, rel: RelationPattern): boolean => {
  if (rel.tag === "RelPred") {
    return rel.args.every((arg) => predArgExistsInSubst(arg, subst));
  } else if (rel.tag === "RelBind") {
    return false; // these don't have aliases
  } else {
    throw new Error("unknown tag");
  }
};

/**
 * Helper fxn for @function getRelPredAliasInstanceName
 *
 * Returns the substitution for a bindingform
 */
const getBindingFormAliasInstanceName = (
  bf: BindingForm,
  subst: Subst
): string => {
  if (bf.tag === "SubVar") {
    return bf.contents.value;
  } else if (bf.tag === "StyVar") {
    return subst[bf.contents.value];
  } else throw new Error("unknown tag");
};

/**
 * Returns the substitution for a predicate alias
 */
// IsSubset(B,A) --> `IsSubset_B_A`
// IsSubset(Union(B,C),A) --> `IsSubset_Union_B_C_A`
// TODO: this can be refactored for a more descriptive name for nested cases
// TODO: adding parentheses into the strings messes with GPIs sometimes?
const getRelPredAliasInstanceName = (
  relPred: RelPred,
  subst: Subst
): string => {
  let name = relPred.name.value;
  for (let arg of relPred.args) {
    if (arg.tag === "RelPred") {
      name = name.concat("_").concat(getRelPredAliasInstanceName(arg, subst));
    } else if (arg.tag === "SEBind") {
      name = name
        .concat("_")
        .concat(getBindingFormAliasInstanceName(arg.contents, subst));
    } else throw new Error("unknown tag");
  }
  return name;
};

/**
 * Adds predicate alias substitutions to an existing valid subst
 * @param subst a valid substitution for a given style selector
 * @param rels a list of relations for the same style selector
 */
const addRelPredAliasSubsts = (
  subst: Subst,
  rels: RelationPattern[]
): Subst => {
  subst = { ...subst }; // a shallow copy

  // only consider valid predicates in context of each subst
  for (let rel of rels) {
    if (rel.tag === "RelPred" && rel.alias && isValidRelSubst(subst, rel)) {
      subst[rel.alias.value] = getRelPredAliasInstanceName(rel, subst);
    }
  }

  return subst;
};

//#region (subregion? TODO fix) Applying a substitution
// // Apply a substitution to various parts of Style (relational statements, exprs, blocks)

// Recursively walk the tree, looking up and replacing each Style variable encountered with a Substance variable
// If a Sty var doesn't have a substitution (i.e. substitution map is bad), keep the Sty var and move on
// COMBAK: return "maybe" if a substitution fails?
// COMBAK: Add a type for `lv`? It's not used here
const substituteBform = (
  lv: any,
  subst: Subst,
  bform: BindingForm
): BindingForm => {
  // theta(B) = ...
  if (bform.tag === "SubVar") {
    // Variable in backticks in block or selector (e.g. `X`), so nothing to substitute
    return bform;
  } else if (bform.tag === "StyVar") {
    // Look up the substitution for the Style variable and return a Substance variable
    // Returns result of mapping if it exists (y -> x)
    const res = subst[bform.contents.value];

    if (res) {
      return {
        ...bform, // Copy the start/end loc of the original Style variable, since we don't have Substance parse info (COMBAK)
        tag: "SubVar",
        contents: {
          ...bform.contents, // Copy the start/end loc of the original Style variable, since we don't have Substance parse info
          type: "value",
          value: res, // COMBAK: double check please
        },
      };
    } else {
      // Nothing to substitute
      return bform;
    }
  } else throw Error("unknown tag");
};

const substituteExpr = (subst: Subst, expr: SelExpr): SelExpr => {
  // theta(B) = ...
  if (expr.tag === "SEBind") {
    return {
      ...expr,
      contents: substituteBform({ tag: "Nothing" }, subst, expr.contents),
    };
  } else if (["SEFunc", "SEValCons", "SEFuncOrValCons"].includes(expr.tag)) {
    // COMBAK: Remove SEFuncOrValCons?
    // theta(f[E]) = f([theta(E)]

    return {
      ...expr,
      args: expr.args.map((arg) => substituteExpr(subst, arg)),
    };
  } else {
    throw Error("unsupported tag");
  }
};

const substituteAlias = (subst: Subst, alias: Identifier): Identifier => {
  return {
    ...alias,
    value: subst[alias.value],
  };
};

const substitutePredArg = (subst: Subst, predArg: PredArg): PredArg => {
  if (predArg.tag === "RelPred") {
    return {
      ...predArg,
      args: predArg.args.map((arg) => substitutePredArg(subst, arg)),
    };
  } else if (predArg.tag === "SEBind") {
    return {
      ...predArg,
      contents: substituteBform({ tag: "Nothing" }, subst, predArg.contents), // COMBAK: Why is bform here...
    };
  } else {
    console.log("unknown tag", subst, predArg);
    throw Error("unknown tag");
  }
};

// theta(|S_r) = ...
export const substituteRel = (
  subst: Subst,
  rel: RelationPattern
): RelationPattern => {
  if (rel.tag === "RelBind") {
    // theta(B := E) |-> theta(B) := theta(E)
    return {
      ...rel,
      id: substituteBform({ tag: "Nothing" }, subst, rel.id),
      expr: substituteExpr(subst, rel.expr),
    };
  } else if (rel.tag === "RelPred") {
    // theta(Q([a]) = Q([theta(a)])

    if (rel.alias)
      return {
        ...rel,
        args: rel.args.map((arg) => substitutePredArg(subst, arg)),
        alias: substituteAlias(subst, rel.alias), // having this substituted doesn't affect the aliasing, just for debugging
      };
    else
      return {
        ...rel,
        args: rel.args.map((arg) => substitutePredArg(subst, arg)),
      };
  } else throw Error("unknown tag");
};

// Applies a substitution to a list of relational statement theta([|S_r])
// TODO: assumes a full substitution
const substituteRels = (
  subst: Subst,
  rels: RelationPattern[]
): RelationPattern[] => {
  const res = rels.map((rel) => substituteRel(subst, rel));
  return res;
};

//#endregion (subregion? TODO fix)

//#region Applying a substitution to a block

// // Substs for the translation semantics (more tree-walking on blocks, just changing binding forms)

const mkLocalVarName = (lv: LocalVarSubst): string => {
  if (lv.tag === "LocalVarId") {
    const [blockNum, substNum] = lv.contents;
    return `${LOCAL_KEYWORD}_block${blockNum}_subst${substNum}`;
  } else if (lv.tag === "NamespaceId") {
    return lv.contents;
  } else throw Error("unknown error");
};

const substitutePath = (lv: LocalVarSubst, subst: Subst, path: Path): Path => {
  if (path.tag === "FieldPath") {
    return {
      ...path,
      name: substituteBform({ tag: "Just", contents: lv }, subst, path.name),
    };
  } else if (path.tag === "PropertyPath") {
    return {
      ...path,
      name: substituteBform({ tag: "Just", contents: lv }, subst, path.name),
    };
  } else if (path.tag === "LocalVar") {
    return {
      nodeType: "SyntheticStyle",
      children: [],
      tag: "FieldPath",
      name: {
        children: [],
        nodeType: "SyntheticStyle",
        tag: "SubVar",
        contents: {
          ...dummyId(mkLocalVarName(lv)),
        },
      },
      field: path.contents,
    };
  } else if (path.tag === "InternalLocalVar") {
    // Note that the local var becomes a path
    // Use of local var 'v' (on right-hand side of '=' sign in Style) gets transformed into field path reference '$LOCAL_<ids>.v'
    // where <ids> is a string generated to be unique to this selector match for this block

    // COMBAK / HACK: Is there some way to get rid of all these dummy values?
    return {
      nodeType: "SyntheticStyle",
      children: [],
      tag: "FieldPath",
      name: {
        nodeType: "SyntheticStyle",
        children: [],
        tag: "SubVar",
        contents: {
          ...dummyId(mkLocalVarName(lv)),
        },
      },
      field: dummyId(path.contents),
    };
  } else if (path.tag === "AccessPath") {
    // COMBAK: Check if this works / is needed (wasn't present in original code)
    return {
      ...path,
      path: substitutePath(lv, subst, path.path),
    };
  } else {
    throw Error("unknown tag");
  }
};

const substituteField = (
  lv: LocalVarSubst,
  subst: Subst,
  field: PropertyDecl
): PropertyDecl => {
  return {
    ...field,
    value: substituteBlockExpr(lv, subst, field.value),
  };
};

const substituteBlockExpr = (
  lv: LocalVarSubst,
  subst: Subst,
  expr: Expr
): Expr => {
  if (isPath(expr)) {
    return substitutePath(lv, subst, expr);
  } else if (
    expr.tag === "CompApp" ||
    expr.tag === "ObjFn" ||
    expr.tag === "ConstrFn"
  ) {
    // substitute out occurrences of `VARYING_INIT(i)` (the computation) for `VaryingInit(i)` (the `AnnoFloat`) as there is currently no special syntax for this

    // note that this is a hack; instead of shoehorning it into `substituteBlockExpr`, it should be done more cleanly as a compiler pass on the Style block AST at some point. doesn't really matter when this is done as long as it's before the varying float initialization in `genState
    if (expr.tag === "CompApp") {
      if (expr.name.value === VARYING_INIT_FN_NAME) {
        // TODO(err): Typecheck VARYING_INIT properly and return an error. This will be unnecessary if parsed with special syntax.
        if (expr.args.length !== 1) {
          throw Error("expected one argument to VARYING_INIT");
        }

        if (expr.args[0].tag !== "Fix") {
          throw Error("expected float argument to VARYING_INIT");
        }

        return {
          ...dummyASTNode({}, "SyntheticStyle"),
          tag: "VaryInit",
          contents: expr.args[0].contents,
        };
      }
    }

    return {
      ...expr,
      args: expr.args.map((arg: Expr) => substituteBlockExpr(lv, subst, arg)),
    };
  } else if (expr.tag === "BinOp") {
    return {
      ...expr,
      left: substituteBlockExpr(lv, subst, expr.left),
      right: substituteBlockExpr(lv, subst, expr.right),
    };
  } else if (expr.tag === "UOp") {
    return {
      ...expr,
      arg: substituteBlockExpr(lv, subst, expr.arg),
    };
  } else if (
    expr.tag === "List" ||
    expr.tag === "Vector" ||
    expr.tag === "Matrix"
  ) {
    return {
      ...expr,
      contents: expr.contents.map((e: Expr) =>
        substituteBlockExpr(lv, subst, e)
      ),
    };
  } else if (expr.tag === "ListAccess") {
    return {
      ...expr,
      contents: [substitutePath(lv, subst, expr.contents[0]), expr.contents[1]],
    };
  } else if (expr.tag === "GPIDecl") {
    return {
      ...expr,
      properties: expr.properties.map((p: PropertyDecl) =>
        substituteField(lv, subst, p)
      ),
    };
  } else if (expr.tag === "Layering") {
    return {
      ...expr,
      below: substitutePath(lv, subst, expr.below),
      above: substitutePath(lv, subst, expr.above),
    };
  } else if (expr.tag === "PluginAccess") {
    return {
      ...expr,
      contents: [
        expr.contents[0],
        substituteBlockExpr(lv, subst, expr.contents[1]),
        substituteBlockExpr(lv, subst, expr.contents[2]),
      ],
    };
  } else if (expr.tag === "Tuple") {
    return {
      ...expr,
      contents: [
        substituteBlockExpr(lv, subst, expr.contents[0]),
        substituteBlockExpr(lv, subst, expr.contents[1]),
      ],
    };
  } else if (expr.tag === "VectorAccess") {
    return {
      ...expr,
      contents: [
        substitutePath(lv, subst, expr.contents[0]),
        substituteBlockExpr(lv, subst, expr.contents[1]),
      ],
    };
  } else if (expr.tag === "MatrixAccess") {
    return {
      ...expr,
      contents: [
        substitutePath(lv, subst, expr.contents[0]),
        expr.contents[1].map((e) => substituteBlockExpr(lv, subst, e)),
      ],
    };
  } else if (
    expr.tag === "Fix" ||
    expr.tag === "Vary" ||
    expr.tag === "VaryAD" || // technically is not present at this stage
    expr.tag === "VaryInit" ||
    expr.tag === "StringLit" ||
    expr.tag === "BoolLit"
  ) {
    // No substitution for literals
    return expr;
  } else {
    console.error("expr", expr);
    throw Error("unknown tag");
  }
};

const substituteLine = (lv: LocalVarSubst, subst: Subst, line: Stmt): Stmt => {
  if (line.tag === "PathAssign") {
    return {
      ...line,
      path: substitutePath(lv, subst, line.path),
      value: substituteBlockExpr(lv, subst, line.value),
    };
  } else if (line.tag === "Override") {
    return {
      ...line,
      path: substitutePath(lv, subst, line.path),
      value: substituteBlockExpr(lv, subst, line.value),
    };
  } else if (line.tag === "Delete") {
    return {
      ...line,
      contents: substitutePath(lv, subst, line.contents),
    };
  } else {
    throw Error(
      "Case should not be reached (anonymous statement should be substituted for a local one in `nameAnonStatements`)"
    );
  }
};

// Assumes a full substitution
const substituteBlock = (
  [subst, si]: [Subst, number],
  [block, bi]: [Block, number],
  name: MaybeVal<string>
): Block => {
  const lvSubst: LocalVarSubst =
    name.tag === "Nothing"
      ? { tag: "LocalVarId", contents: [bi, si] }
      : { tag: "NamespaceId", contents: name.contents };

  return {
    ...block,
    statements: block.statements.map((line) =>
      substituteLine(lvSubst, subst, line)
    ),
  };
};

//#endregion Applying a substitution to a block

// Convert Style expression to Substance expression (for ease of comparison in matching)
// Note: the env is needed to disambiguate SEFuncOrValCons
const toSubExpr = (env: Env, e: SelExpr): SubExpr => {
  if (e.tag === "SEBind") {
    return e.contents.contents;
  } else if (e.tag === "SEFunc") {
    return {
      ...e, // Puts the remnants of e's ASTNode info here -- is that ok?
      tag: "ApplyFunction",
      name: e.name,
      args: e.args.map((e) => toSubExpr(env, e)),
    };
  } else if (e.tag === "SEValCons") {
    return {
      ...e,
      tag: "ApplyConstructor",
      name: e.name,
      args: e.args.map((e) => toSubExpr(env, e)),
    };
  } else if (e.tag === "SEFuncOrValCons") {
    const res = {
      ...e,
      tag: "Func", // Use the generic Substance parse type so on conversion, it can be disambiguated by `disambiguateFunctions`
      name: e.name,
      args: e.args.map((e) => toSubExpr(env, e)),
    };

    disambiguateSubNode(env, res); // mutates res
    return res as SubExpr;
  } else throw Error("unknown tag");
};

const toSubPredArg = (a: PredArg): SubPredArg => {
  if (a.tag === "SEBind") {
    return a.contents.contents;
  } else if (a.tag === "RelPred") {
    return toSubPred(a);
  } else throw Error("unknown tag");
};

// Convert Style predicate to Substance predicate (for ease of comparison in matching)
const toSubPred = (p: RelPred): ApplyPredicate => {
  return {
    ...p,
    tag: "ApplyPredicate",
    name: p.name,
    args: p.args.map(toSubPredArg),
  };
};

const varsEq = (v1: Identifier, v2: Identifier): boolean => {
  return v1.value === v2.value;
};

const subVarsEq = (v1: Identifier, v2: Identifier): boolean => {
  return v1.value === v2.value;
};

const argsEq = (a1: SubPredArg, a2: SubPredArg): boolean => {
  if (a1.tag === "ApplyPredicate" && a2.tag === "ApplyPredicate") {
    return subFnsEq(a1, a2);
  } else if (a1.tag === a2.tag) {
    // both are SubExpr, which are not explicitly tagged
    return subExprsEq(a1 as SubExpr, a2 as SubExpr);
  } else return false; // they are different types
};

const subFnsEq = (p1: any, p2: any): boolean => {
  if (
    !p1.hasOwnProperty("name") ||
    !p1.hasOwnProperty("args") ||
    !p2.hasOwnProperty("name") ||
    !p2.hasOwnProperty("args")
  ) {
    throw Error("expected substance type with name and args properties");
  }

  if (p1.args.length !== p2.args.length) {
    return false;
  }
  // Can use `as` because now we know their lengths are equal
  const allArgsEq = _.zip(p1.args, p2.args).every(([a1, a2]) =>
    argsEq(a1 as SubPredArg, a2 as SubPredArg)
  );
  return p1.name.value === p2.name.value && allArgsEq;
};

const subExprsEq = (e1: SubExpr, e2: SubExpr): boolean => {
  // ts doesn't seem to work well with the more generic way of checking this
  if (e1.tag === "Identifier" && e2.tag === "Identifier") {
    return e1.value === e2.value;
  } else if (
    (e1.tag === "ApplyFunction" && e2.tag === "ApplyFunction") ||
    (e1.tag === "ApplyConstructor" && e2.tag === "ApplyConstructor") ||
    (e1.tag === "Func" && e2.tag === "Func")
  ) {
    return subFnsEq(e1, e2);
  } else if (e1.tag === "Deconstructor" && e2.tag === "Deconstructor") {
    return (
      e1.variable.value === e2.variable.value &&
      e1.field.value === e2.field.value
    );
  } else if (e1.tag === "StringLit" && e2.tag === "StringLit") {
    return e1.contents === e2.contents;
  }

  return false;
};

const exprToVar = (e: SubExpr): Identifier => {
  if (e.tag === "Identifier") {
    return e;
  } else {
    // TODO(errors)
    throw Error(
      "internal error: Style expression matching doesn't yet handle nested exprssions"
    );
  }
};

const toTypeList = (c: ConstructorDecl): TypeConstructor[] => {
  return c.args.map((p) => {
    if (p.type.tag === "TypeConstructor") {
      return p.type;
    }
    throw Error(
      "internal error: expected TypeConstructor in type (expected nullary type)"
    );
  });
};

// TODO: Test this
// For existing judgment G |- T1 <: T2,
// this rule (SUBTYPE-ARROW) checks if the first arrow type (i.e. function or value constructor type) is a subtype of the second
// The arrow types are contravariant in their arguments and covariant in their return type
// e.g. if Cat <: Animal, then Cat -> Cat <: Cat -> Animal, and Animal -> Cat <: Cat -> Cat
const isSubtypeArrow = (
  types1: TypeConstructor[],
  types2: TypeConstructor[],
  e: Env
): boolean => {
  if (types1.length !== types2.length) {
    return false;
  }

  if (types1.length === 0 && types2.length === 0) {
    return true;
  }

  return (
    isDeclaredSubtype(types2[0], types1[0], e) && // Note swap -- contravariant in arguments
    isSubtypeArrow(types1.slice(1), types2.slice(1), e)
  ); // Covariant in return type
};

const exprsMatchArr = (
  varEnv: Env,
  subE: ApplyConstructor,
  styE: ApplyConstructor
): boolean => {
  const subArrType = varEnv.constructors.get(subE.name.value);
  if (!subArrType) {
    // TODO(errors)
    throw Error("internal error: sub arr type doesn't exist");
  }

  const styArrType = varEnv.constructors.get(styE.name.value);
  if (!styArrType) {
    // TODO(errors)
    throw Error("internal error: sty arr type doesn't exist");
  }

  if (subE.args.length !== styE.args.length) {
    return false;
  }

  const subArrTypes = toTypeList(subArrType);
  const styArrTypes = toTypeList(styArrType);
  const subVarArgs = subE.args.map(exprToVar);
  const styVarArgs = styE.args.map(exprToVar);

  return (
    isSubtypeArrow(subArrTypes, styArrTypes, varEnv) &&
    _.zip(subVarArgs, styVarArgs).every(([a1, a2]) =>
      varsEq(a1 as Identifier, a2 as Identifier)
    )
  );
  // `as` is fine bc of preceding length check
};

// New judgment (number?): expression matching that accounts for subtyping. G, B, . |- E0 <| E1
// We assume the latter expression has already had a substitution applied
const exprsMatch = (typeEnv: Env, subE: SubExpr, selE: SubExpr): boolean => {
  // We match value constructor applications if one val ctor is a subtype of another
  // whereas for function applications, we match only if the exprs are equal (for now)
  // This is because a val ctor doesn't "do" anything besides wrap its values
  // whereas functions with the same type could do very different things, so we don't
  // necessarily want to match them by subtyping
  // (e.g. think of the infinite functions from Vector -> Vector)

  // rule Match-Expr-Var
  if (subE.tag === "Identifier" && selE.tag === "Identifier") {
    return subVarsEq(subE, selE);
  } else if (subE.tag === "ApplyFunction" && selE.tag === "ApplyFunction") {
    // rule Match-Expr-Fnapp
    return subExprsEq(subE, selE);
  } else if (
    subE.tag === "ApplyConstructor" &&
    selE.tag === "ApplyConstructor"
  ) {
    // rule Match-Expr-Vconsapp
    return exprsMatchArr(typeEnv, subE, selE);
  } else {
    return false;
  }
};

// Judgment 11. b; theta |- S <| |S_r
// After all Substance variables from a Style substitution are substituted in, check if
const relMatchesLine = (
  typeEnv: Env,
  subEnv: SubstanceEnv,
  s1: SubStmt,
  s2: RelationPattern
): boolean => {
  if (s1.tag === "Bind" && s2.tag === "RelBind") {
    // rule Bind-Match
    const bvar = s2.id;
    if (s2.id.tag === "StyVar") {
      // internal error
      throw Error(
        `Style variable ${
          s2.id.contents.value
        } found in relational statement ${ppRel(s2)}. Should not be present!`
      );
    } else if (s2.id.tag === "SubVar") {
      // B |- E = |E
      const [subVar, sVar] = [s1.variable, s2.id.contents.value];
      const selExpr = toSubExpr(typeEnv, s2.expr);
      const subExpr = s1.expr;
      return (
        subVarsEq(subVar, dummyId(sVar)) &&
        exprsMatch(typeEnv, subExpr, selExpr)
      );
      // COMBAK: Add this condition when this is implemented in the Substance typechecker
      // || exprsDeclaredEqual(subEnv, expr, selExpr); // B |- E = |E
    } else throw Error("unknown tag");
  } else if (s1.tag === "ApplyPredicate" && s2.tag === "RelPred") {
    // rule Pred-Match
    const [pred, sPred] = [s1, s2];
    const selPred = toSubPred(sPred);
    return subFnsEq(pred, selPred);
    // COMBAK: Add this condition when the Substance typechecker is implemented -- where is the equivalent function to `predsDeclaredEqual` in the new code?
    // || C.predsDeclaredEqual subEnv pred selPred // B |- Q <-> |Q
  } else {
    return false; // Only match two bind lines or two predicate lines
  }
};

// Judgment 13. b |- [S] <| |S_r
const relMatchesProg = (
  typeEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  rel: RelationPattern
): boolean => {
  return subProg.statements.some((line) =>
    relMatchesLine(typeEnv, subEnv, line, rel)
  );
};

// Judgment 15. b |- [S] <| [|S_r]
const allRelsMatch = (
  typeEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  rels: RelationPattern[]
): boolean => {
  return rels.every((rel) => relMatchesProg(typeEnv, subEnv, subProg, rel));
};

// Judgment 17. b; [theta] |- [S] <| [|S_r] ~> [theta']
// Folds over [theta]
const filterRels = (
  typeEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  rels: RelationPattern[],
  substs: Subst[]
): Subst[] => {
  const subProgFiltered: SubProg = {
    ...subProg,
    statements: subProg.statements.filter((line) =>
      couldMatchRels(typeEnv, rels, line)
    ),
  };
  return substs.filter((subst) =>
    allRelsMatch(typeEnv, subEnv, subProgFiltered, substituteRels(subst, rels))
  );
};

// // Match declaration statements

// // Substitution helper functions
// (+) operator combines two substitutions: subst -> subst -> subst
const combine = (s1: Subst, s2: Subst): Subst => {
  return { ...s1, ...s2 };
};

// TODO check for duplicate keys (and vals)
// (x) operator combines two lists of substitutions: [subst] -> [subst] -> [subst]
// the way merge is used, I think each subst in the second argument only contains one mapping
const merge = (s1: Subst[], s2: Subst[]): Subst[] => {
  if (s2.length === 0) {
    return s1;
  }
  if (s1.length === 0) {
    return s2;
  }
  return cartesianProduct(s1, s2).map(([a, b]: Subst[]) => combine(a, b));
};

// Judgment 9. G; theta |- T <| |T
// Assumes types are nullary, so doesn't return a subst, only a bool indicating whether the types matched
// Ported from `matchType`
const typesMatched = (
  varEnv: Env,
  substanceType: TypeConsApp,
  styleType: StyT
): boolean => {
  if (
    substanceType.tag === "TypeConstructor" &&
    substanceType.args.length === 0
  ) {
    // Style type needs to be more generic than Style type
    return isDeclaredSubtype(substanceType, toSubstanceType(styleType), varEnv);
  }

  // TODO(errors)
  console.log(substanceType, styleType);
  throw Error(
    "internal error: expected two nullary types (parametrized types to be implemented)"
  );
};

// Judgment 10. theta |- x <| B
const matchBvar = (subVar: Identifier, bf: BindingForm): MaybeVal<Subst> => {
  if (bf.tag === "StyVar") {
    const newSubst = {};
    newSubst[toString(bf)] = subVar.value; // StyVar matched SubVar
    return {
      tag: "Just",
      contents: newSubst,
    };
  } else if (bf.tag === "SubVar") {
    if (subVar.value === bf.contents.value) {
      // Substance variables matched; comparing string equality
      return {
        tag: "Just",
        contents: {},
      };
    } else {
      return { tag: "Nothing" }; // TODO: Note, here we distinguish between an empty substitution and no substitution... but why?
    }
  } else throw Error("unknown tag");
};

// Judgment 12. G; theta |- S <| |S_o
// TODO: Not sure why Maybe<Subst> doesn't work in the type signature?
const matchDeclLine = (
  varEnv: Env,
  line: SubStmt,
  decl: DeclPattern
): MaybeVal<Subst> => {
  if (line.tag === "Decl") {
    const [subT, subVar] = [line.type, line.name];
    const [styT, bvar] = [decl.type, decl.id];

    // substitution is only valid if types matched first
    if (typesMatched(varEnv, subT, styT)) {
      return matchBvar(subVar, bvar);
    }
  }

  // Sty decls only match Sub decls
  return { tag: "Nothing" };
};

// Judgment 16. G; [theta] |- [S] <| [|S_o] ~> [theta']
const matchDecl = (
  varEnv: Env,
  subProg: SubProg,
  initSubsts: Subst[],
  decl: DeclPattern
): Subst[] => {
  // Judgment 14. G; [theta] |- [S] <| |S_o
  const newSubsts = subProg.statements.map((line) =>
    matchDeclLine(varEnv, line, decl)
  );
  const res = merge(initSubsts, justs(newSubsts)); // TODO inline
  // COMBAK: Inline this
  // console.log("substs to combine:", initSubsts, justs(newSubsts));
  // console.log("res", res);
  return res;
};

// Judgment 18. G; [theta] |- [S] <| [|S_o] ~> [theta']
// Folds over [|S_o]
const matchDecls = (
  varEnv: Env,
  subProg: SubProg,
  decls: DeclPattern[],
  initSubsts: Subst[]
): Subst[] => {
  return decls.reduce(
    (substs, decl) => matchDecl(varEnv, subProg, substs, decl),
    initSubsts
  );
};

// Judgment 19. g; G; b; [theta] |- [S] <| Sel
// NOTE: this uses little gamma (not in paper) to check substitution validity
// ported from `find_substs_sel`
const findSubstsSel = (
  varEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  [header, selEnv]: [Header, SelEnv]
): Subst[] => {
  if (header.tag === "Selector") {
    const sel = header;
    const decls = sel.head.contents.concat(safeContentsList(sel.with));
    const rels = safeContentsList(sel.where);
    const initSubsts: Subst[] = [];

    const rawSubsts = matchDecls(varEnv, subProg, decls, initSubsts);

    const substCandidates = rawSubsts.filter((subst) =>
      fullSubst(selEnv, subst)
    );

    const filteredSubsts = filterRels(
      varEnv,
      subEnv,
      subProg,
      rels,
      substCandidates
    );

    const correctSubsts = filteredSubsts.filter(uniqueKeysAndVals);

    const correctSubstsWithAliasSubsts = correctSubsts.map((subst) =>
      addRelPredAliasSubsts(subst, rels)
    );

    return correctSubstsWithAliasSubsts;
  } else if (header.tag === "Namespace") {
    // No substitutions for a namespace (not in paper)
    return [];
  } else throw Error("unknown tag");
};

// Find a list of substitutions for each selector in the Sty program. (ported from `find_substs_prog`)
export const findSubstsProg = (
  varEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  styProg: HeaderBlock[],
  selEnvs: SelEnv[]
): Subst[][] => {
  if (selEnvs.length !== styProg.length) {
    throw Error("expected same # selEnvs as selectors");
  }
  const selsWithEnvs = _.zip(
    styProg.map((e: HeaderBlock) => e.header),
    selEnvs
  ); // TODO: Why can't I type it [Header, SelEnv][]? It shouldn't be undefined after the length check

  return selsWithEnvs.map((selAndEnv) =>
    findSubstsSel(varEnv, subEnv, subProg, selAndEnv as [Header, SelEnv])
  );
};

//#endregion

//#region Naming anon statements

// Style AST preprocessing:
// For any anonymous statement only (e.g. `encourage near(x.shape, y.shape)`),
// replace it with a named statement (`local.<UNIQUE_ID> = encourage near(x.shape, y.shape)`)
// Note the UNIQUE_ID only needs to be unique within a block (since local will assign another ID that's globally-unique)
// Leave all other statements unchanged

const nameAnonStatement = (
  [i, b]: [number, Stmt[]],
  s: Stmt
): [number, Stmt[]] => {
  // Transform stmt into local variable assignment "ANON_$counter = e" and increment counter
  if (s.tag === "AnonAssign") {
    const stmt: Stmt = {
      ...s,
      tag: "PathAssign",
      type: { tag: "TypeOf", contents: "Nothing" }, // TODO: Why is it parsed like this?
      path: {
        tag: "InternalLocalVar",
        contents: `\$${ANON_KEYWORD}_${i}`,
        nodeType: "SyntheticStyle",
        children: [], // Unused bc compiler internal
      },
      value: s.contents,
    };
    return [i + 1, b.concat([stmt])];
  } else {
    return [i, b.concat([s])];
  }
};

const nameAnonBlock = (b: Block): Block => {
  return {
    ...b,
    statements: b.statements.reduce(
      (acc, curr) => nameAnonStatement(acc, curr), // Not sure why this can't be point-free
      [0, []] as [number, Stmt[]]
    )[1],
  };
};

export const nameAnonStatements = (prog: StyProg): StyProg => {
  const p = prog.blocks;
  return {
    ...prog,
    blocks: p.map((hb) => ({ ...hb, block: nameAnonBlock(hb.block) })),
  };
};

//#endregion

//#region Translating Style program

const initTrans = (): Translation => {
  return { trMap: {}, warnings: [] };
};

// /////// Translation judgments
/* Note: All of the folds below use foldM.
   foldM stops accumulating when the first fatal error is reached, using "Either [Error]" as a monad
   (Non-fatal errors are stored as warnings in the translation)
   foldM :: Monad m => (a -> b -> m a) -> a -> [b] -> m a
   example:
   f acc elem = if elem < 0 then Left ["wrong " ++ show elem] else Right $ elem : acc
   foldM f [] [1, 9, -1, 2, -2] = Left ["wrong -1"]
   foldM f [] [1, 9] = Right [9,1]  */
// Judgment 26. D |- phi ~> D'
// This is where interesting things actually happen (each line is interpreted and added to the translation)

// Related functions in `Evaluator`: findExprSafe, insertExpr

// Note this mutates the translation, and we return the translation reference just as a courtesy
const deleteProperty = (
  trans: Translation,
  path: Path, // used for ASTNode info
  name: BindingForm,
  field: Identifier,
  property: Identifier
): Translation => {
  const trn = trans.trMap;

  const nm = name.contents.value;
  const fld = field.value;
  const prp = property.value;

  const fieldDict = trn[nm];

  if (!fieldDict) {
    // TODO(errors / warnings): Should this be fatal?
    return addWarn(trans, {
      tag: "DeletedPropWithNoSubObjError",
      subObj: name,
      path,
    });
  }

  const prop: FieldExpr<VarAD> = fieldDict[fld];

  if (!prop) {
    // TODO(errors / warnings): Should this be fatal?
    return addWarn(trans, {
      tag: "DeletedPropWithNoFieldError",
      subObj: name,
      field,
      path,
    });
  }

  if (prop.tag === "FExpr") {
    // Deal with GPI aliasing (i.e. only happens if a GPI is aliased to another, and some operation is performed on the aliased GPI's property, it happens to the original)
    // COMBAK: should path aliasing have destructive effects on the translation (e.g. add or delete)? maybe it should only happen in lookup? Deleting an aliased path should just delete the alias, not its referent?
    // TODO: Test this

    if (prop.contents.tag === "OptEval") {
      if (prop.contents.contents.tag === "FieldPath") {
        const p = prop.contents.contents;
        if (varsEq(p.name.contents, name.contents) && varsEq(p.field, field)) {
          // TODO(error)
          return addWarn(trans, {
            tag: "CircularPathAlias",
            path: { tag: "FieldPath", name, field } as Path,
          });
        }
        return deleteProperty(trans, p, p.name, p.field, property);
      }
    }

    // TODO(error)
    return addWarn(trans, {
      tag: "DeletedPropWithNoGPIError",
      subObj: name,
      field,
      property,
      path,
    });
  } else if (prop.tag === "FGPI") {
    // TODO(error, warning): check if the property is member of properties of GPI
    const gpiDict = prop.contents[1];
    delete gpiDict.prp;
    return trans;
  } else throw Error("unknown tag");
};

// Note this mutates the translation, and we return the translation reference just as a courtesy
const deleteField = (
  trans: Translation,
  path: Path,
  name: BindingForm,
  field: Identifier
): Translation => {
  // TODO(errors): Pass in the original path for error reporting
  const trn = trans.trMap;
  const fieldDict = trn[name.contents.value];

  if (!fieldDict) {
    // TODO(errors / warnings)
    return addWarn(trans, {
      tag: "DeletedNonexistentFieldError",
      subObj: name,
      field,
      path,
    });
  }

  if (!(field.value in fieldDict)) {
    // TODO(errors / warnings)
    return addWarn(trans, {
      tag: "DeletedNonexistentFieldError",
      subObj: name,
      field,
      path,
    });
  }

  delete fieldDict[field.value];
  return trans;
};

// NOTE: This function mutates the translation
// rule Line-delete
const deletePath = (
  trans: Translation,
  path: Path
): Either<StyleErrors, Translation> => {
  if (path.tag === "FieldPath") {
    const transWithWarnings = deleteField(trans, path, path.name, path.field);
    return toRight(transWithWarnings);
  } else if (path.tag === "PropertyPath") {
    const transWithWarnings = deleteProperty(
      trans,
      path,
      path.name,
      path.field,
      path.property
    );
    return toRight(transWithWarnings);
  } else if (path.tag === "AccessPath") {
    // TODO(error)
    const err: StyleError = { tag: "DeletedVectorElemError", path };
    return toLeft([err]);
  } else if (path.tag === "InternalLocalVar") {
    throw Error(
      "Compiler should not be deleting a local variable; this should have been removed in a earlier compiler pass"
    );
  } else throw Error("unknown tag");
};

// NOTE: This function mutates the translation
const addPath = (
  override: boolean,
  trans: Translation,
  path: Path,
  expr: TagExpr<VarAD>
): Either<StyleErrors, Translation> => {
  // Extended `insertExpr` with an optional flag to deal with errors and warnings
  // `insertExpr` replaces the old .hs functions `addField` and `addProperty`

  // Check insertExpr's errors and warnings first
  const tr2 = insertExpr(path, expr, trans, true, override);
  if (tr2.warnings.length > 0) {
    return toLeft(tr2.warnings);
  }

  return toRight(tr2);
};

const translateLine = (
  trans: Translation,
  stmt: Stmt
): Either<StyleErrors, Translation> => {
  if (stmt.tag === "PathAssign") {
    return addPath(false, trans, stmt.path, {
      tag: "OptEval",
      contents: stmt.value,
    });
  } else if (stmt.tag === "Override") {
    return addPath(true, trans, stmt.path, {
      tag: "OptEval",
      contents: stmt.value,
    });
  } else if (stmt.tag === "Delete") {
    return deletePath(trans, stmt.contents);
  } else throw Error("unknown tag");
};

// Judgment 25. D |- |B ~> D' (modified to be: theta; D |- |B ~> D')
const translateBlock = (
  name: MaybeVal<string>,
  blockWithNum: [Block, number],
  trans: Translation,
  substWithNum: [Subst, number]
): Either<StyleErrors, Translation> => {
  const blockSubsted: Block = substituteBlock(substWithNum, blockWithNum, name);

  return foldM(blockSubsted.statements, translateLine, trans);
};

// Judgment 24. [theta]; D |- |B ~> D'
// This is a selector, not a namespace, so we substitute local vars with the subst/block IDs
const translateSubstsBlock = (
  trans: Translation,
  substsNum: [Subst, number][],
  blockWithNum: [Block, number]
): Either<StyleErrors, Translation> => {
  return foldM(
    substsNum,
    (trans, substNum, i) =>
      translateBlock({ tag: "Nothing" }, blockWithNum, trans, substNum),
    trans
  );
};

//#region Block statics
const emptyErrs = () => {
  return { errors: [], warnings: [] };
};

const oneErr = (err: StyleError): StyleResults => {
  return { errors: [err], warnings: [] };
};

const combineErrs = (e1: StyleResults, e2: StyleResults): StyleResults => {
  return {
    errors: e1.errors.concat(e2.errors),
    warnings: e1.warnings.concat(e2.warnings),
  };
};

const flatErrs = (es: StyleResults[]): StyleResults => {
  return {
    errors: _.flatMap(es, (e) => e.errors),
    warnings: _.flatMap(es, (e) => e.warnings),
  };
};

// Check that every shape name and shape property name in a shape constructor exists
const checkGPIInfo = (selEnv: SelEnv, expr: GPIDecl): StyleResults => {
  const styName: string = expr.shapeName.value;

  const errors: StyleErrors = [];
  const warnings: StyleWarnings = [];

  const shapeNames: string[] = shapedefs.map((e: ShapeDef) => e.shapeType);
  if (!shapeNames.includes(styName)) {
    // Fatal error -- we cannot check the shape properties (unless you want to guess the shape)
    return oneErr({ tag: "InvalidGPITypeError", givenType: expr.shapeName });
  }

  // `findDef` throws an error, so we find the shape name first (done above) to make sure the error can be caught
  const shapeDef: ShapeDef = findDef(styName);
  const givenProperties: Identifier[] = expr.properties.map((e) => e.name);
  const expectedProperties: string[] = Object.entries(shapeDef.properties).map(
    (e) => e[0]
  );

  for (let gp of givenProperties) {
    // Check multiple properties, as each one is not fatal if wrong
    if (!expectedProperties.includes(gp.value)) {
      errors.push({
        tag: "InvalidGPIPropertyError",
        givenProperty: gp,
        expectedProperties,
      });
    }
  }

  return { errors, warnings };
};

// Check that every function, objective, and constraint exists (below) -- parametrically over the kind of function
const checkFunctionName = (
  selEnv: SelEnv,
  expr: ICompApp | IObjFn | IConstrFn
): StyleResults => {
  const fnDict = FN_DICT[expr.tag];
  const fnNames: string[] = _.keys(fnDict); // Names of built-in functions of that kind
  const givenFnName: Identifier = expr.name;

  if (
    !fnNames.includes(givenFnName.value) &&
    givenFnName.value !== VARYING_INIT_FN_NAME
  ) {
    const fnErrorType = FN_ERR_TYPE[expr.tag];
    return oneErr({ tag: fnErrorType, givenName: givenFnName });
  }

  return emptyErrs();
};

// Written recursively on exprs, just accumulating possible expr errors
const checkBlockExpr = (selEnv: SelEnv, expr: Expr): StyleResults => {
  // Closure for brevity
  const check = (e: Expr): StyleResults => checkBlockExpr(selEnv, e);

  if (isPath(expr)) {
    return checkBlockPath(selEnv, expr);
  } else if (
    expr.tag === "CompApp" ||
    expr.tag === "ObjFn" ||
    expr.tag === "ConstrFn"
  ) {
    const e1 = checkFunctionName(selEnv, expr);
    const e2 = expr.args.map(check);
    return flatErrs([e1].concat(e2));
  } else if (expr.tag === "BinOp") {
    return flatErrs([check(expr.left), check(expr.right)]);
  } else if (expr.tag === "UOp") {
    return check(expr.arg);
  } else if (
    expr.tag === "List" ||
    expr.tag === "Vector" ||
    expr.tag === "Matrix"
  ) {
    return flatErrs(expr.contents.map(check));
  } else if (expr.tag === "ListAccess") {
    return emptyErrs();
  } else if (expr.tag === "GPIDecl") {
    const e1: StyleResults = checkGPIInfo(selEnv, expr);
    const e2: StyleResults[] = expr.properties.map((p) => check(p.value));
    return flatErrs([e1].concat(e2));
  } else if (expr.tag === "Layering") {
    return flatErrs([check(expr.below), check(expr.above)]);
  } else if (expr.tag === "PluginAccess") {
    return flatErrs([check(expr.contents[1]), check(expr.contents[2])]);
  } else if (expr.tag === "Tuple") {
    return flatErrs([check(expr.contents[0]), check(expr.contents[1])]);
  } else if (expr.tag === "VectorAccess") {
    return check(expr.contents[1]);
  } else if (expr.tag === "MatrixAccess") {
    return flatErrs(expr.contents[1].map(check));
  } else if (
    expr.tag === "Fix" ||
    expr.tag === "Vary" ||
    expr.tag === "VaryInit" ||
    expr.tag === "StringLit" ||
    expr.tag === "BoolLit"
  ) {
    return emptyErrs();
  } else {
    console.error("expr", expr);
    throw Error("unknown tag");
  }
};

const checkBlockPath = (selEnv: SelEnv, path: Path): StyleResults => {
  // TODO(errors) / Block statics
  // Currently there is nothing to check for paths
  return emptyErrs();
};

const checkLine = (
  selEnv: SelEnv,
  line: Stmt,
  acc: StyleResults
): StyleResults => {
  if (line.tag === "PathAssign") {
    const pErrs = checkBlockPath(selEnv, line.path);
    const eErrs = checkBlockExpr(selEnv, line.value);
    return combineErrs(combineErrs(acc, pErrs), eErrs);
  } else if (line.tag === "Override") {
    const pErrs = checkBlockPath(selEnv, line.path);
    const eErrs = checkBlockExpr(selEnv, line.value);
    return combineErrs(combineErrs(acc, pErrs), eErrs);
  } else if (line.tag === "Delete") {
    const pErrs = checkBlockPath(selEnv, line.contents);
    return combineErrs(acc, pErrs);
  } else {
    throw Error(
      "Case should not be reached (anonymous statement should be substituted for a local one in `nameAnonStatements`)"
    );
  }
};

const checkBlock = (selEnv: SelEnv, block: Block): StyleErrors => {
  // Block checking; static semantics
  // The below properties are checked in one pass (a fold) over the Style AST:

  // Check that every shape name and shape property name in a shape constructor exists
  // Check that every function, objective, and constraint exists
  // NOT CHECKED as this requires more advanced env-building work: At path construction time, check that every Substance object exists in the environment of the block + selector, or that it's defined as a local variable

  const res: StyleResults = block.statements.reduce(
    (acc: StyleResults, stmt: Stmt): StyleResults =>
      checkLine(selEnv, stmt, acc),
    emptyErrs()
  );

  // TODO(errors): Return warnings (non-fatally); currently there are no warnings though
  if (res.warnings.length > 0) {
    console.error("warnings", res.warnings);
    throw Error("Internal error: report these warnings");
  }

  return res.errors;
};

//#endregion Block statics

// Judgment 23, contd.
const translatePair = (
  varEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  trans: Translation,
  hb: HeaderBlock,
  blockNum: number
): Either<StyleErrors, Translation> => {
  if (hb.header.tag === "Namespace") {
    const selEnv = initSelEnv();
    const bErrs = checkBlock(selEnv, hb.block); // TODO: block statics

    if (selEnv.errors.length > 0 || bErrs.length > 0) {
      // This is a namespace, not selector, so we substitute local vars with the namespace's name
      // skip transSubstsBlock; only one subst
      return {
        tag: "Left",
        contents: selEnv.errors.concat(bErrs),
      };
    }

    const subst = {};
    // COMBAK / errors: Keep the AST node from `hb.header` for error reporting?
    return translateBlock(
      {
        tag: "Just",
        contents: (hb.header.contents.contents.value as any) as string,
      },
      [hb.block, blockNum],
      trans,
      [subst, 0]
    );
  } else if (hb.header.tag === "Selector") {
    const selEnv = checkHeader(varEnv, hb.header);
    const bErrs = checkBlock(selEnv, hb.block); // TODO: block statics

    // If any Substance variable in the selector environment doesn't exist in the Substance program (e.g. Set `A`),
    // skip this block (because the Substance variable won't exist in the translation)

    if (selEnv.skipBlock) {
      return toRight(trans);
    }

    if (selEnv.errors.length > 0 || bErrs.length > 0) {
      return {
        tag: "Left",
        contents: selEnv.errors.concat(bErrs),
      };
    }

    // For creating unique local var names
    const substs = findSubstsSel(varEnv, subEnv, subProg, [hb.header, selEnv]);

    return translateSubstsBlock(trans, numbered(substs), [hb.block, blockNum]);
  } else throw Error("unknown tag");
};

// Map a function over the translation
const mapTrans = (
  trans: Translation,
  f: (name: string, fieldDict: FieldDict) => [string, FieldDict]
): Translation => {
  return {
    ...trans,
    trMap: Object.fromEntries(
      Object.entries(trans.trMap).map(([n, fd]) => f(n, fd))
    ),
  };
};

// Note, this mutates the translation
const insertNames = (trans: Translation): Translation => {
  const insertName = (
    name: string,
    fieldDict: FieldDict
  ): [string, FieldDict] => {
    fieldDict.name = {
      tag: "FExpr",
      contents: {
        tag: "Done",
        contents: { tag: "StrV", contents: name },
      },
    };
    return [name, fieldDict];
  };

  return mapTrans(trans, insertName);
};

// Note, this mutates the translation
const insertLabels = (trans: Translation, labels: LabelMap): Translation => {
  const insertLabel = (
    name: string,
    fieldDict: FieldDict
  ): [string, FieldDict] => {
    let labelRes = labels.get(name);

    if (!labelRes) {
      // We skip here, to avoid putting spurious labels in for namespaces in the translation.
      return [name, fieldDict];
    }

    let label;
    if (labelRes.isJust()) {
      label = labelRes.value;
    } else {
      // TODO: Distinguish between no label and empty label?
      label = "";
    }

    fieldDict[LABEL_FIELD] = {
      tag: "FExpr",
      contents: {
        tag: "Done",
        contents: {
          tag: "StrV",
          contents: label,
        },
      },
    };
    return [name, fieldDict];
  };

  return mapTrans(trans, insertLabel);
};

const translateStyProg = (
  varEnv: Env,
  subEnv: SubstanceEnv,
  subProg: SubProg,
  styProg: StyProg,
  labelMap: LabelMap,
  styVals: number[]
): Either<StyleErrors, Translation> => {
  // COMBAK: Deal with styVals

  const res = foldM(
    styProg.blocks,
    (trans, hb, i) => translatePair(varEnv, subEnv, subProg, trans, hb, i),
    initTrans()
  );

  if (isLeft(res)) {
    return res;
  } // Return errors

  const trans = res.contents;
  const transWithNames = insertNames(trans);
  const transWithNamesAndLabels = insertLabels(transWithNames, labelMap);

  // COMBAK: Do this with plugins
  // const styValMap = styJsonToMap(styVals);
  // const transWithPlugins = evalPluginAccess(styValMap, transWithNamesAndLabels);
  // return Right(transWithPlugins);
  return toRight(transWithNamesAndLabels);
};

//#endregion

// BEGIN GENOPTPROBLEM.HS PORT

//#region Translation utilities -- TODO move to EngineUtils

function foldFields<T>(
  f: (s: string, field: Field, fexpr: FieldExpr<VarAD>, acc: T[]) => T[],
  [name, fieldDict]: [string, { [k: string]: FieldExpr<VarAD> }],
  acc: T[]
): T[] {
  const res: T[] = Object.entries(fieldDict).reduce(
    (acc: T[], [field, expr]) => f(name, field, expr, acc),
    []
  );
  return res.concat(acc);
}

function foldSubObjs<T>(
  f: (s: string, f: Field, fexpr: FieldExpr<VarAD>, acc: T[]) => T[],
  tr: Translation
): T[] {
  return Object.entries(tr.trMap).reduce(
    (acc: T[], curr) => foldFields(f, curr, acc),
    []
  );
}

//#endregion

//#region Gen opt problem

// Find varying (float) paths
// For now, don't optimize these float-valued properties of a GPI
// (use whatever they are initialized to in Shapes or set to in Style)
const unoptimizedFloatProperties: string[] = [
  "rotation",
  "strokeWidth",
  "thickness",
  "transform",
  "transformation",
  "opacity",
  "finalW",
  "finalH",
  "arrowheadSize",
];

const optimizedVectorProperties: string[] = ["start", "end", "center"];

const declaredVarying = (t: TagExpr<VarAD>): boolean => {
  if (t.tag === "OptEval") {
    return isVarying(t.contents);
  }

  return false;
};

const mkPath = (strs: string[]): Path => {
  if (strs.length === 2) {
    const [name, field] = strs;
    return {
      tag: "FieldPath",
      nodeType: "SyntheticStyle",
      children: [],
      name: {
        nodeType: "SyntheticStyle",
        children: [],
        tag: "SubVar",
        contents: {
          ...dummyId(name),
        },
      },
      field: dummyId(field),
    };
  } else if (strs.length === 3) {
    const [name, field, prop] = strs;
    return {
      tag: "PropertyPath",
      nodeType: "SyntheticStyle",
      children: [],
      name: {
        nodeType: "SyntheticStyle",
        children: [],
        tag: "SubVar",
        contents: {
          ...dummyId(name),
        },
      },
      field: dummyId(field),
      property: dummyId(prop),
    };
  } else throw Error("bad # inputs");
};

const pendingProperties = (s: ShapeTypeStr): PropID[] => {
  if (s === "Text") return ["w", "h"];
  if (s === "TextTransform") return ["w", "h"];
  if (s === "ImageTransform") return ["initWidth", "initHeight"];
  return [];
};

const isVarying = (e: Expr): boolean => {
  return e.tag === "Vary" || e.tag === "VaryInit";
};

const isPending = (s: ShapeTypeStr, p: PropID): boolean => {
  return pendingProperties(s).includes(p);
};

// ---- FINDING VARIOUS THINGS IN THE TRANSLATION

const findPropertyVarying = (
  name: string,
  field: Field,
  properties: { [k: string]: TagExpr<VarAD> },
  floatProperty: string,
  acc: Path[]
): Path[] => {
  const expr = properties[floatProperty];
  const path = mkPath([name, field, floatProperty]);

  if (!expr) {
    if (unoptimizedFloatProperties.includes(floatProperty)) {
      return acc;
    }

    if (optimizedVectorProperties.includes(floatProperty)) {
      const defaultVec2: TagExpr<VarAD> = {
        tag: "OptEval",
        contents: {
          nodeType: "SyntheticStyle",
          children: [],
          tag: "Vector",
          contents: [
            dummyASTNode({ tag: "Vary" }, "SyntheticStyle") as Expr,
            dummyASTNode({ tag: "Vary" }, "SyntheticStyle") as Expr,
          ],
        },
      };
      // Return paths for both elements, COMBAK: This hardcodes that unset vectors have 2 elements, need to generalize
      const paths = findNestedVarying(defaultVec2, path);
      return paths.concat(acc);
    }

    return [path].concat(acc);
  } else {
    if (declaredVarying(expr)) {
      return [path].concat(acc);
    }
  }

  const paths = findNestedVarying(expr, path);
  return paths.concat(acc);
};

// Look for nested varying variables, given the path to its parent var (e.g. `x.r` => (-1.2, ?)) => `x.r`[1] is varying
const findNestedVarying = (e: TagExpr<VarAD>, p: Path): Path[] => {
  if (e.tag === "OptEval") {
    const res = e.contents;
    if (res.tag === "Vector") {
      const elems: Expr[] = res.contents;
      const indices: Path[] = elems
        .map((e: Expr, i): [Expr, number] => [e, i])
        .filter((e: [Expr, number]): boolean => isVarying(e[0]))
        .map(
          ([e, i]: [Expr, number]): IAccessPath =>
            ({
              nodeType: "SyntheticStyle",
              children: [],
              tag: "AccessPath",
              path: p,
              indices: [
                dummyASTNode({ tag: "Fix", contents: i }, "SyntheticStyle"),
              ],
            } as IAccessPath)
        );

      return indices;
    } else if (
      res.tag === "Matrix" ||
      res.tag === "List" ||
      res.tag === "Tuple"
    ) {
      // COMBAK: This should search, but for now we just don't handle nested varying vars in these
      return [];
    }
  }

  return [];
};

// Given 'propType' and 'shapeType', return all props of that ValueType
// COMBAK: Model "FloatT", "FloatV", etc as types for ValueType
const propertiesOf = (propType: string, shapeType: ShapeTypeStr): PropID[] => {
  const shapeInfo: [string, [PropType, Sampler]][] = Object.entries(
    findDef(shapeType).properties
  );
  return shapeInfo
    .filter(([pName, [pType, s]]) => pType === propType)
    .map((e) => e[0]);
};

// Given 'propType' and 'shapeType', return all props NOT of that ValueType
const propertiesNotOf = (
  propType: string,
  shapeType: ShapeTypeStr
): PropID[] => {
  const shapeInfo: [string, [PropType, Sampler]][] = Object.entries(
    findDef(shapeType).properties
  );
  return shapeInfo
    .filter(([pName, [pType, s]]) => pType !== propType)
    .map((e) => e[0]);
};

// Find varying fields
const findFieldVarying = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Path[]
): Path[] => {
  if (fexpr.tag === "FExpr") {
    if (declaredVarying(fexpr.contents)) {
      return [mkPath([name, field])].concat(acc);
    }

    const paths = findNestedVarying(fexpr.contents, mkPath([name, field]));
    return paths.concat(acc);
  } else if (fexpr.tag === "FGPI") {
    const [typ, properties] = fexpr.contents;
    const ctorFloats = propertiesOf("FloatV", typ).concat(
      propertiesOf("VectorV", typ)
    );
    const varyingFloats = ctorFloats.filter((e) => !isPending(typ, e));
    // This splits up vector-typed properties into one path for each element
    const vs: Path[] = varyingFloats.reduce(
      (acc: Path[], curr) =>
        findPropertyVarying(name, field, properties, curr, acc),
      []
    );
    return vs.concat(acc);
  } else throw Error("unknown tag");
};

// Find all varying paths
const findVarying = (tr: Translation): Path[] => {
  return foldSubObjs(findFieldVarying, tr);
};

// Find uninitialized (non-float) property paths
const findPropertyUninitialized = (
  name: string,
  field: Field,
  properties: GPIMap,
  nonfloatProperty: string,
  acc: Path[]
): Path[] => {
  // nonfloatProperty is a non-float property that is NOT set by the user and thus we can sample it
  const res = properties[nonfloatProperty];
  if (!res) {
    return [mkPath([name, field, nonfloatProperty])].concat(acc);
  }
  return acc;
};

// Find uninitialized fields
const findFieldUninitialized = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Path[]
): Path[] => {
  // NOTE: we don't find uninitialized field because you can't leave them uninitialized. Plus, we don't know what types they are
  if (fexpr.tag === "FExpr") {
    return acc;
  }
  if (fexpr.tag === "FGPI") {
    const [typ, properties] = fexpr.contents;
    const ctorNonfloats = propertiesNotOf("FloatV", typ).filter(
      (e) => e !== "name"
    );
    const uninitializedProps = ctorNonfloats;
    const vs = uninitializedProps.reduce(
      (acc: Path[], curr) =>
        findPropertyUninitialized(name, field, properties, curr, acc),
      []
    );
    return vs.concat(acc);
  }
  throw Error("unknown tag");
};

// NOTE: we don't find uninitialized field because you can't leave them uninitialized. Plus, we don't know what types they are
const findUninitialized = (tr: Translation): Path[] => {
  return foldSubObjs(findFieldUninitialized, tr);
};

// Fold function to return the names of GPIs
const findGPIName = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: [string, Field][]
): [string, Field][] => {
  if (fexpr.tag === "FGPI") {
    return ([[name, field]] as [string, Field][]).concat(acc);
  } else if (fexpr.tag === "FExpr") {
    return acc;
  } else throw Error("unknown tag");
};

// Find shapes and their properties
const findShapeNames = (tr: Translation): [string, string][] => {
  return foldSubObjs(findGPIName, tr);
};

// Find paths that are the properties of shapes
const findShapeProperties = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: [string, Field, Property][]
): [string, Field, Property][] => {
  if (fexpr.tag === "FGPI") {
    const properties = fexpr.contents[1];
    const paths = Object.keys(properties).map(
      (property) => [name, field, property] as [string, Field, Property]
    );
    return paths.concat(acc);
  } else if (fexpr.tag === "FExpr") {
    return acc;
  } else throw Error("unknown tag");
};

// Find paths that are the properties of shapes
const findShapesProperties = (tr: Translation): [string, string, string][] => {
  return foldSubObjs(findShapeProperties, tr);
};

// Find various kinds of functions
const findFieldFns = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Either<StyleOptFn, StyleOptFn>[]
): Either<StyleOptFn, StyleOptFn>[] => {
  if (fexpr.tag === "FExpr") {
    if (fexpr.contents.tag === "OptEval") {
      const e = fexpr.contents.contents;
      // COMBAK: This throws away the function's Identifier for future debugging
      // (Also, why doesn't typescript report an error when `e.name` is an Identifier but a StyleOptFn expects a string, using the `as` keyword?)
      if (e.tag === "ObjFn") {
        const res: Either<StyleOptFn, StyleOptFn> = ToLeft([
          e.name.value,
          e.args,
        ]);
        return [res].concat(acc);
      } else if (e.tag === "ConstrFn") {
        const res: Either<StyleOptFn, StyleOptFn> = ToRight([
          e.name.value,
          e.args,
        ]);
        return [res].concat(acc);
      } else {
        return acc;
      }
    }
  }

  return acc;
};

// Ported from `findObjfnsConstrs`
const findUserAppliedFns = (tr: Translation): [Fn[], Fn[]] => {
  return convertFns(foldSubObjs(findFieldFns, tr));
};

const findFieldDefaultFns = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Either<StyleOptFn, StyleOptFn>[]
): Either<StyleOptFn, StyleOptFn>[] => {
  // TODO < Currently we have no default objectives/constraints, so it's not implemented
  return [];
};

const findDefaultFns = (tr: Translation): [Fn[], Fn[]] => {
  return convertFns(foldSubObjs(findFieldDefaultFns, tr));
};

const toFn = (t: OptType, [name, args]: StyleOptFn): Fn => {
  return {
    fname: name,
    fargs: args,
    optType: t,
  };
};

const toFns = ([objfns, constrfns]: [StyleOptFn[], StyleOptFn[]]): [
  Fn[],
  Fn[]
] => {
  return [
    objfns.map((fn) => toFn("ObjFn", fn)),
    constrfns.map((fn) => toFn("ConstrFn", fn)),
  ];
};

// COMBAK: Move this to utils
function partitionEithers<A, B>(es: Either<A, B>[]): [A[], B[]] {
  return [
    es.filter((e) => e.tag === "Left").map((e) => e.contents as A),
    es.filter((e) => e.tag === "Right").map((e) => e.contents as B),
  ];
}

const convertFns = (fns: Either<StyleOptFn, StyleOptFn>[]): [Fn[], Fn[]] => {
  return toFns(partitionEithers(fns));
};

// Extract number from a more complicated type
// also ported from `lookupPaths`
const getNum = (e: TagExpr<VarAD> | IFGPI<VarAD>): number => {
  if (e.tag === "OptEval") {
    if (e.contents.tag === "Fix") {
      return e.contents.contents;
    }
    if (e.contents.tag === "VaryAD") {
      return e.contents.contents.val;
    } else {
      console.error("input", e);
      throw Error("internal error: invalid varying path");
    }
  } else if (e.tag === "Done") {
    if (e.contents.tag === "FloatV") {
      return numOf(e.contents.contents);
    } else throw Error("internal error: invalid varying path");
  } else if (e.tag === "Pending") {
    throw Error("internal error: invalid varying path");
  } else if (e.tag === "FGPI") {
    throw Error("internal error: invalid varying path");
  } else {
    throw Error("internal error: unknown tag");
  }
};

// ported from `lookupPaths`
// lookup paths with the expectation that each one is a float
export const lookupNumericPaths = (ps: Path[], tr: Translation): number[] => {
  return ps.map((path) => findExprSafe(tr, path)).map(getNum);
};

const findFieldPending = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Path[]
): Path[] => {
  if (fexpr.tag === "FExpr") {
    return acc;
  } else if (fexpr.tag === "FGPI") {
    const properties = fexpr.contents[1];
    const pendingProps = Object.entries(properties)
      .filter(([k, v]) => v.tag === "Pending")
      .map((e: [string, TagExpr<VarAD>]) => e[0]);

    // TODO: Pending properties currently don't support AccessPaths
    return pendingProps
      .map((property) => mkPath([name, field, property]))
      .concat(acc);
  } else throw Error("unknown tag");
};

// Find pending paths
// Find the paths to all pending, non-float, non-name properties
const findPending = (tr: Translation): Path[] => {
  return foldSubObjs(findFieldPending, tr);
};

// ---- INITIALIZATION

const isFieldOrAccessPath = (p: Path): boolean => {
  if (p.tag === "FieldPath") {
    return true;
  } else if (p.tag === "AccessPath") {
    if (p.path.tag === "FieldPath" || p.path.tag === "PropertyPath") {
      return true;
    } else throw Error("unexpected sub-accesspath type");
  }

  return false;
};

// sample varying fields only (from the range defined by canvas dims) and store them in the translation
// example: A.val = OPTIMIZED
// This also samples varying access paths, e.g.
// Circle { center : (1.1, ?) ... } <// the latter is an access path that gets initialized here
// varying init paths are separated out and initialized with the value specified by the style writer
// NOTE: Mutates translation
const initFieldsAndAccessPaths = (
  varyingPaths: Path[],
  tr: Translation
): Translation => {
  const varyingFieldsAndAccessPaths = varyingPaths.filter(isFieldOrAccessPath);
  const canvas = getCanvas(tr);

  const initVals = varyingFieldsAndAccessPaths.map(
    (p: Path): TagExpr<VarAD> => {
      // by default, sample randomly in canvas X range
      let initVal = randFloat(...canvas.xRange);

      // unless it's a VaryInit, in which case, don't sample, set to the init value
      // TODO: This could technically use `varyingInitPathsAndVals`?
      const res = findExpr(tr, p); // Some varying paths may not be in the translation. That's OK.
      if (res.tag === "OptEval") {
        if (res.contents.tag === "VaryInit") {
          initVal = res.contents.contents;
        }
      }

      return {
        tag: "Done",
        contents: {
          tag: "FloatV",
          contents: constOf(initVal),
        },
      };
    }
  );

  const tr2 = insertExprs(
    varyingFieldsAndAccessPaths,
    initVals,
    tr,
    false,
    true
  );

  return tr2;
};

// //////////// Generating an initial state (concrete values for all fields/properties needed to draw the GPIs)
// 1. Initialize all varying fields
// 2. Initialize all properties of all GPIs
// NOTE: since we store all varying paths separately, it is okay to mark the default values as Done // they will still be optimized, if needed.
// TODO: document the logic here (e.g. only sampling varying floats) and think about whether to use translation here or [Shape a] since we will expose the sampler to users later

// TODO: Doesn't sample partial shape properties, like start: (?, 1.) <- this is actually sampled by initFieldsAndAccessPaths
// NOTE: Shape properties are mutated; they are returned as a courtesy
const initProperty = (
  shapeType: ShapeTypeStr,
  properties: GPIProps<VarAD>,
  [propName, [propType, propSampler]]: [string, [PropType, Sampler]],
  canvas: Canvas
): GPIProps<VarAD> => {
  const propVal: Value<number> = propSampler(canvas);
  const propValAD: Value<VarAD> = valueNumberToAutodiffConst(propVal);
  const propValDone: TagExpr<VarAD> = { tag: "Done", contents: propValAD };
  const styleSetting: TagExpr<VarAD> = properties[propName];

  // Property not set in Style
  if (!styleSetting) {
    if (isPending(shapeType, propName)) {
      properties[propName] = {
        tag: "Pending",
        contents: propValAD,
      } as TagExpr<VarAD>;
      return properties;
    } else {
      properties[propName] = propValDone; // Use the sampled one
      return properties;
    }
  }

  // Property set in Style
  if (styleSetting.tag === "OptEval") {
    if (styleSetting.contents.tag === "Vary") {
      properties[propName] = propValDone; // X.prop = ?
      return properties;
    } else if (styleSetting.contents.tag === "VaryInit") {
      // Initialize the varying variable to the property specified in Style
      properties[propName] = {
        tag: "Done",
        contents: {
          tag: "FloatV",
          contents: varOf(styleSetting.contents.contents),
        },
      };
      return properties;
    } else if (styleSetting.contents.tag === "Vector") {
      const v: Expr[] = styleSetting.contents.contents;
      if (v.length === 2) {
        // Sample a whole 2D vector, e.g. `Circle { center : [?, ?] }`
        // (if only one element is set to ?, then presumably it's set by initializing an access path...? TODO: Check this)
        // TODO: This hardcodes an uninitialized 2D vector to be initialized/inserted
        if (v[0].tag === "Vary" && v[1].tag === "Vary") {
          properties[propName] = propValDone;
          return properties;
        }
      }
      return properties;
    } else {
      return properties;
    }
  } else if (styleSetting.tag === "Done") {
    // TODO: pending properties are only marked if the Style source does not set them explicitly
    // Check if this is the right decision. We still give pending values a default such that the initial list of shapes can be generated without errors.
    return properties;
  }

  throw Error("internal error: unknown tag or invalid value for property");
};

const mkShapeName = (s: string, f: Field): string => {
  return `${s}.${f}`;
};

// COMBAK: This will require `getNames` to work
const initShape = (
  tr: Translation,
  [n, field]: [string, Field]
): Translation => {
  const path = mkPath([n, field]);
  const res = findExprSafe(tr, path); // This is safe (as used in GenOptProblem) since we only initialize shapes with paths from the translation

  if (res.tag === "FGPI") {
    const [stype, props] = res.contents as [string, GPIProps<VarAD>];
    const def: ShapeDef = findDef(stype);
    const gpiTemplate: [string, [PropType, Sampler]][] = Object.entries(
      def.properties
    );

    const instantiatedGPIProps: GPIProps<VarAD> = gpiTemplate.reduce(
      (
        newGPI: GPIProps<VarAD>,
        propTemplate: [string, [PropType, Sampler]]
      ): GPIProps<VarAD> =>
        initProperty(stype, newGPI, propTemplate, getCanvas(tr)),
      clone(props)
    ); // NOTE: `initProperty` mutates its input, so the `props` from the translation is cloned here, so the one in the translation itself isn't mutated

    // Insert the name of the shape into its prop dict
    // NOTE: getShapes resolves the names + we don't use the names of the shapes in the translation
    // The name-adding logic can be removed but is left in for debugging
    const shapeName = mkShapeName(n, field);
    instantiatedGPIProps.name = {
      tag: "Done",
      contents: {
        tag: "StrV",
        contents: shapeName,
      },
    };
    const gpi: IFGPI<VarAD> = {
      tag: "FGPI",
      contents: [stype, instantiatedGPIProps],
    };
    return insertGPI(path, gpi, tr);
  } else throw Error("expected GPI but got field");
};

const initShapes = (tr: Translation, pths: [string, string][]): Translation => {
  return pths.reduce(initShape, tr);
};

//#region layering

const findLayeringExpr = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Expr[]
): Expr[] => {
  if (fexpr.tag === "FExpr") {
    if (fexpr.contents.tag === "OptEval") {
      if (fexpr.contents.contents.tag === "Layering") {
        const layering: ILayering = fexpr.contents.contents;
        return [layering as Expr].concat(acc);
      }
    }
  }
  return acc;
};

const findLayeringExprs = (tr: Translation): Expr[] => {
  return foldSubObjs(findLayeringExpr, tr);
};

const lookupGPIName = (p: Path, tr: Translation): string => {
  if (p.tag === "FieldPath") {
    // COMBAK: Deal with path synonyms / aliases by looking them up?
    return getShapeName(p.name.contents.value, p.field.value);
  } else {
    throw Error("expected path to GPI");
  }
};

const findNames = (e: Expr, tr: Translation): [string, string] => {
  if (e.tag === "Layering") {
    return [lookupGPIName(e.below, tr), lookupGPIName(e.above, tr)];
  } else {
    throw Error("unknown tag");
  }
};

const topSortLayering = (
  allGPINames: string[],
  partialOrderings: [string, string][]
): MaybeVal<string[]> => {
  const layerGraph: Graph = new Graph();
  allGPINames.map((name: string) => layerGraph.setNode(name));
  // topsort will return the most upstream node first. Since `shapeOrdering` is consistent with the SVG drawing order, we assign edges as "below => above".
  partialOrderings.map(([below, above]: [string, string]) =>
    layerGraph.setEdge(below, above)
  );

  try {
    const globalOrdering: string[] = alg.topsort(layerGraph);
    return { tag: "Just", contents: globalOrdering };
  } catch (e) {
    return { tag: "Nothing" };
  }
};

const computeShapeOrdering = (tr: Translation): string[] => {
  const layeringExprs = findLayeringExprs(tr);
  // Returns list of layering specifications [below, above]
  const partialOrderings: [string, string][] = layeringExprs.map((e: Expr): [
    string,
    string
  ] => findNames(e, tr));

  const allGPINames: string[] = findShapeNames(
    tr
  ).map((e: [string, Field]): string => getShapeName(e[0], e[1]));
  const shapeOrdering = topSortLayering(allGPINames, partialOrderings);

  // TODO: Errors for labeling
  if (shapeOrdering.tag === "Nothing") {
    throw Error("no shape ordering possible from layering");
  }

  return shapeOrdering.contents;
};

//#endregion

const isVaryingInitPath = (
  p: Path,
  tr: Translation
): [Path, MaybeVal<number>] => {
  const res = findExpr(tr, p); // Some varying paths may not be in the translation. That's OK.
  if (res.tag === "OptEval") {
    if (res.contents.tag === "VaryInit") {
      return [p, { tag: "Just", contents: res.contents.contents }];
    }
  }

  return [p, { tag: "Nothing" }];
};

// ---- MAIN FUNCTION

// COMBAK: Add optConfig as param?
const genState = (trans: Translation): Result<State, StyleErrors> => {
  const varyingPaths = findVarying(trans);
  // NOTE: the properties in uninitializedPaths are NOT floats. Floats are included in varyingPaths already
  const varyingInitPathsAndVals: [Path, number][] = (varyingPaths
    .map((p) => isVaryingInitPath(p, trans))
    .filter(
      (tup: [Path, MaybeVal<number>]): boolean => tup[1].tag === "Just"
    ) as [Path, Just<number>][]) // TODO: Not sure how to get typescript to understand `filter`...
    .map((tup: [Path, Just<number>]) => [tup[0], tup[1].contents]);
  const varyingInitInfo: { [pathStr: string]: number } = Object.fromEntries(
    varyingInitPathsAndVals.map((e) => [prettyPrintPath(e[0]), e[1]])
  );

  const uninitializedPaths = findUninitialized(trans);
  const shapePathList: [string, string][] = findShapeNames(trans);
  const shapePaths = shapePathList.map(mkPath);

  const canvasErrs = checkCanvas(trans);
  if (canvasErrs.length > 0) {
    return err(canvasErrs);
  }

  // sample varying vals and instantiate all the non - float base properties of every GPI in the translation
  // this has to be done before `initFieldsAndAccessPaths` as AccessPaths may depend on shapes' properties already having been initialized
  const transInitShapes = initShapes(trans, shapePathList);

  // sample varying fields and access paths, and put them in the translation
  const transInitAll = initFieldsAndAccessPaths(varyingPaths, transInitShapes);

  // CHECK TRANSLATION
  // Have to check it after the shapes are initialized, otherwise it will complain about uninitialized shape paths
  const transErrs = checkTranslation(transInitAll);
  if (transErrs.length > 0) {
    return err(transErrs);
  }

  const shapeProperties = findShapesProperties(transInitAll);
  const [objfnsDecl, constrfnsDecl] = findUserAppliedFns(transInitAll);
  const [objfnsDefault, constrfnsDefault] = findDefaultFns(transInitAll);
  const [objFns, constrFns] = [
    objfnsDecl.concat(objfnsDefault),
    constrfnsDecl.concat(constrfnsDefault),
  ];

  const [initialGPIs, transEvaled] = [[], transInitAll];
  const initVaryingState: number[] = lookupNumericPaths(
    varyingPaths,
    transEvaled
  );

  const pendingPaths = findPending(transInitAll);
  const shapeOrdering = computeShapeOrdering(transInitAll); // deal with layering

  const initState = {
    shapes: initialGPIs, // These start out empty because they are initialized in the frontend via `evalShapes` in the Evaluator
    shapePaths,
    shapeProperties,
    shapeOrdering,

    translation: transInitAll, // This is the result of the data processing
    originalTranslation: clone(trans),

    varyingPaths,
    varyingValues: initVaryingState,
    varyingInitInfo,

    uninitializedPaths,
    pendingPaths,

    objFns,
    constrFns,

    // `params` are initialized properly by optimization; the only thing it needs is the weight (for the objective function synthesis)
    params: ({
      optStatus: "NewIter" as const,
      weight: initConstraintWeight,
      lbfgsInfo: defaultLbfgsParams,
      UOround: -1,
      EPround: -1,
    } as unknown) as Params,

    labelCache: [],
    rng: undefined as any,
    policyParams: undefined as any,
    oConfig: undefined as any,
    selectorMatches: undefined as any,
    varyingMap: {} as any, // TODO: Should this be empty?

    canvas: getCanvas(trans),
  };

  return ok(initState);
};

//#endregion

export const parseStyle = (p: string): Result<StyProg, ParseError> => {
  const parser = new nearley.Parser(nearley.Grammar.fromCompiled(styleGrammar));
  try {
    const { results } = parser.feed(p).feed("\n");
    if (results.length > 0) {
      const ast: StyProg = results[0] as StyProg;
      return ok(ast);
    } else {
      return err(parseError(`Unexpected end of input`, lastLocation(parser)));
    }
  } catch (e) {
    return err(parseError(e, lastLocation(parser)));
  }
};

// NOTE: Mutates stmt
const disambiguateSubNode = (env: Env, stmt: ASTNode) => {
  stmt.children.forEach((child) => disambiguateSubNode(env, child));

  if (stmt.tag !== "Func") {
    return;
  }

  // Lookup name in the env and replace it if it exists, otherwise throw error
  const func = stmt as Func;

  const isCtor = env.constructors.has(func.name.value);
  const isFn = env.functions.has(func.name.value);
  const isPred = env.predicates.has(func.name.value);

  if (isCtor && !isFn && !isPred) {
    ((func as any) as ApplyConstructor).tag = "ApplyConstructor";
  } else if (!isCtor && isFn && !isPred) {
    ((func as any) as ApplyFunction).tag = "ApplyFunction";
  } else if (!isCtor && !isFn && isPred) {
    ((func as any) as ApplyPredicate).tag = "ApplyPredicate";
  } else if (!isCtor && !isFn && !isPred) {
    throw Error(
      `Substance internal error: expected '${func.name.value}' of type Func to be disambiguable in env, but was not found`
    );
  } else {
    throw Error(
      "Substance internal error: expected val of type Func to be uniquely disambiguable in env, but found multiple"
    );
  }
};

// For Substance, any `Func` appearance should be disambiguated into an `ApplyPredicate`, or an `ApplyFunction`, or an `ApplyConstructor`, and there are no other possible values, and every `Func` should be disambiguable
// NOTE: mutates Substance AST
export const disambiguateFunctions = (env: Env, subProg: SubProg) => {
  subProg.statements.forEach((stmt: SubStmt) => disambiguateSubNode(env, stmt));
};

//#region Checking translation

const isStyErr = (res: TagExpr<VarAD> | IFGPI<VarAD> | StyleError): boolean =>
  res.tag !== "FGPI" && !isTagExpr(res);

const findPathsExpr = (expr: Expr): Path[] => {
  // TODO: Factor the expression-folding pattern out from here and `checkBlockExpr`
  if (isPath(expr)) {
    return [expr];
  } else if (
    expr.tag === "CompApp" ||
    expr.tag === "ObjFn" ||
    expr.tag === "ConstrFn"
  ) {
    return _.flatMap(expr.args, findPathsExpr);
  } else if (expr.tag === "BinOp") {
    return _.flatMap([expr.left, expr.right], findPathsExpr);
  } else if (expr.tag === "UOp") {
    return findPathsExpr(expr.arg);
  } else if (
    expr.tag === "List" ||
    expr.tag === "Vector" ||
    expr.tag === "Matrix"
  ) {
    return _.flatMap(expr.contents, findPathsExpr);
  } else if (expr.tag === "ListAccess") {
    return [expr.contents[0]];
  } else if (expr.tag === "GPIDecl") {
    return _.flatMap(
      expr.properties.map((p) => p.value),
      findPathsExpr
    );
  } else if (expr.tag === "Layering") {
    return [expr.below, expr.above];
  } else if (expr.tag === "PluginAccess") {
    return _.flatMap([expr.contents[1], expr.contents[2]], findPathsExpr);
  } else if (expr.tag === "Tuple") {
    return _.flatMap([expr.contents[0], expr.contents[1]], findPathsExpr);
  } else if (expr.tag === "VectorAccess") {
    return [expr.contents[0]].concat(findPathsExpr(expr.contents[1]));
  } else if (expr.tag === "MatrixAccess") {
    return [expr.contents[0]].concat(
      _.flatMap(expr.contents[1], findPathsExpr)
    );
  } else if (
    expr.tag === "Fix" ||
    expr.tag === "Vary" ||
    expr.tag === "VaryInit" ||
    expr.tag === "VaryAD" ||
    expr.tag === "StringLit" ||
    expr.tag === "BoolLit"
  ) {
    return [];
  } else {
    console.error("expr", expr);
    throw Error("unknown tag");
  }
};

// Find all paths given explicitly anywhere in an expression in the translation.
// (e.g. `x.shape above y.shape` <-- return [`x.shape`, `y.shape`])
const findPathsField = (
  name: string,
  field: Field,
  fexpr: FieldExpr<VarAD>,
  acc: Path[]
): Path[] => {
  if (fexpr.tag === "FExpr") {
    // Only look deeper in expressions, because that's where paths might be
    if (fexpr.contents.tag === "OptEval") {
      const res: Path[] = findPathsExpr(fexpr.contents.contents);
      return acc.concat(res);
    } else {
      return acc;
    }
  } else if (fexpr.tag === "FGPI") {
    // Get any exprs that the properties are set to
    const propExprs: Expr[] = Object.entries(fexpr.contents[1])
      .map((e) => e[1])
      .filter((e: TagExpr<VarAD>): boolean => e.tag === "OptEval")
      .map((e) => e as IOptEval<VarAD>) // Have to cast because TypeScript doesn't know the type changed from the filter above
      .map((e: IOptEval<VarAD>): Expr => e.contents);
    const res: Path[] = _.flatMap(propExprs, findPathsExpr);
    return acc.concat(res);
  }

  throw Error("unknown tag");
};

// Check that canvas dimensions exist and have the proper type.
const checkCanvas = (tr: Translation): StyleErrors => {
  let errs: StyleErrors = [];

  if (!("canvas" in tr.trMap)) {
    errs.push({
      tag: "CanvasNonexistentError",
    });

    return errs;
  }

  if (!("width" in tr.trMap.canvas)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "width",
      kind: "missing",
    });
  } else if (!("contents" in tr.trMap.canvas.width.contents)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "width",
      kind: "GPI",
    });
  } else if (!("contents" in tr.trMap.canvas.width.contents.contents)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "width",
      kind: "uninitialized",
    });
  } else if (
    typeof tr.trMap.canvas.width.contents.contents.contents !== "number"
  ) {
    const val = tr.trMap.canvas.width.contents.contents;
    let type;
    if (typeof val === "object" && "tag" in val) {
      type = val.tag;
    } else {
      type = typeof val;
    }

    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "width",
      kind: "wrong type",
      type,
    });
  }

  if (!("height" in tr.trMap.canvas)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "height",
      kind: "missing",
    });
  } else if (!("contents" in tr.trMap.canvas.height.contents)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "height",
      kind: "GPI",
    });
  } else if (!("contents" in tr.trMap.canvas.height.contents.contents)) {
    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "height",
      kind: "uninitialized",
    });
  } else if (
    typeof tr.trMap.canvas.height.contents.contents.contents !== "number"
  ) {
    const val = tr.trMap.canvas.height.contents.contents;
    let type;
    if (typeof val === "object" && "tag" in val) {
      type = val.tag;
    } else {
      type = typeof val;
    }

    errs.push({
      tag: "CanvasNonexistentDimsError",
      attr: "height",
      kind: "wrong type",
      type,
    });
  }

  return errs;
};

// Check translation integrity
const checkTranslation = (trans: Translation): StyleErrors => {
  // Look up all paths used anywhere in the translation's expressions and verify they exist in the translation
  const allPaths: Path[] = foldSubObjs(findPathsField, trans);
  const allPathsUniq: Path[] = _.uniqBy(allPaths, prettyPrintPath);
  const exprs = allPathsUniq.map((p) => findExpr(trans, p));
  const errs = exprs.filter(isStyErr);
  return errs as StyleErrors; // Should be true due to the filter above, though you can't use booleans and the `res is StyleError` assertion together.
};

//#endregion Checking translation

/* Precondition: checkCanvas returns without error */
export const getCanvas = (tr: Translation): Canvas => {
  let width = ((tr.trMap.canvas.width.contents as TagExpr<VarAD>)
    .contents as Value<VarAD>).contents as number;
  let height = ((tr.trMap.canvas.height.contents as TagExpr<VarAD>)
    .contents as Value<VarAD>).contents as number;
  return {
    width,
    height,
    size: [width, height],
    xRange: [-width / 2, width / 2],
    yRange: [-height / 2, height / 2],
  };
};

export const compileStyle = (
  stySource: string,
  subEnv: SubstanceEnv,
  varEnv: Env
): Result<State, PenroseError> => {
  const subProg = subEnv.ast;

  const astOk = parseStyle(stySource);
  let styProgInit;
  if (astOk.isOk()) {
    styProgInit = astOk.value;
  } else {
    return err({ ...astOk.error, errorType: "StyleError" });
  }

  // disambiguate Func into the right form in Substance grammar #453 -- mutates Substance AST since children are references
  disambiguateFunctions(varEnv, subProg);

  const labelMap = subEnv.labels;

  // Name anon statements
  const styProg: StyProg = nameAnonStatements(styProgInit);

  log.info("old prog", styProgInit);
  log.info("new prog, with named anon statements", styProg);

  // Check selectors; return list of selector environments (`checkSels`)
  const selEnvs = checkSelsAndMakeEnv(varEnv, styProg.blocks);

  // TODO(errors/warn): distinguish between errors and warnings
  const selErrs: StyleErrors = _.flatMap(selEnvs, (e) =>
    e.warnings.concat(e.errors)
  );

  if (selErrs.length > 0) {
    // TODO(errors): Report all of them, not just the first?
    return err(toStyleErrors(selErrs));
  }

  // Leaving these logs in because they are still useful for debugging, but TODO: remove them
  log.info("selEnvs", selEnvs);

  // Find substitutions (`find_substs_prog`)
  const subss = findSubstsProg(
    varEnv,
    subEnv,
    subProg,
    styProg.blocks,
    selEnvs
  ); // TODO: Use `eqEnv`
  // TODO: I guess `subss` is not actually used? remove?

  log.info("substitutions", subss);

  // Translate style program
  const styVals: number[] = []; // COMBAK: Deal with style values when we have plugins
  const translateRes = translateStyProg(
    varEnv,
    subEnv,
    subProg,
    styProg,
    labelMap,
    styVals
  );

  log.info("translation (before genOptProblem)", translateRes);

  // Translation failed somewhere
  if (translateRes.tag === "Left") {
    return err(toStyleErrors(translateRes.contents));
  }

  const trans = translateRes.contents;

  if (trans.warnings.length > 0) {
    // TODO(errors): these errors are currently returned as warnings -- maybe systematize it
    log.info("Returning warnings as errors");
    return err(toStyleErrors(trans.warnings));
  }

  // TODO(errors): `findExprsSafe` shouldn't fail (as used in `genOptProblemAndState`, since all the paths are generated from the translation) but could always be safer...
  const initState: Result<State, StyleErrors> = genState(trans);
  log.info("init state from GenOptProblem", initState);

  if (initState.isErr()) {
    return err(toStyleErrors(initState.error));
  }

  return ok(initState.value);
};
