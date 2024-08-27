import { EmailListener } from "./email-listener.js";
import { ImapFlowOptions } from "imapflow";
import fs from "fs";
import { EmbedBuilder, WebhookClient } from "discord.js";
import * as crypto from "crypto";
import TurndownService from "turndown";
import { ParsedMail } from "mailparser";

interface ImapInstance {
    mailAccount: ImapFlowOptions;
    webhooks: WebhookOptions[];
}

interface EnvConfig {
    instances: Array<ImapInstance>;
}

interface WebhookOptions {
    url: string;
    threadId?: string;
}

interface WebhookInstance {
    client: WebhookClient;
    options: WebhookOptions;
}

function truncateString(str: string, maxLength: number) {
    if (str.length <= maxLength) {
        return str;
    }
    return str.slice(0, maxLength - 3) + "...";
}

async function run() {
    const envConfig = JSON.parse(fs.readFileSync("env-config.json", "utf-8")) as EnvConfig;

    let turndownService = buildTurndownService();

    for (let instance of envConfig.instances) {
        console.log(`${instance.mailAccount.auth.user}: Preparing instance...`);

        const emailListener = new EmailListener(instance.mailAccount);

        const webhookInstances: WebhookInstance[] = [];
        for (let webhookOptions of instance.webhooks) {
            webhookInstances.push({
                client: new WebhookClient({ url: webhookOptions.url }),
                options: webhookOptions,
            });
        }

        emailListener.on("onMailReceived", async (mail, mailId) => {
            await onMail("received", mail, mailId, instance, webhookInstances, turndownService);
        });

        emailListener.on("onMailSent", async (mail, mailId) => {
            await onMail("sent", mail, mailId, instance, webhookInstances, turndownService);
        });

        // console.log("Connecting to IMAP...");
        await emailListener.start();
        // console.log("Connected to IMAP!")

        console.log(`${instance.mailAccount.auth.user}: Instance is running!`);
    }
}

async function onMail(
    state: "received" | "sent",
    mail: ParsedMail,
    mailId: number,
    instance: ImapInstance,
    webhookInstances: WebhookInstance[],
    turndownService: TurndownService
) {
    try {
        console.log(`${instance.mailAccount.auth.user}: Processing ${mailId}`);

        //console.log(JSON.stringify(mail));

        // Avatar URL (Gravatar)
        let lowerCaseMail = mail.from!.value[0]!.address!.trim().toLowerCase();
        let emailHash = crypto.createHash("sha256").update(lowerCaseMail).digest("hex");
        let avatarUrl = `https://gravatar.com/avatar/${emailHash}?d=mp`;

        // Pretty author to embed
        let prettyTo = Array.isArray(mail.to) ? mail.to.map((to) => to.text).join(", ") : mail.to!.text;
        let embedAuthor = `${mail.from!.text} -> ${prettyTo}`;

        let content = null;
        let format = "Unknown";
        if (mail.text) {
            format = "Text";
            content = mail.text;
        } else if (mail.html !== false) {
            format = "HTML";
            // Convert HTML to Markdown as fallback
            content = turndownService.turndown(mail.html);
        }

        let arrowEmoji = state === "received" ? ":inbox_tray:" : ":outbox_tray:";

        // Prepare embed
        let embed = new EmbedBuilder()
            .setTitle(`${arrowEmoji} ${mail.subject}`)
            .setAuthor({ name: embedAuthor, iconURL: avatarUrl })
            .setDescription(truncateString(content ?? "*Brak treści*", 4096))
            .setFooter({
                text: `Format: ${format} | Message ID: ${mail.messageId}`,
            });

        if (state === "received") {
            embed = embed.setColor(0xf8e337);
        } else if (state === "sent") {
            embed = embed.setColor(0x00ff00);
        }

        // Attachments
        if (mail.attachments.length > 0) {
            let prettyAttachmentsFileNames = "";

            for (let attachment of mail.attachments) {
                prettyAttachmentsFileNames += `- \`${attachment.filename}\`\n`;
            }

            // Add field
            embed.addFields({
                name: "Zawiera załączniki",
                value: prettyAttachmentsFileNames,
            });
        }

        for (let webhookInstance of webhookInstances) {
            await webhookInstance.client.send({
                embeds: [embed],
                threadId: webhookInstance.options.threadId,
            });
        }
    } catch (err) {
        console.error("Error while forwarding mail!");
        console.error(err);

        let embed = new EmbedBuilder()
            .setTitle("Błąd")
            .setDescription(
                `Wystąpił błąd z podaniem dalej wiadomości! Jeśli chcesz odczytać jej zawartość to musisz udać się do panelu poczty.`
            )
            .setColor(0xff0000)
            .setFields([
                { name: "UID", value: mailId.toString() },
                { name: "State", value: state },
            ]);

        for (let webhookInstance of webhookInstances) {
            await webhookInstance.client.send({
                embeds: [embed],
                threadId: webhookInstance.options.threadId,
            });
        }
    }
}

function buildTurndownService(): TurndownService {
    const turndownService = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
    });

    /**
     * @override Strip "data:" from image src
     */
    turndownService.addRule("image", {
        filter: "img",
        replacement: function (content, node) {
            node = node as HTMLElement;

            let alt = node.getAttribute("alt") || "image";
            let src = node.getAttribute("src");
            let title = node.getAttribute("title");
            let titlePart = title ? ' "' + title + '"' : "";

            if (src !== null) {
                if (src.startsWith("data:")) {
                    // Strip raw base64 data from src
                    let type = src.split(",")[0]!;
                    src = `${type},...`;
                }
                return `[${alt}](${src}${titlePart})`;
            } else {
                return "";
            }
        },
    });

    /**
     * @override Fix inline links where alt and link where the same
     */
    turndownService.addRule("inlineLink", {
        filter: function (node, options) {
            return options.linkStyle === "inlined" && node.nodeName === "A" && node.getAttribute("href") !== null;
        },
        replacement: function (content, node) {
            node = node as HTMLElement;

            let href = node.getAttribute("href");
            if (href) href = href.replace(/([()])/g, "\\$1");

            let link = href;

            let title = node.getAttribute("title");
            if (title) {
                title = ' "' + title.replace(/"/g, '\\"') + '"';
                link += title;
            }

            if (content === link) {
                return content;
            } else {
                return `[${content}](${link})`;
            }
        },
    });

    return turndownService;
}

await run();
