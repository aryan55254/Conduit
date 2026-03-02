//this is a global invariant this provides per shard connection pooling for conduit this opens up 10 conenctions per shard and keeps them always hot and if there are specific socket errors we still maintain a stable 10 connection 
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
//self healing always maintains 10 connections to the shard
        if (this.connections.length < 10) {
            this.add_socket();
        }

    }

    private initializePool() {
        for (let i = 0; i < 10; i++) {
            this.add_socket();
        }
    }

    // takes a connection from the available ones if no one is available the asker is assed to the requestqueue
    public async acquire(): Promise<Socket> {
        if (this.availableConnections.length > 0) {
            return this.availableConnections.pop()!;
        }
        else {
            return new Promise((resolve) => this.requestQueue.push(resolve));
        }
    }

    // it is when the connection is finished being used not other client can use it a client from th requestqueue is prioritised
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

