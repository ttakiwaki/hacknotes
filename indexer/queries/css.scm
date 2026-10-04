; Imports for .css (IMPORTS step only: no symbol definitions).
; @import "..." and @import url("...") forms. The url() function name
; is captured so the C++ side can require it (see html.scm note about
; text predicates).

(import_statement
  (string_value) @imp.path)

(call_expression
  (function_name) @imp.key
  (arguments (string_value) @imp.path))
