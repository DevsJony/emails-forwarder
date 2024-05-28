import {ImapFlow, ImapFlowOptions} from "imapflow";
import {ParsedMail, simpleParser} from "mailparser";
import EventEmitter from "events";
import TypedEventEmitter, { EventMap } from "typed-emitter";
import {pino} from "pino";

type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;

interface ExistsData {
    path: string, // For example "INBOX"
    count: number,
    prevCount: number
}

type Events = {
    onMailReceive: (mail: ParsedMail, mailId: number) => void
}

const RECONNECT_DELAY_ADD = 1000 * 10; // 5 seconds
const RECONNECT_MAX_DELAY = 1000 * 60 * 5; // 5 minutes

export class EmailListener extends (EventEmitter as new () => TypedEmitter<Events>) {
    private client: ImapFlow | undefined;
    private reconnectDelay = 0;

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

    private prepareClient() {
        // Setup silent logger
        let logger = pino();
        logger.level = "silent";

        this.client = new ImapFlow({
            logger: logger,
            ...this.imapOptions
        });

        // IMAP server sends packet "EXISTS" to inform client about emails count change
        this.client.on("exists", async (data: ExistsData) => {
            //console.log(`Message count in "${data.path}" is ${data.count}. Prev: ${data.prevCount}`);
            //console.log("data", data);

            let newMails = this.fromExistsDataToNewMails(data);

            if (newMails.length === 0) return;

            for (let mailId of newMails) {
                let {meta, content} = await this.client!.download(mailId.toString());

                let parsedMail = await simpleParser(content);

                this.emit("onMailReceive", parsedMail, mailId);
            }
        });

        this.client.on("close", async () => {
            await this.reconnect();
        });

        this.client.on("error", async (...args: any[]) => {
            console.log(`${this.imapOptions.auth.user}: error`);
            console.log(args);

            await this.reconnect();
        });
    }

    public async connect() {
        this.prepareClient();

        try {
            await this.client!.connect();

            await this.client!.mailboxOpen("INBOX", {readOnly: true});
        } catch (err) {
            console.error(`${this.imapOptions.auth.user}: Error while connecting to IMAP!`);
            console.error(err);

            await this.reconnect();
        }
    }

    private async reconnect() {
        if (this.reconnectDelay > 0) {
            console.log(`${this.imapOptions.auth.user}: Reconnect delay: ${this.reconnectDelay}`);
            await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
        }

        if (this.reconnectDelay < RECONNECT_MAX_DELAY) {
            this.reconnectDelay += RECONNECT_DELAY_ADD;
        }

        console.log(`${this.imapOptions.auth.user}: Reconnecting...`);
        // Reconnect
        await this.connect();
        console.log(`${this.imapOptions.auth.user}: Reconnected`);

        this.reconnectDelay = 0;
    }
}