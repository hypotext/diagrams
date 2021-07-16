//#region ErrorTypes

import { ASTNode, Identifier, SourceLoc } from "./ast";
import { TypeConstructor, Prop, TypeVar, Arg } from "./domain";
import { BindingForm, Path } from "./style";
import { SubExpr, Deconstructor, TypeConsApp } from "./substance";

// type PenroseError = LanguageError | RuntimeError;
// type LanguageError = DomainError | SubstanceError | StyleError | PluginError;
// type RuntimeError = OptimizerError | EvaluatorError;
// type StyleError = StyleParseError | StyleCheckError | TranslationError;
export type PenroseError =
  | (DomainError & { errorType: "DomainError" })
  | (SubstanceError & { errorType: "SubstanceError" })
  | (StyleError & { errorType: "StyleError" });

export type Warning = StyleError;
export type StyleErrors = StyleError[];

// TODO: does type var ever appear in Substance? If not, can we encode that at the type level?
export type SubstanceError =
  | ParseError
  | DuplicateName
  | TypeNotFound
  | TypeVarNotFound
  | TypeMismatch
  | ArgLengthMismatch
  | TypeArgLengthMismatch
  | VarNotFound
  | DeconstructNonconstructor
  | UnexpectedExprForNestedPred
  | FatalError; // TODO: resolve all fatal errors in the Substance module

export type DomainError =
  | ParseError
  | TypeDeclared
  | TypeVarNotFound
  | TypeNotFound
  | DuplicateName
  | CyclicSubtypes
  | NotTypeConsInSubtype
  | NotTypeConsInPrelude;

export interface UnexpectedExprForNestedPred {
  tag: "UnexpectedExprForNestedPred";
  sourceType: TypeConstructor;
  sourceExpr: ASTNode;
  expectedExpr: ASTNode;
}

export interface CyclicSubtypes {
  tag: "CyclicSubtypes";
  cycles: string[][];
}
export interface NotTypeConsInPrelude {
  tag: "NotTypeConsInPrelude";
  type: Prop | TypeVar;
}

export interface NotTypeConsInSubtype {
  tag: "NotTypeConsInSubtype";
  type: Prop | TypeVar;
}
export interface TypeDeclared {
  tag: "TypeDeclared";
  typeName: Identifier;
}
export interface DuplicateName {
  tag: "DuplicateName";
  name: Identifier;
  location: ASTNode;
  firstDefined: ASTNode;
}
export interface TypeVarNotFound {
  tag: "TypeVarNotFound";
  typeVar: TypeVar;
}
export interface TypeNotFound {
  tag: "TypeNotFound";
  typeName: Identifier;
  possibleTypes?: Identifier[];
}
export interface VarNotFound {
  tag: "VarNotFound";
  variable: Identifier;
  possibleVars?: Identifier[];
}

export interface TypeMismatch {
  tag: "TypeMismatch";
  sourceType: TypeConstructor;
  expectedType: TypeConstructor;
  sourceExpr: ASTNode;
  expectedExpr: ASTNode;
}
export interface ArgLengthMismatch {
  tag: "ArgLengthMismatch";
  name: Identifier;
  argsGiven: SubExpr[];
  argsExpected: Arg[];
  sourceExpr: ASTNode;
  expectedExpr: ASTNode;
}

export interface TypeArgLengthMismatch {
  tag: "TypeArgLengthMismatch";
  sourceType: TypeConstructor;
  expectedType: TypeConstructor;
  sourceExpr: ASTNode;
  expectedExpr: ASTNode;
}

export interface DeconstructNonconstructor {
  tag: "DeconstructNonconstructor";
  deconstructor: Deconstructor;
}

// NOTE: for debugging purposes
export interface FatalError {
  tag: "Fatal";
  message: string;
}

// NOTE: aliased to ASTNode for now, can include more types for different errors
export type ErrorSource = ASTNode;

//#endregion

//#region Style errors

export type StyleError =
  // Misc errors
  | ParseError
  | GenericStyleError
  | StyleErrorList
  // Selector errors (from Substance)
  | SelectorDeclTypeError
  | SelectorVarMultipleDecl
  | SelectorDeclTypeMismatch
  | SelectorRelTypeMismatch
  | TaggedSubstanceError
  // Block static errors
  | InvalidGPITypeError
  | InvalidGPIPropertyError
  | InvalidFunctionNameError
  | InvalidObjectiveNameError
  | InvalidConstraintNameError
  // Translation errors (deletion)
  | DeletedPropWithNoSubObjError
  | DeletedPropWithNoFieldError
  | DeletedPropWithNoGPIError
  | CircularPathAlias
  | DeletedNonexistentFieldError
  | DeletedVectorElemError
  // Translation errors (insertion)
  | InsertedPathWithoutOverrideError
  | InsertedPropWithNoFieldError
  | InsertedPropWithNoGPIError
  // Translation validation errors
  | NonexistentNameError
  | NonexistentFieldError
  | NonexistentGPIError
  | NonexistentPropertyError
  | ExpectedGPIGotFieldError
  | InvalidAccessPathError
  // Runtime errors
  | RuntimeValueTypeError;

export type StyleWarning = IntOrFloat;

export type StyleWarnings = StyleWarning[];

export interface StyleResults {
  errors: StyleErrors;
  warnings: StyleWarnings;
}

export interface IntOrFloat {
  tag: "IntOrFloat";
  message: string;
} // COMBAK: Use this in block checking

export interface GenericStyleError {
  tag: "GenericStyleError";
  messages: string[];
}

export interface StyleErrorList {
  tag: "StyleErrorList";
  errors: StyleError[];
}

export interface ParseError {
  tag: "ParseError";
  message: string;
  location?: SourceLoc;
}

export interface SelectorDeclTypeError {
  tag: "SelectorDeclTypeError";
  typeName: Identifier;
}

export interface SelectorVarMultipleDecl {
  tag: "SelectorVarMultipleDecl";
  varName: BindingForm;
}

export interface SelectorDeclTypeMismatch {
  tag: "SelectorDeclTypeMismatch";
  subType: TypeConsApp;
  styType: TypeConsApp;
}

export interface SelectorRelTypeMismatch {
  tag: "SelectorRelTypeMismatch";
  varType: TypeConsApp;
  exprType: TypeConsApp;
}

export interface TaggedSubstanceError {
  tag: "TaggedSubstanceError";
  error: SubstanceError;
}

//#region Block statics

export interface InvalidGPITypeError {
  tag: "InvalidGPITypeError";
  givenType: Identifier;
  // expectedType: string;
}

export interface InvalidGPIPropertyError {
  tag: "InvalidGPIPropertyError";
  givenProperty: Identifier;
  expectedProperties: string[];
}

export interface InvalidFunctionNameError {
  tag: "InvalidFunctionNameError";
  givenName: Identifier;
  // expectedName: string;
}

export interface InvalidObjectiveNameError {
  tag: "InvalidObjectiveNameError";
  givenName: Identifier;
  // expectedName: string;
}

export interface InvalidConstraintNameError {
  tag: "InvalidConstraintNameError";
  givenName: Identifier;
  // expectedName: string;
}

//#endregion Block statics

export interface DeletedPropWithNoSubObjError {
  tag: "DeletedPropWithNoSubObjError";
  subObj: BindingForm;
  path: Path;
}

export interface DeletedPropWithNoFieldError {
  tag: "DeletedPropWithNoFieldError";
  subObj: BindingForm;
  field: Identifier;
  path: Path;
}

export interface CircularPathAlias {
  tag: "CircularPathAlias";
  path: Path;
}

export interface DeletedPropWithNoGPIError {
  tag: "DeletedPropWithNoGPIError";
  subObj: BindingForm;
  field: Identifier;
  property: Identifier;
  path: Path;
}

export interface DeletedNonexistentFieldError {
  tag: "DeletedNonexistentFieldError";
  subObj: BindingForm;
  field: Identifier;
  path: Path;
}

export interface DeletedVectorElemError {
  tag: "DeletedVectorElemError";
  path: Path;
}

export interface InsertedPathWithoutOverrideError {
  tag: "InsertedPathWithoutOverrideError";
  path: Path;
}

export interface InsertedPropWithNoFieldError {
  tag: "InsertedPropWithNoFieldError";
  subObj: BindingForm;
  field: Identifier;
  property: Identifier;
  path: Path;
}

export interface InsertedPropWithNoGPIError {
  tag: "InsertedPropWithNoGPIError";
  subObj: BindingForm;
  field: Identifier;
  property: Identifier;
  path: Path;
}

//#region Translation validation errors

export interface NonexistentNameError {
  tag: "NonexistentNameError";
  name: Identifier;
  path: Path;
}

export interface NonexistentFieldError {
  tag: "NonexistentFieldError";
  field: Identifier;
  path: Path;
}

export interface NonexistentGPIError {
  tag: "NonexistentGPIError";
  gpi: Identifier;
  path: Path;
}

export interface NonexistentPropertyError {
  tag: "NonexistentPropertyError";
  property: Identifier;
  path: Path;
}

export interface ExpectedGPIGotFieldError {
  tag: "ExpectedGPIGotFieldError";
  field: Identifier;
  path: Path;
}

export interface InvalidAccessPathError {
  tag: "InvalidAccessPathError";
  path: Path;
}

//#endregion Translation validation errors

// TODO(errors): use identifiers here
export interface RuntimeValueTypeError {
  tag: "RuntimeValueTypeError";
  path: Path;
  expectedType: string;
  actualType: string;
}

//#endregion Style errors
