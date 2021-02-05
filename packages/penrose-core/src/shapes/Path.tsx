import * as React from "react";
import { toScreen, toHex } from "utils/Util";
import { flatten } from "lodash";
import { IGPIProps } from "types";

const toCmdString = (cmd: any, canvasSize: [number, number]) => {
  switch (cmd.tag) {
    case "Pt":
      return "L" + toScreen(cmd.contents, canvasSize).join(" ");
    case "CubicBez":
      return pathCommandString("C", cmd.contents, canvasSize);
    case "CubicBezJoin":
      return pathCommandString("S", cmd.contents, canvasSize);
    case "QuadBez":
      return pathCommandString("Q", cmd.contents, canvasSize);
    case "QuadBezJoin":
      return pathCommandString("T", cmd.contents, canvasSize);
    default:
      return " ";
  }
};

const pathCommandString = (
  command: string,
  pts: [number, number][],
  canvasSize: [number, number]
) =>
  command +
  flatten(
    pts.map((coords: [number, number]) => {
      return toScreen(coords, canvasSize);
    })
  ).join(" ");

const fstCmdString = (pathCmd: any, canvasSize: [number, number]) => {
  if (pathCmd.tag === "Pt") {
    return "M" + toScreen(pathCmd.contents, canvasSize).join(" ");
  } else {
    return toCmdString(pathCmd, canvasSize);
  }
};

const toSubPathString = (commands: any[], canvasSize: [number, number]) => {
  // TODO: deal with an empty list more gracefully. This next line will crash with undefined head command if empty.
  if (!commands || !commands.length) {
    console.error("WARNING: empty path");
    return "";
  }

  const [headCommand, ...tailCommands] = commands;
  return (
    fstCmdString(headCommand, canvasSize) +
    tailCommands.map((cmd: any) => toCmdString(cmd, canvasSize)).join(" ")
  );
};

const toPathString = (pathData: any[], canvasSize: [number, number]) =>
  pathData
    .map((subPath: any) => {
      const { tag, contents } = subPath;
      const subPathStr = toSubPathString(contents, canvasSize);
      return subPathStr + (tag === "Closed" ? "Z" : "");
    })
    .join(" ");

class Path extends React.Component<IGPIProps> {
  public render() {
    const { shape } = this.props;
    const { canvasSize } = this.props;
    const strokeWidth = shape.strokeWidth.contents;
    const strokeColor = toHex(shape.color.contents);
    const fillColor = toHex(shape.fill.contents);
    const strokeOpacity = shape.color.contents.contents[3];
    const fillOpacity = shape.fill.contents.contents[3];
    const arrowheadStyle = shape.arrowheadStyle.contents;
    const arrowheadSize = shape.arrowheadSize.contents;

    const leftArrowId = shape.name.contents + "-leftArrowhead";
    const rightArrowId = shape.name.contents + "-rightArrowhead";
    const shadowId = shape.name.contents + "-shadow";
    // TODO: distinguish between fill opacity and stroke opacity
    return (
      <g>
        {/* {shape.leftArrowhead.contents === true ? (
          <Arrowhead
            id={leftArrowId}
            color={strokeColor}
            opacity={strokeOpacity}
            style={arrowheadStyle}
            size={arrowheadSize}
          />
        ) : null}
        {shape.rightArrowhead.contents === true ? (
          <Arrowhead
            id={rightArrowId}
            color={strokeColor}
            opacity={strokeOpacity}
            style={arrowheadStyle}
            size={arrowheadSize}
          />
        ) : null}
        <Shadow id={shadowId} /> */}
        <path
          stroke={strokeColor}
          fill={fillColor}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity}
          fillOpacity={fillOpacity}
          d={toPathString(shape.pathData.contents, canvasSize)}
          markerStart={
            shape.leftArrowhead.contents === true ? `url(#${leftArrowId})` : ""
          }
          markerEnd={
            shape.rightArrowhead.contents === true
              ? `url(#${rightArrowId})`
              : ""
          }
          filter={
            shape.effect.contents === "dropShadow" ? `url(#${shadowId})` : ""
          }
        >
          <title>{shape.name.contents}</title>
        </path>
      </g>
    );
  }
}
export default Path;
