import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

// Constants
const discord_webhook = process.env.DISCORD_WEBHOOK;
const juicebox_subgraph = process.env.JUICEBOX_SUBGRAPH;

if (!fs.existsSync("recent-runs.json")) {
  fs.writeFileSync(
    "recent-runs.json",
    JSON.stringify({
      lastPayEventTime: Math.floor(Date.now() / 1000),
      lastProjectCreateEventTime: Math.floor(Date.now() / 1000),
    }),
    { encoding: "utf8" }
  );
}

let { lastPayEventTime, lastProjectCreateEventTime } = JSON.parse(
  fs.readFileSync("recent-runs.json")
);

const payEventsQuery = `{
  payEvents(where:{timestamp_gt: ${lastPayEventTime}}){
    project {
      handle
      metadataUri
    }
    amount
    projectId
    beneficiary
    txHash
    pv
    timestamp
  }
}`;

const projectCreateEventsQuery = `{
  projectCreateEvents(where:{timestamp_gt: ${lastProjectCreateEventTime}}){
    project{
      handle
      metadataUri
    }
    from
    projectId
    txHash
    pv
    timestamp
  }
}`;

// Utils
async function querySubgraph(query) {
  return fetch(juicebox_subgraph, {
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify({ query }),
  }).then((res) => res.json());
}

async function resolveMetadata(metadataUri) {
  return fetch(`https://ipfs.io/ipfs/${metadataUri}`).then((res) => res.json());
}

async function resolveEns(address) {
  const ens = await fetch(
    `https://api.ensideas.com/ens/resolve/${address}`
  ).then((res) => res.json());
  return ens.name ? ens.name : address;
}

async function postToDiscordWebhook(title, url, fields, thumbnail) {
  fetch(discord_webhook, {
    headers: { "Content-Type": "application/json" },
    method: "POST",
    body: JSON.stringify({
      embeds: [
        {
          title,
          url,
          color: Math.floor(16777215 * Math.random()), // Random decimal color
          fields,
          thumbnail,
        },
      ],
    }),
  });
}

async function handlePayEvents() {
  return new Promise((resolve, reject) => {
    querySubgraph(payEventsQuery).then(async (json) => {
      for (const payEvent of json.data.payEvents) {
        const [metadata, beneficiary] = await Promise.all([
          resolveMetadata(payEvent.project.metadataUri),
          resolveEns(payEvent.beneficiary),
        ]);
        const project_name = metadata.name
          ? metadata.name
          : `v${payEvent.pv} project ${payEvent.projectId}`;

        postToDiscordWebhook(
          `Payment to ${project_name}`,
          `https://juicebox.money/${
            payEvent.pv === "2"
              ? "v2/p/" + payEvent.projectId
              : "p/" + payEvent.project.handle
          }`,
          [
            {
              name: `Amount`,
              value: `${payEvent.amount / 1e18} ETH`,
              inline: true,
            },
            {
              name: `Beneficiary`,
              value: `[${beneficiary}](https://juicebox.money/account/${payEvent.beneficiary})`,
              inline: true,
            },
            {
              name: `Transaction`,
              value: `[Etherscan](https://etherscan.io/tx/${payEvent.txHash})`,
              inline: true,
            },
          ],
          {
            url: metadata.logoUri
              ? `https://ipfs.io/ipfs/${metadata.logoUri.substring(
                  metadata.logoUri.lastIndexOf("/") + 1
                )}`
              : undefined,
          }
        )
          .then(() => {
            if (payEvent.timestamp > lastPayEventTime)
              lastPayEventTime = payEvent.timestamp;
          })
          .catch((e) => {
            fs.appendFileSync("errors.txt", e, { encoding: "utf8" });
            reject(e);
          });
      }

      resolve();
    });
  });
}

async function handleCreateEvents() {
  return new Promise((resolve, reject) => {
    querySubgraph(projectCreateEventsQuery).then(async (json) => {
      for (const projectCreateEvent of json.data.projectCreateEvents) {
        const [metadata, from] = await Promise.all([
          resolveMetadata(projectCreateEvent.project.metadataUri),
          resolveEns(projectCreateEvent.from),
        ]);
        const project_name = metadata.name
          ? metadata.name
          : `v${projectCreateEvent.pv} project ${projectCreateEvent.projectId}`;

        postToDiscordWebhook(
          `New Project: ${project_name}`,
          `https://juicebox.money/${
            projectCreateEvent.pv === "2"
              ? "v2/p/" + projectCreateEvent.projectId
              : "p/" + projectCreateEvent.project.handle
          }`,
          [
            {
              name: `Creator`,
              value: `[${from}](https://juicebox.money/account/${projectCreateEvent.from})`,
              inline: true,
            },
            {
              name: `Transaction`,
              value: `[Etherscan](https://etherscan.io/tx/${projectCreateEvent.txHash})`,
              inline: true,
            },
            {
              name: `Description`,
              value: metadata.description,
              inline: false,
            },
          ],
          {
            url: metadata.logoUri
              ? `https://ipfs.io/ipfs/${metadata.logoUri.substring(
                  metadata.logoUri.lastIndexOf("/") + 1
                )}`
              : undefined,
          }
        )
          .then(() => {
            if (projectCreateEvent.timestamp > lastProjectCreateEventTime)
              lastProjectCreateEventTime = projectCreateEvent.timestamp;
          })
          .catch((e) => {
            fs.appendFileSync("errors.txt", e, { encoding: "utf8" });
            reject(e);
          });
      }
      resolve();
    });
  });
}

await Promise.all([handlePayEvents(), handleCreateEvents()]);
fs.writeFileSync(
  "recent-runs.json",
  JSON.stringify({
    lastPayEventTime,
    lastProjectCreateEventTime,
  }),
  { encoding: "utf8" }
);
