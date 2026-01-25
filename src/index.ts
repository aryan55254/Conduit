//Layer 1, entry point to the server
/* 
the layer currently directly fires to to the layer 5 proxy via the ProxySession function this will change when layers are added in between
 dumb async pipe in between client and a backend shard and does a one to one connection , it can do straight-forward db transactions for now
*/
import net, { Socket } from 'net';
import ProxySession from "./proxy_layer"

interface ServerConfig {
    listenPort: number;
    shardPort: number;
    shardHost?: string
}
class ConduitServer {
    private server: net.Server;

    //constructor that initiazes a server instance and connects the proxy to the server
    constructor(private config: ServerConfig) {
        this.server = net.createServer((socket) => this.handleConnection(socket));
    }
    //function to open a one to one connection to db shard
    private handleConnection(clientSocket: Socket) {
        new ProxySession(clientSocket, this.config.shardPort, this.config.shardHost);
    }
    //function that starts the server and server starts listening this can(leaning towards should) happen after the server instance is made and shard is connected
    public start() {
        this.server.listen(this.config.listenPort, () => {
            console.log(`Conduit Entry Point running on port ${this.config.listenPort}`);
            console.log(`Forwarding to ${this.config.shardHost || 'localhost'}:${this.config.shardPort}`);
        });
    }
}
//initializing server
const server = new ConduitServer({
    listenPort: 5432,
    shardPort: 7070,
    shardHost: 'localhost'
});

server.start();