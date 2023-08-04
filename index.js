import { readFile, writeFile } from "node:fs/promises";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import core from "@actions/core";

const TARGET_TOPICS = [
  "api",
  "automation",
  "challenge",
  "cli",
  "github-actions",
  "npm-package",
  "theme",
];

const REPOS_URL = "GET /users/metaory/repos";

const [, , mode] = process.argv;
const isDev = mode === "dev";

const auth = process.env["GH_PAT"];
const username = "metaory";

const write = (data, path) => writeFile(path, JSON.stringify(data, null, 2));

const read = async (path) =>
  JSON.parse(await readFile(path, { encoding: "utf8" }));

async function run() {
  try {
    const octokit = new (Octokit.plugin(paginateRest))({ auth });

    const res = isDev
      ? await read("tmp/data.json")
      : await octokit.paginate(REPOS_URL, { username });

    isDev === false && (await write(res, "tmp/data.json"));

    console.log(`found ${res.length} repos`);

    const reduced = res
      .filter((x) => x.private === false && x.fork === false)
      .reduce(
        (acc, cur) => {
          const {
            name,
            description,
            topics,
            updated_at,
            stargazers_count,
            language,
          } = cur;

          const { topic, match } = topics.reduce(
            (_acc, _cur) => {
              const topic = TARGET_TOPICS.find((x) => x === _cur);
              if (topic && _acc.match === false) return { topic, match: true };
              return _acc;
            },
            { topic: null, match: false },
          );

          if (match)
            acc[topic].push({
              name,
              description,
              updated_at,
              stargazers_count,
              language,
            });

          return acc;
        },
        TARGET_TOPICS.reduce((acc, cur) => ({ ...acc, [cur]: [] }), {}),
      );

    const outcome = TARGET_TOPICS.reduce((acc, cur) => {
      acc[cur] = reduced[cur].sort(
        (a, b) => b.stargazers_count - a.stargazers_count,
      );
      return acc;
    }, {});

    console.log("outcome:", outcome);

    write(outcome, "tmp/outcome.json");
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
