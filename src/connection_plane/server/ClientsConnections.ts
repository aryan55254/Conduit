/**

Client Resource Manager

* This currently conencts the shard connections to the client connections 
* it handles backpressure of memory from the client to shard and vice versa via memory gaurd 
* at the moment this is a sticky socket assignment but will move on to a multiplexed once the protocol parser is enabled
* it handles the pg wire auth via the ssl method

 **/
import net, { Socket } from 'net';
import { ShardConnectionPool } from './ShardConnectionPool';
import { readFileSync } from 'fs';
import { TLSSocket } from 'tls';
import { ProtocolDecoder } from '../protocol/protocol_decoder'
import { BackendMessageCode } from '../protocol/pg_wire_message_types';

class ProxySession {
    private backendSocket: net.Socket | null = null;
    private readonly remoteAddr: string;
    private activeRequests = 0;
    private targetPool: ShardConnectionPool | undefined;
    private clientdecoder = new ProtocolDecoder('frontend');
    private sharddecoder = new ProtocolDecoder('backend');

    constructor(
        private clientSocket: Socket,
        private readonly shardPools: Map<string, ShardConnectionPool>
    ) {
        this.remoteAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        this.initialize();
    }

    private handleSSLrequest(socket: Socket) {

        socket.write('S');
        const secureSocket = new TLSSocket(socket, {
            isServer: true,
            key: readFileSync('server-key.pem'),
            cert: readFileSync('server-cert.pem'),
            requestCert: true
        });

        secureSocket.on('secureConnect', () => {
            console.log("TLS Tunnel Established!");
            this.clientSocket = secureSocket;
            this.setupfrontenddecodepiping(this.clientSocket);
            this.acquireandpipe();
        });

    }

    /**
     * Pauses the client stream to prevent data accumulation in memory 
     * while the connection to the backend shard is being established.
     */

    private initialize() {
        console.log(`[${this.remoteAddr}] Client session initiated`);
        this.clientSocket.pause();
        this.setupLifecycleHooks();

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
            this.clientSocket.pause();
            const socket = await this.targetPool.acquire();
            this.backendSocket = socket;
            this.activeRequests++;

            console.log(`[${this.remoteAddr}] Acquired backend socket from pool`);

            // Now that we have the socket, resume the client and start piping
            this.clientSocket.resume();
            this.setupbackenddecodepiping(this.backendSocket, this.clientSocket);

        } catch (err) {
            console.error("Failed to acquire socket:", err);
            this.clientSocket.destroy();
        }
    }

    private detachBackend() {
        if (this.backendSocket && this.targetPool) {
            this.backendSocket.removeAllListeners('data');
            this.backendSocket.removeAllListeners('drain');
            this.targetPool.release(this.backendSocket);
            this.backendSocket = null;
        }
    }

    //decoding pipeline tht sends the messages to the ptotocl decoder and does packpressure handling when no message s parsed out 

    private async setupbackenddecodepiping(backendSocket: Socket, clientSocket: Socket) {

        this.backendSocket?.on('data', (chunk: Buffer) => {
            const messages = this.sharddecoder.parse(chunk);
            for (const msg of messages) {

                const flushed = this.clientSocket?.write(msg.raw);
                if (!flushed) {
                    this.clientSocket.pause();
                    this.backendSocket?.once('drain', () => this.clientSocket.resume());
                }

                if (msg.type === BackendMessageCode.ReadyForQuery) {
                    const status = msg.payload[0];

                    if (status === 73) { // 73 is 'I' for Idle
                        console.log(`[${this.remoteAddr}] Shard Idle. Releasing to pool.`);
                        this.detachBackend();
                    }
                }
            }
        });

    }

    private isFrontendPipingSetup = false;

    private setupfrontenddecodepiping(clientSocket: Socket) {
        if (this.isFrontendPipingSetup) return; // Prevent duplicate listeners
        this.isFrontendPipingSetup = true;

        this.clientSocket.on('data', async (chunk: Buffer) => {
            const messages = this.clientdecoder.parse(chunk);
            for (const msg of messages) {
                if (!this.backendSocket) {
                    // If we need a shard, wait for it

                    await this.acquireandpipe();
                }

                const flushed = this.backendSocket?.write(msg.raw);
                if (!flushed) {
                    this.clientSocket.pause();
                    this.backendSocket?.once('drain', () => this.clientSocket.resume());
                }
            }
        });
    }

    private setupLifecycleHooks() {

        this.clientSocket.once('data', (chunk) => {
            // Check if the first 8 bytes are the SSLRequest
            if (chunk.length === 8 && chunk.readInt32BE(0) === 8 && chunk.readInt32BE(4) === 80877103) {
                this.handleSSLrequest(this.clientSocket);
            } else {
                // It's a StartupMessage (No SSL), go straight to auth/decoding
                this.clientSocket.pause();
                this.clientSocket.unshift(chunk); // Put the data back for the decoder
                this.acquireandpipe();
            }
        });

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


