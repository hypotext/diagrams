import makeViewBoxes from "inspector/makeViewBoxes";
import * as React from "react";
import IViewProps from "./IViewProps";
import AttrPicker from "./mod/AttrPicker";
import defmap from "./mod/defmap";
import { ShapeTypes, PenroseState } from "@penrose/core";

interface IState {
  selectedShape: number;
}

class Mod extends React.Component<IViewProps, IState> {
  public readonly state = { selectedShape: 0 };
  public setSelectedShape = (key: number) => {
    this.setState({ selectedShape: key });
  };
  public modAttr = (attrname: string, attrval: ShapeTypes.Value<any>) => {
    const { frame, modShapes, frameIndex, history } = this.props;
    const { selectedShape } = this.state;
    if (frameIndex === -1 || frameIndex === history.length - 1) {
      // make it only work on last frame
      const shapeIndex = selectedShape === -1 ? 0 : selectedShape;
      const newShapes = frame!.shapes.map((elem, ind) => {
        // https://stackoverflow.com/questions/44524121/update-array-containing-objects-using-spread-operator
        const returnVal = { ...elem };
        if (ind === shapeIndex) returnVal.properties[attrname] = attrval;
        return returnVal;
      });
      const shape = newShapes[shapeIndex];
      shape.properties[attrname] = attrval;
      const newFrame = {
        ...frame!,
        shapes: newShapes,
      } as PenroseState;
      modShapes(newFrame);
    } else throw new Error("Shape does not have property " + attrname + " .");
  };
  public render() {
    const { frame } = this.props;
    if (frame === null) {
      return <div />;
    }

    const { selectedShape } = this.state;
    const def = defmap[frame.shapes[selectedShape].shapeType];
    if (!def) {
      return (
        <div style={{ padding: "1em" }}>
          {frame.shapes[selectedShape].shapeType} is not in defmap
        </div>
      );
    }
    return (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {makeViewBoxes(frame.shapes, selectedShape, this.setSelectedShape)}
        <div
          style={{
            // BUG: scroll doesnt really work
            padding: "1em 1em 1em 1em",
            overflow: "auto",
            height: "100%",
            flexBasis: 0,
            flexGrow: 1,
            boxSizing: "border-box",
          }}
        >
          {frame.shapes[selectedShape] && (
            <AttrPicker
              shape={frame.shapes[selectedShape]}
              sAttrs={def}
              modAttr={this.modAttr}
            />
          )}
        </div>
      </div>
    );
  }
}

export default Mod;
