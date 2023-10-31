import {ImapFlow, ImapFlowOptions} from "imapflow";
import {ParsedMail, simpleParser} from "mailparser";
import {pino} from "pino";
import EventEmitter from "events";
import TypedEventEmitter, { EventMap } from "typed-emitter";

type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;

interface ExistsData {
    path: string, // For example "INBOX"
    count: number,
    prevCount: number
}

type Events = {
    onMailReceive: (mail: ParsedMail, mailId: number) => void
}

export class EmailListener extends (EventEmitter as new () => TypedEmitter<Events>) {
    private client: ImapFlow | undefined;

    constructor(private imapOptions: ImapFlowOptions) {
        super();
    }

    private fromExistsDataToNewMails(data: ExistsData): number[] {
        let newMails: number[] = [];
        for (let mailId = data.prevCount + 1; mailId <= data.count; mailId++) {
            newMails.push(mailId);
        }

        return newMails;
    }

    public async connect() {
        // Setup silent logger
        //let logger = pino();
        //logger.level = "silent";

        this.client = new ImapFlow(this.imapOptions);

        // IMAP server sends packet "EXISTS" to inform client about emails count change
        this.client.on("exists", async (data: ExistsData) => {
            //console.log(`Message count in "${data.path}" is ${data.count}. Prev: ${data.prevCount}`);
            //console.log("data", data);

            let newMails = this.fromExistsDataToNewMails(data);

            if (newMails.length === 0) return;

            let lock = await this.client!.getMailboxLock("INBOX", {readonly: true});

            for (let mailId of newMails) {
                let {meta, content} = await this.client!.download(mailId.toString());

                let parsedMail = await simpleParser(content);

                this.emit("onMailReceive", parsedMail, mailId);
            }

            lock.release();
        });

        this.client.on("close", async () => {
            console.log("reconnecting...");
            // Reconnect
            await this.connect();
            console.log("reconnected");
        });

        this.client.on("error", (...args: any[]) => {
            console.log(`${this.imapOptions.auth.user}: error`);
            console.log(args);
        });

        await this.client.connect();
    }
}