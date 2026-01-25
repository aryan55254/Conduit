/*
the layer currently directly fires to to the layer 1 and gets info directly from layer 1 the getting info from layer 1 directly will chaange as layers will be added but return to layer one will remain staright forward
 dumb async pipe in between client and a backend shard and does a one to one connection , it can do straight-forward db transactions for now
*/

import net, { Socket } from 'net';
//sets up a one to one porxy session to a db shard 
class ProxySession {
    private backendSocket: Socket;
    private readonly remoteAddr: string;

    constructor(
        private readonly clientSocket: Socket,
        private readonly shardPort: number,
        private readonly shardHost: string = 'localhost'
    ) {
        this.backendSocket = new net.Socket();
        this.remoteAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        this.initialize();
    }
    //after new client conencts , pauses that connection and connects to the shards and handles lifecycle events
    private initialize() {
        console.log(`[${this.remoteAddr}] New Client Connected`);
        this.clientSocket.pause();
        this.setupLifecycleHooks();
        this.connectToShards();
    }
    //connects to shard safely , and handles backpressure both ways 
    private connectToShards() {
        this.backendSocket.connect(this.shardPort, this.shardHost, () => {
            const backendAddr = `${this.backendSocket.remoteAddress}:${this.backendSocket.remotePort}`;
            console.log(`[${this.remoteAddr}] -> Connected to Postgres Shard [${backendAddr}]`);
            this.clientSocket.resume(); //because initialize function pauses the client conenction for shard conenction to happen safely
            this.setupOneWayPipe(this.clientSocket, this.backendSocket, "Client -> Backend");
            this.setupOneWayPipe(this.backendSocket, this.clientSocket, "Backend -> Client");
        })
    }
    //handles backpressure 
    private setupOneWayPipe(source: Socket, destination: Socket, label: string) {
        source.on('data', (chunk: Buffer) => {
            const flushed = destination.write(chunk);
            if (!flushed) {
                source.pause();
            }
        });
        destination.on('drain', () => {
            source.resume();
        })
    }
    //handles lifecycle events 
    private setupLifecycleHooks() {
        this.clientSocket.on('close', () => {
            console.log(`[${this.remoteAddr}] Client disconnected`);
            this.backendSocket.end();
        });

        this.backendSocket.on('close', () => {
            console.log(`[${this.remoteAddr}] Backend closed connection`);
            this.clientSocket.end();
        });

        // --- Error Handling ---
        this.clientSocket.on('error', (err) => {
            console.error(`[${this.remoteAddr}] Client Error: ${err.message}`);
            this.backendSocket.destroy();
        });

        this.backendSocket.on('error', (err) => {
            console.error(`[${this.remoteAddr}] Backend Error: ${err.message}`);
            this.clientSocket.destroy();
        });
    }
}

export default ProxySession;