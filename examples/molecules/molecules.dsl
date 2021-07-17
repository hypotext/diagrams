-- Atoms

type Atom

type Carbon
type Hydrogen
type Oxygen
type Nitrogen

Carbon <: Atom
Hydrogen <: Atom
Oxygen <: Atom
Nitrogen <: Atom

-- Bonds

type Bond

type SingleBond
type DoubleBond
type TripleBond

SingleBond <: Bond
DoubleBond <: Bond
TripleBond <: Bond

constructor MakeSingleBond : Atom a * Atom b -> SingleBond
constructor MakeDoubleBond : Atom a * Atom b -> DoubleBond
constructor MakeTripleBond : Atom a * Atom b -> TripleBond

-- Sugar

notation "A - B" ~ "MakeSingleBond(A, B)"
notation "A = B" ~ "MakeDoubleBond(A, B)"
notation "A ≡ B" ~ "MakeTripleBond(A, B)"
