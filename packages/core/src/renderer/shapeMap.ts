import Circle from "./Circle";
import Label from "./Label";
import Ellipse from "./Ellipse";
import Square from "./Square";
import Rectangle from "./Rectangle";
import Polygon from "./Polygon";
import Arrow from "./Arrow";
import { ShapeProps } from "./Renderer";
import Path from "./Path";
import Line from "./Line";
import Image from "./Image";

const shapeMap: { [key: string]: (props: ShapeProps) => SVGElement } = {
  Circle,
  Ellipse,
  Square,
  Rectangle,
  Polygon,
  Text: Label,
  Arrow,
  Path,
  Line,
  Image,
};

export default shapeMap;
