; Symbol definitions for .py (DEFINES step).
; Pattern order matters: parse.cpp maps pattern index -> node type.
;   0: function   1: class   2: lambda assigned to a name (-> function)
;   3: call site (no `new` in Python: constructors are plain calls)
;   4: from-import   5: import   6: aliased import

(function_definition
  name: (identifier) @sym.name) @sym.node

(class_definition
  name: (identifier) @sym.name) @sym.node

((assignment
   left: (identifier) @sym.name
   right: (lambda)) @sym.node)

(call
  function: [(identifier) @call.name
             (attribute attribute: (identifier) @call.name)]) @call.node

(import_from_statement
  module_name: [(dotted_name) (relative_import) (identifier)] @imp.path)

(import_statement
  name: [(dotted_name) (identifier)] @imp.path)

(import_statement
  name: (aliased_import
          name: [(dotted_name) (identifier)] @imp.path))
