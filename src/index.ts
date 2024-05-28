import {EmailListener} from "./email-listener.js";
import {ImapFlowOptions} from "imapflow";
import fs from "fs";
import {EmbedBuilder, WebhookClient} from "discord.js";
import * as crypto from "crypto";

interface EnvConfig {
    instances: Array<{
        mailAccount: ImapFlowOptions,
        webhooks: WebhookOptions[]
    }>
}

interface WebhookOptions {
    url: string
    threadId?: string
}

interface WebhookInstance {
    client: WebhookClient,
    options: WebhookOptions
}

function truncateString(str: string, maxLength: number) {
    if (str.length <= maxLength) {
        return str;
    }
    return str.slice(0, maxLength  - 3) + "...";
}

async function run() {
    const envConfig = JSON.parse(fs.readFileSync("env-config.json", "utf-8")) as EnvConfig;

    for (let instance of envConfig.instances) {
        console.log(`${instance.mailAccount.auth.user}: Preparing instance...`);

        const emailListener = new EmailListener(instance.mailAccount);

        const webhookInstances: WebhookInstance[] = [];
        for (let webhookOptions of instance.webhooks) {
            webhookInstances.push({
                client: new WebhookClient({url: webhookOptions.url}),
                options: webhookOptions
            });
        }

        emailListener.on("onMailReceive", async (mail, mailId) => {
            try {
                console.log(`${instance.mailAccount.auth.user}: Processing ${mailId}`);
                //console.log(JSON.stringify(mail));

                // Avatar URL (Gravatar)
                let lowerCaseMail = mail.from!.value[0]!.address!.trim().toLowerCase();
                let emailHash = crypto.createHash("sha256").update(lowerCaseMail).digest("hex");
                let avatarUrl = `https://gravatar.com/avatar/${emailHash}?d=mp`;

                // Prepare embed
                let embed = new EmbedBuilder()
                    .setTitle(mail.subject!)
                    .setAuthor({name: mail.from!.text, iconURL: avatarUrl})
                    .setDescription(truncateString(mail.text ?? ":warning: Brak treści lub błąd konwertowania HTML na tekst :warning:", 4096))
                    .setColor(0xf8e337);

                // Attachments
                if (mail.attachments.length > 0) {
                    let prettyAttachmentsFileNames = ""; // Example: "`test1.png`, `test2.png`, `test3.txt`"

                    for (let attachment of mail.attachments) {
                        // Is not first
                        if (prettyAttachmentsFileNames !== "") {
                            prettyAttachmentsFileNames += ", ";
                        }

                        prettyAttachmentsFileNames += `\`${attachment.filename}\``;
                    }

                    // Add field
                    embed.addFields({
                        name: "Zawiera załączniki",
                        value: prettyAttachmentsFileNames
                    });
                }

                for (let webhookInstance of webhookInstances) {
                    await webhookInstance.client.send({
                        embeds: [embed],
                        threadId: webhookInstance.options.threadId
                    });
                }
            } catch (err) {
                console.error("Error while forwarding mail!");
                console.error(err);

                let embed = new EmbedBuilder()
                    .setTitle("Błąd")
                    .setDescription(`Wystąpił błąd z podaniem dalej wiadomości! Jeśli chcesz odczytać jej zawartość to musisz udać się do panelu poczty.`)
                    .setColor(0xff0000)
                    .setFields([
                        {
                            name: "Message ID",
                            value: "`"+mail.messageId+"`"
                        },
                        {
                            name: "UID",
                            value: mailId.toString()
                        }
                    ]);

                for (let webhookInstance of webhookInstances) {
                    await webhookInstance.client.send({
                        embeds: [embed],
                        threadId: webhookInstance.options.threadId
                    });
                }
            }
        });

        // console.log("Connecting to IMAP...");
        await emailListener.connect();
        // console.log("Connected to IMAP!")

        console.log(`${instance.mailAccount.auth.user}: Instance is running!`);
    }
}

await run();
