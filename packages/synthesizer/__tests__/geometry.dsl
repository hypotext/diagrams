-- type Set
type Point

-- type Linelike
-- type Ray
-- type Line
type Segment

type Angle

type Triangle
-- type Square
type Rectangle
-- type Circle

type Plane

-- TOOD: fix my syntax highlighting

-- Subtypes. Should Linelike be a typeclass?
-- Ray <: Linelike
-- Line <: Linelike
-- Segment <: Linelike
-- Square <: Rectangle

-- Point <: Set
-- Linelike <: Set
-- Triangle <: Set
-- Square <: Set
-- -- Rectangle <: Set
-- Circle <: Set

-- TODO: optional naming for constructors

-- TODO: rename to MakeSegment and MakeTriangle (etc.) everywhere
constructor MkSegment : Point p * Point q -> Segment
-- constructor MkRay : Point base * Point direction -> Ray
-- constructor MkLine : Point p * Point q -> Point

-- constructor InteriorAngle : Linelike l * Linelike m -> Angle
constructor InteriorAngle : Point p * Point q * Point r -> Angle
constructor TriangleVertex : Point p * Point q * Point r -> Angle

constructor MkTriangle : Point p * Point q * Point r -> Triangle
-- constructor MkTriangleL : Linelike l * Linelike m * Linelike n -> Triangle
-- constructor MkCircleR : Point center * Point radius -> Circle
-- constructor MkCircleD : Point diam1 * Point diam2 -> Circle
-- constructor MkSquareP : Point p * Point q * Point r * Point s -> Square
-- constructor MkSquare : Point p * Point q * Point r * Point s -> Square -- Assuming the first two points are the segment of a triangle
constructor MkRectangle : Point p * Point q * Point r * Point s -> Rectangle

-- -- TODO: subtyping on the return types
-- function Midpoint : Linelike -> Point
-- function Bisector : Angle -> Ray
-- function PerpendicularBisector : Linelike -> Ray
-- function Sum : Angle * Angle -> Angle
-- function Intersection : Linelike * Linelike -> Point
-- function Altitude : Triangle * Angle -> Segment
-- function Endpoint : Segment -> Point

predicate Acute : Angle
predicate Obtuse : Angle
predicate Right : Angle
-- predicate On : Point * Linelike
predicate In : Point * Plane
predicate Not : Prop
-- predicate Parallel : Linelike * Linelike
-- predicate Perpendicular : Linelike * Linelike
-- predicate EquilateralT : Triangle
-- predicate RightT : Triangle
-- predicate Scalene : Triangle
-- predicate Similar : Triangle * Triangle
-- predicate Disjoint : Set * Set
predicate Collinear : Point * Point * Point

-- notation "{p, q}" ~ "MkSegment(p, q)"
-- notation "{p, q, r}" ~ "MkTriangle(p, q, r)"
-- notation "{p, q, r, s}" ~ "MkRectangle(p, q, r, s)"
-- notation "[p, q, r, s]" ~ "MkSquare(p, q, r, s)"
-- notation "∠(p, q, r)" ~ "InteriorAngle(p, q, r)"