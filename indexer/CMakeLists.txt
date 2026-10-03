cmake_minimum_required(VERSION 3.16)
project(indexer LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# MVP0: system SQLite (C API, same SQL as amalgamation).
# Later: switch to SQLite amalgamation via FetchContent for reproducible builds.
find_package(SQLite3 REQUIRED)

add_executable(indexer
  src/main.cpp
  src/db.cpp
  src/walker.cpp
)

target_include_directories(indexer PRIVATE src third_party)
target_link_libraries(indexer PRIVATE SQLite::SQLite3)
