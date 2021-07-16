import { toScreen, ops, bboxSegs, pointInBox, toPt, intersects, intersection } from "utils/Util";
import { attrFill, attrStroke, attrTitle } from "./AttrHelper";
import { ShapeProps } from "./Renderer";
import { sortBy } from "lodash";

// This construction is visualized in `examples/spec-shape-callout`: `roger watch shape.sub shape.sty shape.dsl`.
// Where the thick gray line intersects the text rectangle with padding is where the stem points are drawn (plus the anchor in between)
const makeCallout = (
    anchor: [number, number],
    center: [number, number],
    contentsW: number,
    contentsH: number,
    padding: number
): [number, number][] => {
    const calloutPadding = padding ? padding : 30; // Padding around the text for rect
    const calloutThickness = 30; // Thickness of base of stem. TODO: Parametrize this
    const calloutEndPadding = 40; // Space between the external anchor point and the stem
    const maxCalloutDist = 200;

    // Rectangle segments
    const { ptsR, cornersR, segsR, linesR } = bboxSegs(
        center,
        contentsW + calloutPadding,
        contentsH + calloutPadding
    );

    if (pointInBox(toPt(anchor), linesR)) {
        console.log("Anchor in box");
        return ptsR;
    }

    // callout center -> anchor, parallel to callout direction
    const vec = ops.vnormalize(ops.vsub(center, anchor));
    const stemStart = ops.vmove(anchor, calloutEndPadding, vec); // Pointy part

    // stemSeg_i = one side of the speech bubble "tail"
    // Extrusions from normal on either side of the stem
    const t = ops.vnorm(ops.vsub(center, stemStart));
    const stemSide1Start = ops.vmove(
        stemStart,
        calloutThickness / 2,
        ops.rot90(vec)
    );
    const stemSide1End = ops.vmove(stemSide1Start, t, vec);
    const stemSeg1 = [stemSide1Start, stemSide1End];

    const stemSide2Start = ops.vmove(
        stemStart,
        calloutThickness / 2,
        ops.rot90(ops.rot90(ops.rot90(vec)))
    );
    const stemSide2End = ops.vmove(stemSide2Start, t, vec);
    const stemSeg2 = [stemSide2Start, stemSide2End];

    // intersectPts = the places where the extruded line intersects with the rectangle segments, where the stem should be drawn in the polygon
    let intersectPt1 = undefined;
    let side1 = undefined;

    if (intersects(segsR.top, stemSeg1)) {
        intersectPt1 = intersection(segsR.top, stemSeg1);
        side1 = "top";
    } else if (intersects(segsR.bot, stemSeg1)) {
        intersectPt1 = intersection(segsR.bot, stemSeg1);
        side1 = "bot";
    } else if (intersects(segsR.left, stemSeg1)) {
        intersectPt1 = intersection(segsR.left, stemSeg1);
        side1 = "left";
    } else if (intersects(segsR.right, stemSeg1)) {
        intersectPt1 = intersection(segsR.right, stemSeg1);
        side1 = "right";
    } else {
        console.log("no intersection 1", segsR, stemSeg1);
        // throw Error("no intersection for point 1");
    }

    let intersectPt2 = undefined;
    let side2 = undefined;

    if (intersects(segsR.top, stemSeg2)) {
        intersectPt2 = intersection(segsR.top, stemSeg2);
        side2 = "top";
    } else if (intersects(segsR.bot, stemSeg2)) {
        intersectPt2 = intersection(segsR.bot, stemSeg2);
        side2 = "bot";
    } else if (intersects(segsR.left, stemSeg2)) {
        intersectPt2 = intersection(segsR.left, stemSeg2);
        side2 = "left";
    } else if (intersects(segsR.right, stemSeg2)) {
        intersectPt2 = intersection(segsR.right, stemSeg2);
        side2 = "right";
    } else {
        console.log("no intersection 2", segsR, stemSeg2);
        // throw Error("no intersection for point 2");
    }

    const stemPts = [
        intersectPt1 ? intersectPt1 : stemSide1End,
        anchor,
        intersectPt2 ? intersectPt2 : stemSide2End,
    ];

    // TODO: The corner should be skipped if the points "include" it?

    // [ ] <- rect center to middle of right segment is zero angle
    const zeroAngleVec = ops.vdiv(
        ops.vadd(cornersR.bottomRight, cornersR.topRight),
        2
    );

    const ptsSorted = sortBy(ptsR.concat(stemPts), (pt) =>
        ops.angleBetween2(
            ops.vsub(zeroAngleVec, center),
            ops.vnormalize(ops.vsub(pt, center))
        )
    );

    const pts = ptsSorted;
    return pts as [number, number][];
};

const Callout = ({ shape, canvasSize }: ShapeProps) => {
    const elem = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "polygon"
    );
    attrFill(shape, elem);
    attrStroke(shape, elem);
    attrTitle(shape, elem);

    const [anchor, center, w, h, padding] = [
        shape.properties.anchor.contents as [number, number],
        shape.properties.center.contents as [number, number],
        shape.properties.w.contents as number,
        shape.properties.h.contents as number,
        shape.properties.padding.contents as number,
    ];

    const pts = makeCallout(anchor, center, w, h, padding);
    const ptsScreen = pts.map((p) => toScreen(p, canvasSize));
    elem.setAttribute("points", ptsScreen.toString());

    // TODO: Use an SVG path instead, so we can have rounded corners
    return elem;
};
export default Callout;
