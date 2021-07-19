@preprocessor typescript

# Lexer
@{%

/* eslint-disable */
import * as moo from "moo";
import { concat, compact, flatten, last } from 'lodash'
import { basicSymbols, rangeOf, rangeBetween, rangeFrom, nth, convertTokenId } from 'parser/ParserUtil'
import { ASTNode, Identifier, IStringLit  } from "types/ast";
import { StyT, DeclPattern, DeclPatterns, RelationPatterns, Namespace, Selector, StyProg, HeaderBlock, RelBind, RelPred, SEFuncOrValCons, SEBind, Block, IAnonAssign, Delete, IOverride, PathAssign, StyType, BindingForm, Path, ILayering, BinaryOp, Expr, IBinOp, SubVar, StyVar, IPropertyPath, IFieldPath, LocalVar, IAccessPath, IUOp, IList, ITuple, IVector, IBoolLit, IVary, IFix, ICompApp, IObjFn, IConstrFn, GPIDecl, PropertyDecl, 
} from "types/style";

const styleTypes: string[] =
  [ "scalar"
  , "int"
  , "bool"
  , "string"
  , "path"
  , "color"
  , "file"
  , "style"
  , "shape" // TODO: make sure this is the intended keyword
  , "vec2"
  , "vec3"
  , "vec4"
  , "mat2x2"
  , "mat3x3"
  , "mat4x4"
  , "function"
  , "objective"
  , "constraint"
  ];

// NOTE: ordering matters here. Top patterns get matched __first__
const lexer = moo.compile({
  ...basicSymbols,
  identifier: {
    match: /[A-z_][A-Za-z_0-9]*/,
    type: moo.keywords({
      // NOTE: the next line add type annotation keywords into the keyword set and thereby forbidding users to use keywords like `shape`
      // "type-keyword": styleTypes, 
      forall: "forall",
      where: "where",
      with: "with",
      delete: "delete",
      as: "as",
      true: "true",
      false: "false",
      layer: "layer",
      encourage: "encourage",
      ensure: "ensure",
      override: "override",
    })
  }
});

const nodeData = (children: ASTNode[]) => ({
  nodeType: "Style" as const,
  children
});

// Node constructors

const declList = (type: StyT, ids: BindingForm[]): DeclPattern[] => {
  const decl = (t: StyT, i: BindingForm): DeclPattern => ({
    ...nodeData([t, i]),
    ...rangeFrom([t, i]),
    tag: "DeclPattern",
    type: t,
    id: i 
  });
  return ids.map((i: BindingForm) => decl(type, i));
}

const selector = (
  hd: DeclPatterns,
  wth?: DeclPatterns,
  whr?: RelationPatterns,
): Selector => {
  return {
    ...nodeData(compact([hd, wth, whr])),
    ...rangeFrom(compact([hd, wth, whr])),
    tag: "Selector",
    head: hd,
    with: wth,
    where: whr,
  };
}

const layering = (kw: any, below: Path, above: Path): ILayering => ({
  ...nodeData([above, below]),
  ...rangeFrom(kw ? [rangeOf(kw), above, below] : [above, below]),
  tag: 'Layering', above, below
})

const binop = (op: BinaryOp, left: Expr, right: Expr): IBinOp => ({
  ...nodeData([left, right]),
  ...rangeBetween(left, right),
  tag: 'BinOp', op, left, right
})

%} # end of lexer

@lexer lexer

# Macros

# TODO: factor out sepEndBy
sepBy1[ITEM, SEP] -> $ITEM (_ $SEP _ $ITEM):* $SEP:? {% 
  d => { 
    const [first, rest] = [d[0], d[1]];
    if(rest.length > 0) {
      const restNodes = rest.map((ts: any[]) => ts[3]);
      return concat(first, ...restNodes);
    } else return first;
  }
%}

sepBy[ITEM, SEP] -> $ITEM:? (_ $SEP _ $ITEM):* {% 
  d => { 
    const [first, rest] = [d[0], d[1]];
    if(!first) return [];
    if(rest.length > 0) {
      const restNodes = rest.map(ts => ts[3]);
      return concat(first, ...restNodes);
    } else return first;
  }
%}

################################################################################
# Style Grammar
# NOTE: remember that parens in the grammar or EBNF operators (e.g. `:*`) will wrap an array around the result. 

# TODO: header_blocks gets called twice here. Investigate why
input -> _ml header_blocks {%
  ([, blocks]): StyProg => ({
    ...nodeData(blocks),
    ...rangeFrom(blocks),
    tag: "StyProg", blocks
  })
%}

header_blocks -> header_block:* {% id %}

header_block -> header block _ml {%
  ([header, block]): HeaderBlock => ({
    ...nodeData([header, block]), 
    ...rangeFrom([header, block]), 
    tag:"HeaderBlock", header, block 
  })
%}

################################################################################
# Selector grammar

header 
  -> selector  {% id %}
  |  namespace {% id %}

selector -> 
    forall:? decl_patterns _ml  
    {% (d) => selector(d[1], undefined, undefined) %}
  | forall:? decl_patterns _ml select_where 
    {% (d) => selector(d[1], undefined, d[3]) %} 
  | forall:? decl_patterns _ml select_with 
    {% (d) => selector(d[1], d[3], undefined)%}   
  | forall:? decl_patterns _ml select_where select_with 
    {% (d) => selector(d[1], d[4], d[3]) %} 
  | forall:? decl_patterns _ml select_with select_where 
    {% (d) => selector(d[1], d[3], d[4]) %} 

forall -> "forall" __ {% nth(0) %}

select_with -> "with" __ decl_patterns _ml {% d => d[2] %}

decl_patterns -> sepBy1[decl_list, ";"] {% 
  ([d]): DeclPatterns => {
    const contents = flatten(d) as DeclPattern[];
    return {
      ...nodeData([...contents]), 
      ...rangeFrom(contents),
      tag: "DeclPatterns", contents
    };
  }
%}

decl_list -> identifier __ sepBy1[binding_form, ","] {% 
  ([type, , ids]): DeclPattern[] => {
    return declList(type, ids);
  }
%}

select_where -> "where" __ relation_list _ml {% d => d[2] %}

relation_list -> sepBy1[relation, ";"]  {% 
  ([d]): RelationPatterns => ({
    ...nodeData([...d]), 
    ...rangeFrom(d),
    tag: "RelationPatterns",
    contents: d
  })
%}

relation
  -> rel_bind {% id %} 
  |  rel_pred {% id %}


rel_bind 
  -> binding_form _ ":=" _ sel_expr {% 
    ([id, , , , expr]): RelBind => ({
      ...nodeData([id, expr]),
      ...rangeFrom([id, expr]),
      tag: "RelBind", id, expr,
    })
  %}

rel_pred 
  -> identifier _ "(" pred_arg_list ")" __ml alias_as {% // aliasing case
    ([name, , , args, , , a]): RelPred => ({
        ...nodeData([name, ...args, a]),
        ...rangeFrom([name, ...args, a]),
        tag: "RelPred", name, args, alias: a
    })
  %} 
  | identifier _ "(" pred_arg_list ")" {% 
    ([name, , , args, ,]): RelPred => ({
        ...nodeData([name, ...args]),
        ...rangeFrom([name, ...args]),
        tag: "RelPred", name, args,
    })
  %} 

alias_as -> "as" __ identifier {% d => d[2] %} 

sel_expr_list 
  -> _ {% d => [] %}
  |  _ sepBy1[sel_expr, ","] _ {% nth(1) %}

sel_expr 
  -> identifier _ "(" sel_expr_list ")" {% 
    ([name, , , args, ]): SEFuncOrValCons => ({
      ...nodeData([name, ...args]), 
      ...rangeFrom([name, ...args]),
      tag: "SEFuncOrValCons",
      name, args
    }) 
  %}
  |  binding_form {% ([d]): SEBind => ({
      ...nodeData([d]),
      ...rangeFrom([d]), 
      tag: "SEBind", contents: d
    }) 
  %}

pred_arg_list 
  -> _ {% d => [] %}
  |  _ sepBy1[pred_arg, ","] _ {% nth(1) %}

# NOTE: resolve ambiguity here by allowing only rel_pred or `binding_form`
# Can't use sel_expr because sel_expr has valcons or func, which looks exactly the same as predicates. 
pred_arg 
  -> rel_pred {% id %}
  |  binding_form {% ([d]): SEBind => ({
      ...nodeData([d]),
      ...rangeFrom([d]), 
      tag: "SEBind", contents: d
    }) 
  %}

binding_form 
  -> subVar {% id %} 
  |  styVar {% id %}

# HACK: tokens like "`" don't really have start and end points, just line and col. How do you merge a heterogenrous list of tokens and nodes?
subVar -> "`" identifier "`" {%
  ([ltick, contents, rtick]): SubVar => ({ 
    ...nodeData([contents]), 
    ...rangeBetween(rangeOf(ltick), rangeOf(rtick)),
    tag: "SubVar", contents
  })
%}

styVar -> identifier {%
  ([contents]): StyVar => ({ 
    ...nodeData([contents]),
    ...rangeOf(contents), 
    tag: "StyVar", contents
  })
%}

# NOTE: do not expect more ws after namespace because it's already parsing them for standalone use

namespace -> styVar _ml {%
  ([contents]): Namespace => ({
    ...nodeData([contents]),
    ...rangeOf(contents),
    tag: "Namespace",
    contents
  })
%}

################################################################################
# Block grammar

block -> "{" statements "}" {% 
  ([lbrace, stmts, rbrace]): Block => ({
    ...nodeData(stmts),
    ...rangeBetween(lbrace, rbrace),
    tag: "Block",
    statements: stmts
  })
%}

statements
    # base case
    -> _ {% () => [] %} 
    # whitespaces at the beginning (NOTE: comments are allowed)
    |  _c_ nl statements {% nth(2) %} # 
    # spaces around each statement (NOTE: still wrap in list to spread later)
    |  _ statement _ {% d => [d[1]] %}
    # whitespaces in between and at the end (NOTE: comments are allowed)
    |  _ statement _c_ nl statements {% d => [d[1], ...d[4]] %}

statement 
  -> delete {% id %}
  |  override {% id %}
  |  path_assign {% id %}
  |  anonymous_expr {% ([contents]): IAnonAssign => 
    ({
      ...nodeData([contents]), 
      ...rangeOf(contents), 
      tag: "AnonAssign", contents
    }) 
  %}

delete -> "delete" __ path {%
  ([kw, , contents]): Delete => {
   return {
    ...nodeData([contents]),
    ...rangeBetween(rangeOf(kw), contents),
    tag: "Delete", contents
  }}
%}

override -> "override" __ path _ "=" _ assign_expr {%
  ([kw, , path, , , , value]): IOverride => ({ 
    ...nodeData([path, value]),
    ...rangeBetween(kw, value),
    tag: "Override", path, value
  })
%}

path_assign -> type:? __ path _ "=" _ assign_expr {%
  ([type, , path, , , , value]): PathAssign => ({ 
    ...nodeData(type ? [type, path, value] : [path, value]),
    ...rangeBetween(type ? type : path, value),
    tag: "PathAssign",
    type, path, value
  })
%}

type 
  -> identifier {% ([contents]): StyType => ({
      ...nodeData([contents]),
      ...rangeOf(contents),
      tag: 'TypeOf', contents
    }) 
  %}
  |  identifier "[]" {% ([contents]): StyType => ({
      ...nodeData([contents]),
      ...rangeOf(contents), 
      tag: 'ListOf', contents
    }) 
  %}

path 
  -> entity_path   {% id %}
  |  access_path   {% id %}

entity_path
  -> propertyPath  {% id %}
  |  fieldPath     {% id %}
  |  localVar      {% id %}

propertyPath -> binding_form "." identifier "." identifier {%
  ([name, , field, , property]): IPropertyPath => ({
    ...nodeData([name, field, property]),
    ...rangeFrom([name, field, property]),
    tag: "PropertyPath", name, field, property
  })
%}

fieldPath -> binding_form "." identifier {%
  ([name, , field]): IFieldPath => ({
    ...nodeData([name, field]),
    ...rangeFrom([name, field]),
    tag: "FieldPath", name, field
  })
%}

localVar -> identifier {%
  ([contents]): LocalVar => ({
    ...nodeData([contents]),
    ...rangeOf(contents),
    tag: "LocalVar", contents
  })
%}

# NOTE: not a subrule of entity_path so we can parse all indices into a list
# TODO: capture the range more accurately, now it's missing the last bracket
access_path -> entity_path _ access_ops {%
  ([path, , indices]): IAccessPath => {
    const lastIndex = last(indices);
    return {
      ...nodeData([path]), // TODO: model access op as an AST node to solve the range and child node issue
      ...rangeBetween(path, lastIndex),
      tag: "AccessPath", path, indices
    }
  }
%}

access_ops 
  -> access_op  
  |  access_op _ access_ops {% (d: any[]) => [d[0], ...d[2]] %}
access_op -> "[" _ expr _ "]" {% nth(2) %}

# Expression

# NOTE: all assign_expr can appear on the rhs of an assign statement, but not all can be, say, arguments of a computation/constraint. 
assign_expr 
  -> expr {% id %}
  |  layering {% id %}
  |  objective {% id %}
  |  constraint {% id %}
  |  gpi_decl {% id %}

anonymous_expr
  -> layering {% id %}
  |  objective {% id %}
  |  constraint {% id %}

# NOTE: inline computations on expr_literal (including expr_literal)
expr -> arithmeticExpr {% id %}

# Arith ops (NOTE: ordered in decreasing precedence)

# Parenthsized
parenthesized 
  -> "(" _ arithmeticExpr _ ")" {% nth(2) %}
  |  expr_literal               {% id %}

# Unary ops 
unary 
  -> "-" _ parenthesized  {% (d): IUOp => 
    ({
      ...nodeData([d[2]]),
      ...rangeBetween(d[0], d[2]),
      tag: 'UOp', op: "UMinus", arg: d[2]
    }) 
  %}
  |  parenthesized        {% id %}

# Exponents
factor 
  -> unary _ "^" _ factor {% (d): IBinOp => binop('Exp', d[0], d[4]) %}
  |  unary                {% id %}

# Multiplication and division
term 
  -> term _ "*" _ factor  {% (d): IBinOp => binop('Multiply', d[0], d[4]) %}
  |  term _ "/" _ factor  {% (d): IBinOp => binop('Divide', d[0], d[4]) %}
  |  factor               {% id %}

# Addition and subtraction
arithmeticExpr 
  -> arithmeticExpr _ "+" _ term {% (d): IBinOp => binop('BPlus', d[0], d[4]) %}
  |  arithmeticExpr _ "-" _ term {% (d): IBinOp => binop('BMinus', d[0], d[4]) %}
  |  term                        {% id %}

# NOTE: all of the expr_literal can be operands of inline computation 
expr_literal
  -> bool_lit {% id %}
  |  string_lit {% id %}
  |  annotated_float {% id %}
  |  computation_function {% id %}
  |  path {% id %}
  |  list {% id %}
  |  tuple {% id %}
  |  vector {% id %}
  # |  matrix {% id %} # NOTE: we liberally parse vectors to include the matrix case instead. All matrices are vectors of vectors.
  # TODO: 
  # |  transformExpr 

list -> "[" _ expr_list _ "]" {% 
  ([lbracket, , exprs, , rbracket]): IList => ({
    ...nodeData(exprs),
    ...rangeBetween(lbracket, rbracket),
    tag: 'List',
    contents: exprs
  })
%}

# NOTE: we only allow 2 tuples and enforce this rule during parsing
tuple -> "{" _ expr _ "," _ expr _ "}" {% 
  ([lbrace, , e1, , , , e2, , rbrace]): ITuple => ({
    ...nodeData([e1, e2]),
    ...rangeBetween(lbrace, rbrace),
    tag: 'Tuple',
    contents: [e1, e2]
  })
%}

# NOTE: the extra expr makes sure a vector will always have >1 components.
vector -> "(" _ expr  _ "," expr_list ")" {% 
  ([lparen, , first, , , rest, rparen]): IVector => ({
    ...nodeData([first, ...rest]),
    ...rangeBetween(lparen, rparen),
    tag: 'Vector',
    contents: [first, ...rest]
  })
%}

# NOTE: not used since `vector` will include this case. Actual type will be resolved by the compiler.
# matrix -> "(" _ sepBy1[vector, ","] _ ")" {% 
#   ([lparen, , exprs, , rparen]): IMatrix => ({
#     ...rangeBetween(lparen, rparen),
#     tag: 'Matrix',
#     contents: exprs
#   })
# %}

bool_lit -> ("true" | "false") {%
  ([[d]]): IBoolLit => ({
    ...nodeData([]),
    ...rangeOf(d),
    tag: 'BoolLit',
    contents: d.text === 'true' // https://stackoverflow.com/questions/263965/how-can-i-convert-a-string-to-boolean-in-javascript
  })
%}

string_lit -> %string_literal {%
  ([d]): IStringLit => ({
    ...nodeData([]),
    ...rangeOf(d),
    tag: 'StringLit',
    contents: d.value
  })
%}

annotated_float 
  -> "?" {% ([d]): IVary => ({ ...nodeData([]), ...rangeOf(d), tag: 'Vary' }) %}
  |  %float_literal {% 
    ([d]): IFix => ({ ...nodeData([]), ...rangeOf(d), tag: 'Fix', contents: parseFloat(d) }) 
  %}

layering
  -> layer_keyword:? path __ "below" __ path 
    {% (d): ILayering => layering(d[0], d[1], d[5]) %}
  |  layer_keyword:? path __ "above" __ path 
    {% (d): ILayering => layering(d[0], d[5], d[1]) %}

layer_keyword -> "layer" __ {% nth(0) %}

computation_function -> identifier _ "(" expr_list ")" {% 
  ([name, , , args, rparen]): ICompApp => ({
    ...nodeData([name, ...args]),
    ...rangeBetween(name, rparen),
    tag: "CompApp",
    name, args
  }) 
%}

objective -> "encourage" __ identifier _ "(" expr_list ")" {% 
  ([kw, , name, , , args, rparen]): IObjFn => ({
    ...nodeData([name, ...args]),
    ...rangeBetween(kw, rparen),
    tag: "ObjFn",
    name, args
  }) 
%}

constraint -> "ensure" __ identifier _ "(" expr_list ")" {% 
  ([kw, , name, , , args, rparen]): IConstrFn => ({
    ...nodeData([name, ...args]),
    ...rangeBetween(kw, rparen),
    tag: "ConstrFn",
    name, args
  }) 
%}

expr_list 
  -> _ {% d => [] %}
  |  _ sepBy1[expr, ","] _ {% nth(1) %}

gpi_decl -> identifier _ml "{" property_decl_list "}" {%
  ([shapeName, , , properties, rbrace]): GPIDecl => ({
    ...nodeData([shapeName, ...properties]),
    ...rangeBetween(shapeName, rbrace),
    tag: "GPIDecl",
    shapeName, properties
  })
%}

# TODO: maybe separate out as macro when stable (macros have really bad state ids tho!)
property_decl_list
    # base case
    -> _ {% () => [] %} 
    # whitespaces at the beginning (NOTE: comments are allowed)
    |  _c_ nl property_decl_list {% nth(2) %} # 
    # spaces around each decl (NOTE: still wrap in list to spread later)
    |  _ property_decl _ {% d => [d[1]] %}
    # whitespaces in between and at the end (NOTE: comments are allowed)
    |  _ property_decl _c_ nl property_decl_list {% d => [d[1], ...d[4]] %}
  
property_decl -> identifier _ ":" _ expr {%
  ([name, , , , value]): PropertyDecl => ({
    ...nodeData([name, value]),
    ...rangeBetween(name, value),
    tag: "PropertyDecl",
    name, value
  })
%}

# Common 

identifier -> %identifier {% 
  ([d]): Identifier => ({
    ...nodeData([]),
    ...rangeOf(d),
    tag: 'Identifier',
    value: d.text,
    type: styleTypes.includes(d.text) ? "type-keyword" : "identifier"
  })
%}

# white space definitions 

comment 
  -> %comment {% convertTokenId %}
  |  %multiline_comment {% ([d]) => rangeOf(d) %}

_c_ -> (%ws | comment):* 

_ml -> multi_line_ws_char:* 

__ml -> multi_line_ws_char:+

multi_line_ws_char
    -> %ws
    |  %nl
    | comment # skip comments

nl -> %nl

__ -> %ws:+ 

_ -> %ws:*
