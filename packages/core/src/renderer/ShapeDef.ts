import { randFloat } from "utils/Util";
import { Shape } from "types/shape";
import { Value } from "types/value";
import { IFloatV, IVectorV, IColorV, IPolygonV } from "types/value";
import { Path } from "types/style";

//#region shapedef helpers and samplers

/** @ignore */
type PropContents = Value<number>["contents"];
/** @ignore */
type ConstSampler = (type: PropType, value: PropContents) => Value<number>;

type Range = [number, number];

// NOTE: I moved `canvasSize` here from Canvas.tsx, which re-exports it, to avoid a circular import in `Style`.

export const canvasSize: [number, number] = [800, 700];
export const canvasXRange: Range = [-canvasSize[0] / 2, canvasSize[0] / 2];
export const canvasYRange: Range = [-canvasSize[1] / 2, canvasSize[1] / 2];

/** Generate a single string based on a path to a shape */
export const getShapeName = (p: Path): string => {
  if (p.tag === "FieldPath" || p.tag === "PropertyPath") {
    const { name, field } = p;
    return `${name.contents.value}.${field.value}`;
  } else {
    throw new Error("Can only derive shape name from field or property path.");
  }
};

/**
 * Sort shapes given a list of ordered shape names.
 *
 * @param shapes unsorted shapes
 * @param ordering global ordering of shapes
 */
export const sortShapes = (shapes: Shape[], ordering: string[]): Shape[] => {
  return ordering.map(
    (name) =>
      // COMBAK: Deal with nonexistent shapes
      shapes.find(
        ({ properties }) => properties.name.contents === name
      ) as Shape
  ); // assumes that all names are unique
};

/**
 * Checks if a `Text` shape has non-empty content
 *
 * @param shape a `Text` shape
 */
export const notEmptyLabel = (shape: Shape): boolean => {
  const { shapeType, properties } = shape;
  return shapeType === "Text" ? !(properties.string.contents === "") : true;
};

const sampleFloatIn = (min: number, max: number): IFloatV<number> => ({
  tag: "FloatV",
  contents: randFloat(min, max),
});

const vectorSampler: Sampler = (): IVectorV<number> => ({
  tag: "VectorV",
  contents: [randFloat(...canvasXRange), randFloat(...canvasYRange)],
});
const widthSampler: Sampler = (): IFloatV<number> => ({
  tag: "FloatV",
  contents: randFloat(3, canvasSize[0] / 6),
});
const zeroFloat: Sampler = (): IFloatV<number> => ({
  tag: "FloatV",
  contents: 0.0,
});
const pathLengthSampler: Sampler = (): IFloatV<number> => ({
  tag: "FloatV",
  contents: 1.0,
});
const heightSampler: Sampler = (): IFloatV<number> => ({
  tag: "FloatV",
  contents: randFloat(3, canvasSize[1] / 6),
});
const strokeSampler: Sampler = (): IFloatV<number> => ({
  tag: "FloatV",
  contents: randFloat(0.5, 3),
});
const colorSampler: Sampler = (): IColorV<number> => {
  const [min, max] = [0.1, 0.9];
  return {
    tag: "ColorV",
    contents: {
      tag: "RGBA",
      contents: [
        randFloat(min, max),
        randFloat(min, max),
        randFloat(min, max),
        0.5,
      ],
    },
  };
};

export const constValue: ConstSampler = (
  tag: PropType,
  contents: PropContents
) =>
  ({
    tag,
    contents,
  } as Value<number>);

const black: IColorV<number> = {
  tag: "ColorV",
  contents: {
    tag: "RGBA",
    contents: [0, 0, 0, 1.0],
  },
};

const emptyPoly: IPolygonV<number> = {
  tag: "PolygonV",
  contents: [
    [],
    [],
    [
      [-Infinity, Infinity],
      [-Infinity, Infinity],
    ],
    [],
  ],
};

//#endregion

//#region shapedefs
export type ShapeDef = IShapeDef;

// type HasTag<T, N> = T extends { tag: N } ? T : never;

export type PropType = Value<number>["tag"];
export type IPropModel = { [k: string]: [PropType, Sampler] };

export interface IShapeDef {
  shapeType: string;
  properties: IPropModel;
  positionalProps?: string[];
}

export type Sampler = () => Value<number>;

export const circleDef: ShapeDef = {
  shapeType: "Circle",
  properties: {
    center: ["VectorV", vectorSampler],
    r: ["FloatV", widthSampler],
    pathLength: ["FloatV", pathLengthSampler], // part of svg spec
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultCircle")],
  },
  positionalProps: ["center"],
};

export const ellipseDef: ShapeDef = {
  shapeType: "Ellipse",
  properties: {
    center: ["VectorV", vectorSampler],
    rx: ["FloatV", widthSampler],
    ry: ["FloatV", heightSampler],
    pathLength: ["FloatV", pathLengthSampler], // part of svg spec
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultCircle")],
  },
  positionalProps: ["center"],
};

export const rectDef: ShapeDef = {
  shapeType: "Rectangle",
  properties: {
    center: ["VectorV", vectorSampler],
    w: ["FloatV", widthSampler],
    h: ["FloatV", heightSampler],
    rx: ["FloatV", zeroFloat],
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultRect")],
  },
  positionalProps: ["center"],
};

export const calloutDef: ShapeDef = {
  shapeType: "Callout",
  properties: {
    anchor: ["VectorV", vectorSampler],
    center: ["VectorV", vectorSampler],
    w: ["FloatV", widthSampler],
    h: ["FloatV", heightSampler],
    padding: ["FloatV", zeroFloat], // padding around the contents of the callout box
    rx: ["FloatV", zeroFloat], // currently unused
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultCallout")],
  },
};

export const polygonDef: ShapeDef = {
  shapeType: "Polygon",
  properties: {
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    color: ["ColorV", colorSampler],
    center: ["VectorV", vectorSampler],
    scale: ["FloatV", () => constValue("FloatV", 1)],
    name: ["StrV", () => constValue("StrV", "defaultPolygon")],
    points: [
      "PtListV",
      () =>
        constValue("PtListV", [
          [0, 0],
          [0, 10],
          [10, 0],
        ]),
    ],
  },
  positionalProps: ["center"],
};

export const freeformPolygonDef: ShapeDef = {
  shapeType: "FreeformPolygon",
  properties: {
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultFreeformPolygon")],
    points: [
      "PtListV",
      () =>
        constValue("PtListV", [
          [0, 0],
          [0, 10],
          [10, 0],
        ]),
    ],
  },
  positionalProps: [],
};

const DEFAULT_PATHSTR = `M 10,30
A 20,20 0,0,1 50,30
A 20,20 0,0,1 90,30
Q 90,60 50,90
Q 10,60 10,30 z`;

export const pathStringDef: ShapeDef = {
  shapeType: "PathString",
  properties: {
    center: ["VectorV", vectorSampler],
    w: ["FloatV", widthSampler],
    h: ["FloatV", heightSampler],
    rotation: ["FloatV", () => constValue("FloatV", 0)],
    opacity: ["FloatV", () => constValue("FloatV", 1.0)],
    strokeWidth: ["FloatV", strokeSampler],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultPolygon")],
    data: ["StrV", () => constValue("StrV", DEFAULT_PATHSTR)],
    viewBox: ["StrV", () => constValue("StrV", "0 0 100 100")],
  },
  positionalProps: ["center"],
};

export const polylineDef: ShapeDef = {
  shapeType: "Polyline",
  properties: {
    strokeWidth: ["FloatV", strokeSampler],
    center: ["VectorV", vectorSampler],
    scale: ["FloatV", () => constValue("FloatV", 1)],
    style: ["StrV", () => constValue("StrV", "filled")],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultPolygon")],
    points: [
      "PtListV",
      () =>
        constValue("PtListV", [
          [0, 0],
          [0, 10],
          [10, 0],
        ]),
    ],
  },
  positionalProps: ["center"],
};

export const imageDef: ShapeDef = {
  shapeType: "Image",
  properties: {
    center: ["VectorV", vectorSampler],
    w: ["FloatV", widthSampler],
    h: ["FloatV", heightSampler],
    rotation: ["FloatV", () => constValue("FloatV", 0)],
    opacity: ["FloatV", () => constValue("FloatV", 1.0)],
    style: ["StrV", () => constValue("StrV", "filled")],
    stroke: ["StrV", () => constValue("StrV", "none")],
    path: ["StrV", () => constValue("StrV", "missing image path")],
    name: ["StrV", () => constValue("StrV", "defaultImage")],
  },
  positionalProps: ["center"],
};

export const squareDef: ShapeDef = {
  shapeType: "Square",
  properties: {
    center: ["VectorV", vectorSampler],
    side: ["FloatV", widthSampler],
    rotation: ["FloatV", () => constValue("FloatV", 0)],
    style: ["StrV", () => constValue("StrV", "none")],
    rx: ["FloatV", zeroFloat],
    strokeWidth: ["FloatV", strokeSampler],
    strokeStyle: ["StrV", () => constValue("StrV", "solid")],
    strokeColor: ["ColorV", colorSampler],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultSquare")],
  },
  positionalProps: ["center"],
};

export const textDef: ShapeDef = {
  shapeType: "Text",
  properties: {
    center: ["VectorV", vectorSampler],
    w: ["FloatV", () => constValue("FloatV", 0)],
    h: ["FloatV", () => constValue("FloatV", 0)],
    fontSize: ["StrV", () => constValue("StrV", "12pt")],
    rotation: ["FloatV", () => constValue("FloatV", 0)],
    style: ["StrV", () => constValue("StrV", "none")],
    stroke: ["StrV", () => constValue("StrV", "none")],
    color: ["ColorV", () => black],
    name: ["StrV", () => constValue("StrV", "defaultText")],
    string: ["StrV", () => constValue("StrV", "defaultLabelText")],
    // HACK: typechecking is not passing due to Value mismatch. Not sure why
    polygon: ["PolygonV", () => emptyPoly],
  },
  positionalProps: ["center"],
};

export const lineDef: ShapeDef = {
  shapeType: "Line",
  properties: {
    start: ["VectorV", vectorSampler],
    end: ["VectorV", vectorSampler],
    thickness: ["FloatV", () => sampleFloatIn(5, 15)],
    leftArrowhead: ["BoolV", () => constValue("BoolV", false)],
    rightArrowhead: ["BoolV", () => constValue("BoolV", false)],
    arrowheadStyle: ["StrV", () => constValue("StrV", "arrowhead-2")],
    arrowheadSize: ["FloatV", () => constValue("FloatV", 1.0)],
    color: ["ColorV", colorSampler],
    style: ["StrV", () => constValue("StrV", "solid")],
    stroke: ["StrV", () => constValue("StrV", "none")],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    name: ["StrV", () => constValue("StrV", "defaultLine")],
  },
  positionalProps: ["start", "end"],
};

export const arrowDef: ShapeDef = {
  shapeType: "Arrow",
  properties: {
    start: ["VectorV", vectorSampler],
    end: ["VectorV", vectorSampler],
    thickness: ["FloatV", () => sampleFloatIn(5, 15)],
    arrowheadStyle: ["StrV", () => constValue("StrV", "arrowhead-2")],
    arrowheadSize: ["FloatV", () => constValue("FloatV", 1.0)],
    style: ["StrV", () => constValue("StrV", "solid")],
    color: ["ColorV", colorSampler],
    name: ["StrV", () => constValue("StrV", "defaultArrow")],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
  },
  positionalProps: ["start", "end"],
};

export const curveDef: ShapeDef = {
  shapeType: "Path",
  properties: {
    path: ["PtListV", () => constValue("PtListV", [])],
    polyline: ["PtListV", () => constValue("PtListV", [])],
    polygon: ["PolygonV", () => emptyPoly],
    pathData: ["PathDataV", () => constValue("PathDataV", [])],
    strokeWidth: ["FloatV", strokeSampler],
    style: ["StrV", () => constValue("StrV", "solid")],
    strokeDashArray: ["StrV", () => constValue("StrV", "")],
    effect: ["StrV", () => constValue("StrV", "none")],
    color: ["ColorV", colorSampler],
    fill: ["ColorV", colorSampler],
    leftArrowhead: ["BoolV", () => constValue("BoolV", false)],
    rightArrowhead: ["BoolV", () => constValue("BoolV", false)],
    arrowheadStyle: ["StrV", () => constValue("StrV", "arrowhead-2")],
    arrowheadSize: ["FloatV", () => constValue("FloatV", 1.0)],
    name: ["StrV", () => constValue("StrV", "defaultCurve")],
  },
};

/**
 * A registry of all types of shape definitions in the Penrose system.
 */
export const shapedefs: ShapeDef[] = [
  circleDef,
  ellipseDef,
  textDef,
  rectDef,
  calloutDef,
  polygonDef,
  freeformPolygonDef,
  polylineDef,
  pathStringDef,
  squareDef,
  curveDef,
  imageDef,
  lineDef,
  arrowDef,
];

export const positionalProps = (type: string): string[] | undefined => {
  const res = shapedefs.find(({ shapeType }: ShapeDef) => shapeType === type);
  if (!res) return undefined;
  return res.positionalProps;
};

export const findDef = (type: string): ShapeDef => {
  const res = shapedefs.find(({ shapeType }: ShapeDef) => shapeType === type);
  if (res) return res;
  else throw new Error(`${type} is not a valid shape definition.`);
};

//#endregion
