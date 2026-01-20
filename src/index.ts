//Layer 1 + 5 , entry point to the server and connection to a single db shard
/* 
 dumb async pipe in between client and a backend shard and does a one to one connection , it can do straight-forward db transactions for now
*/
import net from 'net';

const PORT = 5432;
const SHARD_PORT = 7070;

const server = net.createServer((clientSocket) => {

    /*
    we connect socket to a client and we pause the client connection until the we connect to the cb on other side 
    */
    const remoteAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    console.log(`New Client [${remoteAddr}] Connected`);

    const backendSocket = new net.Socket();
    const backendAddr = `${backendSocket.remoteAddress}:${backendSocket.remotePort}`;

    clientSocket.pause();

    backendSocket.connect(SHARD_PORT, 'localhost', () => {
        console.log(`Connected to The Postgres Shard : [${backendAddr}]`);
        clientSocket.resume();
    });

    /* 
    we write data recieved from the client directly to the backend socket and if the backend socket is overwhelmed we stop intaking new data  by pausing the client socket until backend socket is drained and we do vice versa for client socket for giving responses to the client about the database
    */
    clientSocket.on('data', (chunk: Buffer) => {
        const flushed = backendSocket.write(chunk);
        if (!flushed) {
            console.log("Backend congested, pausing client...");
            clientSocket.pause();
        }
    });

    backendSocket.on('drain', () => {
        console.log("Backend drained, resuming client...");
        clientSocket.resume();
    })

    backendSocket.on('data', (chunks: Buffer) => {
        const flushed = clientSocket.write(chunks);
        if (!flushed) {
            console.log("client socket congested, pausing connection to postgres shard...");
            backendSocket.pause();
        }
    })

    clientSocket.on('drain', () => {
        console.log("Client Side Socket drained, resuming connection to postgres shard...");
        backendSocket.resume();
    })

    /*
    cleanup and error handling
    */

    clientSocket.on('close', () => {
        console.log(`Client [${remoteAddr}] disconnected`);
        backendSocket.end();
    })

    backendSocket.on('close', () => {
        clientSocket.end();
    });

    clientSocket.on('error', (err) => {
        console.error(`Client Error: ${err.message}`);
        backendSocket.destroy();
    });

    backendSocket.on('error', (err) => {
        console.error(`Backend Error: ${err.message}`);
        clientSocket.destroy();
    });

});

server.listen(PORT, () => {
    console.log(`Conduit Entry Point running on port ${PORT}`);
    console.log(`Forwarding to localhost:${SHARD_PORT}`);
});