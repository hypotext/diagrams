import * as React from "react";
import * as ReactDOM from "react-dom";

import { interactiveMap, staticMap } from "shapes/componentMap";
import Log from "utils/Log";
import { loadImages } from "utils/Util";
import { insertPending, updateVaryingValues } from "engine/PropagateUpdate";
import { collectLabels } from "utils/CollectLabels";
import { evalShapes, decodeState } from "engine/Evaluator";
import { makeTranslationDifferentiable } from "engine/EngineUtils";

interface ICanvasProps {
  lock: boolean;
  substanceMetadata?: string;
  styleMetadata?: string;
  elementMetadata?: string;
  otherMetadata?: string;
  style?: any;
  penroseVersion?: string;
  data: State | undefined;
  updateData?: (shapes: any, step?: boolean) => void;
}

/**
 * Hard-coded canvas size
 * @type {[number, number]}
 */
export const canvasSize: [number, number] = [800, 700];

class Canvas extends React.Component<ICanvasProps> {
  public static sortShapes = (shapes: Shape[], ordering: string[]) => {
    return ordering.map((name) =>
      shapes.find(({ properties }) => properties.name.contents === name)
    ); // assumes that all names are unique
  };

  public static notEmptyLabel = ({ shapeType, properties }: any) => {
    return shapeType === "Text" ? !(properties.string.contents === "") : true;
  };

  /**
   * Decode
   * NOTE: this function is only used for resample now. Will deprecate as soon as shapedefs are in the frontend
   * @static
   * @memberof Canvas
   */
  public static processData = async (data: any) => {
    const state: State = decodeState(data);

    // Make sure that the state decoded from backend conforms to the types in types.d.ts, otherwise the typescript checking is just not valid for e.g. Tensors
    // convert all TagExprs (tagged Done or Pending) in the translation to Tensors (autodiff types)
    const translationAD = makeTranslationDifferentiable(state.translation);
    const stateAD = {
      ...state,
      originalTranslation: state.originalTranslation,
      translation: translationAD
    };

    // After the pending values load, they only use the evaluated shapes (all in terms of numbers)
    // The results of the pending values are then stored back in the translation as autodiff types
    const stateEvaled: State = evalShapes(stateAD);
    // TODO: add return types
    const labeledShapes: any = await collectLabels(stateEvaled.shapes);
    const labeledShapesWithImgs: any = await loadImages(labeledShapes);
    const sortedShapes: any = await Canvas.sortShapes(
      labeledShapesWithImgs,
      data.shapeOrdering
    );
    const nonEmpties = await sortedShapes.filter(Canvas.notEmptyLabel);
    const processed = await insertPending({
      ...stateEvaled,
      shapes: nonEmpties,
    });

    return processed;
  };

  // public readonly canvasSize: [number, number] = [400, 400];
  public readonly svg = React.createRef<SVGSVGElement>();

  /**
   * Retrieve data from drag events and update varying state accordingly
   * @memberof Canvas
   */
  public dragEvent = async (id: string, dx: number, dy: number) => {
    if (this.props.updateData && this.props.data) {
      const updated: State = {
        ...this.props.data,
        params: { ...this.props.data.params, optStatus: { tag: "NewIter" } },
        shapes: this.props.data.shapes.map(
          ({ shapeType, properties }: Shape) => {
            if (properties.name.contents === id) {
              return this.dragShape({shapeType, properties}, [dx, dy]);
            }
            return {shapeType, properties};
          }
        ),
      };
      // TODO: need to retrofit this implementation to the new State type
      const updatedWithVaryingState = await updateVaryingValues(updated);
      this.props.updateData(updatedWithVaryingState);
    }
  };

  // TODO: factor out position props in shapedef
  public dragShape = (shape: Shape, offset: [number, number]) => {
    const {shapeType, properties} = shape;
    switch (shapeType) {
      case "Curve":
        console.log("Curve drag unimplemented", shape); // Just to prevent crashing on accidental drag
        return shape;
      case "Line":
        return {
          ...shape,
          properties: this.moveProperties(properties, ["start", "end"], offset),
        };
      case "Arrow":
        return {
          ...shape,
          properties: this.moveProperties(properties, ["start", "end"], offset),
        };
      default:
        return {
          ...shape,
          properties: this.moveProperties(properties, ["center"], offset),
        };
    }
  };

  /**
   * For each of the specified properties listed in `propPairs`, subtract a number from the original value.
   *
   * @memberof Canvas
   */
  public moveProperties = (properties: Properties, propsToMove: string[], [dx, dy]: [number, number]) => {
    const moveProperty = (props: Properties, propertyID: string) => {
      const [x, y] = props[propertyID].contents as [number, number];
      // props[propertyID].contents = [dx, dy]
      return props;
    };
    return propsToMove.reduce(moveProperty, properties);
  };

  public prepareSVGContent = async () => {
    const domnode = ReactDOM.findDOMNode(this);
    if (domnode !== null && domnode instanceof Element) {
      const exportingNode = domnode.cloneNode(true) as any;
      exportingNode.setAttribute("width", canvasSize[0].toString());
      exportingNode.setAttribute("height", canvasSize[1].toString());

      const images = exportingNode.getElementsByTagName("image");
      for (let i = images.length - 1; i >= 0; i--) {
        const image = images[i];
        const uri = image.getAttribute("href");
        const response = await fetch(uri);
        const contents = await response.text();
        if (response.ok) {
          const width = image.getAttribute("width");
          const height = image.getAttribute("height");
          const x = image.getAttribute("x");
          const y = image.getAttribute("y");
          const transform = image.getAttribute("transform");

          const wrapper = document.createElement("div");
          wrapper.innerHTML = contents;

          const s = wrapper.getElementsByTagName("svg")[0];
          s.setAttributeNS(null, "width", width);
          s.setAttributeNS(null, "height", height);
          const outer = s.outerHTML;
          const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
          g.innerHTML = outer;
          g.setAttributeNS(
            null,
            "transform",
            `${transform} translate(${x},${y})`
          );
          // HACK: generate unique ids
          const defs = g.getElementsByTagName("defs");
          if (defs.length > 0) {
            defs[0].querySelectorAll("*").forEach((node: any) => {
              if (node.id !== "") {
                const users = g.querySelectorAll(
                  `[*|href="#${node.id}"]:not([href])`
                );
                users.forEach((user: any) => {
                  const unique = `${i}-ns-${node.id}`;
                  user.setAttributeNS(
                    "http://www.w3.org/1999/xlink",
                    "href",
                    "#" + unique
                  );
                  node.setAttribute("id", unique);
                });
              }
            });
          }
          image.insertAdjacentElement("beforebegin", g);
          wrapper.remove();
          image.remove();
        } else {
          Log.error(`Could not fetch ${uri}`);
        }
      }
      return exportingNode.outerHTML;
    } else {
      Log.error("Could not find SVG domnode.");
      return "";
    }
  };

  public downloadSVG = async (title = "illustration") => {
    const content = await this.prepareSVGContent();
    const blob = new Blob([content], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = `${title}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  public getRawSVG = async () => {
    const content = await this.prepareSVGContent();
    return content;
  };

  public downloadPDF = async () => {
    const content = await this.prepareSVGContent();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const pri = frame.contentWindow;
    frame.setAttribute(
      "style",
      "height: 100%; width: 100%; position: absolute"
    );
    if (content && pri) {
      console.log("Printing pdf now...");
      pri.document.open();
      pri.document.write(content);
      pri.document.close();
      pri.focus();
      pri.print();
    }
    frame.remove();
  };

  public renderGPI = ({ shapeType, properties }: Shape, key: number) => {
    const component = this.props.lock
      ? staticMap[shapeType]
      : interactiveMap[shapeType];
    if (component === undefined) {
      Log.error(`Could not render GPI ${shapeType}.`);
      return <rect fill="red" x={0} y={0} width={100} height={100} key={key} />;
    }
    if (!this.props.lock && this.svg.current === null) {
      Log.error("SVG ref is null");
      return <g key={key}>broken!</g>;
    }
    const { dragEvent } = this;
    return React.createElement(component, {
      key,
      shape: properties,
      canvasSize,
      dragEvent,
      ctm: !this.props.lock ? (this.svg.current as any).getScreenCTM() : null,
    });
  };

  public render() {
    const {
      substanceMetadata,
      styleMetadata,
      elementMetadata,
      otherMetadata,
      data,
      penroseVersion,
      style,
    } = this.props;

    if (!data) {
      return <svg ref={this.svg} />;
    }

    const { shapes } = data;

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        version="1.2"
        width="100%"
        height="100%"
        style={style || {}}
        ref={this.svg}
        viewBox={`0 0 ${canvasSize[0]} ${canvasSize[1]}`}
      >
        <desc>
          {`This diagram was created with Penrose (https://penrose.ink)${
            penroseVersion ? " version " + penroseVersion : ""
            } on ${new Date()
              .toISOString()
              .slice(
                0,
                10
              )}. If you have any suggestions on making this diagram more accessible, please contact us.\n`}
          {substanceMetadata && `${substanceMetadata}\n`}
          {styleMetadata && `${styleMetadata}\n`}
          {elementMetadata && `${elementMetadata}\n`}
          {otherMetadata && `${otherMetadata}`}
        </desc>
        {shapes && shapes.map(this.renderGPI)}
      </svg>
    );
  }
}

export default Canvas;
