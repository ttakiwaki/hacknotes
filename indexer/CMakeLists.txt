cmake_minimum_required(VERSION 3.16)
project(indexer LANGUAGES C CXX)

# We fetch grammar sources download-only (see below): their own
# CMakeLists.txt files assume a top-level checkout and define colliding
# target names, so FetchContent_MakeAvailable cannot be used. CMP0169
# deprecates direct Populate calls; keep the OLD behavior explicitly.
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Emitted for clangd/nvim so the editor resolves third_party/ and
# tree-sitter includes the same way the build does.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# MVP0: system SQLite (C API, same SQL as amalgamation).
# Later: switch to SQLite amalgamation via FetchContent for reproducible builds.
find_package(SQLite3 REQUIRED)

include(FetchContent)

# tree-sitter core (C parsing library, ABI 15)
# NOTE: populated (download only) instead of MakeAvailable, because the
# grammar repo's own CMakeLists.txt assumes a top-level checkout and also
# defines colliding target names.
FetchContent_Declare(
  tree_sitter
  GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter.git
  GIT_TAG v0.25.9
)
FetchContent_Declare(
  tree_sitter_typescript
  GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter-typescript.git
  GIT_TAG v0.23.2
)
FetchContent_Declare(
  tree_sitter_javascript
  GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter-javascript.git
  GIT_TAG v0.25.0
)
FetchContent_Declare(
  tree_sitter_python
  GIT_REPOSITORY https://github.com/tree-sitter/tree-sitter-python.git
  GIT_TAG v0.25.0
)
FetchContent_GetProperties(tree_sitter)
if(NOT tree_sitter_POPULATED)
  FetchContent_Populate(tree_sitter)
endif()
FetchContent_GetProperties(tree_sitter_typescript)
if(NOT tree_sitter_typescript_POPULATED)
  FetchContent_Populate(tree_sitter_typescript)
endif()
FetchContent_GetProperties(tree_sitter_javascript)
if(NOT tree_sitter_javascript_POPULATED)
  FetchContent_Populate(tree_sitter_javascript)
endif()
FetchContent_GetProperties(tree_sitter_python)
if(NOT tree_sitter_python_POPULATED)
  FetchContent_Populate(tree_sitter_python)
endif()

add_library(tree-sitter-core "${tree_sitter_SOURCE_DIR}/lib/src/lib.c")
target_include_directories(tree-sitter-core PUBLIC "${tree_sitter_SOURCE_DIR}/lib/include")

add_library(tree-sitter-tsx
  "${tree_sitter_typescript_SOURCE_DIR}/tsx/src/parser.c"
  "${tree_sitter_typescript_SOURCE_DIR}/tsx/src/scanner.c"
)
target_include_directories(tree-sitter-tsx PUBLIC
  "${tree_sitter_SOURCE_DIR}/lib/include"
  "${tree_sitter_typescript_SOURCE_DIR}/tsx/src"
  "${tree_sitter_typescript_SOURCE_DIR}/common"
)

add_library(tree-sitter-ts
  "${tree_sitter_typescript_SOURCE_DIR}/typescript/src/parser.c"
  "${tree_sitter_typescript_SOURCE_DIR}/typescript/src/scanner.c"
)
target_include_directories(tree-sitter-ts PUBLIC
  "${tree_sitter_SOURCE_DIR}/lib/include"
  "${tree_sitter_typescript_SOURCE_DIR}/typescript/src"
  "${tree_sitter_typescript_SOURCE_DIR}/common"
)

add_library(tree-sitter-js
  "${tree_sitter_javascript_SOURCE_DIR}/src/parser.c"
  "${tree_sitter_javascript_SOURCE_DIR}/src/scanner.c"
)
target_include_directories(tree-sitter-js PUBLIC
  "${tree_sitter_SOURCE_DIR}/lib/include"
  "${tree_sitter_javascript_SOURCE_DIR}/src"
)

add_library(tree-sitter-py
  "${tree_sitter_python_SOURCE_DIR}/src/parser.c"
  "${tree_sitter_python_SOURCE_DIR}/src/scanner.c"
)
target_include_directories(tree-sitter-py PUBLIC
  "${tree_sitter_SOURCE_DIR}/lib/include"
  "${tree_sitter_python_SOURCE_DIR}/src"
)

add_executable(indexer
  src/main.cpp
  src/db.cpp
  src/walker.cpp
  src/parse.cpp
)

target_include_directories(indexer PRIVATE src third_party)
target_compile_definitions(indexer PRIVATE QUERIES_DIR="${CMAKE_CURRENT_SOURCE_DIR}/queries")
target_link_libraries(indexer PRIVATE SQLite::SQLite3 tree-sitter-core tree-sitter-tsx tree-sitter-ts tree-sitter-js tree-sitter-py)
