import * as fs from "fs";
import * as path from "path";
import seedrandom from "seedrandom";
import {
  compileTrio,
  evalEnergy,
  evalFns,
  prepareState,
  readRegistry,
  RenderStatic,
  showError,
  stepUntilConvergence,
} from "../index";

const OUTPUT = "/tmp/diagrams";
const EXAMPLES = "../../examples";
const registryPath = path.join(EXAMPLES, "registry.json");
const saveDiagrams = true;
const registry = JSON.parse(fs.readFileSync(registryPath).toString());
const vennStyle = fs
  .readFileSync(path.join(EXAMPLES, registry.styles["venn"].URI))
  .toString();
const setDomain = fs
  .readFileSync(path.join(EXAMPLES, registry.domains["set-theory"].URI))
  .toString();

describe("End-to-end testing of existing diagrams", () => {
  const registry = JSON.parse(fs.readFileSync(registryPath).toString());
  const trios = readRegistry(registry);
  for (const trio of trios) {
    const { name, substanceURI, domainURI, styleURI } = trio;
    const [sub, sty, dsl] = [substanceURI, styleURI, domainURI].map((uri) =>
      fs.readFileSync(path.join(EXAMPLES, uri)).toString()
    );

    test(name, async () => {
      seedrandom("secret-seed", { global: true }); // HACK: constant seed for pseudorandomness
      if (saveDiagrams && !fs.existsSync(OUTPUT)) {
        fs.mkdirSync(OUTPUT);
      }
      const res = compileTrio(dsl, sub, sty);
      if (res.isOk()) {
        const state = await prepareState(res.value);
        const optimized = stepUntilConvergence(state);
        const rendered = RenderStatic(optimized);
        fs.writeFileSync(
          path.join(OUTPUT, `${name}.svg`),
          rendered.outerHTML,
          "utf8"
        );
      } else {
        fail(res.error);
      }
    });
  }
});

describe("Energy API", () => {
  test("eval overall energy - init vs. optimized", async () => {
    const twoSubsets = `Set A, B\nIsSubset(B, A)\nAutoLabel All`;
    const res = compileTrio(setDomain, twoSubsets, vennStyle);
    if (res.isOk()) {
      const stateEvaled = await prepareState(res.value);
      const stateOptimized = stepUntilConvergence(stateEvaled);
      const initEng = evalEnergy(stateEvaled);
      const optedEng = evalEnergy(stateOptimized);
      expect(initEng).toBeGreaterThan(optedEng);
    } else {
      console.log(showError(res.error));
    }
  });
  test("filtered constraints", async () => {
    const twoSubsets = `Set A, B\nIsSubset(B, A)\nAutoLabel All`;
    const res = compileTrio(setDomain, twoSubsets, vennStyle);
    if (res.isOk()) {
      // NOTE: delibrately not cache the overall objective and re-generate for original and filtered states
      const state = res.value;
      const smallerThanFns = state.constrFns.filter(
        (c) => c.fname === "smallerThan"
      );
      const stateFiltered = { ...state, constrFns: smallerThanFns };
      expect(evalEnergy(state)).toBeGreaterThan(evalEnergy(stateFiltered));
    } else {
      console.log(showError(res.error));
    }
  });
});

describe("Cross-instance energy eval", () => {
  test("correct - subsets", async () => {
    const twosets = `Set A, B\nAutoLabel All`;
    const twoSubsets = `Set A, B\nIsSubset(B, A)\nAutoLabel All`;
    // compile and optimize both states
    const state1 = compileTrio(setDomain, twosets, vennStyle);
    const state2 = compileTrio(setDomain, twoSubsets, vennStyle);
    if (state1.isOk() && state2.isOk()) {
      const state1Done = stepUntilConvergence(await prepareState(state1.value));
      const state2Done = stepUntilConvergence(await prepareState(state2.value));
      const crossState21 = {
        ...state2Done,
        constrFns: state1Done.constrFns,
        objFns: state1Done.objFns,
      };
      expect(evalEnergy(await prepareState(crossState21))).toBeCloseTo(0);
      const crossState12 = {
        ...state1Done,
        constrFns: state2Done.constrFns,
        objFns: state2Done.objFns,
      };
      expect(evalEnergy(await prepareState(crossState12))).toBeGreaterThan(0);
      // console.log(RenderStatic(crossState12).outerHTML);
      // console.log(RenderStatic(crossState21).outerHTML);
    } else {
      fail("compilation failed");
    }
  });
});

describe("Run individual functions", () => {
  // TODO: Test evalFns vs overall objective? Also, test individual functions more thoroughly
  const EPS = 1e-3; // Minimized objectives should be close to 0

  test("Check each individual function is minimized/satisfied", async () => {
    const twoSubsets = `Set A, B\nIsSubset(B, A)\nAutoLabel All`;
    const res = compileTrio(setDomain, twoSubsets, vennStyle);

    if (res.isOk()) {
      const stateEvaled = await prepareState(res.value);
      const stateOptimized = stepUntilConvergence(stateEvaled);

      // console.log("# objectives", stateEvaled.objFns.length);
      // console.log("# constraints", stateEvaled.constrFns.length);

      // Test objectives
      const initEngsObj = evalFns(stateEvaled.objFns, stateEvaled);
      const optedEngsObj = evalFns(stateEvaled.objFns, stateOptimized);

      for (let i = 0; i < initEngsObj.length; i++) {
        // console.log("obj energies", initEngsObj[i], optedEngsObj[i]);
        expect(initEngsObj[i]).toBeGreaterThanOrEqual(optedEngsObj[i]);
        expect(optedEngsObj[i]).toBeLessThanOrEqual(EPS);
      }

      // Test constraints
      const initEngsConstr = evalFns(stateEvaled.constrFns, stateEvaled);
      const optedEngsConstr = evalFns(stateEvaled.constrFns, stateOptimized);

      for (let i = 0; i < initEngsConstr.length; i++) {
        // console.log("constr energies", initEngsConstr[i], optedEngsConstr[i]);
        if (initEngsConstr[i] < 0 && optedEngsConstr[i] < 0) {
          // If it was already satisfied and stays satisfied, the magnitude of the constraint doesn't matter (i.e. both are negative)
          expect(true).toEqual(true);
        } else {
          expect(initEngsConstr[i]).toBeGreaterThanOrEqual(optedEngsConstr[i]);
          // Check constraint satisfaction (< 0)
          expect(optedEngsConstr[i]).toBeLessThanOrEqual(0);
        }
      }
    } else {
      console.log(showError(res.error));
    }
  });
});
