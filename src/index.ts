import {EmailListener} from "./email-listener.js";
import {ImapFlowOptions} from "imapflow";
import fs from "fs";
import {EmbedBuilder, WebhookClient} from "discord.js";
import * as crypto from "crypto";

interface EnvConfig {
    instances: Array<{
        mailAccount: ImapFlowOptions,
        webhookUrl: string
    }>
}

async function run() {
    const envConfig = JSON.parse(fs.readFileSync("env-config.json", "utf-8")) as EnvConfig;

    for (let instance of envConfig.instances) {
        console.log(`${instance.mailAccount.auth.user}: Preparing instance...`)
        const emailListener = new EmailListener(instance.mailAccount);
        const webhookClient = new WebhookClient({url: instance.webhookUrl})

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
                    .setDescription(mail.text!)
                    .setFields({
                        name: "Liczba załączników",
                        value: mail.attachments.length.toString()
                    })
                    .setColor(0xf8e337);

                await webhookClient.send({embeds: [embed]});
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
                            value: mail.messageId+""
                        },
                        {
                            name: "UID",
                            value: mailId.toString()
                        }
                    ]);

                await webhookClient.send({embeds: [embed]});
            }
        });

        await emailListener.connect();

        console.log(`${instance.mailAccount.auth.user}: Instance is running!`);
    }
}

await run();
