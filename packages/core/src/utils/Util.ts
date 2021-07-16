import memoize from "fast-memoize";
import { zipWith, reduce, times } from "lodash";
import seedrandom from "seedrandom";
import { Properties } from "types/shape";

seedrandom("secret-seed", { global: true }); // HACK: constant seed for pseudorandomness

/**
 * Generate a random float. The maximum is exclusive and the minimum is inclusive
 * @param min minimum (inclusive)
 * @param max maximum (exclusive)
 */
export const randFloats = (
    count: number,
    [min, max]: [number, number]
): number[] => times(count, () => randFloat(min, max));

/**
 * Generate a random float. The maximum is exclusive and the minimum is inclusive
 * @param min minimum (inclusive)
 * @param max maximum (exclusive)
 */
export const randFloat = (min: number, max: number): number => {
    // TODO: better error reporting
    console.assert(
        max > min,
        "min should be smaller than max for random number generation!"
    );
    return Math.random() * (max - min) + min;
};

/**
 * Generate a random integer. The maximum is exclusive and the minimum is inclusive
 * @param min minimum (inclusive)
 * @param max maximum (exclusive)
 */
export const randInt = (min: number, max: number) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min)) + min;
};

/**
 * Find the Euclidean distance between two points
 * @param param0 point 1 [x1, y1]
 * @param param1 point 2 [x2, y2]
 */
export const dist = ([x1, y1]: [number, number], [x2, y2]: [number, number]) =>
    Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));

export const arrowheads = {
    "arrowhead-1": {
        width: 8,
        height: 8,
        viewbox: "0 0 8 8",
        refX: "4",
        refY: "4", // HACK: to avoid paths from bleeding through the arrowhead
        path: "M0,0 A30,30,0,0,0,8,4 A30,30,0,0,0,0,8 L2.5,4 z",
    },
    "arrowhead-2": {
        width: 9.95,
        height: 8.12,
        viewbox: "0 0 9.95 8.12",
        refX: "2.36", // HACK: to avoid paths from bleeding through the arrowhead
        refY: "4.06",
        path: "M9.95 4.06 0 8.12 2.36 4.06 0 0 9.95 4.06z",
    },
};

// calculates bounding box dimensions of a shape - used in inspector views
export const bBoxDims = (properties: Properties, shapeType: string) => {
    let [w, h] = [0, 0];
    if (shapeType === "Circle") {
        [w, h] = [
            (properties.r.contents as number) * 2,
            (properties.r.contents as number) * 2,
        ];
    } else if (shapeType === "Square") {
        [w, h] = [
            properties.side.contents as number,
            properties.side.contents as number,
        ];
    } else if (shapeType === "Ellipse") {
        [w, h] = [
            (properties.rx.contents as number) * 2,
            (properties.ry.contents as number) * 2,
        ];
    } else if (shapeType === "Arrow" || shapeType === "Line") {
        const [[sx, sy], [ex, ey]] = [
            properties.start.contents as [number, number],
            properties.end.contents as [number, number],
        ];
        const padding = 50; // Because arrow may be horizontal or vertical, and we don't want the size to be zero in that case
        [w, h] = [
            Math.max(Math.abs(ex - sx), padding),
            Math.max(Math.abs(ey - sy), padding),
        ];
    } else if (shapeType === "Path") {
        [w, h] = [20, 20]; // TODO: find a better measure for this... check with max?
    } else if (shapeType === "Polygon") {
        [w, h] = [20, 20]; // TODO: find a better measure for this... check with max?
    } else if (shapeType === "FreeformPolygon") {
        [w, h] = [20, 20]; // TODO: find a better measure for this... check with max?
    } else if (shapeType === "Polyline") {
        [w, h] = [20, 20]; // TODO: find a better measure for this... check with max?
    } else if (shapeType === "PathString") {
        [w, h] = [properties.w.contents as number, properties.h.contents as number];
    } else if (properties.w && properties.h) {
        [w, h] = [properties.w.contents as number, properties.h.contents as number];
    } else {
        [w, h] = [20, 20];
    }
    return [w, h];
};

// export const Shadow = (props: { id: string }) => {
//   return (
//     <filter id={props.id} x="0" y="0" width="200%" height="200%">
//       <feOffset result="offOut" in="SourceAlpha" dx="5" dy="5" />
//       <feGaussianBlur result="blurOut" in="offOut" stdDeviation="4" />
//       <feBlend in="SourceGraphic" in2="blurOut" mode="normal" />
//       <feComponentTransfer>
//         <feFuncA type="linear" slope="0.5" />
//       </feComponentTransfer>
//       <feMerge>
//         <feMergeNode />
//         <feMergeNode in="SourceGraphic" />
//       </feMerge>
//     </filter>
//   );
// };

export const toScreen = (
    [x, y]: [number, number],
    canvasSize: [number, number]
) => {
    const [width, height] = canvasSize;
    return [width / 2 + x, height / 2 - y];
};

export const penroseToSVG = (canvasSize: [number, number]) => {
    const [width, height] = canvasSize;
    const flipYStr = "matrix(1 0 0 -1 0 0)";
    const translateStr = "translate(" + width / 2 + ", " + height / 2 + ")";
    // Flip Y direction, then translate shape to origin mid-canvas
    return [translateStr, flipYStr].join(" ");
};

export const penroseTransformStr = (tf: any) => {
    const transformList = [
        tf.xScale,
        tf.ySkew,
        tf.xSkew,
        tf.yScale,
        tf.dx,
        tf.dy,
    ];
    const penroseTransform = "matrix(" + transformList.join(" ") + ")";
    return penroseTransform;
};

export const svgTransformString = (tf: any, canvasSize: [number, number]) => {
    // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/transform
    // `tf` is `shape.transformation.contents`, an HMatrix from the backend
    // It is the *full* transform, incl. default transform
    // Do Penrose transform, then SVG
    const transformStr = [penroseToSVG(canvasSize), penroseTransformStr(tf)].join(
        " "
    );
    return transformStr;
};

// BUG: ptList needs to be properly typed
export const toPointListString = memoize(
    // Why memoize?
    (ptList: any[], canvasSize: [number, number]) =>
        ptList
            .map((coords: [number, number]) => {
                const pt = coords;
                return pt[0].toString() + " " + pt[1].toString();
            })
            .join(" ")
);

export const getAlpha = (color: any) => color.contents[3];

export const toHexRGB = (color: [number, number, number]): string => {
    return color.reduce((prev: string, cur: number) => {
        const hex = Math.round(255 * cur).toString(16);
        const padded = hex.length === 1 ? "0" + hex : hex;
        return prev + padded;
    }, "#");
};

// TODO nest this
function hsv2rgb(
    r1: number,
    g1: number,
    b1: number,
    m: number
): [number, number, number] {
    return [r1 + m, g1 + m, b1 + m];
}

// Expects H as angle in degrees, S in [0,100], L in [0,100] and converts the latter two to fractions.
// Returns rgb in range [0, 1]
// From https://github.com/d3/d3-hsv/blob/master/src/hsv.js
export const hsvToRGB = (
    hsv: [number, number, number]
): [number, number, number] => {
    const [h0, s0, v0] = hsv;
    const h = isNaN(h0) ? 0 : (h0 % 360) + Number(h0 < 0) * 360;
    const s = isNaN(h0) || isNaN(s0) ? 0 : s0 / 100.0;
    const v = v0 / 100.0;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    return h < 60
        ? hsv2rgb(c, x, 0, m)
        : h < 120
            ? hsv2rgb(x, c, 0, m)
            : h < 180
                ? hsv2rgb(0, c, x, m)
                : h < 240
                    ? hsv2rgb(0, x, c, m)
                    : h < 300
                        ? hsv2rgb(x, 0, c, m)
                        : hsv2rgb(c, 0, x, m);
};

export const toHex = (color: any): string => {
    if (color.tag === "RGBA") {
        const rgba = color.contents;
        return toHexRGB(rgba.slice(0, 3));
    } else if (color.tag === "HSVA") {
        const hsv = color.contents.slice(0, 3);
        const rgb = hsvToRGB(hsv);
        return toHexRGB(rgb);
    } else {
        console.error("color type", color.tag, "unimplemented");
        return "";
    }
};

export const getAngle = (x1: number, y1: number, x2: number, y2: number) => {
    const x = x1 - x2;
    const y = y1 - y2;
    if (!x && !y) {
        return 0;
    }
    return (180 + (Math.atan2(-y, -x) * 180) / Math.PI + 360) % 360;
};

export const getLen = (x1: number, y1: number, x2: number, y2: number) => {
    return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
};

export const loadImageElement = memoize(
    async (url: string): Promise<any> =>
        new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        })
);

// Load images asynchronously so we can send the dimensions to the backend and use it in the frontend

export const loadImages = async (allShapes: any[]) => {
    return Promise.all(
        allShapes.map(async ({ shapeType, properties }: any) => {
            if (shapeType === "ImageTransform") {
                const path = properties.path.contents;
                const fullPath = process.env.PUBLIC_URL + path;
                const loadedImage = await loadImageElement(fullPath);
                const obj2 = { ...properties };

                obj2.initWidth.contents = loadedImage.naturalWidth;
                obj2.initHeight.contents = loadedImage.naturalHeight;

                return { shapeType, properties: obj2 };
            } else {
                return { shapeType, properties };
            }
        })
    );
};

export const round2 = (n: number) => roundTo(n, 2);

// https://stackoverflow.com/questions/15762768/javascript-math-round-to-two-decimal-places
// Ported so string conversion works in typescript...
export const roundTo = (n: number, digits: number) => {
    let negative = false;

    if (digits === undefined) {
        digits = 0;
    }

    if (n < 0) {
        negative = true;
        n = n * -1;
    }

    const multiplicator = Math.pow(10, digits);
    const nNum = parseFloat((n * multiplicator).toFixed(11));
    const n2 = parseFloat((Math.round(nNum) / multiplicator).toFixed(2));
    let n3 = n2;

    if (negative) {
        n3 = parseFloat((n2 * -1).toFixed(2));
    }

    return n3;
};

// https://stackoverflow.com/questions/31084619/map-a-javascript-es6-map
// Basically Haskell's mapByValue (?)
export function mapMap(map: Map<any, any>, fn: any) {
    return new Map(Array.from(map, ([key, value]) => [key, fn(value, key, map)]));
}

/**
 * Safe wrapper for any function that might return `undefined`.
 * @borrows https://stackoverflow.com/questions/54738221/typescript-array-find-possibly-undefind
 * @param argument Possible unsafe function call
 * @param message Error message
 */
export const safe = <T extends unknown>(
    argument: T | undefined | null,
    message: string
): T => {
    if (argument === undefined || argument === null) {
        throw new TypeError(message);
    }
    return argument;
};

// ----------------

//#region Some geometry-related utils.

/**
 * Some vector operations that can be used on lists.
 */
export const ops = {
    /**
     * Return the norm of the 2-vector `[c1, c2]`.
     */
    norm: (c1: number, c2: number) => ops.vnorm([c1, c2]),

    /**
     * Return the Euclidean distance between scalars `c1, c2`.
     */
    dist: (c1: number, c2: number) => ops.vnorm([c1, c2]),

    /**
     * Return the sum of vectors `v1, v2.
     */
    vadd: (v1: number[], v2: number[]): number[] => {
        if (v1.length !== v2.length) {
            throw Error("expected vectors of same length");
        }

        const res = zipWith(v1, v2, (a, b) => a + b);
        return res;
    },

    /**
     * Return the difference of vectors `v1, v2.
     */
    vsub: (v1: number[], v2: number[]): number[] => {
        if (v1.length !== v2.length) {
            throw Error("expected vectors of same length");
        }

        const res = zipWith(v1, v2, (a, b) => a - b);
        return res;
    },

    /**
     * Return the Euclidean norm squared of vector `v`.
     */
    vnormsq: (v: number[]): number => {
        const res = v.map((e) => e * e);
        return reduce(res, (x, y) => x + y, 0.0); // TODO: Will this one (var(0)) have its memory freed?
        // Note (performance): the use of 0 adds an extra +0 to the comp graph, but lets us prevent undefined if the list is empty
    },

    /**
     * Return the Euclidean norm of vector `v`.
     */
    vnorm: (v: number[]): number => {
        const res = ops.vnormsq(v);
        return Math.sqrt(res);
    },

    /**
     * Return the vector `v` scaled by scalar `c`.
     */
    vmul: (c: number, v: number[]): number[] => {
        return v.map((e) => c * e);
    },

    /**
     * Return the vector `v`, scaled by `-1`.
     */
    vneg: (v: number[]): number[] => {
        return ops.vmul(-1.0, v);
    },

    /**
     * Return the vector `v` divided by scalar `c`.
     */
    vdiv: (v: number[], c: number): number[] => {
        return v.map((e) => e / c);
    },

    /**
     * Return the vector `v`, normalized.
     */
    vnormalize: (v: number[]): number[] => {
        const vsize = ops.vnorm(v) + 10e-10;
        return ops.vdiv(v, vsize);
    },

    /**
     * Return the Euclidean distance between vectors `v` and `w`.
     */
    vdist: (v: number[], w: number[]): number => {
        if (v.length !== w.length) {
            throw Error("expected vectors of same length");
        }

        return ops.vnorm(ops.vsub(v, w));
    },

    /**
     * Return the Euclidean distance squared between vectors `v` and `w`.
     */
    vdistsq: (v: number[], w: number[]): number => {
        if (v.length !== w.length) {
            throw Error("expected vectors of same length");
        }

        return ops.vnormsq(ops.vsub(v, w));
    },

    /**
     * Return the dot product of vectors `v1, v2`.
     * Note: if you want to compute a norm squared, use `vnormsq` instead, it generates a smaller computational graph
     */
    vdot: (v1: number[], v2: number[]): number => {
        if (v1.length !== v2.length) {
            throw Error("expected vectors of same length");
        }

        const res = zipWith(v1, v2, (a, b) => a * b);
        return reduce(res, (x, y) => x + y, 0.0);
    },

    /**
     * Return the sum of elements in vector `v`.
     */
    vsum: (v: number[]): number => {
        return reduce(v, (x, y) => x + y, 0.0);
    },

    /**
     * Return `v + c * u`.
     */
    vmove: (v: number[], c: number, u: number[]) => {
        return ops.vadd(v, ops.vmul(c, u));
    },

    /**
     * Rotate a 2D point `[x, y]` by 90 degrees clockwise.
     */
    rot90: ([x, y]: number[]): number[] => {
        return [-y, x];
    },

    /**
     * Return 2D determinant/cross product of 2D vectors
     */
    cross2: (v: number[], w: number[]): number => {
        if (v.length !== 2 || w.length !== 2) { throw Error("expected two 2-vectors"); }
        return v[0] * w[1] - v[1] * w[0];
    },

    /**
     * Return the angle between two 2D vectors `v` and `w` in radians.
     * From https://github.com/thi-ng/umbrella/blob/develop/packages/vectors/src/angle-between.ts#L11
     */
    angleBetween2: (v: number[], w: number[]): number => {
        if (v.length !== 2 || w.length !== 2) { throw Error("expected two 2-vectors"); }
        const t = Math.atan2(ops.cross2(v, w), ops.vdot(v, w));
        return t;
    },
};

/**
 * Return the bounding box (as 4 segments) of an axis-aligned box-like shape given by `center`, width `w`, height `h` as an object with `top, bot, left, right`.
 */
export const bboxSegs = (center: number[], w: number, h: number): any => {
    const halfWidth = w / 2;
    const halfHeight = h / 2;
    const nhalfWidth = -halfWidth;
    const nhalfHeight = -halfHeight;
    // CCW: TR, TL, BL, BR
    const ptsR = [
        [halfWidth, halfHeight],
        [nhalfWidth, halfHeight],
        [nhalfWidth, nhalfHeight],
        [halfWidth, nhalfHeight],
    ].map((p) => ops.vadd(center, p));

    const cornersR = {
        topRight: ptsR[0],
        topLeft: ptsR[1],
        bottomLeft: ptsR[2],
        bottomRight: ptsR[3],
    };

    const segsR = {
        top: [cornersR.topLeft, cornersR.topRight],
        bot: [cornersR.bottomLeft, cornersR.bottomRight],
        left: [cornersR.bottomLeft, cornersR.topLeft],
        right: [cornersR.bottomRight, cornersR.topRight],
    };

    const linesR = {
        minX: cornersR.topLeft[0],
        maxX: cornersR.topRight[0],
        minY: cornersR.bottomLeft[1],
        maxY: cornersR.topLeft[1],
    };

    return { ptsR, cornersR, segsR, linesR };
};

// returns true if the line from (a,b)->(c,d) intersects with (p,q)->(r,s)
export const intersects = (s1: number[][], s2: number[][]): boolean => {
    const [l1_p1, l1_p2, l2_p1, l2_p2] = [s1[0], s1[1], s2[0], s2[1]];
    const [[a, b], [c, d]] = [l1_p1, l1_p2];
    const [[p, q], [r, s]] = [l2_p1, l2_p2];

    var det, gamma, lambda;
    det = (c - a) * (s - q) - (r - p) * (d - b);
    if (det === 0) {
        return false;
    } else {
        lambda = ((s - q) * (r - a) + (p - r) * (s - b)) / det;
        gamma = ((b - d) * (r - a) + (c - a) * (s - b)) / det;
        return 0 < lambda && lambda < 1 && 0 < gamma && gamma < 1;
    }
};

export interface Point2D {
    x: number;
    y: number;
}

export const toPt = (v: number[]): Point2D => ({ x: v[0], y: v[1] });

export function intersection(s1: number[][], s2: number[][]): number[] {
    const [from1, to1, from2, to2] = [s1[0], s1[1], s2[0], s2[1]];
    const res = intersection2(toPt(from1), toPt(to1), toPt(from2), toPt(to2));
    return [res.x, res.y];
}

// https://stackoverflow.com/posts/58657254/revisions
// Assumes lines don'intersect! Use intersect to check it first
function intersection2(
    from1: Point2D,
    to1: Point2D,
    from2: Point2D,
    to2: Point2D
): Point2D {
    const dX: number = to1.x - from1.x;
    const dY: number = to1.y - from1.y;

    const determinant: number = dX * (to2.y - from2.y) - (to2.x - from2.x) * dY;
    if (determinant === 0) {
        throw Error("parallel lines");
    } // parallel lines

    const lambda: number =
        ((to2.y - from2.y) * (to2.x - from1.x) +
            (from2.x - to2.x) * (to2.y - from1.y)) /
        determinant;
    const gamma: number =
        ((from1.y - to1.y) * (to2.x - from1.x) + dX * (to2.y - from1.y)) /
        determinant;

    // check if there is an intersection
    if (!(0 <= lambda && lambda <= 1) || !(0 <= gamma && gamma <= 1)) {
        throw Error("lines don't intersect");
    }

    return {
        x: from1.x + lambda * dX,
        y: from1.y + lambda * dY,
    };
}

/**
 * Return true iff `p` is in rect `b`, assuming `rect` is an axis-aligned bounding box (AABB) with properties `minX, maxX, minY, maxY`.
 */
export const pointInBox = (p: any, rect: any): boolean => {
    return (
        p.x > rect.minX && p.x < rect.maxX && p.y > rect.minY && p.y < rect.maxY
    );
};

//#endregion
