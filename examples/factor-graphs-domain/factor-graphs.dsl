-- types
type Variable
type Factor

-- functions for unary, binary, ternary... factors
-- TODO function Unary: Variable name -> Factor
function Unary: Variable -> Factor
function Binary: Variable * Variable -> Factor
function Ternary: Variable * Variable * Variable -> Factor
