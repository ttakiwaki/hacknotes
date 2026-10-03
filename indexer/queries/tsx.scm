; Symbol definitions for .ts/.tsx (DEFINES step).
; Pattern order matters: parse.cpp maps pattern index -> node type.
;   0: function   1: generator  2: class   3: arrow/function const (-> function)
;   4: call site  5: new-expression (constructor call)

(function_declaration
  name: (identifier) @sym.name) @sym.node

(generator_function_declaration
  name: (identifier) @sym.name) @sym.node

(class_declaration
  name: (type_identifier) @sym.name) @sym.node

(variable_declarator
  name: (identifier) @sym.name
  value: [(arrow_function) (function_expression)]) @sym.node

; Call sites: plain calls and method calls (by property name).
(call_expression
  function: [
    (identifier) @call.name
    (member_expression property: (property_identifier) @call.name)
  ]) @call.node

; Constructor calls: new Store() targets the class.
(new_expression
  constructor: (identifier) @call.name) @call.node
