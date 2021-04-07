import { attrFill, attrPoints, attrStroke, attrTitle } from "./AttrHelper";
import { ShapeProps } from "./Renderer";

const Polygon = ({ shape }: ShapeProps) => {

  const elem = document.createElementNS("http://www.w3.org/2000/svg", "polygon");

  attrFill(shape, elem);
  attrStroke(shape, elem);
  attrTitle(shape, elem);
  attrPoints(shape, elem);

  return elem;

};
export default Polygon;
