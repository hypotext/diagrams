import { dummyIdentifier } from "engine/EngineUtils";
import { Map } from "immutable";
import { findIndex, zip } from "lodash";
import nearley from "nearley";
import { idOf, lastLocation } from "parser/ParserUtil";
import substanceGrammar from "parser/SubstanceParser";
import { Identifier } from "types/ast";
import {
  Arg,
  ConstructorDecl,
  Env,
  FunctionDecl,
  Type,
  TypeConstructor,
} from "types/domain";
import { ParseError, PenroseError, SubstanceError } from "types/errors";
import {
  ApplyConstructor,
  ApplyFunction,
  ApplyPredicate,
  Decl,
  Deconstructor,
  Func,
  LabelMap,
  LabelOption,
  SubExpr,
  SubPredArg,
  SubProg,
  SubRes,
  SubstanceEnv,
  SubStmt,
  TypeConsApp,
} from "types/substance";
import {
  andThen,
  argLengthMismatch,
  deconstructNonconstructor,
  err,
  every,
  Maybe,
  ok,
  parseError,
  Result,
  safeChain,
  typeArgLengthMismatch,
  typeMismatch,
  typeNotFound,
  unexpectedExprForNestedPred,
  varNotFound,
} from "utils/Error";
import { bottomType, checkTypeConstructor, isSubtype, topType } from "./Domain";

export const parseSubstance = (prog: string): Result<SubProg, ParseError> => {
  const parser = new nearley.Parser(
    nearley.Grammar.fromCompiled(substanceGrammar)
  );
  try {
    const { results } = parser.feed(prog).feed("\n"); // NOTE: extra newline to avoid trailing comments
    if (results.length > 0) {
      const ast: SubProg = results[0] as SubProg;
      return ok(ast);
    } else {
      return err(parseError(`Unexpected end of input`, lastLocation(parser)));
    }
  } catch (e) {
    return err(parseError(e, lastLocation(parser)));
  }
};

/**
 * Top-level function for the Substance parser and checker. Given a Substance program string and Domain environment, it outputs either a `PenroseError` or `Env` and `SubstanceEnv` contexts.
 *
 * @param prog Substance program string
 * @param env  Domain environment
 */
export const compileSubstance = (
  prog: string,
  env: Env
): Result<SubRes, PenroseError> => {
  const astOk = parseSubstance(prog);
  if (astOk.isOk()) {
    const ast = astOk.value;
    // convert and append prelude values to the substance AST
    const preludeDecls = [...env.preludeValues.toArray()];
    const preludeValues: Decl[] = preludeDecls.map(
      ([id, decl]: [string, TypeConstructor]) => toSubDecl(id, decl)
    );
    const astWithPrelude: SubProg = {
      ...ast,
      statements: ast.statements.concat(preludeValues),
    };
    // check the substance ast and produce an env or report errors
    const checkerOk = checkSubstance(astWithPrelude, env);
    return checkerOk.match({
      Ok: (env) => ok([postprocessSubstance(astWithPrelude, env), env]),
      Err: (e) => err({ ...e, errorType: "SubstanceError" }),
    });
  } else {
    return err({ ...astOk.error, errorType: "SubstanceError" });
  }
};

const initEnv = (ast: SubProg): SubstanceEnv => ({
  exprEqualities: [],
  predEqualities: [],
  bindings: Map(),
  labels: Map(),
  predicates: [],
  ast,
});

//#region Postprocessing
export const postprocessSubstance = (prog: SubProg, env: Env): SubstanceEnv => {
  // post process all statements
  const subEnv = initEnv(prog);
  return prog.statements.reduce(
    (e, stmt) => postprocessStmt(stmt, env, e),
    subEnv
  );
};

const toSubDecl = (idString: string, decl: TypeConstructor): Decl => ({
  nodeType: "SyntheticSubstance",
  children: [],
  tag: "Decl",
  type: {
    ...decl,
    args: [],
  },
  name: dummyIdentifier(idString, "SyntheticSubstance"),
});

const postprocessStmt = (
  stmt: SubStmt,
  env: Env,
  subEnv: SubstanceEnv
): SubstanceEnv => {
  switch (stmt.tag) {
    case "AutoLabel": {
      if (stmt.option.tag === "DefaultLabels") {
        const [...ids] = env.vars.keys();
        const newLabels: LabelMap = Map(ids.map((id) => [id, Maybe.just(id)]));
        return {
          ...subEnv,
          labels: newLabels,
        };
      } else {
        const ids = stmt.option.variables;
        const newLabels: LabelMap = subEnv.labels.merge(
          ids.map((id) => [id.value, Maybe.just(id.value)])
        );
        return {
          ...subEnv,
          labels: newLabels,
        };
      }
    }
    case "LabelDecl": {
      const { variable, label } = stmt;
      return {
        ...subEnv,
        labels: subEnv.labels.set(variable.value, Maybe.just(label.contents)),
      };
    }
    case "NoLabel": {
      const ids = stmt.args;
      const newLabels: LabelMap = subEnv.labels.merge(
        ids.map((id) => [id.value, Maybe.nothing()])
      );
      return {
        ...subEnv,
        labels: newLabels,
      };
    }
    default:
      return subEnv;
  }
};
//#endregion

//#region Semantic checker

type CheckerResult = Result<Env, SubstanceError>;
type ResultWithType = Result<[TypeConsApp, Env], SubstanceError>;

const stringType: TypeConsApp = {
  tag: "TypeConstructor",
  name: idOf("String", "Substance"),
  args: [],
};

/**
 * Top-level function for the Substance semantic checker. Given a Substance AST and an initial context, it outputs either a `SubstanceError` or an `Env` context.
 *
 * @param prog compiled AST of a Domain program
 * @param env  environment from the Domain checker
 */
export const checkSubstance = (prog: SubProg, env: Env): CheckerResult => {
  const { statements } = prog;
  // check all statements
  const stmtsOk: CheckerResult = safeChain(statements, checkStmt, ok(env));
  return stmtsOk;
};

const checkStmt = (stmt: SubStmt, env: Env): CheckerResult => {
  switch (stmt.tag) {
    case "Decl": {
      const { type, name } = stmt;
      const typeOk = checkTypeConstructor(type, env);
      const updatedEnv: Env = {
        ...env,
        vars: env.vars.set(name.value, type),
        varIDs: [name, ...env.varIDs],
      };
      return every(typeOk, ok(updatedEnv));
    }
    case "Bind": {
      const { variable, expr } = stmt;
      const varOk = checkVar(variable, env);
      const exprOk = checkExpr(expr, env, variable);
      return subtypeOf(exprOk, varOk, variable, expr);
    }
    case "ApplyPredicate": {
      return checkPredicate(stmt, env);
    }
    case "EqualExprs": {
      const { left, right } = stmt;
      const leftOk = checkExpr(left, env);
      const rightOk = checkExpr(right, env);
      return andThen(([_, e]) => ok(e), every(leftOk, rightOk));
    }
    case "EqualPredicates": {
      const { left, right } = stmt;
      const leftOk = checkPredicate(left, env);
      const rightOk = checkPredicate(right, env);
      return every(leftOk, rightOk);
    }
    case "AutoLabel":
      return ok(env); // NOTE: no checking required
    case "LabelDecl":
      return andThen(([_, e]) => ok(e), checkVar(stmt.variable, env));
    case "NoLabel":
      const argsOk = every(...stmt.args.map((a) => checkVar(a, env)));
      return andThen(([_, e]) => ok(e), argsOk);
  }
};

export const checkPredicate = (
  stmt: ApplyPredicate,
  env: Env
): CheckerResult => {
  const { name, args } = stmt;
  const predDecl = env.predicates.get(name.value);
  // check if predicate exists and retrieve its decl
  if (predDecl) {
    // initialize substitution environment
    const substContext: SubstitutionEnv = Map();
    const argPairs = zip(args, predDecl.args) as [SubPredArg, Arg][];
    const argsOk: SubstitutionResult = safeChain(
      argPairs,
      ([expr, arg], [cxt, e]) => checkPredArg(expr, arg, cxt, e),
      ok([substContext, env])
    );
    // NOTE: throw away the substitution because this layer above doesn't need to typecheck
    return andThen(([_, e]) => ok(e), argsOk);
  } else {
    return err(
      typeNotFound(
        name,
        [...env.predicates.values()].map((p) => p.name)
      )
    );
  }
};

const checkPredArg = (
  arg: SubPredArg,
  argDecl: Arg,
  subst: SubstitutionEnv,
  env: Env
): SubstitutionResult => {
  // HACK: predicate-typed args are parsed into `Func` type first, explicitly check and change it to predicate if the func is actually a predicate in the context
  if (arg.tag === "Func" && env.predicates.get(arg.name.value)) {
    arg = { ...arg, tag: "ApplyPredicate" };
  }
  if (arg.tag === "ApplyPredicate") {
    // if the argument is a nested predicate, call checkPredicate again
    const predOk = checkPredicate(arg, env);
    // NOTE: throw out the env from the check because it's not updating anything
    return andThen((env) => ok([subst, env]), predOk);
  } else {
    const argExpr: SubExpr = arg; // HACK: make sure the lambda function below will typecheck
    // if the argument is an expr, check and get the type of the expression
    const exprOk: ResultWithType = checkExpr(arg, env);
    // check against the formal argument
    const argSubstOk = andThen(
      ([t, e]: [TypeConsApp, Env]) =>
        substituteArg(t, argDecl.type, argExpr, argDecl, subst, e),
      exprOk
    );
    // if everything checks out, return env as a formality
    return argSubstOk;
  }
};

// TODO: in general, true-myth seem to have trouble transforming data within the monad when the transformation itself can go wrong. If the transformation function cannot return errors, it's completely fine to use `ap`. This particular scenario is technically handled by `andThen`, but it seems to have problems with curried functions.
export const subtypeOf = (
  type1: ResultWithType,
  type2: ResultWithType,
  expr1: SubExpr,
  expr2: SubExpr
): CheckerResult => {
  // TODO: find a more elegant way of writing this
  return type1.match({
    Ok: ([t1, updatedenv]) =>
      type2.match({
        Ok: ([t2, _]) => {
          // TODO: Check ordering of types, maybe annotated the ordering in the signature
          // TODO: call the right type equality function
          if (isSubtype(t1, t2, updatedenv)) return ok(updatedenv);
          else {
            return err(typeMismatch(t1, t2, expr1, expr2));
          }
        },
        Err: (e) => err(e),
      }),
    Err: (e) => err(e),
  });
};

const withType = (env: Env, type: TypeConsApp): ResultWithType =>
  ok([type, env]);
// const getType = (res: ResultWithType): Result<TypeConsApp, SubstanceError> =>
//   andThen(([type, _]: [TypeConsApp, Env]) => ok(type), res);

export const checkExpr = (
  expr: SubExpr,
  env: Env,
  variable?: Identifier
): ResultWithType => {
  switch (expr.tag) {
    case "Func":
      return checkFunc(expr, env, variable);
    case "Identifier":
      return checkVar(expr, env);
    case "StringLit":
      return ok([stringType, env]);
    case "ApplyFunction":
      return checkFunc(expr, env, variable); // NOTE: the parser technically doesn't output this type, put in for completeness
    case "ApplyConstructor":
      return checkFunc(expr, env, variable); // NOTE: the parser technically doesn't output this type, put in for completeness
    case "Deconstructor":
      return checkDeconstructor(expr, env);
  }
};

type SubstitutionEnv = Map<string, TypeConsApp>; // mapping from type var to concrete types
type SubstitutionResult = Result<[SubstitutionEnv, Env], SubstanceError>; // included env as a potential error accumulator TODO: check if the env passing chain is intact

/**
 * Given a concrete type in Substance and the formal type in Domain (which may include type variables), check if the concrete type is well-formed and possibly add to the substitution map.
 *
 * @param type concrete type from Substance
 * @param formalType Domain type from Domain
 * @param sourceExpr the expression with the Substance type (for error reporting)
 * @param expectedExpr the expression where the Domain type is declared (for error reporting)
 * @param substEnv substitution environment
 */
const substituteArg = (
  type: TypeConsApp,
  formalType: Type,
  sourceExpr: SubExpr,
  expectedExpr: Arg,
  substEnv: SubstitutionEnv,
  env: Env
): SubstitutionResult => {
  if (formalType.tag === "TypeConstructor") {
    const expectedArgs = formalType.args;
    // TODO: check ordering of types
    if (expectedArgs.length !== type.args.length) {
      if (type.name.value === formalType.name.value) {
        return err(
          typeArgLengthMismatch(type, formalType, sourceExpr, expectedExpr)
        );
      } else
        return err(typeMismatch(type, formalType, sourceExpr, expectedExpr));
    } else {
      // if there are no arguments, check for type equality and return mismatch error if types do not match
      if (type.args.length === 0 && !isSubtype(type, formalType, env)) {
        return err(typeMismatch(type, formalType, sourceExpr, expectedExpr));
      }
      // if there are more arguments, substitute them one by one
      // NOTE: we already know the lengths are the same, so there shouldn't be any `undefined` in the zipped list. TODO: check how to model this constraint in the type system
      const typePairs = zip(type.args, expectedArgs) as [TypeConsApp, Type][];
      return safeChain(
        typePairs,
        ([type, expected], [subst, env]) =>
          substituteArg(type, expected, sourceExpr, expectedExpr, subst, env),
        ok([substEnv, env])
      );
    }
  } else if (formalType.tag === "TypeVar") {
    const expectedType: TypeConsApp | undefined = substEnv.get(
      formalType.name.value
    );
    // type var already substituted
    if (expectedType) {
      // substitutions OK, moving on
      if (isSubtype(expectedType, type, env)) return ok([substEnv, env]);
      // type doesn't match with the previous substitution
      else {
        return err(typeMismatch(type, expectedType, sourceExpr, expectedExpr));
      }
    } else {
      // if type var is not substituted yet, add new substitution to the env
      return ok([substEnv.set(formalType.name.value, type), env]);
    }
  } else {
    return err(unexpectedExprForNestedPred(type, sourceExpr, expectedExpr));
  }
};
const matchArg = (
  expr: SubExpr,
  arg: Arg,
  subst: SubstitutionEnv,
  env: Env
): SubstitutionResult => {
  // check and get the type of the expression
  const exprOk: ResultWithType = checkExpr(expr, env);
  // check against the formal argument
  const argSubstOk = andThen(
    ([t, _]: [TypeConsApp, Env]) =>
      substituteArg(t, arg.type, expr, arg, subst, env),
    exprOk
  );
  // if everything checks out, return env as a formality
  return argSubstOk;
};

const applySubstitution = (
  formalType: Type,
  substContext: SubstitutionEnv
): TypeConsApp => {
  if (formalType.tag === "TypeConstructor") {
    // if there're no arguments, directly return the type
    // NOTE: if no args, the type is effectively a `TypeConsApp`. TODO: encode this in the type system
    if (formalType.args.length === 0) {
      return formalType as TypeConsApp;
    } else {
      const substitutedArgs: TypeConsApp[] = formalType.args.map((t) =>
        applySubstitution(t, substContext)
      );
      return {
        ...formalType,
        args: substitutedArgs,
      };
    }
  } else if (formalType.tag === "TypeVar") {
    const res = substContext.get(formalType.name.value);
    // TODO: COMBAK(Parametrized types) check if it's okay to return an unbounded type. This case happens when a type variable did not occur in any of the args, therefore lacking a substitution.
    return res ? res : bottomType;
  } else {
    // TODO: this case shouldn't occure, as the right hand side of binds cannot be a predicate, which is already ensured by the parser
    return topType;
  }
};

// TODO: refactor this function to check functions and constructors separately
const checkFunc = (
  func: Func | ApplyConstructor | ApplyFunction,
  env: Env,
  variable?: Identifier
): ResultWithType => {
  const name = func.name.value;
  // check if func is either constructor or function
  let funcDecl: ConstructorDecl | FunctionDecl | undefined;
  if (env.constructors.has(name)) {
    func = { ...func, tag: "ApplyConstructor" };
    funcDecl = env.constructors.get(name);
  } else if (env.functions.has(name)) {
    func = { ...func, tag: "ApplyFunction" };
    funcDecl = env.functions.get(name);
  }
  // if the function/constructor is found, run a generic check on the arguments and output
  if (funcDecl) {
    const { output } = funcDecl;
    // initialize substitution environment
    const substContext: SubstitutionEnv = Map();
    if (funcDecl.args.length !== func.args.length) {
      return err(
        argLengthMismatch(func.name, func.args, funcDecl.args, func, funcDecl)
      );
    } else {
      const argPairs = zip(func.args, funcDecl.args) as [SubExpr, Arg][];
      const argsOk: SubstitutionResult = safeChain(
        argPairs,
        ([expr, arg], [cxt, e]) => matchArg(expr, arg, cxt, e),
        ok([substContext, env])
      );
      const outputOk: ResultWithType = andThen(
        ([subst, e]) => withType(e, applySubstitution(output.type, subst)),
        argsOk
      );
      // if the func is a constructor and bounded by a variable, cache the binding to env
      if (
        variable &&
        func.tag === "ApplyConstructor" &&
        funcDecl.tag === "ConstructorDecl"
      ) {
        const updatedEnv: Env = {
          ...env,
          constructorsBindings: env.constructorsBindings.set(variable.value, [
            func,
            funcDecl,
          ]),
        };
        return andThen(([t, _]) => withType(updatedEnv, t), outputOk);
      } else return outputOk;
    }
  } else return err(typeNotFound(func.name)); // TODO: suggest possible types
};

const checkDeconstructor = (
  decons: Deconstructor,
  env: Env
): ResultWithType => {
  const { variable } = decons;
  const varOk = checkVar(variable, env);
  const fieldOk = checkField(decons, env);
  return every(varOk, fieldOk);
};

const checkField = (decons: Deconstructor, env: Env): ResultWithType => {
  const { field } = decons;
  // get the original constructor in Substance
  const res = env.constructorsBindings.get(decons.variable.value);
  if (res) {
    // get the constructor decl in Domain
    const [cons, consDecl] = res;
    // find the field index by name
    const fieldIndex = findIndex(
      consDecl.args,
      (a) => a.variable.value === field.value
    );
    // TODO: the field type call is a bit redundant. Is there a better way to get the type of the field?
    const fieldType = checkExpr(cons.args[fieldIndex], env);
    return fieldType;
  } else return err(deconstructNonconstructor(decons));
};

export const checkVar = (variable: Identifier, env: Env): ResultWithType => {
  const type = env.vars.find((_, key) => key === variable.value);
  if (type) {
    return ok([type, env]);
  } else {
    const possibleVars = env.varIDs;
    // TODO: find vars of the same type for error reporting (need to check expr first)
    return err(varNotFound(variable, possibleVars));
  }
};
//#endregion

//#region Substance pretty printer

export const prettySubstance = (prog: SubProg): string =>
  prog.statements.map((stmt) => prettyStmt(stmt)).join("\n");

export const prettyStmt = (stmt: SubStmt): string => {
  switch (stmt.tag) {
    case "Decl": {
      const { type, name } = stmt;
      return `${prettyType(type)} ${prettyVar(name)}`;
    }
    case "Bind": {
      const { variable, expr } = stmt;
      return `${prettyVar(variable)} := ${prettyExpr(expr)}`;
    }
    case "AutoLabel":
      return `AutoLabel ${prettyLabelOpt(stmt.option)}`;
    case "NoLabel":
      return `NoLabel ${stmt.args.map((a) => prettyVar(a)).join(", ")}`;
    case "LabelDecl":
      return `Label ${prettyVar(stmt.variable)} \$${stmt.label.contents}\$`;
    case "ApplyPredicate":
      return prettyPredicate(stmt);
    case "EqualExprs":
      return `${prettyExpr(stmt.left)} = ${prettyExpr(stmt.right)}`;
    case "EqualPredicates":
      return `${prettyPredicate(stmt.left)} <-> ${prettyPredicate(stmt.right)}`;
  }
};

const prettyPredicate = (pred: ApplyPredicate): string => {
  const { name, args } = pred;
  const argStr = args.map((a) => prettyPredArg(a)).join(", ");
  return `${prettyVar(name)}(${argStr})`;
};

const prettyPredArg = (arg: SubPredArg): string => {
  if (arg.tag === "ApplyPredicate") return prettyPredicate(arg);
  else return prettyExpr(arg);
};

const prettyType = (type: TypeConsApp): string => {
  const { name, args } = type;
  if (args.length > 0) {
    const argStr = args.map((a) => prettyType(a)).join(", ");
    return `${prettyVar(name)}(${argStr})`;
  } else {
    return `${prettyVar(name)}`;
  }
};

const prettyLabelOpt = (opt: LabelOption): string => {
  switch (opt.tag) {
    case "DefaultLabels":
      return "All";
    case "LabelIDs":
      return opt.variables.map((v) => prettyVar(v)).join(", ");
  }
};

const prettyVar = (v: Identifier): string => v.value;
const prettyExpr = (expr: SubExpr): string => {
  switch (expr.tag) {
    case "Identifier":
      return prettyVar(expr);
    case "StringLit":
      return expr.contents;
    case "Deconstructor": {
      const { variable, field } = expr;
      return `${prettyVar(variable)}.${prettyVar(field)}`;
    }
    case "ApplyFunction":
    case "Func":
    case "ApplyConstructor": {
      const { name, args } = expr;
      const argStr = args.map((arg) => prettyExpr(arg)).join(", ");
      return `${prettyVar(name)}(${argStr})`;
    }
  }
};

//#endregion
