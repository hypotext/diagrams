import shapeMap from "./shapeMap";
import { canvasSize } from "renderer/ShapeDef";
import { Shape } from "types/shape";
import { dragUpdate } from "./dragUtils";
import { IStrV } from "types/value";
import { LabelCache, State } from "types/state";

export interface ShapeProps {
  shape: Shape;
  labels: LabelCache;
  canvasSize: [number, number];
  //   TODO: `document` object
}

/**
 * Turns Shape GPI data into a corresponding SVG element
 * @param shape
 * @param labels
 */
export const RenderShape = (
  shape: Shape,
  labels: LabelCache,
  canvasSizeCustom?: [number, number]
): SVGElement => {
  if (!(shape.shapeType in shapeMap)) {
    console.error(`${shape.shapeType} shape doesn't exist in shapeMap`);
    return document.createElementNS("http://www.w3.org/2000/svg", "g");
  }

  return shapeMap[shape.shapeType]({
    shape,
    labels,
    canvasSize: canvasSizeCustom ?? canvasSize,
  });
};

/**
 * Converts screen to relative SVG coords
 * Thanks to
 * https://www.petercollingridge.co.uk/tutorials/svg/interactive/dragging/
 * @param e
 * @param svg
 */
const getPosition = (e: MouseEvent, svg: SVGSVGElement) => {
  const CTM = svg.getScreenCTM();
  if (CTM !== null) {
    return { x: (e.clientX - CTM.e) / CTM.a, y: (e.clientY - CTM.f) / CTM.d };
  }
  return { x: 0, y: 0 };
};

/**
 * Makes a shape draggable. Browser only.
 * @param shape
 * @param labels
 * @param onDrag callback when drag complete
 * @param parentSVG
 * @param canvasSizeCustom
 */
export const DraggableShape = (
  shape: Shape,
  labels: LabelCache,
  onDrag: (id: string, dx: number, dy: number) => void,
  parentSVG: SVGSVGElement,
  canvasSizeCustom?: [number, number]
): SVGGElement => {
  const elem = RenderShape(shape, labels, canvasSizeCustom);
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("pointer-events", "bounding-box");
  g.appendChild(elem);

  const onMouseDown = (e: MouseEvent) => {
    const tempX = getPosition(e, parentSVG).x;
    const tempY = getPosition(e, parentSVG).y;
    g.setAttribute("opacity", "0.5");
    let dx = 0,
      dy = 0;
    const onMouseMove = (e: MouseEvent) => {
      const { x, y } = getPosition(e, parentSVG);
      dx = x - tempX;
      dy = tempY - y;
      g.setAttribute(`transform`, `translate(${dx},${-dy})`);
    };
    const onMouseUp = () => {
      g.setAttribute("opacity", "1");
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMouseMove);
      onDrag((shape.properties.name as IStrV).contents, dx, dy);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousemove", onMouseMove);
  };
  g.addEventListener("mousedown", onMouseDown);
  return g;
};

export const RenderInteractive = (
  state: State,
  updateState: (newState: State) => void
): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("version", "1.2");
  svg.setAttribute("viewBox", `0 0 ${canvasSize[0]} ${canvasSize[1]}`);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const onDrag = (id: string, dx: number, dy: number) => {
    updateState(dragUpdate(state, id, dx, dy));
  };
  state.shapes.forEach((shape) =>
    svg.appendChild(DraggableShape(shape, state.labelCache, onDrag, svg))
  );
  return svg;
};

/**
 * Renders a static SVG of the shapes and labels.
 * @param shapes
 * @param labels
 */
const RenderStatic = ({ shapes, labelCache }: State): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("version", "1.2");
  svg.setAttribute("viewBox", `0 0 ${canvasSize[0]} ${canvasSize[1]}`);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  shapes.forEach((shape) => svg.appendChild(RenderShape(shape, labelCache)));
  return svg;
};

export default RenderStatic;
