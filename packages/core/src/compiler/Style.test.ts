// Must be run from penrose-web for loading files

import * as S from "compiler/Style";
import { compileSubstance, parseSubstance } from "compiler/Substance";
import * as fs from "fs";
import _ from "lodash";
import * as path from "path";
import { Either } from "types/common";
import { Env } from "types/domain";
import { PenroseError, StyleErrors } from "types/errors";
import { State } from "types/state";
import { StyProg } from "types/style";
import { SubProg, SubstanceEnv } from "types/substance";
import { andThen, Result, showError, unsafelyUnwrap } from "utils/Error";
import { compileDomain } from "./Domain";
// TODO: Reorganize and name tests by compiler stage

// Load file in format "domain-dir/file.extension"
const loadFile = (examplePath: string): string => {
  const file = path.join("../../examples/", examplePath);
  const prog = fs.readFileSync(file, "utf8");
  return prog;
};

const loadFiles = (paths: string[]): string[] => {
  return paths.map(loadFile);
};

// Run the Domain + Substance parsers and checkers to yield the Style compiler's input
// files must follow schema: { domain, substance, style }
// Disambiguates functions as well
export const loadProgs = ([domainStr, subStr, styStr]: [
  string,
  string,
  string
]): [Env, SubstanceEnv, SubProg, StyProg] => {
  const domainProgRes: Result<Env, PenroseError> = compileDomain(domainStr);
  const env0: Env = unsafelyUnwrap(domainProgRes);

  // TODO: Could be more efficient if compileSubstance also outputs parsed Sub program
  const subProg: SubProg = unsafelyUnwrap(parseSubstance(subStr));
  const envs: Result<[SubstanceEnv, Env], PenroseError> = compileSubstance(
    subStr,
    env0
  );

  const [subEnv, varEnv]: [SubstanceEnv, Env] = unsafelyUnwrap(envs);
  const styProg: StyProg = unsafelyUnwrap(S.parseStyle(styStr));

  const res: [Env, SubstanceEnv, SubProg, StyProg] = [
    varEnv,
    subEnv,
    subProg,
    styProg,
  ];

  S.disambiguateFunctions(varEnv, subProg);
  return res;
};

const canvasPreamble = `canvas {
  width = 800
  height = 700
}
`;

describe("Compiler", () => {
  // COMBAK: StyleTestData is deprecated. Make the data in the test file later (@hypotext).
  // // Each possible substitution should be full WRT its selector
  // test("substitution: S.fullSubst true", () => {
  //   for (let i = 0; i < selEnvs.length; i++) {
  //     for (let j = 0; j < possibleSubsts[i].length; j++) {
  //       expect(S.fullSubst(selEnvs[i], possibleSubsts[i][j] as Subst)).toEqual(
  //         true
  //       );
  //     }
  //   }
  // });

  // COMBAK: StyleTestData is deprecated. Make the data in the test file later (@hypotext).
  // test("substitution: S.fullSubst false", () => {
  //   // Namespace shouldn't have matches
  //   const ps0: Subst = { test: "A" };
  //   expect(S.fullSubst(selEnvs[0], ps0)).toEqual(false);

  //   // Selector should have real substitution
  //   const ps1 = { v: "x1", U: "X" }; // missing "w" match
  //   expect(S.fullSubst(selEnvs[6], ps1)).toEqual(false);
  // });

  test("substitution: S.uniqueKeysAndVals true", () => {
    // This subst has unique keys and vals
    expect(S.uniqueKeysAndVals({ a: "V", c: "z" })).toEqual(true);
  });

  test("substitution: S.uniqueKeysAndVals false", () => {
    // This subst doesn't have unique keys and vals
    expect(S.uniqueKeysAndVals({ a: "V", c: "V" })).toEqual(false);
  });

  // COMBAK: StyleTestData is deprecated. Make the data in the test file later (@hypotext).
  // // For the 6th selector in the LA Style program, substituting in this substitution into the relational expressions yields the correct result (where all vars are unique)
  // test("substitute unique vars in selector", () => {
  //   const subst: Subst = { v: "x1", U: "X", w: "x2" };
  //   const rels: RelationPattern[] = selEnvs[6].header.contents.where.contents; // This is selector #6 in the LA Style program
  //   // `rels` stringifies to this: `["In(v, U)", "Unit(v)", "Orthogonal(v, w)"]`
  //   const relsSubStr = rels
  //     .map((rel) => S.substituteRel(subst, rel))
  //     .map(S.ppRel);
  //   const answers = ["In(x1, X)", "Unit(x1)", "Orthogonal(x1, x2)"];

  //   for (const [res, expected] of _.zip(relsSubStr, answers)) {
  //     expect(res).toEqual(expected);
  //   }
  // });

  // COMBAK: StyleTestData is deprecated. Make the data in the test file later (@hypotext).
  // // For the 6th selector in the LA Style program, substituting in this substitution into the relational expressions yields the correct result (where two vars are non-unique, `x2`)
  // test("substitute non-unique vars in selector", () => {
  //   const subst: Subst = { v: "x2", U: "X", w: "x2" };
  //   const rels: RelationPattern[] = selEnvs[6].header.contents.where.contents; // This is selector #6 in the LA Style program
  //   // `rels` stringifies to this: `["In(v, U)", "Unit(v)", "Orthogonal(v, w)"]`
  //   const relsSubStr = rels
  //     .map((rel) => S.substituteRel(subst, rel))
  //     .map(S.ppRel);
  //   const answers = ["In(x2, X)", "Unit(x2)", "Orthogonal(x2, x2)"];

  //   for (const [res, expected] of _.zip(relsSubStr, answers)) {
  //     expect(res).toEqual(expected);
  //   }
  // });

  // COMBAK: StyleTestData is deprecated. Make the data in the test file later (@hypotext).
  // // Compiler finds the right substitutions for LA Style program
  // // Note that this doesn't test subtypes
  // test("finds the right substitutions for LA Style program", () => {
  //   // This code is cleaned up from `S.compileStyle`; runs the beginning of compiler checking from scratch
  //   const triple: [string, string, string] = [
  //     "linear-algebra-domain/linear-algebra.dsl",
  //     "linear-algebra-domain/twoVectorsPerp-unsugared.sub",
  //     "linear-algebra-domain/linear-algebra-paper-simple.sty",
  //   ];

  //   const [varEnv, subEnv, subProg, styProgInit]: [
  //     Env,
  //     SubstanceEnv,
  //     SubProg,
  //     StyProg
  //   ] = loadProgs(loadFiles(triple) as [string, string, string]);

  //   const selEnvs = S.checkSelsAndMakeEnv(varEnv, styProgInit.blocks);

  //   const selErrs: StyleErrors = _.flatMap(selEnvs, (e) =>
  //     e.warnings.concat(e.errors)
  //   );

  //   if (selErrs.length > 0) {
  //     const err = `Could not compile. Error(s) in Style while checking selectors`;
  //     console.log([err].concat(selErrs.map((e) => showError(e))));
  //     fail();
  //   }

  //   const subss = S.findSubstsProg(
  //     varEnv,
  //     subEnv,
  //     subProg,
  //     styProgInit.blocks,
  //     selEnvs
  //   ); // TODO: Use `eqEnv`

  //   if (subss.length !== correctSubsts.length) {
  //     fail();
  //   }

  //   for (const [res, expected] of _.zip(subss, correctSubsts)) {
  //     expect(res).toEqual(expected);
  //   }
  // });

  // There are no AnonAssign statements, i.e. they have all been substituted out (proxy test for `S.nameAnonStatements` working)
  test("There are no anonymous statements", () => {
    const triple: [string, string, string] = [
      "linear-algebra-domain/linear-algebra.dsl",
      "linear-algebra-domain/twoVectorsPerp-unsugared.sub",
      "linear-algebra-domain/linear-algebra-paper-simple.sty",
    ];

    const [varEnv, subEnv, subProg, styProgInit]: [
      Env,
      SubstanceEnv,
      SubProg,
      StyProg
    ] = loadProgs(loadFiles(triple) as [string, string, string]);

    const selEnvs = S.checkSelsAndMakeEnv(varEnv, styProgInit.blocks);
    const selErrs: StyleErrors = _.flatMap(selEnvs, (e) =>
      e.warnings.concat(e.errors)
    );

    if (selErrs.length > 0) {
      const err = `Could not compile. Error(s) in Style while checking selectors`;
      console.log([err].concat(selErrs.map((e) => showError(e))));
      expect(false).toEqual(true);
    }

    const styProg: StyProg = S.nameAnonStatements(styProgInit);

    for (const hb of styProg.blocks) {
      for (const stmt of hb.block.statements) {
        expect(stmt.tag).not.toEqual("AnonAssign");
      }
    }
  });

  const sum = (acc: number, n: number, i: number): Either<string, number> =>
    i > 2 ? S.toLeft("error") : S.ToRight(acc + n);

  test("S.foldM none", () => {
    expect(S.foldM([], sum, -1)).toEqual(S.ToRight(-1));
  });

  test("S.foldM right", () => {
    expect(S.foldM([1, 2, 3], sum, -1)).toEqual(S.ToRight(5));
  });

  test("S.foldM left", () => {
    expect(S.foldM([1, 2, 3, 4], sum, -1)).toEqual(S.toLeft("error"));
  });

  const xs = ["a", "b", "c"];
  test("numbered", () => {
    expect(S.numbered(xs)).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  describe("Correct Style programs", () => {
    const domainProg = "type Object";
    const subProg = "Object o";
    // TODO: Name these programs
    const styProgs = [
      // These are mostly to test setting shape properties as vectors or accesspaths
      `Object o {
    shape o.shape = Line {}
    o.shape.start[0] = 0.
}
`,
      `Object o {
    shape o.shape = Line {
        start: (0., ?)
    }
}`,
      `Object o {
    shape o.shape = Line {
          start: (?, ?)
    }
    o.shape.start[0] = 0.
}`,
      `Object o {
    o.y = ?
    shape o.shape = Line {
        start: (0., o.y)
    }
}`,
      // Set field
      `Object o {
       o.f = (?, ?)
       o.f[0] = 0.
       o.shape = Circle {}
}`,
      `canvas {
  override width = 500.0
}`,
    ];

    const domainRes: Result<Env, PenroseError> = compileDomain(domainProg);

    const subRes: Result<[SubstanceEnv, Env], PenroseError> = andThen(
      (env) => compileSubstance(subProg, env),
      domainRes
    );

    for (const styProg of styProgs) {
      const styRes: Result<State, PenroseError> = andThen(
        (res) => S.compileStyle(canvasPreamble + styProg, ...res),
        subRes
      );

      if (!styRes.isOk()) {
        fail(
          `Expected Style program to work without errors. Got error ${styRes.error.errorType}`
        );
      } else {
        expect(true).toEqual(true);
      }
    }
  });

  // TODO: There are no tests directly for the substitution application part of the compiler, though I guess you could walk the AST (making the substitution-application code more generic to do so) and check that there are no Style variables anywhere? Except for, I guess, namespace names?

  describe("Correct style programs with predicate aliasing", () => {
    const domainProg = "type Set\npredicate IsSubset : Set s1 * Set s2";
    const subProg = "Set A\nSet B\nSet C\nIsSubset(B,A)\nIsSubset(C,B)";
    // TODO: Name these programs
    const styProgs = [
      // These are mostly to test setting shape properties as vectors or accesspaths
      `Set x; Set y where IsSubset(x,y) as foo {}
`,
      `Set x; Set y where IsSubset(x,y) as foo {
  foo.icon = Circle{}
}`,
      `Set a; Set b where IsSubset(a,b) as foo {
  foo.icon = Square{}
}

Set u; Set v where IsSubset(u,v) as bar {
  bar.icon2 = Ellipse{}
}
`,
      `Set x; Set y where IsSubset(x,y) as foo {
  foo.arrow = Arrow { thickness : 2.0 }
}
Set A; Set B where IsSubset(A,B) as bar {
  override bar.arrow.thickness = 1.5
}
`,
      `canvas {
  override width = 500.0
}`,
    ];

    const domainRes: Result<Env, PenroseError> = compileDomain(domainProg);

    const subRes: Result<[SubstanceEnv, Env], PenroseError> = andThen(
      (env) => compileSubstance(subProg, env),
      domainRes
    );

    // specific tests
    for (let i = 0; i < styProgs.length; i++) {
      const styProg = styProgs[i];
      const styRes: Result<State, PenroseError> = andThen(
        (res) => S.compileStyle(canvasPreamble + styProg, ...res),
        subRes
      );

      if (!styRes.isOk()) {
        fail(
          `Expected Style program to work without errors. Got error ${styRes.error.errorType}`
        );
      } else {
        const initialState = styRes.value;
        const existsInTr = (str: string) => {
          return Object.keys(initialState.translation.trMap).includes(str);
        };
        const existsInNamedObj = (name: string, field: string) => {
          return Object.keys(initialState.translation.trMap[name]).includes(
            field
          );
        };
        if (i === 1) {
          expect(["IsSubset_B_A", "IsSubset_C_B"].every(existsInTr)).toBe(true);
        } else if (i === 2) {
          test("aliased keys exist", () => {
            expect(["IsSubset_B_A", "IsSubset_C_B"].every(existsInTr)).toBe(
              true
            );
          });
          test("all fields exist", () => {
            expect(
              [
                ["IsSubset_B_A", "icon"],
                ["IsSubset_B_A", "icon2"],
                ["IsSubset_C_B", "icon"],
                ["IsSubset_C_B", "icon2"],
              ].every(([name, field]) => existsInNamedObj(name, field))
            ).toBe(true);
          });
        } else if (i === 3) {
          test("aliased keys exist", () => {
            expect(["IsSubset_B_A", "IsSubset_C_B"].every(existsInTr)).toBe(
              true
            );
          });
          test("arrow field exists", () => {
            expect(
              [
                ["IsSubset_B_A", "arrow"],
                ["IsSubset_C_B", "arrow"],
              ].every(([name, field]) => existsInNamedObj(name, field))
            ).toBe(true);
          });
          test("arrow thickness field is correct", () => {
            expect(
              ["IsSubset_B_A", "IsSubset_C_B"].every((name) => {
                return (
                  initialState.translation.trMap[name]["arrow"].contents[1]
                    .thickness.contents.contents === 1.5
                );
              })
            ).toBe(true);
          });
        }
      }
    }
  });

  // Test errors
  const PRINT_ERRORS = false;

  const expectErrorOf = (
    result: Result<State, PenroseError>,
    errorType: string
  ) => {
    if (result.isErr()) {
      const res: PenroseError = result.error;
      if (res.errorType !== "StyleError") {
        fail(
          `Error ${errorType} was supposed to occur. Got a non-Style error '${res.errorType}'.`
        );
      }

      if (res.tag !== "StyleErrorList") {
        fail(
          `Error ${errorType} was supposed to occur. Did not receive a Style list. Got ${res.tag}.`
        );
      }

      if (PRINT_ERRORS) {
        console.log(result.error);
      }

      expect(res.errors[0].tag).toBe(errorType);
    } else {
      fail(`Error ${errorType} was supposed to occur.`);
    }
  };

  describe("Expected Style errors", () => {
    const subProg = loadFile("set-theory-domain/twosets-simple.sub");
    const domainProg = loadFile("set-theory-domain/setTheory.dsl");
    // We test variations on this Style program
    // const styPath = "set-theory-domain/venn.sty";

    const domainRes: Result<Env, PenroseError> = compileDomain(domainProg);

    const subRes: Result<[SubstanceEnv, Env], PenroseError> = andThen(
      (env) => compileSubstance(subProg, env),
      domainRes
    );

    const testStyProgForError = (styProg: string, errorType: string) => {
      let preamble = errorType.startsWith("Canvas") ? "" : canvasPreamble;
      const styRes: Result<State, PenroseError> = andThen(
        (res) => S.compileStyle(preamble + styProg, ...res),
        subRes
      );
      describe(errorType, () => {
        expectErrorOf(styRes, errorType);
      });
    };

    const errorStyProgs = {
      // ------ Selector errors (from Substance)
      SelectorDeclTypeError: [`forall Setfhjh x { }`],
      SelectorVarMultipleDecl: [`forall Set x; Set x { }`],

      // COMBAK: Style doesn't throw parse error if the program is just "forall Point `A`"... instead it fails inside compileStyle with an undefined selector environment
      SelectorDeclTypeMismatch: [`forall Point \`A\` { }`],

      SelectorRelTypeMismatch: [
        `forall Point x; Set y; Set z
      where x := Union(y, z) { } `,
      ],

      TaggedSubstanceError: [
        `forall Set x; Point y
where IsSubset(y, x) { }`,
      ],

      SelectorAliasNamingError: [
        `forall Set x; Set y where IsSubset(x,y) as Set { }`,
        `forall Set x; Set y where IsSubset(x,y) as IsSubset { }`,
        `Set x; Set y where IsSubset(x,y) as Union {}`,
        `Set x; Set y where IsSubset(x,y) as x {}`,
        `Set x; Set y where IsSubset(x,y) as y {}`,
        `Set A; Set B where IsSubset(A,B) as A {}`,
      ],

      // ---------- Block static errors

      InvalidGPITypeError: [`forall Set x { x.icon = Circl { } }`],

      // COMBAK: Check that multiple wrong properties are checked -- i.e. this dict ontology has to be extended so that one program can have multiple errors
      InvalidGPIPropertyError: [
        `forall Set x {  
          x.icon = Circle { 
           centre: (0.0, 0.0) 
           r: 9.
           diameter: 100.
         } 
       }`,
      ],

      // Have to do a nested search in expressions for this
      InvalidFunctionNameError: [
        `forall Set x { x.icon = Circle { r: ksajfksdafksfh(0.0, "hi") } }`,
        `forall Set x { x.icon = Circle { r: get(0.0, sjkfhsdk("hi")) } }`,
        `forall Set x { x.icon = Circle { r: wjhkej(0.0, sjkfhsdk("hi")) } }`,
      ],

      InvalidObjectiveNameError: [`forall Set x { encourage sjdhfksha(0.0) }`],

      InvalidConstraintNameError: [`forall Set x { ensure jahfkjdhf(0.0) }`],

      // ------- Translation errors (deletion)
      DeletedPropWithNoSubObjError: [`forall Set x { delete y.z.p }`],
      DeletedPropWithNoFieldError: [
        `forall Set x { x.icon = Circle { }
delete x.z.p }`,
      ],

      DeletedPropWithNoGPIError: [
        `forall Set x { x.z = 0.0
delete x.z.p }`,
      ],

      // COMBAK: This doesn't catch the error
      // COMBAK: Style appears to throw parse error if line ends with a trailing space
      // COMBAK: Why is this a parse error??
      // COMBAK: Test the instance in `insertExpr` as well as in `compileStyle`
      //       CircularPathAlias: [`forall Set x { x.icon = Circle { }
      // x.icon.center = x.icon.center }`],

      DeletedNonexistentFieldError: [`forall Set x { delete x.z }`],
      DeletedVectorElemError: [
        `forall Set x {  
         x.icon = Circle { 
           center: (0.0, 0.0) 
         }
         delete x.icon[0] }`,
      ],

      // ---------- Translation errors (insertion)

      InsertedPathWithoutOverrideError: [
        `forall Set x { 
           x.z = 1.0 
           x.z = 2.0
}`,
        `forall Set x { 
         x.icon = Circle { 
           center: (0.0, 0.0) 
         }
           x.icon.center = 2.0
}`,
      ],

      InsertedPropWithNoFieldError: [
        `forall Set x {
    x.icon.r = 0.0
}`,
      ],

      InsertedPropWithNoGPIError: [
        `forall Set x {
    x.icon = "hello"
    x.icon.r = 0.0
}`,
      ],

      // ----------- Translation validation errors
      // TODO(errors): check multiple errors

      // TODO(errors): This throws too early, gives InsertedPathWithoutOverrideError -- correctly throws error but may be misleading

      // NonexistentNameError:
      //   [`forall Set x { A.z = 0. }`],

      NonexistentFieldError: [`forall Set x { x.icon = Circle { r: x.r } }`],
      NonexistentGPIError: [
        `forall Set x {  
         x.z = x.c.p
       }`,
      ],
      NonexistentPropertyError: [
        `forall Set x {  
          x.icon = Circle { 
           r: 9.
           center: (x.icon.z, 0.0)
         } 
       }`,
      ],
      ExpectedGPIGotFieldError: [
        `forall Set x { 
           x.z = 1.0 
           x.y = x.z.p
}`,
      ],
      CanvasNonexistentError: [
        `foo { 
  bar = 1.0
}`,
      ],
      CanvasNonexistentDimsError: [
        `canvas { 
  height = 100
}`,
        `canvas {
  width = Circle {}
  height = 100
}`,
        `canvas {
  width = ?
  height = 100
}`,
        `canvas {
  width = (1.0, 1.0)
  height = 100
}`,
        `canvas { 
  width = 100
}`,
        `canvas {
  width = 100
  height = Circle {}
}`,
        `canvas {
  width = 100
  height = ?
}`,
        `canvas {
  width = 100
  height = (1.0, 1.0)
}`,
      ],
      // TODO: this test should _not_ fail, but it's failing because we are skipping `OptEval` checks for access paths
      //       InvalidAccessPathError: [
      //         `forall Set x {
      //            x.z = 1.0
      //            x.y = x.z[0]
      // }`,
      //       ],

      // ---------- Runtime errors (insertExpr)

      // COMBAK / TODO(errors): Test this more thoroughly
      // COMBAK / NOTE: runtime errors aren't caught if an expr isn't evaluated, since we don't have statics. Test these separately.

      //       RuntimeValueTypeError: [
      //         `forall Set x {
      //          x.icon = Circle {
      //            center: (0.0, 0.0)
      //          }
      //            x.icon.center[0] = "hello"
      //            x.icon.center[1] = x.icon.center[0]
      // }`]
    };

    // ---------- Errors that should maybe be modeled + tested

    // COMBAK: Should this have a warning/error? Currently doesn't
    // `forall Set x { x.icon = Circle { }; delete x.icon.z }

    // COMBAK: These both cause a weird crash that's not caught
    // override x.icon = x.icon
    // ensure contains(x.icon, x.text2)

    // forall Set x { x.icon = Circle { }
    // x.icon2 = x.icon
    // x.icon2.strokeWidth = 5.0
    // -- COMBAK: This line does not appear to have worked
    // delete x.icon2.strokeWidth
    // }

    // Test that each program yields its error type
    for (const [errorType, styProgs] of Object.entries(errorStyProgs)) {
      for (const styProg of styProgs) {
        // TODO(error): improve this so it becomes individual tests, using the framework
        // console.log("testing", errorType);
        testStyProgForError(styProg, errorType);
      }
    }
  });
});
