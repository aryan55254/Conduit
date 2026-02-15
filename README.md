# Conduit
Conduit is a distributed SQL router built with Node.js and TypeScript. It intercepts PostgreSQL wire protocol packets and parses SQL ASTs to transparently route queries across sharded database instances based on consistent hashing.

# Architecture
Conduit MVP follows the following architecture :

![ARCHITECTURE](public/architecture.png)