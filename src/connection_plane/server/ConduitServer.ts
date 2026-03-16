/**
 * 
 Conduit Entry Point 
* This is the managing point for the database_proxy/router , this layer is the registry for all shard_pools 

* whats this does is it the orchestrator for the whole thing what this does so far os initiaze a pool of connections to each shard and connects to the clients asynchronously as well 
 
* this file , server/ShardConnectionPool.ts and session/ProxySession.ts work together to make the connection plane of Conduit
* 
 **/
import net, { Socket } from 'net';
import ProxySession from "../server/ClientsConnections";
import { ShardConnectionPool } from "./ShardConnectionPool"

interface ShardConfig {
    id: string;
    host: string;
    port: number;
}

interface ServerConfig {
    listenPort: number;
    shards: ShardConfig[];
}

class ConduitServer {
    private shardPools: Map<string, ShardConnectionPool> = new Map();
    private server: net.Server;

    constructor(private config: ServerConfig) {
        //warm initialization the connections to shards are completed becofe clients conenct so they don't have to wait
        this.initializePools();
        this.server = net.createServer((socket) => this.handleConnection(socket));
    }

    private initializePools() {
        for (const shard of this.config.shards) {
            this.shardPools.set(shard.id, new ShardConnectionPool(shard));
            console.log(`[Conduit] Initialized pool for ${shard.id} at ${shard.host}:${shard.port}`);
        }
    }

    private handleConnection(clientSocket: Socket) {
        new ProxySession(clientSocket, this.shardPools);
    }

    // future layers of sql parsing protocl parsing consistent hashing from client to shard and layrs of protocol parsing and thers needed from shard to client will be managed from here 

    public start() {
        this.server.listen(this.config.listenPort, () => {
            console.log(`[Conduit] Entry Point listening on port ${this.config.listenPort}`);
        });
    }
}