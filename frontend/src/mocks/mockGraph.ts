import type { GraphEdge, GraphNode } from '../types/contracts'

export const mockNodes: GraphNode[] = [
  {
    id: 'src/db/pool.ts::pool.ts::file',
    type: 'file',
    name: 'pool.ts',
    path: 'src/db/pool.ts',
    startLine: 1,
    endLine: 90,
  },
  {
    id: 'src/db/pool.ts::DatabasePool::class',
    type: 'class',
    name: 'DatabasePool',
    path: 'src/db/pool.ts',
    startLine: 10,
    endLine: 84,
  },
  {
    id: 'src/api/users.ts::users.ts::file',
    type: 'file',
    name: 'users.ts',
    path: 'src/api/users.ts',
    startLine: 1,
    endLine: 40,
  },
  {
    id: 'src/api/users.ts::getUser::function',
    type: 'function',
    name: 'getUser',
    path: 'src/api/users.ts',
    startLine: 5,
    endLine: 22,
  },
  {
    id: 'src/api/users.ts::listUsers::function',
    type: 'function',
    name: 'listUsers',
    path: 'src/api/users.ts',
    startLine: 24,
    endLine: 38,
  },
  {
    id: 'src/server.ts::server.ts::file',
    type: 'file',
    name: 'server.ts',
    path: 'src/server.ts',
    startLine: 1,
    endLine: 30,
  },
  {
    id: 'src/server.ts::startServer::function',
    type: 'function',
    name: 'startServer',
    path: 'src/server.ts',
    startLine: 8,
    endLine: 28,
  },
]

export const mockEdges: GraphEdge[] = [
  {
    source: 'src/db/pool.ts::pool.ts::file',
    target: 'src/db/pool.ts::DatabasePool::class',
    type: 'DEFINES',
  },
  {
    source: 'src/api/users.ts::users.ts::file',
    target: 'src/api/users.ts::getUser::function',
    type: 'DEFINES',
  },
  {
    source: 'src/api/users.ts::users.ts::file',
    target: 'src/api/users.ts::listUsers::function',
    type: 'DEFINES',
  },
  {
    source: 'src/server.ts::server.ts::file',
    target: 'src/server.ts::startServer::function',
    type: 'DEFINES',
  },
  {
    source: 'src/api/users.ts::users.ts::file',
    target: 'src/db/pool.ts::pool.ts::file',
    type: 'IMPORTS',
  },
  {
    source: 'src/server.ts::server.ts::file',
    target: 'src/api/users.ts::users.ts::file',
    type: 'IMPORTS',
  },
  {
    source: 'src/api/users.ts::getUser::function',
    target: 'src/db/pool.ts::DatabasePool::class',
    type: 'CALLS',
  },
  {
    source: 'src/api/users.ts::listUsers::function',
    target: 'src/db/pool.ts::DatabasePool::class',
    type: 'CALLS',
  },
  {
    source: 'src/server.ts::startServer::function',
    target: 'src/api/users.ts::getUser::function',
    type: 'CALLS',
  },
]
