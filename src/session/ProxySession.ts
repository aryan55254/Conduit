/**

Client Resource Manager

* This currently conencts the shard connections to the client connections 
* it handles backpressure of memory from the client to shard and vice versa via memory gaurd 
* at the moment this is a sticky socket assignment but will move on to a multiplexed once the protocol parser is enabled

 **/
import net, { Socket } from 'net';
import { ShardConnectionPool } from '../server/ShardConnectionPool';

class ProxySession {
    private backendSocket: net.Socket | null = null;
    private readonly remoteAddr: string;
    private activeRequests = 0;
    private targetPool: ShardConnectionPool | undefined;

    constructor(
        private readonly clientSocket: Socket,
        private readonly shardPools: Map<string, ShardConnectionPool>
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
        this.acquireandpipe();
    }

    private async acquireandpipe() {
        // For now, we hardcode 'shard_01'. Later, our SQL parser will choose this.
        this.targetPool = this.shardPools.get('shard_01');

        if (!this.targetPool) {
            console.error("Shard pool not found!");
            this.clientSocket.destroy();
            return;
        }

        try {
            // Borrow a socket from the Global Gate
            const socket = await this.targetPool.acquire();
            this.backendSocket = socket;
            this.activeRequests++;

            console.log(`[${this.remoteAddr}] Acquired backend socket from pool`);

            // Now that we have the socket, resume the client and start piping
            this.clientSocket.resume();
            this.setupOneWayPipe(this.clientSocket, this.backendSocket, "Client -> Backend");
            this.setupOneWayPipe(this.backendSocket, this.clientSocket, "Backend -> Client");

        } catch (err) {
            console.error("Failed to acquire socket:", err);
            this.clientSocket.destroy();
        }
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
        this.clientSocket.on('close', () => {
            console.log(`[${this.remoteAddr}] Client disconnected`);

            // Return the socket to the pool so others can use it
            if (this.backendSocket && this.targetPool) {
                this.targetPool.release(this.backendSocket);
                this.activeRequests--;
            }
        });

        // Handle backend errors/closes by cleaning up the client
        this.clientSocket.on('error', (err) => {
            this.clientSocket.destroy();
        });
    }
}

export default ProxySession;


