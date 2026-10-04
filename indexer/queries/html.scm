; Imports for .html (IMPORTS step only: no symbol definitions).
; Captures href/src attribute values along with the attribute name;
; the C++ side keeps only href/src specs (the query engine in this
; build does not evaluate text predicates, so filtering happens there).

(attribute
  (attribute_name) @imp.key
  (attribute_value) @imp.path)

(attribute
  (attribute_name) @imp.key
  (quoted_attribute_value (attribute_value) @imp.path))
