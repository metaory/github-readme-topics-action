import { readFile, writeFile } from "node:fs/promises";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import core from "@actions/core";
import fetch from "node-fetch";

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

const [, , mode = "prod"] = process.argv;

const auth = process.env["GH_PAT"];
const email = "metaory@gmail.com";
const repo = "git-playground";
const username = "metaory";
const owner = username;

const octokit = new (Octokit.plugin(paginateRest))({
  auth,
  request: { fetch },
});

const write = (data, path) =>
  writeFile(
    path,
    typeof data === "object" ? JSON.stringify(data, null, 2) : data
  );

const read = async (path) =>
  JSON.parse(await readFile(path, { encoding: "utf8" }));

function updateFile(path, content, sha, message = "update") {
  return octokit.request(`PUT /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    message,
    committer: {
      name: username,
      email,
    },
    content: Buffer.from(content).toString("base64"),
    sha,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}
async function getFile(path, contentType = "json") {
  const {
    data: { sha, content },
  } = await octokit.request(`GET /repos/${owner}/${repo}/contents/${path}`, {
    owner,
    repo,
    path,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: `application/vnd.github.${contentType}`,
    },
  });
  return { sha, content: Buffer.from(content, "base64").toString() };
}

const reduceRepos = (repos) => {
  const reduced = repos
    .filter((x) => x.fork === false)
    .reduce(
      (acc, cur) => {
        const {
          name,
          description: desc,
          topics,
          stargazers_count: stars,
          language,
          updated_at: update,
        } = cur;

        const { topic, match } = topics.reduce(
          (_acc, _cur) => {
            const topic = TARGET_TOPICS.find((x) => x === _cur);
            if (topic && _acc.match === false) return { topic, match: true };
            return _acc;
          },
          { topic: null, match: false }
        );

        if (match)
          acc[topic].push({
            name,
            desc,
            stars,
            language,
            update,
          });

        return acc;
      },
      TARGET_TOPICS.reduce((acc, cur) => ({ ...acc, [cur]: [] }), {})
    );

  return TARGET_TOPICS.reduce((acc, cur) => {
    acc[cur] = reduced[cur].sort((a, b) => b.stars - a.stars);
    return acc;
  }, {});
};

const generateChanges = (outcome) =>
  TARGET_TOPICS.reduce(
    (acc, cur) => {
      acc.push(...["", `# ${cur.toUpperCase()}`, ""]);

      acc.push("| Name  | Description | Stargazers | Language | Update |");
      acc.push("| ----- | ----------- | ---------- | -------- | ------ |");

      outcome[cur].forEach(({ name, desc, stars, language, update }) => {
        acc.push(`| ${name} | ${desc} | ${stars} | ${language} | ${update} |`);
      });

      return acc;
    },
    [""]
  );

const mergeChanges = (originalLines, modifiedLines) =>
  originalLines
    .reduce(
      (acc, cur, i, arr) => {
        if (cur === "<!--START_SECTION:topics-->") {
          acc.modified.push(cur);
          acc.replace = true;
          return acc;
        }

        if (cur === "<!--END_SECTION:topics-->") {
          acc.modified.push(cur);
          acc.replace = false;
          return acc;
        }

        if (acc.replace === false) acc.modified.push(cur);

        if (acc.replace === true && acc.done === false) {
          modifiedLines.forEach((x) => acc.modified.push(x));
          acc.done = true;
        }

        if (i === arr.length - 1) return acc.modified;

        return acc;
      },
      { modified: [], replace: false, done: false }
    )
    .join("\n");

const getRepos = () => {
  const REPOS_URL = "GET /users/metaory/repos"; // TODO: read from action inputs
  return mode === "dev"
    ? read("tmp/repos.json")
    : octokit.paginate(REPOS_URL, { username });
};

async function run() {
  try {
    console.log(` ==> running mode: ${mode}`);

    const testUsername = core.getInput("username");
    console.log("testUsername:", testUsername);

    const testTopics = core.getInput("topics");
    console.log("testTopics:", testTopics);
    console.log("auth:", auth);

    const repos = await getRepos();

    console.log(" ==> found", repos.length, "repos");

    // mode === "prod" && (await write(repos, "tmp/repos.json"));

    const outcome = reduceRepos(repos);
    // write(outcome, "tmp/outcome.json");

    const modifiedLines = generateChanges(outcome);

    const { sha, content } = await getFile("README.md");

    const originalLines = content.split("\n");

    const modified = mergeChanges(originalLines, modifiedLines);
    // write(modified, "tmp/modified.md");

    await updateFile("README.md", modified, sha);
  } catch (error) {
    core.setFailed(error.message);
    console.error(error);
  }
}

run();
