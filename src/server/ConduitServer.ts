/**
 * Conduit Entry Point 
 * * This layer manages the TCP server lifecycle. Currently, it initializes a 
 * direct pipe (ProxySession) to a backend shard. As development progresses, 
 * intermediate layers for protocol parsing (Layer 2) and routing (Layer 3) 
 * will be injected between this entry point and the backend.
 * this and /session/ProxySession.ts together form the proxy server that talks to the clients and db shards
 */
import net, { Socket } from 'net';
import ProxySession from "../session/ProxySession";

interface ServerConfig {
    listenPort: number;
    shardPort: number;
    shardHost?: string;
}

class ConduitServer {
    private server: net.Server;

    constructor(private config: ServerConfig) {
        this.server = net.createServer((socket) => this.handleConnection(socket));
    }

    /**
     * Hand over the raw client socket to the ProxySession manager.
     * In the future, this will initiate the Layer 2 Protocol Parser.
     */
    private handleConnection(clientSocket: Socket) {
        new ProxySession(clientSocket, this.config.shardPort, this.config.shardHost);
    }

    public start() {
        this.server.listen(this.config.listenPort, () => {
            console.log(`[Conduit] Entry Point listening on port ${this.config.listenPort}`);
            console.log(`[Conduit] Default route: ${this.config.shardHost || 'localhost'}:${this.config.shardPort}`);
        });
    }
}

const server = new ConduitServer({
    listenPort: 5432, // Standard Postgres Port
    shardPort: 7070, // Your backend shard port
    shardHost: 'localhost'
});

server.start();