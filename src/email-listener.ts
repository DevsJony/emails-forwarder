import { ImapFlow, ImapFlowOptions } from "imapflow";
import { ParsedMail, simpleParser } from "mailparser";
import EventEmitter from "events";
import TypedEventEmitter, { EventMap } from "typed-emitter";
import { pino } from "pino";

type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;

interface ExistsData {
    path: string; // For example "INBOX"
    count: number;
    prevCount: number;
}

type Events = {
    onMailReceived: (mail: ParsedMail, uid: number) => void;
    onMailSent: (mail: ParsedMail, uid: number) => void;
};

type Mailbox = "INBOX" | "Sent";

const RECONNECT_DELAY_ADD = 1000 * 10; // 10 seconds
const RECONNECT_MAX_DELAY = 1000 * 60 * 5; // 5 minutes

function fromExistsDataToNewMails(data: ExistsData): number[] {
    let newMails: number[] = [];
    for (let mailId = data.prevCount + 1; mailId <= data.count; mailId++) {
        newMails.push(mailId);
    }

    return newMails;
}

export class EmailListener extends (EventEmitter as new () => TypedEmitter<Events>) {
    constructor(private imapOptions: ImapFlowOptions) {
        super();
    }

    public async start() {
        // For fetching received emails
        await this.startClient("INBOX");

        // For fetching sent emails
        await this.startClient("Sent");
    }

    private async startClient(mailbox: Mailbox) {
        let fetchReceivedClient = new ReconnectableImapFlow(
            {
                mailbox: mailbox,
                prepareClient: (client) => this.prepareClient(client, mailbox),
            },
            this.imapOptions
        );
        await fetchReceivedClient.connect();
    }

    private prepareClient(client: ImapFlow, mailbox: Mailbox) {
        // IMAP server sends packet "EXISTS" to inform client about emails count change
        client.on("exists", async (data: ExistsData) => {
            //let lock = await this.client!.getMailboxLock("INBOX");
            //console.log(`Message count in "${data.path}" is ${data.count}. Prev: ${data.prevCount}`);
            //console.log("data", data);

            let newMails = fromExistsDataToNewMails(data);

            if (newMails.length === 0) return;

            for (let uid of newMails) {
                let { meta, content } = await client.download(uid.toString());

                let parsedMail = await simpleParser(content);

                if (mailbox === "INBOX") {
                    this.emit("onMailReceived", parsedMail, uid);
                } else if (mailbox === "Sent") {
                    this.emit("onMailSent", parsedMail, uid);
                }
            }
        });
    }
}

class ReconnectableImapFlow {
    private _client: ImapFlow | undefined;
    private reconnectDelay = 0;
    private reconnecting = false;

    constructor(
        private options: {
            mailbox: Mailbox;
            /**
             * You can configure client here
             */
            prepareClient: (client: ImapFlow) => void;
        },
        private imapOptions: ImapFlowOptions
    ) {}

    private prepareClient() {
        // Setup silent logger
        let logger = pino();
        logger.level = "silent";

        this._client = new ImapFlow({
            logger: logger,
            ...this.imapOptions,
        });

        this._client.on("close", async () => {
            this.log("connection closed");
            await this.reconnect();
        });

        this._client.on("error", async (...args: any[]) => {
            this.log("error");
            console.log(args);
        });

        this.options.prepareClient(this._client);
    }

    public async connect() {
        this.log("Connecting to IMAP...");
        this.prepareClient();

        try {
            await this._client!.connect();

            await this._client!.mailboxOpen(this.options.mailbox, { readOnly: true });

            if (this.reconnecting) {
                this.onReconnected();
            }
        } catch (err) {
            this.log("Error while connecting to IMAP!");
            console.error(err);

            this.reconnecting = false;
            await this.reconnect();
        }
        this.log("Connected to IMAP!");
    }

    private async reconnect() {
        if (this.reconnecting) {
            // Discard reconnecting twice
            return;
        }

        // Check if connection is still alive
        if (this._client!.usable) {
            // Close connection and then reconnect. In event listener it will automatically reconnect
            this._client!.close();
            return;
        }

        // We are now reconnecting
        this.reconnecting = true;

        if (this.reconnectDelay > 0) {
            console.log(`${this.imapOptions.auth!.user}: Reconnect delay: ${this.reconnectDelay}`);
            await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay));
        }

        if (this.reconnectDelay < RECONNECT_MAX_DELAY) {
            this.reconnectDelay += RECONNECT_DELAY_ADD;
        }

        this.log("Reconnecting...");
        // Reconnect
        await this.connect();
    }

    private onReconnected() {
        this.log("Reconnected");

        // Reset some variables
        this.reconnectDelay = 0;
        this.reconnecting = false;
    }

    get client(): ImapFlow | undefined {
        return this._client;
    }

    public log(msg: string) {
        console.log(`[${this.imapOptions.auth!.user}] ${this.options.mailbox}: ${msg}`);
    }
}
