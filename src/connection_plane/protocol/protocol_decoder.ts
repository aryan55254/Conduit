/**
 * PostgreSQL Protocol Decoder
 * * RESPONSIBILITIES:
 *Accumulate raw TCP chunks into a "Frame Buffer".
 *Identify message boundaries using the [Type][Length] header.
 *Handle the "Headerless" StartupMessage (special case).
 *Emit complete, validated PostgreSQL messages to the ProxySession.
 */
import { Buffer } from "buffer";
import { FrontendMessageCode, BackendMessageCode } from "./pg_wire_message_types";
import { buffer } from "stream/consumers";


class ProtocolDecoder {

    constructor(private mode: 'frontend' | 'backend') { }

    private accumulator: Buffer = Buffer.alloc(0);

    private ishandshakecomplete: boolean = false;

    /**
     * Called every time the socket emits a 'data' chunk.
     */
    public parse(chunk: Buffer) {
        this.accumulator = Buffer.concat([this.accumulator, chunk]);
        const messages: Buffer[] = [];

        while (this.accumulator.length >= 4) {
            const messagetype = this.accumulator[0];
            let typebyte: FrontendMessageCode | BackendMessageCode;

            if (this.mode === 'frontend') {
                // Treat the byte as a Client-to-Proxy message 
                typebyte = messagetype as FrontendMessageCode;
            } else {
                // Treat the byte as a Shard-to-Proxy message
                typebyte = messagetype as BackendMessageCode;
            }

            if (messagetype) {
                this.ishandshakecomplete = true
            }

            let message_length: number = 1 + this.accumulator.readInt32BE(1);

            if (this.accumulator.length < message_length) {
                break;
            }

            if (this.accumulator.length >= message_length) {
                const full_message: Buffer = this.accumulator.subarray(0, message_length);
                this.accumulator = this.accumulator.subarray(message_length);

                //we need to return this shit to next thingy with return ig 
                messages.push(full_message);
            }
            // the loop continue 
            return messages;

        }
    }

    public reset() {
        this.accumulator = Buffer.alloc(0);
        this.ishandshakecomplete = false;
    }

}