import { IFloatV, IStrV, IColorV, IVectorV } from "types/value";
import { arrowheads, round2, toHex, toScreen } from "utils/Util";
import { attrFill, attrTitle, DASH_ARRAY } from "./AttrHelper";
import { ShapeProps } from "./Renderer";

export const arrowHead = (
  id: string,
  color: string,
  opacity: number,
  style: string,
  size: number
) => {
  const arrow = arrowheads[style];
  const marker = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "marker"
  );
  marker.setAttribute("id", id);
  marker.setAttribute("markerUnits", "strokeWidth");
  marker.setAttribute("markerWidth", round2(arrow.width * size).toString());
  marker.setAttribute("markerHeight", round2(arrow.height * size).toString());
  marker.setAttribute("viewBox", arrow.viewbox);
  marker.setAttribute("refX", arrow.refX.toString());
  marker.setAttribute("refY", arrow.refY.toString());
  marker.setAttribute("orient", "auto-start-reverse");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", arrow.path);
  path.setAttribute("fill", color);
  path.setAttribute("fill-opacity", opacity.toString());
  marker.appendChild(path);
  return marker;
};

const Arrow = ({ shape, canvasSize }: ShapeProps) => {
  const elem = document.createElementNS("http://www.w3.org/2000/svg", "g");
  elem.setAttribute("pointer-events", "bounding-box");
  const id = `arrowhead_${shape.properties.name.contents}`;
  const color = toHex(shape.properties.color.contents);
  const arrowheadSize = (shape.properties.arrowheadSize as IFloatV<number>)
    .contents;
  const arrowheadStyle = (shape.properties.arrowheadStyle as IStrV).contents;
  const alpha = (shape.properties.color as IColorV<number>).contents
    .contents[3];
  elem.appendChild(arrowHead(id, color, alpha, arrowheadStyle, arrowheadSize));
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const [sx, sy] = toScreen(
    ((shape.properties.start as IVectorV<number>) as any).contents,
    canvasSize
  );
  const [ex, ey] = toScreen(
    ((shape.properties.end as IVectorV<number>) as any).contents,
    canvasSize
  );

  const strokeWidth = (shape.properties.thickness as IFloatV<number>).contents;
  // HACK: scale path down a bit to accommodate arrow length
  const { width, refX } = arrowheads[arrowheadStyle];
  const slope = Math.atan2(ey - sy, ex - sx);
  const [offsetX, offsetY] = [
    Math.cos(slope) * (width - refX) * strokeWidth * arrowheadSize,
    Math.sin(slope) * (width - refX) * strokeWidth * arrowheadSize,
  ];
  path.setAttribute(
    "d",
    `M${sx} ${sy} L${
      Math.abs(offsetX) < Math.abs(ex - sx) ? ex - offsetX : ex
    } ${Math.abs(offsetY) < Math.abs(ey - sy) ? ey - offsetY : ey}`
  );
  path.setAttribute("marker-end", `url(#${id})`);
  attrFill(shape, path);
  path.setAttribute("stroke", color);
  // factor out an AttrHelper
  if (
    "strokeDashArray" in shape.properties &&
    shape.properties.strokeDashArray.contents !== ""
  ) {
    elem.setAttribute(
      "stroke-dasharray",
      (shape.properties.strokeDashArray as IStrV).contents
    );
  } else if (shape.properties.style.contents === "dashed") {
    elem.setAttribute("stroke-dasharray", DASH_ARRAY.toString());
  }
  path.setAttribute(
    "stroke-width",
    shape.properties.thickness.contents.toString()
  );
  elem.appendChild(path);
  attrTitle(shape, elem);
  return elem;
};
export default Arrow;
