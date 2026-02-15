/**
 * Proxy Session Manager
 * * Currently acts as a transparent asynchronous pipe between the client and a 
 * specific database shard. It handles backpressure (pause/resume) to ensure 
 * memory stability and manages the lifecycle of both sockets.
 * this and /server/ConduitServer.ts together form the proxy server that talks to the clients and db shards
 */
import net, { Socket } from 'net';

class ProxySession {
    private backendSocket: net.Socket;
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

    /**
     * Pauses the client stream to prevent data accumulation in memory 
     * while the connection to the backend shard is being established.
     */
    private initialize() {
        console.log(`[${this.remoteAddr}] Client session initiated`);
        this.clientSocket.pause();
        this.setupLifecycleHooks();
        this.connectToShard();
    }

    private connectToShard() {
        this.backendSocket.connect(this.shardPort, this.shardHost, () => {
            const backendAddr = `${this.backendSocket.remoteAddress}:${this.backendSocket.remotePort}`;
            console.log(`[${this.remoteAddr}] Connected to Backend Shard [${backendAddr}]`);

            // Resume flow once the backend is ready to receive
            this.clientSocket.resume();

            // Establish full-duplex piping
            this.setupOneWayPipe(this.clientSocket, this.backendSocket, "Client -> Backend");
            this.setupOneWayPipe(this.backendSocket, this.clientSocket, "Backend -> Client");
        });
    }

    /**
     * Implements basic backpressure handling. If the destination's write buffer 
     * is full, the source is paused until the 'drain' event is emitted.
     */
    private setupOneWayPipe(source: Socket, destination: Socket, label: string) {
        source.on('data', (chunk: Buffer) => {
            const flushed = destination.write(chunk);
            if (!flushed) {
                source.pause();
            }
        });

        destination.on('drain', () => {
            source.resume();
        });
    }

    private setupLifecycleHooks() {
        // Clean termination: if one side closes, end the other.
        this.clientSocket.on('close', () => {
            console.log(`[${this.remoteAddr}] Client disconnected`);
            this.backendSocket.end();
        });

        this.backendSocket.on('close', () => {
            console.log(`[${this.remoteAddr}] Backend shard closed connection`);
            this.clientSocket.end();
        });

        // Error handling: destroy sockets to prevent memory leaks
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