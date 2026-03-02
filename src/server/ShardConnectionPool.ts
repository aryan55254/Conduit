import { Socket } from 'net';

export class ShardConnectionPool {
    private connections: Socket[] = [];
    private availableConnections: Socket[] = [];
    private requestQueue: ((socket: Socket) => void)[] = [];

    constructor(private config: { host: string; port: number }) {
        this.initializePool();
    }

    private add_socket() {
        const socket = new Socket();

        socket.on('connect', () => {
            console.log(`[Pool] Shard connection established`);
            this.connections.push(socket);
            this.release(socket);
        });

        socket.on('error', (err) => {
            console.error(`[Pool] Socket Error: ${err.message}`);
            this.handleDeadSocket(socket);
        });

        socket.on('close', () => {
            this.handleDeadSocket(socket);
        });

        socket.connect(this.config.port, this.config.host);
    }

    private handleDeadSocket(socket: Socket) {

        this.connections = this.connections.filter(s => s !== socket);
        this.availableConnections = this.availableConnections.filter(s => s !== socket);

        socket.destroy();

        if (this.connections.length < 10) {
            this.add_socket();
        }

    }

    private initializePool() {
        for (let i = 0; i < 10; i++) {
            this.add_socket();
        }
    }

    public async acquire(): Promise<Socket> {
        if (this.availableConnections.length > 0) {
            return this.availableConnections.pop()!;
        }
        else {
            return new Promise((resolve) => this.requestQueue.push(resolve));
        }
    }

    public async release(socket: Socket) {
        if (this.requestQueue.length > 0) {
            const nextRequest = this.requestQueue.shift()!;
            nextRequest(socket);
        }
        else {
            return this.availableConnections.push(socket);
        }
    }
}

