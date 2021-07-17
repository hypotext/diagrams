-- Nodes

type Node

type InputNode
type OutputNode

InputNode <: Node
OutputNode <: Node

-- Gates

type Component

type SplitComponent
type Gate

SplitComponent <: Component
Gate <: Component

type OneInputGate
type TwoInputGate

OneInputGate <: Gate
TwoInputGate <: Gate

constructor MakeSplitComponent : Node IN * Node OUT1 * Node OUT2 -> SplitComponent

type Buffer
type NOTGate

Buffer <: OneInputGate
NOTGate <: OneInputGate

constructor MakeBuffer : Node IN * Node OUT -> Buffer
constructor MakeNOTGate : Node IN * Node OUT -> NOTGate

type ORGate
type NORGate
type ANDGate
type NANDGate
type XORGate
type XNORGate

ORGate <: TwoInputGate
NORGate <: TwoInputGate
ANDGate <: TwoInputGate
NANDGate <: TwoInputGate
XORGate <: TwoInputGate
XNORGate <: TwoInputGate

constructor MakeORGate : Node IN1 * Node IN2 * Node OUT -> ORGate
constructor MakeNORGate : Node IN1 * Node IN2 * Node OUT -> NORGate
constructor MakeANDGate : Node IN1 * Node IN2 * Node OUT -> ANDGate
constructor MakeNANDGate : Node IN1 * Node IN2 * Node OUT -> NANDGate
constructor MakeXORGate : Node IN1 * Node IN2 * Node OUT -> XORGate
constructor MakeXNORGate : Node IN1 * Node IN2 * Node OUT -> XNORGate

-- Connections

type Connection

constructor MakeConnection : Node A * Node B -> Connection
