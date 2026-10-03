; Symbol definitions for .ts/.tsx (DEFINES step).
; Pattern order matters: parse.cpp maps pattern index -> node type.
;   0: function   1: generator  2: class   3: arrow/function const (-> function)

(function_declaration
  name: (identifier) @sym.name) @sym.node

(generator_function_declaration
  name: (identifier) @sym.name) @sym.node

(class_declaration
  name: (type_identifier) @sym.name) @sym.node

(variable_declarator
  name: (identifier) @sym.name
  value: [(arrow_function) (function_expression)]) @sym.node
