-- | "Utils" contains frequently used utility function, some parameters to "Runtime", and debugging functions.
-- | Utils should not import other modules of Penrose.
-- This is for the "typeclass synonym"
{-# LANGUAGE ConstraintKinds #-}
{-# OPTIONS_HADDOCK prune #-}

module Penrose.Util where

import           Control.Arrow
import           Data.Typeable
import           Debug.Trace
import           System.Random
import           System.Random.Shuffle
import           Data.List (intercalate)
import           Data.Fixed            (mod')

default (Int, Float)

-- | A more concise typeclass for polymorphism for autodiff
-- | NiceFloating :: * -> Constraint
-- https://stackoverflow.com/questions/48631939/a-concise-way-to-factor-out-multiple-typeclasses-in-haskell/48631986#48631986
type Autofloat a = (RealFloat a, Floating a, Real a, Show a, Ord a)

type Autofloat' a = (RealFloat a, Floating a, Real a, Show a, Ord a, Typeable a)

type Pt2 a = (a, a)

type Property = String

--------------------------------------------------------------------------------
-- Errors in the system
-- | Errors from one of the Substance, Style, or Element compilers.
data CompilerError
  = SubstanceParse String -- ^ an error in Substance parsing
  | StyleParse String -- ^ an error in Style parsing
  | StyleLayering String -- ^ an error in Style parsing
  | ElementParse String -- ^ an error in Element parsing
  | SubstanceTypecheck String -- ^ an error in Substance typechecking
  | PluginParse String -- ^ an error in plugin parsing
  | PluginRun String -- ^ an error when running a plugin
  | StyleTypecheck [String] -- ^ an error in Style typechecking
  | ElementTypecheck String -- ^ an error in Element typechecking

instance Show CompilerError where
  show (SubstanceParse err) = "Error when parsing Substance: \n" ++ err
  show (StyleParse err) = "Error when parsing Style: \n" ++ err
  show (ElementParse err) = "Error when parsing Domain: \n" ++ err
  show (SubstanceTypecheck err) = "Error when type-checking Substance: \n" ++ err
  show (PluginParse err) = "Error when parsing plugins: \n" ++ err
  show (PluginRun err) = "Error when running plugins: \n" ++ err
  show (StyleTypecheck err) = "Error when type-checking Style: \n" ++ intercalate "\n" err
  show (StyleLayering err) = "Error when computing the shape ordering in Style: \n" ++ err
  show (ElementTypecheck err) = "Error when type-checking Domain: \n" ++ err


-- | Errors from the optimizer
data RuntimeError = RuntimeError String
instance Show RuntimeError where
  show (RuntimeError err) = "Error in Penrose runtime: \n" ++ err

--------------------------------------------------------------------------------
-- Parameters of the system
stepsPerSecond :: Int
stepsPerSecond = 100000

picWidth, picHeight :: Int
picWidth = 800

picHeight = 700

ptRadius :: Float
ptRadius = 4 -- The size of a point on canvas

defaultWeight :: Floating a => a
defaultWeight = 1

-- Debug flags
-- debug = True
debug = False

debugStyle = False

-- used when sampling the inital state, make sure sizes satisfy subset constraints
subsetSizeDiff :: Floating a => a
subsetSizeDiff = 10.0

epsd :: Floating a => a -- to prevent 1/0 (infinity). put it in the denominator
epsd = 10 ** (-10)

--------------------------------------------------------------------------------
-- General helper functions
type Interval = (Float, Float) -- which causes type inference problems in Style for some reason.

-- Generate n random values uniformly randomly sampled from interval and return generator.
-- NOTE: I'm not sure how backprop works WRT randomness, so the gradients might be inconsistent here.
-- Interval is not polymorphic because I want to avoid using the Random typeclass (Random a)
-- Also apparently using Autofloat here with typeable causes problems for generality of returned StdGen.
-- But it works fine without Typeable.
randomsIn :: (Autofloat a) => StdGen -> Int -> Interval -> ([a], StdGen)
randomsIn g 0 _ = ([], g)
randomsIn g n interval =
  let (x, g') = randomR interval g -- First value
      (xs, g'') = randomsIn g' (n - 1) interval -- Rest of values
  in (r2f x : xs, g'')

pickOne :: [a] -> StdGen -> (a, StdGen)
pickOne list g =
  let (idx, g') = randomR (0, length list - 1) g
  in (list !! idx, g')

fromRight :: (Show a, Show b) => Either a b -> b
fromRight (Left x)  = error ("Failed with error: " ++ show x)
fromRight (Right y) = y

divLine :: IO ()
divLine = putStr "\n--------\n\n"

-- don't use r2f outside of zeroGrad or addGrad, since it doesn't interact well w/ autodiff
r2f :: (Fractional b, Real a) => a -> b
r2f = realToFrac

-- | Wrap a list around anything
toList :: a -> [a]
toList x = [x]

-- | similar to fst and snd, get the third element in a tuple
trd :: (a, b, c) -> c
trd (_, _, x) = x

-- | transform from a 2-element list to a 2-tuple
tuplify2 :: [a] -> (a, a)
tuplify2 [x, y] = (x, y)

-- | apply a function to each element of a 2-tuple
app2 :: (a -> b) -> (a, a) -> (b, b)
app2 f (x, y) = (f x, f y)

-- | apply a function to each element of a 3-tuple
app3 :: (a -> b) -> (a, a, a) -> (b, b, b)
app3 f (x, y, z) = (f x, f y, f z)

-- | generic cartesian product of elements in a list
cartesianProduct :: [[a]] -> [[a]]
cartesianProduct = foldr f [[]]
  where
    f l a = [x : xs | x <- l, xs <- a]

-- | given a side of a rectangle, compute the length of the half half diagonal
halfDiagonal :: (Floating a) => a -> a
halfDiagonal side = 0.5 * dist (0, 0) (side, side)

-- | `compose2` is used to compose with a function that takes in
-- two arguments. As if now, it is used to compose `penalty` with
-- constraint functions
compose2 :: (b -> c) -> (a -> a1 -> b) -> a -> a1 -> c
compose2 = (.) . (.)

concat4 :: [([a], [b], [c], [d])] -> ([a], [b], [c], [d])
concat4 x =
  (concatMap fst4 x, concatMap snd4 x, concatMap thd4 x, concatMap frth4 x)

fst4 (a, _, _, _) = a

snd4 (_, a, _, _) = a

thd4 (_, _, a, _) = a

frth4 (_, _, _, a) = a

-- | Define ternary expressions in Haskell
data Cond a =
  a :? a

infixl 0 ?

infixl 1 :?

(?) :: Bool -> Cond a -> a
True ? (x :? _) = x
False ? (_ :? y) = y

--------------------------------------------------------------------------------
-- Internal naming conventions
nameSep, labelWord :: String
nameSep = " "

labelWord = "label"

labelName :: String -> String
labelName name = name ++ nameSep ++ labelWord

-- | Given a Substance ID and a Style ID for one of its associated graphical primitive, generate a globally unique identifier for this primitive
uniqueShapeName :: String -> String -> String
uniqueShapeName subObjName styShapeName = subObjName ++ nameSep ++ styShapeName
 -- e.g. "B yaxis" (the concatenation should be unique), TODO add the two names as separate obj fields

--------------------------------------------------------------------------------
-- Debug Functions
-- Some debugging functions.
debugF :: (Show a) => a -> a
debugF x =
  if debug
    then traceShowId x
    else x

debugXY x1 x2 y1 y2 =
  if debug
    then trace
           (show x1 ++
            " " ++ show x2 ++ " " ++ show y1 ++ " " ++ show y2 ++ "\n")
    else id

-- To send output to a file, do ./EXECUTABLE 2> FILE.txt
-- For Runtime use only
tr :: Show a => String -> a -> a
tr s x =
  if debug
    then trace "---" $ trace s $ traceShowId x
    else x -- prints in left to right order

-- For Style use only
trs :: Show a => String -> a -> a
trs s x =
  if debugStyle
    then trace "---" $ trace s $ traceShowId x
    else x -- prints in left to right order

trRaw :: Show a => String -> a -> a
trRaw s x = trace "---" $ trace s $ trace (show x ++ "\n") x -- prints in left to right order

trStr :: String -> a -> a
trStr s x =
  if debug
    then trace "---" $ trace s x
    else x -- prints in left to right order

--------------------------------------------------------------------------------
-- Lists-as-vectors utility functions
-- define operator precedence: higher precedence = evaluated earlier
infixl 6 +., -.

infixl 7 *., /.

-- assumes lists are of the same length
dotL :: (RealFloat a, Floating a) => [a] -> [a] -> a
dotL u v = sum $ zipWith (*) u v
  -- Omitted for speed
  -- if not $ length u == length v
  --   then error $
  --        "can't dot-prod different-len lists: " ++
  --        (show $ length u) ++ " " ++ (show $ length v)
  --   else sum $ zipWith (*) u v

(+.) :: Floating a => [a] -> [a] -> [a] -- add two vectors
(+.) u v =
  if not $ length u == length v
    then error $
         "can't add different-len lists: " ++
         (show $ length u) ++ " " ++ (show $ length v)
    else zipWith (+) u v

(-.) :: Floating a => [a] -> [a] -> [a] -- subtract two vectors
(-.) u v =
  if not $ length u == length v
    then error $
         "can't subtract different-len lists: " ++
         (show $ length u) ++ " " ++ (show $ length v)
    else zipWith (-) u v

negL :: Floating a => [a] -> [a]
negL = map negate

(*.) :: Floating a => a -> [a] -> [a] -- multiply by a constant
(*.) c v = map ((*) c) v

(/.) :: Floating a => [a] -> a -> [a]
(/.) v c = map ((/) c) v

p2v (x, y) = [x, y]

v2p [x, y] = (x, y)

infixl 6 +:, -:

infixl 7 *:, /:

(+:) :: Floating a => (a, a) -> (a, a) -> (a, a)
(+:) (x, y) (c, d) = (x + c, y + d)

(-:) :: Floating a => (a, a) -> (a, a) -> (a, a)
(-:) (x, y) (c, d) = (x - c, y - d)

(*:) :: Floating a => a -> (a, a) -> (a, a)
(*:) c (x, y) = (c * x, c * y)

(/:) :: Floating a => (a, a) -> a -> (a, a)
(/:) (x, y) c = (c / x, c / y)

neg :: Floating a => (a, a) -> (a, a)
neg (x, y) = (-x, -y)

dotv :: Floating a => (a, a) -> (a, a) -> a
dotv (x, y) (a, b) = x * a + y * b

-- Again (see below), we add epsd to avoid NaNs. This is a general problem with using `sqrt`.
norm :: Floating a => [a] -> a
norm v = sqrt ((sum $ map (^ 2) v) + epsd)

normsq :: Floating a => [a] -> a
normsq = sum . map (^ 2)

normalize :: Floating a => [a] -> [a]
normalize v = (1 / norm v) *. v

-- Find the angle between x-axis and a line passing points, reporting in radians
findAngle :: Floating a => (a, a) -> (a, a) -> a
findAngle (x1, y1) (x2, y2) = atan $ (y2 - y1) / (x2 - x1)

radians, degrees :: Floating a => a -> a
radians degrees = degrees * (pi/180)
degrees radians = radians * (180/pi)

midpoint :: Floating a => (a, a) -> (a, a) -> (a, a) -- mid point
midpoint (x1, y1) (x2, y2) = ((x1 + x2) / 2, (y1 + y2) / 2)

midpointV :: Floating a => [a] -> [a] -> [a]
midpointV x y = (x +. y) /. 2.0

-- We add epsd to avoid NaNs in the denominator of the gradient of dist.
-- Now, grad dist (0, 0) (0, 0) is 0 instead of NaN.
dist :: Floating a => (a, a) -> (a, a) -> a -- distance
dist (x1, y1) (x2, y2) = sqrt ((x1 - x2) ^ 2 + (y1 - y2) ^ 2 + epsd)

distsq :: Floating a => (a, a) -> (a, a) -> a -- distance
distsq (x1, y1) (x2, y2) = (x1 - x2) ^ 2 + (y1 - y2) ^ 2

-- Closest point on line segment to a point
-- https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
closestpt_pt_seg :: (Floating a, Ord a) => (a, a) -> ((a, a), (a, a)) -> (a, a)
closestpt_pt_seg p@(px, py) (v@(vx, vy), w@(wx, wy)) =
  let eps = 10 ** (-3)
      lensq = distsq v w
  in if lensq < eps
       then v -- line seg looks like a point
       else let dir = w -: v
                t = ((p -: v) `dotv` dir) / lensq -- project vector onto line seg and normalize
                t' = clamp (0, 1) t
            in v +: (t' *: dir) -- walk along vector of line seg

clamp :: (Floating a, Ord a) => (a, a) -> a -> a
clamp (l, r) x = max l $ min r x

subsampleEvery :: Int -> [a] -> [a]
subsampleEvery n xs = map fst $ filter (\(e, i) -> i `mod` n == 0) $ zip xs ([0..length xs])

-- Angle in degrees, doesn't need to be in [0,360], takes the smallest distance between them
-- How do derivatives work here?
-- From: https://stackoverflow.com/questions/1878907/the-smallest-difference-between-2-angles
angleDist :: Autofloat a => a -> a -> a
angleDist u v = let a' = v - u
                in abs $ (a' + 180) `mod'` 360 - 180

--------------------------------------
-- Reflection capabilities to typecheck Computation functions
-- Typeable doesn't works with polymorphism (e.g. `id`) but works with `Floating a` by replacing it with `Double`
-- Adapted https://stackoverflow.com/questions/5144799/reflection-on-inputs-to-a-function-in-haskell
-- TODO unit test for function
-- Unfortunately it's pretty slow...
-- BTW, to check if something has the same type at runtime, can check equality of their typereps (or [Typerep], or [String], or String)
fnTypes :: Typeable a => a -> [TypeRep]
fnTypes x = split (typeOf x)
  where
    split t =
      case first tyConName (splitTyConApp t) of
        (_, []) -> [t] -- not an arrow
        ("(->)", [x]) -> [x] -- return value type
        ("(->)", x) ->
          let current = init x
              next = last x
          in current ++ split next
        (_, _) -> [t]

fnTypesStr :: Typeable a => a -> [String]
fnTypesStr = map show . fnTypes

-- If not an arrow type, then first list is empty (as expected)
inputsOutput :: Typeable a => a -> ([TypeRep], TypeRep)
inputsOutput x =
  let res = fnTypes x
  in (init res, last res)

inputsOutputStr :: Typeable a => a -> ([String], String)
inputsOutputStr x =
  let (args, val) = inputsOutput x
  in (map show args, show val)

-- other helpers
rot90 :: Floating a => (a, a) -> (a, a)
rot90 (x, y) = (-y, x)

rotNeg90 :: Floating a => (a, a) -> (a, a)
rotNeg90 (x, y) = (y, -x)

-- `k` is the fraction of interpolation
lerp :: Floating a => a -> a -> a -> a
lerp a b k = a * (1.0 - k) + b * k

lerpP :: Floating a => (a, a) -> (a, a) -> a -> (a, a)
lerpP (a, b) (c, d) k = (lerp a c k, lerp b d k)

mag :: Floating a => (a, a) -> a
mag (a, b) = sqrt $ magsq (a, b)

magsq :: Floating a => (a, a) -> a
magsq (a, b) = a ** 2 + b ** 2

normalize' :: Floating a => (a, a) -> (a, a)
normalize' (a, b) =
  let l = mag (a, b)
  in (a / l, b / l)

scaleP :: Floating a => a -> (a, a) -> (a, a)
scaleP k (a, b) = (a * k, b * k)

translate2 :: Floating a => (a, a) -> [(a, a)] -> [(a, a)]
translate2 v pts = map (+: v) pts

map2 :: (a -> b) -> (a, a) -> (b, b)
map2 f (a, b) = (f a, f b)

rotateList :: [a] -> [a]
rotateList l = take (length l) $ drop 1 (cycle l)

removeClosePts :: Autofloat a => a -> [a] -> [a]
removeClosePts dx xs =
  map fst $ filter (\(x0, x1) -> (x1 - x0) > dx) $ zip xs (tail xs)

-- | Scale a value x in [lower, upper] linearly to x' lying in range [lower', upper'].
-- (Allow reverse lerping, i.e. upper < lower)
scaleLinear :: Autofloat a => a -> Pt2 a -> Pt2 a -> a
scaleLinear x (lower, upper) (lower', upper') =
  if x < lower || x > upper
    then trace
           ("invalid value " ++ show x ++ " to range " ++ show (lower, upper))
           x
                 -- Values may be wrong in the intermediate stage due to optimization, so maybe clamp to range anyway
    else let (range, range') = (upper - lower, upper' - lower')
         in ((x - lower) / range) * range' + lower'

-- n = number of interpolation points (not counting endpoints)
-- so with n = 1, we would have [x1, (x1+x2/2), x2]
lerpN :: Autofloat a => a -> a -> Int -> [a]
lerpN x1 x2 n =
  let dx = (x2 - x1) / (fromIntegral n + 1)
  in take (n + 2) $ iterate (+ dx) x1

lerp2 :: Autofloat a => Pt2 a -> Pt2 a -> Int -> [Pt2 a]
lerp2 (x1, y1) (x2, y2) n =
  let xs = lerpN x1 x2 n
      ys = lerpN y1 y2 n
  in zip xs ys -- Interp both simultaneously
                            -- Interp the first, then the second
                            -- in zip xs (repeat y1) ++ zip (repeat x2) ys

-- Return the sign of the cross of 2D vectors (for winding, etc.)
crossSgn :: Autofloat a => Pt2 a -> Pt2 a -> a
crossSgn (x1, y1) (x2, y2) = 
         let [x, y, z] = cross [x1, y1, 0] [x2, y2, 0]
         in signum z

cross :: Autofloat a => [a] -> [a] -> [a]
cross [x1, y1, z1] [x2, y2, z2] =
  [y1 * z2 - y2 * z1, x2 * z1 - x1 * z2, x1 * y2 - x2 * y1]
-- cross [x1, x2, x3] [y1, y2, y3] =
-- [x2 * y3 - x3 * y2, x3 * y1 - x1 * y3, x1 * y2 - x2 * y1]

angleBetweenRad :: Autofloat a => [a] -> [a] -> a -- Radians
angleBetweenRad p q = acos ((p `dotL` q) / (norm p * norm q + epsd))

-- n is the "original" plane normal for pq
-- https://stackoverflow.com/questions/5188561/signed-angle-between-two-3d-vectors-with-same-origin-within-the-same-plane
angleBetweenSigned :: Autofloat a => [a] -> [a] -> [a] -> a -- Radians
angleBetweenSigned n p q =
  let sign = -1 * signum ((p `cross` q) `dotL` n)
  in sign * angleBetweenRad p q

-- Unit rotation in the plane of the basis vectors (e1, e2) to time t (arc length)
-- Used for spherical geometry.
-- NOTE: expects e1 and e2 to be unit vectors
circPtInPlane :: Autofloat a => [a] -> [a] -> a -> [a]
circPtInPlane e1 e2 t = cos t *. e1 +. sin t *. e2

-- Assuming unit circle and unit basis vectors. Arc starts at e1.
slerp :: Autofloat a => Int -> a -> a -> [a] -> [a] -> [[a]]
slerp n t0 t1 e1 e2 =
  let dt = (t1 - t0) / (fromIntegral n + 1)
      ts = take (n + 2) $ iterate (+ dt) t0
  in map (circPtInPlane e1 e2) ts -- Travel along the arc

slerpPts :: Autofloat a => Int -> [a] -> [a] -> [[a]]
slerpPts n p q = 
  let (e1, e2) = (normalize p, normalize (p `cross` q)) -- (e1, e3) span the plane of p and q
      e3 = normalize (e2 `cross` e1)
      (t0, t1) = (0.0, angleBetweenRad p q) -- On a unit sphere, the angle between points is the length of the arc b/t them
      pts = slerp (fromIntegral n) t0 t1 e1 e3 
  in {- trace
       ("(e1, e2, e3): " ++ show (e1, e2, e3) ++
        "\ndot results: " ++ show [ei `dotL` ej | ei <- [e1, e2, e3], ej <- [e1, e2, e3]] ++
        "\n(p, q, angleBetweenRad): " ++ show (p, q, t1) ++ "\npts: " ++ show pts) -}
     pts

-- Project q onto p, without normalization
proj :: Autofloat a => [a] -> [a] -> [a]
proj p q =
  let unit_p = normalize p
  in (q `dotL` unit_p) *. unit_p

-- Project q onto p, without normalization (note the order: NOT p onto q)
proj2 :: Autofloat a => Pt2 a -> Pt2 a -> Pt2 a
proj2 p q =
  let unit_p = normalize' p
  in (q `dotv` unit_p) *: unit_p

------- | Hyperbolic geometry

-- Lorenz inner product
-- Assuming x and y have equal lengths that are greater than 0 (omitted for speed)
-- Like the normal dot product but we swap the last sign
-- [x1, x2, x3] .L [y1, y2, y3] = x1 * y1 + x2 * y2 - x3 * y3
-- In a hyperboloid, <x,x> = 1
dotLor :: Autofloat a => [a] -> [a] -> a
dotLor x y = let nm1 = length x - 1
                 ((xs1, xs2), (ys1, ys2)) = (splitAt nm1 x, splitAt nm1 y)
                 (s1, s2) = (dotL xs1 ys1, -1 * dotL xs2 ys2)
             in s1 + s2

-- For Lorenz cross product, this is the matrix J, which just changes the sign of the last element
-- p20: http://www.maths.dur.ac.uk/Ug/projects/highlights/CM3/Hayter_Hyperbolic_report.pdf
-- https://math.stackexchange.com/questions/3017728/an-identity-for-the-lorentz-cross-product
negLast :: Autofloat a => [a] -> [a]
negLast x = let (xs1, xs2) = splitAt (length x - 1) x
            in xs1 ++ ((-1.0) *. xs2)

-- crossLor [x1, x2, x3] [y1, y2, y3] = 
-- [x2 * y3 - x3 * y2, x3 * y1 - x1 * y3, x2 * y1 - x1 * y2]

crossLor :: Autofloat a => [a] -> [a] -> [a]
crossLor x y = negLast $ x `cross` y -- x (*) y = J(x * y) = J(y) * J(x)

-- Lorenz norm
-- TODO: parameterize everything by the Lorenz inner product instead of rewriting code
normsqLor :: Autofloat a => [a] -> a
normsqLor x = dotLor x x 

-- Abs value because we can't ask that sqrt(<x,x>) = -1
-- See email thread with H. Segerman
normLor :: Autofloat a => [a] -> a
normLor x = sqrt (abs (normsqLor x + epsd)) -- Is this numerically okay to optimize?

normalizeLor :: Autofloat a => [a] -> [a]
normalizeLor x = (1 / normLor x) *. x
-- TODO: should these be a sign change so a vector has Lorenz norm -1?

-- TODO: comment these
-- TODO: Use numerically nicer versions of cosh and sinh
-- TODO: implement checks for these vectors (like they are on the hyperboloid or are basis vectors

-- If we start with two vectors a, b on the hyperboloid, 
-- then we find an orthonormal basis for the plane that they span by using Gram-Schmidt:
-- e1 = a
-- e2 = normalize(b + <a, b>L * a)
-- `e1` obviously points in the direction of `a`
-- and `e2` can be understoood as the unit tangent vector from `a` in the direction of `b`

-- Make the second vector orthogonal to the first
gramSchmidt :: (Autofloat a) => [a] -> [a] -> [a]
gramSchmidt a b =
               let proj_b_a = ((a `dotL` b) / (a `dotL` a)) *. a -- Projection onto `a` of `b`
                   basis = b -. proj_b_a
               in -- trace ("\nbasis: " ++ show basis) $ 
                  normalize basis

-- Make the second vector orthogonal to the first
gramSchmidtHyp :: (Autofloat a) => [a] -> [a] -> [a]
gramSchmidtHyp a b =
               let proj_b_a = (a `dotLor` b) *. a
                   basis = b +. proj_b_a
               in -- trace ("\nbasis: " ++ show basis) $ 
                  normalizeLor basis

hypDist :: (Autofloat a) => [a] -> [a] -> a
hypDist p q = acosh (-1 * (p `dotLor` q))
-- TODO check this on cases

-- Note that `d` is hyperbolic distance, NOT time
hypPtInPlane :: Autofloat a => [a] -> [a] -> a -> [a]
hypPtInPlane e1 e2 d = cosh d *. e1 +. sinh d *. e2

-- Walk the path from p to q
-- p and q lie on the hyperboloid (are NOT tangent vectors)
hFromTo :: Autofloat a => [a] -> [a] -> [[a]]
hFromTo p q = let e1 = p
                  e2 = gramSchmidtHyp e1 q
                  n = 50
              -- in hypPtInPlane e1 e2 (hypDist p q)
              in hlerp n 0 (hypDist p q) e1 e2

-- Walk a distance d along the geodesic from p to q (in that direction)
-- p and q lie on the hyperboloid (are NOT tangent vectors)
hwalk :: Autofloat a => [a] -> [a] -> a -> [a]
hwalk p q d = let e1 = p
                  e2 = gramSchmidtHyp e1 q
              in hypPtInPlane e1 e2 d

-- Assuming unit hyp and unit basis vectors. Arc starts at e1.
hlerp :: Autofloat a => Int -> a -> a -> [a] -> [a] -> [[a]]
hlerp n t0 t1 e1 e2 =
  let dt = (t1 - t0) / (fromIntegral n + 1)
      ts = take (n + 2) $ iterate (+ dt) t0
  in map (hypPtInPlane e1 e2) ts -- Travel along the arc

-- Angle between two vectors (assumed to be unit in Lorenz space)
angleLor :: Autofloat a => [a] -> [a] -> a
-- TODO: should this have a negative sign? So the distance and angle are same? Is that ok?
-- TODO: note that acosh(x) is only defined if x >= 1
angleLor a b = hypDist a b
-- angleLor a b = acosh (a `dotLor` b)

-- Project q onto p, without normalization
projLor :: Autofloat a => [a] -> [a] -> [a]
projLor p q =
  let unit_p = normalizeLor p
  in (q `dotLor` unit_p) *. unit_p

-- https://stackoverflow.com/questions/5188561/signed-angle-between-two-3d-vectors-with-same-origin-within-the-same-plane
angleBetweenSignedLor :: Autofloat a => [a] -> [a] -> [a] -> a -- Radians
angleBetweenSignedLor n p q =
  let sign = -1 * signum ((p `crossLor` q) `dotLor` n)
  in sign * angleLor p q
