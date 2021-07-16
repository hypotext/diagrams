import {
  valueNumberToAutodiff,
  tagExprNumberToAutodiff,
  insertExpr,
  initConstraintWeight,
} from "engine/EngineUtils";
import { prettyPrintPath } from "utils/OtherUtils";
import { evalShapes } from "engine/Evaluator";
import {
  canvasXRange,
  constValue,
  findDef,
  ShapeDef,
  IPropModel,
} from "renderer/ShapeDef";
import { Shape } from "types/shape";
import { Value } from "types/value";
import { randFloat, randFloats, safe } from "utils/Util";
import { mapValues, zip } from "lodash";
import { TagExpr, Translation } from "types/value";
import { VarAD } from "types/ad";
import { State } from "types/state";
import { Path } from "types/style";

//#region shape conversion helpers
const val2float = (val: Value<number>): number => {
  if (val.tag === "FloatV") {
    return val.contents;
  } else {
    throw new Error(`${val} is not a float value.`);
  }
};
const val2Expr = <T>(val: Value<T>): TagExpr<T> => ({
  tag: "Done",
  contents: val,
});
//#endregion

//#region Resampling
// TODO: The current resampling logic is a bit costly. Alternative: map over all varying paths and call sampleField/Property?

/**
 * Resample all shapes properties using their samplers.
 *
 * @param shapes Old shapes
 * @ignore
 */
export const sampleShapes = (shapes: Shape[]): Shape[] =>
  shapes.map((shape: Shape) => sampleShape(shape, findDef(shape.shapeType)));

/**
 * Resample all properties of one shape.
 *
 * @param shape existing shape
 * @param shapeDef shape definition
 * @ignore
 */
const sampleShape = (shape: Shape, shapeDef: ShapeDef): Shape => ({
  ...shape,
  properties: mapValues(shape.properties, (_: Value<number>, prop: string) =>
    sampleProperty(prop, shapeDef)
  ),
});

/**
 * Sample a property based on a shape definition.
 *
 * @param property property name
 * @param shapeDef shape definition
 */
const sampleProperty = (
  property: string,
  shapeDef: ShapeDef
): Value<number> => {
  const propModels: IPropModel = shapeDef.properties;
  const sampler = propModels[property];
  if (sampler) return sampler[1]();
  else {
    throw new Error(
      `${property} is not a valid property to be sampled for shape ${shapeDef.shapeType}.`
    );
  }
};

/**
 * Sample varying fields, which are assumed to be positional values. They are sampled with the canvas dimensions.
 *
 * @param state State that contains a list of varying paths
 * @ignore
 */
export const sampleFields = ({ varyingPaths }: State): number[] => {
  const fieldPaths = varyingPaths.filter(
    ({ tag }: Path) => tag === "AccessPath" || tag === "FieldPath"
  );
  return randFloats(fieldPaths.length, canvasXRange);
};

const samplePath = (
  path: Path,
  shapes: Shape[],
  varyingInitInfo: { [pathStr: string]: number }
): Value<number> => {
  if (path.tag === "LocalVar" || path.tag === "InternalLocalVar") {
    throw Error("local path shouldn't appear in GPI");
  }

  const pathStr = prettyPrintPath(path);
  if (pathStr in varyingInitInfo) {
    return {
      tag: "FloatV",
      contents: varyingInitInfo[pathStr],
    };
  }

  // HACK: for access and field paths, sample within the canvas width
  if (path.tag === "AccessPath" || path.tag === "FieldPath") {
    return constValue("FloatV", randFloat(...canvasXRange));
  }
  // for property path, use the sampler in shapedef
  else {
    const [subName, field, prop]: [string, string, string] = [
      path.name.contents.value,
      path.field.value,
      path.property.value,
    ];
    const { shapeType } = safe(
      shapes.find(
        (s: any) => s.properties.name.contents === `${subName}.${field}`
      ),
      `Cannot find shape ${subName}.${field}`
    );
    const shapeDef = findDef(shapeType);
    const sampledProp: Value<number> = sampleProperty(prop, shapeDef);
    return sampledProp;
  }
};

export const resampleBest = (state: State, numSamples: number): State => {
  // resample all the uninitialized and varying values
  const { varyingPaths, shapes, uninitializedPaths, params } = state;
  const varyingValues: Value<number>[] = varyingPaths.map((p: Path) =>
    samplePath(p, shapes, state.varyingInitInfo)
  );
  const uninitValues: Value<VarAD>[] = uninitializedPaths.map((p: Path) =>
    valueNumberToAutodiff(samplePath(p, shapes, state.varyingInitInfo))
  );

  // update the translation with all uninitialized values (converted to `Done` values)
  const uninitExprs: TagExpr<VarAD>[] = uninitValues.map((v) => val2Expr(v));
  const uninitMap = zip(uninitializedPaths, uninitExprs) as [
    Path,
    TagExpr<number>
  ][];

  const translation: Translation = uninitMap.reduce(
    (tr: Translation, [p, e]: [Path, TagExpr<number>]) =>
      insertExpr(p, tagExprNumberToAutodiff(e), tr),
    state.translation
  );

  const sampledState: State = {
    ...state,
    varyingValues: varyingValues.map((v) => val2float(v)),
    translation,
    params: {
      ...params,
      weight: initConstraintWeight,
      optStatus: "NewIter" as const,
    },
    // pendingPaths: findPending(translation),
  };
  return evalShapes(sampledState);
};
