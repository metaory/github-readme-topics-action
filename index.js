import { readFile, writeFile } from "node:fs/promises";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import core from "@actions/core";

// XXX: Boolean(process.env['CI']) // check if running in a Github Action workflow

// TODO: read from action inputs
const TARGET_TOPICS = [
  "api",
  "automation",
  "challenge",
  "cli",
  "github-actions",
  "npm-package",
  "theme",
];

// TODO: read from action inputs
const REPOS_URL = "GET /users/metaory/repos";

const [, , mode = "prod"] = process.argv;

const auth = process.env["GH_PAT"];
const username = "metaory";

const write = (data, path) => writeFile(path, JSON.stringify(data, null, 2));

const read = async (path) =>
  JSON.parse(await readFile(path, { encoding: "utf8" }));

async function run() {
  try {
    console.log(` ==> running mode: ${mode}`);

    const octokit = new (Octokit.plugin(paginateRest))({ auth });

    const res =
      mode === "dev"
        ? await read("tmp/data.json")
        : await octokit.paginate(REPOS_URL, { username });

    mode === "prod" && (await write(res, "tmp/data.json"));

    console.log(" ==> found", res.length, "repos");

    const reduced = res
      .filter((x) => x.fork === false)
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

    // TODO: updateProfileReadme(outcome)
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
