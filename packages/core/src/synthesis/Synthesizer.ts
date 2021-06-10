import {
  appendStmt,
  applyBind,
  applyConstructor,
  applyFunction,
  applyPredicate,
  applyTypeDecl,
  argMatches,
  autoLabelStmt,
  changeType,
  domainToSubType,
  matchSignatures,
  nullaryTypeCons,
  replaceStmt,
  swapArgs,
} from "analysis/SubstanceAnalysis";
import { prettyStmt, prettySubstance } from "compiler/Substance";
import consola, { LogLevel } from "consola";
import { dummyIdentifier } from "engine/EngineUtils";
import { Map } from "immutable";
import { cloneDeep, range, times, without } from "lodash";
import { choice, random } from "pandemonium";
import { Identifier } from "types/ast";
import {
  Arg,
  ConstructorDecl,
  DomainStmt,
  Env,
  FunctionDecl,
  PredicateDecl,
  Type,
  TypeConstructor,
  TypeDecl,
} from "types/domain";
import {
  ApplyConstructor,
  ApplyFunction,
  ApplyPredicate,
  Bind,
  Decl,
  SubExpr,
  SubPredArg,
  SubProg,
  SubRes,
  SubStmt,
  TypeConsApp,
} from "types/substance";

const log = consola
  .create({ level: LogLevel.Info })
  .withScope("Substance Synthesizer");

//#region Synthesizer setting types

type All = "*";
type ArgOption = "existing" | "generated" | "mixed";
type ArgReuse = "distinct" | "repeated";
type MatchSetting = string[] | All;
interface DeclTypes {
  type: MatchSetting;
  predicate: MatchSetting;
  constructor: MatchSetting;
  function: MatchSetting;
}
export interface SynthesizerSetting {
  mutationCount: [number, number];
  argOption: ArgOption;
  argReuse: ArgReuse;
  weights: {
    type: number;
    predicate: number;
    constructor: number;
  };
  add: DeclTypes;
  delete: DeclTypes;
  edit: DeclTypes;
}

//#endregion

//#region Synthesis context

type Mutation = Add | Delete | Modify;
type Modify = Swap | Replace | ReplaceName | TypeChange;

interface Add {
  tag: "Add";
  stmt: SubStmt;
}
interface Delete {
  tag: "Delete";
  stmt: SubStmt;
}

interface Replace {
  tag: "Replace";
  old: SubStmt;
  new: SubStmt;
  mutationType: string;
}

interface Swap {
  tag: "Swap";
  stmt: SubStmt;
  elem1: number;
  elem2: number;
}

interface ReplaceName {
  tag: "ReplaceName";
  stmt: SubStmt;
}

interface TypeChange {
  tag: "TypeChange";
  stmt: SubStmt;
}

interface Candidates {
  types: Map<string, TypeDecl>;
  functions: Map<string, FunctionDecl>;
  predicates: Map<string, PredicateDecl>;
  constructors: Map<string, ConstructorDecl>;
}

interface SynthesizedSubstance {
  prog: SubProg;
  ops: string;
}

class SynthesisContext {
  names: Map<string, number>;
  declaredIDs: Map<string, Identifier[]>;
  prog: SubProg;
  numStmts: number;
  maxStmts: number;
  candidates: Candidates;
  subRes: SubRes | undefined;
  ops: Mutation[];
  template: SubProg | undefined;
  argCxt: Identifier[];

  constructor(subRes?: SubRes) {
    this.numStmts = 0;
    this.names = Map();
    this.declaredIDs = Map();
    this.maxStmts = 0;
    this.candidates = {
      types: Map(),
      constructors: Map(),
      functions: Map(),
      predicates: Map(),
    };
    this.subRes = subRes;
    this.prog = {
      tag: "SubProg",
      statements: [],
    };
    this.ops = [];
    this.argCxt = [];
  }

  loadTemplate = () => {
    // If there is a template substance program, load in the relevant info
    if (this.subRes) {
      const [subEnv, env] = this.subRes;
      this.template = cloneDeep(subEnv.ast);
      this.prog = cloneDeep(subEnv.ast);
      env.varIDs.forEach((id) => {
        const type = env.vars.get(id.value);
        this.addID(type!.name.value, id); // TODO: enforce the existence of var types
      });
    }
  };

  findCandidates = (env: Env, setting: DeclTypes) => {
    this.candidates = {
      types: filterBySetting(env.types, setting.type),
      functions: filterBySetting(env.functions, setting.function),
      predicates: filterBySetting(env.predicates, setting.predicate),
      constructors: filterBySetting(env.constructors, setting.constructor),
    };
  };

  printCandidates = () => {
    console.log("types: ", ...this.candidates.types.keys());
    console.log("predicates: ", ...this.candidates.predicates.keys());
    console.log("functions: ", ...this.candidates.functions.keys());
    console.log("constructors: ", ...this.candidates.constructors.keys());
  };

  getCandidates = (type: DomainStmt["tag"]): Map<string, DomainStmt> => {
    switch (type) {
      case "TypeDecl":
        return this.candidates.types;
      case "ConstructorDecl":
        return this.candidates.constructors;
      case "FunctionDecl":
        return this.candidates.functions;
      case "PredicateDecl":
        return this.candidates.predicates;
      case undefined:
        return Map();
    }
    throw new Error(`${type} is not supported by the synthesizer`);
  };

  candidateTypes = (): DomainStmt["tag"][] =>
    declTypes.filter((type) => !this.getCandidates(type).isEmpty());

  //n append a statement to the generated program
  appendStmt = (stmt: SubStmt) => {
    this.prog = appendStmt(this.prog, stmt);
    this.numStmts++;
    this.ops.push({ tag: "Add", stmt });
  };

  replaceStmt = (
    originalStmt: SubStmt,
    newStmt: SubStmt,
    mutationType: string
  ): void => {
    this.prog = replaceStmt(this.prog, originalStmt, newStmt);
    this.ops.push({
      tag: "Replace",
      old: originalStmt,
      new: newStmt,
      mutationType,
    });
  };

  removeStmt = (stmt: SubStmt) => {
    const index = this.prog.statements.indexOf(stmt);
    if (index > -1) {
      this.prog.statements.splice(index, 1);
      this.ops.push({ tag: "Delete", stmt });
    } else {
      throw new Error(
        `Statement cannot be removed because it doesn't exist: ${prettyStmt(
          stmt
        )}`
      );
    }
    // COMBAK: increment counter?
  };

  showOps = (): string => {
    return this.ops.map((op) => this.showOp(op)).join("\n");
  };

  showOp = (op: Mutation) => {
    if (op.tag === "Replace") {
      return `${op.tag} ${prettyStmt(op.old)} by ${prettyStmt(op.new)} via ${
        op.mutationType
      }`;
    } else {
      return `${op.tag} ${prettyStmt(op.stmt)}`;
    }
  };

  addArg = (id: Identifier): void => {
    this.argCxt.push(id);
  };

  resetArgContext = (): void => {
    this.argCxt = [];
  };

  reset = (maxStmts: number) => {
    this.ops = [];
    this.maxStmts = maxStmts;
    this.names = Map();
    this.declaredIDs = Map();
    this.prog = {
      tag: "SubProg",
      statements: [],
    };
    this.argCxt = [];
    this.loadTemplate();
  };

  addID = (typeStr: string, id: Identifier) => {
    const ids = this.declaredIDs.get(typeStr);
    if (ids) {
      this.declaredIDs = this.declaredIDs.set(typeStr, [...ids, id]);
    } else {
      this.declaredIDs = this.declaredIDs.set(typeStr, [id]);
    }
  };

  /**
   * Remove a declared ID, NOTE: this should be called whenever we delete a Decl
   * statement from list of statements to keep them in sync.
   * @param typeStr either a Bind or Decl that is staged to be deleted
   * @param id the identifier that is being removed
   */
  removeID = (typeStr: string, id: Identifier) => {
    const ids = this.declaredIDs.get(typeStr);
    if (ids) {
      // keep all IDs that aren't id
      const newIDs = ids.filter((otherID) => otherID.value !== id.value);
      this.declaredIDs = this.declaredIDs.set(typeStr, newIDs);
    } else {
      log.warn(`Could not find any IDs for ${typeStr}`);
    }
  };

  pickID = (
    typeStr: string,
    excludeList?: Identifier[]
  ): Identifier | undefined => {
    const possibleIDs = this.declaredIDs.get(typeStr);
    if (possibleIDs) {
      const candidates = possibleIDs.filter((id) =>
        excludeList ? !excludeList.includes(id) : true
      );
      return choice([...candidates]);
    } else return undefined;
  };

  generateID = (typeName: Identifier): Identifier => {
    const typeStr = typeName.value;
    const prefix = typeStr[0].toLowerCase();
    const index = this.nextIndex(prefix);
    const id: Identifier = dummyIdentifier(
      `${prefix}${index}`,
      "SyntheticSubstance"
    );
    this.addID(typeStr, id);
    return id;
  };

  nextIndex = (prefix: string): number => {
    const lastIndex = this.names.get(prefix);
    if (lastIndex !== undefined) {
      this.names = this.names.set(prefix, lastIndex + 1);
      return lastIndex + 1;
    } else {
      this.names = this.names.set(prefix, 0);
      return 0;
    }
  };

  autoLabel = (): void => this.appendStmt(autoLabelStmt);
}

//#endregion

//#region Main synthesizer
export class Synthesizer {
  env: Env;
  cxt: SynthesisContext;
  setting: SynthesizerSetting;

  constructor(env: Env, setting: SynthesizerSetting, subRes?: SubRes) {
    this.env = env;
    this.cxt = new SynthesisContext(subRes);
    this.setting = setting;
  }

  /**
   * Top-level function for generating multiple Substance programs.
   * @param numProgs number of Substance programs to generate
   * @returns an array of Substance programs and some metadata (e.g. mutation operation record)
   */
  generateSubstances = (numProgs: number): SynthesizedSubstance[] =>
    times(numProgs, () => {
      const sub = this.generateSubstance();
      return sub;
    });

  generateSubstance = (): SynthesizedSubstance => {
    const numStmts = random(...this.setting.mutationCount);
    this.cxt.reset(numStmts);
    times(numStmts, (n) => {
      this.mutateProgram();
      log.debug(
        `Mutation #${n} done. The program so far:\n${prettySubstance(
          this.cxt.prog
        )}`
      );
    });
    // add autolabel statement
    this.cxt.autoLabel();
    // DEBUG: report results
    console.log(prettySubstance(this.cxt.prog));
    log.info("Operations:\n", this.cxt.showOps());
    console.log("----------");
    return {
      prog: this.cxt.prog,
      ops: this.cxt.showOps(),
    };
  };

  mutateProgram = (): void => {
    const ops = ["add", "delete", "edit"];
    const op = choice(ops);
    if (op === "add") this.addStmt();
    else if (op === "delete") this.deleteStmt();
    else if (op === "edit")
      this.editStmt(choice(["Swap", "ReplaceName", "TypeChange"]));
  };

  editStmt = (op: Modify["tag"]): void => {
    this.cxt.findCandidates(this.env, this.setting.edit);
    const chosenType = choice(this.cxt.candidateTypes());
    const candidates = [...this.cxt.getCandidates(chosenType).keys()];
    const chosenName = choice(candidates);
    const stmt = this.findStmt(chosenType, chosenName);
    if (stmt && (stmt.tag === "ApplyPredicate" || stmt.tag === "Bind")) {
      log.debug(`Editing statement: ${prettyStmt(stmt)}`);
      switch (op) {
        case "Swap": {
          const s = (stmt.tag === "Bind" ? stmt.expr : stmt) as ApplyPredicate;
          const indices = range(0, s.args.length);
          const idx1 = choice(indices);
          const idx2 = choice(without(indices, idx1));
          const newStmt = swapArgs(s, [idx1, idx2]);
          if (stmt.tag === "ApplyPredicate") {
            this.cxt.replaceStmt(stmt, newStmt as ApplyPredicate, op); // TODO: improve types to avoid casting
          } else {
            this.cxt.replaceStmt(
              stmt,
              {
                ...stmt,
                expr: newStmt,
              } as Bind,
              op
            ); // TODO: improve types to avoid casting
          }
          break;
        }
        case "ReplaceName": {
          const s = (stmt.tag === "Bind" ? stmt.expr : stmt) as ApplyPredicate;
          const options = matchSignatures(s, this.env);
          const pick = options.length > 0 ? choice(options) : s;
          if (stmt.tag === "ApplyPredicate" && pick.name !== s.name) {
            this.cxt.replaceStmt(
              stmt,
              {
                ...stmt,
                name: pick.name,
              } as ApplyPredicate,
              op
            );
          } else if (stmt.tag === "Bind" && pick.name !== s.name) {
            if (pick.name !== s.name) {
              this.cxt.replaceStmt(
                stmt,
                {
                  ...stmt,
                  expr: {
                    ...stmt.expr,
                    name: pick.name,
                  },
                } as Bind,
                op
              ); // TODO: improve types to avoid casting
            }
          }
          break;
        }
        case "TypeChange": {
          const options = argMatches(stmt, this.env);
          if (options.length > 0) {
            const pick = choice(options);
            const newStmt = changeType(stmt, pick);
            // remove old statement
            if (
              newStmt.tag === "Bind" &&
              stmt.tag === "Bind" &&
              newStmt.variable.type !== stmt.variable.type
            ) {
              // old bind was replaced by a bind with diff type
              this.cascadingDelete(stmt); // remove refs to the old bind
            } else if (newStmt !== stmt) {
              // otherwise we can simple delete
              this.cxt.removeStmt(stmt);
            }
            // add new statement
            if (newStmt.tag === "Bind") {
              //add declaration of new variable
              this.cxt.appendStmt(this.generateType(newStmt.variable));
            }
            this.cxt.appendStmt(newStmt as SubStmt); //add statement
            // add type change operation to operation list
            this.cxt.ops.push({
              tag: "Replace",
              old: stmt,
              new:
                newStmt.tag === "Bind"
                  ? (newStmt as Bind)
                  : ({ ...newStmt, tag: "ApplyPredicate" } as ApplyPredicate), // tag = ApplyPredicate so op can be prettyPrinted
              mutationType: op,
            });
          }
          break;
        }
      }
    } else {
      log.debug(
        `Failed to find a statement when editing. Candidates are: ${candidates}. Chosen name to find is ${chosenName} of ${chosenType}`
      );
    }
  };

  // NOTE: every synthesizer that 'addStmt' calls is expected to append its result to the AST, instead of just returning it. This is because certain lower-level functions are allowed to append new statements (e.g. 'generateArg'). Otherwise, we could write this module as a combinator.
  addStmt = (): void => {
    log.debug("Adding statement");
    this.cxt.findCandidates(this.env, this.setting.add);
    const chosenType = choice(this.cxt.candidateTypes());
    switch (chosenType) {
      case "TypeDecl":
        this.generateType();
        return;
      case "PredicateDecl":
        this.generatePredicate();
        return;
      case "FunctionDecl":
        this.generateFunction();
        return;
      case "ConstructorDecl":
        this.generateConstructor();
        return;
    }
  };

  deleteStmt = (): void => {
    this.cxt.findCandidates(this.env, this.setting.delete);
    log.debug("Deleting statement");
    const chosenType = choice(this.cxt.candidateTypes());
    const candidates = [...this.cxt.getCandidates(chosenType).keys()];
    const chosenName = choice(candidates);
    const stmt = this.findStmt(chosenType, chosenName);
    if (stmt)
      // if statement returns value, delete all refs to value
      stmt.tag === "Bind" || stmt.tag === "Decl"
        ? this.cascadingDelete(stmt)
        : this.cxt.removeStmt(stmt);
  };

  /**
   * Given a statement which returns a value
   * that is staged to be deleted, iteratively find and delete any other
   * statements that would use the statement's returned variable
   * TODO: Refactor to a pure function and put in SubstanceAnalysis.ts!
   * @param dec either a Bind or Decl that is staged to be deleted
   */
  cascadingDelete = (dec: Bind | Decl): void => {
    const findArg = (s: ApplyPredicate, ref: Identifier | undefined) =>
      ref &&
      s.args.filter((a) => {
        return a.tag === ref.tag && a.value === ref.value;
      }).length > 0;
    const ids = [dec.tag === "Bind" ? dec.variable : dec.name]; // stack of variables to delete
    log.debug("before cascading", this.cxt.prog.statements.length);
    while (ids.length > 0) {
      const id = ids.pop();
      log.debug("looking for instances of:", id?.value);
      // look for statements that take id as arg
      const toDelete = this.cxt.prog.statements.filter((s) => {
        if (s.tag === "Bind") {
          const expr = (s.expr as unknown) as ApplyPredicate;
          const willDelete = findArg(expr, id);
          // push its return value IF bind will be deleted
          if (willDelete) ids.push(s.variable);
          // delete if arg is found in either return type or args
          return willDelete || s.variable.value === id?.value;
        } else if (s.tag === "ApplyPredicate") {
          return findArg(s, id);
        } else if (s.tag === "Decl") {
          return s.name === id;
        }
      });
      log.debug(`stmts with id: ${id?.value}, num stmts: ${toDelete.length}`);
      // remove list of filtered statements
      toDelete.forEach((stmt) => {
        // remove Identifier from added IDs
        if (stmt.tag === "Decl") {
          this.cxt.removeID(stmt.type.name.value, stmt.name);
        }
        this.cxt.removeStmt(stmt);
      });
    }
    log.debug("final stmts", this.cxt.prog.statements.length);
  };

  findStmt = (
    stmtType: DomainStmt["tag"],
    name: string
  ): SubStmt | undefined => {
    const stmts = this.cxt.prog.statements.filter((s) => {
      const subType = domainToSubType(stmtType);
      if (s.tag === "Bind") {
        const expr = s.expr;
        return expr.tag === subType && expr.name.value === name;
      } else if (s.tag === "Decl") {
        return s.tag === subType && s.type.name.value === name;
      } else {
        return s.tag === subType && s.name.value === name;
      }
    });
    if (stmts.length > 0) {
      const stmt = choice(stmts);
      return stmt;
    } else {
      log.debug(
        `Warning: cannot find a ${stmtType} statement with name ${name}.`
      );
    }
  };

  generateType = (typeName?: Identifier): Decl => {
    // pick a type
    let typeCons: TypeConsApp;
    if (typeName) {
      typeCons = nullaryTypeCons(typeName);
    } else {
      const type: TypeDecl = choice(
        this.cxt.candidates.types.toArray().map(([, b]) => b)
      );

      typeCons = applyTypeDecl(type);
    }
    const stmt: Decl = {
      tag: "Decl",
      nodeType: "SyntheticSubstance",
      children: [],
      type: typeCons,
      name: this.cxt.generateID(typeCons.name),
    };
    this.cxt.appendStmt(stmt);
    return stmt;
  };

  generatePredicate = (): ApplyPredicate => {
    const pred: PredicateDecl = choice(
      this.cxt.candidates.predicates.toArray().map(([, b]) => b)
    );
    const args: SubPredArg[] = this.generatePredArgs(pred.args);
    const stmt: ApplyPredicate = applyPredicate(pred, args);
    this.cxt.appendStmt(stmt);
    return stmt;
  };

  generateFunction = (): Bind => {
    const func: FunctionDecl = choice(
      this.cxt.candidates.functions.toArray().map(([, b]) => b)
    );
    const args: SubExpr[] = this.generateArgs(func.args);
    const rhs: ApplyFunction = applyFunction(func, args);
    const outputType = func.output.type as TypeConstructor;
    // TODO: choose between generating vs. reusing
    const lhs: Identifier = this.generateType(outputType.name).name;
    const stmt: Bind = applyBind(lhs, rhs);
    this.cxt.appendStmt(stmt);
    return stmt;
  };

  generateConstructor = (): Bind => {
    const cons: ConstructorDecl = choice(
      this.cxt.candidates.constructors.toArray().map(([, b]) => b)
    );
    const args: SubExpr[] = this.generateArgs(cons.args);
    const rhs: ApplyConstructor = applyConstructor(cons, args);
    const outputType = cons.output.type as TypeConstructor;
    // TODO: choose between generating vs. reusing
    const lhs: Identifier = this.generateType(outputType.name).name;
    const stmt: Bind = applyBind(lhs, rhs);
    this.cxt.appendStmt(stmt);
    return stmt;
  };

  generateArgs = (args: Arg[]): SubExpr[] => {
    const res = args.map((arg) =>
      this.generateArg(arg, this.setting.argOption, this.setting.argReuse)
    );
    this.cxt.resetArgContext();
    return res;
  };

  generateArg = (
    arg: Arg,
    option: ArgOption,
    reuseOption: ArgReuse
  ): SubExpr => {
    const argType: Type = arg.type;
    if (argType.tag === "TypeConstructor") {
      switch (option) {
        case "existing": {
          // TODO: clean up the logic
          const existingID =
            reuseOption === "distinct"
              ? this.cxt.pickID(argType.name.value, this.cxt.argCxt)
              : this.cxt.pickID(argType.name.value);
          if (!existingID) {
            return this.generateArg(arg, "generated", reuseOption);
          } else {
            this.cxt.addArg(existingID);
            return existingID;
          }
        }
        case "generated":
          this.generateType(argType.name);
          return this.generateArg(arg, "existing", reuseOption);
        case "mixed":
          return this.generateArg(
            arg,
            choice(["existing", "generated"]),
            reuseOption
          );
      }
    } else {
      throw new Error(`${argType.tag} not supported for argument generation`);
    }
  };

  generatePredArgs = (args: Arg[]): SubPredArg[] =>
    args.map((arg) =>
      this.generatePredArg(arg, this.setting.argOption, this.setting.argReuse)
    );

  generatePredArg = (
    arg: Arg,
    option: ArgOption,
    reuseOption: ArgReuse
  ): SubPredArg => {
    const argType: Type = arg.type;
    if (argType.tag === "Prop") {
      return this.generatePredicate();
    } else {
      return this.generateArg(arg, option, reuseOption);
    }
  };

  getTemplate = (): SubProg | undefined =>
    this.cxt.template
      ? appendStmt(this.cxt.template, autoLabelStmt)
      : undefined;
}

//#endregion

//#region Helpers

const declTypes: DomainStmt["tag"][] = [
  "ConstructorDecl",
  "FunctionDecl",
  "TypeDecl",
  "PredicateDecl",
];

const filterBySetting = <T>(
  decls: Map<string, T>,
  setting: MatchSetting
): Map<string, T> => {
  if (setting === "*") {
    return decls;
  } else {
    return decls.filter((_, key) => setting.includes(key));
  }
};

//#endregion
