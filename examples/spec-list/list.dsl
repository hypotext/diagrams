-- Main program
type Vertex
predicate IsConnected: Vertex * Vertex^n

-- Misc parser tests (should work)
type Edge
function scale: Edge^n c * Vertex^x v -> Vector^abcd cv
predicate Test: Edge^n * Edge^m

-- Should not parse
-- type Edge^n
-- predicate Bad^n: Vertex

-- Should not typecheck
-- (name clashes)
-- predicate Bad1: Edge^Vertex
-- predicate Bad2: Edge^IsConnected
-- predicate isConnected: Vertex c * Vertex^c