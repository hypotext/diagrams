{-# LANGUAGE AllowAmbiguousTypes, RankNTypes, UnicodeSyntax, NoMonomorphismRestriction #-}
-- for autodiff, requires passing in a polymorphic fn

-- module Runtime where
import Graphics.Gloss
import Graphics.Gloss.Data.Vector
import Graphics.Gloss.Interface.Pure.Game
import Data.Function
import System.Random
import Debug.Trace
import Numeric.AD
import GHC.Float -- float <-> double conversions
import System.IO
import System.Environment
import Data.List
import qualified Data.Map.Strict as M
import qualified Compiler as C
       -- (subPrettyPrint, styPrettyPrint, subParse, styParse)
       -- TODO limit export/import

divLine = putStr "\n--------\n\n"

main = do
     -- Reading in from file
     -- Objective function is currently hard-coded
     -- Comment in (or out) this block of code to read from a file (need to fix parameter tuning!)
       args <- getArgs
       putStrLn $ if not $ length args == 2 then "Usage: ./Runtime prog1.sub prog2.sty" else "" -- TODO exit
       let (subFile, styFile) = (head args, args !! 1)
       subIn <- readFile subFile
       styIn <- readFile styFile
       putStrLn "\nSubstance program:\n"
       putStrLn subIn
       divLine
       putStrLn "Style program:\n"
       putStrLn styIn
       divLine

       let subParsed = C.subParse subIn
       putStrLn "Parsed Substance program:\n"
       putStrLn $ C.subPrettyPrint' subParsed

       let styParsed = C.styParse styIn
       divLine
       putStrLn "Parsed Style program:\n"
       putStrLn $ C.styPrettyPrint styParsed

       divLine
       let initState = genInitState (C.subSeparate subParsed) styParsed
       putStrLn "Synthesizing objects and objective functions"
       -- putStrLn "Intermediate layout representation:\n"
       -- let intermediateRep = C.subToLayoutRep subParsed
       -- putStrLn $ show intermediateRep

       -- let initState = compilerToRuntimeTypes intermediateRep
       -- divLine
       -- putStrLn "Initial state, optimization representation:\n"
       -- putStrLn "TODO derive Show"
       -- putStrLn $ show initState

       divLine
       putStrLn "Visualizing notation:\n"

       -- Running with hardcoded parameters
       (play
        (InWindow "optimization-based layout" -- display mode, window name
                  (picWidth, picHeight)   -- size
                  (10, 10))    -- position
        white                   -- background color
        stepsPerSecond         -- number of simulation steps to take for each second of real time
        initState               -- the initial world, defined as a type below
        picOf                   -- fn to convert world to a pic
        handler                 -- fn to handle input events
        step)                    -- step the world one iteration; passed period of time (in secs) to be advanced

picWidth :: Int
picWidth = 800

picHeight :: Int
picHeight = 700

stepsPerSecond :: Int
stepsPerSecond = 10000

calcTimestep :: Float -- for use in forcing stepping in handler
calcTimestep = 1 / (int2Float stepsPerSecond)

----------- Defining types for the state of the world.
-- Objects can be Circs (circles) or Labels. Each has a size and position.
-- The state of the world is simply a list of Objects.

-- Circs and Labels satisfy the Located and Selectable typeclasses. So does Obj.
-- So you can do something like `getX o` on any o (an object) without having to worry
-- unpacking it as a circle or label.
class Located a where
      getX :: a -> Float
      getY :: a -> Float
      setX :: Float -> a -> a
      setY :: Float -> a -> a

class Selectable a where
      select :: a -> a
      deselect :: a -> a
      selected :: a -> Bool

class Sized a where
      getSize :: a -> Float
      setSize :: Float -> a -> a

class Named a where
      getName :: a -> Name
      setName :: Name -> a -> a
-------
data SolidArrow = SolidArrow { startx :: Float
                             , starty :: Float
                             , endx :: Float
                             , endy :: Float
                             , thickness :: Float -- the maximum thickness, i.e. the thickness of the head
                             , selsa :: Bool -- is the circle currently selected? (mouse is dragging it)
                             , namesa :: String
                             , colorsa :: Color }
         deriving (Eq, Show)

instance Located SolidArrow where
        --  getX a = endx a - startx a
        --  getY a = endy a - starty a
         getX a   = startx a
         getY a   = starty a
         setX x c = c { startx = x } -- TODO
         setY y c = c { starty = y }

instance Selectable SolidArrow where
         select x = x { selsa = True }
         deselect x = x { selsa = False }
         selected x = selsa x

instance Named SolidArrow where
         getName a = namesa a
         setName x a = a { namesa = x }

-------

data Circ = Circ { xc :: Float
                 , yc :: Float
                 , r :: Float
                 , selc :: Bool -- is the circle currently selected? (mouse is dragging it)
                 , namec :: String
                 , colorc :: Color }
     deriving (Eq, Show)

instance Located Circ where
         getX c = xc c
         getY c = yc c
         setX x c = c { xc = x }
         setY y c = c { yc = y }

instance Selectable Circ where
         select x = x { selc = True }
         deselect x = x { selc = False }
         selected x = selc x

instance Sized Circ where
         getSize x = r x
         setSize size x = x { r = size }

instance Named Circ where
         getName c = namec c
         setName x c = c { namec = x }

----------------------

data Square = Square { xs :: Float
                     , ys :: Float
                     , side :: Float
                     , ang  :: Float -- angle for which the obj is rotated
                     , sels :: Bool -- is the circle currently selected? (mouse is dragging it)
                     , names :: String
                     , colors :: Color }
     deriving (Eq, Show)

instance Located Square where
         getX s = xs s
         getY s = ys s
         setX x s = s { xs = x }
         setY y s = s { ys = y }

instance Selectable Square where
         select x = x { sels = True }
         deselect x = x { sels = False }
         selected x = sels x

instance Sized Square where
         getSize x = side x
         setSize size x = x { side = size }

instance Named Square where
         getName s = names s
         setName x s = s { names = x }

-------

data Label = Label { xl :: Float
                   , yl :: Float
                   , wl :: Float
                   , hl :: Float
                   , textl :: String
                   -- , scalel :: Float  -- calculate h,w from it
                   , sell :: Bool -- selected label
                   , namel :: String }
     deriving (Eq, Show)

instance Located Label where
         getX l = xl l
         getY l = yl l
         setX x l = l { xl = x }
         setY y l = l { yl = y }

instance Selectable Label where
         select x = x { sell = True }
         deselect x = x { sell = False }
         selected x = sell x

instance Sized Label where
         getSize x = xl x -- TODO generalize label size, distance to corner? ignores scale
         setSize size x = x { xl = size, yl = size } -- TODO currently sets both of them, ignores scale
                 -- changing a label's size doesn't actually do anything right now, but should use the scale
                 -- and the base font size

instance Named Label where
         getName l = namel l
         setName x l = l { namel = x }

------

data Pt = Pt { xp :: Float
             , yp :: Float
             , selp :: Bool
             , namep :: String }
     deriving (Eq, Show)

instance Located Pt where
         getX p = xp p
         getY p = yp p
         setX x p = p { xp = x }
         setY y p = p { yp = y }

instance Selectable Pt where
         select   x = x { selp = True }
         deselect x = x { selp = False }
         selected x = selp x

instance Named Pt where
         getName p   = namep p
         setName x p = p { namep = x }

data Obj = S Square | C Circ | L Label | P Pt | A SolidArrow deriving (Eq, Show)

-- TODO: is there some way to reduce the top-level boilerplate?
instance Located Obj where
         getX o = case o of
                 C c -> getX c
                 L l -> getX l
                 P p -> getX p
                 S s -> getX s
                 A a -> getX a
         getY o = case o of
                 C c -> getY c
                 L l -> getY l
                 P p -> getY p
                 S s -> getY s
                 A a -> getY a
         setX x o = case o of
                C c -> C $ setX x c
                L l -> L $ setX x l
                P p -> P $ setX x p
                S s -> S $ setX x s
                A a -> A $ setX x a
         setY y o = case o of
                C c -> C $ setY y c
                L l -> L $ setY y l
                P p -> P $ setY y p
                S s -> S $ setY y s
                A a -> A $ setY y a

instance Selectable Obj where
         select x = case x of
                C c -> C $ select c
                L l -> L $ select l
                P p -> P $ select p
                S s -> S $ select s
                A a -> A $ select a
         deselect x = case x of
                C c -> C $ deselect c
                L l -> L $ deselect l
                P p -> P $ deselect p
                S s -> S $ deselect s
                A a -> A $ deselect a
         selected x = case x of
                C c -> selected c
                L l -> selected l
                P p -> selected p
                S s -> selected s
                A a -> selected a

instance Sized Obj where
         getSize o = case o of
                 C c -> getSize c
                 S s -> getSize s
                 L l -> getSize l
         setSize x o = case o of
                C c -> C $ setSize x c
                L l -> L $ setSize x l
                S s -> S $ setSize x s

instance Named Obj where
         getName o = case o of
                 C c -> getName c
                 L l -> getName l
                 P p -> getName p
                 S s -> getName s
                 A a -> getName a
         setName x o = case o of
                C c -> C $ setName x c
                L l -> L $ setName x l
                P p -> P $ setName x p
                S s -> S $ setName x s
                A a -> A $ setName x a

data LastEPstate = EPstate [Obj] deriving (Eq, Show)

data OptStatus = NewIter -- TODO should this be init with a state?
               | UnconstrainedRunning LastEPstate -- [Obj] stores last EP state
               | UnconstrainedConverged LastEPstate -- [Obj] stores last EP state
               | EPConverged
               deriving (Eq, Show)

data Params = Params { weight :: Double,
                       optStatus :: OptStatus,
                       objFn :: forall a. ObjFnPenaltyState a,
                       annotations :: [[Annotation]]
                     } -- deriving (Eq, Show) -- TODO derive Show instance

-- State of the world
data State = State { objs :: [Obj]
                --    , stys :: [C.StyLine]
                   , constrs :: [C.SubConstr]
                   , down :: Bool -- left mouse button is down (dragging)
                   , rng :: StdGen -- random number generator
                   , autostep :: Bool -- automatically step optimization or not
                   , params :: Params
                   } -- deriving (Show)

------

initRng :: StdGen
initRng = mkStdGen seed
    where seed = 11 -- deterministic RNG with seed

objFnNone :: ObjFnPenaltyState a
objFnNone objs w f v = 0

initParams :: Params
initParams = Params { weight = initWeight, optStatus = NewIter, objFn = objFnNone, annotations = [] }

----------------------- Unpacking
data Annotation = Fix | Vary deriving (Eq, Show)
type Fixed a = [a]
type Varying a = [a]

-- make sure this matches circPack and labelPack
-- annotations are specified inline here. this is per type, not per value (i.e. all circles have the same fixed parameters). but you could generalize it to per-value by adding or overriding annotations globally after the unpacking
-- does not unpack names
unpackObj :: (Floating a, Real a, Show a, Ord a) => Obj' a -> [(a, Annotation)]
-- the location of a circle can vary, but not its radius
unpackObj (C' c) = [(xc' c, Vary), (yc' c, Vary), (r' c, Fix)]
unpackObj (S' s) = [(xs' s, Vary), (ys' s, Vary), (side' s, Fix)]
-- the location of a label can vary, but not its width or height (or other attributes)
unpackObj (L' l) = [(xl' l, Vary), (yl' l, Vary), (wl' l, Fix), (hl' l, Fix)]
-- the location of a point varies
unpackObj (P' p) = [(xp' p, Vary), (yp' p, Vary)]
unpackObj (A' a) = [(startx' a, Vary), (starty' a, Vary), (endx' a, Vary),
    (endy' a, Vary), (thickness' a, Fix)]

-- split out because pack needs this annotated list of lists
unpackAnnotate :: (Floating a, Real a, Show a, Ord a) => [Obj' a] -> [[(a, Annotation)]]
unpackAnnotate objs = map unpackObj objs

-- TODO check it preserves order
splitFV :: (Floating a, Real a, Show a, Ord a) => [(a, Annotation)] -> (Fixed a, Varying a)
splitFV annotated = foldr chooseList ([], []) annotated
        where chooseList :: (a, Annotation) -> (Fixed a, Varying a) -> (Fixed a, Varying a)
              chooseList (x, Fix) (f, v) = (x : f, v)
              chooseList (x, Vary) (f, v) = (f, x : v)

-- optimizer should use this unpack function
-- preserves the order of the objects’ parameters
-- e.g. unpackSplit [Circ {xc varying, r fixed}, Label {xl varying, h fixed} ] = ( [r, h], [xc, xl] )
-- crucially, this does NOT depend on the annotations, it can be used on any list of objects
unpackSplit :: (Floating a, Real a, Show a, Ord a) => [Obj' a] -> (Fixed a, Varying a)
unpackSplit objs = let annotatedList = concat $ unpackAnnotate objs in
                   splitFV annotatedList

---------------------- Packing

-- We put `Floating a` into polymorphic objects for the autodiff.
-- (Maybe port all objects to polymorphic at some point, but would need to zero the gradient information.)
-- Can't use realToFrac here because it will zero the gradient information.
-- TODO use DuplicateRecordFields (also use `stack` and fix GLUT error)--need to upgrade GHC and gloss

data SolidArrow' a = SolidArrow' { startx' :: a
                               , starty' :: a
                               , endx' :: a
                               , endy' :: a
                               , thickness' :: a -- the maximum thickness, i.e. the thickness of the head
                               , selsa' :: Bool -- is the circle currently selected? (mouse is dragging it)
                               , namesa' :: String
                               , colorsa' :: Color }
                               deriving (Eq, Show)

data Circ' a = Circ' { xc' :: a
                     , yc' :: a
                     , r' :: a
                     , selc' :: Bool -- is the circle currently selected? (mouse is dragging it)
                     , namec' :: String
                     , colorc' :: Color }
                     deriving (Eq, Show)

data Label' a = Label' { xl' :: a
                       , yl' :: a
                       , wl' :: a
                       , hl' :: a
                       , textl' :: String
                       , sell' :: Bool -- selected label
                       , namel' :: String }
                       deriving (Eq, Show)

data Pt' a = Pt' { xp' :: a
                 , yp' :: a
                 , selp' :: Bool
                 , namep' :: String }
                 deriving (Eq, Show)

data Square' a  = Square' { xs' :: a
                     , ys' :: a
                     , side' :: a
                     , ang'  :: Float -- angle for which the obj is rotated
                     , sels' :: Bool
                     , names' :: String
                     , colors' :: Color }
                     deriving (Eq, Show)

instance Named (SolidArrow' a) where
         getName sa = namesa' sa
         setName x sa = sa { namesa' = x }

instance Named (Circ' a) where
         getName c = namec' c
         setName x c = c { namec' = x }

instance Named (Square' a) where
         getName s = names' s
         setName x s = s { names' = x }

instance Named (Label' a) where
         getName l = namel' l
         setName x l = l { namel' = x }

instance Named (Pt' a) where
         getName p = namep' p
         setName x p = p { namep' = x }

instance Named (Obj' a) where
         getName o = case o of
                 C' c -> getName c
                 L' l -> getName l
                 P' p -> getName p
                 S' s -> getName s
                 A' a -> getName a
         setName x o = case o of
                C' c -> C' $ setName x c
                S' s -> S' $ setName x s
                L' l -> L' $ setName x l
                P' p -> P' $ setName x p
                A' a -> A' $ setName x a

data Obj' a = C' (Circ' a) | L' (Label' a) | P' (Pt' a) | S' (Square' a)
            | A' (SolidArrow' a) deriving (Eq, Show)

-- TODO comment packing these functions defining conventions
solidArrowPack :: (Real a, Floating a, Show a, Ord a) => SolidArrow -> [a] -> SolidArrow' a
solidArrowPack arr params = SolidArrow' { startx' = sx, starty' = sy, endx' = ex, endy' = ey, thickness' = t,
                namesa' = namesa arr, selsa' = selsa arr, colorsa' = colorsa arr }
         where (sx, sy, ex, ey, t) = if not $ length params == 5 then error "wrong # params to pack solid arrow"
                            else (params !! 0, params !! 1, params !! 2, params !! 3, params !! 4)

circPack :: (Real a, Floating a, Show a, Ord a) => Circ -> [a] -> Circ' a
circPack cir params = Circ' { xc' = xc1, yc' = yc1, r' = r1, namec' = namec cir, selc' = selc cir, colorc' = colorc cir }
         where (xc1, yc1, r1) = if not $ length params == 3 then error "wrong # params to pack circle"
                                else (params !! 0, params !! 1, params !! 2)

sqPack :: (Real a, Floating a, Show a, Ord a) => Square -> [a] -> Square' a
sqPack sq params = Square' { xs' = xs1, ys' = ys1, side' = side1, names' = names sq, sels' = sels sq, colors' = colors sq, ang' = ang sq}
         where (xs1, ys1, side1) = if not $ length params == 3 then error "wrong # params to pack square"
                                else (params !! 0, params !! 1, params !! 2)

ptPack :: (Real a, Floating a, Show a, Ord a) => Pt -> [a] -> Pt' a
ptPack pt params = Pt' { xp' = xp1, yp' = yp1, namep' = namep pt, selp' = selp pt }
        where (xp1, yp1) = if not $ length params == 2 then error "Wrong # of params to pack point"
                           else (params !! 0, params !! 1)

labelPack :: (Real a, Floating a, Show a, Ord a) => Label -> [a] -> Label' a
labelPack lab params = Label' { xl' = xl1, yl' = yl1, wl' = wl1, hl' = hl1,
                             textl' = textl lab, sell' = sell lab, namel' = namel lab }
          where (xl1, yl1, wl1, hl1) = if not $ length params == 4 then error "wrong # params to pack label"
                                   else (params !! 0, params !! 1, params !! 2, params !! 3)

-- does a right fold on `annotations` to preserve order of output list
-- returns remaining (fixed, varying) that were not part of the object
-- e.g. yoink [Fixed, Varying, Fixed] [1, 2, 3] [4, 5] = ([1, 4, 2], [3], [5])
yoink :: (Show a) => [Annotation] -> Fixed a -> Varying a -> ([a], Fixed a, Varying a)
yoink annotations fixed varying = --trace ("yoink " ++ (show annotations) ++ (show fixed) ++ (show varying)) $
      case annotations of
       [] -> ([], fixed, varying)
       (Fix : annotations') -> let (params, fixed', varying') = yoink annotations' (tail fixed) varying in
                               (head fixed : params, fixed', varying')
       (Vary : annotations') -> let (params, fixed', varying') = yoink annotations' fixed (tail varying) in
                                (head varying : params, fixed', varying')

-- used inside overall objective fn to turn (fixed, varying) back into a list of objects
-- for inner objective fns to operate on
-- pack is partially applied with the annotations, which never change
-- (the annotations assume the state never changes size or order)
pack :: (Real a, Floating a, Show a, Ord a) => [[Annotation]] -> [Obj] -> Fixed a -> Varying a -> [Obj' a]
pack annotations objs = pack' (zip objs annotations)

pack' :: (Real a, Floating a, Show a, Ord a) => [(Obj, [Annotation])] -> Fixed a -> Varying a -> [Obj' a]
pack' zipped fixed varying =
     case zipped of
      [] -> []
      ((obj, annotations) : zips) -> res : pack' zips fixed' varying' -- preserve order
     -- use obj, annotations, fixed, and varying to create the object
     -- by yoinking the right params out of f/v in the right order
        where (flatParams, fixed', varying') = yoink annotations fixed varying
           -- is flatParams in the right order?
              res = case obj of
                 -- pack objects using the names, text params carried from initial state
                 -- assuming names do not change during opt
                    C circ  -> C' $ circPack circ flatParams
                    L label -> L' $ labelPack label flatParams
                    P pt    -> P' $ ptPack pt flatParams
                    S sq    -> S' $ sqPack sq flatParams
                    A ar    -> A' $ solidArrowPack ar flatParams

----------------------- Sample objective functions that operate on objects (given names)
-- TODO write about expectations for the objective function writer

type ObjFnOn a = forall a. (Floating a, Real a, Show a, Ord a) => [Name] -> M.Map Name (Obj' a) -> a
-- illegal polymorphic or qualified type--can't return a forall?
type ObjFnNamed a = forall a. (Floating a, Real a, Show a, Ord a) => M.Map Name (Obj' a) -> a
type Name = String
type Weight a = a

-- TODO deal with lists in a more principled way
-- maybe the typechecking should be done elsewhere...
-- shouldn't these two be parametric over objects?
centerCirc :: ObjFnOn a
centerCirc [sname] dict = case (M.lookup sname dict) of
                          Just (C' c) -> (xc' c)^2 + (yc' c)^2
                          Just (L' _) -> error "misnamed label"
                          Nothing -> error "invalid selectors in centerCirc"
centerCirc _ _ = error "centerCirc not called with 1 arg"

-- distanceOf :: ObjFnOn a
-- toLeft [fromname, toname] dict =
--     case (M.lookup fromname dict, M.lookup toname dict) of
--         -- (Just (A' a), Just (S' s), Just (S' e)) ->
--         -- (Just (A' a), Just (S' s), Just (C' e)) ->
--         -- (Just (A' a), Just (C' s), Just (S' e)) ->
--         (Just (C' s), Just (C' e)) ->
--             -- (fromx - sx)^2 + (fromy - sy)^2 + (tox - ex)^2 + (toy - ey)^2
--             (xc' s - xc' e + 400)^2

toLeft :: ObjFnOn a
toLeft [fromname, toname] dict =
    case (M.lookup fromname dict, M.lookup toname dict) of
        (Just (C' s), Just (S' e)) -> (xc' s - xs' e + 400)^2
        (Just (S' s), Just (C' e)) -> (xs' s - xc' e + 400)^2
        (Just (C' s), Just (C' e)) -> (xc' s - xc' e + 400)^2
        (Just (S' s), Just (S' e)) -> (xs' s - xs' e + 400)^2


centerMap :: ObjFnOn a
centerMap [mapname, fromname, toname] dict =
    let spacing = 10 in -- TODO: arbitrary
    case (M.lookup mapname dict, M.lookup fromname dict, M.lookup toname dict) of
        (Just (A' a), Just (S' s), Just (S' e)) ->
            _centerMap a [xs' s, ys' s] [xs' e, ys' e]
                [spacing + (halfDiagonal . side') s, negate $ spacing + (halfDiagonal . side') e]
        (Just (A' a), Just (S' s), Just (C' e)) ->
            _centerMap a [xs' s, ys' s] [xc' e, yc' e]
                [spacing + (halfDiagonal . side') s, negate $ spacing + r' e]
        (Just (A' a), Just (C' s), Just (S' e)) ->
            _centerMap a [xc' s, yc' s] [xs' e, ys' e]
                [spacing + r' s, negate $ spacing + (halfDiagonal . side') e]
        (Just (A' a), Just (C' s), Just (C' e)) ->
            _centerMap a [xc' s, yc' s] [xc' e, yc' e]
                [spacing + r' s, negate $ spacing + r' e]

centerMap _ _ = error "centerMap not called with 1 arg"

_centerMap :: forall a. (Floating a, Real a, Show a, Ord a) =>
                SolidArrow' a -> [a] -> [a] -> [a] -> a
_centerMap a s1@[x1, y1] s2@[x2, y2] [o1, o2] =
    let vec  = [x2 - x1, y2 - y1] -- direction the arrow should point to
        dir = normalize vec -- direction the arrow should point to
        [sx, sy, ex, ey] = if norm vec > o1 + abs o2
                then (s1 +. o1 *. dir) ++ (s2 +. o2 *. dir) else s1 ++ s2
        [fromx, fromy, tox, toy] = [startx' a, starty' a, endx' a, endy' a] in
    (fromx - sx)^2 + (fromy - sy)^2 + (tox - ex)^2 + (toy - ey)^2

centerLabel :: ObjFnOn a
centerLabel [main, label] dict =
    case (M.lookup main dict, M.lookup label dict) of
        -- have the label near main’s border
        (Just (C' c), Just (L' l)) ->
                let [cx, cy, lx, ly] = [xc' c, yc' c, xl' l, yl' l] in
                (cx - lx)^2 + (cy - ly)^2
        (Just (S' s), Just (L' l)) ->
                let [cx, cy, lx, ly] = [xs' s, ys' s, xl' l, yl' l] in
                (cx - lx)^2 + (cy - ly)^2
        (Just (P' p), Just (L' l)) ->
                let [px, py, lx, ly] = [xp' p, yp' p, xl' l, yl' l] in
                (px + 10 - lx)^2 + (py + 20 - ly)^2 -- Top right from the point
        (Just (A' a), Just (L' l)) ->
                let (sx, sy, ex, ey) = (startx' a, starty' a, endx' a, endy' a)
                    (mx, my) = midpoint (sx, sy) (ex, ey)
                    (lx, ly) = (xl' l, yl' l) in
                (mx - lx)^2 + (my + (textHeight * 0.25) - ly)^2 -- Top right from the point
        (_, _) -> error "invalid selectors in centerLabel"
centerLabel _ _ = error "centerLabel not called with 1 arg"


------- Ambient objective functions

-- no names specified; can apply to any combination of objects in M.Map
type AmbientObjFn a = forall a. (Floating a, Real a, Show a, Ord a) => M.Map Name (Obj' a) -> a

-- if there are no circles, doesn't do anything
-- TODO fix in case there's only 1 circle?
circParams :: (Floating a, Real a, Show a, Ord a) => M.Map Name (Obj' a) -> ([a], [a])
circParams m = unpackSplit $ filter isCirc $ M.elems m
           where isCirc (C' _) = True
                 isCirc _ = False

-- reuse existing objective function
circlesCenterAndRepel :: AmbientObjFn a
circlesCenterAndRepel objMap = let (fix, vary) = circParams objMap in
                               centerAndRepel_dist fix vary

circlesCenter :: AmbientObjFn a
circlesCenter objMap = let (fix, vary) = circParams objMap in
                       centerObjs fix vary

-- pairwiseRepel :: [Obj] -> Float
-- pairwiseRepel objs = sumMap pairRepel $ allPairs objs

-- pairRepel :: Obj -> Obj -> Float
-- pairRepel c d = 1 / (distsq c d)
--           where distsq c d = (getX c - getX d)^2 + (getY c - getY c)^2

-- -- returns a list of ambient constraint fns--4 for each object
-- -- i guess i don’t NEED to weight each individually. just sum them and weight the whole thing
-- allInBbox :: [Obj] -> Float
-- allInBbox objs = sum $ concatMap inBbox objs
--           where inBbox o = [boxleft o, boxright o, boxup o, boxdown o]
--                 boxleft o = getX o - leftline -- magnitude of violation

------- Constraints
-- Constraints are written WRT magnitude of violation
-- TODO metaprogramming for boolean constraints
-- TODO use these types?
type ConstraintFn a = forall a. (Floating a, Real a, Show a, Ord a) => [Name] -> M.Map Name (Obj' a) -> a

defaultCWeight :: Floating a => a
defaultCWeight = 1

-- TODO: should points also have a weight of 1?
defaultPWeight :: Floating a => a
defaultPWeight = 1


-- Pairwise constraint functions

subsetFn, noSubsetFn, intersectFn, noIntersectFn, pointInFn, pointNotInFn ::
    (Floating a, Real a, Show a, Ord a) => [Obj' a] -> a
subsetFn [(C' inc), (C' outc)] =
    strictSubset [[xc' inc, yc' inc, r' inc], [xc' outc, yc' outc, r' outc]]
subsetFn [(S' inc), (S' outc)] = strictSubset
    [[xs' inc, ys' inc, 0.5 * side' inc], [xs' outc, ys' outc, 0.5 * side' outc]]
subsetFn [(C' inc), (S' outc)] = strictSubset
    [[xc' inc, yc' inc, r' inc], [xs' outc, ys' outc, 0.5 * side' outc]]
subsetFn [(S' inc), (C' outc)] = strictSubset
    [[xs' inc, ys' inc, (halfDiagonal . side') inc], [xc' outc, yc' outc, r' outc]]
subsetFn _  = error "subset not called with 2 args"

noSubsetFn [ (C' inc),  (C' outc)] =
    noSubset [[xc' inc, yc' inc, r' inc], [xc' outc, yc' outc, r' outc]]
noSubsetFn [ (S' inc),  (S' outc)] =
    noSubset [[xs' inc, ys' inc, (halfDiagonal . side') inc],
        [xs' outc, ys' outc, (halfDiagonal . side') outc]]
noSubsetFn [ (C' inc),  (S' outs)] =
    noSubset [[xc' inc, yc' inc, r' inc], [xs' outs, ys' outs, (halfDiagonal . side') outs]]
noSubsetFn [ (S' inc),  (C' outc)] =
    noSubset [[xs' inc, ys' inc, (halfDiagonal . side') inc], [xc' outc, yc' outc, r' outc]]
noSubsetFn  _ = error "noSubset not called with 2 args"

intersectFn [(C' xset), (C' yset)] =
    looseIntersect [[xc' xset, yc' xset, r' xset], [xc' yset, yc' yset, r' yset]]
intersectFn [(S' xset), (C' yset)] =
    looseIntersect [[xs' xset, ys' xset, 0.5 * side' xset], [xc' yset, yc' yset, r' yset]]
intersectFn [(C' xset), (S' yset)] =
    looseIntersect [[xc' xset, yc' xset, r' xset], [xs' yset, ys' yset, 0.5 * side' yset]]
intersectFn [(S' xset), (S' yset)] =
    looseIntersect [[xs' xset, ys' xset, 0.5 * side' xset], [xs' yset, ys' yset, 0.5 * side' yset]]
intersectFn _ = error "intersect not called with 2 args"

noIntersectFn [(C' xset),  (C' yset)] = tr "no intersect val: " $
    noIntersectExt [[xc' xset, yc' xset, r' xset], [xc' yset, yc' yset, r' yset]]
noIntersectFn [(S' xset),  (C' yset)] =
    noIntersectExt [[xs' xset, ys' xset, (halfDiagonal . side') xset], [xc' yset, yc' yset, r' yset]]
noIntersectFn [(C' xset),  (S' yset)] =
    noIntersectExt [[xc' xset, yc' xset, r' xset], [xs' yset, ys' yset, (halfDiagonal . side') yset]]
noIntersectFn [(S' xset),  (S' yset)] =
    noIntersectExt [[xs' xset, ys' xset, (halfDiagonal . side') xset],
        [xs' yset, ys' yset, (halfDiagonal . side') yset]]
noIntersectFn  _ = error "no intersect not called with 2 args"

pointInFn [(P' pt),  (C' set)] =
        dist (xp' pt, yp' pt) (xc' set, yc' set) - 0.5 * r' set
pointInFn [(P' pt),  (S' set)] =
    dist (xp' pt, yp' pt) (xs' set, ys' set) - 0.4 * side' set
pointInFn _ = error "point in not called with 2 args"

pointNotInFn [(P' pt), (C' set)] =
    -dist (xp' pt, yp' pt) (xc' set, yc' set) + r' set
pointNotInFn [(P' pt), (S' set)] =
    -dist (xp' pt, yp' pt) (xs' set, ys' set) + (halfDiagonal . side') set
pointNotInFn _ = error "point in not called with 2 args"

avoidSubsets [(C' inset), (L' lout)] =
    -- repelCenter [] [xc' inset, yc' inset, xl' lout, yl' lout]
    - dist (xl' lout, yl' lout) (xc' inset, yc' inset) + 1.3 * r' inset
avoidSubsets [(S' inset), (L' lout)] =
    -- repelCenter [] [xc' inset, yc' inset, xl' lout, yl' lout]
    - dist (xl' lout, yl' lout) (xs' inset, ys' inset) + 1.5 * (halfDiagonal . side') inset

toPenalty :: (Floating a, Real a, Show a, Ord a) =>
    (M.Map Name (Obj' a) -> a) -> (M.Map Name (Obj' a) -> a)
toPenalty f = \dict -> penalty $ f dict

-- Generate constraints on names (returns no objects)
genConstrFn :: (Floating a, Real a, Show a, Ord a) =>
                C.SubConstr -> [([Obj' a] -> a, Weight a, [Name])]
genConstrFn (C.Intersect xname yname)   =
    [ (penalty . intersectFn, defaultCWeight, [xname, yname]) ]
genConstrFn (C.NoIntersect xname yname) =
    [ (penalty . noIntersectFn, defaultCWeight, [xname, yname]) ]
genConstrFn (C.NoSubset inName outName) =
    [ (penalty . noSubsetFn, defaultCWeight, [inName, outName]) ]
genConstrFn (C.PointIn pname sname)     =
    [ (penalty . pointInFn, defaultPWeight, [pname, sname]) ]
genConstrFn (C.PointNotIn pname sname)  =
    [ (penalty . pointNotInFn, defaultPWeight, [pname, sname]) ]
genConstrFn (C.Subset inName outName)   =
    [ (penalty . subsetFn, defaultCWeight, [inName, outName])
    , (penalty . avoidSubsets, defaultCWeight, [inName, labelName outName])
    ]
--
genConstrFns :: (Floating a, Real a, Show a, Ord a) =>
                [C.SubConstr] -> [([Obj' a] -> a, Weight a, [Name])]
genConstrFns = concatMap genConstrFn

------- Style related functions

-- default shapes
defaultSolidArrow, defaultPt, defaultSquare, defaultLabel, defaultCirc :: String -> Obj
defaultSolidArrow name = A $ SolidArrow { startx = 100, starty = 100, endx = 200, endy = 200, thickness = 10,
                            selsa = False, namesa = name, colorsa = black }
defaultPt name = P $ Pt { xp = 100, yp = 100, selp = False, namep = name }
defaultSquare name = S $ Square { xs = 100, ys = 100, side = defaultRad,
        sels = False, names = name, colors = black, ang = 0.0}
defaultLabel text = L $ Label { xl = -100, yl = -100,
                                wl = textWidth * (fromIntegral (length text)),
                                hl = textHeight,
                                textl = text, sell = False, namel = labelName text }
defaultCirc name = C $ Circ { xc = 100, yc = 100, r = defaultRad,
        selc = False, namec = name, colorc = black }
--

dictOfStys :: [C.SubDecl] -> [C.StyLine] -> M.Map Name [C.StyLine]
dictOfStys objs stys = foldr (processLine objs) dict stys
    where dict = foldr addObj M.empty objs
          addObj (C.Decl (C.OM (C.Map' name _ _))) = M.insert name []
          addObj (C.Decl (C.OS (C.Set' name _)))   = M.insert name []
          addObj (C.Decl (C.OP (C.Pt' name)))      = M.insert name []

-- If there is no spec associated with an obj, we should insert this obj in the dict
insertSty :: Name -> C.StyLine -> M.Map Name [C.StyLine] -> M.Map Name [C.StyLine]
insertSty name line dict = case (M.lookup name dict) of
    Nothing -> M.insert name [line] dict
    _ -> M.adjust ([line] ++) name dict

processLine :: [C.SubDecl] -> C.StyLine -> M.Map Name [C.StyLine] -> M.Map Name [C.StyLine]
processLine objs s dict =
    case s of
    (C.Shape (C.SubVal v) _)  -> insertSty v s dict
    (C.Shape C.Global _)      -> M.mapWithKey (\k stys -> s:stys) dict
    (C.Shape (C.SubType t) _) -> M.mapWithKey (\k stys -> s:stys) dict
    otherwise -> error "shape not known"

-- Find all lines specifying shape
shapeLines :: [C.StyLine] -> [C.StyLine]
shapeLines stys = filter isShape $ stys
                where isShape (C.Shape  _ _) = True
                      isShape _ = False

-- Given a list of sty settings, find the most specific one
-- The order from most specific to general: individual -> type -> global
prioritize :: [C.StyLine] -> C.StyLine
prioritize stys = stys !! maxIdx
        where prios = map getPrio stys
              Just maxIdx = elemIndex (maximum prios) prios
              getPrio (C.Shape (C.SubVal _) _) = 3
              getPrio (C.Shape C.Global  _) = 2
              getPrio (C.Shape (C.SubType _) _) = 1

-- Generates an object depending on the style specification
shapeOf :: String -> M.Map Name [C.StyLine] -> Obj
shapeOf name dict =
    case (M.lookup name dict) of
        Nothing -> error ("Cannot find style info for " ++ name)
        Just stys -> let (C.Shape _ (C.Override s)) = prioritize $ shapeLines stys in getShape s
    where getShape (C.SS C.SetCircle) = defaultCirc name
          getShape (C.SS C.Box) = defaultSquare name
          getShape (C.SM C.SolidArrow) = defaultSolidArrow name
          getShape _ = error ("Unknow shape for " ++ name)

------- Generate objective functions

defaultWeight :: Floating a => a
defaultWeight = 1

defaultRad :: Floating a => a
defaultRad = 100

objFnOnNone :: ObjFnOn a
objFnOnNone names map = 0

-- Parameters to change
declSetObjfn :: ObjFnOn a
declSetObjfn = objFnOnNone -- centerCirc

declPtObjfn :: ObjFnOn a
declPtObjfn = objFnOnNone -- centerCirc

declLabelObjfn :: ObjFnOn a
declLabelObjfn = centerLabel -- objFnOnNone

declMapObjfn :: ObjFnOn a
declMapObjfn = centerMap

labelName :: String -> String
labelName name = "Label_" ++ name

genObjsAndFns :: (Floating a, Real a, Show a, Ord a) =>
                  M.Map String [C.StyLine] -> C.SubDecl -> ([Obj], [(M.Map Name (Obj' a) -> a, Weight a)])
genObjsAndFns stys line@(C.Decl (C.OS (C.Set' sname stype))) = (objs, weightedFns)
            where
                c1 = shapeOf sname stys
                -- TODO proper dimensions for labels
                l1 = defaultLabel sname
                objs = [c1, l1]
                weightedFns = [ (declSetObjfn [sname], defaultWeight),
                    (declLabelObjfn [sname, labelName sname], defaultWeight) ]
genObjsAndFns stys (C.Decl (C.OP (C.Pt' pname))) = (objs, weightedFns)
            where
                p1 = defaultPt pname
                l1 = defaultLabel pname
                objs = [p1, l1]
                weightedFns = [ (declPtObjfn [pname], defaultWeight),
                    (declLabelObjfn [pname, labelName pname], defaultWeight) ]
genObjsAndFns stys (C.Decl (C.OM (C.Map' name from to))) = (objs, weightedFns)
            where
                a = defaultSolidArrow name
                l1 = defaultLabel name
                objs = [a, l1]
                weightedFns = [
                    (toLeft [from, to], defaultWeight),
                    (declMapObjfn [name, from, to], defaultWeight), -- TODO: a different obj function
                    (declLabelObjfn [name, labelName name], defaultWeight)]

genAllObjsAndFns :: (Floating a, Real a, Show a, Ord a) =>
                 [C.SubDecl] -> M.Map String [C.StyLine] -> ([Obj], [(M.Map Name (Obj' a) -> a, Weight a)])
-- TODO figure out how the types work. also add weights
genAllObjsAndFns decls stys = let (objss, fnss) = unzip $ map (genObjsAndFns stys) decls in
                         (concat objss, concat fnss)

dictOf :: (Real a, Floating a, Show a, Ord a) => [Obj' a] -> M.Map Name (Obj' a)
dictOf = foldr addObj M.empty
       where addObj o dict = M.insert (getName o) o dict

dictOfObjs :: [Obj] -> M.Map Name Obj
dictOfObjs = foldr addObj M.empty
       where addObj o dict = M.insert (getName o) o dict

-- constant b/c ambient fn value seems to be 10^4 and constr value seems to reach only 10, 10^2
constrWeight :: Floating a => a
constrWeight = 10 ^ 4

lookupNames :: (Real a, Floating a, Show a, Ord a) => (M.Map Name (Obj' a)) -> [Name] -> [Obj' a]
-- For all pairwise functions
lookupNames dict (n1:n2:n3:n4:[]) =
    case [M.lookup n1 dict, M.lookup n2 dict, M.lookup n3 dict, M.lookup n4 dict] of
        [Just o1, Just o2, Just o3, Just o4] -> [o1, o2, o3, o4]
        _                  -> error ("lookupNames: at least one of the arguments don't exist!")
lookupNames dict (n1:n2:n3:[]) = case [M.lookup n1 dict, M.lookup n2 dict, M.lookup n3 dict] of
        [Just o1, Just o2, Just o3] -> [o1, o2, o3]
        _                  -> error ("lookupNames: at least one of the arguments don't exist!")
lookupNames dict (n1:n2:[]) = case [M.lookup n1 dict, M.lookup n2 dict] of
        [Just o1, Just o2] -> [o1, o2]
        _                  -> error ("One of " ++ n1 ++ " or " ++ n2 ++ " don't exist!")
lookupNames _ _ = error "lookupNames only supports 2 or 3 args"

-- TODO should take list of current objects as parameter, and be partially applied with that
-- first param: list of parameter annotations for each object in the state
-- assumes that the state's SIZE and ORDER never change
-- note: CANNOT do dict -> list because that destroys the order
genObjFn :: (Real a, Floating a, Show a, Ord a) =>
         [[Annotation]]
         -> [(M.Map Name (Obj' a) -> a, Weight a)]
         -> [(M.Map Name (Obj' a) -> a, Weight a)]
         -> [([Obj' a] -> a, Weight a, [Name])]
         -> [Obj] -> a -> [a] -> [a] -> a
genObjFn annotations objFns ambientObjFns constrObjFns =
         \currObjs penaltyWeight fixed varying ->
         let newObjs = pack annotations currObjs fixed varying in
         let objDict = dictOf newObjs in
         sumMap (\(f, w) -> w * f objDict) objFns
            + (tr "ambient fn value: " (sumMap (\(f, w) -> w * f objDict) ambientObjFns))
            + (tr "constr fn value: "
                (constrWeight * penaltyWeight * sumMap (\(f, w, n) -> w * f (lookupNames objDict n)) constrObjFns))
        --    (sumMap (\(f, w) -> w * f objDict) objFns) +
        --    (sumMap (\(f, w) -> w * f objDict) ambientObjFns) +
        --    (constrWeight * penaltyWeight *
        --         sumMap (\(f, w, n) -> w * f (lookupNames objDict n)) constrObjFns)
         -- factor out weight application?


-- TODO: **must** manually change this constraint if you change the constr function for EP
-- needs constr to be violated
constraint :: [C.SubConstr] -> [Obj] -> Bool
constraint constrs = if constraintFlag then \x ->
                        let res = [consistentSizes constrs x] in and res
                     else \x -> True

-- generate all objects and the overall objective function
-- style program is currently unused
-- TODO adjust weights of all functions
genInitState :: ([C.SubDecl], [C.SubConstr]) -> [C.StyLine] -> State
genInitState (decls, constrs) stys =
             -- objects and objectives (without ambient objfns or constrs)
             let (initState, objFns) = genAllObjsAndFns decls (dictOfStys decls stys) in
            --  let objFns = [] in -- TODO removed only for debugging constraints

             -- ambient objectives
             -- be careful with how the ambient objectives interact with the per-declaration objectives!
             -- e.g. the repel objective conflicts with a subset/intersect constraint -> nonconvergence!
            --  let ambientObjFns = [(circlesCenter, defaultWeight)] in
             let ambientObjFns = [] in

             -- constraints
             let constrFns = genConstrFns constrs in
             let ambientConstrFns = [] in -- TODO add
             let constrObjFns = constrFns ++ ambientConstrFns in

             -- resample state w/ constrs. TODO how to deal with `Subset A B` -> `r A < r B`?
             -- let boolConstr = \x -> True in // TODO needs to take this as a param
             let (initStateConstr, initRng') = sampleConstrainedState initRng initState constrs in

             -- unpackAnnotate :: [Obj] -> [ [(Float, Annotation)] ]
             let flatObjsAnnotated = unpackAnnotate (addGrads initStateConstr) in
             let annotationsCalc = map (map snd) flatObjsAnnotated in -- `map snd` throws away initial floats

             -- overall objective function
             let objFnOverall = genObjFn annotationsCalc objFns ambientObjFns constrObjFns in

             State { objs = initStateConstr,
                     constrs = constrs,
                     params = initParams { objFn = objFnOverall, annotations = annotationsCalc },
                     down = False, rng = initRng', autostep = False }

--------------- end object / objfn generation

rad :: Floating a => a
rad = 200 -- TODO don't hardcode into constant
clamp1D y = if clampflag then 0 else y

rad1 :: Floating a => a
rad1 = rad-100

rad2 :: Floating a => a
rad2 = rad+50

-- Initial state of the world, reading from Substance/Style input
initState :: State
initState = State { objs = objsInit, constrs = [], down = False, rng = initRng, autostep = False, params = initParams }

-- divide two integers to obtain a float
divf :: Int -> Int -> Float
divf a b = (fromIntegral a) / (fromIntegral b)

pw2 :: Float
pw2 = picWidth `divf` 2

pw2' :: Floating a => a
pw2' = realToFrac pw2

ph2 :: Float
ph2 = picHeight `divf` 2

ph2' :: Floating a => a
ph2' = realToFrac ph2

-- avoid having black and white to ensure the visibility of objects
opacity, cmax, cmin :: Float
opacity = 0.5
cmax = 0.1
cmin = 0.9

widthRange  = (-pw2, pw2)
heightRange = (-ph2, ph2)
radiusRange = (20, picWidth `divf` 6)
sideRange = (20, picWidth `divf` 3)
colorRange  = (cmin, cmax)

------------- The "Style" layer: render the state of the world.
renderCirc :: Circ -> Picture
renderCirc c = if selected c
               then let (r', g', b', a') = rgbaOfColor $ colorc c in
                    color (makeColor r' g' b' (a' / 2)) $ translate (xc c) (yc c) $
                    circleSolid (r c)
               else color (colorc c) $ translate (xc c) (yc c) $
                    circleSolid (r c)

-- fix to the centering problem of labels, assumeing:
-- (1) monospaced font; (2) at least a chracter of max height is in the label string
labelScale, textWidth, textHeight :: Floating a => a
textWidth  = 104.76 -- Half of that of the monospaced version
textHeight = 119.05
labelScale = 0.2

label_offset_x, label_offset_y :: String -> Float -> Float
label_offset_x str x = x - (textWidth * labelScale * 0.5 * (fromIntegral (length str)))
label_offset_y str y = y - labelScale * textHeight * 0.5

renderLabel :: Label -> Picture
renderLabel l =
            pictures $ [
            color scolor $
            translate
            (label_offset_x (textl l) (xl l))
            (label_offset_y (textl l) (yl l)) $
            scale labelScale labelScale $
            text (textl l)
            -- ,
            -- line [(x, y), (x + labelScale * w, y), (x + labelScale * w, y + labelScale * h),
            --     (x, y + labelScale * h), (x, y)]
            ]
            where scolor = if selected l then red else light black
                  w = textWidth * (fromIntegral (length $ textl l))
                  h = textHeight
                  x = (label_offset_x (textl l) (xl l))
                  y = (label_offset_y (textl l) (yl l))


renderPt :: Pt -> Picture
renderPt p = color scalar $ translate (xp p) (yp p)
             $ circleSolid ptRadius
             where scalar = if selected p then red else black
-- renderPt p = color scalar $ translate (xp p) (yp p)
--              $ circle ptRadius
--              where scalar = if selected p then red else black
-- renderPt p = let l1 = line [(-ptRadius, -ptRadius), (ptRadius,  ptRadius)]
--                  l2 = line [(-ptRadius,  ptRadius), (ptRadius, -ptRadius)]
--              in color scalar $ translate (xp p) (yp p) $ Pictures [l1, l2]
--              where scalar = if selected p then red else black

renderSquare :: Square -> Picture
renderSquare s = if selected s
            then let (r', g', b', a') = rgbaOfColor $ colors s in
            color (makeColor r' g' b' (a' / 2)) $ translate (xs s) (ys s) $
            rectangleSolid (side s) (side s)
            else color (colors s) $ translate (xs s) (ys s) $
            rectangleSolid (side s) (side s)

renderArrow :: SolidArrow -> Picture
-- renderArrow sa = color black $  line [(startx sa, starty sa), (endx sa, endy sa)]
renderArrow sa = color scalar $ translate sx sy $ rotate (negate $ toDegree $ argV dir) $ pictures $
                map polygon [ head_path, body_path ]
                where
                    scalar = if selected sa then red else black
                    (sx, sy, ex, ey, t) = (startx sa, starty sa, endx sa, endy sa, thickness sa / 6)
                    dir = (ex - sx, ey - sy) -- direction the arrow should point to
                    len = magV dir
                    body_path = [ (0, 0 + t), (len - 5*t, t),
                        (len - 5*t, -1*t), (0, -1*t) ]
                    head_path = [(len - 5*t, 3*t), (len, 0),
                        (len - 5*t, -3*t)]

toDegree, toRadian :: Floating a => a -> a
toDegree rad = rad * 180 / pi
toRadian deg = deg * pi / 180

renderObj :: Obj -> Picture
renderObj (C circ)  = renderCirc circ
renderObj (L label) = renderLabel label
renderObj (P pt)    = renderPt pt
renderObj (S sq)    = renderSquare sq
renderObj (A ar)    = renderArrow ar

isLabel :: Obj -> Bool
isLabel (L l) = True
isLabel _     = False

splitLabels :: [Obj] -> ([Obj], [Obj])
splitLabels objs = (filter isLabel objs, filter (not . isLabel) objs)

picOfState :: State -> Picture
picOfState s =
    let (labels, others) = splitLabels (objs s)
    in
    -- currently not putting labels at the top level because the control is not ready
    -- Pictures $ map renderObj others ++ map renderObj labels
    Pictures $ map renderObj (objs s)

picOf :: State -> Picture
picOf s = Pictures [picOfState s, objectiveText, constraintText, stateText, paramText, optText]
                    -- lineXbot, lineXtop, lineYbot, lineYtop]
    where -- TODO display constraint instead of hardcoding
          -- (picture for bounding box for bound constraints)
          -- constraints are currently global params
          lineXbot = color red $ Line [(leftb, botb), (rightb, botb)]
          lineXtop = color red $ Line [(leftb, topb), (rightb, topb)]
          lineYbot = color red $ Line [(leftb, botb), (leftb, topb)]
          lineYtop = color red $ Line [(rightb, botb), (rightb, topb)]

          -- TODO generate this text more programmatically
          objectiveText = translate xInit yInit $ scale sc sc
                         $ text objText
          constraintText = translate xInit (yInit - yConst) $ scale sc sc
                         $ text constrText
          stateText = let res = if autostep s then "on" else "off" in
                      translate xInit (yInit - 2 * yConst) $ scale sc sc
                      $ text ("autostep: " ++ res)
          paramText = translate xInit (yInit - 3 * yConst) $ scale sc sc
                      $ text ("penalty function weight: " ++ show (weight $ params s))
          optText = translate xInit (yInit - 4 * yConst) $ scale sc sc
                    $ text ("optimization status: " ++ (statusTextOf $ optStatus $ params s))
          statusTextOf val = case val of
                           NewIter -> "opt started; new iteration"
                           UnconstrainedRunning lastState -> "unconstrained running"
                           UnconstrainedConverged lastState -> "unconstrained converged"
                           EPConverged -> "EP converged" -- TODO record num iterations
          xInit = -pw2+50
          yInit = ph2-50
          yConst = 30
          sc = 0.1

------- Sampling the state subject to a constraint. Currently not used since we are doing unconstrained optimization.

-- generate an infinite list of sampled elements
-- keep the last generator for the "good" element
genMany :: RandomGen g => g -> (g -> (a, g)) -> [(a, g)]
genMany gen genOne = iterate (\(c, g) -> genOne g) (genOne gen)

-- take the first element that satisfies the condition
-- not the most efficient impl. also assumes infinite list s.t. head always exists
crop :: RandomGen g => (a -> Bool) -> [(a, g)] -> (a, g)
crop cond xs = --(takeWhile (not . cond) (map fst xs), -- drops gens
                head $ dropWhile (\(x, _) -> not $ cond x) xs -- drops while top-level condition true. keeps good's gen

-- randomly sample location (for circles and labels) and radius (for circles)
sampleCoord :: RandomGen g => g -> Obj -> (Obj, g)
sampleCoord gen o = let o_loc = setX x' $ setY (clamp1D y') o in
                    case o_loc of
                    C circ -> let (r',  gen3) = randomR radiusRange gen2
                                  (cr', gen4) = randomR colorRange  gen3
                                  (cg', gen5) = randomR colorRange  gen4
                                  (cb', gen6) = randomR colorRange  gen5
                                  in
                              (C $ circ { r = r', colorc = makeColor cr' cg' cb' opacity }, gen6)
                    S sq   -> let (side', gen3) = randomR sideRange gen2
                                  (cr', gen4) = randomR colorRange  gen3
                                  (cg', gen5) = randomR colorRange  gen4
                                  (cb', gen6) = randomR colorRange  gen5
                                  in
                              (S $ sq { side = side', colors = makeColor cr' cg' cb' opacity }, gen6)
                    L lab -> (o_loc, gen2) -- only sample location
                    P pt  -> (o_loc, gen2)
                    A a   -> (o_loc, gen2) -- TODO

        where (x', gen1) = randomR widthRange  gen
              (y', gen2) = randomR heightRange gen1

-- sample each object independently, threading thru gen
stateMap :: RandomGen g => g -> (g -> a -> (b, g)) -> [a] -> ([b], g)
stateMap gen f [] = ([], gen)
stateMap gen f (x:xs) = let (x', gen') = f gen x in
                        let (xs', gen'') = stateMap gen' f xs in
                        (x' : xs', gen'')

-- sample a state
genState :: RandomGen g => [Obj] -> g -> ([Obj], g)
genState shapes gen = stateMap gen sampleCoord shapes

-- sample entire state at once until constraint is satisfied
-- TODO doesn't take into account pairwise constraints or results from objects sampled first, sequentially
sampleConstrainedState :: RandomGen g => g -> [Obj] -> [C.SubConstr] -> ([Obj], g)
sampleConstrainedState gen shapes constrs = (state', gen')
       where (state', gen') = crop (constraint constrs) states
             states = genMany gen (genState shapes)
             -- init state params are ignored; we just need to know what kinds of objects are in it

--------------- Handle user input. "handler" is the main function here.
-- Whenever the library receives an input event, it calls "handler" with that event
-- and the current state of the world to handle it.

ptRadius = 4 -- The size of a point on canvas
bbox = 60 -- TODO put all flags and consts together
-- hacky bounding box of label

-- Find the angle between x-axis and a line passing points, reporting in radians
findAngle :: Floating a => (a, a) -> (a, a) -> a
findAngle (x1, y1) (x2, y2) = atan $ (y2 - y1) / (x2 - x1)

midpoint :: Floating a => (a, a) -> (a, a) -> (a, a) -- mid point
midpoint (x1, y1) (x2, y2) = ((x1 + x2) / 2, (y1 + y2) / 2)

dist :: Floating a => (a, a) -> (a, a) -> a -- distance
dist (x1, y1) (x2, y2) = sqrt ((x1 - x2)^2 + (y1 - y2)^2)

distsq :: Floating a => (a, a) -> (a, a) -> a -- distance
distsq (x1, y1) (x2, y2) = (x1 - x2)^2 + (y1 - y2)^2

-- Hardcode bbox of label at the center
-- TODO properly get bbox; rn text is centered at bottom left
inObj :: (Float, Float) -> Obj -> Bool

-- TODO: this is NOT an accurate BBox at all. Good for selection though
inObj (xm, ym) (L o) =
    abs (xm - (xl o)) <= 0.1 * (wl o) &&
    abs (ym - (yl o)) <= 0.1 * (hl o) -- is label
    -- abs (xm - (label_offset_x (textl o) (xl o))) <= 0.25 * (wl o) &&
    -- abs (ym - (label_offset_y (textl o) (yl o))) <= 0.25 * (hl o) -- is label
inObj (xm, ym) (C o) = dist (xm, ym) (xc o, yc o) <= r o -- is circle
inObj (xm, ym) (S o) = abs (xm - xs o) <= 0.5 * side o && abs (ym - ys o) <= 0.5 * side o -- is squar   e
inObj (xm, ym) (P o) = dist (xm, ym) (xp o, yp o) <= ptRadius -- is Point, where we arbitrarily define the "radius" of a point
-- TODO: due to the way Located is defined, we can only drag the starting pt here
inObj (xm, ym) (A a) =
    let (sx, sy, ex, ey, t) = (startx a, starty a, endx a, endy a, thickness a)
        (x, y) = midpoint (sx, sy) (ex, ey)
        len = 0.5 * dist (sx, sy) (ex, ey)
    in abs (x - xm) <= len && abs (y - ym) <= t


-- check convergence of EP method
epDone :: State -> Bool
epDone s = ((optStatus $ params s) == EPConverged) || ((optStatus $ params s) == NewIter)

-- UI so far: pressing and releasing 'r' will re-sample all objects' sizes and positions within some preset range
-- if autostep is set, then dragging will move an object while optimization continues
-- if autostep is not set, then optimization will only step when 's' is pressed. dragging will move an object while optimization is not happening

-- for more on these constructors, see docs: https://hackage.haskell.org/package/gloss-1.10.2.3/docs/Graphics-Gloss-Interface-Pure-Game.html
-- pattern matches not fully fuzzed--assume that user only performs one action at once
-- (e.g. not left-clicking while stepping the optimization)
-- TODO "in object" tests
-- prevents user from manipulating objects until EP is done, unless objects are re-sampled

handler :: Event -> State -> State
handler (EventKey (MouseButton LeftButton) Down _ (xm, ym)) s =
        if epDone s then s { objs = objsFirstSelected, down = True } else s
        -- so that clicking doesn't select all overlapping objects in bbox
        -- foldl will reverse the list each time, so a diff obj can be selected
        -- foldr will preserve the list order, so objects are stepped consistently
        where (objsFirstSelected, _) = foldr (flip $ selectFirstIfContains (xm, ym)) ([], False) (objs s)
              selectFirstIfContains (x, y) (xs, alreadySelected) o =
                                    if alreadySelected || (not $ inObj (x, y) o) then (o : xs, alreadySelected)
                                    else (select (setX xm $ setY ym o) : xs, True)
-- dragging mouse when down
-- if an object is selected, then if the collection of objects with the object moved satisfies the constraint,
-- then move the object to mouse position
-- TODO there's probably a better way to implement that
handler (EventMotion (xm, ym)) s =
        if down s && epDone s then s { objs = map (ifSelectedMoveTo (xm, ym)) (objs s), down = down s } else s
        where ifSelectedMoveTo (xm, ym) o = if selected o then setX xm $ setY (clamp1D ym) o else o

-- button released, so deselect all objects AND restart the optimization
-- keep the annotations and obj fn, otherwise state will be erased
handler (EventKey (MouseButton LeftButton) Up _ _) s =
        s { objs = map deselect $ objs s, down = False,
            params = (params s) { weight = initWeight, optStatus = NewIter } }

-- if you press a key while down, then the handler resets the entire state (then Up will just reset again)
handler (EventKey (Char 'r') Up _ _) s =
        s { objs = objs', down = False, rng = rng',
        params = (params s) { weight = initWeight, optStatus = NewIter } }
        where (objs', rng') = sampleConstrainedState (rng s) (objs s) (constrs s)

-- turn autostep on or off (press same button to turn on or off)
handler (EventKey (Char 'a') Up _ _) s = if autostep s then s { autostep = False }
                                         else s { autostep = True }

-- pressing 's' (down) while autostep is off will step the optimization once, overriding the step function
-- (which doesn't step if autostep is off). this is the same code as the step function but with reverse condition
-- if autostep is on, this does nothing
-- also overrides EP done: forces a step (might want this to test if there substantial steps left after convergence, e.g. if magnitude of gradient is still large)
handler (EventKey (Char 's') Down _ _) s =
        if not $ autostep s then s { objs = objs', params = params' } else s
        where (objs', params') = stepObjs (float2Double calcTimestep) (params s) (objs s)

-- change the weights in the barrier/penalty method (scale by 10). don't step objects
-- only allow the user to change the weights if EP has converged (just make the constraints sharper)
-- (doesn't seem to make a difference, though...)
-- in that case, start re-running UO with the last EP state as the current (converged) EP state
handler (EventKey (SpecialKey KeyUp) Down _ _) s =
        if epDone s then s { params = (params s) { weight = weight', optStatus = status' }} else s
        where currWeight = weight (params s)
              weight' = currWeight * weightGrowth
              status' = UnconstrainedRunning $ EPstate (objs s)

handler (EventKey (SpecialKey KeyDown) Down _ _) s =
        if epDone s then s { params = (params s) { weight = weight', optStatus = status' }} else s
        where currWeight = weight (params s)
              weight' = currWeight / weightGrowth
              status' = UnconstrainedRunning $ EPstate (objs s)

handler _ s = s

----------- Stepping the state the world via gradient descent.
 -- First, miscellaneous helper functions.

-- Clamp objects' positions so they don't go offscreen.
-- TODO clamp needs to take into account bbox of object
clampX :: Float -> Float
clampX x = if x < -pw2 then -pw2 else if x > pw2 then pw2 else x

clampY :: Float -> Float
clampY y = if y < -ph2 then -ph2 else if y > ph2 then ph2 else y

minSize :: Float
minSize = 5

clampSize :: Float -> Float -- TODO assumes the size is a radius
clampSize s = if s < minSize then minSize
              else if s > ph2 || s > pw2 then min pw2 ph2 else s

-- Some debugging functions. @@@
debugF :: (Show a) => a -> a
debugF x = if debug then traceShowId x else x
debugXY x1 x2 y1 y2 = if debug then trace (show x1 ++ " " ++ show x2 ++ " " ++ show y1 ++ " " ++ show y2 ++ "\n") else id

-- To send output to a file, do ./EXECUTABLE 2> FILE.txt
tr :: Show a => String -> a -> a
tr s x = if debug then trace "---" $ trace s $ traceShowId x else x -- prints in left to right order

trRaw :: Show a => String -> a -> a
trRaw s x = trace "---" $ trace s $ traceShowId x -- prints in left to right order

trStr :: String -> a -> a
trStr s x = if debug then trace "---" $ trace s x else x -- prints in left to right order

tr' :: Show a => String -> a -> a
tr' s x = if debugLineSearch then trace "---" $ trace s $ traceShowId x else x -- prints in left to right order

tro :: Show a => String -> a -> a
tro s x = if debugObj then trace "---" $ trace s $ traceShowId x else x -- prints in left to right order

noOverlapPair :: Obj -> Obj -> Bool
noOverlapPair (C c1) (C c) = dist (xc c1, yc c1) (xc c, yc c) > r c1 + r c
noOverlapPair (S s1) (S s2) = dist (xs s1, ys s1) (xs s2, ys s2) > side s1 + side s2
-- TODO: factor out this
noOverlapPair (C c) (S s) = dist (xc c, yc c) (xs s, ys s) > (halfDiagonal .  side) s + r c
noOverlapPair (S s) (C c) = dist (xs s, ys s) (xc c, yc c) > (halfDiagonal . side) s + r c
noOverlapPair _ _ = True -- TODO, ignores labels

-- return true iff satisfied
-- TODO deal with labels and more than two objects
noneOverlap :: [Obj] -> Bool
noneOverlap objs = let allPairs = filter (\x -> length x == 2) $ subsequences objs in -- TODO factor out
                 all id $ map (\[o1, o2] -> noOverlapPair o1 o2) allPairs
-- noOverlap (c1 : c : []) = noOverlapPair c1 c
-- noOverlap (c1 : c : c3 : _) = noOverlapPair c1 c && noOverlapPair c c3 && noOverlapPair c1 c3 -- TODO
-- noOverlap _ _ = True

-- allOverlap vs. not noOverlap--they're different!
allOverlap :: [Obj] -> Bool
allOverlap objs = let allPairs = filter (\x -> length x == 2) $ subsequences objs in -- TODO factor out
                 all id $ map (\[o1, o2] -> not $ noOverlapPair o1 o2) allPairs

-- used when sampling the inital state, make sure sizes satisfy subset constraints
subsetSizeDiff :: Float
subsetSizeDiff = 10.0

halfDiagonal :: (Floating a) => a -> a
halfDiagonal side = 0.5 * dist (0, 0) (side, side)

-- TODO: do we want strict subset or loose subset here? Now it is strict
consistentSizes :: [C.SubConstr] -> [Obj] -> Bool
consistentSizes constrs objs = all id $ map (checkSubsetSize dict) constrs
                            where dict = dictOfObjs objs
checkSubsetSize dict constr@(C.Subset inName outName) =
    case (M.lookup inName dict, M.lookup outName dict) of
        (Just (C inc), Just (C outc)) ->
            (r outc) - (r inc) > subsetSizeDiff -- TODO: taking this as a parameter?
        (Just (S inc), Just (S outc)) -> (side outc) - (side inc) > subsetSizeDiff
        -- TODO: this does not scale, general way?
        (Just (C c), Just (S s)) -> r c < 0.5 * side s
        (Just (S s), Just (C c)) -> (halfDiagonal . side) s < r c
        (_, _) -> error "checkSubsetSize not called on two sets, or 1+ doesn't exist"
checkSubsetSize _ _ = True


-- Type aliases for shorter type signatures.
type TimeInit = Float
type Time = Double
type ObjFn1 a = forall a . (Show a, Ord a, Floating a, Real a) => [a] -> a
type GradFn a = forall a . (Show a, Ord a, Floating a, Real a) => [a] -> [a]
type Constraints = [(Int, (Double, Double))]
     -- TODO: convert lists to lists of type-level length, and define an interface for object state (pos, size)
     -- also need to check the input length matches obj fn lengths, e.g. in awlinesearch

-- old code for bound constraints
-- does not project onto an arbitrary set, only intervals
-- projCoordInterval :: (Double, Double) -> Double -> Double
-- projCoordInterval (lower, upper) x = (sort [lower, upper, x]) !! 1 -- median of the list

-- for each element, if there's a constraint on it (by index), project it onto the interval
-- lookInAndProj :: Constraints -> (Int, Double) -> [Double] -> [Double]
-- lookInAndProj constraints (index, x) acc =
--               case (Map.lookup index constraintsMap) of
--               Just bounds -> projCoordInterval bounds x : acc
--               Nothing     -> x : acc
--               where constraintsMap = Map.fromList constraints

-- don't change the order of elements in the state!! use foldr, not foldl
-- projectOnto :: Constraints -> [Double] -> [Double]
-- projectOnto constraints state =
--             let indexedState = zip [0..] state in
--             foldr (lookInAndProj constraints) [] indexedState

-------- Step the world by one timestep (provided by the library).
-- this function actually ignores the input timestep, because line search calculates the appropriate timestep to use,
-- but it's left in, in case we want to debug the line search.
-- gloss operates on floats, but the optimization code should be done with doubles, so we
-- convert float to double for the input and convert double to float for the output.
step :: TimeInit -> State -> State
step t s = -- if down s then s -- don't step when dragging
           if autostep s then s { objs = objs', params = params' } else s
           where (objs', params') = stepObjs (float2Double t) (params s) (objs s)

-- Utility functions for getting object info (currently unused)
objInfo :: Obj -> [Float]
objInfo o = [getX o, getY o, getSize o] -- TODO deal with labels, also do stuff at type level

stateSize :: Int
stateSize = 3

chunksOf :: Int -> [a] -> [[a]]
chunksOf _ [] = []
chunksOf n l = take n l : chunksOf n (drop n l)

objsInfo :: [a] -> [[a]]
objsInfo = chunksOf stateSize

-- from [x,y,s] over all objs, return [x,y] over all
objsCoords :: [a] -> [a]
objsCoords = concatMap (\[x, y, s] -> [x, y]) . objsInfo -- from [x,y,s] over all objs, return [s] over all
objsSizes :: [a] -> [a]
objsSizes = map (\[x, y, s] -> s) . objsInfo
----

-- convergence criterion for EP
-- if you want to use it for UO, needs a different epsilon
epStopCond :: (Floating a, Ord a, Show a) => [a] -> [a] -> a -> a -> Bool
epStopCond x x' fx fx' =
           trStr ("EP: \n||x' - x||: " ++ (show $ norm (x -. x'))
           ++ "\n|f(x') - f(x)|: " ++ (show $ abs (fx - fx'))) $
           (norm (x -. x') <= epStop) || (abs (fx - fx') <= epStop)

-- just for unconstrained opt, not EP
-- stopEps large bc UO doesn't seem to strongly converge...
optStopCond :: (Floating a, Ord a, Show a) => [a] -> Bool
optStopCond gradEval = trStr ("||gradEval||: " ++ (show $ norm gradEval)
                       ++ "\nstopEps: " ++ (show stopEps)) $
            (norm gradEval <= stopEps)

-- unpacks all objects into a big state vector, steps that state, and repacks the new state into the objects
-- NOTE: all downstream functions (objective functions, line search, etc.) expect a state in the form of
-- a big list of floats with the object parameters grouped together: [x1, y1, size1, ... xn, yn, sizen]

-- don't use r2f outside of zeroGrad or addGrad, since it doesn't interact well w/ autodiff
r2f :: (Fractional b, Real a) => a -> b
r2f = realToFrac

-- Going from `Floating a` to Float discards the autodiff dual gradient info (I think)
zeroGrad :: (Real a, Floating a, Show a, Ord a) => Obj' a -> Obj
zeroGrad (C' c) = C $ Circ { xc = r2f $ xc' c, yc = r2f $ yc' c, r = r2f $ r' c,
                             selc = selc' c, namec = namec' c, colorc = colorc' c }
zeroGrad (S' s) = S $ Square { xs = r2f $ xs' s, ys = r2f $ ys' s, side = r2f $ side' s, sels = sels' s, names = names' s, colors = colors' s, ang = ang' s }

zeroGrad (L' l) = L $ Label { xl = r2f $ xl' l, yl = r2f $ yl' l, wl = r2f $ wl' l, hl = r2f $ hl' l,
                              textl = textl' l, sell = sell' l, namel = namel' l }
zeroGrad (P' p) = P $ Pt { xp = r2f $ xp' p, yp = r2f $ yp' p, selp = selp' p,
                           namep = namep' p }
zeroGrad (A' a) = A $ SolidArrow { startx = r2f $ startx' a, starty = r2f $ starty' a,
                            endx = r2f $ endx' a, endy = r2f $ endy' a, thickness = r2f $ thickness' a,
                            selsa = selsa' a, namesa = namesa' a, colorsa = colorsa' a }

zeroGrads :: (Real a, Floating a, Show a, Ord a) => [Obj' a] -> [Obj]
zeroGrads = map zeroGrad

-- Add the grad info by generalizing Obj (on Floats) to polymorphic objects (for autodiff to use)
addGrad :: (Real a, Floating a, Show a, Ord a) => Obj -> Obj' a
addGrad (C c) = C' $ Circ' { xc' = r2f $ xc c, yc' = r2f $ yc c, r' = r2f $ r c,
                             selc' = selc c, namec' = namec c, colorc' = colorc c }
addGrad (S s) = S' $ Square' { xs' = r2f $ xs s, ys' = r2f $ ys s, side' = r2f $ side s, sels' = sels s,
                            names' = names s, colors' = colors s, ang' = ang s }
addGrad (L l) = L' $ Label' { xl' = r2f $ xl l, yl' = r2f $ yl l, wl' = r2f $ wl l, hl' = r2f $ hl l,
                              textl' = textl l, sell' = sell l, namel' = namel l }
addGrad (P p) = P' $ Pt' { xp' = r2f $ xp p, yp' = r2f $ yp p, selp' = selp p,
                           namep' = namep p }
addGrad (A a) = A' $ SolidArrow' { startx' = r2f $ startx a, starty' = r2f $ starty a,
                            endx' = r2f $ endx a, endy' = r2f $ endy a, thickness' = r2f $ thickness a,
                            selsa' = selsa a, namesa' = namesa a, colorsa' = colorsa a }


addGrads :: (Real a, Floating a, Show a, Ord a) => [Obj] -> [Obj' a]
addGrads = map addGrad

-- implements exterior point algo as described on page 6 here:
-- https://www.me.utexas.edu/~jensen/ORMM/supplements/units/nlp_methods/const_opt.pdf
-- the initial state (WRT violating constraints), initial weight, params, constraint normalization, etc.
-- have all been initialized or set earlier
stepObjs :: (Real a, Floating a, Show a, Ord a) => a -> Params -> [Obj] -> ([Obj], Params)
stepObjs t sParams objs =
         let (epWeight, epStatus) = (weight sParams, optStatus sParams) in
         case epStatus of

         -- start the outer EP optimization and the inner unconstrained optimization, recording initial EPstate
         NewIter -> let status' = UnconstrainedRunning $ EPstate objs in
                    (objs', sParams { weight = initWeight, optStatus = status'} )

         -- check *weak* convergence of inner unconstrained opt.
         -- if UO converged, set opt state to converged and update UO state (NOT EP state)
         -- if not, keep running UO (inner state implicitly stored)
         -- note convergence checks are only on the varying part of the state
         UnconstrainedRunning lastEPstate ->  -- doesn't use last EP state
           -- let unconstrConverged = optStopCond gradEval in
           let unconstrConverged = epStopCond stateVarying stateVarying'
                                   (objFnApplied stateVarying) (objFnApplied stateVarying') in
           if unconstrConverged then
              let status' = UnconstrainedConverged lastEPstate in -- update UO state only!
              (objs', sParams { optStatus = status'}) -- note objs' (UO converged), not objs
           else (objs', sParams) -- update UO state but not EP state; UO still running

         -- check EP convergence. if converged then stop, else increase weight, update states, and run UO again
         -- TODO some trickiness about whether unconstrained-converged has updated the correct state
         -- and whether i should check WRT the updated state or not
         UnconstrainedConverged (EPstate lastEPstate) ->
           let (_, epStateVarying) = tupMap (map float2Double) $ unpackSplit
                                     $ addGrads lastEPstate in -- TODO factor out
           let epConverged = epStopCond epStateVarying stateVarying -- stateV is last state for converged UO
                                   (objFnApplied epStateVarying) (objFnApplied stateVarying) in
           if epConverged then
              let status' = EPConverged in -- no more EP state
              (objs, sParams { optStatus = status'}) -- do not update UO state
           -- update EP state: to be the converged state from the most recent UO
           else let status' = UnconstrainedRunning $ EPstate objs in -- increase weight
                (objs, sParams { weight = weightGrowth * epWeight, optStatus = status' })

         -- done; don't update obj state or params; user can now manipulate
         EPConverged -> (objs, sParams)

         -- TODO: implement EPConvergedOverride (for when the magnitude of the gradient is still large)

         -- TODO factor out--only unconstrainedRunning needs to run stepObjective, but EPconverged needs objfn
        where (fixed, stateVarying) = tupMap (map float2Double) $ unpackSplit $ addGrads objs
                      -- realToFrac used because `t` output is a Float? I don't really know why this works
              (stateVarying', objFnApplied, gradEval) = stepWithObjective objs fixed sParams
                                                             (realToFrac t) stateVarying
              -- re-pack each object's state list into object
              objs' = zeroGrads $ pack (annotations sParams) objs fixed stateVarying'

-- Given the time, state, and evaluated gradient (or other search direction) at the point,
-- return the new state. Note that the time is treated as `Floating a` (which is internally a Double)
-- not gloss's `Float`
stepT :: Floating a => a -> a -> a -> a
stepT dt x dfdx = x - dt * dfdx

-- Calculates the new state by calculating the directional derivatives (via autodiff)
-- and timestep (via line search), then using them to step the current state.
-- Also partially applies the objective function.
stepWithObjective :: (RealFloat a, Real a, Floating a, Ord a, Show a) =>
                  [Obj] -> [a] -> Params -> a -> [a] -> ([a], [a] -> a, [a])
stepWithObjective objs fixed stateParams t state = (steppedState, objFnApplied, gradEval)
                  where (t', gradEval) = timeAndGrad objFnApplied t state
                        -- get timestep via line search, and evaluated gradient at the state
                        -- step each parameter of the state with the time and gradient
                        -- gradEval :: [Double]; gradEval = [dfdx1, dfdy1, dfdsize1, ...]
                        steppedState = let state' = map (\(v, dfdv) -> stepT t' v dfdv) (zip state gradEval) in
                                       trStr ("||x' - x||: " ++ (show $ norm (state -. state'))
                                              ++ "\n|f(x') - f(x)|: " ++
                                             (show $ abs (objFnApplied state - objFnApplied state')))
                                       state'
                        objFnApplied :: ObjFn1 a -- i'm not clear on why realToFrac is needed here either
                                     -- since everything should already be polymorphic
                        -- here, objFn is a function that gets the objective function from stateParams
                        -- note that the objective function is partially applied w/ current list of objects
                        objFnApplied = (objFn stateParams) objs (realToFrac cWeight) (map realToFrac fixed)
                        cWeight = weight stateParams

-- a version of grad with a clearer type signature
appGrad :: (Show a, Ord a, Floating a, Real a) =>
        (forall a . (Show a, Ord a, Floating a, Real a) => [a] -> a) -> [a] -> [a]
appGrad f l = grad f l

nanSub :: (RealFloat a, Floating a) => a
nanSub = 0

removeNaN' :: (RealFloat a, Floating a) => a -> a
removeNaN' x = if isNaN x then nanSub else x

removeNaN :: (RealFloat a, Floating a) => [a] -> [a]
removeNaN = map removeNaN'

removeInf' :: (RealFloat a, Floating a) => a -> a
removeInf' x = if isInfinity x then bignum else if isNegInfinity x then (-bignum) else x
           where bignum = 10**10

removeInf :: (RealFloat a, Floating a) => [a] -> [a]
removeInf = map removeInf'

tupMap :: (a -> b) -> (a, a) -> (b, b)
tupMap f (a, b) = (f a, f b)

----- Lists-as-vectors utility functions, TODO split out of file

-- define operator precedence: higher precedence = evaluated earlier
infixl 6 +., -.
infixl 7 *. -- .*, /.

-- assumes lists are of the same length
dotL :: Floating a => [a] -> [a] -> a
dotL u v = if not $ length u == length v
           then error $ "can't dot-prod different-len lists: " ++ (show $ length u) ++ " " ++ (show $ length v)
           else sum $ zipWith (*) u v

(+.) :: Floating a => [a] -> [a] -> [a] -- add two vectors
(+.) u v = if not $ length u == length v
           then error $ "can't add different-len lists: " ++ (show $ length u) ++ " " ++ (show $ length v)
           else zipWith (+) u v

(-.) :: Floating a => [a] -> [a] -> [a] -- subtract two vectors
(-.) u v = if not $ length u == length v
           then error $ "can't subtract different-len lists: " ++ (show $ length u) ++ " " ++ (show $ length v)
           else zipWith (-) u v

negL :: Floating a => [a] -> [a]
negL = map negate

(*.) :: Floating a => a -> [a] -> [a] -- multiply by a constant
(*.) c v = map ((*) c) v

norm :: Floating a => [a] -> a
norm = sqrt . sum . map (^ 2)

normsq :: Floating a => [a] -> a
normsq = sum . map (^ 2)

normalize :: Floating a => [a] -> [a]
normalize v = (1 / norm v) *. v

-----

-- Given the objective function, gradient function, timestep, and current state,
-- return the timestep (found via line search) and evaluated gradient at the current state.
-- TODO change stepWithGradFn(s) to use this fn and its type
-- note: continue to use floats throughout the code, since gloss uses floats
-- the autodiff library requires that objective functions be polymorphic with Floating a
-- M-^ = delete indentation
timeAndGrad :: (Show b, Ord b, RealFloat b, Floating b, Real b) => ObjFn1 a -> b -> [b] -> (b, [b])
timeAndGrad f t state = tr "timeAndGrad: " (timestep, gradEval)
            where gradF :: GradFn a
                  gradF = appGrad f
                  gradEval = gradF state
                  -- Use line search to find a good timestep.
                  -- Redo if it's NaN, defaulting to 0 if all NaNs. TODO
                  descentDir = negL gradEval
                  -- timestep :: Floating c => c
                  timestep = if not linesearch then t else -- use a fixed timestep for debugging
                             let resT = awLineSearch f duf descentDir state in
                             if isNaN resT then tr "returned timestep is NaN" nanSub else resT
                  -- directional derivative at u, where u is the negated gradient in awLineSearch
                  -- descent direction need not have unit norm
                  -- we could also use a different descent direction if desired
                  duf :: (Show a, Ord a, Floating a, Real a) => [a] -> [a] -> a
                  duf u x = gradF x `dotL` u

-- Parameters for Armijo-Wolfe line search
-- NOTE: must maintain 0 < c1 < c2 < 1
c1 :: Floating a => a
c1 = 0.4 -- for Armijo, corresponds to alpha in backtracking line search (see below for explanation)
-- smaller c1 = shallower slope = less of a decrease in fn value needed = easier to satisfy
-- turn Armijo off: c1 = 0

c2 :: Floating a => a
c2 = 0.2 -- for Wolfe, is the factor decrease needed in derivative value
-- new directional derivative value / old DD value <= c2
-- smaller c2 = smaller new derivative value = harder to satisfy
-- turn Wolfe off: c1 = 1 (basically backatracking line search onlyl

infinity :: Floating a => a
infinity = 1/0 -- x/0 == Infinity for any x > 0 (x = 0 -> Nan, x < 0 -> -Infinity)
-- all numbers are smaller than infinity except infinity, to which it's equal

negInfinity :: Floating a => a
negInfinity = -infinity

isInfinity x = (x == infinity)
isNegInfinity x = (x == negInfinity)

-- Implements Armijo-Wolfe line search as specified in Keenan's notes, converges on nonconvex fns as well
-- based off Lewis & Overton, "Nonsmooth optimization via quasi-Newton methods", page TODO
-- duf = D_u(f), the directional derivative of f at descent direction u
-- D_u(x) = <gradF(x), u>. If u = -gradF(x) (as it is here), then D_u(x) = -||gradF(x)||^2
-- TODO summarize algorithm
-- TODO what happens if there are NaNs in awLineSearch? or infinities
awLineSearch :: (Floating b, Ord b, Show b, Real b) => ObjFn1 a -> ObjFn2 a -> [b] -> [b] -> b
awLineSearch f duf_noU descentDir x0 =
             -- results after a&w are satisfied are junk and can be discarded
             -- drop while a&w are not satisfied OR the interval is large enough
     let (af, bf, tf) = head $ dropWhile intervalOK_or_notArmijoAndWolfe
                              $ iterate update (a0, b0, t0) in tf
          where (a0, b0, t0) = (0, infinity, 1)
                duf = duf_noU descentDir
                update (a, b, t) =
                       let (a', b', sat) = if not $ armijo t then tr' "not armijo" (a, t, False)
                                           else if not $ weakWolfe t then tr' "not wolfe" (t, b, False)
                                           -- remember to change both wolfes
                                           else (a, b, True) in
                       if sat then (a, b, t) -- if armijo and wolfe, then we use (a, b, t) as-is
                       else if b' < infinity then tr' "b' < infinity" (a', b', (a' + b') / 2)
                       else tr' "b' = infinity" (a', b', 2 * a')
                intervalOK_or_notArmijoAndWolfe (a, b, t) = not $
                      if armijo t && weakWolfe t then -- takes precedence
                           tr ("stop: both sat. |-gradf(x0)| = " ++ show (norm descentDir)) True
                      else if abs (b - a) < minInterval then
                           tr ("stop: interval too small. |-gradf(x0)| = " ++ show (norm descentDir)) True
                      else False -- could be shorter; long for debugging purposes
                armijo t = (f ((tr' "** x0" x0) +. t *. (tr' "descentDir" descentDir))) <= ((tr' "fAtX0"fAtx0) + c1 * t * (tr' "dufAtX0" dufAtx0))
                strongWolfe t = abs (duf (x0 +. t *. descentDir)) <= c2 * abs dufAtx0
                weakWolfe t = duf_x_tu >= (c2 * dufAtx0) -- split up for debugging purposes
                          where duf_x_tu = tr' "Duf(x + tu)" (duf (x0 +. t' *. descentDir'))
                                t' = tr' "t" t
                                descentDir' = descentDir --tr' "descentDir" descentDir
                dufAtx0 = duf x0 -- cache some results, can cache more if needed
                fAtx0 =f x0 -- TODO debug why NaN. even using removeNaN' didn't help
                minInterval = if intervalMin then 10 ** (-10) else 0
                -- stop if the interval gets too small; might not terminate

------------------------ ### frequently-changed params for debugging

objsInit = []

-- Flags for debugging the surrounding functions.
clampflag = False
debug = False
debugLineSearch = False
debugObj = False -- turn on/off output in obj fn or constraint
constraintFlag = True
objFnOn = True -- turns obj function on or off in exterior pt method (for debugging constraints only)
constraintFnOn = True -- TODO need to implement constraint fn synthesis

type ObjFnPenalty a = forall a . (Show a, Floating a, Ord a, Real a) => a -> [a] -> [a] -> a
-- needs to be partially applied with the current list of objects
-- this type is only for the TOP-LEVEL synthesized objective function, not for any of the ones that people write
type ObjFnPenaltyState a = forall a . (Show a, Floating a, Ord a, Real a) => [Obj] -> a -> [a] -> [a] -> a

-- TODO should use objFn as a parameter
objFnPenalty :: ObjFnPenalty a
objFnPenalty weight = combineObjfns objFnUnconstrained weight
             where objFnUnconstrained :: Floating a => ObjFn2 a
                --    objFnUnconstrained = centerObjs -- centerAndRepel
                   objFnUnconstrained = centerAndRepel

-- if the list of constraints is empty, it behaves as unconstrained optimization
boundConstraints :: Constraints
boundConstraints = [] -- first_two_objs_box

weightGrowth :: Floating a => a -- for EP weight
weightGrowth = 10

epStop :: Floating a => a -- for EP diff
epStop = 10 ** (-3)

-- for use in barrier/penalty method (interior/exterior point method)
-- seems if the point starts in interior + weight starts v small and increases, then it converges
-- not quite... if the weight is too small then the constraint will be violated
initWeight :: Floating a => a
initWeight = 10 ** (-5)



stopEps :: Floating a => a
stopEps = 10 ** (-1)

------------ Various constants and helper functions related to objective functions

epsd :: Floating a => a -- to prevent 1/0 (infinity). put it in the denominator
epsd = 10 ** (-10)

objText = "objective: center all sets; center all labels in set"
constrText = "constraint: satisfy constraints specified in Substance program"

-- separates fixed parameters (here, size) from varying parameters (here, location)
-- ObjFn2 has two parameters, ObjFn1 has one (partially applied)
type ObjFn2 a = forall a . (Show a, Ord a, Floating a, Real a) => [a] -> [a] -> a

linesearch = True -- TODO move these parameters back
intervalMin = True -- true = force linesearch halt if interval gets too small; false = no forced halt

sumMap :: Floating b => (a -> b) -> [a] -> b -- common pattern in objective functions
sumMap f l = sum $ map f l

-------------- Sample bound constraints

-- TODO test bound constraints with EP, keep separate and formally build in if it doesn't work
-- TODO add more constraints for testing

-- x-coord of first object's center in [-300,-200], y-coord of first object's center in [0, 200]
first_two_objs_box :: Constraints
first_two_objs_box = [(0, (-300, -100)), (1, (0, 200)), (4, (100, 300)), (5, (-100, -400))]

-------------- Objective functions

-- simple test function
minx1 :: ObjFn2 a -- timestep t
minx1 _ xs = if length xs == 0 then error "minx1 empty list" else (head xs)^2

-- only center the first object (for debugging). NOTE: need to pass in parameters in the right order
centerObjNoSqrt :: ObjFn2 a
centerObjNoSqrt _ (x1 : y1 : _) = x1^2 + y1^2 -- sum $

-- center both objects without sqrt
centerObjsNoSqrt :: ObjFn2 a
centerObjsNoSqrt _ = sumMap (^2)

centerx1Sqrt :: ObjFn2 a -- discontinuous, timestep = 100 * t. autodiff behaves differently for this vs abs
centerx1Sqrt _ (x1 : _) = sqrt $ x1^2

-- lot of "interval too small"s happening with the objfns on lists now
centerObjs :: ObjFn2 a -- with sqrt
centerObjs fixed = sqrt . (centerObjsNoSqrt fixed)

-- Repel two objects
repel2 :: ObjFn2 a
repel2 _ [x1, y1, x2, y2] = 1 / ((x1 - x2)^2 + (y1 - y2)^2 + epsd)

-- pairwise repel on a list of objects (by distance b/t their centers)
repelCenter :: ObjFn2 a
repelCenter _ locs = sumMap (\x -> 1 / (x + epsd)) denoms
                 where denoms = map diffSq allPairs
                       diffSq [[x1, y1], [x2, y2]] = (x1 - x2)^2 + (y1 - y2)^2
                       allPairs = filter (\x -> length x == 2) $ subsequences objs
                       -- TODO implement more efficient version. also, subseq only returns *unique* subseqs
                       objs = chunksOf 2 locs

-- does not deal with labels
centerAndRepel :: ObjFn2 a -- timestep t
centerAndRepel fixed varying = centerObjsNoSqrt fixed varying + weight * repelCenter fixed varying
                   where weight = 10 ** (9.8) -- TODO calculate this weight as a function of radii and bbox

-- pairwise repel on a list of objects (by distance b/t their centers)
-- TODO: version of above function that separates fixed parameters (size) from varying parameters (location)
-- assuming 1 size for each two locs, and s1 corresponds to x1, y1 (and so on)
repelDist :: ObjFn2 a
repelDist sizes locs = sumMap (\x -> 1 / (x + epsd)) denoms
                 where denoms = map diffSq allPairs
                       diffSq [[x1, y1, s1], [x2, y2, s2]] = (x1 - x2)^2 + (y1 - y2)^2 - s1 - s2
                       allPairs = filter (\x -> length x == 2) $ subsequences objs
                       objs = zipWith (++) locPairs sizes'
                       (sizes', locPairs) = (map (\x -> [x]) sizes, chunksOf 2 locs)

-- attempts to account for the radii of the objects
-- currently, they repel each other "too much"--want them to be as centered as possible
-- not sure whether to use sqrt or not
-- try multiple objects?
centerAndRepel_dist :: ObjFn2 a
centerAndRepel_dist fixed varying = centerObjsNoSqrt fixed varying + weight * (repelDist fixed varying)
       where weight = 10 ** 10

-----

doNothing :: ObjFn2 a -- for debugging
doNothing _ _ = 0

nonDifferentiable :: ObjFn2 a
nonDifferentiable sizes locs = let q = head locs in
                  -- max q 0
                  abs q -- actually works fine with the line search

-- TODO these need separate pack/unpack functions because they change the sizes. these don't currently work
grow2 :: ObjFn2 a
grow2 _ [_, _, s1, _, _, s2] = 1 / (s1 + epsd) + 1 / (s2 + epsd)

grow :: ObjFn2 a
grow _ varying = sumMap (\x -> 1 / (x + epsd)) $ varying

-- TODO this needs to use the set size info. hardcode radii for now
-- TODO to use "min rad rad1" we need to add "Ord a" to the type signatures everywhere
-- we want the distance between the sets to be <overlap> less than having them just touch
-- this isn't working? and isn't resampling?
-- also i'm getting interval shrinking problems just with this function (using 'distance' only)
setsIntersect2 :: ObjFn2 a
setsIntersect2 sizes [x1, y1, x2, y2] = (dist (x1, y1) (x2, y2) - overlap)^2
              where overlap = rad + rad1 - 0.5 * rad1 -- should be "min rad rad1"

------ Objective function to place a label either inside of or right outside of a set

eps' :: Floating a => a
eps' = 60 -- why is this 100??

-- two parabolas, one at f(d) = d^2 and one at f(d) = (d-c)^2, intersecting at c/2
-- (i could try making the first one bigger and solving for the new intersection pt if i want the threshold
-- to be greater than (r + margin)/2

-- note: whenever an objective function has a partial derivative that might be fractional,
-- and vary in the denominator, need to add epsilon to denominator to avoid 1/0, or avoid it altogether
-- e.g. f(x) = sqrt(x) -> f'(x) = 1/(2sqrt(x))
-- in the first branch, we square the distance, because the objective there is to minimize the distance (resulting in 1/0).
-- in the second branch, the objective is to keep the distance at (r_set + margin), not at 0--so there’s no NaN in the denominator
centerOrRadParabola2 :: Bool -> ObjFn2 a
centerOrRadParabola2 inSet [r_set, _] [x1, y1, x2, y2] =
                     if dsq <= r_set^2 then dsq
                     else (if inSet then dsq else coeff * (d - const)^2) -- false -> can lay it outside as well
                     where d = dist (x1, y1) (x2, y2) -- + epsd
                           dsq = distsq (x1, y1) (x2, y2) -- + epsd
                           coeff = r_set^2 / (r_set - const)^2 -- chosen s.t. parabolas intersect at r
                           const = r_set + margin -- second parabola's zero
                           margin = if r_set <= 30 then 30 else 60  -- distance from edge of set (as a fn of r)
                           -- we want r to be close to r_set+margin, otherwise if r is small it converges slowly?

-- NOTE: assumes that object and label are exactly contiguous in list: sizes of [o1, l1, o2, l2...]
-- and locs: [x_o1, y_o1, x_l1, y_l1, x_o2, y_o2, x_l2, y_l2...]
-- TODO abstract out repelDist / labelSum pattern
labelSum :: Bool -> ObjFn2 a
labelSum inSet objLabelSizes objLabelLocs =
               let objLabelSizes' = chunksOf 2 objLabelSizes in
               let objLabelLocs' = chunksOf 4 objLabelLocs in
               sumMap (\(sizes, locs) -> centerOrRadParabola2 inSet sizes locs) (zip objLabelSizes' objLabelLocs')

------

-- TODO: label-only obj fns don't work out-of-the-box with set-only obj fns since they do unpacking differently

-- Start composing set-wise functions (centerAndRepel) with set-label functions (labelSum)
-- Sets repel each other, labels repel each other, and sets are labeled
-- TODO non-label sets should repel those labels
-- TODO resample initial state s.t. labels start inside the set (the centerOrRad is mostly useful if there are other objects inside the set that might repel the label)
-- TODO abstract out the unpacking functions here and factor out the weights
centerRepelLabel :: ObjFn2 a
centerRepelLabel olSizes olLocs =
                 centerAndRepel oSizes oLocs + weight * repelCenter lSizes lLocs + labelSum inSet olSizes olLocs
                 where (oSizes, lSizes) = (map fst zippedSizes, map snd zippedSizes)
                       zippedSizes = map (\[obj, lab] -> (obj, lab)) $ chunksOf 2 olSizes
                       (oLocs, lLocs) = (concatMap fst zippedLocs, concatMap snd zippedLocs)
                       zippedLocs = map (\[xo, yo, xl, yl] -> ([xo, yo], [xl, yl])) $ chunksOf 4 olLocs
                       weight = 10 ** 6
                       inSet = True -- label only in set vs. in or at radius


---------------- Exterior point method functions
-- Given an objective function and a list of constraints (phrased in terms of violations on a list of floats),
-- combines them using the penalty method (parametrized by a constraint weight over the sum of the constraints,
-- & individual normalizing weights on each constraint). Returns the corresponding unconstrained objective fn,
-- for use in unconstrained opt with line search.

-- PAIRWISE constraint functions that return the magnitude of violation
-- same type as ObjFn2; more general than PairConstrV
type StateConstrV a = forall a . (Floating a, Ord a, Show a) => [a] -> [a] -> a
type PairConstrV a = forall a . (Floating a, Ord a, Show a) => [[a]] -> a -- takes pairs of "packed" objs

noConstraint :: PairConstrV a
noConstraint _ = 0

-- To convert your inequality constraint into a violation to be penalized:
-- it needs to be in the form "c < 0" and c is the violation penalized if > 0
-- so e.g. if you want "x < -100" then you would convert it to "x + 100 < 0" with c = x + 100
-- if you want "f x > -100" then you would convert it to "-(f x + 100) < 0" with c = -(f x + 100)"

-- all sets must pairwise-strict-intersect
-- plus an offset so they overlap by a visible amount (perhaps this should be an optimization parameter?)
looseIntersect :: PairConstrV a
looseIntersect [[x1, y1, s1], [x2, y2, s2]] = let offset = 10 in
        if s1 + s2 < offset then error "radii too small"  --TODO: make it const
        else dist (x1, y1) (x2, y2) - (s1 + s2 - offset)

-- the energy actually increases so it always settles around the offset
-- that's because i am centering all of them--test w/objective off
-- TODO flatten energy afterward, or get it to be *far* from the other set
-- offset so the sets differ by a visible amount
noSubset :: PairConstrV a
noSubset [[x1, y1, s1], [x2, y2, s2]] = let offset = 10 in -- max/min dealing with s1 > s2 or s2 < s1
         -(dist (x1, y1) (x2, y2)) + max s2 s1 - min s2 s1 + offset

-- the first set is the subset of the second, and thus smaller than the second in size.
-- TODO: test for equal sets
-- TODO: for two primitives we have 4 functions, which is not sustainable. NOT NEEDED, remove them.
strictSubset :: PairConstrV a
strictSubset [[x1, y1, s1], [x2, y2, s2]] = dist (x1, y1) (x2, y2) - (s2 - s1)

-- exterior point method constraint: no intersection (meaning also no subset)
noIntersectExt :: PairConstrV a
noIntersectExt [[x1, y1, s1], [x2, y2, s2]] = -(dist (x1, y1) (x2, y2)) + s1 + s2

pointInExt :: PairConstrV a
pointInExt [[x1, y1], [x2, y2, r]] = dist (x1, y1) (x2, y2) - 0.5 * r

pointNotInExt :: PairConstrV a
pointNotInExt [[x1, y1], [x2, y2, r]] = - dist (x1, y1) (x2, y2) + r

-- exterior point method: penalty function
penalty :: (Ord a, Floating a, Show a) => a -> a
penalty x = (max x 0) ^ q -- weights should get progressively larger in cr_dist
            where q = 2 -- also, may need to sample OUTSIDE feasible set

-- for each pair, for each constraint on that pair, compose w/ penalty function and sum
-- TODO add vector of normalization constants for each constraint
pairToPenalties :: PairConstrV a
pairToPenalties pair = sum $ map (\((f, w), p) -> w * (penalty $ f p)) $ zip pairConstrVs (repeat pair)

-- sum penalized violations of each constraint on the whole state
stateConstrsToObjfn :: ObjFn2 a
stateConstrsToObjfn fixed varying = sum $ map (\((f, w), (fix, vary)) -> w * (penalty $ f fix vary))
                    $ zip stateConstrVs (repeat (fixed, varying))

-- the overall penalty function is the sum m (unweighted)
-- generate all unique pairs of objs and sum the penalized violation on each pair
pairConstrsToObjfn :: ObjFn2 a
pairConstrsToObjfn sizes locs = sumMap pairToPenalties allPairs
                 where -- generates all *unique* pairs (does not generate e.g. (o1, o2) and (o2, o1))
                       allPairs = filter (\x -> length x == 2) $ subsequences objs
                       objs = zipWith (++) locPairs sizes'
                       (sizes', locPairs) = (map (\x -> [x]) sizes, chunksOf 2 locs)

-- add the obj fn value to all penalized violations of constraints
-- note that a high weight may result in an "ill-conditioned hessian" with high differences b/t eigenvalues
-- with which the line search and stopping conditions may have trouble
-- https://www.researchgate.net/post/What_is_stopping_criteria_of_any_optimization_algorithm
combineObjfns :: ObjFn2 a -> ObjFnPenalty a
combineObjfns objfn weight fixed varying = -- input objfn is unconstrained
             (if objFnOn then tro "obj val" $ objWeight * objfn fixed varying else 0)
             + (if constraintFnOn then tro "penalty val" $
                   weight * (pairConstrsToObjfn fixed varying + stateConstrsToObjfn fixed varying)
                else 0)
             where objWeight = 1

-- constraint functions that act on the entire state
-- this one just acts on the first object and ignores the fixed params
firstObjInBbox :: (Floating a, Ord a, Show a) => (a, a, a, a) -> [([a] -> [a] -> a, a)]
firstObjInBbox (l, r, b, t) = [(leftBound, 1), (rightBound, 1), (botBound, 1), (topBound, 1)]
               where leftBound fixed (x1 : _ : _) = -(x1 - l)
                     leftBound _ _ = error "not enough floats in state to apply constr function firstObjInBbox"
                     rightBound fixed (x1 : _ : _) = x1 - r
                     botBound fixed (_ : y1 : _) = -(y1 - b)
                     topBound fixed (_ : y1 : _) = y1 - t

stateConstrVs :: (Floating a, Ord a, Show a) => [([a] -> [a] -> a, a)] -- constr, constr weight
stateConstrVs = -- firstObjInBbox (leftb, rightb, botb, topb)
                -- ++ firstObjInBbox (-pw2', pw2', -ph2', ph2') -- first object in viewport, TODO for all objs
                [] -- TODO add more

-- Parameter to modify (TODO move it to other section)
-- [PairConstrV a] is not allowed b/c impredicative types
pairConstrVs :: (Floating a, Ord a, Show a) => [([[a]] -> a, a)] -- constr, constr weight
pairConstrVs = [(noSubset, 1)]

-- It's not clear what happens with contradictory constraints like these:
-- It looks like one pair satisfies strict subset, and the other pairs all intersect
-- pairConstrVs = [(strictSubset, 1), (noIntersectExt, 1)]

-- Corners for hard-coded bounding box constraint.
leftb :: Floating a => a
leftb = -200

rightb :: Floating a => a
rightb = 100

botb :: Floating a => a
botb = 0

topb :: Floating a => a
topb = 200
